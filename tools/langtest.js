/* Card pictures in another language (src/02b-cardlang.js), headless.

   Loads the Scryfall client with a Scryfall of its own making: a few
   printings in Japanese, one card printed in Japanese only elsewhere,
   one never translated, and a connection that drops. Checks that English
   asks nothing at all, that a translation is found, kept and swapped in,
   that a missing one falls back to English without a word, and that the
   rules text never changes.

     node tools/langtest.js */
'use strict';
const { load } = require('./engine');

const MTG = load({ modules: ['00-core.js', '02-scryfall.js', '02b-cardlang.js'] });
const scry = MTG.scry;

const img = (tag) => ({ small: `https://cards.scryfall.io/small/${tag}.jpg`, normal: `https://cards.scryfall.io/normal/${tag}.jpg`,
  large: `https://cards.scryfall.io/large/${tag}.jpg`, png: `https://cards.scryfall.io/png/${tag}.png`, art_crop: `https://cards.scryfall.io/art_crop/${tag}.jpg` });
const card = (name, set, cn, extra) => Object.assign({ id: name + '-' + set, oracle_id: 'or-' + name, name, set, collector_number: cn,
  lang: 'en', layout: 'normal', oracle_text: name + ' does a thing.', illustration_id: 'ill-' + name, image_uris: img('en-' + name) }, extra || {});

/* What this Scryfall knows. */
const BOLT = card('Bolt', 'neo', '1');
const BEARS = card('Bears', 'm10', '2', { illustration_id: 'ill-bears-old' });
const NEVER = card('Never', 'xyz', '3');
const DROP = card('Drop', 'net', '4');
const FACES = card('Faces', 'mid', '5', { layout: 'transform', image_uris: undefined,
  card_faces: [{ name: 'Front', image_uris: img('en-front') }, { name: 'Back', image_uris: img('en-back') }] });
const BLANK = card('Blank', 'blk', '6');
const TOKEN = Object.assign(card('Soldier', 'tkn', '0'), { _isToken: true });
const routes = new Map([
  ['/cards/neo/1/ja', Object.assign({}, BOLT, { lang: 'ja', image_uris: img('ja-bolt'), printed_text: 'ボルト' })],
  ['/cards/mid/5/ja', Object.assign({}, FACES, { lang: 'ja', card_faces: [{ image_uris: img('ja-front') }, { image_uris: img('ja-back') }] })],
  ['/cards/blk/6/ja', Object.assign({}, BLANK, { lang: 'ja', image_status: 'placeholder', image_uris: img('ja-placeholder') })],
]);
const searches = new Map([
  ['or-Bears', [Object.assign({}, BEARS, { lang: 'ja', set: 'new', illustration_id: 'ill-bears-new', image_uris: img('ja-bears-new') }),
    Object.assign({}, BEARS, { lang: 'ja', set: 'old', illustration_id: 'ill-bears-old', image_uris: img('ja-bears-old') })]],
]);
const asked = [];
let offline = false;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  asked.push(u.pathname + u.search);
  if (offline || u.pathname.startsWith('/cards/net/')) throw new TypeError('Failed to fetch');
  const res = (body) => ({ ok: !!body, status: body ? 200 : 404, statusText: body ? 'OK' : 'Not Found', json: async () => body });
  if (u.pathname === '/cards/search') {
    const m = /oracleid:(\S+) lang:(\S+)/.exec(u.searchParams.get('q') || '');
    const list = m && m[2] === 'ja' ? searches.get(m[1]) : null;
    return res(list ? { data: list, has_more: false } : null);
  }
  return res(routes.get(u.pathname) || null);
};

let pass = 0, fail = 0;
function check(what, ok, detail) {
  if (ok) pass++; else { fail++; console.log('FAIL ' + what + (detail ? ': ' + detail : '')); }
}
const settle = () => new Promise(r => setTimeout(r, 60));
async function found(c) {
  scry.imageUrl(c, 'normal', 0);
  for (let i = 0; i < 50 && scry.cardLang && scry.cardLang.waiting.size; i++) await settle();
  await settle();
}

