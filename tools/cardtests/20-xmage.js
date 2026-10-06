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

  test('A clone exception that grants a keyword is read as words for the copy', (mk, t) => {
    const card = { name: 'Hasty Mimic', type_line: 'Creature — Shapeshifter', mana_cost: '{3}{U}', cmc: 4, power: '0', toughness: '0',
      colors: ['U'], layout: 'normal', oracle_text: 'You may have this creature enter as a copy of a creature you control, except it has haste.' };
    t.ok(engine().oracle.analyze(card).abilities[0].effects[0].addText.includes('Haste'));
  });
};
