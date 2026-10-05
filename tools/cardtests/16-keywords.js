/* Keywords that are abilities of their own: crew, saddle, echo, bushido,
   living weapon, soulshift, outlast, fading, vanishing, renown, flanking,
   wither. */
'use strict';
module.exports = (test) => {
  test('Crew: creatures with enough power make the Vehicle a creature', (mk, t) => {
    const T = mk();
    t.auto('Smuggler\'s Copter');
    const copter = T.bf('A', "Smuggler's Copter");
    t.no(T.g.characteristics(copter).isCreature);
    t.no(T.g.activateAbility('A', copter.id, 0, { auto: true }), 'nothing to crew with');
    const bear = T.bf('A', 'Grizzly Bears', { sick: true });
    T.activate('A', copter, 0);
    t.ok(bear.tapped, 'the Bears crewed it, summoning sick or not');
    t.ok(T.g.characteristics(copter).isCreature, 'a creature now');
    T.nextTurn('B');
    t.no(T.g.characteristics(copter).isCreature, 'only until end of turn');
  });

  test('Echo: pay again next upkeep, or it is sacrificed', (mk, t) => {
    const T = mk();
    const mwm = T.put('A', 'Mogg War Marshal', 'battlefield', { etb: true });
    T.resolve();
    T.nextTurn('B');
    T.nextTurn('A');
    t.zone(mwm, 'graveyard', 'no mana for echo: sacrificed');
  });

  test('Bushido pumps a creature that blocks', (mk, t) => {
    const T = mk();
    const ja = T.bf('B', 'Jade Avenger');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: ja.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(bear, 'graveyard', 'the 4/4 Avenger killed the Bears');
    t.zone(ja, 'battlefield');
  });

  test('Living weapon: a Germ to carry it', (mk, t) => {
    const T = mk();
    const bs = T.put('A', 'Batterskull', 'battlefield', { etb: true });
    T.resolve();
    const germ = T.bfOf('A').find(o => o.name === 'Phyrexian Germ');
    t.ok(germ, 'a Germ');
    t.eq(bs.attachedTo, germ.id, 'carrying the Batterskull');
    t.eq(T.g.powerOf(germ), 4);
  });

  test('Soulshift returns a smaller Spirit when it dies', (mk, t) => {
    const T = mk();
    const tk = T.bf('A', 'Thief of Hope');
    const sp = T.grave('A', 'Kami of Ancient Law');
    T.g.moveObject(tk, 'graveyard');
    T.resolve();
    t.zone(sp, 'hand');
  });

  test('Fading: a counter off each upkeep, then gone', (mk, t) => {
    const T = mk();
    const jm = T.put('A', 'Jolting Merfolk', 'battlefield', { etb: true });
    const n = jm.counters.fade;
    t.ok(n > 0, 'enters with fade counters');
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(jm.counters.fade, n - 1);
  });

  test('Flanking shrinks a blocker without it', (mk, t) => {
    const T = mk();
    const bc = T.bf('A', 'Benalish Cavalry');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bc.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: bear.id, attackerIds: [bc.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(bear, 'graveyard', 'a 1/1 blocker against a 2/2');
    t.zone(bc, 'battlefield', 'the shrunken Bears dealt only 1');
  });

  test('Wither and infect deal damage to creatures as -1/-1 counters', (mk, t) => {
    const T = mk();
    const w = T.bf('B', 'Craw Wurm');
    const src = T.bf('A', 'Necroskitter');
    T.g.dealDamageToObject(w, 2, src);
    t.eq(w.counters['-1/-1'], 2);
    t.eq(w.damage, 0);
  });

  test('Renown: counters the first time it connects', (mk, t) => {
    const T = mk();
    const k = T.bf('A', "Kytheon's Irregulars");
    T.answer('declareAttackers', () => [{ attackerId: k.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(k.counters['+1/+1'], 1);
    t.ok(k.renowned);
  });

  test('Ninjutsu swaps an unblocked attacker for the Ninja', (mk, t) => {
    const T = mk();
    t.auto('Ninja of the Deep Hours');
    const bear = T.bf('A', 'Grizzly Bears');
    const ninja = T.hand('A', 'Ninja of the Deep Hours');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok(T.g.altUsesFor('A', ninja.id).some(u => u.via === 'ninjutsu'), 'offered');
    T.mana('A', 'U1');
    t.ok(T.g.castSpell('A', ninja.id, { via: 'ninjutsu', auto: true }));
    T.resolve();
    t.zone(bear, 'hand', 'the Bears went home');
    t.zone(ninja, 'battlefield');
    t.ok(ninja.tapped && ninja.attacking === 'B', 'tapped and attacking');
    const h0 = T.zone('A', 'hand').length;
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 18, 'the Ninja hit');
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'and drew a card');
  });

  test('Daybound turns over at night and back by day', (mk, t) => {
    const T = mk();
    const kn = T.put('A', 'Kessig Naturalist', 'battlefield', { etb: true });
    t.eq(T.g.isDay, true, 'it became day');
    T.g.setDayNight(false);
    t.eq(kn.face, 1, 'night side');
    T.g.setDayNight(true);
    t.eq(kn.face, 0, 'day side again');
  });

  test('Impending: not a creature while it has time counters', (mk, t) => {
    const T = mk();
    t.auto('Overlord of the Hauntwoods');
    const ov = T.hand('A', 'Overlord of the Hauntwoods');
    T.mana('A', 'GG1');
    T.cast('A', ov, { via: 'impending' });
    t.zone(ov, 'battlefield');
    t.eq(ov.counters.time, 4);
    t.no(T.g.characteristics(ov).isCreature, 'not a creature yet');
    const ew = T.bfOf('A').find(o => o.name === 'Everywhere');
    t.ok(ew && ew.tapped, 'an Everywhere token');
    t.ok(T.g.manaAbilitiesOf(ew).length >= 5, 'it taps for every colour');
    T.toMain('A', 'end'); T.resolve();
    t.eq(ov.counters.time, 3, 'a counter off at the end step');
  });

  test('Prototype: the smaller body for the smaller price', (mk, t) => {
    const T = mk();
    const pf = T.hand('A', 'Phyrexian Fleshgorger');
    T.mana('A', 'BB1');
    T.cast('A', pf, { via: 'prototype' });
    t.eq(T.g.powerOf(pf), 3);
    T.g.moveObject(pf, 'hand');
    t.eq(pf.analysis().power, '7', 'the full card again in the hand');
  });

  test('Dredge replaces the draw-step draw when chosen', (mk, t) => {
    const T = mk();
    const gt = T.grave('A', 'Golgari Thug');
    const lib = T.zone('A', 'library').length;
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Dredge/.test(o.label)).i] }));
    T.nextTurn('B'); T.nextTurn('A');
    t.zone(gt, 'hand');
    t.eq(T.zone('A', 'library').length, lib - 4, 'milled four instead of drawing');
  });

  test('Unleash: with the counter it cannot block', (mk, t) => {
    const T = mk();
    T.answer('confirm', { yes: true });
    const rc = T.put('A', 'Rakdos Cackler', 'battlefield', { etb: true });
    t.eq(rc.counters['+1/+1'], 1);
    t.ok(T.g._hasFlag(rc, 'cantBlock'));
  });

  test('Ingest exiles the top card of the player it hits', (mk, t) => {
    const T = mk();
    const bi = T.bf('A', 'Benthic Infiltrator');
    const top = T.zone('B', 'library')[0];
    T.answer('declareAttackers', () => [{ attackerId: bi.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.zone(top, 'exile');
  });

  test('Gleaming Splendor: two target players each draw', (mk, t) => {
    const T = mk();
    const gs = T.bf('A', 'Gleaming Splendor');
    const a0 = T.zone('A', 'hand').length, b0 = T.zone('B', 'hand').length;
    T.mana('A', 'W2');
    T.activate('A', gs, 0, { targets: ['A', 'B'] });
    t.eq(T.zone('A', 'hand').length, a0 + 1, 'A drew');
    t.eq(T.zone('B', 'hand').length, b0 + 1, 'B drew');
  });

  test('Chart a Course: discards unless you attacked this turn', (mk, t) => {
    const T = mk();
    T.hand('A', 'Island');
    const n0 = T.zone('A', 'hand').length;
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Chart a Course'));
    t.eq(T.zone('A', 'hand').length, n0 + 1, 'drew two, discarded one');
  });

  test('Lathril: Elf Warriors equal to the combat damage', (mk, t) => {
    const T = mk();
    const l = T.bf('A', 'Lathril, Blade of the Elves');
    l.entered = -1;
    T.answer('declareAttackers', () => [{ attackerId: l.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.bfOf('A').filter(o => o.isToken && /Elf Warrior/.test(o.name)).length, 2, 'two Elf Warriors');
  });

  test('Threefold Thunderhulk: Gnomes equal to its power on entering', (mk, t) => {
    const T = mk();
    T.mana('A', 'CCCCCCC');
    T.cast('A', T.hand('A', 'Threefold Thunderhulk'));
    t.eq(T.bfOf('A').filter(o => o.isToken && /Gnome/.test(o.name)).length, 3, 'three Gnomes (a 0/0 with three counters)');
  });

  test('Kitsa: the copy ability waits for power 3', (mk, t) => {
    const T = mk();
    const k = T.bf('A', 'Kitsa, Otterball Elite');
    k.entered = -1;
    T.mana('A', 'C2');
    t.no(T.g.activateAbility('A', k.id, 2, { auto: true }), 'power 1: not yet');
  });
};
