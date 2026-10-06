/* Which XMage classes the card constructors use, and how often.
   node tools/xmage/census.js [--only-missing base/all.json] */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCard } = require('./model');
const ROOT = path.join(__dirname, '..', '..', 'vendor', 'xmage', 'Mage.Sets', 'src', 'mage', 'cards');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : null; };
const onlyFile = arg('only-missing');
const flat = n => n.split(' // ')[0].replace(/['\u2019]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
let want = null;
if (onlyFile) { want = new Map(); for (const r of JSON.parse(fs.readFileSync(onlyFile, 'utf8'))) want.set(flat(r.name), r.rank); }
const counts = new Map();
const bump = (k, w) => counts.set(k, (counts.get(k) || 0) + w);
let n = 0;
for (const d of fs.readdirSync(ROOT)) for (const f of fs.readdirSync(path.join(ROOT, d))) {
  const key = f.replace(/\.java$/, '').toLowerCase();
  if (want && !want.has(key)) continue;
  const rank = want ? want.get(key) : 1e6;
  const w = rank <= 2000 ? 10 : rank <= 10000 ? 3 : 1;
  let m; try { m = loadCard(path.join(ROOT, d, f)); } catch (e) { continue; }
  n++;
  const seen = new Set();
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v.t === 'obj') { seen.add(v.custom ? '(custom)' : v.cls); v.args.forEach(visit); v.calls.forEach(c => c.args.forEach(visit)); return; }
    if (v.t === 'array') v.items.forEach(visit);
    if (v.t === 'ref') seen.add('@' + v.path.replace(/\.[^.]*$/, '') );
  };
  for (const a of m.abilities) visit(a.obj);
  if (m.spell) visit(m.spell);
  for (const fc of Object.values(m.faces)) { for (const a of fc.abilities) visit(a.obj); if (fc.spell) visit(fc.spell); }
  for (const s of seen) bump(s, w);
}
console.log('cards', n);
for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, +(arg('top') || 300))) console.log(v, k);
