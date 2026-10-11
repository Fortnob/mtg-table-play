#!/usr/bin/env node
/* The Store's printed Commander decks, read once here so its shelf can
   show each deck's commander, what the deck leans on and how popular its
   commander is, without fetching every list in the browser.

   MTGJSON's list of decks, then each Commander deck's own file (kept in
   the system's temp folder between runs, since a printed deck never
   changes); the themes are read by src/15b-themes.js from the deck's
   cards, and the rank is Scryfall's EDHREC rank of its commander (the
   better of two), from tools/oracle-cards.jsonl.gz where it is there and
   MTGJSON's copy of it where it is not. Written to src/10d4-precons.js as
   MTG.preconIndex, by deck file:

     [rank or 0, [[commander name, Scryfall id], ...], [tag, ...]]

   A deck printed after this last ran is read in the browser when its
   tile first shows (src/10d-ui-store.js), the same way.

     node tools/precons.js            write src/10d4-precons.js
     node tools/precons.js --show     and print each deck with its tags */
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
const MTGJSON = 'https://mtgjson.com/api/v5/';
const show = process.argv.includes('--show');
fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function getJson(url, file, keep) {
  const at = path.join(CACHE, file);
  if (fs.existsSync(at) && (keep || Date.now() - fs.statSync(at).mtimeMs < 864e5)) return JSON.parse(fs.readFileSync(at, 'utf8'));
  await sleep(150);
  const res = await realFetch(url, { headers: { 'User-Agent': 'mtg-table-precons/1.0' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(at, text);
  return JSON.parse(text);
}

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

(async () => {
  const list = (await getJson(MTGJSON + 'DeckList.json', 'DeckList.json', false)).data
    .filter(x => /commander deck/i.test(x.type || ''));
  const out = {};
  let n = 0;
  for (const x of list) {
    let d;
    try { d = (await getJson(MTGJSON + 'decks/' + encodeURIComponent(x.fileName) + '.json', x.fileName + '.json', true)).data; }
    catch (e) { console.log('skipped ' + x.fileName + ': ' + e.message); continue; }
    const commanders = (d.commander || []).map(c => Object.assign({}, c, {
      edhrec_rank: scryRank.has(c.name) ? scryRank.get(c.name) : c.edhrecRank,
    }));
    const deck = { commanders, main: (d.mainBoard || []).map(c => ({ card: c, qty: Math.max(1, c.count || 1) })) };
    const rank = MTG.themes.rank(commanders);
    const tags = MTG.themes.tags(deck);
    out[x.fileName] = [Number.isFinite(rank) ? rank : 0,
      // a commander by its front face's name: Gisela, not Gisela // Brisela
      commanders.map(c => [c.faceName || c.name.split(' // ')[0], (c.identifiers && c.identifiers.scryfallId) || '']), tags];
    if (show) console.log(`${String(Number.isFinite(rank) ? rank : '-').padStart(6)}  ${x.name} (${out[x.fileName][1].map(c => c[0]).join(' + ')}): ${tags.join(' · ')}`);
    if (++n % 25 === 0 && !show) console.log(`${n} of ${list.length}`);
  }
  const keys = Object.keys(out).sort();
  const body = keys.map(k => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(out[k])).join(',\n');
  fs.writeFileSync(OUT, `/* ============================================================
   10d4-precons.js - the Store's printed Commander decks, read ahead

   Written by tools/precons.js: by MTGJSON deck file, [the commander's
   EDHREC rank (the better of two; 0 for none), [[commander, Scryfall
   id], ...], [what the deck leans on, as src/15b-themes.js reads it]].
   Read with themes version ${MTG.themes.VERSION}. Run it again when the themes change
   or new decks come out; a deck missing here is read in the browser.
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
