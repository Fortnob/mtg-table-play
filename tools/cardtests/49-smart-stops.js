/* Smart stops, as Arena's auto-pass: with stops at their defaults, an opponent's spell aimed at something of
   yours stops the game for you when you have something you could answer it with, and goes by when you have
   nothing (the table still shows it). The opponent a bot, or another person, whose holding priority over their
   own spell is not your having seen it. */
'use strict';
module.exports = (test) => {
  const cfg = (M) => ({ enabled: true, untilStackChange: true, stops: M.DEFAULT_STOPS, fullControl: false, smart: true });
  /* B's turn: B casts Shock at A's Grizzly Bears and passes. `setup` gives A what A holds. */
  const shockAtBears = (mk, setup, bot) => {
    const T = mk({ players: ['A', 'B'] });
    const g = T.g;
    if (bot) g.player('B').isBot = true;
    else g.setAutoPass('B', cfg(T.MTG));
    T.toMain('B');
    const bears = T.bf('A', 'Grizzly Bears');
    setup(T);
    T.bf('B', 'Mountain');
    const shock = T.hand('B', 'Shock');
    g.setAutoPass('A', cfg(T.MTG));
    T.cast('B', shock, { targets: [bears], resolve: false });
    g.passPriority('B');
    return { T, g, bears };
  };

  for (const [who, bot] of [['a bot', true], ['a person', false]]) {
    test(`Smart stop: ${who}'s spell at your creature stops you when you could answer it`, (mk, t) => {
      const { g, bears } = shockAtBears(mk, (T) => { T.bf('A', 'Forest'); T.hand('A', 'Giant Growth'); }, bot);
      t.eq(g.stack.length, 1, 'Shock is still on the stack');
      t.eq(g.priorityPlayer && g.priorityPlayer.id, 'A', 'A has priority to answer it');
      t.zone(bears, 'battlefield', 'the Bears are still there');
    });
  }

  test('Smart stop: with nothing to answer it with, the opponent\'s spell goes by', (mk, t) => {
    const { g, bears } = shockAtBears(mk, (T) => { T.hand('A', 'Giant Growth'); }, true);     // no mana for it
    t.eq(g.stack.length, 0, 'Shock resolved without stopping');
    t.zone(bears, 'graveyard', 'the Bears died');
  });
};
