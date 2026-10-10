/* The tutorials (src/14b-lessons.js), played through headless.

   Each lesson's board is built on a real game, its bot is given its
   orders, and a stand-in for the player plays it: once the right way,
   which must end in 'won', and once or more the wrong way, each of which
   must end in the 'lost' the lesson explains. Cards come from the bulk
   file in tools/, so nothing here needs the network.

     node tools/lessontest.js            every lesson
     node tools/lessontest.js stack      one of them
     SHOW_LOG=1 node tools/lessontest.js the end of each game's log as well */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { load, SRC } = require('./engine');

process.env.OFFLINE = '1';
const MTG = load();
vm.runInThisContext(fs.readFileSync(path.join(SRC, '14b-lessons.js'), 'utf8'), { filename: '14b-lessons.js' });
const L = MTG.lessons;

/* the cards, by name, from the bulk file */
const want = new Set(L.LESSONS.flatMap(def => L.cardNames(def)));
const byName = new Map();
for (const line of zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (!want.has(c.name) || byName.has(c.name) || c.layout === 'token' || c.layout === 'art_series') continue;
  byName.set(c.name, MTG.scry.slim(c));
}
for (const n of want) if (!byName.has(n)) { console.log('FAIL no card named ' + n + ' in the bulk file'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const obj = (g, id) => g.obj(id);
const onStack = (g, id) => g.stack.some(s => s.sourceId === id || s.objId === id || (s.obj && s.obj.id === id) || s.id === id);
const stackItemOf = (g, id) => g.stack.find(s => s.sourceId === id || s.objId === id || (s.obj && s.obj.id === id));

/** A lesson's game, as the app builds it, played by `you` until it is judged. */
async function play(def, you, seed) {
  const g = new MTG.rules.Game({ formatId: 'standard', startingLife: 20, startingHand: 7, maxPlayers: 2, seed: seed || 11, firstPlayerDraws: false });
  g.addPlayer({ id: 'me', name: 'You' });
  g.addPlayer({ id: 'bot', name: 'Your opponent', isBot: true, botDifficulty: 1 });
  g.loadDeck('me', L.filler(byName));
  g.loadDeck('bot', L.filler(byName));
  const runner = new MTG.bots.BotRunner(g);
  runner.add('bot', { difficulty: 1 });
  g.start();
  const ids = L.build(g, def, byName, 'me', 'bot');
  L.script(runner.bots.get('bot'), g, def, ids);
  g.setAutoPass('me', { enabled: true, smart: true, untilStackChange: true, stops: L.stopsFor(def), fullControl: false });
  let result = null;
  L.watch(g, def, ids, (r) => { result = r; });
  const errors = [];
  g.on('error', (m) => errors.push(m));
  runner.kick();
  const ctx = { g, ids, did: {} };
  for (let i = 0; i < 1500 && !result; i++) {
    await sleep(8);
    if (runner._running || runner._queued || runner.busy()) continue;
    const ch = g.pendingChoice;
    if (ch && ch.playerId === 'me') { you(ctx, 'choice', ch); continue; }
    if (!ch && g.priorityPlayer && g.priorityPlayer.id === 'me') {
      if (!you(ctx, 'priority')) g.passPriority('me');
      runner.kick();
    }
  }
  runner.stop();
  // SHOW_LOG=1: the end of each game's log, to see how it went
  if (process.env.SHOW_LOG) for (const e of g.log.slice(-14)) console.log('      | ' + e.text);
  return { result: result || 'unjudged', errors, ctx };
}

/* The player: told about each priority and each question. True from 'priority' means it did something. */
const pass = (ctx, what, ch) => {
  if (what === 'choice') {
    if (ch.type === 'declareAttackers') return ctx.g.declareAttackers('me', []);
    if (ch.type === 'declareBlockers') return ctx.g.declareBlockers('me', []);
    return ctx.g.resolveChoice('me', {});
  }
  return false;
};
const castOnce = (key, card, targets) => (ctx) => {
  if (ctx.did[key]) return false;
  ctx.did[key] = true;
  return ctx.g.castSpell('me', ctx.ids[card], { targets: targets(ctx), auto: true });
};
const attackWith = (tags) => (ctx, what, ch) => {
  if (what === 'choice' && ch.type === 'declareAttackers') {
    return ctx.g.declareAttackers('me', tags.map(t => ({ attackerId: ctx.ids[t], defenderId: 'bot' })));
  }
  return null;
};

const PLAYS = {
  stack: [
    ['right: Blossoming Defense in response', 'won', (ctx, what, ch) => {
      if (what === 'priority' && stackItemOf(ctx.g, ctx.ids.shock)) {
        return castOnce('defense', 'defense', (c) => [{ kind: 'object', id: c.ids.bears }])(ctx);
      }
      return pass(ctx, what, ch);
    }],
    ['wrong: let Shock resolve', 'lost:dead', pass],
  ],
  tricks: [
    ['right: attack, then Giant Growth after the block', 'won', (ctx, what, ch) => {
      const a = attackWith(['bears'])(ctx, what, ch);
      if (a != null) return a;
      const bears = obj(ctx.g, ctx.ids.bears);
      if (what === 'priority' && ctx.g.step === 'declareBlockers' && (bears.blockedBy || []).length) {
        return castOnce('growth', 'growth', (c) => [{ kind: 'object', id: c.ids.bears }])(ctx);
      }
      return pass(ctx, what, ch);
    }],
    ['wrong: Giant Growth before combat', 'lost:early', (ctx, what, ch) => {
      const a = attackWith(['bears'])(ctx, what, ch);
      if (a != null) return a;
      if (what === 'priority' && ctx.g.step === 'main' && ctx.g.phase.id === 'precombat') {
        return castOnce('growth', 'growth', (c) => [{ kind: 'object', id: c.ids.bears }])(ctx);
      }
      return pass(ctx, what, ch);
    }],
    ['wrong: no trick', 'lost:dead', (ctx, what, ch) => { const a = attackWith(['bears'])(ctx, what, ch); return a != null ? a : pass(ctx, what, ch); }],
    ['wrong: Giant Growth on their Giant', 'lost:dead', (ctx, what, ch) => {
      const a = attackWith(['bears'])(ctx, what, ch);
      if (a != null) return a;
      if (what === 'priority' && ctx.g.step === 'declareBlockers') return castOnce('growth', 'growth', (c) => [{ kind: 'object', id: c.ids.giant }])(ctx);
      return pass(ctx, what, ch);
    }],
    ['wrong: no attack', 'lost:noAttack', pass],
  ],
  blocks: (() => {
    const mine = (g) => g.battlefield.filter(o => o.controller === 'me' && o.card && /Creature/.test(o.card.type_line)).map(o => o.id);
    const blocks = (plan) => (ctx, what, ch) => {
      if (what === 'choice' && ch.type === 'declareBlockers') {
        const [a, b, c] = mine(ctx.g);
        const tag = { giant: ctx.ids.giant, bears: ctx.ids.bears };
        return ctx.g.declareBlockers('me', plan.map((t, i) => t && { blockerId: [a, b, c][i], attackerIds: [tag[t]] }).filter(Boolean));
      }
      return pass(ctx, what, ch);
    };
    return [
      ['right: two on the Giant, one on the Bears', 'won', blocks(['giant', 'giant', 'bears'])],
      ['wrong: one on each', 'lost:giant', blocks(['giant', 'bears', null])],
      ['wrong: all three on the Giant', 'lost:bears', blocks(['giant', 'giant', 'giant'])],
      ['wrong: no blocks', 'lost:giant', pass],
    ];
  })(),
  counter: [
    ['right: Counterspell on the Dreadmaw', 'won', (ctx, what, ch) => {
      const item = stackItemOf(ctx.g, ctx.ids.maw);
      if (what === 'priority' && item) return castOnce('counter', 'counter', () => [{ kind: 'stack', id: item.id }])(ctx);
      return pass(ctx, what, ch);
    }],
    ['wrong: let it resolve', 'lost:resolved', pass],
  ],
};

(async () => {
  const only = process.argv[2];
  let ok = 0, bad = 0;
  for (const def of L.LESSONS) {
    if (only && def.id !== only) continue;
    const plays = PLAYS[def.id];
    if (!plays) { console.log(`FAIL ${def.id}: no plays written for it`); bad++; continue; }
    // every reason the lesson can give has words for it
    for (const [, expect] of plays) {
      const why = expect === 'won' ? 'won' : expect.slice(5);
      if (!def.text[why]) { console.log(`FAIL ${def.id}: no words for ${expect}`); bad++; }
    }
    for (const [name, expect, you] of plays) {
      // a few shuffles, so it holds whoever happens to go first
      const runs = [];
      for (const seed of [11, 12, 17]) runs.push(Object.assign({ seed }, await play(def, you, seed)));
      const wrong = runs.filter(r => r.result !== expect);
      const fine = !wrong.length;
      if (fine) ok++; else bad++;
      const w = wrong[0];
      console.log(`${fine ? 'ok  ' : 'FAIL'} ${def.id}: ${name} -> ${fine ? expect : w.result + ' (expected ' + expect + ', seed ' + w.seed + ')'}` +
        (w && w.errors.length ? ' errors: ' + w.errors.slice(-3).join(' | ') : '') +
        (w ? ` [turn ${w.ctx.g.turn}, ${w.ctx.g.activePlayer.id} ${w.ctx.g.step}, stack ${w.ctx.g.stack.length}]` : ''));
    }
  }
  console.log(`lessons: ${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
