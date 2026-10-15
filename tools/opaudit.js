/* Which effect ops do automated cards use that the engine never runs?

   node tools/opaudit.js [--top=3000]

   A card counts as automated when every line parsed. That says nothing
   about whether the engine knows what to do with what the parser made,
   so this walks every effect of every automated card and reports the ops
   the engine has no case for, with the most-played cards using each. An op
   counts as known when _runEffect has a case for it, or when the engine
   reads it as a standing rule somewhere else. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

const top = Number((process.argv.find(a => /^--top=/.test(a)) || '--top=100000').split('=')[1]);
process.env.OFFLINE = '1';
const origWarn = console.warn; console.warn = () => {};
const MTG = load();
console.warn = origWarn;
const rules = fs.readFileSync(path.join(__dirname, '..', 'src', '06-rules.js'), 'utf8');
const known = new Set();
const runnable = new Set();
for (const m of rules.matchAll(/case '(\w+)'/g)) { known.add(m[1]); runnable.add(m[1]); }
for (const m of rules.matchAll(/\b(?:ef|e|x)\.op === '(\w+)'/g)) known.add(m[1]);
for (const m of rules.matchAll(/_staticOp\([^,]+, '(\w+)'\)/g)) known.add(m[1]);
for (const m of rules.matchAll(/_anyStatic(?:Of)?\([^)]*'(\w+)'\)/g)) known.add(m[1]);

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem') continue;
  // the joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes)
  if (c.set_type === 'memorabilia' || MTG.jokes.isCard(c)) continue;
  if (!Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

const missing = new Map();
function walk(effects, name, run) {
  for (const e of effects || []) {
    if (!e || typeof e !== 'object') continue;
    if (e.op && !(run ? runnable : known).has(e.op)) {
      if (!missing.has(e.op)) missing.set(e.op, []);
      const list = missing.get(e.op);
      if (!list.includes(name)) list.push(name);
    }
    for (const k of ['then', 'otherwise', 'list', 'effects']) if (Array.isArray(e[k])) walk(e[k], name, run);
    // a mana ability handed out by a static one is run, like a printed one
    for (const g of e.grantMana || []) walk(g.effects, name, true);
    if (Array.isArray(e.modes)) for (const m of e.modes) walk(m.effects, name, run);
  }
}
let n = 0;
for (const raw2 of pool.slice(0, top)) {
  let a; try { a = MTG.oracle.analyze(MTG.scry.slim(raw2)); } catch (e) { continue; }
  if (!a || !a.fullyAutomated) continue;
  n++;
  // a static ability is read where it matters; anything else is run, and needs a case
  for (const ab of a.abilities.concat(a.manaAbilities)) walk(ab.effects, raw2.name, ab.kind !== 'static' && ab.kind !== 'castModifier');
  if (a.overloadEffects) walk(a.overloadEffects, raw2.name, true);
  if (a.channel) walk(a.channel.effects, raw2.name, true);
}
console.log(`${n} automated cards checked`);
for (const [op, list] of [...missing].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`${op}: ${list.length} — ${list.slice(0, 8).join('; ')}`);
}
