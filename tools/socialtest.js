#!/usr/bin/env node
/* Friends, invites, trading and moving a save (src/09c-friends.js,
   src/09d-trade.js, src/09e-move.js), checked without a browser.

   Each device is its own little browser: a VM context with its own
   storage, running the real modules, and they reach each other through a
   pretend PeerJS broker that delivers messages in order, copied as JSON
   the way PeerJS does, and can lose some on purpose. Checked:

   - friend codes: the check letter catches a wrong letter and nearly
     every swap; SHA-256 against Node's own;
   - asking, accepting, declining, removing and blocking, online and not,
     both asking at once, and someone else on a friend's code;
   - presence, profiles and invites, and junk on the line;
   - a trade from both sides: the binder, the deal, confirming, the
     collections after, a deck's cards warned about, and the line dropped
     before and after each side has carried it out (each side changes
     exactly once); a commit or an applied that arrives twice;
   - the wishlist, and the save sent from one device to another.

   node tools/socialtest.js         A failure exits non-zero. Run by tools/check.py ('social'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const MODULES = ['00-core.js', '10c-economy.js', '09c-friends.js', '09d-trade.js', '09e-move.js'];
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

/* ---------------- a pretend PeerJS broker ---------------- */
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
      /** Gone at this end only, the far end none the wiser: a phone put to sleep. */
      vanish() {
        this.gone = true; this.open = false;
        this.owner.conns.delete(this);
        setTimeout(() => this._emit('close'), 0);
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
function device(name, broker, opts) {
  opts = opts || {};
  const store = new Map();
  const fakeEl = () => ({
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    appendChild(c) { return c; }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  });
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, performance,
    crypto: nodeCrypto.webcrypto, unescape, encodeURIComponent,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i],
      get length() { return store.size; },
    },
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
  if (opts.code) MTG.settings.friendCode = opts.code;
  const me = { name, avatar: null, frame: null };
  const Peer = broker.makePeerClass();
  const hub = MTG.friendsCore.createHub({
    Peer: () => Peer, store: MTG.store, timing: TIMING,
    getCode: () => MTG.settings.friendCode, setCode: (c) => MTG.setSetting('friendCode', c),
    profile: () => me, peerOptions: () => ({}),
  });
  MTG.trade.attach(hub);
  // a deck store of our own: [{ name, cards: [[name, copies]] }]
  const decks = [];
  MTG.decks = {
    index: () => decks.map((d, i) => ({ id: 'd' + i, name: d.name })),
    load: async (id) => { const d = decks[+id.slice(1)]; return { main: d.cards.map(([n, q]) => ({ card: { name: n }, qty: q })), sideboard: [], commanders: [] }; },
  };
  const eco = MTG.economy;
  eco.state.col = {};               // nothing from the welcome gift: each test says what is owned
  eco.save();
  return {
    name, ctx, MTG, hub, store, me, Peer, decks, eco, trade: MTG.trade,
    own(cards) { const col = eco.state.col; for (const [n, k, r] of cards) col[n] = { n: k, r: r || 'common', s: 'tst', id: uuid(n) }; eco.save(); },
    count: (n) => { const e = eco.state.col[n]; return e ? e.n : 0; },
    get code() { return hub.code; },
  };
}
/* A device with the windows too: the interface modules on a pretend DOM
   (tools/fakedom.js), the app itself stood in for by a few functions. */
const UI_MODULES = ['00-core.js', '09-net.js', '10c-economy.js', '09c-friends.js', '09d-trade.js', '09e-move.js',
  '10-ui-core.js', '10b-ui-avatar.js', '10g-ui-social.js', '10h-ui-trade.js'];
