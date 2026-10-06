/* Replays must come out the same as the games they record.

   node tools/replaytest.js [--games 25] [--players 2] [--format standard] [--seed 1] [--turns 40]

   Each game is a bot-vs-bot sim (tools/sim.js) with a recorder on it from
   the first action. When it is over the recording is written out as JSON,
   read back in as a stranger would read it (Scryfall printings by id
   only, looked up again), and played back on a fresh Game. Every seat's
   view of the final position — and the full snapshot — has to match the
   original exactly. A mismatch is reported with the first action after
   which the two games differ, found by replaying alongside a second
   recording made of the original's views. */
'use strict';
const { load } = require('./engine');
const { playOne } = require('./sim');

function args() {
  const a = { games: 25, players: 2, format: 'standard', seed: 1, turns: 40, a: 5, b: 5, verbose: false };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'verbose') { a.verbose = true; continue; }
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

/* Log lines carry the time they were written, and the card cache stamps a
   printing with when it was fetched; neither is the game. Printings are
   compared by id. */
const stripLog = (v) => { v.log = (v.log || []).map(l => [l.turn, l.type, l.text]); return v; };
const byPrint = (k, x) => ((k === 'card' || k === 'printedCard' || k === 'copyOf') && x && typeof x === 'object' ? (x.id || x.name || '?') : x);
function views(g) {
  return g.players.map(p => p.id).concat(['__watching']).map(id => JSON.stringify(stripLog(g.viewFor(id)), byPrint));
}
function snap(g) {
  const s = g.snapshot();
  s.log = s.log.map(l => [l.turn, l.type, l.text]);
  return JSON.stringify(s, byPrint);
}

async function main() {
  const a = args();
  const MTG = load();
  let bad = 0, actions = 0, bytes = 0;
  const t0 = Date.now();
  for (let i = 0; i < a.games; i++) {
    let rec = null;
    // after every recorded action, the state it left, so a divergence can be pinned to one action
    const trail = [];
    const r = await playOne(MTG, {
      formatId: a.format, seed: a.seed + i, diffA: a.a, diffB: a.b, maxTurns: a.turns, players: a.players,
      keepGame: true,
      onGame: (g) => {
        rec = MTG.replay.record(g, { source: 'replaytest' });
        if (a.verbose) {
          const note = rec._note.bind(rec);
          rec._note = (m, args2) => { note(m, args2); trail.push(null); };
        }
      },
    });
    const g = r.game;
    rec.stop();
    const data = JSON.parse(JSON.stringify(rec.toJSON()));
    const text = JSON.stringify(data);
    bytes += text.length;
    actions += data.actions.length;
    // what a stranger has: printings by id, which are looked up again
    const byId = new Map();
    for (const o of g.objects.values()) if (o.card && o.card.id) byId.set(o.card.id, o.card);
    const rp = await MTG.replay.open(text, { lookup: (id) => byId.get(id) || null });
    rp.runUntil(null);
    const same = JSON.stringify(views(g)) === JSON.stringify(views(rp.game));
    const sameSnap = snap(g) === snap(rp.game);
    const ver = rp.verify();
    const ok = same && sameSnap && ver.ok && !rp.errors.length;
    if (!ok) bad++;
    console.log(`game ${i + 1} seed ${a.seed + i}: ${ok ? 'same' : 'DIFFERENT'}  turns=${g.turn} over=${g.over}` +
      ` actions=${data.actions.length} size=${(text.length / 1024).toFixed(1)}KB` +
      (ok ? '' : `  views=${same} snapshot=${sameSnap} fingerprint=${ver.ok} errors=${rp.errors.length}`));
    if (!ok) {
      if (rp.errors.length) console.log('   errors:', JSON.stringify(rp.errors.slice(0, 3)));
      const v1 = views(g), v2 = views(rp.game);
      for (let k = 0; k < v1.length; k++) {
        if (v1[k] === v2[k]) continue;
        const x = v1[k], y = v2[k];
        let j = 0; while (j < x.length && x[j] === y[j]) j++;
        console.log(`   view ${k} differs at ${j}: …${x.slice(Math.max(0, j - 160), j + 120)}\n   vs …${y.slice(Math.max(0, j - 160), j + 120)}`);
        break;
      }
      if (same && !sameSnap) {
        const x = snap(g), y = snap(rp.game);
        let j = 0; while (j < x.length && x[j] === y[j]) j++;
        console.log(`   snapshot differs at ${j}: …${x.slice(Math.max(0, j - 160), j + 120)}\n   vs …${y.slice(Math.max(0, j - 160), j + 120)}`);
      }
    }
  }
  console.log('summary', JSON.stringify({ games: a.games, players: a.players, format: a.format, different: bad,
    avgActions: Math.round(actions / a.games), avgKB: +(bytes / a.games / 1024).toFixed(1), ms: Date.now() - t0 }));
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
