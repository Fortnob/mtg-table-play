/* Cards that do their work in the draft (Conspiracy, Conspiracy: Take the
   Crown): what they do at the draft table, and what what they noted does
   in the game afterwards. The drafts here are built by hand, a few known
   cards to a pack, so every pick can be checked. */
'use strict';
const { card, engine } = require('../harness');

let seq = 0;
/** A card as it comes out of a pack: its own id, so two of a name are two cards. */
const C = (name) => Object.assign({}, card(name), { id: 'd' + (++seq) + ':' + name });
const idOf = (list, name) => (list.find(c => c.name === name) || {}).id;

/**
 * A draft of hand-made packs. `rounds` is a list of rounds, each a list of
 * packs (one per seat), each a list of card names. Seats are people unless
 * named in `bots`, so the test makes every pick.
 */
function draft(rounds, opts) {
  opts = opts || {};
  const M = engine();
  const ids = opts.seats || ['me', 'you'];
  const d = new M.draft.Draft({ seats: ids.length, packs: rounds.length, packSize: rounds[0][0].length, seed: opts.seed || 5, picksPerTurn: opts.picks || 1 });
  for (const id of ids) d.addSeat({ id, name: id, isBot: (opts.bots || []).includes(id) });
  d.roundPacks = rounds.map(r => r.map(p => p.map(C)));
  d.spareCards = (opts.spare || ['Grizzly Bears', 'Hill Giant', 'Shock', 'Llanowar Elves', 'Serra Angel']).map(C);
  for (const [id, names] of Object.entries(opts.pools || {})) {
    const s = d.seats.find(x => x.id === id);
    for (const n of names) { const c = C(n); s.pool.push(c); s.draftedNames.push(c.name); }
  }
  d.start();
  return d;
}
const seat = (d, id) => d.seats.find(s => s.id === id);
const pack = (d, id) => d.packs[seat(d, id).index];
const take = (d, id, name, opts) => {
  const p = pack(d, id);
  const names = [].concat(name);
  const ids = names.map(n => idOf(p, n));
  return d.pick(id, ids, opts);
};
const ability = (d, id, name) => (d.availableAbilities(id).find(a => a.name === name) || {}).cardId;
const poolNames = (d, id) => seat(d, id).pool.map(c => c.name);

