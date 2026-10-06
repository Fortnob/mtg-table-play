/* Translate XMage's card classes into this engine's card scripts.

   node tools/xmage/build.js [--write] [--card "Name"] [--limit N] [--show 40] [--compare]

   For every card in Scryfall's oracle file that has an XMage class, this
   reads the class (model.js), lines its abilities up with the card's printed
   lines (the comments XMage writes above each one), and translates each
   ability through the per-class translators in tr/. A line is written out
   only when everything on it translated and the result agrees with the
   printed words (targets, numbers, "may", conditions).

   Only the lines the text parser could not read are of use to the game, so
   those are what is written to src/19-cardlib.js (--write). The rest are
   still translated, with --compare, to check the translators against the
   parser on lines both understand.

   The blockers report (tools/xmage/blockers.json, and the list printed at
   the end) ranks the XMage constructs that stop the most lines, weighted by
   how much the cards they stop are played: Standard's most-played first. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

process.env.OFFLINE = '1';
const quiet = console.warn; console.warn = () => {};
const { load } = require('../engine');
const MTG = load();
console.warn = quiet;

const { loadCard } = require('./model');
const core = require('./tr/core');
require('./tr/filters');
require('./tr/parts');
require('./tr/effects');
const AB = require('./tr/abilities');
const MORE = require('./tr/more');
const MORE2 = require('./tr/more2');
require('./tr/more3');
const fw = require('./framework');
const V = require('./verify');

const ROOT = path.join(__dirname, '..', '..');
const CARDS = path.join(ROOT, 'vendor', 'xmage', 'Mage.Sets', 'src', 'mage', 'cards');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);

/* ---------------- the pool ---------------- */

function readPool() {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'tools', 'oracle-cards.jsonl.gz'))).toString('utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem' || c.layout === 'double_faced_token') continue;
    if (c.set_type === 'funny' || c.set_type === 'memorabilia') continue;
    if (!Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')) continue;
    out.push(c);
  }
  out.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
  return out;
}

