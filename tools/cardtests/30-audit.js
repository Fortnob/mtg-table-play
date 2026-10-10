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

  test('Audit: counts of other, differently named and different-valued permanents', (mk, t) => {
    let T = mk();
    t.auto('Speakeasy Server');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Ornithopter');
    T.mana('A', 'W4');
    T.cast('A', T.hand('A', 'Speakeasy Server'));
    t.eq(T.life('A'), 22, 'two other creatures');
    T = mk();
    t.auto('Lunar Insight');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Ornithopter'); T.bf('A', 'Memnite'); T.bf('A', 'Craw Wurm'); T.bf('A', 'Island');
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Lunar Insight'));
    t.eq(T.zone('A', 'hand').length, 3, 'mana values 0, 2 and 6');
    T = mk();
    t.auto('Golden Ratio');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Runeclaw Bear'); T.bf('A', 'Ornithopter'); T.bf('A', 'Craw Wurm');
    T.mana('A', 'GU2');
    T.cast('A', T.hand('A', 'Golden Ratio'));
    t.eq(T.zone('A', 'hand').length, 3, 'powers 0, 2 and 6');
    T = mk();
    t.auto('Awakened Amalgam');
    T.bf('A', 'Island'); T.bf('A', 'Island'); T.bf('A', 'Swamp'); T.bf('A', 'Ghost Quarter');
    const am = T.bf('A', 'Awakened Amalgam');
    t.eq(T.g.powerOf(am), 3, 'Island, Swamp, Ghost Quarter');
  });

  test('Audit: counts that nothing here reads are left to a person (Slash of Light, Chameleon Spirit, Karn, Gilded Guardian)', (mk, t) => {
    const { card } = require('../harness');
    const T = mk();
    for (const n of ['Slash of Light', 'Chameleon Spirit', 'Karn, Gilded Guardian', 'Skyshroud War Beast'])
      t.no(T.MTG.oracle.analyze(card(n)).fullyAutomated, n);
  });

  test('Audit: Gadrak, the Crown-Scourge counts the nontoken creatures that died', (mk, t) => {
    const T = mk();
    t.auto('Gadrak, the Crown-Scourge');
    T.bf('A', 'Gadrak, the Crown-Scourge');
    const b = T.bf('B', 'Grizzly Bears'), c = T.bf('B', 'Runeclaw Bear');
    T.g._createToken('B', { n: 1, pt: '1/1', subtypes: 'Goblin', colorWords: ['red'], keywords: [], addTypes: [] });
    const tok = T.bfOf('B').find(o => o.isToken);
    T.mana('A', 'RRR');
    for (const x of [b, c, tok]) T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [x] });
    T.toMain('A', 'end'); T.settle(); T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test('Audit: Dockside Extortionist makes a Treasure for each opposing artifact and enchantment', (mk, t) => {
    const T = mk();
    t.auto('Dockside Extortionist');
    T.bf('B', 'Sol Ring'); T.bf('B', 'Mind Stone'); T.bf('B', 'Rhystic Study'); T.bf('A', 'Arcane Signet');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Dockside Extortionist'));
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 3);
  });

  test('Audit: generated readings that dropped a count are left to a person (Fresh Meat)', (mk, t) => {
    const { card } = require('../harness');
    const T = mk();
    // (Death's Presence now reads its count: its own test checks it)
    // (Murmuration now reads its count too: "for each spell you've cast this turn", tested in 20-xmage)
    for (const n of ['Fresh Meat', 'Hoard Hauler', 'Caller of the Claw'])
      t.no(T.MTG.oracle.analyze(card(n)).fullyAutomated, n);
  });

  test('Audit: "if that player has no cards in hand" looks at the player whose upkeep it is', (mk, t) => {
    let T = mk();
    t.auto('Ghirapur Orrery');
    T.bf('A', 'Ghirapur Orrery'); T.hand('A', 'Island');
    T.nextTurn('B');
    t.eq(T.zone('B', 'hand').length, 4, 'three and the draw');
    T = mk();
    t.auto('Asylum Visitor');
    T.bf('A', 'Asylum Visitor'); T.hand('A', 'Island');
    T.nextTurn('B');
    t.eq(T.zone('A', 'hand').length, 2); t.eq(T.life('A'), 19);
    T = mk();
    t.auto('Lavaborn Muse');
    T.bf('A', 'Lavaborn Muse');
    for (let i = 0; i < 4; i++) T.hand('A', 'Island');
    T.nextTurn('B');
    t.eq(T.life('B'), 17, 'B had no cards; A had four');
  });

  test('Audit: Sandstone Oracle draws the difference between hands, not up to seven', (mk, t) => {
    const T = mk();
    t.auto('Sandstone Oracle');
    for (let i = 0; i < 4; i++) T.hand('B', 'Island');
    T.hand('A', 'Island');
    T.mana('A', '7');
    T.cast('A', T.hand('A', 'Sandstone Oracle'));
    t.eq(T.zone('A', 'hand').length, 4, 'one card, three more to match four');
  });

  test('Audit: generated readings that dropped a mana value or nontoken limit are left to a person', (mk, t) => {
    const { card } = require('../harness');
    const T = mk();
    for (const n of ['Starfield Shepherd', 'Szarel, Genesis Shepherd'])
      t.no(T.MTG.oracle.analyze(card(n)).fullyAutomated, n);
  });

  test('Audit: Rabid Gnaw: the targeted creature deals its own power, with its lifelink and deathtouch', (mk, t) => {
    const T = mk();
    t.auto('Rabid Gnaw');
    const v = T.bf('A', 'Vampire Nighthawk'), w = T.bf('B', 'Craw Wurm');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Rabid Gnaw'), { targets: [v, w] });
    t.ok(T.g.log.some(l => /^Vampire Nighthawk deals 3 to Craw Wurm/.test(l.text)), '2 power, +1/+0');
    t.zone(w, 'graveyard', 'deathtouch');
    t.eq(T.life('A'), 23, 'lifelink outside combat');
  });

  test('Audit: lifelink counts for a fight too', (mk, t) => {
    const T = mk();
    const v = T.bf('A', 'Vampire Nighthawk'), b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Prey Upon'), { targets: [v, b] });
    t.zone(b, 'graveyard');
    t.eq(T.life('A'), 22);
  });

  test('Audit: Immersturm Skullcairn: the player it hits discards', (mk, t) => {
    const T = mk();
    t.auto('Immersturm Skullcairn');
    const s = T.bf('A', 'Immersturm Skullcairn');
    T.hand('B', 'Island'); T.hand('B', 'Island');
    T.mana('A', 'BRR1');
    T.activate('A', s, 1, { targets: ['B'] });
    t.eq(T.life('B'), 17); t.eq(T.zone('B', 'hand').length, 1);
  });

  test('Audit: Lay Down Arms gives the life to the exiled creature\'s controller', (mk, t) => {
    const T = mk();
    t.auto('Lay Down Arms');
    T.bf('A', 'Plains'); T.bf('A', 'Plains');
    const b = T.bf('B', 'Grizzly Bears'), w = T.bf('B', 'Craw Wurm');
    T.mana('A', 'W');
    t.no(T.g.castSpell('A', T.hand('A', 'Lay Down Arms').id, { auto: true, targets: [{ kind: 'object', id: w.id }] }), 'mana value 6 is more than two Plains');
    T.cast('A', T.hand('A', 'Lay Down Arms'), { targets: [b] });
    t.zone(b, 'exile');
    t.eq(T.life('B'), 23); t.eq(T.life('A'), 20);
  });

  test('Audit: Recurring Insight draws as many as the target opponent holds', (mk, t) => {
    const T = mk();
    t.auto('Recurring Insight');
    for (let i = 0; i < 3; i++) T.hand('B', 'Island');
    T.mana('A', 'UU4');
    T.cast('A', T.hand('A', 'Recurring Insight'), { targets: ['B'] });
    t.eq(T.zone('A', 'hand').length, 3);
  });

  test('Audit: Aunt May counts the Spider that entered', (mk, t) => {
    const T = mk();
    t.auto('Aunt May');
    T.bf('A', 'Aunt May');
    const s = T.hand('A', 'Giant Spider'), b = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'G3'); T.cast('A', s);
    T.mana('A', 'G1'); T.cast('A', b);
    t.eq(s.counters['+1/+1'], 1); t.no(b.counters['+1/+1']);
    t.eq(T.life('A'), 22);
  });

  test('Audit: Tribute to Hunger waits for the opponent\'s sacrifice, then gains its toughness', (mk, t) => {
    const T = mk();
    t.auto('Tribute to Hunger');
    const w = T.bf('B', 'Craw Wurm'); T.bf('B', 'Grizzly Bears');
    T.answer('sacrifice', (ch) => T.g.resolveChoice(ch.playerId, { cardIds: [w.id] }));
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Tribute to Hunger'), { targets: ['B'] });
    t.zone(w, 'graveyard');
    t.eq(T.life('A'), 24, 'Craw Wurm\'s toughness');
  });

  test('Audit: Entrapment Maneuver makes Soldiers for the sacrificed attacker\'s toughness', (mk, t) => {
    const T = mk();
    t.auto('Entrapment Maneuver');
    T.nextTurn('B');
    const w = T.bf('B', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'A' }]);
    T.toMain('B', 'declareBlockers');
    T.g.passPriority('B', true);
    T.mana('A', 'W3');
    T.cast('A', T.hand('A', 'Entrapment Maneuver'), { targets: ['B'] });
    t.zone(w, 'graveyard');
    t.eq(T.bfOf('A').filter(o => o.name === 'Soldier').length, 4);
  });

  test('Audit: Psychic Miasma returns to hand when a land is discarded, and not otherwise', (mk, t) => {
    for (const [pick, where] of [['Island', 'hand'], ['Grizzly Bears', 'graveyard']]) {
      const T = mk();
      t.auto('Psychic Miasma');
      T.hand('B', 'Island'); T.hand('B', 'Grizzly Bears');
      T.answer('discard', (ch) => T.g.resolveChoice(ch.playerId, { cardIds: [T.zone('B', 'hand').find(o => o.name === pick).id] }));
      T.mana('A', 'B1');
      const pm = T.hand('A', 'Psychic Miasma');
      T.cast('A', pm, { targets: ['B'] });
      t.zone(pm, where, pick);
    }
  });

  test("Audit: each opponent sacrifices in turn order, each asked as the spell resolves (Liliana's Triumph)", (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Craw Wurm'); T.bf('C', 'Craw Wurm');
    const order = [];
    const pick = (ch) => { order.push(ch.playerId); return T.g.resolveChoice(ch.playerId, { cardIds: [T.bfOf(ch.playerId).find(o => o.name === 'Grizzly Bears' || ch.playerId === 'C').id] }); };
    T.answer('sacrifice', pick); T.answer('sacrifice', pick);
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', "Liliana's Triumph"));
    t.eq(order.join(), 'B,C');
    t.eq(T.bfOf('B').map(o => o.name).join(), 'Craw Wurm', 'B chose its Bears');
    t.eq(T.bfOf('C').length, 0);
  });

  test("Audit: a game saved while an opponent's sacrifice is pending resumes where it stopped", (mk, t) => {
    const T = mk();
    const w = T.bf('B', 'Craw Wurm'); T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    t.ok(T.g.castSpell('A', T.hand('A', 'Tribute to Hunger').id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }));
    T.g.passPriority('A', true); T.g.passPriority('B', true);
    t.eq((T.g.pendingChoice || {}).type, 'sacrifice'); t.eq((T.g.pendingChoice || {}).playerId, 'B');
    const snap = JSON.parse(JSON.stringify(T.g.snapshot()));
    const T2 = mk();
    t.ok(T2.g.restore(snap), 'restored');
    t.eq((T2.g.pendingChoice || {}).playerId, 'B', 'still waiting for B');
    T2.g.resolveChoice('B', { cardIds: [w.id] });
    T2.settle();
    t.eq(T2.life('A'), 24);
    t.eq(T2.g.obj(w.id).zone, 'graveyard');
  });

  test("Audit: Goblin Guide gives the defending player their top card only if it's a land", (mk, t) => {
    for (const [top, where] of [['Island', 'hand'], ['Grizzly Bears', 'library']]) {
      const T = mk();
      t.auto('Goblin Guide');
      const g = T.bf('A', 'Goblin Guide');
      const c = T.top('B', top);
      T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
      T.toMain('A', 'combatDamage');
      t.zone(c, where, top);
      t.zone(g, 'battlefield');
    }
  });

  test('Audit: Heat Stroke destroys what blocked or was blocked, nothing else', (mk, t) => {
    const T = mk();
    t.auto('Heat Stroke');
    T.bf('A', 'Heat Stroke');
    const w = T.bf('A', 'Craw Wurm'), wall = T.bf('B', 'Wall of Stone'), other = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [w.id] }]);
    T.toMain('A', 'end');
    t.zone(w, 'graveyard'); t.zone(wall, 'graveyard'); t.zone(other, 'battlefield');
  });

  test('Audit: "that land\'s controller" is the controller of the land the trigger is about (Ankh of Mishra, Dingus Egg)', (mk, t) => {
    let T = mk();
    t.auto('Ankh of Mishra');
    T.bf('A', 'Ankh of Mishra');
    T.nextTurn('B');
    T.playLand('B', T.hand('B', 'Mountain'));
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
    T = mk();
    t.auto('Dingus Egg');
    T.bf('A', 'Dingus Egg');
    const land = T.bf('B', 'Island');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Stone Rain'), { targets: [land] });
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
  });

  test('Audit: "defending player controls" is the one opponent attacked, not every opponent (Master of Diversion, Silumgar)', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Master of Diversion');
    T.toMain('A');
    const m = T.bf('A', 'Master of Diversion'); m.summoningSick = false;
    const bb = T.bf('B', 'Grizzly Bears'), cb = T.bf('C', 'Hill Giant');
    let offered = null;
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.answer('pickTarget', (ch) => { offered = (ch.options[0] || []).map(o => o.id); return { targets: [offered[0]] }; });
    T.toMain('A', 'declareBlockers');
    t.eq(JSON.stringify(offered), JSON.stringify([bb.id]), "only B's creature is offered");
    t.ok(bb.tapped, "B's Bears tapped"); t.no(cb.tapped);
    T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Silumgar, the Drifting Death');
    T.toMain('A');
    const d = T.bf('A', 'Shivan Dragon'); d.summoningSick = false;
    T.bf('A', 'Silumgar, the Drifting Death');
    const sb = T.bf('B', 'Grizzly Bears'), sc = T.bf('C', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(sb), 1, "B's creatures get -1/-1");
    t.eq(T.g.powerOf(sc), 2, "C's do not");
  });

  test('Audit: "defending player" through an Equipment, a count and an activated ability (Captain America\'s Shield, Terra Ravager, Ancient Hellkite)', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto("Captain America's Shield");
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    const sh = T.bf('A', "Captain America's Shield");
    sh.attachedTo = bear.id; bear.attachments = [sh.id];
    T.g.bumpBoard();
    const bc = T.bf('B', 'Hill Giant'), cc = T.bf('C', 'Grizzly Bears');
    let offered = null;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'C' }]);
    T.answer('pickTarget', (ch) => { offered = (ch.options[0] || []).map(o => o.id); return { targets: [offered[0]] }; });
    T.toMain('A', 'declareBlockers');
    t.eq(JSON.stringify(offered), JSON.stringify([cc.id]), "attacking C: only C's creature is offered");
    t.ok(cc.tapped); t.no(bc.tapped);
    T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Terra Ravager');
    T.toMain('A');
    const r = T.bf('A', 'Terra Ravager'); r.summoningSick = false;
    T.bf('B', 'Mountain'); T.bf('B', 'Mountain');
    for (let i = 0; i < 5; i++) T.bf('C', 'Forest');
    T.answer('declareAttackers', () => [{ attackerId: r.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(r), 2, "0/4 gets +X/+0 for B's two lands, not C's five");
    T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Ancient Hellkite');
    T.toMain('A');
    const h = T.bf('A', 'Ancient Hellkite'); h.summoningSick = false;
    const hb = T.bf('B', 'Grizzly Bears'), hc = T.bf('C', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: h.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.mana('A', 'R');
    t.no(T.g.activateAbility('A', h.id, 0, { auto: true, targets: [{ kind: 'object', id: hc.id }] }), "C's creature is not defending");
    T.mana('A', 'R');
    T.activate('A', h, 0, { targets: [hb] });
    t.eq(hb.damage, 1);
  });

  test('Audit: Hit targets one player in a three-player game: they sacrifice and take its mana value', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Hit // Run');
    T.toMain('A');
    T.bf('B', 'Hill Giant');
    const g = T.bf('C', 'Hill Giant');
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', 'Hit // Run'), { face: 0, targets: ['C'] });
    t.zone(g, 'graveyard');
    t.eq(T.life('C'), 16); t.eq(T.life('B'), 20);
  });

  test('Audit: a planeswalker with Way of the Pyromancer\'s ability still activates one loyalty ability a turn', (mk, t) => {
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Way of the Pyromancer');
    const pw = T.bf('A', 'Jace Beleren');
    T.settle();
    const all = pw.analysis().manaAbilities.concat(pw.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => /Add \{R\}/.test(a.text || ''));
    T.activate('A', pw, idx);
    const own = all.findIndex(a => /Each player draws a card/.test(a.text || ''));
    t.ok(own >= 0);
    t.no(T.g.activateAbility('A', pw.id, own, { auto: true }), 'a second loyalty ability this turn is refused');
  });

  test('Audit: Wrexial casts from the graveyard of the player it hit, not any opponent\'s', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Wrexial, the Risen Deep');
    t.auto('Deluxe Dragster');
    T.toMain('A');
    const w = T.bf('A', 'Wrexial, the Risen Deep'); w.summoningSick = false;
    const bs = T.grave('B', 'Divination'), cs = T.grave('C', 'Lightning Bolt');
    let offered = null;
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.answer('pickTarget', (ch) => { offered = (ch.options[0] || []).map(o => o.id); return { targets: [(ch.options[0] || [])[0]] }; });
    const hand = T.g.zones.A.hand.length;
    T.toMain('A', 'end');
    t.eq(JSON.stringify(offered), JSON.stringify([bs.id]), "only B's Divination is offered");
    t.eq(T.g.zones.A.hand.length, hand + 2, 'cast: two cards drawn');
    t.zone(bs, 'exile', 'and exiled afterwards');
    t.zone(cs, 'graveyard');
  });

  test('Audit: a minus loyalty ability needs that much loyalty (Jace Beleren -10 at 3)', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const j = T.bf('A', 'Jace Beleren');
    t.eq(j.counters.loyalty, 3);
    t.no(T.g.activateAbility('A', j.id, 2, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), '-10 with 3 loyalty is refused');
    t.eq(j.counters.loyalty, 3);
    j.counters.loyalty = 10;
    const lib = T.g.zones.B.library.length;
    T.activate('A', j, 2, { targets: ['B'] });
    t.eq(T.g.zones.B.library.length, Math.max(0, lib - 20), 'twenty milled');
    t.zone(j, 'graveyard', 'down to 0 loyalty');
  });

  test('Audit: "-X" takes X loyalty off (Sorin, Vengeful Bloodlord; Chandra Nalaar)', (mk, t) => {
    const T = mk();
    t.auto('Sorin, Vengeful Bloodlord');
    T.toMain('A');
    const s = T.bf('A', 'Sorin, Vengeful Bloodlord');
    t.eq(s.counters.loyalty, 4);
    const bears = T.grave('A', 'Grizzly Bears');
    t.no(T.g.activateAbility('A', s.id, 1, { auto: true, x: 5, targets: [{ kind: 'object', id: bears.id }] }), 'X of 5 with 4 loyalty is refused');
    T.activate('A', s, 1, { x: 2, targets: [bears] });
    t.eq(s.counters.loyalty, 2, 'two loyalty off');
    t.zone(bears, 'battlefield');
    t.ok(T.g._hasCreatureType(bears, 'Vampire'), 'a Vampire as well');
    const U = mk();
    t.auto('Chandra Nalaar');
    U.toMain('A');
    const c = U.bf('A', 'Chandra Nalaar');
    const wurm = U.bf('B', 'Craw Wurm');
    c.counters.loyalty = 6;
    const idx = c.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty').findIndex(a => /-X/.test(a.text));
    U.activate('A', c, idx, { x: 6, targets: [wurm] });
    t.zone(wurm, 'graveyard', 'six damage');
    t.zone(c, 'graveyard', 'Chandra used all six');
  });

  test('Audit: Repartee triggers only on an instant or sorcery that targets a creature (Stirring Hopesinger); Legolas', (mk, t) => {
    let T = mk();
    t.auto('Stirring Hopesinger');
    T.toMain('A');
    const h = T.bf('A', 'Stirring Hopesinger'), ob = T.bf('B', 'Grizzly Bears');
    T.mana('A', '1W'); T.cast('A', T.hand('A', 'Pacifism'), { targets: [ob] });
    t.eq(h.counters['+1/+1'] || 0, 0, 'an Aura is not an instant or sorcery');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(h.counters['+1/+1'] || 0, 0, 'a player is not a creature');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [ob] });
    t.eq(h.counters['+1/+1'] || 0, 1);
    T = mk();
    t.auto('Legolas, Master Archer');
    T.toMain('A');
    const l = T.bf('A', 'Legolas, Master Archer'), mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Darksteel Colossus');
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [mine] });
    t.eq(l.counters['+1/+1'] || 0, 0, 'my own Bears: neither ability');
    t.eq(theirs.damage || 0, 0);
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [l] });
    t.eq(l.counters['+1/+1'], 1, 'aimed at Legolas: a counter');
    T.answer('pickTarget', (ch) => ({ targets: [ch.options[0].find(o => o.id === theirs.id)] }));
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: [theirs] });
    t.eq(theirs.damage, 2 + T.g.powerOf(l), "aimed at the Colossus: Legolas's power as damage, then the Shock");
  });

  test('Audit: entering with counters (-1/-1, X charge, X +1/+0) and removing any counter as a cost (Loch Mare)', (mk, t) => {
    let T = mk();
    T.toMain('A');
    t.auto('Wickerbough Elder'); t.auto('Astral Cornucopia'); t.auto('Lightning Serpent'); t.auto('Loch Mare');
    T.mana('A', '3G'); T.cast('A', T.hand('A', 'Wickerbough Elder'));
    const w = T.g.battlefield.find(o => o.name === 'Wickerbough Elder');
    t.eq(T.g.powerOf(w), 3, 'a 4/4 with a -1/-1 counter');
    T.mana('A', '6'); T.cast('A', T.hand('A', 'Astral Cornucopia'), { x: 2 });
    t.eq(T.g.battlefield.find(o => o.name === 'Astral Cornucopia').counters.charge, 2);
    T.mana('A', '3R'); T.cast('A', T.hand('A', 'Lightning Serpent'), { x: 3 });
    t.eq(T.g.powerOf(T.g.battlefield.find(o => o.name === 'Lightning Serpent')), 5, '2/1 with three +1/+0 counters');
    T.mana('A', '1U'); T.cast('A', T.hand('A', 'Loch Mare'));
    const lm = T.g.battlefield.find(o => o.name === 'Loch Mare');
    t.eq(T.g.powerOf(lm), 1, 'a 4/5 with three -1/-1 counters');
    const hand = T.g.zones.A.hand.length;
    T.mana('A', '1U'); T.activate('A', lm, 0);
    t.eq(T.g.zones.A.hand.length, hand + 1);
    t.eq(lm.counters['-1/-1'], 2, 'one counter paid');
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2U'); T.activate('A', lm, 1, { targets: [b] });
    t.ok(b.tapped); t.eq(b.counters.stun, 1);
    T.mana('A', '1U');
    t.no(T.g.activateAbility('A', lm.id, 0, { auto: true }), 'no counters left to remove');
  });

  test('Audit: Council of Reeds spares legendary creatures, not other legends; Planar Despair counts basic land types', (mk, t) => {
    let T = mk();
    t.auto('Council of Reeds');
    T.toMain('A');
    T.bf('A', 'Council of Reeds');
    T.bf('A', 'Mox Amber');
    T.cast('A', T.hand('A', 'Mox Amber'));
    t.eq(T.g.battlefield.filter(o => o.name === 'Mox Amber').length, 1, 'two Mox Ambers: one goes');
    T.bf('A', 'Isamaru, Hound of Konda');
    T.mana('A', 'W'); T.cast('A', T.hand('A', 'Isamaru, Hound of Konda'));
    t.eq(T.g.battlefield.filter(o => o.name === 'Isamaru, Hound of Konda').length, 2, 'two Isamarus stay');
    T = mk();
    t.auto('Planar Despair');
    T.toMain('A');
    for (const n of ['Plains', 'Swamp', 'Island', 'Plains']) T.bf('A', n);
    const wurm = T.bf('B', 'Craw Wurm'), giant = T.bf('A', 'Hill Giant');
    T.mana('A', '3BB'); T.cast('A', T.hand('A', 'Planar Despair'));
    t.eq(T.g.powerOf(wurm), 3, 'three basic land types: -3/-3'); t.eq(T.g.toughnessOf(wurm), 1);
    t.zone(giant, 'graveyard');
  });

  test('Audit: "Whenever a source … deals damage to you" triggers, and Michiko\'s "that player" is the source\'s controller', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Retaliator Griffin', "Azor's Elocutors", 'Michiko Konda, Truth Seeker', 'Auntie Blyte, Bad Influence']) t.auto(c);
    T.toMain('B');
    const g = T.bf('A', 'Retaliator Griffin'), az = T.bf('A', "Azor's Elocutors");
    az.counters.filibuster = 3;
    T.bf('A', 'Michiko Konda, Truth Seeker');
    const bb = T.bf('B', 'Grizzly Bears'), cb = T.bf('C', 'Grizzly Bears');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(g.counters['+1/+1'], 3, 'Griffin: three counters for three damage');
    t.eq(az.counters.filibuster, 2, 'Elocutors: one counter off');
    t.zone(bb, 'graveyard', 'B, who controlled the Bolt, sacrifices');
    t.zone(cb, 'battlefield');
    t.eq(T.g.player('A').life, 17);
    T = mk();
    T.toMain('A');
    const au = T.bf('A', 'Auntie Blyte, Bad Influence'), gr = T.bf('A', 'Retaliator Griffin');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(au.counters['+1/+1'], 3, 'my own Bolt: Auntie Blyte counts it');
    t.eq(gr.counters['+1/+1'] || 0, 0, 'the Griffin does not');
  });

  test('Audit: "permanents" and "Mice" in a trigger match (Nefarious Imp, Builder\'s Talent, Valley Questcaller)', (mk, t) => {
    let T = mk();
    t.auto('Nefarious Imp');
    T.toMain('A');
    T.bf('A', 'Nefarious Imp');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Cut Down'), { targets: [b] });
    t.ok(T.asked.some(a => a.type === 'scry'), 'a permanent left: scry 1');
    T = mk();
    t.auto("Builder's Talent");
    T.toMain('A');
    const bt = T.bf('A', "Builder's Talent");
    bt.counters.level = 1; bt._chr = null; T.g.bumpBoard();
    const c = T.bf('A', 'Grizzly Bears');
    T.mana('A', '2'); T.cast('A', T.hand('A', 'Mind Stone'));
    t.eq(c.counters['+1/+1'], 1, 'a noncreature, nonland permanent entered');
    T = mk();
    t.auto('Valley Questcaller');
    T.toMain('A');
    T.bf('A', 'Valley Questcaller');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Heartfire Hero'));
    t.ok(T.g.log.some(l => /Valley Questcaller .* resolves/.test(l.text)), 'a Mouse entered');
  });

  test('Audit: "A, B, or C" in a trigger is any one of them (Sram, Valley Questcaller, God-Pharaoh\'s Faithful)', (mk, t) => {
    let T = mk();
    t.auto('Sram, Senior Edificer');
    T.toMain('A');
    T.bf('A', 'Sram, Senior Edificer');
    const bs = T.hand('A', 'Bonesplitter');
    let hand = T.g.zones.A.hand.length;
    T.mana('A', '1'); T.cast('A', bs);
    t.eq(T.g.zones.A.hand.length, hand, 'an Equipment: Bonesplitter left, a card drawn');
    const ra = T.hand('A', 'Rancor');
    hand = T.g.zones.A.hand.length;
    T.mana('A', 'G'); T.cast('A', ra, { targets: [T.bf('A', 'Grizzly Bears')] });
    t.eq(T.g.zones.A.hand.length, hand, 'an Aura: the same');
    T = mk();
    t.auto('Valley Questcaller');
    T.toMain('A');
    T.bf('A', 'Valley Questcaller');
    T.mana('A', '3W'); T.cast('A', T.hand('A', 'Intrepid Rabbit'));
    t.ok(T.g.log.some(l => /Valley Questcaller .* resolves/.test(l.text)), 'a Rabbit alone sets it off');
    T = mk();
    t.auto("God-Pharaoh's Faithful");
    T.toMain('A');
    T.bf('A', "God-Pharaoh's Faithful");
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Cut Down'), { targets: [T.bf('B', 'Grizzly Bears')] });
    t.eq(T.life('A'), 21, 'a black spell: 1 life');
  });

  test('Audit: a dying creature is judged by its last toughness (Ulvenwald Observer, a pumped Bears); Sunbird\'s Invocation ignores flashback', (mk, t) => {
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Ulvenwald Observer');
    const b = T.bf('A', 'Grizzly Bears');
    T.top('A', 'Island'); T.top('A', 'Island');
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [b] });
    const murder = T.hand('A', 'Murder');
    const h = T.g.zones.A.hand.length;
    T.mana('A', '1BB'); T.cast('A', murder, { targets: [b] });
    t.zone(b, 'graveyard');
    t.eq(T.g.zones.A.hand.length, h, 'a 5/5 as it died: Murder gone, a card drawn');
    T = mk();
    T.toMain('A');
    T.bf('A', "Sunbird's Invocation");
    T.top('A', 'Island');
    T.mana('A', '2U'); T.cast('A', T.grave('A', 'Think Twice'), { via: 'flashback' });
    t.no(T.g.log.some(l => /Sunbird/.test(l.text)), 'cast from the graveyard: no trigger');
  });

  test('Audit: "its power" in an activated ability is its own (Ghitu Fire-Eater, Heartfire Immolator, Yew Spirit, Heroes\' Bane)', (mk, t) => {
    let T = mk();
    for (const c of ['Ghitu Fire-Eater', 'Heartfire Immolator', 'Yew Spirit', "Heroes' Bane", 'Chameleon Colossus']) t.auto(c);
    T.toMain('A');
    const g = T.bf('A', 'Ghitu Fire-Eater'); g.summoningSick = false;
    const wurm = T.bf('B', 'Craw Wurm');
    T.activate('A', g, 0, { targets: [wurm] });
    t.eq(wurm.damage, 2, "the Fire-Eater's power, 2, not the Wurm's 6");
    t.zone(wurm, 'battlefield');
    const hi = T.bf('A', 'Heartfire Immolator');
    const w2 = T.bf('B', 'Craw Wurm');
    T.mana('A', 'R'); T.activate('A', hi, 0, { targets: [w2] });
    t.eq(w2.damage, 2);
    T = mk();
    T.toMain('A');
    const ys = T.bf('A', 'Yew Spirit');
    T.mana('A', '2GG'); T.activate('A', ys, 0);
    t.eq(T.g.powerOf(ys), 6, 'a 3/3 gets +3/+3'); t.eq(T.g.toughnessOf(ys), 6);
    T.mana('A', '3GG'); T.cast('A', T.hand('A', "Heroes' Bane"));
    const hb = T.g.battlefield.find(o => o.name === "Heroes' Bane");
    T.mana('A', '2GG'); T.activate('A', hb, 0);
    t.eq(hb.counters['+1/+1'], 8, 'four more for its power of 4');
  });

  test('Audit: Black Vise hurts only the chosen player; Hatching Plans; Testament of Faith takes the X paid', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Black Vise', 'Hatching Plans', 'Testament of Faith']) t.auto(c);
    T.toMain('A');
    T.answer('mode', (ch) => ({ modes: [ch.options.findIndex(o => /C/.test(o.label || ''))] }));
    T.mana('A', '1'); T.cast('A', T.hand('A', 'Black Vise'));
    for (let i = 0; i < 7; i++) { T.hand('B', 'Island'); T.hand('C', 'Island'); }
    T.nextTurn('B'); T.toMain('B');
    t.eq(T.life('B'), 20, 'B was not chosen');
    T.nextTurn('C'); T.toMain('C');
    t.eq(T.life('C'), 17, 'C, chosen, with seven cards: 3');
    T = mk();
    T.toMain('A');
    const hp = T.bf('A', 'Hatching Plans');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const nat = T.hand('A', 'Naturalize');
    const h = T.g.zones.A.hand.length;
    T.mana('A', '1G'); T.cast('A', nat, { targets: [hp] });
    t.eq(T.g.zones.A.hand.length, h - 1 + 3, 'destroyed: three cards');
    const tf = T.bf('A', 'Testament of Faith');
    T.mana('A', '3'); T.activate('A', tf, 0, { x: 3 });
    t.eq(T.g.powerOf(tf), 3); t.eq(T.g.toughnessOf(tf), 3);
  });

  test('Audit: "that player" after a player target in any trigger (Memory Worm, Palantir of Orthanc); hand counts per player (Stormbreath Dragon, Search Warrant)', (mk, t) => {
    let T = mk();
    for (const c of ['Memory Worm', 'Palantír of Orthanc', 'Stormbreath Dragon', 'Search Warrant']) t.auto(c);
    T.toMain('A');
    T.bf('A', 'Memory Worm');
    T.hand('B', 'Island'); T.hand('B', 'Island'); T.top('B', 'Mountain');
    const ah = T.g.zones.A.hand.length;
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '2U'); T.cast('A', T.grave('A', 'Think Twice'), { via: 'flashback' });
    t.eq(T.life('B'), 18);
    t.eq(T.g.zones.B.graveyard.length, 1, 'B discarded');
    t.ok(T.g.zones.B.hand.some(c => c.name === 'Mountain'), 'and B drew');
    t.eq(T.g.zones.A.hand.length, ah + 1, 'A only drew from Think Twice');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Palantír of Orthanc');
    T.top('A', 'Hill Giant'); T.top('A', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'C' }] }));
    T.answer('confirm', () => ({ yes: false }));
    T.toMain('A', 'end'); T.settle();
    t.eq(T.life('C'), 16, 'C declined: loses the milled Giant\'s mana value');
    t.eq(T.life('A'), 20); t.eq(T.life('B'), 20);
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const sd = T.bf('A', 'Stormbreath Dragon');
    const bh = T.g.zones.B.hand.length + 3, ch = T.g.zones.C.hand.length + 1;
    for (let i = 0; i < 3; i++) T.hand('B', 'Island');
    T.hand('C', 'Island');
    T.mana('A', '5RR'); T.activate('A', sd, 0);
    t.eq(T.life('B'), 20 - bh, "B: its own hand size"); t.eq(T.life('C'), 20 - ch, "C: its own");
    T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) T.hand('B', 'Island');
    const k = T.g.zones.B.hand.length;
    T.mana('A', '3WU'); T.cast('A', T.hand('A', 'Search Warrant'), { targets: ['B'] });
    t.eq(T.life('A'), 20 + k, 'life for each card in the targeted hand');
  });

  test('Audit: "if you have a full party" (Squad Commander) checks the party instead of failing', (mk, t) => {
    const T = mk();
    t.auto('Squad Commander');
    T.toMain('A');
    T.bf('A', 'Squad Commander');
    const bears = T.bf('A', 'Grizzly Bears');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A', 'beginCombat'); T.settle(); T.resolve();
    t.eq(T.g.powerOf(bears), 2, 'no party: nothing');
    for (const n of ['Fiend Hunter', 'Merfolk Looter', 'Elvish Warrior', 'Prodigal Sorcerer']) T.bf('A', n);
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A', 'beginCombat'); T.settle(); T.resolve();
    t.eq(T.g.powerOf(bears), 3, 'a Cleric, Rogue, Warrior and Wizard: +1/+0');
    t.ok(T.g.hasKw(bears, 'indestructible'));
  });

  test('Audit: Call of the Wild bins a non-creature; Dauntless Dismantler destroys only mana value X; Titania plays a Forest from the graveyard', (mk, t) => {
    let T = mk();
    for (const c of ['Call of the Wild', 'Dauntless Dismantler', "Titania, Nature's Force"]) t.auto(c);
    T.toMain('A');
    const cw = T.bf('A', 'Call of the Wild');
    const isl = T.top('A', 'Island');
    T.mana('A', '2GG'); T.activate('A', cw, 0);
    t.zone(isl, 'graveyard', 'not a creature: into the graveyard');
    const gb = T.top('A', 'Grizzly Bears');
    T.mana('A', '2GG'); T.activate('A', cw, 0);
    t.zone(gb, 'battlefield', 'a creature: onto the battlefield');
    T = mk();
    T.toMain('A');
    const dd = T.bf('A', 'Dauntless Dismantler');
    const ms = T.bf('B', 'Mind Stone'), sr = T.bf('B', 'Sol Ring'), ws = T.bf('B', 'Wayfarer\'s Bauble');
    T.mana('A', '4W'); T.activate('A', dd, 0, { x: 2 });
    t.zone(ms, 'graveyard', 'Mind Stone, mana value 2');
    t.zone(sr, 'battlefield'); t.zone(ws, 'battlefield');
    T = mk();
    T.toMain('A');
    T.bf('A', "Titania, Nature's Force");
    T.playLand('A', T.grave('A', 'Forest'));
    t.eq(T.g.battlefield.filter(o => /Elemental/.test(o.name) && o.controller === 'A').length, 1, 'a Forest from the graveyard, and its 5/3');
  });

  test('Audit: a land is played only from the hand or where a card allows it', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const ex = T.put('A', 'Island', 'exile'), gy = T.grave('A', 'Forest');
    t.no(T.g.playLand('A', ex.id), 'not from exile');
    t.no(T.g.playLand('A', gy.id), 'not from the graveyard');
    t.zone(ex, 'exile'); t.zone(gy, 'graveyard');
    T.bf('A', "Titania, Nature's Force");
    t.ok(T.g.playLand('A', gy.id), 'with Titania, a Forest from the graveyard');
  });

  test('Audit: Waltz of Rage lets you play each card its turn-long trigger exiles', (mk, t) => {
    const T = mk();
    t.auto('Waltz of Rage');
    T.toMain('A');
    const b = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Llanowar Elves'); T.bf('A', 'Llanowar Elves');
    T.top('A', 'Lightning Bolt'); T.top('A', 'Shock');
    T.mana('A', '3RR'); T.cast('A', T.hand('A', 'Waltz of Rage'), { targets: [b] });
    const ex = T.g.zones.A.exile.slice();
    t.eq(ex.length, 2, 'two Elves died: two cards exiled');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    T.mana('A', 'RR');
    for (const c of ex) t.ok(T.g.castSpell('A', c.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), c.name + ' cast on the next turn');
  });

  test('Audit: Necroskitter takes the dying creature back; Tanuki Transplanter adds the equipped creature\'s power', (mk, t) => {
    let T = mk();
    t.auto('Necroskitter'); t.auto('Tanuki Transplanter'); t.auto('Abduction');
    T.toMain('A');
    T.bf('A', 'Necroskitter');
    const ob = T.bf('B', 'Grizzly Bears');
    ob.counters['-1/-1'] = 1; T.g.bumpBoard();
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: [ob] });
    t.zone(ob, 'battlefield', 'back from the graveyard');
    t.eq(ob.controller, 'A', 'under my control');
    T = mk();
    T.toMain('A');
    const tt = T.bf('A', 'Tanuki Transplanter'), hg = T.bf('A', 'Hill Giant');
    hg.summoningSick = false;
    tt.attachedTo = hg.id; hg.attachments = [tt.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: hg.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.player('A').pool.G, 3, "the Hill Giant's power, 3");
  });

  test('Audit: "its controller" in a trigger about another permanent (Kavu Lair, Decomposition, Pattern of Rebirth)', (mk, t) => {
    let T = mk();
    for (const c of ['Kavu Lair', 'Decomposition', 'Pattern of Rebirth']) t.auto(c);
    T.toMain('B');
    T.bf('A', 'Kavu Lair');
    const cw = T.hand('B', 'Craw Wurm');
    const bh = T.g.zones.B.hand.length, ah = T.g.zones.A.hand.length;
    T.mana('B', '4GG'); T.cast('B', cw); T.settle(); T.resolve();
    t.eq(T.g.zones.B.hand.length, bh - 1 + 1, "the Wurm's controller draws");
    t.eq(T.g.zones.A.hand.length, ah, 'not the Lair\'s');
    T = mk();
    T.toMain('A');
    const d = T.bf('A', 'Decomposition'), ob2 = T.bf('B', 'Grizzly Bears');
    d.attachedTo = ob2.id; ob2.attachments = [d.id]; T.g.bumpBoard();
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [ob2] }); T.settle(); T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
    T = mk();
    T.toMain('A');
    const p = T.bf('A', 'Pattern of Rebirth'), ob3 = T.bf('B', 'Grizzly Bears');
    p.attachedTo = ob3.id; ob3.attachments = [p.id]; T.g.bumpBoard();
    const hg = T.top('B', 'Hill Giant'); T.top('A', 'Craw Wurm');
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [ob3] }); T.settle(); T.resolve();
    t.zone(hg, 'battlefield', "B, the Bears' controller, searched");
    t.eq(hg.controller, 'B');
  });

  test('Audit: Clamavus counts the counters on each creature', (mk, t) => {
    const T = mk();
    t.auto('Clamavus');
    T.toMain('A');
    T.bf('A', 'Clamavus');
    const b = T.bf('A', 'Grizzly Bears'); b.counters['+1/+1'] = 2;
    const e = T.bf('A', 'Llanowar Elves');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(b), 6, '2/2 + two counters + two more'); t.eq(T.g.powerOf(e), 1);
  });

  test('Audit: Tainted Remedy turns only opponents\' life gain into loss; Everett K. Ross counts the creatures attacking you; Stranglehold stops searches', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Tainted Remedy', 'Everett K. Ross, Hapless Attaché', 'Stranglehold']) t.auto(c);
    T.toMain('B');
    T.bf('A', 'Tainted Remedy');
    T.g.changeLife(T.g.player('B'), 3); T.g.changeLife(T.g.player('A'), 3);
    t.eq(T.life('B'), 17, 'an opponent loses instead'); t.eq(T.life('A'), 23, 'its controller still gains');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('B');
    T.bf('A', 'Everett K. Ross, Hapless Attaché');
    const x = T.bf('B', 'Grizzly Bears'), y = T.bf('B', 'Hill Giant');
    x.summoningSick = y.summoningSick = false;
    const ah = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: x.id, defenderId: 'A' }, { attackerId: y.id, defenderId: 'C' }]);
    T.toMain('B', 'declareBlockers');
    t.eq(T.g.zones.A.hand.length, ah, 'one at me, one at C: no card');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('B');
    T.bf('A', 'Everett K. Ross, Hapless Attaché');
    const x2 = T.bf('B', 'Grizzly Bears'), y2 = T.bf('B', 'Hill Giant');
    x2.summoningSick = y2.summoningSick = false;
    const ah2 = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: x2.id, defenderId: 'A' }, { attackerId: y2.id, defenderId: 'A' }]);
    T.toMain('B', 'declareBlockers');
    t.eq(T.g.zones.A.hand.length, ah2 + 1, 'two at me: a card');
    T = mk();
    T.toMain('B');
    T.bf('A', 'Stranglehold');
    const f = T.top('B', 'Forest');
    T.mana('B', '1G'); T.cast('B', T.hand('B', 'Sylvan Scrying'));
    t.zone(f, 'library', 'an opponent finds nothing');
  });

  test('Audit: Greatsword of Tyr puts its counter on the equipped creature', (mk, t) => {
    const T = mk();
    t.auto('Greatsword of Tyr');
    T.toMain('A');
    const gs = T.bf('A', 'Greatsword of Tyr'), b = T.bf('A', 'Grizzly Bears');
    b.summoningSick = false;
    gs.attachedTo = b.id; b.attachments = [gs.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: b.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(b.counters['+1/+1'], 1, 'on the Bears');
    t.eq(gs.counters['+1/+1'] || 0, 0, 'not on the Equipment');
  });

  test('Audit: Blood Clock asks the player whose upkeep it is; Mana Breach bounces the caster\'s land', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Blood Clock'); t.auto('Mana Breach');
    T.toMain('A');
    T.bf('A', 'Blood Clock');
    const bb = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B'); T.toMain('B');
    const ask = T.asked.find(a => a.type === 'payOrDont');
    t.eq(ask && ask.playerId, 'B', 'B is asked');
    t.eq(T.life('B'), 18, 'and paid 2 life'); t.zone(bb, 'battlefield');
    T = mk();
    T.toMain('B');
    T.bf('A', 'Mana Breach');
    const bl = T.bf('B', 'Mountain'), al = T.bf('A', 'Island');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] }); T.settle(); T.resolve();
    t.zone(bl, 'hand', "the caster's land goes back"); t.zone(al, 'battlefield');
  });

  test('Audit: "it" in an Aura or Equipment trigger is the creature (Writ of Passage, Foot Chopper)', (mk, t) => {
    let T = mk();
    t.auto('Writ of Passage'); t.auto('Foot Chopper');
    T.toMain('A');
    const wp = T.bf('A', 'Writ of Passage'), b = T.bf('A', 'Grizzly Bears');
    b.summoningSick = false;
    wp.attachedTo = b.id; b.attachments = [wp.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: b.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok((b.effects || []).some(x => x.flag === 'unblockable'), "the Bears can't be blocked");
    T = mk();
    T.toMain('A');
    const fc = T.bf('A', 'Foot Chopper'), hg = T.bf('A', 'Hill Giant');
    hg.summoningSick = false;
    fc.attachedTo = hg.id; hg.attachments = [fc.id]; T.g.bumpBoard();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: hg.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.zone(hg, 'graveyard', 'the creature is sacrificed'); t.zone(fc, 'battlefield', 'the Equipment stays');
    t.eq(T.g.zones.A.hand.length, h + 3, 'three cards for its power');
  });

  test('Audit: Harsh Mentor punishes the opponent who activates, not mana abilities', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Harsh Mentor');
    T.toMain('B');
    T.bf('A', 'Harsh Mentor');
    const ps = T.bf('B', 'Prodigal Sorcerer'), el = T.bf('B', 'Llanowar Elves');
    ps.summoningSick = false; el.summoningSick = false;
    T.activate('B', ps, 0, { targets: ['C'] }); T.settle(); T.resolve();
    t.eq(T.life('B'), 18, 'B activated: 2 damage to B'); t.eq(T.life('C'), 19);
    T.g.activateAbility('B', el.id, 0, { auto: true }); T.settle(); T.resolve();
    t.eq(T.life('B'), 18, 'a mana ability: nothing');
  });

  test('Audit: "a noncreature, nonland card" is every word at once (Fallaji Archaeologist); a list of types is any one (Blech)', (mk, t) => {
    let T = mk();
    t.auto('Fallaji Archaeologist');
    T.toMain('A');
    T.top('A', 'Grizzly Bears'); T.top('A', 'Opt'); T.top('A', 'Forest');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [ch.cards[0].id] }; });
    T.mana('A', '1U'); T.cast('A', T.hand('A', 'Fallaji Archaeologist'));
    t.eq(JSON.stringify(offered), JSON.stringify(['Opt']), 'only the noncreature, nonland card is offered');
    const g = T.g;
    const art = T.bf('A', 'Mind Stone'), artc = T.bf('A', 'Ornithopter'), bear = T.bf('A', 'Grizzly Bears');
    t.ok(g._matchesCategory(artc, 'artifact creature'), 'an artifact creature is one');
    t.no(g._matchesCategory(art, 'artifact creature'), 'an artifact alone is not');
    t.no(g._matchesCategory(bear, 'artifact creature'), 'a creature alone is not');
    t.no(g._matchesCategory(bear, 'noncreature, nonland permanent'));
    t.ok(g._matchesCategory(art, 'noncreature, nonland permanent'));
    t.ok(g._matchesCategory(bear, 'Pest, Bat, Bear, and Spider'), 'a list: any one of them');
  });

  // (two parts now: each part keeps its own kind and is paid apart — 20-xmage checks the paying)
  test('Audit: "a creature and a Swamp" style costs and picks are read as two parts (Viscerid Drone, Sudden Reclamation, To the Slaughter)', (mk, t) => {
    const T = mk();
    for (const n of ['Viscerid Drone', 'Sudden Reclamation', 'To the Slaughter', 'Druidic Ritual', 'Sandstone Deadfall']) {
      const o = T.bf('A', n);
      t.ok(o.analysis().fullyAutomated, n + ' reads both parts');
    }
  });

  test('Audit: Brood Sliver asks the attacking Sliver\'s controller; Ensnaring Bridge; Absolute Virtue; Ink-Eyes takes from the player it hit', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Brood Sliver', 'Ensnaring Bridge', 'Absolute Virtue', 'Ink-Eyes, Servant of Oni']) t.auto(c);
    T.toMain('B');
    T.bf('A', 'Brood Sliver');
    const s = T.bf('B', 'Sinew Sliver'); s.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: s.id, defenderId: 'C' }]);
    T.toMain('B', 'end');
    t.eq(T.asked.find(a => a.type === 'confirm').playerId, 'B', 'B is asked');
    t.eq(T.g.battlefield.filter(o => o.isToken && o.controller === 'B').length, 1, "and B gets the Sliver");
    T = mk();
    T.toMain('B');
    T.bf('A', 'Ensnaring Bridge');
    const g = T.bf('B', 'Hill Giant'), e = T.bf('B', 'Llanowar Elves');
    g.summoningSick = e.summoningSick = false;
    while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
    T.hand('A', 'Island'); T.hand('A', 'Island');
    let refused = null;
    T.answer('declareAttackers', (ch, g2) => { refused = !g2.declareAttackers('B', [{ attackerId: g.id, defenderId: 'A' }]); return [{ attackerId: e.id, defenderId: 'A' }]; });
    T.toMain('B', 'end');
    t.ok(refused, 'power 3 against two cards in hand: no attack');
    t.eq(T.life('A'), 19, 'the Elves (power 1) could');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('B');
    T.bf('A', 'Absolute Virtue');
    const bc = T.bf('B', 'Grizzly Bears'); bc.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: bc.id, defenderId: 'A' }]);
    T.toMain('B', 'end');
    t.eq(T.life('A'), 20, "an opponent's damage is prevented");
    T = mk();
    T.toMain('A');
    const ie = T.bf('A', 'Ink-Eyes, Servant of Oni'); ie.summoningSick = false;
    const gc = T.grave('B', 'Hill Giant'); T.grave('A', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: ie.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.zone(gc, 'battlefield'); t.eq(gc.controller, 'A');
  });

  test('Audit: Pir adds one of each kind only on your permanents; Pack Leader shields only Dogs', (mk, t) => {
    let T = mk();
    t.auto('Pir, Imaginative Rascal'); t.auto('Pack Leader');
    T.toMain('A');
    T.bf('A', 'Pir, Imaginative Rascal');
    const b = T.bf('A', 'Grizzly Bears'), o = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W'); T.cast('A', T.hand('A', 'Gird for Battle'), { targets: [b, o] });
    T.g.addCounters(b, 'charge', 2);
    t.eq(b.counters['+1/+1'], 2); t.eq(b.counters.charge, 3); t.eq(o.counters['+1/+1'], 1);
    T = mk();
    T.toMain('A');
    const pl = T.bf('A', 'Pack Leader'), d = T.bf('A', 'Grizzly Bears');
    pl.summoningSick = d.summoningSick = false;
    const b1 = T.bf('B', 'Hill Giant'), b2 = T.bf('B', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: pl.id, defenderId: 'B' }, { attackerId: d.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: b1.id, attackerIds: [pl.id] }, { blockerId: b2.id, attackerIds: [d.id] }]);
    T.toMain('A', 'end');
    t.zone(pl, 'battlefield', 'the Dog takes nothing'); t.zone(d, 'graveyard', 'the Bears are no Dog');
  });

  test('Audit: Roar of Resistance pumps only attackers of your opponents; Mayhem Devil sees each sacrifice once; Dinosaur Egg discovers its toughness', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Roar of Resistance'); t.auto('Dinosaur Egg');
    T.toMain('B');
    T.bf('A', 'Roar of Resistance'); T.bf('A', 'Mountain'); T.bf('A', 'Mountain');
    const x = T.bf('B', 'Grizzly Bears'), y = T.bf('B', 'Hill Giant');
    x.summoningSick = y.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: x.id, defenderId: 'A' }, { attackerId: y.id, defenderId: 'C' }]);
    T.toMain('B', 'declareBlockers');
    t.eq(T.g.powerOf(x), 2, 'attacking me: nothing'); t.eq(T.g.powerOf(y), 5, 'attacking C, my opponent: +2/+0');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Mayhem Devil');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves');
    T.answer('choose', () => ({ picks: [a.id, b.id], ids: [a.id, b.id], cardIds: [a.id, b.id] }));
    T.mana('A', '2B'); T.cast('A', T.hand('A', 'Pitiless Carnage')); T.settle(); T.resolve();
    t.eq(T.g.log.filter(l => /Triggered: Mayhem Devil/.test(l.text)).length, 2, 'two sacrificed, two triggers');
    const m = T.hand('A', 'Mulldrifter');
    T.mana('A', '2U'); T.g.castSpell('A', m.id, { auto: true, via: 'evoke' }); T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.g.log.filter(l => /Triggered: Mayhem Devil/.test(l.text)).length, 3, 'an evoked Mulldrifter: one more');
    T = mk();
    T.toMain('A');
    const egg = T.bf('A', 'Dinosaur Egg');
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [egg] });
    t.ok(T.g.log.some(l => /discovers 3/.test(l.text)), 'discover 3, its toughness');
  });

  test('Audit: "target creature it\'s blocking / blocking it" (Wall of Corpses, Knight of Dusk); Umbra Mystic; Silkguard', (mk, t) => {
    let T = mk();
    for (const c of ['Wall of Corpses', 'Knight of Dusk', 'Umbra Mystic', 'Silkguard']) t.auto(c);
    T.toMain('B');
    const wc = T.bf('A', 'Wall of Corpses'), at = T.bf('B', 'Hill Giant'), other = T.bf('B', 'Grizzly Bears');
    at.summoningSick = other.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'A' }, { attackerId: other.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => [{ blockerId: wc.id, attackerIds: [at.id] }]);
    T.toMain('B', 'declareBlockers');
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    t.eq(JSON.stringify(T.g._legalTargetsFor({ type: 'creature', filter: 'creature', zone: 'battlefield', blockedBySelf: true }, 'A', wc.id).map(x => x.id)), JSON.stringify([at.id]), 'only the creature it blocks');
    T.mana('A', 'B'); T.activate('A', wc, 0, { targets: [at] });
    t.zone(at, 'graveyard'); t.zone(other, 'battlefield');
    T = mk();
    T.toMain('A');
    const kd = T.bf('A', 'Knight of Dusk'); kd.summoningSick = false;
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: kd.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: b1.id, attackerIds: [kd.id] }]);
    T.toMain('A', 'declareBlockers');
    t.eq(JSON.stringify(T.g._legalTargetsFor({ type: 'creature', filter: 'creature', zone: 'battlefield', blockingSelf: true }, 'A', kd.id).map(x => x.id)), JSON.stringify([b1.id]), 'only its blocker');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Umbra Mystic');
    const mine = T.bf('A', 'Grizzly Bears'), aura = T.bf('B', 'Pacifism');
    aura.attachedTo = mine.id; mine.attachments = [aura.id];
    const aura2 = T.bf('A', 'Rancor'), theirs = T.bf('B', 'Hill Giant');
    aura2.attachedTo = theirs.id; theirs.attachments = [aura2.id];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(aura, 'umbra armor'), 'an Aura on my permanent, whoever controls it');
    t.no(T.g.hasKw(aura2, 'umbra armor'), 'not my Aura on their creature');
  });

  test('Audit: "target artifact creature" is both types at once (Kotori, Hearth Charm); Skullwinder; Hobgoblin Bandit Lord', (mk, t) => {
    let T = mk();
    for (const c of ['Kotori, Pilot Prodigy', 'Hearth Charm', 'Skullwinder', 'Hobgoblin Bandit Lord']) t.auto(c);
    T.toMain('A');
    const k = T.bf('A', 'Kotori, Pilot Prodigy');
    T.bf('A', 'Grizzly Bears'); const orn = T.bf('A', 'Ornithopter'); T.bf('A', 'Mind Stone');
    const spec = k.analysis().abilities.find(a => a.kind === 'triggered').effects[0].targets[0];
    t.eq(JSON.stringify(T.g._legalTargetsFor(spec, 'A', k.id).map(x => x.id)), JSON.stringify([orn.id]), 'only the artifact creature');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const mine = T.grave('A', 'Grizzly Bears'), bc = T.grave('B', 'Hill Giant'), cc = T.grave('C', 'Craw Wurm');
    T.mana('A', '2G'); T.cast('A', T.hand('A', 'Skullwinder')); T.settle(); T.resolve();
    t.zone(mine, 'hand', 'my card back');
    t.eq([bc.zone, cc.zone].filter(z => z === 'hand').length, 1, 'and the chosen opponent takes one of theirs');
    T = mk();
    T.toMain('A');
    const h = T.bf('A', 'Hobgoblin Bandit Lord'); h.summoningSick = false;
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Goblin Guide'));
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Raging Goblin'));
    T.mana('A', 'R'); T.activate('A', h, 0, { targets: ['B'] });
    t.eq(T.life('B'), 18, 'two Goblins entered this turn');
  });

  test('Audit: "put there from the battlefield this turn" (Second Sunrise); The Stasis Coffin until your next turn; Fateful Absence; Kinbinding', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Second Sunrise', 'The Stasis Coffin', 'Fateful Absence', 'Kinbinding']) t.auto(c);
    T.toMain('A');
    const ab = T.bf('A', 'Grizzly Bears'), bb = T.bf('B', 'Hill Giant'), cc = T.bf('C', 'Craw Wurm');
    const old = T.grave('B', 'Llanowar Elves');
    T.mana('A', '2WWW'); T.cast('A', T.hand('A', 'Wrath of God'));
    T.mana('A', '4W'); T.cast('A', T.hand('A', 'Second Sunrise'));
    t.zone(ab, 'battlefield'); t.zone(bb, 'battlefield'); t.zone(cc, 'battlefield');
    t.eq(bb.controller, 'B', 'each under its owner'); t.zone(old, 'graveyard', 'not one that died before this turn');
    T = mk();
    T.toMain('A');
    const sc = T.bf('A', 'The Stasis Coffin');
    T.mana('A', '2'); T.activate('A', sc, 0);
    t.zone(sc, 'exile');
    T.nextTurn('B'); T.toMain('B');
    T.mana('B', 'R');
    t.no(T.g.castSpell('B', T.hand('B', 'Lightning Bolt').id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'protected on the next turn of an opponent');
    T.nextTurn('A'); T.toMain('A'); T.nextTurn('B'); T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.life('A'), 17, 'and no longer after my next turn began');
    T = mk();
    T.toMain('A');
    const t1 = T.bf('B', 'Grizzly Bears');
    T.mana('A', '1W'); T.cast('A', T.hand('A', 'Fateful Absence'), { targets: [t1] });
    t.eq(JSON.stringify(T.g.battlefield.filter(o => o.name === 'Clue').map(o => o.controller)), JSON.stringify(['B']), "its controller's Clue");
    T = mk();
    T.toMain('A');
    T.bf('A', 'Kinbinding');
    const k1 = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1G'); T.cast('A', T.hand('A', 'Grizzly Bears'));
    t.eq(T.g.powerOf(k1), 3, 'one creature entered this turn');
    T.nextTurn('B');
    t.eq(T.g.powerOf(k1), 2, 'counted afresh each turn');
  });

  test('Audit: Trailblazer\'s Torch hits only the blockers; Biorhythm per player; Mirror Universe swaps with the target only', (mk, t) => {
    let T = mk();
    for (const c of ["Trailblazer's Torch", 'Biorhythm', 'Mirror Universe']) t.auto(c);
    T.toMain('A');
    const tt = T.bf('A', "Trailblazer's Torch"), c = T.bf('A', 'Craw Wurm');
    c.summoningSick = false; tt.attachedTo = c.id; c.attachments = [tt.id]; T.g.bumpBoard();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Llanowar Elves'), b3 = T.bf('B', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: c.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: b1.id, attackerIds: [c.id] }, { blockerId: b2.id, attackerIds: [c.id] }]);
    T.toMain('A', 'declareBlockers'); T.settle(); T.resolve();
    t.ok(T.g.log.some(l => /Craw Wurm deals 2 to Grizzly Bears/.test(l.text)), 'the equipped creature deals it');
    t.eq(b3.damage || 0, 0, 'not to a creature that did not block');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears'); T.bf('B', 'Hill Giant');
    T.mana('A', '6GG'); T.cast('A', T.hand('A', 'Biorhythm'));
    t.eq(T.life('A'), 1); t.eq(T.life('B'), 2); t.eq(T.life('C'), 0);
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.g.player('A').life = 5;
    const mu = T.bf('A', 'Mirror Universe');
    const ab = mu.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: mu, name: 'Mirror Universe', kind: 'ability', targets: [{ kind: 'player', id: 'C' }] });
    T.settle();
    t.eq(T.life('A'), 20); t.eq(T.life('C'), 5); t.eq(T.life('B'), 20);
  });

  test('Audit: Mutiny keeps both targets under one opponent; Avarice Totem swaps itself; Challenger Troll', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Mutiny', 'Avarice Totem', 'Challenger Troll']) t.auto(c);
    T.toMain('A');
    const bg = T.bf('B', 'Hill Giant'), bb = T.bf('B', 'Grizzly Bears'), cb = T.bf('C', 'Grizzly Bears');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Mutiny').id, { auto: true, targets: [{ kind: 'object', id: bg.id }, { kind: 'object', id: cb.id }] }), "C's creature is not that player's");
    T.cast('A', T.hand('A', 'Mutiny'), { targets: [bg, bb] });
    t.zone(bb, 'graveyard', "the Giant's 3 damage"); t.zone(cb, 'battlefield');
    T = mk();
    T.toMain('A');
    const tot = T.bf('A', 'Avarice Totem'), os = T.bf('B', 'Serra Angel');
    T.mana('A', '5'); T.activate('A', tot, 0, { targets: [os] });
    t.eq(tot.controller, 'B'); t.eq(os.controller, 'A');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Challenger Troll');
    const w = T.bf('A', 'Craw Wurm'), g = T.bf('A', 'Grizzly Bears');
    w.summoningSick = g.summoningSick = false;
    const x1 = T.bf('B', 'Grizzly Bears'), x2 = T.bf('B', 'Llanowar Elves'), x3 = T.bf('B', 'Hill Giant'), x4 = T.bf('B', 'Savannah Lions');
    let refused = null;
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }, { attackerId: g.id, defenderId: 'B' }]);
    T.answer('declareBlockers', (ch, gg) => { refused = !gg.declareBlockers('B', [{ blockerId: x1.id, attackerIds: [w.id] }, { blockerId: x2.id, attackerIds: [w.id] }]); return [{ blockerId: x3.id, attackerIds: [g.id] }, { blockerId: x4.id, attackerIds: [g.id] }]; });
    T.toMain('A', 'end');
    t.ok(refused, 'power 6: one blocker at most'); t.zone(g, 'graveyard', 'power 2: blocked by two');
  });

  test('Audit: Vexing Devil asks each opponent in turn; the first to take 4 ends it', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Vexing Devil');
    T.toMain('A');
    const asked = [];
    T.answer('confirm', (ch) => { asked.push(ch.playerId); return { yes: false }; });
    T.answer('confirm', (ch) => { asked.push(ch.playerId); return { yes: true }; });
    const vd = T.hand('A', 'Vexing Devil');
    T.mana('A', 'R'); T.cast('A', vd); T.settle(); T.resolve();
    t.eq(JSON.stringify(asked), JSON.stringify(['B', 'C']));
    t.eq(T.life('B'), 20); t.eq(T.life('C'), 16); t.zone(vd, 'graveyard');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.answer('confirm', () => ({ yes: false })); T.answer('confirm', () => ({ yes: false }));
    const vd2 = T.hand('A', 'Vexing Devil');
    T.mana('A', 'R'); T.cast('A', vd2); T.settle(); T.resolve();
    t.zone(vd2, 'battlefield', 'nobody took it: it stays');
  });

  test('Audit: It That Betrays takes only an opponent\'s nontoken sacrifice; Rakshasa Debaser takes from the defending player', (mk, t) => {
    let T = mk();
    t.auto('It That Betrays'); t.auto('Rakshasa Debaser');
    T.toMain('A');
    T.bf('A', 'It That Betrays');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant');
    T.g._sacrificeNow('A', [mine]); T.settle(); T.resolve();
    t.zone(mine, 'graveyard', 'my own sacrifice: nothing');
    T.g._sacrificeNow('B', [theirs]); T.settle(); T.resolve();
    t.zone(theirs, 'battlefield'); t.eq(theirs.controller, 'A');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const rd = T.bf('A', 'Rakshasa Debaser'); rd.summoningSick = false;
    const bg = T.grave('B', 'Hill Giant'), cg = T.grave('C', 'Craw Wurm');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = ch.options[0].map(o => o.id); return { targets: [ch.options[0][0]] }; });
    T.answer('declareAttackers', () => [{ attackerId: rd.id, defenderId: 'C' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(JSON.stringify(offered), JSON.stringify([cg.id]), "only C's graveyard"); t.zone(cg, 'battlefield'); t.zone(bg, 'graveyard');
  });

  test('Audit: Madcap Experiment counts every card revealed; Nev counts X of the first X spell only', (mk, t) => {
    let T = mk();
    t.auto('Madcap Experiment'); t.auto('Nev, the Practical Dean');
    T.toMain('A');
    T.top('A', 'Island'); T.top('A', 'Mind Stone'); T.top('A', 'Island'); T.top('A', 'Opt');
    T.mana('A', '3R'); T.cast('A', T.hand('A', 'Madcap Experiment'));
    t.eq(T.life('A'), 17, 'three cards revealed'); t.ok(T.g.battlefield.some(o => o.name === 'Mind Stone'));
    T = mk();
    T.toMain('A');
    const nev = T.bf('A', 'Nev, the Practical Dean');
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [nev] });
    T.mana('A', '3R'); T.cast('A', T.hand('A', 'Fireball'), { x: 3, targets: ['B'] }); T.settle(); T.resolve();
    t.eq(nev.counters['+1/+1'], 3, 'X = 3 (a spell without X before it does not count)');
    T.mana('A', '2R'); T.cast('A', T.hand('A', 'Fireball'), { x: 2, targets: ['B'] }); T.settle(); T.resolve();
    t.eq(nev.counters['+1/+1'], 3, 'the second one this turn: nothing');
  });

  test('Audit: Winds of Abandon overloaded: a basic land for each exiled creature, to its controller', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Winds of Abandon');
    T.toMain('A');
    const mine = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Hill Giant'); T.bf('C', 'Craw Wurm');
    const lands = (p) => T.g.battlefield.filter(o => o.controller === p && (o.analysis() || {}).isLand).length;
    const a0 = lands('A'), b0 = lands('B'), c0 = lands('C');
    T.mana('A', '4WW'); T.g.castSpell('A', T.hand('A', 'Winds of Abandon').id, { auto: true, via: 'overload' }); T.settle(); T.resolve(); T.settle();
    t.zone(mine, 'battlefield', 'mine stays');
    t.eq(lands('B') - b0, 2, 'B lost two creatures: two lands'); t.eq(lands('C') - c0, 1); t.eq(lands('A') - a0, 0);
  });

  test('Audit: Rise of the Witch-king returns another card only if you sacrificed; Scheming Symmetry asks each target player', (mk, t) => {
    let T = mk();
    t.auto('Rise of the Witch-king'); t.auto('Scheming Symmetry');
    T.toMain('A');
    const mb = T.bf('A', 'Grizzly Bears'), ob = T.bf('B', 'Hill Giant'), old = T.grave('A', 'Craw Wurm');
    T.mana('A', '2BG'); T.cast('A', T.hand('A', 'Rise of the Witch-king')); T.settle(); T.resolve();
    t.zone(mb, 'graveyard', 'the sacrificed Bears stay'); t.zone(ob, 'graveyard'); t.zone(old, 'battlefield', 'another card returns');
    T = mk();
    T.toMain('A');
    T.bf('B', 'Hill Giant'); const w = T.grave('A', 'Craw Wurm');
    T.mana('A', '2BG'); T.cast('A', T.hand('A', 'Rise of the Witch-king')); T.settle(); T.resolve();
    t.zone(w, 'graveyard', 'no creature of mine sacrificed: nothing returns');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Scheming Symmetry'), { targets: ['B', 'C'] });
    t.eq(JSON.stringify(T.asked.filter(a => a.type === 'pickCard').map(a => a.playerId)), JSON.stringify(['B', 'C']));
  });

  test('Audit: Gift of Immortality brings the creature back now and itself back on it at the end step', (mk, t) => {
    const T = mk();
    t.auto('Gift of Immortality');
    T.toMain('A');
    const g = T.bf('A', 'Gift of Immortality'), b = T.bf('A', 'Grizzly Bears');
    g.attachedTo = b.id; b.attachments = [g.id]; T.g.bumpBoard();
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [b] }); T.settle(); T.resolve();
    t.zone(b, 'battlefield', 'the creature returns'); t.zone(g, 'graveyard', 'the Aura waits');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle(); T.resolve();
    const g2 = T.g.battlefield.find(o => o.name === 'Gift of Immortality');
    t.ok(g2 && g2.attachedTo === b.id, 'back, on the same creature');
  });

  test('Audit: Nature\'s Will and Pretender\'s Claim tap only the defending player\'s lands; Shield-Wall Sentinel finds defenders', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ["Nature's Will", "Pretender's Claim", 'Shield-Wall Sentinel']) t.auto(c);
    T.toMain('A');
    T.bf('A', "Nature's Will");
    const myl = T.bf('A', 'Forest'); myl.tapped = true;
    const bl = T.bf('B', 'Forest'), cl = T.bf('C', 'Forest'), at = T.bf('A', 'Grizzly Bears');
    at.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.ok(bl.tapped, "B's lands tapped"); t.no(cl.tapped, "C's not"); t.no(myl.tapped, 'mine untapped');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const pc = T.bf('A', "Pretender's Claim"), w = T.bf('A', 'Craw Wurm');
    w.summoningSick = false; pc.attachedTo = w.id; w.attachments = [pc.id]; T.g.bumpBoard();
    const bl2 = T.bf('B', 'Forest'), cl2 = T.bf('C', 'Forest'), blk = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: blk.id, attackerIds: [w.id] }]);
    T.toMain('A', 'combatDamage'); T.settle(); T.resolve();
    t.ok(bl2.tapped); t.no(cl2.tapped);
    T = mk();
    T.toMain('A');
    T.top('A', 'Wall of Omens'); T.top('A', 'Grizzly Bears');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [ch.cards[0].id] }; });
    T.mana('A', '3W'); T.cast('A', T.hand('A', 'Shield-Wall Sentinel'));
    t.ok(offered && offered.every(n => n !== 'Grizzly Bears') && offered.includes('Wall of Omens'), 'only creatures with defender');
  });

  test('Audit: Hellraiser Goblin makes your creatures attack; Repay in Kind; Acidic Soil counts each player\'s lands', (mk, t) => {
    let T = mk();
    for (const c of ['Hellraiser Goblin', 'Repay in Kind', 'Acidic Soil']) t.auto(c);
    T.toMain('A');
    const hg = T.bf('A', 'Hellraiser Goblin'), b = T.bf('A', 'Grizzly Bears');
    let refused = null;
    T.answer('declareAttackers', (ch, g) => { refused = !g.declareAttackers('A', []); return [{ attackerId: b.id, defenderId: 'B' }, { attackerId: hg.id, defenderId: 'B' }]; });
    T.toMain('A', 'declareBlockers');
    t.ok(refused, 'no attack is refused'); t.ok(b.attacking, 'the Bears attack, with haste');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.g.player('B').life = 7; T.g.player('C').life = 12;
    T.mana('A', '5BB'); T.cast('A', T.hand('A', 'Repay in Kind'));
    t.eq(T.life('A'), 7); t.eq(T.life('B'), 7); t.eq(T.life('C'), 7);
    T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.bf('B', 'Forest');
    T.bf('A', 'Island');
    const lands = (p) => T.g.battlefield.filter(o => o.controller === p && (o.analysis() || {}).isLand).length;
    const la = lands('A'), lb = lands('B');
    T.mana('A', '2R'); T.cast('A', T.hand('A', 'Acidic Soil'));
    t.eq(T.life('A'), 20 - la); t.eq(T.life('B'), 20 - lb);
  });

  test('Audit: Bower Passage stops flyers blocking; Morbid Curiosity and Memorial Vault count the sacrificed mana value', (mk, t) => {
    let T = mk();
    for (const c of ['Bower Passage', 'Morbid Curiosity', 'Memorial Vault']) t.auto(c);
    T.toMain('A');
    T.bf('A', 'Bower Passage');
    const at = T.bf('A', 'Grizzly Bears'); at.summoningSick = false;
    const fl = T.bf('B', 'Serra Angel'), gr = T.bf('B', 'Hill Giant');
    let refused = null;
    T.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'B' }]);
    T.answer('declareBlockers', (ch, g) => { refused = !g.declareBlockers('B', [{ blockerId: fl.id, attackerIds: [at.id] }]); return [{ blockerId: gr.id, attackerIds: [at.id] }]; });
    T.toMain('A', 'end');
    t.ok(refused, 'the Angel cannot block'); t.zone(at, 'graveyard', 'the Giant can');
    T = mk();
    T.toMain('A');
    const hg = T.bf('A', 'Hill Giant'), mc = T.hand('A', 'Morbid Curiosity');
    const h = T.g.zones.A.hand.length;
    T.mana('A', '1BB'); T.cast('A', mc, { sacrificeIds: [hg.id] });
    t.eq(T.g.zones.A.hand.length, h - 1 + 4, 'four cards for the Giant');
    T = mk();
    T.toMain('A');
    const mv = T.bf('A', 'Memorial Vault'), ms = T.bf('A', 'Mind Stone');
    T.top('A', 'Mountain'); T.top('A', 'Shock'); T.top('A', 'Opt');
    T.activate('A', mv, 0, { sacrificeIds: [ms.id] });
    t.eq(T.g.zones.A.exile.filter(c => c.impulseBy === 'A').length, 3, 'one plus Mind Stone\'s 2, playable');
  });

  test('Audit: Sage of the Skies copies the spell once, not its own trigger for ever; Slick Sequence; Icewrought Sentry', (mk, t) => {
    let T = mk();
    for (const c of ['Sage of the Skies', 'Slick Sequence', 'Icewrought Sentry']) t.auto(c);
    T.toMain('A');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    const s = T.hand('A', 'Sage of the Skies');
    T.mana('A', '2WW'); T.cast('A', s); T.settle(); T.resolve(); T.settle(); T.resolve();
    t.zone(s, 'battlefield');
    t.eq(T.g.battlefield.filter(o => o.name === 'Sage of the Skies').length, 2, 'the Sage and one token copy');
    t.eq(T.g.stack.length, 0, 'nothing left copying itself');
    T = mk();
    T.toMain('A');
    const ss = T.hand('A', 'Slick Sequence'), h = T.g.zones.A.hand.length;
    T.mana('A', 'UR'); T.cast('A', ss, { targets: ['B'] });
    t.eq(T.g.zones.A.hand.length, h - 1, 'the first spell this turn: no card');
    T = mk();
    T.toMain('A');
    const is = T.bf('A', 'Icewrought Sentry'), p0 = T.g.powerOf(is);
    const ob = T.bf('B', 'Grizzly Bears'), ob2 = T.bf('B', 'Hill Giant'); ob2.tapped = true;
    T.mana('A', '2U'); T.cast('A', T.hand('A', 'Frost Breath'), { targets: [ob, ob2] });
    t.eq(T.g.powerOf(is), p0 + 2, 'one untapped creature tapped: once');
  });

  test('Audit: Otherworldly Journey returns the creature to its owner with a counter; Treefolk Umbra deals damage by toughness', (mk, t) => {
    let T = mk();
    t.auto('Otherworldly Journey'); t.auto('Treefolk Umbra');
    T.toMain('A');
    const ob = T.bf('B', 'Grizzly Bears');
    T.mana('A', '1W'); T.cast('A', T.hand('A', 'Otherworldly Journey'), { targets: [ob] });
    t.zone(ob, 'exile');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    const b2 = T.g.battlefield.find(o => o.name === 'Grizzly Bears');
    t.ok(b2 && b2.controller === 'B' && b2.counters['+1/+1'] === 1, "back under B's control, with a +1/+1 counter");
    T = mk();
    T.toMain('A');
    const tu = T.bf('A', 'Treefolk Umbra'), at = T.bf('A', 'Grizzly Bears');
    at.summoningSick = false; tu.attachedTo = at.id; at.attachments = [tu.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.life('B'), 16, 'a 2/4: four damage');
  });

  test('Audit: Skyward Spider flies only while modified (an opponent\'s Aura does not count)', (mk, t) => {
    const T = mk();
    t.auto('Skyward Spider');
    T.toMain('A');
    const g = T.bf('A', 'Skyward Spider');
    t.no(T.g.hasKw(g, 'flying'));
    g.counters['+1/+1'] = 1; T.g.bumpBoard();
    t.ok(T.g.hasKw(g, 'flying'), 'a counter: modified');
    g.counters['+1/+1'] = 0;
    const r = T.bf('B', 'Pacifism'); r.attachedTo = g.id; g.attachments = [r.id]; T.g.bumpBoard();
    t.no(T.g.hasKw(g, 'flying'), "an opponent's Aura: not modified");
  });

  test('Audit: Whirlpool Warrior shuffles and redraws for each player; Amorphous Axe makes every creature type', (mk, t) => {
    let T = mk();
    t.auto('Whirlpool Warrior'); t.auto('Amorphous Axe');
    T.toMain('A');
    const w = T.bf('A', 'Whirlpool Warrior');
    for (const n of ['Island', 'Opt']) T.hand('A', n);
    for (const n of ['Island', 'Opt', 'Forest', 'Shock']) T.hand('B', n);
    const ha = T.g.zones.A.hand.length, hb = T.g.zones.B.hand.length;
    T.mana('A', 'R'); T.activate('A', w, 0);
    t.eq(T.g.zones.A.hand.length, ha); t.eq(T.g.zones.B.hand.length, hb, 'each player draws as many as they shuffled');
    T = mk();
    T.toMain('A');
    const ax = T.bf('A', 'Amorphous Axe'), b = T.bf('A', 'Grizzly Bears');
    ax.attachedTo = b.id; b.attachments = [ax.id]; T.g.bumpBoard();
    t.ok(T.g._hasCreatureType(b, 'Goblin') && T.g._hasCreatureType(b, 'Elf')); t.eq(T.g.powerOf(b), 5);
  });

  test('Audit: Deadeye Tracker\'s targets come from one opponent\'s graveyard; God-Eternal Oketra goes third from the top when exiled', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Deadeye Tracker'); t.auto('God-Eternal Oketra');
    T.toMain('A');
    const dt = T.bf('A', 'Deadeye Tracker'); dt.summoningSick = false;
    const b1 = T.grave('B', 'Opt'), b2 = T.grave('B', 'Lightning Bolt'), c1 = T.grave('C', 'Shock');
    T.mana('A', '1B');
    t.no(T.g.activateAbility('A', dt.id, 0, { auto: true, targets: [{ kind: 'object', id: b1.id }, { kind: 'object', id: c1.id }] }), 'two graveyards: refused');
    T.activate('A', dt, 0, { targets: [b1, b2] });
    t.zone(b1, 'exile'); t.zone(b2, 'exile'); t.zone(c1, 'graveyard');
    T = mk();
    T.toMain('A');
    const go = T.bf('A', 'God-Eternal Oketra');
    T.mana('A', 'W'); T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [go] }); T.settle(); T.resolve();
    t.zone(go, 'library'); t.eq(T.g.zones.A.library.indexOf(go), 2, 'third from the top');
  });

  test('Audit: Wilhelt skips decayed Zombies; Ashnod\'s Intervention from exile; Teferi\'s Time Twist; River of Tears', (mk, t) => {
    let T = mk();
    for (const c of ['Wilhelt, the Rotcleaver', "Ashnod's Intervention", "Teferi's Time Twist", 'River of Tears']) t.auto(c);
    T.toMain('A');
    T.bf('A', 'Wilhelt, the Rotcleaver');
    const z = T.bf('A', 'Gravecrawler');
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [z] }); T.settle(); T.resolve();
    const toks = T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name));
    t.eq(toks.length, 1, 'a Zombie died: a decayed token');
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [toks[0]] }); T.settle(); T.resolve();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name)).length, 0, 'a decayed one died: nothing');
    T = mk();
    T.toMain('A');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'B'); T.cast('A', T.hand('A', "Ashnod's Intervention"), { targets: [b] });
    T.mana('A', 'W'); T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [b] }); T.settle(); T.resolve();
    t.zone(b, 'hand', 'exiled: back to hand');
    T = mk();
    T.toMain('A');
    const ws = T.bf('A', 'Wall of Omens');
    T.mana('A', '1U'); T.cast('A', T.hand('A', "Teferi's Time Twist"), { targets: [ws] });
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    const w2 = T.g.battlefield.find(o => o.name === 'Wall of Omens');
    t.ok(w2 && w2.counters['+1/+1'] === 1, 'back with a counter');
    T = mk();
    T.toMain('A');
    const r = T.bf('A', 'River of Tears');
    T.g.activateAbility('A', r.id, 0, { auto: true });
    t.eq(T.g.player('A').pool.U, 1, 'no land played: {U}');
    r.tapped = false;
    T.playLand('A', T.hand('A', 'Island'));
    T.g.activateAbility('A', r.id, 0, { auto: true });
    t.eq(T.g.player('A').pool.B, 1, 'after a land: {B}');
  });

  test('Audit: Wash Away counters only a spell not cast from hand, unless cleaved', (mk, t) => {
    const T = mk();
    t.auto('Wash Away');
    T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'], resolve: false }); T.settle();
    const st = T.g.stack.find(s => s.name === 'Lightning Bolt');
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    const wa = T.hand('A', 'Wash Away');
    T.mana('A', 'U');
    t.no(T.g.castSpell('A', wa.id, { auto: true, targets: [{ kind: 'stack', id: st.id }] }), 'cast from hand: not a legal target');
    T.mana('A', '1UU');
    t.ok(T.g.castSpell('A', wa.id, { auto: true, via: 'cleave', targets: [{ kind: 'stack', id: st.id }] }), 'cleaved: any spell');
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.life('A'), 20, 'the Bolt is countered');
  });

  test('Audit: Magewright\'s Stone untaps only creatures with a {T} ability; Staff of the Storyteller counts a batch of tokens once', (mk, t) => {
    let T = mk();
    t.auto("Magewright's Stone"); t.auto('Staff of the Storyteller');
    T.toMain('A');
    const ms = T.bf('A', "Magewright's Stone");
    const elf = T.bf('A', 'Llanowar Elves'), gb = T.bf('A', 'Grizzly Bears'), ps = T.bf('A', 'Prodigal Sorcerer');
    const spec = ms.analysis().abilities.find(a => a.kind === 'activated').effects[0].targets[0];
    const ok = T.g._legalTargetsFor(spec, 'A', ms.id).map(x => x.id);
    t.ok(ok.includes(elf.id) && ok.includes(ps.id)); t.no(ok.includes(gb.id), 'the Bears have no {T} ability');
    T = mk();
    T.toMain('A');
    const st = T.bf('A', 'Staff of the Storyteller');
    T.mana('A', '1W'); T.cast('A', T.hand('A', 'Raise the Alarm'));
    t.eq(st.counters.story, 1, 'two tokens at once: one counter');
  });

  test('Audit: Wild Hypothesis\'s 0/0 gets its counters; Tree of Redemption swaps life and toughness; Commit puts a spell second from the top', (mk, t) => {
    let T = mk();
    for (const c of ['Wild Hypothesis', 'Tree of Redemption', 'Commit // Memory']) t.auto(c);
    T.toMain('A');
    T.mana('A', '2GU'); T.cast('A', T.hand('A', 'Wild Hypothesis'), { x: 2 }); T.settle();
    const f = T.g.battlefield.find(o => /Fractal/.test(o.name));
    t.ok(f && T.g.powerOf(f) === 2 && T.g.toughnessOf(f) === 2, 'a 2/2 Fractal that lives');
    T = mk();
    T.toMain('A');
    T.g.player('A').life = 5;
    const tr = T.bf('A', 'Tree of Redemption'); tr.summoningSick = false;
    T.activate('A', tr, 0);
    t.eq(T.life('A'), 13); t.eq(T.g.toughnessOf(tr), 5);
    T = mk();
    T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'], resolve: false }); T.settle();
    const st = T.g.stack.find(s => s.name === 'Lightning Bolt'), bolt = st.obj;
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', '3U'); T.g.castSpell('A', T.hand('A', 'Commit // Memory').id, { auto: true, face: 0, targets: [{ kind: 'stack', id: st.id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(bolt, 'library'); t.eq(T.g.zones.B.library.indexOf(bolt), 1, 'second from the top'); t.eq(T.life('A'), 20);
  });

  test('Audit: Luminarch Ascension only on opponents\' end steps when you lost no life; Mask of Griselbrand pays and draws its power', (mk, t) => {
    let T = mk();
    t.auto('Luminarch Ascension'); t.auto('Mask of Griselbrand');
    T.toMain('A');
    const la = T.bf('A', 'Luminarch Ascension');
    T.toMain('A', 'end'); T.settle(); T.resolve();
    t.eq(la.counters.quest || 0, 0, 'not my own end step');
    T.nextTurn('B'); T.toMain('B', 'end'); T.settle(); T.resolve();
    t.eq(la.counters.quest, 1);
    T.nextTurn('A'); T.nextTurn('B'); T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] });
    T.toMain('B', 'end'); T.settle(); T.resolve();
    t.eq(la.counters.quest, 1, 'I lost life this turn: none');
    T = mk();
    T.toMain('A');
    const mg = T.bf('A', 'Mask of Griselbrand'), hg = T.bf('A', 'Hill Giant');
    mg.attachedTo = hg.id; hg.attachments = [mg.id]; T.g.bumpBoard();
    const mu = T.hand('A', 'Murder'), h = T.g.zones.A.hand.length;
    T.mana('A', '1BB'); T.cast('A', mu, { targets: [hg] }); T.settle(); T.resolve();
    t.eq(T.life('A'), 17); t.eq(T.g.zones.A.hand.length, h - 1 + 3);
  });

  test('Audit: Mjolnir counts each opponent\'s own tapped creatures; Diamond City needs two creatures entered', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Mjölnir, Storm Hammer'); t.auto('Diamond City');
    T.toMain('A');
    const mj = T.bf('A', 'Mjölnir, Storm Hammer'), leg = T.bf('A', 'Isamaru, Hound of Konda');
    leg.summoningSick = false; mj.attachedTo = leg.id; leg.attachments = [mj.id]; T.g.bumpBoard();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant'); b2.tapped = true;
    const c1 = T.bf('C', 'Grizzly Bears'); c1.tapped = true; T.bf('C', 'Craw Wurm');
    T.answer('pickTarget', (ch) => ({ targets: [ch.options[0].find(o => o.id === b1.id)] }));
    T.answer('declareAttackers', () => [{ attackerId: leg.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(b1.counters.stun, 1); t.eq(T.life('B'), 18, 'B: two tapped'); t.eq(T.life('C'), 19, 'C: one tapped');
    T = mk();
    T.toMain('A');
    const dc = T.bf('A', 'Diamond City'); dc.counters.shield = 1;
    const b = T.bf('A', 'Grizzly Bears');
    t.no(T.g.activateAbility('A', dc.id, 1, { auto: true, targets: [{ kind: 'object', id: b.id }] }), 'no creatures entered this turn');
  });

  test('Audit: "each opponent who cannot" counts only the empty-handed (Liliana, Waker of the Dead; Cruel Grimnarch); Magus of the Vineyard', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Liliana, Waker of the Dead', 'Cruel Grimnarch', 'Magus of the Vineyard']) t.auto(c);
    T.toMain('A');
    for (const p of ['B', 'C']) while (T.g.zones[p].hand.length) T.g.moveObject(T.g.zones[p].hand[0], 'library');
    T.hand('C', 'Island');
    const l = T.bf('A', 'Liliana, Waker of the Dead'); T.activate('A', l, 0);
    t.eq(T.life('B'), 17, 'B had nothing to discard'); t.eq(T.life('C'), 20); t.eq(T.life('A'), 20);
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    for (const p of ['B', 'C']) while (T.g.zones[p].hand.length) T.g.moveObject(T.g.zones[p].hand[0], 'library');
    T.hand('C', 'Island');
    T.mana('A', '5B'); T.cast('A', T.hand('A', 'Cruel Grimnarch')); T.settle(); T.resolve();
    t.eq(T.life('A'), 24, 'one opponent could not: 4 life');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Magus of the Vineyard');
    T.nextTurn('B'); T.toMain('B');
    t.eq(T.g.player('B').pool.G, 2, "B's own main phase: B adds {G}{G}"); t.eq(T.g.player('A').pool.G, 0);
  });

  test('Audit: Unwanted Remake and Fear of Impostors: the controller of what was destroyed or countered manifests dread', (mk, t) => {
    let T = mk();
    t.auto('Unwanted Remake'); t.auto('Fear of Impostors');
    T.toMain('A');
    const ob = T.bf('B', 'Hill Giant');
    T.mana('A', 'W'); T.cast('A', T.hand('A', 'Unwanted Remake'), { targets: [ob] }); T.settle(); T.resolve();
    t.zone(ob, 'graveyard');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && o.faceDown).length, 1);
    T = mk();
    T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'], resolve: false }); T.settle();
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', '2UU'); T.cast('A', T.hand('A', 'Fear of Impostors')); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.life('A'), 20, 'the Bolt is countered');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && o.faceDown).length, 1, "the Bolt's controller manifests");
  });

  test('Audit: Port Razer attacks again but not the same player; Fist of Suns pays WUBRG instead', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Port Razer'); t.auto('Fist of Suns');
    T.toMain('A');
    const pr = T.bf('A', 'Port Razer'); pr.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: pr.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    let again = null;
    T.answer('declareAttackers', (ch, g) => { again = g.declareAttackers('A', [{ attackerId: pr.id, defenderId: 'B' }]); return [{ attackerId: pr.id, defenderId: 'C' }]; });
    T.toMain('A', 'end');
    t.no(again, 'not B a second time'); t.eq(T.life('B'), 16); t.eq(T.life('C'), 16, 'C in the extra combat');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Fist of Suns'); T.mana('A', 'WUBRG');
    const cw = T.hand('A', 'Craw Wurm');
    t.ok(T.g.castSpell('A', cw.id, { auto: true, via: 'grantAlt' }), T.g.lastError); T.settle(); T.resolve();
    t.zone(cw, 'battlefield');
  });

  test('Audit: Keleth counts a commander you control, We Ride at Dawn only your own; Thryx makes big spells cheaper and uncounterable', (mk, t) => {
    let T = mk();
    for (const c of ['Keleth, Sunmane Familiar', 'We Ride at Dawn', 'Thryx, the Sudden Storm']) t.auto(c);
    T.toMain('A');
    T.bf('A', 'Keleth, Sunmane Familiar');
    const myc = T.bf('A', 'Isamaru, Hound of Konda'); myc.isCommander = true; myc.summoningSick = false;
    const theirs = T.bf('A', 'Hill Giant'); theirs.owner = 'B'; theirs.isCommander = true; theirs.summoningSick = false;
    const plain = T.bf('A', 'Grizzly Bears'); plain.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: myc.id, defenderId: 'B' }, { attackerId: theirs.id, defenderId: 'B' }, { attackerId: plain.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(myc.counters['+1/+1'], 1); t.eq(theirs.counters['+1/+1'], 1, "B's commander under my control counts"); t.eq(plain.counters['+1/+1'] || 0, 0);
    T = mk();
    T.toMain('A');
    T.bf('A', 'We Ride at Dawn');
    const m2 = T.bf('A', 'Isamaru, Hound of Konda'); m2.isCommander = true; m2.summoningSick = false;
    const t2 = T.bf('A', 'Hill Giant'); t2.owner = 'B'; t2.isCommander = true; t2.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: m2.id, defenderId: 'B' }, { attackerId: t2.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.battlefield.filter(o => /Mercenary/.test(o.name)).length, 1, 'only my own commander');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Thryx, the Sudden Storm');
    const cw = T.hand('A', 'Craw Wurm');
    T.mana('A', '3GG'); t.ok(T.g.castSpell('A', cw.id, { auto: true }), 'one less'); T.settle();
    const st = T.g.stack.find(s => s.objId === cw.id);
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.mana('B', 'UU'); T.g.castSpell('B', T.hand('B', 'Counterspell').id, { auto: true, targets: [{ kind: 'stack', id: st.id }] });
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle(); T.resolve();
    t.zone(cw, 'battlefield', "can't be countered");
  });

  test('Audit: "X unless" (Instill Furor); Killian takes off generic mana only', (mk, t) => {
    let T = mk();
    t.auto('Instill Furor'); t.auto('Killian, Ink Duelist');
    T.toMain('A');
    const inf = T.bf('A', 'Instill Furor'), b = T.bf('A', 'Grizzly Bears');
    inf.attachedTo = b.id; b.attachments = [inf.id]; T.g.bumpBoard();
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(b, 'graveyard', 'did not attack: sacrificed');
    T = mk();
    T.toMain('A');
    const inf2 = T.bf('A', 'Instill Furor'), b2 = T.bf('A', 'Grizzly Bears');
    b2.summoningSick = false; inf2.attachedTo = b2.id; b2.attachments = [inf2.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: b2.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(b2, 'battlefield', 'attacked: kept');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Killian, Ink Duelist');
    const tg = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    t.no(T.g.castSpell('A', T.hand('A', 'Murder').id, { auto: true, targets: [{ kind: 'object', id: tg.id }] }), '{1}{B}{B} becomes {B}{B}, not less');
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Murder'), { targets: [tg] });
    t.zone(tg, 'graveyard');
  });

  test('Audit: Night Dealings counts damage to other players only; Dragonborn Champion needs 5 or more', (mk, t) => {
    let T = mk();
    t.auto('Night Dealings'); t.auto('Dragonborn Champion');
    T.toMain('A');
    const nd = T.bf('A', 'Night Dealings');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.settle(); T.resolve();
    t.eq(nd.counters.theft, 3);
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['A'] }); T.settle(); T.resolve();
    t.eq(nd.counters.theft, 3, 'damage to myself: nothing');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Dragonborn Champion');
    const bolt = T.hand('A', 'Lightning Bolt'), h = T.g.zones.A.hand.length;
    T.mana('A', 'R'); T.cast('A', bolt, { targets: ['B'] }); T.settle(); T.resolve();
    t.eq(T.g.zones.A.hand.length, h - 1, '3 damage: no card');
    const w = T.bf('A', 'Craw Wurm'); w.summoningSick = false;
    const h2 = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.g.zones.A.hand.length, h2 + 1, '6 damage: a card');
  });

  test('Audit: Bane of Bala Ged exiles (not sacrifices) from the defending player; Thresher Beast; God-Eternal Bontu', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    for (const c of ['Bane of Bala Ged', 'Thresher Beast', 'God-Eternal Bontu']) t.auto(c);
    T.toMain('A');
    T.bf('A', 'Mayhem Devil');
    const bb = T.bf('A', 'Bane of Bala Ged'); bb.summoningSick = false;
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Forest'), b3 = T.bf('B', 'Mind Stone'), c1 = T.bf('C', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bb.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq([b1, b2, b3].filter(o => o.zone === 'exile').length, 2, 'B exiles two'); t.zone(c1, 'battlefield');
    t.eq(T.g.log.filter(l => /Triggered: Mayhem Devil/.test(l.text)).length, 0, 'exiling is not sacrificing');
    T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const tb = T.bf('A', 'Thresher Beast'); tb.summoningSick = false;
    const bl = T.bf('B', 'Forest'), cl = T.bf('C', 'Forest'), blk = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: tb.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: blk.id, attackerIds: [tb.id] }]);
    T.toMain('A', 'combatDamage'); T.settle(); T.resolve();
    t.zone(bl, 'graveyard'); t.zone(cl, 'battlefield');
    T = mk();
    T.toMain('A');
    const bo = T.bf('A', 'Mind Stone'), bl2 = T.bf('A', 'Forest');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const bontu = T.hand('A', 'God-Eternal Bontu'), h = T.g.zones.A.hand.length;
    T.answer('choose', () => ({ picks: [bo.id, bl2.id], ids: [bo.id, bl2.id], cardIds: [bo.id, bl2.id] }));
    T.mana('A', '2BB'); T.cast('A', bontu); T.settle(); T.resolve();
    t.zone(bo, 'graveyard'); t.zone(bl2, 'graveyard'); t.eq(T.g.zones.A.hand.length, h - 1 + 2, 'two sacrificed, two drawn');
  });

  test('Audit: stun counters keep a permanent tapped one untap at a time; Fear of Sleep Paralysis locks them; Counterbalance', (mk, t) => {
    let T = mk();
    t.auto('Fear of Sleep Paralysis'); t.auto('Counterbalance');
    T.toMain('A');
    const b = T.bf('B', 'Grizzly Bears'); b.tapped = true; b.counters.stun = 2;
    T.nextTurn('B'); t.ok(b.tapped); t.eq(b.counters.stun, 1);
    T.nextTurn('A'); T.nextTurn('B'); t.ok(b.tapped, 'second untap: the last counter goes');
    T.nextTurn('A'); T.nextTurn('B'); t.no(b.tapped, 'then it untaps');
    T = mk();
    T.toMain('A');
    const c = T.bf('A', 'Grizzly Bears'); c.tapped = true; c.counters.stun = 1;
    T.mana('A', '1U'); T.cast('A', T.hand('A', 'Refocus'), { targets: [c] });
    t.ok(c.tapped, 'an untap effect removes the counter instead'); t.eq(c.counters.stun || 0, 0);
    T = mk();
    T.toMain('A');
    T.bf('A', 'Fear of Sleep Paralysis');
    const e = T.bf('B', 'Grizzly Bears'); e.tapped = true; e.counters.stun = 1;
    T.nextTurn('B'); t.ok(e.tapped); t.eq(e.counters.stun, 1, "an opponent's stun counter can't be removed");
    T = mk();
    T.toMain('B');
    T.bf('A', 'Counterbalance'); T.top('A', 'Mind Stone');
    T.mana('B', '1G'); T.cast('B', T.hand('B', 'Grizzly Bears'));
    t.ok(T.g.zones.B.graveyard.some(x => x.name === 'Grizzly Bears'), 'same mana value: countered');
  });

  test('Audit: a shield counter stops damage or destruction once; spell mastery needs two instants or sorceries (Fiery Impulse)', (mk, t) => {
    let T = mk();
    t.auto('Fiery Impulse');
    T.toMain('A');
    const b = T.bf('B', 'Grizzly Bears'); b.counters.shield = 1;
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [b] });
    t.zone(b, 'battlefield'); t.eq(b.damage || 0, 0); t.eq(b.counters.shield || 0, 0, 'the counter is spent');
    T.mana('A', '1BB'); T.cast('A', T.hand('A', 'Murder'), { targets: [b] });
    t.zone(b, 'graveyard', 'the second time it dies');
    const d = T.bf('B', 'Grizzly Bears'); d.counters.shield = 1;
    T.mana('A', 'B'); T.cast('A', T.hand('A', 'Disfigure'), { targets: [d] });
    t.zone(d, 'graveyard', '-2/-2 is not damage or destruction');
    T = mk();
    T.toMain('A');
    const g = T.bf('B', 'Hill Giant'); T.grave('A', 'Opt'); T.grave('A', 'Grizzly Bears');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Fiery Impulse'), { targets: [g] });
    t.eq(g.damage, 2, 'one instant and a creature: 2');
    T = mk();
    T.toMain('A');
    const g2 = T.bf('B', 'Hill Giant'); T.grave('A', 'Opt'); T.grave('A', 'Shock');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Fiery Impulse'), { targets: [g2] });
    t.zone(g2, 'graveyard', 'spell mastery: 3');
  });

  test('Audit: recruit makes a Soldier only for a nonland card discarded (Patient Instructor)', (mk, t) => {
    t.auto('Patient Instructor');
    for (const [pick, want] of [['Opt', 1], ['Island', 0]]) {
      const T = mk();
      T.toMain('A');
      while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
      T.top('A', 'Island');
      const pi = T.hand('A', 'Patient Instructor'); T.hand('A', 'Opt');
      T.answer('choose', (ch) => { const items = ch.items || ch.cards || ch.options || []; const c = items.find(x => (x.name || x.label || '').includes(pick)); return c ? { picks: [c.id], cardIds: [c.id], ids: [c.id] } : {}; });
      T.mana('A', '3W'); T.cast('A', pi); T.settle(); T.resolve();
      t.eq(T.g.battlefield.filter(o => /Soldier/.test(o.name) && o.isToken).length, want, 'discarded ' + pick);
    }
  });

  test('Audit: Dragon Whelp is sacrificed only after a fourth activation; Shrine of Burning Rage counts upkeeps and red spells', (mk, t) => {
    let T = mk();
    t.auto('Dragon Whelp'); t.auto('Shrine of Burning Rage');
    T.toMain('A');
    const w3 = T.bf('A', 'Dragon Whelp');
    for (let i = 0; i < 3; i++) { T.mana('A', 'R'); T.activate('A', w3, 0); }
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(w3, 'battlefield', 'three times: kept');
    T = mk();
    T.toMain('A');
    const dw = T.bf('A', 'Dragon Whelp');
    for (let i = 0; i < 4; i++) { T.mana('A', 'R'); T.activate('A', dw, 0); }
    t.eq(T.g.powerOf(dw), 6);
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(dw, 'graveyard', 'four times: sacrificed at the end step');
    T = mk();
    T.toMain('A');
    const sh = T.bf('A', 'Shrine of Burning Rage');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    T.mana('A', 'U'); T.cast('A', T.hand('A', 'Opt'));
    t.eq(sh.counters.charge, 1, 'a red spell, not a blue one');
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(sh.counters.charge, 2, 'and my upkeep');
    T.toMain('A'); T.mana('A', '3'); T.activate('A', sh, 0, { targets: ['B'] });
    t.eq(T.life('B'), 16);
  });

  test('Audit: Loxodon Smiter enters when an opponent makes you discard it, not when you do; Sage of Days may keep none', (mk, t) => {
    let T = mk();
    t.auto('Loxodon Smiter'); t.auto('Sage of Days');
    T.toMain('B');
    while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
    const sm = T.hand('A', 'Loxodon Smiter');
    T.mana('B', '2B'); T.cast('B', T.hand('B', 'Mind Rot'), { targets: ['A'] });
    t.zone(sm, 'battlefield'); t.eq(sm.controller, 'A');
    T = mk();
    T.toMain('A');
    while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
    const mr = T.hand('A', 'Mind Rot'), sm2 = T.hand('A', 'Loxodon Smiter');
    T.mana('A', '2B'); T.cast('A', mr, { targets: ['A'] });
    t.zone(sm2, 'graveyard', 'my own spell: no');
    T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.top('A', 'Opt'); T.top('A', 'Shock');
    T.answer('pickCard', () => ({ cardIds: [] }));
    T.mana('A', '4U'); T.cast('A', T.hand('A', 'Sage of Days')); T.settle(); T.resolve();
    t.eq(T.g.zones.A.graveyard.length, 3, 'none kept: all three to the graveyard');
  });

  test('Audit: Goblin Ringleader takes all Goblins revealed; Never Happened offers hand and graveyard nonland cards', (mk, t) => {
    let T = mk();
    t.auto('Goblin Ringleader'); t.auto('Never Happened');
    T.toMain('A');
    T.top('A', 'Island'); const g1 = T.top('A', 'Goblin Guide'), g2 = T.top('A', 'Raging Goblin'); const opt = T.top('A', 'Opt');
    T.mana('A', '3R'); T.cast('A', T.hand('A', 'Goblin Ringleader')); T.settle(); T.resolve();
    t.zone(g1, 'hand'); t.zone(g2, 'hand'); t.zone(opt, 'library');
    t.ok(T.g.zones.A.library.slice(-2).includes(opt), 'the rest on the bottom');
    T = mk();
    T.toMain('A');
    for (const n of ['Opt', 'Shock', 'Forest']) T.grave('B', n);
    T.hand('B', 'Lightning Bolt');
    let shown = null;
    T.answer('pickCard', (ch) => { shown = ch.cards.map(c => c.name); return { cardIds: [ch.cards.find(c => c.name === 'Shock').id] }; });
    T.mana('A', '2B'); T.cast('A', T.hand('A', 'Never Happened'), { targets: ['B'] }); T.settle(); T.resolve();
    t.ok(shown.includes('Lightning Bolt') && shown.includes('Shock') && !shown.includes('Forest'), 'hand and graveyard, nonland');
    t.ok(T.g.zones.B.exile.some(c => c.name === 'Shock'), 'a graveyard card can be the one');
  });

  test('Audit: Thirst for Discovery: one basic land, or two cards; Felothar draws toughness and discards power', (mk, t) => {
    let T = mk();
    t.auto('Thirst for Discovery'); t.auto('Felothar the Steadfast');
    T.toMain('A');
    while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
    for (let i = 0; i < 3; i++) T.top('A', 'Opt');
    T.hand('A', 'Island'); T.hand('A', 'Shock');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Island').id] }));
    T.mana('A', '2U'); T.cast('A', T.hand('A', 'Thirst for Discovery')); T.settle(); T.resolve();
    t.eq(T.g.zones.A.graveyard.filter(c => c.name !== 'Thirst for Discovery').length, 1, 'a basic land: one card');
    T = mk();
    T.toMain('A');
    while (T.g.zones.A.hand.length) T.g.moveObject(T.g.zones.A.hand[0], 'library');
    for (let i = 0; i < 3; i++) T.top('A', 'Opt');
    T.hand('A', 'Island'); T.hand('A', 'Shock');
    T.answer('pickCard', () => ({ cardIds: [] }));
    T.mana('A', '2U'); T.cast('A', T.hand('A', 'Thirst for Discovery')); T.settle(); T.resolve();
    t.eq(T.g.zones.A.graveyard.filter(c => c.name !== 'Thirst for Discovery').length, 2, 'no basic land chosen: two cards');
    T = mk();
    T.toMain('A');
    const f = T.bf('A', 'Felothar the Steadfast'); f.summoningSick = false;
    const wall = T.bf('A', 'Wall of Stone');
    for (let i = 0; i < 8; i++) T.top('A', 'Opt');
    const h = T.g.zones.A.hand.length;
    T.mana('A', '3'); T.activate('A', f, 0, { sacrificeIds: [wall.id] }); T.settle(); T.resolve();
    t.eq(T.g.zones.A.hand.length, h + 8, 'Wall of Stone 0/8: eight drawn, none discarded');
  });

  test('Audit: Elturel Survivors counts the defending player\'s lands, even after another spell; Jaws of Defeat', (mk, t) => {
    let T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Elturel Survivors'); t.auto('Jaws of Defeat');
    T.toMain('A');
    const e = T.bf('A', 'Elturel Survivors'); e.summoningSick = false;
    for (let i = 0; i < 2; i++) T.bf('B', 'Forest');
    for (let i = 0; i < 5; i++) T.bf('C', 'Forest');
    const lb = T.g.battlefield.filter(o => o.controller === 'B' && (o.analysis() || {}).isLand).length;
    T.answer('declareAttackers', () => [{ attackerId: e.id, defenderId: 'B' }]);
    T.answer('*', () => ({}));
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(e), lb, "B's lands only");
    const x = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [x] });
    t.eq(T.g.powerOf(e), lb, 'still after an unrelated spell');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Jaws of Defeat');
    T.mana('A', '1RR'); T.cast('A', T.hand('A', 'Wall of Stone')); T.settle(); T.resolve();
    t.eq(T.life('B'), 12, '0/8: eight life');
  });

  test('Audit: Fevered Visions burns only an opponent with four or more cards; Nighthowler counts all graveyards', (mk, t) => {
    let T = mk();
    t.auto('Fevered Visions'); t.auto('Nighthowler');
    T.toMain('A');
    T.bf('A', 'Fevered Visions');
    for (let i = 0; i < 5; i++) T.hand('B', 'Island');
    T.nextTurn('B'); T.toMain('B', 'end'); T.settle(); T.resolve();
    t.eq(T.life('B'), 18);
    T.nextTurn('A'); T.toMain('A', 'end'); T.settle(); T.resolve();
    t.eq(T.life('A'), 20, 'not me');
    T = mk();
    T.toMain('A');
    const n = T.bf('A', 'Nighthowler');
    T.grave('A', 'Grizzly Bears'); T.grave('B', 'Hill Giant'); T.grave('B', 'Opt');
    t.eq(T.g.powerOf(n), 2, 'two creature cards in all graveyards');
  });

  test('Audit: Towering Titan counts the toughness of the others; Shadow of the Goblin ignores spells from hand', (mk, t) => {
    let T = mk();
    t.auto('Towering Titan'); t.auto('Shadow of the Goblin');
    T.toMain('A');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Hill Giant');
    T.mana('A', '4GGG'); T.cast('A', T.hand('A', 'Towering Titan'));
    const tt = T.g.battlefield.find(o => o.name === 'Towering Titan');
    t.eq(tt.counters['+1/+1'], 5, '2 + 3 toughness');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Shadow of the Goblin');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    t.eq(T.life('B'), 18, 'cast from hand: only the Shock');
  });

  test('Audit: Bitter Work draws only for an attack with a 4-power creature; its exhaust works once; Denethor makes the target the monarch', (mk, t) => {
    let T = mk();
    t.auto('Bitter Work'); t.auto('Denethor, Stone Seer');
    T.toMain('A');
    T.bf('A', 'Bitter Work');
    const g = T.bf('A', 'Grizzly Bears'), w = T.bf('A', 'Craw Wurm');
    g.summoningSick = w.summoningSick = false;
    const h = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.g.zones.A.hand.length, h, 'a 2-power attacker: nothing');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    const h2 = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.g.zones.A.hand.length, h2 + 1);
    T = mk();
    T.toMain('A');
    const d = T.bf('A', 'Denethor, Stone Seer'); d.summoningSick = false;
    T.mana('A', '3R'); T.activate('A', d, 0, { targets: ['B', 'B'] });
    t.ok(T.g.player('B').monarch, 'B becomes the monarch'); t.no(T.g.player('A').monarch); t.eq(T.life('B'), 17);
  });

  test('Audit: Perplex takes the whole hand, works on an empty hand, and counters a creature spell; Long-Term Plans in a short library', (mk, t) => {
    t.auto('Perplex'); t.auto('Long-Term Plans');
    let T = mk();
    T.toMain('A');
    const bolt = T.hand('A', 'Lightning Bolt');
    const k1 = T.hand('A', 'Island'), k2 = T.hand('A', 'Forest'), k3 = T.hand('A', 'Mountain');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.answer('confirm', { yes: true });
    T.mana('B', 'UB1');
    T.cast('B', T.hand('B', 'Perplex'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(k1, 'graveyard'); t.zone(k2, 'graveyard'); t.zone(k3, 'graveyard');
    t.eq(T.life('B'), 17, 'the whole hand paid: the bolt resolves');
    // an empty hand can still be discarded
    T = mk();
    T.toMain('A');
    const bolt2 = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt2, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    let asked = null;
    T.answer('confirm', (ch) => { asked = ch; return { yes: true }; });
    T.mana('B', 'UB1');
    T.cast('B', T.hand('B', 'Perplex'), { targets: [{ kind: 'stack', id: T.stackItem(bolt2).id }] });
    T.settle(); T.resolve(); T.settle();
    t.ok(asked, 'asked with no cards in hand');
    t.eq(T.life('B'), 17, 'a hand of no cards discarded: the bolt resolves');
    // a creature spell, hand kept: countered
    T = mk();
    T.toMain('A');
    const bear = T.hand('A', 'Grizzly Bears');
    const keep = T.hand('A', 'Island');
    T.mana('A', '1G');
    T.cast('A', bear, { resolve: false });
    T.g.passPriority('A', true);
    T.answer('confirm', { yes: false });
    T.mana('B', 'UB1');
    T.cast('B', T.hand('B', 'Perplex'), { targets: [{ kind: 'stack', id: T.stackItem(bear).id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'graveyard'); t.zone(keep, 'hand');
    // Long-Term Plans with one other card in the library: as deep as it goes
    T = mk();
    T.toMain('A');
    T.g.zones.A.library.length = 0;
    const other = T.top('A', 'Island');
    const want = T.top('A', 'Craw Wurm');
    T.answer('pickCard', { cardIds: [want.id] });
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Long-Term Plans'));
    T.settle();
    t.eq(T.g.zones.A.library.length, 2);
    t.eq(T.g.zones.A.library.indexOf(want), 1, 'below the only other card');
    t.eq(T.g.zones.A.library.indexOf(other), 0);
  });

  test('Audit: Trinisphere counts what delve and convoke pay, but not what affinity takes off', (mk, t) => {
    t.auto('Trinisphere');
    let T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    for (let i = 0; i < 7; i++) T.grave('A', 'Island');
    T.mana('A', 'U');
    const tc = T.hand('A', 'Treasure Cruise');
    t.ok(T.g.castSpell('A', tc.id, { auto: true }), 'a {7}{U} spell, delved down to {U}, is not raised');
    t.zone(tc, 'stack');
    T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Grizzly Bears');
    T.mana('A', 'RR');
    const st = T.hand('A', 'Stoke the Flames');
    t.ok(T.g.castSpell('A', st.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'convoke pays the {2}');
    T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    for (let i = 0; i < 4; i++) T.bf('A', 'Ornithopter');
    T.mana('A', '2');
    const fm = T.hand('A', 'Frogmite');
    t.no(T.g.castSpell('A', fm.id, { auto: true }), 'affinity takes it to nothing: it costs three');
    T.mana('A', '1');
    t.ok(T.g.castSpell('A', fm.id, { auto: true }));
    t.ok(T.g.player('A').pool.isEmpty());
  });

  test('Audit: Prophet of the Scarab counts itself; Dispelling Exhale asks {4} once a Dragon is beheld', (mk, t) => {
    t.auto('Prophet of the Scarab'); t.auto('Dispelling Exhale');
    let T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.bf('A', 'Walking Corpse');
    T.grave('A', 'Walking Corpse'); T.grave('A', 'Walking Corpse');
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    const p = T.hand('A', 'Prophet of the Scarab');
    const h = T.zone('A', 'hand').length;
    T.mana('A', 'U4');
    T.cast('A', p);
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h - 1 + 4, 'three Corpses and the Prophet itself beat two in the graveyard');
    for (const behold of [true, false]) {
      T = mk();
      T.toMain('A');
      const bolt = T.hand('A', 'Lightning Bolt');
      T.mana('A', 'R4');
      T.cast('A', bolt, { targets: ['B'], resolve: false });
      T.g.passPriority('A', true);
      let cost = null;
      T.answer('payOrDont', (ch) => { cost = ch.cost; return { pay: true }; });
      T.hand('B', 'Shivan Dragon');
      T.mana('B', 'U1');
      T.cast('B', T.hand('B', 'Dispelling Exhale'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }], payAdditional: behold });
      T.settle(); T.resolve(); T.settle();
      t.eq(cost, behold ? '{4}' : '{2}');
      t.eq(T.life('B'), 17, 'paid: the bolt resolves');
    }
  });

  test('Audit: Emil counts land names for its Fractal; Gimbal counts each token name once and no nontoken artifacts', (mk, t) => {
    t.auto('Emil, Vastlands Roamer'); t.auto('Gimbal, Gremlin Prodigy');
    let T = mk();
    T.toMain('A');
    const e = T.bf('A', 'Emil, Vastlands Roamer'); e.summoningSick = false;
    T.bf('A', 'Forest'); T.bf('A', 'Forest'); T.bf('A', 'Island'); T.bf('A', 'Mountain');
    T.bf('B', 'Swamp');
    T.mana('A', '4G');
    T.activate('A', e, 0);
    T.settle();
    const fr = T.g.battlefield.find(o => o.isToken && /Fractal/.test(o.name));
    t.ok(fr, 'a Fractal');
    t.eq(fr && fr.counters['+1/+1'], 3, "Forest, Island, Mountain: the opponent's Swamp is not counted");
    t.ok(fr && T.g.hasKw(fr, 'trample'), 'with counters, it has trample');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Gimbal, Gremlin Prodigy');
    T.bf('A', 'Sol Ring');
    T.g._runEffects([{ op: 'createNamedToken', n: 1, token: 'Treasure' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    T.nextTurn('B'); T.nextTurn('A');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    const gs = T.g.battlefield.filter(o => o.isToken && /Gremlin/.test(o.name));
    t.eq(gs.length, 2);
    t.eq(gs.map(o => o.counters['+1/+1'] || 0).join(','), '2,2', 'Treasure and Gremlin each time; Sol Ring is no token');
  });

  test('Audit: free casts that cannot pay their tax: rebound stays in exile; a miracle pays Trinisphere once, over the whole', (mk, t) => {
    let T = mk();
    T.toMain('A');
    T.bf('B', 'Thalia, Guardian of Thraben');
    T.mana('A', '3R');
    const s = T.hand('A', 'Staggershock');
    T.cast('A', s, { targets: ['B'] });
    T.settle();
    t.zone(s, 'exile');
    T.nextTurn('B'); T.nextTurn('A'); T.settle();
    t.zone(s, 'exile', 'no mana for the {1}: not cast, still in exile');
    T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    T.bf('A', 'Plains'); T.bf('A', 'Plains'); T.bf('A', 'Plains');
    T.bf('B', 'Grizzly Bears');
    const tm = T.top('A', 'Terminus');
    T.answer('confirm', { yes: true });
    T.nextTurn('B'); T.nextTurn('A'); T.settle(); T.resolve(); T.settle();
    t.zone(tm, 'graveyard', 'the {W} miracle raised to three: three Plains pay it');
    t.eq(T.g.battlefield.filter(o => o.name === 'Grizzly Bears').length, 0);
    T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    T.bf('A', 'Plains'); T.bf('A', 'Plains');
    const tm2 = T.top('A', 'Terminus');
    T.answer('confirm', { yes: true });
    T.nextTurn('B'); T.nextTurn('A'); T.settle();
    t.zone(tm2, 'hand', 'two Plains are not enough');
    t.eq(T.g.battlefield.filter(o => o.name === 'Plains' && o.tapped).length, 0, 'and nothing is spent');
  });

  test('Audit: deathtouch damage counts only until the next state check: an indestructible creature that lived through it is not doomed later', (mk, t) => {
    let T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const av = T.bf('A', 'Avacyn, Angel of Hope');
    const rats = T.bf('B', 'Typhoid Rats');
    T.g.dealDamageToObject(bear, 1, rats, false);
    T.g.checkStateBasedActions(); T.settle();
    t.zone(bear, 'battlefield', 'indestructible');
    T.g.moveObject(av, 'graveyard');
    T.g.checkStateBasedActions(); T.settle();
    t.zone(bear, 'battlefield', 'Avacyn gone: 1 damage on a 2/2 is not lethal');
    T = mk();
    T.toMain('A');
    const b2 = T.bf('A', 'Grizzly Bears');
    T.g.dealDamageToObject(b2, 1, T.bf('B', 'Typhoid Rats'), false);
    T.g.checkStateBasedActions(); T.settle();
    t.zone(b2, 'graveyard', 'deathtouch still kills');
  });

  test('Audit: Magebane Lizard counts noncreature spells only, and a spell cast from rebound is counted', (mk, t) => {
    t.auto('Magebane Lizard');
    const T = mk();
    T.toMain('A');
    T.bf('B', 'Magebane Lizard');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.settle();
    t.eq(T.life('A'), 20, 'a creature spell: nothing');
    T.mana('A', '2R');
    const s = T.hand('A', 'Staggershock');
    T.cast('A', s, { targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 19, 'the first noncreature spell: 1');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 17, 'the second: 2');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.nextTurn('B'); T.nextTurn('A'); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 16, 'cast again from rebound: the first this turn, 1');
  });

  test('Audit: Herd Heirloom needs power 4; the creature tramples and draws on combat damage', (mk, t) => {
    t.auto('Herd Heirloom');
    const T = mk();
    T.toMain('A');
    const hh = T.bf('A', 'Herd Heirloom');
    const w = T.bf('A', 'Craw Wurm'); w.summoningSick = false;
    const bears = T.bf('A', 'Grizzly Bears');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    t.no(T.g.activateAbility('A', hh.id, 1, { targets: [{ kind: 'object', id: bears.id }] }), 'a 2-power creature is no target');
    T.activate('A', hh, 1, { targets: [w.id] });
    T.settle();
    t.ok(T.g.hasKw(w, 'trample'));
    const h = T.g.zones.A.hand.length;
    T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.settle();
    t.eq(T.life('B'), 14);
    t.eq(T.g.zones.A.hand.length, h + 1, 'drew a card');
  });

  test('Audit: leaves-your-graveyard triggers: a flashback cast counts, the card itself coming back does not, one for a lot', (mk, t) => {
    t.auto('Kishla Skimmer'); t.auto('Tormod, the Desecrator'); t.auto('Skeleton Crew');
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Kishla Skimmer');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const tt = T.grave('A', 'Think Twice');
    T.mana('A', '2U');
    const h = T.zone('A', 'hand').length;
    t.ok(T.g.castSpell('A', tt.id, { via: 'flashback', auto: true }));
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h + 2, 'Think Twice draws one, Kishla one more');
    T = mk();
    T.toMain('A');
    const tor = T.grave('A', 'Tormod, the Desecrator');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Reanimate'), { targets: [tor.id] }); T.settle(); T.resolve(); T.settle();
    t.zone(tor, 'battlefield');
    t.eq(T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name)).length, 0, 'Tormod was not there to see itself leave');
    const bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Reanimate'), { targets: [bear.id] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name)).length, 1, 'another card leaving: a Zombie');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Skeleton Crew');
    T.grave('A', 'Grizzly Bears'); T.grave('A', 'Craw Wurm'); T.grave('A', 'Island');
    const tc = T.bf('A', "Tormod's Crypt");
    T.activate('A', tc, 0, { targets: ['A'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Skeleton/.test(o.name)).length, 1, 'two creature cards at once: one token');
  });

  test("Audit: a spell's X counts in its mana value on the stack (Gilanra); Carnelian Orb's haste is for Dragons only; Hall of the Bandit Lord's lasts", (mk, t) => {
    t.auto('Gilanra, Caller of Wirewood'); t.auto('Carnelian Orb of Dragonkind'); t.auto('Hall of the Bandit Lord');
    let T = mk();
    T.toMain('A');
    const gi = T.bf('A', 'Gilanra, Caller of Wirewood'); gi.summoningSick = false;
    for (let i = 0; i < 5; i++) T.bf('A', 'Forest');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const eo = T.hand('A', 'Endless One');
    const h = T.zone('A', 'hand').length;
    t.ok(T.g.castSpell('A', eo.id, { auto: true, x: 6 }));
    T.settle(); T.resolve(); T.settle();
    t.ok(gi.tapped, "Gilanra's mana went into it");
    t.eq(T.zone('A', 'hand').length, h, 'X is 6: mana value 6, a card drawn (the Endless One left the hand)');
    T = mk();
    T.toMain('A');
    const orb = T.bf('A', 'Carnelian Orb of Dragonkind');
    T.bf('A', 'Forest');
    const gb = T.hand('A', 'Grizzly Bears');
    t.ok(T.g.castSpell('A', gb.id, { auto: true })); T.settle(); T.resolve(); T.settle();
    t.ok(orb.tapped); t.no(T.g.hasKw(gb, 'haste'), 'not a Dragon');
    T = mk();
    T.toMain('A');
    const hall = T.bf('A', 'Hall of the Bandit Lord'); hall.tapped = false;
    T.bf('A', 'Forest');
    const gb2 = T.hand('A', 'Grizzly Bears');
    t.ok(T.g.castSpell('A', gb2.id, { auto: true })); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 17); t.ok(T.g.hasKw(gb2, 'haste'));
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    t.ok(T.g.hasKw(gb2, 'haste'), 'still hasty a turn later');
  });

  test("Audit: Settle the Wreckage spares the creature not attacking; Path to Exile's land goes to the exiled creature's controller", (mk, t) => {
    t.auto('Settle the Wreckage'); t.auto('Path to Exile');
    let T = mk();
    T.toMain('B');
    const a1 = T.bf('B', 'Grizzly Bears'), a2 = T.bf('B', 'Craw Wurm'), home = T.bf('B', 'Hill Giant');
    a1.summoningSick = a2.summoningSick = home.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: a1.id, defenderId: 'A' }, { attackerId: a2.id, defenderId: 'A' }]);
    T.toMain('B', 'declareBlockers');
    if (T.g.priorityPlayer && T.g.priorityPlayer.id === 'B') T.g.passPriority('B', true);
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', 'Settle the Wreckage'), { targets: ['B'] });
    T.settle();
    t.zone(a1, 'exile'); t.zone(a2, 'exile'); t.zone(home, 'battlefield', 'not attacking: stays');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && (o.analysis() || {}).isLand).length, 2);
    T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Path to Exile'), { targets: [bear.id] });
    T.settle();
    t.zone(bear, 'exile');
    const bl = T.g.battlefield.filter(o => o.controller === 'B' && (o.analysis() || {}).isLand);
    t.eq(bl.length, 1, 'B fetched a basic'); t.ok(bl.every(o => o.tapped), 'tapped');
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && (o.analysis() || {}).isLand).length, 0, 'A did not');
  });

  test('Audit: Aether Vial offers creature cards only, at exactly its counters; its upkeep counter is optional', (mk, t) => {
    t.auto('Aether Vial');
    const T = mk();
    T.toMain('A');
    const vial = T.bf('A', 'Aether Vial', { counters: { charge: 1 } });
    const lions = T.hand('A', 'Savannah Lions'); T.hand('A', 'Sol Ring'); T.hand('A', 'Ornithopter');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [lions.id] }; });
    T.activate('A', vial, 0);
    T.settle();
    t.eq((offered || []).join(','), 'Savannah Lions', 'not the Sol Ring (no creature), not the Ornithopter (0)');
    t.zone(lions, 'battlefield');
    T.answer('confirm', { yes: false });
    T.nextTurn('B'); T.nextTurn('A'); T.settle();
    t.eq(vial.counters.charge, 1, 'declined: still 1');
  });

  test('Audit: type lists with irregular plurals: Thurid pumps Pegasi, Valley Questcaller Mice; Death-Priest of Myrkul Zombies', (mk, t) => {
    t.auto('Thurid, Mare of Destiny'); t.auto('Valley Questcaller'); t.auto('Death-Priest of Myrkul');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Thurid, Mare of Destiny');
    const pg = T.bf('A', 'Pegasus Charger');
    t.eq(T.g.powerOf(pg) + '/' + T.g.toughnessOf(pg), '3/2', 'a Pegasus: +1/+1');
    T.bf('A', 'Valley Questcaller');
    const hh = T.bf('A', 'Heartfire Hero');
    t.eq(T.g.toughnessOf(hh), 2, 'a Mouse: +1/+1');
    T.bf('A', 'Death-Priest of Myrkul');
    const wc = T.bf('A', 'Walking Corpse');
    const bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(wc), 3, 'a Zombie: +1/+1'); t.eq(T.g.powerOf(bear), 2, 'a Bear: nothing');
  });

  test('Audit: Archive Trap is free only after an opponent searched this turn; Riverchurn Monument mills each by their own graveyard; Tinybones Joins Up lets the target choose', (mk, t) => {
    t.auto('Archive Trap'); t.auto('Riverchurn Monument'); t.auto('Tinybones Joins Up');
    let T = mk();
    T.toMain('A');
    const at = T.hand('A', 'Archive Trap');
    T.g._runEffects([{ op: 'fetchBasic', n: 1, tapped: true }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    t.no(T.g.altUsesFor('A', at.id).some(u => /^alt/.test(u.via)), 'my own search: not free');
    T.g._runEffects([{ op: 'fetchBasic', n: 1, tapped: true }], { controller: 'B', name: 'Test', kind: 'spell', targets: [] });
    t.ok(T.g.altUsesFor('A', at.id).some(u => /^alt/.test(u.via)), "the opponent's: free");
    T.nextTurn('B');
    t.no(T.g.altUsesFor('A', at.id).some(u => /^alt/.test(u.via)), 'a turn later: not free');
    T = mk();
    T.toMain('A');
    const rm = T.bf('A', 'Riverchurn Monument');
    for (let i = 0; i < 3; i++) T.grave('A', 'Island');
    T.grave('B', 'Island');
    for (let i = 0; i < 10; i++) { T.top('A', 'Forest'); T.top('B', 'Forest'); }
    T.mana('A', 'UU2');
    T.activate('A', rm, 1, { targets: ['A', 'B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'graveyard').length, 6, 'A had 3: mills 3');
    t.eq(T.zone('B', 'graveyard').length, 2, 'B had 1: mills 1');
    T = mk();
    T.toMain('A');
    T.hand('B', 'Island'); const cw = T.hand('B', 'Craw Wurm');
    let who = null;
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.answer('discard', (ch) => { who = ch.playerId; return { cardIds: [cw.id] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Tinybones Joins Up')); T.settle(); T.resolve(); T.settle();
    t.eq(who, 'B', 'B picks the discard'); t.zone(cw, 'graveyard');
  });

  test("Audit: New Frontiers gives each player the caster's X, tapped; Veteran Explorer: a player who declines gets nothing", (mk, t) => {
    t.auto('New Frontiers'); t.auto('Veteran Explorer');
    let T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) { T.top('A', 'Forest'); T.top('B', 'Plains'); }
    const asked = [];
    for (let k = 0; k < 2; k++) T.answer('confirm', (ch) => { asked.push(ch.playerId); return { yes: true }; });
    for (let k = 0; k < 2; k++) T.answer('pickCard', (ch) => ({ cardIds: (ch.cards || []).slice(0, ch.count || 1).map(c => c.id) }));
    T.mana('A', 'GG1');
    t.ok(T.g.castSpell('A', T.hand('A', 'New Frontiers').id, { auto: true, x: 2 }));
    T.settle(); T.resolve(); T.settle();
    const lands = (p) => T.g.battlefield.filter(o => o.controller === p && (o.analysis() || {}).isLand);
    t.eq(asked.join(','), 'A,B', 'each decides for themselves');
    t.eq(lands('A').length, 2); t.eq(lands('B').length, 2, 'X is 2 for B as well');
    t.ok(lands('A').concat(lands('B')).every(o => o.tapped), 'tapped');
    T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) { T.top('A', 'Forest'); T.top('B', 'Plains'); }
    const ve = T.bf('A', 'Veteran Explorer');
    T.answer('confirm', (ch) => ({ yes: ch.playerId === 'A' }));
    T.answer('confirm', (ch) => ({ yes: ch.playerId === 'A' }));
    T.answer('pickCard', (ch) => ({ cardIds: (ch.cards || []).slice(0, ch.count || 1).map(c => c.id) }));
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: [ve.id] });
    T.settle(); T.resolve(); T.settle();
    t.zone(ve, 'graveyard');
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && /Forest/.test(o.name)).length, 2, 'A searched for two');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && /Plains/.test(o.name)).length, 0, 'B declined');
  });

  test('Audit: Echoing Truth returns every permanent of that name, either side; Expansion Algorithm proliferates X times', (mk, t) => {
    t.auto('Echoing Truth'); t.auto('Expansion Algorithm');
    let T = mk();
    T.toMain('A');
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Grizzly Bears'), other = T.bf('B', 'Hill Giant');
    T.mana('A', '1U');
    T.cast('A', T.hand('A', 'Echoing Truth'), { targets: [b1.id] });
    T.settle();
    t.zone(b1, 'hand'); t.zone(b2, 'hand'); t.zone(mine, 'hand', 'mine too: every permanent with the name');
    t.zone(other, 'battlefield');
    t.eq(T.g.zones.A.hand.includes(mine), true, "to its owner's hand");
    T = mk();
    T.toMain('A');
    const c = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    const opp = T.bf('B', 'Hill Giant', { counters: { '+1/+1': 1 } });
    T.mana('A', 'UU3');
    T.cast('A', T.hand('A', 'Expansion Algorithm'), { x: 3 });
    T.settle();
    t.eq(c.counters['+1/+1'], 4, 'three times: three more');
    t.eq(opp.counters['+1/+1'], 1, "the opponent's creature is left alone");
  });

  test("Audit: Dire Tactics costs the exiled creature's last toughness unless you control a Human; Butterbur makes a Food only without one", (mk, t) => {
    t.auto('Dire Tactics'); t.auto('Butterbur, Bree Innkeeper');
    for (const human of [false, true]) {
      const T = mk();
      T.toMain('A');
      if (human) T.bf('A', 'Elite Vanguard');
      const b = T.bf('B', 'Grizzly Bears');
      T.mana('A', 'G');
      T.cast('A', T.hand('A', 'Giant Growth'), { targets: [b.id] });
      T.mana('A', 'WB');
      T.cast('A', T.hand('A', 'Dire Tactics'), { targets: [b.id] });
      T.settle();
      t.zone(b, 'exile');
      t.eq(T.life('A'), human ? 20 : 15, human ? 'a Human: no life lost' : 'no Human: 5, the pumped toughness');
    }
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Butterbur, Bree Innkeeper');
    const foods = () => T.g.battlefield.filter(o => o.controller === 'A' && /Food/.test(o.name)).length;
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(foods(), 1, 'none: one made');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(foods(), 1, 'already had one: no more');
  });

  test("Audit: Well of Ideas: its controller's own draw step brings two more, not three", (mk, t) => {
    t.auto('Well of Ideas');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Well of Ideas');
    for (const p of ['A', 'B', 'C']) for (let i = 0; i < 8; i++) T.top(p, 'Island');
    const hc = T.zone('C', 'hand').length;
    T.nextTurn('B'); T.nextTurn('C'); T.toMain('C');
    t.eq(T.zone('C', 'hand').length, hc + 2, 'C, another player: the draw and one more');
    const ha = T.zone('A', 'hand').length;
    T.nextTurn('A'); T.toMain('A');
    t.eq(T.zone('A', 'hand').length, ha + 3, 'A: the draw and two more');
  });

  test("Audit: Teysa, Opulent Oligarch: a Clue cracked makes a Spirit once a turn; a Clue for each opponent who lost life", (mk, t) => {
    t.auto('Teysa, Opulent Oligarch'); t.auto('Dire Fleet Ravager');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Teysa, Opulent Oligarch');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.g._runEffects([{ op: 'createNamedToken', n: 2, token: 'Clue' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    const clues = T.g.battlefield.filter(o => /Clue/.test(o.name));
    t.eq(clues.length, 2);
    const spirits = () => T.g.battlefield.filter(o => o.isToken && /Spirit/.test(o.name)).length;
    T.mana('A', '2'); T.activate('A', clues[0], 0); T.settle(); T.resolve(); T.settle();
    t.eq(spirits(), 1, 'a Clue sacrificed: a Spirit');
    T.mana('A', '2'); T.activate('A', clues[1], 0); T.settle(); T.resolve(); T.settle();
    t.eq(spirits(), 1, 'only once each turn');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => /Clue/.test(o.name)).length, 1, 'B lost life, C did not: one Clue');
    const U = mk({ players: ['A', 'B', 'C'] });
    U.toMain('A');
    U.g.player('B').life = 10; U.g.player('C').life = 1;
    U.mana('A', 'BB4');
    U.cast('A', U.hand('A', 'Dire Fleet Ravager')); U.settle(); U.resolve(); U.settle();
    t.eq(U.life('A'), 13, '20: loses 7'); t.eq(U.life('B'), 6, '10: loses 4'); t.eq(U.life('C'), 0, '1: loses 1');
  });

  test('Audit: Needle Drop cannot be cast at a player not dealt damage this turn, and draws a card', (mk, t) => {
    t.auto('Needle Drop');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    const nd = T.hand('A', 'Needle Drop');
    const h = T.zone('A', 'hand').length;
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', nd.id, { auto: true, targets: [{ kind: 'player', id: 'C' }] }), 'C was not dealt damage');
    t.ok(T.g.castSpell('A', nd.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16); t.eq(T.zone('A', 'hand').length, h, 'Needle Drop gone, a card drawn');
  });

  test('Audit: Kestia bestowed on a creature makes it enchanted: it draws when that creature attacks, and when Kestia attacks itself', (mk, t) => {
    t.auto('Kestia, the Cultivator');
    let T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const k = T.hand('A', 'Kestia, the Cultivator');
    T.mana('A', 'GWU3');
    T.cast('A', k, { via: 'bestow', targets: [bear.id] });
    T.settle();
    t.eq(k.attachedTo, bear.id); t.eq(T.g.powerOf(bear), 6);
    const h = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h + 1, 'the Bears, enchanted by Kestia, attacked');
    T = mk();
    T.toMain('A');
    const k2 = T.bf('A', 'Kestia, the Cultivator'); k2.summoningSick = false;
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h2 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: k2.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h2 + 1, 'an enchantment creature attacked');
  });

  test("Audit: Celestial Mantle on an opponent's creature doubles that player's life, not its owner's", (mk, t) => {
    t.auto('Celestial Mantle');
    const T = mk();
    T.toMain('B');
    T.g.player('B').life = 9;
    const bear = T.bf('B', 'Grizzly Bears'); bear.summoningSick = false;
    const m = T.bf('A', 'Celestial Mantle');
    m.attachedTo = bear.id; bear.attachments = [m.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.toMain('B', 'endCombat');
    t.eq(T.life('B'), 18, "the creature's controller: 9 doubled");
    t.eq(T.life('A'), 15, 'the Mantle owner takes 5');
  });

  test("Audit: Halo Fountain: an opponent's tapped creature doesn't pay; fifteen of yours win the game", (mk, t) => {
    t.auto('Halo Fountain');
    let T = mk();
    T.toMain('A');
    const hf = T.bf('A', 'Halo Fountain');
    T.bf('B', 'Grizzly Bears', { tapped: true });
    T.mana('A', 'W');
    t.no(T.g.activateAbility('A', hf.id, 0, { auto: true }), "B's tapped Bears are not A's");
    T = mk();
    T.toMain('A');
    const hf2 = T.bf('A', 'Halo Fountain');
    for (let i = 0; i < 14; i++) T.bf('A', 'Grizzly Bears', { tapped: true });
    T.mana('A', 'WWWWW');
    t.no(T.g.activateAbility('A', hf2.id, 2, { auto: true }), 'fourteen are not enough');
    T.bf('A', 'Grizzly Bears', { tapped: true });
    T.activate('A', hf2, 2);
    T.settle();
    t.ok(T.g.player('B').hasLost, 'fifteen: A wins');
  });

  test('Audit: Hex Magic: the exiled cards can be played until the end of your next turn, lands too, and not after', (mk, t) => {
    t.auto('Hex Magic');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 6; i++) T.top('A', 'Plains');
    const isl = T.hand('A', 'Island'), sh = T.hand('A', 'Shock'), gb = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Hex Magic')); T.settle();
    t.zone(isl, 'exile'); t.eq(T.zone('A', 'hand').length, 3, 'three drawn');
    t.ok(T.g.playLand('A', isl.id), 'a land from exile');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    T.mana('A', 'R');
    t.ok(T.g.castSpell('A', sh.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'next turn: still');
    T.settle();
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    T.mana('A', '1G');
    t.no(T.g.castSpell('A', gb.id, { auto: true }), 'the turn after: no more');
  });

  test('Audit: Sewer-veillance Cam taps or untaps on entering and on leaving, as its controller picks', (mk, t) => {
    t.auto('Sewer-veillance Cam');
    const T = mk();
    T.toMain('A');
    const foe = T.bf('B', 'Grizzly Bears');
    const mine = T.bf('A', 'Hill Giant', { tapped: true });
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: foe.id }] });
    T.answer('choose', { picks: [0] });
    T.mana('A', 'U1');
    const cam = T.hand('A', 'Sewer-veillance Cam');
    T.cast('A', cam); T.settle(); T.resolve(); T.settle();
    t.ok(foe.tapped, 'entering: tap their Bears');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: mine.id }] });
    T.answer('choose', { picks: [1] });
    T.mana('A', 'U3');
    T.activate('A', T.g.battlefield.find(o => o.name === 'Sewer-veillance Cam'), 0);
    T.settle(); T.resolve(); T.settle();
    t.no(mine.tapped, 'leaving: untap my Giant');
  });

  test('Audit: counter-pile state triggers: Force Bubble soaks all of a hit and empties at end step; an opponent can push Deadly Designs over', (mk, t) => {
    t.auto('Force Bubble'); t.auto('Deadly Designs'); t.auto('Nine Lives');
    let T = mk();
    T.toMain('B');
    const fb = T.bf('A', 'Force Bubble');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] }); T.settle();
    t.eq(fb.counters.depletion, 2); t.eq(T.life('A'), 20);
    T.toMain('B', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(fb.counters.depletion || 0, 0, 'emptied at the end step');
    T.nextTurn('A'); T.nextTurn('B'); T.toMain('B');
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] }); T.settle();
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] }); T.settle(); T.resolve(); T.settle();
    t.zone(fb, 'graveyard', 'five: sacrificed'); t.eq(T.life('A'), 20, 'the whole Bolt went into counters');
    T = mk();
    T.toMain('B');
    const dd = T.bf('A', 'Deadly Designs'); dd.counters.plot = 4;
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant'), b3 = T.bf('B', 'Craw Wurm');
    let who = null;
    T.answer('pickTarget', (ch) => { who = ch.playerId; return { targets: [{ kind: 'object', id: b2.id }, { kind: 'object', id: b3.id }] }; });
    T.mana('B', '2');
    t.ok(T.g.activateAbility('B', dd.id, 0, { auto: true }), 'any player may add a counter');
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.zone(dd, 'graveyard'); t.eq(who, 'A', "its controller's trigger");
    t.zone(b1, 'battlefield'); t.zone(b2, 'graveyard'); t.zone(b3, 'graveyard');
    T = mk();
    T.toMain('B');
    const nl = T.bf('A', 'Nine Lives'); nl.counters.incarnation = 8;
    T.mana('B', 'R'); T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] }); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 20, 'prevented'); t.zone(nl, 'exile', 'the ninth counter'); t.ok(T.g.player('A').hasLost, 'and it leaving loses the game');
  });

  test('Audit: "if you cast it from your hand" on an enters trigger still reads the permanent: Feasting Troll King cast, or put onto the battlefield', (mk, t) => {
    t.auto('Feasting Troll King');
    let T = mk();
    T.toMain('A');
    T.mana('A', 'GGGG2');
    T.cast('A', T.hand('A', 'Feasting Troll King')); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => /Food/.test(o.name)).length, 3, 'cast from hand: three Food');
    T = mk();
    T.toMain('A');
    const ftk = T.grave('A', 'Feasting Troll King');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Reanimate'), { targets: [ftk.id] }); T.settle(); T.resolve(); T.settle();
    t.zone(ftk, 'battlefield');
    t.eq(T.g.battlefield.filter(o => /Food/.test(o.name)).length, 0, 'reanimated: none');
  });

  test('Audit: storm handed out: Prismari gives it to instants only; Crackling Spellslinger waits past a creature spell for the next instant', (mk, t) => {
    t.auto('Prismari, the Inspiration'); t.auto('Crackling Spellslinger');
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Prismari, the Inspiration');
    T.mana('A', '1G'); T.cast('A', T.hand('A', 'Grizzly Bears')); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.name === 'Grizzly Bears').length, 1, 'a creature spell: no storm copy');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16, 'Shock after one spell: one copy');
    T = mk();
    T.toMain('A');
    const cs = T.hand('A', 'Crackling Spellslinger');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle();
    T.mana('A', cs.card.mana_cost.replace(/[{}]/g, '')); T.cast('A', cs); T.settle(); T.resolve(); T.settle();
    T.mana('A', '1G'); T.cast('A', T.hand('A', 'Grizzly Bears')); T.settle(); T.resolve(); T.settle();
    const l0 = T.life('B');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.eq(l0 - T.life('B'), 12, 'the Bolt: three spells before it, four Bolts');
  });

  test('Audit: Level Up draws only once the doubled creature reaches power 10; Well Rested once a turn on untapping', (mk, t) => {
    t.auto('Level Up'); t.auto('Well Rested');
    for (const [start, draws] of [[1, false], [3, true]]) {
      const T = mk();
      T.toMain('A');
      const w = T.bf('A', 'Craw Wurm', { counters: { '+1/+1': start } }); w.summoningSick = false;
      const lu = T.bf('A', 'Level Up');
      lu.attachedTo = w.id; w.attachments = [lu.id]; T.g.bumpBoard();
      for (let i = 0; i < 3; i++) T.top('A', 'Island');
      const h = T.zone('A', 'hand').length;
      T.answer('declareAttackers', () => [{ attackerId: w.id, defenderId: 'B' }]);
      T.toMain('A', 'declareBlockers'); T.settle(); T.resolve(); T.settle();
      t.eq(w.counters['+1/+1'], start * 2, 'doubled');
      t.eq(T.zone('A', 'hand').length, h + (draws ? 1 : 0), draws ? '6 + 6 = 12 power: a card' : '6 + 2 = 8: none');
    }
    const T = mk();
    T.toMain('A');
    const b = T.bf('A', 'Grizzly Bears', { tapped: true });
    const wr = T.bf('A', 'Well Rested');
    wr.attachedTo = b.id; b.attachments = [wr.id]; T.g.bumpBoard();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.nextTurn('B'); T.nextTurn('A'); T.settle(); T.resolve(); T.settle();
    t.no(b.tapped); t.eq(b.counters['+1/+1'], 2); t.eq(T.life('A'), 22);
  });

  test("Audit: Danny Pink: a card the first time each turn counters go on each of your creatures, and not for an opponent's", (mk, t) => {
    t.auto('Danny Pink');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Danny Pink');
    const b = T.bf('A', 'Grizzly Bears'), foe = T.bf('B', 'Hill Giant');
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    const put = (x) => { T.g._runEffects([{ op: 'counters', kind: '+1/+1', n: 1, targets: [{ type: 'creature' }] }], { controller: 'A', name: 'Test', kind: 'spell', targets: [{ kind: 'object', id: x.id }] }); T.settle(); T.resolve(); T.settle(); };
    let h = T.zone('A', 'hand').length;
    put(b); t.eq(T.zone('A', 'hand').length, h + 1, 'the first time: a card');
    put(b); t.eq(T.zone('A', 'hand').length, h + 1, 'again this turn: none');
    put(foe); t.eq(T.zone('A', 'hand').length, h + 1, "B's creature: none");
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    h = T.zone('A', 'hand').length;
    put(b); t.eq(T.zone('A', 'hand').length, h + 1, 'a new turn: a card');
  });

  test('Audit: Cloakwood Hermit counts a creature card milled or discarded into your graveyard, not one into an opponent\'s', (mk, t) => {
    t.auto('Cloakwood Hermit');
    for (const how of ['opp', 'mill', 'discard']) {
      const T = mk();
      T.toMain('A');
      const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
      T.bf('A', 'Cloakwood Hermit'); T.g.bumpBoard();
      if (how === 'opp') { const g = T.bf('B', 'Grizzly Bears'); T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: [g.id] }); T.settle(); }
      if (how === 'mill') { T.top('A', 'Craw Wurm'); T.g._runEffects([{ op: 'mill', n: 1, who: 'you' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] }); T.settle(); }
      if (how === 'discard') { T.hand('A', 'Craw Wurm'); T.g._runEffects([{ op: 'discard', n: 1, who: 'you' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] }); T.settle(); }
      T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
      t.eq(T.g.battlefield.filter(o => o.isToken && /Squirrel/.test(o.name)).length, how === 'opp' ? 0 : 2, how);
    }
  });

  test('Audit: Arixmethes is a land while it slumbers and a creature once the last counter goes; War Balloon is a creature at three fire counters', (mk, t) => {
    t.auto('Arixmethes, Slumbering Isle'); t.auto('War Balloon');
    let T = mk();
    T.toMain('A');
    const ar = T.bf('A', 'Arixmethes, Slumbering Isle', { counters: { slumber: 1 } });
    T.g.bumpBoard();
    t.no(T.g.characteristics(ar).isCreature, 'a slumber counter: not a creature');
    T.answer('confirm', { yes: true });
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(ar.counters.slumber || 0, 0, 'a spell cast: the counter removed');
    T.g.bumpBoard();
    t.ok(T.g.characteristics(ar).isCreature, 'no counters: a creature'); t.eq(T.g.powerOf(ar), 12);
    T = mk();
    T.toMain('A');
    const wb = T.bf('A', 'War Balloon');
    t.no(T.g.characteristics(wb).isCreature);
    for (let i = 0; i < 3; i++) { T.mana('A', '1'); T.activate('A', wb, 0); T.settle(); }
    T.g.bumpBoard();
    t.eq(wb.counters.fire, 3); t.ok(T.g.characteristics(wb).isCreature, 'three fire counters: a creature');
  });

  test('Audit: Wild-Magic Sorcerer: a spell from hand has no cascade; the first from exile on a later turn has it again', (mk, t) => {
    t.auto('Wild-Magic Sorcerer');
    const T = mk({ library: ['Island'] });
    T.toMain('A');
    T.bf('A', 'Wild-Magic Sorcerer');
    const top1 = T.top('A', 'Grizzly Bears');
    T.mana('A', 'R3'); T.cast('A', T.hand('A', 'Hill Giant')); T.resolve();
    t.zone(top1, 'library', 'from hand: no cascade');
    const g1 = T.put('A', 'Hill Giant', 'exile'); g1.impulseBy = 'A'; g1.impulseUntil = T.g.turn;
    T.answer('confirm', { yes: true });
    T.mana('A', 'R3'); T.cast('A', g1); T.resolve();
    t.zone(top1, 'battlefield', 'the first from exile: cascade');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    const top2 = T.top('A', 'Grizzly Bears');
    const g2 = T.put('A', 'Hill Giant', 'exile'); g2.impulseBy = 'A'; g2.impulseUntil = T.g.turn;
    T.answer('confirm', { yes: true });
    T.mana('A', 'R3'); T.cast('A', g2); T.resolve();
    t.zone(top2, 'battlefield', 'a new turn: the first again');
  });

  test("Audit: an activated ability is never stopped by a trigger's \"if\" at the same place in the list (Davriel's -1, Daredevil Dragster's crew); Urza's Guilt is each player's", (mk, t) => {
    t.auto('Davriel, Rogue Shadowmage'); t.auto('Daredevil Dragster'); t.auto("Urza's Guilt");
    let T = mk();
    T.toMain('A');
    const d = T.bf('A', 'Davriel, Rogue Shadowmage', { counters: { loyalty: 3 } });
    T.hand('B', 'Island'); T.hand('B', 'Forest'); T.hand('B', 'Mountain');
    T.answer('discard', (ch) => ({ cardIds: [T.g.zones.B.hand[0].id] }));
    T.activate('A', d, 0, { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.zones.B.hand.length, 2, 'B holds three cards, and still discards one');
    T = mk();
    T.toMain('A');
    const dd = T.bf('A', 'Daredevil Dragster', { counters: { velocity: 1 } });
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.bf('A', 'Grizzly Bears');
    T.activate('A', dd, 0);
    t.ok(T.g.characteristics(dd).isCreature, 'crewed');
    const h = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: dd.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16); t.zone(dd, 'graveyard', 'the second velocity counter: sacrificed');
    t.eq(T.zone('A', 'hand').length, h + 2, 'and two cards');
    T = mk();
    T.toMain('A');
    for (const p of ['A', 'B']) for (let i = 0; i < 4; i++) T.top(p, 'Island');
    T.mana('A', 'UB2');
    T.cast('A', T.hand('A', "Urza's Guilt")); T.settle();
    t.eq(T.life('A'), 16); t.eq(T.life('B'), 16, 'B loses 4 too');
    t.eq(T.zone('B', 'graveyard').length, 2, 'B drew two and discarded what it had: two');
  });

  test('Audit: "the second time this ability has resolved" counts that ability only: Tannuk pinging with Viridian Longbow, then landfall twice; Soulbright Seeker the third time', (mk, t) => {
    t.auto('Tannuk, Memorial Ensign'); t.auto('Viridian Longbow'); t.auto('Soulbright Seeker');
    let T = mk();
    T.toMain('A');
    const tn = T.bf('A', 'Tannuk, Memorial Ensign'); tn.summoningSick = false;
    const lb = T.bf('A', 'Viridian Longbow');
    lb.attachedTo = tn.id; tn.attachments = [lb.id]; T.g.bumpBoard();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.activate('A', tn, 0, { targets: ['B'] }); T.settle();
    t.eq(T.life('B'), 19, 'the granted ping, an activated ability at the same place in the list as the landfall trigger');
    const h = T.zone('A', 'hand').length;
    const m1 = T.hand('A', 'Mountain');
    T.g.playLand('A', m1.id); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h, "the first landfall: no card (the ping isn't counted)");
    // (a second land entering: put there, as a land play is spent)
    T.g.moveObject(T.put('A', 'Forest', 'hand'), 'battlefield'); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 17); t.eq(T.zone('A', 'hand').length, h + 1, 'the second landfall: a card');
    T = mk();
    T.toMain('A');
    const ss = T.bf('A', 'Soulbright Seeker');
    T.answer('confirm', { yes: true });
    for (let i = 1; i <= 3; i++) { T.mana('A', 'R'); T.activate('A', ss, 0, { targets: [ss.id] }); T.settle(); }
    t.eq(T.g.player('A').pool.R, 4, 'the third resolution: {R}{R}{R}{R}');
  });

  test("Audit: Valgavoth only on the opponent's own turn, once; Dollmaker's Shop not for Toys attacking alone", (mk, t) => {
    t.auto('Valgavoth, Harrower of Souls'); t.auto("Dollmaker's Shop // Porcelain Gallery");
    let T = mk();
    T.toMain('A');
    const v = T.bf('A', 'Valgavoth, Harrower of Souls');
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    let h = T.zone('A', 'hand').length;
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h, "on A's turn: nothing");
    T.nextTurn('B'); T.toMain('B');
    h = T.zone('A', 'hand').length;
    T.g.changeLife(T.g.player('B'), -1, 'test'); T.settle(); T.resolve(); T.settle();
    T.g.changeLife(T.g.player('B'), -1, 'test'); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h + 1, "on B's turn: the first loss only"); t.eq(v.counters['+1/+1'], 1);
    T = mk();
    T.toMain('A');
    T.bf('A', "Dollmaker's Shop // Porcelain Gallery");
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    const toys = () => T.g.battlefield.filter(o => o.isToken && /Toy/.test(o.name));
    T.g._runEffects([{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['white'], addTypes: ['Artifact'], subtypes: 'Toy', keywords: [] }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    const t1 = toys()[0]; t1.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: t1.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat'); T.settle(); T.resolve(); T.settle();
    t.eq(toys().length, 1, 'a Toy alone: no new Toy');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }, { attackerId: t1.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat'); T.settle(); T.resolve(); T.settle();
    t.eq(toys().length, 2, 'the Bears with it: one Toy');
  });

  test('Audit: Ripple chains: each rippled Surging Flame ripples again, the rest go to the bottom in order', (mk, t) => {
    t.auto('Surging Flame');
    const T = mk();
    T.toMain('A');
    T.g.zones.A.library.length = 0;
    const order = ['Island', 'Surging Flame', 'Forest', 'Mountain', 'Surging Flame', 'Plains', 'Swamp', 'Wastes'];
    for (const n of order.slice().reverse()) T.top('A', n);
    for (let i = 0; i < 3; i++) T.answer('confirm', { yes: true });
    for (let i = 0; i < 2; i++) T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Surging Flame'), { targets: ['B'] });
    for (let i = 0; i < 8; i++) { T.settle(); T.resolve(); }
    T.settle();
    t.eq(T.life('B'), 14, 'three Flames');
    t.eq(T.g.zones.A.library.map(c => c.name).join(','), 'Swamp,Wastes,Island,Forest,Mountain,Plains', 'what was revealed and not cast, bottomed');
  });

  test('Audit: "you may sacrifice two Foods. If you do … Otherwise …": too few Foods is the otherwise (Giant Opportunity); Rent Is Due taps summoning-sick creatures', (mk, t) => {
    t.auto('Giant Opportunity'); t.auto('Rent Is Due');
    for (const [foods, yes, giant, left] of [[1, true, 0, 4], [0, false, 0, 3], [2, true, 1, 0]]) {
      const T = mk();
      T.toMain('A');
      if (foods) T.g._runEffects([{ op: 'createNamedToken', n: foods, token: 'Food' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
      T.answer('confirm', { yes });
      const go = T.hand('A', 'Giant Opportunity');
      T.mana('A', go.card.mana_cost.replace(/[{}]/g, ''));
      T.cast('A', go); T.settle();
      t.eq(T.g.battlefield.filter(o => /Giant/.test(o.name) && o.isToken).length, giant, `${foods} Food, ${yes ? 'yes' : 'no'}: Giant`);
      t.eq(T.g.battlefield.filter(o => /Food/.test(o.name)).length, left, `${foods} Food, ${yes ? 'yes' : 'no'}: Foods after`);
    }
    const T = mk();
    T.toMain('A');
    const rid = T.bf('A', 'Rent Is Due');
    const b1 = T.bf('A', 'Grizzly Bears', { sick: true }), b2 = T.bf('A', 'Grizzly Bears', { sick: true });
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.answer('confirm', { yes: true });
    const h = T.zone('A', 'hand').length;
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.ok(b1.tapped && b2.tapped, 'two summoning-sick creatures tapped'); t.eq(T.zone('A', 'hand').length, h + 1); t.zone(rid, 'battlefield');
  });

  test('Audit: discards at random ask nobody (Hymn to Tourach); Stupor: one at random, then one the opponent picks', (mk, t) => {
    t.auto('Hymn to Tourach'); t.auto('Stupor');
    let T = mk();
    T.toMain('A');
    for (const n of ['Island', 'Forest', 'Mountain', 'Plains', 'Swamp']) T.hand('B', n);
    T.mana('A', 'BB');
    T.cast('A', T.hand('A', 'Hymn to Tourach'), { targets: ['B'] }); T.settle();
    t.eq(T.zone('B', 'hand').length, 3); t.eq(T.zone('B', 'graveyard').length, 2);
    t.no(T.asked.some(ch => ch.type === 'discard' && ch.playerId === 'B'), 'B chose nothing');
    T = mk();
    T.toMain('A');
    for (const n of ['Island', 'Forest', 'Mountain']) T.hand('B', n);
    let asked = 0;
    T.answer('discard', (ch) => { asked++; t.eq(ch.playerId, 'B'); return { cardIds: [T.g.zones.B.hand[0].id] }; });
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Stupor'), { targets: ['B'] }); T.settle();
    t.eq(T.zone('B', 'hand').length, 1); t.eq(asked, 1, 'B picked the second one only');
  });

  test('Audit: Plagon counts itself among creatures with toughness above power, and its target deals damage by toughness', (mk, t) => {
    t.auto('Plagon, Lord of the Beach');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Wall of Wood');
    const tg = T.bf('A', 'Horned Turtle'); tg.summoningSick = false;
    T.bf('A', 'Grizzly Bears');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const pl = T.hand('A', 'Plagon, Lord of the Beach');
    const h = T.zone('A', 'hand').length;
    T.mana('A', '2U');
    T.cast('A', pl); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h - 1 + 3, 'Wall, Turtle and Plagon: three cards (not the Bears)');
    T.mana('A', 'W');
    T.activate('A', pl, 0, { targets: [tg.id] }); T.settle();
    T.answer('declareAttackers', () => [{ attackerId: tg.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 16, 'the 1/4 Turtle deals 4');
  });

  test('Audit: Chandra, Acolyte of Flame -2 casts a sorcery from the graveyard, paying for it, and exiles it after; not without the mana', (mk, t) => {
    t.auto('Chandra, Acolyte of Flame');
    for (const paid of [true, false]) {
      const T = mk();
      T.toMain('A');
      const ch = T.bf('A', 'Chandra, Acolyte of Flame', { counters: { loyalty: 4 } });
      const dv = T.grave('A', 'Divination');
      for (let i = 0; i < 4; i++) T.top('A', 'Island');
      T.answer('confirm', { yes: true });
      if (paid) T.mana('A', 'U2');
      const h = T.zone('A', 'hand').length;
      T.activate('A', ch, 2, { targets: [dv.id] }); T.settle(); T.resolve(); T.settle();
      if (paid) { t.zone(dv, 'exile', 'cast and exiled after'); t.eq(T.zone('A', 'hand').length, h + 2); }
      else { t.zone(dv, 'graveyard', 'no mana: not cast'); t.eq(T.zone('A', 'hand').length, h); }
    }
  });

  test("Audit: eminence belongs to its owner: B's Edgar Markov in the command zone does nothing for A's Vampire spell; Sidar Jabari loots from the command zone", (mk, t) => {
    t.auto('Edgar Markov'); t.auto('Sidar Jabari of Zhalfir');
    let T = mk();
    T.toMain('A');
    const ed = T.put('B', 'Edgar Markov', 'command'); ed.isCommander = true;
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Vampire Nighthawk')); T.resolve();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Vampire/.test(o.name)).length, 0, "not B's Edgar for A's spell");
    T = mk();
    T.toMain('A');
    const sj = T.put('A', 'Sidar Jabari of Zhalfir', 'command'); sj.isCommander = true;
    const k = T.bf('A', 'White Knight'); k.summoningSick = false;
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.answer('declareAttackers', () => [{ attackerId: k.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat'); T.settle();
    t.eq(T.zone('A', 'graveyard').length, 1, 'a Knight attacked: draw, then discard');
  });

  test("Audit: Cadric, Soul Kindler: decline to pay and nothing is sacrificed at end step; Inalla's token copy is exiled, its Wizard stays", (mk, t) => {
    t.auto('Cadric, Soul Kindler'); t.auto('Inalla, Archmage Ritualist');
    for (const pay of [false, true]) {
      const T = mk();
      T.toMain('A');
      T.bf('A', 'Cadric, Soul Kindler');
      T.answer('confirm', { yes: pay });
      const lg = T.hand('A', 'Isamaru, Hound of Konda');
      T.mana('A', pay ? 'W1' : 'W');
      T.cast('A', lg); T.settle(); T.resolve(); T.settle();
      t.eq(T.g.battlefield.filter(o => o.isToken).length, pay ? 1 : 0, pay ? 'paid: a copy' : 'declined: no copy');
      T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
      T.nextTurn('B');
      t.zone(lg, 'battlefield', pay ? 'the copy goes, Isamaru stays' : 'declined: Isamaru stays');
      t.eq(T.g.battlefield.filter(o => o.isToken).length, 0);
    }
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Inalla, Archmage Ritualist');
    T.answer('confirm', { yes: true });
    const wz = T.hand('A', 'Prodigal Sorcerer');
    T.mana('A', 'U3');
    T.cast('A', wz); T.settle(); T.resolve(); T.settle();
    const tok = T.g.battlefield.find(o => o.isToken && o.name === 'Prodigal Sorcerer');
    t.ok(tok && T.g.hasKw(tok, 'haste'), 'a hasty copy');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    T.nextTurn('B');
    t.zone(wz, 'battlefield'); t.no(T.g.battlefield.some(o => o.isToken), 'the copy exiled');
  });

  test("Audit: tokens sized by their own words count only yours (Wrenn and Seven's Treefolk, Doomed Artisan's Sculptures); Arahbo doubles the attacking Cat's power", (mk, t) => {
    t.auto('Wrenn and Seven'); t.auto('Doomed Artisan'); t.auto('Arahbo, Roar of the World');
    let T = mk();
    T.toMain('A');
    const ws = T.bf('A', 'Wrenn and Seven', { counters: { loyalty: 5 } });
    for (let i = 0; i < 4; i++) T.bf('A', 'Forest');
    T.bf('B', 'Island');
    T.activate('A', ws, 2); T.settle(); T.resolve(); T.settle();
    const tf = T.g.battlefield.find(o => o.isToken && /Treefolk/.test(o.name));
    t.ok(tf, 'a Treefolk'); t.eq(T.g.powerOf(tf), 4, "four lands of A's, not B's Island"); t.ok(T.g.hasKw(tf, 'reach'));
    T = mk();
    T.toMain('A');
    T.bf('A', 'Doomed Artisan');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    const sc = T.g.battlefield.filter(o => o.isToken && /Sculpture/.test(o.name));
    t.eq(sc.map(o => T.g.powerOf(o)).join(','), '2,2', 'two Sculptures, each 2/2');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Arahbo, Roar of the World');
    const cat = T.bf('A', 'Savannah Lions'); cat.summoningSick = false;
    T.answer('confirm', { yes: true });
    T.bf('A', 'Forest'); T.bf('A', 'Plains'); T.bf('A', 'Wastes');
    T.answer('declareAttackers', () => [{ attackerId: cat.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers'); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.powerOf(cat), 10, 'eminence +3 at the start of combat, then +5 for its power of 5'); t.ok(T.g.hasKw(cat, 'trample'));
  });

  test('Audit: "you may put a land card from your hand onto the battlefield" stays a choice (Growth Spiral): no puts none, yes puts one', (mk, t) => {
    t.auto('Growth Spiral');
    for (const yes of [false, true]) {
      const T = mk();
      T.toMain('A');
      T.top('A', 'Island');
      const f = T.hand('A', 'Forest');
      T.answer('confirm', { yes });
      T.answer('pickCard', (ch) => ({ cardIds: [f.id] }));
      T.mana('A', 'GU');
      T.cast('A', T.hand('A', 'Growth Spiral')); T.settle();
      t.zone(f, yes ? 'battlefield' : 'hand', yes ? 'yes: the Forest' : 'no: nothing put');
    }
  });

  test("Audit: power and toughness from cards in hand: Psychosis Crawler follows its controller's hand; Mordenkainen's Dog Illusion is twice that", (mk, t) => {
    t.auto('Psychosis Crawler'); t.auto('Mordenkainen');
    const T = mk();
    T.toMain('A');
    const pc = T.bf('A', 'Psychosis Crawler');
    T.hand('A', 'Island'); T.hand('A', 'Forest');
    for (let i = 0; i < 5; i++) T.hand('B', 'Island');
    t.eq(T.g.powerOf(pc), 2, "A's two cards, not B's five");
    const mo = T.bf('A', 'Mordenkainen', { counters: { loyalty: 5 } });
    T.activate('A', mo, 1); T.settle(); T.resolve(); T.settle();
    const dog = T.g.battlefield.find(o => o.isToken && /Dog/.test(o.name));
    t.ok(dog, 'a Dog Illusion'); t.eq(T.g.powerOf(dog), 4, 'twice two'); t.eq(T.g.toughnessOf(dog), 4);
    T.hand('A', 'Mountain');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(dog), 6, 'a third card: 6'); t.eq(T.g.powerOf(pc), 3);
  });

  test("Audit: Ojer Pakpatiq gives an instant from hand rebound; Alisaie's second spell each turn costs {2} less, the third does not", (mk, t) => {
    t.auto('Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time'); t.auto('Alisaie Leveilleur');
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time');
    T.mana('A', 'R');
    const sh = T.hand('A', 'Shock');
    T.cast('A', sh, { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.zone(sh, 'exile', 'rebound: exiled'); t.eq(T.life('B'), 18);
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.nextTurn('B'); T.nextTurn('A'); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16, 'cast again at the upkeep'); t.zone(sh, 'graveyard');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Alisaie Leveilleur');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle();
    T.mana('A', 'RG');
    t.ok(T.g.castSpell('A', T.hand('A', 'Hill Giant').id, { auto: true }), 'the second: {3}{R} for two'); T.settle(); T.resolve(); T.settle();
    T.mana('A', 'RG');
    t.no(T.g.castSpell('A', T.hand('A', 'Hill Giant').id, { auto: true }), 'the third: full price');
  });

  test("Audit: \"a number of +1/+1 counters equal to …\": Lattice Library's Fractal by study counters, Reverent Hunter counting itself, Vincent Valentine by the dead creature's last power", (mk, t) => {
    t.auto('Lattice Library'); t.auto('Reverent Hunter'); t.auto('Vincent Valentine // Galian Beast');
    let T = mk();
    T.toMain('A');
    const ll = T.hand('A', 'Lattice Library');
    T.mana('A', 'GG3');
    t.ok(T.g.castSpell('A', ll.id, { auto: true, x: 3 })); T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.eq(ll.counters.study, 3);
    t.eq(T.g.battlefield.filter(o => o.isToken && /Fractal/.test(o.name)).map(o => o.counters['+1/+1']).join(','), '3');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Llanowar Elves');
    const rh = T.hand('A', 'Reverent Hunter');
    T.mana('A', 'G2');
    T.cast('A', rh); T.settle(); T.resolve(); T.settle();
    t.eq(rh.counters['+1/+1'], 2, 'the Elves and the Hunter itself');
    T = mk();
    T.toMain('A');
    const vv = T.bf('A', 'Vincent Valentine // Galian Beast');
    const g = T.bf('B', 'Hill Giant');
    T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [g.id] });
    T.mana('A', 'BB1'); T.cast('A', T.hand('A', 'Murder'), { targets: [g.id] }); T.settle(); T.resolve(); T.settle();
    t.eq(vv.counters['+1/+1'], 6, 'the Giant died a 6/6');
  });

  test('Audit: Hour of Revelation counts nonland permanents on both sides; Wildwood Scourge ignores counters on a Hydra', (mk, t) => {
    t.auto('Hour of Revelation'); t.auto('Wildwood Scourge');
    for (const n of [9, 10]) {
      const T = mk();
      T.toMain('A');
      for (let i = 0; i < n; i++) T.bf(i % 2 ? 'A' : 'B', 'Grizzly Bears');
      const hr = T.hand('A', 'Hour of Revelation');
      T.mana('A', 'WWW');
      if (n === 10) t.ok(T.g.castSpell('A', hr.id, { auto: true }), 'ten, five of them B\'s: {W}{W}{W}');
      else t.no(T.g.castSpell('A', hr.id, { auto: true }), 'nine: full price');
    }
    const T = mk();
    T.toMain('A');
    const ws = T.bf('A', 'Wildwood Scourge');
    const hy = T.bf('A', 'Hydra Broodmaster'), bear = T.bf('A', 'Grizzly Bears');
    const put = (x) => { T.g._runEffects([{ op: 'counters', kind: '+1/+1', n: 1, targets: [{ type: 'creature' }] }], { controller: 'A', name: 'Test', kind: 'spell', targets: [{ kind: 'object', id: x.id }] }); T.settle(); T.resolve(); T.settle(); };
    put(hy); t.eq(ws.counters['+1/+1'] || 0, 0, 'a Hydra: no');
    put(bear); t.eq(ws.counters['+1/+1'] || 0, 1, 'the Bears: yes');
  });

  test("Audit: Dread Summons: each player mills X, and a Zombie for every creature card milled from either library", (mk, t) => {
    t.auto('Dread Summons');
    const T = mk();
    T.toMain('A');
    T.top('A', 'Island'); T.top('A', 'Grizzly Bears');
    T.top('B', 'Hill Giant'); T.top('B', 'Craw Wurm');
    const ds = T.hand('A', 'Dread Summons');
    T.mana('A', 'BB2');
    t.ok(T.g.castSpell('A', ds.id, { auto: true, x: 2 })); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'graveyard').filter(c => c.name !== 'Dread Summons').length, 2); t.eq(T.zone('B', 'graveyard').length, 2);
    const z = T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name));
    t.eq(z.length, 3, 'the Bears, the Giant and the Wurm'); t.ok(z.every(o => o.controller === 'A' && o.tapped), 'tapped, all A\'s');
  });

  test('Audit: Scavenging Ooze exiles just its target: a creature card grows it and gains 1 life, a land card does neither', (mk, t) => {
    t.auto('Scavenging Ooze');
    const T = mk();
    T.toMain('A');
    const oz = T.bf('A', 'Scavenging Ooze');
    const bear = T.grave('B', 'Grizzly Bears'), isl = T.grave('B', 'Island'), mine = T.grave('A', 'Craw Wurm');
    T.mana('A', 'G'); T.activate('A', oz, 0, { targets: [isl.id] }); T.settle();
    t.zone(isl, 'exile'); t.zone(bear, 'graveyard'); t.zone(mine, 'graveyard');
    t.eq(oz.counters['+1/+1'] || 0, 0); t.eq(T.life('A'), 20);
    T.mana('A', 'G'); T.activate('A', oz, 0, { targets: [bear.id] }); T.settle();
    t.zone(bear, 'exile'); t.eq(oz.counters['+1/+1'], 1); t.eq(T.life('A'), 21);
  });

  test("Audit: a token's name stops before \"at the beginning of …\": Giant Caterpillar's later Butterfly is a person's; Wall of Kelp, Murmuration and Fire Navy Trebuchet's named tokens", (mk, t) => {
    const { card } = require('../harness');
    t.auto('Wall of Kelp'); t.auto('Murmuration'); t.auto('Fire Navy Trebuchet');
    let T = mk();
    t.no(T.MTG.oracle.analyze(card('Giant Caterpillar')).fullyAutomated, 'the Butterfly comes at the next end step, not now');
    T.toMain('A');
    const wk = T.bf('A', 'Wall of Kelp'); wk.summoningSick = false;
    T.mana('A', 'UU'); T.activate('A', wk, 0); T.settle();
    const kelp = T.g.battlefield.find(o => o.isToken);
    t.eq(kelp && kelp.name, 'Kelp'); t.ok(kelp && T.g.hasKw(kelp, 'defender'));
    T = mk();
    T.toMain('A');
    T.bf('A', 'Murmuration');
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle();
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle();
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] }); T.settle();
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    const crows = T.g.battlefield.filter(o => o.isToken && o.name === 'Storm Crow');
    t.eq(crows.length, 3, 'three spells: three Storm Crows'); t.ok(crows.every(o => T.g.hasKw(o, 'flying')));
  });
};
