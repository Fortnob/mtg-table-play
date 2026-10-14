/* ============================================================
   07b-sealed.js - sealed deck: a pool opened, not drafted
   Each player opens six Play Boosters of one set and builds forty cards
   from what was in them, with as many basic lands as they like. The
   boosters are made exactly as a draft makes them (MTG.draft.Draft), so
   the collation, Collector Boosters and the Conspiracy sets' extra slot
   are the same; they are simply never passed.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /**
   * Open every seat's boosters. cfg: { seats: [id], setCode, packs,
   * collector, basicsFree, seed }. Resolves with
   * { seats: { [id]: { packs: [[card]], pool: [card] } }, setsUsed, looseSets }.
   * With no free basic lands, each booster keeps the basic land it was
   * printed with (the slot a draft spends on another card instead).
   */
  async function open(cfg, onProgress) {
    const ids = (cfg.seats || []).slice();
    if (!ids.length) throw new Error('Nobody to open packs for.');
    if (!cfg.setCode) throw new Error('Choose a set to open.');
    const d = new MTG.draft.Draft({
      formatId: 'sealed', seats: ids.length, packs: U.clamp(cfg.packs || 6, 1, 12),
      packSize: 14, packSizeAuto: true, collector: !!cfg.collector,
      setCodes: [cfg.setCode], seed: cfg.seed || Date.now(),
    });
    ids.forEach((id) => d.addSeat({ id, name: String(id), isBot: true }));
    await d.prepare(onProgress);

    let basics = null;
    if (cfg.basicsFree === false) {
      const src = d.roundSources[0] && d.roundSources[0].pool;
      basics = src && src.basics && src.basics.length ? src.basics.slice() : null;
      if (!basics) basics = Object.values(await MTG.draft.getBasics().catch(() => ({})));
    }
    const seats = {};
    ids.forEach((id, i) => {
      const packs = d.roundPacks.map(round => round[i].slice());
      if (basics && basics.length) for (const p of packs) p.push(d.rng.pick(basics));
      seats[id] = { packs, pool: [].concat(...packs) };
    });
    return { seats, setsUsed: d.setsUsed || [], looseSets: d.looseSets || [] };
  }

  /**
   * A deck from a pool, as a bot builds one and as the deck builder starts
   * a person off: the draft's builder (MTG.draft.autoBuildLimited). Without
   * free basic lands the basics opened go in, and then the best of what is
   * left until there are forty, on-colour first.
   */
  function buildDeck(pool, opts) {
    opts = opts || {};
    const free = opts.basicsFree !== false;
    const deck = MTG.draft.autoBuildLimited(pool, Object.assign({}, opts, {
      formatId: opts.formatId || 'sealed', basicCards: free ? (opts.basicCards || {}) : {},
    }));
    deck.source = 'sealed';
    if (!free) fillFromPool(deck, opts.deckSize || 40);
    return deck;
  }

  /** Make a deck up to `size` out of its own sideboard, which is the rest of the pool. */
  function fillFromPool(deck, size) {
    const colours = deck.colors || [];
    const BASIC = MTG.mana.BASIC_FOR;
    const rank = (c) => {
      const a = MTG.oracle.analyze(c) || {};
      if (a.isBasicLand) return colours.some(col => U.normName(BASIC[col]) === U.normName(U.frontName(c.name))) ? 0 : 3;
      if (a.isLand) return 1;
      return (c.color_identity || []).every(x => colours.includes(x)) ? 2 : 4;
    };
    const worth = (c) => (MTG.bots && MTG.bots.rateCard ? MTG.bots.rateCard(c, { limited: true, prior: 0.3 }) : 0);
    const side = deck.sideboard.slice().sort((x, y) => rank(x.card) - rank(y.card) || worth(y.card) - worth(x.card));
    let have = U.sum(deck.main.map(e => e.qty));
    for (const e of side) {
      while (have < size && e.qty > 0) {
        const there = deck.main.find(x => x.card.id === e.card.id);
        if (there) there.qty++; else deck.main.push({ card: e.card, qty: 1 });
        e.qty--; have++;
      }
      if (have >= size) break;
    }
    deck.sideboard = deck.sideboard.filter(e => e.qty > 0);
    return deck;
  }

  /* ---------------- a pool, sorted for building ----------------
     The way you lay out a sealed pool on the table: a column for each
     colour, then gold, colourless and lands, and inside each the
     creatures first and then the rest, cheapest first. */

  const TYPE_RANK = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Battle', 'Land'];
  const COLUMNS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'],
    ['M', 'Multicolour'], ['C', 'Colourless'], ['L', 'Lands']];

  /** Which column a card goes in: a colour letter, M, C, or L. */
  function columnOf(card) {
    const tl = String((card.card_faces && card.card_faces[0] && card.card_faces[0].type_line) || card.type_line || '');
    if (/\bLand\b/.test(tl)) return 'L';
    const ci = card.colors && card.colors.length ? card.colors
      : (card.card_faces && card.card_faces[0] && (card.card_faces[0].colors || []).length ? card.card_faces[0].colors : (card.color_identity || []));
    if (!ci.length) return 'C';
    return ci.length > 1 ? 'M' : ci[0];
  }
  /** A card's place in a column: its main card type, in TYPE_RANK order. */
  function typeRank(card) {
    const tl = String((card.card_faces && card.card_faces[0] && card.card_faces[0].type_line) || card.type_line || '');
    const i = TYPE_RANK.findIndex(t => new RegExp('\\b' + t + '\\b').test(tl));
    return i < 0 ? TYPE_RANK.length : i;
  }
  const byTypeThenCost = (a, b) => typeRank(a) - typeRank(b) || MTG.mana.sortMv(a) - MTG.mana.sortMv(b) || String(a.name).localeCompare(String(b.name));

  /**
   * The pool in columns: [{ key, label, items }], empty columns left out.
   * `cardOf` reads the card from an item, for a list of deck entries.
   */
  function columns(items, cardOf) {
    const get = cardOf || ((x) => x);
    const groups = new Map(COLUMNS.map(([k]) => [k, []]));
    for (const x of items || []) groups.get(columnOf(get(x))).push(x);
    return COLUMNS.filter(([k]) => groups.get(k).length)
      .map(([k, label]) => ({ key: k, label, items: groups.get(k).sort((a, b) => byTypeThenCost(get(a), get(b))) }));
  }

  MTG.sealed = { open, buildDeck, fillFromPool, columns, columnOf, typeRank, TYPE_RANK };
})(window.MTG);
