/* Triggers that watch for a kind of thing: what they see, and what they
   are meant to ignore. */
'use strict';
module.exports = (test) => {
  test('Beast Whisperer draws for a creature spell only', (mk, t) => {
    const T = mk();
    T.bf('A', 'Beast Whisperer');
    T.mana('A', 'G1U2');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    t.eq(T.zone('A', 'hand').length, 1, 'drew for the creature');
    T.cast('A', T.hand('A', 'Opt'));
    // Opt draws one itself; Beast Whisperer must not add another
    t.eq(T.zone('A', 'hand').length, 2, 'no extra draw for an instant');
  });

  test('Blood Artist sees a token die', (mk, t) => {
    const T = mk();
    T.bf('A', 'Blood Artist');
    T.mana('A', 'R');
    T.bf('B', 'Grizzly Bears');
    const bolt = T.hand('A', 'Lightning Bolt');
    // a token for B to lose
    T.g._createToken('B', { n: 1, pt: '1/1', subtypes: 'Goblin', colorWords: ['red'], keywords: [] });
    const tok = T.bfOf('B').find(o => o.isToken);
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.cast('A', bolt, { targets: [tok] });
    t.eq(T.life('B'), 19, 'drained by one');
    t.eq(T.life('A'), 21);
  });

  test('Blood Artist sees itself die', (mk, t) => {
    const T = mk();
    const ba = T.bf('A', 'Blood Artist');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.cast('B', bolt, { targets: [ba] });
    t.zone(ba, 'graveyard');
    t.eq(T.life('B'), 19);
  });

  test('Zulaport Cutthroat ignores an opponent\'s creature', (mk, t) => {
    const T = mk();
    T.bf('A', 'Zulaport Cutthroat');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bear] });
    t.eq(T.life('B'), 20);
  });

  test('Impact Tremors fires for a token', (mk, t) => {
    const T = mk();
    T.bf('A', 'Impact Tremors');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Raise the Alarm'));
    t.eq(T.life('B'), 18, 'two soldiers, two damage');
  });

  test('Garruk\'s Uprising draws for a big creature only', (mk, t) => {
    const T = mk();
    t.auto("Garruk's Uprising");
    T.bf('A', "Garruk's Uprising");
    T.mana('A', 'GG1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    t.eq(T.zone('A', 'hand').length, 0);
    T.mana('A', 'G6');
    T.cast('A', T.hand('A', 'Craw Wurm'));
    t.eq(T.zone('A', 'hand').length, 1);
    const bear = T.bfOf('A').find(o => o.name === 'Grizzly Bears');
    t.ok(T.g.hasKw(bear, 'trample'), 'creatures have trample');
  });

  test('Morbid Opportunist draws once for a whole board dying', (mk, t) => {
    const T = mk();
    T.bf('A', 'Morbid Opportunist');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Pyroclasm'));
    t.eq(T.zone('A', 'hand').length, 1);
  });

  test('Grave Pact makes the others sacrifice', (mk, t) => {
    const T = mk();
    t.auto('Grave Pact');
    T.bf('A', 'Grave Pact');
    const mine = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [mine] });
    t.zone(theirs, 'graveyard');
  });

  test('Mystic Remora: the caster may pay, or it draws', (mk, t) => {
    const T = mk();
    t.auto('Mystic Remora');
    T.bf('A', 'Mystic Remora');
    T.nextTurn('B');
    T.mana('B', 'U2');
    T.answer('payOrDont', { pay: false });
    T.cast('B', T.hand('B', 'Divination'));
    t.eq(T.zone('A', 'hand').length, 1, 'Remora drew');
  });
};
