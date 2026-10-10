/* A limited event with bots in every seat, then games between the decks
   they ended up with. Checks the draft bots, autoBuildLimited, sealed
   pools, Jumpstart's half-decks, and the bots playing forty-card decks.

   node tools/limited.js --set fdn --seats 8 --games 8 [--d 2,4,6,8,3,5,7,9] [--seed 1] [--show 2]
   node tools/limited.js --format sealed --set fdn --seats 4 --games 4
   node tools/limited.js --format jumpstart [--source j25 | --source set:fdn] --seats 4 --games 4

   --format booster (the default) drafts; sealed opens six boosters a seat
   (--packs n); jumpstart deals half-decks from a Jumpstart product, or
   makes them from a set. Prints the decks (the first --show of them in
   full), then a round of games between neighbouring seats with who won,
   and a summary line the way tools/sim.js prints one. */
'use strict';
const { load } = require('./engine');
const { playOne } = require('./botsim');

function args() {
  const a = { format: 'booster', set: 'fdn', seats: 8, games: 8, d: '2,4,6,8,3,5,7,9', seed: 1, show: 2, packs: 6, source: '' };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

/** A booster draft among bots: [{ name, difficulty, deck }]. */
async function drafted(MTG, a, diffs, basics) {
  const draft = new MTG.draft.Draft({ formatId: 'booster', seats: a.seats, packs: 3, packSize: 14, setCodes: [a.set], seed: a.seed });
  for (let i = 0; i < a.seats; i++) draft.addSeat({ id: 'S' + i, name: 'S' + i + '(d' + diffs[i % diffs.length] + ')', isBot: true, botDifficulty: diffs[i % diffs.length] });
  await draft.prepare();
  const done = new Promise(r => draft.on('draft:done', r));
  draft.start();
  await Promise.race([done, new Promise(r => setTimeout(r, 60000))]);
  if (!draft.finished) throw new Error('draft did not finish');
  return draft.seats.map(s => {
    const deck = MTG.draft.autoBuildLimited(s.pool, { deckSize: 40, basicCards: basics, formatId: 'booster', name: s.name });
    // what the draft cards noted goes to the game with the deck, as the app sends it
    deck.draftNotes = draft.notesFor(s.id, deck);
    return { name: s.name, difficulty: s.botDifficulty, deck };
  });
}

/** Sealed: six boosters a seat, a deck built from each pool. */
async function sealed(MTG, a, diffs, basics) {
  const ids = Array.from({ length: a.seats }, (x, i) => 'S' + i);
  const opened = await MTG.sealed.open({ seats: ids, setCode: a.set, packs: a.packs, seed: a.seed, basicsFree: a.basics !== 'off' });
  return ids.map((id, i) => {
    const name = id + '(d' + diffs[i % diffs.length] + ')';
    const pool = opened.seats[id].pool;
    const deck = MTG.sealed.buildDeck(pool, { deckSize: 40, basicCards: basics, formatId: 'sealed', name, basicsFree: a.basics !== 'off' });
    console.log(`${name} opened ${opened.seats[id].packs.length} packs, ${pool.length} cards`);
    return { name, difficulty: diffs[i % diffs.length], deck };
  });
}

/** Jumpstart: two half-decks a seat, chosen by the bots from three each. */
async function jumpstart(MTG, a, diffs, basics) {
  const src = String(a.source || '');
  const source = /^set:/i.test(src) ? { set: src.slice(4).toLowerCase() } : src ? { product: src.toUpperCase() } : null;
  const cat = await MTG.jumpstart.catalogue(source, { seed: a.seed });
  console.log(`half-decks: ${cat.label} (${cat.halves.length})${cat.note ? ' - ' + cat.note : ''}`);
  const seats = Array.from({ length: a.seats }, (x, i) => ({ id: 'S' + i, name: 'S' + i + '(d' + diffs[i % diffs.length] + ')', isBot: true, difficulty: diffs[i % diffs.length] }));
  const table = new MTG.jumpstart.Table({ halves: cat.halves, label: cat.label, seats, seed: a.seed, basicCards: basics });
  const done = new Promise(r => table.on('done', r));
  await table.begin();
  await Promise.race([done, new Promise(r => setTimeout(r, 1000))]);
  if (!table.finished) throw new Error('the half-decks were not all chosen');
  return table.seats.map(s => {
    console.log(`${s.name} took ${s.picks.map(h => h.name + ' [' + h.colors.join('') + ']').join(' and ')}`);
    return { name: s.name, difficulty: s.difficulty, deck: s.deck };
  });
}

async function main() {
  const a = args();
  const MTG = load();
  MTG.settings.botSpeed = 0;
  const diffs = String(a.d).split(',').map(Number);
  const basics = await MTG.draft.getBasics();
  const make = { booster: drafted, sealed, jumpstart }[a.format];
  if (!make) throw new Error('--format is booster, sealed or jumpstart');
  const seats = await make(MTG, a, diffs, basics);
  const formatId = a.format;
  let invalid = 0;
  seats.forEach(({ name, deck }, i) => {
    const extra = (deck.conspiracies || []).map(c => c.card.name + (c.names ? ' (' + c.names.join(', ') + ')' : ''))
      .concat((deck.draftExiled || []).map(x => x.card.name + ' exiled for ' + x.with));
    if (extra.length) console.log(`\n${name} starts with: ${extra.join('; ')}`);
    const st = MTG.formats.deckStats(deck.main, []);
    const v = MTG.formats.validate(deck, formatId);
    if (!v.ok) invalid++;
    const manual = deck.main.filter(e => !MTG.oracle.analyze(e.card).fullyAutomated && !MTG.oracle.analyze(e.card).isLand).map(e => e.card.name);
    console.log(`\n${name}: ${(deck.colors || []).join('')} ${st.total} cards, ${st.lands} lands, ${st.creatures} creatures, avg mv ${st.avgMv}, curve ${Object.values(st.curve).join('/')}, not automated: ${manual.length ? manual.join(', ') : 'none'}${v.ok ? '' : ', NOT LEGAL: ' + v.errors.join(' ')}`);
    if (i < a.show) console.log('  ' + deck.main.slice().sort((x, y) => (x.card.cmc || 0) - (y.card.cmc || 0)).map(e => `${e.qty} ${e.card.name}`).join('\n  '));
  });
  let errors = 0, stalls = 0, withErrors = 0, unfinished = 0, turns = 0;
  const wins = {};
  for (let g = 0; g < a.games; g++) {
    const i = g % seats.length, j = (g + 1) % seats.length;
    const di = seats[i].difficulty, dj = seats[j].difficulty;
    const pair = [{ id: 'A', play: di, deck: di, diff: di, deckSeed: 0 }, { id: 'B', play: dj, deck: dj, diff: dj, deckSeed: 1 }];
    const r = await playOne(MTG, { formatId, seed: a.seed * 100 + g, seats: pair, maxTurns: 40, decks: [seats[i].deck, seats[j].deck] });
    errors += r.errors.length; stalls += r.stalled ? 1 : 0; withErrors += r.errors.length ? 1 : 0;
    unfinished += r.over ? 0 : 1; turns += r.turns;
    const w = r.winner === 'A' ? i : r.winner === 'B' ? j : null;
    if (w != null) wins[seats[w].name] = (wins[seats[w].name] || 0) + 1;
    console.log(`game ${g + 1}: ${seats[i].name} v ${seats[j].name}: ${w == null ? (r.stalled ? 'STALLED' : 'no winner') : 'won by ' + seats[w].name} in ${r.turns} turns${r.errors.length ? ' errors=' + r.errors.length + ' ' + r.errors.slice(0, 2).join(' | ') : ''}`);
  }
  console.log('\nwins', JSON.stringify(wins), 'errors', errors, 'stalls', stalls);
  console.log('summary', JSON.stringify({
    format: formatId, games: a.games, unfinished, stalled: stalls, withErrors, invalidDecks: invalid,
    avgTurns: a.games ? +(turns / a.games).toFixed(1) : 0,
    offlineMisses: globalThis.__offlineMisses ? globalThis.__offlineMisses() : 0,
  }));
  process.exit(invalid ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
