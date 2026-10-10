/* Cards that move at the same moment, and the triggers that look back
   at that moment (CR 603.10a): a card that left the graveyard with the
   others was in the graveyard too, not on the battlefield to see them go. */
'use strict';
module.exports = (test) => {
  const zombies = (T) => T.bfOf('A').filter(o => o.isToken && /Zombie/.test(o.name || '')).length;

  test('Together: Tormod brought back with the rest sees none of them leave', (mk, t) => {
    t.auto('Tormod, the Desecrator');
    const T = mk();
    T.grave('A', 'Tormod, the Desecrator');
    T.grave('A', 'Grizzly Bears');
    T.grave('A', 'Hill Giant');
    T.mana('A', 'BBB7');
    T.cast('A', T.hand('A', 'Rise of the Dark Realms'));
    t.eq(T.names(T.bfOf('A').filter(o => !o.isToken)).sort().join(', '), 'Grizzly Bears, Hill Giant, Tormod, the Desecrator', 'all three came back');
    t.eq(zombies(T), 0, 'and Tormod made no Zombie');
  });

  test('Together: Tormod already on the battlefield sees the lot leave, once', (mk, t) => {
    const T = mk();
    T.bf('A', 'Tormod, the Desecrator');
    T.grave('A', 'Grizzly Bears');
    T.grave('A', 'Hill Giant');
    T.mana('A', 'BBB7');
    T.cast('A', T.hand('A', 'Rise of the Dark Realms'));
    t.eq(zombies(T), 1, 'one Zombie for the cards that left together');
  });

  test('Together: one card after another is seen, by a Tormod back first', (mk, t) => {
    const T = mk();
    T.grave('A', 'Tormod, the Desecrator');
    const bears = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'B4');
    // Tormod comes back by one spell; the Bears leave by another, after it
    T.cast('A', T.hand('A', 'Zombify'), { targets: [T.zone('A', 'graveyard').find(o => o.name === 'Tormod, the Desecrator')] });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Disentomb'), { targets: [bears] });
    t.eq(zombies(T), 1, 'Tormod saw the Bears leave');
  });
};
