/* How much of the card pool the engine runs without a person stepping in.

   node tools/coverage.js [--format standard|pioneer|modern|commander|pauper|all] [--top 2000] [--out file.json]

   Reads Scryfall's oracle-cards bulk file (tools/oracle-cards.jsonl.gz), runs
   every card through the same analysis the game uses, and reports the share
   that is fully automated - overall, and for the most-played cards (by EDHREC
   rank), which are the ones that actually turn up at a table. --out writes
   the cards that are not, with the lines that fell through. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

function args() {
  const a = { format: 'all', top: 2000, out: null, show: 25 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

function readPool(MTG) {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem' || c.layout === 'double_faced_token') continue;
    if (/\b(Card|Scheme|Plane|Phenomenon|Vanguard|Conspiracy|Dungeon)\b/.test(c.type_line || '') &&
        !/Creature|Instant|Sorcery|Artifact|Enchantment|Land|Planeswalker|Battle/.test(c.type_line || '')) continue;
    // the joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes)
    if (c.set_type === 'memorabilia' || MTG.jokes.isCard(c)) continue;
    out.push(c);
  }
  return out;
}

function main() {
  const a = args();
  const MTG = load();
  const pool = readPool(MTG);
  const legal = (c) => a.format === 'all' ? Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')
    : (c.legalities || {})[a.format] === 'legal' || (c.legalities || {})[a.format] === 'restricted';
  const cards = pool.filter(legal);
  const rows = [];
  let errors = 0;
  for (const raw of cards) {
    const c = MTG.scry.slim(raw);
    let an;
    try { an = MTG.oracle.analyze(c); } catch (e) { errors++; rows.push({ name: c.name, rank: raw.edhrec_rank || 999999, auto: false, error: String(e.message || e) }); continue; }
    if (!an) continue;
    const manual = (an.abilities || []).filter(x => !x.auto && x.kind !== 'castModifier').map(x => x.text || x.raw || JSON.stringify(x).slice(0, 160));
    rows.push({ name: c.name, rank: raw.edhrec_rank || 999999, auto: !!an.fullyAutomated, coverage: an.autoCoverage, manual, land: !!an.isLand, scripted: !!an.scripted, generated: !!an.generated });
  }
  rows.sort((x, y) => x.rank - y.rank);
  const pct = (list) => list.length ? (100 * list.filter(r => r.auto).length / list.length).toFixed(1) + '%' : '-';
  const top = rows.slice(0, a.top);
  console.log(`format=${a.format} cards=${rows.length} analyseErrors=${errors}`);
  console.log(`fully automated: all ${pct(rows)} | top ${a.top} ${pct(top)} | top 500 ${pct(rows.slice(0, 500))} | top 200 ${pct(rows.slice(0, 200))}`);
  const missing = top.filter(r => !r.auto);
  console.log(`\nmost-played cards that still need a person (${missing.length} in the top ${a.top}):`);
  for (const r of missing.slice(0, a.show)) console.log(`  #${r.rank} ${r.name}: ${(r.error ? 'ERROR ' + r.error : r.manual.join(' | ')).slice(0, 220)}`);
  if (a.out) {
    fs.writeFileSync(a.out, JSON.stringify(rows.filter(r => !r.auto), null, 1));
    console.log(`\nwrote ${a.out}`);
  }
  process.exit(0);
}

main();
