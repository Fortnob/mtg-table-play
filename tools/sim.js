/* Bot-vs-bot games, headless.

   node tools/sim.js --format standard --games 10 --a 3 --b 8 [--seed 1] [--turns 40] [--verbose]
   node tools/sim.js --format commander --players 4 --games 4
   node tools/sim.js --contracts ...   (check every view, question and bot call; see tools/contracts.js)

   With --players 3 or 4 the extra seats (C, D) play at difficulty b.

   Each game builds fresh decks for both seats at their difficulty, plays to a
   finish (or a turn cap), and reports who won, how long it took, and anything
   that went wrong: engine errors, stalls, and cards that fell through to
   manual handling. */
'use strict';
const { load } = require('./engine');

function args() {
  const a = { format: 'standard', games: 4, a: 5, b: 5, seed: 1, turns: null, verbose: false, json: false, players: 2 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'verbose' || k === 'json' || k === 'contracts') { a[k] = true; continue; }
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  /* the turn cap, unless given: forty turns between two, and fifteen a
     player at a bigger table, where each player gets fewer of the turns
     (a four-player Commander game runs about forty all told) */
  if (a.turns == null) a.turns = a.players > 2 ? 15 * a.players : 40;
  return a;
}

async function playOne(MTG, o) {
  const { formatId, seed, diffA, diffB, maxTurns, verbose } = o;
  const fmt = MTG.formats.effective(formatId, MTG.formats.houseDefaults(formatId));
  const rules = MTG.formats.houseDefaults(formatId);
  const t0 = Date.now();
  // seats beyond the first two (a multiplayer table) play at B's difficulty
  const seats = ['A', 'B', 'C', 'D'].slice(0, Math.max(2, Math.min(4, o.players || 2)));
  const diffOf = (id) => (id === 'A' ? diffA : diffB);
  const decks = await Promise.all(seats.map((id, i) =>
    (i === 0 && o.deckA) || (i === 1 && o.deckB) ||
    MTG.bots.buildBotDeck({ formatId, difficulty: diffOf(id), rules, rng: new MTG.RNG(seed * 7 + 1 + i), name: id })));
  const [deckA, deckB] = decks;
  const buildMs = Date.now() - t0;
  const g = new MTG.rules.Game({
    formatId, startingLife: rules.startingLife, startingHand: rules.startingHand || 7,
    commanderDamage: fmt.commander ? (rules.commanderDamage || null) : null,
    freeMulligans: rules.freeMulligans || 0, maxPlayers: fmt.maxPlayers, seed,
    firstPlayerDraws: false,
  });
  seats.forEach((id, i) => {
    g.addPlayer({ id, name: `${id}(d${diffOf(id)})`, isBot: true, botDifficulty: diffOf(id) });
    g.loadDeck(id, decks[i]);
  });
  const errors = [];
  const origWarn = console.warn;
  console.warn = (...x) => { errors.push(x.map(String).join(' ')); if (verbose) origWarn(...x); };
  const runner = new MTG.bots.BotRunner(g);
  for (const id of seats) runner.add(id, diffOf(id));
  // a caller that wants to watch the game from the first action (tools/replaytest.js)
  if (o.onGame) o.onGame(g);
  g.start();
  runner.kick();

  const started = Date.now();
  let lastV = -1, still = 0;
  while (!g.over && g.turn <= maxTurns) {
    await new Promise(r => setTimeout(r, 40));
    if (g.stateVersion === lastV) { if (++still > 150) break; } else { still = 0; lastV = g.stateVersion; }
    if (Date.now() - started > 120000) break;
  }
  runner.stop();
  console.warn = origWarn;
  const stalled = !g.over && g.turn <= maxTurns;
  const manualCards = new Set();
  for (const o2 of g.objects.values()) {
    const a = o2.analysis && o2.analysis();
    if (a && !a.fullyAutomated) {
      const why = (a.abilities || []).filter(x => !x.auto && x.kind !== 'castModifier').map(x => x.text).join(' | ');
      manualCards.add(verbose ? `${o2.card.name} [${why.slice(0, 120)}]` : o2.card.name);
    }
  }
  const rulesLines = g.log.filter(l => /Nobody could act|manual|by hand|assisted/i.test(l.text || l.msg || ''));
  return {
    seed, winner: g.winners && g.winners.length ? g.winners.map(w => (typeof w === 'string' ? w : w.id)).join(',') : null,
    turns: g.turn, over: g.over, stalled, buildMs, ms: Date.now() - started,
    life: g.players.map(p => p.life), errors: errors.slice(0, 20),
    manualCards: Array.from(manualCards),
    rulesLines: rulesLines.slice(0, 10).map(l => l.text || l.msg),
    deckA: deckA.main.map(e => `${e.qty} ${e.card.name}`), deckB: deckB.main.map(e => `${e.qty} ${e.card.name}`),
    stuckAt: stalled ? { step: g.step, choice: g.pendingChoice && g.pendingChoice.type, prio: g.priorityPlayer && g.priorityPlayer.id, lastError: g.lastError } : null,
    lastLog: verbose ? g.log.slice(-40).map(l => l.text || l.msg) : undefined,
    game: o.keepGame ? g : undefined,
  };
}

