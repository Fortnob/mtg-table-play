#!/usr/bin/env node
/* The deck tools, checked without a browser:

   - deck links (src/05a-decklink.js): a deck goes into a link and comes
     back out the same, links stay short, a link made by version 1 of
     the packing still opens (a fixed one is kept below, and must never
     change), and a link cut short or tampered with is turned away;
   - sample hands and their odds (src/16a-playtest.js): the land chances
     add up and match the known figures, mulligans put the right number
     of cards on the bottom, and no card goes missing or doubles;
   - the practice game: a real game against the Goldfish, which keeps
     its hand, never casts, attacks or blocks, runs out of cards without
     losing, and is killed on a turn the tally can name;
   - rulings (src/10g-rulings.js): asked for once and kept, oldest first,
     dated the British way, and nothing asked for a card that has none.

   node tools/decktoolstest.js            A failure exits non-zero.
   Run by tools/check.py ('decktools'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { card, engine } = require('./harness');

// (quietly: Node has no IndexedDB, and the card cache saying so is not news)
const warn = console.warn;
console.warn = () => {};
const MTG = engine();
console.warn = warn;
for (const m of ['05a-decklink.js', '16a-playtest.js', '10g-rulings.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', m), 'utf8'), { filename: m });
}

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

/* ================= deck links ================= */
const L = MTG.decklink;
const deckOf = (format, name, main, extra) => Object.assign({
  id: 'd1', name, format,
  main: main.map(([qty, n]) => ({ qty, card: card(n) })),
  sideboard: [], commanders: [], companion: null,
}, extra || {});

/** A deck as a plain list, to compare two decks by what is in them. */
const summary = (d) => {
  const line = (e) => `${e.qty}x ${e.set ? e.set + '#' + e.cn : e.name}`;
  const bits = (list) => list.map(line).sort().join(', ');
  return [d.format, d.name, bits(d.commanders), bits(d.companion), bits(d.main), bits(d.sideboard)].join(' | ');
};
const asData = (deck) => {
  const ent = (c, qty) => (c.set && c.collector_number ? { qty, set: c.set, cn: String(c.collector_number) } : { qty, name: c.name });
  const merge = (list) => {
    const m = new Map();
    for (const e of list) { const k = JSON.stringify(Object.assign({}, e, { qty: 0 })); m.set(k, (m.get(k) || 0) + e.qty); }
    return Array.from(m, ([k, qty]) => Object.assign(JSON.parse(k), { qty }));
  };
  return {
    format: deck.format, name: deck.name,
    commanders: merge((deck.commanders || []).map(c => ent(c, 1))),
    companion: deck.companion ? [ent(deck.companion, 1)] : [],
    main: merge(deck.main.map(e => ent(e.card, e.qty))),
    sideboard: merge((deck.sideboard || []).map(e => ent(e.card, e.qty))),
  };
};

const burn = deckOf('modern', 'Burn — "the fast one" \u{1F525}', [
  [4, 'Lightning Bolt'], [4, 'Lava Spike'], [4, 'Rift Bolt'], [4, 'Monastery Swiftspear'], [4, 'Goblin Guide'],
  [4, 'Eidolon of the Great Revel'], [4, 'Skewer the Critics'], [4, 'Boros Charm'], [4, 'Lightning Helix'],
  [4, 'Inspiring Vantage'], [4, 'Sacred Foundry'], [16, 'Mountain'],
], { sideboard: [[3, 'Path to Exile'], [2, 'Smash to Smithereens']].map(([qty, n]) => ({ qty, card: card(n) })) });
{
  const text = L.encode(burn);
  check(/^1[A-Za-z0-9_-]+$/.test(text), `a link is version 1 and URL-safe: ${text.slice(0, 40)}...`);
  const back = L.decode(text);
  check(summary(back) === summary(asData(burn)), 'a 60-card deck with a sideboard comes back as it went in');
  check(back.size === 65, `it counts 65 cards (${back.size})`);
  // each card here is a printing from a different set, the worst case for the packing
  check(text.length < 260, `a 60-card deck is a short link (${text.length} characters)`);
  const url = L.url(burn, 'https://example.org/play/');
  check(url.startsWith('https://example.org/play/#deck=1'), 'the link is the page with #deck= after it');
  check(L.fromHash('#deck=' + text) === text && L.fromHash('#x=1&deck=' + text) === text && L.fromHash('#other') === null,
    'the deck is read back out of an address');
  // the same card twice (two lines of one printing) goes in as one line of both
  const twice = deckOf('modern', 'x', [[2, 'Lightning Bolt'], [3, 'Lightning Bolt']]);
  check(L.decode(L.encode(twice)).main.length === 1 && L.decode(L.encode(twice)).main[0].qty === 5, 'two lines of one printing come back as one');
}

