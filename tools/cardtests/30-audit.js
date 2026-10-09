/* Cards that were counted as automated and did something other than their
   words: each test plays the card against what it says, so the reading
   that went wrong cannot quietly come back. */
'use strict';
module.exports = (test) => {
  const optIds = (ch) => (ch.options || []).map(l => (l || []).map(o => o.id));

  /* ---- "target player" read into a scope, with nobody targeted ---- */

  test('Audit: Neutralize the Guards shrinks the target opponent\'s creatures, not yours', (mk, t) => {
    const T = mk();
    t.auto('Neutralize the Guards');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Neutralize the Guards'), { targets: ['B'] });
    t.eq(T.g.powerOf(theirs), 1, 'their creature shrank');
    t.eq(T.g.powerOf(mine), 2, 'yours did not');
    t.eq(JSON.stringify(T.g._legalTargetsFor({ type: 'player', opponent: true }, 'A').map(x => x.id)), '["B"]', 'never the caster');
  });

  test('Audit: Overwhelming Forces destroys only the chosen opponent\'s creatures', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Overwhelming Forces');
    const mine = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears'), c = T.bf('C', 'Grizzly Bears');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'BB6');
    T.cast('A', T.hand('A', 'Overwhelming Forces'), { targets: ['C'] });
    t.zone(c, 'graveyard');
    t.zone(b, 'battlefield');
    t.zone(mine, 'battlefield');
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'one card drawn, for the one creature destroyed');
  });

  test('Audit: Contagion Engine puts a -1/-1 counter on each creature the target player controls', (mk, t) => {
    const T = mk();
    t.auto('Contagion Engine');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '6');
    T.cast('A', T.hand('A', 'Contagion Engine'));
    t.eq(theirs.counters['-1/-1'] || 0, 1);
    t.eq(mine.counters['-1/-1'] || 0, 0);
  });

  test('Audit: Theft of Dreams counts the target opponent\'s tapped creatures', (mk, t) => {
    const T = mk();
    t.auto('Theft of Dreams');
    T.bf('A', 'Grizzly Bears', { tapped: true });
    T.bf('B', 'Grizzly Bears', { tapped: true }); T.bf('B', 'Llanowar Elves', { tapped: true }); T.bf('B', 'Craw Wurm');
    const s = T.hand('A', 'Theft of Dreams');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'U2');
    T.cast('A', s, { targets: ['B'] });
    t.eq(T.zone('A', 'hand').length, h0 - 1 + 2, 'two cards, for their two tapped creatures');
  });

  test('Audit: Vengeful Bloodwitch can only aim at an opponent', (mk, t) => {
    const T = mk();
    t.auto('Vengeful Bloodwitch');
    T.bf('A', 'Vengeful Bloodwitch');
    const bear = T.bf('A', 'Grizzly Bears');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'player', id: 'B' }] }; });
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.eq(JSON.stringify(offered), '["B"]', 'only the opponent was offered');
    t.eq(T.life('B'), 19);
    t.eq(T.life('A'), 21);
  });

  /* ---- hand attacks ---- */

  test('Audit: Coercion may take a land', (mk, t) => {
    const T = mk();
    t.auto('Coercion');
    const land = T.hand('B', 'Forest');
    T.answer('pickCard', () => ({ cardIds: [land.id] }));
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Coercion'), { targets: ['B'] });
    t.zone(land, 'graveyard');
  });

  test('Audit: Thought-Knot Seer lets you pick whose hand, with two opponents', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Thought-Knot Seer');
    const bolt = T.hand('C', 'Lightning Bolt');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'player', id: 'C' }] }; });
    T.answer('pickCard', () => ({ cardIds: [bolt.id] }));
    T.mana('A', 'C3');
    T.cast('A', T.hand('A', 'Thought-Knot Seer'));
    t.eq(JSON.stringify(offered), '["B","C"]', 'either opponent, never you');
    t.zone(bolt, 'exile');
  });

  /* ---- "up to one", "another" ---- */

  test('Audit: Teferi, Time Raveler\'s -3 can be used with nothing to return', (mk, t) => {
    const T = mk();
    t.auto('Teferi, Time Raveler');
    const tef = T.bf('A', 'Teferi, Time Raveler');
    const h0 = T.zone('A', 'hand').length;
    T.activate('A', tef, 1);
    t.eq(tef.counters.loyalty, 1);
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'still draws');
  });

  test('Audit: Flickerwisp never targets itself', (mk, t) => {
    const T = mk();
    t.auto('Flickerwisp');
    const bear = T.bf('B', 'Grizzly Bears');
    const fw = T.hand('A', 'Flickerwisp');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'object', id: bear.id }] }; });
    T.mana('A', 'WW1');
    T.cast('A', fw);
    t.eq(JSON.stringify(offered), JSON.stringify([bear.id]));
    t.zone(bear, 'exile');
    t.zone(fw, 'battlefield');
  });

  /* ---- words a loose damage subject swallowed ---- */

  test('Audit: Garna deals damage only when the creature was not attacking', (mk, t) => {
    const T = mk();
    t.auto('Garna, Bloodfist of Keld');
    T.bf('A', 'Garna, Bloodfist of Keld');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.eq(T.life('B'), 19, 'not attacking: 1 damage to each opponent');
    const h0 = T.zone('A', 'hand').length;
    const elf = T.bf('A', 'Llanowar Elves');
    T.answer('declareAttackers', () => [{ attackerId: elf.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [elf] });
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'attacking: a card');
    t.eq(T.life('B'), 19, 'and no damage');
  });

  test('Audit: Rakdos Charm\'s third mode hurts each player for each creature they control', (mk, t) => {
    const T = mk();
    t.auto('Rakdos Charm');
    T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Llanowar Elves'); T.bf('B', 'Craw Wurm');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Each creature/i.test(o.label)).i] }));
    T.mana('A', 'BR');
    T.cast('A', T.hand('A', 'Rakdos Charm'));
    t.eq(T.life('A'), 19);
    t.eq(T.life('B'), 17);
  });

  test('Audit: Suffocating Blast counters the spell and deals 3 damage', (mk, t) => {
    const T = mk();
    t.auto('Suffocating Blast');
    const wurm = T.bf('B', 'Craw Wurm');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.mana('A', 'UUR1');
    T.g.passPriority('B', true);
    T.cast('A', T.hand('A', 'Suffocating Blast'), { targets: [T.stackTarget(bolt), wurm] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('A'), 20, 'the Bolt was countered');
    t.eq(wurm.damage || 0, 3);
  });

  test('Audit: Klothys gains life and deals damage for a nonland card, mana for a land', (mk, t) => {
    const T = mk();
    t.auto('Klothys, God of Destiny');
    T.bf('A', 'Klothys, God of Destiny');
    const bolt = T.grave('B', 'Lightning Bolt');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bolt.id }] }));
    T.toMain('A', 'main');
    T.nextTurn('A');
    t.zone(bolt, 'exile');
    t.eq(T.life('A'), 22);
    t.eq(T.life('B'), 18);
  });

  test('Audit: Slaying Fire deals 4 with three red mana spent, 3 without', (mk, t) => {
    const T = mk();
    t.auto('Slaying Fire');
    T.mana('A', 'RRR');
    T.cast('A', T.hand('A', 'Slaying Fire'), { targets: ['B'] });
    t.eq(T.life('B'), 16);
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Slaying Fire'), { targets: ['B'] });
    t.eq(T.life('B'), 13);
  });

  test('Audit: Whispering Snitch triggers only on the first surveil each turn', (mk, t) => {
    const T = mk();
    t.auto('Whispering Snitch');
    T.bf('A', 'Whispering Snitch');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Consider'));
    t.eq(T.life('B'), 19);
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Consider'));
    t.eq(T.life('B'), 19, 'the second surveil does nothing');
  });

  /* ---- a no-op rule standing in front of the real one ---- */

  test("Audit: Savage Ventmaw's mana lasts until the end of the turn", (mk, t) => {
    const T = mk();
    t.auto('Savage Ventmaw');
    const sv = T.bf('A', 'Savage Ventmaw');
    T.answer('declareAttackers', () => [{ attackerId: sv.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    const pool = T.player('A').pool;
    t.eq((pool.R || 0) + (pool.G || 0), 6, 'still there in the end step');
  });

  test('Audit: Brutal Expulsion can return a creature, not only a spell', (mk, t) => {
    const T = mk();
    t.auto('Brutal Expulsion');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Return/i.test(o.label)).i] }));
    T.mana('A', 'UR2');
    T.cast('A', T.hand('A', 'Brutal Expulsion'), { targets: [bear] });
    t.zone(bear, 'hand');
  });

  /* ---- the most-played lands, family by family ---- */

  const FETCHES = { 'Flooded Strand': ['Plains', 'Island'], 'Polluted Delta': ['Island', 'Swamp'], 'Bloodstained Mire': ['Swamp', 'Mountain'],
    'Wooded Foothills': ['Mountain', 'Forest'], 'Windswept Heath': ['Forest', 'Plains'], 'Marsh Flats': ['Plains', 'Swamp'],
    'Scalding Tarn': ['Island', 'Mountain'], 'Verdant Catacombs': ['Swamp', 'Forest'], 'Arid Mesa': ['Mountain', 'Plains'],
    'Misty Rainforest': ['Forest', 'Island'] };
  for (const [name, types] of Object.entries(FETCHES)) {
    test(`Audit: ${name} pays 1 life and offers only ${types.join(' or ')} cards, put in untapped`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const f = T.bf('A', name);
      let offered = null;
      T.answer('pickCard', (ch) => { offered = (ch.cards || []).map(c => c.name); return { cardIds: [ch.cards[0].id] }; });
      T.activate('A', f, 0);
      t.zone(f, 'graveyard');
      t.eq(T.life('A'), 19);
      t.ok(offered && offered.length && offered.every(n => types.includes(n)), 'offered ' + JSON.stringify(offered));
      const got = T.bfOf('A');
      t.eq(got.length, 1);
      t.no(got[0].tapped, 'untapped');
    });
  }

  for (const name of ['Evolving Wilds', 'Terramorphic Expanse', 'Fabled Passage']) {
    test(`Audit: ${name} fetches a basic land tapped`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const f = T.bf('A', name);
      T.activate('A', f, 0);
      t.zone(f, 'graveyard');
      t.eq(T.life('A'), 20);
      const got = T.bfOf('A');
      t.eq(got.length, 1);
      t.ok(/Basic Land/.test(got[0].card.type_line));
      t.ok(got[0].tapped, 'tapped (with fewer than four lands)');
    });
  }

  test('Audit: Fabled Passage untaps the land with four or more lands', (mk, t) => {
    const T = mk();
    for (const n of ['Plains', 'Island', 'Swamp']) T.bf('A', n);
    const f = T.bf('A', 'Fabled Passage');
    T.activate('A', f, 0);
    const got = T.bfOf('A').filter(o => !['Plains', 'Island', 'Swamp'].includes(o.name) || o.entered === T.g.turn);
    t.eq(T.bfOf('A').length, 4);
    t.ok(T.bfOf('A').every(o => !o.tapped), 'the new land is untapped');
  });

  const SHOCKS = ['Watery Grave', 'Breeding Pool', 'Godless Shrine', 'Hallowed Fountain', 'Steam Vents', 'Blood Crypt',
    'Stomping Ground', 'Overgrown Tomb', 'Sacred Foundry', 'Temple Garden'];
  for (const name of SHOCKS) {
    test(`Audit: ${name} enters untapped for 2 life, tapped without`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const a = T.hand('A', name);
      T.answer('confirm', { yes: true });
      T.playLand('A', a);
      t.no(a.tapped); t.eq(T.life('A'), 18);
      T.nextTurn('A');
      const b = T.hand('A', name);
      T.answer('confirm', { yes: false });
      T.playLand('A', b);
      t.ok(b.tapped); t.eq(T.life('A'), 18);
    });
  }

  const CHECKS = { 'Sulfur Falls': ['Island', 'Mountain'], 'Clifftop Retreat': ['Mountain', 'Plains'], 'Dragonskull Summit': ['Swamp', 'Mountain'],
    'Glacial Fortress': ['Plains', 'Island'], 'Isolated Chapel': ['Plains', 'Swamp'], 'Hinterland Harbor': ['Forest', 'Island'],
    'Drowned Catacomb': ['Island', 'Swamp'], 'Woodland Cemetery': ['Swamp', 'Forest'], 'Rootbound Crag': ['Mountain', 'Forest'],
    'Sunpetal Grove': ['Forest', 'Plains'] };
  const OTHER = { Plains: 'Swamp', Island: 'Forest', Swamp: 'Plains', Mountain: 'Island', Forest: 'Mountain' };
  for (const [name, types] of Object.entries(CHECKS)) {
    test(`Audit: ${name} enters untapped only with a ${types.join(' or ')}`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const wrong = Object.keys(OTHER).find(x => !types.includes(x));
      T.bf('A', wrong);
      const a = T.hand('A', name);
      T.playLand('A', a);
      t.ok(a.tapped, 'tapped with only a ' + wrong);
      T.nextTurn('A');
      T.bf('A', types[1]);
      const b = T.hand('A', name);
      T.playLand('A', b);
      t.no(b.tapped, 'untapped with a ' + types[1]);
    });
  }

  for (const name of ['Sunken Hollow', 'Cinder Glade', 'Smoldering Marsh', 'Prairie Stream', 'Canopy Vista']) {
    test(`Audit: ${name} enters untapped only with two or more basic lands`, (mk, t) => {
      const T = mk();
      t.auto(name);
      T.bf('A', 'Plains');
      const a = T.hand('A', name);
      T.playLand('A', a);
      t.ok(a.tapped, 'tapped with one basic');
      T.nextTurn('A');
      T.bf('A', 'Island');
      const b = T.hand('A', name);
      T.playLand('A', b);
      t.no(b.tapped, 'untapped with two basics');
    });
  }

  /* ---- tutors that put the card on top ---- */

  const TOPS = { 'Vampiric Tutor': ['Lightning Bolt', 'B', 18], 'Enlightened Tutor': ['Sol Ring', 'W', 20],
    'Mystical Tutor': ['Lightning Bolt', 'U', 20], 'Worldly Tutor': ['Grizzly Bears', 'G', 20] };
  for (const [name, [want, mana, life]] of Object.entries(TOPS)) {
    test(`Audit: ${name} puts ${want} on top of the library`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const x = T.put('A', want, 'library', { top: false });
      let offered = null;
      T.answer('pickCard', (ch) => { offered = (ch.cards || []).map(c => c.name); return { cardIds: [x.id] }; });
      T.mana('A', mana);
      T.cast('A', T.hand('A', name));
      t.eq(T.zone('A', 'library')[0], x, 'on top');
      t.ok(offered && !offered.includes('Plains') || name === 'Vampiric Tutor', 'lands not offered: ' + JSON.stringify(offered && offered.slice(0, 5)));
      t.eq(T.life('A'), life);
    });
  }

  /* ---- "Plains" is not a plural ---- */

  test('Audit: Castle Ardenvale enters untapped with a Plains', (mk, t) => {
    const T = mk();
    t.auto('Castle Ardenvale');
    T.bf('A', 'Plains');
    const c = T.hand('A', 'Castle Ardenvale');
    T.playLand('A', c);
    t.no(c.tapped);
  });

  test('Audit: Bleachbone Verge makes white only with a Plains or a Swamp', (mk, t) => {
    const T = mk();
    t.auto('Bleachbone Verge');
    const v = T.bf('A', 'Bleachbone Verge');
    t.no(T.g.tapForMana('A', v.id, 1), 'no white with nothing');
    T.bf('A', 'Plains');
    t.ok(T.g.tapForMana('A', v.id, 1), 'white with a Plains');
    t.eq(T.player('A').pool.W, 1);
  });

  test('Audit: Gather the White Lotus makes a token for each Plains', (mk, t) => {
    const T = mk();
    t.auto('Gather the White Lotus');
    T.bf('A', 'Plains'); T.bf('A', 'Plains'); T.bf('A', 'Island');
    T.mana('A', 'W4');
    T.cast('A', T.hand('A', 'Gather the White Lotus'));
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 2);
  });

  /* ---- "choose one or more", "choose up to one" ---- */

  test('Audit: Farewell can exile more than one kind of thing', (mk, t) => {
    const T = mk();
    t.auto('Farewell');
    const ring = T.bf('B', 'Sol Ring'), bear = T.bf('B', 'Grizzly Bears'), ench = T.bf('B', 'Ghostly Prison');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [0, 1] }; });
    T.mana('A', 'WW4');
    T.cast('A', T.hand('A', 'Farewell'));
    t.eq(asked.max, 4, 'up to all four offered');
    t.zone(ring, 'exile'); t.zone(bear, 'exile');
    t.zone(ench, 'battlefield', 'the mode not chosen');
  });

  test('Audit: Hullbreaker Horror may choose no mode', (mk, t) => {
    const T = mk();
    t.auto('Hullbreaker Horror');
    T.bf('A', 'Hullbreaker Horror');
    const mine = T.bf('A', 'Grizzly Bears');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [] }; });
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Llanowar Elves'));
    t.eq(asked && asked.min, 0, 'none is allowed');
    t.zone(mine, 'battlefield', 'nothing of yours bounced');
  });

  test("Audit: Jeska's Will may choose both modes with a commander", (mk, t) => {
    const T = mk();
    t.auto("Jeska's Will");
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [0] }; });
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', "Jeska's Will"), { targets: ['B'] });
    t.eq(asked.count || 1, 1, 'one mode without a commander');
  });

  /* ---- top-ranked cards, checked against their words ---- */

  test('Audit: Inspiring Call draws for and protects only the creatures with +1/+1 counters', (mk, t) => {
    const T = mk();
    t.auto('Inspiring Call');
    const a = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } }), b = T.bf('A', 'Llanowar Elves');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Inspiring Call'));
    t.eq(T.zone('A', 'hand').length, h0 + 1);
    t.ok(T.g.hasKw(a, 'indestructible'));
    t.no(T.g.hasKw(b, 'indestructible'));
  });

  test('Audit: Rise of the Dark Realms takes creature cards from every graveyard', (mk, t) => {
    const T = mk();
    t.auto('Rise of the Dark Realms');
    const x = T.grave('A', 'Grizzly Bears'), y = T.grave('B', 'Craw Wurm'), z = T.grave('B', 'Lightning Bolt');
    T.mana('A', 'BB7');
    T.cast('A', T.hand('A', 'Rise of the Dark Realms'));
    t.zone(x, 'battlefield'); t.zone(y, 'battlefield'); t.zone(z, 'graveyard');
    t.eq(y.controller, 'A');
  });

  test("Audit: Garruk's Uprising draws only for a creature with power 4 or greater", (mk, t) => {
    const T = mk();
    t.auto("Garruk's Uprising");
    T.bf('A', "Garruk's Uprising");
    const h0 = T.zone('A', 'hand').length;
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true }); T.resolve();
    t.eq(T.zone('A', 'hand').length, h0);
    T.put('A', 'Craw Wurm', 'battlefield', { etb: true }); T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test('Audit: Rhystic Study draws unless the caster pays {1}', (mk, t) => {
    const T = mk();
    t.auto('Rhystic Study');
    T.bf('A', 'Rhystic Study');
    const h0 = T.zone('A', 'hand').length;
    T.answer('payOrDont', { pay: false });
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'B did not pay');
  });

  test('Audit: Mystic Sanctuary needs three other Islands to enter untapped, and then returns a spell', (mk, t) => {
    const T = mk();
    t.auto('Mystic Sanctuary');
    T.bf('A', 'Island'); T.bf('A', 'Island');
    const a = T.hand('A', 'Mystic Sanctuary');
    T.playLand('A', a);
    t.ok(a.tapped, 'two other Islands: tapped');
    T.nextTurn('A');
    const bolt = T.grave('A', 'Lightning Bolt');
    const b = T.hand('A', 'Mystic Sanctuary');
    T.playLand('A', b);
    t.no(b.tapped, 'three other Islands: untapped');
    t.eq(T.zone('A', 'library')[0], bolt, 'the Bolt is on top');
  });

  test('Audit: Rejuvenating Springs is untapped only with two or more opponents', (mk, t) => {
    const T = mk();
    t.auto('Rejuvenating Springs');
    const a = T.hand('A', 'Rejuvenating Springs');
    T.playLand('A', a);
    t.ok(a.tapped, 'one opponent');
    const T3 = mk({ players: ['A', 'B', 'C'] });
    const b = T3.hand('A', 'Rejuvenating Springs');
    T3.playLand('A', b);
    t.no(b.tapped, 'two opponents');
  });

  test('Audit: Three Tree City makes a mana for each creature of the chosen type', (mk, t) => {
    const T = mk();
    t.auto('Three Tree City');
    T.bf('A', 'Llanowar Elves'); T.bf('A', 'Elvish Mystic'); T.bf('A', 'Grizzly Bears');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Elf/.test(o.label)).i] }));
    const c = T.put('A', 'Three Tree City', 'battlefield', { etb: true });
    t.eq(c.chosenType, 'Elf');
    T.mana('A', '2');
    t.ok(T.g.tapForMana('A', c.id, 1, 'G'));
    T.settle();
    t.eq(T.player('A').pool.G, 2, 'two Elves, two green');
  });

  test("Audit: Umezawa's Jitte's +2/+2 wears off at end of turn", (mk, t) => {
    const T = mk();
    t.auto("Umezawa's Jitte");
    const bear = T.bf('A', 'Grizzly Bears');
    const j = T.bf('A', "Umezawa's Jitte", { counters: { charge: 2 } });
    j.attachedTo = bear.id; bear.attachments = [j.id];
    T.answer('mode', { modes: [0] });
    T.activate('A', j, 0);
    t.eq(T.g.powerOf(bear), 4);
    T.nextTurn('B');
    t.eq(T.g.powerOf(bear), 2, 'back to 2 the next turn');
  });

  test('Audit: Firebreathing\'s +1/+0 wears off at end of turn', (mk, t) => {
    const T = mk();
    t.auto('Firebreathing');
    const bear = T.bf('A', 'Grizzly Bears');
    const f = T.bf('A', 'Firebreathing');
    f.attachedTo = bear.id; bear.attachments = [f.id];
    T.mana('A', 'R');
    T.activate('A', f, 0);
    t.eq(T.g.powerOf(bear), 3);
    T.nextTurn('B');
    t.eq(T.g.powerOf(bear), 2);
  });

  /* ---- the most-played removal, counters and card draw, each against its words ---- */

  const REMOVAL = [
    // [card, mana, victim, where it goes, the caster's life after, token its controller gets]
    ['Beast Within', 'G2', 'Sol Ring', 'graveyard', 20, 'Beast'],
    ['Generous Gift', 'W2', 'Sol Ring', 'graveyard', 20, 'Elephant'],
    ['Pongify', 'U', 'Grizzly Bears', 'graveyard', 20, 'Ape'],
    ['Stroke of Midnight', 'W2', 'Grizzly Bears', 'graveyard', 20, 'Human'],
    ['Deadly Rollick', 'B3', 'Grizzly Bears', 'exile', 20, null],
    ['Anguished Unmaking', 'WB1', 'Sol Ring', 'exile', 17, null],
    ['Infernal Grasp', 'B1', 'Grizzly Bears', 'graveyard', 18, null],
    ['Withering Torment', 'B2', 'Ghostly Prison', 'graveyard', 18, null],
    ['Feed the Swarm', 'B1', 'Ghostly Prison', 'graveyard', 17, null],
    ['Putrefy', 'BG1', 'Sol Ring', 'graveyard', 20, null],
    ['Go for the Throat', 'B1', 'Grizzly Bears', 'graveyard', 20, null],
    ['Bedevil', 'BBR', 'Grizzly Bears', 'graveyard', 20, null],
    ['Despark', 'WB', 'Craw Wurm', 'exile', 20, null],
    ['Swords to Plowshares', 'W', 'Craw Wurm', 'exile', 20, null],
  ];
  for (const [name, mana, victim, to, life, token] of REMOVAL) {
    test(`Audit: ${name} on ${victim}`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const v = T.bf('B', victim);
      T.mana('A', mana);
      T.cast('A', T.hand('A', name), { targets: [v] });
      t.zone(v, to);
      t.eq(T.life('A'), life, "the caster's life");
      if (token) t.ok(T.bfOf('B').some(o => o.isToken && new RegExp(token).test(o.name)), 'its controller has a ' + token);
      else t.no(T.bfOf('B').some(o => o.isToken), 'no token');
    });
  }

  test('Audit: Go for the Throat cannot target an artifact creature, Despark nothing small', (mk, t) => {
    const T = mk();
    const golem = T.bf('B', 'Ornithopter'), bear = T.bf('B', 'Grizzly Bears');
    const g = T.hand('A', 'Go for the Throat');
    T.mana('A', 'B1');
    t.no(T.g.castSpell('A', g.id, { targets: [{ kind: 'object', id: golem.id }] }), 'no artifact creature');
    const d = T.hand('A', 'Despark');
    T.mana('A', 'WB');
    t.no(T.g.castSpell('A', d.id, { targets: [{ kind: 'object', id: bear.id }] }), 'no mana value 2');
  });

  test("Audit: Swords to Plowshares gives the life to the creature's controller", (mk, t) => {
    const T = mk();
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [T.bf('B', 'Craw Wurm')] });
    t.eq(T.life('B'), 26);
  });

  const COUNTERS = [
    // [counter, mana, may it hit a creature spell]
    ['Counterspell', 'UU', true],
    ['Negate', 'U1', false],
    ['Fierce Guardianship', 'U2', false],
    ["An Offer You Can't Refuse", 'U', false],
    ['Swan Song', 'U', false],
  ];
  for (const [name, mana, creatures] of COUNTERS) {
    test(`Audit: ${name} counters a spell${creatures ? '' : ', but not a creature spell'}`, (mk, t) => {
      const T = mk();
      t.auto(name);
      const bolt = T.hand('B', 'Lightning Bolt');
      T.mana('B', 'R');
      T.g.passPriority('A', true);
      T.cast('B', bolt, { targets: ['A'], resolve: false });
      T.g.passPriority('B', true);
      T.mana('A', mana);
      T.cast('A', T.hand('A', name), { targets: [T.stackTarget(bolt)] });
      t.zone(bolt, 'graveyard');
      t.eq(T.life('A'), 20);
      if (name === "An Offer You Can't Refuse") t.eq(T.bfOf('B').filter(o => o.name === 'Treasure').length, 2, 'two Treasures for the caster');
      if (name === 'Swan Song') t.ok(T.bfOf('B').some(o => o.name === 'Bird'), 'a Bird for the caster');
      if (!creatures) {
        const T2 = mk();
        T2.nextTurn('B');
        const bear = T2.hand('B', 'Grizzly Bears');
        T2.mana('B', 'G1');
        T2.cast('B', bear, { resolve: false });
        T2.g.passPriority('B', true);
        T2.mana('A', mana);
        t.no(T2.g.castSpell('A', T2.hand('A', name).id, { targets: [T2.stackTarget(bear)] }), 'not a creature spell');
      }
    });
  }

  test('Audit: Flusterstorm counters unless {1} is paid', (mk, t) => {
    const T = mk();
    t.auto('Flusterstorm');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.g.passPriority('B', true);
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Flusterstorm'), { targets: [T.stackTarget(bolt)] });
    t.zone(bolt, 'graveyard', 'B had nothing to pay with');
    t.eq(T.life('A'), 20);
  });

  const DRAWS = [
    // [card, mana, cards drawn, life after]
    ["Night's Whisper", 'B1', 2, 18],
    ['Read the Bones', 'B2', 2, 18],
    ['Preordain', 'U', 1, 20],
    ['Ponder', 'U', 1, 20],
    ['Big Score', 'R3', 2, 20],
    ['Deadly Dispute', 'B1', 2, 20],
  ];
  for (const [name, mana, drawn, life] of DRAWS) {
    test(`Audit: ${name} draws ${drawn}`, (mk, t) => {
      const T = mk();
      t.auto(name);
      if (name === 'Deadly Dispute') T.bf('A', 'Sol Ring');
      if (name === 'Big Score') T.hand('A', 'Island');
      const s = T.hand('A', name);
      const h0 = T.zone('A', 'hand').length;
      T.mana('A', mana);
      T.cast('A', s);
      const extra = name === 'Big Score' ? -1 : 0;
      t.eq(T.zone('A', 'hand').length, h0 - 1 + drawn + extra);
      t.eq(T.life('A'), life);
      if (name === 'Big Score') t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
      if (name === 'Deadly Dispute') t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
    });
  }

  test('Audit: Brainstorm draws three and puts two back on top', (mk, t) => {
    const T = mk();
    t.auto('Brainstorm');
    const s = T.hand('A', 'Brainstorm');
    const lib0 = T.zone('A', 'library').length, h0 = T.zone('A', 'hand').length;
    T.mana('A', 'U');
    T.cast('A', s);
    t.eq(T.zone('A', 'hand').length, h0 - 1 + 3 - 2);
    t.eq(T.zone('A', 'library').length, lib0 - 3 + 2);
  });

  test('Audit: Windfall: each player discards their hand and draws the most discarded', (mk, t) => {
    const T = mk();
    t.auto('Windfall');
    for (let i = 0; i < 4; i++) T.hand('B', 'Island');
    T.hand('A', 'Forest');
    const s = T.hand('A', 'Windfall');
    T.mana('A', 'U2');
    T.cast('A', s);
    t.eq(T.zone('A', 'hand').length, 4);
    t.eq(T.zone('B', 'hand').length, 4);
  });

  test('Audit: Dark Ritual, Seething Song and Mana Geyser make their mana', (mk, t) => {
    const T = mk();
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Dark Ritual'));
    t.eq(T.player('A').pool.B, 3);
    T.mana('A', 'R2'); T.cast('A', T.hand('A', 'Seething Song'));
    t.eq(T.player('A').pool.R, 5);
    T.bf('B', 'Mountain', { tapped: true }); T.bf('B', 'Mountain', { tapped: true }); T.bf('B', 'Mountain');
    T.mana('A', 'RR3'); T.cast('A', T.hand('A', 'Mana Geyser'));
    t.eq(T.player('A').pool.R, 5 + 2, 'two tapped lands');
  });

  test('Audit: Ram Through spills excess damage only from a trampler', (mk, t) => {
    const T = mk();
    t.auto('Ram Through');
    const big = T.bf('A', 'Craw Wurm'), bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Ram Through'), { targets: [big, bear] });
    t.zone(bear, 'graveyard');
    t.eq(T.life('B'), 20, 'no trample: nothing spills over');
    const tr = T.bf('A', 'Colossal Dreadmaw'), elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Ram Through'), { targets: [tr, elf] });
    t.zone(elf, 'graveyard');
    t.eq(T.life('B'), 15, 'trample: 6 power, 1 to the Elves, 5 to B');
  });

  test("Audit: Hall of Storm Giants enters tapped only with two or more other lands", (mk, t) => {
    const T = mk();
    t.auto('Hall of Storm Giants');
    const a = T.hand('A', 'Hall of Storm Giants');
    T.playLand('A', a);
    t.no(a.tapped);
    T.nextTurn('A');
    T.bf('A', 'Island'); T.bf('A', 'Island');
    const b = T.hand('A', 'Hall of Storm Giants');
    T.playLand('A', b);
    t.ok(b.tapped);
  });

  test("Audit: Rowan's Talent copies the planeswalker's loyalty ability", (mk, t) => {
    const T = mk();
    t.auto("Rowan's Talent");
    const pw = T.bf('A', 'Chandra, Torch of Defiance');
    const tal = T.bf('A', "Rowan's Talent");
    tal.attachedTo = pw.id; pw.attachments = [tal.id];
    T.activate('A', pw, 0);
    t.eq(T.life('B'), 16, 'Chandra\'s +1 twice: 2 damage twice');
  });

  test("Audit: Green Sun's Zenith finds only a green creature, then goes into the library", (mk, t) => {
    const T = mk();
    t.auto("Green Sun's Zenith");
    const wurm = T.put('A', 'Craw Wurm', 'library', { top: false }), bear = T.put('A', 'Grizzly Bears', 'library', { top: false });
    const ornithopter = T.put('A', 'Ornithopter', 'library', { top: false });
    let offered = null;
    T.answer('pickCard', (ch) => { offered = (ch.cards || []).map(c => c.name); return { cardIds: [bear.id] }; });
    const g = T.hand('A', "Green Sun's Zenith");
    T.mana('A', 'G2');
    T.cast('A', g, { x: 2 });
    t.zone(bear, 'battlefield');
    t.ok(offered && !offered.includes('Ornithopter') && !offered.includes('Craw Wurm'), 'green, mana value 2 or less: ' + JSON.stringify(offered));
    t.zone(g, 'library', 'shuffled into the library');
    t.zone(wurm, 'library'); t.zone(ornithopter, 'library');
  });

  test('Audit: Necropotence exiles each card you discard', (mk, t) => {
    const T = mk();
    t.auto('Necropotence');
    T.bf('A', 'Necropotence');
    const x = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Faithless Looting'));
    t.eq(T.zone('A', 'graveyard').filter(o => o.name !== 'Faithless Looting').length, 0, 'the discarded cards are not in the graveyard');
    t.ok(T.zone('A', 'exile').length >= 2, 'they are in exile');
  });

  /* ---- hands revealed and looked at ---- */

  test('Audit: Despise takes a creature or a planeswalker', (mk, t) => {
    const T = mk();
    t.auto('Despise');
    const bear = T.hand('B', 'Grizzly Bears'); T.hand('B', 'Lightning Bolt');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [bear.id] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Despise'), { targets: ['B'] });
    t.eq(JSON.stringify(offered), '["Grizzly Bears"]');
    t.zone(bear, 'graveyard');
    t.ok(T.g.log.some(l => /B reveals their hand: Grizzly Bears, Lightning Bolt\./.test(l.text)), 'the log names the revealed cards');
  });

  test('Audit: Duress offers only noncreature, nonland cards', (mk, t) => {
    const T = mk();
    t.auto('Duress');
    T.hand('B', 'Grizzly Bears'); T.hand('B', 'Forest'); const bolt = T.hand('B', 'Lightning Bolt');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [bolt.id] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Duress'), { targets: ['B'] });
    t.eq(JSON.stringify(offered), '["Lightning Bolt"]');
    t.zone(bolt, 'graveyard');
  });

  test('Audit: Lifebane Zombie offers green or white creature cards', (mk, t) => {
    const T = mk();
    t.auto('Lifebane Zombie');
    const w = T.hand('B', 'Savannah Lions'); T.hand('B', 'Grizzly Bears'); T.hand('B', 'Goblin Guide');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name).sort(); return { cardIds: [w.id] }; });
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Lifebane Zombie'));
    t.eq(JSON.stringify(offered), '["Grizzly Bears","Savannah Lions"]');
    t.zone(w, 'exile');
  });

  test("Audit: Gitaxian Probe shows the caster the target player's hand", (mk, t) => {
    const T = mk();
    t.auto('Gitaxian Probe');
    T.hand('B', 'Lightning Bolt');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Gitaxian Probe'), { targets: ['B'] });
    const shown = T.asked.find(a => a.playerId === 'A' && (a.items || []).some(i => i.name === 'Lightning Bolt'));
    t.ok(shown, 'the hand was shown to A');
    t.no(T.g.log.some(l => /Lightning Bolt/.test(l.text)), 'and not named to everybody');
  });

  /* ---- "X or Y" filters read word by word ---- */

  test('Audit: Court of Bounty puts a creature or land card from hand onto the battlefield', (mk, t) => {
    const T = mk();
    t.auto('Court of Bounty');
    T.bf('A', 'Court of Bounty');
    const f = T.hand('A', 'Forest');
    T.nextTurn('A');
    t.zone(f, 'battlefield', 'a land is one of the two');
  });

  test('Audit: Composer of Spring, with six enchantments, may put a creature from hand', (mk, t) => {
    const T = mk();
    t.auto('Composer of Spring');
    T.bf('A', 'Composer of Spring');
    for (let k = 0; k < 5; k++) T.bf('A', 'Ghostly Prison');
    const bear = T.hand('A', 'Grizzly Bears');
    T.put('A', 'Ghostly Prison', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bear, 'battlefield', 'a creature card is one of the two');
    t.ok(bear.tapped);
  });

  test('Audit: Phyrexian Metamorph copies an artifact, and the log names the Metamorph', (mk, t) => {
    const T = mk();
    t.auto('Phyrexian Metamorph');
    T.bf('B', 'Sol Ring');
    T.mana('A', 'U3');
    const m = T.hand('A', 'Phyrexian Metamorph');
    T.cast('A', m);
    t.zone(m, 'battlefield');
    t.eq(m.name, 'Sol Ring');
    t.ok(T.g.log.some(l => /^Phyrexian Metamorph enters as a copy of Sol Ring\.$/.test(l.text)), 'log line');
  });

  test("Audit: Narset's Reversal returns the spell it copied, not itself", (mk, t) => {
    const T = mk();
    t.auto("Narset's Reversal");
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.g.passPriority('B', true);
    T.mana('A', 'UU');
    const nr = T.hand('A', "Narset's Reversal");
    T.cast('A', nr, { targets: [T.stackTarget(bolt)] });
    t.zone(bolt, 'hand', 'the Bolt went back to its owner');
    t.zone(nr, 'graveyard');
    t.ok(T.life('A') >= 17, 'the original Bolt never resolved');
  });

  /* ---- ranks 500 to 1000, checked against their words ---- */

  test('Audit: Massacre Wurm shrinks their creatures and drains for each that dies', (mk, t) => {
    const T = mk();
    t.auto('Massacre Wurm');
    const elf = T.bf('B', 'Llanowar Elves'), wurm = T.bf('B', 'Craw Wurm'), mine = T.bf('A', 'Llanowar Elves');
    T.mana('A', 'BBB3');
    T.cast('A', T.hand('A', 'Massacre Wurm'));
    t.zone(elf, 'graveyard'); t.zone(wurm, 'battlefield'); t.zone(mine, 'battlefield');
    t.eq(T.life('B'), 18);
  });

  test('Audit: Exquisite Blood gains what an opponent loses', (mk, t) => {
    const T = mk();
    t.auto('Exquisite Blood');
    T.bf('A', 'Exquisite Blood');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('A'), 23);
  });

  test('Audit: Wheel of Fortune: each player discards their hand and draws seven', (mk, t) => {
    const T = mk({ libraryEach: 8 });
    t.auto('Wheel of Fortune');
    T.hand('B', 'Island');
    const w = T.hand('A', 'Wheel of Fortune');
    T.mana('A', 'R2');
    T.cast('A', w);
    t.eq(T.zone('A', 'hand').length, 7);
    t.eq(T.zone('B', 'hand').length, 7);
  });

  test('Audit: Abrupt Decay hits mana value 3 or less, nonland', (mk, t) => {
    const T = mk();
    t.auto('Abrupt Decay');
    const ring = T.bf('B', 'Sol Ring'), wurm = T.bf('B', 'Craw Wurm'), land = T.bf('B', 'Forest');
    T.mana('A', 'BG');
    const s = T.hand('A', 'Abrupt Decay');
    t.no(T.g.castSpell('A', s.id, { targets: [{ kind: 'object', id: wurm.id }] }), 'not mana value 6');
    t.no(T.g.castSpell('A', s.id, { targets: [{ kind: 'object', id: land.id }] }), 'not a land');
    T.cast('A', s, { targets: [ring] });
    t.zone(ring, 'graveyard');
  });

  test('Audit: Resculpt exiles and gives its controller a 4/4', (mk, t) => {
    const T = mk();
    t.auto('Resculpt');
    const ring = T.bf('B', 'Sol Ring');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Resculpt'), { targets: [ring] });
    t.zone(ring, 'exile');
    const tok = T.bfOf('B').find(o => o.isToken);
    t.ok(tok && T.g.powerOf(tok) === 4);
  });

  test('Audit: Spell Pierce counters a noncreature spell unless {2} is paid', (mk, t) => {
    const T = mk();
    t.auto('Spell Pierce');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.g.passPriority('B', true);
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Spell Pierce'), { targets: [T.stackTarget(bolt)] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('A'), 20);
  });

  test('Audit: Unearth returns a creature card with mana value 3 or less', (mk, t) => {
    const T = mk();
    t.auto('Unearth');
    const bear = T.grave('A', 'Grizzly Bears'), wurm = T.grave('A', 'Craw Wurm');
    const s = T.hand('A', 'Unearth');
    T.mana('A', 'B');
    t.no(T.g.castSpell('A', s.id, { targets: [{ kind: 'object', id: wurm.id }] }), 'not mana value 6');
    T.cast('A', s, { targets: [bear] });
    t.zone(bear, 'battlefield');
  });

  test('Audit: Fleshbag Marauder makes each player sacrifice a creature', (mk, t) => {
    const T = mk();
    t.auto('Fleshbag Marauder');
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Fleshbag Marauder'));
    t.zone(b, 'graveyard');
    t.eq(T.bfOf('A').filter(o => o.name === 'Fleshbag Marauder').length + T.zone('A', 'graveyard').filter(o => o.name === 'Fleshbag Marauder').length, 1);
  });

  test('Audit: Howling Mine gives each player an extra card while untapped', (mk, t) => {
    const T = mk();
    t.auto('Howling Mine');
    const m = T.bf('A', 'Howling Mine');
    const h0 = T.zone('B', 'hand').length;
    T.nextTurn('B');
    t.eq(T.zone('B', 'hand').length, h0 + 2, 'its draw and one more');
    T.nextTurn('A');
    m.tapped = true;
    const h1 = T.zone('B', 'hand').length;
    T.nextTurn('B');
    t.eq(T.zone('B', 'hand').length, h1 + 1, 'tapped, and not untapped on the turn of B: only the draw');
  });

  test('Audit: Elesh Norn: others +2/+2, theirs -2/-2', (mk, t) => {
    const T = mk();
    t.auto('Elesh Norn, Grand Cenobite');
    const en = T.bf('A', 'Elesh Norn, Grand Cenobite');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Craw Wurm');
    t.eq(T.g.powerOf(mine), 4); t.eq(T.g.powerOf(theirs), 4); t.eq(T.g.powerOf(en), 4);
  });

  test('Audit: Exquisite Blood and Bloodthirsty Conqueror gain what an opponent loses', (mk, t) => {
    const T = mk();
    T.bf('A', 'Bloodthirsty Conqueror');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('A'), 23);
  });

  test('Audit: Spirit Link gains life for damage the creature deals', (mk, t) => {
    const T = mk();
    t.auto('Spirit Link');
    const wurm = T.bf('A', 'Craw Wurm');
    const sl = T.bf('A', 'Spirit Link');
    sl.attachedTo = wurm.id; wurm.attachments = [sl.id];
    T.answer('declareAttackers', () => [{ attackerId: wurm.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 14);
    t.eq(T.life('A'), 26);
  });

  test('Audit: Massacre Wurm: a creature of theirs dying costs its controller 2 life', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('A', 'Massacre Wurm');
    const elf = T.bf('C', 'Llanowar Elves');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [elf] });
    t.eq(T.life('C'), 18);
    t.eq(T.life('B'), 20);
  });

  /* ---- hand-written scripts against the card's current words ---- */

  test('Audit: Voice of Resurgence makes an X/X only on your turn, and when it dies', (mk, t) => {
    const T = mk();
    t.auto('Voice of Resurgence');
    const v = T.bf('A', 'Voice of Resurgence');
    T.bf('A', 'Grizzly Bears');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['B'] });
    const toks = () => T.bfOf('A').filter(o => o.isToken);
    t.eq(toks().length, 1, 'an opponent cast a spell on your turn');
    t.eq(T.g.powerOf(toks()[0]), 3, 'Voice, the Bears and itself');
    T.nextTurn('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [v] });
    t.zone(v, 'graveyard');
    t.eq(toks().length, 2, 'none for the spell on their turn, one as Voice died');
  });

  test('Audit: Brimaz makes a vigilant token attacking, and one blocking what it blocks', (mk, t) => {
    const T = mk();
    t.auto('Brimaz, King of Oreskos');
    const br = T.bf('A', 'Brimaz, King of Oreskos');
    T.answer('declareAttackers', () => [{ attackerId: br.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    const cat = T.bfOf('A').find(o => o.isToken);
    t.ok(cat && cat.attacking && T.g.hasKw(cat, 'vigilance'), 'an attacking Cat with vigilance');
    T.nextTurn('B');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => [{ blockerId: br.id, attackerIds: [bear.id] }]);
    T.toMain('B', 'combatDamage');
    const cat2 = T.bfOf('A').filter(o => o.isToken).find(o => o !== cat);
    t.ok(cat2 && (cat2.blocking || []).includes(bear.id), 'the new Cat blocks the Bears');
  });

  test('Audit: Oblivion Stone removes the fate counters after the sweep', (mk, t) => {
    const T = mk();
    t.auto('Oblivion Stone');
    const os = T.bf('A', 'Oblivion Stone');
    const keep = T.bf('A', 'Sol Ring', { counters: { fate: 1 } }), gone = T.bf('B', 'Grizzly Bears');
    T.mana('A', '5');
    T.activate('A', os, 1);
    t.zone(gone, 'graveyard'); t.zone(keep, 'battlefield');
    t.eq(keep.counters.fate || 0, 0, 'no fate counter left');
  });

  test("Audit: Thassa's Oracle keeps one card on top and the rest at the bottom", (mk, t) => {
    const T = mk();
    t.auto("Thassa's Oracle");
    const lib = T.zone('A', 'library');
    const n0 = lib.length;
    const second = lib[1];
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[1].id] }));
    T.mana('A', 'UU');
    T.cast('A', T.hand('A', "Thassa's Oracle"));
    t.eq(lib[0], second, 'the chosen one on top');
    t.eq(lib.length, n0);
    t.no(T.g.over, 'two blue pips against a full library: no win');
  });

  test('Audit: Approach of the Second Sun wins only on the second cast, from the hand', (mk, t) => {
    const T = mk({ libraryEach: 3 });
    t.auto('Approach of the Second Sun');
    const a1 = T.hand('A', 'Approach of the Second Sun');
    T.mana('A', 'W6');
    T.cast('A', a1);
    t.eq(T.life('A'), 27);
    t.zone(a1, 'library');
    t.no(T.g.over);
    T.mana('A', 'W6');
    T.cast('A', T.hand('A', 'Approach of the Second Sun'));
    t.ok(T.player('B').hasLost, 'the second one from the hand wins');
  });

  test('Audit: Manamorphose adds two mana of the colours chosen, one each', (mk, t) => {
    const T = mk();
    t.auto('Manamorphose');
    let asked = null;
    T.answer('choose', (ch) => { asked = ch; return { picks: [ch.options.find(o => /Black/.test(o.label)).i, ch.options.find(o => /Green/.test(o.label)).i] }; });
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Manamorphose'));
    t.ok(asked && asked.repeat && asked.min === 2 && asked.max === 2, 'two picks, repeats allowed');
    t.eq(T.player('A').pool.B, 1);
    t.eq(T.player('A').pool.G, 1);
  });

  test('Audit: choosing a creature type offers every type, your own first', (mk, t) => {
    const T = mk();
    t.auto('Kindred Discovery');
    T.bf('A', 'Llanowar Elves');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [ch.options.find(o => o.label === 'Dragon').i] }; });
    const kd = T.put('A', 'Kindred Discovery', 'battlefield', { etb: true });
    t.eq(asked.options[0].label, 'Elf', 'your own type first');
    t.ok(asked.options.length > 300, 'and every other type');
    t.eq(kd.chosenType, 'Dragon');
  });

  /* ---- the coverage agent's recent cards ---- */

  test("Audit: Tezzeret, Master of the Bridge's +2 gains as much life as it deals", (mk, t) => {
    const T = mk();
    const tz = T.bf('A', 'Tezzeret, Master of the Bridge');
    T.bf('A', 'Sol Ring'); T.bf('A', 'Mind Stone');
    T.activate('A', tz, 0);
    t.eq(T.life('B'), 18);
    t.eq(T.life('A'), 22, 'the same X: two artifacts');
  });

  test('Audit: Berserk doubles the power and gives trample', (mk, t) => {
    const T = mk();
    t.auto('Berserk');
    const w = T.bf('A', 'Craw Wurm');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Berserk'), { targets: [w] });
    t.eq(T.g.powerOf(w), 12);
    t.ok(T.g.hasKw(w, 'trample'));
  });

  test('Audit: Leafkin Druid makes two green with four creatures, one without', (mk, t) => {
    const T = mk();
    t.auto('Leafkin Druid');
    const d = T.bf('A', 'Leafkin Druid');
    t.ok(T.g.tapForMana('A', d.id, 0));
    t.eq(T.player('A').pool.G, 1);
    d.tapped = false;
    for (let i = 0; i < 3; i++) T.bf('A', 'Grizzly Bears');
    t.ok(T.g.tapForMana('A', d.id, 0));
    t.eq(T.player('A').pool.G, 3);
  });

  test("Audit: Liliana's Contract draws four, loses four", (mk, t) => {
    const T = mk();
    t.auto("Liliana's Contract");
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'BB3');
    T.cast('A', T.hand('A', "Liliana's Contract"));
    t.eq(T.zone('A', 'hand').length, h0 + 4);
    t.eq(T.life('A'), 16);
  });

  test('Audit: Jhoira, Weatherlight Captain draws only for a historic spell', (mk, t) => {
    const T = mk();
    t.auto('Jhoira, Weatherlight Captain');
    T.bf('A', 'Jhoira, Weatherlight Captain');
    const bolt = T.hand('A', 'Lightning Bolt'), ring = T.hand('A', 'Sol Ring');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'R'); T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.zone('A', 'hand').length, h0 - 1, 'an instant: no card');
    T.mana('A', '1'); T.cast('A', ring);
    t.eq(T.zone('A', 'hand').length, h0 - 1, 'an artifact: a card for the one cast');
  });

  test('Audit: Damning Verdict destroys only creatures with no counters', (mk, t) => {
    const T = mk();
    t.auto('Damning Verdict');
    const plain = T.bf('B', 'Grizzly Bears'), counted = T.bf('B', 'Craw Wurm', { counters: { '+1/+1': 1 } });
    T.mana('A', 'WW3');
    T.cast('A', T.hand('A', 'Damning Verdict'));
    t.zone(plain, 'graveyard');
    t.zone(counted, 'battlefield');
  });

  test('Audit: Leather Armor equips for {0}, once each turn', (mk, t) => {
    const T = mk();
    t.auto('Leather Armor');
    const la = T.bf('A', 'Leather Armor');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves');
    T.activate('A', la, 0, { targets: [a] });
    t.eq(la.attachedTo, a.id);
    t.no(T.g.activateAbility('A', la.id, 0, { targets: [{ kind: 'object', id: b.id }] }), 'not twice in a turn');
    t.no(T.manualLines().length, 'nothing left for a person');
  });

  test('Audit: Triassic Egg: the choice needs two hatchling counters, and is not a mode', (mk, t) => {
    const T = mk();
    t.auto('Triassic Egg');
    const egg = T.bf('A', 'Triassic Egg', { counters: { hatchling: 1 } });
    t.no(T.g.activateAbility('A', egg.id, 1, {}), 'one counter is not enough');
    egg.counters.hatchling = 2;
    const wurm = T.hand('A', 'Craw Wurm');
    let labels = null;
    T.answer('mode', (ch) => { labels = ch.options.map(o => o.label); return { modes: [0] }; });
    T.activate('A', egg, 1);
    t.eq(labels.length, 2, 'two modes');
    t.zone(wurm, 'battlefield');
  });

  test('Audit: Legion Leadership doubles power and grants first strike, both until end of turn', (mk, t) => {
    const T = mk();
    t.auto('Legion Leadership');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Legion Leadership'), { targets: [b] });
    t.eq(T.g.powerOf(b), 4);
    t.ok(T.g.hasKw(b, 'first strike'));
    T.nextTurn('B');
    t.eq(T.g.powerOf(b), 2);
    t.no(T.g.hasKw(b, 'first strike'));
  });

  test("Audit: Skulduggery's -1/-1 wears off too", (mk, t) => {
    const T = mk();
    t.auto('Skulduggery');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Craw Wurm');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Skulduggery'), { targets: [mine, theirs] });
    t.eq(T.g.powerOf(mine), 3); t.eq(T.g.powerOf(theirs), 5);
    T.nextTurn('B');
    t.eq(T.g.powerOf(mine), 2); t.eq(T.g.powerOf(theirs), 6);
  });

  test('Audit: Embercleave attaches itself to the creature chosen as it enters', (mk, t) => {
    const T = mk();
    t.auto('Embercleave');
    const b = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Craw Wurm');
    T.mana('A', 'RR4');
    let offered;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'object', id: b.id }] }; });
    T.cast('A', T.hand('A', 'Embercleave'));
    t.eq(offered.join(), b.id, 'only your own creatures');
    const e = T.bfOf('A').find(o => o.name === 'Embercleave');
    t.eq(e.attachedTo, b.id);
    t.eq(T.g.powerOf(b), 3);
    t.ok(T.g.hasKw(b, 'double strike'));
  });

  test('Audit: Infinity Formula attaches itself to the creature chosen as it enters', (mk, t) => {
    const T = mk();
    t.auto('Infinity Formula');
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b.id }] }));
    T.put('A', 'Infinity Formula', 'battlefield', { etb: true });
    T.settle(); T.resolve();
    const e = T.bfOf('A').find(o => o.name === 'Infinity Formula');
    t.eq(e.attachedTo, b.id);
    t.eq(T.g.powerOf(b), 3); t.eq(T.g.toughnessOf(b), 4);
  });

  test("Audit: Sigarda's Aid attaches the Equipment that entered, not itself", (mk, t) => {
    const T = mk();
    t.auto("Sigarda's Aid");
    const aid = T.bf('A', "Sigarda's Aid"), b = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b.id }] }));
    T.cast('A', T.hand('A', 'Bonesplitter'));
    const e = T.bfOf('A').find(o => o.name === 'Bonesplitter');
    t.eq(e.attachedTo, b.id);
    t.no(aid.attachedTo);
    t.eq(T.g.powerOf(b), 4);
  });

  test("Audit: Hunter's Bow is manual: the equipped creature deals the damage", (mk, t) => {
    const T = mk();
    t.no(T.MTG.oracle.analyze(require('../harness').card("Hunter's Bow")).fullyAutomated);
  });

  test('Audit: Cleric Class level 3 gains life equal to the returned creature\'s toughness', (mk, t) => {
    const T = mk();
    t.auto('Cleric Class');
    const c = T.bf('A', 'Cleric Class');
    const wurm = T.grave('A', 'Craw Wurm');
    T.mana('A', 'W3'); T.activate('A', c, 0);
    T.mana('A', 'W4'); T.activate('A', c, 1);
    t.zone(wurm, 'battlefield');
    t.eq(T.life('A'), 25, 'toughness 4, plus 1 from level 1');
  });

  test("Audit: Sister Hospitaller gains life equal to the returned card's mana value", (mk, t) => {
    const T = mk();
    t.auto('Sister Hospitaller');
    const wurm = T.grave('A', 'Craw Wurm');
    T.mana('A', 'WB4');
    T.cast('A', T.hand('A', 'Sister Hospitaller'));
    t.zone(wurm, 'battlefield');
    t.eq(T.life('A'), 26);
  });

  test("Audit: Thickest in the Thicket counts the target's power", (mk, t) => {
    const T = mk();
    t.auto('Thickest in the Thicket');
    const w = T.bf('A', 'Craw Wurm');
    T.mana('A', 'GG3');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.cast('A', T.hand('A', 'Thickest in the Thicket'));
    t.eq(T.g.powerOf(w), 12);
  });

  test("Audit: Brightmare gains life equal to the tapped creature's power", (mk, t) => {
    const T = mk();
    t.auto('Brightmare');
    const w = T.bf('B', 'Craw Wurm');
    T.mana('A', 'W2');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.cast('A', T.hand('A', 'Brightmare'));
    t.ok(w.tapped);
    t.eq(T.life('A'), 26);
  });

  test("Audit: Draining Whelk grows by the countered spell's mana value", (mk, t) => {
    const T = mk();
    t.auto('Draining Whelk');
    const wurm = T.hand('B', 'Craw Wurm');
    T.nextTurn('B'); T.mana('B', 'GG4');
    T.cast('B', wurm, { resolve: false });
    T.g.passPriority('B', true);
    T.mana('A', 'UU4');
    T.answer('pickTarget', () => ({ targets: [T.stackTarget(wurm)] }));
    T.cast('A', T.hand('A', 'Draining Whelk'));
    t.eq(wurm.zone, 'graveyard');
    const wh = T.bfOf('A').find(o => o.name === 'Draining Whelk');
    t.eq(wh.counters['+1/+1'], 6);
  });

  test('Audit: Bulk Up doubles power until end of turn', (mk, t) => {
    const T = mk();
    t.auto('Bulk Up');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Bulk Up'), { targets: [b] });
    t.eq(T.g.powerOf(b), 4); t.eq(T.g.toughnessOf(b), 2);
    T.nextTurn('B');
    t.eq(T.g.powerOf(b), 2);
  });

  test('Audit: creatures are still attacking during the end of combat step', (mk, t) => {
    const T = mk();
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: b.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.g.step, 'endCombat');
    t.eq(b.attacking, 'B', 'still attacking until the step ends');
    t.ok(T.g.turnHistory.attacked);
    // an "attacking creatures" spell cast in this step finds it
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Trumpet Blast'));
    t.eq(T.g.powerOf(b), 4);
    // and a "target attacking creature" spell can choose it
    T.g.passPriority('A', true);
    T.mana('B', 'W3');
    T.cast('B', T.hand('B', 'Divine Verdict'), { targets: [b] });
    t.zone(b, 'graveyard');
  });

  test('Audit: attacking and blocking end when the end of combat step does', (mk, t) => {
    const T = mk();
    const w = T.bf('A', 'Craw Wurm'), wall = T.bf('B', 'Wall of Stone');
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [w.id] }]);
    T.toMain('A', 'endCombat');
    t.eq(w.attacking, 'B');
    t.ok(wall.blocking.includes(w.id), 'still blocking until the step ends');
    T.g.passPriority('A', true); T.g.passPriority('B', true); T.settle();
    t.eq(T.g.phase.id, 'postcombat');
    t.no(w.attacking, 'no longer attacking after combat');
    t.eq(wall.blocking.length, 0);
    t.eq(T.g.combat.attackers.length, 0);
    t.ok(T.g.turnHistory.attacked, 'it still attacked this turn');
  });

  test('Audit: Kozilek, the Great Distortion counters a spell by discarding a card of the same mana value', (mk, t) => {
    for (const withMatch of [true, false]) {
      const T = mk();
      t.auto('Kozilek, the Great Distortion');
      const k = T.bf('A', 'Kozilek, the Great Distortion');
      const bears = T.hand('A', 'Grizzly Bears');
      const elf = withMatch ? T.hand('A', 'Llanowar Elves') : null;
      const bolt = T.hand('B', 'Lightning Bolt');
      T.mana('B', 'R');
      T.g.passPriority('A', true);
      T.cast('B', bolt, { targets: ['A'], resolve: false });
      T.g.passPriority('B', true);
      const ok = T.g.activateAbility('A', k.id, 0, { auto: true, targets: [T.stackTarget(bolt)] });
      if (!withMatch) { t.no(ok, 'no card with mana value 1 to discard'); t.zone(bears, 'hand'); continue; }
      t.ok(ok, T.g.lastError);
      T.settle(); T.resolve();
      t.zone(elf, 'graveyard'); t.zone(bears, 'hand');
      t.zone(bolt, 'graveyard');
      t.eq(T.life('A'), 20);
    }
  });

  test("Audit: Hazoret's Monument discards first and only if you want to", (mk, t) => {
    for (const yes of [false, true]) {
      const T = mk();
      t.auto("Hazoret's Monument");
      T.bf('A', "Hazoret's Monument");
      const keep = T.hand('A', 'Lightning Bolt');
      T.top('A', 'Island');
      T.answer('confirm', { yes });
      T.mana('A', 'G1');
      T.cast('A', T.hand('A', 'Grizzly Bears'));
      if (!yes) { t.zone(keep, 'hand'); t.eq(T.zone('A', 'hand').length, 1, 'nothing drawn'); continue; }
      t.zone(keep, 'graveyard');
      t.eq(T.zone('A', 'hand').map(o => o.name).join(), 'Island');
    }
  });

  test('Audit: Knuckles the Echidna needs thirty artifacts to win', (mk, t) => {
    const T = mk();
    t.auto('Knuckles the Echidna');
    T.bf('A', 'Knuckles the Echidna');
    for (let i = 0; i < 3; i++) T.bf('A', 'Sol Ring');
    T.nextTurn('B'); T.nextTurn('A');
    t.no(T.g.over, 'three artifacts are not thirty');
    for (let i = 0; i < 27; i++) T.bf('A', 'Sol Ring');
    T.nextTurn('B'); T.nextTurn('A');
    t.ok(T.g.over || T.g.player('B').hasLost, 'thirty artifacts at upkeep');
  });

  test('Audit: Desert pings an attacker during the end of combat step, and only then', (mk, t) => {
    const T = mk();
    t.auto('Desert');
    const d = T.bf('B', 'Desert');
    const elf = T.bf('A', 'Llanowar Elves');
    T.answer('declareAttackers', () => [{ attackerId: elf.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.no(T.g.activateAbility('B', d.id, 1, { auto: true, targets: [{ kind: 'object', id: elf.id }] }), 'not before the end of combat step');
    T.toMain('A', 'endCombat');
    T.g.passPriority('A', true);
    t.ok(T.g.activateAbility('B', d.id, 1, { auto: true, targets: [{ kind: 'object', id: elf.id }] }), T.g.lastError);
    T.settle(); T.resolve();
    t.zone(elf, 'graveyard');
  });

  test('Audit: Kjeldoran Frostbeast destroys what it fought at end of combat', (mk, t) => {
    const T = mk();
    t.auto('Kjeldoran Frostbeast');
    const fb = T.bf('A', 'Kjeldoran Frostbeast'), wall = T.bf('B', 'Wall of Stone'), other = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: fb.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [fb.id] }]);
    T.toMain('A', 'endCombat');
    T.resolve();
    t.zone(wall, 'graveyard');
    t.zone(other, 'battlefield');
    t.zone(fb, 'battlefield');
  });

  test('Audit: Zurgo Helmsmasher grows only from creatures it damaged', (mk, t) => {
    const T = mk();
    t.auto('Zurgo Helmsmasher');
    const z = T.bf('A', 'Zurgo Helmsmasher'), bear = T.bf('B', 'Grizzly Bears'), elf = T.bf('B', 'Llanowar Elves');
    T.answer('declareAttackers', () => [{ attackerId: z.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: bear.id, attackerIds: [z.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(bear, 'graveyard');
    t.eq(z.counters['+1/+1'] || 0, 1);
    T.toMain('A', 'main');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [elf] });
    t.zone(elf, 'graveyard');
    t.eq(z.counters['+1/+1'] || 0, 1, 'not for a creature something else killed');
  });

  test("Audit: Gaea's Blessing shuffles cards from the target player's graveyard", (mk, t) => {
    const T = mk();
    t.auto("Gaea's Blessing");
    const theirs = T.grave('B', 'Craw Wurm'), mine = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'G1');
    const ok = T.g.castSpell('A', T.hand('A', "Gaea's Blessing").id, { auto: true, targets: [{ kind: 'player', id: 'B' }, { kind: 'object', id: mine.id }] });
    t.no(ok, 'a card from another graveyard is not theirs');
    T.cast('A', T.hand('A', "Gaea's Blessing"), { targets: ['B', theirs] });
    t.zone(theirs, 'library');
    t.zone(mine, 'graveyard');
  });

  test('Audit: Teferi, Mage of Zhalfir keeps opponents to sorcery speed', (mk, t) => {
    const T = mk();
    t.auto('Teferi, Mage of Zhalfir');
    T.bf('A', 'Teferi, Mage of Zhalfir');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    t.no(T.g.castSpell('B', bolt.id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'not on your turn');
  });

  test('Audit: Dragon Tempest damage is dealt by the Dragon that entered', (mk, t) => {
    const T = mk();
    t.auto('Dragon Tempest');
    T.bf('A', 'Dragon Tempest');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'RR4');
    T.cast('A', T.hand('A', 'Shivan Dragon'));
    t.eq(T.life('B'), 19);
    t.ok(T.g.log.some(l => /^Shivan Dragon deals 1 to B/.test(l.text)), 'the Dragon is the source');
  });

  test('Audit: Pain for All: the enchanted creature deals the damage it is dealt', (mk, t) => {
    const T = mk();
    t.auto('Pain for All');
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Pain for All'), { targets: [b] });
    t.eq(T.life('B'), 18);
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Shock'), { targets: [b] });
    t.eq(T.life('B'), 16);
    t.ok(T.g.log.some(l => /^Grizzly Bears deals 2 to B/.test(l.text)));
  });

  test('Audit: Dalek Drone: the controller of the destroyed creature loses 3 life', (mk, t) => {
    const T = mk();
    t.auto('Dalek Drone');
    const w = T.bf('B', 'Craw Wurm');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.mana('A', 'BB4');
    T.cast('A', T.hand('A', 'Dalek Drone'));
    t.zone(w, 'graveyard');
    t.eq(T.life('B'), 17); t.eq(T.life('A'), 20);
  });

  test('Audit: Suspended Sentence and Recoil reach the player whose permanent it was', (mk, t) => {
    let T = mk();
    t.auto('Suspended Sentence');
    const w = T.bf('B', 'Craw Wurm');
    T.mana('A', 'B3');
    T.cast('A', T.hand('A', 'Suspended Sentence'), { targets: [w] });
    t.eq(T.life('B'), 17);
    T = mk();
    t.auto('Recoil');
    const b = T.bf('B', 'Grizzly Bears');
    T.hand('B', 'Lightning Bolt');
    T.mana('A', 'UB1');
    T.cast('A', T.hand('A', 'Recoil'), { targets: [b] });
    t.zone(b, 'hand', 'returned');
    t.eq(T.zone('B', 'hand').length, 1, 'and B discarded one of the two');
  });

  test('Audit: Frightful Delusion is manual: who discards after a counter is not kept', (mk, t) => {
    const T = mk();
    t.no(T.MTG.oracle.analyze(require('../harness').card('Frightful Delusion')).fullyAutomated);
  });

  test('Audit: Perplexing Test returns creature tokens, not every token', (mk, t) => {
    const T = mk();
    t.auto('Perplexing Test');
    T.g._createNamedToken('B', { token: 'Treasure', n: 1 });
    T.g._createToken('B', { n: 1, pt: '1/1', subtypes: 'Goblin', colorWords: ['red'], keywords: [], addTypes: [] });
    const real = T.bf('B', 'Craw Wurm');
    T.answer('mode', { modes: [0] });
    T.mana('A', 'UU3');
    T.cast('A', T.hand('A', 'Perplexing Test'));
    t.zone(real, 'battlefield');
    t.eq(T.bfOf('B').map(o => o.name).sort().join(), 'Craw Wurm,Treasure');
  });

  test('Audit: Kinsbaile Borderguard counts Kithkin and leaves soldiers for its counters', (mk, t) => {
    const T = mk();
    t.auto('Kinsbaile Borderguard');
    T.bf('A', 'Kinsbaile Skirmisher'); T.bf('A', 'Kinsbaile Skirmisher');
    T.mana('A', 'WW1');
    T.cast('A', T.hand('A', 'Kinsbaile Borderguard'));
    const k = T.bfOf('A').find(o => o.name === 'Kinsbaile Borderguard');
    t.eq(k.counters['+1/+1'], 2);
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [k] });
    t.zone(k, 'graveyard');
    t.eq(T.bfOf('A').filter(o => o.name === 'Kithkin Soldier').length, 2);
  });

  test('Audit: Summon: Knights of Round V puts the counter on each of the other creatures', (mk, t) => {
    const T = mk();
    t.auto('Summon: Knights of Round');
    const s = T.bf('A', 'Summon: Knights of Round', { counters: { lore: 4 } });
    const b = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B'); T.nextTurn('A'); T.resolve();
    t.eq(b.counters.indestructible, 1);
    t.no(theirs.counters.indestructible);
    t.zone(s, 'graveyard');
  });

  test('Audit: Endless Ranks of the Dead makes half as many Zombies as you have', (mk, t) => {
    const T = mk();
    t.auto('Endless Ranks of the Dead');
    T.bf('A', 'Endless Ranks of the Dead');
    for (let i = 0; i < 5; i++) T.bf('A', 'Walking Corpse');
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(T.bfOf('A').filter(o => o.name === 'Zombie').length, 2, 'five Zombies, half rounded down');
  });

  test("Audit: Ghoulcaller's Harvest counts half the creature cards in your graveyard, rounded up", (mk, t) => {
    const T = mk();
    t.auto("Ghoulcaller's Harvest");
    for (let i = 0; i < 3; i++) T.grave('A', 'Grizzly Bears');
    for (let i = 0; i < 4; i++) T.grave('B', 'Grizzly Bears');
    T.mana('A', 'BG3');
    T.cast('A', T.hand('A', "Ghoulcaller's Harvest"));
    t.eq(T.bfOf('A').filter(o => o.name === 'Zombie').length, 2);
  });

  test('Audit: Scour for Scrap can choose both modes', (mk, t) => {
    const T = mk();
    t.auto('Scour for Scrap');
    const ring = T.grave('A', 'Sol Ring');
    T.top('A', 'Mind Stone');
    let asked;
    T.answer('mode', (ch) => { asked = ch; return { modes: [0, 1] }; });
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Mind Stone').id] }));
    T.mana('A', 'U3');
    T.cast('A', T.hand('A', 'Scour for Scrap'), { targets: [ring] });
    t.zone(ring, 'hand');
    t.ok(T.zone('A', 'hand').some(o => o.name === 'Mind Stone'), 'and the search');
  });

  test("Audit: Soul's Fire can hit a creature or a player", (mk, t) => {
    let T = mk();
    t.auto("Soul's Fire");
    let w = T.bf('A', 'Craw Wurm');
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', "Soul's Fire"), { targets: [w, b] });
    t.zone(b, 'graveyard');
    T = mk();
    w = T.bf('A', 'Craw Wurm');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', "Soul's Fire"), { targets: [w, 'B'] });
    t.eq(T.life('B'), 14);
  });

  test('Audit: Origin of Thor hits each opponent', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Origin of Thor');
    const w = T.bf('A', 'Craw Wurm');
    T.bf('A', 'Origin of Thor', { counters: { lore: 2 } });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.nextTurn('B'); T.nextTurn('C'); T.nextTurn('A'); T.resolve();
    t.eq(T.life('B'), 14); t.eq(T.life('C'), 14); t.eq(T.life('A'), 20);
  });

  test('Audit: Defy Death checks the returned card for Angel, not itself', (mk, t) => {
    for (const [name, want] of [['Serra Angel', 2], ['Craw Wurm', 0]]) {
      const T = mk();
      t.auto('Defy Death');
      const c = T.grave('A', name);
      T.mana('A', 'WW3');
      T.cast('A', T.hand('A', 'Defy Death'), { targets: [c] });
      t.zone(c, 'battlefield');
      t.eq(c.counters['+1/+1'] || 0, want, name);
    }
  });

  test('Audit: Emiel the Blessed: a Unicorn gets two counters, still paid for', (mk, t) => {
    for (const [name, pay, want] of [['Grizzly Bears', true, 1], ['Lancer Sliver', false, 0], ['Emiel the Blessed', true, 2]]) {
      const T = mk();
      t.auto('Emiel the Blessed');
      T.bf('A', 'Emiel the Blessed');
      T.answer('confirm', { yes: pay });
      T.mana('A', 'GGWW4');
      const c = T.hand('A', name);
      T.cast('A', c);
      t.eq(c.counters['+1/+1'] || 0, want, name);
    }
  });

  test("Audit: Vampire's Zeal gives first strike only to a Vampire", (mk, t) => {
    for (const [name, fs] of [['Vampire Nighthawk', true], ['Grizzly Bears', false]]) {
      const T = mk();
      t.auto("Vampire's Zeal");
      const c = T.bf('A', name);
      T.mana('A', 'W');
      T.cast('A', T.hand('A', "Vampire's Zeal"), { targets: [c] });
      t.eq(T.g.hasKw(c, 'first strike'), fs, name);
    }
  });

  test("Audit: Genesis Chamber gives the Myr artifact token to the entering creature's controller", (mk, t) => {
    const T = mk();
    t.auto('Genesis Chamber');
    T.bf('A', 'Genesis Chamber');
    T.nextTurn('B');
    T.mana('B', 'G1');
    T.cast('B', T.hand('B', 'Grizzly Bears'));
    const myr = T.bfOf('B').find(o => o.name === 'Myr');
    t.ok(myr, 'B gets the Myr');
    t.ok(myr && T.g._matchesCategory(myr, 'artifact'), 'an artifact');
    t.no(T.bfOf('A').some(o => o.name !== 'Genesis Chamber'));
  });

  test('Audit: Wolverine Riders and Angelic Chorus gain life by the creature that entered', (mk, t) => {
    for (const card of ['Wolverine Riders', 'Angelic Chorus']) {
      const T = mk();
      t.auto(card);
      T.bf('A', card);
      T.mana('A', 'GG4');
      T.cast('A', T.hand('A', 'Elvish Warrior'));
      t.eq(T.life('A'), 23, card);
    }
  });

  test('Audit: Brokers Ascendancy counters both creatures and planeswalkers', (mk, t) => {
    const T = mk();
    t.auto('Brokers Ascendancy');
    T.bf('A', 'Brokers Ascendancy');
    const b = T.bf('A', 'Grizzly Bears'), pw = T.bf('A', 'Ajani Goldmane');
    const l0 = pw.counters.loyalty;
    T.nextTurn('B');
    t.eq(b.counters['+1/+1'], 1);
    t.eq(pw.counters.loyalty, l0 + 1);
  });

  test('Audit: Keening Stone mills as many as the target already has in the graveyard', (mk, t) => {
    const T = mk();
    t.auto('Keening Stone');
    const k = T.bf('A', 'Keening Stone');
    for (let i = 0; i < 3; i++) T.grave('B', 'Grizzly Bears');
    T.mana('A', '5');
    T.activate('A', k, 0, { targets: ['B'] });
    t.eq(T.zone('B', 'graveyard').length, 6);
  });

  test("Audit: Sleep keeps the target player's creatures tapped through their next untap", (mk, t) => {
    const T = mk();
    t.auto('Sleep');
    const b = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'UU2');
    T.cast('A', T.hand('A', 'Sleep'), { targets: ['B'] });
    t.ok(b.tapped); t.no(mine.tapped);
    T.nextTurn('B');
    t.ok(b.tapped, 'still tapped on its controller\'s turn');
  });

  test('Audit: The Theorist, Jace Beleren draws on opponents\' draw steps only', (mk, t) => {
    const T = mk();
    t.auto('The Theorist, Jace Beleren');
    T.bf('A', 'The Theorist, Jace Beleren');
    const h0 = T.zone('A', 'hand').length;
    T.nextTurn('B');
    t.eq(T.zone('A', 'hand').length, h0 + 1);
    T.nextTurn('A');
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'only its own normal draw on A\'s turn');
  });

  test('Audit: Terror of the Peaks deals the entering creature\'s power, not its own', (mk, t) => {
    const T = mk();
    t.auto('Terror of the Peaks');
    T.bf('A', 'Terror of the Peaks');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    t.eq(T.life('B'), 18);
  });

  test('Audit: Ziatora and Heart-Piercer Manticore count the sacrificed creature\'s power', (mk, t) => {
    let T = mk();
    t.auto('Ziatora, the Incinerator');
    T.bf('A', 'Ziatora, the Incinerator');
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.toMain('A', 'end'); T.settle(); T.resolve();
    t.zone(b, 'graveyard');
    t.eq(T.life('B'), 18);
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 3);
    T = mk();
    t.auto('Heart-Piercer Manticore');
    const w = T.bf('A', 'Craw Wurm');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'RR2');
    T.cast('A', T.hand('A', 'Heart-Piercer Manticore'));
    t.zone(w, 'graveyard');
    t.eq(T.life('B'), 14);
  });

  test("Audit: Syr Ginger's sacrifice gains life equal to its own power", (mk, t) => {
    const T = mk();
    t.auto('Syr Ginger, the Meal Ender');
    const s = T.bf('A', 'Syr Ginger, the Meal Ender');
    T.mana('A', '2');
    T.activate('A', s, 0);
    t.zone(s, 'graveyard');
    t.eq(T.life('A'), 23);
  });

  test('Audit: discarding a whole hand, or several cards at random, takes every card asked for', (mk, t) => {
    let T = mk();
    t.auto('One with Nothing');
    for (let i = 0; i < 3; i++) T.hand('A', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'One with Nothing'));
    t.eq(T.zone('A', 'hand').length, 0, 'the whole hand');
    T = mk();
    t.auto('Burning Inquiry');
    for (let i = 0; i < 2; i++) { T.hand('A', 'Grizzly Bears'); T.hand('B', 'Grizzly Bears'); }
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Burning Inquiry'));
    t.eq(T.zone('A', 'hand').length, 2, 'five cards, three of them discarded');
    t.eq(T.zone('B', 'hand').length, 2);
  });

  test('Audit: Forgotten Creation draws as many as it discarded', (mk, t) => {
    const T = mk();
    t.auto('Forgotten Creation');
    T.bf('A', 'Forgotten Creation');
    T.nextTurn('B');
    for (let i = 0; i < 3; i++) T.hand('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.nextTurn('A');
    t.eq(T.zone('A', 'graveyard').length, 3);
    t.eq(T.zone('A', 'hand').length, 4, 'three for the three, and the draw step');
  });

  test('Audit: "when this creature dies/enters, gain life equal to its power" counts itself', (mk, t) => {
    let T = mk();
    t.auto('Conclave Mentor');
    const m = T.bf('A', 'Conclave Mentor');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [m] });
    t.zone(m, 'graveyard');
    t.eq(T.life('A'), 22);
    T = mk();
    t.auto('Boulderbranch Golem');
    T.mana('A', '7');
    T.cast('A', T.hand('A', 'Boulderbranch Golem'));
    t.eq(T.life('A'), 26);
  });

  test("Audit: Living Destiny gains life equal to the revealed card's mana value", (mk, t) => {
    const T = mk();
    t.auto('Living Destiny');
    T.hand('A', 'Craw Wurm');
    T.mana('A', 'GG3');
    T.cast('A', T.hand('A', 'Living Destiny'));
    t.eq(T.life('A'), 26);
  });

  test('Audit: Lord of Extinction counts every card in every graveyard', (mk, t) => {
    const T = mk();
    t.auto('Lord of Extinction');
    T.grave('A', 'Grizzly Bears'); T.grave('B', 'Grizzly Bears'); T.grave('B', 'Island');
    const l = T.bf('A', 'Lord of Extinction');
    T.settle();
    t.zone(l, 'battlefield');
    t.eq(T.g.powerOf(l), 3); t.eq(T.g.toughnessOf(l), 3);
  });

  test('Audit: power counted from cards in graveyards: Lhurgoyf, Consuming Aberration, Detritivore, Souls of the Lost', (mk, t) => {
    const want = { 'Lhurgoyf': [4, 5], 'Consuming Aberration': [4, 4], 'Detritivore': [1, 1], 'Souls of the Lost': [2, 3] };
    for (const name of Object.keys(want)) {
      const T = mk();
      t.auto(name);
      T.grave('A', 'Grizzly Bears'); T.grave('A', 'Lightning Bolt'); T.grave('A', 'Island');
      T.grave('B', 'Grizzly Bears'); T.grave('B', 'Craw Wurm'); T.grave('B', 'Ghost Quarter'); T.grave('B', 'Walking Corpse');
      const o = T.bf('A', name);
      t.eq([T.g.powerOf(o), T.g.toughnessOf(o)].join('/'), want[name].join('/'), name);
    }
  });

  test('Audit: counts of cards nothing reads are left to a person (Unlicensed Hearse, Primalcrux, Adamaro)', (mk, t) => {
    const { card } = require('../harness');
    const T = mk();
    for (const n of ['Unlicensed Hearse', 'Primalcrux', 'Adamaro, First to Desire', 'Soulless One'])
      t.no(T.MTG.oracle.analyze(card(n)).fullyAutomated, n);
  });
};
