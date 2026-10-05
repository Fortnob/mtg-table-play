/* The basics: if these break, nothing else means much. */
'use strict';
module.exports = (test) => {
  test('Lightning Bolt kills a creature', (mk, t) => {
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: [bear] });
    t.zone(bear, 'graveyard');
    t.zone(bolt, 'graveyard');
  });

  test('Lightning Bolt hits a player', (mk, t) => {
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.life('B'), 17);
  });

  test('Counterspell counters a spell', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    const cs = T.hand('B', 'Counterspell');
    T.mana('A', 'U2'); T.mana('B', 'UU');
    T.cast('A', div, { resolve: false });
    // A keeps priority after casting; pass it to B
    T.g.passPriority('A', true);
    T.cast('B', cs, { targets: [T.stackTarget(div)] });
    t.zone(div, 'graveyard');
    t.eq(T.zone('A', 'hand').length, 0, 'A drew nothing');
  });

  test('Divination draws two', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', div);
    t.eq(T.zone('A', 'hand').length, 2);
  });

  test('Swords to Plowshares exiles and gives life', (mk, t) => {
    const T = mk();
    const s = T.hand('A', 'Swords to Plowshares');
    const c = T.bf('B', 'Craw Wurm');
    T.mana('A', 'W');
    T.cast('A', s, { targets: [c] });
    t.zone(c, 'exile');
    t.eq(T.life('B'), 26);
  });

  test('Rampant Growth fetches a basic tapped', (mk, t) => {
    const T = mk();
    const r = T.hand('A', 'Rampant Growth');
    T.mana('A', 'G1');
    T.cast('A', r);
    const lands = T.bfOf('A');
    t.eq(lands.length, 1);
    t.ok(lands[0].tapped, 'tapped');
  });

  test('Llanowar Elves taps for green', (mk, t) => {
    const T = mk();
    const e = T.bf('A', 'Llanowar Elves');
    T.g.tapForMana('A', e.id, 0);
    t.eq(T.player('A').pool.G, 1);
  });

  test('Murder destroys', (mk, t) => {
    const T = mk();
    const m = T.hand('A', 'Murder');
    const c = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BB1');
    T.cast('A', m, { targets: [c] });
    t.zone(c, 'graveyard');
  });
};
