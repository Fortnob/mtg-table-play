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
     dated the British way, and nothing asked for a card that has none;
   - the builder (src/11-ui-deck.js) on a pretend DOM: leaving it with
     changes not saved, by every way out, asks "Leave without saving?",
     and stay, discard and save each do what they say; no question when
     nothing changed, and the tab's own "leave this page?" while changed;
   - cards the deck's format will not have: why, in a few words, for
     each (banned, not legal, outside the commander's colours, too many
     copies, no commander), and the builder marking them red;
   - the deck list's order (Sort by: type, mana value, name, colour,
     rarity, price; lands together, X costs last) and Show price, with
     the cards nobody has priced sorted last.

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
const check = (ok, what, detail) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what + (detail != null ? ': ' + detail : '')); } };
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

/** The app's deck builder (src/11-ui-deck.js) in a page of its own, on a pretend DOM (tools/fakedom.js). */
function builderPage() {
  const { Document, makeEvent } = require('./fakedom');
  const doc = new Document();
  const store = new Map();
  const onWindow = {};
  const page = {
    console: { log: console.log, error: () => {}, warn: () => {}, info: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance, TextEncoder, TextDecoder, URL, URLSearchParams,
    crypto: require('crypto').webcrypto, document: doc, navigator: { maxTouchPoints: 0 }, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), key: (i) => Array.from(store.keys())[i], get length() { return store.size; },
    },
    location: { search: '', href: 'http://localhost/', pathname: '/', hash: '' },
    CSS: { escape: (s) => String(s) },
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    addEventListener(k, f) { (onWindow[k] = onWindow[k] || []).push(f); }, removeEventListener() {},
    fetch: async () => { throw new Error('offline'); },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    // a picture never loads here
    Image: class { set src(v) { setTimeout(() => this.onerror && this.onerror(), 0); } },
  };
  page.window = page;
  vm.createContext(page);
  for (const f of ['00-core.js', '01-audio.js', '02-scryfall.js', '02a-carddb.js', '18-scripts.js', '19-cardlib.js', '03-oracle.js',
    '04-formats.js', '05-decklist.js', '05a-decklink.js', '06-rules.js', '15-combos.js', '15a-brackets.js', '15b-themes.js', '16-advisor.js',
    '10-ui-core.js', '10c-economy.js', '11-ui-deck.js', '17-ui-advisor.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), page, { filename: f });
  }
  const P = page.MTG, UI = P.ui;
  P.sfx = () => {};
  UI.toast = () => {};
  UI.ok = UI.toast;
  UI.error = UI.toast;
  return { page, doc, onWindow, makeEvent, P, UI };
}

/* ================= the builder: leaving with changes not saved =================
   Closed every way there is, with and without changes, and the three
   answers to "Leave without saving?". */
