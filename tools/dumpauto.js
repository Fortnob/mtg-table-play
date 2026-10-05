/* Print what the parser made of the most-played cards, for reading by eye.

   node tools/dumpauto.js [--from 0] [--to 300] [--all] [--name "Card Name"]

   By default only the cards it calls fully automated are shown: those are
   the ones that will be played without anybody checking, so those are the
   ones whose reading has to be right. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const from = +arg('from', 0), to = +arg('to', 300), all = process.argv.includes('--all');
const manualOnly = process.argv.includes('--manual');
const only = arg('name', null);
process.env.OFFLINE = '1';
const w = console.warn; console.warn = () => {};
const MTG = load();
console.warn = w;

const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
const pool = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  if (c.layout === 'token' || c.layout === 'art_series' || c.layout === 'emblem') continue;
  if (c.set_type === 'funny' || c.set_type === 'memorabilia') continue;
  if (!Object.values(c.legalities || {}).some(v => v === 'legal' || v === 'restricted')) continue;
  if (only && c.name.toLowerCase() !== only.toLowerCase() && !c.name.toLowerCase().startsWith(only.toLowerCase() + ' //')) continue;
  pool.push(c);
}
pool.sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));

const strip = (k, v) => (k === 'text' || k === 'raw' ? undefined : v);
for (const c of only ? pool : pool.slice(from, to)) {
  let a;
  try { a = MTG.oracle.analyze(MTG.scry.slim(c)); } catch (e) { console.log(`#${c.edhrec_rank} ${c.name}: ERROR ${e.message}`); continue; }
  if (!a.fullyAutomated && !all && !only && !manualOnly) continue;
  if (manualOnly && a.fullyAutomated) continue;
  if (manualOnly) {
    console.log(`\n#${c.edhrec_rank} ${c.name} ${a.typeLine}`);
    console.log('  ' + (c.oracle_text || (c.card_faces || []).map(f => f.oracle_text).join(' // ')).replace(/\n/g, '\n  '));
    for (const ab of a.abilities.filter(x => !x.auto && x.kind !== 'castModifier')) console.log('  !! ' + ab.text);
    for (const ab of a.abilities.filter(x => !x.auto && x.kind === 'castModifier')) console.log('  !K ' + (ab.keyword || ab.text));
    continue;
  }
  console.log(`\n#${c.edhrec_rank} ${c.name}${a.fullyAutomated ? '' : '  [MANUAL]'}${a.scripted ? ' [script]' : ''}`);
  console.log('  ' + (c.oracle_text || (c.card_faces || []).map(f => f.oracle_text).join(' // ')).replace(/\n/g, '\n  '));
  for (const ab of a.manaAbilities.filter(x => !(a.isBasicLand))) console.log('  M ' + JSON.stringify(ab.effects, strip) + ' cost=' + JSON.stringify(ab.cost, strip) + (ab.only ? ' only=' + JSON.stringify(ab.only) : ''));
  for (const ab of a.abilities) {
    const head = ab.kind === 'triggered' ? `T[${ab.event}${ab.also ? '/' + ab.also : ''}${ab.self ? ',self' : ''}${ab.optional ? ',may' : ''}${ab.condition ? ',if' : ''}]`
      : ab.kind === 'activated' ? `A cost=${JSON.stringify(ab.cost, strip)}${ab.only ? ' only=' + JSON.stringify(ab.only) : ''}`
      : ab.kind === 'castModifier' ? `K ${ab.keyword || ab.text}` : ab.kind.charAt(0).toUpperCase();
    console.log(`  ${ab.auto ? ' ' : '!'}${head} ${JSON.stringify(ab.effects || [], strip)}`);
  }
}
