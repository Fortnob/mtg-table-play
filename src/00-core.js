/* ============================================================
   00-core.js — foundation: utils, events, RNG, IDs, storage
   ============================================================ */
'use strict';

const MTG = (window.MTG = window.MTG || {});
MTG.version = '1.0.0';

/* ---------- tiny DOM helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (children != null) {
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
  }
  return n;
}
MTG.$ = $; MTG.$$ = $$; MTG.el = el;

/* ---------- misc utils ---------- */
const U = MTG.util = {
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  sum: (a) => a.reduce((x, y) => x + y, 0),
  uniq: (a) => Array.from(new Set(a)),
  last: (a) => a[a.length - 1],
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  titleCase: (s) => String(s).replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase()),
  // stable object hash for cache keys
  hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  },
  // normalize a card name for matching (strip accents, punctuation variance)
  normName(n) {
    return String(n || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/’/g, "'").replace(/—|–/g, '-')
      .trim().toLowerCase();
  },
  // front face of a "A // B" name
  frontName(n) { return String(n || '').split('//')[0].trim(); },
  groupBy(arr, fn) {
    const m = new Map();
    for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  },
  /**
   * "two" -> 2. Card text spells small numbers out; `xValue` is what to
   * return for "X", which the oracle wants as the literal 'X' to resolve
   * later and the combo finder wants as 0.
   */
  numWord(w, xValue) {
    if (w == null) return 1;
    const s = String(w).toLowerCase().trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === 'x') return xValue === undefined ? 1 : xValue;
    const map = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return map[s] !== undefined ? map[s] : 1;
  },
  debounce(fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  },

  /* ---- money ----
     Scryfall quotes a card in three currencies and any of them can be
     missing, which is not the same as free: a card with no price is a card
     nobody has listed, and totalling it as zero would quietly understate
     every deck it is in. */
  priceOf(card, cur) {
    const p = card && card.prices;
    if (!p) return null;
    const key = cur || MTG.settings.priceCurrency || 'usd';
    const raw = p[key] != null ? p[key] : (key === 'usd' ? p.usd_foil : null);
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  },
  priceSymbol(cur) {
    return { usd: '$', eur: '\u20ac', tix: '' }[cur || MTG.settings.priceCurrency || 'usd'] || '$';
  },
  money(n, cur) {
    if (n == null) return '\u2014';
    const sym = MTG.util.priceSymbol(cur);
    const s = n >= 100 ? n.toFixed(0) : n.toFixed(2);
    return cur === 'tix' || (!cur && MTG.settings.priceCurrency === 'tix') ? s + ' tix' : sym + s;
  },
  /** What a list costs, and how much of it we could not price. */
  deckPrice(deck, cur) {
    let total = 0, unpriced = 0, priced = 0;
    const add = (card, qty) => {
      const p = MTG.util.priceOf(card, cur);
      if (p == null) { unpriced += qty; return; }
      total += p * qty; priced += qty;
    };
    for (const e of (deck.main || [])) add(e.card, e.qty);
    for (const e of (deck.sideboard || [])) add(e.card, e.qty);
    for (const c of (deck.commanders || [])) add(c, 1);
    return { total, unpriced, priced };
  }
};

/* ---------- the interface's zoom ----------
   The whole interface is scaled with `zoom` on <body> (your interface size
   times a fit to the screen). The browser hands measurements back in screen
   pixels (getBoundingClientRect, a pointer's clientX, innerWidth) but a
   length written into a style inside <body> is zoomed again on the way out.
   These give measurements in the body's own pixels, so whatever is measured
   can be written straight back into a style. */
U.zoom = () => MTG._zoom || 1;
U.rect = (node) => {
  const r = node.getBoundingClientRect();
  const z = MTG._zoom || 1;
  if (z === 1) return r;
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z,
    width: r.width / z, height: r.height / z, x: r.x / z, y: r.y / z };
};
U.pt = (e) => { const z = MTG._zoom || 1; return { x: (e.clientX || 0) / z, y: (e.clientY || 0) / z }; };
U.viewW = () => window.innerWidth / (MTG._zoom || 1);
U.viewH = () => window.innerHeight / (MTG._zoom || 1);

