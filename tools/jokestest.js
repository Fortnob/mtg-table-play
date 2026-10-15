#!/usr/bin/env node
/* Joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes): what the Scryfall client
   asks, and what comes back of what was asked for by name. No network: Scryfall is a stub that records each
   request and answers with cards made to look like its own. (The pool against the bulk file, and the card
   database, are in tools/cardtests/52-no-jokes.js.)

   node tools/jokestest.js

   A failure exits non-zero. Run by tools/check.py ('jokes'). */
'use strict';
process.env.OFFLINE = '1';
const { load } = require('./engine');

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };

const MODULES = ['00-core.js', '01-audio.js', '02-scryfall.js', '02a-carddb.js', '18-scripts.js', '19-cardlib.js', '03-oracle.js',
  '04-formats.js', '05-decklist.js', '05a-decklink.js', '10c-economy.js'];
const warn = console.warn; console.warn = () => {};
const MTG = load({ modules: MODULES });
console.warn = warn;
const S = MTG.scry;
const Q = MTG.jokes.QUERY;

/* ---- Scryfall, a stub ---- */
const asked = [];
const card = (name, set, more) => Object.assign({
  object: 'card', id: name.replace(/\W+/g, '-').toLowerCase() + '-' + set, oracle_id: 'o-' + name, name, set, set_type: 'expansion',
  collector_number: '1', type_line: 'Creature — Dog', layout: 'normal', legalities: { commander: 'legal', vintage: 'legal' },
  border_color: 'black', rarity: 'rare', lang: 'en', games: ['paper'],
}, more || {});
const COMET = card('Comet, Stellar Pup', 'unf', { set_type: 'funny', oracle_id: 'e7c67480-1816-4071-9eab-a1d1b535a344' });
const BELEREN = card('Space Beleren', 'plst', { set_type: 'masters', oracle_id: 'cfca44cb-8ca5-4ebb-bd5c-b621eca41944' });
const BEARS = card('Grizzly Bears', 'm21');
const answer = (url, body) => {
  if (/\/cards\/search/.test(url)) {
    // a search for a name: Scryfall's answer before it was told to leave the jokes out, the joke among it
    return { object: 'list', has_more: false, data: [COMET, BELEREN, BEARS] };
  }
  if (/\/cards\/random/.test(url)) return BEARS;
  if (/\/cards\/named/.test(url)) return /Comet/.test(url) ? COMET : BEARS;
  if (/\/cards\/collection/.test(url)) {
    const ids = (body && body.identifiers) || [];
    return { data: ids.map(i => [COMET, BELEREN, BEARS].find(c => c.name === i.name || c.id === i.id)).filter(Boolean), not_found: [] };
  }
  if (/\/sets$/.test(url)) return { data: [
    { code: 'unf', name: 'Unfinity', set_type: 'funny', card_count: 600, released_at: '2022-10-07' },
    { code: 'sunf', name: 'Unfinity Sticker Sheets', set_type: 'funny', parent_set_code: 'unf', card_count: 48, released_at: '2022-10-07' },
    { code: 'tunf', name: 'Unfinity Tokens', set_type: 'token', parent_set_code: 'unf', card_count: 14, released_at: '2022-10-07' },
    { code: 'cmb2', name: 'Mystery Booster Playtest Cards 2021', set_type: 'funny', card_count: 121, released_at: '2021-08-20' },
    { code: 'dmu', name: 'Dominaria United', set_type: 'expansion', card_count: 400, released_at: '2022-09-09' },
  ] };
  return null;
};
S._fetch = async (path, opts) => {
  asked.push(decodeURIComponent(String(path)).replace(/\+/g, ' '));
  return answer(path, opts && opts.body);
};
const last = () => asked[asked.length - 1] || '';

(async () => {
  /* ---- every question Scryfall is asked leaves the jokes out ---- */
  const found = await S.search('t:goblin unique:prints', { live: true, force: true });
  check(last().includes('(t:goblin) ' + Q), 'a search asks without the jokes: ' + last());
  check(/unique:prints$/.test(last().split('&')[0]) || last().includes(Q + ' unique:prints'), 'the words that show it outside the brackets');
  check(found.map(c => c.name).join() === 'Grizzly Bears', 'and what comes back is checked again: ' + found.map(c => c.name).join());

  const pager = S.pager('name:/comet/', { live: true });
  const page = await pager.next();
  check(last().includes(Q), 'the deck builder\'s search too: ' + last());
  check(!page.some(c => MTG.jokes.isCard(c)), 'and no joke card on its page');

  await S.random('t:dog');
  check(last().includes('(t:dog) ' + Q), 'a random card: ' + last());
  await S.random();
  check(last().includes(Q), 'a random card of any kind: ' + last());

  const names = await S.autocomplete('Comet');
  check(last().includes(Q), 'names suggested while typing come from a search that leaves them out: ' + last());
  check(!names.includes('Comet, Stellar Pup'), 'Comet is not suggested');

  const sets = await S.sets({ force: true });
  check(sets.map(s => s.code).join() === 'dmu', 'no joke set to draft, open or sell: ' + sets.map(s => s.code).join());

  /* ---- what is asked for by name or id ---- */
  const held = await S.byName('Comet, Stellar Pup');
  check(held && held.name === 'Comet, Stellar Pup', 'a deck that holds one still finds it, to show it marked');

  const imp = await MTG.decklist.importDeck('1 Comet, Stellar Pup\n1 Space Beleren\n58 Grizzly Bears', 'vintage');
  check(imp.missing.map(m => m.name).sort().join() === 'Comet, Stellar Pup,Space Beleren', 'an imported list: the jokes are missing, like any card not found: ' + JSON.stringify(imp.missing));
  check(imp.warnings.some(w => /Unfinity cards aren’t in this game/.test(w)), 'and the import says why: ' + imp.warnings.join(' | '));
  check(!imp.deck.main.some(e => MTG.jokes.isCard(e.card)), 'none in the deck');

  const cube = await MTG.decklist.importCube('Comet, Stellar Pup\nGrizzly Bears');
  check(cube.missing.join() === 'Comet, Stellar Pup' && cube.cards.length === 1, 'nor in a cube');

  /* ---- the collection ---- */
  const E = MTG.economy;
  check(E.addCard(COMET, 1).isNew === false && E.owned('Comet, Stellar Pup') === 0, 'the collection takes none in');
  check(E.craft(COMET).ok === false, 'nor crafts one');
  check(E.missingFor({ main: [{ card: COMET, qty: 1 }, { card: BEARS, qty: 1 }] }).map(m => m.name).join() === 'Grizzly Bears',
    'a deck\'s missing cards leave a held joke out (no wildcard spent on it)');

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e)); process.exit(1); });
