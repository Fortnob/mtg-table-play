/* ============================================================
   02-scryfall.js - Scryfall API client + IndexedDB card/art cache
   Public data, fetched live, cached locally so repeat games are instant.
   Respects Scryfall's rate limits: 10 requests a second in general, and
   2 a second for search, named, random and collection lookups.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const API = 'https://api.scryfall.com';
  const DB_NAME = 'mtgtable-cards';
  const DB_VER = 4;
  const SEP = '';
  const STORES = { cards: 'cards', names: 'names', prints: 'prints', sets: 'sets', meta: 'meta', images: 'images', games: 'games' };
  const CACHE_TTL = 1000 * 60 * 60 * 24 * 14;   // 14 days for card data
  const SET_TTL = 1000 * 60 * 60 * 24 * 3;      // 3 days for set lists

  /* ---------------- IndexedDB wrapper ---------------- */
  class IDB {
    constructor() { this.db = null; this.ready = this._open(); this.mem = new Map(); }
    _open() {
      return new Promise((resolve) => {
        if (!window.indexedDB) { console.warn('[scryfall] no IndexedDB; memory cache only'); return resolve(null); }
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VER); }
        catch (e) { console.warn('[scryfall] idb open failed', e); return resolve(null); }
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          for (const s of Object.values(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        };
        req.onsuccess = () => resolve((this.db = req.result));
        req.onerror = () => { console.warn('[scryfall] idb error', req.error); resolve(null); };
        req.onblocked = () => resolve(null);
        setTimeout(() => resolve(this.db), 4000); // never hang the app on idb
      });
    }
    async get(store, key) {
      const mk = store + SEP + key;
      if (this.mem.has(mk)) return this.mem.get(mk);
      await this.ready;
      if (!this.db) return undefined;
      return new Promise((res) => {
        try {
          const tx = this.db.transaction(store, 'readonly');
          const r = tx.objectStore(store).get(key);
          r.onsuccess = () => { if (r.result !== undefined) this.mem.set(mk, r.result); res(r.result); };
          r.onerror = () => res(undefined);
        } catch (e) { res(undefined); }
      });
    }
    async getMany(store, keys) {
      const out = new Map();
      const missing = [];
      for (const k of keys) {
        const mk = store + SEP + k;
        if (this.mem.has(mk)) out.set(k, this.mem.get(mk)); else missing.push(k);
      }
      if (!missing.length) return out;
      await this.ready;
      if (!this.db) return out;
      return new Promise((res) => {
        try {
          const tx = this.db.transaction(store, 'readonly');
          const os = tx.objectStore(store);
          let left = missing.length;
          if (!left) return res(out);
          for (const k of missing) {
            const r = os.get(k);
            r.onsuccess = () => {
              if (r.result !== undefined) { out.set(k, r.result); this.mem.set(store + SEP + k, r.result); }
              if (--left === 0) res(out);
            };
            r.onerror = () => { if (--left === 0) res(out); };
          }
        } catch (e) { res(out); }
      });
    }
    async put(store, key, val) {
      this.mem.set(store + SEP + key, val);
      await this.ready;
      if (!this.db) return;
      try {
        const tx = this.db.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
      } catch (e) { /* quota / closed */ }
    }
    async putMany(store, entries) {
      for (const [k, v] of entries) this.mem.set(store + SEP + k, v);
      await this.ready;
      if (!this.db) return;
      try {
        const tx = this.db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const [k, v] of entries) os.put(v, k);
      } catch (e) { /* ignore */ }
    }
    async clear(store) {
      for (const k of Array.from(this.mem.keys())) if (k.startsWith(store + SEP)) this.mem.delete(k);
      await this.ready; if (!this.db) return;
      try { this.db.transaction(store, 'readwrite').objectStore(store).clear(); } catch (e) {}
    }
    async count(store) {
      await this.ready; if (!this.db) return 0;
      return new Promise(res => {
        try { const r = this.db.transaction(store, 'readonly').objectStore(store).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); }
        catch (e) { res(0); }
      });
    }
  }

  /* ---------------- request queue with rate limiting ---------------- */
  class Queue {
    /* `slowGap` is for the endpoints Scryfall holds to two a second; a 429
       from those locks the whole client out for thirty seconds. */
    constructor(minGap, slowGap) { this.gap = minGap; this.slowGap = slowGap || minGap; this.last = 0; this.lastSlow = 0; this.chain = Promise.resolve(); this.pending = 0; }
    /* A request given an AbortSignal that fires while it queues (a search
       for "gob" once "goblin" is typed) drops out without being sent, and
       one already sent is cut off, so the search wanted is not left
       waiting its turn behind it. The slow endpoints are spaced from each
       other, not from every quick lookup in between. */
    run(fn, slow, signal) {
      this.pending++;
      MTG.bus.emit('scryfall:pending', this.pending);
      const p = this.chain.then(async () => {
        if (signal && signal.aborted) {
          this.pending--; MTG.bus.emit('scryfall:pending', this.pending);
          throw Queue.stale();
        }
        const now = Date.now();
        const wait = Math.max(this.gap - (now - this.last), slow ? this.slowGap - (now - this.lastSlow) : 0);
        if (wait > 0) await U.sleep(wait);
        if (signal && signal.aborted) {
          this.pending--; MTG.bus.emit('scryfall:pending', this.pending);
          throw Queue.stale();
        }
        this.last = Date.now();
        if (slow) this.lastSlow = this.last;
        try { return await fn(); } finally { this.pending--; MTG.bus.emit('scryfall:pending', this.pending); }
      });
      this.chain = p.catch(() => {});
      return p;
    }
    static stale() { const e = new Error('Overtaken by a newer search.'); e.stale = true; return e; }
  }

  /* ---------------- the client ---------------- */
  class Scryfall {
    constructor() {
      this.db = new IDB();
      this.q = new Queue(120, 550);         // ~8 requests/sec, under 2/sec for searches
      this.offline = false;
      this.stats = { hits: 0, misses: 0, requests: 0, errors: 0, local: 0 };
    }

    /* --- the card database (02a-carddb.js) ---
       When Scryfall's bulk data has been downloaded, lookups and searches
       are answered from it and the network is not asked at all. Anything
       it cannot answer goes to Scryfall as before. */
    async _localDb(opts) {
      const db = MTG.cardDb;
      if (!db || (opts && opts.live)) return null;
      if (db.has() || await db.ready()) return db;
      return null;
    }

    /* --- low level fetch ---
       The whole client goes through one serial queue, so a request must never
       wait on the queue from inside it: the chain is the promise of the task
       already running, and asking it to wait for itself is a deadlock the
       user sees as a draft that never finishes opening its packs. The rate
       limit retry therefore loops in here rather than calling back out. */
    async _fetch(path, opts) {
      opts = opts || {};
      this.stats.requests++;
      return this.q.run(() => this._doFetch(path, opts), /\/cards\/(search|named|random|collection)/.test(path), opts.signal);
    }

    async _doFetch(path, opts) {
      const url = path.startsWith('http') ? path : API + path;
      const backoff = [1200, 2500, 5000, 8000];
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          res = await this._withTimeout(fetch(url, {
            method: opts.method || 'GET',
            headers: Object.assign({ 'Accept': 'application/json;q=0.9,*/*;q=0.8' },
              opts.body ? { 'Content-Type': 'application/json' } : {}),
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            signal: opts.signal,
          }), opts.timeout || 20000);
        } catch (e) {
          if (opts.signal && opts.signal.aborted) throw Queue.stale();
          // one retry for a dropped connection, then admit it
          if (attempt < 1 && !/timed out/i.test(e.message || '')) { await U.sleep(600); continue; }
          this.stats.errors++; this.offline = true;
          MTG.bus.emit('scryfall:offline');
          throw new Error(/timed out/i.test(e.message || '')
            ? 'Scryfall did not answer in time. Cached cards still work.'
            : 'Network error contacting Scryfall. Cached cards still work.');
        }
        this.offline = false;
        if (res.status === 404) return null;
        if ((res.status === 429 || res.status >= 500) && attempt < backoff.length) {
          await U.sleep(backoff[attempt]);
          continue;
        }
        if (!res.ok) {
          this.stats.errors++;
          let msg = res.status + ' ' + res.statusText;
          try { const j = await res.json(); if (j && j.details) msg = j.details; } catch (e) {}
          throw new Error('Scryfall: ' + msg);
        }
        return res.json();
      }
    }

    /** A promise that loses rather than hanging the screen behind it. */
    _withTimeout(promise, ms) {
      let t = null;
      return Promise.race([
        promise.then(v => { clearTimeout(t); return v; }, e => { clearTimeout(t); throw e; }),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Request timed out')), ms); }),
      ]);
    }

    /* --- trim a card to what the game needs (keeps IndexedDB small) --- */
    slim(c) {
      if (!c) return null;
      const faceKeys = ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'color_indicator',
        'power', 'toughness', 'loyalty', 'defense', 'flavor_text', 'artist', 'illustration_id', 'watermark', 'cmc'];
      const out = {
        id: c.id, oracle_id: c.oracle_id, name: c.name, lang: c.lang, layout: c.layout,
        mana_cost: c.mana_cost, cmc: c.cmc, type_line: c.type_line, oracle_text: c.oracle_text,
        colors: c.colors, color_identity: c.color_identity, keywords: c.keywords,
        power: c.power, toughness: c.toughness, loyalty: c.loyalty, defense: c.defense,
        produced_mana: c.produced_mana, legalities: c.legalities, reserved: c.reserved,
        set: c.set, set_name: c.set_name, set_type: c.set_type, collector_number: c.collector_number,
        rarity: c.rarity, released_at: c.released_at, digital: c.digital, games: c.games,
        border_color: c.border_color, frame: c.frame, frame_effects: c.frame_effects,
        promo_types: c.promo_types, finishes: c.finishes, full_art: c.full_art, textless: c.textless,
        artist: c.artist, illustration_id: c.illustration_id, flavor_text: c.flavor_text,
        scryfall_uri: c.scryfall_uri, edhrec_rank: c.edhrec_rank, penny_rank: c.penny_rank,
        hand_modifier: c.hand_modifier, life_modifier: c.life_modifier,
        prices: c.prices ? { usd: c.prices.usd, usd_foil: c.prices.usd_foil, eur: c.prices.eur, tix: c.prices.tix } : null,
        _t: Date.now(),
      };
      if (c.image_uris) out.image_uris = {
        small: c.image_uris.small, normal: c.image_uris.normal,
        large: c.image_uris.large, art_crop: c.image_uris.art_crop, png: c.image_uris.png,
      };
      if (c.card_faces) {
        out.card_faces = c.card_faces.map(f => {
          const o = {};
          for (const k of faceKeys) if (f[k] !== undefined) o[k] = f[k];
          if (f.image_uris) o.image_uris = {
            small: f.image_uris.small, normal: f.image_uris.normal,
            large: f.image_uris.large, art_crop: f.image_uris.art_crop, png: f.image_uris.png,
          };
          return o;
        });
      }
      if (c.all_parts) out.all_parts = c.all_parts.map(p => ({ id: p.id, component: p.component, name: p.name, type_line: p.type_line }));
      return out;
    }

    async _store(cards) {
      const list = cards.filter(Boolean).map(c => this.slim(c));
      if (!list.length) return list;
      await this.db.putMany(STORES.cards, list.map(c => [c.id, c]));
      // name index -> preferred default printing id
      const nameEntries = [];
      for (const c of list) {
        const key = U.normName(c.name);
        nameEntries.push([key, c.id]);
        const front = U.normName(U.frontName(c.name));
        if (front !== key) nameEntries.push([front, c.id]);
      }
      const existing = await this.db.getMany(STORES.names, nameEntries.map(e => e[0]));
      const toWrite = nameEntries.filter(([k]) => !existing.has(k));
      if (toWrite.length) await this.db.putMany(STORES.names, toWrite);
      return list;
    }

    /* ================= card lookup ================= */

    async byId(id) {
      if (!id) return null;
      const local = await this._localDb();
      const own = local && local.idx.byIdCard(id);
      if (own) { this.stats.local++; return own; }
      const hit = await this.db.get(STORES.cards, id);
      if (hit) { this.stats.hits++; return hit; }
      this.stats.misses++;
      const c = await this._fetch('/cards/' + encodeURIComponent(id));
      if (!c) return null;
      return (await this._store([c]))[0];
    }

    /** Look up one card by exact name (falls back to fuzzy). */
    async byName(name, opts) {
      opts = opts || {};
      const key = U.normName(name);
      if (!opts.force) {
        const local = await this._localDb(opts);
        const own = local && local.idx.byNameCard(name);
        if (own) { this.stats.local++; return own; }
        const id = await this.db.get(STORES.names, key);
        if (id) { const c = await this.db.get(STORES.cards, id); if (c) { this.stats.hits++; return c; } }
      }
      this.stats.misses++;
      let c = await this._fetch('/cards/named?exact=' + encodeURIComponent(name));
      if (!c) c = await this._fetch('/cards/named?fuzzy=' + encodeURIComponent(name));
      if (!c) return null;
      const s = (await this._store([c]))[0];
      await this.db.put(STORES.names, key, s.id);
      return s;
    }

    /**
     * Bulk resolve identifiers. Each identifier is one of:
     *   {name}  {name, set}  {set, collector_number}  {id}
     * Returns { cards: [...aligned with input...], notFound: [identifier...] }
     * This is the workhorse for decklist import: 75 cards per request.
     */
    async collection(identifiers, onProgress) {
      const result = new Array(identifiers.length).fill(null);
      const needIdx = [];

      // 1. serve what we can from the card database and the cache
      const local = await this._localDb();
      for (let i = 0; i < identifiers.length; i++) {
        const ident = identifiers[i];
        let c = null;
        if (local) {
          const L = local.idx;
          c = ident.id ? L.byIdCard(ident.id)
            : ident.set && ident.collector_number ? L.bySetNumber(ident.set, ident.collector_number)
            : ident.name ? L.byNameCard(ident.name, ident.set) : null;
          if (c) { result[i] = c; this.stats.local++; continue; }
        }
        if (ident.id) c = await this.db.get(STORES.cards, ident.id);
        else if (ident.set && ident.collector_number) {
          const k = 'cn:' + String(ident.set).toLowerCase() + ':' + String(ident.collector_number).toLowerCase();
          const id = await this.db.get(STORES.names, k);
          if (id) c = await this.db.get(STORES.cards, id);
        } else if (ident.name && !ident.set) {
          const id = await this.db.get(STORES.names, U.normName(ident.name));
          if (id) c = await this.db.get(STORES.cards, id);
        }
        if (c) { result[i] = c; this.stats.hits++; } else { needIdx.push(i); this.stats.misses++; }
      }
      if (onProgress) onProgress(identifiers.length - needIdx.length, identifiers.length);
      if (!needIdx.length) return { cards: result, notFound: [] };

      // 2. batch the rest, 75 at a time
      const notFound = [];
      const CH = 75;
      for (let off = 0; off < needIdx.length; off += CH) {
        const chunkIdx = needIdx.slice(off, off + CH);
        const body = { identifiers: chunkIdx.map(i => this._normIdent(identifiers[i])) };
        let data = null;
        try { data = await this._fetch('/cards/collection', { method: 'POST', body }); }
        catch (e) { chunkIdx.forEach(i => notFound.push(identifiers[i])); continue; }
        if (!data) { chunkIdx.forEach(i => notFound.push(identifiers[i])); continue; }
        const got = await this._store(data.data || []);
        // store collector-number index too
        const cnEntries = got.map(c => ['cn:' + c.set + ':' + String(c.collector_number).toLowerCase(), c.id]);
        if (cnEntries.length) await this.db.putMany(STORES.names, cnEntries);
        // map results back onto requested positions
        const pool = got.slice();
        for (const i of chunkIdx) {
          const ident = identifiers[i];
          let k = -1;
          if (ident.id) k = pool.findIndex(c => c.id === ident.id);
          else if (ident.set && ident.collector_number)
            k = pool.findIndex(c => c.set === String(ident.set).toLowerCase() && String(c.collector_number).toLowerCase() === String(ident.collector_number).toLowerCase());
          if (k < 0 && ident.name) {
            const nn = U.normName(ident.name);
            k = pool.findIndex(c => U.normName(c.name) === nn || U.normName(U.frontName(c.name)) === nn);
          }
          if (k >= 0) { result[i] = pool[k]; pool.splice(k, 1); }
          else notFound.push(ident);
        }
        if (onProgress) onProgress(result.filter(Boolean).length, identifiers.length);
      }

      // 3. last-chance fuzzy for stragglers (typos in pasted lists)
      for (let i = 0; i < result.length; i++) {
        if (result[i] || !identifiers[i].name) continue;
        try {
          const c = await this.byName(identifiers[i].name);
          if (c) {
            result[i] = c;
            const k = notFound.indexOf(identifiers[i]);
            if (k >= 0) notFound.splice(k, 1);
          }
        } catch (e) { /* stays not found */ }
      }
      return { cards: result, notFound };
    }

    _normIdent(ident) {
      if (ident.id) return { id: ident.id };
      if (ident.set && ident.collector_number)
        return { set: String(ident.set).toLowerCase(), collector_number: String(ident.collector_number) };
      if (ident.name && ident.set) return { name: U.frontName(ident.name), set: String(ident.set).toLowerCase() };
      return { name: U.frontName(ident.name) };
    }

    /* ================= search ================= */

    /** Full search. Returns up to `max` cards, following pagination. */
    async search(query, opts) {
      opts = opts || {};
      const max = opts.max || 175;
      const local = await this._localDb(opts);
      if (local && local.answers(query, opts)) {
        try { const cards = local.search(query, opts); this.stats.local++; return cards; }
        catch (e) { if (!(e instanceof local.Unsupported)) throw e; /* beyond the local engine: Scryfall it is */ }
      }
      try { return await this._liveSearch(query, opts, max); }
      catch (e) {
        if (e && e.stale) throw e;
        // offline with a database that could not answer exactly: its best is better than nothing
        if (local) { try { const cards = local.search(query, opts); this.stats.local++; return cards; } catch (e2) {} }
        throw e;
      }
    }

    async _liveSearch(query, opts, max) {
      const params = new URLSearchParams({ q: query });
      if (opts.unique) params.set('unique', opts.unique);
      if (opts.order) params.set('order', opts.order);
      if (opts.dir) params.set('dir', opts.dir);
      if (opts.includeExtras) params.set('include_extras', 'true');
      if (opts.includeVariations) params.set('include_variations', 'true');

      const cacheKey = 'search:' + U.hash(params.toString()) + ':' + max;
      if (!opts.force) {
        const hit = await this.db.get(STORES.meta, cacheKey);
        if (hit && Date.now() - hit._t < (opts.ttl || CACHE_TTL)) {
          const m = await this.db.getMany(STORES.cards, hit.ids);
          const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
          if (arr.length === hit.ids.length) { this.stats.hits++; return arr; }
        }
      }
      let url = '/cards/search?' + params.toString();
      const out = [];
      const seenPages = new Set();
      // a page cap as well as a card cap: a next_page that points at itself
      // would otherwise spin forever behind a progress bar
      for (let page = 0; url && out.length < max && page < 40; page++) {
        if (seenPages.has(url)) break;
        seenPages.add(url);
        const data = await this._fetch(url, { signal: opts.signal });
        if (!data) break;
        out.push(...(data.data || []));
        url = data.has_more ? data.next_page : null;
      }
      const cards = await this._store(out.slice(0, max));
      await this.db.put(STORES.meta, cacheKey, { ids: cards.map(c => c.id), _t: Date.now() });
      return cards;
    }

    async autocomplete(q, opts) {
      if (!q || q.length < 2) return [];
      const local = await this._localDb();
      if (local) return local.idx.autocomplete(q, 20);
      try {
        const d = await this._fetch('/cards/autocomplete?q=' + encodeURIComponent(q), { signal: opts && opts.signal });
        return (d && d.data) || [];
      } catch (e) { return []; }
    }

    async random(query) {
      const local = await this._localDb();
      if (local && local.answers(query || '', {})) {
        try {
          const ids = local.idx.query(query || '-t:basic', {});
          if (ids.length) return local.idx.card(ids[Math.floor(Math.random() * ids.length)]);
        } catch (e) { /* Scryfall can */ }
      }
      const c = await this._fetch('/cards/random' + (query ? '?q=' + encodeURIComponent(query) : ''));
      return c ? (await this._store([c]))[0] : null;
    }

    /* ================= printings (art selection) ================= */

    /**
     * Every printing of a card, newest first, for the art picker.
     * Keeps art-series cards out; prefers paper printings.
     */
    async printings(card, opts) {
      opts = opts || {};
      const oracle = card.oracle_id;
      const key = 'prints:' + (oracle || U.normName(card.name));
      // the card database lists them straight off, with nothing to keep
      const local = await this._localDb();
      const fromDb = !!(local && local.idx.hasPrintings);
      if (!opts.force && !fromDb) {
        const hit = await this.db.get(STORES.prints, key);
        if (hit && Date.now() - hit._t < CACHE_TTL) {
          const m = await this.db.getMany(STORES.cards, hit.ids);
          const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
          if (arr.length) return arr;
        }
      }
      const q = oracle ? ('oracleid:' + oracle) : ('!"' + U.frontName(card.name).replace(/"/g, '') + '"');
      let cards = [];
      try {
        cards = await this.search(q, {
          unique: 'prints', order: 'released', dir: 'desc', max: 250,
          includeExtras: true, includeVariations: true, force: opts.force,
        });
      } catch (e) { cards = [card]; }
      cards = cards.filter(c => c.layout !== 'art_series' && (!c.lang || c.lang === 'en'));
      if (!opts.includeDigital) {
        const paper = cards.filter(c => !c.digital);
        if (paper.length) cards = paper;
      }
      if (!cards.length) cards = [card];
      if (!fromDb) await this.db.put(STORES.prints, key, { ids: cards.map(c => c.id), _t: Date.now() });
      return cards;
    }

    /* ================= sets ================= */

    async sets(opts) {
      opts = opts || {};
      const hit = await this.db.get(STORES.meta, 'setlist');
      if (hit && !opts.force && Date.now() - hit._t < SET_TTL) return hit.sets;
      let d;
      try { d = await this._fetch('/sets'); }
      catch (e) {
        // offline: an old list will do, and failing that the card database knows its sets
        if (hit) return hit.sets;
        const local = await this._localDb();
        if (local && local.idx.hasPrintings) return local.idx.setList();
        throw e;
      }
      const sets = (d && d.data ? d.data : []).map(s => ({
        code: s.code, name: s.name, set_type: s.set_type, released_at: s.released_at,
        card_count: s.card_count, digital: s.digital, icon_svg_uri: s.icon_svg_uri,
        parent_set_code: s.parent_set_code, block: s.block, block_code: s.block_code,
      }));
      await this.db.put(STORES.meta, 'setlist', { sets, _t: Date.now() });
      return sets;
    }

    /** Sets you can realistically draft: paper expansions & core sets with enough cards. */
    async draftableSets() {
      const all = await this.sets();
      const today = new Date().toISOString().slice(0, 10);
      return all
        .filter(s => !s.digital && ['expansion', 'core', 'draft_innovation', 'masters'].includes(s.set_type))
        .filter(s => s.card_count >= 100 && s.released_at && s.released_at <= today)
        // printed only in other languages (Renaissance, the foreign black-border sets): no English cards to open
        .filter(s => !/Foreign Black Border|^Renaissance$|^Rinascimento$/i.test(s.name || '') && !['ren', 'rin', 'bchr', '4bb', 'fbb'].includes(s.code))
        .sort((a, b) => (b.released_at || '').localeCompare(a.released_at || ''));
    }

    /**
     * The draftable sets grouped into the pools people actually name.
     * Scryfall's set list does not carry format legality, so the windows are
     * worked out from release dates, which is how the formats are defined
     * anyway: Pioneer starts at Return to Ravnica, Modern at Eighth Edition,
     * and Standard is the last three years of core and expansion sets.
     */
    async setPools() {
      const all = await this.draftableSets();
      const core = all.filter(s => s.set_type === 'core' || s.set_type === 'expansion');
      const newest = core.length ? core[0].released_at : new Date().toISOString().slice(0, 10);
      const yearsBack = (n) => {
        const d = new Date(newest);
        d.setFullYear(d.getFullYear() - n);
        return d.toISOString().slice(0, 10);
      };
      const since = (list, date) => list.filter(s => (s.released_at || '') >= date);
      return [
        { id: 'all', name: 'Everything', blurb: 'Every draftable set ever printed, silver borders left out.', sets: all },
        { id: 'standard', name: 'Standard', blurb: 'The core and expansion sets still in the Standard window.', sets: since(core, yearsBack(3)) },
        { id: 'pioneer', name: 'Pioneer', blurb: 'Return to Ravnica onwards.', sets: since(core, '2012-10-05') },
        { id: 'modern', name: 'Modern', blurb: 'Eighth Edition onwards, supplemental sets included.', sets: since(all, '2003-07-28') },
        { id: 'vintage', name: 'Vintage', blurb: 'The whole history, same as Everything.', sets: all },
        { id: 'retro', name: 'Retro', blurb: 'Everything printed before Eighth Edition.', sets: all.filter(s => (s.released_at || '') < '2003-07-28') },
        { id: 'masters', name: 'Masters & remasters', blurb: 'Reprint sets built for drafting.', sets: all.filter(s => s.set_type === 'masters' || s.set_type === 'draft_innovation') },
      ].filter(p => p.sets.length >= 2);
    }

    /** All cards in a set, grouped by rarity - the raw material for boosters. */
    async setPool(code, opts) {
      opts = opts || {};
      const key = 'pool:' + String(code).toLowerCase();
      if (!opts.force) {
        const hit = await this.db.get(STORES.meta, key);
        if (hit && Date.now() - hit._t < CACHE_TTL) {
          const m = await this.db.getMany(STORES.cards, hit.ids);
          const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
          if (arr.length === hit.ids.length) {
            const cached = this._bucket(arr);
            cached.loose = !!hit.loose;
            cached.setCode = String(code).toLowerCase();
            return cached;
          }
        }
      }
      // is:booster excludes extended-art/promo variants that are not in packs
      let cards = await this.search('set:' + code + ' is:booster -is:digital lang:en',
        { unique: 'cards', order: 'set', max: 1200, force: opts.force })
        .catch(() => []);
      /* Some sets are not sold in draft boosters at all, so Scryfall marks
         nothing in them `is:booster` and the strict query comes back empty.
         That is not a reason to refuse to draft the set — take the whole set
         and let the collation do its best with it. */
      let loose = false;
      if (cards.length < 20) {
        const wide = await this.search('set:' + code + ' -is:digital lang:en -t:basic',
          { unique: 'cards', order: 'set', max: 1200, force: opts.force })
          .catch(() => []);
        if (wide.length > cards.length) { cards = wide; loose = true; }
      }
      await this.db.put(STORES.meta, key, { ids: cards.map(c => c.id), loose, _t: Date.now() });
      const pool = this._bucket(cards);
      pool.loose = loose;
      pool.setCode = String(code).toLowerCase();
      return pool;
    }

    /**
     * A set's special printings: extended art, borderless, showcase and full
     * art, the treatments a Collector Booster is made of. Bucketed by rarity
     * like setPool. A set from before collector boosters has none, and that
     * is an empty pool rather than an error.
     */
    async setVariants(code) {
      const key = 'variants:' + String(code).toLowerCase();
      const hit = await this.db.get(STORES.meta, key);
      if (hit && Date.now() - hit._t < CACHE_TTL) {
        const m = await this.db.getMany(STORES.cards, hit.ids);
        const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
        if (arr.length === hit.ids.length) return this._bucket(arr);
      }
      const cards = await this.search(`set:${code} (is:extendedart or is:borderless or is:showcase or is:fullart) -is:digital lang:en`,
        { unique: 'prints', order: 'set', max: 800 }).catch(() => []);
      await this.db.put(STORES.meta, key, { ids: cards.map(c => c.id), _t: Date.now() });
      return this._bucket(cards);
    }

    _bucket(cards) {
      const b = {
        all: cards, playable: [], common: [], uncommon: [], rare: [], mythic: [],
        special: [], bonus: [], basics: [], nonbasicLands: [],
      };
      for (const c of cards) {
        const tl = c.type_line || '';
        if (MTG.formats.isBasicLand(c)) { b.basics.push(c); continue; }
        b.playable.push(c);          // everything a pack may legitimately open
        if (b[c.rarity]) b[c.rarity].push(c);
        else b.special.push(c);
        if (/\bLand\b/.test(tl)) b.nonbasicLands.push(c);
      }
      return b;
    }

    /* ================= images ================= */

    imageUrl(card, size, faceIndex) {
      const url = this._imageUrl(card, size, faceIndex);
      // judged by the table-sized picture: when that one cannot load, neither will the others
      const probe = !size || size === 'normal' ? url : this._imageUrl(card, 'normal', faceIndex);
      // (only a request for that size tries it; the others just take the answer)
      return url && this.imageUsable(probe || url, probe === url ? 'normal' : null) ? url : '';
    }

    /* --- pictures that will not come ---
       Offline, a card picture is an empty frame. Each table-sized picture is
       tried once in the background (the same request the table makes, so it
       costs nothing extra); one that fails is answered with '' from then on,
       which every screen already reads as "write the card out instead", and
       'scryfall:images' tells whatever is showing it to look again. */
    imageUsable(url, size) {
      if (!url || typeof Image === 'undefined') return !!url;
      const st = this._img || (this._img = { bad: new Set(), tried: new Set() });
      if (st.bad.has(url)) return false;
      if (size === 'normal' && !st.tried.has(url)) {
        st.tried.add(url);
        const probe = new Image();
        probe.decoding = 'async';
        probe.onerror = () => {
          st.bad.add(url);
          // a picture that failed while the connection was down may well load later
          setTimeout(() => { st.bad.delete(url); st.tried.delete(url); }, 1000 * 60 * 5);
          if (!this._imgTell) this._imgTell = U.debounce(() => MTG.bus.emit('scryfall:images'), 200);
          this._imgTell();
        };
        probe.src = url;
      }
      return true;
    }

    _imageUrl(card, size, faceIndex) {
      size = size || 'normal';
      if (!card) return '';
      const f = card.card_faces && card.card_faces[faceIndex || 0];
      if (f && f.image_uris && f.image_uris[size]) return f.image_uris[size];
      if (card.image_uris && card.image_uris[size]) return card.image_uris[size];
      if (f && f.image_uris) return f.image_uris.normal || f.image_uris.large || '';
      if (card.image_uris) return card.image_uris.normal || card.image_uris.large || '';
      return '';
    }

    /** Warm the browser's HTTP cache so the table does not pop in. */
    prefetchImages(cards, size) {
      const seen = new Set();
      let i = 0;
      const step = () => {
        for (let n = 0; n < 6 && i < cards.length; n++, i++) {
          const url = this.imageUrl(cards[i], size || 'normal');
          if (!url || seen.has(url)) continue;
          seen.add(url);
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        }
        if (i < cards.length) setTimeout(step, 120);
      };
      step();
    }

    /* ================= cache management ================= */
    async cacheStats() {
      let sets = 0;
      try { sets = (await this.sets()).length; } catch (e) {}
      return {
        cards: await this.db.count(STORES.cards),
        names: await this.db.count(STORES.names),
        sets,
        hits: this.stats.hits, misses: this.stats.misses, requests: this.stats.requests,
      };
    }
    async clearCache() {
      for (const s of Object.values(STORES)) await this.db.clear(s);
      this.db.mem.clear();
    }
  }

  MTG.scry = new Scryfall();

  /* ---------------- a game in progress ----------------
     Kept in IndexedDB rather than localStorage: a snapshot carries whole
     card objects, which is hundreds of kilobytes, and losing a game to a
     full quota would be a poor trade. */
  MTG.savedGame = {
    async write(payload) {
      payload.savedAt = Date.now();
      // one entry per distinct card, so sixty Forests cost one card's worth
      const dict = {};
      for (const o of payload.snap.objs) {
        if (!o.card) continue;
        const key = o.card.id || o.card.name;
        if (!dict[key]) dict[key] = o.card;
        o.cardKey = key;
        delete o.card;
      }
      payload.cards = dict;
      try { await MTG.scry.db.put('games', 'current', payload); return true; }
      catch (e) { return false; }
    },
    async read() {
      let p;
      try { p = await MTG.scry.db.get('games', 'current'); } catch (e) { return null; }
      if (!p || !p.snap) return null;
      for (const o of p.snap.objs) {
        if (o.cardKey && p.cards) { o.card = p.cards[o.cardKey]; delete o.cardKey; }
      }
      return p;
    },
    async clear() { try { await MTG.scry.db.clear('games'); } catch (e) {} },
  };
})(window.MTG);


