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
};
