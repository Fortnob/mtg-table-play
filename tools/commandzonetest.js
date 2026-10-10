/* The command zone on a real table, headless: what the table offers from
   there and what happens when it is chosen. Yuriko's commander ninjutsu in
   the declare blockers step, Derevi's ability that works from the command
   zone, and a companion put into its owner's hand for {3}.

   A real game and a real table (src/12-ui-table.js) on a pretend DOM
   (tools/fakedom.js), two seats driven by hand, the way a person would
   click. Cards come from the bulk file in tools/, so nothing here needs the
   network.

     node tools/commandzonetest.js */
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
  '04-formats.js', '05-decklist.js', '06-rules.js', '06a-choice.js', '06b-events.js', '08-bots.js',
  '10-ui-core.js', '12-ui-table.js', '12b-ui-table-fx.js', '12c-ui-table-ask.js',
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
Object.assign(MTG.settings, { botSpeed: 0, animSpeed: 0.01, reduceMotion: true, animateDraws: false, autoTapLands: true });
const toasts = [];
UI.toast = (m) => { toasts.push(String(m)); };
UI.ok = UI.toast;
UI.error = (m) => { toasts.push('error: ' + m); };
let menus = [];
UI.contextMenu = (ev, items, opts) => { menus.push({ ev, items, title: opts && opts.title }); };

/* ---------------- the cards ---------------- */
const NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Grizzly Bears', "Yuriko, the Tiger's Shadow",
  'Derevi, Empyrial Tactician', 'Lurrus of the Dream-Den', 'Ayli, Eternal Pilgrim', 'Savannah Lions', 'Hill Giant', 'Wall of Omens'];
const byName = new Map();
for (const line of zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (!NAMES.includes(c.name) || byName.has(c.name) || c.layout === 'token' || c.layout === 'art_series') continue;
  byName.set(c.name, MTG.scry.slim(c));
}
for (const n of NAMES) if (!byName.has(n)) { console.log('FAIL no card named ' + n + ' in the bulk file'); process.exit(1); }
const card = (n) => byName.get(n);

/* ---------------- a game at a table ----------------
   Two seats, both played from here. Every intent the table sends goes to
   the engine the way src/14-app.js hands it over. */
