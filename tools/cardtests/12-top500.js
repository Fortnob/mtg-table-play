/* The most-played cards that used to need a person, one test each. */
'use strict';
module.exports = (test) => {
  test('Gemstone Caverns: in play with a luck counter, a card exiled, any colour', (mk, t) => {
    const T = mk();
    t.auto('Gemstone Caverns');
    const gc = T.hand('A', 'Gemstone Caverns');
    const spare = T.hand('A', 'Island');
    T.g.queueChoice({ type: 'confirm', playerId: 'A', purpose: 'leyline', objId: gc.id, prompt: 'Begin with it?' });
    T.settle();
    t.zone(gc, 'battlefield');
    t.eq(gc.counters.luck, 1);
    t.zone(spare, 'exile', 'paid for with a card');
    t.no(T.g.tapForMana('A', gc.id, 0), 'no colourless with a luck counter');
    t.ok(T.g.tapForMana('A', gc.id, 1, 'G'), 'any colour');
    t.eq(T.player('A').pool.G, 1);
  });

  test('Unnatural Growth doubles your creatures at the beginning of combat', (mk, t) => {
    const T = mk();
    t.auto('Unnatural Growth');
    T.bf('A', 'Unnatural Growth');
    const bear = T.bf('A', 'Grizzly Bears');
    T.toMain('A', 'beginCombat');
    T.resolve();
    t.eq(T.g.powerOf(bear), 4);
    t.eq(T.g.toughnessOf(bear), 4);
  });

  test('Field of the Dead makes a Zombie with seven differently named lands', (mk, t) => {
    const T = mk();
    t.auto('Field of the Dead');
    for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) T.bf('A', n);
    T.put('A', 'Field of the Dead', 'battlefield', { etb: true });
    T.resolve();
    t.no(T.bfOf('A').some(o => o.name === 'Zombie'), 'six names: nothing');
    T.put('A', 'Wastes', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Zombie').length, 1, 'seventh name: a Zombie');
  });

  test('Guardian Project draws only for a new name', (mk, t) => {
    const T = mk();
    t.auto('Guardian Project');
    T.bf('A', 'Guardian Project');
    T.bf('A', 'Grizzly Bears');
    const hand = () => T.zone('A', 'hand').length;
    const h0 = hand();
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(hand(), h0, 'same name: no card');
    T.put('A', 'Llanowar Elves', 'battlefield', { etb: true });
    T.resolve();
    t.eq(hand(), h0 + 1, 'a new name: a card');
  });

  test('Disciple of Freyalise: sacrifice, then life and cards equal to its power', (mk, t) => {
    const T = mk();
    t.auto('Disciple of Freyalise');
    const w = T.bf('A', 'Craw Wurm');
    T.answer('sacrifice', () => ({ cardIds: [w.id] }));
    const h0 = T.zone('A', 'hand').length;
    T.put('A', 'Disciple of Freyalise', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.life('A'), 26);
    t.eq(T.zone('A', 'hand').length, h0 + 6);
  });

  test('Selvala lets the biggest creature\'s controller draw', (mk, t) => {
    const T = mk();
    t.auto('Selvala, Heart of the Wilds');
    T.bf('A', 'Selvala, Heart of the Wilds');
    const h0 = T.zone('B', 'hand').length;
    T.put('B', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, h0, 'not the biggest');
    T.put('B', 'Craw Wurm', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, h0 + 1, 'the Wurm is');
  });

  test('Helm of the Host copies the equipped legend, not legendary, with haste', (mk, t) => {
    const T = mk();
    t.auto('Helm of the Host');
    const legend = T.bf('A', 'Isamaru, Hound of Konda');
    const helm = T.bf('A', 'Helm of the Host');
    T.mana('A', '5');
    T.activate('A', helm, 0, { targets: [legend] });
    T.toMain('A', 'beginCombat');
    T.resolve();
    const copies = T.bfOf('A').filter(o => o.name === 'Isamaru, Hound of Konda');
    t.eq(copies.length, 2, 'both survive the legend rule');
    const tok = copies.find(o => o.isToken);
    t.ok(tok && T.g.hasKw(tok, 'haste'), 'the token has haste');
  });

  test('Dauthi Voidwalker exiles with void counters, then lets you play one', (mk, t) => {
    const T = mk();
    t.auto('Dauthi Voidwalker');
    const dv = T.bf('A', 'Dauthi Voidwalker');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.moveObject(bolt, 'graveyard');
    t.zone(bolt, 'exile');
    t.eq(bolt.counters.void, 1);
    T.activate('A', dv, 0);
    t.ok(T.g.altUsesFor('A', bolt.id).some(u => u.via === 'free'), 'A may cast it for free');
    t.ok(T.g.viewFor('A').players.find(p => p.id === 'A').exile.some(c => c.id === bolt.id), 'shown where A can reach it');
  });

  test('Adeline makes an attacking Human for each opponent', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Adeline, Resplendent Cathar');
    const ad = T.bf('A', 'Adeline, Resplendent Cathar');
    T.answer('declareAttackers', () => [{ attackerId: ad.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    const humans = T.bfOf('A').filter(o => o.name === 'Human');
    t.eq(humans.length, 2);
    t.eq(humans.map(h => h.attacking).sort().join(','), 'B,C');
    t.ok(humans.every(h => h.tapped));
  });

  test('Kutzil draws when a pumped creature connects', (mk, t) => {
    const T = mk();
    t.auto('Kutzil, Malamet Exemplar');
    T.bf('A', 'Kutzil, Malamet Exemplar');
    const bear = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    const h0 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test("Sevinne's Reclamation from the graveyard copies itself for a second card", (mk, t) => {
    const T = mk();
    t.auto("Sevinne's Reclamation");
    const sr = T.grave('A', "Sevinne's Reclamation");
    const a = T.grave('A', 'Sol Ring'), b = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'W4');
    T.cast('A', sr, { via: 'flashback', targets: [a] });
    t.zone(a, 'battlefield');
    t.zone(b, 'battlefield', 'the copy found the other card');
    t.zone(sr, 'exile', 'flashed back');
  });

  test('Birgi lets a creature boast twice; without her, once', (mk, t) => {
    const T = mk();
    t.auto('Usher of the Fallen');
    t.auto('Birgi, God of Storytelling');
    const usher = T.bf('A', 'Usher of the Fallen');
    T.mana('A', 'WW2');
    t.no(T.g.activateAbility('A', usher.id, 0, { auto: true }), 'not before it has attacked');
    usher.attackedTurn = T.g.turn;
    T.activate('A', usher, 0);
    t.no(T.g.activateAbility('A', usher.id, 0, { auto: true }), 'once a turn');
    T.bf('A', 'Birgi, God of Storytelling');
    T.mana('A', 'W1');
    T.activate('A', usher, 0);
    t.eq(T.bfOf('A').filter(o => o.name === 'Human Warrior').length, 2, 'twice with Birgi');
  });

  test('An exhaust ability works once', (mk, t) => {
    const T = mk();
    t.auto('Greenbelt Guardian');
    const gg = T.bf('A', 'Greenbelt Guardian');
    T.mana('A', 'GG6');
    const all = gg.analysis().manaAbilities.concat(gg.analysis().abilities.filter(x => x.kind === 'activated'));
    const ex = all.findIndex(x => x.cost && x.cost.label === 'exhaust');
    T.activate('A', gg, ex);
    t.eq(gg.counters['+1/+1'], 3);
    t.no(T.g.activateAbility('A', gg.id, ex, { auto: true }), 'not again');
  });

  test('Dragonmaster Outcast makes a Dragon only with six or more lands', (mk, t) => {
    const T = mk();
    T.bf('A', 'Dragonmaster Outcast');
    for (let i = 0; i < 5; i++) T.bf('A', 'Mountain');
    T.nextTurn('A');
    t.no(T.bfOf('A').some(o => o.name === 'Dragon'), 'five lands: no Dragon');
    T.bf('A', 'Mountain');
    T.nextTurn('A');
    t.eq(T.bfOf('A').filter(o => o.name === 'Dragon').length, 1, 'six lands: a Dragon');
  });

  test('Forgotten Ancient hands its counters out, one at a time', (mk, t) => {
    const T = mk();
    const fa = T.bf('A', 'Forgotten Ancient', { counters: { '+1/+1': 2 } });
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Grizzly Bears').id] }));
    T.answer('pickCard', { cardIds: [] });
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(bear.counters['+1/+1'], 1, 'one moved');
    t.eq(fa.counters['+1/+1'], 1, 'one kept');
  });

  test('Cursed Mirror is a hasty copy until end of turn', (mk, t) => {
    const T = mk();
    t.auto('Cursed Mirror');
    T.bf('B', 'Craw Wurm');
    const cm = T.hand('A', 'Cursed Mirror');
    T.mana('A', 'R2');
    T.cast('A', cm);
    t.eq(cm.name, 'Craw Wurm', 'a copy');
    t.ok(T.g.hasKw(cm, 'haste'), 'with haste');
    T.nextTurn('B');
    t.eq(cm.name, 'Cursed Mirror', 'itself again');
  });

  test('Shifting Woodland becomes a copy of a graveyard card for the turn', (mk, t) => {
    const T = mk();
    t.auto('Shifting Woodland');
    const sw = T.bf('A', 'Shifting Woodland');
    const wurm = T.grave('A', 'Craw Wurm');
    for (const n of ['Lightning Bolt', 'Sol Ring', 'Divination']) T.grave('A', n);
    T.mana('A', 'GG2');
    const i = sw.analysis().manaAbilities.length + sw.analysis().abilities.filter(x => x.kind === 'activated').findIndex(x => (x.effects || []).some(e => e.op === 'becomeCopy'));
    T.activate('A', sw, i, { targets: [wurm] });
    t.eq(sw.name, 'Craw Wurm');
    t.ok(T.g.characteristics(sw).isCreature);
    T.nextTurn('B');
    t.eq(sw.name, 'Shifting Woodland');
  });

  test('Arena of Glory: exerted, and its mana gives a creature haste', (mk, t) => {
    const T = mk();
    t.auto('Arena of Glory');
    const arena = T.bf('A', 'Arena of Glory');
    T.mana('A', 'R');
    t.ok(T.g.tapForMana('A', arena.id, 1), 'two red');
    t.ok(arena.noUntapNext, 'exerted');
    const bear = T.hand('A', 'Grizzly Bears');
    T.cast('A', bear, { costOverride: '{R}{R}' });
    t.ok(T.g.hasKw(bear, 'haste'), 'haste from the Arena');
  });
};
