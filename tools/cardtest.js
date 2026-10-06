/* Behaviour tests for card automation.

   node tools/cardtest.js [filter]

   Each test sets a small game up (tools/harness.js), plays one card, and
   checks what actually happened: life totals, zones, counters, tokens,
   tapped permanents. A card the parser calls automated has to do what
   its text says, not merely get through without asking for help, and
   these are where that is checked. Tests live in tools/cardtests/. */
'use strict';
const fs = require('fs');
const path = require('path');
const { Table, card, engine, contractReport } = require('./harness');

const filter = (process.argv[2] || '').toLowerCase();
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

class Fail extends Error {}
function asserts(T) {
  const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  return {
    eq(a, b, msg) { if (a !== b) throw new Fail(`${msg || 'expected equal'}: got ${show(a)}, wanted ${show(b)}`); },
    ok(c, msg) { if (!c) throw new Fail(msg || 'expected true'); },
    no(c, msg) { if (c) throw new Fail(msg || 'expected false'); },
    zone(o, z, msg) { if (o.zone !== z) throw new Fail(`${msg || o.name}: in ${o.zone}, wanted ${z}`); },
    auto(name) {
      const a = engine().oracle.analyze(card(name));
      if (!a.fullyAutomated) {
        const left = a.abilities.filter(x => !x.auto && x.kind !== 'castModifier').map(x => x.text);
        throw new Fail(`${name} is not fully automated: ${left.join(' | ')}`);
      }
    },
  };
}

const dir = path.join(__dirname, 'cardtests');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
  require(path.join(dir, f))(test);
}

// load the engine and the card pool before anything is timed or watched
const origWarn = console.warn;
console.warn = () => {};
engine();
card('Island');
console.warn = origWarn;

let pass = 0, fail = 0;
for (const t of tests) {
  if (filter && !t.name.toLowerCase().includes(filter)) continue;
  const warnings = [];
  console.warn = (...x) => warnings.push(x.map(String).join(' '));
  let err = null, T = null;
  Table.label = t.name;
  try {
    const mk = (opts) => (T = new Table(opts));
    t.fn(mk, asserts());
    if (T) {
      const manual = T.manualLines();
      if (manual.length) throw new Fail('fell through to manual: ' + manual.join(' / '));
    }
    if (warnings.length) throw new Fail('engine warnings: ' + warnings.slice(0, 3).join(' / '));
  } catch (e) { err = e; }
  console.warn = origWarn;
  if (err) {
    fail++;
    console.log(`FAIL ${t.name}\n     ${err instanceof Fail ? err.message : (err.stack || err).toString().split('\n').slice(0, 4).join('\n     ')}`);
  } else { pass++; if (process.env.VERBOSE) console.log(`ok   ${t.name}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
// with CONTRACTS=1, what the tables showed and asked was checked as well
const rep = contractReport();
if (rep) {
  for (const v of rep.violations.concat(rep.known)) console.log('  ' + rep.format(v));
  console.log(`contracts: ${rep.violations.length} violations, ${rep.known.length} known`);
}
process.exit(fail || (rep && rep.violations.length) ? 1 : 0);