async function main() {
  const a = args();
  const MTG = load();
  const C = a.contracts ? require('./contracts') : null;
  const results = [];
  const found = [];
  for (let i = 0; i < a.games; i++) {
    // alternate seats so the play/draw advantage washes out
    const swap = i % 2 === 1;
    let mon = null;
    const r = await playOne(MTG, {
      formatId: a.format, seed: a.seed + i, diffA: swap ? a.b : a.a, diffB: swap ? a.a : a.b,
      maxTurns: a.turns, verbose: a.verbose, players: a.players,
      onGame: C ? (g) => { mon = C.watch(g, MTG, { label: `${a.format} seed ${a.seed + i}` }); } : undefined,
    });
    if (mon) { mon.stop(); found.push(mon.violations.concat(mon.known)); r.contracts = mon.violations.length; mon = null; }
    r.swap = swap;
    // credit the win to the difficulty, not the seat
    r.winnerDiff = r.winner === 'A' ? (swap ? a.b : a.a) : r.winner === 'B' ? (swap ? a.a : a.b) : r.winner ? a.b : null;
    results.push(r);
    if (!a.json) {
      console.log(`game ${i + 1}: ${r.over ? 'winner ' + (r.winner || '-') + ' d' + r.winnerDiff : r.stalled ? 'STALLED ' + JSON.stringify(r.stuckAt) : 'turn cap'}` +
        ` turns=${r.turns} life=${r.life.join('/')} build=${r.buildMs}ms play=${r.ms}ms errors=${r.errors.length} manual=${r.manualCards.length}`);
      if (a.verbose) {
        for (const e of r.errors) console.log('   err:', e.slice(0, 300));
        for (const l of r.rulesLines) console.log('   rules:', l);
        if (r.manualCards.length) console.log('   manual:', r.manualCards.join('; '));
      }
    }
  }
  const winsA = results.filter(r => r.winnerDiff === a.a).length;
  const winsB = results.filter(r => r.winnerDiff === a.b).length;
  const summary = {
    format: a.format, games: results.length, [`d${a.a}`]: winsA, [`d${a.b}`]: winsB,
    unfinished: results.filter(r => !r.over).length, stalled: results.filter(r => r.stalled).length,
    avgTurns: +(results.reduce((s, r) => s + r.turns, 0) / results.length).toFixed(1),
    withErrors: results.filter(r => r.errors.length).length,
    liveFetches: globalThis.__liveFetches(),
    offlineMisses: globalThis.__offlineMisses ? globalThis.__offlineMisses() : 0,
  };
  if (C) {
    const all = C.merge(found);
    summary.contractViolations = all.filter(v => !v.known).length;
    summary.contractKnown = all.filter(v => v.known).length;
    if (!a.json) for (const v of all) console.log('  ' + C.format(v));
  }
  if (a.json) console.log(JSON.stringify({ summary, results }, null, 1));
  else console.log('summary', JSON.stringify(summary));
  process.exit(0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { playOne };