/* a Commander deck: a hundred different cards from all over */
{
  const names = [];
  const seen = new Set();
  const all = Array.from(require('./harness').cards().values());
  for (const c of all) {
    if (names.length >= 99) break;
    if (seen.has(c.name) || !c.set || !c.collector_number || c.layout === 'token' || !/^(Creature|Instant|Sorcery|Artifact|Enchantment)/.test(c.type_line || '')) continue;
    if ((c.legalities || {}).commander !== 'legal') continue;
    seen.add(c.name);
    names.push(c.name);
  }
  const edh = deckOf('commander', 'Atraxa superfriends', names.map(n => [1, n]), { commanders: [card("Atraxa, Praetors' Voice")] });
  const text = L.encode(edh);
  const back = L.decode(text);
  check(summary(back) === summary(asData(edh)), 'a hundred-card Commander deck comes back as it went in');
  check(text.length < 900, `a hundred-card deck is a few hundred characters (${text.length})`);
  console.log(`  link lengths: 60-card Modern ${L.encode(burn).length}, 100-card Commander ${text.length}`);
}

/* odd collector numbers, and a card with no printing to name */
{
  const odd = {
    format: 'standard', name: '', main: [
      { qty: 1, card: { name: 'Thing A', set: 'sld', collector_number: '1★' } },
      { qty: 7, card: { name: 'Thing B', set: 'plst', collector_number: 'ARB-1' } },
      { qty: 2, card: { name: 'Thing C', set: 'mh3', collector_number: '0' } },
      { qty: 250, card: { name: 'Relentless Rats', set: 'm11', collector_number: '106' } },
      { qty: 3, card: { name: 'A Card Nobody Printed' } },
    ], sideboard: [], commanders: [], companion: null,
  };
  const back = L.decode(L.encode(odd));
  check(summary(back) === summary(asData(odd)), 'collector numbers with letters and stars, number 0, 250 copies and cards known only by name survive');
}

/* version 1 forever: this link was made when the packing was written, and must always open as this deck */
{
  const KEPT = '1Bm1vZGVybgRCdXJuAAAEA2xlYQGGBQIDbTEwAroBAjICA3cxNwEuAgRodG91AToBAEk';
  let back = null;
  try { back = L.decode(KEPT); } catch (e) { console.log('  ' + e.message); }
  check(!!back && back.format === 'modern' && back.name === 'Burn', 'a version-1 link kept from the start still opens');
  check(!!back && summary(back) === 'modern | Burn |  |  | 3x htou#14, 4x lea#161, 4x m10#46, 4x m10#58, 4x w17#11 | ',
    `and holds the same cards it always did (${back ? summary(back) : '-'})`);
}

/* broken links */
{
  const text = L.encode(burn);
  const bad = (t, what) => { let threw = false; try { L.decode(t); } catch (e) { threw = !!e.message; } check(threw, what); };
  bad(text.slice(0, text.length - 5), 'a link cut short is turned away');
  bad(text.slice(0, 20) + (text[20] === 'A' ? 'B' : 'A') + text.slice(21), 'a link with a character changed is turned away');
  bad('9' + text.slice(1), 'a link from a newer packing says so');
  bad('', 'an empty link is no deck');
  bad('1$$$', 'characters a link cannot hold are turned away');
  check(L.decode(text + ').').size === 65, 'a full stop or bracket a chat put after the link is left off');
  let msg = '';
  try { L.decode('9abc'); } catch (e) { msg = e.message; }
  check(/newer version/.test(msg), 'a newer link asks for a reload');
}

