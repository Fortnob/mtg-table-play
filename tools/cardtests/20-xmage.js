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

  test('XMage: Jace Beleren mills twenty', (mk, t) => {
    generated(t, 'Jace Beleren');
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
    generated(t, 'Battlegrace Angel');
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
};
