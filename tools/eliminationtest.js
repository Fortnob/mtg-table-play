/* A player out of a game of three or more, headless: the engine putting
   them out (their permanents leave with them, CR 800.4a), and the table
   no longer letting anybody bring their board forward, by any of the
   ways there are: by choice, the nameplate, the seat number, going round
   the table, side by side.

   A real game and a real table (src/12-ui-table.js) on a pretend DOM
   (tools/fakedom.js). Cards come from the bulk file in tools/, so
   nothing here needs the network.

     node tools/eliminationtest.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const nodeCrypto = require('crypto');
const { Document, makeEvent } = require('./fakedom');

const SRC = path.join(__dirname, '..', 'src');
const MODULES = [
  '00-core.js', '01-audio.js', '02-scryfall.js', '02a-carddb.js', '18-scripts.js', '19-cardlib.js', '03-oracle.js',
  '04-formats.js', '05-decklist.js', '06-rules.js', '06a-choice.js', '06b-events.js', '08-bots.js', '09b-sync.js',
  '10-ui-core.js', '12-ui-table.js', '12b-ui-table-fx.js', '12c-ui-table-ask.js', '12g-ui-table-access.js',
];

let pass = 0, fail = 0;
function check(ok, what, detail) {
  if (ok) pass++;
  else { fail++; console.log('FAIL ' + what + (detail != null ? ': ' + detail : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- the page ---------------- */
const doc = new Document();
const store = new Map();
const ctx = {
  console: { log: console.log, error: () => {}, warn: () => {}, info: () => {} },
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance, TextEncoder, TextDecoder, URL, URLSearchParams,
  crypto: nodeCrypto.webcrypto, document: doc, navigator: { maxTouchPoints: 0 }, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), key: (i) => Array.from(store.keys())[i], get length() { return store.size; },
  },
  location: { search: '', href: 'http://localhost/', pathname: '/' },
  CSS: { escape: (s) => String(s) },
  requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
  addEventListener() {}, removeEventListener() {},
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
const MTG = ctx.MTG;
const UI = MTG.ui;
MTG.sfx = () => {};
Object.assign(MTG.settings, { botSpeed: 0, animSpeed: 0.01, reduceMotion: true, animateDraws: false, splitOpponents: false });
UI.toast = () => {};
UI.ok = UI.toast;
UI.error = UI.toast;
UI.contextMenu = () => {};

/* ---------------- the cards ---------------- */
const NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Grizzly Bears', 'Derevi, Empyrial Tactician'];
const byName = new Map();
for (const line of zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (!NAMES.includes(c.name) || byName.has(c.name) || c.layout === 'token' || c.layout === 'art_series') continue;
  byName.set(c.name, MTG.scry.slim(c));
}
for (const n of NAMES) if (!byName.has(n)) { console.log('FAIL no card named ' + n + ' in the bulk file'); process.exit(1); }
const card = (n) => byName.get(n);

/* ---------------- a game ----------------
   `ids` seats in turn order; the first has a commander (Derevi). */
function game(ids) {
  const g = new MTG.rules.Game({ formatId: 'commander', startingLife: 40, startingHand: 0, maxPlayers: ids.length, seed: 11, firstPlayerDraws: false });
  for (const id of ids) g.addPlayer({ id, name: id[0].toUpperCase() + id.slice(1) });
  const filler = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(n => ({ card: card(n), qty: 4 }));
  ids.forEach((id, i) => g.loadDeck(id, i === 0 ? { main: filler, commanders: [card('Derevi, Empyrial Tactician')] } : { main: filler }));
  g.start();
  g.turnOrder = ids.slice();
  for (const id of ids) g.keepHand(id, []);
  g.put = (pid, name) => {
    const o = g._register(new MTG.rules.GObj(card(name), pid, 'battlefield'));
    o.controller = pid; o.entered = g.turn - 1; o.summoningSick = false; o.ts = g._stampNew(); g.battlefield.push(o);
    g.touch();
    return o;
  };
  return g;
}

/**
 * A table for one seat. `wire` sends every view through the guest's
 * encoder and decoder, as JSON, the way a guest receives it; otherwise it
 * is the host's own table, given its views with their events directly.
 */
