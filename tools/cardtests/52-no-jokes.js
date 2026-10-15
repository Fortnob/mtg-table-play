/* Joke and playtest cards are not in the game (src/02-scryfall.js, MTG.jokes): Unfinity and the other
   Un-sets, the Mystery Booster playtest cards, everything Scryfall marks a joke. Checked against the bulk
   file's own set, stamp, border and promo fields, every card of it; and the card database (src/02a-carddb.js)
   built from printings made up to look like Scryfall's, since the bulk file here has one printing a card.
   The Scryfall client's queries are checked in tools/jokestest.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { card, engine } = require('../harness');

module.exports = (test) => {
  const J = () => engine().jokes;
  let bulk = null;
  /** Every card in the bulk file, as Scryfall has it. */
  const all = () => {
    if (bulk) return bulk;
    bulk = [];
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '..', 'oracle-cards.jsonl.gz'))).toString('utf8');
    for (const line of raw.split('\n')) if (line.trim()) bulk.push(JSON.parse(line));
    return bulk;
  };
  // the sets a joke's printing comes from, as the bulk file names them: of the "funny" kind, and their tokens and promos
  const jokeSets = () => {
    const funny = new Set(all().filter(c => c.set_type === 'funny').map(c => c.set));
    for (const c of all()) if (/^[tp]/.test(c.set) && funny.has(c.set.slice(1))) funny.add(c.set);
    return funny;
  };
  const slim = (c) => engine().scry.slim(c);
  const named = (n) => all().find(c => c.name === n && c.layout !== 'token');

  test('Jokes: every set Scryfall calls a joke is one, its tokens and promos too', (mk, t) => {
    for (const s of jokeSets()) t.ok(J().isSet(s), s + ' is a joke set');
    for (const s of ['unf', 'sunf', 'tunf', 'ulst', 'ugl', 'unh', 'ust', 'und', 'unk', 'cmb1', 'cmb2']) t.ok(J().isSet(s), s);
    for (const s of ['m21', 'plst', 'mb2', 'sld', 'blc', '2xm']) t.no(J().isSet(s), s + ' is not');
  });

  test('Jokes: no card printed only in Unfinity is in the pool, nor any other joke or playtest card', (mk, t) => {
    const sets = jokeSets();
    let n = 0, unf = 0;
    for (const c of all()) {
      if (/^(art_series)$/.test(c.layout)) continue;
      const joke = sets.has(c.set) || c.security_stamp === 'acorn' || c.border_color === 'silver' || (c.promo_types || []).includes('playtest');
      if (!joke) continue;
      const s = slim(c);
      if (/Basic/.test(c.type_line || '')) {
        // a basic land is never out; only Unfinity's printings of them are shown
        t.no(J().isCard(s), c.name + ' (' + c.set + '): a basic land stays');
        t.eq(J().printOk(s), c.set === 'unf', c.name + ' (' + c.set + '): only Unfinity\'s basics as art');
        continue;
      }
      // the acorn stamp alone (Mystery Booster Commander's Alchemy cards) hides the printing, not the card
      const acornOnly = !sets.has(c.set) && c.border_color !== 'silver' && !(c.promo_types || []).includes('playtest');
      t.no(J().inPool(s), `${c.name} (${c.set}) is not in the pool`);
      t.no(engine().scry.inPool(s), `${c.name} (${c.set}): MTG.scry.inPool says so too`);
      if (!acornOnly && !['Saw in Half', 'Steamflogger Boss'].includes(c.name)) t.ok(J().isCard(s), `${c.name} (${c.set}) is a joke card`);
      n++;
      if (['unf', 'sunf', 'tunf'].includes(c.set)) unf++;
    }
    t.ok(n > 1400, 'well over a thousand of them in the bulk file (' + n + ')');
    t.ok(unf > 250, 'Unfinity\'s among them (' + unf + ')');
    // and the ones printed elsewhere since, by name
    t.ok(J().isCard(slim(named('Fetching Garden'))), 'Fetching Garden, a playtest card, is out');
    for (const n of ['Comet, Stellar Pup', 'Space Beleren', 'Clown Car', 'Attempted Murder', 'Exchange of Words', 'Blacker Lotus']) {
      const c = named(n);
      t.ok(c, n + ' is in the bulk file');
      t.ok(J().isCard(slim(c)), n + ' is out');
      t.ok(J().isCard(Object.assign({}, slim(c), { set: 'plst', set_type: 'masters', security_stamp: undefined, promo_types: null, border_color: 'black' })),
        n + ': out in a reprint list\'s printing too');
    }
  });

  test('Jokes: a card printed for real as well stays, without its joke printings', (mk, t) => {
    for (const n of ['Saw in Half', 'Steamflogger Boss', 'Steam Vents', 'Plains', 'Lightning Bolt', 'Pick Your Poison']) {
      const c = card(n);
      t.no(J().isCard(c), n + ' is a card of the game');
      if (n !== 'Lightning Bolt' && n !== 'Pick Your Poison') t.no(J().isCard(Object.assign({}, c, { set: 'unf', set_type: 'funny' })), n + ': its card stays, whatever printing');
    }
    // a real card's joke printing is not one to show, but Unfinity's basics
    const vents = slim(named('Steam Vents'));
    t.no(J().printOk(Object.assign({}, vents, { set: 'unf', set_type: 'funny' })), 'Unfinity\'s Steam Vents is not shown');
    const plains = slim(named('Plains'));
    t.ok(J().printOk(Object.assign({}, plains, { set: 'unf', set_type: 'funny', full_art: true })), 'Unfinity\'s galaxy Plains is');
    t.no(J().printOk(Object.assign({}, plains, { set: 'unh', set_type: 'funny', border_color: 'silver' })), 'Unhinged\'s is not');
  });

  test('Jokes: what a held card is told', (mk, t) => {
    t.eq(J().why(slim(named('Space Beleren'))), 'Unfinity cards aren’t in this game');
    t.eq(J().why(Object.assign({}, slim(named('Clown Car')), { set: 'plst' })), 'Unfinity cards aren’t in this game', 'by the card, whatever its printing');
    t.eq(J().why(slim(named('Fetching Garden'))), 'Joke and playtest cards aren’t in this game');
    t.eq(J().why(slim(named('Booster Tutor'))), 'Joke and playtest cards aren’t in this game');
  });

  test('Jokes: the Scryfall query leaves them out, the words that show it outside the brackets', (mk, t) => {
    const q = J().query('t:goblin c:r unique:prints order:released');
    t.eq(q, '(t:goblin c:r) ' + J().QUERY + ' unique:prints order:released');
    t.ok(/is:funny/.test(J().QUERY) && /st:funny/.test(J().QUERY) && /e:tunf/.test(J().QUERY), 'jokes, joke sets and their tokens');
    t.ok(/-\(e:unf t:basic\)/.test(J().QUERY), 'but Unfinity\'s basics');
    t.eq(J().query(q), q, 'asked once');
    t.eq(J().query(''), J().QUERY, 'nothing else asked: the leaving out alone');
  });

  test('Jokes: a deck holding one keeps it, marked, and is not played', (mk, t) => {
    const F = engine().formats;
    const deck = { format: 'commander', sideboard: [], commanders: [card("Atraxa, Praetors' Voice")],
      main: [{ card: slim(named('Space Beleren')), qty: 1 }, { card: card('Forest'), qty: 98 }] };
    const v = F.validate(deck, 'commander');
    t.no(v.ok, 'not legal');
    t.ok(v.errors.some(e => /Space Beleren: Unfinity cards aren’t in this game/.test(e)), 'and why: ' + v.errors.join(' | '));
    t.eq((F.cardIssuesFor(v, deck.main[0].card) || []).join(), 'Unfinity cards aren’t in this game', 'the card is marked so');
    t.eq(F.cardProblem(slim(named('Fetching Garden')), F.get('vintage')), 'Joke and playtest cards aren’t in this game', 'in the search too');
    // the economy takes none in: not opened, bought, crafted or traded
    const E = engine().economy;
    if (E && E.addCard) t.eq(E.addCard(slim(named('Clown Car')), 1).isNew, false, 'the collection takes none');
  });

  /* ---- the card database, from printings like Scryfall's ---- */
  const LEGAL = { commander: 'legal', vintage: 'legal' };
  let seq = 0;
  const pr = (name, set, more) => {
    const c = named(name) || {};
    return Object.assign({
      object: 'card', id: 'id-' + (++seq) + '-' + set, oracle_id: c.oracle_id || ('o-' + name), name, layout: c.layout || 'normal',
      type_line: c.type_line, oracle_text: c.oracle_text || '', mana_cost: c.mana_cost, cmc: c.cmc, colors: c.colors || [],
      color_identity: c.color_identity || [], legalities: LEGAL, set, set_name: set, set_type: 'expansion', collector_number: String(seq),
      rarity: 'common', released_at: '2020-01-01', lang: 'en', games: ['paper'], border_color: 'black', finishes: ['nonfoil'],
      reprint: false, image_uris: { normal: 'x', small: 'x', large: 'x', art_crop: 'x', png: 'x' },
    }, more || {});
  };
  const funny = { set_type: 'funny' };
  const db = () => {
    const P = new (engine().cardDb.Packer)('default_cards');
    for (const c of [
      pr('Plains', 'm21'), pr('Plains', 'unf', Object.assign({ reprint: true, full_art: true }, funny)), pr('Plains', 'unh', Object.assign({ reprint: true, border_color: 'silver' }, funny)),
      pr('Steam Vents', 'grn'), pr('Steam Vents', 'unf', Object.assign({ reprint: true }, funny)),
      pr('Comet, Stellar Pup', 'unf', funny), pr('Comet, Stellar Pup', 'mb2', { set_type: 'masters', reprint: true }),
      pr('Space Beleren', 'unf', funny), pr('Space Beleren', 'plst', { set_type: 'masters', reprint: true }),
      pr('Clown Car', 'unf', funny), pr('Saw in Half', 'unf', funny), pr('Saw in Half', 'blc', { set_type: 'commander', reprint: true }),
      pr('Fetching Garden', 'mb2', { set_type: 'masters', promo_types: ['playtest'] }), pr('Booster Tutor', 'unh', Object.assign({ border_color: 'silver' }, funny)),
      pr('Lightning Bolt', 'm11'),
    ]) P.add(c);
    return new (engine().cardDb.Index)(P.finish(), {});
  };
  const names = (I, q, o) => I.search(q, o).map(c => c.name);

  test('Jokes: the card database finds none of them, and keeps Unfinity\'s basics as art', (mk, t) => {
    const I = db();
    for (const n of ['Comet, Stellar Pup', 'Space Beleren', 'Clown Car', 'Fetching Garden', 'Booster Tutor'])
      t.eq(names(I, '!"' + n + '"').length, 0, n + ': not found');
    t.eq(names(I, 'clown').length, 0, 'not by a word of the name either');
    t.eq(I.autocomplete('Space Bel').length, 0, 'nor suggested');
    t.eq(names(I, 'saw in half').join(), 'Saw in Half', 'Saw in Half is, printed for real in Bloomburrow Commander');
    t.eq(I.search('!"Saw in Half"', { unique: 'prints' }).map(c => c.set).join(), 'blc', 'in that printing only');
    t.eq(I.search('!"Steam Vents"', { unique: 'prints' }).map(c => c.set).join(), 'grn', 'Steam Vents without its Unfinity printing');
    t.eq(I.search('!"Plains"', { unique: 'prints', order: 'set' }).map(c => c.set).sort().join(), 'm21,unf', 'Plains: Unfinity\'s galaxy art kept, Unhinged\'s not');
    t.ok(!I.setList().some(s => J().isSet(s.code)), 'no joke set to draft or open');
    // a deck that holds one still finds it, to show it marked
    const held = I.byNameCard('Space Beleren');
    t.ok(held && J().isCard(held), 'a held Space Beleren is still found by name, and known for what it is');
  });
};
