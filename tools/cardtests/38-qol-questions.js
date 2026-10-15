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

  /* ---------- questions with one answer, or answers all alike ---------- */
  const said = (T, text) => T.g.log.some(l => l.text === text);
  const emptyHand = (T, pid) => { const h = T.zone(pid, 'hand'); while (h.length) T.g.moveObject(h[0], 'graveyard'); };

  test('Nothing to decide: a discard of the whole hand is not asked; a choice between cards is', (mk, t) => {
    t.auto('Faithless Looting');
    let T = mk({ library: Array(20).fill('Island') });
    emptyHand(T, 'A');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Faithless Looting'));
    t.eq(asked(T, 'discard'), 0, 'draw two, discard two, with two in hand: not asked');
    t.eq(T.zone('A', 'hand').length, 0, 'both discarded');
    t.ok(said(T, 'A has only one choice: discard Island, Island.'), 'the log says what went');
    // three cards, two of them different: a choice
    T = mk({ library: Array(20).fill('Island') });
    emptyHand(T, 'A');
    T.hand('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Faithless Looting'));
    t.eq(asked(T, 'discard'), 1, 'two of three, not all alike: asked');
  });

  test('Nothing to decide: discarding one of identical cards is not asked; one of different cards is', (mk, t) => {
    t.auto('Liliana of the Veil');
    const T = mk({ library: Array(20).fill('Island') });
    emptyHand(T, 'A'); emptyHand(T, 'B');
    T.hand('B', 'Island'); T.hand('B', 'Island'); T.hand('B', 'Island');
    T.hand('A', 'Island'); T.hand('A', 'Grizzly Bears');
    const lil = T.bf('A', 'Liliana of the Veil');
    T.activate('A', lil, 0);
    t.eq(T.asked.filter(c => c.type === 'discard' && c.playerId === 'B').length, 0, 'three Islands: B is not asked');
    t.eq(T.zone('B', 'hand').length, 2, 'B discards one');
    t.ok(said(T, "B's choices are all alike: discard Island."), 'the log says so');
    t.eq(T.asked.filter(c => c.type === 'discard' && c.playerId === 'A').length, 1, 'an Island or the Bears: A is asked');
  });

  test('Nothing to decide: an edict with one creature, or identical untouched ones, is not asked; different ones are', (mk, t) => {
    t.auto('Diabolic Edict');
    const run = (setup) => {
      const T = mk({ library: Array(20).fill('Swamp') });
      setup(T);
      T.mana('A', 'B1');
      T.cast('A', T.hand('A', 'Diabolic Edict'), { targets: ['B'] });
      return T;
    };
    let T = run((T) => T.bf('B', 'Grizzly Bears'));
    t.eq(asked(T, 'sacrifice'), 0, 'one creature: not asked');
    t.eq(T.bfOf('B').length, 0, 'it is sacrificed');
    t.ok(said(T, 'B has only one choice: sacrifice Grizzly Bears.'), 'the log says so');
    T = run((T) => { T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears'); });
    t.eq(asked(T, 'sacrifice'), 0, 'two Bears just the same: not asked');
    t.eq(T.bfOf('B').length, 1, 'one of them goes');
    t.ok(said(T, "B's choices are all alike: sacrifice Grizzly Bears."), 'the log says so');
    T = run((T) => { T.bf('B', 'Grizzly Bears'); T.bf('B', 'Hill Giant'); });
    t.eq(asked(T, 'sacrifice'), 1, 'two different creatures: asked');
    T = run((T) => { T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears', { tapped: true }); });
    t.eq(asked(T, 'sacrifice'), 1, 'two Bears, one tapped: asked');
    T = run((T) => { T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears', { counters: { '+1/+1': 1 } }); });
    t.eq(asked(T, 'sacrifice'), 1, 'two Bears, one with a counter: asked');
    T = run((T) => {
      const a = T.bf('B', 'Grizzly Bears'); T.bf('B', 'Grizzly Bears');
      // (one of them enchanted: what points at it makes it different)
      const aura = T.bf('B', 'Rancor'); aura.attachedTo = a.id; a.attachments = [aura.id]; T.g.bumpBoard();
    });
    t.eq(asked(T, 'sacrifice'), 1, 'two Bears, one enchanted: asked');
  });

  test('Nothing to decide: a trigger it must have with one legal target is aimed without asking; a "may" or "up to" still asks', (mk, t) => {
    t.auto('Ravenous Chupacabra'); t.auto('Reclamation Sage'); t.auto('Skyclave Apparition');
    let T = mk({ library: Array(20).fill('Swamp') });
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', '2BB');
    T.cast('A', T.hand('A', 'Ravenous Chupacabra'));
    t.eq(asked(T, 'pickTarget'), 0, 'one creature an opponent controls: not asked');
    t.zone(bear, 'graveyard', 'destroyed');
    t.ok(said(T, 'A has only one choice: target Grizzly Bears.'), 'the log says so');
    // two: asked
    T = mk({ library: Array(20).fill('Swamp') });
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Hill Giant');
    T.mana('A', '2BB');
    T.cast('A', T.hand('A', 'Ravenous Chupacabra'));
    t.eq(asked(T, 'pickTarget'), 1, 'two creatures: asked');
    // "you may destroy target artifact or enchantment": the target is asked even with one
    T = mk({ library: Array(20).fill('Forest') });
    T.bf('B', 'Sol Ring');
    T.mana('A', '2G');
    T.cast('A', T.hand('A', 'Reclamation Sage'));
    t.eq(asked(T, 'pickTarget'), 1, 'a "may" trigger: asked');
    // "up to one target": none is a choice too
    T = mk({ library: Array(20).fill('Plains') });
    T.bf('B', 'Grizzly Bears');
    T.mana('A', '1WW');
    T.cast('A', T.hand('A', 'Skyclave Apparition'));
    t.eq(asked(T, 'pickTarget'), 1, 'an "up to one" target: asked');
  });

  test('Nothing to decide: "return a land you control" with only the one land is not asked', (mk, t) => {
    t.auto('Guildless Commons');
    const T = mk({ library: Array(20).fill('Island') });
    const gc = T.bf('A', 'Guildless Commons', { etb: true });
    T.resolve();
    t.eq(asked(T, 'pickCard'), 0, 'its own self the only land: not asked');
    t.zone(gc, 'hand', 'back to hand');
    const T2 = mk({ library: Array(20).fill('Island') });
    T2.bf('A', 'Forest');
    T2.bf('A', 'Guildless Commons', { etb: true });
    T2.resolve();
    t.eq(asked(T2, 'pickCard'), 1, 'a Forest as well: asked');
  });

  test('Nothing to decide: conniving with a hand of identical cards is not asked', (mk, t) => {
    t.auto("Raffine's Informant");
    const T = mk({ library: Array(20).fill('Island') });
    emptyHand(T, 'A');
    T.hand('A', 'Island'); T.hand('A', 'Island');
    T.bf('A', "Raffine's Informant", { etb: true });
    T.resolve();
    t.eq(asked(T, 'choose'), 0, 'three Islands: not asked');
    t.eq(T.zone('A', 'hand').length, 2, 'drew one, discarded one');
    t.ok(T.g.log.some(l => /^A's choices are all alike: Island\.$/.test(l.text)), 'the log says so');
    const T2 = mk({ library: Array(20).fill('Island') });
    emptyHand(T2, 'A');
    T2.hand('A', 'Island'); T2.hand('A', 'Grizzly Bears');
    T2.bf('A', "Raffine's Informant", { etb: true });
    T2.resolve();
    t.eq(asked(T2, 'choose'), 1, 'an Island or the Bears: asked');
  });

  test('Nothing to decide: "you may pay {4}" with no way to pay it is not asked', (mk, t) => {
    t.auto('Mana Vault');
    const T = mk({ library: Array(20).fill('Island') });
    T.bf('A', 'Mana Vault', { tapped: true });
    T.nextTurn('A');
    t.eq(asked(T, 'confirm'), 0, 'no mana: not asked');
    t.ok(said(T, 'Mana Vault: A cannot pay {4}.'), 'the log says why');
    const T2 = mk({ library: Array(20).fill('Island') });
    T2.bf('A', 'Mana Vault', { tapped: true });
    for (let i = 0; i < 4; i++) T2.bf('A', 'Island');
    T2.answer('confirm', { yes: true });
    T2.nextTurn('A');
    t.eq(asked(T2, 'confirm'), 1, 'four lands: asked');
  });

  test('Nothing to decide: "you may discard a card. If you do, draw a card." with an empty hand is not asked', (mk, t) => {
    t.auto("Artist's Talent");
    const T = mk({ library: Array(20).fill('Island') });
    T.bf('A', "Artist's Talent");
    emptyHand(T, 'A');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: ['B'] });
    emptyHand(T, 'A');
    T.resolve();
    t.eq(asked(T, 'confirm'), 0, 'nothing to discard: not asked');
  });

  test('Nothing to decide: the cost of sacrificing one of two identical Foods is not asked', (mk, t) => {
    t.auto('Bill the Pony');
    const T = mk({ library: Array(20).fill('Island') });
    const bill = T.bf('A', 'Bill the Pony');
    T.bf('A', 'Food'); T.bf('A', 'Food');
    T.activate('A', bill, 0, { targets: [bill] });
    t.eq(asked(T, 'sacrifice'), 0, 'two Foods alike: not asked');
    t.eq(T.bfOf('A').filter(o => o.name === 'Food').length, 1, 'one Food sacrificed');
  });

  test('Still asked: putting every card in hand on top, when they differ — the order is a choice', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    const toTop = () => { g._runEffects([{ op: 'handToTop', n: 2 }], { controller: 'A', name: 'Test' }, () => {}); T.settle(); };
    emptyHand(T, 'A');
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Hill Giant');
    toTop();
    t.eq(asked(T, 'pickCard'), 1, 'two different cards, both going: which goes on top is asked');
    emptyHand(T, 'A');
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Grizzly Bears');
    toTop();
    t.eq(asked(T, 'pickCard'), 1, 'two the same: not asked');
    t.eq(g.zones.A.library.slice(0, 2).map(o => o.name).join(), 'Grizzly Bears,Grizzly Bears', 'both on top');
    emptyHand(T, 'A');
    T.hand('A', 'Hill Giant');
    toTop();
    t.eq(asked(T, 'pickCard'), 1, 'one card: not asked');
    t.eq(g.zones.A.library[0].name, 'Hill Giant', 'on top');
  });

  test('Still asked: a card from an opponent\'s hand, and a look at the top of a library', (mk, t) => {
    t.auto('Duress');
    const T = mk({ library: Array(20).fill('Island') });
    emptyHand(T, 'B');
    T.hand('B', 'Lightning Bolt'); T.hand('B', 'Forest');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Duress'), { targets: ['B'] });
    t.eq(asked(T, 'pickCard'), 1, 'one card it could take, but the question shows the hand: asked');
    t.auto("Mishra's Bauble");
    const bauble = T.bf('A', "Mishra's Bauble");
    T.activate('A', bauble, 0, { targets: ['B'] });
    t.eq(asked(T, 'arrange'), 1, 'one card looked at: still shown');
  });
};
