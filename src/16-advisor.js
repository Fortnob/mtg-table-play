/* ============================================================
   16-advisor.js - work out what a deck is trying to do, then help
   Reads the cards already in the list, infers the archetype and the
   themes it leans on, measures the category balance against what decks
   of that shape normally run, and asks Scryfall for cards that fit.
   Suggestions match the deck's own plan rather than pushing every list
   toward the same staples.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const O = MTG.oracle;

  /* ============================================================
     EDHREC — what everybody else plays in this commander
     The engine can read a list and say what it is short of; it cannot
     know that nine thousand people put the same rock in this deck. That
     is the one thing EDHREC knows and nothing here can work out, so it
     is worth asking for, and worth working without: the whole thing sits
     behind a timeout and a catch, and the suggestions fall back to the
     engine's own reading if it is not there.
     ============================================================ */
  const EDHREC_TTL = 1000 * 60 * 60 * 24 * 7;

  /** EDHREC's page slug for a commander: "Krenko, Mob Boss" -> krenko-mob-boss. */
  function edhrecSlug(name) {
    return String(U.frontName(name) || '')
      .toLowerCase()
      .replace(/[\u2019']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** Pull the recommended lists for one commander, or nothing at all. */
  async function edhrecFor(commander, opts) {
    opts = opts || {};
    if (!commander) return null;
    const slug = edhrecSlug(commander.name);
    if (!slug) return null;
    const key = 'edhrec:' + slug;
    if (!opts.force) {
      const hit = MTG.store.get(key, null);
      if (hit && Date.now() - hit._t < EDHREC_TTL) return hit.cards;
    }
    const url = `https://json.edhrec.com/pages/commanders/${slug}.json`;
    let data = null;
    try {
      const res = await Promise.race([
        fetch(url, { headers: { Accept: 'application/json' } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
      ]);
      if (!res || !res.ok) throw new Error('no page');
      data = await res.json();
    } catch (e) {
      MTG.bus.emit('edhrec:unavailable', e.message || String(e));
      return null;
    }
    const cards = readEdhrec(data);
    if (cards.length) MTG.store.set(key, { _t: Date.now(), cards });
    return cards;
  }

  /**
   * EDHREC's payload is a page rather than an API, so this reads what it
   * needs and ignores the rest: every card list on the page, with how
   * often the card turns up and how much of that is down to this
   * commander rather than to the card being good everywhere.
   */
  function readEdhrec(data) {
    const out = [];
    const seen = new Set();
    const lists = ((data || {}).container || {}).json_dict || (data || {}).json_dict || {};
    const cardlists = lists.cardlists || (data || {}).cardlists || [];
    for (const list of cardlists) {
      const label = String(list.header || list.tag || '').toLowerCase();
      if (/^lands?$/.test(label)) continue;               // basics are not a suggestion
      for (const cv of (list.cardviews || [])) {
        const name = cv.name || cv.sanitized_wo;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const potential = Number(cv.potential_decks) || 0;
        const decks = Number(cv.num_decks) || 0;
        out.push({
          name,
          inclusion: potential ? U.clamp(decks / potential, 0, 1) : 0,
          synergy: Number(cv.synergy) || 0,
          label: list.header || '',
        });
      }
    }
    return out.sort((a, b) => b.inclusion - a.inclusion).slice(0, 120);
  }

  /* ============================================================
     Recommander and EDHREC together
     Recommander knows what this list in particular is missing; EDHREC
     knows what everyone else plays with the commander. A card both of
     them name is the surest suggestion there is, so those come first,
     the best of both ahead; then the rest of each list in turn, one from
     Recommander and one from EDHREC, so the page fills even when they
     agree on little. Each card says where it came from.
     ============================================================ */
  /** How strongly EDHREC backs a card: how many of the commander's decks run it, and a little for synergy. */
  const edhStrength = (x) => (x.inclusion || 0) + 0.5 * U.clamp(x.synergy || 0, 0, 0.6);
  /** "EDHREC 41% of decks", with the synergy when it is worth saying. */
  function edhWords(x) {
    const syn = Math.round((x.synergy || 0) * 100);
    return `EDHREC ${Math.round((x.inclusion || 0) * 100)}% of decks` + (syn >= 15 ? `, +${syn}% synergy` : '');
  }
  /**
   * blend(rec, edh, opts) -> [{ name, rec, edhrec, both, why }]
   * rec: Recommander's picks, best first ([{ name }]); edh: EDHREC's
   * ([{ name, inclusion, synergy }]). Either may be null or empty. `rec`
   * is the pick's place in Recommander's list (0 for its first), `edhrec`
   * EDHREC's entry for it. opts.skip(name): leave this card out (the deck
   * has it already).
   */
  function blend(rec, edh, opts) {
    opts = opts || {};
    const key = (n) => U.normName(U.frontName(n));
    const skip = opts.skip || (() => false);
    const recAt = new Map();
    (rec || []).forEach((x, i) => { if (x && x.name && !recAt.has(key(x.name))) recAt.set(key(x.name), { x, i }); });
    const recN = Math.max(1, (rec || []).length);
    const edhSorted = (edh || []).filter(x => x && x.name).slice().sort((a, b) => edhStrength(b) - edhStrength(a));
    const edhAt = new Map();
    for (const x of edhSorted) if (!edhAt.has(key(x.name))) edhAt.set(key(x.name), x);
    const edhTop = Math.max(1e-6, ...edhSorted.map(edhStrength));
    const out = [], both = [], recOnly = [], edhOnly = [];
    for (const [k, { x, i }] of recAt) {
      if (skip(x.name)) continue;
      const e = edhAt.get(k);
      const item = { name: x.name, rec: i, edhrec: e || null, both: !!e,
        why: e ? `Recommander #${i + 1} · ${edhWords(e)}` : `Recommander #${i + 1}` };
      // both: Recommander's place and EDHREC's backing, each out of one, weighed alike
      if (e) { item.score = 0.5 * (1 - i / recN) + 0.5 * (edhStrength(e) / edhTop); both.push(item); }
      else recOnly.push(item);
    }
    for (const [k, e] of edhAt) {
      if (recAt.has(k) || skip(e.name)) continue;
      edhOnly.push({ name: e.name, rec: null, edhrec: e, both: false, why: edhWords(e) });
    }
    both.sort((a, b) => b.score - a.score || a.rec - b.rec);
    out.push(...both);
    for (let i = 0; i < Math.max(recOnly.length, edhOnly.length); i++) {
      if (recOnly[i]) out.push(recOnly[i]);
      if (edhOnly[i]) out.push(edhOnly[i]);
    }
    for (const x of out) delete x.score;
    return out;
  }

  /* ============================================================
     Themes - what a deck can be "about"
     `t` tests a single card; `q` is the Scryfall fragment used to find
     more of the same; `w` weights how strongly the theme identifies a deck.
     ============================================================ */
  const THEMES = [
    { id: 'tokens', name: 'tokens', w: 1,
      t: (c, a, x) => /create (?:a|an|one|two|three|four|X|\d+) [^.]*creature tokens?/i.test(x),
      q: 'o:"creature token"' },
    { id: 'counters', name: '+1/+1 counters', w: 1,
      t: (c, a, x) => /\+1\/\+1 counter/i.test(x), q: 'o:"+1/+1 counter"' },
    { id: 'sacrifice', name: 'sacrifice', w: 1.2,
      t: (c, a, x) => /sacrifice (?:a|another|two|X) (?:creature|permanent|artifact)|whenever (?:a|another) creature (?:you control )?dies/i.test(x),
      q: '(o:"sacrifice a creature" or o:"whenever a creature you control dies" or o:"whenever another creature dies")' },
    { id: 'lifegain', name: 'lifegain', w: 1,
      t: (c, a, x) => /you gain \d+ life|whenever you gain life|lifelink/i.test(x),
      q: '(o:"whenever you gain life" or kw:lifelink or o:"you gain")' },
    { id: 'graveyard', name: 'graveyard', w: 1.2,
      t: (c, a, x) => /from your graveyard to the battlefield|return target creature card from (?:your|a) graveyard|mill|flashback|escape|delve|dredge|unearth|disturb/i.test(x),
      q: '(o:"from your graveyard" or kw:flashback or kw:escape or kw:unearth)' },
    { id: 'artifacts', name: 'artifacts', w: 1,
      t: (c, a, x) => a.isArtifact || /artifacts? you control|whenever an artifact|artifact enters/i.test(x),
      q: '(t:artifact or o:"artifact you control")' },
    { id: 'enchantments', name: 'enchantments', w: 1,
      t: (c, a, x) => a.isEnchantment || /enchantments? you control|constellation/i.test(x),
      q: '(t:enchantment or o:"enchantment you control")' },
    { id: 'spellslinger', name: 'instants and sorceries', w: 1.1,
      t: (c, a, x) => a.isInstant || a.isSorcery || /whenever you cast an instant or sorcery|prowess|magecraft/i.test(x),
      q: '(o:"instant or sorcery" or kw:prowess or t:instant or t:sorcery)' },
    { id: 'landfall', name: 'landfall', w: 1.4,
      t: (c, a, x) => /landfall|whenever a land enters/i.test(x),
      q: '(kw:landfall or o:"whenever a land enters")' },
    { id: 'blink', name: 'blink', w: 1.3,
      t: (c, a, x) => /exile (?:target|another target|up to \w+ target)[^.]*(?:return|returns) (?:it|them|that card) to the battlefield/i.test(x),
      q: 'o:"exile target creature you control, then return"' },
    { id: 'voltron', name: 'equipment and auras', w: 1.2,
      t: (c, a, x) => a.isEquipment || a.isAura || /equipped creature|enchanted creature/i.test(x),
      q: '(t:equipment or t:aura)' },
    { id: 'mill', name: 'mill', w: 1.4,
      t: (c, a, x) => /mills? \w+ cards?|puts? the top \w+ cards? of (?:their|his or her) library into (?:their|his or her) graveyard/i.test(x),
      q: 'o:mill' },
    { id: 'stax', name: 'taxing and stax', w: 1.5,
      t: (c, a, x) => /players? can'?t|each opponent sacrifices|spells? cost \{\d+\} more|don'?t untap|skip (?:their|your) (?:draw|untap)/i.test(x),
      q: '(o:"costs {1} more" or o:"each opponent sacrifices" or o:"don\'t untap")' },
    { id: 'grouphug', name: 'group hug', w: 1.5,
      t: (c, a, x) => /each player draws|each player may|target opponent draws/i.test(x),
      q: 'o:"each player draws"' },
    { id: 'treasure', name: 'treasure', w: 1.2,
      t: (c, a, x) => /treasure token/i.test(x), q: 'o:"treasure token"' },
    { id: 'energy', name: 'energy', w: 2,
      t: (c, a, x) => /\{E\}/.test(x), q: 'o:"{E}"' },
    { id: 'vehicles', name: 'vehicles', w: 1.6,
      t: (c, a, x) => a.isVehicle || /crew \d/i.test(x), q: 't:vehicle' },
    { id: 'infect', name: 'poison and infect', w: 2,
      t: (c, a, x) => /\binfect\b|\btoxic \d|poison counter|proliferate/i.test(x),
      q: '(kw:infect or kw:toxic or kw:proliferate)' },
    { id: 'reanimate', name: 'reanimator', w: 1.5,
      t: (c, a, x) => /return target creature card from (?:your|a) graveyard to the battlefield/i.test(x),
      q: 'o:"return target creature card from your graveyard to the battlefield"' },
    { id: 'ramp', name: 'big mana', w: 0.8,
      t: (c, a, x) => /search your library for (?:a|up to \w+) basic land|add \{[^}]+\}\{/i.test(x),
      q: '(o:"search your library for a basic land" or o:"add two mana")' },
    { id: 'control', name: 'control', w: 1,
      t: (c, a, x) => /counter target spell|destroy all creatures|exile all creatures/i.test(x),
      q: '(o:"counter target spell" or o:"destroy all creatures")' },
    { id: 'aggro', name: 'aggression', w: 0.7,
      t: (c, a, x) => a.isCreature && (a.mv || 0) <= 3 && (parseInt(a.power, 10) || 0) >= (a.mv || 0) + 1,
      q: 't:creature mv<=3 pow>=3' },
    { id: 'flying', name: 'fliers', w: 0.9,
      t: (c, a) => a.keywordSet && a.keywordSet.has('flying'), q: 'kw:flying t:creature' },
    { id: 'storm', name: 'storm and cost reduction', w: 1.8,
      t: (c, a, x) => /\bstorm\b|spells? you cast cost \{\d+\} less|whenever you cast your (?:second|third)/i.test(x),
      q: '(kw:storm or o:"spells you cast cost")' },
    { id: 'ninjutsu', name: 'ninjutsu and unblockable', w: 1.6,
      t: (c, a, x) => /ninjutsu|can'?t be blocked/i.test(x), q: '(kw:ninjutsu or o:"can\'t be blocked")' },
    { id: 'wheels', name: 'wheels and discard', w: 1.3,
      t: (c, a, x) => /each player discards their hand|discards? (?:a|two|three) cards?|whenever (?:an opponent|a player) discards/i.test(x),
      q: '(o:"discards their hand" or o:"each opponent discards")' },
  ];

  /* ============================================================
     Roles - the jobs a deck needs filling
     ============================================================ */
  const ROLES = [
    { id: 'land', name: 'lands', t: (c, a) => a.isLand, q: 't:land -t:basic' },
    { id: 'ramp', name: 'ramp', q: '(o:"search your library for a basic land" or (t:artifact o:"{T}: Add") or (t:creature o:"{T}: Add"))',
      t: (c, a, x) => !a.isLand && (a.manaAbilities.length > 0 || /search your library for (?:a|up to \w+)[^.]*land card/i.test(x) || /add \{/i.test(x)) },
    { id: 'draw', name: 'card draw', q: '(o:"draw a card" or o:"draw two cards" or o:"draw three cards")',
      t: (c, a, x) => /draws? (?:a|one|two|three|four|X|\d+) cards?/i.test(x) && !/each opponent draws/i.test(x) },
    { id: 'removal', name: 'spot removal', q: '(o:"destroy target" or o:"exile target creature" or o:"damage to any target" or o:"damage to target creature")',
      t: (c, a, x) => /destroy target (?:creature|permanent|artifact|enchantment|planeswalker|nonland)|exile target (?:creature|permanent|nonland)|deals \d+ damage to (?:any target|target creature)|target creature gets -\d/i.test(x) },
    { id: 'wipe', name: 'board wipes', q: '(o:"destroy all creatures" or o:"exile all creatures" or o:"each creature")',
      t: (c, a, x) => /destroy all|exile all creatures|each creature gets -\d+\/-\d+|all creatures get -/i.test(x) },
    { id: 'interaction', name: 'counterspells and protection', q: '(o:"counter target spell" or kw:hexproof or o:"gains indestructible")',
      t: (c, a, x) => /counter target|gains? (?:hexproof|indestructible|protection)|prevent all damage/i.test(x) },
    { id: 'threat', name: 'threats and finishers', q: 't:creature mv>=4',
      t: (c, a, x) => (a.isCreature && (a.mv || 0) >= 4) || a.isPlaneswalker },
  ];

  /* Target counts by format shape. Commander numbers follow the usual
     "10 ramp / 10 draw / 10 interaction" guidance; 60-card numbers are the
     conventional constructed split. */
  function targetsFor(fmt, deckSize) {
    // Brawl and Oathbreaker: a commander deck in sixty cards, with a sixty-card mana base
    if (fmt.commander && fmt.kind !== 'limited' && (fmt.deckMin || 100) < 100) {
      return { land: 24, ramp: 4, draw: 6, removal: 6, wipe: 2, interaction: 3, threat: 9 };
    }
    if (fmt.commander) {
      return { land: 36, ramp: 10, draw: 10, removal: 8, wipe: 3, interaction: 4, threat: 12 };
    }
    if (fmt.kind === 'limited') {
      const lands = MTG.formats.suggestedLands(deckSize || 40, 3);
      return { land: lands, ramp: 0, draw: 2, removal: 4, wipe: 0, interaction: 1, threat: 14 };
    }
    return { land: 24, ramp: 2, draw: 5, removal: 8, wipe: 2, interaction: 4, threat: 16 };
  }

  /* ============================================================
     Profiling a deck
     ============================================================ */

  function cardText(card, a) {
    return ((a && (a.oracleTextParsed || a.oracleText)) || card.oracle_text || '') + ' ' + (card.type_line || '');
  }

  /** profile(deck, formatId) -> archetype, themes, role counts, gaps, curve */
  function profile(deck, formatId) {
    const fmt = MTG.formats.get(formatId) || MTG.formats.get('commander');
    const entries = (deck.main || []).slice();
    const commanders = deck.commanders || [];
    const flat = [];
    for (const e of entries) for (let i = 0; i < e.qty; i++) flat.push(e.card);

    const themeScore = {}, themeCards = {};
    const roleCount = {}, roleCards = {};
    for (const t of THEMES) { themeScore[t.id] = 0; themeCards[t.id] = []; }
    for (const r of ROLES) { roleCount[r.id] = 0; roleCards[r.id] = []; }

    const tally = (card, weight) => {
      const a = O.analyze(card);
      if (!a) return;
      const x = cardText(card, a);
      for (const t of THEMES) {
        let hit = false;
        try { hit = !!t.t(card, a, x); } catch (e) { hit = false; }
        if (hit) { themeScore[t.id] += t.w * weight; if (weight >= 1) themeCards[t.id].push(card.name); }
      }
      for (const r of ROLES) {
        let hit = false;
        try { hit = !!r.t(card, a, x); } catch (e) { hit = false; }
        if (hit && weight >= 1) { roleCount[r.id]++; roleCards[r.id].push(card.name); }
      }
    };
    for (const c of flat) tally(c, 1);
    // the commander tells you more about the plan than any other single card
    for (const c of commanders) tally(c, 4);

    /* --- tribe --- */
    const typeCount = {};
    for (const c of flat.concat(commanders)) {
      const a = O.analyze(c);
      if (!a || !a.isCreature) continue;
      for (const st of a.subtypes) typeCount[st] = (typeCount[st] || 0) + 1;
    }
    let tribe = null, tribeN = 0;
    for (const [t, n] of Object.entries(typeCount)) if (n > tribeN) { tribe = t; tribeN = n; }
    // the commander naming a type is a much stronger signal than a raw count
    let tribeFromCommander = null;
    for (const c of commanders) {
      const txt = c.oracle_text || '';
      for (const t of Object.keys(typeCount)) {
        if (new RegExp('\\b' + t + 's?\\b').test(txt)) { tribeFromCommander = t; break; }
      }
      if (tribeFromCommander) break;
    }
    const tribeConfirmed = tribeFromCommander || (tribeN >= Math.max(8, flat.length * 0.14) ? tribe : null);

    /* --- identity --- */
    const identity = new Set();
    for (const c of commanders) for (const col of (c.color_identity || [])) identity.add(col);
    if (!identity.size) for (const c of flat) for (const col of (c.color_identity || [])) identity.add(col);
    const colors = MTG.mana.COLORS.filter(c => identity.has(c));

    /* --- strategy axis --- */
    const stats = MTG.formats.deckStats(entries, commanders);
    const avgMv = stats.avgMv;
    const creatureRatio = stats.creatures / Math.max(1, stats.total - stats.lands);
    let strategy = 'midrange';
    if (avgMv <= 2.5 && creatureRatio > 0.5) strategy = 'aggro';
    else if (roleCount.interaction + roleCount.wipe >= 8 && creatureRatio < 0.4) strategy = 'control';
    else if (avgMv >= 4.2) strategy = 'ramp';
    if (themeScore.storm > 4 || themeScore.stax > 6) strategy = 'combo';

    /* --- top themes --- */
    const themes = THEMES
      .map(t => ({ id: t.id, name: t.name, score: themeScore[t.id], cards: themeCards[t.id].slice(0, 8), q: t.q }))
      .filter(t => t.score >= 3)
      .sort((a, b) => b.score - a.score);

    /* --- label --- */
    const colorName = colorLabel(colors);
    const bits = [colorName];
    if (tribeConfirmed) bits.push(tribeConfirmed + 's');
    else if (themes[0]) bits.push(themes[0].name);
    if (themes[1] && !tribeConfirmed) bits.push(themes[1].name);
    bits.push(strategy);
    const label = bits.filter(Boolean).join(' ');

    /* --- gaps --- */
    const targets = targetsFor(fmt, stats.total);
    const gaps = [];
    for (const r of ROLES) {
      const want = targets[r.id];
      if (want == null) continue;
      const have = r.id === 'land' ? stats.lands : roleCount[r.id];
      const diff = want - have;
      gaps.push({
        id: r.id, name: r.name, have, want, diff,
        severity: diff >= Math.max(3, want * 0.4) ? 'high' : diff > 0 ? 'low' : (have > want * 1.6 ? 'over' : 'ok'),
      });
    }

    return {
      formatId, fmt, label, colors, colorName, tribe: tribeConfirmed, tribeCount: tribeN,
      strategy, themes, themeScore, roleCount, roleCards, gaps, stats, targets,
      commanders: commanders.map(c => c.name),
      deckSize: stats.total,
      identity: colors,
    };
  }

  function colorLabel(colors) {
    const key = colors.slice().sort().join('');
    const names = {
      '': 'Colorless', W: 'Mono-white', U: 'Mono-blue', B: 'Mono-black', R: 'Mono-red', G: 'Mono-green',
      UW: 'Azorius', BW: 'Orzhov', RW: 'Boros', GW: 'Selesnya', BU: 'Dimir', RU: 'Izzet', GU: 'Simic',
      BR: 'Rakdos', BG: 'Golgari', GR: 'Gruul',
      BUW: 'Esper', RUW: 'Jeskai', GUW: 'Bant', BRU: 'Grixis', BGU: 'Sultai', GRU: 'Temur',
      BRW: 'Mardu', BGW: 'Abzan', GRW: 'Naya', BGR: 'Jund',
      BGRU: 'Glint-Eye', BGRW: 'Dune', BGUW: 'Witch', BRUW: 'Yore', GRUW: 'Ink-Treader',
      BGRUW: 'Five-color',
    };
    return names[key] || (colors.join('') || 'Colorless');
  }

  /* ============================================================
     Recommendations
     ============================================================ */

  /**
   * recommend(deck, formatId, opts) -> {
   *   profile, gaps, cards:[{card, score, role, reasons}], cuts, comboCompletions
   * }
   */
  async function recommend(deck, formatId, opts) {
    opts = opts || {};
    const limit = opts.limit || 24;
    const prof = opts.profile || profile(deck, formatId);
    const fmt = prof.fmt;
    const legalKey = fmt.scryKey;
    const idq = prof.colors.length ? 'id<=' + prof.colors.join('') : 'id:c';
    const base = [legalKey ? 'legal:' + legalKey : 'game:paper', '-is:digital', 'lang:en', idq, '-t:basic'].join(' ');

    const owned = new Set();
    for (const e of deck.main) owned.add(U.normName(U.frontName(e.card.name)));
    for (const e of (deck.sideboard || [])) owned.add(U.normName(U.frontName(e.card.name)));
    for (const c of (deck.commanders || [])) owned.add(U.normName(U.frontName(c.name)));

    /* --- 0. Recommander: the cards that suit this commander deck as built ---
       Learned from a great many real decks, it ranks what this list in
       particular is missing (src/16b-recommander.js). When it answers, its
       order is the order of the suggestions, and the engine only says what
       each card would do here; when it cannot be asked, the engine's own
       reading and EDHREC stand in, as before.
       Asked for both (the default: Options, Suggestions), Recommander and
       EDHREC are asked at once, once each, and their lists are blended
       (blend, above); when one of them does not answer, the other's
       suggestions stand alone, and the panel says which was missing. */
    const commander = (deck.commanders || [])[0];
    const recPicks = [];
    const from = opts.from || (MTG.settings || {}).suggestFrom || 'both';
    const fromRec = opts.recommander !== false && from !== 'edhrec';
    const fromBoth = from === 'both' && opts.edhrec !== false;
    let recList = null, edhList = null, recAsked = false;
    if (commander && fmt.commander) {
      recAsked = fromRec;
      [recList, edhList] = await Promise.all([
        fromRec && MTG.recommander && MTG.recommander.ready() ? MTG.recommander.top(deck).catch(() => null) : null,
        fromBoth ? edhrecFor(commander).catch(() => null) : null,
      ]);
    }
    /* Both answered: one list of the two (the cards both name first), its
       cards looked up together, each with where it came from. */
    const hybPicks = [];
    if (fromBoth && recList && recList.length && edhList && edhList.length) {
      const wanted = blend(recList, edhList, { skip: (n) => owned.has(U.normName(U.frontName(n))) }).slice(0, Math.max(limit * 3, 60));
      try {
        const { cards } = await MTG.scry.collection(wanted.map(x => ({ name: x.name })));
        wanted.forEach((pick, i) => {
          const card = cards[i];
          if (!card || MTG.formats.isBasicLand(card)) return;
          if (owned.has(U.normName(U.frontName(card.name)))) return;
          if (legalKey && (card.legalities || {})[legalKey] !== 'legal') return;
          if ((card.color_identity || []).some(c => !prof.colors.includes(c))) return;
          hybPicks.push({ card, rank: hybPicks.length, why: pick.why, both: pick.both });
        });
      } catch (e) { /* each list on its own, below */ }
    }
    const hybridUsed = hybPicks.length > 0;
    if (!hybridUsed) {
      const list = recList;
      if (list && list.length) {
        const wanted = list.filter(x => !owned.has(U.normName(U.frontName(x.name)))).slice(0, Math.max(limit * 3, 60));
        try {
          const { cards } = await MTG.scry.collection(wanted.map(x => ({ name: x.name })));
          wanted.forEach((rec, i) => {
            const card = cards[i];
            if (!card || MTG.formats.isBasicLand(card)) return;
            if (owned.has(U.normName(U.frontName(card.name)))) return;
            if (legalKey && (card.legalities || {})[legalKey] !== 'legal') return;
            if ((card.color_identity || []).some(c => !prof.colors.includes(c))) return;
            recPicks.push({ card, rank: recPicks.length });
          });
        } catch (e) { /* the engine's own suggestions stand in */ }
      }
    }
    const recommanderUsed = recPicks.length > 0;
    /* asked of both (or of Recommander, which falls back to EDHREC) and one
       of them missing: which one, so the panel can say so */
    const missing = !commander || !fmt.commander || hybridUsed ? null
      : fromBoth && recommanderUsed ? 'edhrec'
      : recAsked && !recommanderUsed ? 'recommander' : null;

    /* --- 1. what to search for: the gaps, then the themes --- */
    const queries = [];
    const needyRoles = prof.gaps.filter(g => g.diff > 0).sort((a, b) => b.diff - a.diff);
    for (const g of needyRoles.slice(0, 4)) {
      const role = ROLES.find(r => r.id === g.id);
      if (!role || !role.q) continue;
      // bias a role search toward the deck's leading theme when there is one
      const themeBit = prof.themes[0] && g.id !== 'land' ? ' ' + prof.themes[0].q : '';
      queries.push({ q: `${base} ${role.q}${themeBit}`, role: g.id, why: `fills your ${role.name} gap`, weight: 1.6 });
      queries.push({ q: `${base} ${role.q}`, role: g.id, why: `fills your ${role.name} gap`, weight: 1.1 });
    }
    for (const t of prof.themes.slice(0, 3)) {
      queries.push({ q: `${base} ${t.q}`, theme: t.id, why: `matches your ${t.name} theme`, weight: 1.4 });
    }
    if (prof.tribe) {
      queries.push({ q: `${base} t:${prof.tribe}`, theme: 'tribal', why: `another ${prof.tribe}`, weight: 1.9 });
      queries.push({ q: `${base} o:"${prof.tribe}" -t:${prof.tribe}`, theme: 'tribal', why: `pays off your ${prof.tribe}s`, weight: 1.7 });
    }
    if (!queries.length) queries.push({ q: base, why: 'a strong card in your colours', weight: 1 });
    // with Recommander's answer in hand (or both lists blended), its picks are the pool and nothing else is searched for
    if (recommanderUsed || hybridUsed) queries.length = 0;

    /* --- 2. run them --- */
    const pool = new Map();   // id -> {card, hits:[{why,weight,role,theme}], rank}
    for (const p of recPicks) pool.set(p.card.id, { card: p.card, hits: [], bestRank: 999, rec: p.rank });
    for (const p of hybPicks) pool.set(p.card.id, { card: p.card, hits: [], bestRank: 999, hyb: p });
    for (const spec of queries) {
      let res = [];
      try { res = await MTG.scry.search(spec.q, { order: 'edhrec', unique: 'cards', max: opts.perQuery || 60 }); }
      catch (e) { continue; }
      res.forEach((card, i) => {
        if (owned.has(U.normName(U.frontName(card.name)))) return;
        if (MTG.formats.isBasicLand(card)) return;
        if (legalKey && (card.legalities || {})[legalKey] !== 'legal') return;
        const bad = (card.color_identity || []).some(c => !prof.colors.includes(c));
        if (bad) return;
        const cur = pool.get(card.id) || { card, hits: [], bestRank: i };
        cur.hits.push(Object.assign({ position: i }, spec));
        cur.bestRank = Math.min(cur.bestRank, i);
        pool.set(card.id, cur);
      });
      if (pool.size > 400) break;
    }

    /* --- 2b. what everyone else plays in this commander ---
       The engine reads the list in front of it; EDHREC knows what the
       rest of the world put in the same deck. Neither is the whole
       answer, so both go into the same pool and the scoring weighs
       them together. If EDHREC cannot be reached this simply adds
       nothing. */
    let edhrecUsed = false;
    if (commander && fmt.commander && opts.edhrec !== false && !recommanderUsed && !hybridUsed) {
      // (asked already, alongside Recommander, when both were asked for)
      const list = fromBoth ? edhList : await edhrecFor(commander).catch(() => null);
      if (list && list.length) {
        const wanted = list.filter(x => !owned.has(U.normName(U.frontName(x.name)))).slice(0, 90);
        try {
          const { cards } = await MTG.scry.collection(wanted.map(x => ({ name: x.name })));
          wanted.forEach((rec, i) => {
            const card = cards[i];
            if (!card || MTG.formats.isBasicLand(card)) return;
            if (legalKey && (card.legalities || {})[legalKey] !== 'legal') return;
            if ((card.color_identity || []).some(c => !prof.colors.includes(c))) return;
            const cur = pool.get(card.id) || { card, hits: [], bestRank: 999 };
            cur.edhrec = rec;
            pool.set(card.id, cur);
            edhrecUsed = true;
          });
        } catch (e) { /* the engine's own suggestions stand on their own */ }
      }
    }

    /* --- 3. score --- */
    const curveNeed = curveGaps(prof);
    // resolve the deck's themes once rather than per card
    const topThemes = prof.themes.slice(0, 4).map(t => THEMES.find(d => d.id === t.id)).filter(Boolean);
    const scored = [];
    for (const entry of pool.values()) {
      const card = entry.card;
      const a = O.analyze(card);
      if (!a) continue;
      const reasons = [];
      let score = 0;

      // the blended order stands, and says where each card came from
      if (entry.hyb) {
        score += (1000 - entry.hyb.rank) * 100;
        reasons.push(entry.hyb.why);
      }
      // Recommander's order stands: what follows only explains the card
      if (entry.rec != null) {
        score += (1000 - entry.rec) * 100;     // far past anything the notes below add
        reasons.push(entry.rec < 10 ? `Recommander's #${entry.rec + 1} pick for this deck` : 'recommended for this deck by Recommander');
      }

      // popularity: Scryfall's edhrec ordering is the play-rate signal
      const pop = 1 - U.clamp(entry.bestRank / 60, 0, 1);
      score += pop * 2.2;
      if (entry.bestRank <= 8) reasons.push('very widely played in decks like this');

      /* what the rest of the world actually sleeves up in this commander:
         how many of those decks run it, and how much of that is this
         commander rather than the card being good in everything */
      if (entry.edhrec) {
        const pct = Math.round(entry.edhrec.inclusion * 100);
        score += entry.edhrec.inclusion * 3.2;
        score += U.clamp(entry.edhrec.synergy, -0.2, 0.6) * 2.4;
        if (pct >= 8) reasons.push(`in ${pct}% of ${U.frontName(commander.name)} decks`);
        if (entry.edhrec.synergy >= 0.15) reasons.push('unusually good with your commander specifically');
        if (!entry.hits.length) reasons.push('a staple of this commander that your list is missing');
      }

      // how many of our queries found it, and how relevant each was
      const seenWhy = new Set();
      for (const h of entry.hits) {
        score += h.weight * (1 - U.clamp(h.position / 80, 0, 0.9));
        if (!seenWhy.has(h.why)) { seenWhy.add(h.why); reasons.push(h.why); }
      }

      // direct theme overlap, counted from the card's own text
      const x = cardText(card, a);
      let themeHits = 0;
      for (const def of topThemes) {
        let hit = false;
        try { hit = !!def.t(card, a, x); } catch (e) {}
        if (hit) { themeHits++; score += 1.1; }
      }
      if (themeHits >= 2) reasons.push('hits several of your themes at once');

      // curve fit
      const mv = Math.min(8, Math.floor(card.cmc || 0));
      // (a land is no drop on the curve)
      if (curveNeed[mv] > 0 && !/\bLand\b/.test(card.type_line || '')) { score += 0.6; reasons.push(`fills out your ${mv}-drop slot`); }
      if (mv >= 7 && prof.strategy === 'aggro') score -= 1.2;

      // the engine can run it, which matters at this table
      if (a.autoCoverage >= 0.999) score += 0.35;

      // which role it would fill
      let role = null;
      for (const r of ROLES) {
        let hit = false;
        try { hit = !!r.t(card, a, x); } catch (e) {}
        if (hit) { const g = prof.gaps.find(g2 => g2.id === r.id); if (g && g.diff > 0) { role = r.id; break; } if (!role) role = r.id; }
      }

      scored.push({ card, score, role, reasons: U.uniq(reasons).slice(0, 3), rank: entry.bestRank });
    }
    scored.sort((a, b) => b.score - a.score);

    /* --- 4. combo completions --- */
    const comboCompletions = opts.combos ? await completions(opts.combos, prof, owned, legalKey) : [];

    /* --- 5. cuts, paired one-for-one with the additions --- */
    const shortlist = scored.slice(0, limit);
    const cuts = suggestCuts(deck, prof, Math.max(opts.overBy || 0, shortlist.length + comboCompletions.length));
    pairCuts(shortlist, comboCompletions, cuts, prof);

    return {
      profile: prof,
      gaps: prof.gaps,
      cards: shortlist,
      cuts,
      comboCompletions,
      queriesRun: queries.length,
      /* where the advice came from, so the panel can say so rather than
         quietly looking thinner when EDHREC is unreachable */
      // hybrid: Recommander's and EDHREC's blended; missing: the one asked for that did not answer
      sources: { engine: !hybridUsed && !recommanderUsed, edhrec: edhrecUsed || hybridUsed, recommander: recommanderUsed || hybridUsed,
        hybrid: hybridUsed, missing, from },
    };
  }

  function curveGaps(prof) {
    const curve = prof.stats.curve || {};
    const nonland = Math.max(1, prof.stats.nonland);
    // a rough healthy shape for a midrange list
    const ideal = { 0: .02, 1: .10, 2: .20, 3: .20, 4: .16, 5: .12, 6: .08, 7: .06, 8: .06 };
    const need = {};
    for (let i = 0; i <= 8; i++) need[i] = Math.round(ideal[i] * nonland) - (curve[i] || 0);
    return need;
  }

  /** Turn near-miss combos into "add this one card" suggestions. */
  async function completions(comboResult, prof, owned, legalKey) {
    const near = (comboResult.near || []).filter(c => c.missing && c.missing.length === 1);
    if (!near.length) return [];
    const names = U.uniq(near.map(c => c.missing[0]));
    let cards = [];
    try {
      const r = await MTG.scry.collection(names.map(n => ({ name: n })));
      cards = r.cards;
    } catch (e) { return []; }
    const byName = new Map();
    names.forEach((n, i) => { if (cards[i]) byName.set(U.normName(n), cards[i]); });

    const out = [];
    const seen = new Set();
    for (const combo of near) {
      const card = byName.get(U.normName(combo.missing[0]));
      if (!card) continue;
      if (owned.has(U.normName(U.frontName(card.name)))) continue;
      if (seen.has(card.id)) continue;
      if (legalKey && (card.legalities || {})[legalKey] !== 'legal') continue;
      if (prof.colors.length < 5 && (card.color_identity || []).some(c => !prof.colors.includes(c))) continue;
      seen.add(card.id);
      out.push({
        card, combo,
        with: combo.pieces.filter(p => U.normName(p) !== U.normName(card.name)),
        produces: combo.produces[0] || 'a combo',
        kind: combo.kind,
      });
    }
    return out.slice(0, 12);
  }

  /**
   * Give each suggested addition the card it should replace.
   * A cut is preferred when it does the same job as the addition (so the
   * balance does not move), and otherwise the next-weakest card is used.
   * Nothing is paired twice, and lands are only cut for other lands.
   */
  function pairCuts(additions, completions, cuts, prof) {
    const used = new Set();
    const isLand = (c) => { const a = O.analyze(c); return a && a.isLand; };
    const roleOf = (card) => {
      const a = O.analyze(card);
      if (!a) return null;
      const x = cardText(card, a);
      for (const r of ROLES) { try { if (r.t(card, a, x)) return r.id; } catch (e) {} }
      return null;
    };
    const take = (addition) => {
      const wantLand = isLand(addition);
      const addRole = roleOf(addition);
      // 1. a cut doing the same job, 2. a cut in an over-served role,
      // 3. simply the weakest thing left
      const overRoles = new Set(prof.gaps.filter(g => g.severity === 'over').map(g => g.id));
      const pick = (test) => cuts.find(c => !used.has(c.card.id) && isLand(c.card) === wantLand && test(c));
      const chosen = pick(c => roleOf(c.card) === addRole)
        || pick(c => overRoles.has(roleOf(c.card)))
        || pick(() => true);
      if (chosen) { used.add(chosen.card.id); return chosen; }
      return null;
    };
    for (const cc of (completions || [])) cc.cutFor = take(cc.card);
    for (const s of additions) s.cutFor = take(s.card);
  }

  /** What to take out, either to hit the deck size or to tighten the theme. */
  function suggestCuts(deck, prof, overBy) {
    const want = Math.max(overBy, 8);
    const landGap = (prof.gaps.find(g => g.id === 'land') || {});
    const landsToSpare = Math.max(0, (landGap.have || 0) - (landGap.want || 0));
    let landsCut = 0;
    const topThemes = prof.themes.slice(0, 4).map(t => THEMES.find(d => d.id === t.id)).filter(Boolean);
    const tribeRe = prof.tribe ? new RegExp('\\b' + prof.tribe + 's?\\b') : null;
    const scored = [];
    for (const e of deck.main) {
      const card = e.card;
      const a = O.analyze(card);
      if (!a) continue;
      // only offer lands as cuts while the deck has more than it needs
      if (a.isLand) {
        if (landsCut >= landsToSpare) continue;
        landsCut++;
        scored.push({ card, keep: -5 + landsCut * 0.01, reasons: ['you are running more lands than this curve needs'] });
        continue;
      }
      const x = cardText(card, a);
      let keep = 0;
      const reasons = [];
      let themeHits = 0;
      for (const def of topThemes) {
        let hit = false;
        try { hit = !!def.t(card, a, x); } catch (e2) {}
        if (hit) themeHits++;
      }
      keep += themeHits * 1.4;
      if (tribeRe) {
        if (a.subtypes.includes(prof.tribe)) keep += 1.6;
        else if (tribeRe.test(x)) keep += 1.2;
      }
      for (const r of ROLES) {
        let hit = false;
        try { hit = !!r.t(card, a, x); } catch (e2) {}
        if (!hit) continue;
        const g = prof.gaps.find(g2 => g2.id === r.id);
        if (g && g.diff > 0) keep += 1.2;
        else if (g && g.severity === 'over') keep -= 0.5;
        else keep += 0.4;
      }
      // play rate as a proxy for raw power
      if (card.edhrec_rank) keep += U.clamp((30000 - card.edhrec_rank) / 15000, -1.2, 1.6);
      // expensive cards with nothing behind them
      if ((card.cmc || 0) >= 6 && themeHits === 0) { keep -= 1.4; reasons.push('expensive and off-plan'); }
      if (themeHits === 0) reasons.push("doesn't support the deck's plan");
      if (!a.isPermanent && !/draw|destroy|exile|counter|damage|search/i.test(x)) { keep -= 0.6; reasons.push('low impact'); }
      if (a.autoCoverage < 0.4) reasons.push('resolves by hand at this table');
      scored.push({ card, keep, reasons: U.uniq(reasons).slice(0, 2) });
    }
    scored.sort((a, b) => a.keep - b.keep);
    return scored.slice(0, want).filter(c => c.reasons.length);
  }

  /** Apply a suggested swap to a deck object in place. */
  function applySwap(deck, addCard, cutCard) {
    if (cutCard) {
      const i = deck.main.findIndex(e => e.card.id === cutCard.id);
      if (i >= 0) { deck.main[i].qty--; if (deck.main[i].qty <= 0) deck.main.splice(i, 1); }
    }
    if (addCard) {
      const e = deck.main.find(x => x.card.id === addCard.id);
      if (e) e.qty++; else deck.main.push({ card: addCard, qty: 1 });
    }
    return deck;
  }

  MTG.advisor = {
    edhrecFor, edhrecSlug, readEdhrec, blend,
    profile, recommend, suggestCuts, pairCuts, applySwap,
    THEMES, ROLES, targetsFor, colorLabel,
  };
})(window.MTG);


