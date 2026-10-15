/* The plane and phenomenon cards, for src/02f-planes.js.

   node tools/planes.js            report
   node tools/planes.js --write    ...and write src/02f-planes.js

   Every card of Scryfall's planar layout in the oracle-cards bulk file
   (tools/oracle-cards.jsonl.gz, python tools/fetch-bulk.py), but the joke
   ones (set type "funny"): its name, whether it is a phenomenon, its set and
   the Scryfall id of the printing the bulk file has, by which the app looks
   the card up like any other (MTG.scry.collection). The planes are listed so
   a planar deck can be dealt or built without a search; their words are
   Scryfall's, read by the engine like any card's. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src', '02f-planes.js');
const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const rows = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout !== 'planar' || c.set_type === 'funny') continue;
  const kind = /^Phenomenon\b/.test(c.type_line) ? 'H' : 'P';
  rows.push([c.id, c.name, c.set, kind]);
}
rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
const planes = rows.filter(r => r[3] === 'P').length;
console.log(`${rows.length} cards: ${planes} planes, ${rows.length - planes} phenomena`);
if (process.argv.includes('--write')) {
  const head = fs.readFileSync(OUT, 'utf8').split('/* @@DATA@@ */')[0];
  const tail = fs.readFileSync(OUT, 'utf8').split('/* @@END@@ */')[1];
  const data = rows.map(r => '    ' + JSON.stringify(r.join('|')) + ',').join('\n');
  fs.writeFileSync(OUT, head + '/* @@DATA@@ */\n' + data + '\n    /* @@END@@ */' + tail);
  console.log('wrote ' + path.relative(ROOT, OUT));
}
