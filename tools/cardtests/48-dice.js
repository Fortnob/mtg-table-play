/* Dice, as the table shows them: every die rolled is an event carrying who rolled it, its size and what it came up —
   the very number the game went on to use — with the dice rolled together in one group, so the table can show them
   flicking through numbers side by side in the middle and landing on that. Everybody sees them (a die rolled in
   secret is seen rolled, its number kept from all but its roller), and a guest gets them in its event stream. */
'use strict';
const contracts = require('../contracts');

module.exports = (test) => {
  const rollsOf = (T, since) => (T.g.events || []).filter(e => e.type === 'roll' && e.seq > (since || 0));
  const seqNow = (T) => T.g.eventSeq || 0;
  // the next die faces, in order (then the lowest face)
  const faces = (T, list) => { const d = list.slice(); T.g.rng.range = (a) => (d.length ? d.shift() : a); };
  // what each seat (and a watcher) is handed of these, through the stream a guest reads, checked as the table takes it
  const handedOut = (t, T, since) => {
    for (const pid of ['A', 'B', '__watching']) {
      const evs = T.g.eventsFor(pid, since).filter(e => e.type === 'roll');
      for (const e of evs) {
        const bad = contracts.checkEvent(e, pid);
        t.eq(bad.length, 0, `${pid}'s roll event keeps the contract: ${bad.map(x => x.path + ' ' + x.msg).join('; ')}`);
      }
      t.eq(evs.length, rollsOf(T, since).length, `${pid} is handed every die`);
    }
  };

  test('Dice: Contact Other Plane — one d20, its size, roller and result in the event, the result the one the game used', (mk, t) => {
    t.auto('Contact Other Plane');
    for (const face of [4, 13, 20]) {
      const T = mk();
      for (let i = 0; i < 6; i++) T.top('A', 'Island');
      const since = seqNow(T);
      faces(T, [face]);
      T.mana('A', '3U');
      const h0 = T.zone('A', 'hand').length;
      T.cast('A', T.hand('A', 'Contact Other Plane'));
      const [e, more] = rollsOf(T, since);
      t.ok(e && !more, 'one die');
      t.eq(e.player, 'A', 'rolled by A'); t.eq(e.sides, 20, 'a d20'); t.eq(e.result, face, 'the face it came up');
      t.eq(JSON.stringify(e.rolls), JSON.stringify([face]), 'one die rolled'); t.eq(e.ignored.length, 0, 'none ignored');
      t.eq(e.of, 1, 'a group of one'); t.ok(e.group >= 1, 'with a group');
      t.eq(e.sourceName, 'Contact Other Plane', 'for Contact Other Plane'); t.no(e.secret, 'seen by everybody');
      t.eq(T.g._lastRoll, face, 'the game went on with that number');
      // 1—9 draw two; 10—19 scry 2 then draw two; 20 scry 3 then draw three
      t.eq(T.zone('A', 'hand').length - h0, face === 20 ? 3 : 2, 'and did what that row says');
      t.ok(T.g.log.some(l => l.text === `A rolls a d20: ${face}.`), 'the log says the same');
      handedOut(t, T, since);
    }
  });

  test('Dice: Mr. House — three d6 rolled together are one group of three, each result the one its trigger saw', (mk, t) => {
    t.auto('Mr. House, President and CEO');
    const T = mk({ library: Array(30).fill('Island') });
    const g = T.g;
    const house = T.bf('A', 'Mr. House, President and CEO');
    g._createNamedToken('A', { token: 'Treasure', n: 2 });
    for (const tr of T.bfOf('A').filter(o => o.isToken && /Treasure/.test(o.name))) t.ok(g.tapForMana('A', tr.id, 0, 'R'), g.lastError);
    T.mana('A', '2');
    const seen = [];
    g.on('roll', (r) => seen.push(r.result));
    const since = seqNow(T);
    faces(T, [6, 2, 5]);
    T.activate('A', house, 0);
    const dice = rollsOf(T, since);
    t.eq(dice.length, 3, 'three dice');
    t.eq(dice.map(e => e.result).join(','), '6,2,5', 'their faces, in order');
    t.ok(dice.every(e => e.sides === 6 && e.result >= 1 && e.result <= 6), 'each a d6, within its range');
    t.eq(new Set(dice.map(e => e.group)).size, 1, 'one group'); t.ok(dice.every(e => e.of === 3), 'of three dice');
    t.eq(seen.join(','), '6,2,5', 'the same numbers the engine announced');
    t.eq(T.bfOf('A').filter(o => o.isToken && /Robot/.test(o.name)).length, 2, 'and the game used them: a 6 and a 5 make two Robots');
    // the next roll is a group of its own
    house.tapped = false; T.mana('A', '4');
    const since2 = seqNow(T);
    faces(T, [1]);
    T.activate('A', house, 0);
    const [next] = rollsOf(T, since2);
    t.ok(next && next.group !== dice[0].group && next.of === 1, 'another roll, another group');
    handedOut(t, T, since);
  });

  test('Dice: Wyll and Delina, Wild Mage — the d20 with advantage is one die of two shown, the lower dropped, the higher used', (mk, t) => {
    t.auto('Wyll, Blade of Frontiers'); t.auto('Delina, Wild Mage');
    const T = mk();
    T.bf('A', 'Wyll, Blade of Frontiers');
    const d = T.bf('A', 'Delina, Wild Mage'); d.summoningSick = false;
    const since = seqNow(T);
    faces(T, [3, 9]);
    T.answer('declareAttackers', () => [{ attackerId: d.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'declareBlockers'); T.settle(); T.resolve();
    const [e, more] = rollsOf(T, since);
    t.ok(e && !more, 'one roll');
    t.eq(e.sides, 20); t.eq(JSON.stringify(e.rolls), '[3,9]', 'both dice shown'); t.eq(JSON.stringify(e.ignored), '[3]', 'the 3 dropped');
    t.eq(e.result, 9, 'the 9 kept'); t.eq(e.of, 1, 'one die rolled (Wyll\'s is shown with it)');
    t.eq(e.sourceName, 'Delina, Wild Mage', 'for Delina');
    t.eq(T.g._lastRoll, 9, 'the game used the 9');
    t.ok(T.bfOf('A').some(o => o.isToken && /Delina|Wyll/.test(o.name)), '1—14: a token copy attacking');
    handedOut(t, T, since);
  });

  test('Dice: rolled by hand — two d6 together are one group of two, a d20 after it another; all within range', (mk, t) => {
    const T = mk();
    const since = seqNow(T);
    for (let k = 0; k < 40; k++) T.g.manual('A', 'roll', { sides: 6, n: 2 });
    const pairs = rollsOf(T, since);
    t.eq(pairs.length, 80, 'two dice a roll');
    t.ok(pairs.every(e => e.sides === 6 && Number.isInteger(e.result) && e.result >= 1 && e.result <= 6), 'every one within 1–6');
    t.ok(new Set(pairs.map(e => e.result)).size >= 5, 'and they come out different');
    const byGroup = new Map();
    for (const e of pairs) byGroup.set(e.group, (byGroup.get(e.group) || []).concat([e]));
    t.eq(byGroup.size, 40, 'a group for each roll');
    t.ok(Array.from(byGroup.values()).every(g => g.length === 2 && g.every(e => e.of === 2 && e.player === 'A')), 'two dice in each, both A\'s');
    const since2 = seqNow(T);
    T.g.manual('B', 'roll', { sides: 20 });
    const [d20] = rollsOf(T, since2);
    t.eq(d20.player, 'B'); t.eq(d20.sides, 20); t.eq(d20.of, 1); t.ok(d20.result >= 1 && d20.result <= 20);
    t.ok(!byGroup.has(d20.group), 'a group of its own');
    t.ok(pairs.concat([d20]).every(e => e.sourceName === null), 'no card\'s: rolled by hand');
    t.eq(T.g.log[T.g.log.length - 1].text, `B rolls a d20: ${d20.result}.`, 'the log says what it came up');
    // (at most six at once)
    const since3 = seqNow(T);
    T.g.manual('A', 'roll', { sides: 4, n: 50 });
    t.eq(rollsOf(T, since3).length, 6, 'six dice at most');
    handedOut(t, T, since);
  });

  test('Dice: a die rolled in secret is seen rolled by everybody, and read only by its roller', (mk, t) => {
    const T = mk();
    const since = seqNow(T);
    faces(T, [17]);
    const got = T.g._rollDie(T.g.player('A'), 20, { secret: true });
    t.eq(got, 17, 'the engine has it');
    const mine = T.g.eventsFor('A', since).find(e => e.type === 'roll');
    t.eq(mine.result, 17, 'A reads it'); t.no(mine.hidden);
    for (const pid of ['B', '__watching']) {
      const theirs = T.g.eventsFor(pid, since).find(e => e.type === 'roll');
      t.ok(theirs && theirs.hidden, `${pid} sees a die rolled`);
      t.eq(theirs.result, null, `but not what it came up`); t.eq(theirs.sides, 20, 'only that it is a d20');
      t.ok(theirs.rolls.every(r => r === null), 'nor any of its dice');
    }
    t.no(T.g.log.some(l => /17/.test(l.text)), 'nor does the log say');
    handedOut(t, T, since);
  });
};
