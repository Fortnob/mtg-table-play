/* Standing rules: taxes and discounts, chosen types, replacement effects,
   who may cast what, and spells that can't be countered. */
'use strict';
module.exports = (test) => {
  test('Thalia taxes noncreature spells, not creatures', (mk, t) => {
    const T = mk();
    T.bf('B', 'Thalia, Guardian of Thraben');
    const bolt = T.hand('A', 'Lightning Bolt');
    t.eq(T.g.castCost(bolt), '{1}{R}');
    t.eq(T.g.castCost(T.hand('A', 'Grizzly Bears')), '{1}{G}');
  });

  test('Herald\'s Horn: the chosen type costs less', (mk, t) => {
    const T = mk();
    T.hand('A', 'Llanowar Elves'); T.hand('A', 'Elvish Mystic');     // elves are the commonest type
    const horn = T.put('A', "Herald's Horn", 'battlefield', { etb: true });
    t.eq(horn.chosenType, 'Elf');
    t.eq(T.g.castCost(T.hand('A', 'Elvish Archdruid')), '{G}{G}');
    t.eq(T.g.castCost(T.hand('A', 'Grizzly Bears')), '{1}{G}', 'not an Elf');
  });

  test('Vanquisher\'s Banner pumps the chosen type and draws for it', (mk, t) => {
    const T = mk();
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Grizzly Bears');
    const elf = T.bf('A', 'Llanowar Elves');
    const banner = T.put('A', "Vanquisher's Banner", 'battlefield', { etb: true });
    t.eq(banner.chosenType, 'Bear');
    const bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(bear), 3);
    t.eq(T.g.powerOf(elf), 1);
    T.mana('A', 'G1');
    const hand = T.zone('A', 'hand').length;
    T.cast('A', T.zone('A', 'hand')[0]);
    t.eq(T.zone('A', 'hand').length, hand - 1 + 1, 'cast one, drew one');
  });

  test('Silence stops the opponents casting this turn', (mk, t) => {
    const T = mk();
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Silence'));
    T.g.passPriority('A', true);
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    t.no(T.g.castSpell('B', bolt.id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }));
  });

  test('Grand Abolisher: nothing from the opponents on your turn', (mk, t) => {
    const T = mk();
    T.bf('A', 'Grand Abolisher');
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    t.no(T.g.castSpell('B', T.hand('B', 'Lightning Bolt').id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }));
    T.nextTurn('B');
    T.mana('B', 'R');
    t.ok(T.g.castSpell('B', T.hand('B', 'Lightning Bolt').id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'fine on their own turn');
  });

  test('Hardened Scales adds one more counter', (mk, t) => {
    const T = mk();
    T.bf('A', 'Hardened Scales');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    t.eq(bear.counters['+1/+1'], 2);
    const theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(theirs, '+1/+1', 1);
    t.eq(theirs.counters['+1/+1'], 1, 'only your own');
  });

  test('Authority of the Consuls: their creatures enter tapped', (mk, t) => {
    const T = mk();
    T.bf('A', 'Authority of the Consuls');
    const bear = T.put('B', 'Grizzly Bears', 'battlefield', { etb: true });
    t.ok(bear.tapped);
    T.resolve();
    t.eq(T.life('A'), 21, 'and A gains 1 life');
  });

  test('Rhythm of the Wild: creature spells cannot be countered', (mk, t) => {
    const T = mk();
    T.bf('A', 'Rhythm of the Wild');
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'G1');
    T.cast('A', bear, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [T.stackTarget(bear)] });
    t.zone(bear, 'battlefield');
  });

  test('Dovin\'s Veto cannot be countered', (mk, t) => {
    const T = mk();
    const div = T.hand('A', 'Divination');
    T.mana('A', 'U2');
    T.cast('A', div, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'WU');
    const veto = T.hand('B', "Dovin's Veto");
    T.cast('B', veto, { targets: [T.stackTarget(div)], resolve: false });
    T.mana('A', 'UU');
    T.cast('A', T.hand('A', 'Counterspell'), { targets: [T.stackTarget(veto)] });
    t.zone(div, 'graveyard', 'Divination was countered anyway');
  });

  test('Gray Merchant drains for devotion to black', (mk, t) => {
    const T = mk();
    T.bf('A', 'Phyrexian Arena');                     // {1}{B}{B}
    T.mana('A', 'BB3');
    T.cast('A', T.hand('A', 'Gray Merchant of Asphodel'));   // {3}{B}{B}
    t.eq(T.life('B'), 16);
    t.eq(T.life('A'), 24);
  });

  test('Smothering Tithe: a Treasure unless they pay', (mk, t) => {
    const T = mk();
    T.bf('A', 'Smothering Tithe');
    T.answer('payOrDont', { pay: false });
    T.g.drawCards('B', 1);
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });

  test('Rapid Hybridization gives the controller a Frog Lizard', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Rapid Hybridization'), { targets: [bear] });
    t.zone(bear, 'graveyard');
    const tok = T.bfOf('B').find(o => o.isToken);
    t.ok(tok && T.g.powerOf(tok) === 3);
  });

  test('Avenger of Zendikar makes a Plant for each land', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 3; i++) T.bf('A', 'Forest');
    T.mana('A', 'GG5');
    T.cast('A', T.hand('A', 'Avenger of Zendikar'));
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 3);
  });

  test('Craterhoof pumps by the number of creatures', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'GGG5');
    T.cast('A', T.hand('A', 'Craterhoof Behemoth'));
    t.eq(T.g.powerOf(bear), 4, '2 + 2 creatures');
    t.ok(T.g.hasKw(bear, 'trample'));
  });

  test('Pyroblast only counters a blue spell', (mk, t) => {
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    T.answer('mode', { modes: [0] });
    T.cast('B', T.hand('B', 'Pyroblast'), { targets: [T.stackTarget(bolt)] });
    t.eq(T.life('B'), 17, 'the Bolt still resolved');
  });

  test('Pact of Negation: pay next upkeep or lose', (mk, t) => {
    const T = mk();
    T.mana('A', 'U2');
    const div = T.hand('A', 'Divination');
    T.cast('A', div, { resolve: false });
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Pact of Negation'), { targets: [T.stackTarget(div)] });
    T.answer('payOrDont', { pay: false });
    T.nextTurn('B');
    t.ok(T.player('B').hasLost);
  });

  test('Sensei\'s Divining Top draws and goes back on top', (mk, t) => {
    const T = mk();
    const top = T.bf('A', "Sensei's Divining Top");
    T.activate('A', top, 1);
    t.zone(top, 'library');
    t.eq(T.zone('A', 'library')[0], top);
    t.eq(T.zone('A', 'hand').length, 1);
  });

  test('Command Beacon puts the commander in hand', (mk, t) => {
    const T = mk();
    const cmd = T.put('A', 'Grizzly Bears', 'command');
    cmd.isCommander = true;
    const beacon = T.bf('A', 'Command Beacon');
    T.activate('A', beacon, 1);
    t.zone(cmd, 'hand');
  });

  test('Shadowspear strips hexproof and indestructible', (mk, t) => {
    const T = mk();
    const spear = T.bf('A', 'Shadowspear');
    const troll = T.bf('B', 'Darksteel Myr');
    T.mana('A', '1');
    T.activate('A', spear, 0);
    t.no(T.g.hasKw(troll, 'indestructible'));
  });

  test("Akroma's Memorial grants its whole list, protection included", (mk, t) => {
    const T = mk();
    T.bf('A', "Akroma's Memorial");
    const bear = T.bf('A', 'Grizzly Bears');
    for (const k of ['flying', 'first strike', 'vigilance', 'trample', 'haste']) t.ok(T.g.hasKw(bear, k), k);
    t.ok(T.g._protectedFrom(bear, T.bf('B', 'Vampire Nighthawk')), 'protection from black');
  });

  test('Thalia, Heretic Cathar taps creatures and nonbasic lands of opponents, not basics', (mk, t) => {
    const T = mk();
    T.bf('A', 'Thalia, Heretic Cathar');
    const bear = T.put('B', 'Grizzly Bears', 'battlefield', { etb: true });
    const shock = T.put('B', 'Stomping Ground', 'battlefield', { etb: true });
    T.answer('confirm', { yes: false });
    const forest = T.put('B', 'Forest', 'battlefield', { etb: true });
    T.resolve();
    t.ok(bear.tapped, 'creature tapped');
    t.ok(shock.tapped, 'nonbasic tapped');
    t.no(forest.tapped, 'basic untapped');
  });

  test("Monologue Tax: a Treasure on an opponent's second spell", (mk, t) => {
    const T = mk();
    T.bf('A', 'Monologue Tax');
    T.nextTurn('B');
    T.mana('B', 'RR');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 0);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });
};
