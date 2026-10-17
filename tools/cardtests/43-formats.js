/* Pioneer, Legacy, Vintage, Brawl and Oathbreaker: what a deck has to be
   (src/04-formats.js), how a pasted list is seated (src/05-decklist.js),
   and the Oathbreaker rules the engine keeps (src/06-rules.js): a
   Signature Spell cast only while its Oathbreaker is out, back to the
   command zone every time, with a commander tax of its own. */
'use strict';
const { card, engine } = require('../harness');

module.exports = (test) => {
  const F = () => engine().formats;
  const deckOf = (format, commanders, main) => ({
    format, commanders: commanders.map(card), sideboard: [],
    main: main.map(([n, q]) => ({ card: card(n), qty: q })),
  });
  const has = (list, re) => list.some(x => re.test(x));

  /* ---------------- the formats ---------------- */

  test('Formats: the new ones sit beside their kin', (mk, t) => {
    const order = F().FORMAT_ORDER;
    t.eq(order.slice(0, 3).join(), 'commander,brawl,oathbreaker', 'Brawl and Oathbreaker beside Commander');
    t.ok(order.indexOf('pioneer') > order.indexOf('standard') && order.indexOf('vintage') > order.indexOf('legacy'), 'the sixty-card ones in order');
    for (const id of ['pioneer', 'legacy', 'vintage', 'brawl', 'oathbreaker']) {
      t.eq(F().get(id).scryKey, id, id + ' reads its own legality');
      t.eq(F().get(id).kind, 'constructed');
    }
  });

  test('Formats: Pioneer goes by its own card pool', (mk, t) => {
    const ok = F().validate(deckOf('pioneer', [], [['Lightning Strike', 4], ['Mountain', 56]]), 'pioneer');
    t.ok(ok.ok, 'Lightning Strike is fine: ' + ok.errors.join(' / '));
    const bad = F().validate(deckOf('pioneer', [], [['Lightning Bolt', 4], ['Mountain', 56]]), 'pioneer');
    t.ok(has(bad.errors, /Lightning Bolt is not legal in Pioneer/), 'Lightning Bolt is not: ' + bad.errors.join(' / '));
  });

  test('Formats: Vintage restricts, Legacy bans', (mk, t) => {
    const two = F().validate(deckOf('vintage', [], [['Brainstorm', 2], ['Island', 58]]), 'vintage');
    t.ok(has(two.errors, /Brainstorm is restricted in Vintage/), 'two of a restricted card: ' + two.errors.join(' / '));
    const one = F().validate(deckOf('vintage', [], [['Brainstorm', 1], ['Island', 59]]), 'vintage');
    t.ok(one.ok, 'one is fine: ' + one.errors.join(' / '));
    t.eq(F().copyLimit(card('Brainstorm'), F().get('vintage')), 1, 'one copy of a restricted card');
    t.eq(F().copyLimit(card('Brainstorm'), F().get('legacy')), 4, 'four in Legacy');
    t.eq(F().copyLimit(card('Island'), F().get('vintage')), Infinity, 'basics are never limited');
    const lotus = F().validate(deckOf('legacy', [], [['Black Lotus', 1], ['Island', 59]]), 'legacy');
    t.ok(has(lotus.errors, /Black Lotus is banned in Legacy/), 'Black Lotus is banned in Legacy');
    t.ok(F().validate(deckOf('vintage', [], [['Black Lotus', 1], ['Island', 59]]), 'vintage').ok, 'and allowed once in Vintage');
  });

  test('Formats: Brawl takes a legendary creature or a planeswalker, sixty cards, 25 life', (mk, t) => {
    const walker = F().validate(deckOf('brawl', ['Teferi, Hero of Dominaria'], [['Island', 30], ['Plains', 29]]), 'brawl');
    t.ok(walker.ok, 'a planeswalker leads: ' + walker.errors.join(' / '));
    const legend = F().validate(deckOf('brawl', ['Krenko, Mob Boss'], [['Mountain', 59]]), 'brawl');
    t.ok(legend.ok, 'and a legendary creature: ' + legend.errors.join(' / '));
    const bears = F().validate(deckOf('brawl', ['Grizzly Bears'], [['Forest', 59]]), 'brawl');
    t.ok(has(bears.errors, /can't be a commander \(needs to be a legendary creature or a planeswalker\)/), 'not a bear: ' + bears.errors.join(' / '));
    const big = F().validate(deckOf('brawl', ['Krenko, Mob Boss'], [['Mountain', 99]]), 'brawl');
    t.ok(has(big.errors, /exactly 60 cards/), 'sixty cards, not a hundred');
    const off = F().validate(deckOf('brawl', ['Krenko, Mob Boss'], [['Mountain', 58], ['Opt', 1]]), 'brawl');
    t.ok(has(off.errors, /Opt is outside your commander's color identity/), 'colour identity holds');
    t.ok(F().canBeCommander(card('Teferi, Hero of Dominaria'), F().get('brawl')), 'Teferi can lead in Brawl');
    t.no(F().canBeCommander(card('Teferi, Hero of Dominaria'), F().get('commander')), 'but not in Commander');
    const brawl = F().get('brawl');
    t.eq(brawl.startingLife, 25);
    t.eq(brawl.commanderDamage, null, 'no commander damage');
    t.eq(F().lifeFor(brawl, 2), 25, '25 between two');
    t.eq(F().lifeFor(brawl, 4), 30, '30 at a bigger table');
    t.eq(F().lifeFor(F().effective('brawl', { startingLife: 40 }), 4), 40, 'a house number stands');
    t.no(F().houseFields('brawl').some(f => f.key === 'bracket'), 'the Commander brackets are not offered');
    t.ok(F().houseFields('commander').some(f => f.key === 'bracket'), 'but still are for Commander');
  });

  test('Formats: Oathbreaker wants a planeswalker and a Signature Spell in its colours', (mk, t) => {
    const ok = F().validate(deckOf('oathbreaker', ['Chandra, Torch of Defiance', 'Lightning Bolt'], [['Mountain', 58]]), 'oathbreaker');
    t.ok(ok.ok, 'a legal deck: ' + ok.errors.join(' / '));
    t.eq(ok.size, 60, 'both count towards the sixty');
    t.eq((ok.colorIdentity || []).join(), 'R', 'the Oathbreaker sets the colours');
    const none = F().validate(deckOf('oathbreaker', ['Chandra, Torch of Defiance'], [['Mountain', 59]]), 'oathbreaker');
    t.ok(has(none.errors, /Choose a Signature Spell/), 'no spell: ' + none.errors.join(' / '));
    const blue = F().validate(deckOf('oathbreaker', ['Chandra, Torch of Defiance', 'Counterspell'], [['Mountain', 58]]), 'oathbreaker');
    t.ok(has(blue.errors, /Counterspell is outside your Oathbreaker's colour identity/), 'a spell outside its colours: ' + blue.errors.join(' / '));
    const legend = F().validate(deckOf('oathbreaker', ['Krenko, Mob Boss', 'Lightning Bolt'], [['Mountain', 58]]), 'oathbreaker');
    t.ok(has(legend.errors, /Krenko, Mob Boss can't be your Oathbreaker/), 'a legendary creature will not do: ' + legend.errors.join(' / '));
    const twice = F().validate(deckOf('oathbreaker', ['Chandra, Torch of Defiance', 'Lightning Bolt'], [['Lightning Bolt', 1], ['Mountain', 57]]), 'oathbreaker');
    t.ok(has(twice.errors, /Lightning Bolt: 2 copies/), 'the Signature Spell counts for singleton: ' + twice.errors.join(' / '));
    t.ok(F().isSignatureSpell(card('Lightning Bolt')), 'an instant is a Signature Spell');
    t.no(F().isSignatureSpell(card('Chandra, Torch of Defiance')), 'a planeswalker is not');
  });

  /* ---------------- importing a list ---------------- */

  const seat = (text, formatId) => {
    const M = engine();
    const fmt = F().get(formatId);
    const parsed = M.decklist.parse(text, { assumeCommander: true, deckSize: fmt.deckMin });
    const r = (list) => list.map(e => ({ card: card(e.name), qty: e.qty }));
    const resolved = { main: r(parsed.main), sideboard: r(parsed.sideboard), commanders: r(parsed.commanders), warnings: [] };
    M.decklist.seatCommanders(parsed, resolved, fmt);
    return {
      resolved,
      deck: { format: formatId, main: resolved.main, sideboard: [], commanders: resolved.commanders.map(e => e.card) },
    };
  };

  test('Import: an Oathbreaker list with its sections marked', (mk, t) => {
    const { deck } = seat('Signature Spell\n1 Lightning Bolt\n\nOathbreaker\n1 Chandra, Torch of Defiance\n\nDeck\n58 Mountain', 'oathbreaker');
    t.eq(deck.commanders.map(c => c.name).join(' | '), 'Chandra, Torch of Defiance | Lightning Bolt', 'the planeswalker first, its spell after');
    t.ok(F().validate(deck, 'oathbreaker').ok, 'and legal');
  });

  test('Import: an unmarked Oathbreaker list leads with both', (mk, t) => {
    const { deck, resolved } = seat('1 Chandra, Torch of Defiance\n1 Lightning Bolt\n58 Mountain', 'oathbreaker');
    t.eq(deck.commanders.map(c => c.name).join(' | '), 'Chandra, Torch of Defiance | Lightning Bolt');
    t.ok(has(resolved.warnings, /Using Lightning Bolt as your Signature Spell/), 'and says so');
    t.eq(deck.main.length, 1, 'the rest is the deck');
  });

  test('Import: a Brawl list whose first card cannot lead', (mk, t) => {
    const { deck } = seat('1 Shock\n1 Krenko, Mob Boss\n58 Mountain', 'brawl');
    t.eq(deck.commanders.map(c => c.name).join(), 'Krenko, Mob Boss', 'the only legend leads');
    t.ok(deck.main.some(e => e.card.name === 'Shock'), 'Shock stays in the deck');
    t.ok(F().validate(deck, 'brawl').ok);
  });

  test('Import: an Oathbreaker deck goes out and comes back the same', (mk, t) => {
    const M = engine();
    const out = M.decklist.toText(deckOf('oathbreaker', ['Chandra, Torch of Defiance', 'Lightning Bolt'], [['Mountain', 58]]));
    t.ok(/^Oathbreaker\n1 Chandra, Torch of Defiance\n\nSignature Spell\n1 Lightning Bolt\n/.test(out), 'its own sections: ' + JSON.stringify(out.slice(0, 80)));
    const { deck } = seat(out, 'oathbreaker');
    t.eq(deck.commanders.map(c => c.name).join(' | '), 'Chandra, Torch of Defiance | Lightning Bolt');
  });

  /* ---------------- the bots ---------------- */

  test('Bots: a Pact is paid for at the next upkeep', (mk, t) => {
    t.auto("Summoner's Pact");
    const T = mk();
    for (let i = 0; i < 4; i++) T.bf('A', 'Forest');
    T.top('A', 'Grizzly Bears');
    T.cast('A', T.hand('A', "Summoner's Pact"));
    const bot = new T.MTG.bots.BotPlayer(T.g, 'A', 5);
    let asked = 0;
    T.answer('payOrDont', (ch) => { asked++; return { pay: bot.payChoice(ch) }; });
    T.nextTurn('A');
    t.eq(asked, 1, 'asked at the upkeep');
    t.no(T.player('A').hasLost, 'paid, rather than losing the game');
  });

  /* ---------------- playing Oathbreaker ---------------- */

  /** A table where A's command zone holds Chandra and her Signature Spell. */
  const oath = (mk, spell) => {
    const T = mk();
    T.g.loadDeck('A', { main: [{ card: card('Mountain'), qty: 20 }], commanders: [card('Chandra, Torch of Defiance'), card(spell || 'Lightning Bolt')] });
    const [walker, sig] = T.zone('A', 'command');
    return { T, walker, sig };
  };

  test('Oathbreaker: the Signature Spell waits for its Oathbreaker', (mk, t) => {
    const { T, walker, sig } = oath(mk);
    t.ok(walker.isCommander, 'the planeswalker is the commander');
    t.ok(sig.isSignature && !sig.isCommander, 'the spell is not');
    T.mana('A', 'R');
    t.no(T.g.canCast('A', sig.id).ok, 'not while Chandra is in the command zone');
    T.mana('A', 'RR2');
    T.cast('A', walker);
    t.zone(walker, 'battlefield');
    t.ok(T.g.canCast('A', sig.id).ok, 'now it can be cast: ' + (T.g.canCast('A', sig.id).reason || ''));
    T.cast('A', sig, { targets: ['B'] });
    t.eq(T.life('B'), 17, 'Lightning Bolt did its work');
    t.zone(sig, 'command', 'and went back to the command zone');
    t.eq(T.player('A').commanderCasts[sig.id], 1, 'cast once from there');
    t.eq(engine().mana.cmc(T.g.castCost(sig)), 3, 'so it costs {2} more now');
    t.eq(T.g._commanderCastCount('A'), 1, 'only Chandra counts as a commander cast');
  });

  test('Oathbreaker: a countered Signature Spell goes home too', (mk, t) => {
    const { T, walker, sig } = oath(mk);
    T.mana('A', 'RR2');
    T.cast('A', walker);
    T.mana('A', 'R');
    T.cast('A', sig, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [T.stackTarget(sig)] });
    t.eq(T.life('B'), 20, 'countered');
    t.zone(sig, 'command', 'back in the command zone, not the graveyard');
    t.eq(T.zone('A', 'graveyard').length, 0, 'nothing in the graveyard');
  });

  test('Oathbreaker: returned to a hand, it goes to the command zone instead', (mk, t) => {
    const { T, walker, sig } = oath(mk);
    T.mana('A', 'RR2');
    T.cast('A', walker);
    T.mana('A', 'R');
    T.cast('A', sig, { targets: ['B'], resolve: false });
    T.g.passPriority('A', true);
    T.mana('B', 'UU1');
    T.cast('B', T.hand('B', 'Remand'), { targets: [T.stackTarget(sig)] });
    t.zone(sig, 'command');
    t.no(T.zone('A', 'hand').includes(sig), 'not in the hand');
  });

  test('Oathbreaker: with the Oathbreaker gone again, the spell waits', (mk, t) => {
    const { T, walker, sig } = oath(mk);
    T.mana('A', 'RR2');
    T.cast('A', walker);
    T.g.moveObject(walker, 'graveyard');
    T.g.checkStateBasedActions();
    T.settle();
    t.zone(walker, 'command', 'the Oathbreaker goes home as a commander does');
    T.mana('A', 'R');
    t.no(T.g.canCast('A', sig.id).ok, 'and the spell cannot be cast without it');
    const snap = T.g.snapshot();
    t.ok(snap.objs.find(o => o.id === sig.id).isSignature, 'a saved game remembers which is the Signature Spell');
    t.ok(T.g.viewFor('A').players.find(p => p.id === 'A').command.find(o => o.id === sig.id).isSignature, 'and the table is told');
  });
};
