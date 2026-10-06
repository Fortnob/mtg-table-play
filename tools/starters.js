/* The starter decks (src/20-starters.js): check them, and make candidates
   for new ones.

   node tools/starters.js                    check every starter deck
   node tools/starters.js --play 2 [--format modern]
                                             ...and play each one against two others of its format
   node tools/starters.js --generate [--format modern] [--colors WU,UB] [--seeds 1,2,3] [--d 9]
                                             build candidate lists with the bot deck builder

   The check reads Scryfall's oracle-cards bulk file (tools/oracle-cards.jsonl.gz,
   from tools/fetch-bulk.py), so it runs offline: every card has to exist, be
   legal in the deck's format, and be run by the engine from start to finish,
   and every deck has to be the right size with no more than four of a card.
   Coverage changes as the engine learns cards, so run it again after that
   and swap out anything that has started to need a hand (or put back
   anything that no longer does). It exits non-zero if any deck fails.

   --generate builds lists at a high difficulty and fixed seeds and prints
   each one in the module's own format, with its plan, curve, lands and the
   share the engine runs, ready to be curated by hand. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');
const { load, SRC } = require('./engine');

function args() {
  const a = { generate: false, play: 0, colors: null, seeds: '1,2', d: 9, format: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'generate') { a.generate = true; continue; }
    a[k] = v[++i];
  }
  a.play = Number(a.play) || 0;
  return a;
}

const PAIRS = ['W', 'U', 'B', 'R', 'G', 'WU', 'UB', 'BR', 'RG', 'GW', 'WB', 'UR', 'BG', 'RW', 'GU'];

/** Every card in the bulk file, by lower-cased name (and front-face name). */
function bulkByName() {
  const file = path.join(__dirname, 'oracle-cards.jsonl.gz');
  if (!fs.existsSync(file)) throw new Error('No tools/oracle-cards.jsonl.gz: run python tools/fetch-bulk.py first.');
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let c;
    try { c = JSON.parse(line); } catch (e) { continue; }
    if (!c || !c.name || c.layout === 'token' || c.layout === 'art_series') continue;
    const k = c.name.toLowerCase();
    if (!out.has(k)) out.set(k, c);
    const front = c.name.split(' // ')[0].toLowerCase();
    if (!out.has(front)) out.set(front, c);
  }
  return out;
}

function loadStarters(MTG) {
  vm.runInThisContext(fs.readFileSync(path.join(SRC, '20-starters.js'), 'utf8'), { filename: '20-starters.js' });
  return MTG.starters;
}

function curveOf(MTG, main) {
  const curve = [0, 0, 0, 0, 0, 0, 0];
  let lands = 0;
  for (const e of main) {
    const a = MTG.oracle.analyze(e.card);
    if (a && a.isLand) { lands += e.qty; continue; }
    curve[Math.min(6, Math.floor(e.card.cmc || 0))] += e.qty;
  }
  return { curve, lands };
}

