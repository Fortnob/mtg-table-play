#!/usr/bin/env node
/* The keyword glossary beside an enlarged card (src/10a-glossary.js),
   checked without a browser:

   - every keyword Scryfall gives any card in tools/oracle-cards.jsonl.gz
     has an explanation (or is a plain verb the glossary leaves alone), so
     a new set's keywords cannot quietly show nothing;
   - real cards get the boxes they should and none they should not: the
     names of abilities ("Fear Gas —"), other cards' names, counters named
     like keywords, umbrella keywords beside particular ones.

   A failure exits non-zero. Run by tools/check.py ('glossary'). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const BULK = path.join(__dirname, 'oracle-cards.jsonl.gz');
global.window = { MTG: { el: () => ({}), util: { viewW: () => 1000 }, ui: {}, settings: {}, mana: { textHtml: (s) => s }, scry: {}, isShort: () => false } };
// eslint-disable-next-line no-eval
(0, eval)(fs.readFileSync(path.join(ROOT, 'src', '10a-glossary.js'), 'utf8'));
const G = window.MTG.glossary;

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };
// the actions every card does in plain words, left without a box on purpose (PLAIN in the module)
const PLAIN = new Set(['activate', 'attach', 'cast', 'counter', 'create', 'destroy', 'discard', 'exchange', 'exile',
  'play', 'reveal', 'sacrifice', 'shuffle', 'tap', 'untap', 'double', 'triple', 'heal', 'empower jace', 'role token']);
// the joke and playtest cards' own keywords, not in the game (MTG.jokes), and so not explained
for (const k of G.LEFT_OUT || []) PLAIN.add(k.toLowerCase());

check(G.size > 300, 'the glossary has its terms (' + G.size + ')');

/* ---- every keyword there is ----
   Scryfall's own lists (tools/keyword-catalogs.json, refreshed by
   tools/fetch-bulk.py) say what is a keyword; a card's "keywords" also
   carry the names of its abilities ("Fear Gas", "Fira"), which are not. */
const CATALOGS = path.join(__dirname, 'keyword-catalogs.json');
const catalog = new Set();
if (fs.existsSync(CATALOGS)) {
  const cat = JSON.parse(fs.readFileSync(CATALOGS, 'utf8'));
  for (const kind of ['keyword-abilities', 'keyword-actions', 'ability-words']) {
    for (const k of cat[kind] || []) {
      catalog.add(k.toLowerCase());
      check(!!G.lookup(k) || PLAIN.has(k.toLowerCase()), `no explanation for the ${kind.replace(/s$/, '').replace('-', ' ')} "${k}" (Scryfall's catalog of ${cat.updated}): add it to TERMS in src/10a-glossary.js`);
    }
  }
} else {
  check(false, 'tools/keyword-catalogs.json is missing: python tools/fetch-bulk.py --force writes it');
}
const cards = new Map();
if (fs.existsSync(BULK)) {
  const lines = zlib.gunzipSync(fs.readFileSync(BULK)).toString('utf8').split('\n');
  const missing = new Map();
  for (const ln of lines) {
    if (!ln) continue;
    const c = JSON.parse(ln);
    cards.set(c.name, c);
    for (const k of c.keywords || []) {
      if (!catalog.has(k.toLowerCase()) || G.lookup(k) || PLAIN.has(k.toLowerCase())) continue;
      if (!missing.has(k)) missing.set(k, c.name);
    }
  }
  for (const [k, card] of missing) check(false, `no explanation for the keyword "${k}" (first on ${card}): add it to TERMS in src/10a-glossary.js`);
} else {
  console.log('tools/oracle-cards.jsonl.gz is missing (python tools/fetch-bulk.py): only the fixed cases run');
}

