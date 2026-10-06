/* Play every automated card once, headless, and report the ones that throw,
   warn, or fall through to "resolve this by hand".

   node tools/smoke.js [--from 0] [--to 1000] [--name "Card Name"] [--generated]

   Each card gets a fresh table with a few creatures, artifacts and lands on
   both sides and cards in every zone, so most targets have something to
   point at. Spells are cast with the first legal targets, permanents are
   put onto the battlefield (as they would enter), and each activated
   ability is tried once. Then a turn goes by, so upkeep and end-step
   triggers run as well. This does not check that a card does the right
   thing (tools/cardtest.js does that); it checks that the engine can run
   it without breaking. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Table, engine, contractReport } = require('./harness');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const from = +arg('from', 0), to = +arg('to', 1000), only = arg('name', null);

const MTG = engine();
const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem') continue;
  if (c.set_type === 'funny' || c.set_type === 'memorabilia') continue;
  if (!Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

/** The first legal choice for each target spec, as the engine sees it. */
function pickTargets(g, specs, pid) {
  const out = [];
  for (const spec of specs || []) {
    const opts = g._legalTargetsFor(spec, pid).filter(t => !out.some(x => x.kind === t.kind && x.id === t.id));
    // the opponent's things first, so removal does not eat our own table
    const pick = opts.find(t => (t.kind === 'player' && t.id === 'B') || (t.kind === 'object' && g.obj(t.id) && g.obj(t.id).controller === 'B')) || opts[0];
    if (pick) out.push({ kind: pick.kind, id: pick.id });
  }
  return out;
}

function setup(T) {
  for (const pid of ['A', 'B']) {
    T.bf(pid, 'Grizzly Bears'); T.bf(pid, 'Craw Wurm'); T.bf(pid, 'Sol Ring'); T.bf(pid, 'Glorious Anthem');
    T.bf(pid, 'Forest'); T.bf(pid, 'Island'); T.bf(pid, 'Swamp');
    T.grave(pid, 'Llanowar Elves'); T.grave(pid, 'Lightning Bolt'); T.grave(pid, 'Mountain');
    T.hand(pid, 'Shock'); T.hand(pid, 'Plains'); T.hand(pid, 'Elvish Visionary');
    for (let i = 0; i < 6; i++) T.top(pid, i % 2 ? 'Divination' : 'Hill Giant');
  }
}

const failures = [];
let tried = 0, cast = 0, activated = 0;
/* --generated: every card that leans on a translated line from 19-cardlib.js,
   wherever it ranks */
const genOnly = process.argv.includes('--generated');
const list = only ? pool.filter(c => c.name.toLowerCase() === only.toLowerCase())
  : genOnly ? pool.filter(c => { try { const a = MTG.oracle.analyze(MTG.scry.slim(c)); return !!(a && a.generated); } catch (e) { return false; } })
  : pool.slice(from, to);
for (const c of list) {
  let a;
  try { a = MTG.oracle.analyze(MTG.scry.slim(c)); } catch (e) { continue; }
  if (!a || !a.fullyAutomated) continue;
  tried++;
  const warns = [];
  const w0 = console.warn;
  console.warn = (...x) => warns.push(x.map(String).join(' '));
  let err = null;
  let T = null;
  Table.label = c.name;
  try {
    T = new Table();
    setup(T);
    const g = T.g;
    T.mana('A', 'WWUUBBRRGG8');
    if (a.isLand) {
      const o = T.hand('A', c.name);
      g.playLand('A', o.id);
      T.resolve();
    } else if (!a.isPermanent) {
      const o = T.hand('A', c.name);
      const specs = [];
      for (const ab of a.abilities) if (ab.kind === 'spell') for (const e of ab.effects || []) specs.push(...(e.targets || []));
      const targets = pickTargets(g, specs, 'A');
      if (g.castSpell('A', o.id, { auto: true, targets, x: 2 })) { cast++; T.resolve(); }
    } else {
      const o = T.hand('A', c.name);
      const specs = (a.auraSpec ? [a.auraSpec] : []);
      const targets = pickTargets(g, specs, 'A');
      if (g.castSpell('A', o.id, { auto: true, targets, x: 2 })) { cast++; T.resolve(); }
    }
    /* every ability of whatever is now on the battlefield, once each (the
       index is the engine's: mana abilities first, then the others) */
    const o2 = g.battlefield.find(x => x.card && x.card.name === c.name && x.controller === 'A');
    if (o2 && !g.over) {
      o2.summoningSick = false;
      const oa = o2.analysis();
      const all = oa.manaAbilities.concat(oa.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
      all.forEach((ab, i) => {
        if (o2.zone !== 'battlefield' || g.over) return;
        T.mana('A', 'WUBRG5');
        o2.tapped = false;
        o2.activatedLoyaltyThisTurn = false;
        const t2 = pickTargets(g, (ab.effects || []).flatMap(e => e.targets || []), 'A');
        if (g.activateAbility('A', o2.id, i, { auto: true, targets: t2, x: 1 })) { activated++; T.resolve(); }
      });
    }
    if (!g.over) T.nextTurn('B');
    if (!g.over) T.nextTurn('A');
  } catch (e) {
    err = e;
  }
  console.warn = w0;
  const manual = T ? T.manualLines() : [];
  if (err || warns.length || manual.length) {
    failures.push({ name: c.name, rank: c.edhrec_rank, err: err ? String(err.stack || err).split('\n').slice(0, 3).join(' | ') : null,
      warns: warns.slice(0, 2), manual: manual.slice(0, 2) });
  }
}
for (const f of failures) {
  console.log(`#${f.rank} ${f.name}`);
  if (f.err) console.log('   error: ' + f.err.slice(0, 400));
  for (const w of f.warns) console.log('   warn: ' + w.slice(0, 300));
  for (const m of f.manual) console.log('   manual: ' + m.slice(0, 200));
}
console.log(`${tried} automated cards played (${cast} cast, ${activated} abilities activated), ${failures.length} with problems`);
// with CONTRACTS=1, every view and question along the way was checked as well
const rep = contractReport();
if (rep) {
  for (const v of rep.violations.concat(rep.known)) console.log('  ' + rep.format(v));
  console.log(`contracts: ${rep.violations.length} violations, ${rep.known.length} known`);
}
