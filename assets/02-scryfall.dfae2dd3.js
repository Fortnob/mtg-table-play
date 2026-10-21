/* ===== 02-scryfall.js ===== */
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
    constructor(minGap, slowGap) {
      this.gap = minGap; this.slowGap = slowGap || minGap; this.last = 0; this.lastSlow = 0; this.chain = Promise.resolve(); this.pending = 0;
      this.asked = 0;          // requests someone is waiting on, queued or under way
      this.later = [];         // requests nobody is waiting on (pack art, a token's picture), in the order asked
      this.laterBusy = false;
    }
    /* A request given an AbortSignal that fires while it queues (a search
       for "gob" once "goblin" is typed) drops out without being sent, and
       one already sent is cut off, so the search wanted is not left
       waiting its turn behind it. The slow endpoints are spaced from each
       other, not from every quick lookup in between.
       `low`: nobody is waiting on it. It goes only when no other request
       is queued, one at a time, so a search the player typed waits behind
       one of these at most, never behind a shelf of them. */
    run(fn, slow, signal, low) {
      if (low) {
        return new Promise((res, rej) => { this.later.push({ fn, slow, signal, res, rej }); this._pumpLater(); });
      }
      this.asked++;
      const p = this._enqueue(fn, slow, signal);
      const done = () => { this.asked--; this._pumpLater(); };
      p.then(done, done);
      return p;
    }
    _pumpLater() {
      if (this.laterBusy || this.asked > 0 || !this.later.length) return;
      const j = this.later.shift();
      this.laterBusy = true;
      const done = () => { this.laterBusy = false; this._pumpLater(); };
      this._enqueue(j.fn, j.slow, j.signal).then((v) => { done(); j.res(v); }, (e) => { done(); j.rej(e); });
    }
    _enqueue(fn, slow, signal) {
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

  /* Never sold, nor folded into anything: Through the Omenpaths (and its
     bonus sheet) is the digital stand-in for Marvel's Spider-Man, which is
     here as itself. */
  const NOT_SOLD = new Set(['om1', 'omb']);

  /* Never in the card pool: the nine cards that play for ante, banned in
     every format and meaningless in a game not played for keeps. No
     search, pack, draft, Collector Booster or suggestion turns one up;
     asked for by name or id (a deck that already has one) it is still
     found, so nothing that loads breaks. */
  const ANTE = new Set(['Amulet of Quoz', 'Bronze Tablet', 'Contract from Below', 'Darkpact', 'Demonic Attorney',
    'Jeweled Bird', 'Rebirth', 'Tempest Efreet', 'Timmerian Fiends']);
  const isAnte = (c) => !!c && (ANTE.has(c.name) || /\bplaying for ante\b/i.test(c.oracle_text || ''));

  /* ---------------- joke and playtest cards ----------------
     Not part of this game: the Un-sets and every other card made as a
     joke or a playtest. None of them is found, offered, opened, drafted,
     bought, suggested, generated or played. A deck or a collection that
     already holds one keeps it, marked as not in the game
     (MTG.formats.validate), and it cannot be added again.

     A printing is a joke's (jokePrint) when Scryfall says so: its set is
     of the "funny" kind (Unglued, Unhinged, Unstable, Unsanctioned,
     Unfinity and its sticker sheets, Unknown Event, the Mystery Booster
     playtest cards, The List's Unfinity Foil Edition, the Heroes of the
     Realm, holiday and convention jokes) or one of those sets' own token
     and promo sets; or it has the acorn stamp, a silver border, or the
     "playtest" promo type (Mystery Booster 2's playtest cards, MagicFest's).
     A card is out when it has no printing but those, or none but those
     and reprint lists, Secret Lairs and oversized prizes (OUT_ELSEWHERE:
     Space Beleren on The List, Comet, Stellar Pup in Mystery Booster 2,
     Clown Car…). A card printed for real too stays, without its joke
     printings (STAYS: the shock lands, Saw in Half in Bloomburrow
     Commander, Steamflogger Boss from Future Sight).

     The one exception: Unfinity's full-art galaxy basic lands stay, as art
     to choose for the basics. Both lists were worked out from Scryfall
     (all printings of every card ever printed in such a set, October 2026);
     tools/cardtests/52-no-jokes.js checks them against the bulk file.
     The card database (src/02a-carddb.js) works the same out of every
     printing it has. */
  const JOKE_SETS = new Set(['ugl', 'unh', 'ust', 'und', 'unf', 'sunf', 'ulst', 'unk', 'punk', 'cmb1', 'cmb2',
    'h17', 'hho', 'ptg', 'phtr', 'ph17', 'ph18', 'ph19', 'ph20', 'ph21', 'ph22', 'ph23',
    // the joke sets' own tokens and promos
    'tugl', 'punh', 'tust', 'pust', 'tund', 'tunf']);
  const UNFINITY = new Set(['unf', 'sunf', 'tunf', 'ulst']);
  // printings that do not make a joke card a real one: reprint lists, Secret Lairs, Astral cards (and oversized prizes, by set type)
  const REPRINT_ONLY = new Set(['plst', 'plist', 'mb1', 'mb2', 'fmb1', 'sld', 'slc', 'sld2', 'slz', 'pz1', 'pz2', 'past']);
  // out though printed outside the joke sets: on reprint lists, in Secret Lairs, as oversized prizes
  const OUT_ELSEWHERE = new Map([
    ['89e90361-822f-42b6-9ed9-d94e6d24fb95', ['unf', 'Attempted Murder']],     // The List
    ['41dd29b9-f08d-4ccc-8dc0-da11d2d456e9', ['ugl', 'Blacker Lotus']],     // Secret Lair, oversized
    ['252ff28e-3ea7-4e2c-a30c-3cb80aa278d0', ['mb2', 'Call from the Grave']],     // playtest; Astral
    ['e0a6947f-3d52-45e0-8fd7-0bc07cc8c784', ['unf', 'Clown Car']],     // The List, The Zeta Set
    ['e7c67480-1816-4071-9eab-a1d1b535a344', ['unf', 'Comet, Stellar Pup']],     // Mystery Booster 2
    ['a55ef412-257b-4ecd-9440-4545521be938', ['unf', 'Exchange of Words']],     // The List
    ['35caa378-440d-41a1-8ce4-174bfb7c16ac', ['ugl', 'Incoming!']],     // oversized
    ['e88f6b45-0cde-4fd4-80f0-f252f6fd59fa', ['ugl', 'Infernal Spawn of Evil']],     // oversized
    ['f0ba392b-fd12-441c-a68b-a53dffe27f7f', ['ugl', 'Mirror Mirror']],     // oversized
    ['cfca44cb-8ca5-4ebb-bd5c-b621eca41944', ['unf', 'Space Beleren']],     // The List
    ['8673cc01-7d5d-41ee-aede-f21efc74216c', ['ugl', 'Squirrel Farm']],     // oversized
  ]);
  // printed in a joke set and for real too: in the game, without the joke printings
  const STAYS = new Map([
    ['43985bbc-a0f6-4812-984e-392bc8562633', 'Blood Crypt'], ['20283c4a-f1f0-42f0-bc08-6da87474426b', 'Breeding Pool'],
    ['73864fcc-1bde-4bc0-831e-2b93e546e417', 'Godless Shrine'], ['f1750962-a87c-49f6-b731-02ae971ac6ea', 'Hallowed Fountain'],
    ['975ec9a3-6f20-4177-8211-82526e092538', 'Overgrown Tomb'], ['45181cb8-2090-4471-ba90-e5a8f04d525f', 'Sacred Foundry'],
    ['17039058-822d-409f-938c-b727a366ba63', 'Steam Vents'], ['16052b52-ade1-406f-a06b-ce7ea607fb63', 'Stomping Ground'],
    ['f413a83d-a40d-434c-b20a-4c707c0527fa', 'Temple Garden'], ['fc9ec820-4245-4a96-b009-5308a818ca58', 'Watery Grave'],
    ['eea18c55-8695-4ba1-9b38-3e7638692f5f', 'Saw in Half'], ['4d614c79-7934-4662-9ce1-22b57d5137f7', 'Steamflogger Boss'],
  ]);
  // the same by name, for what is known by name and set only (a collection's entries)
  const OUT_NAMES = new Map([...OUT_ELSEWHERE.values()].map(([set, name]) => [name, set]));
  const STAY_NAMES = new Set(STAYS.values());
  // what Scryfall is asked along with every search: no joke printing, but Unfinity's basics
  const JOKE_QUERY = '-((is:funny or st:funny or e:tugl or e:punh or e:tust or e:pust or e:tund or e:tunf) -(e:unf t:basic))';
  // words that set how Scryfall shows what it found, which it will not take inside brackets
  const DISPLAY_RE = /(^|\s)(?:unique|order|dir|direction|display|prefer|include):\S+/gi;
  const setOf = (c) => String((c && c.set) || '').toLowerCase();
  const BASIC_NAME = /^(?:Snow-Covered )?(?:Plains|Island|Swamp|Mountain|Forest|Wastes)$/;
  const isBasic = (c) => /\bBasic\b/.test(String(c.type_line || ((c.card_faces || [])[0] || {}).type_line || '').split('//')[0]);
  const isToken = (c) => /token|emblem/.test(c.layout || '') || /^Token\b/.test(c.type_line || '');
  const oracleOf = (c) => c.oracle_id || ((c.card_faces || [])[0] || {}).oracle_id || '';
  /** Whether this printing is a joke's: by its set, its stamp, its border or its promo type. */
  const jokePrint = (c) => !!c && (JOKE_SETS.has(setOf(c)) || c.set_type === 'funny' || c.security_stamp === 'acorn' ||
    c.border_color === 'silver' || (c.promo_types || []).includes('playtest'));
  const J = MTG.jokes = {
    SETS: JOKE_SETS,
    QUERY: JOKE_QUERY,
    /** Whether this set is a joke set (or one of their token and promo sets). */
    isSet: (code) => JOKE_SETS.has(String(code || '').toLowerCase()),
    isPrint: jokePrint,
    REPRINT_ONLY,
    /** Out whatever printing (OUT_ELSEWHERE), in whatever printing (STAYS): by oracle id. */
    outId: (oid) => OUT_ELSEWHERE.has(oid),
    staysId: (oid) => STAYS.has(oid),
    /**
     * Whether this card, whichever printing of it this is, is out of the
     * game. A joke printing says so of its card, unless the card was
     * printed for real too (STAYS, a basic land); the acorn stamp alone
     * does not (Mystery Booster Commander stamps Alchemy's cards with it).
     */
    isCard(c) {
      if (!c) return false;
      const oid = oracleOf(c);
      if (oid ? OUT_ELSEWHERE.has(oid) : OUT_NAMES.has(c.name)) return true;
      if (!jokePrint(c) || (oid ? STAYS.has(oid) : STAY_NAMES.has(c.name)) || isBasic(c) || BASIC_NAME.test(c.name || '')) return false;
      if (isToken(c)) return true;
      return JOKE_SETS.has(setOf(c)) || c.set_type === 'funny' || c.border_color === 'silver' || (c.promo_types || []).includes('playtest');
    },
    /** Whether this printing may be shown: not a joke's, or one of Unfinity's basics. */
    printOk: (c) => !!c && (!jokePrint(c) || (setOf(c) === 'unf' && isBasic(c))),
    /** In the card pool: not a joke card, nor a joke printing of a real one. */
    inPool: (c) => !!c && !J.isCard(c) && J.printOk(c),
    /** A Scryfall query with the jokes left out (the words that say how to show it kept outside the brackets). */
    query(q) {
      q = String(q || '').trim();
      if (q.includes(JOKE_QUERY)) return q;
      const shows = (q.match(DISPLAY_RE) || []).map(s => s.trim());
      const rest = q.replace(DISPLAY_RE, ' ').trim();
      return [rest ? '(' + rest + ')' : '', JOKE_QUERY].concat(shows).filter(Boolean).join(' ');
    },
    /** Why a card held from before is not played, in a few words. */
    why(c) {
      const from = (OUT_ELSEWHERE.get(oracleOf(c)) || [OUT_NAMES.get(c && c.name)])[0] || setOf(c);
      return UNFINITY.has(from) ? 'Unfinity cards aren’t in this game' : 'Joke and playtest cards aren’t in this game';
    },
  };
  /** In the card pool: neither an ante card nor a joke (MTG.jokes). */
  const inPool = (c) => !!c && !isAnte(c) && J.inPool(c);
  const poolOnly = (cards) => (cards || []).filter(inPool);

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
      return this.q.run(() => this._doFetch(path, opts), /\/cards\/(search|named|random|collection)/.test(path), opts.signal, !!opts.low);
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
          // a picture nobody asked for (opts.quiet) is no reason to tell the player Scryfall is down
          if (!opts.quiet) MTG.bus.emit('scryfall:offline');
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
        // the acorn stamp: a joke card's (MTG.jokes)
        security_stamp: c.security_stamp === 'acorn' ? 'acorn' : undefined,
        artist: c.artist, illustration_id: c.illustration_id, flavor_text: c.flavor_text,
        scryfall_uri: c.scryfall_uri, edhrec_rank: c.edhrec_rank, penny_rank: c.penny_rank,
        hand_modifier: c.hand_modifier, life_modifier: c.life_modifier,
        // on Commander's Game Changers list (src/15a-brackets.js)
        game_changer: c.game_changer === true ? true : c.game_changer === false ? false : undefined,
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

    /**
     * A card by its Scryfall id: the card database, then the cache, then
     * Scryfall. opts.cacheOnly: never Scryfall (null instead); opts.low and
     * opts.quiet: see _fetch and _doFetch.
     */
    async byId(id, opts) {
      opts = opts || {};
      if (!id) return null;
      const local = await this._localDb();
      const own = local && local.idx.byIdCard(id);
      if (own) { this.stats.local++; return own; }
      const hit = await this.db.get(STORES.cards, id);
      if (hit) { this.stats.hits++; return hit; }
      if (opts.cacheOnly) return null;
      this.stats.misses++;
      const c = await this._fetch('/cards/' + encodeURIComponent(id), { low: opts.low, quiet: opts.quiet });
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
        try { const cards = local.search(query, opts); this.stats.local++; return poolOnly(cards); }
        catch (e) { if (!(e instanceof local.Unsupported)) throw e; /* beyond the local engine: Scryfall it is */ }
      }
      try { return poolOnly(await this._liveSearch(query, opts, max)); }
      catch (e) {
        if (e && e.stale) throw e;
        // offline with a database that could not answer exactly: its best is better than nothing
        if (local) { try { const cards = local.search(query, opts); this.stats.local++; return poolOnly(cards); } catch (e2) {} }
        throw e;
      }
    }

    /**
     * A search read a page at a time, for a list that scrolls on: each
     * next() gives the next lot, and `done` says when there are no more.
     * opts.order 'colormv': by colour (white, blue, black, red, green, then
     * several colours, then none) and by mana value within each. From the
     * card database when there is one; otherwise from Scryfall a colour at
     * a time, each by mana value, so the order holds from page to page.
     */
    pager(query, opts) {
      opts = Object.assign({ unique: 'cards' }, opts || {});
      const per = opts.per || 60;
      const self = this;
      const colourWise = opts.order === 'colormv';
      const GROUPS = colourWise ? ['c=w', 'c=u', 'c=b', 'c=r', 'c=g', 'c:m', 'c=c'] : [null];
      let mode = null, local = null, ids = null, at = 0;
      let gi = 0, url = null;
      const buf = [], seen = new Set();
      // a colour's X costs, held back to come after the rest of it (Scryfall sorts them by what X is not)
      let held = [];
      const p = {
        done: false,
        /** How many in all, when that is known (from the card database). */
        total: null,
        async next(signal) {
          if (p.done) return [];
          if (!mode) {
            mode = 'live';
            local = await self._localDb(opts);
            if (local && local.answers(query, opts)) {
              try {
                ids = local.idx.query(query, Object.assign({}, opts, { order: opts.order }));
                mode = 'local';
                p.total = ids.length;
                self.stats.local++;
              } catch (e) { if (!(e instanceof local.Unsupported)) throw e; }
            }
          }
          if (mode === 'local') {
            const out = [];
            while (out.length < per && at < ids.length) {
              const c = local.idx.card(ids[at++]);
              if (inPool(c)) out.push(c);
            }
            if (at >= ids.length) p.done = true;
            return out;
          }
          while (buf.length < per && gi < GROUPS.length) {
            if (!url) {
              const g = GROUPS[gi];
              const params = new URLSearchParams({ q: MTG.jokes.query(g ? `(${query}) ${g}` : query), unique: opts.unique,
                order: colourWise ? 'cmc' : (opts.order || 'name') });
              if (opts.dir) params.set('dir', opts.dir);
              url = '/cards/search?' + params.toString();
            }
            const data = await self._fetch(url, { signal });
            const groupDone = () => { gi++; url = null; buf.push(...held); held = []; };
            // nothing in this colour (Scryfall says so with a 404): on to the next
            if (!data) { groupDone(); continue; }
            for (const c of poolOnly(await self._store(data.data || []))) {
              if (seen.has(c.id)) continue;
              seen.add(c.id);
              (colourWise && MTG.mana.hasX(c) ? held : buf).push(c);
            }
            if (data.has_more && data.next_page) url = data.next_page;
            else groupDone();
          }
          const out = buf.splice(0, per);
          if (!buf.length && gi >= GROUPS.length) p.done = true;
          return out;
        },
      };
      return p;
    }

    async _liveSearch(query, opts, max) {
      const params = new URLSearchParams({ q: MTG.jokes.query(query) });
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
        const data = await this._fetch(url, { signal: opts.signal, low: opts.low, quiet: opts.quiet });
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
      if (local) return local.idx.autocomplete(q, 20).filter(n => !ANTE.has(n));
      /* Scryfall's own autocomplete knows nothing of what is left out of the
         pool (MTG.jokes), so the names come from a search that does */
      try {
        const params = new URLSearchParams({ q: MTG.jokes.query('name:"' + String(q).replace(/"/g, '') + '"'), order: 'edhrec' });
        const d = await this._fetch('/cards/search?' + params.toString(), { signal: opts && opts.signal });
        return ((d && d.data) || []).filter(inPool).map(c => c.name).slice(0, 20);
      } catch (e) { return []; }
    }

    async random(query) {
      const local = await this._localDb();
      if (local && local.answers(query || '', {})) {
        try {
          const ids = local.idx.query(query || '-t:basic', {});
          for (let tries = 0; ids.length && tries < 8; tries++) {
            const c = local.idx.card(ids[Math.floor(Math.random() * ids.length)]);
            if (inPool(c)) return c;
          }
        } catch (e) { /* Scryfall can */ }
      }
      for (let tries = 0; tries < 4; tries++) {
        const c = await this._fetch('/cards/random?q=' + encodeURIComponent(MTG.jokes.query(query)));
        if (!c) return null;
        if (inPool(c)) return (await this._store([c]))[0];
      }
      return null;
    }

    /* ================= printings (art selection) ================= */

    /**
     * Every printing of a card, newest first, for the art picker.
     * Keeps art-series cards out; prefers paper printings.
     */
    async printings(card, opts) {
      opts = opts || {};
      /* A printing whose words play differently from the card's today is
         left out, unless the card has no other (src/02d-oldprints.js). */
      const current = (list) => {
        // no joke printing, but Unfinity's basics (MTG.jokes)
        list = list.filter(c => MTG.jokes.printOk(c) || c.id === card.id);
        const ok = MTG.oldPrints ? list.filter(c => !MTG.oldPrints.isOld(c)) : list;
        return ok.length ? ok : list;
      };
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
          if (arr.length) return current(arr);
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
      return current(cards);
    }

    /* ================= sets ================= */

    /** Scryfall's sets, the joke sets left out (nothing of them is drafted, opened or sold). */
    async sets(opts) {
      const all = await this._sets(opts);
      return all.filter(s => s.set_type !== 'funny' && !MTG.jokes.isSet(s.code) && !MTG.jokes.isSet(s.parent_set_code));
    }
    async _sets(opts) {
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
     * The sets the Store sells packs of: the draftable ones, and besides
     * them the Eternal sets (Assassin's Creed and its like) and the digital
     * draft sets (Vintage Masters, the Remastered sets, Jumpstart: Historic
     * Horizons). Newest first, like draftableSets, which drafts and the
     * "newest set" defaults keep using.
     */
    async packSets() {
      const all = (await this.sets()).filter(s => !NOT_SOLD.has(s.code));
      const today = new Date().toISOString().slice(0, 10);
      /* A Commander product made for no set of its own (Fallout, Warhammer
         40,000, Doctor Who) is a world apart: its own packs, rather than
         folded into a set it has nothing in common with. The yearly
         Commander decks are folded in with the sets of their time. */
      const standalone = (s) => s.set_type === 'commander' && !s.parent_set_code &&
        !/^Commander(?: \d{4}| Anthology| Collection|'s Arsenal| Legends)|^Commander$|^Starter Commander/i.test(s.name || '');
      return all
        .filter(s => ['expansion', 'core', 'draft_innovation', 'masters', 'eternal'].includes(s.set_type) || standalone(s))
        // not the Double Features (reprints of their sets in another frame), nor a core set every card of which an older set's packs hold (MTG.coreCovered)
        .filter(s => !/Double Feature/i.test(s.name || '') && !(MTG.coreCovered && MTG.coreCovered.has(s.code)))
        // a hundred cards makes a set worth its own packs; the small early ones (Arabian Nights) were sold in boosters all the same
        .filter(s => (s.card_count >= 100 || (s.card_count >= 70 && (s.released_at || '') < '1997-01-01')) && s.released_at && s.released_at <= today)
        .filter(s => !/Foreign Black Border|^Renaissance$|^Rinascimento$/i.test(s.name || '') && !['ren', 'rin', 'bchr', '4bb', 'fbb'].includes(s.code))
        .sort((a, b) => (b.released_at || '').localeCompare(a.released_at || ''))
        /* An Eternal set made beside a set of its own (The Hobbit Eternal,
           beside The Hobbit) is not sold apart: its cards come in that set's
           packs now and then, as a Commander set's do (packHosts). One with
           no set sold beside it (Assassin's Creed) is sold on its own. */
        .filter((s, i, list) => !(s.set_type === 'eternal' && s.parent_set_code && list.some(x => x.code === s.parent_set_code)));
    }

    /**
     * Cards and printings folded into another set's packs: Commander and
     * Alchemy additions, special subsets, and small expansions. Follow the
     * parent sets to one that is sold; with none, use the paper set of the
     * same time. A Map: host set code to the codes folded into it.
     */
    async packHosts() {
      if (this._hosts && Date.now() - this._hosts.t < 60 * 60 * 1000) return this._hosts.map;
      const all = (await this.sets()).filter(s => !NOT_SOLD.has(s.code));
      const sold = await this.packSets();
      const soldCodes = new Set(sold.map(s => s.code));
      const byCode = new Map(all.map(s => [s.code, s]));
      const paper = sold.filter(s => !s.digital && (s.set_type === 'expansion' || s.set_type === 'core'));
      const today = new Date().toISOString().slice(0, 10);
      const map = new Map();
      for (const s of all) {
        if (soldCodes.has(s.code) || !s.released_at || s.released_at > today) continue;
        const subset = s.set_type === 'masterpiece' || (s.set_type === 'expansion' && s.card_count < 100);
        const folds = subset || s.set_type === 'commander' || s.set_type === 'alchemy' || s.set_type === 'eternal' ||
          (s.digital && !['vanguard', 'memorabilia', 'token', 'minigame', 'funny'].includes(s.set_type));
        if (!folds) continue;
        let host = null;
        for (let p = s.parent_set_code, i = 0; p && i < 6; p = (byCode.get(p) || {}).parent_set_code, i++) {
          if (soldCodes.has(p)) { host = p; break; }
        }
        if (!host && paper.length) {
          const before = paper.find(x => x.released_at <= s.released_at);
          host = (before || paper[paper.length - 1]).code;
        }
        if (!host) continue;
        if (!map.has(host)) map.set(host, []);
        map.get(host).push(s.code);
      }
      this._hosts = { map, t: Date.now() };
      return map;
    }

    /**
     * A card's vintage printings: the old frame (1993 or 1997), on paper,
     * as it first looked or in a retro reprint since. Empty when it has none.
     */
    async vintagePrints(card) {
      const name = U.frontName(card.name).replace(/"/g, '');
      const key = 'vintage:' + U.normName(name);
      const hit = await this.db.get(STORES.meta, key);
      if (hit && Date.now() - hit._t < CACHE_TTL) {
        const m = await this.db.getMany(STORES.cards, hit.ids);
        const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
        if (arr.length === hit.ids.length) return arr;
      }
      const found = await this.search(`!"${name}" (frame:1993 or frame:1997) -is:digital lang:en`, { unique: 'prints', max: 40 }).catch(() => []);
      const list = found.filter(c => c && (c.frame === '1993' || c.frame === '1997') && !c.digital &&
        !(MTG.oldPrints && MTG.oldPrints.isOld(c)));
      await this.db.put(STORES.meta, key, { ids: list.map(c => c.id), _t: Date.now() });
      return list;
    }

    /**
     * The vintage printings of every card in a set, by name (normName of
     * the front face): one search for the whole set, kept, so a pack that
     * turns up a vintage card needs no lookup of its own. Empty when the
     * connection is out and nothing is kept.
     */
    async setVintage(code) {
      code = String(code).toLowerCase();
      this._vint = this._vint || new Map();
      if (this._vint.has(code)) return this._vint.get(code);
      const job = (async () => {
        const key = 'vintageset2:' + code;
        let list = null;
        const hit = await this.db.get(STORES.meta, key);
        if (hit && Date.now() - hit._t < CACHE_TTL) {
          const m = await this.db.getMany(STORES.cards, hit.ids);
          const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
          if (arr.length === hit.ids.length) list = arr;
        }
        if (!list) {
          // the set's own cards and those of the sets folded into its packs
          const kids = (await this.packHosts().catch(() => new Map())).get(code) || [];
          const ins = [code].concat(kids).map(k => 'in:' + k).join(' or ');
          const found = await this.search(`(${ins}) -t:basic (frame:1993 or frame:1997) -is:digital lang:en`, { unique: 'prints', max: 2000 }).catch(() => null);
          if (!found) { this._vint.delete(code); return new Map(); }
          list = found.filter(c => c && (c.frame === '1993' || c.frame === '1997') && !c.digital &&
            !(MTG.oldPrints && MTG.oldPrints.isOld(c)));
          await this.db.put(STORES.meta, key, { ids: list.map(c => c.id), _t: Date.now() });
        }
        const by = new Map();
        for (const c of list) {
          const k = U.normName(U.frontName(c.name));
          if (!by.has(k)) by.set(k, []);
          by.get(k).push(c);
        }
        return by;
      })();
      this._vint.set(code, job);
      return job;
    }

    /**
     * The extra cards a set's packs may hold, bucketed by rarity like a
     * pool: new cards from folded sets and every eligible printing of a
     * subset, plus its own cards that were never in its boosters. Null when
     * there are none.
     */
    async packExtras(code, opts) {
      opts = opts || {};
      code = String(code).toLowerCase();
      const kids = (await this.packHosts()).get(code) || [];
      const sets = await this.sets();
      const byCode = new Map(sets.map(s => [s.code, s]));
      const isSubset = (kid) => {
        const s = byCode.get(kid);
        return !!s && (s.set_type === 'masterpiece' || (s.set_type === 'expansion' && s.card_count < 100));
      };
      // which sets are folded in is part of the key: a change there is a new list
      const key = 'extras3:' + code + ':' + kids.join(',');
      if (!opts.force) {
        const hit = await this.db.get(STORES.meta, key);
        if (hit && Date.now() - hit._t < CACHE_TTL) {
          const m = await this.db.getMany(STORES.cards, hit.ids);
          const arr = hit.ids.map(id => m.get(id)).filter(Boolean);
          if (arr.length === hit.ids.length) return arr.length ? Object.assign(this._bucket(arr), { from: hit.from }) : null;
        }
      }
      const pool = await this.setPool(code).catch(() => null);
      const have = new Set(((pool && pool.all) || []).map(c => c.name));
      const out = [], seen = new Set(), seenPrints = new Set(), from = [];
      const take = (cards, setCode, subset) => {
        let n = 0;
        for (const c of cards) {
          // an Alchemy rebalancing ("A-" and an existing card's name) is not a card of its own
          if (!c || MTG.formats.isBasicLand(c) || /^A-/.test(c.name)) continue;
          if (subset) {
            if (seenPrints.has(c.id)) continue;
            seenPrints.add(c.id);
          } else {
            if (have.has(c.name) || seen.has(c.name)) continue;
            seen.add(c.name);
          }
          out.push(c); n++;
        }
        if (n && setCode) from.push(setCode);
      };
      // its own cards that its boosters never held
      if (pool && !pool.loose) {
        take(await this.search(`set:${code} -is:booster -is:reprint -t:basic`, { unique: 'cards', order: 'set', max: 600 }).catch(() => []), null);
      }
      for (const kid of kids) {
        const subset = isSubset(kid);
        const query = subset ? `set:${kid} -t:basic` : `set:${kid} -is:reprint -t:basic`;
        const found = await this.search(query, {
          unique: subset ? 'prints' : 'cards', order: 'set', max: subset ? 3000 : 1200,
          includeVariations: subset,
        }).catch(() => []);
        take(found, kid, subset);
      }
      await this.db.put(STORES.meta, key, { ids: out.map(c => c.id), from, _t: Date.now() });
      return out.length ? Object.assign(this._bucket(out), { from }) : null;
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
      // is:booster excludes extended-art/promo variants that are not in packs;
      // a digital-only set's cards are all digital, so that is no reason to leave one out
      const digitalSet = !!((await this.sets().catch(() => [])).find(s => s.code === String(code).toLowerCase()) || {}).digital;
      const notDigital = digitalSet ? '' : ' -is:digital';
      let cards = await this.search('set:' + code + ' is:booster' + notDigital + ' lang:en',
        { unique: 'cards', order: 'set', max: 1200, force: opts.force })
        .catch(() => []);
      /* Some sets are not sold in draft boosters at all, so Scryfall marks
         nothing in them `is:booster` and the strict query comes back empty.
         That is not a reason to refuse to draft the set — take the whole set
         and let the collation do its best with it. */
      let loose = false;
      if (cards.length < 20) {
        const wide = await this.search('set:' + code + notDigital + ' lang:en -t:basic',
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
      cards = poolOnly(cards);
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
      // the picture in the language chosen in Options, once it has been found (src/02b-cardlang.js)
      if (this.cardLang) { const own = this.cardLang.imageUrl(card, size, faceIndex); if (own) return own; }
      let url = this._imageUrl(card, size, faceIndex);
      // a picture the usual address would not give, found at Scryfall's own redirect (see retryArt)
      const alts = this._img && this._img.alt;
      const swapped = alts && alts.get(url);
      // judged by the table-sized picture: when that one cannot load, neither will the others
      let probe = !size || size === 'normal' ? url : this._imageUrl(card, 'normal', faceIndex);
      if (swapped) url = swapped;
      const pAlt = alts && alts.get(probe);
      if (pAlt) probe = pAlt;
      // (only a request for that size tries it; the others just take the answer)
      return url && this.imageUsable(probe || url, probe === url ? 'normal' : null) ? url : '';
    }

    /** The same picture asked of Scryfall's own image redirect, for when the CDN address will not give it. */
    _altArtUrl(url) {
      const m = /^https:\/\/cards\.scryfall\.io\/(\w+)\/(front|back)\/\w\/\w\/([0-9a-f-]{36})\./.exec(String(url));
      if (!m) return '';
      return `https://api.scryfall.com/cards/${m[3]}?format=image&version=${m[1]}` + (m[2] === 'back' ? '&face=back' : '');
    }

    /**
     * A picture that would not come is asked for again, and again, a little
     * less often each time (3s, 6s, 12s ... never more than two minutes
     * apart), alternating with Scryfall's own redirect for the same card, for
     * as long as the page is open. `onOk` runs when one arrives; every screen
     * showing words in its place is told to look again ('scryfall:images').
     */
    retryArt(url, onOk) {
      if (!url || typeof Image === 'undefined') return;
      const st = this._img || (this._img = { bad: new Set(), tried: new Set() });
      const jobs = st.retry || (st.retry = new Map());
      const alts = st.alt || (st.alt = new Map());
      let job = jobs.get(url);
      if (job) { if (onOk) job.cbs.push(onOk); return; }
      job = { n: 0, cbs: onOk ? [onOk] : [] };
      jobs.set(url, job);
      const altUrl = this._altArtUrl(url);
      const next = () => {
        const delay = Math.min(120000, 3000 * Math.pow(2, Math.min(job.n, 6)));
        setTimeout(() => {
          // offline: nothing to learn yet, and no reason to count it
          if (typeof navigator !== 'undefined' && navigator.onLine === false) return next();
          const useAlt = !!altUrl && job.n % 2 === 1;
          const target = useAlt ? altUrl : url;
          if (!useAlt) this.forgetArt(url);
          const p = new Image();
          p.decoding = 'async';
          p.onload = () => {
            jobs.delete(url);
            if (useAlt) alts.set(url, altUrl);
            st.bad.delete(url); st.tried.delete(url);
            for (const cb of job.cbs) { try { cb(target); } catch (e) { /* the screen is gone */ } }
            if (!this._imgTell) this._imgTell = U.debounce(() => MTG.bus.emit('scryfall:images'), 200);
            this._imgTell();
          };
          p.onerror = () => { job.n++; next(); };
          p.src = target;
        }, delay);
      };
      next();
    }

    /* --- pictures that will not come ---
       Offline, a card picture is an empty frame. Each table-sized picture is
       tried once in the background (the same request the table makes, so it
       costs nothing extra); one that fails is answered with '' from then on,
       which every screen already reads as "write the card out instead", and
       'scryfall:images' tells whatever is showing it to look again. */
    /**
     * A picture that would not show: dropped from the pictures kept on this
     * device (sw.js), so the next time it is fetched afresh. Nothing happens
     * where there is no worker (Node, a plain http address).
     */
    forgetArt(url) {
      try {
        const sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // offline: the copy kept is not to blame
        if (url && sw && sw.controller) sw.controller.postMessage({ type: 'forget', url: String(url) });
      } catch (e) { /* nothing kept to forget */ }
    }

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
          this.retryArt(url);
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
      /* A printing whose words play differently from the card's today is
         shown as the card's current printing (src/02d-oldprints.js): the
         same card, set and number, only the picture newer. */
      const swap = MTG.oldPrints && MTG.oldPrints.swapId(card);
      if (swap) {
        const back = faceIndex > 0 && card.card_faces && card.card_faces[faceIndex] && card.card_faces[faceIndex].image_uris;
        return `https://cards.scryfall.io/${size}/${back ? 'back' : 'front'}/${swap[0]}/${swap[1]}/${swap}.${size === 'png' ? 'png' : 'jpg'}`;
      }
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
  /** Whether a card is one of the ante cards, left out of the card pool. */
  MTG.scry.isAnte = isAnte;
  /** Whether a card is in the card pool: not an ante card, nor a joke (MTG.jokes). */
  MTG.scry.inPool = inPool;

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
