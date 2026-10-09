/* Which words of an automated card does the reading never use?

   node tools/ablate.js [--top 20000] [--kind other,upto,...] [--show 6] [--out file.json]

   A card counts as automated when every line found a rule. That says
   nothing about whether the rule used every word: a rule whose pattern
   swallows "another", "you control" or "until end of turn" without acting
   on it makes a card that reads cleanly and plays wrongly. So for every
   automated card this takes one word or clause out at a time (a whole
   sentence, a condition, a qualifier, a number changed by one) and reads
   the card again. If the card still reads as automated and the reading is
   exactly the same, those words were never read, and the card is listed
   under that kind of word, most-played first. Not every hit is a fault
   (some words really are redundant), but every fault of this kind is a hit. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const top = +arg('top', 100000), show = +arg('show', 6), out = arg('out', null);
const kinds = arg('kind', null) ? new Set(arg('kind').split(',')) : null;
process.env.OFFLINE = '1';
const w = console.warn; console.warn = () => {};
const MTG = load();

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem' || c.layout === 'double_faced_token') continue;
  if (c.set_type === 'funny' || c.set_type === 'memorabilia') continue;
  if (!Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

/* The reading, without the words themselves: two readings that differ
   only in the text they quote are the same reading. */
const DROP = new Set(['text', 'raw', 'oracleText', 'oracleTextParsed', 'fingerprint', 'name', 'grantText', 'line']);
const sig = (a) => JSON.stringify({ ab: a.abilities, mana: a.manaAbilities, rest: Object.fromEntries(Object.entries(a).filter(([k]) => !['abilities', 'manaAbilities'].includes(k))) },
  (k, v) => (DROP.has(k) ? undefined : v));

const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const COLORS = ['white', 'blue', 'black', 'red', 'green'];
const TYPES = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'instant', 'sorcery'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Each kind of words, and how to take one occurrence of them out. A
   function gets the text and gives back the variants, each with the words
   it touched. */
