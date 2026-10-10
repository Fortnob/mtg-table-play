/* Bot-vs-bot games for tuning the bots, headless. sim.js is the quick
   two-seat check; this one can hold the deck or the play still, seat more
   than two, and play at browser pacing.

   node tools/botsim.js --format standard --games 10 --a 3 --b 8 [--seed 1] [--turns 40] [--verbose] [--json]

   Separating deck from play:
     --deckd 5      both seats build at difficulty 5; only the play differs
     --mirror       both seats play the very same list (implies --deckd 5)
     --playd 5      both seats play at difficulty 5; only the decks differ
   More players:
     --ds 3,5,7,9   one seat per difficulty, a free-for-all; the winner is
                    credited to its difficulty. --format commander is the
                    usual partner for this.
   Pacing:
     --speed 300    bots pause this many ms after each move, as they do in
                    the browser (the default 0 plays at full speed). This is
                    the path where a runner can trip over a bot that is
                    still thinking, so it is worth a run now and then.

   Card data:
     --localdb      build decks from the local card database (tools/
                    oracle-cards.jsonl.gz, as the app does) instead of the
                    Scryfall cache: no misses, every colour pair.

   Looking ahead: each seat's look-ahead decisions are counted, timed and
     reported (how many, mean and worst ms, how often the judgement's own
     move was overruled).

   Looking ahead: --phone thinks as on a phone; --lookcap 3 stretches the per-decision safety net by that
     factor (the default here, since runs share the machine; 1 is a browser).

   Contracts:
     --contracts    check every view, question and bot call as it happens
                    (tools/contracts.js); violations are listed at the end.

   Reports winners by difficulty, turns, stalls, crashes, runner nudges
   ("Nobody could act"), engine warnings, and cards that needed a person. */
'use strict';
const { load } = require('./engine');

function args() {
  const a = { format: 'standard', games: 4, a: 5, b: 5, seed: 1, turns: 40, verbose: false, json: false,
    deckd: null, playd: null, mirror: false, ds: null, speed: 0, timeout: 240000, trace: null, tuneA: null, tuneB: null, playA: null, playB: null,
    persA: null, persB: null, pers: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'verbose' || k === 'json' || k === 'mirror' || k === 'contracts' || k === 'localdb' || k === 'phone') { a[k] = true; continue; }
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  if (a.mirror && a.deckd == null) a.deckd = 5;
  return a;
}

