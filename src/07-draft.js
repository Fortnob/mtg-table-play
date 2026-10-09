/* ============================================================
   07-draft.js - boosters, cubes and the draft table
   Packs are built from real set collation (Play Booster slots for sets
   printed from 2024 on, classic Draft Booster slots before that) using
   Scryfall's `is:booster` card pool for the set.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* ---------------- booster collation ---------------- */

  // Play Booster, 14 playable cards (WPN "Introducing Play Boosters"):
  //   1-6   commons
  //   7     common (98.5%) or a Special Guest / The List card (1.5%)
  //   8-10  uncommons
  //   11    non-foil wildcard, any rarity
  //   12    rare (87.5%) or mythic (12.5%)
  //   13    basic land (or a common land in sets with no basics)
  //   14    foil wildcard, any rarity
  const PLAY_BOOSTER = {
    id: 'play', size: 14, since: '2024-02-01',
    slots: [
      { n: 6, pick: 'common' },
      { n: 1, pick: 'commonOrList' },
      { n: 3, pick: 'uncommon' },
      { n: 1, pick: 'wildcard' },
      { n: 1, pick: 'rareMythic' },
      { n: 1, pick: 'land' },
      { n: 1, pick: 'wildcard', foil: true },
    ],
  };
  // Classic Draft Booster, 15 cards.
  const DRAFT_BOOSTER = {
    id: 'draft', size: 15,
    slots: [
      { n: 10, pick: 'common' },
      { n: 1, pick: 'commonOrLand' },
      { n: 3, pick: 'uncommon' },
      { n: 1, pick: 'rareMythic' },
    ],
  };

  /* Collector Booster, 15 cards (Throne of Eldraine onwards, in outline:
     every set varies the details). Mostly foil, a foil rare, and rares and
     uncommons in the set's special treatments: extended art, borderless,
     showcase. Older sets had none; there the same mix comes in ordinary
     printings. */
  const COLLECTOR_BOOSTER = {
    id: 'collector', size: 15,
    slots: [
      { n: 5, pick: 'common', foil: true },
      { n: 3, pick: 'uncommon', foil: true },
      { n: 1, pick: 'land', foil: true },
      { n: 2, pick: 'variantUncommon' },
      { n: 1, pick: 'variantUncommon', foil: true },
      { n: 1, pick: 'rareMythic', foil: true },
      { n: 1, pick: 'variantRare' },
      { n: 1, pick: 'variantRare', foil: true },
    ],
  };
  // A Commander draft pack, and its collector counterpart: twenty cards either way.
  const CMDR_PACK = { id: 'cmdr', size: 20, slots: [{ n: 14, pick: 'common' }, { n: 4, pick: 'uncommon' }, { n: 2, pick: 'rareMythic' }] };
  const CMDR_COLLECTOR = { id: 'cmdrCollector', size: 20, slots: [
    { n: 10, pick: 'common', foil: true }, { n: 4, pick: 'uncommon', foil: true }, { n: 2, pick: 'variantUncommon' },
    { n: 2, pick: 'rareMythic', foil: true }, { n: 2, pick: 'variantRare' }] };

  // Rarity mix of the Play Booster wildcard slots.
  const WILDCARD_MIX = [['common', 0.583], ['uncommon', 0.350], ['rare', 0.053], ['mythic', 0.014]];
  /* Real packs keep a basic land in one slot. A basic is not a pick — it is
     a card everybody already has as many of as they want — so that slot is
     spent on something draftable instead. */
  const LAND_SLOT_MIX = [['common', 0.70], ['uncommon', 0.2975], ['rare', 0.0025]];

  /* ============================================================
     Cards whose rules text happens during the draft
     Conspiracy and Conspiracy: Take the Crown do some of their work
     between opening a pack and building a deck. Each card is listed by
     name rather than parsed, because the text is bespoke enough that a
     parser would be guessing; anything with the shape of a draft ability
     that is not on the list is flagged instead, so the table knows to run
     it by hand rather than quietly losing it.

     `kind` is what the card does:
       extraPick  draft another card from the pack with this pick
       wholePack  draft every card in the pack, then sit the round out
       lastCard   the last card of every pack is passed to you
       addPack    a fresh booster joins the draft, and your next pick is from it
       remove     a card you draft leaves the draft instead of joining your pool
       note       a card you draft is revealed and noted (its name, or its types)
       noteNext   the next card you draft is revealed and its name noted
       count      note how many cards you have drafted this round
       colors     the players either side of you and you choose three colours
       passer     note the player who passed it to you
       spy        see the next card drafted from the pack this came from
       guess      guess the next card drafted from the pack this came from
       watch      see the next card drafted by a player of your choice
       peek       look at a pack nobody is looking at
       blind      draft at random for the next three cards
       broker     offer a trade once the draft is over
     faceUp: drafted face up, and the ability works while it stays face up
     reveal: shown to the table as it is drafted
     once:   turned face down once it has been used
     mod:    spent on a pick, on the first card taken with it
     ============================================================ */

  const DRAFT_ABILITIES = {
    'cogwork librarian': { kind: 'extraPick', faceUp: true, returns: true,
      label: 'Take a second card',
      prompt: 'Draft an extra card from this pack, and put Cogwork Librarian into it.' },
    "leovold's operative": { kind: 'extraPick', faceUp: true, once: true, skipNext: true,
      label: 'Take a second card',
      prompt: "Draft an extra card from this pack and turn Leovold's Operative face down; then pass the next pack without drafting from it." },
    'agent of acquisitions': { kind: 'wholePack', faceUp: true, once: true,
      label: 'Take the whole pack',
      prompt: 'Draft every card in this pack, one at a time, then draft nothing more this round.' },
    'canal dredger': { kind: 'lastCard', faceUp: true, passive: true,
      label: 'Last card of every pack',
      prompt: 'The last card of each pack is passed to you.' },
    'lore seeker': { kind: 'addPack', reveal: true, onDraft: true,
      label: 'Adds a booster',
      prompt: 'Lore Seeker: add a booster pack to the draft? Your next pick is from it, and then it is passed on like any other.' },
    'cogwork grinder': { kind: 'remove', faceUp: true, mod: true,
      label: 'Remove the card you take',
      prompt: 'The first card of this pick leaves the draft face down instead of joining your pool. Cogwork Grinder enters with a +1/+1 counter for each card removed this way.' },
    'animus of predation': { kind: 'remove', faceUp: true, mod: true, shown: true,
      label: 'Remove the card you take',
      prompt: 'The first card of this pick leaves the draft face up instead of joining your pool. Animus of Predation has each of its keywords that a creature removed this way had.' },
    'noble banneret': { kind: 'note', faceUp: true, once: true, mod: true, creature: true, what: 'name',
      label: "Note this creature's name",
      prompt: 'Reveal the creature you take first and note its name. Noble Banneret and creatures with that name get +1/+1 and lifelink.' },
    'paliano vanguard': { kind: 'note', faceUp: true, once: true, mod: true, creature: true, what: 'types',
      label: "Note this creature's types",
      prompt: 'Reveal the creature you take first and note its creature types. Your other creatures of those types get +1/+1.' },
    'smuggler captain': { kind: 'note', faceUp: true, once: true, mod: true, what: 'name',
      label: "Note this card's name",
      prompt: 'Reveal the card you take first and note its name. When Smuggler Captain enters, you may search your library for a card with that name.' },
    'aether searcher': { kind: 'noteNext', reveal: true, onDraft: true,
      label: 'Notes the next card you draft',
      prompt: 'The next card you draft is revealed and its name noted.' },
    'lurking automaton': { kind: 'count', reveal: true, onDraft: true,
      label: 'Notes your pick in the round', prompt: 'Notes how many cards you have drafted this round, this one included.' },
    'pyretic hunter': { kind: 'count', reveal: true, onDraft: true,
      label: 'Notes your pick in the round', prompt: 'Notes how many cards you have drafted this round, this one included.' },
    'garbage fire': { kind: 'count', reveal: true, onDraft: true,
      label: 'Notes your pick in the round', prompt: 'Notes how many cards you have drafted this round, this one included.' },
    'custodi peacekeeper': { kind: 'count', reveal: true, onDraft: true,
      label: 'Notes your pick in the round', prompt: 'Notes how many cards you have drafted this round, this one included.' },
    'paliano, the high city': { kind: 'colors', reveal: true, onDraft: true,
      label: 'Colours chosen around the table',
      prompt: 'The player to your right chooses a colour, you choose another, then the player to your left chooses a third.' },
    'regicide': { kind: 'colors', reveal: true, onDraft: true,
      label: 'Colours chosen around the table',
      prompt: 'The player to your right chooses a colour, you choose another, then the player to your left chooses a third.' },
    'cogwork tracker': { kind: 'passer', reveal: true, onDraft: true,
      label: 'Notes who passed it', prompt: 'Notes the player who passed it to you.' },
    'cogwork spy': { kind: 'spy', reveal: true, onDraft: true,
      label: 'Sees the next card taken from its pack', prompt: 'You see the next card drafted from the pack Cogwork Spy came from.' },
    'spire phantasm': { kind: 'guess', reveal: true, onDraft: true,
      label: 'Guesses the next card taken from its pack',
      prompt: 'Guess which card the next player takes from this pack. Guess right and Spire Phantasm draws a card when it enters.' },
    'illusionary informant': { kind: 'watch', faceUp: true, once: true,
      label: "See a player's next card",
      prompt: 'Turn Illusionary Informant face down to see the next card drafted by a player of your choice.' },
    'whispergear sneak': { kind: 'peek', faceUp: true, once: true,
      label: 'Look at a pack',
      prompt: 'Turn Whispergear Sneak face down to look at an unopened pack, or at a pack nobody is looking at.' },
    'archdemon of paliano': { kind: 'blind', faceUp: true, onDraft: true, n: 3,
      label: 'Drafting at random',
      prompt: 'While Archdemon of Paliano is face up you cannot look at packs and draft at random; after three cards it turns face down.' },
    'deal broker': { kind: 'broker', faceUp: true, passive: true,
      label: 'Trades once the draft is over',
      prompt: 'Once the draft is over you may reveal a card from your pool; each other player may offer one of theirs, and you may take one offer.' },
  };

  /* Draft text that is not one of the cards above. Only words that can
     only mean the draft itself count: a card that opens a booster during
     a game (Booster Tutor) is not a draft card. */
  const DRAFT_WORDS = /\bas you draft\b|\bas you drafted\b|\bdraft (?:this card|CARDNAME) face up\b|\bduring the draft\b|\bafter the draft\b|\bthis draft round\b|\bfrom the draft\b|\bto the draft\b/i;

  /** Anything that talks about the draft, whether or not we can run it. */
  function draftAbilityOf(card) {
    if (!card) return null;
    const key = U.normName(U.frontName(card.name));
    const known = DRAFT_ABILITIES[key];
    if (known) return Object.assign({ name: card.name, key, known: true }, known);
    const t = card.oracle_text || (card.card_faces || []).map(f => f.oracle_text || '').join('\n');
    if (DRAFT_WORDS.test(t)) {
      return { name: card.name, key, known: false, kind: 'manual', faceUp: /face up/i.test(t),
        label: 'Draft ability', prompt: t.split('\n').find(l => /draft/i.test(l)) || t };
    }
    return null;
  }

  /* ---------------- conspiracies and the start of the game ----------------
     A conspiracy is never in a deck: it starts the game in its owner's
     command zone (CR 905), face up, or face down with a card name secretly
     chosen for it (hidden agenda, CR 702.106; double agenda, two names). A
     few creatures ask for cards you drafted but left out of your deck
     before the game begins. All of it is settled once the deck is built,
     and travels to the game on the deck. */

  const isConspiracy = (c) => /\bConspiracy\b/.test((c && c.type_line) || '');

  /** What a conspiracy asks for before the game: a name, two names, or a number. */
  function agendaOf(card) {
    const t = (card && card.oracle_text) || '';
    if (/^Double agenda\b/m.test(t)) return { names: 2 };
    if (/^Hidden agenda\b/m.test(t)) return { names: 1 };
    if (/choose 1, 2, or 3\b/i.test(t)) return { number: [1, 2, 3] };
    return null;
  }

  /* What a name is chosen for, so the table can choose one well: a
     creature for the ones that act on creatures, an instant or sorcery for
     the ones that act on those, anything for the rest. */
  const AGENDA_WANTS = {
    'double stroke': 'instant or sorcery', 'iterative analysis': 'instant or sorcery',
    "brago's favor": 'any', 'unexpected potential': 'any',
  };

  /* Creatures that take drafted cards that are not in the deck into exile
     before the game begins, "before you shuffle your deck to start the
     game". One choice for each copy in the deck. */
  const PREGAME_EXILE = {
    'arcane savant': { words: 'instant or sorcery', min: 1, max: 1, label: 'an instant or sorcery card you drafted' },
    'caller of the untamed': { words: 'creature', min: 1, max: 1, label: 'a creature card you drafted' },
    'volatile chimera': { words: 'creature', min: 3, max: 99, label: 'three or more creature cards you drafted' },
  };

  /* ---------------- the same cards, in the game ----------------
     The game needs to know what these cards do once they are cast, and
     the draft lines mean nothing there. They are written out in the
     vocabulary of src/18-scripts.js and join its table below; what they
     noted during the draft reaches the engine on the deck (`draftNotes`),
     and the engine looks it up for whoever controls the card. */

  /** A line that did its work in the draft: shown, and nothing to do in the game. */
  const drafted = (text) => ({ kind: 'static', auto: true, draftOnly: true, text, effects: [{ op: 'noop', text }] });
  const TAP = { mana: '', tap: true, untap: false, sacSelf: false, sacrifice: null, discard: null, life: 0, exile: null, removeCounters: null, other: [], raw: '{T}' };
  const cost = (mana, tap) => Object.assign({}, TAP, { mana, tap: !!tap, raw: [mana, tap ? '{T}' : ''].filter(Boolean).join(', ') });
  const FACE_UP = drafted('Draft this card face up.');
  const COUNT_LINE = drafted("Reveal this card as you draft it and note how many cards you've drafted this draft round, including this card.");
  const COLOR_LINE = drafted('Reveal this card as you draft it. The player to your right chooses a color, you choose another color, then the player to your left chooses a third color.');
  const entersNoted = (key, how, text) => ({ kind: 'static', auto: true, text,
    effects: [{ op: 'entersWithNoted', card: key, how, counter: '+1/+1' }] });
  // "Creatures you control with the chosen name have …"
  const named = (extra) => Object.assign({ who: 'you', what: 'creature', chosenName: true }, extra || {});
  const ANIMUS_KW = ['Flying', 'First strike', 'Double strike', 'Deathtouch', 'Haste', 'Hexproof', 'Indestructible',
    'Lifelink', 'Menace', 'Reach', 'Vigilance'];

  const DRAFT_SCRIPTS = {
    'cogwork librarian': { abilities: [FACE_UP,
      drafted('As you draft a card, you may draft an additional card from that booster pack. If you do, put this card into that booster pack.')] },
    "leovold's operative": { abilities: [FACE_UP,
      drafted('As you draft a card, you may draft an additional card from that booster pack. If you do, turn this card face down, then pass the next booster pack without drafting a card from it.')] },
    'agent of acquisitions': { abilities: [FACE_UP,
      drafted("Instead of drafting a card from a booster pack, you may draft each card in that booster pack, one at a time. If you do, turn this card face down and you can't draft cards for the rest of this draft round.")] },
    'lore seeker': { abilities: [drafted('Reveal this card as you draft it. After you draft this card, you may add a booster pack to the draft.')] },
    'whispergear sneak': { abilities: [FACE_UP,
      drafted('During the draft, you may turn this card face down. If you do, look at any unopened booster pack in the draft or any booster pack not being looked at by another player.')] },
    'illusionary informant': { abilities: [FACE_UP,
      drafted('During the draft, you may turn this card face down. If you do, look at the next card drafted by a player of your choice.')] },
    'cogwork spy': { abilities: [drafted('Reveal this card as you draft it. You may look at the next card drafted from this booster pack.')] },
    'archdemon of paliano': { abilities: [FACE_UP,
      drafted("As long as this card is face up during the draft, you can't look at booster packs and must draft cards at random. After you draft three cards this way, turn this card face down.")] },
    'deal broker': { abilities: [FACE_UP,
      drafted('Immediately after the draft, you may reveal a card in your card pool. Each other player may offer you one card in their card pool in exchange. You may accept any one offer.'),
      { kind: 'activated', auto: true, sorcerySpeed: false, cost: cost('', true), text: '{T}: Draw a card, then discard a card.',
        effects: [{ op: 'drawDiscard', n: 1, text: 'Draw a card, then discard a card.' }] }] },
    'canal dredger': { abilities: [FACE_UP,
      drafted('Each player passes the last card from each booster pack to a player who drafted a card named Canal Dredger.'),
      { kind: 'activated', auto: true, sorcerySpeed: false, cost: cost('', true), text: '{T}: Put target card from your graveyard on the bottom of your library.',
        effects: [{ op: 'toLibrary', where: 'bottom', targets: [{ controller: 'you', filter: 'card', type: 'permanent', zone: 'graveyard' }] }] }] },
    'cogwork grinder': { abilities: [FACE_UP,
      drafted('As you draft a card, you may remove it from the draft face down.'),
      entersNoted('cogwork grinder', 'removed', 'This creature enters with X +1/+1 counters on it, where X is the number of cards you removed from the draft with cards named Cogwork Grinder.')] },
    'lurking automaton': { abilities: [COUNT_LINE,
      entersNoted('lurking automaton', 'max', 'This creature enters with X +1/+1 counters on it, where X is the highest number you noted for cards named Lurking Automaton.')] },
    'pyretic hunter': { abilities: [COUNT_LINE,
      entersNoted('pyretic hunter', 'max', 'This creature enters with X +1/+1 counters on it, where X is the highest number you noted for cards named Pyretic Hunter.')] },
    'garbage fire': { abilities: [COUNT_LINE,
      { kind: 'spell', auto: true, text: 'Garbage Fire deals damage to target creature equal to the highest number you noted for cards named Garbage Fire.',
        effects: [{ op: 'damage', n: { noted: 'garbage fire', how: 'max' }, targets: [{ type: 'creature', filter: 'creature', zone: 'battlefield' }] }] }] },
    'custodi peacekeeper': { abilities: [COUNT_LINE,
      { kind: 'activated', auto: true, sorcerySpeed: false, cost: cost('{W}', true),
        text: '{W}, {T}: Tap target creature with power less than or equal to the highest number you noted for cards named Custodi Peacekeeper.',
        effects: [{ op: 'tap', targets: [{ type: 'creature', filter: 'creature', zone: 'battlefield', notedMaxPower: 'custodi peacekeeper' }] }] }] },
    'paliano vanguard': { abilities: [FACE_UP,
      drafted('As you draft a creature card, you may reveal it, note its creature types, then turn this card face down.'),
      { kind: 'static', auto: true, text: 'Other creatures you control of a type you noted for cards named Paliano Vanguard get +1/+1.',
        effects: [{ op: 'continuous', layer: 7, scope: { who: 'you', what: 'creature', other: true, noted: { card: 'paliano vanguard', by: 'type' } }, pt: { p: 1, t: 1 } }] }] },
    'noble banneret': { abilities: [FACE_UP,
      drafted('As you draft a creature card, you may reveal it, note its name, then turn this card face down.'),
      { kind: 'static', auto: true,
        text: 'As long as you control one or more creatures with a name you noted for cards named Noble Banneret, this creature and those creatures get +1/+1 and have lifelink.',
        effects: [
          { op: 'continuous', layer: 7, scope: { self: true, what: 'creature' }, pt: { p: 1, t: 1 }, grant: ['Lifelink'],
            cond: { kind: 'control', scope: { who: 'you', what: 'creature', noted: { card: 'noble banneret', by: 'name' } }, n: 1 } },
          { op: 'continuous', layer: 7, scope: { who: 'you', what: 'creature', other: true, noted: { card: 'noble banneret', by: 'name' } }, pt: { p: 1, t: 1 }, grant: ['Lifelink'] }] }] },
    'smuggler captain': { abilities: [FACE_UP,
      drafted('As you draft a card, you may reveal it, note its name, then turn this card face down.'),
      { kind: 'triggered', event: 'etb', self: true, optional: true, auto: true,
        text: 'When this creature enters, you may search your library for a card with a name you noted for cards named Smuggler Captain, reveal it, put it into your hand, then shuffle.',
        effects: [{ op: 'tutor', n: 1, filter: 'card', noted: 'smuggler captain', to: 'hand', prompt: 'Search your library for a card with a name you noted.' }] }] },
    'aether searcher': { abilities: [drafted('Reveal this card as you draft it. Reveal the next card you draft and note its name.'),
      { kind: 'triggered', event: 'etb', self: true, optional: false, auto: true,
        text: 'When this creature enters, you may search your hand and/or library for a card with a name noted as you drafted cards named Aether Searcher. You may cast it without paying its mana cost. If you search your library this way, shuffle.',
        effects: [{ op: 'castNoted', noted: 'aether searcher' }] }] },
    'animus of predation': { abilities: [FACE_UP,
      drafted('As you draft a card, you may remove it from the draft face up.'),
      { kind: 'static', auto: true,
        text: 'If you removed a creature card with flying from the draft with cards named Animus of Predation, this creature has flying. The same is true for first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, reach, and vigilance.',
        effects: ANIMUS_KW.map(k => ({ op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, grant: [k],
          cond: { kind: 'draftNoted', card: 'animus of predation', keyword: k.toLowerCase() } })) }] },
    'cogwork tracker': { abilities: [drafted('Reveal this card as you draft it and note the player who passed it to you.'),
      { kind: 'static', auto: true, text: 'This creature attacks each combat if able.',
        effects: [{ op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'mustAttackEot' }] },
      { kind: 'static', auto: true, text: 'This creature attacks a player you noted for cards named Cogwork Tracker each combat if able.',
        effects: [{ op: 'mustAttackNoted', card: 'cogwork tracker' }] }] },
    'paliano, the high city': { abilities: [COLOR_LINE,
      { kind: 'mana', auto: true, sorcerySpeed: false, cost: cost('', true),
        text: '{T}: Add one mana of any color chosen as you drafted cards named Paliano, the High City.',
        effects: [{ op: 'addManaAmong', from: 'noted', noted: 'paliano, the high city', amount: 1 }] }] },
    'regicide': { abilities: [COLOR_LINE,
      { kind: 'spell', auto: true, text: "Destroy target creature that's one or more of the colors chosen as you drafted cards named Regicide.",
        effects: [{ op: 'destroy', targets: [{ type: 'creature', filter: 'creature', zone: 'battlefield', notedColors: 'regicide' }] }] }] },
    'spire phantasm': { abilities: [drafted("Reveal this card as you draft it. The next time a player drafts a card from this booster pack, guess that card's name. Then that player reveals the drafted card."),
      { kind: 'triggered', event: 'etb', self: true, optional: false, auto: true, intervening: true,
        condition: { kind: 'draftNoted', card: 'spire phantasm', flag: 'right' },
        text: 'When this creature enters, if you guessed correctly for a card named Spire Phantasm, draw a card.',
        effects: [{ op: 'draw', n: 1, who: 'you' }] }] },
    'arcane savant': { abilities: [
      drafted("Before you shuffle your deck to start the game, you may reveal this card from your deck and exile an instant or sorcery card you drafted that isn't in your deck."),
      { kind: 'triggered', event: 'etb', self: true, optional: false, auto: true,
        text: 'When this creature enters, copy a card you exiled with cards named Arcane Savant. You may cast the copy without paying its mana cost.',
        effects: [{ op: 'castExiledCopy', with: 'arcane savant' }] }] },
    'caller of the untamed': { abilities: [
      drafted("Before you shuffle your deck to start the game, you may reveal this card from your deck and exile a creature card you drafted that isn't in your deck."),
      { kind: 'activated', auto: true, sorcerySpeed: false, cost: cost('{X}', true),
        text: '{X}, {T}: Create a token that’s a copy of a card you exiled with cards named Caller of the Untamed. X is the mana value of that card.',
        effects: [{ op: 'tokenOfExiled', with: 'caller of the untamed' }] }] },
    'volatile chimera': { abilities: [
      drafted("Before you shuffle your deck to start the game, you may reveal this card from your deck and exile three or more creature cards you drafted that aren't in your deck."),
      { kind: 'activated', auto: true, sorcerySpeed: false, cost: cost('{1}{R}', false), chimera: true,
        text: '{1}{R}: Choose a card at random you exiled with cards named Volatile Chimera. This creature becomes a copy of that card, except it has this ability.',
        effects: [{ op: 'becomeExiledCopy', with: 'volatile chimera' }] }] },

    /* ---- conspiracies ---- */
    'advantageous proclamation': { abilities: [drafted('(Start the game with this conspiracy face up in the command zone.)'),
      { kind: 'static', auto: true, text: 'Your minimum deck size is reduced by five.', effects: [{ op: 'noop' }] }] },
    'backup plan': { abilities: [{ kind: 'static', auto: true,
      text: 'Draw an additional hand of seven cards as the game begins. Before taking mulligans, shuffle all but one of your hands into your library.',
      effects: [{ op: 'backupHand' }] }] },
    "brago's favor": { abilities: [{ kind: 'static', auto: true, text: 'Spells with the chosen name you cast cost {1} less to cast.',
      effects: [{ op: 'costMod', who: 'you', words: 'spell', chosenName: true, amount: -1 }] }] },
    'double stroke': { abilities: [{ kind: 'triggered', event: 'youCastSpell', optional: true, auto: true,
      objFilter: { words: 'instant or sorcery', chosenName: true },
      text: 'Whenever you cast an instant or sorcery spell with the chosen name, you may copy it. You may choose new targets for the copy.',
      effects: [{ op: 'copyThatSpell' }] }] },
    'immediate action': { abilities: [{ kind: 'static', auto: true, text: 'Creatures you control with the chosen name have haste.',
      effects: [{ op: 'continuous', layer: 6, scope: named(), grant: ['Haste'] }] }] },
    'iterative analysis': { abilities: [{ kind: 'triggered', event: 'youCastSpell', optional: true, auto: true,
      objFilter: { words: 'instant or sorcery', chosenName: true },
      text: 'Whenever you cast an instant or sorcery spell with the chosen name, you may draw a card.',
      effects: [{ op: 'draw', n: 1, who: 'you' }] }] },
    "muzzio's preparations": { abilities: [{ kind: 'static', auto: true,
      text: 'Each creature you control with the chosen name enters with an additional +1/+1 counter on it.',
      effects: [{ op: 'entersExtra', what: 'creature', counter: '+1/+1', chosenName: true }] }] },
    'power play': { abilities: [{ kind: 'static', auto: true,
      text: 'You are the starting player. If multiple players would be the starting player, one of those players is chosen at random.',
      effects: [{ op: 'startingPlayer' }] }] },
    'secret summoning': { abilities: [{ kind: 'triggered', event: 'permEnters', optional: true, auto: true,
      objFilter: { who: 'you', words: 'creature', chosenName: true },
      text: 'Whenever a creature you control with the chosen name enters, you may search your library for any number of cards with that name, reveal them, put them into your hand, then shuffle.',
      effects: [{ op: 'tutor', n: 60, filter: 'card', chosenName: true, to: 'hand', prompt: 'Search your library for any number of cards with the chosen name.' }] }] },
    'secrets of paradise': { abilities: [{ kind: 'static', auto: true, text: 'Creatures you control with the chosen name have "{T}: Add one mana of any color."',
      effects: [{ op: 'continuous', layer: 6, scope: named(), grantMana: [{ kind: 'mana', auto: true, granted: true, cost: TAP,
        text: '{T}: Add one mana of any color.', effects: [{ op: 'addManaAny', amount: 1 }] }] }] }] },
    'sentinel dispatch': { abilities: [{ kind: 'triggered', event: 'eachUpkeep', optional: false, auto: true, intervening: true,
      condition: { kind: 'firstUpkeep', of: 'game' },
      text: 'At the beginning of the first upkeep, create a 1/1 colorless Construct artifact creature token with defender.',
      effects: [{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['colorless'], addTypes: ['Artifact'], subtypes: 'Construct', keywords: ['Defender'] }] }] },
    'unexpected potential': { abilities: [{ kind: 'static', auto: true,
      text: 'You may spend mana as though it were mana of any color to cast spells with the chosen name.',
      effects: [{ op: 'spendAnyColor', chosenName: true }] }] },
    'worldknit': { abilities: [{ kind: 'static', auto: true,
      text: 'As long as every card in your card pool started the game in your library or in the command zone, lands you control have "{T}: Add one mana of any color."',
      effects: [{ op: 'continuous', layer: 6, scope: { who: 'you', what: 'land' }, cond: { kind: 'draftNoted', card: 'worldknit', flag: 'whole' },
        grantMana: [{ kind: 'mana', auto: true, granted: true, cost: TAP, text: '{T}: Add one mana of any color.', effects: [{ op: 'addManaAny', amount: 1 }] }] }] }] },
    "adriana's valor": { abilities: [{ kind: 'triggered', event: 'permAttacks', optional: false, auto: true,
      objFilter: { who: 'you', words: 'creature', chosenName: true },
      text: 'Whenever a creature you control with the chosen name attacks, you may pay {W}. If you do, that creature gains indestructible until end of turn.',
      effects: [{ op: 'mayPay', pay: { mana: '{W}' }, then: [{ op: 'grantKeyword', keywords: ['Indestructible'], duration: 'eot', scope: 'triggerObject' }] }] }] },
    'assemble the rank and vile': { abilities: [{ kind: 'static', auto: true,
      text: 'Creatures you control with the chosen name have "When this creature dies, you may pay {B}. If you do, create a tapped 2/2 black Zombie creature token."',
      effects: [{ op: 'continuous', layer: 6, scope: named(), grantText: 'When this creature dies, you may pay {B}. If you do, create a tapped 2/2 black Zombie creature token.' }] }] },
    'echoing boon': { abilities: [{ kind: 'triggered', event: 'youCastSpell', optional: true, auto: true,
      objFilter: { words: 'instant or sorcery' }, condition: { kind: 'spellTargetsChosen' },
      text: 'Whenever you cast an instant or sorcery spell, if it targets a creature you control with the chosen name, you may copy that spell and may choose new targets for the copy.',
      effects: [{ op: 'copyThatSpell' }] }] },
    "emissary's ploy": { abilities: [{ kind: 'static', auto: true,
      text: 'Before drawing your opening hand, choose 1, 2, or 3. You may spend mana as though it were mana of any color to cast creature spells with mana value equal to the chosen number.',
      effects: [{ op: 'spendAnyColor', words: 'creature', chosenMv: true }] }] },
    'hired heist': { abilities: [{ kind: 'triggered', event: 'permCombatDamage', optional: false, auto: true, toPlayer: true,
      objFilter: { who: 'you', words: 'creature', chosenName: true },
      text: 'Whenever a creature you control with the chosen name deals combat damage to a player, you may pay {U}. If you do, draw a card.',
      effects: [{ op: 'mayPay', pay: { mana: '{U}' }, then: [{ op: 'draw', n: 1, who: 'you' }] }] }] },
    'hold the perimeter': { abilities: [
      { kind: 'triggered', event: 'yourUpkeep', optional: false, auto: true, intervening: true, condition: { kind: 'firstUpkeep', of: 'active' },
        text: 'At the beginning of your first upkeep, create a 1/2 white Soldier creature token with defender.',
        effects: [{ op: 'createToken', n: 1, pt: '1/2', colorWords: ['white'], addTypes: [], subtypes: 'Soldier', keywords: ['Defender'] }] },
      { kind: 'triggered', event: 'opponentUpkeep', optional: false, auto: true, intervening: true, condition: { kind: 'firstUpkeep', of: 'active' },
        text: 'At the beginning of each other player’s first upkeep, that player creates a 1/1 red Goblin creature token with "This token can’t block."',
        effects: [{ op: 'activeToken', pt: '1/1', colorWords: ['red'], addTypes: [], subtypes: 'Goblin', keywords: [], grantedText: "This token can't block." }] }] },
    'hymn of the wilds': { abilities: [
      { kind: 'static', auto: true, text: 'The first creature spell you cast each turn costs {1} less to cast.',
        effects: [{ op: 'costMod', who: 'you', words: 'creature', firstEachTurn: true, amount: -1 }] },
      { kind: 'static', auto: true, text: "You can't cast instant or sorcery spells.",
        effects: [{ op: 'selfCantCast', words: 'instant or sorcery' }] }] },
    'incendiary dissent': { abilities: [{ kind: 'static', auto: true,
      text: 'Creatures you control with the chosen name have "{R}: This creature gets +1/+0 until end of turn."',
      effects: [{ op: 'continuous', layer: 6, scope: named(), grantText: '{R}: This creature gets +1/+0 until end of turn.' }] }] },
    'natural unity': { abilities: [{ kind: 'static', auto: true,
      text: 'Creatures you control with the chosen name have "At the beginning of combat on your turn, you may pay {G}. If you do, put a +1/+1 counter on this creature."',
      effects: [{ op: 'continuous', layer: 6, scope: named(), grantText: 'At the beginning of combat on your turn, you may pay {G}. If you do, put a +1/+1 counter on this creature.' }] }] },
    "summoner's bond": { abilities: [{ kind: 'triggered', event: 'youCastSpell', optional: true, auto: true,
      objFilter: { words: 'creature', chosenName: true },
      text: 'Whenever you cast a creature spell with one of the chosen names, you may search your library for a creature card with the other chosen name, reveal it, put it into your hand, then shuffle.',
      effects: [{ op: 'tutor', n: 1, filter: 'creature', chosenOther: true, to: 'hand', prompt: 'Search your library for a creature card with the other chosen name.' }] }] },
    'weight advantage': { abilities: [{ kind: 'static', auto: true,
      text: 'Each creature you control assigns combat damage equal to its toughness rather than its power.',
      effects: [{ op: 'toughnessDamage', who: 'you' }] }] },
  };
  /* Sovereign's Realm: the deck is kept free of basic lands when it is
     built, and the hand is five; its activated ability works from the
     command zone, which nothing here can activate, so that line is left
     to a person. */
  DRAFT_SCRIPTS["sovereign's realm"] = { abilities: [
    { kind: 'static', auto: true, text: "Your starting deck can't have basic land cards and your starting hand size is five.",
      effects: [{ op: 'startingHandSize', n: 5 }] },
    { kind: 'activated', auto: false, sorcerySpeed: false, cost: Object.assign({}, TAP, { tap: false, raw: 'Exile a card from your hand', other: ['Exile a card from your hand'] }),
      text: 'Exile a card from your hand: This turn, you may play basic lands from outside the game.',
      effects: [{ op: 'manual', text: 'This turn, you may play basic lands from outside the game.' }] },
    { kind: 'static', auto: true, text: 'Basic lands you control have "{T}: Add one mana of any color."',
      effects: [{ op: 'continuous', layer: 6, scope: { who: 'you', what: 'land', basic: true }, grantMana: [{ kind: 'mana', auto: true, granted: true, cost: TAP,
        text: '{T}: Add one mana of any color.', effects: [{ op: 'addManaAny', amount: 1 }] }] }] }] };
  if (MTG.scripts && MTG.scripts.all) {
    for (const [k, v] of Object.entries(DRAFT_SCRIPTS)) if (!MTG.scripts.all[k]) MTG.scripts.all[k] = v;
  }

  function boosterSpecFor(setInfo) {
    if (setInfo && setInfo.released_at && setInfo.released_at >= PLAY_BOOSTER.since) return PLAY_BOOSTER;
    return DRAFT_BOOSTER;
  }

  /**
   * Build one booster from a bucketed set pool.
   * Never repeats a card inside a pack (real packs do not either).
   */
  /* How often a Store pack's slot holds one of the cards folded into its
     set (a Commander deck's new cards, Alchemy's, see MTG.scry.packExtras)
     in place of the set's own, by slot. Drafts pass none, so their packs
     stay the set's. */
  const BONUS_RATE = { rareMythic: 0.1, wildcard: 0.08, uncommon: 0.02, common: 0.01 };

  function makeBooster(pool, rng, spec, opts) {
    opts = opts || {};
    const bonus = opts.bonus || null;
    // a folded-in card of the rarity asked for, now and then; marked so the opening can say where it is from
    const fromBonus = (slot, rarities) => {
      if (!bonus || !rng.chance(BONUS_RATE[slot] || 0)) return null;
      for (const r of rarities) {
        const list = (bonus[r] || []).filter(c => !used.has(c.id));
        if (list.length) { const c = list[rng.int(list.length)]; used.add(c.id); return Object.assign({}, c, { _bonus: true }); }
      }
      return null;
    };
    spec = spec || DRAFT_BOOSTER;
    const used = new Set();
    const out = [];
    const takeFrom = (list, allowDup) => {
      if (!list || !list.length) return null;
      for (let tries = 0; tries < 24; tries++) {
        const c = list[rng.int(list.length)];
        if (allowDup || !used.has(c.id)) { used.add(c.id); return c; }
      }
      const fresh = list.filter(c => !used.has(c.id));
      if (!fresh.length) return null;
      const c = fresh[rng.int(fresh.length)];
      used.add(c.id);
      return c;
    };
    const playable = pool.playable || (pool.all || []).filter(c => !MTG.formats.isBasicLand(c));
    const fallbackChain = (names) => {
      for (const nm of names) { const c = takeFrom(pool[nm]); if (c) return c; }
      return takeFrom(playable);
    };

    for (const slot of spec.slots) {
      for (let i = 0; i < slot.n; i++) {
        let card = null;
        switch (slot.pick) {
          case 'common': card = fromBonus('common', ['common']) || fallbackChain(['common', 'uncommon']); break;
          case 'uncommon': card = fromBonus('uncommon', ['uncommon']) || fallbackChain(['uncommon', 'common']); break;
          case 'rareMythic':
            card = fromBonus('rareMythic', rng.chance(0.125) ? ['mythic', 'rare'] : ['rare', 'mythic']);
            if (card) break;
            card = rng.chance(0.125) && pool.mythic.length
              ? takeFrom(pool.mythic) || takeFrom(pool.rare)
              : takeFrom(pool.rare) || takeFrom(pool.mythic);
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          case 'wildcard': {
            const r = rng.weighted(WILDCARD_MIX);
            card = fromBonus('wildcard', [r]) || takeFrom(pool[r]) || fallbackChain(['common', 'uncommon', 'rare', 'mythic']);
            break;
          }
          case 'variantRare': {
            // a special printing of a rare or mythic, or the plain one when the set has none
            const v = opts.variants;
            card = v && (v.rare.length || v.mythic.length)
              ? (rng.chance(0.2) && v.mythic.length ? takeFrom(v.mythic) : takeFrom(v.rare) || takeFrom(v.mythic))
              : null;
            if (!card) card = rng.chance(0.125) && pool.mythic.length ? takeFrom(pool.mythic) || takeFrom(pool.rare) : takeFrom(pool.rare) || takeFrom(pool.mythic);
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          }
          case 'variantUncommon': {
            const v = opts.variants;
            card = v && (v.uncommon.length || v.common.length) ? takeFrom(v.uncommon) || takeFrom(v.common) : null;
            if (!card) card = fallbackChain(['uncommon', 'common']);
            break;
          }
          case 'commonOrList':
            card = rng.chance(0.015) && opts.listPool && opts.listPool.length
              ? takeFrom(opts.listPool, true)
              : fallbackChain(['common']);
            break;
          case 'commonOrLand':
            card = (pool.nonbasicLands.length && rng.chance(0.35))
              ? takeFrom(pool.nonbasicLands) || fallbackChain(['common'])
              : fallbackChain(['common']);
            break;
          case 'land': {
            // what the basic-land slot is spent on instead
            const r = rng.weighted(LAND_SLOT_MIX);
            card = takeFrom(pool[r]) || fallbackChain(['common', 'uncommon', 'rare']);
            break;
          }
          default: card = takeFrom(playable);
        }
        if (card && slot.foil) card = Object.assign({}, card, { _foil: true });
        if (card) out.push(card);
      }
    }
    return out;
  }

  /** A cube pack: N singleton cards off the shuffled cube. */
  function makeCubePack(cubeCards, rng, size, usedSet) {
    const out = [];
    let guard = 0;
    while (out.length < size && guard++ < cubeCards.length * 3) {
      const c = cubeCards[rng.int(cubeCards.length)];
      if (usedSet.has(c.id)) continue;
      usedSet.add(c.id);
      out.push(c);
    }
    return out;
  }

  /* ---------------- cube storage ---------------- */
  const cubes = {
    list() { return MTG.store.get('cubes', []); },
    save(cube) {
      const all = cubes.list();
      const i = all.findIndex(c => c.id === cube.id);
      const slim = {
        id: cube.id, name: cube.name, size: cube.cards.length,
        packSize: cube.packSize, packs: cube.packs, updatedAt: Date.now(),
        recipe: cube.recipe || null,     // which shipped recipe built it, if any
        cardIds: cube.cards.map(c => c.id),
      };
      if (i >= 0) all[i] = slim; else all.push(slim);
      MTG.store.set('cubes', all);
      return slim;
    },
    remove(id) { MTG.store.set('cubes', cubes.list().filter(c => c.id !== id)); },
    async load(id) {
      const meta = cubes.list().find(c => c.id === id);
      if (!meta) return null;
      const { cards } = await MTG.scry.collection(meta.cardIds.map(i => ({ id: i })));
      return Object.assign({}, meta, { cards: cards.filter(Boolean) });
    },
  };

  /* ---------------- cubes you can have without owning one ----------------

     A cube is somebody's hand-built list, and nobody's list ships inside this
     file. What ships is a recipe: the shape a well-known kind of cube has —
     how many cards of each colour, what is allowed in it — which is filled in
     from Scryfall by play rate, so the result is a real, singleton, colour-
     balanced cube of recognisable cards that you can draft straight away.
     Build one and it is saved among your own cubes, where you can throw cards
     out of it, or replace it with a list of your own. */

  // things that are cards in a database but not cards you draft
  const CUBE_EXCLUDE = '-t:basic -is:funny -t:conspiracy -t:scheme -t:plane ' +
    '-t:phenomenon -t:vanguard -t:emblem -t:token -t:dungeon -t:attraction game:paper';

  /** The sections of a cube, as fractions of its size. */
  function cubeSections(base, size) {
    const mono = Math.round(size * 0.115);      // five colours, ~57.5%
    const gold = Math.round(size * 0.13);
    const grey = Math.round(size * 0.115);
    const land = size - mono * 5 - gold - grey;
    const q = (extra) => `${base} ${CUBE_EXCLUDE} ${extra}`;
    return [
      { label: 'white', q: q('c=w -t:land'), n: mono },
      { label: 'blue', q: q('c=u -t:land'), n: mono },
      { label: 'black', q: q('c=b -t:land'), n: mono },
      { label: 'red', q: q('c=r -t:land'), n: mono },
      { label: 'green', q: q('c=g -t:land'), n: mono },
      { label: 'gold', q: q('c:m -t:land'), n: gold },
      { label: 'colourless', q: q('c=c -t:land'), n: grey },
      { label: 'lands', q: q('t:land'), n: Math.max(0, land) },
    ];
  }

  const CUBE_RECIPES = [
    { id: 'vintage', name: 'Vintage cube', size: 540, packSize: 15,
      blurb: 'Everything the game has, at its most powerful: fast mana, the best removal, the cards that are banned everywhere else.',
      base: 'legal:vintage' },
    { id: 'legacy', name: 'Legacy cube', size: 450, packSize: 15,
      blurb: 'Powerful without the restricted list — the staples that hold up games rather than end them on turn one.',
      base: 'legal:legacy' },
    { id: 'modern', name: 'Modern cube', size: 360, packSize: 15,
      blurb: 'Modern-legal only. Newer card pools, fairer games, and a curve that actually matters.',
      base: 'legal:modern' },
    { id: 'peasant', name: 'Peasant cube', size: 360, packSize: 15,
      blurb: 'Commons and uncommons. The games are about card quality and curve rather than about who opened the bomb.',
      base: 'legal:legacy (r:common or r:uncommon)' },
    { id: 'pauper', name: 'Pauper cube', size: 360, packSize: 15,
      blurb: 'Commons only. Slower, grindier, and the closest a cube gets to a very good draft format.',
      base: 'legal:pauper r:common' },
    { id: 'creature', name: 'Creature cube', size: 360, packSize: 15,
      blurb: 'Creatures, the lands to cast them and almost nothing else. Combat every game.',
      base: 'legal:legacy (t:creature or t:land or t:equipment)' },
    { id: 'pioneer', name: 'Pioneer cube', size: 360, packSize: 15,
      blurb: 'Pioneer-legal: the last decade of sets at their best, without the oldest power.',
      base: 'legal:pioneer' },
    { id: 'premodern', name: 'Premodern cube', size: 360, packSize: 15,
      blurb: 'Fourth Edition to Scourge: old-border Magic as it was played, slower and full of character.',
      base: 'legal:premodern' },
    { id: 'oldborder', name: 'Old-border cube', size: 360, packSize: 15,
      blurb: 'Only cards first printed in 2003 or before. The classics, from Alpha to Scourge.',
      base: 'legal:vintage year<=2003' },
    { id: 'commandercube', name: 'Commander cube', size: 450, packSize: 15,
      blurb: 'Multiplayer staples: big swings, card advantage and the cards that make a Commander table fun.',
      base: 'legal:commander' },
    { id: 'legends', name: 'Legends cube', size: 360, packSize: 15,
      blurb: 'Legendary creatures, planeswalkers and legendary everything else, and the lands to cast them.',
      base: 'legal:commander (t:legendary or t:land)' },
    { id: 'arena', name: 'Arena cube', size: 450, packSize: 15,
      blurb: 'Cards on MTG Arena, in the spirit of the Arena Cube events.',
      base: 'game:arena legal:historic' },
    { id: 'uncommon', name: 'Uncommon cube', size: 360, packSize: 15,
      blurb: 'Uncommons only: every pick is a real card, and nobody opens a game-winning rare.',
      base: 'legal:legacy r:uncommon' },
    { id: 'graveyard', name: 'Graveyard cube', size: 360, packSize: 15,
      blurb: 'Flashback, reanimation, delve and dredge: everything that cares about the graveyard.',
      base: 'legal:legacy (o:graveyard or kw:flashback or kw:escape or kw:unearth or kw:delve or kw:embalm or kw:disturb or t:land)' },
    { id: 'artifact', name: 'Artifact cube', size: 360, packSize: 15,
      blurb: 'Artifacts and the cards that care about them: affinity, equipment, Thopters and Treasure.',
      base: 'legal:vintage (t:artifact or o:artifact or t:land)' },
  ];

  /**
   * Fill a recipe in from Scryfall. Each section is asked for by play rate,
   * so a cube is made of cards people recognise; duplicates across sections
   * are dropped, because a cube is singleton.
   */
  async function buildRecipe(recipe, opts) {
    opts = opts || {};
    const sections = cubeSections(recipe.base, recipe.size);
    const total = sections.reduce((a, s) => a + s.n, 0);
    const seen = new Set();
    const out = [];
    let done = 0;
    for (const sec of sections) {
      if (opts.onProgress) opts.onProgress(done, total, sec.label);
      let found = [];
      try {
        found = await MTG.scry.search(sec.q, { max: Math.ceil(sec.n * 1.6), order: 'edhrec', unique: 'cards' });
      } catch (e) { found = []; }
      let taken = 0;
      for (const c of found) {
        if (taken >= sec.n) break;
        const key = c.oracle_id || U.normName(c.name);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
        taken++;
      }
      done += sec.n;
      if (opts.onProgress) opts.onProgress(Math.min(done, total), total, sec.label);
    }
    return out;
  }

  /* ---------------- the draft ---------------- */

  const COLOR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  const isCreatureCard = (c) => /\bCreature\b/.test(((c && c.card_faces && c.card_faces[0]) || c || {}).type_line || (c && c.type_line) || '');
  /** A creature card's creature types, from the front face's type line. */
  function creatureTypes(c) {
    const line = String(((c.card_faces && c.card_faces[0]) || c).type_line || c.type_line || '');
    const parts = line.split(/\s+[—-]\s+/);
    return parts.length > 1 ? parts[1].split(/\s+/).filter(Boolean) : [];
  }
  /** A card's worth to anybody, without anybody's colours: what a bot guesses others will take. */
  function plainValue(c) {
    const rar = { common: 1, uncommon: 1.8, rare: 3, mythic: 3.6 }[c.rarity] || 1;
    return rar + (c.edhrec_rank ? U.clamp((40000 - c.edhrec_rank) / 12000, -1, 3) * 0.6 : 0);
  }

  /**
   * A seat-based draft. Humans and bots share the same interface; the host
   * runs the whole thing and broadcasts each seat's view.
   *
   * Each seat has a queue of packs in front of it and drafts from the one
   * on top. In an ordinary draft every queue holds one pack and every seat
   * picks at once; a Lore Seeker adds a pack to one queue, and from then on
   * one seat has two waiting until the round is over, just as at a table.
   */
  class Draft extends MTG.Emitter {
    constructor(cfg) {
      super();
      this.cfg = Object.assign({
        formatId: 'booster',
        seats: 8,
        packs: 3,
        packSize: 14,
        picksPerTurn: 1,
        setCodes: [],        // one per round, or one for all rounds
        chaos: false,
        cube: null,
        faceUp: false,
        seed: Date.now(),
        botDifficulty: 5,
        timerSeconds: 0,
        allAtOnce: false,    // every pack opened at the start, all passing together, in one round
      }, cfg);
      this.rng = new MTG.RNG(this.cfg.seed);
      this.seats = [];
      this.round = 0;
      this.pickNumber = 0;
      this.queues = [];        // per seat: the packs waiting in front of it, top first
      this.started = false;
      this.finished = false;
      this.history = [];
      this.pendingPicks = new Map();  // seatIndex -> the pick (null: nothing in front of it)
      this.roundPacks = [];    // pre-generated packs per round
      this.roundSources = [];  // per round: what a Lore Seeker's booster is made from
      this.asks = [];          // questions a card puts to a seat (Regicide's colours)
      this.abilityLog = [];
      this.broker = null;      // Deal Broker's trades, once the picks are done
      this._packSeq = 0;
      this._askSeq = 0;
      this._seenSeq = 0;
    }

    /** The pack on top of each seat's queue: what each seat is drafting from. */
    get packs() { return this.queues.map(q => q[0] || []); }

    addSeat(cfg) {
      const s = {
        index: this.seats.length,
        id: cfg.id || MTG.uid('seat'),
        name: cfg.name || ('Seat ' + (this.seats.length + 1)),
        isBot: !!cfg.isBot,
        botDifficulty: cfg.botDifficulty || this.cfg.botDifficulty,
        pool: [],
        colorScores: { W: 0, U: 0, B: 0, R: 0, G: 0 },
        picked: [],
        ready: false,
        spent: {},          // ability card id -> uses already taken
        sitOutRound: -1,    // Agent of Acquisitions: no more picks this round
        skipNext: 0,        // Leovold's Operative: packs to pass without drafting
        roundCount: 0,      // cards drafted this round, for "note how many cards you've drafted"
        blind: [],          // Archdemon of Paliano: {cardId, left} while it is face up
        awaitNext: [],      // Aether Searcher: the next card drafted is noted
        watchers: [],       // Illusionary Informant: who sees this seat's next card
        offers: [],         // Lore Seeker: waiting for a yes or no
        removed: [],        // Cogwork Grinder, Animus of Predation: {card, by, faceUp}
        seen: [],           // what this seat's cards let it look at
        shown: [],          // cards drafted face up or revealed, for the whole table
        draftedNames: [],   // every card it drafted, whether or not it is still in the pool
        notes: [],          // what the note-taking cards recorded, as words
        gameNotes: {},      // the same, for the game (see MTG.rules: draftNotes)
      };
      this.seats.push(s);
      return s;
    }
    _seat(id) { return this.seats.find(x => x.id === id) || null; }
    _queue(s) { return this.queues[s.index] || (this.queues[s.index] = []); }
    _packFor(s) { return this._queue(s)[0] || []; }
    _packOf(cards, from) { cards.from = from; cards.watch = []; cards.uid = ++this._packSeq; return cards; }
    _note(s, key) { return s.gameNotes[key] || (s.gameNotes[key] = {}); }

    /** Pre-generate every pack so the draft is deterministic from the seed. */
    async prepare(onProgress) {
      const rounds = this.cfg.packs;
      this.roundPacks = [];
      const setsUsed = new Set();
      // sets that were never sold in draft boosters, so the collation is a
      // reasonable guess rather than the real thing
      const looseSets = new Set();

      if (this.cfg.formatId === 'cube') {
        const cube = this.cfg.cube;
        if (!cube || !cube.cards || cube.cards.length < this.seats.length * this.cfg.packSize * rounds)
          throw new Error(`Cube needs at least ${this.seats.length * this.cfg.packSize * rounds} cards for ${this.seats.length} seats × ${rounds} packs of ${this.cfg.packSize}.`);
        const shuffled = this.rng.shuffle(cube.cards.slice());
        let k = 0;
        for (let r = 0; r < rounds; r++) {
          const packs = [];
          for (let s = 0; s < this.seats.length; s++) {
            packs.push(shuffled.slice(k, k + this.cfg.packSize));
            k += this.cfg.packSize;
          }
          this.roundPacks.push(packs);
        }
        // a Lore Seeker's booster is made of the cube's cards nobody opened
        const left = shuffled.slice(k);
        this.roundSources = this.roundPacks.map(() => ({ cards: left }));
        this.setsUsed = ['Cube: ' + cube.name];
        return;
      }

      // resolve which set each pack comes from
      const allSets = await MTG.scry.draftableSets();
      const pick = (r, seat) => {
        if (this.cfg.formatId === 'chaos') {
          // the host's pool, when they set one, otherwise anything draftable
          const wanted = (this.cfg.setCodes || []).filter(Boolean);
          const from = wanted.length
            ? allSets.filter(x => wanted.includes(x.code))
            : allSets.slice(0, 240);
          if (!from.length) return allSets[this.rng.int(Math.min(allSets.length, 240))];
          return from[this.rng.int(from.length)];
        }
        const code = this.cfg.setCodes[r] || this.cfg.setCodes[0];
        return allSets.find(s => s.code === code) || { code, released_at: '2024-06-01' };
      };

      const poolCache = new Map();
      const variantCache = new Map();
      const variantsFor = async (code) => {
        if (!variantCache.has(code)) variantCache.set(code, await MTG.scry.setVariants(code).catch(() => null));
        return variantCache.get(code);
      };
      const broken = new Set();
      const usable = (p) => p && p.all && p.all.length >= 20;
      const getPool = async (code) => {
        if (poolCache.has(code)) return poolCache.get(code);
        const p = await MTG.scry.setPool(code);
        poolCache.set(code, p);
        return p;
      };
      /* A chaos draft rolls its sets, so one that will not load can simply be
         rerolled — a pool of forty sets will always have one that 404s. A set
         the host actually chose is different: silently swapping it for another
         turns their booster draft into a chaos draft, which is worse than an
         error, so a named set either loads or the draft stops and says which
         set it was. */
      const rerollable = this.cfg.formatId === 'chaos';
      const poolFor = async (setInfo) => {
        let info = setInfo;
        let lastErr = null;
        for (let tries = 0; tries < (rerollable ? 6 : 1); tries++) {
          if (!broken.has(info.code)) {
            try {
              const p = await getPool(info.code);
              if (usable(p)) return { pool: p, setInfo: info };
              lastErr = new Error(`${info.name || info.code.toUpperCase()} has only ${(p && p.all ? p.all.length : 0)} cards Scryfall can give us \u2014 not enough to build a booster.`);
            } catch (e) { lastErr = e; }
            broken.add(info.code);
          }
          if (!rerollable) break;
          const alt = allSets.filter(x => !broken.has(x.code));
          if (!alt.length) break;
          info = alt[this.rng.int(alt.length)];
        }
        const who = setInfo.name || setInfo.code.toUpperCase();
        throw new Error(rerollable
          ? `Could not load cards for ${who}. Check the connection and try again.`
          : `${who} cannot be drafted here. ${lastErr && lastErr.message ? lastErr.message : 'Scryfall returned no cards for it.'} Pick another set.`);
      };

      let done = 0;
      const totalPacks = rounds * this.seats.length;
      /* Every pack at the table has to hold the same number of cards. Packs
         come in two shapes (a 14-card Play Booster and a 15-card Draft
         Booster) and a chaos draft mixes sets freely, so without this a seat
         runs out of cards several picks before the rest of the table and the
         draft waits forever on a pick that cannot be made. */
      const target = U.clamp(this.cfg.packSize || 15, 3, 60);
      this.roundSources = [];
      for (let r = 0; r < rounds; r++) {
        const packs = [];
        for (let s = 0; s < this.seats.length; s++) {
          const got = await poolFor(pick(r, s));
          const setInfo = got.setInfo, pool = got.pool;
          setsUsed.add(setInfo.code.toUpperCase());
          if (pool.loose) looseSets.add(setInfo.code.toUpperCase());
          const collector = !!this.cfg.collector;
          const spec = this.cfg.formatId === 'cmdrdraft'
            ? (collector ? CMDR_COLLECTOR : CMDR_PACK)
            : collector ? COLLECTOR_BOOSTER : boosterSpecFor(setInfo);
          const variants = collector ? await variantsFor(setInfo.code) : null;
          let pack = makeBooster(pool, this.rng, spec, { variants });
          if (pool.playable && pool.playable.some(isConspiracy)) pack = this._conspiracySlot(pack, pool);
          if (this.cfg.formatId === 'cmdrdraft') pack = await this._ensureLegends(pack, pool, setInfo);
          if (!s) this.roundSources[r] = { pool, spec };
          // a pack is its booster's real size; only a host who asked for another size gets one
          if (!this.cfg.packSizeAuto) pack = this._sizePack(pack, pool, target);
          packs.push(pack);
          done++;
          if (onProgress) onProgress(done, totalPacks, setInfo.code.toUpperCase());
        }
        this.roundPacks.push(packs);
      }
      /* Every pack at the table holds the same number of cards, or a seat
         runs dry before the rest. Packs of one set already do; a chaos draft
         mixing 14-card Play Boosters and 15-card Draft Boosters cuts the
         bigger ones down rather than padding the smaller ones with cards a
         real pack would not have. */
      if (this.cfg.packSizeAuto) {
        const all = this.roundPacks.flat();
        const size = Math.max(1, Math.min(...all.map(p => p.length)));
        for (const round of this.roundPacks) {
          for (let i = 0; i < round.length; i++) round[i] = this._sizePack(round[i], null, size);
        }
        this.cfg.packSize = size;
      }
      this.setsUsed = Array.from(setsUsed);
      this.looseSets = Array.from(looseSets);
      // keep one pool around so Lore Seeker has real cards to open
      const last = poolCache.values().next().value;
      this.spareCards = last && last.all ? last.all.slice() : [];
    }

    /**
     * Trim or top up one pack so it holds exactly `target` cards. Trimming
     * drops the basic-land slot first, since it is not a real pick; topping
     * up pulls commons, which is what a short pool is short of.
     */
    _sizePack(pack, pool, target) {
      const out = pack.slice();
      if (out.length > target) {
        // drop land-slot cards first, then commons, then from the back
        for (let i = out.length - 1; i >= 0 && out.length > target; i--) {
          if (out[i] && out[i]._landSlot) out.splice(i, 1);
        }
        for (let i = out.length - 1; i >= 0 && out.length > target; i--) {
          if (out[i] && out[i].rarity === 'common' && !out[i]._foil) out.splice(i, 1);
        }
        out.length = Math.min(out.length, target);
      }
      if (out.length < target && pool && pool.all && pool.all.length) {
        const playable = pool.playable || pool.all.filter(c => !MTG.formats.isBasicLand(c));
        const have = new Set(out.map(c => c.id));
        const spare = playable.filter(c => !have.has(c.id));
        while (out.length < target && spare.length) {
          const i = this.rng.int(spare.length);
          out.push(spare[i]);
          spare.splice(i, 1);
        }
        // a pool too thin even for that: repeat rather than hand out a short pack
        while (out.length < target && playable.length) out.push(playable[this.rng.int(playable.length)]);
      }
      return out;
    }

    async _ensureLegends(pack, pool, setInfo) {
      const isLegend = (c) => /Legendary/.test(c.type_line || '') && /Creature/.test(c.type_line || '');
      if (pack.filter(isLegend).length >= 2) return pack;
      const legends = pool.all.filter(isLegend);
      if (!legends.length) return pack;
      const out = pack.slice();
      while (out.filter(isLegend).length < 2 && legends.length) {
        const c = legends[this.rng.int(legends.length)];
        if (out.some(x => x.id === c.id)) { if (legends.length < 4) break; continue; }
        // replace a common
        const i = out.findIndex(x => x.rarity === 'common' && !isLegend(x));
        if (i < 0) break;
        out[i] = c;
      }
      return out;
    }

    /**
     * A booster for Lore Seeker, made the way this round's packs were: from
     * the same set and collation, or from the cube's unused cards.
     */
    _freshBooster() {
      const size = this.cfg.packSize || 15;
      const src = this.roundSources[this.round] || this.roundSources[0];
      let pack = [];
      if (src && src.pool) {
        pack = makeBooster(src.pool, this.rng, src.spec);
        if (src.pool.playable && src.pool.playable.some(isConspiracy)) pack = this._conspiracySlot(pack, src.pool);
        pack = this._sizePack(pack, src.pool, size);
      } else {
        const spare = (src && src.cards) || this.spareCards || [];
        const seen = new Set();
        for (let g = 0; g < size * 6 && pack.length < size && spare.length; g++) {
          const c = spare[this.rng.int(spare.length)];
          if (!c || seen.has(c.id)) continue;
          seen.add(c.id); pack.push(c);
        }
        if (src && src.cards) src.cards = src.cards.filter(c => !seen.has(c.id));
      }
      return pack;
    }

    /**
     * The Conspiracy sets put one conspiracy in every booster, in a slot of
     * its own: one turns up in place of a common, and none comes in any
     * other slot.
     */
    _conspiracySlot(pack, pool) {
      const cons = (pool.playable || []).filter(isConspiracy);
      if (!cons.length) return pack;
      const used = new Set(pack.map(c => c.id));
      const commons = (pool.common || []).filter(c => !isConspiracy(c) && !used.has(c.id));
      const out = pack.map(c => (isConspiracy(c) && commons.length ? commons.splice(this.rng.int(commons.length), 1)[0] : c));
      const i = out.map(c => c.rarity).lastIndexOf('common');
      const one = cons[this.rng.int(cons.length)];
      if (i >= 0) out[i] = one; else out.push(one);
      return out;
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.round = 0;
      this._openRound();
    }

    _openRound() {
      this.pickNumber = 0;
      /* All packs at once: each seat opens every one of its packs now, and
         they all pass the same way, a card at a time, until every one is
         empty; otherwise a pack each, round by round. */
      if (this.cfg.allAtOnce) this.queues = this.roundPacks[0].map((p, s) => this.roundPacks.map(r => this._packOf(r[s].slice(), null)));
      else this.queues = this.roundPacks[this.round].map(p => [this._packOf(p.slice(), null)]);
      for (const s of this.seats) s.roundCount = 0;
      this.direction = this.cfg.allAtOnce ? 1 : (this.round % 2 === 0 ? 1 : -1);  // left, right, left
      this.emit('round:begin', this.round + 1, this.setsUsed);
      MTG.sfx('pack_open');
      this._beginPick();
    }

    /** Archdemon of Paliano: how many more cards this seat drafts at random. */
    _blindLeft(s) { return s.blind.reduce((m, b) => Math.max(m, b.left), 0); }

    _beginPick() {
      this.pendingPicks.clear();
      for (const s of this.seats) {
        const pack = this._packFor(s);
        // nothing in front of it: it waits for a pack, and nobody waits for it
        if (!pack.length) { this.pendingPicks.set(s.index, null); continue; }
        if (s.sitOutRound === this.round) { this.pendingPicks.set(s.index, { pass: true }); continue; }
        if (s.skipNext > 0) { this.pendingPicks.set(s.index, { pass: true, skip: true }); continue; }
        if (this._blindLeft(s) > 0) {
          const ids = this.rng.shuffle(pack.map(c => c.id)).slice(0, Math.min(this.cfg.picksPerTurn, pack.length));
          this.pendingPicks.set(s.index, { ids, random: true, mods: [] });
        }
      }
      this.emit('pick:begin', this.pickNumber + 1);
      // bots pick immediately (with a small delay handled by the caller)
      for (const s of this.seats) if (s.isBot && !this.pendingPicks.has(s.index)) this._botPick(s);
      this._maybeAdvance();
    }

    /**
     * A seat makes its pick. `opts.ability` is the card in its pool that
     * changes what the pick is: an extra card off this pack, or the whole
     * pack. `opts.mods` are cards spent on the first card taken (Cogwork
     * Grinder removes it, Noble Banneret notes its name); `opts.guess` is
     * Spire Phantasm's guess at the next card taken from this pack.
     */
    pick(seatId, cardIds, opts) {
      opts = opts || {};
      const s = this._seat(seatId);
      if (!s || !this.started || this.finished || this.broker || this._holding) return false;
      if (this.pendingPicks.has(s.index)) return false;
      const pack = this._packFor(s);
      if (!pack.length) return false;
      const usable = this.availableAbilities(seatId);
      let ability = null;
      if (opts.ability) {
        ability = usable.find(a => a.cardId === opts.ability && (a.kind === 'extraPick' || a.kind === 'wholePack'));
        if (!ability) return false;
      }
      const mods = [];
      for (const id of (opts.mods || [])) {
        const m = usable.find(a => a.cardId === id && a.mod);
        if (!m) return false;
        if (!mods.includes(m)) mods.push(m);
      }
      if (mods.filter(m => m.kind === 'remove').length > 1) return false;
      let ids;
      if (ability && ability.kind === 'wholePack') ids = pack.map(c => c.id);
      else {
        const want = Math.min(this.cfg.picksPerTurn + (ability ? 1 : 0), pack.length);
        ids = (cardIds || []).slice(0, want);
        if (ids.length !== want) return false;
        if (new Set(ids).size !== ids.length) return false;
        if (!ids.every(id => pack.some(c => c.id === id))) return false;
      }
      // noting a creature's name or types needs a creature
      const first = pack.find(c => c.id === ids[0]);
      if (mods.some(m => m.creature) && !isCreatureCard(first)) return false;
      this.pendingPicks.set(s.index, { ids, ability, mods, guess: opts.guess || null });
      MTG.sfx('pick');
      this._maybeAdvance();
      return true;
    }

    _botPick(s) {
      const pack = this._packFor(s);
      if (!pack.length) { this.pendingPicks.set(s.index, null); return; }
      const rate = new Map(pack.map(c => [c.id, this._botRate(s, c)]));
      const ranked = pack.slice().sort((a, b) => rate.get(b.id) - rate.get(a.id));
      const usable = this.availableAbilities(s.id);
      const n = Math.min(this.cfg.picksPerTurn, pack.length);
      let ability = null;
      let ids = ranked.slice(0, n).map(c => c.id);
      /* An extra-pick card is spent when the pack still holds a second card
         worth having; a weak second card is not worth the Librarian. */
      const extra = usable.find(a => a.kind === 'extraPick');
      if (extra && pack.length > n && ranked[n] && rate.get(ranked[n].id) > 2.2) {
        ability = extra;
        ids = ranked.slice(0, n + 1).map(c => c.id);
      }
      /* Agent of Acquisitions: a small pack with three cards it wants, late
         enough in the round that sitting the rest out costs little. */
      const whole = usable.find(a => a.kind === 'wholePack');
      if (!ability && whole && pack.length >= 3 && pack.length <= 5 && ranked.slice(0, 3).every(c => rate.get(c.id) > 2)) {
        ability = whole;
        ids = ranked.map(c => c.id);
      }
      const first = pack.find(c => c.id === ids[0]);
      const mods = this._botMods(s, first, usable);
      const guessFor = pack.filter(c => !ids.includes(c.id)).sort((a, b) => plainValue(b) - plainValue(a))[0];
      this.pendingPicks.set(s.index, { ids, ability, mods, guess: guessFor ? guessFor.name : null });
    }

    /** The colours a bot is in by now: its two best. */
    _topColors(s) {
      return Object.keys(s.colorScores).sort((a, b) => (s.colorScores[b] || 0) - (s.colorScores[a] || 0)).slice(0, 2);
    }
    _offColor(s, c) {
      const ci = c.color_identity || [];
      if (!ci.length || s.pool.length < 8) return false;
      const top = this._topColors(s);
      return !ci.some(x => top.includes(x));
    }

    /** What a bot spends on the card it is taking first. */
    _botMods(s, card, usable) {
      const mods = [];
      if (!card) return mods;
      const late = this.cfg.allAtOnce ? this.pickNumber >= this.cfg.packs * 7 : (this.round >= this.cfg.packs - 1 && this.pickNumber >= 7);
      for (const a of usable) {
        if (!a.mod) continue;
        const def = DRAFT_ABILITIES[a.key] || {};
        if (a.kind === 'note') {
          if (def.creature && !isCreatureCard(card)) continue;
          // a name worth noting is a card worth having; the last pack takes what it can get
          if (plainValue(card) >= 3 || late) mods.push(a);
        } else if (a.kind === 'remove' && !mods.some(m => m.kind === 'remove')) {
          // a card it will not play: for Animus of Predation, one with a keyword worth having
          if (!this._offColor(s, card)) continue;
          if (def.shown && !(isCreatureCard(card) && (card.keywords || []).some(k => ANIMUS_KW.some(x => x.toLowerCase() === String(k).toLowerCase())))) continue;
          mods.push(a);
        }
      }
      return mods;
    }

    /** Bot pick value: card quality, colour commitment, curve, with noise by difficulty. */
    _botRate(seat, card) {
      const d = U.clamp(seat.botDifficulty, 1, 10);
      const a = MTG.oracle.analyze(card);
      let v = 0;
      const rar = { common: 1.0, uncommon: 1.8, rare: 3.0, mythic: 3.6, special: 2.5, bonus: 2.5 }[card.rarity] || 1;
      v += rar;
      // EDHREC rank is a decent generic power proxy when present
      if (card.edhrec_rank) v += U.clamp((40000 - card.edhrec_rank) / 12000, -1, 3) * 0.6;
      if (a) {
        if (a.isCreature) v += 0.7;
        const mv = a.mv || 0;
        v += mv >= 2 && mv <= 4 ? 0.4 : (mv >= 7 ? -0.6 : 0);
        if (a.isLand && !a.isBasicLand) v += 0.3;
        if (a.isBasicLand) v -= 5;
        const kw = a.keywordSet;
        for (const k of ['flying', 'deathtouch', 'lifelink', 'trample', 'first strike', 'menace', 'vigilance', 'haste'])
          if (kw.has(k)) v += 0.22;
        if (/destroy target|exile target|deals \d+ damage to (any target|target creature)/i.test(card.oracle_text || '')) v += 0.8;
        if (/draw (two|three) cards/i.test(card.oracle_text || '')) v += 0.5;
        // colour commitment: bots settle into two colours as the draft goes on
        const ci = card.color_identity || [];
        if (ci.length === 0) v += 0.35;
        else {
          const commit = ci.reduce((acc, c) => acc + (seat.colorScores[c] || 0), 0) / ci.length;
          const totalPicks = Math.max(1, seat.pool.length);
          const weight = U.clamp(totalPicks / 12, 0, 1.6) * (0.5 + d / 12);
          v += commit * 0.22 * weight;
          if (ci.length >= 3) v -= 0.5;
        }
        // curve awareness at higher difficulty
        if (d >= 5 && a.isCreature) {
          const have = seat.pool.filter(c => Math.floor(c.cmc || 0) === Math.floor(card.cmc || 0)).length;
          v -= Math.max(0, have - 4) * 0.12;
        }
        // a bot cannot play a card that has to be resolved by hand, so it does not take one
        if (!a.isLand && !a.fullyAutomated) v -= 1.5;
      }
      // difficulty noise: a level-1 bot is nearly random, level 10 is steady
      const noise = (1.9 - d * 0.18);
      v += (this.rng.next() - 0.5) * noise * 2;
      return v;
    }

    /* A table of bots drafts the whole thing in one go: each pick that
       completes starts the next, so the steps run in a loop rather than
       each inside the last. */
    _maybeAdvance() {
      if (this._advancing) { this._again = true; return; }
      this._advancing = true;
      try {
        do { this._again = false; this._advanceOnce(); } while (this._again);
      } finally { this._advancing = false; }
    }
    _advanceOnce() {
      if (this.finished || this.broker || this._holding) return;
      if (this.pendingPicks.size < this.seats.length) return;
      const acted = [];
      let drafted = 0;
      for (const s of this.seats) {
        const p = this.pendingPicks.get(s.index);
        if (!p) continue;
        acted.push(s);
        if (!p.pass) drafted++;
        if (p.pass) {
          if (p.skip) { s.skipNext--; this.logAbility(`${s.name} passes a pack without drafting from it (Leovold's Operative).`); }
          continue;
        }
        this._takePicks(s, this._packFor(s), p);
      }
      this._dredgeLastCards(acted);
      this.pickNumber++;
      /* Packs only going round, with every seat that holds one sitting the
         round out, would go round for ever: once they have been all the
         way round twice with nobody drafting, what is left of the round is
         set aside. */
      this._idle = drafted ? 0 : (this._idle || 0) + 1;
      if (this._idle > this.seats.length * 2) { for (const q of this.queues) q.length = 0; this._idle = 0; }
      this._passPacks(acted);
      // a bot says yes to a Lore Seeker straight away; its new pack is its next pick
      for (const s of this.seats) if (s.isBot) for (const o of s.offers.slice()) this.answerOffer(s.id, o.cardId, true, true);
      this.emit('pick:done', this.pickNumber);
      this._proceed();
    }

    /**
     * On to the next pick, the next round or the end, unless a Lore Seeker
     * is still waiting for its answer: a booster it adds is drafted this
     * round, from the next pick, so nothing moves until it is answered.
     */
    _proceed() {
      if (this.seats.some(s => s.offers.length)) { this._holding = true; return; }
      this._holding = false;
      if (!this.queues.some(q => q.some(p => p.length))) {
        // all packs at once: there was only the one round
        this.round = this.cfg.allAtOnce ? this.cfg.packs : this.round + 1;
        for (const s of this.seats) s.sitOutRound = -1;
        if (this.round >= this.cfg.packs) { this._endPicks(); return; }
        this._openRound();
        return;
      }
      this._beginPick();
    }

    /** Each seat that drafted or passed hands its pack on; an emptied pack is put away. */
    _passPacks(acted) {
      const n = this.seats.length;
      const moving = [];
      for (const s of acted) {
        const pack = this._queue(s).shift();
        if (pack && pack.length) moving.push([s.index, pack]);
      }
      for (const [i, pack] of moving) {
        const to = ((i + this.direction) % n + n) % n;
        pack.from = i;
        this.queues[to].push(pack);
      }
    }

    /** One seat's pick, one card at a time (Agent of Acquisitions takes a pack that way). */
    _takePicks(s, pack, p) {
      const cards = p.ids.map(id => pack.find(c => c.id === id)).filter(Boolean);
      cards.forEach((c, i) => {
        const at = pack.indexOf(c);
        if (at < 0) return;
        pack.splice(at, 1);
        this._draftCard(s, c, pack, { mods: i === 0 ? (p.mods || []) : [], random: !!p.random, guess: p.guess });
      });
      if (p.ability) this._spendAbility(s, p.ability, pack);
    }

    /** Apply the extra pick or the whole-pack grab the seat spent on this pick. */
    _spendAbility(s, ability, pack) {
      s.spent[ability.cardId] = (s.spent[ability.cardId] || 0) + 1;
      const def = DRAFT_ABILITIES[ability.key] || {};
      if (ability.kind === 'wholePack') {
        s.sitOutRound = this.round;
        this.logAbility(`${s.name} drafts the whole pack with ${ability.name}, and sits out the rest of the round.`);
      } else if (def.returns) {
        // the card goes back into the pack it helped empty
        const i = s.pool.findIndex(c => c.id === ability.cardId);
        if (i >= 0) { const [c] = s.pool.splice(i, 1); pack.push(c); }
        this.logAbility(`${s.name} drafts an extra card and puts ${ability.name} into the pack.`);
      } else {
        if (def.skipNext) s.skipNext++;
        this.logAbility(`${s.name} turns ${ability.name} face down for an extra card${def.skipNext ? ', and will pass the next pack without drafting from it' : ''}.`);
      }
      this.emit('ability', { seat: s.index, card: ability.name, kind: ability.kind });
    }

    /**
     * Draft one card: it comes off the pack, anything watching that pack or
     * this seat sees it, the cards already in the pool note what they note,
     * and it goes into the pool (or out of the draft, for a Cogwork Grinder),
     * where its own draft ability then begins.
     */
    _draftCard(s, c, pack, ctx) {
      s.roundCount++;
      s.draftedNames.push(c.name);
      // Archdemon of Paliano counts the cards drafted at random while it is face up
      if (ctx.random) {
        for (const b of s.blind) {
          if (b.left <= 0) continue;
          if (--b.left === 0) this.logAbility(`${s.name} has drafted three cards at random and turns Archdemon of Paliano face down.`);
        }
      }
      for (const w of (pack.watch || []).splice(0)) this._watched(w, s, c);
      for (const w of s.watchers.splice(0)) this._watched(w, s, c);
      for (const m of (ctx.mods || [])) if (m.kind === 'note') this._noteCard(s, m, c);
      for (const key of s.awaitNext.splice(0)) {
        const n = this._note(s, key);
        n.names = (n.names || []).concat([c.name]);
        s.notes.push({ by: 'Aether Searcher', text: `noted ${c.name}` });
        this.logAbility(`${s.name} reveals ${c.name} and notes its name for Aether Searcher.`);
      }
      const removeBy = (ctx.mods || []).find(m => m.kind === 'remove');
      if (removeBy) { this._removeCard(s, removeBy, c); return; }
      s.pool.push(c);
      s.picked.push({ round: this.round + 1, pick: this.pickNumber + 1, cardId: c.id, name: c.name });
      for (const col of (c.color_identity || [])) s.colorScores[col] = (s.colorScores[col] || 0) + 1;
      this.history.push({ seat: s.index, round: this.round + 1, pick: this.pickNumber + 1, card: c.name });
      this._onDrafted(s, c, pack, ctx);
    }

    /** A card's own ability, starting as it is drafted. */
    _onDrafted(s, c, pack, ctx) {
      const def = draftAbilityOf(c);
      if (!def) return;
      if (def.faceUp || def.reveal) {
        s.shown.push({ cardId: c.id, name: c.name, how: def.faceUp ? 'face up' : 'revealed' });
        this.logAbility(`${s.name} ${def.faceUp ? 'drafts' : 'reveals'} ${c.name}${def.faceUp ? ' face up' : ''}.`);
      }
      const n = () => this._note(s, def.key);
      switch (def.kind) {
        case 'count': {
          n().numbers = (n().numbers || []).concat([s.roundCount]);
          s.notes.push({ by: c.name, text: `noted ${s.roundCount}` });
          this.logAbility(`${s.name} notes ${s.roundCount} for ${c.name}.`);
          break;
        }
        case 'colors': this._startColors(s, c, def.key); break;
        case 'addPack': s.offers.push({ cardId: c.id, name: c.name, kind: 'addPack', prompt: def.prompt }); break;
        case 'noteNext': s.awaitNext.push(def.key); break;
        case 'spy': if (pack.length) pack.watch.push({ seat: s.index, kind: 'see', by: c.name }); break;
        case 'guess': {
          if (!pack.length) break;
          const names = pack.map(x => x.name);
          const guess = names.includes(ctx.guess) ? ctx.guess : pack.slice().sort((a, b) => plainValue(b) - plainValue(a))[0].name;
          pack.watch.push({ seat: s.index, kind: 'guess', by: c.name, guess });
          s.notes.push({ by: c.name, text: `guessed ${guess}` });
          this.logAbility(`${s.name} guesses the next card that will be drafted from that pack.`);
          break;
        }
        case 'passer': {
          const from = pack.from != null && pack.from !== s.index ? this.seats[pack.from] : null;
          if (!from) { s.notes.push({ by: c.name, text: 'nobody passed it' }); break; }
          n().players = (n().players || []).concat([from.id]);
          s.notes.push({ by: c.name, text: `noted ${from.name}` });
          this.logAbility(`${s.name} notes ${from.name}, who passed them ${c.name}.`);
          break;
        }
        case 'blind': s.blind.push({ cardId: c.id, left: def.n || 3 }); break;
        default: break;
      }
    }

    /** Noble Banneret, Paliano Vanguard, Smuggler Captain: reveal the card and note it, then turn face down. */
    _noteCard(s, m, c) {
      const def = DRAFT_ABILITIES[m.key] || {};
      s.spent[m.cardId] = (s.spent[m.cardId] || 0) + 1;
      const n = this._note(s, m.key);
      if (def.what === 'types') {
        const types = creatureTypes(c);
        n.types = Array.from(new Set((n.types || []).concat(types)));
        s.notes.push({ by: m.name, text: `noted ${types.join(' ') || 'no creature types'}` });
        this.logAbility(`${s.name} reveals ${c.name} and notes its creature types for ${m.name}.`);
      } else {
        n.names = (n.names || []).concat([c.name]);
        s.notes.push({ by: m.name, text: `noted ${c.name}` });
        this.logAbility(`${s.name} reveals ${c.name} and notes its name for ${m.name}.`);
      }
      this.emit('ability', { seat: s.index, card: m.name, kind: 'note' });
    }

    /** Cogwork Grinder (face down) and Animus of Predation (face up): the card leaves the draft. */
    _removeCard(s, m, c) {
      const def = DRAFT_ABILITIES[m.key] || {};
      s.spent[m.cardId] = (s.spent[m.cardId] || 0) + 1;
      s.removed.push({ card: c, by: m.name, faceUp: !!def.shown });
      const n = this._note(s, m.key);
      n.removed = (Number(n.removed) || 0) + 1;
      if (def.shown) {
        n.cards = (n.cards || []).concat([c.name]);
        // "a creature card with flying": only a creature's keywords count
        if (isCreatureCard(c)) {
          const kws = (c.keywords || []).map(k => String(k).toLowerCase());
          n.keywords = Array.from(new Set((n.keywords || []).concat(ANIMUS_KW.map(k => k.toLowerCase()).filter(k => kws.includes(k)))));
        }
        s.notes.push({ by: m.name, text: `removed ${c.name}` });
        this.logAbility(`${s.name} removes ${c.name} from the draft with ${m.name}.`);
      } else {
        s.notes.push({ by: m.name, text: `removed ${c.name} face down` });
        this.logAbility(`${s.name} removes a card from the draft face down with ${m.name}.`);
      }
      this.emit('ability', { seat: s.index, card: m.name, kind: 'remove' });
    }

    /** Something a card was watching for has been drafted. */
    _watched(w, drafter, c) {
      const who = this.seats[w.seat];
      if (!who) return;
      if (w.kind === 'guess') {
        const right = w.guess === c.name;
        if (right) { const n = this._note(who, 'spire phantasm'); n.right = (Number(n.right) || 0) + 1; }
        who.notes.push({ by: w.by, text: right ? `guessed ${c.name}: right` : `guessed ${w.guess}: it was ${c.name}` });
        this.logAbility(`${drafter.name} reveals ${c.name}: ${who.name}'s guess for ${w.by} was ${right ? 'right' : 'wrong'}.`);
        return;
      }
      this._see(who, w.by, `${drafter.name === who.name ? 'You' : drafter.name} drafted ${c.name}.`, [c]);
    }
    _see(s, by, text, cards) { s.seen.push({ id: ++this._seenSeq, by, text, cards: cards.slice() }); }

    /**
     * Canal Dredger: the last card of a pack is passed to a player who
     * drafted one, instead of to the next player. Whoever holds the last
     * card hands it to themselves if they drafted a Dredger, and otherwise
     * to the next player along who did.
     */
    _dredgeLastCards(acted) {
      const owners = this.seats.filter(s => s.draftedNames.some(nm => U.normName(nm) === 'canal dredger'));
      if (!owners.length) return;
      const n = this.seats.length;
      for (const s of acted) {
        const pack = this._packFor(s);
        if (pack.length !== 1) continue;
        let owner = owners.includes(s) ? s : null;
        for (let k = 1; !owner && k <= n; k++) {
          const t = this.seats[((s.index + this.direction * k) % n + n) % n];
          if (owners.includes(t)) owner = t;
        }
        const [c] = pack.splice(0, 1);
        owner.pool.push(c);
        owner.picked.push({ round: this.round + 1, pick: this.pickNumber + 1, cardId: c.id, name: c.name, dredged: true });
        for (const col of (c.color_identity || [])) owner.colorScores[col] = (owner.colorScores[col] || 0) + 1;
        this._see(owner, 'Canal Dredger', `The last card of ${s === owner ? 'your' : s.name + '’s'} pack comes to you: ${c.name}.`, [c]);
        this.logAbility(s === owner ? `${s.name} keeps the last card of a pack (Canal Dredger).` : `${s.name} passes the last card of a pack to ${owner.name} (Canal Dredger).`);
        this.emit('ability', { seat: owner.index, card: 'Canal Dredger', kind: 'lastCard' });
      }
    }

    /* ---------------- Paliano, the High City and Regicide ----------------
       "The player to your right chooses a color, you choose another color,
       then the player to your left chooses a third color." Passing left is
       passing to the next seat, so the player to your right is the one
       before you. The draft goes on while they choose. */
    _startColors(s, c, key) {
      const n = this.seats.length;
      const chain = { owner: s.index, key, card: c.name,
        order: [(s.index - 1 + n) % n, s.index, (s.index + 1) % n], chosen: [] };
      this._askColor(chain);
    }
    _askColor(chain) {
      const k = chain.chosen.length;
      const owner = this.seats[chain.owner];
      if (k >= 3) {
        const note = this._note(owner, chain.key);
        note.colors = Array.from(new Set((note.colors || []).concat(chain.chosen)));
        owner.notes.push({ by: chain.card, text: `chose ${chain.chosen.map(x => COLOR_NAMES[x]).join(', ')}` });
        this.logAbility(`${chain.card} (${owner.name}): ${chain.chosen.map(x => COLOR_NAMES[x]).join(', ')}.`);
        return;
      }
      const who = this.seats[chain.order[k]];
      const options = Object.keys(COLOR_NAMES).filter(x => !chain.chosen.includes(x));
      if (who.isBot) { this._answerColor(chain, this._botColor(who, owner, chain.key, options)); return; }
      const prompt = who === owner
        ? (k === 1 ? `${chain.card}: ${COLOR_NAMES[chain.chosen[0]]} was chosen for you. Choose another colour.` : `${chain.card}: choose a colour.`)
        : `${owner.name} drafted ${chain.card}. Choose ${k === 0 ? 'a' : 'a third'} colour for it.`;
      this.asks.push({ id: ++this._askSeq, seat: who.index, kind: 'color', prompt, options, chain });
      this.touchDraft();
    }
    _answerColor(chain, color) {
      chain.chosen.push(color);
      this._askColor(chain);
    }
    /**
     * A bot's colour: its own Paliano wants the colours it plays, its own
     * Regicide the colours everybody else plays; for a neighbour's, the
     * colour least use to the drafter, or least threat to itself.
     */
    _botColor(who, owner, key, options) {
      const others = (c) => this.seats.filter(x => x !== owner).reduce((t, x) => t + (x.colorScores[c] || 0), 0);
      const score = (c) => who === owner
        ? (key === 'regicide' ? others(c) : (owner.colorScores[c] || 0))
        : (key === 'regicide' ? -(who.colorScores[c] || 0) : -(owner.colorScores[c] || 0));
      return options.slice().sort((a, b) => score(b) - score(a))[0];
    }
    /** A person's answer to a question a card put to them. */
    answerAsk(seatId, askId, value) {
      const s = this._seat(seatId);
      const i = this.asks.findIndex(a => a.id === askId && s && a.seat === s.index);
      if (i < 0) return false;
      const a = this.asks[i];
      if (!a.options.includes(value)) return false;
      this.asks.splice(i, 1);
      this._answerColor(a.chain, value);
      this.touchDraft();
      return true;
    }

    /** The picks are over: what is still unanswered is answered, then Deal Broker, then the end. */
    _endPicks() {
      for (const a of this.asks.splice(0)) {
        const who = this.seats[a.seat];
        this._answerColor(a.chain, this._botColor(who, this.seats[a.chain.owner], a.chain.key, a.options));
      }
      for (const a of this.asks.splice(0)) this._answerColor(a.chain, a.options[0]);
      this._startBroker();
    }

    _finish() {
      this.finished = true;
      this.emit('draft:done');
      MTG.sfx('notify');
    }

    /* ---------------- Deal Broker ----------------
       "Immediately after the draft, you may reveal a card in your card
       pool. Each other player may offer you one card in their card pool in
       exchange. You may accept any one offer." Each player with a Deal
       Broker does this in turn. */
    _startBroker() {
      const queue = this.seats.filter(s => s.pool.some(c => U.normName(U.frontName(c.name)) === 'deal broker')).map(s => s.index);
      if (!queue.length) { this._finish(); return; }
      this.broker = { queue, seat: null, stage: null, card: null, offers: {} };
      this._nextBroker();
    }
    _nextBroker() {
      const b = this.broker;
      const i = b.queue.shift();
      if (i == null) { this.broker = null; this._finish(); return; }
      Object.assign(b, { seat: i, stage: 'reveal', card: null, offers: {} });
      const s = this.seats[i];
      if (s.isBot) { this.brokerAct(s.id, { act: 'brokerReveal', cardId: this._botRevealFor(s) }); return; }
      this.touchDraft();
    }
    /** What a card is worth to this seat, without a bot's noise: quality and colour. */
    _fitValue(s, c) {
      const ci = c.color_identity || [];
      const top = this._topColors(s);
      return plainValue(c) + (!ci.length ? 0.4 : ci.every(x => top.includes(x)) ? 1.2 : ci.some(x => top.includes(x)) ? 0.3 : -1);
    }
    _botRevealFor(s) {
      // the most valuable card it will not play
      const off = s.pool.filter(c => this._offColor(s, c) && !isConspiracy(c));
      const best = off.sort((a, b) => plainValue(b) - plainValue(a))[0];
      return best && plainValue(best) >= 1.8 ? best.id : null;
    }
    _botOfferFor(s, revealed) {
      if (this._fitValue(s, revealed) < 2.4) return null;
      const worst = s.pool.filter(c => c.id !== revealed.id && !isConspiracy(c)).sort((a, b) => this._fitValue(s, a) - this._fitValue(s, b))[0];
      return worst && this._fitValue(s, worst) < this._fitValue(s, revealed) ? worst.id : null;
    }
    brokerAct(seatId, a) {
      const b = this.broker;
      const s = this._seat(seatId);
      if (!b || !s) return false;
      const broker = this.seats[b.seat];
      if (a.act === 'brokerReveal') {
        if (s !== broker || b.stage !== 'reveal') return false;
        const card = a.cardId ? broker.pool.find(c => c.id === a.cardId) : null;
        if (a.cardId && !card) return false;
        if (!card) { this.logAbility(`${broker.name} makes no trade with Deal Broker.`); this._nextBroker(); return true; }
        b.card = card; b.stage = 'offer';
        this.logAbility(`${broker.name} reveals ${card.name} with Deal Broker.`);
        for (const x of this.seats) if (x !== broker && x.isBot) b.offers[x.index] = this._botOfferFor(x, card);
        this._brokerOffersIn();
        return true;
      }
      if (a.act === 'brokerOffer') {
        if (s === broker || b.stage !== 'offer' || Object.prototype.hasOwnProperty.call(b.offers, s.index)) return false;
        if (a.cardId && !s.pool.some(c => c.id === a.cardId)) return false;
        b.offers[s.index] = a.cardId || null;
        this._brokerOffersIn();
        return true;
      }
      if (a.act === 'brokerAccept') {
        if (s !== broker || b.stage !== 'accept') return false;
        const from = a.cardId ? this.seats.find(x => b.offers[x.index] === a.cardId) : null;
        if (a.cardId && !from) return false;
        if (from) {
          const give = broker.pool.indexOf(b.card), take = from.pool.findIndex(c => c.id === a.cardId);
          if (give < 0 || take < 0) return false;
          const [mine] = broker.pool.splice(give, 1);
          const [theirs] = from.pool.splice(take, 1);
          broker.pool.push(theirs); from.pool.push(mine);
          this.logAbility(`${broker.name} trades ${mine.name} to ${from.name} for ${theirs.name} (Deal Broker).`);
        } else this.logAbility(`${broker.name} turns down every offer for ${b.card.name}.`);
        this._nextBroker();
        return true;
      }
      return false;
    }
    _brokerOffersIn() {
      const b = this.broker;
      const others = this.seats.filter(x => x.index !== b.seat);
      if (others.some(x => !Object.prototype.hasOwnProperty.call(b.offers, x.index))) { this.touchDraft(); return; }
      b.stage = 'accept';
      const broker = this.seats[b.seat];
      if (broker.isBot) {
        const offered = others.map(x => b.offers[x.index] && x.pool.find(c => c.id === b.offers[x.index])).filter(Boolean);
        const best = offered.sort((p, q) => this._fitValue(broker, q) - this._fitValue(broker, p))[0];
        const take = best && this._fitValue(broker, best) > this._fitValue(broker, b.card) ? best.id : null;
        this.brokerAct(broker.id, { act: 'brokerAccept', cardId: take });
        return;
      }
      this.touchDraft();
    }
    _brokerView(s) {
      const b = this.broker;
      if (!b || !s) return null;
      const broker = this.seats[b.seat];
      const mine = s === broker;
      const offers = Object.entries(b.offers).filter(([, id]) => id).map(([i, id]) => {
        const x = this.seats[+i];
        return { seat: x.name, card: x.pool.find(c => c.id === id) };
      }).filter(o => o.card);
      return {
        stage: b.stage, broker: broker.name, mine, card: b.card,
        needs: mine ? (b.stage === 'reveal' || b.stage === 'accept') : (b.stage === 'offer' && !Object.prototype.hasOwnProperty.call(b.offers, s.index)),
        offers: mine && b.stage === 'accept' ? offers : [],
      };
    }

    /* ---------------- cards that act during the draft ---------------- */

    /** Every draft ability this seat is holding, with what is left of it. */
    abilitiesOf(seat) {
      const out = [];
      for (const c of seat.pool) {
        const def = draftAbilityOf(c);
        if (!def) continue;
        const used = seat.spent[c.id] || 0;
        const blind = def.kind === 'blind' ? (seat.blind.find(b => b.cardId === c.id) || { left: 0 }).left : 0;
        const faceDown = def.kind === 'blind' ? blind <= 0 : !!def.once && used >= 1;
        out.push({
          cardId: c.id, card: c, name: c.name, key: def.key, kind: def.kind, known: def.known !== false,
          label: def.label, prompt: def.prompt, used, left: def.once ? Math.max(0, 1 - used) : Infinity,
          passive: !!def.passive || !!def.onDraft, onDraft: !!def.onDraft, mod: !!def.mod, creature: !!def.creature,
          faceUp: !!def.faceUp && !faceDown, faceDown, blindLeft: blind,
        });
      }
      return out;
    }

    /**
     * What this seat could actually do right now. A thing you cannot do is
     * worse than useless in a pick UI, so the pack has to be able to pay for
     * it: an extra pick needs a spare card, the whole-pack grab needs a pack.
     * Nothing is done to a pack you cannot look at (Archdemon of Paliano).
     */
    availableAbilities(seatId) {
      const s = this._seat(seatId);
      if (!s || this.finished || this.broker) return [];
      const pack = this._packFor(s);
      const want = Math.min(this.cfg.picksPerTurn, pack.length);
      const picking = pack.length > 0 && s.sitOutRound !== this.round && !s.skipNext && !this._blindLeft(s);
      return this.abilitiesOf(s).filter(a => {
        if (a.left <= 0 || a.faceDown || !a.known) return false;
        if (a.kind === 'extraPick') return picking && pack.length > want;
        if (a.kind === 'wholePack') return picking && pack.length > 1;
        if (a.mod) return picking;
        if (a.kind === 'peek') return this.peekOptions(s).length > 0;
        if (a.kind === 'watch') return this.seats.length > 1;
        return false;
      });
    }

    /**
     * Whispergear Sneak: "any unopened booster pack in the draft or any
     * booster pack not being looked at by another player" — the packs of
     * the rounds to come, and packs waiting under the one a player is
     * drafting from.
     */
    peekOptions(s) {
      const out = [];
      for (let r = this.round + 1; r < this.roundPacks.length; r++) {
        for (let i = 0; i < this.roundPacks[r].length; i++) {
          out.push({ id: `r${r}:${i}`, label: `Pack ${r + 1}: the one ${this.seats[i] === s ? 'you open' : this.seats[i].name + ' opens'}` });
        }
      }
      this.queues.forEach((q, i) => q.slice(1).forEach(p => {
        if (p.length) out.push({ id: `q${p.uid}`, label: `A pack waiting for ${this.seats[i] === s ? 'you' : this.seats[i].name} (${p.length} cards)` });
      }));
      return out;
    }

    /** Look at one pack. Spends the card that allowed it. */
    peekPack(seatId, cardId, which) {
      const s = this._seat(seatId);
      if (!s) return null;
      const a = this.availableAbilities(seatId).find(x => x.cardId === cardId && x.kind === 'peek');
      if (!a) return null;
      const opts = this.peekOptions(s);
      const pick = opts.find(o => o.id === which) || opts[0];
      if (!pick) return null;
      let cards = [];
      const m = /^r(\d+):(\d+)$/.exec(pick.id);
      if (m) cards = this.roundPacks[+m[1]][+m[2]];
      else this.queues.forEach(q => q.forEach(p => { if ('q' + p.uid === pick.id) cards = p; }));
      s.spent[cardId] = (s.spent[cardId] || 0) + 1;
      this._see(s, a.name, pick.label, cards);
      this.logAbility(`${s.name} turns ${a.name} face down to look at a pack.`);
      this.emit('ability', { seat: s.index, card: a.name, kind: 'peek' });
      this.touchDraft();
      return { label: pick.label, cards: cards.slice() };
    }

    /** Illusionary Informant: see the next card a player drafts. */
    watchPlayer(seatId, cardId, targetId) {
      const s = this._seat(seatId), t = this._seat(targetId);
      if (!s || !t) return false;
      const a = this.availableAbilities(seatId).find(x => x.cardId === cardId && x.kind === 'watch');
      if (!a) return false;
      s.spent[cardId] = (s.spent[cardId] || 0) + 1;
      t.watchers.push({ seat: s.index, kind: 'see', by: a.name });
      this.logAbility(`${s.name} turns ${a.name} face down to watch ${t === s ? 'their own' : t.name + '’s'} next pick.`);
      this.emit('ability', { seat: s.index, card: a.name, kind: 'watch' });
      this.touchDraft();
      return true;
    }

    /** Lore Seeker: one more booster joins the draft, on top of its drafter's queue. */
    answerOffer(seatId, cardId, yes, quiet) {
      const s = this._seat(seatId);
      if (!s) return false;
      const i = s.offers.findIndex(o => o.cardId === cardId);
      if (i < 0) return false;
      s.offers.splice(i, 1);
      if (yes) {
        const pack = this._freshBooster();
        if (pack.length) {
          this._queue(s).unshift(this._packOf(pack, null));
          s.spent[cardId] = (s.spent[cardId] || 0) + 1;
          this.logAbility(`${s.name} adds a booster pack to the draft with Lore Seeker.`);
          this.emit('ability', { seat: s.index, card: 'Lore Seeker', kind: 'addPack' });
        }
      }
      if (!quiet && this._holding && !this.seats.some(x => x.offers.length)) { this._proceed(); return true; }
      if (!quiet) this.touchDraft();
      return true;
    }

    /** Everything a seat can do between picks, by name (the 'draftAct' intent). */
    act(seatId, a) {
      a = a || {};
      switch (a.act) {
        case 'peek': return this.peekPack(seatId, a.cardId, a.which);
        case 'watch': return this.watchPlayer(seatId, a.cardId, a.targetId);
        case 'answer': return this.answerAsk(seatId, a.askId, a.value);
        case 'offer': return this.answerOffer(seatId, a.cardId, !!a.yes);
        case 'brokerReveal': case 'brokerOffer': case 'brokerAccept': {
          const ok = this.brokerAct(seatId, a);
          if (ok) this.touchDraft();
          return ok;
        }
        default: return false;
      }
    }

    logAbility(text) { this.abilityLog = (this.abilityLog || []).concat([text]).slice(-60); }
    touchDraft() { this.emit('pick:done', this.pickNumber); }

    /**
     * What a seat's draft noted, for the game: see MTG.rules (draftNotes)
     * and the scripts above. `deck`, when given, decides Worldknit: every
     * card in the pool has to start the game in the library or the
     * command zone.
     */
    notesFor(seatId, deck) {
      const s = this._seat(seatId);
      if (!s) return null;
      const out = JSON.parse(JSON.stringify(s.gameNotes));
      if (deck) out.worldknit = { whole: wholePoolUsed(deck, s.pool) };
      return out;
    }

    viewFor(seatId) {
      const s = this._seat(seatId);
      const pack = s ? this._packFor(s) : [];
      const blind = s ? this._blindLeft(s) : 0;
      const canUse = s ? this.availableAbilities(seatId) : [];
      return {
        you: seatId, formatId: this.cfg.formatId,
        round: Math.min(this.round + 1, this.cfg.packs), totalRounds: this.cfg.packs, allAtOnce: !!this.cfg.allAtOnce,
        packsWaiting: s ? this._queue(s).filter(p => p.length).length : 0,
        pick: this.pickNumber + 1,
        started: this.started, finished: this.finished,
        phase: this.finished ? 'done' : this.broker ? 'broker' : 'picking',
        setsUsed: this.setsUsed || [],
        looseSets: this.looseSets || [],
        picksPerTurn: this.cfg.picksPerTurn,
        faceUp: this.cfg.faceUp,
        // Archdemon of Paliano: the pack is not yours to look at
        pack: blind ? [] : pack,
        blind: blind ? { left: blind, size: pack.length } : null,
        queued: s ? Math.max(0, this._queue(s).length - 1) : 0,
        pool: s ? s.pool : [],
        abilities: s ? this.abilitiesOf(s) : [],
        canUse,
        peekOptions: canUse.some(a => a.kind === 'peek') ? this.peekOptions(s) : [],
        offers: s ? s.offers.slice() : [],
        asks: s ? this.asks.filter(a => a.seat === s.index).map(a => ({ id: a.id, kind: a.kind, prompt: a.prompt, options: a.options.slice() })) : [],
        broker: this._brokerView(s),
        sittingOut: s ? s.sitOutRound === this.round : false,
        skipping: s ? s.skipNext > 0 : false,
        notes: s ? s.notes : [],
        removed: s ? s.removed.map(r => r.card) : [],
        seen: s ? s.seen : [],
        abilityLog: (this.abilityLog || []).slice(-8),
        waitingOn: this.broker ? [] : this.seats.filter(x => !this.pendingPicks.has(x.index)).map(x => x.name),
        seats: this.seats.map(x => ({
          id: x.id, name: x.name, isBot: x.isBot, poolSize: x.pool.length,
          picked: this.cfg.faceUp ? x.picked : undefined,
          // what everybody can see: the cards drafted face up that still are, and those revealed
          shown: x.shown.filter(e => e.how === 'revealed' || this.abilitiesOf(x).some(y => y.cardId === e.cardId && !y.faceDown))
            .map(e => ({ name: e.name, how: e.how })),
          done: this.pendingPicks.has(x.index),
        })),
      };
    }
  }

  /* ---------------- build a deck out of a drafted pool ---------------- */

  /**
   * Auto-build a limited deck: pick the best two colours, take the playables,
   * fill with basics to the right land count.
   */
  function autoBuildLimited(pool, opts) {
    opts = opts || {};
    // a conspiracy is never in the deck: it starts the game in the command zone
    const drafted = pool;
    pool = pool.filter(c => !isConspiracy(c));
    const target = opts.deckSize || 40;
    const basics = opts.basicCards || {};
    const scored = new Map();
    const score = (c) => {
      if (scored.has(c)) return scored.get(c);
      const v = rawScore(c);
      scored.set(c, v);
      return v;
    };
    const rawScore = (c) => {
      const a = MTG.oracle.analyze(c);
      /* The bots' card judge reads what a card actually does here, and
         marks down the ones the table cannot run by itself. */
      if (a && !a.isLand && MTG.bots && MTG.bots.rateCard) {
        return MTG.bots.rateCard(c, { limited: true, prior: 0.3 }) + (a.isCreature ? 0.4 : 0);
      }
      let v = { common: 1, uncommon: 1.6, rare: 2.4, mythic: 2.8 }[c.rarity] || 1;
      if (a) {
        if (a.isCreature) v += 0.8;
        if (a.isBasicLand) return -99;
        if (a.isLand) v += 0.4;
        const mv = a.mv || 0;
        if (mv >= 2 && mv <= 4) v += 0.4; else if (mv >= 7) v -= 0.8;
        for (const k of ['flying', 'deathtouch', 'lifelink', 'trample', 'first strike'])
          if (a.keywordSet.has(k)) v += 0.2;
        if (/destroy target|exile target/i.test(c.oracle_text || '')) v += 0.7;
      }
      return v;
    };
    // colour pair with the most total value
    const pairs = [];
    const C = MTG.mana.COLORS;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const pair = [C[i], C[j]];
      const playable = pool.filter(c => {
        const ci = c.color_identity || [];
        return ci.every(col => pair.includes(col));
      });
      // a pair is as good as the deck it makes, not as deep as its sideboard
      const top = playable.map(score).sort((x, y) => y - x).slice(0, 23);
      pairs.push({ pair, total: U.sum(top), playable });
    }
    pairs.sort((a, b) => b.total - a.total);
    const best = pairs[0] || { pair: ['W', 'U'], playable: pool.slice() };

    const spells = best.playable
      .filter(c => { const a = MTG.oracle.analyze(c); return a && !a.isBasicLand; })
      .sort((a, b) => score(b) - score(a));

    const nonBasicLands = spells.filter(c => { const a = MTG.oracle.analyze(c); return a && a.isLand; });
    const realSpells = spells.filter(c => { const a = MTG.oracle.analyze(c); return a && !a.isLand; });

    const avgMv = realSpells.length ? U.sum(realSpells.slice(0, 23).map(c => c.cmc || 0)) / Math.min(23, realSpells.length) : 3;
    const landCount = MTG.formats.suggestedLands(target, avgMv);
    const spellCount = target - landCount;

    /* Creatures first — a limited deck without fifteen or so of them has
       nothing to win with — then the best of everything else, keeping the
       top of the curve to a handful of cards. */
    const chosen = [];
    const isCreature = (c) => { const a = MTG.oracle.analyze(c); return !!(a && a.isCreature); };
    const wantCreatures = Math.round(spellCount * 0.65);
    for (const c of realSpells) {
      if (chosen.length >= wantCreatures) break;
      if (isCreature(c) && score(c) >= 2.5) chosen.push(c);
    }
    let top = chosen.filter(c => (c.cmc || 0) >= 6).length;
    for (const c of realSpells) {
      if (chosen.length >= spellCount) break;
      if (chosen.includes(c)) continue;
      if ((c.cmc || 0) >= 6 && top >= 3) continue;
      if ((c.cmc || 0) >= 6) top++;
      chosen.push(c);
    }
    for (const c of realSpells) {
      if (chosen.length >= spellCount) break;
      if (!chosen.includes(c)) chosen.push(c);
    }
    const utilLands = nonBasicLands.slice(0, Math.min(2, landCount - 2));
    const basicsNeeded = landCount - utilLands.length;

    // split basics by coloured pip demand
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of chosen) for (const s of MTG.mana.parse(c.mana_cost || ''))
      for (const col of C) if (s.includes(col)) pips[col]++;
    const activeColors = best.pair.filter(c => pips[c] > 0);
    const totalPips = U.sum(activeColors.map(c => pips[c])) || 1;

    const main = [];
    const addCard = (card, qty) => {
      const e = main.find(x => x.card.id === card.id);
      if (e) e.qty += qty; else main.push({ card, qty });
    };
    for (const c of chosen) addCard(c, 1);
    for (const c of utilLands) addCard(c, 1);

    const basicName = MTG.mana.BASIC_FOR;
    let placed = 0;
    (activeColors.length ? activeColors : best.pair).forEach((col, idx, arr) => {
      const share = activeColors.length ? Math.round(basicsNeeded * (pips[col] / totalPips)) : Math.floor(basicsNeeded / arr.length);
      const qty = idx === arr.length - 1 ? basicsNeeded - placed : share;
      placed += qty;
      const card = basics[basicName[col]];
      if (card && qty > 0) addCard(card, qty);
    });

    // a short pool means fewer playables than the target; top up with basics
    let have = U.sum(main.map(e => e.qty));
    let guard = 0;
    const fillColors = (activeColors.length ? activeColors : best.pair);
    while (have < target && guard++ < 200) {
      const col = fillColors[guard % fillColors.length];
      const card = basics[basicName[col]];
      if (!card) break;
      addCard(card, 1);
      have++;
    }
    while (have > target && guard++ < 400) {
      const e = main.find(x => MTG.formats.isBasicLand(x.card) && x.qty > 1) || main[main.length - 1];
      if (!e) break;
      e.qty--; have--;
      if (e.qty <= 0) main.splice(main.indexOf(e), 1);
    }

    const leftovers = pool.filter(c => !chosen.includes(c) && !utilLands.includes(c));
    const deck = {
      id: MTG.uid('deck'),
      name: opts.name || 'Drafted deck',
      format: opts.formatId || 'booster',
      main,
      sideboard: leftovers.map(c => ({ card: c, qty: 1 })),
      commanders: [],
      colors: best.pair,
      createdAt: Date.now(),
      source: 'draft',
    };
    // a person chooses these once the deck is built (UI.draftPregame); a bot takes the defaults
    if (opts.pregame !== false) applyPregame(deck, pregameDefaults(deck, drafted));
    if (opts.notes) deck.draftNotes = opts.notes;
    return deck;
  }

  /* ---------------- the start of the game, for a drafted deck ---------------- */

  const fitsWords = (c, words) => (words === 'creature' ? isCreatureCard(c) : /\b(?:Instant|Sorcery)\b/.test(c.type_line || ''));

  /** Names in the deck a hidden agenda could name, the most copies and the best card first. */
  function agendaNames(deck, wants) {
    const fits = (c) => (wants === 'any' ? !/\bLand\b/.test(c.type_line || '') : fitsWords(c, wants));
    const byName = new Map();
    for (const e of (deck.main || [])) {
      if (!e.card || MTG.formats.isBasicLand(e.card) || !fits(e.card)) continue;
      const was = byName.get(e.card.name);
      byName.set(e.card.name, { card: e.card, qty: (was ? was.qty : 0) + e.qty });
    }
    return Array.from(byName.values()).sort((a, b) => b.qty - a.qty || plainValue(b.card) - plainValue(a.card)).map(x => x.card.name);
  }

  /**
   * What a drafted deck starts the game with, chosen the way a sensible
   * player would: every conspiracy that only helps, a hidden agenda naming
   * the deck's best fit for it, and every card Arcane Savant and its kin
   * can take into exile. Hymn of the Wilds stays out of a deck with
   * instants or sorceries, and Sovereign's Realm out of one with basic
   * lands. The table offers these to a person as the starting point.
   */
  function pregameDefaults(deck, pool) {
    const out = { conspiracies: [], draftExiled: [] };
    const main = deck.main || [];
    const hasBasics = main.some(e => MTG.formats.isBasicLand(e.card));
    const spells = main.some(e => fitsWords(e.card, 'instant or sorcery'));
    for (const c of (pool || []).filter(isConspiracy)) {
      const key = U.normName(U.frontName(c.name));
      if (key === 'hymn of the wilds' && spells) continue;
      if (key === "sovereign's realm" && hasBasics) continue;
      const ag = agendaOf(c);
      const entry = { card: c };
      if (ag && ag.names) {
        const names = agendaNames(deck, AGENDA_WANTS[key] || 'creature');
        if (names.length < ag.names) continue;      // nothing in the deck worth naming
        entry.names = names.slice(0, ag.names);
      }
      if (ag && ag.number) {
        const count = (k) => main.filter(e => isCreatureCard(e.card) && (e.card.cmc || 0) === k).reduce((t, e) => t + e.qty, 0);
        entry.number = ag.number.slice().sort((a, b) => count(b) - count(a))[0];
      }
      out.conspiracies.push(entry);
    }
    const side = (deck.sideboard || []).map(e => e.card).filter(c => c && !isConspiracy(c) && !MTG.formats.isBasicLand(c));
    const taken = new Set();
    for (const e of main) {
      const key = U.normName(U.frontName(e.card.name));
      const pre = PREGAME_EXILE[key];
      if (!pre) continue;
      for (let k = 0; k < e.qty; k++) {
        const fits = side.filter(c => !taken.has(c.id) && fitsWords(c, pre.words)).sort((a, b) => plainValue(b) - plainValue(a));
        if (fits.length < pre.min) break;
        for (const c of fits.slice(0, Math.max(pre.min, Math.min(pre.max, 5)))) {
          taken.add(c.id);
          out.draftExiled.push({ card: c, with: key });
        }
      }
    }
    return out;
  }

  /**
   * Settle a drafted deck's start: the conspiracies it uses, and the cards
   * exiled before the game, which leave the sideboard for exile. Any
   * conspiracy that found its way into the main deck comes out of it.
   */
  function applyPregame(deck, choice) {
    deck.main = (deck.main || []).filter(e => !isConspiracy(e.card));
    deck.conspiracies = (choice.conspiracies || []).map(x => ({ card: x.card, names: x.names || null, number: x.number == null ? null : x.number }));
    deck.draftExiled = (choice.draftExiled || []).map(x => ({ card: x.card, with: x.with }));
    const gone = new Map();
    for (const x of deck.draftExiled) gone.set(x.card.id, (gone.get(x.card.id) || 0) + 1);
    deck.sideboard = (deck.sideboard || []).map(e => {
      const k = Math.min(e.qty, gone.get(e.card.id) || 0);
      if (k) gone.set(e.card.id, gone.get(e.card.id) - k);
      return { card: e.card, qty: e.qty - k };
    }).filter(e => e.qty > 0 && !isConspiracy(e.card));
    return deck;
  }

  /** Worldknit: every card in the pool starts the game in the library or the command zone. */
  function wholePoolUsed(deck, pool) {
    if ((deck.draftExiled || []).length) return false;
    if (!pool) return !(deck.sideboard || []).some(e => e.qty > 0 && !MTG.formats.isBasicLand(e.card));
    const have = new Map();
    const add = (c, q) => { if (c) have.set(c.id, (have.get(c.id) || 0) + q); };
    for (const e of (deck.main || [])) add(e.card, e.qty);
    for (const c of (deck.commanders || [])) add(c, 1);
    for (const c of (deck.conspiracies || [])) add(c.card || c, 1);
    const need = new Map();
    for (const c of pool) if (!MTG.formats.isBasicLand(c)) need.set(c.id, (need.get(c.id) || 0) + 1);
    for (const [id, q] of need) if ((have.get(id) || 0) < q) return false;
    return true;
  }

  /** Fetch the five basic lands once, for limited deck building. */
  let basicsCache = null;
  async function getBasics(setCode) {
    if (basicsCache && !setCode) return basicsCache;
    const names = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const ids = names.map(n => setCode ? { name: n, set: setCode } : { name: n });
    const { cards } = await MTG.scry.collection(ids);
    const out = {};
    names.forEach((n, i) => { if (cards[i]) out[n] = cards[i]; });
    if (!setCode) basicsCache = out;
    return out;
  }

  MTG.draft = {
    recipes: CUBE_RECIPES, buildRecipe,
    DRAFT_ABILITIES, draftAbilityOf, LAND_SLOT_MIX, DRAFT_SCRIPTS,
    isConspiracy, agendaOf, agendaNames, PREGAME_EXILE, pregameDefaults, applyPregame, wholePoolUsed,
    Draft, makeBooster, makeCubePack, boosterSpecFor,
    PLAY_BOOSTER, DRAFT_BOOSTER, COLLECTOR_BOOSTER, WILDCARD_MIX,
    cubes, autoBuildLimited, getBasics,
  };
})(window.MTG);