(async () => {
  let told = 0;
  MTG.bus.on('scryfall:images', () => { told++; });

  // English: nothing asked, nothing changed
  check('English is the default', MTG.cardLang.current === 'en' && scry.cardLang === null);
  check('English pictures are the card\'s own', scry.imageUrl(BOLT, 'normal', 0) === BOLT.image_uris.normal);
  check('English asks Scryfall nothing', asked.length === 0, asked.join(', '));

  MTG.setSetting('cardLang', 'ja');
  check('Japanese switches the lookups on', MTG.cardLang.current === 'ja' && !!scry.cardLang);

  // the same printing, in Japanese
  check('the English picture while the lookup is out', scry.imageUrl(BOLT, 'normal', 0) === BOLT.image_uris.normal);
  await found(BOLT);
  check('the printing was asked for by set, number and language', asked.includes('/cards/neo/1/ja'), asked.join(', '));
  check('the Japanese picture once found', scry.imageUrl(BOLT, 'normal', 0) === img('ja-bolt').normal);
  check('every printed size follows', scry.imageUrl(BOLT, 'large', 0) === img('ja-bolt').large && scry.imageUrl(BOLT, 'small', 0) === img('ja-bolt').small);
  check('the art crop stays (the same painting)', scry.imageUrl(BOLT, 'art_crop', 0) === BOLT.image_uris.art_crop);
  check('the screens were told to look again', told > 0);
  check('the rules text is untouched', BOLT.oracle_text === 'Bolt does a thing.' && BOLT.lang === 'en');
  const n = asked.length;
  scry.imageUrl(BOLT, 'normal', 0);
  await settle();
  check('found once, asked once', asked.length === n);

  // no Japanese of this printing: another one, with the same painting where there is one
  await found(BEARS);
  check('another printing was searched for', asked.some(a => a.startsWith('/cards/search')), asked.join(', '));
  check('the printing with the same painting wins', scry.imageUrl(BEARS, 'normal', 0) === img('ja-bears-old').normal, scry.imageUrl(BEARS, 'normal', 0));

  // never translated: English, quietly, and not asked again
  await found(NEVER);
  check('no translation leaves the English picture', scry.imageUrl(NEVER, 'normal', 0) === NEVER.image_uris.normal);
  const m2 = asked.length;
  scry.imageUrl(NEVER, 'normal', 0);
  await settle();
  check('a missing translation is remembered', asked.length === m2);

  // a placeholder picture is no picture
  await found(BLANK);
  check('a placeholder is not used', scry.imageUrl(BLANK, 'normal', 0) === BLANK.image_uris.normal);

  // a card with a face each
  await found(FACES);
  check('each face its own picture', scry.imageUrl(FACES, 'normal', 0) === img('ja-front').normal && scry.imageUrl(FACES, 'normal', 1) === img('ja-back').normal);

  // tokens have no printings to look up
  const m3 = asked.length;
  scry.imageUrl(TOKEN, 'normal', 0);
  await settle();
  check('tokens are not looked up', asked.length === m3);

  // a dropped connection: English, without telling anybody Scryfall is down, and not asked again at once
  let offlineSaid = 0;
  MTG.bus.on('scryfall:offline', () => { offlineSaid++; });
  await found(DROP);
  check('a failed lookup leaves the English picture', scry.imageUrl(DROP, 'normal', 0) === DROP.image_uris.normal);
  check('a failed lookup says nothing', offlineSaid === 0);
  const m4 = asked.length;
  scry.imageUrl(DROP, 'normal', 0);
  await settle();
  check('a failed lookup waits before trying again', asked.length === m4);

  // a card already printed in Japanese is its own picture
  const own = Object.assign({}, BOLT, { id: 'own', lang: 'ja', image_uris: img('ja-own') });
  check('a Japanese printing shows itself', scry.imageUrl(own, 'normal', 0) === img('ja-own').normal);

  // a picture found waits for whatever drew the English one
  MTG.setSetting('cardLang', 'fr');
  let swapped = false;
  routes.set('/cards/neo/1/fr', Object.assign({}, BOLT, { lang: 'fr', image_uris: img('fr-bolt') }));
  scry.imageUrl(BOLT, 'normal', 0);
  scry.cardLang.whenFound(BOLT, () => { swapped = true; });
  await found(BOLT);
  check('a picture drawn in English is told when the French arrives', swapped);
  check('each language is kept apart', scry.imageUrl(BOLT, 'normal', 0) === img('fr-bolt').normal);

  // and back to English
  MTG.setSetting('cardLang', 'en');
  check('English again turns the lookups off', scry.cardLang === null && scry.imageUrl(BOLT, 'normal', 0) === BOLT.image_uris.normal);

  console.log(`card language: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