function table(deck) {
  const g = new MTG.rules.Game({ formatId: 'commander', startingLife: 40, startingHand: 0, maxPlayers: 2, seed: 7, firstPlayerDraws: false });
  g.addPlayer({ id: 'me', name: 'You' });
  g.addPlayer({ id: 'opp', name: 'Them' });
  const filler = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(n => ({ card: card(n), qty: 4 }));
  g.loadDeck('me', Object.assign({ main: filler }, deck));
  g.loadDeck('opp', { main: filler });
  g.start();
  g.turnOrder = ['me', 'opp'];
  g.keepHand('me', []); g.keepHand('opp', []);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const sent = [];
  const t = new UI.Table(root, 'me', (intent) => {
    sent.push(intent);
    const auto = !(intent.fromPool === true && !intent.free);
    switch (intent.kind) {
      case 'pass': g.passPriority('me'); break;
      case 'cast': g.castSpell('me', intent.objId, { targets: intent.targets || [], auto, fromPool: !auto, via: intent.via || null,
        returnId: typeof intent.returnId === 'string' ? intent.returnId : undefined, x: intent.x || 0 }); break;
      case 'activate': g.activateAbility('me', intent.objId, intent.index, { targets: intent.targets || [], auto, fromPool: !auto }); break;
      case 'companion': g.companionToHand('me', intent.objId, { auto: true }); break;
      case 'mana': g.tapForMana('me', intent.objId, intent.index || 0, intent.choice); break;
      case 'choice': g.resolveChoice('me', intent.data || {}); break;
      default: break;
    }
  });
  t.paceScale = 0.001;
  const push = () => { if (!t._destroyed) t.update(g.viewFor('me')); };
  g.on('state', push);
  push();
  const w = { g, t, sent };
  w.settle = async () => {
    for (let i = 0; i < 400; i++) {
      await sleep(5);
      if (!t.queue.length && t.view === t.live && !t._pumping) { await sleep(20); if (!t.queue.length && t.view === t.live) return; }
    }
  };
  w.put = (pid, name, zone, extra) => {
    const o = g._register(new MTG.rules.GObj(card(name), pid, zone));
    if (zone === 'battlefield') { o.controller = pid; o.entered = g.turn - 1; o.summoningSick = false; o.ts = g._stampNew(); g.battlefield.push(o); }
    else g.zones[pid][zone].push(o);
    Object.assign(o, extra || {});
    g.touch();
    return o;
  };
  /* on to a step of a player's turn, passing for both seats; attackers and
     blockers as given when the game asks */
  w.toStep = (pid, step, attackers, blockers) => {
    for (let guard = 0; guard < 400; guard++) {
      const ch = g.pendingChoice;
      if (ch && ch.type === 'declareAttackers') { g.declareAttackers(ch.playerId, ch.playerId === pid ? (attackers || []) : []); continue; }
      if (ch && ch.type === 'declareBlockers') { g.declareBlockers(ch.playerId, blockers || []); continue; }
      if (ch) { g.resolveChoice(ch.playerId, {}); continue; }
      if (g.activePlayer.id === pid && g.step === step && !g.stack.length && g.priorityPlayer && g.priorityPlayer.id === pid &&
          (step !== 'main' || g.phase.id === 'precombat')) return true;
      if (!g.priorityPlayer) return false;
      g.passPriority(g.priorityPlayer.id, true);
    }
    return false;
  };
  /** everything on the stack resolved, both seats passing */
  w.resolve = () => { for (let guard = 0; guard < 50 && g.stack.length; guard++) g.passPriority(g.priorityPlayer.id, true); };
  /** a click on a card on the table */
  w.click = async (o) => { menus = []; t.onCardClick(o.id, makeEvent('click'), t.els.get(o.id)); await w.settle(); };
  w.stop = () => { if (!t._destroyed) t.destroy(); root.remove(); };
  return w;
}
const menuItem = (label) => { for (const m of menus) for (const it of m.items) if (Array.isArray(it) && (label instanceof RegExp ? label.test(it[0]) : it[0] === label)) return it; return null; };
const labels = () => menus.flatMap(m => m.items.filter(Array.isArray).map(it => it[0]));

