/* Cards that were automated once and must stay so, with what they do: a guard against a later, more general
   pattern taking a sentence away from the card-specific one (src/03-oracle.js reads patterns in order). */
'use strict';
module.exports = (test) => {
  test('Regressions: Rite of Replication — one token copy of the target, five when kicked', (mk, t) => {
    t.auto('Rite of Replication');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2UU');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.cast('A', T.hand('A', 'Rite of Replication'), { targets: [{ kind: 'object', id: bear.id }] });
    T.resolve();
    const copies = (G) => G.g.battlefield.filter(x => x.controller === 'A' && x.isToken && x.name === 'Grizzly Bears').length;
    t.eq(copies(T), 1, 'one copy unkicked');
    const T2 = mk();
    const bear2 = T2.bf('B', 'Grizzly Bears');
    T2.mana('A', '7UU');
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear2.id }] }));
    T2.cast('A', T2.hand('A', 'Rite of Replication'), { kick: 1, targets: [{ kind: 'object', id: bear2.id }] });
    T2.resolve();
    t.eq(copies(T2), 5, 'five when kicked');
  });
};
