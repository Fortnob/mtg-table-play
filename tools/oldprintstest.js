#!/usr/bin/env node
/* Printings whose words play differently from the card's today
   (src/02d-oldprints.js, written by tools/oldprints.py): the table reads,
   each old printing names a current one to show, a current printing is
   never itself shown as another, and the picture of an old printing is
   its current printing's.

   node tools/oldprintstest.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log('FAIL ' + what); } };

const window = { MTG: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', '02d-oldprints.js'), 'utf8'), { window, globalThis: {} });
const O = window.MTG.oldPrints;
check(O && O.size > 500, 'the table holds the old printings (' + (O && O.size) + ')');

// Vesuvan Doppelganger: Alpha's copy was not optional; its Oracle text says "you may"
const vd = O.swapId({ set: 'lea', collector_number: '87' });
check(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(vd || ''), 'Alpha Vesuvan Doppelganger is shown as a current printing');
check(O.isOld({ set: 'LEA', collector_number: '87' }), 'set codes are read in any case');
check(!O.isOld({ name: 'a token', set: null }), 'a card with no set is never old');

// a current printing is never in the table: what is shown is never swapped again
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '02d-oldprints.js'), 'utf8');
const data = JSON.parse(/const DATA = ("(?:[^"\\]|\\.)*");/.exec(src)[1]);
const ids = new Set(), keys = new Set();
let dup = 0;
for (const row of data.split(';')) {
  const [id, list] = row.split('=');
  ids.add(id);
  for (const k of list.split(',')) { if (keys.has(k)) dup++; keys.add(k); }
}
check(dup === 0, 'each old printing is listed once');
check(keys.size === O.size, 'every listed printing is read');

// the picture: through the Scryfall client, the current printing's address in every size
window.MTG.util = { normName: (s) => String(s).toLowerCase() };
const scryPath = path.join(__dirname, '..', 'src', '02-scryfall.js');
const scry = fs.readFileSync(scryPath, 'utf8');
const m = /_imageUrl\(card, size, faceIndex\) \{[\s\S]*?\n    \}\n/.exec(scry);
check(!!m, 'the picture is chosen in one place');
if (m) {
  const fn = vm.runInNewContext('({ ' + m[0] + ' })', { MTG: window.MTG });
  const old = { set: 'lea', collector_number: '87', image_uris: { normal: 'https://example/old.jpg', art_crop: 'https://example/old-art.jpg' } };
  check(fn._imageUrl(old, 'normal').includes(vd) && fn._imageUrl(old, 'art_crop').includes('/art_crop/front/'), 'an old printing shows its current printing, art included');
  const now = { set: 'zzz', collector_number: '1', image_uris: { normal: 'https://example/now.jpg' } };
  check(fn._imageUrl(now, 'normal') === 'https://example/now.jpg', 'a printing with today\'s words keeps its own picture');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
