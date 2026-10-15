/* What players know of hidden cards: a card revealed, or looked at, stays shown to those who saw it while it stays
   where it is (knownTo), and to nobody else; "play with the top card of your library revealed" and "you may look at
   the top card of your library any time" show that card to the right players. */
'use strict';
module.exports = (test) => {
  const handOf = (g, viewer, pid) => g.viewFor(viewer).players.find(p => p.id === pid).hand;
  const shownIn = (g, viewer, pid, o) => { const x = handOf(g, viewer, pid).find(c => c.id === o.id); return !!(x && !x.hidden && x.card && x.card.name === o.name); };
  const topOf = (g, viewer, pid) => g.viewFor(viewer).players.find(p => p.id === pid).topCard;
  // nothing of the card reaches a view it is hidden from: not its name, nor its id among anything shown
  const leaks = (g, viewer, o) => JSON.stringify(g.viewFor(viewer)).includes('"name":"' + o.name + '"');

  test('Reveals: a card revealed from a hand stays face up there to everybody, until it moves (Duress)', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const orn = T.hand('B', 'Ornithopter');
    const bear = T.hand('B', 'Grizzly Bears');
    t.no(shownIn(g, 'A', 'B', orn), 'hidden at first');
    t.no(leaks(g, 'C', orn), 'and nothing of it in C\'s view');
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Duress'), { targets: ['B'] });
    // (Duress takes a noncreature, nonland card: Ornithopter is a creature, so both stay)
    t.zone(orn, 'hand'); t.zone(bear, 'hand');
    for (const v of ['A', 'C']) {
      t.ok(shownIn(g, v, 'B', orn) && shownIn(g, v, 'B', bear), `${v} still sees the revealed hand`);
      const x = handOf(g, v, 'B').find(c => c.id === orn.id);
      t.eq(x.seenBy, 'all', 'marked revealed');
    }
    // its owner sees that it is known
    t.eq(handOf(g, 'B', 'B').find(c => c.id === orn.id).seenBy, 'all', 'B is told the card is known');
    // a card drawn since is not
    g.drawCards('B', 1);
    const drawn = g.zones.B.hand[g.zones.B.hand.length - 1];
    t.no(shownIn(g, 'A', 'B', drawn), 'a card drawn later is hidden');
    // the card moves (cast, bounced back): it is a new object, and nobody knows it is that one
    g.moveObject(orn, 'battlefield'); g.moveObject(orn, 'hand');
    t.no(shownIn(g, 'A', 'B', orn), 'gone from view once it has moved');
    t.ok(shownIn(g, 'A', 'B', bear), 'the other card still shown');
  });

  test('Reveals: a hand looked at is known to the one who looked, and to nobody else (Gitaxian Probe, 3 players)', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const orn = T.hand('B', 'Ornithopter');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Gitaxian Probe'), { targets: ['B'] });
    t.zone(orn, 'hand');
    t.ok(shownIn(g, 'A', 'B', orn), 'A looked, and still sees it');
    const x = handOf(g, 'A', 'B').find(c => c.id === orn.id);
    t.ok(Array.isArray(x.seenBy) && x.seenBy.includes('A'), 'seen by A: ' + JSON.stringify(x.seenBy));
    t.no(shownIn(g, 'C', 'B', orn), 'C never saw it');
    t.no(leaks(g, 'C', orn), 'and C\'s view carries nothing of it');
    t.no(leaks(g, '__watching', orn), 'nor does a spectator\'s');
    t.eq(JSON.stringify(handOf(g, 'B', 'B').find(c => c.id === orn.id).seenBy), '["A"]', 'B is told A has seen it');
  });

  test('Reveals: the top card looked at stays known to the looker while it is on top; a shuffle ends it (Mishra\'s Bauble)', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const top = T.top('B', 'Ornithopter');
    const bauble = T.bf('A', "Mishra's Bauble");
    T.activate('A', bauble, 0, { targets: ['B'] });
    t.eq(g.zones.B.library[0], top, 'still on top');
    const seen = topOf(g, 'A', 'B');
    t.ok(seen && seen.id === top.id && seen.card.name === 'Ornithopter', 'A sees B\'s top card');
    t.no(topOf(g, 'B', 'B'), 'B has not seen it');
    t.no(topOf(g, 'C', 'B'), 'nor C');
    t.no(leaks(g, 'C', top), 'C\'s view says nothing of it');
    // a card put on top above it: no longer the top, not shown; draw that one and it is shown again
    const over = T.top('B', 'Island');
    t.no(topOf(g, 'A', 'B'), 'covered by an unknown card');
    g.zones.B.library.shift(); g.moveObject(over, 'graveyard');
    t.eq((topOf(g, 'A', 'B') || {}).id, top.id, 'known again once it is on top again');
    g.rng.shuffle(g.zones.B.library);
    t.no(top.knownTo, 'a shuffle forgets it');
    t.no(topOf(g, 'A', 'B'), 'and it is no longer shown');
  });

  test('Reveals: a tutor\'s "reveal it" is known in the hand it goes to (Eladamri\'s Call); Mystical Tutor on top', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const bears = T.top('A', 'Grizzly Bears');
    T.mana('A', 'GW');
    T.answer('pickCard', { cardIds: [bears.id] });
    T.cast('A', T.hand('A', "Eladamri's Call"));
    t.zone(bears, 'hand');
    t.ok(shownIn(g, 'B', 'A', bears) && shownIn(g, 'C', 'A', bears), 'revealed, and seen in A\'s hand');
    const bolt = T.put('A', 'Lightning Bolt', 'library', { top: false });
    T.mana('A', 'U');
    T.answer('pickCard', { cardIds: [bolt.id] });
    T.cast('A', T.hand('A', 'Mystical Tutor'));
    t.eq(g.zones.A.library[0], bolt, 'on top');
    for (const v of ['A', 'B', 'C']) t.eq((topOf(g, v, 'A') || {}).id, bolt.id, `${v} sees it on top`);
    t.eq(topOf(g, 'B', 'A').seenBy, 'all', 'revealed');
    // drawn, it is a new object in the hand: nobody knows it is that one
    g.drawCards('A', 1);
    t.zone(bolt, 'hand');
    t.no(shownIn(g, 'B', 'A', bolt), 'drawn: hidden again');
  });

  test('Reveals: scry keeps the top known to the one who scried, and to nobody else', (mk, t) => {
    const T = mk();
    const g = T.g;
    const top = T.top('A', 'Ornithopter');
    T.mana('A', 'U');
    T.answer('scry', (ch) => ({ top: ch.cards.map(c => c.id), bottom: [] }));
    T.cast('A', T.hand('A', 'Opt'));
    // Opt draws: the card scried is drawn, and the next is not known
    t.zone(top, 'hand');
    t.no(topOf(g, 'A', 'A'), 'the next card is unknown');
    const next = T.top('A', 'Island');
    T.mana('A', 'U');
    T.answer('scry', (ch) => ({ top: ch.cards.map(c => c.id), bottom: [] }));
    T.cast('A', T.hand('A', 'Preordain'));
    // Preordain: scry 2 then draw — the second card scried is on top, known to A
    const now = g.zones.A.library[0];
    t.ok(now && now.knownTo && now.knownTo.includes('A'), 'A knows what is on top');
    t.eq((topOf(g, 'A', 'A') || {}).id, now.id, 'and sees it on the library');
    t.no(topOf(g, 'B', 'A'), 'B does not');
    t.ok(next.zone === 'hand' || next.zone === 'library', 'the Island went somewhere');
  });

  test('Reveals: Future Sight and Courser show the top card to everybody; Vizier only to its controller', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    T.top('A', 'Ornithopter');
    T.bf('A', 'Future Sight');
    for (const v of ['A', 'B', 'C', '__watching']) {
      const tc = topOf(g, v, 'A');
      t.ok(tc && tc.card.name === 'Ornithopter', `${v} sees A's top card`);
      t.eq(tc.seenBy, 'all', 'marked revealed');
    }
    T.top('B', 'Grizzly Bears');
    T.bf('B', 'Courser of Kruphix');
    t.eq((topOf(g, 'C', 'B') || { card: {} }).card.name, 'Grizzly Bears', 'Courser: C sees B\'s top card');
    const top = T.top('C', 'Island');
    T.bf('C', 'Vizier of the Menagerie');
    t.eq((topOf(g, 'C', 'C') || {}).id, top.id, 'Vizier: its controller sees the top card');
    t.no(topOf(g, 'C', 'C').seenBy, 'not marked revealed');
    t.no(topOf(g, 'A', 'C'), 'nobody else does');
    t.no(leaks(g, 'B', top), 'nor is it in their view');
  });

  test('Reveals: what is known survives a snapshot, and a restored game shows the same', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const orn = T.hand('B', 'Ornithopter');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Gitaxian Probe'), { targets: ['B'] });
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    const before = JSON.stringify(handOf(g, 'A', 'B'));
    g.moveObject(orn, 'graveyard');
    t.ok(g.restore(snap), 'restored');
    const o2 = g.obj(orn.id);
    t.eq(o2.zone, 'hand', 'back in hand');
    t.eq(JSON.stringify(o2.knownTo), '["A"]', 'knowledge restored');
    t.eq(JSON.stringify(handOf(g, 'A', 'B')), before, 'A\'s view as it was');
    t.no(shownIn(g, 'C', 'B', o2), 'C still does not see it');
    // undo too: the card moved and came back with the take-back
    t.ok(shownIn(g, 'A', 'B', o2), 'A still does');
  });
  test('Look at the top: "Players play with the top card of their libraries revealed" shows every library to everybody (Wizened Snitches)', (mk, t) => {
    t.auto('Wizened Snitches');
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const tops = { A: T.top('A', 'Ornithopter'), B: T.top('B', 'Grizzly Bears'), C: T.top('C', 'Island') };
    T.bf('B', 'Wizened Snitches');
    for (const v of ['A', 'B', 'C']) for (const pid of ['A', 'B', 'C']) {
      const tc = topOf(g, v, pid);
      t.eq((tc || {}).id, tops[pid].id, `${v} sees ${pid}'s top card`);
      t.eq(tc.seenBy, 'all', 'revealed');
    }
  });

  test('Look at the top: Oura shows only a Faerie or instant on top; Pearl Lake Warden only itself, and may be cast from there', (mk, t) => {
    t.auto('Oura, the Imitator');
    const T = mk();
    const g = T.g;
    T.bf('A', 'Oura, the Imitator');
    const land = T.top('A', 'Island');
    t.no(topOf(g, 'A', 'A'), 'a land on top: not shown');
    const bolt = T.top('A', 'Opt');
    t.eq((topOf(g, 'A', 'A') || {}).id, bolt.id, 'an instant on top: shown to A');
    t.no(topOf(g, 'B', 'A'), 'never to B');
    t.ok(g._playFromRule('A', bolt, 'spell'), 'and A may cast it');
    const T2 = mk();
    const g2 = T2.g;
    const warden = T2.top('A', 'Pearl Lake Warden');
    t.eq((topOf(g2, 'A', 'A') || {}).id, warden.id, 'the Warden on top: its owner sees it');
    t.no(topOf(g2, 'B', 'A'), 'B does not');
    t.ok(g2._playFromRule('A', warden, 'spell'), 'castable from the top');
    T2.top('A', 'Island');
    t.no(topOf(g2, 'A', 'A'), 'covered: nothing shown');
    t.no(g2._playFromRule('A', warden, 'spell'), 'nor castable');
    T2.bf('A', 'Pearl Lake Warden');
    t.no(topOf(g2, 'A', 'A'), 'one on the battlefield says nothing of the library');
    t.ok(land.zone === 'library', 'the land stayed');
  });

  test('Look at the top: Lens of Clarity shows its controller face-down creatures and the top card; Keeper of the Lens too', (mk, t) => {
    t.auto('Lens of Clarity'); t.auto('Keeper of the Lens'); t.auto('Found Footage');
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const fd = T.bf('B', 'Grizzly Bears');
    fd.faceDown = true;
    const seen = (v) => { const x = g.viewFor(v).battlefield.find(o => o.id === fd.id); return x && x.card && x.card.name === 'Grizzly Bears'; };
    t.no(seen('A'), 'hidden at first');
    const top = T.top('A', 'Ornithopter');
    T.bf('A', 'Lens of Clarity');
    t.ok(seen('A'), 'Lens: A sees the face-down creature');
    t.no(seen('C'), 'C does not');
    t.eq((topOf(g, 'A', 'A') || {}).id, top.id, 'and A sees the top card');
    t.no(topOf(g, 'B', 'A'), 'B does not');
    T.bf('C', 'Keeper of the Lens');
    t.ok(seen('C'), 'Keeper of the Lens: C sees it too');
  });

  test('Look at the top: Eye Spy, Wand of Denial and Precognition look at another library, and may move the card', (mk, t) => {
    for (const n of ['Eye Spy', 'Draugr Thought-Thief', 'Lurking Informant', 'Wand of Denial', 'Precognition', 'Coral Fighters', "Saheeli's Silverwing", 'Case the Joint', 'Extract Power', 'Prophecy', 'Spy Network']) t.auto(n);
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const top = T.top('B', 'Ornithopter');
    T.mana('A', 'U');
    T.answer('confirm', { yes: false });
    T.cast('A', T.hand('A', 'Eye Spy'), { targets: ['B'] });
    t.zone(top, 'library');
    t.eq((topOf(g, 'A', 'B') || {}).id, top.id, 'left there: A knows it');
    t.no(topOf(g, 'C', 'B'), 'C does not');
    T.mana('A', 'U');
    T.answer('confirm', { yes: true });
    T.cast('A', T.hand('A', 'Eye Spy'), { targets: ['B'] });
    t.zone(top, 'graveyard', 'into the graveyard the second time');
    // Wand of Denial: a land is not for the graveyard; a nonland card is, for 2 life
    const land = T.top('C', 'Island');
    const wand = T.bf('A', 'Wand of Denial');
    T.activate('A', wand, 0, { targets: ['C'] });
    t.zone(land, 'library'); t.eq((topOf(g, 'A', 'C') || {}).id, land.id, 'the land looked at and known');
    const bear = T.top('C', 'Grizzly Bears');
    wand.tapped = false;
    const life = T.life('A');
    T.answer('confirm', { yes: true });
    T.activate('A', wand, 0, { targets: ['C'] });
    t.zone(bear, 'graveyard'); t.eq(T.life('A'), life - 2, 'paid 2 life');
  });

  test('Look at the top: Case the Joint looks at every library; Prophecy reveals, gains for a land, and shuffles', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    T.mana('A', '3U');
    T.cast('A', T.hand('A', 'Case the Joint'));
    for (const pid of ['A', 'B', 'C']) {
      const top = g.zones[pid].library[0];
      t.eq((topOf(g, 'A', pid) || {}).id, top.id, `A knows ${pid}'s top card`);
      if (pid !== 'A') t.no(topOf(g, pid, pid), `${pid} does not know their own`);
    }
    const land = T.top('B', 'Forest');
    const life = T.life('A');
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Prophecy'), { targets: ['B'] });
    t.eq(T.life('A'), life + 1, 'a land: 1 life');
    t.no(land.knownTo, 'shuffled: no longer known');
  });

  test('Look at the top: Spy Network shows a hand, a top card and face-down creatures to the one who looked', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const orn = T.hand('B', 'Ornithopter');
    const top = T.top('B', 'Island');
    const fd = T.bf('B', 'Grizzly Bears'); fd.faceDown = true;
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Spy Network'), { targets: ['B'] });
    t.ok(shownIn(g, 'A', 'B', orn), 'the hand');
    t.eq((topOf(g, 'A', 'B') || {}).id, top.id, 'the top card');
    t.eq((g.viewFor('A').battlefield.find(o => o.id === fd.id).card || {}).name, 'Grizzly Bears', 'the face-down creature');
    t.no(shownIn(g, 'C', 'B', orn) || topOf(g, 'C', 'B'), 'none of it to C');
    t.no((g.viewFor('C').battlefield.find(o => o.id === fd.id).card || {}).name === 'Grizzly Bears', 'nor the creature');
  });

  test('Look at the top: Glowcap Lantern\'s equipped creature lets its controller look', (mk, t) => {
    const T = mk();
    const g = T.g;
    const top = T.top('A', 'Ornithopter');
    const bear = T.bf('A', 'Grizzly Bears');
    const lantern = T.bf('A', 'Glowcap Lantern');
    t.no(topOf(g, 'A', 'A'), 'nothing yet');
    lantern.attachedTo = bear.id; bear.attachments.push(lantern.id); g.bumpBoard();
    t.eq((topOf(g, 'A', 'A') || {}).id, top.id, 'equipped: A sees the top card');
    t.no(topOf(g, 'B', 'A'), 'B does not');
  });
};