function seat(g, me, wire) {
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const t = new UI.Table(root, me, () => {});
  t.paceScale = 0.001;
  let since = null;
  const enc = wire ? new MTG.sync.Encoder() : null, dec = wire ? new MTG.sync.Decoder() : null;
  const push = () => {
    if (t._destroyed) return;
    const v = g.viewFor(me);
    v.game = 'test';
    v.events = g.eventsFor(me, since == null ? g.eventSeq : since);
    v.eventSeq = since = g.eventSeq;
    if (!wire) { t.update(v); return; }
    const r = dec.decode(JSON.parse(JSON.stringify(enc.encode(v))));
    if (r.ack) enc.ack(r.ack);
    if (r.view) t.update(r.view);
  };
  g.on('state', push);
  push();
  const w = { t, root };
  w.settle = async () => {
    for (let i = 0; i < 400; i++) {
      await sleep(5);
      if (!t.queue.length && t.view === t.live && !t._pumping) { await sleep(20); if (!t.queue.length && t.view === t.live) return; }
    }
  };
  w.plate = (pid) => (t._plates || new Map()).get(pid);
  w.shown = () => Array.from(t.seats.keys()).filter(id => { const s = t.seats.get(id); return s.root.isConnected && id !== me; });
  w.stop = () => { if (!t._destroyed) t.destroy(); root.remove(); };
  return w;
}

async function main() {
  /* ================= four players: one out by commander damage ================= */
  {
    const g = game(['me', 'amy', 'bo', 'cy']);
    const derevi = g.zones.me.command.find(o => o.isCommander);
    const bears = g.put('bo', 'Grizzly Bears');
    g.put('bo', 'Forest');
    g.put('amy', 'Plains');
    const host = seat(g, 'me', false);     // the host, at its own table
    await host.settle();

    // the host is looking at Bo's board, by choice
    host.t.setFocus('bo', true);
    await host.settle();
    check(host.t.focusSeat === 'bo', 'Bo’s board can be brought forward while Bo is playing');

    // 21 from Derevi, and the state-based actions put Bo out
    g.player('bo').commanderDamage[derevi.id] = 21;
    g.checkStateBasedActions();
    g.touch();
    const bo = g.player('bo');
    check(bo.hasLost && bo.lossReason === 'commander', 'Bo is out by commander damage', bo.lossReason);
    check(!g.battlefield.some(o => o.owner === 'bo') && bears.zone !== 'battlefield', 'Bo’s permanents left the game with Bo (CR 800.4a)', bears.zone);
    check(!g.over, 'the game goes on with three');
    await host.settle();

    // the board that was being looked at goes back to the table's own choice
    check(host.t.focusSeat !== 'bo', 'the host no longer looks at Bo’s board', host.t.focusSeat);
    check(!host.shown().includes('bo'), 'Bo’s board is not on the table', JSON.stringify(host.shown()));
    // and cannot be brought back, by any of the ways there are
    host.t.setFocus('bo', true); await host.settle();
    check(host.t.focusSeat !== 'bo', 'setFocus will not bring a defeated board forward');
    const plate = host.plate('bo');
    check(!!plate && plate.classList.contains('dead') && plate.getAttribute('aria-disabled') === 'true', 'Bo’s nameplate is marked defeated and not choosable');
    check(!!plate && plate._sub.textContent === 'Out', 'and says they are out', plate && plate._sub.textContent);
    if (plate) plate.dispatchEvent(makeEvent('click'));
    await host.settle();
    check(host.t.focusSeat !== 'bo', 'a click on the nameplate does not bring it forward');
    const order = g.turnOrder;
    host.t.focusSeatNumber(order.indexOf('bo') + 1); await host.settle();
    check(host.t.focusSeat !== 'bo', 'nor does its seat number');
    const seen = new Set();
    for (let i = 0; i < 4; i++) { host.t.cycleFocus(1); await host.settle(); seen.add(host.t.focusSeat); }
    check(!seen.has('bo') && seen.has('amy') && seen.has('cy'), 'going round the table passes Bo over', JSON.stringify([...seen]));
    check(host.t.canLookAt('amy') && !host.t.canLookAt('bo'), 'canLookAt: the living, not the defeated');

    // side by side, too, only those still playing
    MTG.settings.splitOpponents = true;
    host.t.render(); await host.settle();
    check(!host.shown().includes('bo') && host.shown().includes('amy') && host.shown().includes('cy'), 'side by side: Bo’s board is not among them', JSON.stringify(host.shown()));
    MTG.settings.splitOpponents = false;

    host.stop();
  }

  console.log(`eliminationtest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
