'use strict';
/* ============================================================
   10c-economy.js - Shards, the collection, wildcards and packs

   The things a player owns, the way MTG Arena keeps them: a balance of
   Shards (earned by playing, spent in the Store), a collection of cards
   counted by name (four of a card is a playset; a fifth turns into
   Shards), wildcards that craft a missing card of their rarity, and
   boosters bought and not yet opened. All of it lives in this browser
   (MTG.store 'economy'), and the screens are src/10d-ui-store.js.

   Basic lands are not collected: everybody has as many as they want.
   ============================================================ */
(function (MTG) {
  const U = MTG.util;
  const KEY = 'economy';
  const RARITIES = ['common', 'uncommon', 'rare', 'mythic'];

  /** What things cost and what they pay, in Shards. */
  const PRICES = { pack: 1000, collector: 2500, dealRare: 1500, dealMythic: 3000 };
  const REWARD = { play: 50, win: 150, firstWin: 250 };
  /** A copy past the fourth is worth this many Shards instead. */
  const DUP_SHARDS = { common: 5, uncommon: 10, rare: 40, mythic: 80 };
  /** A copy of a card is never more than this many in a collection. */
  const PLAYSET = 4;
  /** Every this-many packs opened brings a rare wildcard, and every thirty a mythic one. */
  const WC_TRACK = { rare: 6, mythic: 30 };
  /** What a new player starts with. */
  const START = { shards: 3000, packs: 6, wildcards: { common: 8, uncommon: 6, rare: 3, mythic: 1 } };

  const BASIC = /^(?:Plains|Island|Swamp|Mountain|Forest|Wastes|Snow-Covered (?:Plains|Island|Swamp|Mountain|Forest))$/;
  const isBasic = (name) => BASIC.test(String(name || ''));
  const today = () => new Date().toISOString().slice(0, 10);
  const rarityOf = (c) => {
    const r = String((c && c.rarity) || 'common').toLowerCase();
    return r === 'special' || r === 'bonus' ? 'mythic' : (RARITIES.includes(r) ? r : 'common');
  };
  /** The name a card is collected under: the whole name, both faces. */
  const nameOf = (c) => String((c && c.name) || '');

  let state = null;
  const blank = () => ({
    v: 1, shards: 0, wc: { common: 0, uncommon: 0, rare: 0, mythic: 0 },
    packs: [], col: {}, opened: 0, track: { rare: 0, mythic: 0 },
    lastWinDay: '', deals: null, granted: false, games: 0, wins: 0,
  });
  function load() {
    if (state) return state;
    state = Object.assign(blank(), MTG.store.get(KEY, null) || {});
    state.wc = Object.assign({ common: 0, uncommon: 0, rare: 0, mythic: 0 }, state.wc || {});
    if (!state.granted) grantStart();
    return state;
  }
  function save(why, delta) {
    MTG.store.set(KEY, state);
    if (MTG.bus) MTG.bus.emit('economy:changed', { shards: state.shards, why: why || null, delta: delta || 0 });
  }

  /* ---------------- the start ---------------- */
  /**
   * A new player's welcome: Shards, packs of the newest sets (named when
   * the Store first knows which those are), wildcards, and every card of
   * the starter decks, so there is something to build with from the start.
   */
  function grantStart() {
    state.granted = true;
    state.shards += START.shards;
    for (const r of RARITIES) state.wc[r] += START.wildcards[r] || 0;
    for (let i = 0; i < START.packs; i++) state.packs.push({ id: MTG.uid('pk'), set: null, newest: i < START.packs / 2 ? 0 : 1, kind: 'play', gift: true });
    const best = new Map();
    for (const d of ((MTG.starters && MTG.starters.list) || [])) {
      for (const [n, name] of (d.cards || [])) {
        if (isBasic(name)) continue;
        best.set(name, Math.min(PLAYSET, Math.max(best.get(name) || 0, n)));
      }
    }
    for (const [name, n] of best) state.col[name] = { n };
    state.welcome = true;
    MTG.store.set(KEY, state);
  }

  /* ---------------- Shards ---------------- */
  function addShards(n, why) {
    load();
    n = Math.floor(n) || 0;
    state.shards = Math.max(0, state.shards + n);
    save(why, n);
    return state.shards;
  }
  function spend(n, why) {
    load();
    if (state.shards < n) return false;
    state.shards -= n;
    save(why, -n);
    return true;
  }

  /* ---------------- the collection ---------------- */
  function owned(name) {
    if (isBasic(name)) return Infinity;
    load();
    const e = state.col[name];
    return e ? e.n : 0;
  }
  /**
   * One card into the collection. Returns whether it is new to it, and the
   * Shards a copy past the playset turned into.
   */
  function addCard(card, n) {
    load();
    n = n || 1;
    const name = nameOf(card);
    if (!name || isBasic(name)) return { isNew: false, shards: 0 };
    const e = state.col[name] || (state.col[name] = { n: 0 });
    const isNew = e.n === 0;
    if (card.id && !e.id) e.id = card.id;
    if (card.rarity) e.r = rarityOf(card);
    if (card.set) e.s = card.set;
    const room = Math.max(0, PLAYSET - e.n);
    const kept = Math.min(room, n);
    e.n += kept;
    const extra = n - kept;
    const shards = extra * (DUP_SHARDS[rarityOf(card)] || 5);
    if (shards) state.shards += shards;
    return { isNew, shards };
  }
  function addCards(cards, why) {
    const out = (cards || []).map(c => Object.assign({ card: c }, addCard(c, 1)));
    save(why || 'cards');
    return out;
  }

  /* ---------------- wildcards ---------------- */
  function useWildcard(rarity) {
    load();
    if (!(state.wc[rarity] > 0)) return false;
    state.wc[rarity]--;
    return true;
  }
  /** A missing copy, made with a wildcard of the card's rarity. */
  function craft(card) {
    load();
    const r = rarityOf(card);
    if (owned(nameOf(card)) >= PLAYSET) return { ok: false, why: 'You already have four.' };
    if (!useWildcard(r)) return { ok: false, why: `You have no ${r} wildcards.` };
    addCard(card, 1);
    save('craft');
    return { ok: true, rarity: r };
  }

  /* ---------------- the Store ---------------- */
  /** Buy packs: Shards out, packs into the inventory. */
  function buyPacks(setInfo, kind, qty) {
    load();
    qty = Math.max(1, Math.floor(qty || 1));
    const each = kind === 'collector' ? PRICES.collector : PRICES.pack;
    const cost = each * qty;
    if (state.shards < cost) return { ok: false, why: `That costs ${cost.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= cost;
    for (let i = 0; i < qty; i++) state.packs.push({ id: MTG.uid('pk'), set: setInfo.code, name: setInfo.name, kind: kind || 'play' });
    save('buy', -cost);
    return { ok: true, cost };
  }
  /**
   * Today's deals: a rare and a mythic from recent sets, and one more of
   * either, the same all day. `pick` makes them (async) the first time.
   */
  async function dailyDeals(make) {
    load();
    if (state.deals && state.deals.day === today() && (state.deals.items || []).length) return state.deals.items;
    const items = await make();
    state.deals = { day: today(), items: items.map(c => ({ name: c.name, id: c.id, r: rarityOf(c), s: c.set,
      price: rarityOf(c) === 'mythic' ? PRICES.dealMythic : PRICES.dealRare, bought: false, card: slimCard(c) })) };
    save('deals');
    return state.deals.items;
  }
  function buyDeal(i) {
    load();
    const d = state.deals && state.deals.items[i];
    if (!d || d.bought) return { ok: false, why: 'That deal is gone.' };
    if (state.shards < d.price) return { ok: false, why: `That costs ${d.price.toLocaleString()} Shards.` };
    if (owned(d.name) >= PLAYSET) return { ok: false, why: 'You already have four.' };
    state.shards -= d.price;
    d.bought = true;
    addCard(d.card || { name: d.name, id: d.id, rarity: d.r, set: d.s }, 1);
    save('deal', -d.price);
    return { ok: true };
  }
  /** Enough of a card to show it again later without asking Scryfall. */
  function slimCard(c) {
    const pick = (o) => o && { name: o.name, mana_cost: o.mana_cost, type_line: o.type_line, oracle_text: o.oracle_text,
      image_uris: o.image_uris ? { normal: o.image_uris.normal, art_crop: o.image_uris.art_crop, small: o.image_uris.small } : undefined };
    return Object.assign(pick(c), { id: c.id, set: c.set, rarity: c.rarity, colors: c.colors, cmc: c.cmc, layout: c.layout,
      card_faces: c.card_faces ? c.card_faces.map(pick) : undefined });
  }

  /* ---------------- opening a pack ---------------- */
  /**
   * Open one booster from the inventory: the cards (each marked new, or
   * turned into Shards past the playset), wildcards that took a card's
   * place, and the wildcard the track brings every so many packs. `setFor`
   * names a set for a welcome pack that has none yet.
   */
  async function openPack(packId, setFor) {
    load();
    const at = state.packs.findIndex(p => p.id === packId);
    if (at < 0) throw new Error('That pack is not in your inventory.');
    const pack = state.packs[at];
    if (!pack.set && setFor) { const s = await setFor(pack); if (s) { pack.set = s.code; pack.name = s.name; } }
    if (!pack.set) throw new Error('No set could be found for that pack. Check the connection.');
    const pool = await MTG.scry.setPool(pack.set);
    if (!pool || !pool.all || pool.all.length < 20) throw new Error(`The cards of ${pack.name || pack.set.toUpperCase()} could not be loaded.`);
    const D = MTG.draft;
    const sets = await MTG.scry.draftableSets().catch(() => []);
    const info = sets.find(s => s.code === pack.set) || { code: pack.set };
    const spec = pack.kind === 'collector' ? D.COLLECTOR_BOOSTER : D.boosterSpecFor(info);
    const variants = pack.kind === 'collector' ? await MTG.scry.setVariants(pack.set).catch(() => null) : null;
    const rng = new MTG.RNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    let cards = D.makeBooster(pool, rng, spec, { variants });
    // basics are not collected; a real pack's basic is no loss
    cards = cards.filter(c => !isBasic(c.name));

    /* Arena's wildcards: now and then one takes a card's place, of the
       card's own rarity. */
    const slots = cards.map(c => ({ card: c, rarity: rarityOf(c) }));
    const odds = { common: 1 / 3, uncommon: 1 / 5, rare: 1 / 24, mythic: 1 / 24 };
    const swapped = new Set();
    for (const r of RARITIES) {
      if (rng.next() >= odds[r]) continue;
      const i = slots.findIndex((s, k) => s.rarity === r && !swapped.has(k));
      if (i >= 0) swapped.add(i);
    }
    const out = [];
    slots.forEach((s, k) => {
      if (swapped.has(k)) { state.wc[s.rarity]++; out.push({ wildcard: s.rarity }); return; }
      const res = addCard(s.card, 1);
      out.push({ card: s.card, rarity: s.rarity, foil: !!s.card._foil, isNew: res.isNew, shards: res.shards });
    });
    // the wildcard track
    state.opened++;
    state.track.rare++; state.track.mythic++;
    const bonus = [];
    if (state.track.mythic >= WC_TRACK.mythic) { state.track.mythic = 0; state.track.rare = 0; state.wc.mythic++; bonus.push('mythic'); }
    else if (state.track.rare >= WC_TRACK.rare) { state.track.rare = 0; state.wc.rare++; bonus.push('rare'); }
    state.packs.splice(at, 1);
    save('open');
    // rarest last, the way they are turned over
    const rank = (x) => x.wildcard ? RARITIES.indexOf(x.wildcard) + 0.5 : RARITIES.indexOf(x.rarity) + (x.foil ? 0.25 : 0);
    out.sort((a, b) => rank(a) - rank(b));
    return { pack, cards: out, bonus };
  }

  /* ---------------- rewards ---------------- */
  /**
   * Shards for a game played, more for a win, and a bonus for the first
   * win each day. `key` stops one game paying twice.
   */
  function awardGame(opts) {
    load();
    opts = opts || {};
    if (opts.key && state.lastGameKey === opts.key) return null;
    state.lastGameKey = opts.key || null;
    const parts = [['Game played', REWARD.play]];
    state.games++;
    if (opts.won) {
      state.wins++;
      parts.push(['Victory', REWARD.win]);
      if (state.lastWinDay !== today()) { state.lastWinDay = today(); parts.push(['First win of the day', REWARD.firstWin]); }
    }
    const total = parts.reduce((a, p) => a + p[1], 0);
    state.shards += total;
    save('reward', total);
    return { total, parts };
  }

  /* ---------------- decks ---------------- */
  /** Whether decks have to be built from the collection (Options). */
  const rulesOn = () => !MTG.settings || MTG.settings.useCollection !== false;
  /** The cards a deck needs more of than the collection has: [{name, need, have, rarity, card}]. */
  function missingFor(deck) {
    const want = new Map();
    const add = (c, n) => {
      if (!c || isBasic(c.name)) return;
      const w = want.get(c.name) || { n: 0, card: c };
      w.n += n;
      want.set(c.name, w);
    };
    for (const e of ((deck && deck.main) || [])) add(e.card, e.qty || 1);
    for (const e of ((deck && deck.sideboard) || [])) add(e.card, e.qty || 1);
    for (const c of ((deck && deck.commanders) || [])) add(c, 1);
    if (deck && deck.companion) add(deck.companion, 1);
    const out = [];
    for (const [name, w] of want) {
      const have = owned(name);
      const need = Math.min(w.n, PLAYSET);
      if (have < need) out.push({ name, need, have, rarity: rarityOf(w.card), card: w.card });
    }
    return out;
  }
  /** Craft every missing copy that wildcards will cover; returns what is still missing. */
  function craftMissing(deck) {
    load();
    for (const m of missingFor(deck)) {
      for (let i = m.have; i < m.need; i++) {
        if (!useWildcard(m.rarity)) break;
        addCard(m.card, 1);
      }
    }
    save('craft');
    return missingFor(deck);
  }
  /** The wildcards a deck's missing cards would take, by rarity. */
  function wildcardsFor(missing) {
    const need = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    for (const m of missing) need[m.rarity] += m.need - m.have;
    return need;
  }

  /** A cheat for testing, the backquote key: ten thousand Shards. */
  function grantTest() { return addShards(10000, 'test'); }

  MTG.economy = {
    PRICES, REWARD, DUP_SHARDS, PLAYSET, WC_TRACK, START, RARITIES,
    get state() { return load(); },
    shards: () => load().shards,
    wildcards: () => Object.assign({}, load().wc),
    packs: () => load().packs.slice(),
    collection: () => load().col,
    save: () => save(),
    isBasic, rarityOf, owned, addShards, spend, addCard, addCards, craft, useWildcard,
    buyPacks, dailyDeals, buyDeal, openPack, awardGame, missingFor, craftMissing, wildcardsFor,
    rulesOn, grantTest, slimCard,
    /** The welcome note has been seen. */
    welcomed() { load(); if (state.welcome) { state.welcome = false; save(); } },
    get isWelcome() { return !!load().welcome; },
  };
})(window.MTG);
