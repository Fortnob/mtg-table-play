#!/usr/bin/env node
/* The deck tools, checked without a browser:

   - deck links (src/05a-decklink.js): a deck goes into a link and comes
     back out the same, links stay short, a link made by version 1 of
     the packing still opens (a fixed one is kept below, and must never
     change), and a link cut short or tampered with is turned away;
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
for (const m of ['05a-decklink.js', '10g-rulings.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', m), 'utf8'), { filename: m });
}

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };

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

(async () => {
  await rulingsChecks();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