/* ---- what real cards show ---- */
const names = (c) => G.find(c).map(t => t.name);
const card = (name, fallback) => cards.get(name) || fallback;
const cases = [
  // [card, must show, must not show]
  ['Serra Angel', ['Flying', 'Vigilance'], []],
  ['Tireless Provisioner', ['Landfall', 'Food', 'Treasure'], []],
  ['Plummet', ['Flying'], []],
  ['Knight of Grace', ['Hexproof from', 'First strike'], ['Hexproof']],
  ['Bog Wraith', ['Swampwalk'], ['Landwalk']],
  ['Lórien Revealed', ['Islandcycling'], ['Cycling', 'Landcycling', 'Typecycling']],
  ['Proud Mentor', ['Partner with'], ['Partner', 'Mentor']],
  ['Impetuous Protégé', ['Partner with'], ['Partner', 'Mentor']],
  ['Gisela, the Broken Blade', ['Flying', 'First strike', 'Lifelink'], ['Fading']],
  ['Storm, Queen of Wakanda', [], ['Storm']],
  ['Wraith, Vicious Vigilante', ['Double strike'], ['Fear']],
  ['Mutalith Vortex Beast', [], ['Warp']],
  ['Powder Keg', [], ['Fuse']],
  ['Soul Echo', [], ['Echo']],
  ['Teferi\'s Protection', ['Phasing', 'Protection'], []],
  ['Fear of Impostors', ['Manifest dread'], ['Manifest']],
  ['Heliod, Sun-Crowned', ['Indestructible', 'Lifelink', '+1/+1 counter'], []],
  ['The Eldest Reborn', ['Lore counter'], []],
  ['Elspeth, Sun\'s Champion', ['Emblem', 'Flying'], []],
  ['Lotus Cobra', ['Landfall'], []],
  ['Sheoldred, the Apocalypse', ['Deathtouch'], []],
  ['Lightning Bolt', [], []],
];
let ran = 0;
for (const [name, want, never] of cases) {
  const c = card(name);
  if (!c) continue;
  ran++;
  const got = names(c);
  for (const w of want) check(got.includes(w), `${name} should show ${w} (shows ${got.join(', ') || 'nothing'})`);
  for (const n of never) check(!got.includes(n), `${name} should not show ${n} (shows ${got.join(', ')})`);
}
// the same rules on text alone, so they are checked even without the bulk file
const t = (name, oracle_text, keywords, type_line) => ({ name, oracle_text, keywords: keywords || [], type_line: type_line || 'Creature' });
const textCases = [
  [t('Test Wraith', 'Double strike\nFear Gas — Test Wraith can\'t be blocked.', ['Double strike', 'Fear Gas']), ['Double strike'], ['Fear']],
  [t('Test Keg', 'At the beginning of your upkeep, you may put a fuse counter on Test Keg.'), [], ['Fuse']],
  [t('Test Ward', 'Flying\nWard {2}', ['Flying', 'Ward']), ['Flying', 'Ward'], []],
  [t('Test Named', 'When this enters, search for a card named Reach Through Mists.'), [], ['Reach']],
  [t('Storm, Test Hero', 'Whenever Storm attacks, scry 1.', [], 'Legendary Creature'), ['Scry'], ['Storm']],
  [t('Test Explorer', 'When this enters, it explores.'), ['Explore'], []],
  [t('Test Dread', 'When this enters, manifest dread.'), ['Manifest dread'], ['Manifest']],
  [t('Test Counter', 'Put a flying counter on target creature.'), ['Flying'], []],
];
for (const [c, want, never] of textCases) {
  const got = names(c);
  for (const w of want) check(got.includes(w), `${c.name} should show ${w} (shows ${got.join(', ') || 'nothing'})`);
  for (const n of never) check(!got.includes(n), `${c.name} should not show ${n} (shows ${got.join(', ')})`);
}
// on the table: what a permanent has gained is shown, and marked
const gained = G.find(t('Test Bear', ''), { keywords: ['Flying', 'Ward {2}', 'Fear Gas'] });
check(gained.some(x => x.name === 'Flying' && x.granted) && gained.some(x => x.name === 'Ward' && x.granted) && !gained.some(x => x.name === 'Fear'),
  'granted keywords are shown and marked, an ability name is not');

console.log(`${ran} real cards checked; ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