async function playOne(MTG, o) {
  const { formatId, seed, maxTurns, verbose } = o;
  const seats = o.seats;                  // [{ id, play, deck, deckSeed }]
  const fmt = MTG.formats.effective(formatId, MTG.formats.houseDefaults(formatId));
  const rules = MTG.formats.houseDefaults(formatId);
  const t0 = Date.now();
  const decks = o.decks ? o.decks.slice() : [];
  if (o.decks) { /* built by the caller */ } else if (o.mirror) {
    const one = await MTG.bots.buildBotDeck({ formatId, difficulty: seats[0].deck, rules, rng: new MTG.RNG(seed * 7 + 1), name: 'M', personality: seats[0].personality || undefined });
    for (let i = 0; i < seats.length; i++) decks.push(one);
  } else {
    for (const s of seats) {
      decks.push(await MTG.bots.buildBotDeck({ formatId, difficulty: s.deck, rules, rng: new MTG.RNG(seed * 7 + 1 + s.deckSeed), name: s.id, tuning: s.tune, personality: s.personality || undefined }));
    }
  }
  const buildMs = Date.now() - t0;
  const g = new MTG.rules.Game({
    formatId, startingLife: rules.startingLife, startingHand: rules.startingHand || 7,
    commanderDamage: fmt.commander ? (rules.commanderDamage || null) : null,
    // (by the rules for this many seats: CR 103.5c, 103.8)
    freeMulligans: MTG.formats.freeMulligansFor(fmt, rules, seats.length), maxPlayers: Math.max(fmt.maxPlayers, seats.length), seed,
    firstPlayerDraws: MTG.formats.firstPlayerDrawsFor(fmt, rules, seats.length),
  });
  seats.forEach((s, i) => {
    g.addPlayer({ id: s.id, name: `${s.id}(d${s.play})`, isBot: true, botDifficulty: s.play });
    g.loadDeck(s.id, decks[i]);
  });
  const errors = [];
  const origWarn = console.warn;
  console.warn = (...x) => {
    errors.push(x.map(v => (v && v.stack) ? v.stack.split('\n').slice(0, 3).join(' | ') : (typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v))).join(' '));
    if (verbose) origWarn(...x);
  };
  /* --trace dir: every log line goes to a file as it happens, so a game
     that hangs (and so never gets to report) leaves its last moves behind. */
  if (o.trace) {
    const fs = require('fs');
    const file = require('path').join(o.trace, `trace-${o.chunkSeed || seed}.log`);
    fs.appendFileSync(file, `
=== game seed ${seed}: ${seats.map(s => s.id + ' d' + s.play + '/' + s.deck).join(' ')}
`);
    g.on('log', (e) => { try { fs.appendFileSync(file, `${e.turn} ${e.type}: ${e.text}
`); } catch (err) { /* tracing is best effort */ } });
  }
  /* Who attacks whom: at a bigger table, how often an attack goes at the
     player who is furthest ahead, at the one with the least life, and at
     each seat — the check that nobody is ganged up on for no reason. */
  const aim = { attacks: 0, atLeader: 0, atWeakest: 0, bySeat: {} };
  if (seats.length > 2) {
    const standing = (p) => p.life * 0.5 + 2 * g.battlefield.filter(o => o.controller === p.id && (g.characteristics(o) || {}).isCreature)
      .reduce((t, o) => t + Math.max(0, g.powerOf(o)), 0) + g.zones[p.id].hand.length * 0.5;
    const declare = g.declareAttackers.bind(g);
    g.declareAttackers = function (pid, decl) {
      const ok = declare(pid, decl);
      if (ok && decl && decl.length) {
        const live = g.players.filter(p => !p.hasLost && p.id !== pid);
        const leader = live.slice().sort((x, y) => standing(y) - standing(x))[0];
        const weakest = live.slice().sort((x, y) => x.life - y.life)[0];
        for (const d of decl) {
          const tgt = g.player(d.defenderId) ? d.defenderId : ((g.obj(d.defenderId) || {}).controller || null);
          if (!tgt) continue;
          aim.attacks++;
          if (leader && tgt === leader.id) aim.atLeader++;
          if (weakest && tgt === weakest.id) aim.atWeakest++;
          aim.bySeat[tgt] = (aim.bySeat[tgt] || 0) + 1;
        }
      }
      return ok;
    };
  }
  // what each seat did, for telling personalities apart
  const acts = {};
  g.on('bot:action', (e) => {
    const t = acts[e.playerId] = acts[e.playerId] || { attackers: 0, attacks: 0, blockers: 0, casts: 0, activations: 0, faceBurn: 0 };
    const n = parseInt(String(e.text || '').replace(/\D+/g, ''), 10) || 0;
    if (e.kind === 'attack') { t.attacks++; t.attackers += n; }
    else if (e.kind === 'block') t.blockers += n;
    else if (e.kind === 'cast') t.casts++;
    else if (e.kind === 'activate') t.activations++;
  });
  g.on('event', (e) => {
    // burn at a player's face: non-combat damage to a player from a spell of a seat
    if (e && e.type === 'damage' && !e.combat && e.target && e.target.kind === 'player') {
      const src = g.obj(e.source);
      if (src && acts[src.controller]) acts[src.controller].faceBurn += e.amount;
    }
  });
  const runner = new MTG.bots.BotRunner(g);
  const look = {};
  for (const s of seats) {
    const bot = runner.add(s.id, s.play, s.playTune || undefined, s.personality ? { personality: s.personality } : undefined);
    // every look ahead, timed and counted
    const st = look[s.id] = { n: 0, ms: 0, max: 0, overruled: 0, played: 0 };
    const inner = bot._lookAhead.bind(bot);
    bot._lookAhead = async (...x) => {
      const r = await inner(...x);
      const l = bot.lastLook;
      if (l && r != null) { st.n++; st.ms += l.ms; st.max = Math.max(st.max, l.ms); st.played += l.played; if (r !== 0) st.overruled++; }
      if (bot._slowest) st.slowest = bot._slowest;
      return r;
    };
  }
  // a caller that wants to watch the game (tools/contracts.js) gets it before it starts
  if (o.onGame) o.onGame(g);
  g.start();
  runner.kick();

  const started = Date.now();
  let lastV = -1, still = 0;
  const stillLimit = 150 + Math.ceil((o.speed || 0) * 6 / 40);
  while (!g.over && g.turn <= maxTurns) {
    await new Promise(r => setTimeout(r, 40));
    if (g.stateVersion === lastV) { if (++still > stillLimit) break; } else { still = 0; lastV = g.stateVersion; }
    if (Date.now() - started > (o.timeout || 240000)) break;
  }
  runner.stop();
  console.warn = origWarn;
  const stalled = !g.over && g.turn <= maxTurns;
  const manualCards = new Set();
  for (const o2 of g.objects.values()) {
    const a = o2.analysis && o2.analysis();
    if (a && !a.fullyAutomated && !a.isLand && !o2.isToken) {
      const why = (a.abilities || []).filter(x => !x.auto && x.kind !== 'castModifier').map(x => x.text).join(' | ');
      manualCards.add(verbose ? `${o2.card.name} [${why.slice(0, 120)}]` : o2.card.name);
    }
  }
  const rulesLines = g.log.filter(l => /manual|by hand|assisted/i.test(l.text || l.msg || ''));
  const nudges = g.log.filter(l => /Nobody could act/i.test(l.text || l.msg || '')).length;
  const winners = g.winners && g.winners.length ? g.winners.map(w => (typeof w === 'string' ? w : w.id)) : [];
  return {
    seed, winner: winners.join(',') || null,
    turns: g.turn, over: g.over, stalled, buildMs, ms: Date.now() - started, nudges,
    life: g.players.map(p => p.life), errors: errors.slice(0, 20),
    manualCards: Array.from(manualCards),
    rulesLines: rulesLines.slice(0, 10).map(l => l.text || l.msg),
    decks: decks.map(d => ({ plan: d.plan || null, commanders: (d.commanders || []).map(c => c.name) })),
    look, acts, aim: seats.length > 2 ? aim : undefined, personalities: seats.map(s => (runner.bots.get(s.id) || {}).personality || null),
    stuckAt: stalled ? { step: g.step, choice: g.pendingChoice && g.pendingChoice.type, prio: g.priorityPlayer && g.priorityPlayer.id, lastError: g.lastError } : null,
    fullLog: o.fullLog ? g.log.map(l => l.text || l.msg) : undefined,
    lastLog: verbose ? g.log.slice(-40).map(l => l.text || l.msg) : undefined,
  };
}

