/* Questions with nothing to decide are not asked: a scry showing only the cards you already kept on top,
   untouched since (keepSeenOnTop), and the questions with one possible answer. The ones that are a real
   choice still are. */
'use strict';
module.exports = (test) => {
  const asked = (T, type) => T.asked.filter(c => c.type === type).length;
  const seenLines = (T) => T.g.log.filter(l => /on top \(seen already\)/.test(l.text)).map(l => l.text);
  /* Rumor Gatherer on the battlefield; a creature enters and its trigger resolves, answered as the table does */
  const gatherer = () => {
    const mk0 = (mk) => {
      const T = mk({ library: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
      T.bf('A', 'Rumor Gatherer');
      return T;
    };
    const enter = (T) => { T.bf('A', 'Memnite', { etb: true }); T.resolve(); };
    return { mk0, enter };
  };

  test('Seen already: Rumor Gatherer asks for its first scry, not again for the card kept on top', (mk, t) => {
    t.auto('Rumor Gatherer');
    const { mk0, enter } = gatherer();
    const T = mk0(mk);
    const g = T.g, lib = g.zones.A.library;
    enter(T);
    t.eq(asked(T, 'scry'), 1, 'the first scry is asked');
    const top = lib[0];
    enter(T);
    t.eq(asked(T, 'scry'), 1, 'the second resolution draws instead');
    t.zone(top, 'hand', 'the card kept on top is drawn');
    enter(T);
    t.eq(asked(T, 'scry'), 2, 'a new card on top: asked');
    const kept = lib[0];
    enter(T);
    t.eq(asked(T, 'scry'), 2, 'the same card, kept already: not asked');
    t.eq(lib[0], kept, 'it stays on top');
    t.eq(seenLines(T).length, 1, 'the log says so');
    t.ok(/^A keeps 1 card on top \(seen already\)\.$/.test(seenLines(T)[0]), 'in those words: ' + seenLines(T)[0]);
    enter(T);
    t.eq(asked(T, 'scry'), 2, 'and again');
    t.eq(lib[0], kept, 'still on top');
  });

  test('Seen already: a draw, a shuffle, a mill, a card put back or the library reordered means asking again', (mk, t) => {
    const { mk0, enter } = gatherer();
    const ways = {
      draw: (g) => g.drawCards('A', 1),
      shuffle: (g) => g.manual('A', 'shuffle'),
      mill: (g) => g.manual('A', 'mill', { n: 1 }),
      // the same card taken and put back: the library is as it was, but it has been touched
      putBack: (g) => { const c = g.zones.A.library[0]; g.moveObject(c, 'hand'); g.moveObject(c, 'library'); },
      // the cards under it swapped round by hand: the top is the same, the library is not
      reorder: (g) => { const l = g.zones.A.library; const x = l[1]; l[1] = l[2]; l[2] = x; },
    };
    for (const [how, fn] of Object.entries(ways)) {
      const T = mk0(mk);
      const g = T.g;
      enter(T); enter(T); enter(T);      // asked, drawn, asked
      t.eq(asked(T, 'scry'), 2, how + ': asked twice so far');
      if (how === 'putBack') t.eq(g.zones.A.library[0].id, (() => { const c = g.zones.A.library[0]; fn(g); return c.id; })(), 'putBack: the same card is back on top');
      else fn(g);
      enter(T);
      t.eq(asked(T, 'scry'), 3, how + ': asked again');
      enter(T);
      t.eq(asked(T, 'scry'), 3, how + ': and not after that');
    }
  });

  test('Seen already: with the setting off, every scry is asked', (mk, t) => {
    const { mk0, enter } = gatherer();
    const T = mk0(mk);
    T.g.setAutoPass('A', { keepSeenOnTop: false });
    for (let i = 0; i < 5; i++) enter(T);
    t.eq(asked(T, 'scry'), 4, 'four scries (the second resolution draws), four questions');
    t.eq(seenLines(T).length, 0, 'none kept without asking');
  });

  test('Seen already: a card put on the bottom is not kept, and the card under it is new', (mk, t) => {
    const { mk0, enter } = gatherer();
    const T = mk0(mk);
    const g = T.g, lib = g.zones.A.library;
    enter(T); enter(T);                   // asked, drawn
    const first = lib[0];
    T.answer('scry', { top: [], bottom: [first.id] });
    enter(T);
    t.eq(lib[lib.length - 1], first, 'bottomed');
    enter(T);
    t.eq(asked(T, 'scry'), 3, 'the next card is asked about');
    enter(T);
    t.eq(asked(T, 'scry'), 3, 'and once kept, not again');
  });

  test('Seen already: surveil the same way; a scry is not a surveil', (mk, t) => {
    t.auto('Golbez, Crystal Collector');
    const T = mk({ library: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
    const g = T.g;
    T.bf('A', 'Golbez, Crystal Collector');
    const art = () => { T.bf('A', 'Mind Stone', { etb: true }); T.resolve(); };
    art();
    t.eq(asked(T, 'surveil'), 1, 'the first surveil is asked');
    const top = g.zones.A.library[0];
    art(); art();
    t.eq(asked(T, 'surveil'), 1, 'the card kept is not asked about again');
    t.eq(g.zones.A.library[0], top, 'still on top');
    t.eq(seenLines(T).length, 2, 'logged each time');
    // a scry of the same card is a different choice (the bottom, not the graveyard): asked
    T.bf('A', 'Rumor Gatherer');
    T.bf('A', 'Grizzly Bears', { etb: true }); T.resolve();
    t.eq(asked(T, 'scry'), 1, 'a scry of the card a surveil kept is asked');
    // kept on top by the scry too, nothing done to the library: the surveil's choice still stands
    art();
    t.eq(asked(T, 'surveil'), 1, 'the next surveil of it is not asked');
    // a draw, and the new card put into the graveyard: kept is nothing, and the card under it is new
    g.drawCards('A', 1);
    T.answer('surveil', (ch) => ({ top: [], bottom: ch.cards.map(c => c.id) }));
    const next = g.zones.A.library[0];
    art();
    t.eq(asked(T, 'surveil'), 2, 'after a draw: asked');
    t.zone(next, 'graveyard', 'surveilled away');
    art();
    t.eq(asked(T, 'surveil'), 3, 'the card under it: asked');
  });

  test('Seen already: what a player knows survives a snapshot', (mk, t) => {
    const { mk0, enter } = gatherer();
    const T = mk0(mk);
    const g = T.g;
    enter(T); enter(T); enter(T);
    t.eq(asked(T, 'scry'), 2, 'asked twice');
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    g.restore(snap);
    enter(T);
    t.eq(asked(T, 'scry'), 2, 'after a restore the kept card is still known');
    // and a setting turned off survives one too
    g.setAutoPass('A', { keepSeenOnTop: false });
    g.restore(JSON.parse(JSON.stringify(g.snapshot())));
    enter(T);
    t.eq(asked(T, 'scry'), 3, 'the setting comes back off');
  });

  test('Seen already: putting the same cards back in any order is not asked again either', (mk, t) => {
    const T = mk({ library: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
    const g = T.g;
    const arrange = () => {
      const e = { op: 'arrangeTop', n: 2 };
      g._runEffects([e], { controller: 'A', name: 'Test', obj: null }, () => {});
      T.settle();
    };
    arrange();
    t.eq(asked(T, 'arrange'), 1, 'asked the first time');
    const two = g.zones.A.library.slice(0, 2);
    arrange();
    t.eq(asked(T, 'arrange'), 1, 'the same two, in the order chosen: not asked');
    t.eq(g.zones.A.library[0], two[0], 'the order stands');
    g.drawCards('A', 1);
    arrange();
    t.eq(asked(T, 'arrange'), 2, 'after a draw: asked');
  });
};
