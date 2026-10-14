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

  test('Audit: a bot pays Mogis with a creature once its life is short (its answer had been overwritten)', (mk, t) => {
    t.auto('Mogis, God of Slaughter');
    const run = (life) => {
      const T = mk();
      const mo = T.bf('A', 'Mogis, God of Slaughter');
      const bears = T.bf('B', 'Grizzly Bears');
      T.player('B').life = life; T.player('B').isBot = true;
      const bot = new T.MTG.bots.BotPlayer(T.g, 'B', 8);
      T.g._runEffects(mo.analysis().abilities.find(a => a.kind === 'triggered').effects,
        { controller: 'A', obj: mo, name: 'Mogis', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
      const ch = T.g.pendingChoice;
      t.ok(ch && ch.playerId === 'B', 'B is asked');
      bot.doChoice(ch);
      T.settle();
      return { T, bears };
    };
    const low = run(6);
    t.zone(low.bears, 'graveyard', 'at 6 life the bot sacrifices the Bears');
    t.eq(low.T.life('B'), 6, 'and takes no damage');
    const high = run(20);
    t.zone(high.bears, 'battlefield', 'at 20 life it keeps the Bears');
    t.eq(high.T.life('B'), 18, 'and takes 2');
  });
};