/** Where an activated ability is in the list activateAbility counts from. */
const actIndex = (o, pred) => { const a = o.analysis(); return a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty')).findIndex(pred); };

/** A card a player brings to the game from the draft: a conspiracy, or a card exiled before it. */
function conspire(T, pid, name, extra) {
  T.g._loadDraftExtras(T.player(pid), { conspiracies: [Object.assign({ card: card(name) }, extra || {})] });
  return T.zone(pid, 'command').find(o => o.name === name);
}

module.exports = (test) => {
  /* ================= at the draft table ================= */

  test('Draft: a pick goes into the pool and the pack moves on', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    t.ok(take(d, 'me', 'Shock'), 'me picks');
    t.ok(take(d, 'you', 'Serra Angel'), 'you pick');
    t.eq(poolNames(d, 'me').join(), 'Shock');
    t.ok(pack(d, 'me').some(c => c.name === 'Llanowar Elves'), 'the other pack is passed to me');
    t.eq(pack(d, 'me').length, 2);
  });

  test('Draft: a pick can be switched for another while the others are still picking', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    t.ok(take(d, 'me', 'Shock'), 'me picks Shock');
    t.eq((d.viewFor('me').myPick || []).length, 1, 'the pick made shows as kept, waiting on the other');
    t.ok(take(d, 'me', 'Hill Giant'), 'and switches it for Hill Giant before you have picked');
    t.eq(d.viewFor('me').myPick[0], idOf(pack(d, 'me'), 'Hill Giant'), 'the kept pick is the new one');
    t.ok(!take(d, 'me', 'Nonexistent Card'), 'a pick that will not do is refused');
    t.eq(d.viewFor('me').myPick[0], idOf(pack(d, 'me'), 'Hill Giant'), 'and the pick made before it stands');
    t.ok(take(d, 'you', 'Serra Angel'), 'you pick, and the packs move');
    t.eq(poolNames(d, 'me').join(), 'Hill Giant', 'the switched pick is the one taken');
    t.eq((d.viewFor('me').myPick || []).length, 0, 'with the next pack, nothing is kept yet');
  });

  test('Draft: Cogwork Librarian takes a second card and goes into the pack', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Cogwork Librarian'] } });
    const lib = ability(d, 'me', 'Cogwork Librarian');
    t.ok(lib, 'offered');
    t.no(take(d, 'me', 'Shock', { ability: lib }), 'two cards wanted');
    t.ok(take(d, 'me', ['Shock', 'Grizzly Bears'], { ability: lib }), 'two cards taken');
    take(d, 'you', 'Serra Angel');
    t.eq(poolNames(d, 'me').sort().join(), 'Grizzly Bears,Shock');
    t.ok(pack(d, 'you').some(c => c.name === 'Cogwork Librarian'), 'the Librarian went on with the pack');
  });

  test("Draft: Leovold's Operative takes a second card, then the next pack is passed untouched", (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant', 'Divination'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth', 'Lightning Bolt']]],
      { pools: { me: ["Leovold's Operative"] } });
    const op = ability(d, 'me', "Leovold's Operative");
    t.ok(take(d, 'me', ['Shock', 'Grizzly Bears'], { ability: op }));
    take(d, 'you', 'Serra Angel');
    t.ok(d.abilitiesOf(seat(d, 'me')).find(a => a.name === "Leovold's Operative").faceDown, 'face down');
    t.no(take(d, 'me', 'Llanowar Elves'), 'this pack is passed without a pick');
    take(d, 'you', 'Hill Giant');
    t.eq(seat(d, 'me').pool.length, 3, 'nothing from the skipped pack');
    t.ok(take(d, 'me', 'Divination'), 'the pick after that is normal');
  });

  test('Draft: Agent of Acquisitions takes the whole pack one card at a time, then sits out', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Lurking Automaton', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth', 'Divination']]],
      { pools: { me: ['Agent of Acquisitions'] } });
    const agent = ability(d, 'me', 'Agent of Acquisitions');
    t.ok(d.pick('me', [], { ability: agent }), 'the whole pack');
    take(d, 'you', 'Serra Angel');
    t.eq(seat(d, 'me').pool.length, 5, 'all four cards and the Agent');
    t.eq(seat(d, 'me').gameNotes['lurking automaton'].numbers.join(), '3', 'counted one at a time');
    t.ok(d.viewFor('me').sittingOut, 'sitting out');
    t.no(take(d, 'me', 'Llanowar Elves'), 'no more picks this round');
    take(d, 'you', 'Giant Growth');
    t.eq(seat(d, 'me').pool.length, 5);
  });

  test('Draft: Canal Dredger is passed the last card of every pack', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Canal Dredger'] } });
    take(d, 'me', 'Shock'); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Grizzly Bears');
    t.eq(seat(d, 'me').pool.length, 5, 'Dredger, two picks, and both last cards');
    t.eq(seat(d, 'you').pool.length, 2);
    t.ok(poolNames(d, 'me').includes('Hill Giant') && poolNames(d, 'me').includes('Giant Growth'), 'the last cards');
    t.ok(d.finished, 'and the round is over');
  });

  test('Draft: Lore Seeker adds a booster that is your next pick and is passed on', (mk, t) => {
    const d = draft([[['Lore Seeker', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Lore Seeker'); take(d, 'you', 'Serra Angel');
    t.eq(d.viewFor('me').offers.length, 1, 'asked');
    t.no(take(d, 'you', 'Shock'), 'the table waits for the answer');
    t.ok(d.answerOffer('me', idOf(seat(d, 'me').pool, 'Lore Seeker'), true));
    const fresh = pack(d, 'me');
    t.eq(fresh.length, 3, 'a new pack of the same size');
    t.eq(d.viewFor('me').queued, 1, 'the passed pack waits under it');
    const first = fresh[0].name;
    t.ok(take(d, 'me', first));
    take(d, 'you', 'Shock');
    t.eq(pack(d, 'you').uid, fresh.uid, 'the new pack goes on to the next player');
    // the round runs until the extra pack is drafted out as well
    let guard = 0;
    while (!d.finished && guard++ < 20) {
      for (const id of ['me', 'you']) { const p = pack(d, id); if (p.length && !d.pendingPicks.has(seat(d, id).index)) d.pick(id, [p[0].id]); }
    }
    t.ok(d.finished, 'finished');
    t.eq(seat(d, 'me').pool.length + seat(d, 'you').pool.length, 9, 'six cards and three more');
  });

  test('Draft: Cogwork Grinder removes the card face down and counts it', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Cogwork Grinder'] } });
    const g = ability(d, 'me', 'Cogwork Grinder');
    t.ok(take(d, 'me', 'Grizzly Bears', { mods: [g] }));
    take(d, 'you', 'Serra Angel');
    t.no(poolNames(d, 'me').includes('Grizzly Bears'), 'not in the pool');
    t.eq(d.viewFor('me').removed.map(c => c.name).join(), 'Grizzly Bears');
    t.eq(d.notesFor('me')['cogwork grinder'].removed, 1);
    t.ok(ability(d, 'me', 'Cogwork Grinder'), 'still face up for the next one');
  });

  test('Draft: Animus of Predation notes the keywords of a creature it removes', (mk, t) => {
    const d = draft([[['Serra Angel', 'Shock', 'Hill Giant'], ['Grizzly Bears', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Animus of Predation'] } });
    t.ok(take(d, 'me', 'Serra Angel', { mods: [ability(d, 'me', 'Animus of Predation')] }));
    take(d, 'you', 'Grizzly Bears');
    t.eq(d.notesFor('me')['animus of predation'].keywords.sort().join(), 'flying,vigilance');
    t.ok(d.abilityLog.some(l => /removes Serra Angel/.test(l)), 'face up: the table sees it');
  });

  test('Draft: Noble Banneret notes a creature\'s name once, and only a creature', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Noble Banneret'] } });
    const b = ability(d, 'me', 'Noble Banneret');
    t.no(take(d, 'me', 'Shock', { mods: [b] }), 'not for an instant');
    t.ok(take(d, 'me', 'Grizzly Bears', { mods: [b] }));
    take(d, 'you', 'Serra Angel');
    t.eq(d.notesFor('me')['noble banneret'].names.join(), 'Grizzly Bears');
    t.ok(d.abilitiesOf(seat(d, 'me')).find(a => a.name === 'Noble Banneret').faceDown, 'turned face down');
    t.no(ability(d, 'me', 'Noble Banneret'), 'used up');
  });

  test('Draft: Paliano Vanguard notes creature types; Smuggler Captain notes any name', (mk, t) => {
    const d = draft([[['Elite Vanguard', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]],
      { pools: { me: ['Paliano Vanguard', 'Smuggler Captain'] } });
    take(d, 'me', 'Elite Vanguard', { mods: [ability(d, 'me', 'Paliano Vanguard')] }); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Giant Growth', { mods: [ability(d, 'me', 'Smuggler Captain')] }); take(d, 'you', 'Shock');
    const n = d.notesFor('me');
    t.eq(n['paliano vanguard'].types.join(), 'Human,Soldier');
    t.eq(n['smuggler captain'].names.join(), 'Giant Growth');
  });

  test('Draft: Aether Searcher notes the next card drafted', (mk, t) => {
    const d = draft([[['Aether Searcher', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Aether Searcher'); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Shock');
    t.eq(d.notesFor('me')['aether searcher'].names.join(), 'Llanowar Elves');
  });

  test('Draft: Lurking Automaton and its kin note the pick number in the round', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Garbage Fire', 'Hill Giant'], ['Lurking Automaton', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Grizzly Bears'); take(d, 'you', 'Lurking Automaton');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Garbage Fire');
    t.eq(d.notesFor('you')['lurking automaton'].numbers.join(), '1');
    t.eq(d.notesFor('you')['garbage fire'].numbers.join(), '2');
  });

  test('Draft: Regicide\'s colours are chosen by the right neighbour, the drafter, then the left', (mk, t) => {
    const d = draft([[['Regicide', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth'], ['Divination', 'Grizzly Bears', 'Lightning Bolt']]],
      { seats: ['me', 'b1', 'b2'], bots: ['b1', 'b2'] });
    take(d, 'me', 'Regicide');
    const v = d.viewFor('me');
    t.eq(v.asks.length, 1, 'my turn to choose');
    t.eq(v.asks[0].options.length, 4, 'the right neighbour has chosen one');
    const pick = v.asks[0].options[0];
    t.ok(d.act('me', { act: 'answer', askId: v.asks[0].id, value: pick }));
    const cols = d.notesFor('me').regicide.colors;
    t.eq(cols.length, 3, 'three colours');
    t.ok(cols.includes(pick), 'mine among them');
  });

  test('Draft: Cogwork Tracker notes the player who passed it, and nobody for a pack you opened', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Cogwork Tracker', 'Llanowar Elves', 'Giant Growth']],
      [['Cogwork Tracker', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Grizzly Bears'); take(d, 'you', 'Llanowar Elves');
    take(d, 'me', 'Cogwork Tracker'); take(d, 'you', 'Shock');
    t.eq(d.notesFor('me')['cogwork tracker'].players.join(), 'you');
    take(d, 'me', 'Giant Growth'); take(d, 'you', 'Hill Giant');
    take(d, 'me', 'Cogwork Tracker'); take(d, 'you', 'Serra Angel');
    t.eq(d.notesFor('me')['cogwork tracker'].players.join(), 'you', 'opened it myself: nobody noted');
  });

  test('Draft: Cogwork Spy sees the next card taken from its pack', (mk, t) => {
    const d = draft([[['Cogwork Spy', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Cogwork Spy'); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Hill Giant');
    const seen = d.viewFor('me').seen;
    t.eq(seen.length, 1);
    t.eq(seen[0].cards[0].name, 'Hill Giant');
    t.eq(d.viewFor('you').seen.length, 0, 'only to its drafter');
  });

  test('Draft: Spire Phantasm\'s guess is checked against the next card taken', (mk, t) => {
    const d = draft([[['Spire Phantasm', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Spire Phantasm', { guess: 'Shock' }); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Shock');
    t.eq(d.notesFor('me')['spire phantasm'].right, 1, 'right');
    const d2 = draft([[['Spire Phantasm', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d2, 'me', 'Spire Phantasm', { guess: 'Hill Giant' }); take(d2, 'you', 'Serra Angel');
    take(d2, 'me', 'Llanowar Elves'); take(d2, 'you', 'Shock');
    t.no((d2.notesFor('me')['spire phantasm'] || {}).right, 'wrong');
  });

  test('Draft: Illusionary Informant sees the next card a chosen player drafts', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock', 'Hill Giant'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]], { pools: { me: ['Illusionary Informant'] } });
    t.ok(d.act('me', { act: 'watch', cardId: ability(d, 'me', 'Illusionary Informant'), targetId: 'you' }));
    take(d, 'me', 'Shock'); take(d, 'you', 'Giant Growth');
    t.eq(d.viewFor('me').seen[0].cards[0].name, 'Giant Growth');
    t.no(ability(d, 'me', 'Illusionary Informant'), 'face down');
  });

  test('Draft: Whispergear Sneak looks at an unopened pack', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock'], ['Serra Angel', 'Llanowar Elves']], [['Hill Giant', 'Divination'], ['Giant Growth', 'Lightning Bolt']]],
      { pools: { me: ['Whispergear Sneak'] } });
    const v = d.viewFor('me');
    t.eq(v.peekOptions.length, 2, 'the next round\'s packs');
    t.ok(d.act('me', { act: 'peek', cardId: ability(d, 'me', 'Whispergear Sneak'), which: v.peekOptions[1].id }));
    t.eq(d.viewFor('me').seen[0].cards.map(c => c.name).join(), 'Giant Growth,Lightning Bolt');
    t.no(ability(d, 'me', 'Whispergear Sneak'), 'face down');
  });

  test('Draft: Archdemon of Paliano drafts the next three cards at random, unseen', (mk, t) => {
    const d = draft([[['Archdemon of Paliano', 'Shock', 'Hill Giant', 'Divination', 'Grizzly Bears'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth', 'Lightning Bolt', 'Plains']]]);
    take(d, 'me', 'Archdemon of Paliano'); take(d, 'you', 'Serra Angel');
    for (let k = 0; k < 3; k++) {
      const v = d.viewFor('me');
      t.ok(v.blind && !v.pack.length, 'the pack is hidden');
      t.ok(d.pendingPicks.has(seat(d, 'me').index), 'and taken for me');
      const p = pack(d, 'you');
      d.pick('you', [p[0].id]);
    }
    t.eq(seat(d, 'me').pool.length, 4, 'three at random');
    t.no(d.viewFor('me').blind, 'face down again');
    t.ok(pack(d, 'me').length, 'and the last pick is mine to make');
  });

  test('Draft: Deal Broker trades a card once the draft is over', (mk, t) => {
    const d = draft([[['Grizzly Bears', 'Shock'], ['Serra Angel', 'Hill Giant']]], { pools: { me: ['Deal Broker'] } });
    take(d, 'me', 'Shock'); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Hill Giant'); take(d, 'you', 'Grizzly Bears');
    t.no(d.finished, 'the trade comes first');
    t.eq(d.viewFor('me').broker.stage, 'reveal');
    t.ok(d.act('me', { act: 'brokerReveal', cardId: idOf(seat(d, 'me').pool, 'Hill Giant') }));
    t.ok(d.viewFor('you').broker.needs, 'you may offer');
    t.ok(d.act('you', { act: 'brokerOffer', cardId: idOf(seat(d, 'you').pool, 'Serra Angel') }));
    t.eq(d.viewFor('me').broker.offers.length, 1);
    t.ok(d.act('me', { act: 'brokerAccept', cardId: idOf(seat(d, 'you').pool, 'Serra Angel') }));
    t.ok(d.finished, 'finished');
    t.ok(poolNames(d, 'me').includes('Serra Angel') && poolNames(d, 'you').includes('Hill Giant'), 'traded');
  });

  test('Draft: a table of bots drafts Conspiracy cards to the end', (mk, t) => {
    const names = ['Cogwork Librarian', 'Canal Dredger', 'Lore Seeker', 'Lurking Automaton', 'Regicide', 'Cogwork Spy', 'Spire Phantasm',
      'Archdemon of Paliano', 'Deal Broker', 'Noble Banneret', 'Cogwork Grinder', 'Agent of Acquisitions', 'Grizzly Bears', 'Hill Giant', 'Shock'];
    const d = draft([0, 1, 2].map(() => [0, 1, 2, 3].map(() => names)), { seats: ['a', 'b', 'c', 'e'], bots: ['a', 'b', 'c', 'e'] });
    t.ok(d.finished, 'finished');
    const total = d.seats.reduce((n, s) => n + s.pool.length + s.removed.length, 0);
    t.ok(total >= 180, 'every card went somewhere: ' + total);
  });

  test('Draft: what was noted reaches the game', (mk, t) => {
    const M = engine();
    const d = draft([[['Grizzly Bears', 'Shock', 'Lurking Automaton'], ['Serra Angel', 'Llanowar Elves', 'Giant Growth']]]);
    take(d, 'me', 'Grizzly Bears'); take(d, 'you', 'Serra Angel');
    take(d, 'me', 'Llanowar Elves'); take(d, 'you', 'Shock');
    take(d, 'me', 'Lurking Automaton'); take(d, 'you', 'Giant Growth');
    const g = new M.rules.Game({ formatId: 'booster', startingLife: 20, startingHand: 0, seed: 3 });
    g.addPlayer({ id: 'me', name: 'me' }); g.addPlayer({ id: 'you', name: 'you' });
    const deck = { main: [{ card: card('Lurking Automaton'), qty: 1 }, { card: card('Forest'), qty: 10 }], sideboard: [] };
    deck.draftNotes = d.notesFor('me', deck);
    g.loadDeck('me', deck);
    g.loadDeck('you', { main: [{ card: card('Forest'), qty: 10 }] });
    t.eq(g.player('me').draftNotes['lurking automaton'].numbers.join(), '3', 'the third card of the round');
    const auto = g.zones.me.library.find(o => o.name === 'Lurking Automaton');
    g.zones.me.library.splice(g.zones.me.library.indexOf(auto), 1);
    auto.zone = 'hand'; g.zones.me.hand.push(auto);
    g.moveObject(auto, 'battlefield', { controller: 'me' });
    t.eq(auto.counters['+1/+1'], 3, 'and enters with three counters');
  });

  test('Draft: a conspiracy is not built into a deck, and starts the game in the command zone', (mk, t) => {
    const M = engine();
    const pool = ["Brago's Favor", 'Power Play'].concat(Array(10).fill('Grizzly Bears'), Array(6).fill('Llanowar Elves')).map(C);
    const deck = M.draft.autoBuildLimited(pool, { deckSize: 40, basicCards: { Forest: card('Forest'), Plains: card('Plains') } });
    t.no(deck.main.some(e => /Conspiracy/.test(e.card.type_line)), 'not in the main deck');
    t.no(deck.sideboard.some(e => /Conspiracy/.test(e.card.type_line)), 'nor the sideboard');
    t.eq(deck.conspiracies.length, 2);
    t.eq(deck.conspiracies.find(c => c.card.name === "Brago's Favor").names.join(), 'Grizzly Bears', 'the most copies');
    const g = new M.rules.Game({ formatId: 'booster', startingLife: 20, seed: 4 });
    g.addPlayer({ id: 'A', name: 'A' }); g.addPlayer({ id: 'B', name: 'B' });
    g.loadDeck('A', deck); g.loadDeck('B', { main: [{ card: card('Forest'), qty: 40 }] });
    g.start();
    t.eq(g.zones.A.command.length, 2);
    t.eq(g.turnOrder[0], 'A', 'Power Play: the starting player');
    const seen = g.viewFor('B').players.length ? g.viewFor('B') : null;
    t.ok(seen, 'a view');
  });

  test('Draft: Conspiracy boosters hold exactly one conspiracy', (mk, t) => {
    const M = engine();
    const d = new M.draft.Draft({ seats: 1, seed: 9 });
    const pool = {
      playable: [], common: ['Grizzly Bears', 'Shock', 'Hill Giant', 'Llanowar Elves', 'Giant Growth', 'Divination', 'Lightning Bolt', 'Plains'].map(C),
    };
    const cons = ["Brago's Favor", 'Power Play', 'Double Stroke'].map(C);
    pool.common.push(cons[0]);
    pool.playable = pool.common.concat(cons.slice(1));
    const pack = d._conspiracySlot(pool.common.slice(0, 6).concat([cons[0]]), pool);
    t.eq(pack.filter(c => /Conspiracy/.test(c.type_line)).length, 1);
    t.eq(pack.length, 7, 'the same size');
  });

  test('Draft: only words about the draft make a draft card', (mk, t) => {
    const M = engine();
    t.ok(M.draft.draftAbilityOf(card('Lurking Automaton')).known, 'listed');
    t.no(M.draft.draftAbilityOf(card('Grizzly Bears')));
  });

  test('Draft: Worldknit needs the whole pool in the deck', (mk, t) => {
    const M = engine();
    const pool = ['Grizzly Bears', 'Hill Giant', 'Worldknit'].map(C);
    const deck = { main: [{ card: pool[0], qty: 1 }, { card: pool[1], qty: 1 }], conspiracies: [{ card: pool[2] }], sideboard: [] };
    t.ok(M.draft.wholePoolUsed(deck, pool));
    deck.main.pop();
    t.no(M.draft.wholePoolUsed(deck, pool));
  });

  /* ================= in the game ================= */

  test('Lurking Automaton enters with the highest number noted', (mk, t) => {
    const T = mk();
    t.auto('Lurking Automaton');
    T.player('A').draftNotes = { 'lurking automaton': { numbers: [3, 7] } };
    const o = T.hand('A', 'Lurking Automaton');
    T.mana('A', '5');
    T.cast('A', o);
    t.zone(o, 'battlefield');
    t.eq(o.counters['+1/+1'], 7);
  });

  test('Pyretic Hunter with nothing noted is a 0/0', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = {};
    const o = T.hand('A', 'Pyretic Hunter');
    T.mana('A', 'R4');
    T.cast('A', o);
    t.zone(o, 'graveyard');
  });

  test('Cogwork Grinder enters with a counter for each card it removed', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'cogwork grinder': { removed: 4 } };
    const o = T.hand('A', 'Cogwork Grinder');
    T.mana('A', '6');
    T.cast('A', o);
    t.eq(o.counters['+1/+1'], 4);
  });

  test('Garbage Fire deals the highest number noted', (mk, t) => {
    const T = mk();
    t.auto('Garbage Fire');
    T.player('A').draftNotes = { 'garbage fire': { numbers: [2, 4] } };
    const angel = T.bf('B', 'Serra Angel');
    const fire = T.hand('A', 'Garbage Fire');
    T.mana('A', 'R2');
    T.cast('A', fire, { targets: [angel] });
    t.zone(angel, 'graveyard');
  });

  test('Custodi Peacekeeper taps only a creature with power up to the number noted', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'custodi peacekeeper': { numbers: [2] } };
    const keeper = T.bf('A', 'Custodi Peacekeeper');
    const bear = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    const ab = keeper.analysis().abilities.find(x => x.kind === 'activated');
    const legal = T.g._legalTargetsFor(ab.effects[0].targets[0], 'A', keeper.id).map(x => x.id);
    t.ok(legal.includes(bear.id), 'power 2');
    t.no(legal.includes(giant.id), 'not power 3');
    T.mana('A', 'W');
    T.activate('A', keeper, actIndex(keeper, x => x === ab), { targets: [bear] });
    t.ok(bear.tapped, 'tapped');
  });

  test('Paliano Vanguard pumps the other creatures of a noted type', (mk, t) => {
    const T = mk();
    t.auto('Paliano Vanguard');
    T.player('A').draftNotes = { 'paliano vanguard': { types: ['Human'] } };
    const v = T.bf('A', 'Paliano Vanguard');
    const elite = T.bf('A', 'Elite Vanguard'), bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(elite), 3, 'a Human');
    t.eq(T.g.powerOf(bear), 2, 'not a Human');
    t.eq(T.g.powerOf(v), 2, 'not itself');
  });

  test('Noble Banneret and its noted creature get +1/+1 and lifelink together', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'noble banneret': { names: ['Grizzly Bears'] } };
    const nb = T.bf('A', 'Noble Banneret');
    t.eq(T.g.powerOf(nb), 3, 'alone');
    const bear = T.bf('A', 'Grizzly Bears');
    t.eq(T.g.powerOf(nb), 4);
    t.eq(T.g.powerOf(bear), 3);
    t.ok(T.g.hasKw(nb, 'lifelink') && T.g.hasKw(bear, 'lifelink'), 'lifelink');
  });

  test('Smuggler Captain finds the card it noted', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'smuggler captain': { names: ['Shock'] } };
    const shock = T.top('A', 'Shock');
    const cap = T.hand('A', 'Smuggler Captain');
    T.mana('A', 'B3');
    T.cast('A', cap);
    t.zone(shock, 'hand');
  });

  test('Aether Searcher casts the noted card from the library for nothing', (mk, t) => {
    const T = mk();
    t.auto('Aether Searcher');
    T.player('A').draftNotes = { 'aether searcher': { names: ['Hill Giant'] } };
    const giant = T.top('A', 'Hill Giant');
    const s = T.hand('A', 'Aether Searcher');
    T.mana('A', '7');
    T.cast('A', s);
    t.zone(giant, 'battlefield');
  });

  test('Animus of Predation has the keywords of the creatures it removed', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'animus of predation': { keywords: ['flying', 'lifelink'] } };
    const a = T.bf('A', 'Animus of Predation');
    t.ok(T.g.hasKw(a, 'flying') && T.g.hasKw(a, 'lifelink'), 'flying and lifelink');
    t.no(T.g.hasKw(a, 'trample'), 'nothing else');
  });

  test('Paliano, the High City makes only the colours chosen as it was drafted', (mk, t) => {
    const T = mk();
    t.auto('Paliano, the High City');
    T.player('A').draftNotes = { 'paliano, the high city': { colors: ['R', 'G'] } };
    T.bf('A', 'Paliano, the High City');
    t.ok(T.g.canPayNow('A', '{R}'), 'red');
    t.no(T.g.canPayNow('A', '{W}'), 'not white');
    const shock = T.hand('A', 'Shock');
    T.cast('A', shock, { targets: ['B'] });
    t.eq(T.life('B'), 18);
  });

  test('Regicide destroys only a creature of a chosen colour', (mk, t) => {
    const T = mk();
    t.auto('Regicide');
    T.player('A').draftNotes = { regicide: { colors: ['G', 'U', 'W'] } };
    const bear = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    const reg = T.hand('A', 'Regicide');
    const spec = reg.analysis().abilities.find(x => x.kind === 'spell').effects[0].targets[0];
    const legal = T.g._legalTargetsFor(spec, 'A').map(x => x.id);
    t.ok(legal.includes(bear.id) && !legal.includes(giant.id), 'green, not red');
    T.mana('A', 'B');
    T.cast('A', reg, { targets: [bear] });
    t.zone(bear, 'graveyard');
  });

  test('Spire Phantasm draws a card only if its guess was right', (mk, t) => {
    const T = mk();
    T.player('A').draftNotes = { 'spire phantasm': { right: 1 } };
    T.top('A', 'Island');
    const s = T.hand('A', 'Spire Phantasm');
    const before = T.zone('A', 'hand').length;
    T.mana('A', 'UU2');
    T.cast('A', s);
    t.eq(T.zone('A', 'hand').length, before, 'cast one, drew one');
    T.player('A').draftNotes = {};
    const s2 = T.hand('A', 'Spire Phantasm');
    const before2 = T.zone('A', 'hand').length;
    T.mana('A', 'UU2');
    T.cast('A', s2);
    t.eq(T.zone('A', 'hand').length, before2 - 1, 'no card');
  });

  test('Cogwork Tracker must attack the player it noted', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    T.player('A').draftNotes = { 'cogwork tracker': { players: ['C'] } };
    const tr = T.put('A', 'Cogwork Tracker', 'battlefield', { etb: true });
    t.eq(tr.mustAttackPlayer, 'C');
  });

  test("Brago's Favor makes the named spell cheaper, and is shown when it is cast", (mk, t) => {
    const T = mk();
    t.auto("Brago's Favor");
    const cz = conspire(T, 'A', "Brago's Favor", { names: ['Hill Giant'] });
    const giant = T.hand('A', 'Hill Giant'), bear = T.hand('A', 'Grizzly Bears');
    t.eq(T.g.castCost(giant), '{2}{R}');
    t.eq(T.g.castCost(bear), '{1}{G}');
    t.ok(T.g.viewFor('B').players.length >= 0 && T.g.viewFor('B').players.find(p => p.id === 'A'), 'a view');
    t.ok(cz.conspiracy.hidden, 'face down');
    T.mana('A', 'R2');
    T.cast('A', giant);
    t.zone(giant, 'battlefield');
    t.no(cz.conspiracy.hidden, 'turned face up');
  });

  test('A hidden agenda is a face-down card to everybody else', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Immediate Action', { names: ['Grizzly Bears'] });
    const pa = T.g.viewFor('B').players.find(p => p.id === 'A');
    const mine = T.g.viewFor('A').players.find(p => p.id === 'A');
    const theirs = (pa.command || [])[0], own = (mine.command || [])[0];
    t.ok(theirs && theirs.card.name !== 'Immediate Action', 'hidden from B');
    t.eq(theirs.note, '', 'and its name with it');
    t.eq(own.card.name, 'Immediate Action', 'seen by its owner');
    t.ok(/Grizzly Bears/.test(own.note), 'with its name');
  });

  test('Immediate Action, Muzzio\'s Preparations: creatures with the chosen name', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Immediate Action', { names: ['Grizzly Bears'] });
    conspire(T, 'A', "Muzzio's Preparations", { names: ['Grizzly Bears'] });
    const bear = T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    const giant = T.put('A', 'Hill Giant', 'battlefield', { etb: true });
    t.ok(T.g.hasKw(bear, 'haste'), 'haste');
    t.no(T.g.hasKw(giant, 'haste'), 'not another name');
    t.eq(bear.counters['+1/+1'], 1, 'a counter');
    t.no(giant.counters['+1/+1'], 'not another name');
  });

  test('Double Stroke and Iterative Analysis: instants with the chosen name', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Double Stroke', { names: ['Shock'] });
    conspire(T, 'A', 'Iterative Analysis', { names: ['Shock'] });
    const handBefore = T.zone('A', 'hand').length;
    const shock = T.hand('A', 'Shock');
    T.mana('A', 'R');
    T.cast('A', shock, { targets: ['B'] });
    t.eq(T.life('B'), 16, 'copied');
    t.eq(T.zone('A', 'hand').length, handBefore + 1, 'and a card drawn');
  });

  test('Secret Summoning finds every card with the name', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Secret Summoning', { names: ['Grizzly Bears'] });
    const b1 = T.top('A', 'Grizzly Bears'), b2 = T.top('A', 'Grizzly Bears');
    T.put('A', 'Grizzly Bears', 'battlefield', { etb: true });
    T.resolve();
    t.zone(b1, 'hand'); t.zone(b2, 'hand');
  });

  test('Secrets of Paradise, Incendiary Dissent: abilities for the chosen name', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Secrets of Paradise', { names: ['Grizzly Bears'] });
    conspire(T, 'A', 'Incendiary Dissent', { names: ['Grizzly Bears'] });
    const bear = T.bf('A', 'Grizzly Bears');
    const giant = T.bf('A', 'Hill Giant');
    t.ok(T.g.manaAbilitiesOf(bear).length > 0, 'a mana ability');
    t.eq(T.g.manaAbilitiesOf(giant).length, 0, 'not another name');
    const pump = actIndex(bear, x => x.kind === 'activated' && /\+1\/\+0/.test(x.text || ''));
    t.ok(pump >= 0, 'firebreathing');
    T.mana('A', 'R');
    T.activate('A', bear, pump);
    t.eq(T.g.powerOf(bear), 3);
  });

  test('Unexpected Potential and Emissary\'s Ploy: mana of any colour', (mk, t) => {
    const T = mk();
    const angel = T.hand('A', 'Serra Angel');
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'RRRRR');
    t.no(T.g.canPayNow('A', '{3}{W}{W}', { forSpell: angel, fromPool: true }), 'not without it');
    conspire(T, 'A', 'Unexpected Potential', { names: ['Serra Angel'] });
    t.ok(T.g.canPayNow('A', '{3}{W}{W}', { forSpell: angel, fromPool: true }), 'the named spell');
    t.no(T.g.canPayNow('A', '{1}{G}', { forSpell: bear, fromPool: true }), 'not another');
    conspire(T, 'A', "Emissary's Ploy", { number: 2 });
    t.ok(T.g.canPayNow('A', '{1}{G}', { forSpell: bear, fromPool: true }), 'a creature of the chosen mana value');
  });

  test('Worldknit gives lands any colour only with the whole pool in the deck', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Worldknit');
    const f = T.bf('A', 'Forest');
    T.player('A').draftNotes = { worldknit: { whole: false } };
    T.g.bumpBoard();
    t.eq(T.g.manaAbilitiesOf(f).length, 1, 'only green');
    T.player('A').draftNotes = { worldknit: { whole: true } };
    T.g.bumpBoard();
    t.eq(T.g.manaAbilitiesOf(f).length, 2, 'any colour too');
  });

  test("Adriana's Valor and Hired Heist: attacks by the chosen name", (mk, t) => {
    const T = mk();
    conspire(T, 'A', "Adriana's Valor", { names: ['Grizzly Bears'] });
    conspire(T, 'A', 'Hired Heist', { names: ['Grizzly Bears'] });
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Plains'); T.bf('A', 'Island');
    const hand = T.zone('A', 'hand').length;
    T.answer('declareAttackers', () => [{ attackerId: bear.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.ok(T.g.hasKw(bear, 'indestructible'), 'indestructible');
    t.eq(T.life('B'), 18);
    t.eq(T.zone('A', 'hand').length, hand + 1, 'drew a card');
  });

  test('Assemble the Rank and Vile: the chosen name leaves a Zombie', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Assemble the Rank and Vile', { names: ['Grizzly Bears'] });
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'B');
    const bolt = T.hand('B', 'Lightning Bolt');
    T.mana('B', 'R');
    T.g.priorityIndex = T.g.turnOrder.indexOf('B');
    T.cast('B', bolt, { targets: [bear] });
    t.zone(bear, 'graveyard');
    const z = T.bfOf('A').find(o => o.name === 'Zombie');
    t.ok(z && z.tapped, 'a tapped Zombie');
  });

  test('Echoing Boon copies a spell aimed at the chosen name', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Echoing Boon', { names: ['Grizzly Bears'] });
    const bear = T.bf('A', 'Grizzly Bears');
    const gg = T.hand('A', 'Giant Growth');
    T.mana('A', 'G');
    T.cast('A', gg, { targets: [bear] });
    t.eq(T.g.powerOf(bear), 8, 'twice');
  });

  test("Summoner's Bond fetches the other named creature", (mk, t) => {
    const T = mk();
    conspire(T, 'A', "Summoner's Bond", { names: ['Grizzly Bears', 'Hill Giant'] });
    const giant = T.top('A', 'Hill Giant');
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'G1');
    T.cast('A', bear);
    t.zone(giant, 'hand');
  });

  test('Weight Advantage: combat damage by toughness', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Weight Advantage');
    const turtle = T.bf('A', 'Horned Turtle');
    T.answer('declareAttackers', () => [{ attackerId: turtle.id, defenderId: 'B' }]);
    T.toMain('A', 'endCombat');
    t.eq(T.life('B'), 16);
  });

  test('Hymn of the Wilds: no instants, and the first creature each turn is cheaper', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Hymn of the Wilds');
    const shock = T.hand('A', 'Shock');
    t.no(T.g.canCast('A', shock.id).ok, 'no instants');
    const g1 = T.hand('A', 'Hill Giant');
    t.eq(T.g.castCost(g1), '{2}{R}');
    T.mana('A', 'R2');
    T.cast('A', g1);
    const g2 = T.hand('A', 'Hill Giant');
    t.eq(T.g.castCost(g2), '{3}{R}', 'the second is not');
  });

  test('Natural Unity: pay {G} at the beginning of combat for a counter', (mk, t) => {
    const T = mk();
    conspire(T, 'A', 'Natural Unity', { names: ['Grizzly Bears'] });
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Forest');
    T.toMain('A', 'endCombat');
    t.eq(bear.counters['+1/+1'], 1);
  });

  test('Arcane Savant casts a copy of the card it exiled before the game', (mk, t) => {
    const T = mk();
    T.g._loadDraftExtras(T.player('A'), { draftExiled: [{ card: card('Divination'), with: 'arcane savant' }] });
    const ex = T.zone('A', 'exile')[0];
    const hand = T.zone('A', 'hand').length;
    const s = T.hand('A', 'Arcane Savant');
    T.mana('A', 'UU3');
    T.cast('A', s);
    t.eq(T.zone('A', 'hand').length, hand + 2, 'drew two');
    t.zone(ex, 'exile');
    t.eq(T.zone('A', 'exile').length, 1, 'the copy is gone');
  });

  test('Caller of the Untamed makes a token copy of a card it exiled', (mk, t) => {
    const T = mk();
    T.g._loadDraftExtras(T.player('A'), { draftExiled: [{ card: card('Hill Giant'), with: 'caller of the untamed' }] });
    const caller = T.bf('A', 'Caller of the Untamed');
    const i = actIndex(caller, x => x.kind === 'activated');
    T.mana('A', '4');
    T.activate('A', caller, i, { x: 4 });
    t.ok(T.bfOf('A').some(o => o.isToken && o.name === 'Hill Giant'), 'a Hill Giant token');
  });

  test('Volatile Chimera becomes one of the cards it exiled, and keeps the ability', (mk, t) => {
    const T = mk();
    T.g._loadDraftExtras(T.player('A'), { draftExiled: ['Serra Angel', 'Hill Giant', 'Grizzly Bears'].map(n => ({ card: card(n), with: 'volatile chimera' })) });
    const ch = T.bf('A', 'Volatile Chimera');
    const i = actIndex(ch, x => x.kind === 'activated');
    T.mana('A', 'R1');
    T.activate('A', ch, i);
    t.ok(['Serra Angel', 'Hill Giant', 'Grizzly Bears'].includes(ch.name), 'a copy: ' + ch.name);
    t.ok(ch.analysis().abilities.some(x => (x.effects || []).some(e => e.op === 'becomeExiledCopy')), 'still has the ability');
  });

  /* ----- the start of the game ----- */
  function gameWith(conspiracies, opts) {
    const M = engine();
    const g = new M.rules.Game({ formatId: 'booster', startingLife: 20, startingHand: 7, seed: (opts && opts.seed) || 11 });
    g.addPlayer({ id: 'A', name: 'A', isBot: !!(opts && opts.bot) }); g.addPlayer({ id: 'B', name: 'B', isBot: true });
    const lib = [{ card: card('Forest'), qty: 20 }, { card: card('Grizzly Bears'), qty: 20 }];
    g.loadDeck('A', { main: lib, conspiracies: conspiracies.map(n => ({ card: card(n) })) });
    g.loadDeck('B', { main: lib });
    g.start();
    return g;
  }

  test('Power Play makes its owner the starting player', (mk, t) => {
    for (let seed = 1; seed < 6; seed++) t.eq(gameWith(['Power Play'], { seed }).turnOrder[0], 'A', 'seed ' + seed);
  });

  test("Sovereign's Realm: a starting hand of five", (mk, t) => {
    const g = gameWith(["Sovereign's Realm"]);
    t.eq(g.zones.A.hand.length, 5);
    t.eq(g.zones.B.hand.length, 7);
  });

  test('Backup Plan: two hands, one kept, before any mulligan', (mk, t) => {
    const g = gameWith(['Backup Plan']);
    t.no(g.mulliganPhase, 'the hands come first');
    t.eq((g.pendingChoice || {}).purpose, 'backupPlan');
    const second = g.player('A').backupHands[1].slice();
    t.ok(g.resolveChoice('A', { picks: [1] }));
    t.eq(g.zones.A.hand.map(o => o.id).sort().join(), second.sort().join(), 'the second hand');
    t.eq(g.zones.A.library.length, 33, 'the other shuffled back');
    t.ok(g.mulliganPhase, 'then mulligans');
    const bot = gameWith(['Backup Plan'], { bot: true });
    t.ok(bot.mulliganPhase && bot.zones.A.hand.length === 7, 'a bot chooses at once');
  });

  test('Backup Plan, a hidden agenda and the notes survive a save and restore', (mk, t) => {
    const M = engine();
    const g = new M.rules.Game({ formatId: 'booster', startingLife: 20, startingHand: 7, seed: 12 });
    g.addPlayer({ id: 'A', name: 'A' }); g.addPlayer({ id: 'B', name: 'B', isBot: true });
    const lib = [{ card: card('Forest'), qty: 20 }, { card: card('Grizzly Bears'), qty: 20 }];
    g.loadDeck('A', { main: lib, conspiracies: [{ card: card('Backup Plan') }, { card: card('Immediate Action'), names: ['Grizzly Bears'] }],
      draftNotes: { 'lurking automaton': { numbers: [4] } } });
    g.loadDeck('B', { main: lib });
    g.start();
    const second = g.player('A').backupHands[1].slice().sort();
    const g2 = new M.rules.Game({ formatId: 'booster' });
    t.ok(g2.restore(JSON.parse(JSON.stringify(g.snapshot()))), 'restored');
    t.eq(g2.zones.A.hand.length + g2.zones.A.library.length, 40, 'every card in a zone');
    t.ok(g2.resolveChoice('A', { picks: [1] }), 'answered after the restore');
    t.eq(g2.zones.A.hand.map(o => o.id).sort().join(), second.join(), 'the second hand');
    t.ok(g2.mulliganPhase, 'and on to the mulligans');
    const agenda = g2.zones.A.command.find(o => o.name === 'Immediate Action');
    t.ok(agenda && agenda.conspiracy.hidden && agenda.conspiracy.names[0] === 'Grizzly Bears', 'the agenda and its name');
    t.eq(g2.player('A').draftNotes['lurking automaton'].numbers[0], 4, 'the notes');
  });

  test('Sentinel Dispatch and Hold the Perimeter: tokens at the first upkeeps', (mk, t) => {
    const g = gameWith(['Sentinel Dispatch', 'Hold the Perimeter'], { bot: true });
    const { Table } = require('../harness');
    const T = Object.create(Table.prototype);
    T.g = g; T.answers = []; T.asked = []; T.MTG = engine();
    for (const p of g.players) if (!p.keptHand) g.keepHand(p.id, []);
    const first = g.turnOrder[0], second = g.turnOrder[1];
    T.toMain(first);
    T.nextTurn(second);
    T.nextTurn(first);
    const mine = g.battlefield.filter(o => o.controller === 'A' && o.isToken).map(o => o.name).sort();
    const theirs = g.battlefield.filter(o => o.controller === 'B' && o.isToken).map(o => o.name).sort();
    t.eq(mine.join(), 'Construct,Soldier', 'one Construct and one Soldier');
    t.eq(theirs.join(), 'Goblin', 'one Goblin');
  });
};
