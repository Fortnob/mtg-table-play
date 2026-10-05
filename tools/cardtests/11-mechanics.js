/* Mechanics that cut across many cards: abilities used from the
   graveyard, permanents tapped as a cost, choices made while casting,
   copies of spells and abilities, and abilities handed out in quotes. */
'use strict';
module.exports = (test) => {
  test('Reassembling Skeleton comes back from the graveyard, tapped', (mk, t) => {
    const T = mk();
    t.auto('Reassembling Skeleton');
    const sk = T.grave('A', 'Reassembling Skeleton');
    const use = T.g.altUsesFor('A', sk.id).find(u => /^ability:/.test(u.via || ''));
    t.ok(use, 'offered from the graveyard');
    T.mana('A', 'B1');
    t.ok(T.g.playableNow('A').some(x => x.objId === sk.id), 'counts as something to do');
    T.cast('A', sk, { via: use.via });
    t.zone(sk, 'battlefield');
    t.ok(sk.tapped, 'tapped');
    t.no(T.g.altUsesFor('A', sk.id).length, 'nothing more to offer on the battlefield');
    t.no(T.g.activateAbility('A', sk.id, 0, { auto: true }), 'the ability does nothing on the battlefield');
  });

  test('A finality counter exiles the creature instead of letting it die', (mk, t) => {
    const T = mk();
    t.auto('Resurrected Cultist');
    const rc = T.grave('A', 'Resurrected Cultist');
    for (const n of ['Lightning Bolt', 'Grizzly Bears', 'Sol Ring', 'Forest']) T.grave('A', n);
    const use = T.g.altUsesFor('A', rc.id).find(u => /^ability:/.test(u.via || ''));
    t.ok(use, 'offered with four card types in the graveyard');
    T.mana('A', 'BB2');
    T.cast('A', rc, { via: use.via });
    t.zone(rc, 'battlefield');
    t.eq(rc.counters.finality, 1);
    T.g.moveObject(rc, 'graveyard');
    t.zone(rc, 'exile', 'exiled instead');
  });

  test('Wonder gives flying from the graveyard, while you control an Island', (mk, t) => {
    const T = mk();
    t.auto('Wonder');
    const bear = T.bf('A', 'Grizzly Bears');
    T.grave('A', 'Wonder');
    t.no(T.g.hasKw(bear, 'flying'), 'no Island yet');
    T.bf('A', 'Island');
    t.ok(T.g.hasKw(bear, 'flying'), 'flying with an Island');
    t.no(T.g.hasKw(T.bf('B', 'Hill Giant'), 'flying'), 'only your creatures');
  });

  test('Scavenge leaves the creature card\'s power behind as counters', (mk, t) => {
    const T = mk();
    t.auto('Deadbridge Goliath');
    const dg = T.grave('A', 'Deadbridge Goliath');
    const bear = T.bf('A', 'Grizzly Bears');
    const use = T.g.altUsesFor('A', dg.id).find(u => /^ability:/.test(u.via || ''));
    T.mana('A', 'GG4');
    T.cast('A', dg, { via: use.via, targets: [bear] });
    t.zone(dg, 'exile');
    t.eq(bear.counters['+1/+1'], 5);
  });

  test('Bitter Triumph: with no card to discard, the life is paid without asking', (mk, t) => {
    const T = mk();
    t.auto('Bitter Triumph');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Bitter Triumph'), { targets: [bear] });
    t.no(T.asked.some(c => c.purpose === 'castChoice'), 'nothing to ask');
    t.eq(T.life('A'), 17);
    t.zone(bear, 'graveyard');
  });

  test('Bitter Triumph asks which price, and takes the one chosen', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const spare = T.hand('A', 'Island');
    T.mana('A', 'B1');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /discard/i.test(o.label)).i] }));
    T.cast('A', T.hand('A', 'Bitter Triumph'), { targets: [bear] });
    t.ok(T.asked.some(c => c.purpose === 'castChoice'), 'asked');
    t.zone(spare, 'graveyard', 'discarded');
    t.eq(T.life('A'), 20, 'no life paid');
    t.zone(bear, 'graveyard');
  });

  test('Redirect Lightning pays {2} when that is the only price it can pay', (mk, t) => {
    const T = mk({ life: 4 });
    t.auto('Redirect Lightning');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.mana('B', 'R');
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Redirect Lightning'), { targets: [T.stackTarget(bolt)], resolve: false });
    t.eq(T.life('A'), 4, 'paid in mana, not life');
    t.eq(T.player('A').pool.C || 0, 0, 'the {2} was spent');
  });

  test('Gift: Into the Flood Maw promised, the Fish arrives and a permanent goes home', (mk, t) => {
    const T = mk();
    t.auto('Into the Flood Maw');
    const ring = T.bf('B', 'Sol Ring');
    T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Promise/.test(o.label)).i] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: ring.id }] }));
    T.cast('A', T.hand('A', 'Into the Flood Maw'));
    const fish = T.bfOf('B').find(o => o.name === 'Fish');
    t.ok(fish && fish.tapped, 'a tapped Fish for the opponent');
    t.zone(ring, 'hand', 'a noncreature permanent bounced');
  });

  test('Gift: not promised, Into the Flood Maw only reaches creatures', (mk, t) => {
    const T = mk();
    const ring = T.bf('B', 'Sol Ring');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Into the Flood Maw'));
    t.zone(bear, 'hand');
    t.zone(ring, 'battlefield');
    t.no(T.bfOf('B').some(o => o.name === 'Fish'), 'no Fish');
  });

  test("Dawn's Truce: you and your permanents gain hexproof; the gift adds indestructible", (mk, t) => {
    const T = mk();
    t.auto("Dawn's Truce");
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', "Dawn's Truce"), { gift: 'B' });
    t.ok(T.g.hasKw(bear, 'hexproof'), 'hexproof');
    t.ok(T.g.hasKw(bear, 'indestructible'), 'indestructible with the gift');
    t.eq(T.zone('B', 'hand').length, 1, 'the opponent drew the gift');
    t.no(T.g._legalTargetsFor({ type: 'player' }, 'B').some(x => x.id === 'A'), 'the player has hexproof too');
  });

  test('Gift on a permanent: Scrapshooter hands over the card as it enters', (mk, t) => {
    const T = mk();
    t.auto('Scrapshooter');
    const ring = T.bf('B', 'Sol Ring');
    T.mana('A', 'GG1');
    T.cast('A', T.hand('A', 'Scrapshooter'), { gift: 'B' });
    t.eq(T.zone('B', 'hand').length, 1, 'gift drawn');
    t.zone(ring, 'graveyard', 'the promised destruction');
  });

  test('Undying Malice: the creature comes back, tapped, with a counter', (mk, t) => {
    const T = mk();
    t.auto('Undying Malice');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Undying Malice'), { targets: [bear] });
    T.mana('B', 'R');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.zone(bear, 'battlefield', 'back again');
    t.ok(bear.tapped, 'tapped');
    t.eq(bear.counters['+1/+1'], 1);
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.zone(bear, 'graveyard', 'the second time it stays: the ability went with it');
  });

  test('Diamond Pick-Axe hands its creature an attack trigger', (mk, t) => {
    const T = mk();
    t.auto('Diamond Pick-Axe');
    const bear = T.bf('A', 'Grizzly Bears');
    const axe = T.bf('A', 'Diamond Pick-Axe');
    T.mana('A', '2');
    T.activate('A', axe, 0, { targets: [bear] });
    t.eq(axe.attachedTo, bear.id, 'equipped');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.ok(T.bfOf('A').some(o => o.name === 'Treasure'), 'a Treasure for attacking');
  });

  test('Heliod is not a creature until devotion reaches five, and needs another target', (mk, t) => {
    const T = mk();
    t.auto('Heliod, Sun-Crowned');
    const heliod = T.bf('A', 'Heliod, Sun-Crowned');
    t.no(T.g.characteristics(heliod).isCreature, 'devotion 1: not a creature');
    t.no(T.g.canAttack(heliod), 'cannot attack');
    T.bf('A', 'Serra Angel'); T.bf('A', 'Serra Angel');
    t.ok(T.g.characteristics(heliod).isCreature, 'devotion 5: a creature');
    T.mana('A', 'W1');
    t.no(T.g.activateAbility('A', heliod.id, 0, { auto: true, targets: [{ kind: 'object', id: heliod.id }] }), 'not itself');
    const bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', heliod, 0, { targets: [bear] });
    t.ok(T.g.hasKw(bear, 'lifelink'), 'another creature gains lifelink');
  });

  test('A Clone dies as the creature it copied', (mk, t) => {
    const T = mk();
    T.bf('B', 'Solemn Simulacrum');
    T.top('A', 'Island');
    const clone = T.put('A', 'Clone', 'battlefield', { etb: true });
    T.resolve();
    t.eq(clone.name, 'Solemn Simulacrum', 'a copy');
    const hand = T.zone('A', 'hand').length;
    T.g.moveObject(clone, 'graveyard');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'drew a card as it died');
  });

  test('Twincast copies a Bolt, and the copy can be pointed somewhere else', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.mana('B', 'R');
    T.cast('B', bolt, { targets: [bear], resolve: false });
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', 'UU');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.cast('A', T.hand('A', 'Twincast'), { targets: [T.stackTarget(bolt)] });
    t.ok(T.asked.some(c => c.type === 'pickTarget' && /copy/i.test(c.prompt || '')), 'asked about new targets');
    t.eq(T.life('B'), 17, 'the copy hit the other player');
    t.zone(bear, 'graveyard', 'the original still hit the Bears');
  });

  test('A bot turns a copied Bolt away from its own creature', (mk, t) => {
    const T = mk();
    T.player('A').isBot = true;
    const bear = T.bf('A', 'Grizzly Bears');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.mana('B', 'R');
    T.cast('B', bolt, { targets: [bear], resolve: false });
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Reverberate'), { targets: [T.stackTarget(bolt)] });
    const copied = T.g.log.some(l => /copy of Lightning Bolt now targets/i.test(l.text));
    t.ok(copied, 'the copy was turned');
  });

  test('Strionic Resonator copies a triggered ability', (mk, t) => {
    const T = mk();
    t.auto('Strionic Resonator');
    const res = T.bf('A', 'Strionic Resonator');
    T.put('A', 'Kitchen Finks', 'battlefield', { etb: true });
    T.g._putTriggersOnStack();
    const trig = T.g.stack.find(s => s.kind === 'ability');
    t.ok(trig && trig.triggered, 'the trigger is on the stack');
    T.mana('A', '2');
    T.activate('A', res, 0, { targets: [{ kind: 'stack', id: trig.id }] });
    t.eq(T.life('A'), 24, 'gained 2 twice');
  });

  test('Casting Clone asks what to copy, and copies that', (mk, t) => {
    const T = mk();
    T.bf('B', 'Craw Wurm');
    T.bf('A', 'Llanowar Elves');
    const clone = T.hand('A', 'Clone');
    T.mana('A', 'U3');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Llanowar Elves').id] }));
    T.cast('A', clone);
    t.ok(T.asked.some(c => c.purpose === 'cloneChoice'), 'asked');
    t.zone(clone, 'battlefield');
    t.eq(clone.name, 'Llanowar Elves', 'the smaller creature, because that was the choice');
  });

  test('Clone told to copy nothing enters as itself', (mk, t) => {
    const T = mk();
    T.bf('B', 'Craw Wurm');
    const clone = T.hand('A', 'Clone');
    T.mana('A', 'U3');
    T.answer('pickCard', { cardIds: [] });
    T.cast('A', clone);
    t.eq(clone.name, 'Clone');
    t.zone(clone, 'graveyard', 'a 0/0 dies');
  });

  test("Castle Garenbrig's mana pays for a creature's ability, not an artifact's", (mk, t) => {
    const T = mk();
    const castle = T.bf('A', 'Castle Garenbrig');
    const ooze = T.bf('A', 'Scavenging Ooze');
    const stone = T.bf('A', 'Mind Stone');
    const dead = T.grave('B', 'Grizzly Bears');
    T.mana('A', 'GG2');
    t.ok(T.g.tapForMana('A', castle.id, 1), 'six green, for creatures');
    t.no(T.g.activateAbility('A', stone.id, 1, { auto: true }), "Mind Stone's {1} cannot use it");
    T.activate('A', ooze, 0, { targets: [dead] });
    t.zone(dead, 'exile', 'the Ooze could');
  });

  test('Cascade casts a creature it finds, whatever the timing', (mk, t) => {
    const T = mk();
    const bear = T.top('A', 'Grizzly Bears');
    T.mana('A', 'RG2');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    t.zone(bear, 'battlefield');
  });

  test('Etali casts what it exiles from each library, for free', (mk, t) => {
    const T = mk();
    const etali = T.bf('A', 'Etali, Primal Storm');
    const bear = T.top('A', 'Grizzly Bears');
    T.top('B', 'Divination');
    const hand = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: etali.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.zone(bear, 'battlefield', 'the Bears were cast');
    t.eq(bear.controller, 'A');
    t.eq(T.zone('A', 'hand').length, hand + 2, 'the Divination was cast, by A');
  });

  test('An endless loop within one step ends the game in a draw', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 2100; i++) {
      T.g.stack.push({ id: 'loop' + i, kind: 'ability', obj: null, objId: null, controller: 'A', name: 'Loop',
        effects: [{ op: 'noop' }], auto: true, abilityText: '' });
    }
    for (let k = 0; k < 30 && !T.g.over; k++) T.resolve();
    t.ok(T.g.over, 'the game ended');
    t.eq(T.g.winners.length, 0, 'nobody won');
  });

  test('Station: charge counters from a tapped creature; a Spacecraft becomes a creature', (mk, t) => {
    const T = mk();
    t.auto('Wurmwall Sweeper');
    const ship = T.bf('A', 'Wurmwall Sweeper');
    const wurm = T.bf('A', 'Craw Wurm');
    t.no(T.g.characteristics(ship).isCreature, 'not yet');
    const i = ship.analysis().manaAbilities.length + ship.analysis().abilities.filter(x => x.kind === 'activated').findIndex(x => x.text === 'Station');
    T.activate('A', ship, i);
    t.ok(wurm.tapped, 'the Wurm crewed it');
    t.eq(ship.counters.charge, 6);
    t.ok(T.g.characteristics(ship).isCreature, 'a creature at 4+');
    t.ok(T.g.hasKw(ship, 'flying'), 'with flying');
  });

  test('Speed rises when an opponent loses life on your turn; max speed unlocks abilities', (mk, t) => {
    const T = mk();
    t.auto('Muraganda Raceway');
    const rw = T.put('A', 'Muraganda Raceway', 'battlefield', { etb: true });
    t.eq(T.player('A').speed, 1);
    t.no(T.g.tapForMana('A', rw.id, 1), 'not at speed 1');
    T.g.changeLife('B', -1); T.g.changeLife('B', -1);
    t.eq(T.player('A').speed, 2, 'once a turn');
    T.player('A').speed = 4;
    t.ok(T.g.tapForMana('A', rw.id, 1), 'max speed: two colourless');
    t.eq(T.player('A').pool.C, 2);
  });

  test('Springleaf Drum taps a creature for mana, summoning sick or not', (mk, t) => {
    const T = mk();
    t.auto('Springleaf Drum');
    const drum = T.bf('A', 'Springleaf Drum');
    t.no(T.g.tapForMana('A', drum.id, 0, 'G'), 'no creature, no mana');
    const bear = T.bf('A', 'Grizzly Bears', { sick: true });
    t.ok(T.g.tapForMana('A', drum.id, 0, 'G'), 'taps for mana');
    t.ok(bear.tapped, 'the Bears paid for it');
    t.ok(drum.tapped);
    t.eq(T.player('A').pool.G, 1);
  });

  test('Tapping creatures for a cost asks which, when there is a choice', (mk, t) => {
    const T = mk();
    t.auto('Glare of Subdual');
    const glare = T.bf('A', 'Glare of Subdual');
    const a1 = T.bf('A', 'Grizzly Bears'), a2 = T.bf('A', 'Craw Wurm');
    const foe = T.bf('B', 'Hill Giant');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Craw Wurm').id] }));
    T.activate('A', glare, 0, { targets: [foe] });
    t.ok(T.asked.some(c => c.purpose === 'tapCost'), 'asked');
    t.ok(a2.tapped, 'the one chosen');
    t.no(a1.tapped);
    t.ok(foe.tapped, 'the target tapped');
  });
};
