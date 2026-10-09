#!/usr/bin/env node
/* Commander brackets (src/15a-brackets.js), checked without a browser:

   - the cards that move a deck up: Game Changers, mass land denial, extra
     turns, read right on cards that are and cards that only look it;
   - decks land where they should, and a table's bracket turns a deck that
     goes past it away (MTG.formats.validate);
   - every card in tools/oracle-cards.jsonl.gz is read once, so a pattern
     that suddenly catches hundreds of cards shows up as a failure.

   node tools/brackettest.js [--list]   --list prints every card flagged
   A failure exits non-zero. Run by tools/check.py ('brackets'). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

const MTG = load();
const B = MTG.brackets;
const BULK = path.join(__dirname, 'oracle-cards.jsonl.gz');
const list = process.argv.includes('--list');

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };

const cards = new Map();
if (fs.existsSync(BULK)) {
  for (const ln of zlib.gunzipSync(fs.readFileSync(BULK)).toString('utf8').split('\n')) {
    if (!ln) continue;
    const c = JSON.parse(ln);
    if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'double_faced_token') continue;
    const k = c.name.toLowerCase();
    if (!cards.has(k)) cards.set(k, c);
    const front = c.name.split(' // ')[0].toLowerCase();
    if (!cards.has(front)) cards.set(front, c);
  }
}
const card = (n) => {
  const c = cards.get(n.toLowerCase());
  if (!c) throw new Error('not in the bulk file: ' + n);
  return c;
};

if (!cards.size) {
  console.log('no tools/oracle-cards.jsonl.gz (python tools/fetch-bulk.py); 0 passed, 0 failed');
  process.exit(0);
}

/* ---- single cards ---- */
for (const n of ['Demonic Tutor', 'Rhystic Study', 'Cyclonic Rift', "Thassa's Oracle", 'The One Ring', 'Tergrid, God of Fright'])
  check(B.isGameChanger(card(n)), `${n} is a Game Changer`);
for (const n of ['Sol Ring', 'Lightning Bolt', 'Arcane Signet', 'Swords to Plowshares'])
  check(!B.isGameChanger(card(n)), `${n} is not a Game Changer`);

for (const n of ['Armageddon', 'Ravages of War', 'Ruination', 'Blood Moon', 'Magus of the Moon', 'Back to Basics', 'Winter Orb',
  'Static Orb', 'Jokulhaups', 'Obliterate', 'Boom // Bust', 'Catastrophe', 'Wildfire', 'Destructive Force', 'Sunder',
  'Rising Waters', 'Hokori, Dust Drinker', 'Global Ruin', 'Stasis', 'Devastation', 'Decree of Annihilation', 'Acid Rain'])
  check(B.isMassLandDenial(card(n)), `${n} is mass land denial`);
for (const n of ['Strip Mine', 'Wrath of God', 'Cyclonic Rift', 'Ghost Quarter', 'Path to Exile', 'Evolving Wilds', 'Avalanche Riders',
  'Rampant Growth', 'Vandalblast', 'Armageddon Clock', 'Field of Ruin', 'Tectonic Edge', 'Sol Ring', 'Harmonize', 'Damnation',
  'Ugin, the Spirit Dragon', 'Planar Cleansing', 'Austere Command', 'Scourglass', 'Dovin Baan', 'Mungha Wurm'])
  check(!B.isMassLandDenial(card(n)), `${n} is not mass land denial`);

for (const n of ['Time Warp', 'Temporal Manipulation', 'Nexus of Fate', 'Time Stretch', 'Medomai the Ageless', "Karn's Temporal Sundering", 'Expropriate', "Ugin's Nexus"])
  check(B.takesExtraTurn(card(n)), `${n} takes an extra turn`);
for (const n of ['Stranglehold', 'Perch Protection', 'Emrakul, the Promised End', 'Sol Ring'])
  check(!B.takesExtraTurn(card(n)), `${n} does not take an extra turn`);

/* ---- the whole file: nothing runaway ---- */
const flagged = { mld: [], turns: [], gc: [] };
const seen = new Set();
for (const c of cards.values()) {
  if (seen.has(c.name)) continue;
  seen.add(c.name);
  if (B.isMassLandDenial(c)) flagged.mld.push(c.name);
  if (B.takesExtraTurn(c)) flagged.turns.push(c.name);
  if (B.isGameChanger(c)) flagged.gc.push(c.name);
}
check(flagged.gc.length >= 40 && flagged.gc.length <= 80, `Game Changers in the file: ${flagged.gc.length}`);
// a card kept from before the app held on to the flag goes by name: the names have to be the list Scryfall has now
for (const n of flagged.gc) check(B.isGameChanger({ name: n }), `${n} is a Game Changer in the bulk file but not in GC_KNOWN (src/15a-brackets.js)`);
const knownGc = [...seen].filter(n => B.isGameChanger({ name: n }));
check(knownGc.length === flagged.gc.length, `GC_KNOWN names ${knownGc.length} cards, the bulk file ${flagged.gc.length}: ${knownGc.filter(n => !flagged.gc.includes(n)).join(', ')}`);
check(flagged.mld.length >= 40 && flagged.mld.length <= 120, `mass land denial in the file: ${flagged.mld.length}`);
check(flagged.turns.length >= 40 && flagged.turns.length <= 140, `extra-turn cards in the file: ${flagged.turns.length}`);
if (list) for (const k of Object.keys(flagged)) console.log(`${k} (${flagged[k].length}): ${flagged[k].sort().join('; ')}`);