async function leaveChecks() {
  const { page, doc, onWindow, makeEvent, P, UI } = builderPage();
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 10));
  const windows = () => doc.querySelectorAll('.modal');
  const asking = () => windows().find(m => m.classList.contains('leave-modal')) || null;
  const builders = () => windows().filter(m => m.classList.contains('deck-modal'));
  const button = (host, label) => (host ? host.querySelectorAll('button').find(b => b.textContent === label) : null);
  const answer = async (label) => { const b = button(asking(), label); if (b) b.click(); await tick(); return !!b; };
  const key = (k) => doc.dispatchEvent(makeEvent('keydown', { key: k }));
  const unload = () => { let stopped = false; for (const f of onWindow.beforeunload || []) f({ preventDefault() { stopped = true; }, set returnValue(v) { stopped = true; } }); return stopped; };

  const forest = card('Forest'), bears = card('Grizzly Bears');
  const deckOfBears = () => ({ id: 'bears', name: 'Bears', format: 'standard', main: [{ card: forest, qty: 20 }, { card: bears, qty: 4 }],
    sideboard: [], commanders: [], companion: null });
  P.decks.save(deckOfBears());
  const saved = () => page.MTG.store.get('deck.bears', null);
  const savedBears = () => (saved().main.find(e => e.id === bears.id) || {}).q;
  const more = (b) => b.querySelectorAll('button').find(x => x.getAttribute('aria-label') === 'One more Grizzly Bears');
  const fewer = (b) => b.querySelectorAll('button').find(x => x.getAttribute('aria-label') === 'One fewer Grizzly Bears');

  // what counts as a change
  const S = UI.deckSnapshot;
  const base = deckOfBears();
  check(S(base) === S(Object.assign(deckOfBears(), { main: deckOfBears().main.slice().reverse() })), 'snapshot: the order cards sit in is no change');
  check(S(base) !== S(Object.assign(deckOfBears(), { name: 'Cubs' })), 'snapshot: the name');
  check(S(base) !== S(Object.assign(deckOfBears(), { format: 'pioneer' })), 'snapshot: the format');
  check(S(base) !== S(Object.assign(deckOfBears(), { main: [{ card: forest, qty: 20 }, { card: bears, qty: 3 }] })), 'snapshot: a count');
  check(S(base) !== S(Object.assign(deckOfBears(), { main: [{ card: forest, qty: 20 }, { card: Object.assign({}, bears, { id: 'another-printing' }), qty: 4 }] })), 'snapshot: a printing');
  check(S(base) !== S(Object.assign(deckOfBears(), { sideboard: [{ card: bears, qty: 1 }] })), 'snapshot: the sideboard');
  check(S(base) !== S(Object.assign(deckOfBears(), { commanders: [bears] })), 'snapshot: the commanders');
  check(S(base) !== S(Object.assign(deckOfBears(), { companion: bears })), 'snapshot: the companion');
  check(S(base) !== S(Object.assign(deckOfBears(), { maybeboard: [{ card: bears, qty: 1 }] })), 'snapshot: a maybeboard');

  // nothing changed: Close closes, no question
  UI.deckBuilder(deckOfBears(), {});
  check(builders().length === 1, 'the builder opens');
  check(!unload(), 'nothing changed: closing the tab is not stopped');
  button(builders()[0], 'Close').click(); await tick();
  check(!builders().length && !asking(), 'nothing changed: Close just closes');

  // a change, and Close asks
  UI.deckBuilder(deckOfBears(), {});
  let b = builders()[0];
  more(b).click(); await tick();
  check(unload(), 'with a change, closing or reloading the tab asks first');
  button(b, 'Close').click(); await tick();
  const q = asking();
  check(!!q && /Leave without saving\?/.test(q.textContent), 'with a change, Close asks “Leave without saving?”', q && q.textContent);
  const labels = q ? q.querySelectorAll('.modal-foot button').map(x => x.textContent) : [];
  check(JSON.stringify(labels) === JSON.stringify(['Discard and leave', 'Save and leave', 'Stay and keep editing']), 'its three answers', JSON.stringify(labels));
  check(!!q && button(q, 'Discard and leave').classList.contains('danger') && button(q, 'Stay and keep editing').classList.contains('primary'), 'discarding looks destructive; staying is the main button');
  await tick(20);
  check(doc.activeElement === button(q, 'Stay and keep editing'), 'staying has the focus', doc.activeElement && (doc.activeElement.tagName + ' ' + doc.activeElement.className + ' ' + doc.activeElement.textContent.slice(0, 40)));
  await answer('Stay and keep editing');
  check(builders().length === 1 && !asking(), 'stay: the builder is still open');
  check(UI.unsavedWork() && unload(), 'and the change is still there, still not saved');
  // Escape asks the same, and Escape on the question stays
  key('Escape'); await tick();
  check(!!asking(), 'Escape asks too');
  key('Escape'); await tick();
  check(builders().length === 1 && !asking(), 'Escape on the question stays');
  // the X in the corner
  b.querySelector('.modal-x').click(); await tick();
  check(!!asking(), 'the X asks too');
  await answer('Discard and leave');
  check(!builders().length, 'discard: the builder closes');
  check(savedBears() === 4, 'and the saved deck is as it was', savedBears());

  // a change taken back again is no change
  UI.deckBuilder(deckOfBears(), {});
  b = builders()[0];
  more(b).click(); await tick();
  fewer(b).click(); await tick();
  button(b, 'Close').click(); await tick();
  check(!builders().length && !asking(), 'a change undone by hand: nothing to ask about');

  // somewhere else in the app (the top navigation asks UI.canLeave): save and leave
  UI.deckBuilder(deckOfBears(), {});
  b = builders()[0];
  more(b).click(); await tick();
  let left = null;
  UI.canLeave().then(v => { left = v; });
  await tick();
  check(!!asking() && left === null, 'leaving for elsewhere asks first, and waits');
  await answer('Save and leave');
  check(left === true && !builders().length, 'save and leave: the builder closes, and the way is clear');
  check(savedBears() === 5, 'and the deck is saved with the change', savedBears());
  // staying keeps you where you are
  UI.deckBuilder(Object.assign(deckOfBears(), { main: [{ card: forest, qty: 20 }, { card: bears, qty: 5 }] }), {});
  b = builders()[0];
  fewer(b).click(); await tick();
  left = null;
  UI.canLeave().then(v => { left = v; });
  await tick();
  await answer('Stay and keep editing');
  check(left === false && builders().length === 1, 'stay: the way out is refused, the builder still open');

  // another deck opened over this one asks first; staying opens nothing
  UI.deckBuilder(deckOfBears(), {});
  await tick();
  check(!!asking(), 'opening another deck over changes not saved asks first');
  await answer('Stay and keep editing');
  check(builders().length === 1, 'stay: the other deck is not opened');
  UI.deckBuilder(deckOfBears(), {});
  await tick();
  await answer('Discard and leave');
  await tick();
  check(builders().length === 1 && !asking(), 'discard: this one closes and the other opens');
  button(builders()[0], 'Close').click(); await tick();
  check(!builders().length, 'and closes without asking, unchanged');

  // a new deck: never saved but with cards in it is worth asking about; an empty one is not
  UI.deckBuilder({ id: 'fresh', name: '', format: 'standard', main: [], sideboard: [], commanders: [], companion: null }, { untitled: 'New Deck' });
  b = builders()[0];
  check(!unload(), 'a new, empty deck: nothing to lose');
  button(b, 'Close').click(); await tick();
  check(!builders().length && !asking(), 'a new, empty deck closes without asking');
  UI.deckBuilder({ id: 'imported', name: 'Imported', format: 'standard', main: [{ card: forest, qty: 20 }], sideboard: [], commanders: [], companion: null }, {});
  b = builders()[0];
  check(unload(), 'a deck never saved, with cards (an import, say): closing the tab asks');
  button(b, 'Close').click(); await tick();
  check(!!asking() && /has not been saved yet/.test(asking().textContent), 'and Close says it has never been saved', asking() && asking().textContent);
  await answer('Save and leave');
  check(!builders().length && !!page.MTG.store.get('deck.imported', null), 'save and leave keeps it');
  check(!unload(), 'nothing open, nothing to lose');
}

