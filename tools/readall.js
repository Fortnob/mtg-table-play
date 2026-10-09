/* Read every card: MTG.oracle.analyze over every card in the bulk file, every
   face, so a card whose words throw can never again stop a set from opening.

   node tools/readall.js [--show 20]

   analyze() catches what it cannot read and hands back the card without its
   words (marked unreadable); this counts those, and anything that still
   throws, and fails on either. The last line ("summary {...}") is for
   tools/check.py. */
'use strict';
process.env.OFFLINE = process.env.OFFLINE || '1';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };

const { load } = require('./engine');
const warn = console.warn; console.warn = () => {};
const MTG = load();

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
let cards = 0, faces = 0, thrown = 0, unreadable = 0;
const bad = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  cards++;
  const card = MTG.scry && MTG.scry.slim ? MTG.scry.slim(c) : c;
  const n = Math.max(1, (card.card_faces || []).length);
  for (let i = 0; i < n; i++) {
    faces++;
    try {
      const a = MTG.oracle.analyze(card, i);
      if (a && a.unreadable) { unreadable++; if (bad.length < 200) bad.push(`  unreadable: ${c.name} (face ${i})`); }
    } catch (e) {
      thrown++;
      if (bad.length < 200) bad.push(`  throws: ${c.name} (face ${i}): ${e && e.message}`);
    }
  }
}
console.warn = warn;
console.log(`cards read: ${cards} (${faces} faces); throwing: ${thrown}; unreadable: ${unreadable}`);
const show = +arg('show', 20);
if (bad.length) console.log(bad.slice(0, show).join('\n'));
console.log('summary ' + JSON.stringify({ cards, faces, thrown, unreadable }));
process.exit(thrown || unreadable ? 1 : 0);
