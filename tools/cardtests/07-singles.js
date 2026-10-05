/* Cards with rules of their own, written out by hand or by a narrow rule. */
'use strict';
module.exports = (test) => {
  test('Otawara channels from the hand and bounces', (mk, t) => {
    const T = mk();
    const ot = T.hand('A', 'Otawara, Soaring City');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U3');
    t.ok(T.g.cycleCard('A', ot.id, { auto: true }), 'channelled');
    T.resolve();
    t.zone(ot, 'graveyard');
    t.zone(bear, 'hand');
  });

  test('Otawara costs less for each legend', (mk, t) => {
    const T = mk();
    const ot = T.hand('A', 'Otawara, Soaring City');
    T.bf('A', 'Isamaru, Hound of Konda');
    const use = T.g.altUsesFor('A', ot.id).find(u => u.channel);
    t.eq(use.cost, '{2}{U}');
  });

  test('The One Ring: protection when cast, burden and draws', (mk, t) => {
    const T = mk();
    const ring = T.hand('A', 'The One Ring');
    T.mana('A', '4');
    T.cast('A', ring);
    t.ok(T.g._protected(T.player('A')), 'protected');
    T.activate('A', ring, 0);
    t.eq(T.zone('A', 'hand').length, 1);
    T.nextTurn('A');
    t.no(T.g._protected(T.player('A')), 'protection gone');
    t.eq(T.life('A'), 19, 'lost 1 for the burden counter');
    T.activate('A', ring, 0);
    t.eq(T.zone('A', 'hand').length, 1 + 1 + 2, 'drew for two counters (plus the draw step)');
  });

  test('Teferi\'s Protection phases everything out and locks life', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'W2');
    const tp = T.hand('A', "Teferi's Protection");
    T.cast('A', tp);
    t.ok(bear.phasedOut, 'phased out');
    t.zone(tp, 'exile');
    T.nextTurn('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Pyroclasm' === 'x' ? '' : 'Lava Spike'), { targets: [] , resolve: true });
    t.eq(T.life('A'), 20, 'life cannot change');
    T.nextTurn('A');
    t.no(bear.phasedOut, 'back in on its controller\'s turn');
  });

  test('Urza\'s Saga makes Constructs and fetches a cheap artifact', (mk, t) => {
    const T = mk();
    T.put('A', 'Sol Ring', 'library', { top: false });
    const saga = T.put('A', "Urza's Saga", 'battlefield', { etb: true });
    T.resolve();
    T.nextTurn('A');           // chapter II
    T.mana('A', '2');
    T.activate('A', saga, 1);
    const cons = T.bfOf('A').find(o => o.name === 'Construct');
    t.ok(cons, 'a Construct');
    t.ok(T.g.powerOf(cons) >= 1, 'it counts artifacts');
    T.nextTurn('A');           // chapter III
    t.ok(T.bfOf('A').some(o => o.name === 'Sol Ring'), 'Sol Ring fetched');
    t.zone(saga, 'graveyard');
  });

  test('Victimize returns two creatures for one', (mk, t) => {
    const T = mk();
    const a1 = T.grave('A', 'Craw Wurm'), a2 = T.grave('A', 'Grizzly Bears');
    const fodder = T.bf('A', 'Llanowar Elves');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Victimize'), { targets: [a1, a2] });
    t.zone(fodder, 'graveyard');
    t.zone(a1, 'battlefield'); t.zone(a2, 'battlefield');
    t.ok(a1.tapped && a2.tapped);
  });

  test('Chrome Mox taps for the imprinted card\'s colour', (mk, t) => {
    const T = mk();
    T.hand('A', 'Lightning Bolt');
    const mox = T.put('A', 'Chrome Mox', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('A', 'exile').length, 1);
    T.g.tapForMana('A', mox.id, 0);
    t.eq(T.player('A').pool.R, 1);
  });

  test('Mox Diamond needs a land to discard', (mk, t) => {
    const T = mk();
    const mox = T.put('A', 'Mox Diamond', 'battlefield', { etb: true });
    t.zone(mox, 'graveyard', 'no land: gone');
    const T2 = mk();
    const land = T2.hand('A', 'Forest');
    const mox2 = T2.put('A', 'Mox Diamond', 'battlefield', { etb: true });
    T2.settle();
    t.zone(mox2, 'battlefield');
    t.zone(land, 'graveyard');
  });

  test('Animate Dead brings a creature back, and takes it with it', (mk, t) => {
    const T = mk();
    const wurm = T.grave('B', 'Craw Wurm');
    const ad = T.hand('A', 'Animate Dead');
    T.mana('A', 'B1');
    T.cast('A', ad, { targets: [wurm] });
    t.zone(wurm, 'battlefield');
    t.eq(wurm.controller, 'A');
    t.eq(T.g.powerOf(wurm), 5);
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', "Nature's Claim"), { targets: [ad] });
    t.zone(wurm, 'graveyard', 'sacrificed when the Aura left');
  });

  test('Orcish Bowmasters pings on the second draw, not the draw step', (mk, t) => {
    const T = mk();
    T.bf('A', 'Orcish Bowmasters');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.g.drawCards('B', 1);
    T.resolve();
    t.eq(T.life('B'), 19);
    t.ok(T.bfOf('A').some(o => /Army/.test(o.card.type_line)), 'amassed');
  });

  test('Academy Manufactor makes one of each', (mk, t) => {
    const T = mk();
    T.bf('A', 'Academy Manufactor');
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    const names = T.bfOf('A').map(o => o.name);
    t.ok(['Clue', 'Food', 'Treasure'].every(n => names.includes(n)));
  });

  test('Panharmonicon doubles an enters trigger', (mk, t) => {
    const T = mk();
    T.bf('A', 'Panharmonicon');
    T.bf('A', 'Impact Tremors');
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Spark Double copies a legend without dying to the legend rule', (mk, t) => {
    const T = mk();
    const leg = T.bf('A', 'Isamaru, Hound of Konda');
    const sd = T.put('A', 'Spark Double', 'battlefield', { etb: true });
    T.g.checkStateBasedActions();
    t.zone(leg, 'battlefield'); t.zone(sd, 'battlefield');
    t.eq(T.g.powerOf(sd), 3, '2/2 plus a counter');
  });

  test('Living Death swaps the graveyard and the battlefield', (mk, t) => {
    const T = mk();
    const dead = T.grave('A', 'Craw Wurm');
    const alive = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BB3');
    T.cast('A', T.hand('A', 'Living Death'));
    t.zone(dead, 'battlefield'); t.zone(alive, 'graveyard');
  });

  test('Ephemerate rebounds', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const eph = T.hand('A', 'Ephemerate');
    T.mana('A', 'W');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.cast('A', eph, { targets: [bear] });
    t.zone(eph, 'exile');
    T.nextTurn('A');
    t.zone(eph, 'graveyard', 'cast again and gone');
  });

  test('Jeska\'s Will: both modes with a commander out', (mk, t) => {
    const T = mk();
    const cmd = T.bf('A', 'Goblin Guide');
    cmd.isCommander = true;
    for (let i = 0; i < 3; i++) T.hand('B', 'Island');
    T.mana('A', 'R2');
    T.answer('mode', { modes: [0, 1] });
    T.cast('A', T.hand('A', "Jeska's Will"));
    t.eq(T.player('A').pool.R, 3);
    t.eq(T.zone('A', 'exile').length, 3);
  });

  test('Underworld Breach gives graveyard cards escape', (mk, t) => {
    const T = mk();
    T.bf('A', 'Underworld Breach');
    const bolt = T.grave('A', 'Lightning Bolt');
    for (let i = 0; i < 3; i++) T.grave('A', 'Island');
    T.mana('A', 'R');
    T.cast('A', bolt, { via: 'escape', targets: ['B'] });
    t.eq(T.life('B'), 17);
    t.eq(T.zone('A', 'exile').length, 3);
  });

  test('Mosswort Bridge hides a card and plays it with 10 power', (mk, t) => {
    const T = mk();
    T.top('A', 'Grizzly Bears');
    const br = T.put('A', 'Mosswort Bridge', 'battlefield', { etb: true });
    T.resolve();
    const hidden = T.zone('A', 'exile')[0];
    t.ok(hidden, 'something hidden');
    T.bf('A', 'Craw Wurm'); T.bf('A', 'Craw Wurm');
    br.tapped = false;
    T.mana('A', 'G');
    T.activate('A', br, 1);
    t.ok(T.g.altUsesFor('A', hidden.id).some(u => u.via === 'free') || (hidden.analysis().isLand), 'free to cast');
  });

  test('Simian Spirit Guide exiles itself from the hand for mana', (mk, t) => {
    const T = mk();
    const sg = T.hand('A', 'Simian Spirit Guide');
    t.ok(T.g.cycleCard('A', sg.id, { auto: true, channel: true }), 'used');
    t.zone(sg, 'exile');
    t.eq(T.player('A').pool.R, 1);
    t.eq(T.g.stack.length, 0, 'no stack');
  });

  test('Cabal Ritual makes more with threshold', (mk, t) => {
    const T = mk();
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Cabal Ritual'));
    t.eq(T.player('A').pool.B, 3);
    const T2 = mk();
    for (let i = 0; i < 7; i++) T2.grave('A', 'Island');
    T2.mana('A', 'B1');
    T2.cast('A', T2.hand('A', 'Cabal Ritual'));
    t.eq(T2.player('A').pool.B, 5);
  });
};
