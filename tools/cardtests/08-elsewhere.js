/* Cards used from somewhere other than the hand. */
'use strict';
module.exports = (test) => {
  test('Crucible of Worlds plays a land from the graveyard', (mk, t) => {
    const T = mk();
    T.bf('A', 'Crucible of Worlds');
    const land = T.grave('A', 'Forest');
    t.ok(T.g.playableNow('A').some(x => x.kind === 'land' && x.objId === land.id), 'offered');
    T.playLand('A', land);
    t.zone(land, 'battlefield');
  });

  test('Without Crucible a graveyard land is not offered', (mk, t) => {
    const T = mk();
    const land = T.grave('A', 'Forest');
    t.no(T.g.playableNow('A').some(x => x.objId === land.id), 'not offered');
  });

  test('An opponent\'s Courser does not help you', (mk, t) => {
    const T = mk();
    T.bf('B', 'Courser of Kruphix');
    const land = T.top('A', 'Forest');
    t.no(T.g.playableNow('A').some(x => x.objId === land.id), 'not offered');
  });

  test('Mystic Forge casts an artifact from the top, but not a creature', (mk, t) => {
    const T = mk();
    T.bf('A', 'Mystic Forge');
    const ring = T.top('A', 'Sol Ring');
    T.mana('A', '1');
    T.cast('A', ring);
    t.zone(ring, 'battlefield');
    const bear = T.top('A', 'Grizzly Bears');
    t.no(T.g.canCast('A', bear.id).ok, 'a green creature is not colourless');
  });

  test('Bolas\'s Citadel pays life instead of mana', (mk, t) => {
    const T = mk();
    T.bf('A', "Bolas's Citadel");
    const wurm = T.top('A', 'Craw Wurm');
    T.cast('A', wurm);
    t.zone(wurm, 'battlefield');
    t.eq(T.life('A'), 14);
  });

  test('Thriving land enters tapped unless a basic land is there', (mk, t) => {
    const T = mk();
    const tem = T.put('A', 'Abandoned Air Temple', 'battlefield', { etb: true });
    T.resolve();
    t.ok(tem.tapped, 'tapped with no basic');
    T.bf('A', 'Plains');
    const tem2 = T.put('A', 'Abandoned Air Temple', 'battlefield', { etb: true });
    T.resolve();
    t.no(tem2.tapped, 'untapped with a Plains');
  });
};
