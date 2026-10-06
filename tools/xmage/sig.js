/* Print the constructors of XMage framework classes: node tools/xmage/sig.js Name [Name...] */
'use strict';
const fw = require('./framework');
const { parseJava } = require('./java');
for (const name of process.argv.slice(2)) {
  const src = fw.sourceOf(name);
  if (!src) { console.log(name + ': (not found)'); continue; }
  const unit = parseJava(src);
  const find = (ts) => { for (const t of ts) { if (t.name === name) return t; const x = find(t.types || []); if (x) return x; } return null; };
  const t = find(unit.types);
  const e = fw.load()[name];
  console.log(`${name} extends ${e.ext || '-'}`);
  for (const c of t.ctors) {
    if (c.params.length === 1 && c.params[0].type.name === name) continue;
    if (c.mods.includes('private') || c.mods.includes('protected')) continue;
    const lines = src.split('\n');
    // the first line of the body, which usually shows the defaults
    const body = lines.slice(c.line - 1, Math.min(c.endLine, c.line + 2)).map(s => s.trim()).join(' ').slice(0, 160);
    console.log('  (' + c.params.map(p => p.type.name + ' ' + p.name).join(', ') + ')  ' + body);
  }
}
