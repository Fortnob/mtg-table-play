#!/usr/bin/env node
/* The Store's printed Commander decks, read once here so its shelf can
   show each deck's commander, its colours, what the deck leans on and how
   popular its commander is, without fetching every list in the browser.

   MTGJSON's list of decks, then each Commander deck's own file (kept in
   the system's temp folder between runs, since a printed deck never
   changes); the themes are read by src/15b-themes.js from the deck's
   cards. How popular: the commander's place on EDHREC's list of
   commanders (https://edhrec.com/commanders, the decks of the past two
   years, which the page reads from json.edhrec.com/pages/commanders/
   year.json and its pages after it), the better of two partners'. A
   commander not on that list falls back on Scryfall's EDHREC rank among
   all cards, from tools/oracle-cards.jsonl.gz where it is there and
   MTGJSON's copy of it where it is not. EDHREC's pages are kept in
   tools/.cache/edhrec for a week, and fetched a second apart.

   Written to src/10d4-precons.js as MTG.preconIndex, by deck file:

     [EDHREC commander rank or 0, [[commander name, Scryfall id], ...], [tag, ...],
      colour identity ("WUB", "" for colourless), Scryfall rank or 0]

   A deck printed after this last ran is read in the browser when its
   tile first shows (src/10d-ui-store.js), the same way but for EDHREC's
   list, which it does not have: it goes after the decks that are on it.

     node tools/precons.js            write src/10d4-precons.js
     node tools/precons.js --show     and print each deck with its tags, most popular first */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

