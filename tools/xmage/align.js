/* Lining a card's XMage abilities up with its printed lines.

   XMage writes the printed text of each ability as a comment above the code
   that makes it, in printed order. Each ability (a "unit") is matched to a
   line by how alike the comment and the line read, and the whole card is
   aligned at once so the order is kept: a unit never lands above one that
   was coded before it. A unit with no comment can still be placed by its
   kind (a trigger on a "When" line, an activated ability on a line with a
   cost) when the order leaves it only one place to go. */
'use strict';
const core = require('./tr/core');
const fw = require('./framework');

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'and', 'or', 'it', 'its', 'this', 'that', 'on', 'for', 'each', 'you',
  'your', 'battlefield', 'cardname', 'creature', 'permanent', 'card', 'cards', 'is', 'are', 'be', 'with', 'from', 'into', 'in']);
const NUMS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

function words(text, name) {
  let t = String(text || '').toLowerCase().replace(/\{this\}|~/g, ' cardname ');
  if (name) {
    const full = name.toLowerCase().split(' // ')[0];
    t = t.split(full).join(' cardname ');
    const short = full.split(',')[0];
    if (short.length >= 3) t = t.split(short).join(' cardname ');
  }
  t = t.replace(/\([^)]*\)/g, ' ').replace(/\{([^}]*)\}/g, (m, s) => ' ' + s.replace(/\//g, '') + 'sym ')
    .replace(/converted mana cost/g, 'mana value').replace(/enters the battlefield/g, 'enters')
    .replace(/[^a-z0-9+\-/ ]+/g, ' ');
  return t.split(/\s+/).map(w => NUMS[w] || w).filter(w => w && !STOP.has(w));
}

function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  // how much of the comment is in the line, and how much of the line the comment covers
  return (2 * both) / (A.size + B.size);
}
function covered(a, b) {
  if (!a.length) return 0;
  const B = new Set(b);
  return a.filter(w => B.has(w)).length / a.length;
}

/** What package a framework ability class is in: a keyword, a mana ability, or anything else. */
function abilityFamily(cls) {
  const e = fw.load()[cls];
  if (!e) return 'other';
  if (/\.keyword$/.test(e.pkg || '')) return 'keyword';
  if (/\.mana$/.test(e.pkg || '')) return 'mana';
  return 'other';
}

/** The kind a unit will be, as far as its class says: for matching it to a kind of line. */
function unitShape(u) {
  if (u.kind === 'spell') return 'spell';
  if (u.kind === 'cost') return 'cost';
  if (u.kind === 'keyword') return 'keyword';
  if (u.kind === 'chapter') return 'chapter';
  const o = u.obj;
  if (!o || o.t !== 'obj' || o.custom) return 'any';
  const anc = [o.cls].concat(fw.ancestors(o.cls));
  if (anc.includes('TriggeredAbility') || anc.includes('TriggeredAbilityImpl')) return 'triggered';
  if (anc.includes('ManaAbility') || anc.includes('ActivatedManaAbilityImpl')) return 'activated';
  if (anc.includes('ActivatedAbility') || anc.includes('ActivatedAbilityImpl')) return 'activated';
  if (anc.includes('StaticAbility')) return 'static';
  return 'any';
}

