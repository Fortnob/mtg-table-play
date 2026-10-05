/* More single rules: control that comes back, multi-target spells, searches
   with a size limit. */
'use strict';
module.exports = (test) => {
  test('Threaten gives the creature back as the turn ends', (mk, t) => {
    const T = mk();
    const wurm = T.bf('B', 'Craw Wurm');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Threaten'), { targets: [wurm] });
    t.eq(wurm.controller, 'A');
    T.nextTurn('B');
    t.eq(wurm.controller, 'B', 'back to its owner');
  });

  test('Decimate destroys one of each', (mk, t) => {
    const T = mk();
    const a = T.bf('B', 'Sol Ring'), c = T.bf('B', 'Grizzly Bears'), e = T.bf('B', 'Glorious Anthem'), l = T.bf('B', 'Forest');
    T.mana('A', 'RG2');
    T.cast('A', T.hand('A', 'Decimate'), { targets: [a, c, e, l] });
    for (const o of [a, c, e, l]) t.zone(o, 'graveyard');
  });

  test('Recruiter of the Guard finds only a small creature', (mk, t) => {
    const T = mk();
    const big = T.top('A', 'Craw Wurm');
    const small = T.top('A', 'Llanowar Elves');
    T.put('A', 'Recruiter of the Guard', 'battlefield', { etb: true });
    T.resolve();
    t.zone(small, 'hand');
    t.zone(big, 'library');
  });

  test('Kogla fights a creature as it enters', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.put('A', 'Kogla, the Titan Ape', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bear, 'graveyard');
  });

  test('Fumigate gains a life per creature destroyed', (mk, t) => {
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears'); T.bf('B', 'Craw Wurm');
    T.mana('A', 'WW3');
    T.cast('A', T.hand('A', 'Fumigate'));
    t.eq(T.life('A'), 23);
  });

  test('Exploring asks once and puts one counter on', (mk, t) => {
    const T = mk();
    T.top('A', 'Grizzly Bears'); T.top('A', 'Craw Wurm');
    T.answer('confirm', { yes: false }); T.answer('confirm', { yes: false });
    const scout = T.put('A', 'Jadelight Ranger', 'battlefield', { etb: true });
    T.resolve();
    t.eq(scout.counters['+1/+1'], 2, 'two explores, one counter each');
  });

  test('A Map makes the chosen creature explore', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.top('A', 'Lightning Bolt');
    T.g._createNamedToken('A', { token: 'Map', n: 1 });
    const map = T.bfOf('A').find(o => o.name === 'Map');
    T.mana('A', '1');
    T.activate('A', map, 0, { targets: [bear] });
    t.eq(bear.counters['+1/+1'], 1);
  });

  test('Riveteers Overlook: sacrificed, a land fetched, one life', (mk, t) => {
    const T = mk();
    T.top('A', 'Swamp');
    const ov = T.put('A', 'Riveteers Overlook', 'battlefield', { etb: true });
    T.resolve();
    t.zone(ov, 'graveyard');
    t.ok(T.bfOf('A').some(o => o.name === 'Swamp'), 'Swamp fetched');
    t.eq(T.life('A'), 21);
  });

  test('Enduring Vitality comes back once, as an enchantment', (mk, t) => {
    const T = mk();
    const ev = T.bf('A', 'Enduring Vitality');
    T.g.moveObject(ev, 'graveyard');
    T.resolve();
    t.zone(ev, 'battlefield');
    t.no(T.g.characteristics(ev).isCreature, 'not a creature now');
    t.ok(ev.analysis().isEnchantment, 'an enchantment');
    T.g.moveObject(ev, 'graveyard');
    T.resolve();
    t.zone(ev, 'graveyard', 'the second time it stays');
    t.ok(ev.analysis().isCreature, 'a creature card again in the graveyard');
  });

  test('Relentless Assault: another combat and main phase after this one', (mk, t) => {
    const T = mk();
    const seen = [];
    T.g.on('step:begin', (phase, step) => { if (step === 'beginCombat' || step === 'main' || step === 'end') seen.push(phase + ':' + step); });
    T.mana('A', 'RR2');
    T.cast('A', T.hand('A', 'Relentless Assault'));
    T.nextTurn('B');
    const before = seen.slice(0, seen.indexOf('ending:end'));
    t.eq(before.join(' '), 'combat:beginCombat postcombat:main combat:beginCombat postcombat:main');
  });

  test('Hangarback Walker leaves a Thopter per counter; Goldvein Hydra Treasures per power', (mk, t) => {
    const T = mk();
    const hw = T.bf('A', 'Hangarback Walker', { counters: { '+1/+1': 3 } });
    T.g.moveObject(hw, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Thopter').length, 3);
    const gh = T.bf('A', 'Goldvein Hydra', { counters: { '+1/+1': 4 } });
    T.g.moveObject(gh, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 4);
  });

  test('Persist returns a creature with a -1/-1 counter', (mk, t) => {
    const T = mk();
    const wurm = T.grave('A', 'Craw Wurm');
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Persist'), { targets: [wurm] });
    t.zone(wurm, 'battlefield');
    t.eq(T.g.powerOf(wurm), 5);
  });

  test('Rites of Flourishing gives both players an extra land', (mk, t) => {
    const T = mk();
    T.bf('B', 'Rites of Flourishing');
    t.eq(T.g.landAllowance(T.player('A')), 2);
    t.eq(T.g.landAllowance(T.player('B')), 2);
  });

  test('Nexus of Fate goes back into the library, and Blightsteel too', (mk, t) => {
    const T = mk();
    const nx = T.hand('A', 'Nexus of Fate');
    T.mana('A', 'UU5');
    T.cast('A', nx);
    t.zone(nx, 'library');
    const bs = T.bf('A', 'Blightsteel Colossus');
    T.g.moveObject(bs, 'graveyard');
    t.zone(bs, 'library');
    const dc = T.hand('A', 'Darksteel Colossus');
    T.g.moveObject(dc, 'graveyard');
    t.zone(dc, 'library', 'from the hand as well');
  });

  test('Infectious Inquiry gives each opponent a poison counter', (mk, t) => {
    const T = mk();
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Infectious Inquiry'));
    t.eq(T.player('B').poison, 1);
  });

  test('Coiling Oracle: a land to the battlefield, anything else to the hand', (mk, t) => {
    const T = mk();
    const land = T.top('A', 'Forest');
    T.put('A', 'Coiling Oracle', 'battlefield', { etb: true });
    T.resolve();
    t.zone(land, 'battlefield');
    const bolt = T.top('A', 'Lightning Bolt');
    T.put('A', 'Coiling Oracle', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bolt, 'hand');
  });

  test('Risen Reef: declining the land puts it into the hand', (mk, t) => {
    const T = mk();
    const land = T.top('A', 'Forest');
    T.answer('confirm', { yes: false });
    T.put('A', 'Risen Reef', 'battlefield', { etb: true });
    T.resolve();
    t.zone(land, 'hand');
  });

  test('Pawn of Ulamog makes a Spawn that sacrifices for mana', (mk, t) => {
    const T = mk();
    T.bf('A', 'Pawn of Ulamog');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    const spawn = T.bfOf('A').find(o => o.name === 'Eldrazi Spawn');
    t.ok(spawn, 'a Spawn');
    T.g.tapForMana('A', spawn.id, 0);
    t.eq(T.player('A').pool.C, 1);
    t.zone(spawn, 'graveyard');
  });

  test('Unwinding Clock untaps artifacts on the other turn, not creatures', (mk, t) => {
    const T = mk();
    T.bf('A', 'Unwinding Clock');
    const ring = T.bf('A', 'Sol Ring', { tapped: true });
    const bear = T.bf('A', 'Grizzly Bears', { tapped: true });
    T.nextTurn('B');
    t.no(ring.tapped, 'artifact untapped');
    t.ok(bear.tapped, 'creature still tapped');
  });

  test('Laboratory Maniac wins instead of losing to an empty library', (mk, t) => {
    const T = mk();
    T.bf('A', 'Laboratory Maniac');
    T.g.zones.A.library.length = 0;
    T.g.drawCards('A', 1);
    t.ok(T.player('B').hasLost, 'opponent lost');
    t.no(T.player('A').hasLost, 'Maniac player still in');
  });

  test('Overwhelming Stampede: +X/+X by the greatest power, and trample', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Craw Wurm');
    T.mana('A', 'GG3');
    T.cast('A', T.hand('A', 'Overwhelming Stampede'));
    t.eq(T.g.powerOf(bear), 8);
    t.ok(T.g.hasKw(bear, 'trample'));
  });

  test('Bident of Thassa makes the opponents attack', (mk, t) => {
    const T = mk();
    const bident = T.bf('A', 'Bident of Thassa');
    const foe = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U1');
    T.activate('A', bident, 0);
    t.ok(T.g.mustAttack(foe));
  });
};