/* ================= the deck list's order, and prices =================
   Price sorts dearest first with the cards nobody has priced last; the
   list's sections in each order, lands kept together and X costs after
   the rest; the Sort and Show price controls remembered, and the deck's
   total shown while prices are on. */
async function sortChecks() {
  const { doc, makeEvent, P, UI } = builderPage();
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 10));
  const U = P.util;
  const priced = (name, usd) => Object.assign({}, card(name), { prices: { usd: usd == null ? null : String(usd), usd_foil: null, eur: null, tix: null } });
  const cheap = priced('Grizzly Bears', 0.25), dear = priced('Doubling Season', 34.5), none = priced('Ponder', null), mid = priced('Counterspell', 4);
  const names = (list) => list.map(x => (x.card || x).name).join(', ');
  check(names([cheap, none, dear, mid].sort(U.byPriceDesc)) === 'Doubling Season, Counterspell, Grizzly Bears, Ponder',
    'price: dearest first, no price last', names([cheap, none, dear, mid].sort(U.byPriceDesc)));
  check(names([none, priced('Lightning Bolt', null)].sort(U.byPriceDesc)) === 'Ponder, Lightning Bolt', 'price: two with none keep their order');
  const e = (c, qty) => ({ card: c, qty: qty || 1 });
  check(names(UI.sortCards([e(none), e(cheap), e(dear), e(mid)], 'price')) === 'Doubling Season, Counterspell, Grizzly Bears, Ponder',
    'the deck list by price: the same', names(UI.sortCards([e(none), e(cheap), e(dear), e(mid)], 'price')));

  // the sections, in every order
  const fireball = priced('Fireball', 0.3), citadel = priced('Darksteel Citadel', 2.6), arbor = priced('Dryad Arbor', 3.6), forest = priced('Forest', null);
  const ring = priced('Sol Ring', 1.5), atraxa = priced("Atraxa, Praetors' Voice", 28);
  const list = [e(fireball), e(citadel), e(arbor), e(forest, 30), e(cheap), e(dear), e(none), e(mid), e(ring), e(atraxa)];
  const secs = (mode) => UI.deckSections(list, mode).map(sec => sec.label + ': ' + names(sec.items)).join(' | ');
  check(secs('type') === "Creatures: Grizzly Bears, Atraxa, Praetors' Voice | Instants: Counterspell | Sorceries: Ponder, Fireball | Artifacts: Sol Ring | Enchantments: Doubling Season | Lands: Darksteel Citadel, Dryad Arbor, Forest",
    'by type, as it always was: an artifact land and Dryad Arbor with the lands, X last among the sorceries', secs('type'));
  check(UI.deckSections(list, 'nonsense').map(x => x.label).join() === UI.deckSections(list, 'type').map(x => x.label).join(), 'an unknown order is by type');
  check(secs('mv') === "1 mana: Ponder, Sol Ring | 2 mana: Counterspell, Grizzly Bears | 4 mana: Atraxa, Praetors' Voice | 5 mana: Doubling Season | X costs: Fireball | Lands: Darksteel Citadel, Dryad Arbor, Forest",
    'by mana value: a section each, X costs after them, the lands together last', secs('mv'));
  check(secs('color') === "Blue: Ponder, Counterspell | Red: Fireball | Green: Grizzly Bears, Doubling Season | Multicolour: Atraxa, Praetors' Voice | Colourless: Sol Ring | Lands: Darksteel Citadel, Dryad Arbor, Forest",
    'by colour: the five, then several colours, then none, the lands last', secs('color'));
  check(secs('price') === "Nonland cards: Doubling Season, Atraxa, Praetors' Voice, Counterspell, Sol Ring, Fireball, Grizzly Bears, Ponder | Lands: Dryad Arbor, Darksteel Citadel, Forest",
    'by price: dearest first, no price last, and the lands by price after them', secs('price'));
  check(secs('name') === "Nonland cards: Atraxa, Praetors' Voice, Counterspell, Doubling Season, Fireball, Grizzly Bears, Ponder, Sol Ring | Lands: Darksteel Citadel, Dryad Arbor, Forest",
    'by name', secs('name'));
  check(/^Mythic: Atraxa/.test(secs('rarity')) && /Lands: /.test(secs('rarity')), 'by rarity: rarest first', secs('rarity'));
  check(UI.deckSections(list, 'mv').every(x => x.type === undefined || x.type === 'Land') && UI.deckSections(list, 'type').every(x => !!x.type),
    'only a section of one card type marks its cards');

  // the builder: the order chosen is the order shown, and remembered
  const deck = { id: 'sorts', name: 'Sorts', format: 'standard', main: list.map(x => ({ card: x.card, qty: x.qty })), sideboard: [], commanders: [], companion: null };
  P.setSetting('showCardPrices', false);
  P.setSetting('deckListSort', 'type');
  UI.deckBuilder(deck, {});
  await tick();
  const b = () => doc.querySelectorAll('.modal').find(m => m.classList.contains('deck-modal'));
  const heads = () => b().querySelectorAll('.deck-list .section-title').map(n => n.textContent);
  check(heads()[0] === 'Creatures · 2', 'the list opens by type', heads().join(' | '));
  const sel = b().querySelector('.deck-list .deck-sort');
  check(!!sel && sel.querySelectorAll('option').map(o => o.textContent).join(', ') === 'Sort: Type, Sort: Mana value, Sort: Name, Sort: Colour, Sort: Rarity, Sort: Price',
    'the Sort list over the deck', sel && sel.querySelectorAll('option').map(o => o.textContent).join(', '));
  sel.value = 'price';
  sel.dispatchEvent(makeEvent('change'));
  await tick();
  check(P.settings.deckListSort === 'price' && heads().join(' | ') === 'Nonland cards · 7 | Lands · 32', 'sorted by price, and remembered', heads().join(' | '));
  check(b().querySelectorAll('.deck-list .deck-entry .nm').map(n => n.textContent)[0] === 'Doubling Season', 'the dearest card first');
  check(!b().querySelector('.deck-list .price') && !b().querySelector('.deck-total'), 'no prices until asked for');
  const box = b().querySelector('.deck-list .deck-show-price input');
  box.checked = true;
  box.dispatchEvent(makeEvent('change'));
  await tick();
  const total = b().querySelector('.deck-list .deck-total');
  check(P.settings.showCardPrices === true && b().querySelectorAll('.deck-list .deck-entry .price').length === 10, 'Show price: a price on every line, remembered');
  check(!!total && /^\$74\.75 \+31 unpriced$/.test(total.textContent), 'and what the deck costs, with how many cards have no price', total && total.textContent);
  check(heads()[0] === 'Nonland cards · 7 · $68.55', 'each section says what its cards cost', heads()[0]);
  check(b().querySelectorAll('.card-grid .price-tag').length === 10, 'and every card in the grid has its price on it', b().querySelectorAll('.card-grid .price-tag').length);
  // closed and opened again: the same order
  b().querySelector('.modal-x').click(); await tick();
  UI.deckBuilder(deck, {});
  await tick();
  check(heads()[0] === 'Nonland cards · 7 · $68.55', 'opened again, it is still by price with prices shown', heads()[0]);
  b().querySelector('.modal-x').click(); await tick();
  P.setSetting('deckListSort', 'type');
  P.setSetting('showCardPrices', false);
}

