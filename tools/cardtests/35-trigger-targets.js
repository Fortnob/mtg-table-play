/* A triggered ability chooses its modes and targets as it is put on the stack (CR 603.3c–d), and they
   are checked again as it resolves (CR 608.2b): what it points at can be answered before it resolves. */
'use strict';
module.exports = (test) => {
  const top = (g) => g.stack[g.stack.length - 1];
  const obj = (o) => ({ kind: 'object', id: o.id });
  /* Pass priority until `stop` is true or the stack is empty, answering what is asked. */
  const passUntil = (T, stop) => {
    const g = T.g;
    for (let i = 0; i < 60; i++) {
      T.settle();
      if (stop()) return true;
      if ((!g.stack.length && !g.pendingTriggers.length) || !g.priorityPlayer) return false;
      g.passPriority(g.priorityPlayer.id, true);
    }
    return false;
  };
  /* A casts Ravenous Chupacabra; its trigger goes on the stack, aimed (by the queued answer), and A has priority. */
  const chupacabra = (T, pid) => {
    const g = T.g;
    T.mana(pid, '2BB');
    T.cast(pid, T.hand(pid, 'Ravenous Chupacabra'), { resolve: false });
    passUntil(T, () => g.stack.some(s => s.triggered && /Chupacabra/.test(s.name)));
    return g.stack.find(s => s.triggered && /Chupacabra/.test(s.name));
  };

  test('Trigger targets: an enters trigger chooses its target as it goes on the stack, before anyone has priority', (mk, t) => {
    t.auto('Ravenous Chupacabra');
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    const giant = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', (ch) => {
      t.eq(ch.purpose, 'triggerTargets', 'asked as a trigger going on the stack');
      t.ok(g.stack.some(s => s.id === ch.stackId && s.triggered), 'while the trigger is on the stack');
      t.no((g.stack.find(s => s.id === ch.stackId).targets || []).length, 'its target not yet chosen');
      return { targets: [obj(giant)] };
    });
    const tr = chupacabra(T, 'A');
    t.ok(tr, 'the trigger is on the stack');
    t.eq(JSON.stringify(tr.targets.map(x => x.id)), JSON.stringify([giant.id]), 'with its target on it');
    t.zone(giant, 'battlefield', 'not destroyed yet: it has not resolved');
    t.ok(g.log.some(l => /targets Hill Giant/.test(l.text)), 'the log says what it targets');
    T.resolve();
    t.zone(giant, 'graveyard', 'destroyed as it resolves');
  });

  test('Trigger targets: the target bounced or flickered in response — the trigger does nothing', (mk, t) => {
    for (const how of ['Unsummon', 'Cloudshift']) {
      const T = mk({ library: Array(20).fill('Island') });
      const g = T.g;
      const giant = T.bf('B', 'Hill Giant');
      T.answer('pickTarget', { targets: [obj(giant)] });
      const tr = chupacabra(T, 'A');
      t.ok(tr && tr.targets.length === 1, how + ': aimed at the Giant');
      // A passes; B answers it
      g.passPriority('A', true);
      t.eq(g.priorityPlayer.id, 'B', how + ': B has priority with the trigger on the stack');
      T.mana('B', how === 'Unsummon' ? 'U' : 'W');
      T.cast('B', T.hand('B', how), { targets: [giant] });
      t.zone(giant, how === 'Unsummon' ? 'hand' : 'battlefield', how + ': the Giant is where B sent it');
      t.no(g.stack.length, how + ': everything resolved');
      t.ok(g.log.some(l => /Chupacabra.*countered on resolution \(no legal targets\)/.test(l.text)), how + ': the trigger had no legal target left');
    }
  });

  test('Trigger targets: two targets, one gone — the other is still acted on (CR 608.2b)', (mk, t) => {
    t.auto('Éomer, King of Rohan');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    const bears = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', (ch) => {
      t.eq(ch.count, 2, 'both targets asked together');
      return { targets: [{ kind: 'player', id: 'B' }, obj(bears)] };
    });
    T.bf('A', 'Éomer, King of Rohan', { etb: true });
    passUntil(T, () => g.stack.some(s => s.triggered));
    const tr = g.stack.find(s => s.triggered);
    t.eq(tr.targets.length, 2, 'the player and the Bears');
    if (g.priorityPlayer.id === 'A') g.passPriority('A', true);
    T.mana('B', 'U');
    T.cast('B', T.hand('B', 'Unsummon'), { targets: [bears] });
    t.zone(bears, 'hand', 'the Bears bounced in response');
    t.ok(g.player('B').monarch, 'B still becomes the monarch');
    t.eq(T.life('B'), 20, 'and the damage meant for the Bears goes nowhere');
  });

  test('Trigger targets: "up to one" with nothing to target goes on the stack with none; a target it must have, and none, and it is removed', (mk, t) => {
    t.auto('Skyclave Apparition');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    T.mana('A', '1WW');
    T.cast('A', T.hand('A', 'Skyclave Apparition'), { resolve: false });
    passUntil(T, () => g.stack.some(s => s.triggered));
    const tr = g.stack.find(s => s.triggered);
    t.ok(tr && !tr.targets.length, 'Skyclave Apparition: on the stack, no target');
    t.no(T.asked.some(c => c.type === 'pickTarget'), 'nothing asked');
    T.resolve();
    const U = mk({ library: Array(20).fill('Swamp') });
    U.mana('A', '2BB');
    U.cast('A', U.hand('A', 'Ravenous Chupacabra'));
    t.no(U.asked.some(c => c.type === 'pickTarget'), 'Chupacabra with no opposing creature: nothing asked');
    t.ok(U.g.log.some(l => /Chupacabra.*has no legal target, so it is removed from the stack/.test(l.text)), 'its trigger is removed (CR 603.3d)');
    t.no(U.g.log.some(l => /Chupacabra — .*resolves/.test(l.text)), 'and never resolves');
  });

  test('Trigger targets: a modal trigger chooses its mode, then that mode\'s target, as it goes on the stack', (mk, t) => {
    t.auto('Charming Prince');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears');
    const order = [];
    T.answer('mode', (ch) => { order.push('mode'); t.ok(g.stack.some(s => s.id === ch.stackId), 'the mode is asked with the trigger on the stack'); return { modes: [2] }; });
    T.answer('pickTarget', (ch) => { order.push('target'); return { targets: [obj(bears)] }; });
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Charming Prince'), { resolve: false });
    passUntil(T, () => g.stack.some(s => s.triggered));
    const tr = g.stack.find(s => s.triggered);
    t.eq(order.join(','), 'mode,target', 'the mode first, then its target');
    t.ok(tr && /Exile another target creature you own/.test((tr.modes || []).join()), 'the mode chosen is on the stack');
    t.eq((tr.targets || []).map(x => x.id).join(), bears.id, 'and its target');
    T.resolve();
    t.zone(bears, 'exile', 'the Bears are exiled as it resolves');
    t.eq(T.life('A'), 20, 'no life gained: that mode was not chosen');
  });

  test('Trigger targets: "you may … target": the target as it goes on the stack, the "may" as it resolves', (mk, t) => {
    t.auto('Reclamation Sage');
    for (const yes of [true, false]) {
      const T = mk({ library: Array(20).fill('Forest') });
      const g = T.g;
      const ring = T.bf('B', 'Sol Ring');
      const order = [];
      T.answer('pickTarget', () => { order.push('target'); return { targets: [obj(ring)] }; });
      T.answer('confirm', () => { order.push('may'); return { yes }; });
      T.mana('A', '2G');
      T.cast('A', T.hand('A', 'Reclamation Sage'), { resolve: false });
      passUntil(T, () => g.stack.some(s => s.triggered));
      t.eq(order.join(','), 'target', 'only the target is asked as it goes on the stack');
      T.resolve();
      t.eq(order.join(','), 'target,may', 'the "may" as it resolves');
      t.zone(ring, yes ? 'graveyard' : 'battlefield', yes ? 'yes: destroyed' : 'no: it stays');
    }
  });

  test('Trigger targets: "you may pay {1}. If you do, target creature can\'t block" — the target is chosen first', (mk, t) => {
    t.auto('Intimidator Initiate');
    const T = mk({ library: Array(20).fill('Mountain') });
    const g = T.g;
    T.bf('A', 'Intimidator Initiate');
    const bears = T.bf('B', 'Grizzly Bears');
    const giant = T.bf('A', 'Hill Giant');
    let paidAt = null;
    T.answer('pickTarget', (ch) => { t.eq(ch.purpose, 'triggerTargets', 'the creature is the trigger\'s target'); return { targets: [obj(bears)] }; });
    T.answer('confirm', () => { paidAt = g.stack.length; return { yes: true }; });
    T.answer('payOrDont', () => { paidAt = g.stack.length; return { pay: true }; });
    T.mana('A', 'R1');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [{ kind: 'player', id: 'B' }], resolve: false });
    passUntil(T, () => g.stack.some(s => s.triggered));
    const tr = g.stack.find(s => s.triggered);
    t.eq((tr.targets || []).map(x => x.id).join(), bears.id, 'targets the Bears on the stack');
    t.eq(paidAt, null, 'nothing paid yet');
    T.resolve();
    t.ok(paidAt != null, 'the {1} is asked as it resolves');
    t.no(g.canBlock(bears, giant), 'the Bears can\'t block');
  });

  test('Trigger targets: damage divided as it goes on the stack; a target gone keeps its share from the others (CR 601.2d, 608.2b)', (mk, t) => {
    t.auto('Dragonlord Atarka');
    const T = mk({ library: Array(20).fill('Forest') });
    const g = T.g;
    const giant = T.bf('B', 'Hill Giant'), bears = T.bf('B', 'Grizzly Bears');
    const asked = [];
    const answer = (ch) => {
      asked.push(ch.purpose);
      if (ch.purpose === 'anyTargets') return { picks: [giant.id, bears.id] };
      if (ch.purpose === 'divideDamage') {
        t.ok(g.stack.some(s => s.id === ch.stackId), 'the division is asked with the trigger on the stack');
        // one each, and of the other three: two more to the Giant, one to the Bears
        const gi = ch.options.findIndex(o => o.id === giant.id), bi = ch.options.findIndex(o => o.id === bears.id);
        return { picks: [gi, gi, bi] };
      }
      return { picks: [] };
    };
    T.answer('choose', answer).answer('choose', answer);
    T.bf('A', 'Dragonlord Atarka', { etb: true });
    passUntil(T, () => g.stack.some(s => s.triggered && s.targets && s.targets.length));
    const tr = g.stack.find(s => s.triggered);
    t.eq(tr.targets.length, 2, 'two targets');
    t.eq(asked.join(), 'anyTargets,divideDamage', 'the targets, then the division');
    if (g.priorityPlayer.id === 'A') g.passPriority('A', true);
    T.mana('B', 'U');
    T.cast('B', T.hand('B', 'Unsummon'), { targets: [giant] });
    t.zone(giant, 'hand', 'the Giant bounced in response');
    t.zone(bears, 'graveyard', 'the Bears take their 2');
    t.eq(T.life('B'), 20, 'and the Giant\'s 3 is dealt to nobody');
  });

  test('Trigger targets: ward on what a trigger targets is a ward trigger above it — paid, not paid, can\'t be paid', (mk, t) => {
    t.auto('Hulking Raptor');
    const run = (extra, yes) => {
      const T = mk({ library: Array(20).fill('Swamp') });
      const g = T.g;
      const raptor = T.bf('B', 'Hulking Raptor');
      T.answer('pickTarget', { targets: [obj(raptor)] });
      T.answer('confirm', (ch) => ({ yes: ch.purpose === 'wardPrice' ? yes : true }));
      if (extra) T.mana('A', extra);
      const tr = chupacabra(T, 'A');
      const w = top(g);
      t.ok(w && w !== tr && /ward/i.test(w.name) && w.controller === 'B', 'the ward trigger, B\'s, is on top of the Chupacabra trigger');
      t.eq(g.stack.indexOf(tr), g.stack.length - 2, 'right beneath it');
      T.resolve();
      return { T, raptor };
    };
    const paid = run('2', true);
    t.zone(paid.raptor, 'graveyard', 'paid {2}: the trigger resolves, the Raptor destroyed');
    t.eq(paid.T.player('A').pool.C || 0, 0, 'the {2} spent');
    const not = run('2', false);
    t.zone(not.raptor, 'battlefield', 'not paid: the trigger is countered');
    t.ok(not.T.g.log.some(l => /countered by Hulking Raptor's ward/.test(l.text)), 'the log says so');
    const broke = run(null, true);
    t.zone(broke.raptor, 'battlefield', 'nothing to pay with: countered');
    t.no(broke.T.asked.some(c => c.purpose === 'wardPrice'), 'without asking');
  });

  test('Trigger targets: "becomes the target" sees a trigger\'s targets as it goes on the stack — Surrak, Shay Cormac', (mk, t) => {
    t.auto('Surrak, Elusive Hunter'); t.auto('Shay Cormac');
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    T.bf('A', 'Surrak, Elusive Hunter');
    const bears = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [obj(bears)] });
    const hand = T.zone('A', 'hand').length;
    T.toMain('B');
    const tr = chupacabra(T, 'B');
    t.ok(tr && tr.targets.length, "B's trigger aims at A's Bears");
    const s = top(g);
    t.ok(s && s.controller === 'A' && /Surrak/.test(s.name), "Surrak's trigger above it");
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand + 1, 'Surrak: A draws');
    t.zone(bears, 'graveyard');
    // Shay Cormac: A's trigger at B's creature — a bounty counter before it resolves, and two counters on Shay once it dies
    const U = mk({ library: Array(20).fill('Swamp') });
    const shay = U.bf('A', 'Shay Cormac');
    const giant = U.bf('B', 'Hill Giant');
    U.answer('pickTarget', { targets: [obj(giant)] });
    chupacabra(U, 'A');
    passUntil(U, () => (giant.counters.bounty || 0) > 0);
    t.zone(giant, 'battlefield', 'Shay: the bounty counter goes on before the trigger resolves');
    U.resolve();
    t.zone(giant, 'graveyard');
    t.eq(shay.counters['+1/+1'], 2, 'Shay: a creature with a bounty counter died');
  });

  test('Trigger targets: Horobi destroys what a trigger targets before the trigger resolves', (mk, t) => {
    t.auto("Horobi, Death's Wail"); t.auto("Man-o'-War");
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    T.bf('B', "Horobi, Death's Wail");
    const bears = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [obj(bears)] });
    T.mana('A', '2U');
    T.cast('A', T.hand('A', "Man-o'-War"), { resolve: false });
    passUntil(T, () => g.stack.some(s => s.triggered && /Man-o'-War/.test(s.name)));
    const tr = g.stack.find(s => s.triggered && /Man-o'-War/.test(s.name));
    t.ok(/Horobi/.test(top(g).name), "Horobi's trigger is above Man-o'-War's");
    t.zone(bears, 'battlefield', 'nothing has happened yet');
    passUntil(T, () => !g.stack.includes(top(g)) || bears.zone !== 'battlefield');
    t.zone(bears, 'graveyard', 'Horobi destroys the Bears first');
    t.ok(g.stack.includes(tr), "while Man-o'-War's trigger is still waiting");
    T.resolve();
    t.zone(bears, 'graveyard', "so Man-o'-War has nothing to return");
    t.ok(g.log.some(l => /Man-o'-War.*countered on resolution \(no legal targets\)/.test(l.text)), 'its trigger had no legal target');
  });

  test('Trigger targets: Strionic Resonator copies a trigger with its target, and the copy may choose a new one', (mk, t) => {
    t.auto('Strionic Resonator');
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    const res = T.bf('A', 'Strionic Resonator');
    const g1 = T.bf('B', 'Hill Giant'), g2 = T.bf('B', 'Craw Wurm');
    T.answer('pickTarget', { targets: [obj(g1)] });
    const tr = chupacabra(T, 'A');
    T.answer('pickTarget', (ch) => {
      t.ok(/New targets for the copy/.test(ch.prompt), 'the copy is offered new targets');
      return { targets: [obj(g2)] };
    });
    T.mana('A', '2');
    T.activate('A', res, 0, { targets: [{ kind: 'stack', id: tr.id }] });
    t.zone(g1, 'graveyard', 'the trigger destroys the Giant');
    t.zone(g2, 'graveyard', 'its copy the Wurm');
  });

  test('Trigger targets: a reflexive "when you do" trigger chooses its target when it triggers — Auron, after the counter', (mk, t) => {
    t.auto('Auron, Venerated Guardian');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    const auron = T.bf('A', 'Auron, Venerated Guardian');
    const bears = T.bf('B', 'Grizzly Bears');
    let opts = null, power = null, item = null, outer = null;
    T.answer('pickTarget', (ch) => {
      opts = ch.options[0].map(x => x.id); power = g.powerOf(auron);
      item = g.stack.find(s => s.id === ch.stackId);
      outer = g.stack.some(s => s.triggered && /Whenever/.test(s.name));
      return { targets: [obj(bears)] };
    });
    T.answer('declareAttackers', () => [{ attackerId: auron.id, defenderId: 'B' }]);
    T.toMain('A', 'declareAttackers');
    T.resolve();
    t.eq(power, 3, 'asked once Auron has its counter');
    t.no(outer, 'the attack trigger has resolved by then');
    t.ok(opts && opts.includes(bears.id), 'so the Bears, power 2, can be targeted');
    t.ok(item && /When you do/.test(item.name) && (item.targets || []).some(x => x.id === bears.id), 'the reflexive trigger went on the stack with its target');
    t.zone(bears, 'exile', 'exiled');
  });

  test('Trigger targets: a bot chooses its trigger\'s target as it goes on the stack, the way it would have', (mk, t) => {
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    const angel = T.bf('A', 'Serra Angel'), bears = T.bf('A', 'Grizzly Bears');
    T.player('B').isBot = true;
    const bot = new T.MTG.bots.BotPlayer(g, 'B', 8);
    T.toMain('B');
    T.mana('B', '2BB');
    g.castSpell('B', T.hand('B', 'Ravenous Chupacabra').id, { auto: true });
    let asked = null;
    for (let i = 0; i < 20 && !asked; i++) {
      if (g.pendingChoice) { asked = g.pendingChoice; break; }
      if (!g.priorityPlayer) break;
      g.passPriority(g.priorityPlayer.id, true);
    }
    t.ok(asked && asked.type === 'pickTarget' && asked.playerId === 'B', 'the bot is asked');
    t.ok(asked && Array.isArray(asked.aimedBy) && asked.aimedBy[0].op === 'destroy', 'and told what the target is for');
    bot.doChoice(asked);
    t.no(g.pendingChoice, 'the bot has answered');
    t.ok(asked && asked.purpose === 'triggerTargets', 'the bot was asked as the trigger went on the stack');
    T.resolve();
    t.zone(angel, 'graveyard', 'it takes the Angel');
    t.zone(bears, 'battlefield', 'not the Bears');
  });

  test('Trigger targets: a game saved while a trigger\'s target is asked comes back to the same question', (mk, t) => {
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    const g1 = T.bf('B', 'Hill Giant'), g2 = T.bf('B', 'Craw Wurm');
    T.mana('A', '2BB');
    g.castSpell('A', T.hand('A', 'Ravenous Chupacabra').id, { auto: true });
    for (let i = 0; i < 10 && !g.pendingChoice; i++) g.passPriority(g.priorityPlayer.id, true);
    const ch = g.pendingChoice;
    t.ok(ch && ch.type === 'pickTarget' && ch.purpose === 'triggerTargets', 'asked for the target');
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    g.resolveChoice('A', { targets: [obj(g1)] });
    T.resolve();
    t.zone(g1, 'graveyard', 'answered: the Giant');
    g.restore(JSON.parse(JSON.stringify(snap)));
    const again = g.pendingChoice;
    t.ok(again && again.type === 'pickTarget' && again.stackId === ch.stackId, 'restored: the same question again');
    const G1 = g.obj(g1.id), G2 = g.obj(g2.id);
    t.zone(G1, 'battlefield', 'the Giant is back');
    g.resolveChoice('A', { targets: [obj(G2)] });
    const tr = g.stack.find(s => s.id === ch.stackId);
    t.ok(tr && tr.targets[0].id === G2.id, 'and answered the other way, the trigger has the Wurm');
    T.resolve();
    t.zone(G2, 'graveyard', 'the Wurm destroyed');
    t.zone(G1, 'battlefield', 'the Giant spared');
  });

  test('Trigger targets: an opponent\'s trigger shows its targets on the stack, to everyone', (mk, t) => {
    const T = mk({ library: Array(20).fill('Swamp') });
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [obj(bears)] });
    T.toMain('B');
    const tr = chupacabra(T, 'B');
    const v = g.viewFor('A');
    const it = v.stack.find(s => s.id === tr.id);
    t.ok(it && it.triggered, "A sees B's trigger");
    t.eq(JSON.stringify((it.targets || []).map(x => x.id)), JSON.stringify([bears.id]), 'and what it targets');
    t.ok(g.events.some(e => e.type === 'trigger' && e.stackId === tr.id && (e.targets || []).some(x => x.id === bears.id)), 'the event for it carries the target too');
  });
};
