/* A whole booster draft with bots in every seat, then games between the
   decks they built. Checks the draft bots, autoBuildLimited, and the bots
   playing forty-card decks.

   node tools/limited.js --set fdn --seats 8 --games 8 [--d 2,4,6,8,3,5,7,9] [--seed 1] [--show 2]

   Prints the decks (the first --show of them in full), then a round of
   games between neighbouring seats with who won. */
'use strict';
const { load } = require('./engine');
const { playOne } = require('./botsim');

function args() {
  const a = { set: 'fdn', seats: 8, games: 8, d: '2,4,6,8,3,5,7,9', seed: 1, show: 2 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

async function main() {
  const a = args();
  const MTG = load();
  MTG.settings.botSpeed = 0;
  const diffs = String(a.d).split(',').map(Number);
  const draft = new MTG.draft.Draft({ formatId: 'booster', seats: a.seats, packs: 3, packSize: 14, setCodes: [a.set], seed: a.seed });
  for (let i = 0; i < a.seats; i++) draft.addSeat({ id: 'S' + i, name: 'S' + i + '(d' + diffs[i % diffs.length] + ')', isBot: true, botDifficulty: diffs[i % diffs.length] });
  await draft.prepare();
  const done = new Promise(r => draft.on('draft:done', r));
  draft.start();
  await Promise.race([done, new Promise(r => setTimeout(r, 60000))]);
  if (!draft.finished) { console.log('draft did not finish'); process.exit(1); }
  const basics = await MTG.draft.getBasics();
  const decks = draft.seats.map(s => MTG.draft.autoBuildLimited(s.pool, { deckSize: 40, basicCards: basics, formatId: 'booster', name: s.name }));
  decks.forEach((deck, i) => {
    const st = MTG.formats.deckStats(deck.main, []);
    const manual = deck.main.filter(e => !MTG.oracle.analyze(e.card).fullyAutomated && !MTG.oracle.analyze(e.card).isLand).map(e => e.card.name);
    console.log(`\n${draft.seats[i].name}: ${deck.colors.join('')} ${st.total} cards, ${st.lands} lands, ${st.creatures} creatures, avg mv ${st.avgMv}, curve ${Object.values(st.curve).join('/')}, not automated: ${manual.length ? manual.join(', ') : 'none'}`);
    if (i < a.show) console.log('  ' + deck.main.slice().sort((x, y) => (x.card.cmc || 0) - (y.card.cmc || 0)).map(e => `${e.qty} ${e.card.name}`).join('\n  '));
  });
  let errors = 0, stalls = 0;
  const wins = {};
  for (let g = 0; g < a.games; g++) {
    const i = g % a.seats, j = (g + 1) % a.seats;
    const di = draft.seats[i].botDifficulty, dj = draft.seats[j].botDifficulty;
    const seats = [{ id: 'A', play: di, deck: di, diff: di, deckSeed: 0 }, { id: 'B', play: dj, deck: dj, diff: dj, deckSeed: 1 }];
    const r = await playOne(MTG, { formatId: 'booster', seed: a.seed * 100 + g, seats, maxTurns: 40, decks: [decks[i], decks[j]] });
    errors += r.errors.length; stalls += r.stalled ? 1 : 0;
    const w = r.winner === 'A' ? i : r.winner === 'B' ? j : null;
    if (w != null) wins[draft.seats[w].name] = (wins[draft.seats[w].name] || 0) + 1;
    console.log(`game ${g + 1}: ${draft.seats[i].name} v ${draft.seats[j].name}: ${w == null ? (r.stalled ? 'STALLED' : 'no winner') : 'won by ' + draft.seats[w].name} in ${r.turns} turns${r.errors.length ? ' errors ' + r.errors.slice(0, 2).join(' | ') : ''}`);
  }
  console.log('\nwins', JSON.stringify(wins), 'errors', errors, 'stalls', stalls);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
