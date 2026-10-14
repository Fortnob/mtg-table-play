/* What an audit of the cards automated for Commander found: merge seams that
   left a reading unreachable, and words the engine counted as done but did
   not do. Each test plays the card against what it says. */
'use strict';
module.exports = (test) => {
  /* Pass priority until something is on the stack whose name says it is this card's. */
  const untilOnStack = (T, re) => {
    const g = T.g;
    for (let i = 0; i < 200 && !g.stack.some(s => re.test(s.name || '')); i++) {
      T.settle();
      if (g.stack.some(s => re.test(s.name || ''))) break;
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    return g.stack.find(s => re.test(s.name || ''));
  };

  test('Audit: Silent Skimmer — the defending player loses 2 life even once it has left combat', (mk, t) => {
    t.auto('Silent Skimmer');
    const T = mk({ players: ['A', 'B', 'C'], library: Array(20).fill('Plains') });
    T.toMain('A');
    const sk = T.bf('A', 'Silent Skimmer'); sk.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: sk.id, defenderId: 'C' }]);
    t.ok(untilOnStack(T, /Silent Skimmer/), 'its attack trigger is on the stack');
    T.g.moveObject(sk, 'hand');
    T.resolve();
    t.eq(T.life('C'), 18, 'C, the player it attacked, loses 2');
    t.eq(T.life('B'), 20, 'B loses nothing');
  });
};