/* ---- decks ---- */
const deck = (cmd, names) => {
  const main = names.map(n => ({ card: card(n), qty: 1 }));
  const basics = 99 - main.length;
  main.push({ card: card('Swamp'), qty: basics });
  return { format: 'commander', commanders: [card(cmd)], main, sideboard: [] };
};
const at = (d, n, what) => {
  const e = B.estimate(d);
  check(e.bracket === n, `${what}: Bracket ${n} (got ${e.bracket}: ${e.reasons.map(r => r.title + ' ' + r.cards.join('/')).join('; ') || 'nothing'})`);
  return e;
};
const plain = deck('Ayara, First of Locthwain', ['Sol Ring', 'Arcane Signet', 'Night\'s Whisper', 'Murder', 'Gray Merchant of Asphodel']);
const e0 = at(plain, 2, 'a deck with nothing past Bracket 1');
check(e0.min === 1 && B.fits(plain, 1), 'it still keeps Bracket 1’s rules');
at(deck('Ayara, First of Locthwain', ['Demonic Tutor', 'Necropotence']), 3, 'two Game Changers');
const four = deck('Ayara, First of Locthwain', ['Demonic Tutor', 'Necropotence', 'Vampiric Tutor', 'Imperial Seal']);
at(four, 4, 'four Game Changers');
const turns1 = deck('Kenrith, the Returned King', ['Time Warp']);
check(B.estimate(turns1).min === 2 && B.estimate(turns1).bracket === 2, 'one extra turn: Bracket 2, not 1');
at(deck('Kenrith, the Returned King', ['Time Warp', 'Temporal Manipulation', 'Capture of Jingzhou']), 4, 'three extra turns');
at(deck('Kenrith, the Returned King', ['Armageddon']), 4, 'Armageddon');
const late = deck('Kenrith, the Returned King', ['Exquisite Blood', 'Sanguine Bond']);
const el = at(late, 3, 'a combo that comes together late');
check(el.reasons.some(r => r.key === 'combo' && r.combos.some(c => !c.early)), 'Exquisite Blood and Sanguine Bond are late');
const early = deck('Kenrith, the Returned King', ['Isochron Scepter', 'Dramatic Reversal']);
at(early, 4, 'a combo that comes together early');
// the commander is half of it
at(deck('Kiki-Jiki, Mirror Breaker', ['Pestermite']), 4, 'Kiki-Jiki with Pestermite');

/* ---- what a bot cuts to fit a table ---- */
check(B.excess(four, 3).size === 1, 'at Bracket 3, one of four Game Changers goes');
check(B.excess(four, 2).size === 4, 'at Bracket 2, all four go');
check(B.excess(four, 4).size === 0, 'at Bracket 4, none');
check(B.excess(early, 3).size === 1 && B.excess(late, 3).size === 0, 'at Bracket 3, an early combo loses a piece and a late one stays');
const kiki = deck('Kiki-Jiki, Mirror Breaker', ['Pestermite']);
check([...B.excess(kiki, 2)].join() === 'pestermite', 'a commander that is half a combo stays; the other half goes');
check(!B.allowedCard(card('Demonic Tutor'), 2) && B.allowedCard(card('Demonic Tutor'), 3), 'a Game Changer is for Bracket 3 and up');
check(!B.allowedCard(card('Armageddon'), 3) && B.allowedCard(card('Armageddon'), 4), 'Armageddon is for Bracket 4 and up');

/* ---- a table's bracket ---- */
const v2 = MTG.formats.validate(four, 'commander', { bracket: 2 });
check(!v2.ok && v2.errors.some(x => /Bracket 2/.test(x) && /Game Changers/.test(x)), 'a Bracket 2 table turns four Game Changers away: ' + v2.errors.join(' | '));
const v4 = MTG.formats.validate(four, 'commander', { bracket: 4 });
check(!v4.errors.some(x => /Bracket/.test(x)), 'a Bracket 4 table takes them');
const v0 = MTG.formats.validate(four, 'commander', {});
check(!v0.errors.some(x => /Bracket/.test(x)), 'a table with no bracket takes them');
const v1 = MTG.formats.validate(turns1, 'commander', { bracket: 1 });
check(v1.errors.some(x => /extra turns/.test(x)), 'a Bracket 1 table turns an extra turn away');
check(MTG.formats.houseFields('commander').some(f => f.key === 'bracket'), 'Commander has a bracket rule');
check(!MTG.formats.houseFields('standard').some(f => f.key === 'bracket'), 'Standard has none');

// after the card cache has said its piece, so the result is the last line
setTimeout(() => {
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}, 50);
