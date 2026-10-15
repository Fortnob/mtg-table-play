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

  test('Player control: with Sen Triplets — A, controlling B, plays from its own hand as B; the lock still holds', (mk, t) => {
    const { T, g, bolt, bm } = slaved(mk);
    // B's Sen Triplets: at B's upkeep, A (the only opponent) is locked out and B may cast from A's hand
    T.bf('B', 'Sen Triplets');
    const aBolt = T.hand('A', 'Lightning Bolt');
    T.nextTurn('B');
    t.eq(g.playerController('B'), 'A', 'A controls B');
    t.ok(g.viewFor('A').players.find(p => p.id === 'A').lockedOut, 'A is locked out by B\'s Sen Triplets');
    t.eq(g.intentActor('A', { kind: 'cast', objId: aBolt.id, as: 'B' }), 'B', 'A may act as B');
    const seat = g.viewFor('A').controlling[0].view;
    t.ok(seat.playable.includes(aBolt.id), 'A\'s own Bolt is playable from B\'s seat (B\'s leave, from Sen)');
    t.ok(seat.playable.includes(bolt.id), 'and B\'s own');
    t.no(g.castSpell('A', aBolt.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'A, locked out, can\'t cast it as A');
    t.ok(g.castSpell('B', aBolt.id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'but as B it can');
    t.eq(T.stackItem(aBolt).controller, 'B', 'B\'s spell');
    t.ok(bm.tapped, 'paid with B\'s mana');
    T.resolve();
    t.eq(T.life('A'), 17, 'A Bolted itself, as B');
    // and a lock on B holds while A controls B
    const T2 = mk();
    const g2 = T2.g;
    g2._controlNextTurn('A', 'B', 'Mindslaver', false);
    T2.bf('A', 'Sen Triplets');
    const b2 = T2.hand('B', 'Lightning Bolt');
    T2.bf('B', 'Mountain');
    T2.nextTurn('B');
    T2.nextTurn('A');
    t.eq(g2.playerController('B'), null, 'A\'s own turn');
    t.ok(g2.viewFor('B').players.find(p => p.id === 'B').lockedOut, 'B locked out by A\'s Sen Triplets');
    g2.player('B').controlledBy = { by: 'A', turn: g2.turn, src: 'Mindslaver', extra: 0 };
    t.eq(g2.playerController('B'), 'A', 'and (as a test) controlled by A this turn too');
    t.no(g2.viewFor('A').controlling[0].view.playable.includes(b2.id), 'B\'s Bolt is not playable from B\'s seat');
    t.no(g2.castSpell('B', b2.id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'nor castable as B');
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

  /* ---- a hold for part of a turn: Secret of Bloodbending (a combat phase), Word of Command (while it resolves) ---- */
  const toStep = (T, step) => { const g = T.g; for (let guard = 0; guard < 30 && g.step !== step; guard++) { T.settle(); g.passPriority(g.priorityPlayer.id, true); } };
  const toPhase = (T, ph) => { const g = T.g; for (let guard = 0; guard < 40 && g.phase.id !== ph; guard++) { T.settle(); g.passPriority(g.priorityPlayer.id, true); } };

  test('Player control: Secret of Bloodbending — A controls B during B\'s next combat phase, and only then', (mk, t) => {
    t.auto('Secret of Bloodbending');
    const T = mk();
    const g = T.g;
    const sob = T.hand('A', 'Secret of Bloodbending');
    T.mana('A', 'UUUU');
    T.cast('A', sob, { targets: ['B'] });
    t.zone(sob, 'exile', 'it exiles itself');
    const rec = (g.player('B').controlNext || [])[0];
    t.ok(rec && rec.span === 'combat', 'B\'s next combat phase is A\'s');
    const bb = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B');
    t.eq(g.playerController('B'), null, 'not in B\'s main phase');
    t.eq(g.viewFor('A').controlling, undefined, 'no seat of B\'s yet');
    // on to B's combat: A holds B from its beginning
    toStep(T, 'beginCombat');
    t.eq(g.step, 'beginCombat', 'the beginning of combat');
    t.eq(g.playerController('B'), 'A', 'A controls B');
    const vb = g.viewFor('A').players.find(p => p.id === 'B');
    t.eq(vb.controlledBy, 'A', 'everyone is told');
    t.eq(vb.controlSpan, 'combat', 'for this combat');
    t.eq(vb.controlSrc, 'Secret of Bloodbending', 'by Secret of Bloodbending');
    t.eq((g.viewFor('A').controlling || []).length, 1, 'A is sent B\'s seat');
    t.eq(g.intentActor('B', { kind: 'pass' }), null, 'B can\'t act');
    t.ok(/controlling you during this combat/.test(g.lastError), 'and is told for how long');
    // B's attack is A's to declare
    for (let guard = 0; guard < 20 && !(g.pendingChoice && g.pendingChoice.type === 'declareAttackers'); guard++) g.passPriority(g.priorityPlayer.id, true);
    t.ok(g.pendingChoice && g.pendingChoice.playerId === 'B', 'B is asked to attack');
    t.eq(g.intentActor('A', { kind: 'attack', attackers: [], as: 'B' }), 'B', 'A declares for B');
    t.ok(g.declareAttackers('B', []), 'nothing attacks');
    t.no(bb.attacking, 'the Bears stay home');
    // the end of combat: B is B's own again
    toPhase(T, 'postcombat');
    t.eq(g.phase.id, 'postcombat', 'the second main phase');
    t.eq(g.playerController('B'), null, 'B\'s own again');
    t.eq(g.player('B').controlCombat, null, 'the hold is gone');
    t.eq(g.viewFor('A').controlling, undefined, 'and A\'s seat of B with it');
    T.nextTurn('A');
    T.nextTurn('B');
    toStep(T, 'beginCombat');
    t.eq(g.playerController('B'), null, 'B\'s combat after that is B\'s own');
  });

  test('Player control: Secret of Bloodbending — waterbent, the whole of B\'s next turn', (mk, t) => {
    const T = mk();
    const g = T.g;
    const sob = T.hand('A', 'Secret of Bloodbending');
    T.mana('A', 'UUUU10');
    T.cast('A', sob, { targets: ['B'], payAdditional: true });
    const rec = (g.player('B').controlNext || [])[0];
    t.ok(rec && !rec.span, 'B\'s next turn, not just its combat');
    T.nextTurn('B');
    t.eq(g.playerController('B'), 'A', 'A controls B from the start of B\'s turn');
    t.eq(g.viewFor('B').players.find(p => p.id === 'B').controlSpan, 'turn', 'for the turn');
  });

  test('Player control: holds for a turn and for a combat — the newest one counts', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    g._controlNextTurn('A', 'C', 'Secret of Bloodbending', false, 'combat');
    g._controlNextTurn('B', 'C', 'Mindslaver', false);
    T.nextTurn('C');
    t.eq(g.playerController('C'), 'B', 'B\'s Mindslaver, all turn');
    toStep(T, 'beginCombat');
    t.eq(g.playerController('C'), 'B', 'still B in combat: Mindslaver is the newer');
    const T2 = mk({ players: ['A', 'B', 'C'] });
    const g2 = T2.g;
    g2._controlNextTurn('B', 'C', 'Mindslaver', false);
    g2._controlNextTurn('A', 'C', 'Secret of Bloodbending', false, 'combat');
    T2.nextTurn('C');
    t.eq(g2.playerController('C'), 'B', 'B before combat');
    toStep(T2, 'beginCombat');
    t.eq(g2.playerController('C'), 'A', 'A during combat: Secret is the newer');
    toPhase(T2, 'postcombat');
    t.eq(g2.playerController('C'), 'B', 'and B again after it');
  });

  /* Word of Command: A looks at B's hand and picks a card; B plays it, A choosing everything for B. */
  const commanded = (mk, opts) => {
    const T = mk(opts);
    const g = T.g;
    const woc = T.hand('A', 'Word of Command');
    T.mana('A', 'BB');
    return { T, g, woc };
  };

  test('Player control: Word of Command — B casts the chosen Bolt at its own Bears, A deciding, only while it resolves', (mk, t) => {
    t.auto('Word of Command');
    const { T, g, woc } = commanded(mk);
    const bolt = T.hand('B', 'Lightning Bolt');
    const land = T.hand('B', 'Island');
    const mtn = T.bf('B', 'Mountain');
    const elf = T.bf('B', 'Llanowar Elves');
    const bear = T.bf('B', 'Grizzly Bears');
    let seen = null;
    T.answer('pickCard', (ch) => {
      t.eq(ch.playerId, 'A', 'A chooses the card');
      t.eq(ch.purpose, 'commandCard', 'one for B to play');
      t.eq(g.playerController('B'), null, 'not yet controlling B');
      return { cardIds: [bolt.id] };
    });
    T.answer('pickTarget', (ch) => {
      seen = { pid: ch.playerId, by: g.playerController('B'), view: g.viewFor('A'), vb: g.viewFor('B'), opts: ch.options[0].map(x => x.id),
        ownAnswer: g.intentActor('B', { kind: 'choice', data: {} }), asA: g.intentActor('A', { kind: 'choice', data: {}, as: 'B' }) };
      return { targets: [{ kind: 'object', id: bear.id }] };
    });
    T.cast('A', woc, { targets: ['B'] });
    t.ok(seen, 'B\'s Bolt asked for its target');
    t.eq(seen.pid, 'B', 'B\'s question');
    t.eq(seen.by, 'A', 'A controls B while Word of Command resolves');
    t.eq(seen.ownAnswer, null, 'B can\'t answer it');
    t.eq(seen.asA, 'B', 'A answers it as B');
    t.ok(seen.opts.includes(bear.id) && seen.opts.includes('A'), 'any target B could choose');
    const sb = seen.view.players.find(p => p.id === 'B');
    t.eq(sb.controlSpan, 'resolve', 'for as long as it resolves');
    t.eq(sb.controlSrc, 'Word of Command', 'Word of Command');
    t.ok(seen.view.controlling && seen.view.controlling[0].id === 'B', 'A has B\'s seat meanwhile');
    t.ok(seen.view.controlling[0].view.pendingChoice && !seen.view.controlling[0].view.pendingChoice.waiting, 'with the question in it');
    t.ok(seen.vb.pendingChoice.waiting, 'B only sees it waiting');
    t.zone(bolt, 'graveyard', 'B\'s Bolt was cast and resolved');
    t.zone(bear, 'graveyard', 'at B\'s own Bears');
    t.ok(mtn.tapped, 'paid with B\'s Mountain');
    t.no(elf.tapped, 'not B\'s Elves: lands only');
    t.zone(land, 'hand', 'the rest of B\'s hand stays');
    t.eq(g.playerController('B'), null, 'B\'s own again');
    t.eq(g.player('B').controlRes, null, 'no hold left');
    t.zone(woc, 'graveyard');
  });

  test('Player control: Word of Command — A controls B again while the Bolt resolves, not while it waits', (mk, t) => {
    const { T, g, woc } = commanded(mk);
    const bolt = T.hand('B', 'Lightning Bolt');
    T.bf('B', 'Mountain');
    T.answer('pickCard', { cardIds: [bolt.id] });
    T.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T.cast('A', woc, { targets: ['B'], resolve: false });
    // Word of Command resolves; the Bolt waits on the stack above nothing
    for (let guard = 0; guard < 10 && woc.zone !== 'graveyard'; guard++) { T.settle(); g.passPriority(g.priorityPlayer.id, true); }
    T.settle();
    t.zone(woc, 'graveyard', 'Word of Command has resolved');
    const item = T.stackItem(bolt);
    t.ok(item && item.controller === 'B', 'B\'s Bolt on the stack');
    t.eq(g.playerController('B'), null, 'nobody controls B while it waits');
    t.ok((g.player('B').controlRes || []).some(w => w.stackId === item.id), 'but A will while it resolves');
    T.resolve();
    t.eq(T.life('B'), 17, 'B Bolted itself');
    t.eq(g.player('B').controlRes, null, 'and the hold is gone');
  });

  test('Player control: Word of Command — a spell B\'s lands can\'t pay for stays in hand; the Elves are no help', (mk, t) => {
    const { T, g, woc } = commanded(mk);
    const bears = T.hand('B', 'Grizzly Bears');
    T.bf('B', 'Forest');
    const elf = T.bf('B', 'Llanowar Elves');
    T.answer('pickCard', { cardIds: [bears.id] });
    T.cast('A', woc, { targets: ['B'] });
    t.zone(bears, 'hand', 'not cast');
    t.no(elf.tapped, 'the Elves untapped');
    t.ok(g.log.some(l => /B can't play Grizzly Bears/.test(l.text)), 'said so');
    t.eq(g.playerController('B'), null);
  });

  test('Player control: Word of Command — A chooses which of B\'s lands pay, and X', (mk, t) => {
    const { T, woc } = commanded(mk);
    const bears = T.hand('B', 'Grizzly Bears');
    const f1 = T.bf('B', 'Forest'), f2 = T.bf('B', 'Forest'), m1 = T.bf('B', 'Mountain');
    T.answer('pickCard', { cardIds: [bears.id] });
    let q = null;
    T.answer('choose', { picks: [] });     // (the look at B's hand)
    T.answer('choose', (ch) => { q = ch; return { picks: [f2.id, m1.id] }; });
    T.cast('A', woc, { targets: ['B'] });
    t.ok(q && q.purpose === 'commandLands' && q.playerId === 'B', 'B\'s lands to tap, asked as B');
    t.eq(q.min, 2, 'two of them');
    t.zone(bears, 'battlefield', 'B\'s Bears were cast');
    t.eq(bears.controller, 'B', 'B\'s');
    t.ok(f2.tapped && m1.tapped, 'with the lands A chose');
    t.no(f1.tapped, 'not the other Forest');
    // a choice the lands can't pay is refused
    const { T: T2, g: g2, woc: w2 } = commanded(mk);
    const b2 = T2.hand('B', 'Grizzly Bears');
    T2.bf('B', 'Forest');
    const m2 = T2.bf('B', 'Mountain'), m3 = T2.bf('B', 'Mountain');
    T2.answer('pickCard', { cardIds: [b2.id] });
    T2.answer('choose', { picks: [] });
    let refused = null;
    T2.answer('choose', (ch) => {
      refused = ch.purpose === 'commandLands' && !g2.resolveChoice('B', { picks: [m2.id, m3.id] });
      return { picks: [ch.items[0].id, ch.items[1].id] };
    });
    T2.cast('A', w2, { targets: ['B'] });
    t.ok(refused, 'two Mountains can\'t pay {1}{G}: refused');
    t.zone(b2, 'battlefield', 'the first lands on offer can');
    // X: Blaze, with three Mountains — X up to 2
    const { T: T3, g: g3, woc: w3 } = commanded(mk);
    const blaze = T3.hand('B', 'Blaze');
    for (let i = 0; i < 3; i++) T3.bf('B', 'Mountain');
    T3.answer('pickCard', { cardIds: [blaze.id] });
    let xq = null;
    T3.answer('choose', { picks: [] });
    T3.answer('choose', (ch) => { xq = ch; return { number: 2 }; });
    T3.answer('pickTarget', { targets: [{ kind: 'player', id: 'B' }] });
    T3.cast('A', w3, { targets: ['B'] });
    t.ok(xq && xq.purpose === 'commandX' && xq.number.max === 2, 'X asked, up to 2');
    t.eq(T3.life('B'), 18, 'Blaze for 2 at B');
    t.zone(blaze, 'graveyard');
    t.eq(g3.playerController('B'), null);
  });

  test('Player control: Word of Command — a land, played on B\'s turn only, with a land play left', (mk, t) => {
    const { T, woc } = commanded(mk);
    const isl = T.hand('B', 'Island');
    T.answer('pickCard', { cardIds: [isl.id] });
    T.cast('A', woc, { targets: ['B'] });
    t.zone(isl, 'hand', 'not on A\'s turn (CR 305.3)');
    // on B's turn, A casting it once B passes
    const T2 = mk();
    const g2 = T2.g;
    const w2 = T2.hand('A', 'Word of Command');
    const i2 = T2.hand('B', 'Island');
    T2.nextTurn('B');
    T2.mana('A', 'BB');
    g2.passPriority('B');
    T2.answer('pickCard', { cardIds: [i2.id] });
    T2.cast('A', w2, { targets: ['B'] });
    t.zone(i2, 'battlefield', 'B played it');
    t.eq(g2.player('B').landsPlayed, 1, 'as B\'s land for the turn');
  });

  test('Player control: Word of Command — a bot casting it makes B aim B\'s spell at B; B\'s own bot is held still', (mk, t) => {
    const { T, g, woc } = commanded(mk);
    const M = T.MTG;
    const was = M.settings.botSpeed;
    M.settings.botSpeed = 0;
    try {
      g.player('A').isBot = true;
      g.player('B').isBot = true;
      const botA = new M.bots.BotPlayer(g, 'A', 5, null, { personality: 'none' });
      const botB = new M.bots.BotPlayer(g, 'B', 5, null, { personality: 'none' });
      const bolt = T.hand('B', 'Lightning Bolt');
      T.hand('B', 'Island');
      T.bf('B', 'Mountain');
      const bear = T.bf('B', 'Grizzly Bears');
      t.ok(g.castSpell('A', woc.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'A casts it');
      let heldStill = true, picked = false;
      for (let guard = 0; guard < 40 && (g.stack.length || g.pendingChoice); guard++) {
        const ch = g.pendingChoice;
        if (!ch) { g.passPriority(g.priorityPlayer.id, true); continue; }
        if (ch.playerId === 'B') {
          const v = g.stateVersion;
          botB.tick();
          if (g.stateVersion !== v) heldStill = false;
          t.eq(g.deciderOf('B'), 'A', 'B\'s question is A\'s');
          botA._controlChoice(ch, 'B');
        } else { if (ch.type === 'pickCard') picked = true; botA.doChoice(ch, null); }
      }
      t.ok(picked, 'A\'s bot picked the card');
      t.ok(heldStill, 'B\'s own bot left B\'s questions alone');
      t.zone(bolt, 'graveyard', 'A\'s bot chose the Bolt over the Island, and B cast it');
      t.ok(bear.zone === 'graveyard' || T.life('B') === 17, 'at B or B\'s Bears');
      t.eq(T.life('A'), 20, 'never at A');
    } finally { M.settings.botSpeed = was; }
  });

  test('Player control: Word of Command — the contracts take A\'s seat of B while it resolves', (mk, t) => {
    const { T, g, woc } = commanded(mk);
    const bolt = T.hand('B', 'Lightning Bolt');
    T.bf('B', 'Mountain');
    T.answer('pickCard', { cardIds: [bolt.id] });
    let bad = null;
    T.answer('pickTarget', () => {
      bad = contracts.checkView(g.viewFor('A'), 'A', g);
      return { targets: [{ kind: 'player', id: 'B' }] };
    });
    T.cast('A', woc, { targets: ['B'] });
    t.ok(bad && bad.length === 0, 'no complaint: ' + JSON.stringify(bad));
  });

  test('Player control: Construct a Cosmic Cube and The Dominion Bracelet', (mk, t) => {
    t.auto('Construct a Cosmic Cube');
    t.auto('The Dominion Bracelet');
    const T = mk();
    const g = T.g;
    const cube = T.bf('A', 'Construct a Cosmic Cube', { counters: { plan: 6 } });
    g.addCounters(cube, 'plan', 1);
    T.resolve();
    t.zone(cube, 'graveyard', 'the seventh plan counter: sacrificed');
    t.eq((g.player('B').controlNext || []).length, 1, 'B\'s next turn is A\'s');
    T.nextTurn('B');
    t.eq(g.playerController('B'), 'A', 'and so it is');
    // The Dominion Bracelet: {15} less the creature's power, exiling the Bracelet, as a sorcery
    const T2 = mk();
    const g2 = T2.g;
    const br = T2.bf('A', 'The Dominion Bracelet');
    const giant = T2.bf('A', 'Hill Giant');
    T2.mana('A', '1');
    T2.activate('A', br, 0, { targets: [giant] });
    t.eq(br.attachedTo, giant.id, 'equipped');
    t.eq(g2.powerOf(giant), 4, '+1/+1');
    T2.mana('A', '10');
    t.no(g2.activateAbility('A', giant.id, 0, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'not for {10}: {15} less 4 is {11}');
    T2.mana('A', '1');
    T2.activate('A', giant, 0, { targets: ['B'] });
    t.zone(br, 'exile', 'the Bracelet is exiled');
    t.eq((g2.player('B').controlNext || []).length, 1, 'B\'s next turn is A\'s');
  });
};
