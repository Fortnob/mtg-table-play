#!/usr/bin/env node
/* Match play, checked without a browser: the game clock (src/06e-clock.js)
   on a real game, its house rule (src/04-formats.js), the record of games
   and matches (src/10g-history.js), and the table writing a finished game
   into that record (src/12h-ui-rematch.js, against a stand-in table).
   A failure exits non-zero. Run by tools/check.py ('match'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { engine, card } = require('./harness');

const SRC = path.join(__dirname, '..', 'src');
const MTG = engine();
const run = (f) => vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: wanted ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

run('06e-clock.js');
const C = MTG.clock;

/* ---------------- the clock's words ---------------- */
eq(C.format(0), '0:00', 'no time');
eq(C.format(999), '0:01', 'under a second rounds up');
eq(C.format(59001), '1:00', 'just under a minute');
eq(C.format(61000), '1:01', 'a minute and a second');
eq(C.format(20 * 60000), '20:00', 'twenty minutes');
eq(C.attach({}, 0), null, 'no clock without minutes');

/* ---------------- the house rule ---------------- */
for (const f of ['standard', 'commander', 'booster']) {
  eq(MTG.formats.houseDefaults(f).clock, 0, `${f}: the clock starts off`);
  check(MTG.formats.houseFields(f).some(x => x.key === 'clock' && x.type === 'choice'), `${f}: the clock is a house rule`);
}
eq(MTG.formats.houseSummary('standard', Object.assign(MTG.formats.houseDefaults('standard'), { clock: 20 })), ['Clock: 20 minutes a player'], 'a joining player is told about the clock');
eq(MTG.formats.houseSummary('standard', MTG.formats.houseDefaults('standard')), [], 'no clock, nothing to say');
eq(C.MINUTES, MTG.formats.houseFields('standard').find(x => x.key === 'clock').options.map(o => o[0]), 'the rule offers what the clock knows');