/** Who attacked whom, added up over the games (bigger tables only). */
function aimSummary(results) {
  const t = { attacks: 0, atLeader: 0, atWeakest: 0, byDiff: {} };
  for (const r of results) {
    if (!r.aim) continue;
    t.attacks += r.aim.attacks; t.atLeader += r.aim.atLeader; t.atWeakest += r.aim.atWeakest;
    for (const [pid, n] of Object.entries(r.aim.bySeat)) {
      const s = (r.seats || []).find(x => x.id === pid);
      const k = s ? 'd' + s.diff : pid;
      t.byDiff[k] = (t.byDiff[k] || 0) + n;
    }
  }
  if (!t.attacks) return null;
  t.leaderPct = +(100 * t.atLeader / t.attacks).toFixed(0);
  t.weakestPct = +(100 * t.atWeakest / t.attacks).toFixed(0);
  return t;
}

/** Look-ahead numbers added up by the seat's difficulty. */
function lookSummary(results) {
  const by = {};
  for (const r of results) {
    for (const s of (r.seats || [])) {
      const l = r.look && r.look[s.id];
      if (!l || !l.n) continue;
      const k = 'd' + s.play;
      const t = by[k] = by[k] || { decisions: 0, ms: 0, max: 0, overruled: 0, played: 0, games: 0 };
      if (l.slowest && (!t.slowest || l.slowest.ms > t.slowest.ms)) t.slowest = Object.assign({ seed: r.seed }, l.slowest);
      t.decisions += l.n; t.ms += l.ms; t.max = Math.max(t.max, l.max); t.overruled += l.overruled; t.played += l.played; t.games++;
    }
  }
  for (const t of Object.values(by)) {
    t.perGame = +(t.decisions / Math.max(1, t.games)).toFixed(1);
    t.meanMs = +(t.ms / Math.max(1, t.decisions)).toFixed(1);
    t.rolloutMs = +(t.ms / Math.max(1, t.played)).toFixed(2);
    t.overruledPct = +(100 * t.overruled / Math.max(1, t.decisions)).toFixed(0);
    delete t.ms;
  }
  return by;
}

