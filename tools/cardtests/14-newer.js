/* The newer keyword actions: discover, earthbend, airbend, manifest dread,
   suspect, endure, increment, harmonize, mayhem, bargain, crimes, station
   and speed live in 11-mechanics. */
'use strict';
module.exports = (test) => {
  test('Discover casts the first card that fits, for free', (mk, t) => {
    const T = mk();
    t.auto('Trumpeting Carnosaur');
    const bear = T.top('A', 'Grizzly Bears');
    const wurm = T.top('A', 'Craw Wurm');        // too big for discover 5? no: 6 mana, so it is skipped
    T.put('A', 'Trumpeting Carnosaur', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bear, 'battlefield', 'cast for free');
    t.eq(T.zone('A', 'library').slice(-1)[0], wurm, 'the skipped card went to the bottom');
  });

  test('Earthbend: a land becomes a hasty creature with counters, and comes back', (mk, t) => {
    const T = mk();
    t.auto('Ba Sing Se');
    const bss = T.bf('A', 'Ba Sing Se');
    const forest = T.bf('A', 'Forest');
    T.mana('A', 'G2');
    const i = bss.analysis().manaAbilities.length;
    T.activate('A', bss, i, { targets: [forest] });
    t.ok(T.g.characteristics(forest).isCreature, 'a creature');
    t.eq(T.g.powerOf(forest), 2);
    t.ok(T.g.hasKw(forest, 'haste'));
    T.g.moveObject(forest, 'graveyard');
    T.resolve();
    t.zone(forest, 'battlefield', 'returned');
    t.ok(forest.tapped, 'tapped');
    t.no(T.g.characteristics(forest).isCreature, 'just a land again');
  });

  test('Airbend: exiled, and its owner may cast it again for {2}', (mk, t) => {
    const T = mk();
    const wurm = T.bf('A', 'Craw Wurm');
    T.mana('A', 'W1');
    T.answer('mode', { modes: [1] });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: wurm.id }] }));
    T.cast('A', T.hand('A', "Airbender's Reversal"));
    t.zone(wurm, 'exile');
    const use = T.g.altUsesFor('A', wurm.id).find(u => u.via === 'airbend');
    t.ok(use && use.cost === '{2}', 'castable for {2}');
    T.mana('A', '2');
    T.cast('A', wurm, { via: 'airbend' });
    t.zone(wurm, 'battlefield');
  });

  test('Manifest dread: one face down, one to the graveyard', (mk, t) => {
    const T = mk();
    t.auto('Manifest Dread');
    const a = T.top('A', 'Grizzly Bears'), b = T.top('A', 'Lightning Bolt');
    T.mana('A', 'G1');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Grizzly Bears').id] }));
    T.cast('A', T.hand('A', 'Manifest Dread'));
    t.zone(a, 'battlefield'); t.ok(a.faceDown, 'face down');
    t.zone(b, 'graveyard');
  });

  test('Suspect: menace and cannot block', (mk, t) => {
    const T = mk();
    t.auto('Caught Red-Handed');
    const wurm = T.bf('B', 'Craw Wurm');
    T.mana('A', 'R4');
    T.cast('A', T.hand('A', 'Caught Red-Handed'), { targets: [wurm] });
    t.eq(wurm.controller, 'A');
    t.ok(T.g.hasKw(wurm, 'menace'));
    t.ok(T.g._hasFlag(wurm, 'cantBlock'), "can't block");
  });

  test('Increment grows a creature when a spell costs more than its size', (mk, t) => {
    const T = mk();
    const tl = T.bf('A', 'Topiary Lecturer');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(tl.counters['+1/+1'] || 0, 0, 'one mana is not more than its power or toughness');
    T.mana('A', 'GG4');
    T.cast('A', T.hand('A', 'Craw Wurm'), { costOverride: '{4}{G}{G}' });
    t.eq(tl.counters['+1/+1'], 1, 'six is');
  });

  test('Harmonize casts from the graveyard and exiles it afterwards', (mk, t) => {
    const T = mk();
    const nr = T.grave('A', "Nature's Rhythm");
    const bear = T.top('A', 'Grizzly Bears');
    T.mana('A', 'GGGG2');
    T.cast('A', nr, { via: 'harmonize', x: 2 });
    t.zone(bear, 'battlefield');
    t.zone(nr, 'exile');
  });

  test('Herd Baloth makes a Beast when counters are put on it', (mk, t) => {
    const T = mk();
    const hb = T.bf('A', 'Herd Baloth');
    T.g.addCounters(hb, '+1/+1', 1);
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Beast').length, 1);
  });

  test('Magda makes a Treasure when you commit a crime', (mk, t) => {
    const T = mk();
    T.bf('A', 'Magda, the Hoardmaster');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });
};
