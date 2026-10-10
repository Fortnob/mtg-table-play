/* ============================================================
   04-formats.js - format definitions, legality and deck validation
   Legality comes live from Scryfall's `legalities` object, so ban-list
   updates arrive without touching this file. Pauper leans on Scryfall's
   `pauper` key, which is the commons-only list, rarity checks and all.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* A format descriptor drives deck validation, the lobby, and setup. */
  const FORMATS = {
    standard: {
      id: 'standard', name: 'Standard', scryKey: 'standard', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: 60, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Rotating constructed. 60-card minimum, up to 4 copies of a card, 15-card sideboard.',
    },
    modern: {
      id: 'modern', name: 'Modern', scryKey: 'modern', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: null, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Non-rotating constructed: every card from Eighth Edition onwards. 60-card minimum, up to 4 copies, 15-card sideboard.',
    },
    pioneer: {
      id: 'pioneer', name: 'Pioneer', scryKey: 'pioneer', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: null, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Non-rotating constructed: every card from Return to Ravnica onwards. 60-card minimum, up to 4 copies, 15-card sideboard.',
    },
    legacy: {
      id: 'legacy', name: 'Legacy', scryKey: 'legacy', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: null, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Every card ever printed, bar a banned list. 60-card minimum, up to 4 copies, 15-card sideboard.',
    },
    /* Vintage bans next to nothing: its strongest cards are restricted
       instead, one copy allowed, which Scryfall says as 'restricted'. */
    vintage: {
      id: 'vintage', name: 'Vintage', scryKey: 'vintage', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: null, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Every card ever printed, the Power Nine too: the strongest are restricted to one copy rather than banned. 60-card minimum, 15-card sideboard.',
    },
    pauper: {
      id: 'pauper', name: 'Pauper', scryKey: 'pauper', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 20, startingHand: 7, maxCopies: 4,
      deckMin: 60, deckMax: null, exactSize: false, sideboardMax: 15,
      singleton: false, commander: false, commanderDamage: null,
      firstPlayerDraws: false,
      blurb: 'Commons only, from every set ever printed. 60-card minimum, up to 4 copies, 15-card sideboard.',
    },
    commander: {
      id: 'commander', name: 'Commander', scryKey: 'commander', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 4,
      startingLife: 40, startingHand: 7, maxCopies: 1,
      deckMin: 100, deckMax: 100, exactSize: true, sideboardMax: 0,
      singleton: true, commander: true, commanderCount: 1, commanderDamage: 21,
      colorIdentity: true, firstPlayerDraws: false,
      blurb: 'Multiplayer singleton. Exactly 100 cards including your commander, 40 life, 21 commander damage.',
      // the Commander brackets (src/15a-brackets.js) are written for this format alone
      hasBrackets: true,
    },
    /* Commander in sixty cards. A planeswalker may lead as well as a
       legendary creature (walkerCommander), and there is no commander
       damage. 25 life is the two-player number; a bigger table plays at 30. */
    brawl: {
      id: 'brawl', name: 'Brawl', scryKey: 'brawl', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 2,
      startingLife: 25, multiplayerLife: 30, startingHand: 7, maxCopies: 1,
      deckMin: 60, deckMax: 60, exactSize: true, sideboardMax: 0,
      singleton: true, commander: true, commanderCount: 1, commanderDamage: null,
      colorIdentity: true, walkerCommander: true, firstPlayerDraws: false,
      blurb: 'Commander in sixty cards: a legendary creature or a planeswalker leads a singleton deck. 25 life (30 with more than two), no commander damage.',
    },
    /* A planeswalker leads (the Oathbreaker), and beside it in the command
       zone waits its Signature Spell: an instant or sorcery in its colours,
       cast only while the Oathbreaker is on the battlefield and back to the
       command zone every time. Both ride in deck.commanders, the spell after
       the planeswalker; its card type says which is which (isSignatureSpell). */
    oathbreaker: {
      id: 'oathbreaker', name: 'Oathbreaker', scryKey: 'oathbreaker', kind: 'constructed',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 4,
      startingLife: 20, startingHand: 7, maxCopies: 1,
      deckMin: 60, deckMax: 60, exactSize: true, sideboardMax: 0,
      singleton: true, commander: true, commanderCount: 1, commanderDamage: null,
      colorIdentity: true, oathbreaker: true, firstPlayerDraws: false,
      blurb: 'A planeswalker leads a 60-card singleton deck, with a Signature Spell it can cast again and again. 20 life, no commander damage.',
    },
    booster: {
      id: 'booster', name: 'Booster Draft', scryKey: null, kind: 'limited',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 8,
      startingLife: 20, startingHand: 7, maxCopies: null,
      deckMin: 40, deckMax: null, exactSize: false, sideboardMax: null,
      singleton: false, commander: false, basicsFree: true,
      draft: { style: 'booster', packs: 3, packSize: 14, picksPerTurn: 1 },
      blurb: '8 players, 3 packs each, pick one card and pass. Build a 40-card deck; basic lands are free.',
    },
    picktwo: {
      id: 'picktwo', name: 'Pick-Two Draft', scryKey: null, kind: 'limited',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 4,
      startingLife: 20, startingHand: 7, deckMin: 40, basicsFree: true,
      draft: { style: 'booster', packs: 3, packSize: 14, picksPerTurn: 2 },
      blurb: 'Booster draft, two cards per pick. Faster, deeper pools, great for small pods.',
    },
    chaos: {
      id: 'chaos', name: 'Chaos Draft', scryKey: null, kind: 'limited',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 8,
      startingLife: 20, startingHand: 7, deckMin: 40, basicsFree: true,
      draft: { style: 'chaos', packs: 3, packSize: 14, picksPerTurn: 1 },
      blurb: 'Every pack is from a different random set. Anything can happen.',
    },
    cube: {
      id: 'cube', name: 'Cube Draft', scryKey: null, kind: 'limited',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 8,
      startingLife: 20, startingHand: 7, deckMin: 40, basicsFree: true,
      draft: { style: 'cube', packs: 3, packSize: 15, picksPerTurn: 1 },
      blurb: 'Draft from a curated singleton cube. Import a CubeCobra list or paste your own.',
    },
    cmdrdraft: {
      id: 'cmdrdraft', name: 'Commander Draft', scryKey: null, kind: 'limited',
      minPlayers: 2, maxPlayers: 8, defaultPlayers: 4,
      startingLife: 40, startingHand: 7, commanderDamage: 21,
      deckMin: 60, deckMax: null, exactSize: false,
      commander: true, commanderCount: 1, basicsFree: true,
      colorIdentity: false,
      draft: { style: 'commander', packs: 3, packSize: 20, picksPerTurn: 1, faceUp: true },
      blurb: 'Draft a pool, choose a legendary creature from it as your commander, build 60 cards. 40 life.',
    },
  };

  // the commander formats together, then the sixty-card ones from newest cards to oldest, then limited
  const FORMAT_ORDER = ['commander', 'brawl', 'oathbreaker', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper',
    'cmdrdraft', 'booster', 'picktwo', 'chaos', 'cube'];

  /* -------- helpers -------- */

  /* A basic land is said on the type line ("Basic Land — Forest"), so
     that is all this reads: a card whose rules text cannot be read must
     not stop a set's cards from loading. */
  function isBasicLand(card) {
    if (!card) return false;
    const tl = String((card.card_faces && card.card_faces[0] && card.card_faces[0].type_line) || card.type_line || '');
    if (tl) return /\bBasic\b/.test(tl.split(/\s+\/\/\s+/)[0]) && /\bLand\b/.test(tl);
    try { const a = MTG.oracle.analyze(card); return !!(a && a.isBasicLand); } catch (e) { return false; }
  }
  /** Cards exempt from the singleton / 4-copy rule. */
  function unlimitedAllowed(card) {
    if (isBasicLand(card)) return true;
    const t = card.oracle_text || '';
    return /A deck can have any number of cards named/i.test(t);
  }

  function legalityOf(card, fmt) {
    const key = fmt.scryKey;
    if (!key) return 'legal';                        // limited: anything in the pool
    const l = (card.legalities || {})[key];
    return l || 'not_legal';
  }

  /** Color identity of a card, as Scryfall computes it (includes text-box pips). */
  function colorIdentity(card) { return card.color_identity || []; }

  function canBeCommander(card, fmt) {
    const a = MTG.oracle.analyze(card);
    if (!a) return false;
    // an Oathbreaker is a planeswalker, and nothing else will do
    if (fmt && fmt.oathbreaker) return !!a.isPlaneswalker;
    const text = card.oracle_text || '';
    if (a.isLegendary && a.isCreature) return true;
    // Brawl: a planeswalker may lead as well
    if (fmt && fmt.walkerCommander && a.isPlaneswalker) return true;
    if (/can be your commander/i.test(text)) return true;
    // back face of a transforming legend (e.g. a legendary creature // planeswalker)
    if (card.card_faces) {
      for (let i = 0; i < card.card_faces.length; i++) {
        const fa = MTG.oracle.analyze(card, i);
        if (fa && fa.isLegendary && fa.isCreature) return true;
      }
    }
    return false;
  }

  function partnerInfo(card) {
    const t = card.oracle_text || '';
    return {
      partner: /\bPartner\b(?!\s+with)/i.test(t),
      partnerWith: (t.match(/Partner with ([^\n(]+)/i) || [])[1] || null,
      friendsForever: /Friends forever/i.test(t),
      background: /Choose a Background/i.test(t),
      isBackground: /\bBackground\b/.test(card.type_line || ''),
      doctor: /Doctor's companion/i.test(t),
    };
  }

  /** What may lead a deck in this format, in words, for a message or a search's note. */
  function commanderRule(fmt) {
    if (fmt && fmt.oathbreaker) return 'a planeswalker';
    if (fmt && fmt.walkerCommander) return 'a legendary creature or a planeswalker';
    return 'a legendary creature, or a card that says it can be your commander';
  }
  /** The same as a search: what the commander search adds to whatever is typed. */
  function commanderQuery(fmt) {
    if (fmt && fmt.oathbreaker) return 't:planeswalker';
    if (fmt && fmt.walkerCommander) return '(is:commander or t:planeswalker)';
    return 'is:commander';
  }

  /* ---- Oathbreaker's Signature Spell ----
     It is kept in deck.commanders beside the Oathbreaker, so everything
     that walks a deck's cards (saving it, sending it across the table,
     pricing it, the collection) counts it without being told. What sets it
     apart is its card type: nothing else that may be in the command zone
     is an instant or a sorcery. */
  function isSignatureSpell(card) {
    if (!card) return false;
    const tl = String((card.card_faces && card.card_faces[0] && card.card_faces[0].type_line) || card.type_line || '');
    return /\b(Instant|Sorcery)\b/.test(tl.split(/\s+\/\/\s+/)[0]);
  }
  /** A deck's command zone split in two: who leads it, and its Signature Spell(s). */
  function commandParts(deck) {
    const all = (deck && deck.commanders) || [];
    return { leaders: all.filter(c => !isSignatureSpell(c)), signatures: all.filter(isSignatureSpell) };
  }

  /** How many copies of a card a deck may hold: singleton, restricted, or the format's number. */
  function copyLimit(card, fmt) {
    if (!fmt || unlimitedAllowed(card)) return Infinity;
    if (fmt.singleton) return 1;
    if (fmt.scryKey && legalityOf(card, fmt) === 'restricted') return 1;
    return fmt.maxCopies == null ? Infinity : fmt.maxCopies;
  }

  /**
   * The life a game starts at with this many players. Brawl is 25 between
   * two and 30 at a bigger table; a table that set its own number keeps it.
   */
  function lifeFor(fmt, players) {
    if (!fmt) return 20;
    const base = FORMATS[fmt.id];
    if (players > 2 && fmt.multiplayerLife && base && fmt.startingLife === base.startingLife) return fmt.multiplayerLife;
    return fmt.startingLife;
  }

  /** Whether the Commander brackets mean anything at this table. */
  function usesBrackets(fmt) { return !!(fmt && fmt.hasBrackets && fmt.kind !== 'limited'); }

  /* -------- the validator -------- */

  /**
   * validate(deck, formatId) -> { ok, errors:[], warnings:[], stats }
   * deck = { main:[{card, qty}], sideboard:[], commanders:[card], companion:card|null }
   */
  function validate(deck, formatId, rules) {
    const fmt = typeof formatId === 'object' && formatId ? formatId : effective(formatId, rules);
    const errors = [], warnings = [];
    if (!fmt) return { ok: false, errors: ['Unknown format: ' + formatId], warnings, stats: {} };

    const main = deck.main || [];
    const side = deck.sideboard || [];
    const commanders = deck.commanders || [];

    const mainCount = U.sum(main.map(e => e.qty));
    const sideCount = U.sum(side.map(e => e.qty));
    const total = mainCount + commanders.length;

    /* --- size ---
       `size` counts the commander(s), because a Commander deck is 100 cards
       including them. Yorion, Sky Nomad raises both bounds by 20 (CR 702.139c). */
    const size = fmt.commander ? total : mainCount;
    let min = fmt.deckMin || 0;
    let max = fmt.deckMax;
    if (deck.companion && U.normName(deck.companion.name).startsWith('yorion')) {
      min += 20;
      if (max != null) max += 20;
    }
    /* Conspiracies kept from a draft: Advantageous Proclamation lets the
       deck be five cards smaller; Sovereign's Realm plays without basics. */
    const plots = (deck.conspiracies || []).map(c => U.normName((c && (c.name || (c.card && c.card.name))) || c || ''));
    // while the deck is built the conspiracies are not chosen yet: one that was drafted is enough to allow for it
    const drafted = (deck.draftedConspiracies || []).map(n => U.normName(String(n)));
    if (plots.concat(drafted).some(n => n.startsWith('advantageous proclamation'))) min = Math.max(0, min - 5);
    const realm = plots.some(n => n.startsWith("sovereign's realm") || n.startsWith('sovereigns realm'));
    const noun = fmt.commander ? (fmt.oathbreaker ? 'cards including the Oathbreaker and its Signature Spell' : 'cards including the commander') : 'cards';

    if (fmt.exactSize) {
      if (size !== min)
        errors.push(size < min
          ? `${fmt.name} decks must be exactly ${min} ${noun} \u2014 you are ${min - size} short (${size}).`
          : `${fmt.name} decks must be exactly ${min} ${noun} \u2014 you are ${size - min} over (${size}).`);
    } else {
      if (min && size < min)
        errors.push(`Deck needs at least ${min} ${noun} \u2014 you are ${min - size} short (${size}).`);
      if (max != null && size > max)
        errors.push(`Deck may have at most ${max} ${noun} \u2014 you are ${size - max} over (${size}). ` +
          `The printed rules set no maximum, but a deck you can't shuffle unassisted isn't tournament legal, and this is almost always a miscount.`);
      else if (max == null && min && size > min * 1.15)
        warnings.push(`${size} cards in a format where ${min} is the norm. Legal, but you'll draw your best cards far less often.`);
    }
    if (fmt.sideboardMax != null && sideCount > fmt.sideboardMax)
      errors.push(fmt.sideboardMax === 0
        ? `${fmt.name} has no sideboard, but you have ${sideCount} card${sideCount === 1 ? '' : 's'} in one.`
        : `Sideboard may have at most ${fmt.sideboardMax} cards (you have ${sideCount}).`);

    /* --- commanders --- */
    // in Oathbreaker the Signature Spell rides with the commander, and is checked on its own
    const oath = fmt.commander && fmt.oathbreaker ? commandParts(deck) : null;
    if (oath) {
      if (!oath.leaders.length) errors.push('Choose an Oathbreaker: a planeswalker.');
      else if (oath.leaders.length > 1) errors.push('One Oathbreaker only.');
      for (const c of oath.leaders)
        if (!canBeCommander(c, fmt)) errors.push(`${c.name} can't be your Oathbreaker (it has to be a planeswalker).`);
      if (!oath.signatures.length) errors.push('Choose a Signature Spell: an instant or sorcery in your Oathbreaker’s colours.');
      else if (oath.signatures.length > 1) errors.push('One Signature Spell only.');
    } else if (fmt.commander) {
      if (!commanders.length) errors.push('Choose a commander.');
      else {
        const info0 = commanders.map(partnerInfo);
        /* A Background is not a legendary creature and never claims to be a
           commander on its own — it is one because the creature it is paired
           with asked for one. */
        const bgPaired = commanders.length === 2 &&
          info0.some(i => i.background) && info0.some(i => i.isBackground);
        commanders.forEach((c, k) => {
          if (bgPaired && info0[k].isBackground) return;
          if (!canBeCommander(c, fmt)) errors.push(fmt.walkerCommander
            ? `${c.name} can't be a commander (needs to be ${commanderRule(fmt)}).`
            : `${c.name} can't be a commander (needs to be a legendary creature or say so).`);
        });
        if (commanders.length > 1) {
          const infos = info0;
          const allPartner = infos.every(i => i.partner);
          const pairedWith = commanders.length === 2 && infos.some((i, k) =>
            i.partnerWith && U.normName(i.partnerWith) === U.normName(commanders[1 - k].name));
          const ff = infos.every(i => i.friendsForever);
          const bg = commanders.length === 2 && infos.some(i => i.background) && infos.some(i => i.isBackground);
          const dr = commanders.length === 2 && infos.some(i => i.doctor);
          if (commanders.length > 2) errors.push('At most two commanders.');
          else if (!(allPartner || pairedWith || ff || bg || dr))
            errors.push('Those two cards cannot be paired as commanders (needs Partner, Partner with, Friends forever, a Background, or a Doctor pairing).');
        }
      }
    } else if (commanders.length) {
      warnings.push(`${fmt.name} has no commander; that card will be treated as a normal deck card.`);
    }

    /* --- copies & singleton --- */
    const byName = new Map();
    const addName = (card, qty, where) => {
      const k = U.normName(U.frontName(card.name));
      if (!byName.has(k)) byName.set(k, { card, qty: 0, where: new Set() });
      const e = byName.get(k); e.qty += qty; e.where.add(where);
    };
    main.forEach(e => addName(e.card, e.qty, 'main'));
    side.forEach(e => addName(e.card, e.qty, 'side'));
    commanders.forEach(c => addName(c, 1, 'commander'));

    const limit = fmt.singleton ? 1 : fmt.maxCopies;
    if (limit != null) {
      for (const [, e] of byName) {
        if (unlimitedAllowed(e.card)) continue;
        if (e.qty > limit)
          errors.push(`${e.card.name}: ${e.qty} copies, but ${fmt.name} allows ${limit}.`);
      }
    }

    /* --- color identity --- */
    let ci = null;
    // the Oathbreaker alone sets the colours; its Signature Spell has to fit inside them
    const leaders = oath ? oath.leaders : commanders;
    if (fmt.colorIdentity && leaders.length) {
      ci = new Set();
      for (const c of leaders) for (const col of colorIdentity(c)) ci.add(col);
      for (const e of main) {
        const bad = colorIdentity(e.card).filter(col => !ci.has(col));
        if (bad.length)
          errors.push(`${e.card.name} is outside your commander's color identity (${bad.join('')}).`);
      }
      for (const c of (oath ? oath.signatures : [])) {
        const bad = colorIdentity(c).filter(col => !ci.has(col));
        if (bad.length) errors.push(`${c.name} is outside your Oathbreaker's colour identity (${bad.join('')}), so it can't be your Signature Spell.`);
      }
    }

    /* --- legality --- */
    if (fmt.scryKey) {
      for (const [, e] of byName) {
        const l = legalityOf(e.card, fmt);
        if (l === 'banned') errors.push(`${e.card.name} is banned in ${fmt.name}.`);
        else if (l === 'restricted' && e.qty > 1) errors.push(`${e.card.name} is restricted in ${fmt.name} (max 1).`);
        else if (l === 'not_legal') errors.push(`${e.card.name} is not legal in ${fmt.name}.`);
      }
    }

    /* --- companion --- */
    if (deck.companion) {
      const r = checkCompanion(deck.companion, deck, fmt);
      if (!r.ok) errors.push(`${deck.companion.name} can't be your companion: ${r.reason}`);
    }

    /* --- the table's bracket: a deck that goes past it is turned away --- */
    if (fmt.bracket && MTG.brackets) {
      const why = MTG.brackets.overBy(deck, fmt.bracket);
      if (why) errors.push(why);
    }

    /* --- stats --- */
    const stats = deckStats(main, commanders);
    if (fmt.kind === 'limited' && mainCount >= 40 && stats.lands < 14)
      warnings.push(`Only ${stats.lands} lands in a ${mainCount}-card limited deck; 17 is the usual number for 40.`);
    // a sixty-card commander deck (Brawl, Oathbreaker) runs about as many lands as any other sixty
    const sixty = fmt.commander && (fmt.deckMin || 100) < 100;
    if (fmt.commander && !sixty && stats.lands < 30)
      warnings.push(`${stats.lands} lands is low for a 100-card deck; most run 34-38.`);
    else if (sixty && fmt.kind !== 'limited' && stats.lands < 18)
      warnings.push(`${stats.lands} lands is low for a ${fmt.deckMin}-card deck; most run 22-25.`);

    if (realm && main.some(e => isBasicLand(e.card))) errors.push("Sovereign's Realm: your starting deck can't have basic land cards.");
    return {
      ok: errors.length === 0, errors, warnings, stats,
      colorIdentity: ci ? Array.from(ci) : null,
      size, min, max, exact: !!fmt.exactSize, sideboardCount: sideCount,
    };
  }

  /* --- companion rules (CR 702.139) --- */
  const COMPANION_CHECKS = {
    'Gyruda, Doom of Depths': (d) => ({ ok: everyCard(d, c => (c.cmc || 0) % 2 === 0), reason: 'every card must have an even mana value' }),
    'Jegantha, the Wellspring': (d) => ({ ok: everyCard(d, c => !hasDoublePip(c)), reason: 'no card may have two of the same colored pip in its cost' }),
    'Kaheera, the Orphanguard': (d) => ({ ok: everyCard(d, c => !isCreatureCard(c) || matchesTypes(c, ['Cat', 'Elemental', 'Nightmare', 'Dinosaur', 'Beast'])), reason: 'creatures must be Cat, Elemental, Nightmare, Dinosaur or Beast' }),
    'Keruga, the Macrosage': (d) => ({ ok: everyCard(d, c => isLandCard(c) || (c.cmc || 0) >= 3), reason: 'every nonland card must cost 3 or more' }),
    'Lurrus of the Dream-Den': (d) => ({ ok: everyCard(d, c => isLandCard(c) || !isPermanentCard(c) || (c.cmc || 0) <= 2), reason: 'permanents must have mana value 2 or less' }),
    'Lutri, the Spellchaser': (d) => ({ ok: true, reason: '' }),   // singleton, checked by format
    'Obosh, the Preypiercer': (d) => ({ ok: everyCard(d, c => isLandCard(c) || (c.cmc || 0) % 2 === 1), reason: 'every nonland card must have an odd mana value' }),
    'Umori, the Collector': (d) => ({ ok: sharesOnePermanentType(d), reason: 'all nonland cards must share a card type' }),
    'Yorion, Sky Nomad': (d, f) => ({ ok: true, reason: '' }),     // deck-size check below
    'Zirda, the Dawnwaker': (d) => ({ ok: everyCard(d, c => isLandCard(c) || hasActivatedAbility(c)), reason: 'every nonland card must have an activated ability' }),
    'Kannah, Child of Daybreak': (d) => ({ ok: true, reason: '' }),
  };
  function everyCard(deck, fn) { return (deck.main || []).every(e => fn(e.card)); }
  function isLandCard(c) { return /\bLand\b/.test((c.type_line || '').split('//')[0]); }
  function isCreatureCard(c) { return /\bCreature\b/.test(c.type_line || ''); }
  function isPermanentCard(c) { return /\b(Creature|Artifact|Enchantment|Planeswalker|Land|Battle)\b/.test(c.type_line || ''); }
  function matchesTypes(c, list) { return list.some(t => new RegExp('\\b' + t + '\\b').test(c.type_line || '')); }
  function hasDoublePip(c) {
    const counts = {};
    for (const s of MTG.mana.parse(c.mana_cost || '')) for (const col of MTG.mana.COLORS)
      if (s === col) counts[col] = (counts[col] || 0) + 1;
    return Object.values(counts).some(n => n >= 2);
  }
  function hasActivatedAbility(c) { return /:/.test(c.oracle_text || ''); }
  function sharesOnePermanentType(deck) {
    const nonland = (deck.main || []).filter(e => !isLandCard(e.card));
    if (!nonland.length) return true;
    const types = ['Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'];
    return types.some(t => nonland.every(e => new RegExp('\\b' + t + '\\b').test(e.card.type_line || '')));
  }
  function checkCompanion(card, deck, fmt) {
    const fn = COMPANION_CHECKS[card.name];
    if (card.name === 'Yorion, Sky Nomad') {
      const min = (fmt.deckMin || 60) + 20;
      const n = U.sum((deck.main || []).map(e => e.qty));
      return n >= min ? { ok: true } : { ok: false, reason: `your deck needs at least ${min} cards` };
    }
    if (!fn) return { ok: false, reason: 'not a companion card' };
    const r = fn(deck, fmt);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }

  /* -------- deck statistics for the builder UI -------- */
  function deckStats(main, commanders) {
    const all = [];
    for (const e of main) for (let i = 0; i < e.qty; i++) all.push(e.card);
    for (const c of (commanders || [])) all.push(c);
    const curve = {}; for (let i = 0; i <= 8; i++) curve[i] = 0;
    const colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const types = {};
    let lands = 0, creatures = 0, mvSum = 0, nonland = 0;
    for (const c of all) {
      const a = MTG.oracle.analyze(c);
      if (!a) continue;
      if (a.isLand) { lands++; }
      else {
        nonland++;
        const mv = Math.min(8, Math.floor(c.cmc || 0));
        curve[mv]++; mvSum += (c.cmc || 0);
      }
      if (a.isCreature) creatures++;
      for (const t of a.types) types[t] = (types[t] || 0) + 1;
      const idc = c.color_identity || [];
      if (!idc.length) colors.C++; else for (const col of idc) colors[col]++;
      for (const s of MTG.mana.parse(c.mana_cost || ''))
        for (const col of MTG.mana.COLORS) if (s.includes(col)) pips[col]++;
    }
    return {
      total: all.length, lands, creatures, nonland, types, curve, colors, pips,
      avgMv: nonland ? +(mvSum / nonland).toFixed(2) : 0,
      // the colours the deck actually casts from, which is not the same thing
      // as a commander's colour identity — that lives on the validate() result
      pipColors: MTG.mana.COLORS.filter(c => pips[c] > 0),
      automation: MTG.oracle.deckCoverage(all),
    };
  }

  /** How many lands a limited deck of this size normally wants. */
  function suggestedLands(deckSize, avgMv) {
    if (deckSize <= 40) return avgMv > 3.2 ? 18 : (avgMv < 2.3 ? 16 : 17);
    if (deckSize <= 60) return avgMv > 3.2 ? 25 : 24;
    return Math.round(deckSize * 0.37);
  }

  /* ============================================================
     House rules
     A format descriptor is two things at once: the identity of the format
     (Commander has commanders; a draft has packs) and the numbers it happens
     to use (40 life, 100 cards, 21 commander damage). The numbers are what
     people at a kitchen table change, so those are editable and the identity
     is not. Everything here is a plain overlay on the descriptor, which means
     nothing downstream has to know house rules exist.
     ============================================================ */

  /** Every knob, with what it means and where it applies. */
  const HOUSE_FIELDS = [
    { key: 'bracket', label: 'Bracket', type: 'bracket', min: 0, max: 5, when: (f) => usesBrackets(f),
      hint: 'How strong the decks at this table may be. A deck that goes past it is turned away.' },
    { key: 'startingLife', label: 'Starting life', type: 'int', min: 1, max: 200,
      hint: 'How much life everyone begins with.' },
    { key: 'startingHand', label: 'Opening hand', type: 'int', min: 1, max: 12,
      hint: 'Cards drawn before the first turn.' },
    { key: 'freeMulligans', label: 'Free mulligans', type: 'int', min: 0, max: 7,
      hint: 'Mulligans taken before you start putting cards back.' },
    { key: 'firstPlayerDraws', label: 'First player draws', type: 'bool',
      hint: 'Off is the tournament rule for two players; on is the usual multiplayer courtesy.' },
    { key: 'deckMin', label: 'Deck size', type: 'int', min: 1, max: 400,
      hint: 'The smallest legal deck, counting the commander.' },
    { key: 'exactSize', label: 'Exactly that many', type: 'bool',
      hint: 'On means the deck must hit the number on the nose.' },
    { key: 'maxCopies', label: 'Copies of a card', type: 'int', min: 1, max: 60, when: (f) => !f.singleton,
      hint: 'Basic lands and cards that say otherwise are always unlimited.' },
    { key: 'singleton', label: 'Singleton', type: 'bool',
      hint: 'One of everything bar basic lands.' },
    { key: 'sideboardMax', label: 'Sideboard', type: 'int', min: 0, max: 60,
      hint: 'Cards you may swap in between games. Zero means none.' },
    { key: 'commanderDamage', label: 'Commander damage', type: 'intOff', min: 1, max: 99,
      when: (f) => f.commander,
      hint: 'Off removes the 21-damage rule entirely.' },
    { key: 'colorIdentity', label: 'Colour identity', type: 'bool', when: (f) => f.commander,
      hint: 'Off lets a deck run cards outside its commander\u2019s colours.' },
    { key: 'packs', label: 'Packs per player', type: 'int', min: 1, max: 8, when: (f) => !!f.draft,
      hint: 'How many boosters each seat opens.' },
    { key: 'packSize', label: 'Cards per pack', type: 'int', min: 3, max: 45, when: (f) => !!f.draft,
      hint: 'Picks per booster.' },
    { key: 'collector', label: 'Collector boosters', type: 'bool', when: (f) => !!f.draft && f.draft.style !== 'cube',
      hint: 'Fifteen cards, mostly foil, with extra rares and special printings, in place of the usual packs.' },
    { key: 'allPacksAtOnce', label: 'Open all packs at once', type: 'bool', when: (f) => !!f.draft,
      hint: 'Every pack is opened at the start and they all pass together, a card at a time, instead of one pack per player per round.' },
    { key: 'basicsFree', label: 'Free basic lands', type: 'bool', when: (f) => !!f.draft,
      hint: 'Off means you play only what you drafted.' },
    { key: 'bestOf', label: 'Match length', type: 'odd', min: 1, max: 9,
      hint: 'Best of how many games. One, the default, is a single game.' },
    // one of a few set values (type 'choice'); the clock itself is src/06e-clock.js
    { key: 'clock', label: 'Clock', type: 'choice',
      options: [[0, 'Off'], [10, '10 minutes a player'], [20, '20 minutes a player'], [30, '30 minutes a player']],
      hint: 'Time for the whole game, counted only while the game waits on that player. Out of time is out of the game. Bots are not timed.' },
  ];

  /** The value a field starts at for a given format. */
  function houseDefault(fmt, key) {
    if (key === 'freeMulligans') return fmt.freeMulligans != null ? fmt.freeMulligans : 0;
    if (key === 'bestOf') return fmt.bestOf != null ? fmt.bestOf : 1;
    if (key === 'firstPlayerDraws') return !!fmt.firstPlayerDraws;
    if (key === 'exactSize') return !!fmt.exactSize;
    if (key === 'singleton') return !!fmt.singleton;
    if (key === 'colorIdentity') return !!fmt.colorIdentity;
    if (key === 'basicsFree') return !!fmt.basicsFree;
    if (key === 'collector') return false;
    if (key === 'bracket') return 0;
    if (key === 'clock') return 0;
    if (key === 'maxCopies') return fmt.maxCopies == null ? 4 : fmt.maxCopies;
    if (key === 'sideboardMax') return fmt.sideboardMax == null ? 15 : fmt.sideboardMax;
    if (key === 'commanderDamage') return fmt.commanderDamage || 0;
    if (key === 'packs') return fmt.draft ? fmt.draft.packs : 3;
    if (key === 'packSize') return fmt.draft ? fmt.draft.packSize : 15;
    if (key === 'deckMin') return fmt.deckMin || 60;
    return fmt[key];
  }

  /** The fields that apply to this format, in the order they are shown. */
  function houseFields(formatId) {
    const fmt = FORMATS[formatId];
    if (!fmt) return [];
    return HOUSE_FIELDS.filter(f => !f.when || f.when(fmt))
      .map(f => Object.assign({}, f, { value: houseDefault(fmt, f.key) }));
  }

  /** The whole default rule set, which is what a fresh session starts from. */
  function houseDefaults(formatId) {
    const out = {};
    for (const f of houseFields(formatId)) out[f.key] = f.value;
    return out;
  }

  /**
   * The format as the table is actually playing it. Only keys the format
   * exposes are taken from `rules`, so a stale preset from another format
   * cannot smuggle a commander into Standard.
   */
  function effective(formatId, rules) {
    const base = FORMATS[formatId];
    if (!base) return base;
    if (!rules) return base;
    const fmt = Object.assign({}, base);
    const allowed = new Set(houseFields(formatId).map(f => f.key));
    for (const k of Object.keys(rules)) {
      if (!allowed.has(k)) continue;
      const v = rules[k];
      if (v == null) continue;
      if (k === 'commanderDamage') { fmt.commanderDamage = v ? v : null; continue; }
      if (k === 'maxCopies') { fmt.maxCopies = v; continue; }
      if (k === 'packs' || k === 'packSize') {
        fmt.draft = Object.assign({}, fmt.draft); fmt.draft[k] = v; continue;
      }
      fmt[k] = v;
    }
    if (fmt.singleton) fmt.maxCopies = 1;
    // a deck size that was a range stays a range unless the host pins it
    if (fmt.exactSize) fmt.deckMax = fmt.deckMin;
    else if (base.exactSize && !fmt.exactSize) fmt.deckMax = null;
    return fmt;
  }

  /** A 'choice' rule's value, in the words its options give it. */
  function choiceLabel(f, v) {
    const o = (f.options || []).find(x => x[0] === v);
    return o ? o[1] : String(v);
  }

  /** What a joining player needs to be told: only what differs. */
  function houseSummary(formatId, rules) {
    if (!rules) return [];
    const out = [];
    for (const f of houseFields(formatId)) {
      const v = rules[f.key];
      if (v == null || v === f.value) continue;
      if (f.type === 'bool') out.push(`${f.label}: ${v ? 'on' : 'off'} (normally ${f.value ? 'on' : 'off'})`);
      else if (f.type === 'bracket') out.push(MTG.brackets ? MTG.brackets.label(v) : `${f.label} ${v}`);
      else if (f.type === 'intOff') out.push(v ? `${f.label}: ${v}` : `${f.label}: off`);
      else if (f.type === 'choice') out.push(`${f.label}: ${choiceLabel(f, v)}`);
      else out.push(`${f.label}: ${v}`);
    }
    return out;
  }

  /** Saved presets live beside the settings, keyed by format. */
  const presets = {
    all() { return MTG.settings.rulePresets || {}; },
    forFormat(formatId) { return (this.all()[formatId] || []).slice(); },
    save(formatId, name, rules) {
      const all = Object.assign({}, this.all());
      const list = (all[formatId] || []).filter(p => p.name !== name);
      list.push({ name, rules: Object.assign({}, rules), savedAt: Date.now() });
      all[formatId] = list;
      MTG.setSetting('rulePresets', all);
      return list;
    },
    remove(formatId, name) {
      const all = Object.assign({}, this.all());
      all[formatId] = (all[formatId] || []).filter(p => p.name !== name);
      MTG.setSetting('rulePresets', all);
      return all[formatId];
    },
  };

  MTG.formats = {
    FORMATS, FORMAT_ORDER,
    get: (id) => FORMATS[id],
    list: () => FORMAT_ORDER.map(id => FORMATS[id]),
    validate, deckStats, canBeCommander, partnerInfo, colorIdentity,
    houseFields, houseDefaults, houseSummary, effective, presets, choiceLabel,
    isBasicLand, unlimitedAllowed, legalityOf, suggestedLands, checkCompanion,
    commanderRule, commanderQuery, isSignatureSpell, commandParts, copyLimit, lifeFor, usesBrackets,
    isLimited: (id) => FORMATS[id] && FORMATS[id].kind === 'limited',
    isCommander: (id) => !!(FORMATS[id] && FORMATS[id].commander),
  };
})(window.MTG);


