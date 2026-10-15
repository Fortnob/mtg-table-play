/* The lines the parser could not read, most common first.

   node tools/misses.js [--top 2000] [--format all] [--sentences]

   Groups the unread lines of the most-played cards by shape (numbers, names
   and costs folded together) so the next rule to write is the one that
   fixes the most cards. With --sentences, single sentences are counted
   instead of whole lines. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const top = +arg('top', 2000), fmt = arg('format', 'all'), bySentence = process.argv.includes('--sentences');
const show = +arg('show', 80);
process.env.OFFLINE = '1';
const w = console.warn; console.warn = () => {};
const MTG = load();
console.warn = w;

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem') continue;
  // the joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes)
  if (c.set_type === 'memorabilia' || MTG.jokes.isCard(c)) continue;
  const legal = (v) => v === 'legal' || v === 'restricted';
  if (fmt === 'all' ? !Object.values(c.legalities || {}).some(legal) : !legal((c.legalities || {})[fmt])) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

const shape = (t) => String(t).replace(/\{[^}]+\}/g, '{c}').replace(/\b\d+\b/g, 'N')
  .replace(/\b(one|two|three|four|five|six|seven)\b/g, 'N').replace(/\s+/g, ' ').trim();
const groups = new Map();
let cards = 0;
for (const c of pool.slice(0, top)) {
  let a;
  try { a = MTG.oracle.analyze(MTG.scry.slim(c)); } catch (e) { continue; }
  if (a.fullyAutomated) continue;
  cards++;
  const lines = a.abilities.filter(x => !x.auto).map(x => x.text || '');
  for (const l of lines) {
    const parts = bySentence ? MTG.oracle.splitSentences(MTG.oracle.stripReminder(l)) : [l];
    for (const p of parts) {
      // a sentence that reads fine on its own is not what is missing
      if (bySentence && parts.length > 1) {
        const body = p.replace(/^[^:]*\{[^}]*\}[^:]*:\s*/, '');
        const e = MTG.oracle.parseEffectSentence(body);
        if (e && e.op !== 'manual') continue;
      }
      const k = shape(p);
      if (!groups.has(k)) groups.set(k, []);
      const g = groups.get(k);
      if (!g.includes(c.name)) g.push(c.name);
    }
  }
}
console.log(`${cards} cards not fully automated in the top ${top}`);
for (const [k, names] of [...groups].sort((x, y) => y[1].length - x[1].length).slice(0, show)) {
  console.log(`${String(names.length).padStart(3)}  ${k.slice(0, 150)}   [${names.slice(0, 3).join('; ')}]`);
}