/* ================= sample hands and odds ================= */
const P = MTG.playtest;
{
  const deck = deckOf('standard', 'x', [[24, 'Mountain'], [36, 'Raging Goblin']]);
  const o = P.openingOdds(deck);
  check(o.lands === 24 && o.size === 60 && o.exactly.length === 8, 'a 60-card deck with 24 lands');
  check(near(o.exactly.reduce((a, b) => a + b, 0), 1, 1e-9), 'the chances add up to one');
  /* the figures for 24 lands in 60, seven cards, counted out in whole numbers:
     C(60,7) = 386,206,920 hands; C(24,3)·C(36,4) = 119,223,720 of them hold three
     lands, C(36,7) = 8,347,680 none, and 104,049,792 + 119,223,720 + 75,869,640
     two to four */
  const HANDS = 386206920;
  check(near(o.exactly[3], 119223720 / HANDS, 1e-9), `three lands: 30.9% (${(o.exactly[3] * 100).toFixed(2)}%)`);
  check(near(o.exactly[0], 8347680 / HANDS, 1e-9), `no lands: 2.2% (${(o.exactly[0] * 100).toFixed(2)}%)`);
  check(near(P.between(o.exactly, 2, 4), (104049792 + 119223720 + 75869640) / HANDS, 1e-9),
    `two to four lands: 77.5% (${(P.between(o.exactly, 2, 4) * 100).toFixed(2)}%)`);
  const edh = deckOf('commander', 'x', [[37, 'Forest'], [62, 'Llanowar Elves']]);
  const e = P.openingOdds(edh);
  check(e.size === 99 && near(e.exactly.reduce((a, b) => a + b, 0), 1, 1e-9), 'a 99-card deck works too');
  const small = deckOf('standard', 'x', [[3, 'Mountain'], [2, 'Raging Goblin']]);
  check(P.openingOdds(small).drawn === 5, 'a deck smaller than a hand draws what it has');
  check(P.isLand(card('Shatterskull Smashing')) && P.isLand(card('Forest')) && !P.isLand(card('Lightning Bolt')) && !P.isLand(card('Delver of Secrets')),
    'a modal double-faced card with a land on its back counts as a land; a transforming one does not');
}
{
  const deck = deckOf('standard', 'x', [[24, 'Mountain'], [36, 'Raging Goblin']]);
  const h = new P.SampleHand(deck, { seed: 3 });
  const total = () => h.hand.length + h.library.length;
  check(h.hand.length === 7 && h.library.length === 53 && h.kept, 'seven dealt, fifty-three left, nothing to bottom');
  h.mulligan();
  check(h.hand.length === 7 && h.toBottom === 1 && !h.kept && total() === 60, 'a mulligan is seven more and one to put back');
  check(h.draw() === null, 'no drawing until the card is put back');
  const goes = h.hand[0];
  h.bottom(goes.key);
  check(h.hand.length === 6 && h.kept && h.library[h.library.length - 1] === goes, 'the card chosen goes to the bottom');
  h.mulligan();
  check(h.toBottom === 2 && h.hand.length === 7 && total() === 60, 'a second mulligan puts two back, and the first card is shuffled back in');
  h.bottom(h.hand[0].key); h.bottom(h.hand[0].key);
  check(h.bottom(h.hand[0].key) === false && h.hand.length === 5, 'no more than two');
  const drawn = h.draw();
  check(!!drawn && h.hand.length === 6 && total() === 60 && h.mulligan() === false, 'drawing on keeps the hand');
  const keys = new Set(h.hand.concat(h.library).map(x => x.key));
  check(keys.size === 60, 'every card is still there, once');
  check(h.lands() === h.hand.filter(x => x.card.name === 'Mountain').length, 'lands in hand are counted');
  const free = new P.SampleHand(deck, { seed: 3, freeMulligans: 1 });
  free.mulligan();
  check(free.toBottom === 0, 'a free mulligan puts nothing back');
  h.reset();
  check(h.hand.length === 7 && h.mulligans === 0 && h.draws === 0, 'a new hand starts over');
}

/* ================= the practice game ================= */
const F = MTG.practice;
async function practice(onDraw, seed) {
  const deck = deckOf('standard', 'Red', [[20, 'Mountain'], [16, 'Raging Goblin'], [12, 'Lightning Bolt'], [12, 'Goblin Piker']]);
  const g = new MTG.rules.Game({ formatId: 'standard', startingLife: 20, startingHand: 7, commanderDamage: null, maxPlayers: 8, seed, firstPlayerDraws: false });
  g.addPlayer({ id: 'me', name: 'Me', isBot: true, botDifficulty: 6 });
  g.addPlayer({ id: F.SEAT, name: 'Goldfish', isBot: true, botDifficulty: 1 });
  g.loadDeck('me', deck);
  g.loadDeck(F.SEAT, F.emptyDeck('standard'));
  const runner = new MTG.bots.BotRunner(g);
  runner.add('me', 6);
  F.seat(g, runner, { id: F.SEAT });
  const t = F.tally(g);
  const acts = [];
  g.on('bot:action', (a) => { if (a.playerId === F.SEAT) acts.push(a); });
  g.start();
  F.setup(g, { onDraw });
  const first = g.turnOrder[0];
  runner.kick();
  const t0 = Date.now();
  let last = -1, still = 0;
  while (!g.over && (me => (me.turnsTaken || 0) <= 14)(g.player('me')) && Date.now() - t0 < 60000) {
    await new Promise(r => setTimeout(r, 25));
    if (g.stateVersion === last) { if (++still > 200) break; } else { still = 0; last = g.stateVersion; }
  }
  runner.stop();
  return { g, t, first, acts };
}
async function practiceChecks() {
  for (const [onDraw, seed] of [[false, 11], [true, 12]]) {
    const { g, t, first, acts } = await practice(onDraw, seed);
    const fish = g.player(F.SEAT);
    const label = onDraw ? 'on the draw' : 'on the play';
    check(first === (onDraw ? F.SEAT : 'me'), `${label}: the right player goes first`);
    check(!g.over && !fish.hasLost, `${label}: the Goldfish never loses (life ${fish.life}, turn ${g.turn})`);
    check(g.log.some(l => /Goldfish tried to draw from an empty library/.test(l.text || '')), `${label}: it ran out of cards and played on`);
    check(!!t.kill && t.kill.how === 'damage', `${label}: twenty damage was dealt (${t.dealt} by your turn ${t.turn})`);
    check(!!t.kill && t.kill.turn >= 2 && t.kill.turn <= 9, `${label}: on a believable turn (${t.kill && t.kill.turn})`);
    console.log(`  practice ${label}: ${t.dealt} damage by your turn ${t.turn}, twenty on turn ${t.kill && t.kill.turn}; by turn ${t.byTurn.map((v, i) => v == null ? null : `${i}:${v}`).filter(Boolean).join(' ')}`);
    check(t.byTurn.filter(x => x != null).every((v, i, a) => i === 0 || v >= a[i - 1]), `${label}: the damage only adds up`);
    const busy = g.log.filter(l => /^Goldfish (casts|attacks|blocks|plays)/.test(l.text || ''));
    check(!busy.length && !acts.length && !g.battlefield.some(o => o.controller === F.SEAT), `${label}: the Goldfish never did a thing (${busy.map(l => l.text).join('; ')})`);
    check(g.zones[F.SEAT].command.some(o => o.card && o.card.layout === 'emblem'), `${label}: its emblem is in its command zone`);
  }
}

