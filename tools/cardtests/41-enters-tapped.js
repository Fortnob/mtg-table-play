/* Lands (and others) that enter tapped unless, or only if, something holds: each wording on both sides of its line. */
'use strict';
module.exports = (test) => {
  // play the land from A's hand with these lands already out; is it tapped?
  const tappedWith = (mk, t, name, others, setup) => {
    const T = mk();
    for (const n of others) T.bf('A', n);
    if (setup) setup(T);
    const o = T.hand('A', name);
    T.playLand('A', o);
    t.zone(o, 'battlefield');
    return o.tapped;
  };

  test('Enters tapped: Rockfall Vale — untapped with two other lands, tapped with one', (mk, t) => {
    t.auto('Rockfall Vale');
    t.no(tappedWith(mk, t, 'Rockfall Vale', ['Forest', 'Forest']), 'two Forests: untapped');
    t.ok(tappedWith(mk, t, 'Rockfall Vale', ['Forest']), 'one Forest: tapped');
    t.ok(tappedWith(mk, t, 'Rockfall Vale', []), 'no lands: tapped');
  });

  test('Enters tapped: Mystic Sanctuary counts three other Islands', (mk, t) => {
    t.auto('Mystic Sanctuary');
    t.no(tappedWith(mk, t, 'Mystic Sanctuary', ['Island', 'Island', 'Island']), 'three Islands: untapped');
    t.ok(tappedWith(mk, t, 'Mystic Sanctuary', ['Island', 'Island', 'Forest']), 'two Islands: tapped');
  });

  test('Enters tapped: Concealed Courtyard — untapped with two or fewer other lands', (mk, t) => {
    t.auto('Concealed Courtyard');
    t.no(tappedWith(mk, t, 'Concealed Courtyard', ['Plains', 'Swamp']), 'two others: untapped');
    t.ok(tappedWith(mk, t, 'Concealed Courtyard', ['Plains', 'Swamp', 'Plains']), 'three others: tapped');
  });

  test('Enters tapped: Hall of Storm Giants — tapped with two or more other lands', (mk, t) => {
    t.no(tappedWith(mk, t, 'Hall of Storm Giants', ['Island']), 'one other: untapped');
    t.ok(tappedWith(mk, t, 'Hall of Storm Giants', ['Island', 'Island']), 'two others: tapped');
  });

  test('Enters tapped: Sunken Hollow counts only basic lands', (mk, t) => {
    t.auto('Sunken Hollow');
    t.no(tappedWith(mk, t, 'Sunken Hollow', ['Island', 'Swamp']), 'two basics: untapped');
    t.ok(tappedWith(mk, t, 'Sunken Hollow', ['Island']), 'one basic: tapped');
    t.ok(tappedWith(mk, t, 'Sunken Hollow', ['Island', 'Watery Grave', 'Command Tower']), 'one basic and two nonbasics: tapped');
  });

  test('Enters tapped: Glacial Fortress checks for a Plains or an Island', (mk, t) => {
    t.auto('Glacial Fortress');
    t.no(tappedWith(mk, t, 'Glacial Fortress', ['Island']), 'an Island: untapped');
    t.no(tappedWith(mk, t, 'Glacial Fortress', ['Hallowed Fountain']), 'a nonbasic Plains Island: untapped');
    t.ok(tappedWith(mk, t, 'Glacial Fortress', ['Forest']), 'only a Forest: tapped');
  });

  test('Enters tapped: Spire Garden and Abandoned Campground', (mk, t) => {
    t.auto('Abandoned Campground');
    t.ok(tappedWith(mk, t, 'Abandoned Campground', []), 'everybody above 5 life: tapped');
    t.no(tappedWith(mk, t, 'Abandoned Campground', [], T => { T.g.player('B').life = 5; }), 'a player at 5: untapped');
  });

  test('Enters tapped: Turbulent Fen looks at the opponents’ lands', (mk, t) => {
    t.auto('Turbulent Fen');
    t.ok(tappedWith(mk, t, 'Turbulent Fen', []), 'opponents with no lands: tapped');
    t.no(tappedWith(mk, t, 'Turbulent Fen', [], T => { for (let i = 0; i < 8; i++) T.bf('B', 'Mountain'); }), 'eight opponent lands: untapped');
  });

  test('Enters tapped: Rising Chicane only for the starting player', (mk, t) => {
    t.auto('Rising Chicane');
    const T = mk();
    const first = T.g.turnOrder[0], other = T.g.turnOrder[1];
    const a = T.hand(first, 'Rising Chicane');
    T.playLand(first, a);
    t.ok(a.tapped, 'the starting player: tapped');
    T.nextTurn(other);
    const b = T.hand(other, 'Rising Chicane');
    T.playLand(other, b);
    t.no(b.tapped, 'the other player: untapped');
  });

  test('Enters tapped: Captivating Crossroads — the starting player, in their first three turns', (mk, t) => {
    t.auto('Captivating Crossroads');
    const T = mk();
    const first = T.g.turnOrder[0], other = T.g.turnOrder[1];
    const a = T.hand(first, 'Captivating Crossroads');
    T.playLand(first, a);
    t.ok(a.tapped, 'the starting player, turn one: tapped');
    T.nextTurn(other);
    const b = T.hand(other, 'Captivating Crossroads');
    T.playLand(other, b);
    t.no(b.tapped, 'the other player: untapped');
    T.g.player(first).turnsTaken = 5;
    T.nextTurn(first);
    const c = T.hand(first, 'Captivating Crossroads');
    T.playLand(first, c);
    t.no(c.tapped, 'the starting player, later on: untapped');
  });

  test('Enters tapped: Eddymurk Crab enters tapped on another player’s turn', (mk, t) => {
    t.auto('Eddymurk Crab');
    const T = mk();
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Llanowar Elves');
    const mine = T.bf('A', 'Eddymurk Crab', { etb: true });
    t.no(mine.tapped, 'on its controller’s turn: untapped');
    const theirs = T.bf('B', 'Eddymurk Crab', { etb: true });
    t.ok(theirs.tapped, 'on another player’s turn: tapped');
  });

  test('Enters tapped: Temple of the Dragon Queen — a Dragon shown or controlled', (mk, t) => {
    t.auto('Temple of the Dragon Queen');
    t.ok(tappedWith(mk, t, 'Temple of the Dragon Queen', []), 'no Dragon: tapped');
    t.no(tappedWith(mk, t, 'Temple of the Dragon Queen', [], T => T.hand('A', 'Shivan Dragon')), 'a Dragon in hand: untapped');
    t.no(tappedWith(mk, t, 'Temple of the Dragon Queen', ['Shivan Dragon']), 'a Dragon controlled: untapped');
  });

  test('Enters tapped: Fetching Garden only when played from the hand', (mk, t) => {
    t.auto('Fetching Garden');
    t.ok(tappedWith(mk, t, 'Fetching Garden', []), 'played from the hand: tapped');
    const T = mk();
    const o = T.bf('A', 'Fetching Garden', { etb: true });
    t.no(o.tapped, 'put onto the battlefield: untapped');
  });
};
