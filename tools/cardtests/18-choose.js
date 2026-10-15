/* The generic question (docs/choices.md) and the mechanics that ask it:
   replicate, splice onto Arcane, cipher, conspire, and modes priced in
   paw prints. */
'use strict';
const { engine } = require('../harness');

module.exports = (test) => {
  const C = () => engine().choice;
  /** Pass priority until somebody is asked a generic question. */
  const untilChoose = (T) => {
    const g = T.g;
    for (let k = 0; k < 20 && !(g.pendingChoice && g.pendingChoice.type === 'choose'); k++) {
      if (g.pendingChoice) T.settle();
      else g.passPriority(g.priorityPlayer.id, true);
    }
    return g.pendingChoice;
  };

  test('choose: answers are checked, and refused with a reason', (mk, t) => {
    const ch = C().normalize({ kind: 'objects', min: 1, max: 2,
      items: [{ id: 'a', name: 'Bear', power: 2, colors: ['G'] }, { id: 'b', name: 'Bear', power: 2, colors: ['G'] }, { id: 'c', name: 'Elf', power: 1, colors: ['G'] }],
      constraints: [{ kind: 'distinct', key: 'name' }, { kind: 'sum', key: 'power', max: 3, label: 'power' }] });
    t.ok(C().check(ch, { picks: ['a', 'c'] }).ok, 'a Bear and an Elf');
    t.no(C().check(ch, { picks: [] }).ok, 'at least one');
    t.ok(/different names/.test(C().check(ch, { picks: ['a', 'b'] }).reason), 'two Bears share a name');
    t.ok(/not one of the choices/.test(C().check(ch, { picks: ['z'] }).reason), 'not on offer');
    const num = C().normalize({ kind: 'number', number: { min: 0, max: 3 } });
    t.ok(C().check(num, { number: 3 }).ok);
    t.ok(/from 0 to 3/.test(C().check(num, { number: 4 }).reason));
    const opts = C().normalize({ kind: 'options', repeat: true, min: 1, max: 5, options: [{ label: 'a', weight: 1 }, { label: 'b', weight: 3 }],
      constraints: [{ kind: 'sum', key: 'weight', max: 5, label: '{P}' }] });
    t.ok(C().check(opts, { picks: [1, 0, 0] }).ok, 'a mode twice');
    t.no(C().check(opts, { picks: [1, 1] }).ok, 'six paw prints is too many');
    const colours = C().normalize({ kind: 'objects', min: 2, max: 2, optional: true,
      items: [{ id: 'r', colors: ['R'] }, { id: 'g', colors: ['G'] }, { id: 'rg', colors: ['R', 'G'] }],
      constraints: [{ kind: 'shareColour', with: ['R'] }] });
    t.ok(C().check(colours, { picks: [] }).ok, 'none is an answer');
    t.ok(C().check(colours, { picks: ['r', 'rg'] }).ok);
    t.no(C().check(colours, { picks: ['r', 'g'] }).ok, 'green shares nothing with red');
    t.eq(JSON.stringify(C().solve(colours, { most: true }).picks), JSON.stringify(['r', 'rg']));
  });

  test('choose: the older shapes take a generic answer', (mk, t) => {
    const T = mk();
    T.mana('A', 'WBG');
    const before = T.zone('A', 'hand').length;
    T.answer('mode', (ch) => ({ picks: [ch.options.findIndex(o => /draw two/i.test(o.label))] }));
    T.cast('A', T.hand('A', 'Abzan Charm'));
    t.eq(T.zone('A', 'hand').length, before + 2, 'drew two');
    t.eq(T.life('A'), 18);
    const spec = C().fromLegacy({ type: 'confirm', playerId: 'A', prompt: 'Do it?' });
    t.eq(spec.kind, 'options');
    t.eq(C().legacyData({ type: 'confirm' }, { picks: [1] }).yes, true);
  });

  test('Replicate asks how many copies, up to what can be paid for', (mk, t) => {
    const T = mk();
    t.auto('Train of Thought');
    T.mana('A', 'UUU3');
    T.answer('choose', { number: 2 });
    const before = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Train of Thought'));
    const q = T.asked.find(c => c.type === 'choose' && c.purpose === 'replicate');
    t.ok(q, 'asked');
    t.eq(q.kind, 'number');
    t.eq(q.number.max, 2, 'two copies is all the mana there is');
    t.eq(T.zone('A', 'hand').length, before + 3, 'the spell and two copies each drew');
    t.eq(T.zone('A', 'graveyard').length, 1, 'the copies are not cards');
  });

  test('Replicate copies may be pointed somewhere new', (mk, t) => {
    const T = mk();
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'RR2');
    T.answer('choose', { number: 1 });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: elf.id }] }));
    T.cast('A', T.hand('A', 'Pyromatics'), { targets: ['B'] });
    t.eq(T.life('B'), 19, 'the original hit the player');
    t.zone(elf, 'graveyard', 'the copy hit the Elves');
  });

  test('A replicate count sent with the cast is not asked again', (mk, t) => {
    const T = mk();
    T.mana('A', 'UU2');
    const before = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Train of Thought'), { choices: { replicate: { number: 1 } } });
    t.no(T.asked.some(c => c.type === 'choose'), 'nothing asked');
    t.eq(T.zone('A', 'hand').length, before + 2);
  });

  test('Splice onto Arcane adds the spliced card\'s words, and the card stays in hand', (mk, t) => {
    const T = mk();
    t.auto('Glacial Ray');
    const ray = T.hand('A', 'Glacial Ray');
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'RR1');
    T.answer('choose', (ch) => ({ picks: ch.items.map(x => x.id) }));
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: elf.id }] }));
    const spike = T.hand('A', 'Lava Spike');
    T.cast('A', spike, { targets: ['B'] });
    const q = T.asked.find(c => c.type === 'choose' && c.purpose === 'splice');
    t.ok(q && q.items.some(x => x.id === ray.id && x.cost === '{1}{R}'), 'Glacial Ray offered, with its splice cost');
    t.eq(T.life('B'), 17, 'Lava Spike');
    t.zone(elf, 'graveyard', 'Glacial Ray\'s words, aimed as it resolved');
    t.zone(ray, 'hand', 'a spliced card stays in hand');
    t.zone(spike, 'graveyard');
  });

  test('Splice is not offered when it cannot be paid for', (mk, t) => {
    const T = mk();
    T.hand('A', 'Glacial Ray');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lava Spike'), { targets: ['B'] });
    t.no(T.asked.some(c => c.type === 'choose'), 'not asked');
    t.eq(T.life('B'), 17);
  });

  test('Cipher encodes the card, and a hit casts a copy', (mk, t) => {
    const T = mk();
    t.auto('Last Thoughts');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U3');
    const lt = T.hand('A', 'Last Thoughts');
    T.answer('choose', { picks: [bear.id] });
    const before = T.zone('A', 'hand').length;
    T.cast('A', lt);
    t.eq(T.zone('A', 'hand').length, before - 1 + 1, 'drew a card');
    t.zone(lt, 'exile', 'encoded');
    t.ok((bear.encoded || []).includes(lt.id), 'on the Bears');
    T.nextTurn('A');
    const mid = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    T.resolve();
    t.eq(T.life('B'), 18);
    t.eq(T.zone('A', 'hand').length, mid + 1, 'the copy drew a card');
    t.zone(lt, 'exile', 'still encoded');
    t.eq(T.zone('A', 'graveyard').length, 0, 'the copy is not a card');
  });

  test('Cipher can be declined', (mk, t) => {
    const T = mk();
    T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U3');
    const lt = T.hand('A', 'Last Thoughts');
    T.answer('choose', { picks: [] });
    T.cast('A', lt);
    t.zone(lt, 'graveyard');
  });

  test('Conspire taps two creatures that share a colour and copies the spell', (mk, t) => {
    const T = mk();
    t.auto('Burn Trail');
    const g1 = T.bf('A', 'Raging Goblin'), g2 = T.bf('A', 'Raging Goblin');
    T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R3');
    T.answer('choose', (ch) => {
      t.no(ch.items.some(x => x.name === 'Grizzly Bears'), 'a green creature is not offered');
      return { picks: [g1.id, g2.id] };
    });
    T.cast('A', T.hand('A', 'Burn Trail'), { targets: ['B'] });
    t.ok(g1.tapped && g2.tapped, 'tapped to conspire');
    t.eq(T.life('B'), 14, 'the spell and its copy');
  });

  test('Conspire wants two or none', (mk, t) => {
    const T = mk();
    const g1 = T.bf('A', 'Raging Goblin');
    T.bf('A', 'Raging Goblin');
    T.mana('A', 'R3');
    t.ok(T.g.castSpell('A', T.hand('A', 'Burn Trail').id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }));
    const ch = T.g.pendingChoice;
    t.eq(ch && ch.purpose, 'conspire');
    t.no(T.g.resolveChoice('A', { picks: [g1.id] }), 'one is not enough');
    t.ok(/Choose 2/.test(T.g.lastError), T.g.lastError);
    t.ok(T.g.resolveChoice('A', { picks: [] }), 'none is fine');
    T.resolve();
    t.eq(T.life('B'), 17, 'no copy');
    t.no(g1.tapped);
  });

  test('Season of the Burrow: up to five paw prints, a mode more than once', (mk, t) => {
    const T = mk();
    // (something for each mode to target: a mode with nothing to target can't be chosen)
    T.bf('B', 'Grizzly Bears'); T.grave('A', 'Ornithopter');
    T.mana('A', 'WW3');
    // (asked as it is cast, before it is on the stack: CR 601.2b)
    T.g.castSpell('A', T.hand('A', 'Season of the Burrow').id, { auto: true });
    const ch = T.g.pendingChoice;
    t.eq(ch && ch.purpose, 'pawprint');
    t.no(T.g.stack.length, 'not on the stack yet');
    t.no(T.g.resolveChoice('A', { picks: [2, 2] }), 'six paw prints');
    t.ok(/most is 5/.test(T.g.lastError), T.g.lastError);
    t.ok(T.g.resolveChoice('A', { picks: [0, 0, 0, 0, 0] }));
    T.resolve();
    t.eq(T.bfOf('A').filter(o => o.name === 'Rabbit').length, 5, 'five Rabbits');
  });

  test('Season of Weaving runs its modes in printed order', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'UU4');
    T.answer('choose', { picks: [2, 0, 0] });
    const before = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Season of Weaving'));
    t.eq(T.zone('A', 'hand').length, before + 2, 'drew two');
    t.zone(bear, 'hand', 'then everything went home');
  });

  test('"A creature you control" is chosen as it resolves', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    const elf = T.bf('A', 'Llanowar Elves');
    T.mana('A', 'GG4');
    T.answer('choose', { picks: [0, 0] });
    T.answer('choose', { picks: [elf.id] });
    T.answer('choose', { picks: [bear.id] });
    T.cast('A', T.hand('A', 'Season of Gathering'));
    t.eq(elf.counters['+1/+1'], 1);
    t.eq(bear.counters['+1/+1'], 1);
    t.ok(T.g.hasKw(bear, 'trample'), 'and it gained trample');
    t.ok(T.asked.filter(c => c.purpose === 'effectObject').every(c => !c.targets), 'chosen, not targeted');
  });

  test('"Choose an opponent" asks about players, and "that player" is the one chosen', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const effects = engine().oracle.parseEffects('Choose an opponent. You and that player each draw three cards.').effects;
    t.eq(effects[0].op, 'chooseOpponent');
    const hand = (id) => T.zone(id, 'hand').length;
    const was = { A: hand('A'), B: hand('B'), C: hand('C') };
    T.answer('choose', (ch) => {
      t.eq(ch.kind, 'players');
      t.eq(ch.items.map(x => x.id).join(','), 'B,C', 'the opponents');
      return { picks: ['C'] };
    });
    T.g._runEffects(effects, { controller: 'A', name: 'Intellectual Offering' });
    T.settle();
    t.eq(hand('A'), was.A + 3);
    t.eq(hand('C'), was.C + 3, 'the one chosen');
    t.eq(hand('B'), was.B);
  });

  test('A bot answers generic questions, at the table and while casting', (mk, t) => {
    const T = mk();
    T.player('A').isBot = true;
    T.mana('A', 'UUU3');
    const before = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Train of Thought'));
    t.no(T.asked.some(c => c.type === 'choose'), 'a bot is not asked while casting');
    t.eq(T.zone('A', 'hand').length, before + 3, 'it replicated as often as it could');
    // a question on the table, answered by the bot's own doChoice
    const T2 = mk();
    T2.player('A').isBot = true;
    T2.mana('A', 'WW3');
    // its modes, asked as it is cast — a bot too, which answers them by its own lights
    T2.g.castSpell('A', T2.hand('A', 'Season of the Burrow').id, { auto: true });
    const ch = T2.g.pendingChoice;
    t.ok(ch && ch.type === 'choose' && ch.purpose === 'pawprint', 'asked as it is cast');
    const bot = new (engine().bots.BotPlayer)(T2.g, 'A', 6);
    bot.doChoice(ch);
    t.no(T2.g.pendingChoice && T2.g.pendingChoice.type === 'choose', 'answered');
    T2.resolve();
    t.ok(T2.bfOf('A').filter(o => o.name === 'Rabbit').length >= 1, 'it made Rabbits');
  });
};
