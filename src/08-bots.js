/* ============================================================
   08-bots.js - computer opponents
   Two jobs: build a legal deck for any format at a chosen difficulty,
   and play it. Difficulty runs 1-10 and scales both how strong a deck
   the bot builds and how carefully it plays.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const O = MTG.oracle;

  /* ============================================================
     The ladder
     Every number a bot consults lives here, so what a level means can be
     read off one table:
       deckPower      how strong the cards it builds with are allowed to be
       skill          how often a play decision is the right one
       manabase       0-4: how many dual lands and fixers it bothers with
       holdRemoval    how readily it saves an answer for a real threat
       instantTiming  how often it waits for the other player's turn to
                      cast what can be cast then
       counterSense   how well it picks what to counter
       blunder        the chance of a visible, believable mistake: an
                      attack into a bad block, a missed block, a removal
                      spell spent on the wrong creature
     poolDepth is how deep into the popularity lists it reaches for a
     commander's partner.
     ============================================================ */
  const DIFFICULTY = {
    1:  { label: 'Goldfish',     poolDepth: 300, deckPower: 0.00, skill: 0.05, manabase: 0, holdRemoval: 0,    instantTiming: 0,    counterSense: 0,    blunder: 0.5 },
    2:  { label: 'Beginner',     poolDepth: 250, deckPower: 0.08, skill: 0.12, manabase: 0, holdRemoval: 0,    instantTiming: 0,    counterSense: 0.1,  blunder: 0.42 },
    3:  { label: 'Casual',       poolDepth: 200, deckPower: 0.17, skill: 0.22, manabase: 1, holdRemoval: 0.1,  instantTiming: 0.1,  counterSense: 0.25, blunder: 0.35 },
    4:  { label: 'Kitchen table',poolDepth: 160, deckPower: 0.27, skill: 0.32, manabase: 1, holdRemoval: 0.2,  instantTiming: 0.2,  counterSense: 0.4,  blunder: 0.3 },
    5:  { label: 'Steady',       poolDepth: 130, deckPower: 0.38, skill: 0.42, manabase: 2, holdRemoval: 0.35, instantTiming: 0.35, counterSense: 0.5,  blunder: 0.25 },
    6:  { label: 'Practised',    poolDepth: 100, deckPower: 0.50, skill: 0.54, manabase: 2, holdRemoval: 0.5,  instantTiming: 0.5,  counterSense: 0.62, blunder: 0.19 },
    7:  { label: 'Sharp',        poolDepth: 80,  deckPower: 0.62, skill: 0.67, manabase: 3, holdRemoval: 0.65, instantTiming: 0.65, counterSense: 0.74, blunder: 0.12 },
    8:  { label: 'Competitive',  poolDepth: 60,  deckPower: 0.75, skill: 0.8 , manabase: 3, holdRemoval: 0.78, instantTiming: 0.78, counterSense: 0.85, blunder: 0.07 },
    9:  { label: 'Spike',        poolDepth: 45,  deckPower: 0.88, skill: 0.9 , manabase: 4, holdRemoval: 0.88, instantTiming: 0.9,  counterSense: 0.93, blunder: 0.03 },
    10: { label: 'Cutthroat',    poolDepth: 30,  deckPower: 1.00, skill: 1.00, manabase: 4, holdRemoval: 0.95, instantTiming: 1.0,  counterSense: 1.0,  blunder: 0 },
  };
  /* Habits: the things a player either does or does not do yet, which
     come with the level rather than with a roll of the dice. */
  const HABITS = {
    spellCap:     [1, 2, 2, 99, 99, 99, 99, 99, 99, 99],   // spells cast in a turn, at most
    plan:         [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],          // weighs combinations of spells for the mana
    attackSearch: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],          // works out the whole attack, not creature by creature
    walkers:      [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],          // sends attackers at planeswalkers
    chump:        [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],          // blocks to survive when the attack is lethal
    doubleBlock:  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],          // gangs up on a big attacker
    strictMull:   [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],          // sends back a hand that cannot do anything early
    reckless:     [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],          // attacks with nearly everything, every turn
    blockSearch:  [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],          // weighs all its blocks together against its life total
    modelBlocks:  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1],          // plays out the defender's blocks before choosing an attack
  };
  const cfgCache = new Map();
  function diffCfg(d) {
    const lv = U.clamp(Math.round(d || 5), 1, 10);
    if (!cfgCache.has(lv)) {
      const out = Object.assign({}, DIFFICULTY[lv]);
      for (const k of Object.keys(HABITS)) out[k] = HABITS[k][lv - 1];
      out.look = LOOKAHEAD[lv] || null;
      cfgCache.set(lv, out);
    }
    return cfgCache.get(lv);
  }

  /* ============================================================
     Personalities
     Difficulty is how well a bot plays; personality is how it likes to
     play, and the two are separate dials. A personality leans on the
     deck it builds (the archetype, colours and theme it reaches for), on
     its habits at the table (how readily it attacks, blocks, holds an
     answer or burns a face), on how it judges a position when it looks
     ahead, and, at a bigger table, on whom it picks on. The leans are
     small next to the gaps between levels, so a Cautious level 9 is still
     a level 9.

       label, blurb   for a lobby picker
       deck           archetype and colour weights, how readily it builds
                      around a theme, which themes it likes, what it likes
                      in a card (fit)
       play           leans, each 0 when absent:
                        attack  + attacks more readily, - holds back
                        block   + blocks more readily
                        hold    + saves removal for a real threat
                        face    + points burn at players
                        leader  + goes after whoever is winning (bigger tables)
                        spread  + spreads its attacks around (bigger tables)
                        splash  + casts its biggest spell first
       eval           weights on the look-ahead judge (see EVAL)
       epithets       how its name ends ("Mara the Reckless")
       avatar         what kind of card in its deck is its face, and a few
                      cards to fall back on
     The lobby asks for a seat as { difficulty, personality }; leave the
     personality out and the bot picks one that suits the deck it built.
     ============================================================ */
  const PERSONALITIES = {
    aggressive: {
      label: 'Aggressive', blurb: 'Attacks at every chance, races, and points its burn at your face.',
      deck: { arch: { aggro: 1.8, midrange: 0.8, control: 0 }, colours: { R: 1.7, W: 1.3, B: 1.0, G: 0.9, U: 0.5 },
        themeChance: -0.1, themes: { tokens: 1.3, counters: 1.2, spells: 1.1 },
        fit: (c) => (c.creature && c.mv <= 3 && (parseInt(c.a.power, 10) || 0) >= c.mv ? 0.25 : 0) +
          (c.a.has('haste') ? 0.2 : 0) + (c.roles.has('burn') ? 0.2 : 0) },
      play: { attack: 0.8, block: -0.3, hold: -0.25, face: 1 },
      eval: { oppLife: 1.6, life: 0.75 },
      epithets: ['the Reckless', 'Firebrand', 'Swiftblade', 'the Bold', 'Redfang', 'Skullsplitter'],
      avatar: { want: 'fast', cards: ['Goblin Guide', 'Monastery Swiftspear', 'Lightning Bolt'] },
    },
    cautious: {
      label: 'Cautious', blurb: 'Keeps blockers home, saves its removal for what matters, and wins the long game.',
      deck: { arch: { aggro: 0.7, midrange: 1.6, control: 0 }, colours: { W: 1.2, U: 1.5, B: 1.2, G: 1.0, R: 0.6 },
        themeChance: 0, themes: { lifegain: 1.3, flyers: 1.2 },
        fit: (c) => (c.roles.has('removal') ? 0.25 : 0) + (c.roles.has('draw') ? 0.15 : 0) +
          (c.creature && (parseInt(c.a.toughness, 10) || 0) >= 4 && c.mv <= 4 ? 0.15 : 0) },
      play: { attack: -0.35, block: 0.35, hold: 0.2, face: -0.5 },
      eval: { life: 1.5, oppLife: 0.75, hand: 1.2 },
      epithets: ['the Patient', 'the Watchful', 'Wallwarden', 'the Wary', 'Stillwater', 'Shieldbearer'],
      avatar: { want: 'answer', cards: ['Wall of Omens', 'Counterspell', 'Swords to Plowshares'] },
    },
    value: {
      label: 'Engine builder', blurb: 'Builds around a plan and puts its engines together piece by piece.',
      deck: { arch: { aggro: 0.8, midrange: 1.5, control: 0 }, colours: { U: 1.2, G: 1.3, B: 1.2, W: 1.0, R: 0.9 },
        themeChance: 0.45, themes: { artifacts: 1.4, sacrifice: 1.4, graveyard: 1.3, counters: 1.2, tokens: 1.2 },
        planFit: 1.6,
        fit: (c) => (!c.creature && c.a.isPermanent && c.r >= 3.5 ? 0.2 : 0) + (c.roles.has('draw') ? 0.1 : 0) },
      play: { engine: 1, hold: 0.1 },
      eval: { board: 1.1, hand: 1.2 },
      epithets: ['the Collector', 'Cogwright', 'the Tinkerer', 'Gearwise', 'the Planner', 'Loremaster'],
      avatar: { want: 'engine', cards: ['Sol Ring', 'Rhystic Study', 'Skullclamp'] },
    },
    chaotic: {
      label: 'Chaotic', blurb: 'Big creatures and splashy spells; never quite does what you expect.',
      deck: { arch: { aggro: 0.8, midrange: 1.5, control: 0 }, colours: { R: 1.3, G: 1.5, B: 1.0, U: 0.9, W: 0.8 },
        themeChance: 0, themes: { flyers: 1.2, tokens: 1.1 },
        fit: (c) => (c.creature && c.mv >= 5 ? 0.35 : 0) + (/\{X\}/.test(c.card.mana_cost || '') ? 0.25 : 0) +
          (c.creature && (parseInt(c.a.power, 10) || 0) >= 5 ? 0.2 : 0) },
      play: { attack: 0.3, splash: 1, chaos: 0.1 },
      eval: { board: 1.15 },
      epithets: ['the Wild', 'Stormcaller', 'the Gambler', 'Bigdreams', 'the Unbound', 'Thunderfoot'],
      avatar: { want: 'big', cards: ['Craterhoof Behemoth', 'Ghalta, Primal Hunger', 'Etali, Primal Storm'] },
    },
    political: {
      label: 'Political', blurb: 'At a bigger table, goes after whoever is winning and spreads its threats around.',
      deck: { arch: { aggro: 0.9, midrange: 1.3, control: 0 }, colours: { W: 1.2, U: 1.1, B: 1.3, R: 1.0, G: 1.0 },
        themeChance: 0, themes: {},
        fit: (c) => (c.roles.has('removal') ? 0.15 : 0) + (c.roles.has('wipe') ? 0.15 : 0) },
      play: { leader: 1, spread: 1, hold: 0.1 },
      eval: { leader: 0.95 },
      epithets: ['the Diplomat', 'Silvertongue', 'the Kingmaker', 'the Broker', 'Oathkeeper', 'the Envoy'],
      avatar: { want: 'leader', cards: ['Kwain, Itinerant Meddler', 'Marchesa, the Black Rose', 'Queen Marchesa'] },
    },
  };
  const FIRST_NAMES = ['Mara', 'Tobin', 'Ilsa', 'Corvin', 'Neve', 'Bram', 'Odessa', 'Kael', 'Yara', 'Fenn', 'Lio', 'Sabra',
    'Dunstan', 'Wren', 'Isolde', 'Ash', 'Petra', 'Hollis', 'Juno', 'Ravi', 'Saoirse', 'Tamsin', 'Oren', 'Vesna'];

  /** How much a personality's tastes count in the deck a bot builds: fully at the bottom, a fifth at the top. */
  function persDeckWeight(cfg) { return 1 - (cfg.deckPower || 0) * 0.8; }

  /** A personality that suits a deck already built: an aggro list is usually played aggressively. */
  function personalityFor(deck, rng) {
    const plan = (deck && deck.plan) || {};
    const w = { aggressive: 1, cautious: 1, value: 1, chaotic: 1, political: 0.3 };
    if (plan.archetype === 'aggro') Object.assign(w, { aggressive: 6, chaotic: 1, value: 0.6, cautious: 0.3 });
    else if (plan.archetype === 'control') Object.assign(w, { cautious: 4, value: 1.5, aggressive: 0.2 });
    else if (plan.archetype === 'commander') Object.assign(w, { political: 2.5, value: 2, chaotic: 1.5, cautious: 1, aggressive: 1 });
    else Object.assign(w, { cautious: 2, value: 2, chaotic: 1.5, aggressive: 1 });
    if (plan.theme) w.value += 2;
    return rng.weighted(Object.entries(w));
  }

  /** "Mara the Reckless": a name in the personality's style, not already at the table. */
  function nameFor(personality, rng, taken) {
    const p = PERSONALITIES[personality] || PERSONALITIES.value;
    const used = new Set(taken || []);
    for (let i = 0; i < 40; i++) {
      const n = rng.pick(FIRST_NAMES) + ' ' + rng.pick(p.epithets);
      if (!used.has(n)) return n;
    }
    return rng.pick(FIRST_NAMES) + ' ' + rng.pick(p.epithets) + ' ' + (2 + rng.int(8));
  }

  /**
   * The card a bot shows as its face: the most on-brand card in its own
   * deck (its commander first, if it has one), or a card from the
   * personality's own short list when the deck has nothing that fits.
   * Returns { card } with a card from the deck, or { name } to look up.
   */
  function avatarFor(personality, deck) {
    const p = PERSONALITIES[personality] || PERSONALITIES.value;
    const cmds = (deck && deck.commanders) || [];
    if (cmds.length) return { card: cmds[0] };
    const cards = ((deck && deck.main) || []).map(e => e.card).filter(c => c && !/Land/.test(c.type_line || ''));
    const pw = (c) => parseInt(c.power, 10) || 0;
    let pick = null;
    const by = (score) => cards.slice().sort((x, y) => score(y) - score(x))[0] || null;
    if (p.avatar.want === 'fast') pick = by(c => (/Creature/.test(c.type_line) ? pw(c) - (c.cmc || 0) * 0.6 + (/Haste/i.test(c.oracle_text || '') ? 1 : 0) : -9));
    else if (p.avatar.want === 'answer') pick = by(c => (rolesOf(c).has('removal') ? 2 : 0) + (rolesOf(c).has('draw') ? 1 : 0) + rateCard(c, { prior: 0 }) * 0.3);
    else if (p.avatar.want === 'big') pick = by(c => (/Creature/.test(c.type_line) ? pw(c) + (c.cmc || 0) : -9));
    else pick = by(c => rateCard(c, { prior: 0 }) + (/Legendary|Planeswalker/.test(c.type_line || '') ? 1 : 0));
    return pick ? { card: pick } : { name: p.avatar.cards[0] };
  }

  const BASIC_FOR = MTG.mana.BASIC_FOR;

  /** Scryfall colour-identity token for a set of colours. */
  function idToken(colors) {
    if (!colors || !colors.length) return 'id:c';
    return 'id<=' + colors.join('');
  }

  /**
   * The other half of a commander that has one.
   *
   * Partner, Partner with, Friends forever, Backgrounds and the Doctor
   * pairings are the whole point of the cards that carry them: a bot that
   * picks Thrasios and then plays alone has brought half a deck. This finds
   * the second card the same way it found the first — by play rate, with
   * difficulty deciding how deep it reaches.
   */
  async function findPartner(cmd, legalKey, cfg, rng) {
    const info = MTG.formats.partnerInfo(cmd);
    const isDoctor = /\bDoctor\b/.test(cmd.type_line || '') && /Time Lord/i.test(cmd.type_line || '');

    // "Partner with Xyz" names its other half outright
    if (info.partnerWith) {
      try { return (await MTG.scry.byName(info.partnerWith)) || null; } catch (e) { return null; }
    }

    let q = null;
    if (info.partner) q = `is:commander legal:${legalKey} o:"Partner" -o:"Partner with" -t:background`;
    else if (info.friendsForever) q = `is:commander legal:${legalKey} o:"Friends forever"`;
    else if (info.background) q = `legal:${legalKey} t:background`;
    else if (info.doctor) q = `legal:${legalKey} t:doctor t:"time lord"`;
    // a Doctor is a whole commander on its own, so it only sometimes brings one
    else if (isDoctor && rng.chance(0.6)) q = `is:commander legal:${legalKey} o:"Doctor's companion"`;
    if (!q) return null;

    let pool = [];
    try { pool = await MTG.scry.search(q + ' -is:digital lang:en', { order: 'edhrec', unique: 'cards', max: 100 }); }
    catch (e) { return null; }
    pool = pool.filter(c => c.oracle_id !== cmd.oracle_id && U.normName(c.name) !== U.normName(cmd.name));
    // a Background pairs with a creature, not with another Background
    if (info.background) pool = pool.filter(c => /Background/.test(c.type_line || ''));
    else if (info.partner) pool = pool.filter(c => MTG.formats.partnerInfo(c).partner);
    else if (info.friendsForever) pool = pool.filter(c => MTG.formats.partnerInfo(c).friendsForever);
    if (!pool.length) return null;
    const depth = U.clamp(cfg.poolDepth, 8, pool.length);
    return pool.slice(0, depth)[rng.int(Math.min(depth, pool.length))] || null;
  }


  /* ============================================================
     Part 1 - judging cards
     One yardstick for how good a card is, shared by deck building, the
     draft, and a bot deciding what to cast, keep or throw away. It reads
     the same analysis the engine plays from, so it rates what a card
     does at this table rather than what its text promises.

     The unit is mana: a vanilla creature is worth about what it costs,
     a card drawn is worth a little over one and a half, and killing a
     creature is worth about three. A card's rating is then three, plus
     how far ahead of its cost it comes out — so 3 is filler, 4 is a
     solid playable, 5 and up is a card you build around.
     ============================================================ */

  /** The engine's reading of a card, or nothing if the card defeats it. */
  function analyse(card) {
    try { return O.analyze(card); } catch (e) { return null; }
  }

  /** A number out of an effect field, with X read as a modest two. */
  function nval(v, dflt) {
    // "+9999/+0" is a joke, not a number to add up
    if (typeof v === 'number') return Math.max(-10, Math.min(10, v));
    if (v == null) return dflt == null ? 1 : dflt;
    if (v === 'X' || v === 'x') return 2;
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return Math.max(-10, Math.min(10, n));
    if (typeof v === 'object') return 2;          // "for each creature you control" and friends
    return dflt == null ? 1 : dflt;
  }

  /** How a body and its keywords weigh up, in mana. */
  function bodyWorth(power, tough, has) {
    const P = U.clamp(power, 0, 12), T = U.clamp(tough, 0, 12);
    let v = (P + T * 0.5) / 1.5;
    let kw = 0;
    if (has('flying')) kw += 0.2 + P * 0.3;
    if (has('trample')) kw += P * 0.15;
    if (has('haste')) kw += P * 0.3;
    if (has('deathtouch')) kw += P <= 2 ? 1.3 : 1.0;
    if (has('lifelink')) kw += P * 0.3;
    if (has('double strike')) kw += P * 0.9;
    else if (has('first strike')) kw += 0.2 + P * 0.3;
    if (has('vigilance')) kw += 0.1 + P * 0.15;
    if (has('menace')) kw += P * 0.3;
    if (has('hexproof')) kw += 0.8;
    else if (has('shroud')) kw += 0.4;
    if (has('indestructible')) kw += 1.5;
    if (has('ward')) kw += 0.6;
    if (has('reach')) kw += 0.3;
    if (has('flash')) kw += 0.4;
    if (has('prowess')) kw += 0.5;
    if (has('defender')) kw -= Math.max(1, P) + 0.5;
    // seven keywords on one body are not seven times as good as one
    if (kw > 2.5) kw = 2.5 + (kw - 2.5) * 0.4;
    return v + kw / 1.5;
  }

  /** What one target spec is likely to hit, as a kill: creatures, anything, or less. */
  function hitsCreatures(spec) {
    if (!spec) return false;
    if (spec.controller === 'you') return false;
    return spec.type === 'creature' || spec.type === 'any' ||
      (spec.type === 'permanent' && (!spec.anyOf || spec.anyOf.includes('creature')));
  }

  /** Roughly how much one effect is worth, in mana. */
  function effectWorth(e, depth) {
    if (!e || (depth || 0) > 5) return 0;
    const d = (depth || 0) + 1;
    const n = nval(e.n, 1);
    const tg = (e.targets || [])[0] || null;
    const narrow = tg && (tg.maxMv != null || tg.maxPower != null || tg.maxToughness != null ||
      tg.attacking || tg.blocking || tg.tapped === true || tg.minPower != null) ? 0.8 : 1;
    const who = e.who || 'you';
    const sub = (list) => U.sum((list || []).map(x => effectWorth(x, d)));
    /* Something done to the card itself is usually the price of it:
       Ball Lightning's sacrifice, a creature that goes back to hand. */
    if (e.scope === 'self' && /^(bounce|exile|destroy|tap|sacrificeSelf|selfToLibrary)$/.test(e.op)) return -1.5;
    switch (e.op) {
      // a Room's other door: the rest of the card, bought late
      case 'unlockDoor': return 3;
      case 'draw':
        if (who === 'opponents' || who === 'target') return -n * 0.6;
        if (who === 'each' || who === 'all') return n * 0.5;
        return n * 1.3;
      case 'drawDiscard': return n * 0.6;
      case 'wheel': return 1.5;
      case 'damage': {
        if (e.toSelf) return -n * 0.3;
        if (e.each) {
          if (/creature/.test(e.each)) return 1.2 + Math.min(n, 4) * 0.3;
          if (/opponent/.test(e.each)) return n * 0.5;
          return n * 0.2;
        }
        if (!tg) return n * 0.4;
        if (tg.type === 'player') return n * 0.5;
        const kill = n <= 1 ? 0.7 : n === 2 ? 1.9 : n === 3 ? 2.6 : n === 4 ? 2.9 : 3.1;
        return (kill + (tg.type === 'any' ? 0.4 : 0)) * (tg.controller === 'you' ? 0.2 : 1);
      }
      case 'damageDivided': return 2.2;
      // it needs a creature of ours to do the hitting, and dies with it
      case 'damageByPower': case 'fight': return 1.5;
      case 'bite': return 1.7;
      case 'destroy': case 'exile': {
        if (!tg) return e.op === 'exile' ? 0.3 : 0.5;
        if ((tg.zone && tg.zone !== 'battlefield') || /graveyard|library|hand/.test(tg.filter || '')) return 0.3;
        if (tg.controller === 'you') return 0.2;
        let v = 0.8;
        if (hitsCreatures(tg)) v = 3.0;
        else if (tg.type === 'planeswalker') v = 1.6;
        else if (tg.type === 'artifact' || tg.type === 'enchantment') v = 1.2;
        else if (tg.type === 'land') v = 0.8;
        if (tg.nonland || (tg.anyOf && tg.anyOf.length >= 3)) v = 3.3;
        return v * narrow + (e.op === 'exile' ? 0.2 : 0);
      }
      case 'exileUntilLeaves': return 3.0 * narrow;
      case 'bounce': return tg && tg.controller === 'you' ? 0.3 : 1.2 * narrow;
      case 'tap': return 0.4;
      case 'untap': return 0.2;
      // "counter target blue spell" is a sideboard card
      case 'counterSpell': return tg && /\b(?:white|blue|black|red|green|creature|noncreature|instant|sorcery|artifact|enchantment)\b/.test(tg.filter || '') ? 1.4 : 2.6;
      case 'counterUnless': return 1.6;
      case 'createToken': {
        const pt = String(e.pt || '1/1').split('/');
        const p = parseInt(pt[0], 10) || 0, t = parseInt(pt[1], 10) || 0;
        const each = Math.max(0.6, (p + t * 0.5) / 1.5 + (e.keywords && e.keywords.length ? 0.4 : 0));
        const cnt = e.countBy ? 2 : n;
        return each * cnt * (e.who === 'targetController' ? -0.6 : 1);
      }
      case 'createNamedToken': return 0.6 * n;
      case 'amass': return 0.6 * n;
      case 'populate': return 1.0;
      case 'counters': {
        if (e.kind && !/\+1\/\+1/.test(e.kind)) return /-1\/-1/.test(e.kind) ? n * 0.6 : 0.3;
        if (e.scope === 'yourCreatures' || e.scope === 'yourMatching') return n * 1.4;
        return n * 0.6;
      }
      case 'adapt': case 'monstrosity': return n * 0.55;
      case 'proliferate': return 0.6;
      case 'pump': {
        const big = Math.max(0, nval(e.p, 0)) + Math.max(0, nval(e.t, 0)) * 0.5;
        if (e.scope === 'yourCreatures') return 0.6 + big * 0.5;
        if (e.scope === 'allCreatures') return 0.2;
        if (e.duration === 'eot') return 0.3 + big * 0.15;
        return big / 1.5;
      }
      case 'anthem': return 2.0;
      case 'grantKeyword': return 0.4;
      case 'gainLife': return who === 'opponents' ? -0.1 * n : Math.min(1.2, n * 0.12);
      case 'loseLife': return who === 'you' ? -0.15 * n : n * 0.35;
      case 'drain': return n * 0.45;
      case 'discard':
        if (who === 'you') return -0.6 * n;
        if (who === 'each' || who === 'all') return 0.2;
        return 0.9 * n;
      case 'discardChosen': case 'exileChosen': return 1.3;
      case 'handAttack': return 1.0;
      case 'mill': return who === 'you' ? 0.1 * n : 0.08 * n;
      case 'tutor': return e.to === 'battlefield' ? 2.0 : 1.4;
      case 'fetchBasic': return who === 'targetController' ? -0.4 : 1.1 * n;
      case 'landFromHand': return 0.8;
      case 'extraLand': return 0.6;
      case 'scry': return 0.22 * n;
      case 'surveil': return 0.28 * n;
      case 'explore': return 0.7;
      case 'connive': return 0.6;
      case 'impulse': return 0.9 * n;
      case 'lookTop': case 'peekTop': case 'reveal': return 0.1;
      case 'takeFromLooked': return 1.2;
      case 'regrowth': return 1.2;
      case 'reanimate': return 2.6;
      case 'returnOwn': return 0.3;
      case 'destroyAll': case 'exileAll': return 2.8;
      case 'bounceAll': return 1.6;
      case 'tapAll': return 0.9;
      case 'sacrificeChoice':
        if (who === 'you') return -0.9 * n;
        if (who === 'each') return 0.6 * n;
        return 2.2 * n;
      case 'gainControl': return e.until ? 0.9 : 4.0;
      case 'sacrificeSelf': case 'exileSelf': case 'selfToLibrary': return -2.5;
      case 'copyPermanent': case 'etbAsCopy': return 2.0;
      case 'copySpell': case 'copyThatSpell': return 1.4;
      case 'blink': return 0.8;
      case 'extraTurn': return 5.0;
      case 'winGame': return 4.0;
      case 'becomeMonarch': return 2.0;
      case 'takeInitiative': return 2.0;
      case 'energy': return 0.3 * n;
      case 'goad': return 0.6;
      case 'restrict': case 'cantBlock': case 'cantAttack': return 0.4;
      case 'preventDamage': case 'preventNext': return 0.3;
      case 'regenerate': return 0.5;
      case 'untapAll': return 0.3;
      case 'addMana': case 'addManaAny': case 'addManaChoice': case 'addManaChosen': return 0.5 * n;
      case 'addManaPer': return 1.2;
      case 'transformSelf': return 0.5;
      case 'ringTempts': return 0.7;
      case 'manual': return -3;
      case 'modal': {
        const vals = (e.modes || []).map(m => U.sum((m.effects || []).map(x => effectWorth(x, d))))
          .sort((a, b) => b - a);
        // paw prints: the best mode for its price, as often as the budget allows
        if (e.pawprint) {
          const per = (e.modes || []).map(m => U.sum((m.effects || []).map(x => effectWorth(x, d))) / Math.max(1, m.weight || 1));
          return Math.max(0, ...per) * nval(e.pawprint, 1);
        }
        const k = e.spree ? 1 : Math.max(1, Math.min(nval(e.count, 1), vals.length));
        return U.sum(vals.slice(0, k)) + (vals.length > k ? 0.4 : 0);
      }
      case 'may': case 'sequence': case 'ifCond': case 'delayed': case 'ifLastWas': case 'mayPay':
        return sub(e.then) + sub(e.effects) + sub(e.otherwise) * 0.3;
      case 'flipCoin': return (sub(e.then) + sub(e.otherwise)) * 0.5;
      case 'continuous': return continuousWorth(e);
      default: return 0.15;
    }
  }

  /** A standing effect: an equipment's bonus, an anthem, a leash on a creature. */
  function continuousWorth(e) {
    const scope = e.scope || {};
    const pt = e.pt || e.setPt || null;
    const kws = (e.grant || []).length;
    const flag = String(e.flag || '');
    if (/cantAttackOrBlock|cantAttack|cantBlock|noUntap|loseAbilities/.test(flag)) {
      return scope.attached ? 2.4 : 0.6;
    }
    const buff = pt ? (nval(pt.p, 0) * 0.8 + nval(pt.t, 0) * 0.4) : 0;
    if (scope.attached) return buff + kws * 0.5;
    if (scope.self) return (buff + kws * 0.4) * 0.6;
    if (scope.who === 'you' || scope.yourCreatures || scope.controller === 'you')
      return buff * 2.2 + kws * 0.8;
    return 0.3;
  }

  /* How often a trigger goes off, in "times it pays out" over a game. */
  const TRIGGER_RATE = {
    etb: 1, enters: 1, dies: 0.6, ltb: 0.6, attacks: 0.9, youAttack: 1.1, yourCreatureAttacks: 1.1,
    combatDamageToPlayer: 0.8, dealsDamage: 0.8, yourCreatureCombatDamage: 1.0, blocks: 0.3, becomesBlocked: 0.3,
    eachUpkeep: 1.6, yourUpkeep: 2.0, opponentUpkeep: 1.5, yourEndStep: 2.0, eachEndStep: 1.6,
    yourDrawStep: 2.0, eachDrawStep: 1.6, yourCombatBegin: 1.8, endOfCombat: 1.2,
    youCastSpell: 1.4, anyCastSpell: 1.2, firstSpellEachTurn: 1.6, opponentCastSpell: 1.3, anySecondSpell: 0.8,
    landfall: 1.25, youGainLife: 1.3, youDraw: 1.8, opponentDraw: 1.6,
    yourCreatureEtb: 1.6, otherCreatureEtb: 1.5, anyCreatureEtb: 1.4, yourPermanentEtb: 1.6, permanentEtb: 1.3,
    yourCreatureDies: 1.2, anyCreatureDies: 1.2, opponentCreatureDies: 1.0, youSacrifice: 1.0,
    createToken: 1.2, counters: 1.0, youDiscard: 0.8, becomesTarget: 0.4, becomesTapped: 1.0,
  };

  /** One ability's worth, in mana, folding in how often it gets to happen. */
  function abilityWorth(ab, a) {
    let raw = U.sum((ab.effects || []).map(e => effectWorth(e, 0)));
    // a Class level or a level band is paid for again before it does anything
    if (ab.levelCond || (ab.condition && ab.condition.kind === 'levelRange')) raw *= 0.5;
    if (ab.kind === 'spell' || ab.kind === 'chapter') return raw;
    if (ab.kind === 'triggered') {
      let rate = TRIGGER_RATE[ab.event] != null ? TRIGGER_RATE[ab.event] : 0.8;
      if (ab.condition || ab.intervening || /\bif\b|\bunless\b/i.test(ab.text || '')) rate *= 0.6;
      // "if you control six or more lands" is a late-game card in an early-game body
      if (/\bif you (?:control|have) (?:\w+ )?(?:four|five|six|seven|eight|ten|\d+) or more\b/i.test(ab.text || '')) rate *= 0.4;
      return raw * rate;
    }
    if (ab.kind === 'activated') {
      const c = ab.cost || {};
      const mana = MTG.mana.cmc(c.mana || '');
      if (raw <= 0) return 0;
      // a one-shot sacrifice is a delayed spell; a tap ability comes back every turn
      let v = c.sacSelf ? raw * 0.75 : raw * (c.tap ? 1.5 : 1.3);
      // an ability that costs a whole turn's mana is one you will rarely get to use
      v -= mana * (c.sacSelf ? 0.35 : 0.3) + Math.max(0, mana - 3) * 0.5;
      if (c.sacrifice || c.discard || c.exile) v *= 0.6;
      if (/equip/i.test(ab.text || '')) v = 0;     // an equipment's value is its bonus, priced separately
      return Math.max(0.1, v);
    }
    if (ab.kind === 'static') return raw;
    return raw * 0.5;
  }

  /** The cost to move an equipment, read off its equip ability. */
  function equipCost(a) {
    const eq = (a.abilities || []).find(x => x.kind === 'activated' && /equip/i.test(x.text || ''));
    return eq ? MTG.mana.cmc((eq.cost || {}).mana || '') : 2;
  }

  /**
   * How good a card is, on the scale described above.
   *   ctx.multiplayer  a table of more than two: symmetrical effects and
   *                    "each opponent" count for more
   *   ctx.limited      a draft deck, where bodies matter more than staples
   *   ctx.prior        weight of the popularity prior (EDHREC rank)
   *   ctx.tune         experiment knobs for the tools in tools/: abil (weight
   *                    of everything a card does besides its body), mvTax
   *                    (extra cost per mana above three), rarity
   */
  function rateCard(card, ctx) {
    ctx = ctx || {};
    const tune = Object.assign({ abil: 1, mvTax: 0, rarity: 1 }, ctx.tune || {});
    const a = analyse(card);
    if (!a) return 0;
    if (a.isLand) return 2;
    const mv = Math.max(0, a.mv || 0);
    let value = 0;
    if (a.isCreature) {
      const p = parseInt(a.power, 10), t = parseInt(a.toughness, 10);
      // "*" stats grow with the board; call them middling
      value += bodyWorth(Number.isFinite(p) ? p : 2, Number.isFinite(t) ? t : 2, (k) => a.has(k));
    } else if (a.has('flash')) value += 0.2;
    if (a.isInstant) value += 0.35;
    let extra = 0;
    for (const ab of a.abilities || []) extra += abilityWorth(ab, a);
    value += extra * (extra > 0 ? tune.abil : 1);
    if (a.manaAbilities.length && !a.isLand) {
      // a mana creature or rock: tempo now, and colours
      const anyColour = a.manaAbilities.some(m => (m.effects || []).some(e => e.op === 'addManaAny' || e.op === 'addManaChoice'));
      // mana that only comes "if you control a Dragon" mostly does not come
      const conditional = a.manaAbilities.every(m => m.only || m.levelCond || (m.cost && (m.cost.sacSelf || m.cost.mana)));
      value += (1.3 + (anyColour ? 0.3 : 0) + (a.isCreature ? 0 : 0.2)) * (conditional ? 0.25 : 1);
    }
    // an equipment's bonus is counted above; moving it about is what it costs
    if (a.isEquipment) value -= equipCost(a) * 0.35;
    if (a.isAura) {
      // a bonus Aura is a two-for-one waiting to happen; a leash is removal
      const hostile = /can't attack|can't block|doesn't untap|gets -\d|loses all abilities/i.test(a.oracleText || '');
      if (!hostile) value *= 0.7;
    }
    if (a.isPlaneswalker) {
      const loy = parseInt(a.loyalty, 10) || 3;
      const acts = (a.abilities || []).filter(x => x.kind === 'loyalty')
        .map(x => U.sum((x.effects || []).map(e => effectWorth(e, 0))));
      acts.sort((x, y) => y - x);
      // a walker that is not answered keeps paying, which is the point of it
      value += 1.0 + loy * 0.35 + (acts[0] || 0) * 1.4 + (acts[1] || 0) * 0.5;
    }
    /* A generated script can be terser than the card it came from; when
       the printed text has a condition on it, the payoff is not every
       turn, whatever the script says. */
    if (a.generated && /\bif you (?:control|have)\b|\bas long as\b/i.test(a.oracleText || '')) value *= 0.6;
    let rating = 3 + (value - Math.max(0.5, mv)) * 0.9;
    // big spells are worse than their numbers: they sit in hand while the game is decided
    if (mv >= 5) rating -= (mv - 4) * (ctx.multiplayer ? 0.15 : 0.35) + Math.max(0, mv - 6) * 0.5;
    if (tune.mvTax && mv > 3) rating -= (mv - 3) * tune.mvTax;
    if (/\{X\}/.test(a.manaCost || '')) rating += 0.4;
    /* Card draw on a spell is a turn spent not affecting the board, and in
       the games bots play that turn is usually the one that loses it. */
    if (!a.isPermanent && !ctx.multiplayer && rolesOf(card).has('draw') && !rolesOf(card).has('removal')) rating -= 0.8;
    // cards that only make sense next to a commander, or that the table cannot run, are not for us
    if (!ctx.commander && /\bcommander\b/i.test(a.oracleText || '') && !/commander ninjutsu/i.test(a.oracleText || '')) rating -= 2;
    if (!a.fullyAutomated) rating -= 3;
    // what the rest of the world thinks: a light thumb on the scale
    const prior = ctx.prior == null ? 0.5 : ctx.prior;
    if (prior && card.edhrec_rank) {
      rating += U.clamp((Math.log10(40000) - Math.log10(card.edhrec_rank)) * 0.55, -0.4, 1.4) * prior;
    } else if (prior) rating -= 0.2 * prior;
    if (!ctx.limited) rating += ({ rare: 0.25, mythic: 0.35 }[card.rarity] || 0) * tune.rarity;
    return Number.isFinite(rating) ? Math.round(rating * 100) / 100 : 2;
  }

  /* ---- what a card is for ----
     A deck needs a few things besides good cards: enough creatures to
     win with, answers to the other side's, something to keep the hand
     full. These read a card's job off its analysis. */
  function rolesOf(card) {
    const a = analyse(card);
    const out = new Set();
    if (!a) return out;
    if (a.isLand) { out.add('land'); return out; }
    if (a.isCreature) out.add('creature');
    if (a.isPlaneswalker) out.add('walker');
    const all = [];
    for (const ab of a.abilities || []) {
      if (ab.kind === 'static' && !a.isAura) continue;
      for (const e of ab.effects || []) collect(e, all, 0);
    }
    for (const e of all) {
      const tg = (e.targets || [])[0];
      if ((e.op === 'destroy' || e.op === 'exile' || e.op === 'exileUntilLeaves') && hitsCreatures(tg)) out.add('removal');
      if (e.op === 'damage' && tg && tg.type !== 'player' && hitsCreatures(tg) && nval(e.n, 2) >= 2) out.add('removal');
      if ((e.op === 'fight' || e.op === 'bite' || e.op === 'damageByPower') && !a.isCreature) out.add('removal');
      if (e.op === 'sacrificeChoice' && e.who !== 'you') out.add('removal');
      if (e.op === 'counters' && /-1\/-1/.test(e.kind || '') && tg) out.add('removal');
      if (e.op === 'pump' && tg && nval(e.p, 0) < 0 && tg.controller !== 'you') out.add('removal');
      if (e.op === 'damage' && (!tg || tg.type === 'any' || tg.type === 'player')) out.add('burn');
      if (e.op === 'draw' && (e.who || 'you') === 'you') out.add('draw');
      if (e.op === 'impulse') out.add('draw');
      if (e.op === 'counterSpell' || e.op === 'counterUnless') out.add('counter');
      if (e.op === 'destroyAll' || e.op === 'exileAll' || (e.op === 'damage' && e.each && /creature/.test(e.each))) out.add('wipe');
      if (e.op === 'fetchBasic' || e.op === 'landFromHand') out.add('ramp');
      if (e.op === 'pump' && e.duration === 'eot' && tg && tg.controller !== 'opponent' && nval(e.p, 0) > 0) out.add('trick');
    }
    if (a.isAura && /can't attack|can't block|doesn't untap/i.test(a.oracleText || '')) out.add('removal');
    if (!a.isLand && a.manaAbilities.length) out.add('ramp');
    return out;
  }
  function collect(e, out, depth) {
    if (!e || depth > 4) return;
    out.push(e);
    for (const k of ['then', 'effects', 'otherwise']) for (const x of (e[k] || [])) collect(x, out, depth + 1);
    if (e.op === 'modal') for (const m of (e.modes || [])) for (const x of (m.effects || [])) collect(x, out, depth + 1);
  }

  /* ============================================================
     Part 2 - deck construction
     A bot deck is built the way a person builds one: decide on colours
     and a plan, gather the cards that suit it, keep the ones the engine
     can run, then lay them out on a curve with the right number of lands.
     Difficulty decides how strong the cards are allowed to be, how much
     the deck leans on synergy, and how good its mana is — never whether
     it has enough lands or a curve, because a deck that cannot cast its
     spells is no fun to play against at any level.
     ============================================================ */

  /** Ask Scryfall, quietly: a failed search is an empty pool, not a crash. */
  async function searchPool(q, max) {
    // a busy or briefly unreachable Scryfall gets a second chance before the pool is called empty
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await MTG.scry.search(q, { order: 'edhrec', unique: 'cards', max: max || 175 }); }
      catch (e) { if (attempt === 0) await U.sleep(1500); }
    }
    return [];
  }

  /**
   * Can a bot put this card in a deck? It has to be legal, inside the
   * colours, and something the engine runs from start to finish — a bot
   * holding a card that says "resolve this by hand" has handed its turn
   * to the person it is playing against. The check is made each time, so
   * as the engine learns more cards the bots start playing them.
   */
  function botCanPlay(card, fmt, colors) {
    if (!card) return false;
    const a = analyse(card);
    if (!a || !a.fullyAutomated) return false;
    if (/token|emblem|art_series|planar|scheme|vanguard/.test(card.layout || '')) return false;
    if (fmt && fmt.scryKey) {
      const l = MTG.formats.legalityOf(card, fmt);
      if (l !== 'legal' && l !== 'restricted') return false;
    }
    if (colors && (card.color_identity || []).some(c => !colors.includes(c))) return false;
    // Attractions, stickers and the like need pieces the table does not have
    if (/\b(Attraction|sticker|Contraption|dungeon)\b/i.test(card.oracle_text || '')) return false;
    return true;
  }

  /* ---- themes ----
     What a deck can be about besides "good cards". Each has cards that
     make it go (enablers) and cards that reward it (payoffs); a theme is
     only worth building when the pool has plenty of both. `q` finds more
     of it on Scryfall. */
  const THEMES = [
    { id: 'tokens', name: 'Tokens', q: '(o:"creature token" or o:"for each creature you control")',
      en: /create[^.]*creature tokens?/i,
      pay: /creature tokens? you control|for each creature you control|creatures you control get \+|whenever (?:one or more )?(?:other )?creatures? (?:you control )?enters?/i },
    { id: 'counters', name: 'Counters', q: 'o:"+1/+1 counter"',
      en: /\+1\/\+1 counters? on/i,
      pay: /with (?:a|one or more) \+1\/\+1 counters?|whenever (?:one or more )?\+1\/\+1 counters?|proliferate|for each \+1\/\+1 counter/i },
    { id: 'lifegain', name: 'Lifegain', q: '(o:"whenever you gain life" or kw:lifelink or o:"you gain 2 life" or o:"you gain 3 life")',
      en: /you gain \d+ life|gain \d+ life|lifelink/i, pay: /whenever you gain life|if you gained life/i },
    { id: 'spells', name: 'Spells', q: '(o:"instant or sorcery" or kw:prowess or o:magecraft)',
      en: (a) => a.isInstant || a.isSorcery, pay: /whenever you cast (?:an|a) (?:instant|noncreature)|prowess|magecraft|instant or sorcery spell/i },
    { id: 'artifacts', name: 'Artifacts', q: '(o:"artifact you control" or o:"artifacts you control" or o:"whenever an artifact")',
      en: (a) => a.isArtifact, pay: /artifacts? you control|whenever (?:an|another) artifact|for each artifact/i },
    { id: 'sacrifice', name: 'Aristocrats', q: '(o:"whenever another creature you control dies" or o:"whenever a creature you control dies" or o:"sacrifice another creature")',
      en: /sacrifice (?:a|another) creature|create[^.]*creature tokens?/i,
      pay: /whenever (?:a|another) creature (?:you control )?dies|whenever you sacrifice/i },
    { id: 'graveyard', name: 'Graveyard', q: '(o:"from your graveyard" or kw:surveil or o:"mill")',
      en: /\bmill|surveil|discard a card/i, pay: /from your graveyard|flashback|escape|cards? in your graveyard/i },
    { id: 'flyers', name: 'Skies', q: '(kw:flying t:creature)',
      en: (a) => a.isCreature && a.has('flying'), pay: /creatures? you control with flying|flying creatures? you control/i },
  ];
  function themeHit(t, a, card, which) {
    const test = t[which];
    if (!test) return false;
    if (typeof test === 'function') { try { return !!test(a, card); } catch (e) { return false; } }
    return test.test(a.oracleTextParsed || a.oracleText || '');
  }

  /* ---- tribes ---- */
  const PLURAL = { elf: 'elves', dwarf: 'dwarves', wolf: 'wolves', werewolf: 'werewolves', fungus: 'fungi',
    octopus: 'octopuses', mouse: 'mice', ox: 'oxen', sphinx: 'sphinxes', fox: 'foxes', lynx: 'lynxes' };
  function tribeRe(t) {
    const s = t.toLowerCase();
    const pl = PLURAL[s] || (/(s|x|ch|sh)$/.test(s) ? s + 'es' : s + 's');
    return new RegExp('\\b(?:' + s + '|' + pl + ')\\b', 'i');
  }
  // creature types too broad to be a plan
  const NOT_A_TRIBE = new Set(['Human', 'Warrior', 'Soldier', 'Wizard', 'Shaman', 'Cleric', 'Rogue', 'Scout',
    'Knight', 'Advisor', 'Citizen', 'Peasant', 'Noble', 'Artificer', 'Monk', 'Druid', 'Construct', 'Beast',
    'Spirit', 'Elemental', 'Horror', 'Bird', 'Cat', 'Dog', 'Insect', 'Spider', 'Snake', 'Ape', 'Bear', 'Avatar']);

  /**
   * Every candidate card with what the deck builder needs to know about it:
   * its rating, its jobs, its curve slot, and how it fits the plan.
   */
  function describe(card, ctx) {
    const a = analyse(card);
    return {
      card, a, name: card.name,
      r: rateCard(card, ctx),
      roles: rolesOf(card),
      mv: Math.round(a.mv || 0),
      legendary: !!a.isLegendary,
      creature: !!a.isCreature,
    };
  }

  /** How well a card suits an archetype, as a nudge to its rating. */
  function archFit(c, arch) {
    const a = c.a;
    const p = parseInt(a.power, 10) || 0;
    let v = 0;
    if (arch === 'aggro') {
      if (c.creature) {
        v += 0.3;
        if (p >= c.mv && c.mv <= 3) v += 0.4;
        if (a.has('haste')) v += 0.3;
        if (p <= 1 && c.mv >= 2) v -= 0.4;
      }
      if (c.roles.has('burn')) v += 0.5;
      if (c.roles.has('counter') || c.roles.has('wipe')) v -= 1.5;
      if (c.roles.has('draw') && !c.creature) v -= 0.4;
      if (c.mv >= 5) v -= 0.8;
      if (a.has('defender')) v -= 2;
    } else if (arch === 'control') {
      if (c.roles.has('removal')) v += 0.6;
      if (c.roles.has('wipe')) v += 0.8;
      if (c.roles.has('draw')) v += 0.5;
      if (c.roles.has('counter')) v += 0.4;
      if (c.creature && c.mv <= 2 && !c.roles.has('removal') && !c.roles.has('draw')) v -= 0.6;
      if (c.roles.has('trick')) v -= 0.6;
    } else {
      if (c.creature && c.mv >= 2 && c.mv <= 5) v += 0.2;
      if (c.roles.has('removal')) v += 0.3;
      if (c.roles.has('wipe')) v -= 0.6;
      if (c.roles.has('counter')) v -= 0.3;
    }
    if (c.roles.has('trick')) v -= 0.3;            // tricks are hard to use well and rarely worth the card
    return v;
  }

  /**
   * Bend a card's rating to the difficulty. A high-level bot wants the
   * strongest card; a low-level one is capped, so it plays honest,
   * on-curve cards rather than the format's best — and some noise, so
   * two decks at the same level are not the same deck. The very top of
   * the scale is where the judge is least sure of itself — a card rated
   * seven is as often a misreading as a bomb — so even the strongest
   * level stops short of chasing those.
   */
  function shapeScore(c, cfg, rng) {
    const cap = 3.5 + cfg.deckPower * 2.5;
    let s = c.fit;
    if (c.r > cap) s -= (c.r - cap) * 1.6;
    s += (rng.next() + rng.next() - 1) * (0.35 + (1 - cfg.deckPower) * 1.1);
    return s;
  }

  /* Archetype templates for sixty cards. The curve is in copies per mana
     value (6 means six or more) for a deck of 36 spells, and scales. */
  const ARCHETYPES = {
    aggro:    { lands: 22, creatures: [20, 28], removal: [4, 9], draw: [0, 3], counter: [0, 0], wipe: [0, 0],
                curve: [0, 8, 13, 9, 5, 2, 0], maxMv: 5 },
    midrange: { lands: 23, creatures: [15, 22], removal: [6, 10], draw: [1, 5], counter: [0, 3], wipe: [0, 2],
                curve: [0, 3, 9, 10, 8, 4, 2], maxMv: 7 },
    control:  { lands: 25, creatures: [6, 12], removal: [8, 12], draw: [4, 8], counter: [0, 6], wipe: [2, 4],
                curve: [0, 2, 9, 9, 7, 5, 2], maxMv: 8 },
  };
  /* How each colour leans, for choosing a plan that suits it. */
  const COLOUR_LEAN = {
    W: { aggro: 1.3, midrange: 0.9, control: 0.7 },
    U: { aggro: 0.4, midrange: 0.8, control: 1.6 },
    B: { aggro: 0.9, midrange: 1.2, control: 0.9 },
    R: { aggro: 1.6, midrange: 0.8, control: 0.4 },
    G: { aggro: 0.8, midrange: 1.5, control: 0.3 },
  };

  /** How many copies a 60-card deck wants of this card. */
  function copiesFor(c, rank, cfg, fmt) {
    const cap = MTG.formats.legalityOf(c.card, fmt) === 'restricted' ? 1 : (fmt.maxCopies || 4);
    let q = rank < 6 ? 4 : rank < 11 ? 3 : 2;
    if (c.legendary) q = Math.min(q, cfg.skill > 0.6 ? 3 : 2);
    if (c.mv >= 5) q = Math.min(q, 2);
    if (c.roles.has('wipe') || c.roles.has('counter')) q = Math.min(q, 3);
    // the lower levels play more variety: a pile of 4-ofs is a tuned deck
    if (cfg.deckPower < 0.35 && q === 4 && rank >= 3) q = 3;
    return U.clamp(q, 1, cap);
  }

  /**
   * Lay out a 60-card style main deck from rated candidates: required
   * roles first, then the curve, then whatever is best.
   */
  function assembleSixty(cands, arch, spells, cfg, fmt) {
    const tpl = ARCHETYPES[arch];
    const scale = spells / 36;
    const curveWant = tpl.curve.map(n => Math.round(n * scale));
    const picks = [];
    const have = { creature: 0, removal: 0, draw: 0, counter: 0, wipe: 0 };
    const curveHave = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    const roleMax = (role) => Math.round((tpl[role] || [0, 99])[1] * scale);
    const roleMin = (role) => Math.round((tpl[role] || [0, 0])[0] * scale);
    const slot = (c) => U.clamp(c.mv, 0, 6) || 1;
    const taken = new Set();

    const tryAdd = (c, rankHint, opts) => {
      if (taken.has(c.card.id) || total >= spells) return 0;
      if (c.mv > tpl.maxMv && !opts.anyMv) return 0;
      let q = copiesFor(c, rankHint, cfg, fmt);
      const sl = slot(c);
      if (!opts.ignoreCurve) {
        const room = curveWant[sl] + 2 - curveHave[sl];
        if (room <= 0) return 0;
        q = Math.min(q, Math.max(room, opts.need ? q : 0));
      }
      for (const role of ['removal', 'draw', 'counter', 'wipe']) {
        if (!c.roles.has(role)) continue;
        if (!opts.ignoreRoles && have[role] + q > roleMax(role) + 1) q = Math.max(0, roleMax(role) + 1 - have[role]);
      }
      if (c.creature && !opts.ignoreRoles && have.creature + q > roleMax('creatures') + 2) q = Math.max(0, roleMax('creatures') + 2 - have.creature);
      q = Math.min(q, spells - total);
      if (q <= 0 || (q === 1 && !opts.allowOne && !c.legendary && c.mv < 5)) return 0;
      picks.push({ c, qty: q });
      taken.add(c.card.id);
      total += q; curveHave[sl] += q;
      if (c.creature) have.creature += q;
      for (const role of ['removal', 'draw', 'counter', 'wipe']) if (c.roles.has(role)) have[role] += q;
      return q;
    };
    const ranked = cands.slice().sort((x, y) => y.s - x.s);
    const rankOf = new Map(ranked.map((c, i) => [c.card.id, i]));
    // 1. the bones: enough creatures to win with and answers for theirs
    const needs = [['creatures', c => c.creature], ['removal', c => c.roles.has('removal')],
      ['draw', c => c.roles.has('draw')], ['wipe', c => c.roles.has('wipe')]];
    for (const [role, test] of needs) {
      const key = role === 'creatures' ? 'creature' : role;
      for (const c of ranked) {
        if (have[key] >= roleMin(role)) break;
        if (test(c)) tryAdd(c, rankOf.get(c.card.id), { need: true });
      }
    }
    // 2. the best of the rest, on the curve
    for (const c of ranked) { if (total >= spells) break; tryAdd(c, rankOf.get(c.card.id), {}); }
    // 3. still short (a thin pool): anything decent, curve or not
    for (const c of ranked) { if (total >= spells) break; tryAdd(c, rankOf.get(c.card.id), { ignoreCurve: true, allowOne: true }); }
    for (const c of ranked) { if (total >= spells) break; tryAdd(c, rankOf.get(c.card.id), { ignoreCurve: true, ignoreRoles: true, allowOne: true, anyMv: true }); }
    // top up the copies of what is already in, best first
    for (let i = 0; total < spells && i < picks.length * 4; i++) {
      const e = picks[i % picks.length];
      const cap = MTG.formats.legalityOf(e.c.card, fmt) === 'restricted' ? 1 : (fmt.maxCopies || 4);
      if (e.qty < cap) { e.qty++; total++; }
    }
    return picks;
  }

  /**
   * Lay out a singleton list (Commander) from rated candidates: roles
   * first — ramp, draw, removal, a wipe or two — then the curve.
   */
  function assembleSingleton(cands, spells, plan) {
    const picks = [];
    const taken = new Set();
    const have = { ramp: 0, draw: 0, removal: 0, wipe: 0, creature: 0 };
    const curveHave = [0, 0, 0, 0, 0, 0, 0, 0];
    const curveWant = plan.curve.map(n => Math.round(n * spells / 63));
    const ranked = cands.slice().sort((x, y) => y.s - x.s);
    const add = (c, ignoreCurve) => {
      if (taken.has(c.card.id) || picks.length >= spells) return false;
      const sl = U.clamp(c.mv, 0, 7);
      if (!ignoreCurve && curveHave[sl] >= curveWant[sl] + 2) return false;
      if (!ignoreCurve && c.roles.has('wipe') && have.wipe >= plan.wipe) return false;
      picks.push(c); taken.add(c.card.id); curveHave[sl]++;
      for (const k of Object.keys(have)) if (k === 'creature' ? c.creature : c.roles.has(k)) have[k]++;
      return true;
    };
    for (const role of ['ramp', 'removal', 'draw', 'wipe', 'creature']) {
      for (const c of ranked) {
        if (have[role] >= plan[role]) break;
        if (role === 'creature' ? c.creature : c.roles.has(role)) add(c, role !== 'creature');
      }
    }
    for (const c of ranked) { if (picks.length >= spells) break; add(c, false); }
    for (const c of ranked) { if (picks.length >= spells) break; add(c, true); }
    return picks;
  }

  /**
   * The lands: the duals and fixers the difficulty allows, then basics in
   * proportion to the coloured pips, with early pips counting for more
   * because those are the ones that have to be there on turn two.
   */
  async function buildManaBase(picks, landCount, colors, landPool, cfg, fmt, opts) {
    opts = opts || {};
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const e of picks) {
      const card = e.c ? e.c.card : e.card;
      const qty = e.qty || 1;
      const early = (card.cmc || 0) <= 2 ? 1.5 : 1;
      for (const s of MTG.mana.parse(card.mana_cost || ''))
        for (const col of MTG.mana.COLORS) if (s.includes(col)) pips[col] += qty * early;
    }
    for (const c of (opts.commanders || [])) for (const s of MTG.mana.parse(c.mana_cost || ''))
      for (const col of MTG.mana.COLORS) if (s.includes(col)) pips[col] += 3;
    let active = (colors && colors.length ? colors : MTG.mana.COLORS).filter(c => pips[c] > 0);
    if (!active.length) active = colors && colors.length ? colors.slice(0, 1) : ['W'];

    const out = [];
    let nonbasic = 0;
    const singleton = !!opts.singleton;
    // how many nonbasic lands this level of player bothers with
    // one colour needs no fixing, so its nonbasics have to earn the slot on their own
    const mono = active.length <= 1;
    const budget = singleton
      ? (mono ? [0, 1, 2, 4, 5] : [0, 4, 8, 12, 16])[cfg.manabase]
      : mono ? [0, 0, 0, 2, 4][cfg.manabase] : [0, 2, 4, 8, 10][cfg.manabase] + (active.length >= 3 ? 3 : 0);
    if (budget > 0 && landPool && landPool.length) {
      const lands = landPool.filter(l => {
        const a = analyse(l);
        if (!a || !a.isLand || a.isBasicLand || !a.fullyAutomated) return false;
        if (!botCanPlay(l, fmt, colors)) return false;
        const prod = freeColours(l);
        const useful = prod.filter(c => active.includes(c)).length;
        // a land that makes one of our colours is only worth it if it makes two, or is a fixer
        if (active.length > 1 && useful < 2) return false;
        if (mono && (useful < 1 || a.entersTapped || /sacrifice|enters tapped|pay \d+ life/i.test(l.oracle_text || ''))) return false;
        return true;
      }).map(l => {
        const a = analyse(l);
        const prod = freeColours(l).filter(c => active.includes(c));
        let v = prod.length + (l.edhrec_rank ? U.clamp((40000 - l.edhrec_rank) / 20000, 0, 2) : 0);
        if (a.entersTapped) v -= opts.aggro ? 1.6 : 0.8;
        if (/deals? \d damage to you|pay \d life/i.test(l.oracle_text || '')) v -= 0.3;
        return { l, v };
      }).sort((x, y) => y.v - x.v);
      for (const { l } of lands) {
        if (nonbasic >= budget) break;
        const q = singleton ? 1 : Math.min(4, budget - nonbasic);
        out.push({ card: l, qty: q });
        nonbasic += q;
      }
    }
    const basicsNeeded = Math.max(0, landCount - nonbasic);
    const basics = await MTG.draft.getBasics();
    const totalPips = U.sum(active.map(c => pips[c])) || 1;
    // each colour gets its share, but never so few that its spells rot in hand
    const share = active.map(c => ({ c, n: basicsNeeded * pips[c] / totalPips }));
    /* Each colour wants enough sources to show up when it is needed —
       about eight of twenty-four for a second colour — counting the duals
       already in, so a deck is not left holding a hand of one colour. */
    const fromDuals = (c) => U.sum(out.map(e => freeColours(e.card).includes(c) ? e.qty : 0));
    const want = Math.round(landCount * (singleton ? 0.3 : 0.34));
    for (const s of share) {
      if (active.length < 2 || pips[s.c] < 2) continue;
      const floor = Math.min(basicsNeeded / active.length, Math.max(0, want - fromDuals(s.c)));
      if (s.n < floor) s.n = floor;
    }
    const sum = U.sum(share.map(s => s.n)) || 1;
    let placed = 0;
    share.forEach((s, i) => {
      const qty = i === share.length - 1 ? basicsNeeded - placed : Math.round(basicsNeeded * s.n / sum);
      placed += qty;
      const card = basics[BASIC_FOR[s.c]];
      if (card && qty > 0) out.push({ card, qty });
    });
    return out;
  }

  /** Coloured pips of each colour in a mana cost; a hybrid pip counts half to each side. */
  function pipsOf(card) {
    const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const s of MTG.mana.parse(card.mana_cost || (card.card_faces && card.card_faces[0].mana_cost) || '')) {
      const cols = MTG.mana.COLORS.filter(c => s.includes(c));
      for (const c of cols) out[c] += /\/P/.test(s) ? 0.3 : 1 / cols.length;
    }
    return out;
  }

  /** The colour with the most good cards behind it, which the deck is built around. */
  function leadColour(cands, colors, rng) {
    const weight = {};
    for (const c of colors) weight[c] = 0.01;
    const top = cands.slice().sort((x, y) => y.fit - x.fit).slice(0, 40);
    for (const c of top) {
      const p = pipsOf(c.card);
      for (const col of colors) if (p[col] > 0) weight[col] += Math.max(0.5, c.fit - 2.5) * (1 + p[col] * 0.3);
    }
    return rng.weighted(colors.map(c => [c, Math.pow(weight[c], 2)]));
  }

  /** How much harder a card is to cast in this deck than its cost suggests. */
  function pipStrain(card, primary, colors) {
    if (colors.length < 2) return 0;
    const p = pipsOf(card);
    let strain = 0;
    for (const col of colors) {
      if (col === primary) continue;
      if (p[col] >= 3) strain += 6;                      // never castable on time
      else if (p[col] >= 2) strain += 1.4;
      // a one-drop in the second colour wants that colour on turn one
      else if (p[col] >= 1 && (card.cmc || 0) <= 1) strain += 0.4;
    }
    // a card that needs both colours is fine; one that needs three of something is not
    if (p[primary] >= 3 && (card.cmc || 0) <= 3) strain += 0.6;
    return strain;
  }

  /**
   * The colours a land really makes, read from mana abilities that cost
   * nothing but a tap. Scryfall's list counts a filter ability ("{1},
   * {T}: Add one mana of any color") as fixing, which on a turn-two board
   * it is not.
   */
  function freeColours(card) {
    const a = analyse(card);
    if (!a) return [];
    if (a.isBasicLand) return (card.produced_mana || []).filter(c => c !== 'C');
    // "spend this mana only to cast a creature of the chosen type" is not fixing
    if (/Spend this mana only/i.test(card.oracle_text || '')) return [];
    const out = new Set();
    for (const m of a.manaAbilities || []) {
      const c = m.cost || {};
      if (c.mana || c.sacSelf || c.sacrifice || c.life || c.discard || (c.other || []).length || m.only) continue;
      for (const e of m.effects || []) {
        if (e.op === 'addMana') for (const sym of e.symbols || []) for (const col of MTG.mana.COLORS) if (sym.includes(col)) out.add(col);
        if (e.op === 'addManaAny') MTG.mana.COLORS.forEach(col => out.add(col));
        if (e.op === 'addManaChoice') for (const ch of e.choices || []) for (const sym of ch) for (const col of MTG.mana.COLORS) if (sym.includes(col)) out.add(col);
      }
    }
    return Array.from(out);
  }

  /** Pick colours for a constructed deck, and how many of them. */
  function chooseColours(cfg, rng, pers) {
    const C = MTG.mana.COLORS;
    /* One colour plays most smoothly, and the better bots know it; two
       colours is the norm at a kitchen table, and a third only comes with
       the mana to support it. */
    const mono = 0.25 + cfg.deckPower * 0.4;
    const n = rng.weighted([[1, mono], [2, 1 - mono], [3, cfg.manabase >= 4 ? 0.03 : 0]]);
    if (!pers) return rng.sample(C, n);
    // a personality has favourite colours: drawn one at a time, by its weights
    const out = [];
    while (out.length < n) {
      const left = C.filter(c => !out.includes(c));
      out.push(rng.weighted(left.map(c => [c, pers.deck.colours[c] || 1])));
    }
    return out;
  }

  function chooseArchetype(colors, cfg, rng, pers) {
    const w = { aggro: 0, midrange: 0, control: 0 };
    for (const c of colors) for (const k of Object.keys(w)) w[k] += (COLOUR_LEAN[c] || {})[k] || 1;
    /* Control is a deck that wins by making no mistakes, and measured
       over thousands of bot games it loses to anything with a plan of
       attack — and an opponent that draws the game out with counterspells
       is nobody's idea of fun. So the bots build creature decks; the
       removal-heavy end of midrange is as far as they go. */
    w.control = 0;
    /* And the sharper the bot, the more it leans on pressure: in measured
       games between bots, a fast creature deck at the top level beat the
       same level's midrange decks well over half the time. */
    w.aggro *= 1 + cfg.deckPower * 2.5;
    /* A personality's taste in archetype is strongest at the kitchen
       table; the stronger the bot, the more it builds what wins and the
       less what it likes, so a chaotic level 10 is still a level 10. */
    if (pers) for (const k of Object.keys(w)) w[k] *= Math.pow(pers.deck.arch[k] != null ? Math.max(0.05, pers.deck.arch[k]) : 1, persDeckWeight(cfg));
    return rng.weighted(Object.entries(w).map(([k, v]) => [k, Math.pow(v / colors.length, 2)]));
  }

  /**
   * Is there a tribe or theme in this pool worth building around? Looks
   * at the playable cards, counts the ones that belong, and only says yes
   * when there are enough of them — and enough good ones — to fill a deck.
   */
  function findPlan(cands, rng, cfg, fixedTribe, pers) {
    const options = [];
    const tribes = new Map();
    for (const c of cands) {
      if (!c.creature) continue;
      for (const st of c.a.subtypes || []) {
        if (NOT_A_TRIBE.has(st)) continue;
        const t = tribes.get(st) || { n: 0, r: 0 };
        t.n++; t.r += c.r;
        tribes.set(st, t);
      }
    }
    for (const [st, t] of tribes) {
      if (fixedTribe && st !== fixedTribe) continue;
      const re = tribeRe(st);
      const payoffs = cands.filter(c => re.test(c.a.oracleText || '') && !c.a.subtypes.includes(st)).length;
      if (t.n >= 8 && t.r / t.n >= 3) options.push({ kind: 'tribe', id: st, name: st, weight: t.n + payoffs * 2 });
    }
    for (const th of THEMES) {
      const en = cands.filter(c => themeHit(th, c.a, c.card, 'en')).length;
      const pay = cands.filter(c => themeHit(th, c.a, c.card, 'pay')).length;
      const lean = pers ? (pers.deck.themes[th.id] || 1) : 1;
      if (en >= 10 && pay >= 4) options.push({ kind: 'theme', id: th.id, name: th.name, weight: (Math.min(en, 30) + pay * 2) * lean, theme: th });
    }
    if (!options.length) return null;
    options.sort((x, y) => y.weight - x.weight);
    return rng.pick(options.slice(0, 3));
  }

  /** How much a card belongs to the chosen tribe or theme. */
  function planFit(c, plan) {
    if (!plan) return 0;
    if (plan.kind === 'tribe') {
      const member = c.creature && (c.a.subtypes || []).includes(plan.id);
      const payoff = tribeRe(plan.id).test(c.a.oracleText || '');
      return (member ? 0.6 : 0) + (payoff ? 0.8 : 0);
    }
    const en = themeHit(plan.theme, c.a, c.card, 'en');
    const pay = themeHit(plan.theme, c.a, c.card, 'pay');
    return (en ? 0.4 : 0) + (pay ? 0.8 : 0);
  }

  /** Scryfall fragment for "more of this plan". */
  function planQuery(plan) {
    if (!plan) return null;
    if (plan.kind === 'tribe') {
      const s = plan.id;
      const pl = PLURAL[s.toLowerCase()] || s + 's';
      return `(t:"${s}" or o:"${s}" or o:"${pl}")`;
    }
    return plan.theme.q;
  }

  /** Every card in the pools, deduplicated and narrowed to what a bot can play. */
  function candidatesFrom(pools, fmt, colors, ctx, exclude) {
    const seen = new Set(exclude || []);
    const out = [];
    for (const pool of pools) for (const card of (pool || [])) {
      const key = U.normName(card.name);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!botCanPlay(card, fmt, colors)) continue;
      const a = analyse(card);
      if (a.isLand) continue;
      out.push(describe(card, ctx));
    }
    return out;
  }

  /**
   * Build a complete, legal deck for a bot.
   * Returns the same deck shape the rest of the app uses.
   */
  async function buildBotDeck(opts) {
    const formatId = opts.formatId || 'commander';
    // the table may be playing the format with its own numbers
    const fmt = MTG.formats.effective(formatId, opts.rules);
    const cfg = diffCfg(opts.difficulty);
    const rng = opts.rng || new MTG.RNG(Date.now());
    const progress = opts.onProgress || (() => {});
    // a personality asked for leans on the build; none asked for, and one is chosen to suit the deck
    const persKey = opts.personality && PERSONALITIES[opts.personality] ? opts.personality : null;

    if (fmt.kind === 'limited') {
      // limited bots build from the pool they drafted
      const basics = await MTG.draft.getBasics();
      const built = await MTG.draft.autoBuildLimited(opts.pool || [], {
        deckSize: fmt.deckMin || 40, basicCards: basics, formatId, name: opts.name,
      });
      if (built) built.plan = Object.assign({ archetype: 'limited' }, built.plan || {}, { personality: persKey || personalityFor(built, rng) });
      return built;
    }
    const deck = fmt.commander
      ? await buildCommanderDeck(fmt, cfg, rng, opts, progress)
      : await buildSixtyDeck(fmt, cfg, rng, opts, progress);
    deck.plan.personality = persKey || personalityFor(deck, rng);
    deck.id = MTG.uid('deck');
    deck.format = formatId;
    deck.botDifficulty = opts.difficulty;
    deck.source = 'bot';
    deck.createdAt = Date.now();
    progress('Done');
    return deck;
  }

  /** Make the list exactly the right size, trimming or padding basics. */
  async function fitToSize(main, size, colors) {
    let have = U.sum(main.map(e => e.qty));
    let guard = 0;
    while (have > size && guard++ < 400) {
      const basic = main.filter(e => MTG.formats.isBasicLand(e.card)).sort((x, y) => y.qty - x.qty)[0];
      const e = basic && basic.qty > 1 ? basic
        : main.filter(x => !MTG.formats.isBasicLand(x.card)).sort((x, y) => (y.card.cmc || 0) - (x.card.cmc || 0))[0];
      if (!e) break;
      e.qty--; have--;
      if (e.qty <= 0) main.splice(main.indexOf(e), 1);
    }
    guard = 0;
    while (have < size && guard++ < 400) {
      const basic = main.filter(e => MTG.formats.isBasicLand(e.card)).sort((x, y) => y.qty - x.qty)[0];
      if (basic) { basic.qty++; have++; continue; }
      const basics = await MTG.draft.getBasics();
      const b = basics[BASIC_FOR[(colors || [])[0] || 'W']];
      if (!b) break;
      main.push({ card: b, qty: 1 }); have++;
    }
    return main;
  }

  async function buildSixtyDeck(fmt, cfg, rng, opts, progress) {
    // the tools can override numbers from the ladder for an experiment
    if (opts.tuning && opts.tuning.cfg) cfg = Object.assign({}, cfg, opts.tuning.cfg);
    const legalKey = fmt.scryKey || 'standard';
    const deckSize = fmt.deckMin || 60;
    const pers = PERSONALITIES[opts.personality] || null;
    const colors = opts.colors || (opts.tuning && opts.tuning.ncol ? rng.sample(MTG.mana.COLORS, opts.tuning.ncol) : chooseColours(cfg, rng, pers));
    const base = `legal:${legalKey} -is:digital lang:en ${idToken(colors)}`;
    progress('Gathering cards');
    const [creatures, spellsPool, landPool] = await Promise.all([
      searchPool(`${base} t:creature -t:land`, 350),
      searchPool(`${base} -t:creature -t:land`, 350),
      searchPool(`${base} t:land -t:basic`, 175),
    ]);
    /* EDHREC is a Commander list, but how much a card is played anywhere
       turns out to say a good deal about how well it plays here. */
    const tuning = opts.tuning || {};
    const ctx = { prior: tuning.prior != null ? tuning.prior : 0.5, tune: tuning };
    let cands = candidatesFrom([creatures, spellsPool], fmt, colors, ctx);
    if (cands.length < 12) throw new Error('Could not reach Scryfall to build a bot deck.');

    /* A plan: an archetype the colours suit, and sometimes a tribe or a
       theme to hang it on — more often at the levels that can make the
       most of one. */
    let arch = opts.archetype || (opts.tuning && opts.tuning.archetype) || chooseArchetype(colors, cfg, rng, pers);
    let plan = null;
    if (rng.chance(U.clamp(0.25 + cfg.skill * 0.35 + (pers ? pers.deck.themeChance : 0), 0, 0.95))) {
      plan = findPlan(cands, rng, cfg, null, pers);
      if (plan) {
        progress('Finding ' + plan.name.toLowerCase());
        const more = await searchPool(`${base} ${planQuery(plan)} -t:land`, 175);
        cands = cands.concat(candidatesFrom([more], fmt, colors, ctx, cands.map(c => U.normName(c.name))));
        if (arch === 'control') arch = 'midrange';
      }
    }
    for (const c of cands) {
      c.fit = c.r + archFit(c, arch) + planFit(c, plan) * (0.5 + cfg.skill * 0.5) * (pers && pers.deck.planFit || 1);
      if (pers) c.fit += pers.deck.fit(c) * persDeckWeight(cfg);
    }
    /* Two colours are not two equal halves. A deck that wants {G}{G}{G}
       and {B}{B} at once spends half its games holding cards it cannot
       cast, so one colour leads and the other is kept to single pips. */
    const primary = colors.length > 1 ? leadColour(cands, colors, rng) : colors[0];
    for (const c of cands) {
      c.fit -= pipStrain(c.card, primary, colors);
      c.s = shapeScore(c, cfg, rng);
    }
    cands = cands.filter(c => pipStrain(c.card, primary, colors) < 6);
    const tpl = ARCHETYPES[arch];
    progress('Assembling the deck');
    // a beginner's deck runs a land more, as beginners' decks do
    const landCount = Math.round(tpl.lands * deckSize / 60) + (cfg.deckPower < 0.3 ? 1 : 0);
    const picks = assembleSixty(cands, arch, deckSize - landCount, cfg, fmt);
    progress('Building the mana base');
    const lands = await buildManaBase(picks, landCount, colors, landPool, cfg, fmt, { aggro: arch === 'aggro' });
    const main = picks.map(p => ({ card: p.c.card, qty: p.qty })).concat(lands);
    await fitToSize(main, deckSize, colors);
    const label = MTG.advisor && MTG.advisor.colorLabel ? MTG.advisor.colorLabel(colors) : colors.join('');
    return {
      name: opts.name || `${cfg.label} ${fmt.name} deck`,
      main, sideboard: [], commanders: [], companion: null,
      // what the bot set out to build, for anything that wants to say so
      plan: { archetype: arch, theme: plan ? plan.name : null, colors: colors.slice(), label },
    };
  }

  /**
   * The commander: a legend the engine can run, chosen by how much it is
   * played (the strongest at the top of the ladder, something friendlier
   * further down), whose colours give enough cards to build with.
   */
  async function chooseCommander(fmt, cfg, rng, colors) {
    const legalKey = fmt.scryKey || 'commander';
    const q = `is:commander legal:${legalKey} -is:digital lang:en` + (colors ? ' ' + idToken(colors) : '');
    const pool = await searchPool(q, 700);
    if (!pool.length) throw new Error('Could not reach Scryfall to build a bot deck.');
    const ok = pool.filter(c => {
      const a = analyse(c);
      if (!a || !a.fullyAutomated) return false;
      if (!MTG.formats.canBeCommander(c, fmt)) return false;
      // a commander with no colours has a very thin pool of cards the bots can play
      return (c.color_identity || []).length > 0;
    });
    if (!ok.length) return rng.pick(pool.slice(0, 60));
    /* Rated like any other card, then bent to the level: the top of the
       ladder plays the strong, proven generals, and the bottom something
       friendlier — Elesh Norn is nobody's idea of a beginner's opponent. */
    const scored = ok.map((c, i) => {
      const fit = rateCard(c, { prior: 1, multiplayer: true, commander: true }) - i * 0.004;
      return { c, s: shapeScore({ fit, r: fit }, cfg, rng) };
    }).sort((x, y) => y.s - x.s);
    return rng.pick(scored.slice(0, 8)).c;
  }

  async function buildCommanderDeck(fmt, cfg, rng, opts, progress) {
    const legalKey = fmt.scryKey || 'commander';
    progress('Choosing a commander');
    const cmd = await chooseCommander(fmt, cfg, rng, opts.colors || null);
    const commanders = [cmd];
    const mate = await findPartner(cmd, legalKey, cfg, rng);
    if (mate) { commanders.push(mate); progress('Finding a partner'); }
    const id = new Set();
    for (const c of commanders) for (const col of (c.color_identity || [])) id.add(col);
    const colors = MTG.mana.COLORS.filter(c => id.has(c));
    const deckSize = (fmt.deckMin || 100) - commanders.length;

    /* What the commander wants: a tribe it names, or a theme its text
       rewards. Its own creature type counts when its text talks about
       creature types at all. */
    const ca = commanders.map(c => analyse(c)).filter(Boolean);
    const text = ca.map(a => a.oracleText || '').join('\n');
    let plan = null;
    // a planeswalker's subtype is its own name, not a tribe
    const subtypes = U.uniq([].concat(...ca.map(a => (a.isCreature ? a.subtypes : []) || [])));
    /* Creature types are capitalised in rules text and ordinary words are
       not, except at the start of a sentence — which is what the stop list
       is for. */
    const NOT_TYPES = /^(?:creatures?|artifacts?|enchantments?|instants?|sorcery|sorceries|lands?|legendary|tokens?|spells?|cards?|permanents?|players?|opponents?|other|each|whenever|target|nonland|noncreature|nontoken|attacking|blocking|tapped|untapped|colorless|white|blue|black|red|green|multicolored|equipped|enchanted|historic|outlaws?|party|equipment|auras?|vehicles?|sagas?|treasures?|clues?|foods?)$/i;
    const named = [];
    for (const m of text.matchAll(/\b([A-Z][a-z]+?)(?:s|es)?\b(?= (?:you control|spells?|creatures?|cards?))/g)) named.push(m[1]);
    const ownNames = commanders.map(c => c.name).join(' ');
    const tribal = U.uniq(subtypes.concat(named)).find(t => !NOT_A_TRIBE.has(t) && !NOT_TYPES.test(t) &&
      !ownNames.includes(t) && tribeRe(t).test(text));
    if (tribal) plan = { kind: 'tribe', id: tribal, name: tribal };
    if (!plan) {
      let best = null;
      for (const th of THEMES) {
        const hit = ca.some(a => themeHit(th, a, null, 'pay')) ? 2 : ca.some(a => themeHit(th, a, null, 'en')) ? 1 : 0;
        if (hit && (!best || hit > best.hit)) best = { hit, th };
      }
      if (best) plan = { kind: 'theme', id: best.th.id, name: best.th.name, theme: best.th };
    }

    const base = `legal:${legalKey} -is:digital lang:en ${idToken(colors)}`;
    progress('Gathering cards');
    const [creatures, spellsPool, landPool, planPool] = await Promise.all([
      searchPool(`${base} t:creature -t:land`, 350),
      searchPool(`${base} -t:creature -t:land`, 350),
      searchPool(`${base} t:land -t:basic`, 175),
      plan ? searchPool(`${base} ${planQuery(plan)} -t:land`, 175) : Promise.resolve([]),
    ]);
    const ctx = { prior: 0.9, multiplayer: true, commander: true };
    const cands = candidatesFrom([planPool, creatures, spellsPool], fmt, colors, ctx, commanders.map(c => U.normName(c.name)));
    if (cands.length < 30) throw new Error('Could not reach Scryfall to build a bot deck.');
    const pers = PERSONALITIES[opts.personality] || null;
    for (const c of cands) {
      c.fit = c.r + planFit(c, plan) * (0.6 + cfg.skill * 0.6) * (pers && pers.deck.planFit || 1) + (c.roles.has('wipe') ? -0.4 : 0);
      if (pers) c.fit += pers.deck.fit(c) * persDeckWeight(cfg);
      c.s = shapeScore(c, cfg, rng);
    }
    progress('Assembling the deck');
    const landCount = cfg.deckPower < 0.3 ? 38 : cfg.deckPower < 0.8 ? 37 : 36;
    const rampWant = Math.round(5 + cfg.skill * 6);
    const cplan = {
      ramp: rampWant, draw: 8, removal: 7 + Math.round(cfg.skill * 2), wipe: cfg.skill > 0.5 ? 2 : 1,
      creature: 22 + Math.round((1 - cfg.skill) * 6),
      curve: [0, 6, 12, 15, 12, 8, 5, 5],
    };
    const picks = assembleSingleton(cands, deckSize - landCount, cplan);
    progress('Building the mana base');
    const lands = await buildManaBase(picks.map(c => ({ c, qty: 1 })), landCount, colors, landPool, cfg, fmt,
      { singleton: true, commanders });
    const main = picks.map(c => ({ card: c.card, qty: 1 })).concat(lands);
    await fitToSize(main, deckSize, colors);
    const label = MTG.advisor && MTG.advisor.colorLabel ? MTG.advisor.colorLabel(colors) : colors.join('');
    return {
      name: opts.name || cmd.name,
      main, sideboard: [], commanders, companion: null,
      plan: { archetype: 'commander', theme: plan ? plan.name : null, colors, label },
    };
  }

  /* ============================================================
     Part 3 - playing the game
     A bot thinks in the same order a person does: is there a question
     for me, is it my main phase, is there something on the stack I care
     about, is it the other player's end step. Each tick makes at most
     one move, so the runner can pace it and a person can follow.

     Skill shows up in three places. Planning: what to cast with the mana
     there is, and when. Reading the board: combat arithmetic, what is
     worth a removal spell, what is worth a counterspell. And restraint:
     holding an instant for the right moment rather than firing it off.
     The lower levels still do all of it — they play their lands and cast
     their spells — but they misjudge, in the ways people misjudge.
     ============================================================ */

  /* Effects that hurt whatever they are pointed at. */
  const HARMFUL = new Set(['damage', 'destroy', 'exile', 'exileUntilLeaves', 'bounce', 'tap', 'loseLife', 'discard',
    'mill', 'counterSpell', 'counterUnless', 'sacrificeChoice', 'gainControl', 'fight', 'bite', 'damageByPower', 'goad',
    'cantBlock', 'cantAttack', 'restrict', 'drain', 'discardChosen', 'exileChosen', 'handAttack', 'damageDivided',
    'revealHand', 'tapAll', 'noUntap']);
  function isHarmful(e) {
    if (!e) return false;
    if (e.op === 'pump') return nval(e.p, 0) < 0 || nval(e.t, 0) < 0;
    if (e.op === 'counters') return /-1\/-1|stun|shield/.test(e.kind || '') && !/shield/.test(e.kind || '');
    return HARMFUL.has(e.op);
  }

  /** Every effect in a list, nested ones included, in reading order. */
  function flatEffects(list) {
    const out = [];
    for (const e of (list || [])) collect(e, out, 0);
    return out;
  }

  /* What a bot makes of the generic questions it knows by name. Each is
     called on the bot with the question and the engine's checks, and may
     return null to fall back to scoring candidate by candidate. */
  const CHOOSE_PURPOSES = {
    /* "Choose a creature type": the options come most-ours first */
    creatureType() { return { picks: [0] }; },
    /* Culling Ritual: "{B} or {G} for each …" — all of the first colour */
    manaSplit() { return { picks: [0] }; },
    /* Read ahead: from the start */
    readAhead() { return { picks: [0] }; },
    /* Devour: tokens are fodder; real creatures stay */
    devour(s) { return { picks: (s.items || []).filter(x => { const o = this.game.obj(x.id); return o && o.isToken; }).map(x => x.id) }; },
    /* Circle of Protection: the opponent's source most likely to hurt us
       this turn — an attacker, a spell on the stack, then their biggest creature */
    preventSource(s) {
      const g = this.game;
      const pool = (s.items || []).map(it => g.obj(it.id)).filter(o => o && o.controller !== this.pid);
      if (!pool.length) return null;
      const score = (o) => (o.zone === 'stack' ? 50 : 0) + (o.attacking ? 20 : 0) + ((g.characteristics(o) || {}).isCreature ? g.powerOf(o) : 0);
      pool.sort((a, b) => score(b) - score(a));
      return { picks: [pool[0].id] };
    },
    /* "Sacrifice it unless you sacrifice a land / return a Plains / discard
       a card": pay with the least of them when the permanent is worth more. */
    unlessSacrifice(s) {
      const g = this.game;
      const src = s.sourceId ? g.obj(s.sourceId) : null;
      const keep = src ? this.permanentValue(src) : 0;
      const pool = (s.items || []).map(it => g.obj(it.id)).filter(Boolean)
        .map(o => ({ o, v: o.zone === 'battlefield' ? this.permanentValue(o) : this.rating(o) })).sort((x, y) => x.v - y.v);
      return pool.length && pool[0].v <= keep ? { picks: [pool[0].o.id] } : { picks: [] };
    },
    /* Painful Quandary: a card from hand rather than 5 life, the least of them */
    unlessDiscard(s) {
      const g = this.game;
      const pool = (s.items || []).map(it => g.obj(it.id)).filter(Boolean).sort((x, y) => this.rating(x) - this.rating(y));
      return pool.length ? { picks: [pool[0].id] } : { picks: [] };
    },
    /* Replicate: every copy is the spell again, so as many as can be paid
       for — unless the spell is one we would not want twice. */
    replicate(s) {
      return { number: s.number.max };
    },
    /* Splice: the spliced card's words for its splice cost, and the card
       stays in hand; worth it whenever those words help. */
    splice(s, hooks) {
      const g = this.game;
      const C = MTG.choice;
      const ranked = (s.items || []).map(it => {
        const o = g.obj(it.id);
        const a = o && o.analysis();
        return { id: it.id, v: a ? U.sum(flatEffects(g._cardSpellEffects(a)).map(e => effectWorth(e, 0))) : 0 };
      }).sort((x, y) => y.v - x.v);
      const picks = [];
      for (const r of ranked) if (r.v > 0.3 && C.canAdd(s, picks, r.id, hooks)) picks.push(r.id);
      return { picks };
    },
    /* Conspire: two creatures tapped for a second spell. The two that
       matter least, and only when the spell is worth having twice and the
       creatures are not needed to attack or block. */
    conspire(s) {
      const g = this.game;
      const spell = s.sourceId ? g.obj(s.sourceId) : null;
      const worth = spell ? this.rating(spell) : 2;
      const pool = (s.items || []).map(it => g.obj(it.id)).filter(Boolean)
        .sort((x, y) => this.permanentValue(x) - this.permanentValue(y));
      if (pool.length < 2) return { picks: [] };
      const cost = this.permanentValue(pool[0]) + this.permanentValue(pool[1]);
      const combatSoon = g.activePlayer.id === this.pid && g.phaseIndex <= 1;
      if (worth < 2 || (combatSoon && cost > worth * 1.5)) return { picks: [] };
      return { picks: [pool[0].id, pool[1].id] };
    },
    /* Cipher: on the creature most likely to keep getting through. */
    cipher(s) {
      const g = this.game;
      const scored = (s.items || []).map(it => g.obj(it.id)).filter(Boolean).map(o => {
        let v = g.toughnessOf(o) * 0.3 + g.powerOf(o) * 0.2;
        for (const k of ['flying', 'menace', 'trample', 'shadow', 'fear', 'intimidate', 'horsemanship', 'skulk']) if (g.hasKw(o, k)) v += 2;
        if (g.hasKw(o, 'hexproof') || g.hasKw(o, 'indestructible')) v += 1;
        if (g.hasKw(o, 'defender')) v -= 5;
        return { id: o.id, v };
      }).sort((x, y) => y.v - x.v);
      return scored.length && scored[0].v > -2 ? { picks: [scored[0].id] } : { picks: [] };
    },
    /* "Choose an opponent": the one that matters most when what follows
       hurts them, and the one least likely to beat us when it is a gift. */
    chooseOpponent(s) {
      const g = this.game;
      const r = g.resolving;
      const rest = r && r.effects ? r.effects.slice(r.index + 1) : [];
      const hurts = flatEffects(rest).some(e => isHarmful(e));
      const offered = (s.items || []).map(x => g.player(x.id)).filter(Boolean);
      const foe = this.mainOpponent();
      if (hurts && foe && offered.includes(foe)) return { picks: [foe.id] };
      const meek = offered.slice().sort((a, b) => this._leaderScore(a) - this._leaderScore(b))[0];
      return meek ? { picks: [meek.id] } : null;
    },
    /* Modes priced in paw prints: the most value the budget buys, a mode
       as often as it is worth it (a small knapsack, since budgets are five). */
    pawprint(s) {
      const e = this._resolvingEffect();
      const modes = e && e.op === 'modal' ? (e.modes || []) : [];
      const cap = ((s.constraints || []).find(c => c.kind === 'sum') || {}).max || s.max;
      const opts = (s.options || []).map((o, k) => ({ k, w: Math.max(1, o.weight || 1),
        v: this._modeWorth((modes[o.i != null ? o.i : k] || {}).effects || O.parseEffects(o.label || '').effects) }));
      const best = [{ v: 0, picks: [] }];
      for (let b = 1; b <= cap; b++) {
        best[b] = best[b - 1];
        for (const o of opts) {
          if (o.w > b || o.v <= 0) continue;
          const prev = best[b - o.w];
          if (prev.v + o.v > best[b].v) best[b] = { v: prev.v + o.v, picks: prev.picks.concat([o.k]) };
        }
      }
      const got = best[cap];
      if (got.picks.length) return { picks: got.picks };
      // nothing helps: the cheapest mode, since one has to be chosen
      const cheap = opts.slice().sort((x, y) => x.w - y.w || y.v - x.v)[0];
      return cheap ? { picks: [cheap.k] } : null;
    },
  };

  /* ============================================================
     Part 4 - looking ahead
     The judgement above decides one thing at a time, and that is where
     it stops: it cannot see that an attack which looks free loses the
     race next turn, or that the creature held back is the one that blocks
     the lethal swing. So from level 6 up a bot also plays its options
     out. Each candidate move — the judgement's own choice first, then the
     alternatives worth a look — is made in a few private copies of the
     game (06d-sim.js), with the cards it cannot see dealt afresh in each,
     and every copy is played on by plain bots to the start of the turn
     after next. Whichever move leaves it best placed on average is the
     move it makes; the judgement's own choice wins a tie.

     Every copy is seeded from the bot's own dice, and each level plays a
     fixed number of them, so the same game makes the same decisions
     every time it is played and a replay matches its game. The time
     limit is a safety net a normal decision never reaches; a device slow
     enough to reach it decides on the copies it managed, which is the one
     way the same seed can play differently on two machines. A phone plays
     fewer copies to begin with (and so may play differently from a
     desktop, but always the same as itself).

       worlds   copies per candidate move, on a desktop and on a phone
       cands    candidate moves considered at most
       attack, block, main, instant   which decisions are looked at (instant:
                the counterspell, the removal on an attacker, the end-of-turn play)
       capMs    the safety limit for one decision, desktop and phone
     ============================================================ */
  /* Level 6 weighs its spells and its attacks in one imagined future
     each, level 7 its blocks too; 8 to 10 weigh more candidates in more futures, and the top two
     also think at instant speed. Measured against the same deck, a full
     look ahead beats the same level's plain judgement about two games in
     three; past a couple of futures per candidate it stops getting
     better, which is why the top levels are not much further apart in
     this respect than they are. */
  const LOOKAHEAD = {
    6:  { worlds: 1, phone: 1, cands: 3, attack: 1, block: 0, main: 1, capMs: 250, capPhone: 120 },
    7:  { worlds: 1, phone: 1, cands: 3, attack: 1, block: 1, main: 1, capMs: 300, capPhone: 130 },
    8:  { worlds: 2, phone: 1, cands: 3, attack: 1, block: 1, main: 1, capMs: 350, capPhone: 140 },
    9:  { worlds: 2, phone: 2, cands: 4, attack: 1, block: 1, main: 1, instant: 1, capMs: 400, capPhone: 150 },
    10: { worlds: 3, phone: 2, cands: 5, attack: 1, block: 1, main: 1, instant: 1, capMs: 450, capPhone: 150 },
  };
  /* The players in the copies: sound, quick, and never careless — the
     model of the table is a competent one, whatever is really sitting
     there. They do not look ahead themselves. */
  const ROLLOUT_LEVEL = 8;
  const ROLLOUT_TUNING = { blunder: 0, skill: 1, modelBlocks: 0, look: null };
  // how many turn starts a copy is played through, and how far it may run
  const HORIZON = 2;
  const ROLLOUT_STEPS = 2500;
  // the longest one copy may take, in ms: a safety net for a copy that loops
  const ROLLOUT_MS = 250;
  // how much better than the judgement's own move another has to look
  const LOOK_MARGIN = 0.3;
  // a slice of thinking between breaths for the page, in ms
  const SLICE_MS = 12;

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  /* A breath for the page: the quickest way back to the event loop there
     is, so a long think never freezes the table. */
  const breathe = (function () {
    if (typeof setImmediate === 'function') return () => new Promise(r => setImmediate(r));
    if (typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      const waiting = [];
      ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
      return () => new Promise(r => { waiting.push(r); ch.port2.postMessage(0); });
    }
    return () => new Promise(r => setTimeout(r, 0));
  })();

  const RATE_MEMO = new WeakMap();
  function quickRating(card) {
    if (!card) return 2;
    let r = RATE_MEMO.get(card);
    if (r === undefined) { r = rateCard(card, { prior: 0 }); RATE_MEMO.set(card, r); }
    return r;
  }

  /* How a position is judged at the end of a look ahead, in the same units
     as the card judge — mana, roughly. Each player's standing is their
     board, their lands, their hand and their life; life is worth more the
     less of it there is and the harder it is being hit. A personality can
     lean on these (see PERSONALITIES). */
  const EVAL = { life: 1, oppLife: 1, board: 1, hand: 1, lands: 1, leader: 0.6 };

  function standingOf(g, p, s, incoming, w) {
    if (p.hasLost) return -40;
    const lifeScale = 2 + incoming * 1.3;
    const life = p.life <= 0 ? -40 : 0.22 * Math.min(p.life, 40) + 8 * (1 - Math.exp(-p.life / lifeScale));
    let v = s.board * w.board + s.landWorth * w.lands + s.hand * w.hand + life * w.life;
    v -= (p.poison || 0) * 0.9;
    const lib = (g.zones[p.id] || {}).library;
    if (lib && lib.length < 4) v -= (4 - lib.length) * 2.5;
    return v;
  }

  /**
   * How good this position is for `pid`: their standing less their
   * opponents'. With more than two players the opponents count as a
   * blend of the strongest and the average, so one player's ruin is not
   * everything and nobody is singled out for being who they are.
   */
  function tableScore(g, pid, w) {
    w = w || EVAL;
    const me = g.player(pid);
    if (!me || me.hasLost) return -500;
    if (g.over) return (g.winners || []).some(x => (typeof x === 'string' ? x : x && x.id) === pid) ? 500 : -500;
    const st = new Map();
    for (const p of g.players) st.set(p.id, { board: 0, power: 0, lands: 0, hand: 0, landWorth: 0 });
    for (const o of g.battlefield) {
      const s = st.get(o.controller);
      if (!s || o.phasedOut) continue;
      const c = g.characteristics(o);
      if (!c) continue;
      if (c.isLand && !c.isCreature) { s.lands++; continue; }
      const r = quickRating(o.card);
      if (c.isCreature) {
        const pw = Math.max(0, g.powerOf(o)), t = Math.max(0, g.toughnessOf(o));
        let v = 0.6 + pw * 0.9 + t * 0.4;
        if (g.hasKw(o, 'flying')) v += 0.2 + pw * 0.25;
        if (g.hasKw(o, 'trample')) v += pw * 0.1;
        if (g.hasKw(o, 'deathtouch')) v += 0.8;
        if (g.hasKw(o, 'lifelink')) v += pw * 0.25;
        if (g.hasKw(o, 'double strike')) v += pw * 0.8;
        else if (g.hasKw(o, 'first strike')) v += 0.2 + pw * 0.15;
        if (g.hasKw(o, 'menace')) v += pw * 0.2;
        if (g.hasKw(o, 'indestructible')) v += 1.2;
        if (g.hasKw(o, 'hexproof')) v += 0.5;
        if (g.hasKw(o, 'defender')) v -= pw * 0.6;
        v += Math.max(0, r - 3) * 0.3;
        s.board += v;
        s.power += pw * (g.hasKw(o, 'double strike') ? 2 : 1) * (g.hasKw(o, 'flying') ? 1.2 : 1);
      } else if (c.isPlaneswalker) {
        s.board += 2 + (Number(o.counters.loyalty) || 0) * 0.5 + Math.max(0, r - 3) * 0.5;
      } else if (o.isToken) s.board += 0.5;
      else s.board += Math.max(0.3, r - 2) * 0.8;
      if (o.isCommander) s.board += 1.5;
    }
    for (const p of g.players) {
      const s = st.get(p.id);
      s.landWorth = Math.min(s.lands, 7) + Math.max(0, s.lands - 7) * 0.25;
      for (const o of (g.zones[p.id] || {}).hand || []) {
        const a = o.analysis();
        s.hand += a && a.isLand ? (s.lands < 5 ? 0.9 : 0.4) : 1.5;
      }
    }
    const opps = g.players.filter(p => p.id !== pid);
    const incomingTo = (p) => {
      const foes = g.players.filter(x => x.id !== p.id && !x.hasLost).map(x => st.get(x.id).power).sort((a, b) => b - a);
      return (foes[0] || 0) + U.sum(foes.slice(1)) * 0.25;
    };
    const mine = standingOf(g, me, st.get(pid), incomingTo(me), w);
    if (!opps.length) return mine;
    const theirW = Object.assign({}, w, { life: w.oppLife });
    const theirs = opps.map(p => standingOf(g, p, st.get(p.id), incomingTo(p), theirW));
    if (theirs.length === 1) return mine - theirs[0];
    const top = Math.max(...theirs), mean = U.sum(theirs) / theirs.length;
    return mine - (top * w.leader + mean * (1 - w.leader));
  }

  class BotPlayer {
    /* `tuning` overrides numbers from the ladder for this one bot; the
       tools in tools/ use it to measure what each number is worth. */
    constructor(game, playerId, difficulty, tuning, opts) {
      this.game = game;
      this.pid = playerId;
      this.d = U.clamp(Math.round(difficulty || 5), 1, 10);
      this.cfg = tuning ? Object.assign({}, diffCfg(this.d), tuning) : diffCfg(this.d);
      /* Its personality: the one asked for, else the one its deck was built
         with, else one that suits the deck. The bots in a look ahead's
         copies have none: they are a plain model of the table. */
      const want = (opts && opts.personality) || (tuning && tuning.personality);
      if (PERSONALITIES[want]) this.personality = want;
      else if (game.isScratch || want === 'none') this.personality = null;
      else {
        const p = game.player(playerId);
        const deck = p && p.deck;
        const planned = deck && deck.plan && deck.plan.personality;
        this.personality = PERSONALITIES[planned] ? planned
          : personalityFor(deck, new MTG.RNG(((game.config.seed >>> 0) ^ parseInt(U.hash('p:' + playerId), 36)) >>> 0 || 3));
      }
      this.pers = PERSONALITIES[this.personality] || null;
      this.thinkMs = U.clamp(1100 - this.d * 60, 250, 1200);
      this.busy = false;
      /* What the bot did last, for anything that wants to show it:
         { kind, objId, name, text, at }. Also announced as a 'bot:action'
         event on the game. */
      this.lastAction = null;
      this._ratings = new Map();
      this._turnMemo = { key: null };
    }
    get me() { return this.game.player(this.pid); }
    /**
     * How far this bot's personality leans one way at the table (0 for
     * none). The sharper the bot, the less a taste costs it: a strong
     * cautious bot still attacks when the attack is plainly right. Whom
     * to pick on at a bigger table is a matter of taste at every level.
     */
    lean(k) {
      const v = (this.pers && this.pers.play[k]) || 0;
      return k === 'leader' || k === 'spread' ? v : v * (1 - 0.4 * (this.cfg.skill || 0));
    }

    /** Called whenever the game state changes; decides if it is our move. */
    /** One decision, if there is one to make. Returns true if it acted. */
    async tick() {
      const g = this.game;
      if (this.busy || g.over) return false;
      const me = this.me;
      if (!me || me.hasLost) return false;
      this.busy = true;
      /* "It acted" has to mean the game moved, not that it tried. A pass
         the engine refuses (there is a question on the table for somebody
         else, say) changes nothing, and a runner that counts it as action
         spins in place instead of handing the table back. */
      const was = g.stateVersion;
      const moved = () => g.stateVersion !== was;
      try {
        if (g.mulliganPhase && !me.keptHand) { await this.pause(); this.doMulligan(); return moved(); }
        if (g.pendingChoice && g.pendingChoice.playerId === this.pid) {
          const ch = g.pendingChoice;
          this._thought = 0;
          // a look ahead, at the levels that make one; it replaces some of the pause
          const plan = await this.thinkChoice(ch);
          if (g.stateVersion !== was || g.pendingChoice !== ch) return moved();
          await this.pause();
          this.doChoice(ch, plan);
          return moved();
        }
        if (g.priorityPlayer && g.priorityPlayer.id === this.pid) {
          /* Thinking is theatre: it is there so a person can follow what
             happened, and nothing happened when a bot passes. So the bot
             decides first and pauses only if it actually did something —
             which turns a table of three bots from a slideshow of nobody
             doing anything into a game that moves. */
          this._thought = 0;
          const move = await this.thinkPriority();
          // the table moved while it thought (an undo, a concession): think again next time
          if (g.stateVersion !== was) return moved();
          if (this.doPriority(move)) await this.pause();
          return moved();
        }
      } finally { this.busy = false; }
      return false;
    }
    pause() {
      const ms = (MTG.settings.botSpeed == null) ? this.thinkMs : MTG.settings.botSpeed;
      // time already spent looking ahead was time the table spent waiting
      return U.sleep(U.clamp(ms - (this._thought || 0), 0, 4000));
    }
    /* A bot's dice are its own. Drawing on the game's generator would move
       every later shuffle along with each thing the bot considered, and a
       game could then only be played back by thinking exactly the same
       thoughts again. Seeded from the game and the seat, so a bot still
       plays the same game from the same seed. */
    rand() {
      if (!this._rng) this._rng = new MTG.RNG(((this.game.config.seed >>> 0) ^ parseInt(U.hash(String(this.pid)), 36)) >>> 0 || 1);
      return this._rng.next();
    }
    /** True when this decision is made well; false is a misjudgement. */
    sharp() { return this.rand() < this.cfg.skill; }
    /** True when the bot makes one of its level's believable mistakes. */
    slips() { return this.rand() < this.cfg.blunder; }

    /* A spell the engine turned down once this step will be turned down
       again; asking every time it gets priority is a bot talking to itself. */
    _refused(o) {
      const g = this.game;
      const key = g.turn + ':' + g.phaseIndex + ':' + g.stepIndex;
      if (!this._refusals || this._refusals.key !== key) this._refusals = { key, ids: new Set() };
      this._refusals.ids.add(o.id);
    }
    _wasRefused(o) {
      const g = this.game;
      const r = this._refusals;
      return !!(r && r.key === g.turn + ':' + g.phaseIndex + ':' + g.stepIndex && r.ids.has(o.id));
    }

    /** Note what was done, for the table to show. */
    _did(kind, o, text) {
      this.lastAction = { kind, objId: o ? o.id : null, name: o ? o.name : null, text: text || null, at: Date.now() };
      try { this.game.emit('bot:action', Object.assign({ playerId: this.pid }, this.lastAction)); } catch (e) { /* a listener's problem */ }
    }

    /* ---- small readers ---- */
    rating(o) {
      if (!o || !o.card) return 0;
      const k = o.card.id;
      if (!this._ratings.has(k)) this._ratings.set(k, rateCard(o.card, { prior: 0, multiplayer: this.game.players.length > 2 }));
      return this._ratings.get(k);
    }
    myCreatures() {
      const g = this.game;
      return g.battlefield.filter(o => o.controller === this.pid && this._isCreature(o));
    }
    _isCreature(o) {
      const c = this.game.characteristics(o);
      return !!(c && c.isCreature);
    }
    opponents() { return this.game.opponentsOf(this.pid); }
    landsInPlay(pid) {
      const g = this.game;
      return g.battlefield.filter(o => o.controller === (pid || this.pid) && (o.analysis() || {}).isLand).length;
    }
    hand() { return this.game.zones[this.pid].hand; }
    /** How far ahead a player is: board, walkers, cards, mana and life, roughly. */
    _leaderScore(p) {
      const g = this.game;
      let v = Math.max(0, p.life) * 0.15;
      let lands = 0;
      for (const o of g.battlefield) {
        if (o.controller !== p.id) continue;
        if (this._isCreature(o)) v += g.powerOf(o) * 0.6 + 0.4;
        else {
          const a = o.analysis() || {};
          if (a.isPlaneswalker) v += 3;
          else if (a.isLand) lands++;
          else v += 0.5;
        }
      }
      v += Math.min(lands, 8) * 0.25 + ((g.zones[p.id] || {}).hand || []).length * 0.3 - (p.poison || 0) * 0.3;
      return v;
    }

    /**
     * The opponent who matters most right now. With one there is no
     * question. At a bigger table it is a blend of who is furthest ahead
     * and who can hurt us most — never simply whoever is weakest, which
     * is how a table ends up piling on one player for no good reason. A
     * political bot cares most about who is winning.
     */
    mainOpponent() {
      const opps = this.opponents();
      if (!opps.length) return null;
      if (opps.length === 1) return opps[0];
      const g = this.game;
      if (this._mainOpp && this._mainOpp.v === g.stateVersion) return this._mainOpp.p;
      const lead = 0.7 + this.lean('leader') * 0.6;
      const danger = (p) => {
        const power = U.sum(g.battlefield.filter(o => o.controller === p.id && this._isCreature(o)).map(o => g.powerOf(o)));
        return this._leaderScore(p) * lead + power * 0.5 * (power >= this.me.life ? 2 : 1);
      };
      const p = opps.map(x => ({ x, v: danger(x) })).sort((a, b) => b.v - a.v)[0].x;
      this._mainOpp = { v: g.stateVersion, p };
      return p;
    }

    /* ---- mulligans ---- */
    doMulligan() {
      const g = this.game, me = this.me;
      const hand = g.zones[this.pid].hand;
      const lands = hand.filter(o => { const a = o.analysis(); return a && a.isLand; }).length;
      const bottomN = g.bottomCountFor ? g.bottomCountFor(me) : me.mulligansTaken;
      const size = hand.length - bottomN;
      const big = (g.zones[this.pid].library.length + hand.length) > 80;   // commander keeps a little looser
      const lo = size >= 7 ? 2 : 1, hi = size >= 7 ? (big ? 5 : 4) : 4;
      // a hand with lands but nothing to do with them early is still a mulligan at the top
      const early = hand.filter(o => { const a = o.analysis(); return a && !a.isLand && (a.mv || 0) <= 3; }).length;
      let keep = me.mulligansTaken >= 2 || (lands >= lo && lands <= hi) || this.d <= 2;
      if (keep && this.cfg.strictMull && size >= 7 && lands <= 2 && early === 0 && me.mulligansTaken === 0) keep = false;
      /* Lands that make none of the colours the spells need are not lands,
         as far as this hand is concerned. */
      if (keep && this.cfg.strictMull && size >= 7 && me.mulligansTaken === 0 && lands >= 2) {
        const colours = new Set();
        for (const o of hand) { const a = o.analysis(); if (a && a.isLand) for (const c of freeColours(o.card)) colours.add(c); }
        const castable = hand.filter(o => {
          const a = o.analysis();
          if (!a || a.isLand) return false;
          const p = pipsOf(o.card);
          return MTG.mana.COLORS.every(c => p[c] < 0.5 || colours.has(c));
        }).length;
        if (castable === 0 && hand.some(o => !(o.analysis() || {}).isLand)) keep = false;
      }
      if (!keep) { g.mulligan(this.pid); return; }
      // bottom the worst cards, keeping enough lands
      const need = bottomN;
      const sorted = hand.slice().sort((a, b) => this.keepValue(a, lands) - this.keepValue(b, lands));
      const bottom = [];
      let landsLeft = lands;
      for (const o of sorted) {
        if (bottom.length >= need) break;
        const a = o.analysis();
        if (a && a.isLand && landsLeft <= 3) continue;
        if (a && a.isLand) landsLeft--;
        bottom.push(o.id);
      }
      while (bottom.length < need) { const o = sorted.find(x => !bottom.includes(x.id)); if (!o) break; bottom.push(o.id); }
      g.keepHand(this.pid, bottom);
    }
    keepValue(o, lands) {
      const a = o.analysis();
      if (!a) return 0;
      if (a.isLand) return lands >= 4 ? 1 : 4;
      return this.rating(o) - Math.max(0, (a.mv || 0) - 3) * 0.6;
    }

    /* ============================================================
       Choices
       ============================================================ */

    /** The effect the engine is in the middle of resolving, if any. */
    _resolvingEffect() {
      const r = this.game.resolving;
      return r && r.effects ? r.effects[r.index] : null;
    }

    /** Answer the question on the table. `plan`, when given, is an answer already worked out (a look ahead's). */
    doChoice(ch, plan) {
      const g = this.game;
      switch (ch.type) {
        case 'declareAttackers': {
          /* A plan the engine refuses is worse than a bad plan: nothing
             happens, no event fires, and the table sits there waiting on a
             bot that has already had its turn to speak. So the compelled
             attackers are added before sending it, and if it is still
             refused the fallbacks get simpler until one goes through. */
          if (!plan) {
            try { plan = this.chooseAttacks(ch); } catch (e) { console.warn('[bot] attack plan', e); plan = []; }
          }
          if (plan.length) this._did('attack', null, `attacks with ${plan.length}`);
          if (g.declareAttackers(this.pid, plan)) return true;
          const compelled = ch.candidates.map(id => g.obj(id)).filter(o => o && g.mustAttack(o) && g.canAttack(o))
            .map(o => ({ attackerId: o.id, defenderId: o.mustAttackPlayer || (plan[0] || {}).defenderId || ch.defenders[0].id }));
          if (g.declareAttackers(this.pid, compelled)) return true;
          const everything = ch.candidates
            .map(id => g.obj(id)).filter(o => o && g.canAttack(o))
            .map(o => ({ attackerId: o.id, defenderId: (plan[0] || {}).defenderId || ch.defenders[0].id }));
          if (g.declareAttackers(this.pid, everything)) return true;
          return g.declareAttackers(this.pid, []);
        }
        case 'declareBlockers': {
          if (!plan) {
            try { plan = this.chooseBlocks(ch); } catch (e) { console.warn('[bot] block plan', e); plan = []; }
          }
          if (plan.length) this._did('block', null, `blocks with ${plan.length}`);
          if (g.declareBlockers(this.pid, plan)) return true;
          // the only plan the rules can insist on is "the ones that must block, do"
          const must = this._mustBlockPlan(ch);
          if (must.length && g.declareBlockers(this.pid, must)) return true;
          return g.declareBlockers(this.pid, []);
        }
        case 'discard': case 'discardToHandSize': {
          const ids = this.worstInHand(ch.count).map(o => o.id);
          return g.resolveChoice(this.pid, { cardIds: ids });
        }
        case 'scry': case 'surveil': {
          // the cards the question showed, not whatever is on top by now
          const lib = (ch.cards || []).map(c => g.obj(c.id)).filter(Boolean);
          if (!ch.cards) lib.push(...g.zones[this.pid].library.slice(0, ch.count));
          const top = [], bottom = [];
          for (const o of lib) (this.wantToDraw(o, top.length) ? top : bottom).push(o.id);
          // the best of what stays goes first
          top.sort((x, y) => this.drawValue(g.obj(y)) - this.drawValue(g.obj(x)));
          return g.resolveChoice(this.pid, { top, bottom });
        }
        case 'sacrifice': {
          // give up the least valuable of what the question allows
          const allowed = ch.candidates ? new Set(ch.candidates) : null;
          const pool = g.battlefield.filter(o => {
            if (o.controller !== this.pid) return false;
            if (allowed) return allowed.has(o.id);
            const a = o.analysis();
            if (!a) return false;
            const c = g.characteristics(o) || a;
            if (ch.filter === 'creature') return c.isCreature;
            if (ch.filter === 'artifact') return a.isArtifact;
            if (ch.filter === 'enchantment') return a.isEnchantment;
            if (ch.filter === 'land') return a.isLand;
            if (ch.filter === 'nonland') return !a.isLand;
            return true;
          }).sort((a, b) => this.permanentValue(a) - this.permanentValue(b));
          // an optional sacrifice (exploit and friends) is only made when there is fodder
          if (ch.optional && (!pool.length || this.permanentValue(pool[0]) > 3)) return g.resolveChoice(this.pid, { cardIds: [] });
          return g.resolveChoice(this.pid, { cardIds: pool.slice(0, ch.count).map(o => o.id) });
        }
        case 'riot': {
          // haste when it can attack into an open board or we are racing
          const opp = this.mainOpponent();
          const racing = opp && (opp.life <= 8 || this._racing(opp));
          return g.resolveChoice(this.pid, { haste: !!racing || this.d <= 3 });
        }
        /* The engine wants a target for something that has already started
           resolving — a trigger, or a mode that was chosen. The options come
           with the question, so this picks from them rather than working
           out legality again; what the effect does decides whose thing it
           points at. */
        case 'pickTarget': {
          const specs = ch.specs || [];
          const e = this._resolvingEffect() || { op: ch.op || 'damage' };
          const out = [];
          (ch.options || []).forEach((list, i) => {
            if (!list.length) return;
            const spec = specs[i] || {};
            const best = this.pickTarget(spec, e, ch.sourceId ? g.obj(ch.sourceId) : null, { options: list, taken: out });
            const ok = best && list.some(x => x.kind === best.kind && x.id === best.id);
            out.push(ok ? best : this._leastBad(list, e));
          });
          return g.resolveChoice(this.pid, { targets: out });
        }

        case 'confirm': return g.resolveChoice(this.pid, { yes: this.confirmChoice(ch) });

        case 'payOrDont': {
          /* Cumulative upkeep: pay while the permanent is worth more than
             the mana, and let it go once the counters have piled up. */
          if (ch.purpose === 'cumulativeUpkeep') {
            const o = g.obj(ch.objId);
            if (ch.life) return g.resolveChoice(this.pid, { pay: this.me.life > ch.life + 6 && o && this.permanentValue(o) > 2 });
            if (ch.energy) return g.resolveChoice(this.pid, { pay: (this.me.energy || 0) >= ch.energy });
            const cost = MTG.mana.cmc(ch.cost || '');
            const worth = o ? this.permanentValue(o) * 1.2 : 0;
            const affordable = g.couldPay(this.pid, ch.cost || '', this.manaSources());
            return g.resolveChoice(this.pid, { pay: affordable && cost <= Math.max(1, worth) });
          }
          return g.resolveChoice(this.pid, { pay: this.payChoice(ch) });
        }

        case 'mode': return g.resolveChoice(this.pid, { modes: this.chooseModes(ch) });

        case 'arrange': {
          // best first is the order you want to draw them in
          const ids = (ch.cards || []).slice().sort((x, y) => this.drawValue(g.obj(y.id)) - this.drawValue(g.obj(x.id))).map(c => c.id);
          return g.resolveChoice(this.pid, { top: ids });
        }

        case 'pickCard': return g.resolveChoice(this.pid, { cardIds: this.pickCards(ch) });

        case 'vote': {
          /* Everyone at the table voting for whatever was printed first is
             not a vote. A bot votes for what suits it when it can tell, and
             otherwise picks one rather than following the card's order. */
          const opts = ch.options || [];
          const pick = opts.length ? opts[Math.floor(this.rand() * opts.length)] : null;
          return g.resolveChoice(this.pid, { choice: pick });
        }
        case 'payOrCounter': {
          // pay to keep a spell that matters, if the mana is there
          const item = g.stack.find(st => st.id === ch.stackId);
          const worth = item && item.obj ? this.rating(item.obj) >= 3 : true;
          const can = g.couldPay(this.pid, ch.cost || '', this.manaSources());
          return g.resolveChoice(this.pid, { pay: can && (worth || this.d <= 3) });
        }
        case 'orderTriggers': return g.resolveChoice(this.pid, {});
        /* The generic question: whatever it is for, a scored answer that
           keeps to its rules; and if that is refused, the first legal one,
           so a bot never leaves the table waiting. */
        case 'choose': {
          let ans = null;
          try { ans = this.chooseGeneric(ch); } catch (e) { console.warn('[bot] choose', e); }
          if (ans && g.resolveChoice(this.pid, ans)) return true;
          return g.resolveChoice(this.pid, MTG.choice.solve(ch, { hooks: this._chooseHooks() }) || { picks: [] });
        }
        default: return g.resolveChoice(this.pid, {});
      }
    }

    /* ---- the generic question (docs/choices.md) ---- */
    _chooseHooks() {
      const g = this.game;
      return { canPay: (cost) => g.couldPay(this.pid, cost, this.manaSources()) };
    }

    /**
     * Answer any generic question. A purpose the bot knows about gets its
     * own judgement; anything else is scored candidate by candidate — what
     * a card is worth, whose it is, whether being chosen is good or bad for
     * it — and the best legal answer is taken.
     */
    chooseGeneric(ch) {
      const C = MTG.choice;
      const s = ch.constraints ? ch : C.normalize(ch);
      const hooks = this._chooseHooks();
      const own = CHOOSE_PURPOSES[s.purpose];
      if (own) {
        const a = own.call(this, s, hooks);
        if (a && C.check(s, a, hooks).ok) return a;
      }
      if (s.kind === 'number') return C.solve(s, { most: s.prefer !== 'min' });
      const scored = C.candidates(s).map(p => ({ p, v: this._chooseScore(s, p) + this.rand() * (1 - this.cfg.skill) * 0.5 }))
        .sort((x, y) => y.v - x.v);
      // take what is worth taking while it fits, then make up the numbers with the least bad
      const picks = [];
      for (const x of scored) {
        if (x.v <= 0 && picks.length >= s.min) break;
        if (C.canAdd(s, picks, x.p, hooks)) picks.push(x.p);
        if (s.repeat) while (x.v > 0 && C.canAdd(s, picks, x.p, hooks)) picks.push(x.p);
      }
      if (C.check(s, { picks }, hooks).ok) return { picks };
      return C.solve(s, { order: scored.map(x => x.p), hooks, most: picks.length > s.min });
    }

    /** How much we want this candidate picked: positive is good for us. */
    _chooseScore(s, pick) {
      const g = this.game;
      let v = 0;
      if (s.kind === 'options') {
        const opt = (s.options || [])[pick] || {};
        if (opt.card) v = rateCard(opt.card, { prior: 0 });
        else v = this._modeWorth(O.parseEffects(opt.label || '').effects);
        v = v / Math.max(1, opt.weight || 1);
      } else if (s.kind === 'players') {
        const p = g.player(pick);
        const foe = this.mainOpponent();
        v = pick === this.pid ? 1 : (foe && foe.id === pick ? -1.5 : -1);
        if (p && p.life <= 5 && pick !== this.pid) v -= 0.5;
        if (s.harmful) v = -v;
      } else {
        const o = g.obj(pick);
        const item = (s.items || []).find(x => x.id === pick) || {};
        const mine = o ? (o.controller === this.pid || (o.zone !== 'battlefield' && o.owner === this.pid)) : item.controller === this.pid;
        const worth = !o ? (item.card ? rateCard(item.card, { prior: 0 }) : 1)
          : o.zone === 'battlefield' ? this.permanentValue(o) : o.zone === 'library' && mine ? this.drawValue(o) : this.rating(o);
        v = s.harmful ? (mine ? -worth : worth) : (mine ? worth : -worth * 0.5);
      }
      return s.prefer === 'worst' ? -v : v;
    }

    /** "You may …": say yes when what follows is good for us. */
    confirmChoice(ch) {
      const g = this.game;
      /* Madness: casting it now for less is nearly always better than
         letting it sit in the graveyard. */
      if (ch.purpose === 'madness') return g.couldPay(this.pid, ch.cost || '', this.manaSources());
      if (ch.purpose === 'leyline') return true;
      if (ch.purpose === 'payToUntap') {
        // a shock land: pay when we would use the mana this turn and can spare the life
        return this.me.life > 10 && (this.d <= 3 || this._wouldUseUntapped());
      }
      const prompt = ch.prompt || '';
      if (/^Leave .* on top of your library\?/i.test(prompt)) {
        const top = g.zones[this.pid].library[0];
        return top ? this.wantToDraw(top, 0) : true;
      }
      if (/Pay \d+ life to keep a card/i.test(prompt)) return this.me.life > 12;
      const e = this._resolvingEffect();
      if (e && (e.op === 'may' || e.op === 'mayPay')) {
        const v = U.sum(flatEffects(e.then).map(x => this._contextWorth(x)));
        if (v < 0) return false;
      }
      // a "may" is nearly always upside; decline only when it costs life we cannot spare
      if (/lose \d+ life|pay \d+ life/i.test(prompt) && this.me.life <= 8) return false;
      return true;
    }

    /** "Pay {2}, or …": pay when what happens otherwise hurts us. */
    payChoice(ch) {
      const g = this.game;
      const cost = ch.cost;
      const mv = typeof cost === 'string' ? MTG.mana.cmc(cost) : (cost && cost.life) || 0;
      const affordable = typeof cost === 'string'
        ? g.couldPay(this.pid, cost, this.manaSources())
        : this.me.life - mv > 5;
      if (!affordable) return false;
      const e = this._resolvingEffect();
      // what happens if we do not pay
      const otherwise = e ? U.sum(flatEffects(e.then).map(x => this._contextWorth(x, true))) : -1;
      if (otherwise >= 0) return false;
      return mv <= 3 + this.d / 3 || otherwise < -2;
    }

    /** Effects valued from where we sit: positive is good for us. */
    _contextWorth(e, againstUs) {
      const v = effectWorth(e, 0);
      if (againstUs) return isHarmful(e) ? -Math.abs(v) - 0.5 : v * 0.3;
      return v;
    }

    /** Scored modes: what each would actually do here, best first. */
    chooseModes(ch) {
      const g = this.game;
      const e = this._resolvingEffect();
      const count = Math.max(1, ch.count || 1);
      const options = ch.options || [];
      // the colour question asks through the same door
      if (e && e.op === 'chooseColor') {
        const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        for (const o of g.battlefield.concat(this.hand())) {
          if (o.controller !== this.pid && o.owner !== this.pid) continue;
          for (const s of MTG.mana.parse(o.card.mana_cost || '')) for (const c of MTG.mana.COLORS) if (s.includes(c)) pips[c]++;
        }
        const order = ['W', 'U', 'B', 'R', 'G'];
        const best = order.slice().sort((a, b) => pips[b] - pips[a])[0];
        return [order.indexOf(best)];
      }
      const modes = e && e.op === 'modal' ? (e.modes || []) : [];
      const scored = options.map((opt, i) => {
        const m = modes[opt.i != null ? opt.i : i];
        const effects = m ? m.effects : O.parseEffects(opt.label || '').effects;
        return { i: opt.i != null ? opt.i : i, v: this._modeWorth(effects) + this.rand() * (1 - this.cfg.skill) * 2 };
      }).sort((x, y) => y.v - x.v);
      if (!scored.length) return [0];
      if (ch.repeatable) return new Array(count).fill(scored[0].i);
      return scored.slice(0, count).map(s => s.i);
    }
    _modeWorth(effects) {
      let v = 0;
      for (const e of flatEffects(effects)) {
        const base = effectWorth(e, 0);
        const specs = e.targets || [];
        if (specs.length) {
          // a mode with nothing to point at does nothing; one with a juicy target is worth more
          const t = this.pickTarget(specs[0], e, null, {});
          if (!t) { v -= 2; continue; }
          if (t.kind === 'object' && isHarmful(e)) {
            const o = this.game.obj(t.id);
            if (o && o.controller === this.pid) { v -= 2; continue; }
            v += base * 0.6 + (o ? this.threatValue(o) * 0.2 : 0);
            continue;
          }
        }
        if (e.op === 'destroyAll' || e.op === 'exileAll' || (e.op === 'damage' && e.each)) { v += this._wipeWorth(e); continue; }
        v += base;
      }
      return v;
    }

    /** Pick cards out of a list the engine offers, reading what it is for. */
    pickCards(ch) {
      const g = this.game;
      const cards = (ch.cards || []).map(c => g.obj(c.id)).filter(Boolean);
      const want = Math.max(1, ch.count || 1);
      const e = this._resolvingEffect();
      const prompt = ch.prompt || '';
      /* Usually the most valuable card on offer is the one you want: the
         best card to tutor, the most painful card to strip out of a hand.
         When the question is which of your own things to give up or put
         back, it is the least valuable instead. */
      let worst = !!ch.worst;
      if (/^Put .*on top of your library|^Sacrifice one|^Discard one|^Return .* you control to your hand/i.test(prompt)) worst = true;
      if (e && (e.op === 'sacrificeChoice' || e.op === 'handToTop' || e.op === 'returnOwn')) worst = true;
      const mine = cards.length && cards.every(o => o.owner === this.pid || o.controller === this.pid);
      if (ch.purpose === 'discardFromHand' || ch.purpose === 'exileFromHand') worst = false;
      if (ch.purpose === 'landFromHand') {
        const need = this.colorNeeds();
        return cards.sort((x, y) => this.landValue(y, need) - this.landValue(x, need)).slice(0, 1).map(o => o.id);
      }
      const value = (o) => {
        const a = o.analysis();
        if (!a) return 0;
        if (o.zone === 'battlefield') return this.permanentValue(o);
        if (mine && o.zone === 'library') return this.drawValue(o);
        return this.rating(o) + (a.isLand && mine ? (this.landsInPlay() < 5 ? 1.5 : -1) : 0);
      };
      cards.sort((x, y) => worst ? value(x) - value(y) : value(y) - value(x));
      // an optional pick of our own worst thing is declined when even that is worth keeping
      if (ch.optional && worst && cards.length && value(cards[0]) > 4) return [];
      return cards.slice(0, want).map(o => o.id);
    }

    /** The cards we would most happily lose from hand. */
    worstInHand(n) {
      const lands = this.landsInPlay();
      const hand = this.hand().slice();
      const handLands = hand.filter(o => (o.analysis() || {}).isLand).length;
      const v = (o) => {
        const a = o.analysis();
        if (!a) return 0;
        if (a.isLand) return lands + handLands >= 6 ? 0.5 : lands >= 4 ? 2.5 : 5;
        // a card we cannot cast for turns is worth less than one we can cast now
        return this.rating(o) - Math.max(0, (a.mv || 0) - lands - 1) * 0.5;
      };
      return hand.sort((x, y) => v(x) - v(y)).slice(0, n);
    }

    /** How much we want this card as our next draw. */
    drawValue(o) {
      if (!o) return 0;
      const a = o.analysis();
      if (!a) return 0;
      const lands = this.landsInPlay();
      const handLands = this.hand().filter(x => (x.analysis() || {}).isLand).length;
      if (a.isLand) return lands + handLands < 4 ? 6 : lands + handLands < 6 ? 3 : 0.5;
      const castable = (a.mv || 0) <= lands + handLands + 1;
      return this.rating(o) + (castable ? 1 : -1);
    }
    wantToDraw(o, alreadyKept) {
      if (!o) return true;
      const v = this.drawValue(o);
      // a weaker bot keeps more or less whatever it sees
      if (!this.sharp()) return v > 1.5;
      return v >= 3.6 - alreadyKept * 0.2;
    }

    /* ============================================================
       Priority: lands, spells, abilities, then pass
       ============================================================ */

    /** Returns true when it actually did something rather than passing. `move` is a look ahead's verdict, if there was one. */
    doPriority(move) {
      const g = this.game;
      const myTurn = g.activePlayer.id === this.pid;
      let acted = false;
      try { acted = this._priorityMove(myTurn, move); }
      catch (e) { console.warn('[bot] move', e); acted = false; }
      if (acted) return true;
      g.passPriority(this.pid);
      return false;
    }

    _priorityMove(myTurn, move) {
      const g = this.game;
      // a look ahead at instant speed has already decided: act on it, or let the moment pass
      if (move && move.pass) return !myTurn && g.step === 'end' && !g.stack.length && this.activateSomething('theirEnd');
      if (move && move.instant) {
        const x = move.instant;
        if (this._castInstant(x, { targets: x.targets, auto: true })) { this._did(x.kind === 'counter' ? 'counter' : 'cast', x.o, x.text || null); return true; }
      }
      const top = g.stack.length ? g.stack[g.stack.length - 1] : null;
      // something of theirs on the stack: is it worth an answer?
      if (top && top.controller !== this.pid && this.respondToStack(top)) return true;
      if (top) return false;                          // let it resolve
      if (myTurn && g.isMain) {
        const main1 = g.phaseIndex === 1;
        if (this.playLandIfUseful()) return true;
        if (move && move.cast && this.castChoice(move.cast, this.availableMana(true))) return true;
        if (move && move.activate && g.activateAbility(this.pid, move.activate.o.id, move.activate.index, this._abilityOpts(move.activate))) {
          this._did('activate', move.activate.o, move.activate.label);
          return true;
        }
        if (!(move && move.hold) && this.castFromPlan(main1 ? 'main1' : 'main2')) return true;
        if (this.activateSomething(main1 ? 'main1' : 'main2')) return true;
        return false;
      }
      // combat on either side of the table
      if (g.step === 'declareBlockers' && g.combat && g.combat.attackers.length) {
        if (this.combatTrick()) return true;
      }
      if (!myTurn) {
        // attackers are in: is one of them worth killing before blocks?
        if (g.step === 'declareAttackers' && g.combat && g.combat.attackers.length &&
            this.rand() < this.cfg.instantTiming + 0.15) {
          if (this.instantRemoval('attackers')) return true;
          if (this.castFlash('blockers')) return true;
        }
        // the end of their turn is when instants are cast
        if (g.step === 'end') {
          if (this.rand() < Math.max(0.3, this.cfg.instantTiming)) {
            if (this.instantRemoval('end')) return true;
            if (this.castFlash('end')) return true;
          }
          if (this.activateSomething('theirEnd')) return true;
        }
      }
      return false;
    }

    /* ---- lands ---- */
    playLandIfUseful() {
      const g = this.game;
      if (!g.canPlayLand(this.pid)) return false;
      let lands = this.hand().filter(o => { const a = o.analysis(); return a && a.isLand; });
      // with no land in hand, a spell with a land on its back goes down as the land
      if (!lands.length) {
        const backs = this.hand().filter(o => g.landBack(o));
        if (!backs.length || !g.playLand(this.pid, backs[0].id, 1)) return false;
        this._did('land', backs[0]);
        return true;
      }
      const need = this.colorNeeds();
      const useNow = this._wouldUseUntapped();
      let pick;
      if (!this.sharp() && this.slips()) pick = lands[Math.floor(this.rand() * lands.length)];
      else pick = lands.slice().sort((a, b) => this.landValue(b, need, useNow) - this.landValue(a, need, useNow))[0];
      if (!g.playLand(this.pid, pick.id)) return false;
      this._did('land', pick);
      return true;
    }

    /** Would one more untapped mana this turn let us cast something better? */
    _wouldUseUntapped() {
      const g = this.game;
      const mana = this.manaSources().length;
      return this.hand().some(o => {
        const a = o.analysis();
        if (!a || a.isLand) return false;
        const mv = a.mv || 0;
        return mv === mana + 1 || (mv <= mana + 1 && (a.isInstant || a.has('flash')));
      });
    }

    landValue(o, need, useNow) {
      const a = o.analysis();
      if (!a) return 0;
      let v = 1;
      const prod = (o.card.produced_mana || a.producedColors || []).filter(c => c !== 'C');
      for (const c of prod) v += (need[c] || 0) * 0.5;
      // a tapped land is best played on a turn the mana would not be used anyway
      if (a.entersTapped) v -= useNow ? 1.5 : 0.1;
      if (prod.length > 1) v += 0.4;
      if (a.isBasicLand) v -= 0.1;
      if (!prod.length) v -= 0.3;
      return v;
    }

    colorNeeds() {
      const g = this.game;
      const need = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const o of this.hand().concat(g.zones[this.pid].command))
        for (const s of MTG.mana.parse(o.card.mana_cost || ''))
          for (const c of MTG.mana.COLORS) if (s.includes(c)) need[c]++;
      const have = {};
      for (const o of g.battlefield) {
        if (o.controller !== this.pid) continue;
        for (const c of (o.card.produced_mana || [])) have[c] = (have[c] || 0) + 1;
      }
      for (const c of MTG.mana.COLORS) need[c] = Math.max(0, need[c] - (have[c] || 0) * 1.5);
      return need;
    }

    /**
     * The sources this bot could tap, as the engine describes them — less
     * the ones that eat themselves. Auto-tap never cracks a Treasure, so a
     * plan that counts one is a plan the engine refuses; with
     * `withSpendable` they are counted, and castChoice cracks them by hand
     * when a spell needs them.
     */
    manaSources(withSpendable) {
      const g = this.game;
      const p = this.me;
      const out = [];
      if (!p) return out;
      for (const c of MTG.mana.COLORS) for (let i = 0; i < (p.pool[c] || 0); i++) out.push(c);
      for (let i = 0; i < (p.pool.C || 0); i++) out.push('');
      /* Read off the abilities auto-tap will actually use, rather than the
         card's list of colours: a Cavern of Souls makes any colour only for
         one creature type, a Mox only with a Dragon about, and a plan built
         on either is a plan the engine turns down. */
      for (const o of g.battlefield) {
        if (o.controller !== this.pid || o.tapped || o.phasedOut) continue;
        const a = o.analysis();
        if (!a || !a.manaAbilities.length) continue;
        if (this._isCreature(o) && o.summoningSick && !g.hasKw(o, 'haste')) continue;
        const restricted = /Spend this mana only/i.test(o.card.oracle_text || '');
        const cols = new Set();
        let usable = false;
        for (const m of a.manaAbilities) {
          const c = m.cost || {};
          if (c.mana || c.sacSelf || c.sacrifice || c.discard || c.exile || c.removeCounters || (c.other || []).length) continue;
          if (c.life && p.life <= c.life) continue;
          if (g._activationBlocked(o, m, this.pid)) continue;
          usable = true;
          for (const e of m.effects || []) {
            if (e.op === 'addMana') for (const sym of e.symbols || []) for (const col of MTG.mana.COLORS) if (sym.includes(col)) cols.add(col);
            if ((e.op === 'addManaAny' || e.op === 'addManaChoice') && !restricted) {
              if (e.op === 'addManaChoice') { for (const ch of e.choices || []) for (const sym of ch) for (const col of MTG.mana.COLORS) if (sym.includes(col)) cols.add(col); }
              else MTG.mana.COLORS.forEach(col => cols.add(col));
            }
          }
        }
        if (!usable) {
          if (withSpendable && a.manaAbilities.some(m => m.cost && m.cost.sacSelf && !m.cost.mana)) {
            out.push((o.card.produced_mana || a.producedColors || []).filter(c => 'WUBRG'.indexOf(c) >= 0).join(''));
          }
          continue;
        }
        if (!cols.size && !restricted) for (const c of (o.card.produced_mana || [])) if ('WUBRG'.indexOf(c) >= 0) cols.add(c);
        out.push(MTG.mana.COLORS.filter(c => cols.has(c)).join(''));
      }
      return out;
    }
    availableMana(withSpendable) { return this.manaSources(withSpendable).length; }

    /** Untapped permanents whose only mana costs the permanent itself: Treasures and friends. */
    _spendableSources() {
      const g = this.game;
      const out = [];
      for (const o of g.battlefield) {
        if (o.controller !== this.pid || o.tapped || o.phasedOut) continue;
        const a = o.analysis();
        if (!a || !a.manaAbilities.length) continue;
        if (this._isCreature(o) && o.summoningSick && !g.hasKw(o, 'haste')) continue;
        const free = a.manaAbilities.some(m => !(m.cost && (m.cost.sacSelf || m.cost.sacrifice || m.cost.mana ||
          m.cost.discard || m.cost.exile || m.cost.removeCounters || (m.cost.other || []).length)));
        if (free) continue;
        const index = a.manaAbilities.findIndex(m => m.cost && m.cost.sacSelf && !m.cost.mana);
        if (index < 0) continue;
        const cols = (o.card.produced_mana || a.producedColors || []).filter(c => 'WUBRG'.indexOf(c) >= 0).join('');
        out.push({ o, index, colors: cols });
      }
      return out;
    }

    /** Crack Treasures until this cost can be paid from what is left, choosing the colours it lacks. */
    _crackFor(cost) {
      const g = this.game;
      const bare = String(cost || '').replace(/\{X\}/g, '');
      for (let guard = 0; guard < 8 && !g.couldPay(this.pid, bare, this.manaSources()); guard++) {
        const spend = this._spendableSources();
        if (!spend.length) return false;
        const s = spend[0];
        // the colour the cost is shortest of, among those the source can make
        const have = this.manaSources();
        let colour = null, worst = 0;
        for (const c of MTG.mana.COLORS) {
          if (s.colors && s.colors.indexOf(c) < 0) continue;
          const need = MTG.mana.parse(bare).filter(x => x === c).length;
          const short = need - have.filter(x => x.indexOf(c) >= 0).length;
          if (short > worst) { worst = short; colour = c; }
        }
        if (!g.tapForMana(this.pid, s.o.id, s.index, colour || (s.colors || 'C')[0])) return false;
      }
      return g.couldPay(this.pid, bare, this.manaSources());
    }

    /* ---- spells ---- */

    /**
     * Everything castable right now, each with what casting it would cost
     * and what it is worth on this board. Worth is relative: a removal
     * spell with nothing worth removing is worth little, a wrath on a board
     * that favours us is worth less than nothing.
     */
    castOptions(when) {
      const g = this.game;
      const sources = this.manaSources(true);
      const mana = sources.length;
      const z = g.zones[this.pid];
      const out = [];
      const consider = (o, via) => {
        const a = o.analysis();
        if (!a || a.isLand || this._wasRefused(o)) return;
        const chk = g.canCast(this.pid, o.id, via ? via.via : undefined);
        if (!chk.ok) return;
        const costStr = via ? (via.cost || '') : (chk.cost || '');
        if (!g.couldPay(this.pid, costStr, sources)) return;
        const cost = MTG.mana.cmc(costStr);
        if (cost > mana) return;
        if (!g._targetsAvailable(g._spellEffects(a), this.pid)) return;
        const v = this.spellWorth(o, a, when, cost);
        if (v == null) return;
        out.push({ o, a, v, cost, costStr, via: via ? via.via : null });
      };
      for (const o of z.hand.concat(z.command)) {
        consider(o, null);
        /* An adventurer: the adventure first is a card and a half — the
           creature waits in exile for later. Weighed as the half it casts. */
        if (o.zone === 'hand' && g._adventure && g._adventure(o)) {
          const before = out.length;
          g._asHalf(o, 1, () => consider(o, null));
          for (const x of out.slice(before)) { x.face = 1; x.v += 1; }
        }
        /* A split card: the right half is a spell of its own, and with fuse
           both halves at once — worth the two together when both can be
           paid for and both have something to do. */
        if (o.zone === 'hand' && g._splitHalves && g._splitHalves(o)) {
          const left = out.find(x => x.o === o && x.face == null && !x.via);
          if (left) left.face = 0;
          const before = out.length;
          g._asHalf(o, 1, () => consider(o, null));
          const right = out.slice(before).find(x => x.o === o);
          if (right) right.face = 1;
          if (left && right && g._fusable(o) && left.cost + right.cost <= mana &&
              g.couldPay(this.pid, (left.costStr || '') + (right.costStr || ''), sources)) {
            out.push({ o, a: left.a, aRight: right.a, v: left.v + right.v, cost: left.cost + right.cost,
              costStr: (left.costStr || '') + (right.costStr || ''), via: null, fuse: true });
          }
        }
        /* A creature you cannot pay for is still a 2/2 for three if it has
           morph — which is what morph is for. */
        for (const use of (g.altUsesFor(this.pid, o.id) || [])) {
          if (use.kind !== 'cast' || !/^(morph|evoke|dash|blitz|warp|bestow|spectacle)$/.test(use.via)) continue;
          if (out.some(x => x.o.id === o.id && !x.via)) continue;
          consider(o, use);
        }
      }
      // back from an adventure: the creature, cast from exile like a card in hand
      for (const o of z.exile) if (o.adventureBy === this.pid) consider(o, null);
      // flashback and its friends: a card in the graveyard is a card in hand for these
      for (const o of z.graveyard.concat(z.exile)) {
        for (const use of (g.altUsesFor(this.pid, o.id) || [])) {
          if (use.kind !== 'cast') continue;
          consider(o, use);
        }
      }
      return out;
    }

    /**
     * What casting this would be worth right now, or null when it should
     * not be cast now at all (a counterspell with nothing to counter, a
     * trick outside combat, a wrath that kills more of ours).
     */
    spellWorth(o, a, when, cost) {
      const g = this.game;
      const roles = rolesOf(o.card);
      const r = this.rating(o);
      const effects = a.isPermanent ? [] : flatEffects(g._cardSpellEffects(a));
      let v = Math.max(0.5, r);
      // counterspells and tricks are answers to something; in a main phase there is nothing to answer
      if (effects.length && effects.every(e => e.op === 'counterSpell' || e.op === 'counterUnless' || e.op === 'copySpell')) return null;
      if (!a.isPermanent && roles.has('trick') && !roles.has('removal') && !roles.has('draw')) return null;
      const opp = this.mainOpponent();
      // burn that finishes the game is the best spell in the world
      const reach = this._burnDamage(a);
      if (reach && opp && reach >= opp.life) return 50;
      if (roles.has('wipe') && !a.isPermanent) {
        const w = this._wipeWorth(effects.find(e => e.op === 'destroyAll' || e.op === 'exileAll' || e.op === 'bounceAll' || (e.op === 'damage' && e.each)) || {});
        if (w <= 0.5 && this.sharp()) return null;
        return w;
      }
      if (roles.has('removal') && !a.isCreature && !a.isPermanent) {
        const t = this._bestRemovalTarget(effects);
        if (!t) return null;
        const tv = this.threatValue(t);
        /* Holding removal is only clever while you can afford to wait.
           Under pressure, in a race you are winning, or when the burn in
           hand is lethal, it is a card you should have used two turns ago
           — a burn deck that sits on its Lightning Bolts waiting for a
           creature to kill loses to one that points them at the player. */
        const waitable = !this.underPressure() && !(opp && this._racing(opp));
        if (waitable && tv < 4.5 && this.rand() < U.clamp(this.cfg.holdRemoval + this.lean('hold'), 0, 1)) return null;
        v = 1.5 + tv * 0.55;
      } else if (roles.has('burn') && !a.isPermanent && opp) {
        // face damage is a clock when we are ahead, a waste when we are not
        // a bloodthirsty bot calls it a clock a little sooner
        const clock = this._racing(opp) || (this.lean('face') > 0 && opp.life <= 12);
        v = clock && this.sharp() ? 1.5 + reach * 0.4 : 0.8;
      }
      if (a.isAura && !a.isCreature) {
        const tg = this.chooseTargets(o, a);
        if (!tg || !tg.length) return null;
      }
      if (a.isCreature || a.isPlaneswalker) {
        // bodies on the board early are what a curve is for
        v += 0.6 + (a.isPlaneswalker ? 1 : 0);
        if (when === 'main1' && !a.has('haste') && this.sharp() && this.d >= 6) v -= 0.05;   // fine either side of combat
      }
      if (roles.has('draw') && !a.isPermanent && this.hand().length >= 6) v -= 1;
      // lifegain on its own is for when the life matters
      if (effects.length && effects.every(e => e.op === 'gainLife') && !this.underPressure()) v = 0.6;
      // instants are better kept for their turn, at the levels that know it
      if ((a.isInstant || a.has('flash')) && when !== 'now' && this.rand() < this.cfg.instantTiming) {
        if (!roles.has('removal') || this.d >= 6) v -= 1.5;
      }
      return v;
    }

    /**
     * Spend this main phase's mana well. A sharp bot tries the
     * combinations — two two-drops against one four-drop — and casts the
     * first card of the best one; the plan is redrawn after every spell,
     * since every spell changes the board. A weaker bot casts something
     * reasonable, not always the best thing.
     */
    castFromPlan(when) {
      const g = this.game;
      // a beginner plays one thing a turn and is pleased with it
      if ((this.me.spellsCastThisTurn || 0) >= (this.cfg.spellCap || 99)) return false;
      let options = this.castOptions(when).filter(x => x.v > 0);
      if (!options.length) return false;
      const mana = this.availableMana(true);
      let order;
      if (this.cfg.plan && this.sharp()) {
        const plan = this._bestPlan(options, mana);
        // removal and creature-shrinking first, so the rest of the turn sees the cleared board
        order = plan.sort((x, y) => this._castPriority(y, when) - this._castPriority(x, when));
        if (!order.length) return false;
        // whatever else could still be cast follows, in case the first choice is refused
        for (const x of options.sort((p, q) => q.v - p.v)) if (!order.includes(x)) order.push(x);
      } else {
        options.sort((x, y) => (y.v + y.cost * 0.15) - (x.v + x.cost * 0.15));
        // a showman casts the biggest thing it can, now and then
        if (this.lean('splash') > 0 && this.rand() < 0.5) options.sort((x, y) => y.cost - x.cost);
        const k = Math.min(options.length, 1 + Math.floor((1 - this.cfg.skill) * 3));
        const first = options[Math.floor(this.rand() * k)];
        order = [first].concat(options.filter(x => x !== first));
      }
      /* The first pick may turn out to have nowhere to point — Act of
         Treason with an empty board across the table. That is a reason to
         cast the next thing down, not a reason to sit there doing nothing,
         so the list is walked until something actually goes on the stack. */
      for (const choice of order) {
        if (this.castChoice(choice, mana)) return true;
      }
      return false;
    }

    _castPriority(x, when) {
      const roles = rolesOf(x.o.card);
      let p = 0;
      if (roles.has('removal') || roles.has('wipe')) p += 3;
      if (x.a.has('haste')) p += 2;
      if (x.a.isEquipment || x.a.isAura) p -= 1;
      if (x.a.manaAbilities && x.a.manaAbilities.length) p += 2.5;       // ramp first: it pays for the rest
      if (roles.has('draw')) p += 1;                                       // see the new card before spending the rest
      // an engine builder gets its engines down first: they pay off every turn after
      if (this.lean('engine') && x.a.isPermanent && !x.a.isCreature && !x.a.isLand) p += 1.5 * this.lean('engine');
      if (this.lean('splash')) p += x.cost * 0.3 * this.lean('splash');
      return p + x.cost * 0.1;
    }

    /** The set of spells that makes the most of this mana. */
    _bestPlan(options, mana) {
      const g = this.game;
      const list = options.slice().sort((x, y) => y.v - x.v).slice(0, 9);
      let best = [], bestV = 0;
      const sources = this.manaSources(true);
      const n = list.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        let cost = 0, v = 0, cnt = 0;
        const pick = [];
        for (let i = 0; i < n; i++) if (mask & (1 << i)) { cost += list[i].cost; v += list[i].v; pick.push(list[i]); cnt++; }
        if (cnt > 4 || cost > mana) continue;
        // a bonus for mana actually used: tempo is worth something in its own right
        const score = v + cost * 0.2;
        if (score <= bestV) continue;
        if (cnt > 1) {
          const all = pick.map(x => String(x.costStr || '').replace(/\{X\}/g, '')).join('');
          if (!g.couldPay(this.pid, all, sources)) continue;
        }
        best = pick; bestV = score;
      }
      return best.length ? best : [list[0]];
    }

    /** Cast one option: targets, extra costs, X. Returns true if it went on the stack. */
    castChoice(choice, mana) {
      const g = this.game;
      // a look ahead may have settled the targets already
      let targets = choice.targets || (choice.face != null
        ? g._asHalf(choice.o, choice.face, () => this.chooseTargets(choice.o, choice.a))
        : this.chooseTargets(choice.o, choice.a));
      // fused: the left half's targets, then the right half's
      if (choice.fuse && targets !== null && !choice.targets) {
        const right = g._asHalf(choice.o, 1, () => this.chooseTargets(choice.o, choice.aRight));
        targets = right === null ? null : (targets || []).concat(right || []);
      }
      if (targets === null) return false;            // needs a target and none is worth it
      const opts = { targets, auto: true };
      if (choice.fuse) opts.fuse = true;
      else if (choice.face != null) opts.face = choice.face;
      if (choice.via) opts.via = choice.via;
      /* Kicker and friends: pay for the better version when the mana is
         spare, because that is what the extra cost is for. */
      const extras = g.extraCostsFor(choice.o.id);
      let spare = mana - choice.cost;
      if (extras.length) {
        for (const ex of extras) {
          const price = MTG.mana.cmc(ex.cost || '');
          if (ex.kind === 'spree') {
            // buy the modes we can afford, best first
            const ranked = (ex.modes || []).map(m => ({ m, v: this._modeWorth((((choice.a.abilities || []).find(x => x.kind === 'spell' && (x.effects || []).some(y => y.op === 'modal')) || {}).effects || [])
              .filter(y => y.op === 'modal').map(y => (y.modes || [])[m.i]).filter(Boolean).map(y => y.effects).flat()) }))
              .sort((x, y) => y.v - x.v);
            const picked = [];
            let left = spare;
            for (const r of ranked) {
              // escalate: each mode beyond the first costs the escalate cost
              const c = MTG.mana.cmc(r.m.cost || '') + (ex.escalate && picked.length ? MTG.mana.cmc(ex.escalate) : 0);
              if (c <= left && (r.v > 0 || !picked.length)) { picked.push(r.m.i); left -= c; }
            }
            if (!picked.length) return false;
            opts.spree = picked;
            spare = left;
            continue;
          }
          if (price > spare) continue;
          if (ex.kind === 'kicker') { opts.kick = 1; spare -= price; }
          else if (ex.kind === 'multikicker') {
            const times = price > 0 ? Math.floor(spare / price) : 0;
            if (times > 0) { opts.kick = times; spare -= times * price; }
          } else if (ex.kind === 'entwine') { opts.entwine = true; spare -= price; }
          else if (ex.kind === 'buyback' && this.d >= 5) { opts.buyback = true; spare -= price; }
          else if ((ex.kind === 'offspring' || ex.kind === 'squad') && this.d >= 3) { opts[ex.kind] = ex.kind === 'squad' ? Math.max(1, Math.floor(spare / Math.max(1, price))) : true; spare -= price; }
        }
      }
      // an {X} spell is only worth casting for a real X, so spend what is left over
      if (/\{X\}/.test(choice.costStr || choice.o.card.mana_cost || '')) {
        const left = Math.max(0, spare);
        opts.x = this.d >= 4 ? left : Math.min(left, 1 + Math.floor(this.rand() * 3));
        if (opts.x <= 0 && !(choice.a.isPermanent)) return false;
      }
      // a Treasure is only cracked once the spell is really going to be cast
      if (!g.couldPay(this.pid, String(choice.costStr || '').replace(/\{X\}/g, ''), this.manaSources()) && !this._crackFor(choice.costStr)) return false;
      if (!g.castSpell(this.pid, choice.o.id, opts)) { this._refused(choice.o); return false; }
      this._did('cast', choice.o);
      return true;
    }

    /* ---- the other player's turn ---- */

    /** Something of an opponent's is on the stack: counter it, or answer it. */
    respondToStack(item) {
      const g = this.game;
      const counters = this.castOptionsInstant().filter(x => flatEffects(g._cardSpellEffects(x.a)).some(e => e.op === 'counterSpell' || e.op === 'counterUnless'));
      if (!counters.length || item.kind !== 'spell') return false;
      const threat = this.stackThreat(item);
      /* Which spells deserve a counterspell is most of the skill of
         playing one. A poor player counters the first thing they see; a
         good one waits for the spell that would beat them. */
      const sense = this.cfg.counterSense;
      let want;
      if (this.rand() > sense) want = this.rand() < 0.5;
      else want = threat >= 4.2 - (this.hand().length > 4 ? 0.4 : 0) || (threat >= 3.6 && this.underPressure());
      if (!want) return false;
      const pick = counters.sort((x, y) => x.cost - y.cost)[0];
      const target = { kind: 'stack', id: item.id };
      const opts = { targets: [target], auto: true };
      if (!this._castInstant(pick, opts)) return false;
      this._did('counter', pick.o, `counters ${item.name}`);
      return true;
    }

    /** How much a spell on the stack would hurt us if it resolved. */
    stackThreat(item) {
      const g = this.game;
      const o = item.obj;
      if (!o) return 0;
      const a = o.analysis();
      let t = this.rating(o);
      if (!a) return t;
      if (a.isCreature) t += (g.powerOf(o) >= 4 ? 0.6 : 0);
      if (a.isPlaneswalker) t += 1;
      const effects = a.isPermanent ? [] : flatEffects(item.effects || g._cardSpellEffects(a));
      for (const e of effects) {
        if (e.op === 'destroyAll' || e.op === 'exileAll' || (e.op === 'damage' && e.each)) {
          const mine = this.myCreatures().length, theirs = g.battlefield.filter(x => x.controller === item.controller && this._isCreature(x)).length;
          t += (mine - theirs) * 0.8;
        }
      }
      // anything pointed at our best permanent is aimed at us
      for (const tg of (item.targets || [])) {
        if (tg.kind === 'object') {
          const x = g.obj(tg.id);
          if (x && x.controller === this.pid) t += this.threatValue(x) * 0.35;
        }
        if (tg.kind === 'player' && tg.id === this.pid) t += 0.5;
      }
      return t;
    }

    /** Cast something at instant speed, cracking a Treasure first if that is what pays for it. */
    _castInstant(x, opts) {
      const g = this.game;
      if (!g.couldPay(this.pid, x.costStr || '', this.manaSources()) && !this._crackFor(x.costStr)) return false;
      return g.castSpell(this.pid, x.o.id, opts);
    }

    /** Castable instants and flash cards, without any main-phase judgement. */
    castOptionsInstant() {
      const g = this.game;
      const sources = this.manaSources(true);
      const out = [];
      for (const o of g.zones[this.pid].hand) {
        const a = o.analysis();
        if (!a || a.isLand || !(a.isInstant || a.has('flash'))) continue;
        const chk = g.canCast(this.pid, o.id);
        if (!chk.ok || !g.couldPay(this.pid, chk.cost || '', sources)) continue;
        out.push({ o, a, cost: MTG.mana.cmc(chk.cost || ''), costStr: chk.cost || '' });
      }
      return out;
    }

    /** Kill something at instant speed: an attacker, or their best threat at end of turn. */
    instantRemoval(window) {
      const g = this.game;
      const opts = this.castOptionsInstant().filter(x => rolesOf(x.o.card).has('removal'));
      if (!opts.length) return false;
      for (const x of opts.sort((p, q) => p.cost - q.cost)) {
        const effects = flatEffects(g._cardSpellEffects(x.a));
        let t = this._bestRemovalTarget(effects, window === 'attackers' ? (o) => g.combat.attackers.includes(o.id) : null);
        if (!t) continue;
        const tv = this.threatValue(t);
        const bar = window === 'attackers' ? 3 : 4;
        // a weak player fires it at the first thing that moves; a good one waits for something worth it
        if (tv < bar && this.sharp()) continue;
        const targets = this.chooseTargets(x.o, x.a, { forceObject: t });
        if (!targets) continue;
        if (this._castInstant(x, { targets, auto: true })) { this._did('cast', x.o, `removes ${t.name}`); return true; }
      }
      return false;
    }

    /** A flash creature, or an instant that draws, at the end of their turn. */
    castFlash(window) {
      const g = this.game;
      const opts = this.castOptionsInstant().filter(x => {
        const roles = rolesOf(x.o.card);
        if (window === 'blockers') return x.a.isCreature;
        return x.a.isCreature || (roles.has('draw') && !roles.has('counter')) ||
          (!x.a.isPermanent && !roles.has('counter') && !roles.has('trick') && !roles.has('removal') && this.rating(x.o) >= 3);
      });
      if (!opts.length) return false;
      opts.sort((p, q) => this.rating(q.o) - this.rating(p.o));
      for (const x of opts) {
        const targets = this.chooseTargets(x.o, x.a);
        if (targets === null) continue;
        if (this._castInstant(x, { targets, auto: true })) { this._did('cast', x.o); return true; }
      }
      return false;
    }

    /**
     * Blocks are in: is there a pump spell that turns a losing fight into
     * a winning one? Only worth a card when it decides who dies.
     */
    combatTrick() {
      const g = this.game;
      if (!this.sharp() && this.rand() > 0.3) return false;
      const tricks = this.castOptionsInstant().filter(x => {
        const effects = flatEffects(g._cardSpellEffects(x.a));
        return effects.some(e => e.op === 'pump' && nval(e.p, 0) + nval(e.t, 0) > 0 && (e.targets || []).length);
      });
      if (!tricks.length) return false;
      for (const x of tricks) {
        const e = flatEffects(g._cardSpellEffects(x.a)).find(y => y.op === 'pump');
        const dp = nval(e.p, 0), dt = nval(e.t, 0);
        let best = null, bestGain = 0;
        for (const mine of this.myCreatures()) {
          const fights = this._fightsOf(mine);
          for (const other of fights) {
            const before = this._duel(mine, other, 0, 0);
            const after = this._duel(mine, other, dp, dt);
            let gain = 0;
            if (before.iDie && !after.iDie) gain += this.threatValue(mine);
            if (!before.theyDie && after.theyDie) gain += this.threatValue(other);
            if (gain > bestGain) { bestGain = gain; best = mine; }
          }
        }
        if (!best || bestGain < 2.5) continue;
        const targets = [{ kind: 'object', id: best.id }];
        if (this._castInstant(x, { targets, auto: true })) { this._did('cast', x.o, `pumps ${best.name}`); return true; }
      }
      return false;
    }
    /** The creatures this one is fighting in the current combat. */
    _fightsOf(o) {
      const g = this.game;
      if (o.attacking) return (o.blockedBy || []).map(id => g.obj(id)).filter(Boolean);
      return (o.blocking || []).map(id => g.obj(id)).filter(Boolean);
    }
    /** One-on-one combat with a bonus on our side. */
    _duel(mine, other, dp, dt) {
      const g = this.game;
      const myP = g.powerOf(mine) + dp, myT = g.toughnessOf(mine) - (mine.damage || 0) + dt;
      const thP = g.powerOf(other), thT = g.toughnessOf(other) - (other.damage || 0);
      const myDT = g.hasKw(mine, 'deathtouch'), thDT = g.hasKw(other, 'deathtouch');
      const myFS = g.hasKw(mine, 'first strike') || g.hasKw(mine, 'double strike');
      const thFS = g.hasKw(other, 'first strike') || g.hasKw(other, 'double strike');
      const theyDie = myP >= thT || (myDT && myP > 0);
      const iDieRaw = thP >= myT || (thDT && thP > 0);
      const iDie = iDieRaw && !(myFS && !thFS && theyDie) && !g.hasKw(mine, 'indestructible');
      return { iDie, theyDie: theyDie && !(thFS && !myFS && iDieRaw) && !g.hasKw(other, 'indestructible') };
    }

    /* ---- abilities ---- */

    /**
     * Activated abilities worth using: equipment onto the best attacker,
     * a planeswalker's best loyalty ability, and anything else whose
     * effect is worth its cost — with spare mana, at a sensible moment.
     */
    activateSomething(window) {
      const g = this.game;
      if (this.cfg.skill < 0.1 && this.rand() < 0.5) return false;
      const memoKey = g.turn + ':' + g.phaseIndex + ':' + g.step;
      if (this._turnMemo.key !== memoKey) this._turnMemo = { key: memoKey, tried: new Set() };
      const sources = this.manaSources();
      const cands = [];
      for (const o of g.battlefield) {
        if (o.controller !== this.pid) continue;
        const a = o.analysis();
        if (!a) continue;
        const all = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
        all.forEach((ab, index) => {
          if (ab.kind === 'mana' || !ab.auto) return;
          if (this._turnMemo.tried.has(o.id + ':' + index)) return;
          const c = this._abilityCandidate(o, a, ab, index, window, sources);
          if (c) cands.push(c);
        });
      }
      if (!cands.length) return false;
      cands.sort((x, y) => y.v - x.v);
      for (const c of cands) {
        this._turnMemo.tried.add(c.o.id + ':' + c.index);
        if (c.v <= 0.3 - this.lean('engine') * 0.2) break;
        const opts = { targets: c.targets, auto: true };
        if (c.sacrificeIds) opts.sacrificeIds = c.sacrificeIds;
        if (c.discardIds) opts.discardIds = c.discardIds;
        if (g.activateAbility(this.pid, c.o.id, c.index, opts)) { this._did('activate', c.o, c.label); return true; }
      }
      return false;
    }

    /** Whether, and how much, to use one ability now. Null when not. */
    _abilityCandidate(o, a, ab, index, window, sources) {
      const g = this.game;
      const myTurn = g.activePlayer.id === this.pid;
      const cost = ab.cost || {};
      if (g._activationBlocked(o, ab, this.pid)) return null;
      if ((cost.other || []).length) return null;
      if (cost.tap && o.tapped) return null;
      if (cost.untap && !o.tapped) return null;
      if (cost.tap && this._isCreature(o) && o.summoningSick && !g.hasKw(o, 'haste')) return null;
      if (cost.life && this.me.life <= cost.life + 5) return null;
      if (cost.removeCounters && (Number(o.counters[String(cost.removeCounters.kind || '').replace(/\s+counters?$/i, '').trim()]) || 0) < (cost.removeCounters.n || 1)) return null;
      const sorcery = ab.sorcerySpeed || ab.kind === 'loyalty';
      if (sorcery && !(myTurn && g.isMain && g.stackEmpty)) return null;
      if (ab.kind === 'loyalty' && o.activatedLoyaltyThisTurn) return null;
      if (cost.mana && !g.couldPay(this.pid, cost.mana, sources)) return null;
      const effects = ab.effects || [];
      const flat = flatEffects(effects);
      if (!flat.length || flat.some(e => e.op === 'manual')) return null;
      const label = MTG.oracle.abilityLabel ? MTG.oracle.abilityLabel(ab, o) : (ab.text || '');

      // equipment: onto the best creature that is not already carrying it
      if (flat.some(e => e.op === 'attachSelf')) {
        if (window !== 'main1' && !(window === 'main2' && !o.attachedTo)) return null;
        const host = o.attachedTo ? g.obj(o.attachedTo) : null;
        const best = this.myCreatures().filter(c => !c.summoningSick || g.hasKw(c, 'haste'))
          .sort((x, y) => this.threatValue(y) - this.threatValue(x))[0] || this.myCreatures()[0];
        if (!best || (host && host.id === best.id)) return null;
        if (host && host.zone === 'battlefield' && this.threatValue(host) >= this.threatValue(best) - 1) return null;
        return { o, index, targets: [{ kind: 'object', id: best.id }], v: 2 + this.rating(o) * 0.2, label };
      }

      // loyalty: the best of what this walker can do now
      let v = 0;
      let sacrificeIds, discardIds;
      if (ab.kind === 'loyalty') {
        const loy = g.loyaltyOf ? g.loyaltyOf(o) : (o.counters.loyalty || 0);
        const delta = (ab.cost || {}).loyalty || 0;
        if (delta < 0 && -delta >= loy && !(-delta === loy && this.d >= 8)) return null;
        v = this._effectsHere(flat) + delta * (this.underPressure() ? 0.45 : 0.3) + 1;
        if (v <= 0 && delta >= 0) v = 0.6;                 // ticking up is never nothing
      } else {
        v = this._effectsHere(flat);
        const mana = MTG.mana.cmc(cost.mana || '');
        // a creature that taps for value is not attacking or blocking
        if (cost.tap && this._isCreature(o)) {
          if (myTurn && window === 'main1') return null;
          if (!myTurn && window !== 'theirEnd') return null;
          v -= this.threatValue(o) * 0.15;
        }
        // instant-speed abilities wait for the end of their turn, at the levels that know to
        if (!sorcery && myTurn && window === 'main1' && this.rand() < this.cfg.instantTiming) return null;
        v -= mana * 0.25;
        if (cost.sacSelf) v -= this.permanentValue(o);
        if (cost.life) v -= cost.life * 0.15;
        if (cost.sacrifice) {
          const fodder = this._fodder(cost.sacrifice);
          if (!fodder) return null;
          v -= this.permanentValue(fodder);
          sacrificeIds = [fodder.id];
        }
        if (cost.discard) {
          const toss = this.worstInHand(1)[0];
          if (!toss) return null;
          v -= Math.max(0.5, this.rating(toss) - 2);
          discardIds = [toss.id];
        }
      }
      // targets: chosen as for a spell, and an ability with nothing worth pointing at waits
      const targets = this.chooseTargetsForEffects(effects.concat((ab.targets || []).map(spec => ({ op: flat[0].op, targets: [spec] }))), o);
      if (targets === null) return null;
      if (v <= 0) return null;
      return { o, index, targets, v, label, sacrificeIds, discardIds };
    }

    /** A permanent we could give up to a cost: the least valuable that fits. */
    _fodder(spec) {
      const g = this.game;
      const want = String((spec && (spec.filter || spec.what)) || spec || 'creature').toLowerCase();
      const list = g.battlefield.filter(o => o.controller === this.pid && g._matchesFilter && g._matchesFilter(o, want));
      list.sort((x, y) => this.permanentValue(x) - this.permanentValue(y));
      return list[0] && this.permanentValue(list[0]) < 2.5 ? list[0] : null;
    }

    /** What these effects would do on this board, in rough card terms. */
    _effectsHere(flat) {
      const g = this.game;
      let v = 0;
      for (const e of flat) {
        const base = effectWorth(e, 0);
        if (e.op === 'pump' && e.duration === 'eot') {
          // a pump outside combat does nothing
          if (!(g.combat && g.combat.attackers.length)) continue;
        }
        if (e.op === 'untap' || e.op === 'tap' && !(e.targets || []).length) continue;
        if (e.op === 'gainLife' && !this.underPressure()) { v += base * 0.4; continue; }
        if (e.op === 'draw' && this.hand().length >= 7) { v += base * 0.3; continue; }
        if ((e.targets || []).length) {
          const t = this.pickTarget(e.targets[0], e, null, {});
          if (!t) return -1;
          if (isHarmful(e) && t.kind === 'object') {
            const o = g.obj(t.id);
            if (!o || o.controller === this.pid) return -1;
            v += Math.min(base, 1 + this.threatValue(o) * 0.4);
            continue;
          }
        }
        if (e.op === 'destroyAll' || e.op === 'exileAll' || (e.op === 'damage' && e.each)) { v += this._wipeWorth(e); continue; }
        v += base;
      }
      return v;
    }

    /* ============================================================
       Targets
       ============================================================ */

    chooseTargets(o, a, opts) {
      const g = this.game;
      const effects = a.isPermanent ? [] : g._cardSpellEffects(a);
      /* An Aura picks its host on the way down. Whether that host should be
         one of ours depends on what the Aura does: a bonus goes on our own
         creature, a leash goes on theirs. */
      if (a.isAura && a.auraSpec) {
        const text = (a.oracleText || '').toLowerCase();
        const hostile = /can't attack|can't block|doesn't untap|enchanted creature gets -|loses all abilities|enchanted permanent doesn't/.test(text);
        const spec = Object.assign({}, a.auraSpec);
        if (!spec.controller) spec.controller = hostile ? 'opponent' : 'you';
        return this.chooseTargetsForEffects(
          effects.concat([{ op: hostile ? 'exile' : 'pump', p: 1, targets: [spec] }]), o, opts);
      }
      // a spell's own target list, beside its effects
      const extra = [];
      for (const ab of (a.abilities || [])) if (ab.kind === 'spell') for (const spec of (ab.targets || [])) extra.push({ op: 'damage', targets: [spec] });
      return this.chooseTargetsForEffects(effects.concat(extra), o, opts);
    }

    chooseTargetsForEffects(effects, source, opts) {
      opts = opts || {};
      const targets = [];
      let needed = 0;
      for (const e of (effects || [])) {
        if (e.op === 'modal') continue;              // its targets are asked for once a mode is chosen
        for (const spec of (e.targets || [])) {
          let t = null;
          if (opts.forceObject && isHarmful(e) && (spec.type !== 'player')) t = { kind: 'object', id: opts.forceObject.id };
          else t = this.pickTarget(spec, e, source, { taken: targets });
          // "up to two" is a licence to point at fewer, or at none
          if (!spec.upTo) needed++;
          if (t && !targets.some(x => x.kind === t.kind && x.id === t.id)) targets.push(t);
        }
      }
      if (needed && targets.length < needed) return null;
      return targets;
    }

    /**
     * The best thing for this effect to point at. Harmful effects go at
     * the opponents' most dangerous thing they can actually deal with;
     * helpful ones at our own best creature; a burn spell at a player's
     * face when that is where the damage does most.
     */
    pickTarget(spec, effect, source, opts) {
      opts = opts || {};
      const g = this.game;
      const legal = opts.options || g._legalTargetsFor(spec, this.pid);
      const taken = opts.taken || [];
      const free = legal.filter(t => !taken.some(x => x.kind === t.kind && x.id === t.id));
      if (!free.length) return null;
      const harmful = isHarmful(effect);
      const objs = free.filter(t => t.kind === 'object').map(t => g.obj(t.id)).filter(Boolean);
      const players = free.filter(t => t.kind === 'player');
      const stackItems = free.filter(t => t.kind === 'stack');

      if (stackItems.length) {
        // a counterspell goes at their spell, never ours
        const theirs = stackItems.map(t => g.stack.find(s => s.id === t.id)).filter(s => s && s.controller !== this.pid);
        if (!theirs.length) return harmful ? null : stackItems[0];
        theirs.sort((x, y) => this.stackThreat(y) - this.stackThreat(x));
        return { kind: 'stack', id: theirs[0].id };
      }

      if (harmful) {
        const theirs = objs.filter(o => o.controller !== this.pid);
        const opp = this.mainOpponent();
        // burn: the face when it wins the game or the race, a creature otherwise
        if (effect.op === 'damage' && players.length) {
          const dmg = nval(effect.n, 2);
          const oppT = players.filter(p => p.id !== this.pid).map(p => g.player(p.id)).filter(Boolean)
            .sort((a, b) => a.life - b.life);
          if (oppT[0] && dmg >= oppT[0].life) return { kind: 'player', id: oppT[0].id };
          const killable = theirs.filter(o => this._wouldDie(o, effect));
          if (oppT[0] && (!killable.length || (this.sharp() && !this.underPressure() && this._racing(oppT[0]) &&
              Math.max(...killable.map(o => this.threatValue(o))) < 5 + this.lean('face') * 2))) {
            return { kind: 'player', id: oppT[0].id };
          }
        }
        if (theirs.length) {
          let pool = theirs;
          if (effect.op === 'damage' || effect.op === 'damageDivided') {
            const killable = theirs.filter(o => this._wouldDie(o, effect));
            if (killable.length) pool = killable;
          }
          pool = pool.slice().sort((x, y) => this._aimValue(y) - this._aimValue(x));
          // the believable mistake: the removal spell goes at the wrong creature
          if (this.slips() && pool.length > 1) return { kind: 'object', id: pool[pool.length - 1].id };
          if (this.d <= 3 && !this.sharp()) return { kind: 'object', id: pool[Math.floor(this.rand() * pool.length)].id };
          return { kind: 'object', id: pool[0].id };
        }
        const foes = players.filter(p => p.id !== this.pid).map(p => g.player(p.id)).filter(Boolean);
        if (foes.length) {
          foes.sort((a, b) => (opp && a.id === opp.id ? -1 : 0) - (opp && b.id === opp.id ? -1 : 0) || a.life - b.life);
          return { kind: 'player', id: foes[0].id };
        }
        // only our own things are legal: point it at the least painful, if it must go anywhere
        if (spec.controller === 'you' && objs.length) {
          const worst = objs.slice().sort((x, y) => this.permanentValue(x) - this.permanentValue(y))[0];
          return { kind: 'object', id: worst.id };
        }
        return null;
      }

      // helpful: our own best thing
      const mine = objs.filter(o => o.controller === this.pid);
      if (mine.length) {
        let pool = mine;
        if (effect.op === 'pump' || effect.op === 'grantKeyword') {
          const fighting = mine.filter(o => o.attacking || (o.blocking && o.blocking.length));
          if (fighting.length) pool = fighting;
        }
        pool = pool.slice().sort((x, y) => this.threatValue(y) - this.threatValue(x));
        return { kind: 'object', id: pool[0].id };
      }
      const me = players.find(p => p.id === this.pid);
      if (me) return me;
      // nothing of ours to help: a helpful effect on their stuff is a wasted card, unless it must go somewhere
      if (spec.controller === 'opponent' && objs.length) {
        const least = objs.slice().sort((x, y) => this.threatValue(x) - this.threatValue(y))[0];
        return { kind: 'object', id: least.id };
      }
      return null;
    }

    /** A target from the engine's list that does the least harm. */
    _leastBad(list, effect) {
      const g = this.game;
      const harmful = isHarmful(effect);
      const scored = list.map(t => {
        let v = 0;
        if (t.kind === 'player') v = (t.id === this.pid) === harmful ? -5 : 1;
        else if (t.kind === 'object') {
          const o = g.obj(t.id);
          if (o) v = ((o.controller === this.pid) === harmful ? -1 : 1) * this.threatValue(o);
        }
        return { t, v };
      }).sort((x, y) => y.v - x.v);
      const t = scored[0].t;
      return { kind: t.kind, id: t.id };
    }

    /** Would this much damage (or this effect) finish the creature off? */
    _wouldDie(o, effect) {
      const g = this.game;
      if (effect.op !== 'damage' && effect.op !== 'damageDivided') return true;
      if (g.hasKw(o, 'indestructible')) return false;
      const c = g.characteristics(o);
      if (c && c.isPlaneswalker && !c.isCreature) return nval(effect.n, 2) >= (o.counters.loyalty || 0);
      return nval(effect.n, 2) >= g.toughnessOf(o) - (o.damage || 0);
    }

    /** The opponent's permanent a removal spell with these effects should hit. */
    _bestRemovalTarget(effects, filter) {
      const g = this.game;
      for (const e of effects) {
        if (!isHarmful(e)) continue;
        for (const spec of (e.targets || [])) {
          const list = g._legalTargetsFor(spec, this.pid).filter(t => t.kind === 'object')
            .map(t => g.obj(t.id)).filter(o => o && o.controller !== this.pid && (!filter || filter(o)) && this._wouldDie(o, e));
          if (!list.length) continue;
          list.sort((x, y) => this._aimValue(y) - this._aimValue(x));
          return list[0];
        }
      }
      return null;
    }

    /**
     * How much an opponent's permanent deserves our removal. At a bigger
     * table the same creature matters more in the hands of the player who
     * is winning; a political bot weighs that harder still.
     */
    _aimValue(o) {
      const v = this.threatValue(o);
      const opps = this.opponents();
      if (opps.length < 2) return v;
      const g = this.game;
      if (!this._aimMemo || this._aimMemo.v !== g.stateVersion) {
        const scores = new Map(opps.map(p => [p.id, Math.max(0.1, this._leaderScore(p))]));
        this._aimMemo = { v: g.stateVersion, scores, top: Math.max(...scores.values()) };
      }
      const m = this._aimMemo;
      const s = m.scores.get(o.controller);
      if (s == null) return v;
      return v * (0.8 + (0.4 + this.lean('leader') * 0.4) * (s / m.top));
    }

    bestEnemyThreat() {
      const g = this.game;
      const list = g.battlefield.filter(o => {
        if (o.controller === this.pid) return false;
        const a = o.analysis();
        return a && (this._isCreature(o) || a.isPlaneswalker) && !g.hasKw(o, 'hexproof') && !g.hasKw(o, 'shroud');
      });
      if (!list.length) return null;
      list.sort((a, b) => this.threatValue(b) - this.threatValue(a));
      return list[0];
    }
    /** How much a permanent on the board matters, to whoever is looking at it. */
    threatValue(o) {
      const g = this.game;
      const a = o.analysis();
      if (!a) return 0;
      let v = 0;
      if (this._isCreature(o)) v += g.powerOf(o) * 1.4 + g.toughnessOf(o) * 0.5;
      if (a.isPlaneswalker) v += 5 + (o.counters.loyalty || 0) * 0.6;
      for (const k of ['flying', 'trample', 'deathtouch', 'lifelink', 'double strike', 'menace', 'hexproof', 'indestructible'])
        if (g.hasKw(o, k)) v += 1.2;
      // what it does besides hit: a creature with a good ability is worth more than its body
      v += Math.max(0, this.rating(o) - 3) * 0.8;
      v += (o.card.cmc || 0) * 0.25;
      if (o.isCommander) v += 3;
      if (o.isToken) v -= 0.5;
      return v;
    }
    /** What we would lose if this permanent left: for sacrifices and discards. */
    permanentValue(o) {
      const a = o.analysis();
      if (!a) return 0;
      if (a.isLand) return this.landsInPlay() <= 4 ? 4 : 1.5;
      if (o.isToken && !this._isCreature(o)) return 0.6;
      return this.threatValue(o) * 0.6 + this.rating(o) * 0.4;
    }

    /** What a sweeper does for us: their losses minus ours. */
    _wipeWorth(e) {
      const g = this.game;
      let mine = 0, theirs = 0;
      for (const o of g.battlefield) {
        if (!this._isCreature(o)) continue;
        if (e.op === 'damage' && g.toughnessOf(o) > nval(e.n, 2)) continue;
        if (g.hasKw(o, 'indestructible') && e.op === 'destroyAll') continue;
        if (o.controller === this.pid) mine += this.threatValue(o); else theirs += this.threatValue(o);
      }
      const players = Math.max(1, this.opponents().length);
      return (theirs / players - mine) * 0.35;
    }

    /* ============================================================
       Combat
       Two creatures meeting in combat is the one piece of arithmetic
       this game asks over and over, so it is worked out in one place:
       who dies, what gets through, and what the exchange was worth. The
       difference between a good player and a bad one is mostly whether
       they did this sum before attacking.
       ============================================================ */

    /** What happens when `b` blocks `a`. */
    _trade(a, b) {
      const g = this.game;
      const ap = g.powerOf(a), at = g.toughnessOf(a) - (a.damage || 0);
      const bp = g.powerOf(b), bt = g.toughnessOf(b) - (b.damage || 0);
      const aFirst = g.hasKw(a, 'first strike') || g.hasKw(a, 'double strike');
      const bFirst = g.hasKw(b, 'first strike') || g.hasKw(b, 'double strike');
      const aKills = (ap >= bt || (g.hasKw(a, 'deathtouch') && ap > 0)) && !g.hasKw(b, 'indestructible');
      const bKills = (bp >= at || (g.hasKw(b, 'deathtouch') && bp > 0)) && !g.hasKw(a, 'indestructible');
      // striking first only matters when it settles the fight before the answer
      const attackerDies = bKills && !(aFirst && !bFirst && aKills);
      const blockerDies = aKills && !(bFirst && !aFirst && bKills);
      const through = g.hasKw(a, 'trample') ? Math.max(0, ap - Math.max(0, bt)) : 0;
      return { attackerDies, blockerDies, through };
    }

    /** What the table would lose if this creature died. */
    _worth(o) { return this.threatValue(o); }

    /**
     * How the defender would block, if they were paying attention: each of
     * their creatures takes the block that suits them best, one apiece.
     * Good enough to attack against, and far better than assuming either
     * that nothing blocks or that everything does.
     */
    _likelyBlocks(attackers, blockers, defenderId) {
      const g = this.game;
      const taken = new Map();                 // attackerId -> blocker
      const used = new Set();
      const options = [];
      for (const b of blockers) {
        for (const a of attackers) {
          const can = g.couldBlock(b, a, defenderId);
          if (!can || can.menace) continue;      // a lone blocker cannot take a menace creature
          const t = this._trade(a, b);
          // what the block is worth to them: damage stopped, a kill, a loss
          const value = (g.powerOf(a) - t.through) * 0.5 +
            (t.attackerDies ? this._worth(a) : 0) - (t.blockerDies ? this._worth(b) : 0);
          options.push({ a, b, value });
        }
      }
      options.sort((x, y) => y.value - x.value);
      const defender = g.player(defenderId);
      const incoming = U.sum(attackers.map(a => g.powerOf(a)));
      const desperate = defender && incoming >= defender.life;
      for (const opt of options) {
        if (used.has(opt.b.id) || taken.has(opt.a.id)) continue;
        if (opt.value <= 0 && !desperate) continue;          // they would rather take it
        used.add(opt.b.id); taken.set(opt.a.id, opt.b);
      }
      return taken;
    }

    /** What attacking with this set is worth, all things considered. */
    _attackValue(set, blockers, target) {
      const g = this.game;
      let damage = 0, value = 0;
      const teams = this.cfg.modelBlocks ? this._predictBlocks(set, target) : null;
      if (teams) {
        for (const a of set) {
          const team = teams.get(a.id) || [];
          if (!team.length) { damage += g.powerOf(a) * (g.hasKw(a, 'double strike') ? 2 : 1); continue; }
          const r = this._gang(a, team);
          damage += r.through;
          value += r.killed;
          if (r.attackerDies) value -= this._worth(a);
        }
      } else {
        const blocks = this._likelyBlocks(set, blockers, target.id);
        for (const a of set) {
          const b = blocks.get(a.id);
          if (!b) { damage += g.powerOf(a) * (g.hasKw(a, 'double strike') ? 2 : 1); continue; }
          const t = this._trade(a, b);
          damage += t.through;
          if (t.blockerDies) value += this._worth(b);
          if (t.attackerDies) value -= this._worth(a);
        }
      }
      if (damage >= target.life) return 1000;            // that is the game
      /* Damage is not a consolation prize. Whoever is winning the race
         should be pushing it, and an even trade in the middle of a race is
         a good deal for the one who is ahead — the creatures come back,
         the life total does not. A board that never attacks because every
         exchange is level is a board that draws games it should have won. */
      const theirPower = U.sum(g.battlefield
        .filter(o => o.controller === target.id && this._isCreature(o))
        .map(o => g.powerOf(o)));
      const mine = U.sum(set.map(o => g.powerOf(o)));
      const myClock = mine > 0 ? Math.ceil(target.life / mine) : 99;
      const theirClock = theirPower > 0 ? Math.ceil(this.me.life / theirPower) : 99;
      const racing = myClock <= theirClock;
      value += damage * (racing ? 1.5 : 0.85) * (target.life <= 10 ? 1.2 : 1);
      /* Creatures that attacked are not home to block, and a swing that
         wins nothing and loses the game next turn is not a swing. */
      const staying = g.battlefield.filter(o => o.controller === this.pid &&
        this._isCreature(o) && !o.tapped &&
        !set.some(a => a.id === o.id && !g.hasKw(a, 'vigilance')));
      const wall = U.sum(staying.map(o => g.toughnessOf(o)));
      const allTheirPower = U.sum(g.battlefield
        .filter(o => o.controller !== this.pid && this._isCreature(o))
        .map(o => g.powerOf(o)));
      const exposed = (this.opponents().length > 1 ? allTheirPower * 0.6 : theirPower) - wall * 0.5 - this.me.life;
      if (exposed >= 0) value -= (3 + Math.min(8, exposed)) * (1 - this.lean('attack') * 0.25);
      return value;
    }

    /**
     * How the defender would really block this attack: their seat is
     * played, for a moment, by a capable bot of our own, which is asked
     * what it would do. Against another bot that is very nearly the truth,
     * and against a person it is a better guess than one blocker apiece.
     * The model has dice of its own, so thinking about it changes nothing
     * at the table.
     */
    _predictBlocks(set, target) {
      const g = this.game;
      if (!set.length || !g.player(target.id)) return new Map();
      if (!this._model || this._model.pid !== target.id) {
        this._model = new BotPlayer(g, target.id, 8);
        const rng = new MTG.RNG(7);
        this._model.rand = () => rng.next();
      }
      const was = set.map(o => [o, o.attacking]);
      const out = new Map();
      try {
        for (const o of set) o.attacking = target.id;
        const candidates = g.battlefield.filter(b => b.controller === target.id && set.some(a => g.canBlock(b, a)));
        if (!candidates.length) return out;
        const plan = this._model.chooseBlocks({ attackers: set.map(o => o.id), candidates: candidates.map(o => o.id) });
        for (const d of plan) for (const aid of d.attackerIds) {
          if (!out.has(aid)) out.set(aid, []);
          const b = g.obj(d.blockerId);
          if (b) out.get(aid).push(b);
        }
      } catch (e) { return null; }
      finally { for (const [o, w] of was) o.attacking = w; }
      return out;
    }

    /** One attacker against the creatures blocking it: what dies, and what tramples over. */
    _gang(a, team) {
      const g = this.game;
      const aFirst = g.hasKw(a, 'first strike') || g.hasKw(a, 'double strike');
      let left = g.powerOf(a) * (g.hasKw(a, 'double strike') ? 2 : 1);
      const dt = g.hasKw(a, 'deathtouch');
      let killed = 0;
      const dead = new Set();
      for (const b of team.slice().sort((x, y) => this._worth(y) - this._worth(x))) {
        const need = dt ? 1 : Math.max(0, g.toughnessOf(b) - (b.damage || 0));
        if (left >= need && left > 0 && !g.hasKw(b, 'indestructible')) { killed += this._worth(b); left -= need; dead.add(b.id); }
      }
      // a first striker that kills its blockers takes nothing back from them
      const hitters = team.filter(b => !(aFirst && dead.has(b.id) && !(g.hasKw(b, 'first strike') || g.hasKw(b, 'double strike'))));
      const back = U.sum(hitters.map(b => g.powerOf(b)));
      const anyDT = hitters.some(b => g.hasKw(b, 'deathtouch') && g.powerOf(b) > 0);
      const attackerDies = (back >= g.toughnessOf(a) - (a.damage || 0) || anyDT) && !g.hasKw(a, 'indestructible');
      const through = g.hasKw(a, 'trample') ? Math.max(0, left) : 0;
      return { killed, attackerDies, through };
    }

    /** The best set of attackers against one defender, by trying to leave each out. */
    _searchAttack(attackers, blockers, target, passes) {
      let set = attackers.filter(o => this.game.powerOf(o) > 0);
      let best = this._attackValue(set, blockers, target);
      for (let pass = 0; pass < (passes || 4) && set.length; pass++) {
        let drop = null, dropVal = best;
        for (const o of set) {
          const without = set.filter(x => x.id !== o.id);
          const v = this._attackValue(without, blockers, target);
          if (v > dropVal + 0.01) { dropVal = v; drop = o; }
        }
        if (!drop) break;
        set = set.filter(x => x.id !== drop.id);
        best = dropVal;
      }
      return { set, value: best };
    }

    chooseAttacks(ch) {
      const g = this.game;
      const opps = this.opponents();
      if (!opps.length) return [];
      const myAttackers = ch.candidates.map(id => g.obj(id)).filter(Boolean);
      const blockersOf = (pid) => g.battlefield.filter(o => o.controller === pid && !o.tapped && this._isCreature(o));
      const legalDef = new Set(ch.defenders.map(d => d.id));

      /* Who to attack. One opponent is easy. At a bigger table a sharp bot
         goes where the damage does most — the player it can finish, or the
         one running away with the game — and a weaker one goes where the
         damage gets through, the player with the fewest blockers up.
         Nobody is picked on for having the least life: a table where
         every bot swings at the weakest player is a table ganging up on
         them. A political bot leans harder on the leader, and spreads its
         attacks rather than hitting the same player turn after turn. */
      let target = null, plan = null;
      /* In a look ahead's copy of a crowded board the whole-attack search
         is cut short: a copy is one of dozens, and a rough read is plenty. */
      const rough = this.game.isScratch && myAttackers.length > 8;
      if (opps.length === 1) target = opps[0];
      else if (rough) target = legalDef.has((this.mainOpponent() || {}).id) ? this.mainOpponent() : opps[0];
      else if (!this.sharp()) {
        target = opps.filter(p => legalDef.has(p.id))
          .sort((a, b) => blockersOf(a.id).length - blockersOf(b.id).length || this._leaderScore(b) - this._leaderScore(a))[0] || opps[0];
      } else {
        let bestV = -Infinity;
        const lead = 0.3 + this.lean('leader') * 0.5;
        for (const p of opps) {
          if (!legalDef.has(p.id)) continue;
          const r = this._searchAttack(myAttackers, blockersOf(p.id), p);
          // the player running away with the game is the one to slow down
          let v = r.value + this._leaderScore(p) * lead;
          if (this._lastAttacked === p.id) v -= this.lean('spread') * 1.5;
          if (v > bestV) { bestV = v; target = p; plan = r; }
        }
        if (!target) target = opps[0];
      }
      // a planeswalker we can kill is worth a swing at the levels that notice
      const walker = ch.defenders.map(d => d.kind === 'object' ? g.obj(d.id) : null)
        .filter(o => o && o.controller === target.id && (o.analysis() || {}).isPlaneswalker)
        .sort((a, b) => (b.counters.loyalty || 0) - (a.counters.loyalty || 0))[0];
      const defenderId = legalDef.has(target.id) ? target.id : ch.defenders[0].id;
      const theirBlockers = blockersOf(target.id);

      /* Some creatures have no say in it — goaded, or printed with
         "attacks each combat if able". Leaving them out is not a plan the
         engine will accept, so they go in whatever else is decided. */
      const compelled = myAttackers.filter(o => g.mustAttack(o) && g.canAttack(o));
      const finish = (list, toWalker) => {
        const out = list.map(o => ({ attackerId: o.id, defenderId: o.mustAttackPlayer && legalDef.has(o.mustAttackPlayer) ? o.mustAttackPlayer : defenderId }));
        if (toWalker && walker && out.length) {
          // just enough of the attack goes at the walker to kill it
          let need = walker.counters.loyalty || 0;
          for (const d of out.slice().sort((x, y) => g.powerOf(g.obj(x.attackerId)) - g.powerOf(g.obj(y.attackerId)))) {
            if (need <= 0) break;
            const o = g.obj(d.attackerId);
            if (!theirBlockers.length || g.hasKw(o, 'flying')) { d.defenderId = walker.id; need -= g.powerOf(o); }
          }
        }
        for (const o of compelled) if (!out.some(d => d.attackerId === o.id)) out.push({ attackerId: o.id, defenderId });
        if (out.length) this._lastAttacked = defenderId;
        return out;
      };
      /* A chaotic bot now and then throws in a creature it had no need to:
         it is part of the charm, and part of why it is hard to read. */
      const wild = (list) => {
        if (!(this.lean('chaos') > 0) || this.rand() >= this.lean('chaos')) return list;
        const extra = myAttackers.filter(o => g.powerOf(o) > 0 && !list.includes(o));
        return extra.length ? list.concat([extra[Math.floor(this.rand() * extra.length)]]) : list;
      };

      const totalPower = U.sum(myAttackers.map(o => g.powerOf(o)));
      const lethalNow = totalPower >= target.life && theirBlockers.length === 0;
      if (lethalNow) return finish(myAttackers.filter(o => g.powerOf(o) > 0), false);

      /* A sharp bot works out what the swing is actually worth: it assumes
         a competent block, adds up what gets through and what the exchange
         costs, and then tries leaving each attacker at home to see whether
         that is better. A few passes of that beats any amount of
         per-creature rules of thumb. */
      if (this.cfg.attackSearch) {
        const r = plan && plan.set ? plan : this._searchAttack(myAttackers, theirBlockers, target, rough ? 1 : 4);
        let set = r.set;
        const myClock = totalPower > 0 ? Math.ceil(target.life / totalPower) : 99;
        const theirPower = U.sum(g.battlefield.filter(o => o.controller === target.id && this._isCreature(o)).map(o => g.powerOf(o)));
        const theirClock = theirPower > 0 ? Math.ceil(this.me.life / theirPower) : 99;
        /* A shade below zero is still worth doing when we are the ones
           ahead: trades that look level on the board are not level on the
           clock. Behind, they are exactly as bad as they look. */
        const floor = ((myClock <= theirClock || theirClock <= 2) ? -1.2 : 0) - this.lean('attack') * 0.8;
        if (r.value <= floor) set = [];
        // below the very top, the read is not perfect
        if (!this.sharp()) {
          const stayed = myAttackers.filter(o => g.powerOf(o) > 0 && !set.some(x => x.id === o.id));
          if (stayed.length && this.rand() < 0.5) set = set.concat(stayed[Math.floor(this.rand() * stayed.length)]);
          else if (set.length && this.rand() < 0.3) set = set.slice(0, -1);
        }
        return finish(wild(set), !!this.cfg.walkers);
      }

      /* The lower levels attack by feel: anything that will not obviously
         die goes in, and now and then something that will. */
      const out = [];
      const myClock = totalPower > 0 ? Math.ceil(target.life / totalPower) : 99;
      const theirPower = U.sum(g.battlefield.filter(o => o.controller === target.id && this._isCreature(o)).map(o => g.powerOf(o)));
      const theirClock = theirPower > 0 ? Math.ceil(this.me.life / theirPower) : 99;
      const desperate = theirClock <= 2;
      let unblocked = Math.max(0, myAttackers.length - theirBlockers.length);
      const ordered = myAttackers.slice().sort((a, b) => g.powerOf(b) - g.powerOf(a));
      for (const o of ordered) {
        const power = g.powerOf(o);
        if (power <= 0) continue;
        if (this.cfg.reckless) { if (this.rand() < 0.85) out.push(o); continue; }
        if (desperate) { out.push(o); continue; }
        const relevant = theirBlockers.filter(b => g.couldBlock(b, o, target.id));
        // the worst that a single blocker could do to this attacker
        const worst = relevant.reduce((acc, b) => {
          const t = this._trade(o, b);
          return Math.min(acc, (t.attackerDies ? -2 : 0) + (t.blockerDies ? 1.5 : 0));
        }, 2);
        let want = worst >= -this.lean('attack') * 0.7 || g.hasKw(o, 'vigilance') || !relevant.length;
        if (!want && unblocked > 0) { want = true; unblocked--; }
        if (!want && myClock <= theirClock && this.sharp()) want = true;
        if (!want && target.life <= power * 2) want = true;
        // the believable mistake: a creature sent into a block that eats it, or one held back for no reason
        if (this.slips()) want = !want;
        if (want) out.push(o);
      }
      return finish(wild(out), false);
    }

    chooseBlocks(ch) {
      const plan = this._heuristicBlocks(ch);
      if (!this.cfg.blockSearch || !this.sharp()) return plan;
      return this._refineBlocks(ch, plan);
    }

    /**
     * Blocks as a whole. The first pass decides attacker by attacker; this
     * one weighs the full picture — every creature lost or killed, and the
     * damage that gets through priced by how much life there is to spare —
     * and keeps changing one assignment at a time while that improves it.
     */
    _refineBlocks(ch, start) {
      const g = this.game;
      const attackers = ch.attackers.map(id => g.obj(id)).filter(Boolean);
      const blockers = ch.candidates.map(id => g.obj(id)).filter(Boolean);
      if (!attackers.length || !blockers.length) return start;
      // assignment: blockerId -> attackerId (or none)
      const assign = new Map();
      for (const d of start) assign.set(d.blockerId, d.attackerIds[0]);
      const life = this.me.life;
      const theirPower = U.sum(g.battlefield.filter(o => o.controller !== this.pid && this._isCreature(o)).map(o => g.powerOf(o)));
      const score = () => {
        let v = 0, dmg = 0;
        for (const at of attackers) {
          const team = blockers.filter(b => assign.get(b.id) === at.id);
          const mult = g.hasKw(at, 'double strike') ? 2 : 1;
          const toMe = at.attacking === this.pid;
          if (!team.length) { if (toMe) dmg += g.powerOf(at) * mult; continue; }
          if (g.hasKw(at, 'menace') && team.length < 2) return -1e6;          // not a legal block
          // the attacker deals its damage down the line; the blockers pool theirs
          let left = g.powerOf(at) * mult;
          const dt = g.hasKw(at, 'deathtouch');
          for (const b of team.slice().sort((x, y) => this._worth(y) - this._worth(x))) {
            const need = dt ? 1 : Math.max(0, g.toughnessOf(b) - (b.damage || 0));
            if (left >= need && left > 0 && !g.hasKw(b, 'indestructible')) {
              // a first striker that kills the attacker first takes no damage back
              const first = (g.hasKw(b, 'first strike') || g.hasKw(b, 'double strike')) && !(g.hasKw(at, 'first strike') || g.hasKw(at, 'double strike'));
              const bp = U.sum(team.map(x => g.powerOf(x)));
              const atDiesFirst = first && (bp >= g.toughnessOf(at) - (at.damage || 0));
              if (!atDiesFirst) { v -= this._worth(b); left -= need; }
            }
          }
          if (g.hasKw(at, 'trample') && toMe) dmg += Math.max(0, left);
          const power = U.sum(team.map(x => g.powerOf(x)));
          const anyDT = team.some(x => g.hasKw(x, 'deathtouch') && g.powerOf(x) > 0);
          if ((power >= g.toughnessOf(at) - (at.damage || 0) || anyDT) && !g.hasKw(at, 'indestructible')) v += this._worth(at);
        }
        if (dmg >= life) return -1e5 + v;
        // life is worth more the less of it there is, and the faster they can take the rest
        const pressure = 0.25 + 4 / Math.max(2, life - theirPower * 0.5);
        return v - dmg * pressure;
      };
      let best = score();
      const options = (b) => [null].concat(attackers.filter(at => g.canBlock(b, at)).map(at => at.id));
      for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (const b of blockers) {
          const cur = assign.has(b.id) ? assign.get(b.id) : null;
          for (const opt of options(b)) {
            if (opt === cur) continue;
            if (opt == null) assign.delete(b.id); else assign.set(b.id, opt);
            const v = score();
            if (v > best + 0.01) { best = v; improved = true; }
            else if (cur == null) assign.delete(b.id); else assign.set(b.id, cur);
          }
        }
        if (!improved) break;
      }
      const out = [];
      for (const [bid, aid] of assign) out.push({ blockerId: bid, attackerIds: [aid] });
      return out;
    }

    _heuristicBlocks(ch) {
      const g = this.game;
      const out = [];
      const attackers = ch.attackers.map(id => g.obj(id)).filter(Boolean);
      const blockers = ch.candidates.map(id => g.obj(id)).filter(Boolean);
      if (!attackers.length || !blockers.length) return out;

      // only damage coming at us (not at a planeswalker of ours) is about our life
      const atMe = attackers.filter(a => a.attacking === this.pid);
      const incoming = U.sum(atMe.map(o => g.powerOf(o) * (g.hasKw(o, 'double strike') ? 2 : 1)));
      const mustChump = incoming >= this.me.life;
      const used = new Set();
      const canBlock = (b, at) => { const r = g.canBlock(b, at); return r ? r : null; };

      /* Facing lethal, blocking is not about trades at all: it is about
         how much damage can be taken off the table with the bodies
         available. A sharp bot works that out first — biggest attacker
         first, cheapest body that stops it — and only then thinks about
         what the exchanges are worth. */
      if (mustChump && (this.cfg.chump || this.sharp())) {
        const plan = [];
        let left = incoming;
        const order = atMe.slice().sort((a, b) => g.powerOf(b) - g.powerOf(a));
        for (const at of order) {
          if (left < this.me.life) break;                 // out of danger
          const menace = g.hasKw(at, 'menace');
          const opts = blockers.filter(b => !used.has(b.id) && canBlock(b, at));
          if (!opts.length || (menace && opts.length < 2)) continue;
          // the cheapest thing that survives, else the cheapest thing at all
          opts.sort((x, y) => {
            const sx = this._trade(at, x).blockerDies ? 1 : 0;
            const sy = this._trade(at, y).blockerDies ? 1 : 0;
            if (sx !== sy) return sx - sy;
            return this._worth(x) - this._worth(y);
          });
          const team = opts.slice(0, menace ? 2 : 1);
          for (const b of team) { used.add(b.id); plan.push({ blockerId: b.id, attackerIds: [at.id] }); }
          left -= g.powerOf(at) - this._trade(at, team[0]).through;
        }
        if (plan.length) return plan;
      }

      // biggest threat first
      attackers.sort((a, b) => this.threatValue(b) - this.threatValue(a));
      for (const at of attackers) {
        const ap = g.powerOf(at), atT = g.toughnessOf(at) - (at.damage || 0);
        const menace = g.hasKw(at, 'menace');
        const options = blockers.filter(b => !used.has(b.id) && canBlock(b, at));
        if (!options.length) continue;
        if (this.d <= 1) {
          if (!menace && this.rand() < 0.35) { const b = options[0]; used.add(b.id); out.push({ blockerId: b.id, attackerIds: [at.id] }); }
          continue;
        }
        // value each possible block, first strike and trample included
        let best = null, bestScore = 0;
        for (const b of options) {
          const t = this._trade(at, b);          // `at` attacks, `b` blocks
          let score = 0;
          if (t.attackerDies) score += this.threatValue(at) * 0.9;   // we eat it
          if (t.blockerDies) score -= this.threatValue(b) * 0.9;     // we lose ours
          score += (ap - t.through) * 0.4 * (at.attacking === this.pid ? 1 : 0.6);   // damage actually stopped
          if (mustChump) score += (ap - t.through) * 1.5;
          if (score > bestScore) { bestScore = score; best = b; }
        }
        /* Blocking well is a skill like any other. Below the top of the
           ladder the read is off: a middling bot sometimes throws a
           creature under an attacker it cannot kill, and sometimes stands
           there and takes one it should have eaten. */
        if (!mustChump && this.slips()) {
          if (best) best = null;
          else { best = options[Math.floor(this.rand() * options.length)]; bestScore = 1; }
        } else if (!mustChump && !this.sharp() && this.rand() < 0.25) {
          if (best && this.rand() < 0.5) best = null;
        }
        if (!best || !(bestScore > 0.3 - this.lean('block') * 0.5 || mustChump)) continue;
        const team = [best.id];
        /* Two blockers can eat something neither of them could handle
           alone — worth it while the creatures it loses are worth less
           than the one it kills. Menace makes a second blocker the price
           of blocking at all. */
        const needMore = menace || (this.cfg.doubleBlock && !mustChump && g.powerOf(best) < atT &&
          !g.hasKw(at, 'deathtouch') && !g.hasKw(at, 'trample'));
        if (needMore) {
          let power = g.powerOf(best);
          let spent = (ap >= g.toughnessOf(best)) ? this.threatValue(best) : 0;
          for (const b of options) {
            if (team.length >= 2 && (power >= atT || menace)) break;
            if (used.has(b.id) || b.id === best.id) continue;
            const cost = (ap >= g.toughnessOf(b)) ? this.threatValue(b) : 0;
            if (!menace && spent + cost >= this.threatValue(at) * 0.9) continue;
            team.push(b.id);
            power += g.powerOf(b); spent += cost;
            if (!menace && power >= atT) break;
          }
          if (menace && team.length < 2) continue;                  // cannot block it at all
          if (!menace && power < atT) team.length = 1;              // still cannot kill it: one is enough
        }
        for (const id of team) used.add(id);
        out.push(...team.map(id => ({ blockerId: id, attackerIds: [at.id] })));
      }
      return out;
    }

    /** The blocks the rules insist on: creatures that must block, blocking. */
    _mustBlockPlan(ch) {
      const g = this.game;
      const out = [];
      for (const id of ch.candidates) {
        const b = g.obj(id);
        if (!b || !(g._hasFlag(b, 'mustBlock') || g._staticOp(b, 'mustBlock'))) continue;
        const at = ch.attackers.map(x => g.obj(x)).find(x => x && g.canBlock(b, x));
        if (at) out.push({ blockerId: b.id, attackerIds: [at.id] });
      }
      // drawn to one attacker in particular: a lure, or "blocks this creature if able"
      for (const id of ch.candidates) {
        const b = g.obj(id);
        if (!b || out.some(d => d.blockerId === id) || !g._blockDemands) continue;
        const drawn = g._blockDemands(b);
        if (drawn.length) out.push({ blockerId: b.id, attackerIds: [drawn[0].id] });
      }
      // "must be blocked if able": the least of our creatures that can
      for (const aid of ch.attackers) {
        const at = g.obj(aid);
        if (!at || !g._staticOp(at, 'mustBeBlocked') || out.some(d => d.attackerIds.includes(aid))) continue;
        const free = ch.candidates.map(id => g.obj(id)).filter(b => b && !out.some(d => d.blockerId === b.id) && g.canBlock(b, at))
          .sort((x, y) => this.permanentValue(x) - this.permanentValue(y));
        if (free.length) out.push({ blockerId: free[0].id, attackerIds: [aid] });
      }
      return out;
    }

    /* ============================================================
       Looking ahead (Part 4)
       ============================================================ */

    /** The look ahead settings for this kind of decision, or null when this bot does not look. */
    _lookCfg(kind) {
      const L = this.cfg.look;
      if (!L || !L[kind] || this.game.isScratch || !MTG.sim) return null;
      return L;
    }

    /** How many candidate moves to weigh: fewer on a phone, where every copy costs more. */
    _candCap(L) {
      let c = MTG.isPhone && MTG.isPhone() ? Math.min(L.cands, L.phoneCands || 3) : L.cands;
      // and a bigger table weighs fewer
      if (this.game.players.filter(p => !p.hasLost).length > 2) c = Math.min(c, MTG.isPhone && MTG.isPhone() ? 2 : 4);
      return c;
    }

    /* Cards we have watched go by in the open. One of them back in a hand
       is no secret, so it stays where it is when the hidden cards are
       dealt again. */
    _noteSeen() {
      const g = this.game;
      if (!this._seen) this._seen = new Set();
      const seen = this._seen;
      for (const o of g.battlefield) if (!o.faceDown) seen.add(o.id);
      for (const it of g.stack) if (it.obj && !it.obj.faceDown) seen.add(it.obj.id);
      for (const pid in g.zones) {
        const z = g.zones[pid];
        for (const o of z.graveyard) seen.add(o.id);
        for (const o of z.exile) if (!o.faceDown) seen.add(o.id);
      }
    }

    /** How this bot judges a position: the plain weights, leaned on by its personality. */
    evalWeights() {
      if (this._weights) return this._weights;
      const p = this.personality && PERSONALITIES[this.personality];
      const L = this.cfg.look;
      this._weights = (p && p.eval) || (L && L.eval) ? Object.assign({}, EVAL, L && L.eval, p && p.eval) : EVAL;
      return this._weights;
    }

    /**
     * Play each candidate out in a few imagined futures and return the
     * index of the best on average, or null if the table moved while it
     * was thinking. Candidate 0 is the judgement's own choice, and another
     * has to beat it by a margin: a look this short is noisy, and a
     * coin-flip difference is no reason to overrule a sound read.
     * Each candidate is `{ apply(copy, ourBotInCopy) }` and returns false
     * if the move cannot be made there.
     */
    async _lookAhead(cands, L) {
      const g = this.game;
      const phone = !!(MTG.isPhone && MTG.isPhone());
      /* A copy of a four-player game costs three or four times what a
         duel does, so a bigger table plays fewer of them. */
      const seats = this.game.players.filter(p => !p.hasLost).length;
      const worlds = Math.max(1, Math.ceil((phone ? L.phone : L.worlds) / Math.max(1, seats - 1)));
      // the tools stretch the safety net when they run many games side by side on one machine
      const cap = (phone ? L.capPhone : L.capMs) * (MTG.bots.lookCapScale || 1);
      const margin = L.margin != null ? L.margin : LOOK_MARGIN;
      const version = g.stateVersion;
      this._noteSeen();
      // one roll of the bot's dice seeds every copy, so the whole think is repeatable
      const base = Math.floor(this.rand() * 4294967296) >>> 0;
      const sum = cands.map(() => 0), n = cands.map(() => 0), dead = cands.map(() => false);
      const t0 = now();
      let mark = t0, played = 0;
      /* Every candidate is judged on the same futures. If the safety net
         stops a round part way, that round is thrown away — unless it is
         the first, when whatever it reached is all there is. */
      worlds: for (let w = 0; w < worlds; w++) {
        const seed = (base + Math.imul(w + 1, 0x9E3779B1)) >>> 0;
        const round = cands.map(() => null);
        for (let i = 0; i < cands.length; i++) {
          if (dead[i]) continue;
          if (now() - t0 > cap) {
            if (w === 0) round.forEach((v, k) => { if (v != null) { sum[k] += v; n[k]++; } });
            break worlds;
          }
          let v = null;
          try { v = this._playOut(cands[i], seed, L); } catch (e) { console.warn('[bot] look ahead', e); v = null; }
          played++;
          if (v == null) { dead[i] = true; continue; }
          round[i] = v;
          if (now() - mark > SLICE_MS) {
            await breathe();
            mark = now();
            if (g.stateVersion !== version || g.over) return null;
          }
        }
        round.forEach((v, k) => { if (v != null) { sum[k] += v; n[k]++; } });
        // the safety net: only a device far slower than expected gets here
        const spent = now() - t0;
        if (spent + spent / (w + 1) > cap) break;
      }
      this._thought = now() - t0;
      /* A personality tips close calls its own way — an aggressive bot
         towards the bigger attack, a cautious one towards the extra
         blocker — never far enough to turn a clear call round. */
      const mean = sum.map((s, i) => (n[i] ? s / n[i] + (cands[i].lean || 0) : -Infinity));
      let best = 0;
      for (let i = 1; i < cands.length; i++) if (n[i] && n[i] >= n[0] && mean[i] > mean[best]) best = i;
      if (best !== 0 && n[0] && mean[best] < mean[0] + margin) best = 0;
      if (!n[0] && !n[best]) best = 0;
      /* Below the top, the look ahead is not followed to the letter: the
         move is drawn from the candidates, the better ones likelier, and
         the lower the level the flatter the odds. Its mistakes are then
         the mistakes a person makes — a reasonable move, not the best one
         — rather than nonsense. */
      if (L.temp > 0) {
        const ok = mean.map((v, i) => Number.isFinite(v) && n[i] >= n[0]);
        const top = Math.max(...mean.filter((v, i) => ok[i]));
        const w = mean.map((v, i) => (ok[i] ? Math.exp((v - top) / L.temp) : 0));
        let r = this.rand() * U.sum(w);
        for (let i = 0; i < w.length; i++) { r -= w[i]; if (w[i] > 0 && r <= 0) { best = i; break; } }
      }
      this.lastLook = { cands: cands.length, worlds, played, ms: Math.round(this._thought), pick: best,
        means: mean.map(v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)) };
      return best;
    }

    /** One candidate in one imagined future: make the move, play on, judge where it leaves us. */
    _playOut(cand, seed, L) {
      const g = this.game;
      const f = MTG.sim.fork(g, seed);
      MTG.sim.determinise(f, this.pid, new MTG.RNG(((seed ^ 0x5BD1E995) >>> 0) || 7), this._seen);
      const bots = {};
      for (const p of f.players) if (!p.hasLost) bots[p.id] = new BotPlayer(f, p.id, ROLLOUT_LEVEL, ROLLOUT_TUNING);
      if (!bots[this.pid] || !cand.apply(f, bots[this.pid])) return null;
      const stopAt = g.turn + ((L && L.horizon) || HORIZON);
      const t0 = now();
      // a copy of a big table gets less time each: there are more of them to a decision than it seems
      const limit = f.players.filter(p => !p.hasLost).length > 2 ? ROLLOUT_MS * 0.5 : ROLLOUT_MS;
      const steps = MTG.sim.drive(f, bots, (x) => x.turn >= stopAt, ROLLOUT_STEPS, t0 + limit * (MTG.bots.lookCapScale || 1));
      const ms = now() - t0;
      if (!this._slowest || ms > this._slowest.ms) this._slowest = { ms: Math.round(ms), steps, turn: f.turn, step: f.step };
      return tableScore(f, this.pid, this.evalWeights());
    }

    /** A look ahead at a question (attacks, blocks); null means "decide as usual". */
    async thinkChoice(ch) {
      if (ch.type === 'declareAttackers') {
        const L = this._lookCfg('attack');
        if (L) return this._thinkAttack(ch, L);
      } else if (ch.type === 'declareBlockers') {
        const L = this._lookCfg('block');
        if (L) return this._thinkBlock(ch, L);
      }
      return null;
    }

    async _thinkAttack(ch, L) {
      let first;
      try { first = this.chooseAttacks(ch); } catch (e) { return null; }
      const plans = this._attackCandidates(ch, first, this._candCap(L));
      if (plans.length < 2) return first;
      const lean = this.lean('attack') * 0.25;
      const pick = await this._lookAhead(plans.map(plan => ({ apply: (f) => f.declareAttackers(this.pid, plan), lean: lean * (plan.length - first.length) })), L);
      return pick == null ? null : plans[pick];
    }

    /**
     * Attacks worth comparing with the judgement's own: holding back,
     * sending everything, the same swing with one creature more or less,
     * and at a bigger table the best swing at each other player.
     */
    _attackCandidates(ch, first, max) {
      const g = this.game;
      const legal = new Set(ch.defenders.map(d => d.id));
      const key = (plan) => plan.map(d => d.attackerId + '>' + d.defenderId).sort().join(',');
      const out = [first];
      const seen = new Set([key(first)]);
      const add = (plan) => {
        if (out.length >= max) return;
        const k = key(plan);
        if (seen.has(k)) return;
        seen.add(k); out.push(plan);
      };
      const mine = ch.candidates.map(id => g.obj(id)).filter(o => o && g.canAttack(o));
      const able = mine.filter(o => g.powerOf(o) > 0);
      const compelled = mine.filter(o => g.mustAttack(o));
      const opp = this.mainOpponent();
      const main = first.length ? first[0].defenderId : (opp && legal.has(opp.id) ? opp.id : ch.defenders[0].id);
      const make = (list, def) => {
        const plan = list.map(o => ({ attackerId: o.id, defenderId: o.mustAttackPlayer && legal.has(o.mustAttackPlayer) ? o.mustAttackPlayer : def }));
        for (const o of compelled) if (!plan.some(d => d.attackerId === o.id)) plan.push({ attackerId: o.id, defenderId: def });
        return plan;
      };
      const inFirst = new Set(first.map(d => d.attackerId));
      const sent = able.filter(o => inFirst.has(o.id)).sort((x, y) => this.threatValue(y) - this.threatValue(x));
      const home = able.filter(o => !inFirst.has(o.id)).sort((x, y) => g.powerOf(y) - g.powerOf(x));
      add(make([], main));
      // at a bigger table, the best swing at each of the others
      if (this.opponents().length > 1) {
        for (const p of this.opponents()) {
          if (p.id === main || !legal.has(p.id)) continue;
          const blockers = g.battlefield.filter(o => o.controller === p.id && !o.tapped && this._isCreature(o));
          const r = this._searchAttack(able, blockers, p);
          if (r.set.length) add(make(r.set, p.id));
        }
      }
      add(make(able, main));
      if (sent.length > 1) add(first.filter(d => d.attackerId !== sent[0].id));
      if (home.length) add(first.concat([{ attackerId: home[0].id, defenderId: main }]));
      if (sent.length > 2) add(first.filter(d => d.attackerId !== sent[sent.length - 1].id));
      return out;
    }

    async _thinkBlock(ch, L) {
      let first;
      try { first = this.chooseBlocks(ch); } catch (e) { return null; }
      const plans = this._blockCandidates(ch, first, this._candCap(L));
      if (plans.length < 2) return first;
      const lean = this.lean('block') * 0.25;
      const pick = await this._lookAhead(plans.map(plan => ({ apply: (f) => f.declareBlockers(this.pid, plan), lean: lean * (plan.length - first.length) })), L);
      return pick == null ? null : plans[pick];
    }

    /**
     * Blocks worth comparing with the judgement's own: no blocks, the
     * same blocks without the chumps, and one more body in front of the
     * biggest attacker left unblocked.
     */
    _blockCandidates(ch, first, max) {
      const g = this.game;
      const key = (plan) => plan.map(d => d.blockerId + '>' + d.attackerIds.join('+')).sort().join(',');
      const out = [first];
      const seen = new Set([key(first)]);
      const add = (plan) => {
        if (out.length >= max) return;
        const k = key(plan);
        if (seen.has(k)) return;
        seen.add(k); out.push(plan);
      };
      const must = this._mustBlockPlan(ch);
      add(must);
      // no chump blocks: only the blocks that kill something or survive
      const kept = first.filter(d => {
        const b = g.obj(d.blockerId), a = g.obj(d.attackerIds[0]);
        if (!a || !b) return true;
        const t = this._trade(a, b);
        return !t.blockerDies || t.attackerDies || first.filter(x => x.attackerIds[0] === a.id).length > 1;
      });
      add(kept);
      // the plain first read, if the refined one differs
      try { add(this._heuristicBlocks(ch)); } catch (e) { /* the refined plan stands */ }
      // one more blocker in front of the biggest attacker nobody is blocking
      const used = new Set(first.map(d => d.blockerId));
      const blocked = new Set(first.map(d => d.attackerIds[0]));
      const free = ch.candidates.map(id => g.obj(id)).filter(o => o && !used.has(o.id));
      const open = ch.attackers.map(id => g.obj(id)).filter(a => a && !blocked.has(a.id) && a.attacking === this.pid)
        .sort((x, y) => g.powerOf(y) - g.powerOf(x));
      for (const a of open) {
        const b = free.filter(x => g.canBlock(x, a) && !g.hasKw(a, 'menace')).sort((x, y) => this._worth(x) - this._worth(y))[0];
        if (b) { add(first.concat([{ blockerId: b.id, attackerIds: [a.id] }])); break; }
      }
      return out;
    }

    /**
     * A look ahead at what to cast, in a main phase of our own: the
     * judgement's first spell, the next best few, or nothing more for now
     * (in the first main phase that means casting after combat). Returns
     * { cast: option } or { hold: true }, or null to decide as usual.
     */
    async thinkPriority() {
      const g = this.game;
      if (g.pendingChoice || !g.activePlayer) return null;
      if (g.activePlayer.id !== this.pid || !g.isMain || g.stack.length) return this._thinkInstant();
      const L = this._lookCfg('main');
      if (!L) return null;
      // the land goes down first; the look comes after
      if (g.canPlayLand(this.pid) && this.hand().some(o => (o.analysis() || {}).isLand)) return null;
      if ((this.me.spellsCastThisTurn || 0) >= (this.cfg.spellCap || 99)) return null;
      const when = g.phaseIndex === 1 ? 'main1' : 'main2';
      const options = this.castOptions(when).filter(x => x.v > 0);
      // a planeswalker's choice of ability is as big a decision as any spell
      const walkers = L.walkers === 0 ? [] : this._loyaltyOptions(when);
      if (!options.length && !walkers.length) return null;
      const moves = [];
      if (options.length) {
        const mana = this.availableMana(true);
        const plan = this._bestPlan(options, mana).sort((x, y) => this._castPriority(y, when) - this._castPriority(x, when));
        if (plan[0]) moves.push({ cast: plan[0] });
      }
      const cap = this._candCap(L);
      const room = () => moves.length < cap - 1;
      // the walkers' best first when there is no spell to lead with; otherwise after the spells
      if (!moves.length) for (const c of walkers.slice(0, 2)) if (room()) moves.push({ activate: c });
      for (const x of options.slice().sort((p, q) => q.v - p.v)) {
        if (!room()) break;
        if (moves.some(m => m.cast && m.cast.o.id === x.o.id)) continue;
        moves.push({ cast: x });
      }
      for (const c of walkers) if (room() && !moves.some(m => m.activate === c)) moves.push({ activate: c });
      // the first removal spell, pointed at the second most worrying target instead
      const kill = moves.find(m => m.cast && rolesOf(m.cast.o.card).has('removal') && !m.cast.a.isPermanent);
      if (kill && room()) {
        const alt = this._secondTarget(kill.cast);
        if (alt) moves.push({ cast: Object.assign({}, kill.cast, { targets: alt }) });
      }
      moves.push({ hold: true });
      if (moves.length < 2) return null;
      const pick = await this._lookAhead(moves.map(m => ({
        apply: (f, fb) => (m.hold ? f.passPriority(this.pid) !== false
          : m.activate ? !!f.activateAbility(this.pid, m.activate.o.id, m.activate.index, this._abilityOpts(m.activate))
          : this._castIn(f, fb, m.cast)),
      })), L);
      return pick == null ? null : moves[pick];
    }

    /** Targets for a removal option that point at the second-best thing to kill, or null. */
    _secondTarget(x) {
      const g = this.game;
      const effects = flatEffects(g._cardSpellEffects(x.a));
      const first = this._bestRemovalTarget(effects);
      if (!first) return null;
      const second = this._bestRemovalTarget(effects, (o) => o.id !== first.id);
      if (!second) return null;
      return this.chooseTargets(x.o, x.a, { forceObject: second });
    }

    /**
     * A look ahead at instant speed, on someone else's turn or in combat:
     * whether to spend a counterspell on the spell in front of us, a
     * removal spell on an attacker, or an instant at the end of the turn —
     * against letting the moment pass. Returns { pass } or { instant },
     * or null to decide as usual.
     */
    async _thinkInstant() {
      const L = this._lookCfg('instant');
      if (!L) return null;
      const g = this.game;
      const top = g.stack.length ? g.stack[g.stack.length - 1] : null;
      const opts = this.castOptionsInstant();
      if (!opts.length) return null;
      const moves = [{ pass: true }];
      const cap = this._candCap(L);
      const add = (x, targets, kind, text) => { if (moves.length < cap) moves.push({ instant: Object.assign({}, x, { targets, kind, text }) }); };
      if (top) {
        if (top.controller === this.pid || top.kind !== 'spell') return null;
        const counters = opts.filter(x => flatEffects(g._cardSpellEffects(x.a)).some(e => e.op === 'counterSpell' || e.op === 'counterUnless'))
          .sort((x, y) => x.cost - y.cost);
        if (!counters.length) return null;
        add(counters[0], [{ kind: 'stack', id: top.id }], 'counter', `counters ${top.name}`);
      } else {
        const theirTurn = g.activePlayer.id !== this.pid;
        const attackers = g.step === 'declareAttackers' && g.combat && g.combat.attackers.length && theirTurn;
        const endStep = g.step === 'end' && theirTurn;
        if (!attackers && !endStep) return null;
        const removal = opts.filter(x => rolesOf(x.o.card).has('removal')).sort((x, y) => x.cost - y.cost);
        for (const x of removal.slice(0, 2)) {
          const effects = flatEffects(g._cardSpellEffects(x.a));
          const filter = attackers ? (o) => g.combat.attackers.includes(o.id) : null;
          const t = this._bestRemovalTarget(effects, filter);
          if (!t) continue;
          const targets = this.chooseTargets(x.o, x.a, { forceObject: t });
          if (targets) add(x, targets, 'cast', `removes ${t.name}`);
        }
        if (endStep || attackers) {
          for (const x of opts.filter(y => y.a.isCreature).sort((p, q) => this.rating(q.o) - this.rating(p.o)).slice(0, 1)) {
            const targets = this.chooseTargets(x.o, x.a);
            if (targets !== null) add(x, targets, 'cast', null);
          }
        }
      }
      if (moves.length < 2) return null;
      const pick = await this._lookAhead(moves.map(m => ({
        apply: (f) => (m.pass ? f.passPriority(this.pid) !== false
          : !!f.castSpell(this.pid, m.instant.o.id, { targets: m.instant.targets, auto: true })),
      })), L);
      if (pick == null || pick === 0) return pick == null ? null : { pass: true };
      return moves[pick];
    }

    /** The loyalty abilities that could be used now, best first. */
    _loyaltyOptions(when) {
      const g = this.game;
      const sources = this.manaSources();
      const out = [];
      for (const o of g.battlefield) {
        if (o.controller !== this.pid || o.activatedLoyaltyThisTurn) continue;
        const a = o.analysis();
        if (!a || !a.isPlaneswalker) continue;
        const all = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
        all.forEach((ab, index) => {
          if (ab.kind !== 'loyalty' || !ab.auto) return;
          const c = this._abilityCandidate(o, a, ab, index, when, sources);
          if (c) out.push(c);
        });
      }
      return out.sort((x, y) => y.v - x.v);
    }
    _abilityOpts(c) {
      const opts = { targets: c.targets, auto: true };
      if (c.sacrificeIds) opts.sacrificeIds = c.sacrificeIds;
      if (c.discardIds) opts.discardIds = c.discardIds;
      return opts;
    }

    /** Cast, in a copy of the game, the spell an option names here. */
    _castIn(f, fb, x) {
      const o = f.obj(x.o.id);
      if (!o) return false;
      const a = o.analysis();
      const chk = f.canCast(this.pid, o.id, x.via || undefined);
      if (!a || !chk.ok) return false;
      const costStr = x.via ? x.costStr : (chk.cost || '');
      return fb.castChoice({ o, a, v: x.v, cost: x.cost, costStr, via: x.via || null, targets: x.targets || undefined }, fb.availableMana(true));
    }

    /* ---- card evaluation ---- */
    cardValue(o) {
      const a = o && o.analysis();
      if (!a) return 0;
      if (a.isLand) return 0.5;
      return this.rating(o) - 1.8;
    }

    /** How much damage this card could point at a player, if any. */
    _burnDamage(a) {
      let n = 0;
      for (const ab of (a.abilities || [])) {
        if (ab.kind !== 'spell') continue;
        for (const e of (ab.effects || [])) {
          if (e.op !== 'damage') continue;
          const spec = (e.targets || [])[0];
          if (spec && spec.type !== 'any' && spec.type !== 'player') continue;
          if (!spec && !(e.each && /opponent/.test(e.each))) continue;
          n += nval(e.n, 0);
        }
      }
      return n;
    }

    /** Are we the ones who get there first? Compares the two board clocks. */
    _racing(opp) {
      const g = this.game;
      const power = (pid) => U.sum(g.battlefield
        .filter(o => o.controller === pid && this._isCreature(o))
        .map(o => g.powerOf(o)));
      const mine = power(this.pid), theirs = power(opp.id);
      const myClock = mine > 0 ? Math.ceil(opp.life / mine) : 99;
      const theirClock = theirs > 0 ? Math.ceil(this.me.life / theirs) : 99;
      return myClock <= theirClock;
    }

    /** Am I close enough to dying that hoarding answers is a losing plan? */
    underPressure() {
      const g = this.game;
      const theirPower = U.sum(g.battlefield
        .filter(o => o.controller !== this.pid && this._isCreature(o))
        .map(o => g.powerOf(o)));
      return theirPower > 0 && this.me.life <= theirPower * 2.5;
    }
  }

  /* ---- driver: keeps every bot in a game ticking ---- */
  class BotRunner {
    constructor(game) {
      this.game = game;
      this.bots = new Map();
      this.stopped = false;
      this._onState = () => this.kick();
      game.on('state', this._onState);
      game.on('choice', this._onState);
      game.on('priority', this._onState);
    }
    /**
     * Seat a bot. `difficulty` is a level, or a seat config
     * { difficulty, personality }; `opts.personality` names one of
     * PERSONALITIES. Left out, the bot plays the personality its deck was
     * built with, or one that suits the deck.
     */
    add(playerId, difficulty, tuning, opts) {
      if (difficulty && typeof difficulty === 'object') { opts = Object.assign({}, difficulty, opts); difficulty = difficulty.difficulty; }
      const bot = new BotPlayer(this.game, playerId, difficulty, tuning, opts);
      this.bots.set(playerId, bot);
      return bot;
    }
    /** Is any bot in the middle of a move — deciding, or pausing after one? */
    busy() {
      for (const bot of this.bots.values()) if (bot.busy) return true;
      return false;
    }
    /**
     * Run the bots until the table is waiting on somebody who is not one.
     *
     * One pass is not enough: a bot that acts sets off the next decision,
     * and the event that would have woken the runner arrives while it is
     * still inside this pass. So it goes round again for as long as bots
     * keep doing things, and stops the moment a round passes with nobody
     * doing anything.
     *
     * Only one of these loops runs at a time. A bot pauses after each move
     * so a person can follow it, and the move itself fires state events
     * that call kick() again; a second loop started then would find the bot
     * busy, conclude that nobody could act, and push the game on behind
     * the bot's back. So a kick that arrives mid-loop just asks the
     * running loop to go round once more.
     */
    kick() {
      if (this.stopped) return;
      if (this._running) { this._again = true; return; }
      if (this._queued) return;
      this._queued = true;
      setTimeout(() => this._loop(), 30);
    }
    async _loop() {
      this._queued = false;
      if (this.stopped || this._running) return;
      this._running = true;
      try {
        do {
          this._again = false;
          for (let round = 0; round < 400; round++) {
            let acted = false;
            for (const bot of this.bots.values()) {
              try { acted = (await bot.tick()) || acted; } catch (e) { console.warn('[bot]', e); }
              if (this.stopped) return;
            }
            if (!acted) break;
          }
        } while (this._again && !this.stopped);
      } finally { this._running = false; }
      if (!this.stopped) this._checkStuck();
    }

    /**
     * Nobody did anything that round. Usually that is right — the table is
     * waiting on a person. But if it is waiting on one of ours and nothing
     * has changed, something the bot tried was refused, and no event will
     * ever arrive to wake it up again. Rather than leave the game frozen,
     * it is nudged — loudly, in the console and in the game log, because a
     * table that needs nudging has a bug in it somewhere. A bot that is
     * still thinking is not stuck, so nothing is decided while one is.
     */
    _checkStuck() {
      const g = this.game;
      if (this.stopped || g.over || g.mulliganPhase) { this._stuck = null; return; }
      if (this._running || this.busy()) { setTimeout(() => { if (!this.stopped) this.kick(); }, 120); return; }
      const ch = g.pendingChoice;
      const waiting = ch ? (this.bots.has(ch.playerId) ? ch.playerId : null)
        : (g.priorityPlayer && this.bots.has(g.priorityPlayer.id) ? g.priorityPlayer.id : null);
      if (!waiting) { this._stuck = null; return; }
      const v = g.stateVersion;
      if (!this._stuck || this._stuck.version !== v) this._stuck = { version: v, tries: 0 };
      this._stuck.tries++;
      if (this._stuck.tries <= 3) { setTimeout(() => { if (!this.stopped) this.kick(); }, 120); return; }
      if (this._stuck.tries > 4) return;                  // said it once
      const what = ch ? ch.type : 'priority';
      console.warn('[bot] nothing is happening: waiting on', waiting, what, g.lastError || '');
      g.logEvent('rules', `Nobody could act on ${what} — the table moved on. (${g.lastError || 'no reason given'})`);
      if (ch && ch.type === 'declareAttackers') {
        if (!g.declareAttackers(waiting, [])) {
          const all = (ch.candidates || []).map(id => g.obj(id)).filter(o => o && g.canAttack(o))
            .map(o => ({ attackerId: o.id, defenderId: ch.defenders[0].id }));
          g.declareAttackers(waiting, all);
        }
      } else if (ch && ch.type === 'declareBlockers') {
        g.declareBlockers(waiting, []);
      } else if (ch) {
        g.resolveChoice(waiting, {});
      } else {
        g.passPriority(waiting);
      }
    }
    stop() {
      this.stopped = true;
      this.game.off('state', this._onState);
      this.game.off('choice', this._onState);
      this.game.off('priority', this._onState);
    }
  }

  MTG.bots = {
    buildBotDeck, findPartner, BotPlayer, BotRunner, DIFFICULTY, diffCfg,
    // who the bots are: personalities for a lobby picker, names and faces to go with them
    PERSONALITIES, personalityFor, nameFor, avatarFor,
    // how far ahead each level looks, and how a look ahead judges a position
    LOOKAHEAD, tableScore,
    // the card judge, for the draft, the deck builder and the tools in tools/
    rateCard, rolesOf, botCanPlay, judge: { effectWorth, abilityWorth, bodyWorth, freeColours, pipsOf },
    /* A generic question answered for a player on the spot (a bot casting
       a spell), with that player's own judgement. */
    answerChoose(game, playerId, spec) {
      const p = game.player(playerId);
      return new BotPlayer(game, playerId, (p && p.botDifficulty) || 5).chooseGeneric(spec);
    },
  };
})(window.MTG);

