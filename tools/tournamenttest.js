#!/usr/bin/env node
/* Friends tournaments (src/09f-tourney.js, src/10i-ui-tourney.js), and the
   draft that waits for every deck (src/07-draft.js), checked without a
   browser.

   As in tools/socialtest.js, each device is its own little browser: a VM
   context with its own storage, running the real modules, reaching the
   others through a pretend PeerJS broker. Checked:

   - Swiss pairing over many made-up tournaments of 3 to 16 players: each
     player once a round, a bye only with an odd count and never twice
     while someone has had none, no rematches while they can be avoided,
     winners paired with winners, nobody paired after dropping;
   - the standings against a tournament worked out by hand (points, then
     OMW%, GW% and OGW%, with the floor of a third), and a view at the end
     of a game read as a match's result;
   - a 4-player and a 5-player tournament run end to end between devices:
     invitations, the tables opened and relayed, results reported by both
     sides, reports that disagree and one that never comes settled by the
     organiser, a player dropping, the final standings the same everywhere;
   - a player away while the round moves on, a report made while the
     organiser is away, and both apps closed and opened again part way;
   - hostile messages: from someone who is not the organiser, for a match
     that is not theirs, with junk for numbers and names, too many
     invitations at once;
   - the windows (the Friends window's Tournaments tab, a tournament's
     window, the notes) on a pretend DOM (tools/fakedom.js), clicked
     through from three devices;
   - after an online draft, the game waiting for every person's deck.

   node tools/tournamenttest.js     A failure exits non-zero. Run by tools/check.py ('tournaments'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const MODULES = ['00-core.js', '04-formats.js', '09c-friends.js', '09f-tourney.js'];
const CODE = MODULES.map(f => [f, SRC(f)]);

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await sleep(5); }
  if (what) check(false, 'timed out: ' + what);
  return false;
}
const near = (a, b) => Math.abs(a - b) < 1e-4;

/* ---------------- a pretend PeerJS broker (as tools/socialtest.js) ---------------- */
class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) { if (!this._h.has(ev)) this._h.set(ev, []); this._h.get(ev).push(fn); return this; }
  _emit(ev, ...a) { for (const fn of (this._h.get(ev) || []).slice()) fn(...a); }
}
class Broker {
  constructor() { this.peers = new Map(); this.seq = 0; this.drop = null; this.sent = []; }
  makePeerClass() {
    const broker = this;
    class FakeConn extends Emitter {
      constructor(owner, remoteId, opts) {
        super();
        this.owner = owner; this.peer = remoteId; this.open = false; this.other = null; this.gone = false;
        this.metadata = opts && opts.metadata; this.dataChannel = { bufferedAmount: 0 };
        owner.conns.add(this);
      }
      _open() { if (this.gone) return; this.open = true; this._emit('open'); }
      send(msg) {
        if (!this.open) throw new Error('send on a closed connection');
        const copy = JSON.parse(JSON.stringify(msg));
        broker.sent.push(copy);
        if (broker.drop && broker.drop(copy, this)) return;
        const to = this.other;
        setTimeout(() => { if (to && to.open && !to.gone) to._emit('data', copy); }, 1);
      }
      close() {
        if (this.gone) return;
        this.gone = true; this.open = false;
        this.owner.conns.delete(this);
        setTimeout(() => this._emit('close'), 0);
        if (this.other) setTimeout(() => this.other.close(), 2);
      }
    }
    class FakePeer extends Emitter {
      constructor(id) {
        super();
        this.id = id || ('anon-' + (++broker.seq));
        this.conns = new Set(); this.destroyed = false; this.disconnected = false;
        setTimeout(() => {
          if (this.destroyed) return;
          const had = broker.peers.get(this.id);
          if (had && had !== this && !had.destroyed && !had.disconnected) {
            this.destroyed = true;
            this._emit('error', { type: 'unavailable-id', message: `ID "${this.id}" is taken` });
            return;
          }
          broker.peers.set(this.id, this);
          this._emit('open', this.id);
        }, 2);
      }
      connect(id, opts) {
        const local = new FakeConn(this, id, opts);
        setTimeout(() => {
          const far = broker.peers.get(id);
          if (!far || far.destroyed || far.disconnected || this.destroyed) {
            this._emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + id });
            return;
          }
          const remote = new FakeConn(far, this.id, opts);
          local.other = remote; remote.other = local;
          far._emit('connection', remote);
          setTimeout(() => { remote._open(); local._open(); }, 2);
        }, 2);
        return local;
      }
      disconnect() { this.disconnected = true; if (broker.peers.get(this.id) === this) broker.peers.delete(this.id); this._emit('disconnected'); }
      reconnect() { this.disconnected = false; broker.peers.set(this.id, this); setTimeout(() => this._emit('open', this.id), 2); }
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const c of [...this.conns]) c.close();
        if (broker.peers.get(this.id) === this) broker.peers.delete(this.id);
      }
    }
    return FakePeer;
  }
}

