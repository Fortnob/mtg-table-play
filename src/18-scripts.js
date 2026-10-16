/* ============================================================
   18-scripts.js - hand-written card scripts

   The parser reads most cards. Some it cannot: text that depends on a
   count nothing else counts, a choice with no vocabulary for it, a rule
   that changes how the game itself works. Rather than bend the parser
   into knots for one card, those cards are written out by hand here, in
   exactly the same vocabulary the parser emits — so the engine cannot
   tell the difference and nothing downstream needs a special case.

   A script either replaces a card's abilities outright, or adds to what
   the parser already found. Anything not scripted and not parsed still
   falls through to the assisted tools, the way it always has, so this
   file is a place to improve coverage rather than a thing the game
   depends on.

   Players can add their own without rebuilding: MTG.settings.cardScripts
   is merged over this table, keyed the same way.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* A key that survives punctuation and printings: the front face's name,
     straightened and lowercased. */
  function keyFor(name) {
    return U.normName(U.frontName(String(name || '')));
  }

  /* ---------------- the table ----------------
     kind: 'triggered' | 'activated' | 'static' | 'spell' | 'mana' | 'chapter'
     Everything else is exactly what the parser would have produced. */
  // Voice of Resurgence's token: its size is the number of creatures its controller has
  const VOICE_TOKEN = { op: 'createToken', n: 1, pt: '0/0', colorWords: ['green', 'white'], subtypes: 'Elemental', keywords: [],
    grantedText: "This creature's power and toughness are each equal to the number of creatures you control." };
  const SCRIPTS = {
    /* --- cards whose text counts something the parser has no word for --- */
    "dark confidant": {
      abilities: [{
        kind: 'triggered', event: 'yourUpkeep', auto: true,
        text: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
        effects: [{ op: 'revealToHand', n: 1, loseLifeForMv: true }],
      }],
    },
    "thassa's oracle": {
      abilities: [{
        kind: 'triggered', event: 'etb', self: true, auto: true,
        text: "When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.",
        effects: [
          { op: 'winIfLibraryAtMost', count: { devotion: 'U' } },
          { op: 'lookAt', n: { devotion: 'U' }, keep: 0 },
          { op: 'takeFromLooked', n: 1, filter: 'any', to: 'top', optional: true, rest: 'keep', prompt: 'Choose up to one to keep on top.' },
          { op: 'restToBottom', random: true },
        ],
      }],
    },
    "approach of the second sun": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "If you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put it into its owner's library seventh from the top and you gain 7 life.",
        effects: [{ op: 'approach', life: 7, depth: 7 }],
      }],
    },
    "aetherflux reservoir": {
      abilities: [
        { kind: 'triggered', event: 'youCastSpell', auto: true,
          text: "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.",
          effects: [{ op: 'gainLife', who: 'you', n: { spellsThisTurn: 1 } }] },
        { kind: 'activated', auto: true, cost: { mana: '', life: 50, tap: false, other: [] },
          text: 'Pay 50 life: This artifact deals 50 damage to any target.',
          effects: [{ op: 'damage', n: 50, targets: [{ type: 'any' }] }] },
      ],
    },

    /* --- cards the parser reads as one effect when they are really two --- */
    "sylvan library": {
      abilities: [{
        kind: 'triggered', event: 'yourDrawStep', auto: true,
        text: 'At the beginning of your draw step, you may draw two additional cards. For each of those cards, pay 4 life or put it back on top of your library.',
        effects: [{ op: 'may', prompt: 'Draw two additional cards?',
          then: [{ op: 'draw', n: 2, who: 'you' }, { op: 'sylvanLibrary', n: 2, life: 4 }] }],
      }],
    },
    "necropotence": {
      abilities: [
        { kind: 'static', auto: true, text: 'Skip your draw step.', effects: [{ op: 'skipStep', step: 'draw', who: 'you' }] },
        { kind: 'triggered', event: 'youDiscard', auto: true, text: 'Whenever you discard a card, exile that card from your graveyard.',
          effects: [{ op: 'exile', scope: 'triggerObject', fromGraveyard: true }] },
        { kind: 'activated', auto: true, cost: { mana: '', life: 1, tap: false, other: [] },
          text: 'Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.',
          effects: [
            { op: 'impulse', n: 1, play: false, faceDown: true },
            { op: 'delayed', event: 'yourEndStep', forPlayer: 'you', nextTurn: false, subject: 'lastTarget',
              name: 'Put the exiled card into your hand', effects: [{ op: 'toHandThat' }] },
          ] },
      ],
    },
    "sneak attack": {
      abilities: [{
        kind: 'activated', auto: true, cost: { mana: '{R}', tap: false, other: [] },
        text: '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice it at the beginning of the next end step.',
        effects: [
          { op: 'permanentFromHand', filter: 'creature', who: 'you' },
          { op: 'grantKeyword', scope: 'thatObject', keywords: ['Haste'], duration: null },
          { op: 'delayed', event: 'eachEndStep', subject: 'lastPut',
            name: 'Sacrifice it at end of turn', effects: [{ op: 'sacrificeThat' }] },
        ],
      }],
    },
    "show and tell": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.',
        effects: [{ op: 'permanentFromHand', filter: '', who: 'each' }],
      }],
    },

    /* --- statics that change how the game works, written out plainly --- */
    "blood moon": {
      abilities: [{
        kind: 'static', auto: true, text: 'Nonbasic lands are Mountains.',
        effects: [{ op: 'continuous', layer: 4, scope: { who: 'all', what: 'land', nonbasic: true },
          setSubtypes: ['Mountain'], setMana: ['R'] }],
      }],
    },
    "propaganda": {
      abilities: [{
        kind: 'static', auto: true,
        text: "Creatures can't attack you unless their controller pays {2} for each of those creatures.",
        effects: [{ op: 'attackTax', amount: '{2}' }],
      }],
    },
    "ghostly prison": {
      abilities: [{
        kind: 'static', auto: true,
        text: "Creatures can't attack you unless their controller pays {2} for each of those creatures.",
        effects: [{ op: 'attackTax', amount: '{2}' }],
      }],
    },
    "seedborn muse": {
      abilities: [{
        kind: 'static', auto: true,
        text: "Untap all permanents you control during each other player's untap step.",
        effects: [{ op: 'untapOnEveryUntapStep' }],
      }],
    },
    "grafdigger's cage": {
      abilities: [{
        kind: 'static', auto: true,
        text: "Creature cards in graveyards and libraries can't enter the battlefield. Players can't cast spells from graveyards or libraries.",
        effects: [{ op: 'cageGraveyards' }],
      }],
    },
    "courser of kruphix": {
      abilities: [
        /* without this the top card it lets you play is never shown, so a
           land offered as playable from there cannot be clicked */
        { kind: 'static', auto: true, text: 'Play with the top card of your library revealed.',
          effects: [{ op: 'peekTop', revealed: true }] },
        { kind: 'static', auto: true, text: 'You may play lands from the top of your library.',
          effects: [{ op: 'playFromTop', what: 'land' }] },
        { kind: 'triggered', event: 'landfall', auto: true,
          text: 'Whenever a land enters under your control, you gain 1 life.',
          effects: [{ op: 'gainLife', n: 1, who: 'you' }] },
      ],
    },

    /* --- ones where the parser gets the shape right but misses a clause --- */
    "goblin rabblemaster": {
      abilities: [
        { kind: 'static', auto: true, text: 'Other Goblins you control attack each combat if able.',
          effects: [{ op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', subtype: 'goblin', other: true }, flag: 'mustAttackEot' }] },
        { kind: 'triggered', event: 'yourCombatBegin', auto: true,
          text: 'At the beginning of combat on your turn, create a 1/1 red Goblin creature token with haste.',
          effects: [{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['red'], subtypes: 'Goblin', keywords: ['Haste'] }] },
        { kind: 'triggered', event: 'attacks', self: true, auto: true,
          text: 'Whenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Goblin.',
          effects: [{ op: 'pump', scope: 'self', duration: 'eot', p: { attackingOther: 'goblin' }, t: 0 }] },
      ],
    },
    "brimaz, king of oreskos": {
      abilities: [
        { kind: 'triggered', event: 'attacks', self: true, auto: true,
          text: "Whenever this creature attacks, create a 1/1 white Cat Soldier creature token with vigilance that's attacking.",
          effects: [{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['white'], subtypes: 'Cat Soldier', keywords: ['Vigilance'], attacking: true }] },
        // once for each creature it blocks, the token blocking that one
        { kind: 'triggered', event: 'blocksCreature', self: true, auto: true,
          text: "Whenever this creature blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature.",
          effects: [{ op: 'createToken', n: 1, pt: '1/1', colorWords: ['white'], subtypes: 'Cat Soldier', keywords: ['Vigilance'], blockingTriggerObject: true }] },
      ],
      keepKeywords: true,
    },
    /* --- text that talks about a pile, a choice or a name --- */
    "birthing pod": {
      abilities: [{
        kind: 'activated', auto: true,
        cost: { mana: '{1}{G/P}', tap: true, sacrifice: { n: 1, filter: 'creature' }, other: [] },
        text: '{1}{G/P}, {T}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature\u2019s mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery.',
        sorcerySpeed: true,
        effects: [{ op: 'tutor', n: 1, filter: 'creature', to: 'battlefield', mvOfSacrificedPlus: 1 }, { op: 'shuffle' }],
      }],
    },
    "green sun's zenith": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library.",
        effects: [
          { op: 'tutor', n: 1, filter: 'green creature', to: 'battlefield', maxMv: 'X' },
          { op: 'selfToLibrary', shuffle: true },
        ],
      }],
    },
    "esper sentinel": {
      abilities: [{
        kind: 'triggered', event: 'opponentFirstSpell', auto: true,
        objFilter: { words: 'noncreature spell' }, firstOfKind: true,
        text: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.",
        effects: [{ op: 'unlessPays', who: 'triggerPlayer', costFromPower: true,
          then: [{ op: 'draw', n: 1, who: 'you' }] }],
      }],
    },
    "snapcaster mage": {
      abilities: [{
        kind: 'triggered', event: 'etb', self: true, auto: true,
        text: 'When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.',
        effects: [{ op: 'grantFlashback', targets: [{ type: 'permanent', zone: 'graveyard', controller: 'you', filter: 'instant or sorcery', spellish: true, cardTypes: ['instant', 'sorcery'] }] }],
      }],
      keepKeywords: true,
    },
    "oblivion ring": {
      abilities: [{
        kind: 'triggered', event: 'etb', self: true, auto: true,
        text: 'When this enchantment enters, exile another target nonland permanent until this enchantment leaves the battlefield.',
        effects: [{ op: 'exileUntilLeaves', targets: [{ type: 'permanent', nonland: true }] }],
      }],
    },
    "anger of the gods": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Anger of the Gods deals 3 damage to each creature. If a creature dealt damage this way would die this turn, exile it instead.',
        effects: [{ op: 'damage', n: 3, each: 'creature', exileInstead: true }],
      }],
    },
    "pillar of flame": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Pillar of Flame deals 2 damage to any target. If a creature dealt damage this way would die this turn, exile it instead.',
        effects: [{ op: 'damage', n: 2, targets: [{ type: 'any' }], exileInstead: true }],
      }],
    },
    "scavenging ooze": {
      abilities: [{
        kind: 'activated', auto: true, cost: { mana: '{G}', tap: false, other: [] },
        text: '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.',
        effects: [
          // the one card it targets, from any graveyard (exileFromGraveyard took one from every graveyard)
          { op: 'exile', targets: [{ type: 'permanent', filter: 'card', zone: 'graveyard' }] },
          { op: 'ifLastWas', filter: 'creature',
            then: [{ op: 'counters', kind: '+1/+1', n: 1, scope: 'self' }, { op: 'gainLife', n: 1, who: 'you' }] },
        ],
      }],
    },
    "assassin's trophy": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.",
        effects: [
          { op: 'destroy', targets: [{ type: 'permanent', controller: 'opponent' }] },
          { op: 'fetchBasic', n: 1, who: 'targetController', optional: true },
        ],
      }],
    },
    "oblivion stone": {
      abilities: [
        { kind: 'activated', auto: true, cost: { mana: '{4}', tap: true, other: [] },
          text: '{4}, {T}: Put a fate counter on target permanent.',
          effects: [{ op: 'counters', kind: 'fate', n: 1, targets: [{ type: 'permanent' }] }] },
        { kind: 'activated', auto: true, cost: { mana: '{5}', tap: true, sacSelf: true, other: [] },
          text: '{5}, {T}, Sacrifice this artifact: Destroy each nonland permanent without a fate counter on it, then remove all fate counters from all permanents.',
          effects: [{ op: 'destroyAll', what: 'nonland permanent', withoutCounter: 'fate' }, { op: 'removeCountersAll', kind: 'fate' }] },
      ],
    },
    "voice of resurgence": {
      abilities: [{
        kind: 'triggered', event: 'opponentCastSpell', auto: true, condition: { kind: 'yourTurn' },
        text: "Whenever an opponent casts a spell during your turn, create a green and white Elemental creature token with \"This token's power and toughness are each equal to the number of creatures you control.\"",
        effects: [VOICE_TOKEN],
      }, {
        kind: 'triggered', event: 'dies', self: true, auto: true,
        text: "When this creature dies, create a green and white Elemental creature token with \"This token's power and toughness are each equal to the number of creatures you control.\"",
        effects: [VOICE_TOKEN],
      }],
    },
    "chalice of the void": {
      abilities: [
        { kind: 'static', auto: true, text: 'This artifact enters with X charge counters on it.',
          effects: [{ op: 'etbCounters', kind: 'charge', n: 'X' }] },
        { kind: 'triggered', event: 'anyCastSpell', auto: true,
          text: 'Whenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell.',
          effects: [{ op: 'counterTriggerSpell', matchCounters: 'charge' }] },
      ],
    },

    /* --- the second batch: cards whose rules have no shared shape --- */
    "the one ring": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true, condition: { kind: 'wasCast' },
          text: 'When The One Ring enters, if you cast it, you gain protection from everything until your next turn.',
          effects: [{ op: 'playerProtection' }] },
        { kind: 'triggered', event: 'yourUpkeep', auto: true,
          text: 'At the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.',
          effects: [{ op: 'loseLife', who: 'you', n: { countersOnSelf: 'burden' } }] },
        { kind: 'activated', auto: true, cost: { mana: '', tap: true, other: [] },
          text: '{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.',
          effects: [{ op: 'counters', kind: 'burden', n: 1, scope: 'self' },
            { op: 'draw', who: 'you', n: { countersOnSelf: 'burden' } }] },
      ],
      keepKeywords: true,
    },
    "teferi's protection": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out. Exile Teferi's Protection.",
        effects: [
          { op: 'playerProtection', lifeLocked: true },
          { op: 'phaseOut', scope: { who: 'you', what: 'permanent' } },
          { op: 'exileSelf' },
        ],
      }],
    },
    "urza's saga": {
      /* each chapter hands the Saga an ability; reaching the chapter is what
         switches it on */
      abilities: [
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, levelCond: { kind: 'selfCounters', counter: 'lore', n: 1 },
          text: 'I — This Saga gains "{T}: Add {C}."', effects: [{ op: 'addMana', symbols: ['C'] }] },
        { kind: 'activated', auto: true, cost: { mana: '{2}', tap: true, other: [] }, levelCond: { kind: 'selfCounters', counter: 'lore', n: 2 },
          text: "II — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"",
          effects: [{ op: 'createToken', n: 1, pt: '0/0', colorWords: ['colorless'], addTypes: ['Artifact'], subtypes: 'Construct',
            keywords: [], grantedText: 'This creature gets +1/+1 for each artifact you control.' }] },
        { kind: 'chapter', chapters: [1], auto: true, text: 'I — This Saga gains "{T}: Add {C}."', effects: [{ op: 'noop' }] },
        { kind: 'chapter', chapters: [2], auto: true, text: 'II — This Saga gains a Construct-making ability.', effects: [{ op: 'noop' }] },
        { kind: 'chapter', chapters: [3], auto: true,
          text: 'III — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.',
          effects: [{ op: 'tutor', n: 1, filter: 'artifact', manaCostIn: ['{0}', '{1}'], to: 'battlefield',
            prompt: 'Search your library for an artifact card with mana cost {0} or {1}.' }] },
      ],
    },
    "victimize": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.',
        effects: [{ op: 'sacThen', filter: 'creature',
          targets: [{ type: 'creature', zone: 'graveyard', controller: 'you' }, { type: 'creature', zone: 'graveyard', controller: 'you' }],
          then: [{ op: 'reanimate', tapped: true }] }],
      }],
    },
    "war room": {
      abilities: [
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, text: '{T}: Add {C}.', effects: [{ op: 'addMana', symbols: ['C'] }] },
        { kind: 'activated', auto: true, cost: { mana: '{3}', tap: true, lifeFrom: 'commanderColors', other: [] },
          text: "{3}, {T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card.",
          effects: [{ op: 'draw', n: 1, who: 'you' }] },
      ],
    },
    "chrome mox": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true,
          text: 'Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.',
          effects: [{ op: 'imprintFromHand', filter: 'nonartifact nonland' }] },
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, text: "{T}: Add one mana of any of the exiled card's colors.",
          effects: [{ op: 'addManaAmong', from: 'exiledCard', amount: 1 }] },
      ],
    },
    "mox diamond": {
      abilities: [
        { kind: 'static', auto: true,
          text: "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.",
          effects: [{ op: 'moxDiamond' }] },
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, text: '{T}: Add one mana of any color.',
          effects: [{ op: 'addManaAny', amount: 1 }] },
      ],
    },
    "animate dead": {
      /* the reanimation happens as the Aura resolves (it is cast at the
         creature card); what is left to write out is the leaving */
      abilities: [
        { kind: 'static', auto: true, text: 'Enchant creature card in a graveyard', effects: [{ op: 'enchant', filter: 'creature card in a graveyard' }] },
        { kind: 'triggered', event: 'ltb', self: true, auto: true,
          text: "When this Aura leaves the battlefield, that creature's controller sacrifices it.",
          effects: [{ op: 'sacAttached' }] },
        { kind: 'static', auto: true, text: 'Enchanted creature gets -1/-0.',
          effects: [{ op: 'continuous', layer: 7, scope: { attached: true }, pt: { p: -1, t: 0 } }] },
      ],
    },
    "necromancy": {
      abilities: [
        { kind: 'static', auto: true, text: 'Enchant creature card in a graveyard', effects: [{ op: 'enchant', filter: 'creature card in a graveyard' }] },
        { kind: 'triggered', event: 'ltb', self: true, auto: true,
          text: "When this Aura leaves the battlefield, that creature's controller sacrifices it.",
          effects: [{ op: 'sacAttached' }] },
      ],
      keepKeywords: true,
    },
    "orcish bowmasters": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true,
          text: 'When this creature enters, this creature deals 1 damage to any target. Then amass Orcs 1.',
          effects: [{ op: 'damage', n: 1, targets: [{ type: 'any' }] }, { op: 'amass', n: 1, kind: 'Orc' }] },
        { kind: 'triggered', event: 'opponentDraw', auto: true, skipFirstDrawStep: true,
          text: 'Whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.',
          effects: [{ op: 'damage', n: 1, targets: [{ type: 'any' }] }, { op: 'amass', n: 1, kind: 'Orc' }] },
      ],
      keepKeywords: true,
    },
    "syr konrad, the grim": {
      abilities: [
        { kind: 'triggered', event: 'permDies', auto: true, objFilter: { words: 'creature', other: true },
          text: 'Whenever another creature dies, Syr Konrad deals 1 damage to each opponent.',
          effects: [{ op: 'damage', n: 1, each: 'opponent' }] },
        { kind: 'triggered', event: 'cardToGraveyard', auto: true, objFilter: { words: 'creature' },
          text: 'Whenever a creature card is put into a graveyard from anywhere other than the battlefield, Syr Konrad deals 1 damage to each opponent.',
          effects: [{ op: 'damage', n: 1, each: 'opponent' }] },
        { kind: 'triggered', event: 'leftGraveyard', auto: true, objFilter: { words: 'creature', who: 'you' },
          text: 'Whenever a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.',
          effects: [{ op: 'damage', n: 1, each: 'opponent' }] },
        { kind: 'activated', auto: true, cost: { mana: '{1}{B}', other: [] }, text: '{1}{B}: Each player mills a card.',
          effects: [{ op: 'mill', n: 1, who: 'each' }] },
      ],
    },
    "academy manufactor": {
      abilities: [{ kind: 'static', auto: true,
        text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.',
        effects: [{ op: 'tokenTrio' }] }],
    },
    "panharmonicon": {
      abilities: [{ kind: 'static', auto: true,
        text: 'If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
        effects: [{ op: 'triggerDouble', cause: 'enter', what: 'artifact or creature' }] }],
    },
    "teysa karlov": {
      abilities: [
        { kind: 'static', auto: true,
          text: 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
          effects: [{ op: 'triggerDouble', cause: 'die', what: 'creature' }] },
        { kind: 'static', auto: true, text: 'Creature tokens you control have vigilance and lifelink.',
          effects: [{ op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', token: true }, grant: ['Vigilance', 'Lifelink'] }] },
      ],
    },
    "roaming throne": {
      abilities: [
        { kind: 'static', auto: true, text: 'As this creature enters, choose a creature type.', effects: [{ op: 'chooseTypeOnEnter' }] },
        { kind: 'static', auto: true, text: 'This creature is the chosen type in addition to its other types.',
          effects: [{ op: 'continuous', layer: 4, scope: { self: true }, addChosenType: true }] },
        { kind: 'static', auto: true,
          text: 'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.',
          effects: [{ op: 'triggerDouble', cause: 'any', sourceChosenType: true }] },
      ],
      keepKeywords: true,
    },
    "phyrexian metamorph": {
      abilities: [{ kind: 'static', auto: true,
        text: "You may have this creature enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.",
        effects: [{ op: 'etbAsCopy', what: 'artifact or creature', addTypes: ['Artifact'] }] }],
    },
    "spark double": {
      abilities: [{ kind: 'static', auto: true,
        text: "You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.",
        effects: [{ op: 'etbAsCopy', what: 'creature or planeswalker', yours: true, extraCounter: true, nonLegendary: true }] }],
    },
    "finale of devastation": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Search your library and/or graveyard for a creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle. If X is 10 or more, creatures you control get +X/+X and gain haste until end of turn.',
        effects: [
          { op: 'tutor', n: 1, filter: 'creature', maxMv: 'X', to: 'battlefield', alsoGraveyard: true,
            prompt: 'Search your library and graveyard for a creature card with mana value X or less.' },
          { op: 'ifCond', cond: { kind: 'xAtLeast', n: 10 }, then: [
            { op: 'pump', p: { posX: true }, t: { posX: true }, duration: 'eot', scope: 'yourCreatures' },
            { op: 'grantKeyword', keywords: ['Haste'], duration: 'eot', scope: 'yourCreatures' }] },
        ],
      }],
    },
    "the ozolith": {
      abilities: [
        { kind: 'triggered', event: 'permLeaves', auto: true, objFilter: { words: 'creature', who: 'you' }, hadCounters: true,
          text: 'Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.',
          effects: [{ op: 'takeLastCounters' }] },
        { kind: 'triggered', event: 'yourCombatBegin', auto: true, optional: true, condition: { kind: 'selfCounters', n: 1 },
          text: 'At the beginning of combat on your turn, if The Ozolith has counters on it, you may move all counters from The Ozolith onto target creature.',
          effects: [{ op: 'moveAllCounters', targets: [{ type: 'creature' }] }] },
      ],
    },
    "anger": {
      abilities: [{ kind: 'static', auto: true,
        text: 'As long as this card is in your graveyard and you control a Mountain, creatures you control have haste.',
        effects: [{ op: 'continuous', layer: 6, fromGraveyard: true, cond: { kind: 'control', what: 'mountain', n: 1 },
          scope: { who: 'you', what: 'creature' }, grant: ['Haste'] }] }],
      keepKeywords: true,
    },
    "underworld breach": {
      abilities: [
        { kind: 'static', auto: true,
          text: "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.",
          effects: [{ op: 'grantEscape', exile: 3 }] },
        { kind: 'triggered', event: 'eachEndStep', auto: true, text: 'At the beginning of the end step, sacrifice this enchantment.',
          effects: [{ op: 'sacrificeSelf' }] },
      ],
    },
    "living death": {
      abilities: [{ kind: 'spell', auto: true,
        text: 'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.',
        effects: [{ op: 'livingDeath' }] }],
    },
    "chaos warp": {
      abilities: [{ kind: 'spell', auto: true,
        text: 'The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it’s a permanent card, they put it onto the battlefield.',
        effects: [{ op: 'toLibrary', where: 'shuffle', targets: [{ type: 'permanent' }] },
          { op: 'revealTopPut', who: 'lastOwner', filter: 'permanent' }] }],
    },
    "gemstone caverns": {
      /* in play from the opening hand for whoever is not going first, paid
         for with a card from that hand; the luck counter makes the mana any
         colour instead of colourless */
      abilities: [
        { kind: 'static', auto: true,
          text: "If this card is in your opening hand and you're not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.",
          effects: [{ op: 'leyline', notStarting: true, counter: 'luck', exileFromHand: 1 }] },
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, levelCond: { kind: 'selfCounters', counter: 'luck', n: 0, cmp: 'atMost' },
          text: '{T}: Add {C}.', effects: [{ op: 'addMana', symbols: ['C'] }] },
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] }, levelCond: { kind: 'selfCounters', counter: 'luck', n: 1 },
          text: '{T}: Add one mana of any color (it has a luck counter).', effects: [{ op: 'addManaAny', amount: 1 }] },
      ],
    },
    "spelunking": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true,
          text: 'When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield. If you put a Cave onto the battlefield this way, you gain 4 life.',
          effects: [{ op: 'draw', n: 1, who: 'you' }, { op: 'putLandFromHand', ifSubtype: 'cave', then: [{ op: 'gainLife', n: 4, who: 'you' }] }] },
        { kind: 'static', auto: true, text: 'Lands you control enter untapped.',
          effects: [{ op: 'replace', id: 'etbUntapped', event: 'enters', who: 'you', how: 'untapped', whatAny: ['land'] }] },
      ],
    },
    "archdruid's charm": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "Choose one — Search your library for a creature or land card and reveal it. Put it onto the battlefield tapped if it's a land card. Otherwise, put it into your hand. Then shuffle. • Put a +1/+1 counter on target creature you control. It deals damage equal to its power to target creature you don't control. • Exile target artifact or enchantment.",
        effects: [{ op: 'modal', count: 1, modes: [
          { label: 'Search for a creature or land card (a land goes onto the battlefield tapped)', auto: true,
            effects: [{ op: 'tutor', n: 1, filter: 'creature or land', to: 'landField' }] },
          { label: "Put a +1/+1 counter on target creature you control; it deals damage equal to its power to target creature you don't control", auto: true,
            effects: [{ op: 'bite', counterFirst: '+1/+1', targets: [{ type: 'creature', controller: 'you', filter: 'creature you control' }, { type: 'creature', controller: 'opponent', filter: "creature you don't control" }] }] },
          { label: 'Exile target artifact or enchantment', auto: true,
            effects: [{ op: 'exile', targets: [{ type: 'permanent', filter: 'artifact or enchantment', anyOf: ['artifact', 'enchantment'] }] }] },
        ] }],
      }],
    },
    /* --- Standard staples the words alone do not reach --- */
    "death baron": {
      abilities: [{ kind: 'static', auto: true,
        text: 'Skeletons you control and other Zombies you control get +1/+1 and have deathtouch.',
        effects: [
          { op: 'continuous', layer: 7, scope: { who: 'you', what: 'creature', subtype: 'skeleton' }, pt: { p: 1, t: 1 } },
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', subtype: 'skeleton' }, grant: ['Deathtouch'] },
          { op: 'continuous', layer: 7, scope: { who: 'you', what: 'creature', subtype: 'zombie', other: true }, pt: { p: 1, t: 1 } },
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', subtype: 'zombie', other: true }, grant: ['Deathtouch'] }] }],
    },
    "tetsuko umezawa, fugitive": {
      abilities: [{ kind: 'static', auto: true,
        text: "Creatures you control with power or toughness 1 or less can't be blocked.",
        effects: [
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', maxPower: 1 }, grant: ['Unblockable'] },
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', maxToughness: 1 }, grant: ['Unblockable'] }] }],
    },
    "twitching doll": {
      abilities: [
        { kind: 'mana', auto: true, cost: { mana: '', tap: true, other: [] },
          text: '{T}: Add one mana of any color. Put a nest counter on this creature.',
          effects: [{ op: 'addManaAny', amount: 1 }, { op: 'counters', kind: 'nest', n: 1, scope: 'self' }] },
        { kind: 'activated', auto: true, sorcerySpeed: true,
          cost: { mana: '', tap: true, untap: false, sacSelf: true, sacrifice: null, discard: null, life: 0, exile: null, removeCounters: null, other: [], raw: '{T}, Sacrifice this creature' },
          text: '{T}, Sacrifice this creature: Create a 2/2 green Spider creature token with reach for each counter on this creature. Activate only as a sorcery.',
          effects: [{ op: 'createToken', n: { countersOnSelf: 'nest' }, pt: '2/2', colorWords: ['green'], subtypes: 'Spider', addTypes: [], keywords: ['Reach'] }] }],
    },

    /* --- requested card automation batch --- */
    "anzrag's rampage": {
      abilities: [{
        kind: 'spell', auto: true,
        text: "Destroy all artifacts you don't control, then exile the top X cards of your library, where X is the number of artifacts that were put into graveyards from the battlefield this turn. You may put a creature card exiled this way onto the battlefield. It gains haste. Return it to your hand at the beginning of the next end step.",
        effects: [
          { op: 'destroyAll', what: 'artifact', notYou: true },
          { op: 'exileTop', n: { artifactsDiedThisTurn: true }, reveal: true, who: null },
          { op: 'takeFromExiled', n: 1, filter: 'creature', to: 'battlefield', optional: true,
            prompt: 'You may put a creature card exiled this way onto the battlefield.' },
          { op: 'grantKeyword', scope: 'takenOntoBf', keywords: ['Haste'] },
          { op: 'delayed', subject: 'takenOntoBf', event: 'nextEndStep', effect: 'returnToHand' },
        ],
      }],
    },
    "party dude": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true,
          text: 'When this enchantment enters, each player creates a Food token.',
          effects: [{ op: 'createNamedToken', n: 1, name: 'Food', token: 'Food', who: 'each' }] },
        { kind: 'activated', auto: true, cost: { mana: '{1}{G}', other: [] }, text: '{1}{G}: Level 2.',
          effects: [{ op: 'classLevel', to: 2 }] },
        { kind: 'triggered', event: 'permLeaves', auto: true, condition: { kind: 'selfCounters', counter: 'level', n: 1 },
          text: 'Whenever an artifact an opponent controls is put into a graveyard from the battlefield, you draw a card.',
          effects: [{ op: 'ifLastWas', ofTrigger: true, asWas: true, filter: 'artifact', controller: 'opponent', fromZone: 'battlefield', toZone: 'graveyard', then: [{ op: 'draw', n: 1, who: 'you' }] }] },
        { kind: 'activated', auto: true, cost: { mana: '{4}{G}', other: [] }, text: '{4}{G}: Level 3.',
          effects: [{ op: 'classLevel', to: 3 }] },
        { kind: 'triggered', event: 'attackedPlayer', auto: true, condition: { kind: 'selfCounters', counter: 'level', n: 2 },
          text: 'Whenever one or more of your opponents are attacked, up to one target attacking creature gets +X/+X until end of turn, where X is the number of cards in your hand.',
          effects: [{ op: 'pump', p: { cardsInHand: 'you' }, t: { cardsInHand: 'you' }, duration: 'eot', targets: [{ type: 'creature', attacking: true, upTo: true }] }] },
      ],
    },
    "green slime": {
      abilities: [{
        kind: 'triggered', event: 'etb', self: true, auto: true,
        text: "When this creature enters, counter target activated or triggered ability from an artifact or enchantment source. If a permanent's ability is countered this way, destroy that permanent.",
        effects: [
          { op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', abilities: true, sourceWords: 'artifact or enchantment' }] },
          { op: 'destroy', scope: 'counteredSource', words: 'artifact or enchantment' },
        ],
      }],
      keepKeywords: true,
    },
    "titania's song": {
      abilities: [{
        kind: 'static', auto: true,
        text: 'Each noncreature artifact loses all abilities and becomes an artifact creature with power and toughness each equal to its mana value.',
        effects: [{ op: 'continuous', layer: 4, scope: { who: 'all', what: 'artifact', noncreature: true },
          addTypes: ['Creature'], loseAll: true, setPtFromMv: true }],
      }],
    },
    "structural assault": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Destroy all artifacts, then Structural Assault deals damage to each creature equal to the number of artifacts that were put into graveyards from the battlefield this turn.',
        effects: [
          { op: 'destroyAll', what: 'artifact' },
          { op: 'damage', each: 'creature', n: { artifactsDiedThisTurn: true } },
        ],
      }],
    },
    "collected company": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Look at the top six cards of your library. Put up to two creature cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in any order.',
        effects: [
          { op: 'lookAt', n: 6, keep: 0 },
          { op: 'takeFromLooked', n: 2, filter: 'creature', maxMv: 3, to: 'battlefield', optional: true,
            prompt: 'Choose up to two creature cards with mana value 3 or less to put onto the battlefield.' },
          { op: 'restToBottom' },
        ],
      }],
    },
    "topography tracker": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true,
          text: 'When this creature enters, create a Map token.',
          effects: [{ op: 'createNamedToken', n: 1, name: 'Map', token: 'Map' }] },
        { kind: 'static', auto: true,
          text: 'If a creature you control would explore, it explores an additional time.',
          effects: [{ op: 'exploreAdditional', who: 'you' }] },
      ],
      keepKeywords: true,
    },
    "call to the kindred": {
      abilities: [
        { kind: 'static', auto: true, text: 'Enchant creature.',
          effects: [{ op: 'enchant', filter: 'creature' }] },
        { kind: 'triggered', event: 'yourUpkeep', auto: true,
          text: 'At the beginning of your upkeep, you may look at the top five cards of your library. You may put a creature card that shares a creature type with enchanted creature from among them onto the battlefield, then put the rest on the bottom of your library in any order.',
          effects: [{ op: 'may', prompt: 'Look at the top five cards of your library?',
            then: [
              { op: 'lookAt', n: 5, keep: 0 },
              { op: 'takeFromLooked', n: 1, filter: 'creature', to: 'battlefield', optional: true, sharesCreatureTypeWithAttached: true,
                prompt: 'You may put a creature card that shares a creature type with the enchanted creature onto the battlefield.' },
              { op: 'restToBottom' },
            ] }] },
      ],
    },
    "tide shaper": {
      abilities: [
        { kind: 'triggered', event: 'etb', self: true, auto: true, condition: { kind: 'wasKicked' },
          text: 'When this creature enters, if it was kicked, target land becomes an Island for as long as this creature remains on the battlefield.',
          effects: [{ op: 'becomes', duration: 'whileHere', eff: { addSubtypes: ['Island'], setMana: ['U'] }, targets: [{ type: 'land' }] }] },
        { kind: 'static', auto: true,
          text: 'This creature gets +1/+1 as long as an opponent controls an Island.',
          effects: [{ op: 'continuous', layer: 7, scope: { self: true, what: 'creature' }, cond: { kind: 'opponentControl', what: 'island', n: 1 }, pt: { p: 1, t: 1 } }] },
      ],
      keepKeywords: true,
    },
    "deeproot historian": {
      abilities: [{
        kind: 'static', auto: true,
        text: 'Each Merfolk and Druid card in your graveyard has retrace.',
        effects: [{ op: 'grantRetraceNonlandPermanents', filter: 'merfolk or druid' }],
      }],
      keepKeywords: true,
    },
    "over the edge": {
      abilities: [{
        kind: 'spell', auto: true,
        text: 'Choose one — Destroy target artifact or enchantment; or target creature you control explores, then explores again.',
        effects: [{ op: 'modal', count: 1, modes: [
          { label: 'Destroy target artifact or enchantment', auto: true,
            effects: [{ op: 'destroy', targets: [{ type: 'permanent', filter: 'artifact or enchantment', anyOf: ['artifact', 'enchantment'] }] }] },
          { label: 'Target creature you control explores twice', auto: true,
            effects: [
              { op: 'explore', ofTarget: true, targets: [{ type: 'creature', controller: 'you' }] },
              { op: 'explore', ofTarget: true, targets: [{ type: 'creature', controller: 'you' }] },
            ] },
        ] }],
      }],
    },

    "braids, arisen nightmare": {
      abilities: [{ kind: 'triggered', event: 'yourEndStep', auto: true,
        text: "At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card.",
        effects: [{ op: 'braids' }] }],
    },
  };

  /* ---------------- lookup ---------------- */

  /** The script for a card, if there is one, including the player's own. */
  function scriptFor(name) {
    const k = keyFor(name);
    const mine = (MTG.settings && MTG.settings.cardScripts) || {};
    return mine[k] || SCRIPTS[k] || null;
  }

  MTG.scripts = {
    keyFor,
    scriptFor,
    all: SCRIPTS,
    /** How many cards are written out by hand, for the README and the UI. */
    count() { return Object.keys(SCRIPTS).length; },
  };
})(window.MTG);


