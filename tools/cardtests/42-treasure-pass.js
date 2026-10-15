/* Sources that sacrifice themselves for mana (Treasure) count as mana you could spend: the table doesn't pass for you,
   and paying uses them only when your taps can't cover the cost. */
'use strict';
module.exports = (test) => {
  const treasure = (T) => { T.g._createNamedToken('A', { token: 'Treasure', n: 1 }); return T.bfOf('A').filter(x => x.isToken && x.name === 'Treasure').pop(); };

  test('Treasure: counts as mana for what you could cast, and is spent to cast it', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('A', 'Mountain', { tapped: true });
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.playableNow('A').some(x => x.kind === 'cast' && x.objId === bolt.id), 'Lightning Bolt is castable with the Treasure');
    t.ok(g.canPayNow('A', '{R}', { forSpell: bolt }), 'the cost can be paid');
    const life = T.life('B');
    T.cast('A', bolt, { targets: ['B'] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('B'), life - 3, 'it resolved');
    t.no(T.bfOf('A').includes(tr), 'the Treasure was sacrificed to pay');
  });

  test('Treasure: lands that can pay are tapped first, the Treasure kept', (mk, t) => {
    const T = mk();
    const land = T.bf('A', 'Mountain');
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'] });
    t.ok(land.tapped, 'the Mountain paid');
    t.ok(T.bfOf('A').includes(tr), 'the Treasure is still there');
  });

  test('Treasure: a Treasure pays the part the lands can’t', (mk, t) => {
    const T = mk();
    const land = T.bf('A', 'Forest');
    const tr = treasure(T);
    const o = T.hand('A', 'Lightning Bolt');
    t.ok(T.g.canPayNow('A', '{R}{G}'), '{R}{G} with a Forest and a Treasure');
    t.no(T.g.canPayNow('A', '{R}{R}'), 'but not {R}{R}');
    T.cast('A', o, { targets: ['B'] });
    t.no(land.tapped, 'the Forest can’t make red: untouched');
    t.no(T.bfOf('A').includes(tr), 'the Treasure made the red');
  });
};
