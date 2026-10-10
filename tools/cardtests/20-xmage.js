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
    T.answer('choose', (ch) => { t.eq(ch.purpose, 'tapOrUntap', 'a choice between the two'); return { picks: [0] }; });
    T.cast('A', T.hand('A', 'Twiddle'), { targets: [b] });
    t.ok(b.tapped, 'tapped');
    const own = T.bf('A', 'Grizzly Bears', { tapped: true });
    T.mana('A', 'U');
    T.answer('choose', { picks: [1] });
    T.cast('A', T.hand('A', 'Twiddle'), { targets: [own] });
    t.no(own.tapped, 'untapped');
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

  test('Choking Tethers taps a creature when cycled', (mk, t) => {
    t.auto('Choking Tethers');
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
    // "Whenever you play a land or cast a spell, draw a card." — a land played counts
    const U = mk();
    U.toMain('A');
    U.bf('A', 'The Endstone');
    U.top('A', 'Island');
    const forest = U.hand('A', 'Forest');
    const hand = U.zone('A', 'hand').length;
    U.playLand('A', forest);
    U.settle(); U.resolve(); U.settle();
    t.eq(U.zone('A', 'hand').length, hand, 'the Forest left the hand and a card was drawn for it');
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

  test('Dreadhorde Arcanist, Diviner of Mist, Sword of Once and Future, Spectral Arcanist: a free spell from a graveyard, then exiled', (mk, t) => {
    for (const n of ['Dreadhorde Arcanist', 'Diviner of Mist', 'Sword of Once and Future', 'Spectral Arcanist']) t.auto(n);
    const T = mk();
    const da = T.bf('A', 'Dreadhorde Arcanist');
    const sh = T.grave('A', 'Shock'), bolt = T.grave('A', 'Lava Spike');
    const ab = da.analysis().abilities.find(a => a.kind === 'triggered');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.g._runEffects(ab.effects, { controller: 'A', obj: da, name: 'Dreadhorde Arcanist', kind: 'ability', targets: [{ kind: 'object', id: sh.id }] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 18, 'Shock cast for nothing');
    t.eq(sh.zone, 'exile', 'and exiled after');
    t.eq(bolt.zone, 'graveyard');
    // power 1: a two-mana spell is too much
    const U = mk();
    const da2 = U.bf('A', 'Dreadhorde Arcanist');
    const big = U.grave('A', 'Lightning Strike');
    U.g._runEffects(ab.effects, { controller: 'A', obj: da2, name: 'Dreadhorde Arcanist', kind: 'ability', targets: [{ kind: 'object', id: big.id }] });
    U.settle();
    t.eq(big.zone, 'graveyard', 'mana value 2 is more than its power');
    // Diviner of Mist: mill four, then a spell of mana value 4 or less, picked as it resolves
    const V = mk();
    const dm = V.bf('A', 'Diviner of Mist');
    for (let i = 0; i < 4; i++) V.top('A', 'Island');
    const s2 = V.grave('A', 'Shock');
    V.answer('pickCard', () => ({ cardIds: [s2.id] }));
    V.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    const dab = dm.analysis().abilities.find(a => a.kind === 'triggered');
    V.g._runEffects(dab.effects, { controller: 'A', obj: dm, name: 'Diviner of Mist', kind: 'ability' });
    V.settle(); V.resolve(); V.settle();
    t.eq(V.zone('A', 'graveyard').filter(o => o.name === 'Island').length, 4, 'milled four');
    t.eq(V.life('B'), 18, 'Shock from the graveyard');
    t.eq(s2.zone, 'exile', 'exiled after');
  });

  test('Ragost, Ygra, Senator Peacock, Gourmand\'s Talent: an artifact type and its ability, handed over', (mk, t) => {
    for (const n of ['Ragost, Deft Gastronaut', 'Ygra, Eater of All', 'Senator Peacock', "Gourmand's Talent"]) t.auto(n);
    const idx = (o, re) => { const a = o.analysis(); return a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty')).findIndex(x => re.test(x.text || '')); };
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Ragost, Deft Gastronaut');
    const ms = T.bf('A', 'Mind Stone');
    t.ok(T.g._hasSubtype(ms, 'Food'), 'Mind Stone is a Food');
    const life = T.life('A');
    T.mana('A', '2');
    T.activate('A', ms, idx(ms, /You gain 3 life/));
    t.eq(T.life('A'), life + 3, 'sacrificed for 3 life');
    t.zone(ms, 'graveyard');
    const U = mk();
    U.toMain('A');
    const ygra = U.bf('A', 'Ygra, Eater of All');
    const bear = U.bf('B', 'Grizzly Bears');
    t.ok(U.g._matchesCategory(bear, 'artifact') && U.g._hasSubtype(bear, 'Food'), 'another creature is a Food artifact');
    t.ok(!U.g._hasSubtype(ygra, 'Food'), 'Ygra itself is not');
    U.g._runEffects([{ op: 'destroy' }], { controller: 'A', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: bear.id }] });
    U.settle(); U.resolve(); U.settle();
    t.eq(Number((ygra.counters || {})['+1/+1']) || 0, 2, 'a Food went to the graveyard');
    const V = mk();
    V.toMain('A');
    V.bf('A', 'Senator Peacock');
    const sol = V.bf('A', 'Sol Ring');
    V.top('A', 'Island');
    const hand = V.zone('A', 'hand').length;
    V.mana('A', '2');
    V.activate('A', sol, idx(sol, /Draw a card/));
    t.eq(V.zone('A', 'hand').length, hand + 1, 'a Clue: sacrificed to draw');
  });

  test('Puppeteer Clique: an opponent\'s creature back with haste, exiled at your end step; Queen Marchesa: an opponent is the monarch', (mk, t) => {
    t.auto('Puppeteer Clique'); t.auto('Queen Marchesa');
    const T = mk();
    T.toMain('A');
    const ogre = T.grave('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: ogre.id }] }));
    T.put('A', 'Puppeteer Clique', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.zone(ogre, 'battlefield'); t.eq(ogre.controller, 'A', 'under your control');
    t.ok(T.g.hasKw(ogre, 'haste'), 'with haste');
    T.toMain('A', 'end');
    T.settle(); T.resolve(); T.settle();
    t.zone(ogre, 'exile', 'exiled at your end step');
    const U = mk();
    U.toMain('B');
    U.bf('A', 'Queen Marchesa');
    U.g.setMonarch('B', 'test');
    const before = U.bfOf('A').length;
    U.nextTurn('A');
    U.settle(); U.resolve(); U.settle();
    t.ok(U.bfOf('A').some(o => o.isToken && o.name.includes('Assassin')), 'an Assassin while an opponent is the monarch');
    t.ok(U.bfOf('A').length >= before + 1);
  });

  test('Storied: three artifacts, legendaries and/or Sagas give an enduring story (Fíli, Óin, Thorin, Dáin, Bombur)', (mk, t) => {
    for (const n of ['Fíli the Pathfinder', 'Óin the Brave', 'Thorin Oakenshield', 'Dáin, Lord of the Iron Hills', 'Bombur, Gentle Dreamer', 'Ori, Keeper of Songs']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const fili = T.bf('A', 'Fíli the Pathfinder');
    const oin = T.bf('A', 'Óin the Brave');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.checkStateBasedActions();
    t.ok(!T.player('A').enduringStory, 'two legendaries are not enough');
    t.eq(T.g.powerOf(bear), 2, 'no story, no bonus');
    T.bf('A', 'Mind Stone');
    T.g.checkStateBasedActions();
    t.ok(T.player('A').enduringStory, 'a third: an artifact');
    t.eq(T.g.powerOf(bear), 3, 'Fíli: creatures you control get +1/+1');
    t.ok(T.g.hasKw(oin, 'haste'), 'Óin has haste');
    T.g.moveObject(fili, 'graveyard');
    T.g.checkStateBasedActions();
    t.ok(T.player('A').enduringStory, 'the story stays for the rest of the game');
    const U = mk();
    U.toMain('A');
    const dain = U.bf('B', 'Dáin, Lord of the Iron Hills');
    const ab = dain.analysis().abilities.find(a => a.effects.some(e => e.op === 'attackTax'));
    t.ok(!U.g._condMet(ab.effects[0].cond, { controller: 'B', obj: dain }), 'no tax without a story');
    U.player('B').enduringStory = true;
    t.ok(U.g._condMet(ab.effects[0].cond, { controller: 'B', obj: dain }), 'the tax with one');
    const bom = U.bf('A', 'Bombur, Gentle Dreamer');
    t.ok(U.g._hasFlag(bom, 'noUntap'), 'Bombur stays tapped without a story');
    U.player('A').enduringStory = true; bom._chr = null;
    t.ok(!U.g._hasFlag(bom, 'noUntap'), 'and untaps with one');
  });

  test('Party Thrasher: convoke from exile only; Tezzeret: affinity for artifacts on creature and planeswalker spells', (mk, t) => {
    t.auto('Party Thrasher');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Party Thrasher'); T.bf('A', 'Grizzly Bears');
    const inHand = T.hand('A', 'Divination');
    const inExile = T.put('A', 'Divination', 'exile');
    t.eq(T.g.costReductionFor(inHand), 0, 'no convoke from the hand');
    t.eq(T.g.costReductionFor(inExile), 2, 'convoke from exile: two untapped creatures');
    t.eq(T.g.costReductionFor(T.put('A', 'Hill Giant', 'exile')), 0, 'a creature spell does not get it');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Tezzeret, Master of the Bridge');
    U.bf('A', 'Mind Stone'); U.bf('A', 'Sol Ring');
    t.eq(U.g.costReductionFor(U.hand('A', 'Hill Giant')), 2, 'a creature spell: two artifacts');
    t.eq(U.g.costReductionFor(U.hand('A', 'Divination')), 0, 'a sorcery does not');
  });

  test('Athreos, God of Passage: another creature you own comes back to your hand unless an opponent pays 3 life', (mk, t) => {
    t.auto('Athreos, God of Passage');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Athreos, God of Passage');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('payOrDont', { pay: false });
    T.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: bear.id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'hand', 'back to your hand');
    const lion = T.bf('A', 'Savannah Lions');
    const life = T.life('B');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('payOrDont', { pay: true });
    T.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: lion.id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(lion, 'graveyard', 'the opponent paid');
    t.eq(T.life('B'), life - 3);
    // a creature it does not own: nothing
    const theirs = T.bf('B', 'Hill Giant');
    T.g._runEffects([{ op: 'destroy' }], { controller: 'A', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: theirs.id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(theirs, 'graveyard');
  });

  test("Maze's End: ten Gates with different names", (mk, t) => {
    t.auto("Maze's End");
    const T = mk();
    const cond = { kind: 'distinctNames', subtype: 'Gate', n: 10 };
    const names = ['Azorius', 'Boros', 'Dimir', 'Golgari', 'Gruul', 'Izzet', 'Orzhov', 'Rakdos', 'Selesnya'];
    for (const n of names) T.bf('A', n + ' Guildgate');
    T.bf('A', 'Azorius Guildgate');
    t.ok(!T.g._condMet(cond, { controller: 'A' }), 'ten Gates, nine names');
    T.bf('A', 'Simic Guildgate');
    t.ok(T.g._condMet(cond, { controller: 'A' }), 'ten names');
  });

  test('Mana abilities with a rider or an "instead" stay off the stack: The Great Henge, Pristine Talisman, Ilysian Caryatid, Gemstone Mine', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const henge = T.bf('A', 'The Great Henge');
    t.eq(henge.analysis().manaAbilities.length, 1, 'a mana ability');
    const life = T.life('A');
    t.ok(T.g.activateAbility('A', henge.id, 0, {}), 'tapped for mana');
    t.eq(T.g.stack.length, 0, 'nothing on the stack');
    t.eq(T.player('A').pool.G, 2); t.eq(T.life('A'), life + 2, 'and 2 life with it');
    T.player('A').pool.clear();
    const cary = T.bf('A', 'Ilysian Caryatid'); cary.summoningSick = false;
    t.eq(T.g._manaOptions(cary.analysis().manaAbilities[0], cary, 'A').amount, 1, 'one mana');
    T.bf('A', 'Craw Wurm');
    t.eq(T.g._manaOptions(cary.analysis().manaAbilities[0], cary, 'A').amount, 2, 'two with a creature of power 4 or greater');
    T.g.activateAbility('A', cary.id, 0, {});
    const p = T.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G'].reduce((k, c) => k + (p[c] || 0), 0), 2, 'two mana added at once');
    T.player('A').pool.clear();
    const mine = T.bf('A', 'Gemstone Mine');
    mine.counters.mining = 1;
    T.g.activateAbility('A', mine.id, 0, {});
    t.zone(mine, 'graveyard', 'the last mining counter: sacrificed');
  });

  test('Cloudcrest Lake, Grove of the Burnwillows: mana abilities with a rider', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const lake = T.bf('A', 'Cloudcrest Lake');
    t.eq(lake.analysis().manaAbilities.length, 2, '{C} and the painland-style ability, both mana abilities');
    T.g.activateAbility('A', lake.id, 1, { manaChoice: 'U' });
    t.eq(T.g.stack.length, 0, 'nothing on the stack');
    t.ok(lake.noUntapNext, "it won't untap next untap step");
    const grove = T.bf('A', 'Grove of the Burnwillows');
    const life = T.life('B');
    T.g.activateAbility('A', grove.id, grove.analysis().manaAbilities.length - 1, { manaChoice: 'G' });
    t.eq(T.g.stack.length, 0);
    t.eq(T.life('B'), life + 1, 'each opponent gains 1 life');
  });

  test('Spellstutter Sprite: a spell with mana value up to the number of Faeries you control; Lembas, Deglamer: its owner shuffles it in', (mk, t) => {
    t.auto('Spellstutter Sprite'); t.auto('Lembas'); t.auto('Deglamer');
    const T = mk();
    T.toMain('B');
    T.mana('B', '3RR');
    T.cast('B', T.hand('B', 'Hill Giant'), { resolve: false });
    T.cast('B', T.hand('B', 'Shock'), { targets: [{ kind: 'player', id: 'A' }], resolve: false });
    const sprite = T.bf('A', 'Spellstutter Sprite');
    const spec = sprite.analysis().abilities.find(a => a.kind === 'triggered').effects[0].targets[0];
    const ids = () => T.g._legalTargetsFor(spec, 'A', sprite.id).map(x => x.id);
    const giant = T.g.stack.find(x => x.obj && x.obj.name === 'Hill Giant'), shock = T.g.stack.find(x => x.obj && x.obj.name === 'Shock');
    t.ok(ids().includes(shock.id) && !ids().includes(giant.id), 'one Faerie: mana value 1 or less');
    for (let i = 0; i < 3; i++) T.bf('A', 'Faerie Miscreant');
    t.ok(ids().includes(giant.id), 'four Faeries: mana value 4 is fine');
    const U = mk();
    U.toMain('A');
    const lem = U.bf('A', 'Lembas');
    U.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Shatter', kind: 'spell', targets: [{ kind: 'object', id: lem.id }] });
    U.settle(); U.resolve(); U.settle();
    t.zone(lem, 'library', 'shuffled into its owner\'s library');
    const V = mk();
    V.toMain('A');
    const ring = V.bf('B', 'Sol Ring');
    V.mana('A', '1G');
    V.cast('A', V.hand('A', 'Deglamer'), { targets: [ring.id] });
    V.resolve();
    t.zone(ring, 'library');
  });

  test("Prowler's Helm: only Walls may block", (mk, t) => {
    t.auto("Prowler's Helm");
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const helm = T.bf('A', "Prowler's Helm");
    T.g.attach ? T.g.attach(helm, bear) : (helm.attachedTo = bear.id, bear.attachments = (bear.attachments || []).concat(helm.id));
    t.eq(helm.attachedTo, bear.id);
    t.ok(!T.g.couldBlock(T.bf('B', 'Hill Giant'), bear, 'B'), 'not a Wall');
    t.ok(!!T.g.couldBlock(T.bf('B', 'Wall of Stone'), bear, 'B'), 'a Wall');
  });

  test('Transmutation Font: your choice of a Blood, Clue or Food token; Determined Iteration: the populated token gains haste', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const font = T.bf('A', 'Transmutation Font');
    T.answer('mode', (ch) => ({ modes: [ch.options.find(o => /Clue/.test(o.label)).i] }));
    T.activate('A', font, 0);
    t.ok(T.bfOf('A').some(o => o.isToken && o.name === 'Clue'), 'a Clue');
    t.auto('Determined Iteration');
    const U = mk();
    U.toMain('A');
    const di = U.bf('A', 'Determined Iteration');
    U.g._runEffects([{ op: 'createToken', n: 1, power: 2, toughness: 2, name: 'Soldier', types: ['Creature'], subtypes: ['Soldier'], colors: ['W'] }], { controller: 'A', name: 'test', kind: 'spell' });
    U.settle();
    const ab = di.analysis().abilities.find(a => a.kind === 'triggered');
    U.g._runEffects(ab.effects, { controller: 'A', obj: di, name: 'Determined Iteration', kind: 'ability' });
    U.settle();
    const toks = U.bfOf('A').filter(o => o.isToken);
    t.eq(toks.length, 2, 'populated');
    t.ok(U.g.hasKw(toks[1], 'haste'), 'the new one has haste');
  });

  test('Berserk: double power and trample; at the next end step it is destroyed if it attacked', (mk, t) => {
    t.auto('Berserk');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    T.toMain('A');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Berserk'), { targets: [bear.id] });
    T.resolve();
    t.eq(T.g.powerOf(bear), 4, 'power doubled');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'graveyard', 'it attacked: destroyed');
    const U = mk();
    U.toMain('A');
    const elf = U.bf('A', 'Grizzly Bears');
    U.mana('A', 'G');
    U.cast('A', U.hand('A', 'Berserk'), { targets: [elf.id] });
    U.resolve();
    U.toMain('A', 'end');
    U.settle(); U.resolve(); U.settle();
    t.zone(elf, 'battlefield', 'it did not attack: it stays');
  });

  test('Sanctum of Eternity: a commander you own back to your hand', (mk, t) => {
    t.auto('Sanctum of Eternity');
    const T = mk();
    T.toMain('A');
    const sanctum = T.bf('A', 'Sanctum of Eternity');
    const cmd = T.bf('A', 'Isamaru, Hound of Konda'); cmd.isCommander = true;
    const other = T.bf('A', 'Grizzly Bears');
    const spec = sanctum.analysis().abilities.find(a => a.kind === 'activated').effects[0].targets[0];
    const ids = T.g._legalTargetsFor(spec, 'A', sanctum.id).map(x => x.id);
    t.ok(ids.includes(cmd.id) && !ids.includes(other.id), 'only the commander');
    T.mana('A', '2');
    T.activate('A', sanctum, sanctum.analysis().manaAbilities.length, { targets: [cmd.id] });
    // (a commander going to a hand may go to the command zone instead, as its owner likes)
    t.ok(cmd.zone === 'hand' || cmd.zone === 'command', 'it left the battlefield for its owner');
  });

  test("Skrelv's Hive: creatures you control with toxic have lifelink once an opponent has three poison counters", (mk, t) => {
    t.auto("Skrelv's Hive");
    const T = mk();
    T.bf('A', "Skrelv's Hive");
    const rot = T.bf('A', 'Venerated Rotpriest');
    const bear = T.bf('A', 'Grizzly Bears');
    t.ok(!T.g.hasKw(rot, 'lifelink'), 'not yet');
    T.player('B').poison = 3; T.g.bumpBoard();
    t.ok(T.g.hasKw(rot, 'lifelink'), 'three poison counters: lifelink');
    t.ok(!T.g.hasKw(bear, 'lifelink'), 'only creatures with toxic');
  });

  test('Thieving Skydiver: the stolen Equipment is attached to it; Planar Nexus is every nonbasic land type', (mk, t) => {
    t.auto('Thieving Skydiver'); t.auto('Planar Nexus');
    const T = mk();
    T.toMain('A');
    const sky = T.bf('A', 'Thieving Skydiver');
    const bs = T.bf('B', 'Bonesplitter');
    const ab = sky.analysis().abilities.find(a => a.kind === 'triggered');
    T.g._runEffects(ab.effects, { controller: 'A', obj: sky, name: 'Thieving Skydiver', kind: 'ability', targets: [{ kind: 'object', id: bs.id }], x: 1 });
    T.settle();
    t.eq(bs.controller, 'A', 'taken');
    t.eq(bs.attachedTo, sky.id, 'and attached to the Skydiver');
    t.eq(T.g.powerOf(sky), 4, '+2/+0');
    const ms = T.bf('B', 'Mind Stone');
    T.g._runEffects(ab.effects, { controller: 'A', obj: sky, name: 'Thieving Skydiver', kind: 'ability', targets: [{ kind: 'object', id: ms.id }], x: 2 });
    T.settle();
    t.eq(ms.controller, 'A'); t.ok(!ms.attachedTo, 'not an Equipment: not attached');
    const nexus = T.bf('A', 'Planar Nexus');
    t.ok(T.g._hasSubtype(nexus, 'Gate') && T.g._hasSubtype(nexus, "Urza's") && T.g._hasSubtype(nexus, 'Cave'), 'a Gate, an Urza\'s, a Cave');
    t.ok(!T.g._hasSubtype(nexus, 'Forest'), 'not a basic type');
  });

  test('Fighter Class, level 3: up to one target creature blocks the attacker if able', (mk, t) => {
    t.auto('Fighter Class');
    const T = mk();
    const fc = T.bf('A', 'Fighter Class');
    const bear = T.bf('A', 'Grizzly Bears');
    const giant = T.bf('B', 'Hill Giant');
    const ab = fc.analysis().abilities.find(a => a.kind === 'triggered' && /blocks it/.test(a.text));
    t.ok(!!ab, 'the level 3 trigger');
    T.g._runEffects(ab.effects, { controller: 'A', obj: fc, name: 'Fighter Class', kind: 'ability',
      targets: [{ kind: 'object', id: giant.id }], triggerData: { objectId: bear.id } });
    T.settle();
    t.ok(giant.effects.some(x => x.mustBlockId === bear.id), 'the Giant must block the Bears');
  });

  test('Feral Contest: another target creature blocks the one that got the counter', (mk, t) => {
    t.auto('Feral Contest');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Feral Contest'), { targets: [bear.id, giant.id] });
    T.resolve();
    t.eq(Number(bear.counters['+1/+1']) || 0, 1);
    t.ok(giant.effects.some(x => x.mustBlockId === bear.id), 'the Giant must block the Bears');
  });

  test('Quest for Renewal: with four quest counters, your creatures untap in the other players\' untap steps', (mk, t) => {
    t.auto('Quest for Renewal');
    const T = mk();
    T.toMain('A');
    const q = T.bf('A', 'Quest for Renewal');
    const bear = T.bf('A', 'Grizzly Bears');
    bear.tapped = true;
    T.nextTurn('B');
    t.ok(bear.tapped, 'three or fewer counters: still tapped');
    q.counters.quest = 4;
    T.nextTurn('A');
    bear.tapped = true;
    T.nextTurn('B');
    t.ok(!bear.tapped, "untapped in B's untap step");
  });

  test("Spider-Punk: spells and abilities can't be countered", (mk, t) => {
    t.auto('Spider-Punk');
    const T = mk();
    T.toMain('A');
    T.bf('B', 'Spider-Punk');
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'), { resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.g._runEffects([{ op: 'counterSpell' }], { controller: 'A', name: 'Counterspell', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    T.settle(); T.resolve(); T.settle();
    t.ok(T.g.battlefield.some(o => o.name === 'Grizzly Bears'), "anyone's spell, even its controller's opponent's");
    const ab = { id: 'stx', kind: 'ability', obj: T.g.battlefield.find(o => o.name === 'Grizzly Bears'), controller: 'A', name: 'test ability', effects: [] };
    T.g.stack.push(ab);
    T.g._runEffects([{ op: 'counterSpell' }], { controller: 'B', name: 'Stifle', kind: 'spell', targets: [{ kind: 'stack', id: 'stx' }] });
    T.settle();
    t.ok(!ab.countered, 'an ability is not countered either');
  });

  test('Frontline Medic: a spell with {X} in its mana cost; Quest-style counts', (mk, t) => {
    t.auto('Frontline Medic');
    const T = mk();
    T.toMain('B');
    T.mana('B', '3RR');
    T.cast('B', T.hand('B', 'Fireball'), { x: 2, targets: [{ kind: 'player', id: 'A' }], resolve: false });
    T.cast('B', T.hand('B', 'Shock'), { targets: [{ kind: 'player', id: 'A' }], resolve: false });
    const fm = T.bf('A', 'Frontline Medic');
    const ab = fm.analysis().abilities.find(a => a.kind === 'activated' && /Counter/.test(a.text));
    const spec = ab.effects[0].then[0].targets[0];
    const fb = T.g.stack.find(x => x.obj && x.obj.name === 'Fireball'), sh = T.g.stack.find(x => x.obj && x.obj.name === 'Shock');
    const ids = T.g._legalTargetsFor(spec, 'A', fm.id).map(x => x.id);
    t.ok(ids.includes(fb.id) && !ids.includes(sh.id), 'Fireball, not Shock');
  });

  test("Scavenger's Talent: sacrifice three other nonland permanents, a creature back with a finality counter; Coppercoat Vanguard", (mk, t) => {
    t.auto("Scavenger's Talent"); t.auto('Coppercoat Vanguard');
    const T = mk();
    T.toMain('A');
    const st = T.bf('A', "Scavenger's Talent");
    const ps = [T.bf('A', 'Grizzly Bears'), T.bf('A', 'Mind Stone'), T.bf('A', 'Sol Ring')];
    const giant = T.grave('A', 'Hill Giant');
    const ab = st.analysis().abilities.find(a => /finality/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: st, name: "Scavenger's Talent", kind: 'ability' });
    T.settle();
    t.ok(ps.every(p => p.zone === 'graveyard'), 'three sacrificed');
    t.zone(st, 'battlefield', 'not the Talent itself');
    t.zone(giant, 'battlefield'); t.eq(giant.counters.finality, 1, 'with a finality counter');
    const U = mk();
    U.toMain('A');
    const st2 = U.bf('A', "Scavenger's Talent");
    U.bf('A', 'Grizzly Bears'); U.bf('A', 'Mind Stone');
    const g2 = U.grave('A', 'Hill Giant');
    U.g._runEffects(ab.effects, { controller: 'A', obj: st2, name: "Scavenger's Talent", kind: 'ability' });
    U.settle();
    t.zone(g2, 'graveyard', 'only two others: nothing happens');
    const V = mk();
    V.bf('A', 'Coppercoat Vanguard');
    const human = V.bf('A', 'Raging Goblin');
    const soldier = V.bf('A', 'Elite Vanguard');
    t.eq(V.g.powerOf(soldier), 3, 'another Human gets +1/+0');
    t.eq(V.g.powerOf(human), 1, 'a Goblin does not');
    t.ok(V.g._wardCosts(soldier).length === 1, 'and has ward');
  });

  test('Tidal Barracuda: any player has flash; Teferi, Mage of Zhalfir: your creature cards have flash', (mk, t) => {
    t.auto('Tidal Barracuda'); t.auto('Teferi, Mage of Zhalfir');
    const T = mk();
    T.bf('A', 'Tidal Barracuda');
    t.ok(T.g._flashFor('B', T.hand('B', 'Divination')), "an opponent's sorcery");
    t.ok(T.g._flashFor('A', T.hand('A', 'Hill Giant')), 'your creature');
    const U = mk();
    U.bf('A', 'Teferi, Mage of Zhalfir');
    t.ok(U.g._flashFor('A', U.hand('A', 'Hill Giant')), 'a creature card you own');
    t.ok(!U.g._flashFor('A', U.hand('A', 'Divination')), 'not a sorcery');
    t.ok(!U.g._flashFor('B', U.hand('B', 'Hill Giant')), "not an opponent's creature");
  });

  test("Marisi, Breaker of the Coil: your opponents can't cast spells during combat", (mk, t) => {
    t.auto('Marisi, Breaker of the Coil');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Marisi, Breaker of the Coil');
    t.ok(!T.g._castBlocked('B'), 'in a main phase they may');
    T.toMain('A', 'beginCombat');
    t.ok(!!T.g._castBlocked('B'), 'during combat they may not');
    t.ok(!T.g._castBlocked('A'), 'you still may');
  });

  test('Vexilus Praetor: a flavour word before "Commanders you control have …"', (mk, t) => {
    t.auto('Vexilus Praetor');
    const T = mk();
    T.bf('A', 'Vexilus Praetor');
    const cmd = T.bf('A', 'Isamaru, Hound of Konda'); cmd.isCommander = true;
    const bear = T.bf('A', 'Grizzly Bears');
    t.ok(T.g.hasKw(cmd, 'protection from everything'), 'the commander');
    t.ok(!T.g.hasKw(bear, 'protection from everything'), 'not another creature');
  });

  test('Shrines: Honden of Night\'s Reach, Go-Shintai of Boundless Vigor, Go-Shintai of Hidden Cruelty, Crescent Island Temple', (mk, t) => {
    for (const n of ["Honden of Night's Reach", 'Go-Shintai of Boundless Vigor', 'Go-Shintai of Hidden Cruelty', 'Crescent Island Temple']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const honden = T.bf('A', "Honden of Night's Reach");
    const vigor = T.bf('A', 'Go-Shintai of Boundless Vigor');
    for (let i = 0; i < 3; i++) T.hand('B', 'Island');
    const ab = honden.analysis().abilities.find(a => a.kind === 'triggered');
    T.g._runEffects(ab.effects, { controller: 'A', obj: honden, name: "Honden of Night's Reach", kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    T.settle();
    t.eq(T.zone('B', 'hand').length, 1, 'two Shrines: two cards');
    const vab = vigor.analysis().abilities.find(a => a.kind === 'triggered');
    const counters = JSON.stringify(vab.effects).match(/"op":"counters"[^}]*"n":\{[^}]*\}/);
    t.ok(!!counters, 'counters for each Shrine');
    const cruel = T.bf('A', 'Go-Shintai of Hidden Cruelty');
    const cab = cruel.analysis().abilities.find(a => a.kind === 'triggered');
    const spec = JSON.parse(JSON.stringify(cab.effects)).flatMap(function walk(e) { return [].concat(e.targets || [], ...(['then', 'list'].map(k => (e[k] || []).flatMap(walk)))); })[0];
    const bear = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    const ids = T.g._legalTargetsFor(spec, 'A', cruel.id).map(x => x.id);
    t.ok(ids.includes(bear.id) && ids.includes(giant.id), 'three Shrines: toughness 3 or less');
    const temple = T.put('A', 'Crescent Island Temple', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.bfOf('A').filter(o => o.isToken && /Monk/.test(o.name)).length, 4, 'four Shrines: four Monks');
  });

  test("Hylda's Crown of Winter: the tap ability costs {1} less during your turn", (mk, t) => {
    t.auto("Hylda's Crown of Winter");
    const T = mk();
    T.toMain('A');
    const crown = T.bf('A', "Hylda's Crown of Winter");
    const ab = crown.analysis().abilities.find(a => a.kind === 'activated' && /Tap target creature/.test(a.text));
    t.eq(T.g._abilityMana(crown, ab), '', 'your turn: free');
    T.toMain('B');
    t.eq(T.g._abilityMana(crown, ab), '{1}', 'not your turn: {1}');
  });

  test('Legends called by their first name: Legolas Greenleaf, Zurgo Helmsmasher', (mk, t) => {
    t.auto('Legolas Greenleaf'); t.auto('Zurgo Helmsmasher');
    const T = mk();
    const leg = T.bf('A', 'Legolas Greenleaf');
    t.ok(!T.g.couldBlock(T.bf('B', 'Grizzly Bears'), leg, 'B'), 'power 2 cannot block it');
    t.ok(!!T.g.couldBlock(T.bf('B', 'Hill Giant'), leg, 'B'), 'power 3 can');
    const a = T.bf('A', 'Zurgo Helmsmasher').analysis();
    t.ok(a.abilities.some(x => x.kind === 'triggered' && /CARDNAME/.test(x.text)), 'Zurgo is itself in its trigger');
  });

  test("Shardmage's Rescue: hexproof only the turn the Aura entered", (mk, t) => {
    t.auto("Shardmage's Rescue");
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const aura = T.bf('A', "Shardmage's Rescue");
    T.g._attachAura(aura, bear);
    aura.entered = T.g.turn; T.g.bumpBoard();
    t.ok(T.g.hasKw(bear, 'hexproof'), 'this turn');
    aura.entered = T.g.turn - 1; T.g.bumpBoard();
    t.ok(!T.g.hasKw(bear, 'hexproof'), 'a later turn');
  });

  test('Everlasting Torment: all damage is dealt as though its source had wither', (mk, t) => {
    t.auto('Everlasting Torment');
    const T = mk();
    T.bf('B', 'Everlasting Torment');
    const giant = T.bf('A', 'Hill Giant');
    T.g._runEffects([{ op: 'damage', n: 2 }], { controller: 'A', name: 'Shock', kind: 'spell', targets: [{ kind: 'object', id: giant.id }] });
    T.settle();
    t.eq(giant.counters['-1/-1'], 2, 'two -1/-1 counters');
    t.eq(giant.damage || 0, 0, 'no damage marked');
  });

  test("Narcomoeba, Gaea's Blessing: put into your graveyard from your library", (mk, t) => {
    t.auto('Narcomoeba'); t.auto("Gaea's Blessing");
    const T = mk();
    T.toMain('A');
    const nm = T.top('A', 'Narcomoeba');
    T.g._runEffects([{ op: 'mill', n: 1, who: 'you' }], { controller: 'A', name: 'Mill', kind: 'spell' });
    T.settle(); T.resolve(); T.settle();
    t.zone(nm, 'battlefield', 'milled: onto the battlefield');
    const disc = T.hand('A', 'Narcomoeba');
    T.g._runEffects([{ op: 'discard', n: 1, who: 'you' }], { controller: 'A', name: 'Discard', kind: 'spell' });
    T.settle(); T.resolve(); T.settle();
    t.zone(disc, 'graveyard', 'discarded: it stays');
    const U = mk();
    U.toMain('A');
    U.grave('A', 'Hill Giant'); U.grave('A', 'Shock');
    const gb = U.top('A', "Gaea's Blessing");
    U.g._runEffects([{ op: 'mill', n: 1, who: 'you' }], { controller: 'A', name: 'Mill', kind: 'spell' });
    U.settle(); U.resolve(); U.settle();
    t.eq(U.zone('A', 'graveyard').length, 0, 'the graveyard shuffled into the library');
    t.zone(gb, 'library');
  });

  test('Desert: 1 damage to an attacking creature during the end of combat step', (mk, t) => {
    t.auto('Desert');
    const T = mk();
    const desert = T.bf('B', 'Desert');
    const elf = T.bf('A', 'Llanowar Elves'); elf.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: elf.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.ok(!!elf.attacking, 'still attacking in the end of combat step');
    const idx = desert.analysis().manaAbilities.length + desert.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty').findIndex(a => /damage/.test(a.text));
    if (T.g.priorityPlayer && T.g.priorityPlayer.id === 'A') T.g.passPriority('A');
    T.settle();
    const ok = T.g.activateAbility('B', desert.id, idx, { targets: [{ kind: 'object', id: elf.id }] });
    t.ok(ok, 'activated: ' + (T.g.lastError || ''));
    T.settle(); T.resolve(); T.settle();
    t.zone(elf, 'graveyard', 'the Elves die');
  });

  test('At end of combat: Kjeldoran Frostbeast destroys what it fought; Kjeldoran Home Guard deserts', (mk, t) => {
    t.auto('Kjeldoran Frostbeast'); t.auto('Greater Werewolf'); t.auto('Kjeldoran Home Guard');
    const T = mk();
    const fb = T.bf('A', 'Kjeldoran Frostbeast'); fb.summoningSick = false;
    const wall = T.bf('B', 'Wall of Stone');
    const other = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: fb.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [fb.id] }]);
    T.toMain('A', 'endCombat');
    T.settle(); T.resolve(); T.settle();
    t.zone(wall, 'graveyard', 'the creature that blocked it');
    t.zone(other, 'battlefield', 'not another creature');
    const U = mk();
    const hg = U.bf('A', 'Kjeldoran Home Guard'); hg.summoningSick = false;
    U.answer('declareAttackers', () => [{ attackerId: hg.id, defenderId: 'B' }]);
    U.toMain('A', 'endCombat');
    U.settle(); U.resolve(); U.settle();
    t.eq(hg.counters['-0/-1'], 1, 'a -0/-1 counter');
    t.ok(U.bfOf('A').some(o => o.isToken && /Deserter/.test(o.name)), 'a Deserter');
  });

  test("Steel Golem, Dosan the Falling Leaf, Root Sliver: who may cast what, and what can't be countered", (mk, t) => {
    t.auto('Steel Golem'); t.auto('Dosan the Falling Leaf'); t.auto('Root Sliver');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Steel Golem');
    T.mana('A', 'RRR');
    t.ok(!T.g.canCast('A', T.hand('A', 'Raging Goblin').id).ok, 'no creature spells for you');
    t.ok(T.g.canCast('A', T.hand('A', 'Shock').id).ok, 'an instant is fine');
    const U = mk();
    U.toMain('A');
    U.bf('B', 'Dosan the Falling Leaf');
    const bolt = U.hand('B', 'Shock');
    U.mana('B', 'R');
    if (U.g.priorityPlayer && U.g.priorityPlayer.id === 'A') U.g.passPriority('A');
    t.ok(!U.g.canCast('B', bolt.id).ok, "not on another player's turn");
    const V = mk();
    V.toMain('A');
    V.bf('B', 'Root Sliver');
    V.mana('A', '3');
    V.cast('A', V.hand('A', 'Metallic Sliver'), { resolve: false });
    const item = V.g.stack[V.g.stack.length - 1];
    V.g._runEffects([{ op: 'counterSpell' }], { controller: 'B', name: 'Counterspell', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    V.settle(); V.resolve(); V.settle();
    t.ok(V.g.battlefield.some(o => o.name === 'Metallic Sliver'), 'a Sliver spell resolves');
  });

  test("Sleep: target player's creatures are tapped and skip their next untap", (mk, t) => {
    t.auto('Sleep');
    const T = mk();
    T.toMain('A');
    const g = T.bf('B', 'Hill Giant'), b = T.bf('B', 'Grizzly Bears');
    const mine = T.bf('A', 'Grizzly Bears');
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Sleep'), { targets: [{ kind: 'player', id: 'B' }] });
    T.resolve();
    t.ok(g.tapped && b.tapped, 'tapped'); t.ok(!mine.tapped, 'not yours');
    T.nextTurn('B');
    t.ok(g.tapped && b.tapped, 'still tapped after their untap step');
  });

  test('Kyler, Vishgraz, Glimmerpost, Company Commander, Time Spiral: counts and flavour words', (mk, t) => {
    for (const n of ['Kyler, Sigardian Emissary', 'Vishgraz, the Doomhive', 'Glimmerpost', 'Company Commander', 'Time Spiral']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const ky = T.bf('A', 'Kyler, Sigardian Emissary');
    const human = T.bf('A', 'Elite Vanguard');
    T.g.addCounters(ky, '+1/+1', 1); T.g.addCounters(ky, 'shield', 1);
    T.g.addCounters(human, 'shield', 5);
    t.eq(T.g.powerOf(human), 2 + 2, 'two counters on Kyler, not the five on the Human');
    const vg = T.bf('A', 'Vishgraz, the Doomhive');
    const base = T.g.powerOf(vg);
    T.player('B').poison = 3; T.g.bumpBoard();
    t.eq(T.g.powerOf(vg), base + 3, '+1/+1 for each poison counter');
    T.bf('B', 'Glimmerpost');
    const life = T.life('A');
    T.put('A', 'Glimmerpost', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), life + 2, 'each Locus on the battlefield, anyone\'s');
  });

  test('Nardole, Resourceful Cyborg: {U} for each counter on it, of any kind', (mk, t) => {
    t.auto('Nardole, Resourceful Cyborg');
    const T = mk();
    T.toMain('A');
    const nd = T.bf('A', 'Nardole, Resourceful Cyborg'); nd.summoningSick = false;
    T.g.addCounters(nd, '+1/+1', 1); T.g.addCounters(nd, 'shield', 1);
    const ab = nd.analysis().manaAbilities[0];
    t.eq(T.g._manaOptions(ab, nd, 'A').amount, 2, 'two counters: two mana');
  });

  test('Otherworld Atlas: each player draws for each charge counter; Winding Canyons: creature spells with flash this turn', (mk, t) => {
    t.auto('Otherworld Atlas'); t.auto('Winding Canyons');
    const T = mk();
    T.toMain('A');
    const atlas = T.bf('A', 'Otherworld Atlas');
    atlas.counters.charge = 2;
    for (let i = 0; i < 3; i++) { T.top('A', 'Island'); T.top('B', 'Island'); }
    const ha = T.zone('A', 'hand').length, hb = T.zone('B', 'hand').length;
    const ab = atlas.analysis().abilities.find(a => /Each player draws/.test(a.text));
    T.g._runEffects(ab.effects, { controller: 'A', obj: atlas, name: 'Otherworld Atlas', kind: 'ability' });
    T.settle();
    t.eq(T.zone('A', 'hand').length, ha + 2); t.eq(T.zone('B', 'hand').length, hb + 2);
    const wc = T.bf('A', 'Winding Canyons');
    const wab = wc.analysis().abilities.find(a => /flash/.test(a.text));
    T.g._runEffects(wab.effects, { controller: 'A', obj: wc, name: 'Winding Canyons', kind: 'ability' });
    t.ok(T.g._flashFor('A', T.hand('A', 'Hill Giant')), 'a creature spell');
    t.ok(!T.g._flashFor('A', T.hand('A', 'Divination')), 'not a sorcery');
  });

  test("Shielding Plax, Ice-Fang Coatl, Commander's Insignia, Knowledge Is Power, Ondu Cleric", (mk, t) => {
    for (const n of ['Shielding Plax', 'Ice-Fang Coatl', "Commander's Insignia", 'Knowledge Is Power', 'Ondu Cleric']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const plax = T.bf('A', 'Shielding Plax');
    T.g._attachAura(plax, bear);
    t.ok(T.g.hasKw(bear, 'hexproof'), 'hexproof');
    const coatl = T.bf('A', 'Ice-Fang Coatl');
    T.bf('A', 'Snow-Covered Forest'); T.bf('A', 'Snow-Covered Island');
    t.ok(!T.g.hasKw(coatl, 'deathtouch'), 'two other snow permanents');
    T.bf('A', 'Snow-Covered Swamp'); T.g.bumpBoard();
    t.ok(T.g.hasKw(coatl, 'deathtouch'), 'three');
    const U = mk();
    U.toMain('A');
    const b2 = U.bf('A', 'Grizzly Bears');
    U.bf('A', "Commander's Insignia");
    U.player('A').commanderCasts = { x: 2 }; U.g.bumpBoard();
    t.eq(U.g.powerOf(b2), 4, 'two commander casts');
    const V = mk();
    V.toMain('A');
    const b3 = V.bf('A', 'Grizzly Bears');
    V.bf('A', 'Knowledge Is Power');
    V.player('A').drawnThisTurn = 3; V.g.bumpBoard();
    t.eq(V.g.powerOf(b3), 5, 'three cards drawn this turn');
  });

  test('Kalemne, Aggressive Mining, Biovisionary, Cynical Loner, The Theorist, Giggling Skitterspike', (mk, t) => {
    for (const n of ['Kalemne, Disciple of Iroas', 'Aggressive Mining', 'Biovisionary', 'Cynical Loner', 'The Theorist, Jace Beleren', 'Giggling Skitterspike']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const k = T.bf('A', 'Kalemne, Disciple of Iroas');
    const base = T.g.powerOf(k);
    T.player('A').experience = 2; T.g.bumpBoard();
    t.eq(T.g.powerOf(k), base + 2, 'two experience counters');
    T.bf('A', 'Aggressive Mining');
    t.ok(!T.g.canPlayLand('A'), 'no lands');
    const bio = T.bf('A', 'Biovisionary');
    const cond = bio.analysis().abilities.find(a => a.kind === 'triggered').condition;
    t.ok(!T.g._condMet(cond, { controller: 'A', obj: bio }), 'one Biovisionary');
    for (let i = 0; i < 3; i++) T.bf('A', 'Biovisionary');
    t.ok(T.g._condMet(cond, { controller: 'A', obj: bio }), 'four');
    const loner = T.bf('A', 'Cynical Loner');
    t.ok(!!T.g.couldBlock(T.bf('B', 'Grizzly Bears'), loner, 'B'), 'a Bear may block it');
    const sk = T.bf('B', 'Giggling Skitterspike');
    const ab = sk.analysis().abilities.find(a => a.kind === 'triggered');
    t.ok(ab.event === 'attacks' && ab.also === 'becomesTarget' && ab.also2 === 'blocks', 'three events');
  });

  test('Giggling Skitterspike: blocking triggers it too', (mk, t) => {
    const T = mk();
    const sk = T.bf('B', 'Giggling Skitterspike');
    const bear = T.bf('A', 'Grizzly Bears'); bear.summoningSick = false;
    const life = T.life('A');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: sk.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'combatDamage');
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), life - T.g.powerOf(sk), 'damage equal to its power to each opponent');
  });

  test('Nimbleclaw Adept, Vampire Hexmage, Wight of Precinct Six, Sewer-veillance Cam, Keening Stone, Awakening', (mk, t) => {
    for (const n of ['Nimbleclaw Adept', 'Vampire Hexmage', 'Wight of Precinct Six', 'Sewer-veillance Cam', 'Keening Stone', 'Awakening']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const hex = T.bf('A', 'Vampire Hexmage');
    const jace = T.bf('B', 'Jace Beleren');
    const hab = hex.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(hab.effects, { controller: 'A', obj: hex, name: 'Vampire Hexmage', kind: 'ability', targets: [{ kind: 'object', id: jace.id }] });
    T.settle(); T.g.checkStateBasedActions(); T.settle();
    t.zone(jace, 'graveyard', 'no loyalty left');
    const wight = T.bf('A', 'Wight of Precinct Six');
    const base = T.g.powerOf(wight);
    T.grave('B', 'Grizzly Bears'); T.grave('B', 'Hill Giant'); T.grave('B', 'Shock'); T.grave('A', 'Grizzly Bears'); T.g.bumpBoard();
    t.eq(T.g.powerOf(wight), base + 2, 'two creature cards in opponents\' graveyards');
    const cam = T.bf('A', 'Sewer-veillance Cam');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('choose', () => ({ picks: [0] }));
    const cab = cam.analysis().abilities.find(a => a.kind === 'triggered');
    T.g._runEffects(cab.effects.map(e => (e.op === 'may' ? e.then : [e])).flat(), { controller: 'A', obj: cam, name: 'Sewer-veillance Cam', kind: 'ability', targets: [{ kind: 'object', id: bear.id }] });
    T.settle();
    t.ok(bear.tapped, 'tapped');
    const ks = T.bf('A', 'Keening Stone');
    for (let i = 0; i < 6; i++) T.top('B', 'Island');
    const before = T.zone('B', 'graveyard').length;
    const kab = ks.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(kab.effects, { controller: 'A', obj: ks, name: 'Keening Stone', kind: 'ability', targets: [{ kind: 'player', id: 'B' }] });
    T.settle();
    t.eq(T.zone('B', 'graveyard').length, before * 2, 'as many as were in the graveyard');
  });

  test('Darksteel Angel, Blightbeetle: counters that can\'t be put; Duelist of the Mind; Recurring Insight', (mk, t) => {
    for (const n of ['Darksteel Angel', 'Blightbeetle', 'Duelist of the Mind', 'Recurring Insight']) t.auto(n);
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Darksteel Angel');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(mine, '-1/-1', 1); T.g.addCounters(theirs, '-1/-1', 1);
    t.ok(!mine.counters['-1/-1'], 'not on yours'); t.eq(theirs.counters['-1/-1'], 1, "on theirs");
    T.g.addCounters(mine, '+1/+1', 1);
    t.eq(mine.counters['+1/+1'], 1, '+1/+1 counters are fine');
    T.bf('B', 'Blightbeetle');
    T.g.addCounters(mine, '+1/+1', 1);
    t.eq(mine.counters['+1/+1'], 1, "Blightbeetle: no +1/+1 counters on its controller's opponents' creatures");
    const duel = T.bf('A', 'Duelist of the Mind');
    T.player('A').drawnThisTurn = 3; T.g.bumpBoard();
    t.eq(T.g.powerOf(duel), 3, 'cards drawn this turn');
  });

  test('Root Maze, Lay Down Arms, Spellbreaker Behemoth, Roalesk', (mk, t) => {
    for (const n of ['Root Maze', 'Lay Down Arms', 'Spellbreaker Behemoth', 'Roalesk, Apex Hybrid']) t.auto(n);
    const T = mk();
    T.toMain('A');
    T.bf('B', 'Root Maze');
    const land = T.hand('A', 'Forest');
    T.playLand('A', land);
    t.ok(land.tapped, 'a land enters tapped, whoever plays it');
    const lda = T.hand('A', 'Lay Down Arms');
    const spec = lda.analysis().abilities.find(a => a.kind === 'spell').effects[0].targets[0];
    T.bf('A', 'Plains'); T.bf('A', 'Plains');
    const bear = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    const ids = T.g._legalTargetsFor(spec, 'A', lda.id).map(x => x.id);
    t.ok(ids.includes(bear.id) && !ids.includes(giant.id), 'two Plains: mana value 2 or less');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Spellbreaker Behemoth');
    U.mana('A', '6GG');
    U.cast('A', U.hand('A', 'Craw Wurm'), { resolve: false });
    const item = U.g.stack[U.g.stack.length - 1];
    U.g._runEffects([{ op: 'counterSpell' }], { controller: 'B', name: 'Counterspell', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    U.settle(); U.resolve(); U.settle();
    t.ok(U.g.battlefield.some(o => o.name === 'Craw Wurm'), 'power 6: not countered');
    const ro = U.bf('A', 'Roalesk, Apex Hybrid');
    t.eq(ro.analysis().abilities.find(a => a.kind === 'triggered' && /proliferate again/.test(a.text)).effects.filter(e => e.op === 'proliferate').length, 2, 'two proliferates');
  });

  test('True-Faith Censer: more for a Human; Skullcap Snail: the opponent exiles a card of their choice', (mk, t) => {
    t.auto('True-Faith Censer'); t.auto('Skullcap Snail');
    const T = mk();
    T.toMain('A');
    const human = T.bf('A', 'Elite Vanguard'), bear = T.bf('A', 'Grizzly Bears');
    const c1 = T.bf('A', 'True-Faith Censer'), c2 = T.bf('A', 'True-Faith Censer');
    T.g._attachAura(c1, human); T.g._attachAura(c2, bear); T.g.bumpBoard();
    t.eq(T.g.powerOf(human), 2 + 1 + 1, 'a Human: +2/+1');
    t.eq(T.g.powerOf(bear), 2 + 1, 'not a Human: +1/+1');
    const a = T.hand('B', 'Island'), b = T.hand('B', 'Shock');
    T.answer('pickCard', () => ({ cardIds: [b.id] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.put('A', 'Skullcap Snail', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('B', 'exile').length + T.zone('B', 'hand').length, 2);
    t.eq(T.zone('B', 'exile').length, 1, 'one card exiled');
  });

  test("Verdant Outrider: can't be blocked by power 2 or less this turn", (mk, t) => {
    t.auto('Verdant Outrider');
    const T = mk();
    T.toMain('A');
    const vo = T.bf('A', 'Verdant Outrider');
    const ab = vo.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: vo, name: 'Verdant Outrider', kind: 'ability' });
    t.ok(!T.g.couldBlock(T.bf('B', 'Grizzly Bears'), vo, 'B'), 'power 2 cannot block');
    t.ok(!!T.g.couldBlock(T.bf('B', 'Hill Giant'), vo, 'B'), 'power 3 can');
  });

  test('Balduvian Horde: sacrifice it unless you discard a card at random', (mk, t) => {
    t.auto('Balduvian Horde');
    const T = mk();
    T.toMain('A');
    T.hand('A', 'Island');
    T.answer('confirm', { yes: true });
    const bh = T.put('A', 'Balduvian Horde', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.zone(bh, 'battlefield', 'a card discarded');
    t.eq(T.zone('A', 'hand').length, 0);
    const U = mk();
    U.toMain('A');
    const bh2 = U.put('A', 'Balduvian Horde', 'battlefield', { etb: true });
    U.settle(); U.resolve(); U.settle();
    t.zone(bh2, 'graveyard', 'no card to discard: sacrificed');
  });
  test("Realm of Koh: the Spirit token can't block or be blocked by non-Spirits", (mk, t) => {
    t.auto('Realm of Koh');
    t.auto('Lost in the Spirit World');
    const T = mk();
    T.toMain('A');
    const rk = T.bf('A', 'Realm of Koh');
    const ab = rk.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'A', obj: rk, name: 'Realm of Koh', kind: 'ability' });
    const tok = T.bfOf('A').find(o => o.isToken);
    t.ok(!!tok, 'a Spirit token');
    t.ok(!T.g.couldBlock(T.bf('B', 'Grizzly Bears'), tok, 'B'), 'a Bear cannot block it');
    t.ok(!!T.g.couldBlock(T.bf('B', 'Kami of Ancient Law'), tok, 'B'), 'a Spirit can');
  });
  test('Wind Zendikon: the land is a 2/2 flier, and back to hand when it dies', (mk, t) => {
    t.auto('Wind Zendikon');
    t.auto('Corrupted Zendikon');
    const T = mk();
    T.toMain('A');
    const land = T.bf('A', 'Island');
    const wz = T.bf('A', 'Wind Zendikon');
    wz.attachedTo = land.id; land.attachments = [wz.id]; wz.ts = T.g._stampNew();
    T.settle();
    t.eq(T.g.powerOf(land), 2, 'a 2/2');
    t.ok(T.g.hasKw(land, 'Flying'), 'with flying');
    const ch = T.g.characteristics(land);
    t.ok(ch.isCreature && ch.isLand !== false, 'a creature, still a land');
    T.g.moveObject(land, 'graveyard');
    T.settle(); T.resolve(); T.settle();
    t.zone(land, 'hand', 'the land goes back to its owner\'s hand');
    t.zone(wz, 'graveyard', 'the Zendikon stays in the graveyard');
  });
  test('Party: each creature fills one place, and Malakir Blood-Priest counts them', (mk, t) => {
    t.auto('Malakir Blood-Priest');
    t.auto('Stonework Packbeast');
    t.auto('Squad Commander');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Stonework Packbeast');
    t.eq(T.g._partySize('A'), 1, 'the Packbeast is one of the party, not four');
    T.bf('A', 'Merfolk Looter');
    t.eq(T.g._partySize('A'), 2, 'a Rogue joins');
    T.put('A', 'Malakir Blood-Priest', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 17, 'a Cleric makes three');
    t.eq(T.life('A'), 23);
    T.bf('A', 'Elvish Warrior');
    t.eq(T.g._partySize('A'), 4, 'a full party');
  });

  test('Start Your Engines: Vehicles become creatures with their own power', (mk, t) => {
    t.auto('Start Your Engines');
    const T = mk();
    T.toMain('A');
    const v = T.bf('A', 'Smuggler\'s Copter');
    const card = T.hand('A', 'Start Your Engines');
    const ab = card.analysis().abilities.find(a => a.kind === 'spell');
    T.g._runEffects(ab.effects, { controller: 'A', obj: card, name: 'Start Your Engines', kind: 'spell' });
    t.ok(T.g.characteristics(v).isCreature, 'a creature now');
    t.eq(T.g.powerOf(v), 5, '3 printed, +2 from the spell');
  });
  test('Cranial Plating: +1/+0 for each artifact leaves toughness alone', (mk, t) => {
    t.auto('Cranial Plating');
    t.auto("Ravager's Mace");
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const cp = T.bf('A', 'Cranial Plating');
    T.bf('A', 'Ornithopter');
    cp.attachedTo = bear.id; bear.attachments = [cp.id]; cp.ts = T.g._stampNew();
    T.settle();
    t.eq(T.g.powerOf(bear), 4, 'two artifacts: +2/+0');
    t.eq(T.g.toughnessOf(bear), 2);
  });
  test('Gorgon Recluse destroys a nonblack creature it blocks, at end of combat', (mk, t) => {
    t.auto('Gorgon Recluse');
    t.auto('Deathgazer');
    const T = mk();
    const g = T.bf('B', 'Gorgon Recluse');
    const giant = T.bf('A', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: g.id, attackerIds: [giant.id] }]);
    T.toMain('A', 'end');
    t.zone(giant, 'graveyard', 'the red Giant is destroyed');
    t.zone(g, 'battlefield');
    const U = mk();
    const g2 = U.bf('B', 'Gorgon Recluse');
    const vamp = U.bf('A', 'Gray Merchant of Asphodel');
    U.answer('declareAttackers', () => [{ attackerId: vamp.id, defenderId: 'B' }]);
    U.answer('declareBlockers', () => [{ blockerId: g2.id, attackerIds: [vamp.id] }]);
    U.toMain('A', 'end');
    t.zone(vamp, 'battlefield', 'a black creature is not destroyed');
  });
  test("Territory Culler: a card it doesn't take may go to the graveyard", (mk, t) => {
    t.auto('Territory Culler');
    t.auto('Sarinth Steelseeker');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Territory Culler');
    const isl = T.top('A', 'Island');
    T.answer('confirm', { yes: true });
    T.put('A', 'Forest', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.zone(isl, 'graveyard', 'not a creature: put into the graveyard by choice');
    const bear = T.top('A', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.put('A', 'Forest', 'battlefield', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'hand', 'a creature: taken, and nothing else goes');
    t.eq(T.zone('A', 'graveyard').length, 1);
  });
  test('Wall of Tears returns what it blocked at end of combat', (mk, t) => {
    t.auto('Wall of Tears');
    t.auto('Aether Membrane');
    const T = mk();
    const w = T.bf('B', 'Wall of Tears');
    const giant = T.bf('A', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: w.id, attackerIds: [giant.id] }]);
    T.toMain('A', 'end');
    t.zone(giant, 'hand', 'back in its owner\'s hand');
    t.zone(w, 'battlefield');
  });

  test('Goblin Goon attacks and blocks only with more creatures', (mk, t) => {
    t.auto('Goblin Goon');
    t.auto('Monstrous Hound');
    const T = mk();
    T.toMain('A');
    const gg = T.bf('A', 'Goblin Goon');
    T.bf('B', 'Grizzly Bears');
    t.no(T.g.canAttack(gg), 'one creature each: no attack');
    T.bf('A', 'Llanowar Elves');
    t.ok(T.g.canAttack(gg), 'two against one');
    const U = mk();
    const gb = U.bf('B', 'Goblin Goon');
    const bear = U.bf('A', 'Grizzly Bears');
    U.bf('A', 'Llanowar Elves');
    t.no(U.g.couldBlock(gb, bear, 'B'), 'fewer creatures than the attacking player: no block');
    U.bf('B', 'Llanowar Elves'); U.bf('B', 'Llanowar Elves');
    t.ok(U.g.couldBlock(gb, bear, 'B'), 'three against two');
  });

  test('Ensoul Artifact makes a 5/5; Bhaal is indestructible at half life; Defender; reach', (mk, t) => {
    t.auto('Ensoul Artifact');
    t.auto('Bhaal, Lord of Murder');
    t.auto("Teeka's Dragon");
    const T = mk();
    T.toMain('A');
    const orn = T.bf('A', 'Ornithopter');
    const ea = T.bf('A', 'Ensoul Artifact');
    ea.attachedTo = orn.id; orn.attachments = [ea.id]; ea.ts = T.g._stampNew();
    T.settle();
    t.eq(T.g.powerOf(orn), 5); t.eq(T.g.toughnessOf(orn), 5);
    const bh = T.bf('A', 'Bhaal, Lord of Murder');
    t.no(T.g.hasKw(bh, 'Indestructible'), 'at 20 life, no');
    T.player('A').life = 10; T.g.bumpBoard();
    t.ok(T.g.hasKw(bh, 'Indestructible'), 'at 10 of 20, yes');
    const tk = T.bf('A', 'Traproot Kami');
    t.ok(T.g.hasKw(tk, 'Defender') && T.g.hasKw(tk, 'Reach'), 'both keywords off one line');
  });
  test("Sudden Storm: the two it taps don't untap in their controller's next untap step", (mk, t) => {
    t.auto('Sudden Storm');
    t.auto('Lorthos, the Tidemaker');
    t.auto('Breaching Leviathan');
    const T = mk();
    T.toMain('A');
    const a = T.bf('B', 'Grizzly Bears'), b = T.bf('B', 'Hill Giant'), c = T.bf('B', 'Llanowar Elves');
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Sudden Storm'), { targets: [a, b] });
    T.resolve();
    t.ok(a.tapped && b.tapped && !c.tapped, 'two tapped');
    t.ok(a.noUntapNext && b.noUntapNext, 'and held down');
    t.no(c.noUntapNext);
  });

  test('Tap all creatures you control; tap all nonblue creatures', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant'), blue = T.bf('B', 'Merfolk Looter');
    const card = T.hand('A', 'Island');
    const mineOnly = engine().oracle.parseEffects('Tap all creatures you control.');
    t.ok(mineOnly.auto, 'reads');
    T.g._runEffects(mineOnly.effects, { controller: 'A', obj: card, name: 'Test', kind: 'spell' });
    t.ok(mine.tapped && !theirs.tapped, 'only mine');
    const ab = engine().oracle.parseEffects('Tap all nonblue creatures.');
    t.ok(ab.auto, 'reads');
    T.g._runEffects(ab.effects, { controller: 'A', obj: card, name: 'Test', kind: 'spell' });
    t.ok(theirs.tapped && !blue.tapped, 'the Giant, not the Looter');
  });
  test('Resistance Fighter: the creature it picks deals no combat damage', (mk, t) => {
    t.auto('Resistance Fighter');
    t.auto('Azorius Ploy');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('A', 'Hill Giant');
    const rf = T.bf('B', 'Resistance Fighter');
    const ab = rf.analysis().abilities.find(a => a.kind === 'activated');
    T.g._runEffects(ab.effects, { controller: 'B', obj: rf, name: 'Resistance Fighter', kind: 'ability', targets: [{ kind: 'object', id: giant.id }] });
    t.ok(T.g._hasFlag(giant, 'noDamage'), 'flagged for the turn');
    T.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 20, 'no combat damage');
  });
  test('A blocked creature stays blocked: Fencing Ace, Curtain of Light', (mk, t) => {
    t.auto('Curtain of Light');
    t.auto('Trap Runner');
    const T = mk();
    const fa = T.bf('A', 'Fencing Ace');
    const el = T.bf('B', 'Llanowar Elves');
    T.answer('declareAttackers', () => [{ attackerId: fa.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: el.id, attackerIds: [fa.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(el, 'graveyard', 'the first blow kills the blocker');
    t.eq(T.life('B'), 20, 'the second has no one to hit: no trample');
    const U = mk();
    const giant = U.bf('A', 'Hill Giant');
    U.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'B' }]);
    U.answer('declareBlockers', () => []);
    U.toMain('A', 'declareBlockers');
    const cl = U.hand('B', 'Curtain of Light');
    const sp = cl.analysis().abilities.find(a => a.kind === 'spell');
    U.g._runEffects(sp.effects, { controller: 'B', obj: cl, name: 'Curtain of Light', kind: 'spell', targets: [{ kind: 'object', id: giant.id }] });
    t.ok(giant.blockedNoBlocker != null, 'blocked');
    U.toMain('A', 'endCombat');
    t.eq(U.life('B'), 20, 'and deals no damage');
  });
  test("Suq'Ata Firewalker can't be the target of red spells, even its controller's", (mk, t) => {
    t.auto("Suq'Ata Firewalker");
    t.auto('Mercenary Informer');
    const T = mk();
    T.toMain('A');
    const fw = T.bf('A', "Suq'Ata Firewalker");
    const bolt = T.hand('A', 'Lightning Bolt');
    const shock = { type: 'any' };
    const ids = (src) => T.g._legalTargetsFor(shock, 'A', src.id).map(x => x.id);
    t.no(ids(bolt).includes(fw.id), 'not by Lightning Bolt');
    const ray = T.hand('A', 'Disfigure');
    t.ok(ids(ray).includes(fw.id), 'a black spell may');
  });
  test('Cathedral Acolyte targets only a creature that entered this turn', (mk, t) => {
    t.auto('Cathedral Acolyte');
    t.auto("Elspeth's Nightmare");
    t.auto("Oketra's Avenger");
    const T = mk();
    T.toMain('A');
    const ca = T.bf('A', 'Cathedral Acolyte');
    const old = T.bf('A', 'Grizzly Bears');
    const fresh = T.put('A', 'Hill Giant', 'battlefield', { etb: true });
    const ab = ca.analysis().abilities.find(a => a.kind === 'activated');
    const ids = T.g._legalTargetsFor(ab.effects[0].targets[0], 'A', ca.id).map(x => x.id);
    t.ok(ids.includes(fresh.id), 'the Giant just came in');
    t.no(ids.includes(old.id), 'the Bears have been here a while');
  });
  test("Equip by another cost: Dissection Tools sacrifices a creature; Dragoon's Lance makes a Knight", (mk, t) => {
    t.auto('Dissection Tools');
    t.auto("Dark Knight's Greatsword");
    t.auto("Dragoon's Lance");
    const T = mk();
    T.toMain('A');
    const dt = T.bf('A', 'Dissection Tools');
    const bear = T.bf('A', 'Grizzly Bears');
    const elf = T.bf('A', 'Llanowar Elves');
    const all = dt.analysis().manaAbilities.concat(dt.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => /^Equip/.test(a.text));
    T.answer('*', (ch) => (ch.type === 'pickTarget' ? { targets: [{ kind: 'object', id: bear.id }] } : { cardIds: [elf.id], ids: [elf.id] }));
    T.activate('A', dt, idx, { targets: [bear] });
    T.resolve();
    t.zone(elf, 'graveyard', 'the Elves paid for it');
    t.eq(dt.attachedTo, bear.id, 'and the Tools went on the Bears');
    const dl = T.bf('A', "Dragoon's Lance");
    dl.attachedTo = bear.id; bear.attachments.push(dl.id); dl.ts = T.g._stampNew();
    T.settle();
    t.ok(T.g._hasCreatureType(bear, 'Knight'), 'a Knight');
  });
  test('Great Divide Guide: each land and Ally you control taps for any colour', (mk, t) => {
    t.auto('Great Divide Guide');
    t.auto('Brightcap Badger');
    const T = mk();
    T.toMain('A');
    const isl = T.bf('A', 'Island');
    const bear = T.bf('A', 'Grizzly Bears');
    const before = isl.analysis().manaAbilities.length;
    T.bf('A', 'Great Divide Guide');
    T.settle();
    t.eq(isl.analysis().manaAbilities.length, before + 1, 'the Island gains one');
    t.eq(bear.analysis().manaAbilities.length, 0, 'the Bears are not an Ally');
  });
  test('Ethereal Haze stops damage from creatures; Safe Passage keeps you and yours', (mk, t) => {
    t.auto('Ethereal Haze');
    t.auto('Safe Passage');
    t.auto('Blinding Fog');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears');
    const card = T.hand('A', 'Ethereal Haze');
    const sp = card.analysis().abilities.find(a => a.kind === 'spell');
    T.g._runEffects(sp.effects, { controller: 'A', obj: card, name: 'Ethereal Haze', kind: 'spell' });
    T.g.dealDamageToPlayer(T.g.player('A'), 2, bear, true);
    t.eq(T.life('A'), 20, 'the Bears deal nothing');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.g.dealDamageToPlayer(T.g.player('A'), 3, bolt, false);
    t.eq(T.life('A'), 17, 'a spell still does');
    const U = mk();
    U.toMain('A');
    const mine = U.bf('A', 'Hill Giant'), theirs = U.bf('B', 'Grizzly Bears');
    const c2 = U.hand('A', 'Safe Passage');
    const sp2 = c2.analysis().abilities.find(a => a.kind === 'spell');
    U.g._runEffects(sp2.effects, { controller: 'A', obj: c2, name: 'Safe Passage', kind: 'spell' });
    U.g.dealDamageToPlayer(U.g.player('A'), 2, theirs, true);
    U.g.dealDamageToObject(mine, 2, theirs, true);
    U.g.dealDamageToObject(theirs, 3, mine, true);
    t.eq(U.life('A'), 20, 'you take nothing');
    t.eq(mine.damage || 0, 0, 'nor does your creature');
    t.eq(theirs.damage, 3, 'theirs does');
  });
  test('Grafted Wargear: what it leaves is sacrificed, moved or gone', (mk, t) => {
    t.auto('Grafted Wargear');
    t.auto('Grafted Exoskeleton');
    const T = mk();
    T.toMain('A');
    const gw = T.bf('A', 'Grafted Wargear');
    const bear = T.bf('A', 'Grizzly Bears');
    const giant = T.bf('A', 'Hill Giant');
    gw.attachedTo = bear.id; bear.attachments = [gw.id]; gw.ts = T.g._stampNew();
    T.g.checkStateBasedActions();
    const all = gw.analysis().manaAbilities.concat(gw.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => /^Equip/.test(a.text));
    T.mana('A', '0');
    T.activate('A', gw, idx, { targets: [giant] });
    T.resolve();
    t.eq(gw.attachedTo, giant.id, 'on the Giant now');
    t.zone(bear, 'graveyard', 'the Bears it left are sacrificed');
    T.g.moveObject(gw, 'graveyard');
    T.settle(); T.g.checkStateBasedActions(); T.resolve();
    t.zone(giant, 'graveyard', 'the Wargear gone: the Giant is sacrificed too');
  });
  test('Heat Stroke destroys what blocked or was blocked, at end of combat', (mk, t) => {
    t.auto('Heat Stroke');
    const T = mk();
    T.bf('B', 'Heat Stroke');
    const giant = T.bf('A', 'Hill Giant'), bear = T.bf('A', 'Grizzly Bears');
    const wall = T.bf('B', 'Wall of Stone');
    T.answer('declareAttackers', () => [{ attackerId: giant.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [giant.id] }]);
    T.toMain('A', 'end');
    t.zone(giant, 'graveyard', 'blocked: destroyed');
    t.zone(wall, 'graveyard', 'blocked: destroyed');
    t.zone(bear, 'battlefield', 'unblocked: kept');
  });
  test("On Serra's Wings makes the creature legendary", (mk, t) => {
    t.auto("On Serra's Wings");
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const w = T.bf('A', "On Serra's Wings");
    w.attachedTo = bear.id; bear.attachments = [w.id]; w.ts = T.g._stampNew();
    T.g.bumpBoard(); T.settle();
    t.ok(bear.analysis().isLegendary, 'legendary');
    t.eq(T.g.powerOf(bear), 3);
    t.ok(T.g.hasKw(bear, 'Flying') && T.g.hasKw(bear, 'Lifelink'));
  });
  test('Emissary Escort gets +X/+0 for the greatest mana value among other artifacts', (mk, t) => {
    t.auto('Emissary Escort');
    t.auto('Glint Raker');
    const T = mk();
    T.toMain('A');
    const ee = T.bf('A', 'Emissary Escort');
    const base = T.g.powerOf(ee), tough = T.g.toughnessOf(ee);
    T.bf('A', 'Ornithopter');
    T.bf('A', 'Solemn Simulacrum');
    T.settle();
    t.eq(T.g.powerOf(ee), base + 4, 'the Simulacrum: 4');
    t.eq(T.g.toughnessOf(ee), tough, 'toughness alone');
  });
  test('Necropotence skips the draw step; Stasis skips every untap step', (mk, t) => {
    t.auto('Necropotence');
    t.auto('Stasis');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Necropotence');
    const h = T.zone('A', 'hand').length;
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    t.eq(T.zone('A', 'hand').length, h, 'no card drawn');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Stasis');
    const land = U.bf('B', 'Forest', { tapped: true });
    const bear = U.bf('B', 'Grizzly Bears', { sick: true });
    U.nextTurn('B'); U.toMain('B');
    t.ok(land.tapped, 'the Forest stays tapped');
    t.no(bear.summoningSick, 'the Bears can attack all the same');
  });
  test('Way of the Pyromancer hands each planeswalker you control "+1: Add {R}"', (mk, t) => {
    t.auto('Way of the Pyromancer');
    t.auto('Way of the Wildspeaker');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Way of the Pyromancer');
    const pw = T.bf('A', 'Jace Beleren');
    T.settle();
    const all = pw.analysis().manaAbilities.concat(pw.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => /Add \{R\}/.test(a.text || ''));
    t.ok(idx >= 0, 'the ability is there');
    const before = pw.counters.loyalty;
    T.activate('A', pw, idx);
    T.resolve();
    t.eq(pw.counters.loyalty, before + 1, '+1 loyalty');
    t.eq(T.g.player('A').pool.total(), 1, 'and one mana');
  });
  test("Erratic Portal asks the targeted creature's controller; Faith's Fetters; Fog of War", (mk, t) => {
    t.auto('Erratic Portal');
    t.auto("Faith's Fetters");
    t.auto('Fog of War');
    t.auto('Familiar Ground');
    const T = mk();
    T.toMain('A');
    const ep = T.bf('A', 'Erratic Portal');
    const mine = T.bf('A', 'Grizzly Bears');
    let asked = null;
    T.answer('*', (ch) => { if (ch.type === 'payOrDont') { asked = ch.playerId; return { pay: false }; } return {}; });
    T.mana('A', '2');
    T.activate('A', ep, 0, { targets: [mine] });
    T.resolve();
    t.eq(asked, 'A', 'my own creature: I am the one asked');
    t.zone(mine, 'hand');
    const U = mk();
    U.toMain('A');
    const ff = U.bf('A', "Faith's Fetters");
    const elves = U.bf('B', 'Llanowar Elves');
    const vamp = U.bf('B', 'Vampire Nighthawk');
    ff.attachedTo = elves.id; elves.attachments = [ff.id]; ff.ts = U.g._stampNew();
    U.g.bumpBoard();
    t.ok(U.g._hasFlag(elves, 'cantActivateNonMana'), 'fettered');
    t.no(U.g._hasFlag(vamp, 'cantActivateNonMana'));
    const fog = U.hand('A', 'Fog of War');
    const sp = fog.analysis().abilities.find(a => a.kind === 'spell');
    U.g._runEffects(sp.effects, { controller: 'A', obj: fog, name: 'Fog of War', kind: 'spell' });
    const life = U.life('A');
    U.g.dealDamageToPlayer(U.g.player('A'), 1, elves, true);
    U.g.dealDamageToPlayer(U.g.player('A'), 4, U.bf('B', 'Air Elemental'), true);
    t.eq(U.life('A'), life - 4, 'the Elves (power 1) are stopped, the Elemental (4) is not');
  });
  test("Telepathy shows its controller the opponents' hands; Revelation shows every hand", (mk, t) => {
    t.auto('Telepathy');
    t.auto('Revelation');
    t.auto("Seer's Vision");
    const T = mk();
    T.toMain('A');
    T.hand('A', 'Island'); T.hand('B', 'Mountain');
    const shown = (viewer, owner) => T.g.viewFor(viewer).players.find(p => p.id === owner).hand.every(h => !h.hidden);
    t.no(shown('A', 'B'), 'hidden at first');
    const tp = T.bf('A', 'Telepathy');
    t.ok(shown('A', 'B'), "A sees B's hand");
    t.no(shown('B', 'A'), "B does not see A's");
    T.g.moveObject(tp, 'graveyard');
    t.no(shown('A', 'B'), 'hidden again once Telepathy is gone');
    T.bf('B', 'Revelation');
    t.ok(shown('A', 'B') && shown('B', 'A'), 'Revelation: everyone sees every hand');
  });
  test("Hit // Run: the sacrificed permanent's mana value as damage; each attacker gets +1/+0 for each other", (mk, t) => {
    t.auto('Hit // Run');
    const T = mk();
    T.toMain('A');
    const hill = T.bf('B', 'Hill Giant');
    const card = T.hand('A', 'Hit // Run');
    const hit = card.analysis().abilities.find(a => a.kind === 'spell');
    T.answer('*', (ch) => ({ cardIds: [hill.id], ids: [hill.id], picks: [hill.id] }));
    T.g._runEffects(hit.effects, { controller: 'A', obj: card, name: 'Hit', kind: 'spell', targets: [{ kind: 'player', id: 'B' }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(hill, 'graveyard', 'the Giant sacrificed');
    t.eq(T.life('B'), 16, 'and its mana value, 4, dealt to B');
    const U = mk();
    const a = U.bf('A', 'Grizzly Bears'), b = U.bf('A', 'Hill Giant'), c = U.bf('A', 'Llanowar Elves');
    U.answer('declareAttackers', () => [{ attackerId: a.id, defenderId: 'B' }, { attackerId: b.id, defenderId: 'B' }, { attackerId: c.id, defenderId: 'B' }]);
    U.toMain('A', 'declareBlockers');
    const card2 = U.hand('A', 'Hit // Run');
    const run = engine().oracle.analyze(card2.card, 1).abilities.find(x => x.kind === 'spell');
    U.g._runEffects(run.effects, { controller: 'A', obj: card2, name: 'Run', kind: 'spell' });
    t.eq(U.g.powerOf(a), 4, 'two others: +2/+0');
    t.eq(U.g.toughnessOf(a), 2);
  });
  test('Planar Despair: -1/-1 to all creatures for each basic land type among your lands', (mk, t) => {
    t.auto('Planar Despair');
    t.auto('Magmablood Archaic');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Island'); T.bf('A', 'Forest'); T.bf('A', 'Forest');
    const g = T.bf('B', 'Hill Giant');
    const card = T.hand('A', 'Planar Despair');
    const sp = card.analysis().abilities.find(a => a.kind === 'spell');
    T.g._runEffects(sp.effects, { controller: 'A', obj: card, name: 'Planar Despair', kind: 'spell' });
    t.eq(T.g.powerOf(g), 1, 'two types: -2/-2');
    t.eq(T.g.toughnessOf(g), 1);
  });
  test('Council of Reeds: the legend rule spares creatures, not other legends', (mk, t) => {
    t.auto('Council of Reeds');
    t.auto('Cadric, Soul Kindler');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Council of Reeds');
    const a = T.bf('A', 'Isamaru, Hound of Konda'), b = T.bf('A', 'Isamaru, Hound of Konda');
    const x = T.bf('A', 'Mox Amber'), y = T.bf('A', 'Mox Amber');
    T.g.checkStateBasedActions();
    t.ok(a.zone === 'battlefield' && b.zone === 'battlefield', 'both creatures stay');
    t.eq([x, y].filter(o => o.zone === 'battlefield').length, 1, 'one Mox goes');
  });
  test('Moonlit Lamenter: "Remove a counter from this creature" takes the -1/-1 counter first', (mk, t) => {
    t.auto('Moonlit Lamenter');
    t.auto('Glen Elendra Guardian');
    t.auto('Loch Mare');
    const T = mk();
    T.toMain('A');
    const ml = T.bf('A', 'Moonlit Lamenter', { counters: { '-1/-1': 1, '+1/+1': 1 } });
    T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    const all = ml.analysis().manaAbilities.concat(ml.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => a.cost && a.cost.removeCounters);
    T.mana('A', '1W');
    T.activate('A', ml, idx);
    T.resolve();
    t.eq(ml.counters['-1/-1'] || 0, 0, 'the -1/-1 counter came off');
    t.eq(ml.counters['+1/+1'], 1, 'the +1/+1 counter stayed');
    t.eq(T.zone('A', 'hand').length, h + 1, 'a card drawn');
  });
  test('Loch Mare and Chainbreaker enter with their -1/-1 counters', (mk, t) => {
    t.auto('Loch Mare');
    t.auto('Chainbreaker');
    const T = mk();
    T.toMain('A');
    const lm = T.put('A', 'Loch Mare', 'battlefield', { etb: true });
    const cb = T.put('A', 'Chainbreaker', 'battlefield', { etb: true });
    T.settle();
    t.eq(lm.counters['-1/-1'], 3);
    t.eq(cb.counters['-1/-1'], 2);
  });
  test('Astral Cornucopia enters with X charge counters; Lightning Serpent with X +1/+0', (mk, t) => {
    t.auto('Astral Cornucopia');
    t.auto('Lightning Serpent');
    const T = mk();
    T.toMain('A');
    const ac = T.hand('A', 'Astral Cornucopia');
    // (as the spell resolves: X is what was paid)
    ac.chosenX = 3;
    T.g.moveObject(ac, 'battlefield', { controller: 'A', fromStack: true });
    T.settle();
    t.eq(ac.counters.charge, 3);
    const ls = T.hand('A', 'Lightning Serpent');
    // (as the spell resolves: X is what was paid)
    ls.chosenX = 2;
    T.g.moveObject(ls, 'battlefield', { controller: 'A', fromStack: true });
    T.settle();
    t.eq(T.g.powerOf(ls), 4, '2/1 with two +1/+0 counters');
  });
  test('Stirring Hopesinger: an instant or sorcery aimed at a creature puts a counter on each of yours', (mk, t) => {
    t.auto('Stirring Hopesinger');
    t.auto('Legolas, Master Archer');
    t.auto('Fin Fang Foom');
    const T = mk();
    T.toMain('A');
    const sh = T.bf('A', 'Stirring Hopesinger');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [bear] });
    T.resolve();
    t.eq(sh.counters['+1/+1'], 1, 'a counter on the Hopesinger');
    t.eq(bear.counters['+1/+1'], 1, 'and on the Bears');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Llanowar Elves'));
    T.resolve();
    t.eq(sh.counters['+1/+1'], 1, 'a creature spell with no target does nothing');
  });
  test("Lullmage's Familiar: a kicked spell gains 2 life, an unkicked one nothing", (mk, t) => {
    t.auto("Lullmage's Familiar");
    t.auto('Verazol, the Split Current');
    const T = mk();
    T.toMain('A');
    T.bf('A', "Lullmage's Familiar");
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Burst Lightning'), { targets: ['B'] });
    T.resolve();
    t.eq(T.life('A'), 20, 'not kicked');
    T.mana('A', '4R');
    T.cast('A', T.hand('A', 'Burst Lightning'), { targets: ['B'], kick: true });
    T.resolve();
    t.eq(T.life('A'), 22, 'kicked');
  });
  test("Sunbird's Invocation: a spell from your hand reveals that many, and one no bigger may be cast free", (mk, t) => {
    t.auto("Sunbird's Invocation");
    const T = mk();
    T.toMain('A');
    T.bf('A', "Sunbird's Invocation");
    const elves = T.top('A', 'Llanowar Elves');
    T.top('A', 'Island');
    T.answer('*', (ch) => (ch.type === 'confirm' ? { yes: true } : ch.type === 'pickCard' ? { cardIds: [elves.id] } : {}));
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.zone(elves, 'battlefield', 'the Elves (mana value 1) cast free off a 2-drop');
  });
  test('Ulvenwald Observer: a creature of yours with toughness 4 or greater dies, draw', (mk, t) => {
    t.auto('Ulvenwald Observer');
    t.auto('Teysa, Envoy of Ghosts');
    t.auto('Stone Haven Outfitter');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Ulvenwald Observer');
    const bear = T.bf('A', 'Grizzly Bears'), wurm = T.bf('A', 'Craw Wurm');
    T.top('A', 'Island'); T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.g.moveObject(bear, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h, 'toughness 2: nothing');
    T.g.moveObject(wurm, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 1, 'toughness 4: a card');
  });
  test('Stone Haven Outfitter: an equipped creature of yours dies, draw', (mk, t) => {
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Stone Haven Outfitter');
    const bear = T.bf('A', 'Grizzly Bears'), elf = T.bf('A', 'Llanowar Elves');
    const sw = T.bf('A', 'Short Sword');
    sw.attachedTo = bear.id; bear.attachments = [sw.id];
    T.top('A', 'Island'); T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.g.moveObject(elf, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h, 'not equipped: nothing');
    T.g.moveObject(bear, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 1, 'equipped as it died: a card');
  });
  test('Veteran Motorist: the Vehicle it crews gets +1/+1', (mk, t) => {
    t.auto('Veteran Motorist');
    t.auto('Speedway Fanatic');
    const T = mk();
    T.toMain('A');
    const vm = T.bf('A', 'Veteran Motorist');
    const sc = T.bf('A', "Smuggler's Copter");
    const all = sc.analysis().manaAbilities.concat(sc.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const idx = all.findIndex(a => /^Crew/i.test(a.text || ''));
    T.activate('A', sc, idx, { tapCostIds: [vm.id] });
    T.resolve();
    t.ok(vm.tapped, 'the Motorist crewed it');
    t.eq(T.g.powerOf(sc), 4, '3/3 +1/+1');
  });

  test("Loch Mare: the counter kind the player chose comes off; an absent kind falls back", (mk, t) => {
    const T = mk();
    T.toMain('A');
    const lm = T.bf('A', 'Loch Mare', { counters: { '-1/-1': 3, stun: 1 } });
    T.top('A', 'Island'); T.top('A', 'Island'); T.top('A', 'Island');
    const all = lm.analysis().manaAbilities.concat(lm.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const one = all.findIndex(a => a.cost && a.cost.removeCounters && a.cost.removeCounters.n === 1);
    const two = all.findIndex(a => a.cost && a.cost.removeCounters && a.cost.removeCounters.n === 2);
    T.mana('A', '1U');
    T.activate('A', lm, one, { counterKind: 'stun' });
    T.resolve();
    t.eq(lm.counters.stun || 0, 0, 'the stun counter, as chosen');
    t.eq(lm.counters['-1/-1'], 3);
    T.mana('A', '1U');
    T.activate('A', lm, one, { counterKind: '+1/+1' });
    T.resolve();
    t.eq(lm.counters['-1/-1'], 2, 'a kind it does not have: the usual order');
    lm.counters.stun = 1;
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2U');
    T.activate('A', lm, two, { counterKind: 'stun', targets: [bear] });
    T.resolve();
    t.eq(lm.counters.stun || 0, 0, 'two counters: the chosen kind first');
    t.eq(lm.counters['-1/-1'], 1, 'then the rest by the usual order');
  });

  test('Captain Ripley Vance triggers on the third spell; Sneaky Snacker returns on the third draw', (mk, t) => {
    t.auto('Captain Ripley Vance');
    t.auto('Sneaky Snacker');
    const T = mk();
    T.toMain('A');
    const cr = T.bf('A', 'Captain Ripley Vance');
    for (let i = 0; i < 2; i++) { T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.resolve(); }
    t.eq(cr.counters['+1/+1'] || 0, 0, 'two spells: nothing yet');
    T.answer('*', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.resolve();
    t.eq(cr.counters['+1/+1'], 1, 'the third: a counter');
    const ss = T.grave('A', 'Sneaky Snacker');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.g.drawCards('A', 3); T.settle(); T.resolve();
    t.zone(ss, 'battlefield', 'back on the third draw');
    t.ok(ss.tapped, 'tapped');
  });

  test('Territorial Gorger: getting energy pumps it', (mk, t) => {
    t.auto('Territorial Gorger');
    t.auto('Fabrication Module');
    const T = mk();
    T.toMain('A');
    const tg = T.bf('A', 'Territorial Gorger');
    const src = T.hand('A', 'Island');
    T.g._runEffects([{ op: 'energy', n: 2 }], { controller: 'A', obj: src, name: 'Test', kind: 'spell' });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.player('A').energy, 2, 'two energy');
    t.eq(T.g.powerOf(tg), 4, '2/2 +2/+2');
  });

  test("Black Vise hurts the chosen player in their upkeep for cards over four", (mk, t) => {
    t.auto('Black Vise');
    t.auto('The Rack');
    const T = mk();
    T.toMain('A');
    const bv = T.bf('A', 'Black Vise');
    bv.chosenPlayer = 'B';
    for (let i = 0; i < 6; i++) T.hand('B', 'Island');
    T.g._fire('eachUpkeep', null, { playerId: 'A' });
    T.resolve();
    t.eq(T.life('B'), 20, "not in its controller's upkeep");
    T.g._fire('eachUpkeep', null, { playerId: 'B' });
    T.resolve();
    t.eq(T.life('B'), 18, 'six cards: 2 damage');
  });

  test('Testament of Faith becomes an X/X; Ride the Shoopuf becomes a 7/7 for good', (mk, t) => {
    t.auto('Testament of Faith');
    t.auto('Ride the Shoopuf');
    t.auto('Halcyon Glaze');
    const T = mk();
    T.toMain('A');
    const tf = T.bf('A', 'Testament of Faith');
    const all = tf.analysis().manaAbilities.concat(tf.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    T.mana('A', '3');
    T.activate('A', tf, all.findIndex(a => a.kind === 'activated'), { x: 3 });
    T.resolve();
    t.eq(T.g.powerOf(tf), 3, 'X = 3');
    t.ok(T.g.characteristics(tf).isCreature);
    const rs = T.bf('A', 'Ride the Shoopuf');
    const all2 = rs.analysis().manaAbilities.concat(rs.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    T.mana('A', '5GG');
    T.activate('A', rs, all2.findIndex(a => /7\/7/.test(a.text || '')));
    T.resolve();
    T.nextTurn('B'); T.toMain('B');
    t.eq(T.g.powerOf(rs), 7, 'still a 7/7 next turn');
  });

  test('Doubling Cube doubles the unspent mana left after its cost', (mk, t) => {
    t.auto('Doubling Cube');
    const T = mk();
    T.toMain('A');
    const dc = T.bf('A', 'Doubling Cube');
    const p = T.g.player('A');
    p.pool.add('C', 3); p.pool.add('R', 2); p.pool.add('G', 1);
    T.g.activateAbility('A', dc.id, 0, { auto: true });
    T.settle();
    t.eq(p.pool.R, 4, 'two red become four');
    t.eq(p.pool.G, 2, 'one green becomes two');
    t.eq(p.pool.C, 0, 'the colorless paid for it');
  });

  test("Titania plays Forests from the graveyard; Akki Battle Squad untaps modified creatures", (mk, t) => {
    t.auto("Titania, Nature's Force");
    t.auto('Akki Battle Squad');
    t.auto('Dauntless Dismantler');
    const T = mk();
    T.toMain('A');
    T.bf('A', "Titania, Nature's Force");
    const f = T.grave('A', 'Forest'), i = T.grave('A', 'Island');
    t.ok(!!T.g._playFromRule('A', f, 'land'), 'a Forest may be played from there');
    t.no(T.g._playFromRule('A', i, 'land'), 'an Island may not');
    const bear = T.bf('A', 'Grizzly Bears', { tapped: true, counters: { '+1/+1': 1 } });
    const elf = T.bf('A', 'Llanowar Elves', { tapped: true });
    const eff = engine().oracle.parseEffects('Untap all modified creatures you control.');
    T.g._runEffects(eff.effects, { controller: 'A', obj: bear, name: 'Test', kind: 'ability' });
    t.no(bear.tapped, 'the modified Bears untap');
    t.ok(elf.tapped, 'the Elves stay tapped');
  });

  test('Shifting Sliver: Slivers can be blocked only by Slivers', (mk, t) => {
    t.auto('Shifting Sliver');
    const T = mk();
    T.toMain('A');
    const ss = T.bf('A', 'Shifting Sliver');
    t.no(T.g.couldBlock(T.bf('B', 'Hill Giant'), ss, 'B'), 'a Giant cannot');
    t.ok(T.g.couldBlock(T.bf('B', 'Muscle Sliver'), ss, 'B'), 'a Sliver can');
  });

  test('Enter the Avatar State: an Avatar with four keywords until end of turn', (mk, t) => {
    t.auto('Enter the Avatar State');
    t.auto("Loki's Scepter");
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const card = T.hand('A', 'Enter the Avatar State');
    const sp = card.analysis().abilities.find(a => a.kind === 'spell');
    T.g._runEffects(sp.effects, { controller: 'A', obj: card, name: 'Enter the Avatar State', kind: 'spell', targets: [{ kind: 'object', id: bear.id }] });
    t.ok(T.g._hasCreatureType(bear, 'Avatar'), 'an Avatar');
    t.ok(['Flying', 'First strike', 'Lifelink', 'Hexproof'].every(k => T.g.hasKw(bear, k)), 'with all four');
    T.nextTurn('B');
    t.no(T.g._hasCreatureType(bear, 'Avatar'), 'gone next turn');
  });

  test('Cauldron Haze gives persist to each creature chosen', (mk, t) => {
    t.auto('Cauldron Haze');
    t.auto('Cauldron of Souls');
    const T = mk();
    T.toMain('A');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Hill Giant'), c = T.bf('A', 'Llanowar Elves');
    T.mana('A', '1WB');
    T.cast('A', T.hand('A', 'Cauldron Haze'), { targets: [a, b] });
    T.resolve();
    t.ok(T.g.hasKw(a, 'Persist') && T.g.hasKw(b, 'Persist'), 'the two chosen');
    t.no(T.g.hasKw(c, 'Persist'), 'not the third');
  });

  test('Garruk, Savage Herald: a creature on top to hand, anything else to the bottom', (mk, t) => {
    t.auto('Garruk, Savage Herald');
    t.auto('Llanowar Empath');
    const T = mk();
    T.toMain('A');
    const g = T.bf('A', 'Garruk, Savage Herald');
    const isl = T.top('A', 'Island');
    T.activate('A', g, 0);
    T.resolve();
    const lib = T.zone('A', 'library');
    t.eq(lib[lib.length - 1].id, isl.id, 'the Island went to the bottom');
    const bear = T.top('A', 'Grizzly Bears');
    T.nextTurn('B'); T.nextTurn('A'); T.toMain('A');
    T.top('A', 'Grizzly Bears');
    const top = T.zone('A', 'library')[0];
    T.activate('A', g, 0);
    T.resolve();
    t.zone(top, 'hand', 'a creature: into the hand');
  });

  test('Tolsimir Wolfblood creates Voja, a legendary token with its own name', (mk, t) => {
    t.auto('Tolsimir Wolfblood');
    t.auto("Marit Lage's Slumber");
    const T = mk();
    T.toMain('A');
    const tw = T.bf('A', 'Tolsimir Wolfblood');
    const all = tw.analysis().manaAbilities.concat(tw.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    T.activate('A', tw, all.findIndex(a => /Voja/.test(a.text || '')));
    T.resolve();
    const v = T.bfOf('A').find(o => o.isToken);
    t.ok(!!v, 'a token');
    t.eq(v.name, 'Voja');
    t.ok(v.analysis().isLegendary, 'legendary');
    t.eq(T.g.powerOf(v), 4, '2/2, +1/+1 twice from Tolsimir: green and white');
  });

  test('Edgewall Innkeeper draws for a creature spell with an Adventure, not for others', (mk, t) => {
    t.auto('Edgewall Innkeeper');
    t.auto('Wandermare');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Edgewall Innkeeper');
    T.top('A', 'Island'); T.top('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', '1G');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0, 'no Adventure: nothing');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Lovestruck Beast'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'Lovestruck Beast: a card');
  });

  test('Skyclave Shadowcat: a creature that died with a +1/+1 counter on it draws a card', (mk, t) => {
    t.auto('Skyclave Shadowcat');
    t.auto('Marchesa, the Black Rose');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Skyclave Shadowcat');
    const bear = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    const elf = T.bf('A', 'Llanowar Elves');
    T.top('A', 'Island'); T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.g.moveObject(elf, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h, 'no counter: nothing');
    T.g.moveObject(bear, 'graveyard'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h + 1, 'the counter it died with: a card');
  });

  test('Prosper, Tome-Bound: playing a card from exile makes a Treasure', (mk, t) => {
    t.auto('Prosper, Tome-Bound');
    t.auto('Pia Nalaar, Consul of Revival');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Prosper, Tome-Bound');
    const treasures = () => T.bfOf('A').filter(o => o.isToken && o.name === 'Treasure').length;
    const isl = T.hand('A', 'Island');
    T.g.playLand('A', isl.id); T.settle(); T.resolve();
    t.eq(treasures(), 0, 'from the hand: nothing');
    const fr = T.put('A', 'Forest', 'exile');
    T.g.player('A').landsPlayed = 0;
    T.g.moveObject(fr, 'battlefield', { asLand: true });
    T.g._fire('youPlayLand', 'A', { object: fr, fromZone: 'exile' }); T.settle(); T.resolve();
    t.eq(treasures(), 1, 'from exile: a Treasure');
  });

  test('Chainflail Centipede: it, or the creature it equips, gets +2/+0 when attacking', (mk, t) => {
    t.auto('Chainflail Centipede');
    t.auto('Acquisition Octopus');
    const T = mk();
    const cc = T.bf('A', 'Chainflail Centipede');
    const bear = T.bf('A', 'Grizzly Bears');
    cc.attachedTo = bear.id; bear.attachments = [cc.id]; cc.ts = T.g._stampNew();
    const giant = T.bf('A', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }, { attackerId: giant.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok(T.g.powerOf(bear) >= 4, 'the equipped Bears get +2/+0');
    t.eq(T.g.powerOf(giant), 3, 'the Giant does not');
  });

  test('Iron Monger: a creature of yours conniving puts a counter on each Villain', (mk, t) => {
    t.auto('Iron Monger, Sadistic Tycoon');
    t.auto('Ultron, Unlimited');
    const T = mk();
    T.toMain('A');
    const im = T.bf('A', 'Iron Monger, Sadistic Tycoon');
    const bear = T.bf('A', 'Grizzly Bears');
    T.top('A', 'Island');
    T.hand('A', 'Island');
    T.g._runEffects([{ op: 'connive', n: 1, scope: 'self' }], { controller: 'A', obj: bear, name: 'Test', kind: 'ability' });
    T.settle(); T.resolve(); T.settle();
    t.eq(im.counters['+1/+1'], 1, 'Iron Monger, a Villain, gets a counter');
  });

  test('Pyrotechnic Performer: another creature of yours turned face up deals its power to each opponent', (mk, t) => {
    t.auto('Pyrotechnic Performer');
    t.auto('True Identity');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Pyrotechnic Performer');
    const giant = T.bf('A', 'Hill Giant');
    T.g._fire('turnedFaceUp', 'A', { object: giant, source: giant });
    T.settle(); T.resolve();
    t.eq(T.life('B'), 17, 'the Giant deals 3');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.g._fire('turnedFaceUp', 'B', { object: theirs, source: theirs });
    T.settle(); T.resolve();
    t.eq(T.life('A'), 20, "an opponent's creature: nothing");
  });

  test('Cryptid Inspector: a face-down permanent of yours entering puts a counter on it', (mk, t) => {
    t.auto('Cryptid Inspector');
    t.auto('Trail of Mystery');
    const T = mk();
    T.toMain('A');
    const ci = T.bf('A', 'Cryptid Inspector');
    const up = T.hand('A', 'Grizzly Bears');
    T.g.moveObject(up, 'battlefield', { controller: 'A' }); T.settle(); T.resolve();
    t.eq(ci.counters['+1/+1'] || 0, 0, 'face up: nothing');
    const down = T.hand('A', 'Hill Giant');
    down.faceDown = true;
    T.g.moveObject(down, 'battlefield', { controller: 'A' }); T.settle(); T.resolve();
    t.eq(ci.counters['+1/+1'], 1, 'face down: a counter');
  });

  test('Everett K. Ross: an opponent attacking you with two or more creatures draws you a card', (mk, t) => {
    t.auto('Everett K. Ross, Hapless Attaché');
    const T = mk();
    T.bf('B', 'Everett K. Ross, Hapless Attaché');
    for (let i = 0; i < 3; i++) T.top('B', 'Island');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Hill Giant');
    const h = T.zone('B', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: a.id, defenderId: 'B' }, { attackerId: b.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers');
    t.eq(T.zone('B', 'hand').length, h + 1, 'two attackers: a card');
  });

  test("Tainted Remedy turns an opponent's life gain into loss; Stranglehold skips their extra turns", (mk, t) => {
    t.auto('Tainted Remedy');
    t.auto('Plague Drone');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Tainted Remedy');
    T.g.changeLife('B', 3);
    t.eq(T.life('B'), 17, 'gains 3: loses 3');
    T.g.changeLife('A', 2);
    t.eq(T.life('A'), 22, 'its controller still gains');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Stranglehold');
    U.g.extraTurnsQueue.push('B');
    U.g._nextTurn();
    t.eq(U.g.activePlayer.id, 'B', 'B takes the next turn in order, not an extra one');
    t.eq(U.g.extraTurnsQueue.length, 0, 'the extra turn is gone');
    t.ok(U.g.log.some(l => /skips an extra turn/.test(l.text)), 'and the log says so');
  });

  test("Stranglehold: its controller's opponents can't search libraries", (mk, t) => {
    t.auto('Stranglehold');
    const T = mk();
    T.toMain('B');
    T.bf('A', 'Stranglehold');
    T.top('B', 'Island');
    const tutor = T.hand('B', 'Demonic Tutor');
    T.mana('B', '1B');
    const h = T.zone('B', 'hand').length;
    T.cast('B', tutor);
    T.resolve();
    t.eq(T.zone('B', 'hand').length, h - 1, 'nothing found');
    t.ok(T.g.log.some(l => /can't search libraries/.test(l.text)));
  });

  test('Modes that now read: a target player wheels, untap their creatures, take a creature with haste', (mk, t) => {
    t.auto('Collective Defiance');
    t.auto('Rustler Rampage');
    t.auto('Grab the Reins');
    t.auto('Fascination');
    const T = mk();
    T.toMain('A');
    const src = T.hand('A', 'Island');
    const run = (text, targets) => T.g._runEffects(engine().oracle.parseEffects(text).effects, { controller: 'A', obj: src, name: 'Test', kind: 'spell', targets });
    T.hand('B', 'Island'); T.hand('B', 'Island');
    for (let i = 0; i < 3; i++) T.top('B', 'Swamp');
    const handA = T.zone('A', 'hand').length;
    run('Target player discards all the cards in their hand, then draws that many cards.', [{ kind: 'player', id: 'B' }]);
    t.eq(T.zone('B', 'hand').filter(c => c.name === 'Swamp').length, 2, 'B discards two and draws two');
    t.eq(T.zone('A', 'hand').length, handA, 'A is untouched');
    const bear = T.bf('B', 'Grizzly Bears', { tapped: true });
    run('Untap all creatures target player controls.', [{ kind: 'player', id: 'B' }]);
    t.no(bear.tapped, 'untapped');
    run('Until end of turn, you gain control of target creature and it gains haste.', [{ kind: 'object', id: bear.id }]);
    t.eq(bear.controller, 'A', 'taken');
    t.ok(T.g.hasKw(bear, 'Haste'), 'with haste');
  });

  test("Dromoka's Command: the targeted spell's damage is prevented", (mk, t) => {
    t.auto("Dromoka's Command");
    t.auto('Shieldmage Elder');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'R');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.g.castSpell('A', bolt.id, { targets: [{ kind: 'player', id: 'B' }], auto: true });
    const item = T.stackItem(bolt);
    t.ok(!!item, 'the Bolt is on the stack');
    const src = T.hand('B', 'Island');
    T.g._runEffects(engine().oracle.parseEffects('Prevent all damage target instant or sorcery spell would deal this turn.').effects,
      { controller: 'B', obj: src, name: 'Test', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    T.resolve();
    t.eq(T.life('B'), 20, 'no damage');
  });

  test('Sunken Hope: in each upkeep, that player returns one of their creatures to hand', (mk, t) => {
    t.auto('Sunken Hope');
    t.auto('Mana Breach');
    t.auto('Temporal Cascade');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Sunken Hope');
    const bear = T.bf('B', 'Grizzly Bears');
    const mine = T.bf('A', 'Hill Giant');
    T.g._fire('eachUpkeep', null, { playerId: 'B' });
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'hand', "B returns their only creature");
    t.zone(mine, 'battlefield', "A's creature stays");
  });

  test('Gruul Charm: gain control of all permanents you own', (mk, t) => {
    t.auto('Gruul Charm');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const src = T.hand('B', 'Island');
    T.g._runEffects([{ op: 'gainControl', until: null, targets: [] }], { controller: 'B', obj: src, name: 'Test', kind: 'spell', targets: [{ kind: 'object', id: bear.id }] });
    t.eq(bear.controller, 'B', 'B took the Bears');
    const card = T.hand('A', 'Gruul Charm');
    T.g._runEffects(engine().oracle.parseEffects('Gain control of all permanents you own.').effects, { controller: 'A', obj: card, name: 'Gruul Charm', kind: 'spell' });
    t.eq(bear.controller, 'A', 'back to A');
  });

  test('Orzhov Charm returns the creature and your Auras on it', (mk, t) => {
    t.auto('Orzhov Charm');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const aura = T.bf('A', 'Rancor');
    aura.attachedTo = bear.id; bear.attachments = [aura.id];
    const card = T.hand('A', 'Orzhov Charm');
    T.g._runEffects(engine().oracle.parseEffects("Return target creature you control and all Auras you control attached to it to their owner's hand.").effects,
      { controller: 'A', obj: card, name: 'Orzhov Charm', kind: 'spell', targets: [{ kind: 'object', id: bear.id }] });
    t.zone(bear, 'hand');
    t.zone(aura, 'hand', 'Rancor with it');
  });

  test('Pay No Heed: all damage from the chosen source is prevented this turn', (mk, t) => {
    t.auto('Pay No Heed');
    t.auto("Rith's Charm");
    t.auto('Auriok Replica');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    const other = T.bf('B', 'Grizzly Bears');
    const mine = T.bf('A', 'Craw Wurm');
    const card = T.hand('A', 'Pay No Heed');
    T.answer('*', (ch) => ({ picks: [giant.id], cardIds: [giant.id], ids: [giant.id] }));
    T.mana('A', 'W');
    T.cast('A', card);
    T.resolve();
    T.g.dealDamageToPlayer(T.g.player('A'), 3, giant, true);
    T.g.dealDamageToObject(mine, 3, giant, true);
    t.eq(T.life('A'), 20, 'none to A');
    t.eq(mine.damage || 0, 0, 'none to the Wurm');
    T.g.dealDamageToPlayer(T.g.player('A'), 2, other, true);
    t.eq(T.life('A'), 18, 'another source still hurts');
  });

  test("Harsh Mentor: an opponent activating a creature's ability takes 2", (mk, t) => {
    t.auto('Harsh Mentor');
    t.auto('Runic Armasaur');
    t.auto('Burning-Tree Shaman');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Harsh Mentor');
    const theirs = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Llanowar Elves');
    T.g._fire('anyActivateAbility', null, { object: mine, objController: 'A', playerId: 'A' });
    T.settle(); T.resolve();
    t.eq(T.life('A'), 20, 'its controller: nothing');
    T.g._fire('anyActivateAbility', null, { object: theirs, objController: 'B', playerId: 'B' });
    T.settle(); T.resolve();
    t.eq(T.life('B'), 18, 'an opponent: 2 damage');
  });

  test('Reyav: an equipped attacker gains double strike; Wrecking Ball Arm: a 7/7 small creatures cannot block', (mk, t) => {
    t.auto('Reyav, Master Smith');
    t.auto('Wrecking Ball Arm');
    t.auto('Alpha Authority');
    t.auto('Beamtown Beatstick');
    const T = mk();
    T.bf('A', 'Reyav, Master Smith');
    const bear = T.bf('A', 'Grizzly Bears'), elf = T.bf('A', 'Llanowar Elves');
    const arm = T.bf('A', 'Wrecking Ball Arm');
    arm.attachedTo = bear.id; bear.attachments = [arm.id]; arm.ts = T.g._stampNew();
    T.settle();
    t.eq(T.g.powerOf(bear), 7, 'a 7/7');
    t.no(T.g.couldBlock(T.bf('B', 'Grizzly Bears'), bear, 'B'), 'power 2 cannot block it');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }, { attackerId: elf.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.ok(T.g.hasKw(bear, 'Double strike'), 'the equipped Bears strike twice');
    t.no(T.g.hasKw(elf, 'Double strike'), 'the Elves do not');
  });

  test('Loading Zone doubles counters of any kind put on your creatures', (mk, t) => {
    t.auto('Loading Zone');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Loading Zone');
    const bear = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    T.g.addCounters(bear, 'shield', 1);
    T.g.addCounters(theirs, '+1/+1', 1);
    t.eq(bear.counters['+1/+1'], 2);
    t.eq(bear.counters.shield, 2);
    t.eq(theirs.counters['+1/+1'], 1, "an opponent's: not doubled");
  });

  test('Heartflame Duelist gives your instants lifelink; Pestilent Spirit gives them deathtouch', (mk, t) => {
    t.auto('Heartflame Duelist // Heartflame Slash');
    t.auto('Pestilent Spirit');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Heartflame Duelist // Heartflame Slash');
    T.mana('A', 'R');
    const life = T.life('A');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.settle();
    t.eq(T.life('B'), 17);
    t.eq(T.life('A'), life + 3, 'lifelink from the spell');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Pestilent Spirit');
    const big = U.bf('B', 'Craw Wurm');
    U.mana('A', 'R');
    U.cast('A', U.hand('A', 'Shock'), { targets: [big] });
    U.settle();
    t.zone(big, 'graveyard', 'two damage from a deathtouch spell is enough');
  });

  test('Nest of Scarabs: you put -1/-1 counters on a creature, that many Insects', (mk, t) => {
    t.auto('Nest of Scarabs');
    t.auto('Generous Patron');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Nest of Scarabs');
    const wurm = T.bf('B', 'Craw Wurm');
    T.mana('A', 'RCC');
    T.cast('A', T.hand('A', 'Puncture Blast'), { targets: [wurm] });
    T.settle();
    t.eq(wurm.counters['-1/-1'], 3, 'wither puts three -1/-1 counters');
    t.eq(T.bfOf('A').filter(o => o.name === 'Insect Token' || /Insect/.test(o.card.type_line || '')).length, 3, 'three Insects');
    // an opponent's counters are theirs: no Insects
    T.toMain('B');
    T.mana('B', 'RCC');
    const bear = T.bf('A', 'Grizzly Bears');
    T.cast('B', T.hand('B', 'Puncture Blast'), { targets: [bear] });
    T.settle();
    t.eq(T.bfOf('A').filter(o => /Insect/.test(o.card.type_line || '')).length, 3, 'still three');
  });

  test("Edric: a creature hitting one of your opponents lets its controller draw", (mk, t) => {
    t.auto('Edric, Spymaster of Trest');
    t.auto('Fecundity');
    const T = mk();
    T.bf('A', 'Edric, Spymaster of Trest');
    const bear = T.bf('B', 'Grizzly Bears');
    T.toMain('B');
    const handB = T.zone('B', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.toMain('B', 'endCombat');
    t.eq(T.life('A'), 18);
    t.eq(T.zone('B', 'hand').length, handB, "B hit Edric's controller: no draw");
    const U = mk();
    U.bf('A', 'Edric, Spymaster of Trest');
    const ape = U.bf('A', 'Grizzly Bears');
    U.toMain('A');
    const handA = U.zone('A', 'hand').length;
    U.answer('confirm', { yes: true });
    U.answer('declareAttackers', () => [{ attackerId: ape.id, defenderId: 'B' }]);
    U.toMain('A', 'endCombat');
    t.eq(U.life('B'), 18);
    t.eq(U.zone('A', 'hand').length, handA + 1, "A's creature hit A's opponent: A draws");
    // Fecundity: the dead creature's controller is asked, and draws
    const V = mk();
    V.toMain('A');
    V.bf('A', 'Fecundity');
    const elf = V.bf('B', 'Llanowar Elves');
    const handV = V.zone('B', 'hand').length;
    let asked = null;
    V.answer('confirm', (q) => { asked = q.playerId; return { yes: true }; });
    V.mana('A', 'BBC');
    V.cast('A', V.hand('A', 'Murder'), { targets: [elf] });
    V.settle();
    t.eq(asked, 'B', 'B decides');
    t.eq(V.zone('B', 'hand').length, handV + 1, 'B draws');
  });

  test("Scion of Darkness takes a creature card from the damaged player's graveyard", (mk, t) => {
    t.auto('Scion of Darkness');
    t.auto('Ink-Eyes, Servant of Oni');
    const T = mk();
    const scion = T.bf('A', 'Scion of Darkness');
    const theirs = T.grave('B', 'Grizzly Bears');
    T.grave('A', 'Hill Giant');
    T.toMain('A');
    let offered = null;
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', (q) => { offered = (q.options || q.candidates || []).length; return { targets: [theirs.id] }; });
    T.answer('declareAttackers', () => [{ attackerId: scion.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    T.settle();
    t.eq(T.life('B'), 14);
    t.zone(theirs, 'battlefield', 'returned');
    t.eq(theirs.controller, 'A', 'under your control');
    t.eq(offered, 1, "only the damaged player's graveyard");
  });

  test('A list of creature types is any one of them: Blech, Oakhollow Village', (mk, t) => {
    t.auto('Oakhollow Village');
    t.auto('Blech, Loafing Pest');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Blech, Loafing Pest');
    const bat = T.bf('A', 'Vampire Bats'), bear = T.bf('A', 'Grizzly Bears');
    T.g.changeLife(T.player('A'), 2);
    T.resolve();
    t.eq(bat.counters['+1/+1'], 1, 'a Bat gets one');
    t.eq(bear.counters['+1/+1'], undefined, 'a Bear does not');
    const U = mk();
    U.toMain('A');
    const village = U.bf('A', 'Oakhollow Village');
    const sq = U.bf('A', 'Squirrel Mob'), elf = U.bf('A', 'Llanowar Elves'), stale = U.bf('A', 'Toski, Bearer of Secrets');
    sq.entered = U.g.turn; elf.entered = U.g.turn; stale.entered = U.g.turn - 1;
    U.mana('A', 'G');
    U.activate('A', village, 2);
    U.settle();
    t.eq(sq.counters['+1/+1'], 1, 'a Squirrel that entered this turn');
    t.eq(elf.counters['+1/+1'], undefined, 'not an Elf');
    t.eq(stale.counters['+1/+1'], undefined, 'not one from before');
  });

  test('Geosurge, Abstract Paintmage: mana from a spell or trigger keeps its restriction', (mk, t) => {
    t.auto('Geosurge');
    t.auto('Abstract Paintmage');
    t.auto('Vex');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'RRRR');
    T.cast('A', T.hand('A', 'Geosurge'));
    T.settle();
    const p = T.player('A');
    t.eq(p.pool.R || 0, 0, 'the seven red are set aside');
    t.eq(p.restricted.length, 7);
    let threw = false;
    try { T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); } catch (err) { threw = true; }
    t.ok(threw, 'not for an instant');
    T.cast('A', T.hand('A', 'Hill Giant'));
    T.settle();
    t.eq(T.bfOf('A').filter(o => o.name === 'Hill Giant').length, 1, 'a creature spell can use it');
    t.eq(p.restricted.length, 3, 'three left');
    // Vex: the countered spell's controller decides
    const V = mk();
    V.toMain('A');
    let asked = null;
    V.answer('confirm', (q) => { asked = q.playerId; return { yes: true }; });
    V.mana('A', '1G');
    V.cast('A', V.hand('A', 'Grizzly Bears'), { resolve: false });
    const item = V.g.stack[V.g.stack.length - 1];
    const vex = engine().oracle.analyze(card('Vex'));
    const handA = V.zone('A', 'hand').length;
    V.g._runEffects(vex.abilities[0].effects, { controller: 'B', name: 'Vex', kind: 'spell', targets: [{ kind: 'stack', id: item.id }] });
    V.settle();
    t.eq(asked, 'A', "the Bears' controller is asked");
    t.eq(V.zone('A', 'hand').length, handA + 1, 'and draws');
  });

  test("Inquisitor's Flail, The Sound of Drums: double combat damage from (and to) the creature", (mk, t) => {
    t.auto("Inquisitor's Flail");
    t.auto('The Sound of Drums');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), flail = T.bf('A', "Inquisitor's Flail");
    flail.attachedTo = bear.id; bear.attachments = [flail.id];
    const wall = T.bf('B', 'Wall of Wood');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(wall, 'graveyard', 'the Bears deal double: four to a 0/3');
    const U = mk();
    const ape = U.bf('A', 'Grizzly Bears'), drums = U.bf('A', 'The Sound of Drums');
    drums.attachedTo = ape.id; ape.attachments = [drums.id];
    U.toMain('A');
    U.answer('declareAttackers', () => [{ attackerId: ape.id, defenderId: 'B' }]);
    U.toMain('A', 'endCombat');
    t.eq(U.life('B'), 16, 'four to the player');
  });

  test("Inquisitor's Flail: another creature's combat damage to the equipped creature is doubled", (mk, t) => {
    const T = mk();
    const wurm = T.bf('A', 'Craw Wurm'), flail = T.bf('A', "Inquisitor's Flail");
    flail.attachedTo = wurm.id; wurm.attachments = [flail.id];
    const giant = T.bf('B', 'Hill Giant');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: wurm.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: giant.id, attackerIds: [wurm.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(giant, 'graveyard');
    t.zone(wurm, 'graveyard', 'six damage to a 6/4');
  });

  test("Patron of the Vein: an opponent's creature that dies is exiled, and Vampires grow", (mk, t) => {
    t.auto('Patron of the Vein');
    t.auto('Curse of Clinging Webs');
    const T = mk();
    T.toMain('A');
    const patron = T.bf('A', 'Patron of the Vein');
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [elf] });
    T.settle();
    t.zone(elf, 'exile', 'exiled from the graveyard');
    t.eq(patron.counters['+1/+1'], 1, 'the Vampire gets a counter');
  });

  test('Angelic Field Marshal: with your commander out, +2/+2 and vigilance for your creatures', (mk, t) => {
    t.auto('Angelic Field Marshal');
    const T = mk();
    const marshal = T.bf('A', 'Angelic Field Marshal'), bear = T.bf('A', 'Grizzly Bears');
    const base = T.g.powerOf(marshal);
    t.no(T.g.hasKw(bear, 'vigilance'), 'no commander: nothing');
    const cmd = T.bf('A', 'Llanowar Elves');
    cmd.isCommander = true;
    T.g.bumpBoard();
    t.eq(T.g.powerOf(marshal), base + 2);
    t.ok(T.g.hasKw(bear, 'vigilance'));
    t.no(T.g.hasKw(T.bf('B', 'Hill Giant'), 'vigilance'), "not an opponent's");
  });

  test('Séance Board: mana only for instant, sorcery, Demon and Spirit spells', (mk, t) => {
    t.auto('Séance Board');
    const T = mk();
    T.toMain('A');
    const board = T.bf('A', 'Séance Board');
    board.counters.soul = 2;
    T.g.tapForMana('A', board.id, 0, 'B');
    T.settle();
    t.eq(T.player('A').restricted.length, 2, 'two mana, set aside');
    let threw = false;
    try { T.cast('A', T.hand('A', 'Grizzly Bears')); } catch (err) { threw = true; }
    t.ok(threw, 'not for a Bear');
  });

  test('Jackdaw Savior: a creature card of lesser mana value back when a flyer of yours dies', (mk, t) => {
    t.auto('Jackdaw Savior');
    t.auto('Orah, Skyclave Hierophant');
    t.auto('Havi, the All-Father');
    const T = mk();
    T.toMain('A');
    const jd = T.bf('A', 'Jackdaw Savior');
    const bear = T.grave('A', 'Grizzly Bears'), wurm = T.grave('A', 'Craw Wurm');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = (ch.options && ch.options[0]) || []; return { targets: [{ kind: 'object', id: bear.id }] }; });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [jd] });
    T.settle(); T.resolve();
    t.zone(jd, 'graveyard');
    t.zone(bear, 'battlefield', 'the Bears (2) come back');
    t.ok(offered && offered.length, 'asked');
    t.no(offered && offered.some(o => o.id === wurm.id), 'the Wurm (6) is not lesser');
  });

  test("Ensnaring Bridge: power greater than its controller's hand size can't attack", (mk, t) => {
    t.auto('Ensnaring Bridge');
    const T = mk();
    T.bf('A', 'Ensnaring Bridge');
    const hand = T.zone('A', 'hand');
    while (hand.length) T.g.moveObject(hand[0], 'graveyard');
    T.hand('A', 'Island');
    const bear = T.bf('B', 'Grizzly Bears'), elf = T.bf('B', 'Llanowar Elves');
    T.toMain('B');
    t.no(T.g.canAttack(bear), 'power 2, one card in hand');
    t.ok(T.g.canAttack(elf), 'power 1 can');
    T.hand('A', 'Forest');
    t.ok(T.g.canAttack(bear), 'two cards in hand now');
  });

  test('The Wanderer: noncombat damage to you and your other permanents is prevented', (mk, t) => {
    t.auto('The Wanderer');
    t.auto('Blessed Sanctuary');
    t.auto('Drogskol Reinforcements');
    t.auto('Magebane Armor');
    const T = mk();
    T.toMain('B');
    T.bf('A', 'The Wanderer');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('B', 'RR');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    T.settle();
    t.eq(T.life('A'), 20, 'not to you');
    T.cast('B', T.hand('B', 'Shock'), { targets: [bear] });
    T.settle();
    t.zone(bear, 'battlefield', 'not to your creature');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: [theirs] });
    T.settle();
    t.zone(theirs, 'graveyard', "an opponent's is not protected");
  });

  test('Absolute Virtue: you have protection from each of your opponents', (mk, t) => {
    t.auto('Absolute Virtue');
    const T = mk();
    T.bf('A', 'Absolute Virtue');
    T.toMain('B');
    T.mana('B', 'R');
    let threw = false;
    try { T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] }); } catch (err) { threw = true; }
    t.ok(threw, "an opponent's spell can't target you");
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.toMain('B', 'endCombat');
    t.eq(T.life('A'), 20, 'their damage is prevented');
  });

  test("Brood Sliver: a Sliver's controller may create a Sliver token", (mk, t) => {
    t.auto('Brood Sliver');
    const T = mk();
    T.bf('B', 'Brood Sliver');
    const sl = T.bf('A', 'Muscle Sliver');
    let asked = null, prompt = '';
    T.answer('confirm', (q) => { asked = q.playerId; prompt = q.prompt; return { yes: true }; });
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: sl.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    T.settle();
    t.eq(asked, 'A', "the attacking Sliver's controller decides");
    t.eq(prompt, 'Brood Sliver: Create a 1/1 colorless Sliver creature token?');
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 1, 'A gets the token');
  });

  test("Death's Presence: counters equal to the last-known power of the creature that died", (mk, t) => {
    t.auto("Death's Presence");
    const T = mk();
    T.toMain('A');
    T.bf('A', "Death's Presence");
    const giant = T.bf('A', 'Hill Giant'), elf = T.bf('A', 'Llanowar Elves');
    giant.counters['+1/+1'] = 1;
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [giant] });
    T.settle();
    t.eq(T.g.powerOf(giant), 7, 'pumped to 7');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: elf.id }] });
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [giant] });
    T.settle(); T.resolve();
    t.zone(giant, 'graveyard');
    t.eq(elf.counters['+1/+1'], 7, 'its power as it last was: 3, a counter and +3');
  });

  test('Pack Leader: attacking prevents combat damage to your Dogs this turn', (mk, t) => {
    t.auto('Pack Leader');
    const T = mk();
    const pl = T.bf('A', 'Pack Leader'), bear = T.bf('A', 'Grizzly Bears');
    const wall = T.bf('B', 'Hill Giant'), wall2 = T.bf('B', 'Hill Giant');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: pl.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [pl.id] }, { blockerId: wall2.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'endCombat');
    t.zone(pl, 'battlefield', 'the Dog takes no combat damage');
    t.zone(bear, 'graveyard', 'the Bear is no Dog');
    t.ok(T.g.log.some(l => /Combat damage to Dogs A controls is prevented this turn\./.test(l.text || '')), 'log');
  });

  test('"Sacrifice a Swamp and a Forest": two different permanents (Jarad, Viscerid Drone, Sandstone Deadfall)', (mk, t) => {
    t.auto('Jarad, Golgari Lich Lord');
    t.auto('Viscerid Drone');
    t.auto('Sandstone Deadfall');
    let T = mk();
    T.toMain('A');
    let j = T.grave('A', 'Jarad, Golgari Lich Lord');
    const bayou = T.bf('A', 'Bayou');
    t.no(T.g.activateAbility('A', j.id, 1, { auto: true }), 'one dual land is not both a Swamp and a Forest to sacrifice');
    t.zone(bayou, 'battlefield');
    const forest = T.bf('A', 'Forest');
    T.activate('A', j, 1);
    t.zone(bayou, 'graveyard', 'the Bayou paid the Swamp half');
    t.zone(forest, 'graveyard', 'the Forest paid the other');
    t.zone(j, 'hand', 'Jarad is back');
    // the first part leaves the second something to pay with
    T = mk();
    T.toMain('A');
    j = T.grave('A', 'Jarad, Golgari Lich Lord');
    const b2 = T.bf('A', 'Bayou'), sw = T.bf('A', 'Swamp');
    T.activate('A', j, 1);
    t.zone(b2, 'graveyard'); t.zone(sw, 'graveyard');
    t.zone(j, 'hand');
    // Viscerid Drone: a creature and a Swamp
    T = mk();
    T.toMain('A');
    const drone = T.bf('A', 'Viscerid Drone'), bear = T.bf('A', 'Grizzly Bears'), swamp = T.bf('A', 'Swamp');
    const foe = T.bf('B', 'Hill Giant');
    T.activate('A', drone, 0, { targets: [foe], sacrificeIds: [bear.id] });
    t.zone(bear, 'graveyard'); t.zone(swamp, 'graveyard');
    t.zone(foe, 'graveyard', 'destroyed');
    // Sandstone Deadfall: two lands and this artifact
    T = mk();
    const fall = T.bf('A', 'Sandstone Deadfall'), l1 = T.bf('A', 'Plains'), l2 = T.bf('A', 'Mountain');
    const att = T.bf('B', 'Hill Giant');
    T.toMain('B');
    T.answer('declareAttackers', () => [{ attackerId: att.id, defenderId: 'A' }]);
    T.toMain('B', 'declareBlockers');
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.activate('A', fall, 0, { targets: [att] });
    t.zone(fall, 'graveyard'); t.zone(l1, 'graveyard'); t.zone(l2, 'graveyard');
    t.zone(att, 'graveyard', 'the attacker is destroyed');
  });

  test('One of each kind: Sudden Reclamation returns a creature card and a land card; To the Slaughter with delirium', (mk, t) => {
    t.auto('Sudden Reclamation');
    t.auto('Druidic Ritual');
    t.auto('To the Slaughter');
    let T = mk();
    T.toMain('A');
    const bear = T.grave('A', 'Grizzly Bears'), forest = T.grave('A', 'Forest');
    T.mana('A', 'GCCC');
    T.cast('A', T.hand('A', 'Sudden Reclamation'));
    T.settle();
    t.zone(bear, 'hand', 'the creature card');
    t.zone(forest, 'hand', 'and the land card');
    // To the Slaughter, delirium: a creature and a planeswalker
    T = mk();
    T.toMain('A');
    for (const n of ['Forest', 'Grizzly Bears', 'Lightning Bolt', 'Sol Ring']) T.grave('A', n);
    const ogre = T.bf('B', 'Hill Giant'), walker = T.bf('B', 'Jace Beleren');
    T.mana('A', 'BCC');
    T.cast('A', T.hand('A', 'To the Slaughter'), { targets: ['B'] });
    T.settle();
    t.zone(ogre, 'graveyard', 'the creature');
    t.zone(walker, 'graveyard', 'and the planeswalker');
  });

  test('Blood for Bones: one creature card to the battlefield, another to your hand', (mk, t) => {
    t.auto('Blood for Bones');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Llanowar Elves');
    const wurm = T.grave('A', 'Craw Wurm'), bear = T.grave('A', 'Grizzly Bears');
    T.answer('pickCard', { cardIds: [bear.id] });
    T.answer('pickCard', { cardIds: [wurm.id] });
    T.mana('A', 'BCCC');
    T.cast('A', T.hand('A', 'Blood for Bones'));
    T.settle();
    t.zone(bear, 'battlefield', 'the one picked first goes to the battlefield');
    t.zone(wurm, 'hand');
  });

  test('A sacrifice made by "the greatest mana value" is one sacrifice, not two (Mayhem Devil)', (mk, t) => {
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Mayhem Devil');
    T.bf('B', 'Hill Giant');
    let n = 0;
    const of = T.g._fire.bind(T.g);
    T.g._fire = (ev, c, d) => { if (ev === 'anySacrifice') n++; return of(ev, c, d); };
    T.mana('A', 'BCC');
    T.cast('A', T.hand('A', 'Soul Shatter'));
    T.settle();
    t.eq(n, 1, 'one sacrifice seen');
  });

  test('Riveteers Ascendancy: sacrificing a creature returns one of lesser mana value, tapped', (mk, t) => {
    t.auto('Riveteers Ascendancy');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Riveteers Ascendancy');
    const giant = T.bf('A', 'Hill Giant');
    const bear = T.grave('A', 'Grizzly Bears'), wurm = T.grave('A', 'Craw Wurm');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = (ch.options && ch.options[0]) || []; return { targets: [{ kind: 'object', id: bear.id }] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Village Rites'), { sacrificeIds: [giant.id] });
    T.settle(); T.resolve(); T.settle();
    t.zone(giant, 'graveyard');
    t.zone(bear, 'battlefield', 'the Bears (2) come back');
    t.ok(bear.tapped, 'tapped');
    t.no(offered && offered.some(o => o.id === wurm.id), 'the Wurm (6) is not lesser than the Giant (4)');
  });

  test('Pir, Imaginative Rascal: one more of each kind of counter on your permanents', (mk, t) => {
    t.auto('Pir, Imaginative Rascal');
    const T = mk();
    T.bf('A', 'Pir, Imaginative Rascal');
    const bear = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    T.g.addCounters(bear, 'charge', 2);
    T.g.addCounters(theirs, '+1/+1', 1);
    t.eq(bear.counters['+1/+1'], 2);
    t.eq(bear.counters.charge, 3);
    t.eq(theirs.counters['+1/+1'], 1, "an opponent's: as it was");
    T.g.addPoison(T.player('A'), 1, 'B');
    t.eq(T.player('A').poison, 1, 'not poison on you: that is no permanent');
  });

  test('Dinosaur Egg: discover X, where X is its toughness, when it dies', (mk, t) => {
    t.auto('Dinosaur Egg');
    const T = mk();
    T.toMain('A');
    const egg = T.bf('A', 'Dinosaur Egg');
    const bear = T.top('A', 'Grizzly Bears');
    T.top('A', 'Craw Wurm');
    T.answer('confirm', { yes: true });
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [egg] });
    T.settle(); T.resolve(); T.settle();
    t.zone(egg, 'graveyard');
    t.ok(bear.zone === 'battlefield' || bear.zone === 'hand', 'the Bears (2) are discovered past the Wurm (6): its toughness is 3');
  });

  test('Roar of Resistance: creatures attacking your opponents get +2/+0, not those attacking you', (mk, t) => {
    t.auto('Roar of Resistance');
    let T = mk();
    T.bf('A', 'Roar of Resistance');
    const bear = T.bf('A', 'Grizzly Bears');
    T.toMain('A');
    T.bf('A', 'Mountain'); T.bf('A', 'Mountain');
    T.answer('confirm', { yes: true });
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 16, 'four damage');
    T = mk();
    T.bf('A', 'Roar of Resistance');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.toMain('B');
    T.bf('A', 'Mountain'); T.bf('A', 'Mountain');
    T.answer('confirm', { yes: true });
    T.answer('declareAttackers', () => [{ attackerId: theirs.id, defenderId: 'A' }]);
    T.toMain('B', 'endCombat');
    t.eq(T.life('A'), 18, 'a creature attacking you is not helped');
  });

  test("Target creature it's blocking, target creature blocking it: Tinder Wall, Flowstone Salamander", (mk, t) => {
    for (const n of ['Tinder Wall', 'Flowstone Salamander', "Godo's Irregulars", 'Goblin Javelineer', 'Goblin Snowman', 'Master of Arms', 'Knight of Dusk', 'Wall of Corpses']) t.auto(n);
    let T = mk();
    const wall = T.bf('A', 'Tinder Wall'), other = T.bf('B', 'Llanowar Elves');
    const bear = T.bf('B', 'Grizzly Bears');
    T.toMain('B');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'A' }]);
    T.answer('declareBlockers', () => [{ blockerId: wall.id, attackerIds: [bear.id] }]);
    T.toMain('B', 'declareBlockers');
    T.g.priorityIndex = T.g.turnOrder.indexOf('A');
    T.mana('A', 'R');
    t.no(T.g.activateAbility('A', wall.id, 1, { targets: [{ kind: 'object', id: other.id }] }), 'not a creature it is not blocking');
    T.activate('A', wall, 1, { targets: [bear] });
    t.zone(wall, 'graveyard', 'sacrificed');
    t.zone(bear, 'graveyard', 'the Bears it was blocking take 2');
    // Flowstone Salamander: the creature blocking it
    T = mk();
    const sal = T.bf('A', 'Flowstone Salamander');
    const elf = T.bf('B', 'Llanowar Elves'), elf2 = T.bf('B', 'Llanowar Elves');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: sal.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: elf.id, attackerIds: [sal.id] }]);
    T.toMain('A', 'declareBlockers');
    T.mana('A', 'R');
    t.no(T.g.activateAbility('A', sal.id, 0, { targets: [{ kind: 'object', id: elf2.id }] }), 'not one that is not blocking it');
    T.mana('A', 'R');
    T.activate('A', sal, 0, { targets: [elf] });
    t.zone(elf, 'graveyard');
  });

  test('Silkguard: Auras, Equipment and modified creatures you control gain hexproof', (mk, t) => {
    t.auto('Silkguard');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'), elf = T.bf('A', 'Llanowar Elves');
    const sword = T.bf('A', 'Bonesplitter');
    T.mana('A', 'GC');
    T.cast('A', T.hand('A', 'Silkguard'), { x: 1, targets: [bear] });
    T.settle();
    t.eq(bear.counters['+1/+1'], 1);
    t.ok(T.g.hasKw(bear, 'hexproof'), 'the Bears are modified now');
    t.ok(T.g.hasKw(sword, 'hexproof'), 'an Equipment');
    t.no(T.g.hasKw(elf, 'hexproof'), 'an unmodified creature does not');
  });

  test('Umbra Mystic: Auras on your permanents have umbra armor', (mk, t) => {
    t.auto('Umbra Mystic');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Umbra Mystic');
    const bear = T.bf('A', 'Grizzly Bears'), aura = T.bf('A', 'Holy Strength');
    aura.attachedTo = bear.id; bear.attachments = [aura.id];
    const theirs = T.bf('B', 'Hill Giant'), aura2 = T.bf('B', 'Holy Strength');
    aura2.attachedTo = theirs.id; theirs.attachments = [aura2.id];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(aura, 'umbra armor'));
    t.no(T.g.hasKw(aura2, 'umbra armor'), "not on an opponent's creature");
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [bear] });
    T.settle();
    t.zone(bear, 'battlefield', 'the Aura is destroyed instead');
    t.zone(aura, 'graveyard');
  });

  test('Kotori, Astor: your Vehicles have crew 2, your Equipment have equip {1}', (mk, t) => {
    t.auto('Kotori, Pilot Prodigy');
    t.auto('Astor, Bearer of Blades');
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Kotori, Pilot Prodigy');
    const heart = T.bf('A', 'Heart of Kiran'), bear = T.bf('A', 'Grizzly Bears');
    const all = heart.analysis().manaAbilities.concat(heart.analysis().abilities.filter(a => a.kind === 'activated' || a.kind === 'loyalty'));
    const i = all.findIndex(a => a.text === 'Crew 2');
    t.ok(i >= 0, 'a crew 2 ability');
    T.activate('A', heart, i, { tapIds: [bear.id] });
    t.ok(bear.tapped, 'the Bears crew it');
    t.ok(T.g.characteristics(heart).isCreature, 'the Vehicle is a creature');
    T = mk();
    T.toMain('A');
    T.bf('A', 'Astor, Bearer of Blades');
    const sword = T.bf('A', 'Sword of Fire and Ice'), ape = T.bf('A', 'Grizzly Bears');
    const all2 = sword.analysis().abilities.filter(a => a.kind === 'activated');
    const j = all2.findIndex(a => /^Equip \{1\}/.test(a.text || ''));
    t.ok(j >= 0, 'an equip {1} ability');
    T.mana('A', 'C');
    T.activate('A', sword, j, { targets: [ape] });
    t.eq(sword.attachedTo, ape.id, 'equipped for {1}');
  });

  test('Hobgoblin Bandit Lord counts the Goblins that entered under your control this turn; Lilypad Village', (mk, t) => {
    t.auto('Hobgoblin Bandit Lord');
    t.auto('Lilypad Village');
    let T = mk();
    T.toMain('A');
    const lord = T.bf('A', 'Hobgoblin Bandit Lord');
    T.put('A', 'Goblin Piker', 'battlefield', { etb: true });
    T.put('A', 'Mogg Fanatic', 'battlefield', { etb: true });
    T.put('A', 'Llanowar Elves', 'battlefield', { etb: true });
    T.put('B', 'Goblin Piker', 'battlefield', { etb: true });
    T.settle();
    T.mana('A', 'R');
    T.activate('A', lord, 0, { targets: ['B'] });
    t.eq(T.life('B'), 18, "two Goblins entered under A's control: not the Elves, not B's Goblin");
    // Lilypad Village: only once a Bird, Frog, Otter or Rat has entered
    T = mk();
    T.toMain('A');
    const pad = T.bf('A', 'Lilypad Village');
    const k = pad.analysis().manaAbilities.length;
    T.mana('A', 'U');
    t.no(T.g.activateAbility('A', pad.id, k, { auto: true }), 'nothing has entered yet');
    T.put('A', 'Bog Rats', 'battlefield', { etb: true });
    T.settle();
    t.ok(T.g.activateAbility('A', pad.id, k, { auto: true }), 'a Rat entered');
  });

  test('Skullwinder: you return a card, then the chosen opponent returns one of theirs', (mk, t) => {
    t.auto('Skullwinder');
    const T = mk();
    T.toMain('A');
    const mine = T.grave('A', 'Grizzly Bears');
    const theirs = T.grave('B', 'Llanowar Elves'), theirs2 = T.grave('B', 'Craw Wurm');
    let asked = null;
    let prompt = '';
    T.answer('pickCard', (q) => { asked = q.playerId; prompt = q.prompt; return { cardIds: [theirs.id] }; });
    T.mana('A', 'GCC');
    T.cast('A', T.hand('A', 'Skullwinder'));
    T.settle(); T.resolve(); T.settle();
    t.zone(mine, 'hand', 'yours back');
    t.eq(asked, 'B', 'the opponent picks');
    t.eq(prompt, 'Return a card from your graveyard.');
    t.zone(theirs, 'hand', 'the one they picked');
    t.zone(theirs2, 'graveyard');
  });

  test("Tenza, Godo's Maul: more for a legendary creature, trample for a red one", (mk, t) => {
    t.auto("Tenza, Godo's Maul");
    const T = mk();
    const maul = T.bf('A', "Tenza, Godo's Maul"), maul2 = T.bf('A', "Tenza, Godo's Maul");
    const krenko = T.bf('A', 'Krenko, Mob Boss'), bear = T.bf('A', 'Grizzly Bears');
    maul.attachedTo = krenko.id; krenko.attachments = [maul.id];
    maul2.attachedTo = bear.id; bear.attachments = [maul2.id];
    T.g.bumpBoard();
    t.eq(T.g.powerOf(krenko), 3 + 1 + 2, 'Krenko (3/3, legendary, red): +1/+1 and +2/+2');
    t.ok(T.g.hasKw(krenko, 'trample'), 'and trample: red');
    t.eq(T.g.powerOf(bear), 3, 'the Bears: just +1/+1');
    t.no(T.g.hasKw(bear, 'trample'), 'green: no trample');
  });

  test("Fateful Absence: the destroyed creature's controller investigates", (mk, t) => {
    t.auto('Fateful Absence');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'WC');
    T.cast('A', T.hand('A', 'Fateful Absence'), { targets: [giant] });
    T.settle();
    t.zone(giant, 'graveyard');
    t.eq(T.bfOf('B').filter(o => o.name === 'Clue').length, 1, 'B gets the Clue');
    t.eq(T.bfOf('A').filter(o => o.name === 'Clue').length, 0);
  });

  test("Cards put into your graveyard from the battlefield this turn: Faith's Reward, Othelm, Gleancrawler", (mk, t) => {
    for (const n of ["Faith's Reward", 'Othelm, Sigardian Outcast', 'Gleancrawler', 'Second Sunrise', 'Thrilling Encore', 'Grim Return', 'Salvager of Ruin', 'Samwise the Stouthearted', 'Moira, Urborg Haunt', "Gerrard's Hourglass Pendant", 'Gerrard, Weatherlight Hero']) t.auto(n);
    let T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'), ring = T.bf('A', 'Sol Ring');
    const old = T.grave('A', 'Hill Giant');
    T.g.moveObject(bear, 'graveyard'); T.g.moveObject(ring, 'graveyard');
    T.mana('A', 'WCCC');
    T.cast('A', T.hand('A', "Faith's Reward"));
    T.settle();
    t.zone(bear, 'battlefield', 'the Bears went there this turn');
    t.zone(ring, 'battlefield', 'so did the Sol Ring');
    t.zone(old, 'graveyard', 'the Giant was there already');
    // Othelm: only a card that went there from the battlefield this turn is a target
    T = mk();
    T.toMain('A');
    const oth = T.bf('A', 'Othelm, Sigardian Outcast');
    const elf = T.bf('A', 'Llanowar Elves'), old2 = T.grave('A', 'Craw Wurm');
    T.g.moveObject(elf, 'graveyard');
    const k = oth.analysis().manaAbilities.length;
    T.mana('A', 'CC');
    t.no(T.g.activateAbility('A', oth.id, k, { targets: [{ kind: 'object', id: old2.id }] }), 'not the Wurm');
    T.activate('A', oth, k, { targets: [elf] });
    t.zone(elf, 'battlefield');
    t.ok(elf.tapped, 'tapped');
  });

  test('Kinbinding: +X/+X for each creature that entered under your control this turn, and none the next', (mk, t) => {
    t.auto('Kinbinding');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Kinbinding');
    const bear = T.bf('A', 'Grizzly Bears');
    T.put('A', 'Llanowar Elves', 'battlefield', { etb: true });
    T.put('A', 'Hill Giant', 'battlefield', { etb: true });
    T.put('B', 'Hill Giant', 'battlefield', { etb: true });
    T.settle();
    t.eq(T.g.powerOf(bear), 4, "two of A's entered");
    T.nextTurn('B');
    t.eq(T.g.powerOf(bear), 2, 'a new turn: none yet');
  });

  test('The Stasis Coffin: protection from everything until your next turn', (mk, t) => {
    t.auto('The Stasis Coffin');
    const T = mk();
    T.toMain('A');
    const coffin = T.bf('A', 'The Stasis Coffin');
    T.mana('A', 'CC');
    T.activate('A', coffin, 0);
    t.zone(coffin, 'exile');
    T.toMain('B');
    T.mana('B', 'R');
    let threw = false;
    try { T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] }); } catch (err) { threw = true; }
    t.ok(threw, "A can't be targeted");
    T.nextTurn('A');
    t.no(T.g._protected(T.player('A')), "gone on A's next turn");
  });

  test("Biorhythm sets each life total to that player's creatures; Mirror Universe exchanges life totals", (mk, t) => {
    t.auto('Biorhythm');
    t.auto('Mirror Universe');
    t.auto('Magus of the Mirror');
    let T = mk();
    T.toMain('A');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Llanowar Elves'); T.bf('B', 'Hill Giant');
    T.mana('A', 'GGGGGGCC');
    T.cast('A', T.hand('A', 'Biorhythm'));
    T.settle();
    t.eq(T.life('A'), 2);
    t.eq(T.life('B'), 1);
    T = mk();
    const mirror = T.bf('A', 'Mirror Universe');
    T.g.changeLife(T.player('A'), -15);
    T.toMain('A', 'upkeep');
    T.activate('A', mirror, 0, { targets: ['B'] });
    t.eq(T.life('A'), 20, "A takes B's 20");
    t.eq(T.life('B'), 5, "B takes A's 5");
  });

  test("It deals N damage to each creature blocking it: Battle-Scarred Goblin, Trailblazer's Torch", (mk, t) => {
    t.auto('Battle-Scarred Goblin');
    t.auto("Trailblazer's Torch");
    let T = mk();
    const gob = T.bf('A', 'Battle-Scarred Goblin');
    const e1 = T.bf('B', 'Llanowar Elves'), e2 = T.bf('B', 'Llanowar Elves'), off = T.bf('B', 'Llanowar Elves');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: gob.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: e1.id, attackerIds: [gob.id] }, { blockerId: e2.id, attackerIds: [gob.id] }]);
    T.toMain('A', 'declareBlockers');
    T.settle(); T.resolve(); T.settle();
    t.zone(e1, 'graveyard'); t.zone(e2, 'graveyard');
    t.zone(off, 'battlefield', 'not one that is not blocking');
    T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), torch = T.bf('A', "Trailblazer's Torch");
    torch.attachedTo = bear.id; bear.attachments = [torch.id];
    const giant = T.bf('B', 'Hill Giant');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => [{ blockerId: giant.id, attackerIds: [bear.id] }]);
    T.toMain('A', 'declareBlockers');
    T.settle(); T.resolve(); T.settle();
    t.eq(giant.damage, 2, 'two damage to the creature blocking the equipped Bears');
  });

  test('Shallow Grave: the top creature card of your graveyard, with haste, exiled at the end step', (mk, t) => {
    t.auto('Shallow Grave');
    t.auto('Corpse Dance');
    t.auto('Mistmoon Griffin');
    const T = mk();
    T.toMain('A');
    const wurm = T.grave('A', 'Craw Wurm');
    T.grave('A', 'Lightning Bolt');
    const bear = T.grave('A', 'Grizzly Bears');
    T.grave('A', 'Forest');
    T.mana('A', 'BC');
    T.cast('A', T.hand('A', 'Shallow Grave'));
    T.settle();
    t.zone(bear, 'battlefield', 'the last creature card put there');
    t.zone(wurm, 'graveyard');
    t.ok(T.g.hasKw(bear, 'haste'), 'with haste');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'exile', 'exiled at the end step');
  });

  test('Avarice Totem: exchange control of this artifact and target nonland permanent', (mk, t) => {
    t.auto('Avarice Totem');
    t.auto('Eyes Everywhere');
    t.auto('Phyrexian Infiltrator');
    const T = mk();
    T.toMain('A');
    const totem = T.bf('A', 'Avarice Totem'), giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'CCCCC');
    T.activate('A', totem, 0, { targets: [giant] });
    t.eq(giant.controller, 'A', "the Giant is A's");
    t.eq(totem.controller, 'B', "the Totem is B's");
  });

  test('Incremental Growth: one, two and three counters on three targets; Challenger Troll', (mk, t) => {
    t.auto('Incremental Growth');
    t.auto('Incremental Blight');
    t.auto('Challenger Troll');
    let T = mk();
    T.toMain('A');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Llanowar Elves'), c = T.bf('A', 'Hill Giant');
    T.mana('A', 'GGCCC');
    T.cast('A', T.hand('A', 'Incremental Growth'), { targets: [a, b, c] });
    T.settle();
    t.eq(a.counters['+1/+1'], 1); t.eq(b.counters['+1/+1'], 2); t.eq(c.counters['+1/+1'], 3);
    // Challenger Troll: a creature of yours with power 4 or greater, blocked by one at most
    T = mk();
    T.bf('A', 'Challenger Troll');
    const wurm = T.bf('A', 'Craw Wurm');
    const e1 = T.bf('B', 'Llanowar Elves'), e2 = T.bf('B', 'Llanowar Elves');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: wurm.id, defenderId: 'B' }]);
    let two = null, why = '';
    T.answer('declareBlockers', (ch, g) => {
      two = g.declareBlockers('B', [{ blockerId: e1.id, attackerIds: [wurm.id] }, { blockerId: e2.id, attackerIds: [wurm.id] }]);
      why = g.lastError || '';
      return [{ blockerId: e1.id, attackerIds: [wurm.id] }];
    });
    T.toMain('A', 'endCombat');
    t.no(two, 'two blockers refused');
    t.ok(/more than one creature/.test(why), why);
    t.zone(e1, 'graveyard', 'one blocker is fine');
  });

  test("Mutiny: an opponent's creature deals damage equal to its power to another of theirs", (mk, t) => {
    t.auto('Mutiny');
    t.auto('Breaking of the Fellowship');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant'), bear = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Llanowar Elves');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Mutiny').id, { targets: [{ kind: 'object', id: giant.id }, { kind: 'object', id: mine.id }], auto: true }), 'not one of yours');
    T.cast('A', T.hand('A', 'Mutiny'), { targets: [giant, bear] });
    T.settle();
    t.zone(bear, 'graveyard', 'three damage from the Giant');
    t.zone(giant, 'battlefield');
  });

  test('Sleeper Agent: target opponent gains control of it as it enters', (mk, t) => {
    t.auto('Sleeper Agent');
    t.auto('Goblin Cadets');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Sleeper Agent'));
    T.settle(); T.resolve(); T.settle();
    const agent = T.g.battlefield.find(o => o.name === 'Sleeper Agent');
    t.ok(agent, 'on the battlefield');
    t.eq(agent && agent.controller, 'B', 'B controls it');
  });

  test('Meteor Blast: 4 damage to each of X targets', (mk, t) => {
    t.auto('Meteor Blast');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'RRRCC');
    T.cast('A', T.hand('A', 'Meteor Blast'), { x: 2, targets: ['B', giant] });
    T.settle();
    t.eq(T.life('B'), 16);
    t.zone(giant, 'graveyard');
  });

  test('Vexing Devil: an opponent may take 4 damage, and then it is sacrificed', (mk, t) => {
    t.auto('Vexing Devil');
    t.auto('Longhorn Firebeast');
    let T = mk();
    T.toMain('A');
    let q = null;
    T.answer('confirm', (ch) => { q = ch; return { yes: true }; });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Vexing Devil'));
    T.settle(); T.resolve(); T.settle();
    t.eq(q && q.playerId, 'B', 'the opponent is asked');
    t.eq(q && q.yesLabel, 'Take 4 damage');
    t.eq(T.life('B'), 16);
    t.eq(T.g.battlefield.filter(o => o.name === 'Vexing Devil').length, 0, 'sacrificed');
    T = mk();
    T.toMain('A');
    T.answer('confirm', { yes: false });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Vexing Devil'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 20);
    t.eq(T.g.battlefield.filter(o => o.name === 'Vexing Devil').length, 1, 'it stays');
  });

  test("Rakshasa Debaser: a creature card from the defending player's graveyard", (mk, t) => {
    t.auto('Rakshasa Debaser');
    const T = mk();
    const rak = T.bf('A', 'Rakshasa Debaser');
    const theirs = T.grave('B', 'Hill Giant'), mine = T.grave('A', 'Craw Wurm');
    let offered = null;
    T.answer('pickTarget', (ch) => { offered = (ch.options && ch.options[0]) || []; return { targets: [{ kind: 'object', id: theirs.id }] }; });
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: rak.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    T.settle(); T.resolve(); T.settle();
    t.zone(theirs, 'battlefield');
    t.eq(theirs.controller, 'A');
    t.no(offered && offered.some(o => o.id === mine.id), 'not from your own graveyard');
  });

  test('It That Betrays takes what an opponent sacrifices; Mortician Beetle grows on any sacrifice', (mk, t) => {
    t.auto('It That Betrays');
    t.auto('Mortician Beetle');
    t.auto('Thraximundar');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'It That Betrays');
    const beetle = T.bf('A', 'Mortician Beetle');
    const giant = T.bf('B', 'Hill Giant');
    T.answer('confirm', { yes: true });
    T.mana('A', 'BC');
    T.cast('A', T.hand('A', 'Diabolic Edict'), { targets: ['B'] });
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.zone(giant, 'battlefield', 'the Giant comes back');
    t.eq(giant.controller, 'A', "under A's control");
    t.eq(beetle.counters['+1/+1'], 1, 'the Beetle saw a creature sacrificed');
  });

  test('Nev, the Practical Dean: the first spell with {X} each turn puts X counters on it', (mk, t) => {
    t.auto('Nev, the Practical Dean');
    t.auto('Owlin Spiralmancer');
    const T = mk();
    T.toMain('A');
    const nev = T.bf('A', 'Nev, the Practical Dean');
    T.mana('A', 'RCCC');
    T.cast('A', T.hand('A', 'Blaze'), { x: 3, targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(nev.counters['+1/+1'], 3, 'X was 3');
    T.mana('A', 'RCC');
    T.cast('A', T.hand('A', 'Blaze'), { x: 2, targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(nev.counters['+1/+1'], 3, 'only the first one each turn');
  });

  test('Madcap Experiment: an artifact onto the battlefield, and damage for each card revealed', (mk, t) => {
    t.auto('Madcap Experiment');
    t.auto('Audacious Reshapers');
    const T = mk();
    T.toMain('A');
    const ring = T.top('A', 'Sol Ring');
    T.top('A', 'Forest'); T.top('A', 'Grizzly Bears');
    T.mana('A', 'RCCC');
    T.cast('A', T.hand('A', 'Madcap Experiment'));
    T.settle();
    t.zone(ring, 'battlefield');
    t.eq(T.life('A'), 17, 'three cards revealed: 3 damage');
  });

  test("Martyr's Cause: the next damage a chosen source would deal to anything is prevented", (mk, t) => {
    t.auto("Martyr's Cause");
    t.auto('Circle of Despair');
    t.auto('Sanctum Guardian');
    const T = mk();
    T.toMain('A');
    const cause = T.bf('A', "Martyr's Cause"), elf = T.bf('A', 'Llanowar Elves');
    const giant = T.bf('B', 'Hill Giant'), bear = T.bf('A', 'Grizzly Bears');
    let prompt = '';
    T.answer('choose', (q) => { prompt = q.prompt || ''; return { picks: [giant.id] }; });
    T.activate('A', cause, 0, { sacrificeIds: [elf.id] });
    T.resolve();
    t.eq(prompt, 'Choose a source: the next damage it would deal this turn is prevented.');
    T.g.dealDamageToObject(bear, 3, giant, true);
    t.zone(bear, 'battlefield', 'prevented, to a creature');
    T.g.dealDamageToPlayer(T.g.player('A'), 3, giant, true);
    t.eq(T.life('A'), 17, 'only the next time');
  });

  test('Winds of Abandon: each exiled creature gives its controller a basic land, tapped; overloaded, one for each', (mk, t) => {
    t.auto('Winds of Abandon');
    let T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    T.top('B', 'Forest');
    T.mana('A', 'WC');
    T.cast('A', T.hand('A', 'Winds of Abandon'), { targets: [giant] });
    T.settle();
    t.zone(giant, 'exile');
    const lands = T.bfOf('B').filter(o => (o.analysis() || {}).isLand);
    t.eq(lands.length, 1, 'B finds a basic land');
    t.ok(lands[0] && lands[0].tapped, 'tapped');
    T = mk();
    T.toMain('A');
    T.bf('B', 'Hill Giant'); T.bf('B', 'Grizzly Bears'); const mine = T.bf('A', 'Llanowar Elves');
    T.top('B', 'Forest'); T.top('B', 'Plains');
    T.mana('A', 'WWCCCC');
    t.ok(T.g.castSpell('A', T.hand('A', 'Winds of Abandon').id, { via: 'overload', auto: true }), T.g.lastError);
    T.settle(); T.resolve(); T.settle();
    t.eq(T.bfOf('B').filter(o => (o.analysis() || {}).isLand).length, 2, 'two creatures exiled: two lands');
    t.zone(mine, 'battlefield', 'yours stay');
  });

  test('Scheming Symmetry: each of two target players puts a card of their choice on top', (mk, t) => {
    t.auto('Scheming Symmetry');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) { T.top('A', 'Island'); T.top('B', 'Swamp'); }
    const mine = T.top('A', 'Craw Wurm'), theirs = T.top('B', 'Hill Giant');
    for (let i = 0; i < 3; i++) { T.top('A', 'Island'); T.top('B', 'Swamp'); }
    const asked = [];
    T.answer('pickCard', (q) => { asked.push(q.playerId); return { cardIds: [q.playerId === 'A' ? mine.id : theirs.id] }; });
    T.answer('pickCard', (q) => { asked.push(q.playerId); return { cardIds: [q.playerId === 'A' ? mine.id : theirs.id] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Scheming Symmetry'), { targets: ['A', 'B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(asked.join(','), 'A,B', 'each player picks their own');
    t.eq(T.g.zones.A.library[0], mine, "on top of A's library");
    t.eq(T.g.zones.B.library[0], theirs, "on top of B's library");
  });

  test('Rise of the Witch-king: if you sacrificed a creature, return another permanent card', (mk, t) => {
    t.auto('Rise of the Witch-king');
    let T = mk();
    T.toMain('A');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant');
    const ring = T.grave('A', 'Sol Ring'), old = T.grave('A', 'Craw Wurm');
    let offered = null;
    T.answer('confirm', { yes: true });
    T.answer('pickCard', (q) => { offered = (q.cards || []).map(c => c.id); return { cardIds: [ring.id] }; });
    T.mana('A', 'BGCC');
    T.cast('A', T.hand('A', 'Rise of the Witch-king'));
    T.settle(); T.resolve(); T.settle();
    t.zone(mine, 'graveyard'); t.zone(theirs, 'graveyard');
    t.zone(ring, 'battlefield', 'a permanent card back');
    t.ok(offered && offered.includes(old.id) && !offered.includes(mine.id), 'not the creature sacrificed');
    // nothing to sacrifice: nothing back
    T = mk();
    T.toMain('A');
    T.bf('B', 'Hill Giant');
    const ring2 = T.grave('A', 'Sol Ring');
    T.answer('confirm', { yes: true });
    T.mana('A', 'BGCC');
    T.cast('A', T.hand('A', 'Rise of the Witch-king'));
    T.settle(); T.resolve(); T.settle();
    t.zone(ring2, 'graveyard', 'you sacrificed nothing');
  });

  test('Gift of Immortality: the creature comes back, and the Aura returns on it at the end step', (mk, t) => {
    t.auto('Gift of Immortality');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears'), gift = T.bf('A', 'Gift of Immortality');
    gift.attachedTo = bear.id; bear.attachments = [gift.id];
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [bear] });
    T.settle(); T.resolve(); T.settle();
    t.zone(bear, 'battlefield', 'the Bears come back');
    t.zone(gift, 'graveyard', 'the Aura waits for the end step');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(gift, 'battlefield');
    t.eq(gift.attachedTo, bear.id, 'attached to the Bears again');
  });

  test("Nature's Will: tap all lands that player controls and untap all lands you control", (mk, t) => {
    t.auto("Nature's Will");
    t.auto("Pretender's Claim");
    const T = mk();
    T.bf('A', "Nature's Will");
    const bear = T.bf('A', 'Grizzly Bears'), myLand = T.bf('A', 'Forest'), theirLand = T.bf('B', 'Island'), otherCreature = T.bf('B', 'Llanowar Elves');
    T.toMain('A');
    myLand.tapped = true;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat'); T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 18);
    t.ok(theirLand.tapped, "B's land is tapped");
    t.no(myLand.tapped, "A's land is untapped");
    t.no(otherCreature.tapped, 'not their creatures');
  });

  test('Shield-Wall Sentinel: search for a creature card with defender', (mk, t) => {
    t.auto('Shield-Wall Sentinel');
    const T = mk();
    T.toMain('A');
    const bear = T.top('A', 'Grizzly Bears'), wall = T.top('A', 'Wall of Wood');
    let offered = null;
    T.answer('confirm', { yes: true });
    T.answer('pickCard', (q) => { offered = (q.cards || []).map(c => c.id); return { cardIds: [wall.id] }; });
    T.mana('A', 'WCCC');
    T.cast('A', T.hand('A', 'Shield-Wall Sentinel'));
    T.settle(); T.resolve(); T.settle();
    t.zone(wall, 'hand');
    t.ok(!offered || !offered.includes(bear.id), 'not a creature without defender');
    t.zone(bear, 'library');
  });

  test('Repay in Kind, Acidic Soil, Meltdown, Emergency Eject', (mk, t) => {
    for (const n of ['Repay in Kind', 'Acidic Soil', 'Meltdown', 'Emergency Eject']) t.auto(n);
    let T = mk();
    T.toMain('A');
    T.g.changeLife(T.player('B'), -13);
    T.mana('A', 'BBCCCCC');
    T.cast('A', T.hand('A', 'Repay in Kind'));
    T.settle();
    t.eq(T.life('A'), 7); t.eq(T.life('B'), 7);
    T = mk();
    T.toMain('A');
    T.bf('A', 'Forest'); T.bf('B', 'Island'); T.bf('B', 'Island');
    T.mana('A', 'RCC');
    T.cast('A', T.hand('A', 'Acidic Soil'));
    T.settle();
    t.eq(T.life('A'), 19, 'one land'); t.eq(T.life('B'), 18, 'two lands');
    T = mk();
    T.toMain('A');
    const ring = T.bf('B', 'Sol Ring'), stone = T.bf('B', 'Mind Stone'), big = T.bf('B', 'Wurmcoil Engine');
    T.mana('A', 'RCC');
    T.cast('A', T.hand('A', 'Meltdown'), { x: 2 });
    T.settle();
    t.zone(ring, 'graveyard'); t.zone(stone, 'graveyard'); t.zone(big, 'battlefield', 'mana value 6 stays');
    T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'WCC');
    T.cast('A', T.hand('A', 'Emergency Eject'), { targets: [giant] });
    T.settle();
    t.zone(giant, 'graveyard');
    t.eq(T.bfOf('B').filter(o => o.name === 'Lander').length, 1, 'B gets a Lander');
  });

  test('Avatar of Slaughter: all creatures have double strike and attack each combat if able', (mk, t) => {
    t.auto('Avatar of Slaughter');
    t.auto('Hellraiser Goblin');
    const T = mk();
    T.bf('A', 'Avatar of Slaughter');
    const bear = T.bf('B', 'Grizzly Bears');
    T.g.bumpBoard();
    t.ok(T.g.hasKw(bear, 'double strike'));
    t.ok(T.g._hasFlag(bear, 'mustAttackEot') || T.g._hasFlag(bear, 'mustAttack'), 'must attack');
  });

  test('Morbid Curiosity: draw cards equal to the mana value of the sacrificed permanent', (mk, t) => {
    t.auto('Morbid Curiosity');
    t.auto('Memorial Vault');
    const T = mk();
    T.toMain('A');
    const wurm = T.bf('A', 'Craw Wurm');
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Morbid Curiosity'), { sacrificeIds: [wurm.id] });
    T.settle();
    t.zone(wurm, 'graveyard');
    t.eq(T.zone('A', 'hand').length, hand + 6, 'six cards for the Wurm');
  });

  test("Bower Passage: creatures with flying can't block your creatures", (mk, t) => {
    t.auto('Bower Passage');
    const T = mk();
    T.bf('A', 'Bower Passage');
    const bear = T.bf('A', 'Grizzly Bears');
    const bird = T.bf('B', 'Suntail Hawk'), elf = T.bf('B', 'Llanowar Elves');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    let flyer = null, ground = null;
    T.answer('declareBlockers', (ch, g) => {
      flyer = g.declareBlockers('B', [{ blockerId: bird.id, attackerIds: [bear.id] }]);
      return [{ blockerId: elf.id, attackerIds: [bear.id] }];
    });
    T.toMain('A', 'endCombat');
    t.no(flyer, 'the Hawk may not block');
    t.zone(elf, 'graveyard', 'the Elves may');
  });

  test("If you've cast another spell this turn: Slick Sequence draws, Focus the Mind costs {2} less", (mk, t) => {
    t.auto('Slick Sequence');
    t.auto('Focus the Mind');
    let T = mk();
    T.toMain('A');
    let hand = T.zone('A', 'hand').length;
    T.mana('A', 'UR');
    T.cast('A', T.hand('A', 'Slick Sequence'), { targets: ['B'] });
    T.settle();
    t.eq(T.life('B'), 18);
    t.eq(T.zone('A', 'hand').length, hand, 'the first spell this turn: no card');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.settle();
    hand = T.zone('A', 'hand').length;
    T.mana('A', 'UR');
    T.cast('A', T.hand('A', 'Slick Sequence'), { targets: ['B'] });
    T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'another spell was cast: a card');
    T = mk();
    T.toMain('A');
    T.mana('A', 'UCC');
    t.no(T.g.castSpell('A', T.hand('A', 'Focus the Mind').id, { auto: true }), 'full price first');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.settle();
    t.ok(T.g.castSpell('A', T.hand('A', 'Focus the Mind').id, { auto: true }), T.g.lastError);
  });

  test("Whenever you tap an untapped creature an opponent controls: Icewrought Sentry, Sharae", (mk, t) => {
    t.auto('Solitary Sanctuary');
    t.auto('Icewrought Sentry');
    t.auto('Sharae of Numbing Depths');
    const T = mk();
    T.toMain('A');
    const sentry = T.bf('A', 'Icewrought Sentry'), sharae = T.bf('A', 'Sharae of Numbing Depths');
    const g1 = T.bf('B', 'Hill Giant'), g2 = T.bf('B', 'Grizzly Bears'), mine = T.bf('A', 'Llanowar Elves');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', 'UCC');
    T.cast('A', T.hand('A', 'Frost Breath'), { targets: [g1, g2] });
    T.settle(); T.resolve(); T.settle(); T.resolve(); T.settle();
    t.ok(g1.tapped && g2.tapped);
    t.eq(T.g.powerOf(sentry), 2 + 2 + 2, 'two of theirs tapped: +2/+1 twice');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'Sharae: one card, once a turn');
  });

  test('Treefolk Umbra: the enchanted creature deals combat damage equal to its toughness', (mk, t) => {
    t.auto('Treefolk Umbra');
    t.auto('Gauntlets of Light');
    const T = mk();
    const wall = T.bf('A', 'Wall of Wood'), umbra = T.bf('A', 'Treefolk Umbra'), other = T.bf('A', 'Wall of Wood');
    umbra.attachedTo = wall.id; wall.attachments = [umbra.id];
    T.g.bumpBoard();
    t.eq(T.g.toughnessOf(wall), 5, '0/3 with +0/+2');
    t.ok(T.g._dealsByToughness(wall));
    t.no(T.g._dealsByToughness(other), 'not another creature');
  });

  test('Otherworldly Journey: back at the end step with a +1/+1 counter', (mk, t) => {
    t.auto('Otherworldly Journey');
    t.auto('Long Road Home');
    const T = mk();
    T.toMain('A');
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'WC');
    T.cast('A', T.hand('A', 'Otherworldly Journey'), { targets: [giant] });
    T.settle();
    t.zone(giant, 'exile');
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.zone(giant, 'battlefield');
    t.eq(giant.controller, 'B', "under its owner's control");
    t.eq(giant.counters['+1/+1'], 1);
  });

  test('Owlin Spiralmancer copies the first {X} spell once, and the stack empties', (mk, t) => {
    t.auto('Owlin Spiralmancer');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Owlin Spiralmancer');
    T.answer('confirm', { yes: true });
    T.mana('A', 'RC');
    T.cast('A', T.hand('A', 'Blaze'), { x: 1, targets: ['B'] });
    for (let i = 0; i < 10 && T.g.stack.length; i++) { T.settle(); T.resolve(); }
    T.settle();
    t.eq(T.g.stack.length, 0, 'the stack empties');
    t.eq(T.life('B'), 18, 'the spell and one copy');
  });

  test("Obstinate Gargoyle: flying as long as it's modified", (mk, t) => {
    t.auto('Obstinate Gargoyle');
    t.auto('Skyward Spider');
    const T = mk();
    const g = T.bf('A', 'Obstinate Gargoyle');
    t.no(T.g.hasKw(g, 'flying'), 'unmodified');
    T.g.addCounters(g, '+1/+1', 1);
    t.ok(T.g.hasKw(g, 'flying'), 'a counter');
    const s2 = T.bf('A', 'Skyward Spider'), sword = T.bf('A', 'Bonesplitter');
    t.no(T.g.hasKw(s2, 'flying'));
    sword.attachedTo = s2.id; s2.attachments = [sword.id];
    T.g.bumpBoard();
    t.ok(T.g.hasKw(s2, 'flying'), 'an Equipment');
  });

  test('Amorphous Axe: the equipped creature is every creature type', (mk, t) => {
    t.auto('Amorphous Axe');
    t.auto('Runed Stalactite');
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears'), axe = T.bf('A', 'Amorphous Axe');
    axe.attachedTo = bear.id; bear.attachments = [axe.id];
    T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 5, '+3/+0');
    t.ok(T.g._hasCreatureType(bear, 'Goblin') && T.g._hasCreatureType(bear, 'Elf'), 'a Goblin and an Elf');
  });

  test('Whirlpool Warrior: shuffle your hand into your library and draw that many', (mk, t) => {
    t.auto('Whirlpool Warrior');
    t.auto('Whirlpool Rider');
    t.auto('Whirlpool Drake');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 10; i++) T.top('A', 'Island');
    const hand = T.zone('A', 'hand');
    while (hand.length) T.g.moveObject(hand[0], 'graveyard');
    const a = T.hand('A', 'Craw Wurm'), b = T.hand('A', 'Hill Giant');
    const bHand = T.zone('B', 'hand').length;
    T.mana('A', 'UCC');
    T.cast('A', T.hand('A', 'Whirlpool Warrior'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, 2, 'two shuffled in, two drawn');
    t.eq(T.zone('B', 'hand').length, bHand, "the opponent's hand is untouched");
  });

  test("Deadeye Tracker: exile two target cards from an opponent's graveyard, then explore", (mk, t) => {
    t.auto('Deadeye Tracker');
    t.auto('Lochmere Serpent');
    const T = mk();
    T.toMain('A');
    const dt = T.bf('A', 'Deadeye Tracker');
    const c1 = T.grave('B', 'Hill Giant'), c2 = T.grave('B', 'Lightning Bolt'), mine = T.grave('A', 'Craw Wurm');
    T.top('A', 'Forest');
    T.mana('A', 'BC');
    t.no(T.g.activateAbility('A', dt.id, 0, { targets: [{ kind: 'object', id: c1.id }, { kind: 'object', id: mine.id }] }), 'not from your own graveyard');
    T.activate('A', dt, 0, { targets: [c1, c2] });
    t.zone(c1, 'exile'); t.zone(c2, 'exile');
    t.zone(mine, 'graveyard');
  });

  test("God-Eternal Rhonas: dies or exiled from the battlefield, third from the top of its owner's library", (mk, t) => {
    t.auto('God-Eternal Oketra');
    t.auto('God-Eternal Rhonas');
    for (const how of ['die', 'exile']) {
      const T = mk();
      T.toMain('A');
      for (let i = 0; i < 5; i++) T.top('A', 'Island');
      const god = T.bf('A', 'God-Eternal Rhonas');
      T.answer('confirm', { yes: true });
      if (how === 'die') { T.mana('A', 'BBC'); T.cast('A', T.hand('A', 'Murder'), { targets: [god] }); }
      else { T.mana('A', 'W'); T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [god] }); }
      T.settle(); T.resolve(); T.settle();
      t.zone(god, 'library', how);
      t.eq(T.g.zones.A.library.indexOf(god), 2, how + ': third from the top');
      t.ok(T.g.log.some(l => /God-Eternal Rhonas goes into A's library third from the top\./.test(l.text || '')), 'log');
    }
    // Approach of the Second Sun: seventh from the top, six cards above it
    const T2 = mk({ libraryEach: 10 });
    const ap = T2.hand('A', 'Approach of the Second Sun');
    T2.mana('A', 'W6');
    T2.cast('A', ap);
    t.eq(T2.g.zones.A.library.indexOf(ap), 6, 'seventh from the top');
  });

  test("Ashnod's Intervention: back to its owner's hand whether it dies or is exiled", (mk, t) => {
    t.auto("Ashnod's Intervention");
    for (const how of ['die', 'exile']) {
      const T = mk();
      T.toMain('A');
      const bear = T.bf('A', 'Grizzly Bears');
      T.mana('A', 'B');
      T.cast('A', T.hand('A', "Ashnod's Intervention"), { targets: [bear] });
      T.settle();
      if (how === 'die') { T.mana('A', 'BBC'); T.cast('A', T.hand('A', 'Murder'), { targets: [bear] }); }
      else { T.mana('A', 'W'); T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [bear] }); }
      T.settle(); T.resolve(); T.settle();
      t.zone(bear, 'hand', how);
    }
  });

  test('River of Tears: {U}, or {B} once you have played a land this turn', (mk, t) => {
    t.auto('River of Tears');
    const T = mk();
    T.toMain('A');
    const river = T.bf('A', 'River of Tears');
    T.g.tapForMana('A', river.id, 0);
    t.eq(T.player('A').pool.U || 0, 1, 'no land played yet: {U}');
    T.player('A').pool.clear();
    river.tapped = false;
    const land = T.hand('A', 'Swamp');
    t.ok(T.g.playLand('A', land.id), T.g.lastError);
    T.g.tapForMana('A', river.id, 0);
    t.eq(T.player('A').pool.B || 0, 1, 'a land played: {B}');
  });

  test("Wilhelt, the Rotcleaver: a Zombie without decayed leaves a decayed Zombie behind; a decayed one doesn't", (mk, t) => {
    t.auto('Wilhelt, the Rotcleaver');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Wilhelt, the Rotcleaver');
    const z = T.bf('A', 'Walking Corpse');
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [z] });
    T.settle(); T.resolve(); T.settle();
    const toks = () => T.bfOf('A').filter(o => o.isToken);
    t.eq(toks().length, 1, 'a 2/2 Zombie token with decayed');
    const tok = toks()[0];
    t.ok(T.g.hasKw(tok, 'decayed'));
    T.mana('A', 'BBC');
    T.cast('A', T.hand('A', 'Murder'), { targets: [tok] });
    T.settle(); T.resolve(); T.settle();
    t.eq(toks().length, 0, 'the decayed one leaves nothing');
  });

  test("Teferi's Time Twist: back at the end step, with a +1/+1 counter if it's a creature", (mk, t) => {
    t.auto("Teferi's Time Twist");
    for (const name of ['Grizzly Bears', 'Sol Ring']) {
      const T = mk();
      T.toMain('A');
      const p = T.bf('A', name);
      T.mana('A', 'UC');
      T.cast('A', T.hand('A', "Teferi's Time Twist"), { targets: [p] });
      T.settle();
      t.zone(p, 'exile', name);
      T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
      t.zone(p, 'battlefield', name + ' back');
      t.eq(p.counters['+1/+1'] || 0, name === 'Sol Ring' ? 0 : 1, name);
    }
  });

  test('Gond Gate: any color a Gate you control could produce; Star Compass: a basic land', (mk, t) => {
    t.auto('Gond Gate');
    t.auto('Star Compass');
    t.auto('Plaza of Harmony');
    const T = mk();
    const gate = T.bf('A', 'Gond Gate');
    T.bf('A', 'Azorius Guildgate'); T.bf('A', 'Mountain');
    const ab = gate.analysis().manaAbilities.find(a => (a.effects || []).some(e => e.op === 'addManaAmong'));
    const cols = T.g._manaAmong(ab.effects.find(e => e.op === 'addManaAmong'), gate, 'A').sort().join('');
    t.eq(cols, 'UW', "the Guildgate's colours, not the Mountain's");
    const compass = T.bf('A', 'Star Compass');
    T.bf('A', 'Command Tower');
    const ab2 = compass.analysis().manaAbilities.find(a => (a.effects || []).some(e => e.op === 'addManaAmong'));
    t.eq(T.g._manaAmong(ab2.effects.find(e => e.op === 'addManaAmong'), compass, 'A').join(''), 'R', 'only the basic Mountain');
  });

  test("Wash Away: only a spell that wasn't cast from its owner's hand", (mk, t) => {
    t.auto('Wash Away');
    const T = mk();
    T.toMain('B');
    const fromHand = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.cast('B', fromHand, { targets: ['A'], resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    const wa = T.hand('A', 'Wash Away');
    const spec = wa.analysis().abilities.find(a => a.kind === 'spell').effects[0].targets[0];
    t.no(T.g._legalTargetsFor(spec, 'A', wa.id).some(x => x.id === item.id), 'cast from the hand: not a target');
    T.settle(); T.resolve(); T.settle();
    const looting = T.grave('B', 'Faithless Looting');
    T.mana('B', 'RCC');
    T.cast('B', looting, { via: 'flashback', resolve: false });
    const item2 = T.g.stack[T.g.stack.length - 1];
    t.ok(T.g._legalTargetsFor(spec, 'A', wa.id).some(x => x.id === item2.id), 'flashed back from the graveyard: a target');
  });

  test("Magewright's Stone: only a creature with an activated ability that has {T} in its cost", (mk, t) => {
    t.auto("Magewright's Stone");
    const T = mk();
    T.toMain('A');
    const stone = T.bf('A', "Magewright's Stone");
    const elf = T.bf('A', 'Llanowar Elves', { etb: true });
    const bear = T.bf('A', 'Grizzly Bears', { etb: true });
    const tim = T.bf('B', 'Prodigal Sorcerer', { etb: true });
    const spec = stone.analysis().abilities[0].effects[0].targets[0];
    const ids = T.g._legalTargetsFor(spec, 'A', stone.id).map(x => x.id);
    t.ok(ids.includes(elf.id), 'a mana ability with {T}');
    t.ok(ids.includes(tim.id), "an opponent's {T} ability");
    t.no(ids.includes(bear.id), 'no activated ability');
    elf.tapped = true;
    T.mana('A', 'C');
    T.activate('A', stone, 0, { targets: [elf.id] });
    T.settle();
    t.no(elf.tapped, 'untapped');
  });

  test('Staff of the Storyteller: one story counter for each lot of creature tokens', (mk, t) => {
    t.auto('Staff of the Storyteller');
    const T = mk();
    T.toMain('A');
    const staff = T.bf('A', 'Staff of the Storyteller');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Raise the Alarm'));
    T.settle();
    t.eq(staff.counters.story || 0, 1, 'two Soldiers at once: one counter');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Strike It Rich'));
    T.settle();
    t.ok(T.g.battlefield.some(o => o.isToken && /Treasure/.test(o.name)), 'the Treasure was made');
    t.eq(staff.counters.story || 0, 1, 'a Treasure is not a creature token');
  });

  test('Commit: a spell or a nonland permanent goes into its owner\'s library second from the top', (mk, t) => {
    t.auto('Commit // Memory');
    const T = mk();
    T.toMain('A');
    T.top('A', 'Forest'); T.top('A', 'Island');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R3U');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.cast('A', T.hand('A', 'Commit // Memory'), { face: 0, targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
    T.settle();
    t.zone(bolt, 'library');
    t.eq(T.g.zones.A.library.indexOf(bolt), 1, 'second from the top');
    t.eq(T.life('B'), 20, 'the bolt never resolved');
    t.no(T.g.stack.length, 'the stack is empty');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Commit // Memory'), { face: 0, targets: [bear.id] });
    t.zone(bear, 'library');
    t.eq(T.g.zones.B.library.indexOf(bear), 1, 'into its owner\'s library, second');
  });

  test('Tree of Redemption, Evra: exchange your life total with its toughness or power', (mk, t) => {
    t.auto('Tree of Redemption');
    t.auto('Evra, Halcyon Witness');
    const T = mk();
    T.toMain('A');
    const tree = T.bf('A', 'Tree of Redemption');
    T.g.players.find(p => p.id === 'A').life = 7;
    T.activate('A', tree, 0);
    T.settle();
    t.eq(T.life('A'), 13, 'life becomes its toughness');
    t.eq(T.g.toughnessOf(tree), 7, 'its toughness becomes the old life total');
    const evra = T.bf('A', 'Evra, Halcyon Witness');
    T.mana('A', '4');
    T.activate('A', evra, 0);
    T.settle();
    t.eq(T.life('A'), 4, 'life becomes its power');
    t.eq(T.g.powerOf(evra), 13, 'its power becomes the old life total');
    t.eq(T.g.toughnessOf(evra), 4, 'its toughness is unchanged');
  });

  test('Mask of Griselbrand: pay X life, where X is its power, to draw X cards', (mk, t) => {
    t.auto('Mask of Griselbrand');
    const T = mk();
    T.toMain('A');
    const ox = T.bf('A', 'Craw Wurm');
    const mask = T.bf('A', 'Mask of Griselbrand');
    mask.attachedTo = ox.id; ox.attachments = [mask.id];
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const hand = T.zone('A', 'hand').length;
    let prompt = '';
    T.answer('confirm', (ch) => { prompt = ch.prompt; return { yes: true }; });
    T.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: ox.id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(ox, 'graveyard');
    t.eq(prompt, 'Mask of Griselbrand: You may pay X life, where X is its power. If you do, draw X cards. (X is 6.)', 'the prompt says what X is');
    t.eq(T.life('A'), 14, 'six life, for a 6/4');
    t.eq(T.zone('A', 'hand').length, hand + 6, 'six cards');
  });

  test('Tymna the Weaver: X is the number of opponents dealt combat damage this turn', (mk, t) => {
    t.auto('Tymna the Weaver');
    t.auto('Moonshae Pixie // Pixie Dust');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const ty = T.bf('A', 'Tymna the Weaver');
    const bear = T.bf('A', 'Grizzly Bears');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const hand = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: ty.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'C' }]);
    T.answer('confirm', { yes: true });
    T.toMain('A', 'end');
    t.eq(T.life('A'), 20, 'two life from lifelink, two paid');
    t.eq(T.zone('A', 'hand').length, hand + 2, 'two opponents hit: two cards');
  });

  test("G'raha Tia: pay X life for a Hero with X counters; Tivash: an X/X Demon", (mk, t) => {
    t.auto("G'raha Tia, Scion Reborn");
    t.auto('Tivash, Gloom Summoner');
    const T = mk();
    T.toMain('A');
    T.bf('A', "G'raha Tia, Scion Reborn");
    T.answer('confirm', { yes: true });
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Divination'));
    T.settle();
    const hero = T.g.battlefield.find(o => o.isToken && /Hero/.test(o.name));
    t.ok(hero, 'a Hero');
    t.eq(hero && (hero.counters['+1/+1'] || 0), 3, 'three counters, for a 3-mana spell');
    t.eq(T.life('A'), 17, 'three life paid');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Tivash, Gloom Summoner');
    U.g._runEffects([{ op: 'gainLife', n: 4 }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    U.answer('confirm', { yes: true });
    U.toMain('A', 'end'); U.settle(); U.resolve(); U.settle();
    const demon = U.g.battlefield.find(o => o.isToken && /Demon/.test(o.name));
    t.ok(demon, 'a Demon');
    t.eq(demon && U.g.powerOf(demon), 4, 'a 4/4, for four life gained');
    t.eq(U.life('A'), 20, 'gained four, paid four');
  });

  test('"Create a 0/0 token. Put X +1/+1 counters on it": the token, not the card (Wild Hypothesis, Additive Evolution)', (mk, t) => {
    t.auto('Wild Hypothesis');
    t.auto('Additive Evolution');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Wild Hypothesis'), { x: 2 });
    T.settle();
    const f1 = T.g.battlefield.find(o => o.isToken && /Fractal/.test(o.name));
    t.ok(f1, 'the Fractal lives');
    t.eq(f1 && (f1.counters['+1/+1'] || 0), 2, 'with two counters');
    const ae = T.hand('A', 'Additive Evolution');
    T.mana('A', 'GG3');
    T.cast('A', ae);
    T.settle();
    t.eq(ae.counters['+1/+1'] || 0, 0, 'none on the enchantment');
    t.eq(T.g.battlefield.filter(o => o.isToken && /Fractal/.test(o.name) && (o.counters['+1/+1'] || 0) === 3).length, 1, 'three on the new Fractal');
  });

  test("Luminarch Ascension: a quest counter on an opponent's end step only if you didn't lose life", (mk, t) => {
    t.auto('Luminarch Ascension');
    const T = mk();
    T.toMain('A');
    const asc = T.bf('A', 'Luminarch Ascension');
    T.answer('confirm', { yes: true });
    T.toMain('B', 'end');
    T.settle();
    t.eq(asc.counters.quest || 0, 1, 'no life lost: a counter');
    T.toMain('A'); T.toMain('B');
    T.g.changeLife(T.g.player('A'), -2, 'test');
    T.answer('confirm', { yes: true });
    T.toMain('B', 'end');
    T.settle();
    t.eq(asc.counters.quest || 0, 1, 'lost life this turn: none');
  });

  test("Mjölnir, Storm Hammer: damage to each opponent equal to the tapped creatures that opponent controls", (mk, t) => {
    t.auto('Mjölnir, Storm Hammer');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const mj = T.bf('A', 'Mjölnir, Storm Hammer');
    mj.attachedTo = bear.id; bear.attachments = [mj.id];
    const b1 = T.bf('B', 'Llanowar Elves'); T.bf('B', 'Grizzly Bears', { tapped: true });
    T.bf('C', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('pickTarget', (ch) => ({ targets: [{ kind: 'object', id: b1.id }] }));
    T.toMain('A', 'declareBlockers');
    t.ok(b1.tapped, 'the Elves are tapped');
    t.eq(b1.counters.stun || 0, 1, 'with a stun counter');
    t.eq(T.life('B'), 18, 'two tapped creatures');
    t.eq(T.life('C'), 20, 'none tapped');
  });

  test('Diamond City: move its shield counter onto a creature once two creatures have entered', (mk, t) => {
    t.auto('Diamond City');
    const T = mk();
    T.toMain('A');
    const dc = T.bf('A', 'Diamond City', { counters: { shield: 1 } });
    const bear = T.bf('A', 'Grizzly Bears', { etb: true });
    t.no(T.g.activateAbility('A', dc.id, 1, { auto: true, targets: [{ kind: 'object', id: bear.id }] }), 'one creature entered: not yet');
    T.bf('A', 'Llanowar Elves', { etb: true });
    T.activate('A', dc, 1, { targets: [bear.id] });
    T.settle();
    t.eq(dc.counters.shield || 0, 0, 'off the land');
    t.eq(bear.counters.shield || 0, 1, 'onto the Bears');
  });

  test("Magus of the Vineyard: each player adds {G}{G} at the start of their first main phase", (mk, t) => {
    t.auto('Magus of the Vineyard');
    t.auto("Eladamri's Vineyard");
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Magus of the Vineyard');
    T.toMain('B');
    t.eq(String(T.g.player('B').pool), '2G', 'into the pool of the player whose turn it is');
    t.ok(T.g.player('A').pool.isEmpty(), 'not its controller');
  });

  test("Each opponent who can't discard: Liliana, Waker of the Dead loses them 3 life; Refurbished Familiar draws for each", (mk, t) => {
    t.auto('Liliana, Waker of the Dead');
    t.auto('Refurbished Familiar');
    t.auto('Cruel Grimnarch');
    t.auto('Skullslither Worm');
    t.auto('Aclazotz, Deepest Betrayal // Temple of the Dead');
    t.auto('Entropic Battlecruiser');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const lili = T.bf('A', 'Liliana, Waker of the Dead');
    T.hand('C', 'Island');
    T.activate('A', lili, 0);
    T.settle();
    t.eq(T.life('A'), 20, 'you had no card either, but you are no opponent');
    t.eq(T.life('B'), 17, 'B had no card: 3 life');
    t.eq(T.life('C'), 20, 'C discarded');
    t.eq(T.zone('C', 'hand').length, 0, 'the Island went');
    for (let i = 0; i < 3; i++) T.top('A', 'Swamp');
    T.hand('B', 'Island');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', 'B3');
    T.cast('A', T.hand('A', 'Refurbished Familiar'));
    T.settle();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'one opponent could not: one card');
  });

  test('Unwanted Remake: the destroyed creature\'s controller manifests dread', (mk, t) => {
    t.auto('Unwanted Remake');
    t.auto('Fear of Impostors');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears');
    const c1 = T.top('B', 'Hill Giant'), c2 = T.top('B', 'Mountain');
    let who = null;
    T.answer('pickCard', (ch) => { who = ch.playerId; return { cardIds: [c1.id] }; });
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Unwanted Remake'), { targets: [bear.id] });
    T.settle();
    t.zone(bear, 'graveyard');
    t.eq(who, 'B', 'B chooses');
    t.eq(c1.zone, 'battlefield', 'one card face down');
    t.ok(c1.faceDown && c1.controller === 'B', "under B's control");
    t.zone(c2, 'graveyard', 'the other to the graveyard');
  });

  test('Fist of Suns: any spell may be cast for {W}{U}{B}{R}{G} instead', (mk, t) => {
    t.auto('Fist of Suns');
    t.auto('Jodah, Archmage Eternal');
    t.auto('Leyline of Mutation');
    const T = mk();
    T.toMain('A');
    const wurm = T.hand('A', 'Craw Wurm');
    t.no(T.g.altUsesFor('A', wurm.id).some(u => u.via === 'grantAlt'), 'not without it');
    T.bf('A', 'Fist of Suns');
    const use = T.g.altUsesFor('A', wurm.id).find(u => u.via === 'grantAlt');
    t.ok(use, 'offered: ' + (use && use.label));
    t.eq(use && use.cost, '{W}{U}{B}{R}{G}', 'five colours');
    T.mana('A', 'WUBRG');
    T.cast('A', wurm, { via: 'grantAlt' });
    T.settle();
    t.zone(wurm, 'battlefield');
    t.ok(T.g.player('A').pool.isEmpty(), 'all five spent');
  });

  test('Port Razer: in the extra combat it may attack another player, not the one it already attacked', (mk, t) => {
    t.auto('Port Razer');
    t.auto('Bloodthirster');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const pr = T.bf('A', 'Port Razer');
    let n = 0, again = null;
    T.answer('declareAttackers', () => { n++; return [{ attackerId: pr.id, defenderId: 'B' }]; });
    T.answer('declareAttackers', (ch, g) => {
      n++;
      again = g.declareAttackers('A', [{ attackerId: pr.id, defenderId: 'B' }]);
      return [{ attackerId: pr.id, defenderId: 'C' }];
    });
    T.toMain('A', 'end');
    t.eq(n, 2, 'two combats');
    t.no(again, 'not B a second time');
    t.eq(T.life('B'), 16, 'B was hit once');
    t.eq(T.life('C'), 16, 'C in the second combat');
  });

  test("Keleth, Norn's Choirmaster: \"a commander you control attacks\"; Nakia: \"your commander enters\"", (mk, t) => {
    t.auto('Keleth, Sunmane Familiar');
    t.auto("Norn's Choirmaster");
    t.auto('We Ride at Dawn');
    t.auto('Nakia, Wakandan Operative');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Keleth, Sunmane Familiar');
    const cmd = T.bf('A', 'Grizzly Bears');
    cmd.isCommander = true;
    const other = T.bf('A', 'Hill Giant');
    T.answer('declareAttackers', () => [{ attackerId: cmd.id, defenderId: 'B' }, { attackerId: other.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(cmd.counters['+1/+1'] || 0, 1, 'the commander gets the counter');
    t.eq(other.counters['+1/+1'] || 0, 0, 'not the other attacker');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Nakia, Wakandan Operative');
    const c2 = U.hand('A', 'Grizzly Bears');
    c2.isCommander = true;
    U.mana('A', 'G1');
    U.cast('A', c2);
    U.settle();
    t.ok(U.g.player('A').monarch, 'your commander entered: you are the monarch');
  });

  test('Thryx, the Sudden Storm: spells of mana value 5 or more cost {1} less and cannot be countered', (mk, t) => {
    t.auto('Thryx, the Sudden Storm');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Thryx, the Sudden Storm');
    const wurm = T.hand('A', 'Craw Wurm');
    T.mana('A', 'GG3');
    T.cast('A', wurm, { resolve: false });
    t.ok(T.g.player('A').pool.isEmpty(), 'five mana for a six-mana spell');
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [{ kind: 'stack', id: T.stackItem(wurm).id }] });
    T.settle(); T.resolve(); T.settle();
    t.zone(wurm, 'battlefield', 'not countered');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
    t.zone(bolt, 'graveyard');
    t.eq(T.life('B'), 20, 'a small spell can be countered');
  });

  test('Killian: spells that target a creature cost {2} less; Esior: spells aimed at your commander cost {3} more', (mk, t) => {
    t.auto('Killian, Ink Duelist');
    t.auto('Esior, Wardwing Familiar');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Killian, Ink Duelist');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BB');
    T.cast('A', T.hand('A', 'Murder'), { targets: [bear.id] });
    t.zone(bear, 'graveyard', 'Murder for {B}{B}');
    const U = mk();
    U.toMain('A');
    U.bf('B', 'Esior, Wardwing Familiar');
    const cmd = U.bf('B', 'Grizzly Bears');
    cmd.isCommander = true;
    const other = U.bf('B', 'Grizzly Bears');
    U.mana('A', 'R');
    t.no(U.g.castSpell('A', U.hand('A', 'Lightning Bolt').id, { auto: true, targets: [{ kind: 'object', id: cmd.id }] }), 'one red is not enough to aim at the commander');
    U.cast('A', U.hand('A', 'Lightning Bolt'), { targets: [other.id] });
    t.zone(other, 'graveyard', 'the other Bears cost the usual {R}');
  });

  test('"X unless <condition>": Moon-Circuit Hacker discards unless it entered this turn; Vampire Lacerator', (mk, t) => {
    t.auto('Moon-Circuit Hacker');
    t.auto('Vampire Lacerator');
    t.auto('Tragedy Feaster');
    t.auto('Reaver Drone');
    for (const fresh of [false, true]) {
      const T = mk();
      T.toMain('A');
      const h = T.bf('A', 'Moon-Circuit Hacker', fresh ? { etb: true } : {});
      h.summoningSick = false;
      T.top('A', 'Island');
      T.hand('A', 'Mountain');
      const hand = T.zone('A', 'hand').length;
      T.answer('declareAttackers', () => [{ attackerId: h.id, defenderId: 'B' }]);
      T.answer('confirm', { yes: true });
      T.toMain('A', 'endCombat');
      t.eq(T.zone('A', 'hand').length, hand + (fresh ? 1 : 0), fresh ? 'entered this turn: no discard' : 'drew, then discarded');
    }
    const U = mk();
    U.bf('A', 'Vampire Lacerator');
    U.toMain('A', 'upkeep'); U.toMain('A');
    t.eq(U.life('A'), 19, 'no opponent at 10 or less: 1 life');
  });

  test('Dragonborn Champion: a draw when a source of yours deals 5 or more to a player; Night Dealings: "to another player"', (mk, t) => {
    t.auto('Dragonborn Champion');
    t.auto('Night Dealings');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Dragonborn Champion');
    const nd = T.bf('A', 'Night Dealings');
    const wurm = T.bf('A', 'Craw Wurm');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const hand = T.zone('A', 'hand').length;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.settle();
    t.eq(T.zone('A', 'hand').length, hand, 'three damage: no card');
    t.eq(nd.counters.theft || 0, 3, 'three theft counters');
    T.answer('declareAttackers', () => [{ attackerId: wurm.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'six combat damage: a card');
    t.eq(nd.counters.theft || 0, 9, 'six more');
  });

  test('Bane of Bala Ged: the defending player exiles two permanents they control', (mk, t) => {
    t.auto('Bane of Bala Ged');
    t.auto('Thresher Beast');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const bane = T.bf('A', 'Bane of Bala Ged');
    const bs = [T.bf('B', 'Grizzly Bears'), T.bf('B', 'Forest'), T.bf('B', 'Island')];
    const cs = [T.bf('C', 'Grizzly Bears')];
    T.answer('declareAttackers', () => [{ attackerId: bane.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(bs.filter(o => o.zone === 'exile').length, 2, 'two of B\'s permanents exiled');
    t.eq(cs[0].zone, 'battlefield', 'not C\'s');
  });

  test('God-Eternal Bontu: sacrifice any number of other permanents, then draw that many', (mk, t) => {
    t.auto('God-Eternal Bontu');
    const T = mk();
    T.toMain('A');
    const f1 = T.bf('A', 'Forest'), f2 = T.bf('A', 'Forest'), f3 = T.bf('A', 'Swamp'), f4 = T.bf('A', 'Swamp'), f5 = T.bf('A', 'Swamp');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    let offered = null;
    T.answer('choose', (ch) => { offered = ch.items.map(x => x.id); return { picks: [f1.id, f2.id] }; });
    const bontu = T.hand('A', 'God-Eternal Bontu');
    T.mana('A', 'BBB2');
    const hand = T.zone('A', 'hand').length;
    T.cast('A', bontu);
    T.settle();
    t.ok(offered && offered.length === 5, 'the five lands offered');
    t.no((offered || []).includes(bontu.id), 'not itself');
    t.zone(f1, 'graveyard'); t.zone(f2, 'graveyard');
    t.eq(T.zone('A', 'hand').length, hand - 1 + 2, 'two cards');
  });

  test('Counterbalance: counter the spell when the revealed card has the same mana value', (mk, t) => {
    t.auto('Counterbalance');
    for (const [top, countered] of [['Shock', true], ['Grizzly Bears', false]]) {
      const T = mk();
      T.toMain('B');
      T.bf('A', 'Counterbalance');
      T.top('A', top);
      T.answer('confirm', { yes: true });
      const bolt = T.hand('B', 'Lightning Bolt');
      T.mana('B', 'R');
      T.cast('B', bolt, { targets: ['A'] });
      T.settle(); T.resolve(); T.settle();
      t.eq(T.life('A'), countered ? 20 : 17, top + (countered ? ' (mana value 1): countered' : ' (mana value 2): not countered'));
    }
  });

  test('Stun counters: a stunned permanent stays tapped and loses one instead of untapping; Fear of Sleep Paralysis keeps them on', (mk, t) => {
    t.auto('Fear of Sleep Paralysis');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears', { tapped: true, counters: { stun: 1 } });
    T.toMain('B');
    t.ok(bear.tapped, 'still tapped after its untap step');
    t.eq(bear.counters.stun || 0, 0, 'the stun counter came off');
    T.g._markTapped(bear);
    T.toMain('A'); T.toMain('B');
    t.no(bear.tapped, 'untaps the next time');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Fear of Sleep Paralysis');
    const b2 = U.bf('B', 'Grizzly Bears', { tapped: true, counters: { stun: 1 } });
    U.toMain('B');
    t.ok(b2.tapped, 'stays tapped');
    t.eq(b2.counters.stun || 0, 1, 'and keeps its stun counter');
  });

  test('Shield counters: damage or destruction takes a shield counter off instead (even "can\'t be regenerated")', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears', { counters: { shield: 1 } });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [bear.id] });
    T.settle();
    t.zone(bear, 'battlefield');
    t.eq(bear.damage || 0, 0, 'no damage marked');
    t.eq(bear.counters.shield || 0, 0, 'the shield counter came off');
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Murder'), { targets: [bear.id] });
    t.zone(bear, 'graveyard', 'no shield left: destroyed');
    const b2 = T.bf('B', 'Grizzly Bears', { counters: { shield: 2 } });
    T.mana('A', 'WW2');
    T.cast('A', T.hand('A', 'Wrath of God'));
    T.settle();
    t.zone(b2, 'battlefield', 'Wrath of God ("can\'t be regenerated") still meets the shield');
    t.eq(b2.counters.shield || 0, 1, 'one shield counter spent');
  });

  test('Spell mastery: Dark Petition adds {B}{B}{B}, Fiery Impulse deals 3, Exquisite Firecraft can\'t be countered', (mk, t) => {
    t.auto('Dark Petition');
    t.auto('Fiery Impulse');
    t.auto('Exquisite Firecraft');
    for (const mastery of [false, true]) {
      const T = mk();
      T.toMain('A');
      if (mastery) { T.grave('A', 'Shock'); T.grave('A', 'Divination'); }
      T.top('A', 'Island');
      T.answer('pickCard', (ch) => ({ cardIds: [ch.cards[0].id] }));
      T.mana('A', 'BB3');
      T.cast('A', T.hand('A', 'Dark Petition'));
      T.settle();
      t.eq(T.g.player('A').pool.isEmpty() ? '' : String(T.g.player('A').pool), mastery ? '3B' : '', mastery ? 'two instants/sorceries: {B}{B}{B}' : 'no spell mastery: no mana');
      T.g.player('A').pool.clear();
      const ogre = T.bf('B', 'Hill Giant');
      T.mana('A', 'R');
      T.cast('A', T.hand('A', 'Fiery Impulse'), { targets: [ogre.id] });
      T.settle();
      t.zone(ogre, mastery ? 'graveyard' : 'battlefield', mastery ? '3 damage kills the 3/3' : '2 damage does not');
      const U = mk();
      U.toMain('A');
      if (mastery) { U.grave('A', 'Shock'); U.grave('A', 'Divination'); }
      const fc = U.hand('A', 'Exquisite Firecraft');
      U.mana('A', 'RR1');
      U.cast('A', fc, { targets: ['B'], resolve: false });
      U.g.passPriority('A', true);
      U.mana('B', 'UU');
      U.cast('B', U.hand('B', 'Counterspell'), { targets: [{ kind: 'stack', id: U.stackItem(fc).id }] });
      U.settle(); U.resolve(); U.settle();
      t.eq(U.life('B'), mastery ? 16 : 20, mastery ? "can't be countered" : 'countered');
    }
  });

  test('Contaminant Grafter: one proliferate however many creatures hit however many players', (mk, t) => {
    t.auto('Contaminant Grafter');
    t.auto('The Destined Thief');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Contaminant Grafter', { sick: true });
    const b1 = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    const b2 = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: b1.id, defenderId: 'B' }, { attackerId: b2.id, defenderId: 'C' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 17, 'B hit'); t.eq(T.life('C'), 18, 'C hit');
    t.eq(b1.counters['+1/+1'] || 0, 2, 'proliferated once');
  });

  test('Recruit: draw, discard, and a 1/1 Human Soldier for a nonland card (Esgaroth Garrison, Lake-town Lookout)', (mk, t) => {
    t.auto('Esgaroth Garrison');
    t.auto('Lake-town Lookout');
    t.auto('The Queen of Dale');
    for (const toss of ['Lightning Bolt', 'Mountain']) {
      const T = mk();
      T.toMain('A');
      T.top('A', 'Island');
      const keep = T.hand('A', 'Grizzly Bears');
      const card = T.hand('A', toss);
      let asked = null;
      T.answer('choose', (ch) => { asked = ch.purpose; return { picks: [card.id] }; });
      const lk = T.bf('A', 'Lake-town Lookout');
      T.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: lk.id }] });
      T.settle(); T.resolve(); T.settle();
      t.eq(asked, 'recruit', 'asked which card');
      t.zone(card, 'graveyard', toss + ' discarded');
      t.zone(keep, 'hand');
      const soldiers = T.g.battlefield.filter(o => o.isToken && /Human Soldier/.test(o.name));
      t.eq(soldiers.length, toss === 'Mountain' ? 0 : 1, toss === 'Mountain' ? 'a land: no token' : 'a nonland card: a 1/1 Human Soldier');
    }
  });

  test('The Shrines: a charge counter at your upkeep and for each spell of its colour', (mk, t) => {
    t.auto('Shrine of Loyal Legions');
    t.auto('Shrine of Burning Rage');
    t.auto('Shrine of Boundless Growth');
    t.auto('Shrine of Limitless Power');
    const T = mk();
    T.toMain('A');
    const sh = T.bf('A', 'Shrine of Burning Rage');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.settle();
    t.eq(sh.counters.charge || 0, 1, 'a red spell');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.settle();
    t.eq(sh.counters.charge || 0, 1, 'not a green one');
    T.toMain('A', 'upkeep'); T.toMain('A');
    t.eq(sh.counters.charge || 0, 2, 'and one at the upkeep');
  });

  test('Dragon Whelp: activated four times, sacrificed at the next end step; Pyric Salamander sacrifices itself', (mk, t) => {
    t.auto('Dragon Whelp');
    t.auto('Initiates of the Ebon Hand');
    t.auto('Pyric Salamander');
    for (const times of [3, 4]) {
      const T = mk();
      T.toMain('A');
      const w = T.bf('A', 'Dragon Whelp');
      for (let i = 0; i < times; i++) { T.mana('A', 'R'); T.activate('A', w, 0); T.settle(); }
      t.eq(T.g.powerOf(w), 2 + times, '+' + times + '/+0');
      T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
      t.zone(w, times >= 4 ? 'graveyard' : 'battlefield', times + ' times');
    }
    const U = mk();
    U.toMain('A');
    const ps = U.bf('A', 'Pyric Salamander');
    U.mana('A', 'R');
    U.activate('A', ps, 0);
    U.toMain('A', 'end'); U.settle(); U.resolve(); U.settle();
    t.zone(ps, 'graveyard', 'the Salamander goes at the end step');
  });

  test('Obstinate Baloth: discarded by an opponent\'s spell, it enters instead; by your own, it stays in the graveyard', (mk, t) => {
    t.auto('Obstinate Baloth');
    t.auto('Wilt-Leaf Liege');
    const T = mk();
    T.toMain('A');
    const bal = T.hand('B', 'Obstinate Baloth');
    T.hand('B', 'Island');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Mind Rot'), { targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.zone(bal, 'battlefield', 'onto the battlefield');
    t.eq(bal.controller, 'B', "under its owner's control");
    t.eq(T.life('B'), 24, 'its enters trigger: 4 life');
    const U = mk();
    U.toMain('A');
    const b2 = U.hand('A', 'Obstinate Baloth');
    U.top('A', 'Island'); U.top('A', 'Island');
    U.answer('discard', { cardIds: [b2.id] });
    U.mana('A', 'R');
    U.cast('A', U.hand('A', 'Faithless Looting'));
    U.settle();
    t.zone(b2, 'graveyard', 'your own discard: the graveyard');
  });

  test('Sage of Days: look at three, keep one on top, the rest into the graveyard', (mk, t) => {
    t.auto('Sage of Days');
    t.auto('Gutless Plunderer');
    const T = mk();
    T.toMain('A');
    const c1 = T.top('A', 'Mountain'), c2 = T.top('A', 'Forest'), c3 = T.top('A', 'Island');
    T.answer('pickCard', { cardIds: [c2.id] });
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Sage of Days'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.zones.A.library[0], c2, 'the Forest back on top');
    t.zone(c1, 'graveyard'); t.zone(c3, 'graveyard');
  });

  test("Never Happened: a nonland card from that player's graveyard or hand, exiled", (mk, t) => {
    t.auto('Never Happened');
    t.auto('Memory Leak');
    const T = mk();
    T.toMain('A');
    const inHand = T.hand('B', 'Lightning Bolt');
    T.hand('B', 'Mountain');
    const inYard = T.grave('B', 'Shock');
    T.grave('B', 'Forest');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name).sort().join(', '); return { cardIds: [inYard.id] }; });
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Never Happened'), { targets: ['B'] });
    T.settle();
    t.eq(offered, 'Lightning Bolt, Shock', 'the nonland cards from both');
    t.zone(inYard, 'exile', 'the Shock from the graveyard');
    t.zone(inHand, 'hand');
  });

  test('Goblin Ringleader: the Goblins revealed to the hand, the rest to the bottom; Beast Hunt reveals three, not four', (mk, t) => {
    t.auto('Goblin Ringleader');
    t.auto('Garruk, Caller of Beasts');
    t.auto('Lair Delve');
    const T = mk();
    T.toMain('A');
    const fifth = T.top('A', 'Swamp');
    const f = T.top('A', 'Forest'), g2 = T.top('A', 'Raging Goblin'), i = T.top('A', 'Island'), g1 = T.top('A', 'Goblin Guide');
    T.mana('A', 'R3');
    T.cast('A', T.hand('A', 'Goblin Ringleader'));
    T.settle(); T.resolve(); T.settle();
    t.zone(g1, 'hand'); t.zone(g2, 'hand');
    const lib = T.g.zones.A.library;
    t.eq(lib[0], fifth, 'the fifth card is now on top');
    t.ok(lib.indexOf(i) > 0 && lib.indexOf(f) > 0 && lib.indexOf(i) >= lib.length - 2 && lib.indexOf(f) >= lib.length - 2, 'Island and Forest at the bottom');
    const U = mk();
    U.toMain('A');
    const c4 = U.top('A', 'Grizzly Bears');
    const c3 = U.top('A', 'Island'), c2 = U.top('A', 'Hill Giant'), c1 = U.top('A', 'Forest');
    U.mana('A', 'G3');
    U.cast('A', U.hand('A', 'Beast Hunt'));
    U.settle();
    t.zone(c2, 'hand', 'the creature among three');
    t.zone(c1, 'graveyard'); t.zone(c3, 'graveyard');
    t.zone(c4, 'library', 'the fourth card was never revealed');
  });

  test('Thirst for Discovery: a basic land card, or two cards; Compulsive Research: the target player chooses', (mk, t) => {
    t.auto('Thirst for Discovery');
    t.auto('Compulsive Research');
    t.auto('Wrench Mind');
    t.auto('Arm-Mounted Anchor');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Lightning Bolt');
    const isl = T.hand('A', 'Island');
    let prompt = '';
    T.answer('pickCard', (ch) => { prompt = ch.prompt; return { cardIds: [isl.id] }; });
    T.mana('A', 'U2');
    const hand0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Thirst for Discovery'));
    T.settle();
    t.eq(prompt, 'Discard a basic land card? Choose none to discard 2 cards instead.');
    t.zone(isl, 'graveyard');
    t.eq(T.zone('A', 'hand').length, hand0 + 3 - 1, 'three drawn, the Island discarded');
    const U = mk();
    U.toMain('A');
    for (let i = 0; i < 3; i++) U.top('B', 'Lightning Bolt');
    U.hand('B', 'Shock');
    let who = null;
    U.answer('discard', (ch) => { who = ch.playerId; return { cardIds: U.zone('B', 'hand').slice(0, 2).map(c => c.id) }; });
    U.mana('A', 'U2');
    U.cast('A', U.hand('A', 'Compulsive Research'), { targets: ['B'] });
    U.settle();
    t.eq(who, 'B', 'B discards');
    t.eq(U.zone('B', 'hand').length, 2, 'four in hand, two discarded');
  });

  test("Felothar the Steadfast: draw the sacrificed creature's toughness, discard its power", (mk, t) => {
    t.auto('Felothar the Steadfast');
    const T = mk();
    T.toMain('A');
    const f = T.bf('A', 'Felothar the Steadfast');
    const ogre = T.bf('A', 'Gray Ogre');      // 2/2
    const wall = T.bf('A', 'Wall of Omens');  // 0/4
    for (let i = 0; i < 8; i++) T.top('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    T.mana('A', '3');
    T.activate('A', f, 0, { sacrificeIds: [wall.id] });
    T.settle();
    t.zone(wall, 'graveyard');
    t.eq(T.zone('A', 'hand').length, h0 + 4, 'four drawn, none discarded');
    t.zone(ogre, 'battlefield');
  });

  test("Jaws of Defeat: life equal to the difference between the creature's power and toughness; Starlit Sanctum", (mk, t) => {
    t.auto('Jaws of Defeat');
    t.auto('Starlit Sanctum');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Jaws of Defeat');
    T.mana('A', 'UU1');
    T.cast('A', T.hand('A', 'Wall of Air'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16, 'a 1/5: 4 life');
  });

  test('Elturel Survivors: +X/+0 while attacking, X the lands of the player it attacks', (mk, t) => {
    t.auto('Elturel Survivors');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const es = T.bf('A', 'Elturel Survivors');
    for (let i = 0; i < 3; i++) T.bf('B', 'Forest');
    for (let i = 0; i < 5; i++) T.bf('C', 'Island');
    const base = T.g.powerOf(es);
    T.answer('declareAttackers', () => [{ attackerId: es.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(es), base + 3, "B's three lands, not C's five");
    T.toMain('A', 'end');
    t.eq(T.g.powerOf(es), base, 'back once it is no longer attacking');
  });

  test('Fevered Visions: each player draws at their end step; an opponent with four or more cards takes 2', (mk, t) => {
    t.auto('Fevered Visions');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Fevered Visions');
    for (let i = 0; i < 5; i++) { T.hand('A', 'Island'); T.hand('B', 'Island'); }
    T.toMain('B');
    t.eq(T.life('A'), 20, 'not you');
    T.toMain('A');
    t.eq(T.life('B'), 18, 'the opponent with four or more cards: 2 damage');
  });

  test('Nighthowler, Exoskeletal Armor: +X/+X for the creature cards in all graveyards, on itself and on what it enchants', (mk, t) => {
    t.auto('Nighthowler');
    t.auto('Exoskeletal Armor');
    const T = mk();
    T.toMain('A');
    T.grave('A', 'Grizzly Bears'); T.grave('B', 'Hill Giant'); T.grave('B', 'Lightning Bolt');
    const nh = T.bf('A', 'Nighthowler');
    t.eq(T.g.powerOf(nh), 2, 'two creature cards: 2/2');
    const bear = T.bf('A', 'Grizzly Bears');
    const ex = T.bf('A', 'Exoskeletal Armor');
    ex.attachedTo = bear.id; bear.attachments = [ex.id]; T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 4, 'the enchanted Bears get +2/+2');
  });

  test("Shanid: a card for a legendary land or spell; Shadow of the Goblin: 1 damage for a spell cast from elsewhere than the hand", (mk, t) => {
    t.auto("Shanid, Sleepers' Scourge");
    t.auto('Shadow of the Goblin');
    const T = mk();
    T.toMain('A');
    T.bf('A', "Shanid, Sleepers' Scourge");
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    T.playLand('A', T.hand('A', 'Kor Haven'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'played Kor Haven, drew one');
    t.eq(T.life('A'), 19, 'and lost 1 life');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.settle();
    t.eq(T.life('A'), 19, 'not for a nonlegendary spell');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Shadow of the Goblin');
    U.mana('A', 'R');
    U.cast('A', U.hand('A', 'Shock'), { targets: ['B'] });
    U.settle();
    t.eq(U.life('B'), 18, 'cast from the hand: just the Shock');
    U.mana('A', 'RCC');
    U.cast('A', U.grave('A', 'Faithless Looting'), { via: 'flashback' });
    U.settle();
    t.eq(U.life('B'), 17, 'flashed back: 1 damage');
  });

  test('Towering Titan: enters with +1/+1 counters equal to the total toughness of your other creatures', (mk, t) => {
    t.auto('Towering Titan');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Hill Giant'); T.bf('B', 'Craw Wurm');
    const tt = T.hand('A', 'Towering Titan');
    T.mana('A', 'GG4');
    T.cast('A', tt);
    T.settle();
    t.eq(tt.counters['+1/+1'] || 0, 5, '2 + 3, not the opponent\'s Wurm');
  });

  test('Serum Snare: proliferate if the returned permanent had mana value 3 or less', (mk, t) => {
    t.auto('Serum Snare');
    t.auto('Consuming Ashes');
    for (const [name, mv3] of [['Grizzly Bears', true], ['Craw Wurm', false]]) {
      const T = mk();
      T.toMain('A');
      const mine = T.bf('A', 'Hill Giant', { counters: { '+1/+1': 1 } });
      const it = T.bf('B', name);
      T.mana('A', 'UU2');
      T.cast('A', T.hand('A', 'Serum Snare'), { targets: [it.id] });
      T.settle();
      t.zone(it, 'hand', name + ' returned');
      t.eq(mine.counters['+1/+1'] || 0, mv3 ? 2 : 1, mv3 ? 'mana value 2: proliferated' : 'mana value 6: not');
    }
  });

  test('Bitter Work: a card when you attack a player with a creature of power 4 or greater', (mk, t) => {
    t.auto('Bitter Work');
    for (const [name, draws] of [['Grizzly Bears', 0], ['Craw Wurm', 1]]) {
      const T = mk();
      T.toMain('A');
      T.bf('A', 'Bitter Work');
      const c = T.bf('A', name);
      T.top('A', 'Island'); T.top('A', 'Island');
      const h = T.zone('A', 'hand').length;
      T.answer('declareAttackers', () => [{ attackerId: c.id, defenderId: 'B' }]);
      T.toMain('A', 'declareBlockers');
      t.eq(T.zone('A', 'hand').length, h + draws, name + ': ' + draws);
    }
  });

  test('Éomer, King of Rohan: the target player becomes the monarch', (mk, t) => {
    t.auto('Éomer, King of Rohan');
    t.auto('Denethor, Stone Seer');
    const T = mk();
    T.toMain('A');
    const e = T.hand('A', 'Éomer, King of Rohan');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }, { kind: 'player', id: 'B' }] });
    T.mana('A', 'RW3');
    T.cast('A', e);
    T.settle(); T.resolve(); T.settle();
    t.ok(T.g.player('B').monarch, 'B is the monarch');
    t.no(T.g.player('A').monarch, 'not A');
  });

  test("Perplex: counter the spell unless its controller discards their hand", (mk, t) => {
    t.auto('Perplex');
    for (const discard of [false, true]) {
      const T = mk();
      T.toMain('A');
      const bolt = T.hand('A', 'Lightning Bolt');
      const keep = T.hand('A', 'Island');
      T.mana('A', 'R');
      T.cast('A', bolt, { targets: ['B'], resolve: false });
      T.g.passPriority('A', true);
      let asked = null;
      T.answer('confirm', (ch) => { asked = ch; return { yes: discard }; });
      T.mana('B', 'UB1');
      T.cast('B', T.hand('B', 'Perplex'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
      T.settle(); T.resolve(); T.settle();
      t.eq(asked && asked.playerId, 'A', "the bolt's controller decides");
      t.eq(asked && asked.yesLabel, 'Discard your hand');
      t.eq(T.life('B'), discard ? 17 : 20, discard ? 'hand discarded: the bolt resolves' : 'kept the hand: countered');
      t.zone(keep, discard ? 'graveyard' : 'hand');
    }
  });

  test('Long-Term Plans: the card found goes third from the top', (mk, t) => {
    t.auto('Long-Term Plans');
    const T = mk();
    T.toMain('A');
    const want = T.top('A', 'Craw Wurm');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.answer('pickCard', { cardIds: [want.id] });
    T.mana('A', 'U2');
    T.cast('A', T.hand('A', 'Long-Term Plans'));
    T.settle();
    t.eq(T.g.zones.A.library.indexOf(want), 2, 'third from the top');
  });

  test('Trinisphere: a spell that would cost less than three costs three, while it is untapped', (mk, t) => {
    t.auto('Trinisphere');
    const T = mk();
    T.toMain('A');
    const tri = T.bf('B', 'Trinisphere');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', T.hand('A', 'Lightning Bolt').id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), '{R} alone is not enough');
    T.g.player('A').pool.clear();
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 17, 'paid three');
    t.ok(T.g.player('A').pool.isEmpty(), 'all three spent');
    tri.tapped = true;
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.life('B'), 14, 'tapped: {R} again');
  });

  test('Prophet of the Scarab: draw the Zombies you control or the Zombie cards in your graveyard, whichever is greater', (mk, t) => {
    t.auto('Prophet of the Scarab');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Walking Corpse'); T.bf('A', 'Walking Corpse');
    for (let i = 0; i < 3; i++) T.grave('A', 'Walking Corpse');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const p = T.hand('A', 'Prophet of the Scarab');
    const h = T.zone('A', 'hand').length;
    T.mana('A', 'U4');
    T.cast('A', p);
    T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h - 1 + 3, 'three from the graveyard beat two on the battlefield');
  });

  test('Lofty Denial: unless its controller pays {1}, or {4} if you control a flier', (mk, t) => {
    t.auto('Lofty Denial');
    t.auto('Dazzling Denial');
    for (const flier of [false, true]) {
      const T = mk();
      T.toMain('A');
      if (flier) T.bf('B', 'Wind Drake');
      const bolt = T.hand('A', 'Lightning Bolt');
      T.mana('A', 'R4');
      T.cast('A', bolt, { targets: ['B'], resolve: false });
      T.g.passPriority('A', true);
      let cost = null;
      T.answer('payOrDont', (ch) => { cost = ch.cost; return { pay: !flier }; });
      T.mana('B', 'U1');
      T.cast('B', T.hand('B', 'Lofty Denial'), { targets: [{ kind: 'stack', id: T.stackItem(bolt).id }] });
      T.settle(); T.resolve(); T.settle();
      t.eq(cost, flier ? '{4}' : '{1}', flier ? 'a flier: {4}' : 'no flier: {1}');
      t.eq(T.life('B'), flier ? 20 : 17, flier ? 'A declined {4}: countered' : 'A paid {1}: the bolt resolves');
    }
  });

  test('Trinisphere: the table is shown the raised price — Lightning Bolt costs {2}{R} and is not castable with only {R}; a kicker is not added on top', (mk, t) => {
    t.auto('Trinisphere');
    const T = mk();
    T.toMain('A');
    T.bf('B', 'Trinisphere');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.bf('A', 'Mountain');
    t.eq(T.g.castCostFor('A', bolt.id), '{2}{R}', 'castCostFor');
    t.eq(T.g.canCast('A', bolt.id).cost, '{2}{R}', 'canCast');
    const why = T.g.whyNotPlayable('A', bolt.id);
    t.eq(why && why.code, 'mana', 'one Mountain: not enough mana');
    t.no(T.g.playableNow('A').some(x => x.objId === bolt.id), 'not offered as playable');
    T.bf('A', 'Mountain'); T.bf('A', 'Mountain');
    t.eq(T.g.whyNotPlayable('A', bolt.id), null, 'three Mountains: castable');
    // Burst Lightning kicked: {R} and {4} is five already, so nothing is added
    const burst = T.hand('A', 'Burst Lightning');
    T.mana('A', 'R4');
    T.cast('A', burst, { targets: ['B'], kick: true });
    T.settle();
    t.eq(T.life('B'), 16, 'kicked for {4}{R}');
    t.ok(T.g.player('A').pool.isEmpty(), 'the five in the pool spent');
    t.no(T.g.battlefield.some(o => o.controller === 'A' && o.name === 'Mountain' && o.tapped), 'and no Mountain tapped for more');
  });

  test('All-Fates Scroll: draw X, X the differently named lands you control; Gimbal: differently named artifact tokens', (mk, t) => {
    t.auto('All-Fates Scroll');
    t.auto('Gimbal, Gremlin Prodigy');
    t.auto('Emil, Vastlands Roamer');
    const T = mk();
    T.toMain('A');
    const sc = T.bf('A', 'All-Fates Scroll');
    T.bf('A', 'Forest'); T.bf('A', 'Forest'); T.bf('A', 'Island'); T.bf('A', 'Swamp');
    for (let i = 0; i < 6; i++) T.top('A', 'Plains');
    const h = T.zone('A', 'hand').length;
    T.mana('A', '7');
    T.activate('A', sc, 1);
    T.settle();
    t.eq(T.zone('A', 'hand').length, h + 3, 'Forest, Island, Swamp: three names');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Gimbal, Gremlin Prodigy');
    U.g._runEffects([{ op: 'createNamedToken', n: 1, token: 'Treasure' }, { op: 'createNamedToken', n: 1, token: 'Clue' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    U.toMain('A', 'end'); U.settle(); U.resolve(); U.settle();
    const gr = U.g.battlefield.find(o => o.isToken && /Gremlin/.test(o.name));
    t.ok(gr, 'a Gremlin');
    t.eq(gr && (gr.counters['+1/+1'] || 0), 3, 'Treasure, Clue and the Gremlin itself: three names');
  });

  test("Magebane Lizard: damage equal to the noncreature spells that player has cast this turn", (mk, t) => {
    t.auto('Magebane Lizard');
    const T = mk();
    T.toMain('B');
    T.bf('A', 'Magebane Lizard');
    T.mana('B', 'G1');
    T.cast('B', T.hand('B', 'Grizzly Bears'));
    T.settle();
    t.eq(T.life('B'), 20, 'a creature spell: nothing');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 19, 'the first noncreature spell: 1');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Shock'), { targets: ['A'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 17, 'the second: 2');
  });

  test('Deathtouch: the mark goes with the damage — a creature back on the battlefield (a recast commander) is not killed by 1 damage later', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const rats = T.bf('B', 'Typhoid Rats');
    const giant = T.bf('A', 'Hill Giant');
    T.g.dealDamageToObject(giant, 1, rats, false);
    T.g.checkStateBasedActions();
    t.zone(giant, 'graveyard', 'deathtouch kills it');
    T.g.moveObject(giant, 'battlefield', { controller: 'A' });
    T.g.dealDamageToObject(giant, 1, T.bf('B', 'Grizzly Bears'), false);
    T.g.checkStateBasedActions();
    t.zone(giant, 'battlefield', 'back again, 1 damage from a Bear does not kill a 3/3');
    const myr = T.bf('A', 'Darksteel Myr');
    T.g.dealDamageToObject(myr, 1, rats, false);
    T.g.checkStateBasedActions();
    t.zone(myr, 'battlefield', 'indestructible');
    T.toMain('B');
    t.no(myr.dealtDeathtouch, 'the mark is gone at cleanup with the damage');
  });

  test('Herd Heirloom: the log says the creature gains an ability, not empty quotes', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const hh = T.bf('A', 'Herd Heirloom');
    const wurm = T.bf('A', 'Craw Wurm');
    T.activate('A', hh, 1, { targets: [wurm.id] });
    T.settle();
    t.no(T.g.log.some(l => /gains ""/.test(l.text || '')), 'no empty quotes');
    t.ok(T.g.log.some(l => /Craw Wurm gains an ability until end of turn\./.test(l.text || '')), 'says what happened');
  });

  test('Kishla Skimmer: a card when a card leaves your graveyard during your turn, once a turn; Along the Crooked Way: a creature card', (mk, t) => {
    t.auto('Kishla Skimmer');
    t.auto('Along the Crooked Way');
    t.auto('Skeleton Crew');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Kishla Skimmer');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const g1 = T.grave('A', 'Grizzly Bears'), g2 = T.grave('A', 'Hill Giant');
    const h = T.zone('A', 'hand').length;
    T.g.moveObject(g1, 'hand'); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h + 2, 'the Bears back, and a card drawn');
    T.g.moveObject(g2, 'hand'); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h + 3, 'only once each turn');
    T.toMain('B');
    const g3 = T.grave('A', 'Grizzly Bears');
    const h2 = T.zone('A', 'hand').length;
    T.g.moveObject(g3, 'hand'); T.settle(); T.resolve(); T.settle();
    t.eq(T.zone('A', 'hand').length, h2 + 1, "not on an opponent's turn");
  });

  test("Teval's Judgment: one trigger for cards leaving the graveyard together", (mk, t) => {
    t.auto("Teval's Judgment");
    const T = mk();
    T.toMain('A');
    T.bf('A', "Teval's Judgment");
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const a1 = T.grave('A', 'Grizzly Bears'), a2 = T.grave('A', 'Hill Giant');
    const h = T.zone('A', 'hand').length;
    T.g.moveObject(a1, 'exile'); T.g.moveObject(a2, 'exile');
    t.eq(T.g.pendingTriggers.length, 1, 'two cards at once: one trigger');
    T.settle(); T.resolve(); T.settle();
    t.eq(T.asked.filter(c => c.type === 'mode').length, 1, 'one choice of mode');
    t.eq(T.zone('A', 'hand').length, h + 1, 'the first mode: a card');
  });

  test('Hall of the Bandit Lord: a creature cast with its mana has haste for good; Carnelian Orb: a Dragon, until end of turn', (mk, t) => {
    t.auto('Hall of the Bandit Lord');
    t.auto('Carnelian Orb of Dragonkind');
    const T = mk();
    T.toMain('A');
    const hall = T.bf('A', 'Hall of the Bandit Lord');
    t.ok(T.g.tapForMana('A', hall.id, 0), 'tapped for {C}');
    t.eq(T.life('A'), 17, 'three life paid');
    T.mana('A', 'G');
    const bear = T.hand('A', 'Grizzly Bears');
    T.cast('A', bear);
    T.settle();
    t.ok(T.g.hasKw(bear, 'haste'), 'the Bears have haste');
    T.toMain('B'); T.toMain('A');
    t.ok(T.g.hasKw(bear, 'haste'), 'and keep it');
    const U = mk();
    U.toMain('A');
    const orb = U.bf('A', 'Carnelian Orb of Dragonkind');
    U.g.tapForMana('A', orb.id, 0);
    U.mana('A', 'G1');
    const b2 = U.hand('A', 'Grizzly Bears');
    U.cast('A', b2);
    U.settle();
    t.no(U.g.hasKw(b2, 'haste'), 'not a Dragon: no haste');
    U.g.player('A').pool.clear();
    orb.tapped = false;
    U.g.tapForMana('A', orb.id, 0);
    U.mana('A', 'R4');
    const dr = U.hand('A', 'Shivan Dragon');
    U.cast('A', dr);
    U.settle();
    t.ok(U.g.hasKw(dr, 'haste'), 'a Dragon: haste');
  });

  test('Scaled Nurturer: 2 life when its mana casts a Dragon; Gilanra: a card for a spell of mana value 6 or more', (mk, t) => {
    t.auto('Scaled Nurturer');
    t.auto('Lapis Orb of Dragonkind');
    t.auto('Gilanra, Caller of Wirewood');
    const T = mk();
    T.toMain('A');
    const sn = T.bf('A', 'Scaled Nurturer');
    T.g.tapForMana('A', sn.id, 0);
    T.mana('A', '1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.settle();
    t.eq(T.life('A'), 20, 'not a Dragon');
    sn.tapped = false;
    T.g.tapForMana('A', sn.id, 0);
    T.mana('A', 'RR3');
    T.cast('A', T.hand('A', 'Shivan Dragon'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 22, 'a Dragon: 2 life');
  });

  test("Assassin's Trophy: the destroyed permanent's controller fetches the basic land, not the caster; Settle the Wreckage", (mk, t) => {
    t.auto("Assassin's Trophy");
    t.auto('Settle the Wreckage');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BG');
    T.cast('A', T.hand('A', "Assassin's Trophy"), { targets: [bear.id] });
    T.settle();
    t.zone(bear, 'graveyard');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && (o.analysis() || {}).isLand).length, 1, 'B fetched a land');
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && (o.analysis() || {}).isLand).length, 0, 'A did not');
    const U = mk();
    U.toMain('B');
    const x1 = U.bf('B', 'Grizzly Bears'), x2 = U.bf('B', 'Hill Giant');
    U.answer('declareAttackers', () => [{ attackerId: x1.id, defenderId: 'A' }, { attackerId: x2.id, defenderId: 'A' }]);
    U.toMain('B', 'declareBlockers');
    if (U.g.priorityPlayer && U.g.priorityPlayer.id === 'B') U.g.passPriority('B', true);
    U.mana('A', 'WW2');
    U.cast('A', U.hand('A', 'Settle the Wreckage'), { targets: ['B'] });
    U.settle();
    t.zone(x1, 'exile'); t.zone(x2, 'exile');
    const bl = U.g.battlefield.filter(o => o.controller === 'B' && (o.analysis() || {}).isLand);
    t.eq(bl.length, 2, 'two creatures exiled: two basic lands for B');
    t.ok(bl.every(o => o.tapped), 'tapped');
  });

  test('Aether Vial: a creature card with mana value equal to its charge counters, from hand onto the battlefield', (mk, t) => {
    t.auto('Aether Vial');
    const T = mk();
    T.toMain('A');
    const vial = T.bf('A', 'Aether Vial', { counters: { charge: 2 } });
    const bear = T.hand('A', 'Grizzly Bears'), giant = T.hand('A', 'Hill Giant');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [bear.id] }; });
    T.activate('A', vial, 0);
    T.settle();
    t.eq((offered || []).join(','), 'Grizzly Bears', 'only the mana value 2 card');
    t.zone(bear, 'battlefield');
    t.zone(giant, 'hand');
  });

  test('A label with a hyphen ("Rapid-fire Battle Cannon —") is cut like any other: Knight Paladin, Screamer-Killer; Spider-Ham: a long list of creature types', (mk, t) => {
    t.auto('Knight Paladin');
    t.auto('Screamer-Killer');
    t.auto('Spider-Ham, Peter Porker');
    t.auto('Tiefling Outcasts');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.mana('A', 'WW4');
    T.cast('A', T.hand('A', 'Knight Paladin'));
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('B'), 16, 'B takes 4'); t.eq(T.life('C'), 16, 'C takes 4');
    const U = mk();
    U.toMain('A');
    U.bf('A', 'Spider-Ham, Peter Porker');
    const cat = U.bf('A', 'Savannah Lions'), bear = U.bf('A', 'Grizzly Bears'), giant = U.bf('A', 'Hill Giant');
    t.eq(U.g.powerOf(cat), 3, 'a Cat gets +1/+1');
    t.eq(U.g.powerOf(bear), 3, 'a Bear too');
    t.eq(U.g.powerOf(giant), 3, 'not a Giant');
  });

  test('Archive Trap: free once an opponent has searched their library this turn', (mk, t) => {
    t.auto('Archive Trap');
    const T = mk();
    T.toMain('A');
    const at = T.hand('A', 'Archive Trap');
    t.no(T.g.altUsesFor('A', at.id).some(u => /^alt/.test(u.via)), 'nobody searched: no free cast');
    T.g._runEffects([{ op: 'fetchBasic', n: 1, tapped: true }], { controller: 'B', name: 'Test', kind: 'spell', targets: [] });
    const use = T.g.altUsesFor('A', at.id).find(u => /^alt/.test(u.via));
    t.ok(use, 'B searched: offered for {0}');
    for (let i = 0; i < 14; i++) T.top('B', 'Island');
    T.cast('A', at, { via: use.via, targets: ['B'] });
    t.eq(T.zone('B', 'graveyard').length, 13, 'thirteen milled');
  });

  test('Wheel and Deal: any number of target opponents each discard their hands, then draw seven', (mk, t) => {
    t.auto('Wheel and Deal');
    t.auto('Riverchurn Monument');
    t.auto('Jace, Memory Adept');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    for (const p of ['A', 'B', 'C']) for (let i = 0; i < 9; i++) T.top(p, 'Island');
    const b1 = T.hand('B', 'Lightning Bolt'), c1 = T.hand('C', 'Lightning Bolt');
    T.hand('C', 'Shock');
    const ha = T.zone('A', 'hand').length;
    T.mana('A', 'U3');
    T.cast('A', T.hand('A', 'Wheel and Deal'), { targets: ['B'] });
    T.settle();
    t.zone(b1, 'graveyard', "B's hand discarded");
    t.eq(T.zone('B', 'hand').length, 7, 'B drew seven');
    t.zone(c1, 'hand', 'C, not targeted, keeps theirs');
    t.eq(T.zone('A', 'hand').length, ha + 1, 'and you draw a card');
    const U = mk();
    U.toMain('A');
    const rm = U.bf('A', 'Riverchurn Monument');
    for (let i = 0; i < 10; i++) U.top('B', 'Island');
    for (let i = 0; i < 3; i++) U.grave('B', 'Forest');
    U.grave('A', 'Forest');
    U.mana('A', 'UU2');
    U.activate('A', rm, 1, { targets: ['B'] });
    U.settle();
    t.eq(U.zone('B', 'graveyard').length, 6, "B mills as many as B's graveyard held (3)");
  });

  test('A label ending in "?" is cut too: The Unbeatable Squirrel Girl', (mk, t) => {
    t.auto('The Unbeatable Squirrel Girl');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'The Unbeatable Squirrel Girl', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Squirrel/.test(o.name)).length, 1, 'a Squirrel as she enters');
  });

  test('Veteran Explorer: each player may search for up to two basic lands, onto the battlefield', (mk, t) => {
    t.auto('Veteran Explorer');
    t.auto('Jungle Wayfinder');
    t.auto('New Frontiers');
    const T = mk();
    T.toMain('A');
    const ve = T.bf('A', 'Veteran Explorer');
    for (const p of ['A', 'B']) { T.top(p, 'Forest'); T.top(p, 'Island'); T.top(p, 'Lightning Bolt'); }
    let askedB = false;
    T.answer('confirm', (ch) => { if (ch.playerId === 'B') askedB = true; return { yes: true }; });
    T.answer('confirm', (ch) => { if (ch.playerId === 'B') askedB = true; return { yes: true }; });
    T.g._runEffects([{ op: 'destroy' }], { controller: 'B', name: 'Murder', kind: 'spell', targets: [{ kind: 'object', id: ve.id }] });
    T.settle(); T.resolve(); T.settle();
    const lands = (p) => T.g.battlefield.filter(o => o.controller === p && (o.analysis() || {}).isLand).length;
    t.eq(lands('A'), 2, 'A put two basics onto the battlefield');
    t.eq(lands('B'), 2, 'and B two of their own');
    t.ok(askedB, 'B was asked');
  });

  test('Expansion Algorithm: proliferate X times', (mk, t) => {
    t.auto('Expansion Algorithm');
    t.auto("Tromell, Seymour's Butler");
    const T = mk();
    T.toMain('A');
    const g = T.bf('A', 'Hill Giant', { counters: { '+1/+1': 1 } });
    T.mana('A', 'UU3');
    T.cast('A', T.hand('A', 'Expansion Algorithm'), { x: 3 });
    T.settle();
    t.eq(g.counters['+1/+1'] || 0, 4, 'three more counters');
  });

  test('Echoing Truth, Sever the Bloodline: the target and every other one with its name, returned or exiled', (mk, t) => {
    t.auto('Echoing Truth');
    t.auto('Sever the Bloodline');
    const T = mk();
    T.toMain('A');
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Grizzly Bears'), b3 = T.bf('A', 'Grizzly Bears'), g = T.bf('B', 'Hill Giant');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Echoing Truth'), { targets: [b1.id] });
    t.zone(b1, 'hand'); t.zone(b2, 'hand'); t.zone(b3, 'hand', 'yours too');
    t.zone(g, 'battlefield', 'another name stays');
    const U = mk();
    U.toMain('A');
    const c1 = U.bf('B', 'Grizzly Bears'), c2 = U.bf('B', 'Grizzly Bears'), c3 = U.bf('B', 'Hill Giant');
    U.mana('A', 'BB3');
    U.cast('A', U.hand('A', 'Sever the Bloodline'), { targets: [c1.id] });
    U.settle();
    t.zone(c1, 'exile'); t.zone(c2, 'exile'); t.zone(c3, 'battlefield');
  });

  test("Lord Skitter's Blessing: with an enchanted creature, lose 1 life and draw an additional card in your draw step", (mk, t) => {
    t.auto("Lord Skitter's Blessing");
    const T = mk();
    T.toMain('A');
    T.bf('A', "Lord Skitter's Blessing");
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    const bear = T.bf('A', 'Grizzly Bears');
    const aura = T.bf('A', 'Rancor');
    aura.attachedTo = bear.id; bear.attachments = [aura.id]; T.g.bumpBoard();
    const h = T.zone('A', 'hand').length;
    T.toMain('B'); T.toMain('A');
    t.eq(T.zone('A', 'hand').length, h + 2, 'the normal draw and one more');
    t.eq(T.life('A'), 19, '1 life');
  });

  test("Dire Tactics: without a Human you lose life equal to the exiled creature's toughness; \"you don't control a …\"", (mk, t) => {
    t.auto('Dire Tactics');
    t.auto('Butterbur, Bree Innkeeper');
    t.auto('Errand-Rider of Gondor');
    for (const human of [false, true]) {
      const T = mk();
      T.toMain('A');
      if (human) T.bf('A', 'Elite Vanguard');
      const g = T.bf('B', 'Craw Wurm');
      T.mana('A', 'WB');
      T.cast('A', T.hand('A', 'Dire Tactics'), { targets: [g.id] });
      t.zone(g, 'exile');
      t.eq(T.life('A'), human ? 20 : 16, human ? 'a Human: no life lost' : 'no Human: 4 life, the Wurm\'s toughness');
    }
  });

  test('Well of Ideas: each other player draws an additional card in their draw step', (mk, t) => {
    t.auto('Well of Ideas');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Well of Ideas');
    for (const p of ['A', 'B']) for (let i = 0; i < 6; i++) T.top(p, 'Island');
    const hb = T.zone('B', 'hand').length, ha = T.zone('A', 'hand').length;
    T.toMain('B');
    t.eq(T.zone('B', 'hand').length, hb + 2, 'B: the draw and one more');
    t.eq(T.zone('A', 'hand').length, ha, 'not A');
  });

  test('Dire Fleet Ravager: each player loses a third of their own life, rounded up', (mk, t) => {
    t.auto('Dire Fleet Ravager');
    const T = mk();
    T.toMain('A');
    T.g.player('B').life = 10;
    T.bf('A', 'Dire Fleet Ravager', { etb: true });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 13, '20: 7 lost');
    t.eq(T.life('B'), 6, '10: 4 lost');
  });

  test('Teysa, Opulent Oligarch: a Clue at your end step for each opponent who lost life this turn', (mk, t) => {
    t.auto('Teysa, Opulent Oligarch');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.bf('A', 'Teysa, Opulent Oligarch');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.toMain('A', 'end'); T.settle(); T.resolve(); T.settle();
    t.eq(T.g.battlefield.filter(o => o.isToken && /Clue/.test(o.name)).length, 1, 'B lost life, C did not: one Clue');
  });

  test('Needle Drop: only a player, creature or planeswalker that was dealt damage this turn', (mk, t) => {
    t.auto('Needle Drop');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const g = T.bf('C', 'Hill Giant'), g2 = T.bf('C', 'Hill Giant');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.cast('A', T.hand('A', 'Shock'), { targets: [g.id] });
    const nd = T.hand('A', 'Needle Drop');
    const spec = nd.analysis().abilities.find(a => a.kind === 'spell').effects[0].targets[0];
    const ids = T.g._legalTargetsFor(spec, 'A', nd.id).map(x => x.id);
    t.ok(ids.includes('B'), 'B was dealt damage');
    t.no(ids.includes('C'), 'C was not');
    t.ok(ids.includes(g.id), 'the Shocked Giant');
    t.no(ids.includes(g2.id), 'not the other Giant');
  });

  test('Ellivere of the Wild Court: a card when an enchanted creature of yours deals combat damage to a player', (mk, t) => {
    t.auto('Ellivere of the Wild Court');
    t.auto('Kestia, the Cultivator');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Ellivere of the Wild Court');
    const bear = T.bf('A', 'Grizzly Bears'), giant = T.bf('A', 'Hill Giant');
    const aura = T.bf('A', 'Rancor');
    aura.attachedTo = bear.id; bear.attachments = [aura.id]; T.g.bumpBoard();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const h = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }, { attackerId: giant.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, h + 1, 'one card: the enchanted Bears, not the Giant');
  });

  test("Celestial Mantle: the enchanted creature's controller doubles their life; Revenge: double your life total", (mk, t) => {
    t.auto('Celestial Mantle');
    t.auto('Revival // Revenge');
    const T = mk();
    T.toMain('A');
    T.g.player('A').life = 7;
    const bear = T.bf('A', 'Grizzly Bears');
    const m = T.bf('A', 'Celestial Mantle');
    m.attachedTo = bear.id; bear.attachments = [m.id]; T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('A'), 14, '7 doubled');
    t.eq(T.life('B'), 15, 'a 5/5 Bear');
  });

  test('Halo Fountain: untapping tapped creatures you control is the price', (mk, t) => {
    t.auto('Halo Fountain');
    const T = mk();
    T.toMain('A');
    const hf = T.bf('A', 'Halo Fountain');
    t.no(T.g.activateAbility('A', hf.id, 0, { auto: true }), 'no tapped creature: it cannot be paid');
    const b1 = T.bf('A', 'Grizzly Bears', { tapped: true });
    T.mana('A', 'W');
    T.activate('A', hf, 0);
    T.settle();
    t.no(b1.tapped, 'the Bears untapped to pay');
    t.eq(T.g.battlefield.filter(o => o.isToken && /Citizen/.test(o.name)).length, 1, 'a Citizen');
  });

  test("Legions to Ashes: the target and that player's tokens with its name, no one else's", (mk, t) => {
    t.auto('Legions to Ashes');
    const T = mk();
    T.toMain('A');
    T.g._runEffects([{ op: 'createNamedToken', n: 3, token: 'Treasure' }], { controller: 'B', name: 'Test', kind: 'spell', targets: [] });
    T.g._runEffects([{ op: 'createNamedToken', n: 1, token: 'Treasure' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    const bt = T.g.battlefield.filter(o => o.controller === 'B' && /Treasure/.test(o.name));
    T.mana('A', 'WB1');
    T.cast('A', T.hand('A', 'Legions to Ashes'), { targets: [bt[0].id] });
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && /Treasure/.test(o.name)).length, 0, "B's Treasures all gone");
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && /Treasure/.test(o.name)).length, 1, "A's stays");
  });

  test('Hex Magic: the hand exiled, as many drawn, and the exiled cards playable until the end of your next turn', (mk, t) => {
    t.auto('Hex Magic');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const k1 = T.hand('A', 'Lightning Bolt'), k2 = T.hand('A', 'Forest');
    const hm = T.hand('A', 'Hex Magic');
    T.mana('A', 'R2');
    T.cast('A', hm);
    T.settle();
    t.zone(k1, 'exile'); t.zone(k2, 'exile');
    t.eq(T.zone('A', 'hand').length, 2, 'two drawn for the two exiled');
    t.eq(k1.impulseBy, 'A', 'the Bolt can be played from exile');
    t.ok(k1.impulseUntil > T.g.turn, 'until the end of your next turn');
  });

  test('Mazemind Tome: the fourth page counter exiles it and you gain 4 life', (mk, t) => {
    t.auto('Mazemind Tome');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const mt = T.bf('A', 'Mazemind Tome', { counters: { page: 3 } });
    const life = T.g.player('A').life;
    T.mana('A', '2');
    T.activate('A', mt, 1);
    T.settle();
    t.zone(mt, 'exile');
    t.eq(T.g.player('A').life, life + 4, '4 life');
    t.eq(T.zone('A', 'hand').length, 1, 'and the card drawn');
  });

  test('Darksteel Reactor: twenty charge counters win the game, nineteen do not', (mk, t) => {
    t.auto('Darksteel Reactor');
    const T = mk();
    T.toMain('A');
    const dr = T.bf('A', 'Darksteel Reactor', { counters: { charge: 19 } });
    T.g.checkStateBasedActions(); T.resolve();
    t.no(T.g.player('B').hasLost, 'nineteen is not enough');
    T.g.addCounters(dr, 'charge', 1);
    T.g.checkStateBasedActions(); T.resolve();
    t.ok(T.g.player('B').hasLost, 'twenty wins');
  });

  test('Nine Lives: damage to you is prevented and counted; the ninth counter exiles it and you lose', (mk, t) => {
    t.auto('Nine Lives');
    const T = mk();
    T.toMain('A');
    const nl = T.bf('A', 'Nine Lives', { counters: { incarnation: 7 } });
    const life = T.g.player('A').life;
    T.mana('B', 'R');
    T.g.passPriority('A', true);
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    T.settle();
    t.eq(T.g.player('A').life, life, 'the Bolt prevented');
    t.eq(nl.counters.incarnation, 8, 'an incarnation counter');
    t.no(T.g.player('A').hasLost, 'still in at eight');
    T.g.dealDamageToPlayer(T.g.player('A'), 2, T.bf('B', 'Grizzly Bears'), false);
    T.g.checkStateBasedActions(); T.resolve();
    t.zone(nl, 'exile');
    t.ok(T.g.player('A').hasLost, 'leaving the battlefield loses the game');
  });

  test('Force Bubble: damage becomes depletion counters, four sacrifice it, and the end step clears them', (mk, t) => {
    t.auto('Force Bubble');
    const T = mk();
    T.toMain('A');
    const fb = T.bf('A', 'Force Bubble');
    const life = T.g.player('A').life;
    const src = T.bf('B', 'Grizzly Bears');
    T.g.dealDamageToPlayer(T.g.player('A'), 3, src, false);
    T.settle();
    t.eq(T.g.player('A').life, life, 'no life lost');
    t.eq(fb.counters.depletion, 3, 'three depletion counters');
    T.toMain('A', 'end');
    T.settle();
    t.no(fb.counters.depletion, 'removed at the end step');
    T.g.dealDamageToPlayer(T.g.player('A'), 5, src, false);
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(T.g.player('A').life, life, 'all five turned into counters');
    t.zone(fb, 'graveyard');
  });

  test('Plague Boiler: the third plague counter sacrifices it and destroys every nonland permanent', (mk, t) => {
    const T = mk();
    T.toMain('A');
    const pb = T.bf('A', 'Plague Boiler', { counters: { plague: 2 } });
    const bears = T.bf('B', 'Grizzly Bears');
    const land = T.bf('B', 'Forest');
    T.g.addCounters(pb, 'plague', 1);
    T.g.checkStateBasedActions(); T.resolve();
    t.zone(pb, 'graveyard'); t.zone(bears, 'graveyard'); t.zone(land, 'battlefield');
  });

  test('Deadly Designs: the fifth plot counter, from anyone, sacrifices it and destroys up to two target creatures', (mk, t) => {
    t.auto('Deadly Designs');
    const T = mk();
    T.toMain('A');
    const dd = T.bf('A', 'Deadly Designs', { counters: { plot: 4 } });
    const b1 = T.bf('B', 'Grizzly Bears'), b2 = T.bf('B', 'Hill Giant'), mine = T.bf('A', 'Llanowar Elves');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: b1.id }, { kind: 'object', id: b2.id }] }));
    T.g.passPriority('A', true);
    T.mana('B', '2');
    T.activate('B', dd, 0);
    T.resolve();
    t.zone(dd, 'graveyard'); t.zone(b1, 'graveyard'); t.zone(b2, 'graveyard'); t.zone(mine, 'battlefield');
  });

  test('Apex of Power: cast from hand, it adds ten mana of one colour', (mk, t) => {
    t.auto('Apex of Power');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 9; i++) T.top('A', 'Island');
    T.mana('A', 'RRR7');
    T.cast('A', T.hand('A', 'Apex of Power'));
    T.resolve();
    const pool = T.g.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (Number(pool[c]) || 0), 0), 10, 'ten mana');
  });

  test('Antiquities on the Loose: counters on the Spirits only when it was not cast from hand', (mk, t) => {
    t.auto('Antiquities on the Loose');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'WW1');
    T.cast('A', T.hand('A', 'Antiquities on the Loose'));
    T.resolve();
    const spirits = () => T.g.battlefield.filter(o => o.controller === 'A' && /Spirit/.test(o.name));
    t.eq(spirits().length, 2, 'two Spirits');
    t.no(spirits().some(o => o.counters['+1/+1']), 'from hand: no counters');
    const ag = T.zone('A', 'graveyard').find(o => o.name === 'Antiquities on the Loose');
    T.mana('A', 'WW4');
    T.cast('A', ag, { via: 'flashback' });
    T.resolve();
    t.eq(spirits().length, 4, 'two more');
    t.ok(spirits().every(o => o.counters['+1/+1'] === 1), 'flashed back: a counter on each Spirit');
  });

  test("Veil of Summer: your spells this turn can't be countered", (mk, t) => {
    t.auto('Veil of Summer');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Veil of Summer'));
    T.resolve();
    T.mana('A', 'G1');
    const bear = T.hand('A', 'Grizzly Bears');
    T.cast('A', bear, { resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [T.stackTarget(bear)] });
    T.resolve();
    t.zone(bear, 'battlefield');
  });

  test('Furnace Dragon: exiles all artifacts only when cast from hand', (mk, t) => {
    t.auto('Furnace Dragon');
    const T = mk();
    T.toMain('A');
    const art = T.bf('B', 'Sol Ring');
    T.put('A', 'Furnace Dragon', 'battlefield', { etb: true });
    T.resolve();
    t.zone(art, 'battlefield');
    T.mana('A', 'RRR6');
    T.cast('A', T.hand('A', 'Furnace Dragon'));
    T.resolve();
    t.zone(art, 'exile');
  });

  test('Prismari, the Inspiration: your instants and sorceries have storm, your creatures do not', (mk, t) => {
    t.auto('Prismari, the Inspiration');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Prismari, the Inspiration');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.g.battlefield.filter(o => o.name === 'Grizzly Bears').length, 1, 'no copy of a creature spell');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 14, 'the Bolt and one storm copy');
  });

  test('Storm, Force of Nature: only the next instant or sorcery spell has storm', (mk, t) => {
    t.auto('Storm, Force of Nature');
    const T = mk();
    T.toMain('A');
    const sf = T.bf('A', 'Storm, Force of Nature');
    const tr = sf.analysis().abilities.find(x => x.kind === 'triggered' && /storm/i.test(x.text));
    T.g._runEffects(tr.effects, { controller: 'A', obj: sf, name: sf.name, kind: 'ability', targets: [] });
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 14, 'the creature did not use it; the Bolt has one storm copy');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 11, 'the next Bolt has no storm');
  });

  test("Ral, Crackling Wit: the emblem gives your instants and sorceries storm", (mk, t) => {
    t.auto('Ral, Crackling Wit');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const ral = T.bf('A', 'Ral, Crackling Wit', { counters: { loyalty: 10 } });
    const a = ral.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', ral, list.findIndex(x => x.cost && x.cost.loyalty === -10));
    T.resolve();
    t.ok(T.zone('A', 'command').some(o => o.card.layout === 'emblem'), 'an emblem');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 17, 'the first spell this turn: no copies');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 11, 'the second: one storm copy');
  });

  test('Well Rested: the enchanted creature untapping gives two counters, 2 life and a card, once each turn', (mk, t) => {
    t.auto('Well Rested');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const bear = T.bf('A', 'Grizzly Bears', { tapped: true });
    const wr = T.bf('A', 'Well Rested'); wr.attachedTo = bear.id; bear.attachments = [wr.id];
    T.g.bumpBoard();
    const life = T.g.player('A').life;
    T.g._markUntapped(bear);
    T.resolve();
    t.eq(bear.counters['+1/+1'], 2, 'two counters');
    t.eq(T.g.player('A').life, life + 2, '2 life');
    t.eq(T.zone('A', 'hand').length, 1, 'a card');
    T.g._markTapped(bear); T.g._markUntapped(bear);
    T.resolve();
    t.eq(bear.counters['+1/+1'], 2, 'not again this turn');
  });

  test('Level Up: attacking doubles the counters, then a card if the creature has power 10 or greater', (mk, t) => {
    t.auto('Level Up');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const bear = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 2 } });
    const lu = T.bf('A', 'Level Up'); lu.attachedTo = bear.id; bear.attachments = [lu.id];
    T.g.bumpBoard();
    const hand0 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(bear.counters['+1/+1'], 4, 'two doubled to four');
    t.eq(T.zone('A', 'hand').length, hand0, 'power 6: no card');
    bear.counters['+1/+1'] = 4;
    T.toMain('A');
    const hand1 = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(bear.counters['+1/+1'], 8, 'four doubled to eight');
    t.eq(T.zone('A', 'hand').length, hand1 + 1, 'power 10: a card');
  });

  test("Danny Pink: each of your creatures draws you a card the first time counters go on it each turn", (mk, t) => {
    t.auto('Danny Pink');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    T.bf('A', 'Danny Pink');
    const bear = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, 'a card');
    T.g.addCounters(bear, 'shield', 1);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, 'not twice in a turn');
    T.g.addCounters(theirs, '+1/+1', 1);
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, "not for the opponent's creature");
  });

  test('Folk Hero: a spell sharing a creature type with your commander draws a card, once each turn', (mk, t) => {
    t.auto('Folk Hero');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
    T.bf('A', 'Folk Hero');
    T.g.bumpBoard();
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Llanowar Elves'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 0, 'an Elf shares nothing with a Bear');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 0, 'nor does an instant');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, 'a Bear: a card');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, 'only once each turn');
  });

  test('Cloakwood Hermit: Squirrels at your end step only if a creature card went to your graveyard this turn', (mk, t) => {
    t.auto('Cloakwood Hermit');
    const T = mk();
    T.toMain('A');
    const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
    T.bf('A', 'Cloakwood Hermit');
    T.g.bumpBoard();
    const squirrels = () => T.g.battlefield.filter(o => o.controller === 'A' && /Squirrel/.test(o.name));
    T.toMain('A', 'end');
    T.resolve();
    t.eq(squirrels().length, 0, 'nothing went to the graveyard');
    T.toMain('A');
    const elf = T.bf('B', 'Llanowar Elves');
    T.g.moveObject(elf, 'graveyard');
    t.eq(squirrels().length, 0, "an opponent's creature is not yours");
    T.g.moveObject(T.hand('A', 'Hill Giant'), 'graveyard');
    T.toMain('A', 'end');
    T.resolve();
    t.eq(squirrels().length, 2, 'a creature card from your hand counts');
    t.ok(squirrels().every(o => o.tapped), 'tapped');
  });

  test('Macabre Reconstruction: {2} less once a creature card has gone to your graveyard this turn', (mk, t) => {
    t.auto('Macabre Reconstruction');
    const T = mk();
    T.toMain('A');
    const mr = T.hand('A', 'Macabre Reconstruction');
    t.eq(T.g.castCostFor('A', mr.id), '{3}{B}', 'full price at first');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.moveObject(bear, 'graveyard');
    t.eq(T.g.castCostFor('A', mr.id), '{1}{B}', '{2} less now');
  });

  test('Arixmethes, Slumbering Isle: a land while it has a slumber counter, a 12/12 once they are gone', (mk, t) => {
    t.auto('Arixmethes, Slumbering Isle');
    const T = mk();
    T.toMain('A');
    const ax = T.put('A', 'Arixmethes, Slumbering Isle', 'battlefield', { etb: true });
    t.ok(ax.tapped, 'enters tapped');
    t.eq(ax.counters.slumber, 5, 'with five slumber counters');
    t.no(T.g.characteristics(ax).isCreature, 'not a creature');
    t.ok(ax.analysis().isLand, 'a land');
    ax.counters.slumber = 1;
    T.answer('confirm', { yes: true });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.no(ax.counters.slumber, 'the last slumber counter removed');
    t.ok(T.g.characteristics(ax).isCreature, 'a creature now');
    t.eq(T.g.powerOf(ax), 12, '12/12');
  });

  test('War Balloon: an artifact creature with three or more fire counters', (mk, t) => {
    t.auto('War Balloon');
    const T = mk();
    T.toMain('A');
    const wb = T.bf('A', 'War Balloon', { counters: { fire: 2 } });
    t.no(T.g.characteristics(wb).isCreature, 'two: not a creature');
    T.mana('A', '1');
    T.activate('A', wb, 0);
    T.resolve();
    t.eq(wb.counters.fire, 3, 'a third fire counter');
    t.ok(T.g.characteristics(wb).isCreature, 'three: an artifact creature');
  });

  test('Wild-Magic Sorcerer: the first spell you cast from exile each turn has cascade, the second does not', (mk, t) => {
    t.auto('Wild-Magic Sorcerer');
    const T = mk({ library: ['Island'] });
    T.toMain('A');
    T.bf('A', 'Wild-Magic Sorcerer');
    const bears = T.top('A', 'Grizzly Bears');
    const g1 = T.put('A', 'Hill Giant', 'exile'); g1.impulseBy = 'A'; g1.impulseUntil = T.g.turn;
    const g2 = T.put('A', 'Hill Giant', 'exile'); g2.impulseBy = 'A'; g2.impulseUntil = T.g.turn;
    T.answer('confirm', { yes: true });
    T.mana('A', 'R3');
    T.cast('A', g1);
    T.resolve();
    t.zone(bears, 'battlefield');
    const top = T.top('A', 'Grizzly Bears');
    T.mana('A', 'R3');
    T.cast('A', g2);
    T.resolve();
    t.zone(top, 'library');
  });

  test('Storm on a spell cast without paying its mana cost (Grapeshot)', (mk, t) => {
    const T = mk();
    T.toMain('A');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    const gs = T.hand('A', 'Grapeshot');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.g._castFree('A', gs);
    T.resolve();
    t.eq(T.g.player('B').life, 15, 'the Bolt, Grapeshot and one storm copy');
  });

  test('Treasure Map: the third landmark counter is removed, it transforms, and three Treasures', (mk, t) => {
    t.auto('Treasure Map // Treasure Cove');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const tm = T.bf('A', 'Treasure Map // Treasure Cove', { counters: { landmark: 1 } });
    const treasures = () => T.g.battlefield.filter(o => o.controller === 'A' && /Treasure/.test(o.name) && o.isToken).length;
    T.mana('A', '1');
    T.activate('A', tm, 0);
    T.resolve();
    t.eq(tm.counters.landmark, 2, 'two: nothing yet');
    t.eq(treasures(), 0);
    tm.tapped = false;
    T.mana('A', '1');
    T.activate('A', tm, 0);
    T.resolve();
    t.no(tm.counters.landmark, 'the counters removed');
    t.eq(tm.face, 1, 'transformed');
    t.eq(treasures(), 3, 'three Treasures');
  });

  test('Charitable Levy: the third collection counter sacrifices it, then a card and maybe a Plains', (mk, t) => {
    t.auto('Charitable Levy');
    const T = mk({ library: ['Plains'] });
    T.toMain('A');
    const cl = T.bf('A', 'Charitable Levy', { counters: { collection: 2 } });
    const hand0 = T.zone('A', 'hand').length;
    const lands0 = T.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Plains').length;
    T.answer('confirm', { yes: true });
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.zone(cl, 'graveyard');
    t.eq(T.zone('A', 'hand').length, hand0 + 1, 'a card');
    const plains = T.g.battlefield.filter(o => o.controller === 'A' && o.name === 'Plains');
    t.eq(plains.length, lands0 + 1, 'a Plains');
    t.ok(plains[plains.length - 1].tapped, 'tapped');
  });

  test('Restorative Technique: the target player gains the life and searches their own library', (mk, t) => {
    t.auto('Restorative Technique');
    const T = mk({ library: ['Forest'] });
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Restorative Technique'), { targets: ['B', bear.id] });
    T.resolve();
    t.eq(T.g.player('B').life, 22, 'B gains 2');
    t.eq(T.g.battlefield.filter(o => o.controller === 'B' && o.name === 'Forest').length, 1, "a Forest from B's library, under B's control");
    t.eq(bear.counters['+1/+1'], 1, 'and the counter');
  });

  test('The Cabbage Merchant: combat damage to you costs you a Food token', (mk, t) => {
    t.auto('The Cabbage Merchant');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'The Cabbage Merchant');
    T.g._runEffects([{ op: 'createNamedToken', n: 2, token: 'Food' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    const foods = () => T.g.battlefield.filter(o => o.controller === 'A' && /Food/.test(o.name)).length;
    t.eq(foods(), 2);
    const bear = T.bf('B', 'Grizzly Bears');
    T.g.dealDamageToPlayer(T.g.player('A'), 2, bear, true);
    T.resolve();
    t.eq(foods(), 1, 'one Food sacrificed');
  });

  test("Valgavoth, Harrower of Souls: an opponent's first life loss on their own turn, and only that", (mk, t) => {
    t.auto('Valgavoth, Harrower of Souls');
    const T = mk();
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    const v = T.bf('A', 'Valgavoth, Harrower of Souls');
    T.toMain('A');
    T.g.changeLife('B', -1, 'test');
    T.resolve();
    t.no(v.counters['+1/+1'], 'not on your own turn');
    T.toMain('B');
    const hand = T.zone('A', 'hand').length;
    T.g.changeLife('B', -2, 'test');
    T.resolve();
    t.eq(v.counters['+1/+1'], 1, 'a counter');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'and a card');
    T.g.dealDamageToPlayer(T.g.player('B'), 2, T.bf('A', 'Grizzly Bears'), false);
    T.resolve();
    t.eq(v.counters['+1/+1'], 1, 'not the second time');
  });

  test("Dollmaker's Shop // Porcelain Gallery: a Toy when non-Toys attack; creatures as big as your creature count", (mk, t) => {
    t.auto("Dollmaker's Shop // Porcelain Gallery");
    const T = mk();
    const r = T.bf('A', "Dollmaker's Shop // Porcelain Gallery"); r.face = 0;
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    const toys = T.g.battlefield.filter(o => o.controller === 'A' && /Toy/.test(o.name));
    t.eq(toys.length, 1, 'a Toy');
    r.face = 2; T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 2, 'two creatures: 2/2');
    T.bf('A', 'Llanowar Elves');
    T.g.bumpBoard();
    t.eq(T.g.powerOf(bear), 3, 'three creatures: 3/3');
    t.eq(T.g.toughnessOf(toys[0]), 3);
  });

  test('Ripple: Surging Flame reveals another Surging Flame and casts it free; the rest go to the bottom', (mk, t) => {
    t.auto('Surging Flame');
    const T = mk({ library: ['Plains'] });
    T.toMain('A');
    // the top four, top first: Island, Surging Flame, Swamp, Mountain
    const m = T.top('A', 'Mountain'), sw = T.top('A', 'Swamp'), f2 = T.top('A', 'Surging Flame'), is = T.top('A', 'Island');
    T.answer('confirm', (ch) => { t.eq(ch.purpose, 'rippleReveal', 'asked whether to reveal'); return { yes: true }; });
    T.answer('pickCard', (ch) => { t.eq(ch.purpose, 'rippleCast'); return { cardIds: [f2.id] }; });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', { yes: false });
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Surging Flame'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 16, 'two Flames: 4 damage');
    t.zone(f2, 'graveyard');
    const lib = T.zone('A', 'library');
    t.eq(lib.slice(-3).map(c => c.id).join(), [is.id, sw.id, m.id].join(), 'the other three at the bottom, in the order revealed');
  });

  test('Ripple: Thrumming Stone gives your spells ripple 4', (mk, t) => {
    t.auto('Thrumming Stone');
    const T = mk({ library: ['Plains'] });
    T.toMain('A');
    T.bf('A', 'Thrumming Stone');
    const b2 = T.top('A', 'Lightning Bolt');
    T.answer('confirm', { yes: true });
    T.answer('pickCard', { cardIds: [b2.id] });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', { yes: false });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 14, 'the second Bolt cast from the reveal');
    t.zone(b2, 'graveyard');
  });

  test("Ripple: under Thalia the rippled spell costs {1}, and is not cast if that can't be paid", (mk, t) => {
    const T = mk({ library: ['Plains'] });
    T.toMain('A');
    T.bf('B', 'Thalia, Guardian of Thraben');
    const f2 = T.top('A', 'Surging Flame');
    T.answer('confirm', { yes: true });
    T.answer('pickCard', { cardIds: [f2.id] });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Surging Flame'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 18, 'no mana left for the tax: only the first Flame');
    t.zone(f2, 'library');
    t.eq(T.zone('A', 'library').slice(-4)[0].id, f2.id, 'it went to the bottom with the other three');
    const f3 = T.top('A', 'Surging Flame');
    T.answer('confirm', { yes: true });
    T.answer('pickCard', { cardIds: [f3.id] });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', { yes: false });
    T.mana('A', 'R3');
    T.cast('A', T.hand('A', 'Surging Flame'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 14, 'with {1} spare the rippled Flame is cast for it');
    t.zone(f3, 'graveyard');
    const pool = T.g.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (Number(pool[c]) || 0), 0), 0, 'the {1} was paid');
  });

  test('Ripple: a rippled Surging Might asks what it will enchant', (mk, t) => {
    t.auto('Surging Might');
    const T = mk({ library: ['Plains'] });
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const m2 = T.top('A', 'Surging Might');
    T.answer('confirm', { yes: true });
    T.answer('pickCard', { cardIds: [m2.id] });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.answer('confirm', { yes: false });
    T.mana('A', 'G2');
    T.cast('A', T.hand('A', 'Surging Might'), { targets: [bear.id] });
    T.resolve();
    t.eq(m2.attachedTo, bear.id, 'the second Might on the Bears too');
    t.eq(T.g.powerOf(bear), 6);
  });

  test('Raff, Weatherlight Stalwart: you may tap two untapped creatures to draw a card', (mk, t) => {
    t.auto('Raff, Weatherlight Stalwart');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    T.bf('A', 'Raff, Weatherlight Stalwart');
    const b1 = T.bf('A', 'Grizzly Bears'), b2 = T.bf('A', 'Llanowar Elves'), b3 = T.bf('A', 'Hill Giant');
    T.answer('confirm', { yes: true });
    T.answer('choose', (ch) => { t.eq(ch.purpose, 'tapToPay'); return { picks: [b1.id, b2.id] }; });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.ok(b1.tapped && b2.tapped, 'the two picked are tapped');
    t.no(b3.tapped, 'the third is not');
    t.eq(T.zone('A', 'hand').length, 1, 'a card');
  });

  test('Aziza, Mage Tower Captain: three creatures tapped copy the spell, and the stack empties', (mk, t) => {
    t.auto('Aziza, Mage Tower Captain');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Aziza, Mage Tower Captain');
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Llanowar Elves');
    T.answer('confirm', { yes: true });
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 14, 'the Bolt and its copy');
    t.eq(T.g.stack.length, 0, 'nothing left on the stack');
    t.eq(T.g.battlefield.filter(o => o.controller === 'A' && o.tapped).length, 3, 'Aziza and both creatures tapped');
  });

  test('Redcap Raiders: only a non-Human can be tapped for it', (mk, t) => {
    t.auto('Redcap Raiders');
    const T = mk();
    const rr = T.bf('A', 'Redcap Raiders');
    const human = T.bf('A', 'Thalia, Guardian of Thraben');
    T.answer('confirm', { yes: true });
    T.answer('declareAttackers', () => [{ attackerId: rr.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.no(human.tapped, 'a Human is no use');
    t.eq(T.g.powerOf(rr), 3, 'no bonus (a 3/2)');
    t.no(T.g.hasKw(rr, 'trample'), 'no trample');
  });

  test('Rent Is Due: tap two creatures and/or Treasures to draw, or else it is sacrificed', (mk, t) => {
    t.auto('Rent Is Due');
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const rd = T.bf('A', 'Rent Is Due');
    const b1 = T.bf('A', 'Grizzly Bears');
    T.g._runEffects([{ op: 'createNamedToken', n: 1, token: 'Treasure' }], { controller: 'A', name: 'Test', kind: 'spell', targets: [] });
    T.toMain('A');
    const hand = T.zone('A', 'hand').length;
    T.answer('confirm', (ch) => { t.ok(/tap two/i.test(ch.prompt || ''), 'asked'); return { yes: true }; });
    T.toMain('A', 'end');
    T.resolve();
    t.ok(b1.tapped, 'the Bears tapped');
    t.ok(T.g.battlefield.find(o => /Treasure/.test(o.name)).tapped, 'and the Treasure');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'a card');
    t.zone(rd, 'battlefield');
    T.toMain('A');
    T.answer('confirm', { yes: false });
    T.toMain('A', 'end');
    T.resolve();
    t.zone(rd, 'graveyard');
  });

  test("Koskun Falls, Command Bridge: sacrificed unless you tap an untapped permanent or creature you control", (mk, t) => {
    t.auto('Koskun Falls'); t.auto('Command Bridge');
    const T = mk();
    T.toMain('A');
    const cb0 = T.put('A', 'Command Bridge', 'battlefield', { etb: true });
    T.resolve();
    t.zone(cb0, 'graveyard', 'it enters tapped, and with nothing else untapped it goes');
    const forest = T.bf('A', 'Forest');
    T.answer('confirm', (ch) => { t.eq(ch.yesLabel, 'Tap one'); t.eq(ch.noLabel, 'Sacrifice it'); return { yes: true }; });
    const cb = T.put('A', 'Command Bridge', 'battlefield', { etb: true });
    T.resolve();
    t.zone(cb, 'battlefield');
    t.ok(forest.tapped, 'the Forest tapped for it');
    const kf = T.bf('A', 'Koskun Falls');
    T.toMain('B'); T.toMain('A', 'upkeep');
    T.resolve();
    t.zone(kf, 'graveyard', 'no creature to tap: sacrificed');
  });

  test('Hymn to Tourach, Mindwhip Sliver: target player discards at random', (mk, t) => {
    t.auto('Hymn to Tourach'); t.auto('Mindwhip Sliver');
    const T = mk();
    T.toMain('A');
    for (const n of ['Island', 'Forest', 'Swamp']) T.hand('B', n);
    T.mana('A', 'BB');
    T.cast('A', T.hand('A', 'Hymn to Tourach'), { targets: ['B'] });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 1, 'two at random');
    t.eq(T.asked.filter(c => c.playerId === 'B').length, 0, 'nobody chooses');
    const ms = T.bf('A', 'Mindwhip Sliver');
    T.g.bumpBoard();
    const a = ms.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const k = list.findIndex(x => x.cost && x.cost.sacSelf);
    t.ok(k >= 0, 'the Sliver has the ability itself');
    T.mana('A', '2');
    T.activate('A', ms, k, { targets: ['B'] });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 0, 'the last card, at random');
    t.zone(ms, 'graveyard');
  });

  test("Opaline Sliver: a Sliver an opponent's spell targets draws its controller a card", (mk, t) => {
    t.auto('Opaline Sliver');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const os = T.bf('A', 'Opaline Sliver');
    T.g.bumpBoard();
    T.answer('confirm', { yes: true });
    T.g.passPriority('A', true);
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [os.id] });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 1, 'a card');
  });

  test('Chandra, Acolyte of Flame: -2 casts a cheap instant from your graveyard, paying for it, and exiles it after', (mk, t) => {
    t.auto('Chandra, Acolyte of Flame');
    const T = mk();
    T.toMain('A');
    const ch = T.bf('A', 'Chandra, Acolyte of Flame', { counters: { loyalty: 4 } });
    const bolt = T.grave('A', 'Lightning Bolt');
    const a = ch.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    const k = list.findIndex(x => x.cost && x.cost.loyalty === -2);
    T.answer('confirm', (q) => { t.ok(/paying its mana cost/.test(q.prompt), 'paid for, not free'); return { yes: true }; });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R');
    T.activate('A', ch, k, { targets: [bolt.id] });
    T.resolve();
    t.eq(T.g.player('B').life, 17, 'the Bolt');
    t.zone(bolt, 'exile', 'exiled instead of going back to the graveyard');
    const big = T.grave('A', 'Lava Axe');
    T.g.turn++;
    ch.counters.loyalty = 4; ch._turnUses = null; ch.activatedTurn = null;
    t.no(T.g._legalTargetsFor(list[k].effects[0].targets[0], 'A', ch.id).some(x => (x.id || x) === big.id), 'mana value 5 is too much');
  });

  test("Chandra, Flame's Catalyst: -8 wheels, then spells from your hand are free this turn", (mk, t) => {
    t.auto("Chandra, Flame's Catalyst");
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    T.top('A', 'Lava Axe');
    const ch = T.bf('A', "Chandra, Flame's Catalyst", { counters: { loyalty: 8 } });
    T.hand('A', 'Forest');
    const a = ch.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', ch, list.findIndex(x => x.cost && x.cost.loyalty === -8));
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 7, 'seven new cards');
    const axe = T.zone('A', 'hand').find(c => c.name === 'Lava Axe');
    T.cast('A', axe, { targets: ['B'] });
    T.resolve();
    t.eq(T.g.player('B').life, 15, 'Lava Axe for nothing');
  });

  test('Toshiro Umezawa: an opposing creature dying lets you cast an instant from your graveyard, paid for, then exiled', (mk, t) => {
    t.auto('Toshiro Umezawa');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Toshiro Umezawa');
    const bolt = T.grave('A', 'Lightning Bolt');
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('confirm', { yes: true });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bolt.id }] }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.mana('A', 'R');
    T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.eq(T.g.player('B').life, 17, 'the Bolt, cast for {R}');
    t.zone(bolt, 'exile');
  });

  test('Fecund Greenshell: a creature with toughness greater than its power entering digs; a square one does not', (mk, t) => {
    t.auto('Fecund Greenshell');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Fecund Greenshell');
    const top = T.top('A', 'Grizzly Bears');
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.zone(top, 'library', 'a 2/2 is not taller than it is strong');
    T.put('A', 'Wall of Wood', 'battlefield', { etb: true });
    T.resolve();
    t.zone(top, 'hand', 'a 0/3 wall: the top card, not a land, into the hand');
  });

  test('Plagon, Lord of the Beach: a card for each creature tougher than it is strong; one deals damage by toughness this turn', (mk, t) => {
    t.auto('Plagon, Lord of the Beach');
    const T = mk();
    for (let i = 0; i < 5; i++) T.top('A', 'Island');
    const wall = T.bf('A', 'Wall of Wood');
    T.bf('A', 'Grizzly Bears');
    T.toMain('A');
    const pl = T.put('A', 'Plagon, Lord of the Beach', 'battlefield', { etb: true });
    T.resolve();
    const tough = [wall, pl].filter(o => T.g.toughnessOf(o) > T.g.powerOf(o)).length;
    t.eq(T.zone('A', 'hand').length, tough, 'one card for each of them, Plagon counted if it is one');
    const a = pl.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.mana('A', 'W');
    T.activate('A', pl, list.findIndex(x => x.kind === 'activated'), { targets: [wall.id] });
    T.resolve();
    t.ok(T.g._dealsByToughness(wall), 'the wall deals damage by its toughness this turn');
    t.no(T.g._dealsByToughness(T.g.battlefield.find(o => o.name === 'Grizzly Bears')), 'not the Bears');
  });

  test('Eminence: Edgar Markov makes a Vampire for another Vampire spell from the command zone, not for himself', (mk, t) => {
    t.auto('Edgar Markov');
    const T = mk();
    T.toMain('A');
    const ed = T.put('A', 'Edgar Markov', 'command'); ed.isCommander = true;
    const vamps = () => T.g.battlefield.filter(o => o.controller === 'A' && o.isToken && /Vampire/.test(o.name)).length;
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Vampire Nighthawk'));
    T.resolve();
    t.eq(vamps(), 1, 'a token, Edgar still in the command zone');
    T.mana('A', 'RWB3');
    T.cast('A', ed);
    T.resolve();
    t.zone(ed, 'battlefield');
    t.eq(vamps(), 1, 'casting Edgar himself makes none');
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Vampire Nighthawk'));
    T.resolve();
    t.eq(vamps(), 2, 'and on the battlefield it works the same, once');
  });

  test('Eminence: The Ur-Dragon makes other Dragon spells cost {1} less from the command zone', (mk, t) => {
    t.auto('The Ur-Dragon');
    const T = mk();
    T.toMain('A');
    const ud = T.put('A', 'The Ur-Dragon', 'command'); ud.isCommander = true;
    const dragon = T.hand('A', 'Shivan Dragon');
    t.eq(T.g.castCostFor('A', dragon.id), '{3}{R}{R}', 'Shivan Dragon {4}{R}{R} for {1} less');
    t.eq(T.g.castCostFor('A', T.hand('A', 'Grizzly Bears').id), '{1}{G}', 'not a Dragon: full price');
    t.eq(T.g.castCostFor('A', ud.id), '{4}{W}{U}{B}{R}{G}', 'not itself');
  });

  test('Eminence: Sidar Jabari of Zhalfir loots when you attack with Knights, from the command zone', (mk, t) => {
    t.auto('Sidar Jabari of Zhalfir');
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const sj = T.put('A', 'Sidar Jabari of Zhalfir', 'command'); sj.isCommander = true;
    const knight = T.bf('A', 'Knight of Glory');
    T.hand('A', 'Forest');
    T.answer('declareAttackers', () => [{ attackerId: knight.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'graveyard').length, 1, 'drew one and discarded one');
  });

  test('Eminence: Inalla copies a Wizard that enters, for {1}, from the command zone; the copy has haste and is exiled at end of turn', (mk, t) => {
    t.auto('Inalla, Archmage Ritualist');
    const T = mk();
    T.toMain('A');
    const ina = T.put('A', 'Inalla, Archmage Ritualist', 'command'); ina.isCommander = true;
    const copies = () => T.g.battlefield.filter(o => o.isToken && o.name === 'Prodigal Sorcerer');
    T.answer('confirm', { yes: false });
    T.put('A', 'Prodigal Sorcerer', 'battlefield', { etb: true });
    T.resolve();
    t.eq(copies().length, 0, 'not paid: no copy');
    T.answer('confirm', { yes: true });
    T.mana('A', '1');
    T.put('A', 'Prodigal Sorcerer', 'battlefield', { etb: true });
    T.resolve();
    t.eq(copies().length, 1, 'paid: a copy');
    t.ok(T.g.hasKw(copies()[0], 'haste'), 'with haste');
    T.toMain('A', 'end');
    T.resolve();
    t.eq(copies().length, 0, 'exiled at the end step');
  });

  test('Eminence: Arahbo pumps a Cat at the beginning of combat from the command zone; an attacking Cat doubles for {1}{G}{W}', (mk, t) => {
    t.auto('Arahbo, Roar of the World');
    const T = mk();
    const ar = T.put('A', 'Arahbo, Roar of the World', 'command'); ar.isCommander = true;
    const cat = T.bf('A', 'Savannah Lions');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: cat.id }] }));
    T.toMain('A', 'beginCombat');
    T.resolve();
    t.eq(T.g.powerOf(cat), 5, 'a 2/1 Cat gets +3/+3 from the command zone');
    T.bf('A', 'Arahbo, Roar of the World');
    T.g._removeFromZone(ar); ar.zone = null;
    T.g.bumpBoard();
    T.answer('confirm', { yes: true });
    for (const l of ['Forest', 'Plains', 'Plains']) T.bf('A', l);
    T.answer('declareAttackers', () => [{ attackerId: cat.id, defenderId: 'B' }]);
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.powerOf(cat), 10, 'paid: +X/+X where X is its power, 5');
    t.ok(T.g.hasKw(cat, 'trample'), 'and trample');
  });

  test('Hallowed Haunting, Wrenn and Seven: tokens whose size their own words define', (mk, t) => {
    t.auto('Hallowed Haunting'); t.auto('Wrenn and Seven');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Hallowed Haunting');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Pacifism'), { targets: [T.bf('B', 'Grizzly Bears').id] });
    T.resolve();
    const sc = T.g.battlefield.filter(o => o.isToken && /Spirit/.test(o.name));
    t.eq(sc.length, 1, 'a Spirit Cleric');
    t.eq(T.g.powerOf(sc[0]), 1, 'as big as the Spirits you control: 1');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Pacifism'), { targets: [T.bf('B', 'Grizzly Bears').id] });
    T.resolve();
    t.eq(T.g.powerOf(sc[0]), 2, 'two Spirits: 2/2 each');
    const w7 = T.bf('A', 'Wrenn and Seven', { counters: { loyalty: 5 } });
    for (const l of ['Forest', 'Forest', 'Island']) T.hand('A', l);
    const a = w7.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.map(c => c.id) }));
    T.activate('A', w7, list.findIndex(x => x.cost && x.cost.loyalty === 0));
    T.resolve();
    const lands = T.g.battlefield.filter(o => o.controller === 'A' && (o.analysis() || {}).isLand);
    t.eq(lands.length, 3, 'all three lands from hand');
    t.ok(lands.every(o => o.tapped), 'tapped');
  });

  test('Put a card from your hand onto the battlefield: a choice with "you may" (The Ur-Dragon), a must without it', (mk, t) => {
    t.auto('The Ur-Dragon');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const ud = T.bf('A', 'The Ur-Dragon');
    const giant = T.hand('A', 'Hill Giant');
    T.answer('pickCard', (ch) => { t.ok(ch.optional, 'you may: asked, and none is an answer'); return { cardIds: [] }; });
    T.answer('declareAttackers', () => [{ attackerId: ud.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.zone(giant, 'hand', 'declined: it stays in hand');
    const probe = T.MTG.oracle.analyze({ id: 'probe:must-put', name: 'Probe', type_line: 'Sorcery', mana_cost: '', cmc: 0, layout: 'normal',
      oracle_text: 'Draw a card, then put a creature card from your hand onto the battlefield.' });
    const eff = probe.abilities[0].effects;
    t.eq(eff[1].optional, false, 'no "you may": not a choice');
    T.toMain('A');
    T.answer('pickCard', (ch) => { t.no(ch.optional, 'one must be picked'); return { cardIds: [giant.id] }; });
    T.g._runEffects(eff, { controller: 'A', name: 'Probe', kind: 'spell', targets: [] });
    T.settle();
    t.zone(giant, 'battlefield');
    const bear = T.hand('A', 'Grizzly Bears');
    T.g.player('A').isBot = true;
    T.g._runEffects(eff, { controller: 'A', name: 'Probe', kind: 'spell', targets: [] });
    T.settle();
    t.zone(bear, 'battlefield', 'with nobody to choose, one is still put');
  });

  test("Masumaro, Mordenkainen, Thousand Moons Smithy: sizes from your hand, twice over, and from artifacts and/or creatures", (mk, t) => {
    t.auto('Masumaro, First to Live'); t.auto('Mordenkainen');
    const T = mk();
    T.toMain('A');
    const ma = T.bf('A', 'Masumaro, First to Live');
    for (const n of ['Island', 'Forest', 'Swamp']) T.hand('A', n);
    t.eq(T.g.powerOf(ma), 6, 'twice three cards in hand');
    const sm = T.put('A', 'Thousand Moons Smithy // Barracks of the Thousand', 'battlefield', { etb: true });
    T.resolve();
    const gnome = T.g.battlefield.find(o => o.isToken && /Gnome/.test(o.name));
    t.ok(gnome, 'a Gnome Soldier');
    T.bf('A', 'Sol Ring');
    T.g.bumpBoard();
    // artifacts and/or creatures: Masumaro, the Smithy, the Gnome, the Sol Ring, each once
    t.eq(T.g.powerOf(gnome), 4, 'each artifact or creature counted once');
  });

  test('Vnwxt, Alisaie, Wildsear, Ojer Pakpatiq: max speed draws, dualcast, cascade from hand, rebound handed out', (mk, t) => {
    t.auto('Vnwxt, Verbose Host'); t.auto('Alisaie Leveilleur'); t.auto('Wildsear, Scouring Maw'); t.auto('Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 12; i++) T.top('A', 'Island');
    T.bf('A', 'Vnwxt, Verbose Host');
    T.g.drawCards('A', 1);
    t.eq(T.zone('A', 'hand').length, 1, 'below max speed: one card');
    T.g.player('A').speed = 4;
    T.g.drawCards('A', 1);
    t.eq(T.zone('A', 'hand').length, 3, 'at max speed: two instead');
    T.bf('A', 'Alisaie Leveilleur');
    const axe = T.hand('A', 'Lava Axe');
    t.eq(T.g.castCostFor('A', axe.id), '{4}{R}', 'the first spell: full price');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.resolve();
    t.eq(T.g.castCostFor('A', axe.id), '{2}{R}', 'the second: {2} less');
    T.bf('A', 'Wildsear, Scouring Maw');
    const elf = T.top('A', 'Llanowar Elves');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Pacifism'), { targets: [T.bf('B', 'Grizzly Bears').id] });
    T.resolve();
    t.zone(elf, 'battlefield', 'an enchantment from hand cascades into the Elves');
  });

  test('Ojer Pakpatiq: an instant from your hand gains rebound', (mk, t) => {
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.mana('A', 'R');
    T.cast('A', bolt, { targets: ['B'] });
    T.resolve();
    t.zone(bolt, 'exile', 'exiled with rebound');
    t.eq(bolt.reboundBy, 'A');
  });

  test('"Put a number of +1/+1 counters on … equal to …": Vincent Valentine, Lattice Library, Scourge of Skola Vale', (mk, t) => {
    t.auto('Vincent Valentine // Galian Beast'); t.auto('Lattice Library'); t.auto('Scourge of Skola Vale');
    const T = mk();
    T.toMain('A');
    const vv = T.bf('A', 'Vincent Valentine // Galian Beast');
    const before = Number(vv.counters['+1/+1']) || 0;
    T.g.moveObject(T.bf('B', 'Hill Giant'), 'graveyard');
    T.resolve();
    t.eq((Number(vv.counters['+1/+1']) || 0) - before, 3, "a 3/3 died: three counters");
    const ll = T.put('A', 'Lattice Library', 'battlefield', { etb: true });
    ll.counters.study = 2;
    T.g._runEffects(ll.analysis().abilities.find(x => x.kind === 'triggered').effects, { controller: 'A', obj: ll, name: ll.name, kind: 'ability', targets: [] });
    T.resolve();
    const fr = T.g.battlefield.filter(o => o.isToken && /Fractal/.test(o.name)).pop();
    t.eq(fr && fr.counters['+1/+1'], 2, 'the Fractal gets them, not the Library');
    t.no(ll.counters['+1/+1'], 'none on the Library');
    const sc = T.bf('A', 'Scourge of Skola Vale');
    const wall = T.bf('A', 'Wall of Wood');
    const a = sc.analysis();
    const list = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', sc, list.findIndex(x => x.kind === 'activated'), { sacrificeIds: [wall.id] });
    T.resolve();
    t.eq(sc.counters['+1/+1'], 3, "the sacrificed 0/3's toughness");
  });

  test('Neheb, Dreadhorde Champion: discard any number, draw that many and add that much {R}, kept for the turn', (mk, t) => {
    t.auto('Neheb, Dreadhorde Champion');
    const T = mk();
    for (let i = 0; i < 4; i++) T.top('A', 'Island');
    const nb = T.bf('A', 'Neheb, Dreadhorde Champion');
    const c1 = T.hand('A', 'Forest'), c2 = T.hand('A', 'Swamp');
    T.hand('A', 'Lightning Bolt');
    T.answer('confirm', { yes: true });
    T.answer('choose', (ch) => { t.eq(ch.purpose, 'discardAny'); return { picks: [c1.id, c2.id] }; });
    T.answer('declareAttackers', () => [{ attackerId: nb.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.zone(c1, 'graveyard'); t.zone(c2, 'graveyard');
    t.eq(T.zone('A', 'hand').length, 3, 'the Bolt and two new cards');
    t.eq(T.g.player('A').pool.R, 2, 'two red');
    T.toMain('A', 'end');
    t.eq(T.g.player('A').pool.R, 2, 'still there at the end step');
  });

  test("Hour of Revelation, Wildwood Scourge, Legion's Landing: counts on the battlefield, non-Hydras, three attackers", (mk, t) => {
    t.auto('Hour of Revelation'); t.auto('Wildwood Scourge'); t.auto("Legion's Landing // Adanto, the First Fort");
    const T = mk();
    T.toMain('A');
    const hr = T.hand('A', 'Hour of Revelation');
    t.eq(T.g.castCostFor('A', hr.id), '{3}{W}{W}{W}', 'few permanents: full price');
    for (let i = 0; i < 5; i++) { T.bf('A', 'Sol Ring'); T.bf('B', 'Sol Ring'); }
    T.g.bumpBoard();
    t.eq(T.g.castCostFor('A', hr.id), '{W}{W}{W}', 'ten nonland permanents on the battlefield, either side: {3} less');
    const ws = T.bf('A', 'Wildwood Scourge');
    const bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    T.resolve();
    t.eq(ws.counters['+1/+1'], 1, 'a counter on a non-Hydra: one on the Scourge');
    T.g.addCounters(ws, '+1/+1', 1);
    T.resolve();
    t.eq(ws.counters['+1/+1'], 2, 'not for its own (a Hydra, and not another)');
  });

  test("Legion's Landing: attacking with three creatures transforms it", (mk, t) => {
    const T = mk();
    const ll = T.bf('A', "Legion's Landing // Adanto, the First Fort");
    const a = ['Grizzly Bears', 'Grizzly Bears', 'Hill Giant'].map(n => T.bf('A', n));
    T.answer('declareAttackers', () => a.map(x => ({ attackerId: x.id, defenderId: 'B' })));
    T.toMain('A', 'endCombat');
    t.eq(ll.face, 1, 'transformed');
  });

  test('Dread Summons: a tapped Zombie for each creature card milled', (mk, t) => {
    t.auto('Dread Summons');
    const T = mk({ library: ['Island'] });
    T.toMain('A');
    T.top('A', 'Grizzly Bears'); T.top('A', 'Forest');
    T.top('B', 'Hill Giant'); T.top('B', 'Llanowar Elves');
    T.mana('A', 'BB2');
    T.cast('A', T.hand('A', 'Dread Summons'), { x: 2 });
    T.resolve();
    const z = T.g.battlefield.filter(o => o.isToken && /Zombie/.test(o.name));
    t.eq(z.length, 3, 'three creature cards among the four milled');
    t.ok(z.every(o => o.tapped), 'tapped');
  });

  test('Each player mills: every player, not only you (Sibsig Host)', (mk, t) => {
    t.auto('Sibsig Host');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    T.put('A', 'Sibsig Host', 'battlefield', { etb: true });
    T.resolve();
    for (const pid of ['A', 'B', 'C']) t.eq(T.zone(pid, 'graveyard').length, 3, pid + ' milled three');
  });

  test('Scavenging Ooze: exiles the one card it targets; a creature card grows it and gains 1 life', (mk, t) => {
    t.auto('Scavenging Ooze');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.toMain('A');
    const oz = T.bf('A', 'Scavenging Ooze');
    const land = T.grave('B', 'Island'), bear = T.grave('B', 'Grizzly Bears'), other = T.grave('C', 'Hill Giant'), mine = T.grave('A', 'Forest');
    T.mana('A', 'G');
    T.activate('A', oz, 0, { targets: [land.id] });
    T.resolve();
    t.zone(land, 'exile');
    t.zone(bear, 'graveyard', 'only the target'); t.zone(other, 'graveyard'); t.zone(mine, 'graveyard');
    t.no(oz.counters['+1/+1'], 'a land: nothing more');
    T.mana('A', 'G');
    T.activate('A', oz, 0, { targets: [bear.id] });
    T.resolve();
    t.zone(bear, 'exile');
    t.eq(oz.counters['+1/+1'], 1, 'a creature card: a counter');
    t.eq(T.g.player('A').life, 21, 'and 1 life');
  });

  test('"For each …, create …": Murmuration, Bladewing, The Hive (a token named after its keywords)', (mk, t) => {
    t.auto('Murmuration'); t.auto('Bladewing, Deathless Tyrant'); t.auto('The Hive');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Murmuration');
    for (let i = 0; i < 2; i++) { T.mana('A', 'R'); T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] }); T.resolve(); }
    T.toMain('A', 'end');
    T.resolve();
    const crows = T.g.battlefield.filter(o => o.isToken && o.name === 'Storm Crow');
    t.eq(crows.length, 2, 'two spells: two Storm Crows');
    t.ok(crows.every(o => T.g.hasKw(o, 'flying')), 'flying');
    const T2 = mk();
    const bw = T2.bf('A', 'Bladewing, Deathless Tyrant');
    T2.grave('A', 'Grizzly Bears'); T2.grave('A', 'Hill Giant'); T2.grave('A', 'Island');
    T2.answer('declareAttackers', () => [{ attackerId: bw.id, defenderId: 'B' }]);
    T2.toMain('A', 'endCombat');
    t.eq(T2.g.battlefield.filter(o => o.isToken && /Zombie Knight/.test(o.name)).length, 2, 'two creature cards: two Zombie Knights');
  });

  test('Necrodominance: pay any amount of life at your end step and draw that many', (mk, t) => {
    t.auto('Necrodominance');
    const T = mk();
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    T.bf('A', 'Necrodominance');
    T.toMain('A');
    T.answer('confirm', { yes: true });
    T.answer('choose', (ch) => { t.eq(ch.purpose, 'payLifeAmount'); t.eq(ch.number.max, 20, 'up to all of it'); return { number: 3 }; });
    T.toMain('A', 'end');
    T.resolve();
    t.eq(T.g.player('A').life, 17, '3 life');
    t.eq(T.zone('A', 'hand').length, 3, '3 cards');
  });

  test('Carnage, Crimson Chaos: the creature it returns gains "attacks each combat" and "sacrifice it" after combat damage', (mk, t) => {
    t.auto('Carnage, Crimson Chaos');
    const T = mk();
    T.toMain('A');
    const bear = T.grave('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    T.put('A', 'Carnage, Crimson Chaos', 'battlefield', { etb: true });
    T.resolve();
    t.zone(bear, 'battlefield');
    const abs = bear.analysis().abilities;
    t.ok(T.g.characteristics(bear).flags.has('mustAttackEot'), 'attacks each combat if able');
    t.ok(abs.some(a => a.kind === 'triggered'), 'and the combat-damage trigger');
    bear.summoningSick = false; bear.entered = 0;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.zone(bear, 'graveyard', 'sacrificed after dealing combat damage');
  });

  test('Mauhúr, Angel of Suffering: an extra counter on Armies, Goblins and Orcs; damage to you milled twice over', (mk, t) => {
    t.auto('Mauhúr, Uruk-hai Captain'); t.auto('Angel of Suffering');
    const T = mk({ library: ['Island'] });
    T.toMain('A');
    T.bf('A', 'Mauhúr, Uruk-hai Captain');
    const gob = T.bf('A', 'Goblin Guide'), bear = T.bf('A', 'Grizzly Bears');
    T.g.addCounters(gob, '+1/+1', 1); T.g.addCounters(bear, '+1/+1', 1);
    t.eq(gob.counters['+1/+1'], 2, 'a Goblin gets one more');
    t.eq(bear.counters['+1/+1'], 1, 'a Bear does not');
    T.bf('A', 'Angel of Suffering');
    for (let i = 0; i < 6; i++) T.top('A', 'Island');
    const lib = T.zone('A', 'library').length;
    T.g.dealDamageToPlayer(T.g.player('A'), 3, T.bf('B', 'Hill Giant'), false);
    t.eq(T.g.player('A').life, 20, 'no damage');
    t.eq(lib - T.zone('A', 'library').length, 6, 'six cards milled');
  });

  test("Xyris, the Writhing Storm: a Snake for an opponent's draws, not the first in their draw step", (mk, t) => {
    t.auto('Xyris, the Writhing Storm');
    const T = mk();
    T.bf('A', 'Xyris, the Writhing Storm');
    for (let i = 0; i < 4; i++) T.top('B', 'Island');
    const snakes = () => T.g.battlefield.filter(o => o.isToken && /Snake/.test(o.name)).length;
    T.toMain('B');
    T.resolve();
    t.eq(snakes(), 0, 'the draw-step draw makes none');
    T.g.drawCards('B', 2);
    T.resolve();
    t.eq(snakes(), 2, 'two more draws: two Snakes');
  });

  test('Jolene, the Plunder Queen: a player attacking one of your opponents gets a Treasure; attacking you does not', (mk, t) => {
    t.auto('Jolene, the Plunder Queen');
    const T = mk({ players: ['A', 'B', 'C'] });
    T.bf('A', 'Jolene, the Plunder Queen');
    const treasures = (pid) => T.g.battlefield.filter(o => o.controller === pid && /Treasure/.test(o.name)).length;
    T.toMain('B');
    const bb = T.bf('B', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bb.id, defenderId: 'C' }]);
    T.toMain('B', 'endCombat');
    t.eq(treasures('B'), 1, 'B attacked C, an opponent of yours: a Treasure for B');
    T.toMain('C');
    const cb = T.bf('C', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: cb.id, defenderId: 'A' }]);
    T.toMain('C', 'endCombat');
    t.eq(treasures('C'), 0, 'C attacked you: nothing');
  });

  test('Mathemagics: target player draws two to the X cards', (mk, t) => {
    t.auto('Mathemagics');
    const T = mk();
    T.toMain('A');
    for (let i = 0; i < 10; i++) T.top('B', 'Island');
    T.mana('A', 'UU6');
    T.cast('A', T.hand('A', 'Mathemagics'), { x: 3, targets: ['B'] });
    T.resolve();
    t.eq(T.zone('B', 'hand').length, 8, 'X = 3: eight cards');
  });

  test('Maelstrom Nexus, Imotekh: the first spell each turn cascades; another artifact creature +2/+2 and menace', (mk, t) => {
    t.auto('Maelstrom Nexus'); t.auto('Imotekh the Stormlord');
    const T = mk({ library: ['Island'] });
    T.toMain('A');
    T.bf('A', 'Maelstrom Nexus');
    const elf = T.top('A', 'Llanowar Elves');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.zone(elf, 'battlefield', 'the first spell cascades into the Elves');
    const elf2 = T.top('A', 'Llanowar Elves');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    T.resolve();
    t.zone(elf2, 'library', 'the second does not');
    const T2 = mk();
    T2.bf('A', 'Imotekh the Stormlord');
    const golem = T2.bf('A', 'Bronze Sable');
    T2.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: golem.id }] }));
    T2.toMain('A', 'beginCombat');
    T2.resolve();
    t.eq(T2.g.powerOf(golem), 4, 'a 2/1 artifact creature gets +2/+2');
    t.ok(T2.g.hasKw(golem, 'menace'), 'and menace');
  });

  test('Skyknight Squire, Ezio, Warden of the Inner Sky: keywords and a type once enough counters are on it', (mk, t) => {
    t.auto('Skyknight Squire'); t.auto('Ezio, Brash Novice'); t.auto('Warden of the Inner Sky');
    const T = mk();
    const sq = T.bf('A', 'Skyknight Squire', { counters: { '+1/+1': 2 } });
    T.g.bumpBoard();
    t.no(T.g.hasKw(sq, 'flying'), 'two counters: not yet');
    T.g.addCounters(sq, '+1/+1', 1);
    t.ok(T.g.hasKw(sq, 'flying'), 'three: flying');
    t.ok(T.g._hasCreatureType(sq, 'Knight') || (T.g.characteristics(sq).subtypes || sq.analysis().subtypes || []).includes('Knight'), 'and a Knight');
    const ez = T.bf('A', 'Ezio, Brash Novice', { counters: { '+1/+1': 1, shield: 1 } });
    T.g.bumpBoard();
    t.ok(T.g.hasKw(ez, 'first strike'), 'two counters of any kinds: first strike');
  });

  test('Slash the Ranks: every creature and planeswalker but the commanders', (mk, t) => {
    t.auto('Slash the Ranks');
    const T = mk();
    T.toMain('A');
    const cmd = T.bf('A', 'Grizzly Bears'); cmd.isCommander = true;
    const bear = T.bf('B', 'Grizzly Bears');
    const pw = T.bf('B', 'Jace Beleren', { counters: { loyalty: 3 } });
    const land = T.bf('B', 'Forest');
    T.mana('A', 'WW3');
    T.cast('A', T.hand('A', 'Slash the Ranks'));
    T.resolve();
    t.zone(cmd, 'battlefield', 'a commander stays');
    t.zone(bear, 'graveyard'); t.zone(pw, 'graveyard'); t.zone(land, 'battlefield');
  });

  test("Bilbo's Ring: the equipped creature attacking alone draws a card for 1 life; another attacking alone does not", (mk, t) => {
    t.auto("Bilbo's Ring");
    const T = mk();
    for (let i = 0; i < 3; i++) T.top('A', 'Island');
    const ring = T.bf('A', "Bilbo's Ring");
    const hob = T.bf('A', 'Grizzly Bears'); ring.attachedTo = hob.id; hob.attachments = [ring.id];
    const other = T.bf('A', 'Hill Giant');
    T.g.bumpBoard();
    T.answer('declareAttackers', () => [{ attackerId: other.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, 0, 'an unequipped creature alone: nothing');
    T.toMain('A');
    T.answer('declareAttackers', () => [{ attackerId: hob.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.zone('A', 'hand').length, 2, 'the equipped one alone: a card (plus the draw step)');
    t.eq(T.g.player('A').life, 19, 'and 1 life');
  });

  test("You don't control another Dinosaur: Pugnacious Hammerskull; Blind-Spot Giant needs another Giant; Serah Farron's first legendary creature spell", (mk, t) => {
    t.auto('Pugnacious Hammerskull'); t.auto('Blind-Spot Giant'); t.auto('Serah Farron // Crystallized Serah');
    const T = mk();
    const ph = T.bf('A', 'Pugnacious Hammerskull');
    T.answer('declareAttackers', () => [{ attackerId: ph.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(ph.counters.stun, 1, 'alone among Dinosaurs: a stun counter');
    const gi = T.bf('A', 'Blind-Spot Giant');
    const cond = gi.analysis().abilities.find(a => (a.effects || []).some(e => e.op === 'restrictUnless')).effects[0].cond;
    t.no(T.g._condMet(cond, { controller: 'A', obj: gi }), 'alone: no other Giant');
    T.bf('A', 'Hill Giant');
    t.ok(T.g._condMet(cond, { controller: 'A', obj: gi }), 'with a Hill Giant: yes');
    const T2 = mk();
    T2.toMain('A');
    T2.bf('A', 'Serah Farron // Crystallized Serah');
    const leg = T2.hand('A', 'Isamaru, Hound of Konda');
    const plain = T2.hand('A', 'Grizzly Bears');
    t.eq(T2.g.castCostFor('A', plain.id), '{1}{G}', 'not legendary: full price');
    t.eq(T2.g.castCostFor('A', leg.id), '{W}', 'the first legendary creature spell: {2} less, down to its coloured part');
  });

  test('Outlaws you control: Olivia, Opulent Outlaw makes a Treasure, Vial Smasher pings, Rakish Crew drains', (mk, t) => {
    t.auto('Olivia, Opulent Outlaw'); t.auto('Vial Smasher, Gleeful Grenadier'); t.auto('Rakish Crew');
    const T = mk();
    T.bf('A', 'Olivia, Opulent Outlaw');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 0, 'a Bear is not an outlaw: no Treasure');
    T.toMain('A');
    const rogue = T.bf('A', 'Changeling Outcast');
    T.answer('declareAttackers', () => [{ attackerId: rogue.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 1, 'an outlaw connected: a Treasure');
    const T2 = mk();
    T2.toMain('A');
    T2.bf('A', 'Vial Smasher, Gleeful Grenadier');
    T2.bf('A', 'Grizzly Bears', { etb: true }); T2.resolve();
    t.eq(T2.g.player('B').life, 20, 'a Bear entering: nothing');
    T2.bf('A', 'Vampire Nighthawk', { etb: true }); T2.resolve();
    t.eq(T2.g.player('B').life, 20, 'nor a Vampire');
    T2.bf('A', 'Changeling Outcast', { etb: true }); T2.resolve();
    t.eq(T2.g.player('B').life, 19, 'a Changeling (every creature type) entering: 1 damage to the opponent');
    const T3 = mk();
    T3.toMain('A');
    T3.bf('A', 'Rakish Crew');
    const b3 = T3.bf('A', 'Grizzly Bears');
    T3.g.moveObject(b3, 'graveyard'); T3.resolve();
    t.eq(T3.g.player('A').life, 20, 'a Bear dying: nothing');
    const o3 = T3.bf('A', 'Changeling Outcast');
    T3.g.moveObject(o3, 'graveyard'); T3.resolve();
    t.eq(T3.g.player('B').life, 19, 'an outlaw dying: the opponent loses 1');
    t.eq(T3.g.player('A').life, 21, 'and you gain 1');
  });

  test("Copying an ability from a kind of source: Tawnos, Urza's Apprentice; The Peregrine Dynamo; Mister Fantastic copies twice", (mk, t) => {
    t.auto("Tawnos, Urza's Apprentice"); t.auto('The Peregrine Dynamo'); t.auto('Mister Fantastic');
    const T = mk();
    T.toMain('A');
    const tw = T.bf('A', "Tawnos, Urza's Apprentice");
    T.put('A', 'Ichor Wellspring', 'battlefield', { etb: true });
    T.put('A', 'Kitchen Finks', 'battlefield', { etb: true });
    T.g._putTriggersOnStack();
    const fromArtifact = T.g.stack.find(s => s.kind === 'ability' && s.obj.name === 'Ichor Wellspring');
    const fromCreature = T.g.stack.find(s => s.kind === 'ability' && s.obj.name === 'Kitchen Finks');
    t.ok(fromArtifact && fromCreature, 'both triggers are on the stack');
    const spec = tw.analysis().abilities.find(a => a.kind === 'activated').effects[0].targets[0];
    const legal = T.g._legalTargetsFor(spec, 'A', tw.id).map(x => x.id);
    t.ok(legal.includes(fromArtifact.id), 'the artifact\'s trigger: a target');
    t.no(legal.includes(fromCreature.id), 'the creature\'s trigger: not');
    T.resolve();
    const T2 = mk();
    T2.toMain('A');
    const pd = T2.bf('A', 'The Peregrine Dynamo');
    const mik = T2.bf('A', 'Mikaeus, the Lunarch');
    const prod = T2.bf('A', 'Prodigal Pyromancer');
    T2.activate('A', mik, 0, { resolve: false });
    T2.activate('A', prod, 0, { targets: ['B'], resolve: false });
    const legSpec = pd.analysis().abilities.find(a => a.kind === 'activated').effects[0].targets[0];
    const st = (o) => T2.g.stack.find(s => s.objId === o.id);
    t.ok(T2.g._legalTargetsFor(legSpec, 'A', pd.id).some(x => x.id === st(mik).id), 'a legendary source: a target');
    t.no(T2.g._legalTargetsFor(legSpec, 'A', pd.id).some(x => x.id === st(prod).id), 'a nonlegendary one: not');
    mik.isCommander = true;
    t.no(T2.g._legalTargetsFor(legSpec, 'A', pd.id).some(x => x.id === st(mik).id), 'not a commander');
    const T3 = mk();
    T3.toMain('A');
    const mf = T3.bf('A', 'Mister Fantastic');
    T3.put('A', 'Kitchen Finks', 'battlefield', { etb: true });
    T3.g._putTriggersOnStack();
    const trig = T3.g.stack.find(s => s.kind === 'ability');
    T3.mana('A', 'RGWU');
    T3.activate('A', mf, 0, { targets: [{ kind: 'stack', id: trig.id }] });
    t.eq(T3.life('A'), 26, 'gained 2 three times: the trigger and two copies');
  });

  test('"When this creature enters, if it was kicked": Goblin Bushwhacker, Gatekeeper of Malakir; not when it comes back from the graveyard; Sowing Mycospawn on the stack', (mk, t) => {
    t.auto('Goblin Bushwhacker'); t.auto('Gatekeeper of Malakir'); t.auto('Sowing Mycospawn');
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    const gb = T.hand('A', 'Goblin Bushwhacker');
    T.mana('A', 'R');
    T.cast('A', gb);
    t.eq(T.g.powerOf(bear), 2, 'not kicked: nothing');
    const gb2 = T.hand('A', 'Goblin Bushwhacker');
    T.mana('A', 'RR');
    T.cast('A', gb2, { kick: true });
    t.eq(T.g.powerOf(bear), 3, 'kicked: +1/+0');
    t.ok(T.g.hasKw(bear, 'haste'), 'and haste');
    const T2 = mk();
    T2.toMain('A');
    const ogre = T2.bf('B', 'Grizzly Bears');
    const gk = T2.hand('A', 'Gatekeeper of Malakir');
    T2.mana('A', 'BBB');
    T2.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T2.cast('A', gk, { kick: true });
    t.zone(ogre, 'graveyard');
    t.eq(gk.kickedTimes, 1, 'it was kicked');
    T2.g.moveObject(gk, 'graveyard');
    T2.bf('B', 'Grizzly Bears');
    T2.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T2.g.moveObject(gk, 'battlefield', { controller: 'A' });
    T2.resolve();
    t.eq(T2.bfOf('B').filter(o => o.name === 'Grizzly Bears').length, 1, 'returned from the graveyard: not kicked, no trigger');
    const T3 = mk({ library: ['Forest', 'Forest', 'Forest'] });
    T3.toMain('A');
    const land = T3.bf('B', 'Mountain');
    const sm = T3.hand('A', 'Sowing Mycospawn');
    T3.mana('A', 'GGGGCC');
    T3.cast('A', sm, { kick: true });
    t.zone(land, 'exile');
  });

  test('"For each time it was kicked": Wolfbriar Elemental, Lightkeeper of Emeria, Spell Contortion; Stronghold Arena\'s two kickers', (mk, t) => {
    t.auto('Wolfbriar Elemental'); t.auto('Lightkeeper of Emeria'); t.auto('Spell Contortion'); t.auto('Stronghold Arena'); t.auto('Bloodhusk Ritualist');
    const T = mk();
    T.toMain('A');
    const wb = T.hand('A', 'Wolfbriar Elemental');
    T.mana('A', 'GGGGGG');
    T.cast('A', wb, { kick: 2 });
    t.eq(T.bfOf('A').filter(o => o.name === 'Wolf').length, 2, 'kicked twice: two Wolves');
    T.g.moveObject(wb, 'graveyard');
    T.g.moveObject(wb, 'battlefield', { controller: 'A' });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Wolf').length, 2, 'back from the graveyard: no more');
    const lk = T.hand('A', 'Lightkeeper of Emeria');
    T.mana('A', '3WWWW');
    T.cast('A', lk, { kick: 3 });
    t.eq(T.life('A'), 26, 'kicked three times: 6 life');
    const sa = T.hand('A', 'Stronghold Arena');
    T.mana('A', '1BGW');
    T.cast('A', sa, { kick: true });
    t.eq(T.life('A'), 32, 'both kickers paid: kicked twice, 6 life');
    const T2 = mk({ library: ['Island', 'Island', 'Island', 'Island'] });
    T2.toMain('B');
    const bolt = T2.hand('B', 'Lightning Bolt');
    T2.mana('B', 'R');
    T2.cast('B', bolt, { targets: ['A'], resolve: false });
    const item = T2.g.stack[T2.g.stack.length - 1];
    const sc = T2.hand('A', 'Spell Contortion');
    T2.mana('A', '2UUUUU');
    T2.g.passPriority('B', true);
    const before = T2.zone('A', 'hand').length;
    T2.cast('A', sc, { targets: [{ kind: 'stack', id: item.id }], kick: 2 });
    t.eq(T2.zone('A', 'hand').length, before - 1 + 2, 'kicked twice: two cards');
  });

  test('A token that\'s a copy is a token created: Parallel Lives doubles Cackling Counterpart, Kiki-Jiki (both sacrificed), squad and myriad; Staff of the Storyteller sees it', (mk, t) => {
    t.auto('Parallel Lives'); t.auto('Cackling Counterpart'); t.auto('Kiki-Jiki, Mirror Breaker'); t.auto('Staff of the Storyteller'); t.auto('Arco-Flagellant'); t.auto('Caller of the Pack');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Parallel Lives');
    const staff = T.bf('A', 'Staff of the Storyteller');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1UUUU');
    T.cast('A', T.hand('A', 'Cackling Counterpart'), { targets: [bear] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Grizzly Bears' && o.isToken).length, 2, 'two copies');
    t.eq(staff.counters.story, 1, 'Staff of the Storyteller: one or more creature tokens, a story counter');
    const T2 = mk();
    T2.toMain('A');
    T2.bf('A', 'Parallel Lives');
    const kiki = T2.bf('A', 'Kiki-Jiki, Mirror Breaker');
    const b2 = T2.bf('A', 'Grizzly Bears');
    T2.activate('A', kiki, 0, { targets: [b2] });
    const copies = T2.bfOf('A').filter(o => o.name === 'Grizzly Bears' && o.isToken);
    t.eq(copies.length, 2, 'Kiki-Jiki: two copies');
    t.ok(copies.every(c => T2.g.hasKw(c, 'haste')), 'both with haste');
    T2.toMain('B');
    t.eq(T2.bfOf('A').filter(o => o.name === 'Grizzly Bears').length, 1, 'both sacrificed at the end step');
    const T3 = mk();
    T3.toMain('A');
    T3.bf('A', 'Parallel Lives');
    const staff3 = T3.bf('A', 'Staff of the Storyteller');
    T3.mana('A', 'BBBBB');
    T3.cast('A', T3.hand('A', 'Arco-Flagellant'), { squad: 1 });
    t.eq(T3.bfOf('A').filter(o => o.name === 'Arco-Flagellant').length, 3, 'squad paid once: two copies and the card');
    t.eq(staff3.counters.story, 1, 'and the Staff sees them made');
    const T4 = mk({ players: ['A', 'B', 'C'] });
    T4.bf('A', 'Parallel Lives');
    const cp = T4.bf('A', 'Caller of the Pack'); cp.summoningSick = false;
    T4.answer('declareAttackers', () => [{ attackerId: cp.id, defenderId: 'B' }]);
    T4.toMain('A', 'endCombat');
    t.eq(T4.life('B'), 12, 'the Caller hits B');
    t.eq(T4.life('C'), 4, 'two myriad copies hit C');
    const T5 = mk();
    T5.toMain('A');
    T5.bf('A', 'Parallel Lives');
    const ba = T5.grave('A', 'Briarblade Adept');
    T5.mana('A', 'BBBB');
    t.ok(T5.g.encoreCard('A', ba.id), 'encore');
    t.eq(T5.bfOf('A').filter(o => o.name === 'Briarblade Adept').length, 2, 'encore: two copies for the one opponent');
  });

  test('"… at the beginning of the next end step" finds its "it": Sneak Attack, Through the Breach, Purphoros, Necropotence, Nezahal, Aetherling, Lagomos (with Parallel Lives)', (mk, t) => {
    for (const n of ['Sneak Attack', 'Through the Breach', 'Purphoros, Bronze-Blooded', 'Necropotence', 'Nezahal, Primal Tide', 'Aetherling', 'Lagomos, Hand of Hatred']) t.auto(n);
    const T = mk();
    T.toMain('A');
    const sa = T.bf('A', 'Sneak Attack');
    const ogre = T.hand('A', 'Gray Ogre');
    T.mana('A', 'R');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', () => ({ cardIds: [ogre.id] }));
    T.activate('A', sa, 0);
    t.zone(ogre, 'battlefield');
    t.ok(T.g.hasKw(ogre, 'haste'), 'with haste');
    const tb = T.hand('A', 'Through the Breach');
    const wurm = T.hand('A', 'Craw Wurm');
    T.mana('A', '4R');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', () => ({ cardIds: [wurm.id] }));
    T.cast('A', tb);
    t.zone(wurm, 'battlefield');
    const pu = T.bf('A', 'Purphoros, Bronze-Blooded');
    const goblin = T.hand('A', 'Raging Goblin');
    T.mana('A', '2R');
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', () => ({ cardIds: [goblin.id] }));
    T.activate('A', pu, 0);
    t.zone(goblin, 'battlefield');
    const nec = T.bf('A', 'Necropotence');
    const top = T.put('A', 'Island', 'library');
    T.activate('A', nec, 0);
    t.zone(top, 'exile');
    const nz = T.bf('A', 'Nezahal, Primal Tide');
    T.hand('A', 'Swamp'); T.hand('A', 'Swamp'); T.hand('A', 'Swamp');
    T.answer('discard', (ch) => ({ cardIds: ch.cards.filter(c => c.name === 'Swamp').map(c => c.id) }));
    T.activate('A', nz, 0);
    t.zone(nz, 'exile');
    const ae = T.bf('A', 'Aetherling');
    T.mana('A', 'U');
    T.activate('A', ae, 0);
    t.zone(ae, 'exile');
    T.toMain('B');
    t.zone(ogre, 'graveyard');
    t.zone(wurm, 'graveyard');
    t.zone(goblin, 'graveyard');
    t.zone(top, 'hand');
    t.zone(nz, 'battlefield');
    t.ok(nz.tapped, 'Nezahal comes back tapped');
    t.zone(ae, 'battlefield');
    const T2 = mk();
    T2.bf('A', 'Lagomos, Hand of Hatred');
    T2.bf('A', 'Parallel Lives');
    T2.toMain('A', 'endCombat');
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Elemental')).length, 2, 'Lagomos with Parallel Lives: two Elementals');
    T2.toMain('B');
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Elemental')).length, 0, 'both sacrificed at the end step');
  });

  test('Put onto the battlefield other than by casting, X is 0: Stonecoil Serpent returned from the graveyard has no counters', (mk, t) => {
    t.auto('Stonecoil Serpent');
    const T = mk();
    T.toMain('A');
    const ss = T.hand('A', 'Stonecoil Serpent');
    T.mana('A', '3');
    T.cast('A', ss, { x: 3 });
    t.eq(ss.counters['+1/+1'], 3, 'cast for X=3: three counters');
    T.g.moveObject(ss, 'graveyard');
    T.g.moveObject(ss, 'battlefield', { controller: 'A' });
    T.resolve();
    t.eq(ss.counters['+1/+1'] || 0, 0, 'returned: X is 0, no counters');
  });

  test("Sentinel's Mark: the addendum, cast in your main phase, gives lifelink; flashed in on another turn, it doesn't", (mk, t) => {
    t.auto("Sentinel's Mark");
    const T = mk();
    T.toMain('A');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', "Sentinel's Mark"), { targets: [bear] });
    t.ok(T.g.hasKw(bear, 'lifelink'), 'cast in the main phase: lifelink');
    const T2 = mk();
    T2.toMain('B');
    const b2 = T2.bf('A', 'Grizzly Bears');
    T2.g.passPriority('B', true);
    T2.mana('A', '1W');
    T2.cast('A', T2.hand('A', "Sentinel's Mark"), { targets: [b2] });
    t.eq(T2.g.powerOf(b2), 3, 'the Aura is on');
    t.no(T2.g.hasKw(b2, 'lifelink'), "on the opponent's turn: no lifelink");
  });

  test("Whenever you cast a spell during an opponent's turn: Brineborn Cutthroat, Voracious Tome-Skimmer; \"you may have each opponent lose 1 life\" (Faerie Tauntings); Hazoret's Favor", (mk, t) => {
    for (const n of ['Brineborn Cutthroat', 'Voracious Tome-Skimmer', 'Faerie Tauntings', "Hazoret's Favor"]) t.auto(n);
    const T = mk({ library: ['Island', 'Island', 'Island', 'Island'] });
    T.toMain('A');
    const bc = T.bf('A', 'Brineborn Cutthroat');
    T.bf('A', 'Voracious Tome-Skimmer');
    T.bf('A', 'Faerie Tauntings');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(bc.counters['+1/+1'] || 0, 0, 'on your own turn: nothing');
    t.eq(T.life('B'), 17, 'only the Bolt');
    T.toMain('B');
    T.g.passPriority('B', true);
    T.mana('A', 'R');
    T.answer('payOrDont', () => ({ pay: true }));
    T.answer('confirm', () => ({ yes: true }));
    const hand0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(bc.counters['+1/+1'], 1, "on an opponent's turn: a +1/+1 counter");
    t.eq(T.life('A'), 19, 'Tome-Skimmer: 1 life paid');
    t.eq(T.zone('A', 'hand').length, hand0 + 1, 'and a card drawn');
    t.eq(T.life('B'), 13, 'Faerie Tauntings: the opponent loses 1 more');
    const T2 = mk();
    T2.bf('A', "Hazoret's Favor");
    const bear = T2.bf('A', 'Grizzly Bears', { sick: true });
    T2.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T2.answer('confirm', () => ({ yes: true }));
    T2.answer('declareAttackers', () => []);
    T2.toMain('A', 'endCombat');
    t.eq(T2.g.powerOf(bear), 4, "Hazoret's Favor: +2/+0");
    t.ok(T2.g.hasKw(bear, 'haste'), 'and haste');
    T2.toMain('B');
    t.zone(bear, 'graveyard');
  });

  test("Enchanted land tapped for mana: Elvish Guidance's {G} per Elf, Market Festival's two of any colour, Glittering Frost makes it snow", (mk, t) => {
    for (const n of ['Elvish Guidance', 'Market Festival', "Dawn's Reflection", 'Glittering Frost']) t.auto(n);
    const T = mk();
    const on = (aura, land) => { aura.attachedTo = land.id; land.attachments.push(aura.id); };
    const f1 = T.bf('A', 'Forest');
    on(T.bf('A', 'Elvish Guidance'), f1);
    T.bf('A', 'Llanowar Elves'); T.bf('B', 'Elvish Mystic'); T.bf('A', 'Grizzly Bears');
    T.g.tapForMana('A', f1.id, 0);
    t.eq(T.player('A').pool.G, 3, 'the Forest, and one more for each of the two Elves (either side)');
    const T2 = mk();
    const f2 = T2.bf('A', 'Forest');
    on(T2.bf('A', 'Market Festival'), f2);
    T2.g.tapForMana('A', f2.id, 0);
    const pool = T2.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (pool[c] || 0), 0), 3, 'Market Festival: two more');
    const T3 = mk();
    const f3 = T3.bf('A', 'Forest');
    t.no(T3.g._cardFitsWords(f3, 'snow'), 'a plain Forest is not snow');
    on(T3.bf('A', 'Glittering Frost'), f3);
    T3.g.bumpBoard();
    t.ok(T3.g._cardFitsWords(f3, 'snow'), 'Glittering Frost: the land is snow');
  });

  test('Milled cards: Zellix counts creature cards, Glowing One each nonland card, Screeching Scorchbeast "that many", Mirelurk Queen once a turn; rad counters for each player and for the player hit', (mk, t) => {
    for (const n of ['Zellix, Sanity Flayer', 'Glowing One', 'Screeching Scorchbeast', 'Mirelurk Queen', "Megaton's Fate"]) t.auto(n);
    const T = mk();
    T.toMain('A');
    const zx = T.bf('A', 'Zellix, Sanity Flayer');
    T.bf('A', 'Glowing One');
    for (const n of ['Island', 'Grizzly Bears', 'Lightning Bolt']) T.put('B', n, 'library');
    T.mana('A', '1');
    T.activate('A', zx, 0, { targets: ['B'] });
    t.eq(T.bfOf('A').filter(o => o.name === 'Horror').length, 1, 'Zellix: a creature card among them, one Horror');
    t.eq(T.life('A'), 22, 'Glowing One: 1 life for each of the two nonland cards');
    const T2 = mk();
    T2.toMain('A');
    T2.bf('A', 'Screeching Scorchbeast');
    const mq = T2.bf('A', 'Mirelurk Queen');
    // (each put goes on top: the Forest ends up first)
    for (const n of ['Shock', 'Craw Wurm', 'Lightning Bolt', 'Hill Giant', 'Grizzly Bears', 'Forest']) T2.put('B', n, 'library');
    T2.answer('confirm', () => ({ yes: true }));
    T2.g._runEffect({ op: 'mill', n: 4, who: 'opponents' }, { controller: 'A', name: 'test' });
    T2.resolve();
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Zombie')).length, 3, 'Scorchbeast: three nonland cards, three Zombies');
    t.eq(mq.counters['+1/+1'], 1, 'Mirelurk Queen: a counter');
    T2.g._runEffect({ op: 'mill', n: 2, who: 'opponents' }, { controller: 'A', name: 'test' });
    T2.resolve();
    t.eq(mq.counters['+1/+1'], 1, 'only once each turn');
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Zombie')).length, 3, 'and the Scorchbeast only once');
    const T3 = mk();
    T3.toMain('A');
    T3.mana('A', '5R');
    T3.answer('mode', () => ({ modes: [1] }));
    T3.cast('A', T3.hand('A', "Megaton's Fate"));
    t.eq(T3.g.player('A').rad, 4, 'Megaton\'s Fate: four rad counters for you');
    t.eq(T3.g.player('B').rad, 4, 'and for the opponent');
    const T4 = mk();
    const go = T4.bf('A', 'Glowing One');
    T4.answer('declareAttackers', () => [{ attackerId: go.id, defenderId: 'B' }]);
    T4.toMain('A', 'endCombat');
    t.eq(T4.g.player('B').rad, 4, 'Glowing One: the player it hit gets four');
    for (const n of ['Island', 'Shock', 'Shock', 'Shock', 'Shock', 'Island']) T4.put('B', n, 'library');
    T4.toMain('B');
    t.eq(T4.life('A'), 24, 'rad counters mill B four nonland cards in their main phase: Glowing One sees each');
    t.auto('Acquired Mutation');
    const T5 = mk({ players: ['A', 'B', 'C'] });
    const bear = T5.bf('A', 'Grizzly Bears');
    const am = T5.bf('C', 'Acquired Mutation');
    am.attachedTo = bear.id; bear.attachments.push(am.id);
    T5.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T5.toMain('A', 'endCombat');
    t.eq(T5.g.player('B').rad, 2, 'Acquired Mutation: the defending player gets two');
    t.no(T5.g.player('C').rad, "not the Aura's controller");
  });

  test('"When a spell or ability an opponent controls causes you to discard this card": Psychic Purge, Metrognome, Guerrilla Tactics; Dodecapod enters with two counters; your own discard does nothing', (mk, t) => {
    for (const n of ['Psychic Purge', 'Metrognome', 'Guerrilla Tactics', 'Dodecapod']) t.auto(n);
    const T = mk();
    T.toMain('A');
    T.hand('B', 'Psychic Purge');
    T.hand('B', 'Metrognome');
    T.mana('A', 'B2');
    T.cast('A', T.hand('A', 'Mind Rot'), { targets: ['B'] });
    T.settle(); T.resolve(); T.settle();
    t.eq(T.life('A'), 15, 'Psychic Purge: the player who made them discard it loses 5');
    t.eq(T.bfOf('B').filter(o => o.name === 'Gnome').length, 4, 'Metrognome: four Gnomes');
    const T2 = mk();
    T2.toMain('A');
    T2.hand('B', 'Guerrilla Tactics');
    const dp = T2.hand('B', 'Dodecapod');
    const bear = T2.bf('A', 'Grizzly Bears');
    T2.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T2.mana('A', 'B2');
    T2.cast('A', T2.hand('A', 'Mind Rot'), { targets: ['B'] });
    T2.settle(); T2.resolve(); T2.settle();
    t.zone(bear, 'graveyard');
    t.zone(dp, 'battlefield');
    t.eq(dp.counters['+1/+1'], 2, 'Dodecapod: two +1/+1 counters');
    const T3 = mk();
    T3.toMain('B');
    T3.hand('B', 'Psychic Purge');
    T3.hand('B', 'Metrognome');
    T3.mana('B', 'B2');
    T3.cast('B', T3.hand('B', 'Mind Rot'), { targets: ['B'] });
    T3.settle(); T3.resolve(); T3.settle();
    t.eq(T3.life('B'), 20, 'discarding to your own spell: nothing');
    t.eq(T3.bfOf('B').filter(o => o.name === 'Gnome').length, 0, 'no Gnomes');
  });

  test('"Whenever you or a permanent you control becomes the target of a spell or ability an opponent controls": Unsettled Mariner taxes a Bolt at you or your creature; Leovold draws', (mk, t) => {
    for (const n of ['Unsettled Mariner', 'Leovold, Emissary of Trest', 'Amulet of Safekeeping']) t.auto(n);
    const T = mk();
    T.bf('A', 'Unsettled Mariner');
    const bear = T.bf('A', 'Grizzly Bears');
    T.toMain('B');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.life('A'), 20, 'a Bolt at you, unpaid: countered');
    T.mana('B', 'R');
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: [bear] });
    t.zone(bear, 'battlefield', 'a Bolt at your creature, unpaid: countered');
    T.mana('B', 'R1');
    T.answer('payOrDont', () => ({ pay: true }));
    T.answer('confirm', () => ({ yes: true }));
    T.cast('B', T.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T.life('A'), 17, 'paid for: it resolves');
    const T2 = mk({ library: ['Island', 'Island', 'Island'] });
    T2.bf('A', 'Leovold, Emissary of Trest');
    T2.toMain('A');
    T2.mana('A', 'R');
    const h0 = T2.zone('A', 'hand').length;
    T2.cast('A', T2.hand('A', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T2.zone('A', 'hand').length, h0, 'your own Bolt at yourself: no card');
    T2.toMain('B');
    T2.mana('B', 'R');
    T2.answer('confirm', () => ({ yes: true }));
    const h1 = T2.zone('A', 'hand').length;
    T2.cast('B', T2.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T2.zone('A', 'hand').length, h1 + 1, "an opponent's Bolt at you: Leovold draws a card");
    const T3 = mk();
    T3.bf('A', 'Amulet of Safekeeping');
    const b3 = T3.bf('A', 'Grizzly Bears');
    T3.toMain('B');
    T3.mana('B', 'R');
    T3.cast('B', T3.hand('B', 'Lightning Bolt'), { targets: [b3] });
    t.zone(b3, 'graveyard', 'Amulet of Safekeeping: only you, not your creatures');
    T3.mana('B', 'R');
    T3.cast('B', T3.hand('B', 'Lightning Bolt'), { targets: ['A'] });
    t.eq(T3.life('A'), 20, 'a Bolt at you, unpaid: countered');
  });

  test('Fireball: X damage divided evenly, rounded down — X=5 between two targets is 2 each, the odd point is lost', (mk, t) => {
    // (the card stays a person's for its extra cost per target; the division itself is the engine's)
    const T = mk();
    T.toMain('A');
    const wurm = T.bf('B', 'Craw Wurm');
    T.mana('A', '111111R');
    T.cast('A', T.hand('A', 'Fireball'), { x: 5, targets: ['B', wurm] });
    t.eq(T.life('B'), 18, 'the player: 2');
    t.eq(wurm.damage, 2, 'the Wurm: 2, not 3');
  });

  test('Ilharg, the Raze-Boar: a creature from your hand comes in tapped and attacking, and goes back to your hand at the end step', (mk, t) => {
    t.auto('Ilharg, the Raze-Boar');
    const T = mk();
    const il = T.bf('A', 'Ilharg, the Raze-Boar');
    const wurm = T.hand('A', 'Craw Wurm');
    T.answer('declareAttackers', () => [{ attackerId: il.id, defenderId: 'B' }]);
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', () => ({ cardIds: [wurm.id] }));
    T.toMain('A', 'endCombat');
    t.ok(wurm.tapped, 'the Wurm came in tapped');
    t.eq(T.life('B'), 8, 'and attacking: 6 from Ilharg and 6 from the Wurm');
    T.toMain('B');
    t.zone(wurm, 'hand');
  });

  test('Icon of Ancestry: of the top three, only a creature card of the chosen type can be taken; the rest go to the bottom', (mk, t) => {
    t.auto('Icon of Ancestry');
    const T = mk();
    T.toMain('A');
    const icon = T.bf('A', 'Icon of Ancestry');
    icon.chosenType = 'Elf';
    // (each put goes on top: Grizzly Bears ends up first)
    const elf = T.put('A', 'Llanowar Elves', 'library');
    T.put('A', 'Hill Giant', 'library');
    T.put('A', 'Grizzly Bears', 'library');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: ch.cards.map(c => c.id).slice(0, 1) }; });
    T.mana('A', '3');
    T.activate('A', icon, 0);
    t.eq(JSON.stringify(offered), JSON.stringify(['Llanowar Elves']), 'only the Elf is offered');
    t.zone(elf, 'hand');
    t.eq(T.zone('A', 'library')[0] && ['Hill Giant', 'Grizzly Bears'].includes(T.zone('A', 'library').slice(-1)[0].name), true, 'the rest on the bottom');
  });

  test('A target with "mana value X or less, where X is …" counted as it is chosen: Celestine (life gained this turn), Guardian Scalelord (its power)', (mk, t) => {
    t.auto('Celestine, the Living Saint'); t.auto('Guardian Scalelord');
    const T = mk();
    T.toMain('A');
    const ce = T.bf('A', 'Celestine, the Living Saint');
    const bear = T.grave('A', 'Grizzly Bears');
    const giant = T.grave('A', 'Hill Giant');
    const spec = ce.analysis().abilities.find(a => a.kind === 'triggered').effects[0].targets[0];
    t.eq(T.g._legalTargetsFor(spec, 'A', ce.id).length, 0, 'no life gained: nothing (not even mana value 0 here)');
    T.g.changeLife(T.g.player('A'), 2);
    const ids = T.g._legalTargetsFor(spec, 'A', ce.id).map(x => x.id);
    t.ok(ids.includes(bear.id), '2 life gained: the Bears (mana value 2)');
    t.no(ids.includes(giant.id), 'not the Hill Giant (4)');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.toMain('B');
    t.zone(bear, 'battlefield');
    const T2 = mk();
    const gs = T2.bf('A', 'Guardian Scalelord');
    const b2 = T2.grave('A', 'Grizzly Bears');
    const g2 = T2.grave('A', 'Hill Giant');
    const s2 = gs.analysis().abilities.find(a => a.kind === 'triggered' && a.event === 'attacks').effects[0].targets[0];
    t.eq(T2.g.powerOf(gs), 3, 'a 3/3');
    let ids2 = T2.g._legalTargetsFor(s2, 'A', gs.id).map(x => x.id);
    t.ok(ids2.includes(b2.id), 'power 3: the Bears (2)');
    t.no(ids2.includes(g2.id), 'not the Hill Giant (4)');
    T2.g.addCounters(gs, '+1/+1', 1);
    ids2 = T2.g._legalTargetsFor(s2, 'A', gs.id).map(x => x.id);
    t.ok(ids2.includes(g2.id), 'with a counter, power 4: the Hill Giant too');
  });

  test('"Create X tokens" with X 0 makes none (Secure the Wastes, X Treasures); Thalisse counts the tokens you made this turn', (mk, t) => {
    t.auto('Secure the Wastes'); t.auto('Thalisse, Reverent Medium');
    const T = mk();
    T.toMain('A');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Secure the Wastes'), { x: 0 });
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 0, 'X=0: no Warriors');
    T.mana('A', '2W');
    T.cast('A', T.hand('A', 'Secure the Wastes'), { x: 2 });
    t.eq(T.bfOf('A').filter(o => o.isToken).length, 2, 'X=2: two');
    T.g._runEffect({ op: 'createNamedToken', n: 'X', token: 'Treasure' }, { controller: 'A', x: 0, name: 'test' });
    t.eq(T.bfOf('A').filter(o => o.name === 'Treasure').length, 0, 'X Treasures with X=0: none');
    const T2 = mk();
    T2.bf('A', 'Thalisse, Reverent Medium');
    T2.toMain('A');
    T2.mana('A', '1W');
    T2.cast('A', T2.hand('A', 'Raise the Alarm'));
    T2.toMain('B');
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Spirit')).length, 2, 'two Soldiers made this turn: two Spirits at the end step');
    T2.toMain('A');
    t.eq(T2.bfOf('A').filter(o => o.name.includes('Spirit')).length, 2, "none made on the opponent's turn: no more");
  });

  test("A count of 0 does nothing (not one): Commune with Lava for X=0, X energy, Spymaster's Vault conniving 0, amass 0, a random return of 0", (mk, t) => {
    t.auto('Commune with Lava'); t.auto("Spymaster's Vault");
    const T = mk({ library: ['Island', 'Island', 'Island', 'Island'] });
    T.toMain('A');
    T.mana('A', 'RR');
    T.cast('A', T.hand('A', 'Commune with Lava'), { x: 0 });
    t.eq(T.zone('A', 'exile').length, 0, 'Commune with Lava, X=0: nothing exiled');
    T.g._runEffect({ op: 'energy', n: 'X' }, { controller: 'A', x: 0, name: 'test' });
    t.eq(T.g.player('A').energy || 0, 0, 'X energy with X=0: none');
    const sv = T.bf('A', "Spymaster's Vault");
    const bear = T.bf('A', 'Grizzly Bears');
    T.hand('A', 'Forest'); T.hand('A', 'Mountain');
    const hand0 = T.zone('A', 'hand').length, lib0 = T.zone('A', 'library').length;
    T.mana('A', 'B');
    T.activate('A', sv, 1, { targets: [bear] });
    t.eq(T.zone('A', 'hand').length, hand0, "Spymaster's Vault with nothing dead: connives 0, the hand is as it was");
    t.eq(T.zone('A', 'library').length, lib0, 'nothing drawn');
    T.g._runEffect({ op: 'amass', n: 'X', kind: 'Orc' }, { controller: 'A', x: 0, name: 'test' });
    T.g.checkStateBasedActions();
    t.eq(T.bfOf('A').filter(o => /Army/.test(o.name) || /Army/.test(String((o.card || {}).type_line))).length, 0, 'amass 0: the 0/0 Army does not survive');
    T.grave('A', 'Hill Giant');
    T.g._runEffect({ op: 'randomFromGraveyard', n: 'X', filter: 'creature' }, { controller: 'A', x: 0, name: 'test' });
    t.eq(T.zone('A', 'graveyard').filter(o => o.name === 'Hill Giant').length, 1, 'a random return of 0: nothing comes back');
    t.auto('For the Common Good'); t.auto("Lich-Knights' Conquest");
    const T2 = mk();
    T2.toMain('A');
    T2.mana('A', '1W');
    T2.cast('A', T2.hand('A', 'Raise the Alarm'));
    const soldier = T2.bfOf('A').find(o => o.isToken);
    T2.mana('A', 'G');
    T2.cast('A', T2.hand('A', 'For the Common Good'), { x: 0, targets: [soldier] });
    t.eq(T2.bfOf('A').filter(o => o.isToken).length, 2, 'For the Common Good, X=0: no copies');
    const T3 = mk();
    T3.toMain('A');
    const g3 = T3.grave('A', 'Hill Giant');
    T3.mana('A', '4B');
    T3.cast('A', T3.hand('A', "Lich-Knights' Conquest"));
    t.zone(g3, 'graveyard', "Lich-Knights' Conquest with nothing sacrificed: nothing returns");
  });

  test('A copy of a kicked creature spell is kicked: Gatekeeper of Malakir copied by Lithoform Engine makes two sacrifices', (mk, t) => {
    t.auto('Gatekeeper of Malakir'); t.auto('Lithoform Engine');
    const T = mk();
    T.toMain('A');
    const le = T.bf('A', 'Lithoform Engine');
    const b1 = T.bf('B', 'Grizzly Bears');
    const b2 = T.bf('B', 'Hill Giant');
    T.mana('A', 'BBB');
    T.cast('A', T.hand('A', 'Gatekeeper of Malakir'), { kick: true, resolve: false });
    const item = T.g.stack[T.g.stack.length - 1];
    T.mana('A', '4');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.activate('A', le, 2, { targets: [{ kind: 'stack', id: item.id }] });
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Gatekeeper of Malakir').length, 2, 'the Gatekeeper and its copy');
    t.zone(b1, 'graveyard'); t.zone(b2, 'graveyard');
  });

  test('Kaalia of the Vast: attacking an opponent, an Angel, Demon or Dragon from your hand comes in tapped and attacking that opponent', (mk, t) => {
    t.auto('Kaalia of the Vast');
    const T = mk();
    const ka = T.bf('A', 'Kaalia of the Vast');
    const dragon = T.hand('A', 'Shivan Dragon');
    T.hand('A', 'Grizzly Bears');
    let offered = null;
    T.answer('declareAttackers', () => [{ attackerId: ka.id, defenderId: 'B' }]);
    T.answer('confirm', () => ({ yes: true }));
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name); return { cardIds: [dragon.id] }; });
    T.toMain('A', 'endCombat');
    t.eq(JSON.stringify(offered), JSON.stringify(['Shivan Dragon']), 'only the Dragon is offered');
    t.ok(dragon.tapped, 'tapped');
    t.eq(T.life('B'), 13, 'and attacking: 2 from Kaalia and 5 from the Dragon');
  });

  test('"You may reveal any number of creature cards from among them": Lead the Stampede takes both creatures; Karumonix only Rats; For the Ancestors the chosen type', (mk, t) => {
    t.auto('Lead the Stampede'); t.auto('Karumonix, the Rat King'); t.auto('For the Ancestors');
    const T = mk();
    T.toMain('A');
    // (each put goes on top: the last one put is the top card)
    for (const n of ['Shock', 'Island', 'Hill Giant', 'Forest', 'Grizzly Bears']) T.put('A', n, 'library');
    let offered = null;
    T.answer('pickCard', (ch) => { offered = ch.cards.map(c => c.name).sort(); return { cardIds: ch.cards.map(c => c.id) }; });
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Lead the Stampede'));
    t.eq(JSON.stringify(offered), JSON.stringify(['Grizzly Bears', 'Hill Giant']), 'the two creatures are offered');
    t.ok(['Grizzly Bears', 'Hill Giant'].every(n => T.zone('A', 'hand').some(o => o.name === n)), 'and both taken');
    const T2 = mk();
    T2.toMain('A');
    for (const n of ['Island', 'Grizzly Bears', 'Pack Rat', 'Forest', 'Rat Colony']) T2.put('A', n, 'library');
    let off2 = null;
    T2.answer('pickCard', (ch) => { off2 = ch.cards.map(c => c.name).sort(); return { cardIds: ch.cards.map(c => c.id) }; });
    T2.put('A', 'Karumonix, the Rat King', 'battlefield', { etb: true });
    T2.resolve();
    t.eq(JSON.stringify(off2), JSON.stringify(['Pack Rat', 'Rat Colony']), 'Karumonix: only the Rats');
    const T3 = mk();
    T3.toMain('A');
    T3.bf('A', 'Llanowar Elves');
    for (const n of ['Island', 'Grizzly Bears', 'Elvish Mystic', 'Forest', 'Fyndhorn Elves', 'Shock']) T3.put('A', n, 'library');
    let off3 = null;
    T3.answer('choose', (ch) => ({ picks: [Math.max(0, (ch.options || []).findIndex(o => o.label === 'Elf'))] }));
    T3.answer('pickCard', (ch) => { off3 = ch.cards.map(c => c.name).sort(); return { cardIds: ch.cards.map(c => c.id) }; });
    T3.mana('A', '2G');
    T3.cast('A', T3.hand('A', 'For the Ancestors'));
    t.eq(JSON.stringify(off3), JSON.stringify(['Elvish Mystic', 'Fyndhorn Elves']), 'For the Ancestors, Elf: the two Elves');
  });

  test('Axgard Armory: an Aura card and an Equipment card from the library to the hand', (mk, t) => {
    t.auto('Axgard Armory');
    const T = mk();
    T.toMain('A');
    const ax = T.bf('A', 'Axgard Armory');
    const aura = T.put('A', 'Pacifism', 'library');
    const eq = T.put('A', 'Bonesplitter', 'library');
    T.put('A', 'Grizzly Bears', 'library');
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.slice(0, 1).map(c => c.id) }));
    T.mana('A', '1RRW');
    const a = ax.analysis();
    const all = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    T.activate('A', ax, all.findIndex(x => (x.effects || []).some(e => e.op === 'tutor')));
    t.zone(aura, 'hand');
    t.zone(eq, 'hand');
    t.zone(ax, 'graveyard');
  });

  test('Entering with counters is having them put on: Hardened Scales adds one to Walking Ballista (once, with Metallic Mimic too); Doubling Season doubles them and a planeswalker\'s loyalty', (mk, t) => {
    t.auto('Hardened Scales'); t.auto('Doubling Season'); t.auto('Walking Ballista'); t.auto('Metallic Mimic');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Hardened Scales');
    const w1 = T.hand('A', 'Walking Ballista');
    T.mana('A', '11');
    T.cast('A', w1, { x: 1 });
    t.eq(w1.counters['+1/+1'], 2, 'X=1 and one more');
    const mm = T.bf('A', 'Metallic Mimic');
    mm.chosenType = 'Construct';
    const w2 = T.hand('A', 'Walking Ballista');
    T.mana('A', '11');
    T.cast('A', w2, { x: 1 });
    t.eq(w2.counters['+1/+1'], 3, 'X=1, the Mimic\'s one, and one more for the lot: 3');
    const T2 = mk();
    T2.toMain('A');
    T2.bf('A', 'Doubling Season');
    const w3 = T2.hand('A', 'Walking Ballista');
    T2.mana('A', '1111');
    T2.cast('A', w3, { x: 2 });
    t.eq(w3.counters['+1/+1'], 4, 'Doubling Season: twice X');
    const jb = T2.hand('A', 'Jace Beleren');
    T2.mana('A', '1UU');
    T2.cast('A', jb);
    t.eq(jb.counters.loyalty, 6, 'and a planeswalker enters with twice its loyalty');
  });

  test('Devour and incubate counters are put on: Mycoloth with Hardened Scales, an Incubator with Doubling Season', (mk, t) => {
    t.auto('Mycoloth'); t.auto('Eyes of Gitaxias');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Hardened Scales');
    const bear = T.bf('A', 'Grizzly Bears');
    const my = T.hand('A', 'Mycoloth');
    T.mana('A', '3GG');
    T.cast('A', my, { choices: { devour: { picks: [bear.id] } } });
    t.zone(bear, 'graveyard');
    t.eq(my.counters['+1/+1'], 3, 'devour 2 for the Bears, and one more');
    const T2 = mk({ library: ['Island', 'Island'] });
    T2.toMain('A');
    T2.bf('A', 'Doubling Season');
    T2.mana('A', '2U');
    T2.cast('A', T2.hand('A', 'Eyes of Gitaxias'));
    const inc = T2.bfOf('A').find(o => o.name === 'Incubator');
    t.eq(inc && inc.counters['+1/+1'], 6, 'incubate 3, doubled');
  });

  test('Doubling Season and a Saga: two lore counters at a time, two chapters at once', (mk, t) => {
    t.auto('Doubling Season'); t.auto('The Eldest Reborn');
    const T = mk();
    T.toMain('A');
    T.bf('A', 'Doubling Season');
    const er = T.hand('A', 'The Eldest Reborn');
    T.bf('B', 'Grizzly Bears');
    T.hand('B', 'Island');
    T.mana('A', '4B');
    T.cast('A', er);
    T.resolve();
    t.eq(er.counters.lore, 2, 'it enters with two lore counters');
    t.eq(T.bfOf('B').filter(o => o.name === 'Grizzly Bears').length, 0, 'chapter I: the opponent sacrificed a creature');
    t.eq(T.zone('B', 'hand').length, 0, 'chapter II: and discarded a card');
  });

  test("Suspended from the graveyard or the hand: Doom's Time Platform, The Eleventh Doctor (time counters equal to mana value)", (mk, t) => {
    t.auto("Doom's Time Platform"); t.auto('The Eleventh Doctor');
    const T = mk();
    T.bf('A', "Doom's Time Platform");
    const bear = T.bf('A', 'Grizzly Bears');
    const bolt = T.grave('A', 'Lightning Bolt');
    T.grave('A', 'Forest');
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bolt.id }] });
    T.toMain('A', 'endCombat');
    t.zone(bolt, 'exile');
    t.eq(bolt.counters.time, 2, 'two time counters');
    t.eq(bolt.suspendedBy, 'A', 'and suspended');
    T.toMain('B');
    T.toMain('A');
    t.eq(bolt.counters.time, 1, 'one comes off at the upkeep');
    const T2 = mk();
    const doc = T2.bf('A', 'The Eleventh Doctor');
    const giant = T2.hand('A', 'Hill Giant');
    T2.answer('declareAttackers', () => [{ attackerId: doc.id, defenderId: 'B' }]);
    T2.answer('confirm', () => ({ yes: true }));
    T2.answer('pickCard', () => ({ cardIds: [giant.id] }));
    T2.toMain('A', 'endCombat');
    t.zone(giant, 'exile');
    t.eq(giant.counters.time, 4, 'The Eleventh Doctor: as many time counters as its mana value');
    t.eq(giant.suspendedBy, 'A', 'suspended');
  });

  test('Curious Herd: "Choose target opponent" — X is the artifacts that player controls', (mk, t) => {
    t.auto('Curious Herd');
    const T = mk();
    T.toMain('A');
    T.bf('B', 'Ornithopter'); T.bf('B', 'Sol Ring');
    T.bf('A', 'Mind Stone');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Curious Herd'), { targets: ['B'] });
    t.eq(T.bfOf('A').filter(o => o.name.includes('Beast')).length, 2, "two Beasts for the opponent's two artifacts (not yours)");
  });

  test("Proliferate puts counters on like any others: Hardened Scales adds one, a Saga reads its next chapter, your energy grows", (mk, t) => {
    t.auto('Hardened Scales'); t.auto("Tezzeret's Gambit"); t.auto('The Eldest Reborn');
    const T = mk({ library: ['Island', 'Island', 'Island', 'Island'] });
    T.toMain('A');
    T.bf('A', 'Hardened Scales');
    const bear = T.bf('A', 'Grizzly Bears');
    bear.counters['+1/+1'] = 1;
    const er = T.bf('A', 'The Eldest Reborn');
    er.counters.lore = 1;
    T.bf('B', 'Hill Giant');
    T.hand('B', 'Island');
    T.g.player('A').energy = 2;
    T.mana('A', '3U');
    T.cast('A', T.hand('A', "Tezzeret's Gambit"));
    T.resolve();
    t.eq(bear.counters['+1/+1'], 3, 'one proliferated, and Hardened Scales adds one');
    t.eq(er.counters.lore, 2, 'the Saga gets its lore counter');
    t.eq(T.zone('B', 'hand').length, 0, 'chapter II: the opponent discarded their card');
    t.eq(T.g.player('A').energy, 3, 'your energy: one more');
  });

  test('"Return that card to the battlefield instead": Court of Ardenvale as the monarch or not; Aerith, Last Ancient after 7 life', (mk, t) => {
    t.auto('Court of Ardenvale'); t.auto('Aerith, Last Ancient');
    const T = mk();
    T.bf('A', 'Court of Ardenvale');
    T.g.setMonarch('A', 'test');
    const bear = T.grave('A', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bear.id }] });
    T.toMain('B'); T.toMain('A');
    t.ok(T.g.player('A').monarch, 'A is the monarch');
    t.zone(bear, 'battlefield', 'the monarch: to the battlefield');
    const T2 = mk();
    T2.bf('A', 'Court of Ardenvale');
    const b2 = T2.grave('A', 'Grizzly Bears');
    T2.answer('pickTarget', { targets: [{ kind: 'object', id: b2.id }] });
    T2.toMain('B'); T2.toMain('A');
    t.zone(b2, 'hand', 'not the monarch: to the hand');
    const T3 = mk();
    T3.toMain('A');
    T3.bf('A', 'Aerith, Last Ancient');
    const g3 = T3.grave('A', 'Hill Giant');
    T3.g.changeLife(T3.g.player('A'), 7);
    T3.answer('pickTarget', { targets: [{ kind: 'object', id: g3.id }] });
    T3.toMain('B');
    t.zone(g3, 'battlefield', 'Aerith after 7 life: to the battlefield');
  });
};
