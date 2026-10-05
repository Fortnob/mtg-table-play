/* Families of cards that share one rule. */
'use strict';
module.exports = (test) => {
  test('Kozilek draws four as it is cast, before it resolves', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const koz = T.hand('A', 'Kozilek, Butcher of Truth');
    T.mana('A', '10');
    T.cast('A', koz, { resolve: false });
    t.ok(T.g.pendingTriggers.length + T.g.stack.length >= 2, 'a trigger above the spell');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 4);
    t.zone(koz, 'battlefield');
  });

  test('Kozilek put into a graveyard shuffles the graveyard back', (mk, t) => {
    const T = mk();
    T.grave('A', 'Island'); T.grave('A', 'Island');
    const koz = T.hand('A', 'Kozilek, Butcher of Truth');
    const lib = T.zone('A', 'library').length;
    T.g.moveObject(koz, 'graveyard');
    T.resolve();
    t.eq(T.zone('A', 'graveyard').length, 0);
    t.eq(T.zone('A', 'library').length, lib + 3);
  });

  test('Ulamog exiles two target permanents on cast', (mk, t) => {
    const T = mk();
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Sol Ring');
    T.mana('A', '10');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }] });
    T.cast('A', T.hand('A', 'Ulamog, the Ceaseless Hunger'), { targets: [a, b] });
    t.zone(a, 'exile'); t.zone(b, 'exile');
  });

  test('Sword of Feast and Famine: protection and the trigger', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const sword = T.bf('A', 'Sword of Feast and Famine');
    T.mana('A', '2');
    T.activate('A', sword, 0, { targets: [bear] });
    t.eq(sword.attachedTo, bear.id);
    t.ok(T.g.hasKw(bear, 'protection from black and from green'), 'granted protection');
    const elf = T.bf('B', 'Llanowar Elves');
    t.ok(T.g._protectedFrom(bear, elf), 'shielded from a green source');
    T.g.dealDamageToObject(bear, 2, elf);
    t.eq(bear.damage, 0, 'green damage prevented');
    const land = T.bf('A', 'Forest', { tapped: true });
    T.hand('B', 'Island');
    T.g._fire('equippedCombatDamage', null, { object: bear, attachedIds: [sword.id], player: 'B', amount: 4 });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 0, 'discarded');
    t.no(land.tapped, 'lands untapped');
  });

  test('Tamiyo\'s Safekeeping protects a permanent', (mk, t) => {
    const T = mk();
    const ring = T.bf('A', 'Sol Ring');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', "Tamiyo's Safekeeping"), { targets: [ring] });
    t.ok(T.g.hasKw(ring, 'indestructible'));
    t.eq(T.life('A'), 22);
  });

  test('Treasure Vault makes X Treasures', (mk, t) => {
    const T = mk();
    const v = T.bf('A', 'Treasure Vault');
    T.mana('A', '6');
    T.activate('A', v, 1, { x: 3 });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 3);
    t.zone(v, 'graveyard');
  });

  test('Vesuva enters tapped as a copy of a land', (mk, t) => {
    const T = mk();
    T.bf('B', 'Stomping Ground');
    const v = T.put('A', 'Vesuva', 'battlefield', { etb: true });
    T.resolve();
    t.eq(v.card.name, 'Stomping Ground');
    t.ok(v.tapped);
  });

  test('Glasspool Mimic copies one of yours and is still a Rogue', (mk, t) => {
    const T = mk();
    T.bf('A', 'Craw Wurm');
    const gm = T.put('A', 'Glasspool Mimic // Glasspool Shore', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.g.powerOf(gm), 6);
    t.ok(/Rogue/.test(gm.card.type_line) && /Wurm/.test(gm.card.type_line), gm.card.type_line);
    t.ok(/^Creature/.test(gm.card.type_line), 'still a creature first');
  });

  test('Thriving Isle: tapped, a colour other than blue, either mana', (mk, t) => {
    const T = mk();
    const isle = T.put('A', 'Thriving Isle', 'battlefield', { etb: true });
    T.resolve();
    t.ok(isle.tapped, 'enters tapped');
    t.ok(isle.chosenColor && isle.chosenColor !== 'U', 'chose ' + isle.chosenColor);
    isle.tapped = false;
    T.g.tapForMana('A', isle.id, 0, 'U');
    t.eq(T.player('A').pool.U, 1);
    isle.tapped = false;
    T.g.tapForMana('A', isle.id, 0, isle.chosenColor);
    t.eq(T.player('A').pool[isle.chosenColor], 1);
  });

  test('Torpor Orb stops enter triggers; Elesh Norn doubles yours', (mk, t) => {
    const T = mk();
    T.bf('A', 'Torpor Orb');
    T.put('A', 'Elvish Visionary', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 0, 'no draw');
    const T2 = mk();
    T2.bf('A', 'Elesh Norn, Mother of Machines');
    T2.put('A', 'Elvish Visionary', 'battlefield', { etb: true });
    T2.resolve();
    t.eq(T2.zone('A', 'hand').length, 2, 'drew twice');
  });

  test('Fiery Emancipation triples a Bolt; Torbran adds 2 only against opponents', (mk, t) => {
    const T = mk();
    T.bf('A', 'Fiery Emancipation');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 11);
    const T2 = mk();
    T2.bf('A', 'Torbran, Thane of Red Fell');
    T2.mana('A', 'RR');
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T2.life('B'), 15);
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T2.life('A'), 17, 'no bonus against yourself');
  });

  test('Lifelink gains what was dealt, doubled or prevented', (mk, t) => {
    const T = mk();
    T.bf('A', 'Gratuitous Violence');
    const lk = T.bf('A', 'Vampire Nighthawk');
    T.g.combat.attackers = [lk.id];
    const got = T.g.dealDamageToPlayer(T.player('B'), 2, lk, true);
    t.eq(got, 4);
  });

  test('Xorn adds a Treasure; Anointed Procession doubles Treasures', (mk, t) => {
    const T = mk();
    T.bf('A', 'Xorn');
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
    const T2 = mk();
    T2.bf('A', 'Anointed Procession');
    T2.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    t.eq(T2.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test('Ojer Taq triples creature tokens, not Treasures; Chatterfang adds Squirrels', (mk, t) => {
    const T = mk();
    T.bf('A', 'Ojer Taq, Deepest Foundation // Temple of Civilization');
    T.g._createToken('A', { pt: '1/1', subtypes: 'Soldier', n: 1 });
    t.eq(T.bfOf('A').filter(o => o.name === 'Soldier').length, 3);
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
    const T2 = mk();
    T2.bf('A', 'Chatterfang, Squirrel General');
    T2.g._createNamedToken('A', { token: 'Food', n: 2 });
    t.eq(T2.bfOf('A').filter(o => o.name === 'Squirrel').length, 2);
  });

  test("Chandra's Ignition: the creature deals its power to everything else", (mk, t) => {
    const T = mk();
    const wurm = T.bf('A', 'Craw Wurm');
    const bear = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Llanowar Elves');
    T.mana('A', 'RR3');
    T.cast('A', T.hand('A', "Chandra's Ignition"), { targets: [wurm] });
    t.zone(wurm, 'battlefield');
    t.zone(bear, 'graveyard'); t.zone(mine, 'graveyard');
    t.eq(T.life('B'), 14);
  });

  test('Warstorm Surge: the entering creature deals the damage', (mk, t) => {
    const T = mk();
    T.bf('A', 'Warstorm Surge');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.put('A', 'Craw Wurm', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.life('B'), 14);
  });

  test('Greater Good draws the sacrificed power, then discards three', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const gg = T.bf('A', 'Greater Good');
    const wurm = T.bf('A', 'Craw Wurm');
    T.activate('A', gg, 0);
    t.zone(wurm, 'graveyard');
    t.eq(T.zone('A', 'hand').length, 3, 'drew 6, discarded 3');
  });

  test("Fling deals the sacrificed creature's power", (mk, t) => {
    const T = mk();
    T.bf('A', 'Craw Wurm');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Fling'), { targets: ['B'] });
    t.eq(T.life('B'), 14);
  });
};