async function main() {
  /* ================= Yuriko: commander ninjutsu from the command zone ================= */
  {
    const w = table({ commanders: [card("Yuriko, the Tiger's Shadow")] });
    const { g } = w;
    const y = g.zones.me.command.find(o => o.isCommander);
    const bears = w.put('me', 'Grizzly Bears', 'battlefield');
    w.put('me', 'Island', 'battlefield'); w.put('me', 'Swamp', 'battlefield');
    check(w.toStep('me', 'declareBlockers', [{ attackerId: bears.id, defenderId: 'opp' }], []), 'on to the declare blockers step, the Bears unblocked');
    check(bears.attacking === 'opp' && !(bears.blockedBy || []).length, 'the Bears attack and nobody blocks them');
    await w.settle();
    check(!!w.t.els.get(y.id), 'Yuriko is shown in the command zone');
    await w.click(y);
    check(!!menuItem('Commander ninjutsu {U}{B}'), 'clicking Yuriko offers commander ninjutsu', JSON.stringify(labels()));
    const it = menuItem('Commander ninjutsu {U}{B}');
    if (it) { it[1](); await w.settle(); }
    const casts = w.sent.filter(i => i.kind === 'cast' && i.objId === y.id);
    check(casts.length === 1 && casts[0].via === 'ninjutsu', 'the table sends a cast by ninjutsu', JSON.stringify(casts));
    w.resolve(); await w.settle();
    check(y.zone === 'battlefield' && y.tapped && y.attacking === 'opp', 'Yuriko is on the battlefield, tapped and attacking', `${y.zone} ${y.attacking}`);
    check(bears.zone === 'hand', 'the Bears went back to hand', bears.zone);
    check(!((g.player('me').commanderCasts || {})[y.id]), 'not cast from the command zone: no commander tax');
    w.stop();
  }

  /* ================= Derevi: an ability that works from the command zone ================= */
  {
    const w = table({ commanders: [card('Derevi, Empyrial Tactician')] });
    const { g } = w;
    const d = g.zones.me.command.find(o => o.isCommander);
    for (const n of ['Forest', 'Plains', 'Island', 'Mountain']) w.put('me', n, 'battlefield');
    check(w.toStep('me', 'main'), 'on to the main phase');
    await w.settle();
    await w.click(d);
    const ab = menuItem(/^\{1\}\{G\}\{W\}\{U\}: Put Derevi/);
    check(!!menuItem('Cast it') && !!ab, 'clicking Derevi offers the cast and its ability from the command zone', JSON.stringify(labels()));
    if (ab) { ab[1](); await w.settle(); }
    const acts = w.sent.filter(i => i.kind === 'activate' && i.objId === d.id);
    check(acts.length === 1, 'the table sends the activation', JSON.stringify(w.sent.slice(-3)));
    w.resolve(); await w.settle();
    check(d.zone === 'battlefield', 'Derevi comes onto the battlefield', d.zone);
    check(g.battlefield.filter(o => o.controller === 'me' && /Land/.test(o.card.type_line) && o.tapped).length === 4, 'paid with four lands');
    check(!((g.player('me').commanderCasts || {})[d.id]), 'not cast: no commander tax for next time');
    // and from the battlefield the ability is not there to use
    const a = d.analysis();
    const all = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
    check(!g.activateAbility('me', d.id, all.findIndex(x => x.fromCommandZone), { auto: true }), 'the ability does not work from the battlefield');
    w.stop();
  }

  /* ================= a companion: {3} into your hand, once a game ================= */
  {
    const w = table({ commanders: [card('Ayli, Eternal Pilgrim')], companion: card('Lurrus of the Dream-Den') });
    const { g } = w;
    const lur = g.zones.me.command.find(o => o.companion);
    check(!!lur && !lur.isCommander, 'the companion waits beside the command zone, not as a commander');
    check(!g.castSpell('me', lur.id, { auto: true }), 'it cannot be cast from there');
    for (const n of ['Plains', 'Swamp', 'Island', 'Forest', 'Plains']) w.put('me', n, 'battlefield');
    check(w.toStep('me', 'main'), 'on to the main phase');
    await w.settle();
    check(!!w.t.els.get(lur.id), 'the companion is shown with the command zone');
    menus = [];
    w.t.cardMenu(lur.id, makeEvent('contextmenu'));
    check(!!menuItem('Put it into your hand ({3})'), "its menu offers to put it into your hand for {3}", JSON.stringify(labels()));
    await w.click(lur);
    check(w.sent.some(i => i.kind === 'companion' && i.objId === lur.id), 'clicking it sends the companion action');
    check(lur.zone === 'hand' && g.player('me').companionUsed, 'Lurrus is in hand, the once a game used', lur.zone);
    check(g.battlefield.filter(o => o.controller === 'me' && o.tapped).length === 3, 'three lands paid for it');
    const pool = g.player('me').pool; pool.add('W'); pool.add('B'); pool.add('C');
    check(g.castSpell('me', lur.id, { auto: true }), 'then it is cast from hand like any card', g.lastError);
    w.resolve();
    check(lur.zone === 'battlefield', 'Lurrus resolves', lur.zone);
    w.stop();
  }

  console.log(`commandzonetest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