/** The seats for game i, rotated so the play/draw washes out. */
function seatsFor(a, i) {
  if (a.ds) {
    const ds = String(a.ds).split(',').map(Number);
    const rot = ds.map((_, k) => ds[(k + i) % ds.length]);
    // --pers aggressive,cautious,...: a personality per difficulty in --ds order (one name: every seat)
    const pers = a.pers ? String(a.pers).split(',') : [];
    const persOf = (d) => (pers.length === 1 ? pers[0] : pers[ds.indexOf(d)]) || null;
    return rot.map((d, k) => ({ id: 'P' + k, play: a.playd != null ? a.playd : d, deck: a.deckd != null ? a.deckd : d, diff: d, deckSeed: k, personality: persOf(d) }));
  }
  const swap = i % 2 === 1;
  const da = swap ? a.b : a.a, db = swap ? a.a : a.b;
  // deck-building experiments: --tuneA/--tuneB are JSON knobs for the a and b sides
  const ta = a.tuneA ? JSON.parse(a.tuneA) : null, tb = a.tuneB ? JSON.parse(a.tuneB) : null;
  // play experiments: --playA/--playB override numbers from the ladder for that side's bot
  const pa = a.playA ? JSON.parse(a.playA) : null, pb = a.playB ? JSON.parse(a.playB) : null;
  return [
    { id: 'A', play: a.playd != null ? a.playd : da, deck: a.deckd != null ? a.deckd : da, diff: da, deckSeed: 0, tune: swap ? tb : ta, playTune: swap ? pb : pa, side: swap ? 'b' : 'a',
      personality: (swap ? a.persB : a.persA) || null },
    { id: 'B', play: a.playd != null ? a.playd : db, deck: a.deckd != null ? a.deckd : db, diff: db, deckSeed: 1, tune: swap ? ta : tb, playTune: swap ? pa : pb, side: swap ? 'a' : 'b',
      personality: (swap ? a.persA : a.persB) || null },
  ];
}

