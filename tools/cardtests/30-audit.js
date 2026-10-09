/* Cards that were counted as automated and did something other than their
   words: each test plays the card against what it says, so the reading
   that went wrong cannot quietly come back. */
'use strict';
module.exports = (test) => {
  const optIds = (ch) => (ch.options || []).map(l => (l || []).map(o => o.id));

  /* ---- "target player" read into a scope, with nobody targeted ---- */

  test('Audit: Neutralize the Guards shrinks the target opponent\'s creatures, not yours', (mk, t) => {
    const T = mk();
    t.auto('Neutralize the Guards');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Neutralize the Guards'), { targets: ['B'] });
    t.eq(T.g.powerOf(theirs), 1, 'their creature shrank');
    t.eq(T.g.powerOf(mine), 2, 'yours did not');
    t.eq(JSON.stringify(T.g._legalTargetsFor({ type: 'player', opponent: true }, 'A').map(x => x.id)), '["B"]', 'never the caster');
  });

  test('Audit: Overwhelming Forces destroys only the chosen opponent\'s creatures', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Overwhelming Forces');
    const mine = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears'), c = T.bf('C', 'Grizzly Bears');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'BB6');
    T.cast('A', T.hand('A', 'Overwhelming Forces'), { targets: ['C'] });
    t.zone(c, 'graveyard');
    t.zone(b, 'battlefield');
    t.zone(mine, 'battlefield');
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'one card drawn, for the one creature destroyed');
  });

  test('Audit: Contagion Engine puts a -1/-1 counter on each creature the target player controls', (mk, t) => {
    const T = mk();
    t.auto('Contagion Engine');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '6');
    T.cast('A', T.hand('A', 'Contagion Engine'));
    t.eq(theirs.counters['-1/-1'] || 0, 1);
    t.eq(mine.counters['-1/-1'] || 0, 0);
  });

  test('Audit: Theft of Dreams counts the target opponent\'s tapped creatures', (mk, t) => {
    const T = mk();
    t.auto('Theft of Dreams');
    T.bf('A', 'Grizzly Bears', { tapped: true });
    T.bf('B', 'Grizzly Bears', { tapped: true }); T.bf('B', 'Llanowar Elves', { tapped: true }); T.bf('B', 'Craw Wurm');
    const s = T.hand('A', 'Theft of Dreams');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'U2');
    T.cast('A', s, { targets: ['B'] });
    t.eq(T.zone('A', 'hand').length, h0 - 1 + 2, 'two cards, for their two tapped creatures');
  });

  test('Audit: Vengeful Bloodwitch can only aim at an opponent', (mk, t) => {
    const T = mk();
    t.auto('Vengeful Bloodwitch');
    T.bf('A', 'Vengeful Bloodwitch');
    const bear = T.bf('A', 'Grizzly Bears');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'player', id: 'B' }] }; });
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.eq(JSON.stringify(offered), '["B"]', 'only the opponent was offered');
    t.eq(T.life('B'), 19);
    t.eq(T.life('A'), 21);
  });

  /* ---- hand attacks ---- */

  test('Audit: Coercion may take a land', (mk, t) => {
    const T = mk();
    t.auto('Coercion');
    const land = T.hand('B', 'Forest');
    T.answer('pickCard', () => ({ cardIds: [land.id] }));
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Coercion'), { targets: ['B'] });
    t.zone(land, 'graveyard');
  });

  test('Audit: Thought-Knot Seer lets you pick whose hand, with two opponents', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    t.auto('Thought-Knot Seer');
    const bolt = T.hand('C', 'Lightning Bolt');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'player', id: 'C' }] }; });
    T.answer('pickCard', () => ({ cardIds: [bolt.id] }));
    T.mana('A', 'C3');
    T.cast('A', T.hand('A', 'Thought-Knot Seer'));
    t.eq(JSON.stringify(offered), '["B","C"]', 'either opponent, never you');
    t.zone(bolt, 'exile');
  });

  /* ---- "up to one", "another" ---- */

  test('Audit: Teferi, Time Raveler\'s -3 can be used with nothing to return', (mk, t) => {
    const T = mk();
    t.auto('Teferi, Time Raveler');
    const tef = T.bf('A', 'Teferi, Time Raveler');
    const h0 = T.zone('A', 'hand').length;
    T.activate('A', tef, 1);
    t.eq(tef.counters.loyalty, 1);
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'still draws');
  });

  test('Audit: Flickerwisp never targets itself', (mk, t) => {
    const T = mk();
    t.auto('Flickerwisp');
    const bear = T.bf('B', 'Grizzly Bears');
    const fw = T.hand('A', 'Flickerwisp');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = optIds(ch)[0]; return { targets: [{ kind: 'object', id: bear.id }] }; });
    T.mana('A', 'WW1');
    T.cast('A', fw);
    t.eq(JSON.stringify(offered), JSON.stringify([bear.id]));
    t.zone(bear, 'exile');
    t.zone(fw, 'battlefield');
  });

  /* ---- words a loose damage subject swallowed ---- */

  test('Audit: Garna deals damage only when the creature was not attacking', (mk, t) => {
    const T = mk();
    t.auto('Garna, Bloodfist of Keld');
    T.bf('A', 'Garna, Bloodfist of Keld');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.eq(T.life('B'), 19, 'not attacking: 1 damage to each opponent');
    const h0 = T.zone('A', 'hand').length;
    const elf = T.bf('A', 'Llanowar Elves');
    T.answer('declareAttackers', () => [{ attackerId: elf.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [elf] });
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'attacking: a card');
    t.eq(T.life('B'), 19, 'and no damage');
  });

  test('Audit: Rakdos Charm\'s third mode hurts each player for each creature they control', (mk, t) => {
    const T = mk();
    t.auto('Rakdos Charm');
    T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Llanowar Elves'); T.bf('B', 'Craw Wurm');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Each creature/i.test(o.label)).i] }));
    T.mana('A', 'BR');
    T.cast('A', T.hand('A', 'Rakdos Charm'));
    t.eq(T.life('A'), 19);
    t.eq(T.life('B'), 17);
  });

  test('Audit: Suffocating Blast counters the spell and deals 3 damage', (mk, t) => {
    const T = mk();
    t.auto('Suffocating Blast');
    const wurm = T.bf('B', 'Craw Wurm');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', bolt, { targets: ['A'], resolve: false });
    T.mana('A', 'UUR1');
    T.g.passPriority('B', true);
    T.cast('A', T.hand('A', 'Suffocating Blast'), { targets: [T.stackTarget(bolt), wurm] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('A'), 20, 'the Bolt was countered');
    t.eq(wurm.damage || 0, 3);
  });

  test('Audit: Klothys gains life and deals damage for a nonland card, mana for a land', (mk, t) => {
    const T = mk();
    t.auto('Klothys, God of Destiny');
    T.bf('A', 'Klothys, God of Destiny');
    const bolt = T.grave('B', 'Lightning Bolt');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bolt.id }] }));
    T.toMain('A', 'main');
    T.nextTurn('A');
    t.zone(bolt, 'exile');
    t.eq(T.life('A'), 22);
    t.eq(T.life('B'), 18);
  });

  test('Audit: Slaying Fire deals 4 with three red mana spent, 3 without', (mk, t) => {
    const T = mk();
    t.auto('Slaying Fire');
    T.mana('A', 'RRR');
    T.cast('A', T.hand('A', 'Slaying Fire'), { targets: ['B'] });
    t.eq(T.life('B'), 16);
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Slaying Fire'), { targets: ['B'] });
    t.eq(T.life('B'), 13);
  });

  test('Audit: Whispering Snitch triggers only on the first surveil each turn', (mk, t) => {
    const T = mk();
    t.auto('Whispering Snitch');
    T.bf('A', 'Whispering Snitch');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Consider'));
    t.eq(T.life('B'), 19);
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Consider'));
    t.eq(T.life('B'), 19, 'the second surveil does nothing');
  });

  /* ---- a no-op rule standing in front of the real one ---- */

  test("Audit: Savage Ventmaw's mana lasts until the end of the turn", (mk, t) => {
    const T = mk();
    t.auto('Savage Ventmaw');
    const sv = T.bf('A', 'Savage Ventmaw');
    T.answer('declareAttackers', () => [{ attackerId: sv.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    const pool = T.player('A').pool;
    t.eq((pool.R || 0) + (pool.G || 0), 6, 'still there in the end step');
  });

  test('Audit: Brutal Expulsion can return a creature, not only a spell', (mk, t) => {
    const T = mk();
    t.auto('Brutal Expulsion');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Return/i.test(o.label)).i] }));
    T.mana('A', 'UR2');
    T.cast('A', T.hand('A', 'Brutal Expulsion'), { targets: [bear] });
    t.zone(bear, 'hand');
  });
};
