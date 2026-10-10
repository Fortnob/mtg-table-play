/* The tutorials on the table, played through headless: the first-game
   walkthrough (src/12e-ui-coach.js) and its lands tapped by hand
   (src/12c-ui-table-ask.js), the Tutorials tile and the offers that hide
   with it, and what a tutorial's result screen offers (src/14b-lessons.js).

   A real game and a real table, on a pretend DOM (tools/fakedom.js), with
   a gentle bot across from a stand-in for the player who clicks what a
   person would click: a land to tap, a creature to cast. Cards come from
   the bulk file in tools/, so nothing here needs the network.

     node tools/tutorialtest.js */
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
  '10-ui-core.js', '12-ui-table.js', '12b-ui-table-fx.js', '12c-ui-table-ask.js', '12e-ui-coach.js', '14b-lessons.js',
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
const nav = { maxTouchPoints: 0 };
const ctx = {
  console: { log: console.log, error: () => {}, warn: () => {}, info: () => {} },
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance, TextEncoder, TextDecoder, URL, URLSearchParams,
  crypto: nodeCrypto.webcrypto, document: doc, navigator: nav, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
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
Object.assign(MTG.settings, { botSpeed: 0, animSpeed: 0.01, reduceMotion: true, animateDraws: false });
const toasts = [];
UI.toast = (m) => { toasts.push(String(m)); };
UI.ok = UI.toast;
UI.error = (m) => { toasts.push('error: ' + m); };
let menus = [];
UI.contextMenu = (ev, items, opts) => { menus.push({ ev, items, title: opts && opts.title }); };
MTG.progress = { state: { lessons: {} }, mail() {}, save() {} };

/* ---------------- the cards ---------------- */
const NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Savannah Lions', 'Grizzly Bears', 'Shock'];
const byName = new Map();
for (const line of zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8').split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (!NAMES.includes(c.name) || byName.has(c.name) || c.layout === 'token' || c.layout === 'art_series') continue;
  byName.set(c.name, MTG.scry.slim(c));
}
for (const n of NAMES) if (!byName.has(n)) { console.log('FAIL no card named ' + n + ' in the bulk file'); process.exit(1); }

/* ---------------- a game at a table ----------------
   The app's part, as src/14-app.js plays it: every change to the game a
   view for the table, every intent handed to the engine (a cast paid from
   the pool when the table says so), and the bot nudged after each. */
function table(board, opts) {
  opts = opts || {};
  const L = MTG.lessons;
  const g = new MTG.rules.Game({ formatId: 'standard', startingLife: 20, startingHand: 7, maxPlayers: 2, seed: 7, firstPlayerDraws: false });
  g.addPlayer({ id: 'me', name: 'You' });
  g.addPlayer({ id: 'bot', name: 'Gentle bot', isBot: true, botDifficulty: 1 });
  g.loadDeck('me', L.filler(byName));
  g.loadDeck('bot', L.filler(byName));
  const runner = new MTG.bots.BotRunner(g);
  runner.add('bot', { difficulty: 1 });
  g.start();
  const ids = L.build(g, Object.assign({ start: 'mine', theirs: { battlefield: [], hand: [] } }, board), byName, 'me', 'bot');
  g.setAutoPass('me', { enabled: true, smart: true, untilStackChange: true, stops: MTG.DEFAULT_STOPS, fullControl: false });
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const sent = [];
  const t = new UI.Table(root, 'me', (intent) => {
    sent.push(intent);
    const auto = !(intent.fromPool === true && !intent.free);
    switch (intent.kind) {
      case 'pass': g.passPriority('me'); break;
      case 'yield': g.setYield('me', intent.mode || null); break;
      case 'playLand': g.playLand('me', intent.objId, 0); break;
      case 'cast': g.castSpell('me', intent.objId, { targets: intent.targets || [], auto, fromPool: !auto, x: intent.x || 0 }); break;
      case 'activate': g.activateAbility('me', intent.objId, intent.index, { targets: intent.targets || [], auto, fromPool: !auto }); break;
      case 'mana': g.tapForMana('me', intent.objId, intent.index || 0, intent.choice); break;
      case 'declareAttackers': g.declareAttackers('me', intent.declarations || []); break;
      case 'declareBlockers': g.declareBlockers('me', intent.declarations || []); break;
      case 'choice': g.resolveChoice('me', intent.data || {}); break;
      default: break;
    }
    runner.kick();
  });
  t.paceScale = 0.001;
  const push = () => { if (!t._destroyed) t.update(g.viewFor('me')); };
  g.on('state', push);
  push();
  const w = { g, t, ids, sent, runner, obj: (tag) => g.obj(ids[tag]), el: (tag) => t.els.get(ids[tag]) };
  w.settle = async (ms) => {
    for (let i = 0; i < 400; i++) {
      await sleep(5);
      if (!t.queue.length && t.view === t.live && !t._pumping && !runner._running && !runner._queued && !(runner.busy && runner.busy())) {
        await sleep(ms || 20);
        if (!t.queue.length && t.view === t.live && !t._pumping) return;
      }
    }
  };
  w.click = async (tag) => { t.onCardClick(ids[tag], makeEvent('click'), t.els.get(ids[tag])); await w.settle(); };
  w.pool = () => { const p = g.player('me').pool; return ['W', 'U', 'B', 'R', 'G', 'C'].reduce((n, c) => n + p[c], 0); };
  w.stop = () => { runner.stop(); if (!t._destroyed) t.destroy(); root.remove(); };
  return w;
}

const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
/** Close every note up until the one wanted, as a reader pressing Got it would (a new turn's banner is let go by first). */
async function upTo(w, coach, id) {
  for (let i = 0; i < 300; i++) {
    coach.tick();
    if (coach.current && coach.current.mark.id === id) return true;
    if (coach.current) coach.close('ok');
    await sleep(10);
  }
  return false;
}

async function main() {
  /* ================= the first game: lands by hand, then by the game ================= */
  for (const own of [true, false]) {
    MTG.settings.autoTapLands = own;
    MTG.settings.tutorialDone = false;
    const w = table({ mine: { battlefield: ['Plains#p0'], hand: ['Plains#p1', 'Savannah Lions#l1', 'Savannah Lions#l2', 'Savannah Lions#l3'] } });
    const { t, g } = w;
    await w.settle();
    const coach = new UI.Coach(t);
    const say = `(own setting ${own ? 'on' : 'off'})`;
    check(t.tapOverride === false && !t.autoTap(), `the first game starts with lands tapped by hand ${say}`);
    check(MTG.settings.autoTapLands === own, `starting it does not touch the setting ${say}`);
    check(coach.marks.some(m => m.id === 'tap') && coach.marks.some(m => m.id === 'auto'), 'the first game has the marks about tapping by hand');

    // a land first
    coach.tick();
    check(coach.current && coach.current.mark.id === 'land', 'the first note: play a land', coach.current && coach.current.mark.id);
    await w.click('p1');
    check(w.obj('p1').zone === 'battlefield', 'clicking the land plays it');

    // tapping, explained at the moment it matters
    check(await upTo(w, coach, 'tap'), 'then: tap a land for mana', coach.current && coach.current.mark.id);
    const tapNote = text(coach.bubble.querySelector('.coach-text'));
    check(/Click your Plains to tap it for W/.test(tapNote) && /turns sideways/.test(tapNote) && /until your next turn/.test(tapNote),
      'the note says what tapping is and what the land makes', tapNote);
    check(coach.bubble.querySelector('.coach-text')._html.includes('pip'), 'its mana is drawn as a symbol');

    // a spell clicked before any land is tapped waits for its mana
    await w.click('l1');
    check(!!t.paying && t.paying.objId === w.ids.l1, 'a creature clicked with no mana waits for it');
    check(w.obj('l1').zone === 'hand' && !g.stack.length, 'and nothing is cast yet');
    check(/Savannah Lions: tap lands to pay/.test(text(t.banner)), 'the banner says what to do', text(t.banner));
    check(text(t.dock._main).startsWith('Pay for me'), 'the big button offers to pay', text(t.dock._main));
    check(w.el('p0').classList.contains('pay-source') && w.el('p1').classList.contains('pay-source'), 'the lands that could pay glow');
    check(w.el('l1').classList.contains('paying'), 'the creature waiting is marked');
    check(!w.el('l2').classList.contains('playable'), 'other cards do not glow while it waits');
    check(coach.current && coach.current.mark.id === 'tap', 'the tapping note stays up while the creature waits', coach.current && coach.current.mark.id);

    // tap one land: the creature is cast from the pool, and no other land is touched
    const before = w.sent.length;
    await w.click('p0');
    await w.settle();
    const casts = w.sent.slice(before).filter(i => i.kind === 'cast');
    check(w.sent.slice(before).some(i => i.kind === 'mana'), 'clicking the land taps it for mana');
    check(casts.length === 1 && casts[0].fromPool === true, 'then the creature is cast, paid from the pool', JSON.stringify(casts));
    check(w.obj('p0').tapped && !w.obj('p1').tapped, 'only the land you tapped is tapped');
    check(w.obj('l1').zone === 'battlefield' || w.obj('l1').zone === 'stack', 'the creature is cast', w.obj('l1').zone);
    check(!t.paying, 'and nothing waits any more');

    // mana first, then the spell: it goes at once
    await w.click('p1');
    check(w.pool() === 1, 'a land tapped with nothing waiting puts its mana in the pool', w.pool());
    coach.tick();
    check(!!coach.current && ['pool', 'sick'].includes(coach.current.mark.id), 'a note about the pool (or the new creature) comes up', coach.current && coach.current.mark.id);
    const b2 = w.sent.length;
    await w.click('l2');
    await w.settle();
    const c2 = w.sent.slice(b2).filter(i => i.kind === 'cast');
    check(c2.length === 1 && c2[0].fromPool === true && !t.paying, 'with the mana in the pool, the creature is cast straight away', JSON.stringify(c2));
    check(w.obj('l2').zone !== 'hand', 'the second creature is cast');
    await w.settle();
    check(coach.casts.size === 2, 'two spells counted as paid by hand', coach.casts.size);

    // and now the game taps lands for you, for this game only
    check(await upTo(w, coach, 'auto'), 'after two spells: the game will tap lands for you', coach.current && coach.current.mark.id);
    await w.settle();
    check(t.tapOverride === true && t.autoTap(), 'tapping for you is on, for this game');
    check(MTG.settings.autoTapLands === own, 'the setting itself is untouched ' + say);
    const autoNote = text(coach.bubble.querySelector('.coach-text'));
    check(own ? /turns this off/.test(autoNote) : /your next games go back to tapping by hand/.test(autoNote), 'the note says what happens next time', autoNote);

    // the third creature, with a land ready (a new turn has untapped them, or one is untapped here): the game taps it
    const myLands = () => g.battlefield.filter(o => o.controller === 'me' && /Land/.test(o.card.type_line));
    if (!myLands().some(o => !o.tapped)) { g.manual('me', 'tap', { objId: w.ids.p0 }); await w.settle(); }
    const untapped = myLands().filter(o => !o.tapped).length;
    check(w.pool() === 0 && untapped > 0, 'a land ready and nothing in the pool', `${untapped} untapped, pool ${w.pool()}`);
    const b3 = w.sent.length;
    await w.click('l3');
    await w.settle();
    const c3 = w.sent.slice(b3).filter(i => i.kind === 'cast');
    check(c3.length === 1 && !c3[0].fromPool && !t.paying, 'the third creature is cast with the lands tapped for you', JSON.stringify(c3));
    check(myLands().filter(o => !o.tapped).length === untapped - 1 && w.obj('l3').zone !== 'hand', 'the game tapped a land for it itself');

    // the game ends: the walkthrough is done, and your own setting is back
    g.concede('bot');
    await w.settle();
    coach.tick();
    check(coach._stopped && t.tapOverride == null, 'at the end of the game the walkthrough lets go ' + say);
    check(t.autoTap() === own && MTG.settings.autoTapLands === own, 'and tapping goes back to your own setting ' + say);
    check(MTG.settings.tutorialDone === true, 'the walkthrough is remembered as seen');
    w.stop();
  }

  /* ================= skipping it, and leaving the game ================= */
  for (const own of [true, false]) {
    MTG.settings.autoTapLands = own;
    // skipped part way, while still tapping by hand
    let w = table({ mine: { battlefield: ['Plains#p0'], hand: ['Savannah Lions#l1'] } });
    await w.settle();
    let coach = new UI.Coach(w.t);
    check(!w.t.autoTap(), 'tapping by hand before the skip');
    toasts.length = 0;
    coach.skip();
    check(w.t.tapOverride == null && w.t.autoTap() === own && MTG.settings.autoTapLands === own, `skipped, tapping is your own setting again (${own})`);
    check(own ? /taps your lands for you/.test(toasts.join(' ')) : !/taps your lands for you/.test(toasts.join(' ')), 'and the toast says so only when it changes', toasts.join(' | '));
    // a creature waiting for mana when tapping for you comes back is put back in the hand
    w.stop();

    // left part way: the table goes, and so does the walkthrough's say
    w = table({ mine: { battlefield: ['Plains#p0'], hand: ['Savannah Lions#l1'] } });
    await w.settle();
    coach = new UI.Coach(w.t);
    w.t.destroy();
    coach.tick();
    check(coach._stopped && w.t.tapOverride == null && MTG.settings.autoTapLands === own, `left part way, nothing is left changed (${own})`);
    w.stop();
  }
  MTG.settings.autoTapLands = true;

  /* ================= tapping by hand on its own: Options' Tap lands for me off ================= */
  {
    MTG.settings.autoTapLands = false;
    const w = table({ mine: { battlefield: ['Plains#p0', 'Plains#p1'], hand: ['Savannah Lions#l1', 'Grizzly Bears#g1'] } });
    const { t, g } = w;
    await w.settle();
    check(!t.autoTap(), 'with the setting off, the table taps nothing for you');
    // Cancel puts it back
    await w.click('l1');
    check(!!t.paying, 'a creature clicked waits for its mana');
    t.cancelPay();
    check(!t.paying && w.obj('l1').zone === 'hand' && !w.sent.some(i => i.kind === 'cast'), 'Cancel puts it back, nothing cast');
    // clicked again, it goes back too
    await w.click('l1');
    await w.click('l1');
    check(!t.paying, 'clicking the waiting creature again puts it back');
    // Esc as well
    await w.click('l1');
    doc.dispatchEvent(makeEvent('keydown', { key: 'Escape', target: doc.body }));
    check(!t.paying, 'Esc puts it back');
    // Pay for me: the game taps what the pool does not cover
    await w.click('l1');
    t.primaryAction();
    await w.settle();
    const c = w.sent.filter(i => i.kind === 'cast');
    check(c.length === 1 && !c[0].fromPool && w.obj('l1').zone !== 'hand', 'Pay for me lets the game tap the land', JSON.stringify(c));
    // a mana value of two with one land tapped: still waiting, then cast once there is enough... here there is not
    await w.settle();
    await w.click('g1');
    check(!t.paying && w.obj('g1').zone === 'hand', 'a card that cannot be paid for is not held waiting', JSON.stringify(t.paying));
    w.stop();
    MTG.settings.autoTapLands = true;
  }
  {
    MTG.settings.autoTapLands = false;
    const w = table({ mine: { battlefield: ['Plains#p0', 'Forest#f0', 'Forest#f1'], hand: ['Grizzly Bears#g1'] } });
    const { t } = w;
    await w.settle();
    await w.click('g1');
    check(!!t.paying && t.paying.cost === '{1}{G}', 'Grizzly Bears waits for {1}{G}', t.paying && t.paying.cost);
    await w.click('p0');
    check(!!t.paying && w.obj('g1').zone === 'hand', 'one mana is not enough: it keeps waiting');
    check(/In your pool/.test(text(t.banner)), 'and the banner shows the pool', text(t.banner));
    await w.click('f0');
    await w.settle();
    check(!t.paying && w.obj('g1').zone !== 'hand' && !w.obj('f1').tapped, 'the second land pays the rest; the third stays untapped');
    w.stop();
    MTG.settings.autoTapLands = true;
  }
  {
    MTG.settings.autoTapLands = false;
    const w = table({ mine: { battlefield: ['Plains#p0'], hand: ['Grizzly Bears#g1'] } });
    const { t } = w;
    await w.settle();
    // nothing castable here (one Plains for a green two-drop); make the waiting state by hand and move on a step
    t.paying = { intent: { kind: 'cast', objId: w.ids.g1, targets: [] }, cost: '{1}{G}', name: 'Grizzly Bears', objId: w.ids.g1, zone: 'hand',
      at: [t.live.turn, t.live.activePlayer, t.live.phase, 'draw'].join('|'), stack: 0, tried: null };
    t.render();
    check(!t.paying, 'a payment from another step is put back');
    w.stop();
    MTG.settings.autoTapLands = true;
  }

  /* ================= the result screen of a tutorial ================= */
  {
    const L = MTG.lessons;
    const labels = (mode) => {
      const w = table({ mine: { battlefield: [], hand: [] } });
      return w.settle().then(async () => {
        MTG.app = { session: { mode }, leaveGame() {}, rematch() {}, nextGame() {}, eventInfo: () => null };
        w.g.concede('bot');
        await w.settle();
        const out = Array.from(w.t.decision.querySelectorAll('button')).map(b => b.textContent.trim());
        w.stop();
        return out;
      });
    };
    const plain = await labels(null);
    check(plain.includes('Rematch') && !plain.includes('Next tutorial'), 'an ordinary game still offers a rematch', plain.join(', '));
    const first = await labels({ tutorial: 'first' });
    check(first.includes('Next tutorial') && !first.includes('Rematch'), 'the first game offers the next tutorial, not a rematch', first.join(', '));
    const mid = await labels({ lesson: 'stack' });
    check(mid.includes('Next tutorial') && mid.includes('Try again') && !mid.includes('Rematch'), 'a lesson offers the next one and another go', mid.join(', '));
    const last = await labels({ lesson: L.LESSONS[L.LESSONS.length - 1].id });
    check(!last.includes('Next tutorial') && !last.includes('Rematch') && last.includes('All tutorials'), 'the last lesson has no next one, and leads back to the list', last.join(', '));
    // where each goes
    const a = L.afterGame({ mode: { tutorial: 'first' } });
    check(a.find(b => b.label === 'Next tutorial').title === L.LESSONS[0].title, 'the first game leads on to the first lesson');
    const b = L.afterGame({ mode: { lesson: L.LESSONS[1].id } });
    check(b.find(x => x.label === 'Next tutorial').title === L.LESSONS[2].title, 'a lesson leads on to the one after it');
    check(L.afterGame({ mode: { ranked: true } }) === null && L.afterGame(null) === null, 'any other game is left alone');
    // the result of a lesson itself
    const won = L.resultButtons(L.LESSONS[0], true).map(x => x.label);
    const lost = L.resultButtons(L.LESSONS[0], false).map(x => x.label);
    const lastWon = L.resultButtons(L.LESSONS[L.LESSONS.length - 1], true).map(x => x.label);
    const lastLost = L.resultButtons(L.LESSONS[L.LESSONS.length - 1], false).map(x => x.label);
    check(won.includes('Next tutorial') && !won.includes('Try again'), 'a lesson got right: on to the next tutorial', won.join(', '));
    check(lost.includes('Try again') && lost.includes('Next tutorial'), 'a lesson got wrong: try again, or on to the next', lost.join(', '));
    check(!lastWon.includes('Next tutorial') && lastWon.includes('Done'), 'the last lesson got right: done, no next', lastWon.join(', '));
    check(!lastLost.includes('Next tutorial') && lastLost.includes('Try again'), 'the last lesson got wrong: try again, no next', lastLost.join(', '));
  }

  /* ================= hiding the Tutorials, and showing them again ================= */
  {
    const L = MTG.lessons;
    const S = MTG.settings;
    const card = (cls, title, body, meta, fn) => MTG.el('button', { type: 'button', class: 'event-card ' + cls, onclick: fn }, [MTG.el('h3', { text: title })]);
    S.showTutorials = true;
    S.tutorialDone = false; S.tutorialDismissed = false; S.lessonsDismissed = false;
    MTG.app = { startTutorial() {} };
    let redrawn = 0;
    const tile = L.playTile(card, { rerender: () => { redrawn++; } });
    check(!!tile && /Tutorials/.test(text(tile)), 'the Tutorials tile is on the Play screen');
    check(!!L.firstGameCard({}), 'the home screen offers the first game');
    menus = [];
    tile.dispatchEvent(makeEvent('contextmenu', { clientX: 10, clientY: 10 }));
    check(menus.length === 1 && menus[0].items.length === 1 && menus[0].items[0][0] === 'Hide', 'right-click: a menu with Hide', JSON.stringify(menus.map(m => m.items.map(i => i[0]))));
    // on a touch screen, a long press opens the same menu
    menus = [];
    tile.dispatchEvent(makeEvent('touchstart', { touches: [{ clientX: 10, clientY: 10 }] }));
    await sleep(480);
    tile.dispatchEvent(makeEvent('touchend', {}));
    check(menus.length === 1 && menus[0].items[0][0] === 'Hide', 'holding it on a touch screen opens the same menu');
    toasts.length = 0;
    menus[0].items[0][1]();
    check(S.showTutorials === false && redrawn === 1, 'Hide hides it, and the Play screen is drawn again');
    check(/Options/.test(toasts.join(' ')), 'and says where to get it back', toasts.join(' | '));
    check(L.playTile(card, {}) === null, 'hidden, the tile is not there');
    check(L.firstGameCard({}) === null, 'nor the home screen’s offer of the first game');
    S.tutorialDone = true;
    check(L.homeCard({}) === null, 'nor the home screen’s offer of the lessons');
    check(typeof L.open === 'function' && typeof L.start === 'function', 'the lessons themselves are still there to open');
    S.showTutorials = true;
    check(!!L.playTile(card, {}), 'shown again from Options, the tile is back');
    check(!!L.homeCard({}), 'and so are the lessons on the home screen');
    S.tutorialDone = false;
    check(!!L.firstGameCard({}), 'and the first game, for somebody who has not played it');
    const opts = fs.readFileSync(path.join(SRC, '14-app.js'), 'utf8');
    check(/toggle\('showTutorials', 'Show the Tutorials on the Play screen'/.test(opts), 'Options has the switch to show them again');
  }

  /* ================= no instruction left from an older table ================= */
  {
    const DATED = /double-click|press I\b|\bhover any card|beginner hint/i;
    const say = [];
    for (const touchy of [false, true]) {
      nav.maxTouchPoints = touchy ? 5 : 0;
      const fake = { me: { pool: { W: 0 }, life: 20 }, autoTap: () => touchy, manaSources: () => [], analysis: () => null, els: new Map() };
      for (const m of UI.COACH_MARKS) say.push([m.id, m.text(fake, { players: [] }, { startLife: 20 })]);
      for (const def of MTG.lessons.LESSONS) for (const n of MTG.lessons.NOTES[def.id](def, {})) say.push([def.id + '/' + n.id, n.text()]);
    }
    nav.maxTouchPoints = 0;
    for (const [id, s] of say) check(!DATED.test(s), 'no dated instruction in ' + id, s);
    // the touch words say tap, the mouse words click
    nav.maxTouchPoints = 5;
    const read = UI.COACH_MARKS.find(m => m.id === 'read').text();
    nav.maxTouchPoints = 0;
    check(/press and hold/.test(read) && !/Point at/.test(read), 'on a touch screen, cards are read by holding them', read);
    const readMouse = UI.COACH_MARKS.find(m => m.id === 'read').text();
    check(/Point at any card/.test(readMouse) && /Click one of theirs/.test(readMouse), 'with a mouse, by pointing and clicking', readMouse);
    // nor in the source: the hint line under the big button is gone, and so is its setting
    for (const f of ['12-ui-table.js', '12c-ui-table-ask.js', '12e-ui-coach.js', '14-app.js', '14b-lessons.js', 'table.css']) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      check(!/beginnerHint|dock-hint/.test(src), 'no beginner hints left in ' + f);
      check(!/Double-click, or press I/.test(src), 'no "Double-click, or press I" in ' + f);
    }
  }

  console.log(`tutorials: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
