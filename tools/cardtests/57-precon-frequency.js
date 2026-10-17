/* Behavior regressions for a high-frequency precon automation batch. */
'use strict';
module.exports = (test) => {
  test('Precon automation: Soul Snare exiles an attacker or your planeswalker, but no other creature', (mk, t) => {
    t.auto('Soul Snare');
    const T = mk();
    const g = T.g;
    const snare = T.bf('A', 'Soul Snare');
    const attacker = T.bf('B', 'Grizzly Bears');
    const unrelated = T.bf('B', 'Hill Giant');
    const walker = T.bf('A', 'Ajani Goldmane');
    attacker.attacking = 'A';
    const spec = snare.analysis().abilities.find(a => a.kind === 'activated').effects[0].targets[0];
    t.ok(g._legalTargetsFor(spec, 'A', snare.id).some(o => o.id === attacker.id), 'a creature attacking you is legal');
    t.no(g._legalTargetsFor(spec, 'A', snare.id).some(o => o.id === unrelated.id), 'a creature not attacking you is illegal');
    t.ok(g._legalTargetsFor(spec, 'A', snare.id).some(o => o.id === walker.id), 'your planeswalker is legal');
    T.mana('A', 'W');
    T.activate('A', snare, 0, { targets: [attacker] });
    t.zone(attacker, 'exile');
    t.zone(snare, 'graveyard', 'the enchantment is sacrificed as a cost');
  });

  test('Precon automation: Oreskos Explorer finds up to one Plains for each opponent ahead in lands', (mk, t) => {
    t.auto('Oreskos Explorer');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('A', 'Plains');
    T.bf('B', 'Plains'); T.bf('B', 'Island');
    T.bf('C', 'Forest');
    const plains = T.top('A', 'Plains');
    const mountain = T.top('A', 'Mountain');
    T.answer('pickCard', ch => ({ cardIds: ch.cards.filter(c => c.name === 'Plains').map(c => c.id) }));
    T.put('A', 'Oreskos Explorer', 'battlefield', { etb: true });
    T.resolve();
    t.zone(plains, 'hand', 'one opponent controls more lands, so one Plains is found');
    t.zone(mountain, 'library', 'the non-Plains card remains in the library');
  });

  test('Precon automation: Syphon Flesh makes one Zombie for each creature sacrificed by opponents', (mk, t) => {
    t.auto('Syphon Flesh');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const b = T.bf('B', 'Grizzly Bears');
    const c = T.bf('C', 'Hill Giant');
    const spell = T.hand('A', 'Syphon Flesh');
    T.answer('sacrifice', ch => ({ cardIds: [ch.candidates[0]] }));
    T.mana('A', '4B');
    T.cast('A', spell);
    t.zone(b, 'graveyard');
    t.zone(c, 'graveyard');
    const zombies = T.bfOf('A').filter(o => (o.analysis().subtypes || []).includes('Zombie'));
    t.eq(zombies.length, 2, 'one 2/2 Zombie per creature sacrificed');
    t.ok(zombies.every(o => T.g.powerOf(o) === 2 && T.g.toughnessOf(o) === 2 &&
      (o.analysis().colors || []).includes('B')), 'the tokens are black 2/2s');
  });

  test('Precon automation: Corpse Augur draws and loses life based on the chosen graveyard', (mk, t) => {
    t.auto('Corpse Augur');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.grave('B', 'Grizzly Bears');
    T.grave('B', 'Hill Giant');
    T.grave('B', 'Island');
    T.grave('C', 'Llanowar Elves');
    const augur = T.bf('A', 'Corpse Augur');
    const h0 = T.zone('A', 'hand').length;
    T.answer('pickTarget', ch => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.g.moveObject(augur, 'graveyard');
    T.g.checkStateBasedActions();
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'two creature cards in B’s graveyard are drawn');
    t.eq(T.life('A'), 18, 'two life is lost');
  });

  test("Precon automation: Bonder's Ornament draws only for players who control one", (mk, t) => {
    t.auto("Bonder's Ornament");
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const ornament = T.bf('A', "Bonder's Ornament");
    T.bf('B', "Bonder's Ornament");
    const a0 = T.zone('A', 'hand').length, b0 = T.zone('B', 'hand').length, c0 = T.zone('C', 'hand').length;
    T.mana('A', '4');
    T.activate('A', ornament, 1);
    t.eq(T.zone('A', 'hand').length, a0 + 1, 'the activating player draws');
    t.eq(T.zone('B', 'hand').length, b0 + 1, 'the other player with an Ornament draws');
    t.eq(T.zone('C', 'hand').length, c0, 'a player without an Ornament does not draw');
  });

  test('Precon automation: Voice of Many counts opponents with fewer creatures', (mk, t) => {
    t.auto('Voice of Many');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Hill Giant');
    T.bf('B', 'Llanowar Elves');
    T.bf('C', 'Grizzly Bears'); T.bf('C', 'Hill Giant'); T.bf('C', 'Llanowar Elves');
    const h0 = T.zone('A', 'hand').length;
    T.put('A', 'Voice of Many', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'only the opponent with fewer creatures counts');
  });

  test('Precon automation: Ancient Excavation draws then discards the starting hand size', (mk, t) => {
    t.auto('Ancient Excavation');
    const T = mk();
    T.toMain('A');
    const spell = T.hand('A', 'Ancient Excavation');
    T.hand('A', 'Island');
    T.hand('A', 'Forest');
    const handBeforeResolution = T.zone('A', 'hand').length - 1;
    T.mana('A', '2UB');
    T.cast('A', spell);
    t.eq(T.zone('A', 'hand').length, handBeforeResolution, 'draws and discards equal to the hand size during resolution');
    t.eq(T.zone('A', 'graveyard').filter(o => o.name !== 'Ancient Excavation').length, handBeforeResolution,
      'the drawn cards are discarded');
  });

  test('Precon automation: Death by Dragons creates one Dragon per target opponent creature', (mk, t) => {
    t.auto('Death by Dragons');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('B', 'Grizzly Bears');
    T.bf('B', 'Hill Giant');
    T.bf('B', 'Island');
    T.bf('C', 'Llanowar Elves');
    const spell = T.hand('A', 'Death by Dragons');
    T.mana('A', '4RR');
    T.cast('A', spell, { targets: ['B'] });
    const dragons = T.bfOf('A').filter(o => (o.analysis().subtypes || []).includes('Dragon'));
    t.eq(dragons.length, 2, 'counts only creatures controlled by the targeted opponent');
    t.ok(dragons.every(o => T.g.powerOf(o) === 5 && T.g.toughnessOf(o) === 5 &&
      (o.analysis().colors || []).includes('R') && T.g.hasKw(o, 'flying')), 'creates red 5/5 Dragons with flying');
  });

  test("Precon automation: Loreseeker's Stone draws only when its controller has no cards in hand", (mk, t) => {
    t.auto("Loreseeker's Stone");
    const T = mk();
    T.toMain('A');
    const stone = T.bf('A', "Loreseeker's Stone");
    T.hand('A', 'Island');
    T.mana('A', '3');
    t.no(T.g.activateAbility('A', stone.id, 0, { auto: true }), 'the ability cannot be activated with a card in hand');
    const held = T.zone('A', 'hand')[0];
    T.g.moveObject(held, 'graveyard');
    const h0 = T.zone('A', 'hand').length;
    T.activate('A', stone, 0);
    t.eq(T.zone('A', 'hand').length, h0 + 3, 'draws three cards once the hand is empty');
  });

  test('Precon automation: Diviner Spirit has both players draw its combat damage amount', (mk, t) => {
    t.auto('Diviner Spirit');
    const T = mk();
    const spirit = T.bf('A', 'Diviner Spirit');
    const a0 = T.zone('A', 'hand').length, b0 = T.zone('B', 'hand').length;
    T.g._fire('combatDamageToPlayer', 'A', { source: spirit, amount: 3, player: 'B' });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, a0 + 3, 'its controller draws three');
    t.eq(T.zone('B', 'hand').length, b0 + 3, 'the damaged player draws three');
  });
};
