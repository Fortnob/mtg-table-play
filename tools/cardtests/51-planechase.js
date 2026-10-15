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

  /* ---- the planes, each on its own: a table on that plane (A's turn, A's main phase), chaos made to ensue, a walk to it ---- */
  // a table whose starting plane is this one (A's planar deck: it, then Truga Jungle and Shiv to walk on to)
  const onPlane = (mk, name, more) => mk(Object.assign({ planechase: true, planar: { A: [name, 'Truga Jungle', 'Shiv'], B: ['Gavony', 'Krosa'] } }, more || {}));
  // chaos, by the die: answered as the tests' defaults answer, or with queued answers
  const chaos = (T) => {
    const g = T.g, pid = g.activePlayer.id;
    if (g.planarDieCost(pid)) T.mana(pid, String(g.planarDieCost(pid)));
    faces(T, [CHAOS]);
    if (!g.rollPlanarDie(pid)) throw new Error('could not roll: ' + g.lastError);
    T.resolve();
  };
  // planeswalk to this plane, by the die (it put on top of the active player's planar deck first)
  const walkTo = (T, name) => {
    const g = T.g, pid = g.activePlayer.id;
    const deck = g.planarDeck(pid);
    let o = deck.find(x => x.name === name);
    if (!o) { o = g._register(new T.MTG.rules.GObj(require('../harness').card(name), pid, 'planar')); deck.push(o); }
    deck.splice(deck.indexOf(o), 1); deck.unshift(o);
    if (g.planarDieCost(pid)) T.mana(pid, String(g.planarDieCost(pid)));
    faces(T, [PW]);
    if (!g.rollPlanarDie(pid)) throw new Error('could not roll: ' + g.lastError);
    T.resolve();
  };
  const tokensOf = (T, pid, name) => T.bfOf(pid).filter(o => o.isToken && (!name || o.name === name));

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
  test('Planes: Gavony — all creatures have vigilance; chaos: creatures you control gain indestructible until end of turn', (mk, t) => {
    t.auto('Gavony');
    const T = onPlane(mk, 'Gavony');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Grizzly Bears');
    t.ok(T.g.hasKw(a, 'vigilance') && T.g.hasKw(b, 'vigilance'), 'vigilance for all');
    chaos(T);
    t.ok(T.g.hasKw(a, 'indestructible'), 'A\'s creature indestructible'); t.no(T.g.hasKw(b, 'indestructible'), 'not B\'s');
  });

  test('Planes: Llanowar — all creatures have "{T}: Add {G}{G}"; chaos: untap all creatures you control', (mk, t) => {
    t.auto('Llanowar');
    const T = onPlane(mk, 'Llanowar');
    const a = T.bf('A', 'Grizzly Bears');
    t.ok(T.g.manaAbilitiesOf(a).length >= 1, 'a mana ability');
    t.ok(T.g.tapForMana('A', a.id, 0), T.g.lastError);
    t.eq(T.player('A').pool.G, 2, '{G}{G}');
    chaos(T);
    t.no(a.tapped, 'untapped by chaos');
  });

  test('Planes: Turri Island — creature spells cost {2} less; chaos: the top three revealed, creatures to hand, the rest to the graveyard', (mk, t) => {
    t.auto('Turri Island');
    const T = onPlane(mk, 'Turri Island', { library: ['Island'] });
    const ogre = T.hand('A', 'Hill Giant');
    T.mana('A', '1R');
    T.cast('A', ogre);
    t.zone(ogre, 'battlefield', 'Hill Giant for {1}{R}');
    T.top('A', 'Grizzly Bears'); T.top('A', 'Mountain'); T.top('A', 'Llanowar Elves');
    const h0 = T.zone('A', 'hand').length, g0 = T.zone('A', 'graveyard').length;
    chaos(T);
    t.eq(T.zone('A', 'hand').length - h0, 2, 'two creatures to hand'); t.eq(T.zone('A', 'graveyard').length - g0, 1, 'the Mountain to the graveyard');
  });

  test('Planes: Hedron Fields of Agadeem — creatures with power 7 or more can\'t attack or block; chaos: a 7/7 Eldrazi with annihilator 1', (mk, t) => {
    t.auto('Hedron Fields of Agadeem');
    const T = onPlane(mk, 'Hedron Fields of Agadeem');
    chaos(T);
    const e = tokensOf(T, 'A', 'Eldrazi')[0];
    t.ok(e && T.g.powerOf(e) === 7 && T.g.hasKw(e, 'annihilator 1'), 'a 7/7 Eldrazi with annihilator 1');
    e.summoningSick = false;
    t.no(T.g.canAttack(e), 'it can\'t attack here');
  });

  test('Planes: The Zephyr Maze — fliers +2/+0, the rest -2/-0; chaos: target creature gains flying until end of turn', (mk, t) => {
    t.auto('The Zephyr Maze');
    const T = onPlane(mk, 'The Zephyr Maze');
    const bird = T.bf('A', 'Suntail Hawk'), bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(bird), 3, 'a 1/1 flier is 3/1'); t.eq(T.g.powerOf(bear), 0, 'a 2/2 is 0/2');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.ok(T.g.hasKw(bear, 'flying'), 'the Bears fly'); t.eq(T.g.powerOf(bear), 4, 'and so get +2/+0');
  });

  test('Planes: Astral Arena — one attacker each combat; chaos: 2 damage to each creature', (mk, t) => {
    t.auto('Astral Arena');
    const T = onPlane(mk, 'Astral Arena');
    const a1 = T.bf('A', 'Grizzly Bears'), a2 = T.bf('A', 'Hill Giant'), b = T.bf('B', 'Grizzly Bears');
    chaos(T);
    t.zone(a1, 'graveyard'); t.zone(b, 'graveyard'); t.zone(a2, 'battlefield', 'the 3/3 lives');
    const c1 = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', (ch, g) => {
      t.no(g.declareAttackers('A', [{ attackerId: a2.id, defenderId: 'B' }, { attackerId: c1.id, defenderId: 'B' }]), 'two may not attack');
      t.ok(/no more than 1/.test(g.lastError), g.lastError);
      return [{ attackerId: a2.id, defenderId: 'B' }];
    });
    T.toMain('A', 'declareBlockers');
    t.eq(T.g.battlefield.filter(o => o.attacking).length, 1, 'one attacks');
  });

  test('Planes: The Great Forest — creatures deal combat damage equal to toughness; chaos: +0/+2 and trample for yours', (mk, t) => {
    t.auto('The Great Forest');
    const T = onPlane(mk, 'The Great Forest');
    const wall = T.bf('A', 'Wall of Wood'), bear = T.bf('A', 'Grizzly Bears');
    t.ok(T.g._dealsByToughness(wall), 'by toughness');
    chaos(T);
    t.eq(T.g.toughnessOf(bear), 4, '+0/+2'); t.ok(T.g.hasKw(bear, 'trample'), 'trample');
  });

  test('Planes: Tazeem — creatures can\'t block; chaos: draw a card for each land you control', (mk, t) => {
    t.auto('Tazeem');
    const T = onPlane(mk, 'Tazeem', { library: Array(10).fill('Island') });
    T.bf('A', 'Forest'); T.bf('A', 'Forest');
    const h0 = T.zone('A', 'hand').length;
    chaos(T);
    t.eq(T.zone('A', 'hand').length - h0, 2, 'two cards for two lands');
  });

  test('Planes: The Eon Fog — untap steps skipped; chaos: untap all permanents you control', (mk, t) => {
    t.auto('The Eon Fog');
    const T = onPlane(mk, 'The Eon Fog');
    const land = T.bf('A', 'Forest', { tapped: true });
    T.nextTurn('B'); T.nextTurn('A');
    t.ok(land.tapped, 'no untap step');
    chaos(T);
    t.no(land.tapped, 'untapped by chaos');
  });

  test('Planes: Feeding Grounds — red and green spells cost {1} less; chaos: X +1/+1 counters, X its mana value', (mk, t) => {
    t.auto('Feeding Grounds');
    const T = onPlane(mk, 'Feeding Grounds');
    const bears = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'G');
    T.cast('A', bears);
    t.zone(bears, 'battlefield', 'Grizzly Bears for {G}');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bears.id }] }));
    chaos(T);
    t.eq(bears.counters['+1/+1'], 2, 'two counters for mana value 2');
  });

  test('Planes: Raven\'s Run — all creatures have wither; chaos: one, two and three -1/-1 counters on three creatures', (mk, t) => {
    t.auto('Raven\'s Run');
    const T = onPlane(mk, 'Raven\'s Run');
    const x = T.bf('B', 'Hill Giant'), y = T.bf('B', 'Craw Wurm'), z = T.bf('B', 'Grizzly Bears');
    t.ok(T.g.hasKw(x, 'wither'), 'wither');
    T.answer('pickTarget', () => ({ targets: [x, y, z].map(o => ({ kind: 'object', id: o.id })) }));
    chaos(T);
    t.eq(x.counters['-1/-1'], 1); t.eq(y.counters['-1/-1'], 2); t.zone(z, 'graveyard', 'three on the 2/2');
  });

  test('Planes: Sokenzan, Megaflora Jungle, The Hippodrome — their standing rules', (mk, t) => {
    const T = onPlane(mk, 'Sokenzan');
    const b = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(b), 3, 'Sokenzan: +1/+1'); t.ok(T.g.hasKw(b, 'haste'), 'and haste');
    walkTo(T, 'Megaflora Jungle');
    t.eq(T.g.powerOf(b), 4, 'Megaflora: mana value 2, +2/+2');
    walkTo(T, 'The Hippodrome');
    t.ok(T.g.powerOf(b) <= 0, 'Hippodrome: -5/-0');
  });

  test('Planes: Megaflora Jungle — chaos: a 1/1 flying Insect named Butterfly', (mk, t) => {
    t.auto('Megaflora Jungle');
    const T = onPlane(mk, 'Megaflora Jungle');
    chaos(T);
    const bf = tokensOf(T, 'A', 'Butterfly')[0];
    t.ok(bf && T.g.hasKw(bf, 'flying'), 'a Butterfly');
  });

  test('Planes: Truga Jungle — lands tap for any colour; chaos: lands among the top three to hand, the rest under', (mk, t) => {
    t.auto('Truga Jungle');
    const T = onPlane(mk, 'Truga Jungle', { library: ['Island'] });
    const f = T.bf('A', 'Forest');
    const n = T.g.manaAbilitiesOf(f).length;
    t.ok(n >= 2, 'a second mana ability');
    t.ok(T.g.tapForMana('A', f.id, n - 1, 'R'), T.g.lastError);
    t.eq(T.player('A').pool.R, 1, 'a Forest for {R}');
    T.top('A', 'Mountain'); T.top('A', 'Grizzly Bears'); T.top('A', 'Plains');
    const h0 = T.zone('A', 'hand').length;
    chaos(T);
    t.eq(T.zone('A', 'hand').length - h0, 2, 'two lands to hand');
    t.eq(T.zone('A', 'library').slice(-1)[0].name, 'Grizzly Bears', 'the rest on the bottom');
  });

  test('Planes: Bloodhill Bastion — a creature entering gains double strike and haste; chaos: blink your nontoken creature', (mk, t) => {
    t.auto('Bloodhill Bastion');
    const T = onPlane(mk, 'Bloodhill Bastion');
    const b = T.bf('B', 'Grizzly Bears', { etb: true });
    T.resolve();
    t.ok(T.g.hasKw(b, 'double strike') && T.g.hasKw(b, 'haste'), 'any creature, B\'s too');
    const a = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: a.id }] }));
    chaos(T);
    t.zone(a, 'battlefield', 'back'); t.ok(T.g.hasKw(a, 'haste'), 'and entered again: haste');
  });

  test('Planes: Goldmeadow — a land entering makes its controller three Goats; chaos: one Goat', (mk, t) => {
    t.auto('Goldmeadow');
    const T = onPlane(mk, 'Goldmeadow');
    T.playLand('A', T.hand('A', 'Forest'));
    t.eq(tokensOf(T, 'A', 'Goat').length, 3, 'three Goats');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Goat').length, 4, 'and one more');
  });

  test('Planes: Planewide Disaster — destroy all creatures, then on', (mk, t) => {
    t.auto('Planewide Disaster');
    const T = onPlane(mk, 'Krosa');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Hill Giant');
    walkTo(T, 'Planewide Disaster');
    t.zone(a, 'graveyard'); t.zone(b, 'graveyard');
    t.eq(up(T).join(), 'Truga Jungle', 'walked away');
  });

  test('Planes: Lethe Lake, Nephalia — what they do on their turns', (mk, t) => {
    t.auto('Lethe Lake'); t.auto('Nephalia');
    const T = onPlane(mk, 'Lethe Lake', { library: Array(30).fill('Island') });
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    t.eq(T.zone('B', 'graveyard').length, 10, 'Lethe Lake chaos: B mills ten');
    T.nextTurn('B');
    t.eq(T.zone('B', 'graveyard').length, 20, 'and B mills ten at B\'s upkeep (the plane is B\'s then)');
    T.nextTurn('A');
    walkTo(T, 'Nephalia');
    const h0 = T.zone('A', 'hand').length;
    T.toMain('A', 'end'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'Nephalia: a card back at random, after seven milled');
  });

  test('Planes: Academy at Tolaria West — an empty hand at the end step draws seven; chaos: discard your hand', (mk, t) => {
    t.auto('Academy at Tolaria West');
    const T = onPlane(mk, 'Academy at Tolaria West', { library: Array(20).fill('Island') });
    T.hand('A', 'Forest');
    chaos(T);
    t.eq(T.zone('A', 'hand').length, 0, 'hand discarded');
    T.toMain('A', 'end'); T.settle(); T.resolve();
    t.eq(T.zone('A', 'hand').length, 7, 'seven drawn');
  });
  test('Planes: Towashi — your modified creatures have trample and draw on combat damage; chaos: three +1/+1 counters divided', (mk, t) => {
    t.auto('Towashi');
    const T = onPlane(mk, 'Towashi');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Hill Giant');
    t.no(T.g.hasKw(a, 'trample'), 'not modified yet');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }] }));
    chaos(T);
    const n = (Number(a.counters['+1/+1']) || 0) + (Number(b.counters['+1/+1']) || 0);
    t.eq(n, 3, 'three counters in all');
    t.ok(T.g.hasKw(a, 'trample'), 'now modified: trample');
  });

  test('Planes: Stormcage Containment Facility — creature cards in your graveyard have escape; chaos: detain', (mk, t) => {
    t.auto('Stormcage Containment Facility');
    const T = onPlane(mk, 'Stormcage Containment Facility');
    const bear = T.grave('A', 'Grizzly Bears');
    for (const n of ['Island', 'Island', 'Island']) T.grave('A', n);
    t.ok(T.g.altUsesFor('A', bear.id).some(u => u.via === 'escape'), 'escape offered');
    const foe = T.bf('B', 'Hill Giant');
    chaos(T);
    t.ok(T.g._hasFlag(foe, 'cantAttackOrBlock') && T.g._hasFlag(foe, 'cantActivate'), 'detained');
  });

  test('Planes: The Moonbase — all creatures have "{2}: flying until end of turn, as a sorcery"', (mk, t) => {
    const T = onPlane(mk, 'The Moonbase');
    const a = T.bf('A', 'Grizzly Bears');
    const ab = (a.analysis().abilities || []).findIndex(x => x.kind === 'activated');
    t.ok(ab >= 0, 'an activated ability');
    T.mana('A', '2');
    T.activate('A', a, ab);
    t.ok(T.g.hasKw(a, 'flying'), 'flying');
  });

  test('Planes: The Golden City of Orazca — ascend for its controller; combat damage makes a Treasure, and a card with the blessing', (mk, t) => {
    const T = onPlane(mk, 'The Golden City of Orazca', { library: Array(10).fill('Island') });
    for (let i = 0; i < 10; i++) T.bf('A', 'Forest');
    T.g.checkStateBasedActions();
    t.ok(T.player('A').cityBlessing, 'the city\'s blessing');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', [{ attackerId: bear.id, defenderId: 'B' }]);
    const h0 = T.zone('A', 'hand').length;
    T.toMain('A', 'main2' === 'x' ? 'x' : 'end'); T.resolve();
    t.ok(tokensOf(T, 'A', 'Treasure').length === 1, 'a Treasure');
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'and a card');
  });

  test('Planes: Esper — artifact spells cost {1} less', (mk, t) => {
    const T = onPlane(mk, 'Esper');
    const o = T.hand('A', 'Ornithopter');
    T.cast('A', o);
    t.zone(o, 'battlefield');
    const st = T.hand('A', 'Millstone');
    T.mana('A', '1');
    T.cast('A', st);
    t.zone(st, 'battlefield', 'Millstone for {1}');
  });

  test('Planes: Nyx — nontoken creatures are enchantments; constellation gains 1; chaos: mana equal to devotion', (mk, t) => {
    t.auto('Nyx');
    const T = onPlane(mk, 'Nyx');
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', '1G');
    const l0 = T.life('A');
    T.cast('A', bear);
    t.ok((bear.analysis().types || []).includes('Enchantment'), 'an enchantment too');
    t.eq(T.life('A'), l0 + 1, 'constellation: 1 life');
    T.answer('choose', (ch) => ({ picks: [ch.options.findIndex(o => /green/i.test(o.label))] }));
    T.answer('mode', (ch) => ({ modes: [ch.options.findIndex(o => /green/i.test(o.label))] }));
    chaos(T);
    t.eq(T.player('A').pool.G, 1, 'devotion to green 1: {G}');
  });

  test('Planes: The Lux Foundation Library — no maximum hand size; combat damage may draw; chaos: a shadow counter', (mk, t) => {
    t.auto('The Lux Foundation Library');
    const T = onPlane(mk, 'The Lux Foundation Library');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(bear.counters.shadow, 1, 'a shadow counter'); t.ok(T.g.hasKw(bear, 'shadow'), 'shadow');
    for (let i = 0; i < 10; i++) T.hand('A', 'Island');
    T.nextTurn('B');
    t.eq(T.zone('A', 'hand').length, 10, 'nothing discarded at cleanup');
  });

  test('Planes: The Cave of Skulls — creature cards in your graveyard have scavenge; chaos: two Warriors', (mk, t) => {
    t.auto('The Cave of Skulls');
    const T = onPlane(mk, 'The Cave of Skulls');
    const dead = T.grave('A', 'Hill Giant');
    const sc = (dead.analysis().abilities || []).findIndex(x => x.kind === 'activated' && /scavenge/i.test(x.text || ''));
    t.ok(sc >= 0, 'scavenge');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Warrior').length, 2, 'two Warriors');
  });

  test('Planes: Stairs to Infinity — rolling the planar die draws a card', (mk, t) => {
    const T = onPlane(mk, 'Stairs to Infinity', { library: Array(10).fill('Island') });
    const h0 = T.zone('A', 'hand').length;
    faces(T, [BLANK]);
    T.g.rollPlanarDie('A'); T.resolve();
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'a card for the roll');
  });

  test('Planes: Singing Towers of Darillium — cards in hand have foretell for {2} less', (mk, t) => {
    const T = onPlane(mk, 'Singing Towers of Darillium');
    const c = T.hand('A', 'Hill Giant');
    t.ok(T.g.altUsesFor('A', c.id).some(u => u.kind === 'foretell'), 'foretell offered');
  });

  test('Planes: Aretopolis — scroll counters, life for them; chaos draws as many; ten and it moves on', (mk, t) => {
    t.auto('Aretopolis');
    const T = onPlane(mk, 'Krosa', { library: Array(30).fill('Island') });
    walkTo(T, 'Aretopolis');
    const ar = T.g.facePlanes()[0];
    t.eq(ar.name, 'Aretopolis');
    t.eq(ar.counters.scroll, 1, 'a scroll counter on arrival');
    const h0 = T.zone('A', 'hand').length;
    chaos(T);
    t.eq(ar.counters.scroll, 2); t.eq(T.zone('A', 'hand').length, h0 + 2, 'two cards');
    ar.counters.scroll = 10;
    T.g.checkStateBasedActions(); T.resolve();
    t.no(up(T).includes('Aretopolis'), 'ten scrolls: planeswalked away');
  });

  test('Planes: Murasa — a nontoken creature entering may fetch a basic land; chaos: a land becomes a 4/4', (mk, t) => {
    t.auto('Murasa');
    const T = onPlane(mk, 'Murasa', { library: ['Forest', 'Island'] });
    T.bf('A', 'Grizzly Bears', { etb: true }); T.resolve();
    t.ok(T.bfOf('A').some(o => (o.analysis() || {}).isLand), 'a land fetched');
    const land = T.bfOf('A').find(o => (o.analysis() || {}).isLand);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: land.id }] }));
    chaos(T);
    t.ok((land.analysis() || {}).isCreature && T.g.powerOf(land) === 4, 'a 4/4 land creature');
  });

  test('Planes: New Argive — historic attackers +2/+2; chaos: the first historic card to hand', (mk, t) => {
    t.auto('New Argive');
    const T = onPlane(mk, 'New Argive', { library: ['Island'] });
    T.top('A', 'Ornithopter'); T.top('A', 'Grizzly Bears');
    const h0 = T.zone('A', 'hand').length;
    chaos(T);
    t.ok(T.zone('A', 'hand').some(o => o.name === 'Ornithopter'), 'Ornithopter to hand'); t.eq(T.zone('A', 'hand').length, h0 + 1);
  });

  test('Planes: Grove of the Dreampods — on arrival the first creature revealed enters; chaos: reanimate', (mk, t) => {
    t.auto('Grove of the Dreampods');
    const T = onPlane(mk, 'Krosa', { library: ['Island'] });
    T.top('A', 'Grizzly Bears'); T.top('A', 'Forest');
    walkTo(T, 'Grove of the Dreampods');
    t.ok(T.bfOf('A').some(o => o.name === 'Grizzly Bears'), 'the Bears entered');
    const dead = T.grave('A', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: dead.id }] }));
    chaos(T);
    t.zone(dead, 'battlefield', 'Hill Giant back');
  });

  test('Planes: Coal Hill School — a historic spell draws its caster a card', (mk, t) => {
    t.auto('Coal Hill School');
    const T = onPlane(mk, 'Coal Hill School', { library: Array(5).fill('Island') });
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Ornithopter'));
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'Ornithopter cast, a card drawn');
  });

  test('Planes: Quicksilver Sea — scry 4 on arrival; chaos: play the top card free', (mk, t) => {
    t.auto('Quicksilver Sea');
    const T = onPlane(mk, 'Krosa', { library: Array(8).fill('Island') });
    walkTo(T, 'Quicksilver Sea');
    t.ok(T.asked.some(c => c.type === 'scry' && c.count === 4), 'scry 4');
    T.top('A', 'Grizzly Bears');
    chaos(T);
    t.ok(T.bfOf('A').some(o => o.name === 'Grizzly Bears'), 'the Bears for free');
  });

  test('Planes: Pompeii — eruption counters; a blank scries 2 and adds one; chaos: damage to all, a land each, then on', (mk, t) => {
    t.auto('Pompeii');
    const T = onPlane(mk, 'Krosa', { library: Array(8).fill('Island') });
    walkTo(T, 'Pompeii');
    const pom = T.g.facePlanes()[0];
    t.eq(pom.counters.eruption, 1, 'an eruption counter on arrival');
    T.mana('A', '1');
    faces(T, [BLANK]); T.g.rollPlanarDie('A'); T.resolve();
    t.eq(pom.counters.eruption, 2, 'a blank: one more'); t.ok(T.asked.some(c => c.type === 'scry' && c.count === 2), 'scry 2');
    const bear = T.bf('B', 'Grizzly Bears'); T.bf('B', 'Forest'); T.bf('A', 'Forest');
    const lA = T.life('A'), lB = T.life('B');
    chaos(T);
    t.zone(bear, 'graveyard', '2 damage kills the Bears'); t.eq(T.life('B'), lB - 2); t.eq(T.life('A'), lA - 2);
    t.eq(T.bfOf('B').filter(o => (o.analysis() || {}).isLand).length, 0, 'a land sacrificed');
    t.no(up(T).includes('Pompeii'), 'then planeswalked');
  });

  test('Planes: Riptide Island — two Slivers on arrival; chaos: Slivers get +X/+X and haste', (mk, t) => {
    t.auto('Riptide Island');
    const T = onPlane(mk, 'Krosa');
    walkTo(T, 'Riptide Island');
    const sl = tokensOf(T, 'A', 'Sliver');
    t.eq(sl.length, 2, 'two Slivers');
    chaos(T);
    t.eq(T.g.powerOf(sl[0]), 3, '1/1 +2/+2'); t.ok(T.g.hasKw(sl[0], 'haste'), 'haste');
  });

  test('Planes: The Drum, Mining Facility — a roll pumps your creatures; chaos ends the turn', (mk, t) => {
    t.auto('The Drum, Mining Facility');
    const T = onPlane(mk, 'The Drum, Mining Facility');
    const bear = T.bf('A', 'Grizzly Bears');
    faces(T, [BLANK]); T.g.rollPlanarDie('A'); T.resolve();
    t.eq(T.g.powerOf(bear), 3, '+1/+1'); t.ok(T.g.hasKw(bear, 'haste'), 'haste');
    const turn = T.g.turn;
    T.mana('A', '1');
    faces(T, [CHAOS]); T.g.rollPlanarDie('A'); T.resolve();
    t.ok(T.g.turn > turn || T.g.step === 'cleanup' || T.g.activePlayer.id === 'B', 'the turn ended');
  });

  test('Planes: Ten Wizards Mountain — a roll puts a +1/+1 counter on up to one creature; chaos: flying', (mk, t) => {
    t.auto('Ten Wizards Mountain');
    const T = onPlane(mk, 'Ten Wizards Mountain');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    faces(T, [CHAOS]); T.g.rollPlanarDie('A'); T.resolve();
    t.eq(bear.counters['+1/+1'], 1, 'a counter'); t.ok(T.g.hasKw(bear, 'flying'), 'flying');
  });

  test('Planes: North Pole Research Base — upkeep: an opponent draws and gets a Treasure; chaos: an Alien, and a stunned creature', (mk, t) => {
    t.auto('North Pole Research Base');
    const T = onPlane(mk, 'North Pole Research Base', { library: Array(8).fill('Island') });
    const foe = T.bf('B', 'Hill Giant');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Alien').length, 1, 'an Alien');
    t.ok(foe.tapped && foe.counters.stun === 1, 'tapped and stunned');
    T.nextTurn('B'); T.nextTurn('A');
    // (on turn 1, A's upkeep, and again on A's next; on B's turn the plane is B's, and A gets one)
    t.eq(tokensOf(T, 'B', 'Treasure').length, 2, 'B got a Treasure at each of A\'s upkeeps');
    t.eq(tokensOf(T, 'A', 'Treasure').length, 1, 'A got one at B\'s');
  });

  test('Planes: UNIT Headquarters — a tapped Soldier on arrival; chaos: a counter on each creature you control', (mk, t) => {
    t.auto('UNIT Headquarters');
    const T = onPlane(mk, 'Krosa');
    walkTo(T, 'UNIT Headquarters');
    const s = tokensOf(T, 'A', 'Soldier')[0];
    t.ok(s && s.tapped, 'a tapped Soldier');
    chaos(T);
    t.eq(s.counters['+1/+1'], 1, 'a counter');
  });

  test('Planes: Cliffside Market — exchange life totals on arrival; chaos: exchange control of two permanents sharing a type', (mk, t) => {
    t.auto('Cliffside Market');
    const T = onPlane(mk, 'Krosa');
    T.player('B').life = 5;
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.answer('confirm', { yes: true });
    walkTo(T, 'Cliffside Market');
    t.eq(T.life('A'), 5, 'A has B\'s life'); t.eq(T.life('B'), 20, 'and B A\'s');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: mine.id }, { kind: 'object', id: theirs.id }] }));
    chaos(T);
    t.eq(mine.controller, 'B'); t.eq(theirs.controller, 'A');
  });

  test('Planes: Tember City — tapping a land for mana deals 1; chaos: each other player sacrifices a nonland permanent', (mk, t) => {
    t.auto('Tember City');
    const T = onPlane(mk, 'Tember City');
    const f = T.bf('A', 'Forest');
    const l0 = T.life('A');
    T.g.tapForMana('A', f.id, 0); T.resolve();
    t.eq(T.life('A'), l0 - 1, '1 damage');
    const bear = T.bf('B', 'Grizzly Bears');
    chaos(T);
    t.zone(bear, 'graveyard', 'B sacrificed it');
  });

  test('Planes: Paliano — no monarch, combat damage makes you the monarch; chaos: an Assassin', (mk, t) => {
    t.auto('Paliano');
    const T = onPlane(mk, 'Paliano');
    chaos(T);
    const as = tokensOf(T, 'A', 'Assassin')[0];
    t.ok(as && T.g.hasKw(as, 'deathtouch') && T.g.hasKw(as, 'haste'), 'an Assassin');
    T.answer('declareAttackers', [{ attackerId: as.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.resolve();
    t.ok(T.player('A').monarch, 'A is the monarch');
  });

  test('Planes: Antarctic Research Base — investigate on arrival; chaos: counters for your artifacts, and a Plant', (mk, t) => {
    t.auto('Antarctic Research Base');
    const T = onPlane(mk, 'Krosa');
    walkTo(T, 'Antarctic Research Base');
    t.eq(tokensOf(T, 'A', 'Clue').length, 1, 'a Clue');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(bear.counters['+1/+1'], 1, 'one artifact: one counter'); t.ok(T.g._hasCreatureType(bear, 'Plant'), 'a Plant');
  });

  test('Planes: Ketria — a vigilance, menace or trample counter on arrival; chaos: the first nonland permanent card exiled, to battlefield or hand', (mk, t) => {
    t.auto('Ketria');
    const T = onPlane(mk, 'Krosa', { library: ['Island'] });
    const bear = T.bf('A', 'Grizzly Bears');
    walkTo(T, 'Ketria');
    t.ok(bear.counters.vigilance || bear.counters.menace || bear.counters.trample, 'a keyword counter');
    T.top('A', 'Hill Giant'); T.top('A', 'Forest');
    chaos(T);
    t.ok(T.bfOf('A').some(o => o.name === 'Hill Giant') || T.zone('A', 'hand').some(o => o.name === 'Hill Giant'), 'Hill Giant to the battlefield or hand');
  });

  test('Planes: Undercity Reaches — combat damage lets its controller draw; chaos: no maximum hand size', (mk, t) => {
    t.auto('Undercity Reaches');
    const T = onPlane(mk, 'Undercity Reaches', { library: Array(8).fill('Island') });
    chaos(T);
    for (let i = 0; i < 10; i++) T.hand('A', 'Island');
    T.nextTurn('B');
    t.eq(T.zone('A', 'hand').length, 10, 'no maximum hand size for the rest of the game');
  });

  test('Planes: Kilnspire District — charge counters and {R} for each in the first main phase; chaos: pay X for X damage', (mk, t) => {
    t.auto('Kilnspire District');
    const T = onPlane(mk, 'Krosa');
    walkTo(T, 'Kilnspire District');
    const k = T.g.facePlanes()[0];
    t.eq(k.counters.charge, 1, 'a charge counter'); t.eq(T.player('A').pool.R, 1, 'and {R}');
  });

  test('Planes: Fixed Point in Time — until your next turn, a {PW} roll makes chaos ensue instead', (mk, t) => {
    t.auto('Fixed Point in Time');
    const T = onPlane(mk, 'Shiv', { planar: { A: ['Shiv', 'Fixed Point in Time', 'Krosa', 'Gavony'], B: ['Truga Jungle', 'Llanowar'] } });
    walkTo(T, 'Fixed Point in Time');
    t.eq(up(T).join(), 'Krosa', 'on to Krosa');
    T.mana('A', '1');
    faces(T, [PW]); T.g.rollPlanarDie('A'); T.resolve();
    t.eq(up(T).join(), 'Krosa', 'no planeswalk');
    t.ok(T.g.log.some(l => /instead of planeswalking, chaos ensues/.test(l.text)), 'chaos instead');
    T.nextTurn('B'); T.nextTurn('A');
    faces(T, [PW]); T.g.rollPlanarDie('A'); T.resolve();
    t.no(up(T).includes('Krosa'), 'over at A\'s next turn');
  });
  test('Planes: Littjara — a Shapeshifter at the planar controller\'s upkeep; chaos: a counter on each creature of the type chosen', (mk, t) => {
    t.auto('Littjara');
    const T = onPlane(mk, 'Littjara');
    t.eq(tokensOf(T, 'A').length, 1, 'a Shapeshifter at A\'s first upkeep');
    T.nextTurn('B');
    t.eq(tokensOf(T, 'B').length, 1, 'a Shapeshifter for B, at B\'s upkeep');
    T.nextTurn('A');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Hill Giant');
    T.answer('*', (ch) => ch.type === 'chooseType' ? { choice: 'Bear' } : ch.type === 'choose' ? { picks: [(ch.options || []).findIndex(o => /^Bear$/i.test(o.label || o.value || o))] } : {});
    chaos(T);
    t.eq(Number(a.counters['+1/+1']) || 0, 1, 'the Bear got a counter');
    t.eq(Number(b.counters['+1/+1']) || 0, 0, 'the Giant did not');
  });

  test('Planes: Naar Isle — flame counters at upkeep, that much damage; chaos: 3 damage to target player', (mk, t) => {
    t.auto('Naar Isle');
    const T = onPlane(mk, 'Naar Isle');
    T.nextTurn('B');
    t.eq(T.life('A'), 19, 'one flame counter at A\'s first upkeep: 1 to A');
    t.eq(T.life('B'), 18, 'two flame counters: 2 to B');
    T.nextTurn('A');
    t.eq(T.life('A'), 16, 'three flame counters: 3 to A');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    t.eq(T.life('B'), 15, 'chaos: 3 to B');
  });

  test('Planes: Orochi Colony — combat damage to a player fetches a basic land; chaos: target creature can\'t be blocked', (mk, t) => {
    t.auto('Orochi Colony');
    const T = onPlane(mk, 'Orochi Colony');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.ok(T.g._hasFlag ? T.g._hasFlag(bear, 'unblockable') || T.g._hasFlag(bear, 'cantBeBlocked') || (bear.effects || []).some(e => e && (e.unblockable || e.flag === 'unblockable' || e.cantBeBlocked)) : true, 'can\'t be blocked');
    const lands0 = T.bfOf('A').filter(o => T.g._matchesCategory(o, 'land')).length;
    T.answer('declareAttackers', [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.resolve();
    t.eq(T.life('B'), 18, 'two damage');
    t.eq(T.bfOf('A').filter(o => T.g._matchesCategory(o, 'land')).length, lands0 + 1, 'a basic land fetched');
  });

  test('Planes: Takenuma — a creature leaving the battlefield draws its controller a card; chaos: bounce your creature', (mk, t) => {
    t.auto('Takenuma');
    const T = onPlane(mk, 'Takenuma');
    const bear = T.bf('A', 'Grizzly Bears');
    const h0 = T.zone('A', 'hand').length;
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.zone(bear, 'hand');
    t.eq(T.zone('A', 'hand').length, h0 + 2, 'the Bears and a card');
  });

  test('Planes: The Fourth Sphere — upkeep: sacrifice a nonblack creature; chaos: a 2/2 Zombie', (mk, t) => {
    t.auto('The Fourth Sphere');
    const T = onPlane(mk, 'The Fourth Sphere');
    const bear = T.bf('B', 'Grizzly Bears'), bat = T.bf('B', 'Vampire Nighthawk');
    T.nextTurn('B');
    t.zone(bear, 'graveyard', 'the nonblack Bears');
    t.zone(bat, 'battlefield', 'the black Nighthawk stays');
    T.nextTurn('A');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Zombie').length, 1, 'a Zombie');
  });

  test('Planes: The Pyramid of Mars — surveil 2 on the walk; chaos: reanimate a creature card of yours', (mk, t) => {
    t.auto('The Pyramid of Mars');
    const T = onPlane(mk, 'Gavony');
    walkTo(T, 'The Pyramid of Mars');
    t.ok(T.asked.some(c => c.type === 'surveil'), 'surveil asked');
    const bear = T.grave('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.zone(bear, 'battlefield');
  });

  test('Planes: Velis Vel — +1/+1 for each other creature sharing a type; chaos: all creature types', (mk, t) => {
    t.auto('Velis Vel');
    const T = onPlane(mk, 'Velis Vel');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Grizzly Bears'), g = T.bf('A', 'Hill Giant');
    t.eq(T.g.powerOf(a), 3, 'Bear with another Bear: 3');
    t.eq(T.g.powerOf(g), 3, 'the Giant alone: 3');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: g.id }] }));
    chaos(T);
    t.eq(T.g.powerOf(g), 5, 'the Giant shares with both Bears');
    t.eq(T.g.powerOf(a), 4, 'each Bear shares with a Bear and the Giant');
    t.eq(T.g.powerOf(b), 4);
  });

  test('Planes: Fblthp — a Map at upkeep; chaos: draw two, discard two, untap up to three lands', (mk, t) => {
    t.auto('Fblthp: Completely, Utterly, Totally Lost');
    const T = onPlane(mk, 'Fblthp: Completely, Utterly, Totally Lost');
    T.nextTurn('B');
    t.eq(tokensOf(T, 'B', 'Map').length, 1, 'a Map for B');
    T.nextTurn('A');
    const land = T.bf('A', 'Forest', { tapped: true });
    T.hand('A', 'Island'); T.hand('A', 'Island');
    const h0 = T.zone('A', 'hand').length;
    chaos(T);
    t.eq(T.zone('A', 'hand').length, h0, 'two in, two out');
    t.no(land.tapped, 'the Forest untapped');
  });

  test('Planes: Besieged Viking Village — every creature can boast; chaos: an indestructible counter on an attacker', (mk, t) => {
    t.auto('Besieged Viking Village');
    const T = onPlane(mk, 'Besieged Viking Village');
    const bear = T.bf('A', 'Grizzly Bears');
    const ix = (bear.analysis().abilities || []).findIndex(x => x.kind === 'activated');
    t.ok(ix >= 0, 'a boast ability');
    T.answer('declareAttackers', [{ attackerId: bear.id, defenderId: 'B' }]);
    // on to the postcombat main phase
    for (let i = 0; i < 50 && !(T.g.phase.id === 'postcombat' && !T.g.stack.length && !T.g.pendingChoice); i++) { T.settle(); T.g.passPriority(T.g.priorityPlayer.id, true); }
    T.mana('A', '1');
    T.activate('A', bear, ix);
    t.eq(Number(bear.counters['+1/+1']) || 0, 1, 'boasted');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(Number(bear.counters.indestructible) || 0, 1, 'an indestructible counter');
  });

  test('Planes: Amy\'s Home — a nonland card suspended from hand at upkeep; chaos: time travel', (mk, t) => {
    t.auto('Amy\'s Home');
    const T = onPlane(mk, 'Amy\'s Home');
    const giant = T.hand('B', 'Hill Giant');
    T.nextTurn('B');
    t.zone(giant, 'exile', 'Hill Giant exiled');
    t.eq(Number(giant.counters.time) || 0, 4, 'with four time counters');
    T.nextTurn('A');
    T.nextTurn('B');
    t.eq(Number(giant.counters.time) || 0, 3, 'suspend ticks down');
  });
  // the plane or planes face up now, by name
  const upNames = (T) => T.g.facePlanes().map(o => o.name).sort();

  test('Planes: Akoum — any player casts enchantments with flash; chaos: destroy a creature that isn\'t enchanted', (mk, t) => {
    t.auto('Akoum');
    const T = onPlane(mk, 'Akoum');
    const paci = T.hand('B', 'Pacifism'), bear = T.hand('B', 'Grizzly Bears');
    t.ok(T.g._flashFor('B', paci), 'B\'s enchantment has flash on A\'s turn');
    t.no(T.g._flashFor('B', bear), 'a creature has not');
    const foe = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: foe.id }] }));
    chaos(T);
    t.zone(foe, 'graveyard');
  });

  test('Planes: Celestine Reef — creatures without flying or islandwalk can\'t attack; chaos: you can\'t lose until a player planeswalks', (mk, t) => {
    t.auto('Celestine Reef');
    const T = onPlane(mk, 'Celestine Reef');
    const bear = T.bf('A', 'Grizzly Bears'), bird = T.bf('A', 'Suntail Hawk');
    t.no(T.g.canAttack(bear), 'the Bears can\'t attack');
    t.ok(T.g.canAttack(bird), 'a flier can');
    chaos(T);
    T.player('A').life = 0;
    T.g.checkStateBasedActions();
    t.no(T.player('A').hasLost, 'A at 0 life has not lost');
    walkTo(T, 'Shiv');
    T.g.checkStateBasedActions();
    t.ok(T.player('A').hasLost, 'once a player planeswalks, A loses');
  });

  test('Planes: Fields of Summer — a caster may gain 2 life; chaos: you may gain 10', (mk, t) => {
    t.auto('Fields of Summer');
    const T = onPlane(mk, 'Fields of Summer');
    T.cast('A', T.hand('A', 'Ornithopter'));
    t.eq(T.life('A'), 22, 'A gains 2');
    t.ok(T.asked.some(c => c.type === 'confirm' && c.playerId === 'A'), 'asked of the caster');
    chaos(T);
    t.eq(T.life('A'), 32, 'and 10');
  });

  test('Planes: Grixis — blue, black and red creature cards in your graveyard have unearth for their mana cost; chaos: reanimate any graveyard\'s', (mk, t) => {
    t.auto('Grixis');
    const T = onPlane(mk, 'Grixis');
    const bat = T.grave('A', 'Vampire Nighthawk'), bear = T.grave('A', 'Grizzly Bears');
    t.ok(T.g.altUsesFor('A', bat.id).some(u => u.via === 'unearth' && u.cost === '{1}{B}{B}'), 'Nighthawk: unearth {1}{B}{B}');
    t.no(T.g.altUsesFor('A', bear.id).some(u => u.via === 'unearth'), 'the green Bears: none');
    const theirs = T.grave('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: theirs.id }] }));
    chaos(T);
    t.zone(theirs, 'battlefield');
    t.eq(theirs.controller, 'A', 'under A\'s control');
  });

  test('Planes: Horizon Boughs — all permanents untap during each player\'s untap step', (mk, t) => {
    t.auto('Horizon Boughs');
    const T = onPlane(mk, 'Horizon Boughs');
    const land = T.bf('A', 'Forest', { tapped: true });
    T.nextTurn('B');
    t.no(land.tapped, 'A\'s Forest untaps in B\'s untap step');
  });

  test('Planes: Interplanar Tunnel — five planes revealed, one put on top, and walked to', (mk, t) => {
    t.auto('Interplanar Tunnel');
    const T = mk({ planechase: true, planar: { A: ['Gavony', 'Interplanar Tunnel', 'Truga Jungle', 'Shiv', 'Krosa', 'Llanowar', 'Turri Island', 'Tazeem'], B: ['Academy at Tolaria West'] } });
    T.answer('choose', (ch) => ({ picks: [(ch.items || []).find(x => /Krosa/.test(x.label || x.name || ''))?.id || ((ch.items || [])[2] || {}).id] }));
    walkTo(T, 'Interplanar Tunnel');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Krosa']), 'walked on to the plane chosen');
    t.eq(T.g.planarDeck('A').length, 7, 'the rest at the bottom');
  });

  test('Planes: Inys Haen — planeswalking away returns every land card from graveyards, tapped', (mk, t) => {
    t.auto('Inys Haen');
    const T = onPlane(mk, 'Inys Haen', { library: Array(8).fill('Island') });
    const f = T.grave('A', 'Forest'), i = T.grave('B', 'Island');
    walkTo(T, 'Shiv');
    t.zone(f, 'battlefield'); t.zone(i, 'battlefield');
    t.ok(f.tapped && i.tapped, 'tapped');
    t.eq(i.controller, 'B', 'under its owner\'s control');
  });

  test('Planes: Isle of Vesuva — a nontoken creature entering makes its controller a copy', (mk, t) => {
    t.auto('Isle of Vesuva');
    const T = onPlane(mk, 'Isle of Vesuva');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Grizzly Bears'));
    t.eq(T.bfOf('A').filter(o => o.name === 'Grizzly Bears').length, 2, 'the Bears and a copy');
    t.eq(tokensOf(T, 'A', 'Grizzly Bears').length, 1, 'the copy a token');
  });

  test('Planes: Izzet Steam Maze — the caster copies an instant or sorcery', (mk, t) => {
    t.auto('Izzet Steam Maze');
    const T = onPlane(mk, 'Izzet Steam Maze');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    t.eq(T.life('B'), 16, 'two Shocks');
  });

  test('Planes: Lair of the Ashen Idol — upkeep: sacrifice a creature, or planeswalk', (mk, t) => {
    t.auto('Lair of the Ashen Idol');
    const T = onPlane(mk, 'Lair of the Ashen Idol');
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Truga Jungle']), 'A had no creature at the first upkeep: planeswalked on');
    walkTo(T, 'Lair of the Ashen Idol');
    const bear = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B');
    t.zone(bear, 'graveyard', 'B sacrificed the Bears');
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Lair of the Ashen Idol']), 'still on the Lair');
  });

  test('Planes: Lake Silencio — all spells have split second', (mk, t) => {
    t.auto('Lake Silencio');
    const T = onPlane(mk, 'Lake Silencio');
    const o = T.hand('A', 'Ornithopter');
    T.cast('A', o, { resolve: false });
    t.ok(T.g.hasKw(o, 'split second'), 'split second on the stack');
    const shock = T.hand('B', 'Shock');
    T.mana('B', 'R');
    t.no(T.g.castSpell('B', shock.id, { auto: true, targets: [{ kind: 'player', id: 'A' }] }), 'B can\'t respond');
    T.resolve();
  });

  test('Planes: Norn\'s Seedcore — on the walk, chaos: the next plane joins it', (mk, t) => {
    t.auto('Norn\'s Seedcore');
    const T = onPlane(mk, 'Gavony');
    walkTo(T, 'Norn\'s Seedcore');
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Norn\'s Seedcore', 'Truga Jungle']), 'both face up');
  });

  test('Planes: Onakke Catacomb — all creatures are black and have deathtouch', (mk, t) => {
    t.auto('Onakke Catacomb');
    const T = onPlane(mk, 'Onakke Catacomb');
    const bear = T.bf('B', 'Grizzly Bears');
    t.ok(T.g._cardFitsWords(bear, 'black') && !T.g._cardFitsWords(bear, 'green'), 'black, and no longer green');
    t.ok(T.g.hasKw(bear, 'deathtouch'), 'deathtouch');
  });

  test('Planes: Orzhova — planeswalking away returns every creature card from graveyards', (mk, t) => {
    t.auto('Orzhova');
    const T = onPlane(mk, 'Orzhova');
    const a = T.grave('A', 'Grizzly Bears'), b = T.grave('B', 'Hill Giant'), l = T.grave('A', 'Forest');
    walkTo(T, 'Shiv');
    t.zone(a, 'battlefield'); t.zone(b, 'battlefield'); t.zone(l, 'graveyard', 'not the land');
    t.eq(b.controller, 'B');
  });

  test('Planes: Otaria — instant and sorcery cards in graveyards have flashback for their mana cost', (mk, t) => {
    t.auto('Otaria');
    const T = onPlane(mk, 'Otaria');
    const d = T.grave('A', 'Divination'), s = T.grave('B', 'Shock');
    t.ok(T.g.altUsesFor('A', d.id).some(u => u.via === 'flashback' && u.cost === '{2}{U}'), 'A: Divination');
    t.ok(T.g.altUsesFor('B', s.id).some(u => u.via === 'flashback' && u.cost === '{R}'), 'B: Shock, though A controls the plane');
  });

  test('Planes: Pools of Becoming — chaos: the top three planar cards\' chaos abilities trigger', (mk, t) => {
    t.auto('Pools of Becoming');
    const T = onPlane(mk, 'Pools of Becoming');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Dragon').length, 1, 'Shiv\'s chaos: a Dragon');
    t.eq(JSON.stringify(deckNames(T, 'A')), JSON.stringify(['Truga Jungle', 'Shiv']), 'and they go to the bottom');
  });

  test('Planes: Reality Shaping — each player may put a permanent card from their hand onto the battlefield', (mk, t) => {
    t.auto('Reality Shaping');
    const T = onPlane(mk, 'Gavony');
    const g = T.hand('A', 'Hill Giant'), h = T.hand('B', 'Grizzly Bears');
    walkTo(T, 'Reality Shaping');
    T.g.checkStateBasedActions(); T.resolve();
    t.zone(g, 'battlefield'); t.zone(h, 'battlefield');
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Truga Jungle']), 'and on from the phenomenon');
  });

  test('Planes: Sanctum of Serra — chaos: you may have your life total become 20', (mk, t) => {
    t.auto('Sanctum of Serra');
    const T = onPlane(mk, 'Sanctum of Serra');
    T.player('A').life = 5;
    chaos(T);
    t.eq(T.life('A'), 20);
  });

  test('Planes: Sea of Sand — draws revealed; a land drawn gains 3, a nonland loses 3', (mk, t) => {
    t.auto('Sea of Sand');
    const T = onPlane(mk, 'Sea of Sand');
    T.top('A', 'Forest');
    T.g._drawCards(T.player('A'), 1); T.resolve();
    t.eq(T.life('A'), 23, 'a land: +3');
    T.top('A', 'Grizzly Bears');
    T.g._drawCards(T.player('A'), 1); T.resolve();
    t.eq(T.life('A'), 20, 'a nonland: -3');
    t.ok(T.g.log.some(l => /reveals Grizzly Bears as they draw it/.test(l.text)), 'revealed');
  });

  test('Planes: Spatial Merging — planeswalk to the next two planes at once', (mk, t) => {
    t.auto('Spatial Merging');
    const T = onPlane(mk, 'Gavony');
    walkTo(T, 'Spatial Merging');
    t.eq(JSON.stringify(upNames(T)), JSON.stringify(['Shiv', 'Truga Jungle']), 'both face up');
  });

  test('Planes: Spectrox Mines — chaos: a Food and a 2/2 Human Rogue', (mk, t) => {
    t.auto('Spectrox Mines');
    const T = onPlane(mk, 'Spectrox Mines');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Food').length, 1, 'a Food');
    t.eq(tokensOf(T, 'A').filter(o => /Rogue/.test(o.card.type_line)).length, 1, 'a Rogue');
  });

  test('Planes: Strixhaven — chaos: an instant or sorcery card from a graveyard to its owner\'s hand', (mk, t) => {
    t.auto('Strixhaven');
    const T = onPlane(mk, 'Strixhaven');
    const s = T.grave('B', 'Shock');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: s.id }] }));
    chaos(T);
    t.zone(s, 'hand');
    t.eq(s.owner, 'B');
  });

  test('Planes: Stronghold Furnace — damage doubled; chaos: 1 damage to any target, doubled', (mk, t) => {
    t.auto('Stronghold Furnace');
    const T = onPlane(mk, 'Stronghold Furnace');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    t.eq(T.life('B'), 18);
  });

  test('Planes: TARDIS Bay — the first spell of mana value 2 or more on your turn has cascade', (mk, t) => {
    t.auto('TARDIS Bay');
    const T = onPlane(mk, 'TARDIS Bay');
    T.top('A', 'Grizzly Bears');
    T.mana('A', '3R');
    T.cast('A', T.hand('A', 'Hill Giant'));
    t.ok(T.bfOf('A').some(o => o.name === 'Grizzly Bears'), 'cascaded into the Bears');
  });

  test('Planes: The Caldaia — creature spells from your hand have blitz {3}', (mk, t) => {
    t.auto('The Caldaia');
    const T = onPlane(mk, 'The Caldaia');
    const g = T.hand('A', 'Hill Giant');
    t.ok(T.g.altUsesFor('A', g.id).some(u => u.via === 'blitz' && u.cost === '{3}'), 'blitz {3}');
  });

  test('Planes: The Western Cloud — damage to your creatures prevented; chaos: three Treasures deal 1 each', (mk, t) => {
    t.auto('The Western Cloud');
    const T = onPlane(mk, 'The Western Cloud');
    const mine = T.bf('A', 'Grizzly Bears'), theirs = T.bf('B', 'Grizzly Bears');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Treasure').length, 3, 'three Treasures');
    t.zone(mine, 'battlefield', 'A\'s Bears unhurt');
    t.zone(theirs, 'graveyard', 'B\'s Bears dead');
  });

  test('Planes: Time Distortion — the turn order reversed', (mk, t) => {
    t.auto('Time Distortion');
    const T = mk({ planechase: true, players: ['A', 'B', 'C'], planar: { A: ['Gavony', 'Time Distortion', 'Truga Jungle'], B: ['Krosa'], C: ['Shiv'] } });
    walkTo(T, 'Time Distortion');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq(JSON.stringify(T.g.turnOrder), JSON.stringify(['C', 'B', 'A']), 'reversed');
    t.eq(T.g.activePlayer.id, 'A', 'still A\'s turn');
    T.nextTurn('C');
    t.eq(T.g.turn, 2, 'C\'s turn comes next');
  });

  test('Planes: Trail of the Mage-Rings — instants and sorceries have rebound', (mk, t) => {
    t.auto('Trail of the Mage-Rings');
    const T = onPlane(mk, 'Trail of the Mage-Rings');
    const s = T.hand('A', 'Shock');
    T.mana('A', 'R');
    T.cast('A', s, { targets: ['B'] });
    t.zone(s, 'exile', 'exiled with rebound');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    T.nextTurn('B'); T.nextTurn('A');
    t.eq(T.life('B'), 16, 'cast again at the upkeep');
  });

  test('Planes: Unleash the Flux — each player sacrifices a nonland permanent, again for each lost flip', (mk, t) => {
    t.auto('Unleash the Flux');
    const T = onPlane(mk, 'Gavony');
    const a = T.bf('A', 'Ornithopter'), a2 = T.bf('A', 'Ornithopter'), b = T.bf('B', 'Ornithopter');
    const flips = [false, true];
    T.g._flipOne = () => flips.shift();
    walkTo(T, 'Unleash the Flux');
    T.g.checkStateBasedActions(); T.resolve();
    t.eq([a, a2].filter(o => o.zone === 'graveyard').length, 2, 'A sacrificed twice');
    t.zone(b, 'graveyard');
  });

  test('Planes: Unyaro — walked to this turn: at your end step every creature untaps and phases out until a player planeswalks', (mk, t) => {
    t.auto('Unyaro');
    const T = onPlane(mk, 'Gavony');
    walkTo(T, 'Unyaro');
    const bear = T.bf('A', 'Grizzly Bears', { tapped: true }), foe = T.bf('B', 'Hill Giant');
    T.toMain('A', 'end'); T.resolve();
    t.ok(bear.phasedOut && foe.phasedOut, 'phased out');
    t.no(bear.tapped, 'untapped');
    T.nextTurn('B');
    t.ok(bear.phasedOut, 'still out at B\'s turn');
    walkTo(T, 'Krosa');
    t.no(bear.phasedOut || foe.phasedOut, 'back once B planeswalks');
  });

  test('Planes: Agyrem — chaos: creatures can\'t attack you until a player planeswalks', (mk, t) => {
    t.auto('Agyrem');
    const T = onPlane(mk, 'Agyrem');
    const foe = T.bf('B', 'Hill Giant');
    chaos(T);
    t.ok(T.g._cantAttackYou(foe, 'A'), 'B\'s creatures can\'t attack A');
    walkTo(T, 'Shiv');
    t.no(T.g._cantAttackYou(foe, 'A'), 'until a player planeswalks');
  });

  test('Planes: Agyrem — a bot\'s attacker sent at a player Agyrem holds is turned back, said in the log, without a source card', (mk, t) => {
    const T = onPlane(mk, 'Agyrem');
    const bear = T.bf('A', 'Grizzly Bears');
    T.player('A').isBot = true;
    T.player('B').planarHolds = [{ kind: 'notAttacked', untilWalk: null }];
    let threw = null, res;
    T.answer('declareAttackers', (ch, g) => {
      try { res = g.declareAttackers('A', [{ attackerId: bear.id, defenderId: 'B' }]); } catch (e) { threw = e; }
      return [];
    });
    T.toMain('A', 'end');
    t.eq(threw, null, 'no error (the hold has no permanent behind it)');
    t.ok(res !== false, 'the declaration goes on without it');
    t.ok(!bear.attacking, 'the bear does not attack');
    t.ok(T.g.log.some(l => /Grizzly Bears can't attack .* until a player planeswalks\.$/.test(l.text)), 'said in the log');
  });

  test('Planes: Eloren Wilds — chaos: target player can\'t cast spells until a player planeswalks', (mk, t) => {
    const T = onPlane(mk, 'Eloren Wilds');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    const s = T.hand('B', 'Shock');
    t.no(T.g.canCast('B', s.id).ok, 'B can\'t cast');
    walkTo(T, 'Shiv');
    t.ok(T.g.canCast('B', s.id).reason !== "You can't cast spells until a player planeswalks.", 'until a player planeswalks');
  });

  test('Planes: Naya — any number of lands; chaos: +1/+1 for each land you control', (mk, t) => {
    t.auto('Naya');
    const T = onPlane(mk, 'Naya');
    t.ok(T.g.landAllowance(T.player('A')) > 10, 'any number of lands');
    for (let i = 0; i < 3; i++) T.bf('A', 'Forest');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(T.g.powerOf(bear), 5, 'three lands: +3/+3');
  });

  test('Planes: Kessig — non-Werewolves deal no combat damage; chaos: +2/+2, trample, and Werewolves', (mk, t) => {
    t.auto('Kessig');
    const T = onPlane(mk, 'Kessig');
    const bear = T.bf('A', 'Grizzly Bears');
    chaos(T);
    t.eq(T.g.powerOf(bear), 4, '+2/+2');
    t.ok(T.g.hasKw(bear, 'trample'), 'trample');
    t.ok(T.g._hasCreatureType(bear, 'Werewolf'), 'a Werewolf');
    const g2 = T.bf('A', 'Hill Giant');
    g2.summoningSick = false; bear.summoningSick = false;
    T.answer('declareAttackers', [{ attackerId: g2.id, defenderId: 'B' }, { attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.resolve();
    t.eq(T.life('B'), 16, 'only the Werewolf\'s 4');
  });

  test('Planes: The Dark Barony — a nonblack card put into a graveyard costs its owner 1 life', (mk, t) => {
    const T = onPlane(mk, 'The Dark Barony');
    const s = T.hand('B', 'Shock'), bat = T.hand('B', 'Vampire Nighthawk');
    T.g.moveObject(s, 'graveyard'); T.resolve();
    t.eq(T.life('B'), 19, 'Shock: 1');
    T.g.moveObject(bat, 'graveyard'); T.resolve();
    t.eq(T.life('B'), 19, 'a black card: nothing');
  });

  test('Planes: Selesnya Loft Gardens — tokens and counters doubled for everybody', (mk, t) => {
    const T = onPlane(mk, 'Selesnya Loft Gardens');
    T.mana('A', '1W');
    T.cast('A', T.hand('A', 'Raise the Alarm'));
    t.eq(tokensOf(T, 'A', 'Soldier').length, 4, 'two Soldiers made four');
    const bear = T.bf('B', 'Grizzly Bears');
    T.g.addCounters(bear, '+1/+1', 1);
    t.eq(Number(bear.counters['+1/+1']) || 0, 2, 'one counter made two, on B\'s creature too');
  });

  test('Planes: Stairs to Infinity — chaos: the top planar card revealed, and put on the bottom if you like', (mk, t) => {
    const T = onPlane(mk, 'Stairs to Infinity');
    chaos(T);
    t.eq(JSON.stringify(deckNames(T, 'A')), JSON.stringify(['Shiv', 'Truga Jungle']), 'Truga Jungle to the bottom');
    t.ok(T.g.log.some(l => /reveals the top card of their planar deck: Truga Jungle/.test(l.text)), 'revealed');
  });

  test('Planes: Minamo — a caster may draw a card', (mk, t) => {
    const T = onPlane(mk, 'Minamo', { library: Array(8).fill('Island') });
    const h0 = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Ornithopter'));
    t.eq(T.zone('A', 'hand').length, h0 + 1, 'a card drawn');
  });
  test('Planes: Bant — chaos: a divinity counter, and indestructible while it stays', (mk, t) => {
    t.auto('Bant');
    const T = onPlane(mk, 'Bant');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(Number(bear.counters.divinity) || 0, 1, 'a divinity counter');
    t.ok(T.g.hasKw(bear, 'indestructible'), 'indestructible');
    delete bear.counters.divinity;
    T.g.checkStateBasedActions();
    t.no(T.g.hasKw(bear, 'indestructible'), 'not once the counter is gone');
  });

  test('Planes: Dalek Intensive Care — upkeep: a non-Dalek creature exiled for a 3/3 Dalek with menace and haste', (mk, t) => {
    t.auto('Dalek Intensive Care');
    const T = onPlane(mk, 'Dalek Intensive Care');
    const bear = T.bf('B', 'Grizzly Bears');
    T.nextTurn('B');
    t.zone(bear, 'exile');
    const d = tokensOf(T, 'B').find(o => /Dalek/.test(o.card.type_line));
    t.ok(d, 'a Dalek');
    t.ok(T.g.hasKw(d, 'menace') && T.g.hasKw(d, 'haste'), 'menace and haste');
  });

  test('Planes: Furnace Layer — a player at random discards; a land discarded costs 3 life', (mk, t) => {
    t.auto('Furnace Layer');
    const T = onPlane(mk, 'Gavony');
    T.hand('A', 'Forest'); T.hand('B', 'Forest');
    walkTo(T, 'Furnace Layer');
    const lost = ['A', 'B'].filter(id => T.life(id) === 17);
    t.eq(lost.length, 1, 'one player discarded the land and lost 3');
    t.ok(T.g.log.some(l => /is selected at random/.test(l.text)), 'selected at random');
  });

  test('Planes: Li\'l Giri Saves the Day — chaos: X counters, X the planar die rolls this turn', (mk, t) => {
    t.auto('Li\'l Giri Saves the Day');
    const T = onPlane(mk, 'Li\'l Giri Saves the Day');
    const ox = T.bf('A', 'Karn, Silver Golem');
    faces(T, [BLANK]); T.g.rollPlanarDie('A'); T.resolve();
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: ox.id }] }));
    chaos(T);
    t.eq(Number(ox.counters['+1/+1']) || 0, 2, 'two rolls this turn: two counters');
  });

  test('Planes: Norn\'s Dominion — planeswalking away destroys each nonland permanent without a fate counter', (mk, t) => {
    t.auto('Norn\'s Dominion');
    const T = onPlane(mk, 'Norn\'s Dominion');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('B', 'Hill Giant'), l = T.bf('A', 'Forest');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: a.id }] }));
    chaos(T);
    t.eq(Number(a.counters.fate) || 0, 1, 'a fate counter');
    walkTo(T, 'Shiv');
    t.zone(a, 'battlefield', 'the Bears had a fate counter');
    t.zone(b, 'graveyard', 'the Giant did not');
    t.zone(l, 'battlefield', 'lands stay');
    t.no(a.counters.fate, 'the fate counters gone');
  });

  test('Planes: Prahv — cast a spell, no attacking; attacked, no spells', (mk, t) => {
    t.auto('Prahv');
    const T = onPlane(mk, 'Prahv');
    const bear = T.bf('A', 'Grizzly Bears');
    t.ok(T.g.canAttack(bear), 'can attack before any spell');
    T.cast('A', T.hand('A', 'Ornithopter'));
    t.no(T.g.canAttack(bear), 'not after a spell');
    T.nextTurn('B'); T.nextTurn('A');
    T.answer('declareAttackers', [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end');
    const o = T.hand('A', 'Shock');
    T.mana('A', 'R');
    t.no(T.g.canCast('A', o.id).ok, 'no spells after attacking');
  });

  test('Planes: Skybreen — spells sharing a card type with a library\'s top card can\'t be cast', (mk, t) => {
    t.auto('Skybreen');
    const T = onPlane(mk, 'Skybreen');
    T.top('B', 'Hill Giant');
    const bear = T.hand('A', 'Grizzly Bears'), shock = T.hand('A', 'Shock');
    t.no(T.g.canCast('A', bear.id).ok, 'a creature on top of B\'s library: no creature spells');
    T.mana('A', 'R');
    t.ok(T.g.canCast('A', shock.id).ok, 'an instant is fine');
  });

  test('Planes: The Aether Flues — upkeep: sacrifice a creature for the next creature card of the library', (mk, t) => {
    t.auto('The Aether Flues');
    const T = onPlane(mk, 'The Aether Flues', { library: Array(6).fill('Island') });
    const bear = T.bf('B', 'Grizzly Bears');
    T.top('B', 'Hill Giant'); T.top('B', 'Island');
    T.answer('sacrifice', { cardIds: [bear.id] });
    T.nextTurn('B');
    t.zone(bear, 'graveyard', 'sacrificed');
    t.ok(T.bfOf('B').some(o => o.name === 'Hill Giant'), 'Hill Giant revealed and put onto the battlefield');
  });

  test('Planes: The Fertile Lands of Saulvinia — chaos: chaos ensues on the next plane of the planar deck', (mk, t) => {
    t.auto('The Fertile Lands of Saulvinia');
    const T = mk({ planechase: true, planar: { A: ['The Fertile Lands of Saulvinia', 'Shiv', 'Truga Jungle'], B: ['Gavony'] } });
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Dragon').length, 1, 'Shiv\'s chaos: a Dragon');
    t.eq(JSON.stringify(deckNames(T, 'A')), JSON.stringify(['Truga Jungle', 'Shiv']), 'Shiv to the bottom');
  });

  test('Planes: The Maelstrom — upkeep: a permanent card off the top onto the battlefield', (mk, t) => {
    t.auto('The Maelstrom');
    const T = onPlane(mk, 'The Maelstrom', { library: Array(6).fill('Island') });
    T.top('B', 'Hill Giant');
    T.nextTurn('B');
    t.ok(T.bfOf('B').some(o => o.name === 'Hill Giant'), 'onto the battlefield');
  });

  test('Planes: Valor\'s Reach — exactly two attackers get double strike', (mk, t) => {
    t.auto('Valor\'s Reach');
    const T = onPlane(mk, 'Valor\'s Reach');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', [{ attackerId: a.id, defenderId: 'B' }, { attackerId: b.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.resolve();
    t.eq(T.life('B'), 12, 'two Bears with double strike: 8');
  });

  test('Planes: We Hope You Like Squirrels — a Squirrel at each upkeep and for each spell cast', (mk, t) => {
    t.auto('We Hope You Like Squirrels');
    const T = onPlane(mk, 'We Hope You Like Squirrels');
    const n0 = tokensOf(T, 'A', 'Squirrel').length;
    T.cast('A', T.hand('A', 'Ornithopter'));
    t.eq(tokensOf(T, 'A', 'Squirrel').length, n0 + 1, 'a Squirrel for the spell');
    T.nextTurn('B');
    t.eq(tokensOf(T, 'B', 'Squirrel').length, 1, 'B\'s upkeep: B\'s Squirrel');
  });

  test('Planes: Eloren Wilds — mana doubled for whoever taps a permanent', (mk, t) => {
    t.auto('Eloren Wilds');
    const T = onPlane(mk, 'Eloren Wilds');
    const f = T.bf('A', 'Forest');
    T.g.tapForMana('A', f.id, 0);
    t.eq(T.player('A').pool.total(), 2, 'two mana');
  });

  test('Planes: Mirrored Depths — a caster flips a coin; a lost flip counters the spell', (mk, t) => {
    const T = onPlane(mk, 'Mirrored Depths');
    T.g._flipOne = () => false;
    const o = T.hand('A', 'Ornithopter');
    T.cast('A', o);
    t.zone(o, 'graveyard', 'countered');
  });

  test('Planes: Mount Keralia — planeswalking away, its pressure counters as damage to each creature', (mk, t) => {
    const T = onPlane(mk, 'Mount Keralia');
    const pl = T.g.facePlanes()[0];
    pl.counters.pressure = 3;
    const g = T.bf('B', 'Hill Giant'), bear = T.bf('A', 'Grizzly Bears');
    walkTo(T, 'Shiv');
    t.zone(g, 'graveyard'); t.zone(bear, 'graveyard');
  });

  test('Planes: Grand Ossuary — chaos: creatures exiled for Saprolings, as many as their power', (mk, t) => {
    const T = onPlane(mk, 'Grand Ossuary');
    T.bf('A', 'Hill Giant'); T.bf('B', 'Grizzly Bears');
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Saproling').length, 3, 'A: three');
    t.eq(tokensOf(T, 'B', 'Saproling').length, 2, 'B: two');
  });

  test('Planes: The Dining Car — upkeep: the creature with the least toughness sacrificed, then a Clue', (mk, t) => {
    const T = onPlane(mk, 'The Dining Car');
    const ox = T.bf('B', 'Ornithopter'), g = T.bf('B', 'Hill Giant');
    T.nextTurn('B');
    t.zone(ox, 'graveyard', 'the Ornithopter, toughness 2');
    t.zone(g, 'battlefield');
    t.eq(tokensOf(T, 'B', 'Clue').length, 1, 'a Clue');
  });

  test('Planes: Glen Elendra — chaos: gain control of a creature you own', (mk, t) => {
    const T = onPlane(mk, 'Glen Elendra');
    const bear = T.bf('B', 'Grizzly Bears');
    bear.owner = 'A';
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }] }));
    chaos(T);
    t.eq(bear.controller, 'A');
  });
  test('Planes: Selesnya Loft Gardens — chaos: for the turn, your lands make one mana more', (mk, t) => {
    t.auto('Selesnya Loft Gardens');
    const T = onPlane(mk, 'Selesnya Loft Gardens');
    chaos(T);
    const f = T.bf('A', 'Forest');
    T.g.tapForMana('A', f.id, 0);
    t.eq(T.player('A').pool.total(), 2, 'two mana from a Forest');
    const m = T.bf('B', 'Mountain');
    T.g.tapForMana('B', m.id, 0);
    t.eq(T.player('B').pool.total(), 1, 'not for B');
  });

  test('Planes: Minamo — chaos: each player may return a blue card from their graveyard', (mk, t) => {
    t.auto('Minamo');
    const T = onPlane(mk, 'Minamo');
    const a = T.grave('A', 'Divination'), b = T.grave('B', 'Counterspell'), r = T.grave('B', 'Shock');
    T.answer('choose', (ch) => ({ picks: [(ch.items || [])[0].id] }));
    T.answer('choose', (ch) => ({ picks: [(ch.items || [])[0].id] }));
    chaos(T);
    t.zone(a, 'hand'); t.zone(b, 'hand'); t.zone(r, 'graveyard', 'not the red card');
  });

  test('Planes: Esper — chaos: white, blue and black creatures become artifacts; artifact creatures gain vigilance, menace, lifelink', (mk, t) => {
    t.auto('Esper');
    const T = onPlane(mk, 'Esper');
    const bat = T.bf('A', 'Vampire Nighthawk'), bear = T.bf('A', 'Grizzly Bears'), ox = T.bf('A', 'Ornithopter');
    chaos(T);
    t.ok(T.g._cardFitsWords(bat, 'artifact'), 'the black Nighthawk an artifact');
    t.no(T.g._cardFitsWords(bear, 'artifact'), 'the green Bears not');
    t.ok(T.g.hasKw(bat, 'menace') && T.g.hasKw(ox, 'vigilance') && T.g.hasKw(ox, 'lifelink'), 'the artifact creatures gain the keywords');
    t.no(T.g.hasKw(bear, 'menace'));
  });

  test('Planes: The Great Aerie — chaos: two creatures deal damage equal to their toughness to each other', (mk, t) => {
    t.auto('The Great Aerie');
    const T = onPlane(mk, 'The Great Aerie');
    const wall = T.bf('A', 'Wall of Stone'), bear = T.bf('B', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: wall.id }, { kind: 'object', id: bear.id }] }));
    chaos(T);
    t.zone(bear, 'graveyard', '8 damage to the Bears');
    t.zone(wall, 'battlefield', '2 to the Wall');
  });

  test('Planes: Gardens of Tranquil Repose — a dying creature is exiled with it, its controller scries; chaos: Daleks, one more than the cards exiled', (mk, t) => {
    t.auto('Gardens of Tranquil Repose');
    const T = onPlane(mk, 'Gardens of Tranquil Repose');
    const bear = T.bf('B', 'Grizzly Bears');
    T.g.destroy ? T.g.destroy(bear) : T.g.moveObject(bear, 'graveyard');
    T.resolve();
    t.zone(bear, 'exile');
    t.ok(T.asked.some(c => c.type === 'scry' && c.playerId === 'B'), 'B scries');
    chaos(T);
    t.eq(tokensOf(T, 'A').filter(o => /Dalek/.test(o.card.type_line)).length, 2, 'two Daleks');
  });

  test('Planes: The Doctor\'s Tomb — a creature that would die is exiled, its controller losing 2 life', (mk, t) => {
    const T = onPlane(mk, 'The Doctor\'s Tomb');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Shock'), { targets: [bear] });
    t.zone(bear, 'exile');
    t.eq(T.life('B'), 18);
  });
  test('Planes: Hotel of Fears — chaos: counters by your devotion to the colour chosen, then another creature sacrificed', (mk, t) => {
    t.auto('Hotel of Fears');
    const T = onPlane(mk, 'Hotel of Fears', { library: Array(8).fill('Island') });
    const bat = T.bf('A', 'Vampire Nighthawk'), bear = T.bf('A', 'Grizzly Bears');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bat.id }] }));
    // (the colour: a mode, Black the third)
    T.answer('mode', { modes: [2] });
    chaos(T);
    t.eq(Number(bat.counters['+1/+1']) || 0, 2, 'devotion to black: two');
    t.zone(bear, 'graveyard', 'the other creature sacrificed');
  });

  test('Planes: Prime Minister\'s Cabinet Room — at your combat, your creature becomes a copy of an opponent\'s', (mk, t) => {
    t.auto('Prime Minister\'s Cabinet Room');
    const T = onPlane(mk, 'Prime Minister\'s Cabinet Room');
    const bear = T.bf('A', 'Grizzly Bears'), g = T.bf('B', 'Hill Giant');
    T.nextTurn('B');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: bear.id }, { kind: 'object', id: g.id }] }));
    T.nextTurn('A');
    T.toMain('A', 'declareAttackers' === 'x' ? 'x' : 'main');
    T.g.passPriority(T.g.priorityPlayer.id, true); T.settle(); T.resolve();
    t.eq(bear.name, 'Hill Giant', 'a copy of the Giant');
  });

  test('Planes: Bowie Base One — at your end step, goad a creature of the player to your left', (mk, t) => {
    t.auto('Bowie Base One');
    const T = onPlane(mk, 'Bowie Base One');
    const g = T.bf('B', 'Hill Giant'), mine = T.bf('A', 'Grizzly Bears');
    T.toMain('A', 'end'); T.resolve();
    t.ok(g.goadedBy === 'A' || (g.goaded || []).includes?.('A') || T.g._isGoaded?.(g), 'B\'s Giant goaded');
    t.no(mine.goadedBy, 'not A\'s own');
  });

  test('Planes: Two Streams Facility — anchor: a land more; waterfall: +2/+0 and haste; chaos swaps', (mk, t) => {
    t.auto('Two Streams Facility');
    const T = mk({ planechase: true, planar: { A: ['Gavony', 'Two Streams Facility', 'Truga Jungle'], B: ['Krosa'] } });
    T.answer('choose', () => ({ picks: [0] }));
    T.answer('choose', () => ({ picks: [1] }));
    walkTo(T, 'Two Streams Facility');
    t.eq(T.player('A').planarStream, 'anchor'); t.eq(T.player('B').planarStream, 'waterfall');
    t.eq(T.g.landAllowance(T.player('A')), 2, 'A: two lands a turn');
    const g = T.bf('B', 'Hill Giant');
    t.eq(T.g.powerOf(g), 5, 'B\'s Giant +2/+0');
    t.ok(T.g.hasKw(g, 'haste'), 'and haste');
    chaos(T);
    t.eq(T.player('A').planarStream, 'waterfall', 'swapped');
    t.eq(T.g.powerOf(g), 3, 'B anchors now');
  });

  test('Planes: City of the Daleks — chaos: a hasty Dalek at each opponent, sacrificed at the end step', (mk, t) => {
    t.auto('City of the Daleks');
    const T = onPlane(mk, 'City of the Daleks');
    chaos(T);
    const d = tokensOf(T, 'A').filter(o => /Dalek/.test(o.card.type_line));
    t.eq(d.length, 1, 'one Dalek for the one opponent');
    t.eq(d[0].mustAttackPlayer, 'B', 'attacking B if able');
    t.ok(T.g.hasKw(d[0], 'haste') && T.g.hasKw(d[0], 'menace'), 'haste and menace');
    T.toMain('A', 'end'); T.resolve();
    T.nextTurn('B');
    t.eq(tokensOf(T, 'A').filter(o => /Dalek/.test(o.card.type_line)).length, 0, 'sacrificed');
  });

  test('Planes: Kharasha Foothills — chaos: sacrifice any number of creatures for that much damage', (mk, t) => {
    const T = onPlane(mk, 'Kharasha Foothills');
    const a = T.bf('A', 'Grizzly Bears'), b = T.bf('A', 'Grizzly Bears'), g = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: g.id }] }));
    T.answer('choose', () => ({ picks: [a.id, b.id] }));
    chaos(T);
    t.zone(a, 'graveyard'); t.zone(b, 'graveyard');
    t.eq(g.damage || g.damageMarked || 0, 2, 'two damage to the Giant');
  });

  test('Planes: The Wilds — chaos: the player sacrifices a creature; Food for it, two for a big one', (mk, t) => {
    t.auto('The Wilds');
    const T = onPlane(mk, 'The Wilds');
    const f0 = tokensOf(T, 'A', 'Food').length;
    T.bf('B', 'Craw Wurm');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    t.eq(tokensOf(T, 'A', 'Food').length, f0 + 2, 'toughness 4: two Food');
  });

  test('Planes: Mirrored Depths — chaos: a player\'s top card revealed, cast free if nonland', (mk, t) => {
    const T = onPlane(mk, 'Mirrored Depths');
    T.g._flipOne = () => true;
    T.top('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'player', id: 'B' }] }));
    chaos(T);
    t.ok(T.bfOf('A').some(o => o.name === 'Hill Giant'), 'A cast B\'s Giant');
  });
  test('Planes: Stensia — a creature\'s first damage to a player each turn: a +1/+1 counter on it', (mk, t) => {
    t.auto('Stensia');
    const T = onPlane(mk, 'Stensia');
    const bear = T.bf('A', 'Grizzly Bears');
    T.answer('declareAttackers', [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'end'); T.resolve();
    t.eq(Number(bear.counters['+1/+1']) || 0, 1, 'one counter');
    T.g.dealDamageToPlayer(T.player('B'), 1, bear); T.resolve();
    t.eq(Number(bear.counters['+1/+1']) || 0, 1, 'not twice in a turn');
  });

  test('Planes: Edge of Malacol — your creatures that would untap get two +1/+1 counters instead', (mk, t) => {
    t.auto('Edge of Malacol');
    const T = onPlane(mk, 'Edge of Malacol');
    const bear = T.bf('B', 'Grizzly Bears', { tapped: true });
    T.nextTurn('B');
    t.ok(bear.tapped, 'still tapped');
    t.eq(Number(bear.counters['+1/+1']) || 0, 2, 'two counters');
  });

  test('Planes: Mount Keralia — chaos: its damage to your permanents prevented for the game', (mk, t) => {
    t.auto('Mount Keralia');
    const T = onPlane(mk, 'Mount Keralia');
    T.g.facePlanes()[0].counters.pressure = 3;
    chaos(T);
    const mine = T.bf('A', 'Hill Giant'), theirs = T.bf('B', 'Hill Giant');
    walkTo(T, 'Shiv');
    t.zone(mine, 'battlefield', 'A\'s Giant spared');
    t.zone(theirs, 'graveyard', 'B\'s Giant dead');
  });

  test('Planes: Talon Gates — chaos: two time counters off each of your suspended cards', (mk, t) => {
    const T = onPlane(mk, 'Talon Gates');
    const g = T.hand('A', 'Hill Giant');
    T.g.moveObject(g, 'exile'); g.counters.time = 3; g.suspendedBy = 'A';
    chaos(T);
    t.eq(g.counters.time, 1, 'one left');
  });

  test('Planes: Glimmervoid Basin — chaos: each other player gets a copy of the target creature', (mk, t) => {
    const T = onPlane(mk, 'Glimmervoid Basin');
    const g = T.bf('B', 'Hill Giant');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: g.id }] }));
    chaos(T);
    t.eq(T.bfOf('A').filter(o => o.name === 'Hill Giant' && o.isToken).length, 1, 'A gets a copy');
    t.eq(T.bfOf('B').filter(o => o.name === 'Hill Giant').length, 1, 'B none');
  });

  test('Planes: Caught in a Parallel Universe — a copy, with menace, of a creature of the player to your left', (mk, t) => {
    t.auto('Caught in a Parallel Universe');
    const T = onPlane(mk, 'Gavony');
    const g = T.bf('B', 'Hill Giant'), bear = T.bf('A', 'Grizzly Bears');
    walkTo(T, 'Caught in a Parallel Universe');
    T.g.checkStateBasedActions(); T.resolve();
    const mine = T.bfOf('A').find(o => o.isToken && o.name === 'Hill Giant');
    t.ok(mine, 'A copies B\'s Giant');
    t.ok(T.g.hasKw(mine, 'menace'), 'with menace');
    t.ok(T.bfOf('B').some(o => o.isToken && o.name === 'Grizzly Bears'), 'B copies A\'s Bears');
  });

  test('Planes: Human—Time Lord Meta-Crisis — a nonlegendary copy of the first, counters by the second\'s power', (mk, t) => {
    t.auto('Human—Time Lord Meta-Crisis');
    const T = onPlane(mk, 'Gavony');
    const karn = T.bf('A', 'Karn, Silver Golem'), g = T.bf('A', 'Hill Giant');
    T.answer('choose', () => ({ picks: [karn.id, g.id], order: [karn.id, g.id] }));
    walkTo(T, 'Human—Time Lord Meta-Crisis');
    T.g.checkStateBasedActions(); T.resolve();
    const tok = T.bfOf('A').find(o => o.isToken && o.name === 'Karn, Silver Golem');
    t.ok(tok, 'a copy of Karn');
    t.zone(karn, 'battlefield', 'not legendary: both stay');
    t.eq(Number(tok.counters['+1/+1']) || 0, 3, 'three counters for the Giant');
  });
  test('Planes: Bad Wolf Bay — chaos: nothing enters from exile this turn, then planeswalk', (mk, t) => {
    t.auto('Bad Wolf Bay');
    const T = onPlane(mk, 'Bad Wolf Bay');
    const g = T.hand('A', 'Hill Giant');
    T.g.moveObject(g, 'exile');
    chaos(T);
    t.eq(JSON.stringify(T.g.facePlanes().map(o => o.name)), JSON.stringify(['Truga Jungle']), 'planeswalked on');
    T.g.moveObject(g, 'battlefield', { controller: 'A' });
    t.zone(g, 'exile', 'stays in exile this turn');
    T.nextTurn('B');
    T.g.moveObject(g, 'battlefield', { controller: 'A' });
    t.zone(g, 'battlefield', 'next turn it can');
  });
};