/* ================= rulings ================= */
async function rulingsChecks() {
  const R = MTG.rulings;
  check(R.dateText('2004-10-04') === '4 Oct 2004' && R.dateText('2021-12-31') === '31 Dec 2021', 'dates read the British way');
  let asked = 0;
  const reply = { object: 'list', data: [
    { source: 'wotc', published_at: '2019-01-25', comment: 'The later one.' },
    { source: 'scryfall', published_at: '2004-10-04', comment: 'The earlier one, costs {R}.' },
    { source: 'wotc', published_at: '2010-01-01', comment: '' },
  ] };
  MTG.scry._fetch = async (p) => { asked++; return /rulings$/.test(p) ? reply : null; };
  const bolt = card('Lightning Bolt');
  const list = await MTG.scry.rulings(bolt);
  check(Array.isArray(list) && list.length === 2, 'rulings come back, the empty one left out');
  check(list[0].date === '2004-10-04' && list[0].source === 'scryfall' && list[1].source === 'wotc', 'oldest first, each saying whose it is');
  await MTG.scry.rulings(bolt);
  await MTG.scry.rulings(Object.assign({}, bolt, { id: '00000000-0000-0000-0000-000000000000' }));
  check(asked === 1, `asked once for every printing of one card (${asked} requests)`);
  check(await MTG.scry.rulings({ name: 'Goblin', id: null }) === null && asked === 1, 'a token the engine made has none to ask for');
  MTG.scry._fetch = async () => null;    // Scryfall's 404
  const none = await MTG.scry.rulings(card('Raging Goblin'));
  check(Array.isArray(none) && none.length === 0, 'a card Scryfall has no rulings for has an empty list');
  MTG.scry._fetch = async () => { throw new Error('offline'); };
  let threw = false;
  try { await MTG.scry.rulings(card('Goblin Piker')); } catch (e) { threw = true; }
  check(threw, 'no connection and nothing kept: the view is told, so it can offer to try again');
  check((await MTG.scry.rulings(bolt, { force: true })).length === 2, 'no connection but a copy kept: the copy');
}

/* An imported deck left without a name is called after its commander. */
function importNameChecks() {
  const D = MTG.decklist;
  check(D.nameFromCommanders([card('Hakbal of the Surging Soul')]) === 'Hakbal of the Surging Soul', 'a commander names the deck');
  check(D.nameFromCommanders([card('Thrasios, Triton Hero'), card('Tymna the Weaver')]) === 'Thrasios, Triton Hero & Tymna the Weaver', 'partners: both, joined with &');
  check(D.nameFromCommanders([card('Esika, God of the Tree')]) === 'Esika, God of the Tree', 'a double-faced commander: its front face');
  check(D.nameFromCommanders([card('Wrenn and Seven'), card('Lightning Bolt')]) === 'Wrenn and Seven', 'Oathbreaker: the planeswalker, not the signature spell');
  check(D.nameFromCommanders([]) === '', 'no commander: no name, so "Imported deck"');
}

(async () => {
  importNameChecks();
  await practiceChecks();
  await rulingsChecks();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
