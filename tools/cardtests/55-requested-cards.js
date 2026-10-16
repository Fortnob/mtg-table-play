/* Regression tests for the first requested batch of card automations. */
'use strict';
module.exports = (test) => {
  const REQUESTED = [
    "Anzrag's Rampage", 'Party Dude', 'Green Slime', "Titania's Song",
    'Structural Assault', 'Collected Company', 'Topography Tracker',
    'Call to the Kindred', 'Tide Shaper', 'Deeproot Historian',
    'Over the Edge', 'Avoid Fate',
  ];

  test('Requested card batch is fully automated', (mk, t) => {
    for (const name of REQUESTED) t.auto(name);
  });

  test('Avoid Fate counters an instant targeting your permanent', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    T.cast('B', bolt, { resolve: false, targets: [bear] });
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Avoid Fate'), { targets: [T.stackTarget(bolt)] });
    t.zone(bolt, 'graveyard', 'Avoid Fate counters the instant');
    t.zone(bear, 'battlefield', 'the targeted permanent remains');
  });

  test("Anzrag's Rampage destroys only opposing artifacts and returns its creature", (mk, t) => {
    const T = mk();
    const ownRing = T.bf('A', 'Sol Ring');
    const enemyRing = T.bf('B', 'Sol Ring');
    const bear = T.top('A', 'Grizzly Bears');
    T.mana('A', 'RR3');
    T.answer('choose', ch => ({ picks: ch.items.filter(x => x.name === 'Grizzly Bears').map(x => x.id) }));
    T.cast('A', T.hand('A', "Anzrag's Rampage"));
    t.zone(ownRing, 'battlefield', 'the caster keeps their artifact');
    t.zone(enemyRing, 'graveyard', 'the opponent artifact is destroyed');
    t.zone(bear, 'battlefield', 'the creature exiled by Rampage is put in play');
    t.ok(T.g.hasKw(bear, 'haste'), 'the creature gets haste');
    T.nextTurn('B');
    t.zone(bear, 'hand', 'the creature returns at the next end step');
  });

  test('Party Dude creates Food, draws at level 2, and scopes level 3 to attacks against opponents', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    bear.attacking = 'B';
    const party = T.put('A', 'Party Dude', 'battlefield', { etb: true });
    T.resolve();
    t.ok(T.bfOf('A').some(x => x.name === 'Food'), 'A creates Food');
    t.ok(T.bfOf('B').some(x => x.name === 'Food'), 'B creates Food');

    T.mana('A', 'G1');
    T.activate('A', party, 0); // Level 2
    const ring = T.bf('B', 'Sol Ring');
    const drawn = T.top('A', 'Island');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', "Nature's Claim"), { targets: [ring] });
    t.zone(ring, 'graveyard');
    t.zone(drawn, 'hand', 'the level 2 ability draws after an opposing artifact leaves');

    T.mana('A', 'G4');
    T.activate('A', party, 1); // Level 3
    T.hand('A', 'Forest');
    const basePower = T.g.powerOf(bear);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.g._fire('opponentsAttacked', null, { attackedPlayers: ['A'] });
    T.resolve();
    t.eq(T.g.powerOf(bear), basePower, 'being attacked is not the same as an opponent being attacked');
    T.g._fire('opponentsAttacked', null, { attackedPlayers: ['B'] });
    T.resolve();
    t.eq(T.g.powerOf(bear), basePower + T.zone('A', 'hand').length, "the attacking creature gets +X/+X for the player's hand size");
  });

  test('Green Slime counters an artifact ability and destroys its source', (mk, t) => {
    const T = mk();
    const disk = T.bf('B', "Nevinyrral's Disk");
    T.mana('B', '1');
    T.g.passPriority('A', true);
    T.activate('B', disk, 0, { resolve: false });
    const ability = T.g.stack.find(x => x.objId === disk.id && x.kind !== 'spell');
    t.ok(ability, 'the Disk activation is on the stack');
    T.mana('A', 'G2');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'stack', id: ability.id }] }));
    const slime = T.hand('A', 'Green Slime');
    T.cast('A', slime);
    t.zone(disk, 'graveyard', 'the ability source is destroyed');
    t.zone(slime, 'battlefield', 'the countered Disk activation does not wipe the Slime');
    t.no(T.g.stack.some(x => x.id === ability.id), 'the activated ability is no longer on the stack');
  });

  test("Titania's Song transforms noncreature artifacts and the effect lasts through the turn", (mk, t) => {
    const T = mk();
    const ring = T.bf('A', 'Sol Ring');
    const song = T.bf('A', "Titania's Song");
    t.ok(T.g.characteristics(ring).isCreature, 'Sol Ring becomes a creature');
    t.eq(T.g.powerOf(ring), 1, 'power is its mana value');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', "Nature's Claim"), { targets: [song] });
    t.zone(song, 'graveyard');
    t.ok(T.g.characteristics(ring).isCreature, 'the effect persists after the Song leaves');
    t.eq(T.g.powerOf(ring), 1, 'the lingering effect preserves its size');
    T.nextTurn('B');
    t.no(T.g.characteristics(ring).isCreature, 'the lingering effect expires at end of turn');
  });

  test('Structural Assault damage scales with artifacts that went to graveyards this turn', (mk, t) => {
    const T = mk();
    T.bf('A', 'Sol Ring');
    T.bf('B', 'Sol Ring');
    const bearA = T.bf('A', 'Grizzly Bears');
    const bearB = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'RR3');
    T.cast('A', T.hand('A', 'Structural Assault'));
    t.zone(bearA, 'graveyard', 'two artifact deaths deal two damage');
    t.zone(bearB, 'graveyard', 'each creature takes the counted damage');
  });

  test('Collected Company puts up to two qualifying creatures in play and bottoms the rest', (mk, t) => {
    const T = mk();
    const bears = [T.top('A', 'Grizzly Bears'), T.top('A', 'Grizzly Bears')];
    const wurms = [T.top('A', 'Craw Wurm'), T.top('A', 'Craw Wurm'), T.top('A', 'Craw Wurm'), T.top('A', 'Craw Wurm')];
    T.mana('A', 'GG3');
    T.answer('choose', ch => ({ picks: ch.items.filter(x => x.name === 'Grizzly Bears').map(x => x.id) }));
    T.cast('A', T.hand('A', 'Collected Company'));
    for (const bear of bears) t.zone(bear, 'battlefield');
    for (const wurm of wurms) t.zone(wurm, 'library', 'mana value above three stays on the bottom');
  });

  test('Topography Tracker creates a Map and doubles a creature explore', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const island = T.top('A', 'Island');
    const forest = T.top('A', 'Forest');
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Topography Tracker'));
    const map = T.bfOf('A').find(x => x.name === 'Map');
    t.ok(map, 'the Tracker creates a Map token');
    T.mana('A', '1');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.activate('A', map, 0);
    t.zone(forest, 'hand');
    t.zone(island, 'hand');
    t.eq(bear.counters['+1/+1'] || 0, 0, 'both explores revealed lands');
  });

  test('Call to the Kindred only puts a creature sharing a type with the enchanted creature onto the battlefield', (mk, t) => {
    const T = mk();
    const enchanted = T.bf('A', 'Grizzly Bears');
    const bear = T.top('A', 'Grizzly Bears');
    const wurm = T.top('A', 'Craw Wurm');
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Call to the Kindred'), { targets: [enchanted] });
    T.answer('choose', ch => ({ picks: ch.items.filter(x => x.name === 'Grizzly Bears').map(x => x.id) }));
    T.g._fire('yourUpkeep', 'A', { playerId: 'A' });
    T.resolve();
    t.zone(bear, 'battlefield', 'a Bear matches the enchanted Bear');
    t.zone(wurm, 'library', 'a Wurm does not share its creature type');
  });

  test('Tide Shaper changes a land into an Island only while it remains in play', (mk, t) => {
    const T = mk();
    const forest = T.bf('B', 'Forest');
    T.mana('A', 'U1');
    const shaper = T.hand('A', 'Tide Shaper');
    T.cast('A', shaper, { kick: 1, targets: [forest] });
    t.ok(T.g.characteristics(forest).subtypes.includes('Island'), 'the kicked ETB makes the target an Island');
    T.g.moveObject(shaper, 'graveyard');
    t.no(T.g.characteristics(forest).subtypes.includes('Island'), 'the Island effect ends when Tide Shaper leaves');
  });

  test('Deeproot Historian grants retrace to Merfolk and Druid cards, not other cards', (mk, t) => {
    const T = mk();
    T.bf('A', 'Deeproot Historian');
    const merfolk = T.grave('A', 'Merfolk Mistbinder');
    const bear = T.grave('A', 'Grizzly Bears');
    t.ok(T.g.altUsesFor('A', merfolk.id).some(u => u.via === 'retrace'), 'Merfolk in the graveyard can retrace');
    t.no(T.g.altUsesFor('A', bear.id).some(u => u.via === 'retrace'), 'a Bear does not gain retrace');
  });

  test('Over the Edge resolves its double-explore mode on the same creature', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const wurm = T.top('A', 'Craw Wurm');
    const forest = T.top('A', 'Forest');
    T.mana('A', 'G1');
    T.answer('mode', () => ({ modes: [1] }));
    T.cast('A', T.hand('A', 'Over the Edge'), { targets: [bear] });
    t.zone(forest, 'hand', 'the first explore finds a land');
    t.no(wurm.zone === 'hand', 'the second explore finds a nonland');
    t.eq(bear.counters['+1/+1'] || 0, 1, 'the nonland reveal puts a counter on the same creature');
  });
};