const UI_CODE = UI_MODULES.map(f => [f, SRC(f)]);
function uiDevice(name, broker, opts) {
  opts = opts || {};
  const { Document } = require('./fakedom');
  const store = new Map();
  const doc = new Document();
  const timers = [];
  const ctx = {
    console, setTimeout, clearTimeout, clearInterval, TextEncoder, performance, URLSearchParams,
    setInterval: (f, ms) => { const t = setInterval(f, ms); timers.push(t); return t; },
    crypto: nodeCrypto.webcrypto, unescape, encodeURIComponent, document: doc, Blob: class {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), key: (i) => Array.from(store.keys())[i], get length() { return store.size; },
    },
    location: { search: opts.search || '', pathname: '/play/', origin: 'https://example.com', hash: '', href: 'https://example.com/play/' + (opts.search || '') },
    history: { state: null, replaceState(s, t, url) { ctx.location.search = String(url).includes('?') ? String(url).slice(String(url).indexOf('?')) : ''; } },
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
  MTG.formats = { get: () => ({ name: 'Commander' }) };
  MTG.scry = {
    imageUrl: () => '', forgetArt() {},
    byId: async () => null,
    byName: async (n) => ({ name: n, id: uuid(n), type_line: 'Instant' }),
    collection: async (ids) => ({ cards: ids.map(i => (i.name ? { name: i.name, id: uuid(i.name) } : null)) }),
  };
  for (const [file, code] of UI_CODE.slice(1)) run(file, code);
  MTG.settings.playerName = opts.unnamed ? '' : name;
  MTG.economy.state.col = {};
  MTG.economy.save();
  const decks = [];
  MTG.decks = {
    index: () => decks.map((d, i) => ({ id: 'd' + i, name: d.name })),
    load: async (id) => { const d = decks[+id.slice(1)]; return { main: d.cards.map(([n, q]) => ({ card: { name: n }, qty: q })), sideboard: [], commanders: [] }; },
  };
  const app = MTG.app = {
    screen: 'home', myName: name, joined: [], loaded: null,
    joinRoom(code) { app.joined.push(code); },
    async exitToMenu() { app.screen = 'home'; },
    leaveGame() { app.screen = 'home'; },
    profileDoc: () => { const data = {}; for (const [k, v] of store) if (k.startsWith('mtgtable.')) data[k] = v; return { app: 'mtg-table', kind: 'profile', v: 1, at: new Date().toISOString(), data }; },
    async loadProfileDoc(d, o) { app.loaded = d; if (o && o.before) await o.before(); return true; },
  };
  const all = (sel) => doc.querySelectorAll(sel);
  return {
    name, ctx, MTG, doc, store, app, all, timers, decks,
    own(cards) { const col = MTG.economy.state.col; for (const [n, k, r] of cards) col[n] = { n: k, r: r || 'common', s: 'tst', id: uuid(n) }; MTG.economy.save(); },
    count: (n) => { const e = MTG.economy.state.col[n]; return e ? e.n : 0; },
    /** The button whose words are `text`, inside `root` (a selector or a node), the last one found. */
    button(text, root) {
      const host = typeof root === 'string' ? doc.querySelectorAll(root).pop() : (root || doc);
      if (!host) return null;
      const list = host.querySelectorAll('button').filter(b => b.textContent.trim() === text);
      return list[list.length - 1] || null;
    },
    /** The last window open. */
    top: () => all('.modal').pop() || null,
  };
}
const uuid = (s) => { const h = nodeCrypto.createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const entryOf = (d, code) => d.hub.entries().find(e => e.code === code);
const stored = (d) => JSON.parse(d.store.get('mtgtable.friends') || '{}');
const secretOf = (d, code) => ((stored(d).list || []).find(e => e.code === code) || {}).secret;

async function befriend(a, b) {
  a.hub.add(b.code);
  await until(() => entryOf(b, a.code) && entryOf(b, a.code).state === 'in', 3000, `${b.name} gets ${a.name}'s request`);
  b.hub.accept(a.code);
  await until(() => a.hub.isOnline(b.code) && b.hub.isOnline(a.code), 3000, `${a.name} and ${b.name} become friends`);
}

/* ============================================================ */
async function main() {
  /* ---------------- codes and hashes ---------------- */
  const FC = device('Codes', new Broker()).MTG.friendsCore;
  for (let i = 0; i < 200; i++) {
    const c = FC.makeCode(8);
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(c) || !FC.isCode(c)) { check(false, 'a fresh code is a code: ' + c); break; }
  }
  const sample = FC.makeCode(8);
  let subs = 0, caught = 0;
  for (let i = 0; i < 8; i++) for (const ch of FC.ALPHABET) {
    if (ch === sample[i]) continue;
    subs++;
    if (!FC.isCode(sample.slice(0, i) + ch + sample.slice(i + 1))) caught++;
  }
  check(caught === subs, `every one-letter mistake is caught (${caught} of ${subs})`);
  let swaps = 0, swapCaught = 0;
  for (let t = 0; t < 300; t++) {
    const c = FC.makeCode(8);
    for (let i = 0; i < 7; i++) {
      if (c[i] === c[i + 1]) continue;
      swaps++;
      if (!FC.isCode(c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2))) swapCaught++;
    }
  }
  check(swapCaught / swaps > 0.95, `nearly every swap of two letters is caught (${swapCaught} of ${swaps})`);
  check(FC.parseCode(' ' + sample.slice(0, 4).toLowerCase() + '-' + sample.slice(4) + ' ').code === sample, 'a code typed in lower case with a dash is read');
  check(FC.parseCode('https://example.com/play/?friend=' + FC.formatCode(sample)).code === sample, 'a friend link is read for its code');
  check(/I, O, 0 or 1/.test(FC.parseCode('ABCD-EFG0').why || ''), 'a zero is explained');
  check(!!FC.parseCode('ABC').why && !!FC.parseCode('').why, 'too short, or nothing, is refused');
  check(FC.formatCode('ABCDEFGH') === 'ABCD-EFGH' && FC.formatCode('ABCDEF') === 'ABC-DEF', 'codes are shown in two halves');
  for (const s of ['', 'abc', 'The quick brown fox', 'Æther Vial — ✓ 漢字', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'q'.repeat(1000)])
    check(FC.sha256(s) === nodeCrypto.createHash('sha256').update(s).digest('hex'), `SHA-256 of a ${s.length}-character text`);

  /* ---------------- asking and accepting ---------------- */
  const broker = new Broker();
  const ann = device('Ann', broker), ben = device('Ben', broker);
  ann.hub.start(); ben.hub.start();
  await until(() => ann.hub.status === 'online' && ben.hub.status === 'online', 2000, 'both reach the broker');
  check(FC.isCode(ann.code) && ann.MTG.settings.friendCode === ann.code, 'a device gets a code, kept in the settings');
  check(!ann.hub.add(ann.code).ok, 'you cannot add yourself');
  check(!ann.hub.add('nonsense').ok, 'a bad code is refused');
  let asked = null;
  ben.hub.on('request', (code, name) => { asked = { code, name }; });
  const typed = ben.code.slice(0, 4).toLowerCase() + '-' + ben.code.slice(4).toLowerCase();
  check(ann.hub.add(typed).ok, 'Ann adds Ben by his code, typed loosely');
  check(entryOf(ann, ben.code).state === 'out', 'Ann has an outgoing request');
  await until(() => asked, 2000, 'Ben hears of the request');
  check(asked && asked.code === ann.code && asked.name === 'Ann', 'the request says who it is from');
  check(ben.hub.counts().requests === 1, 'Ben has one request waiting');
  let accepted = null;
  ann.hub.on('accepted', (code) => { accepted = code; });
  ben.hub.accept(ann.code);
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 2000, 'the friendship is proved both ways');
  check(accepted === ben.code, 'Ann hears that Ben accepted');
  check(entryOf(ann, ben.code).state === 'friend' && entryOf(ben, ann.code).state === 'friend', 'both are friends');
  check(entryOf(ann, ben.code).ok && entryOf(ben, ann.code).ok, 'both have seen it proved');
  check(secretOf(ann, ben.code) && secretOf(ann, ben.code) === secretOf(ben, ann.code), 'both keep the same secret');
  check(!broker.sent.some(m => m.t === 'proof' && m.m === secretOf(ann, ben.code)), 'the secret itself is never sent as a proof');
  check(ann.hub.counts().online === 1, 'Ann sees one friend online');
  check(entryOf(ann, ben.code).name === 'Ben', 'Ann sees Ben by name');
  check(ann.hub._links.size === 1 && ben.hub._links.size === 1, 'one line each way, not two');

  /* ---------------- presence, profile, invites ---------------- */
  ben.hub.setPresence('lobby');
  await until(() => ann.hub.presenceOf(ben.code) === 'lobby', 2000, 'Ann sees Ben go to a lobby');
  ben.hub.setPresence('game');
  await until(() => ann.hub.presenceOf(ben.code) === 'game', 2000, 'and into a game');
  ben.me.name = 'Benedict';
  ben.me.avatar = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  ben.hub.profileChanged();
  await until(() => entryOf(ann, ben.code).name === 'Benedict', 2000, 'a new name reaches friends');
  check(entryOf(ann, ben.code).avatar === ben.me.avatar, 'and a new picture');
  ben.me.avatar = 'data:image/jpeg;base64,' + 'A'.repeat(70000);
  ben.hub.profileChanged();
  await sleep(60);
  check(entryOf(ann, ben.code).avatar === null, 'a picture too big to be one of ours is not kept');
  let inv = null;
  ben.hub.on('invite', (i) => { inv = i; });
  check(ann.hub.invite(ben.code, 'abcde', 'Commander'), 'Ann can invite Ben');
  await until(() => inv, 2000, 'Ben gets the invite');
  check(inv && inv.room === 'ABCDE' && inv.fmt === 'Commander' && inv.code === ann.code, 'the invite names the room, the format and who sent it');
  check(!ann.hub.invite(ben.code, 'IO01!', 'x'), 'a room code that cannot be one is not sent');
  inv = null;
  ann.hub._links.get(ben.code).lastInvite = 0;
  const annLink = ann.hub._links.get(ben.code);
  FC.sendOn(annLink.conn, { t: 'invite', room: '<script>', fmt: 'x' });
  await sleep(40);
  check(inv === null, 'an invite to a room code that cannot be one is dropped');

  /* ---------------- a line that died at one end only ---------------- */
  // Ben's phone slept: his end of the line is gone, Ann's still looks up. Ben dials again,
  // and Ann takes the new line rather than holding on to the dead one
  ann.hub._links.get(ben.code).openedAt -= 20000;
  const t0 = Date.now();
  ben.hub._links.get(ann.code).conn.vanish();
  await until(() => !ben.hub.isOnline(ann.code), 1000, 'Ben’s end notices');
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code) && ann.hub._links.get(ben.code).conn.open && !ann.hub._links.get(ben.code).conn.gone &&
    ann.hub._links.get(ben.code).conn.other === ben.hub._links.get(ann.code).conn, 2000, 'the friends are back on one live line');
  check(Date.now() - t0 < TIMING.quiet, 'without waiting for the dead line to time out');

  /* ---------------- junk on the line ---------------- */
  const junk = [null, 7, 'hello', [], { t: 5 }, { t: 'hi', code: 'ZZZZZZZZ' }, { t: '~', id: 1, i: 0, n: 1e9, d: 'x' },
    { t: '~', id: 2, i: 5, n: 2, d: 'x' }, { t: 'accept', s: 'not hex' }, { t: 'presence', p: 'everywhere' }, { t: 'tr', op: 'commit', id: 'zz' },
    { t: 'profile', name: { evil: 1 }, avatar: 'javascript:alert(1)', frame: '../../x' }, { t: 'invite', room: 12 }, { t: 'proof', m: 123 }];
  let threw = false;
  const liveLink = ann.hub._links.get(ben.code);
  for (const m of junk) { try { liveLink.conn.send(m); } catch (e) { threw = true; } }
  await sleep(60);
  check(!threw && ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 'junk on the line changes nothing and breaks nothing');
  check(entryOf(ann, ben.code).name === 'Benedict', 'a profile made of junk is ignored');
  liveLink.conn.send({ t: 'profile', name: 'Benedict', avatar: 'data:image/png;base64,AAAA") ; background: url("https://example.com/x' });
  await sleep(40);
  check(entryOf(ann, ben.code).avatar === null, 'a "picture" that would break out of its CSS url() is not kept');

  // a stranger who says hello and nothing else is hung up on
  const lurker = new (broker.makePeerClass())(FC.PREFIX + FC.makeCode(8));
  await sleep(10);
  const lurk = lurker.connect(FC.PREFIX + ann.code);
  let lurkClosed = false;
  lurk.on('close', () => { lurkClosed = true; });
  lurk.on('open', () => lurk.send({ t: 'hi', v: 1, code: lurker.id.slice(FC.PREFIX.length), n: 'ab'.repeat(16), name: 'Lurker' }));
  await until(() => lurkClosed, 2000, 'a stranger who asks nothing is hung up on');
  check(!ann.hub.entries().some(e => e.name === 'Lurker'), 'and is not on the list');
  lurker.destroy();

  /* ---------------- someone else on a friend's code ---------------- */
  ben.hub.stop();
  await until(() => !ann.hub.isOnline(ben.code), 2000, 'Ann sees Ben go offline');
  const fake = device('Ben', broker, { code: ben.code });
  const sentBefore = broker.sent.length;
  fake.hub.start();
  await sleep(500);            // long enough for Ann to look for Ben, find "him", and talk
  const talk = broker.sent.slice(sentBefore);
  check(talk.some(m => m.t === 'proof') && talk.some(m => m.t === 'unfriend'), 'Ann did reach the impostor, who tried to unfriend her');
  check(!ann.hub.isOnline(ben.code), 'someone else on Ben\'s code is not taken for Ben');
  check(entryOf(ann, ben.code) && entryOf(ann, ben.code).state === 'friend', 'and cannot unfriend Ann from Ben');
  check(fake.hub.entries().length === 0, 'nor get onto anyone\'s list');
  fake.hub.stop();
  await sleep(30);
  ben.hub.start();
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 3000, 'the real Ben is recognised again');

  /* ---------------- asking someone offline; accepting while they are away ---------------- */
  const cat = device('Cat', broker), dan = device('Dan', broker);
  cat.hub.start();
  await until(() => cat.hub.status === 'online');
  const danCode = dan.code;
  check(cat.hub.add(danCode).ok, 'Cat asks Dan, who is not online');
  await sleep(100);
  check(entryOf(cat, danCode).state === 'out', 'the request waits');
  dan.hub.start();
  await until(() => entryOf(dan, cat.code) && entryOf(dan, cat.code).state === 'in', 3000, 'Dan gets it once he is online');
  cat.hub.stop();
  await until(() => !dan.hub._links.size, 2000);
  dan.hub.accept(cat.code);
  check(entryOf(dan, cat.code).state === 'friend' && !entryOf(dan, cat.code).ok, 'Dan accepts while Cat is away; it waits to be proved');
  cat.hub.start();
  await until(() => cat.hub.isOnline(danCode) && dan.hub.isOnline(cat.code), 3000, 'the acceptance reaches Cat when she is back');
  check(secretOf(cat, danCode) === secretOf(dan, cat.code), 'and they share one secret');

  /* ---------------- both asking at once ---------------- */
  const eve = device('Eve', broker), fay = device('Fay', broker);
  eve.hub.start(); fay.hub.start();
  await until(() => eve.hub.status === 'online' && fay.hub.status === 'online');
  eve.hub.add(fay.code); fay.hub.add(eve.code);
  await until(() => eve.hub.isOnline(fay.code) && fay.hub.isOnline(eve.code), 3000, 'two people adding each other become friends');
  check(secretOf(eve, fay.code) === secretOf(fay, eve.code), 'with one secret between them');
  check(eve.hub._links.size === 1 && fay.hub._links.size === 1, 'and one line');

  /* ---------------- declining ---------------- */
  let declined = null;
  eve.hub.on('declined', (code) => { declined = code; });
  eve.hub.add(ann.code);
  await until(() => entryOf(ann, eve.code), 2000, 'Ann gets Eve\'s request');
  ann.hub.decline(eve.code);
  await until(() => declined === ann.code, 2000, 'Eve hears it was declined');
  check(!entryOf(eve, ann.code) && !entryOf(ann, eve.code), 'and neither keeps it');
  eve.hub.add(ann.code);
  await sleep(150);
  check(!entryOf(ann, eve.code) && !entryOf(eve, ann.code), 'asking again after a decline is turned away');

  /* ---------------- blocking ---------------- */
  fay.hub.add(ann.code);
  await until(() => entryOf(ann, fay.code), 2000, 'Ann gets Fay\'s request');
  ann.hub.block(fay.code);
  check(!entryOf(ann, fay.code) && ann.hub.blocked().some(b => b.code === fay.code), 'Ann blocks Fay');
  await sleep(400);
  check(!entryOf(ann, fay.code), 'Fay asking again goes nowhere');
  check(!ann.hub._links.has(fay.code), 'and her line is not kept open');
  ann.hub.unblock(fay.code);
  check(!ann.hub.blocked().length, 'Ann can unblock');

  /* ---------------- removing, online and not ---------------- */
  let removed = null;
  dan.hub.on('removed', (code) => { removed = code; });
  cat.hub.remove(dan.code);
  await until(() => removed === cat.code, 2000, 'Dan hears Cat removed him');
  check(!entryOf(dan, cat.code) && !entryOf(cat, dan.code), 'both lists forget it');
  check((stored(cat).list || []).some(e => e.code === dan.code && e.state === 'gone'), 'Cat keeps a tombstone, to prove it later');
  // removing someone while they are away reaches them when they are back
  await befriend(ann, eve);        // Ann asks: her own add clears the decline she made
  eve.hub.stop();
  await until(() => !ann.hub.isOnline(eve.code));
  ann.hub.remove(eve.code);
  eve.hub.start();
  await until(() => !entryOf(eve, ann.code), 3000, 'a removal made while away reaches them when they are back');

  /* ---------------- trading ---------------- */
  ann.own([['Lightning Bolt', 4, 'common'], ['Llanowar Elves', 2, 'common'], ['Sol Ring', 1, 'uncommon']]);
  ben.own([['Counterspell', 2, 'uncommon'], ['Dark Ritual', 3, 'common'], ['Black Lotus', 1, 'rare']]);
  ann.decks.push({ name: 'Burn', cards: [['Lightning Bolt', 4], ['Mountain', 20]] });
  ben.trade.wish.add({ name: 'Sol Ring', set: 'tst', rarity: 'uncommon' });
  check(ben.trade.wish.has('Sol Ring') && !ben.trade.wish.add({ name: 'Forest' }), 'a card can be wanted; a basic land cannot');
  ann.trade.wish.add({ name: 'Black Lotus' });

  let bAsk = null;
  ben.trade.on('ask', (s) => { bAsk = s; });
  const sA = ann.trade.start(ben.code);
  check(sA && sA.id && sA.state === 'asking', 'Ann asks Ben to trade');
  check(!!ann.trade.start(ben.code).why, 'only one trade at a time');
  await until(() => bAsk, 2000, 'Ben is asked');
  ben.trade.answer(bAsk, true);
  const sB = bAsk;
  await until(() => sA.state === 'open' && sB.state === 'open' && sA.theirs.size && sB.theirs.size, 3000, 'both open the trade and see the other\'s binder');
  check(sB.theirs.get('Lightning Bolt').n === 4 && sB.theirs.get('Lightning Bolt').keep === 4, 'Ben sees Ann\'s Bolts, and that a deck of hers uses all four');
  check(sA.theirWants.has('Sol Ring') && sB.theirWants.has('Black Lotus'), 'each sees what the other wants');
  check(!sA.theirs.has('Mountain'), 'basic lands are not in a binder');

  ann.trade.setCount(sA, 'give', 'Lightning Bolt', 2);
  ann.trade.setCount(sA, 'get', 'Counterspell', 1);
  ben.trade.setCount(sB, 'give', 'Dark Ritual', 1);
  ben.trade.setCount(sB, 'get', 'Sol Ring', 1);
  check(!ann.trade.setCount(sA, 'give', 'Lightning Bolt', 9), 'more copies than you have cannot go in');
  await until(() => sB.rev === sA.rev && sA.rev >= 4 && ben.trade.get(sB).get('Sol Ring') === 1, 2000, 'both see the same deal');
  check(ann.trade.give(sA).get('Lightning Bolt') === 2 && ann.trade.give(sA).get('Sol Ring') === 1, 'Ann gives two Bolts and a Sol Ring');
  check(ann.trade.get(sA).get('Counterspell') === 1 && ann.trade.get(sA).get('Dark Ritual') === 1, 'and gets a Counterspell and a Dark Ritual');
  check(ben.trade.give(sB).get('Counterspell') === 1 && ben.trade.get(sB).get('Lightning Bolt') === 2, 'Ben sees it from his side');
  const warn = ann.trade.deckWarnings(sA);
  check(warn.length === 1 && warn[0].name === 'Lightning Bolt' && warn[0].decks[0].name === 'Burn', 'Ann is warned her Burn deck uses those Bolts');

  // a change after confirming unconfirms
  check(ann.trade.confirm(sA) === '', 'Ann confirms');
  await until(() => ben.trade.theyConfirmed(sB), 2000, 'Ben sees Ann confirmed');
  ben.trade.setCount(sB, 'get', 'Llanowar Elves', 1);
  await until(() => !ann.trade.iConfirmed(sA) && ann.trade.give(sA).get('Llanowar Elves') === 1, 2000, 'a change unconfirms Ann');
  await until(() => sB.rev === sA.rev, 2000);
  check(!ben.trade.theyConfirmed(sB), 'and Ben sees that');

  const before = { a: ['Lightning Bolt', 'Sol Ring', 'Llanowar Elves', 'Counterspell', 'Dark Ritual'].map(ann.count), b: ['Counterspell', 'Dark Ritual', 'Lightning Bolt', 'Sol Ring', 'Llanowar Elves'].map(ben.count) };
  check(ben.trade.confirm(sB) === '', 'Ben confirms');
  await until(() => ann.trade.theyConfirmed(sA), 2000, 'Ann sees Ben confirmed');
  check(ann.trade.confirm(sA) === '', 'Ann confirms too');
  await until(() => sA.state === 'done' && sB.state === 'done', 3000, 'the trade goes through');
  check(ann.count('Lightning Bolt') === 2 && ann.count('Sol Ring') === 0 && ann.count('Llanowar Elves') === 1, 'Ann\'s cards went');
  check(ann.count('Counterspell') === 1 && ann.count('Dark Ritual') === 1, 'and Ben\'s came');
  check(ben.count('Counterspell') === 1 && ben.count('Dark Ritual') === 2, 'Ben\'s cards went');
  check(ben.count('Lightning Bolt') === 2 && ben.count('Sol Ring') === 1 && ben.count('Llanowar Elves') === 1, 'and Ann\'s came');
  check(!ben.trade.wish.has('Sol Ring'), 'a wanted card that came in is off the wishlist');
  check(ann.trade.log()[0] && ann.trade.log()[0].state === 'done' && ben.trade.log()[0].state === 'done', 'both log it');
  check(!ann.trade.pending().length && !ben.trade.pending().length, 'nothing is left owing');
  check(ann.eco.state.tradeIds.includes(sA.id) && ben.eco.state.tradeIds.includes(sA.id), 'both note it as done');
  check(JSON.stringify(before.a) === JSON.stringify([4, 1, 2, 0, 0]) && JSON.stringify(before.b) === JSON.stringify([2, 3, 0, 0, 0]), 'the counts before were as set up');

  // the same commit, or the same applied, again changes nothing
  const snapA = JSON.stringify(ann.eco.state.col), snapB = JSON.stringify(ben.eco.state.col);
  ann.hub.sendTrade(ben.code, { op: 'commit', id: sA.id, h: 'x'.repeat(32) });
  ben.hub.sendTrade(ann.code, { op: 'applied', id: sA.id, h: 'x'.repeat(32) });
  await sleep(80);
  check(JSON.stringify(ann.eco.state.col) === snapA && JSON.stringify(ben.eco.state.col) === snapB, 'a commit or an applied that comes twice changes nothing');

  /* ---- the line drops after the leader committed, before the follower had it ---- */
  async function openTrade(a, b) {
    let ask = null;
    const off = b.trade.on('ask', (s) => { ask = s; });
    const s1 = a.trade.start(b.code);
    if (s1.why) { check(false, 'a trade opens: ' + s1.why); return [null, null]; }
    await until(() => ask, 2000, 'asked');
    off();
    b.trade.answer(ask, true);
    await until(() => s1.state === 'open' && ask.state === 'open' && s1.theirs.size && ask.theirs.size, 3000, 'the trade opens');
    return [s1, ask];
  }
  let [t1, t2] = await openTrade(ann, ben);
  ann.trade.setCount(t1, 'give', 'Lightning Bolt', 1);
  ann.trade.setCount(t1, 'get', 'Black Lotus', 1);
  await until(() => t2.rev === t1.rev && t1.rev === 2, 2000);
  ben.trade.confirm(t2);
  await until(() => ann.trade.theyConfirmed(t1), 2000);
  broker.drop = (m) => m.t === 'tr' && m.op === 'commit';
  ann.trade.confirm(t1);
  await until(() => ann.trade.pending().some(p => p.state === 'prepared'), 2000, 'Ann prepares the trade');
  check(ben.trade.pending().some(p => p.state === 'confirmed'), 'Ben holds his confirmation');
  check(!ann.trade.myBinder(null).has('Lightning Bolt') || ann.trade.myBinder(null).get('Lightning Bolt').n === 1, 'the Bolt promised is held back from other trades');
  ben.hub.stop();
  await until(() => t2.state === 'closed' && !ann.hub.isOnline(ben.code), 2000, 'Ben drops off');
  check(ann.count('Lightning Bolt') === 2 && ben.count('Black Lotus') === 1, 'nothing has moved yet');
  check(ben.trade.pending().some(p => p.id === t1.id && p.state === 'confirmed'), 'Ben still has his confirmation in the journal');
  broker.drop = null;
  ben.hub.start();
  await until(() => !ann.trade.pending().length && !ben.trade.pending().length, 4000, 'the trade finishes once both are back');
  check(ann.count('Lightning Bolt') === 1 && ann.count('Black Lotus') === 1, 'Ann\'s side happened once');
  check(ben.count('Black Lotus') === 0 && ben.count('Lightning Bolt') === 3, 'Ben\'s side happened once');
  check(ann.trade.log()[0].id === t1.id && ben.trade.log()[0].id === t1.id, 'and both log it');
  check(!ann.trade.wish.has('Black Lotus'), 'Ann\'s wanted Lotus is off her wishlist');

  /* ---- the line drops after the follower carried it out, before the leader heard ---- */
  [t1, t2] = await openTrade(ben, ann);       // Ben leads this time
  ben.trade.setCount(t1, 'give', 'Lightning Bolt', 3);
  ben.trade.setCount(t1, 'get', 'Counterspell', 1);
  await until(() => t2.rev === t1.rev && t1.rev === 2, 2000);
  ann.trade.confirm(t2);
  await until(() => ben.trade.theyConfirmed(t1), 2000);
  broker.drop = (m) => m.t === 'tr' && m.op === 'applied';
  ben.trade.confirm(t1);
  await until(() => ann.count('Lightning Bolt') === 4, 2000, 'Ann carries out her side');
  check(ann.count('Counterspell') === 0 && ben.count('Lightning Bolt') === 3, 'Ben has not, yet');
  ben.hub.stop();
  await until(() => !ann.hub.isOnline(ben.code), 2000);
  broker.drop = null;
  ben.hub.start();
  await until(() => !ben.trade.pending().length, 4000, 'Ben finishes his side once back');
  check(ben.count('Lightning Bolt') === 0 && ben.count('Counterspell') === 2, 'Ben\'s side happened once');
  check(ann.count('Lightning Bolt') === 4 && ann.count('Counterspell') === 0, 'and Ann\'s still only once');

  /* ---- the follower no longer has the cards: nothing happens ---- */
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 3000);
  [t1, t2] = await openTrade(ann, ben);
  ben.trade.setCount(t2, 'give', 'Dark Ritual', 2);
  await until(() => t1.F.get('Dark Ritual') === 2 && t2.rev === t1.rev, 2000);
  ben.trade.confirm(t2);
  await until(() => ann.trade.theyConfirmed(t1), 2000);
  ben.eco.state.col['Dark Ritual'].n = 1;     // a save loaded underneath, say
  const lotusBefore = ann.count('Dark Ritual');
  let note = '';
  ann.trade.on('note', (s, text) => { note = text; });
  ann.trade.confirm(t1);
  await until(() => note, 2000, 'Ann hears the trade did not go through');
  check(t1.state === 'open' && !ann.trade.iConfirmed(t1), 'the trade is open again, unconfirmed');
  check(ann.count('Dark Ritual') === lotusBefore && ben.count('Dark Ritual') === 1, 'and nothing moved');
  check(!ann.trade.pending().length, 'and nothing is owed');
  ann.trade.cancel(t1);
  await until(() => t2.state === 'closed', 2000, 'Ann closes it, and Ben sees that');

  /* ---- the line drops after the follower confirmed, before the leader did: asked after, and let go ---- */
  [t1, t2] = await openTrade(ann, ben);
  ann.trade.setCount(t1, 'get', 'Dark Ritual', 1);
  await until(() => t2.rev === t1.rev && t1.rev === 1, 2000);
  ben.trade.confirm(t2);
  await until(() => ann.trade.theyConfirmed(t1), 2000);
  ben.hub.stop();
  await until(() => t1.state === 'closed' && t2.state === 'closed', 2000, 'both sides close the trade when the line drops');
  check(ben.trade.pending().some(p => p.id === t1.id && p.state === 'confirmed') && !ann.trade.pending().length, 'Ben keeps his confirmation; Ann never sent it through');
  ben.hub.start();
  await until(() => !ben.trade.pending().length, 4000, 'back online, Ben asks after it, hears Ann has nothing, and lets it go');
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 3000);

  /* ---- a confirmation let go while the other side is away: refused when it comes back ---- */
  [t1, t2] = await openTrade(ann, ben);
  ann.trade.setCount(t1, 'get', 'Dark Ritual', 1);
  await until(() => t2.rev === t1.rev && t1.rev === 1, 2000);
  ben.trade.confirm(t2);
  await until(() => ann.trade.theyConfirmed(t1), 2000);
  broker.drop = (m) => m.t === 'tr' && m.op === 'commit';
  ann.trade.confirm(t1);
  await until(() => ann.trade.pending().some(p => p.id === t1.id && p.state === 'prepared'), 2000);
  ben.hub.stop();
  await until(() => !ann.hub.isOnline(ben.code), 2000);
  broker.drop = null;
  check(ben.trade.abandon(t1.id) && !ben.trade.pending().length, 'Ben lets his confirmation go');
  check(ben.trade.log()[0].id === t1.id && ben.trade.log()[0].state === 'failed', 'and it is in his history as not done');
  const ritualA = ann.count('Dark Ritual'), ritualB = ben.count('Dark Ritual');
  ben.hub.start();
  await until(() => !ann.trade.pending().length, 4000, 'Ann’s commit, sent again, is turned down and she lets it go too');
  check(ann.count('Dark Ritual') === ritualA && ben.count('Dark Ritual') === ritualB, 'and nothing moved on either side');
  check(ann.trade.log()[0].id === t1.id && ann.trade.log()[0].state === 'failed', 'Ann’s history says it did not go through');
  await until(() => ann.hub.isOnline(ben.code) && ben.hub.isOnline(ann.code), 3000);

  /* ---- someone else asking while a trade is open is told so ---- */
  const cat2 = cat;
  await befriend(cat2, ann);
  [t1, t2] = await openTrade(ann, ben);
  const sC = cat2.trade.start(ann.code);
  await until(() => sC.state === 'closed', 2000, 'Cat is told Ann is busy');
  check(/another trade/.test(sC.why), 'in so many words');
  ann.trade.cancel(t1);
  await until(() => t2.state === 'closed');

  /* ---- pieces on their own ---- */
  const T = ann.trade;
  const needs = T.needsFromDecks([{ name: 'A', cards: [['Bolt', 3], ['Bolt', 2], ['Island', 9]] }, { name: 'B', cards: [['Bolt', 1], ['Ritual', 2]] }]);
  check(needs.get('Bolt').n === 4 && needs.get('Bolt').decks.length === 2 && needs.get('Ritual').n === 2 && !needs.has('Island'), 'what decks use: the most any one deck uses, up to four, no basics');
  check(T.readBinder({ cards: [['__proto__', 1], ['constructor', 2], ['Real Card', 3, 0, 'rare', 'abc', 'bad id'], ['Real Card', 2]], wants: ['x'] }).cards.size === 1, 'a binder keeps real names only, once each');
  check(T.readBinder({ cards: [['Card', 7]] }).cards.size === 0 && T.readBinder({ cards: 'no' }) === null, 'and real counts only');
  check(T.readHalf([['A', 1], ['A', 2]]) === null && T.readHalf([['A', 0]]) === null && T.readHalf(new Array(41).fill(0).map((x, i) => ['C' + i, 1])) === null, 'a half of a deal that cannot be one is refused');
  check(({}).n === undefined && Object.prototype.n === undefined, 'nothing leaked onto every object');

  /* ---------------- moving a save ---------------- */
  const mover = device('Mover', broker), fresh = device('Fresh', broker);
  mover.own([['Shivan Dragon', 3, 'rare']]);
  mover.MTG.setSetting('playerName', 'Mover');
  const doc = () => {
    const data = {};
    for (const [k, v] of mover.store) if (k.startsWith('mtgtable.')) data[k] = v;
    return { app: 'mtg-table', kind: 'profile', v: 1, at: new Date().toISOString(), data };
  };
  mover.store.set('mtgtable.big', 'z'.repeat(50000));       // so it goes in pieces
  const states = [];
  const tx = mover.MTG.move.send({ Peer: () => mover.Peer, makeDoc: doc, name: 'Mover' });
  tx.on('state', (s, info) => states.push([s, info]));
  await until(() => states.some(s => s[0] === 'waiting'), 2000, 'the sender shows a code');
  const code = states.find(s => s[0] === 'waiting')[1].code;
  check(FC.isCode(code, 6), 'a six-letter code with its check letter');
  let got = null;
  const rxStates = [];
  const rx = fresh.MTG.move.receive(code.slice(0, 3) + ' ' + code.slice(3).toLowerCase(), { Peer: () => fresh.Peer, name: 'Fresh' });
  rx.on('state', (s, info) => { rxStates.push(s); if (s === 'received') got = info; });
  await until(() => got, 3000, 'the save arrives');
  check(got && JSON.stringify(got.doc.data) === JSON.stringify(doc().data), 'all of it, exactly');
  check(got && got.summary.cards === 1 && got.summary.name === 'Mover' && got.from === 'Mover', 'with a summary to ask about');
  check(rxStates.includes('receiving') && states.some(s => s[0] === 'sending' && s[1].of > 1), 'in pieces, with progress both ends');
  // a second device with the same code gets nowhere: it was spent on the first
  let second = null;
  const rx2 = device('Other', broker).MTG.move.receive(code, { Peer: () => broker.makePeerClass(), name: 'Other' });
  rx2.on('state', (s, info) => { if (s === 'failed') second = info.why; });
  await until(() => second, 3000, 'a second device with the same code is turned away');
  rx.take();
  await until(() => states.some(s => s[0] === 'done'), 2000, 'the sender hears it was taken');
  // the wrong code is explained
  let wrong = null;
  fresh.MTG.move.receive(FC.makeCode(6), { Peer: () => fresh.Peer }).on('state', (s, info) => { if (s === 'failed') wrong = info.why; });
  await until(() => wrong, 3000, 'a code nobody is showing is explained');
  check(/No device is showing that code/.test(wrong || ''), 'in so many words');
  const M = fresh.MTG.move;
  check(!M.checkDoc(null).ok && !M.checkDoc({ app: 'mtg-table', kind: 'profile', data: { evil: 'x' } }).ok &&
    !M.checkDoc({ app: 'mtg-table', kind: 'profile', data: { 'mtgtable.x': 5 } }).ok && M.checkDoc(doc()).ok, 'only a real save is accepted');

  for (const d of [ann, ben, cat, dan, eve, fay]) d.hub.stop();

  /* ---------------- the windows, clicked through ---------------- */
  const ub = new Broker();
  const uma = uiDevice('Uma', ub), vic = uiDevice('Vic', ub, { unnamed: true });
  for (const d of [uma, vic]) d.MTG.bus.emit('app:ready');
  await until(() => uma.MTG.friends.status === 'online' && vic.MTG.friends.status === 'online', 2000, 'both windows’ hubs reach the broker');
  const chip = uma.MTG.ui.friendsChip();
  uma.doc.body.appendChild(chip);
  uma.MTG.ui.openFriends();
  check(!!uma.doc.querySelector('.friends-modal .fr-code'), 'the Friends window shows your code');
  check(uma.doc.querySelector('.fr-code').textContent === FC.formatCode(uma.MTG.friends.code), 'in two halves');
  check(/No friends yet/.test(uma.doc.querySelector('.fr-lists').textContent), 'and says there is nobody yet');
  uma.doc.querySelector('#fr-add').value = 'not a code';
  uma.button('Add', '.fr-add').click();
  check(uma.doc.querySelector('.fr-add-msg').classList.contains('bad'), 'a bad code is explained under the box');
  uma.doc.querySelector('#fr-add').value = FC.formatCode(vic.MTG.friends.code).toLowerCase();
  uma.button('Add', '.fr-add').click();
  check(/Asked/.test(uma.doc.querySelector('.fr-add-msg').textContent), 'adding says it is asked');
  await until(() => vic.doc.querySelector('.social-note'), 2000, 'Vic gets a note about the request');
  check(/Uma wants to be friends/.test(vic.doc.querySelector('.social-note').textContent), 'which says who');
  await until(() => /Asked/.test(uma.doc.querySelector('.fr-lists').textContent), 1000, 'Uma’s list shows the request she made');
  vic.button('Accept', '.social-note').click();
  await until(() => uma.MTG.friends.isOnline(vic.MTG.friends.code) && vic.MTG.friends.isOnline(uma.MTG.friends.code), 2000, 'the note’s Accept makes them friends');
  await until(() => chip.querySelector('.fc-n').textContent === '1', 1000, 'the chip counts one friend online');
  await until(() => uma.button('Trade', '.fr-lists'), 1000, 'Uma’s list has a Trade button by Vic');
  check(/Online/.test(uma.doc.querySelector('.fr-row.p-online').textContent), 'shown as online');

  // a trade, all by the buttons
  uma.own([['Lightning Bolt', 3, 'common']]);
  vic.own([['Counterspell', 2, 'uncommon']]);
  uma.button('Trade', '.fr-lists').click();
  check(!!uma.doc.querySelector('.trade-modal'), 'the trade window opens');
  check(/Waiting for Vic/.test(uma.doc.querySelector('.tr-status').textContent), 'waiting for Vic to say yes');
  await until(() => vic.button('Open', '.social-note'), 2000, 'Vic is asked, in a note');
  vic.button('Open', '.social-note').click();
  check(!!vic.doc.querySelector('.trade-modal'), 'Vic’s trade window opens');
  await until(() => uma.doc.querySelectorAll('.trade-modal .tr-row').length && vic.doc.querySelectorAll('.trade-modal .tr-row').length, 3000, 'both see the other’s binder');
  check(/Counterspell/.test(uma.doc.querySelector('.tr-list').textContent), 'Uma sees Vic’s Counterspells');
  uma.doc.querySelector('.tr-row .tr-add').click();
  await until(() => /Counterspell/.test(vic.doc.querySelector('.tr-half.give').textContent), 2000, 'what Uma asks for shows on Vic’s side as his to give');
  vic.doc.querySelector('.tr-row .tr-add').click();
  await until(() => /Lightning Bolt/.test(uma.doc.querySelector('.tr-half.give').textContent), 2000, 'and what Vic asks for on Uma’s');
  uma.doc.querySelector('.trade-modal .modal-foot .btn.primary').click();
  await until(() => /Uma confirmed/.test(vic.doc.querySelector('.tr-status').textContent), 2000, 'Vic is told Uma confirmed');
  vic.button('Confirm trade', '.trade-modal').click();
  await until(() => /Done/.test(uma.doc.querySelector('.tr-status').textContent) && /Done/.test(vic.doc.querySelector('.tr-status').textContent), 3000, 'both windows say it is done');
  check(uma.count('Lightning Bolt') === 2 && uma.count('Counterspell') === 1 && vic.count('Counterspell') === 1 && vic.count('Lightning Bolt') === 1, 'and the cards moved');
  const words = (d) => d.doc.body.textContent;
  check(!/\bnull\b|\bundefined\b|NaN|\[object/.test(words(uma) + words(vic)), 'no "null", "undefined" or "NaN" anywhere on screen');
  uma.button('Close', '.trade-modal').click();
  vic.button('Close', '.trade-modal').click();
  check(!uma.doc.querySelector('.trade-modal'), 'the window closes');

  // Vic asks this time; Uma lets the note go, and opens the trade from her list instead
  uma.decks.push({ name: 'Burn', cards: [['Lightning Bolt', 4]] });
  vic.MTG.ui.tradeWith(uma.MTG.friends.code);
  await until(() => uma.doc.querySelector('.social-note .sn-x') && /wants to trade/.test(uma.doc.querySelector('#social-notes').textContent), 2000, 'Uma is asked');
  uma.doc.querySelectorAll('.social-note .sn-x').pop().click();
  await until(() => /Wants to trade/.test(uma.doc.querySelector('.fr-lists').textContent), 1000, 'her list shows the trade waiting for her');
  uma.button('Open', '.fr-section.invites').click();
  await until(() => uma.doc.querySelector('.trade-modal') && uma.doc.querySelectorAll('.trade-modal .tr-row').length, 3000, 'opening it from there opens the trade');
  uma.doc.querySelectorAll('.trade-modal .tr-tabs .seg-btn')[1].click();
  await until(() => /Lightning Bolt/.test(uma.doc.querySelector('.tr-list').textContent), 1000, 'her own cards are a tab away');
  check(/decks use 4/.test(uma.doc.querySelector('.tr-list').textContent), 'marked as used by her decks');
  uma.doc.querySelectorAll('.trade-modal .tr-row').find(r => /Lightning Bolt/.test(r.textContent)).querySelector('.tr-add').click();
  await until(() => uma.doc.querySelector('.trade-modal .tr-warn'), 2000, 'giving a card a deck uses is warned about beside it');
  check(/Burn uses 4; you would keep 1/.test(uma.doc.querySelector('.tr-warn').textContent), 'in so many words');
  uma.button('Confirm trade', '.trade-modal').click();
  await until(() => uma.button('Keep them'), 1000, 'and again on confirming');
  uma.button('Keep them').click();
  await sleep(30);
  check(!uma.MTG.trade.iConfirmed(uma.MTG.trade.current()), 'Keep them does not confirm');
  uma.button('Confirm trade', '.trade-modal').click();
  await until(() => uma.button('Trade anyway'), 1000);
  uma.button('Trade anyway').click();
  await until(() => uma.MTG.trade.iConfirmed(uma.MTG.trade.current()), 1000, 'Trade anyway does');
  await until(() => uma.button('Change my mind', '.trade-modal'), 1000, 'and the button offers to take it back');
  uma.button('Change my mind', '.trade-modal').click();
  await until(() => !uma.MTG.trade.iConfirmed(uma.MTG.trade.current()), 1000, 'Change my mind unconfirms');
  // the window put away by its cross: the trade carries on, and Vic confirming brings a note
  uma.doc.querySelectorAll('.trade-modal .modal-x').pop().click();
  check(!uma.doc.querySelector('.trade-modal') && uma.MTG.trade.current() && uma.MTG.trade.current().state === 'open', 'putting the window away leaves the trade open');
  await until(() => !vic.MTG.trade.theyConfirmed(vic.MTG.trade.current()) && vic.button('Confirm trade', '.trade-modal') &&
    !vic.button('Confirm trade', '.trade-modal').disabled, 1000, 'Vic sees Uma took her confirmation back');
  vic.button('Confirm trade', '.trade-modal').click();
  await until(() => /Vic confirmed your trade/.test((uma.doc.querySelector('#social-notes') || { textContent: '' }).textContent), 2000, 'Uma gets a note that Vic confirmed');
  uma.button('Open', '#social-notes').click();
  await until(() => uma.doc.querySelector('.trade-modal') && /Vic confirmed this deal/.test(uma.doc.querySelector('.tr-status').textContent), 1000, 'and Open brings the trade back');
  vic.button('Cancel trade', '.trade-modal').click();
  await until(() => /Vic closed the trade/.test(uma.doc.querySelector('.tr-status').textContent), 2000, 'Uma sees Vic closed it');
  check(uma.count('Lightning Bolt') === 2 && !uma.MTG.trade.pending().length, 'nothing moved, and nothing is owed');
  uma.button('Close', '.trade-modal').click();

  // Remove and Block are behind the row's More button, and stay open while the list is drawn again
  uma.doc.querySelector('.fr-section.friends .fr-row .icon-only').click();
  check(!!uma.doc.querySelector('.fr-more'), 'More shows Remove and Block');
  uma.MTG.friends.emit('change');
  await sleep(80);
  check(!!uma.doc.querySelector('.fr-more'), 'and they are still there after the list is drawn again');
  uma.doc.querySelector('.fr-section.friends .fr-row .icon-only').click();
  check(!uma.doc.querySelector('.fr-more'), 'More again puts them away');

  // the other tabs
  uma.button('Trades', '.friends-modal').click();
  check(/Traded with Vic/.test(uma.doc.querySelector('.th-list').textContent), 'the Trades tab lists it');
  uma.button('Wishlist', '.friends-modal').click();
  check(/Nothing on your wishlist/.test(uma.doc.querySelector('.wl-list').textContent), 'the Wishlist tab starts empty');
  const want = uma.MTG.ui.wishButton({ name: 'Black Lotus', id: uuid('Black Lotus'), rarity: 'rare', set: 'lea' });
  uma.doc.body.appendChild(want);
  want.click();
  check(want.textContent === 'Wanted' && want.getAttribute('aria-pressed') === 'true', 'Want becomes Wanted');
  await until(() => /Black Lotus/.test(uma.doc.querySelector('.wl-list').textContent), 1000, 'and the wishlist shows it');
  check(uma.MTG.ui.wishButton({ name: 'Island', type_line: 'Basic Land' }) === null && uma.MTG.ui.wishButton({ name: 'Goblin', layout: 'token' }) === null, 'no Want on a basic land or a token');
  uma.button('Remove', '.wl-list').click();
  await until(() => /Nothing on your wishlist/.test(uma.doc.querySelector('.wl-list').textContent), 1000, 'Remove takes it off');
  uma.button('Friends', '.friends-modal .fr-tabs').click();
  check(!/\bnull\b|\bundefined\b|NaN|\[object/.test(words(uma)), 'nor in the Friends window after its tabs');

  // an invite from a lobby, joined from the note (Vic has no name yet: he is asked for one)
  const row = uma.MTG.ui.lobbyInvites({ fmt: 'Commander', onOpened: () => {} });
  uma.doc.body.appendChild(row);
  check(/1 online/.test(row.textContent), 'the lobby shows a friend online');
  uma.button('Invite friends', row).click();
  await until(() => uma.doc.querySelector('.invite-modal'), 2000, 'a room opens and the invite window with it');
  const room = uma.MTG.net.roomCode;
  check(/^[A-HJ-NP-Z2-9]{5}$/.test(room || ''), 'with a room code');
  uma.button('Invite', '.invite-modal').click();
  await until(() => vic.button('Join', '.social-note'), 2000, 'Vic gets the invite');
  check(new RegExp('room ' + room).test(vic.doc.querySelector('.social-note').textContent), 'naming the room');
  vic.button('Join', '.social-note').click();
  await until(() => vic.doc.querySelector('.prompt-input'), 1000, 'Vic, with no name yet, is asked for one');
  vic.doc.querySelector('.prompt-input').value = 'Victor';
  vic.button('OK').click();
  await until(() => vic.app.joined.length, 1000, 'and then joins');
  check(vic.app.joined[0] === room && vic.MTG.settings.playerName === 'Victor', 'the right room, under his new name');
  uma.button('Copy invite link', row).click();
  await until(() => uma.doc.copied.length, 1000);
  check(uma.doc.copied.pop() === 'https://example.com/play/?room=' + room, 'the invite link is the room on this page');
  uma.MTG.net.destroy();
  // with no room open yet, the tap opens one, and the link waits in a window to be copied with a tap of its own
  uma.button('Copy invite link', row).click();
  await until(() => uma.button('Copy link'), 2000, 'a room opens and its link is shown');
  const room3 = uma.MTG.net.roomCode;
  check(uma.top().querySelector('.link-box').value === 'https://example.com/play/?room=' + room3, 'the link to that room');
  uma.button('Copy link').click();
  await until(() => uma.doc.copied.length, 1000);
  check(uma.doc.copied.pop() === 'https://example.com/play/?room=' + room3, 'and Copy link copies it');
  uma.MTG.net.destroy();

  // moving a save, from Options
  const sendRow = uma.MTG.ui.moveSaveRow(), recvRow = vic.MTG.ui.moveSaveRow();
  uma.doc.body.appendChild(sendRow); vic.doc.body.appendChild(recvRow);
  uma.button('Send…', sendRow).click();
  await until(() => /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test((uma.doc.querySelector('.move-code') || {}).textContent || ''), 2000, 'the sender shows a code');
  vic.button('Receive…', recvRow).click();
  vic.doc.querySelector('.move-input').value = 'nonsense';
  vic.button('Connect', '.move-modal').click();
  check(vic.doc.querySelector('.move-say').classList.contains('bad'), 'a code that cannot be one is explained');
  vic.doc.querySelector('.move-input').value = uma.doc.querySelector('.move-code').textContent.toLowerCase();
  vic.button('Connect', '.move-modal').click();
  await until(() => vic.app.loaded, 3000, 'the save arrives and is offered to load');
  check(vic.app.loaded.data['mtgtable.settings.v1'] === uma.store.get('mtgtable.settings.v1'), 'Uma’s save, as it is');
  await until(() => /Done/.test(uma.doc.querySelector('.move-say').textContent), 2000, 'the sender is told it was taken');
  check(uma.MTG.friends.status === 'off', 'and stops answering for the friend code it gave away');

  // a friend link opens the app ready to ask
  const wen = uiDevice('Wen', ub, { search: '?friend=' + FC.formatCode(vic.MTG.friends.code) });
  wen.MTG.bus.emit('app:ready');
  await until(() => wen.button('Ask'), 2000, 'a friend link asks whether to send a request');
  check(wen.ctx.location.search === '', 'and is taken out of the address');
  wen.button('Ask').click();
  await until(() => wen.MTG.friends.entries().some(e => e.code === vic.MTG.friends.code && e.state === 'out'), 1000, 'Ask sends it');
  await until(() => vic.MTG.friends.counts().requests === 1, 2000, 'and it reaches Vic');
  const room2 = uiDevice('Xan', ub, { search: '?room=abcde' });
  room2.MTG.bus.emit('app:ready');
  await until(() => room2.app.joined.length, 2000, 'an invite link joins the room it names');
  check(room2.app.joined[0] === 'ABCDE', 'that room');

  for (const d of [uma, vic, wen, room2]) { d.MTG.friends.stop(); d.timers.forEach(clearInterval); }
  console.log(`social: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); console.log(`social: ${passes} passed, ${fails + 1} failed`); process.exit(1); });
