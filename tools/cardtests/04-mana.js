/* Mana that depends on the table: other players' lands, land types handed
   out by other permanents, devotion. */
'use strict';
module.exports = (test) => {
  test('Exotic Orchard makes what an opponent\'s lands make', (mk, t) => {
    const T = mk();
    const orch = T.bf('A', 'Exotic Orchard');
    T.bf('B', 'Island');
    const div = T.hand('A', 'Divination');
    T.mana('A', '2');
    T.cast('A', div);
    t.ok(orch.tapped, 'tapped for the blue');
    t.eq(T.zone('A', 'hand').length, 2);
  });

  test('Exotic Orchard makes nothing with no opposing lands', (mk, t) => {
    const T = mk();
    const orch = T.bf('A', 'Exotic Orchard');
    T.g.tapForMana('A', orch.id, 0);
    t.eq(T.player('A').pool.total(), 0);
  });

  test('Urborg makes every land tap for black', (mk, t) => {
    const T = mk();
    T.bf('A', 'Urborg, Tomb of Yawgmoth');
    const forest = T.bf('A', 'Forest');
    T.mana('A', '1');
    // Murder is {1}{B}{B}: Urborg pays one black, the Forest the other
    T.cast('A', T.hand('A', 'Murder'), { targets: [T.bf('B', 'Grizzly Bears')] });
    t.ok(forest.tapped);
  });

  test('Chromatic Lantern lets a Mountain pay for blue', (mk, t) => {
    const T = mk();
    T.bf('A', 'Chromatic Lantern', { tapped: true });
    const m = T.bf('A', 'Mountain');
    T.mana('A', '2');
    T.cast('A', T.hand('A', 'Divination'));
    t.ok(m.tapped);
    t.eq(T.zone('A', 'hand').length, 2);
  });

  test('Nykthos adds mana equal to devotion', (mk, t) => {
    const T = mk();
    const nyk = T.bf('A', 'Nykthos, Shrine to Nyx');
    T.bf('A', 'Llanowar Elves'); T.bf('A', 'Grizzly Bears');   // devotion to green: 2
    T.mana('A', '2');
    T.g.tapForMana('A', nyk.id, 1, 'G');
    t.eq(T.player('A').pool.G, 2);
  });

  test('Bloom Tender adds one of each colour among your permanents', (mk, t) => {
    const T = mk();
    const bt = T.bf('A', 'Bloom Tender');
    T.bf('A', 'Goblin Guide');
    T.g.tapForMana('A', bt.id, 0);
    t.eq(T.player('A').pool.G, 1);
    t.eq(T.player('A').pool.R, 1);
  });

  test('Mana Vault does not untap on its own', (mk, t) => {
    const T = mk();
    const v = T.bf('A', 'Mana Vault', { tapped: true });
    T.answer('confirm', { yes: false });
    T.nextTurn('A');
    t.ok(v.tapped);
  });

  test('Command Tower makes only its commander\'s colours', (mk, t) => {
    const T = mk();
    const tower = T.bf('A', 'Command Tower');
    const cmd = T.put('A', 'Goblin Guide', 'command');
    cmd.isCommander = true;
    T.g.tapForMana('A', tower.id, 0, 'U');
    t.eq(T.player('A').pool.U, 0, 'no blue');
    t.eq(T.player('A').pool.R, 1, 'red instead');
  });

  test('Urza lands make more mana with the full set out', (mk, t) => {
    const T = mk();
    const tower = T.bf('A', "Urza's Tower");
    T.g.tapForMana('A', tower.id, 0);
    t.eq(T.player('A').pool.C, 1, 'alone: one');
    T.player('A').pool.clear();
    T.bf('A', "Urza's Mine"); T.bf('A', "Urza's Power Plant");
    tower.tapped = false;
    T.g.tapForMana('A', tower.id, 0);
    t.eq(T.player('A').pool.C, 3, 'assembled: three');
  });

  test('Sanctum Weaver counts enchantments; Marwyn taps for her power in green', (mk, t) => {
    const T = mk();
    const sw = T.bf('A', 'Sanctum Weaver');
    T.bf('A', 'Glorious Anthem');
    T.g.tapForMana('A', sw.id, 0, 'W');
    t.eq(T.player('A').pool.W, 2);
    const mw = T.bf('A', 'Marwyn, the Nurturer', { counters: { '+1/+1': 2 } });
    T.g.tapForMana('A', mw.id, 0);
    t.eq(T.player('A').pool.G, T.g.powerOf(mw));
  });
};
