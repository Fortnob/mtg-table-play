/* ===== 15a-brackets.js ===== */
/* ============================================================
   15a-brackets.js - Commander brackets
   The five brackets Commander is played in (Exhibition, Core, Upgraded,
   Optimized, cEDH), and where a deck falls among them by what can be read
   off its list: how many Game Changers it runs, whether it takes the
   table's lands away, how many extra turns it takes, and whether two of
   its cards make an infinite combo, early or late. Tutors once counted
   and no longer do. Bracket 5 is a Bracket 4 deck built to win a
   tournament, which no list says, so nothing is put there by reading it.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* Each bracket: what it is (about) and what it allows, one rule a line (rules); the blurb is the two in a sentence */
  /** @type {Array<null|{n:number, name:string, about:string, rules:string[], blurb:string}>} by number */
  const BRACKETS = [
    null,
    { n: 1, name: 'Exhibition', about: 'Decks built to show off an idea more than to win.',
      rules: ['No Game Changers', 'No mass land denial', 'No extra turns', 'No two-card combos'] },
    { n: 2, name: 'Core', about: 'About as strong as a typical preconstructed deck.',
      rules: ['No Game Changers', 'No mass land denial', 'No two-card combos', 'An extra turn here and there, never one after another'] },
    { n: 3, name: 'Upgraded', about: 'Stronger than a precon.',
      rules: ['Up to three Game Changers', 'No mass land denial', 'No two-card combo that comes together early', 'Extra turns never one after another'] },
    { n: 4, name: 'Optimized', about: 'High power.', rules: ['Anything the banned list allows'] },
    { n: 5, name: 'cEDH', about: 'Competitive: the strongest decks.', rules: ['Built for tournament play', 'Anything the banned list allows'] },
  ];
  for (const b of BRACKETS) if (b) b.blurb = b.about + ' ' + b.rules.map((r, i) => (i ? r.charAt(0).toLowerCase() + r.slice(1) : r)).join('; ') + '.';
  const nameOf = (n) => (BRACKETS[n] ? BRACKETS[n].name : '');
  const label = (n) => (BRACKETS[n] ? `Bracket ${n} · ${BRACKETS[n].name}` : 'Any bracket');

  // the rules text, without its reminders: "gift an extra turn" is one for an opponent
  const textOf = (c) => (c.card_faces && c.card_faces.length
    ? c.card_faces.map(f => f.oracle_text || '').join('\n')
    : c.oracle_text || '').replace(/\([^)]*\)/g, '');

  /* The list as it stood when this was written (February 2026), for a card
     kept from before the app held on to Scryfall's word for it. Scryfall's
     word wins wherever there is one: on the card, or in the card database. */
  const GC_KNOWN = new Set([
    'Ad Nauseam', 'Ancient Tomb', 'Aura Shards', 'Biorhythm', "Bolas's Citadel", 'Braids, Cabal Minion', 'Chrome Mox',
    'Coalition Victory', 'Consecrated Sphinx', 'Crop Rotation', 'Cyclonic Rift', 'Demonic Tutor', 'Drannith Magistrate',
    'Enlightened Tutor', 'Farewell', 'Field of the Dead', 'Fierce Guardianship', 'Force of Will', "Gaea's Cradle", 'Gamble',
    'Gifts Ungiven', 'Glacial Chasm', 'Grand Arbiter Augustin IV', 'Grim Monolith', 'Humility', 'Imperial Seal', 'Intuition',
    "Jeska's Will", "Lion's Eye Diamond", 'Mana Vault', "Mishra's Workshop", 'Mox Diamond', 'Mystical Tutor',
    'Narset, Parter of Veils', 'Natural Order', 'Necropotence', 'Notion Thief', 'Opposition Agent', 'Orcish Bowmasters',
    'Panoptic Mirror', 'Rhystic Study', 'Seedborn Muse', "Serra's Sanctum", 'Smothering Tithe', 'Survival of the Fittest',
    "Teferi's Protection", 'Tergrid, God of Fright', "Thassa's Oracle", 'The One Ring', 'The Tabernacle at Pendrell Vale',
    'Underworld Breach', 'Vampiric Tutor', 'Worldly Tutor',
  ].map(n => U.normName(n)));

  /** On the Game Changers list. */
  function isGameChanger(c) {
    if (!c) return false;
    if (c.game_changer === true || c.game_changer === false) return c.game_changer;
    const idx = MTG.cardDb && MTG.cardDb.idx;
    const d = idx && c.name ? idx.byNameCard(c.name) : null;
    if (d) return !!d.game_changer;
    return GC_KNOWN.has(U.normName(U.frontName(c.name || '')));
  }

  /* Mass land denial: cards that destroy, exile or bounce lands, keep them
     tapped, or change the mana they make, four or more a player at once,
     without giving them back. The text catches the plain ones; the rest are
     named. */
  const MLD_NAMES = new Set([
    'Armageddon', 'Ravages of War', 'Catastrophe', 'Decree of Annihilation', 'Jokulhaups', 'Obliterate',
    'Worldfire', 'Apocalypse', 'Devastation', 'Ruination', 'Wildfire', 'Destructive Force', 'Burning of Xinye',
    'Impending Disaster', 'Boom // Bust', 'Death Cloud', 'Global Ruin', 'Cataclysm', 'Fall of the Thran',
    'Thoughts of Ruin', 'Myojin of Infinite Rage', 'Wake of Destruction', 'Acid Rain', 'Tsunami', 'Flashfires',
    'Boil', 'Choke', 'Epicenter', 'Sunder', 'Hokori, Dust Drinker', 'Rising Waters', 'Winter Orb', 'Static Orb',
    'Stasis', 'Blood Moon', 'Magus of the Moon', 'Back to Basics', 'Contamination', 'Infernal Darkness',
    'Mana Vortex', 'Keldon Firebombers', 'Bend or Break', 'Upheaval', 'Sway of the Stars', 'Desolation Angel',
  ].map(n => U.normName(n)));
  const LAND = '(?:non-?basic )?lands';
  const BASIC = '(?:plains|islands|swamps|mountains|forests)';
  const MLD_TEXT = [
    new RegExp(`\\b(?:destroy|exile) all (?:${LAND}|${BASIC})\\b(?! (?:you|target player) control)`, 'i'),
    new RegExp(`\\b(?:destroy|exile) all (?:(?!except)[a-z, ])*\\band ${LAND}\\b`, 'i'),
    new RegExp(`\\beach player sacrifices (?:all|four|five|six|seven|x) ${LAND}\\b`, 'i'),
    new RegExp(`\\breturn all ${LAND} to their owners' hands\\b`, 'i'),
    /\blands don't untap during their controllers' untap steps\b/i,
    /\bplayers skip their untap steps\b/i,
    /\bplayers can't untap more than (?:one|two) (?:lands?|permanents?)\b/i,
    new RegExp(`\\bnonbasic lands are ${BASIC}\\b`, 'i'),
  ];
  function isMassLandDenial(c) {
    if (!c) return false;
    if (MLD_NAMES.has(U.normName(c.name)) || MLD_NAMES.has(U.normName(U.frontName(c.name)))) return true;
    const t = textOf(c);
    return MLD_TEXT.some(re => re.test(t));
  }

  // an extra turn that goes to an opponent, after you have taken theirs
  const NOT_TURNS = new Set(['Emrakul, the Promised End'].map(n => U.normName(n)));
  /** Takes an extra turn (or gives one), as opposed to stopping them. */
  function takesExtraTurn(c) {
    if (!c || NOT_TURNS.has(U.normName(c.name))) return false;
    const t = textOf(c);
    return /\btakes? (?:an|one|two|three|that many|x) extra turns?\b/i.test(t);
  }

  /* Two-card combos: the ones the curated table knows, and the loops the
     engine reads off the text when it is sure of them. A combo is early
     when both halves could be on the table by turn five on curve: the
     cheaper costs four or less and the dearer five or less. */
  function manaValue(deck, name) {
    const n = U.normName(name);
    const all = (deck.commanders || []).concat((deck.main || []).map(e => e.card));
    const c = all.find(x => x && (U.normName(x.name) === n || U.normName(U.frontName(x.name)) === n));
    return c ? (c.cmc || 0) : 0;
  }
  function twoCardCombos(deck) {
    if (!MTG.combos) return [];
    let res;
    try { res = MTG.combos.quickScan(deck); } catch (e) { return []; }
    const out = [];
    for (const c of res.combos || []) {
      if (!c.pieces || c.pieces.length !== 2) continue;
      if (c.kind !== 'infinite' && c.kind !== 'win') continue;
      if (c.source === 'engine' && c.confidence !== 'certain') continue;
      const mv = c.pieces.map(p => manaValue(deck, p)).sort((a, b) => a - b);
      out.push({ pieces: c.pieces.slice(), does: (c.produces || [])[0] || '', how: c.steps || '', early: mv[0] <= 4 && mv[1] <= 5, mv });
    }
    return out;
  }

  /** Each different card in the deck once, its commanders first. */
  function cardsOf(deck) {
    const seen = new Set(), out = [];
    const add = (c, cmd) => {
      if (!c || !c.name) return;
      const k = U.normName(c.name);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ card: c, cmd });
    };
    for (const c of deck.commanders || []) add(c, true);
    for (const e of deck.main || []) add(e.card, false);
    if (deck.companion) add(deck.companion, false);
    return out;
  }

  const cache = new Map();
  /**
   * Where a deck falls.
   *   bracket: the bracket to show (two at the least: a deck with nothing
   *            past Bracket 1 is still most likely a Core deck);
   *   min:     the lowest bracket whose rules it keeps, for a table's limit;
   *   reasons: what puts it there, each with its cards and the bracket it
   *            asks for, the highest first.
   */
  function estimate(deck) {
    if (!deck) return { bracket: 2, min: 1, reasons: [], gameChangers: [] };
    const list = cardsOf(deck);
    const sig = list.map(x => (x.cmd ? '*' : '') + U.normName(x.card.name)).sort().join('|');
    if (cache.has(sig)) return cache.get(sig);
    const named = (xs) => xs.map(x => x.card.name);
    const reasons = [];

    const gc = list.filter(x => isGameChanger(x.card));
    if (gc.length) reasons.push({
      key: 'gc', title: 'Game Changers', bracket: gc.length > 3 ? 4 : 3, cards: named(gc),
      why: gc.length > 3
        ? `${gc.length} Game Changers: Bracket 3 allows three, Bracket 4 any number.`
        : `${gc.length === 1 ? 'A Game Changer' : gc.length + ' Game Changers'}: Brackets 1 and 2 have none, Bracket 3 up to three.`,
    });
    const mld = list.filter(x => isMassLandDenial(x.card));
    if (mld.length) reasons.push({
      key: 'mld', title: 'Mass land denial', bracket: 4, cards: named(mld),
      why: 'Taking every player’s lands away (or their mana) is for Bracket 4 and up.',
    });
    const turns = list.filter(x => takesExtraTurn(x.card));
    if (turns.length) reasons.push({
      key: 'turns', title: 'Extra turns', bracket: turns.length >= 3 ? 4 : 2, cards: named(turns),
      why: turns.length >= 3
        ? `${turns.length} cards that take extra turns, enough to chain them: Bracket 4.`
        : 'Bracket 1 has none; Brackets 2 and 3 a few, never one after another.',
    });
    const combos = twoCardCombos(deck);
    if (combos.length) {
      const early = combos.filter(c => c.early);
      const pieces = [...new Set(combos.flatMap(c => c.pieces))];
      reasons.push({
        key: 'combo', title: 'Two-card combos', bracket: early.length ? 4 : 3, cards: pieces, combos,
        why: early.length
          ? 'A two-card combo that can come together early, by turn five or so: Bracket 4.'
          : 'Two-card combos that come together only late: Bracket 3 at the least.',
      });
    }
    reasons.sort((a, b) => b.bracket - a.bracket);
    const min = Math.max(1, ...reasons.map(r => r.bracket));
    const out = { bracket: Math.max(2, min), min, reasons, gameChangers: named(gc) };
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    cache.set(sig, out);
    return out;
  }

  /** Whether a deck keeps a table's bracket (0: no limit). */
  function fits(deck, n) {
    return !n || estimate(deck).min <= n;
  }

  /** Why it does not, in a sentence, or null when it does. */
  function overBy(deck, n) {
    if (!n) return null;
    const e = estimate(deck);
    if (e.min <= n) return null;
    const over = e.reasons.filter(r => r.bracket > n);
    const bits = over.map(r => {
      if (r.key === 'gc') return n >= 3 ? `${r.cards.length} Game Changers (three at most)` : `Game Changers (${r.cards.join(', ')})`;
      if (r.key === 'mld') return `mass land denial (${r.cards.join(', ')})`;
      if (r.key === 'turns') return n === 1 ? `extra turns (${r.cards.join(', ')})` : `${r.cards.length} extra-turn cards`;
      return `a two-card combo (${r.combos.filter(c => n >= 3 ? c.early : true).map(c => c.pieces.join(' + ')).slice(0, 2).join('; ')})`;
    });
    return `This table plays ${label(n)}; this deck needs Bracket ${e.min} for ${bits.join(', ')}.`;
  }

  /** Whether a card may go in a deck for a table at bracket n on its own account (combos aside). */
  function allowedCard(c, n) {
    if (!n || n >= 4) return true;
    if (n <= 2 && isGameChanger(c)) return false;
    if (n === 1 && takesExtraTurn(c)) return false;
    return !isMassLandDenial(c);
  }

  /**
   * The cards to take out of a deck to bring it down to bracket n: what goes
   * past it, keeping the first three Game Changers and the first two extra
   * turns where those are allowed, and one card of each combo that is not.
   * Commanders stay. Names, normalised.
   */
  function excess(deck, n) {
    const out = new Set();
    if (!n || n >= 4) return out;
    const e = estimate(deck);
    const cmds = new Set((deck.commanders || []).map(c => U.normName(c.name)));
    const cut = (names) => { for (const x of names) if (!cmds.has(U.normName(x))) out.add(U.normName(x)); };
    for (const r of e.reasons) {
      if (r.bracket <= n) continue;
      if (r.key === 'gc') cut(n >= 3 ? r.cards.filter(x => !cmds.has(U.normName(x))).slice(3) : r.cards);
      else if (r.key === 'turns') cut(n >= 2 ? r.cards.slice(2) : r.cards);
      else if (r.key === 'combo') {
        for (const c of r.combos) {
          if (n >= 3 && !c.early) continue;
          const piece = c.pieces.find(p => !cmds.has(U.normName(p)));
          if (piece) cut([piece]);
        }
      } else cut(r.cards);
    }
    return out;
  }

  MTG.brackets = {
    BRACKETS, nameOf, label, estimate, fits, overBy, allowedCard, excess,
    isGameChanger, isMassLandDenial, takesExtraTurn, twoCardCombos,
  };
})(window.MTG);
