/* The difficulty ladder, measured: many bot-vs-bot games split across
   several node processes, with the results added up.

   node tools/ladder.js --format standard --pairs 1-5,5-10,4-5 --games 60 [--procs 6] [--mode full|skill|deck] [--seed 1]
   node tools/ladder.js --format commander --ds 2,4,6,9 --games 24 --procs 6

   --mode full   each seat builds and plays at its own difficulty (default)
   --mode skill  both seats play the very same deck (built at --deckd, 5 by
                 default); only how they play differs
   --mode deck   both seats play at --playd (5 by default); only the decks differ
   --dump f.json writes every game's result, for digging into afterwards.
   Anything else (--turns, --speed) is passed through to botsim.js.

   Prints a table: games, wins each side, the win rate of the higher
   difficulty with a rough 95% interval, average turns, and every stall,
   crash, nudge and warning seen. */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

function args() {
  const a = { format: 'standard', pairs: '1-5,5-10', games: 40, procs: Math.max(2, Math.min(8, os.cpus().length - 1)),
    mode: 'full', seed: 1, ds: null, deckd: 5, playd: 5, dump: null, extra: [] };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (['format', 'pairs', 'games', 'procs', 'mode', 'seed', 'ds', 'deckd', 'playd', 'dump'].includes(k)) {
      const val = v[++i];
      a[k] = isNaN(Number(val)) ? val : Number(val);
    } else {
      a.extra.push(v[i]);
      if (v[i + 1] && !/^--/.test(v[i + 1])) a.extra.push(v[++i]);
    }
  }
  return a;
}

function runChunk(argv) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'botsim.js')].concat(argv, ['--json']), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    /* A game that never yields (a loop somewhere in the engine or a bot)
       would hold the whole run up; a worker that overstays is killed and
       reported with the arguments that reproduce it. */
    const games = +(argv[argv.indexOf('--games') + 1] || 10);
    const timer = setTimeout(() => { err = 'timed out (hung?): node tools/botsim.js ' + argv.join(' '); p.kill(); }, 60000 + games * 30000);
    p.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').reverse().find(l => l.startsWith('{"summary"'));
      if (!line) { resolve({ results: [], failure: (err || out).slice(-600) }); return; }
      try { resolve(JSON.parse(line)); } catch (e) { resolve({ results: [], failure: String(e) }); }
    });
  });
}

/** Run `games` games of one matchup over the worker processes. */
async function runMatch(a, base, games, slots) {
  const per = Math.ceil(games / slots);
  const jobs = [];
  for (let k = 0; k < slots && k * per < games; k++) {
    const n = Math.min(per, games - k * per);
    // seeds stay distinct across chunks; an even chunk size keeps the seat alternation honest
    jobs.push(runChunk(base.concat(['--games', String(n), '--seed', String(a.seed + k * 1000)])));
  }
  const parts = await Promise.all(jobs);
  const results = [].concat(...parts.map(p => p.results || []));
  const failures = parts.filter(p => p.failure).map(p => p.failure);
  return { results, failures };
}

function interval(w, n) {
  if (!n) return '-';
  const p = w / n;
  const se = Math.sqrt(p * (1 - p) / n);
  return `${(100 * p).toFixed(0)}% ±${(196 * se).toFixed(0)}`;
}

async function main() {
  const a = args();
  const modeArgs = a.mode === 'skill' ? ['--mirror', '--deckd', String(a.deckd)] : a.mode === 'deck' ? ['--playd', String(a.playd)] : [];
  const rows = [];
  const t0 = Date.now();
  if (a.ds) {
    const base = ['--format', a.format, '--ds', String(a.ds)].concat(modeArgs, a.extra);
    const { results, failures } = await runMatch(a, base, a.games, a.procs);
    const ds = String(a.ds).split(',').map(Number);
    const wins = {};
    for (const d of ds) wins[d] = results.filter(r => r.winnerDiff === d).length;
    rows.push({ label: `ffa ${a.ds}`, results, failures, wins });
    console.log(`\n${a.format} free-for-all ${a.ds} (${a.mode}), ${results.length} games`);
    for (const d of ds) console.log(`  d${d}: ${wins[d]} wins (${interval(wins[d], results.length)})`);
  } else {
    for (const pair of String(a.pairs).split(',')) {
      const [lo, hi] = pair.split('-').map(Number);
      const base = ['--format', a.format, '--a', String(lo), '--b', String(hi)].concat(modeArgs, a.extra);
      const { results, failures } = await runMatch(a, base, a.games, a.procs);
      // the same level on both sides (an experiment with --tuneA/--tuneB): count by side, b as "high"
      const wHi = lo === hi ? results.filter(r => r.winnerSide === 'b').length : results.filter(r => r.winnerDiff === hi).length;
      const wLo = lo === hi ? results.filter(r => r.winnerSide === 'a').length : results.filter(r => r.winnerDiff === lo).length;
      rows.push({ label: `d${lo} v d${hi}`, results, failures, wHi, wLo });
      console.log(`d${hi} vs d${lo} (${a.mode}): ${wHi}-${wLo} of ${results.length}, d${hi} wins ${interval(wHi, wHi + wLo)}`);
    }
  }
  console.log(`\n| matchup | games | wins (high-low) | high wins | avg turns | stalls | crashes | nudges | games with warnings |`);
  console.log(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    const res = r.results;
    const turns = res.length ? (res.reduce((s, x) => s + x.turns, 0) / res.length).toFixed(1) : '-';
    const w = r.wins ? Object.entries(r.wins).map(([d, n]) => `d${d}:${n}`).join(' ') : `${r.wHi}-${r.wLo}`;
    const rate = r.wins ? '-' : interval(r.wHi, r.wHi + r.wLo);
    console.log(`| ${r.label} | ${res.length} | ${w} | ${rate} | ${turns} | ${res.filter(x => x.stalled).length} | ${res.filter(x => x.crashed).length} | ` +
      `${res.reduce((s, x) => s + (x.nudges || 0), 0)} | ${res.filter(x => (x.errors || []).length).length} |`);
  }
  // how the seats that look ahead spent their time
  const { lookSummary } = require('./botsim');
  for (const r of rows) {
    const by = lookSummary(r.results);
    for (const [d, t] of Object.entries(by)) {
      console.log(`look ${r.label} ${d}: ${t.perGame} a game, ${t.meanMs} ms mean, ${t.max} ms worst, ` +
        `${t.rolloutMs} ms a copy, ${t.overruledPct}% overruled`);
    }
  }
  const problems = [];
  for (const r of rows) {
    for (const f of r.failures) problems.push(`${r.label}: worker failed: ${f}`);
    for (const x of r.results) {
      if (x.stalled) problems.push(`${r.label} seed ${x.seed}: stalled ${JSON.stringify(x.stuckAt)}`);
      if (x.crashed) problems.push(`${r.label} seed ${x.seed}: crashed ${x.crashed}`);
      for (const e of (x.errors || []).slice(0, 2)) problems.push(`${r.label} seed ${x.seed}: ${e.slice(0, 240)}`);
    }
  }
  if (problems.length) {
    console.log(`\nproblems (${problems.length}):`);
    for (const p of problems.slice(0, 40)) console.log('  ' + p);
  }
  if (a.dump) require('fs').writeFileSync(a.dump, JSON.stringify(rows.map(r => ({ label: r.label, results: r.results }))));
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
