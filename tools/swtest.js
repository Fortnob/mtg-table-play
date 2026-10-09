#!/usr/bin/env node
/* The service worker's rules (src/sw.js), checked without a browser: what
   it keeps (Scryfall's card pictures, card backs and symbols) and what it
   must never touch (the app's own files, Scryfall's card data, anything
   else on the web), and that the pictures it keeps from the start are the
   ones the app draws: every symbol in src/symbols.css and UI.CARD_BACK.
   A failure exits non-zero. Run by tools/check.py ('sw'). */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SW = require(path.join(ROOT, 'src', 'sw.js'));

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };

const keep = [
  ['https://cards.scryfall.io/normal/front/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.jpg?1783937590', 'GET', 'no-cors'],
  ['https://cards.scryfall.io/large/back/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.jpg', 'GET', 'no-cors'],
  ['https://cards.scryfall.io/art_crop/front/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.jpg', 'GET', 'no-cors'],
  ['https://cards.scryfall.io/small/front/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.jpg', 'GET', 'cors'],
  ['https://cards.scryfall.io/border_crop/front/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.jpg', 'GET', 'no-cors'],
  ['https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg', 'GET', 'no-cors'],
  ['https://svgs.scryfall.io/card-symbols/T.svg', 'GET', 'no-cors'],
  ['https://svgs.scryfall.io/sets/dmu.svg?1700000000', 'GET', 'no-cors'],
];
const never = [
  ['https://api.scryfall.com/cards/named?exact=Lightning%20Bolt', 'GET', 'cors', 'the card API'],
  ['https://api.scryfall.com/cards/search?q=t%3Agoblin', 'GET', 'cors', 'searches'],
  ['https://data.scryfall.io/default-cards/default-cards.json', 'GET', 'cors', 'the bulk download'],
  ['https://cards.scryfall.io/png/front/4/e/4ebc7622-08a1-4f43-92dd-8675d395e8f6.png', 'GET', 'no-cors', 'the large PNGs'],
  ['https://cards.scryfall.io.evil.com/normal/front/x.jpg', 'GET', 'no-cors', 'a look-alike host'],
  ['http://cards.scryfall.io/normal/front/4/e/x.jpg', 'GET', 'no-cors', 'plain http'],
  ['https://cards.scryfall.io/normal/front/4/e/x.jpg', 'POST', 'no-cors', 'a POST'],
  ['https://cards.scryfall.io/normal/front/4/e/x.jpg', 'GET', 'navigate', 'a page load'],
  ['https://mtgjson.com/api/v5/DeckList.json', 'GET', 'cors', 'MTGJSON'],
  ['https://fonts.googleapis.com/css2?family=Inter', 'GET', 'no-cors', 'fonts'],
  ['https://fortnob.github.io/mtg-table-play/', 'GET', 'navigate', 'the app'],
  ['https://fortnob.github.io/mtg-table-play/index.html', 'GET', 'no-cors', 'the app file'],
  ['http://localhost:8765/sw.js', 'GET', 'same-origin', 'the worker itself'],
  ['not a url', 'GET', 'no-cors', 'nonsense'],
];
for (const [u, m, mode] of keep) check(SW.shouldHandle(u, m, mode, false), 'should keep ' + u);
for (const [u, m, mode, what] of never) check(!SW.shouldHandle(u, m, mode, false), 'should never touch ' + what + ' (' + u + ')');
check(!SW.shouldHandle(keep[0][0], 'GET', 'no-cors', true), 'should never touch a Range request');

// the pictures kept from the start are the ones the app draws
const css = fs.readFileSync(path.join(ROOT, 'src', 'symbols.css'), 'utf8');
const symbols = new Set((css.match(/https:\/\/svgs\.scryfall\.io\/card-symbols\/[^")\s]+\.svg/g) || []));
const pinned = new Set(SW.PINNED_URLS.filter(u => u.includes('/card-symbols/')));
check(symbols.size > 0, 'symbols.css names its symbols');
for (const u of symbols) check(pinned.has(u), 'pinned is missing ' + u);
for (const u of pinned) check(symbols.has(u), 'pinned has a symbol symbols.css does not draw: ' + u);
const core = fs.readFileSync(path.join(ROOT, 'src', '10-ui-core.js'), 'utf8');
const back = (core.match(/UI\.CARD_BACK = '([^']+)'/) || [])[1];
check(!!back && back === SW.CARD_BACK && SW.PINNED_URLS.includes(back), 'the card back pinned is UI.CARD_BACK (' + back + ')');
for (const u of SW.PINNED_URLS) check(SW.shouldHandle(u, 'GET', 'no-cors', false), 'a pinned picture the worker would not serve: ' + u);
check(SW.NS.startsWith(SW.PREFIX) && SW.PREFIX === 'mtg-table-art-', 'cache names keep the app prefix');
check(Number.isInteger(SW.VERSION) && SW.VERSION > 0, 'a version');
// "turned off on this device": the page makes the mark the worker looks for, under a name no sweep of the prefix removes
const app = fs.readFileSync(path.join(ROOT, 'src', '14-app.js'), 'utf8');
const off = (app.match(/const ART_OFF = '([^']+)'/) || [])[1];
check(!!SW.OFF && off === SW.OFF, 'the page and the worker name the off mark alike (' + off + ' / ' + SW.OFF + ')');
check(!!SW.OFF && !SW.OFF.startsWith(SW.PREFIX), 'the off mark is outside the prefix every sweep deletes');

// the built copy beside index.html is the source as it is
const built = path.join(ROOT, 'sw.js');
if (fs.existsSync(built)) check(fs.readFileSync(built, 'utf8') === fs.readFileSync(path.join(ROOT, 'src', 'sw.js'), 'utf8'), 'sw.js beside index.html is not src/sw.js: run tools/build.py');

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