function lineShape(text) {
  if (/^(?:When|Whenever|At)\b/.test(text)) return 'triggered';
  if (/^[^"]*?:\s/.test(text) && !/^(?:As|If)\b/.test(text)) return 'activated';
  return 'static';
}

function compatible(u, line, isPermanent) {
  const us = unitShape(u);
  const ls = lineShape(line.text);
  if (us === 'any') return true;
  // a permanent's spell ability is an Aura's targeting: the "Enchant" line
  if (us === 'spell') return isPermanent ? ls === 'static' : ls !== 'triggered' && ls !== 'activated';
  if (us === 'cost') return ls === 'static';
  if (us === 'chapter') return /^[IVX]+(?:\s*,\s*[IVX]+)*\s*[-—]/.test(line.text);
  if (us === 'keyword') return ls !== 'triggered';
  if (us === 'triggered') return ls === 'triggered';
  if (us === 'activated') return ls === 'activated';
  if (us === 'static') return ls === 'static';
  return true;
}

/** The units of a card: each ability added, and the spell's effects grouped by the comment above them. */
function unitsOf(model) {
  const units = [];
  for (const a of model.abilities) {
    const o = a.obj;
    /* A Saga's chapters are calls on one object: each is its own unit,
       lined up with its own "I —" line. */
    if (o && o.t === 'obj' && o.cls === 'SagaAbility' && !o.custom) {
      units.push({ kind: 'saga', obj: o, cmt: null, cls: 'SagaAbility', srcLine: a.line });
      for (const c of o.calls) {
        if (c.name !== 'addChapterEffect') continue;
        units.push({ kind: 'chapter', obj: c, cmt: c.cmt, cls: 'SagaAbility.chapter', srcLine: c.line });
      }
      continue;
    }
    const cls = o && o.t === 'obj' ? o.cls : core.keyOf(o);
    const fam = o && o.t === 'obj' && !o.custom ? abilityFamily(o.cls) : 'other';
    units.push({ kind: fam === 'keyword' ? 'keyword' : 'ability', fam, obj: o, cmt: a.cmt || (o && o.cmt) || null, cls, srcLine: a.line });
  }
  if (model.spell) {
    const sp = model.spell;
    const costs = sp.calls.filter(c => c.name === 'addCost');
    const rest = sp.calls.filter(c => c.name !== 'addCost');
    for (const c of costs) units.push({ kind: 'cost', obj: c.args[0], cmt: c.cmt, cls: 'SpellAbility.addCost', srcLine: c.line });
    if (rest.some(c => c.name !== 'addEffect' && c.name !== 'addTarget')) {
      // modes and the like belong to the spell as a whole
      const cmts = [...new Set(rest.map(c => c.cmt).filter(Boolean))];
      units.push({ kind: 'spell', obj: Object.assign({}, sp, { calls: rest }), cmt: cmts.join(' '), cmts, cls: 'SpellAbility', srcLine: (rest[0] || {}).line });
    } else {
      const groups = new Map();
      for (const c of rest) {
        const k = c.cmt || '';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(c);
      }
      for (const [k, list] of groups) units.push({ kind: 'spell', obj: Object.assign({}, sp, { calls: list }), cmt: k || null, cls: 'SpellAbility', srcLine: list[0].line });
    }
  }
  return units;
}

/**
 * Give each unit a line (u.line, -1 for none). Order-preserving: the best
 * total score over all units, each unit's line no earlier than the last's.
 */
function align(all, lines, name, isPermanent) {
  // the Saga object itself is no line: only its chapters are
  for (const u of all) if (u.kind === 'saga') u.line = -1;
  const units = all.filter(u => u.kind !== 'saga');
  const lw = lines.map(l => words(l.text, name));
  const NEG = -1e9;
  // in printed order, which is the order the code was written in
  units.sort((x, y) => (x.srcLine || 0) - (y.srcLine || 0));
  const ok = units.map(u => lines.map(l => compatible(u, l, isPermanent)));
  const score = units.map((u, i) => lines.map((l, j) => {
    if (!ok[i][j]) return -2;
    if (!u.cmt) return 0.05;
    const cw = words(u.cmt, name);
    const s = similarity(cw, lw[j]);
    // a comment that is one sentence of a longer line is still that line
    const c = covered(cw, lw[j]);
    return Math.max(s, c >= 0.8 && cw.length >= 3 ? c * 0.8 : 0);
  }));
  const U = units.length, L = lines.length;
  if (!U || !L) { for (const u of units) u.line = -1; return; }
  /* One unit per line, each the right kind for the line beside it: that
     is the card, comments or not. */
  if (U === L && units.every((u, i) => ok[i][i] && (!u.cmt || score[i][i] >= 0.3))) {
    units.forEach((u, i) => { u.line = i; u.score = score[i][i]; });
    return;
  }
  // best[i][j]: best total for units 0..i with unit i on line j
  const best = Array.from({ length: U }, () => new Array(L).fill(NEG));
  const from = Array.from({ length: U }, () => new Array(L).fill(-1));
  for (let j = 0; j < L; j++) best[0][j] = score[0][j];
  for (let i = 1; i < U; i++) {
    let runMax = NEG, runArg = -1;
    for (let j = 0; j < L; j++) {
      if (best[i - 1][j] > runMax) { runMax = best[i - 1][j]; runArg = j; }
      if (score[i][j] === NEG || runMax === NEG) continue;
      best[i][j] = runMax + score[i][j];
      from[i][j] = runArg;
    }
  }
  let j = -1, top = NEG;
  for (let k = 0; k < L; k++) if (best[U - 1][k] > top) { top = best[U - 1][k]; j = k; }
  if (top <= NEG / 2) { for (const u of units) u.line = -1; return; }
  for (let i = U - 1; i >= 0; i--) { units[i].line = j; units[i].score = score[i][j]; j = from[i][j]; }
  /* Only placements with something behind them stand: a comment that reads
     like the line, or no comment and nowhere else it could have gone. */
  for (let i = 0; i < U; i++) {
    const u = units[i];
    if (u.line < 0) continue;
    if (!ok[i][u.line]) { u.line = -1; continue; }
    if (u.cmt) { if (u.score < 0.4) u.line = -1; continue; }
    const options = lines.map((l, k) => k).filter(k => ok[i][k] &&
      (i === 0 || units[i - 1].line < 0 || k >= units[i - 1].line) &&
      (i === U - 1 || units[i + 1].line < 0 || k <= units[i + 1].line));
    if (options.length !== 1) u.line = -1;
  }
}

module.exports = { unitsOf, align, words, similarity, unitShape, lineShape };
