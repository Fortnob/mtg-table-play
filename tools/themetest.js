#!/usr/bin/env node
/* What a Commander deck leans on (src/15b-themes.js), checked without a browser:

   - single cards read as the themes they are, from Scryfall's cards and
     from MTGJSON's, which write the same card differently;
   - whole decks built here around a plan get that plan named, and a deck
     with no plan gets no more than a word or two;
   - a commander's popularity is the better rank of two partners;
   - the Store's printed decks, read ahead (src/10d4-precons.js), were read
     by this version of the themes, and the well-known ones read right.

   node tools/themetest.js     A failure exits non-zero. Run by tools/check.py ('themes'). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { load } = require('./engine');

const MTG = load({ modules: ['00-core.js', '15b-themes.js'] });
const T = MTG.themes;
const BULK = path.join(__dirname, 'oracle-cards.jsonl.gz');

let fails = 0, passes = 0;
const check = (ok, what) => { if (ok) passes++; else { fails++; console.log('FAIL ' + what); } };
const ids = (deck) => T.themes(deck).map(t => t.id);

/* ---- made-up cards, both shapes ---- */
const scry = (name, type_line, oracle_text, keywords) => ({ name, type_line, oracle_text, keywords: keywords || [] });
const json = (name, type, text, keywords) => ({ name, type, text, keywords: keywords || [] });
const score = (id, c) => T.THEMES.find(t => t.id === id).score(T.facts(c));
check(score('lifegain', scry('Healer', 'Creature — Human Cleric', 'Whenever you gain life, put a +1/+1 counter on target creature.')) === 2, 'a lifegain payoff scores 2');
check(score('lifegain', json('Healer', 'Creature — Human Cleric', 'Whenever you gain life, put a +1/+1 counter on target creature.')) === 2, 'the same card read from MTGJSON scores the same');
check(score('lifegain', scry('Bear', 'Creature — Bear', '')) === 0, 'a vanilla bear gains no life');
check(score('tokens', scry('Treasure Maker', 'Sorcery', 'Create two Treasure tokens.')) === 0, 'Treasure tokens are not a token deck');
check(score('tokens', scry('Raise the Alarm', 'Instant', 'Create two 1/1 white Soldier creature tokens.')) === 1, 'Soldier tokens are');
check(score('storm', scry('Grapeshot', 'Sorcery', 'Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)', ['Storm'])) === 1, 'storm is storm');
check(score('counters', scry('Elf', 'Creature — Elf', 'When Llanowar Elves enters, put a +1/+1 counter on it.')) === 1, '+1/+1 counter');
check(score('recursion', scry('Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to your hand.')) === 1, 'Raise Dead is recursion');
// reminder text says what a keyword does, not what the deck does
check(score('storm', scry('Lifelinker', 'Creature — Cat', 'Lifelink (Damage dealt by this creature also causes you to gain that much life. Copy target spell.)')) === 0, 'reminder text is not read');
// a card named for what it is not: its own name is read as "this"
check(!/zombie/.test(T.facts(scry('Zombie Master', 'Creature — Wizard', 'When Zombie Master enters, draw a card.')).text), 'a card\'s own name is not read as its words');

// lands entering is Landfall; more lands a turn is something else, and named so
check(score('landfall', scry('Lotus Cobra', 'Creature — Snake', 'Landfall — Whenever a land you control enters, add one mana of any color.', ['Landfall'])) === 1, 'landfall is Landfall');
check(score('landdrops', scry('Lotus Cobra', 'Creature — Snake', 'Landfall — Whenever a land you control enters, add one mana of any color.', ['Landfall'])) === 0, 'landfall is not an extra land drop');
check(score('landdrops', scry('Azusa', 'Legendary Creature — Human Monk', 'You may play two additional lands on each of your turns.')) === 1, 'Azusa is extra land drops');
check(score('grouphug', scry('Howling Mine', 'Artifact', 'At the beginning of each player\'s draw step, if Howling Mine is untapped, that player draws an additional card.')) === 1, 'Howling Mine is group hug');
check(score('extraturns', scry('Time Warp', 'Sorcery', 'Target player takes an extra turn after this one.')) === 1, 'Time Warp is an extra turn');
check(score('superfriends', scry('Guardian', 'Instant', 'Creatures and planeswalkers you control gain indestructible until end of turn.')) === 0, 'protecting planeswalkers is not Superfriends');
check(T.identity([{ color_identity: ['G', 'W'] }, { colorIdentity: ['U'] }]) === 'WUG' && T.identity([{ color_identity: [] }]) === '', 'colour identity in WUBRG order, from either source');

