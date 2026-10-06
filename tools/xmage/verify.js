/* Checks a translated line against the words printed on the card.

   The translation is structural, so it can be right about the shape and
   still be about the wrong card (a class shared between printings that
   differ), or quietly lose a word the printed line has. These checks are
   deliberately blunt: the number of targets, the numbers, "may", "until end
   of turn", conditions, and what kind of ability the line is. A line that
   fails any of them is not written out. */
'use strict';

const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 'X' };

/** The line with quoted abilities and reminder text taken out. */
function plain(text) {
  return String(text || '').replace(/"[^"]*"/g, ' QUOTED ').replace(/\([^)]*\)/g, ' ');
}

function expectedTargets(text) {
  const t = plain(text)
    .replace(/\bbecomes? the target of\b/gi, ' ')
    .replace(/\b(?:can't|cannot) be the target of\b/gi, ' ')
    .replace(/\bthe target of\b/gi, ' ')
    .replace(/\bchoose new targets\b/gi, ' ')
    .replace(/\bnew targets?\b/gi, ' ')
    .replace(/\btargets\b(?! (?:of|you|an?|that))/gi, ' ');
  let n = 0;
  const re = /\b(?:up to (one|two|three|four|five|x) )?(?:(one|two|three|four|five|x) )?(?:other |another )?target\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const w = (m[1] || m[2] || '').toLowerCase();
    const k = w ? NUMW[w] : 1;
    if (k === 'X') return null;          // "X target creatures": not counted here
    n += k;
  }
  return n;
}

function walk(x, fn) {
  if (Array.isArray(x)) { x.forEach(y => walk(y, fn)); return; }
  if (!x || typeof x !== 'object') return;
  fn(x);
  for (const [k, v] of Object.entries(x)) if (k !== 'text' && v && typeof v === 'object') walk(v, fn);
}

function actualTargets(abilities) {
  let n = 0;
  walk(abilities, (o) => {
    if (Array.isArray(o.targets)) n += o.targets.length;
    if (o.op === 'modal') n -= 0;
  });
  return n;
}

function hasModal(abilities) {
  let m = false;
  walk(abilities, (o) => { if (o.op === 'modal') m = true; });
  return m;
}

/** Returns null when the line and its translation agree, or what is wrong. */
function checkLine(text, abilities, card, an) {
  // an emblem's quoted words are what its abilities do, so they count here
  if (JSON.stringify(abilities).includes('"op":"getEmblem"')) text = String(text).replace(/"/g, '');
  const t = plain(text);
  // what kind of ability this is
  const isTrig = /^(?:When|Whenever|At)\b/.test(t.trim());
  const kinds = new Set(abilities.map(a => a.kind));
  if (isTrig && !(kinds.size === 1 && kinds.has('triggered'))) return 'not a trigger';
  if (!isTrig && kinds.has('triggered')) return 'a trigger on a line that is not one';
  const colon = /^[^"]*?:\s/.test(text) && !/^(?:When|Whenever|At|As)\b/.test(text);
  if (colon && ![...kinds].every(k => k === 'activated' || k === 'mana' || k === 'loyalty')) return 'activated line, not activated';
  if (!colon && [...kinds].some(k => k === 'activated' || k === 'mana' || k === 'loyalty')) return 'activated with no cost on the line';
  if (an && !an.isPermanent && !kinds.has('spell') && !isTrig) return 'spell line not a spell';
  // targets
  if (!hasModal(abilities)) {
    const want = expectedTargets(text);
    if (want != null) {
      const got = actualTargets(abilities);
      if (want !== got) return `targets ${got}, printed ${want}`;
    }
  }
  const json = JSON.stringify(abilities, (k, v) => (k === 'text' || k === 'label' || k === 'prompt' ? undefined : v));
  // numbers printed on the line must be somewhere in the translation
  const nums = new Set();
  const body = t.replace(/\{[^}]*\}/g, ' ').replace(/[+-](\d+)\/[+-](\d+)/g, ' $1 $2 ');
  for (const m of body.matchAll(/\b(\d+)\b/g)) nums.add(+m[1]);
  for (const m of body.toLowerCase().matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten)\b/g)) nums.add(NUMW[m[1]]);
  const have = new Set([...json.matchAll(/-?\d+/g)].map(m => Math.abs(+m[0])));
  for (const k of nums) if (!have.has(k)) return 'number ' + k + ' missing';
  // "you may"
  const may = /\byou may\b|\bup to\b/i.test(t);
  const optional = abilities.some(a => a.optional) || /"op":"may(?:Pay)?"|"upTo":true|"optional":true/.test(json);
  if (may && !optional) return '"may" lost';
  if (!may && optional && !/\bmay\b/i.test(t)) return 'optional where the card is not';
  // conditions
  const cond = /\bas long as\b|,? if\b|\bunless\b|\bonly if\b|\bonly during\b|\bduring (?:your|each of your) turns?\b|\binstead\b/i.test(t);
  const hasCond = /"cond":|"condition":\{|"condition":\[|"op":"ifCond"|"only":/.test(json);
  if (cond && !hasCond && !/"op":"may(?:Pay)?"/.test(json)) return 'condition lost';
  if (!cond && hasCond && !/\bthreshold|delirium|metalcraft|morbid|raid|revolt|ferocious|hellbent|landfall\b/i.test(t)) return 'condition the card does not print';
  // durations
  const eot = /until end of turn|this turn/i.test(t);
  if (/"duration":"eot"|"until":"eot"/.test(json) && !eot) return 'until end of turn the card does not print';
  if (eot && /"op":"(?:pump|grantKeyword)"/.test(json) && !/"duration":"eot"/.test(json)) return 'end of turn lost';
  return null;
}

/* ---------------- comparing with the parser ---------------- */

const DROP = new Set(['text', 'label', 'auto', 'raw', 'prompt', 'filter', 'intervening', 'sorcerySpeed']);
function norm(x) {
  if (Array.isArray(x)) return x.map(norm);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const k of Object.keys(x).sort()) {
    const v = x[k];
    if (DROP.has(k)) continue;
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = norm(v);
  }
  return out;
}

function firstDiff(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], path + '.' + k);
      if (d) return d;
    }
  }
  return `${path}: parser ${JSON.stringify(a)} / xmage ${JSON.stringify(b)}`.slice(0, 400);
}