/* ---------------- a game on the clock ---------------- */
function newGame(opts) {
  opts = opts || {};
  const g = new MTG.rules.Game({ formatId: 'standard', startingLife: 20, startingHand: 7, maxPlayers: 4, seed: 11, commanderDamage: null, firstPlayerDraws: false });
  g.addPlayer({ id: 'me', name: 'Me' });
  g.addPlayer({ id: 'bot', name: 'Bot', isBot: true, botDifficulty: 5 });
  if (opts.third) g.addPlayer({ id: 'you', name: 'You' });
  const deck = { main: ['Forest', 'Mountain'].map(n => ({ qty: 20, card: card(n) })) };
  for (const p of g.players) g.loadDeck(p.id, deck);
  return g;
}
let t = 0;
const clockAt = () => t;
/** Move the game on until it waits on `pid`: priority passed, questions answered as plainly as they can be. */
function bringTo(g, pid) {
  for (let i = 0; i < 60; i++) {
    const w = C.waitingOn(g)[0];
    if (w === pid || g.over) return;
    const ch = g.pendingChoice;
    if (ch && ch.type === 'declareAttackers') g.declareAttackers(ch.playerId, []);
    else if (ch && ch.type === 'declareBlockers') g.declareBlockers(ch.playerId, []);
    else if (ch) g.resolveChoice(ch.playerId, {});
    else if (g.priorityPlayer) g.passPriority(g.priorityPlayer.id);
    else return;
  }
}
{
  const g = newGame();
  t = 1000;
  const k = C.attach(g, 10, { now: clockAt, tick: false });
  eq(Object.keys(k.left), ['me'], 'only people are timed, not bots');
  g.start();
  t += 30000; k.settle();
  eq(k.left.me, 600000, 'the opening hands are not on the clock');
  for (const p of g.players) g.keepHand(p.id, []);
  check(g.turn >= 1, 'the game has begun');
  // whoever the game waits on now
  const waiting = () => C.waitingOn(g);
  bringTo(g, 'me');
  eq(waiting(), ['me'], 'the game waits on me');
  k.settle();
  const before = k.left.me;
  t += 4000; k.settle();
  eq(before - k.left.me, 4000, 'my time runs while the game waits on me');
  eq(k.view().running, ['me'], 'the view says whose time is running');
  // a device asleep for a minute: only the first few seconds count
  const b2 = k.left.me;
  t += 60000; k.settle();
  eq(b2 - k.left.me, C.MAX_GAP, 'a long gap counts only up to the cap');
  // the bot's turn to act: my time stands still
  bringTo(g, 'bot');
  if (waiting()[0] === 'bot') {
    k.settle();
    const b3 = k.left.me;
    t += 9000; k.settle();
    eq(k.left.me, b3, 'a bot thinking costs me nothing');
    eq(k.view().running, [], 'nobody timed is running while the bot thinks');
  } else check(false, 'priority never reached the bot');
  // saved and picked up again
  const saved = JSON.parse(JSON.stringify(k.save()));
  const g2 = newGame();
  const k2 = C.attach(g2, 10, { now: clockAt, tick: false });
  k2.restore(saved);
  eq(k2.left.me, k.left.me, 'a saved game keeps the time left');
  k2.restore({ left: { me: 1e12 } });
  eq(k2.left.me, 600000, 'a saved clock cannot give more than the whole');
  k.stop(); k2.stop();
}
{
  // running out: out of the game, said in the log, and Angel's Grace cannot stop it
  const g = newGame();
  t = 0;
  const k = C.attach(g, 10, { now: clockAt, tick: false });
  g.start();
  for (const p of g.players) g.keepHand(p.id, []);
  bringTo(g, 'me');
  k.settle();
  k.left.me = 500;
  g.player('me').cantLoseTurn = g.turn;
  t += 400; k.tick();
  check(!g.player('me').hasLost, 'still in with time left');
  t += 200; k.tick();
  const me = g.player('me');
  check(me.hasLost, 'out of time is out of the game');
  eq(me.lossReason, 'time', 'the reason is the clock');
  check(g.over && (g.winners || []).includes('bot'), 'the other player wins');
  check((g.log || []).some(e => /Me loses the game \(ran out of time on the clock\)/.test(e.text || e.msg || String(e))), 'the log says so');
  check(k.stopped, 'the clock stops when the game is over');
  check(!me.conceded, 'running out of time is not conceding');
}
{
  // three at the table: one out of time, the game goes on
  const g = newGame({ third: true });
  t = 0;
  const k = C.attach(g, 10, { now: clockAt, tick: false });
  g.start();
  for (const p of g.players) g.keepHand(p.id, []);
  bringTo(g, 'you');
  eq(C.waitingOn(g), ['you'], 'the game waits on the third player');
  k.settle();
  k.left.you = 10;
  t += 50; k.tick();
  check(g.player('you').hasLost && !g.over, 'one of three out of time, and the game goes on');
  check(!C.waitingOn(g).includes('you'), 'the game no longer waits on them');
  check(!k.stopped, 'the clock keeps going for the rest');
  // the question a player is asked is their time too
  g.queueChoice({ type: 'confirm', playerId: 'me', prompt: 'Well?' });
  k.settle();
  eq(k.running, ['me'], 'a question to me runs my clock');
  // nobody looking after the game any more: the clock stops itself
  let alive = true;
  const k2 = C.attach(g, 10, { now: clockAt, tick: false, alive: () => alive });
  alive = false; k2.tick();
  check(k2.stopped, 'a clock for a game nobody is at stops');
  k.stop();
}

/* ---------------- the record ---------------- */
// a record that was written badly is not the end of the world
localStorage.setItem('mtgtable.history', JSON.stringify({ entries: 5, decks: 'x', keys: null }));
run('10g-history.js');
const H = MTG.history;
eq(H.entries(), [], 'a damaged record starts again empty');
H.reset();
const game = (o) => Object.assign({ kind: 'game', format: 'standard', mode: 'quick', result: 'win', deck: { id: 'd1', name: 'Mono Red' },
  opp: [{ name: 'Brass Scribe', bot: true, level: 5, deck: 'Elves' }], turns: 9, ms: 600000 }, o);