/* ================= cards the format will not have =================
   What validate says about each card, in a few words (cardIssues), the
   same words for a search result (cardProblem), and the builder marking
   those cards red, again as soon as the format changes. */
async function illegalChecks() {
  const F = MTG.formats;
  const atraxa = card("Atraxa, Praetors' Voice");
  const cmdDeck = { format: 'commander', commanders: [atraxa], sideboard: [], main: [
    { card: card('Mana Crypt'), qty: 1 }, { card: card('Lightning Bolt'), qty: 1 }, { card: card('Sol Ring'), qty: 2 },
    { card: card('Forest'), qty: 30 }, { card: card('Counterspell'), qty: 1 }] };
  const v = F.validate(cmdDeck, 'commander');
  const why = (vv, n) => F.cardIssuesFor(vv, card(n)).join(' | ');
  check(why(v, 'Mana Crypt') === 'Banned in Commander', 'banned', why(v, 'Mana Crypt'));
  check(why(v, 'Lightning Bolt') === 'Outside Atraxa’s colours', 'outside the commander’s colours, by its short name', why(v, 'Lightning Bolt'));
  check(why(v, 'Sol Ring') === 'Only 1 copy allowed', 'over the copy limit', why(v, 'Sol Ring'));
  check(why(v, 'Forest') === '' && why(v, 'Counterspell') === '' && why(v, "Atraxa, Praetors' Voice") === '', 'basics, cards it may have and the commander itself: nothing');
  const bears = F.validate({ format: 'commander', commanders: [card('Grizzly Bears')], main: [], sideboard: [] }, 'commander');
  check(/^Can’t be a commander/.test(why(bears, 'Grizzly Bears')), 'a commander that cannot be one', why(bears, 'Grizzly Bears'));
  const two = F.validate({ format: 'commander', commanders: [card('Thrasios, Triton Hero'), card('Tymna the Weaver')], main: [{ card: card('Lightning Bolt'), qty: 1 }], sideboard: [] }, 'commander');
  check(why(two, 'Lightning Bolt') === 'Outside your commanders’ colours', 'two commanders: their colours together', why(two, 'Lightning Bolt'));
  const std = F.validate({ format: 'standard', commanders: [], sideboard: [], main: [{ card: card('Sol Ring'), qty: 1 }, { card: card('Grizzly Bears'), qty: 5 }] }, 'standard');
  check(why(std, 'Sol Ring') === 'Not legal in Standard', 'not legal in the format', why(std, 'Sol Ring'));
  check(/Only 4 copies allowed/.test(why(std, 'Grizzly Bears')), 'five of a card where four is the most', why(std, 'Grizzly Bears'));
  check(F.cardIssuesFor(null, card('Sol Ring')).length === 0 && F.cardIssuesFor({}, card('Sol Ring')).length === 0, 'no validation, no words');
  // a search result, on its own
  const cmd = F.get('commander');
  check(F.cardProblem(card('Mana Crypt'), cmd, null) === 'Banned in Commander', 'a search result: banned');
  check(F.cardProblem(card('Lightning Bolt'), cmd, new Set(['W', 'U', 'B', 'G']), F.coloursOf([atraxa])) === 'Outside Atraxa’s colours', 'a search result: outside the colours');
  check(F.cardProblem(card('Counterspell'), cmd, new Set(['W', 'U', 'B', 'G']), 'Atraxa’s') === null, 'a search result it may have: nothing');

  // the builder: red, with why under the name, and again when the format changes
  const { doc, makeEvent, P, UI } = builderPage();
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 10));
  UI.deckBuilder({ id: 'redcards', name: 'Red cards', format: 'commander', commanders: [atraxa], sideboard: [], companion: null,
    main: [{ card: card('Mana Crypt'), qty: 1 }, { card: card('Counterspell'), qty: 1 }, { card: card('Forest'), qty: 30 }] }, {});
  await tick();
  const b = () => doc.querySelectorAll('.modal').find(m => m.classList.contains('deck-modal'));
  const red = () => b().querySelectorAll('.deck-list .deck-entry.illegal').map(n => n.querySelector('.nm').textContent + ': ' + n.querySelector('.illegal-why').textContent);
  check(red().join(' | ') === 'Mana Crypt: Banned in Commander', 'the banned card is red, and says why', red().join(' | '));
  check(b().querySelectorAll('.card-grid .card-slot.illegal .illegal-ribbon').map(n => n.textContent).join(' | ') === 'Banned in Commander', 'and in the card grid, written across it');
  const fmtSel = b().querySelector('.deck-list select[aria-label="Format"]');
  fmtSel.value = 'standard';
  fmtSel.dispatchEvent(makeEvent('change'));
  await tick();
  check(red().join(' | ') === 'Counterspell: Not legal in Standard | Mana Crypt: Not legal in Standard' || red().join(' | ') === 'Mana Crypt: Not legal in Standard | Counterspell: Not legal in Standard',
    'Standard chosen: at once, what Standard will not have', red().join(' | '));
  b().querySelector('.modal-x').click(); await tick();
  const leave = doc.querySelectorAll('.modal').find(m => m.classList.contains('leave-modal'));
  if (leave) { leave.querySelectorAll('button').find(x => x.textContent === 'Discard and leave').click(); await tick(); }
}

(async () => {
  importNameChecks();
  await illegalChecks();
  await sortChecks();
  await practiceChecks();
  await rulingsChecks();
  await leaveChecks();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
