/* ============================================================
   07-draft.js - boosters, cubes and the draft table
   Packs are built from real set collation (Play Booster slots for sets
   printed from 2024 on, classic Draft Booster slots before that) using
   Scryfall's `is:booster` card pool for the set.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* ---------------- booster collation ---------------- */

  // Play Booster, 14 playable cards (WPN "Introducing Play Boosters"):
  //   1-6   commons
  //   7     common (98.5%) or a Special Guest / The List card (1.5%)
  //   8-10  uncommons
  //   11    non-foil wildcard, any rarity
  //   12    rare (87.5%) or mythic (12.5%)
  //   13    basic land (or a common land in sets with no basics)
  //   14    foil wildcard, any rarity
  const PLAY_BOOSTER = {
    id: 'play', size: 14, since: '2024-02-01',
    slots: [
      { n: 6, pick: 'common' },
      { n: 1, pick: 'commonOrList' },
      { n: 3, pick: 'uncommon' },
      { n: 1, pick: 'wildcard' },
      { n: 1, pick: 'rareMythic' },
      { n: 1, pick: 'land' },
      { n: 1, pick: 'wildcard', foil: true },
    ],
  };
  // Classic Draft Booster, 15 cards.
  const DRAFT_BOOSTER = {
    id: 'draft', size: 15,
    slots: [
      { n: 10, pick: 'common' },
      { n: 1, pick: 'commonOrLand' },
      { n: 3, pick: 'uncommon' },
      { n: 1, pick: 'rareMythic' },
    ],
  };

  /* Collector Booster, 15 cards (Throne of Eldraine onwards, in outline:
     every set varies the details). Mostly foil, a foil rare, and rares and
     uncommons in the set's special treatments: extended art, borderless,
     showcase. Older sets had none; there the same mix comes in ordinary
     printings. */
  const COLLECTOR_BOOSTER = {
    id: 'collector', size: 15,
    slots: [
      { n: 5, pick: 'common', foil: true },
      { n: 3, pick: 'uncommon', foil: true },
      { n: 1, pick: 'land', foil: true },
      { n: 2, pick: 'variantUncommon' },
      { n: 1, pick: 'variantUncommon', foil: true },
      { n: 1, pick: 'rareMythic', foil: true },
      { n: 1, pick: 'variantRare' },
      { n: 1, pick: 'variantRare', foil: true },
    ],
  };
  // A Commander draft pack, and its collector counterpart: twenty cards either way.
  const CMDR_PACK = { id: 'cmdr', size: 20, slots: [{ n: 14, pick: 'common' }, { n: 4, pick: 'uncommon' }, { n: 2, pick: 'rareMythic' }] };
  const CMDR_COLLECTOR = { id: 'cmdrCollector', size: 20, slots: [
    { n: 10, pick: 'common', foil: true }, { n: 4, pick: 'uncommon', foil: true }, { n: 2, pick: 'variantUncommon' },
    { n: 2, pick: 'rareMythic', foil: true }, { n: 2, pick: 'variantRare' }] };

  // Rarity mix of the Play Booster wildcard slots.
  const WILDCARD_MIX = [['common', 0.583], ['uncommon', 0.350], ['rare', 0.053], ['mythic', 0.014]];
  /* Real packs keep a basic land in one slot. A basic is not a pick — it is
     a card everybody already has as many of as they want — so that slot is
     spent on something draftable instead. */
  const LAND_SLOT_MIX = [['common', 0.70], ['uncommon', 0.2975], ['rare', 0.0025]];

  /* ============================================================
     Cards whose rules text happens during the draft
     A handful of cards (Conspiracy and Conspiracy: Take the Crown, mostly)
     do their work between opening a pack and building a deck. They are
     listed by name rather than parsed, because the text is bespoke enough
     that a parser would be guessing; anything matching the shape of a draft
     ability but not on the list is flagged instead, so the table knows to
     run it by hand rather than quietly losing it.
     ============================================================ */

  const DRAFT_ABILITIES = {
    'cogwork librarian': {
      kind: 'extraPick', faceUp: true, extra: 1, returns: true, uses: Infinity,
      label: 'Take a second card',
      prompt: 'Draft an extra card from this pack and put Cogwork Librarian back into it.',
    },
    "leovold's operative": {
      kind: 'extraPick', faceUp: true, extra: 1, returns: false, uses: 1,
      label: 'Take a second card',
      prompt: "Turn Leovold's Operative face down to draft an extra card from this pack.",
    },
    'agent of acquisitions': {
      kind: 'wholePack', faceUp: true, uses: 1,
      label: 'Take the whole pack',
      prompt: 'Draft every card in this booster instead of one, then sit out the rest of the pack.',
    },
    'canal dredger': {
      kind: 'lastCard', faceUp: true, uses: Infinity, passive: true,
      label: 'Last card of every pack',
      prompt: 'The last card of each booster comes to you.',
    },
    'lore seeker': {
      kind: 'addPack', faceUp: true, uses: 1, onDraft: true,
      label: 'Add a booster',
      prompt: 'Add a fresh booster pack to the draft.',
    },
    'cogwork grinder': {
      kind: 'exile', faceUp: true, uses: Infinity,
      label: 'Remove a card from the game',
      prompt: 'Take a card in your pool out of the draft, face down.',
    },
    'cogwork spy': {
      kind: 'peek', faceUp: true, uses: 1,
      label: 'Look at a pack',
      prompt: 'Turn Cogwork Spy face down to look at an unopened booster.',
    },
    'whispergear sneak': {
      kind: 'peek', faceUp: true, uses: 1,
      label: 'Look at a pack',
      prompt: 'Turn Whispergear Sneak face down to look at any unopened booster.',
    },
    'illusionary informant': {
      kind: 'peek', faceUp: true, uses: 1,
      label: 'Look at a pack',
      prompt: 'Turn Illusionary Informant face down to see what is coming.',
    },
    'aether searcher': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes the next card you draft', note: 'revealed' },
    'noble banneret': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes the creatures you draft', note: 'noted' },
    'paliano vanguard': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes the creatures you draft', note: 'noted' },
    'smuggler captain': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes a card you draft', note: 'noted' },
    'deal broker': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes the cards you draft', note: 'noted' },
    'cogwork tracker': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes a player', note: 'noted' },
    'spire phantasm': { kind: 'note', faceUp: true, uses: Infinity, auto: true,
      label: 'Notes the next card you draft', note: 'revealed' },
  };

  /** Anything that talks about the draft, whether or not we can run it. */
  function draftAbilityOf(card) {
    if (!card) return null;
    const key = U.normName(U.frontName(card.name));
    const known = DRAFT_ABILITIES[key];
    if (known) return Object.assign({ name: card.name, known: true }, known);
    const t = card.oracle_text || '';
    if (/\bas you draft\b|\bdraft this card face up\b|\bdraft .{0,40} face up\b|\bbooster pack\b/i.test(t)
      && /draft/i.test(t)) {
      return { name: card.name, known: false, kind: 'manual', faceUp: /face up/i.test(t),
        label: 'Draft ability', prompt: t.split('\n').find(l => /draft/i.test(l)) || t };
    }
    return null;
  }

  function boosterSpecFor(setInfo) {
    if (setInfo && setInfo.released_at && setInfo.released_at >= PLAY_BOOSTER.since) return PLAY_BOOSTER;
    return DRAFT_BOOSTER;
  }

  /**
   * Build one booster from a bucketed set pool.
   * Never repeats a card inside a pack (real packs do not either).
   */
  function makeBooster(pool, rng, spec, opts) {
    opts = opts || {};
    spec = spec || DRAFT_BOOSTER;
    const used = new Set();
    const out = [];
    const takeFrom = (list, allowDup) => {
      if (!list || !list.length) return null;
      for (let tries = 0; tries < 24; tries++) {
        const c = list[rng.int(list.length)];
        if (allowDup || !used.has(c.id)) { used.add(c.id); return c; }
      }
      const fresh = list.filter(c => !used.has(c.id));
      if (!fresh.length) return null;
      const c = fresh[rng.int(fresh.length)];
      used.add(c.id);
      return c;
    };
    const playable = pool.playable || (pool.all || []).filter(c => !MTG.formats.isBasicLand(c));
    const fallbackChain = (names) => {
      for (const nm of names) { const c = takeFrom(pool[nm]); if (c) return c; }
      return takeFrom(playable);
    };

    for (const slot of spec.slots) {
      for (let i = 0; i < slot.n; i++) {
        let card = null;
        switch (slot.pick) {
          case 'common': card = fallbackChain(['common', 'uncommon']); break;
          case 'uncommon': card = fallbackChain(['uncommon', 'common']); break;
          case 'rareMythic':
            card = rng.chance(0.125) && pool.mythic.length
              ? takeFrom(pool.mythic) || takeFrom(pool.rare)
              : takeFrom(pool.rare) || takeFrom(pool.mythic);
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          case 'wildcard': {
            const r = rng.weighted(WILDCARD_MIX);
            card = takeFrom(pool[r]) || fallbackChain(['common', 'uncommon', 'rare', 'mythic']);
            break;
          }
          case 'variantRare': {
            // a special printing of a rare or mythic, or the plain one when the set has none
            const v = opts.variants;
            card = v && (v.rare.length || v.mythic.length)
              ? (rng.chance(0.2) && v.mythic.length ? takeFrom(v.mythic) : takeFrom(v.rare) || takeFrom(v.mythic))
              : null;
            if (!card) card = rng.chance(0.125) && pool.mythic.length ? takeFrom(pool.mythic) || takeFrom(pool.rare) : takeFrom(pool.rare) || takeFrom(pool.mythic);
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          }
          case 'variantUncommon': {
            const v = opts.variants;
            card = v && (v.uncommon.length || v.common.length) ? takeFrom(v.uncommon) || takeFrom(v.common) : null;
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          }
          case 'commonOrList':
            card = rng.chance(0.015) && opts.listPool && opts.listPool.length
              ? takeFrom(opts.listPool, true)
              : fallbackChain(['common']);
            break;
          case 'commonOrLand':
            card = (pool.nonbasicLands.length && rng.chance(0.35))
              ? takeFrom(pool.nonbasicLands) || fallbackChain(['common'])
              : fallbackChain(['common']);
            break;
          case 'land': {
            // what the basic-land slot is spent on instead
            const r = rng.weighted(LAND_SLOT_MIX);
            card = takeFrom(pool[r]) || fallbackChain(['common', 'uncommon', 'rare']);
            break;
          }
          default: card = takeFrom(playable);
        }
        if (card && slot.foil) card = Object.assign({}, card, { _foil: true });
        if (card) out.push(card);
      }
    }
    return out;
  }

  /** A cube pack: N singleton cards off the shuffled cube. */
  function makeCubePack(cubeCards, rng, size, usedSet) {
    const out = [];
    let guard = 0;
    while (out.length < size && guard++ < cubeCards.length * 3) {
      const c = cubeCards[rng.int(cubeCards.length)];
      if (usedSet.has(c.id)) continue;
      usedSet.add(c.id);
      out.push(c);
    }
    return out;
  }

  /* ---------------- cube storage ---------------- */
  const cubes = {
    list() { return MTG.store.get('cubes', []); },
    save(cube) {
      const all = cubes.list();
      const i = all.findIndex(c => c.id === cube.id);
      const slim = {
        id: cube.id, name: cube.name, size: cube.cards.length,
        packSize: cube.packSize, packs: cube.packs, updatedAt: Date.now(),
        recipe: cube.recipe || null,     // which shipped recipe built it, if any
        cardIds: cube.cards.map(c => c.id),
      };
      if (i >= 0) all[i] = slim; else all.push(slim);
      MTG.store.set('cubes', all);
      return slim;
    },
    remove(id) { MTG.store.set('cubes', cubes.list().filter(c => c.id !== id)); },
    async load(id) {
      const meta = cubes.list().find(c => c.id === id);
      if (!meta) return null;
      const { cards } = await MTG.scry.collection(meta.cardIds.map(i => ({ id: i })));
      return Object.assign({}, meta, { cards: cards.filter(Boolean) });
    },
  };

  /* ---------------- cubes you can have without owning one ----------------

     A cube is somebody's hand-built list, and nobody's list ships inside this
     file. What ships is a recipe: the shape a well-known kind of cube has —
     how many cards of each colour, what is allowed in it — which is filled in
     from Scryfall by play rate, so the result is a real, singleton, colour-
     balanced cube of recognisable cards that you can draft straight away.
     Build one and it is saved among your own cubes, where you can throw cards
     out of it, or replace it with a list of your own. */

  // things that are cards in a database but not cards you draft
  const CUBE_EXCLUDE = '-t:basic -is:funny -t:conspiracy -t:scheme -t:plane ' +
    '-t:phenomenon -t:vanguard -t:emblem -t:token -t:dungeon -t:attraction game:paper';

  /** The sections of a cube, as fractions of its size. */
  function cubeSections(base, size) {
    const mono = Math.round(size * 0.115);      // five colours, ~57.5%
    const gold = Math.round(size * 0.13);
    const grey = Math.round(size * 0.115);
    const land = size - mono * 5 - gold - grey;
    const q = (extra) => `${base} ${CUBE_EXCLUDE} ${extra}`;
    return [
      { label: 'white', q: q('c=w -t:land'), n: mono },
      { label: 'blue', q: q('c=u -t:land'), n: mono },
      { label: 'black', q: q('c=b -t:land'), n: mono },
      { label: 'red', q: q('c=r -t:land'), n: mono },
      { label: 'green', q: q('c=g -t:land'), n: mono },
      { label: 'gold', q: q('c:m -t:land'), n: gold },
      { label: 'colourless', q: q('c=c -t:land'), n: grey },
      { label: 'lands', q: q('t:land'), n: Math.max(0, land) },
    ];
  }

  const CUBE_RECIPES = [
    { id: 'vintage', name: 'Vintage cube', size: 540, packSize: 15,
      blurb: 'Everything the game has, at its most powerful: fast mana, the best removal, the cards that are banned everywhere else.',
      base: 'legal:vintage' },
    { id: 'legacy', name: 'Legacy cube', size: 450, packSize: 15,
      blurb: 'Powerful without the restricted list — the staples that hold up games rather than end them on turn one.',
      base: 'legal:legacy' },
    { id: 'modern', name: 'Modern cube', size: 360, packSize: 15,
      blurb: 'Modern-legal only. Newer card pools, fairer games, and a curve that actually matters.',
      base: 'legal:modern' },
    { id: 'peasant', name: 'Peasant cube', size: 360, packSize: 15,
      blurb: 'Commons and uncommons. The games are about card quality and curve rather than about who opened the bomb.',
      base: 'legal:legacy (r:common or r:uncommon)' },
    { id: 'pauper', name: 'Pauper cube', size: 360, packSize: 15,
      blurb: 'Commons only. Slower, grindier, and the closest a cube gets to a very good draft format.',
      base: 'legal:pauper r:common' },
    { id: 'creature', name: 'Creature cube', size: 360, packSize: 15,
      blurb: 'Creatures, the lands to cast them and almost nothing else. Combat every game.',
      base: 'legal:legacy (t:creature or t:land or t:equipment)' },
  ];

  /**
   * Fill a recipe in from Scryfall. Each section is asked for by play rate,
   * so a cube is made of cards people recognise; duplicates across sections
   * are dropped, because a cube is singleton.
   */
  async function buildRecipe(recipe, opts) {
    opts = opts || {};
    const sections = cubeSections(recipe.base, recipe.size);
    const total = sections.reduce((a, s) => a + s.n, 0);
    const seen = new Set();
    const out = [];
    let done = 0;
    for (const sec of sections) {
      if (opts.onProgress) opts.onProgress(done, total, sec.label);
      let found = [];
      try {
        found = await MTG.scry.search(sec.q, { max: Math.ceil(sec.n * 1.6), order: 'edhrec', unique: 'cards' });
      } catch (e) { found = []; }
      let taken = 0;
      for (const c of found) {
        if (taken >= sec.n) break;
        const key = c.oracle_id || U.normName(c.name);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
        taken++;
      }
      done += sec.n;
      if (opts.onProgress) opts.onProgress(Math.min(done, total), total, sec.label);
    }
    return out;
  }

  /* ---------------- the draft ---------------- */

  /**
   * A seat-based draft. Humans and bots share the same interface; the host
   * runs the whole thing and broadcasts each seat's view.
   */
  class Draft extends MTG.Emitter {
    constructor(cfg) {
      super();
      this.cfg = Object.assign({
        formatId: 'booster',
        seats: 8,
        packs: 3,
        packSize: 14,
        picksPerTurn: 1,
        setCodes: [],        // one per round, or one for all rounds
        chaos: false,
        cube: null,
        faceUp: false,
        seed: Date.now(),
        botDifficulty: 5,
        timerSeconds: 0,
      }, cfg);
      this.rng = new MTG.RNG(this.cfg.seed);
      this.seats = [];
      this.round = 0;
      this.pickNumber = 0;
      this.packs = [];         // current pack in front of each seat
      this.started = false;
      this.finished = false;
      this.history = [];
      this.pendingPicks = new Map();  // seatIndex -> [cardIds]
      this.packQueues = [];    // per-seat FIFO of packs waiting
      this.roundPacks = [];    // pre-generated packs per round
    }

    addSeat(cfg) {
      const s = {
        index: this.seats.length,
        id: cfg.id || MTG.uid('seat'),
        name: cfg.name || ('Seat ' + (this.seats.length + 1)),
        isBot: !!cfg.isBot,
        botDifficulty: cfg.botDifficulty || this.cfg.botDifficulty,
        pool: [],
        colorScores: { W: 0, U: 0, B: 0, R: 0, G: 0 },
        picked: [],
        ready: false,
        spent: {},          // ability card id -> uses already taken
        sitOutRound: -1,    // Agent of Acquisitions: no more picks this round
        notes: [],          // what the note-taking cards recorded
      };
      this.seats.push(s);
      return s;
    }

    /** Pre-generate every pack so the draft is deterministic from the seed. */
    async prepare(onProgress) {
      const rounds = this.cfg.packs;
      this.roundPacks = [];
      const setsUsed = new Set();
      // sets that were never sold in draft boosters, so the collation is a
      // reasonable guess rather than the real thing
      const looseSets = new Set();

      if (this.cfg.formatId === 'cube') {
        const cube = this.cfg.cube;
        if (!cube || !cube.cards || cube.cards.length < this.seats.length * this.cfg.packSize * rounds)
          throw new Error(`Cube needs at least ${this.seats.length * this.cfg.packSize * rounds} cards for ${this.seats.length} seats × ${rounds} packs of ${this.cfg.packSize}.`);
        const shuffled = this.rng.shuffle(cube.cards.slice());
        let k = 0;
        for (let r = 0; r < rounds; r++) {
          const packs = [];
          for (let s = 0; s < this.seats.length; s++) {
            packs.push(shuffled.slice(k, k + this.cfg.packSize));
            k += this.cfg.packSize;
          }
          this.roundPacks.push(packs);
        }
        this.setsUsed = ['Cube: ' + cube.name];
        return;
      }

      // resolve which set each pack comes from
      const allSets = await MTG.scry.draftableSets();
      const pick = (r, seat) => {
        if (this.cfg.formatId === 'chaos') {
          // the host's pool, when they set one, otherwise anything draftable
          const wanted = (this.cfg.setCodes || []).filter(Boolean);
          const from = wanted.length
            ? allSets.filter(x => wanted.includes(x.code))
            : allSets.slice(0, 240);
          if (!from.length) return allSets[this.rng.int(Math.min(allSets.length, 240))];
          return from[this.rng.int(from.length)];
        }
        const code = this.cfg.setCodes[r] || this.cfg.setCodes[0];
        return allSets.find(s => s.code === code) || { code, released_at: '2024-06-01' };
      };

      const poolCache = new Map();
      const variantCache = new Map();
      const variantsFor = async (code) => {
        if (!variantCache.has(code)) variantCache.set(code, await MTG.scry.setVariants(code).catch(() => null));
        return variantCache.get(code);
      };
      const broken = new Set();
      const usable = (p) => p && p.all && p.all.length >= 20;
      const getPool = async (code) => {
        if (poolCache.has(code)) return poolCache.get(code);
        const p = await MTG.scry.setPool(code);
        poolCache.set(code, p);
        return p;
      };
      /* A chaos draft rolls its sets, so one that will not load can simply be
         rerolled — a pool of forty sets will always have one that 404s. A set
         the host actually chose is different: silently swapping it for another
         turns their booster draft into a chaos draft, which is worse than an
         error, so a named set either loads or the draft stops and says which
         set it was. */
      const rerollable = this.cfg.formatId === 'chaos';
      const poolFor = async (setInfo) => {
        let info = setInfo;
        let lastErr = null;
        for (let tries = 0; tries < (rerollable ? 6 : 1); tries++) {
          if (!broken.has(info.code)) {
            try {
              const p = await getPool(info.code);
              if (usable(p)) return { pool: p, setInfo: info };
              lastErr = new Error(`${info.name || info.code.toUpperCase()} has only ${(p && p.all ? p.all.length : 0)} cards Scryfall can give us \u2014 not enough to build a booster.`);
            } catch (e) { lastErr = e; }
            broken.add(info.code);
          }
          if (!rerollable) break;
          const alt = allSets.filter(x => !broken.has(x.code));
          if (!alt.length) break;
          info = alt[this.rng.int(alt.length)];
        }
        const who = setInfo.name || setInfo.code.toUpperCase();
        throw new Error(rerollable
          ? `Could not load cards for ${who}. Check the connection and try again.`
          : `${who} cannot be drafted here. ${lastErr && lastErr.message ? lastErr.message : 'Scryfall returned no cards for it.'} Pick another set.`);
      };

      let done = 0;
      const totalPacks = rounds * this.seats.length;
      /* Every pack at the table has to hold the same number of cards. Packs
         come in two shapes (a 14-card Play Booster and a 15-card Draft
         Booster) and a chaos draft mixes sets freely, so without this a seat
         runs out of cards several picks before the rest of the table and the
         draft waits forever on a pick that cannot be made. */
      const target = U.clamp(this.cfg.packSize || 15, 3, 60);
      for (let r = 0; r < rounds; r++) {
        const packs = [];
        for (let s = 0; s < this.seats.length; s++) {
          const got = await poolFor(pick(r, s));
          const setInfo = got.setInfo, pool = got.pool;
          setsUsed.add(setInfo.code.toUpperCase());
          if (pool.loose) looseSets.add(setInfo.code.toUpperCase());
          const collector = !!this.cfg.collector;
          const spec = this.cfg.formatId === 'cmdrdraft'
            ? (collector ? CMDR_COLLECTOR : CMDR_PACK)
            : collector ? COLLECTOR_BOOSTER : boosterSpecFor(setInfo);
          const variants = collector ? await variantsFor(setInfo.code) : null;
          let pack = makeBooster(pool, this.rng, spec, { variants });
          if (this.cfg.formatId === 'cmdrdraft') pack = await this._ensureLegends(pack, pool, setInfo);
          // a pack is its booster's real size; only a host who asked for another size gets one
          if (!this.cfg.packSizeAuto) pack = this._sizePack(pack, pool, target);
          packs.push(pack);
          done++;
          if (onProgress) onProgress(done, totalPacks, setInfo.code.toUpperCase());
        }
        this.roundPacks.push(packs);
      }
      /* Every pack at the table holds the same number of cards, or a seat
         runs dry before the rest. Packs of one set already do; a chaos draft
         mixing 14-card Play Boosters and 15-card Draft Boosters cuts the
         bigger ones down rather than padding the smaller ones with cards a
         real pack would not have. */
      if (this.cfg.packSizeAuto) {
        const all = this.roundPacks.flat();
        const size = Math.max(1, Math.min(...all.map(p => p.length)));
        for (const round of this.roundPacks) {
          for (let i = 0; i < round.length; i++) round[i] = this._sizePack(round[i], null, size);
        }
        this.cfg.packSize = size;
      }
      this.setsUsed = Array.from(setsUsed);
      this.looseSets = Array.from(looseSets);
      // keep one pool around so Lore Seeker has real cards to open
      const last = poolCache.values().next().value;
      this.spareCards = last && last.all ? last.all.slice() : [];
    }

    /**
     * Trim or top up one pack so it holds exactly `target` cards. Trimming
     * drops the basic-land slot first, since it is not a real pick; topping
     * up pulls commons, which is what a short pool is short of.
     */
    _sizePack(pack, pool, target) {
      const out = pack.slice();
      if (out.length > target) {
        // drop land-slot cards first, then commons, then from the back
        for (let i = out.length - 1; i >= 0 && out.length > target; i--) {
          if (out[i] && out[i]._landSlot) out.splice(i, 1);
        }
        for (let i = out.length - 1; i >= 0 && out.length > target; i--) {
          if (out[i] && out[i].rarity === 'common' && !out[i]._foil) out.splice(i, 1);
        }
        out.length = Math.min(out.length, target);
      }
      if (out.length < target && pool && pool.all && pool.all.length) {
        const playable = pool.playable || pool.all.filter(c => !MTG.formats.isBasicLand(c));
        const have = new Set(out.map(c => c.id));
        const spare = playable.filter(c => !have.has(c.id));
        while (out.length < target && spare.length) {
          const i = this.rng.int(spare.length);
          out.push(spare[i]);
          spare.splice(i, 1);
        }
        // a pool too thin even for that: repeat rather than hand out a short pack
        while (out.length < target && playable.length) out.push(playable[this.rng.int(playable.length)]);
      }
      return out;
    }

    async _ensureLegends(pack, pool, setInfo) {
      const isLegend = (c) => /Legendary/.test(c.type_line || '') && /Creature/.test(c.type_line || '');
      if (pack.filter(isLegend).length >= 2) return pack;
      const legends = pool.all.filter(isLegend);
      if (!legends.length) return pack;
      const out = pack.slice();
      while (out.filter(isLegend).length < 2 && legends.length) {
        const c = legends[this.rng.int(legends.length)];
        if (out.some(x => x.id === c.id)) { if (legends.length < 4) break; continue; }
        // replace a common
        const i = out.findIndex(x => x.rarity === 'common' && !isLegend(x));
        if (i < 0) break;
        out[i] = c;
      }
      return out;
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.round = 0;
      this._openRound();
    }

    _openRound() {
      this.pickNumber = 0;
      this.packs = this.roundPacks[this.round].map(p => p.slice());
      this.direction = this.round % 2 === 0 ? 1 : -1;  // left, right, left
      this.emit('round:begin', this.round + 1, this.setsUsed);
      MTG.sfx('pack_open');
      this._beginPick();
    }

    _beginPick() {
      this.pendingPicks.clear();
      // Nothing to pick from is a pick of nothing. Without this a seat holding
      // an empty pack — a short pool, an odd pack size, a pick-two round that
      // does not divide evenly — waits on a human who has nothing to click.
      for (const s of this.seats) {
        if (!(this.packs[s.index] || []).length) this.pendingPicks.set(s.index, []);
        else if (s.sitOutRound === this.round) this.pendingPicks.set(s.index, []);
      }
      this.emit('pick:begin', this.pickNumber + 1);
      // bots pick immediately (with a small delay handled by the caller)
      for (const s of this.seats) if (s.isBot && !this.pendingPicks.has(s.index)) this._botPick(s);
      this._maybeAdvance();
    }

    /**
     * A human seat makes its pick(s). `opts.ability` is the card in their
     * pool being used to change what a pick is: an extra card off this pack,
     * or the whole pack at once.
     */
    pick(seatId, cardIds, opts) {
      opts = opts || {};
      const s = this.seats.find(x => x.id === seatId);
      if (!s) return false;
      if (this.pendingPicks.has(s.index)) return false;
      const pack = this.packs[s.index] || [];

      let ability = null;
      if (opts.ability) {
        ability = this.availableAbilities(seatId).find(a => a.cardId === opts.ability);
        if (!ability) return false;
      }

      if (ability && ability.kind === 'wholePack') {
        this.pendingPicks.set(s.index, pack.map(c => c.id));
        this._usedAbility = this._usedAbility || new Map();
        this._usedAbility.set(s.index, ability);
        MTG.sfx('pick');
        this._maybeAdvance();
        return true;
      }

      const def = ability ? DRAFT_ABILITIES[U.normName(U.frontName(ability.name))] : null;
      const extra = ability && ability.kind === 'extraPick' ? (def.extra || 1) : 0;
      const want = Math.min(this.cfg.picksPerTurn + extra, pack.length);
      cardIds = (cardIds || []).slice(0, want);
      if (cardIds.length !== want) return false;
      if (new Set(cardIds).size !== cardIds.length) return false;
      if (!cardIds.every(id => pack.some(c => c.id === id))) return false;
      this.pendingPicks.set(s.index, cardIds);
      if (ability) {
        this._usedAbility = this._usedAbility || new Map();
        this._usedAbility.set(s.index, ability);
      }
      MTG.sfx('pick');
      this._maybeAdvance();
      return true;
    }

    _botPick(s) {
      const pack = this.packs[s.index] || [];
      if (!pack.length) { this.pendingPicks.set(s.index, []); return; }
      const ranked = pack.slice().sort((a, b) => this._botRate(s, b) - this._botRate(s, a));

      /* A bot spends an extra-pick card when the pack still holds two cards
         it actually wants; a weak second card is not worth the Librarian. */
      const extras = this.availableAbilities(s.id).filter(a => a.kind === 'extraPick');
      if (extras.length && pack.length > this.cfg.picksPerTurn + 1) {
        const n = this.cfg.picksPerTurn;
        const second = ranked[n];
        if (second && this._botRate(s, second) > 2.2) {
          this.pendingPicks.set(s.index, ranked.slice(0, n + 1).map(c => c.id));
          this._usedAbility = this._usedAbility || new Map();
          this._usedAbility.set(s.index, extras[0]);
          return;
        }
      }
      const want = Math.min(this.cfg.picksPerTurn, pack.length);
      this.pendingPicks.set(s.index, ranked.slice(0, want).map(c => c.id));
    }

    /** Bot pick value: card quality, colour commitment, curve, with noise by difficulty. */
    _botRate(seat, card) {
      const d = U.clamp(seat.botDifficulty, 1, 10);
      const a = MTG.oracle.analyze(card);
      let v = 0;
      const rar = { common: 1.0, uncommon: 1.8, rare: 3.0, mythic: 3.6, special: 2.5, bonus: 2.5 }[card.rarity] || 1;
      v += rar;
      // EDHREC rank is a decent generic power proxy when present
      if (card.edhrec_rank) v += U.clamp((40000 - card.edhrec_rank) / 12000, -1, 3) * 0.6;
      if (a) {
        if (a.isCreature) v += 0.7;
        const mv = a.mv || 0;
        v += mv >= 2 && mv <= 4 ? 0.4 : (mv >= 7 ? -0.6 : 0);
        if (a.isLand && !a.isBasicLand) v += 0.3;
        if (a.isBasicLand) v -= 5;
        const kw = a.keywordSet;
        for (const k of ['flying', 'deathtouch', 'lifelink', 'trample', 'first strike', 'menace', 'vigilance', 'haste'])
          if (kw.has(k)) v += 0.22;
        if (/destroy target|exile target|deals \d+ damage to (any target|target creature)/i.test(card.oracle_text || '')) v += 0.8;
        if (/draw (two|three) cards/i.test(card.oracle_text || '')) v += 0.5;
        // colour commitment: bots settle into two colours as the draft goes on
        const ci = card.color_identity || [];
        if (ci.length === 0) v += 0.35;
        else {
          const commit = ci.reduce((acc, c) => acc + (seat.colorScores[c] || 0), 0) / ci.length;
          const totalPicks = Math.max(1, seat.pool.length);
          const weight = U.clamp(totalPicks / 12, 0, 1.6) * (0.5 + d / 12);
          v += commit * 0.22 * weight;
          if (ci.length >= 3) v -= 0.5;
        }
        // curve awareness at higher difficulty
        if (d >= 5 && a.isCreature) {
          const have = seat.pool.filter(c => Math.floor(c.cmc || 0) === Math.floor(card.cmc || 0)).length;
          v -= Math.max(0, have - 4) * 0.12;
        }
        // a bot cannot play a card that has to be resolved by hand, so it does not take one
        if (!a.isLand && !a.fullyAutomated) v -= 1.5;
      }
      // difficulty noise: a level-1 bot is nearly random, level 10 is steady
      const noise = (1.9 - d * 0.18);
      v += (this.rng.next() - 0.5) * noise * 2;
      return v;
    }

    _maybeAdvance() {
      if (this.pendingPicks.size < this.seats.length) return;
      const used = this._usedAbility || new Map();
      // take the picks
      for (const s of this.seats) {
        const ids = this.pendingPicks.get(s.index) || [];
        const pack = this.packs[s.index];
        const took = [];
        for (const id of ids) {
          const i = pack.findIndex(c => c.id === id);
          if (i < 0) continue;
          const [c] = pack.splice(i, 1);
          s.pool.push(c);
          took.push(c);
          s.picked.push({ round: this.round + 1, pick: this.pickNumber + 1, cardId: c.id, name: c.name });
          for (const col of (c.color_identity || [])) s.colorScores[col] = (s.colorScores[col] || 0) + 1;
          this.history.push({ seat: s.index, round: this.round + 1, pick: this.pickNumber + 1, card: c.name });
        }
        this._resolveAbility(s, used.get(s.index), took, pack);
        this._applyNotes(s, took);
        this._offerOnDraft(s, took);
      }
      this._usedAbility = new Map();
      this._dredgeLastCards();
      this.pickNumber++;
      this.emit('pick:done', this.pickNumber);

      // pass the packs
      const n = this.seats.length;
      const rotated = new Array(n);
      for (let i = 0; i < n; i++) {
        const to = ((i + this.direction) % n + n) % n;
        rotated[to] = this.packs[i];
      }
      this.packs = rotated;

      // a pack Lore Seeker added joins the table wherever there is room
      if (this.extraPacks && this.extraPacks.length) {
        for (let i = 0; i < this.packs.length && this.extraPacks.length; i++) {
          if (!this.packs[i].length) this.packs[i] = this.extraPacks.shift();
        }
      }

      if (this.packs.every(p => p.length === 0)) {
        this.round++;
        for (const s of this.seats) s.sitOutRound = -1;
        if (this.round >= this.cfg.packs) { this._finish(); return; }
        this._openRound();
        return;
      }
      // a round cannot take more picks than there are cards in it
      if (this.pickNumber > (this.cfg.packSize || 15) * 3 + 20) { this._finish(); return; }
      this._beginPick();
    }

    /** Apply whatever the seat spent on this pick. */
    _resolveAbility(seat, ability, took, pack) {
      if (!ability) return;
      seat.spent[ability.cardId] = (seat.spent[ability.cardId] || 0) + 1;
      const def = DRAFT_ABILITIES[U.normName(U.frontName(ability.name))] || {};
      if (ability.kind === 'wholePack') {
        seat.sitOutRound = this.round;
        this.logAbility(`${seat.name} drafts the whole pack with ${ability.name}.`);
      } else if (ability.kind === 'extraPick') {
        if (def.returns) {
          // the card goes back into the pack it helped empty
          const i = seat.pool.findIndex(c => c.id === ability.cardId);
          if (i >= 0) { const [c] = seat.pool.splice(i, 1); pack.push(c); }
          this.logAbility(`${seat.name} puts ${ability.name} back into the pack for an extra card.`);
        } else {
          this.logAbility(`${seat.name} turns ${ability.name} face down for an extra card.`);
        }
      }
      this.emit('ability', { seat: seat.index, card: ability.name, kind: ability.kind });
    }

    /** Cards that offer something the moment they are drafted. */
    _offerOnDraft(seat, took) {
      for (const c of took) {
        const def = draftAbilityOf(c);
        if (def && def.onDraft) {
          this.pendingOffers = this.pendingOffers || [];
          this.pendingOffers.push({ seat: seat.index, seatId: seat.id, cardId: c.id, name: c.name, prompt: def.prompt, kind: def.kind });
        }
      }
    }

    /** Canal Dredger: the last card of a pack goes to whoever holds it. */
    _dredgeLastCards() {
      const owners = this.seats.filter(s => this.abilitiesOf(s).some(a => a.kind === 'lastCard'));
      if (!owners.length) return;
      for (let i = 0; i < this.packs.length; i++) {
        const pack = this.packs[i];
        if (pack.length !== 1) continue;
        const holder = this.seats[i];
        const owner = owners.find(o => o.index !== i) || owners[0];
        if (!owner || owner.index === i) continue;
        const [c] = pack.splice(0, 1);
        owner.pool.push(c);
        owner.picked.push({ round: this.round + 1, pick: this.pickNumber + 1, cardId: c.id, name: c.name });
        this.logAbility(`${owner.name} takes the last card of a pack with Canal Dredger (${holder.name}\u2019s).`);
        this.emit('ability', { seat: owner.index, card: 'Canal Dredger', kind: 'lastCard' });
      }
    }

    _finish() {
      this.finished = true;
      this.emit('draft:done');
      MTG.sfx('notify');
    }

    /* ---------------- cards that act during the draft ---------------- */

    /** Every draft ability this seat is holding, with what is left of it. */
    abilitiesOf(seat) {
      const out = [];
      for (const c of seat.pool) {
        const def = draftAbilityOf(c);
        if (!def) continue;
        const used = seat.spent[c.id] || 0;
        out.push({
          cardId: c.id, card: c, name: c.name, kind: def.kind, known: def.known !== false,
          label: def.label, prompt: def.prompt, uses: def.uses, used,
          left: def.uses === Infinity ? Infinity : Math.max(0, (def.uses || 1) - used),
          passive: !!def.passive, auto: !!def.auto,
          faceDown: def.uses !== Infinity && used >= (def.uses || 1),
        });
      }
      return out;
    }

    /**
     * What this seat could actually do right now. A thing you cannot do is
     * worse than useless in a pick UI, so the pack has to be able to pay for
     * it: an extra pick needs a spare card, the whole-pack grab needs a pack.
     */
    availableAbilities(seatId) {
      const s = this.seats.find(x => x.id === seatId);
      if (!s) return [];
      const pack = this.packs[s.index] || [];
      const want = Math.min(this.cfg.picksPerTurn, pack.length);
      return this.abilitiesOf(s).filter(a => {
        if (a.left <= 0 || a.passive || a.auto) return false;
        if (s.sitOutRound === this.round) return false;
        if (a.kind === 'extraPick') return pack.length > want;
        if (a.kind === 'wholePack') return pack.length > 1;
        if (a.kind === 'exile') return s.pool.length > 1;
        if (a.kind === 'peek') return this.unopenedPacks().length > 0;
        if (a.kind === 'addPack') return false;   // offered as it is drafted
        return a.kind === 'manual';               // shown, but run by hand
      });
    }

    /** Packs nobody has opened yet, for the cards that let you look ahead. */
    unopenedPacks() {
      const out = [];
      for (let r = this.round + 1; r < this.roundPacks.length; r++) {
        for (let i = 0; i < this.roundPacks[r].length; i++)
          out.push({ round: r + 1, seat: i, size: this.roundPacks[r][i].length });
      }
      return out;
    }

    /** Look at one unopened pack. Spends the ability that allowed it. */
    peekPack(seatId, cardId, which) {
      const s = this.seats.find(x => x.id === seatId);
      if (!s) return null;
      const a = this.availableAbilities(seatId).find(x => x.cardId === cardId && x.kind === 'peek');
      if (!a) return null;
      const list = this.unopenedPacks();
      const target = list[U.clamp(which || 0, 0, list.length - 1)];
      if (!target) return null;
      s.spent[cardId] = (s.spent[cardId] || 0) + 1;
      this.emit('ability', { seat: s.index, card: a.name, kind: 'peek' });
      this.touchDraft();
      return { round: target.round, cards: this.roundPacks[target.round - 1][target.seat].slice() };
    }

    /** Cogwork Grinder: a card in your pool leaves the draft for good. */
    exileFromPool(seatId, cardId, targetId) {
      const s = this.seats.find(x => x.id === seatId);
      if (!s) return false;
      const a = this.availableAbilities(seatId).find(x => x.cardId === cardId && x.kind === 'exile');
      if (!a) return false;
      if (targetId === cardId) return false;
      const i = s.pool.findIndex(c => c.id === targetId);
      if (i < 0) return false;
      const [gone] = s.pool.splice(i, 1);
      s.exiled = s.exiled || [];
      s.exiled.push(gone);
      s.spent[cardId] = (s.spent[cardId] || 0) + 1;
      this.emit('ability', { seat: s.index, card: a.name, kind: 'exile', target: gone.name });
      this.touchDraft();
      return true;
    }

    /** Lore Seeker: one more booster joins the draft. */
    addBooster(seatId, cardId) {
      const s = this.seats.find(x => x.id === seatId);
      if (!s) return false;
      const held = this.abilitiesOf(s).find(x => x.cardId === cardId && x.kind === 'addPack');
      if (!held || held.left <= 0) return false;
      const source = this.roundPacks[this.round] || this.roundPacks[0] || [];
      const donor = source[this.rng.int(Math.max(1, source.length))] || [];
      // a fresh pack built the same way as the rest of this round
      const spare = this.spareCards && this.spareCards.length ? this.spareCards : donor;
      const size = this.cfg.packSize || 15;
      const pack = [];
      const seen = new Set();
      for (let g = 0; g < size * 6 && pack.length < size; g++) {
        const c = spare[this.rng.int(spare.length)];
        if (!c || seen.has(c.id)) continue;
        seen.add(c.id); pack.push(c);
      }
      if (!pack.length) return false;
      this.extraPacks = this.extraPacks || [];
      this.extraPacks.push(pack);
      s.spent[cardId] = (s.spent[cardId] || 0) + 1;
      this.emit('ability', { seat: s.index, card: held.name, kind: 'addPack' });
      this.logAbility(`${s.name} adds a booster pack to the draft.`);
      this.touchDraft();
      return true;
    }

    /** Answer a card that offered something the moment it was drafted. */
    answerOffer(seatId, cardId, yes) {
      this.pendingOffers = (this.pendingOffers || []).filter(o => !(o.seatId === seatId && o.cardId === cardId) || (yes && false));
      if (!yes) { this.touchDraft(); return true; }
      const ok = this.addBooster(seatId, cardId);
      this.touchDraft();
      return ok;
    }

    logAbility(text) { this.abilityLog = (this.abilityLog || []).concat([text]); }
    touchDraft() { this.emit('pick:done', this.pickNumber); }

    /** The note-taking cards write on the pick as it happens. */
    _applyNotes(seat, cards) {
      for (const a of this.abilitiesOf(seat)) {
        if (!a.auto || !cards.length) continue;
        for (const c of cards) seat.notes.push({ by: a.name, card: c.name, round: this.round + 1, pick: this.pickNumber + 1 });
      }
    }

    viewFor(seatId) {
      const s = this.seats.find(x => x.id === seatId);
      return {
        you: seatId, formatId: this.cfg.formatId,
        round: this.round + 1, totalRounds: this.cfg.packs,
        pick: this.pickNumber + 1,
        started: this.started, finished: this.finished,
        setsUsed: this.setsUsed || [],
        looseSets: this.looseSets || [],
        picksPerTurn: this.cfg.picksPerTurn,
        faceUp: this.cfg.faceUp,
        pack: s ? (this.packs[s.index] || []) : [],
        pool: s ? s.pool : [],
        abilities: s ? this.abilitiesOf(s) : [],
        canUse: s ? this.availableAbilities(seatId) : [],
        offers: (this.pendingOffers || []).filter(o => s && o.seatId === s.id),
        sittingOut: s ? s.sitOutRound === this.round : false,
        notes: s ? s.notes : [],
        exiled: s ? (s.exiled || []) : [],
        abilityLog: (this.abilityLog || []).slice(-8),
        waitingOn: this.seats.filter(x => !this.pendingPicks.has(x.index)).map(x => x.name),
        seats: this.seats.map(x => ({
          id: x.id, name: x.name, isBot: x.isBot, poolSize: x.pool.length,
          picked: this.cfg.faceUp ? x.picked : undefined,
          done: this.pendingPicks.has(x.index),
        })),
      };
    }
  }

  /* ---------------- build a deck out of a drafted pool ---------------- */

  /**
   * Auto-build a limited deck: pick the best two colours, take the playables,
   * fill with basics to the right land count.
   */
  function autoBuildLimited(pool, opts) {
    opts = opts || {};
    const target = opts.deckSize || 40;
    const basics = opts.basicCards || {};
    const scored = new Map();
    const score = (c) => {
      if (scored.has(c)) return scored.get(c);
      const v = rawScore(c);
      scored.set(c, v);
      return v;
    };
    const rawScore = (c) => {
      const a = MTG.oracle.analyze(c);
      /* The bots' card judge reads what a card actually does here, and
         marks down the ones the table cannot run by itself. */
      if (a && !a.isLand && MTG.bots && MTG.bots.rateCard) {
        return MTG.bots.rateCard(c, { limited: true, prior: 0.3 }) + (a.isCreature ? 0.4 : 0);
      }
      let v = { common: 1, uncommon: 1.6, rare: 2.4, mythic: 2.8 }[c.rarity] || 1;
      if (a) {
        if (a.isCreature) v += 0.8;
        if (a.isBasicLand) return -99;
        if (a.isLand) v += 0.4;
        const mv = a.mv || 0;
        if (mv >= 2 && mv <= 4) v += 0.4; else if (mv >= 7) v -= 0.8;
        for (const k of ['flying', 'deathtouch', 'lifelink', 'trample', 'first strike'])
          if (a.keywordSet.has(k)) v += 0.2;
        if (/destroy target|exile target/i.test(c.oracle_text || '')) v += 0.7;
      }
      return v;
    };
    // colour pair with the most total value
    const pairs = [];
    const C = MTG.mana.COLORS;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const pair = [C[i], C[j]];
      const playable = pool.filter(c => {
        const ci = c.color_identity || [];
        return ci.every(col => pair.includes(col));
      });
      // a pair is as good as the deck it makes, not as deep as its sideboard
      const top = playable.map(score).sort((x, y) => y - x).slice(0, 23);
      pairs.push({ pair, total: U.sum(top), playable });
    }
    pairs.sort((a, b) => b.total - a.total);
    const best = pairs[0] || { pair: ['W', 'U'], playable: pool.slice() };

    const spells = best.playable
      .filter(c => { const a = MTG.oracle.analyze(c); return a && !a.isBasicLand; })
      .sort((a, b) => score(b) - score(a));

    const nonBasicLands = spells.filter(c => { const a = MTG.oracle.analyze(c); return a && a.isLand; });
    const realSpells = spells.filter(c => { const a = MTG.oracle.analyze(c); return a && !a.isLand; });

    const avgMv = realSpells.length ? U.sum(realSpells.slice(0, 23).map(c => c.cmc || 0)) / Math.min(23, realSpells.length) : 3;
    const landCount = MTG.formats.suggestedLands(target, avgMv);
    const spellCount = target - landCount;

    /* Creatures first — a limited deck without fifteen or so of them has
       nothing to win with — then the best of everything else, keeping the
       top of the curve to a handful of cards. */
    const chosen = [];
    const isCreature = (c) => { const a = MTG.oracle.analyze(c); return !!(a && a.isCreature); };
    const wantCreatures = Math.round(spellCount * 0.65);
    for (const c of realSpells) {
      if (chosen.length >= wantCreatures) break;
      if (isCreature(c) && score(c) >= 2.5) chosen.push(c);
    }
    let top = chosen.filter(c => (c.cmc || 0) >= 6).length;
    for (const c of realSpells) {
      if (chosen.length >= spellCount) break;
      if (chosen.includes(c)) continue;
      if ((c.cmc || 0) >= 6 && top >= 3) continue;
      if ((c.cmc || 0) >= 6) top++;
      chosen.push(c);
    }
    for (const c of realSpells) {
      if (chosen.length >= spellCount) break;
      if (!chosen.includes(c)) chosen.push(c);
    }
    const utilLands = nonBasicLands.slice(0, Math.min(2, landCount - 2));
    const basicsNeeded = landCount - utilLands.length;

    // split basics by coloured pip demand
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of chosen) for (const s of MTG.mana.parse(c.mana_cost || ''))
      for (const col of C) if (s.includes(col)) pips[col]++;
    const activeColors = best.pair.filter(c => pips[c] > 0);
    const totalPips = U.sum(activeColors.map(c => pips[c])) || 1;

    const main = [];
    const addCard = (card, qty) => {
      const e = main.find(x => x.card.id === card.id);
      if (e) e.qty += qty; else main.push({ card, qty });
    };
    for (const c of chosen) addCard(c, 1);
    for (const c of utilLands) addCard(c, 1);

    const basicName = MTG.mana.BASIC_FOR;
    let placed = 0;
    (activeColors.length ? activeColors : best.pair).forEach((col, idx, arr) => {
      const share = activeColors.length ? Math.round(basicsNeeded * (pips[col] / totalPips)) : Math.floor(basicsNeeded / arr.length);
      const qty = idx === arr.length - 1 ? basicsNeeded - placed : share;
      placed += qty;
      const card = basics[basicName[col]];
      if (card && qty > 0) addCard(card, qty);
    });

    // a short pool means fewer playables than the target; top up with basics
    let have = U.sum(main.map(e => e.qty));
    let guard = 0;
    const fillColors = (activeColors.length ? activeColors : best.pair);
    while (have < target && guard++ < 200) {
      const col = fillColors[guard % fillColors.length];
      const card = basics[basicName[col]];
      if (!card) break;
      addCard(card, 1);
      have++;
    }
    while (have > target && guard++ < 400) {
      const e = main.find(x => MTG.formats.isBasicLand(x.card) && x.qty > 1) || main[main.length - 1];
      if (!e) break;
      e.qty--; have--;
      if (e.qty <= 0) main.splice(main.indexOf(e), 1);
    }

    const leftovers = pool.filter(c => !chosen.includes(c) && !utilLands.includes(c));
    return {
      id: MTG.uid('deck'),
      name: opts.name || 'Drafted deck',
      format: opts.formatId || 'booster',
      main,
      sideboard: leftovers.map(c => ({ card: c, qty: 1 })),
      commanders: [],
      colors: best.pair,
      createdAt: Date.now(),
      source: 'draft',
    };
  }

  /** Fetch the five basic lands once, for limited deck building. */
  let basicsCache = null;
  async function getBasics(setCode) {
    if (basicsCache && !setCode) return basicsCache;
    const names = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const ids = names.map(n => setCode ? { name: n, set: setCode } : { name: n });
    const { cards } = await MTG.scry.collection(ids);
    const out = {};
    names.forEach((n, i) => { if (cards[i]) out[n] = cards[i]; });
    if (!setCode) basicsCache = out;
    return out;
  }

  MTG.draft = {
    recipes: CUBE_RECIPES, buildRecipe,
    DRAFT_ABILITIES, draftAbilityOf, LAND_SLOT_MIX,
    Draft, makeBooster, makeCubePack, boosterSpecFor,
    PLAY_BOOSTER, DRAFT_BOOSTER, COLLECTOR_BOOSTER, WILDCARD_MIX,
    cubes, autoBuildLimited, getBasics,
  };
})(window.MTG);