check(!!H.record(game({ key: 'g:1' })), 'a game is written down');
eq(H.record(game({ key: 'g:1' })), null, 'and only once');
H.record(game({ key: 'g:2', result: 'loss' }));
H.record(game({ key: 'g:3', result: 'draw', format: 'modern' }));
H.record(game({ key: 'g:4', deck: { id: null, name: 'Your deck' } }));
H.record(game({ key: 'g:4:match', kind: 'match', score: '2–1', game: null }));
eq(H.deckRecord('d1') && [H.deckRecord('d1').g, H.deckRecord('d1').w, H.deckRecord('d1').l, H.deckRecord('d1').d, H.deckRecord('d1').mw], [3, 1, 1, 1, 1], 'a deck’s games and matches');
eq(H.recordText(H.deckRecord({ id: 'd1' })), '1–1–1, 33%', 'a record in words, with draws');
eq(H.recordText({ g: 10, w: 7, l: 3, d: 0 }), '7–3, 70%', 'seven and three');
eq(H.deckRecord({ name: 'Your deck' }).g, 1, 'a deck with no id goes by its name');
eq(H.deckRecord('nope'), null, 'a deck that has not played has no record');
eq(H.entries({ format: 'modern' }).map(e => e.result), ['draw'], 'narrowed by format');
eq(H.entries({ result: 'loss' }).length, 1, 'narrowed by result');
eq(H.entries()[0].kind, 'match', 'newest first');
eq(H.formats(), ['standard', 'modern'], 'the formats played, most first');
eq(H.tally(H.entries()), { g: 4, w: 2, l: 1, d: 1 }, 'a tally counts games, not matches');
const e0 = H.entries({ kind: 'game' }).pop();
eq([e0.format, e0.mode, e0.turns, e0.opp[0].name, e0.opp[0].bot, e0.opp[0].level], ['standard', 'quick', 9, 'Brass Scribe', true, 5], 'what a game keeps');
// bounded: the list keeps the newest, the deck totals keep everything
for (let i = 0; i < H.MAX + 20; i++) H.record(game({ key: 'b:' + i, deck: { id: 'd2', name: 'Elves' } }));
eq(H.state.entries.length, H.MAX, 'the list is bounded');
eq(H.deckRecord('d2').g, H.MAX + 20, 'the older games still count for their deck');
check(H.state.keys.length <= 60, 'the keys it remembers are bounded too');
check(JSON.parse(localStorage.getItem('mtgtable.history')).entries.length === H.MAX, 'it is saved where a profile backup finds it');

/* ---------------- the table writes the record ---------------- */
H.reset();
// a stand-in table and network, enough for the module to wrap
MTG.net = new MTG.Emitter();
Object.assign(MTG.net, { isClient: false, isHost: false, conns: new Map(), send() {} });
MTG.ui = MTG.ui || {};
MTG.ui.Table = class { constructor(meId) { this.meId = meId; } update(v) { this.live = v; } };
MTG.ui.modal = () => ({ close() {}, foot: { querySelector: () => null } });
MTG.ui.toast = () => {};
run('12h-ui-rematch.js');
const view = (o) => Object.assign({
  game: 's:1', turn: 6, over: false, winners: [], match: null,
  players: [{ id: 'me', name: 'Me', command: [] }, { id: 'b1', name: 'Gilded Fox', isBot: true, botDifficulty: 7, command: [] }],
  battlefield: [],
}, o);
const deckA = { id: 'deckA', name: 'Gruul', commanders: [] };
MTG.app = { session: { formatId: 'pioneer', mode: null, roster: [{ id: 'me', kind: 'local', deck: deckA }, { id: 'b1', kind: 'bot', deck: { name: 'Fox’s deck', commanders: [] } }],
  seat(id) { return this.roster.find(r => r.id === id); } } };
let table = new MTG.ui.Table('me');
table.update(view());
table.update(view({ turn: 7 }));
eq(H.entries().length, 0, 'nothing is written while the game goes on');
for (const until = Date.now() + 5; Date.now() < until;) { /* a game takes some time */ }
table.update(view({ over: true, winners: ['me'], turn: 8 }));
table.update(view({ over: true, winners: ['me'], turn: 8 }));
let es = H.entries();
eq(es.length, 1, 'a finished game is written once');
eq([es[0].result, es[0].format, es[0].mode, es[0].deck.id, es[0].deck.name, es[0].opp[0].name, es[0].opp[0].bot, es[0].opp[0].level, es[0].opp[0].deck, es[0].turns],
  ['win', 'pioneer', 'quick', 'deckA', 'Gruul', 'Gilded Fox', true, 7, 'Fox’s deck', 8], 'what the table writes');
