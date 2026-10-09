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
  const PRICES = { pack: 1000, collector: 2500, dealRare: 1500, dealMythic: 3000, sleeve: 2000, sleeveCustom: 8000 };
  /* A Commander deck costs what the wildcards for its cards would, less a
     share for buying them together, and nothing for the cards you have
     already; never less than PRECON_MIN. */
  const PRECON_RATE = 0.6, PRECON_MIN = 500;
  /** A wildcard bought outright, by rarity. */
  const WC_PRICES = { common: 300, uncommon: 750, rare: 2000, mythic: 4000 };
  /** Card styles: a treatment for one card of yours, wherever it is played. */
  const STYLES = [
    { id: 'etched', name: 'Etched', price: 1000, text: 'Silvered, engraved lines over the art.' },
    { id: 'gilded', name: 'Gilded', price: 1500, text: 'A gold frame that catches the light.' },
    { id: 'shadow', name: 'Shadowborn', price: 1500, text: 'Darkened edges and a violet smoulder.' },
    { id: 'prismatic', name: 'Prismatic foil', price: 2500, text: 'A rainbow foil that moves across the card.' },
    { id: 'celestial', name: 'Celestial', price: 2500, text: 'Starlight drifting over a midnight sheen.' },
  ];
  /** Frames: a ring around your portrait at the table and in the menus. */
  const FRAMES = [
    { id: 'gilded', name: 'Gilded', price: 1500 },
    { id: 'thorns', name: 'Thorns', price: 1500 },
    { id: 'frost', name: 'Frost', price: 1500 },
    { id: 'ember', name: 'Ember', price: 2500 },
    { id: 'arcane', name: 'Arcane', price: 2500 },
    { id: 'void', name: 'Void', price: 4000 },
  ];
  /** Another printing's art for a card you own, by rarity (one you pulled is free). */
  const ART_PRICES = { common: 100, uncommon: 200, rare: 400, mythic: 800 };

  /* Sleeves: what goes over the back of your cards. Woven patterns and
     card art at one price, and a sleeve of your own picture at four times
     that. A sleeve is drawn from what is here (src/10d-ui-store.js). */
  const SLEEVES = [
    { id: 'obsidian', name: 'Obsidian Filigree', kind: 'pattern', rim: '#c9a24a',
      css: 'radial-gradient(circle at 50% 50%, rgba(201,162,74,.22) 0 9%, transparent 10%) 0 0 / 22% 16%, repeating-linear-gradient(45deg, rgba(201,162,74,.12) 0 1px, transparent 1px 9px), repeating-linear-gradient(-45deg, rgba(201,162,74,.12) 0 1px, transparent 1px 9px), linear-gradient(160deg, #1b1916, #050505)' },
    { id: 'azure', name: 'Azure Tide', kind: 'pattern', rim: '#7fc4ff',
      css: 'repeating-radial-gradient(circle at 50% 120%, rgba(160,215,255,.16) 0 2px, transparent 2px 14px), linear-gradient(170deg, #1a4f86, #0a1c38 70%, #050c1c)' },
    { id: 'crimson', name: 'Crimson Ember', kind: 'pattern', rim: '#ff8a4a',
      css: 'radial-gradient(ellipse at 50% 110%, rgba(255,140,60,.5), transparent 55%), repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 2px, transparent 2px 7px), linear-gradient(180deg, #5a0d0d, #1c0404)' },
    { id: 'verdant', name: 'Verdant Weave', kind: 'pattern', rim: '#8fd46a',
      css: 'repeating-linear-gradient(60deg, rgba(160,220,120,.12) 0 2px, transparent 2px 10px), repeating-linear-gradient(-60deg, rgba(160,220,120,.12) 0 2px, transparent 2px 10px), linear-gradient(160deg, #1f4d22, #0a1f0c)' },
    { id: 'ivory', name: 'Ivory Sun', kind: 'pattern', rim: '#f1d58a',
      css: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(201,162,74,.22) 0 6deg, transparent 6deg 18deg), radial-gradient(circle at 50% 50%, #fff8e6, #d9cbaa 70%, #9c8a63)' },
    { id: 'amethyst', name: 'Amethyst Veil', kind: 'pattern', rim: '#c79bff',
      css: 'radial-gradient(circle at 30% 20%, rgba(220,180,255,.35), transparent 40%), radial-gradient(circle at 75% 80%, rgba(140,90,230,.4), transparent 45%), linear-gradient(160deg, #2a1450, #0d0620)' },
    { id: 'gilded', name: 'Gilded Lattice', kind: 'pattern', rim: '#ffe29a',
      css: 'repeating-linear-gradient(0deg, rgba(0,0,0,.25) 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, rgba(0,0,0,.25) 0 1px, transparent 1px 12px), linear-gradient(135deg, #f5d27a, #b8862b 50%, #f0c860)' },
    { id: 'void', name: 'Starless Void', kind: 'pattern', rim: '#9aa6c8',
      css: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #cfd8ff, transparent), radial-gradient(1px 1px at 85% 15%, #fff, transparent), radial-gradient(ellipse at 50% 50%, #1a1f3a, #03040a 75%)' },
    // the art of the game's best-known faces and moments
    { id: 'art-bolas', name: 'Nicol Bolas', kind: 'art', card: 'Nicol Bolas, Dragon-God', rim: '#e05a3a' },
    { id: 'art-ugin', name: 'Ugin', kind: 'art', card: 'Ugin, the Spirit Dragon', rim: '#9fd8e6' },
    { id: 'art-emrakul', name: 'Emrakul', kind: 'art', card: 'Emrakul, the Aeons Torn', rim: '#c8b8e8' },
    { id: 'art-liliana', name: 'Liliana', kind: 'art', card: 'Liliana of the Veil', rim: '#a77ad8' },
    { id: 'art-jace', name: 'Jace', kind: 'art', card: 'Jace, the Mind Sculptor', rim: '#6fb6ff' },
    { id: 'art-chandra', name: 'Chandra', kind: 'art', card: 'Chandra, Torch of Defiance', rim: '#ff8a3a' },
    { id: 'art-avacyn', name: 'Avacyn', kind: 'art', card: 'Avacyn, Angel of Hope', rim: '#f1e2b0' },
    { id: 'art-sheoldred', name: 'Sheoldred', kind: 'art', card: 'Sheoldred, the Apocalypse', rim: '#c9a24a' },
    { id: 'art-atraxa', name: 'Atraxa', kind: 'art', card: "Atraxa, Praetors' Voice", rim: '#e8e2d0' },
    { id: 'art-griselbrand', name: 'Griselbrand', kind: 'art', card: 'Griselbrand', rim: '#b04040' },
    { id: 'art-craterhoof', name: 'Craterhoof', kind: 'art', card: 'Craterhoof Behemoth', rim: '#8fd46a' },
    { id: 'art-island', name: 'Island', kind: 'art', card: 'Island', rim: '#7fc4ff' },
    // your own picture
    { id: 'custom', name: 'Your own picture', kind: 'custom', rim: '#f1d58a' },
  ];
  // a loss pays 500, a win 2,000 (500 for playing and 1,500 more), the day's first win 2,500 on top
  const REWARD = { play: 500, win: 1500, firstWin: 2500 };
  /** A copy past the fourth is worth this many Shards instead. */
  const DUP_SHARDS = { common: 50, uncommon: 100, rare: 400, mythic: 800 };
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
    sleeves: { owned: [], on: null, custom: null, art: {} },
    arts: [],
    styles: { owned: {}, on: {} },
    frames: { owned: [], on: null },
  });
  function load() {
    if (state) return state;
    state = Object.assign(blank(), MTG.store.get(KEY, null) || {});
    state.wc = Object.assign({ common: 0, uncommon: 0, rare: 0, mythic: 0 }, state.wc || {});
    state.sleeves = Object.assign({ owned: [], on: null, custom: null, art: {} }, state.sleeves || {});
    if (!Array.isArray(state.arts)) state.arts = [];
    state.styles = Object.assign({ owned: {}, on: {} }, state.styles || {});
    state.frames = Object.assign({ owned: [], on: null }, state.frames || {});
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
    if (card.id) { e.p = e.p || []; if (!e.p.includes(card.id) && e.p.length < 40) e.p.push(card.id); }
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

  /**
   * What a Commander deck costs you: the wildcards its cards would take
   * (each card as many times as the deck has it, up to four), less those
   * you own, at PRECON_RATE. `cards`: [{ name, rarity, qty }]. Also the
   * price with nothing owned, how many cards it counts and how many of
   * them you have.
   */
  function deckPrice(cards) {
    load();
    const need = new Map();
    for (const c of (cards || [])) {
      if (!c || !c.name || isBasic(c.name)) continue;
      const e = need.get(c.name) || { r: rarityOf(c), want: 0 };
      e.want = Math.min(PLAYSET, e.want + (c.qty || 1));
      need.set(c.name, e);
    }
    let full = 0, due = 0, count = 0, have = 0;
    for (const [name, e] of need) {
      const per = WC_PRICES[e.r] || WC_PRICES.common;
      const got = Math.min(e.want, owned(name));
      full += per * e.want;
      due += per * (e.want - got);
      count += e.want;
      have += got;
    }
    const at = (n) => Math.max(PRECON_MIN, Math.round(n * PRECON_RATE / 50) * 50);
    return { price: at(due), full: at(full), cards: count, owned: have };
  }
  /**
   * A Commander deck bought whole, at its price for you (deckPrice): every
   * card you lack goes into the collection, up to four of each. No Shards
   * for copies you had already: the price left those out. `deck.all` is
   * [{ card, qty }].
   */
  function buyDeck(deck) {
    load();
    const list = (deck.all || []).filter(e => e && e.card);
    const { price } = deckPrice(list.map(e => ({ name: e.card.name, rarity: e.card.rarity, qty: e.qty || 1 })));
    if (state.shards < price) return { ok: false, why: `That costs ${price.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= price;
    let cards = 0, fresh = 0;
    for (const e of list) {
      const room = Math.max(0, Math.min(e.qty || 1, PLAYSET - owned(nameOf(e.card))));
      cards += e.qty || 1;
      if (!room) continue;
      if (addCard(e.card, room).isNew) fresh++;
    }
    save('deck', -price);
    if (MTG.progress) MTG.progress.checkSets([...new Set(list.map(e => e.card.set).filter(Boolean))]);
    return { ok: true, cards, fresh, price };
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
    if (MTG.progress && card.set) MTG.progress.checkSets([card.set]);
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
    const sets = await MTG.scry.packSets().catch(() => []);
    const info = sets.find(s => s.code === pack.set) || { code: pack.set };
    const spec = pack.kind === 'collector' ? D.COLLECTOR_BOOSTER : D.boosterSpecFor(info);
    const variants = pack.kind === 'collector' ? await MTG.scry.setVariants(pack.set).catch(() => null) : null;
    // the cards folded into this set: its Commander decks', Alchemy's, its deck-only ones
    const folded = await MTG.scry.packExtras(pack.set).catch(() => null);
    const rng = new MTG.RNG((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    let cards = D.makeBooster(pool, rng, spec, { variants, bonus: folded });
    // basics are not collected; a real pack's basic is no loss
    cards = cards.filter(c => !isBasic(c.name));
    /* Duplicate protection, as Arena does it: a rare or mythic you already
       have four of is swapped for one of the set's of the same rarity that
       you have not, while there are any (a foil stays a foil). */
    cards = cards.map((c) => {
      const r = rarityOf(c);
      if ((r !== 'rare' && r !== 'mythic') || owned(c.name) < PLAYSET) return c;
      const list = (pool[r] || []).filter(x => !isBasic(x.name) && owned(x.name) < PLAYSET && !cards.some(y => y.name === x.name));
      if (!list.length) return c;
      const pick = list[rng.int(list.length)];
      return c._foil ? Object.assign({}, pick, { _foil: true }) : pick;
    });

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
    if (MTG.progress) { MTG.progress.notePulls(out); MTG.progress.checkSets([pack.set]); }
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

  /* ---------------- sleeves ---------------- */
  const sleeveById = (id) => SLEEVES.find(x => x.id === id) ||
    (/^set-[a-z0-9]+$/.test(String(id || '')) ? { id, name: `${String(id).slice(4).toUpperCase()} set sleeve`, kind: 'art', setCode: String(id).slice(4), rim: '#f1d58a', earned: true } : null);
  function buySleeve(id) {
    load();
    const sl = sleeveById(id);
    if (!sl) return { ok: false, why: 'There is no such sleeve.' };
    if (state.sleeves.owned.includes(id)) return { ok: false, why: 'You already have that sleeve.' };
    const cost = sl.kind === 'custom' ? PRICES.sleeveCustom : PRICES.sleeve;
    if (state.shards < cost) return { ok: false, why: `That costs ${cost.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= cost;
    state.sleeves.owned.push(id);
    save('sleeve', -cost);
    return { ok: true, cost };
  }
  /** Put a sleeve on (null: the plain back). */
  function equipSleeve(id) {
    load();
    if (id && !state.sleeves.owned.includes(id)) return false;
    state.sleeves.on = id || null;
    save('sleeve');
    return true;
  }
  /** Your own sleeve's picture (a card-shaped JPEG data URL). */
  function setCustomSleeve(data) {
    load();
    state.sleeves.custom = data || null;
    save('sleeve');
  }
  /** The art behind an art sleeve, kept once it is known. */
  function noteSleeveArt(id, url) { load(); if (url && state.sleeves.art[id] !== url) { state.sleeves.art[id] = url; save(); } }
  /**
   * The sleeve you wear, as something another player can draw too:
   * { id, kind, css | art | img, rim }, or null for the plain back.
   */
  function sleeveWorn() {
    load();
    const sl = sleeveById(state.sleeves.on);
    if (!sl) return null;
    if (sl.kind === 'pattern') return { id: sl.id, kind: 'pattern', css: sl.css, rim: sl.rim };
    if (sl.kind === 'art') return state.sleeves.art[sl.id] ? { id: sl.id, kind: 'art', art: state.sleeves.art[sl.id], rim: sl.rim } : null;
    return state.sleeves.custom ? { id: 'custom', kind: 'custom', img: state.sleeves.custom, rim: sl.rim } : null;
  }

  /* ---------------- wildcards for Shards, and art ---------------- */
  function buyWildcards(rarity, n) {
    load();
    n = Math.max(1, Math.floor(n || 1));
    const cost = (WC_PRICES[rarity] || 0) * n;
    if (!cost) return { ok: false, why: 'There is no such wildcard.' };
    if (state.shards < cost) return { ok: false, why: `That costs ${cost.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= cost;
    state.wc[rarity] += n;
    save('wildcards', -cost);
    return { ok: true, cost };
  }
  /**
   * What finishing a deck takes: the copies missing, the wildcards that
   * crafts them, how many of those you lack, and what buying the lack
   * would cost in Shards.
   */
  function craftPlan(deck) {
    load();
    const missing = missingFor(deck);
    const need = wildcardsFor(missing);
    const have = Object.assign({}, state.wc);
    const short = {};
    let shortCost = 0, copies = 0;
    for (const r of RARITIES) {
      short[r] = Math.max(0, need[r] - have[r]);
      shortCost += short[r] * WC_PRICES[r];
      copies += need[r];
    }
    return { missing, need, have, short, shortCost, copies, canAfford: state.shards >= shortCost,
      enough: RARITIES.every(r => !short[r]) };
  }
  /**
   * Craft every missing copy of a deck. With `buyShort`, first buy the
   * wildcards you lack with Shards (all of them, or none if you cannot
   * afford them). Returns what is still missing afterwards.
   */
  function craftAll(deck, buyShort) {
    load();
    const plan = craftPlan(deck);
    if (buyShort && plan.shortCost > 0) {
      if (state.shards < plan.shortCost) return { ok: false, why: `Buying the wildcards you lack costs ${plan.shortCost.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.`, left: plan.missing };
      state.shards -= plan.shortCost;
      for (const r of RARITIES) state.wc[r] += plan.short[r];
      save('wildcards', -plan.shortCost);
    }
    const left = craftMissing(deck);
    if (MTG.progress) MTG.progress.checkSets([...new Set(plan.missing.map(m => m.card && m.card.set).filter(Boolean))]);
    return { ok: !left.length, left };
  }
  /** Whether a printing's art is yours: one you pulled, crafted or bought, or bought on its own. */
  function ownsArt(card) {
    load();
    if (!card || !card.id) return true;
    if (state.arts.includes(card.id)) return true;
    const e = state.col[card.name];
    return !!(e && e.p && e.p.includes(card.id));
  }
  const artPrice = (card) => ART_PRICES[rarityOf(card)] || 100;
  function buyArt(card) {
    load();
    if (ownsArt(card)) return { ok: true, cost: 0 };
    const cost = artPrice(card);
    if (state.shards < cost) return { ok: false, why: `That art costs ${cost.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= cost;
    state.arts.push(card.id);
    save('art', -cost);
    return { ok: true, cost };
  }

  /* ---------------- card styles and frames ---------------- */
  const styleById = (id) => STYLES.find(x => x.id === id) || null;
  function ownsStyle(name, id) { load(); return ((state.styles.owned[name]) || []).includes(id); }
  function buyStyle(name, id) {
    load();
    const st = styleById(id);
    if (!st) return { ok: false, why: 'There is no such style.' };
    if (owned(name) < 1) return { ok: false, why: 'You need the card in your collection first.' };
    if (ownsStyle(name, id)) return { ok: true, cost: 0 };
    if (state.shards < st.price) return { ok: false, why: `That style costs ${st.price.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= st.price;
    (state.styles.owned[name] = state.styles.owned[name] || []).push(id);
    state.styles.on[name] = id;
    save('style', -st.price);
    return { ok: true, cost: st.price };
  }
  /** The style a card of yours wears (null: none), or put one on. */
  const styleFor = (name) => { load(); return (state.styles.on || {})[name] || null; };
  function setStyle(name, id) {
    load();
    if (id && !ownsStyle(name, id)) return false;
    if (id) state.styles.on[name] = id; else delete state.styles.on[name];
    save('style');
    return true;
  }
  const frameById = (id) => FRAMES.find(x => x.id === id) || null;
  function buyFrame(id) {
    load();
    const fr = frameById(id);
    if (!fr) return { ok: false, why: 'There is no such frame.' };
    if (state.frames.owned.includes(id)) return { ok: true, cost: 0 };
    if (state.shards < fr.price) return { ok: false, why: `That frame costs ${fr.price.toLocaleString()} Shards; you have ${state.shards.toLocaleString()}.` };
    state.shards -= fr.price;
    state.frames.owned.push(id);
    state.frames.on = id;
    save('frame', -fr.price);
    return { ok: true, cost: fr.price };
  }
  function equipFrame(id) {
    load();
    if (id && !state.frames.owned.includes(id)) return false;
    state.frames.on = id || null;
    save('frame');
    return true;
  }
  const frameWorn = () => { load(); return state.frames.on || null; };

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
    isBasic, rarityOf, owned, addShards, spend, addCard, addCards, deckPrice, buyDeck, craft, useWildcard,
    buyPacks, dailyDeals, buyDeal, openPack, awardGame, missingFor, craftMissing, wildcardsFor,
    rulesOn, grantTest, slimCard,
    SLEEVES, sleeveById, buySleeve, equipSleeve, setCustomSleeve, noteSleeveArt, sleeveWorn,
    WC_PRICES, ART_PRICES, buyWildcards, craftPlan, craftAll, ownsArt, artPrice, buyArt,
    STYLES, FRAMES, styleById, ownsStyle, buyStyle, styleFor, setStyle, frameById, buyFrame, equipFrame, frameWorn,
    sleeves: () => load().sleeves,
    /** The welcome note has been seen. */
    welcomed() { load(); if (state.welcome) { state.welcome = false; save(); } },
    get isWelcome() { return !!load().welcome; },
  };
})(window.MTG);
