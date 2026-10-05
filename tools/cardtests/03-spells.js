/* Spells whose second sentence is about the first one's target, searches
   in their many shapes, and counterspells with something attached. */
'use strict';
module.exports = (test) => {
  test('Cultivate: one land to the battlefield tapped, one to hand', (mk, t) => {
    const T = mk();
    const c = T.hand('A', 'Cultivate');
    T.mana('A', 'G2');
    T.cast('A', c);
    const lands = T.bfOf('A');
    t.eq(lands.length, 1, 'one on the battlefield');
    t.ok(lands[0].tapped, 'tapped');
    t.eq(T.zone('A', 'hand').length, 1, 'one in hand');
  });

  test('Sign in Blood: the target player draws and loses the life', (mk, t) => {
    const T = mk();
    const s = T.hand('A', 'Sign in Blood');
    T.mana('A', 'BB');
    T.cast('A', s, { targets: ['B'] });
    t.eq(T.zone('B', 'hand').length, 2);
    t.eq(T.life('B'), 18);
    t.eq(T.life('A'), 20, 'not the caster');
  });

  test('Bojuka Bog exiles a graveyard', (mk, t) => {
    const T = mk();
    T.grave('B', 'Grizzly Bears'); T.grave('B', 'Lightning Bolt');
    const bog = T.hand('A', 'Bojuka Bog');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.playLand('A', bog);
    t.eq(T.zone('B', 'graveyard').length, 0);
    t.eq(T.zone('B', 'exile').length, 2);
    t.ok(bog.tapped);
  });

  test('Gamble discards at random after the search', (mk, t) => {
    const T = mk();
    const g = T.hand('A', 'Gamble');
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', g);
    t.eq(T.zone('A', 'hand').length, 2, 'took one, lost one');
    t.eq(T.zone('A', 'graveyard').length, 2, 'Gamble and the discard');
  });

  test('Mana Drain gives the mana back next main phase', (mk, t) => {
    const T = mk();
    const wurm = T.hand('A', 'Craw Wurm');
    T.mana('A', 'GG4');
    T.cast('A', wurm, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Mana Drain'), { targets: [T.stackTarget(wurm)] });
    t.zone(wurm, 'graveyard');
    T.nextTurn('B');
    t.eq(T.player('B').pool.C, 6, 'six colourless');
  });

  test('Swan Song gives the caster a Bird', (mk, t) => {
    const T = mk();
    const opt = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', opt, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'U');
    T.cast('B', T.hand('B', 'Swan Song'), { targets: [T.stackTarget(opt)] });
    t.zone(opt, 'graveyard');
    const bird = T.bfOf('A').find(o => o.isToken);
    t.ok(bird, 'A got a token');
    t.ok(T.g.hasKw(bird, 'flying'), 'with flying');
  });

  test('Swan Song cannot counter a creature', (mk, t) => {
    const T = mk();
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'G1');
    T.cast('A', bear, { resolve: false });
    const legal = T.g._legalTargetsFor(T.MTG.oracle.analyze(T.MTG.scry.slim(require('../harness').cards().get('swan song'))).abilities[0].effects[0].targets[0], 'B');
    t.eq(legal.length, 0);
  });

  test('An Offer You Can\'t Refuse: two Treasures for the caster of the countered spell', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', div, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'U');
    T.cast('B', T.hand('B', "An Offer You Can't Refuse"), { targets: [T.stackTarget(div)] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test('Arcane Denial: both players draw at the next upkeep', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', div, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'U1');
    T.cast('B', T.hand('B', 'Arcane Denial'), { targets: [T.stackTarget(div)] });
    t.zone(div, 'graveyard');
    T.nextTurn('B');
    t.eq(T.zone('A', 'hand').length, 2, 'A drew two');
    t.eq(T.zone('B', 'hand').length, 2, 'B drew one plus the draw step');
  });

  test('Force of Negation exiles what it counters', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', div, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU1');
    T.cast('B', T.hand('B', 'Force of Negation'), { targets: [T.stackTarget(div)] });
    t.zone(div, 'exile');
  });

  test('Fabled Passage untaps with four lands', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 3; i++) T.bf('A', 'Wastes');
    const fp = T.bf('A', 'Fabled Passage');
    T.activate('A', fp, 0);
    const fetched = T.bfOf('A').find(o => o.card.type_line.includes('Basic') && o.name !== 'Wastes');
    t.ok(fetched, 'fetched');
    t.no(fetched.tapped, 'untapped: four lands');
  });

  test('Fabled Passage stays tapped with fewer lands', (mk, t) => {
    const T = mk();
    const fp = T.bf('A', 'Fabled Passage');
    T.activate('A', fp, 0);
    t.ok(T.bfOf('A')[0].tapped);
  });

  test('Heroic Intervention protects everything you control', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const land = T.bf('A', 'Forest');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Heroic Intervention'));
    t.ok(T.g.hasKw(bear, 'indestructible') && T.g.hasKw(bear, 'hexproof'));
    t.ok(T.g.hasKw(land, 'indestructible'));
    T.nextTurn('B');
    t.no(T.g.hasKw(bear, 'indestructible'), 'gone at end of turn');
  });

  test('Doom Blade will not point at a black creature', (mk, t) => {
    const T = mk();
    T.bf('B', 'Vampire Nighthawk');
    const a = T.MTG.oracle.analyze(require('../harness').card('Doom Blade'));
    t.eq(T.g._legalTargetsFor(a.abilities[0].effects[0].targets[0], 'A').length, 0);
  });

  test('Lightning Bolt will not point at a land', (mk, t) => {
    const T = mk();
    T.bf('B', 'Forest');
    const a = T.MTG.oracle.analyze(require('../harness').card('Lightning Bolt'));
    const legal = T.g._legalTargetsFor(a.abilities[0].effects[0].targets[0], 'A');
    t.eq(legal.filter(x => x.kind === 'object').length, 0);
  });

  test('Eternal Witness only reaches into your own graveyard', (mk, t) => {
    const T = mk();
    T.grave('B', 'Lightning Bolt');
    const mine = T.grave('A', 'Divination');
    T.hand('A', 'Eternal Witness');
    const a = T.MTG.oracle.analyze(require('../harness').card('Eternal Witness'));
    const legal = T.g._legalTargetsFor(a.abilities[0].effects[0].targets[0], 'A');
    t.eq(legal.length, 1);
    t.eq(legal[0].id, mine.id);
  });

  test('Path to Exile: the exiled creature\'s controller searches', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Path to Exile'), { targets: [bear] });
    t.zone(bear, 'exile');
    t.eq(T.bfOf('B').length, 1, 'B fetched a land');
    t.ok(T.bfOf('B')[0].tapped);
    t.eq(T.bfOf('A').length, 0, 'not A');
  });
};