function check(MTG, starters, byName) {
  let bad = 0;
  const decks = [];
  for (const s of starters.list) {
    const problems = [];
    const main = [];
    let size = 0;
    for (const [qty, name] of s.cards) {
      const c = byName.get(name.toLowerCase());
      if (!c) { problems.push(`no card called "${name}"`); continue; }
      size += qty;
      const basic = /\bBasic\b/.test(c.type_line || '');
      if (qty > 4 && !basic) problems.push(`${qty} copies of ${name}`);
      const legal = (c.legalities || {})[s.format === 'standard' ? 'standard' : s.format];
      if (legal !== 'legal') problems.push(`${name} is ${legal || 'not legal'} in ${s.format}`);
      const a = MTG.oracle.analyze(c);
      if (!a || !a.fullyAutomated) {
        const why = a ? (a.abilities || []).filter(x => !x.auto && x.kind !== 'castModifier').map(x => x.text).join(' | ') : 'could not be read';
        problems.push(`${name} needs a hand: ${String(why).slice(0, 140)}`);
      }
      const cols = c.color_identity || [];
      if (cols.some(x => !s.colors.includes(x))) problems.push(`${name} is outside ${s.colors.join('')}`);
      main.push({ card: c, qty });
    }
    if (size !== 60) problems.push(`${size} cards, not 60`);
    if (!s.cards.some(([, n]) => n.toLowerCase() === String(s.cover).toLowerCase())) problems.push(`the cover card ${s.cover} is not in the deck`);
    const { curve, lands } = curveOf(MTG, main);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.id.padEnd(16)} ${s.name.padEnd(24)} ${s.colors.join('').padEnd(3)} lands ${lands}  curve ${curve.join('/')}`);
    for (const p of problems) console.log('       ' + p);
    if (problems.length) bad++;
    decks.push({ s, deck: { id: 'starter-' + s.id, name: s.name, format: s.format, main, sideboard: [], commanders: [], companion: null } });
  }
  console.log(`\n${starters.list.length} starter decks, ${bad} with problems`);
  return { bad, decks };
}

/** Each deck against `rounds` others of its own format (or only `format`'s, when given). */
async function play(MTG, all, rounds, format) {
  const { playOne } = require('./sim');
  const decks = format ? all.filter(d => d.s.format === format) : all;
  const record = new Map(decks.map(d => [d.s.id, { w: 0, l: 0, turns: 0, games: 0, stalls: 0, manual: new Set() }]));
  let seed = 1;
  for (const fmt of new Set(decks.map(d => d.s.format))) {
    const pool = decks.filter(d => d.s.format === fmt);
    for (let i = 0; i < pool.length; i++) {
      for (let k = 1; k <= rounds; k++) {
        const a = pool[i], b = pool[(i + k * 3) % pool.length];
        if (a === b) continue;
        const r = await playOne(MTG, {
          formatId: fmt, seed: seed++, diffA: 5, diffB: 5, maxTurns: 30, deckA: a.deck, deckB: b.deck,
        });
        for (const [d, id] of [[a, 'A'], [b, 'B']]) {
          const rec = record.get(d.s.id);
          rec.games++; rec.turns += r.turns;
          if (r.winner === id) rec.w++; else if (r.winner) rec.l++;
          if (r.stalled) rec.stalls++;
          for (const m of r.manualCards) rec.manual.add(m);
        }
        console.log(`  ${a.s.name} vs ${b.s.name}: ${r.over ? (r.winner === 'A' ? a.s.name : r.winner === 'B' ? b.s.name : 'draw') : r.stalled ? 'STALLED' : 'turn cap'} in ${r.turns} turns`);
      }
    }
  }
  console.log('\nrecord (wins-losses, average turns):');
  for (const d of decks) {
    const r = record.get(d.s.id);
    console.log(`  ${d.s.name.padEnd(24)} ${r.w}-${r.l}  ${(r.turns / Math.max(1, r.games)).toFixed(1)} turns${r.stalls ? `  ${r.stalls} stalled` : ''}${r.manual.size ? '  manual: ' + [...r.manual].join(', ') : ''}`);
  }
}

async function generate(MTG, a) {
  const format = a.format || 'standard';
  const rules = MTG.formats.houseDefaults(format);
  const cols = a.colors ? String(a.colors).split(',') : PAIRS;
  for (const pair of cols) {
    for (const seed of String(a.seeds).split(',').map(Number)) {
      const colors = pair.split('');
      let deck;
      try {
        deck = await MTG.bots.buildBotDeck({ formatId: format, difficulty: Number(a.d), rules, colors, rng: new MTG.RNG(seed * 7919 + pair.length * 31 + pair.charCodeAt(0)) });
      } catch (e) { console.log(`\n// ${pair} seed ${seed}: ${e.message}`); continue; }
      const { curve, lands } = curveOf(MTG, deck.main);
      const manual = deck.main.filter(e => !MTG.oracle.analyze(e.card).fullyAutomated).map(e => e.card.name);
      const p = deck.plan || {};
      console.log(`\n// ${pair} seed ${seed}: ${p.label || ''} ${p.archetype || ''}${p.theme ? ' / ' + p.theme : ''} · lands ${lands} · curve ${curve.join('/')}` +
        (manual.length ? ' · NEEDS A HAND: ' + manual.join(', ') : ''));
      const sorted = deck.main.slice().sort((x, y) => {
        const lx = MTG.oracle.analyze(x.card).isLand ? 1 : 0, ly = MTG.oracle.analyze(y.card).isLand ? 1 : 0;
        return lx - ly || (x.card.cmc || 0) - (y.card.cmc || 0) || x.card.name.localeCompare(y.card.name);
      });
      console.log('cards: [' + sorted.map(e => `[${e.qty}, ${JSON.stringify(e.card.name)}]`).join(', ') + '],');
    }
  }
}

async function main() {
  const a = args();
  const MTG = load();
  if (a.generate) { await generate(MTG, a); process.exit(0); }
  const starters = loadStarters(MTG);
  const byName = bulkByName();
  const { bad, decks } = check(MTG, starters, byName);
  if (a.play) await play(MTG, decks, a.play, a.format);
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
