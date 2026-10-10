#!/usr/bin/env node
/* What a set's packs are worth, against an ordinary set's, and which core
   sets add nothing the rest of the Store's packs do not already hold.

   node tools/packvalue.js            report
   node tools/packvalue.js --write    ...and write src/10d3-packvalue.js

   From Scryfall's default-cards bulk file (tools/default-cards.jsonl.gz,
   python tools/fetch-bulk.py --default): each set's booster cards and
   their prices, dealt by the odds the Store's packs are made with
   (MTG.draft.packOdds). A pack's worth is what its cards are worth on
   average, each card's price counted up to PRICE_CAP so one Black Lotus
   does not price a pack out of reach; an ordinary pack is the median of
   the expansions and core sets. A set within MARGIN of that is ordinary
   and keeps the usual price; above it, the price rises with the worth,
   gently, to at most MAX_MULT times. The expansions and core sets are the
   ordinary sets and keep the usual price, whatever their cards fetch now. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { load, SRC } = require('./engine');

const PRICE_CAP = 60;      // dollars: a card's worth to a pack, at most
const MARGIN = 1.6;        // up to this many times an ordinary pack's worth is ordinary
const MAX_MULT = 4;
// the sets whose packs keep the usual price: the Masters sets, the Eternal ones, The List and the like may cost more
const NORMAL = new Set(['expansion', 'core']);
const BULK = path.join(__dirname, 'default-cards.jsonl.gz');

const MTG = load();
const write = process.argv.includes('--write');

(async () => {
  if (!fs.existsSync(BULK)) { console.error('No tools/default-cards.jsonl.gz: python tools/fetch-bulk.py --default'); process.exit(1); }
  const sold = await MTG.scry.packSets();
  const soldCodes = new Set(sold.map(s => s.code));
  // each sold set's booster cards, one printing a name, and every name's sold sets
  const pools = new Map(), where = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(BULK).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (!soldCodes.has(c.set) || c.lang !== 'en' || MTG.formats.isBasicLand(c)) continue;
    if (c.booster === false) continue;
    if (!where.has(c.name)) where.set(c.name, new Set());
    where.get(c.name).add(c.set);
    if (!pools.has(c.set)) pools.set(c.set, new Map());
    const p = pools.get(c.set);
    const usd = parseFloat((c.prices && (c.prices.usd || c.prices.usd_foil)) || '');
    const eur = parseFloat((c.prices && c.prices.eur) || '');
    const price = Number.isFinite(usd) ? usd : Number.isFinite(eur) ? eur * 1.1 : 0;
    const prev = p.get(c.name);
    // a name's cheapest printing in the set stands for it: the ordinary one, not a showcase
    if (!prev || price < prev.price) p.set(c.name, { name: c.name, rarity: c.rarity, price });
  }

  const worth = new Map();
  for (const s of sold) {
    const p = pools.get(s.code);
    if (!p || p.size < 20) continue;
    const pool = { common: [], uncommon: [], rare: [], mythic: [] };
    for (const c of p.values()) {
      const r = c.rarity === 'special' || c.rarity === 'bonus' ? 'mythic' : c.rarity;
      if (pool[r]) pool[r].push(c);
    }
    const odds = MTG.draft.packOdds(MTG.draft.boosterSpecFor(s), pool);
    let ev = 0;
    for (const r of Object.keys(pool)) for (const c of pool[r]) ev += odds.chance(r) * Math.min(PRICE_CAP, c.price);
    worth.set(s.code, ev);
  }
  const ordinary = sold.filter(s => (s.set_type === 'expansion' || s.set_type === 'core') && worth.has(s.code)).map(s => worth.get(s.code)).sort((a, b) => a - b);
  const median = ordinary[Math.floor(ordinary.length / 2)];
  const mult = {};
  for (const s of sold) {
    // an expansion or a core set is an ordinary set and keeps the usual price, however its cards have aged
    if (!worth.has(s.code) || NORMAL.has(s.set_type)) continue;
    const r = worth.get(s.code) / median;
    if (r < MARGIN) continue;
    // above ordinary, the price rises with the square root of the worth, in quarter steps
    mult[s.code] = Math.min(MAX_MULT, Math.round(Math.sqrt(r) * 4) / 4);
  }

  /* Core sets that add nothing: every card of one is in the packs of a set
     the Store still sells that came out no later (Revised after Alpha,
     the numbered editions after the sets they reprint). Taken oldest
     first, so a set kept can cover the ones after it and a set dropped
     covers nothing; and each card can still be opened somewhere. */
  const coreCovered = [];
  const byCode = new Map(sold.map(x => [x.code, x]));
  const dropped = new Set();
  for (const s of sold.filter(x => x.set_type === 'core').sort((a, b) => a.released_at.localeCompare(b.released_at))) {
    const p = pools.get(s.code);
    if (!p) continue;
    const covers = (code) => code !== s.code && !dropped.has(code) && byCode.has(code) && byCode.get(code).released_at <= s.released_at;
    const missing = [...p.keys()].filter(n => ![...(where.get(n) || [])].some(covers));
    if (!missing.length) { coreCovered.push(s.code); dropped.add(s.code); }
    console.log(`core ${s.code.padEnd(4)} ${s.name.padEnd(36)} ${p.size} cards, ${missing.length} new to it${missing.length && missing.length <= 6 ? ': ' + missing.join(', ') : ''}`);
  }

  console.log(`\nordinary pack: $${median.toFixed(2)} (median of ${ordinary.length} expansions and core sets)`);
  const rows = sold.filter(s => worth.has(s.code)).map(s => [s, worth.get(s.code)]).sort((a, b) => b[1] - a[1]);
  for (const [s, ev] of rows.slice(0, 45)) console.log(`${s.code.padEnd(5)} ${s.set_type.padEnd(16)} $${ev.toFixed(2).padStart(7)}  x${(ev / median).toFixed(2)}  ${mult[s.code] ? 'price x' + mult[s.code] : ''}  ${s.name}`);
  console.log(`\n${Object.keys(mult).length} sets above ordinary; core sets all of whose cards other sets' packs hold: ${coreCovered.join(', ') || 'none'}`);

  if (write) {
    const out = `/* ============================================================
   10d3-packvalue.js - what some sets' packs cost, against an ordinary one

   Written by tools/packvalue.js (rerun it when prices or sets change).
   MTG.packValue: a set whose packs are worth well above an ordinary set's
   (its cards' prices, dealt by the odds its packs are made with), and the
   times the usual price its packs cost. Any set not here costs the usual.
   MTG.coreCovered: core sets every card of which the packs of the other
   sets (not core sets) hold too; the Store does not sell them.
   ============================================================ */
'use strict';
(function (MTG) {
  MTG.packValue = ${JSON.stringify(mult)};
  MTG.coreCovered = new Set(${JSON.stringify(coreCovered)});
})(window.MTG);
`;
    fs.writeFileSync(path.join(SRC, '10d3-packvalue.js'), out);
    console.log('wrote src/10d3-packvalue.js');
  }
})().catch((e) => { console.error(e); process.exit(1); });
