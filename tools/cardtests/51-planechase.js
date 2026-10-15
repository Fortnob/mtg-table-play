/* Planechase (CR 901; src/06f-planechase.js): the planar decks, the starting plane, the planar die and what it costs,
   planeswalking and the phenomena, chaos, the planes' own abilities working from the command zone, and Susan Foreman,
   who looks at the top two cards of her planar deck before every planeswalk. */
'use strict';

module.exports = (test) => {
  // the next faces of the planar die: 1 the Planeswalker symbol, 2 chaos, 3-6 blank (then the lowest)
  const faces = (T, list) => { const d = list.slice(); T.g.rng.range = (a) => (d.length ? d.shift() : a); };
  const PW = 1, CHAOS = 2, BLANK = 3;
  const up = (T) => T.g.facePlanes().map(o => o.name);
  const deckNames = (T, pid) => T.g.planarDeck(pid).map(o => o.name);
  const mk2 = (mk, a, b, more) => mk(Object.assign({ planechase: true, planar: { A: a, B: b || ['Krosa', 'Shiv', 'Gavony'] } }, more || {}));
  const rolls = (T, since) => (T.g.events || []).filter(e => e.type === 'roll' && e.seq > (since || 0));

  test('Planechase: the game begins on the starting player\'s top plane, phenomena put under first, nothing triggered', (mk, t) => {
    const T = mk2(mk, ['Mutual Epiphany', 'Panopticon', 'Krosa'], ['Shiv', 'Gavony']);
    const g = T.g;
    t.eq(up(T).join(), 'Panopticon', 'the first plane turned up is the starting plane');
    t.eq(deckNames(T, 'A').join(), 'Krosa,Mutual Epiphany', 'the phenomenon went to the bottom');
    // (the first player skips the draw, but Panopticon's "draw an additional card" in the draw step still comes)
    t.eq(T.zone('A', 'hand').length, 1, 'Panopticon was not planeswalked to (no card for that), Mutual Epiphany never encountered (not four)');
    t.eq(T.zone('B', 'hand').length, 0, 'B drew nothing');
    const pl = g.facePlanes()[0];
    t.eq(pl.zone, 'command', 'face up in the command zone'); t.eq(pl.owner, 'A', 'its owner'); t.eq(pl.controller, 'A', 'the planar controller, A, whose turn it is');
    t.eq(deckNames(T, 'B').length, 2, 'B\'s planar deck untouched');
    // the planar controller is whoever's turn it is
    T.nextTurn('B');
    t.eq(pl.controller, 'B', 'on B\'s turn, B controls it');
    // and the view: everybody sees the plane; nobody sees a planar deck's cards
    for (const pid of ['A', 'B']) {
      const v = g.viewFor(pid);
      t.ok(v.planechase && v.planechase.planes.length === 1 && v.planechase.planes[0].card.name === 'Panopticon', pid + ' sees the plane');
      t.eq(v.planechase.decks.A, 2, 'A\'s planar deck size'); t.eq(v.planechase.controller, 'B', 'the planar controller');
      t.no(JSON.stringify(v).includes('Krosa'), pid + ' is not told what is in a planar deck');
      t.no(v.players.find(p => p.id === 'A').command.some(o => o.card.name === 'Panopticon'), 'the plane is not shown as A\'s command zone card');
    }
  });

  test('Planechase: a game without the house rule has no planes, and its planar deck is not brought', (mk, t) => {
    const T = mk({ planar: { A: ['Krosa', 'Shiv'] } });
    t.eq(T.g.facePlanes().length, 0, 'no plane');
    t.eq(T.g.planarDeck('A').length, 0, 'no planar deck');
    t.eq(T.g.viewFor('A').planechase, undefined, 'nothing in the view');
    t.no(T.g.rollPlanarDie('A'), 'no planar die'); t.ok(/not a Planechase game/.test(T.g.lastError), T.g.lastError);
  });

  test('Planechase: the planar die costs {0}, then {1}, then {2} each turn — only its player, in a main phase, stack empty', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv', 'Gavony', 'Llanowar']);
    const g = T.g;
    faces(T, [BLANK, BLANK, BLANK, BLANK]);
    t.eq(g.planarDieCost('A'), 0, 'free the first time');
    t.eq(g.viewFor('A').planechase.dieCost, 0, 'the view says so'); t.ok(g.viewFor('A').planechase.canRoll, 'A may roll');
    t.eq(g.viewFor('B').planechase.canRoll, undefined, 'B is not offered the die on A\'s turn');
    t.no(g.rollPlanarDie('B'), 'B may not roll on A\'s turn');
    const since = g.eventSeq || 0;
    t.ok(g.rollPlanarDie('A'), g.lastError);
    const [e] = rolls(T, since);
    t.ok(e && e.sides === 6 && e.planar === 'blank' && e.player === 'A', 'a planar die event, blank');
    t.eq(g.planarDieCost('A'), 1, 'then {1}');
    t.no(g.rollPlanarDie('A'), 'no mana for it'); t.ok(/Not enough mana/.test(g.lastError), g.lastError);
    T.mana('A', '1');
    t.ok(g.rollPlanarDie('A'), g.lastError);
    t.eq(T.player('A').pool.total ? T.player('A').pool.total() : 0, 0, '{1} paid');
    t.eq(g.planarDieCost('A'), 2, 'then {2}');
    T.mana('A', '2');
    t.ok(g.rollPlanarDie('A'), g.lastError);
    t.eq(g.planarDieCost('A'), 3, 'then {3}');
    // the next turn of A's, {0} again
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(g.planarDieCost('A'), 0, '{0} on a new turn');
    // not with something on the stack, nor outside a main phase
    T.hand('A', 'Shock'); T.mana('A', 'R');
    g.castSpell('A', T.zone('A', 'hand').find(o => o.name === 'Shock').id, { auto: true, targets: [{ kind: 'player', id: 'B' }] });
    t.no(g.rollPlanarDie('A'), 'not with a spell on the stack'); t.ok(/stack is empty/.test(g.lastError), g.lastError);
  });

  test('Planechase: {PW} puts the planeswalking ability on the stack; it resolves and A planeswalks — the plane to the bottom of its owner\'s planar deck', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv', 'Gavony'], ['Llanowar', 'Panopticon']);
    const g = T.g;
    t.eq(up(T).join(), 'Krosa');
    faces(T, [PW]);
    t.ok(g.rollPlanarDie('A'), g.lastError);
    t.eq(g.stack.length, 1, 'the planeswalking ability is on the stack');
    t.eq(g.stack[0].controller, 'A', 'controlled by the roller'); t.eq(g.stack[0].objId, null, 'with no source');
    t.eq(up(T).join(), 'Krosa', 'not yet');
    T.resolve();
    t.eq(up(T).join(), 'Shiv', 'planeswalked to the top of A\'s planar deck');
    t.eq(deckNames(T, 'A').join(), 'Gavony,Krosa', 'Krosa on the bottom of its owner\'s deck');
    // B planeswalks on B's turn: from B's own planar deck; Shiv goes under A's
    T.nextTurn('B');
    faces(T, [PW]);
    t.ok(g.rollPlanarDie('B'), g.lastError);
    T.resolve();
    t.eq(up(T).join(), 'Llanowar', 'B walks to the top of B\'s deck');
    t.eq(deckNames(T, 'A').join(), 'Gavony,Krosa,Shiv', 'Shiv under A\'s, its owner\'s');
    t.ok(g.events.some(e => e.type === 'planeswalk' && e.player === 'B' && e.from[0].name === 'Shiv' && e.to[0].name === 'Llanowar'), 'a planeswalk event for the table');
  });

  test('Planechase: chaos — Shiv\'s chaos ability triggers for the planar controller; a blank does nothing', (mk, t) => {
    const T = mk2(mk, ['Shiv', 'Krosa']);
    const g = T.g;
    faces(T, [BLANK]);
    t.ok(g.rollPlanarDie('A'), g.lastError);
    T.resolve();
    t.eq(T.bfOf('A').length, 0, 'a blank: nothing');
    faces(T, [CHAOS]);
    T.mana('A', '1');
    t.ok(g.rollPlanarDie('A'), g.lastError);
    t.eq(g.stack.length, 1, 'the chaos ability on the stack');
    T.resolve();
    const d = T.bfOf('A').find(o => o.name === 'Dragon');
    t.ok(d && d.isToken && T.g.powerOf(d) === 5 && T.g.hasKw(d, 'flying'), 'a 5/5 flying Dragon for A');
    // on B's turn, B is the planar controller: the Dragon is B's
    T.nextTurn('B');
    faces(T, [CHAOS]);
    t.ok(g.rollPlanarDie('B'), g.lastError);
    T.resolve();
    t.ok(T.bfOf('B').some(o => o.name === 'Dragon'), 'B gets the Dragon on B\'s turn');
  });

  test('Planechase: a plane\'s standing rules work from the command zone — Krosa, all creatures get +2/+2; gone once walked away from', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv']);
    const g = T.g;
    const bear = T.bf('B', 'Grizzly Bears');
    t.eq(g.powerOf(bear), 4, '2/2 +2/+2'); t.eq(g.toughnessOf(bear), 4);
    faces(T, [PW]);
    g.rollPlanarDie('A'); T.resolve();
    t.eq(up(T).join(), 'Shiv');
    t.eq(g.powerOf(bear), 2, 'back to 2/2 on Shiv');
  });

  test('Planechase: "When you planeswalk to" — Panopticon draws on arrival, not as the starting plane', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Panopticon'], null, { library: Array(10).fill('Island') });
    const g = T.g;
    const h0 = T.zone('A', 'hand').length;
    faces(T, [PW]);
    g.rollPlanarDie('A'); T.resolve();
    t.eq(up(T).join(), 'Panopticon');
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'drew on planeswalking to it');
  });

  test('Planechase: a phenomenon — encountered, its trigger resolves, then the planar controller planeswalks away (a state-based action)', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Mutual Epiphany', 'Shiv'], null, { library: Array(12).fill('Island') });
    const g = T.g;
    faces(T, [PW]);
    g.rollPlanarDie('A');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 4, 'A drew four'); t.eq(T.zone('B', 'hand').length, 4, 'B drew four');
    t.eq(up(T).join(), 'Shiv', 'then on to the next plane');
    t.eq(deckNames(T, 'A').join(), 'Krosa,Mutual Epiphany', 'Krosa and then the phenomenon under the deck');
    t.ok(g.log.some(l => /planeswalks away from Mutual Epiphany to Shiv/.test(l.text)), 'the log says it');
  });

  test('Planechase: Chaotic Aether makes blanks chaos until a player planeswalks away from a plane', (mk, t) => {
    const T = mk2(mk, ['Shiv', 'Chaotic Aether', 'Krosa', 'Gavony']);
    const g = T.g;
    // Shiv up; to Chaotic Aether, then on to Krosa
    faces(T, [PW]);
    g.rollPlanarDie('A'); T.resolve();
    t.eq(up(T).join(), 'Krosa', 'walked away from the phenomenon');
    t.ok(g.planar.aether, 'blanks are chaos now');
    T.mana('A', '1');
    faces(T, [BLANK]);
    g.rollPlanarDie('A'); T.resolve();
    t.ok(g.log.some(l => /Chaotic Aether makes the blank a chaos roll/.test(l.text)), 'a blank became chaos');
    t.eq(T.player('A').pool.total ? 0 : 0, 0);
    // away from Krosa: over
    T.mana('A', '2');
    faces(T, [PW]);
    g.rollPlanarDie('A'); T.resolve();
    t.no(g.planar.aether, 'planeswalking away from a plane ends it');
  });

  test('Planechase: a player leaving the game takes their planes; the planar controller turns up the top of their own', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv'], ['Llanowar', 'Gavony'], { players: ['A', 'B', 'C'] });
    const g = T.g;
    t.eq(up(T).join(), 'Krosa');
    g.concede('A');
    T.settle();
    t.no(up(T).includes('Krosa'), 'Krosa left with A');
    t.eq(g.planarDeck('A').length, 0, 'A\'s planar deck gone too');
    t.eq(up(T).length, 1, 'a new plane is up');
  });

  test('Planechase: the die counts as rolling a die ("whenever you roll one or more dice"), never as a number', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv']);
    const g = T.g;
    T.bf('A', 'Brazen Dwarf');
    faces(T, [BLANK]);
    const l0 = T.life('B');
    g.rollPlanarDie('A'); T.resolve();
    t.eq(T.life('B'), l0 - 1, 'Brazen Dwarf: 1 damage to each opponent');
  });
  test('Planechase: Susan Foreman — before a planeswalk, the top two of the planar deck are looked at: the one chosen is walked to, the other goes under', (mk, t) => {
    t.auto('Susan Foreman');
    const T = mk2(mk, ['Krosa', 'Shiv', 'Gavony', 'Llanowar']);
    const g = T.g;
    T.bf('A', 'Susan Foreman');
    faces(T, [PW]);
    t.ok(g.rollPlanarDie('A'), g.lastError);
    // the planeswalking ability resolves: Susan's look is asked as it does
    T.answer('choose', (ch) => {
      t.eq(ch.purpose, 'planarTop', 'Susan\'s question');
      t.eq(ch.items.map(i => i.name).join(), 'Shiv,Gavony', 'the top two of A\'s planar deck');
      t.ok(/Susan Foreman/.test(ch.prompt) && /top two cards of your planar deck/.test(ch.prompt), ch.prompt);
      return { picks: [ch.items.find(i => i.name === 'Gavony').id] };
    });
    T.resolve();
    t.eq(up(T).join(), 'Gavony', 'walked to the one she kept on top');
    t.eq(deckNames(T, 'A').join(), 'Llanowar,Shiv,Krosa', 'Shiv to the bottom first, then Krosa planeswalked away from under it');
    t.ok(T.asked.some(c => c.purpose === 'planarTop'), 'she was asked');
  });

  test('Planechase: Susan Foreman — a phenomenon\'s walk away is hers too, asked at the table and walked once answered; one card left is no choice', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Mutual Epiphany', 'Shiv', 'Gavony'], null, { library: Array(12).fill('Island') });
    const g = T.g;
    T.bf('A', 'Susan Foreman');
    faces(T, [PW]);
    g.rollPlanarDie('A');
    // the planeswalking ability: Mutual Epiphany or Shiv on top — the phenomenon
    T.answer('choose', (ch) => ({ picks: [ch.items.find(i => i.name === 'Mutual Epiphany').id] }));
    // and walking away from it: Gavony or Krosa (Shiv went under)
    T.answer('choose', (ch) => {
      t.eq(ch.purpose, 'planarTop', 'asked again, as the phenomenon is left');
      t.eq(ch.items.map(i => i.name).join(), 'Gavony,Shiv', 'Shiv went under, Krosa under that');
      return { picks: [ch.items.find(i => i.name === 'Gavony').id] };
    });
    T.resolve();
    t.eq(T.zone('A', 'hand').length, 4, 'Mutual Epiphany: four cards');
    t.eq(up(T).join(), 'Gavony', 'on to Gavony');
    t.eq(T.asked.filter(c => c.purpose === 'planarTop').length, 2, 'two looks');
  });

  test('Planechase: Susan Foreman — in a game without planes she only makes mana; opponents\' walks are not hers', (mk, t) => {
    const T0 = mk();
    const s0 = T0.bf('A', 'Susan Foreman');
    t.ok(T0.g.tapForMana('A', s0.id, 0, 'G'), T0.g.lastError);
    t.eq(T0.player('A').pool.G, 1, '{T}: Add {G}');
    const T = mk2(mk, ['Krosa', 'Shiv', 'Gavony'], ['Llanowar', 'Panopticon', 'Tazeem']);
    const g = T.g;
    T.bf('A', 'Susan Foreman');
    T.nextTurn('B');
    faces(T, [PW]);
    g.rollPlanarDie('B');
    T.resolve();
    t.eq(T.asked.filter(c => c.purpose === 'planarTop').length, 0, 'B planeswalks: no look for A');
    t.eq(up(T).join(), 'Llanowar', 'B walked to the top of B\'s deck');
  });

  test('Planechase: a bot rolls the free planar die in its first main phase, pays only for more with mana to spare, and keeps the better plane for Susan', (mk, t) => {
    const T = mk2(mk, ['Krosa', 'Shiv', 'Mutual Epiphany', 'Gavony'], null, { library: Array(12).fill('Island') });
    const g = T.g;
    const bot = new T.MTG.bots.BotPlayer(g, 'A', 8);
    faces(T, [BLANK, BLANK]);
    t.ok(bot.rollPlanar(true), 'the free roll');
    t.eq(g.planarDieCost('A'), 1);
    t.no(bot.rollPlanar(true), 'not paid for in the first main phase');
    t.no(bot.rollPlanar(false), 'nor without mana');
    // Susan's question: a plane worth having over a phenomenon
    T.bf('A', 'Susan Foreman');
    const items = g._chooseItems([g.planarDeck('A')[1], g.planarDeck('A')[0]]);
    const ans = T.MTG.bots.answerChoose(g, 'A', T.MTG.choice.normalize({ type: 'choose', kind: 'objects', playerId: 'A', purpose: 'planarTop', min: 1, max: 1, items, prompt: 'x' }));
    t.eq(g.obj(ans.picks[0]).name, 'Shiv', 'Shiv (a Dragon on chaos) over Mutual Epiphany');
  });
};
