/* A card that changes zones is a new object (CR 400.7): counters it had elsewhere stay behind as it enters the
   battlefield — unless the card says they remain (Skullbriar, the Walking Grave). */
'use strict';
module.exports = (test) => {
  test('Zone counters: a card with counters in exile enters the battlefield without them', (mk, t) => {
    const T = mk();
    const o = T.put('A', 'Grizzly Bears', 'exile');
    o.counters = { '+1/+1': 2, time: 3 };
    T.g.moveObject(o, 'battlefield', { controller: 'A' });
    T.settle();
    t.zone(o, 'battlefield');
    t.eq(Object.keys(o.counters).filter(k => o.counters[k]).length, 0, 'no counters carried over');
    t.eq(T.g.powerOf(o), 2, 'a 2/2 again');
  });

  test('Zone counters: Skullbriar keeps its counters coming back from the graveyard', (mk, t) => {
    t.auto('Skullbriar, the Walking Grave');
    const T = mk();
    const o = T.bf('A', 'Skullbriar, the Walking Grave');
    T.g.addCounters(o, '+1/+1', 3);
    T.g.moveObject(o, 'graveyard');
    t.eq(o.counters['+1/+1'], 3, 'kept in the graveyard');
    T.g.moveObject(o, 'battlefield', { controller: 'A' });
    T.settle();
    t.eq(o.counters['+1/+1'], 3, 'and back on the battlefield');
  });

  test('Zone counters: a clone copies no counters (CR 707.2), only what the copied card enters with', (mk, t) => {
    const T = mk();
    const big = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(big, '+1/+1', 2);
    const clone = T.hand('A', 'Clone');
    T.mana('A', 'U3');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Grizzly Bears').id] }));
    T.cast('A', clone);
    t.eq(clone.name, 'Grizzly Bears', 'a copy');
    t.eq(Number((clone.counters || {})['+1/+1']) || 0, 0, 'none of its +1/+1 counters');
    t.eq(T.g.powerOf(clone), 2, 'a 2/2');
  });
};
