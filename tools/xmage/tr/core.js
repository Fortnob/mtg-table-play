/* The translator's shared machinery: how a value from the card model is
   classified, the registry of per-class translators, and the error that
   says "this class has no translation yet" (which is what the blockers
   report counts). */
'use strict';
const fw = require('../framework');

class Blocked extends Error {
  constructor(what, why) {
    super(what + (why ? ' (' + why + ')' : ''));
    this.what = what;
    this.why = why || null;
  }
}

/** Refuse: `what` is the XMage construct with no translation. */
function block(what, why) { throw new Blocked(what, why); }

/* One registry per family. A translator is (obj, tc) => engine JSON. */
const REG = { effect: new Map(), ability: new Map(), target: new Map(), filter: new Map(), predicate: new Map(),
  cost: new Map(), condition: new Map(), value: new Map(), token: new Map(), keyword: new Map() };

function def(kind, names, fn) {
  for (const n of [].concat(names)) REG[kind].set(n, fn);
}

/** The broad kind of a value: what a translator expects to find in an argument slot. */
function kindOf(v) {
  if (!v) return 'null';
  switch (v.t) {
    case 'lit':
      if (v.v === null) return 'null';
      if (typeof v.v === 'number') return 'int';
      if (typeof v.v === 'boolean') return 'bool';
      if (typeof v.v === 'string') return 'str';
      return 'lit';
    case 'ref': {
      const head = v.path.split('.')[0];
      if (head === 'StaticFilters') return 'filter';
      const fam = fw.family(head);
      if (fam) return fam;
      return 'enum:' + head;
    }
    case 'obj': {
      if (v.custom) return 'custom';
      if (v.staticCall) {
        if (/^StaticValue\.get$/.test(v.cls)) return 'value';
        if (/^CounterType\.\w+\.createInstance$/.test(v.cls)) return 'counter';
        if (/\.getPredicate$|^Predicates\.|getControllerPredicate$|getOwnerPredicate$/.test(v.cls)) return 'predicate';
        const head = v.cls.split('.')[0];
        const fam = fw.family(head);
        return fam || 'call:' + v.cls;
      }
      if (v.cls === 'FilterCopy') return 'filter';
      if (v.cls === 'MageInt') return 'mageint';
      if (/Counter$/.test(v.cls) && fw.isA(v.cls, 'Counter')) return 'counter';
      return fw.family(v.cls) || 'class:' + v.cls;
    }
    case 'array': return 'array';
    default: return v.t;
  }
}

/** Arguments by kind: A(o).first('effect'), A(o).int(1) (the second int), A(o).all('bool'). */
function A(o) {
  const args = (o && o.args) || [];
  const of = (k) => args.filter(a => {
    const t = kindOf(a);
    return k.split('|').some(x => x === t || (x === 'value' && t === 'int'));
  });
  return {
    args,
    first: (k) => of(k)[0],
    nth: (k, i) => of(k)[i],
    all: of,
    has: (k) => of(k).length > 0,
    int: (i) => { const x = of('int')[i || 0]; return x ? x.v : undefined; },
    bool: (i, d) => { const x = of('bool')[i || 0]; return x ? x.v : d; },
    str: (i) => { const x = of('str')[i || 0]; return x ? x.v : undefined; },
    enumv: (name) => { const x = args.find(a => a && a.t === 'ref' && a.path.split('.')[0] === name); return x ? x.path.split('.').slice(1).join('.') : undefined; },
    count: () => args.length,
  };
}

/** Calls made on an object, by name. */
function calls(o, name) { return ((o && o.calls) || []).filter(c => c.name === name); }

/** A literal's value, or refuse. */
function litOf(v, what) {
  if (v && v.t === 'lit') return v.v;
  block(what || 'non-literal');
}

/** The class name a translator is looked up by. */
function keyOf(v) {
  if (!v) return 'null';
  if (v.t === 'ref') return v.path;
  if (v.t === 'obj') return v.cls;
  return v.t;
}

/** Translate one value of a family, or refuse with the class that has no translator. */
function tr(kind, v, tc, extra) {
  if (!v) block(kind + ':missing');
  /* A class the card's own file writes is refused, unless one has been
     translated by hand for it (tr/custom.js), keyed by its name. */
  if (v.t === 'obj' && v.custom) {
    const own = REG[kind].get('custom:' + v.cls);
    if (own) return own(v, tc, extra);
    block('custom ' + (fw.family(customBase(v, tc)) || kind), v.cls);
  }
  if (v.t === 'ref' && tc && tc.model && (tc.model.customDecls || []).some(d => d.name === v.path.split('.')[0])) {
    const own = REG[kind].get('custom:' + v.path);
    if (own) return own(v, tc, extra);
    block('custom ' + kind, v.path);
  }
  if (v.t === 'obj' && v.anon) block('anonymous ' + v.cls);
  // a bare constant nothing could resolve would be silently ignored by an argument search
  if (v.t === 'obj') for (const a of v.args) {
    if (a && a.t === 'ref' && /^[A-Z][A-Z0-9_]+$/.test(a.path.split('.')[0]) && !a.path.includes('.')) block('unresolved name ' + a.path);
  }
  const key = keyOf(v);
  let fn = REG[kind].get(key);
  // an enum value: Foo.BAR is translated by Foo's translator unless BAR has its own
  if (!fn && v.t === 'ref') fn = REG[kind].get(v.path.split('.')[0] + '.*');
  if (!fn && v.t === 'obj' && v.staticCall) fn = REG[kind].get(v.cls.replace(/^\w+\.\w+\./, '*.'));
  if (!fn) block(key);
  return fn(v, tc, extra);
}

/** The framework class a card's own class extends, for naming custom blockers by family. */
function customBase(v, tc) {
  const d = (tc && tc.model && tc.model.customDecls || []).find(x => x.name === v.cls);
  if (!d) return v.cls;
  let base = d.ext || (d.impl || [])[0] || null;
  return base ? base.split('.').pop() : v.cls;
}

function has(kind, key) { return REG[kind].has(key); }

module.exports = { Blocked, block, REG, def, kindOf, A, calls, litOf, keyOf, tr, has, customBase };
