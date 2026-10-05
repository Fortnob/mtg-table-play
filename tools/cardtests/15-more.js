/* More single cards from the most-played lists. */
'use strict';
module.exports = (test) => {
  test('Expressive Iteration: one to hand, one to the bottom, one exiled and playable', (mk, t) => {
    const T = mk();
    const a = T.top('A', 'Lightning Bolt'), b = T.top('A', 'Island'), c = T.top('A', 'Shock');
    T.answer('pickCard', { cardIds: [c.id] });
    T.answer('pickCard', { cardIds: [b.id] });
    T.mana('A', 'UR');
    T.cast('A', T.hand('A', 'Expressive Iteration'));
    t.zone(c, 'hand'); t.zone(b, 'exile'); t.zone(a, 'library');
    t.eq(T.zone('A', 'library').slice(-1)[0], a, 'on the bottom');
    t.eq(b.impulseBy, 'A', 'the exiled card may be played');
  });

  test('Swampwalk: unblockable while the defender has a Swamp', (mk, t) => {
    const T = mk();
    const bw = T.bf('A', 'Bog Wraith');
    const wall = T.bf('B', 'Hill Giant');
    t.ok(T.g.couldBlock(wall, bw, 'B'), 'no Swamp: blockable');
    T.bf('B', 'Swamp');
    t.no(T.g.couldBlock(wall, bw, 'B'), 'a Swamp: unblockable');
  });

  test('Sheoldred, Whispering One makes the opponent sacrifice in their upkeep', (mk, t) => {
    const T = mk();
    T.bf('A', 'Sheoldred, Whispering One');
    const bear = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B');
    t.zone(bear, 'graveyard');
  });

  test('Drannith Magistrate stops casting from the graveyard', (mk, t) => {
    const T = mk();
    T.bf('B', 'Drannith Magistrate');
    const fb = T.grave('A', 'Faithless Looting');
    t.no(T.g.canCast('A', fb.id, 'flashback').ok);
  });

  test('Colossus Hammer: +10/+10 and no flying', (mk, t) => {
    const T = mk();
    const bird = T.bf('A', 'Birds of Paradise');
    const ham = T.bf('A', 'Colossus Hammer');
    T.mana('A', '8');
    T.activate('A', ham, 0, { targets: [bird] });
    t.eq(T.g.powerOf(bird), 10);
    t.no(T.g.hasKw(bird, 'flying'));
  });

  test("Lion's Eye Diamond: discard the hand for three mana of one colour", (mk, t) => {
    const T = mk();
    const led = T.bf('A', "Lion's Eye Diamond");
    T.hand('A', 'Island'); T.hand('A', 'Forest');
    t.ok(T.g.tapForMana('A', led.id, 0, 'B'));
    t.eq(T.player('A').pool.B, 3);
    t.eq(T.zone('A', 'hand').length, 0);
    t.zone(led, 'graveyard');
  });

  test('Level bands printed over several lines still apply', (mk, t) => {
    const T = mk();
    const sw = T.bf('A', 'Student of Warfare');
    sw.counters.level = 2;
    T.g.bumpBoard();
    t.eq(T.g.powerOf(sw), 3);
    t.ok(T.g.hasKw(sw, 'first strike'));
    sw.counters.level = 7;
    T.g.bumpBoard();
    t.ok(T.g.hasKw(sw, 'double strike'));
  });
};