/** A card name as an XMage class name would spell it: letters and digits only. */
function flat(name) {
  return String(name).split(' // ')[0].replace(/['’]/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function classIndex() {
  const idx = new Map();
  for (const d of fs.readdirSync(CARDS)) {
    for (const f of fs.readdirSync(path.join(CARDS, d))) {
      if (f.endsWith('.java')) idx.set(f.slice(0, -5).toLowerCase(), path.join(CARDS, d, f));
    }
  }
  return idx;
}

const { unitsOf, align } = require('./align');

/* ---------------- translating a line ---------------- */

function newTc(card, an, model) {
  return { MTG, card, an, model, name: card.name, ab: null, inStatic: false, kind: null };
}

function translateUnit(u, tc) {
  if (u.kind === 'keyword') core.block('keyword ' + u.cls);
  if (u.kind === 'cost') core.block('additional cost ' + core.keyOf(u.obj));
  if (u.kind === 'chapter') return [MORE2.chapter(u.obj, tc)];
  if (u.kind === 'spell') { if (tc.an.isPermanent) core.block('aura targeting'); return [AB.spellAbility(u.obj, tc)]; }
  const out = core.tr('ability', u.obj, tc);
  return [].concat(out);
}

/* ---------------- main ---------------- */

function weightOf(r) {
  return 1 + (r.stdTop ? 6 : 0) + (r.top2000 ? 3 : 0) + (r.top500 ? 2 : 0);
}

function main() {
  const t0 = Date.now();
  const only = arg('card', null);
  const limit = +arg('limit', 0);
  const pool = readPool();
  // ranks the way coverage.js counts them: standard's top 500, everything's top 2000
  const std = pool.filter(c => (c.legalities || {}).standard === 'legal');
  const stdTop = new Set(std.slice(0, 500).map(c => c.name));
  const top2000 = new Set(pool.slice(0, 2000).map(c => c.name));
  const top500 = new Set(pool.slice(0, 500).map(c => c.name));
  const idx = classIndex();
  // the text parser alone: what the generated table has to make up for
  const savedLib = MTG.cardlib;
  MTG.cardlib = null;
  MTG.oracle.clearCache();

  const lib = {};               // name -> { lines: { hash: [abilities] } }
  const blockers = new Map();   // what -> { score, cards: [], lines }
  const sole = new Map();       // what -> cards it alone blocks
  const stats = { cards: 0, withClass: 0, skippedLayout: 0, needed: 0, gainedCards: 0, linesNeeded: 0, linesGained: 0,
    gained: { all: 0, top2000: 0, stdTop: 0 }, compare: { same: 0, differ: 0, lines: 0 }, verifyFail: 0 };
  const gainedNames = [];
  const perCard = [];
  const cardWhyAll = (card, r, why) => { if (r.stdTop || r.top2000) perCard.push({ name: card.name, rank: r.rank, std: r.stdTop, why }); };
  const verifyNotes = [];
  const diffs = [];
  let n = 0;
  for (const card of pool) {
    if (only && card.name.toLowerCase() !== only.toLowerCase()) continue;
    if (limit && n >= limit) break;
    n++;
    stats.cards++;
    const r = { name: card.name, rank: card.edhrec_rank || 1e9, stdTop: stdTop.has(card.name), top2000: top2000.has(card.name), top500: top500.has(card.name) };
    const w = weightOf(r);
    const bump = (what, lineText) => {
      if (!blockers.has(what)) blockers.set(what, { what, score: 0, lines: 0, cards: [] });
      const b = blockers.get(what);
      b.score += w; b.lines++;
      if (b.cards.length < 12 && !b.cards.includes(card.name)) b.cards.push(card.name);
    };
    let an;
    try { an = MTG.oracle.analyze(MTG.scry.slim(card)); } catch (e) { continue; }
    if (!an) continue;
    const needed = !an.fullyAutomated;
    if (needed) stats.needed++;
    const file = idx.get(flat(card.name)) || idx.get(flat(card.name.split(' // ').join(' ')));
    if (!file) { if (needed) bump('(no XMage class)'); continue; }
    stats.withClass++;
    if (!needed && !flag('compare')) continue;
    let model;
    try { model = loadCard(file); } catch (e) { if (needed) bump('(class unreadable)'); continue; }
    /* A card with two faces is two sets of lines: each face is read, lined
       up and written out on its own, under its own name. */
    const faces = [];
    const multi = card.card_faces && card.card_faces.length > 1;
    if (multi) {
      const F2 = model.faces;
      const pair = {
        transform: [F2.LeftHalfCard, F2.RightHalfCard], modal_dfc: [F2.LeftHalfCard, F2.RightHalfCard],
        split: [F2.LeftHalfCard, F2.RightHalfCard], adventure: [model, F2.SpellCard], prepare: [model, F2.SpellCard],
      }[card.layout];
      if (!pair || !pair[0] || !pair[1]) { stats.skippedLayout++; if (needed) { bump('(layout ' + card.layout + ')'); cardWhyAll(card, r, ['(layout ' + card.layout + ')']); } continue; }
      for (let fi = 0; fi < 2; fi++) {
        let fan;
        try { fan = MTG.oracle.analyze(MTG.scry.slim(card), fi); } catch (e) { fan = null; }
        if (!fan) continue;
        const fm = pair[fi];
        faces.push({ name: card.card_faces[fi].name, an: fan, model: { abilities: fm.abilities, spell: fm.spell, problems: model.problems, customDecls: model.customDecls } });
      }
    } else faces.push({ name: card.name, an, model });
    const cardWhy = [];
    let allFixed = true, failedCount = 0;
    for (const face of faces) {
      const fan = face.an;
      const failed = (fan.lineInfo || []).filter(li => !li.auto);
      failedCount += failed.length;
      const lines = fan.lineInfo || [];
      const units = unitsOf(face.model);
      align(units, lines, face.name, fan.isPermanent);
      const cardProblems = model.problems.filter(p => !/^anonymous class|^lambda/.test(p));
      const out = {};
      stats.linesNeeded += failed.length;
      for (let i = 0; i < lines.length; i++) {
        const li = lines[i];
        const mine = units.filter(u => u.line === i);
        if (li.auto && !flag('compare')) continue;
        let abilities = null, why = null;
        if (!mine.length) why = '(line not matched to XMage code)';
        else if (li.abilities.some(x => x.kind === 'castModifier')) why = '(cast modifier line)';
        else if (cardProblems.length) why = '(constructor: ' + cardProblems[0] + ')';
        else {
          const tc = newTc(card, fan, model);
          tc.lineText = li.text;
          try {
            abilities = [];
            for (const u of mine) abilities.push(...translateUnit(u, tc));
            abilities = MORE.mergeMana(abilities);
          } catch (e) {
            if (!(e instanceof core.Blocked)) { why = '(translator error) ' + String(e.message || e).slice(0, 60); if (only) console.error(e); }
            else why = e.what;
            abilities = null;
          }
        }
        if (abilities) {
          const v = V.checkLine(li.text, abilities, card, fan);
          if (v) { why = '(verify) ' + v; abilities = null; if (!li.auto) { stats.verifyFail++; if (verifyNotes.length < 400) verifyNotes.push(face.name + ': ' + v + ' :: ' + li.text); } }
        }
        if (li.auto) {
          // the parser read this line: compare, to check the translators
          if (abilities && flag('compare')) {
            stats.compare.lines++;
            const d = V.compare(li.abilities.concat(li.mana), abilities);
            if (d) { stats.compare.differ++; if (diffs.length < 3000) diffs.push({ name: face.name, line: li.text, diff: d }); }
            else stats.compare.same++;
          }
          continue;
        }
        if (abilities) {
          for (const ab of abilities) ab.text = li.text;
          out[MTG.util.hash(li.text)] = abilities;
          stats.linesGained++;
        } else {
          allFixed = false;
          if (needed) { bump(why || '(unknown)', li.text); cardWhy.push(why || '(unknown)'); }
        }
      }
      if (Object.keys(out).length) lib[face.name] = { lines: out };
    }
    if (needed) cardWhyAll(card, r, cardWhy);
    /* What alone stands between this card and being complete: those are
       the constructs that finish cards, not just lines. */
    if (needed && cardWhy.length && new Set(cardWhy).size === 1) {
      const what = cardWhy[0];
      if (!sole.has(what)) sole.set(what, { what, score: 0, cards: 0, names: [] });
      const x = sole.get(what);
      x.score += w; x.cards++;
      if (x.names.length < 6) x.names.push(card.name);
    }
    if (needed && allFixed && failedCount) {
      stats.gainedCards++;
      stats.gained.all++;
      if (r.top2000) stats.gained.top2000++;
      if (r.stdTop) stats.gained.stdTop++;
      gainedNames.push(card.name);
    }
  }
  MTG.cardlib = savedLib;

  const ranked = [...blockers.values()].sort((a, b) => b.score - a.score);
  const show = +arg('show', 40);
  console.log(`cards ${stats.cards}, with an XMage class ${stats.withClass}, multi-face skipped ${stats.skippedLayout}, not automated by the parser ${stats.needed}`);
  console.log(`lines to make up ${stats.linesNeeded}, translated ${stats.linesGained}, verify refusals ${stats.verifyFail}`);
  console.log(`cards completed: ${stats.gained.all} (top 2000: ${stats.gained.top2000}, standard top 500: ${stats.gained.stdTop})`);
  if (flag('compare')) console.log(`compared with the parser on ${stats.compare.lines} lines: ${stats.compare.same} agree, ${stats.compare.differ} differ`);
  console.log(`\nblockers by weighted lines (score, lines, construct, example cards):`);
  for (const b of ranked.slice(0, show)) console.log(`  ${String(b.score).padStart(6)} ${String(b.lines).padStart(5)}  ${b.what}   [${b.cards.slice(0, 4).join('; ')}]`);
  const soleRanked = [...sole.values()].sort((a, b) => b.score - a.score);
  if (flag('sole')) {
    console.log(`
constructs that alone block a card (score, cards, construct):`);
    for (const b of soleRanked.slice(0, show)) console.log(`  ${String(b.score).padStart(6)} ${String(b.cards).padStart(5)}  ${b.what}   [${b.names.slice(0, 3).join('; ')}]`);
  }
  fs.writeFileSync(path.join(__dirname, 'blockers.json'), JSON.stringify({
    generated: new Date().toISOString().slice(0, 10), stats,
    weights: 'per blocked line: 1, +6 if in Standard top 500, +3 if in all-format top 2000, +2 if in top 500',
    blockers: ranked.slice(0, 500),
    sole: soleRanked.slice(0, 300),
  }, null, 1));
  const outDir = path.join(ROOT, 'tools', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'xmage-gained.txt'), gainedNames.join('\n'));
  fs.writeFileSync(path.join(outDir, 'xmage-popular.txt'), perCard.map(c => `${c.std ? 'S' : ' '} #${c.rank} ${c.name}: ${c.why.join(' | ')}`).join('\n'));
  fs.writeFileSync(path.join(outDir, 'xmage-verify.txt'), verifyNotes.join('\n'));
  if (flag('compare')) fs.writeFileSync(path.join(outDir, 'xmage-compare.json'), JSON.stringify(diffs, null, 1));
  if (only) console.log(JSON.stringify(lib, null, 1));
  if (flag('write')) {
    require('./pack').write(lib, path.join(ROOT, 'src', '19-cardlib.js'), (nm) => MTG.scripts.keyFor(nm));
    console.log(`\nwrote src/19-cardlib.js: ${Object.keys(lib).length} cards`);
  }
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
