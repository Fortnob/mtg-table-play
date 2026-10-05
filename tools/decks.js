/* Build bot decks headless and print them, to check what the deck
   builder makes at each difficulty.

   node tools/decks.js --format standard --d 2,5,9 --seeds 1,2 [--brief]

   Prints each list with its plan, curve, land count and how much of it
   the engine runs on its own. */
'use strict';
const { load } = require('./engine');

function args() {
  const a = { format: 'standard', d: '2,5,9', seeds: '1', brief: false };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'brief') { a.brief = true; continue; }
    a[k] = v[++i];
  }
  return a;
}

async function main() {
  const a = args();
  const MTG = load();
  const rules = MTG.formats.houseDefaults(a.format);
  for (const seed of String(a.seeds).split(',').map(Number)) {
    for (const d of String(a.d).split(',').map(Number)) {
      const t0 = Date.now();
      const deck = await MTG.bots.buildBotDeck({ formatId: a.format, difficulty: d, rules, rng: new MTG.RNG(seed * 7919 + d), name: 'd' + d });
      const stats = MTG.formats.deckStats(deck.main, deck.commanders);
      const v = MTG.formats.validate(deck, a.format, rules);
      const manual = [];
      let rsum = 0, rn = 0;
      for (const e of deck.main) {
        const an = MTG.oracle.analyze(e.card);
        if (!an.isLand) { rsum += MTG.bots.rateCard(e.card, { prior: 0 }) * e.qty; rn += e.qty; }
        if (!an.fullyAutomated) manual.push(e.card.name);
      }
      const p = deck.plan || {};
      console.log(`\n=== ${a.format} d${d} seed ${seed}: ${p.label || ''} ${p.archetype || ''}${p.theme ? ' / ' + p.theme : ''}` +
        `${deck.commanders.length ? ' — ' + deck.commanders.map(c => c.name).join(' + ') : ''}`);
      console.log(`  ${stats.total} cards, ${stats.lands} lands, ${stats.creatures} creatures, avg mv ${stats.avgMv}, ` +
        `curve ${Object.values(stats.curve).join('/')}, mean rating ${(rsum / rn).toFixed(2)}, valid=${v.ok}${v.ok ? '' : ' ' + v.errors.join('; ')}, ` +
        `not automated: ${manual.length ? manual.join(', ') : 'none'}, ${Date.now() - t0}ms`);
      if (!a.brief) {
        const rows = deck.main.slice().sort((x, y) => (x.card.cmc || 0) - (y.card.cmc || 0));
        console.log('  ' + rows.map(e => `${e.qty} ${e.card.name}`).join('\n  '));
      }
    }
  }
  console.log('\nlive fetches', globalThis.__liveFetches());
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
