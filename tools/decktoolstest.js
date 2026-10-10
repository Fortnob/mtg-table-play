#!/usr/bin/env node
/* The deck tools, checked without a browser:

   - rulings (src/10g-rulings.js): asked for once and kept, oldest first,
     dated the British way, and nothing asked for a card that has none.

   node tools/decktoolstest.js            A failure exits non-zero.
   Run by tools/check.py ('decktools'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { card, engine } = require('./harness');

// (quietly: Node has no IndexedDB, and the card cache saying so is not news)
const warn = console.warn;
console.warn = () => {};
const MTG = engine();
console.warn = warn;
for (const m of ['10g-rulings.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'src', m), 'utf8'), { filename: m });
}

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };

/* ================= rulings ================= */
async function rulingsChecks() {
  const R = MTG.rulings;
  check(R.dateText('2004-10-04') === '4 Oct 2004' && R.dateText('2021-12-31') === '31 Dec 2021', 'dates read the British way');
  let asked = 0;
  const reply = { object: 'list', data: [
    { source: 'wotc', published_at: '2019-01-25', comment: 'The later one.' },
    { source: 'scryfall', published_at: '2004-10-04', comment: 'The earlier one, costs {R}.' },
    { source: 'wotc', published_at: '2010-01-01', comment: '' },
  ] };
  MTG.scry._fetch = async (p) => { asked++; return /rulings$/.test(p) ? reply : null; };
  const bolt = card('Lightning Bolt');
  const list = await MTG.scry.rulings(bolt);
  check(Array.isArray(list) && list.length === 2, 'rulings come back, the empty one left out');
  check(list[0].date === '2004-10-04' && list[0].source === 'scryfall' && list[1].source === 'wotc', 'oldest first, each saying whose it is');
  await MTG.scry.rulings(bolt);
  await MTG.scry.rulings(Object.assign({}, bolt, { id: '00000000-0000-0000-0000-000000000000' }));
  check(asked === 1, `asked once for every printing of one card (${asked} requests)`);
  check(await MTG.scry.rulings({ name: 'Goblin', id: null }) === null && asked === 1, 'a token the engine made has none to ask for');
  MTG.scry._fetch = async () => null;    // Scryfall's 404
  const none = await MTG.scry.rulings(card('Raging Goblin'));
  check(Array.isArray(none) && none.length === 0, 'a card Scryfall has no rulings for has an empty list');
  MTG.scry._fetch = async () => { throw new Error('offline'); };
  let threw = false;
  try { await MTG.scry.rulings(card('Goblin Piker')); } catch (e) { threw = true; }
  check(threw, 'no connection and nothing kept: the view is told, so it can offer to try again');
  check((await MTG.scry.rulings(bolt, { force: true })).length === 2, 'no connection but a copy kept: the copy');
}

(async () => {
  await rulingsChecks();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