/* ---------- deterministic RNG (mulberry32) ----------
   Seeded so that host + clients can generate identical packs/shuffles. */
class RNG {
  constructor(seed) {
    if (typeof seed === 'string') seed = parseInt(U.hash(seed), 36);
    this.s = (seed >>> 0) || (Date.now() >>> 0);
  }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(lo, hi) { return lo + this.int(hi - lo + 1); }
  pick(arr) { return arr[this.int(arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) {           // Fisher–Yates, in place
    this._mix(arr);
    // (a game hears of it: what anybody knew of where its cards were is gone)
    if (this.onShuffle) this.onShuffle(arr);
    return arr;
  }
  _mix(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  sample(arr, n) {         // n distinct items
    const copy = arr.slice();
    this._mix(copy);
    return copy.slice(0, n);
  }
  // weighted pick: entries [[item, weight], ...]
  weighted(entries) {
    const total = entries.reduce((a, e) => a + e[1], 0);
    let r = this.next() * total;
    for (const [item, w] of entries) { r -= w; if (r <= 0) return item; }
    return entries[entries.length - 1][0];
  }
}
MTG.RNG = RNG;

/* ---------- unique ids ---------- */
let _idc = 0;
MTG.uid = (prefix) => `${prefix || 'x'}_${(++_idc).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/* ---------- bots' names ----------
   "Brass Vizier", "Mossy Falconer": what a bot is called until its deck
   gives it a better name. Shared by the lobby (src/14-app.js) and the
   bots of a friends tournament (src/09f-tourney.js). */
const BOT_NAME_A = ['Quiet', 'Brass', 'Amber', 'Storm', 'Ivory', 'Hollow', 'Gilded', 'Mossy', 'Iron', 'Pale',
  'Ember', 'Silver', 'Thorn', 'Dusk', 'Cinder', 'Marsh', 'Frost', 'Copper', 'Sable', 'Wren'];
const BOT_NAME_B = ['Scribe', 'Warden', 'Drake', 'Herald', 'Sentry', 'Vizier', 'Pilgrim', 'Raven', 'Smith', 'Fox',
  'Tinker', 'Reaper', 'Magus', 'Harrier', 'Cantor', 'Miller', 'Corsair', 'Adept', 'Falconer', 'Wright'];
/** A name of two words not among `taken`; `rand` is a random number source (Math.random when left out). */
MTG.botName = function (taken, rand) {
  rand = rand || Math.random;
  const used = new Set(taken || []);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  for (let i = 0; i < 60; i++) {
    const n = pick(BOT_NAME_A) + ' ' + pick(BOT_NAME_B);
    if (!used.has(n)) return n;
  }
  return pick(BOT_NAME_A) + ' ' + (used.size + 1);
};

/* ---------- event bus ---------- */
class Emitter {
  constructor() { this._h = new Map(); }
  on(ev, fn) {
    if (!this._h.has(ev)) this._h.set(ev, new Set());
    this._h.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  once(ev, fn) { const off = this.on(ev, (...a) => { off(); fn(...a); }); return off; }
  off(ev, fn) { const s = this._h.get(ev); if (s) s.delete(fn); }
  emit(ev, ...args) {
    const s = this._h.get(ev);
    if (s) for (const fn of Array.from(s)) { try { fn(...args); } catch (e) { console.error('[bus]', ev, e); } }
    const any = this._h.get('*');
    if (any) for (const fn of Array.from(any)) { try { fn(ev, ...args); } catch (e) { console.error(e); } }
  }
}
MTG.Emitter = Emitter;
MTG.bus = new Emitter();

/* ---------- localStorage-backed settings ---------- */
const LS_KEY = 'mtgtable.settings.v1';
const defaultSettings = {
  playerName: '',
  avatar: null,
  useCollection: true,    // decks are built from the cards you own (src/10c-economy.js)          // a profile picture: a small image as a data URL (src/10b-ui-avatar.js)
  volume: 0.5,
  muted: false,
  cardBack: 'classic',
  autoTapLands: true,
  showTutorials: true,           // the Tutorials tile on the Play screen, and the home screen's offers of them
  autoPassEmptyPriority: true,   // skip priority when you have nothing castable
  autoPassUntilStackChange: true,
  alwaysFullControl: false,      // nothing is ever passed for you
  orderMyTriggers: false,        // choose the order your own triggers go on the stack
  stops: null,                   // null means "use the defaults below"
  confirmAttacks: true,
  showPhaseBar: true,
  animateDraws: true,
  artPreferences: {},
  cardScripts: {},           // cards the player has written out themselves            // oracle_id -> scryfall print id
  preferredSetForImport: '',
  peerServer: 'default',
  theme: 'dark',
  handSort: 'cmc',
  deckSort: 'recent',
  deckFilter: 'all',
  rulePresets: {},               // formatId -> [{name, rules}] the host saved
  showCardPrices: false,         // a price on every line of the decklist
  priceCurrency: 'usd',          // 'usd' | 'eur' | 'tix'
  chaosPool: null,               // {preset, sets:[code]} for chaos draft
  compactZones: false,
  showOracleOnHover: true,
  recommanderRelay: '',          // the relay Commander suggestions are asked through (src/16b-recommander.js); empty: the one built in
  suggestFrom: 'recommander',    // where Commander suggestions come from: 'recommander' | 'edhrec'
  keywordHelp: true,             // what each keyword means, beside an enlarged card
  stackAutoResolve: false,
  priorityTimer: 15,             // seconds before a pass-or-respond moment passes by itself (0: never)
  botSpeed: 1500,                // how long every bot pauses before each thing it does, in ms (MTG.BOT_PACES): Normal
  animSpeed: 1,                  // how long the table dwells on each moment
  stopWhenAble: false,           // true: stop whenever you could act, not only at your stops
  splitOpponents: false,         // two or three opponents side by side instead of one at a time
  peekOpponents: true,           // on a wide screen, the boards either side of the one in view, smaller

  /* --- accessibility --- */
  uiScale: 1,            // scales all text and controls
  fitScreen: true,       // and grows them to fill a big screen
  cardScale: 1,          // scales card art everywhere
  highContrast: false,   // stronger borders and brighter text
  colorblindPips: false, // letters + shapes on every mana symbol
  alwaysCardText: false, // hover preview includes the card written out
  reduceMotion: false,   // no transitions or animations
  dyslexiaFont: false,   // wider typeface, looser spacing
  focusRings: true,      // obvious keyboard focus
  bigHitTargets: false,  // roomier buttons and rows
};
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return Object.assign({}, defaultSettings, raw ? JSON.parse(raw) : {});
  } catch (e) { return Object.assign({}, defaultSettings); }
}
MTG.settings = loadSettings();
/* Bot speed: Normal became the default once the speeds had names. The
   600 ms that settings saved before then was the old default written out
   with everything else, not a choice, so it becomes Normal, once.
   (botPaceV marks it done; it is not among the defaults, or a save from
   before would look done already.) */
if (MTG.settings.botPaceV !== 2) {
  if (MTG.settings.botSpeed === 600) MTG.settings.botSpeed = 1500;
  MTG.settings.botPaceV = 2;
  try { localStorage.setItem(LS_KEY, JSON.stringify(MTG.settings)); } catch (e) { /* kept for this visit only */ }
}
MTG.saveSettings = function () {
  try { localStorage.setItem(LS_KEY, JSON.stringify(MTG.settings)); } catch (e) { /* quota */ }
  MTG.bus.emit('settings:changed', MTG.settings);
};
MTG.setSetting = function (k, v) { MTG.settings[k] = v; MTG.saveSettings(); };
MTG.resetSettings = function () {
  const keepArt = MTG.settings.artPreferences;
  const keepName = MTG.settings.playerName;
  // your friend code too: a new one would be a stranger to all your friends
  MTG.settings = Object.assign({}, defaultSettings, { artPreferences: keepArt, playerName: keepName, avatar: MTG.settings.avatar || null,
    friendCode: MTG.settings.friendCode || '' });
  MTG.saveSettings();
};

/* ---------- apply the display + accessibility settings to the document ----------
   Everything is driven from data-* attributes and CSS custom properties, so the
   stylesheet stays the single place that decides what each option looks like. */
MTG.applyDisplaySettings = function () {
  const S = MTG.settings;
  const r = document.documentElement;
  if (!r) return;
  r.dataset.theme = S.theme || 'dark';
  const flag = (name, on) => { if (on) r.setAttribute(name, ''); else r.removeAttribute(name); };
  flag('data-contrast', S.highContrast);
  flag('data-cbpips', S.colorblindPips);
  flag('data-reduce-motion', S.reduceMotion || matchMediaReduced());
  flag('data-dyslexia', S.dyslexiaFont);
  flag('data-focus-rings', S.focusRings);
  flag('data-big-targets', S.bigHitTargets);
  r.style.setProperty('--card-scale', String(U.clamp(S.cardScale || 1, 0.6, 2)));
  if (MTG.applyLayoutMode) MTG.applyLayoutMode();   // the zoom and --app-h follow the screen
  if (MTG.audio && MTG.audio.master) MTG.audio.master.gain.value = S.muted ? 0 : S.volume;
  MTG.bus.emit('display:changed', S);
};
function matchMediaReduced() {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

/* ---------- where the game stops for you ----------
   Auto-pass hands priority back the moment you could not do anything with
   it. These are the steps you always want to see anyway, split by whose turn
   it is — the same idea as stops in Arena or Cockatrice. */
MTG.STOP_STEPS = [
  ['upkeep', 'Upkeep'],
  ['draw', 'Draw'],
  ['main1', 'Main 1'],
  ['beginCombat', 'Begin combat'],
  ['declareAttackers', 'Attackers'],
  ['declareBlockers', 'Blockers'],
  ['combatDamage', 'Combat damage'],
  ['endCombat', 'End of combat'],
  ['main2', 'Main 2'],
  ['end', 'End step'],
];
MTG.DEFAULT_STOPS = {
  yours: { main1: true, declareAttackers: true, main2: true },
  theirs: { declareBlockers: true, end: true },
};
/** A stable name for this browser, so a reconnect finds its own seat again. */
MTG.clientToken = function () {
  let t = MTG.store.get('clientToken', null);
  if (!t) { t = MTG.uid('cl') + '-' + Math.random().toString(36).slice(2, 10); MTG.store.set('clientToken', t); }
  return t;
};

/** What the engine needs to auto-pass for this player. */
MTG.autoPassConfig = function () {
  const S = MTG.settings;
  return {
    enabled: S.autoPassEmptyPriority !== false,
    untilStackChange: S.autoPassUntilStackChange !== false,
    stops: S.stops || MTG.DEFAULT_STOPS,
    // Arena's two gameplay switches, under their own names
    fullControl: !!S.alwaysFullControl,
    fullControlSticky: !!S.alwaysFullControl,
    orderTriggers: !!S.orderMyTriggers,
    // stop only at your stops and when somebody else acts, not wherever you could
    smart: S.stopWhenAble !== true,
  };
};

/* ---------- phone / touch detection ----------
   Two separate questions: is the screen narrow (layout), and is the pointer a
   finger (interaction)? A laptop with a touchscreen is coarse but wide; a phone
   in landscape is touch but short rather than narrow. Both get answered here and
   published as attributes on <html> so CSS and JS agree on one answer. */
const mq = (q) => { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } };
const NARROW = mq('(max-width: 760px)');
const SHORT = mq('(max-height: 560px)');
const COARSE = mq('(pointer: coarse)');

// A phone is a narrow screen, or a touch screen too short to lay out a desktop
// table on — a handset in landscape is 844x390, wide but only 390 tall.
MTG.isPhone = () => !!(NARROW && NARROW.matches) ||
  !!(COARSE && COARSE.matches && SHORT && SHORT.matches);
MTG.isTouch = () => !!(COARSE && COARSE.matches) || (navigator.maxTouchPoints || 0) > 0;
MTG.isShort = () => !!(SHORT && SHORT.matches);

/* The interface is laid out for a screen about 1440 by 860. A bigger
   screen gets everything bigger in proportion (height counts most, so an
   ultrawide is not blown up past what fits top to bottom) rather than the
   same small table floating in a sea of felt. Smaller screens and phones
   keep the sizes they were laid out for. */
const FIT_W = 1440, FIT_H = 860;
MTG.screenFit = function () {
  if (MTG.settings.fitScreen === false || MTG.isPhone()) return 1;
  const f = Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H);
  return U.clamp(f, 1, 2.4);
};
/** The zoom on <body>: your interface size times the fit to the screen. */
MTG.uiZoom = function () {
  const z = U.clamp(MTG.settings.uiScale || 1, 0.75, 1.8) * MTG.screenFit();
  return Math.round(z * 100) / 100;
};

MTG.applyLayoutMode = function () {
  const r = document.documentElement;
  if (!r) return;
  const was = r.hasAttribute('data-phone');
  const set = (name, on) => { if (on) r.setAttribute(name, ''); else r.removeAttribute(name); };
  set('data-phone', MTG.isPhone());
  set('data-touch', MTG.isTouch());
  set('data-short', MTG.isShort());
  // The interface size you chose, times a fit to the screen.
  const scale = MTG.uiZoom();
  if (scale !== MTG._zoom) {
    MTG._zoom = scale;
    r.style.setProperty('--ui-scale', String(scale));
  }
  // The real viewport height: 100vh on a phone browser measures the window
  // without its collapsing address bar, so the app hangs off the bottom.
  // Divided by the zoom because body carries it.
  r.style.setProperty('--app-h', (window.innerHeight / scale) + 'px');
  // room to spare top to bottom, once zoomed
  set('data-tall', window.innerHeight / scale >= 1000);
  set('data-snug', window.innerHeight / scale < 900);
  if (was !== MTG.isPhone()) MTG.bus.emit('layout:changed', { phone: MTG.isPhone() });
};

(function watchLayout() {
  if (typeof window === 'undefined') return;
  let raf = 0;
  const onChange = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => MTG.applyLayoutMode());
  };
  for (const m of [NARROW, SHORT, COARSE]) {
    if (!m) continue;
    if (m.addEventListener) m.addEventListener('change', onChange);
    else if (m.addListener) m.addListener(onChange);
  }
  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', onChange, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onChange, { passive: true });
  MTG.applyLayoutMode();
})();

/* ---------- names fit for the table ----------
   A name with a slur or an obscenity in it is not shown. Yours is refused
   when you choose it (a player's name or a deck's); anyone else's is shown
   as a plain stand-in. The words are kept rot13'd, out of plain sight. A
   name is read the way people get round a filter: case and accents,
   digits and symbols for letters (0 for o, 1 for i, $ for s, @ for a),
   letters doubled, and spaces, dots or capitals between the letters. Some
   words are only words on their own (so Cockatrice, Dickens and Cassandra
   are fine), and a few innocent words that hold a worse one are let be
   (Scunthorpe, shiitake). */
MTG.names = (function () {
  const rot = (s) => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97));
  // anywhere in the name, letters run together
  const ANY = ('avttre avttn avttnu avtthu snttbg sntbg xvxr puvax jrgonpx ornare tbbx enturnq gbjryurnq genaal ergneq phag shpx fuvg ' +
    'juber fyhg ovgpu uvgyre gjng jnax nffubyr wvmm crqbcuvyr cnrqbcuvyr zbyrfgre fcnfgvp').split(' ').map(rot);
  // only as a word of the name
  const WORD = ('snt sntf fcvp fcvpx pbba qlxr cnxv wnc arteb pbpx qvpx chffl encr encvfg anmv phz nff nefr gvgf crqb xxx qvyqb obare cbea')
    .split(' ').map(rot);
  const SAFE = ['scunthorpe', 'shiitake', 'shitake', 'snigger', 'niggard', 'swank', 'retardant', 'cockatrice'];
  const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '(': 'c' };
  // a word as a pattern: each run of a letter at least as long as it is, and as long again as anyone likes
  const pat = (w) => w.replace(/(.)\1*/g, (m, c) => c + (m.length > 1 ? `{${m.length},}` : '+'));
  const anyRe = new RegExp(ANY.map(pat).join('|'));
  const wordRe = new RegExp('^(?:' + WORD.map(pat).join('|') + ')(?:e?r?s|z|e?r)?$');
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z]/g, c => LEET[c] || ' ');
  /** Whether a name is fit to be shown. */
  function ok(name) {
    const f = fold(name);
    let run = f.replace(/ /g, '');
    for (const w of SAFE) run = run.split(w).join(' ');
    if (anyRe.test(run.replace(/ /g, '|'))) return false;
    // the words of it, letters spelled out one by one counted as one word
    const words = [];
    let spelled = '';
    for (const w of f.split(/ +/).filter(Boolean)) {
      if (w.length === 1) { spelled += w; continue; }
      if (spelled) { words.push(spelled); spelled = ''; }
      words.push(w);
    }
    if (spelled) words.push(spelled);
    words.push(f.replace(/ /g, ''));
    return !words.some(w => wordRe.test(w));
  }
  /** The name, or the stand-in when it is not fit to be shown. */
  const fit = (name, standIn) => (ok(name) ? name : (standIn == null ? 'Player' : standIn));
  return { ok, fit };
})();

/* ---------- generic namespaced localStorage store (decks, cubes) ---------- */
MTG.store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('mtgtable.' + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('mtgtable.' + key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('storage full', e); return false; }
  },
  del(key) { try { localStorage.removeItem('mtgtable.' + key); } catch (e) {} },
  keys(prefix) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mtgtable.' + (prefix || ''))) out.push(k.slice(9));
    }
    return out;
  }
};

/* ---------- mana symbol parsing / rendering ---------- */
const MANA = MTG.mana = {
  COLORS: ['W', 'U', 'B', 'R', 'G'],
  COLOR_NAMES: { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' },
  // the basic land that makes each colour, and the way back
  BASIC_FOR: { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' },
  COLOR_OF_BASIC: { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' },

  // Parse "{2}{W}{U/P}{X}" -> ['2','W','U/P','X']
  parse(cost) {
    if (!cost) return [];
    const out = [];
    const re = /\{([^}]+)\}/g; let m;
    while ((m = re.exec(cost))) out.push(m[1]);
    return out;
  },
  /** Whether a card's cost (its front's) has an X in it. */
  hasX(card) {
    const cost = (card && (card.mana_cost || (card.card_faces && card.card_faces[0] && card.card_faces[0].mana_cost))) || '';
    return /\{X\}/.test(String(cost).split(' // ')[0]);
  },
  /** A card's place in a sort by mana value: X costs after everything else, by mana value among themselves. */
  sortMv(card) {
    return (MANA.hasX(card) ? 1000 : 0) + ((card && card.cmc) || 0);
  },
  // Mana value of a cost string
  cmc(cost) {
    let v = 0;
    for (const s of MANA.parse(cost)) {
      if (/^\d+$/.test(s)) v += parseInt(s, 10);
      else if (s === 'X' || s === 'Y' || s === 'Z') v += 0;
      else if (s === '∞') v += 0;
      else if (/^\d+\/\w$/.test(s)) v += parseInt(s, 10);    // {2/W}
      else v += 1;                                            // colored, phyrexian, hybrid, snow
    }
    return v;
  },
  // render {2}{W}{U} into inline HTML pips
  html(cost) {
    if (!cost) return '';
    return MANA.parse(cost).map(s => {
      const cls = MANA.pipClasses(s);
      return `<i class="pip ${cls}" title="${U.esc(s)}" data-sym="${U.esc(s)}">${U.esc(MANA.pipText(s))}</i>`;
    }).join('');
  },
  pipText(s) {
    if (/^\d+$/.test(s)) return s;
    if (s === 'X' || s === 'Y' || s === 'Z') return s;
    if (s === 'T') return '↻';
    if (s === 'Q') return '↺';
    if (s === 'S') return '❄';
    if (s === 'E') return '◆';
    if (s.length === 1) return s;
    // hybrid and Phyrexian read as "W/U" and "W/@PHI@" so both halves stay legible
    const parts = s.split('/');
    return parts.map(p => (p === 'P' ? 'Φ' : p)).join('/');
  },
  pipClasses(s) {
    const cs = [];
    if (/^\d+$/.test(s) || s === 'X' || s === 'Y' || s === 'Z') {
      cs.push('pip-generic');
      if (!/^\d+$/.test(s) || +s <= 20) cs.push('pip-num');     // {0} to {20}, {X}: printed symbols exist
    }
    else if (s === 'C') cs.push('pip-c');
    else if (s === 'T') cs.push('pip-tap');
    else if (s === 'Q') cs.push('pip-tap', 'pip-untap');
    else if (s === 'S') cs.push('pip-snow');
    else if (s === 'E') cs.push('pip-energy');
    else {
      const cols = MANA.COLORS.filter(c => s.includes(c));
      if (cols.length === 1) cs.push('pip-' + cols[0].toLowerCase());
      // hybrid and two-brid symbols read as gold, the way multicolour does
      else if (cols.length > 1) cs.push('pip-hybrid', 'pip-' + cols[0].toLowerCase() + cols[1].toLowerCase());
      else cs.push('pip-generic');
    }
    if (s.includes('P')) cs.push('pip-phyrexian');
    if (s.includes('/') && /\d/.test(s)) cs.push('pip-hybrid');       // {2/W}
    if (s.includes('/') && s.includes('P')) cs.push('pip-hybrid');     // {W/P}
    return cs.join(' ');
  },
  /**
   * So much of one kind of mana, written as its symbols for the page to
   * draw: ("G", 3) -> "{G}{G}{G}". A great deal of it is the symbol and a
   * count, so a line of the log stays a line.
   */
  times(sym, n) {
    n = Math.max(0, Math.floor(+n || 0));
    const one = '{' + String(sym).replace(/^\{|\}$/g, '') + '}';
    return n > 10 ? one + ' ×' + n : one.repeat(n);
  },
  /** A mana cost as words, for a screen reader: "{2}{G}{G}" -> "2 generic, 2 green". */
  speak(cost) {
    if (!cost) return '';
    const names = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless', X: 'X', S: 'snow', P: 'Phyrexian' };
    const out = [];
    let generic = 0;
    for (const sym of MANA.parse(cost)) {
      if (/^\d+$/.test(sym)) { generic += +sym; continue; }
      if (sym.includes('/')) { out.push(sym.split('/').map(x => names[x] || x).join(' or ') + ' hybrid'); continue; }
      out.push(names[sym] || sym);
    }
    const counted = {};
    for (const w of out) counted[w] = (counted[w] || 0) + 1;
    const parts = [];
    if (generic) parts.push(generic + ' generic');
    for (const [w, n] of Object.entries(counted)) parts.push(n > 1 ? `${n} ${w}` : w);
    return parts.join(', ');
  },

  // Replace {SYM} in oracle text with pips
  textHtml(text) {
    if (!text) return '';
    let out = U.esc(text);
    out = out.replace(/\{([^}]+)\}/g, (m, s) => `<i class="pip in-text ${MANA.pipClasses(s)}" title="${U.esc(s)}" data-sym="${U.esc(s)}">${U.esc(MANA.pipText(s))}</i>`);
    out = out.replace(/\(([^)]+)\)/g, '<em class="reminder">($1)</em>');
    return out.replace(/\n/g, '<br>');
  },
};

/* ---------- a mana pool ---------- */
class ManaPool {
  constructor() { this.clear(); }
  /* (noGeneric: Jegantha, the Wellspring's "This mana can't be spent to pay generic mana costs" — how much of each
     colour in the pool can pay only coloured symbols) */
  clear() { this.W = 0; this.U = 0; this.B = 0; this.R = 0; this.G = 0; this.C = 0; this.noGeneric = null; }
  add(color, n) { this[color] = (this[color] || 0) + (n == null ? 1 : n); }
  total() { return this.W + this.U + this.B + this.R + this.G + this.C; }
  isEmpty() { return this.total() === 0; }
  clone() { const p = new ManaPool(); Object.assign(p, this.snapshot()); return p; }
  snapshot() { return { W: this.W, U: this.U, B: this.B, R: this.R, G: this.G, C: this.C }; }
  restore(s) { Object.assign(this, s); }
  toString() {
    const parts = [];
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) if (this[c]) parts.push(`${this[c]}${c}`);
    return parts.join(' ') || '—';
  }
  /** What is in it as symbols, for the log to draw: "{R}{R}{G}". */
  symbols() {
    return ['W', 'U', 'B', 'R', 'G', 'C'].map(c => MANA.times(c, this[c])).join('') || '—';
  }
  /* Greedy but color-aware payment. Returns {ok, spent} without mutating unless commit. */
  canPay(cost, opts) {
    const plan = this.planPayment(cost, opts);
    return !!plan;
  }
  planPayment(cost, opts) {
    opts = opts || {};
    const syms = MANA.parse(cost);
    const avail = this.snapshot();
    const spend = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    // the mana that can't pay generic costs is the first spent on coloured symbols
    const ng = {};
    for (const c of Object.keys(this.noGeneric || {})) ng[c] = Math.min(this.noGeneric[c] || 0, avail[c] || 0);
    const useNg = (c) => { if (ng[c] > 0) ng[c]--; };
    let generic = 0;
    const flexible = [];   // hybrid/phyrexian symbols resolved after strict ones
    for (const s of syms) {
      if (/^\d+$/.test(s)) { generic += parseInt(s, 10); continue; }
      if (s === 'X') { generic += (opts.x || 0); continue; }
      if (s === 'Y' || s === 'Z') { generic += (opts[s.toLowerCase()] || 0); continue; }
      if (s.length === 1 && MANA.COLORS.includes(s)) {
        if (avail[s] > 0) { avail[s]--; spend[s]++; useNg(s); } else return null;
        continue;
      }
      if (s === 'C') { if (avail.C > 0) { avail.C--; spend.C++; useNg('C'); } else return null; continue; }
      if (s === 'S') { flexible.push(['W', 'U', 'B', 'R', 'G', 'C']); continue; } // snow approximated
      flexible.push(s.split('/'));
    }
    // resolve hybrids: prefer colors we have most of
    for (const opts2 of flexible) {
      let paid = false;
      const numeric = opts2.find(o => /^\d+$/.test(o));
      const colorOpts = opts2.filter(o => MANA.COLORS.includes(o) || o === 'C');
      colorOpts.sort((a, b) => avail[b] - avail[a]);
      for (const c of colorOpts) { if (avail[c] > 0) { avail[c]--; spend[c]++; useNg(c); paid = true; break; } }
      if (!paid && numeric) { generic += parseInt(numeric, 10); paid = true; }
      if (!paid && opts2.includes('P')) { paid = true; spend.life = (spend.life || 0) + 2; } // phyrexian: pay life
      if (!paid) return null;
    }
    // pay generic with colorless first, then least-needed colors
    const order = ['C', 'W', 'U', 'B', 'R', 'G'];
    for (const c of order) {
      while (generic > 0 && avail[c] > (ng[c] || 0)) { avail[c]--; spend[c]++; generic--; }
    }
    if (generic > 0) return null;
    // Phyrexian mana paid with life: no more than the life that can be paid
    if (spend.life && opts.lifeLimit != null && spend.life > opts.lifeLimit) return null;
    if (this.noGeneric) Object.defineProperty(spend, 'noGenericLeft', { value: ng, enumerable: false });
    return spend;
  }
  pay(cost, opts) {
    const plan = this.planPayment(cost, opts);
    if (!plan) return null;
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) this[c] -= (plan[c] || 0);
    if (this.noGeneric) this.noGeneric = plan.noGenericLeft || null;
    return plan;
  }
}
MTG.ManaPool = ManaPool;

/* ---------- logging ---------- */
MTG.log = function (...a) { if (MTG.DEBUG) console.log('[mtg]', ...a); };
MTG.DEBUG = /[?&]debug/.test(location.search);
/* How fast the bots play: how long each one pauses before each thing it
   does, so a person can follow it. One setting for the whole table
   (settings.botSpeed), named here for Options and the game menu. Very
   fast is the pace the bots used to keep; Normal is the default. */
MTG.BOT_PACES = [[600, 'Very fast'], [1000, 'Fast'], [1500, 'Normal'], [2200, 'Slow'], [3200, 'Very slow']];


