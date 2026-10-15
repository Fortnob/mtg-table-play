/* Trigger batches and remembered answers: three or more of the same trigger at once can be answered once
   ("Same target for all", "Decline the rest", "Resolve the rest"), and a question an ability keeps asking can
   be answered for the turn ("Yes to all this turn", "Always pay when I can"). The rules still decide: every
   remembered answer is checked again as it is used, and the log says what was answered automatically. */
'use strict';
const C = require('../contracts');
module.exports = (test) => {
  const obj = (o) => ({ kind: 'object', id: o.id });
  const batchOf = (g, pid) => g.stack.filter(s => s.batch && s.controller === pid);
  /* Several creatures enter at once: their triggers wait together until somebody would get priority. */
  const enterAll = (T, pid, names) => {
    const g = T.g;
    const list = names.map(n => g._register(new T.MTG.rules.GObj(require('../harness').card(n), pid, 'hand')));
    for (const o of list) g.zones[pid].hand.push(o);
    for (const o of list) g.moveObject(o, 'battlefield', { controller: pid });
    return list;
  };
  /* A passes once, so the waiting triggers go on the stack (each choosing as it goes), and B has priority. */
  const goOnStack = (T, pid) => { T.g.passPriority(pid || 'A', true); T.settle(); };
  const noViolations = (t, list, what) => t.eq(list.length, 0, what + ': ' + list.map(v => v.path + ' ' + v.msg).join('; '));

  test('Batches: four copies of a targeted trigger — "Same target for all" aims the rest at the first one\'s target', (mk, t) => {
    t.auto('Satyr Grovedancer');
    const T = mk({ library: Array(20).fill('Forest') });
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Hill Giant');
    let first = null;
    T.answer('pickTarget', (ch) => {
      first = ch;
      return { targets: [obj(bears)], remember: 'batch' };
    });
    enterAll(T, 'A', Array(4).fill('Satyr Grovedancer'));
    goOnStack(T);
    t.ok(first && first.auto, 'the first copy\'s question offers it');
    t.eq(first.auto.kind, 'targets', 'as a choice of targets');
    t.eq(first.auto.rest, 3, 'for the other three');
    t.ok(first.auto.same[0].some(x => x.id === bears.id), 'the Bears are a legal target for all of them');
    noViolations(t, C.checkChoice(first, g), 'the question keeps to its contract');
    noViolations(t, C.checkAnswer(first, { targets: [obj(bears)], remember: 'batch' }, g), 'and so does the answer');
    t.eq(T.asked.filter(c => c.type === 'pickTarget').length, 1, 'asked once, not four times');
    const mine = batchOf(g, 'A');
    t.eq(mine.length, 4, 'four triggers on the stack, one batch');
    t.ok(mine.every(s => s.batch === mine[0].batch), 'all of the same batch');
    t.ok(mine.every(s => (s.targets || []).length === 1 && s.targets[0].id === bears.id), 'each aimed at the Bears');
    t.ok(g.log.some(l => /Satyr Grovedancer — Grizzly Bears \(Satyr Grovedancer: same target for the rest\)/.test(l.text)), 'the log says what was answered for them');
    const v = g.viewFor('A');
    t.ok(v.stack.every(s => s.batch === mine[0].batch), 'the view shows the batch');
    t.ok((v.autoAnswers || []).some(x => x.kind === 'targets'), 'and the remembered answer');
    noViolations(t, C.checkView(v, 'A', g), 'the view keeps to its contract');
    T.resolve();
    t.eq(bears.counters['+1/+1'], 4, 'four counters on the Bears');
    t.no((g.player('A').autoAnswers || []).length, 'the batch done, its answer is forgotten');
  });

  test('Batches: a target legal for only some of the copies — "Same target for all" is not offered', (mk, t) => {
    t.auto('Charming Prince');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    let modeQ = null, tgtQ = [];
    T.answer('mode', (ch) => { modeQ = ch; return { modes: [2], remember: 'batch' }; });
    T.answer('pickTarget', (ch) => { tgtQ.push(ch); return { targets: [ch.options[0][0]] }; });
    T.answer('pickTarget', (ch) => { tgtQ.push(ch); return { targets: [ch.options[0][0]] }; });
    T.answer('pickTarget', (ch) => { tgtQ.push(ch); return { targets: [ch.options[0][0]] }; });
    const princes = enterAll(T, 'A', Array(3).fill('Charming Prince'));
    goOnStack(T);
    t.ok(modeQ && modeQ.auto && modeQ.auto.rest === 2, 'the mode question offers "Same mode for all"');
    t.eq(T.asked.filter(c => c.type === 'mode').length, 1, 'the mode asked once');
    t.ok(batchOf(g, 'A').every(s => /Exile another target creature you own/.test((s.modes || []).join())), 'every copy has the mode');
    // each Prince's "another target creature" is either of the other two: nothing is legal for all three
    t.eq(tgtQ.length, 3, 'each copy asks for its own target');
    t.no(tgtQ[0].auto && tgtQ[0].auto.same, 'no target is legal for every copy: "Same target for all" is not offered');
    t.ok(tgtQ[0].options[0].every(x => princes.some(p => p.id === x.id)), 'its targets are the other Princes');
    // and an answer that says to remember all the same is not taken as one
    const U = mk({ library: Array(20).fill('Plains') });
    const bears = U.bf('A', 'Grizzly Bears');
    U.answer('mode', { modes: [2], remember: 'batch' });
    let q1 = null;
    U.answer('pickTarget', (ch) => { q1 = ch; return { targets: [ch.options[0].find(x => x.id !== bears.id)], remember: 'batch' }; });
    const p2 = enterAll(U, 'A', Array(3).fill('Charming Prince'));
    goOnStack(U);
    t.ok(q1 && q1.auto && q1.auto.same, 'with the Bears there, it is offered');
    t.eq(JSON.stringify(q1.auto.same[0].map(x => x.id)), JSON.stringify([bears.id]), 'for the Bears alone');
    t.ok(p2.length === 3 && U.asked.filter(c => c.type === 'pickTarget').length === 3, 'a Prince picked for all is not remembered: the others are asked');
    t.no((U.g.player('A').autoAnswers || []).some(x => x.kind === 'targets'), 'nothing remembered for the targets');
  });

  test('Batches: an optional trigger — "Decline the rest", from the stack or from the question', (mk, t) => {
    t.auto("Soul's Attendant");
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    T.bf('A', "Soul's Attendant");
    enterAll(T, 'A', Array(4).fill('Grizzly Bears'));
    goOnStack(T);
    const mine = batchOf(g, 'A');
    t.eq(mine.length, 4, 'four triggers, one batch');
    t.ok(g.viewFor('A').stack.every(s => s.optional), 'the view says they are optional');
    t.ok(g.autoAnswer('A', 'decline', mine[0].batch), 'declined from the stack');
    noViolations(t, C.checkIntent({ kind: 'auto', act: 'decline', batch: mine[0].batch }), 'the intent keeps to its contract');
    T.resolve();
    t.eq(T.life('A'), 20, 'no life gained');
    t.no(T.asked.some(c => c.type === 'confirm'), 'nothing asked');
    t.eq(g.log.filter(l => /Soul's Attendant — no \(Soul's Attendant: decline the rest\)/.test(l.text)).length, 4, 'each answered no, and logged');
    // from the first copy's question
    const U = mk({ library: Array(20).fill('Plains') });
    U.bf('A', "Soul's Attendant");
    let q = null;
    U.answer('confirm', (ch) => { q = ch; return { yes: true }; });
    U.answer('confirm', (ch) => ({ yes: false, remember: 'batch' }));
    enterAll(U, 'A', Array(4).fill('Grizzly Bears'));
    goOnStack(U);
    U.resolve();
    t.ok(q && q.auto && q.auto.rest === 3 && q.auto.turn, 'the first one asked offers "Decline the rest" and "… to all this turn"');
    t.eq(U.asked.filter(c => c.type === 'confirm').length, 2, 'asked twice: yes, then no to the rest');
    t.eq(U.life('A'), 21, 'one life gained');
  });

  test('Batches: a trigger that has to happen can\'t be declined', (mk, t) => {
    t.auto('Soul Warden');
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    T.bf('A', 'Soul Warden');
    enterAll(T, 'A', Array(3).fill('Grizzly Bears'));
    goOnStack(T);
    const mine = batchOf(g, 'A');
    t.eq(mine.length, 3, 'a batch of three');
    t.no(g.viewFor('A').stack.some(s => s.optional), 'not optional');
    t.no(g.autoAnswer('A', 'decline', mine[0].batch), 'declining it is refused');
    T.resolve();
    t.eq(T.life('A'), 23, 'all three resolve');
  });

  test('Batches: "Resolve the rest" passes for each copy, and stops when an opponent responds', (mk, t) => {
    const T = mk({ library: Array(20).fill('Forest') });
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [obj(bears)], remember: 'batch' });
    enterAll(T, 'A', Array(4).fill('Satyr Grovedancer'));
    goOnStack(T);
    // B passes back; A has priority with the batch on top
    g.passPriority('B', true);
    t.eq(g.stack.length, 3, 'the first one resolved');
    t.eq(g.priorityPlayer.id, 'A', 'A has priority');
    g.setYield('A', 'batch');
    noViolations(t, C.checkIntent({ kind: 'yield', mode: 'batch' }), 'the intent keeps to its contract');
    t.eq(g.priorityPlayer.id, 'B', 'A passed by itself');
    t.eq(g.viewFor('A').yielding, 'batch', 'the view says so');
    g.passPriority('B', true);
    t.eq(g.stack.length, 2, 'another resolved');
    t.eq(g.priorityPlayer.id, 'B', 'and A passed again without being asked');
    // B answers: A gets priority with B's spell on top, and stops
    T.mana('B', 'G');
    T.cast('B', T.hand('B', 'Giant Growth'), { targets: [bears], resolve: false });
    g.passPriority('B', true);
    t.eq(g.priorityPlayer.id, 'A', 'A has priority over B\'s spell');
    t.eq(g.player('A').yieldUntil, null, 'and is no longer passing');
    T.resolve();
    t.eq(bears.counters['+1/+1'], 4, 'every copy resolved in the end');
    // a copy that asks something stops it too
    const U = mk({ library: Array(20).fill('Plains') });
    U.bf('A', "Soul's Attendant");
    enterAll(U, 'A', Array(3).fill('Grizzly Bears'));
    goOnStack(U);
    U.g.passPriority('B', true);
    U.settle();
    U.g.setYield('A', 'batch');
    U.g.passPriority('B', true);
    t.ok(U.g.pendingChoice && U.g.pendingChoice.type === 'confirm', 'the next copy asks its "you may"');
    t.eq(U.g.player('A').yieldUntil, null, 'and the passing stops there');
  });

  test('Batches: the same trigger of the same source with the same targets is not ordered; mixed, the same ones go in as one', (mk, t) => {
    const T = mk({ library: Array(20).fill('Plains') });
    const g = T.g;
    g.setAutoPass('A', { orderTriggers: true });
    T.bf('A', 'Panharmonicon');
    T.top('A', 'Plains'); T.top('A', 'Plains');
    enterAll(T, 'A', ['Wall of Omens']);
    goOnStack(T);
    t.eq(g.stack.filter(s => /Wall of Omens/.test(s.name)).length, 2, 'Wall of Omens triggers twice');
    t.no(T.asked.some(c => c.type === 'orderTriggers'), 'their order is not asked');
    t.ok(g.log.some(l => /2 triggers are the same, so their order can't matter/.test(l.text)), 'the log says why');
    T.resolve();
    const U = mk({ library: Array(20).fill('Plains') });
    U.g.setAutoPass('A', { orderTriggers: true });
    U.bf('A', 'Panharmonicon');
    U.bf('A', 'Soul Warden');
    let q = null;
    U.answer('orderTriggers', (ch) => { q = ch; return { top: [ch.cards[1].id, ch.cards[0].id] }; });
    enterAll(U, 'A', ['Wall of Omens']);
    goOnStack(U);
    t.ok(q, 'with Soul Warden as well, the order is asked');
    t.eq(q.cards.length, 2, 'two to order: the two Walls as one, the two Wardens as one');
    t.ok(q.cards.every(c => (c.ids || []).length === 2), 'each standing for two');
    noViolations(t, C.checkChoice(q, U.g), 'the question keeps to its contract');
    const names = U.g.stack.map(s => /Wall/.test(s.name) ? 'W' : 'S').join('');
    t.ok(names === 'SSWW' || names === 'WWSS', 'the same ones side by side: ' + names);
    t.eq(names, q.cards[1].name.startsWith('Soul') ? 'SSWW' : 'WWSS', 'in the order asked');
  });

  test('Remembered: "Yes to all this turn" answers that ability\'s "you may" for the turn, and is asked again next turn', (mk, t) => {
    const T = mk({ library: Array(30).fill('Plains') });
    const g = T.g;
    T.bf('A', "Soul's Attendant");
    let q = null;
    T.answer('confirm', (ch) => { q = ch; return { yes: true, remember: 'turn' }; });
    T.bf('A', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.ok(q && q.auto && q.auto.turn, 'the question offers it');
    t.eq(T.life('A'), 21, 'yes');
    T.bf('A', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.eq(T.life('A'), 22, 'yes again');
    t.eq(T.asked.filter(c => c.type === 'confirm').length, 1, 'without being asked');
    t.ok(g.log.some(l => /Soul's Attendant — yes \(Soul's Attendant: yes this turn\)/.test(l.text)), 'the log says it was answered for them');
    const chip = g.viewFor('A').autoAnswers;
    t.eq(chip.length, 1, 'shown on the table');
    t.eq(g.viewFor('B').autoAnswers.length, 0, 'to A alone');
    T.nextTurn('B');
    t.eq((g.player('A').autoAnswers || []).length, 0, 'gone when the turn is');
    T.answer('confirm', { yes: false, remember: 'turn' });
    T.bf('A', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.eq(T.asked.filter(c => c.type === 'confirm').length, 2, 'asked again the next turn');
    T.bf('A', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.eq(T.asked.filter(c => c.type === 'confirm').length, 2, '"No to all this turn": not asked');
    t.eq(T.life('A'), 22, 'and no life gained');
    // taken back: asked again
    const id = g.player('A').autoAnswers[0].id;
    t.ok(g.autoAnswer('A', 'clear', id), 'taken back');
    noViolations(t, C.checkIntent({ kind: 'auto', act: 'clear', id }), 'the intent keeps to its contract');
    T.bf('A', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.eq(T.asked.filter(c => c.type === 'confirm').length, 3, 'asked once more');
  });

  test('Remembered: "Always pay when I can" pays while it can, and only then', (mk, t) => {
    t.auto('Rhystic Study');
    const T = mk({ library: Array(30).fill('Island') });
    const g = T.g;
    T.bf('B', 'Rhystic Study');
    let q = null;
    T.answer('payOrDont', (ch) => { q = ch; return { pay: true, remember: 'turn' }; });
    T.mana('A', 'RRR1');
    const before = g.zones.B.hand.length;
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.ok(q && q.auto && q.auto.kind === 'pay' && q.auto.turn, 'the question offers it');
    noViolations(t, C.checkAnswer(q, { pay: true, remember: 'turn' }, g), 'the answer keeps to its contract');
    t.eq(g.zones.B.hand.length, before, 'A paid: B draws nothing');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.asked.filter(c => c.type === 'payOrDont').length, 1, 'the second time, not asked');
    t.eq(g.zones.B.hand.length, before, 'and paid again');
    t.ok(g.log.some(l => /Rhystic Study — pays \(Rhystic Study: always pay this turn\)/.test(l.text)), 'the log says so');
    // nothing left to pay with: it can't be paid, so it isn't
    t.eq(g.player('A').pool.total ? g.player('A').pool.total() : 0, 0, 'A\'s mana is spent');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    t.eq(T.asked.filter(c => c.type === 'payOrDont').length, 1, 'not asked');
    t.eq(g.zones.B.hand.length, before + 1, 'and B draws');
  });

  test('Remembered: what was said survives a snapshot, and a batch\'s answer goes on after an undo', (mk, t) => {
    const T = mk({ library: Array(20).fill('Forest') });
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', { targets: [obj(bears)], remember: 'batch' });
    enterAll(T, 'A', Array(3).fill('Satyr Grovedancer'));
    goOnStack(T);
    T.bf('A', "Soul's Attendant");
    g.player('A').autoAnswers.push({ id: 'may:x', kind: 'may', scope: 'turn', key: 'k', turn: g.turn, answer: true, text: 'x: yes this turn' });
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    const had = JSON.stringify(g.player('A').autoAnswers);
    g.autoAnswer('A', 'clear', 'all');
    t.no(g.player('A').autoAnswers.length, 'cleared');
    t.ok(g.restore(snap), 'restored');
    t.eq(JSON.stringify(g.player('A').autoAnswers), had, 'what was remembered is back');
    t.eq(g.viewFor('A').autoAnswers.length, 2, 'and shown');
    t.ok(g.stack.every(s => s.batch), 'the batch is back too');
    T.resolve();
    t.eq(g.obj(bears.id).counters['+1/+1'], 3, 'and resolves');
  });

  test('Remembered: bots are never offered anything, and a question without a batch says nothing about one', (mk, t) => {
    const T = mk({ library: Array(20).fill('Forest') });
    const g = T.g;
    g.player('A').isBot = true;
    const bears = T.bf('A', 'Grizzly Bears');
    enterAll(T, 'A', Array(3).fill('Satyr Grovedancer'));
    goOnStack(T);
    t.no(g.stack.some(s => s.batch), 'no batch for a bot');
    t.no(T.asked.some(c => c.auto), 'nothing offered');
    T.resolve();
    const U = mk({ library: Array(20).fill('Forest') });
    const b2 = U.bf('A', 'Grizzly Bears');
    enterAll(U, 'A', Array(2).fill('Satyr Grovedancer'));
    goOnStack(U);
    t.no(U.g.stack.some(s => s.batch), 'two are not a batch');
    t.no(U.asked.some(c => c.auto), 'and no "same target" is offered');
    U.resolve();
    t.ok(bears && b2, 'done');
  });
};