/* ---------------- a device ---------------- */
const TIMING = { sweep: 150, stagger: 3, attempt: 300, ping: 80, quiet: 600, stranger: 400, retry: 250 };
const memStorage = (store) => ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => Array.from(store.keys())[i],
  get length() { return store.size; },
});
/** A device: `opts.store` carries one device's storage over to the next (the app closed and opened again). */
function device(name, broker, opts) {
  opts = opts || {};
  const store = opts.store || new Map();
  const fakeEl = () => ({
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    appendChild(c) { return c; }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, performance,
    crypto: nodeCrypto.webcrypto, unescape, encodeURIComponent, localStorage: memStorage(store),
    document: { documentElement: fakeEl(), body: fakeEl(), createElement: fakeEl, createTextNode: (t) => ({ textContent: t }),
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    location: { search: '', href: 'http://localhost/' },
    navigator: {}, innerWidth: 1440, innerHeight: 900,
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const [file, code] of CODE) vm.runInContext(code, ctx, { filename: file });
  const MTG = ctx.MTG;
  const me = { name, avatar: null, frame: null };
  const Peer = broker.makePeerClass();
  const hub = MTG.friendsCore.createHub({
    Peer: () => Peer, store: MTG.store, timing: TIMING,
    getCode: () => MTG.settings.friendCode, setCode: (c) => MTG.setSetting('friendCode', c),
    profile: () => me, peerOptions: () => ({}),
  });
  MTG.tourney.attach(hub);
  const T = MTG.tourney;
  const events = [];
  for (const ev of ['invite', 'paired', 'room', 'settled', 'dispute', 'finished', 'cancelled', 'removed', 'reported']) T.on(ev, (...a) => events.push([ev, ...a]));
  return { name, ctx, MTG, hub, store, me, T, events, get code() { return hub.code; } };
}
const entryOf = (d, code) => d.hub.entries().find(e => e.code === code);
async function befriend(a, b) {
  a.hub.add(b.code);
  await until(() => entryOf(b, a.code) && entryOf(b, a.code).state === 'in', 3000, `${b.name} gets ${a.name}'s request`);
  b.hub.accept(a.code);
  await until(() => a.hub.isOnline(b.code) && b.hub.isOnline(a.code), 3000, `${a.name} and ${b.name} become friends`);
}
async function online(devs) {
  for (const d of devs) d.hub.start();
  await until(() => devs.every(d => d.hub.status === 'online'), 3000, 'every device reaches the broker');
}

/* ---------------- tournaments made up on the spot, for the pieces on their own ---------------- */
/** A tournament with players named by `names`, as the organiser would have it once started. */
function madeUp(FC, names, bo) {
  const players = names.map((n, i) => ({ code: FC.makeCode(8), name: n, st: 'in', seed: i }));
  return { v: 1, id: 'a'.repeat(24), org: players[0].code, name: 'Test', fmt: 'modern', bo: bo || 3, rounds: 3, state: 'running', at: 1, done: 0, rev: 1, players, rnds: [] };
}
const codeOf = (t, name) => t.players.find(p => p.name === name).code;
/** A round written out by hand: [[a, b, aWins, bWins, draws], ...] by name; b null for a bye. */
function handRound(t, rows) {
  t.rnds.push({ pairs: rows.map((r, i) => (r[1] == null
    ? { t: i + 1, a: codeOf(t, r[0]), b: null, res: { a: 2, b: 0, d: 0 }, by: 'bye', rep: {}, room: null }
    : { t: i + 1, a: codeOf(t, r[0]), b: codeOf(t, r[1]), res: { a: r[2], b: r[3], d: r[4] || 0 }, by: 'org', rep: {}, room: null })) });
}

/* ============================================================ */
async function main() {
  const solo = device('Solo', new Broker());
  const T = solo.T, FC = solo.MTG.friendsCore;

  /* ---------------- results ---------------- */
  check(!!T.cleanResult({ a: 2, b: 1, d: 0 }, 3) && !!T.cleanResult({ a: 1, b: 1, d: 1 }, 3) && !!T.cleanResult({ a: 0, b: 0, d: 0 }, 3), 'results a best-of-three can have are taken');
  check(!T.cleanResult({ a: 2, b: 2, d: 0 }, 3) && !T.cleanResult({ a: 3, b: 0, d: 0 }, 3) && !T.cleanResult({ a: 2, b: 1, d: 1 }, 3), 'and ones it cannot are not');
  check(!!T.cleanResult({ a: 1, b: 0, d: 0 }, 1) && !T.cleanResult({ a: 1, b: 1, d: 0 }, 1) && !T.cleanResult({ a: 2, b: 0, d: 0 }, 1), 'best of one: one game');
  check(!T.cleanResult({ a: -1, b: 0, d: 0 }, 3) && !T.cleanResult({ a: '2', b: 0, d: 0 }, 3) && !T.cleanResult({ a: 1.5, b: 0, d: 0 }, 3) && !T.cleanResult(null, 3), 'junk is not a result');
  check(T.defaultRounds(3) === 2 && T.defaultRounds(4) === 2 && T.defaultRounds(5) === 3 && T.defaultRounds(8) === 3 && T.defaultRounds(9) === 4 && T.defaultRounds(16) === 4, 'rounds to suit the players: enough for one to be left unbeaten');

  /* ---------------- the standings, worked out by hand ----------------
     Four players, best of three, three rounds:
       round 1  Ann 2-0 Ben     Cat 2-1 Dan
       round 2  Ann 2-1 Cat     Ben 1-1-1 Dan (a drawn game: a drawn match)
       round 3  Dan 2-0 Ann     Ben 2-0 Cat
     Match points: Ann 6, Ben 4, Dan 4, Cat 3.
     MW%: Ann 6/9, Ben 4/9, Dan 4/9, Cat 3/9 (exactly the floor).
     GW%: Ann 4-3 = 12/21; Ben 3-3-1 = 10/21; Cat 3-5 = 9/24; Dan 4-3-1 = 13/24.
     OMW%: Ann (Ben, Cat, Dan) = (4+3+4)/27 = 11/27; Ben (Ann, Dan, Cat) = 13/27;
           Cat (Dan, Ann, Ben) = 14/27; Dan (Cat, Ben, Ann) = 13/27.
     Ben and Dan are level on points and on OMW%, so GW% decides: Dan
     second, Ben third. OGW%: Ann = (10/21 + 9/24 + 13/24)/3. */
  const hand = madeUp(FC, ['Ann', 'Ben', 'Cat', 'Dan']);
  handRound(hand, [['Ann', 'Ben', 2, 0], ['Cat', 'Dan', 2, 1]]);
  handRound(hand, [['Ann', 'Cat', 2, 1], ['Ben', 'Dan', 1, 1, 1]]);
  handRound(hand, [['Dan', 'Ann', 2, 0], ['Ben', 'Cat', 2, 0]]);
  const st = T.standings(hand);
  const row = (n) => st.find(r => r.name === n);
  check(st.map(r => r.name).join(',') === 'Ann,Dan,Ben,Cat', 'the order: points, then OMW%, then GW% (' + st.map(r => r.name).join(',') + ')');
  check(row('Ann').mp === 6 && row('Ben').mp === 4 && row('Dan').mp === 4 && row('Cat').mp === 3, 'match points: 3 a win, 1 a draw');
  check(row('Ben').w === 1 && row('Ben').l === 1 && row('Ben').d === 1, 'a drawn match is a draw in the record');
  check(near(row('Ann').omw, 11 / 27) && near(row('Ben').omw, 13 / 27) && near(row('Cat').omw, 14 / 27) && near(row('Dan').omw, 13 / 27), 'OMW% as worked out');
  check(near(row('Ann').gwp, 12 / 21) && near(row('Ben').gwp, 10 / 21) && near(row('Cat').gwp, 9 / 24) && near(row('Dan').gwp, 13 / 24), 'GW% as worked out, a drawn game a point');
  check(near(row('Ann').ogw, (10 / 21 + 9 / 24 + 13 / 24) / 3) && near(row('Dan').ogw, (9 / 24 + 10 / 21 + 12 / 21) / 3), 'OGW% as worked out');

  /* The floor: Eve loses every game. Her own MW% is 0, but as an
     opponent she counts a third; a bye is a 2-0 win for its player and
     no opponent for anyone.
       round 1  Fay 2-0 Eve     Gus bye
       round 2  Gus 2-1 Fay     Eve bye
       round 3  Gus 2-0 Eve     Fay bye
     Fay: 6 points over 3 rounds; her opponents are Eve (0, floored to
     1/3) and Gus (9 of 9) = (1/3 + 1)/2 = 2/3. Gus: opponents Fay (6/9)
     and Eve (1/3) = 1/2. Eve: GW% 2 of 6 games is 1/3 (her bye's two
     games), exactly the floor. */
  const fl = madeUp(FC, ['Eve', 'Fay', 'Gus']);
  handRound(fl, [['Fay', 'Eve', 2, 0], ['Gus', null]]);
  handRound(fl, [['Gus', 'Fay', 2, 1], ['Eve', null]]);
  handRound(fl, [['Gus', 'Eve', 2, 0], ['Fay', null]]);
  const fs2 = T.standings(fl);
  const frow = (n) => fs2.find(r => r.name === n);
  check(fs2.map(r => r.name).join(',') === 'Gus,Fay,Eve', 'with byes: Gus, Fay, Eve');
  check(near(frow('Fay').omw, 2 / 3) && near(frow('Gus').omw, 1 / 2), 'an opponent with nothing won counts a third, and a bye is nobody');
  check(frow('Eve').mp === 3 && frow('Eve').byes === 1 && near(frow('Eve').gwp, 1 / 3), 'a bye is three points and two games won');
  check(near(frow('Eve').omw, (frow('Fay').mwp + frow('Gus').mwp) / 2) && near(frow('Fay').mwp, 2 / 3), 'and Eve’s opponents are only the two she played');

  /* ---------------- a game's end, read as a match's result ---------------- */
  const view = (o) => Object.assign({ over: true, players: [{ id: 'me' }, { id: 'you' }], winners: [] }, o);
  const rv = (o) => JSON.stringify(T.resultFromView(view(o), 'me'));
  check(rv({ winners: ['me'] }) === '{"w":1,"l":0,"d":0}' && rv({ winners: ['you'] }) === '{"w":0,"l":1,"d":0}' && rv({}) === '{"w":0,"l":0,"d":1}', 'a single game: won, lost or drawn');
  check(T.resultFromView(view({ winners: ['me'], match: { best: 3, decided: false, gameNumber: 1, scores: [{ id: 'me', wins: 1 }, { id: 'you', wins: 0 }] } }), 'me') === null, 'a match not yet decided is not a result');
  check(rv({ winners: ['you'], match: { best: 3, decided: true, gameNumber: 3, scores: [{ id: 'me', wins: 2 }, { id: 'you', wins: 1 }] } }) === '{"w":2,"l":1,"d":0}', 'a decided match: the games each won');
  check(rv({ winners: [], match: { best: 3, decided: true, gameNumber: 3, scores: [{ id: 'me', wins: 1 }, { id: 'you', wins: 1 }] } }) === '{"w":1,"l":1,"d":1}', 'with a drawn game in it');
  check(T.resultFromView(view({ players: [{ id: 'me' }, { id: 'you' }, { id: 'them' }], winners: ['me'] }), 'me') === null, 'a game of three is no tournament match');
  check(T.resultFromView(view({ winners: ['me'], spectating: true }), 'me') === null && T.resultFromView(view({ over: false }), 'me') === null, 'nor is a game watched, or one still going');

  /* ---------------- Swiss pairing, over many made-up tournaments ---------------- */
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let rematches = 0, badRounds = 0, missedByes = 0, runs = 0, droppedPaired = 0;
  const firstPairs = new Set();
  for (let n = 3; n <= 16; n++) {
    for (let k = 0; k < 12; k++) {
      runs++;
      const t = madeUp(FC, Array.from({ length: n }, (x, i) => 'P' + i), 3);
      t.rounds = T.defaultRounds(n) + (n >= 6 && k % 3 === 0 ? 1 : 0);
      // seats drawn as the organiser would
      const order = t.players.slice().sort(() => rand() - 0.5);
      order.forEach((p, i) => { p.seed = i; });
      const dropAt = k % 4 === 1 && n > 4 ? 2 : 0;
      const seen = new Set(), byes = new Set();
      for (let r = 1; r <= t.rounds; r++) {
        if (dropAt && r === dropAt) t.players[n - 1].st = 'dropped';
        const before = new Set([...byes]);
        const lacked = t.players.filter(p => p.st === 'in' && !before.has(p.code)).length;
        T.pairRound(t, rand);
        const round = t.rnds[t.rnds.length - 1];
        const active = t.players.filter(p => p.st === 'in').map(p => p.code);
        const seated = round.pairs.flatMap(p => [p.a, p.b]).filter(Boolean);
        if (seated.length !== active.length || new Set(seated).size !== seated.length || !active.every(c => seated.includes(c))) badRounds++;
        if (seated.some(c => t.players.find(p => p.code === c).st !== 'in')) droppedPaired++;
        const byePairs = round.pairs.filter(p => !p.b);
        if (byePairs.length !== active.length % 2) badRounds++;
        for (const p of byePairs) { if (byes.has(p.a) && lacked) missedByes++; byes.add(p.a); }
        if (r === 1 && n === 8) firstPairs.add(round.pairs.map(p => p.a + p.b).sort().join());
        for (const p of round.pairs) {
          if (!p.b) continue;
          const key = [p.a, p.b].sort().join('|');
          if (seen.has(key) && r <= T.defaultRounds(n) && n >= 4) rematches++;
          seen.add(key);
          // the better player (by seat) usually wins, but not always
          const aBetter = t.players.find(x => x.code === p.a).seed < t.players.find(x => x.code === p.b).seed;
          const aWins = rand() < (aBetter ? 0.7 : 0.3);
          p.res = rand() < 0.1 ? { a: 1, b: 1, d: 1 } : aWins ? { a: 2, b: rand() < 0.5 ? 0 : 1, d: 0 } : { a: rand() < 0.5 ? 0 : 1, b: 2, d: 0 };
          p.by = 'org';
        }
      }
    }
  }
  check(!badRounds, `every round seats each player still in exactly once, a bye only with an odd count (${badRounds} bad rounds in ${runs} tournaments)`);
  check(!droppedPaired, 'nobody is paired after dropping');
  check(!missedByes, `nobody has a second bye while someone else has had none (${missedByes})`);
  check(!rematches, `no rematches while the rounds allow it (${rematches} in ${runs} tournaments)`);
  check(firstPairs.size > 1, 'round one is drawn at random');
  // winners meet winners: eight players after a round, four on 3 points and four on none
  const w8 = madeUp(FC, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  handRound(w8, [['A', 'B', 2, 0], ['C', 'D', 2, 1], ['E', 'F', 0, 2], ['G', 'H', 1, 2]]);
  const winners = new Set(['A', 'C', 'F', 'H'].map(n => codeOf(w8, n)));
  T.pairRound(w8, rand);
  check(w8.rnds[1].pairs.every(p => winners.has(p.a) === winners.has(p.b)), 'round two pairs winners with winners');
  const tablesOf = (won) => w8.rnds[1].pairs.filter(p => winners.has(p.a) === won).map(p => p.t);
  check(Math.max(...tablesOf(true)) < Math.min(...tablesOf(false)), 'and the winners sit at the top tables');
  // three players, three rounds: everyone has one bye and plays the other two once
  const three = madeUp(FC, ['X', 'Y', 'Z']);
  three.rounds = 3;
  for (let r = 0; r < 3; r++) { T.pairRound(three, rand); for (const p of three.rnds[r].pairs) if (p.b) { p.res = { a: 2, b: 0, d: 0 }; p.by = 'org'; } }
  const byeHolders = three.rnds.map(r => r.pairs.find(p => !p.b).a);
  check(new Set(byeHolders).size === 3, 'three players over three rounds: a bye each');
  check(new Set(three.rnds.flatMap(r => r.pairs.filter(p => p.b).map(p => [p.a, p.b].sort().join()))).size === 3, 'and each pair meets once');

  /* ---------------- what arrives, checked ---------------- */
  const good = Object.assign(T.pub(hand), { rev: 3 });
  check(!!T.readT(JSON.parse(JSON.stringify(good))), 'a real tournament reads');
  const bad = (f) => { const x = JSON.parse(JSON.stringify(good)); f(x); return T.readT(x) === null; };
  check(bad(x => { x.fmt = 'booster'; }) && bad(x => { x.fmt = 'nonsense'; }), 'a limited format, or none, is refused');
  check(bad(x => { x.bo = 2; }) && bad(x => { x.rounds = 99; }) && bad(x => { x.state = 'party'; }), 'a match length, a round count or a state that cannot be is refused');
  check(bad(x => { x.players = new Array(17).fill(0).map(() => ({ code: FC.makeCode(8), name: 'x', st: 'in' })); }), 'more than sixteen players is refused');
  check(bad(x => { x.players.push(Object.assign({}, x.players[0])); }) && bad(x => { x.players[1].code = 'ZZZZZZZZ'; }), 'a player twice, or a code that cannot be one, is refused');
  check(bad(x => { x.rnds[0].pairs[0].b = x.rnds[0].pairs[0].a; }) && bad(x => { x.rnds[0].pairs[1].a = x.rnds[0].pairs[0].a; }), 'a player against themselves, or twice in a round, is refused');
  check(bad(x => { x.rnds[0].pairs[0].res = { a: 5, b: 0, d: 0 }; }) && bad(x => { x.rnds[0].pairs[0].a = FC.makeCode(8); }), 'a result that cannot be, or a stranger in a pairing, is refused');
  check(bad(x => { x.org = FC.makeCode(8); }), 'an organiser who is not playing is refused');
  const junky = T.readT(Object.assign(JSON.parse(JSON.stringify(good)), { name: '\u202eevil\u0000' + 'x'.repeat(200) }));
  check(junky && junky.name.length <= 40 && !/[\u0000\u202e]/.test(junky.name), 'a name is made plain and short');
  const proto = JSON.parse(JSON.stringify(good));
  proto.rnds[0].pairs[0].rep = JSON.parse('{"__proto__": {"a": 1, "b": 0, "d": 0}, "constructor": 5}');
  const pr = T.readT(proto);
  check(pr && Object.keys(pr.rnds[0].pairs[0].rep).length === 0 && ({}).a === undefined, 'reports under keys that are not players are dropped, and nothing leaks onto every object');
  const byeLie = JSON.parse(JSON.stringify(T.pub(fl)));
  byeLie.rnds[0].pairs[1].res = { a: 0, b: 2, d: 0 };
  check(T.readT(byeLie).rnds[0].pairs[1].res.a === 2, 'a bye is a 2-0 win whatever is said of it');

  await devicesRun();
  await botsRun();
  await invitesRun();
  await tablesRun();
  await windowsRun();
  await botWindowsRun();
  await draftRun();
  console.log(`tournaments: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

/* ============================================================
   Devices: tournaments played between them
   ============================================================ */
/** Every device's copy of `id`, once it has the organiser's newest. */
const copies = (devs, id) => devs.map(d => d.T.get(id));
const inStep = (org, devs, id) => { const o = org.T.get(id); return devs.every(d => { const t = d.T.get(id); return t && t.rev === o.rev; }); };
/** Play out the current round of `id`: each table opened by its host, and both sides' results reported as `decide` says. */
async function playRound(org, devs, id, decide, opts) {
  opts = opts || {};
  const all = [org].concat(devs);
  const byCode = new Map(all.map(d => [d.code, d]));
  await until(() => inStep(org, devs, id), 2000, 'everyone has the round before it is played');
  const t = org.T.get(id);
  const r = t.rnds.length;
  for (const p of t.rnds[r - 1].pairs) {
    if (!p.b || p.res) continue;
    const host = byCode.get(p.a), guest = byCode.get(p.b);
    const room = 'R' + 'ABCDEFGHJK'[r] + 'ABCDEFGHJK'[p.t] + 'X';
    check(host.T.roomOpened(id, r, p.t, room), `${host.name} opens the table for round ${r}`);
    await until(() => (guest.T.myMatch(guest.T.get(id)) || {}).room === room, 2000, `${guest.name} hears the room for round ${r}`);
    const res = decide(host, guest, r);       // { a, b, d }: the host's games first
    if (!res) continue;
    const skip = opts.skip || (() => false);
    if (!skip(host, r)) host.T.gameOver(room, { w: res.a, l: res.b, d: res.d });
    if (!skip(guest, r)) guest.T.gameOver(room, { w: res.b, l: res.a, d: res.d });
  }
}

async function devicesRun() {
  /* ---------------- four players, end to end ---------------- */
  const broker = new Broker();
  const ann = device('Ann', broker), ben = device('Ben', broker), cat = device('Cat', broker), dan = device('Dan', broker);
  await online([ann, ben, cat, dan]);
  for (const d of [ben, cat, dan]) await befriend(ann, d);
  check(!!ann.T.create({ name: 'x', fmt: 'modern', bo: 3, invite: [ben.code] }).why, 'two players are too few to invite');
  check(!!ann.T.create({ name: 'x', fmt: 'booster', bo: 3, invite: [ben.code, cat.code] }).why, 'a draft format is refused');
  check(!!ann.T.create({ name: 'x', fmt: 'modern', bo: 3, invite: [ben.code, FC_make(ann)] }).why, 'only friends can be invited');
  const t4 = ann.T.create({ name: 'Friday Modern', fmt: 'modern', bo: 3, rounds: 0, invite: [ben.code, cat.code, dan.code] });
  check(t4 && t4.id && t4.state === 'inviting', 'Ann sets up a tournament');
  const id4 = t4.id;
  await until(() => [ben, cat, dan].every(d => d.T.invites().length === 1), 2000, 'each friend is invited');
  check(ben.events.some(e => e[0] === 'invite' && e[1].id === id4), 'with an invite to answer');
  check(ann.T.start(id4) !== '', 'it cannot start with only Ann in');
  for (const d of [ben, cat, dan]) check(d.T.answer(id4, true), `${d.name} says yes`);
  await until(() => ann.T.get(id4).players.filter(p => p.st === 'in').length === 4, 2000, 'Ann sees all four in');
  check(ann.T.start(id4) === '', 'Ann starts it');
  await until(() => inStep(ann, [ben, cat, dan], id4) && ben.T.get(id4).state === 'running', 2000, 'everyone has round one');
  check(ann.T.get(id4).rounds === 2, 'four players: two rounds');
  check([ann, ben, cat, dan].every(d => d.events.some(e => e[0] === 'paired' && e[3] === 1)), 'every player hears their round one pairing');
  // the stronger player wins, 2-1: Ann, then Ben, then Cat, then Dan
  const strength = { Ann: 4, Ben: 3, Cat: 2, Dan: 1 };
  const stronger = (host, guest) => (strength[host.name] > strength[guest.name] ? { a: 2, b: 1, d: 0 } : { a: 1, b: 2, d: 0 });
  await playRound(ann, [ben, cat, dan], id4, stronger);
  await until(() => ann.T.get(id4).rnds.length === 2 && inStep(ann, [ben, cat, dan], id4), 3000, 'two reports that agree settle each match, and round two is paired');
  const r1 = ann.T.get(id4).rnds[0].pairs;
  check(r1.every(p => p.res && p.by === 'agreed'), 'round one settled by agreement');
  await playRound(ann, [ben, cat, dan], id4, stronger);
  await until(() => ann.T.get(id4).state === 'done' && inStep(ann, [ben, cat, dan], id4), 3000, 'the last round settles and the tournament is over');
  const final4 = ann.T.standings(ann.T.get(id4));
  check(final4[0].name === 'Ann' && final4[0].mp === 6 && final4[final4.length - 1].name === 'Dan', 'Ann wins it with two wins; Dan is last');
  check([ben, cat, dan].every(d => JSON.stringify(d.T.standings(d.T.get(id4)).map(r => [r.code, r.mp, r.omw.toFixed(6)])) === JSON.stringify(final4.map(r => [r.code, r.mp, r.omw.toFixed(6)]))), 'every device shows the same final standings');
  check([ann, ben, cat, dan].every(d => d.events.some(e => e[0] === 'finished')), 'and everyone hears it is over');
  const met = new Set();
  let again = 0;
  for (const r of ann.T.get(id4).rnds) for (const p of r.pairs) { const k = [p.a, p.b].sort().join(); if (met.has(k)) again++; met.add(k); }
  check(!again, 'nobody met anybody twice');
  check(ben.T.finished().length === 1 && ben.T.active().length === 0, 'it is in everyone’s history');

  /* ---------------- five players: a bye, a disagreement, a report that never comes, a drop ---------------- */
  const eve = device('Eve', broker);
  await online([eve]);
  await befriend(ann, eve);
  const t5 = ann.T.create({ name: 'Five', fmt: 'pauper', bo: 1, rounds: 3, invite: [ben.code, cat.code, dan.code, eve.code] });
  const id5 = t5.id;
  await until(() => [ben, cat, dan, eve].every(d => d.T.invites().length === 1), 2000, 'four friends invited');
  dan.T.answer(id5, false);
  for (const d of [ben, cat, eve]) d.T.answer(id5, true);
  await until(() => ann.T.get(id5).players.filter(p => p.st === 'in').length === 4 && ann.T.get(id5).players.some(p => p.st === 'declined'), 2000, 'Dan says no; the rest are in');
  check(!dan.T.get(id5), 'Dan’s invitation is gone from his list');
  // Dan changes his mind too late: Ann asks him again by inviting nobody new, and starts with four... so five needs another
  const fay = device('Fay', broker);
  await online([fay]);
  await befriend(ann, fay);
  check(ann.T.start(id5) === '', 'Ann could start with four');
  await until(() => inStep(ann, [ben, cat, eve], id5), 2000, 'the four have round one');
  check(ann.T.get(id5).players.length === 4, 'whoever said no is not in the standings');
  ann.T.cancel(id5);
  await until(() => [ben, cat, eve].every(d => d.T.get(id5) && d.T.get(id5).state === 'cancelled'), 2000, 'Ann calls it off, and everyone hears');
  check(eve.events.some(e => e[0] === 'cancelled' && e[1].id === id5), 'as a note');

  const t5b = ann.T.create({ name: 'Five again', fmt: 'pauper', bo: 1, rounds: 3, invite: [ben.code, cat.code, eve.code, fay.code] });
  const id5b = t5b.id;
  await until(() => [ben, cat, eve, fay].every(d => d.T.get(id5b)), 2000, 'four friends invited again');
  for (const d of [ben, cat, eve, fay]) d.T.answer(id5b, true);
  await until(() => ann.T.get(id5b).players.filter(p => p.st === 'in').length === 5, 2000, 'five in');
  check(ann.T.start(id5b) === '', 'five start');
  const five = [ben, cat, eve, fay];
  await until(() => inStep(ann, five, id5b), 2000, 'everyone has round one');
  const r1b = ann.T.get(id5b).rnds[0].pairs;
  check(r1b.length === 3 && r1b.filter(p => !p.b).length === 1 && r1b[2].b === null, 'five players: two matches and a bye, the bye last');
  const byeCode = r1b[2].a;
  const byeDev = [ann].concat(five).find(d => d.code === byeCode);
  check(byeDev.T.myMatch(byeDev.T.get(id5b)).bye, `${byeDev.name} sees the bye`);
  // table one: both report, but they disagree; table two: only the host reports
  const all5 = [ann].concat(five);
  const dev = (code) => all5.find(d => d.code === code);
  const [p1, p2] = r1b;
  const h1 = dev(p1.a), g1 = dev(p1.b), h2 = dev(p2.a), g2 = dev(p2.b);
  h1.T.roomOpened(id5b, 1, 1, 'TABAA'); h2.T.roomOpened(id5b, 1, 2, 'TABBB');
  await until(() => (g1.T.myMatch(g1.T.get(id5b)) || {}).room === 'TABAA' && (g2.T.myMatch(g2.T.get(id5b)) || {}).room === 'TABBB', 2000, 'both guests hear their rooms');
  check(g1.events.some(e => e[0] === 'room' && e[3] === 'TABAA') || h1 === ann || g1 === ann, `${g1.name} gets a note that the table is open`);
  h1.T.gameOver('TABAA', { w: 1, l: 0, d: 0 });
  g1.T.gameOver('TABAA', { w: 1, l: 0, d: 0 });      // both say they won
  h2.T.gameOver('TABBB', { w: 0, l: 1, d: 0 });
  await until(() => { const p = ann.T.get(id5b).rnds[0].pairs; return p[0].rep[p[0].a] && p[0].rep[p[0].b] && p[1].rep[p[1].a]; }, 2000, 'Ann has the three reports');
  const now5 = ann.T.get(id5b).rnds[0].pairs;
  check(!now5[0].res && ann.T.disputed(now5[0]), 'reports that disagree settle nothing: the match is in dispute');
  check(ann.events.some(e => e[0] === 'dispute' && e[2].t === 1), 'and Ann is told');
  check(!now5[1].res && !ann.T.disputed(now5[1]), 'one report alone settles nothing either');
  check(ann.T.get(id5b).rnds.length === 1, 'so round two waits');
  check(g1.T.report(id5b, 1, 1, 0, 2, 0).why, 'a report a best-of-one cannot have is refused');
  check(ann.T.setResult(id5b, 1, 1, { a: 1, b: 0, d: 0 }) === '', 'Ann settles the dispute by hand');
  check(ann.T.setResult(id5b, 1, 2, { a: 0, b: 1, d: 0 }) === '', 'and takes the lone report for table two');
  await until(() => ann.T.get(id5b).rnds.length === 2 && inStep(ann, five, id5b), 2000, 'then round two is paired for everyone');
  check(ann.T.get(id5b).rnds[0].pairs[0].by === 'org', 'the result says Ann set it');
  const r2b = ann.T.get(id5b).rnds[1].pairs;
  check(r2b.find(p => !p.b).a !== byeCode, 'the bye goes to someone else in round two');
  // somebody drops in the middle of round two: their match goes to the other player
  const dropper = dev(r2b[0].b);
  const winnerByDrop = r2b[0].a;
  check(dropper.T.leave(id5b), `${dropper.name} drops out`);
  await until(() => ann.T.get(id5b).players.find(p => p.code === dropper.code).st === 'dropped', 2000, 'Ann hears it');
  check(ann.T.get(id5b).rnds[1].pairs[0].by === 'drop' && ann.T.get(id5b).rnds[1].pairs[0].res.a === 1, 'their match is won by the other player');
  await until(() => dropper.T.get(id5b).rev === ann.T.get(id5b).rev && !dropper.T.get(id5b).pend.drop, 2000, 'and the dropper’s copy says so too');
  await playRound(ann, five, id5b, () => ({ a: 1, b: 0, d: 0 }));
  await until(() => ann.T.get(id5b).rnds.length === 3, 2000, 'round three is paired');
  const r3b = ann.T.get(id5b).rnds[2].pairs;
  check(!r3b.some(p => p.a === dropper.code || p.b === dropper.code), 'without the player who dropped');
  check(r3b.length === 2 && !r3b.some(p => !p.b), 'four left: two matches, no bye');
  await playRound(ann, five, id5b, () => ({ a: 0, b: 1, d: 0 }));
  await until(() => ann.T.get(id5b).state === 'done' && inStep(ann, five, id5b), 2000, 'the five-player tournament ends');
  const final5 = ann.T.standings(ann.T.get(id5b));
  check(five.every(d => JSON.stringify(d.T.standings(d.T.get(id5b)).map(r => r.code)) === JSON.stringify(final5.map(r => r.code))), 'every device has the same final order');
  check(final5.some(r => r.code === winnerByDrop && r.w >= 1) && final5.find(r => r.code === dropper.code).st === 'dropped', 'the dropped player is in the standings, marked');
  void stronger; void copies;

  /* ---------------- away, and back ---------------- */
  const t3 = ann.T.create({ name: 'Away', fmt: 'standard', bo: 3, rounds: 2, invite: [ben.code, cat.code] });
  const id3 = t3.id;
  await until(() => ben.T.get(id3) && cat.T.get(id3), 2000, 'Ben and Cat invited');
  // Cat is away when she says yes: it goes when Ann is back
  ann.hub.stop();
  await until(() => !cat.hub.isOnline(ann.code), 2000, 'Ann goes away');
  cat.T.answer(id3, true);
  ben.T.answer(id3, true);
  check(cat.T.get(id3).pend.yes, 'Cat’s yes waits to be sent');
  ann.hub.start();
  await until(() => ann.T.get(id3).players.filter(p => p.st === 'in').length === 3, 3000, 'Ann is back and hears both yeses');
  ann.T.start(id3);
  await until(() => inStep(ann, [ben, cat], id3), 2000, 'round one for all three');
  const r13 = ann.T.get(id3).rnds[0].pairs.find(p => p.b);
  const h3 = [ann, ben, cat].find(d => d.code === r13.a), g3 = [ann, ben, cat].find(d => d.code === r13.b);
  h3.T.roomOpened(id3, 1, r13.t, 'AWAYA');
  await until(() => (g3.T.myMatch(g3.T.get(id3)) || {}).room === 'AWAYA', 2000, 'the guest hears the room');
  // the organiser goes away; whoever is not Ann reports into the void, and it arrives later
  const notAnn = [h3, g3].filter(d => d !== ann);
  ann.hub.stop();
  await until(() => notAnn.every(d => !d.hub.isOnline(ann.code)), 2000, 'Ann away again');
  h3.T.gameOver('AWAYA', { w: 2, l: 0, d: 0 });
  g3.T.gameOver('AWAYA', { w: 0, l: 2, d: 0 });
  check(notAnn.every(d => d.T.get(id3).pend.rep), 'reports made while Ann is away wait to be sent');
  // both apps closed: the player's and the organiser's
  const benStore = ben.store, annStore = ann.store;
  ben.hub.stop();
  const ben2 = device('Ben', broker, { store: benStore });
  check(ben2.code === ben.code && ben2.T.get(id3) && ben2.T.get(id3).rev === ben.T.get(id3).rev, 'Ben’s app opened again has his copy of the tournament');
  check(JSON.stringify(ben2.T.get(id3).pend) === JSON.stringify(ben.T.get(id3).pend), 'and what he still owes Ann');
  check(ben2.T.finished().length === ben.T.finished().length, 'and his history');
  const ann2 = device('Ann', broker, { store: annStore });
  check(ann2.T.get(id3) && ann2.T.get(id3).role === 'org' && ann2.T.get(id3).rev === ann.T.get(id3).rev, 'Ann’s app opened again has hers, as the organiser');
  ann2.hub.start(); ben2.hub.start();
  const trio = [ann2, ben2, cat];
  const byCode3 = (code) => trio.find(d => d.code === code);
  await until(() => ann2.T.get(id3).rnds[0].pairs.find(p => p.b).res, 4000, 'once Ann is back the reports arrive and settle the match');
  check(sameJSON(ann2.T.get(id3).rnds[0].pairs.find(p => p.b).res, { a: 2, b: 0, d: 0 }), 'as they were reported');
  await until(() => ann2.T.get(id3).rnds.length === 2 && inStep(ann2, [ben2, cat], id3), 3000, 'round two reaches both');
  check(!ben2.T.get(id3).pend.rep && !cat.T.get(id3).pend.rep, 'nothing is left to send');
  const r23 = ann2.T.get(id3).rnds[1].pairs.find(p => p.b);
  const h23 = byCode3(r23.a), g23 = byCode3(r23.b);
  h23.T.roomOpened(id3, 2, r23.t, 'AWAYB');
  await until(() => (g23.T.myMatch(g23.T.get(id3)) || {}).room === 'AWAYB', 2000, 'round two’s room reaches the guest');
  h23.T.gameOver('AWAYB', { w: 1, l: 1, d: 1 });
  g23.T.gameOver('AWAYB', { w: 1, l: 1, d: 1 });
  await until(() => ann2.T.get(id3).state === 'done' && inStep(ann2, [ben2, cat], id3), 3000, 'a drawn match settles too, and it is over');
  check(ann2.T.standings(ann2.T.get(id3)).some(r => r.d === 1), 'with the draw in the standings');

  /* ---------------- hostile messages ---------------- */
  const t6 = ann2.T.create({ name: 'Hostile', fmt: 'legacy', bo: 3, rounds: 2, invite: [ben2.code, cat.code, eve.code] });
  const id6 = t6.id;
  await until(() => [ben2, cat, eve].every(d => d.T.get(id6)), 2000, 'three invited');
  for (const d of [ben2, cat, eve]) d.T.answer(id6, true);
  await until(() => ann2.T.get(id6).players.filter(p => p.st === 'in').length === 4, 2000, 'all in');
  ann2.T.start(id6);
  await until(() => inStep(ann2, [ben2, cat, eve], id6), 2000, 'round one');
  await befriend(eve, ben2);           // Eve and Ben are friends too, so Eve can try things on Ben
  const snapshot = (d) => JSON.stringify(d.T.get(id6));
  const benBefore = snapshot(ben2), annBefore = snapshot(ann2);
  // Eve pretends to be the organiser: a state for Ann's tournament, sent by Eve
  const forged = JSON.parse(JSON.stringify(ann2.T.pub(ann2.T.get(id6))));
  forged.rev += 50; forged.state = 'done';
  eve.hub.sendTourney(ben2.code, { op: 'state', id: id6, s: forged });
  forged.org = eve.code;
  eve.hub.sendTourney(ben2.code, { op: 'state', id: id6, s: forged });
  eve.hub.sendTourney(ben2.code, { op: 'gone', id: id6, why: 'removed' });
  await sleep(80);
  check(snapshot(ben2) === benBefore, 'someone who is not the organiser cannot change or end a player’s copy');
  // Eve reports a match that is not hers, and nonsense for her own
  const p6 = ann2.T.get(id6).rnds[0].pairs;
  const notEves = p6.find(p => p.a !== eve.code && p.b !== eve.code);
  const eves = p6.find(p => p.a === eve.code || p.b === eve.code);
  const junk = [
    { op: 'report', id: id6, r: 1, tb: notEves.t, w: 2, l: 0, d: 0 },
    { op: 'report', id: id6, r: 1, tb: eves.t, w: 9, l: 0, d: 0 },
    { op: 'report', id: id6, r: 1, tb: eves.t, w: '2', l: 0, d: 0 },
    { op: 'report', id: id6, r: 7, tb: eves.t, w: 2, l: 0, d: 0 },
    { op: 'report', id: id6, r: 1, tb: eves.t, w: 2, l: 2, d: 0 },
    { op: 'room', id: id6, r: 1, tb: notEves.t, room: 'EVILX' },
    { op: 'room', id: id6, r: 1, tb: eves.t, room: '<img>' },
    { op: 'yes', id: 'f'.repeat(24) }, { op: 'state', id: id6 }, { op: 'what', id: id6 }, { op: 'report' }, { id: id6 },
    { op: 'drop', id: 'not an id' },
  ];
  for (const m of junk) eve.hub.sendTourney(ann2.code, m);
  await sleep(100);
  check(snapshot(ann2) === annBefore, 'reports for someone else’s match, impossible results and junk change nothing at the organiser');
  // a friend sending hundreds of messages is let through only so far
  const floodId = 'c'.repeat(24);
  for (let i = 0; i < 300; i++) eve.hub.sendTourney(ann2.code, { op: 'sync', id: floodId, rev: i });
  await sleep(200);
  const answered = broker.sent.filter(m => m.t === 'tn' && m.op === 'gone' && m.id === floodId).length;
  check(answered > 0 && answered <= 120, `a flood of messages is answered only so far (${answered} of 300)`);
  check(ann2.T.get(id6).state === 'running', 'and the tournament carries on');
  // a flood of invitations from one friend: only a couple are kept
  const fakeT = (i) => ({ v: 1, id: (i + 10).toString(16).padStart(24, 'b'), org: eve.code, name: 'Spam ' + i, fmt: 'modern', bo: 1, rounds: 1, state: 'inviting', at: 1, done: 0, rev: 1,
    players: [{ code: eve.code, name: 'Eve', st: 'in', seed: 0 }, { code: ben2.code, name: 'Ben', st: 'invited', seed: 1 }], rnds: [] });
  const invitesBefore = ben2.T.invites().length;
  for (let i = 0; i < 20; i++) eve.hub.sendTourney(ben2.code, { op: 'state', id: fakeT(i).id, s: fakeT(i) });
  await sleep(150);
  check(ben2.T.invites().length - invitesBefore === 2, `a flood of invitations from one friend keeps two (${ben2.T.invites().length - invitesBefore})`);
  // a tournament that says it has started, sent as an invitation, is no invitation
  const started = Object.assign(fakeT(99), { state: 'running' });
  eve.hub.sendTourney(ben2.code, { op: 'state', id: started.id, s: started });
  await sleep(60);
  check(!ben2.T.get(started.id), 'a tournament already under way does not land on anyone’s list');
  // a player's own copy turned down by the line: an older state does not overwrite a newer one
  const older = JSON.parse(JSON.stringify(ann2.T.pub(ann2.T.get(id6))));
  older.rev = 0;
  older.rnds = [];
  older.state = 'inviting';
  ann2.hub.sendTourney(ben2.code, { op: 'state', id: id6, s: older });
  await sleep(60);
  check(ben2.T.get(id6).rnds.length === 1, 'an older copy that arrives late changes nothing');

  for (const d of [ann, ben, cat, dan, eve, fay, ann2, ben2]) d.hub.stop();
}
/* ============================================================
   The windows, on a pretend DOM, clicked through from three devices
   ============================================================ */
const UI_MODULES = ['00-core.js', '04-formats.js', '09-net.js', '10c-economy.js', '09c-friends.js', '09d-trade.js', '09e-move.js', '09f-tourney.js',
  '10-ui-core.js', '10b-ui-avatar.js', '10g-ui-social.js', '10h-ui-trade.js', '10i-ui-tourney.js'];
const UI_CODE = UI_MODULES.map(f => [f, SRC(f)]);
function uiDevice(name, broker, roomBase) {
  const { Document } = require('./fakedom');
  const store = new Map();
  const doc = new Document();
  const timers = [];
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, TextEncoder, performance, URLSearchParams,
    setInterval: (f, ms) => { const t = setInterval(f, ms); timers.push(t); return t; },
    crypto: nodeCrypto.webcrypto, unescape, encodeURIComponent, document: doc, Blob: class {}, localStorage: memStorage(store),
    location: { search: '', pathname: '/play/', origin: 'https://example.com', hash: '', href: 'https://example.com/play/' },
    history: { state: null, replaceState() {} },
    navigator: {}, innerWidth: 1440, innerHeight: 900, CSS: { escape: (s) => s },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
  };
  ctx.window = ctx;
  ctx.Peer = broker.makePeerClass();
  vm.createContext(ctx);
  const run = (file, code) => vm.runInContext(code, ctx, { filename: file });
  run('00-core.js', UI_CODE[0][1]);
  const MTG = ctx.MTG;
  MTG.sfx = () => {};
  MTG.scry = { imageUrl: () => '', forgetArt() {}, byId: async () => null, byName: async () => null, collection: async () => ({ cards: [] }) };
  for (const [file, code] of UI_CODE.slice(1)) run(file, code);
  MTG.settings.playerName = name;
  MTG.decks = { index: () => [], load: async () => null };
  let rooms = 0;
  const app = MTG.app = {
    screen: 'home', myName: name, joined: [], hosted: [], formatId: 'modern',
    joinRoom(code) { app.joined.push(code); },
    async hostTableFor(o) { app.hosted.push(o); return roomBase + 'ABCDEFGH'[rooms++]; },
    async exitToMenu() { app.screen = 'home'; },
    leaveGame() { app.screen = 'home'; },
  };
  return {
    name, ctx, MTG, doc, store, app, timers, T: MTG.tourney,
    get code() { return MTG.friends.code; },
    /** The button whose words are `text`, inside `root` (a selector or a node), the last one found. */
    button(text, root) {
      const host = typeof root === 'string' ? doc.querySelectorAll(root).pop() : (root || doc);
      if (!host) return null;
      const list = host.querySelectorAll('button').filter(b => b.textContent.trim() === text);
      return list[list.length - 1] || null;
    },
    text: (sel) => { const n = doc.querySelectorAll(sel).pop(); return n ? n.textContent : ''; },
    /** The note whose title matches `re`, if there is one. */
    note: (re) => doc.querySelectorAll('.social-note').find(n => re.test(n.textContent)) || null,
  };
}
async function windowsRun() {
  const { makeEvent } = require('./fakedom');
  const ub = new Broker();
  // room codes never have I, O, 0 or 1 in them
  const uma = uiDevice('Uma', ub, 'UMA'), vic = uiDevice('Vic', ub, 'VYC'), wes = uiDevice('Wes', ub, 'WES');
  const all = [uma, vic, wes];
  for (const d of all) d.MTG.bus.emit('app:ready');
  await until(() => all.every(d => d.MTG.friends.status === 'online'), 2000, 'the three hubs reach the broker');
  for (const d of [vic, wes]) {
    uma.MTG.friends.add(d.code);
    await until(() => (d.MTG.friends.entry(uma.code) || {}).state === 'in', 2000, `${d.name} gets Uma’s request`);
    d.MTG.friends.accept(uma.code);
    await until(() => uma.MTG.friends.isOnline(d.code) && d.MTG.friends.isOnline(uma.code), 2000, `Uma and ${d.name} are friends`);
  }
  for (const n of [...vic.doc.querySelectorAll('.social-note'), ...wes.doc.querySelectorAll('.social-note'), ...uma.doc.querySelectorAll('.social-note')]) n.remove();

  // the Friends window has a Tournaments tab, empty to begin with
  uma.MTG.ui.openFriends();
  check(!!uma.button('Tournaments', '.friends-modal'), 'the Friends window has a Tournaments tab');
  uma.button('Tournaments', '.friends-modal').click();
  check(/No tournaments yet/.test(uma.text('.tn-lists')), 'which starts empty');
  uma.button('New tournament', '.friends-modal').click();
  check(!!uma.doc.querySelector('.tn-create'), 'New tournament opens the window to set one up');
  check(uma.doc.querySelectorAll('.tn-create .tn-friend').length === 2, 'listing both friends to invite');
  check(uma.button('Set it up', '.tn-create').disabled, 'it cannot be set up with nobody but Uma');
  uma.doc.querySelector('#tn-name').value = 'Uma’s Pioneer night';
  const fmtSel = uma.doc.querySelector('#tn-fmt');
  check(!fmtSel.querySelectorAll('option').some(o => /Draft|Sealed|Jumpstart/.test(o.textContent)), 'only constructed formats are offered');
  fmtSel.value = 'pioneer';
  fmtSel.dispatchEvent(makeEvent('change'));
  uma.button('Best of 1', '.tn-create').click();
  for (const box of uma.doc.querySelectorAll('.tn-create input[type=checkbox]')) { box.checked = true; box.dispatchEvent(makeEvent('change')); }
  check(/3 players, you included/.test(uma.text('.tn-count')) && /2 for 3/.test(uma.text('.tn-roundbox .tn-hint')), 'it counts three players, and two rounds to suit them');
  check(!uma.button('Send invites', '.tn-create').disabled, 'and can be sent');
  uma.button('Send invites', '.tn-create').click();
  check(!uma.doc.querySelector('.tn-create') && !!uma.doc.querySelector('.tn-modal'), 'sending the invites opens the tournament’s window');
  const tid = uma.T.list()[0].id;
  check(uma.T.get(tid).fmt === 'pioneer' && uma.T.get(tid).bo === 1 && uma.T.get(tid).name === 'Uma’s Pioneer night', 'with the format, the match length and the name chosen');
  check(uma.button('Start with 1', '.tn-modal').disabled, 'it cannot start with only Uma in');

  // both are asked in a note, and join from the tournament's window
  for (const d of [vic, wes]) {
    await until(() => d.note(/invites you to a tournament/), 2000, `${d.name} gets a note inviting them`);
    d.button('Open', d.note(/invites you to a tournament/)).click();
    check(!!d.doc.querySelector('.tn-modal') && /invites you/.test(d.text('.tn-status')), `${d.name}’s window says who invites them`);
    d.button('Join', '.tn-modal').click();
  }
  await until(() => uma.button('Start with 3', '.tn-modal') && !uma.button('Start with 3', '.tn-modal').disabled, 2000, 'Uma can start once both are in');
  uma.button('Start with 3', '.tn-modal').click();
  await until(() => all.every(d => d.T.get(tid) && d.T.get(tid).state === 'running' && d.T.get(tid).rev === uma.T.get(tid).rev), 2000, 'round one reaches everyone');
  const dev = (code) => all.find(d => d.code === code);
  const hostedBefore = new Map(all.map(d => [d, 0]));
  const playRound = async (r, decide) => {
    await until(() => all.every(d => d.T.get(tid).rev === uma.T.get(tid).rev && d.T.get(tid).rnds.length === r), 2000, `round ${r} reaches everyone`);
    await sleep(60);
    const t = uma.T.get(tid);
    const pair = t.rnds[r - 1].pairs.find(p => p.b);
    const bye = dev(t.rnds[r - 1].pairs.find(p => !p.b).a);
    const host = dev(pair.a), guest = dev(pair.b);
    await until(() => /a bye/i.test(bye.text('.tn-modal .tn-match') || (bye.note(/a bye/) || { textContent: '' }).textContent), 1000, `round ${r}: ${bye.name} is told of the bye`);
    // the host opens the table: from the note, or from the window if it is open
    let open = host.note(/you play/) && host.button('Open the table', host.note(/you play/));
    if (!open) { host.MTG.ui.openTourney(tid); open = host.button('Open the table', '.tn-modal'); }
    check(!!open, `round ${r}: ${host.name} has a button to open the table`);
    if (!open) return;
    const had = hostedBefore.get(host);
    open.click();
    await until(() => host.app.hosted.length > had, 2000, `round ${r}: the table opens`);
    hostedBefore.set(host, had + 1);
    const ho = host.app.hosted[had];
    check(ho.formatId === 'pioneer' && ho.rules.bestOf === 1 && ho.mode.tourney.id === tid, 'in the tournament’s format and match length, marked as its match');
    await until(() => guest.note(/table is open/), 2000, `round ${r}: ${guest.name} is told the table is open`);
    const joinedBefore = guest.app.joined.length;
    guest.button('Join', guest.note(/table is open/)).click();
    await until(() => guest.app.joined.length > joinedBefore, 2000, `round ${r}: ${guest.name} joins`);
    check(guest.app.joined[joinedBefore] === host.T.myMatch(host.T.get(tid)).room, 'the room the host opened');
    const hostNote = host.MTG.ui.tourneyLobbyNote(ho.mode.tourney), guestNote = guest.MTG.ui.tourneyRoomNote(guest.app.joined[joinedBefore]);
    check(hostNote && guestNote && new RegExp(`round ${r}`).test(hostNote.textContent) && new RegExp(`Against ${host.name}`).test(guestNote.textContent),
      'both lobbies say which tournament match it is');
    await decide(host, guest, host.T.myMatch(host.T.get(tid)).room);
  };
  // round one: the table sees the game end on both sides, and the result goes in by itself
  await playRound(1, async (host, guest, room) => {
    for (const [d, won] of [[host, true], [guest, false]]) {
      d.MTG.net.mode = 'client';
      d.MTG.net.roomCode = room;
      d.MTG.ui.tourneySeeView({ meId: 'me' }, { over: true, game: 'g1', players: [{ id: 'me' }, { id: 'you' }], winners: won ? ['me'] : ['you'] });
      d.MTG.ui.tourneySeeView({ meId: 'me' }, { over: true, game: 'g1', players: [{ id: 'me' }, { id: 'you' }], winners: won ? ['me'] : ['you'] });
      d.MTG.net.mode = 'offline';
      d.MTG.net.roomCode = null;
    }
  });
  await until(() => uma.T.get(tid).rnds.length === 2, 2000, 'the game seen to its end on both sides settles round one, and round two is paired');
  check(uma.T.get(tid).rnds[0].pairs.find(p => p.b).by === 'agreed', 'by the two reports agreeing');
  check(all.some(d => /won 1–0/.test(d.doc.textContent)), 'the winner is told the result went in');
  // round two: both report by hand, and say different things; Uma settles it
  await playRound(2, async (host, guest) => {
    for (const d of [host, guest]) {
      d.MTG.ui.openTourney(tid);
      await until(() => d.button('Report the result', '.tn-modal'), 1000, `${d.name} has Report the result`);
      d.button('Report the result', '.tn-modal').click();
      check(!!d.doc.querySelector('.tn-pick'), `${d.name} is asked how it went`);
      check(d.button('Send', '.tn-pick').disabled, 'Send waits for a result that can be');
      d.button('I won 1–0', '.tn-pick').click();
      d.button('Send', '.tn-pick').click();
    }
  });
  await until(() => uma.T.disputed(uma.T.get(tid).rnds[1].pairs.find(p => p.b)), 2000, 'two reports that disagree put the match in dispute');
  uma.MTG.ui.openTourney(tid);
  await until(() => uma.doc.querySelector('.tn-modal .tn-pair.dispute'), 1000, 'Uma’s window shows the dispute');
  uma.button('Set result', '.tn-modal .tn-pair.dispute').click();
  const pick = uma.doc.querySelectorAll('.tn-pick').pop();
  const winnerName = uma.T.nameOf(uma.T.get(tid), uma.T.get(tid).rnds[1].pairs.find(p => p.b).a);
  uma.button(`${winnerName} wins 1–0`, pick).click();
  uma.button('Set result', pick).click();
  await until(() => all.every(d => d.T.get(tid).state === 'done' && d.T.get(tid).rev === uma.T.get(tid).rev), 2000, 'Uma’s result ends the tournament for everyone');
  for (const d of all) {
    d.MTG.ui.openTourney(tid);
    await until(() => /Final standings/.test(d.text('.tn-modal')), 1000, `${d.name} sees the final standings`);
  }
  check(uma.doc.querySelectorAll('.tn-modal .tn-st-row').length === 4, 'a header and a row for each player');
  check(/Winner/.test(uma.text('.tn-modal .tn-winner')), 'and the winner');
  await until(() => all.every(d => d.note(/is over/)), 1000, 'everyone gets a note that it is over');
  uma.MTG.ui.openFriends('tourneys');
  await until(() => /Finished/.test(uma.text('.tn-lists')), 1000, 'the tab lists it as finished');
  const words = (d) => d.doc.body.textContent;
  check(all.every(d => !/\bnull\b|\bundefined\b|NaN|\[object/.test(words(d))), 'no "null", "undefined" or "NaN" anywhere on screen');
  for (const d of all) { d.MTG.friends.stop(); d.timers.forEach(clearInterval); }
}

/* ============================================================
   The windows with bots in the seats, and friends invited afterwards
   ============================================================ */
async function botWindowsRun() {
  const { makeEvent } = require('./fakedom');
  const ub = new Broker();
  const uma = uiDevice('Uma', ub, 'UMB'), vic = uiDevice('Vic', ub, 'VYB');
  const both = [uma, vic];
  for (const d of both) {
    d.MTG.bus.emit('app:ready');
    d.app.botTables = [];
    d.app.botTableFor = (o) => { d.app.botTables.push(o); d.app.session = { mode: o.mode }; return d.app.session; };
  }
  await until(() => both.every(d => d.MTG.friends.status === 'online'), 2000, 'both hubs reach the broker');
  uma.MTG.friends.add(vic.code);
  await until(() => (vic.MTG.friends.entry(uma.code) || {}).state === 'in', 2000, 'Vic gets the request');
  vic.MTG.friends.accept(uma.code);
  await until(() => uma.MTG.friends.isOnline(vic.code) && vic.MTG.friends.isOnline(uma.code), 2000, 'Uma and Vic are friends');
  for (const n of [...vic.doc.querySelectorAll('.social-note'), ...uma.doc.querySelectorAll('.social-note')]) n.remove();

  // set up with one friend and a bot, from the window
  uma.MTG.ui.openFriends('tourneys');
  uma.button('New tournament', '.friends-modal').click();
  const create = uma.doc.querySelectorAll('.tn-create').pop();
  check(!!create.querySelector('.tn-bots'), 'the setup window has a row of bots under the friends');
  check(!!create.querySelector('#tn-bot-level') && create.querySelector('#tn-bot-level').querySelectorAll('option').length === 10, 'with the lobby’s ten levels to choose from');
  create.querySelector('#tn-f-' + vic.code).checked = true;
  create.querySelector('#tn-f-' + vic.code).dispatchEvent(makeEvent('change'));
  check(uma.button('Send invites', create).disabled, 'one friend alone is too few');
  create.querySelectorAll('button').find(b => b.getAttribute('aria-label') === 'One bot more').click();
  const lvl = create.querySelector('#tn-bot-level');
  lvl.value = '7';
  lvl.dispatchEvent(makeEvent('change'));
  check(/3 players, you included · 1 bot/.test(create.querySelector('.tn-count').textContent), 'a friend and a bot make three, counted');
  check(!uma.button('Send invites', create).disabled, 'which is enough');
  uma.button('Send invites', create).click();
  const tid = uma.T.list()[0].id;
  const bot1 = uma.T.get(tid).players.find(p => p.bot);
  check(bot1 && bot1.bot.lvl === 7, 'the tournament has a level 7 bot');
  await until(() => uma.doc.querySelector('.tn-modal .tn-player.is-bot'), 1000, 'the players list shows the bot');
  check(uma.doc.querySelector('.tn-modal .tn-player.is-bot .seat-level').textContent === '7', 'marked with its level, as a lobby seat is');
  // invite more, withdraw, invite again
  await until(() => vic.T.invites().length === 1, 2000, 'Vic is invited');
  uma.button('Withdraw', '.tn-modal').click();
  await until(() => !vic.T.get(tid), 2000, 'withdrawn: the invitation leaves Vic’s list');
  for (const n of vic.doc.querySelectorAll('.social-note')) n.remove();
  await until(() => uma.button('Invite more', '.tn-modal'), 1000, 'Uma has Invite more');
  uma.button('Invite more', '.tn-modal').click();
  const more = uma.doc.querySelectorAll('.tn-more').pop();
  check(!!more && more.querySelectorAll('.tn-friend').length === 1, 'Invite more lists the friend not invited now');
  more.querySelector('#tn-f-' + vic.code).checked = true;
  more.querySelector('#tn-f-' + vic.code).dispatchEvent(makeEvent('change'));
  check(/seats left/.test(more.querySelector('.tn-count').textContent), 'and how many seats are left');
  uma.button('Send invites', more).click();
  await until(() => vic.T.invites().length === 1 && vic.note(/invites you to a tournament/), 2000, 'Vic is invited again, with a note');
  vic.button('Open', vic.note(/invites you to a tournament/)).click();
  vic.button('Join', '.tn-modal').click();
  await until(() => uma.T.get(tid).players.filter(p => p.st === 'in').length === 3, 2000, 'Vic is in');
  uma.MTG.ui.openTourney(tid);
  await until(() => uma.button('Add a bot', '.tn-modal'), 1000, 'Uma can add a bot');
  uma.button('Add a bot', '.tn-modal').click();
  await until(() => uma.T.get(tid).players.filter(p => p.bot).length === 2, 1000, 'a second bot sits down');
  await until(() => uma.button('Start with 4', '.tn-modal'), 1000, 'four to start');
  uma.button('Start with 4', '.tn-modal').click();
  await until(() => both.every(d => d.T.get(tid).state === 'running' && d.T.get(tid).rev === uma.T.get(tid).rev), 2000, 'round one reaches Vic');

  // each round: a person against a bot plays it from the window, and the table reports it
  let botMatches = 0;
  for (let round = 1; round <= 2; round++) {
    await until(() => both.every(d => d.T.get(tid).rev === uma.T.get(tid).rev && d.T.get(tid).rnds.length === round), 2000, `round ${round} everywhere`);
    await sleep(60);
    for (const d of both) {
      const mm = d.T.myMatch(d.T.get(tid));
      if (!mm || mm.bye || mm.res) continue;
      if (mm.oppBot) {
        botMatches++;
        d.MTG.ui.openTourney(tid);
        await until(() => d.button('Play your match', '.tn-modal'), 1000, `${d.name} has Play your match`);
        check(/is a bot/.test(d.text('.tn-modal .tn-match')) && !!d.doc.querySelector('.tn-modal .tn-match .seat-level'), 'the match says it is against a bot, marked');
        const tables = d.app.botTables.length;
        d.button('Play your match', '.tn-modal').click();
        await until(() => d.app.botTables.length > tables, 1000, `${d.name}’s table against the bot opens`);
        const bt = d.app.botTables[d.app.botTables.length - 1];
        check(bt && bt.bot.name === mm.oppName && bt.bot.difficulty === mm.oppBot.lvl && bt.rules.bestOf === uma.T.get(tid).bo && bt.mode.tourney.bot, 'a table here, with the bot as the tournament has it');
        d.MTG.ui.tourneySeeView({ meId: 'me' }, { over: true, game: 'b' + round, players: [{ id: 'me' }, { id: 'bot' }], winners: ['me'] });
      } else if (mm.host) {
        // two people: done by the core, as the other windows test shows the buttons
        const opp = both.find(x => x.code === mm.opp);
        d.T.roomOpened(tid, mm.r, mm.pair.t, 'PPLA' + 'XYZ'[round]);
        await until(() => (opp.T.myMatch(opp.T.get(tid)) || {}).room === 'PPLA' + 'XYZ'[round], 2000, 'the room reaches the guest');
        d.T.gameOver('PPLA' + 'XYZ'[round], { w: 1, l: 0, d: 0 });
        opp.T.gameOver('PPLA' + 'XYZ'[round], { w: 0, l: 1, d: 0 });
      }
    }
  }
  check(botMatches >= 1, 'somebody played a bot');
  await until(() => both.every(d => d.T.get(tid).state === 'done' && d.T.get(tid).rev === uma.T.get(tid).rev), 3000, 'the tournament with bots ends for both');
  check(uma.T.get(tid).rnds.flatMap(r => r.pairs).filter(p => p.b && (uma.T.isBot(p.a) || uma.T.isBot(p.b)) && !(uma.T.isBot(p.a) && uma.T.isBot(p.b))).every(p => p.by === 'bot'), 'each match against a bot settled by its one report');
  uma.MTG.ui.openTourney(tid);
  await until(() => /Final standings/.test(uma.text('.tn-modal')), 1000, 'the final standings');
  check(uma.doc.querySelectorAll('.tn-modal .tn-st-row.is-bot').length === 2 && uma.doc.querySelectorAll('.tn-modal .tn-st-row.is-bot .seat-level').length === 2, 'with both bots marked in the standings');
  check(uma.doc.querySelectorAll('.tn-modal .tn-pair .is-bot .seat-level').length >= 1, 'and in the pairings');
  check(!/\bnull\b|\bundefined\b|NaN|\[object/.test(uma.doc.body.textContent + vic.doc.body.textContent), 'no "null", "undefined" or "NaN" anywhere on screen');

  // the host's table says which match it is; the guest's app hears it over the game's own line
  const sent = [];
  uma.MTG.net.mode = 'host';
  uma.MTG.net.send = (peer, msg) => sent.push([peer, msg]);
  uma.app.session = { mode: { tourney: { id: tid, r: 2, t: 1, opp: 'Vic' } } };
  uma.MTG.net.emit('peer:join', 'guest-peer');
  check(sent.length === 1 && sent[0][0] === 'guest-peer' && sent[0][1].t === 'tourney:table' && sent[0][1].id === tid && sent[0][1].host === uma.code, 'a guest joining a tournament match’s table is told which match it is');
  uma.app.session = { mode: { tourney: { id: tid, r: 2, t: 1, bot: true } } };
  uma.MTG.net.emit('peer:join', 'watcher');
  check(sent.length === 1, 'and nothing is said from a table against a bot');
  uma.MTG.net.mode = 'offline';
  const heard = [];
  const was = vic.T.tableNote;
  vic.T.tableNote = (msg, room) => { heard.push([msg, room]); return false; };
  vic.MTG.net.mode = 'client';
  vic.MTG.net.roomCode = 'ROOMQ';
  vic.MTG.net.emit('message', 'host', sent[0][1]);
  vic.MTG.net.emit('message', 'someone', sent[0][1]);
  check(heard.length === 1 && heard[0][1] === 'ROOMQ', 'the guest’s app takes the note from its host only, with the room it is in');
  vic.T.tableNote = was;
  vic.MTG.net.mode = 'offline';
  vic.MTG.net.roomCode = null;
  for (const d of both) { d.MTG.friends.stop(); d.timers.forEach(clearInterval); }
}

/* ============================================================
   After an online draft: the game waits for every person's deck
   ============================================================ */
async function draftRun() {
  const { Document } = require('./fakedom');
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: memStorage(new Map()), document: new Document(),
    navigator: {}, innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {}, location: { search: '' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['00-core.js', '07-draft.js']) vm.runInContext(SRC(f), ctx, { filename: f });
  const D = ctx.MTG.draft;
  const seats = [{ id: 'a', name: 'Ann', deck: null }, { id: 'b', name: 'Ben', deck: null }, { id: 'c', name: 'Cat', deck: { main: [] } }];
  let heard = [];
  const t0 = Date.now();
  const p = D.awaitDecks(() => seats, { timeout: 2000, every: 10, onWait: (m) => heard.push(m.map(s => s.name).join()) });
  setTimeout(() => { seats[0].deck = { main: [] }; }, 60);
  setTimeout(() => { seats[1].deck = { main: [] }; }, 140);
  const left = await p;
  check(left.length === 0 && Date.now() - t0 < 1000, 'the game goes as soon as the last deck is in');
  check(heard[0] === 'Ann,Ben' && heard.includes('Ben'), 'saying who is still building as that changes');
  check((await D.awaitDecks(() => seats, { timeout: 1000 })).length === 0, 'with every deck in already, there is no wait');
  const slow = [{ id: 'd', name: 'Dan', deck: null }, { id: 'e', name: 'Eve', deck: { main: [] } }];
  const t1 = Date.now();
  const late = await D.awaitDecks(() => slow, { timeout: 150, every: 10 });
  check(late.length === 1 && late[0].name === 'Dan' && Date.now() - t1 >= 140, 'after the wait, whoever is still building is handed back, to be dealt a deck from their picks');
  let room = [{ id: 'f', name: 'Fay', deck: null }, { id: 'g', name: 'Gus', deck: { main: [] } }];
  setTimeout(() => { room = room.filter(s => s.id !== 'f'); }, 50);
  check((await D.awaitDecks(() => room, { timeout: 2000, every: 10 })).length === 0, 'somebody who leaves is not waited for');
  let go = false;
  setTimeout(() => { go = true; }, 50);
  const t2 = Date.now();
  const now = await D.awaitDecks(() => slow, { timeout: 5000, every: 10, stop: () => go });
  check(now.length === 1 && Date.now() - t2 < 1000, 'and the host can say start now');
}

/* ============================================================
   Bots in the seats
   ============================================================ */
/**
 * Play out the current round of `id` across devices: a person against a
 * bot reports from their own device, as the table set up for it would;
 * two people open a room and both report. `decide(pair)` gives the result
 * as games for the pair's a, { a, b, d }.
 */
async function playMixed(org, devs, id, decide) {
  const all = [org].concat(devs);
  const dev = (code) => all.find(d => d.code === code) || null;
  await until(() => inStep(org, devs, id), 2000, 'everyone has the round before it is played');
  const t = org.T.get(id);
  const r = t.rnds.length;
  for (const p of t.rnds[r - 1].pairs) {
    if (!p.b || p.res) continue;
    const res = decide(p);
    const A = dev(p.a), B = dev(p.b);
    if (!A || !B) {
      const human = A || B;
      const mine = A ? res : { a: res.b, b: res.a, d: res.d };
      check(!!human.T.botGameOver({ id, r, t: p.t }, { w: mine.a, l: mine.b, d: mine.d }), `${human.name} reports round ${r} against a bot from the table`);
      continue;
    }
    const room = 'B' + 'ABCDEFGHJK'[r] + 'ABCDEFGHJK'[p.t] + 'M';
    A.T.roomOpened(id, r, p.t, room);
    await until(() => (B.T.myMatch(B.T.get(id)) || {}).room === room, 2000, `round ${r}: the room reaches ${B.name}`);
    A.T.gameOver(room, { w: res.a, l: res.b, d: res.d });
    B.T.gameOver(room, { w: res.b, l: res.a, d: res.d });
  }
}
const isBotCode = (c) => /^bot-[0-9a-f]{8}$/.test(c || '');

async function botsRun() {
  const broker = new Broker();
  /* ---- the pieces ---- */
  const solo = device('Solo', broker);
  const T = solo.T, FC = solo.MTG.friendsCore;
  const fake = madeUp(FC, ['Org', 'B1', 'B2'], 3);
  fake.players[1] = { code: 'bot-0000000a', name: 'Brass Vizier', st: 'in', seed: 1, bot: { lvl: 7, style: '' } };
  fake.players[2] = { code: 'bot-0000000b', name: 'Mossy Fox', st: 'in', seed: 2, bot: { lvl: 4, style: '' } };
  const pair = { t: 1, a: 'bot-0000000a', b: 'bot-0000000b' };
  check(sameJSON(T.botMatch(fake, 1, pair), T.botMatch(fake, 1, pair)), 'two bots’ match comes out the same way every time it is worked out');
  let strongWins = 0;
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const f = Object.assign({}, fake, { id: (i + 1).toString(16).padStart(24, '0') });
    const res = T.botMatch(f, 1, pair);
    seen.add(`${res.a}-${res.b}`);
    if (res.a > res.b) strongWins++;
    if (!T.cleanResult(res, 3) || res.d || Math.max(res.a, res.b) !== 2) { check(false, 'a bots’ match ends 2-0 or 2-1: ' + JSON.stringify(res)); break; }
  }
  check(strongWins > 255 && strongWins < 298, `a level 7 bot beats a level 4 bot most of the time, not always (${strongWins} of 300)`);
  check(['2-0', '2-1', '1-2'].every(k => seen.has(k)), 'with 2-0, 2-1 and the odd upset among the results');
  const even = Object.assign({}, fake, { players: fake.players.map(p => (p.bot ? Object.assign({}, p, { bot: { lvl: 5, style: '' } }) : p)) });
  let aWins = 0;
  for (let i = 0; i < 400; i++) { const res = T.botMatch(Object.assign({}, even, { id: (i + 7).toString(16).padStart(24, 'a') }), 2, pair); if (res.a > res.b) aWins++; }
  check(aWins > 150 && aWins < 250, `two bots of a level are even (${aWins} of 400)`);
  const bo1 = Object.assign({}, fake, { bo: 1 });
  const r1 = T.botMatch(bo1, 1, pair);
  check(r1.a + r1.b === 1 && !r1.d, 'best of one: a single game');

  // what arrives with bots in it, checked
  const withBots = madeUp(FC, ['Org', 'Pal'], 1);
  withBots.players.push({ code: 'bot-0123abcd', name: 'Iron Smith', st: 'in', seed: 2, bot: { lvl: 4, style: 'aggressive' } });
  withBots.rnds.push({ pairs: [{ t: 1, a: withBots.players[1].code, b: 'bot-0123abcd', res: null, by: null, rep: {}, room: null }, { t: 2, a: withBots.org, b: null, res: { a: 2, b: 0, d: 0 }, by: 'bye', rep: {}, room: null }] });
  const goodBots = JSON.parse(JSON.stringify(T.pub(withBots)));
  check(!!T.readT(goodBots) && T.readT(goodBots).players[2].bot.lvl === 4, 'a tournament with a bot in it reads');
  const badB = (f) => { const x = JSON.parse(JSON.stringify(goodBots)); f(x); return T.readT(x) === null; };
  check(badB(x => { x.players[2].code = 'bot-XYZ'; }) && badB(x => { x.players[2].code = 'robot-0123abcd'; }), 'a bot id that is not one is refused');
  check(badB(x => { x.players[2].bot.lvl = 11; }) && badB(x => { x.players[2].bot.lvl = '5'; }) && badB(x => { x.players[2].bot.style = '<b>'; }), 'a level or style a bot cannot have is refused');
  check(badB(x => { delete x.players[2].bot; }) && badB(x => { x.players[1].bot = { lvl: 3, style: '' }; }), 'a bot without its level, or a friend dressed as a bot, is refused');
  check(badB(x => { x.players[2].st = 'dropped'; }) && badB(x => { x.players[2].st = 'invited'; }), 'a bot that dropped, or was invited, is refused: bots are always in');
  check(badB(x => { x.org = 'bot-0123abcd'; x.players[2].code = 'bot-0123abcd'; }) || badB(x => { x.org = 'bot-0123abcd'; }), 'a bot cannot be the organiser');
  const repd = JSON.parse(JSON.stringify(goodBots));
  repd.rnds[0].pairs[0].rep = { 'bot-0123abcd': { a: 1, b: 0, d: 0 } };
  check(Object.keys(T.readT(repd).rnds[0].pairs[0].rep).length === 0, 'a report said to be a bot’s is dropped: bots do not report');
  repd.rnds[0].pairs[0].room = 'ROOMZ';
  check(T.readT(repd).rnds[0].pairs[0].room === null, 'and a match with a bot in it has no room');

  // a late entrant's standing: the missed round is a match lost 0-2
  const lateT = madeUp(FC, ['Ann', 'Ben', 'Cat', 'Dan'], 3);
  handRound(lateT, [['Ann', 'Ben', 2, 0], ['Cat', null]]);
  lateT.players[3].late = 1;
  handRound(lateT, [['Dan', 'Ann', 2, 1], ['Ben', 'Cat', 2, 0]]);
  const lst = T.standings(lateT);
  const dan = lst.find(r => r.name === 'Dan'), annL = lst.find(r => r.name === 'Ann');
  check(dan.mp === 3 && dan.w === 1 && dan.l === 1 && dan.rounds === 2 && dan.gl === 3 && dan.gw === 2, 'a late entrant’s missed round counts as a match lost 0-2');
  check(near(dan.mwp, 3 / 6) && near(dan.gwp, 6 / 15) && dan.opps.length === 1, 'in their own percentages, with no opponent for it');
  check(near(annL.omw, (lst.find(r => r.name === 'Ben').mwp + dan.mwp) / 2), 'and their opponents count them as they stand');

  /* ---- the organiser and bots only, nobody else online ---- */
  const org = device('Org', broker);           // never started: no friends, no line, nobody online
  const t1 = org.T.create({ name: 'Me and the bots', fmt: 'standard', bo: 3, bots: 3, botLevel: 6 });
  check(t1 && t1.id && t1.players.filter(p => p.bot).length === 3, 'the organiser sets up a tournament with three bots and no friends');
  check(t1.players.filter(p => p.bot).every(p => isBotCode(p.code) && p.bot.lvl === 6 && p.st === 'in' && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(p.name)), 'each bot has an id of its own, the level asked for, and a name as the lobby gives one');
  check(new Set(t1.players.map(p => p.name)).size === 4, 'no two with the same name');
  check(org.T.start(t1.id) === '', 'and starts it straight away');
  const id1 = t1.id;
  let guard = 0;
  while (org.T.get(id1).state === 'running' && guard++ < 6) {
    const t = org.T.get(id1);
    const r = t.rnds.length;
    for (const p of t.rnds[r - 1].pairs) {
      if (!p.b) continue;
      if (isBotCode(p.a) && isBotCode(p.b)) check(p.res && p.by === 'sim', `round ${r}: two bots are settled as the round is paired`);
    }
    const mine = org.T.myMatch(t);
    check(mine && mine.oppBot && mine.oppBot.lvl === 6 && !mine.room, `round ${r}: the organiser plays a bot, here, with no room`);
    check(!!org.T.botGameOver({ id: id1, r, t: mine.pair.t }, { w: 2, l: 1, d: 0 }), `round ${r}: the organiser’s game against the bot is reported from the table`);
    check(!org.T.botGameOver({ id: id1, r, t: mine.pair.t }, { w: 0, l: 2, d: 0 }), 'and a game after it at the same table is not');
  }
  const done1 = org.T.get(id1);
  check(done1.state === 'done' && done1.rnds.length === 2, 'the tournament runs to its end with nobody else online');
  check(done1.rnds.every(r => r.pairs.every(p => p.res)), 'every match settled');
  check(org.T.standings(done1)[0].code === org.code, 'and the organiser, unbeaten, wins it');
  check(done1.rnds.flatMap(r => r.pairs).filter(p => p.b && (isBotCode(p.a) !== isBotCode(p.b))).every(p => p.by === 'bot'), 'a match against a bot is settled by the one report');
  // three players: the organiser and two bots, with byes
  const t2 = org.T.create({ name: 'Three', fmt: 'modern', bo: 1, rounds: 3, bots: 2, botLevel: 3 });
  check(!t2.why, 'the organiser and two bots is a tournament');
  org.T.start(t2.id);
  for (let i = 0; i < 6 && org.T.get(t2.id).state === 'running'; i++) {
    const t = org.T.get(t2.id);
    const mine = org.T.myMatch(t);
    if (mine && !mine.bye && !mine.res) org.T.botGameOver({ id: t2.id, r: mine.r, t: mine.pair.t }, { w: 1, l: 0, d: 0 });
    else break;
  }
  const done2 = org.T.get(t2.id);
  check(done2.state === 'done' && done2.rnds.every(r => r.pairs.filter(p => !p.b).length === 1), 'three rounds, a bye in each, to the end');
  check(new Set(done2.rnds.map(r => r.pairs.find(p => !p.b).a)).size === 3, 'and each player has one bye');
  check(!org.T.drop(t2.id, done2.players.find(p => p.bot).code), 'a bot is never dropped');

  /* ---- friends, bots, byes and a drop ---- */
  const ann = device('Ann', broker), ben = device('Ben', broker), cat = device('Cat', broker);
  await online([ann, ben, cat]);
  for (const d of [ben, cat]) await befriend(ann, d);
  check(!!ann.T.create({ name: 'x', fmt: 'modern', bo: 1, invite: [ben.code], bots: 0 }).why, 'one friend and no bots is too few');
  const small = ann.T.create({ name: 'Just three', fmt: 'modern', bo: 1, invite: [ben.code], bots: 1, botLevel: 4 });
  check(!small.why, 'the organiser, one friend and one bot is a tournament');
  check(!!ann.T.create({ name: 'x', fmt: 'modern', bo: 1, invite: [ben.code], bots: 15 }).why, 'more than sixteen seats with the bots is refused');
  ann.T.cancel(small.id);
  const mx = ann.T.create({ name: 'Mixed', fmt: 'pioneer', bo: 1, rounds: 3, invite: [ben.code, cat.code], bots: 2, botLevel: 5 });
  const idm = mx.id;
  await until(() => ben.T.get(idm) && cat.T.get(idm), 2000, 'Ben and Cat are invited to the mixed one');
  check(ben.T.get(idm).players.filter(p => p.bot).length === 2, 'their copies have the bots in them');
  ben.T.answer(idm, true); cat.T.answer(idm, true);
  await until(() => ann.T.get(idm).players.filter(p => p.st === 'in').length === 5, 2000, 'five in: three people and two bots');
  check(ann.T.start(idm) === '', 'it starts');
  const trio = [ben, cat];
  await until(() => inStep(ann, trio, idm), 2000, 'round one reaches both');
  check(ann.T.get(idm).rnds[0].pairs.filter(p => !p.b).length === 1, 'five players: a bye');
  const strength = { Ann: 9, Ben: 7, Cat: 5 };
  const lv = (t, c) => (t.players.find(p => p.code === c).bot ? t.players.find(p => p.code === c).bot.lvl : strength[t.players.find(p => p.code === c).name]);
  const stronger = (p) => { const t = ann.T.get(idm); return lv(t, p.a) >= lv(t, p.b) ? { a: 1, b: 0, d: 0 } : { a: 0, b: 1, d: 0 }; };
  await playMixed(ann, trio, idm, stronger);
  await until(() => ann.T.get(idm).rnds.length === 2, 2000, 'round one settled, with reports against bots from one side, and round two paired');
  // Cat drops part way through round two
  await until(() => inStep(ann, trio, idm), 2000);
  check(cat.T.leave(idm), 'Cat drops out');
  await until(() => ann.T.get(idm).players.find(p => p.code === cat.code).st === 'dropped', 2000, 'Ann hears it');
  await playMixed(ann, [ben, cat], idm, stronger);
  await until(() => ann.T.get(idm).rnds.length === 3 || ann.T.get(idm).state === 'done', 2000, 'round two settled');
  check(!ann.T.get(idm).rnds[2].pairs.some(p => p.a === cat.code || p.b === cat.code), 'Cat is not paired after dropping');
  check(ann.T.get(idm).players.filter(p => p.bot).every(p => p.st === 'in'), 'the bots are all still in');
  await playMixed(ann, [ben, cat], idm, stronger);
  await until(() => ann.T.get(idm).state === 'done' && inStep(ann, [ben, cat], idm), 2000, 'the mixed tournament ends');
  const finalM = ann.T.standings(ann.T.get(idm));
  const sig = (d) => JSON.stringify(d.T.standings(d.T.get(idm)).map(r => [r.code, r.mp, r.w, r.l, r.d, r.omw.toFixed(6), r.gwp.toFixed(6), r.ogw.toFixed(6)]));
  check(sig(ben) === sig(ann) && sig(cat) === sig(ann), 'the standings are the same on every device, bots and all');
  check(finalM.filter(r => r.bot).length === 2 && finalM.some(r => r.st === 'dropped'), 'with the bots in them, and Cat marked as dropped');
  check(ann.T.get(idm).rnds.every(r => r.pairs.filter(p => !p.b).length === (r.pairs.flatMap(p => [p.a, p.b]).filter(Boolean).length % 2 ? 1 : 0)), 'a bye only when the count is odd');

  /* ---- forged bot entries and reports, from friends ---- */
  const hx = ann.T.create({ name: 'Forgery', fmt: 'legacy', bo: 1, rounds: 2, invite: [ben.code, cat.code], bots: 3, botLevel: 5 });
  const idh = hx.id;
  await until(() => ben.T.get(idh) && cat.T.get(idh), 2000, 'invited to the forgery test');
  ben.T.answer(idh, true); cat.T.answer(idh, true);
  await until(() => ann.T.get(idh).players.filter(p => p.st === 'in').length === 6, 2000, 'six in');
  ann.T.start(idh);
  await until(() => inStep(ann, trio, idh), 2000, 'round one');
  const th = ann.T.get(idh);
  const before = JSON.stringify(th);
  const botPair = th.rnds[0].pairs.find(p => p.b && isBotCode(p.a) && isBotCode(p.b));
  const notBens = th.rnds[0].pairs.find(p => p.b && p.a !== ben.code && p.b !== ben.code && !(botPair && p === botPair));
  // Ben reports a match between two bots, and one that is not his, and tries to drop a bot
  if (botPair) ben.hub.sendTourney(ann.code, { op: 'report', id: idh, r: 1, tb: botPair.t, w: 1, l: 0, d: 0 });
  if (notBens) ben.hub.sendTourney(ann.code, { op: 'report', id: idh, r: 1, tb: notBens.t, w: 1, l: 0, d: 0 });
  const aBot = th.players.find(p => p.bot).code;
  ben.hub.sendTourney(ann.code, { op: 'drop', id: idh, code: aBot });
  ben.hub.sendTourney(ann.code, { op: 'room', id: idh, r: 1, tb: (th.rnds[0].pairs.find(p => (p.a === ben.code || p.b === ben.code) && p.b && (isBotCode(p.a) || isBotCode(p.b))) || { t: 1 }).t, room: 'FAKER' });
  await sleep(80);
  const after = ann.T.get(idh);
  check(JSON.stringify(after.rnds) === JSON.stringify(th.rnds) || before === JSON.stringify(after), 'reports for bots’ matches or someone else’s change nothing, and a bot match takes no room');
  check(after.players.find(p => p.code === aBot).st === 'in' && after.players.find(p => p.code === ben.code).st === 'dropped', 'a drop naming a bot drops nobody but the one who sent it: bots are never dropped');
  // Ben, not the organiser, sends Cat a copy with a forged bot, and one claiming a bot is Ben's to report for
  const forgedT = JSON.parse(JSON.stringify(ann.T.pub(after)));
  forgedT.rev += 10;
  forgedT.players.push({ code: 'bot-deadbeef', name: 'Evil Bot', st: 'in', seed: 9, bot: { lvl: 10, style: '' } });
  const catBefore = JSON.stringify(cat.T.get(idh));
  await befriend(ben, cat);
  ben.hub.sendTourney(cat.code, { op: 'state', id: idh, s: forgedT });
  await sleep(80);
  check(JSON.stringify(cat.T.get(idh)) === catBefore, 'a copy with bots added, from someone who is not the organiser, is turned down');
  // and from the organiser, a bot that is not one is refused whole
  const broken = JSON.parse(JSON.stringify(ann.T.pub(after)));
  broken.rev += 20;
  broken.players.find(p => p.bot).bot.lvl = 99;
  ann.hub.sendTourney(cat.code, { op: 'state', id: idh, s: broken });
  await sleep(80);
  check(JSON.stringify(cat.T.get(idh)) === catBefore, 'and even from the organiser, a copy with an impossible bot changes nothing');
  ann.T.cancel(idh);

  for (const d of [ann, ben, cat]) d.hub.stop();
}

/* ============================================================
   Inviting more: before the start, and late
   ============================================================ */
async function invitesRun() {
  const broker = new Broker();
  const ann = device('Ann', broker), ben = device('Ben', broker), cat = device('Cat', broker), dan = device('Dan', broker), eve = device('Eve', broker);
  const all = [ben, cat, dan, eve];
  await online([ann].concat(all));
  for (const d of all) await befriend(ann, d);
  // set up with Ben and a bot; Cat and Dan invited afterwards
  const t = ann.T.create({ name: 'Growing', fmt: 'modern', bo: 1, rounds: 3, invite: [ben.code], bots: 1, botLevel: 5 });
  const id = t.id;
  await until(() => ben.T.get(id), 2000, 'Ben is invited');
  check(ann.T.invite(id, [cat.code, dan.code]) === '', 'Ann invites Cat and Dan after setting it up');
  await until(() => cat.T.invites().some(x => x.id === id) && dan.T.invites().some(x => x.id === id), 2000, 'both get the invitation the usual way');
  check(!!ann.T.invite(id, [cat.code]), 'someone already invited is not invited twice');
  check(ann.T.get(id).players.find(p => p.code === cat.code).st === 'invited', 'and shows as waiting');
  // withdrawn
  check(ann.T.uninvite(id, dan.code), 'Ann withdraws Dan’s invitation');
  await until(() => !dan.T.get(id), 2000, 'and it is gone from Dan’s list');
  check(dan.events.some(e => e[0] === 'removed'), 'with a word saying so');
  check(!ann.T.get(id).players.some(p => p.code === dan.code), 'and from Ann’s');
  // declined, then asked again
  cat.T.answer(id, false);
  await until(() => ann.T.get(id).players.find(p => p.code === cat.code).st === 'declined', 2000, 'Cat says no');
  check(ann.T.invite(id, [cat.code]) === '', 'Ann asks Cat again');
  await until(() => cat.T.invites().some(x => x.id === id), 2000, 'and Cat has the invitation once more');
  cat.T.answer(id, true); ben.T.answer(id, true);
  await until(() => ann.T.get(id).players.filter(p => p.st === 'in').length === 4, 2000, 'Ben and Cat are in');
  // the cap: fill every seat with bots, and invite one more
  check(ann.T.addBots(id, 16 - ann.T.seatsTaken(ann.T.get(id)), 7) === '', 'Ann fills the seats left with bots');
  check(ann.T.seatsTaken(ann.T.get(id)) === 16, 'all sixteen taken');
  check(!!ann.T.addBots(id, 1, 5), 'no seat for another bot');
  check(/seats are taken/.test(ann.T.invite(id, [dan.code])), 'nor for another friend, as things stand');
  check(ann.T.invite(id, [dan.code], { replaceBots: true }) === '', 'but a bot can give up its seat for him');
  check(ann.T.seatsTaken(ann.T.get(id)) === 16 && ann.T.get(id).players.filter(p => p.bot).length === 12, 'still sixteen: a bot fewer, Dan invited');
  await until(() => dan.T.invites().some(x => x.id === id), 2000, 'Dan is invited after all');
  check(ann.T.removeBot(id, ann.T.get(id).players.find(p => p.bot).code), 'a bot can be taken off before the start');
  // blocked friends cannot be invited
  ann.hub.block(eve.code);
  check(!!ann.T.invite(id, [eve.code]), 'a blocked friend cannot be invited');
  // hostile: a player, not the organiser, trying to invite; an invitation to a full tournament
  check(!!ben.T.invite(id, [eve.code]), 'a player cannot invite anyone to someone else’s tournament');
  await befriend(ben, eve);
  const evBefore = eve.T.list().length;
  ben.hub.sendTourney(ann.code, { op: 'invite', id, code: eve.code });
  const full = JSON.parse(JSON.stringify(ben.T.pub(ben.T.get(id))));
  ben.hub.sendTourney(eve.code, { op: 'state', id, s: Object.assign(full, { players: full.players.concat([{ code: eve.code, name: 'Eve', st: 'invited', seed: 40 }]) }) });
  await sleep(80);
  check(eve.T.list().length === evBefore, 'an invitation sent by someone who is not the organiser lands nowhere');
  check(!ann.T.get(id).players.some(p => p.code === eve.code), 'and nobody gets in by asking the organiser');
  const over = JSON.parse(JSON.stringify(ann.T.pub(ann.T.get(id))));
  const xs = over.players.filter(p => p.st !== 'declined').length;
  over.players.push({ code: FC_make(ann), name: 'Seventeen', st: 'invited', seed: 60 });
  for (let i = xs + 1; i < 17; i++) over.players.push({ code: 'bot-' + (0x100 + i).toString(16).padStart(8, '0'), name: 'B' + i, st: 'in', seed: 70 + i, bot: { lvl: 1, style: '' } });
  check(ann.T.readT(over) === null, 'a tournament of seventeen, invitation and all, is refused');
  ann.T.cancel(id);

  /* ---- late entry ---- */
  ann.hub.unblock(eve.code);
  ann.hub.add(eve.code);            // Eve never knew she was blocked: asking again is friends again at once
  await until(() => ann.hub.isOnline(eve.code) && eve.hub.isOnline(ann.code), 3000, 'Ann and Eve are friends again');
  const lt = ann.T.create({ name: 'Latecomers', fmt: 'standard', bo: 1, rounds: 3, invite: [ben.code, cat.code], bots: 1, botLevel: 4 });
  const lid = lt.id;
  await until(() => ben.T.get(lid) && cat.T.get(lid), 2000, 'invited');
  ben.T.answer(lid, true); cat.T.answer(lid, true);
  await until(() => ann.T.get(lid).players.filter(p => p.st === 'in').length === 4, 2000, 'four in');
  ann.T.start(lid);
  const four = [ben, cat];
  await until(() => inStep(ann, four, lid), 2000, 'round one');
  check(ann.T.invite(lid, [dan.code]) === '', 'Ann invites Dan once it is under way');
  await until(() => dan.T.invites().some(x => x.id === lid), 2000, 'Dan is asked to come in late');
  check(dan.T.get(lid).state === 'running', 'to a tournament already running');
  dan.T.answer(lid, true);
  await until(() => (ann.T.get(lid).players.find(p => p.code === dan.code) || {}).st === 'in', 2000, 'Dan comes in');
  check(ann.T.get(lid).players.find(p => p.code === dan.code).late === 1, 'having missed one round');
  check(!ann.T.get(lid).rnds[0].pairs.some(p => p.a === dan.code || p.b === dan.code), 'and not in the round under way');
  const five = [ben, cat, dan];
  const win = (p) => ({ a: 1, b: 0, d: 0 });
  await playMixed(ann, five, lid, win);
  await until(() => ann.T.get(lid).rnds.length === 2, 2000, 'round two is paired');
  check(ann.T.get(lid).rnds[1].pairs.some(p => p.a === dan.code || p.b === dan.code), 'with Dan in it');
  check(ann.T.get(lid).rnds[1].pairs.filter(p => !p.b).length === 1, 'five now: a bye');
  const dRow = ann.T.standings(ann.T.get(lid)).find(r => r.code === dan.code);
  // placed last, with a round lost and no bye yet, he is the one to have round two's bye
  const danBye = ann.T.get(lid).rnds[1].pairs.some(p => !p.b && p.a === dan.code);
  check(danBye && dRow.l === 1 && dRow.w === 1 && dRow.rounds === 2 && dRow.mp === 3, 'Dan starts with a round lost, and as the lowest placed has round two’s bye');
  await playMixed(ann, five, lid, win);
  await until(() => ann.T.get(lid).rnds.length === 3, 2000, 'round three is paired');
  // too late: the last round is paired
  check(!!ann.T.invite(lid, [eve.code]), 'no more can be invited once the last round is paired');
  await playMixed(ann, five, lid, win);
  await until(() => ann.T.get(lid).state === 'done' && inStep(ann, five, lid), 2000, 'the tournament with a late entrant ends');
  const lsig = (d) => JSON.stringify(d.T.standings(d.T.get(lid)).map(r => [r.code, r.mp, r.l, r.late, r.omw.toFixed(6)]));
  check(five.every(d => lsig(d) === lsig(ann)), 'the same standings everywhere, the late entrant’s lost round included');
  // a yes that comes too late is turned away
  const lt2 = ann.T.create({ name: 'Too late', fmt: 'standard', bo: 1, rounds: 1, invite: [ben.code], bots: 1, botLevel: 4 });
  await until(() => ben.T.get(lt2.id), 2000);
  ben.T.answer(lt2.id, true);
  await until(() => ann.T.get(lt2.id).players.filter(p => p.st === 'in').length === 3, 2000);
  ann.hub.stop();
  await until(() => !eve.hub.isOnline(ann.code), 2000);
  ann.T.start(lt2.id);
  ann.hub.start();
  await until(() => ann.hub.isOnline(ben.code), 3000);
  check(!!ann.T.invite(lt2.id, [eve.code]), 'a one-round tournament under way has no round left to come in for');
  for (const d of [ann].concat(all)) d.hub.stop();
}

/* ============================================================
   A table that says which match it is: a guest who typed the code
   ============================================================ */
async function tablesRun() {
  const broker = new Broker();
  const ann = device('Ann', broker), ben = device('Ben', broker), cat = device('Cat', broker), dan = device('Dan', broker);
  const players = [ben, cat, dan];
  await online([ann].concat(players));
  for (const d of players) await befriend(ann, d);        // Ben, Cat and Dan are not friends of one another
  const t = ann.T.create({ name: 'Codes typed', fmt: 'modern', bo: 3, rounds: 3, invite: players.map(d => d.code) });
  const id = t.id;
  await until(() => players.every(d => d.T.get(id)), 2000, 'invited');
  for (const d of players) d.T.answer(id, true);
  await until(() => ann.T.get(id).players.filter(p => p.st === 'in').length === 4, 2000, 'all in');
  ann.T.start(id);
  await until(() => inStep(ann, players, id), 2000, 'round one');
  const dev = (code) => [ann].concat(players).find(d => d.code === code);
  const p1 = ann.T.get(id).rnds[0].pairs.find(p => p.a !== ann.code && p.b !== ann.code);
  const host = dev(p1.a), guest = dev(p1.b);
  const other = players.find(d => d !== host && d !== guest);
  // the organiser is away: the host's room cannot be passed on, and the guest types the code
  ann.hub.stop();
  await until(() => players.every(d => !d.hub.isOnline(ann.code)), 2000, 'Ann goes away');
  host.T.roomOpened(id, 1, p1.t, 'TYPED');
  check(!guest.T.myMatch(guest.T.get(id)).room, 'the guest has not heard of the room');
  // a note from someone who is not the guest's opponent, or for another table, or another tournament: nothing
  check(!guest.T.tableNote({ id, r: 1, tb: p1.t, host: other.code }, 'TYPED'), 'a note naming someone else as the host is ignored');
  check(!guest.T.tableNote({ id, r: 1, tb: p1.t === 1 ? 2 : 1, host: host.code }, 'TYPED'), 'a note for another table is ignored');
  check(!guest.T.tableNote({ id: 'e'.repeat(24), r: 1, tb: p1.t, host: host.code }, 'TYPED'), 'a note for a tournament the guest is not in is ignored');
  check(!guest.T.tableNote({ id, r: 1, tb: p1.t, host: guest.code }, 'TYPED') && !guest.T.tableNote({ id, r: 1, tb: p1.t, host: 'nonsense' }, 'TYPED') && !guest.T.tableNote(null, 'TYPED'), 'or one that names the guest, or junk');
  check(!guest.T.gameOver('TYPED', { w: 2, l: 0, d: 0 }), 'so a game there is no match of theirs yet');
  check(!(guest.T.get(id).rnds[0].pairs.find(p => p.t === p1.t).rep[guest.code]), 'and nothing is reported');
  // the real note: the guest's own match, the host its opponent
  check(guest.T.tableNote({ id, r: 1, tb: p1.t, host: host.code }, 'TYPED'), 'the host’s own note links the table to the guest’s match');
  check(guest.T.myMatch(guest.T.get(id)).room === 'TYPED', 'as if the room had come from the organiser');
  host.T.gameOver('TYPED', { w: 2, l: 1, d: 0 });
  const auto = guest.T.gameOver('TYPED', { w: 1, l: 2, d: 0 });
  check(!!auto, 'when the match ends, the guest’s result goes in by itself');
  check(guest.T.get(id).pend.rep && host.T.get(id).pend.rep, 'held, with the organiser away');
  check(!guest.T.gameOver('TYPED', { w: 2, l: 0, d: 0 }), 'a friendly rematch at the same table afterwards is not reported');
  ann.hub.start();
  await until(() => (ann.T.get(id).rnds[0].pairs.find(p => p.t === p1.t) || {}).by === 'agreed', 4000, 'once the organiser is back, both reports arrive and settle it');
  check(sameJSON(ann.T.get(id).rnds[0].pairs.find(p => p.t === p1.t).res, { a: 2, b: 1, d: 0 }), 'as the match went, not as the rematch did');
  // the guest's copy a round behind: the note is kept, and linked once the copy catches up
  const p0 = ann.T.get(id).rnds[0].pairs.find(p => p.t !== p1.t);
  await until(() => players.every(d => d.hub.isOnline(ann.code)), 3000);
  const g2 = guest;
  broker.drop = (m, conn) => m.t === 'tn' && m.op === 'state' && conn.other && conn.other.owner.id.endsWith(g2.code);
  ann.T.setResult(id, 1, p0.t, { a: 2, b: 0, d: 0 });
  await until(() => ann.T.get(id).rnds.length === 2, 2000, 'round two is paired at the organiser');
  check(g2.T.get(id).rnds.length === 1, 'but the guest’s copy is still at round one');
  const p2 = ann.T.get(id).rnds[1].pairs.find(p => p.a === g2.code || p.b === g2.code);
  const opp2 = p2.a === g2.code ? p2.b : p2.a;
  check(!g2.T.tableNote({ id, r: 2, tb: p2.t, host: opp2 }, 'LATER'), 'a note for round two is not linked yet');
  g2.T.gameOver('LATER', { w: 0, l: 2, d: 0 });
  check(!ann.T.get(id).rnds[1].pairs.find(p => p.t === p2.t).rep[g2.code], 'nor reported yet');
  broker.drop = null;
  // anything that makes the organiser send the tournament again brings the guest up to date
  g2.hub.sendTourney(ann.code, { op: 'sync', id, rev: 0 });
  await until(() => g2.T.get(id).rnds.length === 2, 2000, 'the guest’s copy catches up');
  await until(() => !!ann.T.get(id).rnds[1].pairs.find(p => p.t === p2.t).rep[g2.code], 2000, 'and the kept note links the table, and the result it saw goes in');
  const got = ann.T.get(id).rnds[1].pairs.find(p => p.t === p2.t).rep[g2.code];
  check(sameJSON(p2.a === g2.code ? got : { a: got.b, b: got.a, d: got.d }, { a: 0, b: 2, d: 0 }), 'the result as the guest’s table saw it');
  for (const d of [ann].concat(players)) d.hub.stop();
}

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FC_make = (d) => d.MTG.friendsCore.makeCode(8);

main().catch((e) => { console.error(e); console.log(`tournaments: ${passes} passed, ${fails + 1} failed`); process.exit(1); });
