/* Controlling another player (CR 722): Mindslaver, Worst Fears, Sorin Markov, Emrakul, the Promised End. During the
   controlled player's next turn, the one controlling them makes every decision they would make (their questions,
   their priority, their attacks), sees what they see, and acts in their name with their cards and their mana; the
   controlled player can't act, but may still concede. */
'use strict';
const contracts = require('../contracts');

module.exports = (test) => {
  /* A table where A has just used Mindslaver on B, and it is B's next turn: B has a Mountain, a Lightning Bolt and a
     Grizzly Bears in hand, A has a Mountain of its own. */
  const slaved = (mk, opts) => {
    const T = mk(opts);
    const g = T.g;
    const ms = T.bf('A', 'Mindslaver');
    T.mana('A', '4');
    T.activate('A', ms, 0, { targets: ['B'] });
    const bolt = T.hand('B', 'Lightning Bolt');
    const bears = T.hand('B', 'Grizzly Bears');
    const bm = T.bf('B', 'Mountain');
    const am = T.bf('A', 'Mountain');
    return { T, g, ms, bolt, bears, bm, am };
  };
  const handShown = (v, pid) => v.players.find(p => p.id === pid).hand.every(o => !o.hidden);

  test('Player control: Mindslaver — A controls B during B\'s next turn, and only then', (mk, t) => {
    t.auto('Mindslaver');
    const { T, g, ms, bolt } = slaved(mk);
    T.hand('A', 'Island');
    t.zone(ms, 'graveyard', 'sacrificed');
    t.eq(g.playerController('B'), null, 'not yet: it is still A\'s turn');
    t.no(handShown(g.viewFor('A'), 'B'), 'A does not see B\'s hand yet');
    t.eq(g.viewFor('A').controlling, undefined, 'and has no seat of B\'s');
    T.nextTurn('B');
    t.eq(g.activePlayer.id, 'B', 'B is still the active player');
    t.eq(g.playerController('B'), 'A', 'A controls B');
    t.eq(g.deciderOf('B'), 'A', 'A decides for B');
    t.eq(g.deciderOf('A'), 'A', 'and for itself');
    const va = g.viewFor('A');
    t.ok(handShown(va, 'B'), 'A sees B\'s hand');
    t.ok(va.players.find(p => p.id === 'B').hand.some(o => o.id === bolt.id), 'the Bolt among it');
    t.eq((va.controlling || []).length, 1, 'A is sent B\'s seat');
    t.eq(va.controlling[0].id, 'B', 'B\'s');
    t.eq(va.controlling[0].view.you, 'B', 'the view B would have');
    t.ok(va.controlling[0].view.playable.includes(bolt.id), 'with B\'s plays in it');
    t.eq(va.players.find(p => p.id === 'B').controlledBy, 'A', 'everyone is told who controls B');
    const vb = g.viewFor('B');
    t.eq(vb.playable.length, 0, 'B\'s own view offers B nothing to do');
    t.eq(vb.controlling, undefined, 'and no seat of anybody\'s');
    t.no(handShown(g.viewFor('B'), 'A'), 'B still does not see A\'s hand');
    // the turn ends: control ends with it
    T.nextTurn('A');
    t.eq(g.playerController('B'), null, 'over once B\'s turn is');
    t.no(handShown(g.viewFor('A'), 'B'), 'B\'s hand is hidden from A again');
    t.eq(g.viewFor('A').controlling, undefined, 'and A has no seat of B\'s');
    T.nextTurn('B');
    t.eq(g.playerController('B'), null, 'B\'s turn after that is B\'s own');
  });

  test('Player control: intents — A\'s for B are accepted, B\'s own are not (but B may concede)', (mk, t) => {
    const { T, g } = slaved(mk);
    t.eq(g.intentActor('A', { kind: 'pass', as: 'B' }), null, 'not before B\'s turn');
    T.nextTurn('B');
    t.eq(g.intentActor('A', { kind: 'pass', as: 'B' }), 'B', 'A passes for B');
    t.eq(g.intentActor('A', { kind: 'cast', objId: 'x', as: 'B' }), 'B', 'A casts for B');
    t.eq(g.intentActor('A', { kind: 'pass' }), 'A', 'and still acts for itself');
    t.eq(g.intentActor('B', { kind: 'pass' }), null, 'B can\'t pass for itself');
    t.ok(/A is controlling you/.test(g.lastError), 'and is told why');
    t.eq(g.intentActor('B', { kind: 'cast', objId: 'x' }), null, 'nor cast');
    t.eq(g.intentActor('B', { kind: 'concede' }), 'B', 'but B may concede');
    t.eq(g.intentActor('B', { kind: 'chat', text: 'hi' }), 'B', 'and talk');
    t.eq(g.intentActor('A', { kind: 'concede', as: 'B' }), null, 'A can\'t make B concede');
    t.eq(g.intentActor('B', { kind: 'pass', as: 'A' }), null, 'B can\'t act for A');
  });

  test('Player control: A casts B\'s spell — paid with B\'s mana, B\'s spell, A chooses its target', (mk, t) => {
    const { T, g, bolt, bm, am } = slaved(mk);
    T.nextTurn('B');
    const bear = T.bf('A', 'Grizzly Bears');
    const as = g.intentActor('A', { kind: 'cast', objId: bolt.id, as: 'B' });
    t.eq(as, 'B', 'accepted');
    t.ok(g.castSpell(as, bolt.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'cast');
    const item = T.stackItem(bolt);
    t.eq(item.controller, 'B', 'B\'s spell');
    t.ok(bm.tapped, 'B\'s Mountain paid for it');
    t.no(am.tapped, 'not A\'s');
    T.resolve();
    t.eq(T.life('B'), 17, 'B Bolted itself');
    t.eq(T.life('A'), 20, 'A untouched');
    t.zone(bear, 'battlefield');
    t.zone(bolt, 'graveyard', 'B\'s graveyard');
    t.eq(bolt.owner, 'B', 'still B\'s card');
  });

  test('Player control: B\'s questions are A\'s to answer, in A\'s seat of B', (mk, t) => {
    const { T, g, bolt, bears } = slaved(mk);
    T.nextTurn('B');
    // B has to discard a card (a question with two answers): it is B's question, put to A
    T.hand('B', 'Island');
    g.queueChoice({ type: 'discard', playerId: 'B', count: 1, prompt: 'Discard a card.' });
    const ch = g.pendingChoice;
    t.eq(ch.playerId, 'B', 'the question is B\'s');
    const va = g.viewFor('A'), vb = g.viewFor('B');
    t.ok(va.pendingChoice && va.pendingChoice.waiting, 'A\'s own view: waiting');
    t.ok(va.controlling[0].view.pendingChoice && !va.controlling[0].view.pendingChoice.waiting, 'A\'s seat of B: the whole question');
    t.ok(vb.pendingChoice && vb.pendingChoice.waiting, 'B\'s own view: waiting, not B\'s to answer');
    t.eq(g.intentActor('B', { kind: 'choice', data: { cardIds: [bolt.id] } }), null, 'B can\'t answer it');
    const as = g.intentActor('A', { kind: 'choice', data: { cardIds: [bolt.id] }, as: 'B' });
    t.ok(g.resolveChoice(as, { cardIds: [bolt.id] }), 'A answers for B');
    t.zone(bolt, 'graveyard', 'A chose the Bolt');
    t.zone(bears, 'hand');
  });

  test('Player control: the contracts accept A\'s seat of B only while A controls B', (mk, t) => {
    const { T, g } = slaved(mk);
    const isPrivacy = (list) => list.filter(x => x.rule === 'view.privacy');
    T.nextTurn('B');
    const va = g.viewFor('A');
    t.eq(isPrivacy(contracts.checkView(va, 'A', g)).length, 0, 'fine while A controls B');
    t.eq(contracts.checkView(g.viewFor('B'), 'B', g).length, 0, 'and B\'s own view is fine too');
    T.nextTurn('A');
    // the same seat, sent after the turn is over, is a leak
    const late = g.viewFor('A');
    late.controlling = va.controlling;
    t.ok(isPrivacy(contracts.checkView(late, 'A', g)).length > 0, 'a seat of B after the turn is a privacy violation');
    const shown = g.viewFor('A');
    shown.players.find(p => p.id === 'B').hand = va.players.find(p => p.id === 'B').hand;
    t.ok(isPrivacy(contracts.checkView(shown, 'A', g)).some(x => /hand/.test(x.path)), 'and so is B\'s hand');
  });

  test('Player control: Emrakul, the Promised End — cheaper by card types, then a controlled turn and an extra one', (mk, t) => {
    t.auto('Emrakul, the Promised End');
    const T = mk();
    const g = T.g;
    const em = T.hand('A', 'Emrakul, the Promised End');
    for (const n of ['Grizzly Bears', 'Lightning Bolt', 'Forest']) T.grave('A', n);
    // a creature, an instant and a land: {13} less 3
    T.mana('A', '9');
    t.no(g.castSpell('A', em.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'not for nine');
    T.mana('A', '1');
    T.cast('A', em, { targets: ['B'] });
    t.zone(em, 'battlefield');
    t.ok(g.player('B').controlNext && g.player('B').controlNext[0].extra === 1, 'B\'s next turn is A\'s, with an extra turn after');
    const before = g.turn;
    T.nextTurn('B');
    t.eq(g.playerController('B'), 'A', 'A controls B\'s next turn');
    const controlled = g.turn;
    t.eq(controlled, before + 1, 'which is the next one');
    // the turn ends: B takes the extra turn, as itself
    for (let guard = 0; guard < 400 && g.turn === controlled; guard++) { T.settle(); g.passPriority(g.priorityPlayer.id, true); }
    t.eq(g.activePlayer.id, 'B', 'B again');
    t.ok(g.isExtraTurn, 'an extra turn');
    t.eq(g.playerController('B'), null, 'B\'s own');
    T.nextTurn('A');
    t.eq(g.turn, controlled + 2, 'then A');
  });

  test('Player control: Emrakul\'s cast trigger targets an opponent only', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const em = T.hand('A', 'Emrakul, the Promised End');
    T.mana('A', '13');
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'C' }] });
    T.cast('A', em);
    t.ok(T.asked.some(ch => ch.type === 'pickTarget' && ch.options[0].every(x => x.id !== 'A')), 'asked which opponent');
    t.ok(g.player('C').controlNext, 'C will be controlled');
    t.eq(g.player('A').controlNext, undefined, 'never yourself');
  });

  test('Player control: two effects on the same player — the newest controls, each Emrakul\'s extra turn counts', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    g._controlNextTurn('A', 'C', 'Emrakul, the Promised End', true);
    g._controlNextTurn('B', 'C', 'Mindslaver', false);
    T.nextTurn('C');
    t.eq(g.playerController('C'), 'B', 'the newest one controls C');
    t.eq(g.player('C').controlledBy.extra, 1, 'Emrakul\'s extra turn still comes');
  });

  test('Player control: B loses during the controlled turn — no extra turn', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    g._controlNextTurn('A', 'B', 'Emrakul, the Promised End', true);
    T.nextTurn('B');
    t.eq(g.playerController('B'), 'A', 'controlled');
    g.concede('B');
    t.eq(g.activePlayer.id, 'C', 'B is out, and the turn passes on');
    t.no(g.extraTurnsQueue.includes('B'), 'with no extra turn for B');
  });

  test('Player control: Worst Fears and Sorin Markov', (mk, t) => {
    t.auto('Worst Fears');
    t.auto('Sorin Markov');
    const T = mk();
    const g = T.g;
    const wf = T.hand('A', 'Worst Fears');
    T.mana('A', 'B7');
    T.cast('A', wf, { targets: ['B'] });
    t.zone(wf, 'exile', 'Worst Fears exiles itself');
    t.ok(g.player('B').controlNext, 'B\'s next turn is A\'s');
    const T2 = mk();
    const sorin = T2.bf('A', 'Sorin Markov', { counters: { loyalty: 7 } });
    T2.activate('A', sorin, 2, { targets: ['B'] });
    T2.nextTurn('B');
    t.eq(T2.g.playerController('B'), 'A', 'Sorin\'s −7');
    const T3 = mk();
    const s3 = T3.bf('A', 'Sorin Markov');
    T3.activate('A', s3, 1, { targets: ['B'] });
    t.eq(T3.life('B'), 10, 'Sorin\'s −3: B\'s life total becomes 10');
  });

  test('Player control: a human controlling a bot — the bot decides nothing, its questions are asked', (mk, t) => {
    const { T, g } = slaved(mk);
    g.player('B').isBot = true;
    t.ok(g.player('B').isBot, 'B is a bot');
    const M = T.MTG;
    const was = M.settings.botSpeed;
    M.settings.botSpeed = 0;
    try {
      const botB = new M.bots.BotPlayer(g, 'B', 5, null, { personality: 'none' });
      T.nextTurn('B');
      t.no(g.player('B').isBot, 'while A (a person) controls B, B\'s decisions are a person\'s');
      t.eq(g.priorityPlayer.id, 'B', 'B has priority');
      const v = g.stateVersion;
      botB.tick();
      t.eq(g.stateVersion, v, 'B\'s bot does not act for B');
      t.eq(g.priorityPlayer.id, 'B', 'B still has priority');
      // what a bot would decide by itself is asked instead: the discard down to seven, at B's cleanup
      for (let i = 0; i < 7; i++) T.hand('B', 'Island');
      for (let guard = 0; guard < 80 && !g.pendingChoice && g.turn === T.g.turn && g.activePlayer.id === 'B'; guard++) g.passPriority(g.priorityPlayer.id, true);
      t.ok(g.pendingChoice && g.pendingChoice.type === 'discardToHandSize' && g.pendingChoice.playerId === 'B', 'B\'s discard is asked, for A to answer');
      botB.tick();
      t.ok(g.pendingChoice && g.pendingChoice.type === 'discardToHandSize', 'and B\'s bot leaves it alone');
      T.nextTurn('A');
      t.ok(g.player('B').isBot, 'a bot again once the turn is over');
    } finally { M.settings.botSpeed = was; }
  });

  test('Player control: a bot controlling a person — it decides for them, against them', (mk, t) => {
    const { T, g, bolt, bears } = slaved(mk);
    g.player('A').isBot = true;
    const M = T.MTG;
    const botA = new M.bots.BotPlayer(g, 'A', 5, null, { personality: 'none' });
    T.nextTurn('B');
    t.ok(g.player('B').isBot, 'B\'s decisions are a bot\'s this turn');
    t.eq(g.priorityPlayer.id, 'B', 'B has priority');
    const turn = g.turn, step = g.step;
    botA.tick();
    t.ok(g.priorityPlayer.id !== 'B' || g.step !== step, 'A\'s bot passed for B');
    t.zone(bolt, 'hand', 'without casting B\'s Bolt');
    t.eq(g.turn, turn, 'still B\'s turn');
    // a question of B's, answered by A's bot: the best card goes
    const land = T.hand('B', 'Island');
    g.queueChoice({ type: 'discard', playerId: 'B', count: 1, prompt: 'Discard a card.' });
    botA._controlChoice(g.pendingChoice, 'B');
    t.zone(land, 'hand', 'not the land');
    t.ok(bolt.zone === 'graveyard' || bears.zone === 'graveyard', 'a spell of B\'s is thrown away');
    // B's attack: nothing attacks
    const bb = T.bf('B', 'Grizzly Bears');
    for (let guard = 0; guard < 50 && !(g.pendingChoice && g.pendingChoice.type === 'declareAttackers'); guard++) { T.settle(); g.passPriority(g.priorityPlayer.id, true); }
    const ch = g.pendingChoice;
    t.ok(ch && ch.type === 'declareAttackers' && ch.playerId === 'B', 'B is asked to attack');
    botA._controlChoice(ch, 'B');
    t.no(bb.attacking, 'B\'s Bears stay home');
    T.nextTurn('A');
    t.no(g.player('B').isBot, 'B is a person again');
  });

  test('Player control: Mindslaver on yourself does nothing', (mk, t) => {
    const T = mk();
    const g = T.g;
    const ms = T.bf('A', 'Mindslaver');
    T.mana('A', '4');
    T.activate('A', ms, 0, { targets: ['A'] });
    T.nextTurn('B');
    T.nextTurn('A');
    t.eq(g.playerController('A'), null, 'nobody controls A');
    t.eq(g.intentActor('A', { kind: 'pass' }), 'A', 'A acts for itself');
  });
};