function compare(parsed, translated) {
  return firstDiff(norm(parsed), norm(translated), '');
}

module.exports = { checkLine, compare, expectedTargets };

/* ---------------- when the translation should win ----------------
   Readings of the text the tests showed wrong, and that the translation
   gets right. A line matching one of these is written as an override. */

function effectsOf(abilities) {
  const out = [];
  walk(abilities, (o) => { if (o.op) out.push(o); });
  return out;
}
function specsOf(abilities) {
  const out = [];
  walk(abilities, (o) => { if (Array.isArray(o.targets)) out.push(...o.targets); });
  return out;
}

function overrideReason(parsed, translated) {
  const pe = effectsOf(parsed), te = effectsOf(translated);
  /* "Each opponent loses 1 life and you gain 1 life" read as a drain:
     with three opponents it gains 3. */
  if (pe.some(e => e.op === 'drain' && e.who !== 'target') && te.some(e => e.op === 'loseLife' && e.who === 'opponents') &&
      te.some(e => e.op === 'gainLife' && e.who === 'you' && typeof e.n === 'number')) return 'drain';
  /* "Target opponent" read as any player: Duress could be cast on yourself. */
  const ps = specsOf(parsed), ts = specsOf(translated);
  if (ps.length === ts.length && ps.some((s, i) => s && s.type === 'player' && !s.opponent && ts[i] && ts[i].type === 'player' && ts[i].opponent)) return 'opponent';
  /* "It" read as the wrong thing: The Great Henge's counter on the Henge
     rather than the creature that entered, Kaito's stun counters on
     Kaito, "it gets +2/+2" on a trigger pointing at nothing. Effects
     line up one for one, and only what each acts on differs. */
  const SCOPES = new Set(['self', 'lastTarget', 'triggerObject']);
  if (pe.length === te.length && pe.every((e, i) => e.op === te[i].op || (e.op === 'grantLast' && te[i].op === 'grantKeyword'))) {
    for (let i = 0; i < pe.length; i++) {
      const a = pe[i], b = te[i];
      if (a.targets && a.targets.length) continue;
      if (SCOPES.has(b.scope) && (a.scope == null || SCOPES.has(a.scope)) && a.scope !== b.scope && !(a.op === 'grantLast' && b.scope === 'lastTarget')) return 'it';
    }
  }
  /* "+X/+0" read as nothing at all (Hatred) */
  if (pe.length === te.length && pe.some((e, i) => ['p', 't', 'n'].some(k => (e[k] == null) && te[i][k] === 'X'))) return 'x';
  /* An intervening "if" the reading dropped: the trigger fired every time
     (Ghitu Journeymage dealing its damage with no Wizard). */
  const pt = (parsed || []).filter(a => a.kind === 'triggered'), tt = (translated || []).filter(a => a.kind === 'triggered');
  if (pt.length === 1 && tt.length === 1 && !pt[0].condition && tt[0].condition) return 'condition';
  /* A count the engine cannot do: "cards in your hand", "other Dinosaurs",
     "attacking Elves" read as permanents of one type, which counts none. */
  let badPer = false;
  walk(parsed, (o) => { if (typeof o.per === 'string' && /\s|card/.test(o.per.replace(/^the /, ''))) badPer = true; });
  if (badPer && !/"per":/.test(JSON.stringify(translated))) return 'count';
  return null;
}

module.exports.overrideReason = overrideReason;