check(es[0].ms >= 5, 'how long it took');
// a new table for the same game (a reconnect) does not write it again
table = new MTG.ui.Table('me');
table.update(view({ over: true, winners: ['me'], turn: 8 }));
eq(H.entries().length, 1, 'the same game is not written twice');
// a ranked game, decided a match: the game and the match
MTG.app.session.mode = { ranked: true };
const m = { gameNumber: 3, best: 3, decided: true, scores: [{ id: 'me', wins: 1 }, { id: 'b1', wins: 2 }] };
table = new MTG.ui.Table('me');
table.update(view({ game: 's:2', over: true, winners: ['b1'], match: m }));
es = H.entries();
eq(es.map(e => [e.kind, e.result, e.mode]), [['match', 'loss', 'ranked'], ['game', 'loss', 'ranked'], ['game', 'win', 'quick']], 'a decided match is written after its last game');
eq([es[0].score, es[1].game], ['1–2', { n: 3, of: 3 }], 'the match’s score, and which game of it this was');
// a challenge is a puzzle, not a game for the record
MTG.app.session.mode = { challenge: 'burn' };
table = new MTG.ui.Table('me');
table.update(view({ game: 's:3', over: true, winners: ['me'] }));
eq(H.entries().length, 3, 'a challenge is not written down');
// knocked out of a game of three: written down there and then
MTG.app.session.mode = null;
table = new MTG.ui.Table('me');
const three = (o) => view(Object.assign({ game: 's:4', players: [{ id: 'me', name: 'Me', hasLost: false, command: [] }, { id: 'b1', name: 'Fox', isBot: true, command: [] }, { id: 'b2', name: 'Owl', isBot: true, command: [] }] }, o));
table.update(three());
const out = three(); out.players[0].hasLost = true;
table.update(out);
eq([H.entries()[0].result, H.entries()[0].opp.length], ['loss', 2], 'out of a game of three is a loss, written at once');
table.update(Object.assign(three({ over: true, winners: ['b2'] }), { players: out.players }));
eq(H.entries().length, 4, 'and not again when the game ends');
// a guest: online, the deck it sent, the commanders it saw
MTG.app = { session: null, clientFormatId: 'commander', clientDeck: { id: 'deckC', name: 'Atraxa Superfriends', commanders: [{ name: 'Atraxa, Praetors’ Voice' }] },
  lobbyMembers: [{ id: 'rp1', deckName: 'Atraxa Superfriends' }, { id: 'host', deckName: 'Edgar' }] };
MTG.net.isClient = true;
table = new MTG.ui.Table('rp1');
const gv = view({ game: 's:5', over: true, winners: ['host'], players: [
  { id: 'rp1', name: 'Me', command: [] },
  { id: 'host', name: 'Hostess', command: [{ isCommander: true, card: { name: 'Edgar Markov' } }] }] });
table.update(gv);
const ge = H.entries()[0];
eq([ge.mode, ge.format, ge.result, ge.deck.id, ge.deck.cmd, ge.opp[0].name, ge.opp[0].bot, ge.opp[0].deck, ge.opp[0].cmd],
  ['online', 'commander', 'loss', 'deckC', 'Atraxa, Praetors’ Voice', 'Hostess', false, 'Edgar', 'Edgar Markov'], 'a guest writes its own game');
// the deck the host has for a guest now (one built after a draft) beats one it sent before
MTG.app.lobbyMembers = [{ id: 'rp1', deckName: 'Draft deck' }, { id: 'host', deckName: 'Edgar' }];
table = new MTG.ui.Table('rp1');
table.update(Object.assign({}, gv, { game: 's:5b' }));
eq([H.entries()[0].deck.id, H.entries()[0].deck.name], [null, 'Draft deck'], 'a guest’s drafted deck goes by its name');
// watching, or a replay, is not playing
MTG.net.isClient = false;
table = new MTG.ui.Table('me');
table.update(view({ game: 's:6', over: true, winners: ['me'], spectating: true }));
table.update(view({ game: 's:7', over: true, winners: ['me'], replay: true }));
eq(H.entries().length, 6, 'watching and replays are not written down');
eq(MTG.rematch.modeOf({ mode: null, roster: [{ kind: 'local' }, { kind: 'remote' }] }), 'online', 'a table with a friend at it is online');
eq(MTG.rematch.modeOf({ mode: { gauntlet: true }, roster: [] }), 'gauntlet', 'the gauntlet');
eq(MTG.rematch.modeOf({ mode: { event: 'draft' }, roster: [] }), 'event', 'a draft event');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
