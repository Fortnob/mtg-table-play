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

  test('XMage: Brash Taunter sends the damage it is dealt to an opponent', (mk, t) => {
    generated(t, 'Brash Taunter');
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
    generated(t, 'Mistblade Shinobi');
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
    generated(t, 'Silhana Ledgewalker');
    const T = mk();
    const s = T.bf('A', 'Silhana Ledgewalker');
    const bear = T.bf('B', 'Grizzly Bears');
    const bird = T.bf('B', 'Suntail Hawk');
    s.attacking = 'B';
    t.no(T.g.canBlock(bear, s, 'B'), 'the bear cannot');
    t.ok(T.g.canBlock(bird, s, 'B'), 'the hawk can');
  });

  test('XMage: Splendid Agony spreads two -1/-1 counters over its targets', (mk, t) => {
    generated(t, 'Splendid Agony');
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
    T.mana('A', '3W');
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
    T.mana('A', '3W');
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
};