async function main() {
  const a = args();
  const MTG = load();
  MTG.settings.botSpeed = a.speed || 0;
  if (a.localdb) await require('./localdb').loadLocalDb(MTG, { kind: 'oracle_cards' });
  /* Many games side by side make every copy slower than it is on a quiet
     machine; --lookcap stretches the look-ahead safety net to match (3 by
     default here), so a run measures the bots as they play at home. */
  MTG.bots.lookCapScale = a.lookcap != null ? a.lookcap : 3;
  // --phone: the bots think as they would on a phone (fewer copies and candidates)
  if (a.phone) MTG.isPhone = () => true;
  const C = a.contracts ? require('./contracts') : null;
  const found = [];
  const results = [];
  for (let i = 0; i < a.games; i++) {
    const seats = seatsFor(a, i);
    let r, mon = null;
    try {
      r = await playOne(MTG, {
        formatId: a.format, seed: a.seed + i, seats, maxTurns: a.turns, verbose: a.verbose,
        mirror: a.mirror, speed: a.speed, timeout: a.timeout, trace: a.trace, chunkSeed: a.seed,
        onGame: C ? (g) => { mon = C.watch(g, MTG, { label: `${a.format} seed ${a.seed + i}` }); } : undefined,
      });
    } catch (e) {
      r = { seed: a.seed + i, winner: null, turns: 0, over: false, stalled: false, crashed: String(e && e.stack || e).slice(0, 400),
        errors: [String(e)], life: [], manualCards: [], rulesLines: [], nudges: 0 };
    }
    if (mon) { mon.stop(); found.push(mon.violations.concat(mon.known)); r.contracts = mon.violations.length; }
    r.seats = seats.map(s => ({ id: s.id, diff: s.diff, play: s.play, deck: s.deck }));
    // credit the win to the difficulty, not the seat
    const w = seats.find(s => s.id === r.winner);
    r.winnerDiff = w ? w.diff : null;
    r.winnerSide = w ? w.side || null : null;
    results.push(r);
    if (!a.json) {
      console.log(`game ${i + 1}: ${r.over ? 'winner d' + r.winnerDiff : r.crashed ? 'CRASHED ' + r.crashed : r.stalled ? 'STALLED ' + JSON.stringify(r.stuckAt) : 'turn cap'}` +
        ` turns=${r.turns} life=${r.life.join('/')} build=${r.buildMs}ms play=${r.ms}ms errors=${r.errors.length} nudges=${r.nudges} manual=${r.manualCards.length}`);
      if (a.verbose) {
        for (const e of r.errors) console.log('   err:', e.slice(0, 300));
        for (const l of r.rulesLines) console.log('   rules:', l);
        if (r.manualCards.length) console.log('   manual:', r.manualCards.join('; '));
        if (r.stalled && r.lastLog) console.log('   last:', r.lastLog.slice(-12).join('\n         '));
      }
    }
  }
  const diffs = a.ds ? String(a.ds).split(',').map(Number) : [a.a, a.b];
  const summary = { format: a.format, games: results.length };
  for (const d of new Set(diffs)) summary['d' + d] = results.filter(r => r.winnerDiff === d).length;
  Object.assign(summary, {
    unfinished: results.filter(r => !r.over).length, stalled: results.filter(r => r.stalled).length,
    crashed: results.filter(r => r.crashed).length,
    avgTurns: +(results.reduce((s, r) => s + r.turns, 0) / Math.max(1, results.length)).toFixed(1),
    withErrors: results.filter(r => r.errors.length).length,
    nudges: results.reduce((s, r) => s + (r.nudges || 0), 0),
    liveFetches: globalThis.__liveFetches(),
    offlineMisses: globalThis.__offlineMisses ? globalThis.__offlineMisses() : 0,
  });
  // look-ahead decisions by difficulty: how many a game, how long, how often they changed the move
  const lookBy = lookSummary(results);
  if (Object.keys(lookBy).length) summary.look = lookBy;
  const aimAll = aimSummary(results);
  if (aimAll) summary.aim = aimAll;
  if (C) {
    const all = C.merge(found);
    summary.contractViolations = all.filter(v => !v.known).length;
    summary.contractKnown = all.filter(v => v.known).length;
    if (!a.json) for (const v of all) console.log('  ' + C.format(v));
  }
  if (a.json) console.log(JSON.stringify({ summary, results }));
  else console.log('summary', JSON.stringify(summary));
  process.exit(0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { playOne, seatsFor, lookSummary, aimSummary };