/* ---- popularity ---- */
check(T.rank([{ edhrec_rank: 900 }, { edhrec_rank: 120 }]) === 120, 'partners: the better rank');
check(T.rank([{ edhrecRank: 55 }]) === 55, 'MTGJSON\'s rank is read too');
check(T.rank([{ name: 'Unranked' }]) === Infinity, 'no rank: Infinity');
check(T.plural('Elf') === 'Elves' && T.plural('Sphinx') === 'Sphinxes' && T.plural('Zombie') === 'Zombies' && T.plural('Faerie') === 'Faeries', 'creature types in the plural');

/* ---- whole decks, from the bulk file ---- */
const cards = new Map();
if (fs.existsSync(BULK)) {
  for (const ln of zlib.gunzipSync(fs.readFileSync(BULK)).toString('utf8').split('\n')) {
    if (!ln) continue;
    const c = JSON.parse(ln);
    if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'double_faced_token') continue;
    if (!cards.has(c.name)) cards.set(c.name, c);
    const front = c.name.split(' // ')[0];
    if (!cards.has(front)) cards.set(front, c);
  }
}
const card = (n) => { const c = cards.get(n); if (!c) throw new Error('not in the bulk file: ' + n); return c; };
const deck = (cmd, names, lands) => ({
  commanders: [].concat(cmd).map(card),
  main: names.map(n => ({ card: card(n), qty: 1 })).concat([{ card: card(lands || 'Forest'), qty: 36 }]),
});
const STAPLES = ['Sol Ring', 'Arcane Signet', 'Command Tower', 'Swiftfoot Boots', 'Lightning Greaves'];

if (cards.size) {
  const counters = deck('Atraxa, Praetors\' Voice', STAPLES.concat(['Hardened Scales', 'Winding Constrictor', 'Corpsejack Menace', 'Doubling Season',
    'Inexorable Tide', 'Evolution Sage', 'Flux Channeler', 'Contagion Engine', 'Ozolith, the Shattered Spire', 'Branching Evolution',
    'Rishkar, Peema Renegade', 'Experiment One', 'Managorger Hydra', 'Forgotten Ancient', 'Walking Ballista', 'Kalonian Hydra',
    'Avenger of Zendikar', 'Cathars\' Crusade', 'Master Biomancer', 'Crystalline Crawler', 'Grumgully, the Generous']));
  check(ids(counters).includes('counters'), 'an Atraxa counters deck: +1/+1 counters (' + T.tags(counters).join(' · ') + ')');

  const elves = deck('Lathril, Blade of the Elves', STAPLES.concat(['Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Elvish Archdruid',
    'Priest of Titania', 'Elvish Warmaster', 'Imperious Perfect', 'Dwynen, Gilt-Leaf Daen', 'Elvish Champion', 'Ezuri, Renegade Leader',
    'Elvish Visionary', 'Elvish Clancaller', 'Leaf-Crowned Visionary', 'Marwyn, the Nurturer', 'Wirewood Symbiote', 'Timberwatch Elf',
    'Heedless One', 'Elvish Harbinger', 'Lys Alana Huntmaster', 'Elf Replica', 'Allosaurus Shepherd']));
  check(ids(elves).includes('type:Elf'), 'an elf deck: Elves (' + T.tags(elves).join(' · ') + ')');

  const spells = deck('Kess, Dissident Mage', STAPLES.concat(['Brainstorm', 'Ponder', 'Preordain', 'Opt', 'Consider', 'Counterspell', 'Lightning Bolt',
    'Chain Lightning', 'Fact or Fiction', 'Thrill of Possibility', 'Faithless Looting', 'Frantic Search', 'Gitaxian Probe', 'Serum Visions',
    'Impulse', 'Mana Leak', 'Negate', 'Young Pyromancer', 'Talrand, Sky Summoner', 'Guttersnipe', 'Murmuring Mystic', 'Archmage Emeritus',
    'Electrostatic Field', 'Firebrand Archer', 'Arcane Denial', 'Pongify', 'Rapid Hybridization', 'Swan Song', 'Lightning Strike']), 'Island');
  check(ids(spells).includes('spells'), 'a spellslinger deck: Instants & sorceries (' + T.tags(spells).join(' · ') + ')');

  const plain = deck('Ghalta, Primal Hunger', STAPLES.concat(['Grizzly Bears', 'Runeclaw Bear', 'Craw Wurm', 'Colossal Dreadmaw', 'Gigantosaurus']));
  check(T.tags(plain).length <= 2, 'a pile of vanilla creatures: no more than two words (' + T.tags(plain).join(' · ') + ')');
  // asked again, the same answer from the cache
  check(T.themes(counters) === T.themes(counters), 'a deck is read once');

  // every card read once, so a pattern that throws shows up here
  let threw = 0;
  for (const c of cards.values()) { try { for (const t of T.THEMES) t.score(T.facts(c)); } catch (e) { threw++; } }
  check(!threw, `every card in the bulk file reads without an exception (${threw} threw)`);
} else console.log('no tools/oracle-cards.jsonl.gz (python tools/fetch-bulk.py): the whole-deck checks are skipped');

