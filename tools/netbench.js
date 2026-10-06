/* What a guest is sent, before and after the compact sync (src/09b-sync.js).

   node tools/netbench.js [--games 4] [--players 2] [--format standard] [--lag 2] [--seed 1]

   Plays bot games headless and runs the host-to-guest pipeline for one
   seat alongside, the way Session.pushState does:

     before  every state change: the whole redacted view, plus one 'log'
             message per log line (what the table used to send)
     after   the same views through an Encoder: cards once, differences
             against the last acknowledged view, events alongside; and the
             same again sent at most once per engine action

   Every message is read back through a Decoder (acks arriving `lag`
   messages late, as they would over a real connection), and the view it
   rebuilds has to be the view the host built, exactly. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, SRC } = require('./engine');
const { playOne } = require('./sim');

function args() {
  const a = { games: 4, players: 2, format: 'standard', lag: 2, seed: 1, turns: 40 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

const CHUNK = 12000;
const pieces = (len) => (len <= CHUNK ? 1 : Math.ceil(len / CHUNK));

/** One guest's connection: an encoder at the host, a decoder at the guest, acks in flight. */
function pipe(MTG, lag, check) {
  const enc = new MTG.sync.Encoder(), dec = new MTG.sync.Decoder();
  const acks = [];
  const t = { msgs: 0, bytes: 0, pieces: 0, max: 0, full: 0, resyncs: 0, bad: 0 };
  return {
    t,
    send(view) {
      const msg = enc.encode(view);
      const text = JSON.stringify(Object.assign({ seq: 1 }, msg));
      t.msgs++; t.bytes += text.length; t.pieces += pieces(text.length); t.max = Math.max(t.max, text.length);
      if (msg.s) t.full++;
      const r = dec.decode(JSON.parse(text));
      if (r.resync) { t.resyncs++; enc.resync(); }
      if (r.view && check) {
        // the card cache's fetch stamp is not part of a card
        const noStamp = (k, x) => (k === '_t' ? undefined : x);
        const a = JSON.stringify(MTG.sync.stateOf(r.view), noStamp), b = JSON.stringify(MTG.sync.stateOf(view), noStamp);
        if (a !== b) {
          t.bad++;
          if (t.bad === 1) { let j = 0; while (a[j] === b[j]) j++; console.log('   MISMATCH at', j, a.slice(j - 80, j + 80), '\n   vs', b.slice(j - 80, j + 80)); }
        }
      }
      if (r.ack) acks.push(r.ack);
      // acknowledgements take a while to come back
      while (acks.length > lag) enc.ack(acks.shift());
    },
  };
}

async function main() {
  const a = args();
  const MTG = load();
  vm.runInThisContext(fs.readFileSync(path.join(SRC, '09b-sync.js'), 'utf8'), { filename: '09b-sync.js' });
  const sum = { updates: 0, actions: 0, before: 0, beforeLog: 0, beforePieces: 0, beforeMax: 0, after: null, coalesced: null };
  const add = (into, t) => { for (const k in t) into[k] = (k === 'max' ? Math.max(into[k] || 0, t[k]) : (into[k] || 0) + t[k]); };
  sum.after = {}; sum.coalesced = {};
  for (let i = 0; i < a.games; i++) {
    let each, batched;
    const stats = { updates: 0, actions: 0, before: 0, beforeLog: 0, beforePieces: 0, beforeMax: 0 };
    const r = await playOne(MTG, {
      formatId: a.format, seed: a.seed + i, diffA: 5, diffB: 5, maxTurns: a.turns, players: a.players, keepGame: true,
      onGame: (g) => {
        const pid = 'B';               // the guest
        each = pipe(MTG, a.lag, true);
        batched = pipe(MTG, a.lag, true);
        let seenEach, seenBatch, dirty = false;
        const viewNow = (since) => {
          const v = g.viewFor(pid);
          v.match = null;
          v.events = g.eventsFor(pid, since);
          v.eventSeq = g.eventSeq;
          return v;
        };
        g.on('log', (e) => { stats.beforeLog += JSON.stringify({ t: 'log', payload: e, seq: 1 }).length; });
        g.on('state', () => {
          // before: the whole view, every time
          const old = g.viewFor(pid);
          old.match = null;
          const text = JSON.stringify({ t: 'state', payload: old, seq: 1 });
          stats.updates++; stats.before += text.length; stats.beforePieces += pieces(text.length);
          stats.beforeMax = Math.max(stats.beforeMax, text.length);
          // after: a difference, every time
          const v = viewNow(seenEach); seenEach = g.eventSeq;
          each.send(v);
          // after, at most once per engine action
          if (!dirty) {
            dirty = true;
            queueMicrotask(() => {
              dirty = false;
              stats.actions++;
              const w = viewNow(seenBatch); seenBatch = g.eventSeq;
              batched.send(w);
            });
          }
        });
      },
    });
    await new Promise(res => setTimeout(res, 5));
    add(sum, stats);
    add(sum.after, each.t);
    add(sum.coalesced, batched.t);
    const kb = (n) => (n / 1024).toFixed(1) + 'KB';
    console.log(`game ${i + 1}: turns=${r.turns} updates=${stats.updates} before=${kb(stats.before + stats.beforeLog)}` +
      ` after=${kb(each.t.bytes)} (${(100 * each.t.bytes / (stats.before + stats.beforeLog)).toFixed(1)}%)` +
      ` once-per-action=${kb(batched.t.bytes)} in ${batched.t.msgs} msgs  mismatches=${each.t.bad + batched.t.bad} resyncs=${each.t.resyncs + batched.t.resyncs}`);
  }
  const per = (b, n) => Math.round(b / Math.max(1, n));
  const report = {
    games: a.games, players: a.players, format: a.format, ackLag: a.lag,
    updates: sum.updates,
    before: { bytesPerUpdate: per(sum.before + sum.beforeLog, sum.updates), viewBytesPerUpdate: per(sum.before, sum.updates),
      maxMessage: sum.beforeMax, dataChannelPieces: sum.beforePieces, totalKB: Math.round((sum.before + sum.beforeLog) / 1024) },
    after: { bytesPerUpdate: per(sum.after.bytes, sum.after.msgs), maxMessage: sum.after.max, wholeViews: sum.after.full,
      dataChannelPieces: sum.after.pieces, totalKB: Math.round(sum.after.bytes / 1024), mismatches: sum.after.bad },
    afterOncePerAction: { messages: sum.coalesced.msgs, bytesPerMessage: per(sum.coalesced.bytes, sum.coalesced.msgs),
      totalKB: Math.round(sum.coalesced.bytes / 1024), mismatches: sum.coalesced.bad },
    saving: ((1 - sum.after.bytes / (sum.before + sum.beforeLog)) * 100).toFixed(1) + '%',
    savingOncePerAction: ((1 - sum.coalesced.bytes / (sum.before + sum.beforeLog)) * 100).toFixed(1) + '%',
  };
  console.log(JSON.stringify(report, null, 1));
  process.exit(sum.after.bad || sum.coalesced.bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