function* regexKind(text, re, repl) {
  // words inside a quoted ability are read when the ability is handed out, not here
  const quoted = [];
  for (const q of text.matchAll(/"[^"]*"/g)) quoted.push([q.index, q.index + q[0].length]);
  for (const m of text.matchAll(re)) {
    if (quoted.some(([a, b]) => m.index > a && m.index < b)) continue;
    const r = typeof repl === 'function' ? repl(m) : repl;
    if (r == null) continue;
    let t = text.slice(0, m.index) + r + text.slice(m.index + m[0].length);
    // a sentence that now starts in lower case starts in upper case
    t = t.replace(/(^|[.:•—]\s+|\n)([a-z])/g, (x, a, b) => a + b.toUpperCase());
    yield { text: t, at: m.index, words: m[0] };
  }
}
const KINDS = {
  sentence: function* (text) {
    // a whole sentence out, where the line has more than one
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const ss = MTG.oracle.splitSentences(lines[li]);
      if (ss.length < 2) continue;
      for (let si = 0; si < ss.length; si++) {
        // a cost line keeps its cost: dropping the first sentence after the colon is a different line
        const keep = ss.filter((x, j) => j !== si);
        if (si === 0 && /:/.test(ss[0]) && !/^[^:]*"/.test(ss[0])) {
          const head = ss[0].slice(0, ss[0].indexOf(':') + 1);
          keep[0] = head + ' ' + keep[0];
        }
        const nl = lines.slice(); nl[li] = keep.join(' ');
        yield { text: nl.join('\n'), at: 0, words: ss[si] };
      }
    }
  },
  line: function* (text) {
    // a whole line out, where the card has more than one and it is not a keyword line
    const lines = text.split('\n');
    if (lines.length < 2) return;
    for (let li = 0; li < lines.length; li++) {
      if (!/\s/.test(lines[li]) || lines[li].split(/\s+/).length < 4) continue;
      yield { text: lines.filter((x, j) => j !== li).join('\n'), at: 0, words: lines[li] };
    }
  },
  other: (t) => regexKind(t, /\b(another|other) /gi, (m) => (/another/i.test(m[1]) ? 'a ' : '')),
  upto: (t) => regexKind(t, /\bup to (one|two|three|four|five|X) /gi, (m) => (/one/i.test(m[1]) ? '' : m[1] + ' ')),
  youcontrol: (t) => regexKind(t, / you (?:control|own)\b/g, ''),
  oppcontrol: (t) => regexKind(t, / (?:an opponent controls|your opponents control|you don'?t control|that player controls|target player controls|defending player controls)\b/g, ''),
  eot: (t) => regexKind(t, /,? until end of turn|^Until end of turn, /gm, ''),
  thisturn: (t) => regexKind(t, / this turn\b/g, ''),
  may: (t) => regexKind(t, /\b(?:you )?may (?!have\b)/gi, ''),
  non: (t) => regexKind(t, /\bnon-?(token|land|creature|artifact|legendary|basic|black|white|blue|red|green|enchantment|Human|snow|[A-Z][a-z]+) ?/g, ''),
  tapped: (t) => regexKind(t, /(?<=\b(?:enters|battlefield|tokens?)) tapped\b|\btapped (?=and attacking)/g, ''),
  untapped: (t) => regexKind(t, /\b(?:untapped|tapped|attacking|blocking|attacking or blocking|blocked|unblocked) (?=creatures?\b|permanents?\b|artifacts?\b|lands?\b)/g, ''),
  number: (t) => regexKind(t, /\b(one|two|three|four|five|six|seven|eight|nine)\b|(?<![{/+-])\b(\d+)\b(?![}/])|([+-])(\d+)\/([+-])(\d+)/gi, (m) => {
    if (m[3]) return m[3] + (+m[4] + 1) + '/' + m[5] + m[6];
    if (m[2]) return String(+m[2] + 1);
    const i = NUMW.indexOf(m[1].toLowerCase());
    const r = NUMW[i + 1];
    return m[1][0] === m[1][0].toUpperCase() ? cap(r) : r;
  }),
  manaNum: (t) => regexKind(t, /\{(\d+)\}/g, (m) => '{' + (+m[1] + 1) + '}'),
  color: (t) => regexKind(t, /\b(white|blue|black|red|green)\b/gi, (m) => COLORS[(COLORS.indexOf(m[1].toLowerCase()) + 1) % 5]),
  // (not "this creature": a card calling itself by its type means itself whatever the type)
  type: (t) => regexKind(t, /(?<!\b[Tt]his |\benchanted |\bequipped )\b(creature|artifact|enchantment|land|planeswalker|instant|sorcery)\b/g, (m) => TYPES[(TYPES.indexOf(m[1]) + 1) % TYPES.length]),
  condition: (t) => regexKind(t, /\b[Ii]f [^,.:"]+, |,? (?:only )?if [^,.:"]+(?=\.)|,? as long as [^,.:"]+|^As long as [^,]+, |,? unless [^,.:"]+|,? during (?:your|each opponent'?s|an opponent'?s) turn|^During (?:your|each opponent'?s) turn, /gm, ''),
  opponent: (t) => regexKind(t, /\b(each opponent|target opponent|an opponent|your opponents|opponents)\b/gi, (m) => ({ 'each opponent': 'each player', 'target opponent': 'target player', 'an opponent': 'a player', 'your opponents': 'players', 'opponents': 'players' })[m[1].toLowerCase()] || null),
  player: (t) => regexKind(t, /\b(target player|that player|each player|its controller|its owner)\b/gi, () => 'you'),
  instead: (t) => regexKind(t, / instead\b/g, ''),
  random: (t) => regexKind(t, / at random\b/g, ''),
  withClause: (t) => regexKind(t, / with (?:flying|power \d+ or (?:less|greater)|toughness \d+ or (?:less|greater)|mana value \d+ or (?:less|greater)|mana value X or less|a [+-]1\/[+-]1 counter on it|defender|deathtouch|trample)\b/g, ''),
  timing: (t) => regexKind(t, /\.? ?Activate (?:this ability )?only [^.]+\.|\.? ?This ability triggers only [^.]+\.|\.? ?Cast this spell only [^.]+\./g, '.'),
  first: (t) => regexKind(t, / (?:for the first time|the first time) each turn| for the first time\b|\byour first (?=spell)|\b(?:second|third) (?=spell|card|time)/g, ''),
  andClause: (t) => regexKind(t, /,? and (?!\/)[^,.:"]+(?=\.)/g, ''),
  thenClause: (t) => regexKind(t, /,? then (?!shuffle\b)[^,.:"]+(?=\.)/g, ''),
  commaClause: (t) => regexKind(t, /, (?!then |and |or |where |if )[^,.:"]+(?=\.)/g, ''),
  each: (t) => regexKind(t, /\b(each|all) (creatures?|permanents?|artifacts?|lands?) /gi, () => 'target creature '),
  facedown: (t) => regexKind(t, / face (?:down|up)\b/g, ''),
  equal: (t) => regexKind(t, / equal to [^,.:"]+/g, ''),
  where: (t) => regexKind(t, /, where X is [^.]+/g, ''),
  noRegen: (t) => regexKind(t, / (?:It|They) can'?t be regenerated\./g, ''),
  shuffle: (t) => regexKind(t, /(?<![Ss]earch[^.]*),? then shuffle\b|\.? ?(?:Then )?[Ss]huffle (?:your|their) library\b/g, ''),
};

const stats = {};
let checked = 0;
for (const card of pool.slice(0, top)) {
  let slim, base;
  try { slim = MTG.scry.slim(card); base = MTG.oracle.analyze(slim); } catch (e) { continue; }
  if (!base || !base.fullyAutomated || base.scripted) continue;
  const faces = slim.card_faces && slim.card_faces.length ? slim.card_faces.length : 1;
  // a face at a time; the rest of the card left as it is
  for (let fi = 0; fi < faces; fi++) {
    const face = faces > 1 ? slim.card_faces[fi] : slim;
    const text = MTG.oracle.stripReminder(face.oracle_text || '').replace(/[ \t]+\n/g, '\n');
    if (!text) continue;
    const withText = (t, tag) => {
      const c = JSON.parse(JSON.stringify(slim));
      c.id = slim.id + ':abl:' + tag;
      if (faces > 1) c.card_faces[fi].oracle_text = t; else c.oracle_text = t;
      if (faces > 1 && c.oracle_text) c.oracle_text = c.card_faces.map(f => f.oracle_text).join(' // ');
      return c;
    };
    let ref;
    try { ref = MTG.oracle.analyze(withText(text, 'ref' + fi), fi); } catch (e) { continue; }
    if (!ref || !ref.fullyAutomated || ref.scripted) continue;
    const refSig = sig(ref);
    checked++;
    // (every variant its own id: reading one face reads the other, and that is kept too)
    let k = fi * 100000;
    for (const [kind, fn] of Object.entries(KINDS)) {
      if (kinds && !kinds.has(kind)) continue;
      for (const v of fn(text)) {
        if (v.text === text) continue;
        let a;
        try { a = MTG.oracle.analyze(withText(v.text, kind + (k++)), fi); } catch (e) { continue; }
        // a line the words no longer cover can be filled in from the generated scripts, by name: that is not this reading
        if (!a || !a.fullyAutomated || (a.generated && !ref.generated)) continue;
        if (sig(a) !== refSig) continue;
        (stats[kind] = stats[kind] || []).push({ name: card.name, rank: card.edhrec_rank || null, face: fi, words: v.words.trim(), text, ctx: text.slice(Math.max(0, v.at - 50), v.at + v.words.length + 40).replace(/\n/g, ' / ') });
      }
    }
  }
  MTG.oracle.clearCache();
}
console.warn = w;
console.log(`${checked} automated faces checked`);
for (const [kind, list] of Object.entries(stats).sort((a, b) => b[1].length - a[1].length)) {
  const cards = new Set(list.map(x => x.name)).size;
  console.log(`\n=== ${kind}: ${list.length} unread (${cards} cards)`);
  for (const x of list.slice(0, show)) console.log(`  #${x.rank} ${x.name}: "${x.words}"\n      ...${x.ctx}...`);
}
if (out) { fs.writeFileSync(out, JSON.stringify(stats, null, 1)); console.log('\nwrote ' + out); }
