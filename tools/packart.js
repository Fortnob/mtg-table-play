#!/usr/bin/env node
/* The art on the front of every set's packs, chosen ahead of time:
   src/10d0-packart.js. For each set that could be sold, its best-known
   rares and mythics by EDHREC rank, the cards new to it first (a reprint
   set, a Masters set, has its reprints), one per illustration, never a
   numbered chase printing, a promo or an Alchemy rebalance; the store
   then gives each pack the first of its set's that no other pack or deck
   wears (claimArt in src/10d-ui-store.js). With this the shelf needs no
   searches at all; a set newer than the file is still looked up live.
   A few sets wear a card chosen by hand (FIRST), reserved for them before
   any other pack picks.

   It also counts each set's special printings (borderless, showcase,
   extended and full art, basics aside): a set with enough of them to fill
   Collector Boosters is offered them (MTG.collectorSets).

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
/* A set's face chosen by hand, first among its pictures and kept for it
   before any other pack picks; with where its subject is in the art crop
   (percent across and down), for a tall pack to be centred on it. */
const FIRST = {
  lea: { name: 'Black Lotus', focus: [66, 52] },          // the flower
  leb: { name: 'Ancestral Recall', focus: [75, 56] },     // the scholar's face
  /* The classic sets wear the card they are remembered by: claimed newest
     first, the reprint sets that came after would otherwise take them. */
  '2ed': { name: 'Shivan Dragon' },
  '3ed': { name: 'Serra Angel' },
  '4ed': { name: 'Sengir Vampire' },
  arn: { name: 'Juzám Djinn' },
  atq: { name: 'Mishra\'s Workshop' },
  leg: { name: 'Mana Drain' },
  fem: { name: 'Hymn to Tourach' },
  ice: { name: 'Necropotence' },
  chr: { name: 'Nicol Bolas' },
  hml: { name: 'Baron Sengir' },
  all: { name: 'Force of Will' },
  wth: { name: 'Null Rod' },
  tmp: { name: 'Wasteland' },
  sth: { name: 'Mox Diamond' },
  exo: { name: 'Survival of the Fittest' },
  usg: { name: 'Gaea\'s Cradle' },
};
// special printings enough for Collector Boosters: two variant slots of rares and three of uncommons need some choice
const COLLECTOR_MIN = 15;
// the same as NOT_A_PULL in src/10d-ui-store.js
const NOT_A_PULL = new Set(['serialized', 'headliner', 'doublerainbow', 'gleaminggold',
  'playpromo', 'prerelease', 'promopack', 'buyabox', 'bundle', 'datestamped', 'stamped', 'judgegift', 'league',
  'convention', 'tourney', 'release', 'instore', 'event', 'giftbox', 'setpromo', 'wizardsplaynetwork', 'premiereshop', 'intropack']);
// (not the joke sets, which are not in the game: src/02-scryfall.js, MTG.jokes)
const TYPES = new Set(['expansion', 'core', 'draft_innovation', 'masters', 'eternal', 'commander', 'alchemy', 'starter']);

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

/** How many cards a search finds, from its first page alone. */
async function count(q) {
  const d = await get('/cards/search?' + new URLSearchParams({ q, unique: 'prints' }));
  return d ? (d.total_cards || 0) : 0;
}

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
  const collector = [];
  const focus = {};
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
    if (FIRST[s.code]) {
      const found = await search(`!"${FIRST[s.code].name}" set:${s.code}`, 1);
      take(found);
      if (found[0] && FIRST[s.code].focus) focus[illOf(found[0]).replace(/-/g, '').slice(0, 8)] = FIRST[s.code].focus;
    }
    // the set's own new cards first: a staple reprinted everywhere (Sol Ring, Arcane Signet) says nothing of the set
    take(await search(`set:${s.code} (r:mythic or r:rare) -t:land not:reprint`, 40));
    if (pick.length < PER_SET) take(await search(`set:${s.code} (r:mythic or r:rare) -t:land`, 40));
    if (pick.length < PER_SET) take(await search(`set:${s.code} -t:basic`, 120));
    if (pick.length) map[s.code] = pick.join('');
    const variants = await count(`set:${s.code} (is:extendedart or is:borderless or is:showcase or is:fullart) -t:basic -is:digital lang:en`);
    if (variants >= COLLECTOR_MIN) collector.push(s.code);
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
  /* The sets whose first picture was chosen by hand: kept for them before
     any other pack picks, so a reprint of the same picture cannot take it. */
  MTG.packArtReserved = ${JSON.stringify(Object.keys(FIRST))};
  /* Where the subject is in a picture whose subject is off to one side,
     by illustration (first 8 hex digits): [percent across, percent down]. */
  MTG.artFocus = ${JSON.stringify(focus)};
  /* The sets with special printings enough to fill a Collector Booster
     (${COLLECTOR_MIN} or more borderless, showcase, extended or full-art cards). */
  MTG.collectorSets = new Set(${JSON.stringify(collector.sort().join(','))}.split(','));
})(window.MTG);
`, 'utf8');
  console.log('wrote ' + OUT + ' (' + Object.keys(map).length + ' sets, ' + collector.length + ' with Collector Boosters: ' + collector.sort().join(' ') + ')');
})().catch((e) => { console.error(e); process.exit(1); });
