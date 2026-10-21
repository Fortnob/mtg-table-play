/* ===== 07c-jumpstart.js ===== */
/* ============================================================
   07c-jumpstart.js - Jumpstart: two half-decks shuffled together
   A half-deck is twenty cards on a theme in one colour: about eight lands
   and twelve spells. Each player is offered three, takes one, is offered
   three more and takes another, and the forty cards are the deck; nobody
   builds anything. The real half-decks of the Jumpstart products come from
   MTGJSON, which keeps the lists the Store's Commander decks come from
   too; with no connection to it, or from any other set, the half-decks are
   made from the set's own cards.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const MTGJSON = 'https://mtgjson.com/api/v5/';
  const LIST_KEY = 'jumpstart:list';
  const LIST_TTL = 7 * 864e5;
  const HALF = 20;
  const RARE = { mythic: 4, rare: 3, special: 3, bonus: 3, uncommon: 2, common: 1 };

  const frontType = (c) => String((c && c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || (c && c.type_line) || '');
  const isLandCard = (c) => /\bLand\b/.test(frontType(c));
  const isCreature = (c) => /\bCreature\b/.test(frontType(c));
  const coloursOf = (c) => {
    const f = c.card_faces && c.card_faces[0];
    return c.colors && c.colors.length ? c.colors : (f && f.colors && f.colors.length ? f.colors : (c.color_identity || []));
  };
  /** How good a card is to play, by the bots' judge, which also marks down what the table cannot run by itself. */
  const ratingOf = (c) => (MTG.bots && MTG.bots.rateCard ? MTG.bots.rateCard(c, { limited: true, prior: 0.3 }) : (RARE[c.rarity] || 1));

  /* ---------------- the real half-decks ---------------- */

  let productsMemo = null;
  /**
   * The Jumpstart products MTGJSON lists, newest first: { code, name, date,
   * halves: [{ name, file }] }. The list is kept for a week.
   */
  async function products() {
    if (productsMemo) return productsMemo;
    const hit = await MTG.scry.db.get('meta', LIST_KEY);
    let list = hit && hit.list && hit.list.length && Date.now() - hit.t < LIST_TTL ? hit.list : null;
    if (!list) {
      try {
        const res = await fetch(MTGJSON + 'DeckList.json');
        if (!res.ok) throw new Error('The Jumpstart half-deck lists could not be loaded.');
        const d = await res.json();
        const by = new Map();
        for (const x of (d.data || [])) {
          if (!/^jumpstart$/i.test(x.type || '') || !x.fileName) continue;
          const code = String(x.code || '').toUpperCase();
          if (!by.has(code)) by.set(code, { code, date: x.releaseDate || '', halves: [] });
          const p = by.get(code);
          // a product reprinted later keeps the date it first came out
          if (x.releaseDate && (!p.date || x.releaseDate < p.date)) p.date = x.releaseDate;
          p.halves.push({ name: x.name, file: x.fileName });
        }
        list = Array.from(by.values()).filter(p => p.halves.length >= 6).sort((a, b) => b.date.localeCompare(a.date));
        if (!list.length) throw new Error('MTGJSON lists no Jumpstart half-decks.');
        await MTG.scry.db.put('meta', LIST_KEY, { t: Date.now(), list });
      } catch (e) {
        // an old list is better than none
        if (hit && hit.list && hit.list.length) list = hit.list; else throw e;
      }
    }
    const sets = await MTG.scry.sets().catch(() => []);
    for (const p of list) {
      const s = sets.find(x => x.code === p.code.toLowerCase());
      p.name = s ? (/jumpstart/i.test(s.name) ? s.name : s.name + ' Jumpstart') : p.code + ' Jumpstart';
    }
    productsMemo = list;
    return list;
  }

  /** The product to deal from when nobody says: the newest of the big ones (a hundred and more half-decks). */
  function defaultProduct(list) {
    return (list || []).find(p => p.halves.length >= 100) || (list || [])[0] || null;
  }

  /** "Angels (1)" and "Infantry 2" are the Angels and Infantry themes. */
  function themeOf(name) {
    return String(name || '').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+\d+\s*$/, '').trim() || String(name || '');
  }

  /** A real half-deck before its cards are known. */
  const halfFromList = (h, code) => ({ key: code + ':' + h.file, file: h.file, name: h.name, theme: themeOf(h.name), product: code });

  /** A half-deck's list as MTGJSON gives it: [{ id, name, q }], kept once fetched. */
  async function rowsOf(h) {
    const key = 'jumpstart:half:' + h.file;
    const hit = await MTG.scry.db.get('meta', key);
    if (hit && hit.rows && hit.rows.length) return hit.rows;
    const res = await fetch(MTGJSON + 'decks/' + encodeURIComponent(h.file) + '.json');
    if (!res.ok) throw new Error(`${h.name} could not be loaded.`);
    const j = await res.json();
    const rows = (((j && j.data) || {}).mainBoard || []).map(c => ({
      id: (c.identifiers && c.identifiers.scryfallId) || null, name: c.name, q: Math.max(1, c.count || 1),
    }));
    if (rows.length) await MTG.scry.db.put('meta', key, { t: Date.now(), rows });
    return rows;
  }

  /**
   * Fetch the cards of these half-decks: their lists (four at a time), then
   * every card in one lookup. A half-deck that cannot be had is marked
   * `failed` rather than thrown, so another can be offered in its place.
   */
  async function resolveAll(halves) {
    const need = (halves || []).filter(h => !h.cards && !h.failed);
    if (!need.length) return;
    let next = 0;
    const work = async () => {
      while (next < need.length) {
        const h = need[next++];
        try { if (!h.rows) h.rows = await rowsOf(h); } catch (e) { h.failed = true; }
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    const ok = need.filter(h => h.rows && h.rows.length);
    const at = [];
    for (const h of ok) for (const r of h.rows) at.push([h, r]);
    let found = [];
    try { found = ((await MTG.scry.collection(at.map(([, r]) => (r.id ? { id: r.id } : { name: r.name })))) || {}).cards || []; }
    catch (e) { found = []; }
    // a printing Scryfall does not know is looked for by its name
    const missing = at.map((x, k) => k).filter(k => !found[k] && at[k][1].name);
    if (missing.length) {
      try {
        const again = ((await MTG.scry.collection(missing.map(k => ({ name: at[k][1].name })))) || {}).cards || [];
        missing.forEach((k, i) => { if (again[i]) found[k] = again[i]; });
      } catch (e) { /* those cards stay missing */ }
    }
    for (const h of ok) h.cards = [];
    at.forEach(([h, r], k) => {
      const c = found[k];
      if (!c) return;
      const e = h.cards.find(x => x.card.id === c.id);
      if (e) e.qty += r.q; else h.cards.push({ card: c, qty: r.q });
    });
    for (const h of need) {
      // most of a list is a half-deck still; a few cards is not
      if (!h.cards || U.sum(h.cards.map(e => e.qty)) < HALF * 0.75) { h.cards = undefined; h.failed = true; continue; }
      finish(h);
    }
  }

  /** What a half-deck shows: its colours, its lands, the card on its front, and its list in reading order. */
  function finish(h) {
    const spells = h.cards.filter(e => !isLandCard(e.card));
    const cols = new Set();
    for (const e of spells) for (const c of coloursOf(e.card)) cols.add(c);
    h.colors = MTG.mana.COLORS.filter(c => cols.has(c));
    h.lands = U.sum(h.cards.filter(e => isLandCard(e.card)).map(e => e.qty));
    h.size = U.sum(h.cards.map(e => e.qty));
    h.feature = spells.map(e => e.card).sort((x, y) => (RARE[y.rarity] || 1) - (RARE[x.rarity] || 1) || (y.cmc || 0) - (x.cmc || 0))[0]
      || (h.cards[0] && h.cards[0].card) || null;
    const rank = (c) => (MTG.sealed ? MTG.sealed.typeRank(c) : (isLandCard(c) ? 9 : isCreature(c) ? 0 : 1));
    h.cards.sort((x, y) => rank(x.card) - rank(y.card) || MTG.mana.sortMv(x.card) - MTG.mana.sortMv(y.card) || String(x.card.name).localeCompare(String(y.card.name)));
    return h;
  }

  /* ---------------- half-decks made from a set ----------------
     A colour, a theme inside it (a creature type with enough of them, or
     a keyword the colour has plenty of), twelve spells with a curve and
     about seven creatures, a rare, three uncommons, and eight basic lands.
     Two of each, differently shuffled, so a theme can turn up twice the
     way the printed ones do. */

  const PLURAL = { Elf: 'Elves', Dwarf: 'Dwarves', Wolf: 'Wolves', Werewolf: 'Werewolves', Fish: 'Fish', Sheep: 'Sheep',
    Ox: 'Oxen', Mouse: 'Mice', Pegasus: 'Pegasi', Cyclops: 'Cyclopes', Phoenix: 'Phoenixes', Sphinx: 'Sphinxes',
    Fox: 'Foxes', Faerie: 'Faeries', Ally: 'Allies', Djinn: 'Djinn', Efreet: 'Efreet', Kor: 'Kor', Moonfolk: 'Moonfolk',
    Merfolk: 'Merfolk', Kithkin: 'Kithkin', Vedalken: 'Vedalken', Viashino: 'Viashino', Leonin: 'Leonin', Aetherborn: 'Aetherborn',
    Samurai: 'Samurai', Elk: 'Elk', Deer: 'Deer', Aven: 'Aven', Naga: 'Naga', Eldrazi: 'Eldrazi', Kavu: 'Kavu', Kirin: 'Kirin',
    Fungus: 'Fungi', Homunculus: 'Homunculi', Locus: 'Loci' };
  const plural = (t) => PLURAL[t] || (/(s|x|ch|sh)$/.test(t) ? t + 'es' : /[^aeiou]y$/.test(t) ? t.slice(0, -1) + 'ies' : t + 's');
  const KW_LABEL = { Flying: 'Fliers', Trample: 'Stompers', Equip: 'Armed', Ward: 'Warded', Defender: 'Walls',
    Mill: 'Milling', 'First strike': 'First Strike', 'Double strike': 'Double Strike' };
  // too broad to make a theme of, or not a theme at all
  const NOT_A_TRIBE = new Set(['Human', 'Equipment', 'Vehicle', 'Aura']);
  const NOT_A_THEME = new Set(['Enchant', 'Transform', 'Fight', 'Scry', 'Flip', 'Meld']);
  const COLOUR_WORD = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

  function creatureTypes(c) {
    const parts = frontType(c).split(/\s+[—-]\s+/);
    return isCreature(c) && parts.length > 1 ? parts[1].split(/\s+/).filter(Boolean) : [];
  }

  /** The themes a colour of a set has room for, best first, at most three. */
  function themesOf(mono, col) {
    const out = [];
    const tribes = new Map();
    for (const c of mono) for (const t of creatureTypes(c)) tribes.set(t, (tribes.get(t) || 0) + 1);
    const words = (t) => new RegExp('\\b(?:' + t + '|' + plural(t) + ')\\b');
    // a card that cares about the type counts for it too ("Elves you control get +1/+1")
    for (const [t, n] of tribes) {
      const re = words(t);
      tribes.set(t, n + 0.5 * mono.filter(c => !creatureTypes(c).includes(t) && re.test(c.oracle_text || '')).length);
    }
    for (const [t] of Array.from(tribes).filter(([t, n]) => n >= 4 && !NOT_A_TRIBE.has(t)).sort((a, b) => b[1] - a[1]).slice(0, 2)) {
      const re = words(t);
      out.push({ id: 'type:' + t, label: plural(t), fits: (c) => creatureTypes(c).includes(t) || re.test(c.oracle_text || '') });
    }
    const kws = new Map();
    for (const c of mono) for (const k of (c.keywords || [])) if (!NOT_A_THEME.has(k)) kws.set(k, (kws.get(k) || 0) + 1);
    for (const [k] of Array.from(kws).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 3 - out.length)) {
      const re = new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      out.push({ id: 'kw:' + k, label: KW_LABEL[k] || k, fits: (c) => (c.keywords || []).includes(k) || re.test(c.oracle_text || '') });
    }
    if (out.length < 2) out.push({ id: 'colour', label: COLOUR_WORD[col], fits: () => false });
    return out.slice(0, 3);
  }

  /**
   * Twelve spells for a theme: the theme's cards and the colour's best,
   * a little shuffled, at most one rare and three uncommons, along a curve,
   * creatures first; colourless cards fill in, two at most.
   */
  function pickSpells(mono, grey, theme, rng) {
    const noisy = new Map();
    const score = (c) => {
      if (!noisy.has(c)) noisy.set(c, ratingOf(c) + (theme.fits(c) ? 1.6 : 0) + (rng.next() - 0.5) * 1.6);
      return noisy.get(c);
    };
    const cands = mono.concat(grey).filter(c => ratingOf(c) > 0.5).sort((a, b) => score(b) - score(a));
    const tier = (c) => (RARE[c.rarity] >= 3 ? 'rare' : c.rarity === 'uncommon' ? 'uncommon' : 'common');
    const CAPS = { rare: 1, uncommon: 3 };
    const CURVE = [2, 3, 3, 2, 2, 1];    // mana value 0-1, 2, 3, 4, 5, 6 and up
    const slot = (c) => Math.min(5, Math.max(0, Math.floor(c.cmc || 0) - 1));
    const out = [];
    const count = (fn) => out.filter(fn).length;
    const fits = (c, strict) => {
      if (out.includes(c)) return false;
      if (grey.includes(c) && count(x => grey.includes(x)) >= 2) return false;
      if (!strict) return true;
      const r = tier(c);
      if (CAPS[r] != null && count(x => tier(x) === r) >= CAPS[r]) return false;
      return count(x => slot(x) === slot(c)) < CURVE[slot(c)];
    };
    for (const c of cands) { if (out.length >= 12 || count(isCreature) >= 7) break; if (isCreature(c) && fits(c, true)) out.push(c); }
    for (const c of cands) { if (out.length >= 12) break; if (fits(c, true)) out.push(c); }
    for (const c of cands) { if (out.length >= 12) break; if (fits(c, false)) out.push(c); }
    return out;
  }

  /** Half-decks made from a set's cards, seeded so a table made twice is the same table. */
  function makeHalves(pool, basics, rng, code) {
    const playable = (pool.playable || []).filter(c => !isLandCard(c) && !(MTG.draft && MTG.draft.isConspiracy(c)));
    const grey = playable.filter(c => !(c.color_identity || []).length);
    const out = [];
    for (const col of MTG.mana.COLORS) {
      const land = basics[col];
      if (!land) continue;
      const mono = playable.filter(c => (c.color_identity || []).length === 1 && c.color_identity[0] === col);
      if (mono.length < 14) continue;
      for (const theme of themesOf(mono, col)) {
        let made = 0;
        for (let v = 1; v <= 2; v++) {
          const spells = pickSpells(mono, grey, theme, rng);
          if (spells.length < 10) continue;
          const ids = spells.map(c => c.id).sort().join();
          if (out.some(h => h._ids === ids)) continue;
          made++;
          const h = {
            key: `${code}:${col}:${theme.id}:${made}`, theme: theme.label, colour: col, n: made,
            product: String(code).toUpperCase(), made: true, _ids: ids,
            cards: spells.map(c => ({ card: c, qty: 1 })).concat([{ card: land, qty: HALF - spells.length }]),
          };
          out.push(finish(h));
        }
      }
    }
    /* A theme two colours share ("Fliers") says which colour it is, so
       every half-deck from a set has a name of its own, as printed ones do. */
    const colours = new Map();
    for (const h of out) colours.set(h.theme, (colours.get(h.theme) || new Set()).add(h.colour));
    for (const h of out) {
      if (colours.get(h.theme).size > 1) h.theme = COLOUR_WORD[h.colour] + ' ' + h.theme;
      h.name = `${h.theme} (${h.n})`;
    }
    return out;
  }

  /** Half-decks from one set: its own basic lands where it has them, the usual ones where it does not. */
  async function fromSet(code, rng) {
    const pool = await MTG.scry.setPool(code);
    if (!pool || (pool.playable || []).length < 60) throw new Error(`${String(code).toUpperCase()} has too few cards to make half-decks from.`);
    const plain = await MTG.draft.getBasics().catch(() => ({}));
    const basics = {};
    for (const col of MTG.mana.COLORS) {
      const name = MTG.mana.BASIC_FOR[col];
      basics[col] = (pool.basics || []).find(b => U.normName(b.name) === U.normName(name)) || plain[name] || null;
    }
    const halves = makeHalves(pool, basics, rng, code);
    if (halves.length < 4) throw new Error(`${String(code).toUpperCase()} has too few cards to make half-decks from.`);
    return halves;
  }

  /**
   * The half-decks to deal from. `source`: { product: 'J25' }, a real
   * Jumpstart product; { set: 'fdn' }, half-decks made from a set's own
   * cards; nothing, the newest big product. A product that cannot be
   * loaded (no connection to MTGJSON) falls back to the newest set, as
   * does opts.made. Resolves with { label, source, halves, note }.
   */
  async function catalogue(source, opts) {
    source = source || {};
    opts = opts || {};
    const rng = new MTG.RNG(opts.seed || Date.now());
    let why = '';
    if (!source.set && !opts.made) {
      try {
        const list = await products();
        const want = source.product ? String(source.product).toUpperCase() : '';
        const p = (want && list.find(x => x.code === want)) || defaultProduct(list);
        if (p) return { label: p.name, source: { product: p.code }, halves: p.halves.map(h => halfFromList(h, p.code)), note: '' };
      } catch (e) { why = 'The Jumpstart half-deck lists could not be loaded, so these are made from the newest set.'; }
    }
    let code = source.set;
    let name = '';
    const sets = await MTG.scry.draftableSets().catch(() => []);
    if (!code) {
      const s = sets.find(x => x.set_type === 'expansion' || x.set_type === 'core') || sets[0];
      if (!s) throw new Error('No set could be found to make half-decks from. Check the connection.');
      code = s.code;
    }
    const info = sets.find(x => x.code === String(code).toLowerCase());
    name = info ? info.name : String(code).toUpperCase();
    return { label: `${name}, made into half-decks`, source: { set: String(code).toLowerCase() }, halves: await fromSet(code, rng), note: why };
  }

  /* ---------------- choosing ---------------- */

  /**
   * Three half-decks to choose from: on different themes, none this player
   * has been offered before, and, while the catalogue allows, none that is
   * out in front of anybody else. opts: { n, not (keys seen), busy (keys
   * dealt at the table), themes (to steer clear of) }.
   */
  function offer(halves, rng, opts) {
    opts = opts || {};
    const n = opts.n || 3;
    const not = opts.not || new Set();
    const busy = opts.busy || new Set();
    const themes = new Set(opts.themes || []);
    const deck = rng.shuffle(halves.slice());
    const out = [];
    const take = (pred) => {
      for (const h of deck) {
        if (out.length >= n) return;
        if (out.includes(h) || not.has(h.key) || !pred(h)) continue;
        out.push(h);
        themes.add(h.theme);
      }
    };
    take(h => !busy.has(h.key) && !themes.has(h.theme));
    take(h => !themes.has(h.theme));
    take(() => true);
    return out;
  }

  /** How good a half-deck is to play: the average of its spells, by the bots' judge. */
  function rateHalf(h) {
    let t = 0, n = 0;
    for (const e of (h.cards || [])) {
      if (isLandCard(e.card)) continue;
      t += ratingOf(e.card) * e.qty;
      n += e.qty;
    }
    return n ? t / n : 0;
  }

  /** Which of the offers a bot takes: the best, with a weaker bot's judgement the noisier. */
  function botChoice(offers, rng, difficulty) {
    const d = U.clamp(difficulty || 5, 1, 10);
    const noise = 1.9 - d * 0.18;
    let best = 0, bestV = -Infinity;
    offers.forEach((h, i) => {
      const v = rateHalf(h) * 2 + (rng.next() - 0.5) * noise * 2;
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  /**
   * Two half-decks, shuffled together: the deck. A half that came short
   * (a card Scryfall no longer has) is made up with its own basic lands.
   */
  function deckOf(a, b, opts) {
    opts = opts || {};
    const size = opts.deckSize || HALF * 2;
    const main = [];
    const add = (card, qty) => {
      const e = main.find(x => x.card.id === card.id);
      if (e) e.qty += qty; else main.push({ card, qty });
    };
    for (const h of [a, b]) for (const e of h.cards) add(e.card, e.qty);
    const colours = MTG.mana.COLORS.filter(c => a.colors.includes(c) || b.colors.includes(c));
    const basics = opts.basicCards || {};
    let have = U.sum(main.map(e => e.qty));
    for (let i = 0; have < size && i < 40; i++) {
      const col = colours.length ? colours[i % colours.length] : null;
      const card = col ? basics[MTG.mana.BASIC_FOR[col]] : null;
      if (!card) break;
      add(card, 1);
      have++;
    }
    return {
      id: MTG.uid('deck'), name: `${a.theme} + ${b.theme}`, format: opts.formatId || 'jumpstart',
      main, sideboard: [], commanders: [], colors: colours, createdAt: Date.now(), source: 'jumpstart',
      halves: [a.name, b.name],
    };
  }

  /**
   * A table choosing half-decks. Each seat is offered three, takes one, is
   * offered three more and takes another, then says it is ready. The host
   * runs it: bots choose at once, people when they like (choose, ready).
   * Emits 'change' whenever a seat's view changes, and 'done' once every
   * seat has its deck and is ready to play.
   * cfg: { halves, label, note, seats: [{ id, name, isBot, difficulty }], seed, basicCards, formatId }.
   */
  class Table extends MTG.Emitter {
    constructor(cfg) {
      super();
      this.halves = (cfg.halves || []).slice();
      this.label = cfg.label || '';
      this.note = cfg.note || '';
      this.formatId = cfg.formatId || 'jumpstart';
      this.basics = cfg.basicCards || {};
      this.rng = new MTG.RNG(cfg.seed || Date.now());
      this.dealt = new Set();
      this.finished = false;
      this.seats = (cfg.seats || []).map(s => ({
        id: s.id, name: s.name || String(s.id), isBot: !!s.isBot, difficulty: s.difficulty || 5,
        stage: 0, offers: [], picks: [], seen: new Set(), deck: null, ready: !!s.isBot, busy: false,
      }));
    }
    _seat(id) { return this.seats.find(s => s.id === id) || null; }

    _deal(s) {
      s.offers = offer(this.halves.filter(h => !h.failed), this.rng, { not: s.seen, busy: this.dealt });
      for (const h of s.offers) { s.seen.add(h.key); this.dealt.add(h.key); }
    }

    /**
     * Fetch what these seats are being offered. A half-deck that will not
     * load is replaced by another; with nothing loading at all, the ones
     * already fetched for somebody else are offered again.
     */
    async _load(seats) {
      for (let tries = 0; tries < 3; tries++) {
        await resolveAll([].concat(...seats.map(s => s.offers)));
        let short = false;
        for (const s of seats) {
          if (!s.offers.some(h => h.failed)) continue;
          short = true;
          s.offers = s.offers.filter(h => !h.failed);
          const more = offer(this.halves.filter(h => !h.failed), this.rng,
            { n: 3 - s.offers.length, not: s.seen, busy: this.dealt, themes: s.offers.map(h => h.theme) });
          for (const h of more) { s.seen.add(h.key); this.dealt.add(h.key); s.offers.push(h); }
        }
        if (!short) break;
      }
      for (const s of seats) {
        s.offers = s.offers.filter(h => h.cards);
        if (s.offers.length) continue;
        const taken = new Set(s.picks.map(h => h.key));
        s.offers = offer(this.halves.filter(h => h.cards && !taken.has(h.key)), this.rng, {});
        if (!s.offers.length) throw new Error('The half-decks could not be loaded. Check the connection and try again.');
      }
    }

    /** Deal everyone their first three, and let the bots choose both their halves. */
    async begin() {
      for (const s of this.seats) { this._deal(s); s.stage = 1; }
      await this._load(this.seats);
      this.emit('change');
      const bots = this.seats.filter(s => s.isBot);
      for (const s of bots) { this._take(s, botChoice(s.offers, this.rng, s.difficulty)); this._deal(s); }
      if (bots.length) await this._load(bots);
      for (const s of bots) this._take(s, botChoice(s.offers, this.rng, s.difficulty));
      this.emit('change');
      this._check();
    }

    _take(s, i) {
      s.picks.push(s.offers[i]);
      s.offers = [];
      if (s.picks.length < 2) { s.stage = 2; return; }
      s.deck = deckOf(s.picks[0], s.picks[1], { basicCards: this.basics, formatId: this.formatId });
      s.stage = 3;
    }

    /** A person takes one of the three in front of them. Resolves whether it counted. */
    async choose(seatId, index) {
      const s = this._seat(seatId);
      const i = Number(index);
      if (!s || s.busy || this.finished || (s.stage !== 1 && s.stage !== 2) || !Number.isInteger(i) || !s.offers[i]) return false;
      s.busy = true;
      try {
        this._take(s, i);
        if (s.stage === 2) {
          this._deal(s);
          this.emit('change');
          await this._load([s]);
        }
      } finally { s.busy = false; }
      this.emit('change');
      this._check();
      return true;
    }

    /** A person has looked at their deck and wants to play. */
    ready(seatId) {
      const s = this._seat(seatId);
      if (!s || !s.deck || s.ready) return false;
      s.ready = true;
      this.emit('change');
      this._check();
      return true;
    }

    /** Somebody left before choosing: the table no longer waits for them. */
    drop(seatId) {
      this.seats = this.seats.filter(s => s.id !== seatId);
      this._check();
    }

    _check() {
      if (this.finished || !this.seats.every(s => s.deck && s.ready)) return;
      this.finished = true;
      this.emit('done');
    }

    deckFor(seatId) { const s = this._seat(seatId); return s ? s.deck : null; }

    /** What one seat sees: its offers or its halves, and how far everybody else has got. */
    viewFor(seatId) {
      const s = this._seat(seatId);
      const half = (h) => (h && h.cards ? {
        key: h.key, name: h.name, theme: h.theme, colors: h.colors, feature: h.feature,
        cards: h.cards, lands: h.lands, size: h.size, made: !!h.made,
      } : null);
      return {
        kind: 'jumpstart', you: seatId, formatId: this.formatId, label: this.label, note: this.note,
        stage: s ? s.stage : 0, busy: !!(s && s.busy),
        offers: s && !s.busy ? s.offers.map(half).filter(Boolean) : [],
        picks: s ? s.picks.map(half).filter(Boolean) : [],
        deck: s && s.deck ? { name: s.deck.name, colors: s.deck.colors, main: s.deck.main } : null,
        ready: !!(s && s.ready), finished: this.finished,
        seats: this.seats.map(x => ({ id: x.id, name: x.name, isBot: x.isBot, picks: x.picks.length, ready: x.ready })),
      };
    }
  }

  MTG.jumpstart = {
    products, defaultProduct, catalogue, resolveAll, themeOf, fromSet, makeHalves,
    offer, rateHalf, botChoice, deckOf, Table, HALF,
  };
})(window.MTG);
