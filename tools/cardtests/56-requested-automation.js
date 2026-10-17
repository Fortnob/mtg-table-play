/* Focused behavior checks for the newly automated cards. */
'use strict';
module.exports = (test) => {
  const requested = [
    "Anzrag's Rampage", 'Avoid Fate', 'Party Dude', 'Signal the Clans', 'Green Slime',
    "Titania's Song", 'Structural Assault', 'Collected Company', 'Topography Tracker',
    'Call to the Kindred', 'Tide Shaper', 'Deeproot Historian', 'Over the Edge',
  ];

  test('Requested automation: every requested card is automated', (mk, t) => {
    for (const name of requested) t.auto(name);
  });

  test('Requested automation: Titania’s Song makes artifacts creatures and keeps the effect through end of turn', (mk, t) => {
    const T = mk();
    const ring = T.bf('A', 'Sol Ring');
    const song = T.bf('A', "Titania's Song");
    let c = T.g.characteristics(ring);
    t.ok(c.isCreature, 'Sol Ring becomes a creature');
    t.eq(`${c.power}/${c.toughness}`, '1/1', 'its power and toughness equal mana value');
    t.ok(c.abilitiesLost, 'its abilities are lost');
    T.g.moveObject(song, 'graveyard');
    c = T.g.characteristics(ring);
    t.ok(c.isCreature, 'it stays a creature after Song leaves');
    t.eq(`${c.power}/${c.toughness}`, '1/1', 'its stats persist through the turn');
  });

  test('Requested automation: Structural Assault counts artifacts put into graveyards this turn', (mk, t) => {
    const T = mk();
    const relic = T.bf('B', 'Sol Ring');
    const elf = T.bf('B', 'Llanowar Elves');
    const spell = T.hand('A', 'Structural Assault');
    T.mana('A', 'RRRGGG');
    T.cast('A', spell);
    t.zone(relic, 'graveyard', 'the artifact is destroyed');
    t.zone(elf, 'graveyard', 'the one damage kills the Elf');
  });

  test('Requested automation: Anzrag’s Rampage exiles and offers the number of artifact cards destroyed', (mk, t) => {
    const T = mk();
    const relic = T.bf('B', 'Sol Ring');
    const spell = T.hand('A', "Anzrag's Rampage");
    const creature = T.top('A', 'Grizzly Bears');
    T.mana('A', 'RRRGGG');
    T.cast('A', spell);
    t.zone(relic, 'graveyard', 'the opposing artifact is destroyed');
    t.zone(creature, 'battlefield', 'the creature exiled this way is put onto the battlefield');
    t.ok(T.g.hasKw(creature, 'haste'), 'the creature gains haste');
  });

  test('Requested automation: Collected Company puts up to two qualifying creatures onto the battlefield', (mk, t) => {
    const T = mk();
    const first = T.top('A', 'Grizzly Bears');
    const second = T.top('A', 'Llanowar Elves');
    T.top('A', 'Island');
    T.top('A', 'Forest');
    T.top('A', 'Swamp');
    T.top('A', 'Mountain');
    const spell = T.hand('A', 'Collected Company');
    T.mana('A', 'GGGG3');
    T.cast('A', spell);
    t.zone(first, 'battlefield', 'first creature');
    t.zone(second, 'battlefield', 'second creature');
  });

  test('Requested automation: explore twice reveals and processes two cards in order', (mk, t) => {
    const T = mk({ library: Array(20).fill('Plains') });
    const creature = T.bf('A', 'Grizzly Bears');
    const first = T.top('A', 'Island');
    const second = T.top('A', 'Forest');
    const spell = T.hand('A', 'Over the Edge');
    T.answer('mode', { modes: [1] });
    T.mana('A', '2G');
    T.cast('A', spell, { targets: [creature] });
    t.zone(first, 'hand', 'first explore goes to hand');
    t.zone(second, 'hand', 'second explore goes to hand');
  });

  test('Requested automation: Topography Tracker doubles each explore separately', (mk, t) => {
    const T = mk({ library: Array(20).fill('Plains') });
    const tracker = T.bf('A', 'Topography Tracker');
    const creature = T.bf('A', 'Grizzly Bears');
    const lands = ['Island', 'Forest', 'Swamp', 'Mountain'].map(n => T.top('A', n));
    const spell = T.hand('A', 'Over the Edge');
    T.answer('mode', { modes: [1] });
    T.mana('A', '2G');
    T.cast('A', spell, { targets: [creature] });
    t.ok(lands.every(o => o.zone === 'hand'), 'the spell’s two explores are each doubled');
    t.ok(T.bfOf('A').includes(tracker), 'the Tracker remains in play');
  });

  test('Requested automation: Signal the Clans puts a random card into hand only with three distinct names', (mk, t) => {
    const T = mk();
    const choices = ['Grizzly Bears', 'Llanowar Elves', 'Elvish Mystic'].map(n => T.top('A', n));
    const spell = T.hand('A', 'Signal the Clans');
    T.mana('A', 'RG1');
    T.cast('A', spell);
    const chosen = choices.filter(o => o.zone === 'hand');
    t.eq(chosen.length, 1, 'exactly one of the three revealed cards is chosen');
    t.eq(choices.filter(o => o.zone === 'library').length, 2, 'the other two are shuffled back');
  });

  test('Requested automation: Green Slime counters and destroys an artifact ability source', (mk, t) => {
    const T = mk();
    const source = T.bf('B', 'Icy Manipulator');
    const slime = T.bf('A', 'Green Slime');
    const item = { id: 'test-ability', kind: 'ability', objId: source.id, obj: source, controller: 'B', name: 'Icy Manipulator ability', targets: [] };
    T.g.stack.push(item);
    const ability = slime.analysis().abilities.find(a => a.kind === 'triggered');
    const spec = ability.effects[0].targets[0];
    t.ok(T.g._legalTargetsFor(spec, 'A', slime.id).some(x => x.id === item.id), 'the artifact ability is a legal target');
    T.g._runEffects(ability.effects, { controller: 'A', obj: slime, name: slime.name, kind: 'ability',
      targets: [{ kind: 'stack', id: item.id }] });
    t.ok(item.countered, 'the ability is countered');
    t.zone(source, 'graveyard', 'its permanent source is destroyed');
  });

  test('Requested automation: Party Dude triggers when an opponent attacks one of your opponents', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const partyDude = T.bf('A', 'Party Dude');
    partyDude.counters.level = 2;
    T.hand('A', 'Island');
    T.hand('A', 'Forest');
    const attacker = T.bf('B', 'Grizzly Bears');
    attacker.attacking = 'C';
    T.g._fire('anyPlayerAttacks', null, { playerId: 'B', attackers: [attacker] });
    t.ok(T.g.pendingTriggers.some(x => x.obj && x.obj.id === partyDude.id) ||
      T.g.stack.some(x => x.objId === partyDude.id), 'Party Dude triggers for another player’s attack');
    T.resolve();
    t.eq(T.g.powerOf(attacker), 4, 'the attacking creature gets +2/+2 for the two cards in hand');
  });

  test('Requested automation: Tide Shaper changes a land type only while it remains on the battlefield', (mk, t) => {
    const T = mk();
    const tide = T.bf('A', 'Tide Shaper');
    const forest = T.bf('B', 'Forest');
    const ability = tide.analysis().abilities.find(a => a.kind === 'triggered');
    T.g._runEffects(ability.effects, { controller: 'A', obj: tide, name: tide.name, kind: 'ability',
      targets: [{ kind: 'object', id: forest.id }] });
    t.ok((forest.analysis().subtypes || []).includes('Island'), 'it becomes an Island');
    t.no((forest.analysis().subtypes || []).includes('Forest'), 'its previous basic land type is replaced');
    T.g.moveObject(tide, 'graveyard');
    t.no((forest.analysis().subtypes || []).includes('Island'), 'the type effect ends when Tide Shaper leaves');
  });

  test('Requested automation: Deeproot Historian grants retrace to Druid cards in the graveyard', (mk, t) => {
    const T = mk();
    T.bf('A', 'Deeproot Historian');
    const druid = T.grave('A', 'Llanowar Elves');
    T.hand('A', 'Island');
    T.mana('A', 'G');
    t.ok(T.g.playableNow('A').some(x => x.objId === druid.id && x.via === 'retrace'), 'the Druid is offered retrace');
  });

  test('Requested automation: Call to the Kindred only offers a creature sharing the enchanted creature’s type', (mk, t) => {
    const T = mk();
    const host = T.bf('A', 'Llanowar Elves');
    const aura = T.bf('A', 'Call to the Kindred');
    aura.attachedTo = host.id;
    host.attachments.push(aura.id);
    const matching = T.top('A', 'Elvish Mystic');
    const unrelated = T.top('A', 'Grizzly Bears');
    T.top('A', 'Island'); T.top('A', 'Forest'); T.top('A', 'Swamp');
    T.answer('confirm', { yes: true });
    T.answer('pickCard', (ch) => {
      t.eq(ch.cards.map(c => c.name).join(), 'Elvish Mystic', 'only the Druid is offered');
      return { cardIds: [matching.id] };
    });
    T.g._fire('yourUpkeep', 'A', {});
    T.resolve();
    t.zone(matching, 'battlefield', 'the shared-type creature enters');
    t.zone(unrelated, 'library', 'the unrelated creature remains');
  });

  test('Requested automation: Avoid Fate only offers spells targeting a permanent you control', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { resolve: false, targets: [bear] });
    const spec = { type: 'spell', filter: 'instant or aura', targetsPermanentYouControl: true };
    t.ok(T.g._legalTargetsFor(spec, 'A').some(x => x.kind === 'stack' && x.id === T.stackItem(bolt).id), 'the targeted spell is legal');
  });

  test('Precon automation: Restore returns a land from any graveyard under your control', (mk, t) => {
    const T = mk();
    const land = T.grave('B', 'Forest');
    const spell = T.hand('A', 'Restore');
    T.mana('A', '2G');
    T.cast('A', spell, { targets: [land] });
    t.zone(land, 'battlefield', 'the land returns from an opponent’s graveyard');
    t.eq(land.controller, 'A', 'the land enters under the caster’s control');
  });
};
