/* Keywords the reader calls automated have to do what they say, end to end:
   from the right zone, for the right cost, with their rider. */
'use strict';
module.exports = (test) => {
  test('Keywords: embalm exiles the card and makes a white Zombie token copy with no mana cost, as a sorcery', (mk, t) => {
    t.auto('Labyrinth Guardian');
    const T = mk();
    const g = T.g;
    const o = T.grave('A', 'Labyrinth Guardian');
    const use = g.altUsesFor('A', o.id).find(u => /^Embalm/.test(u.label));
    t.ok(use, 'embalm is offered from the graveyard');
    t.no(g.altUsesFor('A', o.id).some(u => u.via === 'embalm'), 'and not as a way to cast the card');
    T.mana('A', 'UUU3');
    const before = g.stack.length;
    T.cast('A', o, { via: use.via, resolve: false });
    t.zone(o, 'exile', 'the card is exiled to pay');
    t.no(g.stack.some(s => s.kind === 'spell'), 'nothing was cast');
    t.ok(g.stack.length > before, 'an ability is on the stack');
    T.resolve();
    const tok = T.bfOf('A').find(x => x.isToken && x.name === 'Labyrinth Guardian');
    t.ok(tok, 'a token copy entered');
    t.eq((tok.analysis().colors || []).join(''), 'W', 'white');
    t.ok(g._hasCreatureType(tok, 'Zombie') && g._hasCreatureType(tok, 'Illusion'), 'a Zombie as well as its own types');
    t.eq(tok.card.mana_cost, '', 'no mana cost');
    t.eq(g.powerOf(tok), 2, 'its own size');
  });

  test('Keywords: eternalize makes a 4/4 black Zombie token copy; not at instant speed', (mk, t) => {
    t.auto('Proven Combatant');
    const T = mk();
    const g = T.g;
    const o = T.grave('A', 'Proven Combatant');
    const use = g.altUsesFor('A', o.id).find(u => /^Eternalize/.test(u.label));
    t.ok(use, 'eternalize is offered from the graveyard');
    T.mana('A', 'UU4');
    T.toMain('A', 'end');
    t.no(g.canCast('A', o.id, use.via).ok, 'only as a sorcery');
    T.nextTurn('A');
    T.mana('A', 'UU4');
    T.cast('A', o, { via: use.via });
    t.zone(o, 'exile');
    const tok = T.bfOf('A').find(x => x.isToken && x.name === 'Proven Combatant');
    t.ok(tok, 'a token copy entered');
    t.eq((tok.analysis().colors || []).join(''), 'B', 'black');
    t.eq(g.powerOf(tok) + '/' + g.toughnessOf(tok), '4/4', '4/4');
    t.ok(g._hasCreatureType(tok, 'Zombie'), 'a Zombie');
  });

  /* Foretell (CR 702.143): checked end to end, as the audit of the keywords the reader calls automated */
  const exileView = (g, viewer, owner) => (g.viewFor(viewer).players.find(p => p.id === owner) || {}).exile || [];

  test('Keywords: foretell — on your turn only, {2}, face down and hidden from the other players', (mk, t) => {
    t.auto('Saw It Coming');
    const T = mk();
    const g = T.g;
    const o = T.hand('A', 'Saw It Coming');
    T.mana('A', '1');
    t.no(g.foretellCard('A', o.id, { auto: true }), 'one mana is not enough');
    t.zone(o, 'hand');
    T.mana('A', '1');
    t.ok(g.foretellCard('A', o.id, { auto: true }), g.lastError);
    t.zone(o, 'exile');
    t.eq(T.player('A').pool.total(), 0, '{2} was paid');
    t.no(g.stack.length, 'a special action: nothing on the stack');
    const mine = exileView(g, 'A', 'A').find(v => v.id === o.id);
    const theirs = exileView(g, 'B', 'A').find(v => v.id === o.id);
    t.ok(mine && mine.card.name === 'Saw It Coming' && !mine.faceDown, 'its owner sees it');
    t.ok(theirs && theirs.faceDown && theirs.card.name !== 'Saw It Coming', 'the opponent sees a face-down card');
    t.no(g.log.some(l => /Saw It Coming/.test(l.text)), 'the log does not name it');
    t.no(g.altUsesFor('A', o.id).some(u => u.via === 'foretell'), 'not castable the turn it was foretold');
    // on the opponent's turn, a card in hand can't be foretold
    const o2 = T.hand('A', 'Doomskar');
    T.nextTurn('B');
    T.mana('A', '2');
    t.no(g.altUsesFor('A', o2.id).some(u => u.kind === 'foretell'), 'not on another player\'s turn');
  });

  test('Keywords: a foretold card is cast on a later turn for its foretell cost', (mk, t) => {
    const T = mk();
    const g = T.g;
    const o = T.hand('A', 'Doomskar');
    T.mana('A', '2');
    t.ok(g.foretellCard('A', o.id, { auto: true }), g.lastError);
    const bear = T.bf('B', 'Grizzly Bears');
    T.nextTurn('A');
    const use = g.altUsesFor('A', o.id).find(u => u.via === 'foretell');
    t.ok(use, 'castable from exile now');
    t.eq(use.cost, '{1}{W}{W}', 'for its foretell cost');
    T.mana('A', 'WW1');
    T.cast('A', o, { via: 'foretell' });
    t.zone(bear, 'graveyard', 'Doomskar resolved');
    t.eq(T.player('A').pool.total(), 0, 'three mana, not five');
  });

  test('Keywords: Poison the Cup scries 2 only when it was foretold', (mk, t) => {
    t.auto('Poison the Cup');
    let T = mk();
    let b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'BB1');
    T.cast('A', T.hand('A', 'Poison the Cup'), { targets: [b] });
    t.zone(b, 'graveyard');
    t.no(T.asked.some(ch => /scry/i.test(ch.type + ' ' + (ch.prompt || ''))), 'cast from hand: no scry');
    T = mk();
    const o = T.hand('A', 'Poison the Cup');
    T.mana('A', '2');
    T.g.foretellCard('A', o.id, { auto: true });
    T.nextTurn('A');
    b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B1');
    T.cast('A', o, { via: 'foretell', targets: [b] });
    t.zone(b, 'graveyard');
    t.ok(T.asked.some(ch => /scry/i.test(ch.type + ' ' + (ch.prompt || ''))) || T.g.log.some(l => /scr(y|ies)/i.test(l.text)), 'foretold: it scries 2');
  });

  test('Keywords: Ranar the Ever-Watchful — the first foretell each turn is free, the second costs {2}; foretelling makes a Spirit', (mk, t) => {
    t.auto('Ranar the Ever-Watchful');
    const T = mk();
    const g = T.g;
    T.bf('A', 'Ranar the Ever-Watchful');
    const a1 = T.hand('A', 'Saw It Coming'), a2 = T.hand('A', 'Doomskar');
    const spirits = () => T.bfOf('A').filter(x => x.isToken && /Spirit/.test(x.card.type_line || '')).length;
    t.eq(g.altUsesFor('A', a1.id).find(u => u.kind === 'foretell').label, 'Foretell {0}', 'the first is offered for {0}');
    t.ok(g.foretellCard('A', a1.id, { auto: true }), g.lastError);
    t.zone(a1, 'exile');
    T.resolve();
    t.eq(spirits(), 1, 'a card exiled from the hand: a Spirit');
    t.no(g.foretellCard('A', a2.id, { auto: true }), 'the second costs {2}, and there is no mana');
    T.mana('A', '2');
    t.ok(g.foretellCard('A', a2.id, { auto: true }), g.lastError);
    T.resolve();
    t.eq(spirits(), 2, 'and another');
    // next turn, free again
    const a3 = T.hand('A', 'Augury Raven');
    T.nextTurn('A');
    t.eq(g.altUsesFor('A', a3.id).find(u => u.kind === 'foretell').cost, '', 'a new turn: the first is free again');
  });

  test("Keywords: Ranar — a permanent exiled by your spell makes a Spirit; one exiled by an opponent's doesn't", (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('A', 'Ranar the Ever-Watchful');
    const spirits = () => T.bfOf('A').filter(x => x.isToken && /Spirit/.test(x.card.type_line || '')).length;
    const b = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Swords to Plowshares'), { targets: [b] });
    t.zone(b, 'exile');
    t.eq(spirits(), 1, 'your Swords: a Spirit');
    // their removal on your creature: none
    const mine = T.bf('A', 'Grizzly Bears');
    T.nextTurn('B');
    T.mana('B', 'W');
    T.cast('B', T.hand('B', 'Swords to Plowshares'), { targets: [mine] });
    t.zone(mine, 'exile');
    t.eq(spirits(), 1, "the opponent's Swords: no Spirit");
    // a card of theirs exiled from their hand: none either
    const theirs = T.hand('B', 'Doomskar');
    T.mana('B', '2');
    t.ok(g.foretellCard('B', theirs.id, { auto: true }), g.lastError);
    T.resolve();
    t.eq(spirits(), 1, 'their foretelling: no Spirit');
  });

  test('Keywords: Hero of Bretagard counts the lot: two permanents exiled by one spell, two counters; a foretold card, one', (mk, t) => {
    t.auto('Hero of Bretagard');
    const T = mk();
    const g = T.g;
    const h = T.bf('A', 'Hero of Bretagard');
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Runeclaw Bear');
    T.mana('A', 'WW4');
    T.cast('A', T.hand('A', 'Winds of Abandon'), { via: 'overload' });
    t.eq(T.bfOf('B').filter(x => /Bear/.test(x.name)).length, 0, 'both exiled');
    t.eq(h.counters['+1/+1'] || 0, 2, 'two counters');
    T.mana('A', '2');
    t.ok(g.foretellCard('A', T.hand('A', 'Doomskar').id, { auto: true }), g.lastError);
    T.resolve();
    t.eq(h.counters['+1/+1'] || 0, 3, 'and one more');
  });

  test('Keywords: Cosmos Charger — foretelling costs {1} less, and can be done on any turn', (mk, t) => {
    t.auto('Cosmos Charger');
    const T = mk();
    const g = T.g;
    T.bf('A', 'Cosmos Charger');
    const o = T.hand('A', 'Doomskar');
    T.nextTurn('B');
    const use = g.altUsesFor('A', o.id).find(u => u.kind === 'foretell');
    t.ok(use, 'offered on the opponent\'s turn');
    t.eq(use.cost, '{1}', 'for {1}');
    T.mana('A', '1');
    // priority to A
    for (let i = 0; i < 5 && g.priorityPlayer && g.priorityPlayer.id !== 'A'; i++) g.passPriority(g.priorityPlayer.id, true);
    t.ok(g.foretellCard('A', o.id, { auto: true }), g.lastError);
    t.zone(o, 'exile');
  });

  test('Keywords: a bot foretells with mana to spare, and casts the card later', (mk, t) => {
    const T = mk();
    const g = T.g;
    const M = T.MTG;
    T.player('A').isBot = true;
    const bot = new M.bots.BotPlayer(g, 'A', 5);
    for (const n of ['Plains', 'Plains', 'Plains']) T.bf('A', n);
    const o = T.hand('A', 'Doomskar');
    t.ok(bot.foretellSpare(false), 'it foretells');
    t.zone(o, 'exile');
    t.no(bot.foretellSpare(true), 'not in the first main phase while it costs mana');
  });
};
