/* An index of XMage's framework classes: where each lives and what it
   extends, so the translator can ask "is this an effect, a cost, a target?"
   without being told class by class. Built once from the sources and kept
   in tools/.cache/xmage-framework.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseJava } = require('./java');

const FW = path.join(__dirname, '..', '..', 'vendor', 'xmage', 'Mage', 'src', 'main', 'java', 'mage');
const CACHE = path.join(__dirname, '..', '.cache', 'xmage-framework.json');

let index = null;

function build() {
  const out = {};
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!f.name.endsWith('.java')) continue;
      let unit;
      try { unit = parseJava(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
      const rel = path.relative(FW, p).replace(/\\/g, '/');
      const add = (t, outer) => {
        const name = outer ? outer + '.' + t.name : t.name;
        out[t.name] = out[t.name] || {
          file: rel, kind: t.kind, ext: t.ext ? t.ext.name.split('.').pop() : null,
          impl: (t.impl || []).map(x => x.name.split('.').pop()), pkg: unit.pkg, nested: !!outer,
          enumConsts: t.kind === 'enum' ? t.enumConsts.map(c => c.name) : undefined,
        };
        for (const n of t.types || []) add(n, name);
      };
      for (const t of unit.types) add(t, null);
    }
  };
  walk(FW);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

function load() {
  if (index) return index;
  if (fs.existsSync(CACHE)) index = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  else index = build();
  return index;
}

/** Every class and interface `name` extends or implements, nearest first. */
function ancestors(name) {
  const idx = load();
  const out = [];
  const seen = new Set();
  const queue = [name];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    if (n !== name) out.push(n);
    const e = idx[n];
    if (!e) continue;
    if (e.ext) queue.push(e.ext);
    for (const i of e.impl) queue.push(i);
  }
  return out;
}

function isA(name, base) {
  if (name === base) return true;
  return ancestors(name).includes(base);
}

/** The broad family a class belongs to. */
function family(name) {
  const a = [name].concat(ancestors(name));
  const has = (x) => a.includes(x);
  if (has('Token')) return 'token';
  if (has('Mode')) return 'mode';
  if (has('Target')) return 'target';
  if (has('Filter')) return 'filter';
  if (has('Predicate') || has('ObjectSourcePlayerPredicate')) return 'predicate';
  if (has('Condition')) return 'condition';
  if (has('DynamicValue')) return 'value';
  if (has('ManaCost') || has('ManaCosts')) return 'manaCost';
  if (has('Cost') || has('Costs')) return 'cost';
  if (has('Effect')) return 'effect';
  if (has('Ability')) return 'ability';
  if (has('Hint')) return 'hint';
  if (has('Watcher')) return 'watcher';
  return null;
}

/** The source of a framework class, for reading its constructors. */
function sourceOf(name) {
  const e = load()[name];
  if (!e) return null;
  return fs.readFileSync(path.join(FW, e.file), 'utf8');
}

module.exports = { load, build, ancestors, isA, family, sourceOf, FW };
