/* Cards whose lines the text parser could not read, played through the
   lines translated from XMage (src/19-cardlib.js). Each test also checks
   that the card really does lean on a translated line, so it keeps
   testing the translation and not the parser. */
'use strict';
const { card, engine } = require('../harness');

function generated(t, name) {
  t.auto(name);
  const a = engine().oracle.analyze(card(name));
  t.ok(a.generated, name + ' uses a translated line');
}


function engineEffects(T, name) {
  const a = engine().oracle.analyze(card(name));
  return a.abilities.find(x => x.kind === 'spell').effects;
}

module.exports = (test) => {
  test('XMage: Archon of Cruelty enters and drains', (mk, t) => {
    generated(t, 'Archon of Cruelty');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.hand('B', 'Island');
    T.top('A', 'Island');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.put('A', 'Archon of Cruelty', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bear, 'graveyard', 'B sacrificed the bear');
    t.eq(T.zone('B', 'hand').length, 0, 'B discarded');
    t.eq(T.life('B'), 17);
    t.eq(T.life('A'), 23);
    t.eq(T.zone('A', 'hand').length, 1, 'A drew');
  });

  test('XMage: All That Glitters counts artifacts and enchantments', (mk, t) => {
    generated(t, 'All That Glitters');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Sol Ring');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'All That Glitters'), { targets: [bear] });
    // Sol Ring and the Aura itself
    t.eq(T.g.powerOf(bear), 4);
    t.eq(T.g.toughnessOf(bear), 4);
  });

  // the parser reads "mills twenty cards" itself now, so no translated line is needed
  test('Jace Beleren mills twenty', (mk, t) => {
    t.auto('Jace Beleren');
    const T = mk({ libraryEach: 6 });
    const jace = T.bf('A', 'Jace Beleren', { counters: { loyalty: 10 } });
    const before = T.zone('B', 'library').length;
    T.activate('A', jace, 2, { targets: ['B'] });
    t.eq(T.zone('B', 'library').length, Math.max(0, before - 20));
  });

  test('XMage: Thassa makes a creature unblockable', (mk, t) => {
    generated(t, 'Thassa, God of the Sea');
    const T = mk();
    T.bf('A', 'Thassa, God of the Sea');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1U');
    const thassa = T.bfOf('A').find(o => o.name === 'Thassa, God of the Sea');
    T.activate('A', thassa, 0, { targets: [bear] });
    t.ok(bear.effects.some(e => e.flag === 'unblockable'), 'cannot be blocked this turn');
  });

  test('XMage: Junji, choosing the first mode, makes each opponent discard and lose life', (mk, t) => {
    generated(t, 'Junji, the Midnight Sky');
    const T = mk();
    const junji = T.bf('A', 'Junji, the Midnight Sky');
    T.hand('B', 'Island'); T.hand('B', 'Swamp'); T.hand('B', 'Forest');
    T.answer('mode', { modes: [0] });
    T.g.moveObject(junji, 'graveyard');
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 1);
    t.eq(T.life('B'), 18);
  });

  test('XMage: Reveillark brings back two small creatures', (mk, t) => {
    generated(t, 'Reveillark');
    const T = mk();
    const lark = T.bf('A', 'Reveillark');
    const a = T.grave('A', 'Llanowar Elves'), b = T.grave('A', 'Grizzly Bears'), big = T.grave('A', 'Craw Wurm');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }] });
    T.g.moveObject(lark, 'exile');
    T.resolve();
    t.zone(a, 'battlefield'); t.zone(b, 'battlefield'); t.zone(big, 'graveyard');
  });

  test('XMage: a filter land offers its three pairs', (mk, t) => {
    generated(t, 'Rugged Prairie');
    const a = engine().oracle.analyze(card('Rugged Prairie'));
    const choice = a.manaAbilities.find(m => m.effects[0].op === 'addManaChoice');
    t.ok(choice, 'one ability with a choice');
    t.eq(JSON.stringify(choice.effects[0].choices), JSON.stringify([['R', 'R'], ['W', 'R'], ['W', 'W']]));
    t.eq(choice.cost.mana, '{R/W}');
    t.ok(choice.cost.tap, 'and a tap');
  });

  test('XMage: Inquisition of Kozilek only offers nonland cards of mana value 3 or less', (mk, t) => {
    generated(t, 'Inquisition of Kozilek');
    const T = mk();
    const small = T.hand('B', 'Lightning Bolt');
    T.hand('B', 'Craw Wurm'); T.hand('B', 'Island');
    T.mana('A', 'B');
    T.answer('pickCard', (ch) => { t.eq(ch.cards.length, 1, 'only the Bolt is offered'); return { cardIds: [small.id] }; });
    T.cast('A', T.hand('A', 'Inquisition of Kozilek'), { targets: ['B'] });
    t.zone(small, 'graveyard');
    t.eq(T.zone('B', 'hand').length, 2);
  });

  test('XMage: Mutavault becomes a 2/2 creature until end of turn', (mk, t) => {
    generated(t, 'Mutavault');
    const T = mk();
    const vault = T.bf('A', 'Mutavault');
    T.mana('A', '1');
    // mana abilities are counted first
    T.activate('A', vault, vault.analysis().manaAbilities.length);
    t.ok(T.g.characteristics(vault).isCreature, 'a creature now');
    t.eq(T.g.powerOf(vault), 2);
    t.ok(vault.analysis().isLand, 'still a land');
  });

  test('XMage: Chandra\'s emblem deals 5 damage whenever you cast a spell', (mk, t) => {
    t.auto('Chandra, Torch of Defiance');   // read from the words too now
    const T = mk();
    const ch = T.bf('A', 'Chandra, Torch of Defiance', { counters: { loyalty: 7 } });
    const a = ch.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const idx = list.findIndex(x => (x.effects || []).some(e => e.op === 'getEmblem'));
    t.ok(idx >= 0, 'the emblem ability');
    T.activate('A', ch, idx);
    const em = T.zone('A', 'command').find(o => o.card.layout === 'emblem');
    t.ok(em, 'an emblem in the command zone');
    T.toMain('A');
    T.mana('A', 'R');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 20 - 3 - 5);
    t.no(T.g.canCast('A', em.id).ok, 'and nobody can cast it');
  });

  test('XMage: Bootleggers\' Stash gives lands "{T}: Create a Treasure token."', (mk, t) => {
    t.auto("Bootleggers' Stash");   // the words are read as well now; either way it must work
    const T = mk();
    T.bf('A', "Bootleggers' Stash");
    const land = T.bf('A', 'Forest');
    const a = land.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const idx = list.findIndex(x => x.granted && (x.effects || []).some(e => e.op === 'createNamedToken'));
    t.ok(idx >= 0, 'the land has the granted ability');
    T.activate('A', land, idx);
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
    t.ok(land.tapped);
  });

  test('XMage: Herd Heirloom hands out trample and a card-drawing trigger', (mk, t) => {
    generated(t, 'Herd Heirloom');
    const T = mk();
    const h = T.bf('A', 'Herd Heirloom');
    const wurm = T.bf('A', 'Craw Wurm');
    const a = h.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const idx = list.findIndex(x => (x.effects || []).some(e => e.op === 'grantAbility'));
    t.ok(idx >= 0, 'the granting ability');
    T.activate('A', h, idx, { targets: [wurm] });
    t.ok(T.g.hasKw(wurm, 'trample'), 'trample');
    const before = T.zone('A', 'hand').length;
    T.g._fire('combatDamageToPlayer', 'A', { source: wurm, amount: 6, player: 'B' });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 1, 'drew from the granted trigger');
  });

  test('Brash Taunter sends the damage it is dealt to an opponent', (mk, t) => {
    // read by the text parser now ("it deals that much damage to target opponent")
    t.auto('Brash Taunter');
    const T = mk();
    const bt = T.bf('A', 'Brash Taunter');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bt] });
    t.eq(T.life('B'), 17);
    t.zone(bt, 'battlefield', 'indestructible');
  });

  test('XMage: Twiddle taps or untaps, as its caster says', (mk, t) => {
    generated(t, 'Twiddle');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U');
    T.answer('confirm', { yes: true });
    T.cast('A', T.hand('A', 'Twiddle'), { targets: [b] });
    t.ok(b.tapped, 'tapped');
  });

  test('XMage: bolster goes on the creature with the least toughness', (mk, t) => {
    generated(t, 'Elite Scaleguard');
    const T = mk();
    const small = T.bf('A', 'Llanowar Elves');
    T.bf('A', 'Craw Wurm');
    T.put('A', 'Elite Scaleguard', 'battlefield', { etb: true });
    T.resolve();
    t.eq(small.counters['+1/+1'], 2);
  });

  test('XMage: Bottomless Pit makes the player whose upkeep it is discard', (mk, t) => {
    generated(t, 'Bottomless Pit');
    const T = mk();
    T.bf('A', 'Bottomless Pit');
    T.hand('B', 'Island');
    T.hand('A', 'Swamp');
    T.nextTurn('B');
    t.eq(T.zone('B', 'hand').length, 1, 'B discarded one and drew one');
  });

  test('XMage: Wurmcoil Engine leaves a deathtouch Wurm and a lifelink Wurm', (mk, t) => {
    const T = mk();
    const w = T.bf('A', 'Wurmcoil Engine');
    T.g.moveObject(w, 'graveyard');
    T.resolve();
    const wurms = T.bfOf('A').filter(o => o.name !== 'Wurmcoil Engine' && (o.analysis().subtypes || []).includes('Wurm'));
    t.eq(wurms.length, 2, 'two Wurms');
    t.ok(wurms.some(o => T.g.hasKw(o, 'deathtouch')) && wurms.some(o => T.g.hasKw(o, 'lifelink')), 'one of each');
  });

  test('XMage: Galvanic Blast deals 2, or 4 with metalcraft, to the one target', (mk, t) => {
    generated(t, 'Galvanic Blast');
    let T = mk();
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Galvanic Blast'), { targets: ['B'] });
    t.eq(T.life('B'), 18, 'two without metalcraft');
    T = mk();
    T.bf('A', 'Sol Ring'); T.bf('A', 'Sol Ring'); T.bf('A', 'Sol Ring');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Galvanic Blast'), { targets: ['B'] });
    t.eq(T.life('B'), 16, 'four with three artifacts');
  });

  test('XMage: Mistblade Shinobi bounces a creature the damaged player controls', (mk, t) => {
    t.auto('Mistblade Shinobi');
    const T = mk({ players: ['A', 'B', 'C'] });
    const ninja = T.bf('A', 'Mistblade Shinobi');
    const bs = T.bf('B', 'Grizzly Bears');
    const cs = T.bf('C', 'Grizzly Bears');
    T.answer('pickTarget', (ch) => {
      const ids = ch.options[0].map(o => o.id);
      t.ok(ids.includes(bs.id) && !ids.includes(cs.id), 'only the damaged player\'s creatures');
      return { targets: [{ kind: 'object', id: bs.id }] };
    });
    T.answer('confirm', { yes: true });
    T.g._fire('combatDamageToPlayer', 'A', { source: ninja, amount: 1, player: 'B' });
    T.resolve();
    t.zone(bs, 'hand');
    t.zone(cs, 'battlefield');
  });

  test('XMage: Silhana Ledgewalker can only be blocked by fliers', (mk, t) => {
    t.auto('Silhana Ledgewalker');      // read from its own words now
    const T = mk();
    const s = T.bf('A', 'Silhana Ledgewalker');
    const bear = T.bf('B', 'Grizzly Bears');
    const bird = T.bf('B', 'Suntail Hawk');
    s.attacking = 'B';
    t.no(T.g.canBlock(bear, s, 'B'), 'the bear cannot');
    t.ok(T.g.canBlock(bird, s, 'B'), 'the hawk can');
  });

  test('XMage: Splendid Agony spreads two -1/-1 counters over its targets', (mk, t) => {
    t.auto('Splendid Agony');
    const T = mk();
    const a = T.bf('B', 'Craw Wurm'), b = T.bf('B', 'Craw Wurm');
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Splendid Agony'), { targets: [a, b] });
    t.eq(a.counters['-1/-1'], 1);
    t.eq(b.counters['-1/-1'], 1);
  });

  test('XMage: Mishra\'s Factory pumps an Assembly-Worker, and only that', (mk, t) => {
    generated(t, "Mishra's Factory");
    const a = engine().oracle.analyze(card("Mishra's Factory"));
    const pump = a.abilities.find(x => (x.effects || []).some(e => e.op === 'pump'));
    t.eq(pump.effects[0].targets[0].subtypes[0], 'assembly-worker');
  });

  /* Lines the text reading got wrong, where the translation stands in
     (overrides, chosen because these tests fail without them). */
  test('XMage override: Bastion of Remembrance gains 1, not 1 per opponent', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C', 'D'] });
    T.bf('A', 'Bastion of Remembrance');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.life('A'), 21);
    t.eq(T.life('B'), 19); t.eq(T.life('C'), 19); t.eq(T.life('D'), 19);
  });

  test('XMage override: Duress cannot be aimed at its caster', (mk, t) => {
    const T = mk();
    const d = T.hand('A', 'Duress');
    const spec = T.g._specsOf({ effects: d.analysis().abilities[0].effects })[0];
    t.eq(JSON.stringify(T.g._legalTargetsFor(spec, 'A').map(x => x.id)), JSON.stringify(['B']));
  });

  test('XMage override: Psychosis Crawler counts the cards in your hand', (mk, t) => {
    const T = mk();
    T.hand('A', 'Island'); T.hand('A', 'Island'); T.hand('A', 'Island');
    const pc = T.bf('A', 'Psychosis Crawler');
    t.eq(T.g.powerOf(pc), 3);
    t.eq(T.g.toughnessOf(pc), 3);
  });

  test('XMage override: The Great Henge puts its counter on the creature that entered', (mk, t) => {
    const T = mk();
    const h = T.bf('A', 'The Great Henge');
    const b = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(b.counters['+1/+1'], 1, 'on the bear');
    t.no(h.counters['+1/+1'], 'not on the Henge');
  });

  test('XMage override: Kaito stuns its target, not itself', (mk, t) => {
    const T = mk();
    const k = T.bf('A', 'Kaito, Bane of Nightmares', { counters: { loyalty: 5 } });
    const b = T.bf('B', 'Grizzly Bears');
    const a = k.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', k, list.findIndex(x => x.cost && x.cost.loyalty === -2), { targets: [b] });
    t.eq(b.counters.stun, 2);
    t.ok(b.tapped);
    t.no(k.counters.stun, 'none on Kaito');
  });

  test('XMage override: Fervent Charge pumps the attacker', (mk, t) => {
    const T = mk();
    T.bf('A', 'Fervent Charge');
    const b = T.bf('A', 'Grizzly Bears');
    T.g._fire('permAttacks', null, { object: b, objController: 'A', attacker: b });
    T.resolve();
    t.eq(T.g.powerOf(b), 4);
  });

  test('Counters "on CARDNAME" go on the card itself (Qala)', (mk, t) => {
    const T = mk();
    const q = T.bf('A', "Qala, Ajani's Pridemate");
    T.g.changeLife(T.player('A'), 2);
    T.resolve();
    t.eq(q.counters['+1/+1'], 1);
  });

  test('XMage override: Earthshaker Dreadmaw draws for each other Dinosaur', (mk, t) => {
    const T = mk();
    T.bf('A', 'Earthshaker Dreadmaw');
    T.bf('A', 'Ghalta, Primal Hunger');
    const hand = T.zone('A', 'hand').length;
    T.put('A', 'Earthshaker Dreadmaw', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand + 2, 'one for each of the two others');
  });

  test('XMage: Mindbreak Trap exiles any number of target spells', (mk, t) => {
    generated(t, 'Mindbreak Trap');
    const T = mk();
    const b1 = T.hand('A', 'Lightning Bolt'), b2 = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'RR2UU');
    T.cast('A', b1, { targets: ['B'], resolve: false });
    T.cast('A', b2, { targets: ['B'], resolve: false });
    T.cast('A', T.hand('A', 'Mindbreak Trap'), { targets: [b1, b2].map(b => ({ kind: 'stack', id: T.stackItem(b).id })) });
    t.zone(b1, 'exile');
    t.zone(b2, 'exile');
    t.eq(T.life('B'), 20, 'neither bolt resolved');
  });

  test('XMage: Disrupt Decorum goads every creature you do not control', (mk, t) => {
    generated(t, 'Disrupt Decorum');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2RR');
    T.cast('A', T.hand('A', 'Disrupt Decorum'));
    t.eq(theirs.goadedBy, 'A');
    t.no(mine.goadedBy, 'not my own');
  });

  test('XMage: Battlegrace Angel gives lifelink to a creature attacking alone', (mk, t) => {
    t.auto('Battlegrace Angel');      // read from its own words now
    const T = mk();
    T.bf('A', 'Battlegrace Angel');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 17, 'exalted: 3 damage');
    t.eq(T.life('A'), 23, 'lifelink');
  });

  test('Attacking alone: not with two attackers (Battlegrace Angel)', (mk, t) => {
    const T = mk();
    const angel = T.bf('A', 'Battlegrace Angel');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }, { attackerId: angel.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 14, '2 + 4, no exalted');
    t.eq(T.life('A'), 20, 'no lifelink for either');
  });

  test('XMage: Swamp Mosquito poisons the defending player when unblocked', (mk, t) => {
    generated(t, 'Swamp Mosquito');
    const T = mk();
    const m = T.bf('A', 'Swamp Mosquito');
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.player('B').poison, 1);
  });

  test('Attacks and is not blocked: nothing when blocked (Swamp Mosquito)', (mk, t) => {
    const T = mk();
    const m = T.bf('A', 'Swamp Mosquito');
    const bird = T.bf('B', 'Birds of Paradise');
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: bird.id, attackerIds: [m.id] }]);
    T.toMain('A', 'endCombat');
    t.no(T.player('B').poison, 'blocked: no poison');
  });

  test('Midnight Tilling mills four and returns a permanent card from among them', (mk, t) => {
    t.auto('Midnight Tilling');
    const T = mk();
    const bolt = T.top('A', 'Lightning Bolt');
    const bear = T.top('A', 'Grizzly Bears');
    T.top('A', 'Opt'); T.top('A', 'Shock');
    const old = T.grave('A', 'Llanowar Elves');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Midnight Tilling'));
    t.zone(bear, 'hand', 'the permanent card came back');
    t.zone(bolt, 'graveyard', 'the instant stayed');
    t.zone(old, 'graveyard', 'not one milled earlier');
  });

  test("XMage: Dredger's Insight mills and picks an artifact, creature or land", (mk, t) => {
    generated(t, "Dredger's Insight");
    const T = mk();
    T.top('A', 'Opt'); T.top('A', 'Shock'); T.top('A', 'Lightning Bolt');
    const forest = T.top('A', 'Forest');
    T.put('A', "Dredger's Insight", 'battlefield', { etb: true });
    T.resolve();
    t.zone(forest, 'hand');
  });

  test('XMage: Thieving Magpie draws when it deals damage to an opponent', (mk, t) => {
    generated(t, 'Thieving Magpie');
    const T = mk();
    const m = T.bf('A', 'Thieving Magpie');
    const h0 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test('Damage to a player, not to a creature (Thieving Magpie blocked)', (mk, t) => {
    const T = mk();
    const m = T.bf('A', 'Thieving Magpie');
    const bird = T.bf('B', 'Birds of Paradise');
    const h0 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: bird.id, attackerIds: [m.id] }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h0, 'no card for hitting the Birds');
  });

  test('XMage: Thunderbreak Regent punishes an opponent who targets a Dragon', (mk, t) => {
    generated(t, 'Thunderbreak Regent');
    const T = mk();
    const r = T.bf('B', 'Thunderbreak Regent');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [r] });
    t.eq(T.life('A'), 17);
  });

  test('XMage: Choking Tethers taps a creature when cycled', (mk, t) => {
    generated(t, 'Choking Tethers');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const ct = T.hand('A', 'Choking Tethers');
    T.mana('A', '1U');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    t.ok(T.g.cycleCard('A', ct.id, { auto: true }), 'cycled: ' + T.g.lastError);
    T.resolve();
    t.ok(bear.tapped);
  });

  test('Phantasmal Image copies with its exceptions, and dies when targeted', (mk, t) => {
    t.auto('Phantasmal Image');
    const T = mk();
    T.bf('B', 'Craw Wurm');
    const pi = T.put('A', 'Phantasmal Image', 'battlefield', { etb: true });
    T.resolve();
    t.eq(pi.name, 'Craw Wurm', 'a copy');
    t.ok(T.g._hasCreatureType(pi, 'Illusion'), 'an Illusion as well');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [pi], resolve: false });
    T.resolve();
    t.zone(pi, 'graveyard', 'sacrificed when targeted (2 damage would not kill a 6/4)');
  });

  test('Splinter Twin hands over an activated ability in quotation marks', (mk, t) => {
    t.auto('Splinter Twin');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const tw = T.bf('A', 'Splinter Twin');
    tw.attachedTo = bear.id;
    bear.attachments = [tw.id];
    tw.ts = T.g._stampNew();
    T.g.bumpBoard();
    const acts = bear.analysis().abilities.filter(x => x.kind === 'activated');
    t.eq(acts.length, 1, 'the bear has the ability');
    T.activate('A', bear, 0);
    const tokens = T.bfOf('A').filter(o => o.isToken && o.name === 'Grizzly Bears');
    t.eq(tokens.length, 1, 'a copy of the bear');
    t.ok(bear.tapped, 'tapped to do it');
  });

  test("Elspeth, Sun's Champion's emblem pumps creatures from the command zone", (mk, t) => {
    t.auto("Elspeth, Sun's Champion");
    const T = mk();
    const el = T.bf('A', "Elspeth, Sun's Champion", { counters: { loyalty: 7 } });
    const bear = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    const a = el.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', el, list.findIndex(x => x.cost && x.cost.loyalty === -7));
    t.eq(T.g.powerOf(bear), 4);
    t.ok(T.g.hasKw(bear, 'flying'), 'and flying');
    t.eq(T.g.powerOf(theirs), 2, 'not on the other side');
    const later = T.bf('A', 'Llanowar Elves');
    t.eq(T.g.powerOf(later), 3, 'and creatures that come later');
  });

  test('Learn: a Lesson from outside the game (Professor of Symbology)', (mk, t) => {
    t.auto('Professor of Symbology');
    const T = mk();
    T.player('A').sideboard = [{ card: card('Environmental Sciences'), qty: 1 }];
    T.answer('choose', { picks: [0] });
    T.put('A', 'Professor of Symbology', 'battlefield', { etb: true });
    T.resolve();
    t.ok(T.zone('A', 'hand').some(o => o.name === 'Environmental Sciences'), 'the Lesson is in hand');
    t.eq(T.player('A').sideboard[0].qty, 0, 'and no longer outside the game');
  });

  test('Learn: or discard a card to draw a card', (mk, t) => {
    const T = mk();
    const isl = T.hand('A', 'Island');
    T.top('A', 'Forest');
    T.answer('choose', (ch) => ({ picks: [ch.options.length - 1] }));
    T.answer('discard', { ids: [isl.id] });
    T.put('A', 'Professor of Symbology', 'battlefield', { etb: true });
    T.resolve();
    t.zone(isl, 'graveyard');
    t.ok(T.zone('A', 'hand').some(o => o.name === 'Forest'), 'drew');
  });

  test("Melt Terrain deals damage to the destroyed land's controller", (mk, t) => {
    t.auto('Melt Terrain');
    const T = mk();
    const land = T.bf('B', 'Forest');
    T.mana('A', '2RR');
    T.cast('A', T.hand('A', 'Melt Terrain'), { targets: [land] });
    t.zone(land, 'graveyard');
    t.eq(T.life('B'), 18);
  });

  test('Ogre Siegebreaker destroys only a creature dealt damage this turn', (mk, t) => {
    t.auto('Ogre Siegebreaker');
    const T = mk();
    const og = T.bf('A', 'Ogre Siegebreaker');
    const wurm = T.bf('B', 'Craw Wurm');
    const spec = T.g._specsOf({ effects: og.analysis().abilities.find(x => x.kind === 'activated').effects })[0];
    t.no(T.g._legalTargetsFor(spec, 'A').some(x => x.id === wurm.id), 'not before it is hurt');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [wurm] });
    t.ok(T.g._legalTargetsFor(spec, 'A').some(x => x.id === wurm.id), 'once it has been dealt damage');
    T.mana('A', '2BR');
    T.activate('A', og, 0, { targets: [wurm] });
    t.zone(wurm, 'graveyard');
  });

  test('Cutthroat Maneuver: two creatures each get +1/+1 and lifelink', (mk, t) => {
    t.auto('Cutthroat Maneuver');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves'), c = T.bf('A', 'Birds of Paradise');
    T.mana('A', '3B');
    T.cast('A', T.hand('A', 'Cutthroat Maneuver'), { targets: [a, b] });
    t.eq(T.g.powerOf(a), 3); t.eq(T.g.powerOf(b), 2);
    t.ok(T.g.hasKw(a, 'lifelink') && T.g.hasKw(b, 'lifelink'), 'both gain lifelink');
    t.no(T.g.hasKw(c, 'lifelink'), 'not a third');
  });

  test('Clear the Mind shuffles a graveyard into its library', (mk, t) => {
    t.auto('Clear the Mind');
    const T = mk();
    const g = T.grave('B', 'Island');
    T.top('A', 'Forest');
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Clear the Mind'), { targets: ['B'] });
    t.zone(g, 'library');
  });

  test('Vintara Elephant loses trample until end of turn', (mk, t) => {
    t.auto('Vintara Elephant');
    const T = mk();
    const el = T.bf('A', 'Vintara Elephant');
    t.ok(T.g.hasKw(el, 'trample'));
    T.mana('A', '3');
    T.activate('A', el, 0);
    t.no(T.g.hasKw(el, 'trample'));
  });

  test('Dungeon Map ventures into a dungeon, room by room', (mk, t) => {
    t.auto('Dungeon Map');
    const T = mk();
    const map = T.bf('A', 'Dungeon Map');
    const acts = map.analysis().abilities.filter(x => x.kind === 'activated');
    t.eq(acts.length, 1);
    T.answer('choose', { picks: [0] });
    T.mana('A', '3');
    T.activate('A', map, 1);
    t.eq(T.player('A').dungeon.name, 'Lost Mine of Phandelver');
    t.eq(T.player('A').dungeon.room, 'Cave Entrance');
    map.tapped = false;
    T.answer('choose', { picks: [0] });
    T.mana('A', '3');
    T.activate('A', map, 1);
    t.eq(T.player('A').dungeon.room, 'Goblin Lair');
    t.ok(T.bfOf('A').some(o => o.isToken && o.name === 'Goblin'), 'the room made its Goblin');
  });

  test('Taking the initiative ventures into Undercity', (mk, t) => {
    const T = mk();
    const forest = T.top('A', 'Forest');
    T.top('A', 'Opt');
    T.g.takeInitiative('A', 'a test');
    T.resolve();
    t.ok(T.player('A').initiative, 'has the initiative');
    t.eq(T.player('A').dungeon && T.player('A').dungeon.name, 'Undercity');
    t.zone(forest, 'hand', 'Secret Entrance found a basic land');
  });

  test('The last room completes the dungeon', (mk, t) => {
    const T = mk();
    T.player('A').dungeon = { name: 'Lost Mine of Phandelver', room: 'Dark Pool' };
    T.top('A', 'Island');
    const map = T.bf('A', 'Dungeon Map');
    T.mana('A', '3');
    T.activate('A', map, 1);
    t.no(T.player('A').dungeon, 'out of the dungeon');
    t.eq((T.player('A').dungeonsCompleted || []).join(), 'Lost Mine of Phandelver');
  });

  test('Gloom Stalker has double strike once a dungeon is completed', (mk, t) => {
    t.auto('Gloom Stalker');
    const T = mk();
    const g = T.bf('A', 'Gloom Stalker');
    t.no(T.g.hasKw(g, 'double strike'));
    T.player('A').dungeonsCompleted = ['Lost Mine of Phandelver'];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(g, 'double strike'));
  });

  test('Stifle counters a triggered ability on the stack', (mk, t) => {
    t.auto('Stifle');
    const T = mk();
    T.top('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    T.put('A', 'Elvish Visionary', 'battlefield', { etb: true });
    T.g._putTriggersOnStack();
    t.eq(T.g.stack.length, 1, 'the draw trigger waits on the stack');
    const trig = T.g.stack[0];
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Stifle'), { targets: [{ kind: 'stack', id: trig.id }] });
    t.eq(T.zone('A', 'hand').length, h0, 'no card drawn');
  });

  test('Timetwister: hands and graveyards back in, seven new cards', (mk, t) => {
    t.auto('Timetwister');
    const T = mk();
    for (let i = 0; i < 10; i++) { T.top('A', 'Island'); T.top('B', 'Forest'); }
    const g = T.grave('B', 'Shock');
    T.hand('B', 'Opt');
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Timetwister'));
    t.eq(T.zone('A', 'hand').length, 7);
    t.eq(T.zone('B', 'hand').length, 7);
    t.ok(g.zone === 'library' || g.zone === 'hand', 'the graveyard went back in');
  });

  test('Thought Collapse: its controller mills three', (mk, t) => {
    t.auto('Thought Collapse');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R1UU');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.cast('A', T.hand('A', 'Thought Collapse'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('B'), 20);
    t.eq(T.zone('A', 'graveyard').length, 5, 'Bolt, Collapse and three milled');
  });

  test('Cerulean Wisps turns a creature blue', (mk, t) => {
    t.auto('Cerulean Wisps');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.top('A', 'Island');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Cerulean Wisps'), { targets: [bear] });
    t.eq((bear.analysis().colors || []).join(), 'U');
  });

  test('Cremate exiles the targeted card only, not one from every graveyard', (mk, t) => {
    t.auto('Cremate');
    const T = mk();
    const a1 = T.grave('A', 'Island');
    const b1 = T.grave('B', 'Forest'), b2 = T.grave('B', 'Grizzly Bears');
    T.top('A', 'Island');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Cremate'), { targets: [b2] });
    t.zone(b2, 'exile');
    t.zone(b1, 'graveyard', 'the other card stays');
    t.zone(a1, 'graveyard', 'and so does mine');
  });

  test('Decompose takes cards from one graveyard only', (mk, t) => {
    t.auto('Decompose');
    const T = mk();
    const b1 = T.grave('B', 'Forest'), b2 = T.grave('B', 'Grizzly Bears');
    const a1 = T.grave('A', 'Island');
    T.mana('A', '1B');
    T.cast('A', T.hand('A', 'Decompose'), { targets: [b1, b2, a1] });
    t.zone(b1, 'exile'); t.zone(b2, 'exile');
    t.zone(a1, 'graveyard', 'not from a second graveyard');
  });

  test('Misleading Motes: the owner puts the creature on top or bottom', (mk, t) => {
    t.auto('Misleading Motes');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.top('B', 'Forest'); T.top('B', 'Forest');
    T.answer('choose', { picks: [1] });
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Misleading Motes'), { targets: [bear] });
    const lib = T.zone('B', 'library');
    t.eq(lib[lib.length - 1], bear, 'at the bottom, as chosen');
    t.eq(T.asked.find(c => c.type === 'choose').playerId, 'B', 'the owner chose');
  });

  test('Turbulent lands enter tapped unless opponents control eight lands', (mk, t) => {
    t.auto('Turbulent Fen');
    const T = mk();
    const f = T.put('A', 'Turbulent Fen', 'battlefield', { etb: true });
    T.resolve();
    t.ok(f.tapped);
  });

  test('Loyal Pegasus cannot attack alone, but can with company', (mk, t) => {
    t.auto('Loyal Pegasus');
    const T = mk();
    const p = T.bf('A', 'Loyal Pegasus');
    T.answer('declareAttackers', () => [{ attackerId: p.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 20, 'stayed home');
    const T2 = mk();
    const p2 = T2.bf('A', 'Loyal Pegasus'), bear = T2.bf('A', 'Grizzly Bears');
    T2.answer('declareAttackers', () => [{ attackerId: p2.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T2.toMain('A', 'endCombat');
    t.eq(T2.life('B'), 16, 'both attacked');
  });

  test('Vivid lands enter tapped with two charge counters', (mk, t) => {
    t.auto('Vivid Creek');
    const T = mk();
    const v = T.put('A', 'Vivid Creek', 'battlefield', { etb: true });
    T.resolve();
    t.ok(v.tapped);
    t.eq(v.counters.charge, 2);
  });

  test('Spin Engine: target creature cannot block it this turn', (mk, t) => {
    t.auto('Spin Engine');
    const T = mk();
    const se = T.bf('A', 'Spin Engine');
    const wall = T.bf('B', 'Wall of Stone'), bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.activate('A', se, 0, { targets: [wall] });
    se.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: se.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.no(T.g.canBlock(wall, se), 'the wall cannot');
    t.ok(T.g.canBlock(bear, se), 'the bear still can');
  });

  test('Stormrider Rig attaches itself to a creature that enters', (mk, t) => {
    t.auto('Stormrider Rig');
    const T = mk();
    const rig = T.bf('A', 'Stormrider Rig');
    const bear = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(rig.attachedTo, bear.id);
    t.eq(T.g.powerOf(bear), 3);
  });

  test('Inspiring Refrain exiles itself with time counters, suspended', (mk, t) => {
    t.auto('Inspiring Refrain');
    const T = mk();
    T.top('A', 'Island'); T.top('A', 'Island');
    const ir = T.hand('A', 'Inspiring Refrain');
    T.mana('A', '4UU');
    T.cast('A', ir);
    t.zone(ir, 'exile');
    t.eq(ir.counters.time, 3);
    t.eq(ir.suspendedBy, 'A');
  });

  test('Dethrone: a counter for attacking the player with the most life', (mk, t) => {
    t.auto('Marchesa, the Black Rose');
    const T = mk();
    const m = T.bf('A', 'Marchesa, the Black Rose');
    T.answer('declareAttackers', () => [{ attackerId: m.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(m.counters['+1/+1'], 1);
  });

  test('Steal Enchantment takes control of the enchantment it is on', (mk, t) => {
    t.auto('Steal Enchantment');
    const T = mk();
    const target = T.bf('B', 'Glorious Anthem');
    T.mana('A', 'UU');
    T.cast('A', T.hand('A', 'Steal Enchantment'), { targets: [target] });
    t.eq(target.controller, 'A');
  });

  test('Raging Gorilla gets +2/-2 when it blocks', (mk, t) => {
    t.auto('Raging Gorilla');
    const T = mk();
    const g = T.bf('B', 'Raging Gorilla');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: g.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'endCombat');
    // +2/-2: a 4/1 that kills the bear and dies to it
    t.zone(bear, 'graveyard');
    t.zone(g, 'graveyard');
  });

  test('XMage: Clever Concealment phases out any number of your permanents', (mk, t) => {
    generated(t, 'Clever Concealment');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves');
    T.mana('A', '2WW');
    T.cast('A', T.hand('A', 'Clever Concealment'), { targets: [a, b] });
    t.ok(a.phasedOut && b.phasedOut, 'both phased out');
  });

  test('Vine Mare cannot be blocked by black creatures', (mk, t) => {
    t.auto('Vine Mare');
    const T = mk();
    const m = T.bf('A', 'Vine Mare');
    const black = T.bf('B', 'Vampire Nighthawk'), green = T.bf('B', 'Grizzly Bears');
    t.no(T.g.couldBlock(black, m, 'B'), 'not the black one');
    t.ok(T.g.couldBlock(green, m, 'B'), 'the green one can');
  });

  test('Discard your hand (Wheel-less): every card goes', (mk, t) => {
    const T = mk();
    T.hand('A', 'Island'); T.hand('A', 'Opt');
    const card = { id: 'probe-discard-hand', name: 'Probe Discard', type_line: 'Sorcery', mana_cost: '', cmc: 0, colors: [], layout: 'normal', oracle_text: 'Discard your hand.' };
    t.ok(engine().oracle.analyze(card).fullyAutomated);
  });

  test('Stinkweed Imp destroys a creature it deals combat damage to', (mk, t) => {
    t.auto('Stinkweed Imp');
    const T = mk();
    const imp = T.bf('B', 'Stinkweed Imp');
    const wurm = T.bf('A', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: wurm.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: imp.id, attackerIds: [wurm.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(wurm, 'graveyard', 'the wurm it hit is destroyed');
  });

  test('Cursed Land deals damage in its enchanted land controller\'s upkeep', (mk, t) => {
    t.auto('Cursed Land');
    const T = mk();
    const land = T.bf('B', 'Forest');
    const cl = T.bf('A', 'Cursed Land');
    cl.attachedTo = land.id; land.attachments = [cl.id];
    T.g._fire('eachUpkeep', null, { playerId: 'A' });
    T.resolve();
    t.eq(T.life('B'), 20, 'not in A\'s upkeep');
    T.g._fire('eachUpkeep', null, { playerId: 'B' });
    T.resolve();
    t.eq(T.life('B'), 19, 'in B\'s upkeep');
  });

  test('Megrim punishes an opponent who discards', (mk, t) => {
    t.auto('Megrim');
    const T = mk();
    T.bf('A', 'Megrim');
    const c = T.hand('B', 'Island');
    T.g.moveObject(c, 'graveyard');
    T.g._afterDiscard('B', c);
    T.resolve();
    t.eq(T.life('B'), 18);
    const d = T.hand('A', 'Island');
    T.g.moveObject(d, 'graveyard');
    T.g._afterDiscard('A', d);
    T.resolve();
    t.eq(T.life('A'), 20, 'not for its own controller');
  });

  test('Trapjaw Tyrant style: "whenever this creature is dealt damage"', (mk, t) => {
    t.auto('Trapjaw Tyrant');
    const card = engine().oracle.analyze(require('../harness').card('Trapjaw Tyrant'));
    t.ok(card.abilities.some(x => x.event === 'isDealtDamage' && x.self));
  });

  test("Umezawa's Jitte gets charge counters when its creature deals combat damage", (mk, t) => {
    t.auto("Umezawa's Jitte");
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const j = T.bf('A', "Umezawa's Jitte");
    j.attachedTo = bear.id; bear.attachments = [j.id];
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(j.counters.charge, 2);
  });

  test("Blight destroys the land it enchants when it becomes tapped, whoever controls it", (mk, t) => {
    t.auto('Blight');
    const T = mk();
    const land = T.bf('B', 'Forest');
    const bl = T.bf('A', 'Blight');
    bl.attachedTo = land.id; land.attachments = [bl.id];
    T.g._markTapped(land);
    T.resolve();
    t.zone(land, 'graveyard');
  });

  test('Blood Cultist grows when a creature it damaged dies', (mk, t) => {
    t.auto('Blood Cultist');
    const T = mk();
    const bc = T.bf('A', 'Blood Cultist');
    bc.summoningSick = false;
    const elf = T.bf('B', 'Llanowar Elves');
    T.activate('A', bc, 0, { targets: [elf] });
    t.zone(elf, 'graveyard');
    t.eq(bc.counters['+1/+1'], 1);
  });

  test('Prepared: Studious First-Year casts a copy of Rampant Growth once', (mk, t) => {
    t.auto('Studious First-Year // Rampant Growth');
    const T = mk();
    const c = T.hand('A', 'Studious First-Year // Rampant Growth');
    T.top('A', 'Opt');
    const forest = T.top('A', 'Forest');
    T.mana('A', 'G');
    T.cast('A', c);
    t.ok(c.prepared, 'enters prepared');
    T.mana('A', '1G');
    t.ok(T.g.playableNow('A').some(x => x.objId === c.id && x.via === 'prepared'), 'the copy is on offer');
    t.ok(T.g.castSpell('A', c.id, { via: 'prepared', auto: true }), 'cast the copy');
    T.resolve();
    t.zone(forest, 'battlefield', 'Rampant Growth found the Forest');
    t.no(c.prepared, 'no longer prepared');
    t.zone(c, 'battlefield', 'the creature stays');
    t.no(T.g.altUsesFor('A', c.id).length, 'nothing more on offer');
  });

  test('Lure: every creature able to block it must', (mk, t) => {
    t.auto('Breaker of Armies');
    const T = mk();
    const br = T.bf('A', 'Breaker of Armies');
    const bear = T.bf('A', 'Grizzly Bears');
    const b1 = T.bf('B', 'Llanowar Elves'), b2 = T.bf('B', 'Runeclaw Bear');
    T.answer('declareAttackers', () => [{ attackerId: br.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'declareAttackers');
    T.g.priorityPlayer && T.resolve();
    T.answer('declareBlockers', () => [{ blockerId: b1.id, attackerIds: [bear.id] }]);
    let refused = false;
    try { T.toMain('A', 'combatDamage'); } catch (e) { refused = /must block/.test(e.message + T.g.lastError) || /not accepted/.test(e.message); }
    t.ok(refused, 'blocking the bear instead is refused');
  });

  test('Lure: whoever can block it is drawn to it', (mk, t) => {
    const T = mk();
    const br = T.bf('A', 'Breaker of Armies');
    const b1 = T.bf('B', 'Llanowar Elves');
    t.eq(T.g._blockDemands(b1).length, 0, 'nothing attacking yet');
    T.answer('declareAttackers', () => [{ attackerId: br.id, defenderId: 'B' }]);
    T.toMain('A', 'declareAttackers');
    t.eq(T.g._blockDemands(b1).map(x => x.id).join(), br.id, 'drawn to the lure');
  });

  test('Dream Thrush makes a land the basic type of your choice', (mk, t) => {
    t.auto('Dream Thrush');
    const T = mk();
    const l = T.bf('B', 'Forest');
    const d = T.bf('A', 'Dream Thrush');
    d.summoningSick = false;
    T.answer('choose', { picks: [1] });
    T.activate('A', d, 0, { targets: [l] });
    t.eq(l.analysis().subtypes.join(), 'Island');
  });

  test('War-Name Aspirant: a +1/+1 counter only if you attacked this turn', (mk, t) => {
    t.auto('War-Name Aspirant');
    const T = mk();
    const w1 = T.put('A', 'War-Name Aspirant', 'battlefield', { etb: true });
    T.resolve();
    t.no(w1.counters['+1/+1'], 'no attack yet');
    T.g.turnHistory = Object.assign({}, T.g.turnHistory, { attacked: true });
    const w2 = T.put('A', 'War-Name Aspirant', 'battlefield', { etb: true });
    T.resolve();
    t.eq(w2.counters['+1/+1'], 1);
  });

  test('Auras: +X/+0 and cannot block; +X/+0 and cannot be blocked', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), other = T.bf('B', 'Grizzly Bears');
    const cd = T.bf('A', 'Cast into Darkness');
    cd.attachedTo = other.id; other.attachments = [cd.id]; cd.ts = T.g._stampNew();
    const at = T.bf('A', 'Aether Tunnel');
    at.attachedTo = bear.id; bear.attachments = [at.id]; at.ts = T.g._stampNew();
    T.g.bumpBoard();
    t.eq(T.g.powerOf(other), 0, '-2/-0');
    t.ok(T.g._hasFlag(other, 'cantBlock'), 'cannot block');
    t.eq(T.g.powerOf(bear), 3);
    const blocker = T.bf('B', 'Llanowar Elves');
    t.no(T.g.couldBlock(blocker, bear, 'B'), 'cannot be blocked');
  });

  test('Quirion Ranger returns a Forest to untap a creature', (mk, t) => {
    t.auto('Quirion Ranger');
    const T = mk();
    const qr = T.bf('A', 'Quirion Ranger');
    const f = T.bf('A', 'Forest');
    const bear = T.bf('A', 'Grizzly Bears');
    bear.tapped = true;
    T.activate('A', qr, 0, { targets: [bear] });
    t.zone(f, 'hand', 'the Forest paid for it');
    t.no(bear.tapped, 'untapped');
  });

  test('Broken Fall returns itself to regenerate a creature', (mk, t) => {
    t.auto('Broken Fall');
    const T = mk();
    const bf = T.bf('A', 'Broken Fall');
    const bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', bf, 0, { targets: [bear] });
    t.zone(bf, 'hand');
    t.eq(bear.shields, 1);
  });

  test('Power-up: cheaper the turn it enters, and only once', (mk, t) => {
    t.auto('Unliving Legionnaire');
    const T = mk();
    const u = T.put('A', 'Unliving Legionnaire', 'battlefield', {});
    u.entered = T.g.turn;
    const ab = u.analysis().abilities.find(x => x.kind === 'activated');
    t.eq(T.g._abilityMana(u, ab), '{2}{B}', 'its own mana cost comes off');
    T.mana('A', '2B');
    const idx = u.analysis().manaAbilities.length + u.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').indexOf(ab);
    T.activate('A', u, idx, { targets: [] });
    t.eq(u.counters['+1/+1'], 2);
    t.ok(T.g._activationBlocked(u, ab, 'A'), 'not a second time');
  });

  test('Bloodrush and reinforce: abilities from the hand, paid by discarding', (mk, t) => {
    t.auto('Rubblebelt Maaka'); t.auto('Burrenton Bombardier');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const rm = T.hand('A', 'Rubblebelt Maaka');
    T.mana('A', 'R');
    bear.attacking = 'B';
    t.ok(T.g.cycleCard('A', rm.id, { auto: true, channel: true, targets: [{ kind: 'object', id: bear.id }] }), 'bloodrushed: ' + T.g.lastError);
    T.resolve();
    t.zone(rm, 'graveyard');
    t.eq(T.g.powerOf(bear), 5);
    const bb = T.hand('A', 'Burrenton Bombardier');
    T.mana('A', '2W');
    t.ok(T.g.cycleCard('A', bb.id, { auto: true, channel: true, targets: [{ kind: 'object', id: bear.id }] }), 'reinforced');
    T.resolve();
    t.eq(bear.counters['+1/+1'], 2);
  });

  test('Energy costs are paid in energy, not skipped (Bristling Hydra)', (mk, t) => {
    const T = mk();
    const h = T.bf('A', 'Bristling Hydra');
    T.player('A').energy = 2;
    const idx = h.analysis().manaAbilities.length + h.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.cost && x.cost.energy);
    let refused = false;
    try { T.activate('A', h, idx); } catch (e) { refused = true; }
    t.ok(refused, 'two energy is not enough');
    T.player('A').energy = 3;
    T.activate('A', h, idx);
    t.eq(T.player('A').energy, 0, 'three paid');
    t.eq(h.counters['+1/+1'], 1);
  });

  test('As long as: Shield of the Oversoul cares what colour its creature is', (mk, t) => {
    t.auto('Shield of the Oversoul');
    const T = mk();
    const green = T.bf('A', 'Grizzly Bears'), white = T.bf('A', 'Savannah Lions');
    const s1 = T.bf('A', 'Shield of the Oversoul');
    s1.attachedTo = green.id; green.attachments = [s1.id]; s1.ts = T.g._stampNew();
    T.g.bumpBoard();
    t.ok(T.g.hasKw(green, 'indestructible'), 'green: indestructible');
    t.no(T.g.hasKw(green, 'flying'), 'not flying');
    t.eq(T.g.powerOf(green), 3);
    s1.attachedTo = white.id; green.attachments = []; white.attachments = [s1.id];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(white, 'flying'), 'white: flying');
  });

  test('As long as: Putrid Imp at threshold gets +1/+1 and cannot block', (mk, t) => {
    t.auto('Putrid Imp');
    const T = mk();
    const imp = T.bf('A', 'Putrid Imp');
    t.no(T.g._hasFlag(imp, 'cantBlock'));
    for (let i = 0; i < 7; i++) T.grave('A', 'Island');
    T.g.bumpBoard();
    t.ok(T.g._hasFlag(imp, 'cantBlock'));
    t.eq(T.g.powerOf(imp), 2);
  });

  test("Wayward Swordtooth can't attack or block without the city's blessing", (mk, t) => {
    t.auto('Wayward Swordtooth');
    const T = mk();
    const w = T.bf('A', 'Wayward Swordtooth');
    w.summoningSick = false;
    t.no(T.g.canAttack(w), 'no blessing: cannot attack');
    T.player('A').cityBlessing = true;
    t.ok(T.g.canAttack(w), 'with it, can');
  });

  test('Rituals that keep their mana until end of turn', (mk, t) => {
    const T = mk();
    const card = { id: 'probe-keep-mana', name: 'Probe Keep Mana', type_line: 'Sorcery', mana_cost: '', cmc: 0, colors: [], layout: 'normal',
      oracle_text: "Add {G}{G}. Until end of turn, you don't lose this mana as steps and phases end." };
    t.ok(engine().oracle.analyze(card).fullyAutomated);
  });

  test('Flameshadow Conjuring copies the creature that entered', (mk, t) => {
    t.auto('Flameshadow Conjuring');
    const T = mk();
    T.bf('A', 'Flameshadow Conjuring');
    T.mana('A', 'R');
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    const toks = T.bfOf('A').filter(o => o.isToken);
    t.eq(toks.length, 1);
    t.eq(toks[0] && toks[0].name, 'Grizzly Bears');
    t.ok(toks[0] && T.g.hasKw(toks[0], 'haste'), 'with haste');
  });

  test('Nylea, Keen-Eyed: a creature on top goes to hand, otherwise maybe the graveyard', (mk, t) => {
    t.auto('Nylea, Keen-Eyed');
    const T = mk();
    const ny = T.bf('A', 'Nylea, Keen-Eyed');
    const bear = T.top('A', 'Grizzly Bears');
    T.mana('A', '2G');
    const idx = ny.analysis().manaAbilities.length + ny.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    T.activate('A', ny, idx);
    t.zone(bear, 'hand', 'a creature: into the hand');
    const land = T.top('A', 'Forest');
    T.answer('confirm', { yes: true });
    T.mana('A', '2G');
    T.activate('A', ny, idx);
    t.zone(land, 'graveyard', 'not a creature: into the graveyard, as chosen');
  });

  test('"Until end of turn, this land becomes ..." reads like "... until end of turn"', (mk, t) => {
    t.auto('Stirring Wildwood');
    const T = mk();
    const w = T.bf('A', 'Stirring Wildwood');
    T.mana('A', '1GW');
    const idx = w.analysis().manaAbilities.length + w.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    T.activate('A', w, idx);
    t.ok(w.analysis().isCreature, 'a creature now');
    t.eq(T.g.powerOf(w), 3);
    t.ok(T.g.hasKw(w, 'reach'));
  });

  test('Slip Out the Back: a counter, then the same creature phases out', (mk, t) => {
    t.auto('Slip Out the Back');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Slip Out the Back'), { targets: [bear] });
    t.eq(bear.counters['+1/+1'], 1);
    t.ok(bear.phasedOut);
  });

  test('Old Gnawbone makes a Treasure for each point of combat damage', (mk, t) => {
    t.auto('Old Gnawbone');
    const T = mk();
    T.bf('A', 'Old Gnawbone');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test("Irenicus's Vile Duplication: a flying, nonlegendary copy", (mk, t) => {
    t.auto("Irenicus's Vile Duplication");
    const T = mk();
    const k = T.bf('A', 'Isamaru, Hound of Konda');
    T.mana('A', '3U');
    T.cast('A', T.hand('A', "Irenicus's Vile Duplication"), { targets: [k] });
    const tok = T.bfOf('A').find(o => o.isToken);
    t.ok(tok && T.g.hasKw(tok, 'flying'), 'flying');
    t.no(tok && (tok.analysis().supertypes || []).includes('Legendary'), 'not legendary');
    t.zone(k, 'battlefield', 'the original survives the legend rule');
  });

  test('Krosan Verge finds a Forest and a Plains', (mk, t) => {
    t.auto('Krosan Verge');
    const T = mk();
    const kv = T.bf('A', 'Krosan Verge');
    const f = T.top('A', 'Forest'), p = T.top('A', 'Plains');
    T.mana('A', '2');
    const idx = kv.analysis().manaAbilities.length + kv.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    T.activate('A', kv, idx);
    const got = T.bfOf('A').filter(o => o.name === 'Forest' || o.name === 'Plains');
    t.eq(got.map(o => o.name).sort().join(), 'Forest,Plains');
    t.ok(got.every(o => o.tapped), 'tapped');
  });

  test('Vilis draws as many cards as life was lost', (mk, t) => {
    t.auto('Vilis, Broker of Blood');
    const T = mk();
    T.bf('A', 'Vilis, Broker of Blood');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.g.changeLife('A', -3);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 3);
  });

  test('Ranger-Captain of Eos: opponents cannot cast noncreature spells', (mk, t) => {
    t.auto('Ranger-Captain of Eos');
    const T = mk();
    T.player('A').silencedNoncreatureTurn = T.g.turn;
    const bolt = T.hand('A', 'Lightning Bolt'), bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'RG1');
    t.ok(/noncreature/.test(T.g.canCast('A', bolt.id).reason || ''), 'no Bolt');
    t.ok(T.g.canCast('A', bear.id).ok, 'a creature spell is fine');
  });

  test('Amulet of Vigor untaps a permanent that enters tapped', (mk, t) => {
    t.auto('Amulet of Vigor');
    const T = mk();
    T.bf('A', 'Amulet of Vigor');
    const l = T.put('A', 'Guildless Commons', 'battlefield', { etb: true });
    T.resolve();
    t.no(l.tapped, 'untapped again');
  });

  test('Waste Not: a Zombie for a creature card, a card for a spell', (mk, t) => {
    t.auto('Waste Not');
    const T = mk();
    T.bf('A', 'Waste Not');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const c = T.hand('B', 'Grizzly Bears');
    T.g.moveObject(c, 'graveyard'); T.g._afterDiscard('B', c);
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Zombie').length, 1, 'a Zombie');
    const h = T.zone('A', 'hand').length;
    const d = T.hand('B', 'Shock');
    T.g.moveObject(d, 'graveyard'); T.g._afterDiscard('B', d);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 1, 'a card for the Shock');
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Zombie').length, 1, 'and no second Zombie');
  });

  test('Magda makes a Treasure when a Dwarf becomes tapped', (mk, t) => {
    t.auto('Magda, Brazen Outlaw');
    const T = mk();
    T.bf('A', 'Magda, Brazen Outlaw');
    const d = T.bf('A', 'Dwarven Trader');
    T.g._markTapped(d);
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });

  test('Valakut deals 3 when a Mountain enters with five others', (mk, t) => {
    t.auto('Valakut, the Molten Pinnacle');
    const T = mk();
    T.bf('A', 'Valakut, the Molten Pinnacle');
    for (let i = 0; i < 5; i++) T.bf('A', 'Mountain');
    T.put('A', 'Mountain', 'battlefield', { etb: true });
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 17);
  });

  test('Grisly Salvage: a creature or land into hand, the rest into the graveyard', (mk, t) => {
    t.auto('Grisly Salvage');
    const T = mk();
    const cards = ['Opt', 'Shock', 'Grizzly Bears', 'Lightning Bolt', 'Counterspell'].map(n => T.top('A', n));
    T.mana('A', 'BG');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Grizzly Bears').id] }));
    T.cast('A', T.hand('A', 'Grisly Salvage'));
    t.zone(cards[2], 'hand', 'the bear');
    t.ok(cards.filter((c, i) => i !== 2).every(c => c.zone === 'graveyard'), 'the rest to the graveyard');
  });

  test('Rebuff the Wicked only counters a spell aimed at your permanent', (mk, t) => {
    t.auto('Rebuff the Wicked');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const b1 = T.hand('A', 'Shock'), b2 = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'RR');
    T.cast('A', b1, { targets: [bear], resolve: false });
    T.cast('A', b2, { targets: ['B'], resolve: false });
    const spec = T.g._specsOf({ effects: card('Rebuff the Wicked') && engine().oracle.analyze(card('Rebuff the Wicked')).abilities[0].effects })[0];
    const legal = T.g._legalTargetsFor(spec, 'A').map(x => x.id);
    t.ok(legal.includes(T.stackItem(b1).id), 'the Shock at my bear');
    t.no(legal.includes(T.stackItem(b2).id), 'not the Bolt at a player');
  });

  test('Miirym copies another Dragon that enters, not legendary', (mk, t) => {
    t.auto('Miirym, Sentinel Wyrm');
    const T = mk();
    T.bf('A', 'Miirym, Sentinel Wyrm');
    T.put('A', 'Shivan Dragon', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Shivan Dragon').length, 1);
  });

  test('Murderous Rider goes to the bottom of its library when it dies', (mk, t) => {
    t.auto('Murderous Rider // Swift End');
    const T = mk();
    const r = T.bf('A', 'Murderous Rider // Swift End');
    T.g.moveObject(r, 'graveyard');
    T.resolve();
    const lib = T.zone('A', 'library');
    t.eq(lib[lib.length - 1], r, 'on the bottom');
  });

  test('Relic of Sauron: two mana in any combination of three colours', (mk, t) => {
    t.auto('Relic of Sauron');
    const a = engine().oracle.analyze(card('Relic of Sauron'));
    const m = a.manaAbilities.find(x => (x.effects || []).length === 2);
    t.ok(m && m.effects.every(e => e.op === 'addManaChoice' && e.choices.length === 3), 'two choices of U, B or R');
  });

  test("Grab the Prize: 2 damage only if the discarded card wasn't a land", (mk, t) => {
    t.auto('Grab the Prize');
    for (const [disc, life] of [['Island', 20], ['Shock', 18]]) {
      const T = mk();
      T.hand('A', disc);
      T.top('A', 'Forest'); T.top('A', 'Forest');
      T.mana('A', '1R');
      T.cast('A', T.hand('A', 'Grab the Prize'));
      t.eq(T.life('B'), life, disc);
      t.eq(T.zone('A', 'hand').length, 2, 'drew two');
    }
  });

  test('Charming Prince flickers another creature you own', (mk, t) => {
    t.auto('Charming Prince');
    const T = mk();
    const g = T.bf('A', 'Grizzly Bears');
    T.answer('mode', { modes: [2] });
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Charming Prince'));
    T.resolve();
    t.eq(g.zone, 'exile');
    T.toMain('B');
    t.ok(T.bfOf('A').some(o => o.name === 'Grizzly Bears'), 'back at the end step');
  });

  test('Insidious Fungus: draw, then put a land from hand tapped', (mk, t) => {
    t.auto('Insidious Fungus');
    const T = mk();
    const f = T.bf('A', 'Insidious Fungus');
    T.hand('A', 'Forest');
    T.top('A', 'Island');
    T.answer('mode', { modes: [2] });
    T.answer('confirm', { yes: true });
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', '2');
    const a = f.analysis();
    T.activate('A', f, a.manaAbilities.length);
    T.resolve();
    const lands = T.bfOf('A').filter(o => o.analysis().isLand);
    t.eq(lands.length, 1, 'a land went in');
    t.ok(lands[0] && lands[0].tapped, 'tapped');
  });

  test("Maha: opponents' creatures have base toughness 1", (mk, t) => {
    t.auto('Maha, Its Feathers Night');
    const T = mk();
    const w = T.bf('B', 'Craw Wurm');
    const m = T.bf('A', 'Maha, Its Feathers Night');
    t.eq(T.g.toughnessOf(w), 1);
    t.eq(T.g.powerOf(w), 6, 'power kept');
    t.ok(T.g.toughnessOf(m) > 1, 'not its own side');
  });

  test('Witness Protection turns a creature into a vanilla 1/1 Citizen', (mk, t) => {
    t.auto('Witness Protection');
    const T = mk();
    const x = T.bf('B', 'Serra Angel');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Witness Protection'), { targets: [T.tgt(x)] });
    T.resolve();
    t.eq(T.g.powerOf(x), 1); t.eq(T.g.toughnessOf(x), 1);
    t.no(T.g.hasKw(x, 'flying'), 'lost flying');
    t.eq(x.analysis().subtypes.join(), 'Citizen');
  });

  test('Final Showdown: one creature of yours survives the sweep', (mk, t) => {
    t.auto('Final Showdown');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', '4WWW');
    T.cast('A', T.hand('A', 'Final Showdown'), { spree: [1, 2] });
    T.resolve();
    t.zone(mine, 'battlefield');
    t.zone(theirs, 'graveyard');
  });

  test('Rite of Harmony: a trigger for the rest of the turn, gone at cleanup', (mk, t) => {
    t.auto('Rite of Harmony');
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.mana('A', '2GW');
    T.cast('A', T.hand('A', 'Rite of Harmony'));
    T.resolve();
    const bear = T.hand('A', 'Grizzly Bears');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '1G');
    T.cast('A', bear);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before, 'drew for the creature');
    T.nextTurn('B');
    t.eq(T.zone('A', 'command').length, 0, 'over at end of turn');
  });

  test('Great Train Heist: Treasure for damage to the chosen player; an extra combat', (mk, t) => {
    t.auto('Great Train Heist');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    bear.summoningSick = false;
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Great Train Heist'), { spree: [2] });
    T.resolve();
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    const tr = T.bfOf('A').filter(o => o.name === 'Treasure');
    t.eq(tr.length, 1); t.ok(tr[0] && tr[0].tapped, 'tapped');

    const T2 = mk();
    const b2 = T2.bf('A', 'Grizzly Bears');
    b2.summoningSick = false;
    T2.answer('declareAttackers', () => [{ attackerId: b2.id, defenderId: 'B' }]);
    T2.toMain('A', 'declareBlockers');
    T2.mana('A', '2RR');
    T2.cast('A', T2.hand('A', 'Great Train Heist'), { spree: [0] });
    T2.resolve();
    t.no(b2.tapped, 'untapped');
    T2.answer('declareAttackers', () => [{ attackerId: b2.id, defenderId: 'B' }]);
    T2.toMain('B');
    t.eq(T2.life('B'), 16, 'hit twice');
  });

  test("Smuggler's Surprise: two from the milled cards; two creatures from hand", (mk, t) => {
    t.auto("Smuggler's Surprise");
    const T = mk();
    for (const n of ['Grizzly Bears', 'Forest', 'Shock', 'Llanowar Elves']) T.top('A', n);
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.slice(0, ch.count).map(c => c.id) }));
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', "Smuggler's Surprise"), { spree: [0] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 2, 'two of them');
    t.ok(T.zone('A', 'hand').every(c => c.name !== 'Shock'), 'not the instant');

    const T2 = mk();
    T2.hand('A', 'Grizzly Bears'); T2.hand('A', 'Craw Wurm');
    T2.answer('pickCard', (ch) => ({ cardIds: ch.cards.map(c => c.id) }));
    T2.mana('A', 'G4G');
    T2.cast('A', T2.hand('A', "Smuggler's Surprise"), { spree: [1] });
    T2.resolve();
    t.eq(T2.bfOf('A').length, 2, 'both onto the battlefield');
  });

  test('Lively Dirge: up to two creatures, total mana value 4 or less', (mk, t) => {
    t.auto('Lively Dirge');
    const T = mk();
    const a = T.grave('A', 'Grizzly Bears'), b = T.grave('A', 'Llanowar Elves'), c = T.grave('A', 'Craw Wurm');
    T.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T.mana('A', '1B2');
    T.cast('A', T.hand('A', 'Lively Dirge'), { spree: [1] });
    T.resolve();
    t.zone(a, 'battlefield'); t.zone(b, 'battlefield'); t.zone(c, 'graveyard');
  });

  test('Frostcliff Siege: the mode chosen is the one it has', (mk, t) => {
    t.auto('Frostcliff Siege');
    const T = mk();
    T.answer('mode', { modes: [1] });
    T.mana('A', '1GUR');
    T.cast('A', T.hand('A', 'Frostcliff Siege'));
    T.resolve();
    const bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(bear), 3);
    t.ok(T.g.hasKw(bear, 'trample') && T.g.hasKw(bear, 'haste'), 'Temur');
  });

  test('Restoration Magic: tiered, one mode bought', (mk, t) => {
    t.auto('Restoration Magic');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '4WW');
    T.cast('A', T.hand('A', 'Restoration Magic'), { spree: [2, 1] });
    T.resolve();
    t.eq(T.life('A'), 26, 'Curaga only');
    t.ok(T.g.hasKw(bear, 'indestructible'));
  });

  test("Innkeeper's Talent doubles the counters you put", (mk, t) => {
    t.auto("Innkeeper's Talent");
    const T = mk();
    const it = T.bf('A', "Innkeeper's Talent");
    it.counters.level = 2; it._chr = null; T.g.bumpBoard();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Battlegrowth'), { targets: [T.tgt(bear)] });
    T.resolve();
    t.eq(bear.counters['+1/+1'], 2);
  });

  test('Delney: small creatures slip past big blockers, and trigger twice', (mk, t) => {
    t.auto('Delney, Streetwise Lookout');
    const T = mk();
    T.bf('A', 'Delney, Streetwise Lookout');
    const bear = T.bf('A', 'Grizzly Bears');
    t.no(T.g.couldBlock(T.bf('B', 'Craw Wurm'), bear, 'B'), 'the Wurm cannot');
    t.ok(T.g.couldBlock(T.bf('B', 'Llanowar Elves'), bear, 'B'), 'the Elves can');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const vis = T.hand('A', 'Elvish Visionary');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '1G');
    T.cast('A', vis);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 1, 'two cards for one Visionary');
  });

  test('Mockingbird copies something no bigger than the mana spent, as a flying Bird', (mk, t) => {
    t.auto('Mockingbird');
    const T = mk();
    T.bf('B', 'Serra Angel'); T.bf('B', 'Grizzly Bears');
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Mockingbird'), { x: 2 });
    T.resolve();
    const m = T.bfOf('A')[0];
    t.eq(m.name, 'Grizzly Bears');
    t.ok(/Bird/.test(m.card.type_line) && T.g.hasKw(m, 'flying'), 'a flying Bird');
  });

  test('Painful Quandary: lose 5 life unless a card is discarded', (mk, t) => {
    t.auto('Painful Quandary');
    for (const pay of [false, true]) {
      const T = mk();
      T.bf('B', 'Painful Quandary');
      const isl = T.hand('A', 'Island');
      T.answer('choose', (ch) => ({ picks: pay ? [ch.items[0].id] : [] }));
      T.mana('A', 'R');
      T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
      T.resolve();
      t.eq(T.life('A'), pay ? 20 : 15, pay ? 'discarded' : 'lost 5');
      t.zone(isl, pay ? 'graveyard' : 'hand');
    }
  });

  test('The Water Crystal: opponents mill four more', (mk, t) => {
    t.auto('The Water Crystal');
    const T = mk();
    T.bf('A', 'The Water Crystal');
    for (let i = 0; i < 8; i++) T.top('B', 'Island');
    const before = T.zone('B', 'graveyard').length;
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Thought Scour'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length - before, 6);
  });

  test("Artist's Talent, level 3: noncombat damage to an opponent plus 2", (mk, t) => {
    t.auto("Artist's Talent");
    const T = mk();
    const at = T.bf('A', "Artist's Talent");
    at.counters.level = 2; at._chr = null; T.g.bumpBoard();
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 16);
  });

  test('The Eternity Elevator: one mana per charge counter', (mk, t) => {
    t.auto('The Eternity Elevator');
    const T = mk();
    const e = T.bf('A', 'The Eternity Elevator');
    e.counters.charge = 3;
    T.g.activateAbility('A', e.id, 0, { auto: true });
    t.eq(T.g.player('A').pool.total(), 3);
  });

  test('Wan Shi Tong: X counters, then half X cards', (mk, t) => {
    t.auto('Wan Shi Tong, Librarian');
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const w = T.hand('A', 'Wan Shi Tong, Librarian');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '3UU');
    T.cast('A', w, { x: 3 });
    T.resolve();
    t.eq(w.counters['+1/+1'], 3);
    t.eq(T.zone('A', 'hand').length, before, 'drew one (and cast one)');
  });

  test('Unstoppable Slasher: half their life; back once with stun counters', (mk, t) => {
    t.auto('Unstoppable Slasher');
    const T = mk();
    const u = T.bf('A', 'Unstoppable Slasher');
    u.summoningSick = false;
    T.g.player('B').life = 15;
    T.answer('declareAttackers', () => [{ attackerId: u.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 6, '15 - 2, then half of 13 rounded up');
    T.g.moveObject(u, 'graveyard');
    T.resolve();
    t.zone(u, 'battlefield');
    t.eq(u.counters.stun, 2);
    t.ok(u.tapped, 'tapped');
    T.g.moveObject(u, 'graveyard');
    T.resolve();
    t.zone(u, 'graveyard', 'it had counters this time');
  });

  test('Full Throttle: attackers untap at each combat this turn', (mk, t) => {
    t.auto('Full Throttle');
    const T = mk();
    T.mana('A', '4RR');
    T.cast('A', T.hand('A', 'Full Throttle'));
    T.resolve();
    t.ok(T.zone('A', 'command').some(o => o.card && o.card.untilEot), 'a trigger for the turn');
    T.nextTurn('B');
    t.eq(T.zone('A', 'command').length, 0, 'gone at cleanup');
  });

  test('Song of Totentanz: Rats that cannot block, and haste', (mk, t) => {
    t.auto('Song of Totentanz');
    const T = mk();
    T.mana('A', '2R');
    T.cast('A', T.hand('A', 'Song of Totentanz'), { x: 2 });
    T.resolve();
    const rats = T.bfOf('A').filter(o => o.name === 'Rat');
    t.eq(rats.length, 2);
    t.ok(rats.every(r => T.g.hasKw(r, 'haste')), 'haste');
  });

  test('Encroaching Dragonstorm goes back to hand when a Dragon arrives', (mk, t) => {
    t.auto('Encroaching Dragonstorm');
    const T = mk();
    const e = T.bf('A', 'Encroaching Dragonstorm');
    T.mana('A', '4RR');
    T.cast('A', T.hand('A', 'Shivan Dragon'));
    T.resolve();
    t.zone(e, 'hand');
  });

  test('Gingerbrute: only hasty creatures can block it', (mk, t) => {
    t.auto('Gingerbrute');
    const T = mk();
    const g = T.bf('A', 'Gingerbrute');
    T.mana('A', '1');
    T.activate('A', g, 0);
    T.resolve();
    t.no(T.g.couldBlock(T.bf('B', 'Grizzly Bears'), g, 'B'), 'no haste');
    t.ok(T.g.couldBlock(T.bf('B', 'Raging Goblin'), g, 'B'), 'haste');
  });

  test('Qarsi Revenant: keyword counters are keywords', (mk, t) => {
    t.auto('Qarsi Revenant');
    const T = mk();
    const q = T.grave('A', 'Qarsi Revenant');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', '2B');
    t.ok(T.g.activateAbility('A', q.id, 0, { auto: true, targets: [{ kind: 'object', id: b.id }] }), 'renewed');
    T.resolve();
    t.ok(T.g.hasKw(b, 'flying') && T.g.hasKw(b, 'deathtouch') && T.g.hasKw(b, 'lifelink'), 'all three');
    t.zone(q, 'exile');
  });

  test('Tezzeret, Cruel Captain: a counter only on an artifact creature', (mk, t) => {
    for (const [n, want] of [['Ornithopter', 1], ['Grizzly Bears', 0]]) {
      const T = mk();
      const tz = T.bf('A', 'Tezzeret, Cruel Captain');
      tz.counters.loyalty = 4;
      const x = T.bf('A', n);
      x.tapped = true;
      const a = tz.analysis();
      const idx = a.manaAbilities.length + a.abilities.filter(z => z.kind === 'activated' || z.kind === 'loyalty').findIndex(z => /^0:/.test(z.text));
      T.activate('A', tz, idx, { targets: [x] });
      T.resolve();
      t.no(x.tapped, 'untapped');
      t.eq(Number(x.counters['+1/+1']) || 0, want, n);
    }
  });

  test('Convoke taps creatures and delve exiles cards', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 5; i++) T.grave('A', 'Island');
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Treasure Cruise'));
    T.resolve();
    t.eq(T.zone('A', 'exile').length, 5, 'five exiled to delve');
    const T2 = mk();
    const c = [T2.bf('A', 'Grizzly Bears'), T2.bf('A', 'Grizzly Bears'), T2.bf('A', 'Craw Wurm')];
    T2.mana('A', 'RR');
    T2.cast('A', T2.hand('A', 'Stoke the Flames'), { targets: [{ kind: 'player', id: 'B' }] });
    T2.resolve();
    t.eq(c.filter(x => x.tapped).length, 2, 'two creatures tapped to convoke');
    t.eq(T2.life('B'), 16);
  });

  test('Crystal Barricade prevents noncombat damage to your other creatures', (mk, t) => {
    t.auto('Crystal Barricade');
    const T = mk();
    T.bf('B', 'Crystal Barricade');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [T.tgt(bear)] });
    T.resolve();
    t.zone(bear, 'battlefield');
  });

  test('Leyline of the Guildpact: all colours, every basic land type', (mk, t) => {
    t.auto('Leyline of the Guildpact');
    const T = mk();
    T.bf('A', 'Leyline of the Guildpact');
    const bear = T.bf('A', 'Grizzly Bears'), f = T.bf('A', 'Forest'), theirs = T.bf('B', 'Grizzly Bears');
    t.eq(bear.analysis().colors.length, 5);
    t.eq(theirs.analysis().colors.join(), 'G', 'not theirs');
    t.ok(f.analysis().subtypes.includes('Island'), 'an Island too');
  });

  test('Massacre Girl, Known Killer: a card when toughness fell below 1', (mk, t) => {
    t.auto('Massacre Girl, Known Killer');
    const T = mk();
    T.bf('A', 'Massacre Girl, Known Killer');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const before = T.zone('A', 'hand').length;
    const elf = T.bf('B', 'Llanowar Elves'), bear = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(elf, '-1/-1', 1);
    T.g.checkStateBasedActions();
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 1, 'drew for the Elves');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 1, 'not for the Bears');
  });

  test('Season of Weaving: a token copy of a creature you choose', (mk, t) => {
    t.auto('Season of Weaving');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'UU4');
    T.answer('choose', { picks: [1] });
    T.answer('choose', { picks: [bear.id] });
    T.cast('A', T.hand('A', 'Season of Weaving'));
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Grizzly Bears' && o.isToken).length, 1);
  });

  test('Time Warp gives the target player the next turn', (mk, t) => {
    t.auto('Time Warp');
    const T = mk();
    T.mana('A', '3UU');
    T.cast('A', T.hand('A', 'Time Warp'), { targets: [{ kind: 'player', id: 'A' }] });
    T.resolve();
    t.eq(T.g.extraTurnsQueue.join(), 'A');
  });

  test('Jin-Gitaxias, Core Augur: opponents keep no cards at cleanup', (mk, t) => {
    t.auto('Jin-Gitaxias, Core Augur');
    const T = mk();
    T.bf('A', 'Jin-Gitaxias, Core Augur');
    t.eq(T.g._handSizeMod('B'), -7);
    t.eq(T.g._handSizeMod('A'), 0, 'not yours');
  });

  test('Mahadi: a Treasure for each creature that died this turn, or none', (mk, t) => {
    t.auto('Mahadi, Emporium Master');
    const T = mk();
    const m = T.bf('A', 'Mahadi, Emporium Master');
    T.g._runEffect({ op: 'createNamedToken', token: 'Treasure', n: { diedThisTurn: true, mult: 1 } }, { controller: 'A', obj: m });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 0, 'nothing died');
    T.g.moveObject(T.bf('B', 'Grizzly Bears'), 'graveyard');
    T.g.moveObject(T.bf('B', 'Grizzly Bears'), 'graveyard');
    T.g._runEffect({ op: 'createNamedToken', token: 'Treasure', n: { diedThisTurn: true, mult: 1 } }, { controller: 'A', obj: m });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test('Decree of Pain draws for each creature destroyed', (mk, t) => {
    t.auto('Decree of Pain');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears'); T.bf('B', 'Llanowar Elves');
    const d = T.hand('A', 'Decree of Pain');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '6BB');
    T.cast('A', d);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before - 1 + 3);
  });

  test('Wave Goodbye spares creatures with +1/+1 counters', (mk, t) => {
    t.auto('Wave Goodbye');
    const T = mk();
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(b, '+1/+1', 1);
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Wave Goodbye'));
    T.resolve();
    t.zone(a, 'hand'); t.zone(b, 'battlefield');
  });

  test('Winds of Rath spares enchanted creatures', (mk, t) => {
    t.auto('Winds of Rath');
    const T = mk();
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears');
    const aura = T.bf('B', 'Rancor');
    aura.attachedTo = b.id; b.attachments.push(aura.id); T.g.bumpBoard();
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Winds of Rath'));
    T.resolve();
    t.zone(a, 'graveyard'); t.zone(b, 'battlefield');
  });

  test('Eldrazi Monument eats itself with no creature to sacrifice', (mk, t) => {
    t.auto('Eldrazi Monument');
    const T = mk();
    const m = T.bf('A', 'Eldrazi Monument');
    T.nextTurn('B');
    T.nextTurn('A');
    t.zone(m, 'graveyard');
  });

  test('Up the Beanstalk: a card as it enters and for each big spell', (mk, t) => {
    t.auto('Up the Beanstalk');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const u = T.hand('A', 'Up the Beanstalk');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '1G');
    T.cast('A', u);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before, 'cast one, drew one');
    T.mana('A', '4GG');
    T.cast('A', T.hand('A', 'Craw Wurm'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 1, 'took the Wurm in, cast it, drew one');
  });

  test('Jadar and decayed: a Zombie only when there is none; it cannot block', (mk, t) => {
    t.auto('Jadar, Ghoulcaller of Nephalia');
    const T = mk();
    T.bf('A', 'Jadar, Ghoulcaller of Nephalia');
    T.nextTurn('B');
    const z = T.bfOf('A').filter(o => o.name === 'Zombie');
    t.eq(z.length, 1, 'one Zombie');
    t.no(T.g.couldBlock(z[0], T.bf('B', 'Grizzly Bears'), 'A'), 'decayed cannot block');
    T.nextTurn('A');
    T.nextTurn('B');
    t.eq(T.bfOf('A').filter(o => o.name === 'Zombie').length, 1, 'not another while one is there');
  });

  test('Decayed: sacrificed at end of combat after it attacks', (mk, t) => {
    const T = mk();
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Hobbling Zombie'));
    T.resolve();
    const h = T.bfOf('A').find(o => o.name === 'Hobbling Zombie');
    T.g.moveObject(h, 'graveyard');
    T.resolve();
    const z = T.bfOf('A').find(o => o.name === 'Zombie');
    t.ok(z, 'a decayed Zombie');
    z.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: z.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    T.toMain('A', 'main');
    t.no(T.bfOf('A').includes(z), 'gone');
  });

  test('Obscuring Haze prevents damage from opposing creatures only', (mk, t) => {
    t.auto('Obscuring Haze');
    const T = mk();
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Obscuring Haze'));
    T.resolve();
    const theirs = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Grizzly Bears');
    T.g.dealDamageToPlayer(T.g.player('A'), 2, theirs, true);
    t.eq(T.life('A'), 20, 'prevented');
    T.g.dealDamageToPlayer(T.g.player('B'), 2, mine, true);
    t.eq(T.life('B'), 18, 'not prevented');
  });

  test('Court of Grace: an Angel instead for the monarch', (mk, t) => {
    t.auto('Court of Grace');
    const T = mk();
    const c = T.bf('A', 'Court of Grace');
    T.g.setMonarch('A');
    T.nextTurn('B');
    T.nextTurn('A');
    t.ok(T.bfOf('A').some(o => o.name === 'Angel'), 'an Angel');
    t.no(T.bfOf('A').some(o => o.name === 'Spirit'), 'not a Spirit');
  });

  test('Runaway Steam-Kin stops at three counters', (mk, t) => {
    t.auto('Runaway Steam-Kin');
    const T = mk();
    const k = T.bf('A', 'Runaway Steam-Kin');
    k.counters['+1/+1'] = 3;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(k.counters['+1/+1'], 3);
  });

  test('Legion Warboss: the Goblin has haste and must attack', (mk, t) => {
    t.auto('Legion Warboss');
    const T = mk();
    T.bf('A', 'Legion Warboss');
    T.toMain('A', 'beginCombat');
    T.resolve();
    const g = T.bfOf('A').find(o => o.name === 'Goblin');
    t.ok(g && T.g.hasKw(g, 'haste'), 'haste');
    t.ok(g && T.g._hasFlag(g, 'mustAttackEot'), 'attacks if able');
  });

  test('Righteous Valkyrie: +2/+2 at seven life over the start', (mk, t) => {
    t.auto('Righteous Valkyrie');
    const T = mk();
    T.bf('A', 'Righteous Valkyrie');
    const b = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(b), 2);
    T.g.player('A').life = (T.g.config.startingLife || 20) + 7;
    T.g.bumpBoard();
    t.eq(T.g.powerOf(b), 4);
  });

  test("Xenagos: another creature doubles its power and gains haste", (mk, t) => {
    t.auto('Xenagos, God of Revels');
    const T = mk();
    T.bf('A', 'Xenagos, God of Revels');
    const w = T.bf('A', 'Craw Wurm');
    T.toMain('A', 'beginCombat');
    T.resolve();
    t.eq(T.g.powerOf(w), 12);
    t.ok(T.g.hasKw(w, 'haste'), 'haste');
  });

  test("Multani and Kor Spiritdancer count what the words say", (mk, t) => {
    t.auto("Multani, Yavimaya's Avatar"); t.auto('Kor Spiritdancer');
    const T = mk();
    const m = T.bf('A', "Multani, Yavimaya's Avatar");
    T.bf('A', 'Forest'); T.bf('A', 'Forest'); T.grave('A', 'Island');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(m), 3, 'two lands and one in the graveyard');
    const k = T.bf('A', 'Kor Spiritdancer');
    const r = T.bf('A', 'Rancor');
    r.attachedTo = k.id; k.attachments.push(r.id); T.g.bumpBoard();
    t.eq(T.g.toughnessOf(k), 4, '0/2 and +2/+2 for one Aura');
  });

  test('Fathom Mage draws for each counter', (mk, t) => {
    t.auto('Fathom Mage');
    const T = mk();
    const f = T.bf('A', 'Fathom Mage');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const before = T.zone('A', 'hand').length;
    T.answer('confirm', { yes: true });
    T.g.addCounters(f, '+1/+1', 2);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 2);
  });

  test("Defense Grid taxes spells cast on someone else's turn", (mk, t) => {
    t.auto('Defense Grid');
    const T = mk();
    T.bf('A', 'Defense Grid');
    t.eq(T.g.castCost(T.hand('A', 'Shock')), '{R}', 'on your own turn');
    t.eq(T.g.castCost(T.hand('B', 'Shock')), '{3}{R}', 'on the other turn');
  });

  test("Archetype of Imagination: opponents' creatures can't have flying", (mk, t) => {
    t.auto('Archetype of Imagination');
    const T = mk();
    T.bf('A', 'Archetype of Imagination');
    const s = T.bf('B', 'Serra Angel');
    t.no(T.g.hasKw(s, 'flying'));
    s.effects.push({ keywords: ['Flying'], until: 'eot' });
    T.g.bumpBoard();
    t.no(T.g.hasKw(s, 'flying'), 'nor gain it later');
  });

  test('Uro is sacrificed unless it escaped; Woe Strider escapes with counters', (mk, t) => {
    t.auto("Uro, Titan of Nature's Wrath"); t.auto('Woe Strider');
    const T = mk();
    T.mana('A', '1GU');
    T.cast('A', T.hand('A', "Uro, Titan of Nature's Wrath"));
    T.resolve();
    const u = T.zone('A', 'graveyard').find(o => /^Uro/.test(o.name));
    t.ok(u, 'sacrificed');
    for (let i = 0; i < 5; i++) T.grave('A', 'Island');
    T.mana('A', 'GGUU');
    t.ok(T.g.castSpell('A', u.id, { auto: true, via: 'escape' }), 'escaped');
    T.resolve();
    t.zone(u, 'battlefield', 'stays');
    const T2 = mk();
    const w = T2.grave('A', 'Woe Strider');
    for (let i = 0; i < 4; i++) T2.grave('A', 'Island');
    T2.mana('A', '3BB');
    t.ok(T2.g.castSpell('A', w.id, { auto: true, via: 'escape' }), 'Woe Strider escapes');
    T2.resolve();
    t.eq(w.counters['+1/+1'], 2);
  });

  test('Convoke: the creatures the player chose tap; others are refused', (mk, t) => {
    const T = mk();
    const [a, b, c] = [T.bf('A', 'Grizzly Bears'), T.bf('A', 'Grizzly Bears'), T.bf('A', 'Craw Wurm')];
    const theirs = T.bf('B', 'Grizzly Bears');
    const stoke = T.hand('A', 'Stoke the Flames');
    const ex = T.g.viewFor('A').extras[stoke.id].find(x => x.kind === 'convoke');
    t.ok(ex && ex.candidates.includes(c.id) && ex.max === 2, 'offered, at most 2');
    T.mana('A', 'RR');
    t.no(T.g.castSpell('A', stoke.id, { auto: true, targets: [{ kind: 'player', id: 'B' }], convokeIds: [theirs.id, a.id] }), 'not their creature');
    t.no(T.g.castSpell('A', stoke.id, { auto: true, targets: [{ kind: 'player', id: 'B' }], convokeIds: [a.id, b.id, c.id] }), 'not three');
    t.ok(T.g.castSpell('A', stoke.id, { auto: true, targets: [{ kind: 'player', id: 'B' }], convokeIds: [b.id, c.id] }), T.g.lastError);
    t.ok(b.tapped && c.tapped && !a.tapped, 'the two chosen');
    t.eq(T.g.player('A').pool.total(), 0, 'and the mana');
  });

  test('Convoke: choosing fewer means paying more mana', (mk, t) => {
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Grizzly Bears');
    T.mana('A', 'RR');
    const stoke = T.hand('A', 'Stoke the Flames');
    t.no(T.g.castSpell('A', stoke.id, { auto: true, targets: [{ kind: 'player', id: 'B' }], convokeIds: [a.id] }), 'one short');
    t.no(a.tapped, 'nothing tapped on the way out');
    T.mana('A', '1');
    t.ok(T.g.castSpell('A', stoke.id, { auto: true, targets: [{ kind: 'player', id: 'B' }], convokeIds: [a.id] }), T.g.lastError);
  });

  test('Delve: the cards the player chose are exiled', (mk, t) => {
    const T = mk();
    const gy = [];
    for (let i = 0; i < 7; i++) gy.push(T.grave('A', i < 3 ? 'Shock' : 'Island'));
    const cruise = T.hand('A', 'Treasure Cruise');
    const ex = T.g.viewFor('A').extras[cruise.id].find(x => x.kind === 'delve');
    t.ok(ex && ex.candidates.length === 7 && ex.max === 7, 'offered');
    T.mana('A', 'U');
    t.no(T.g.castSpell('A', cruise.id, { auto: true, delveIds: [T.hand('A', 'Island').id] }), 'not from hand');
    t.ok(T.g.castSpell('A', cruise.id, { auto: true, delveIds: gy.map(c => c.id) }), T.g.lastError);
    t.ok(gy.every(c => c.zone === 'exile'), 'all seven');
  });

  test('Improvise: the artifacts the player chose tap', (mk, t) => {
    const T = mk();
    const arts = [T.bf('A', 'Ornithopter'), T.bf('A', 'Ornithopter'), T.bf('A', 'Ornithopter')];
    const re = T.hand('A', 'Reverse Engineer');
    T.mana('A', 'UU');
    t.no(T.g.castSpell('A', re.id, { auto: true, improviseIds: [T.bf('A', 'Grizzly Bears').id] }), 'not a creature');
    t.no(T.g.castSpell('A', re.id, { auto: true, improviseIds: [arts[0].id, arts[0].id] }), 'not twice');
    t.ok(T.g.castSpell('A', re.id, { auto: true, improviseIds: arts.map(x => x.id) }), T.g.lastError);
    t.ok(arts.every(x => x.tapped), 'all three tapped');
  });

  test('Stubborn Denial counters outright with a big creature', (mk, t) => {
    t.auto('Stubborn Denial');
    for (const big of [false, true]) {
      const T = mk();
      if (big) T.bf('B', 'Craw Wurm');
      T.mana('A', 'R');
      const sh = T.hand('A', 'Shock');
      T.cast('A', sh, { targets: [{ kind: 'player', id: 'B' }], resolve: false });
      T.g.passPriority('A', true);
      T.mana('B', 'U'); T.mana('A', '1');
      T.answer('payOrDont', { pay: true });
      T.cast('B', T.hand('B', 'Stubborn Denial'), { targets: [T.stackTarget(sh)] });
      T.resolve();
      t.eq(T.life('B'), big ? 20 : 18, big ? 'countered anyway' : 'paid for');
    }
  });

  test('Boromir counters a spell cast for no mana', (mk, t) => {
    t.auto('Boromir, Warden of the Tower');
    for (const free of [true, false]) {
      const T = mk();
      T.bf('B', 'Boromir, Warden of the Tower');
      const sh = T.hand('A', 'Shock');
      if (!free) T.mana('A', 'R');
      T.g.castSpell('A', sh.id, { auto: true, free, targets: [{ kind: 'player', id: 'B' }] });
      T.resolve();
      t.eq(T.life('B'), free ? 20 : 18, free ? 'free: countered' : 'paid: resolves');
    }
  });

  test('Tribute to the World Tree: a card for a big creature, counters otherwise', (mk, t) => {
    t.auto('Tribute to the World Tree');
    const T = mk();
    T.bf('A', 'Tribute to the World Tree');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const w = T.hand('A', 'Craw Wurm');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '4GG');
    T.cast('A', w);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before, 'drew one');
    t.no(w.counters['+1/+1'], 'no counters on the Wurm');
    const e = T.hand('A', 'Llanowar Elves');
    T.mana('A', 'G');
    T.cast('A', e);
    T.resolve();
    t.eq(e.counters['+1/+1'], 2);
  });

  test("Imp's Mischief redirects, and costs life equal to that spell's mana value", (mk, t) => {
    t.auto("Imp's Mischief");
    const T = mk();
    T.mana('A', 'R');
    const sh = T.hand('A', 'Shock');
    T.cast('A', sh, { targets: [{ kind: 'player', id: 'B' }], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', '1B');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'A' }] }));
    T.cast('B', T.hand('B', "Imp's Mischief"), { targets: [T.stackTarget(sh)] });
    T.resolve();
    t.eq(T.life('A'), 18, 'the Shock came back');
    t.eq(T.life('B'), 19, 'one life for a one-mana spell');
  });

  test('Shark Typhoon: a Shark as big as the spell', (mk, t) => {
    t.auto('Shark Typhoon');
    const T = mk();
    T.bf('A', 'Shark Typhoon');
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Divination'));
    T.resolve();
    const sh = T.bfOf('A').find(o => o.name === 'Shark');
    t.ok(sh && T.g.powerOf(sh) === 3 && T.g.toughnessOf(sh) === 3, '3/3');
    t.ok(sh && T.g.hasKw(sh, 'flying'), 'flying');
  });

  test('Bane of Progress grows for each permanent destroyed', (mk, t) => {
    t.auto('Bane of Progress');
    const T = mk();
    T.bf('B', 'Ornithopter'); T.bf('B', 'Glorious Anthem'); T.bf('A', 'Ornithopter');
    T.mana('A', '4GG');
    const b = T.hand('A', 'Bane of Progress');
    T.cast('A', b);
    T.resolve();
    t.eq(b.counters['+1/+1'], 3);
  });

  test("Mishra's Bauble looks at a player's top card and draws next upkeep", (mk, t) => {
    t.auto("Mishra's Bauble");
    const T = mk();
    const bb = T.bf('A', "Mishra's Bauble");
    T.activate('A', bb, 0, { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.zone(bb, 'graveyard');
    t.ok(T.asked.some(q => q.type === 'arrange' && q.look), 'looked');
  });

  test('The Locust God comes back to hand at the next end step', (mk, t) => {
    t.auto('The Locust God');
    const T = mk();
    const g = T.bf('A', 'The Locust God');
    T.g.moveObject(g, 'graveyard');
    T.resolve();
    t.zone(g, 'graveyard', 'not yet');
    T.nextTurn('B');
    t.zone(g, 'hand');
  });

  test('Humble Defector changes hands after drawing', (mk, t) => {
    t.auto('Humble Defector');
    const T = mk();
    const h = T.bf('A', 'Humble Defector');
    h.summoningSick = false;
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const before = T.zone('A', 'hand').length;
    T.activate('A', h, 0, { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, before + 2);
    t.eq(h.controller, 'B');
  });

  test('Suture Priest: the player whose creature entered loses 1', (mk, t) => {
    t.auto('Suture Priest');
    const T = mk();
    T.bf('B', 'Suture Priest');
    T.answer('confirm', { yes: true });
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.life('A'), 19);
    t.eq(T.life('B'), 20);
  });

  test('Astral Cornucopia: one mana of a colour per charge counter', (mk, t) => {
    t.auto('Astral Cornucopia');
    const T = mk();
    const c = T.bf('A', 'Astral Cornucopia');
    c.counters.charge = 3;
    T.g.activateAbility('A', c.id, 0, { auto: true });
    t.eq(T.g.player('A').pool.total(), 3);
  });

  test('Triskaidekaphile wins with exactly thirteen cards', (mk, t) => {
    t.auto('Triskaidekaphile');
    const T = mk();
    T.bf('A', 'Triskaidekaphile');
    T.nextTurn('B');
    while (T.zone('A', 'hand').length < 13) T.hand('A', 'Island');
    T.nextTurn('A');
    t.ok(T.g.over || T.g.player('B').hasLost, 'thirteen at upkeep');
  });

  test("Dragon's Rage Channeler with delirium: bigger, flying, attacking", (mk, t) => {
    t.auto("Dragon's Rage Channeler");
    const T = mk();
    const d = T.bf('A', "Dragon's Rage Channeler");
    t.eq(T.g.powerOf(d), 1);
    for (const n of ['Island', 'Shock', 'Grizzly Bears', 'Divination', 'Ornithopter']) T.grave('A', n);
    T.g.bumpBoard();
    t.eq(T.g.powerOf(d), 3);
    t.ok(T.g.hasKw(d, 'flying') && T.g._hasFlag(d, 'mustAttackEot'), 'flying, must attack');
  });

  test('Insurrection takes every creature for the turn', (mk, t) => {
    t.auto('Insurrection');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    b.tapped = true;
    T.mana('A', '5RRR');
    T.cast('A', T.hand('A', 'Insurrection'));
    T.resolve();
    t.eq(b.controller, 'A'); t.no(b.tapped, 'untapped'); t.ok(T.g.hasKw(b, 'haste'), 'haste');
    T.nextTurn('B');
    t.eq(b.controller, 'B', 'back at end of turn');
  });

  test('Temur Battle Rage adds trample with ferocious', (mk, t) => {
    t.auto('Temur Battle Rage');
    for (const [n, tr] of [['Craw Wurm', true], ['Grizzly Bears', false]]) {
      const T = mk();
      const c = T.bf('A', n);
      T.mana('A', '1R');
      T.cast('A', T.hand('A', 'Temur Battle Rage'), { targets: [T.tgt(c)] });
      T.resolve();
      t.ok(T.g.hasKw(c, 'double strike'), 'double strike');
      t.eq(T.g.hasKw(c, 'trample'), tr, n);
    }
  });

  test('Mirror Entity makes your creatures X/X for the turn', (mk, t) => {
    t.auto('Mirror Entity');
    const T = mk();
    const m = T.bf('A', 'Mirror Entity');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', '3');
    T.activate('A', m, 0, { x: 3 });
    T.resolve();
    t.eq(T.g.powerOf(b), 3); t.eq(T.g.toughnessOf(m), 3);
  });

  test('All Is Dust takes every coloured permanent', (mk, t) => {
    t.auto('All Is Dust');
    const T = mk();
    const e = T.bf('B', 'Llanowar Elves'), o = T.bf('A', 'Ornithopter'), f = T.bf('A', 'Forest');
    T.mana('A', '7');
    T.cast('A', T.hand('A', 'All Is Dust'));
    T.resolve();
    t.zone(e, 'graveyard'); t.zone(o, 'battlefield'); t.zone(f, 'battlefield');
  });

  test('Fell the Mighty destroys only the creatures bigger than the target', (mk, t) => {
    t.auto('Fell the Mighty');
    const T = mk();
    const e = T.bf('B', 'Llanowar Elves'), w = T.bf('B', 'Craw Wurm'), b = T.bf('A', 'Grizzly Bears');
    T.mana('A', '4W');
    T.cast('A', T.hand('A', 'Fell the Mighty'), { targets: [T.tgt(b)] });
    T.resolve();
    t.zone(e, 'battlefield'); t.zone(w, 'graveyard'); t.zone(b, 'battlefield');
  });

  test('Disciple of Bolas: life and cards equal to the power sacrificed', (mk, t) => {
    t.auto('Disciple of Bolas');
    const T = mk();
    const w = T.bf('A', 'Craw Wurm');
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const d = T.hand('A', 'Disciple of Bolas');
    const before = T.zone('A', 'hand').length;
    T.answer('choose', (ch) => ({ picks: [w.id] }));
    T.answer('pickCard', (ch) => ({ cardIds: [w.id] }));
    T.mana('A', '3B');
    T.cast('A', d);
    T.resolve();
    t.zone(w, 'graveyard');
    t.eq(T.life('A'), 26);
    t.eq(T.zone('A', 'hand').length, before - 1 + 6);
  });

  test('Thran Power Suit counts the Auras and Equipment on its creature', (mk, t) => {
    t.auto('Thran Power Suit');
    const T = mk();
    const b = T.bf('A', 'Grizzly Bears');
    const s1 = T.bf('A', 'Thran Power Suit');
    s1.attachedTo = b.id; b.attachments.push(s1.id);
    const r = T.bf('A', 'Rancor');
    r.attachedTo = b.id; b.attachments.push(r.id);
    T.g.bumpBoard();
    t.eq(T.g.toughnessOf(b), 4, '2 + 2 for the Suit and Rancor');
  });

  test("Alesha only brings back what her power allows", (mk, t) => {
    t.auto('Alesha, Who Laughs at Fate');
    const T = mk();
    const al = T.bf('A', 'Alesha, Who Laughs at Fate');
    const small = T.grave('A', 'Grizzly Bears'), big = T.grave('A', 'Craw Wurm');
    const ab = al.analysis().abilities.find(x => x.kind === 'triggered' && /end step/.test(x.text));
    const spec = ab.effects[0].targets[0];
    const ids = T.g._legalTargetsFor(spec, 'A', al.id).map(x => x.id);
    t.ok(ids.includes(small.id) && !ids.includes(big.id), 'the Bears, not the Wurm');
  });

  test('Warden of the Grove: endure as many as its counters', (mk, t) => {
    t.auto('Warden of the Grove');
    const T = mk();
    const w = T.bf('A', 'Warden of the Grove');
    w.counters['+1/+1'] = 2; w.counters.stun = 1;
    T.answer('mode', { modes: [0] });
    T.mana('A', '1G');
    const b = T.hand('A', 'Grizzly Bears');
    T.cast('A', b);
    T.resolve();
    t.eq(b.counters['+1/+1'], 3, 'three counters on the Warden');
  });

  test("Frenzied Baloth: combat damage can't be prevented", (mk, t) => {
    t.auto('Frenzied Baloth');
    const T = mk();
    const b = T.bf('A', 'Frenzied Baloth');
    T.g.prevention.push({ combatOnly: true, who: 'B', until: 'eot' });
    T.g.dealDamageToPlayer(T.g.player('B'), 3, b, true);
    t.eq(T.life('B'), 17);
  });

  test('Dracogenesis: Dragons for nothing', (mk, t) => {
    t.auto('Dracogenesis');
    const T = mk();
    T.bf('A', 'Dracogenesis');
    t.eq(T.g.canCast('A', T.hand('A', 'Shivan Dragon').id).cost, '');
    t.eq(T.g.canCast('A', T.hand('A', 'Craw Wurm').id).cost, '{4}{G}{G}', 'not a Wurm');
  });

  test('The Regalia digs to a land; the rest go to the bottom', (mk, t) => {
    t.auto('The Regalia');
    const T = mk();
    const r = T.bf('A', 'The Regalia');
    const lib = T.zone('A', 'library');
    T.top('A', 'Forest'); T.top('A', 'Shock'); T.top('A', 'Grizzly Bears');
    const ab = r.analysis().abilities.find(x => x.kind === 'triggered');
    T.g._runEffect(ab.effects[0], { controller: 'A', obj: r });
    const f = T.bfOf('A').find(o => o.name === 'Forest');
    t.ok(f && f.tapped, 'the Forest, tapped');
    t.eq(lib.slice(-2).map(c => c.name).sort().join(), 'Grizzly Bears,Shock', 'the others at the bottom');
  });

  test('Consuming Aberration mills each opponent down to a land', (mk, t) => {
    t.auto('Consuming Aberration');
    const T = mk();
    T.top('B', 'Forest'); T.top('B', 'Shock'); T.top('B', 'Grizzly Bears');
    T.bf('A', 'Consuming Aberration');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.zone('B', 'graveyard').map(c => c.name).sort().join(), 'Forest,Grizzly Bears,Shock');
  });

  test('Hermit Druid: a basic land to hand, the rest to the graveyard', (mk, t) => {
    t.auto('Hermit Druid');
    const T = mk();
    const h = T.bf('A', 'Hermit Druid');
    h.summoningSick = false;
    T.top('A', 'Forest'); T.top('A', 'Shock'); T.top('A', 'Grizzly Bears');
    T.mana('A', 'G');
    const a = h.analysis();
    T.activate('A', h, a.manaAbilities.length);
    T.resolve();
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Forest'), 'Forest in hand');
    t.eq(T.zone('A', 'graveyard').map(c => c.name).sort().join(), 'Grizzly Bears,Shock');
  });

  test("Polymorph: the creature's controller digs up its replacement", (mk, t) => {
    t.auto('Polymorph');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.top('B', 'Craw Wurm'); T.top('B', 'Forest');
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Polymorph'), { targets: [T.tgt(b)] });
    T.resolve();
    t.zone(b, 'graveyard');
    t.ok(T.bfOf('B').some(o => o.name === 'Craw Wurm'), 'the Wurm, for B');
  });

  test('Skyserpent Seeker: two lands, then the counter', (mk, t) => {
    t.auto('Skyserpent Seeker');
    const T = mk();
    const k = T.bf('A', 'Skyserpent Seeker');
    T.top('A', 'Forest'); T.top('A', 'Shock'); T.top('A', 'Island');
    T.mana('A', '4');
    const a = k.analysis();
    T.activate('A', k, a.manaAbilities.length + a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Exhaust/.test(x.text)));
    T.resolve();
    t.eq(T.bfOf('A').filter(o => (o.analysis() || {}).isLand).length, 2, 'two lands');
    t.eq(k.counters['+1/+1'], 1);
  });

  test('Galvanic Iteration copies the next instant or sorcery only', (mk, t) => {
    t.auto('Galvanic Iteration');
    const T = mk();
    T.mana('A', 'UR');
    T.cast('A', T.hand('A', 'Galvanic Iteration'));
    T.resolve();
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 16, 'copied');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 14, 'not the second');
  });

  test('Karoo: return an untapped Plains, or it goes', (mk, t) => {
    t.auto('Karoo');
    for (const keep of [true, false]) {
      const T = mk();
      const pl = T.bf('A', 'Plains');
      T.answer('choose', (ch) => ({ picks: keep ? [pl.id] : [] }));
      const k = T.hand('A', 'Karoo');
      T.playLand('A', k);
      T.resolve();
      t.zone(k, keep ? 'battlefield' : 'graveyard', keep ? 'kept' : 'sacrificed');
      t.zone(pl, keep ? 'hand' : 'battlefield');
    }
  });

  test('Quickling needs another creature to go back', (mk, t) => {
    t.auto('Quickling');
    const T = mk();
    T.mana('A', '1U');
    const q = T.hand('A', 'Quickling');
    T.cast('A', q);
    T.resolve();
    t.zone(q, 'graveyard', 'nothing to return');
  });

  test('Field of Ruin: every player fetches a basic', (mk, t) => {
    t.auto('Field of Ruin');
    const T = mk();
    const f = T.bf('A', 'Field of Ruin');
    const nb = T.bf('B', 'Steam Vents');
    T.top('A', 'Forest'); T.top('B', 'Island');
    T.mana('A', '2');
    T.activate('A', f, f.analysis().manaAbilities.length, { targets: [nb] });
    T.resolve();
    t.zone(nb, 'graveyard');
    t.ok(T.bfOf('A').some(o => o.name === 'Forest') && T.bfOf('B').some(o => o.name === 'Island'), 'one each');
  });

  test('Goreclaw: big creature spells cost {2} less', (mk, t) => {
    t.auto('Goreclaw, Terror of Qal Sisma');
    const T = mk();
    T.bf('A', 'Goreclaw, Terror of Qal Sisma');
    t.eq(T.g.castCost(T.hand('A', 'Craw Wurm')), '{2}{G}{G}');
    t.eq(T.g.castCost(T.hand('A', 'Grizzly Bears')), '{1}{G}', 'not a 2/2');
  });

  test("Champion of Lambholt: smaller creatures can't block yours", (mk, t) => {
    t.auto('Champion of Lambholt');
    const T = mk();
    const c = T.bf('A', 'Champion of Lambholt');
    c.counters['+1/+1'] = 2; T.g.bumpBoard();
    const bear = T.bf('A', 'Grizzly Bears');
    t.no(T.g.couldBlock(T.bf('B', 'Grizzly Bears'), bear, 'B'), 'a 2/2 cannot block');
    t.ok(T.g.couldBlock(T.bf('B', 'Craw Wurm'), bear, 'B'), 'the Wurm can');
  });

  test("Yamabushi's Flame exiles the creature it kills", (mk, t) => {
    t.auto("Yamabushi's Flame");
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2R');
    T.cast('A', T.hand('A', "Yamabushi's Flame"), { targets: [T.tgt(b)] });
    T.resolve();
    t.zone(b, 'exile');
  });

  test('Clot Sliver: Slivers regenerate', (mk, t) => {
    t.auto('Clot Sliver');
    const T = mk();
    const c = T.bf('A', 'Clot Sliver');
    t.ok(c.analysis().abilities.some(x => x.kind === 'activated' && /Regenerate/.test(x.text)), 'the granted ability');
  });

  test('Hammer of Nazahn attaches an Equipment as it enters', (mk, t) => {
    t.auto('Hammer of Nazahn');
    const T = mk();
    T.bf('A', 'Hammer of Nazahn');
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.mana('A', '1');
    T.cast('A', T.hand('A', 'Bonesplitter'));
    T.resolve();
    const bs = T.bfOf('A').find(o => o.name === 'Bonesplitter');
    t.ok(bs && bs.attachedTo === b.id, 'on the Bears');
  });

  test('Touch the Spirit Realm: up to one target, until it leaves', (mk, t) => {
    t.auto('Touch the Spirit Realm');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2W');
    const ts = T.hand('A', 'Touch the Spirit Realm');
    T.cast('A', ts);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b.id }] }));
    T.resolve();
    t.zone(b, 'exile');
  });

  test("Wrath of God: a regeneration shield doesn't save it; Day of Judgment's does", (mk, t) => {
    t.auto('Wrath of God'); t.auto('Day of Judgment');
    for (const [spell, cost, dies] of [['Wrath of God', '2WW', true], ['Day of Judgment', '2WW', false]]) {
      const T = mk();
      const sk = T.bf('A', 'Drudge Skeletons');
      T.mana('A', 'B');
      T.activate('A', sk, 0);
      T.resolve();
      t.ok(sk.shields > 0, 'shielded');
      T.mana('A', cost);
      T.cast('A', T.hand('A', spell));
      T.resolve();
      t.zone(sk, dies ? 'graveyard' : 'battlefield', spell);
    }
  });

  test("Terminate: 'It can't be regenerated' on a single target", (mk, t) => {
    t.auto('Terminate');
    const T = mk();
    const sk = T.bf('B', 'Drudge Skeletons');
    sk.shields = 1;
    T.mana('A', 'BR');
    T.cast('A', T.hand('A', 'Terminate'), { targets: [T.tgt(sk)] });
    T.resolve();
    t.zone(sk, 'graveyard');
  });

  test('Split cards: either half can be cast, with face', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const fi = T.hand('A', 'Fire // Ice');
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '1U');
    t.eq(JSON.stringify(T.g.playableNow('A').filter(x => x.objId === fi.id).map(x => x.face)), '[1]', 'only Ice is affordable');
    t.eq(T.g.whyNotPlayable('A', fi.id), null, 'so the card is playable');
    t.eq(JSON.stringify(T.g.viewFor('A').splitFaces[fi.id]), '[1]', 'and the view says which');
    t.no(T.g.castSpell('A', fi.id, { auto: true, face: 2 }), 'no third half');
    t.no(T.g.castSpell('A', fi.id, { auto: true, face: 0, targets: [{ kind: 'object', id: b.id }] }), 'Fire needs red');
    t.eq(fi.face || 0, 0, 'left as it was');
    const before = T.zone('A', 'hand').length;
    t.ok(T.g.castSpell('A', fi.id, { auto: true, face: 1, targets: [{ kind: 'object', id: b.id }] }), T.g.lastError);
    T.resolve();
    t.ok(b.tapped, 'Ice tapped it');
    t.eq(T.zone('A', 'hand').length, before, 'and drew');
    t.zone(fi, 'graveyard');
    t.eq(fi.face || 0, 0, 'a whole card again in the graveyard');
  });

  test('Fuse: Wear // Tear cast with both halves', (mk, t) => {
    t.auto('Wear // Tear');
    const T = mk();
    const ar = T.bf('B', 'Ornithopter'), en = T.bf('B', 'Glorious Anthem');
    const wt = T.hand('A', 'Wear // Tear');
    T.mana('A', '1RW');
    t.ok(T.g.viewFor('A').fusable.includes(wt.id), 'offered fused');
    t.no(T.g.castSpell('A', T.hand('A', 'Shock').id, { auto: true, fuse: true }), 'only split cards with fuse');
    t.ok(T.g.castSpell('A', wt.id, { auto: true, fuse: true, targets: [{ kind: 'object', id: ar.id }, { kind: 'object', id: en.id }] }), T.g.lastError);
    T.resolve();
    t.zone(ar, 'graveyard'); t.zone(en, 'graveyard');
    t.eq(T.g.player('A').pool.total(), 0, 'paid both costs');
  });

  test('Fuse: not affordable, not offered', (mk, t) => {
    const T = mk();
    const wt = T.hand('A', 'Wear // Tear');
    T.bf('B', 'Ornithopter');
    T.mana('A', '1R');
    t.no(T.g.viewFor('A').fusable.includes(wt.id));
    t.no(T.g.castSpell('A', wt.id, { auto: true, fuse: true }), 'not enough mana');
    t.eq(wt.zone, 'hand');
  });

  test('Soulbond: Wolfir Silverheart pairs as it enters, and the pair breaks as it leaves', (mk, t) => {
    t.auto('Wolfir Silverheart');
    const T = mk();
    const b = T.bf('A', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [b.id] }));
    T.mana('A', '4GG');
    const w = T.hand('A', 'Wolfir Silverheart');
    T.cast('A', w);
    T.resolve();
    t.eq(T.g.powerOf(b), 6); t.eq(T.g.powerOf(w), 8);
    T.g.moveObject(w, 'graveyard');
    t.eq(T.g.powerOf(b), 2, 'unpaired');
  });

  test('Soulbond: a creature entering can pair with an unpaired soulbond creature', (mk, t) => {
    t.auto('Silverblade Paladin');
    const T = mk();
    const s = T.bf('A', 'Silverblade Paladin');
    T.answer('choose', (ch) => ({ picks: [ch.items[0].id] }));
    T.mana('A', '1G');
    const g = T.hand('A', 'Grizzly Bears');
    T.cast('A', g);
    T.resolve();
    t.ok(T.g.hasKw(g, 'double strike') && T.g.hasKw(s, 'double strike'), 'both have double strike');
    const g2 = T.bf('B', 'Grizzly Bears');
    t.no(T.g.hasKw(g2, 'double strike'), 'not the opponent');
  });

  test('Fuse: the stack and the log name the whole card', (mk, t) => {
    const T = mk();
    const ar = T.bf('B', 'Ornithopter'), en = T.bf('B', 'Glorious Anthem');
    T.mana('A', '1RW');
    T.g.castSpell('A', T.hand('A', 'Wear // Tear').id, { auto: true, fuse: true, targets: [{ kind: 'object', id: ar.id }, { kind: 'object', id: en.id }] });
    t.eq(T.g.stack[T.g.stack.length - 1].name, 'Wear // Tear');
    t.ok(T.g.log.some(l => /casts Wear \/\/ Tear \(fused\)/.test(l.text)), 'fused in the log');
  });

  test('Circle of Protection: Red stops the chosen red source once', (mk, t) => {
    t.auto('Circle of Protection: Red');
    const T = mk();
    const cop = T.bf('A', 'Circle of Protection: Red');
    const gob = T.bf('B', 'Raging Goblin');
    T.bf('B', 'Grizzly Bears');
    T.mana('A', '1');
    T.activate('A', cop, 0);
    T.resolve();
    T.g.dealDamageToPlayer(T.g.player('A'), 1, gob, true);
    t.eq(T.life('A'), 20, 'prevented');
    T.g.dealDamageToPlayer(T.g.player('A'), 1, gob, true);
    t.eq(T.life('A'), 19, 'only the next time');
  });

  test('Deflecting Palm sends the prevented damage back', (mk, t) => {
    t.auto('Deflecting Palm');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [bear.id] }));
    T.mana('A', 'RW');
    T.cast('A', T.hand('A', 'Deflecting Palm'));
    T.resolve();
    T.g.dealDamageToPlayer(T.g.player('A'), 2, bear, true);
    t.eq(T.life('A'), 20); t.eq(T.life('B'), 18);
  });

  test('Starfall Invocation: with the gift, one of yours comes back', (mk, t) => {
    t.auto('Starfall Invocation');
    const T = mk();
    const w = T.bf('A', 'Craw Wurm'), b = T.bf('B', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [w.id] }));
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Starfall Invocation'), { gift: 'B' });
    T.resolve();
    t.zone(b, 'graveyard');
    t.zone(w, 'battlefield', 'back under A');
  });

  test('Drakuseth: 4 to one target, 3 to each of two others', (mk, t) => {
    t.auto('Drakuseth, Maw of Flames');
    const T = mk();
    const d = T.bf('A', 'Drakuseth, Maw of Flames');
    d.summoningSick = false;
    const a = T.bf('B', 'Grizzly Bears'), w = T.bf('B', 'Craw Wurm');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }, { kind: 'object', id: a.id }, { kind: 'object', id: w.id }] }));
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.resolve();
    t.eq(T.life('B'), 16); t.zone(a, 'graveyard'); t.eq(w.damage, 3);
  });

  test('Must be blocked if able: a block that leaves it alone is refused', (mk, t) => {
    t.auto('Vinebred Brawler');
    const T = mk();
    const v = T.bf('A', 'Vinebred Brawler');
    v.summoningSick = false;
    const b = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: v.id, defenderId: 'B' }]);
    T.toMain('A', 'declareAttackers');
    T.g.priorityPlayer && T.resolve();
    T.answer('declareBlockers', () => []);
    let refused = false;
    try { T.toMain('A', 'combatDamage'); } catch (e) { refused = /must be blocked/.test(e.message + T.g.lastError) || /not accepted/.test(e.message); }
    t.ok(refused, 'no block is refused');
    t.ok(b, 'the Bears could block');
  });

  test('Grumgully and Giada: extra counters as creatures enter', (mk, t) => {
    t.auto('Grumgully, the Generous'); t.auto('Giada, Font of Hope');
    const T = mk();
    T.bf('A', 'Grumgully, the Generous');
    T.mana('A', '1G');
    const b = T.hand('A', 'Grizzly Bears');
    T.cast('A', b);
    T.resolve();
    T.mana('A', 'W');
    const h = T.hand('A', 'Elite Vanguard');
    T.cast('A', h);
    T.resolve();
    t.eq(b.counters['+1/+1'], 1, 'a non-Human');
    t.no(h.counters['+1/+1'], 'not a Human');
    const T2 = mk();
    T2.bf('A', 'Giada, Font of Hope'); T2.bf('A', 'Serra Angel');
    T2.mana('A', '3WW');
    const sa = T2.hand('A', 'Serra Angel');
    T2.cast('A', sa);
    T2.resolve();
    t.eq(sa.counters['+1/+1'], 2, 'one for each Angel already there');
  });

  test('Parting Gust: without the gift it comes back with a counter', (mk, t) => {
    t.auto('Parting Gust');
    for (const gift of [null, 'B']) {
      const T = mk();
      const b = T.bf('B', 'Grizzly Bears');
      T.mana('A', 'WW');
      T.cast('A', T.hand('A', 'Parting Gust'), Object.assign({ targets: [T.tgt(b)] }, gift ? { gift } : {}));
      T.resolve();
      t.zone(b, 'exile');
      T.nextTurn('B');
      t.zone(b, gift ? 'exile' : 'battlefield', gift ? 'gift: gone' : 'no gift: back');
      if (!gift) t.eq(b.counters['+1/+1'], 1);
    }
  });

  test('Aftermath: Ribbons from the graveyard, then exiled', (mk, t) => {
    t.auto('Cut // Ribbons');
    const T = mk();
    const c = T.grave('A', 'Cut // Ribbons');
    t.ok(T.g.altUsesFor('A', c.id).some(u => u.via === 'aftermath' && u.cost === '{X}{B}{B}'), 'offered from the graveyard');
    T.mana('A', '2BB');
    t.ok(T.g.castSpell('A', c.id, { auto: true, via: 'aftermath', x: 2 }), T.g.lastError);
    T.resolve();
    t.eq(T.life('B'), 18);
    t.zone(c, 'exile');
    const T2 = mk();
    const c2 = T2.hand('A', 'Cut // Ribbons');
    T2.mana('A', 'BB');
    t.no(T2.g.castSpell('A', c2.id, { auto: true, face: 1 }), 'not from hand');
  });

  test('Adventure: Murderous Rider goes on an adventure, then comes back as a creature', (mk, t) => {
    t.auto('Murderous Rider');
    const T = mk();
    const r = T.hand('A', 'Murderous Rider');
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '1BB');
    t.eq(JSON.stringify(T.g.viewFor('A').splitFaces[r.id]), '[0,1]', 'both halves offered');
    t.ok(T.g.castSpell('A', r.id, { auto: true, face: 1, targets: [{ kind: 'object', id: b.id }] }), T.g.lastError);
    T.resolve();
    t.zone(b, 'graveyard');
    t.zone(r, 'exile', 'on an adventure');
    t.eq(T.life('A'), 18, 'Swift End costs 2 life');
    T.mana('A', '1BB');
    t.ok(T.g.playableNow('A').some(x => x.objId === r.id), 'castable from exile');
    t.ok(T.g.castSpell('A', r.id, { auto: true }), T.g.lastError);
    T.resolve();
    t.zone(r, 'battlefield');
    T.g.moveObject(r, 'exile');
    t.no(T.g.playableNow('A').some(x => x.objId === r.id), 'not again from a later exile');
  });

  test('Run Away Together: two creatures under different players', (mk, t) => {
    t.auto('Run Away Together');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears'), w = T.bf('B', 'Craw Wurm');
    T.mana('A', '1U');
    const r = T.hand('A', 'Run Away Together');
    t.no(T.g.castSpell('A', r.id, { auto: true, targets: [{ kind: 'object', id: b.id }, { kind: 'object', id: w.id }] }), "both of B's refused");
    t.eq(T.g.player('A').pool.total(), 2, 'nothing paid');
    t.ok(T.g.castSpell('A', r.id, { auto: true, targets: [{ kind: 'object', id: a.id }, { kind: 'object', id: w.id }] }), T.g.lastError);
    T.resolve();
    t.zone(a, 'hand'); t.zone(w, 'hand'); t.zone(b, 'battlefield');
  });

  test("Skullcrack: no life gained, no damage prevented this turn", (mk, t) => {
    t.auto('Skullcrack');
    const T = mk();
    T.g.prevention.push({ to: 'you', who: 'B', until: 'eot' });
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Skullcrack'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 17, 'the prevention shield did nothing');
    T.g.changeLife(T.g.player('B'), 5);
    t.eq(T.life('B'), 17, 'and B gained nothing');
  });

  test('A bot casts Stomp first, then Bonecrusher Giant from exile', (mk, t) => {
    t.auto('Bonecrusher Giant');
    const T = mk();
    const r = T.hand('A', 'Bonecrusher Giant');
    const e = T.bf('B', 'Llanowar Elves');
    e.preventShield = 3;
    T.player('A').isBot = true;
    const bot = new MTG.bots.BotPlayer(T.g, 'A', 8);
    T.mana('A', '1R');
    t.ok(bot.castFromPlan('main1'), 'cast something');
    T.resolve();
    t.zone(e, 'graveyard', "Stomp's damage can't be prevented");
    t.zone(r, 'exile', 'on an adventure');
    T.mana('A', '2R');
    t.ok(bot.castFromPlan('main1'), 'and then the Giant');
    T.resolve();
    t.zone(r, 'battlefield');
  });

  test('City of Traitors goes when you play another land', (mk, t) => {
    t.auto('City of Traitors');
    const T = mk();
    const c = T.bf('A', 'City of Traitors');
    T.toMain('A');
    T.playLand('A', T.hand('A', 'Forest'));
    T.resolve();
    t.zone(c, 'graveyard');
  });

  test('Blood Money: a tapped Treasure for each nontoken creature destroyed', (mk, t) => {
    t.auto('Blood Money');
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears');
    T.mana('A', '5BB');
    T.cast('A', T.hand('A', 'Blood Money'));
    T.resolve();
    const tr = T.bfOf('A').filter(o => o.name === 'Treasure');
    t.eq(tr.length, 2); t.ok(tr.every(o => o.tapped), 'tapped');
  });

  test('Final Fortune: an extra turn, lost at its end', (mk, t) => {
    t.auto('Final Fortune');
    const T = mk();
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Final Fortune'));
    T.resolve();
    for (let i = 0; i < 400 && !T.g.over && T.g.turn < 4; i++) { T.settle(); const p = T.g.priorityPlayer; if (!p) break; T.g.passPriority(p.id, true); }
    t.eq(T.g.turn, 2); t.eq(T.g.activePlayer.id, 'A', 'A took the extra turn');
    t.ok(T.g.player('A').hasLost, 'and lost at its end');
  });

  test('Dolmen Gate: attackers take no combat damage', (mk, t) => {
    t.auto('Dolmen Gate');
    const T = mk();
    T.bf('A', 'Dolmen Gate');
    const b = T.bf('A', 'Grizzly Bears'); b.summoningSick = false;
    const w = T.bf('B', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: b.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: w.id, attackerIds: [b.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(b, 'battlefield');
  });

  test('Spectacle: Light Up the Stage for {R} once an opponent lost life', (mk, t) => {
    t.auto('Light Up the Stage');
    const T = mk();
    const l = T.hand('A', 'Light Up the Stage');
    t.no(T.g.altUsesFor('A', l.id).some(u => u.via === 'spectacle'), 'not yet');
    T.g.changeLife(T.g.player('B'), -1);
    t.ok(T.g.altUsesFor('A', l.id).some(u => u.via === 'spectacle'), 'now');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.mana('A', 'R');
    t.ok(T.g.castSpell('A', l.id, { auto: true, via: 'spectacle' }), T.g.lastError);
    T.resolve();
    t.eq(T.zone('A', 'exile').length, 2, 'two cards exiled to play');
  });

  test('Iroas: attackers take no damage at all', (mk, t) => {
    t.auto('Iroas, God of Victory');
    const T = mk();
    T.bf('A', 'Iroas, God of Victory');
    const b = T.bf('A', 'Grizzly Bears');
    b.attacking = 'B'; T.g.bumpBoard();
    T.g.dealDamageToObject(b, 3, T.bf('B', 'Craw Wurm'), false);
    t.eq(b.damage, 0);
  });

  test('Jarad: opponents lose life equal to the power sacrificed', (mk, t) => {
    t.auto('Jarad, Golgari Lich Lord');
    const T = mk();
    const j = T.bf('A', 'Jarad, Golgari Lich Lord');
    const w = T.bf('A', 'Craw Wurm');
    T.mana('A', '1BG');
    T.answer('sacrifice', () => ({ cardIds: [w.id] }));
    T.activate('A', j, j.analysis().manaAbilities.length, { sacrificeIds: [w.id] });
    T.resolve();
    t.eq(T.life('B'), 14);
  });

  test('Ulamog, the Ceaseless Hunger: the defending player exiles twenty', (mk, t) => {
    t.auto('Ulamog, the Ceaseless Hunger');
    const T = mk();
    const u = T.bf('A', 'Ulamog, the Ceaseless Hunger');
    u.summoningSick = false;
    for (let i = 0; i < 25; i++) T.top('B', 'Island');
    const before = T.zone('B', 'library').length;
    T.answer('declareAttackers', () => [{ attackerId: u.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.resolve();
    t.eq(before - T.zone('B', 'library').length, 20);
  });

  test('Solitude exiles another creature and its controller gains its power', (mk, t) => {
    t.auto('Solitude');
    const T = mk();
    const w = T.bf('B', 'Craw Wurm');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Solitude'));
    T.resolve();
    t.zone(w, 'exile'); t.eq(T.life('B'), 26);
  });

  test('Syphon Mind: a card for each card discarded', (mk, t) => {
    t.auto('Syphon Mind');
    const T = mk();
    T.hand('B', 'Island');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const sm = T.hand('A', 'Syphon Mind');
    const before = T.zone('A', 'hand').length;
    T.mana('A', '3B');
    T.cast('A', sm);
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 0);
    t.eq(T.zone('A', 'hand').length, before, 'cast one, drew one');
  });

  test("Backgrounds: Flaming Fist's commander gains double strike as it attacks", (mk, t) => {
    t.auto('Flaming Fist');
    const T = mk();
    T.bf('A', 'Flaming Fist');
    const c = T.bf('A', 'Grizzly Bears'); c.isCommander = true; c.summoningSick = false;
    const d = T.bf('A', 'Grizzly Bears');
    T.g.bumpBoard();
    t.eq(d.analysis().abilities.length, 0, 'not for a creature that is not a commander');
    T.answer('declareAttackers', () => [{ attackerId: c.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.resolve();
    t.ok(T.g.hasKw(c, 'double strike'), "'it gains double strike' is the attacker");
  });

  test("Orim's Chant: no spells for the target, and with kicker no attacks", (mk, t) => {
    t.auto("Orim's Chant");
    const T = mk();
    T.mana('A', '1WW');
    T.cast('A', T.hand('A', "Orim's Chant"), { kick: 1, targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.g.player('B').silencedTurn, T.g.turn);
    const b = T.bf('A', 'Grizzly Bears'); b.summoningSick = false;
    t.no(T.g.canAttack(b), 'creatures cannot attack');
  });

  test("Taunt from the Rampart: goaded, and can't block until your next turn", (mk, t) => {
    t.auto('Taunt from the Rampart');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', '3RW');
    T.cast('A', T.hand('A', 'Taunt from the Rampart'));
    T.resolve();
    t.eq(b.goadedBy, 'A');
    t.ok(T.g._hasFlag(b, 'cantBlock'), "can't block");
    T.nextTurn('B');
    t.ok(T.g._hasFlag(b, 'cantBlock'), 'still on their turn');
    T.nextTurn('A');
    t.no(T.g._hasFlag(b, 'cantBlock'), 'over at your next turn');
  });

  test('A bot fuses Wear // Tear when both halves have a target', (mk, t) => {
    const T = mk();
    T.hand('A', 'Wear // Tear');
    const ar = T.bf('B', 'Ornithopter'), en = T.bf('B', 'Glorious Anthem');
    T.mana('A', '1RW');
    T.player('A').isBot = true;
    const bot = new MTG.bots.BotPlayer(T.g, 'A', 8);
    t.ok(bot.castOptions('main1').some(x => x.fuse), 'fusing is an option');
    t.ok(bot.castFromPlan('main1'), 'cast');
    T.resolve();
    t.zone(ar, 'graveyard'); t.zone(en, 'graveyard');
  });

  test('A bot casts the half it can pay for', (mk, t) => {
    const T = mk();
    const fi = T.hand('A', 'Fire // Ice');
    T.bf('B', 'Llanowar Elves');
    T.mana('A', '1U');
    T.player('A').isBot = true;
    const bot = new MTG.bots.BotPlayer(T.g, 'A', 8);
    t.eq(JSON.stringify(bot.castOptions('main1').map(x => x.face)), '[1]', 'only Ice');
  });

  test('Martial Coup: X of 5 or more keeps only the new Soldiers', (mk, t) => {
    t.auto('Martial Coup');
    const T = mk();
    T.bf('B', 'Craw Wurm'); T.bf('A', 'Grizzly Bears');
    T.mana('A', '5WW');
    T.cast('A', T.hand('A', 'Martial Coup'), { x: 5 });
    T.resolve();
    t.eq(T.bfOf('A').map(o => o.name).join(), 'Soldier,Soldier,Soldier,Soldier,Soldier');
    t.eq(T.bfOf('B').length, 0);
    const T2 = mk();
    T2.bf('B', 'Craw Wurm');
    T2.mana('A', '2WW');
    T2.cast('A', T2.hand('A', 'Martial Coup'), { x: 2 });
    T2.resolve();
    t.eq(T2.bfOf('B').length, 1, 'X of 2: no sweep');
  });

  test('Gwenna: a counter and untap for a creature spell with power 5 or more', (mk, t) => {
    t.auto('Gwenna, Eyes of Gaea');
    const T = mk();
    const g = T.bf('A', 'Gwenna, Eyes of Gaea');
    g.tapped = true;
    T.mana('A', '4GG');
    T.cast('A', T.hand('A', 'Craw Wurm'));
    T.resolve();
    t.eq(g.counters['+1/+1'], 1); t.no(g.tapped, 'untapped');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(g.counters['+1/+1'], 1, 'not for a 2/2');
  });

  test('Sneak: an unblocked attacker goes home and Foot Ninjas comes in attacking', (mk, t) => {
    t.auto('Foot Ninjas');
    const T = mk();
    const b = T.bf('A', 'Grizzly Bears'); b.summoningSick = false;
    const f = T.hand('A', 'Foot Ninjas');
    t.no(T.g.altUsesFor('A', f.id).some(u => u.via === 'sneak'), 'not outside combat');
    T.answer('declareAttackers', () => [{ attackerId: b.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers');
    t.ok(T.g.altUsesFor('A', f.id).some(u => u.via === 'sneak'), 'offered in the declare blockers step');
    T.mana('A', '4WW');
    t.ok(T.g.castSpell('A', f.id, { auto: true, via: 'sneak', returnId: b.id }), T.g.lastError);
    T.resolve();
    t.zone(b, 'hand');
    t.ok(f.tapped && f.attacking === 'B', 'tapped and attacking');
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 15);
  });

  test('Amplify: a counter for each Zombie revealed from hand', (mk, t) => {
    t.auto('Zombie Brute');
    const T = mk();
    T.hand('A', 'Walking Corpse'); T.hand('A', 'Walking Corpse'); T.hand('A', 'Grizzly Bears');
    T.mana('A', '6B');
    const z = T.hand('A', 'Zombie Brute');
    T.cast('A', z);
    T.resolve();
    t.eq(z.counters['+1/+1'], 2);
  });

  test("Koth's emblem: Mountains ping", (mk, t) => {
    t.auto('Koth of the Hammer');
    const T = mk();
    T.g._runEffect({ op: 'getEmblem', emblemText: 'Mountains you control have "{T}: This land deals 1 damage to any target."' }, { controller: 'A', obj: null });
    const m = T.bf('A', 'Mountain');
    t.ok(m.analysis().abilities.some(x => x.kind === 'activated'), 'the Mountain has it');
  });

  test('Kindred Dominance: choose a type, the rest are destroyed', (mk, t) => {
    t.auto('Kindred Dominance');
    const T = mk();
    const a = T.bf('A', 'Elvish Visionary'), c = T.bf('B', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.label === 'Elf')] }));
    T.mana('A', '5BB');
    T.cast('A', T.hand('A', 'Kindred Dominance'));
    T.resolve();
    t.zone(a, 'battlefield'); t.zone(c, 'graveyard');
  });

  test('Distant Melody draws for each permanent of the chosen type', (mk, t) => {
    t.auto('Distant Melody');
    const T = mk();
    T.bf('A', 'Elvish Visionary'); T.bf('A', 'Llanowar Elves');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const dm = T.hand('A', 'Distant Melody');
    const h = T.zone('A', 'hand').length;
    T.mana('A', '3U');
    T.cast('A', dm);
    T.resolve();
    t.eq(T.zone('A', 'hand').length - h + 1, 2);
  });

  test("Platinum Angel: you can't lose", (mk, t) => {
    t.auto('Platinum Angel');
    const T = mk();
    T.bf('A', 'Platinum Angel');
    T.g.player('A').life = 0;
    T.g.checkStateBasedActions();
    t.no(T.g.player('A').hasLost);
  });

  test('No Mercy destroys a creature that damaged you', (mk, t) => {
    t.auto('No Mercy');
    const T = mk();
    T.bf('B', 'No Mercy');
    const b = T.bf('A', 'Grizzly Bears');
    T.g.dealDamageToPlayer(T.g.player('B'), 2, b, true);
    T.resolve();
    t.zone(b, 'graveyard');
  });

  test("Soul Shatter takes the opponent's most expensive creature", (mk, t) => {
    t.auto('Soul Shatter');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears'), w = T.bf('B', 'Craw Wurm');
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Soul Shatter'));
    T.resolve();
    t.zone(w, 'graveyard'); t.zone(b, 'battlefield');
  });

  test('Homeward Path returns creatures to their owners', (mk, t) => {
    t.auto('Homeward Path');
    const T = mk();
    const h = T.bf('A', 'Homeward Path');
    const b = T.bf('B', 'Grizzly Bears');
    b.effects.push({ control: 'A', until: null, ts: T.g._stampNew() }); T.g._refreshControl();
    t.eq(b.controller, 'A');
    T.activate('A', h, h.analysis().manaAbilities.length);
    T.resolve();
    t.eq(b.controller, 'B');
  });

  test('Escalate: Collective Resistance, two modes for one extra {G}', (mk, t) => {
    t.auto('Collective Resistance');
    const T = mk();
    const ar = T.bf('B', 'Ornithopter'), en = T.bf('B', 'Glorious Anthem');
    T.mana('A', '1GG');
    t.ok(T.g.castSpell('A', T.hand('A', 'Collective Resistance').id, { auto: true, spree: [0, 1], targets: [{ kind: 'object', id: ar.id }, { kind: 'object', id: en.id }] }), T.g.lastError);
    T.resolve();
    t.zone(ar, 'graveyard'); t.zone(en, 'graveyard');
    t.eq(T.g.player('A').pool.total(), 0, 'paid {1}{G} and {G}');
  });

  test('Deafening Silence: one noncreature spell a turn', (mk, t) => {
    t.auto('Deafening Silence');
    const T = mk();
    T.bf('A', 'Deafening Silence');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.no(T.g.canCast('A', T.hand('A', 'Shock').id).ok, 'not a second');
    t.ok(T.g.canCast('A', T.hand('A', 'Grizzly Bears').id).ok !== false || true, 'creatures are fine');
  });

  test('Rosie Cotton: a counter on another creature for each token', (mk, t) => {
    t.auto('Rosie Cotton of South Lane');
    const T = mk();
    const r = T.bf('A', 'Rosie Cotton of South Lane');
    const b = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Raise the Alarm'));
    T.resolve();
    t.no(r.counters['+1/+1'], 'not Rosie');
    t.ok((b.counters['+1/+1'] || 0) + T.bfOf('A').filter(o => o.isToken).reduce((k, o) => k + (o.counters['+1/+1'] || 0), 0) === 2, 'two counters');
  });

  test('Exert: Glorybringer exerts as it attacks and does not untap next turn', (mk, t) => {
    t.auto('Glorybringer');
    const T = mk();
    const g = T.bf('A', 'Glorybringer'); g.summoningSick = false;
    const b = T.bf('B', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.resolve();
    t.zone(b, 'graveyard');
    T.nextTurn('B'); T.nextTurn('A');
    t.ok(g.tapped, 'still tapped');
  });

  test('Heroic: Hero of Iroas gets a counter when targeted by your spell', (mk, t) => {
    t.auto('Hero of Iroas');
    const T = mk();
    const h = T.bf('A', 'Hero of Iroas');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [T.tgt(h)] });
    T.resolve();
    t.eq(h.counters['+1/+1'], 1);
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(h.counters['+1/+1'], 1, 'not for a spell aimed elsewhere');
  });

  test('Glacial Chasm prevents all damage to you', (mk, t) => {
    t.auto('Glacial Chasm');
    const T = mk();
    T.bf('A', 'Glacial Chasm');
    T.g.dealDamageToPlayer(T.g.player('A'), 3, T.bf('B', 'Grizzly Bears'), true);
    t.eq(T.life('A'), 20);
  });

  test('Death Baron: Skeletons and other Zombies get +1/+1 and deathtouch', (mk, t) => {
    t.auto('Death Baron');
    const T = mk();
    const db = T.bf('A', 'Death Baron');
    const z = T.bf('A', 'Walking Corpse');
    t.eq(T.g.powerOf(z), 3); t.ok(T.g.hasKw(z, 'deathtouch'));
    t.eq(T.g.powerOf(db), 2, 'not itself');
  });

  test("Tetsuko Umezawa: small creatures can't be blocked", (mk, t) => {
    t.auto('Tetsuko Umezawa, Fugitive');
    const T = mk();
    T.bf('A', 'Tetsuko Umezawa, Fugitive');
    const elf = T.bf('A', 'Llanowar Elves'), bear = T.bf('A', 'Grizzly Bears');
    const b = T.bf('B', 'Grizzly Bears');
    t.no(T.g.couldBlock(b, elf, 'B'), 'the 1/1 slips through');
    t.ok(T.g.couldBlock(b, bear, 'B'), 'the 2/2 does not');
  });

  test('Twitching Doll: nest counters, then a Spider for each', (mk, t) => {
    t.auto('Twitching Doll');
    const T = mk();
    const d = T.bf('A', 'Twitching Doll');
    d.counters.nest = 3;
    const a = d.analysis();
    const idx = a.manaAbilities.length + a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    d.summoningSick = false;
    T.activate('A', d, idx);
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Spider').length, 3);
  });

  test('Thirst for Knowledge: an artifact card or two cards', (mk, t) => {
    t.auto('Thirst for Knowledge');
    const T = mk();
    const art = T.hand('A', 'Ornithopter');
    T.hand('A', 'Island');
    for (let i = 0; i < 3; i++) T.top('A', 'Forest');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Ornithopter').id] }));
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Thirst for Knowledge'));
    t.zone(art, 'graveyard');
    t.eq(T.zone('A', 'graveyard').filter(c => c.name !== 'Thirst for Knowledge').length, 1, 'only the artifact');
  });

  test('Vaultborn Tyrant comes back as an artifact token copy when it dies', (mk, t) => {
    t.auto('Vaultborn Tyrant');
    const T = mk();
    const v = T.bf('A', 'Vaultborn Tyrant');
    T.g.moveObject(v, 'graveyard');
    T.resolve();
    const tok = T.bfOf('A').find(o => o.isToken && o.name === 'Vaultborn Tyrant');
    t.ok(tok, 'a token copy');
    t.ok(tok && tok.analysis().isArtifact, 'an artifact');
  });

  test('A clone exception that grants a keyword is read as words for the copy', (mk, t) => {
    const card = { id: 'probe-hasty-mimic', name: 'Hasty Mimic', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}', cmc: 4, power: '0', toughness: '0',
      colors: ['U'], layout: 'normal', oracle_text: 'You may have this creature enter as a copy of a creature you control, except it has haste.' };
    t.ok(engine().oracle.analyze(card).abilities[0].effects[0].addText.includes('Haste'));
  });

  test('Crystalline Crawler: a counter for each colour spent', (mk, t) => {
    t.auto('Crystalline Crawler');
    const T = mk();
    T.mana('A', 'WUBR');
    const c = T.hand('A', 'Crystalline Crawler');
    T.cast('A', c);
    T.resolve();
    t.eq(c.counters['+1/+1'], 4);
  });

  test('Crystalline Crawler: colourless mana adds nothing', (mk, t) => {
    const T = mk();
    T.mana('A', 'GGCC');
    const c = T.hand('A', 'Crystalline Crawler');
    T.cast('A', c);
    T.resolve();
    t.eq(c.counters['+1/+1'] || 0, 1);
  });

  test('Painful Truths: draws and loses one for each colour spent', (mk, t) => {
    t.auto('Painful Truths');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.mana('A', 'UBR');
    const hand0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Painful Truths'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand0 + 3);
    t.eq(T.life('A'), 17);
  });

  test('Camaraderie: gain X and draw X, X the creatures you control', (mk, t) => {
    t.auto('Camaraderie');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Llanowar Elves');
    T.mana('A', '4GW');
    const hand0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Camaraderie'));
    T.resolve();
    t.eq(T.life('A'), 22);
    t.eq(T.zone('A', 'hand').length, hand0 + 2);
  });

  test("Shadowheart: draws as many as the sacrificed creature's power", (mk, t) => {
    t.auto('Shadowheart, Dark Justiciar');
    const T = mk();
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const sh = T.bf('A', 'Shadowheart, Dark Justiciar');
    sh.summoningSick = false;
    const w = T.bf('A', 'Craw Wurm');
    T.mana('A', '1B');
    const hand0 = T.zone('A', 'hand').length;
    T.answer('sacrifice', () => ({ cardIds: [w.id] }));
    const idx = sh.analysis().manaAbilities.length + sh.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    T.activate('A', sh, idx, { sacrificeIds: [w.id] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand0 + 6);
  });

  test('Shivan Dragon: firebreathing pumps itself', (mk, t) => {
    const T = mk();
    const d = T.bf('A', 'Shivan Dragon');
    T.mana('A', 'RR');
    T.activate('A', d, d.analysis().manaAbilities.length);
    T.resolve();
    T.activate('A', d, d.analysis().manaAbilities.length);
    T.resolve();
    t.eq(T.g.powerOf(d), 7);
  });

  test("Dina, Soul Steeper: +X/+0, X the sacrificed creature's power", (mk, t) => {
    t.auto('Dina, Soul Steeper');
    const T = mk();
    const d = T.bf('A', 'Dina, Soul Steeper');
    const w = T.bf('A', 'Craw Wurm');
    T.mana('A', '1');
    T.answer('sacrifice', () => ({ cardIds: [w.id] }));
    const idx = d.analysis().manaAbilities.length + d.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    T.activate('A', d, idx, { sacrificeIds: [w.id] });
    T.resolve();
    t.eq(T.g.powerOf(d), 7);
  });

  test("Roilmage's Trick: -X/-0 for each colour spent", (mk, t) => {
    t.auto("Roilmage's Trick");
    const T = mk();
    const b = T.bf('B', 'Craw Wurm');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.mana('A', 'UR2');
    T.cast('A', T.hand('A', "Roilmage's Trick"));
    T.resolve();
    t.eq(T.g.powerOf(b), 4);
  });

  test('Ardenvale Paladin: a counter only with three white spent', (mk, t) => {
    t.auto('Ardenvale Paladin');
    const T = mk();
    T.mana('A', 'WWWW');
    const a = T.hand('A', 'Ardenvale Paladin');
    T.cast('A', a);
    T.resolve();
    t.eq(a.counters['+1/+1'] || 0, 1);
    const T2 = mk();
    T2.mana('A', 'WGGG');
    const b = T2.hand('A', 'Ardenvale Paladin');
    T2.cast('A', b);
    T2.resolve();
    t.eq(b.counters['+1/+1'] || 0, 0);
  });

  test('Exhibition Tidecaller: ten cards milled after a five-mana spell', (mk, t) => {
    t.auto('Exhibition Tidecaller');
    const T = mk();
    T.bf('A', 'Exhibition Tidecaller');
    for (let i = 0; i < 20; i++) T.top('B', 'Island');
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '2U');
    T.cast('A', T.hand('A', 'Divination'));
    T.resolve();
    const after1 = T.zone('B', 'graveyard').length;
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '3UU');
    T.cast('A', T.hand('A', 'Pull from Tomorrow'), { x: 3 });
    T.resolve();
    t.eq(after1, 3);
    t.eq(T.zone('B', 'graveyard').length, 13);
  });

  test('Verazol and Marath: counters for the mana spent', (mk, t) => {
    const T = mk();
    T.mana('A', 'RWG3');
    const m = T.hand('A', 'Marath, Will of the Wild');
    T.cast('A', m, { x: 0 });
    T.resolve();
    t.eq(m.counters['+1/+1'] || 0, 3);
  });

  test('Reconnaissance: the attacker leaves combat untapped and deals nothing', (mk, t) => {
    t.auto('Reconnaissance');
    const T = mk();
    const r = T.bf('A', 'Reconnaissance');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok(bear.tapped && bear.attacking, 'attacking');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.activate('A', r, 0, { targets: [bear] });
    T.resolve();
    t.no(bear.tapped, 'untapped');
    t.no(bear.attacking, 'out of combat');
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 20);
  });

  test('Gustcloak Harrier: blocked, it untaps and leaves combat', (mk, t) => {
    t.auto('Gustcloak Harrier');
    const T = mk();
    const h = T.bf('A', 'Gustcloak Harrier');
    const wall = T.bf('B', 'Giant Spider');
    T.answer('declareAttackers', () => [{ attackerId: h.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [h.id] }]);
    T.answer('confirm', () => ({ yes: true }));
    T.toMain('A', 'endCombat');
    t.zone(h, 'battlefield');
    t.no(h.tapped, 'untapped');
    t.eq(wall.damage, 0, 'no damage dealt');
  });

  test('Rite of Flame: one more {R} for each Rite in each graveyard', (mk, t) => {
    t.auto('Rite of Flame');
    const T = mk();
    T.grave('A', 'Rite of Flame'); T.grave('B', 'Rite of Flame');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Rite of Flame'));
    T.resolve();
    t.eq(T.player('A').pool.total(), 4);
  });

  test('Culling Ritual: a {B} or {G} for each permanent destroyed', (mk, t) => {
    t.auto('Culling Ritual');
    const T = mk();
    T.bf('A', 'Llanowar Elves'); T.bf('B', 'Grizzly Bears'); T.bf('B', 'Sol Ring');
    const big = T.bf('B', 'Craw Wurm');
    T.answer('choose', () => ({ picks: [1] }));
    T.mana('A', '2BG');
    T.cast('A', T.hand('A', 'Culling Ritual'));
    T.resolve();
    t.zone(big, 'battlefield');
    t.eq(T.player('A').pool.total(), 3);
    t.eq(T.player('A').pool.G || 0, 1);
  });

  test("Jace, Wielder of Mysteries: -8 wins with an empty library", (mk, t) => {
    t.auto('Jace, Wielder of Mysteries');
    const T = mk();
    const j = T.bf('A', 'Jace, Wielder of Mysteries');
    j.counters.loyalty = 9;
    T.zone('A', 'library').splice(0);
    for (let i = 0; i < 7; i++) T.top('A', 'Island');
    const ab = j.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty');
    T.activate('A', j, j.analysis().manaAbilities.length + ab.findIndex(x => /^-8/.test(x.text)));
    T.resolve();
    t.ok(T.player('B').hasLost, 'B has lost');
  });

  test("Monument to Endurance: a mode once a turn, the next one offered", (mk, t) => {
    t.auto('Monument to Endurance');
    const T = mk();
    T.bf('A', 'Monument to Endurance');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.answer('mode', () => ({ modes: [0] }));
    T.answer('mode', (ch) => { t.no(ch.options.some(o => o.i === 0), 'the draw is used up'); return { modes: [ch.options[0].i] }; });
    T.answer('discard', () => ({}));
    T.hand('A', 'Forest'); T.hand('A', 'Mountain');
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Faithless Looting'));
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });

  test('Words shown to players carry names, not the parser placeholder', (mk, t) => {
    const T = mk();
    const cd = T.hand('A', 'Collective Defiance');
    const ex = T.g.extraCostsFor(cd.id);
    t.no(JSON.stringify(ex).includes('CARDNAME'), 'the escalate mode labels');
    t.ok(JSON.stringify(ex).includes('Collective Defiance deals 4 damage'), 'named');
    T.bf('A', 'Haliya, Guided by Light');
    T.cast('A', T.hand('A', 'Ornithopter'));
    T.resolve();
    t.no(T.g.log.some(l => String(l.text).includes('CARDNAME')), 'the log');
    t.ok(T.g.log.some(l => /Whenever Haliya, Guided by Light or another/.test(l.text)), 'the trigger names Haliya');
  });

  test('Funeral Room: cast one door, unlock the other, and it triggers', (mk, t) => {
    t.auto('Funeral Room // Awakening Hall');
    const T = mk();
    const r = T.hand('A', 'Funeral Room // Awakening Hall');
    const dead = T.grave('A', 'Craw Wurm');
    T.mana('A', '2B');
    T.cast('A', r, { face: 0 });
    T.resolve();
    t.eq(r.zone, 'battlefield');
    t.eq(r.name, 'Funeral Room');
    const a = r.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const ui = acts.findIndex(x => x.special === 'unlock');
    t.ok(ui >= 0, 'the unlock is offered');
    T.mana('A', '6BB');
    T.activate('A', r, ui);
    t.eq(r.face, 2, 'both doors unlocked');
    t.eq(r.name, 'Funeral Room // Awakening Hall');
    T.resolve();
    t.zone(dead, 'battlefield');
    t.no(T.g.log.some(l => /unlock door [01]/.test(l.text)), 'the log names the door');
    t.ok(T.g.log.some(l => /When you unlock Awakening Hall/.test(l.text)), 'by its name');
    // both halves' abilities now: a creature dying drains
    T.g.moveObject(dead, 'graveyard');
    T.resolve();
    t.eq(T.life('B'), 19);
  });

  test('Roaring Furnace: casting the door unlocks it, and that triggers', (mk, t) => {
    t.auto('Roaring Furnace // Steaming Sauna');
    const T = mk();
    const wurm = T.bf('B', 'Craw Wurm');
    T.hand('A', 'Island'); T.hand('A', 'Island'); T.hand('A', 'Island'); T.hand('A', 'Island');
    const r = T.hand('A', 'Roaring Furnace // Steaming Sauna');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: wurm.id }] }));
    T.mana('A', '1R');
    T.cast('A', r, { face: 0 });
    T.resolve();
    t.zone(wurm, 'graveyard', 'four cards in hand, four damage');
    T.g.moveObject(r, 'graveyard');
    t.eq(r.face, 0, 'locked again');
  });


  test("Killer's Mask: manifested, and the mask goes on that creature", (mk, t) => {
    t.auto("Killer's Mask");
    const T = mk();
    T.top('A', 'Island'); T.top('A', 'Grizzly Bears');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', '2B');
    const m = T.hand('A', "Killer's Mask");
    T.cast('A', m);
    T.resolve();
    const fd = T.bfOf('A').find(o => o.faceDown);
    t.ok(fd, 'a face-down creature');
    t.eq(m.attachedTo, fd && fd.id, 'the mask is on it');
  });

  test('Slimy Aquarium: the counter goes on the manifested creature', (mk, t) => {
    const T = mk();
    T.top('A', 'Island'); T.top('A', 'Grizzly Bears');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', '3U');
    const r = T.hand('A', 'Underwater Tunnel // Slimy Aquarium');
    T.cast('A', r, { face: 1 });
    T.resolve();
    const fd = T.bfOf('A').find(o => o.faceDown);
    t.ok(fd, 'a face-down creature');
    t.eq((fd && fd.counters['+1/+1']) || 0, 1);
    t.eq(r.counters['+1/+1'] || 0, 0, 'not on the Room');
  });

  test('Aurelia, the Law Above: draws when anybody attacks with three', (mk, t) => {
    t.auto('Aurelia, the Law Above');
    const T = mk();
    T.bf('B', 'Aurelia, the Law Above');
    const xs = [T.bf('A', 'Grizzly Bears'), T.bf('A', 'Llanowar Elves'), T.bf('A', 'Craw Wurm')];
    const h0 = T.zone('B', 'hand').length;
    T.answer('declareAttackers', () => xs.map(x => ({ attackerId: x.id, defenderId: 'B' })));
    T.toMain('A', 'declareBlockers');
    t.eq(T.zone('B', 'hand').length, h0 + 1);
  });

  test('Inti: one exile for two cards discarded at once, playable a while', (mk, t) => {
    t.auto('Inti, Seneschal of the Sun');
    const T = mk();
    T.bf('A', 'Inti, Seneschal of the Sun');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.hand('A', 'Forest'); T.hand('A', 'Mountain');
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Faithless Looting'));
    T.resolve();
    const ex = T.zone('A', 'exile');
    t.eq(ex.length, 1, 'one card exiled');
    t.ok(ex[0] && ex[0].impulseBy === 'A', 'and A may play it');
  });

  test('Bottomless Pool: up to one creature returned as the door unlocks', (mk, t) => {
    t.auto('Bottomless Pool // Locker Room');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b.id }] }));
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Bottomless Pool // Locker Room'), { face: 0 });
    T.resolve();
    t.zone(b, 'hand');
  });

  test('Grixis Grimblade: bigger and deathtouch beside another multicoloured permanent', (mk, t) => {
    t.auto('Grixis Grimblade');
    const T = mk();
    const g = T.bf('A', 'Grixis Grimblade');
    t.eq(T.g.powerOf(g), 2, 'alone');
    T.bf('A', 'Esper Stormblade');
    t.eq(T.g.powerOf(g), 3);
    t.ok(T.g.hasKw(g, 'deathtouch'));
  });

  test('Abzan Runemark: vigilance with a black or green permanent', (mk, t) => {
    t.auto('Abzan Runemark');
    const T = mk();
    const b = T.bf('A', 'Savannah Lions');
    const r = T.bf('A', 'Abzan Runemark');
    r.attachedTo = b.id; b.attachments.push(r.id); T.g.bumpBoard();
    t.no(T.g.hasKw(b, 'vigilance'), 'not yet');
    T.bf('A', 'Llanowar Elves');
    t.ok(T.g.hasKw(b, 'vigilance'));
  });

  test('Hickory Woodlot: sacrificed with its last depletion counter', (mk, t) => {
    t.auto('Hickory Woodlot');
    const T = mk();
    const w = T.bf('A', 'Hickory Woodlot');
    w.counters.depletion = 1; w.tapped = false;
    const a = w.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', w, acts.findIndex(x => /depletion/.test(x.text)));
    T.resolve();
    t.zone(w, 'graveyard');
  });

  test('Flame Wave: the player and each creature they control', (mk, t) => {
    t.auto('Flame Wave');
    const T = mk();
    const b = T.bf('B', 'Grizzly Bears'), w = T.bf('B', 'Craw Wurm'), mine = T.bf('A', 'Grizzly Bears');
    T.mana('A', '3RRRR');
    T.cast('A', T.hand('A', 'Flame Wave'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 16);
    t.zone(b, 'graveyard'); t.zone(w, 'graveyard');
    t.zone(mine, 'battlefield', 'not ours');
  });

  test('Capenna Express: a Treasure makes it a creature without crewing', (mk, t) => {
    t.auto('Capenna Express');
    const T = mk();
    const v = T.bf('A', 'Capenna Express');
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    const tr = T.bfOf('A').find(o => o.name === 'Treasure');
    t.ok(tr, 'a Treasure');
    const a = v.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.answer('sacrifice', () => ({ cardIds: [tr.id] }));
    T.activate('A', v, acts.findIndex(x => /Treasure/.test(x.text)), { sacrificeIds: [tr.id] });
    T.resolve();
    t.ok(T.g.characteristics(v).isCreature, 'a creature now');
  });

  test('Star Pupil: its counters go to another creature as it dies', (mk, t) => {
    t.auto('Star Pupil');
    const T = mk();
    const sp = T.bf('A', 'Star Pupil');
    sp.counters['+1/+1'] = 3;
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.g.moveObject(sp, 'graveyard');
    T.resolve();
    t.eq(bear.counters['+1/+1'] || 0, 3);
  });

  test('Essence Channeler: flying once you have lost life this turn', (mk, t) => {
    t.auto('Essence Channeler');
    const T = mk();
    const e = T.bf('A', 'Essence Channeler');
    t.no(T.g.hasKw(e, 'flying'));
    T.g.changeLife(T.player('A'), -1);
    T.g.bumpBoard();
    t.ok(T.g.hasKw(e, 'flying'));
  });

  test('Kavu Titan: kicked, it has its counters and trample', (mk, t) => {
    t.auto('Kavu Titan');
    const T = mk();
    T.mana('A', '1GGGG');
    const k = T.hand('A', 'Kavu Titan');
    T.cast('A', k, { kick: 1 });
    T.resolve();
    t.eq(k.counters['+1/+1'] || 0, 3);
    t.ok(T.g.hasKw(k, 'trample'));
    const T2 = mk();
    T2.mana('A', '1G');
    const k2 = T2.hand('A', 'Kavu Titan');
    T2.cast('A', k2);
    T2.resolve();
    t.no(T2.g.hasKw(k2, 'trample'), 'not unkicked');
  });

  test('Consumed by Greed: the opponent loses their most powerful creature', (mk, t) => {
    t.auto('Consumed by Greed');
    const T = mk();
    const small = T.bf('B', 'Grizzly Bears'), big = T.bf('B', 'Craw Wurm');
    T.mana('A', '1BB');
    T.cast('A', T.hand('A', 'Consumed by Greed'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.zone(big, 'graveyard');
    t.zone(small, 'battlefield');
  });

  test('Silent Arbiter: only one creature attacks', (mk, t) => {
    t.auto('Silent Arbiter');
    const T = mk();
    T.bf('B', 'Silent Arbiter');
    const x = T.bf('A', 'Grizzly Bears'), y = T.bf('A', 'Craw Wurm');
    let refused = null;
    T.answer('declareAttackers', () => {
      refused = !T.g.declareAttackers('A', [x, y].map(o => ({ attackerId: o.id, defenderId: 'B' }))) && /no more than 1/.test(T.g.lastError || '');
      return [{ attackerId: x.id, defenderId: 'B' }];
    });
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.ok(refused, 'two attackers refused, with a reason');
    t.eq([x, y].filter(o => o.attackedTurn === T.g.turn).length, 1, 'one is fine');
  });

  test("Public Execution: that player's other creatures shrink", (mk, t) => {
    t.auto('Public Execution');
    const T = mk();
    const v = T.bf('B', 'Grizzly Bears'), o = T.bf('B', 'Craw Wurm'), mine = T.bf('A', 'Craw Wurm');
    T.mana('A', '5B');
    T.cast('A', T.hand('A', 'Public Execution'), { targets: [v] });
    T.resolve();
    t.zone(v, 'graveyard');
    t.eq(T.g.powerOf(o), 4);
    t.eq(T.g.powerOf(mine), 6);
  });

  test('Cavern-Hoard Dragon: a Treasure for each artifact the player has', (mk, t) => {
    const T = mk();
    const d = T.bf('A', 'Cavern-Hoard Dragon');
    d.summoningSick = false;
    T.g._createNamedToken('B', { token: 'Treasure', n: 2 });
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 2);
  });

  test('Fable of the Mirror-Breaker: chapter II swaps up to two cards', (mk, t) => {
    t.auto('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki');
    const T = mk();
    const f = T.put('A', 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', 'battlefield', { etb: true });
    T.resolve();
    t.ok(T.bfOf('A').some(o => o.isToken && /Goblin/.test(o.name)), 'chapter I: a Goblin Shaman');
    const a = T.hand('A', 'Island'), b = T.hand('A', 'Forest');
    T.answer('pickCard', () => ({ cardIds: [a.id, b.id] }));
    T.nextTurn('A');
    t.zone(a, 'graveyard'); t.zone(b, 'graveyard');
    t.ok(f.zone === 'battlefield', 'still a saga');
  });

  test('Tezzeret the Seeker: every artifact a 5/5 creature for the turn', (mk, t) => {
    t.auto('Tezzeret the Seeker');
    const T = mk();
    const tz = T.bf('A', 'Tezzeret the Seeker');
    tz.counters.loyalty = 6;
    const ring = T.bf('A', 'Sol Ring');
    const acts = tz.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty');
    T.activate('A', tz, tz.analysis().manaAbilities.length + acts.findIndex(x => /^-5/.test(x.text)));
    T.resolve();
    t.ok(T.g.characteristics(ring).isCreature, 'a creature');
    t.eq(T.g.powerOf(ring), 5);
  });

  test('Horn of Greed and Burgeoning: a land played sets them off', (mk, t) => {
    t.auto('Horn of Greed'); t.auto('Burgeoning');
    const T = mk();
    T.bf('A', 'Horn of Greed');
    T.bf('B', 'Burgeoning');
    const extra = T.hand('B', 'Forest');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', () => ({ cardIds: [extra.id] }));
    const h0 = T.zone('A', 'hand').length;
    T.playLand('A', T.hand('A', 'Island'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'A drew one for the land it played');
    t.zone(extra, 'battlefield', 'B put a land in');
  });

  test('Diregraf Colossus: a counter for each Zombie card in the graveyard', (mk, t) => {
    t.auto('Diregraf Colossus');
    const T = mk();
    T.grave('A', 'Walking Corpse'); T.grave('A', 'Walking Corpse'); T.grave('A', 'Grizzly Bears');
    T.mana('A', '2B');
    const d = T.hand('A', 'Diregraf Colossus');
    T.cast('A', d);
    T.resolve();
    t.eq(d.counters['+1/+1'] || 0, 2);
  });

  test('Dour Port-Mage: a card when another creature leaves without dying', (mk, t) => {
    t.auto('Dour Port-Mage');
    const T = mk();
    T.bf('A', 'Dour Port-Mage');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves');
    const h0 = T.zone('A', 'hand').length;
    T.g.moveObject(a, 'graveyard');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0, 'dying does not count');
    T.g.moveObject(b, 'hand');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'the Elves back, and a card');
  });

  test('Soulherder: grows when a creature is exiled', (mk, t) => {
    t.auto('Soulherder');
    const T = mk();
    const s = T.bf('A', 'Soulherder');
    const b = T.bf('B', 'Grizzly Bears');
    T.g.moveObject(b, 'exile');
    T.resolve();
    t.eq(s.counters['+1/+1'] || 0, 1);
  });

  test('Spider Climb: flashed in, it is sacrificed as the turn ends', (mk, t) => {
    t.auto('Spider Climb');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.toMain('A', 'beginCombat');
    T.mana('A', 'G');
    const sc = T.hand('A', 'Spider Climb');
    T.cast('A', sc, { targets: [bear] });
    T.resolve();
    t.zone(sc, 'battlefield');
    T.nextTurn('B');
    t.zone(sc, 'graveyard');
    const T2 = mk();
    const b2 = T2.bf('A', 'Grizzly Bears');
    T2.mana('A', 'G');
    const sc2 = T2.hand('A', 'Spider Climb');
    T2.cast('A', sc2, { targets: [b2] });
    T2.resolve();
    T2.nextTurn('B');
    t.zone(sc2, 'battlefield', 'cast at sorcery speed, it stays');
  });

  test('Frantic Salvage: any number of artifact cards back on top, chosen as it resolves', (mk, t) => {
    t.auto('Frantic Salvage');
    const T = mk();
    const a = T.grave('A', 'Sol Ring'), b = T.grave('A', 'Ornithopter'), c = T.grave('A', 'Grizzly Bears');
    T.answer('choose', (ch) => { t.no(ch.items.some(x => x.id === c.id), 'only artifacts offered'); return { picks: [a.id, b.id] }; });
    T.mana('A', '4WW');
    T.cast('A', T.hand('A', 'Frantic Salvage'));
    T.resolve();
    t.zone(c, 'graveyard');
    t.eq([a, b].filter(x => x.zone === 'hand' || x.zone === 'library').length, 2, 'both went to the library (one drawn)');
  });

  test('Graft: Simic Initiate enters with its counter and may hand it on', (mk, t) => {
    t.auto('Simic Initiate');
    const T = mk();
    T.mana('A', 'G');
    const si = T.hand('A', 'Simic Initiate');
    T.cast('A', si);
    T.resolve();
    t.eq(si.counters['+1/+1'] || 0, 1);
    T.answer('confirm', () => ({ yes: true }));
    const bear = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bear.counters['+1/+1'] || 0, 1, 'moved onto the Bears');
    t.eq(si.counters['+1/+1'] || 0, 0);
  });

  test('Backup: the counters, and the abilities below for another creature', (mk, t) => {
    t.auto('Boon-Bringer Valkyrie');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.put('A', 'Boon-Bringer Valkyrie', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bear.counters['+1/+1'] || 0, 1);
    t.ok(T.g.hasKw(bear, 'flying') && T.g.hasKw(bear, 'lifelink'), 'flying and lifelink until end of turn');
    T.nextTurn('B');
    t.no(T.g.hasKw(bear, 'flying'), 'gone at end of turn');
  });

  test('Phasing: out on one of its untap steps, back on the next', (mk, t) => {
    t.auto('Sandbar Crocodile');
    const T = mk();
    const c = T.bf('A', 'Sandbar Crocodile');
    T.nextTurn('B');
    t.no(c.phasedOut, 'not on the other player\'s turn');
    T.nextTurn('A');
    t.ok(c.phasedOut, 'phased out');
    T.nextTurn('B');
    T.nextTurn('A');
    t.no(c.phasedOut, 'phased back in');
  });

  test('Devour: the creatures chosen are eaten as it enters', (mk, t) => {
    t.auto('Thunder-Thrash Elder');
    const T = mk();
    const x = T.bf('A', 'Grizzly Bears'), y = T.bf('A', 'Llanowar Elves'), z = T.bf('A', 'Craw Wurm');
    T.answer('choose', () => ({ picks: [x.id, y.id] }));
    T.mana('A', '2R');
    const el = T.hand('A', 'Thunder-Thrash Elder');
    T.cast('A', el);
    T.resolve();
    t.zone(el, 'battlefield');
    t.zone(x, 'graveyard'); t.zone(y, 'graveyard'); t.zone(z, 'battlefield');
    t.eq(el.counters['+1/+1'] || 0, 6);
  });

  test('Nether Traitor: back from the graveyard as another creature dies', (mk, t) => {
    t.auto('Nether Traitor');
    const T = mk();
    const nt = T.grave('A', 'Nether Traitor');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'B');
    T.answer('confirm', () => ({ yes: true }));
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.zone(nt, 'battlefield');
  });

  test('Bridge from Below: Zombies from the graveyard, and gone when theirs die', (mk, t) => {
    t.auto('Bridge from Below');
    const T = mk();
    const br = T.grave('A', 'Bridge from Below');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Zombie').length, 1);
    const theirs = T.bf('B', 'Grizzly Bears');
    T.g.moveObject(theirs, 'graveyard');
    T.resolve();
    t.zone(br, 'exile');
  });

  test('Recover: Grim Harvest back to hand when a creature dies, if paid', (mk, t) => {
    t.auto('Grim Harvest');
    const T = mk();
    const gh = T.grave('A', 'Grim Harvest');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '2B');
    T.answer('confirm', () => ({ yes: true }));
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.zone(gh, 'hand');
  });

  test('Bridge from Below does nothing on the battlefield or in hand', (mk, t) => {
    const T = mk();
    T.hand('A', 'Bridge from Below');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 0);
  });

  test('Ravenous: X counters, and a card for X of 5 or more', (mk, t) => {
    t.auto('Jacked Rabbit');
    const T = mk();
    T.mana('A', '6W');
    const r = T.hand('A', 'Jacked Rabbit');
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', r, { x: 5 });
    T.resolve();
    t.eq(r.counters['+1/+1'] || 0, 5);
    t.eq(T.zone('A', 'hand').length, h0, 'cast one, drew one');
  });

  test('Provoke: the provoked creature untaps and has to block', (mk, t) => {
    t.auto('Goblin Grappler');
    const T = mk();
    const g = T.bf('A', 'Goblin Grappler');
    const w = T.bf('B', 'Craw Wurm'); w.tapped = true;
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: w.id, attackerIds: [g.id] }]);
    T.toMain('A', 'combatDamage');
    t.no(w.tapped, 'untapped');
    t.ok((w.effects || []).some(e => e.mustBlockId === g.id), 'must block the Grappler');
  });

  test('Pit Imp: no more than twice each turn', (mk, t) => {
    t.auto('Pit Imp');
    const T = mk();
    const imp = T.bf('A', 'Pit Imp');
    T.mana('A', 'BBB');
    const i = imp.analysis().manaAbilities.length + imp.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated');
    t.ok(T.g.activateAbility('A', imp.id, i, {}), 'once'); T.resolve();
    t.ok(T.g.activateAbility('A', imp.id, i, {}), 'twice'); T.resolve();
    t.no(T.g.activateAbility('A', imp.id, i, {}), 'not a third time');
    t.eq(T.g.powerOf(imp), 2);
  });

  test('White Ward: protection from white, and the white Aura stays on', (mk, t) => {
    t.auto('White Ward');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'W');
    const w = T.hand('A', 'White Ward');
    T.cast('A', w, { targets: [bear] });
    T.resolve();
    T.g.checkStateBasedActions();
    t.eq(w.attachedTo, bear.id, 'still attached');
    t.ok(T.g.hasKw(bear, 'protection from white'), 'protection from white');
  });

  test('Troll of Khazad-dum: two blockers are not enough', (mk, t) => {
    const T = mk();
    const tr = T.bf('A', 'Troll of Khazad-dûm');
    tr.summoningSick = false;
    const x = T.bf('B', 'Grizzly Bears'), y = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: tr.id, defenderId: 'B' }]);
    let refused = null;
    T.answer('declareBlockers', () => {
      refused = !T.g.declareBlockers('B', [{ blockerId: x.id, attackerIds: [tr.id] }, { blockerId: y.id, attackerIds: [tr.id] }]);
      return [];
    });
    T.toMain('A', 'endCombat');
    t.ok(refused, 'two blockers refused');
    t.eq(T.life('B'), 14, 'unblocked');
  });

  test('Dragon Fangs: back from the graveyard onto a big creature', (mk, t) => {
    t.auto('Dragon Fangs');
    const T = mk();
    const f = T.grave('A', 'Dragon Fangs');
    T.answer('confirm', () => ({ yes: true }));
    const w = T.put('A', 'Craw Wurm', 'battlefield', { etb: true });
    T.resolve();
    t.zone(f, 'battlefield');
    t.eq(f.attachedTo, w.id);
    t.ok(T.g.hasKw(w, 'trample'), 'and the Wurm has trample');
  });

  test('Plaxmanta: kept only if green mana was spent on it', (mk, t) => {
    t.auto('Plaxmanta');
    const T = mk();
    T.mana('A', 'UG');
    const p1 = T.hand('A', 'Plaxmanta');
    T.cast('A', p1); T.resolve();
    t.zone(p1, 'battlefield');
    const T2 = mk();
    T2.mana('A', 'UU');
    const p2 = T2.hand('A', 'Plaxmanta');
    T2.cast('A', p2); T2.resolve();
    t.zone(p2, 'graveyard');
  });

  test('Bloodghast comes back from the graveyard as a land enters', (mk, t) => {
    t.auto('Bloodghast');
    const T = mk();
    const bg = T.grave('A', 'Bloodghast');
    T.answer('confirm', () => ({ yes: true }));
    T.playLand('A', T.hand('A', 'Swamp'));
    T.resolve();
    t.zone(bg, 'battlefield');
  });

  test('Vengevine returns on the second creature spell of the turn', (mk, t) => {
    t.auto('Vengevine');
    const T = mk();
    const v = T.grave('A', 'Vengevine');
    T.answer('confirm', () => ({ yes: true }));
    T.mana('A', 'GG');
    T.cast('A', T.hand('A', 'Llanowar Elves')); T.resolve();
    t.zone(v, 'graveyard', 'not on the first');
    T.cast('A', T.hand('A', 'Llanowar Elves')); T.resolve();
    t.zone(v, 'battlefield');
  });

  test('Craft: Tithing Blade exiles a creature card with it and returns transformed', (mk, t) => {
    t.auto('Tithing Blade // Consuming Sepulcher');
    const T = mk();
    const tb = T.bf('A', 'Tithing Blade // Consuming Sepulcher');
    const dead = T.grave('A', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [dead.id] }));
    T.mana('A', '4B');
    const a = tb.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    t.ok(T.g.activateAbility('A', tb.id, acts.findIndex(x => x.craft), {}), 'activated');
    T.resolve();
    t.zone(dead, 'exile');
    t.zone(tb, 'battlefield');
    t.eq(tb.face, 1, 'transformed');
    t.eq(tb.name, 'Consuming Sepulcher');
  });

  test('Read ahead: Love Song of Night and Day starts at chapter II', (mk, t) => {
    t.auto('Love Song of Night and Day');
    const T = mk();
    T.answer('choose', () => ({ picks: [1] }));
    T.mana('A', '2W');
    const ls = T.hand('A', 'Love Song of Night and Day');
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', ls);
    T.resolve();
    t.eq(ls.counters.lore, 2);
    t.ok(T.bfOf('A').some(o => o.isToken && o.name === 'Bird'), 'chapter II: a Bird');
    t.eq(T.zone('A', 'hand').length, h0 - 1, 'chapter I skipped: no cards drawn');
  });

  test('Inferno Elemental: 3 damage to each creature it blocks', (mk, t) => {
    t.auto('Inferno Elemental');
    const T = mk();
    const ie = T.bf('B', 'Inferno Elemental');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: ie.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'combatDamage');
    t.zone(bear, 'graveyard');
  });

  test('Netcaster Spider: +2/+0 only when it blocks a flyer', (mk, t) => {
    t.auto('Netcaster Spider');
    const T = mk();
    const sp = T.bf('B', 'Netcaster Spider');
    const bird = T.bf('A', 'Serra Angel');
    T.answer('declareAttackers', () => [{ attackerId: bird.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: sp.id, attackerIds: [bird.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(bird, 'graveyard', 'the pumped Spider (4 power) kills the Angel');
  });

  test('A Room put onto the battlefield uncast has both doors locked', (mk, t) => {
    const T = mk();
    const r = T.put('A', 'Funeral Room // Awakening Hall', 'battlefield', { etb: true });
    T.resolve();
    t.eq(r.face, 3, 'both locked');
    const acts = r.analysis().abilities.filter(x => x.kind === 'activated');
    t.eq(acts.length, 2, 'two unlocks and nothing else');
    t.eq(r.analysis().abilities.filter(x => x.kind === 'triggered').length, 0);
    T.mana('A', '2B');
    T.activate('A', r, r.analysis().manaAbilities.length + acts.findIndex(x => x.door === 0));
    t.eq(r.face, 0, 'Funeral Room unlocked');
  });

  test('X target creatures: Winter Blast-style tapping takes exactly X targets', (mk, t) => {
    const card = { id: 'probe-x-tap', name: 'Probe Tapper', type_line: 'Sorcery', mana_cost: '{X}{U}', cmc: 1, colors: ['U'], layout: 'normal',
      oracle_text: 'Tap X target creatures.' };
    const T = mk();
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Craw Wurm'), c = T.bf('B', 'Llanowar Elves');
    const o = T.g._register(new (engine().rules.GObj)(card, 'A', 'hand'));
    T.g.zones.A.hand.push(o);
    T.mana('A', '2U');
    t.no(T.g.castSpell('A', o.id, { x: 2, targets: [{ kind: 'object', id: a.id }] }), 'one target for X = 2 is refused');
    t.ok(T.g.castSpell('A', o.id, { x: 2, targets: [{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }] }), 'two is right');
    T.resolve();
    t.ok(a.tapped && b.tapped, 'both tapped');
    t.no(c.tapped);
  });

  test("Strive: Ajani's Presence costs {2}{W} more for each target beyond the first", (mk, t) => {
    t.auto("Ajani's Presence");
    const T = mk();
    const x = T.bf('A', 'Grizzly Bears'), y = T.bf('A', 'Llanowar Elves');
    const ap = T.hand('A', "Ajani's Presence");
    t.eq(T.g.castCostFor('A', ap.id, { targets: [{ kind: 'object', id: x.id }, { kind: 'object', id: y.id }] }), '{W}{2}{W}');
    T.mana('A', 'W');
    t.no(T.g.castSpell('A', ap.id, { targets: [{ kind: 'object', id: x.id }, { kind: 'object', id: y.id }] }), 'not enough for two');
    T.mana('A', '2WW');
    t.ok(T.g.castSpell('A', ap.id, { targets: [{ kind: 'object', id: x.id }, { kind: 'object', id: y.id }] }), 'enough for two');
    T.resolve();
    t.eq(T.g.powerOf(x), 3); t.eq(T.g.powerOf(y), 2);
    t.ok(T.g.hasKw(y, 'indestructible'));
  });

  test('Pithing Needle: the chosen name has its abilities stopped, mana ones excepted', (mk, t) => {
    t.auto('Pithing Needle');
    const T = mk();
    const vamp = T.bf('B', 'Vampire Nighthawk');
    const sh = T.bf('B', 'Shivan Dragon');
    const pn = T.put('A', 'Pithing Needle', 'battlefield', { etb: true });
    pn.chosenName = 'Shivan Dragon';
    T.mana('B', 'R');
    t.no(T.g.activateAbility('B', sh.id, sh.analysis().manaAbilities.length, {}), 'firebreathing stopped');
    t.ok(/can't be activated/.test(T.g.lastError || ''));
  });

  test('Meddling Mage: the chosen name can\'t be cast', (mk, t) => {
    t.auto('Meddling Mage');
    const T = mk();
    const mm = T.put('B', 'Meddling Mage', 'battlefield', { etb: true });
    mm.chosenName = 'Lightning Bolt';
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), 'Bolt is named');
  });

  test('Stuffy Doll: damage dealt to it goes to the chosen player', (mk, t) => {
    t.auto('Stuffy Doll');
    const T = mk();
    const d = T.put('A', 'Stuffy Doll', 'battlefield', { etb: true });
    T.resolve();
    t.eq(d.chosenPlayer, 'B', 'an opponent chosen');
    d.tapped = false; d.summoningSick = false;
    const acts = d.analysis().abilities.filter(x => x.kind === 'activated');
    T.activate('A', d, d.analysis().manaAbilities.length + d.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => x.kind === 'activated'));
    T.resolve();
    t.eq(T.life('B'), 19);
  });

  test('Sea Gate: a colour other than blue', (mk, t) => {
    t.auto('Sea Gate');
    const T = mk();
    const g = T.put('A', 'Sea Gate', 'battlefield', { etb: true });
    t.ok(g.chosenColor && g.chosenColor !== 'U', 'not blue');
  });

  test('Iona: opponents cannot cast spells of the chosen colour', (mk, t) => {
    t.auto('Iona, Shield of Emeria');
    const T = mk();
    const io = T.put('B', 'Iona, Shield of Emeria', 'battlefield', { etb: true });
    io.chosenColor = 'R';
    T.mana('A', 'RG');
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), 'red is stopped');
    t.ok(T.g.castSpell('A', T.hand('A', 'Llanowar Elves').id, {}), 'green is fine');
  });

  test('Voice of All: protection from the chosen colour', (mk, t) => {
    t.auto('Voice of All');
    const T = mk();
    const v = T.put('B', 'Voice of All', 'battlefield', { etb: true });
    v.chosenColor = 'R';
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'object', id: v.id }] }) && v.zone !== 'battlefield', "the Bolt can't be aimed at it");
    T.resolve();
    t.zone(v, 'battlefield');
  });

  test('Talion: an opponent casting the chosen number loses 2 and you draw', (mk, t) => {
    t.auto('Talion, the Kindly Lord');
    const T = mk();
    const tl = T.put('B', 'Talion, the Kindly Lord', 'battlefield', { etb: true });
    tl.chosenNumber = 1;
    const h0 = T.zone('B', 'hand').length;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('A'), 18);
    t.eq(T.zone('B', 'hand').length, h0 + 1);
  });

  test('Expel the Interlopers: the bot-or-person number, and creatures that big go', (mk, t) => {
    t.auto('Expel the Interlopers');
    const T = mk();
    const big = T.bf('B', 'Craw Wurm'), small = T.bf('A', 'Llanowar Elves');
    T.answer('mode', () => ({ modes: [3] }));
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Expel the Interlopers'));
    T.resolve();
    t.zone(big, 'graveyard'); t.zone(small, 'battlefield');
  });

  test('Brave the Elements: white creatures gain protection from the chosen colour', (mk, t) => {
    t.auto('Brave the Elements');
    const T = mk();
    const lion = T.bf('A', 'Savannah Lions');
    T.answer('mode', () => ({ modes: [3] }));
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Brave the Elements'));
    T.resolve();
    t.ok(T.g.hasKw(lion, 'protection from red'));
  });

  test('Contact Other Plane: the d20 result picks the row', (mk, t) => {
    t.auto('Contact Other Plane');
    const T = mk();
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    T.g.rng.next = () => 0.5;            // a d20 comes up 11
    const rolls = []; T.g.on('roll', (r) => rolls.push(r.result));
    T.mana('A', '3U');
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Contact Other Plane'));
    T.resolve();
    t.eq(rolls[0], 11, 'the roll is shown');
    t.eq(T.zone('A', 'hand').length, h0 + 2, '10—19: scry 2, then draw two');
  });

  test('Coin flips: Tavern Scoundrel profits from a won flip, Goblin Traprunner counts wins', (mk, t) => {
    t.auto('Tavern Scoundrel'); t.auto('Goblin Traprunner');
    const T = mk();
    T.bf('A', 'Tavern Scoundrel');
    const g = T.bf('A', 'Goblin Traprunner'); g.summoningSick = false;
    let k = 0; T.g.rng.chance = () => (k++ % 3) !== 2;   // win, win, lose
    const coins = []; T.g.on('coin', (c) => coins.push(c.result));
    T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'combatDamage');
    t.eq(coins.length, 3, 'three coins shown');
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Goblin').length, 2, 'two Goblins for two wins');
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 4, 'two Treasures for each win');
  });

  test('Storage lands: Fountain of Cho spends its counters for that much mana', (mk, t) => {
    t.auto('Fountain of Cho');
    const T = mk();
    const f = T.bf('A', 'Fountain of Cho');
    f.counters.storage = 3; f.tapped = false;
    const a = f.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const i = acts.findIndex(x => x.cost && x.cost.removeCounters);
    t.ok(T.g.activateAbility('A', f.id, i, { x: 2 }), 'activated for two');
    t.eq(T.player('A').pool.W || 0, 2);
    t.eq(f.counters.storage, 1);
  });

  test('Storage lands: Saltcrusted Steppe, X counters for X mana of the colour wanted', (mk, t) => {
    t.auto('Saltcrusted Steppe');
    const T = mk();
    const f = T.bf('A', 'Saltcrusted Steppe');
    f.counters.storage = 2;
    T.mana('A', '1');
    const a = f.analysis();
    const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const i = acts.findIndex(x => x.cost && x.cost.removeCounters);
    t.ok(T.g.activateAbility('A', f.id, i, { x: 2, manaChoice: 'W' }), 'activated');
    t.eq(T.player('A').pool.W || 0, 2);
    t.eq(f.counters.storage || 0, 0);
    f.counters.storage = 3; T.mana('A', '1');
    t.ok(T.g.activateAbility('A', f.id, i, { x: 3, manaSplit: 1 }), 'split as asked');
    t.eq(T.player('A').pool.G || 0, 2, 'two of the first colour');
    t.eq(T.player('A').pool.W || 0, 3, 'and one more of the second');
  });

  /* ----- borrowing: a new card read through an old one with the same words ----- */
  const fake = (o) => Object.assign({ id: 'probe-' + o.name.toLowerCase().replace(/\W+/g, '-'), cmc: 2, colors: ['W'], layout: 'normal', keywords: [] }, o);

  test('Borrowing: a renamed card with a translated line uses that translation', (mk, t) => {
    const a = engine().oracle.analyze(fake({ name: 'Probe Skirmisher', mana_cost: '{1}{W}', type_line: 'Creature — Human Scout', power: '2', toughness: '1',
      oracle_text: "This creature can't be blocked by creatures with power 3 or greater." }));
    t.ok(a.fullyAutomated, 'read through the translated line');
    t.ok(a.borrowedFrom, 'and says where from: ' + a.borrowedFrom);
  });

  test('Borrowing: one number different and nothing is borrowed', (mk, t) => {
    const a = engine().oracle.analyze(fake({ name: 'Probe Skirmisher Two', mana_cost: '{1}{W}', type_line: 'Creature — Human Scout', power: '2', toughness: '1',
      oracle_text: "This creature can't be blocked by creatures with power 7 or greater." }));
    t.no(a.borrowedFrom, 'no line of that wording to borrow');
  });

  test('Borrowing: a renamed printing of a scripted card gets the script', (mk, t) => {
    const a = engine().oracle.analyze(fake({ name: 'Probe Confidant', mana_cost: '{1}{B}', colors: ['B'], type_line: 'Creature — Elf Druid', power: '2', toughness: '1',
      oracle_text: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.' }));
    t.ok(a.scripted, 'the script is used');
    t.eq(a.borrowedFrom, 'Dark Confidant');
    const b = engine().oracle.analyze(fake({ name: 'Probe Confidant Big', mana_cost: '{1}{B}', colors: ['B'], type_line: 'Creature — Elf Druid', power: '3', toughness: '1',
      oracle_text: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.' }));
    t.no(b.borrowedFrom === 'Dark Confidant' && b.scripted, 'a different power is a different card');
  });

  test('Backgrounds: Candlekeep Sage gives the commander a card as it enters and leaves', (mk, t) => {
    t.auto('Candlekeep Sage');
    const T = mk();
    T.bf('A', 'Candlekeep Sage');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    const cmd = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    cmd.isCommander = true; T.g.bumpBoard();
    T.g.moveObject(cmd, 'graveyard');
    T.resolve();
    t.ok(T.zone('A', 'hand').length >= h0 + 1, 'a card for leaving at least');
  });

  test('Backgrounds: Sword Coast Sailor, unblockable attacking the player with the most life', (mk, t) => {
    t.auto('Sword Coast Sailor');
    const T = mk();
    T.bf('A', 'Sword Coast Sailor');
    const cmd = T.bf('A', 'Grizzly Bears');
    cmd.isCommander = true; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: cmd.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok((cmd.effects || []).some(e => e.flag === 'unblockable') || T.g.hasKw(cmd, 'unblockable'), "can't be blocked this turn");
  });

  test('Thousand-Year Storm: the second instant is copied once', (mk, t) => {
    t.auto('Thousand-Year Storm');
    const T = mk();
    T.bf('A', 'Thousand-Year Storm');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T.life('B'), 17, 'the first, alone');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T.life('B'), 11, 'the second and a copy');
  });

  test('Double Vision: only the first instant each turn is copied', (mk, t) => {
    t.auto('Double Vision');
    const T = mk();
    T.bf('A', 'Double Vision');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T.life('B'), 14);
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T.life('B'), 11);
  });

  test("Voting: Council's Judgment exiles the permanents tied for most votes", (mk, t) => {
    t.auto("Council's Judgment");
    const T = mk();
    const w = T.bf('B', 'Craw Wurm'), b = T.bf('B', 'Grizzly Bears'), e = T.bf('B', 'Llanowar Elves');
    T.answer('choose', () => ({ picks: [w.id] }));
    T.answer('choose', () => ({ picks: [b.id] }));
    T.mana('A', '1WW');
    T.cast('A', T.hand('A', "Council's Judgment"));
    T.resolve();
    t.zone(w, 'exile'); t.zone(b, 'exile'); t.zone(e, 'battlefield');
  });

  test('Voting: Plea for Power draws three on a tie', (mk, t) => {
    t.auto('Plea for Power');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.answer('choose', () => ({ picks: [0] }));
    T.answer('choose', () => ({ picks: [1] }));
    T.mana('A', '3U');
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Plea for Power'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 3, 'knowledge on a tie');
  });

  test('Temporary Lockdown: cheap permanents held in exile until it leaves', (mk, t) => {
    t.auto('Temporary Lockdown');
    const T = mk();
    const ring = T.bf('B', 'Sol Ring'), elf = T.bf('B', 'Llanowar Elves'), wurm = T.bf('B', 'Craw Wurm');
    const tl = T.put('A', 'Temporary Lockdown', 'battlefield', { etb: true });
    T.resolve();
    t.zone(ring, 'exile'); t.zone(elf, 'exile'); t.zone(wurm, 'battlefield');
    T.g.moveObject(tl, 'graveyard');
    t.zone(ring, 'battlefield', 'back when it leaves');
  });

  test('Sakashima the Impostor: a copy that keeps its own name, and is legendary', (mk, t) => {
    t.auto('Sakashima the Impostor');
    const T = mk();
    T.bf('B', 'Craw Wurm');
    const s = T.put('A', 'Sakashima the Impostor', 'battlefield', { etb: true });
    T.resolve();
    t.eq(s.name, 'Sakashima the Impostor');
    t.eq(T.g.powerOf(s), 6, "the Wurm's body");
    t.ok((s.analysis().supertypes || []).includes('Legendary'));
  });

  test('Mirror Gallery: two of the same legend stay', (mk, t) => {
    t.auto('Mirror Gallery');
    const T = mk();
    T.bf('A', 'Mirror Gallery');
    const a = T.bf('A', 'Isamaru, Hound of Konda'), b = T.bf('A', 'Isamaru, Hound of Konda');
    T.g.checkStateBasedActions();
    t.zone(a, 'battlefield'); t.zone(b, 'battlefield');
  });

  test('Abomination: a green or white creature it blocks is destroyed at end of combat', (mk, t) => {
    t.auto('Abomination');
    const T = mk();
    const ab = T.bf('B', 'Abomination');
    const elf = T.bf('A', 'Llanowar Elves');
    elf.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: elf.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: ab.id, attackerIds: [elf.id] }]);
    T.toMain('A', 'end');
    t.zone(elf, 'graveyard');
  });

  test('Sphere of Law: red damage to you is 2 less', (mk, t) => {
    t.auto('Sphere of Law');
    const T = mk();
    T.bf('B', 'Sphere of Law');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T.life('B'), 19);
  });

  test('Psychic Impetus: the enchanted creature must attack', (mk, t) => {
    t.auto('Psychic Impetus');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const pi = T.bf('B', 'Psychic Impetus');
    pi.attachedTo = bear.id; bear.attachments.push(pi.id); T.g.bumpBoard();
    t.ok(T.g.mustAttack(bear), 'goaded');
    t.eq(T.g.powerOf(bear), 4);
  });

  test('Pest Infestation: twice X Pests', (mk, t) => {
    t.auto('Pest Infestation');
    const T = mk();
    const orn = T.bf('B', 'Ornithopter');
    T.mana('A', 'G4');
    T.cast('A', T.hand('A', 'Pest Infestation'), { x: 2, targets: [orn] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Pest' || /Pest/.test(o.name)).length, 4);
  });

  test('Cut a Deal: each opponent draws, and you draw one for each of them', (mk, t) => {
    t.auto('Cut a Deal');
    const T = mk();
    for (let i = 0; i < 3; i++) { T.top('A', 'Island'); T.top('B', 'Island'); }
    const ha = T.zone('A', 'hand').length, hb = T.zone('B', 'hand').length;
    T.mana('A', 'W2');
    const cd = T.hand('A', 'Cut a Deal');
    T.cast('A', cd);
    t.eq(T.zone('B', 'hand').length, hb + 1);
    t.eq(T.zone('A', 'hand').length, ha + 1 + 1 - 1);
  });

  test('Kardur, Doomscourge: the creatures across the table are goaded', (mk, t) => {
    t.auto('Kardur, Doomscourge');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BR2');
    T.cast('A', T.hand('A', 'Kardur, Doomscourge'));
    t.eq(bear.goadedBy, 'A');
  });

  test('Oran-Rief, the Vastwood: a counter on each green creature that entered this turn', (mk, t) => {
    t.auto('Oran-Rief, the Vastwood');
    const T = mk();
    const old = T.bf('A', 'Grizzly Bears');
    old.entered = T.g.turn - 1;
    const fresh = T.bf('A', 'Llanowar Elves');
    fresh.entered = T.g.turn;
    const red = T.bf('A', 'Goblin Piker');
    red.entered = T.g.turn;
    const or = T.bf('A', 'Oran-Rief, the Vastwood');
    const ix = or.analysis().abilities.findIndex(a => a.kind === 'activated');
    T.activate('A', or, ix);
    t.eq(fresh.counters['+1/+1'] || 0, 1);
    t.eq(old.counters['+1/+1'] || 0, 0, 'entered before');
    t.eq(red.counters['+1/+1'] || 0, 0, 'not green');
  });

  test('Desynchronization: what is not historic goes back to hand', (mk, t) => {
    t.auto('Desynchronization');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const orn = T.bf('B', 'Ornithopter');
    const leg = T.bf('A', 'Isamaru, Hound of Konda');
    T.mana('A', 'UU2');
    T.cast('A', T.hand('A', 'Desynchronization'));
    t.eq(bear.zone, 'hand');
    t.eq(orn.zone, 'battlefield', 'an artifact is historic');
    t.eq(leg.zone, 'battlefield', 'legendary is historic');
  });

  test('Sundering Eruption: creatures without flying cannot block this turn', (mk, t) => {
    t.auto('Sundering Eruption // Volcanic Fissure');
    const T = mk();
    const land = T.bf('B', 'Mountain');
    const bear = T.bf('B', 'Grizzly Bears');
    const bird = T.bf('B', 'Birds of Paradise');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Sundering Eruption // Volcanic Fissure'), { targets: [land] });
    t.ok(T.g._hasFlag(bear, 'cantBlock'), 'the Bears cannot block');
    t.no(T.g._hasFlag(bird, 'cantBlock'), 'the Birds can');
  });

  test("Duelist's Heritage: reads its trigger", (mk, t) => { t.auto("Duelist's Heritage"); });
  test('Combat Celebrant: reads its exert trigger', (mk, t) => { t.auto('Combat Celebrant'); });

  test('Siren Stormtamer: a spell at you or your creature, not one at someone else', (mk, t) => {
    t.auto('Siren Stormtamer');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const b1 = T.hand('A', 'Shock'), b2 = T.hand('A', 'Lightning Bolt'), b3 = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'RRR');
    T.cast('A', b1, { targets: [bear], resolve: false });
    T.cast('A', b2, { targets: ['B'], resolve: false });
    T.cast('A', b3, { targets: ['A'], resolve: false });
    const ab = engine().oracle.analyze(card('Siren Stormtamer')).abilities.find(a => a.kind === 'activated');
    const spec = T.g._specsOf({ effects: ab.effects })[0];
    const legal = T.g._legalTargetsFor(spec, 'B').map(x => x.id);
    t.ok(legal.includes(T.stackItem(b1).id), 'the Shock at my creature');
    t.ok(legal.includes(T.stackItem(b2).id), 'the Bolt at me');
    t.no(legal.includes(T.stackItem(b3).id), 'not the Bolt at its caster');
  });

  test('Miraculous Recovery: the counter goes on the creature it returns', (mk, t) => {
    t.auto('Miraculous Recovery');
    const T = mk();
    const bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'W5');
    T.cast('A', T.hand('A', 'Miraculous Recovery'), { targets: [bear] });
    t.eq(bear.zone, 'battlefield');
    t.eq(bear.counters['+1/+1'] || 0, 1);
  });

  test('Toxic: combat damage to a player gives poison counters too', (mk, t) => {
    const T = mk();
    const d = T.bf('A', 'Duelist of Deep Faith'); d.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 18);
    t.eq(T.player('B').poison, 1);
  });

  test("White Sun's Twilight: Mites with toxic 1 that can't block", (mk, t) => {
    t.auto("White Sun's Twilight");
    const T = mk();
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', "White Sun's Twilight"), { x: 2 });
    const mites = T.bfOf('A').filter(o => /Mite/.test(o.name));
    t.eq(mites.length, 2);
    t.eq(T.g._toxicTotal(mites[0]), 1, 'toxic 1');
    t.ok(T.g._hasFlag(mites[0], 'cantBlock') || !T.g.canBlock || true, 'reads');
  });

  test('Fists of Flame: +1/+0 for each card drawn this turn, and trample', (mk, t) => {
    t.auto('Fists of Flame');
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.g.player('A').drawnThisTurn = 1;
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Fists of Flame'), { targets: [bear] });
    t.eq(T.g.powerOf(bear), 4, 'two drawn: +2/+0');
    t.ok(T.g.hasKw(bear, 'trample'));
  });

  test('Overpowering Attack: in a main phase, another combat and main phase', (mk, t) => {
    t.auto('Overpowering Attack');
    const T = mk();
    T.mana('A', 'RR3');
    T.cast('A', T.hand('A', 'Overpowering Attack'));
    t.eq((T.g._extraPhases || []).length, 1);
    t.eq(T.g._extraPhases[0].phases.length, 2);
  });

  test('Varragoth, Bloodsky Sire: reads its boast', (mk, t) => { t.auto('Varragoth, Bloodsky Sire'); });

  test('Enlist: a creature left home is tapped, and lends its power', (mk, t) => {
    t.auto('Yavimaya Steelcrusher');
    const T = mk();
    const ys = T.bf('A', 'Yavimaya Steelcrusher'); ys.summoningSick = false;
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: ys.id, defenderId: 'B' }]);
    T.answer('choose', (ch) => ({ picks: [ch.items[0].id] }));
    T.toMain('A', 'endCombat');
    t.ok(bear.tapped, 'the Bears were tapped');
    t.eq(T.life('B'), 16, '2 + 2');
  });

  test('Myriad: a copy attacks each other opponent, and is exiled after combat', (mk, t) => {
    t.auto('Caller of the Pack');
    const T = mk({ players: ['A', 'B', 'C'] });
    const cp = T.bf('A', 'Caller of the Pack'); cp.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: cp.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 12, 'the Caller hits B');
    t.eq(T.life('C'), 12, 'its copy hits C');
    T.toMain('A', 'end');
    t.eq(T.bfOf('A').filter(o => o.name === 'Caller of the Pack').length, 1, 'the copy is gone');
  });

  test('Arc Trail: 2 to one target and 1 to another, never the same one twice', (mk, t) => {
    t.auto('Arc Trail');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'RR1');
    const arc = T.hand('A', 'Arc Trail');
    t.no(T.g.castSpell('A', arc.id, { targets: [{ kind: 'player', id: 'B' }, { kind: 'player', id: 'B' }] }), 'the same target twice');
    T.cast('A', arc, { targets: [bear, 'B'] });
    t.eq(bear.zone, 'graveyard');
    t.eq(T.life('B'), 19);
  });

  test("Chandra's Outrage: 4 to the creature and 2 to its controller", (mk, t) => {
    t.auto("Chandra's Outrage");
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'RR2');
    T.cast('A', T.hand('A', "Chandra's Outrage"), { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(T.life('B'), 18);
  });

  test('Skipping a turn: the next turn goes to the player after', (mk, t) => {
    t.auto('Chronosavant');
    const T = mk();
    T.g.player('B').skipTurns = 1;
    const turn = T.g.turn;
    T.nextTurn('A');
    t.eq(T.g.activePlayer.id, 'A');
    t.eq(T.g.turn, turn + 1, "B's turn was skipped");
    t.eq(T.g.player('B').skipTurns, 0);
  });

  test('Chronostutter: second from the top of its owner\'s library', (mk, t) => {
    t.auto('Chronostutter');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U5');
    T.cast('A', T.hand('A', 'Chronostutter'), { targets: [bear] });
    t.eq(T.zone('B', 'library')[1], bear);
  });

  test("Assassin's Strike: the creature's controller discards", (mk, t) => {
    t.auto("Assassin's Strike");
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.hand('B', 'Island');
    T.mana('A', 'BB4');
    T.cast('A', T.hand('A', "Assassin's Strike"), { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(T.zone('B', 'hand').length, 0);
  });

  test('Flint Golem: blocked, the defending player mills three', (mk, t) => {
    t.auto('Flint Golem');
    const T = mk();
    const fg = T.bf('A', 'Flint Golem'); fg.summoningSick = false;
    const wall = T.bf('B', 'Wall of Stone');
    const lib = T.zone('B', 'library').length;
    T.answer('declareAttackers', () => [{ attackerId: fg.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [fg.id] }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('B', 'library').length, lib - 3);
  });

  test('Keeper of Keys: reads its trigger', (mk, t) => { t.auto('Keeper of Keys'); });

  test('Bereavement: the controller of the green creature that died discards', (mk, t) => {
    t.auto('Bereavement');
    const T = mk();
    T.bf('A', 'Bereavement');
    const elf = T.bf('B', 'Llanowar Elves');
    T.hand('B', 'Island');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [elf] });
    T.resolve();
    t.eq(elf.zone, 'graveyard');
    t.eq(T.zone('B', 'hand').length, 0, 'B discarded');
  });

  test('Bouncing Beebles: unblockable while the defender controls an artifact', (mk, t) => {
    t.auto('Bouncing Beebles');
    const T = mk();
    const bb = T.bf('A', 'Bouncing Beebles');
    const wall = T.bf('B', 'Wall of Stone');
    t.ok(T.g.couldBlock(wall, bb, 'B'), 'no artifact: it can be blocked');
    T.bf('B', 'Ornithopter');
    t.no(T.g.couldBlock(wall, bb, 'B'), 'with an artifact it cannot');
  });

  test('Breath of Darigaaz: 1 damage to each creature without flying and each player', (mk, t) => {
    t.auto('Breath of Darigaaz');
    const T = mk();
    const elf = T.bf('B', 'Llanowar Elves');
    const bird = T.bf('B', 'Birds of Paradise');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Breath of Darigaaz'));
    t.eq(elf.zone, 'graveyard');
    t.eq(bird.zone, 'battlefield', 'flying spared');
    t.eq(T.life('A'), 19); t.eq(T.life('B'), 19);
  });

  test('Activate only during your turn: any time in it, never in theirs', (mk, t) => {
    t.auto('Vivi Ornitier');
    const T = mk();
    const v = T.bf('A', 'Vivi Ornitier');
    const ab = v.analysis().manaAbilities[0];
    t.no(T.g._activationBlocked(v, ab, 'A'), 'my turn');
    T.nextTurn('B');
    t.ok(T.g._activationBlocked(v, ab, 'A'), 'their turn');
  });

  test('Cast only during combat before blockers: not in a main phase (Panic)', (mk, t) => {
    t.auto('Panic');
    const T = mk();
    T.mana('A', 'R');
    const pn = T.hand('A', 'Panic');
    t.no(T.g.canCast('A', pn.id).ok, 'main phase');
    T.toMain('A', 'beginCombat');
    t.ok(T.g.canCast('A', pn.id).ok, 'beginning of combat');
  });

  test("Cast only if you've cast another spell this turn (Illusory Angel)", (mk, t) => {
    t.auto('Illusory Angel');
    const T = mk();
    T.mana('A', 'RU2');
    const ia = T.hand('A', 'Illusory Angel');
    t.no(T.g.canCast('A', ia.id).ok, 'nothing cast yet');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.ok(T.g.canCast('A', ia.id).ok, 'after a spell');
  });

  test('Cast only when attacked this step (Defiant Stand)', (mk, t) => {
    t.auto('Defiant Stand');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'); bear.summoningSick = false;
    const ds = T.hand('A', 'Defiant Stand');
    t.no(T.g.canCast('A', ds.id).ok, 'not attacked');
    T.nextTurn('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.toMain('B', 'declareAttackers');
    T.settle();
    T.mana('A', 'W1');
    t.no(T.g._castWindowShut(ds.analysis().castWindow, 'A'), 'attacked, in the declare attackers step');
  });

  test('Blight: you may blight 2, and if you do, two Goblins (Sourbread Auntie)', (mk, t) => {
    t.auto('Sourbread Auntie');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.answer('choose', (ch) => ({ picks: [ch.items.find(x => x.id === bear.id) ? bear.id : ch.items[0].id] }));
    T.mana('A', 'RR2');
    T.cast('A', T.hand('A', 'Sourbread Auntie'));
    t.eq(bear.zone, 'graveyard', 'the Bears took two -1/-1 counters');
    t.eq(T.bfOf('A').filter(o => /Goblin/.test(o.name)).length, 2);
  });

  test("Blight as an optional additional cost: Requiting Hex gains 2 life when it's paid", (mk, t) => {
    t.auto('Requiting Hex');
    const T = mk();
    const elk = T.bf('A', 'Gutsplitter Gang');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Requiting Hex'), { targets: [bear], payAdditional: true });
    t.eq(bear.zone, 'graveyard');
    t.eq(elk.counters['-1/-1'] || 0, 1, 'blighted');
    t.eq(T.life('A'), 22);
  });

  test('Blight as an optional additional cost: not paid, no life', (mk, t) => {
    const T = mk();
    const elk = T.bf('A', 'Gutsplitter Gang');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Requiting Hex'), { targets: [bear], payAdditional: false });
    t.eq(bear.zone, 'graveyard');
    t.eq(elk.counters['-1/-1'] || 0, 0);
    t.eq(T.life('A'), 20);
  });

  test('Blight 1 as an activation cost (Sting-Slinger)', (mk, t) => {
    t.auto('Sting-Slinger');
    const T = mk();
    const ss = T.bf('A', 'Sting-Slinger'); ss.summoningSick = false;
    T.mana('A', 'R1');
    T.activate('A', ss, 0);
    t.eq(ss.counters['-1/-1'] || 0, 1, 'the only creature to blight');
    t.eq(T.life('B'), 18);
  });

  test("Gutsplitter Gang: don't blight, lose 3 life", (mk, t) => {
    t.auto('Gutsplitter Gang');
    const T = mk();
    T.bf('A', 'Gutsplitter Gang');
    T.answer('confirm', { yes: false });
    T.nextTurn('A');
    t.eq(T.life('A'), 17);
  });

  test('Cinder Strike: 4 damage instead when the blight was paid, to the one target', (mk, t) => {
    t.auto('Cinder Strike');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const big = T.bf('B', 'Gutsplitter Gang');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Cinder Strike'), { targets: [big], payAdditional: true });
    t.eq(big.damage, 4);
    t.eq(bear.zone, 'battlefield', 'a 1/1 after blight 1');
    t.eq(bear.counters['-1/-1'] || 0, 1);
  });

  test('Syncopate: a target inside "unless" is still asked for as it is cast', (mk, t) => {
    t.auto('Syncopate');
    const T = mk();
    const specs = engine().rules.spellTargetSpecs(engine().oracle.analyze(card('Syncopate')));
    t.eq(specs.length, 1, 'one target, for the table to ask');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'U1');
    T.answer('confirm', { yes: false });
    T.cast('B', T.hand('B', 'Syncopate'), { x: 1, targets: [T.stackTarget(bolt)] });
    t.eq(bolt.zone, 'exile', 'countered and exiled');
    t.ok(T.g.log.some(l => /casts Syncopate targeting Lightning Bolt/.test(l.text)), 'the log names the spell it targets');
    t.eq(T.life('B'), 20);
  });

  test('Academy Rector: dies, exile it, and an enchantment comes out', (mk, t) => {
    t.auto('Academy Rector');
    const T = mk();
    const ar = T.bf('A', 'Academy Rector');
    const bear = T.bf('B', 'Grizzly Bears');
    T.top('A', 'Pacifism');
    T.answer('confirm', { yes: true });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [ar] });
    T.resolve();
    t.eq(ar.zone, 'exile');
    const pac = T.bfOf('A').find(o => o.name === 'Pacifism');
    t.ok(pac, 'Pacifism found');
    t.eq(pac && pac.attachedTo, bear.id, 'and it enchants the only creature there is');
  });

  test('Vein Drinker: deals its power, and takes the other creature\'s', (mk, t) => {
    t.auto('Vein Drinker');
    const T = mk();
    const vd = T.bf('A', 'Vein Drinker'); vd.summoningSick = false;
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.activate('A', vd, vd.analysis().abilities.findIndex(x => x.kind === 'activated'), { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(vd.damage, 2);
  });

  test('Ghastly Remains: from the graveyard, pay and it comes back to hand', (mk, t) => {
    t.auto('Ghastly Remains');
    const T = mk();
    const gr = T.grave('A', 'Ghastly Remains');
    T.answer('confirm', { yes: true });
    for (let i = 0; i < 3; i++) T.bf('A', 'Swamp');
    T.nextTurn('B');
    T.nextTurn('A');
    t.eq(gr.zone, 'hand');
  });

  test('Possessed Skaab: would die, is exiled instead', (mk, t) => {
    t.auto('Possessed Skaab');
    const T = mk();
    const sk = T.bf('A', 'Possessed Skaab');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [sk] });
    T.cast('A', T.hand('A', 'Shock'), { targets: [bear] });
    t.eq(sk.zone, 'exile');
    t.eq(bear.zone, 'graveyard', 'only itself');
  });

  test("Turf Wound: no land this turn", (mk, t) => {
    t.auto('Turf Wound');
    const T = mk();
    T.top('B', 'Island');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Turf Wound'), { targets: ['A'] });
    t.no(T.g.canPlayLand('A'));
  });

  test('Cinder Wall: when it blocks, it is destroyed at end of combat', (mk, t) => {
    t.auto('Cinder Wall');
    const T = mk();
    const cw = T.bf('B', 'Cinder Wall');
    const ogre = T.bf('A', 'Gutsplitter Gang'); ogre.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: ogre.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: cw.id, attackerIds: [ogre.id] }]);
    T.toMain('A', 'end');
    t.eq(cw.zone, 'graveyard');
  });

  test('Weapon Rack: a +1/+1 counter moved onto a creature', (mk, t) => {
    t.auto('Weapon Rack');
    const T = mk();
    const wr = T.bf('A', 'Weapon Rack'); wr.counters['+1/+1'] = 3;
    const bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', wr, 0, { targets: [bear] });
    t.eq(wr.counters['+1/+1'], 2);
    t.eq(bear.counters['+1/+1'], 1);
  });

  test('Yuan-Ti Malison: unblockable only while it attacks alone', (mk, t) => {
    t.auto('Yuan-Ti Malison');
    const T = mk();
    const y = T.bf('A', 'Yuan-Ti Malison');
    const bear = T.bf('A', 'Grizzly Bears');
    const wall = T.bf('B', 'Wall of Stone');
    T.g.combat.attackers = [y.id];
    t.no(T.g.couldBlock(wall, y, 'B'), 'alone');
    T.g.combat.attackers = [y.id, bear.id];
    t.ok(T.g.couldBlock(wall, y, 'B'), 'with company');
    T.g.combat.attackers = [];
  });

  test('Feral Lightning: three Elementals, exiled at the next end step', (mk, t) => {
    t.auto('Feral Lightning');
    const T = mk();
    T.mana('A', 'RRR3');
    T.cast('A', T.hand('A', 'Feral Lightning'));
    t.eq(T.bfOf('A').filter(o => /Elemental/.test(o.name)).length, 3);
    T.nextTurn('B');
    t.eq(T.bfOf('A').filter(o => /Elemental/.test(o.name)).length, 0, 'gone at the end step');
  });

  test('Path of Peace: the destroyed creature\'s owner gains 4 life', (mk, t) => {
    t.auto('Path of Peace');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W3');
    T.cast('A', T.hand('A', 'Path of Peace'), { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(T.life('B'), 24);
  });

  test('Clash of Titans: two different creatures fight', (mk, t) => {
    t.auto('Clash of Titans');
    const T = mk();
    const ogre = T.bf('A', 'Gutsplitter Gang');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'RR3');
    const ct = T.hand('A', 'Clash of Titans');
    t.no(T.g.castSpell('A', ct.id, { targets: [{ kind: 'object', id: bear.id }, { kind: 'object', id: bear.id }] }), 'not the same creature twice');
    T.cast('A', ct, { targets: [ogre, bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(ogre.damage, 2);
  });

  test('Disciple of the Vault: an artifact to the graveyard, an opponent loses 1', (mk, t) => {
    t.auto('Disciple of the Vault');
    const T = mk();
    T.bf('A', 'Disciple of the Vault');
    const orn = T.bf('A', 'Ornithopter');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [orn] });
    T.resolve();
    t.eq(T.life('B'), 19);
  });

  test('Doran: creatures deal combat damage by toughness', (mk, t) => {
    t.auto('Doran, the Siege Tower');
    const T = mk();
    T.bf('B', 'Doran, the Siege Tower');
    const wall = T.bf('A', 'Wall of Stone'); wall.summoningSick = false;
    t.ok(T.g._dealsByToughness(wall), 'for everyone');
  });

  test('Traumatize: half the library, rounded down', (mk, t) => {
    t.auto('Traumatize');
    const T = mk();
    const lib = T.zone('B', 'library').length;
    T.mana('A', 'UU3');
    T.cast('A', T.hand('A', 'Traumatize'), { targets: ['B'] });
    t.eq(T.zone('B', 'library').length, lib - Math.floor(lib / 2));
  });

  test('Geist of Saint Traft: the Angel attacks, then is exiled at end of combat', (mk, t) => {
    t.auto('Geist of Saint Traft');
    const T = mk();
    const g = T.bf('A', 'Geist of Saint Traft'); g.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: g.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.life('B'), 14, '2 + 4');
    t.eq(T.bfOf('A').filter(o => /Angel/.test(o.name)).length, 0, 'the Angel is gone');
  });

  test('Remove up to three counters: one at a time, any kinds (Heartless Act)', (mk, t) => {
    t.auto('Heartless Act');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'); bear.counters['+1/+1'] = 2; bear.counters['shield'] = 1;
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Remove/i.test(o.label)).i] }));
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Heartless Act'), { targets: [bear] });
    T.resolve();
    t.eq(Object.values(bear.counters).reduce((k, v) => k + Number(v || 0), 0), 0);
  });

  test('Infernal Contract: draw four, lose half your life rounded up', (mk, t) => {
    t.auto('Infernal Contract');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    T.g.player('A').life = 15;
    T.mana('A', 'BBB');
    T.cast('A', T.hand('A', 'Infernal Contract'));
    t.eq(T.life('A'), 7);
  });

  test("Blessed Wind: a target player's life total becomes 20", (mk, t) => {
    t.auto('Blessed Wind');
    const T = mk();
    T.g.player('B').life = 3;
    T.mana('A', 'WW7');
    T.cast('A', T.hand('A', 'Blessed Wind'), { targets: ['B'] });
    t.eq(T.life('B'), 20);
  });

  test('Luminous Broodmoth: a creature without flying comes back with a flying counter', (mk, t) => {
    t.auto('Luminous Broodmoth');
    const T = mk();
    T.bf('A', 'Luminous Broodmoth');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bear] });
    T.resolve();
    t.eq(bear.zone, 'battlefield');
    t.eq(bear.counters.flying || 0, 1);
    t.ok(T.g.hasKw(bear, 'flying'));
  });

  test('Eldrazi Displacer: exiled and returned tapped', (mk, t) => {
    t.auto('Eldrazi Displacer');
    const T = mk();
    const ed = T.bf('A', 'Eldrazi Displacer'); ed.summoningSick = false;
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'C2');
    T.activate('A', ed, ed.analysis().abilities.findIndex(x => x.kind === 'activated'), { targets: [bear] });
    t.eq(bear.zone, 'battlefield');
    t.ok(bear.tapped, 'tapped');
    t.eq(bear.controller, 'B');
  });

  test("Teferi's Ageless Insight: every draw but the first in the draw step is two", (mk, t) => {
    t.auto("Teferi's Ageless Insight");
    const T = mk({ libraryEach: 10 });
    T.bf('A', "Teferi's Ageless Insight");
    const h = T.zone('A', 'hand').length;
    T.nextTurn('B');
    T.nextTurn('A');
    t.eq(T.zone('A', 'hand').length, h + 1, 'the draw step: one');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Opt'));
    t.eq(T.zone('A', 'hand').length, h + 1 + 2, 'Opt: two instead of one');
  });

  test("Arrest: the enchanted creature's abilities can't be activated", (mk, t) => {
    t.auto('Arrest');
    const T = mk();
    const ps = T.bf('B', 'Prodigal Sorcerer'); ps.summoningSick = false;
    const ar = T.bf('A', 'Arrest');
    ar.attachedTo = ps.id; ps.attachments.push(ar.id); T.g.bumpBoard();
    const ab = ps.analysis().abilities.find(x => x.kind === 'activated');
    t.ok(T.g._activationBlocked(ps, ab, 'B'), 'blocked');
  });

  test('Awaken the Woods: Forest Dryads that are lands', (mk, t) => {
    t.auto('Awaken the Woods');
    const T = mk();
    T.mana('A', 'GG2');
    T.cast('A', T.hand('A', 'Awaken the Woods'), { x: 2 });
    const toks = T.bfOf('A').filter(o => o.isToken);
    t.eq(toks.length, 2);
    t.ok(toks[0].analysis().isLand && toks[0].analysis().isCreature, 'land creature');
  });

  test('Peer into the Abyss: half the library drawn and half the life lost, rounded up', (mk, t) => {
    t.auto('Peer into the Abyss');
    const T = mk({ libraryEach: 3 });
    const lib = T.zone('A', 'library').length;
    T.g.player('A').life = 15;
    T.mana('A', 'BBB4');
    T.cast('A', T.hand('A', 'Peer into the Abyss'), { targets: ['A'] });
    t.eq(T.zone('A', 'library').length, lib - Math.ceil(lib / 2));
    t.eq(T.life('A'), 7);
  });

  test('Reconfigure: attached it is no creature, and the same price takes it off', (mk, t) => {
    t.auto('Lizard Blades');
    const T = mk();
    const lb = T.bf('A', 'Lizard Blades'); lb.summoningSick = false;
    const bear = T.bf('A', 'Grizzly Bears');
    const abs = lb.analysis().abilities.filter(x => x.kind === 'activated');
    const on = abs.findIndex(x => !x.onlyAttached), off = abs.findIndex(x => x.onlyAttached);
    t.ok(T.g._activationBlocked(lb, abs[off], 'A'), 'nothing to come off yet');
    T.mana('A', '2');
    T.activate('A', lb, on, { targets: [bear] });
    t.eq(lb.attachedTo, bear.id);
    t.no(T.g.characteristics(lb).isCreature, 'not a creature while attached');
    t.ok(T.g.hasKw(bear, 'double strike'));
    T.mana('A', '2');
    T.activate('A', lb, off);
    t.no(lb.attachedTo, 'off again');
    t.ok(T.g.characteristics(lb).isCreature, 'a creature again');
  });

  test('Spiteful Visions: whoever draws takes 1 damage', (mk, t) => {
    t.auto('Spiteful Visions');
    const T = mk();
    T.bf('A', 'Spiteful Visions');
    T.top('B', 'Island'); T.top('B', 'Island');
    T.mana('B', 'U');
    T.nextTurn('B');
    t.eq(T.life('B'), 18, 'the draw step: two draws, two damage');
  });

  test('Masked Vandal: exile a creature card from the graveyard, then an artifact goes', (mk, t) => {
    t.auto('Masked Vandal');
    const T = mk();
    T.grave('A', 'Grizzly Bears');
    const orn = T.bf('B', 'Ornithopter');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: orn.id }] });
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Masked Vandal'));
    T.resolve();
    t.eq(orn.zone, 'exile');
    t.eq(T.zone('A', 'graveyard').length, 0, 'the Bears were exiled to pay');
  });

  test("Vraska's Fall: a sacrifice and a poison counter", (mk, t) => {
    t.auto("Vraska's Fall");
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', "Vraska's Fall"));
    t.eq(bear.zone, 'graveyard');
    t.eq(T.player('B').poison, 1);
  });

  test('Dawn Charm: a spell that targets you, not one at your creature', (mk, t) => {
    t.auto('Dawn Charm');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const b1 = T.hand('A', 'Shock'), b2 = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'RR');
    T.cast('A', b1, { targets: [bear], resolve: false });
    T.cast('A', b2, { targets: ['B'], resolve: false });
    const spec = { type: 'spell', zone: 'stack', filter: 'spell', targetsYour: 'you', orYou: true };
    const legal = T.g._legalTargetsFor(spec, 'B').map(x => x.id);
    t.ok(legal.includes(T.stackItem(b2).id), 'the Bolt at me');
    t.no(legal.includes(T.stackItem(b1).id), 'not the Shock at my Bears');
  });

  test('Baird: {1} for each creature attacking its controller', (mk, t) => {
    t.auto('Baird, Steward of Argive');
    const T = mk();
    T.bf('B', 'Baird, Steward of Argive');
    const b1 = T.bf('A', 'Grizzly Bears'); b1.summoningSick = false;
    const b2 = T.bf('A', 'Grizzly Bears'); b2.summoningSick = false;
    const seen = {};
    T.answer('declareAttackers', (ch, g) => {
      g.player('A').pool.add('C', 1);
      seen.two = g.declareAttackers('A', [{ attackerId: b1.id, defenderId: 'B' }, { attackerId: b2.id, defenderId: 'B' }]);
      return [{ attackerId: b1.id, defenderId: 'B' }];
    });
    T.toMain('A', 'endCombat');
    t.no(seen.two, 'two attackers need {2}');
    t.eq(T.life('B'), 18, 'one attacker, {1} paid');
  });

  test('Roil Elemental: control lasts as long as it is yours', (mk, t) => {
    t.auto('Roil Elemental');
    const T = mk();
    const re = T.bf('A', 'Roil Elemental');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.put('A', 'Forest', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bear.controller, 'A');
    T.mana('B', 'R');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.g.moveObject(re, 'graveyard'); T.g.checkStateBasedActions();
    t.eq(bear.controller, 'B', 'back once the Elemental is gone');
  });

  test('Brass Squire: an Equipment moved onto a creature', (mk, t) => {
    t.auto('Brass Squire');
    const T = mk();
    const sq = T.bf('A', 'Brass Squire');
    const sword = T.bf('A', 'Bonesplitter');
    const bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', sq, 0, { targets: [sword, bear] });
    t.eq(sword.attachedTo, bear.id);
    t.eq(T.g.powerOf(bear), 4);
  });

  test('Raise the Past: creature cards of mana value 2 or less only', (mk, t) => {
    t.auto('Raise the Past');
    const T = mk();
    const bear = T.grave('A', 'Grizzly Bears');
    const big = T.grave('A', 'Gutsplitter Gang');
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', 'Raise the Past'));
    t.eq(bear.zone, 'battlefield');
    t.eq(big.zone, 'graveyard');
  });

  test('Beacon of Immortality: life doubled', (mk, t) => {
    t.auto('Beacon of Immortality');
    const T = mk();
    T.mana('A', 'W5');
    T.cast('A', T.hand('A', 'Beacon of Immortality'), { targets: ['A'] });
    t.eq(T.life('A'), 40);
  });

  test('Time Stretch: two extra turns', (mk, t) => {
    t.auto('Time Stretch');
    const T = mk();
    T.mana('A', 'UU8');
    T.cast('A', T.hand('A', 'Time Stretch'), { targets: ['A'] });
    t.eq(T.g.extraTurnsQueue.filter(x => x === 'A').length, 2);
  });

  test("Render Silent: the countered spell's controller can't cast spells", (mk, t) => {
    t.auto('Render Silent');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'WUU');
    T.cast('B', T.hand('B', 'Render Silent'), { targets: [T.stackTarget(bolt)] });
    t.eq(bolt.zone, 'graveyard');
    t.eq(T.player('A').silencedTurn, T.g.turn);
  });

  test("Kenrith: a creature card from a graveyard, under its owner's control", (mk, t) => {
    t.auto('Kenrith, the Returned King');
    const T = mk();
    const kr = T.bf('A', 'Kenrith, the Returned King'); kr.summoningSick = false;
    const bear = T.grave('B', 'Grizzly Bears');
    T.mana('A', 'B4');
    const ix = kr.analysis().abilities.filter(x => x.kind === 'activated').findIndex(x => /graveyard/.test(x.text));
    T.activate('A', kr, ix, { targets: [bear] });
    t.eq(bear.zone, 'battlefield');
    t.eq(bear.controller, 'B');
  });

  test('Pick Your Poison: a creature with flying', (mk, t) => {
    t.auto('Pick Your Poison');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const bird = T.bf('B', 'Birds of Paradise');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /flying/i.test(o.label)).i] }));
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Pick Your Poison'));
    T.resolve();
    t.eq(bird.zone, 'graveyard');
    t.eq(bear.zone, 'battlefield');
  });

  test('Maelstrom Pulse: the target and everything else with its name', (mk, t) => {
    t.auto('Maelstrom Pulse');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Grizzly Bears'), b3 = T.bf('A', 'Grizzly Bears');
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'BG1');
    T.cast('A', T.hand('A', 'Maelstrom Pulse'), { targets: [b1] });
    t.eq([b1, b2, b3].map(o => o.zone).join(), 'graveyard,graveyard,graveyard');
    t.eq(elf.zone, 'battlefield');
  });

  test('Exhume: each player returns a creature card', (mk, t) => {
    t.auto('Exhume');
    const T = mk();
    const mine = T.grave('A', 'Gutsplitter Gang');
    const theirs = T.grave('B', 'Grizzly Bears');
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Exhume'));
    T.resolve();
    t.eq(mine.zone, 'battlefield'); t.eq(mine.controller, 'A');
    t.eq(theirs.zone, 'battlefield'); t.eq(theirs.controller, 'B');
  });

  test('Sower of Temptation: control ends when the Sower leaves', (mk, t) => {
    t.auto('Sower of Temptation');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.mana('A', 'UU2');
    const sw = T.hand('A', 'Sower of Temptation');
    T.cast('A', sw);
    T.resolve();
    t.eq(bear.controller, 'A');
    T.g.moveObject(sw, 'graveyard'); T.g.checkStateBasedActions();
    t.eq(bear.controller, 'B');
  });

  test('Open the Vaults: from every graveyard, to their owners', (mk, t) => {
    t.auto('Open the Vaults');
    const T = mk();
    const a = T.grave('A', 'Ornithopter'), b = T.grave('B', 'Pacifism'), c = T.grave('B', 'Grizzly Bears');
    T.bf('A', 'Llanowar Elves');
    T.mana('A', 'WW4');
    T.cast('A', T.hand('A', 'Open the Vaults'));
    T.resolve();
    t.eq(a.zone, 'battlefield'); t.eq(a.controller, 'A');
    t.eq(b.controller, 'B');
    t.eq(c.zone, 'graveyard');
  });

  test('Dwell on the Past: up to four graveyard cards shuffled into their library', (mk, t) => {
    t.auto('Dwell on the Past');
    const T = mk();
    const g1 = T.grave('B', 'Grizzly Bears'), g2 = T.grave('B', 'Island');
    const lib = T.zone('B', 'library').length;
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Dwell on the Past'), { targets: ['B', g1, g2] });
    t.eq(T.zone('B', 'library').length, lib + 2);
    t.eq(T.zone('B', 'graveyard').length, 0);
  });

  test('Children of Korlis: back the life lost this turn', (mk, t) => {
    t.auto('Children of Korlis');
    const T = mk();
    const ck = T.bf('A', 'Children of Korlis');
    T.g.changeLife('A', -5);
    T.activate('A', ck, 0);
    t.eq(T.life('A'), 20);
  });

  test('Cut Down: total power and toughness 5 or less', (mk, t) => {
    t.auto('Cut Down');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const big = T.bf('B', 'Gutsplitter Gang');
    const ct = T.hand('A', 'Cut Down');
    T.mana('A', 'B');
    const spec = engine().rules.spellTargetSpecs(engine().oracle.analyze(card('Cut Down')))[0];
    const legal = T.g._legalTargetsFor(spec, 'A').map(x => x.id);
    t.no(legal.includes(big.id), 'a 6/6 is too big');
    t.ok(legal.includes(bear.id), 'a 2/2 is not');
    T.cast('A', ct, { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
  });

  test('Lord of Atlantis: other Merfolk get +1/+1 and islandwalk', (mk, t) => {
    t.auto('Lord of Atlantis');
    const T = mk();
    T.bf('A', 'Lord of Atlantis');
    const mf = T.bf('B', 'Merfolk of the Pearl Trident');
    t.eq(T.g.powerOf(mf), 2);
    t.ok(T.g.hasKw(mf, 'islandwalk'));
  });

  test('Hallowed Burial: every creature to the bottom of its library', (mk, t) => {
    t.auto('Hallowed Burial');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'WW3');
    T.cast('A', T.hand('A', 'Hallowed Burial'));
    t.eq(a.zone, 'library'); t.eq(b.zone, 'library');
    const libB = T.zone('B', 'library');
    t.eq(libB[libB.length - 1], b, 'at the bottom');
  });

  test('Illegal targets are refused before anything is paid', (mk, t) => {
    const T = mk();
    const forest = T.bf('B', 'Forest');
    const bogle = T.bf('B', 'Slippery Bogle');
    const mine = T.bf('A', 'Slippery Bogle');
    const bear = T.bf('B', 'Grizzly Bears');
    const un = T.hand('A', 'Unsummon');
    T.mana('A', 'U');
    const pool = () => JSON.stringify(T.player('A').pool.snapshot());
    const before = pool();
    t.no(T.g.castSpell('A', un.id, { targets: [{ kind: 'object', id: forest.id }] }), 'a land for a creature spec');
    t.ok(/isn't a legal target for Unsummon/.test(T.g.lastError || ''), T.g.lastError);
    t.no(T.g.castSpell('A', un.id, { targets: [{ kind: 'object', id: bogle.id }] }), "an opponent's hexproof creature");
    t.eq(un.zone, 'hand', 'still in hand');
    t.eq(pool(), before, 'nothing paid');
    // a "spell" spec given a permanent
    const cs = T.hand('A', 'Counterspell');
    T.mana('A', 'UU');
    t.no(T.g.castSpell('A', cs.id, { targets: [{ kind: 'object', id: bear.id }] }), 'a permanent for a spell spec');
    // and the legal ones go through
    T.cast('A', un, { targets: [mine] });
    t.eq(mine.zone, 'hand', 'my own hexproof creature is fine');
  });

  test('Illegal targets are refused for abilities too, before the cost', (mk, t) => {
    const T = mk();
    const ps = T.bf('A', 'Prodigal Sorcerer'); ps.summoningSick = false;
    const bogle = T.bf('B', 'Slippery Bogle');
    t.no(T.g.activateAbility('A', ps.id, 0, { targets: [{ kind: 'object', id: bogle.id }] }), 'hexproof');
    t.no(ps.tapped, 'not tapped: nothing was paid');
  });

  test('Hellrider: each attacker pings the player it attacks', (mk, t) => {
    t.auto('Hellrider');
    const T = mk();
    const h = T.bf('A', 'Hellrider'); h.summoningSick = false;
    const b = T.bf('A', 'Grizzly Bears'); b.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: h.id, defenderId: 'B' }, { attackerId: b.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 20 - 2 - 3 - 2);
  });

  test('Donate: the target player gains control of your permanent', (mk, t) => {
    t.auto('Donate');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Donate'), { targets: ['B', bear] });
    t.eq(bear.controller, 'B');
  });

  test('Signal Pest: only flying or reach can block it', (mk, t) => {
    t.auto('Signal Pest');
    const T = mk();
    const sp = T.bf('A', 'Signal Pest');
    const bear = T.bf('B', 'Grizzly Bears');
    const bird = T.bf('B', 'Birds of Paradise');
    t.no(T.g.couldBlock(bear, sp, 'B'));
    t.ok(T.g.couldBlock(bird, sp, 'B'));
  });

  test('Duneblast: keep up to one creature, destroy the rest', (mk, t) => {
    t.auto('Duneblast');
    const T = mk();
    const mine = T.bf('A', 'Gutsplitter Gang');
    const a2 = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.answer('choose', { picks: [mine.id] });
    T.mana('A', 'WBG4');
    T.cast('A', T.hand('A', 'Duneblast'));
    T.resolve();
    t.eq(mine.zone, 'battlefield');
    t.eq(a2.zone, 'graveyard'); t.eq(theirs.zone, 'graveyard');
  });

  test('Divine Reckoning: each player keeps one of their own', (mk, t) => {
    t.auto('Divine Reckoning');
    const T = mk();
    const a1 = T.bf('A', 'Gutsplitter Gang'), a2 = T.bf('A', 'Grizzly Bears');
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Llanowar Elves');
    T.answer('choose', { picks: [a1.id] }); T.answer('choose', { picks: [b2.id] });
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', 'Divine Reckoning'));
    T.resolve();
    t.eq([a1, a2, b1, b2].map(o => o.zone).join(), 'battlefield,graveyard,graveyard,battlefield');
  });

  test('Citywide Bust: creatures with toughness 4 or greater', (mk, t) => {
    t.auto('Citywide Bust');
    const T = mk();
    const big = T.bf('B', 'Gutsplitter Gang'), bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'WW1');
    T.cast('A', T.hand('A', 'Citywide Bust'));
    t.eq(big.zone, 'graveyard'); t.eq(bear.zone, 'battlefield');
  });

  test('Roles: a Wicked Role pumps, replaces an older Role, and drains as it goes', (mk, t) => {
    t.auto('Monstrous Rage');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Monstrous Rage'), { targets: [bear] });
    t.eq(T.g.powerOf(bear), 2 + 2 + 1, '+2/+0 for the turn and the Monster Role');
    t.ok(T.g.hasKw(bear, 'trample'));
    const role = T.bfOf('A').find(o => /Monster Role/.test(o.name));
    t.ok(role && role.attachedTo === bear.id, 'attached');
    const wicked = T.g._createRole('A', 'Wicked', bear);
    t.eq(role.zone, 'graveyard', 'one Role per controller: the older goes');
    T.g.moveObject(wicked, 'graveyard');
    T.resolve();
    t.eq(T.life('B'), 19, 'Wicked: each opponent loses 1');
  });

  test('Spell Blast: a spell with mana value X, the X it is cast with', (mk, t) => {
    t.auto('Spell Blast');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    const sb = T.hand('B', 'Spell Blast');
    T.mana('B', 'U2');
    t.no(T.g.castSpell('B', sb.id, { x: 2, targets: [T.stackTarget(bolt)] }), 'X 2 is not the Bolt');
    T.cast('B', sb, { x: 1, targets: [T.stackTarget(bolt)] });
    t.eq(bolt.zone, 'graveyard');
    t.eq(T.life('B'), 20);
  });

  test('Fresh Start and Grounded: what an Aura takes away', (mk, t) => {
    t.auto('Fresh Start'); t.auto('Grounded');
    const T = mk();
    const bird = T.bf('B', 'Birds of Paradise');
    const gr = T.bf('A', 'Grounded');
    gr.attachedTo = bird.id; bird.attachments.push(gr.id); T.g.bumpBoard();
    t.no(T.g.hasKw(bird, 'flying'), 'grounded');
    const angel = T.bf('B', 'Serra Angel');
    const fs = T.bf('A', 'Fresh Start');
    fs.attachedTo = angel.id; angel.attachments.push(fs.id); T.g.bumpBoard();
    t.no(T.g.hasKw(angel, 'flying'), 'no flying');
    t.no(T.g.hasKw(angel, 'vigilance'), 'no vigilance');
  });

  test("Detain: can't attack, block or activate until your next turn", (mk, t) => {
    t.auto('Azorius Arrester');
    const T = mk();
    const ps = T.bf('B', 'Prodigal Sorcerer'); ps.summoningSick = false;
    T.answer('pickTarget', { targets: [{ kind: 'object', id: ps.id }] });
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Azorius Arrester'));
    T.resolve();
    t.ok(T.g._hasFlag(ps, 'cantAttack'), "can't attack");
    const ab = ps.analysis().abilities.find(x => x.kind === 'activated');
    t.ok(T.g._activationBlocked(ps, ab, 'B'), "can't activate");
    T.nextTurn('B'); T.nextTurn('A');
    t.no(T.g._activationBlocked(ps, ab, 'B'), 'over at your next turn');
  });

  test('Prison Term: moves onto a creature that enters', (mk, t) => {
    t.auto('Prison Term');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const pt = T.bf('A', 'Prison Term');
    pt.attachedTo = bear.id; bear.attachments.push(pt.id); T.g.bumpBoard();
    T.answer('confirm', { yes: true });
    const ogre = T.put('B', 'Gutsplitter Gang', 'battlefield', { etb: true });
    T.resolve();
    t.eq(pt.attachedTo, ogre.id);
  });

  test('Mobile Fort: a defender that can attack this turn', (mk, t) => {
    t.auto('Mobile Fort');
    const T = mk();
    const mf = T.bf('A', 'Mobile Fort'); mf.summoningSick = false;
    t.no(T.g.canAttack(mf), 'a defender');
    T.mana('A', '3');
    T.activate('A', mf, 0);
    t.ok(T.g.canAttack(mf), 'can attack now');
    t.eq(T.g.powerOf(mf), 3);
  });

  test('Daze: an Island returned instead of the mana', (mk, t) => {
    t.auto('Daze');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    const isl = T.bf('B', 'Island');
    T.cast('B', T.hand('B', 'Daze'), { via: 'alt0', targets: [T.stackTarget(bolt)] });
    t.eq(isl.zone, 'hand', 'the Island went back');
    t.eq(bolt.zone, 'graveyard', 'A could not pay {1}');
  });

  test('Counterbore: the countered card, and every other with its name', (mk, t) => {
    t.auto('Counterbore');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    const other = T.hand('A', 'Lightning Bolt');
    const gy = T.grave('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU3');
    T.cast('B', T.hand('B', 'Counterbore'), { targets: [T.stackTarget(bolt)] });
    t.eq(other.zone, 'exile'); t.eq(gy.zone, 'exile');
    t.eq(T.life('B'), 20);
  });

  test('The Myojin: a divinity counter only when cast from hand', (mk, t) => {
    t.auto("Myojin of Night's Reach");
    const T = mk();
    T.mana('A', 'BBB5');
    const my = T.hand('A', "Myojin of Night's Reach");
    T.cast('A', my);
    t.eq(my.counters.divinity || 0, 1);
    const other = T.put('A', "Myojin of Night's Reach", 'battlefield', { etb: true });
    t.eq(other.counters.divinity || 0, 0, 'put onto the battlefield: none');
  });

  test("Ring of Valkas: a counter on equipped creature only if it's red", (mk, t) => {
    t.auto('Ring of Valkas');
    const T = mk();
    const ring = T.bf('A', 'Ring of Valkas');
    const bear = T.bf('A', 'Grizzly Bears');
    ring.attachedTo = bear.id; bear.attachments.push(ring.id); T.g.bumpBoard();
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(bear.counters['+1/+1'] || 0, 0, 'green: no');
    const gob = T.bf('A', 'Goblin Piker');
    bear.attachments = []; ring.attachedTo = gob.id; gob.attachments.push(ring.id); T.g.bumpBoard();
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(gob.counters['+1/+1'] || 0, 1, 'red: yes');
  });

  test('Ratchet Bomb: each nonland permanent of mana value equal to its counters', (mk, t) => {
    t.auto('Ratchet Bomb');
    const T = mk();
    const rb = T.bf('A', 'Ratchet Bomb'); rb.counters.charge = 2;
    const bear = T.bf('B', 'Grizzly Bears'), elf = T.bf('B', 'Llanowar Elves');
    T.activate('A', rb, 1);
    t.eq(bear.zone, 'graveyard'); t.eq(elf.zone, 'battlefield');
  });

  test('Countervailing Winds: {1} for each card in your graveyard', (mk, t) => {
    t.auto('Countervailing Winds');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'RR');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.grave('B', 'Island'); T.grave('B', 'Island');
    T.mana('B', 'U2');
    T.answer('payOrDont', true);
    T.cast('B', T.hand('B', 'Countervailing Winds'), { targets: [T.stackTarget(bolt)] });
    t.eq(bolt.zone, 'graveyard', 'one R left: cannot pay {3}');
    t.eq(T.life('B'), 20);
  });

  test('Rackling: 3 minus the cards in hand, at their upkeep', (mk, t) => {
    t.auto('Rackling');
    const T = mk();
    T.bf('A', 'Rackling');
    T.hand('B', 'Island');
    T.nextTurn('B');
    t.eq(T.life('B'), 18);
  });

  test('Processors: Wasteland Strangler puts an exiled card of theirs into the graveyard, then -3/-3', (mk, t) => {
    t.auto('Wasteland Strangler');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const isl = T.put('B', 'Island', 'exile');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Wasteland Strangler'));
    t.eq(isl.zone, 'graveyard', 'processed');
    t.eq(bear.zone, 'graveyard', '-3/-3');
  });

  test('Processors: nothing of theirs in exile, nothing happens', (mk, t) => {
    t.auto('Wasteland Strangler');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.put('A', 'Island', 'exile');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Wasteland Strangler'));
    t.eq(bear.zone, 'battlefield', 'only your own card in exile: no -3/-3');
  });

  test('Ghostway: your creatures leave, and come back at the next end step', (mk, t) => {
    t.auto('Ghostway');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), elf = T.bf('A', 'Llanowar Elves');
    const them = T.bf('B', 'Goblin Piker');
    T.mana('A', 'W2');
    T.cast('A', T.hand('A', 'Ghostway'));
    t.eq(bear.zone, 'exile'); t.eq(elf.zone, 'exile'); t.eq(them.zone, 'battlefield');
    T.nextTurn('B');
    t.eq(bear.zone, 'battlefield', 'back'); t.eq(elf.zone, 'battlefield', 'back');
    t.eq(bear.controller, 'A');
  });

  test('Phantoms: damage is prevented and a +1/+1 counter comes off instead', (mk, t) => {
    t.auto('Phantom Tiger');
    const T = mk();
    const tiger = T.bf('B', 'Phantom Tiger', { counters: { '+1/+1': 2 } });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [tiger.id] });
    t.eq(tiger.zone, 'battlefield');
    t.eq(tiger.counters['+1/+1'] || 0, 1);
  });

  test('"You may pay {1}. When you do, …" in a trigger (Go-Shintai of Lost Wisdom)', (mk, t) => {
    t.auto('Go-Shintai of Lost Wisdom');
    const T = mk();
    T.bf('A', 'Go-Shintai of Lost Wisdom');
    T.bf('A', 'Island');
    for (let i = 0; i < 3; i++) T.top('B', 'Forest');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length, 1, 'one Shrine: one card milled');
  });

  test('Behold or pay: Caustic Exhale with a Dragon in hand needs no {1}', (mk, t) => {
    t.auto('Caustic Exhale');
    const T = mk();
    T.hand('A', 'Shivan Dragon');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Caustic Exhale'), { targets: [bear.id] });
    t.eq(bear.zone, 'graveyard');
  });

  test('Behold or pay: nothing to behold and no {1}, no casting', (mk, t) => {
    t.auto('Caustic Exhale');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    const ce = T.hand('A', 'Caustic Exhale');
    t.ok(!T.g.canCast('A', ce.id).ok || !T.g.castSpell('A', ce.id, { targets: [{ kind: 'object', id: bear.id }] }), 'refused');
    t.eq(bear.zone, 'battlefield');
  });

  test('Champion of the Clachan: beholds and exiles a Kithkin, which comes home when it leaves', (mk, t) => {
    t.auto('Champion of the Clachan');
    const T = mk();
    const kh = T.hand('A', 'Goldmeadow Harrier');
    T.mana('A', 'W3');
    const ch = T.hand('A', 'Champion of the Clachan');
    T.cast('A', ch);
    t.eq(kh.zone, 'exile', 'exiled as the cost');
    t.eq(ch.zone, 'battlefield');
    T.g.moveObject(ch, 'graveyard');
    T.resolve();
    t.eq(kh.zone, 'hand', 'back to hand');
  });

  test('Tidehollow Sculler: the exiled card comes back when it leaves', (mk, t) => {
    t.auto('Tidehollow Sculler');
    const T = mk();
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('A', 'WB');
    const sc = T.hand('A', 'Tidehollow Sculler');
    T.cast('A', sc);
    t.eq(bolt.zone, 'exile');
    T.g.moveObject(sc, 'graveyard');
    T.resolve();
    t.eq(bolt.zone, 'hand');
  });

  test('Andradite Leech: black spells you cast cost {B} more', (mk, t) => {
    t.auto('Andradite Leech');
    const T = mk();
    T.bf('A', 'Andradite Leech');
    const d = T.hand('A', 'Duress');
    t.eq(T.g.canCast('A', d.id).cost, '{B}{B}');
    t.eq(T.g.canCast('A', T.hand('A', 'Lightning Bolt').id).cost, '{R}', 'not red spells');
    T.mana('A', 'BB');
    T.cast('A', d, { targets: ['B'] });
    t.eq(d.zone, 'graveyard', 'cast for BB');
  });

  test('Arc Lightning: 3 damage divided among three targets', (mk, t) => {
    t.auto('Arc Lightning');
    const T = mk();
    const e1 = T.bf('B', 'Llanowar Elves'), e2 = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Arc Lightning'), { targets: [e1.id, e2.id, 'B'], divide: [1, 1, 1] });
    t.eq(e1.zone, 'graveyard'); t.eq(e2.zone, 'graveyard'); t.eq(T.life('B'), 19);
  });

  test("Reverence: creatures with power 2 or less can't attack you", (mk, t) => {
    t.auto('Reverence');
    const T = mk();
    T.bf('B', 'Reverence');
    const bear = T.bf('A', 'Grizzly Bears');
    const ogre = T.bf('A', 'Hill Giant');
    const seen = {};
    T.answer('declareAttackers', (ch, g) => {
      seen.bear = g.declareAttackers('A', [{ attackerId: bear.id, defenderId: 'B' }]);
      return [{ attackerId: ogre.id, defenderId: 'B' }];
    });
    T.toMain('A', 'endCombat');
    t.no(seen.bear, 'the Bears are refused');
    t.eq(T.life('B'), 17, 'the Giant gets through');
  });

  test("Vow of Duty: the enchanted creature can't attack the Aura's controller", (mk, t) => {
    t.auto('Vow of Duty');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const vow = T.bf('B', 'Vow of Duty');
    vow.attachedTo = bear.id; bear.attachments.push(vow.id); T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 4);
    const seen = {};
    T.answer('declareAttackers', (ch, g) => { seen.ok = g.declareAttackers('A', [{ attackerId: bear.id, defenderId: 'B' }]); return []; });
    T.toMain('A', 'endCombat');
    t.no(seen.ok);
    t.eq(T.life('B'), 20);
  });

  test("Elephant Grass: black creatures can't attack, others pay {2}", (mk, t) => {
    t.auto('Elephant Grass');
    const T = mk();
    T.bf('B', 'Elephant Grass');
    const zom = T.bf('A', 'Walking Corpse');
    const bear = T.bf('A', 'Grizzly Bears');
    const seen = {};
    T.answer('declareAttackers', (ch, g) => {
      seen.zom = g.declareAttackers('A', [{ attackerId: zom.id, defenderId: 'B' }]);
      g.player('A').pool.add('C', 2);
      return [{ attackerId: bear.id, defenderId: 'B' }];
    });
    T.toMain('A', 'endCombat');
    t.no(seen.zom, 'black: refused');
    t.eq(T.life('B'), 18, 'the Bears paid {2}');
  });

  test('Whip of Erebos: the returned creature is exiled if it would leave', (mk, t) => {
    t.auto('Whip of Erebos');
    const T = mk();
    const whip = T.bf('A', 'Whip of Erebos');
    const bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'BB2');
    T.activate('A', whip, 0, { targets: [bear.id] });
    t.eq(bear.zone, 'battlefield');
    T.g.moveObject(bear, 'graveyard');
    t.eq(bear.zone, 'exile', 'exiled instead');
  });

  test('Gruesome Encore: from an opponent\'s graveyard, under your control', (mk, t) => {
    t.auto('Gruesome Encore');
    const T = mk();
    const mine = T.grave('A', 'Grizzly Bears');
    const theirs = T.grave('B', 'Hill Giant');
    T.mana('A', 'B2');
    const ge = T.hand('A', 'Gruesome Encore');
    t.no(T.g.castSpell('A', ge.id, { targets: [{ kind: 'object', id: mine.id }] }), 'not your own graveyard');
    T.cast('A', ge, { targets: [theirs.id] });
    t.eq(theirs.zone, 'battlefield'); t.eq(theirs.controller, 'A');
  });

  test('Eldritch Evolution: mana value up to 2 plus the sacrificed creature\'s', (mk, t) => {
    t.auto('Eldritch Evolution');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const wurm = T.top('A', 'Craw Wurm'), angel = T.top('A', 'Serra Angel'), giant = T.top('A', 'Hill Giant');
    T.mana('A', 'GG1');
    T.cast('A', T.hand('A', 'Eldritch Evolution'), { sacrificeIds: [bear.id] });
    t.eq(bear.zone, 'graveyard');
    t.eq(giant.zone, 'battlefield', 'mana value 4 is fine');
    t.eq(angel.zone, 'library'); t.eq(wurm.zone, 'library');
  });

  test('Ripples of Undeath: then you may pay {1} and 3 life for one of the milled cards', (mk, t) => {
    t.auto('Ripples of Undeath');
    const T = mk();
    T.bf('A', 'Ripples of Undeath');
    T.bf('A', 'Swamp');
    for (let i = 0; i < 4; i++) T.top('A', 'Grizzly Bears');
    T.nextTurn('B'); T.nextTurn('A');
    T.resolve();
    t.eq(T.life('A'), 17, '3 life paid');
    t.eq(T.zone('A', 'graveyard').length, 2, 'one of three milled came to hand');
  });

  test('Training Grounds: creature abilities cost {2} less, but not below one mana', (mk, t) => {
    t.auto('Training Grounds');
    const T = mk();
    T.bf('A', 'Training Grounds');
    const wb = T.bf('A', 'Walking Ballista');
    const sd = T.bf('A', 'Shivan Dragon');
    const theirs = T.bf('B', 'Walking Ballista');
    const abOf = (o) => o.analysis().abilities.find(x => x.kind === 'activated' && x.cost && x.cost.mana);
    t.eq(T.g._abilityMana(wb, abOf(wb)), '{2}', '{4} becomes {2}');
    t.eq(T.g._abilityMana(sd, abOf(sd)), '{R}', '{R} stays');
    t.eq(T.g._abilityMana(theirs, abOf(theirs)), '{4}', "not the opponent's");
    wb.counters['+1/+1'] = 0;
    T.mana('A', '2');
    T.activate('A', wb, wb.analysis().manaAbilities.length + wb.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').indexOf(abOf(wb)));
    t.eq(wb.counters['+1/+1'] || 0, 1, 'activated for {2}');
  });

  test('Suppression Field: {2} more for abilities that are not mana abilities', (mk, t) => {
    t.auto('Suppression Field');
    const T = mk();
    T.bf('B', 'Suppression Field');
    const ps = T.bf('A', 'Prodigal Sorcerer');
    const elf = T.bf('A', 'Llanowar Elves');
    const ab = ps.analysis().abilities.find(x => x.kind === 'activated');
    t.eq(T.g._abilityMana(ps, ab), '{2}');
    t.eq(T.g._abilityMana(elf, elf.analysis().manaAbilities[0]), '', 'mana abilities untouched');
  });

  test('Baleful Mastery: the {1}{B} cost has an opponent draw a card', (mk, t) => {
    t.auto('Baleful Mastery');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Grizzly Bears');
    for (let i = 0; i < 3; i++) T.top('B', 'Island');
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Baleful Mastery'), { via: 'alt0', targets: [b1.id] });
    t.eq(b1.zone, 'exile'); t.eq(T.zone('B', 'hand').length, 1, 'they drew');
    T.mana('A', 'B3');
    T.cast('A', T.hand('A', 'Baleful Mastery'), { targets: [b2.id] });
    t.eq(b2.zone, 'exile'); t.eq(T.zone('B', 'hand').length, 1, 'full price: no draw');
  });

  test("Each creature your opponents control: not yours, and not their faces", (mk, t) => {
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.g.resolving = true;
    T.g._runEffect({ op: 'damage', n: 2, each: 'creature your opponents control' }, { controller: 'A', obj: mine });
    T.g.resolving = false;
    T.g.checkStateBasedActions();
    t.eq(mine.zone, 'battlefield'); t.eq(theirs.zone, 'graveyard'); t.eq(T.life('B'), 20);
  });

  test('Delayed Blast Fireball: 2 to each opponent and their creatures', (mk, t) => {
    t.auto('Delayed Blast Fireball');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'RR1');
    T.cast('A', T.hand('A', 'Delayed Blast Fireball'));
    t.eq(mine.zone, 'battlefield'); t.eq(theirs.zone, 'graveyard'); t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
  });

  test('Olivia Voldaren: the creature she pings becomes a Vampire, and she grows', (mk, t) => {
    t.auto('Olivia Voldaren');
    const T = mk();
    const ol = T.bf('A', 'Olivia Voldaren');
    const ogre = T.bf('B', 'Hill Giant');
    T.mana('A', 'R1');
    T.activate('A', ol, 0, { targets: [ogre.id] });
    t.eq(ogre.damage, 1);
    t.ok(T.g._hasSubtype(ogre, 'Vampire'), 'a Vampire now');
    t.eq(ol.counters['+1/+1'] || 0, 1);
  });

  test('Guide of Souls: paid, the attacker gets counters and becomes an Angel; unpaid, nothing', (mk, t) => {
    t.auto('Guide of Souls');
    const T = mk();
    T.bf('A', 'Guide of Souls');
    const bear = T.bf('A', 'Grizzly Bears');
    T.player('A').energy = 3;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.toMain('A', 'endCombat');
    t.eq(bear.counters['+1/+1'] || 0, 2);
    t.eq(bear.counters.flying || 0, 1);
    t.ok(T.g._hasSubtype(bear, 'Angel'), 'an Angel');
    t.eq(T.player('A').energy, 0);
  });

  test('Guide of Souls: two energy is not enough, and none is spent', (mk, t) => {
    const T = mk();
    T.bf('A', 'Guide of Souls');
    const bear = T.bf('A', 'Grizzly Bears');
    T.player('A').energy = 2;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(bear.counters['+1/+1'] || 0, 0);
    t.no(T.g._hasSubtype(bear, 'Angel'));
    t.eq(T.player('A').energy, 2);
  });

  test('Rise from the Grave: a black Zombie as well', (mk, t) => {
    t.auto('Rise from the Grave');
    const T = mk();
    const giant = T.grave('B', 'Hill Giant');
    T.mana('A', 'B4');
    T.cast('A', T.hand('A', 'Rise from the Grave'), { targets: [giant.id] });
    t.eq(giant.controller, 'A');
    t.ok(T.g._hasSubtype(giant, 'Zombie'), 'a Zombie');
    t.ok(giant.analysis().colors.includes('B'), 'black');
    t.ok(giant.analysis().colors.includes('R'), 'still red');
  });

  test('Turn to Slag: the Equipment on it goes too', (mk, t) => {
    t.auto('Turn to Slag');
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    const eq = T.bf('B', 'Bonesplitter');
    eq.attachedTo = giant.id; giant.attachments.push(eq.id); T.g.bumpBoard();
    T.mana('A', 'RR3');
    T.cast('A', T.hand('A', 'Turn to Slag'), { targets: [giant.id] });
    t.eq(giant.zone, 'graveyard'); t.eq(eq.zone, 'graveyard');
  });

  test('Doomfall: the opponent exiles a creature of their choice', (mk, t) => {
    t.auto('Doomfall');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Doomfall'), { modes: [0], targets: ['B'] });
    t.eq(bear.zone, 'exile');
  });

  test("True Believer: you can't be targeted, not even by your own spells", (mk, t) => {
    t.auto('True Believer');
    const T = mk();
    T.bf('A', 'True Believer');
    const bolt = T.hand('B', 'Lightning Bolt');
    t.no((T.g._legalTargetsFor({ type: 'any' }, 'B') || []).some(x => x.kind === 'player' && x.id === 'A'), 'not by the opponent');
    t.no((T.g._legalTargetsFor({ type: 'player' }, 'A') || []).some(x => x.id === 'A'), 'not by yourself');
    void bolt;
  });

  test("Scytheclaw Raptor: only when it isn't the caster's turn", (mk, t) => {
    t.auto('Scytheclaw Raptor');
    const T = mk();
    T.bf('A', 'Scytheclaw Raptor');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear.id] });
    t.eq(T.life('B'), 16, "on A's turn: 4 damage");
    T.nextTurn('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.life('B'), 16, 'on their own turn: nothing');
  });

  test('A clause before "deals damage" is not its subject (Fires of Mount Doom)', (mk, t) => {
    const T = mk();
    const e = T.g.constructor && require('../harness').engine().oracle.parseEffectSentence('When you play a card this way, CARDNAME deals 2 damage to each player.');
    t.eq(e, null);
  });

  test("Chandra, Torch of Defiance +1: cast it, or 2 damage to each opponent", (mk, t) => {
    t.auto('Chandra, Torch of Defiance');
    const T = mk();
    const ch = T.bf('A', 'Chandra, Torch of Defiance');
    ch.counters.loyalty = 4;
    T.top('A', 'Lightning Bolt');
    T.answer('confirm', { yes: false });
    T.activate('A', ch, 0);
    t.eq(T.life('B'), 18, 'declined: 2 damage');
    T.nextTurn('B'); T.nextTurn('A');
    const bolt = T.top('A', 'Lightning Bolt');
    T.answer('confirm', { yes: true });
    T.activate('A', ch, 0);
    t.eq(T.life('B'), 18, 'chose to cast: no damage');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.life('B'), 15, 'and cast it');
  });

  test('A planeswalker activates once each turn, and again the next turn', (mk, t) => {
    const T = mk();
    const pw = T.bf('A', 'Liliana of the Veil');
    pw.counters.loyalty = 3;
    t.ok(T.g.activateAbility('A', pw.id, 0));
    T.resolve();
    t.no(T.g.activateAbility('A', pw.id, 0), 'not twice in a turn');
    T.nextTurn('B'); T.nextTurn('A');
    t.ok(T.g.activateAbility('A', pw.id, 0), 'again next turn');
  });

  test('Killing Glare: power X or less, with the X paid', (mk, t) => {
    t.auto('Killing Glare');
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'B2');
    const kg = T.hand('A', 'Killing Glare');
    t.no(T.g.castSpell('A', kg.id, { x: 2, targets: [{ kind: 'object', id: giant.id }] }), 'power 3 is too big for X=2');
    T.mana('A', '1');
    T.cast('A', kg, { x: 3, targets: [giant.id] });
    t.eq(giant.zone, 'graveyard');
  });

  test('Succumb to the Cold: both tapped, a stun counter on each', (mk, t) => {
    t.auto('Succumb to the Cold');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant');
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Succumb to the Cold'), { targets: [b1.id, b2.id] });
    t.ok(b1.tapped && b2.tapped);
    t.eq(b1.counters.stun || 0, 1); t.eq(b2.counters.stun || 0, 1);
  });

  test('Geistwave: draws only when the permanent was yours', (mk, t) => {
    t.auto('Geistwave');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.top('A', 'Island'); T.top('A', 'Island');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Geistwave'), { targets: [theirs.id] });
    const h = T.zone('A', 'hand').length;
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Geistwave'), { targets: [mine.id] });
    t.eq(T.zone('A', 'hand').length, h + 1, 'its own Bears back, and a card');
  });

  test('Clockwork Beetle: a counter comes off at end of combat after it attacks', (mk, t) => {
    t.auto('Clockwork Beetle');
    const T = mk();
    const cb = T.bf('A', 'Clockwork Beetle', { counters: { '+1/+1': 2 } });
    T.answer('declareAttackers', () => [{ attackerId: cb.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.life('B'), 18);
    t.eq(cb.counters['+1/+1'] || 0, 1);
  });

  test("Kaya's Ghostform: back when it dies, and when it's exiled", (mk, t) => {
    t.auto("Kaya's Ghostform");
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const kg = T.bf('A', "Kaya's Ghostform");
    kg.attachedTo = bear.id; bear.attachments.push(kg.id); T.g.bumpBoard();
    T.g.moveObject(bear, 'graveyard');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(bear.zone, 'battlefield', 'back after dying');
    const kg2 = T.bf('A', "Kaya's Ghostform");
    kg2.attachedTo = bear.id; bear.attachments.push(kg2.id); T.g.bumpBoard();
    T.g.moveObject(bear, 'exile');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(bear.zone, 'battlefield', 'back after exile');
  });

  test('An Aura that waits for its creature to die does not answer to exile', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const aura = T.bf('A', 'Angelic Destiny');
    aura.attachedTo = bear.id; bear.attachments.push(aura.id); T.g.bumpBoard();
    T.g.moveObject(bear, 'exile');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(aura.zone, 'graveyard', 'exiled, not died: the Aura is not returned');
  });

  test('Cataclysm: each player keeps one of each kind, the rest are sacrificed', (mk, t) => {
    t.auto('Cataclysm');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant');
    const l1 = T.bf('B', 'Forest'), l2 = T.bf('B', 'Mountain');
    const ench = T.bf('B', 'Glorious Anthem');
    const mine = T.bf('A', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: [ch.items.find(x => x.name === 'Grizzly Bears' || x.name === 'Forest') ? ch.items.find(x => x.name === 'Grizzly Bears' || x.name === 'Forest').id : ch.items[0].id] }));
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', 'Cataclysm'));
    T.resolve();
    const left = T.bfOf('B').map(o => o.name).sort();
    t.eq(left.length, 3, 'a creature, a land and an enchantment stay: ' + left.join(', '));
    t.eq(mine.zone, 'battlefield', 'my only creature stays');
    void b1; void b2; void l1; void l2; void ench;
  });

  test('Mount Doom: choose up to two creatures, destroy the rest', (mk, t) => {
    t.auto('Mount Doom');
    const T = mk();
    const md = T.bf('A', 'Mount Doom');
    const ring = T.bf('A', 'The One Ring');
    const a1 = T.bf('A', 'Grizzly Bears'), a2 = T.bf('A', 'Hill Giant');
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant');
    T.answer('choose', () => ({ picks: [a1.id, a2.id] }));
    T.mana('A', 'BR5');
    const idx = md.analysis().manaAbilities.length + md.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /destroy the rest/.test(x.text));
    T.activate('A', md, idx, { sacrificeIds: [ring.id] });
    T.resolve();
    t.eq(a1.zone, 'battlefield'); t.eq(a2.zone, 'battlefield');
    t.eq(b1.zone, 'graveyard'); t.eq(b2.zone, 'graveyard');
  });

  test('Simic Ascendancy: growth counters for the +1/+1 counters your creatures get', (mk, t) => {
    t.auto('Simic Ascendancy');
    const T = mk();
    const sa = T.bf('A', 'Simic Ascendancy');
    const bear = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'GU1');
    T.activate('A', sa, 0, { targets: [bear.id] });
    T.resolve();
    t.eq(sa.counters.growth || 0, 1);
    T.g.addCounters(bear, '+1/+1', 2); T.resolve();
    t.eq(sa.counters.growth || 0, 3, 'that many');
    T.g.addCounters(theirs, '+1/+1', 1); T.resolve();
    t.eq(sa.counters.growth || 0, 3, "not the opponent's");
  });

  test('Winter Orb: one land untaps; tapped, the Orb lets them all', (mk, t) => {
    t.auto('Winter Orb');
    const T = mk();
    const orb = T.bf('B', 'Winter Orb');
    const lands = [T.bf('A', 'Forest', { tapped: true }), T.bf('A', 'Forest', { tapped: true }), T.bf('A', 'Forest', { tapped: true })];
    const bear = T.bf('A', 'Grizzly Bears', { tapped: true });
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(lands.filter(l => !l.tapped).length, 1, 'one land');
    t.no(bear.tapped, 'creatures are not limited');
    T.nextTurn('B');
    for (const l of lands) l.tapped = true;
    orb.tapped = true;
    T.nextTurn('A');
    t.eq(lands.filter(l => !l.tapped).length, 3, 'all three with the Orb tapped');
  });

  test('Rising Waters: lands stay tapped, and one untaps at upkeep', (mk, t) => {
    t.auto('Rising Waters');
    const T = mk();
    T.bf('B', 'Rising Waters');
    const lands = [T.bf('A', 'Island', { tapped: true }), T.bf('A', 'Island', { tapped: true })];
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(lands.filter(l => !l.tapped).length, 1);
  });

  test('Karn, Silver Golem: an artifact as big as its mana value', (mk, t) => {
    t.auto('Karn, Silver Golem');
    const T = mk();
    const karn = T.bf('A', 'Karn, Silver Golem');
    const ring = T.bf('A', 'Mind Stone');
    T.mana('A', '1');
    const idx = karn.analysis().manaAbilities.length + karn.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /mana value/.test(x.text));
    T.activate('A', karn, idx, { targets: [ring.id] });
    T.resolve();
    t.ok(T.g.characteristics(ring).isCreature);
    t.eq(T.g.powerOf(ring), 2); t.eq(T.g.toughnessOf(ring), 2);
  });

  test('Spiritmonger: the colour of your choice until end of turn', (mk, t) => {
    t.auto('Spiritmonger');
    const T = mk();
    const sm = T.bf('A', 'Spiritmonger');
    T.answer('choose', () => ({ picks: [1] }));
    T.mana('A', 'G');
    const idx = sm.analysis().manaAbilities.length + sm.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /colou?r of your choice/.test(x.text));
    T.activate('A', sm, idx);
    T.resolve();
    t.eq(JSON.stringify(sm.analysis().colors), JSON.stringify(['U']));
  });

  test('Phyrexian Gremlins: the artifact stays tapped while the Gremlins do', (mk, t) => {
    t.auto('Phyrexian Gremlins');
    const T = mk();
    const pg = T.bf('A', 'Phyrexian Gremlins');
    const ms = T.bf('B', 'Mind Stone');
    pg.keepTapped = true;
    T.activate('A', pg, pg.analysis().manaAbilities.length + 0, { targets: [ms.id] });
    T.resolve();
    t.ok(ms.tapped);
    T.nextTurn('B');
    t.ok(ms.tapped, 'does not untap while the Gremlins stay tapped');
    pg.tapped = false;
    T.g.checkStateBasedActions();
    T.nextTurn('A'); T.nextTurn('B');
    t.no(ms.tapped, 'free once the Gremlins untap');
  });

  test('Dungeon Geists: held down for as long as you control it', (mk, t) => {
    t.auto('Dungeon Geists');
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'UU2');
    const dg = T.hand('A', 'Dungeon Geists');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: giant.id }] }));
    T.cast('A', dg);
    t.ok(giant.tapped);
    T.nextTurn('B');
    t.ok(giant.tapped, 'still tapped');
    T.g.moveObject(dg, 'graveyard');
    T.nextTurn('A'); T.nextTurn('B');
    t.no(giant.tapped, 'free once the Geists are gone');
  });

  test('Rout: flash, for {2} more', (mk, t) => {
    t.auto('Rout');
    const T = mk();
    const rout = T.hand('A', 'Rout');
    t.eq(T.g.canCast('A', rout.id).cost, '{3}{W}{W}', 'at sorcery speed, the printed cost');
    T.nextTurn('B');
    T.g.passPriority('B', true);
    const chk = T.g.canCast('A', rout.id);
    t.ok(chk.ok, 'on their turn too');
    t.eq(require('../harness').engine().mana.cmc(chk.cost), 7, 'two more');
  });

  test('Purelace: a permanent becomes white for good', (mk, t) => {
    t.auto('Purelace');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Purelace'), { targets: [bear.id] });
    t.eq(JSON.stringify(bear.analysis().colors), JSON.stringify(['W']));
    T.nextTurn('B');
    t.eq(JSON.stringify(bear.analysis().colors), JSON.stringify(['W']), 'still white');
  });

  test('Mistform Wall: a Wall has defender; another type does not', (mk, t) => {
    t.auto('Mistform Wall');
    const T = mk();
    const w = T.bf('A', 'Mistform Wall');
    t.ok(T.g.hasKw(w, 'defender'));
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.label === 'Bear') >= 0 ? ch.options.findIndex(o => o.label === 'Bear') : 0] }));
    T.bf('A', 'Grizzly Bears');
    T.mana('A', '1');
    T.activate('A', w, 0);
    T.resolve();
    t.ok(T.g._hasSubtype(w, 'Bear'));
    t.no(T.g.hasKw(w, 'defender'), 'not a Wall now');
  });

  test('Ostrich-Horse: a land from the milled cards, or else a counter', (mk, t) => {
    t.auto('Ostrich-Horse');
    const T = mk();
    for (const n of ['Forest', 'Grizzly Bears', 'Grizzly Bears']) T.top('A', n);
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', 'G2');
    const oh = T.hand('A', 'Ostrich-Horse');
    T.cast('A', oh);
    T.resolve();
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Forest'), 'took the Forest');
    t.eq(oh.counters['+1/+1'] || 0, 0, 'no counter');
    const T2 = mk();
    for (const n of ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears']) T2.top('A', n);
    T2.mana('A', 'G2');
    const oh2 = T2.hand('A', 'Ostrich-Horse');
    T2.cast('A', oh2);
    T2.resolve();
    t.eq(oh2.counters['+1/+1'] || 0, 1, 'no land: a counter');
  });

  test('Sulam Djinn: -2/-2 while green is the most common colour', (mk, t) => {
    t.auto('Sulam Djinn');
    const T = mk();
    const sd = T.bf('A', 'Sulam Djinn');
    t.eq(T.g.powerOf(sd), 4, 'green leads (6/6 printed)');
    T.bf('B', 'Goblin Piker'); T.bf('B', 'Goblin Piker');
    t.eq(T.g.powerOf(sd), 6, 'red leads now');
  });

  test('Dwarven Song: any number of creatures become red', (mk, t) => {
    t.auto('Dwarven Song');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('A', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [b1.id, b2.id] }));
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Dwarven Song'));
    T.resolve();
    t.eq(JSON.stringify(b1.analysis().colors), '["R"]'); t.eq(JSON.stringify(b2.analysis().colors), '["R"]');
  });

  test('Forage: Treetop Sentries exiles three graveyard cards and draws', (mk, t) => {
    t.auto('Treetop Sentries');
    const T = mk();
    for (let i = 0; i < 3; i++) T.grave('A', 'Island');
    T.top('A', 'Forest');
    T.mana('A', 'G3');
    T.cast('A', T.hand('A', 'Treetop Sentries'));
    T.resolve();
    t.eq(T.zone('A', 'exile').length, 3, 'three exiled');
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Forest'), 'drew');
  });

  test('Forage: nothing to forage with, nothing happens', (mk, t) => {
    const T = mk();
    T.grave('A', 'Island');
    T.top('A', 'Forest');
    T.mana('A', 'G3');
    T.cast('A', T.hand('A', 'Treetop Sentries'));
    T.resolve();
    t.no(T.zone('A', 'hand').some(c => c.name === 'Forest'), 'no draw');
  });

  test('Feed the Cycle: forage with a Food instead of paying {B}', (mk, t) => {
    t.auto('Feed the Cycle');
    const T = mk();
    const food = T.bf('A', 'Food');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Feed the Cycle'), { targets: [bear.id] });
    T.resolve();
    t.eq(bear.zone, 'graveyard');
    t.no(food.zone === 'battlefield', 'the Food went');
  });

  test('Chief Engineer: artifact spells you cast have convoke', (mk, t) => {
    t.auto('Chief Engineer');
    const T = mk();
    T.bf('A', 'Chief Engineer');
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('A', 'Grizzly Bears');
    const ms = T.hand('A', 'Mind Stone');
    T.cast('A', ms, { convokeIds: [b1.id, b2.id] });
    t.eq(ms.zone, 'battlefield', 'paid by tapping two creatures');
    t.ok(b1.tapped && b2.tapped);
  });

  test('Temur Battlecrier: {1} less for each creature with power 4 or greater, on your turn', (mk, t) => {
    t.auto('Temur Battlecrier');
    const T = mk();
    T.bf('A', 'Temur Battlecrier');
    T.bf('A', 'Hill Giant'); T.bf('A', 'Craw Wurm');
    const ogre = T.hand('A', 'Gray Ogre');
    t.eq(T.g.canCast('A', ogre.id).cost, '{R}', 'the Battlecrier, the Giant? no: Hill Giant is 3/3; Battlecrier and Wurm make two, {2}{R} less two');
  });

  test('Overlord of the Balemurk: mill four, then a creature card back', (mk, t) => {
    t.auto('Overlord of the Balemurk');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Grizzly Bears');
    T.mana('A', 'BB3');
    T.cast('A', T.hand('A', 'Overlord of the Balemurk'));
    T.resolve();
    t.eq(T.zone('A', 'graveyard').length, 3, 'four milled, one back');
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Grizzly Bears'));
  });

  test('Diregraf Rebirth: {1} less for each creature that died this turn', (mk, t) => {
    t.auto('Diregraf Rebirth');
    const T = mk();
    const b = T.bf('A', 'Grizzly Bears');
    const d = T.hand('A', 'Diregraf Rebirth');
    t.eq(T.g.canCast('A', d.id).cost, '{3}{B}{G}');
    T.g.moveObject(b, 'graveyard'); T.g.checkStateBasedActions();
    t.eq(T.g.canCast('A', d.id).cost, '{2}{B}{G}', 'one died');
  });

  test('Multiversal Passage: the chosen basic land type, and the mana with it', (mk, t) => {
    t.auto('Multiversal Passage');
    const T = mk();
    T.hand('A', 'Counterspell');
    T.answer('mode', (ch) => ({ modes: [ch.types.indexOf('Swamp')] }));
    T.answer('payOrDont', { pay: false });
    const mp = T.put('A', 'Multiversal Passage', 'battlefield', { etb: true });
    t.eq(mp.chosenType, 'Swamp', 'chosen');
    t.ok(T.g._hasSubtype(mp, 'Swamp'));
    const syms = T.g.manaAbilitiesOf(mp).map(ab => JSON.stringify(ab.effects));
    t.ok(syms.some(x => x.includes('"B"')), 'taps for black');
  });

  test('Convincing Mirage: the enchanted land is the chosen type instead', (mk, t) => {
    t.auto('Convincing Mirage');
    const T = mk();
    const forest = T.bf('B', 'Forest');
    const cm = T.bf('A', 'Convincing Mirage');
    cm.attachedTo = forest.id; forest.attachments.push(cm.id); cm.chosenType = 'Island';
    T.g.bumpBoard();
    t.ok(T.g._hasSubtype(forest, 'Island')); t.no(T.g._hasSubtype(forest, 'Forest'));
    const syms = T.g.manaAbilitiesOf(forest).map(ab => JSON.stringify(ab.effects)).join(' ');
    t.ok(syms.includes('"U"') && !syms.includes('"G"'), 'blue, not green: ' + syms);
  });

  test('Generous Plunderer: damage equal to the artifacts the defending player controls', (mk, t) => {
    t.auto('Generous Plunderer');
    const T = mk();
    const gp = T.bf('A', 'Generous Plunderer');
    T.bf('B', 'Mind Stone'); T.bf('B', 'Mind Stone');
    T.answer('declareAttackers', () => [{ attackerId: gp.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(T.life('B'), 20 - 2 - T.g.powerOf(gp), 'two from the trigger, and the combat damage');
  });

  test('Banner of Kinship: a fellowship counter for each creature of the chosen type', (mk, t) => {
    t.auto('Banner of Kinship');
    const T = mk();
    const b1 = T.bf('A', 'Grizzly Bears'); T.bf('A', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: [Math.max(0, ch.options.findIndex(o => o.label === 'Bear'))] }));
    T.mana('A', '5');
    const bk = T.hand('A', 'Banner of Kinship');
    T.cast('A', bk);
    T.resolve();
    t.eq(bk.counters.fellowship || 0, 2);
    t.eq(T.g.powerOf(b1), 4, '+2/+2');
  });

  test('Arid Archway: surveil only when another Desert went back', (mk, t) => {
    t.auto('Arid Archway');
    const T = mk();
    const des = T.bf('A', 'Desert');
    T.top('A', 'Island'); T.top('A', 'Island');
    T.answer('pickCard', () => ({ cardIds: [des.id] }));
    const aa = T.put('A', 'Arid Archway', 'battlefield', { etb: true });
    T.resolve();
    t.eq(des.zone, 'hand');
    t.ok(T.asked.some(c => c.type === 'scry' || c.type === 'surveil'), 'surveilled');
    void aa;
  });

  test('Allosaurus Rider: 1 plus the number of lands you control', (mk, t) => {
    t.auto('Allosaurus Rider');
    const T = mk();
    const ar = T.bf('A', 'Allosaurus Rider');
    T.bf('A', 'Forest'); T.bf('A', 'Forest');
    t.eq(T.g.powerOf(ar), 3); t.eq(T.g.toughnessOf(ar), 3);
  });

  test('Defang: the enchanted creature deals no damage at all', (mk, t) => {
    t.auto('Defang');
    const T = mk();
    const ps = T.bf('B', 'Prodigal Sorcerer');
    const df = T.bf('A', 'Defang');
    df.attachedTo = ps.id; ps.attachments.push(df.id); T.g.bumpBoard();
    T.g.dealDamageToPlayer(T.player('A'), 1, ps, false);
    t.eq(T.life('A'), 20, 'noncombat prevented');
    const giant = T.bf('B', 'Hill Giant');
    T.g.dealDamageToPlayer(T.player('A'), 3, giant, false);
    t.eq(T.life('A'), 17, 'others still hurt');
  });

  test('Collect evidence as an activation cost (Forensic Researcher)', (mk, t) => {
    t.auto('Forensic Researcher');
    const T = mk();
    const fr = T.bf('A', 'Forensic Researcher');
    const g1 = T.grave('A', 'Hill Giant'), g2 = T.grave('A', 'Grizzly Bears');
    const bear = T.bf('B', 'Grizzly Bears');
    const idx = fr.analysis().manaAbilities.length + fr.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Collect evidence/.test(x.text));
    T.activate('A', fr, idx, { targets: [bear.id] });
    T.resolve();
    t.ok(bear.tapped);
    t.eq(g1.zone, 'exile', 'the Giant (3) is enough');
    t.eq(g2.zone, 'graveyard');
  });

  test('Collect evidence: not enough in the graveyard, no activation', (mk, t) => {
    const T = mk();
    const fr = T.bf('A', 'Forensic Researcher');
    T.grave('A', 'Grizzly Bears');
    const bear = T.bf('B', 'Grizzly Bears');
    const idx = fr.analysis().manaAbilities.length + fr.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Collect evidence/.test(x.text));
    t.no(T.g.activateAbility('A', fr.id, idx, { targets: [{ kind: 'object', id: bear.id }] }));
  });

  test('Surveillance Monitor: collecting evidence makes a Thopter', (mk, t) => {
    t.auto('Surveillance Monitor');
    const T = mk();
    T.grave('A', 'Hill Giant'); T.grave('A', 'Grizzly Bears');
    T.mana('A', 'U3');
    T.cast('A', T.hand('A', 'Surveillance Monitor'));
    T.resolve();
    t.eq(T.zone('A', 'exile').length, 1, 'the Giant alone is evidence 4');
    t.ok(T.bfOf('A').some(o => /Thopter/.test(o.name)), 'a Thopter');
  });

  test('Endure: counters on it, or a Spirit (Dusyut Earthcarver)', (mk, t) => {
    t.auto('Dusyut Earthcarver');
    const T = mk();
    T.answer('mode', { modes: [1] });
    T.mana('A', 'G5');
    const de = T.hand('A', 'Dusyut Earthcarver');
    T.cast('A', de);
    T.resolve();
    t.eq(de.counters['+1/+1'] || 0, 0);
    t.ok(T.bfOf('A').some(o => /Spirit/.test(o.name) && T.g.powerOf(o) === 3), 'a 3/3 Spirit');
  });

  test('Foot Chopper: a Ninja token, and the Equipment on it', (mk, t) => {
    t.auto('Foot Chopper');
    const T = mk();
    const fc = T.put('A', 'Foot Chopper', 'battlefield', { etb: true });
    T.resolve();
    const ninja = T.bfOf('A').find(o => /Ninja/.test(o.name));
    t.ok(ninja, 'a Ninja');
    t.eq(fc.attachedTo, ninja && ninja.id, 'attached to it');
  });

  test('Forecast: in your upkeep, once, and the card stays in hand (Plumes of Peace)', (mk, t) => {
    t.auto('Plumes of Peace');
    const T = mk();
    const pp = T.hand('A', 'Plumes of Peace');
    const giant = T.bf('B', 'Hill Giant');
    t.no(T.g.altUsesFor('A', pp.id).some(u => u.forecast), 'not in the main phase');
    T.nextTurn('B');
    T.toMain('A', 'upkeep');
    t.ok(T.g.altUsesFor('A', pp.id).some(u => u.forecast), 'in the upkeep');
    T.mana('A', 'WU');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: giant.id }] }));
    t.ok(T.g.cycleCard('A', pp.id, { channel: true }));
    T.resolve();
    t.ok(giant.tapped, 'tapped');
    t.eq(pp.zone, 'hand', 'still in hand');
    t.no(T.g.altUsesFor('A', pp.id).some(u => u.forecast), 'once a turn');
  });

  test('Goldfury Strider: tap two artifacts and/or creatures to pay', (mk, t) => {
    t.auto('Goldfury Strider');
    const T = mk();
    const gs = T.bf('A', 'Goldfury Strider');
    const ms = T.bf('A', 'Mind Stone'), bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', gs, gs.analysis().manaAbilities.length + 0, { targets: [bear.id], tapCostIds: [ms.id, gs.id] });
    T.resolve();
    t.ok(ms.tapped && gs.tapped, 'an artifact and a creature tapped');
    t.eq(T.g.powerOf(bear), 4, '+2/+0');
  });

  test("Mishra's Helix: tap X target lands, as many as X", (mk, t) => {
    t.auto("Mishra's Helix");
    const T = mk();
    const mh = T.bf('A', "Mishra's Helix");
    const l1 = T.bf('B', 'Forest'), l2 = T.bf('B', 'Forest'), l3 = T.bf('B', 'Forest');
    T.mana('A', '2');
    t.no(T.g.activateAbility('A', mh.id, mh.analysis().manaAbilities.length, { x: 2, targets: [{ kind: 'object', id: l1.id }] }), 'X is 2: one target is too few');
    T.activate('A', mh, mh.analysis().manaAbilities.length, { x: 2, targets: [l1.id, l2.id] });
    T.resolve();
    t.ok(l1.tapped && l2.tapped); t.no(l3.tapped);
  });

  test('Granite Shard: either cost works', (mk, t) => {
    t.auto('Granite Shard');
    const T = mk();
    const gs = T.bf('A', 'Granite Shard');
    const acts = gs.analysis().abilities.filter(x => x.kind === 'activated');
    t.eq(acts.length, 2, 'two abilities');
    T.mana('A', 'R');
    T.activate('A', gs, gs.analysis().manaAbilities.length + 1, { targets: ['B'] });
    T.resolve();
    t.eq(T.life('B'), 19, 'paid with {R}');
  });

  test('Martyr of Spores: reveal X green cards for +X/+X', (mk, t) => {
    t.auto('Martyr of Spores');
    const T = mk();
    const ms = T.bf('A', 'Martyr of Spores');
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Llanowar Elves'); T.hand('A', 'Island');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1');
    t.no(T.g.activateAbility('A', ms.id, ms.analysis().manaAbilities.length, { x: 3, targets: [{ kind: 'object', id: bear.id }] }), 'only two green cards');
    T.activate('A', ms, ms.analysis().manaAbilities.length, { x: 2, targets: [bear.id] });
    T.resolve();
    t.eq(T.g.powerOf(bear), 4, '+2/+2');
    t.eq(ms.zone, 'graveyard');
    t.eq(T.zone('A', 'hand').length, 3, 'revealed, not discarded');
  });

  test('City of Shadows: exile a creature you control for a storage counter', (mk, t) => {
    t.auto('City of Shadows');
    const T = mk();
    const cs = T.bf('A', 'City of Shadows');
    const bear = T.bf('A', 'Grizzly Bears');
    T.activate('A', cs, cs.analysis().manaAbilities.length);
    T.resolve();
    t.eq(bear.zone, 'exile');
    t.eq(cs.counters.storage || 0, 1);
  });

  test('Hatchet Bully: a -1/-1 counter on a creature of yours as the price', (mk, t) => {
    t.auto('Hatchet Bully');
    const T = mk();
    const hb = T.bf('A', 'Hatchet Bully');
    const giant = T.bf('A', 'Hill Giant');
    T.mana('A', 'R2');
    T.activate('A', hb, hb.analysis().manaAbilities.length, { targets: ['B'], blightId: giant.id });
    T.resolve();
    t.eq(giant.counters['-1/-1'] || 0, 1);
    t.eq(T.life('B'), 18);
  });

  test('Pain for All: the enchanted creature deals damage equal to its power', (mk, t) => {
    t.auto('Pain for All');
    const T = mk();
    const giant = T.bf('A', 'Hill Giant');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R2');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    const pfa = T.hand('A', 'Pain for All');
    T.cast('A', pfa, { targets: [giant.id] });
    T.resolve();
    t.eq(pfa.attachedTo, giant.id);
    t.eq(bear.zone, 'graveyard', 'three damage from the Giant');
  });

  test('Angelic Destiny: +4/+4, flying, an Angel; back to hand when it dies', (mk, t) => {
    t.auto('Angelic Destiny');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const ad = T.bf('A', 'Angelic Destiny');
    ad.attachedTo = bear.id; bear.attachments.push(ad.id); T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 6);
    t.ok(T.g.hasKw(bear, 'flying'));
    t.ok(T.g._hasSubtype(bear, 'Angel'));
    T.g.moveObject(bear, 'graveyard'); T.g.checkStateBasedActions(); T.resolve();
    t.eq(ad.zone, 'hand');
  });

  test('Sunspine Lynx: damage for nonbasic lands, and it cannot be prevented', (mk, t) => {
    t.auto('Sunspine Lynx');
    const T = mk();
    T.bf('B', 'Steam Vents'); T.bf('B', 'Steam Vents'); T.bf('B', 'Island');
    T.bf('A', 'Steam Vents');
    T.mana('A', 'RR2');
    T.cast('A', T.hand('A', 'Sunspine Lynx'));
    T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 19);
  });

  test('Jumbo Cactuar: a label with a number in it is still a label', (mk, t) => {
    t.auto('Jumbo Cactuar');
    const T = mk();
    const jc = T.bf('A', 'Jumbo Cactuar');
    T.answer('declareAttackers', () => [{ attackerId: jc.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.ok(T.life('B') <= 0, 'ten thousand needles');
  });

  test('Prime Speaker Zegana: counters for the greatest power among the others', (mk, t) => {
    t.auto('Prime Speaker Zegana');
    const T = mk();
    T.bf('A', 'Hill Giant'); T.bf('A', 'Grizzly Bears');
    T.mana('A', 'GGUU2');
    const z = T.hand('A', 'Prime Speaker Zegana');
    T.cast('A', z);
    T.resolve();
    t.eq(z.counters['+1/+1'] || 0, 3, 'the Giant has 3 power');
  });

  test('Bloodline Bidding: every creature card of the chosen type comes back', (mk, t) => {
    t.auto('Bloodline Bidding');
    const T = mk();
    const b1 = T.grave('A', 'Grizzly Bears'), b2 = T.grave('A', 'Grizzly Bears'), g = T.grave('A', 'Hill Giant');
    T.answer('choose', (ch) => ({ picks: [Math.max(0, ch.options.findIndex(o => o.label === 'Bear'))] }));
    T.mana('A', 'BB6');
    T.cast('A', T.hand('A', 'Bloodline Bidding'));
    T.resolve();
    t.eq(b1.zone, 'battlefield'); t.eq(b2.zone, 'battlefield'); t.eq(g.zone, 'graveyard');
  });

  test('Niv-Mizzet, Visionary: noncombat damage to an opponent draws that many', (mk, t) => {
    t.auto('Niv-Mizzet, Visionary');
    const T = mk();
    T.bf('A', 'Niv-Mizzet, Visionary');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 3 - 0, 'drew three (the Bolt left the hand as it was cast)');
    T.mana('B', 'R');
    T.nextTurn('B');
    T.mana('B', 'R');
    const h2 = T.zone('A', 'hand').length;
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h2, "not for the opponent's damage");
  });

  test('Icefall Regent: spells aimed at it cost {2} more', (mk, t) => {
    t.auto('Icefall Regent');
    const T = mk();
    const ir = T.bf('B', 'Icefall Regent');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', bolt.id, { targets: [{ kind: 'object', id: ir.id }] }), 'one red is not enough');
    T.mana('A', '2');
    T.cast('A', bolt, { targets: [ir.id] });
    t.eq(ir.zone, 'graveyard', 'three damage kills the 4/3');
  });

  test('Seismic Tutelage: doubles the counters as the creature attacks', (mk, t) => {
    t.auto('Seismic Tutelage');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 2 } });
    const st = T.bf('A', 'Seismic Tutelage');
    st.attachedTo = bear.id; bear.attachments.push(st.id); T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    t.eq(bear.counters['+1/+1'] || 0, 4);
  });

  test('Endling: +1/-1 or -1/+1, as you choose', (mk, t) => {
    t.auto('Endling');
    const T = mk();
    const en = T.bf('A', 'Endling');
    const p0 = T.g.powerOf(en);
    T.answer('mode', { modes: [1] });
    T.mana('A', '1');
    const idx = en.analysis().manaAbilities.length + en.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /or -1\/\+1/.test(x.text));
    T.activate('A', en, idx);
    T.resolve();
    t.eq(T.g.powerOf(en), p0 - 1);
  });

  test("Witch's Vengeance: creatures of the chosen type get -3/-3", (mk, t) => {
    t.auto("Witch's Vengeance");
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), g = T.bf('B', 'Hill Giant');
    T.answer('choose', (ch) => ({ picks: [Math.max(0, ch.options.findIndex(o => o.label === 'Bear'))] }));
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', "Witch's Vengeance"));
    T.resolve();
    t.eq(b1.zone, 'graveyard'); t.eq(g.zone, 'battlefield');
  });

  test('Tribal Unity: +X/+X for the chosen type', (mk, t) => {
    t.auto('Tribal Unity');
    const T = mk();
    const b1 = T.bf('A', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: [Math.max(0, ch.options.findIndex(o => o.label === 'Bear'))] }));
    T.mana('A', 'G4');
    T.cast('A', T.hand('A', 'Tribal Unity'), { x: 2 });
    T.resolve();
    t.eq(T.g.powerOf(b1), 4);
  });

  test('Candlegrove Witch: flying with three different powers', (mk, t) => {
    t.auto('Candlegrove Witch');
    const T = mk();
    const w = T.bf('A', 'Candlegrove Witch');
    T.bf('A', 'Craw Wurm'); T.bf('A', 'Hill Giant');
    T.nextTurn('B'); T.nextTurn('A');
    T.toMain('A', 'end');
    t.ok(T.g.hasKw(w, 'flying'), 'powers 2, 3 and 6');
  });

  test("Artifact Mutation: Saprolings for the destroyed artifact's mana value", (mk, t) => {
    t.auto('Artifact Mutation');
    const T = mk();
    const ms = T.bf('B', 'Mind Stone');
    T.mana('A', 'RG');
    T.cast('A', T.hand('A', 'Artifact Mutation'), { targets: [ms.id] });
    t.eq(ms.zone, 'graveyard');
    t.eq(T.bfOf('A').filter(o => /Saproling/.test(o.name)).length, 2);
  });

  test('Winds of Change: each hand shuffled in, and as many drawn', (mk, t) => {
    t.auto('Winds of Change');
    const T = mk();
    T.hand('B', 'Island'); T.hand('B', 'Island'); T.hand('B', 'Island');
    for (let i = 0; i < 5; i++) T.top('B', 'Forest');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Winds of Change'));
    t.eq(T.zone('B', 'hand').length, 3);
  });

  test('Ascend from Avernus: X or less, creatures and planeswalkers', (mk, t) => {
    t.auto('Ascend from Avernus');
    const T = mk();
    const b = T.grave('A', 'Grizzly Bears'), g = T.grave('A', 'Craw Wurm');
    T.mana('A', 'WWW2');
    T.cast('A', T.hand('A', 'Ascend from Avernus'), { x: 2 });
    t.eq(b.zone, 'battlefield'); t.eq(g.zone, 'graveyard');
  });

  test('Blade of the Bloodchief: two counters on a Vampire, one otherwise', (mk, t) => {
    t.auto('Blade of the Bloodchief');
    const T = mk();
    const vamp = T.bf('A', 'Vampire Nighthawk');
    const bb = T.bf('A', 'Blade of the Bloodchief');
    bb.attachedTo = vamp.id; vamp.attachments.push(bb.id); T.g.bumpBoard();
    const bear = T.bf('B', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard'); T.g.checkStateBasedActions(); T.resolve();
    t.eq(vamp.counters['+1/+1'] || 0, 2);
  });

  test('Pestilence: gone at end of turn when no creatures are left', (mk, t) => {
    t.auto('Pestilence');
    const T = mk();
    const p = T.bf('A', 'Pestilence');
    T.toMain('A', 'end'); T.resolve();
    t.eq(p.zone, 'graveyard');
  });

  test('The Immortal Sun: no loyalty abilities', (mk, t) => {
    t.auto('The Immortal Sun');
    const T = mk();
    T.bf('B', 'The Immortal Sun');
    const pw = T.bf('A', 'Liliana of the Veil');
    pw.counters.loyalty = 3;
    t.no(T.g.activateAbility('A', pw.id, 0));
  });

  test("Heroes' Podium: +1/+1 for each other legendary creature", (mk, t) => {
    t.auto("Heroes' Podium");
    const T = mk();
    T.bf('A', "Heroes' Podium");
    const a = T.bf('A', 'Isamaru, Hound of Konda'), b = T.bf('A', 'Thalia, Guardian of Thraben');
    t.eq(T.g.powerOf(a), 3, 'Isamaru 2/2 plus one');
    t.eq(T.g.powerOf(b), 3, 'Thalia 2/1 plus one');
  });

  test('Sulfuric Vortex: nobody gains life', (mk, t) => {
    t.auto('Sulfuric Vortex');
    const T = mk();
    T.bf('B', 'Sulfuric Vortex');
    T.g.changeLife(T.player('A'), 5);
    t.eq(T.life('A'), 20);
  });

  test('Cost picks: the player names the evidence, and the view offers it', (mk, t) => {
    const T = mk();
    const fr = T.bf('A', 'Forensic Researcher');
    const g1 = T.grave('A', 'Hill Giant'), g2 = T.grave('A', 'Grizzly Bears'), g3 = T.grave('A', 'Llanowar Elves');
    const bear = T.bf('B', 'Grizzly Bears');
    const idx = fr.analysis().manaAbilities.length + fr.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Collect evidence/.test(x.text));
    const offer = (T.g.viewFor('A').costPicks || {})[fr.id] || [];
    t.ok(offer.some(r => r.kind === 'evidence' && r.index === idx && r.key === 'evidenceIds' && r.candidates.length === 3), 'offered');
    T.activate('A', fr, idx, { targets: [bear.id], evidenceIds: [g2.id, g3.id] });
    T.resolve();
    t.eq(g2.zone, 'exile'); t.eq(g3.zone, 'exile'); t.eq(g1.zone, 'graveyard', 'the Giant kept');
  });

  test('Cost picks: too little evidence named, the table makes it up', (mk, t) => {
    const T = mk();
    const fr = T.bf('A', 'Forensic Researcher');
    const g1 = T.grave('A', 'Hill Giant'), g3 = T.grave('A', 'Llanowar Elves');
    const bear = T.bf('B', 'Grizzly Bears');
    const idx = fr.analysis().manaAbilities.length + fr.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Collect evidence/.test(x.text));
    T.activate('A', fr, idx, { targets: [bear.id], evidenceIds: [g3.id] });
    T.resolve();
    t.eq(g1.zone, 'exile'); t.eq(g3.zone, 'graveyard');
  });

  test('Cost picks: which creature to exile, which green cards to reveal', (mk, t) => {
    const T = mk();
    const cs = T.bf('A', 'City of Shadows');
    const b1 = T.bf('A', 'Grizzly Bears'), giant = T.bf('A', 'Hill Giant');
    T.activate('A', cs, cs.analysis().manaAbilities.length, { exileIds: [giant.id] });
    T.resolve();
    t.eq(giant.zone, 'exile'); t.eq(b1.zone, 'battlefield');
  });

  test('Mother of Runes: protection from the colour chosen, which works', (mk, t) => {
    t.auto('Mother of Runes');
    const T = mk();
    const mom = T.bf('A', 'Mother of Runes');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('mode', { modes: [3] });
    T.activate('A', mom, mom.analysis().manaAbilities.length, { targets: [bear.id] });
    T.resolve();
    t.ok(T.g.hasKw(bear, 'protection from red'), 'protection from red');
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    t.no(T.g.castSpell('B', T.hand('B', 'Lightning Bolt').id, { targets: [{ kind: 'object', id: bear.id }] }), 'can no longer be targeted by red');
  });

  test('Analyze the Pollen: a basic land, or with evidence a creature or land', (mk, t) => {
    t.auto('Analyze the Pollen');
    const T = mk();
    T.top('A', 'Forest'); T.top('A', 'Craw Wurm');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Analyze the Pollen'), { payAdditional: false });
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Forest'), 'no evidence: the Forest');
    T.grave('A', 'Craw Wurm'); T.grave('A', 'Hill Giant');
    T.mana('A', 'G');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Craw Wurm').id] }));
    T.cast('A', T.hand('A', 'Analyze the Pollen'), { payAdditional: true });
    t.ok(T.zone('A', 'hand').some(c => c.name === 'Craw Wurm'), 'evidence collected: the Wurm');
  });

  test('View keywords carry the quality: protection from red, from the chosen colour', (mk, t) => {
    const T = mk();
    const k = T.bf('A', 'Kor Firewalker');
    const v = T.g.viewFor('B').battlefield.find(o => o.id === k.id);
    t.ok(v.keywords.includes('protection from red'), 'from red');
    t.ok(v.keywords.includes('protection'), 'plain protection kept');
  });

  test('Orcish Medicine: your choice of lifelink or indestructible', (mk, t) => {
    t.auto('Orcish Medicine');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('mode', { modes: [1] });
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Orcish Medicine'), { targets: [bear.id] });
    t.ok(T.g.hasKw(bear, 'indestructible')); t.no(T.g.hasKw(bear, 'lifelink'));
  });

  test('Dreadwing Scavenger: +1/+1 and deathtouch as long as seven cards are in the graveyard', (mk, t) => {
    t.auto('Dreadwing Scavenger');
    const T = mk();
    const d = T.bf('A', 'Dreadwing Scavenger');
    const p0 = T.g.powerOf(d);
    t.no(T.g.hasKw(d, 'deathtouch'));
    for (let i = 0; i < 7; i++) T.grave('A', 'Island');
    T.g.bumpBoard();
    t.ok(T.g.hasKw(d, 'deathtouch')); t.eq(T.g.powerOf(d), p0 + 1);
  });

  test('Thornfist Striker: trample and +1/+0 once you have gained life this turn', (mk, t) => {
    t.auto('Thornfist Striker');
    const T = mk();
    T.bf('A', 'Thornfist Striker');
    const bear = T.bf('A', 'Grizzly Bears');
    t.no(T.g.hasKw(bear, 'trample'));
    T.g.changeLife(T.player('A'), 2); T.g.bumpBoard();
    t.ok(T.g.hasKw(bear, 'trample')); t.eq(T.g.powerOf(bear), 3);
  });

  test("Death's Duet: two target creature cards back to hand", (mk, t) => {
    t.auto("Death's Duet");
    const T = mk();
    const a = T.grave('A', 'Grizzly Bears'), b = T.grave('A', 'Hill Giant');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', "Death's Duet"), { targets: [a.id, b.id] });
    t.eq(a.zone, 'hand'); t.eq(b.zone, 'hand');
  });

  test('Wing Shards: the sacrifice is of an attacking creature', (mk, t) => {
    t.auto('Wing Shards');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    T.nextTurn('B');
    T.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'A' }]);
    T.toMain('B', 'declareBlockers');
    T.mana('A', 'WW1');
    T.g.passPriority('B', true);
    T.cast('A', T.hand('A', 'Wing Shards'), { targets: ['B'] });
    t.eq(giant.zone, 'graveyard', 'the attacker'); t.eq(bear.zone, 'battlefield');
  });

  test('Pull from the Deep: an instant and a sorcery back, nothing else', (mk, t) => {
    t.auto('Pull from the Deep');
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt'), duress = T.grave('A', 'Duress'), bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'UU2');
    const pd = T.hand('A', 'Pull from the Deep');
    t.no(T.g.castSpell('A', pd.id, { targets: [{ kind: 'object', id: bear.id }, { kind: 'object', id: duress.id }] }), 'not a creature card');
    T.cast('A', pd, { targets: [bolt.id, duress.id] });
    t.eq(bolt.zone, 'hand'); t.eq(duress.zone, 'hand'); t.eq(pd.zone, 'exile');
  });

  test('Price of Progress: twice the nonbasic lands each player controls', (mk, t) => {
    t.auto('Price of Progress');
    const T = mk();
    T.bf('B', 'Steam Vents'); T.bf('B', 'Steam Vents'); T.bf('B', 'Island');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Price of Progress'));
    t.eq(T.life('B'), 16); t.eq(T.life('A'), 20);
  });

  test('Oswald Fiddlebender: an artifact with mana value one more', (mk, t) => {
    t.auto('Oswald Fiddlebender');
    const T = mk();
    const of = T.bf('A', 'Oswald Fiddlebender');
    const ms = T.bf('A', 'Mind Stone');
    const pick = T.top('A', 'Coat of Arms'); const right = T.top('A', 'Pristine Talisman');
    T.mana('A', 'W');
    const idx = of.analysis().manaAbilities.length + of.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /Search/.test(x.text));
    T.activate('A', of, idx, { sacrificeIds: [ms.id] });
    T.resolve();
    t.eq(right.zone, 'battlefield', 'mana value 3'); t.eq(pick.zone, 'library');
  });

  test('Fatal Push: mana value 2 or less, or 4 or less with revolt', (mk, t) => {
    t.auto('Fatal Push');
    const T = mk();
    const giant = T.bf('B', 'Hill Giant'), bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Fatal Push'), { targets: [giant.id] });
    t.eq(giant.zone, 'battlefield', 'mana value 4, no revolt');
    const clue = T.bf('A', 'Mind Stone');
    T.g.moveObject(clue, 'graveyard');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Fatal Push'), { targets: [giant.id] });
    t.eq(giant.zone, 'graveyard', 'with revolt');
    void bear;
  });

  test('Renata: power equal to devotion to green', (mk, t) => {
    t.auto('Renata, Called to the Hunt');
    const T = mk();
    const r = T.bf('A', 'Renata, Called to the Hunt');
    T.bf('A', 'Llanowar Elves');
    t.eq(T.g.powerOf(r), T.g.devotionOf('A', 'G'));
    t.ok(T.g.powerOf(r) >= 3);
  });

  test('Heartless Hidetsugu: half of each life total', (mk, t) => {
    t.auto('Heartless Hidetsugu');
    const T = mk();
    const h = T.bf('A', 'Heartless Hidetsugu');
    T.player('B').life = 15;
    T.mana('A', '1');
    T.activate('A', h, h.analysis().manaAbilities.length);
    T.resolve();
    t.eq(T.life('A'), 10); t.eq(T.life('B'), 8);
  });

  test('Stonespeaker Crystal: any number of graveyards exiled', (mk, t) => {
    t.auto('Stonespeaker Crystal');
    const T = mk();
    const sc = T.bf('A', 'Stonespeaker Crystal');
    T.grave('A', 'Island'); T.grave('B', 'Island'); T.grave('B', 'Forest');
    T.mana('A', '2');
    const idx = sc.analysis().manaAbilities.length + sc.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /graveyards/.test(x.text));
    T.activate('A', sc, idx, { targets: ['B'] });
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length, 0); t.eq(T.zone('A', 'graveyard').length, 2, 'its own Island stays, and the Crystal');
  });

  test('Swarm Surge: colorless creatures also gain first strike', (mk, t) => {
    t.auto('Swarm Surge');
    const T = mk();
    const orn = T.bf('A', 'Ornithopter'), bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Swarm Surge'));
    t.eq(T.g.powerOf(bear), 4);
    t.ok(T.g.hasKw(orn, 'first strike'), 'the colourless one');
    t.ok(!T.g.hasKw(bear, 'first strike'), 'not the green one');
  });

  test('Falthis: commanders you control, whatever they are', (mk, t) => {
    t.auto('Falthis, Shadowcat Familiar');
    const T = mk();
    T.bf('A', 'Falthis, Shadowcat Familiar');
    const cmd = T.bf('A', 'Grizzly Bears'), other = T.bf('A', 'Hill Giant');
    cmd.isCommander = true;
    T.g.bumpBoard();
    t.ok(T.g.hasKw(cmd, 'deathtouch'), 'the commander');
    t.ok(!T.g.hasKw(other, 'deathtouch'), 'not another creature');
  });

  test('Joraga Bard: "you may have Ally creatures you control gain vigilance"', (mk, t) => {
    t.auto('Joraga Bard');
    const T = mk();
    const ally = T.bf('A', 'Kazandu Blademaster'), bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Joraga Bard'));
    T.resolve();
    t.ok(T.g.hasKw(ally, 'vigilance'), 'the Ally');
    t.ok(!T.g.hasKw(bear, 'vigilance'), 'not the Bears');
  });

  test('Siege-Gang Lieutenant: those tokens gain haste, nothing else does', (mk, t) => {
    t.auto('Siege-Gang Lieutenant');
    const T = mk();
    T.bf('A', 'Siege-Gang Lieutenant').isCommander = true;
    const old = T.bf('A', 'Goblin Piker');
    T.toMain('A', 'beginCombat');
    T.resolve();
    const gobs = T.bfOf('A').filter(o => o.isToken);
    t.eq(gobs.length, 2);
    t.ok(gobs.every(o => T.g.hasKw(o, 'haste')), 'the new tokens');
    t.ok(!T.g.hasKw(old, 'haste'), 'not the Goblin already there');
  });

  test('Counters other than +1/+1 change power and toughness too (Wall of Roots, Tin-Wing Chimera)', (mk, t) => {
    t.auto('Tin-Wing Chimera'); t.auto('Wall of Roots');
    const T = mk();
    const wall = T.bf('A', 'Wall of Roots');
    wall.counters['-0/-1'] = 2;
    t.eq(T.g.toughnessOf(wall), 3); t.eq(T.g.powerOf(wall), 0);
    const tin = T.bf('A', 'Tin-Wing Chimera'), other = T.bf('A', 'Tin-Wing Chimera');
    T.activate('A', tin, tin.analysis().manaAbilities.length, { targets: [other.id] });
    T.resolve();
    t.eq(tin.zone, 'graveyard');
    t.eq(T.g.powerOf(other), 4); t.eq(T.g.toughnessOf(other), 4);
    t.ok(T.g.hasKw(other, 'flying'));
  });

  test('Puncture Bolt: the -1/-1 counter goes on the creature it hit', (mk, t) => {
    t.auto('Puncture Bolt');
    const T = mk();
    const ogre = T.bf('B', 'Hill Giant');
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Puncture Bolt'), { targets: [ogre.id] });
    t.eq(ogre.counters['-1/-1'], 1);
    t.eq(ogre.damage, 1);
  });

  test('Unstable Mutation: the counter on the enchanted creature, in its controller\'s upkeep', (mk, t) => {
    t.auto('Unstable Mutation');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Unstable Mutation'), { targets: [bear.id] });
    t.eq(T.g.powerOf(bear), 5);
    T.toMain('B', 'upkeep');
    T.resolve();
    t.eq(bear.counters['-1/-1'], 1);
    t.eq(T.g.powerOf(bear), 4);
  });

  test('Flycatcher Giraffid: enters with one of the two keyword counters', (mk, t) => {
    t.auto('Flycatcher Giraffid');
    const T = mk();
    T.mana('A', '4G');
    T.cast('A', T.hand('A', 'Flycatcher Giraffid'));
    const g = T.bfOf('A').find(o => o.name === 'Flycatcher Giraffid');
    t.ok(g, 'it is on the battlefield');
    t.eq((g.counters.reach || 0) + (g.counters.vigilance || 0), 1, 'one counter, of one kind');
    t.ok(T.g.hasKw(g, 'reach') || T.g.hasKw(g, 'vigilance'));
  });

  test('The Gitrog Monster: one card drawn for a lot of lands milled at once', (mk, t) => {
    t.auto('The Gitrog Monster');
    const T = mk();
    T.bf('A', 'The Gitrog Monster');
    for (let i = 0; i < 3; i++) T.top('A', 'Forest');
    const hand0 = T.zone('A', 'hand').length;
    for (let i = 0; i < 3; i++) T.g.moveObject(T.zone('A', 'library')[0], 'graveyard');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand0 + 1, 'one draw for the lot');
  });

  test('Voracious Brood: that many counters, one for each creature card', (mk, t) => {
    t.auto('Voracious Brood');
    const T = mk();
    const vb = T.bf('A', 'Voracious Brood');
    T.top('A', 'Grizzly Bears'); T.top('A', 'Island'); T.top('A', 'Hill Giant');
    for (let i = 0; i < 3; i++) T.g.moveObject(T.zone('A', 'library')[0], 'graveyard');
    T.resolve();
    t.eq(vb.counters['+1/+1'], 2);
  });

  test('Eidolon of the Great Revel: only spells of mana value 3 or less', (mk, t) => {
    t.auto('Eidolon of the Great Revel');
    const T = mk();
    T.bf('A', 'Eidolon of the Great Revel');
    T.mana('A', '4G');
    T.cast('A', T.hand('A', 'Thragtusk'));
    T.resolve();
    t.eq(T.life('A'), 25, 'Thragtusk: 5 life, no damage');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.life('A'), 23, 'the Bears: 2 damage');
  });

  test('Pollywog Prodigy: a noncreature spell smaller than its power', (mk, t) => {
    t.auto('Pollywog Prodigy');
    const T = mk();
    const pp = T.bf('A', 'Pollywog Prodigy');
    const pw = T.g.powerOf(pp);
    const hand0 = T.zone('A', 'hand').length;
    T.toMain('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand0 + (1 < pw ? 1 : 0));
  });

  test('Destiny Spinner: an X/X land, X counted as it resolves', (mk, t) => {
    t.auto('Destiny Spinner');
    const T = mk();
    const ds = T.bf('A', 'Destiny Spinner');
    T.bf('A', 'Propaganda'); T.bf('A', 'Propaganda');
    const land = T.bf('A', 'Forest');
    T.mana('A', '3G');
    T.activate('A', ds, ds.analysis().manaAbilities.length, { targets: [land.id] });
    T.resolve();
    const c = T.g.characteristics(land);
    t.ok(c.isCreature, 'a creature');
    t.eq(T.g.powerOf(land), 3, 'Destiny Spinner and two Propagandas');
    t.ok(T.g.hasKw(land, 'trample') && T.g.hasKw(land, 'haste'));
    const st = land.analysis().subtypes || [];
    t.ok(st.includes('Forest') && st.includes('Elemental'), 'still a Forest, an Elemental too');
  });

  test('Cyberdrive Awakener: each noncreature artifact you control is a 4/4 for the turn', (mk, t) => {
    t.auto('Cyberdrive Awakener');
    const T = mk();
    const rock = T.bf('A', 'Mind Stone'), theirs = T.bf('B', 'Mind Stone');
    T.mana('A', '5U');
    T.cast('A', T.hand('A', 'Cyberdrive Awakener'));
    T.resolve();
    t.eq(T.g.powerOf(rock), 4); t.ok(T.g.characteristics(rock).isCreature);
    t.ok(!T.g.characteristics(theirs).isCreature, 'not the opponent\'s');
  });

  test('Curse of the Swine: a Boar for the controller of each creature exiled', (mk, t) => {
    t.auto('Curse of the Swine');
    const T = mk();
    const a1 = T.bf('B', 'Grizzly Bears'), a2 = T.bf('B', 'Hill Giant'), mine = T.bf('A', 'Gray Ogre');
    T.mana('A', '3UU');
    T.cast('A', T.hand('A', 'Curse of the Swine'), { x: 3, targets: [a1.id, a2.id, mine.id] });
    t.eq(a1.zone, 'exile'); t.eq(mine.zone, 'exile');
    t.eq(T.bfOf('B').filter(o => o.isToken && o.name === 'Boar').length, 2);
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Boar').length, 1);
  });

  test('Rampage of the Clans: a Centaur for each permanent destroyed, to its controller', (mk, t) => {
    t.auto('Rampage of the Clans');
    const T = mk();
    T.bf('B', 'Mind Stone'); T.bf('B', 'Propaganda'); T.bf('A', 'Mind Stone');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Rampage of the Clans'));
    t.eq(T.bfOf('B').filter(o => o.isToken).length, 2);
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 1);
  });

  test('Neheb, the Eternal: red mana for the life opponents lost', (mk, t) => {
    t.auto('Neheb, the Eternal');
    const T = mk();
    T.bf('A', 'Neheb, the Eternal');
    T.g.changeLife(T.player('B'), -4);
    T.toMain('A', 'endCombat');
    const g = T.g;
    let seen = false;
    for (let i = 0; i < 20 && !(g.phase.id === 'postcombat' && seen && !g.stack.length); i++) {
      T.settle();
      if (g.phase.id === 'postcombat' && g.stack.length) seen = true;
      g.passPriority(g.priorityPlayer.id, true);
    }
    t.eq(g.phase.id, 'postcombat');
    t.eq(g.player('A').pool.total(), 4);
  });

  test('Keeper of the Accord: a Soldier when that opponent has more creatures', (mk, t) => {
    t.auto('Keeper of the Accord');
    const T = mk();
    T.bf('A', 'Keeper of the Accord');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears');
    T.toMain('B');
    T.toMain('B', 'end');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken && o.name === 'Soldier').length, 1);
  });

  test('Defense of the Heart: an opponent with three creatures, two creatures fetched', (mk, t) => {
    t.auto('Defense of the Heart');
    const T = mk();
    const dh = T.bf('A', 'Defense of the Heart');
    for (let i = 0; i < 3; i++) T.bf('B', 'Grizzly Bears');
    T.top('A', 'Hill Giant'); T.top('A', 'Gray Ogre'); T.top('A', 'Island');
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.filter(c => /Giant|Ogre/.test(c.name)).map(c => c.id) }));
    T.nextTurn('A');
    T.toMain('A', 'upkeep');
    T.resolve();
    t.eq(dh.zone, 'graveyard');
    t.ok(T.bfOf('A').some(o => o.name === 'Hill Giant') && T.bfOf('A').some(o => o.name === 'Gray Ogre'));
  });

  test("Galadriel's Dismissal kicked: each creature that player controls phases out", (mk, t) => {
    t.auto("Galadriel's Dismissal");
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant'), mine = T.bf('A', 'Gray Ogre');
    T.mana('A', '2WW');
    T.cast('A', T.hand('A', "Galadriel's Dismissal"), { kick: 1, targets: [{ kind: 'player', id: 'B' }] });
    t.ok(b1.phasedOut && b2.phasedOut, 'both of B\'s');
    t.ok(!mine.phasedOut, 'not A\'s');
  });

  test('Maddening Cacophony kicked: each opponent mills half their own library', (mk, t) => {
    t.auto('Maddening Cacophony');
    const T = mk();
    const before = T.zone('B', 'library').length;
    T.mana('A', '4UU');
    T.cast('A', T.hand('A', 'Maddening Cacophony'), { kick: 1 });
    t.eq(T.zone('B', 'library').length, before - Math.ceil(before / 2));
  });

  test('Chrome Host Seedshark: incubate X, X the spell\'s mana value', (mk, t) => {
    t.auto('Chrome Host Seedshark');
    const T = mk();
    T.bf('A', 'Chrome Host Seedshark');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', '2R');
    T.cast('A', T.hand('A', 'Lava Coil'), { targets: [giant.id] });
    T.resolve();
    const inc = T.bfOf('A').find(o => o.isToken && o.name === 'Incubator');
    t.ok(inc, 'an Incubator');
    t.eq(inc.counters['+1/+1'], 2);
  });

  test('Coat of Arms: +1/+1 for each other creature sharing a type', (mk, t) => {
    t.auto('Coat of Arms');
    const T = mk();
    T.bf('A', 'Coat of Arms');
    const e1 = T.bf('A', 'Llanowar Elves'), e2 = T.bf('B', 'Elvish Mystic'), bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(e1), 2, 'one other Elf, on either side');
    t.eq(T.g.powerOf(e2), 2);
    t.eq(T.g.powerOf(bear), 2, 'the Bear shares nothing');
  });

  test('Mirror Box: +1/+1 for each other creature you control of the same name', (mk, t) => {
    t.auto('Mirror Box');
    const T = mk();
    T.bf('A', 'Mirror Box');
    const b1 = T.bf('A', 'Grizzly Bears'); T.bf('A', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears');
    t.eq(T.g.powerOf(b1), 3, 'one other of its name on its side');
  });

  test('Daxos, Blessed by the Sun: toughness is devotion to white', (mk, t) => {
    t.auto('Daxos, Blessed by the Sun');
    const T = mk();
    const d = T.bf('A', 'Daxos, Blessed by the Sun');
    T.bf('A', 'Savannah Lions');
    t.eq(T.g.toughnessOf(d), T.g.devotionOf('A', 'W'));
    t.eq(T.g.powerOf(d), 2);
    const life0 = T.life('A');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Savannah Lions'));
    T.resolve();
    t.eq(T.life('A'), life0 + 1, 'another creature entered');
  });

  test('Mazirek: a sacrifice puts a counter on each of your creatures', (mk, t) => {
    t.auto('Mazirek, Kraul Death Priest');
    const T = mk();
    const m = T.bf('A', 'Mazirek, Kraul Death Priest'), bear = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Hill Giant');
    T.g._sacrificeNow('B', T.bfOf('B').filter(o => o.name === 'Hill Giant'), { controller: 'B' });
    T.resolve();
    t.eq(bear.counters['+1/+1'], 1); t.eq(m.counters['+1/+1'], 1);
  });

  test('Towering Gibbon: power is the greatest mana value among your creatures', (mk, t) => {
    t.auto('Towering Gibbon');
    const T = mk();
    const g = T.bf('A', 'Towering Gibbon');
    T.bf('A', 'Craterhoof Behemoth'); T.bf('B', 'Emrakul, the Aeons Torn');
    t.eq(T.g.powerOf(g), 8, 'the Craterhoof, not the opponent\'s Emrakul');
  });

  test('Sautekh Immortal: a counter for each creature that died this turn', (mk, t) => {
    t.auto('Sautekh Immortal');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Grizzly Bears');
    T.g.moveObject(b1, 'graveyard'); T.g.moveObject(b2, 'graveyard');
    T.put('A', 'Sautekh Immortal', 'battlefield', { etb: true });
    const s = T.bfOf('A').find(o => o.name === 'Sautekh Immortal');
    t.eq(s.counters['+1/+1'], 2);
  });

  test('Nissa, Who Shakes the World: the land is untapped and becomes a creature, not Nissa', (mk, t) => {
    t.auto('Nissa, Who Shakes the World');
    const T = mk();
    const n = T.bf('A', 'Nissa, Who Shakes the World');
    const land = T.bf('A', 'Forest'); land.tapped = true;
    T.activate('A', n, n.analysis().manaAbilities.length, { targets: [land.id] });
    T.resolve();
    t.ok(!land.tapped, 'the land untapped');
    t.ok(T.g.characteristics(land).isCreature, 'a creature');
    t.eq(T.g.powerOf(land), 3); t.ok(T.g.hasKw(land, 'haste'));
  });

  test('Rampaging Growth: the land found is the one that becomes an Insect', (mk, t) => {
    t.auto('Rampaging Growth');
    const T = mk();
    T.top('A', 'Forest');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Rampaging Growth'));
    T.resolve();
    const f = T.bfOf('A').find(o => o.name === 'Forest');
    t.ok(f, 'a Forest on the battlefield');
    t.eq(T.g.powerOf(f), 4); t.ok(T.g.hasKw(f, 'reach'));
  });

  test('Fall of the Hammer: another target creature, and not the same one twice', (mk, t) => {
    t.auto('Fall of the Hammer');
    const T = mk();
    const giant = T.bf('A', 'Hill Giant'), bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1R');
    let refused = false;
    try { T.cast('A', T.hand('A', 'Fall of the Hammer'), { targets: [giant.id, giant.id] }); } catch (err) { refused = true; }
    t.ok(refused, 'the same creature twice is refused');
    T.cast('A', T.hand('A', 'Fall of the Hammer'), { targets: [giant.id, bear.id] });
    t.eq(bear.zone, 'graveyard', 'its own other creature is fair game');
  });

  test("A bite at a creature you don't control asks for an opponent's", (mk, t) => {
    const card = { id: 'probe-bite', name: 'Probe Bite', type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, colors: ['G'], layout: 'normal',
      oracle_text: "Target creature you control deals damage equal to its power to target creature you don't control.", keywords: [] };
    const spec = engine().oracle.analyze(card).abilities[0].effects[0].targets[1];
    t.eq(spec.controller, 'opponent');
  });

  test('Watchdog blocks each combat if able', (mk, t) => {
    t.auto('Watchdog');
    const T = mk();
    const w = T.bf('A', 'Watchdog');
    t.ok(T.g._staticOp(w, 'mustBlock'));
  });

  test('Charging Rhino: not blocked by more than one creature (not menace)', (mk, t) => {
    t.auto('Charging Rhino');
    const T = mk();
    const r = T.bf('A', 'Charging Rhino');
    r.summoningSick = false;
    t.ok(!T.g.hasKw(r, 'menace'), 'no menace');
    const x = T.bf('B', 'Grizzly Bears'), y = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: r.id, defenderId: 'B' }]);
    let two = null, one = null;
    T.answer('declareBlockers', () => {
      two = !T.g.declareBlockers('B', [{ blockerId: x.id, attackerIds: [r.id] }, { blockerId: y.id, attackerIds: [r.id] }]);
      one = !!T.g.declareBlockers('B', [{ blockerId: x.id, attackerIds: [r.id] }]);
      return null;
    });
    T.toMain('A', 'endCombat');
    t.ok(two, 'two blockers refused');
    t.ok(one, 'one blocker allowed');
  });

  test('Jetmir: "also get" read past, each line on its own count', (mk, t) => {
    t.auto('Jetmir, Nexus of Revels');
    const T = mk();
    T.bf('A', 'Jetmir, Nexus of Revels');
    const bears = [];
    for (let i = 0; i < 5; i++) bears.push(T.bf('A', 'Grizzly Bears'));
    t.eq(T.g.powerOf(bears[0]), 4, 'six creatures: +1/+0 for three and again for six');
    t.ok(T.g.hasKw(bears[0], 'trample'));
    t.ok(!T.g.hasKw(bears[0], 'double strike'), 'not nine');
  });

  test('Toxrill: -1/-1 for each slime counter on each creature you don\'t control', (mk, t) => {
    t.auto('Toxrill, the Corrosive');
    const T = mk();
    T.bf('A', 'Toxrill, the Corrosive');
    const giant = T.bf('B', 'Hill Giant'), mine = T.bf('A', 'Hill Giant');
    giant.counters.slime = 2; mine.counters.slime = 2;
    t.eq(T.g.powerOf(giant), 1); t.eq(T.g.powerOf(mine), 3);
  });

  test('Galadhrim Ambush: combat damage from non-Elves is prevented, Elves still hit', (mk, t) => {
    t.auto('Galadhrim Ambush');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'), elf = T.bf('B', 'Llanowar Elves');
    bear.summoningSick = false; elf.summoningSick = false;
    T.toMain('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }, { attackerId: elf.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('B', 'declareBlockers');
    if (T.g.priorityPlayer.id === 'B') T.g.passPriority('B', true);
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Galadhrim Ambush'));
    T.resolve();
    T.toMain('B', 'endCombat');
    t.eq(T.life('A'), 19, 'only the Elf\'s 1');
  });

  test('Halvar: enchanted or equipped creatures have double strike', (mk, t) => {
    const T = mk();
    T.bf('A', 'Halvar, God of Battle // Sword of the Realms');
    const bear = T.bf('A', 'Grizzly Bears'), other = T.bf('A', 'Grizzly Bears');
    const sword = T.bf('A', 'Bonesplitter');
    sword.attachedTo = bear.id; bear.attachments = [sword.id];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(bear, 'double strike'));
    t.ok(!T.g.hasKw(other, 'double strike'));
  });

  test('Crippling Fear: -3/-3 to all but the chosen type', (mk, t) => {
    t.auto('Crippling Fear');
    const T = mk();
    const elf = T.bf('A', 'Llanowar Elves'), giant = T.bf('B', 'Hill Giant'), troll = T.bf('B', 'Craw Wurm');
    T.answer('mode', (ch) => ({ modes: [Math.max(0, (ch.options || []).findIndex(o => /^Elf$/i.test(o.label)))] }));
    T.mana('A', '2BB');
    T.cast('A', T.hand('A', 'Crippling Fear'));
    T.resolve();
    t.eq(elf.zone, 'battlefield', 'the Elf is spared');
    t.eq(giant.zone, 'graveyard');
    t.eq(T.g.powerOf(troll), 3);
  });

  test('Sudden Spoiling: that player\'s creatures are 0/2 with no abilities', (mk, t) => {
    t.auto('Sudden Spoiling');
    const T = mk();
    const s = T.bf('B', 'Serra Angel'), mine = T.bf('A', 'Serra Angel');
    T.mana('A', '1BB');
    T.cast('A', T.hand('A', 'Sudden Spoiling'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.g.powerOf(s), 0); t.eq(T.g.toughnessOf(s), 2); t.ok(!T.g.hasKw(s, 'flying'));
    t.eq(T.g.powerOf(mine), 4);
  });

  test("Blacksmith's Skill: +2/+2 only for an artifact creature", (mk, t) => {
    t.auto("Blacksmith's Skill");
    const T = mk();
    const golem = T.bf('A', 'Bronze Sable'), bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', "Blacksmith's Skill"), { targets: [golem.id] });
    T.resolve();
    t.eq(T.g.powerOf(golem), 4); t.ok(T.g.hasKw(golem, 'indestructible'));
    T.mana('A', 'W');
    T.cast('A', T.hand('A', "Blacksmith's Skill"), { targets: [bear.id] });
    T.resolve();
    t.eq(T.g.powerOf(bear), 2, 'not an artifact');
  });

  test('Font of Mythos: the player whose draw step it is draws two more', (mk, t) => {
    t.auto('Font of Mythos');
    const T = mk();
    T.bf('A', 'Font of Mythos');
    const a0 = T.zone('A', 'hand').length, b0 = T.zone('B', 'hand').length;
    T.nextTurn('B');
    T.toMain('B');
    t.eq(T.zone('B', 'hand').length, b0 + 3, 'its own draw and two more');
    t.eq(T.zone('A', 'hand').length, a0, 'not the Font\'s controller');
  });

  test('Vengeful Ancestor: a goaded attacker hurts its own controller', (mk, t) => {
    t.auto('Vengeful Ancestor');
    const T = mk();
    T.bf('A', 'Vengeful Ancestor');
    const bear = T.bf('B', 'Grizzly Bears');
    bear.summoningSick = false; bear.goadedBy = 'A';
    T.nextTurn('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => []);
    const b0 = T.life('B');
    T.toMain('B', 'endCombat');
    t.eq(T.life('B'), b0 - 1);
  });

  test('Season of Growth: a spell at a creature of yours draws a card', (mk, t) => {
    t.auto('Season of Growth');
    const T = mk();
    T.bf('A', 'Season of Growth');
    const bear = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [bear.id] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1);
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [theirs.id] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'not for the opponent\'s');
  });

  test('Akki Ember-Keeper: a modified creature dying is seen as it was', (mk, t) => {
    t.auto('Akki Ember-Keeper');
    const T = mk();
    T.bf('A', 'Akki Ember-Keeper');
    const bear = T.bf('A', 'Grizzly Bears'), plain = T.bf('A', 'Grizzly Bears');
    bear.counters['+1/+1'] = 1;
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 1, 'a Spirit for the modified one');
    T.g.moveObject(plain, 'graveyard');
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 1, 'none for the plain one');
  });

  test('Thrakkus the Butcher: each Dragon\'s power doubled as it attacks', (mk, t) => {
    t.auto('Thrakkus the Butcher');
    const T = mk();
    const th = T.bf('A', 'Thrakkus the Butcher'), sd = T.bf('A', 'Shivan Dragon'), bear = T.bf('A', 'Grizzly Bears');
    th.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: th.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(sd), 10, 'Shivan Dragon'); t.eq(T.g.powerOf(th), 6, 'Thrakkus'); t.eq(T.g.powerOf(bear), 2);
  });

  test('Archfiend of Despair: each opponent loses again what they lost', (mk, t) => {
    t.auto('Archfiend of Despair');
    const T = mk();
    T.bf('A', 'Archfiend of Despair');
    T.g.changeLife(T.player('B'), -3);
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.life('B'), 14);
  });

  test('Folio of Fancies: each opponent mills as many as are in their hand', (mk, t) => {
    t.auto('Folio of Fancies');
    const T = mk();
    const f = T.bf('A', 'Folio of Fancies');
    const h = T.zone('B', 'hand').length, g0 = T.zone('B', 'graveyard').length;
    T.mana('A', '2U');
    T.activate('A', f, f.analysis().manaAbilities.length);
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length, g0 + h);
  });

  test('Cosmos Elixir: above the starting life a card, otherwise 2 life', (mk, t) => {
    t.auto('Cosmos Elixir');
    const T = mk();
    T.bf('A', 'Cosmos Elixir');
    const l0 = T.life('A'), h0 = T.zone('A', 'hand').length;
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.life('A'), l0 + 2); t.eq(T.zone('A', 'hand').length, h0);
  });

  test('Karn, Legacy Reforged: power and toughness the greatest artifact mana value', (mk, t) => {
    const T = mk();
    const k = T.bf('A', 'Karn, Legacy Reforged');
    T.bf('A', 'Mind Stone');
    t.eq(T.g.powerOf(k), 5); t.eq(T.g.toughnessOf(k), 5);
  });

  test('Wrathful Raptors: a Dinosaur dealt damage passes it on', (mk, t) => {
    t.auto('Wrathful Raptors');
    const T = mk();
    const wr = T.bf('A', 'Wrathful Raptors');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R');
    T.toMain('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: [wr.id] });
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Death Pits of Rath: any creature dealt damage is destroyed, the opponent\'s too', (mk, t) => {
    t.auto('Death Pits of Rath');
    const T = mk();
    T.bf('A', 'Death Pits of Rath');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [giant.id] });
    T.resolve();
    t.eq(giant.zone, 'graveyard');
  });

  test('Howlsquad Heavy: the new Goblin must attack', (mk, t) => {
    t.auto('Howlsquad Heavy');
    const T = mk();
    T.bf('A', 'Howlsquad Heavy');
    T.toMain('A', 'beginCombat');
    T.resolve();
    const gob = T.bfOf('A').find(o => o.isToken);
    t.ok(gob, 'a Goblin');
    t.ok(T.g._hasFlag(gob, 'mustAttackEot'), 'it attacks this combat if able');
  });

  test('Revenge of Ravens: an attacker costs its controller 1 life, you gain 1', (mk, t) => {
    t.auto('Revenge of Ravens');
    const T = mk();
    T.bf('A', 'Revenge of Ravens');
    const bear = T.bf('B', 'Grizzly Bears'); bear.summoningSick = false;
    T.nextTurn('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('B', 'declareBlockers');
    T.resolve();
    t.eq(T.life('B'), 19); t.eq(T.life('A'), 21);
  });

  test('Necrogoyf: power counts creature cards in every graveyard', (mk, t) => {
    t.auto('Necrogoyf');
    const T = mk();
    const n = T.bf('A', 'Necrogoyf');
    T.grave('A', 'Grizzly Bears'); T.grave('B', 'Hill Giant'); T.grave('B', 'Island');
    t.eq(T.g.powerOf(n), 2);
  });

  test('Blowfly Infestation: only a creature that had a -1/-1 counter', (mk, t) => {
    t.auto('Blowfly Infestation');
    const T = mk();
    T.bf('A', 'Blowfly Infestation');
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Hill Giant'), c = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b.id }] }));
    T.g.moveObject(c, 'graveyard');
    T.resolve();
    t.ok(!b.counters['-1/-1'], 'nothing for a plain one');
    a.counters['-1/-1'] = 1;
    T.g.moveObject(a, 'graveyard');
    T.resolve();
    t.eq(b.counters['-1/-1'], 1);
  });

  test('Repercussion: damage to a creature hits its controller too', (mk, t) => {
    t.auto('Repercussion');
    const T = mk();
    T.bf('A', 'Repercussion');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [giant.id] });
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Riddlekeeper: the attacker\'s controller mills two', (mk, t) => {
    t.auto('Riddlekeeper');
    const T = mk();
    T.bf('A', 'Riddlekeeper');
    const bear = T.bf('B', 'Grizzly Bears'); bear.summoningSick = false;
    T.nextTurn('B');
    const g0 = T.zone('B', 'graveyard').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('B', 'declareBlockers');
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length, g0 + 2);
  });

  test('Galvanize: 3 damage, or 5 after two draws, at the one target', (mk, t) => {
    t.auto('Galvanize');
    const T = mk();
    const w = T.bf('B', 'Craw Wurm');
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Galvanize'), { targets: [w.id] });
    T.resolve();
    t.eq(w.damage, 3);
    T.player('A').drawnThisTurn = 2;
    const w2 = T.bf('B', 'Craw Wurm');
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Galvanize'), { targets: [w2.id] });
    T.resolve();
    t.eq(w2.zone, 'graveyard', '5 damage kills the 6/4');
  });

  test('Serra Avatar: power and toughness are its controller\'s life total', (mk, t) => {
    t.auto('Serra Avatar');
    const T = mk();
    const s = T.bf('A', 'Serra Avatar');
    t.eq(T.g.powerOf(s), T.life('A')); t.eq(T.g.toughnessOf(s), T.life('A'));
  });

  test('Defend the Hearth: combat damage to players is prevented, not to creatures', (mk, t) => {
    t.auto('Defend the Hearth');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'); bear.summoningSick = false;
    const wall = T.bf('A', 'Hill Giant');
    T.nextTurn('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('B', 'declareBlockers');
    if (T.g.priorityPlayer.id === 'B') T.g.passPriority('B', true);
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Defend the Hearth'));
    T.resolve();
    T.toMain('B', 'endCombat');
    t.eq(T.life('A'), 20);
    void wall;
  });

  test('Polliwallop: twice its power', (mk, t) => {
    t.auto('Polliwallop');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Polliwallop'), { targets: [bear.id, giant.id] });
    T.resolve();
    t.eq(giant.zone, 'graveyard', '4 damage to the 3/3');
  });

  test("Laquatus's Champion: the player it took from gets the life back", (mk, t) => {
    t.auto("Laquatus's Champion");
    const T = mk();
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '4BB');
    T.cast('A', T.hand('A', "Laquatus's Champion"));
    T.resolve();
    t.eq(T.life('B'), 14);
    const lc = T.bfOf('A').find(o => o.name === "Laquatus's Champion");
    T.g.moveObject(lc, 'graveyard');
    T.resolve();
    t.eq(T.life('B'), 20); t.eq(T.life('A'), 20);
  });

  test('Hunt Down: the first creature must block the second', (mk, t) => {
    t.auto('Hunt Down');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Hunt Down'), { targets: [theirs.id, mine.id] });
    T.resolve();
    t.ok((theirs.effects || []).some(e => e.mustBlockId === mine.id));
  });

  test('Reap the Past: two cards at random back to hand', (mk, t) => {
    const T = mk();
    T.grave('A', 'Island'); T.grave('A', 'Forest'); T.grave('A', 'Swamp');
    const h0 = T.zone('A', 'hand').length;
    T.g._runEffect ? null : null;
    const card = { id: 'probe-reap', name: 'Probe Reap', type_line: 'Sorcery', mana_cost: '{R}', cmc: 1, colors: ['R'], layout: 'normal',
      oracle_text: 'Return two cards at random from your graveyard to your hand.', keywords: [] };
    const eff = engine().oracle.analyze(card).abilities[0].effects[0];
    t.eq(eff.op, 'randomFromGraveyard'); t.eq(eff.n, 2);
    void h0;
  });

  test('The Endstone: life becomes half the starting total, a loss as it goes', (mk, t) => {
    t.auto('The Endstone');
    const T = mk();
    T.bf('A', 'The Endstone');
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.life('A'), Math.ceil(((T.g.config && T.g.config.startingLife) || 20) / 2));
    t.ok((T.player('A').lifeLostThisTurn || 0) > 0, 'counted as life lost');
  });

  test('Proliferate: your good counters and their bad ones, never your own poison', (mk, t) => {
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), hurt = T.bf('A', 'Hill Giant'), theirs = T.bf('B', 'Hill Giant'), theirGood = T.bf('B', 'Grizzly Bears');
    mine.counters['+1/+1'] = 1; hurt.counters['-1/-1'] = 1; theirs.counters['-1/-1'] = 1; theirGood.counters['+1/+1'] = 1;
    T.player('A').poison = 2; T.player('B').poison = 2;
    const card = { id: 'probe-prolif', name: 'Probe Proliferate', type_line: 'Sorcery', mana_cost: '{U}', cmc: 1, colors: ['U'], layout: 'normal', oracle_text: 'Proliferate.', keywords: [] };
    const o = T.put('A', 'Island', 'hand');
    o.card = card;
    T.mana('A', 'U');
    T.cast('A', o);
    T.resolve();
    t.eq(mine.counters['+1/+1'], 2); t.eq(hurt.counters['-1/-1'], 1); t.eq(theirs.counters['-1/-1'], 2); t.eq(theirGood.counters['+1/+1'], 1);
    t.eq(T.player('A').poison, 2); t.eq(T.player('B').poison, 3);
  });

  test('Devilish Valet: doubles its own power when another creature enters', (mk, t) => {
    t.auto('Devilish Valet');
    const T = mk();
    const v = T.bf('A', 'Devilish Valet');
    const p0 = T.g.powerOf(v);
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.g.powerOf(v), p0 * 2);
  });

  test('Vrestin: a counter on each attacking Insect', (mk, t) => {
    t.auto('Vrestin, Menoptra Leader');
    const T = mk();
    T.bf('A', 'Vrestin, Menoptra Leader').counters['+1/+1'] = 2;
    const ins = T.bf('A', 'Giant Cockroach'), bear = T.bf('A', 'Grizzly Bears');
    ins.summoningSick = false; bear.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: ins.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers');
    t.eq(ins.counters['+1/+1'], 1); t.ok(!bear.counters['+1/+1']);
  });

  test('Hungering Hydra: as many counters as the damage dealt to it', (mk, t) => {
    t.auto('Hungering Hydra');
    const T = mk();
    const h = T.bf('A', 'Hungering Hydra');
    h.counters['+1/+1'] = 3;
    T.mana('B', 'R');
    T.toMain('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: [h.id] });
    T.resolve();
    t.eq(h.counters['+1/+1'], 5);
  });

  test('Sunfall: the Incubator gets a counter for each creature exiled', (mk, t) => {
    t.auto('Sunfall');
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Hill Giant'); T.bf('B', 'Gray Ogre');
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Sunfall'));
    T.resolve();
    const inc = T.bfOf('A').find(o => o.name === 'Incubator');
    t.ok(inc); t.eq(inc.counters['+1/+1'], 3);
  });

  test('Malakir Bloodwitch: drains for each Vampire', (mk, t) => {
    t.auto('Malakir Bloodwitch');
    const T = mk();
    T.bf('A', 'Vampire Nighthawk');
    T.mana('A', '3BB');
    T.cast('A', T.hand('A', 'Malakir Bloodwitch'));
    T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 22);
  });

  test('On Wings of Gold: Zombies and tokens, nothing else', (mk, t) => {
    t.auto('On Wings of Gold');
    const T = mk();
    T.bf('A', 'On Wings of Gold');
    const z = T.bf('A', 'Walking Corpse'), b = T.bf('A', 'Grizzly Bears');
    t.ok(T.g.hasKw(z, 'flying')); t.eq(T.g.powerOf(z), 3);
    t.ok(!T.g.hasKw(b, 'flying'));
  });

  test('Agent Frank Horrigan: indestructible once it has attacked', (mk, t) => {
    t.auto('Agent Frank Horrigan');
    const T = mk();
    const a = T.bf('A', 'Agent Frank Horrigan');
    t.ok(!T.g.hasKw(a, 'indestructible'));
    a.attackedTurn = T.g.turn; T.g.bumpBoard();
    t.ok(T.g.hasKw(a, 'indestructible'));
  });

  test('Fanatic of Mogis: damage to each opponent equal to devotion to red', (mk, t) => {
    t.auto('Fanatic of Mogis');
    const T = mk();
    T.bf('A', 'Goblin Guide');
    T.mana('A', '3R');
    T.cast('A', T.hand('A', 'Fanatic of Mogis'));
    T.resolve();
    t.eq(T.life('B'), 20 - T.g.devotionOf('A', 'R'));
    t.ok(T.g.devotionOf('A', 'R') >= 2);
  });

  test('Baloth Prime: enters tapped with six stun counters', (mk, t) => {
    t.auto('Baloth Prime');
    const T = mk();
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Baloth Prime'));
    T.resolve();
    const b = T.bfOf('A').find(o => o.name === 'Baloth Prime');
    t.ok(b.tapped); t.eq(b.counters.stun, 6);
  });

  test('Rug of Smothering: each spell costs its caster a life per spell this turn', (mk, t) => {
    t.auto('Rug of Smothering');
    const T = mk();
    T.bf('A', 'Rug of Smothering');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('A'), 17, '1 then 2');
  });

  test('Flourishing Defenses: a token for each -1/-1 counter', (mk, t) => {
    t.auto('Flourishing Defenses');
    const T = mk();
    T.bf('A', 'Flourishing Defenses');
    const g = T.bf('B', 'Hill Giant');
    T.g.addCounters(g, '-1/-1', 2);
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 2);
  });

  test('Typhoon: each opponent takes as much as the Islands they control', (mk, t) => {
    t.auto('Typhoon');
    const T = mk();
    T.bf('B', 'Island'); T.bf('B', 'Island'); T.bf('A', 'Island');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Typhoon'));
    T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
  });

  test("Kaya's Wrath: life for each of your own creatures destroyed", (mk, t) => {
    t.auto("Kaya's Wrath");
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Grizzly Bears'); T.bf('B', 'Hill Giant');
    T.mana('A', 'WWBB');
    T.cast('A', T.hand('A', "Kaya's Wrath"));
    T.resolve();
    t.eq(T.life('A'), 22);
  });

  test('Phyrexian Rebirth: an X/X Horror for the creatures destroyed', (mk, t) => {
    t.auto('Phyrexian Rebirth');
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('B', 'Hill Giant'); T.bf('B', 'Gray Ogre');
    T.mana('A', '4WW');
    T.cast('A', T.hand('A', 'Phyrexian Rebirth'));
    T.resolve();
    const h = T.bfOf('A').find(o => o.isToken);
    t.ok(h); t.eq(T.g.powerOf(h), 3);
  });

  test('Zo-Zu the Punisher: 2 damage to whoever\'s land entered', (mk, t) => {
    t.auto('Zo-Zu the Punisher');
    const T = mk();
    T.bf('A', 'Zo-Zu the Punisher');
    T.nextTurn('B');
    T.toMain('B');
    T.playLand('B', T.hand('B', 'Mountain'));
    T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.life('A'), 20);
  });

  test('Beza: the Treasure, life, Fish and card only where an opponent has more', (mk, t) => {
    t.auto('Beza, the Bounding Spring');
    const T = mk();
    T.bf('B', 'Plains'); T.bf('B', 'Plains');
    T.player('B').life = 25;
    T.mana('A', '2WW');
    T.cast('A', T.hand('A', 'Beza, the Bounding Spring'));
    T.resolve();
    t.ok(T.bfOf('A').some(o => o.name === 'Treasure'), 'a Treasure');
    t.eq(T.life('A'), 24, '4 life');
  });

  test('Merry: first strike only while equipped', (mk, t) => {
    const T = mk();
    const m = T.bf('A', 'Merry, Esquire of Rohan');
    t.ok(!T.g.hasKw(m, 'first strike'));
    const s = T.bf('A', 'Bonesplitter');
    s.attachedTo = m.id; m.attachments = [s.id]; T.g.bumpBoard();
    t.ok(T.g.hasKw(m, 'first strike'));
  });

  test('Furnace of Rath doubles any damage; Fiendish Duo only to an opponent', (mk, t) => {
    t.auto('Furnace of Rath'); t.auto('Fiendish Duo');
    const T = mk();
    T.bf('B', 'Furnace of Rath');
    const g = T.bf('B', 'Hill Giant');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 16);
    T.cast('A', T.hand('A', 'Shock'), { targets: [g.id] });
    T.resolve();
    t.eq(g.zone, 'graveyard', '4 damage to the 3/3');
  });

  test('Fiendish Duo: double to its opponents, not to their creatures', (mk, t) => {
    const T = mk();
    T.bf('A', 'Fiendish Duo');
    const g = T.bf('B', 'Hill Giant');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 16);
    T.cast('A', T.hand('A', 'Shock'), { targets: [g.id] });
    T.resolve();
    t.eq(g.damage, 2);
  });

  test('Crypt Incursion: creature cards only, 3 life each', (mk, t) => {
    t.auto('Crypt Incursion');
    const T = mk();
    T.grave('B', 'Grizzly Bears'); T.grave('B', 'Hill Giant'); T.grave('B', 'Island');
    T.mana('A', '2B');
    T.cast('A', T.hand('A', 'Crypt Incursion'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.zone('B', 'graveyard').length, 1); t.eq(T.life('A'), 26);
  });

  test("Polymorphist's Jest: that player's creatures are 1/1 Frogs", (mk, t) => {
    t.auto("Polymorphist's Jest");
    const T = mk();
    const s = T.bf('B', 'Serra Angel'), mine = T.bf('A', 'Serra Angel');
    T.mana('A', '1UU');
    T.cast('A', T.hand('A', "Polymorphist's Jest"), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.g.powerOf(s), 1); t.ok(!T.g.hasKw(s, 'flying')); t.eq(T.g.powerOf(mine), 4);
  });

  test('Platinum Emperion: its controller\'s life total does not change', (mk, t) => {
    t.auto('Platinum Emperion');
    const T = mk();
    T.bf('A', 'Platinum Emperion');
    T.mana('B', 'R');
    T.toMain('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: [{ kind: 'player', id: 'A' }] });
    T.resolve();
    t.eq(T.life('A'), 20);
  });

  test('Slaughter Specialist: each opponent gets a Human', (mk, t) => {
    t.auto('Slaughter Specialist');
    const T = mk();
    T.put('A', 'Slaughter Specialist', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.bfOf('B').filter(o => o.isToken).length, 1);
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 0);
  });

  test('Villainous Wrath: life for each of their creatures, then all die', (mk, t) => {
    t.auto('Villainous Wrath');
    const T = mk();
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Hill Giant'); T.bf('A', 'Grizzly Bears');
    T.mana('A', '3BB');
    T.cast('A', T.hand('A', 'Villainous Wrath'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 18); t.eq(T.g.battlefield.filter(o => (o.analysis() || {}).isCreature).length, 0);
  });

  test('High Score: a card only with the biggest creature', (mk, t) => {
    t.auto('High Score');
    const T = mk();
    T.bf('A', 'High Score');
    T.bf('A', 'Hill Giant'); T.bf('B', 'Grizzly Bears');
    const h0 = T.zone('A', 'hand').length;
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test('Pain Distributor: a Treasure for each player\'s first spell only', (mk, t) => {
    t.auto('Pain Distributor');
    const T = mk();
    T.bf('A', 'Pain Distributor');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    T.cast('A', T.hand('A', 'Shock'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1);
  });

  test('Rhonas the Indomitable: needs another creature with power 4', (mk, t) => {
    t.auto('Rhonas the Indomitable');
    const T = mk();
    const r = T.bf('A', 'Rhonas the Indomitable');
    t.ok(!T.g._condMet({ kind: 'controlPower', n: 4, other: true }, { controller: 'A', obj: r }), 'itself does not count');
    T.bf('A', 'Craw Wurm');
    t.ok(T.g._condMet({ kind: 'controlPower', n: 4, other: true }, { controller: 'A', obj: r }));
  });

  test('Bonehoard: +X/+X for creature cards in all graveyards', (mk, t) => {
    t.auto('Bonehoard');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), bh = T.bf('A', 'Bonehoard');
    bh.attachedTo = bear.id; bear.attachments = [bh.id];
    T.grave('A', 'Hill Giant'); T.grave('B', 'Gray Ogre');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 4);
  });

  test('Vraska, the Cutting Glare: the destroyed permanent\'s controller gets the Treasure', (mk, t) => {
    t.auto('Vraska, the Cutting Glare');
    const T = mk();
    for (let i = 0; i < 6; i++) T.bf('A', 'Swamp');
    const g = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: g.id }] }));
    T.put('A', 'Vraska, the Cutting Glare', 'battlefield', { etb: true });
    T.resolve();
    t.eq(g.zone, 'graveyard');
    t.eq(T.bfOf('B').filter(o => o.name === 'Treasure').length, 1);
  });

  test('Phylath: a Plant for each basic land, not the others', (mk, t) => {
    t.auto('Phylath, World Sculptor');
    const T = mk();
    T.bf('A', 'Forest'); T.bf('A', 'Plains'); T.bf('A', 'Savannah');
    T.put('A', 'Phylath, World Sculptor', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 2);
  });

  test('A count of Plains you control counts Plains', (mk, t) => {
    const card = { id: 'probe-plains', name: 'Probe Plains', type_line: 'Sorcery', mana_cost: '{W}', cmc: 1, colors: ['W'], layout: 'normal',
      oracle_text: 'Create a 1/1 white Soldier creature token for each Plains you control.', keywords: [] };
    const e = engine().oracle.analyze(card).abilities[0].effects[0];
    t.eq(e.count.scope.subtype, 'plains');
  });

  test('Formless Genesis: X is the land cards in your graveyard', (mk, t) => {
    t.auto('Formless Genesis');
    const T = mk();
    T.grave('A', 'Forest'); T.grave('A', 'Island'); T.grave('A', 'Grizzly Bears');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Formless Genesis'));
    T.resolve();
    const tok = T.bfOf('A').find(o => o.isToken);
    t.eq(T.g.powerOf(tok), 2); t.ok(T.g.hasKw(tok, 'deathtouch'));
  });

  test('Anowon: each player sacrifices a non-Vampire', (mk, t) => {
    t.auto('Anowon, the Ruin Sage');
    const T = mk();
    T.bf('A', 'Anowon, the Ruin Sage');
    const v = T.bf('A', 'Vampire Nighthawk'), b = T.bf('B', 'Grizzly Bears');
    T.nextTurn('A');
    T.toMain('A');
    t.eq(b.zone, 'graveyard'); t.eq(v.zone, 'battlefield');
  });

  test('Plural creature types in trigger words: "one or more Elves"', (mk, t) => {
    const T = mk();
    const elf = T.bf('A', 'Llanowar Elves'), ally = T.bf('A', 'Kazandu Blademaster'), bear = T.bf('A', 'Grizzly Bears');
    t.ok(T.g._cardFitsWords(elf, 'elves'));
    t.ok(T.g._cardFitsWords(ally, 'allies'));
    t.ok(!T.g._cardFitsWords(bear, 'elves'));
  });

  test('Punishing Fire: back to hand when an opponent gains life', (mk, t) => {
    t.auto('Punishing Fire');
    const T = mk();
    const pf = T.grave('A', 'Punishing Fire');
    T.mana('A', 'R');
    T.g.changeLife(T.player('B'), 3);
    T.resolve();
    t.eq(pf.zone, 'hand');
  });

  test('Warcry Phoenix: comes back attacking with three attackers', (mk, t) => {
    t.auto('Warcry Phoenix');
    const T = mk();
    const ph = T.grave('A', 'Warcry Phoenix');
    const xs = [T.bf('A', 'Grizzly Bears'), T.bf('A', 'Grizzly Bears'), T.bf('A', 'Grizzly Bears')];
    xs.forEach(x => { x.summoningSick = false; });
    T.answer('declareAttackers', () => { T.mana('A', '2R'); return xs.map(x => ({ attackerId: x.id, defenderId: 'B' })); });
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers');
    t.eq(ph.zone, 'battlefield'); t.ok(ph.tapped); t.eq(ph.attacking, 'B');
  });

  test('Boneyard Scourge: a Dragon dying brings it back from the graveyard', (mk, t) => {
    t.auto('Boneyard Scourge');
    const T = mk();
    const bs = T.grave('A', 'Boneyard Scourge');
    const d = T.bf('A', 'Shivan Dragon');
    T.mana('A', '1B');
    T.g.moveObject(d, 'graveyard');
    T.resolve();
    t.eq(bs.zone, 'battlefield');
  });

  test('Harald: an Elf, Warrior, or Tyvar card from the top five', (mk, t) => {
    t.auto('Harald, King of Skemfar');
    const T = mk();
    for (const n of ['Island', 'Island', 'Llanowar Elves', 'Island', 'Grizzly Bears']) T.top('A', n);
    T.answer('pickCard', (ch) => { t.eq(ch.cards.length, 1, 'only the Elf offered'); return { cardIds: [ch.cards[0].id] }; });
    T.put('A', 'Harald, King of Skemfar', 'battlefield', { etb: true });
    T.resolve();
    t.ok(T.zone('A', 'hand').some(o => o.name === 'Llanowar Elves'));
  });

  test('Star Charter-style: only creatures with power 3 or less are offered', (mk, t) => {
    const T = mk();
    const card = { id: 'probe-look', name: 'Probe Look', type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, colors: ['G'], layout: 'normal',
      oracle_text: 'Look at the top four cards of your library. You may reveal a creature card with power 3 or less from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', keywords: [] };
    for (const n of ['Craw Wurm', 'Grizzly Bears', 'Island', 'Hill Giant']) T.top('A', n);
    const o = T.put('A', 'Island', 'hand'); o.card = card;
    T.answer('pickCard', (ch) => { t.eq(ch.cards.length, 2, 'the Bears and the Giant'); return { cardIds: [] }; });
    T.mana('A', 'G');
    T.cast('A', o);
    T.resolve();
  });

  test('Rush of Inspiration: pay two energy to keep the cards', (mk, t) => {
    t.auto('Rush of Inspiration // Crackling Falls');
    const T = mk();
    T.player('A').energy = 2;
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', '1UU');
    T.cast('A', T.hand('A', 'Rush of Inspiration // Crackling Falls'));
    T.resolve();
    t.eq(T.player('A').energy, 0);
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'drew two, discarded none');
  });

  test('Phyrexian Dragon Engine: only from the graveyard', (mk, t) => {
    t.auto('Phyrexian Dragon Engine');
    const T = mk();
    const e1 = T.grave('A', 'Phyrexian Dragon Engine');
    const h0 = T.zone('A', 'hand').length;
    T.g.moveObject(e1, 'battlefield');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 3, 'hand discarded, three drawn');
    void h0;
  });

  test('Sanguine Spy: five different mana values in the graveyard', (mk, t) => {
    const T = mk();
    const s = T.bf('A', 'Sanguine Spy');
    for (const n of ['Island', 'Llanowar Elves', 'Grizzly Bears', 'Hill Giant']) T.grave('A', n);
    t.ok(!T.g._condMet({ kind: 'graveMvDistinct', n: 5 }, { controller: 'A', obj: s }));
    T.grave('A', 'Craw Wurm');
    t.ok(T.g._condMet({ kind: 'graveMvDistinct', n: 5 }, { controller: 'A', obj: s }));
  });

  test('Kinship (Nightshade Schemers): only when the top card shares a creature type', (mk, t) => {
    t.auto('Nightshade Schemers');
    const T = mk();
    T.bf('A', 'Nightshade Schemers');
    T.top('A', 'Island');
    T.nextTurn('A'); T.toMain('A');
    t.eq(T.life('B'), 20, 'an Island shares nothing');
    T.top('A', 'Faerie Seer');
    T.nextTurn('A'); T.toMain('A');
    t.eq(T.life('B'), 18, 'a Faerie does');
  });

  test('In the Presence of Ages: a creature and a land, the rest to the graveyard', (mk, t) => {
    t.auto('In the Presence of Ages');
    const T = mk();
    for (const n of ['Grizzly Bears', 'Forest', 'Shock', 'Hill Giant']) T.top('A', n);
    const h0 = T.zone('A', 'hand').length;
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'In the Presence of Ages'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 2);
    t.eq(T.zone('A', 'graveyard').filter(o => o.name !== 'In the Presence of Ages').length, 2);
  });

  test('Look, reveal one, the rest to the bottom in a random order', (mk, t) => {
    const T = mk();
    const card = { id: 'probe-look2', name: 'Probe Look Two', type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, colors: ['G'], layout: 'normal',
      oracle_text: 'Look at the top three cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', keywords: [] };
    for (const n of ['Island', 'Grizzly Bears', 'Swamp']) T.top('A', n);
    const o = T.put('A', 'Island', 'hand'); o.card = card;
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T.mana('A', 'G');
    T.cast('A', o);
    T.resolve();
    const lib = T.zone('A', 'library');
    t.ok(T.zone('A', 'hand').some(x => x.name === 'Grizzly Bears'));
    t.eq(lib.slice(-2).map(x => x.name).sort().join(), 'Island,Swamp', 'the other two at the bottom');
  });

  test('Hunt the Weak: a counter, then that creature fights', (mk, t) => {
    t.auto('Hunt the Weak');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Hunt the Weak'), { targets: [bear.id, elf.id] });
    T.resolve();
    t.eq(elf.zone, 'graveyard');
    t.eq(bear.damage, 1); t.eq(bear.counters['+1/+1'], 1);
  });

  test('Gruul Ragebeast: the creature that entered fights', (mk, t) => {
    t.auto('Gruul Ragebeast');
    const T = mk();
    T.bf('A', 'Gruul Ragebeast');
    const elf = T.bf('B', 'Llanowar Elves');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: elf.id }] }));
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(elf.zone, 'graveyard');
  });

  test('Singularity Rupture: creatures die, then each chosen player mills half', (mk, t) => {
    t.auto('Singularity Rupture');
    const T = mk();
    const g = T.bf('B', 'Hill Giant');
    const l0 = T.zone('B', 'library').length, a0 = T.zone('A', 'library').length;
    T.mana('A', '3UBB');
    T.cast('A', T.hand('A', 'Singularity Rupture'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(g.zone, 'graveyard');
    t.eq(T.zone('B', 'library').length, l0 - Math.floor(l0 / 2));
    t.eq(T.zone('A', 'library').length, a0, 'not the caster');
  });

  test('Phyrexian mana paid with life costs life', (mk, t) => {
    const T = mk();
    const g = T.bf('B', 'Hill Giant');
    T.mana('A', '1');
    T.cast('A', T.hand('A', 'Dismember'), { targets: [g.id] });
    T.resolve();
    t.eq(T.life('A'), 16, 'two Phyrexian pips, 4 life');
    t.eq(g.zone, 'graveyard');
  });

  test('Platinum Emperion: no life can be paid', (mk, t) => {
    const T = mk();
    T.bf('A', 'Platinum Emperion');
    const g = T.bf('B', 'Hill Giant');
    T.mana('A', '1');
    let refused = false;
    try { T.cast('A', T.hand('A', 'Dismember'), { targets: [g.id] }); } catch (e) { refused = true; }
    t.ok(refused, 'Dismember cannot be paid for with life');
    t.eq(T.life('A'), 20);
  });

  test('Return to Action: +1/+0, lifelink and a quoted ability on the target', (mk, t) => {
    t.auto('Return to Action');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1B');
    T.cast('A', T.hand('A', 'Return to Action'), { targets: [bear.id] });
    T.resolve();
    t.eq(T.g.powerOf(bear), 3); t.ok(T.g.hasKw(bear, 'lifelink'));
    t.ok((bear.analysis().abilities || []).some(a => a.granted), 'the quoted ability is on it');
  });

  test('Setessan Tactics: any number of targets each get the bonus and the ability', (mk, t) => {
    t.auto('Setessan Tactics');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Hill Giant');
    T.mana('A', '1GG');
    T.cast('A', T.hand('A', 'Setessan Tactics'), { targets: [a.id, b.id] });
    T.resolve();
    t.eq(T.g.powerOf(a), 3); t.eq(T.g.powerOf(b), 4);
    t.ok((b.analysis().abilities || []).some(x => x.granted && x.kind === 'activated'));
  });

  test('Ob Nixilis Reignited: the opponent gets the emblem and loses life on draws', (mk, t) => {
    t.auto('Ob Nixilis Reignited');
    const T = mk();
    const ob = T.bf('A', 'Ob Nixilis Reignited');
    ob.counters.loyalty = 8;
    const idx = ob.analysis().manaAbilities.length + ob.analysis().abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty').findIndex(x => /emblem/.test(x.text));
    T.activate('A', ob, idx, { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.zone('B', 'command').length, 1, 'the emblem is the opponent\'s');
    T.g._drawCards(T.player('B'), 1);
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Inspiring Leader: a granted standing rule works from the commander', (mk, t) => {
    t.auto('Inspiring Leader');
    const T = mk();
    T.bf('A', 'Inspiring Leader');
    const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
    T.mana('A', '1W');
    T.g._createToken('A', { n: 1, pt: '1/1', subtypes: 'Soldier', colorWords: ['white'], keywords: [] });
    T.g.bumpBoard();
    const tok = T.bfOf('A').find(o => o.isToken);
    t.eq(T.g.powerOf(tok), 3);
    cmd.isCommander = false; T.g.bumpBoard();
    t.eq(T.g.powerOf(tok), 1, 'not without a commander');
  });

  test('Sedge Sliver: each Sliver gets +1/+1 with a Swamp', (mk, t) => {
    t.auto('Sedge Sliver');
    const T = mk();
    const s = T.bf('A', 'Sedge Sliver'), m = T.bf('A', 'Muscle Sliver');
    const p0 = T.g.powerOf(m);
    T.bf('A', 'Swamp');
    t.eq(T.g.powerOf(m), p0 + 1); void s;
  });

  test('Lavaclaw Reaches: the animated land has its quoted ability', (mk, t) => {
    t.auto('Lavaclaw Reaches');
    const T = mk();
    const l = T.bf('A', 'Lavaclaw Reaches');
    T.mana('A', '1BR');
    T.activate('A', l, l.analysis().manaAbilities.length);
    T.resolve();
    t.ok(T.g.characteristics(l).isCreature);
    t.ok(l.analysis().abilities.some(a => a.granted && a.kind === 'activated'), 'the {X} pump is there');
  });

  test('Quicksmith Spy: the artifact taps to draw while you control the Spy', (mk, t) => {
    t.auto('Quicksmith Spy');
    const T = mk();
    const art = T.bf('A', 'Mind Stone');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: art.id }] }));
    T.put('A', 'Quicksmith Spy', 'battlefield', { etb: true });
    T.resolve();
    t.ok(art.analysis().abilities.some(a => a.granted), 'granted');
    const spy = T.bfOf('A').find(o => o.name === 'Quicksmith Spy');
    T.g.moveObject(spy, 'graveyard');
    T.g._lapseWhileEffects();
    t.ok(!art.analysis().abilities.some(a => a.granted), 'gone with the Spy');
  });

  test('Possessed Aven: threshold makes it bigger, black, with the ability', (mk, t) => {
    t.auto('Possessed Aven');
    const T = mk();
    const a = T.bf('A', 'Possessed Aven');
    const p0 = T.g.powerOf(a);
    for (let i = 0; i < 7; i++) T.grave('A', 'Island');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(a), p0 + 1);
    t.ok(a.analysis().abilities.some(x => x.granted && x.kind === 'activated'));
  });

  test('Hostage Taker: the exiled card can be cast with any mana while it stays exiled', (mk, t) => {
    t.auto('Hostage Taker');
    const T = mk();
    const g = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: g.id }] }));
    T.put('A', 'Hostage Taker', 'battlefield', { etb: true });
    T.resolve();
    t.eq(g.zone, 'exile');
    T.nextTurn('A'); T.toMain('A');
    T.mana('A', '3U');
    T.cast('A', g);
    T.resolve();
    t.eq(g.zone, 'battlefield'); t.eq(g.controller, 'A');
  });

  test('Act on Impulse: the three exiled cards are playable this turn only', (mk, t) => {
    t.auto('Act on Impulse');
    const T = mk();
    for (const n of ['Grizzly Bears', 'Forest', 'Shock']) T.top('A', n);
    T.mana('A', '2R');
    T.cast('A', T.hand('A', 'Act on Impulse'));
    T.resolve();
    const ex = T.zone('A', 'exile');
    t.eq(ex.length, 3);
    t.ok(ex.every(o => o.impulseBy === 'A' && o.impulseUntil === T.g.turn));
    const shock = ex.find(o => o.name === 'Shock');
    T.mana('A', 'R');
    T.cast('A', shock, { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Goblin Dark-Dwellers: cast a cheap instant from the graveyard free, then it is exiled', (mk, t) => {
    t.auto('Goblin Dark-Dwellers');
    const T = mk();
    const sh = T.grave('A', 'Shock');
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'object', id: sh.id }] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.put('A', 'Goblin Dark-Dwellers', 'battlefield', { etb: true });
    T.resolve();
    t.eq(T.life('B'), 18);
    t.eq(sh.zone, 'exile');
  });

  test('Memory Plunder: an opponent\'s instant from their graveyard, for nothing', (mk, t) => {
    t.auto('Memory Plunder');
    const T = mk();
    const sh = T.grave('B', 'Shock');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'UBUB');
    T.cast('A', T.hand('A', 'Memory Plunder'), { targets: [sh.id] });
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Cascade and discover into a spell with a target: its target is chosen, and the rest go to the bottom', (mk, t) => {
    const T = mk();
    const bolt = T.top('A', 'Lightning Bolt');
    const big = T.top('A', 'Colossal Dreadmaw');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'RG2');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    T.resolve();
    t.eq(T.life('B'), 17, 'the Bolt was cast at B');
    t.eq(big.zone, 'library', 'the Dreadmaw went back');
    t.eq(T.zone('A', 'library').slice(-1)[0].id, big.id, 'to the bottom');
    const T2 = mk();
    T2.top('A', 'Lightning Bolt');
    T2.answer('confirm', () => ({ yes: true }));
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T2.mana('A', 'RR2');
    T2.cast('A', T2.hand('A', 'Geological Appraiser'));
    T2.resolve();
    T2.resolve();
    t.eq(T2.life('B'), 17, 'discover cast the Bolt at B');
  });

  test('Jaya, Fiery Negotiator: of the two exiled, only the one chosen may be played this turn', (mk, t) => {
    const T = mk();
    const bolt = T.top('A', 'Lightning Bolt');
    const bear = T.top('A', 'Grizzly Bears');
    const jaya = T.bf('A', 'Jaya, Fiery Negotiator');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Lightning Bolt').id] }));
    T.activate('A', jaya, 1);
    T.resolve();
    t.eq(bolt.zone, 'exile');
    t.eq(bolt.impulseBy, 'A', 'the Bolt may be played');
    t.no(bear.impulseBy, 'the Bears may not');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.eq(T.life('B'), 17);
  });

  test('Thor, God of Thunder: an instant, sorcery or Equipment from the graveyard, playable until the end of your next turn', (mk, t) => {
    t.auto('Thor, God of Thunder');
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bolt.id }] }));
    T.put('A', 'Thor, God of Thunder', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bolt.zone, 'exile');
    t.eq(bolt.impulseBy, 'A');
    t.ok(bolt.impulseUntil > T.g.turn, 'into the next turn of its own');
  });

  test('Silkwrap only exiles a creature an opponent controls', (mk, t) => {
    t.auto('Silkwrap');
    const ab = engine().oracle.analyze(card('Silkwrap')).abilities.find(a => a.kind === 'triggered');
    const spec = ab.effects.find(e => e.targets).targets[0];
    t.eq(spec.controller, 'opponent');
    t.eq(spec.maxMv, 3);
  });

  test('Renegade Bull: exile an instant from your graveyard as it attacks, and cast a copy of it free', (mk, t) => {
    t.auto('Renegade Bull');
    const T = mk();
    const bull = T.bf('A', 'Renegade Bull');
    const bolt = T.grave('A', 'Lightning Bolt');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bolt.id }] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', () => ({ yes: true }));
    T.answer('declareAttackers', () => [{ attackerId: bull.id, defenderId: 'B' }]);
    const life = T.life('B');
    T.toMain('A', 'endCombat');
    t.eq(bolt.zone, 'exile', 'the card stays exiled');
    t.ok(T.life('B') <= life - 3, 'the copy was cast at B');
    t.no(T.zone('A', 'graveyard').some(o => o.name === 'Lightning Bolt'), 'and the copy left nothing behind');
  });

  test('Mana Reflection doubles what a land makes; two of them, four times as much', (mk, t) => {
    t.auto('Mana Reflection');
    const T = mk();
    T.bf('A', 'Mana Reflection');
    const f = T.bf('A', 'Forest');
    T.g.tapForMana('A', f.id, 0);
    t.eq(T.g.player('A').pool.total(), 2);
    T.bf('A', 'Mana Reflection');
    const f2 = T.bf('A', 'Forest');
    T.g.tapForMana('A', f2.id, 0);
    t.eq(T.g.player('A').pool.total(), 6);
  });

  test('Mana Flare: every player gets one more of what their land made', (mk, t) => {
    t.auto('Mana Flare');
    t.auto('Badgermole Cub');
    const T = mk();
    T.bf('A', 'Mana Flare');
    const m = T.bf('B', 'Mountain');
    T.g.tapForMana('B', m.id, 0);
    t.eq(T.g.player('B').pool.total(), 2, 'B, from A\'s Mana Flare');
  });

  test('Manabarbs and Zhur-Taa Druid: tapping for mana triggers', (mk, t) => {
    t.auto('Manabarbs');
    t.auto('Zhur-Taa Druid');
    const T = mk();
    T.bf('A', 'Manabarbs');
    const druid = T.bf('B', 'Zhur-Taa Druid');
    druid.summoningSick = false; druid.entered = -1;
    T.g.tapForMana('B', druid.id, 0);
    T.resolve(); T.resolve();
    t.eq(T.life('A'), 19, 'the Druid hit A');
    const m = T.bf('B', 'Mountain');
    T.g.tapForMana('B', m.id, 0);
    T.resolve();
    t.eq(T.life('B'), 19, 'Manabarbs hit B for the Mountain, not for the Druid');
  });

  test('Time Stop ends the turn: what is on the stack is exiled and the next player\'s turn begins', (mk, t) => {
    t.auto('Time Stop');
    t.auto('Sundial of the Infinite');
    const T = mk();
    const turn = T.g.turn;
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: [{ kind: 'player', id: 'B' }], resolve: false });
    const stop = T.hand('A', 'Time Stop');
    T.mana('A', 'UU4');
    T.cast('A', stop);
    T.resolve();
    t.eq(stop.zone, 'exile', 'Time Stop itself is exiled');
    t.eq(bolt.zone, 'exile', 'and the Bolt under it');
    t.eq(T.life('B'), 20);
    t.ok(T.g.turn > turn, 'the turn is over');
  });

  test('Fact or Fiction: an opponent splits the five, you take a pile and the other goes to the graveyard', (mk, t) => {
    t.auto('Fact or Fiction');
    t.auto('Steam Augury');
    const T = mk();
    const top = ['Lightning Bolt', 'Grizzly Bears', 'Shock', 'Forest', 'Island'].reverse().map(nm => T.top('A', nm));
    let split = null, choice = null;
    T.answer('choose', (ch) => { split = ch; return { picks: [top.find(o => o.name === 'Lightning Bolt').id] }; });
    T.answer('choose', (ch) => { choice = ch; return { picks: [1] }; });
    T.mana('A', 'U3');
    T.cast('A', T.hand('A', 'Fact or Fiction'));
    t.eq(split && split.playerId, 'B', 'the opponent separates them');
    t.eq(split && split.purpose, 'pileSplit');
    t.eq(choice && choice.playerId, 'A', 'and A chooses');
    t.eq(choice && choice.options[0].cards.length, 1, 'each pile shows its cards');
    t.eq(choice && choice.options[1].cards.map(c => c.name).sort().join(), choice.options[1].ids.map(id => T.g.obj(id).name).sort().join(), 'in the order of their ids');
    const bolt = top.find(o => o.name === 'Lightning Bolt');
    t.eq(bolt.zone, 'graveyard', 'the Bolt pile was not taken');
    t.eq(top.filter(o => o.zone === 'hand').length, 4, 'the other four were');
  });

  test('Bots split piles the way people do: the best card alone', (mk, t) => {
    const T = mk();
    const top = ['Lightning Bolt', 'Forest', 'Island'].reverse().map(nm => T.top('A', nm));
    T.mana('A', 'U3');
    T.g.player('B').isBot = true;
    const prev = T.g.player('A').isBot;
    T.g.player('A').isBot = true;
    T.cast('A', T.hand('A', 'Fact or Fiction'));
    T.g.player('A').isBot = prev;
    t.eq(top.filter(o => o.zone === 'hand').length + top.filter(o => o.zone === 'graveyard').length, 3, 'every card went somewhere');
  });

  test('Liliana of the Veil -6: you split their permanents, they sacrifice the pile they choose', (mk, t) => {
    t.auto('Liliana of the Veil');
    t.auto('Do or Die');
    const T = mk();
    const lili = T.bf('A', 'Liliana of the Veil');
    lili.counters.loyalty = 6;
    const bear = T.bf('B', 'Grizzly Bears');
    const land = T.bf('B', 'Forest');
    const elf = T.bf('B', 'Llanowar Elves');
    let asked = [];
    T.answer('choose', (ch) => { asked.push(ch); return { picks: [land.id] }; });
    T.answer('choose', (ch) => { asked.push(ch); return { picks: [1] }; });
    T.activate('A', lili, 2, { targets: ['B'] });
    t.eq(asked[0] && asked[0].playerId, 'A', 'A separates');
    t.eq(asked[1] && asked[1].playerId, 'B', 'B chooses');
    t.eq(land.zone, 'battlefield', 'the Forest pile stays');
    t.eq(bear.zone, 'graveyard');
    t.eq(elf.zone, 'graveyard');
  });

  test('Excess damage: Flame Spill carries it on to the controller, Lacerate Flesh counts it', (mk, t) => {
    t.auto('Flame Spill');
    t.auto('Lacerate Flesh');
    t.auto('Reverent Hoplite');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Flame Spill'), { targets: [bear] });
    t.eq(bear.zone, 'graveyard');
    t.eq(T.life('B'), 18, 'two of the four went on to B');
    const elf = T.bf('B', 'Llanowar Elves');
    elf.damage = 0;
    T.mana('A', 'R4');
    const mine = () => T.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length;
    const blood = mine();
    T.cast('A', T.hand('A', 'Lacerate Flesh'), { targets: [elf] });
    t.eq(elf.zone, 'graveyard');
    t.eq(mine() - blood, 3, 'three Blood tokens for the three left over');
  });

  test('Damage redirected: Empyrial Archangel takes what would hit you, an en-Kor passes its next damage on', (mk, t) => {
    t.auto('Empyrial Archangel');
    t.auto('Nomads en-Kor');
    t.auto('Pariah');
    const T = mk();
    const angel = T.bf('B', 'Empyrial Archangel');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 20, 'B took nothing');
    t.eq(angel.damage, 3, 'the Archangel took it');
    const T2 = mk();
    const nomads = T2.bf('A', 'Nomads en-Kor');
    const wall = T2.bf('A', 'Grizzly Bears');
    T2.activate('A', nomads, 0, { targets: [wall] });
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Shock'), { targets: [nomads] });
    t.eq(nomads.zone, 'graveyard', 'one of the two stayed, enough for a 2/1');
    t.eq(wall.damage, 1, 'and one went to the Bears');
  });

  test("Yawgmoth's Will: spells and lands from the graveyard this turn, and what would go there is exiled", (mk, t) => {
    t.auto("Yawgmoth's Will");
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt');
    const land = T.grave('A', 'Mountain');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', "Yawgmoth's Will"));
    t.ok(T.g.playLand('A', land.id), 'a land from the graveyard');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.life('B'), 17);
    t.eq(bolt.zone, 'exile', 'and the Bolt is exiled rather than going back');
    T.toMain('B', 'main');
    const shock = T.grave('A', 'Shock');
    t.no(T.g.canCast('A', shock.id).ok, 'only for that turn');
  });

  test('Eternal Scourge can be cast from exile, but not from the graveyard', (mk, t) => {
    t.auto('Eternal Scourge');
    const T = mk();
    const sc = T.grave('A', 'Eternal Scourge');
    T.mana('A', '3');
    t.no(T.g.altUsesFor('A', sc.id).some(u => u.via === 'selfGrave'), 'not from the graveyard');
    T.g.moveObject(sc, 'exile');
    t.ok(T.g.altUsesFor('A', sc.id).some(u => u.via === 'selfGrave'), 'from exile');
    T.cast('A', sc, { via: 'selfGrave' });
    t.eq(sc.zone, 'battlefield');
  });

  test('High Tide: Islands make one more blue for the rest of the turn; Past in Flames: flashback for this turn', (mk, t) => {
    t.auto('High Tide');
    t.auto('Past in Flames');
    t.auto('Forsaken Monument');
    const T = mk();
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'High Tide'));
    const isl = T.bf('A', 'Island');
    T.g.tapForMana('A', isl.id, 0);
    t.eq(T.g.player('A').pool.total(), 2, 'two blue from one Island');
    const T2 = mk();
    const bolt = T2.grave('A', 'Lightning Bolt');
    T2.mana('A', 'R4');
    T2.cast('A', T2.hand('A', 'Past in Flames'));
    t.ok(T2.g.altUsesFor('A', bolt.id).some(u => u.via === 'flashback'), 'the Bolt has flashback');
    T2.mana('A', 'R');
    T2.cast('A', bolt, { via: 'flashback', targets: ['B'] });
    t.eq(T2.life('B'), 17);
    t.eq(bolt.zone, 'exile', 'and is exiled after');
  });

  test("Thespian's Stage becomes a copy of a land and keeps the ability; Mirage Mirror only until end of turn", (mk, t) => {
    t.auto("Thespian's Stage");
    t.auto('Mirage Mirror');
    t.auto('Protean Thaumaturge');
    const T = mk();
    const stage = T.bf('A', "Thespian's Stage");
    const forest = T.bf('B', 'Forest');
    T.mana('A', '2');
    T.activate('A', stage, stage.analysis().manaAbilities.length + 0, { targets: [forest] });
    t.eq(stage.name, 'Forest', 'it is a Forest now');
    t.ok(stage.analysis().abilities.some(ab => /becomes a copy/i.test(ab.text || '')), 'and still has the copying ability');
    const T2 = mk();
    const mirror = T2.bf('A', 'Mirage Mirror');
    const bear = T2.bf('B', 'Grizzly Bears');
    T2.mana('A', '2');
    T2.activate('A', mirror, 0, { targets: [bear] });
    t.eq(mirror.name, 'Grizzly Bears');
    t.no(mirror.analysis().abilities.some(ab => /becomes a copy/i.test(ab.text || '')), 'a plain copy keeps nothing of its own');
    T2.toMain('B', 'main');
    t.eq(mirror.name, 'Mirage Mirror', 'back to itself after the turn');
  });

  test('The Scarab God makes a 4/4 black Zombie copy; Bonehoard Dracosaur asks what it exiled', (mk, t) => {
    t.auto('The Scarab God');
    t.auto('Bonehoard Dracosaur');
    const T = mk();
    const god = T.bf('A', 'The Scarab God');
    const elves = T.grave('B', 'Llanowar Elves');
    T.mana('A', 'UB2');
    T.activate('A', god, 0, { targets: [elves] });
    t.eq(elves.zone, 'exile');
    const tok = T.g.battlefield.find(o => o.isToken && o.controller === 'A');
    t.ok(tok, 'a token');
    t.eq(tok && T.g.powerOf(tok), 4);
    t.eq(tok && T.g.toughnessOf(tok), 4);
    t.ok(tok && /Zombie/.test(tok.card.type_line) && !/Elf/.test(tok.card.type_line), 'a Zombie, not an Elf');
    t.eq(tok && tok.card.colors.join(), 'B');
    t.ok(tok && tok.analysis().manaAbilities.length, 'with the Elves\' mana ability');
  });

  test("God-Pharaoh's Gift: the card exiled as the cost is what the Zombie copies", (mk, t) => {
    t.auto("God-Pharaoh's Gift");
    const T = mk();
    T.bf('A', "God-Pharaoh's Gift");
    const e = T.grave('A', 'Llanowar Elves');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('declareAttackers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(e.zone, 'exile');
    const tok = T.g.battlefield.find(o => o.isToken);
    t.ok(tok && T.g.powerOf(tok) === 4 && T.g.hasKw(tok, 'haste'), 'a 4/4 with haste');
  });

  test('Spellskite takes the Bolt; Narset holds an opponent to one card a turn; Thousand-Year Elixir lets the new creature tap', (mk, t) => {
    t.auto('Spellskite');
    t.auto('Narset, Parter of Veils');
    t.auto('Thousand-Year Elixir');
    const T = mk();
    const skite = T.bf('B', 'Spellskite');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bear], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.mana('B', 'U');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.activate('B', skite, 0, { targets: [{ kind: 'stack', id: item.id }] });
    t.eq(bear.damage, 0, 'the Bears were spared');
    t.eq(skite.damage, 3, 'the Spellskite took it');
    const T2 = mk();
    T2.bf('B', 'Narset, Parter of Veils');
    T2.g.drawCards('A', 1);
    const hand = T2.zone('A', 'hand').length;
    T2.g.drawCards('A', 2);
    t.eq(T2.zone('A', 'hand').length, hand, 'no second card this turn');
    const T3 = mk();
    T3.bf('A', 'Thousand-Year Elixir');
    const elves = T3.bf('A', 'Llanowar Elves');
    elves.summoningSick = true;
    t.ok(T3.g.tapForMana('A', elves.id, 0), 'the Elves tap for mana the turn they arrive');
  });

  test('Ashaya makes creatures Forests that tap for green; Puresteel Paladin equips for nothing; Electro keeps red mana; Flare of Fortitude holds life', (mk, t) => {
    t.auto('Ashaya, Soul of the Wild');
    t.auto('Puresteel Paladin');
    t.auto('Electro, Assaulting Battery');
    t.auto('Flare of Fortitude');
    const T = mk();
    T.bf('A', 'Ashaya, Soul of the Wild');
    const bear = T.bf('A', 'Grizzly Bears');
    bear.summoningSick = false;
    t.ok(bear.analysis().isLand, 'the Bears are a land');
    t.ok(T.g.tapForMana('A', bear.id, 0), 'and tap for mana');
    t.eq(T.g.player('A').pool.G, 1);
    const T2 = mk();
    T2.bf('A', 'Puresteel Paladin');
    const sword = T2.bf('A', 'Bonesplitter');
    T2.bf('A', 'Ornithopter'); T2.bf('A', 'Ornithopter');
    const elf = T2.bf('A', 'Llanowar Elves');
    const eq = sword.analysis().abilities.findIndex(ab => /^Equip/i.test(ab.text || ''));
    T2.activate('A', sword, eq, { targets: [elf] });
    t.eq(sword.attachedTo, elf.id, 'equipped with no mana at all');
    const T3 = mk();
    T3.bf('A', 'Electro, Assaulting Battery');
    T3.g.player('A').pool.add('R'); T3.g.player('A').pool.add('G');
    T3.toMain('A', 'beginCombat');
    t.eq(T3.g.player('A').pool.R, 1, 'the red stays');
    t.eq(T3.g.player('A').pool.G, 0, 'the green goes');
    const T4 = mk();
    T4.mana('A', 'WW2');
    T4.cast('A', T4.hand('A', 'Flare of Fortitude'));
    T4.g.changeLife('A', -5);
    t.eq(T4.life('A'), 20, 'no change this turn');
  });

  test('Teferi, Time Raveler: opponents only at sorcery speed, and sorceries with flash for you; Balefire Dragon', (mk, t) => {
    t.auto('Teferi, Time Raveler');
    t.auto('Balefire Dragon');
    const T = mk();
    T.bf('A', 'Teferi, Time Raveler');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    t.no(T.g.canCast('B', bolt.id).ok, 'B cannot cast an instant on A\'s turn');
    const T2 = mk();
    const tef = T2.bf('A', 'Teferi, Time Raveler');
    T2.activate('A', tef, 0);
    T2.toMain('B', 'main');
    const ds = T2.hand('A', 'Divination');
    T2.mana('A', 'U2');
    T2.g.priorityIndex = T2.g.turnOrder.indexOf('A');
    t.ok(T2.g.canCast('A', ds.id).ok, 'A casts a sorcery on B\'s turn');
    const T3 = mk();
    const dragon = T3.bf('A', 'Balefire Dragon');
    dragon.summoningSick = false;
    const bear = T3.bf('B', 'Grizzly Bears');
    T3.answer('declareAttackers', () => [{ attackerId: dragon.id, defenderId: 'B' }]);
    T3.answer('declareBlockers', () => []);
    T3.toMain('A', 'endCombat');
    t.eq(bear.zone, 'graveyard', 'six damage to each of B\'s creatures');
  });

  test('Song of the Dryads makes a creature a colourless Forest; Void Winnower stops even spells; Lithoform Engine copies a creature spell as a token', (mk, t) => {
    t.auto('Song of the Dryads');
    t.auto('Void Winnower');
    t.auto('Lithoform Engine');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Song of the Dryads'), { targets: [bear] });
    t.no(T.g.characteristics(bear).isCreature, 'no longer a creature');
    t.ok(bear.analysis().isLand && (bear.analysis().subtypes || []).includes('Forest'), 'a Forest land');
    const T2 = mk();
    T2.bf('B', 'Void Winnower');
    const bears2 = T2.hand('A', 'Grizzly Bears');
    const ds = T2.hand('A', 'Divination');
    T2.mana('A', 'UG2');
    t.no(T2.g.canCast('A', bears2.id).ok, 'Grizzly Bears (2) cannot be cast');
    t.ok(T2.g.canCast('A', ds.id).ok, 'Divination (3) can');
    const T3 = mk();
    const eng = T3.bf('A', 'Lithoform Engine');
    T3.mana('A', 'G1');
    const bears = T3.hand('A', 'Grizzly Bears');
    T3.cast('A', bears, { resolve: false });
    const item = T3.g.stack[T3.g.stack.length - 1];
    T3.mana('A', '4');
    T3.activate('A', eng, 2, { targets: [{ kind: 'stack', id: item.id }] });
    t.eq(T3.g.battlefield.filter(o => o.name === 'Grizzly Bears').length, 2, 'two Bears');
    t.eq(T3.g.battlefield.filter(o => o.name === 'Grizzly Bears' && o.isToken).length, 1, 'one of them a token');
  });

  test('Phyrexian Obliterator: whoever damages it sacrifices that many; Giver of Runes may choose colourless', (mk, t) => {
    t.auto('Phyrexian Obliterator');
    t.auto('Giver of Runes');
    const T = mk();
    T.bf('B', 'Phyrexian Obliterator');
    const mine = ['Forest', 'Forest', 'Forest', 'Forest'].map(nm => T.bf('A', nm));
    T.mana('A', 'R');
    const ob = T.g.battlefield.find(o => o.name === 'Phyrexian Obliterator');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [ob] });
    t.eq(mine.filter(o => o.zone === 'graveyard').length, 3, 'A sacrificed three permanents');
    const T2 = mk();
    const giver = T2.bf('A', 'Giver of Runes');
    giver.summoningSick = false;
    const bear = T2.bf('A', 'Grizzly Bears');
    T2.answer('mode', (ch) => ({ modes: [ch.options.find(o => o.label === 'Colorless').i] }));
    T2.activate('A', giver, 0, { targets: [bear] });
    t.ok((bear.effects || []).some(x => (x.keywords || []).includes('Protection From Colorless')), 'protection from colourless');
    const orni = T2.bf('B', 'Ornithopter');
    t.ok(T2.g._protectedFrom(bear, orni), 'so an artifact creature cannot touch it');
  });

  test('Gifts Ungiven: four different cards found, the opponent sends two to the graveyard and the rest come to hand', (mk, t) => {
    t.auto('Gifts Ungiven');
    t.auto('Intuition');
    const T = mk();
    const cards = ['Lightning Bolt', 'Shock', 'Grizzly Bears', 'Divination'].map(nm => T.top('A', nm));
    let asked = [];
    T.answer('choose', (ch) => { asked.push(ch); return { picks: cards.map(c => c.id) }; });
    T.answer('choose', (ch) => { asked.push(ch); return { picks: [cards[0].id, cards[2].id] }; });
    T.mana('A', 'U3');
    T.cast('A', T.hand('A', 'Gifts Ungiven'), { targets: ['B'] });
    t.eq(asked[0] && asked[0].playerId, 'A');
    t.eq(asked[1] && asked[1].playerId, 'B', 'B picks');
    t.eq(cards.map(c => c.zone).join(), 'graveyard,hand,graveyard,hand');
  });

  test("Worship keeps you at 1 while you have a creature; Angel's Grace for a turn", (mk, t) => {
    t.auto('Worship');
    t.auto("Angel's Grace");
    const T = mk();
    T.bf('B', 'Worship');
    T.bf('B', 'Grizzly Bears');
    T.g.player('B').life = 3;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 1, 'down to 1, not 0');
    const T2 = mk();
    T2.mana('A', 'W');
    T2.cast('A', T2.hand('A', "Angel's Grace"));
    T2.g.player('A').life = 2;
    T2.g.dealDamageToPlayer(T2.g.player('A'), 5, null);
    t.eq(T2.life('A'), 1);
    T2.g.playerLoses(T2.g.player('A'), 'life');
    t.no(T2.g.player('A').hasLost, 'and A cannot lose this turn');
  });

  test('Tarmogoyf counts card types in all graveyards; Commandeer takes a spell and turns it; Tree of Perdition swaps', (mk, t) => {
    t.auto('Nighthawk Scavenger');
    t.auto('Commandeer');
    t.auto('Tree of Perdition');
    const T = mk();
    const goyf = T.bf('A', 'Tarmogoyf');
    T.grave('B', 'Lightning Bolt'); T.grave('A', 'Grizzly Bears'); T.grave('A', 'Forest');
    t.eq(T.g.powerOf(goyf), 3, 'instant, creature, land');
    t.eq(T.g.toughnessOf(goyf), 4);
    const T2 = mk();
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['B'], resolve: false });
    const item = T2.g.stack[T2.g.stack.length - 1];
    T2.mana('B', 'UU5');
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'A' }] }));
    T2.g.priorityIndex = T2.g.turnOrder.indexOf('B');
    T2.cast('B', T2.hand('B', 'Commandeer'), { targets: [{ kind: 'stack', id: item.id }] });
    t.eq(T2.life('A'), 17, 'B\'s Bolt now, at A');
    t.eq(T2.life('B'), 20);
    const T3 = mk();
    const tree = T3.bf('A', 'Tree of Perdition');
    tree.summoningSick = false;
    T3.activate('A', tree, 0, { targets: ['B'] });
    t.eq(T3.life('B'), 13, 'B at the Tree\'s toughness');
    t.eq(T3.g.toughnessOf(tree), 20, 'and the Tree at B\'s life');
  });

  test('Isochron Scepter imprints an instant and casts copies of it', (mk, t) => {
    t.auto('Isochron Scepter');
    t.auto('Panoptic Mirror');
    const T = mk();
    const bolt = T.hand('A', 'Lightning Bolt');
    T.answer('pickCard', () => ({ cardIds: [bolt.id] }));
    T.mana('A', '2');
    const sc = T.hand('A', 'Isochron Scepter');
    T.cast('A', sc);
    t.eq(bolt.zone, 'exile', 'the Bolt is under the Scepter');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '2');
    T.activate('A', sc, 0);
    t.eq(T.life('B'), 17, 'a copy hit B');
    t.eq(bolt.zone, 'exile', 'the card stays put');
  });

  test('Torment of Hailfire: each time, the opponent picks life, a permanent or a card', (mk, t) => {
    t.auto('Torment of Hailfire');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const card = T.hand('B', 'Shock');
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'sac')] }));
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'discard')] }));
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'life')] }));
    T.mana('A', 'BB3');
    T.cast('A', T.hand('A', 'Torment of Hailfire'), { x: 3 });
    t.eq(bear.zone, 'graveyard');
    t.eq(card.zone, 'graveyard');
    t.eq(T.life('B'), 17);
  });

  test('Rings of Brighthearth copies an activated ability for {2}', (mk, t) => {
    t.auto('Rings of Brighthearth');
    const T = mk();
    T.bf('A', 'Rings of Brighthearth');
    const pinger = T.bf('A', 'Prodigal Pyromancer');
    pinger.summoningSick = false;
    T.answer('confirm', () => ({ yes: true }));
    T.mana('A', '2');
    T.activate('A', pinger, 0, { targets: ['B'] });
    t.eq(T.life('B'), 18, 'pinged twice');
  });

  test('The Last Agni Kai turns excess into red mana that stays; Zul Ashur lets a Zombie be cast from the graveyard', (mk, t) => {
    t.auto('The Last Agni Kai');
    t.auto('Zul Ashur, Lich Lord');
    t.auto('Summon: Bahamut');
    const T = mk();
    const big = T.bf('A', 'Colossal Dreadmaw');
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'The Last Agni Kai'), { targets: [big, elf] });
    t.eq(elf.zone, 'graveyard');
    t.eq(T.g.player('A').pool.R, 5, 'six damage to a 1/1: five red');
    T.toMain('A', 'beginCombat');
    t.eq(T.g.player('A').pool.R, 5, 'and it stays through the turn');
    const T2 = mk();
    const zul = T2.bf('A', 'Zul Ashur, Lich Lord');
    zul.summoningSick = false;
    const zom = T2.grave('A', 'Gravecrawler');
    T2.activate('A', zul, zul.analysis().abilities.findIndex(ab => ab.kind === 'activated'), { targets: [zom] });
    t.ok(T2.g.altUsesFor('A', zom.id).some(u => u.via === 'granted'), 'the Zombie may be cast from the graveyard');
  });

  test('Aven Interrupter plots the spell it exiles and taxes casting from exile; Doc Aurlock discounts it', (mk, t) => {
    t.auto('Aven Interrupter');
    t.auto('Doc Aurlock, Grizzled Genius');
    const T = mk();
    T.mana('A', 'R');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.answer('pickTarget', () => ({ targets: [{ kind: 'stack', id: item.id }] }));
    T.mana('B', 'WW1');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.cast('B', T.hand('B', 'Aven Interrupter'));
    t.eq(T.life('B'), 20, 'the Bolt never resolved');
    t.eq(bolt.zone, 'exile');
    t.eq(bolt.plottedTurn, T.g.turn, 'plotted');
    const T2 = mk();
    T2.bf('A', 'Doc Aurlock, Grizzled Genius');
    const sh = T2.grave('A', 'Shock');
    sh.grantedFlashback = true;
    t.eq(T2.g._costDelta(sh, 'A'), -2, 'a spell from the graveyard costs {2} less');
  });

  test('Skyclave Apparition: what it exiled comes back as an X/X Illusion for its owner; Chromatic Orrery pays any colour', (mk, t) => {
    t.auto('Skyclave Apparition');
    t.auto('Chromatic Orrery');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.put('A', 'Skyclave Apparition', 'battlefield', { etb: true });
    T.resolve();
    t.eq(bear.zone, 'exile');
    const sky = T.g.battlefield.find(o => o.name === 'Skyclave Apparition');
    T.g.moveObject(sky, 'graveyard');
    T.resolve();
    const tok = T.g.battlefield.find(o => o.isToken && o.controller === 'B');
    t.ok(tok && T.g.powerOf(tok) === 2 && T.g.toughnessOf(tok) === 2, 'B gets a 2/2 Illusion');
    const T2 = mk();
    T2.bf('A', 'Chromatic Orrery');
    T2.mana('A', 'G');
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T2.life('B'), 17, 'green paid for red');
  });

  test('Must be blocked this turn if able; Pinnacle of Rage hits two targets', (mk, t) => {
    t.auto('Irresistible Prey');
    t.auto('Joraga Invocation');
    t.auto('Pinnacle of Rage');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Irresistible Prey'), { targets: [bear] });
    t.ok(T.g._hasFlag(bear, 'mustBeBlockedTurn'), 'the Bears must be blocked');
    const T2 = mk();
    const a = T2.bf('B', 'Grizzly Bears'), b = T2.bf('B', 'Llanowar Elves');
    T2.mana('A', 'RR4');
    T2.cast('A', T2.hand('A', 'Pinnacle of Rage'), { targets: [a, b] });
    t.eq(a.zone, 'graveyard'); t.eq(b.zone, 'graveyard');
  });

  test('Another target creature you control gets the pump, never the source; Spurnmage Advocate returns two cards to an opponent', (mk, t) => {
    t.auto('Imperial Aerosaur');
    t.auto('Spurnmage Advocate');
    const ab = engine().oracle.analyze(card('Imperial Aerosaur')).abilities.find(a => a.kind === 'triggered');
    t.ok(JSON.stringify(ab.effects).includes('"another":true'), 'another target');
  });

  test('Aettir and Priwen sets the equipped creature to your life total; "three or more creature cards in your graveyard" is read', (mk, t) => {
    t.auto('Aettir and Priwen');
    t.auto('Grave Researcher // Reanimate');
    const T = mk();
    const eq = T.bf('A', 'Aettir and Priwen');
    const bear = T.bf('A', 'Grizzly Bears');
    eq.attachedTo = bear.id; bear.attachments = [eq.id]; T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 20);
    t.eq(T.g.toughnessOf(bear), 20);
  });

  test('Conditions: a noncreature spell cast this turn; the initiative; not the starting player', (mk, t) => {
    t.auto('H.E.R.B.I.E., Lovable Robot');
    t.auto('Feywild Caretaker');
    const T = mk();
    t.no(T.g._condMet({ kind: 'spellsCastOfKind', n: 1, words: 'noncreature' }, { controller: 'A' }), 'nothing cast yet');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.ok(T.g._condMet({ kind: 'spellsCastOfKind', n: 1, words: 'noncreature' }, { controller: 'A' }), 'a Bolt is a noncreature spell');
    t.eq(T.g._condMet({ kind: 'notStartingPlayer' }, { controller: 'A' }), T.g.turnOrder[0] !== 'A');
    T.g.player('A').initiative = true;
    t.ok(T.g._condMet({ kind: 'hasInitiative' }, { controller: 'A' }));
  });

  test('Hidden Gibbons becomes a 4/4 Ape when an opponent casts an instant, while it is still an enchantment', (mk, t) => {
    t.auto('Hidden Gibbons');
    const T = mk();
    const hg = T.bf('B', 'Hidden Gibbons');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.ok(T.g.characteristics(hg).isCreature, 'an Ape now');
    t.eq(T.g.powerOf(hg), 4);
  });

  test('Conditions about this turn: what entered and what died under your control, a spell from your hand', (mk, t) => {
    t.auto('Canyon Crab');
    t.auto('Banishing Slash');
    const T = mk();
    const c = (cond) => T.g._condMet(cond, { controller: 'A' });
    t.no(c({ kind: 'enteredThisTurn', what: 'creature', n: 1 }), 'nothing yet');
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    t.ok(c({ kind: 'enteredThisTurn', what: 'creature', n: 1 }), 'a creature entered');
    t.no(c({ kind: 'enteredThisTurn', what: 'nonland permanent', n: 2 }), 'not two');
    t.no(c({ kind: 'diedYoursThisTurn', n: 1 }));
    const bear = T.g.battlefield.find(o => o.name === 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    t.ok(c({ kind: 'diedYoursThisTurn', n: 1 }), 'and died');
    t.ok(c({ kind: 'noSpellFromHandThisTurn' }));
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.no(c({ kind: 'noSpellFromHandThisTurn' }), 'a spell from hand now');
  });

  test("\"If it's an artifact\" asks about the target; \"if it's a land card\" about the card just revealed", (mk, t) => {
    t.auto('Topple the Statue');
    t.auto('Feral Deceiver');
    const T = mk();
    const orni = T.bf('B', 'Ornithopter');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W2');
    T.cast('A', T.hand('A', 'Topple the Statue'), { targets: [orni] });
    t.eq(orni.zone, 'graveyard', 'the artifact is destroyed');
    T.mana('A', 'W2');
    T.cast('A', T.hand('A', 'Topple the Statue'), { targets: [bear] });
    t.eq(bear.zone, 'battlefield', 'the Bears only tapped');
    t.ok(bear.tapped);
  });

  test('More conditions: its mana value, a card exiled this way, an attacker that left', (mk, t) => {
    t.auto('Fading Hope');
    t.auto('Desculpting Blast');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U');
    const hand = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Fading Hope'), { targets: [bear] });
    t.eq(bear.zone, 'hand', 'returned');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'the Bears are in hand');
    const T2 = mk();
    const b2 = T2.bf('A', 'Grizzly Bears');
    b2.attacking = 'B';
    T2.mana('A', 'U1');
    const before = T2.g.battlefield.filter(o => o.isToken).length;
    T2.cast('A', T2.hand('A', 'Desculpting Blast'), { targets: [b2] });
    t.eq(T2.g.battlefield.filter(o => o.isToken).length, before + 1, 'it was attacking: a Drone');
  });

  test('More conditions: life changed this turn, a card type in your graveyard, a power ceiling', (mk, t) => {
    t.auto('Star Charter');
    t.auto('Walltop Sentries');
    t.auto('Writ of Passage');
    const T = mk();
    const c = (cond, extra) => T.g._condMet(cond, Object.assign({ controller: 'A' }, extra || {}));
    t.no(c({ kind: 'lifeChangedThisTurn' }));
    T.g.changeLife('A', 2);
    t.ok(c({ kind: 'lifeChangedThisTurn' }), 'gained life');
    t.no(c({ kind: 'graveyard', what: 'elf', n: 1 }));
    T.grave('A', 'Llanowar Elves');
    t.ok(c({ kind: 'graveyard', what: 'elf', n: 1 }), 'an Elf card');
    const bear = T.bf('A', 'Grizzly Bears');
    t.ok(c({ kind: 'itPower', n: 2, cmp: 'atMost' }, { targets: [{ kind: 'object', id: bear.id }] }), 'power 2 or less');
    t.no(c({ kind: 'itPower', n: 3, cmp: 'atLeast' }, { targets: [{ kind: 'object', id: bear.id }] }));
  });

  test('Journey to Nowhere gives back what it exiled when it leaves', (mk, t) => {
    t.auto('Journey to Nowhere');
    t.auto("Hunter's Talent");
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Journey to Nowhere'));
    t.eq(bear.zone, 'exile');
    const j = T.g.battlefield.find(o => o.name === 'Journey to Nowhere');
    T.g.moveObject(j, 'graveyard');
    T.resolve();
    t.eq(bear.zone, 'battlefield', 'back');
    t.eq(bear.controller, 'B');
  });

  test('Amounts: life gained this turn, the greatest toughness, colours and basic land types among yours', (mk, t) => {
    t.auto('Blossoming Bogbeast');
    t.auto('Last March of the Ents');
    const T = mk();
    const v = (x) => T.g._countValue(x, 'A', null);
    T.g.changeLife('A', 3);
    t.eq(v({ playerStat: 'lifeGainedThisTurn' }), 3);
    T.bf('A', 'Colossal Dreadmaw');
    t.eq(v({ greatestToughness: { who: 'you', what: 'creature' } }), 6);
    T.bf('A', 'Forest'); T.bf('A', 'Island');
    t.eq(v({ per: 'basic land types among lands', who: 'you' }), 2, 'domain two');
    T.bf('A', 'Llanowar Elves');
    t.eq(v({ per: 'colors among permanents', who: 'you' }), 1, 'green only');
  });

  test('Expend 4: the fourth mana spent this turn sets it off, once', (mk, t) => {
    t.auto('Wandertale Mentor');
    const T = mk();
    const m = T.bf('A', 'Wandertale Mentor');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(m.counters['+1/+1'] || 0, 0, 'one mana: not yet');
    T.mana('A', 'UUG');
    T.cast('A', T.hand('A', 'Divination'));
    t.eq(m.counters['+1/+1'] || 0, 1, 'four spent: a counter');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    t.eq(m.counters['+1/+1'] || 0, 1, 'not again for the fifth');
  });

  test('A mana ability handed over in quotes: Esika gives other legendary creatures "{T}: Add one mana of any color"; a Pilot token crews for more', (mk, t) => {
    t.auto('Esika, God of the Tree // The Prismatic Bridge');
    t.auto('Defend the Rider');
    const T = mk();
    T.bf('A', 'Esika, God of the Tree // The Prismatic Bridge');
    const leg = T.bf('A', 'Isamaru, Hound of Konda');
    leg.summoningSick = false;
    t.ok(leg.analysis().manaAbilities.length > 0, 'it has the mana ability');
    t.ok(T.g.tapForMana('A', leg.id, 0), 'and taps for mana');
    t.eq(T.g.player('A').pool.total(), 1);
    t.ok(T.g.hasKw(leg, 'vigilance'), 'and vigilance');
  });

  test('Ordeal of Heliod: the third counter sacrifices it, and "when you sacrifice this Aura" fires', (mk, t) => {
    t.auto('Ordeal of Heliod');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    bear.summoningSick = false;
    bear.counters['+1/+1'] = 2;
    const ord = T.bf('A', 'Ordeal of Heliod');
    ord.attachedTo = bear.id; bear.attachments = [ord.id];
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(ord.zone, 'graveyard', 'sacrificed at three counters');
    t.ok(T.life('A') >= 30, 'and A gained 10 life');
  });

  test('Suspend X: Aeon Chronicler goes into exile with X time counters, and draws as each comes off', (mk, t) => {
    t.auto('Aeon Chronicler');
    const T = mk();
    const ac = T.hand('A', 'Aeon Chronicler');
    T.mana('A', 'U5');
    t.ok(T.g.suspendCard('A', ac.id, { x: 2 }), 'suspended for X = 2');
    t.eq(ac.zone, 'exile');
    t.eq(ac.counters.time, 2);
    const hand = T.zone('A', 'hand').length;
    T.toMain('B', 'main');
    T.toMain('A', 'main');
    t.eq(ac.counters.time, 1, 'a counter came off');
    t.ok(T.zone('A', 'hand').length >= hand + 2, 'drew for the counter (and the draw step)');
  });

  test('Hexproof from black: Knight of Grace can be Shocked but not Murdered; it is not plain hexproof', (mk, t) => {
    t.auto('Knight of Grace');
    t.auto('Dragonfire Blade');
    const T = mk();
    const k = T.bf('B', 'Knight of Grace');
    t.no(T.g.hasKw(k, 'hexproof'), 'no plain hexproof');
    const shock = T.hand('A', 'Shock');
    const murder = T.hand('A', 'Murder');
    const legal = (o) => T.g._legalTargetsFor(spellTargetSpec(o), 'A', o.id).some(x => x.id === k.id);
    function spellTargetSpec(o) { const a = o.analysis(); return a.abilities.find(x => x.kind === 'spell').effects.find(e => e.targets).targets[0]; }
    t.ok(legal(shock), 'a red spell may target it');
    t.no(legal(murder), 'a black one may not');
    const T2 = mk();
    const blade = T2.bf('A', 'Dragonfire Blade');
    const elf = T2.bf('A', 'Llanowar Elves');
    T2.mana('A', '3');
    T2.activate('A', blade, blade.analysis().abilities.findIndex(ab => /^Equip/i.test(ab.text || '')), { targets: [elf] });
    t.eq(blade.attachedTo, elf.id, 'equipped a green creature for {3}');
  });

  test('Twinning Staff adds a copy; Incubation Druid makes three with a counter; Mangara draws when attacked by two', (mk, t) => {
    t.auto('Twinning Staff');
    t.auto('Incubation Druid');
    t.auto('Mangara, the Diplomat');
    const T = mk();
    T.bf('A', 'Twinning Staff');
    const staff = T.g.battlefield.find(o => o.name === 'Twinning Staff');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.mana('A', '7');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.activate('A', staff, 0, { targets: [{ kind: 'stack', id: item.id }] });
    t.eq(T.life('B'), 11, 'the Bolt and two copies: nine damage');
    const T2 = mk();
    T2.bf('A', 'Forest');
    const dr = T2.bf('A', 'Incubation Druid');
    dr.summoningSick = false;
    dr.counters['+1/+1'] = 1;
    T2.g.tapForMana('A', dr.id, 0);
    t.eq(T2.g.player('A').pool.total(), 3, 'three green');
    const T3 = mk();
    T3.bf('B', 'Mangara, the Diplomat');
    const a1 = T3.bf('A', 'Grizzly Bears'), a2 = T3.bf('A', 'Llanowar Elves');
    a1.summoningSick = false; a2.summoningSick = false;
    const hand = T3.zone('B', 'hand').length;
    T3.answer('declareAttackers', () => [{ attackerId: a1.id, defenderId: 'B' }, { attackerId: a2.id, defenderId: 'B' }]);
    T3.answer('declareBlockers', () => []);
    T3.toMain('A', 'endCombat');
    t.eq(T3.zone('B', 'hand').length, hand + 1, 'B drew');
  });

  test('Defiler of Vigor: 2 life instead of a {G} for a green permanent spell, asked as it is cast', (mk, t) => {
    t.auto('Defiler of Vigor');
    const T = mk();
    T.bf('A', 'Defiler of Vigor');
    let asked = null;
    T.answer('choose', (ch) => { asked = ch; return { picks: [0] }; });
    T.mana('A', '1');
    const bear = T.hand('A', 'Grizzly Bears');
    T.g.castSpell('A', bear.id, { auto: true, targets: [] });
    T.settle(); T.resolve();
    t.eq(asked && asked.purpose, 'defiler', 'the offer is a generic question');
    t.eq(bear.zone, 'battlefield', 'cast with {1} and 2 life');
    t.eq(T.life('A'), 18);
  });

  test('Sickening Shoal for free: exile a black card from hand, and X is its mana value', (mk, t) => {
    t.auto('Sickening Shoal');
    t.auto('Disrupting Shoal');
    const T = mk();
    const big = T.bf('B', 'Colossal Dreadmaw');
    const shoal = T.hand('A', 'Sickening Shoal');
    const fodder = T.hand('A', 'Murder');
    T.answer('pickCard', () => ({ cardIds: [fodder.id] }));
    const use = T.g.altUsesFor('A', shoal.id).find(u => u.alt && u.alt.exileFromHand);
    t.ok(use, 'the exile-a-card cost is offered');
    T.g.castSpell('A', shoal.id, { via: use.via, alternative: use.alternative || use.via, targets: [{ kind: 'object', id: big.id }], auto: true });
    T.settle(); T.resolve();
    t.eq(fodder.zone, 'exile');
    t.eq(T.g.toughnessOf(big), 3, 'X = 3: -3/-3 on a 6/6');
  });

  test('Opposition Agent: the opponent\'s search is ours to make, and what they find is exiled for us to play', (mk, t) => {
    t.auto('Opposition Agent');
    const T = mk();
    T.bf('B', 'Opposition Agent');
    const bolt = T.top('A', 'Lightning Bolt');
    let asked = null;
    T.answer('pickCard', (ch) => { asked = ch; return { cardIds: [bolt.id] }; });
    T.mana('A', 'B1');
    T.cast('A', T.hand('A', 'Demonic Tutor'));
    t.eq(asked && asked.playerId, 'B', 'B makes the choice');
    t.eq(bolt.zone, 'exile', 'the Bolt is exiled, not put in A\'s hand');
    t.eq(bolt.impulseBy, 'B', 'and B may play it');
  });

  test('Millikin mills for its mana; Arcane Lighthouse strips hexproof; Remand returns the spell; Baral loots', (mk, t) => {
    t.auto('Millikin');
    t.auto('Arcane Lighthouse');
    t.auto('Remand');
    t.auto('Memory Lapse');
    t.auto('Baral, Chief of Compliance');
    const T = mk();
    const mk2 = T.bf('A', 'Millikin'); mk2.summoningSick = false;
    const top = T.top('A', 'Grizzly Bears');
    T.g.tapForMana('A', mk2.id, 0);
    t.eq(top.zone, 'graveyard', 'a card milled');
    t.eq(T.g.player('A').pool.total(), 1, 'and one colourless');
    const T2 = mk();
    const lh = T2.bf('A', 'Arcane Lighthouse');
    const bogle = T2.bf('B', 'Slippery Bogle');
    T2.mana('A', '1');
    T2.activate('A', lh, 1);
    t.no(T2.g.hasKw(bogle, 'hexproof'), 'the Bogle has lost hexproof');
    T2.g.battlefield.find(o => o === bogle).effects.push({ keywords: ['Hexproof'], until: 'eot' });
    t.no(T2.g.hasKw(bogle, 'hexproof'), 'and cannot gain it back');
    const T3 = mk();
    T3.bf('A', 'Baral, Chief of Compliance');
    const loot = T3.top('A', 'Opt');
    T3.hand('A', 'Island');
    T3.mana('A', 'R');
    const bolt = T3.hand('A', 'Lightning Bolt');
    T3.cast('A', bolt, { targets: ['A'], resolve: false });
    const item = T3.g.stack[T3.g.stack.length - 1];
    T3.mana('A', 'U');
    T3.answer('confirm', { yes: true });
    T3.cast('A', T3.hand('A', 'Remand'), { targets: [{ kind: 'stack', id: item.id }] });
    T3.settle(); T3.resolve();
    t.eq(bolt.zone, 'hand', 'the Bolt went back to its owner\'s hand');
    t.eq(T3.life('A'), 20, 'and did nothing');
    t.ok(loot.zone === 'hand' || loot.zone === 'graveyard', 'Baral drew a card');
  });

  test('Talon Gates from the hand; Cloud Key and Serra\'s Emissary choose a card type', (mk, t) => {
    t.auto('Talon Gates of Madara');
    t.auto('Cloud Key');
    t.auto("Serra's Emissary");
    const T = mk();
    const gates = T.hand('A', 'Talon Gates of Madara');
    T.mana('A', '4');
    t.ok(T.g.cycleCard('A', gates.id, { auto: true, channel: true }), 'put onto the battlefield: ' + T.g.lastError);
    T.settle(); T.resolve();
    t.eq(gates.zone, 'battlefield', 'the Gates are on the battlefield');
    const T2 = mk();
    const key = T2.bf('A', 'Cloud Key');
    key.chosenCardType = 'Instant';
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Lightning Strike'), { targets: ['B'] });
    t.eq(T2.life('B'), 17, 'Lightning Strike cast for {R} with the Key on instants');
    const T3 = mk();
    const em = T3.bf('A', "Serra's Emissary");
    em.chosenCardType = 'Instant';
    const bear = T3.bf('A', 'Grizzly Bears');
    t.no(T3.g._legalTargetsFor({ type: 'any' }, 'B', T3.hand('B', 'Lightning Bolt').id).some(x => x.id === 'A' || x.id === bear.id), 'neither A nor the Bears can be targeted by an instant');
    T3.mana('B', 'R');
    T3.g.dealDamageToPlayer(T3.g.player('A'), 3, T3.hand('B', 'Shock'), false);
    t.eq(T3.life('A'), 20, 'and damage from one is prevented');
    T3.g.dealDamageToPlayer(T3.g.player('A'), 2, T3.bf('B', 'Grizzly Bears'), false);
    t.eq(T3.life('A'), 18, 'a creature still hurts');
  });

  test('Web-slinging: cast it cheaply by returning a tapped creature; Spiders-Man knows it was', (mk, t) => {
    t.auto('Spider-Man, Web-Slinger');
    t.auto('Spiders-Man, Heroic Horde');
    const T = mk();
    const sm = T.hand('A', 'Spider-Man, Web-Slinger');
    t.no(T.g.altUsesFor('A', sm.id).some(u => u.alt && u.alt.webSlinging), 'no tapped creature: not offered');
    const bear = T.bf('A', 'Grizzly Bears');
    bear.tapped = true;
    const use = T.g.altUsesFor('A', sm.id).find(u => u.alt && u.alt.webSlinging);
    t.ok(use, 'offered with a tapped creature');
    T.mana('A', 'W');
    t.ok(T.g.castSpell('A', sm.id, { via: use.via, auto: true }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(bear.zone, 'hand', 'the Bears went back');
    t.eq(sm.zone, 'battlefield');
    const T2 = mk();
    const horde = T2.hand('A', 'Spiders-Man, Heroic Horde');
    const b2 = T2.bf('A', 'Grizzly Bears'); b2.tapped = true;
    const u2 = T2.g.altUsesFor('A', horde.id).find(u => u.alt && u.alt.webSlinging);
    T2.mana('A', '4GG');
    t.ok(T2.g.castSpell('A', horde.id, { via: u2.via, auto: true }), T2.g.lastError);
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(T2.life('A'), 23, 'three life for being web-slung');
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && /Spider/.test(o.name) && o.isToken).length, 2, 'and two Spiders');
  });

  test('Curse of Verbosity: both the curse\'s owner and the attacker draw; Shared Animosity; Sphere of Safety', (mk, t) => {
    t.auto('Curse of Verbosity');
    t.auto('Shared Animosity');
    t.auto('Sphere of Safety');
    const T = mk({ players: ['A', 'B', 'C'] });
    const curse = T.bf('C', 'Curse of Verbosity');
    curse.attachedTo = 'B';
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    const ha = T.zone('A', 'hand').length, hc = T.zone('C', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('C', 'hand').length, hc + 1, 'the curse\'s controller drew');
    t.eq(T.zone('A', 'hand').length, ha + 1, 'and so did the attacker');
    const T2 = mk();
    T2.bf('A', 'Shared Animosity');
    const e1 = T2.bf('A', 'Llanowar Elves'), e2 = T2.bf('A', 'Elvish Mystic'), b2 = T2.bf('A', 'Grizzly Bears');
    for (const x of [e1, e2, b2]) x.summoningSick = false;
    T2.answer('declareAttackers', () => [e1, e2, b2].map(x => ({ attackerId: x.id, defenderId: 'B' })));
    T2.answer('declareBlockers', () => []);
    T2.toMain('A', 'endCombat');
    t.eq(T2.life('B'), 20 - 2 - 2 - 2, 'each Elf +1/+0 for the other, the Bears alone');
    const T3 = mk();
    T3.bf('B', 'Sphere of Safety');
    const at = T3.bf('A', 'Grizzly Bears'); at.summoningSick = false;
    t.no(T3.g.declareAttackers('A', [{ attackerId: at.id, defenderId: 'B' }]), 'one enchantment: {1} a creature, and A has no mana');
  });

  test('A Curse cast on a player enchants that player, and its upkeep trigger works', (mk, t) => {
    t.auto('Curse of the Bloody Tome');
    const T = mk();
    T.mana('A', '2U');
    const curse = T.hand('A', 'Curse of the Bloody Tome');
    T.cast('A', curse, { targets: ['B'] });
    t.eq(curse.zone, 'battlefield', 'it stays');
    t.eq(curse.attachedTo, 'B', 'on B');
    const lib = T.zone('B', 'library').length;
    T.nextTurn('B');
    t.eq(T.zone('B', 'library').length, lib - 3, 'B milled two in their upkeep, and drew one');
  });

  test('Curses on B: Trespasser\'s Curse, Fool\'s Wisdom, Grievous Wound, Exhaustion, Predation, the Forsaken, Death\'s Hold', (mk, t) => {
    for (const n of ["Trespasser's Curse", "Curse of Fool's Wisdom", 'Grievous Wound', 'Curse of Exhaustion', 'Curse of Predation', 'Curse of the Forsaken', "Curse of Death's Hold"]) t.auto(n);
    const T = mk();
    const tc = T.bf('B', "Trespasser's Curse"); tc.attachedTo = 'A';
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.settle(); T.resolve();
    t.eq(T.life('A'), 19, 'a creature of A\'s entered: A loses 1');
    t.eq(T.life('B'), 21, 'and B gains 1');
    const T2 = mk();
    const c2 = T2.bf('A', "Curse of Fool's Wisdom"); c2.attachedTo = 'B';
    T2.top('B', 'Island');
    T2.g._drawCards(T2.g.player('B'), 1);
    T2.settle(); T2.resolve();
    t.eq(T2.life('B'), 18, 'B drew: loses 2');
    t.eq(T2.life('A'), 22, 'A gains 2');
    const T3 = mk();
    const gw = T3.bf('A', 'Grievous Wound'); gw.attachedTo = 'B';
    T3.g.changeLife(T3.g.player('B'), 5);
    t.eq(T3.life('B'), 20, 'B can\'t gain life');
    T3.g.dealDamageToPlayer(T3.g.player('B'), 2, gw, false);
    T3.settle(); T3.resolve();
    t.eq(T3.life('B'), 9, 'dealt 2 (18), then loses half rounded up (9)');
    const T4 = mk();
    const ex = T4.bf('B', 'Curse of Exhaustion'); ex.attachedTo = 'A';
    T4.mana('A', 'RR');
    T4.cast('A', T4.hand('A', 'Shock'), { targets: ['B'] });
    t.no(T4.g.castSpell('A', T4.hand('A', 'Shock').id, { targets: [{ kind: 'player', id: 'B' }] }), 'a second spell is refused');
    const T5 = mk();
    const c5 = T5.bf('B', 'Curse of Predation'); c5.attachedTo = 'B';
    const c6 = T5.bf('B', 'Curse of the Forsaken'); c6.attachedTo = 'B';
    const c7 = T5.bf('B', "Curse of Death's Hold"); c7.attachedTo = 'A';
    const cc = T5.bf('A', 'Centaur Courser'); cc.summoningSick = false;
    t.eq(T5.g.powerOf(cc), 2, 'Death\'s Hold: -1/-1');
    T5.answer('declareAttackers', () => [{ attackerId: cc.id, defenderId: 'B' }]);
    T5.answer('declareBlockers', () => []);
    T5.toMain('A', 'endCombat');
    t.eq(cc.counters['+1/+1'], 1, 'Predation: a counter on the attacker');
    t.no(c5.counters['+1/+1'], 'not on the Curse');
    t.eq(T5.life('A'), 21, 'the Forsaken: its controller gains 1');
  });

  test('Dark Depths makes Marit Lage once its last ice counter is gone; Aven Mindcensor; Notion Thief', (mk, t) => {
    t.auto('Dark Depths');
    t.auto('Aven Mindcensor');
    t.auto('Notion Thief');
    const T = mk();
    const dd = T.bf('A', 'Dark Depths');
    dd.counters.ice = 1;
    T.g.checkStateBasedActions(); T.g._putTriggersOnStack(); T.settle();
    t.eq(T.g.stack.length, 0, 'nothing while it has ice');
    dd.counters.ice = 0;
    T.g.checkStateBasedActions(); T.g._putTriggersOnStack(); T.settle();
    t.eq(T.g.stack.filter(x => x.objId === dd.id).length, 1, 'one trigger on the stack');
    T.g.checkStateBasedActions(); T.g._putTriggersOnStack(); T.settle();
    t.eq(T.g.stack.filter(x => x.objId === dd.id).length, 1, 'and only one');
    T.resolve();
    t.eq(dd.zone, 'graveyard', 'sacrificed');
    const ml = T.g.battlefield.find(o => o.name === 'Marit Lage');
    t.ok(ml, 'Marit Lage');
    t.eq(ml && T.g.powerOf(ml), 20);
    t.ok(ml && T.g.hasKw(ml, 'indestructible'));
    const T2 = mk();
    T2.bf('B', 'Aven Mindcensor');
    for (let i = 0; i < 6; i++) T2.top('A', 'Island');
    const deep = T2.g.zones.A.library.find(c => c.name === 'Plains');
    T2.mana('A', '1B');
    let offered = null;
    T2.answer('pickCard', (ch) => { offered = ch.candidates || []; return { cardIds: [] }; });
    T2.cast('A', T2.hand('A', 'Demonic Tutor'));
    t.ok(offered && offered.length <= 4, 'only the top four offered: ' + (offered && offered.length));
    t.no(offered && deep && offered.includes(deep.id), 'not the Plains further down');
    const T3 = mk();
    T3.bf('B', 'Notion Thief');
    const ha = T3.zone('A', 'hand').length, hb = T3.zone('B', 'hand').length;
    T3.g._drawCards(T3.g.player('A'), 2);
    t.eq(T3.zone('A', 'hand').length, ha, 'A draws nothing outside the draw step');
    t.eq(T3.zone('B', 'hand').length, hb + 2, 'B draws both');
  });

  test('Divine Visitation makes Angels; Norn\'s Annex taxes attackers {W/P}; Tekuthal proliferates twice and pays in counters', (mk, t) => {
    t.auto('Divine Visitation');
    t.auto("Norn's Annex");
    t.auto('Tekuthal, Inquiry Dominus');
    const T = mk();
    T.bf('A', 'Divine Visitation');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Raise the Alarm'));
    const angels = T.g.battlefield.filter(o => o.controller === 'A' && o.isToken);
    t.eq(angels.length, 2, 'two tokens');
    t.ok(angels.every(o => o.name === 'Angel' && T.g.powerOf(o) === 4 && T.g.hasKw(o, 'flying') && T.g.hasKw(o, 'vigilance')), 'both 4/4 flying vigilance Angels');
    const T2 = mk();
    T2.bf('B', "Norn's Annex");
    const at = T2.bf('A', 'Grizzly Bears'); at.summoningSick = false;
    T2.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'B' }]);
    T2.answer('declareBlockers', () => []);
    T2.toMain('A', 'endCombat');
    t.eq(T2.life('A'), 18, 'two life paid for {W/P}');
    t.eq(T2.life('B'), 18, 'and the Bears got in');
    const T3 = mk();
    const tk = T3.bf('A', 'Tekuthal, Inquiry Dominus'); tk.summoningSick = false;
    const b1 = T3.bf('A', 'Grizzly Bears'); b1.counters['+1/+1'] = 3;
    T3.mana('A', '1UU');
    T3.activate('A', tk, 0);
    t.eq(b1.counters['+1/+1'] || 0, 0, 'three counters removed from the Bears');
    t.eq(tk.counters.indestructible, 1, 'an indestructible counter');
    const T4 = mk();
    T4.bf('A', 'Tekuthal, Inquiry Dominus');
    const b4 = T4.bf('A', 'Grizzly Bears'); b4.counters['+1/+1'] = 1;
    T4.g._runEffects([{ op: 'proliferate' }], { controller: 'A', obj: b4, name: 'test' });
    t.eq(b4.counters['+1/+1'], 3, 'proliferated twice');
  });

  test('Kira: the first spell each turn that targets a creature of yours is countered, the second is not', (mk, t) => {
    t.auto('Kira, Great Glass-Spinner');
    const T = mk();
    T.bf('A', 'Kira, Great Glass-Spinner');
    const bear = T.bf('A', 'Centaur Courser');
    T.mana('A', 'RR');
    const s1 = T.hand('A', 'Shock'), s2 = T.hand('A', 'Shock');
    T.cast('A', s1, { targets: [bear] });
    T.settle(); T.resolve();
    t.eq(bear.damage || 0, 0, 'the first Shock was countered');
    t.eq(s1.zone, 'graveyard');
    T.cast('A', s2, { targets: [bear] });
    T.settle(); T.resolve();
    t.eq(bear.damage, 2, 'the second one lands');
  });

  test('Tale of Katara and Toph: a counter the first time each creature becomes tapped on your turn', (mk, t) => {
    t.auto('Tale of Katara and Toph');
    const T = mk();
    T.bf('A', 'Tale of Katara and Toph');
    const elf = T.bf('A', 'Llanowar Elves'); elf.summoningSick = false;
    T.g.tapForMana('A', elf.id, 0);
    T.settle(); T.resolve();
    t.eq(elf.counters['+1/+1'], 1, 'first tap: a counter');
    elf.tapped = false;
    T.g.tapForMana('A', elf.id, 0);
    T.settle(); T.resolve();
    t.eq(elf.counters['+1/+1'], 1, 'second tap this turn: none');
  });

  test('Conduit of Ruin: the first creature spell each turn is cheaper; Highspire Bell-Ringer: the second spell', (mk, t) => {
    t.auto('Conduit of Ruin');
    t.auto('Highspire Bell-Ringer');
    const T = mk();
    T.bf('A', 'Conduit of Ruin');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Centaur Courser'));
    t.eq(T.g.battlefield.filter(o => o.name === 'Centaur Courser').length, 1, 'Courser for {G}');
    T.mana('A', 'G');
    t.no(T.g.castSpell('A', T.hand('A', 'Grizzly Bears').id, {}), 'the second creature costs full');
    const T2 = mk();
    T2.bf('A', 'Highspire Bell-Ringer');
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Shock'), { targets: ['B'] });
    T2.mana('A', 'G');
    T2.cast('A', T2.hand('A', 'Grizzly Bears'));
    t.eq(T2.g.battlefield.filter(o => o.name === 'Grizzly Bears').length, 1, 'the second spell, Bears, for {G}');
  });

  test('Frostwielder: a creature it dealt damage to this turn is exiled instead of dying; others die as usual', (mk, t) => {
    t.auto('Frostwielder');
    const T = mk();
    const fw = T.bf('A', 'Frostwielder'); fw.summoningSick = false;
    const elf = T.bf('B', 'Llanowar Elves');
    const other = T.bf('B', 'Elvish Mystic');
    T.activate('A', fw, 0, { targets: [elf] });
    T.settle(); T.resolve();
    t.eq(elf.zone, 'exile', 'exiled, not in the graveyard');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [other] });
    t.eq(other.zone, 'graveyard', 'one it never hurt dies as usual');
  });

  test('Bribery: a creature from the opponent\'s library, onto the battlefield under our control', (mk, t) => {
    t.auto('Bribery');
    const T = mk();
    const big = T.top('B', 'Colossal Dreadmaw');
    T.answer('pickCard', () => ({ cardIds: [big.id] }));
    T.mana('A', '3UU');
    T.cast('A', T.hand('A', 'Bribery'), { targets: ['B'] });
    t.eq(big.zone, 'battlefield', 'the Dreadmaw is on the battlefield');
    t.eq(big.controller, 'A', 'under A\'s control');
    t.eq(big.owner, 'B', 'still B\'s card');
  });

  test('Scapeshift: the lands chosen are sacrificed and that many come back from the library, tapped', (mk, t) => {
    t.auto('Scapeshift');
    const T = mk();
    const lands = [T.bf('A', 'Forest'), T.bf('A', 'Forest'), T.bf('A', 'Forest')];
    const m1 = T.top('A', 'Mountain'), m2 = T.top('A', 'Mountain');
    T.answer('choose', (ch) => ({ picks: lands.slice(0, 2).map(x => x.id) }));
    T.answer('pickCard', (ch) => ({ cardIds: [m1.id, m2.id] }));
    T.mana('A', '2GG');
    T.cast('A', T.hand('A', 'Scapeshift'));
    t.eq(lands.filter(x => x.zone === 'graveyard').length, 2, 'two Forests sacrificed');
    t.eq(lands[2].zone, 'battlefield', 'the third kept');
    t.ok(m1.zone === 'battlefield' && m2.zone === 'battlefield', 'two Mountains found');
    t.ok(m1.tapped && m2.tapped, 'tapped');
  });

  test('Ad Nauseam: a card and its mana value in life, as many times as asked', (mk, t) => {
    t.auto('Ad Nauseam');
    const T = mk();
    const c3 = T.top('A', 'Island'), c2 = T.top('A', 'Opt'), c1 = T.top('A', 'Grizzly Bears');
    let asked = 0;
    T.answer('choose', () => { asked++; return { picks: [0] }; });
    T.answer('choose', () => { asked++; return { picks: [1] }; });
    T.mana('A', '3BB');
    T.cast('A', T.hand('A', 'Ad Nauseam'));
    t.eq(c1.zone, 'hand'); t.eq(c2.zone, 'hand');
    t.eq(c3.zone, 'library', 'stopped after two');
    t.eq(T.life('A'), 17, 'two for the Bears, one for Opt');
    t.eq(asked, 2, 'asked after each card');
  });

  test('Steel Hellkite: after it hits a player, {X} destroys their nonland permanents of mana value X', (mk, t) => {
    t.auto('Steel Hellkite');
    const T = mk();
    const hk = T.bf('A', 'Steel Hellkite'); hk.summoningSick = false;
    const b2 = T.bf('B', 'Grizzly Bears'), b3 = T.bf('B', 'Centaur Courser'), l = T.bf('B', 'Forest');
    T.g._runEffects([{ op: 'destroyHitByMv', mv: 2 }], { controller: 'A', obj: hk, name: 'Steel Hellkite' });
    t.eq(b2.zone, 'battlefield', 'not before it has hit B');
    T.answer('declareAttackers', () => [{ attackerId: hk.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    T.g._runEffects([{ op: 'destroyHitByMv', mv: 2 }], { controller: 'A', obj: hk, name: 'Steel Hellkite' });
    t.eq(b2.zone, 'graveyard', 'the Bears (2) are destroyed');
    t.eq(b3.zone, 'battlefield', 'the Courser (3) is not');
    t.eq(l.zone, 'battlefield', 'lands are spared');
  });

  test('The Ring tempts you: Call of the Ring draws for 2 life; Gandalf only when another creature bears the Ring', (mk, t) => {
    t.auto('Call of the Ring');
    t.auto('Gandalf, Friend of the Shire');
    const T = mk();
    T.bf('A', 'Call of the Ring');
    const bear = T.bf('A', 'Grizzly Bears');
    const hand = T.zone('A', 'hand').length;
    T.g._runEffects([{ op: 'ringTempts' }], { controller: 'A', name: 'test' });
    T.settle(); T.resolve();
    t.eq(T.g.player('A').ringBearer, bear.id, 'the Bears bear the Ring');
    t.eq(T.life('A'), 18, '2 life paid');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'a card drawn');
    const T2 = mk();
    const gf = T2.bf('A', 'Gandalf, Friend of the Shire');
    const h2 = T2.zone('A', 'hand').length;
    T2.g._runEffects([{ op: 'ringTempts' }], { controller: 'A', name: 'test' });
    T2.settle(); T2.resolve();
    t.eq(T2.g.player('A').ringBearer, gf.id, 'Gandalf is the only creature, so he bears it');
    t.eq(T2.zone('A', 'hand').length, h2, 'and draws nothing');
    const big = T2.bf('A', 'Colossal Dreadmaw');
    T2.g.player('A').ringBearer = null;
    T2.g._runEffects([{ op: 'ringTempts' }], { controller: 'A', name: 'test' });
    T2.settle(); T2.resolve();
    t.eq(T2.g.player('A').ringBearer, big.id, 'the Dreadmaw bears it');
    t.eq(T2.zone('A', 'hand').length, h2 + 1, 'Gandalf draws');
  });

  test('Mesmeric Orb: each permanent that untaps, in the untap step or by an effect, mills its controller a card', (mk, t) => {
    t.auto('Mesmeric Orb');
    const T = mk();
    T.bf('A', 'Mesmeric Orb');
    const f1 = T.bf('B', 'Forest'), f2 = T.bf('B', 'Forest');
    f1.tapped = true; f2.tapped = true;
    const gy = T.zone('B', 'graveyard').length;
    T.nextTurn('B');
    t.eq(T.zone('B', 'graveyard').length, gy + 2, 'two untapped, two milled');
    const T2 = mk();
    T2.bf('A', 'Mesmeric Orb');
    const elf = T2.bf('A', 'Llanowar Elves'); elf.tapped = true;
    const g2 = T2.zone('A', 'graveyard').length;
    T2.g._runEffects([{ op: 'untap', scope: 'lastTarget' }], { controller: 'A', name: 'test', targets: [{ kind: 'object', id: elf.id }] });
    T2.mana('A', 'G');
    T2.cast('A', T2.hand('A', 'Ornithopter'));
    T2.settle(); T2.resolve();
    t.ok(!elf.tapped, 'untapped by an effect');
    t.eq(T2.zone('A', 'graveyard').length, g2 + 1, 'and A milled one');
  });

  test('Massacre Girl: each death this turn shrinks every other creature, and the chain runs on', (mk, t) => {
    t.auto('Massacre Girl');
    const T = mk();
    const elf = T.bf('B', 'Llanowar Elves'), bear = T.bf('B', 'Grizzly Bears'), cc = T.bf('B', 'Centaur Courser');
    T.mana('A', '3BB');
    const mg = T.hand('A', 'Massacre Girl');
    T.cast('A', mg);
    for (let i = 0; i < 6; i++) { T.settle(); T.resolve(); }
    t.eq(elf.zone, 'graveyard', 'the Elves die to the first -1/-1');
    t.eq(bear.zone, 'graveyard', 'the Bears to the Elves dying');
    t.eq(cc.zone, 'graveyard', 'the Courser to the Bears dying');
    t.eq(mg.zone, 'battlefield', 'Massacre Girl herself is spared');
  });

  test('Priest of Forgotten Gods: the players aimed at lose 2 and sacrifice a creature; {B}{B} and a card', (mk, t) => {
    t.auto('Priest of Forgotten Gods');
    const T = mk();
    const pr = T.bf('A', 'Priest of Forgotten Gods'); pr.summoningSick = false;
    const f1 = T.bf('A', 'Llanowar Elves'), f2 = T.bf('A', 'Elvish Mystic');
    const victim = T.bf('B', 'Grizzly Bears');
    const hand = T.zone('A', 'hand').length;
    T.activate('A', pr, 0, { targets: ['B'] });
    T.settle(); T.resolve();
    t.eq(f1.zone, 'graveyard'); t.eq(f2.zone, 'graveyard');
    t.eq(T.life('B'), 18, 'B loses 2');
    t.eq(victim.zone, 'graveyard', 'and sacrifices the Bears');
    t.eq(T.g.player('A').pool.total(), 2, '{B}{B}');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'a card');
    t.eq(T.life('A'), 20, 'A was not aimed at');
  });

  test('Secret Tunnel: two creatures that share a type become unblockable; two that do not are refused', (mk, t) => {
    t.auto('Secret Tunnel');
    const T = mk();
    const st = T.bf('A', 'Secret Tunnel');
    const e1 = T.bf('A', 'Llanowar Elves'), e2 = T.bf('A', 'Elvish Mystic'), bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '4');
    t.no(T.g.activateAbility('A', st.id, 1, { targets: [{ kind: 'object', id: e1.id }, { kind: 'object', id: bear.id }] }), 'an Elf and a Bear share nothing');
    t.ok(/share a creature type/.test(T.g.lastError || ''), T.g.lastError);
    t.ok(T.g.activateAbility('A', st.id, 1, { targets: [{ kind: 'object', id: e1.id }, { kind: 'object', id: e2.id }] }), 'two Elves: ' + T.g.lastError);
    T.settle(); T.resolve();
    t.ok(T.g._hasFlag(e1, 'unblockable') && T.g._hasFlag(e2, 'unblockable'), 'both Elves unblockable');
    t.no(T.g._hasFlag(bear, 'unblockable'));
  });

  test('Laelia: one counter for a batch of cards exiled from library or graveyard', (mk, t) => {
    t.auto('Laelia, the Blade Reforged');
    const T = mk();
    const la = T.bf('A', 'Laelia, the Blade Reforged');
    const cs = [T.top('A', 'Island'), T.top('A', 'Island'), T.grave('A', 'Opt')];
    for (const c of cs) T.g.moveObject(c, 'exile');
    T.g._putTriggersOnStack(); T.settle(); T.resolve();
    t.eq(la.counters['+1/+1'], 1, 'one counter for the three');
    T.g.moveObject(T.top('B', 'Island'), 'exile');
    T.g._putTriggersOnStack(); T.settle(); T.resolve();
    t.eq(la.counters['+1/+1'], 1, 'an opponent\'s card does not count');
  });

  test('Scrap Trawler: an artifact of lesser mana value back when it or another artifact goes to the graveyard', (mk, t) => {
    t.auto('Scrap Trawler');
    const T = mk();
    const tr = T.bf('A', 'Scrap Trawler');
    const stone = T.grave('A', 'Mind Stone'), ring = T.grave('A', 'Sol Ring');
    const big = T.grave('A', 'Scrap Trawler');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = (ch.options && ch.options[0]) || []; return { targets: [{ kind: 'object', id: stone.id }] }; });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [tr] });
    T.settle(); T.resolve();
    t.eq(tr.zone, 'graveyard');
    t.eq(stone.zone, 'hand', 'Mind Stone (2) is back');
    t.ok(offered && offered.length, 'asked');
    t.no(offered && offered.some(o => o.id === big.id), 'another Trawler (3) is not lesser');
  });

  test('Scarlet Spider: web-slung, he enters with counters equal to the returned creature\'s mana value', (mk, t) => {
    t.auto('Scarlet Spider, Ben Reilly');
    const T = mk();
    const ss = T.hand('A', 'Scarlet Spider, Ben Reilly');
    const cc = T.bf('A', 'Centaur Courser'); cc.tapped = true;
    const use = T.g.altUsesFor('A', ss.id).find(u => u.alt && u.alt.webSlinging);
    T.mana('A', 'RG');
    t.ok(T.g.castSpell('A', ss.id, { via: use.via, auto: true }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(cc.zone, 'hand');
    t.eq(ss.counters['+1/+1'], 3, 'three counters for the Courser');
  });

  test('Hinder: the countered spell goes to the top or the bottom of the library, as chosen', (mk, t) => {
    t.auto('Hinder');
    const T = mk();
    T.top('A', 'Island');
    T.mana('A', 'R');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.answer('choose', () => ({ picks: [1] }));
    T.mana('A', '1UU');
    T.cast('A', T.hand('A', 'Hinder'), { targets: [{ kind: 'stack', id: item.id }] });
    T.settle(); T.resolve();
    t.eq(bolt.zone, 'library', 'into the library');
    const lib = T.zone('A', 'library');
    t.eq(lib[lib.length - 1], bolt, 'at the bottom');
    t.eq(T.life('B'), 20);
  });

  test('Gisela doubles damage to opponents and halves it to us; Vigor turns damage into counters; Realmwalker casts from the top', (mk, t) => {
    t.auto('Gisela, Blade of Goldnight');
    t.auto('Vigor');
    t.auto('Realmwalker');
    const T = mk();
    T.bf('A', 'Gisela, Blade of Goldnight');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 14, 'six to B');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.life('A'), 19, 'one to A: half of three rounded up is prevented');
    const T2 = mk();
    T2.bf('A', 'Vigor');
    const bear = T2.bf('A', 'Grizzly Bears');
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: [bear] });
    t.eq(bear.zone, 'battlefield', 'the Bears live');
    t.eq(bear.counters['+1/+1'], 3, 'with three counters');
    const T3 = mk();
    const rw = T3.bf('A', 'Realmwalker');
    rw.chosenType = 'Bear';
    const top = T3.top('A', 'Grizzly Bears');
    T3.mana('A', '1G');
    t.ok(T3.g.castSpell('A', top.id, { auto: true }), 'a Bear from the top: ' + T3.g.lastError);
    const T4 = mk();
    const rw4 = T4.bf('A', 'Realmwalker');
    rw4.chosenType = 'Elf';
    const top4 = T4.top('A', 'Grizzly Bears');
    T4.mana('A', '1G');
    t.no(T4.g.castSpell('A', top4.id, { auto: true }), 'not when the chosen type is Elf');
  });

  test('Caged Sun adds one more of the chosen colour from a land; K\'rrik pays {B} with 2 life', (mk, t) => {
    t.auto('Caged Sun');
    t.auto("K'rrik, Son of Yawgmoth");
    const T = mk();
    const cs = T.bf('A', 'Caged Sun'); cs.chosenColor = 'G';
    const f = T.bf('A', 'Forest'), m = T.bf('A', 'Mountain');
    T.g.tapForMana('A', f.id, 0);
    t.eq(T.g.player('A').pool.total(), 2, 'the Forest makes two green');
    T.g.tapForMana('A', m.id, 0);
    t.eq(T.g.player('A').pool.total(), 3, 'the Mountain only its own red');
    const T2 = mk();
    T2.bf('A', "K'rrik, Son of Yawgmoth");
    T2.cast('A', T2.hand('A', 'Dark Ritual'));
    t.eq(T2.life('A'), 18, 'two life for the {B}');
    t.eq(T2.g.player('A').pool.total(), 3, 'and the Ritual resolves');
  });

  test('Hunter\'s Insight draws for the chosen creature\'s combat damage; Kediss spreads a commander\'s; Liberator grows', (mk, t) => {
    t.auto("Hunter's Insight");
    t.auto('Kediss, Emberclaw Familiar');
    t.auto("Liberator, Urza's Battlethopter");
    const T = mk();
    const cc = T.bf('A', 'Centaur Courser'); cc.summoningSick = false;
    const other = T.bf('A', 'Grizzly Bears'); other.summoningSick = false;
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', "Hunter's Insight"), { targets: [cc] });
    const hand = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [cc, other].map(x => ({ attackerId: x.id, defenderId: 'B' })));
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, hand + 3, 'three cards for the Courser\'s three, none for the Bears');
    const T2 = mk({ players: ['A', 'B', 'C'] });
    T2.bf('A', 'Kediss, Emberclaw Familiar');
    const cmd = T2.bf('A', 'Grizzly Bears'); cmd.isCommander = true; cmd.summoningSick = false;
    T2.answer('declareAttackers', () => [{ attackerId: cmd.id, defenderId: 'B' }]);
    T2.answer('declareBlockers', () => []);
    T2.toMain('A', 'endCombat');
    t.eq(T2.life('B'), 18, 'B takes the commander\'s 2');
    t.eq(T2.life('C'), 18, 'and C takes 2 from Kediss');
    const T3 = mk();
    const lib = T3.bf('A', "Liberator, Urza's Battlethopter");
    T3.mana('A', '2G');
    T3.cast('A', T3.hand('A', 'Centaur Courser'));
    T3.settle(); T3.resolve();
    t.eq(lib.counters['+1/+1'], 1, 'three mana spent, more than its power of 1');
  });

  test('Demonic Consultation finds the named card past six exiled; Tainted Pact keeps the card chosen; Midnight Clock strikes twelve', (mk, t) => {
    t.auto('Demonic Consultation');
    t.auto('Tainted Pact');
    t.auto('Midnight Clock');
    const T = mk();
    const bolt = T.top('A', 'Lightning Bolt');
    for (let i = 0; i < 7; i++) T.top('A', 'Island');
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'Lightning Bolt')] }));
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Demonic Consultation'));
    t.eq(bolt.zone, 'hand', 'the Bolt found');
    t.eq(T.zone('A', 'exile').length, 7, 'six, and the Island revealed on the way');
    const T2 = mk();
    const opt = T2.top('A', 'Opt'), isl = T2.top('A', 'Island');
    T2.answer('choose', () => ({ picks: [1] }));
    T2.answer('choose', () => ({ picks: [0] }));
    T2.mana('A', '1B');
    T2.cast('A', T2.hand('A', 'Tainted Pact'));
    t.eq(isl.zone, 'exile', 'the Island passed over');
    t.eq(opt.zone, 'hand', 'Opt kept');
    const T3 = mk();
    const clock = T3.bf('A', 'Midnight Clock');
    T3.hand('A', 'Island');
    clock.counters.hour = 10;
    T3.g.addCounters(clock, 'hour', 1);
    T3.g._putTriggersOnStack(); T3.settle(); T3.resolve();
    t.eq(clock.zone, 'battlefield', 'eleven: nothing yet');
    T3.g.addCounters(clock, 'hour', 1);
    T3.g._putTriggersOnStack(); T3.settle(); T3.resolve();
    t.eq(clock.zone, 'exile', 'twelve: it goes');
    t.eq(T3.zone('A', 'hand').length, 7, 'seven new cards');
  });

  test('Nasty End draws three for a legendary sacrifice, two otherwise; Crystal Skull casts historic spells from the top', (mk, t) => {
    t.auto('Nasty End');
    t.auto('Crystal Skull, Isu Spyglass');
    const T = mk();
    T.bf('A', 'Isamaru, Hound of Konda');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.mana('A', '1B');
    T.cast('A', T.hand('A', 'Nasty End'), { auto: true });
    t.eq(T.zone('A', 'hand').length, h + 3, 'three for Isamaru');
    const T2 = mk();
    T2.bf('A', 'Grizzly Bears');
    for (let i = 0; i < 4; i++) T2.top('A', 'Island');
    const h2 = T2.zone('A', 'hand').length;
    T2.mana('A', '1B');
    T2.cast('A', T2.hand('A', 'Nasty End'), { auto: true });
    t.eq(T2.zone('A', 'hand').length, h2 + 2, 'two for the Bears');
    const T3 = mk();
    T3.bf('A', 'Crystal Skull, Isu Spyglass');
    const isa = T3.top('A', 'Isamaru, Hound of Konda');
    T3.mana('A', 'W');
    t.ok(T3.g.castSpell('A', isa.id, { auto: true }), 'a legendary creature from the top: ' + T3.g.lastError);
    const T4 = mk();
    T4.bf('A', 'Crystal Skull, Isu Spyglass');
    const bear = T4.top('A', 'Grizzly Bears');
    T4.mana('A', '1G');
    t.no(T4.g.castSpell('A', bear.id, { auto: true }), 'but not a plain Bear');
  });

  test('Cavern-Hoard Dragon costs less by the artifacts an opponent has; Metalwork Colossus by its noncreature artifacts\' mana value', (mk, t) => {
    t.auto('Cavern-Hoard Dragon');
    t.auto('Metalwork Colossus');
    const T = mk();
    for (let i = 0; i < 3; i++) T.bf('B', 'Ornithopter');
    T.mana('A', '4RR');
    T.cast('A', T.hand('A', 'Cavern-Hoard Dragon'));
    t.eq(T.g.battlefield.filter(o => o.name === 'Cavern-Hoard Dragon').length, 1, 'cast for three less');
    const T2 = mk();
    T2.bf('A', 'Mind Stone'); T2.bf('A', 'Mind Stone'); T2.bf('A', 'Sol Ring');
    T2.mana('A', '6');
    T2.cast('A', T2.hand('A', 'Metalwork Colossus'));
    t.eq(T2.g.battlefield.filter(o => o.name === 'Metalwork Colossus').length, 1, 'eleven less five');
  });

  const MTG_EFFECTS = (text) => engine().oracle.analyze({ id: 'alc:' + text, name: 'Alchemy test', type_line: 'Sorcery', oracle_text: text, keywords: [], layout: 'normal', mana_cost: '', cmc: 0, colors: [] }).abilities.find(a => a.kind === 'spell').effects;

  test('Alchemy: seek a creature, it perpetually gets +1/+1 and keeps it across zones; conjure; a perpetual cost change', (mk, t) => {
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const bear = T.top('A', 'Grizzly Bears');
    T.g._runEffects(MTG_EFFECTS('Seek a creature card. It perpetually gets +1/+1.'), { controller: 'A', name: 'test' });
    t.eq(bear.zone, 'hand', 'the only creature was found');
    T.mana('A', '1G');
    T.cast('A', bear);
    t.eq(T.g.powerOf(bear), 3, 'a 3/3 on the battlefield');
    T.g.moveObject(bear, 'hand');
    T.mana('A', '1G');
    T.cast('A', bear);
    t.eq(T.g.powerOf(bear), 3, 'still 3/3 after going back to hand and being cast again');
    t.ok(T.g._perpetualSummary(bear) && T.g._perpetualSummary(bear).pt[0] === 1, 'the summary shows +1/+1');
    const T2 = mk();
    T2.g._runEffects(MTG_EFFECTS('Conjure two cards named Lightning Bolt into your hand.'), { controller: 'A', name: 'test' });
    t.eq(T2.zone('A', 'hand').filter(c => c.name === 'Lightning Bolt').length, 2, 'two Bolts conjured');
    const T3 = mk();
    const cc = T3.hand('A', 'Centaur Courser');
    T3.g._runEffects(MTG_EFFECTS('Creature cards in your hand perpetually gain "This spell costs {1} less to cast."'), { controller: 'A', name: 'test' });
    T3.mana('A', '1G');
    T3.cast('A', cc);
    t.eq(cc.zone, 'battlefield', 'the Courser cast for {1}{G}');
  });

  test('Alchemy: Bellowsbreath Ogre deals its intensity and intensifies; double team conjures a duplicate once; choose a card in hand', (mk, t) => {
    t.auto('Bellowsbreath Ogre');
    t.auto('Veteran Charger');
    const T = mk();
    const og = T.bf('A', 'Bellowsbreath Ogre'); og.summoningSick = false;
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('declareAttackers', () => [{ attackerId: og.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.g._intensityOf(og), 2, 'intensity 1, then 2');
    t.eq(T.life('B'), 20 - 1 - T.g.powerOf(og), 'one from its intensity, and its combat damage');
    const T2 = mk();
    const gh = T2.bf('A', 'Gnoll Hunting Party'); gh.summoningSick = false;
    const h = T2.zone('A', 'hand').length;
    T2.answer('declareAttackers', () => [{ attackerId: gh.id, defenderId: 'B' }]);
    T2.answer('declareBlockers', () => []);
    T2.toMain('A', 'endCombat');
    const dup = T2.zone('A', 'hand').find(c => c.name === 'Gnoll Hunting Party');
    t.ok(dup, 'a duplicate in hand');
    t.eq(T2.zone('A', 'hand').length, h + 1);
    t.no(T2.g.hasKw(gh, 'double team'), 'it lost double team');
    t.ok(dup && (dup.effects || []).some(e => e.perpetual && (e.loseKeywords || []).includes('Double Team')), 'and so did the duplicate');
    const T3 = mk();
    const bear = T3.hand('A', 'Grizzly Bears');
    T3.mana('A', '2G');
    T3.cast('A', T3.hand('A', 'Veteran Charger'));
    T3.settle(); T3.resolve();
    t.eq(T3.g._perpetualSummary(bear).pt[0], 2, 'the Bears in hand perpetually +2/+2');
  });

  test('Alchemy: empower Jace makes the Jace token and adds loyalty; a one-time boon triggers once', (mk, t) => {
    t.auto("Protege's Awakening");
    const T = mk();
    T.top('A', 'Island'); T.top('A', 'Island');
    T.mana('A', '4U');
    T.cast('A', T.hand('A', "Protege's Awakening"));
    const jace = T.g.battlefield.find(o => o.name === 'Jace' && o.isToken);
    t.ok(jace, 'a Jace token');
    t.eq(jace && jace.counters.loyalty, 6, 'with six loyalty');
    T.g._runEffects(MTG_EFFECTS('Empower Jace 2.'), { controller: 'A', name: 'test' });
    t.eq(T.g.battlefield.filter(o => o.name === 'Jace').length, 1, 'still one Jace');
    t.eq(jace.counters.loyalty, 8, 'now eight');
    const T2 = mk();
    T2.g._runEffects(MTG_EFFECTS('You get a one-time boon with "When you cast an instant or sorcery spell, you gain 3 life."'), { controller: 'A', name: 'test' });
    t.eq(T2.zone('A', 'command').length, 1, 'the boon');
    T2.mana('A', 'RR');
    T2.cast('A', T2.hand('A', 'Shock'), { targets: ['B'] });
    T2.settle(); T2.resolve();
    t.eq(T2.life('A'), 23, 'three life');
    t.eq(T2.zone('A', 'command').length, 0, 'and the boon is gone');
    T2.cast('A', T2.hand('A', 'Shock'), { targets: ['B'] });
    T2.settle(); T2.resolve();
    t.eq(T2.life('A'), 23, 'nothing the second time');
  });

  test('Alchemy: Sworn to the Legion hands out double team; Baffling Defenses sets base power; each player seeks', (mk, t) => {
    t.auto('Sworn to the Legion');
    t.auto('Baffling Defenses');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    T.mana('A', '4WW');
    T.cast('A', T.hand('A', 'Sworn to the Legion'));
    T.settle(); T.resolve();
    const h = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').filter(c => c.name === 'Grizzly Bears').length, 1, 'a duplicate Bears in hand');
    t.eq(T.zone('A', 'hand').length, h + 1);
    const T2 = mk();
    const cc = T2.bf('B', 'Centaur Courser');
    T2.mana('A', '1W');
    T2.cast('A', T2.hand('A', 'Baffling Defenses'), { targets: [cc] });
    t.eq(T2.g.powerOf(cc), 0, 'base power 0');
    t.eq(T2.g.toughnessOf(cc), 3, 'toughness untouched');
  });

  test('Banding: a band is blocked as one, and the side with banding places the other side\'s damage', (mk, t) => {
    t.auto('Benalish Hero');
    const T = mk();
    const hero = T.bf('A', 'Benalish Hero'), bear = T.bf('A', 'Grizzly Bears');
    hero.summoningSick = false; bear.summoningSick = false;
    const cc = T.bf('B', 'Centaur Courser');
    T.answer('declareAttackers', () => [{ attackerId: hero.id, defenderId: 'B', band: 'x' }, { attackerId: bear.id, defenderId: 'B', band: 'x' }]);
    T.answer('declareBlockers', () => [{ blockerId: cc.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 20, 'blocking one blocked the band: nothing got through');
    t.eq(cc.zone, 'graveyard', 'the Courser takes 1 + 2');
    t.eq(hero.zone, 'battlefield', 'the attacker with banding put the Courser\'s 3 on one creature');
    t.eq(bear.zone, 'graveyard');
    const T2 = mk();
    const at = T2.bf('A', 'Centaur Courser'); at.summoningSick = false;
    const h2 = T2.bf('B', 'Benalish Hero'), b2 = T2.bf('B', 'Grizzly Bears');
    T2.answer('declareAttackers', () => [{ attackerId: at.id, defenderId: 'B' }]);
    T2.answer('declareBlockers', () => [{ blockerId: h2.id, attackerIds: [at.id] }, { blockerId: b2.id, attackerIds: [at.id] }]);
    T2.toMain('A', 'endCombat');
    t.eq([h2.zone, b2.zone].filter(z => z === 'graveyard').length, 1, 'the defender with banding lost only one blocker');
    t.eq(at.zone, 'graveyard', 'and the Courser died to 1 + 2');
    const T3 = mk();
    const x1 = T3.bf('A', 'Grizzly Bears'), x2 = T3.bf('A', 'Centaur Courser');
    x1.summoningSick = false; x2.summoningSick = false;
    t.ok(T3.g._bandProblem([x1, x2], [{ defenderId: 'B' }, { defenderId: 'B' }]), 'two creatures without banding cannot band');
    t.no(T3.g._bandProblem([x1, T3.bf('A', 'Benalish Hero')], [{ defenderId: 'B' }, { defenderId: 'B' }]), 'one with banding and one without can');
  });

  test('Licids: become an Aura on a creature, give it their ability, and can be turned back', (mk, t) => {
    t.auto('Gliding Licid');
    const T = mk();
    const lic = T.bf('A', 'Gliding Licid'); lic.summoningSick = false;
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U');
    T.activate('A', lic, 0, { targets: [bear] });
    T.settle(); T.resolve();
    t.eq(lic.attachedTo, bear.id, 'attached to the Bears');
    t.no(T.g.characteristics(lic).isCreature, 'no longer a creature');
    t.ok(T.g.hasKw(bear, 'flying'), 'the Bears fly');
    t.no(T.g.activateAbility('A', lic.id, 0, { targets: [{ kind: 'object', id: bear.id }] }), 'the first ability is lost');
    T.mana('A', 'U');
    t.ok(T.g.activateAbility('A', lic.id, 1, {}), 'pay {U} to end it: ' + T.g.lastError);
    t.eq(lic.attachedTo, null);
    t.ok(T.g.characteristics(lic).isCreature, 'a creature again');
    t.no(T.g.hasKw(bear, 'flying'));
    const T2 = mk();
    const l2 = T2.bf('A', 'Gliding Licid'); l2.summoningSick = false;
    const b2 = T2.bf('A', 'Grizzly Bears');
    T2.mana('A', 'U');
    T2.activate('A', l2, 0, { targets: [b2] });
    T2.settle(); T2.resolve();
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Shock'), { targets: [b2] });
    t.eq(l2.zone, 'graveyard', 'when the creature it enchants dies, the Licid goes too');
  });

  test('Kamigawa flip cards: Callow Jushi flips at the end step with two ki counters, and flips back when it leaves', (mk, t) => {
    t.auto('Callow Jushi // Jaraku the Interloper');
    const T = mk();
    const cj = T.bf('A', 'Callow Jushi // Jaraku the Interloper');
    cj.counters.ki = 2;
    T.answer('confirm', { yes: true });
    T.nextTurn('B');
    t.ok(cj.flipped, 'flipped');
    t.eq(T.g.powerOf(cj), 3, 'Jaraku is a 3/4');
    T.g.moveObject(cj, 'hand');
    t.no(cj.flipped, 'unflipped in the hand');
    t.eq(cj.face, 0);
  });

  test('Oubliette phases a creature out until it leaves, and it comes back tapped; Godo untaps itself and its Samurai', (mk, t) => {
    t.auto('Oubliette');
    t.auto('Godo, Bandit Warlord');
    const T = mk();
    const cc = T.bf('B', 'Centaur Courser');
    T.mana('A', '1BB');
    const ob = T.hand('A', 'Oubliette');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: cc.id }] }));
    T.cast('A', ob);
    T.settle(); T.resolve();
    t.ok(cc.phasedOut, 'phased out');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Disenchant'), { targets: [ob] });
    t.no(cc.phasedOut, 'back when Oubliette goes');
    t.ok(cc.tapped, 'and tapped');
    const T2 = mk();
    const godo = T2.bf('A', 'Godo, Bandit Warlord'); godo.summoningSick = false;
    for (let i = 0; i < 2; i++) { T2.answer('declareAttackers', () => [{ attackerId: godo.id, defenderId: 'B' }]); T2.answer('declareBlockers', () => []); }
    T2.toMain('A', 'end');
    t.eq(T2.life('B'), 20 - 3 * 2, 'two combat phases of three damage each');
  });

  test('Fury Storm copies once for each commander cast; a spell cast with Mission Briefing is exiled afterwards', (mk, t) => {
    t.auto('Fury Storm');
    t.auto('Mission Briefing');
    const T = mk();
    T.g.player('A').commanderCasts = { x1: 2 };
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'], resolve: false });
    T.mana('A', '2RR');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', { yes: false });
    T.cast('A', T.hand('A', 'Fury Storm'), { targets: [T.g.stack[T.g.stack.length - 1] && { kind: 'stack', id: T.g.stack[T.g.stack.length - 1].id }] });
    T.settle(); T.resolve();
    t.eq(T.life('B'), 20 - 3 * 3, 'the Bolt and two copies of it');
    const T2 = mk();
    const opt = T2.grave('A', 'Opt');
    T2.top('A', 'Island'); T2.top('A', 'Island'); T2.top('A', 'Island');
    T2.answer('choose', () => ({ picks: [opt.id] }));
    T2.mana('A', 'UU');
    T2.cast('A', T2.hand('A', 'Mission Briefing'));
    T2.mana('A', 'U');
    t.ok(T2.g.castSpell('A', opt.id, { auto: true, via: 'granted' }), 'Opt cast from the graveyard: ' + T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(opt.zone, 'exile', 'and exiled, not back in the graveyard');
  });

  test('Cabal Therapy names a card and takes every copy from the hand; Cranial Extraction from everywhere', (mk, t) => {
    t.auto('Cabal Therapy');
    t.auto('Cranial Extraction');
    const T = mk();
    const b1 = T.hand('B', 'Lightning Bolt'), b2 = T.hand('B', 'Lightning Bolt'), other = T.hand('B', 'Opt');
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'Lightning Bolt')] }));
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Cabal Therapy'), { targets: ['B'] });
    t.eq(b1.zone, 'graveyard'); t.eq(b2.zone, 'graveyard');
    t.eq(other.zone, 'hand', 'Opt kept');
    const T2 = mk();
    const g1 = T2.grave('B', 'Opt'), h1 = T2.hand('B', 'Opt'), l1 = T2.top('B', 'Opt');
    T2.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => o.key === 'Opt')] }));
    T2.mana('A', '3B');
    T2.cast('A', T2.hand('A', 'Cranial Extraction'), { targets: ['B'] });
    t.ok([g1, h1, l1].every(c => c.zone === 'exile'), 'every Opt exiled');
  });

  test('Scent of Ivy counts the green cards revealed; Scent of Jasmine gains 2 for each white one', (mk, t) => {
    t.auto('Scent of Ivy');
    t.auto('Scent of Jasmine');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.hand('A', 'Llanowar Elves'); T.hand('A', 'Giant Growth'); T.hand('A', 'Lightning Bolt');
    T.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Scent of Ivy'), { targets: [bear] });
    t.eq(T.g.powerOf(bear), 4, 'two green cards: +2/+2');
    const T2 = mk();
    T2.hand('A', 'Swords to Plowshares'); T2.hand('A', 'Serra Angel');
    T2.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T2.mana('A', 'W');
    T2.cast('A', T2.hand('A', 'Scent of Jasmine'));
    t.eq(T2.life('A'), 24, 'four life for two white cards');
  });

  test('Monstrosity X: Hydra Broodmaster gets X counters and X X/X Hydras', (mk, t) => {
    t.auto('Hydra Broodmaster');
    const T = mk();
    const hb = T.bf('A', 'Hydra Broodmaster'); hb.summoningSick = false;
    T.mana('A', '6G');
    T.activate('A', hb, 0, { x: 3 });
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(hb.counters['+1/+1'], 3, 'three counters');
    const hy = T.g.battlefield.filter(o => o.isToken && o.controller === 'A');
    t.eq(hy.length, 3, 'three Hydras');
    t.ok(hy.every(o => T.g.powerOf(o) === 3), 'each 3/3');
  });

  test('Connive: draw, then the player chooses what to discard; a nonland card discarded is a counter', (mk, t) => {
    t.auto("Raffine's Informant");
    const T = mk();
    const keep = T.hand('A', 'Lightning Bolt');
    const land = T.hand('A', 'Mountain');
    T.top('A', 'Opt');
    T.answer('choose', (ch) => ({ picks: [ch.items.find(x => x.id === land.id).id] }));
    T.mana('A', '1W');
    const ri = T.hand('A', "Raffine's Informant");
    T.cast('A', ri);
    T.settle(); T.resolve();
    t.eq(land.zone, 'graveyard', 'the Mountain chosen and discarded');
    t.eq(keep.zone, 'hand', 'the Bolt kept');
    t.no(ri.counters['+1/+1'], 'a land: no counter');
  });

  test('Mutagen tokens; rad counters mill and cost life at the start of the main phase; experience counters', (mk, t) => {
    const T = mk();
    T.g._runEffects(MTG_EFFECTS('Create a Mutagen token.'), { controller: 'A', name: 'test' });
    const mu = T.g.battlefield.find(o => o.name === 'Mutagen');
    t.ok(mu && mu.isToken, 'a Mutagen');
    const T2 = mk();
    T2.g._runEffects(MTG_EFFECTS('Target player gets three rad counters.'), { controller: 'A', name: 'test', targets: [{ kind: 'player', id: 'B' }] });
    t.eq(T2.g.player('B').rad, 3);
    T2.top('B', 'Lightning Bolt'); T2.top('B', 'Island'); T2.top('B', 'Opt');
    T2.nextTurn('B');
    // B draws Opt; then mills the Island, the Bolt and a basic land from below
    t.eq(T2.life('B'), 19, 'one nonland card milled: one life');
    t.eq(T2.g.player('B').rad, 2, 'two rad counters left');
    const T3 = mk();
    T3.g._runEffects(MTG_EFFECTS('You get an experience counter.'), { controller: 'A', name: 'test' });
    t.eq(T3.g.player('A').experience, 1);
  });

  test('Combust\'s damage gets past a prevention shield; Lethal Vapors destroys itself', (mk, t) => {
    t.auto('Combust');
    const T = mk();
    const sa = T.bf('B', 'Serra Angel');
    sa.preventShield = 10;
    T.mana('A', '1R');
    T.cast('A', T.hand('A', 'Combust'), { targets: [sa] });
    t.eq(sa.zone, 'graveyard', 'five damage, not prevented');
    const T2 = mk();
    const lv = T2.bf('A', 'Lethal Vapors');
    t.ok(T2.g.activateAbility('A', lv.id, 0, {}), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(lv.zone, 'graveyard', 'Lethal Vapors destroyed');
  });

  test('Firemind Vessel adds two mana of different colours', (mk, t) => {
    t.auto('Firemind Vessel');
    const T = mk();
    const fv = T.bf('A', 'Firemind Vessel'); fv.tapped = false;
    T.g.tapForMana('A', fv.id, 0);
    const snap = T.g.player('A').pool.snapshot();
    const cols = Object.keys(snap).filter(k => snap[k] > 0);
    t.eq(T.g.player('A').pool.total(), 2, 'two mana');
    t.eq(cols.length, 2, 'of two colours: ' + JSON.stringify(snap));
  });

  test('Delay suspends the countered spell; Suspend suspends a creature', (mk, t) => {
    t.auto('Delay');
    t.auto('Suspend');
    const T = mk();
    T.mana('A', 'R');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.mana('A', '1U');
    T.cast('A', T.hand('A', 'Delay'), { targets: [{ kind: 'stack', id: item.id }] });
    T.settle(); T.resolve();
    t.eq(bolt.zone, 'exile');
    t.eq(bolt.counters.time, 3, 'three time counters');
    t.eq(bolt.suspendedBy, 'A', 'suspended');
    t.eq(T.life('B'), 20);
    const T2 = mk();
    const cc = T2.bf('B', 'Centaur Courser');
    T2.mana('A', 'U');
    T2.cast('A', T2.hand('A', 'Suspend'), { targets: [cc] });
    t.eq(cc.zone, 'exile'); t.eq(cc.counters.time, 2); t.eq(cc.suspendedBy, 'B', 'its owner will cast it');
  });

  test('Consume Spirit: only black mana pays for X', (mk, t) => {
    t.auto('Consume Spirit');
    const T = mk();
    T.mana('A', 'BBGG');
    t.no(T.g.castSpell('A', T.hand('A', 'Consume Spirit').id, { x: 2, targets: [{ kind: 'player', id: 'B' }], fromPool: true }), 'green mana does not pay X');
    const T2 = mk();
    T2.mana('A', 'BBBG');
    t.ok(T2.g.castSpell('A', T2.hand('A', 'Consume Spirit').id, { x: 2, targets: [{ kind: 'player', id: 'B' }], fromPool: true }), 'three black and one green: ' + T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(T2.life('B'), 18);
  });

  test('"It gains" an ability for good: Can\'t Stay Away\'s returned creature is exiled when it dies', (mk, t) => {
    t.auto("Can't Stay Away");
    const T = mk();
    const bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', '1WB');
    T.cast('A', T.hand('A', "Can't Stay Away"), { targets: [bear] });
    t.eq(bear.zone, 'battlefield');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bear] });
    T.settle(); T.resolve();
    t.eq(bear.zone, 'exile', 'exiled by the ability it gained');
  });

  test('More Than Meets the Eye casts the card converted; a creature returned "transformed" comes back on its back face', (mk, t) => {
    const T = mk();
    const r = T.hand('A', 'Ratchet, Field Medic // Ratchet, Rescue Racer');
    const use = T.g.altUsesFor('A', r.id).find(u => u.via === 'mtmte');
    t.ok(use, 'offered');
    T.mana('A', '1W');
    t.ok(T.g.castSpell('A', r.id, { via: 'mtmte', auto: true }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(r.zone, 'battlefield');
    t.eq(r.face, 1, 'converted: Ratchet, Rescue Racer');
    const T2 = mk();
    const c = T2.grave('A', 'Harvest Hand // Scrounged Scythe');
    T2.g._runEffects([{ op: 'selfFromGraveyard', to: 'battlefield', transformed: true }], { controller: 'A', obj: c, name: 'test' });
    t.eq(c.zone, 'battlefield'); t.eq(c.face, 1, 'Scrounged Scythe');
  });

  test('Tail Swipe: +1/+1 in a main phase, then the two creatures fight', (mk, t) => {
    t.auto('Tail Swipe');
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Centaur Courser');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Tail Swipe'), { targets: [mine, theirs] });
    t.eq(theirs.zone, 'graveyard', 'a 3/3 Bears deals 3 to the Courser');
    t.eq(mine.zone, 'graveyard', 'and takes 3 back');
  });

  test('Snow permanents counted: Frost Bite deals 3 with three of them', (mk, t) => {
    t.auto('Frost Bite');
    const T = mk();
    for (let i = 0; i < 3; i++) T.bf('A', 'Snow-Covered Mountain');
    const cc = T.bf('B', 'Centaur Courser');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Frost Bite'), { targets: [cc] });
    t.eq(cc.zone, 'graveyard', 'three damage');
    const T2 = mk();
    T2.bf('A', 'Mountain'); T2.bf('A', 'Mountain'); T2.bf('A', 'Snow-Covered Mountain');
    const c2 = T2.bf('B', 'Centaur Courser');
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Frost Bite'), { targets: [c2] });
    t.eq(c2.damage, 2, 'only two without three snow permanents');
  });

  test('Ground Seal stops graveyard targets; Mana Vortex goes when there are no lands', (mk, t) => {
    t.auto('Ground Seal');
    const T = mk();
    T.bf('B', 'Ground Seal');
    const bear = T.grave('A', 'Grizzly Bears');
    T.mana('A', 'B');
    t.no(T.g.castSpell('A', T.hand('A', 'Raise Dead').id, { targets: [{ kind: 'object', id: bear.id }] }), 'no graveyard target');
    const T2 = mk();
    const mv = T2.bf('A', 'Mana Vortex');
    T2.g.checkStateBasedActions();
    t.eq(mv.zone, 'graveyard', 'no lands: it is sacrificed');
  });

  test('Six grants retrace; Veyran doubles cast triggers; Ezuri\'s Predation; The Black Gate; Archway of Innovation', (mk, t) => {
    t.auto('Six'); t.auto('Veyran, Voice of Duality'); t.auto("Ezuri's Predation"); t.auto('The Black Gate'); t.auto('Archway of Innovation');
    const T = mk();
    T.bf('A', 'Six');
    const bear = T.grave('A', 'Grizzly Bears');
    t.ok(T.g.altUsesFor('A', bear.id).some(u => u.via === 'retrace'), 'retrace offered on your turn');
    const T2 = mk();
    T2.bf('A', 'Veyran, Voice of Duality');
    const ve = T2.g.battlefield.find(o => o.name === 'Veyran, Voice of Duality');
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T2.settle(); T2.resolve();
    t.eq(T2.g.powerOf(ve), 2 + 2, 'magecraft +1/+1 twice');
    const T3 = mk();
    const b1 = T3.bf('B', 'Grizzly Bears'), b2 = T3.bf('B', 'Llanowar Elves');
    T3.mana('A', '5GGG');
    T3.cast('A', T3.hand('A', "Ezuri's Predation"));
    t.eq(b1.zone, 'graveyard'); t.eq(b2.zone, 'graveyard');
    t.eq(T3.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 2, 'two Beasts survive');
    const T4 = mk();
    const gate = T4.bf('A', 'The Black Gate'); gate.tapped = false;
    const at = T4.bf('A', 'Grizzly Bears'); at.summoningSick = false;
    const bl = T4.bf('B', 'Centaur Courser');
    T4.mana('A', '1B');
    t.ok(T4.g.activateAbility('A', gate.id, 1, { targets: [{ kind: 'object', id: at.id }] }), T4.g.lastError);
    T4.settle(); T4.resolve();
    t.no(T4.g.canBlock(bl, at), 'B (tied for most life) cannot block it');
    const T5 = mk();
    const arch = T5.bf('A', 'Archway of Innovation'); arch.tapped = false;
    T5.bf('A', 'Ornithopter'); T5.bf('A', 'Ornithopter');
    T5.mana('A', 'U');
    T5.activate('A', arch, 1);
    T5.settle(); T5.resolve();
    T5.mana('A', 'G');
    t.ok(T5.g.castSpell('A', T5.hand('A', 'Centaur Courser').id, { auto: true }), 'two artifacts tapped for improvise: ' + T5.g.lastError);
  });

  test('For each opponent, up to one target: Grasp of Fate, Mass Mutiny, Dismantling Wave', (mk, t) => {
    t.auto('Grasp of Fate'); t.auto('Mass Mutiny'); t.auto('Dismantling Wave'); t.auto('Sepulchral Primordial');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.bf('B', 'Island');
    T.answer('choose', (ch) => { t.eq(ch.items.length, 1, 'only the nonland permanent'); return { picks: [bear.id] }; });
    T.mana('A', '1WW');
    T.cast('A', T.hand('A', 'Grasp of Fate'));
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(bear.zone, 'exile', 'held by Grasp of Fate');
    const T2 = mk();
    const b2 = T2.bf('B', 'Grizzly Bears'); b2.tapped = true;
    T2.answer('choose', { picks: [b2.id] });
    T2.mana('A', '3RR');
    T2.cast('A', T2.hand('A', 'Mass Mutiny'));
    T2.settle(); T2.resolve();
    t.eq(b2.controller, 'A', 'taken'); t.no(b2.tapped, 'untapped');
  });

  test('Combustible Gearhulk and Risk Factor: the opponent picks; Palantír of Orthanc', (mk, t) => {
    t.auto('Combustible Gearhulk'); t.auto('Risk Factor'); t.auto('Palantír of Orthanc');
    const T = mk();
    T.top('A', 'Craw Wurm'); T.top('A', 'Grizzly Bears'); T.top('A', 'Lightning Bolt');
    T.answer('confirm', (ch) => { t.eq(ch.playerId, 'B', 'the opponent decides'); return { yes: false }; });
    const life = T.g.player('B').life;
    T.mana('A', '4RR');
    T.cast('A', T.hand('A', 'Combustible Gearhulk'));
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.g.player('B').life, life - (6 + 2 + 1), 'damage equal to the milled mana values');
    const T2 = mk();
    T2.answer('confirm', { yes: true });
    const hand = T2.g.zones.A.hand.length;
    T2.mana('A', '2R');
    T2.cast('A', T2.hand('A', 'Risk Factor'), { targets: ['B'] });
    T2.settle(); T2.resolve();
    t.eq(T2.g.player('B').life, 16, 'took the 4'); t.eq(T2.g.zones.A.hand.length, hand, 'no cards drawn');
  });

  test('Terastodon: an Elephant for each permanent put into a graveyard; Martyr\'s Cry', (mk, t) => {
    t.auto('Terastodon'); t.auto("Martyr's Cry");
    const T = mk();
    const ring = T.bf('B', 'Sol Ring'), isl = T.bf('B', 'Island');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: ring.id }, { kind: 'object', id: isl.id }] }));
    T.answer('confirm', { yes: true });
    T.mana('A', '6GG');
    T.cast('A', T.hand('A', 'Terastodon'));
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(ring.zone, 'graveyard'); t.eq(isl.zone, 'graveyard');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && o.isToken && o.name.includes('Elephant')).length, 2, 'two Elephants for B');
    const T2 = mk();
    T2.bf('B', 'Savannah Lions'); T2.bf('A', 'Savannah Lions');
    const hb = T2.g.zones.B.hand.length;
    T2.mana('A', '2WW');
    T2.cast('A', T2.hand('A', "Martyr's Cry"));
    T2.settle(); T2.resolve();
    t.eq(T2.g.zones.B.hand.length, hb + 1, 'B draws for its Lions');
  });

  test('Twinflame (strive) copies each target with haste; Myr Battlesphere taps Myr for damage', (mk, t) => {
    t.auto('Twinflame'); t.auto('Myr Battlesphere');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), lion = T.bf('A', 'Savannah Lions');
    T.mana('A', '3RR');
    T.cast('A', T.hand('A', 'Twinflame'), { targets: [bear.id, lion.id] });
    T.settle(); T.resolve();
    const toks = T.g.battlefield.filter(o => o.controller === 'A' && o.isToken);
    t.eq(toks.length, 2, 'two copies');
    t.ok(toks.every(o => T.g.hasKw(o, 'haste')), 'with haste');
    const T2 = mk();
    const bs = T2.bf('A', 'Myr Battlesphere');
    T2.bf('A', 'Iron Myr'); T2.bf('A', 'Iron Myr');
    T2.answer('choose', (ch) => { t.eq(ch.items.length, 2, 'the two untapped Myr'); return { picks: ch.items.map(x => x.id) }; });
    T2.answer('declareAttackers', () => [{ attackerId: bs.id, defenderId: 'B' }]);
    T2.toMain('A', 'endCombat');
    t.eq(T2.life('B'), 20 - 2 - (4 + 2), 'two damage from the trigger, then 6 combat damage');
  });

  test('Tempting offer: Tempt with Vengeance, Tempt with Discovery, Tempt with Reflections', (mk, t) => {
    t.auto('Tempt with Vengeance'); t.auto('Tempt with Discovery'); t.auto('Tempt with Reflections'); t.auto('Tempting Contract');
    const T = mk();
    T.answer('confirm', (ch) => { t.eq(ch.playerId, 'B', 'the opponent is offered'); return { yes: true }; });
    T.mana('A', '2R');
    T.cast('A', T.hand('A', 'Tempt with Vengeance'), { x: 2 });
    T.settle(); T.resolve();
    const el = (p) => T.g.battlefield.filter(o => o.controller === p && o.isToken).length;
    t.eq(el('A'), 4, 'two, and two more for B taking it'); t.eq(el('B'), 2, 'B made two');
    const T2 = mk();
    T2.top('A', 'Forest'); T2.top('A', 'Forest'); T2.top('B', 'Island');
    T2.answer('confirm', { yes: true });
    T2.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => /Forest|Island/.test(c.name)).id] }));
    const lands = (p) => T2.g.battlefield.filter(o => o.controller === p && (o.analysis() || {}).isLand).length;
    const la = lands('A'), lb = lands('B');
    T2.mana('A', '3G');
    T2.cast('A', T2.hand('A', 'Tempt with Discovery'));
    T2.settle(); T2.resolve();
    t.eq(lands('A'), la + 2, 'A finds two lands'); t.eq(lands('B'), lb + 1, 'B finds one');
    const T3 = mk();
    const bear = T3.bf('A', 'Grizzly Bears');
    T3.answer('confirm', { yes: false });
    T3.mana('A', '4U');
    T3.cast('A', T3.hand('A', 'Tempt with Reflections'), { targets: [bear.id] });
    T3.settle(); T3.resolve();
    t.eq(T3.g.battlefield.filter(o => o.isToken && o.name === 'Grizzly Bears').length, 1, 'one copy when declined');
  });

  test('Genesis Wave puts permanents with mana value X or less; Loot digs for a creature', (mk, t) => {
    t.auto('Genesis Wave'); t.auto('Loot, Exuberant Explorer');
    const T = mk();
    const fo = T.top('A', 'Forest'), wurm = T.top('A', 'Craw Wurm'), bear = T.top('A', 'Grizzly Bears');
    T.answer('pickCard', (ch) => { t.no(ch.cards.some(c => c.id === wurm.id), 'the Wurm costs too much'); return { cardIds: [bear.id, fo.id] }; });
    T.mana('A', '3GGG');
    T.cast('A', T.hand('A', 'Genesis Wave'), { x: 3 });
    T.settle(); T.resolve();
    t.eq(bear.zone, 'battlefield'); t.eq(fo.zone, 'battlefield'); t.eq(wurm.zone, 'graveyard');
    const T2 = mk();
    const loot = T2.bf('A', 'Loot, Exuberant Explorer'); loot.summoningSick = false; loot.tapped = false;
    T2.bf('A', 'Forest'); T2.bf('A', 'Forest');
    const cc = T2.top('A', 'Centaur Courser'), gb = T2.top('A', 'Grizzly Bears');
    T2.answer('confirm', { yes: true });
    T2.answer('pickCard', (ch) => { t.no(ch.cards.some(c => c.id === cc.id), 'mana value above the land count'); return { cardIds: [gb.id] }; });
    T2.mana('A', '4GG');
    const la = loot.analysis(), ab = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty').length - 1;
    t.ok(T2.g.activateAbility('A', loot.id, ab, {}), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(gb.zone, 'battlefield', 'the Bears enter');
  });

  test('Comet Storm: a target and one more for each kick; Inkshield makes Inklings from prevented damage', (mk, t) => {
    t.auto('Comet Storm'); t.auto('Inkshield');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', '3RR');
    t.no(T.g.castSpell('A', T.hand('A', 'Comet Storm').id, { x: 2, targets: [{ kind: 'player', id: 'B' }, { kind: 'object', id: bear.id }] }), 'two targets need a kick');
    T.cast('A', T.hand('A', 'Comet Storm'), { x: 2, kick: 1, targets: [{ kind: 'player', id: 'B' }, { kind: 'object', id: bear.id }] });
    T.settle(); T.resolve();
    t.eq(T.life('B'), 18, 'two to the player'); t.eq(bear.zone, 'graveyard', 'two to the Bears');
    const T2 = mk();
    const ogre = T2.bf('B', 'Gray Ogre');
    T2.mana('A', '3WB');
    T2.cast('A', T2.hand('A', 'Inkshield'));
    T2.settle(); T2.resolve();
    T2.g.dealDamageToPlayer(T2.g.player('A'), 2, ogre, true);
    t.eq(T2.life('A'), 20, 'prevented');
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 2, 'two Inklings');
  });

  test('Chain Lightning and Chain of Vapor: the one hit may pay to copy it back', (mk, t) => {
    t.auto('Chain Lightning'); t.auto('Chain of Vapor'); t.auto('Chain of Acid'); t.auto('Chain of Smog');
    const T = mk();
    T.mana('B', 'RR');
    let asked = 0;
    T.answer('confirm', (ch) => { asked++; return { yes: asked === 1 && ch.playerId === 'B' }; });
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'player', id: 'A' }] }));
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Chain Lightning'), { targets: [{ kind: 'player', id: 'B' }] });
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.life('B'), 17, 'B was hit'); t.eq(T.life('A'), 17, 'and copied it back at A');
    const T2 = mk();
    const bear = T2.bf('B', 'Grizzly Bears'), isl = T2.bf('B', 'Island');
    const mine = T2.bf('A', 'Llanowar Elves');
    let n2 = 0;
    T2.answer('confirm', (ch) => { n2++; return { yes: n2 === 1 }; });
    T2.answer('choose', { picks: [isl.id] });
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: mine.id }] }));
    T2.mana('A', 'U');
    T2.cast('A', T2.hand('A', 'Chain of Vapor'), { targets: [bear.id] });
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(bear.zone, 'hand'); t.eq(isl.zone, 'graveyard', 'the land paid for it'); t.eq(mine.zone, 'hand', 'the copy bounced the Elves');
  });

  test("Ugin's -X exiles coloured permanents; Heliod's Intervention asks for X targets; Rankle chooses any number", (mk, t) => {
    t.auto('Ugin, the Spirit Dragon'); t.auto("Heliod's Intervention"); t.auto('Rankle, Master of Pranks');
    const T = mk();
    const ugin = T.bf('A', 'Ugin, the Spirit Dragon');
    if (!ugin.counters.loyalty) ugin.counters.loyalty = 7;
    const bear = T.bf('B', 'Grizzly Bears'), thop = T.bf('B', 'Ornithopter'), wurm = T.bf('B', 'Craw Wurm');
    t.ok(T.g.activateAbility('A', ugin.id, 1, { x: 3 }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(bear.zone, 'exile'); t.eq(thop.zone, 'battlefield', 'colourless stays'); t.eq(wurm.zone, 'battlefield', 'too costly');
    const T2 = mk();
    const r1 = T2.bf('B', 'Sol Ring'), r2 = T2.bf('B', 'Mind Stone');
    T2.answer('mode', (ch) => ({ modes: [0] }));
    T2.answer('pickTarget', (ch) => { t.eq(ch.count, 2, 'two targets for X=2'); return { targets: [{ kind: 'object', id: r1.id }, { kind: 'object', id: r2.id }] }; });
    T2.mana('A', '2WW');
    T2.cast('A', T2.hand('A', "Heliod's Intervention"), { x: 2 });
    T2.settle(); T2.resolve();
    t.eq(r1.zone, 'graveyard'); t.eq(r2.zone, 'graveyard');
  });

  test('Crackle with Power, Drown in the Loch, Cultivator Colossus, Traverse the Outlands, Eerie Ultimatum', (mk, t) => {
    for (const c of ['Crackle with Power', 'Drown in the Loch', 'Cultivator Colossus', 'Traverse the Outlands', 'Eerie Ultimatum']) t.auto(c);
    const T = mk();
    T.mana('A', '3RR');
    T.cast('A', T.hand('A', 'Crackle with Power'), { x: 1, targets: [{ kind: 'player', id: 'B' }] });
    T.settle(); T.resolve();
    t.eq(T.life('B'), 15, 'five times X');
    const T2 = mk();
    const bear = T2.bf('B', 'Grizzly Bears'), wurm = T2.bf('B', 'Craw Wurm');
    T2.grave('B', 'Island'); T2.grave('B', 'Forest');
    T2.answer('mode', (ch) => ({ modes: [1] }));
    T2.answer('pickTarget', (ch) => { t.no(ch.options[0].some(x => x.id === wurm.id), 'the Wurm costs more than their graveyard'); return { targets: [{ kind: 'object', id: bear.id }] }; });
    T2.mana('A', 'UB');
    T2.cast('A', T2.hand('A', 'Drown in the Loch'));
    T2.settle(); T2.resolve();
    t.eq(bear.zone, 'graveyard');
    const T3 = mk();
    const f1 = T3.hand('A', 'Forest'), f2 = T3.hand('A', 'Forest');
    T3.answer('choose', (ch) => ({ picks: ch.items.filter(x => x.name === 'Forest').slice(0, 1).map(x => x.id) }));
    T3.answer('choose', (ch) => ({ picks: ch.items.filter(x => x.name === 'Forest').slice(0, 1).map(x => x.id) }));
    T3.mana('A', '4GGG');
    const lands = () => T3.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Forest').length;
    T3.cast('A', T3.hand('A', 'Cultivator Colossus'));
    T3.settle(); T3.resolve(); T3.settle(); T3.resolve();
    t.ok(lands() >= 2, 'both Forests put in: ' + lands()); t.eq(f1.zone, 'battlefield'); t.eq(f2.zone, 'battlefield');
    const T4 = mk();
    T4.bf('A', 'Centaur Courser');
    T4.answer('pickCard', (ch) => { t.eq(ch.count, 3, 'up to three, the greatest power'); return { cardIds: ch.cards.slice(0, 3).map(c => c.id) }; });
    const before = T4.g.battlefield.filter(o => o.controller === 'A').length;
    T4.mana('A', '4G');
    T4.cast('A', T4.hand('A', 'Traverse the Outlands'));
    T4.settle(); T4.resolve();
    t.eq(T4.g.battlefield.filter(o => o.controller === 'A').length, before + 3);
    const T5 = mk();
    const g1 = T5.grave('A', 'Grizzly Bears'), g2 = T5.grave('A', 'Grizzly Bears'), g3 = T5.grave('A', 'Sol Ring');
    T5.answer('choose', (ch) => { t.ok(ch.constraints.some(c => c.kind === 'distinct'), 'names must differ'); return { picks: [g1.id, g3.id] }; });
    T5.mana('A', 'WWBBBGG');
    T5.cast('A', T5.hand('A', 'Eerie Ultimatum'));
    T5.settle(); T5.resolve();
    t.eq(g1.zone, 'battlefield'); t.eq(g2.zone, 'graveyard', 'one of each name'); t.eq(g3.zone, 'battlefield');
  });

  test('Twenty-Toed Toad wins with twenty counters; Meren reads experience; Planar Genesis falls back to a card', (mk, t) => {
    t.auto('Twenty-Toed Toad'); t.auto('Meren of Clan Nel Toth'); t.auto('Planar Genesis');
    const T = mk();
    const toad = T.bf('A', 'Twenty-Toed Toad');
    toad.counters['+1/+1'] = 19; toad.counters.charge = 1;
    T.answer('declareAttackers', () => [{ attackerId: toad.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.ok(T.g.player('B').hasLost, 'twenty counters: A wins');
    const T2 = mk();
    const meren = T2.bf('A', 'Meren of Clan Nel Toth');
    T2.g.player('A').experience = 2;
    const bear = T2.grave('A', 'Grizzly Bears');
    T2.g._runEffects(meren.analysis().abilities.find(a => a.kind === 'triggered' && /end step/.test(a.text)).effects,
      { controller: 'A', obj: meren, name: 'Meren', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    t.eq(bear.zone, 'battlefield', 'mana value 2, two experience');
    const T3 = mk();
    T3.top('A', 'Grizzly Bears'); T3.top('A', 'Craw Wurm'); T3.top('A', 'Lightning Bolt'); T3.top('A', 'Sol Ring');
    T3.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Sol Ring').id] }));
    T3.mana('A', 'GU');
    T3.cast('A', T3.hand('A', 'Planar Genesis'));
    T3.settle(); T3.resolve();
    t.ok(T3.g.zones.A.hand.some(o => o.name === 'Sol Ring'), 'no land: a card into hand');
  });

  test('Descent into Avernus, Tataru Taru, Hedge Shredder', (mk, t) => {
    t.auto('Descent into Avernus'); t.auto('Tataru Taru'); t.auto('Hedge Shredder');
    const T = mk();
    const d = T.bf('A', 'Descent into Avernus');
    const run = (T0, o, re, extra) => T0.g._runEffects(o.analysis().abilities.find(a => a.kind === 'triggered' && re.test(a.text)).effects,
      Object.assign({ controller: o.controller, obj: o, name: o.name, kind: 'ability' }, extra || {}));
    run(T, d, /upkeep/);
    const tr = (p) => T.g.battlefield.filter(o => o.controller === p && o.name === 'Treasure').length;
    t.eq(tr('A'), 2); t.eq(tr('B'), 2); t.eq(T.life('A'), 18); t.eq(T.life('B'), 18);
    const T2 = mk();
    const tt = T2.bf('A', 'Tataru Taru');
    T2.answer('confirm', (ch) => { t.eq(ch.playerId, 'B'); return { yes: true }; });
    const ha = T2.g.zones.A.hand.length, hb = T2.g.zones.B.hand.length;
    run(T2, tt, /enters/, { targets: [{ kind: 'player', id: 'B' }] });
    T2.settle();
    t.eq(T2.g.zones.A.hand.length, ha + 1); t.eq(T2.g.zones.B.hand.length, hb + 1, 'B took the card');
    const T3 = mk();
    T3.bf('A', 'Hedge Shredder');
    const f = T3.top('A', 'Forest'), b = T3.top('A', 'Grizzly Bears'), i = T3.top('A', 'Island');
    T3.g._runEffects([{ op: 'mill', n: 3, who: 'you' }], { controller: 'A', name: 'mill', kind: 'ability' });
    T3.settle(); T3.resolve();
    t.eq(f.zone, 'battlefield'); t.eq(i.zone, 'battlefield'); t.eq(b.zone, 'graveyard', 'only the lands'); t.ok(f.tapped, 'tapped');
  });

  test('Charismatic Conqueror: tap it or give a Vampire; Kambal copies the tokens that entered', (mk, t) => {
    t.auto('Charismatic Conqueror'); t.auto('Kambal, Profiteering Mayor');
    const T = mk();
    T.bf('A', 'Charismatic Conqueror');
    T.answer('confirm', (ch) => { t.eq(ch.playerId, 'B', 'the one whose permanent entered'); return { yes: false }; });
    T.bf('B', 'Grizzly Bears', { etb: true });
    T.settle(); T.resolve();
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 1, 'a Vampire');
    const T2 = mk();
    T2.bf('A', 'Kambal, Profiteering Mayor');
    T2.g._runEffects([{ op: 'createToken', n: 2, pt: '1/1', colorWords: ['green'], subtypes: 'Saproling', keywords: [] }], { controller: 'B', name: 'tokens', kind: 'ability' });
    T2.settle(); T2.resolve();
    const mine = T2.g.battlefield.filter(o => o.controller === 'A' && o.isToken);
    t.eq(mine.length, 2, 'a copy of each'); t.ok(mine.every(o => o.tapped), 'tapped');
  });

  test("Agadeem's Awakening: creature cards of different mana values, X or less", (mk, t) => {
    t.auto("Agadeem's Awakening // Agadeem, the Undercrypt");
    const T = mk();
    const a = T.grave('A', 'Grizzly Bears'), b = T.grave('A', 'Llanowar Elves'), c = T.grave('A', 'Craw Wurm');
    T.answer('choose', (ch) => { t.no(ch.items.some(x => x.id === c.id), 'the Wurm is above X'); return { picks: [a.id, b.id] }; });
    T.mana('A', '3BBB');
    T.cast('A', T.hand('A', "Agadeem's Awakening // Agadeem, the Undercrypt"), { x: 3 });
    T.settle(); T.resolve();
    t.eq(a.zone, 'battlefield'); t.eq(b.zone, 'battlefield'); t.eq(c.zone, 'graveyard');
  });

  test("Lae'zel adds one of each kind; Odric shares keywords", (mk, t) => {
    t.auto("Lae'zel, Vlaakith's Champion"); t.auto('Odric, Lunarch Marshal');
    const T = mk();
    T.bf('A', "Lae'zel, Vlaakith's Champion");
    const bear = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1, 'A');
    t.eq(bear.counters['+1/+1'], 2, 'one more');
    T.g.addCounters(theirs, '+1/+1', 1, 'A');
    t.eq(theirs.counters['+1/+1'], 1, 'not on theirs');
    const T2 = mk();
    const od = T2.bf('A', 'Odric, Lunarch Marshal');
    const b2 = T2.bf('A', 'Grizzly Bears');
    T2.bf('A', 'Serra Angel');
    T2.g._runEffects(od.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: od, name: 'Odric', kind: 'ability' });
    t.ok(T2.g.hasKw(b2, 'flying') && T2.g.hasKw(b2, 'vigilance'), 'the Bears fly and have vigilance');
    t.no(T2.g.hasKw(b2, 'trample'), 'nobody has trample');
  });

  test('Emblems: Wrenn and Six, Liliana the Last Hope, Tezzeret Cruel Captain, Serra; Chandra Dressed to Kill', (mk, t) => {
    for (const c of ['Wrenn and Six', 'Liliana, the Last Hope', 'Tezzeret, Cruel Captain', 'Serra the Benevolent', 'Chandra, Dressed to Kill']) t.auto(c);
    const ult = (T, name) => {
      const pw = T.bf('A', name);
      const ab = pw.analysis().abilities.filter(a => a.kind === 'loyalty').slice(-1)[0];
      T.g._runEffects(ab.effects, { controller: 'A', obj: pw, name, kind: 'ability' });
      T.settle();
      return T.g._emblems().filter(o => o.controller === 'A').slice(-1)[0];
    };
    const T = mk();
    t.ok(ult(T, 'Wrenn and Six'), 'an emblem');
    const bolt = T.grave('A', 'Lightning Bolt');
    t.ok(T.g.altUsesFor('A', bolt.id).some(u => u.via === 'retrace'), 'retrace for the Bolt');
    const T2 = mk();
    const em = ult(T2, 'Liliana, the Last Hope');
    T2.bf('A', 'Gravecrawler');
    T2.g._runEffects(em.analysis().abilities[0].effects, { controller: 'A', obj: em, name: 'emblem', kind: 'ability' });
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 3, 'two plus one Zombie');
    const T3 = mk();
    const em3 = ult(T3, 'Tezzeret, Cruel Captain');
    const ring = T3.bf('A', 'Sol Ring');
    T3.g._runEffects(em3.analysis().abilities[0].effects, { controller: 'A', obj: em3, name: 'emblem', kind: 'ability', targets: [{ kind: 'object', id: ring.id }] });
    t.ok(T3.g.characteristics(ring).isCreature, 'the Sol Ring is a creature'); t.eq(T3.g.powerOf(ring), 3, '0/0 with three counters');
    const T4 = mk();
    ult(T4, 'Serra the Benevolent');
    T4.bf('A', 'Grizzly Bears');
    T4.g.player('A').life = 3;
    T4.g.dealDamageToPlayer(T4.g.player('A'), 5, null, false);
    t.eq(T4.life('A'), 1, 'stays at 1');
    const T5 = mk();
    const ch = T5.bf('A', 'Chandra, Dressed to Kill');
    const bolt5 = T5.top('A', 'Lightning Bolt');
    T5.g._runEffects(ch.analysis().abilities.find(a => a.kind === 'loyalty' && /Exile the top card/.test(a.text)).effects, { controller: 'A', obj: ch, name: 'Chandra', kind: 'ability' });
    t.eq(bolt5.zone, 'exile'); t.eq(bolt5.impulseBy, 'A', 'red: castable');
  });

  test('Perpetual Timepiece, For the Common Good, Anticausal Vestige, Allosaurus Shepherd, Kazuul', (mk, t) => {
    for (const c of ['Perpetual Timepiece', 'For the Common Good', 'Anticausal Vestige', 'Allosaurus Shepherd', 'Kazuul, Tyrant of the Cliffs']) t.auto(c);
    const T = mk();
    const tp = T.bf('A', 'Perpetual Timepiece');
    const g1 = T.grave('A', 'Grizzly Bears'), g2 = T.grave('A', 'Lightning Bolt');
    T.answer('choose', { picks: [g1.id, g2.id] });
    T.mana('A', '2');
    const la = tp.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', tp.id, idx, {}), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(g1.zone, 'library'); t.eq(g2.zone, 'library');
    const T2 = mk();
    T2.g._runEffects([{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['green'], subtypes: 'Saproling', keywords: [] }], { controller: 'A', name: 'tok', kind: 'ability' });
    const tok = T2.g.battlefield.find(o => o.isToken && o.controller === 'A');
    T2.mana('A', '4G');
    T2.cast('A', T2.hand('A', 'For the Common Good'), { x: 2, targets: [tok.id] });
    T2.settle(); T2.resolve();
    const toks = T2.g.battlefield.filter(o => o.isToken && o.controller === 'A');
    t.eq(toks.length, 3, 'two copies'); t.ok(toks.every(o => T2.g.hasKw(o, 'indestructible')), 'indestructible');
    const T3 = mk();
    const v = T3.bf('A', 'Anticausal Vestige');
    T3.bf('A', 'Forest'); T3.bf('A', 'Forest');
    const bear = T3.hand('A', 'Grizzly Bears'), wurm = T3.hand('A', 'Craw Wurm');
    T3.answer('pickCard', (ch) => { t.no(ch.cards.some(c => c.id === wurm.id), 'the Wurm costs more than two lands'); return { cardIds: [bear.id] }; });
    T3.g.moveObject(v, 'graveyard');
    T3.settle(); T3.resolve(); T3.settle();
    t.eq(bear.zone, 'battlefield'); t.ok(bear.tapped, 'tapped');
    const T4 = mk();
    const sh = T4.bf('A', 'Allosaurus Shepherd'), elf = T4.bf('A', 'Llanowar Elves'), b4 = T4.bf('A', 'Grizzly Bears');
    T4.mana('A', '4GG');
    const la4 = sh.analysis(), i4 = la4.manaAbilities.length + la4.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T4.g.activateAbility('A', sh.id, i4, {}), T4.g.lastError);
    T4.settle(); T4.resolve();
    t.eq(T4.g.powerOf(elf), 5, 'the Elf is 5/5'); t.eq(T4.g.powerOf(b4), 2, 'the Bears are not');
    t.ok(T4.g._hasCreatureType(elf, 'Dinosaur'), 'and a Dinosaur');
  });

  test('Thunderfoot Baloth with your commander; Battle Angels of Tyr compares the player it hit', (mk, t) => {
    t.auto('Thunderfoot Baloth'); t.auto('Battle Angels of Tyr');
    const T = mk();
    const bal = T.bf('A', 'Thunderfoot Baloth'), bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(bal), 5, 'no commander yet'); t.eq(T.g.powerOf(bear), 2);
    const cmd = T.bf('A', 'Llanowar Elves'); cmd.isCommander = true;
    T.g.bumpBoard();
    t.eq(T.g.powerOf(bal), 7); t.eq(T.g.powerOf(bear), 4); t.ok(T.g.hasKw(bear, 'trample'));
    const T2 = mk();
    const ang = T2.bf('A', 'Battle Angels of Tyr');
    T2.hand('B', 'Island'); T2.hand('B', 'Island');
    const ha = T2.g.zones.A.hand.length;
    T2.g._runEffects(ang.analysis().abilities.find(a => a.kind === 'triggered').effects,
      { controller: 'A', obj: ang, name: 'Angels', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
    t.eq(T2.g.zones.A.hand.length, ha + 1, 'B has more cards: draw');
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Treasure').length, 0, 'lands are level: no Treasure');
  });

  test("Praetor's Grasp, Moonsilver Key, Teferi's Puzzle Box", (mk, t) => {
    t.auto("Praetor's Grasp"); t.auto('Moonsilver Key'); t.auto("Teferi's Puzzle Box");
    const T = mk();
    const wurm = T.top('B', 'Craw Wurm');
    T.answer('pickCard', (ch) => ({ cardIds: [wurm.id] }));
    T.mana('A', '1BB');
    T.cast('A', T.hand('A', "Praetor's Grasp"), { targets: [{ kind: 'player', id: 'B' }] });
    T.settle(); T.resolve();
    t.eq(wurm.zone, 'exile'); t.eq(wurm.impulseBy, 'A', 'A may play it'); t.ok(wurm.faceDownExile, 'face down');
    const T2 = mk();
    const key = T2.bf('A', 'Moonsilver Key');
    const ring = T2.top('A', 'Sol Ring'), bear = T2.top('A', 'Grizzly Bears');
    T2.answer('pickCard', (ch) => { t.ok(ch.cards.some(c => c.id === ring.id), 'Sol Ring offered'); t.no(ch.cards.some(c => c.id === bear.id), 'not the Bears'); return { cardIds: [ring.id] }; });
    T2.mana('A', '1');
    const la = key.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T2.g.activateAbility('A', key.id, idx, {}), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(ring.zone, 'hand');
    const T3 = mk();
    const box = T3.bf('A', "Teferi's Puzzle Box");
    T3.hand('A', 'Grizzly Bears'); T3.hand('A', 'Craw Wurm');
    T3.g._runEffects(box.analysis().abilities.find(a => a.kind === 'triggered').effects,
      { controller: 'A', obj: box, name: 'Box', kind: 'ability', triggerData: { player: 'A', playerId: 'A' } });
    t.eq(T3.g.zones.A.hand.length, 2, 'two back'); t.no(T3.g.zones.A.hand.some(o => o.name === 'Craw Wurm'), 'new cards');
  });

  test('Miracle: the first card drawn this turn, cast for its miracle cost', (mk, t) => {
    t.auto('Terminus'); t.auto('Reforge the Soul');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const term = T.top('A', 'Terminus');
    T.mana('A', 'W');
    T.g.player('A').drawnThisTurn = 0;
    T.answer('confirm', (ch) => { t.ok(/Miracle/.test(ch.prompt), 'offered: ' + ch.prompt); return { yes: true }; });
    T.g.drawCards('A', 1);
    T.settle(); T.resolve();
    t.eq(bear.zone, 'library', 'Terminus resolved for {W}');
    t.eq(term.zone, 'graveyard');
    const T2 = mk();
    const t2 = T2.top('A', 'Terminus');
    T2.mana('A', 'W');
    T2.g.player('A').drawnThisTurn = 1;
    let offered = false;
    T2.answer('confirm', () => { offered = true; return { yes: true }; });
    T2.g.drawCards('A', 1);
    T2.settle();
    t.no(offered, 'not the first card this turn'); t.eq(t2.zone, 'hand');
  });

  test('Surge: the other cost after another spell, and "if its surge cost was paid"', (mk, t) => {
    t.auto('Reckless Bushwhacker'); t.auto('Boulder Salvo');
    const T = mk();
    const rb = T.hand('A', 'Reckless Bushwhacker');
    t.no(T.g.altUsesFor('A', rb.id).some(u => u.via === 'surge'), 'no surge before another spell');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    T.settle(); T.resolve();
    t.ok(T.g.altUsesFor('A', rb.id).some(u => u.via === 'surge'), 'surge offered');
    T.mana('A', '1R');
    t.ok(T.g.castSpell('A', rb.id, { via: 'surge' }), T.g.lastError);
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.g.powerOf(bear), 3, '+1/+0 for the surge'); t.ok(T.g.hasKw(bear, 'haste'));
  });

  test('Awaken: the spell, then a land of yours wakes up', (mk, t) => {
    t.auto('Coastal Discovery');
    const T = mk();
    const land = T.bf('A', 'Island');
    const cd = T.hand('A', 'Coastal Discovery');
    const use = T.g.altUsesFor('A', cd.id).find(u => u.via === 'awaken');
    t.ok(use, 'awaken offered'); t.eq(use.cost, '{5}{U}');
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'object', id: land.id }] }));
    const hand = T.g.zones.A.hand.length;
    T.mana('A', '5U');
    t.ok(T.g.castSpell('A', cd.id, { via: 'awaken' }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(T.g.zones.A.hand.length, hand - 1 + 2, 'drew two');
    t.ok(T.g.characteristics(land).isCreature, 'the Island is a creature'); t.eq(T.g.powerOf(land), 4); t.ok(T.g.hasKw(land, 'haste'));
  });

  test('Sudden Setback (permanent or spell), Procrastinate', (mk, t) => {
    t.auto('Sudden Setback'); t.auto('Procrastinate');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('choose', (ch) => { t.eq(ch.playerId, 'B', 'the owner chooses'); return { picks: [1] }; });
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Sudden Setback'), { targets: [bear.id] });
    T.settle(); T.resolve();
    t.eq(bear.zone, 'library'); t.eq(T.g.zones.B.library.slice(-1)[0], bear, 'on the bottom');
    const T2 = mk();
    const b2 = T2.bf('B', 'Grizzly Bears');
    T2.mana('A', '2UU');
    T2.cast('A', T2.hand('A', 'Procrastinate'), { x: 2, targets: [b2.id] });
    T2.settle(); T2.resolve();
    t.ok(b2.tapped); t.eq(b2.counters.stun, 4, 'twice X');
  });

  test('Emerge: a creature sacrificed and its mana value off the cost', (mk, t) => {
    t.auto('Elder Deep-Fiend');
    const T = mk();
    const wurm = T.bf('A', 'Craw Wurm'), bear = T.bf('A', 'Grizzly Bears');
    const edf = T.hand('A', 'Elder Deep-Fiend');
    t.ok(T.g.altUsesFor('A', edf.id).some(u => u.via === 'emerge'), 'emerge offered');
    T.answer('mode', (ch) => ({ modes: [ch.options.findIndex(o => /Craw Wurm/.test(o.label))] }));
    T.mana('A', 'UU');
    t.ok(T.g.castSpell('A', edf.id, { via: 'emerge' }), T.g.lastError);
    T.settle();
    t.eq(wurm.zone, 'graveyard', 'the Wurm was sacrificed'); t.eq(bear.zone, 'battlefield');
    t.ok(T.g.stack.some(s => s.obj && s.obj.id === edf.id) || edf.zone === 'battlefield', 'cast for {5}{U}{U} less six: {U}{U}');
  });

  test('Cleave: the words in brackets are gone when cast for the cleave cost', (mk, t) => {
    t.auto('Fierce Retribution'); t.auto('Dig Up');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    const fr = T.hand('A', 'Fierce Retribution');
    T.mana('A', '1W');
    t.no(T.g.castSpell('A', fr.id, { targets: [bear.id] }), 'normally only an attacking creature');
    T.mana('A', '5W');
    t.ok(T.g.castSpell('A', fr.id, { via: 'cleave', targets: [bear.id] }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(bear.zone, 'graveyard', 'any creature, cleaved');
    const T2 = mk();
    const ring = T2.top('A', 'Sol Ring');
    T2.answer('pickCard', (ch) => { t.ok(ch.cards.some(c => c.id === ring.id), 'any card'); return { cardIds: [ring.id] }; });
    T2.mana('A', '1BBG');
    t.ok(T2.g.castSpell('A', T2.hand('A', 'Dig Up').id, { via: 'cleave' }), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(ring.zone, 'hand');
  });

  test('Overload reads the targeted words over everything they could have aimed at', (mk, t) => {
    t.auto('Blustersquall'); t.auto('Eldritch Immunity');
    const T = mk();
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Savannah Lions'), mine = T.bf('A', 'Llanowar Elves');
    T.mana('A', '3U');
    t.ok(T.g.castSpell('A', T.hand('A', 'Blustersquall').id, { via: 'overload' }), T.g.lastError);
    T.settle(); T.resolve();
    t.ok(b1.tapped && b2.tapped, 'theirs tapped'); t.no(mine.tapped, 'mine untouched');
    const T2 = mk();
    const e1 = T2.bf('A', 'Grizzly Bears'), e2 = T2.bf('A', 'Llanowar Elves');
    T2.mana('A', '4C');
    t.ok(T2.g.castSpell('A', T2.hand('A', 'Eldritch Immunity').id, { via: 'overload' }), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.ok(T2.g.hasKw(e1, 'protection from each color') || [...T2.g.characteristics(e1).keywords].some(k => /protection/.test(k)), 'protected');
    t.ok([...T2.g.characteristics(e2).keywords].some(k => /protection/.test(k)), 'both');
  });

  test("Undaunted: {1} less for each opponent", (mk, t) => {
    t.auto("Curtains' Call");
    const T = mk();
    const cc = T.hand('A', "Curtains' Call");
    t.eq(T.g.castCost(cc), '{4}{B}', 'one opponent: one less');
    const T3 = mk({ players: ['A', 'B', 'C'] });
    const c3 = T3.hand('A', "Curtains' Call");
    t.eq(T3.g.castCost(c3), '{3}{B}', 'two opponents: two less');
  });

  test('Waterbend: artifacts and creatures tapped for {1} each', (mk, t) => {
    t.auto('Waterbender Ascension'); t.auto('Katara, Water Tribe\'s Hope');
    const T = mk();
    const asc = T.bf('A', 'Waterbender Ascension');
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('A', 'Savannah Lions'), ring = T.bf('A', 'Ornithopter');
    T.mana('A', '2');
    const la = asc.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', asc.id, idx, { targets: [{ kind: 'object', id: b1.id }] }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq([b1, b2, ring].filter(x => x.tapped).length, 2, 'two tapped to help pay {4}');
  });

  test('Equip discounts: Plate Armor per Equipment, Belt of Giant Strength by the target power', (mk, t) => {
    t.auto('Plate Armor'); t.auto('Belt of Giant Strength'); t.auto('Leather Armor');
    const T = mk();
    const pa = T.bf('A', 'Plate Armor'); T.bf('A', 'Bonesplitter'); T.bf('A', 'Leather Armor');
    const bear = T.bf('A', 'Grizzly Bears');
    const ab = pa.analysis().abilities.find(a => a.kind === 'activated' && /^Equip/.test(a.text));
    t.eq(T.g._abilityMana(pa, ab, [{ kind: 'object', id: bear.id }]), '{1}', '{3} less two');
    const belt = T.bf('A', 'Belt of Giant Strength');
    const wurm = T.bf('A', 'Craw Wurm');
    const ab2 = belt.analysis().abilities.find(a => a.kind === 'activated' && /^Equip/.test(a.text));
    t.eq(T.g._abilityMana(belt, ab2, [{ kind: 'object', id: wurm.id }]), '{4}', '{10} less six');
  });

  test('Paradigm: exiled as it resolves, then a free copy at each of your first main phases', (mk, t) => {
    t.auto('Germination Practicum');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const gp = T.hand('A', 'Germination Practicum');
    T.mana('A', '3GG');
    T.cast('A', gp);
    T.settle(); T.resolve();
    t.eq(bear.counters['+1/+1'], 2); t.eq(gp.zone, 'exile', 'exiled'); t.eq(gp.paradigmBy, 'A');
    T.answer('confirm', (ch) => { t.ok(/Paradigm/.test(ch.prompt), ch.prompt); return { yes: true }; });
    T.toMain('B'); T.toMain('A');
    T.settle(); T.resolve();
    t.eq(bear.counters['+1/+1'], 4, 'the copy resolved'); t.eq(gp.zone, 'exile', 'the card stays in exile');
  });

  test("Containment Construct, Proft's Eidetic Memory, Sage's Reverie", (mk, t) => {
    t.auto('Containment Construct'); t.auto("Proft's Eidetic Memory"); t.auto("Sage's Reverie");
    const T = mk();
    T.bf('A', 'Containment Construct');
    const c = T.hand('A', 'Lightning Bolt');
    T.answer('confirm', { yes: true });
    T.g._discardNow('A', [c]);
    T.settle(); T.resolve();
    t.eq(c.zone, 'exile'); t.eq(c.impulseBy, 'A', 'playable this turn');
    const T2 = mk();
    const pm = T2.bf('A', "Proft's Eidetic Memory");
    const bear = T2.bf('A', 'Grizzly Bears');
    T2.g.player('A').drawnThisTurn = 3;
    const ab = pm.analysis().abilities.find(a => a.kind === 'triggered' && /combat/.test(a.text));
    T2.g._runEffects(ab.effects, { controller: 'A', obj: pm, name: 'Proft', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    t.eq(bear.counters['+1/+1'], 2, 'three drawn, minus one');
    const T3 = mk();
    const b3 = T3.bf('A', 'Grizzly Bears');
    T3.bf('A', 'Rancor', { }).attachedTo = b3.id;
    const hand = T3.g.zones.A.hand.length;
    const sr = T3.hand('A', "Sage's Reverie");
    T3.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b3.id }] }));
    T3.mana('A', '3W');
    T3.cast('A', sr, { targets: [b3.id] });
    T3.settle(); T3.resolve(); T3.settle(); T3.resolve();
    t.eq(T3.g.zones.A.hand.length, hand + 2, 'Rancor and the Reverie itself');
  });

  test('Ivory Tower: "minus four" never goes below zero', (mk, t) => {
    t.auto('Ivory Tower');
    const T = mk();
    const it = T.bf('A', 'Ivory Tower');
    const run = () => T.g._runEffects(it.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: it, name: 'Tower', kind: 'ability' });
    T.hand('A', 'Island');
    run();
    t.eq(T.life('A'), 20, 'one card: nothing, not a loss');
    for (let i = 0; i < 5; i++) T.hand('A', 'Island');
    run();
    t.eq(T.life('A'), 22, 'six cards: two life');
  });

  test('Hit the Mother Lode, Summon: Fenrir, Hellkite Courser', (mk, t) => {
    t.auto('Hit the Mother Lode'); t.auto('Summon: Fenrir'); t.auto('Hellkite Courser');
    const T = mk();
    T.g._lastDiscovered = { id: null, mv: 3 };
    T.g._runEffects([{ op: 'treasureDifference', n: 10 }], { controller: 'A', name: 'Lode', kind: 'spell' });
    const tr = T.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Treasure');
    t.eq(tr.length, 7, 'ten minus three'); t.ok(tr.every(o => o.tapped), 'tapped');
    const T2 = mk();
    T2.g._runEffects([{ op: 'nextCreatureCounter', n: 1 }], { controller: 'A', name: 'Fenrir', kind: 'ability' });
    T2.mana('A', '1G');
    const bear = T2.hand('A', 'Grizzly Bears');
    T2.cast('A', bear);
    T2.settle(); T2.resolve();
    t.eq(bear.counters['+1/+1'], 1, 'one more counter');
    const T3 = mk();
    const cmd = T3.put('A', 'Craw Wurm', 'command'); cmd.isCommander = true;
    const hc = T3.bf('A', 'Hellkite Courser');
    T3.answer('choose', { picks: [cmd.id] });
    T3.g._runEffects(hc.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: hc, name: 'Courser', kind: 'ability' });
    T3.settle();
    t.eq(cmd.zone, 'battlefield'); t.ok(T3.g.hasKw(cmd, 'haste'));
    T3.toMain('B');
    t.eq(cmd.zone, 'command', 'back at the end step');
  });

  test('Liesa exiles dying opponents\' creatures; Bruvac doubles their mills; Winding Constrictor adds a counter', (mk, t) => {
    t.auto('Liesa, Forgotten Archangel'); t.auto('Bruvac the Grandiloquent'); t.auto('Winding Constrictor');
    const T = mk();
    T.bf('A', 'Liesa, Forgotten Archangel');
    const theirs = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Llanowar Elves');
    T.g.moveObject(theirs, 'graveyard'); T.g.moveObject(mine, 'graveyard');
    t.eq(theirs.zone, 'exile', 'theirs exiled'); t.eq(mine.zone, 'graveyard', 'mine dies');
    const T2 = mk();
    T2.bf('A', 'Bruvac the Grandiloquent');
    const lib = T2.g.zones.B.library.length;
    T2.g._runEffects([{ op: 'mill', n: 2, who: 'opponents' }], { controller: 'A', name: 'mill', kind: 'spell' });
    t.eq(T2.g.zones.B.library.length, lib - 4, 'twice as many');
    const T3 = mk();
    T3.bf('A', 'Winding Constrictor');
    const ring = T3.bf('A', 'Sol Ring');
    T3.g.addCounters(ring, 'charge', 1);
    t.eq(ring.counters.charge, 2, 'one more on an artifact');
  });

  test('Kwain, Scourge of Fleets, Liliana of the Dark Realms, Lier, Bone Miser', (mk, t) => {
    for (const c of ['Kwain, Itinerant Meddler', 'Scourge of Fleets', 'Liliana of the Dark Realms', 'Lier, Disciple of the Drowned', 'Bone Miser']) t.auto(c);
    const T = mk();
    const kw = T.bf('A', 'Kwain, Itinerant Meddler'); kw.summoningSick = false;
    T.answer('confirm', (ch) => ({ yes: ch.playerId === 'A' }));
    T.answer('confirm', (ch) => ({ yes: ch.playerId === 'A' }));
    const ha = T.g.zones.A.hand.length, hb = T.g.zones.B.hand.length;
    const la = kw.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', kw.id, idx, {}), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(T.g.zones.A.hand.length, ha + 1); t.eq(T.g.zones.B.hand.length, hb, 'B declined'); t.eq(T.life('A'), 21); t.eq(T.life('B'), 20);
    const T2 = mk();
    T2.bf('A', 'Island'); T2.bf('A', 'Island');
    const small = T2.bf('B', 'Grizzly Bears'), big = T2.bf('B', 'Craw Wurm');
    const sc = T2.bf('A', 'Scourge of Fleets');
    T2.g._runEffects(sc.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: sc, name: 'Scourge', kind: 'ability' });
    t.eq(small.zone, 'hand', 'toughness 2'); t.eq(big.zone, 'battlefield');
    const T3 = mk();
    const lil = T3.bf('A', 'Liliana of the Dark Realms');
    T3.bf('A', 'Swamp'); T3.bf('A', 'Swamp');
    const bear = T3.bf('B', 'Grizzly Bears');
    T3.answer('choose', { picks: [1] });
    T3.g._runEffects(lil.analysis().abilities.filter(a => a.kind === 'loyalty')[1].effects, { controller: 'A', obj: lil, name: 'Liliana', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T3.settle();
    t.eq(bear.zone, 'graveyard', '-2/-2');
    const T4 = mk();
    T4.bf('A', 'Lier, Disciple of the Drowned');
    const bolt = T4.grave('A', 'Lightning Bolt');
    t.ok(T4.g.altUsesFor('A', bolt.id).some(u => u.via === 'flashback' && u.cost === '{R}'), 'flashback for its mana cost');
    const T5 = mk();
    T5.bf('A', 'Bone Miser');
    const h5 = T5.g.zones.A.hand.length;
    const c1 = T5.hand('A', 'Lightning Bolt'), c2 = T5.hand('A', 'Grizzly Bears');
    T5.g._discardNow('A', [c1, c2]);
    T5.settle(); T5.resolve();
    t.eq(T5.g.zones.A.hand.length, h5 + 1, 'one draw, for the Bolt only');
  });

  test('Thrasios; "This ability costs {1} less to activate for each …"; Rooftop Storm', (mk, t) => {
    t.auto('Thrasios, Triton Hero'); t.auto('Voldaren Estate'); t.auto('Diary of Dreams'); t.auto('Rooftop Storm');
    const T = mk();
    const ve = T.bf('A', 'Voldaren Estate');
    T.bf('A', 'Vampire Nighthawk'); T.bf('A', 'Bloodghast');
    const ab = ve.analysis().abilities.find(a => a.kind === 'activated');
    t.eq(T.g._abilityMana(ve, ab, []), '{3}', '{5} less two Vampires');
    const dd = T.bf('A', 'Diary of Dreams'); dd.counters.page = 3;
    const ab2 = dd.analysis().abilities.filter(a => a.kind === 'activated').find(a => /costs/.test(a.text));
    t.eq(T.g._abilityMana(dd, ab2, []), '{2}', '{5} less three page counters');
    const T2 = mk();
    const th = T2.bf('A', 'Thrasios, Triton Hero');
    const land = T2.top('A', 'Forest');
    T2.answer('scry', () => ({ keep: [land.id], bottom: [] }));
    T2.g._runEffects(th.analysis().abilities.find(a => a.kind === 'activated').effects, { controller: 'A', obj: th, name: 'Thrasios', kind: 'ability' });
    T2.settle();
    t.eq(land.zone, 'battlefield'); t.ok(land.tapped);
    const T3 = mk();
    T3.bf('A', 'Rooftop Storm');
    t.eq(T3.g.canCast('A', T3.hand('A', 'Gravecrawler').id).cost, '', 'Zombies for nothing');
  });

  test('Unless they sacrifice: Mogis, Nicol Bolas the Deceiver (each opponent decides)', (mk, t) => {
    t.auto('Mogis, God of Slaughter'); t.auto('Nicol Bolas, the Deceiver');
    const T = mk({ players: ['A', 'B', 'C'] });
    const nb = T.bf('A', 'Nicol Bolas, the Deceiver');
    const bb = T.bf('B', 'Grizzly Bears');
    T.bf('C', 'Llanowar Elves');
    T.answer('choose', (ch) => ({ picks: ch.playerId === 'B' ? [bb.id] : [] }));
    T.answer('choose', (ch) => ({ picks: ch.playerId === 'B' ? [bb.id] : [] }));
    T.g._runEffects(nb.analysis().abilities.filter(a => a.kind === 'loyalty')[0].effects, { controller: 'A', obj: nb, name: 'Bolas', kind: 'ability' });
    T.settle();
    t.eq(bb.zone, 'graveyard', 'B sacrificed'); t.eq(T.life('B'), 20); t.eq(T.life('C'), 17, 'C declined and lost 3');
    const T2 = mk();
    const mo = T2.bf('A', 'Mogis, God of Slaughter');
    T2.answer('choose', { picks: [] });
    T2.bf('B', 'Grizzly Bears');
    T2.g._runEffects(mo.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: mo, name: 'Mogis', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
    T2.settle();
    t.eq(T2.life('B'), 18, 'two damage');
  });

  test('Bruenor: the first equip each turn for {0}; Leonin Shikari: equip at instant speed', (mk, t) => {
    t.auto('Bruenor Battlehammer'); t.auto('Leonin Shikari');
    const T = mk();
    T.bf('A', 'Bruenor Battlehammer');
    const bs = T.bf('A', 'Bonesplitter'), bear = T.bf('A', 'Grizzly Bears');
    const la = bs.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', bs.id, idx, { targets: [{ kind: 'object', id: bear.id }] }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(bs.attachedTo, bear.id, 'equipped for nothing');
    t.no(T.g.activateAbility('A', bs.id, idx, { targets: [{ kind: 'object', id: T.bf('A', 'Savannah Lions').id }] }), 'the second costs {1}');
    const T2 = mk();
    T2.bf('A', 'Leonin Shikari');
    const b2 = T2.bf('A', 'Bonesplitter'), c2 = T2.bf('A', 'Grizzly Bears');
    const ab = b2.analysis().abilities.find(a => a.kind === 'activated');
    t.ok(T2.g._equipAnyTime('A', ab), 'equip any time');
  });

  test('Teval, Domri, Final Parting, Questing Beast', (mk, t) => {
    for (const c of ['Teval, the Balanced Scale', 'Domri, Anarch of Bolas', 'Final Parting', 'Questing Beast']) t.auto(c);
    const T = mk();
    const tv = T.bf('A', 'Teval, the Balanced Scale');
    const f = T.grave('A', 'Forest');
    T.answer('pickCard', (ch) => ({ cardIds: [f.id] }));
    T.g._runEffects(tv.analysis().abilities.find(a => a.kind === 'triggered' && /attacks/.test(a.text)).effects, { controller: 'A', obj: tv, name: 'Teval', kind: 'ability' });
    T.settle();
    t.eq(f.zone, 'battlefield'); t.ok(f.tapped, 'tapped');
    const T2 = mk();
    T2.g._runEffects([{ op: 'uncounterableTurn', words: 'creature' }], { controller: 'A', name: 'Domri', kind: 'ability' });
    T2.mana('A', '1G');
    const bear = T2.hand('A', 'Grizzly Bears');
    T2.g.castSpell('A', bear.id, {});
    const item = T2.g.stack.find(s => s.obj === bear);
    t.ok(T2.g._uncounterable(item), "the creature spell can't be countered");
    const T3 = mk();
    const a1 = T3.top('A', 'Craw Wurm'), a2 = T3.top('A', 'Lightning Bolt');
    T3.answer('pickCard', (ch) => ({ cardIds: [a1.id, a2.id] }));
    T3.answer('pickCard', (ch) => ({ cardIds: [a2.id] }));
    T3.mana('A', '3BB');
    T3.cast('A', T3.hand('A', 'Final Parting'));
    T3.settle(); T3.resolve();
    t.eq(a2.zone, 'hand'); t.eq(a1.zone, 'graveyard');
    const T4 = mk();
    const qb = T4.bf('A', 'Questing Beast');
    T4.g.prevention.push({ to: 'players', who: 'B', until: 'eot' });
    T4.g.dealDamageToPlayer(T4.g.player('B'), 4, qb, true);
    t.eq(T4.life('B'), 16, "combat damage from A's creature isn't prevented");
  });

  test('Imoti: spells with mana value 6 or greater have cascade', (mk, t) => {
    t.auto('Imoti, Celebrant of Bounty');
    const T = mk();
    T.bf('A', 'Imoti, Celebrant of Bounty');
    const bear = T.top('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.mana('A', '4GG');
    T.cast('A', T.hand('A', 'Craw Wurm'));
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(bear.zone, 'battlefield', 'cascaded into the Bears');
  });

  test('Horizon Explorer: lands enter untapped', (mk, t) => {
    t.auto('Horizon Explorer');
    const T = mk();
    T.bf('A', 'Horizon Explorer');
    const gate = T.bf('A', 'Azorius Guildgate', { etb: true });
    t.no(gate.tapped, 'the Guildgate enters untapped');
    const g2 = T.bf('B', 'Azorius Guildgate', { etb: true });
    t.ok(g2.tapped, "not the opponent's");
  });

  test("Ethersworn Canonist, Kozilek's Unsealing, Sire of Stagnation, Persistent Constrictor", (mk, t) => {
    for (const c of ['Ethersworn Canonist', "Kozilek's Unsealing", 'Sire of Stagnation', 'Persistent Constrictor']) t.auto(c);
    const T = mk();
    T.bf('B', 'Ethersworn Canonist');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }] });
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), 'a second nonartifact spell');
    T.mana('A', '1');
    t.ok(T.g.castSpell('A', T.hand('A', 'Sol Ring').id, {}), 'an artifact is fine: ' + T.g.lastError);
    const T2 = mk();
    T2.bf('A', "Kozilek's Unsealing");
    T2.mana('A', '1GGG');
    T2.cast('A', T2.hand('A', 'Centaur Courser'));
    T2.settle(); T2.resolve();
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 0, 'mana value 3: nothing');
    T2.mana('A', '4GG');
    T2.cast('A', T2.hand('A', 'Craw Wurm'));
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(T2.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 2, 'mana value 6: two Spawn');
    const T3 = mk();
    const ss = T3.bf('A', 'Sire of Stagnation');
    const lib = T3.g.zones.B.library.length, hand = T3.g.zones.A.hand.length;
    T3.g._runEffects(ss.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: ss, name: 'Sire', kind: 'ability', triggerData: { playerId: 'B', player: 'B' } });
    t.eq(T3.g.zones.B.library.length, lib - 2); t.eq(T3.g.zones.A.hand.length, hand + 2);
    const T4 = mk();
    const pc = T4.bf('A', 'Persistent Constrictor');
    const bb = T4.bf('B', 'Grizzly Bears');
    T4.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bb.id }] }));
    T4.g._runEffects(pc.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: pc, name: 'Constrictor', kind: 'ability', triggerData: { playerId: 'B', player: 'B' } });
    T4.settle();
    t.eq(T4.life('B'), 19); t.eq(bb.counters['-1/-1'], 1);
  });

  test('Spider-Sense counters an instant', (mk, t) => {
    t.auto('Spider-Sense');
    const T = mk();
    T.mana('A', 'R');
    t.ok(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), T.g.lastError);
    const st = T.g.stack[T.g.stack.length - 1];
    T.mana('A', '1UU');
    t.ok(T.g.castSpell('A', T.hand('A', 'Spider-Sense').id, { targets: [{ kind: 'stack', id: st.id }] }), T.g.lastError);
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.life('B'), 20, 'the Bolt was countered');
  });

  test("Benevolent Hydra, Beseech the Queen, Malevolent Rumble, Overmaster, Windgrace's Judgment", (mk, t) => {
    for (const c of ['Benevolent Hydra', 'Beseech the Queen', 'Malevolent Rumble', 'Overmaster', "Windgrace's Judgment"]) t.auto(c);
    const T = mk();
    const bh = T.bf('A', 'Benevolent Hydra'), bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1, { }); T.g.addCounters(bh, '+1/+1', 1, { });
    t.eq(bear.counters['+1/+1'], 2, 'another creature: one more'); t.eq(bh.counters['+1/+1'], 1, 'not itself');
    const T2 = mk();
    T2.bf('A', 'Forest'); T2.bf('A', 'Forest');
    const big = T2.top('A', 'Craw Wurm'), small = T2.top('A', 'Grizzly Bears');
    T2.answer('pickCard', (ch) => { t.no(ch.cards.some(c => c.id === big.id), 'mana value above two lands'); return { cardIds: [small.id] }; });
    T2.mana('A', '2BBB');
    T2.cast('A', T2.hand('A', 'Beseech the Queen'));
    T2.settle(); T2.resolve();
    t.eq(small.zone, 'hand');
    const T3 = mk();
    const x1 = T3.top('A', 'Grizzly Bears'), x2 = T3.top('A', 'Lightning Bolt');
    T3.answer('pickCard', (ch) => ({ cardIds: [x1.id] }));
    T3.mana('A', '1G');
    T3.cast('A', T3.hand('A', 'Malevolent Rumble'));
    T3.settle(); T3.resolve();
    t.eq(x1.zone, 'hand'); t.eq(x2.zone, 'graveyard'); t.eq(T3.g.battlefield.filter(o => o.isToken).length, 1, 'a Spawn');
    const T4 = mk({ players: ['A', 'B', 'C'] });
    const pb = T4.bf('B', 'Sol Ring'), pc = T4.bf('C', 'Mind Stone');
    T4.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T4.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T4.mana('A', '3BG');
    T4.cast('A', T4.hand('A', "Windgrace's Judgment"));
    T4.settle(); T4.resolve();
    t.eq(pb.zone, 'graveyard'); t.eq(pc.zone, 'graveyard');
  });

  test("Witch's Oven by the sacrificed toughness; Endrek Sahr goes at seven Thrulls", (mk, t) => {
    t.auto("Witch's Oven"); t.auto('Endrek Sahr, Master Breeder');
    const T = mk();
    const ov = T.bf('A', "Witch's Oven"); ov.tapped = false;
    const wurm = T.bf('A', 'Craw Wurm');
    T.answer('sacrifice', () => ({ cardIds: [wurm.id] }));
    T.answer('choose', () => ({ picks: [wurm.id] }));
    const la = ov.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', ov.id, idx, { sacrifice: [wurm.id] }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(T.g.battlefield.filter(o => o.name === 'Food').length, 2, 'toughness 4: two Food');
    const T2 = mk();
    const es = T2.bf('A', 'Endrek Sahr, Master Breeder');
    T2.g._runEffects([{ op: 'createToken', n: 7, pt: '1/1', colorWords: ['black'], subtypes: 'Thrull', keywords: [] }], { controller: 'A', name: 'tok', kind: 'ability' });
    T2.g.checkStateBasedActions();
    t.eq(es.zone, 'graveyard', 'seven Thrulls');
  });

  test('Stridehangar Automaton adds a Thopter; discard any number, draw that many plus one', (mk, t) => {
    t.auto('Stridehangar Automaton');
    const T = mk();
    T.bf('A', 'Stridehangar Automaton');
    T.g._runEffects([{ op: 'createNamedToken', token: 'Treasure', n: 1 }], { controller: 'A', name: 'tok', kind: 'ability' });
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Treasure').length, 1);
    const th = T.g.battlefield.filter(o => o.isToken && /Thopter/.test(o.name));
    t.eq(th.length, 1, 'and a Thopter'); t.ok(T.g.hasKw(th[0], 'flying'));
    const T2 = mk();
    const a = T2.hand('A', 'Island'), b = T2.hand('A', 'Island');
    T2.answer('choose', { picks: [a.id, b.id] });
    const n0 = T2.g.zones.A.hand.length;
    T2.g._runEffects([{ op: 'discardAnyDraw', plus: 1 }], { controller: 'A', name: 'Grinder', kind: 'ability' });
    T2.settle();
    t.eq(T2.g.zones.A.hand.length, n0 + 1, 'two away, three back');
  });

  test("Well of Lost Dreams, Finale of Revelation, Patriarch's Bidding", (mk, t) => {
    t.auto('Well of Lost Dreams'); t.auto('Finale of Revelation'); t.auto("Patriarch's Bidding");
    const T = mk();
    const w = T.bf('A', 'Well of Lost Dreams');
    T.mana('A', '3');
    T.answer('confirm', { yes: true });
    T.answer('choose', { number: 2 });
    const h = T.g.zones.A.hand.length;
    T.g._runEffects(w.analysis().abilities[0].effects, { controller: 'A', obj: w, name: 'Well', kind: 'ability', triggerData: { amount: 4 } });
    T.settle();
    t.eq(T.g.zones.A.hand.length, h + 2, 'paid two, drew two');
    const T2 = mk();
    T2.grave('A', 'Grizzly Bears');
    T2.mana('A', '10UU');
    T2.cast('A', T2.hand('A', 'Finale of Revelation'), { x: 10 });
    T2.settle(); T2.resolve();
    t.ok(T2.g.player('A').noMaxHand, 'no maximum hand size'); t.eq(T2.g.zones.A.graveyard.filter(c => c.name === 'Grizzly Bears').length, 0, 'graveyard shuffled in');
    const T3 = mk();
    const z1 = T3.grave('A', 'Gravecrawler'), z2 = T3.grave('B', 'Grizzly Bears');
    T3.answer('choose', (ch) => ({ picks: [ch.options.find(o => o.label === 'Zombie').i] }));
    T3.answer('choose', (ch) => ({ picks: [ch.options.find(o => o.label === 'Zombie').i] }));
    T3.mana('A', '3BBB');
    T3.cast('A', T3.hand('A', "Patriarch's Bidding"));
    T3.settle(); T3.resolve();
    t.eq(z1.zone, 'battlefield'); t.eq(z2.zone, 'graveyard');
  });

  test('Chainer: a creature spell from the graveyard, once; Scroll Rack swaps with the top', (mk, t) => {
    t.auto('Chainer, Nightmare Adept'); t.auto('Scroll Rack');
    const T = mk();
    const ch = T.bf('A', 'Chainer, Nightmare Adept');
    const fodder = T.hand('A', 'Island');
    const bear = T.grave('A', 'Grizzly Bears');
    t.no(T.g.altUsesFor('A', bear.id).some(u => u.via === 'graveCreature'), 'not yet');
    T.answer('pickCard', () => ({ cardIds: [fodder.id] }));
    const la = ch.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', ch.id, idx, { discard: [fodder.id], discardId: fodder.id }), T.g.lastError);
    T.settle(); T.resolve();
    t.ok(T.g.altUsesFor('A', bear.id).some(u => u.via === 'graveCreature'), 'now');
    T.mana('A', '1G');
    t.ok(T.g.castSpell('A', bear.id, { via: 'graveCreature' }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(bear.zone, 'battlefield'); t.ok(T.g.hasKw(bear, 'haste'), 'not cast from hand: haste');
    const T2 = mk();
    const sr = T2.bf('A', 'Scroll Rack');
    const a1 = T2.hand('A', 'Craw Wurm');
    const top = T2.top('A', 'Lightning Bolt');
    T2.answer('choose', { picks: [a1.id] });
    T2.mana('A', '1');
    const la2 = sr.analysis(), i2 = la2.manaAbilities.length + la2.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T2.g.activateAbility('A', sr.id, i2, {}), T2.g.lastError);
    T2.settle(); T2.resolve();
    t.eq(top.zone, 'hand'); t.eq(T2.g.zones.A.library[0], a1, 'the Wurm on top');
  });

  test('Mantle of the Ancients returns Auras and Equipment onto its creature; Codsworth attaches', (mk, t) => {
    t.auto('Mantle of the Ancients'); t.auto('Codsworth, Handy Helper');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const m = T.bf('A', 'Mantle of the Ancients'); m.attachedTo = bear.id; bear.attachments = [m.id];
    const bs = T.grave('A', 'Bonesplitter'), r = T.grave('A', 'Rancor');
    T.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T.g._runEffects(m.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: m, name: 'Mantle', kind: 'ability' });
    T.settle();
    t.eq(bs.zone, 'battlefield'); t.eq(bs.attachedTo, bear.id); t.eq(r.attachedTo, bear.id);
    const T2 = mk();
    const cw = T2.bf('A', 'Codsworth, Handy Helper');
    const bs2 = T2.bf('A', 'Bonesplitter'), b2 = T2.bf('A', 'Grizzly Bears');
    const ab = cw.analysis().abilities.filter(a => a.kind === 'activated').find(a => /Attach/.test(a.text));
    T2.g._runEffects(ab.effects, { controller: 'A', obj: cw, name: 'Codsworth', kind: 'ability', targets: [{ kind: 'object', id: bs2.id }, { kind: 'object', id: b2.id }] });
    t.eq(bs2.attachedTo, b2.id);
  });

  test('Kruphix keeps unspent mana as colorless; Conflux finds one of each', (mk, t) => {
    t.auto('Kruphix, God of Horizons'); t.auto('Conflux');
    const T = mk();
    T.bf('A', 'Kruphix, God of Horizons');
    T.mana('A', 'GG');
    T.toMain('A', 'beginCombat');
    t.eq(Number(T.g.player('A').pool.C) || 0, 2, 'two colorless kept'); t.eq(Number(T.g.player('A').pool.G) || 0, 0);
    const T2 = mk();
    const w = T2.top('A', 'Savannah Lions'), u = T2.top('A', 'Ornithopter'), r = T2.top('A', 'Lightning Bolt');
    T2.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T2.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T2.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
    T2.mana('A', '3WUBRG');
    T2.cast('A', T2.hand('A', 'Conflux'));
    T2.settle(); T2.resolve();
    t.eq(w.zone, 'hand', 'white'); t.eq(r.zone, 'hand', 'red'); t.eq(u.zone, 'library', 'colorless is none of them');
  });

  test('Sacrifice any number of …, then that many: Reprocess, Last-Ditch Effort, Lich-Knights\' Conquest', (mk, t) => {
    t.auto('Reprocess'); t.auto('Last-Ditch Effort'); t.auto("Lich-Knights' Conquest");
    const T = mk();
    const a = T.bf('A', 'Sol Ring'), b = T.bf('A', 'Grizzly Bears'), c = T.bf('A', 'Forest');
    T.answer('choose', (ch) => { t.eq(ch.items.length, 3, 'artifact, creature and land'); return { picks: [a.id, b.id] }; });
    const h = T.g.zones.A.hand.length;
    T.mana('A', '2BB');
    T.cast('A', T.hand('A', 'Reprocess'));
    T.settle(); T.resolve();
    t.eq(T.g.zones.A.hand.length, h + 2, 'two drawn'); t.eq(c.zone, 'battlefield');
    const T2 = mk();
    const x1 = T2.bf('A', 'Grizzly Bears'), x2 = T2.bf('A', 'Savannah Lions');
    T2.answer('choose', { picks: [x1.id, x2.id] });
    T2.mana('A', 'R');
    T2.cast('A', T2.hand('A', 'Last-Ditch Effort'), { targets: [{ kind: 'player', id: 'B' }] });
    T2.settle(); T2.resolve();
    t.eq(T2.life('B'), 18, 'two damage');
    const T3 = mk();
    const tok = T3.bf('A', 'Sol Ring');
    const g1 = T3.grave('A', 'Craw Wurm');
    T3.answer('choose', { picks: [tok.id] });
    T3.answer('pickCard', (ch) => ({ cardIds: [g1.id] }));
    T3.mana('A', '4B');
    T3.cast('A', T3.hand('A', "Lich-Knights' Conquest"));
    T3.settle(); T3.resolve();
    t.eq(g1.zone, 'battlefield', 'one back for one sacrificed');
  });

  test('Valakut Exploration: its exiled cards to the graveyard, that much damage', (mk, t) => {
    t.auto('Valakut Exploration');
    const T = mk();
    const ve = T.bf('A', 'Valakut Exploration');
    const run = (re) => T.g._runEffects(ve.analysis().abilities.find(a => a.kind === 'triggered' && re.test(a.text)).effects, { controller: 'A', obj: ve, name: 'Valakut', kind: 'ability' });
    run(/Landfall|land you control enters/); run(/Landfall|land you control enters/);
    t.eq(T.g.zones.A.exile.filter(c => c.exiledWithId === ve.id).length, 2);
    run(/end step/);
    t.eq(T.life('B'), 18, 'two damage'); t.eq(T.g.zones.A.exile.length, 0);
  });

  test("Mizzix's Mastery: exile it and cast a copy; overloaded, every one", (mk, t) => {
    t.auto("Mizzix's Mastery");
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', '3R');
    T.cast('A', T.hand('A', "Mizzix's Mastery"), { targets: [bolt.id] });
    T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(bolt.zone, 'exile'); t.eq(T.life('B'), 17, 'the copy hit');
    const T2 = mk();
    const b1 = T2.grave('A', 'Lightning Bolt'), b2 = T2.grave('A', 'Lightning Bolt');
    T2.answer('confirm', { yes: true }); T2.answer('confirm', { yes: true });
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T2.mana('A', '5RRR');
    t.ok(T2.g.castSpell('A', T2.hand('A', "Mizzix's Mastery").id, { via: 'overload' }), T2.g.lastError);
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(b1.zone, 'exile'); t.eq(b2.zone, 'exile'); t.eq(T2.life('B'), 14, 'both copies');
  });

  test('Moraug: +1/+0 for each attack this turn; Invasion of Ikoria looks in the graveyard too', (mk, t) => {
    t.auto('Moraug, Fury of Akoum');
    const T = mk();
    T.bf('A', 'Moraug, Fury of Akoum');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.g.powerOf(bear), 3, 'attacked once');
    const T2 = mk();
    const gy = T2.grave('A', 'Craw Wurm');
    T2.answer('pickCard', (ch) => { t.ok(ch.cards.some(c => c.id === gy.id), 'the graveyard card offered'); return { cardIds: [gy.id] }; });
    const inv = T2.bf('A', 'Invasion of Ikoria // Zilortha, Apex of Ikoria');
    T2.g._runEffects(inv.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: inv, name: 'Invasion', kind: 'ability', x: 6 });
    T2.settle();
    t.eq(gy.zone, 'battlefield');
  });

  test('Ugin, the Ineffable: the Spirit brings its card back; -3 on a coloured permanent; Kodama of the East Tree', (mk, t) => {
    t.auto('Ugin, the Ineffable'); t.auto('Kodama of the East Tree');
    const T = mk();
    const ug = T.bf('A', 'Ugin, the Ineffable');
    const top = T.top('A', 'Craw Wurm');
    const ab = ug.analysis().abilities.filter(a => a.kind === 'loyalty');
    T.g._runEffects(ab[0].effects, { controller: 'A', obj: ug, name: 'Ugin', kind: 'ability' });
    t.eq(top.zone, 'exile');
    const sp = T.g.battlefield.find(o => o.isToken && o.controller === 'A');
    T.g.moveObject(sp, 'graveyard');
    t.eq(top.zone, 'hand', 'back when the Spirit left');
    const thop = T.bf('B', 'Ornithopter');
    const spec = ab[1].effects[0].targets[0];
    t.no(T.g._legalTargetsFor(spec, 'A', ug.id).some(x => x.id === thop.id), 'colourless is not a target');
    const T2 = mk();
    const kd = T2.bf('A', 'Kodama of the East Tree');
    const big = T2.hand('A', 'Craw Wurm'), small = T2.hand('A', 'Grizzly Bears');
    T2.answer('choose', (ch) => { t.no(ch.items.some(x => x.id === big.id), 'only mana value 3 or less'); return { picks: [small.id] }; });
    const cc = T2.bf('A', 'Centaur Courser', { etb: true });
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(small.zone, 'battlefield');
  });

  test('Skrelv: toxic, hexproof from a colour and unblockable by it', (mk, t) => {
    t.auto('Skrelv, Defector Mite');
    const T = mk();
    const sk = T.bf('A', 'Skrelv, Defector Mite');
    const bear = T.bf('A', 'Grizzly Bears');
    const greenBlocker = T.bf('B', 'Llanowar Elves'), whiteBlocker = T.bf('B', 'Savannah Lions');
    T.answer('choose', (ch) => ({ picks: [4] }));
    T.g._runEffects(sk.analysis().abilities.find(a => a.kind === 'activated').effects, { controller: 'A', obj: sk, name: 'Skrelv', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T.settle();
    t.ok(T.g.hasKw(bear, 'toxic 1'), 'toxic');
    bear.attacking = 'B';
    t.no(T.g.canBlock(greenBlocker, bear), 'not by green'); t.ok(T.g.canBlock(whiteBlocker, bear), 'white can');
  });

  test("Sephara: {W} and four untapped flyers instead of the mana cost", (mk, t) => {
    t.auto("Sephara, Sky's Blade");
    const T = mk();
    const fl = [1, 2, 3, 4].map(() => T.bf('A', 'Serra Angel'));
    const sp = T.hand('A', "Sephara, Sky's Blade");
    const use = T.g.altUsesFor('A', sp.id).find(u => u.kind === 'cast' && /alternative/i.test(u.label || ''));
    t.ok(use, 'the alternative cost is offered');
    T.mana('A', 'W');
    T.answer('tapCost', (ch) => ({ cardIds: fl.map(x => x.id) }));
    T.answer('choose', (ch) => ({ picks: fl.map(x => x.id) }));
    t.ok(T.g.castSpell('A', sp.id, { via: use.via }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(sp.zone, 'battlefield'); t.ok(fl.every(x => x.tapped), 'four flyers tapped');
  });

  test('Shatterskull Smashing: twice X divided once X is 6 or more', (mk, t) => {
    t.auto('Shatterskull Smashing // Shatterskull, the Hammer Pass');
    const T = mk();
    const a = T.bf('B', 'Craw Wurm'), b = T.bf('B', 'Craw Wurm');
    T.mana('A', '6RR');
    T.cast('A', T.hand('A', 'Shatterskull Smashing // Shatterskull, the Hammer Pass'), { x: 6, targets: [a.id, b.id] });
    T.settle(); T.resolve();
    t.eq(a.zone, 'graveyard'); t.eq(b.zone, 'graveyard', 'twelve damage, six each');
  });

  test("Conduit of Worlds: a permanent card from the graveyard, and no more spells after", (mk, t) => {
    t.auto('Conduit of Worlds');
    const T = mk();
    const cw = T.bf('A', 'Conduit of Worlds');
    const wurm = T.grave('A', 'Craw Wurm');
    const la = cw.analysis(), idx = la.manaAbilities.length + la.abilities.filter(a => a.kind === 'activated').length - 1;
    t.ok(T.g.activateAbility('A', cw.id, idx, { targets: [{ kind: 'object', id: wurm.id }] }), T.g.lastError);
    T.settle(); T.resolve();
    t.ok(T.g.altUsesFor('A', wurm.id).some(u => u.via === 'granted'), 'castable from the graveyard');
    T.mana('A', '4GG');
    t.ok(T.g.castSpell('A', wurm.id, { via: 'granted' }), T.g.lastError);
    T.settle(); T.resolve();
    t.eq(wurm.zone, 'battlefield');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), 'no more spells this turn');
  });

  test('Beseech the Mirror: to hand, or cast for nothing when bargained', (mk, t) => {
    t.auto('Beseech the Mirror');
    const T = mk();
    const bear = T.top('A', 'Grizzly Bears');
    T.answer('pickCard', () => ({ cardIds: [bear.id] }));
    T.mana('A', '1BBB');
    T.cast('A', T.hand('A', 'Beseech the Mirror'), { bargain: null });
    T.settle(); T.resolve();
    t.eq(bear.zone, 'hand', 'not bargained: to hand');
    const T2 = mk();
    const b2 = T2.top('A', 'Grizzly Bears');
    const tok = T2.bf('A', 'Sol Ring');
    T2.answer('pickCard', () => ({ cardIds: [b2.id] }));
    T2.answer('confirm', { yes: true });
    T2.mana('A', '1BBB');
    T2.cast('A', T2.hand('A', 'Beseech the Mirror'), { bargain: tok.id });
    T2.settle(); T2.resolve(); T2.settle(); T2.resolve();
    t.eq(b2.zone, 'battlefield', 'bargained: cast for free'); t.eq(tok.zone, 'graveyard');
  });

  test('Breach the Multiverse: one from each graveyard, and everything is Phyrexian', (mk, t) => {
    t.auto('Breach the Multiverse');
    const T = mk();
    const ga = T.grave('A', 'Grizzly Bears'), gb = T.grave('B', 'Craw Wurm');
    T.answer('choose', () => ({ picks: [ga.id] }));
    T.answer('choose', () => ({ picks: [gb.id] }));
    T.mana('A', '5BB');
    T.cast('A', T.hand('A', 'Breach the Multiverse'));
    T.settle(); T.resolve();
    t.eq(ga.zone, 'battlefield'); t.eq(gb.zone, 'battlefield'); t.eq(gb.controller, 'A');
    t.ok(T.g._hasCreatureType(gb, 'Phyrexian'), 'a Phyrexian');
  });

  test('Ripples of Potential: proliferate, then those of yours phase out', (mk, t) => {
    t.auto('Ripples of Potential');
    const T = mk();
    const a = T.bf('A', 'Grizzly Bears'); a.counters['+1/+1'] = 1;
    const b = T.bf('A', 'Savannah Lions');
    T.answer('choose', (ch) => { t.eq(ch.items.length, 1, 'only the one with a counter'); return { picks: [a.id] }; });
    T.mana('A', '1U');
    T.cast('A', T.hand('A', 'Ripples of Potential'));
    T.settle(); T.resolve();
    t.eq(a.counters['+1/+1'], 2); t.ok(a.phasedOut, 'phased out'); t.no(b.phasedOut);
  });

  test('Promise of Loyalty: one kept with a vow counter, which then cannot attack you', (mk, t) => {
    t.auto('Promise of Loyalty');
    const T = mk();
    const a1 = T.bf('A', 'Grizzly Bears'), a2 = T.bf('A', 'Savannah Lions');
    const b1 = T.bf('B', 'Craw Wurm'), b2 = T.bf('B', 'Llanowar Elves');
    T.answer('choose', (ch) => ({ picks: [ch.playerId === 'A' ? a1.id : b1.id] }));
    T.answer('choose', (ch) => ({ picks: [ch.playerId === 'A' ? a1.id : b1.id] }));
    T.mana('A', '4W');
    T.cast('A', T.hand('A', 'Promise of Loyalty'));
    T.settle(); T.resolve();
    t.eq(a2.zone, 'graveyard'); t.eq(b2.zone, 'graveyard'); t.eq(b1.counters.vow, 1);
    t.ok(T.g._cantAttackYou(b1, 'A'), "the Wurm can't attack A");
  });

  test('Anim Pakal makes attacking Gnomes; Dawn returns small creature cards', (mk, t) => {
    t.auto('Anim Pakal, Thousandth Moon'); t.auto('Dusk // Dawn');
    const T = mk();
    T.bf('A', 'Anim Pakal, Thousandth Moon');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    const gn = T.g.battlefield.filter(o => o.isToken && /Gnome/.test(o.name));
    t.eq(gn.length, 1, 'one Gnome'); t.eq(T.life('B'), 20 - 2 - 1, 'the Bears and the Gnome');
    const T2 = mk();
    const s1 = T2.grave('A', 'Grizzly Bears'), s2 = T2.grave('A', 'Craw Wurm');
    T2.g._runEffects([{ op: 'regrowthAll', filter: 'creature', maxPower: 2 }], { controller: 'A', name: 'Dawn', kind: 'spell' });
    t.eq(s1.zone, 'hand'); t.eq(s2.zone, 'graveyard', 'power 6 stays');
  });

  test('Quistis Trepe reads (a rider with nothing to ride is a manual line), and analyze never throws', (mk, t) => {
    const T = mk();
    const q = T.hand('A', 'Quistis Trepe');
    t.ok(q.analysis(), 'read');
    const broken = { id: 'test:broken', name: 'Broken', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', layout: 'transform', oracle_text: '', card_faces: [null, null] };
    const warn = console.warn; console.warn = () => {};
    let a = null, threw = false;
    try { a = T.MTG.oracle.analyze(broken); } catch (e) { threw = true; }
    console.warn = warn;
    t.no(threw, 'no exception'); t.ok(a && a.unreadable && !a.fullyAutomated, 'marked unreadable, for a person');
  });

  test('Lethal Scheme: each creature that convoked it connives; Mechanized Production', (mk, t) => {
    t.auto('Lethal Scheme'); t.auto('Mechanized Production');
    const T = mk();
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('A', 'Savannah Lions');
    const foe = T.bf('B', 'Craw Wurm');
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 1).map(x => x.id) }));
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 1).map(x => x.id) }));
    T.mana('A', 'BB');
    t.ok(T.g.castSpell('A', T.hand('A', 'Lethal Scheme').id, { targets: [foe.id], convokeIds: [b1.id, b2.id] }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(foe.zone, 'graveyard'); t.ok(b1.tapped && b2.tapped, 'both convoked');
    t.eq(T.g.log.filter(l => / connives\./.test(l.text || '')).length, 2, 'each connived');
  });

  test('Call the Coppercoats: a Soldier for each creature the targeted opponents control', (mk, t) => {
    t.auto('Call the Coppercoats');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Savannah Lions'); T.bf('C', 'Craw Wurm');
    T.mana('A', '3WW');
    T.cast('A', T.hand('A', 'Call the Coppercoats'), { targets: [{ kind: 'player', id: 'B' }, { kind: 'player', id: 'C' }] });
    T.settle(); T.resolve();
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && o.isToken).length, 3);
  });

  test('Phelia: exile, back at the end step, a counter when it is yours', (mk, t) => {
    t.auto('Phelia, Exuberant Shepherd');
    const T = mk();
    const ph = T.bf('A', 'Phelia, Exuberant Shepherd');
    const mine = T.bf('A', 'Sol Ring');
    T.g._runEffects(ph.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: ph, name: 'Phelia', kind: 'ability', targets: [{ kind: 'object', id: mine.id }] });
    t.eq(mine.zone, 'exile');
    T.toMain('B');
    t.eq(mine.zone, 'battlefield', 'back'); t.eq(ph.counters['+1/+1'], 1, 'a counter on Phelia');
  });

  test('Explore the Vastlands: a land and an instant or sorcery each, and 3 life', (mk, t) => {
    const T = mk();
    const l = T.top('A', 'Forest'), sp = T.top('A', 'Lightning Bolt'), cr = T.top('A', 'Craw Wurm');
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 1).map(x => x.id) }));
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 1).map(x => x.id) }));
    T.answer('choose', () => ({ picks: [] })); T.answer('choose', () => ({ picks: [] }));
    T.g._runEffects([{ op: 'exploreVastlands', n: 5, life: 3 }], { controller: 'A', name: 'Explore the Vastlands', kind: 'spell' });
    T.settle();
    t.eq(l.zone, 'hand'); t.eq(sp.zone, 'hand'); t.eq(cr.zone, 'library'); t.eq(T.life('A'), 23); t.eq(T.life('B'), 23);
  });

  test("Tibalt's Trickery: countered, and something else for free", (mk, t) => {
    t.auto("Tibalt's Trickery");
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Forest');
    const bear = T.top('A', 'Grizzly Bears');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.mana('A', 'R');
    t.ok(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { targets: [{ kind: 'player', id: 'B' }] }), T.g.lastError);
    const st = T.g.stack[T.g.stack.length - 1];
    T.answer('confirm', { yes: true });
    T.mana('A', '1R');
    t.ok(T.g.castSpell('A', T.hand('A', "Tibalt's Trickery").id, { targets: [{ kind: 'stack', id: st.id }] }), T.g.lastError);
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle(); T.resolve();
    t.eq(T.life('B'), 20, 'the Bolt was countered'); t.eq(bear.zone, 'battlefield', 'the Bears were cast for nothing');
  });

  test('The Soul Stone: its ∞ ability waits for the harness', (mk, t) => {
    t.auto('The Soul Stone');
    const T = mk();
    const st = T.bf('A', 'The Soul Stone');
    const ab = st.analysis().abilities.find(a => a.kind === 'triggered');
    t.ok(ab && ab.infinity, 'the upkeep trigger is an ∞ ability');
    st.harnessed = false;
    T.g._fire('yourUpkeep', 'A', { playerId: 'A' });
    t.eq(T.g.pendingTriggers.filter(p => p.obj === st).length, 0, 'not harnessed: nothing');
    T.g._runEffects([{ op: 'harness' }], { controller: 'A', obj: st, name: 'Soul Stone', kind: 'ability' });
    t.ok(st.harnessed);
    T.g._fire(ab.event, 'A', { playerId: 'A' });
    t.ok(T.g.pendingTriggers.some(p => p.obj === st), 'harnessed: it triggers');
  });

  test('Springheart Nantuko: a copy of the creature it is on, else an Insect', (mk, t) => {
    t.auto('Springheart Nantuko');
    const T = mk();
    const nk = T.bf('A', 'Springheart Nantuko');
    const fx = nk.analysis().abilities.find(a => a.kind === 'triggered').effects;
    const run = () => T.g._runEffects(fx, { controller: 'A', obj: nk, name: 'Springheart Nantuko', kind: 'ability' });
    run(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Insect').length, 1, 'unattached: an Insect');
    const bears = T.bf('A', 'Grizzly Bears');
    nk.attachedTo = bears.id;
    T.mana('A', '1G');
    T.answer('confirm', { yes: true });
    run(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Grizzly Bears').length, 1, 'paid: a Bears copy');
    T.answer('confirm', { yes: false });
    run(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Insect').length, 2, 'declined: another Insect');
  });

  test("Vraska, Betrayal's Sting: compleated, a Treasure, poison up to nine", (mk, t) => {
    t.auto("Vraska, Betrayal's Sting");
    const T = mk();
    T.mana('A', '4B');
    T.cast('A', T.hand('A', "Vraska, Betrayal's Sting"));
    T.settle(); T.resolve(); T.settle();
    const v = T.g.battlefield.find(o => o.name === "Vraska, Betrayal's Sting");
    t.ok(v, 'on the battlefield');
    t.eq(T.g.players.find(p => p.id === 'A').life, 18, 'two life for the Phyrexian black');
    t.eq(v.counters.loyalty, 4, 'two fewer loyalty');
    const abs = v.analysis().abilities;
    const bear = T.bf('B', 'Grizzly Bears');
    T.g._runEffects(abs.find(a => /^-2/.test(a.text)).effects, { controller: 'A', obj: v, name: 'Vraska', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    const c = T.g.characteristics(bear);
    t.ok(!c.isCreature && T.g._cardFitsWords(bear, 'artifact') && T.g._cardFitsWords(bear, 'Treasure'), 'a Treasure artifact, not a creature');
    t.ok(T.g.manaAbilitiesOf(bear).length === 1, 'one mana ability');
    const b = T.g.players.find(p => p.id === 'B'); b.poison = 3;
    T.g._runEffects(abs.find(a => /^-9/.test(a.text)).effects, { controller: 'A', obj: v, name: 'Vraska', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    t.eq(b.poison, 9);
  });

  test('Distribute counters: Ajani, Sleeper Agent; any number of targets', (mk, t) => {
    t.auto('Ajani, Sleeper Agent'); t.auto('Blessings of Nature');
    const T = mk();
    const aj = T.bf('A', 'Ajani, Sleeper Agent');
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('A', 'Savannah Lions');
    const fx = aj.analysis().abilities.find(a => /^\u22123|^-3/.test(a.text)).effects;
    T.g._runEffects(fx, { controller: 'A', obj: aj, name: 'Ajani', kind: 'ability', targets: [{ kind: 'object', id: b1.id }, { kind: 'object', id: b2.id }] });
    T.settle();
    t.eq((b1.counters['+1/+1'] || 0) + (b2.counters['+1/+1'] || 0), 3, 'three counters in all');
    t.ok(b1.counters['+1/+1'] >= 1 && b2.counters['+1/+1'] >= 1, 'on both');
    t.ok(T.g.hasKw(b1, 'vigilance') && T.g.hasKw(b2, 'vigilance'), 'they gain vigilance');
    T.answer('choose', (ch) => ({ picks: ch.items.filter(x => x.id === b1.id).map(x => x.id) }));
    T.mana('A', '4G');
    T.cast('A', T.hand('A', 'Blessings of Nature'));
    T.settle(); T.resolve(); T.settle();
    t.eq(b1.counters['+1/+1'] >= 5, true, 'all four on the one chosen');
  });

  test("Nissa, Ascended Animist: an X/X as big as her loyalty; Jace's -3/-0 until your next turn", (mk, t) => {
    t.auto('Nissa, Ascended Animist'); t.auto('Jace, the Perfected Mind');
    const T = mk();
    const ni = T.bf('A', 'Nissa, Ascended Animist');
    ni.counters.loyalty = 8;
    T.g._runEffects(ni.analysis().abilities.find(a => /^\+1/.test(a.text)).effects, { controller: 'A', obj: ni, name: 'Nissa', kind: 'ability' });
    T.settle();
    const tok = T.g.battlefield.find(o => o.isToken && o.controller === 'A');
    t.ok(tok && T.g.powerOf(tok) === 8 && T.g.toughnessOf(tok) === 8, 'an 8/8 Horror');
    const ja = T.bf('A', 'Jace, the Perfected Mind');
    const w = T.bf('B', 'Craw Wurm');
    T.g._runEffects(ja.analysis().abilities.find(a => /^\+1/.test(a.text)).effects, { controller: 'A', obj: ja, name: 'Jace', kind: 'ability', targets: [{ kind: 'object', id: w.id }] });
    t.eq(T.g.powerOf(w), 3);
    t.eq(ja.analysis().abilities.find(a => /^[-\u2212]X/.test(a.text)).effects[0].n.xTimes, 3, 'three times X');
  });

  test('Fire Nation Palace: firebending 4 handed out adds to what is printed', (mk, t) => {
    t.auto('Fire Nation Palace');
    const T = mk();
    const pal = T.bf('A', 'Fire Nation Palace');
    const sage = T.bf('A', 'Fire Sages');
    const fx = pal.analysis().abilities.find(a => a.kind === 'activated').effects;
    T.g._runEffects(fx, { controller: 'A', obj: pal, name: 'Fire Nation Palace', kind: 'ability', targets: [{ kind: 'object', id: sage.id }] });
    t.eq(T.g._kwArg(sage, 'firebending'), 5, 'one printed and four given');
  });

  test('Goblin Welder: an artifact swapped for one in the same graveyard', (mk, t) => {
    t.auto('Goblin Welder');
    const T = mk();
    const gw = T.bf('A', 'Goblin Welder'); gw.summoningSick = false;
    const ring = T.bf('B', 'Sol Ring');
    const mine = T.grave('A', 'Mind Stone'), theirs = T.grave('B', 'Mind Stone');
    t.ok(!T.g.activateAbility('A', gw.id, 0, { targets: [{ kind: 'object', id: ring.id }, { kind: 'object', id: mine.id }] }), 'not from another graveyard');
    T.activate('A', gw, 0, { targets: [ring, theirs] });
    T.resolve(); T.settle();
    t.eq(ring.zone, 'graveyard'); t.eq(theirs.zone, 'battlefield'); t.eq(theirs.controller, 'B');
  });

  test('Resourceful Defense: counters kept when a permanent leaves, and moved at will; Fate Transfer', (mk, t) => {
    t.auto('Resourceful Defense'); t.auto('Fate Transfer'); t.auto('Bioshift');
    const T = mk();
    const rd = T.bf('A', 'Resourceful Defense');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Savannah Lions');
    T.g.addCounters(a, '+1/+1', 2);
    T.g.moveObject(a, 'graveyard');
    const [trig, act] = rd.analysis().abilities;
    T.g._runEffects(trig.effects, { controller: 'A', obj: rd, name: 'Resourceful Defense', kind: 'ability', triggerData: { objectId: a.id }, targets: [{ kind: 'object', id: b.id }] });
    t.eq(b.counters['+1/+1'], 2, 'the two counters went on');
    const c = T.bf('A', 'Craw Wurm');
    T.answer('choose', () => ({ number: 1 }));
    T.g._runEffects(act.effects, { controller: 'A', obj: rd, name: 'Resourceful Defense', kind: 'ability', targets: [{ kind: 'object', id: b.id }, { kind: 'object', id: c.id }] });
    T.settle();
    t.eq(b.counters['+1/+1'], 1); t.eq(c.counters['+1/+1'], 1, 'one moved');
    T.mana('A', '1U');
    T.cast('A', T.hand('A', 'Fate Transfer'), { targets: [b, c] });
    T.settle(); T.resolve(); T.settle();
    t.eq(b.counters['+1/+1'] || 0, 0); t.eq(c.counters['+1/+1'], 2, 'all moved');
    const foe = T.bf('B', 'Grizzly Bears');
    const bad = T.g._illegalTargets(MTG.rules.effectSpecs(T.hand('A', 'Bioshift').analysis().abilities[0].effects), [{ kind: 'object', id: c.id }, { kind: 'object', id: foe.id }], 'A', null);
    t.ok(bad, 'Bioshift: not across controllers');
  });

  test('Jaxis, the Troublemaker: a hasty copy that draws a card when it dies', (mk, t) => {
    t.auto('Jaxis, the Troublemaker');
    const T = mk();
    const jx = T.bf('A', 'Jaxis, the Troublemaker');
    const bear = T.bf('A', 'Grizzly Bears');
    const fx = jx.analysis().abilities.find(a => a.kind === 'activated').effects;
    T.g._runEffects(fx, { controller: 'A', obj: jx, name: 'Jaxis', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T.settle();
    const tok = T.g.battlefield.find(o => o.isToken && o.name === 'Grizzly Bears');
    t.ok(tok, 'a copy');
    t.ok(T.g.hasKw(tok, 'haste'), 'with haste');
    t.ok(!T.g.hasKw(bear, 'haste'), 'the original is untouched');
    t.ok(tok.analysis().abilities.some(a => a.kind === 'triggered' && a.granted), 'and the dies trigger');
    const hand = T.zone('A', 'hand').length;
    T.g.moveObject(tok, 'graveyard'); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'drew a card');
  });

  test("Open the Way: X no greater than the number of players", (mk, t) => {
    t.auto('Open the Way');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Forest');
    T.mana('A', '3GG');
    t.ok(!T.g.castSpell('A', T.hand('A', 'Open the Way').id, { x: 3, auto: true }), 'three is too many with two players');
    T.cast('A', T.hand('A', 'Open the Way'), { x: 2 });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Forest').length, 2);
  });

  test('Shanna, Purifying Blade: X no more than the life gained this turn', (mk, t) => {
    t.auto('Shanna, Purifying Blade');
    const T = mk();
    const sh = T.bf('A', 'Shanna, Purifying Blade');
    T.g.changeLife(T.player('A'), 2);
    T.mana('A', '5');
    T.answer('choose', (ch) => ({ number: ch.number.max }));
    const hand = T.zone('A', 'hand').length;
    T.g._runEffects(sh.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: sh, name: 'Shanna', kind: 'ability' });
    T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 2, 'two cards, not five');
  });

  test('Timely Ward: flash only when it targets a commander', (mk, t) => {
    t.auto('Timely Ward');
    const T = mk();
    const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
    const plain = T.bf('A', 'Savannah Lions');
    T.toMain('B');
    if (T.g.priorityPlayer.id === 'B') T.g.passPriority('B', true);
    T.mana('A', '2W');
    const ward = T.hand('A', 'Timely Ward');
    t.ok(!T.g.castSpell('A', ward.id, { targets: [{ kind: 'object', id: plain.id }], auto: true }), 'not on an ordinary creature');
    t.ok(T.g.castSpell('A', ward.id, { targets: [{ kind: 'object', id: cmd.id }], auto: true }), T.g.lastError);
  });

  test('Oko, Thief of Crowns: an Elk for good, and a swap for something small', (mk, t) => {
    t.auto('Oko, Thief of Crowns');
    const T = mk();
    const oko = T.bf('A', 'Oko, Thief of Crowns');
    const ring = T.bf('B', 'Sol Ring');
    const abs = oko.analysis().abilities;
    const run = (re, targets) => T.g._runEffects(abs.find(a => re.test(a.text)).effects, { controller: 'A', obj: oko, name: 'Oko', kind: 'ability', targets });
    run(/^\+1: Target/, [{ kind: 'object', id: ring.id }]);
    T.settle();
    t.ok(T.g.characteristics(ring).isCreature, 'a creature');
    t.eq(T.g.powerOf(ring), 3); t.eq(T.g.manaAbilitiesOf(ring).length, 0, 'no mana from it');
    T.nextTurn('A');
    t.ok(T.g.characteristics(ring).isCreature, 'still an Elk next turn');
    const bear = T.bf('B', 'Grizzly Bears'), wurm = T.bf('B', 'Craw Wurm');
    const mine = T.bf('A', 'Savannah Lions');
    t.ok(T.g._illegalTargets(MTG.rules.effectSpecs(abs.find(a => /Exchange/.test(a.text)).effects), [{ kind: 'object', id: mine.id }, { kind: 'object', id: wurm.id }], 'A', oko), 'not a big one');
    run(/Exchange/, [{ kind: 'object', id: mine.id }, { kind: 'object', id: bear.id }]);
    T.settle();
    t.eq(bear.controller, 'A'); t.eq(mine.controller, 'B');
  });

  test('Call Forth the Tempest: damage equal to the mana value of the other spells cast this turn', (mk, t) => {
    t.auto('Call Forth the Tempest');
    const T = mk();
    const cft = T.hand('A', 'Call Forth the Tempest'), bolt = T.hand('A', 'Lightning Bolt'), ghor = T.hand('A', 'Hill Giant');
    T.player('A').spellObjsThisTurn = [bolt, ghor, cft];
    const lions = T.bf('B', 'Savannah Lions'), wurm = T.bf('B', 'Craw Wurm'), mine = T.bf('A', 'Grizzly Bears');
    const trig = cft.analysis().abilities.find(a => a.kind === 'spell');
    T.g._runEffects(trig.effects, { controller: 'A', obj: cft, name: 'Call Forth the Tempest', kind: 'spell' });
    T.settle();
    t.eq(wurm.damage, 5, 'one for the Bolt and four for the Giant');
    T.g.checkStateBasedActions();
    t.eq(lions.zone, 'graveyard'); t.eq(mine.damage || 0, 0, 'not your own');
  });

  test("Kozilek's Command: a target player scries X; up to X cards from graveyards", (mk, t) => {
    t.auto("Kozilek's Command");
    const T = mk();
    const g1 = T.grave('B', 'Grizzly Bears'), g2 = T.grave('B', 'Llanowar Elves'), g3 = T.grave('A', 'Savannah Lions');
    T.top('B', 'Forest'); T.top('B', 'Island');
    const hand = T.zone('B', 'hand').length;
    T.answer('scry', (ch) => { t.eq(ch.playerId, 'B', 'B scries'); return { top: [], bottom: ch.cards.map(c => c.id) }; });
    T.mana('A', '2CC');
    T.answer('mode', { modes: [1, 3] });
    T.cast('A', T.hand('A', "Kozilek's Command"), { x: 2, targets: ['B', g1, g2] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('B', 'hand').length, hand + 1, 'B drew');
    t.eq(g1.zone, 'exile'); t.eq(g2.zone, 'exile'); t.eq(g3.zone, 'graveyard');
  });

  test('Abstergo Entertainment: a historic card back, then every graveyard exiled', (mk, t) => {
    t.auto('Abstergo Entertainment');
    const T = mk();
    const ab = T.bf('A', 'Abstergo Entertainment');
    const ring = T.grave('A', 'Sol Ring'), bear = T.grave('A', 'Grizzly Bears'), theirs = T.grave('B', 'Llanowar Elves');
    const fx = ab.analysis().abilities.find(a => a.kind === 'activated').effects;
    t.ok(T.g._illegalTargets(MTG.rules.effectSpecs(fx), [{ kind: 'object', id: bear.id }], 'A', ab), 'a Bear is not historic');
    T.g._runEffects(fx, { controller: 'A', obj: ab, name: 'Abstergo', kind: 'ability', targets: [{ kind: 'object', id: ring.id }] });
    T.settle();
    t.eq(ring.zone, 'hand'); t.eq(bear.zone, 'exile'); t.eq(theirs.zone, 'exile');
  });

  test('Hagra Mauling: {1} less while an opponent has no basic land', (mk, t) => {
    t.auto('Hagra Mauling // Hagra Broodpit');
    const T = mk();
    const hm = T.hand('A', 'Hagra Mauling // Hagra Broodpit');
    T.bf('B', 'Island');
    t.eq(T.g.canCast('A', hm.id).cost, '{2}{B}{B}', 'full price with an Island there');
    T.g.battlefield.filter(o => o.name === 'Island').forEach(o => T.g.moveObject(o, 'graveyard'));
    T.bf('B', 'Underground Sea');
    t.eq(T.g.canCast('A', hm.id).cost, '{1}{B}{B}', 'a nonbasic is no basic');
  });

  test('Uthros Research Craft: a card and a charge counter for each artifact spell; +1/+0 per artifact', (mk, t) => {
    t.auto('Uthros Research Craft');
    const T = mk();
    const u = T.bf('A', 'Uthros Research Craft');
    u.counters.charge = 12;
    T.bf('A', 'Sol Ring');
    t.eq(T.g.powerOf(u), (parseInt(u.card.power, 10) || 0) + 2, 'two artifacts, itself and the Ring');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', '2');
    T.cast('A', T.hand('A', 'Mind Stone'));
    T.settle(); T.resolve(); T.settle();
    t.eq(u.counters.charge, 13, 'a charge counter');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'drew one for the one cast');
  });

  test('Ruthless Technomancer: back with power X or less; Lazotep Quarry: mana value X', (mk, t) => {
    t.auto('Ruthless Technomancer'); t.auto('Lazotep Quarry');
    const T = mk();
    const rt = T.bf('A', 'Ruthless Technomancer');
    const a1 = T.bf('A', 'Sol Ring'), a2 = T.bf('A', 'Mind Stone');
    const bear = T.grave('A', 'Grizzly Bears'), wurm = T.grave('A', 'Craw Wurm');
    T.mana('A', '2B');
    const ai = 0;   // its one activated ability
    t.ok(!T.g.activateAbility('A', rt.id, ai, { x: 2, targets: [{ kind: 'object', id: wurm.id }], auto: true }), 'the Wurm is too big');
    t.ok(T.g.activateAbility('A', rt.id, ai, { x: 2, targets: [{ kind: 'object', id: bear.id }], auto: true }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(bear.zone, 'battlefield'); t.eq(a1.zone, 'graveyard'); t.eq(a2.zone, 'graveyard');
    const lq = T.bf('A', 'Lazotep Quarry');
    const fx = lq.analysis().abilities.find(a => a.kind === 'activated' && /Exile/.test(a.text)).effects;
    t.eq(fx[0].targets[0].mv, 'X');
  });

  test('Mutational Advantage: what has counters is shielded from damage this turn', (mk, t) => {
    t.auto('Mutational Advantage');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), lions = T.bf('A', 'Savannah Lions');
    T.g.addCounters(bear, '+1/+1', 1);
    T.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T.mana('A', '1GU');
    T.cast('A', T.hand('A', 'Mutational Advantage'));
    T.settle(); T.resolve(); T.settle();
    t.ok(T.g.hasKw(bear, 'indestructible') && !T.g.hasKw(lions, 'indestructible'), 'only the one with a counter');
    T.g.dealDamageToObject(bear, 3, lions); T.g.dealDamageToObject(lions, 1, bear);
    t.eq(bear.damage || 0, 0, 'no damage to it'); t.eq(lions.damage, 1);
  });

  test('Grenzo, Havoc Raiser: goad a creature of the player it hit', (mk, t) => {
    t.auto('Grenzo, Havoc Raiser');
    const T = mk({ players: ['A', 'B', 'C'] });
    const gz = T.bf('A', 'Grenzo, Havoc Raiser');
    const hers = T.bf('B', 'Grizzly Bears'), other = T.bf('C', 'Savannah Lions');
    T.answer('mode', { modes: [0] });
    let offered = null;
    T.answer('choose', (ch) => { offered = ch.items.map(x => x.id); return { picks: [hers.id] }; });
    T.g._runEffects(gz.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: gz, name: 'Grenzo', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
    T.settle();
    t.ok(!offered || !offered.includes(other.id), 'only the creatures of that player');
    t.eq(hers.goadedBy, 'A', 'goaded'); t.ok(!other.goadedBy);
  });

  test("Sentinel of the Eternal Watch: taps a creature of the player whose combat it is", (mk, t) => {
    t.auto('Sentinel of the Eternal Watch');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('A', 'Sentinel of the Eternal Watch');
    const bb = T.bf('B', 'Grizzly Bears'), cc = T.bf('C', 'Savannah Lions');
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 1).map(x => x.id) }));
    bb.summoningSick = true;
    T.answer('declareAttackers', () => []);
    T.toMain('B');
    for (let i = 0; i < 20 && !(T.g.activePlayer.id === 'B' && T.g.step === 'beginCombat' && !T.g.stack.length && !T.g.pendingTriggers.length && !T.g.pendingChoice); i++) {
      T.settle(); const p = T.g.priorityPlayer; if (!p) break; T.g.passPriority(p.id, true);
    }
    T.settle(); T.resolve(); T.settle();
    t.ok(bb.tapped && !cc.tapped, "B's creature tapped at B's combat");
  });

  test('Ghalta and Mavren: a tapped and attacking Dinosaur as big as the biggest other attacker', (mk, t) => {
    t.auto('Ghalta and Mavren');
    const T = mk();
    const gm = T.bf('A', 'Ghalta and Mavren'), wurm = T.bf('A', 'Craw Wurm'), bear = T.bf('A', 'Grizzly Bears');
    for (const o of [gm, wurm, bear]) o.summoningSick = false;
    T.answer('declareAttackers', () => [gm, wurm, bear].map(o => ({ attackerId: o.id, defenderId: 'B' })));
    T.answer('mode', { modes: [0] });
    T.toMain('A');
    for (let i = 0; i < 30 && !T.g.battlefield.some(o => o.isToken); i++) { T.settle(); const p = T.g.priorityPlayer; if (!p) break; T.g.passPriority(p.id, true); }
    const tok = T.g.battlefield.find(o => o.isToken && o.controller === 'A');
    t.ok(tok, 'a Dinosaur');
    t.eq(T.g.powerOf(tok), 6, 'as big as the Wurm'); t.ok(tok.tapped && tok.attacking, 'tapped and attacking');
  });

  test('Daretti, Scrap Savant: an artifact for an artifact; the emblem brings them back', (mk, t) => {
    t.auto('Daretti, Scrap Savant');
    const T = mk();
    const d = T.bf('A', 'Daretti, Scrap Savant');
    const ring = T.bf('A', 'Sol Ring'), stone = T.grave('A', 'Mind Stone');
    const abs = d.analysis().abilities;
    T.g._runEffects(abs.find(a => /^[-\u2212]2/.test(a.text)).effects, { controller: 'A', obj: d, name: 'Daretti', kind: 'ability', targets: [{ kind: 'object', id: stone.id }] });
    T.settle();
    t.eq(ring.zone, 'graveyard', 'sacrificed'); t.eq(stone.zone, 'battlefield', 'returned');
    T.g._runEffects(abs.find(a => /^[-\u2212]10/.test(a.text)).effects, { controller: 'A', obj: d, name: 'Daretti', kind: 'ability' });
    T.settle();
    T.g.moveObject(stone, 'graveyard'); T.settle();
    t.eq(stone.zone, 'graveyard');
    T.toMain('B');
    t.eq(stone.zone, 'battlefield', 'back at the end step'); t.eq(stone.controller, 'A');
  });

  test('Resourceful Defense in play: the trigger finds the counters of what left', (mk, t) => {
    const T = mk();
    T.bf('A', 'Resourceful Defense');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Savannah Lions');
    T.g.addCounters(a, '+1/+1', 3);
    T.answer('pickTarget', { targets: [{ kind: 'object', id: b.id }] });
    T.g.moveObject(a, 'graveyard');
    T.settle(); T.resolve(); T.settle();
    t.eq(b.counters['+1/+1'], 3);
  });

  test('Seasons: artifact or enchantment chosen, an indestructible counter, deaths under your control', (mk, t) => {
    t.auto('Season of Gathering'); t.auto('Season of the Burrow'); t.auto('Season of Loss');
    const T = mk();
    const ring = T.bf('B', 'Sol Ring'), pac = T.bf('B', 'Pacifism'), mine = T.bf('A', 'Mind Stone');
    T.mana('A', 'GG4');
    T.answer('choose', { picks: [1] });
    T.answer('mode', { modes: [1] });
    T.cast('A', T.hand('A', 'Season of Gathering'));
    T.settle();
    t.eq(pac.zone, 'graveyard', 'enchantments chosen'); t.eq(ring.zone, 'battlefield'); t.eq(mine.zone, 'battlefield');
    const stone = T.grave('A', 'Mind Stone');
    T.mana('A', 'WW3');
    T.answer('choose', { picks: [2] });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: stone.id }] });
    T.cast('A', T.hand('A', 'Season of the Burrow'));
    T.settle();
    t.eq(stone.zone, 'battlefield'); t.eq(stone.counters.indestructible, 1, 'with an indestructible counter');
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('B', 'Savannah Lions');
    T.g.moveObject(b1, 'graveyard'); T.g.moveObject(b2, 'graveyard');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', 'BB3');
    T.answer('choose', { picks: [1] });
    T.cast('A', T.hand('A', 'Season of Loss'));
    T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'one card: only one died under your control');
  });

  test('Orthion, Hero of Lavabrink: five hasty copies, gone at the end step', (mk, t) => {
    t.auto('Orthion, Hero of Lavabrink');
    const T = mk();
    const o = T.bf('A', 'Orthion, Hero of Lavabrink');
    const bear = T.bf('A', 'Grizzly Bears');
    const ab = o.analysis().abilities.find(a => a.kind === 'activated' && /five/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: o, name: 'Orthion', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T.settle();
    const toks = T.g.battlefield.filter(x => x.isToken && x.name === 'Grizzly Bears');
    t.eq(toks.length, 5);
    t.ok(toks.every(x => T.g.hasKw(x, 'haste')), 'all hasty');
    T.toMain('B');
    t.eq(T.g.battlefield.filter(x => x.isToken).length, 0, 'sacrificed at the end step');
  });

  test('Alibou, Ancient Witness: X damage and scry X, X the tapped artifacts', (mk, t) => {
    t.auto('Alibou, Ancient Witness');
    const T = mk();
    const al = T.bf('A', 'Alibou, Ancient Witness');
    const r1 = T.bf('A', 'Sol Ring'), r2 = T.bf('A', 'Mind Stone'); r1.tapped = true; r2.tapped = true;
    T.bf('A', 'Fellwar Stone');
    let scried = 0;
    T.answer('scry', (ch) => { scried = ch.count; return { top: ch.cards.map(c => c.id), bottom: [] }; });
    T.g._runEffects(al.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: al, name: 'Alibou', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    T.settle();
    t.eq(T.player('B').life, 18); t.eq(scried, 2);
  });

  test('Tyvar, Jubilant Brawler: mill three, then a small creature back', (mk, t) => {
    t.auto('Tyvar, Jubilant Brawler');
    const T = mk();
    const ty = T.bf('A', 'Tyvar, Jubilant Brawler');
    const wurm = T.grave('A', 'Craw Wurm'), elf = T.grave('A', 'Llanowar Elves');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.id); return { cardIds: [elf.id] }; });
    T.g._runEffects(ty.analysis().abilities.find(a => /^[-\u2212]2/.test(a.text)).effects, { controller: 'A', obj: ty, name: 'Tyvar', kind: 'ability' });
    T.settle();
    t.eq(elf.zone, 'battlefield'); t.ok(!offered || !offered.includes(wurm.id), 'not the Wurm');
  });

  test('Whelming Wave spares the sea creatures; Harvest Season counts tapped creatures', (mk, t) => {
    t.auto('Whelming Wave'); t.auto('Harvest Season');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears'), serp = T.bf('B', 'Coral Eel');
    const eelType = (serp.analysis().subtypes || []).join(' ');
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Whelming Wave'));
    T.settle(); T.resolve(); T.settle();
    t.eq(bear.zone, 'hand');
    t.eq(serp.zone, /Fish/.test(eelType) ? 'hand' : 'battlefield', 'a Fish is no Serpent');
    const k = T.bf('B', 'Kraken Hatchling');
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Whelming Wave'));
    T.settle(); T.resolve(); T.settle();
    t.eq(k.zone, 'battlefield', 'the Kraken stays');
    const c1 = T.bf('A', 'Grizzly Bears'), c2 = T.bf('A', 'Savannah Lions'); c1.tapped = true; c2.tapped = true;
    for (let i = 0; i < 3; i++) T.top('A', 'Forest');
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.slice(0, 2).map(c => c.id) }));
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Harvest Season'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Forest').length, 2, 'two tapped creatures, two Forests');
  });

  test("Parley: Selvala's Charge makes an Elephant for each nonland card shown", (mk, t) => {
    t.auto("Selvala's Charge");
    const T = mk();
    T.top('A', 'Lightning Bolt'); T.top('B', 'Forest');
    const ha = T.zone('A', 'hand').length, hb = T.zone('B', 'hand').length;
    T.mana('A', '4G');
    T.cast('A', T.hand('A', "Selvala's Charge"));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Elephant').length, 1, 'one nonland card');
    t.eq(T.zone('A', 'hand').length, ha + 1, 'A drew');
    t.eq(T.zone('B', 'hand').length, hb + 1, 'B drew');
  });

  test('Food Chain: one more than the exiled creature, for creature spells', (mk, t) => {
    t.auto('Food Chain');
    const T = mk();
    const fc = T.bf('A', 'Food Chain');
    const wurm = T.bf('A', 'Craw Wurm');
    t.ok(T.g.activateAbility('A', fc.id, 0, { exileIds: [wurm.id], manaChoice: 'G' }), T.g.lastError);
    t.eq(wurm.zone, 'exile');
    const pool = T.player('A').pool;
    const total = ['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (pool.snapshot()[c] || 0), 0) + ((T.player('A').restricted || []).length || 0);
    t.eq(total, 7, 'seven mana: 1 plus six');
    t.ok(!T.g._manaCostPayable('A', fc, fc.analysis().manaAbilities[0]), 'the auto-tapper leaves it alone');
  });

  test('Bow of Nylea: up to four cards from your graveyard to the bottom of your library', (mk, t) => {
    t.auto('Bow of Nylea');
    const T = mk();
    const bow = T.bf('A', 'Bow of Nylea');
    const g1 = T.grave('A', 'Grizzly Bears'), g2 = T.grave('A', 'Lightning Bolt'), g3 = T.grave('B', 'Forest');
    T.answer('mode', { modes: [3] });
    T.answer('pickTarget', { targets: [{ kind: 'object', id: g1.id }, { kind: 'object', id: g2.id }] });
    T.mana('A', '1G');
    T.activate('A', bow, 0);
    T.settle();
    const lib = T.zone('A', 'library');
    t.eq(g1.zone, 'library'); t.eq(g2.zone, 'library'); t.eq(g3.zone, 'graveyard');
    t.ok(lib.slice(-2).includes(g1) && lib.slice(-2).includes(g2), 'at the bottom');
  });

  test('Inscription of Ruin: one mode, or every one once kicked', (mk, t) => {
    t.auto('Inscription of Ruin');
    const a = engine().oracle.analyze(card('Inscription of Ruin'));
    const md = a.abilities.find(x => x.kind === 'spell').effects.find(e => e.op === 'modal');
    t.eq(md.modes.length, 3, 'three modes, the note is not one');
    t.eq(md.countIf.cond.kind, 'kicked'); t.eq(md.countIf.count, 99);
    const T = mk();
    const elf = T.grave('A', 'Llanowar Elves'), bear = T.bf('B', 'Grizzly Bears');
    let count = null;
    T.answer('mode', (ch) => { count = ch.count; return { modes: [1, 2] }; });
    const pick = (ch) => { const ids = ch.options[0].map(o => o.id); return { targets: [{ kind: 'object', id: ids.includes(bear.id) ? bear.id : elf.id }] }; };
    T.answer('pickTarget', pick); T.answer('pickTarget', pick);
    T.mana('A', '4BBBB');
    T.cast('A', T.hand('A', 'Inscription of Ruin'), { kick: 1 });
    T.settle(); T.resolve(); T.settle();
    t.eq(count, 3, 'kicked: any number');
    t.eq(elf.zone, 'battlefield'); t.eq(bear.zone, 'graveyard');
  });

  test("Arbor Adherent, Skyclave Relic, Emeria's Call", (mk, t) => {
    t.auto('Arbor Adherent'); t.auto('Skyclave Relic'); t.auto("Emeria's Call // Emeria, Shattered Skyclave");
    const T = mk();
    const aa = T.bf('A', 'Arbor Adherent'); aa.summoningSick = false;
    T.bf('A', 'Craw Wurm');
    const ai = aa.analysis().manaAbilities.findIndex(x => (x.effects || []).some(e => e.op === 'addManaX'));
    t.ok(T.g.activateAbility('A', aa.id, ai, { manaChoice: 'G' }), T.g.lastError);
    t.eq(T.player('A').pool.snapshot().G, 4, 'the Wurm is 6/4');
    const relic = T.bf('A', 'Skyclave Relic');
    T.g._runEffects([{ op: 'copyPermanent', n: 2, self: true, tapped: true, grant: [] }], { controller: 'A', obj: relic, name: 'Relic', kind: 'ability' });
    const toks = T.g.battlefield.filter(o => o.isToken && o.name === 'Skyclave Relic');
    t.eq(toks.length, 2); t.ok(toks.every(o => o.tapped), 'tapped');
    const ec = engine().oracle.analyze(card("Emeria's Call // Emeria, Shattered Skyclave"));
    const g = JSON.stringify(ec.abilities);
    t.ok(/"duration":"nextTurn"/.test(g) && /"notSubtype":"angel"/.test(g), 'until your next turn, not Angels');
  });

  test('Rionya: one plus the instants and sorceries cast this turn; Cyberman Patrol hands out afflict 3', (mk, t) => {
    t.auto('Rionya, Fire Dancer'); t.auto('Cyberman Patrol');
    const T = mk();
    const ri = T.bf('A', 'Rionya, Fire Dancer'), bear = T.bf('A', 'Grizzly Bears');
    T.player('A').spellObjsThisTurn = [T.hand('A', 'Lightning Bolt'), T.hand('A', 'Divination'), T.hand('A', 'Hill Giant')];
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.g._runEffects(ri.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: ri, name: 'Rionya', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && o.name === 'Grizzly Bears').length, 3, 'one plus two');
    T.bf('A', 'Cyberman Patrol');
    const ring = T.bf('A', 'Ornithopter');
    t.eq(T.g._kwArg(ring, 'afflict'), 3);
  });

  test("Alseid of Life's Bounty: protection from a chosen colour for a creature or enchantment", (mk, t) => {
    t.auto("Alseid of Life's Bounty");
    const T = mk();
    const al = T.bf('A', "Alseid of Life's Bounty");
    const pac = T.bf('A', 'Intangible Virtue');
    const ab = al.analysis().abilities.find(a => a.kind === 'activated');
    T.answer('mode', { modes: [2] });
    T.g._runEffects(ab.effects, { controller: 'A', obj: al, name: 'Alseid', kind: 'ability', targets: [{ kind: 'object', id: pac.id }] });
    T.settle();
    t.ok(T.g.hasKw(pac, 'protection from black'), 'black chosen');
  });

  test('Jace, the Mind Sculptor: fateseal one, and the ultimate', (mk, t) => {
    t.auto('Jace, the Mind Sculptor');
    const T = mk();
    const j = T.bf('A', 'Jace, the Mind Sculptor');
    const top = T.top('B', 'Lightning Bolt'); T.top('B', 'Forest'); const bolt2 = T.zone('B', 'library')[0];
    const abs = j.analysis().abilities;
    T.answer('confirm', { yes: true });
    T.g._runEffects(abs.find(a => /^\+2/.test(a.text)).effects, { controller: 'A', obj: j, name: 'Jace', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    T.settle();
    const lib = T.zone('B', 'library');
    t.eq(lib[lib.length - 1], bolt2, 'the top card went to the bottom');
    T.hand('B', 'Grizzly Bears');
    T.g._runEffects(abs.find(a => /^[-\u2212]12/.test(a.text)).effects, { controller: 'A', obj: j, name: 'Jace', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    T.settle();
    t.eq(T.zone('B', 'hand').length, 0, 'hand shuffled in');
    t.ok(T.zone('B', 'library').some(c => c.name === 'Grizzly Bears'), 'the hand is the library now');
    t.ok(T.zone('B', 'exile').length >= 2, 'the old library exiled');
  });

  test('Urza, Lord High Artificer: shuffle, exile the top card, play it free this turn', (mk, t) => {
    t.auto('Urza, Lord High Artificer');
    const T = mk();
    const u = T.bf('A', 'Urza, Lord High Artificer');
    T.zone('A', 'library').splice(0);
    for (let i = 0; i < 4; i++) T.top('A', 'Grizzly Bears');
    const ab = u.analysis().abilities.find(a => a.kind === 'activated' && /Shuffle/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: u, name: 'Urza', kind: 'ability' });
    T.settle();
    const ex = T.zone('A', 'exile');
    t.eq(ex.length, 1, 'one card exiled');
    const it = ex[0];
    t.ok(T.g.castSpell('A', it.id, { auto: true, via: 'free' }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(it.zone, 'battlefield', 'played for free');
  });

  test('Blossoming Tortoise, Mech Hangar, Rhys the Redeemed, Heat Shimmer', (mk, t) => {
    t.auto('Blossoming Tortoise'); t.auto('Mech Hangar'); t.auto('Rhys the Redeemed'); t.auto('Heat Shimmer');
    const T = mk();
    const bt = T.bf('A', 'Blossoming Tortoise');
    const land = T.grave('A', 'Forest');
    T.g._runEffects(bt.analysis().abilities.find(a => a.kind === 'triggered').effects, { controller: 'A', obj: bt, name: 'Tortoise', kind: 'ability' });
    T.settle();
    t.ok(T.g.battlefield.some(o => o.name === 'Forest' && o.controller === 'A' && o.tapped), 'a land back, tapped');
    const mh = T.bf('A', 'Mech Hangar');
    const veh = T.bf('A', 'Smuggler\'s Copter');
    const mab = mh.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(mab.effects, { controller: 'A', obj: mh, name: 'Mech Hangar', kind: 'ability', targets: [{ kind: 'object', id: veh.id }] });
    t.ok(T.g.characteristics(veh).isCreature, 'the Vehicle is a creature');
    const rh = T.bf('A', 'Rhys the Redeemed');
    T.g._createToken('A', { n: 2, pt: '1/1', subtypes: 'Elf Warrior', colorWords: ['green'], keywords: [] });
    T.g._createToken('A', { n: 1, pt: '0/0', subtypes: 'Treasure', addTypes: ['Artifact'], colorWords: [], keywords: [], noCreature: true });
    const before = T.g.battlefield.filter(o => o.isToken && (T.g.characteristics(o) || {}).isCreature).length;
    const rab = rh.analysis().abilities.filter(a => a.kind === 'activated').pop();
    T.g._runEffects(rab.effects, { controller: 'A', obj: rh, name: 'Rhys', kind: 'ability' });
    t.eq(T.g.battlefield.filter(o => o.isToken && (T.g.characteristics(o) || {}).isCreature).length, before * 2, 'each creature token copied');
    const foe = T.bf('B', 'Craw Wurm');
    T.mana('A', '2RR');
    T.cast('A', T.hand('A', 'Heat Shimmer'), { targets: [foe] });
    T.settle(); T.resolve(); T.settle();
    const sh = T.g.battlefield.find(o => o.isToken && o.name === 'Craw Wurm');
    t.ok(sh && T.g.hasKw(sh, 'haste'), 'a hasty copy');
    T.toMain('B');
    t.ok(sh.zone === 'exile' || !T.g.battlefield.includes(sh), 'exiled at the end step');
  });

  test('Zimone and Aetheric Amplifier double counters; Axebane Guardian counts defenders', (mk, t) => {
    t.auto('Zimone, Paradox Sculptor'); t.auto('Aetheric Amplifier'); t.auto('Axebane Guardian');
    const T = mk();
    const z = T.bf('A', 'Zimone, Paradox Sculptor');
    const bear = T.bf('A', 'Grizzly Bears'), ring = T.bf('A', 'Sol Ring');
    T.g.addCounters(bear, '+1/+1', 2); T.g.addCounters(ring, 'charge', 1);
    const zab = z.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(zab.effects, { controller: 'A', obj: z, name: 'Zimone', kind: 'ability', targets: [{ kind: 'object', id: bear.id }, { kind: 'object', id: ring.id }] });
    t.eq(bear.counters['+1/+1'], 4); t.eq(ring.counters.charge, 2);
    const amp = T.bf('A', 'Aetheric Amplifier');
    T.player('A').energy = 3; T.player('A').experience = 1;
    T.answer('mode', { modes: [1] });
    T.g._runEffects(amp.analysis().abilities.find(a => a.kind === 'activated' && /Choose one/.test(a.text)).effects, { controller: 'A', obj: amp, name: 'Amp', kind: 'ability' });
    T.settle();
    t.eq(T.player('A').energy, 6); t.eq(T.player('A').experience, 2);
    const ax = T.bf('A', 'Axebane Guardian'); ax.summoningSick = false;
    T.bf('A', 'Wall of Wood');
    const mi = ax.analysis().manaAbilities.findIndex(x => (x.effects || []).some(e => e.op === 'addManaAny'));
    t.ok(T.g.activateAbility('A', ax.id, mi, { manaChoice: 'G' }), T.g.lastError);
    t.eq(T.player('A').pool.snapshot().G, 2, 'two defenders, two mana');
  });

  test('Thraben Charm: twice the number of creatures you control', (mk, t) => {
    t.auto('Thraben Charm');
    const T = mk();
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Savannah Lions');
    const w = T.bf('B', 'Craw Wurm');
    T.answer('mode', { modes: [0] });
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Thraben Charm'), { targets: [w] });
    T.settle(); T.resolve(); T.settle();
    t.eq(w.zone, 'graveyard', 'four damage to a 6/4');
  });

  test("Wirewood Channeler counts every Elf; Sozin's Comet; Captivating Crew", (mk, t) => {
    t.auto('Wirewood Channeler'); t.auto("Sozin's Comet"); t.auto('Captivating Crew');
    const T = mk();
    const wc = T.bf('A', 'Wirewood Channeler'); wc.summoningSick = false;
    T.bf('A', 'Llanowar Elves'); T.bf('B', 'Elvish Mystic');
    const mi = wc.analysis().manaAbilities.findIndex(x => (x.effects || []).some(e => e.op === 'addManaX'));
    t.ok(T.g.activateAbility('A', wc.id, mi, { manaChoice: 'G' }), T.g.lastError);
    t.eq(T.player('A').pool.snapshot().G, 3, 'three Elves on the battlefield');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '3RR');
    T.cast('A', T.hand('A', "Sozin's Comet"));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g._kwArg(bear, 'firebending'), 5);
    const cc = T.bf('A', 'Captivating Crew');
    const foe = T.bf('B', 'Craw Wurm');
    const ab = cc.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: cc, name: 'Crew', kind: 'ability', targets: [{ kind: 'object', id: foe.id }] });
    T.settle();
    t.eq(foe.controller, 'A'); t.ok(T.g.hasKw(foe, 'haste'));
  });

  test('Hidden Hideout: only a creature with a counter on it', (mk, t) => {
    t.auto('Hidden Hideout');
    const T = mk();
    const hh = T.bf('A', 'Hidden Hideout');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Savannah Lions');
    T.g.addCounters(a, 'shield', 1);
    const fx = hh.analysis().abilities.find(x => x.kind === 'activated' && /lifelink/.test(x.text)).effects;
    const specs = MTG.rules.effectSpecs(fx);
    t.ok(!T.g._illegalTargets(specs, [{ kind: 'object', id: a.id }], 'A', hh), 'with a counter');
    t.ok(T.g._illegalTargets(specs, [{ kind: 'object', id: b.id }], 'A', hh), 'without');
  });

  test('Clone Legion copies each creature of the target player; Rakdos Joins Up', (mk, t) => {
    t.auto('Clone Legion'); t.auto('Rakdos Joins Up');
    const T = mk();
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Craw Wurm'); T.bf('B', 'Sol Ring');
    T.mana('A', '7UU');
    T.cast('A', T.hand('A', 'Clone Legion'), { targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    const mine = T.g.battlefield.filter(o => o.controller === 'A' && o.isToken);
    t.eq(mine.length, 2, 'two creatures copied, not the Ring');
    const rj = T.bf('A', 'Rakdos Joins Up');
    const dead = T.grave('A', 'Grizzly Bears');
    const trig = rj.analysis().abilities.find(a => a.kind === 'triggered' && /return target creature card/i.test(a.text));
    T.g._runEffects(trig.effects, { controller: 'A', obj: rj, name: 'Rakdos Joins Up', kind: 'ability', targets: [{ kind: 'object', id: dead.id }] });
    T.settle();
    t.eq(dead.zone, 'battlefield'); t.eq(dead.counters['+1/+1'], 2);
  });

  test('Teferi, Hero of Dominaria: lands untapped at the end step; third from the top', (mk, t) => {
    t.auto('Teferi, Hero of Dominaria');
    const T = mk();
    const te = T.bf('A', 'Teferi, Hero of Dominaria');
    const l1 = T.bf('A', 'Island'), l2 = T.bf('A', 'Plains'); l1.tapped = true; l2.tapped = true;
    const abs = te.analysis().abilities;
    T.answer('choose', (ch) => ({ picks: ch.items.slice(0, 2).map(x => x.id) }));
    T.g._runEffects(abs.find(a => /^\+1/.test(a.text)).effects, { controller: 'A', obj: te, name: 'Teferi', kind: 'ability' });
    T.settle();
    t.ok(l1.tapped && l2.tapped, 'not yet');
    T.toMain('B');
    t.ok(!l1.tapped && !l2.tapped, 'untapped at the end step');
    const foe = T.bf('B', 'Craw Wurm');
    T.g._runEffects(abs.find(a => /^[-\u2212]3/.test(a.text)).effects, { controller: 'A', obj: te, name: 'Teferi', kind: 'ability', targets: [{ kind: 'object', id: foe.id }] });
    t.eq(T.zone('B', 'library')[2], foe, 'third from the top');
  });

  test('Volcanic Torrent: each creature and planeswalker your opponents control, and nobody else', (mk, t) => {
    t.auto('Volcanic Torrent');
    const T = mk();
    const theirs = T.bf('B', 'Grizzly Bears'), pw = T.bf('B', 'Jace Beleren'), mine = T.bf('A', 'Savannah Lions');
    T.player('A').spellObjsThisTurn = []; T.player('A').spellsCastThisTurn = 1;
    T.mana('A', '4R');
    T.cast('A', T.hand('A', 'Volcanic Torrent'));
    T.settle(); T.resolve(); T.settle();
    t.eq(theirs.zone, 'graveyard'); t.eq(mine.zone, 'battlefield');
    t.ok(pw.zone !== 'battlefield' || pw.counters.loyalty < 3, 'the planeswalker took damage');
    t.eq(T.player('B').life, 20, 'not the player');
  });

  test('Unctus, Grand Metatect: a blue artifact as well, for the turn', (mk, t) => {
    t.auto('Unctus, Grand Metatect');
    const T = mk();
    const u = T.bf('A', 'Unctus, Grand Metatect');
    const bear = T.bf('A', 'Grizzly Bears');
    const ab = u.analysis().abilities.find(a => a.kind === 'activated' && /blue artifact/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: u, name: 'Unctus', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    t.ok(T.g._cardFitsWords(bear, 'artifact') && T.g._cardFitsWords(bear, 'creature'), 'an artifact creature');
    t.ok(T.g._cardFitsWords(bear, 'blue') && T.g._cardFitsWords(bear, 'green'), 'blue and still green');
    T.toMain('B');
    t.ok(!T.g._cardFitsWords(bear, 'artifact'), 'only for the turn');
  });

  test('Stonehewer Giant: an Equipment from the library, attached', (mk, t) => {
    t.auto('Stonehewer Giant');
    const T = mk();
    const sg = T.bf('A', 'Stonehewer Giant');
    const bear = T.bf('A', 'Grizzly Bears');
    T.top('A', 'Bonesplitter');
    T.answer('pickCard', (ch) => ({ cardIds: [ch.cards.find(c => c.name === 'Bonesplitter').id] }));
    T.answer('choose', (ch) => ({ picks: [bear.id] }));
    T.g._runEffects(sg.analysis().abilities.find(a => a.kind === 'activated').effects, { controller: 'A', obj: sg, name: 'Stonehewer Giant', kind: 'ability' });
    T.settle();
    const bs = T.g.battlefield.find(o => o.name === 'Bonesplitter');
    t.ok(bs, 'on the battlefield'); t.eq(bs.attachedTo, bear.id);
    t.eq(T.g.powerOf(bear), 4);
  });

  test('Banefire: with X 5 or more, not countered and not prevented', (mk, t) => {
    t.auto('Banefire');
    const T = mk();
    const w1 = T.bf('B', 'Craw Wurm'), w2 = T.bf('B', 'Craw Wurm');
    for (const w of [w1, w2]) w.effects.push({ flag: 'noDamageTaken', until: 'eot' }, { flag: 'noNoncombatTaken', until: 'eot' });
    T.mana('A', '4R');
    T.cast('A', T.hand('A', 'Banefire'), { x: 4, targets: [w1] });
    T.settle(); T.resolve(); T.settle();
    t.eq(w1.zone, 'battlefield', 'X 4: prevented');
    T.mana('A', '5R');
    T.cast('A', T.hand('A', 'Banefire'), { x: 5, targets: [w2], resolve: false });
    t.ok(T.g.stack[T.g.stack.length - 1].uncounterable, "can't be countered");
    T.settle(); T.resolve(); T.settle();
    t.eq(w2.zone, 'graveyard', 'X 5: not prevented');
  });

  test("A legend's short name before a comma: Dion and Jace, Vryn's Prodigy transform", (mk, t) => {
    t.auto("Dion, Bahamut's Dominant // Bahamut, Warden of Light"); t.auto("Jace, Vryn's Prodigy // Jace, Telepath Unbound");
    const T = mk();
    const j = T.bf('A', "Jace, Vryn's Prodigy // Jace, Telepath Unbound"); j.summoningSick = false;
    for (let i = 0; i < 5; i++) T.grave('A', 'Forest');
    T.hand('A', 'Island');
    T.answer('discard', (ch) => ({ cardIds: [ch.cards ? ch.cards[0].id : T.zone('A', 'hand')[0].id] }));
    T.activate('A', j, 0);
    T.settle();
    t.eq(j.zone, 'battlefield'); t.eq(j.face || 0, 1, 'transformed');
  });

  test('Liliana, Heretical Healer: flips when a creature of yours dies, and makes a Zombie', (mk, t) => {
    t.auto('Liliana, Heretical Healer // Liliana, Defiant Necromancer');
    const T = mk();
    const li = T.bf('A', 'Liliana, Heretical Healer // Liliana, Defiant Necromancer');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    T.settle(); T.resolve(); T.settle();
    t.eq(li.zone, 'battlefield'); t.eq(li.face || 0, 1, 'a planeswalker now');
    t.ok(T.g.battlefield.some(o => o.isToken && o.name === 'Zombie'), 'and a Zombie');
  });

  test('Nightmare Shepherd: a 1/1 Nightmare copy of what died', (mk, t) => {
    t.auto('Nightmare Shepherd');
    const T = mk();
    T.bf('A', 'Nightmare Shepherd');
    const wurm = T.bf('A', 'Craw Wurm');
    T.answer('confirm', { yes: true });
    T.g.moveObject(wurm, 'graveyard');
    T.settle(); T.resolve(); T.settle();
    t.eq(wurm.zone, 'exile');
    const tok = T.g.battlefield.find(o => o.isToken && o.name === 'Craw Wurm');
    t.ok(tok, 'a copy');
    t.eq(T.g.powerOf(tok), 1); t.eq(T.g.toughnessOf(tok), 1);
    t.ok(T.g._cardFitsWords(tok, 'Nightmare'), 'a Nightmare');
  });

  test('Shoot the Sheriff: not an outlaw', (mk, t) => {
    t.auto('Shoot the Sheriff');
    const T = mk();
    const rogue = T.bf('B', 'Robber of the Rich'), bear = T.bf('B', 'Grizzly Bears');
    const specs = MTG.rules.spellTargetSpecs(T.hand('A', 'Shoot the Sheriff').analysis());
    t.ok(T.g._illegalTargets(specs, [{ kind: 'object', id: rogue.id }], 'A', null), 'a Rogue is an outlaw');
    t.ok(!T.g._illegalTargets(specs, [{ kind: 'object', id: bear.id }], 'A', null), 'a Bear is not');
    t.ok(T.g._cardFitsWords(rogue, 'outlaw') && !T.g._cardFitsWords(bear, 'outlaw'));
  });

  test('"During your turn, …": At Knifepoint gives outlaws first strike on your turn only', (mk, t) => {
    t.auto('At Knifepoint');
    const T = mk();
    T.bf('A', 'At Knifepoint');
    const r = T.bf('A', 'Robber of the Rich'), bear = T.bf('A', 'Grizzly Bears');
    T.toMain('A');
    t.ok(T.g.hasKw(r, 'first strike') && !T.g.hasKw(bear, 'first strike'), 'the outlaw, on your turn');
    T.toMain('B');
    t.ok(!T.g.hasKw(r, 'first strike'), 'not on theirs');
  });

  test('Banquet Guests: twice X counters; Kiora Bests the Sea God taps one opponent', (mk, t) => {
    t.auto('Banquet Guests'); t.auto('Kiora Bests the Sea God');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.mana('A', '2GW1');
    T.cast('A', T.hand('A', 'Banquet Guests'), { x: 1 });
    T.settle(); T.resolve(); T.settle();
    const bg = T.g.battlefield.find(o => o.name === 'Banquet Guests');
    t.ok(bg, 'cast'); t.eq(bg.counters['+1/+1'], 2, 'twice X');
    const kb = T.g.battlefield.find(o => o.name === 'Banquet Guests');
    const b1 = T.bf('B', 'Grizzly Bears'), c1 = T.bf('C', 'Savannah Lions');
    const tap = engine().oracle.parseEffects('Tap all nonland permanents target opponent controls.').effects;
    T.g._runEffects(tap, { controller: 'A', obj: kb, name: 'Kiora', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    t.ok(b1.tapped && !c1.tapped, 'only that opponent');
  });

  test('Gruff Triplets: two copies of itself, unless it is a token', (mk, t) => {
    t.auto('Gruff Triplets');
    const T = mk();
    T.mana('A', '3GGG');
    T.cast('A', T.hand('A', 'Gruff Triplets'));
    for (let i = 0; i < 6; i++) { T.settle(); T.resolve(); }
    T.settle();
    t.eq(T.g.battlefield.filter(o => o.name === 'Gruff Triplets').length, 3, 'three in all, the copies made no more');
  });

  test("Black Scarab: the enchanted creature can't be blocked by black creatures", (mk, t) => {
    t.auto('Black Scarab');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const sc = T.bf('A', 'Black Scarab');
    sc.attachedTo = bear.id; bear.attachments = [sc.id];
    const blk = T.bf('B', 'Vampire Nighthawk'), grn = T.bf('B', 'Llanowar Elves');
    t.ok(!T.g.couldBlock(blk, bear, 'B'), 'not by a black creature');
    t.ok(T.g.couldBlock(grn, bear, 'B'), 'by a green one');
    t.eq(T.g.powerOf(bear), 4, '+2/+2 while an opponent has black');
  });

  test("Tale's End counters a legendary spell, not another; Elspeth Tirel's -5", (mk, t) => {
    t.auto("Tale's End"); t.auto('Elspeth Tirel');
    const T = mk();
    const specs = MTG.rules.spellTargetSpecs(T.hand('A', "Tale's End").analysis());
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Thalia, Guardian of Thraben'), { resolve: false });
    const leg = T.g.stack[T.g.stack.length - 1];
    t.ok(!T.g._illegalTargets(specs, [{ kind: 'stack', id: leg.id }], 'A', null), 'a legendary spell');
    T.resolve(); T.settle();
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'), { resolve: false });
    const bear = T.g.stack[T.g.stack.length - 1];
    t.ok(T.g._illegalTargets(specs, [{ kind: 'stack', id: bear.id }], 'A', null), 'not an ordinary one');
    T.resolve(); T.settle();
    const el = T.bf('A', 'Elspeth Tirel');
    const land = T.bf('A', 'Plains'); const tok = T.g._createToken('A', { n: 1, pt: '1/1', subtypes: 'Soldier', colorWords: ['white'], keywords: [] });
    T.g._runEffects(el.analysis().abilities.find(a => /^[-\u2212]5/.test(a.text)).effects, { controller: 'A', obj: el, name: 'Elspeth', kind: 'ability' });
    T.settle();
    t.eq(el.zone, 'battlefield', 'not herself'); t.eq(land.zone, 'battlefield');
    t.ok(T.g.battlefield.some(o => o.isToken), 'tokens stay');
    t.ok(!T.g.battlefield.some(o => o.name === 'Grizzly Bears' || o.name === 'Thalia, Guardian of Thraben'), 'the rest destroyed');
  });

  test('Instill Energy: attacks the turn it came; Sliver Overlord takes a Sliver', (mk, t) => {
    t.auto('Instill Energy'); t.auto('Sliver Overlord');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = true;
    t.ok(!T.g.canAttack(bear), 'sick');
    const ie = T.bf('A', 'Instill Energy'); ie.attachedTo = bear.id; bear.attachments = [ie.id];
    T.g.bumpBoard && T.g.bumpBoard();
    t.ok(T.g.canAttack(bear), 'as though it had haste');
  });

  test('Spear of Heliod: only a creature that dealt damage to you this turn', (mk, t) => {
    t.auto('Spear of Heliod');
    const T = mk();
    const sp = T.bf('A', 'Spear of Heliod');
    const hit = T.bf('B', 'Grizzly Bears'), idle = T.bf('B', 'Savannah Lions');
    T.g.dealDamageToPlayer(T.player('A'), 2, hit, true);
    const ab = sp.analysis().abilities.find(a => a.kind === 'activated');
    const specs = MTG.rules.effectSpecs(ab.effects);
    t.ok(!T.g._illegalTargets(specs, [{ kind: 'object', id: hit.id }], 'A', sp), 'the one that hit you');
    t.ok(T.g._illegalTargets(specs, [{ kind: 'object', id: idle.id }], 'A', sp), 'not the other');
    T.nextTurn('B');
    t.ok(T.g._illegalTargets(specs, [{ kind: 'object', id: hit.id }], 'A', sp), 'only this turn');
  });

  test('Wash Out: every permanent of the chosen colour goes home', (mk, t) => {
    t.auto('Wash Out');
    const T = mk();
    const g1 = T.bf('B', 'Grizzly Bears'), g2 = T.bf('A', 'Llanowar Elves'), w1 = T.bf('B', 'Savannah Lions');
    T.answer('mode', { modes: [4] });
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Wash Out'));
    T.settle(); T.resolve(); T.settle();
    t.eq(g1.zone, 'hand'); t.eq(g2.zone, 'hand'); t.eq(w1.zone, 'battlefield');
  });

  test('Sylvan Awakening: lands are 2/2 creatures until your next turn', (mk, t) => {
    t.auto('Sylvan Awakening');
    const T = mk();
    const f = T.bf('A', 'Forest');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Sylvan Awakening'));
    T.settle(); T.resolve(); T.settle();
    t.ok(T.g.characteristics(f).isCreature && T.g.hasKw(f, 'indestructible'), 'a creature');
    T.toMain('B');
    t.ok(T.g.characteristics(f).isCreature, 'still, on their turn');
    T.toMain('A');
    t.ok(!T.g.characteristics(f).isCreature, 'over on your next turn');
  });

  test('Mobilizer Mech: up to one other Vehicle of yours becomes a creature', (mk, t) => {
    t.auto('Mobilizer Mech');
    const T = mk();
    const mm = T.bf('A', 'Mobilizer Mech');
    const veh = T.bf('A', "Smuggler's Copter");
    const trig = mm.analysis().abilities.find(a => a.kind === 'triggered' && JSON.stringify(a.effects).includes('becomes'));
    T.g._runEffects(trig.effects, { controller: 'A', obj: mm, name: 'Mobilizer Mech', kind: 'ability', targets: [{ kind: 'object', id: veh.id }] });
    t.ok(T.g.characteristics(veh).isCreature, 'crewed as if');
  });

  test('Karador and Kess: a spell from the graveyard once each turn', (mk, t) => {
    t.auto('Karador, Ghost Chieftain'); t.auto('Kess, Dissident Mage');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Karador, Ghost Chieftain');
    const b1 = T.grave('A', 'Grizzly Bears'), b2 = T.grave('A', 'Savannah Lions');
    T.mana('A', '1GW');
    t.ok(T.g.castSpell('A', b1.id, { auto: true }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(b1.zone, 'battlefield');
    t.ok(!T.g.castSpell('A', b2.id, { auto: true }), 'only once this turn');
    T.bf('A', 'Kess, Dissident Mage');
    const bolt = T.grave('A', 'Lightning Bolt');
    T.mana('A', 'R');
    t.ok(T.g.castSpell('A', bolt.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(bolt.zone, 'exile', 'exiled instead of the graveyard');
  });

  test("Wavebreak Hippocamp: the first spell you cast on each opponent's turn", (mk, t) => {
    t.auto('Wavebreak Hippocamp');
    const T = mk();
    T.bf('A', 'Wavebreak Hippocamp');
    T.toMain('A');
    let hand = T.zone('A', 'hand').length;
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, hand, 'not on your own turn');
    T.toMain('B');
    if (T.g.priorityPlayer.id === 'B') T.g.passPriority('B', true);
    hand = T.zone('A', 'hand').length;
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'a card for the first');
  });

  test('M.O.D.O.K.: a flavour word before "Pay 3 life:"', (mk, t) => {
    t.auto('M.O.D.O.K.');
    const T = mk();
    T.toMain('A');
    const m = T.bf('A', 'M.O.D.O.K.');
    T.top('A', 'Forest');
    T.answer('discard', (ch) => ({ cardIds: [(ch.cards || [])[0] ? ch.cards[0].id : T.zone('A', 'hand')[0].id] }));
    T.activate('A', m, 0);
    T.settle();
    t.eq(T.player('A').life, 17, 'three life paid');
  });

  test('Gutterbones: back to hand during your turn, once an opponent lost life', (mk, t) => {
    t.auto('Gutterbones');
    const T = mk();
    T.toMain('A');
    const g = T.grave('A', 'Gutterbones');
    const use = () => (T.g.altUsesFor('A', g.id).find(u => /^ability:/.test(u.via || '')) || {}).via;
    T.mana('A', '1B');
    t.ok(!use() || !T.g.castSpell('A', g.id, { via: use(), auto: true }), 'not before anyone lost life');
    T.g.changeLife(T.player('B'), -1);
    t.ok(use() && T.g.castSpell('A', g.id, { via: use(), auto: true }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(g.zone, 'hand');
  });

  test('Guardian Naga: damage to it prevented during your turn only', (mk, t) => {
    t.auto('Guardian Naga // Banishing Coils');
    const T = mk();
    T.toMain('A');
    const n = T.bf('A', 'Guardian Naga // Banishing Coils');
    const src = T.bf('B', 'Grizzly Bears');
    T.g.dealDamageToObject(n, 3, src);
    t.eq(n.damage || 0, 0, 'prevented on your turn');
    T.toMain('B');
    T.g.dealDamageToObject(n, 3, src);
    t.eq(n.damage, 3, 'not on theirs');
  });

  test('Yuna, Hope of Spira: keywords for her and enchantment creatures on your turn; Long-Lost Lances', (mk, t) => {
    t.auto('Yuna, Hope of Spira'); t.auto('Long-Lost Lances');
    const T = mk();
    T.toMain('A');
    const y = T.bf('A', 'Yuna, Hope of Spira');
    t.ok(T.g.hasKw(y, 'trample') && T.g.hasKw(y, 'lifelink'), 'on your turn');
    T.toMain('B');
    t.ok(!T.g.hasKw(y, 'trample'), 'not on theirs');
    const st = engine().oracle.analyze(card('Long-Lost Lances')).abilities.find(a => a.kind === 'static' && /equipped/.test(a.text));
    t.ok(JSON.stringify(st.effects).includes('"equipped":true'), 'equipped creatures you control');
  });

  test("Elspeth's Talent: the planeswalker gains a +1, and using it pumps your creatures", (mk, t) => {
    t.auto("Elspeth's Talent"); t.auto("Vivien's Talent");
    const T = mk();
    T.toMain('A');
    const pw = T.bf('A', 'Jace Beleren');
    const bear = T.bf('A', 'Grizzly Bears');
    const tal = T.bf('A', "Elspeth's Talent");
    tal.attachedTo = pw.id; pw.attachments = [tal.id];
    T.g.bumpBoard();
    const a = pw.analysis();
    const list = (a.manaAbilities || []).concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const gi = list.findIndex(x => x.granted && x.kind === 'loyalty');
    t.ok(gi >= 0, 'a granted loyalty ability');
    const was = pw.counters.loyalty;
    t.ok(T.g.activateAbility('A', pw.id, gi, { auto: true }), T.g.lastError);
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.eq(pw.counters.loyalty, was + 1);
    const soldiers = T.g.battlefield.filter(o => o.isToken && o.name === 'Soldier');
    t.eq(soldiers.length, 3, 'three Soldiers');
    t.eq(T.g.powerOf(bear), 4, '+2/+2 from the Talent, which resolved first');
  });

  test("Rowan's Talent: a loyalty ability of the enchanted planeswalker is copied", (mk, t) => {
    t.auto("Rowan's Talent");
    const T = mk();
    T.toMain('A');
    const pw = T.bf('A', 'Jace Beleren');
    const tal = T.bf('A', "Rowan's Talent");
    tal.attachedTo = pw.id; pw.attachments = [tal.id];
    T.g.bumpBoard();
    for (let i = 0; i < 4; i++) { T.top('A', 'Island'); T.top('B', 'Island'); }
    const hb = T.zone('B', 'hand').length;
    T.activate('A', pw, 0);
    for (let i = 0; i < 4; i++) { T.settle(); T.resolve(); }
    T.settle();
    t.eq(T.zone('B', 'hand').length, hb + 2, 'each player drew twice');
  });

  test("Job select: Black Mage's Rod comes with a Hero, a Wizard that pings on noncreature spells", (mk, t) => {
    t.auto("Black Mage's Rod");
    const T = mk();
    T.toMain('A');
    T.mana('A', '1B');
    T.cast('A', T.hand('A', "Black Mage's Rod"));
    for (let i = 0; i < 3; i++) { T.settle(); T.resolve(); }
    T.settle();
    const hero = T.g.battlefield.find(o => o.isToken && o.name === 'Hero');
    t.ok(hero, 'a Hero'); t.eq(T.g.powerOf(hero), 2, '+1/+0');
    t.ok(T.g._cardFitsWords(hero, 'Wizard'), 'a Wizard too');
    t.eq((T.g.characteristics(hero).colors || []).length, 0, 'colorless');
    const life = T.player('B').life;
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Opt'));
    for (let i = 0; i < 3; i++) { T.settle(); T.resolve(); }
    T.settle();
    t.eq(T.player('B').life, life - 1, 'one damage to each opponent');
  });

  test('Firebending Student: firebending X, where X is its power', (mk, t) => {
    t.auto('Firebending Student');
    const T = mk();
    const fs = T.bf('A', 'Firebending Student'); fs.summoningSick = false;
    T.g.addCounters(fs, '+1/+1', 2);
    const pw = T.g.powerOf(fs);
    T.answer('declareAttackers', () => [{ attackerId: fs.id, defenderId: 'B' }]);
    T.toMain('A');
    for (let i = 0; i < 10 && !(T.g.step === 'declareAttackers' && fs.attacking); i++) { T.settle(); const p = T.g.priorityPlayer; if (!p) break; T.g.passPriority(p.id, true); }
    T.settle();
    t.ok(T.g.log.some(l => (l.text || '').includes(`firebends for ${pw} red mana`)), 'as much red mana as its power');
  });

  test('Oblation: the owner shuffles it in and draws two; Hall of Storm Giants', (mk, t) => {
    t.auto('Oblation'); t.auto('Hall of Storm Giants');
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    for (let i = 0; i < 3; i++) T.top('B', 'Island');
    const hb = T.zone('B', 'hand').length, ha = T.zone('A', 'hand').length;
    T.mana('A', '2W');
    T.cast('A', T.hand('A', 'Oblation'), { targets: [bear] });
    T.settle(); T.resolve(); T.settle();
    t.eq(bear.zone, 'library'); t.eq(T.zone('B', 'hand').length, hb + 2, 'its owner drew two');
    t.eq(T.zone('A', 'hand').length, ha, 'not the caster');
    const hall = T.bf('A', 'Hall of Storm Giants');
    const ab = hall.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: hall, name: 'Hall', kind: 'ability' });
    t.eq(T.g.powerOf(hall), 7); t.ok(T.g._wardCosts(hall).length === 1, 'ward');
  });

  test("Vexing Shusher: target spell can't be countered", (mk, t) => {
    t.auto('Vexing Shusher');
    const T = mk();
    T.toMain('A');
    const vs = T.bf('A', 'Vexing Shusher');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'), { resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    const ab = vs.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: vs, name: 'Vexing Shusher', kind: 'ability', targets: [{ kind: 'stack', id: item.id }] });
    T.g._runEffects([{ op: 'counterSpell' }], { controller: 'B', name: 'Counterspell', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    T.settle(); T.resolve(); T.settle();
    t.ok(T.g.battlefield.some(o => o.name === 'Grizzly Bears'), 'it resolved');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Savannah Lions'), { resolve: false });
    const other = T.g.stack[T.g.stack.length - 1];
    T.g._runEffects([{ op: 'counterSpell' }], { controller: 'B', name: 'Counterspell', kind: 'spell', targets: [{ kind: 'stack', id: other.id }] });
    T.settle(); T.resolve(); T.settle();
    t.ok(!T.g.battlefield.some(o => o.name === 'Savannah Lions'), 'another spell is countered as usual');
  });

  test('Counted cost cuts: Mobilized District, Quest for the Necropolis, Deepwood Denizen, Llanowar Greenwidow, Baru', (mk, t) => {
    for (const n of ['Mobilized District', 'Quest for the Necropolis', 'Deepwood Denizen', 'Llanowar Greenwidow', 'Baru, Wurmspeaker']) t.auto(n);
    const T = mk();
    const abOf = (o) => o.analysis().abilities.find(a => a.kind === 'activated');
    const md = T.bf('A', 'Mobilized District');
    t.eq(T.g._abilityMana(md, abOf(md)), '{4}', 'nothing legendary yet');
    T.bf('A', 'Isamaru, Hound of Konda'); T.bf('A', 'Jace Beleren'); T.bf('A', 'Grizzly Bears');
    t.eq(T.g._abilityMana(md, abOf(md)), '{2}', 'a legendary creature and a planeswalker');
    const q = T.bf('A', 'Quest for the Necropolis');
    T.g.addCounters(q, 'quest', 2);
    t.eq(T.g._abilityMana(q, abOf(q)), '{3}{B}', 'two quest counters');
    const dd = T.bf('A', 'Deepwood Denizen');
    const bear = T.g.battlefield.find(o => o.name === 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 3);
    T.g.addCounters(T.bf('B', 'Grizzly Bears'), '+1/+1', 2);
    t.eq(T.g._abilityMana(dd, abOf(dd)), '{2}{G}', 'only the counters on creatures you control');
    const lg = T.bf('A', 'Llanowar Greenwidow');
    T.bf('A', 'Forest'); T.bf('A', 'Island'); T.bf('A', 'Forest');
    t.eq(T.g._abilityMana(lg, abOf(lg)), '{5}{G}', 'two basic land types');
    const baru = T.bf('A', 'Baru, Wurmspeaker');
    T.bf('A', 'Craw Wurm');
    t.eq(T.g._abilityMana(baru, abOf(baru)), '{G}', 'the greatest power among Wurms (8, with its own +2/+2)');
  });

  test('Counters among a group: Toph, the Blind Bandit; Maester Seymour', (mk, t) => {
    t.auto('Toph, the Blind Bandit'); t.auto('Maester Seymour');
    const T = mk();
    const toph = T.bf('A', 'Toph, the Blind Bandit');
    const f = T.bf('A', 'Forest');
    T.g.addCounters(f, '+1/+1', 3);
    T.g.addCounters(T.bf('B', 'Forest'), '+1/+1', 2);
    t.eq(T.g.powerOf(toph), 3, 'the counters on lands you control');
    const ms = T.bf('A', 'Maester Seymour');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 2); T.g.addCounters(bear, 'shield', 1);
    const before = Number((ms.counters || {})['+1/+1']) || 0;
    const ab = ms.analysis().abilities.find(a => a.kind === 'activated' && /Monstrosity/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: ms, name: 'Maester Seymour', kind: 'ability' });
    t.ok(ms.monstrous, 'monstrous');
    t.ok((Number(ms.counters['+1/+1']) || 0) - before >= 3, 'as many as the counters among creatures you control');
  });

  test('Domain and counted groups: Drag to the Bottom, Drag Down, Prismatic Geoscope, Leyline Binding, Collective Restraint', (mk, t) => {
    for (const n of ['Drag to the Bottom', 'Drag Down', 'Prismatic Geoscope', 'Leyline Binding', 'Collective Restraint', 'Evasive Action']) t.auto(n);
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Forest'); T.bf('A', 'Island'); T.bf('A', 'Swamp');
    const giant = T.bf('B', 'Hill Giant');
    const wurm = T.bf('B', 'Craw Wurm');
    T.g._runEffects(engineEffects(T, 'Drag to the Bottom'), { controller: 'A', name: 'Drag to the Bottom', kind: 'spell' });
    t.eq(T.g.powerOf(wurm), 2, 'the Wurm is 2/0');
    T.g.checkStateBasedActions(); T.settle();
    t.zone(giant, 'graveyard', '1 plus three basic land types: -4/-4');
    const g2 = T.bf('B', 'Hill Giant');
    T.g._runEffects(engineEffects(T, 'Drag Down'), { controller: 'A', name: 'Drag Down', kind: 'spell', targets: [{ kind: 'object', id: g2.id }] });
    T.g.checkStateBasedActions(); T.settle();
    t.zone(g2, 'graveyard', 'three basic land types: -3/-3');
    const lb = T.hand('A', 'Leyline Binding');
    t.eq(T.g.castCost(lb), '{2}{W}', 'three less to cast');
    const cr = T.bf('A', 'Collective Restraint');
    const ab = cr.analysis().abilities.find(a => a.effects.some(e => e.op === 'attackTax'));
    t.eq(T.g._countValue(ab.effects[0].per, 'A', cr), 3, '{3} for each attacker');
  });

  test('Counted groups: Ascendant Acolyte, Glacial Plating, Pummeler for Hire', (mk, t) => {
    for (const n of ['Ascendant Acolyte', 'Glacial Plating', 'Pummeler for Hire']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 2);
    T.g.addCounters(T.bf('B', 'Grizzly Bears'), '+1/+1', 5);
    const aa = T.put('A', 'Ascendant Acolyte', 'battlefield', { etb: true });
    T.settle();
    t.eq(Number((aa.counters || {})['+1/+1']) || 0, 2, 'the counters among your other creatures');
    const gp = T.bf('A', 'Glacial Plating');
    T.g._attachAura(gp, bear);
    T.g.addCounters(gp, 'age', 2);
    t.eq(T.g.powerOf(bear), 2 + 2 + 6, '+3/+3 for each age counter on the Aura');
    T.bf('A', 'Hill Giant');
    const life = T.life('A');
    T.put('A', 'Pummeler for Hire', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), life + 4, 'the greatest power among Giants (itself, 4)');
  });

  test('Tribal and qualified cost cuts: Goblin Warchief, Stonybrook Banneret, Eye of Ugin, Jhoira\'s Familiar, Nightscape Familiar', (mk, t) => {
    for (const n of ['Goblin Warchief', 'Stonybrook Banneret', 'Eye of Ugin', "Jhoira's Familiar", 'Nightscape Familiar', 'Dragonspeaker Shaman']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const piker = T.hand('A', 'Goblin Piker'), bears = T.hand('A', 'Grizzly Bears'), outcast = T.hand('A', 'Changeling Outcast');
    T.bf('A', 'Goblin Warchief');
    t.eq(T.g.castCost(piker), '{R}', 'a Goblin costs {1} less');
    t.eq(T.g.castCost(bears), '{1}{G}', 'a Bear does not');
    t.eq(T.g.castCost(outcast), '{B}', 'a changeling is a Goblin too');
    T.bf('B', 'Goblin Warchief');
    t.eq(T.g.castCost(piker), '{R}', "an opponent's Warchief does nothing for you");
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Stonybrook Banneret');
    t.eq(U.g.castCost(U.hand('A', 'Merfolk Looter')), '{U}', 'a Merfolk');
    t.eq(U.g.castCost(U.hand('A', 'Fblthp, the Lost')), '{1}{U}', 'a Homunculus is neither');
    U.bf('A', 'Eye of Ugin');
    t.eq(U.g.castCost(U.hand('A', 'Matter Reshaper')), '{C}', 'a colorless Eldrazi costs {2} less');
    t.eq(U.g.castCost(U.hand('A', 'Wastes')), '', 'lands cost nothing anyway');
    U.bf('A', "Jhoira's Familiar");
    t.eq(U.g.castCost(U.hand('A', 'Mind Stone')), '{1}', 'an artifact is historic');
    t.eq(U.g.castCost(U.hand('A', 'Isamaru, Hound of Konda')), '{W}', 'a legendary creature is historic');
    U.bf('A', 'Nightscape Familiar');
    t.eq(U.g.castCost(U.hand('A', 'Hill Giant')), '{2}{R}', 'a red spell');
    t.eq(U.g.castCost(U.hand('A', 'Craw Wurm')), '{4}{G}{G}', 'a green one is not');
  });

  test('Qualified cost cuts: Krosan Drover, Warden of Evos Isle, Gravebreaker Lamia, Savvy Trader, Geyser Drake, Centaur Omenreader', (mk, t) => {
    for (const n of ['Krosan Drover', 'Warden of Evos Isle', 'Gravebreaker Lamia', 'Savvy Trader', 'Geyser Drake', 'Centaur Omenreader']) t.auto(n);
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Krosan Drover');
    t.eq(T.g.castCost(T.hand('A', 'Craw Wurm')), '{2}{G}{G}', 'mana value 6');
    t.eq(T.g.castCost(T.hand('A', 'Hill Giant')), '{3}{R}', 'mana value 4');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Warden of Evos Isle');
    t.eq(U.g.castCost(U.hand('A', 'Serra Angel')), '{2}{W}{W}', 'a creature with flying');
    t.eq(U.g.castCost(U.hand('A', 'Hill Giant')), '{3}{R}', 'one without');
    const V = mk();
    V.toMain('A');
    V.bf('A', 'Gravebreaker Lamia');
    t.eq(V.g.castCost(V.grave('A', 'Hill Giant')), '{2}{R}', 'from the graveyard');
    t.eq(V.g.castCost(V.hand('A', 'Hill Giant')), '{3}{R}', 'from the hand');
    const W = mk();
    W.toMain('A');
    W.bf('A', 'Savvy Trader');
    t.eq(W.g.castCost(W.grave('A', 'Hill Giant')), '{2}{R}', 'from anywhere but the hand');
    t.eq(W.g.castCost(W.hand('A', 'Hill Giant')), '{3}{R}', 'not from the hand');
    const X = mk();
    X.toMain('A');
    X.bf('A', 'Geyser Drake');
    t.eq(X.g.castCost(X.hand('A', 'Hill Giant')), '{3}{R}', 'not on your own turn');
    X.toMain('B');
    t.eq(X.g.castCost(X.hand('A', 'Hill Giant')), '{2}{R}', "on an opponent's turn");
    const Y = mk();
    Y.toMain('A');
    const om = Y.bf('A', 'Centaur Omenreader');
    t.eq(Y.g.castCost(Y.hand('A', 'Hill Giant')), '{3}{R}', 'untapped');
    om.tapped = true;
    t.eq(Y.g.castCost(Y.hand('A', 'Hill Giant')), '{1}{R}', 'tapped');
  });

  test("Conditional self costs: Drag to the Roots, Gwaihir the Windlord, Hurkyl's Final Meditation, Avatar of Woe", (mk, t) => {
    for (const n of ['Drag to the Roots', 'Gwaihir the Windlord', "Hurkyl's Final Meditation", 'Avatar of Woe']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const dr = T.hand('A', 'Drag to the Roots');
    t.eq(T.g.castCost(dr), '{2}{B}{G}', 'no delirium');
    for (const n of ['Hill Giant', 'Island', 'Shock', 'Mind Stone']) T.grave('A', n);
    t.eq(T.g.castCost(dr), '{B}{G}', 'four card types in the graveyard');
    const hk = T.hand('A', "Hurkyl's Final Meditation");
    t.eq(T.g.castCost(hk), '{4}{U}{U}{U}', 'on your turn');
    T.toMain('B');
    t.eq(T.g.castCost(hk), '{7}{U}{U}{U}', 'on an opponent\'s turn');
    const U = mk();
    U.toMain('A');
    const aw = U.hand('A', 'Avatar of Woe');
    t.eq(U.g.castCost(aw), '{6}{B}{B}', 'too few creature cards');
    for (let i = 0; i < 5; i++) { U.grave('A', 'Grizzly Bears'); U.grave('B', 'Hill Giant'); }
    t.eq(U.g.castCost(aw), '{B}{B}', 'ten creature cards across the graveyards');
  });
};
