#!/usr/bin/env node
/* The art on the front of every set's packs, chosen ahead of time:
   src/10d0-packart.js. For each set that could be sold, its best-known
   rares and mythics by EDHREC rank, one per illustration, never a
   numbered chase printing, a promo or an Alchemy rebalance; the store
   then gives each pack the first of its set's that no other pack or deck
   wears (claimArt in src/10d-ui-store.js). With this the shelf needs no
   searches at all; a set newer than the file is still looked up live.

     node tools/packart.js            (about five minutes: Scryfall's
                                       searches are held to two a second)

   Rerun after a new set comes out. */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', '10d0-packart.js');
const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'mtg-table-packart/1.0', Accept: 'application/json' };
const PER_SET = 6;
const GAP = 600;
// the same as NOT_A_PULL in src/10d-ui-store.js
const NOT_A_PULL = new Set(['serialized', 'headliner', 'doublerainbow', 'gleaminggold',
  'playpromo', 'prerelease', 'promopack', 'buyabox', 'bundle', 'datestamped', 'stamped', 'judgegift', 'league',
  'convention', 'tourney', 'release', 'instore', 'event', 'giftbox', 'setpromo', 'wizardsplaynetwork', 'premiereshop', 'intropack']);
const TYPES = new Set(['expansion', 'core', 'draft_innovation', 'masters', 'eternal', 'commander', 'alchemy', 'funny', 'starter']);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let last = 0;
async function get(url) {
  for (let tries = 0; tries < 4; tries++) {
    const wait = GAP - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url.startsWith('http') ? url : API + url, { headers: HEADERS });
    if (res.status === 404) return null;
    if (res.status === 429) { await sleep(31000); continue; }
    if (!res.ok) { await sleep(2000); continue; }
    return res.json();
  }
  throw new Error('Scryfall would not answer ' + url);
}

const illOf = (c) => c.illustration_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].illustration_id) || '';
const usable = (c) => c && !(c.promo_types || []).some(t => NOT_A_PULL.has(t)) && !/z$/i.test(String(c.collector_number || '')) &&
  !/^A-/.test(c.name || '') && !!illOf(c) && !!(c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris));

async function search(q, max) {
  const out = [];
  let url = '/cards/search?' + new URLSearchParams({ q, order: 'edhrec', unique: 'art' });
  while (url && out.length < max) {
    const d = await get(url);
    if (!d) break;
    out.push(...(d.data || []));
    url = d.has_more ? d.next_page : null;
  }
  return out.slice(0, max);
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const sets = ((await get('/sets')).data || []).filter(s => TYPES.has(s.set_type) && s.card_count >= 60 && s.released_at && s.released_at <= today);
  console.log(sets.length + ' sets');
  const map = {};
  let n = 0;
  for (const s of sets) {
    const pick = [];
    const seen = new Set();
    const take = (list) => {
      for (const c of list) {
        if (pick.length >= PER_SET || !usable(c)) continue;
        const ill = illOf(c);
        if (seen.has(ill)) continue;
        seen.add(ill);
        pick.push(c.id.replace(/-/g, '') + ill.replace(/-/g, '').slice(0, 8));
      }
    };
    take(await search(`set:${s.code} (r:mythic or r:rare) -t:land`, 40));
    if (pick.length < PER_SET) take(await search(`set:${s.code} -t:basic`, 120));
    if (pick.length) map[s.code] = pick.join('');
    if (++n % 25 === 0) console.log(`${n}/${sets.length}`);
  }
  const lines = Object.keys(map).sort().map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`);
  fs.writeFileSync(OUT, `/* ============================================================
   10d0-packart.js - the art each set's packs may wear, chosen ahead of time

   Written by tools/packart.js (rerun it after a new set comes out); read
   by setArt in src/10d-ui-store.js. For each set, up to ${PER_SET} pictures in
   order of preference: its best-known rares and mythics, one per
   illustration. Each is 40 hex digits, the Scryfall card id (32, without
   its dashes) and the first 8 of its illustration id.
   ============================================================ */
'use strict';
(function (MTG) {
  MTG.packArt = {
${lines.join('\n')}
  };
})(window.MTG);
`, 'utf8');
  console.log('wrote ' + OUT + ' (' + Object.keys(map).length + ' sets)');
})().catch((e) => { console.error(e); process.exit(1); });
