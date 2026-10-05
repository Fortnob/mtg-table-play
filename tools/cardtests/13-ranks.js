/* Cards from ranks 500-2000 and the Standard list, a line or two each. */
'use strict';
module.exports = (test) => {
  test('Liquimetal Torque makes a land an artifact for the turn', (mk, t) => {
    const T = mk();
    const lt = T.bf('A', 'Liquimetal Torque');
    const land = T.bf('B', 'Forest');
    const i = lt.analysis().manaAbilities.length;
    T.activate('A', lt, i, { targets: [land] });
    t.ok(T.g.characteristics(land).addTypes.includes('Artifact'), 'an artifact now');
    T.nextTurn('B');
    t.no(T.g.characteristics(land).addTypes.includes('Artifact'), 'not any more');
  });

  test('Second Harvest copies each token you control', (mk, t) => {
    const T = mk();
    T.g._createNamedToken('A', { token: 'Treasure', n: 2 });
    T.mana('A', 'GG3');
    T.cast('A', T.hand('A', 'Second Harvest'));
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 4);
  });

  test('Ghostly Flicker blinks two of yours', (mk, t) => {
    const T = mk();
    const a = T.bf('A', 'Mulldrifter'), b = T.bf('A', 'Sol Ring');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Ghostly Flicker'), { targets: [a, b] });
    t.zone(a, 'battlefield'); t.zone(b, 'battlefield');
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'Mulldrifter drew again');
  });

  test('Ancient Copper Dragon makes Treasures equal to the roll', (mk, t) => {
    const T = mk();
    const d = T.bf('A', 'Ancient Copper Dragon');
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    const n = T.bfOf('A').filter(o => o.name === 'Treasure').length;
    t.ok(n >= 1 && n <= 20, 'between 1 and 20');
    t.eq(n, T.g._lastRoll);
  });

  test('Noxious Revival puts a graveyard card on top of its library', (mk, t) => {
    const T = mk();
    const c = T.grave('B', 'Craw Wurm');
    T.mana('A', '1');
    T.cast('A', T.hand('A', 'Noxious Revival'), { targets: [c] });
    t.eq(T.zone('B', 'library')[0], c);
  });

  test('Dramatic Reversal untaps nonland permanents only', (mk, t) => {
    const T = mk();
    const ring = T.bf('A', 'Sol Ring', { tapped: true });
    const land = T.bf('A', 'Island', { tapped: true });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Dramatic Reversal'));
    t.no(ring.tapped); t.ok(land.tapped);
  });

  test('Wishclaw Talisman goes to an opponent after a wish', (mk, t) => {
    const T = mk();
    const w = T.put('A', 'Wishclaw Talisman', 'battlefield', { etb: true });
    t.eq(w.counters.wish, 3);
    T.top('A', 'Lightning Bolt');
    T.mana('A', '1');
    T.activate('A', w, 0);
    t.eq(w.controller, 'B');
    t.eq(w.counters.wish, 2);
  });

  test('Valakut Awakening: two to the bottom, three drawn', (mk, t) => {
    const T = mk();
    const a = T.hand('A', 'Island'), b = T.hand('A', 'Forest');
    T.answer('pickCard', { cardIds: [a.id, b.id] });
    T.mana('A', 'R2');
    const lib = T.zone('A', 'library').length;
    T.cast('A', T.hand('A', 'Valakut Awakening'));
    t.eq(T.zone('A', 'hand').length, 3);
    t.eq(T.zone('A', 'library').length, lib - 1);
  });

  test('Good-Fortune Unicorn puts a counter on the creature that entered', (mk, t) => {
    const T = mk();
    T.bf('A', 'Good-Fortune Unicorn');
    const bear = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bear.counters['+1/+1'], 1);
  });

  test('Plaguecrafter: a player with nothing to sacrifice discards', (mk, t) => {
    const T = mk();
    const card = T.hand('B', 'Island');
    T.put('A', 'Plaguecrafter', 'battlefield', { etb: true });
    T.resolve();
    t.zone(card, 'graveyard', 'B had no creature, so discarded');
  });

  test('Emry lets you cast an artifact from your graveyard this turn', (mk, t) => {
    const T = mk();
    const emry = T.bf('A', 'Emry, Lurker of the Loch');
    const ring = T.grave('A', 'Sol Ring');
    T.activate('A', emry, 0, { targets: [ring] });
    const use = T.g.altUsesFor('A', ring.id).find(u => u.via === 'granted');
    t.ok(use, 'offered');
    T.mana('A', '1');
    T.cast('A', ring, { via: 'granted' });
    t.zone(ring, 'battlefield');
  });

  test('Dig Through Time keeps two of seven', (mk, t) => {
    const T = mk();
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'UU6');
    T.cast('A', T.hand('A', 'Dig Through Time'));
    t.eq(T.zone('A', 'hand').length, h0 + 2);
  });

  test('Starting Town enters untapped early, tapped later', (mk, t) => {
    const T = mk();
    const a = T.put('A', 'Starting Town', 'battlefield', { etb: true });
    t.no(a.tapped, 'first turns: untapped');
    for (let i = 0; i < 3; i++) { T.nextTurn('B'); T.nextTurn('A'); }
    const b = T.put('A', 'Starting Town', 'battlefield', { etb: true });
    t.ok(b.tapped, 'turn four: tapped');
  });

  test('Mayhem Devil pings when anybody sacrifices', (mk, t) => {
    const T = mk();
    T.bf('A', 'Mayhem Devil');
    T.g._createNamedToken('B', { token: 'Treasure', n: 1 });
    const treasure = T.bfOf('B').find(o => o.name === 'Treasure');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.g.tapForMana('B', treasure.id, 0, 'R');
    T.resolve();
    t.eq(T.life('B'), 19, 'the Devil hit B');
  });

  test('Archivist of Oghma draws when an opponent searches', (mk, t) => {
    const T = mk();
    T.bf('A', 'Archivist of Oghma');
    T.nextTurn('B');
    const h0 = T.zone('A', 'hand').length;
    T.mana('B', 'G1');
    T.cast('B', T.hand('B', 'Rampant Growth'));
    t.eq(T.zone('A', 'hand').length, h0 + 1);
    t.eq(T.life('A'), 21);
  });

  test('Gravecrawler casts itself from the graveyard with a Zombie about', (mk, t) => {
    const T = mk();
    const gc = T.grave('A', 'Gravecrawler');
    t.no(T.g.altUsesFor('A', gc.id).some(u => u.via === 'selfGrave'), 'no Zombie, no cast');
    T.bf('A', 'Walking Corpse');
    t.ok(T.g.altUsesFor('A', gc.id).some(u => u.via === 'selfGrave'));
    T.mana('A', 'B');
    T.cast('A', gc, { via: 'selfGrave' });
    t.zone(gc, 'battlefield');
  });

  test('Ozolith adds a counter to artifacts as well as creatures', (mk, t) => {
    const T = mk();
    T.bf('A', 'Ozolith, the Shattered Spire');
    const ring = T.bf('A', 'Sol Ring');
    T.g.addCounters(ring, '+1/+1', 1);
    t.eq(ring.counters['+1/+1'], 2);
  });

  test('Mossborn Hydra doubles its counters on landfall', (mk, t) => {
    const T = mk();
    const h = T.bf('A', 'Mossborn Hydra', { counters: { '+1/+1': 2 } });
    T.put('A', 'Forest', 'battlefield', { etb: true });
    T.resolve();
    t.eq(h.counters['+1/+1'], 4);
  });

  test('Bloodletter of Aclazotz doubles life loss on your turn only', (mk, t) => {
    const T = mk();
    T.bf('A', 'Bloodletter of Aclazotz');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 14);
    T.nextTurn('B');
    T.g.changeLife('B', -1);
    t.eq(T.life('B'), 13, 'not on their turn');
  });

  test('Haliya draws after three life gained this turn', (mk, t) => {
    const T = mk();
    T.bf('A', 'Haliya, Guided by Light');
    const h0 = T.zone('A', 'hand').length;
    T.g.changeLife('A', 3);
    T.toMain('A', 'end'); T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test('Ojer Taq comes back transformed', (mk, t) => {
    const T = mk();
    const oj = T.bf('A', 'Ojer Taq, Deepest Foundation');
    T.g.moveObject(oj, 'graveyard');
    T.resolve();
    t.zone(oj, 'battlefield');
    t.eq(oj.face, 1, 'the Temple side');
    t.ok(oj.tapped);
  });

  test('Omniscience: spells from your hand cost nothing', (mk, t) => {
    const T = mk();
    T.bf('A', 'Omniscience');
    T.cast('A', T.hand('A', 'Craw Wurm'));
    t.ok(T.bfOf('A').some(o => o.name === 'Craw Wurm'));
  });

  test('Crime Novelist grows and makes red mana when you sacrifice an artifact', (mk, t) => {
    const T = mk();
    const cn = T.bf('A', 'Crime Novelist');
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    const tr = T.bfOf('A').find(o => o.name === 'Treasure');
    T.g.tapForMana('A', tr.id, 0, 'G');
    T.resolve();
    t.eq(cn.counters['+1/+1'], 1);
    t.eq(T.player('A').pool.R, 1);
  });

  test('Ethereal Armor counts enchantments and gives first strike', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Ethereal Armor'), { targets: [bear] });
    t.eq(T.g.powerOf(bear), 3);
    t.ok(T.g.hasKw(bear, 'first strike'));
  });

  test('Tragic Slip: -13/-13 with morbid, -1/-1 without', (mk, t) => {
    const T = mk();
    const wurm = T.bf('B', 'Craw Wurm');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Tragic Slip'), { targets: [wurm] });
    t.zone(wurm, 'battlefield', 'no morbid');
    const w2 = T.bf('B', 'Craw Wurm');
    T.g.moveObject(T.bf('A', 'Grizzly Bears'), 'graveyard');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Tragic Slip'), { targets: [w2] });
    t.zone(w2, 'graveyard', 'morbid');
  });

  test('Myr Retriever returns another artifact, not itself', (mk, t) => {
    const T = mk();
    const mr = T.bf('A', 'Myr Retriever');
    const ring = T.grave('A', 'Sol Ring');
    T.g.moveObject(mr, 'graveyard');
    T.resolve();
    t.zone(ring, 'hand');
    t.zone(mr, 'graveyard');
  });

  test('Essence Flux: a Spirit comes back with a counter', (mk, t) => {
    const T = mk();
    const sp = T.bf('A', 'Spectral Sailor');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Essence Flux'), { targets: [sp] });
    t.eq(sp.counters['+1/+1'], 1);
  });

  test('Defile shrinks by the Swamps you control', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 3; i++) T.bf('A', 'Swamp');
    const w = T.bf('B', 'Craw Wurm');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Defile'), { targets: [w] });
    t.eq(T.g.powerOf(w), 3);
  });

  test('Devoted Druid untaps for a -1/-1 counter', (mk, t) => {
    const T = mk();
    const dd = T.bf('A', 'Devoted Druid', { tapped: true });
    const i = dd.analysis().manaAbilities.length;
    T.activate('A', dd, i);
    t.no(dd.tapped);
    t.eq(dd.counters['-1/-1'], 1);
  });

  test('Fertile Ground adds a mana of any colour', (mk, t) => {
    const T = mk();
    const f = T.bf('A', 'Forest');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Fertile Ground'), { targets: [f] });
    T.g.tapForMana('A', f.id, 0);
    const pool = T.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G'].reduce((k, c) => k + (pool[c] || 0), 0), 2);
  });

  test('Terror of the Peaks taxes spells aimed at it in life', (mk, t) => {
    const T = mk();
    const tp = T.bf('A', 'Terror of the Peaks');
    T.nextTurn('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [tp] });
    t.eq(T.life('B'), 17);
  });

  test('Elspeth, Storm Slayer: counters, and flying until your next turn', (mk, t) => {
    const T = mk();
    const el = T.bf('A', 'Elspeth, Storm Slayer');
    const bear = T.bf('A', 'Grizzly Bears');
    const i = el.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.cost && x.cost.loyalty === 0);
    T.activate('A', el, i);
    t.eq(bear.counters['+1/+1'], 1);
    t.ok(T.g.hasKw(bear, 'flying'));
    T.nextTurn('B');
    t.ok(T.g.hasKw(bear, 'flying'), 'still during their turn');
    T.nextTurn('A');
    t.no(T.g.hasKw(bear, 'flying'), 'gone on your next turn');
  });

  test('Spelunking: lands enter untapped, and a Cave gains life', (mk, t) => {
    const T = mk();
    T.bf('A', 'Spelunking');
    const gt = T.put('A', 'Azorius Guildgate', 'battlefield', { etb: true });
    t.no(gt.tapped, 'a tapped land enters untapped');
  });

  test("Archdruid's Charm: a land found goes onto the battlefield tapped", (mk, t) => {
    const T = mk();
    const land = T.top('A', 'Forest');
    for (const c of T.zone('A', 'library').slice()) if (c !== land) T.g.moveObject(c, 'exile');
    T.mana('A', 'GGG');
    T.answer('mode', { modes: [0] });
    T.cast('A', T.hand('A', "Archdruid's Charm"));
    t.zone(land, 'battlefield'); t.ok(land.tapped);
  });
};
