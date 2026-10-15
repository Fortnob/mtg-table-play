/* New cards: what the table can do with cards nobody wrote anything for.

   node tools/newcards.js [--show 30] [--format all|standard|...]

   A card with no translated row of its own (src/19-cardlib.js) and no
   hand-written script (src/18-scripts.js) is read from its words alone.
   Where those words are exactly the words of a card that does have a
   translation or a script (the same line, or the same card under another
   name), it borrows that card's reading. This lists those cards, how many
   are fully automated, and how many of those only thanks to borrowing.
   The last line ("summary {...}") is for tools/check.py. */
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
console.warn = warn;

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const fmt = arg('format', 'all');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (['token', 'art_series', 'emblem', 'double_faced_token'].includes(c.layout)) continue;
  // the joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes)
  if (c.set_type === 'memorabilia' || MTG.jokes.isCard(c)) continue;
  const leg = c.legalities || {};
  if (fmt === 'all' ? !Object.values(leg).some(v => v === 'legal' || v === 'restricted') : !(leg[fmt] === 'legal' || leg[fmt] === 'restricted')) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

let fresh = 0, auto = 0, borrowedAuto = 0, borrowedAny = 0;
const examples = [];
for (const c of pool) {
  const key = MTG.scripts.keyFor(c.name);
  if (MTG.scripts.scriptFor(c.name)) continue;
  if (MTG.cardlib.generatedFor(key)) continue;
  fresh++;
  let a;
  try { a = MTG.oracle.analyze(MTG.scry.slim(c)); } catch (e) { continue; }
  if (!a) continue;
  if (a.borrowedFrom) borrowedAny++;
  if (!a.fullyAutomated) continue;
  auto++;
  if (a.borrowedFrom) {
    borrowedAuto++;
    if (examples.length < +arg('show', 30)) examples.push(`  #${c.edhrec_rank || '-'} ${c.name}  <-  ${a.borrowedFrom}${(a.borrowedLines || []).length ? ' (' + a.borrowedLines.length + ' line' + (a.borrowedLines.length === 1 ? '' : 's') + ')' : ' (whole card)'}`);
  }
}
console.log(`cards with no translated row and no script: ${fresh}`);
console.log(`  fully automated: ${auto} (${fresh ? (100 * auto / fresh).toFixed(1) : 0}%)`);
console.log(`  borrowing another card's reading: ${borrowedAny}, of which fully automated thanks to it: ${borrowedAuto}`);
if (examples.length) console.log('examples:\n' + examples.join('\n'));
console.log('summary ' + JSON.stringify({ fresh, auto, borrowedAny, borrowedAuto }));