// the network itself: the engine's own fetch keeps Scryfall's answers in tools/.cache
const realFetch = globalThis.fetch;
const MTG = load({ modules: ['00-core.js', '15b-themes.js'] });
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src', '10d4-precons.js');
const BULK = path.join(__dirname, 'oracle-cards.jsonl.gz');
const CACHE = path.join(os.tmpdir(), 'mtg-table-precons');
const EDH_CACHE = path.join(__dirname, '.cache', 'edhrec');
const MTGJSON = 'https://mtgjson.com/api/v5/';
const EDHREC = 'https://json.edhrec.com/pages/';
const show = process.argv.includes('--show');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(EDH_CACHE, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/* A JSON file, from where it is kept when it is fresh enough (`maxAge` in
   ms; Infinity for a file that never changes), else fetched after `gap` ms. */
async function getJson(url, at, maxAge, gap) {
  if (fs.existsSync(at) && Date.now() - fs.statSync(at).mtimeMs < maxAge) return JSON.parse(fs.readFileSync(at, 'utf8'));
  await sleep(gap);
  const res = await realFetch(url, { headers: { 'User-Agent': 'mtg-table-precons/1.0' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(at, text);
  return JSON.parse(text);
}

const norm = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Scryfall's rank by name, where the bulk file is here
const scryRank = new Map();
if (fs.existsSync(BULK)) {
  for (const ln of zlib.gunzipSync(fs.readFileSync(BULK)).toString('utf8').split('\n')) {
    if (!ln) continue;
    const c = JSON.parse(ln);
    if (c.edhrec_rank == null) continue;
    scryRank.set(c.name, c.edhrec_rank);
    const front = c.name.split(' // ')[0];
    if (!scryRank.has(front)) scryRank.set(front, c.edhrec_rank);
  }
}

/* EDHREC's commanders, page by page until every one wanted is found or
   the list ends: by name (and each half of a pair or a two-faced card), its
   place on the list. */
async function edhrecRanks(wanted) {
  const ranks = new Map();
  const put = (name, r) => { const k = norm(name); if (!ranks.has(k) || ranks.get(k) > r) ranks.set(k, r); };
  let file = 'commanders/year.json', pages = 0;
  while (file && pages < 100) {
    const d = await getJson(EDHREC + file, path.join(EDH_CACHE, file.replace(/\//g, '_')), 7 * 864e5, 1000);
    const views = d.cardviews || (d.container && d.container.json_dict.cardlists[0].cardviews) || [];
    const more = d.more || (d.container && d.container.json_dict.cardlists[0].more) || null;
    for (const v of views) {
      const r = v.rank || ranks.size + 1;
      put(v.name, r);
      for (const half of String(v.name).split(' // ')) put(half, r);
    }
    pages++;
    if ([...wanted].every(n => ranks.has(n))) break;
    file = more;
  }
  console.log(`EDHREC: ${pages} pages, ${ranks.size} names`);
  return ranks;
}

(async () => {
  const list = (await getJson(MTGJSON + 'DeckList.json', path.join(CACHE, 'DeckList.json'), 864e5, 150)).data
    .filter(x => /commander deck/i.test(x.type || ''));
  const files = [];
  for (const x of list) {
    try { files.push({ x, d: (await getJson(MTGJSON + 'decks/' + encodeURIComponent(x.fileName) + '.json', path.join(CACHE, x.fileName + '.json'), Infinity, 150)).data }); }
    catch (e) { console.log('skipped ' + x.fileName + ': ' + e.message); }
  }
  // a commander by its front face's name: Gisela, not Gisela // Brisela
  const nameOf = (c) => c.faceName || c.name.split(' // ')[0];
  const wanted = new Set(files.flatMap(({ d }) => (d.commander || []).map(c => norm(nameOf(c)))));
  const edh = await edhrecRanks(wanted);

  const out = {};
  for (const { x, d } of files) {
    const commanders = (d.commander || []).map(c => Object.assign({}, c, {
      edhrec_rank: scryRank.has(c.name) ? scryRank.get(c.name) : c.edhrecRank,
    }));
    const deck = { commanders, main: (d.mainBoard || []).map(c => ({ card: c, qty: Math.max(1, c.count || 1) })) };
    const ranks = commanders.map(c => edh.get(norm(nameOf(c))) || edh.get(norm(c.name))).filter(Boolean);
    const scry = MTG.themes.rank(commanders);
    out[x.fileName] = [ranks.length ? Math.min(...ranks) : 0,
      commanders.map(c => [nameOf(c), (c.identifiers && c.identifiers.scryfallId) || '']),
      MTG.themes.tags(deck), MTG.themes.identity(commanders), Number.isFinite(scry) ? scry : 0];
  }
  const keys = Object.keys(out).sort();
  if (show) {
    const order = (r) => (r[0] || 1e6 + (r[4] || 1e6));
    const named = new Map(files.map(({ x }) => [x.fileName, x.name]));
    for (const k of keys.slice().sort((a, b) => order(out[a]) - order(out[b])))
      console.log(`${String(out[k][0] || '-').padStart(5)} ${String(out[k][4] || '-').padStart(6)}  ${named.get(k)} (${out[k][1].map(c => c[0]).join(' + ')}; ${out[k][3] || 'C'}): ${out[k][2].join(' · ')}`);
  }
  console.log(`${keys.filter(k => out[k][0]).length} of ${keys.length} decks have a commander on EDHREC's list`);
  const body = keys.map(k => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k])).join(',\n');
  fs.writeFileSync(OUT, `/* ============================================================
   10d4-precons.js - the Store's printed Commander decks, read ahead

   Written by tools/precons.js: by MTGJSON deck file, [the commander's
   place on EDHREC's list of commanders (the better of two; 0 for one not
   on it), [[commander, Scryfall id], ...], [what the deck leans on, as
   src/15b-themes.js reads it], its colour identity, Scryfall's EDHREC
   rank of the commander (0 for none)]. Read with themes version ${MTG.themes.VERSION}.
   Run it again when the themes change or new decks come out; a deck
   missing here is read in the browser.
   ============================================================ */
'use strict';
(function (MTG) {
  MTG.preconIndex = { v: ${MTG.themes.VERSION}, decks: {
${body},
  } };
})(window.MTG);
`, { encoding: 'utf8' });
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${keys.length} decks`);
})().catch((e) => { console.error(e); process.exit(1); });