/* ---- the Store's decks, read ahead ---- */
const ahead = { MTG: {} };
ahead.window = ahead;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', '10d4-precons.js'), 'utf8'), ahead);
const P = ahead.MTG.preconIndex;
check(P && P.v === T.VERSION, `src/10d4-precons.js was read by themes version ${P && P.v}, not ${T.VERSION}: run node tools/precons.js`);
const decks = P ? Object.entries(P.decks) : [];
check(decks.length > 150, `${decks.length} printed Commander decks read ahead`);
check(decks.every(([, r]) => Array.isArray(r[1]) && r[1].length && r[1].every(c => c[0] && /^[0-9a-f-]{36}$/.test(c[1] || ''))), 'every printed deck has a commander with a Scryfall id');
check(decks.filter(([, r]) => r[2].length).length >= decks.length * 0.95, 'nearly every printed deck has a theme');
check(decks.every(([, r]) => typeof r[3] === 'string' && /^W?U?B?R?G?$/.test(r[3])), 'every printed deck has its colour identity, in WUBRG order');
check(decks.filter(([, r]) => r[0] > 0).length >= decks.length * 0.9, 'nearly every printed deck has its commander\'s place on EDHREC\'s list');
// a deck printed again is shown once, as its latest printing
const listed = decks.map(([file, r]) => ({ file, name: r[5], date: r[6] }));
check(listed.every(d => d.name && /^\d{4}-\d\d-\d\d$/.test(d.date || '')), 'every printed deck has its name and release date');
const once = T.distinct(listed);
check(new Set(once.map(d => d.name.toLowerCase())).size === once.length, 'no two decks listed share a name');
const shown = new Set(once.map(d => d.file));
check(shown.has('BuiltFromScratch_CM2') && !shown.has('BuiltFromScratch_C14') && shown.has('BreedLethality_CM2') && !shown.has('BreedLethality_C16'),
  'Built From Scratch and Breed Lethality: the Anthology printings kept, the first printings folded');
check(shown.has('GuidedByNature_CMA') && !shown.has('GuidedByNature_C14'), 'names the same but for the case of a letter are one deck');
const twins = T.distinct([{ name: 'Same', date: '2019-01-01' }, { name: 'Same', date: '2020-01-01' }, { name: 'Other', date: '2026-01-01' }]);
check(twins.length === 2 && twins[0].date === '2020-01-01', 'the latest printing kept, in the order the list had');
const tagsOf = (file) => ((P && P.decks[file]) || [0, [], []])[2];
for (const [file, tag] of [['DraconicDomination_C17', 'Dragons'], ['TramplesaurusRex_FDC', 'Dinosaurs'], ['ElvenEmpire_KHC', 'Elves'],
  ['ArcaneWizardry_C17', 'Instants & sorceries'], ['VampiricBloodlust_C17', 'Vampires']])
  check(tagsOf(file).includes(tag), `${file}: ${tag} (${tagsOf(file).join(' · ')})`);

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
