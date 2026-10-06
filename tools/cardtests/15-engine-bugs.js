/* Engine bugs that were found and fixed, each kept here so it stays fixed:
   cards in two places at once, Auras on nothing, spells offered that could
   not be paid for, storm copies sharing the card, hidden cards on the wire,
   questions shown in a shape the table cannot read. */
'use strict';
module.exports = (test) => {
  /** Every object is in exactly one list, and its own zone says the same. */
  const zonesAgree = (T, t) => {
    const g = T.g;
    const where = new Map();
    const note = (o, z) => {
      t.no(where.has(o.id), `${o.name} (${o.id}) is in ${where.get(o.id)} and ${z}`);
      where.set(o.id, z);
      t.eq(o.zone, z, `${o.name} is in ${z} but says`);
    };
    for (const z of Object.values(g.zones)) for (const [k, list] of Object.entries(z)) for (const o of list) note(o, k);
    for (const o of g.battlefield) note(o, 'battlefield');
  };

  test('Bugs: "Scry 1. Draw a card." places the card before drawing (Opt)', (mk, t) => {
    const T = mk();
    const lib = T.zone('A', 'library');
    const second = T.top('A', 'Island');
    const first = T.top('A', 'Mountain');
    const size = lib.length;
    let shown = null;
    T.answer('scry', (ch) => { shown = (ch.cards || []).map(c => c.id); return { top: [], bottom: shown }; });
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Opt'));
    t.eq(shown && shown.join(), first.id, 'the question showed the top card, before anything was drawn');
    t.zone(second, 'hand', 'the card under it was drawn');
    t.eq(lib[lib.length - 1], first, 'the scried card went to the bottom');
    t.eq(lib.length, size - 1);
    zonesAgree(T, t);
  });

  test('Bugs: a card kept on top by scry is not put back twice', (mk, t) => {
    const T = mk();
    const lib = T.zone('A', 'library');
    T.top('A', 'Island'); T.top('A', 'Forest');
    const size = lib.length;
    T.answer('scry', (ch) => ({ top: (ch.cards || []).map(c => c.id), bottom: [] }));
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Opt'));
    t.eq(lib.length, size - 1, 'one drawn, none duplicated');
    t.eq(new Set(lib.map(o => o.id)).size, lib.length, 'each card once');
    zonesAgree(T, t);
  });

  test('Bugs: surveil into the graveyard, then draw (Consider)', (mk, t) => {
    const T = mk();
    const second = T.top('A', 'Island');
    const first = T.top('A', 'Mountain');
    T.answer('surveil', (ch) => ({ top: [], bottom: (ch.cards || []).map(c => c.id) }));
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Consider'));
    t.zone(first, 'graveyard');
    t.zone(second, 'hand');
    zonesAgree(T, t);
  });

  test('Bugs: a bot answers the scry it was shown', (mk, t) => {
    const T = mk();
    T.top('A', 'Island'); const first = T.top('A', 'Mountain');
    const bot = new T.MTG.bots.BotPlayer(T.g, 'A', 5);
    T.answer('scry', (ch, g) => {
      // the top of the library has moved on since the question was asked
      T.top('A', 'Forest');
      bot.doChoice(ch);
      return null;
    });
    T.mana('A', 'U');
    try { T.cast('A', T.hand('A', 'Opt')); } catch (e) { /* the bot answered it already */ }
    T.resolve();
    t.no(T.zone('A', 'library').filter(o => o === first).length > 1, 'no duplicates');
    zonesAgree(T, t);
  });

  test('Bugs: a player who leaves takes their permanents, and the Auras on them go', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const bear = T.bf('B', 'Grizzly Bears');
    const mine = T.bf('A', 'Hill Giant');
    T.mana('A', 'W1');
    const pac = T.hand('A', 'Pacifism');
    T.cast('A', pac, { targets: [bear] });
    // B has taken A's giant for good
    mine.effects.push({ control: 'B', until: null, ts: T.g._stampNew() });
    T.g.checkStateBasedActions();
    t.eq(mine.controller, 'B');
    T.g.concede('B');
    T.g.checkStateBasedActions();
    t.no(T.g.battlefield.includes(bear), 'the Bears are gone');
    t.no(bear.zone === 'battlefield', 'and do not think they are still there');
    t.zone(pac, 'graveyard', 'Pacifism enchanted something that has left');
    t.eq(pac.attachedTo, null);
    t.zone(mine, 'battlefield', 'the control effect ended with the player');
    t.eq(mine.controller, 'A');
    zonesAgree(T, t);
  });

  test('Bugs: a spell that needs colourless mana is not offered without it', (mk, t) => {
    const T = mk();
    const blast = T.hand('A', 'Null Elemental Blast');
    T.bf('B', 'Kiora\'s Follower');
    T.bf('A', 'Mountain');
    t.no(T.g.playableNow('A').some(x => x.objId === blast.id), 'a Mountain makes no {C}');
    T.bf('A', 'Wastes');
    t.ok(T.g.playableNow('A').some(x => x.objId === blast.id), 'Wastes does');
  });

  test('Bugs: whatever is offered as playable can be paid for', (mk, t) => {
    const T = mk();
    T.bf('A', 'Sol Ring');
    T.bf('A', 'Mountain'); T.bf('A', 'Mountain');
    T.hand('A', 'Hill Giant'); T.hand('A', 'Craw Wurm'); T.hand('A', 'Null Elemental Blast');
    const snap = T.g.snapshot();
    for (const x of T.g.playableNow('A').filter(x => x.kind === 'cast')) {
      const name = T.g.obj(x.objId).name;
      t.ok(T.g.canPayNow('A', T.g.canCast('A', x.objId).cost), name);
      T.g.restore(JSON.parse(JSON.stringify(snap)));
    }
    t.ok(T.g.playableNow('A').some(x => T.g.obj(x.objId).name === 'Hill Giant'), 'Sol Ring pays two of the four (three sources, four mana)');
  });

  test('Bugs: storm copies are objects of their own; the card waits on the stack', (mk, t) => {
    const T = mk();
    T.mana('A', 'RRR');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    const shot = T.hand('A', 'Grapeshot');
    T.mana('A', 'R1');
    T.cast('A', shot, { targets: ['B'], resolve: false });
    const items = T.g.stack.filter(s => s.name && s.name.startsWith('Grapeshot'));
    t.eq(items.length, 3, 'the spell and two copies');
    t.eq(new Set(items.map(s => s.objId)).size, 3, 'three objects');
    // let the top copy resolve
    T.g.passPriority('A', true); T.g.passPriority('B', true);
    T.settle();
    t.zone(shot, 'stack', 'the card is still a spell');
    T.resolve();
    t.zone(shot, 'graveyard');
    t.eq(T.life('B'), 20 - 3 - 3 - 3);
    zonesAgree(T, t);
  });

  test('Bugs: a face-down permanent is its controller\'s to see', (mk, t) => {
    const T = mk();
    const o = T.bf('A', 'Grizzly Bears');
    o.faceDown = true;
    T.g.bumpBoard();
    const theirs = T.g.viewFor('B').battlefield.find(x => x.id === o.id);
    const mine = T.g.viewFor('A').battlefield.find(x => x.id === o.id);
    t.eq(theirs.card.name, 'Face-down card');
    t.no(JSON.stringify(theirs).includes('Grizzly'), 'nothing of the card reaches B');
    t.eq(mine.card.name, 'Grizzly Bears');
    t.eq(theirs.power, 2);
  });

  test('Bugs: cumulative upkeep in life asks with a cost the table can read', (mk, t) => {
    const T = mk();
    T.bf('A', 'Inner Sanctum');
    T.answer('payOrDont', (ch) => { t.eq(JSON.stringify(ch.cost), '{"life":2}'); return { pay: true }; });
    T.nextTurn('B');
    T.nextTurn('A');
    t.ok(T.asked.some(ch => ch.type === 'payOrDont' && ch.cost && ch.cost.life === 2), 'asked');
    t.eq(T.life('A'), 18);
  });

  test('Bugs: a bot sacrifices only what the question allows', (mk, t) => {
    const T = mk();
    const cheap = T.bf('A', 'Llanowar Elves');
    const big = T.bf('A', 'Craw Wurm');
    const bot = new T.MTG.bots.BotPlayer(T.g, 'A', 5);
    T.g.queueChoice({ type: 'sacrifice', playerId: 'A', count: 1, filter: 'creature', candidates: [big.id], prompt: 'Sacrifice a creature.' });
    bot.doChoice(T.g.pendingChoice);
    t.zone(big, 'graveyard');
    t.zone(cheap, 'battlefield');
  });

  test('Bugs: a top card played revealed is shown to everybody; one you may look at, to you', (mk, t) => {
    const T = mk();
    T.top('A', 'Forest');
    T.bf('A', 'Courser of Kruphix');
    t.ok(T.g.viewFor('B').players.find(p => p.id === 'A').topCard, 'Courser reveals it to B');
    const T2 = mk();
    T2.top('A', 'Grizzly Bears');
    T2.bf('A', 'Vizier of the Menagerie');
    t.ok(T2.g.viewFor('A').players.find(p => p.id === 'A').topCard, 'A may look');
    t.no(T2.g.viewFor('B').players.find(p => p.id === 'A').topCard, 'B may not');
  });
};
