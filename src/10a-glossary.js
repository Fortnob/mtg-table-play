/* ============================================================
   10a-glossary.js - what a card's keywords mean

   The short explanations shown beside an enlarged card, the way MTG
   Arena shows them: each keyword ability, keyword action, ability word,
   named token and game term a card has or mentions, with a line or two
   of what it does, and the tokens the card makes, to look through.
   MTG.glossary.find(card) picks the terms out of the card;
   UI.cardSides(card) draws both: the keywords for the card's left, the
   tokens for its right, or one column of both where there is room on
   one side only. Used by the card sheet, the hover previews, the table's
   close look and the pack opening.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui = MTG.ui || {};

  /* [name, kind, explanation]. Kinds: k a keyword ability, a a keyword
     action, w an ability word, t a named token, g a game term. */
  /* glossary:begin */
  const TERMS = [
    ["-1/-1 counter","g","Gives the creature -1/-1. If a permanent has both +1/+1 and -1/-1 counters, they're removed in pairs until only one kind remains."],
    ["+1/+1 counter","g","Gives the creature +1/+1. If a permanent has both +1/+1 and -1/-1 counters, they're removed in pairs until only one kind remains."],
    ["Abandon","a","In Archenemy, turn a face-up ongoing scheme face down and put it on the bottom of its owner's scheme deck."],
    ["Absorb","k","If a source would deal damage to this creature, prevent N of that damage."],
    ["Adamant","w","Marks effects that apply only if at least three mana of the specified color (or colorless mana) was spent to cast this spell."],
    ["Adapt","a","If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."],
    ["Addendum","w","Marks extra effects that happen only if you cast this spell during your main phase."],
    ["Affinity","k","\"Affinity for [quality]\" means this spell costs {1} less to cast for each [quality] you control."],
    ["Afflict","k","Whenever this creature becomes blocked, defending player loses N life."],
    ["Afterlife","k","When this creature dies, create N 1/1 white and black Spirit creature tokens with flying."],
    ["Aftermath","k","Cast this half of the split card only from your graveyard. Then exile it."],
    ["Airbend","a","Exile it. While it's exiled, its owner may cast it for {2} rather than its mana cost."],
    ["Alliance","w","Marks abilities that trigger whenever another creature you control enters."],
    ["Amass","a","Put N +1/+1 counters on an Army you control. It's also a [subtype]. If you don't control an Army, first create a 0/0 black [subtype] Army creature token."],
    ["Amplify","k","As this creature enters, reveal any number of cards from your hand that share a creature type with it. It enters with N +1/+1 counters on it for each card revealed."],
    ["Annihilator","k","Whenever this creature attacks, defending player sacrifices N permanents."],
    ["Ascend","k","If you control ten or more permanents, you get the city's blessing for the rest of the game."],
    ["Assimilate","a","Put the card onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types."],
    ["Assist","k","Another player can help pay the generic mana of this spell's cost."],
    ["Aura Swap","k","[cost]: You may exchange this Aura with an Aura card in your hand."],
    ["Awaken","k","If you cast this spell for its awaken cost, also put N +1/+1 counters on target land you control. That land becomes a 0/0 Elemental creature with haste and is still a land."],
    ["Backup","k","When this creature enters, put N +1/+1 counters on target creature. If that's another creature, it gains this creature's abilities listed after backup until end of turn."],
    ["Banding","k","Any creatures with banding, and up to one without, can attack in a band, which is blocked as a group. If your creature with banding blocks or is blocked by a creature, you, not its controller, divide that creature's combat damage."],
    ["Bargain","k","You may sacrifice an artifact, enchantment, or token as you cast this spell. Its other text checks whether it was bargained."],
    ["Basic landcycling","k","[Cost], Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle."],
    ["Battalion","w","Marks abilities that trigger whenever this creature and at least two other creatures attack."],
    ["Battle Cry","k","Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn."],
    ["Behold","a","To behold a [quality], choose a [quality] permanent you control or reveal a [quality] card from your hand."],
    ["Bestow","k","If you cast this card for its bestow cost, it's an Aura spell with enchant creature. It becomes a creature again if it's not attached to a creature."],
    ["Blight","a","Put N -1/-1 counters on a creature you control. You can't blight if you control no creatures."],
    ["Blitz","k","If you cast this spell for its blitz cost, it gains haste and \"When this creature dies, draw a card.\" Sacrifice it at the beginning of the next end step."],
    ["Blood","t","An artifact token with \"{1}, {T}, Discard a card, Sacrifice this token: Draw a card.\""],
    ["Bloodrush","w","Marks an ability you activate by paying a cost and discarding this card from your hand to give target attacking creature a bonus, usually this card's power and toughness."],
    ["Bloodthirst","k","If an opponent was dealt damage this turn, this creature enters with N +1/+1 counters on it."],
    ["Boast","k","You can activate this ability only if this creature attacked this turn, and only once each turn."],
    ["Bolster","a","Choose a creature with the least toughness among creatures you control and put N +1/+1 counters on it."],
    ["Bushido","k","Whenever this creature blocks or becomes blocked, it gets +N/+N until end of turn."],
    ["Buyback","k","You may pay an additional [cost] as you cast this spell. If you do, put this card into your hand as it resolves."],
    ["Cascade","k","When you cast this spell, exile cards from the top of your library until you exile a nonland card with lesser mana value. You may cast it without paying its mana cost, then put all exiled cards you didn't cast on the bottom in a random order."],
    ["Casualty","k","As you cast this spell, you may sacrifice a creature with power N or greater. When you do, copy this spell."],
    ["Celebration","w","Marks abilities that matter if two or more nonland permanents entered under your control this turn."],
    ["Champion","k","When this enters, sacrifice it unless you exile another [type] you control. When this leaves the battlefield, that card returns to the battlefield."],
    ["Changeling","k","This card is every creature type, in every zone and even outside the game."],
    ["Channel","w","Marks abilities you activate by discarding this card from your hand, along with any other listed cost."],
    ["Choose a background","k","You can have a legendary Background enchantment as a second commander alongside this one."],
    ["Chroma","w","Marks abilities that count the mana symbols of a certain color in the mana costs of cards or permanents."],
    ["Cipher","k","Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost."],
    ["City's blessing","g","A designation you keep for the rest of the game, usually gained through ascend once you control ten or more permanents. Cards check whether you have it."],
    ["Clash","a","Each clashing player reveals the top card of their library, then puts it on top or bottom. A player wins if their card had a higher mana value than all others revealed."],
    ["Cleave","k","You may cast this spell for its cleave cost. If you do, remove the words in square brackets."],
    ["Cloak","a","Put a card onto the battlefield face down as a 2/2 creature with ward {2}. Turn it face up any time for its mana cost if it's a creature card."],
    ["Clue","t","An artifact token with \"{2}, Sacrifice this token: Draw a card.\""],
    ["Cohort","w","Marks activated abilities whose cost is \"{T}, Tap an untapped Ally you control.\""],
    ["Collect evidence","a","Exile any number of cards from your graveyard with total mana value N or greater."],
    ["Commander ninjutsu","k","[cost], Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand or the command zone tapped and attacking."],
    ["Companion","k","If your starting deck meets this card's condition, you may reveal it from outside the game as your companion. Once per game, any time you could cast a sorcery, you may pay {3} to put it into your hand."],
    ["Compleated","k","For each Phyrexian mana symbol in its cost paid with 2 life, this planeswalker enters with two fewer loyalty counters."],
    ["Conjure","a","Create a card that wasn't in the game and put it into the stated zone, such as your hand or library. It's a real card, not a token. (Digital only.)"],
    ["Connive","a","Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on the conniving creature."],
    ["Conspire","k","As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it, and you may choose new targets for the copy."],
    ["Constellation","w","Marks abilities that trigger whenever an enchantment you control enters, often including this one."],
    ["Converge","w","Marks abilities that count the number of colors of mana spent to cast this spell."],
    ["Convert","a","Turn a double-faced permanent so its other face is up. It works like transforming but is a separate action."],
    ["Convoke","k","Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color."],
    ["Corrupted","w","Marks abilities that matter if an opponent has three or more poison counters."],
    ["Council's dilemma","w","Marks spells and abilities where, starting with you, each player votes for one of two options; each option's effect scales with the number of votes it gets."],
    ["Coven","w","Marks abilities that matter if you control three or more creatures with different powers."],
    ["Covercast","w","Digital-only. Marks abilities on instant and sorcery cards that trigger whenever you cast another instant or sorcery spell with five or more mana spent to cast it."],
    ["Craft","k","[cost], Exile this permanent, Exile the listed materials from among other permanents you control and/or cards in your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery."],
    ["Crew","k","Tap any number of other untapped creatures you control with total power N or more: This Vehicle becomes an artifact creature until end of turn."],
    ["Cumulative upkeep","k","At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay [cost] for each age counter on it."],
    ["Cursed Role","t","Enchanted creature has base power and toughness 1/1. A creature can have only one Role of yours at a time; a newer one replaces it."],
    ["Cycling","k","[Cost], Discard this card: Draw a card. You can cycle it only while it's in your hand."],
    ["Dash","k","You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step."],
    ["Day and night","g","Once it's day or night, it stays one or the other. If a turn's active player casts no spells, day becomes night next turn; if they cast two or more, night becomes day next turn."],
    ["Daybound","k","If a player casts no spells during their own turn, it becomes night next turn. When it's night, this transforms to its nightbound face, and it can't transform any other way."],
    ["Deathtouch","k","Any amount of damage this deals to a creature is enough to destroy it."],
    ["Decayed","k","This creature can't block. When it attacks, sacrifice it at end of combat."],
    ["Defender","k","This creature can't attack."],
    ["Delirium","w","Marks abilities that work only if there are four or more card types among cards in your graveyard."],
    ["Delve","k","Each card you exile from your graveyard while casting this spell pays for {1}."],
    ["Demonstrate","k","When you cast this spell, you may copy it. If you do, choose an opponent to also copy it, and players may choose new targets for their copies."],
    ["Descend","w","Descend N marks abilities that work only if there are N or more permanent cards in your graveyard (Descend 4 or Descend 8)."],
    ["Desertwalk","k","This creature can't be blocked as long as defending player controls a Desert."],
    ["Detain","a","Until your next turn, the detained permanent can't attack or block and its activated abilities can't be activated."],
    ["Dethrone","k","Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it."],
    ["Devoid","k","This card has no color."],
    ["Devour","k","As this enters, you may sacrifice any number of creatures. It enters with N +1/+1 counters on it for each creature sacrificed this way."],
    ["Disappear","w","Marks abilities that matter if a permanent left the battlefield under your control this turn."],
    ["Discover","a","Exile cards from the top of your library until you exile a nonland card with mana value N or less. Cast it without paying its mana cost or put it into your hand, then put the rest on the bottom in a random order."],
    ["Disguise","k","You may cast this card face down for {3} as a 2/2 creature with ward {2}. Turn it face up any time for its disguise cost."],
    ["Disturb","k","You may cast this card transformed from your graveyard for its disturb cost."],
    ["Doctor's companion","k","You can have two commanders if the other is a legendary Time Lord Doctor creature with no other creature types."],
    ["Domain","w","Marks abilities that count the number of basic land types (Plains, Island, Swamp, Mountain, Forest) among lands you control."],
    ["Double agenda","k","Start the game with this conspiracy face down in the command zone and secretly choose two different card names. You may turn it face up any time you have priority, revealing them."],
    ["Double strike","k","This creature deals both first-strike and regular combat damage."],
    ["Double team","k","When this nontoken creature attacks, conjure a duplicate of it into your hand, then both of them perpetually lose double team."],
    ["Draft from a spellbook","a","Choose one of three random cards from this card's spellbook, a fixed list of cards from outside the game, and put it into your hand (or where the ability says). (Digital only.)"],
    ["Dredge","k","If you would draw a card, you may instead mill N cards and return this card from your graveyard to your hand. You need at least N cards in your library."],
    ["Dungeon","g","A card put into the command zone when you venture into the dungeon. Each venture moves you to a connected room of your choice and triggers it; finishing the last room completes it."],
    ["Earthbend","a","Target land you control becomes a 0/0 creature with haste that's still a land. Put N +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped."],
    ["Echo","k","At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost."],
    ["Eerie","w","Marks abilities that trigger whenever an enchantment you control enters and whenever you fully unlock a Room."],
    ["Embalm","k","[cost], Exile this card from your graveyard: Create a token that's a copy of it, except it's white, has no mana cost, and is a Zombie in addition to its other types. Embalm only as a sorcery."],
    ["Emblem","g","A marker in the command zone with one or more abilities, often from a planeswalker. It's neither a card nor a permanent, and it stays for the rest of the game."],
    ["Emerge","k","You may cast this spell by sacrificing a creature and paying the emerge cost reduced by that creature's mana value."],
    ["Eminence","w","Marks commander abilities that work while this card is in the command zone as well as on the battlefield."],
    ["Enchant","k","This Aura can target and be attached only to the stated kind of object or player."],
    ["Encore","k","[cost], Exile this card from your graveyard: For each opponent, create a token copy with haste that attacks that opponent this turn if able. Sacrifice them at the beginning of the next end step; activate only as a sorcery."],
    ["Endure","a","The permanent's controller puts N +1/+1 counters on it or creates an N/N white Spirit creature token."],
    ["Energy counter","g","A counter a player gets, shown as {E}. To pay {E}, you remove one energy counter from yourself."],
    ["Enlist","k","As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature's until end of turn."],
    ["Enrage","w","Marks abilities that trigger whenever this creature is dealt damage."],
    ["Entwine","k","You may choose all modes of this spell instead of the usual number if you pay an additional [cost] as you cast it."],
    ["Epic","k","For the rest of the game, you can't cast spells. At the beginning of each of your upkeeps, copy this spell except for its epic ability; you may choose new targets for the copy."],
    ["Equip","k","[Cost]: Attach this Equipment to target creature you control. Equip only as a sorcery."],
    ["Escalate","k","Pay this spell's escalate cost once for each mode you choose beyond the first."],
    ["Escape","k","You may cast this card from your graveyard by paying its escape cost rather than its mana cost. Escape costs usually include exiling other cards from your graveyard."],
    ["Eternalize","k","[cost], Exile this card from your graveyard: Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types. Eternalize only as a sorcery."],
    ["Evoke","k","You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters."],
    ["Evolve","k","Whenever a creature you control enters, if that creature has greater power or toughness than this creature, put a +1/+1 counter on this creature."],
    ["Exalted","k","Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn."],
    ["Exert","a","An exerted permanent won't untap during your next untap step. Creatures are usually exerted as they attack in exchange for a bonus."],
    ["Exhaust","k","The activated ability that follows can be activated only once, not once each turn."],
    ["Experience counter","g","A counter a player gets. It does nothing by itself; cards with experience-counter abilities count how many you have."],
    ["Exploit","k","When this creature enters, you may sacrifice a creature."],
    ["Explore","a","Reveal the top card of your library. If it's a land, put it into your hand. Otherwise, put a +1/+1 counter on this creature, and you may put that card into your graveyard."],
    ["Extort","k","Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life."],
    ["Fabricate","k","When this creature enters, put N +1/+1 counters on it or create N 1/1 colorless Servo artifact creature tokens."],
    ["Face a dilemma","a","You face a dilemma as you choose one or more modes for a spell or ability."],
    ["Fading","k","This permanent enters with N fade counters on it. At the beginning of your upkeep, remove a fade counter from it; if you can't, sacrifice it."],
    ["Fateful hour","w","Marks abilities that work only if you have 5 or less life."],
    ["Fateseal","a","Look at the top N cards of an opponent's library, then put any number of them on the bottom of that library and the rest on top in any order."],
    ["Fathomless descent","w","Marks abilities that count the number of permanent cards in your graveyard."],
    ["Fear","k","This creature can't be blocked except by artifact creatures and/or black creatures."],
    ["Ferocious","w","Marks abilities that matter if you control a creature with power 4 or greater."],
    ["Fight","a","Each of the two creatures deals damage equal to its power to the other. This damage isn't combat damage."],
    ["Finality counter","g","If a permanent with a finality counter would be put into a graveyard from the battlefield, exile it instead."],
    ["Firebending","k","Whenever this creature attacks, add N {R}. This mana lasts until end of combat."],
    ["First strike","k","This creature deals combat damage before creatures without first strike."],
    ["Flanking","k","Whenever this creature becomes blocked by a creature without flanking, the blocking creature gets -1/-1 until end of turn."],
    ["Flash","k","You may cast this spell any time you could cast an instant."],
    ["Flashback","k","You may cast this card from your graveyard for its flashback cost. Then exile it."],
    ["Flurry","w","Marks abilities that trigger whenever you cast your second spell each turn."],
    ["Flying","k","This creature can't be blocked except by creatures with flying or reach."],
    ["Food","a","A Food token is a colorless artifact token with \"{2}, {T}, Sacrifice this token: You gain 3 life.\""],
    ["For Mirrodin!","k","When this Equipment enters, create a 2/2 red Rebel creature token, then attach this to it."],
    ["Forage","a","Exile three cards from your graveyard or sacrifice a Food."],
    ["Forecast","k","You may activate this ability only from your hand by revealing this card, only during your upkeep, and only once each turn."],
    ["Forestcycling","k","[Cost], Discard this card: Search your library for a Forest card, reveal it, put it into your hand, then shuffle."],
    ["Forestwalk","k","This creature can't be blocked as long as defending player controls a Forest."],
    ["Foretell","k","During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost."],
    ["Formidable","w","Marks abilities that work only if creatures you control have total power 8 or greater."],
    ["Fortify","k","[cost]: Attach this Fortification to target land you control. Fortify only as a sorcery."],
    ["Freerunning","k","You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander."],
    ["Frenzy","k","Whenever this creature attacks and isn't blocked, it gets +N/+0 until end of turn."],
    ["Friends forever","k","You can have two commanders if both have friends forever."],
    ["Fuse","k","You may cast one or both halves of this split card from your hand. If you cast both, you pay both mana costs and get both effects."],
    ["Gift","k","As you cast this spell, you may promise an opponent the named gift. If you do, they get it before the spell's other effects, or when this permanent enters."],
    ["Goad","a","Until your next turn, the goaded creature attacks each combat if able and attacks a player other than you if able."],
    ["Gold","t","An artifact token with \"Sacrifice this token: Add one mana of any color.\""],
    ["Graft","k","This enters with N +1/+1 counters on it. Whenever another creature enters, you may move a +1/+1 counter from this onto that creature."],
    ["Grandeur","w","Marks abilities you activate by discarding another card with the same name as this permanent."],
    ["Gravestorm","k","When you cast this spell, copy it for each permanent put into a graveyard from the battlefield this turn. You may choose new targets for the copies."],
    ["Halflingcycling","k","[Cost], Discard this card: Search your library for a Halfling card, reveal it, put it into your hand, then shuffle."],
    ["Harmonize","k","You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {X}, where X is its power. Then exile this spell."],
    ["Harness","a","If this permanent isn't harnessed, it becomes harnessed until it leaves the battlefield. While harnessed, its ∞ abilities are active."],
    ["Haste","k","This creature can attack and {T} as soon as it comes under your control."],
    ["Haunt","k","When this creature dies, or when this spell card is put into a graveyard as it resolves, exile it haunting target creature. Its abilities that mention \"the creature it haunts\" then refer to that creature."],
    ["Heist","a","Look at three random nonland cards from target opponent's library and exile one face down. You may cast it while it remains exiled, spending mana as though it were mana of any type. (Digital only.)"],
    ["Hellbent","w","Marks abilities that work only if you have no cards in hand."],
    ["Hero's Reward","w","Marks abilities on Theros challenge-deck cards (the Hydra, the Horde, a God's minions) that reward the players when that card leaves the battlefield or is put into a graveyard."],
    ["Heroic","w","Marks abilities that trigger whenever you cast a spell that targets this creature."],
    ["Hexproof","k","This can't be the target of spells or abilities your opponents control."],
    ["Hexproof from","k","This can't be the target of [quality] spells your opponents control or abilities your opponents control from [quality] sources."],
    ["Hidden agenda","k","Start the game with this conspiracy face down in the command zone and secretly choose a card name. You may turn it face up any time you have priority, revealing that name."],
    ["Hideaway","k","When this enters, look at the top N cards of your library, exile one face down, then put the rest on the bottom in a random order. Another ability on the card can let you play the exiled card later."],
    ["Horsemanship","k","This creature can't be blocked except by creatures with horsemanship."],
    ["Impending","k","If you cast this for [cost], it enters with N time counters and isn't a creature until the last is removed. At the beginning of your end step, remove one."],
    ["Imprint","w","Marks abilities that exile one or more cards, which this permanent's other abilities then refer to."],
    ["Improvise","k","Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}."],
    ["Incorporate","a","The chosen card perpetually costs [cost] more to cast and gains that cost's colors in addition to its own. (Digital only.)"],
    ["Increment","k","Whenever you cast a spell, if the amount of mana you spent is greater than this creature's power or toughness, put a +1/+1 counter on this creature."],
    ["Incubate","a","Create an Incubator token with N +1/+1 counters on it and \"{2}: Transform this token.\" It transforms into a 0/0 Phyrexian artifact creature."],
    ["Incubator","t","A double-faced artifact token with \"{2}: Transform this token.\" It transforms into a 0/0 Phyrexian artifact creature, usually with +1/+1 counters on it."],
    ["Indestructible","k","Damage and effects that say \"destroy\" don't destroy this."],
    ["Infect","k","This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters."],
    ["Infusion","w","Marks abilities that care whether you gained life this turn."],
    ["Ingest","k","Whenever this creature deals combat damage to a player, that player exiles the top card of their library."],
    ["Initiative","g","When you take the initiative, and at the beginning of your upkeep while you have it, venture into Undercity. A player whose creatures deal combat damage to you takes it."],
    ["Inspired","w","Marks abilities that trigger whenever this creature becomes untapped."],
    ["Intensity","k","This card has an intensity number that starts at the given value and that its abilities refer to. When it intensifies, its intensity perpetually increases."],
    ["Intimidate","k","This creature can't be blocked except by artifact creatures and/or creatures that share a color with it."],
    ["Investigate","a","Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\""],
    ["Islandcycling","k","[Cost], Discard this card: Search your library for an Island card, reveal it, put it into your hand, then shuffle."],
    ["Islandwalk","k","This creature can't be blocked as long as defending player controls an Island."],
    ["Job select","k","When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it."],
    ["Join forces","w","Marks spells and abilities where, starting with you, each player may pay any amount of mana, and the effect scales with the total mana paid."],
    ["Jump-start","k","You may cast this card from your graveyard by discarding a card in addition to paying its other costs. Then exile this card."],
    ["Junk","t","An artifact token with \"{T}, Sacrifice this token: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.\""],
    ["Kicker","k","You may pay an additional [cost] as you cast this spell."],
    ["Kinship","w","Marks abilities that let you look at the top card of your library at the beginning of your upkeep and reveal it for a bonus if it shares a creature type with this creature."],
    ["Landcycling","k","[Cost], Discard this card: Search your library for a land card of the stated type, reveal it, put it into your hand, then shuffle. It counts as cycling."],
    ["Landfall","w","Marks abilities that trigger whenever a land you control enters."],
    ["Landwalk","k","This creature can't be blocked as long as defending player controls a land of the stated type."],
    ["Learn","a","You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card."],
    ["Legend rule","g","If you control two or more legendary permanents with the same name, you choose one and put the rest into their owners' graveyards."],
    ["Legendary landwalk","k","This creature can't be blocked as long as defending player controls a legendary land."],
    ["Level Up","k","[cost]: Put a level counter on this; level up only as a sorcery. Its level ranges grant stats and abilities based on how many level counters it has."],
    ["Lieutenant","w","Marks abilities that work only if you control your commander."],
    ["Lifelink","k","Damage dealt by this also causes you to gain that much life."],
    ["Living metal","k","As long as it's your turn, this Vehicle is also an artifact creature."],
    ["Living weapon","k","When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it."],
    ["Lore counter","g","Tracks a Saga's progress. A Saga enters with one and gets another as your first main phase begins, triggering each chapter; after its final chapter resolves, it's sacrificed."],
    ["Madness","k","If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard."],
    ["Magecraft","w","Marks abilities that trigger whenever you cast or copy an instant or sorcery spell."],
    ["Manifest","a","Put a card onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it's a creature card."],
    ["Manifest dread","a","Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card."],
    ["Map","t","An artifact token with \"{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.\""],
    ["Max speed","k","As long as your speed is 4, this has the ability that follows. Your speed increases once on each of your turns when an opponent loses life."],
    ["Mayhem","k","If you discarded this card this turn, you may cast it from your graveyard for [cost] (or play it, if mayhem has no cost). Timing rules still apply."],
    ["Megamorph","k","You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its megamorph cost [cost] and put a +1/+1 counter on it."],
    ["Meld","a","Put the two cards of a meld pair onto the battlefield with their back faces up, combined into a single permanent. Only two cards from the same meld pair can meld."],
    ["Melee","k","Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked with a creature this combat."],
    ["Menace","k","This creature can't be blocked except by two or more creatures."],
    ["Mentor","k","Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power."],
    ["Metalcraft","w","Marks abilities that work only if you control three or more artifacts."],
    ["Mill","a","Put the top N cards of your library into your graveyard."],
    ["Miracle","k","You may cast this card for its miracle cost [cost] when you draw it if it's the first card you drew this turn."],
    ["Mobilize","k","Whenever this creature attacks, create N tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step."],
    ["Modular","k","This creature enters with N +1/+1 counters on it. When it dies, you may put its +1/+1 counters on target artifact creature."],
    ["Monarch","g","At the beginning of the monarch's end step, they draw a card. Whenever a creature deals combat damage to the monarch, its controller becomes the monarch."],
    ["Monster Role","t","Enchanted creature gets +1/+1 and has trample. A creature can have only one Role of yours at a time; a newer one replaces it."],
    ["Monstrosity","a","If this creature isn't monstrous, put N +1/+1 counters on it and it becomes monstrous. It stays monstrous until it leaves the battlefield."],
    ["Morbid","w","Marks abilities that matter if a creature died this turn."],
    ["More Than Meets the Eye","k","You may cast this card converted (with its back face up) by paying [cost] rather than its mana cost."],
    ["Morph","k","You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost [cost]."],
    ["Mountaincycling","k","[Cost], Discard this card: Search your library for a Mountain card, reveal it, put it into your hand, then shuffle."],
    ["Mountainwalk","k","This creature can't be blocked as long as defending player controls a Mountain."],
    ["Multikicker","k","You may pay an additional [cost] any number of times as you cast this spell."],
    ["Mutate","k","If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it."],
    ["Myriad","k","Whenever this creature attacks, for each opponent other than defending player, you may create a token copy of it tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat."],
    ["Nightbound","k","As it becomes day, transform this permanent. It becomes day next turn if a player casts at least two spells during their own turn."],
    ["Ninjutsu","k","[cost], Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking."],
    ["Nonbasic landwalk","k","This creature can't be blocked as long as defending player controls a nonbasic land."],
    ["Offering","k","You may cast this any time you could cast an instant by sacrificing a permanent of the named type and paying the difference in mana costs. Mana cost includes color."],
    ["Offspring","k","You may pay an additional [cost] as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it."],
    ["Oil counter","g","A counter with no rules meaning of its own. Cards put oil counters on permanents and use them, often removing them to pay costs."],
    ["Opus","w","Marks abilities that trigger whenever you cast an instant or sorcery spell, with a stronger effect if five or more mana was spent to cast it."],
    ["Outlast","k","[cost], {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery."],
    ["Overload","k","You may cast this spell for its overload cost [cost]. If you do, change its text by replacing all instances of \"target\" with \"each.\""],
    ["Pack tactics","w","Marks abilities that trigger when this creature attacks, if you attacked with creatures with total power 6 or greater this combat."],
    ["Paradigm","k","Then exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases."],
    ["Paradox","w","Marks abilities that care about spells you cast from anywhere other than your hand."],
    ["Parley","w","Marks abilities that have each player reveal the top card of their library, with an effect based on the nonland cards revealed this way."],
    ["Partner","k","You can have two commanders if both have partner. Your deck's color identity is the combined color identity of both."],
    ["Partner with","k","You can have this and the named partner as your two commanders. When this enters, target player may search their library for the named card, put it into their hand, then shuffle."],
    ["Perpetually","g","Digital-only. A change made perpetually stays with the card for the rest of the game, even as it moves between zones."],
    ["Persist","k","When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it."],
    ["Phasing","k","A phased-out permanent is treated as though it doesn't exist until it phases in during its controller's next untap step. A permanent with phasing phases in or out during each of its controller's untap steps."],
    ["Plainscycling","k","[Cost], Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle."],
    ["Plainswalk","k","This creature can't be blocked as long as defending player controls a Plains."],
    ["Planeswalk","a","In Planechase, put each face-up plane and phenomenon on the bottom of its owner's planar deck, then turn the top card of your planar deck face up."],
    ["Plot","a","You may pay [cost] and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery."],
    ["Poison counter","g","A counter a player gets, usually from infect, toxic, or poisonous. A player with ten or more poison counters loses the game."],
    ["Poisonous","k","Whenever this creature deals combat damage to a player, that player gets N poison counters. A player with ten or more poison counters loses the game."],
    ["Populate","a","Create a token that's a copy of a creature token you control."],
    ["Power-up","k","Activate this ability only once. If this permanent entered this turn, the ability costs less by this permanent's mana cost."],
    ["Powerstone","t","An artifact token with \"{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.\""],
    ["Prepared","a","While a permanent is prepared, you may cast a copy of its prepare spell. Doing so unprepares it. Only permanents with a prepare spell can become prepared."],
    ["Proliferate","a","Choose any number of permanents and/or players, then give each another counter of each kind already there."],
    ["Protection","k","This can't be blocked, targeted, enchanted, or equipped by anything with the stated quality, and all damage from sources with that quality is prevented."],
    ["Prototype","k","You may cast this spell with a different mana cost, color, and size. It keeps its abilities and types."],
    ["Provoke","k","Whenever this creature attacks, you may have target creature defending player controls untap and block it if able."],
    ["Prowess","k","Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn."],
    ["Prowl","k","You may cast this spell for [cost] if you dealt combat damage to a player this turn with a creature that shares a creature type with it."],
    ["Rad counter","g","At the beginning of your first main phase, mill a card for each rad counter you have. For each nonland card milled, lose 1 life and remove a rad counter."],
    ["Radiance","w","Marks spells and abilities that affect a target and also each other permanent of that kind that shares a color with it."],
    ["Raid","w","Marks abilities that matter if you attacked this turn."],
    ["Rally","w","Marks abilities that trigger whenever this creature or another Ally you control enters."],
    ["Rampage","k","Whenever this creature becomes blocked, it gets +N/+N until end of turn for each creature blocking it beyond the first."],
    ["Ravenous","k","This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters."],
    ["Reach","k","This creature can block creatures with flying."],
    ["Read Ahead","k","Choose a chapter and this Saga starts with that many lore counters. Add one after your draw step. Skipped chapters don't trigger."],
    ["Rebound","k","If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost."],
    ["Reconfigure","k","[cost]: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature."],
    ["Recover","k","When a creature is put into your graveyard from the battlefield, you may pay [cost]. If you do, return this card from your graveyard to your hand; otherwise, exile it."],
    ["Recruit","a","Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token."],
    ["Regenerate","a","The next time this permanent would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it."],
    ["Reinforce","k","[cost], Discard this card: Put N +1/+1 counters on target creature."],
    ["Renew","w","Marks activated abilities that work from your graveyard and exile the card as part of their cost. These abilities can be activated only as a sorcery."],
    ["Renown","k","When this creature deals combat damage to a player, if it isn't renowned, put N +1/+1 counters on it and it becomes renowned."],
    ["Repartee","w","Marks abilities that trigger whenever you cast an instant or sorcery spell that targets a creature."],
    ["Replicate","k","As you cast this spell, you may pay [cost] any number of times. When you cast it, copy it that many times; you may choose new targets for the copies."],
    ["Retrace","k","You may cast this card from your graveyard by discarding a land card in addition to paying its other costs."],
    ["Revolt","w","Marks abilities that matter if a permanent you controlled left the battlefield this turn."],
    ["Riot","k","This creature enters with your choice of a +1/+1 counter or haste."],
    ["Ripple","k","When you cast this spell, you may reveal the top N cards of your library, cast any with the same name as this spell without paying their mana costs, and put the rest on the bottom."],
    ["Role","t","An Aura enchantment token that enchants a creature and changes it, usually for the better. A creature can have only one Role of yours at a time; a newer one replaces it."],
    ["Royal Role","t","Enchanted creature gets +1/+1 and has ward {1}. A creature can have only one Role of yours at a time; a newer one replaces it."],
    ["Saddle","k","Tap any number of other untapped creatures you control with total power N or more: This becomes saddled until end of turn. Saddle only as a sorcery."],
    ["Scavenge","k","[cost], Exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Scavenge only as a sorcery."],
    ["Scry","a","Look at the top N cards of your library, then put any number of them on the bottom and the rest on top in any order."],
    ["Secret council","w","Marks abilities where each player secretly votes, then all the votes are revealed at once and the effect depends on them."],
    ["Seek","a","Put a random card that matches the description from your library into your hand. If no card matches, nothing happens. (Digital-only.)"],
    ["Set in motion","a","In Archenemy, the archenemy moves a scheme off the top of their scheme deck and turns it face up. Its \"When you set this scheme in motion\" ability then triggers."],
    ["Shadow","k","This creature can block or be blocked by only creatures with shadow."],
    ["Shard","t","An enchantment token with \"{2}, Sacrifice this token: Scry 1, then draw a card.\""],
    ["Shield counter","g","If a permanent with a shield counter would be dealt damage or destroyed, instead prevent that and remove a shield counter from it."],
    ["Shroud","k","This permanent or player can't be the target of spells or abilities."],
    ["Skulk","k","This creature can't be blocked by creatures with greater power."],
    ["Slivercycling","k","[Cost], Discard this card: Search your library for a Sliver card, reveal it, put it into your hand, then shuffle."],
    ["Sneak","k","During your declare blockers step, you may cast this spell for [cost] by also returning an unblocked attacker you control to its owner's hand. A permanent cast this way enters tapped and attacking."],
    ["Solved","k","Marks a Case ability that works only once the Case is solved. At the beginning of your end step, an unsolved Case becomes solved if its \"To solve\" condition is true."],
    ["Sorcerer Role","t","Enchanted creature gets +1/+1 and has \"Whenever this creature attacks, scry 1.\" A creature can have only one Role of yours at a time."],
    ["Soulbond","k","You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them."],
    ["Soulshift","k","When this creature dies, you may return target Spirit card with mana value N or less from your graveyard to your hand."],
    ["Specialize","k","[Cost], Choose a color and discard a card of that color or with its basic land type: This perpetually becomes its version for that color. Activate only as a sorcery."],
    ["Spectacle","k","You may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn."],
    ["Speed","g","A player's speed starts at 1, usually from start your engines!, and increases once on each of their turns when an opponent loses life. Max speed is 4."],
    ["Spell mastery","w","Marks abilities that work only if there are two or more instant and/or sorcery cards in your graveyard."],
    ["Spellbook","g","Digital-only. A fixed list of cards tied to a card. To draft from it, you see three random cards from that list and put the one you choose into your hand."],
    ["Splice","k","As you cast a [quality] spell (such as Arcane), you may reveal this card from your hand and pay [cost]. If you do, add this card's effects to that spell."],
    ["Split second","k","As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities."],
    ["Spree","k","Choose one or more of this spell's modes. As an additional cost to cast it, pay the + cost of each mode you chose."],
    ["Squad","k","As an additional cost to cast this spell, you may pay [cost] any number of times. When this creature enters, create that many tokens that are copies of it."],
    ["Start your engines!","w","If you have no speed, it becomes 1. Your speed increases by 1 once on each of your turns when an opponent loses life, up to max speed 4."],
    ["Station","k","Tap another untapped creature you control: Put charge counters equal to its power on this. Station only as a sorcery. At N+ counters, it has that section's abilities (and is a creature if a P/T is shown)."],
    ["Storied","k","If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game."],
    ["Storm","k","When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies."],
    ["Strive","w","Marks spells that cost an additional amount to cast for each target beyond the first."],
    ["Stun counter","g","If a permanent with a stun counter would become untapped, instead remove a stun counter from it."],
    ["Summoning sickness","g","A creature can't attack or activate abilities with {T} or {Q} in the cost unless you've controlled it continuously since your most recent turn began. Haste ignores this."],
    ["Sunburst","k","This enters with a +1/+1 counter on it for each color of mana spent to cast it, or a charge counter for each instead if it isn't a creature."],
    ["Support","a","Put a +1/+1 counter on each of up to N other target creatures. On an instant or sorcery, it's up to N target creatures."],
    ["Surge","k","You may cast this spell for its surge cost if you or a teammate has cast another spell this turn."],
    ["Surveil","a","Look at the top N cards of your library, then put any number of them into your graveyard and the rest on top in any order."],
    ["Survival","w","Marks abilities that trigger at the beginning of your second main phase if this creature is tapped."],
    ["Suspect","a","A suspected creature has menace and can't block. It stays suspected until it leaves the battlefield or an effect ends it."],
    ["Suspend","k","Rather than cast this from your hand, you may pay [cost] and exile it with N time counters. At the beginning of your upkeep, remove one; when the last is removed, you may cast it without paying its mana cost, and a creature gains haste."],
    ["Swampcycling","k","[Cost], Discard this card: Search your library for a Swamp card, reveal it, put it into your hand, then shuffle."],
    ["Swampwalk","k","This creature can't be blocked as long as defending player controls a Swamp."],
    ["Sweep","w","Marks spells that let you return any number of lands of a certain basic land type you control to their owner's hand, with an effect based on how many you returned."],
    ["Teamwork","k","As an additional cost to cast this spell, you may tap any number of creatures you control with total power N or more."],
    ["Tempting offer","w","Marks spells and abilities that offer each opponent the same effect you get; for each opponent who accepts, you get the effect again."],
    ["Threshold","w","Marks abilities that work only if seven or more cards are in your graveyard."],
    ["Tiered","k","Choose one mode. As an additional cost to cast this spell, pay the cost listed with that mode."],
    ["Time Travel","a","For each suspended card you own and each permanent you control with a time counter on it, you may add or remove a time counter."],
    ["Toxic","k","Players dealt combat damage by this creature also get N poison counters."],
    ["Training","k","Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature."],
    ["Trample","k","This creature can deal excess combat damage to the player, planeswalker, or battle it's attacking."],
    ["Transfigure","k","[cost], Sacrifice this creature: Search your library for a creature card with the same mana value as this creature, put it onto the battlefield, then shuffle. Transfigure only as a sorcery."],
    ["Transform","a","Turn a double-faced permanent over so its other face is up. Only permanents that are double-faced cards or tokens can transform."],
    ["Transmute","k","[cost], Discard this card: Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Transmute only as a sorcery."],
    ["Treasure","a","An artifact token with \"{T}, Sacrifice this token: Add one mana of any color.\""],
    ["Tribute","k","As this creature enters, an opponent of your choice may put N +1/+1 counters on it. If they don't, its \"if tribute wasn't paid\" ability triggers."],
    ["Typecycling","k","[Cost], Discard this card: Search your library for a card of the stated type, reveal it, put it into your hand, then shuffle. It counts as cycling."],
    ["Umbra armor","k","If the enchanted permanent would be destroyed, instead remove all damage from it and destroy this Aura."],
    ["Undaunted","k","This spell costs {1} less to cast for each opponent you have."],
    ["Undergrowth","w","Marks abilities that count the number of creature cards in your graveyard."],
    ["Undying","k","When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner's control with a +1/+1 counter on it."],
    ["Unearth","k","[Cost]: Return this card from your graveyard to the battlefield with haste. Exile it at the next end step or if it would leave the battlefield; unearth only as a sorcery."],
    ["Unleash","k","You may have this creature enter with a +1/+1 counter on it. It can't block as long as it has a +1/+1 counter on it."],
    ["Valiant","w","Marks abilities that trigger whenever this creature becomes the target of a spell or ability you control for the first time each turn."],
    ["Vanishing","k","This permanent enters with N time counters on it. At the beginning of your upkeep, remove a time counter from it; when the last is removed, sacrifice it."],
    ["Venture into the dungeon","a","Enter the first room of a dungeon, or advance to the next room of the dungeon you're in. Each room's ability triggers when you enter it."],
    ["Vigilance","k","Attacking doesn't cause this creature to tap."],
    ["Virtuous Role","t","Enchanted creature gets +1/+1 for each enchantment you control. A creature can have only one Role of yours at a time; a newer one replaces it."],
    ["Vivid","w","Marks abilities that count the number of colors among permanents you control."],
    ["Void","w","Marks abilities that matter if a nonland permanent left the battlefield this turn or a spell was warped this turn."],
    ["Vote","a","Starting with the specified player and going in turn order, each player chooses one of the listed options."],
    ["Ward","k","Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays [cost]."],
    ["Warp","k","You may cast this from your hand for its warp cost. If you do, exile it at the next end step; you may cast it from exile on a later turn."],
    ["Waterbend","a","Pay [cost]. While paying it, you can tap your untapped artifacts and creatures to help; each one pays for {1}."],
    ["Web-slinging","k","You may cast this spell for [cost] if you also return a tapped creature you control to its owner's hand."],
    ["Wicked Role","t","Enchanted creature gets +1/+1. When this token is put into a graveyard from the battlefield, each opponent loses 1 life. A creature can have only one Role of yours."],
    ["Will of the council","w","Marks spells and abilities where each player votes, starting with you, and the outcome depends on the votes."],
    ["Will of the Planeswalkers","w","Marks abilities where, starting with you, each player votes for planeswalk or chaos. If planeswalk gets more votes, planeswalk; otherwise chaos ensues. Only matters in Planechase."],
    ["Wither","k","This deals damage to creatures in the form of -1/-1 counters."],
    ["Wizardcycling","k","[Cost], Discard this card: Search your library for a Wizard card, reveal it, put it into your hand, then shuffle."],
    ["Young Hero Role","t","Enchanted creature has \"Whenever this creature attacks, if its toughness is 3 or less, put a +1/+1 counter on it.\" A creature can have only one Role of yours."],
  ];
  /* glossary:end */

  /* Actions every card does in plain words; a box for each would bury the
     ones worth explaining. */
  const PLAIN = new Set(['activate', 'attach', 'cast', 'counter', 'create', 'destroy', 'discard', 'exchange', 'exile',
    'play', 'reveal', 'sacrifice', 'shuffle', 'tap', 'untap', 'double', 'triple', 'heal', 'empower jace']);
  /* Tokens whose name is also an everyday word: only "<Name> token" counts. */
  const TOKEN_WORD_ONLY = new Set(['blood', 'gold', 'map', 'junk', 'shard']);
  /* Game terms found by a phrase of their own. */
  const TERM_RX = {
    'monarch': /\bmonarch\b/i,
    'initiative': /\bthe initiative\b/i,
    "city's blessing": /\bcity['’]s blessing\b/i,
    'day and night': /\b(?:it becomes|it['’]s|if it['’]s|becomes) (?:day|night)\b|\bday and night\b/i,
    'energy counter': /\{E\}|\benergy counters?\b/i,
    'speed': /\byour speed\b|\bstart your engines\b/i,
    'dungeon': /\bdungeons?\b/i,
    'emblem': /\bemblems?\b/i,
    'perpetually': /\bperpetually\b/i,
    'spellbook': /\bspellbook\b/i,
    '+1/+1 counter': /\+1\/\+1 counters?\b/,
    '-1/-1 counter': /(?:^|[^+\w])-1\/-1 counters?\b/,
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* The keywords a counter can carry (CR 122.1b): "a flying counter" is
     flying. Any other word before "counter" is just the counter's name
     ("a fuse counter", "a blight counter"). */
  const KEYWORD_COUNTERS = new Set(['flying', 'first strike', 'double strike', 'deathtouch', 'decayed', 'exalted', 'haste',
    'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'shadow', 'trample', 'vigilance']);
  // what may follow a keyword's name as its argument: "Ward {2}", "Toxic 1", "protection from red", "Partner with ..."
  const ARG = /^\s*(?:\d|x\b|n\b|\{|—|from\b|for\b|with\b|$)/i;
  const INFL = '(?:s|es|d|ed|ing)?';

  let index = null;
  /** The terms by lower-case name, and the patterns that find them, built on first use. */
  function build() {
    if (index) return index;
    const byName = new Map();
    for (const [name, kind, text] of TERMS) byName.set(name.toLowerCase(), { name, kind, text });
    const names = (kind) => TERMS.filter(t => t[1] === kind && !PLAIN.has(t[0].toLowerCase())).map(t => t[0])
      .sort((a, b) => b.length - a.length);
    const alt = (list) => list.map(esc).join('|');
    // a keyword ability, anywhere in the rules text: "Flying", "gains trample", "Ward {2}"
    const ability = new RegExp('(^|[^\\w-])(' + alt(names('k')) + ')(?![\\w-])', 'gi');
    // a keyword action, as the verb it is: "scry 2", "it explores", "mills two cards", "manifests dread"
    const actForm = (n) => { const [w, ...rest] = n.split(' '); return esc(w) + INFL + (rest.length ? ' ' + esc(rest.join(' ')) : ''); };
    const action = new RegExp('(^|[^\\w-])(' + names('a').map(actForm).join('|') + ')' + INFL + '(?![\\w-])', 'gi');
    // an ability word starts a line and is followed by a dash
    const word = new RegExp('(^|\\n)(?:• )?(' + alt(names('w')) + ')\\s+—', 'g');
    const tokens = TERMS.filter(t => t[1] === 't').map(([name]) => {
      const lc = name.toLowerCase();
      const rx = TOKEN_WORD_ONLY.has(lc) ? new RegExp('\\b' + esc(name) + ' tokens?\\b')
        : new RegExp('\\b' + esc(name) + 's?\\b');
      return { lc, rx };
    });
    const terms = TERMS.filter(t => t[1] === 'g').map(([name]) => {
      const lc = name.toLowerCase();
      return { lc, rx: TERM_RX[lc] || new RegExp('\\b' + esc(lc) + 's?\\b', 'i') };
    });
    index = { byName, ability, action, word, tokens, terms };
    return index;
  }

  /** The words on a card that rules are written in: every face, without reminder text or its own name. */
  function rulesText(card) {
    const faces = card.card_faces && card.card_faces.length ? card.card_faces : [];
    let text = card.oracle_text || faces.map(f => f.oracle_text || '').join('\n');
    text = text.replace(/\([^()]*\)/g, '');
    const own = new Set([card.name].concat(String(card.name || '').split(' // '), faces.map(f => f.name)).filter(Boolean));
    // a legendary goes by the first part of its name: "When Storm enters" on Storm, Queen of Wakanda
    if (/\bLegendary\b/.test(card.type_line || '')) for (const n of [...own]) { const i = n.indexOf(', '); if (i > 0) own.add(n.slice(0, i)); }
    for (const n of [...own].sort((a, b) => b.length - a.length)) {
      text = text.replace(new RegExp('(^|[^\\w])' + esc(n) + '(?!\\w)', 'g'), '$1CARDNAME');
    }
    // other cards and tokens, by name: "a creature named Bruna, the Fading Light", "Partner with Proud Mentor"
    text = text.replace(/\b(named|Partner with|meld them into) ([A-Z][\w'’-]*(?:,? (?:(?:of|the|and|to|from|in|a|an) )*[A-Z][\w'’-]*)*)/g, '$1 OTHERNAME');
    return text;
  }

  /** A keyword as a card or the table writes it ("Ward {2}", "protection from red") to the term it is. */
  function lookup(word) {
    const { byName, ability } = build();
    const lc = String(word || '').trim().toLowerCase();
    if (!lc) return null;
    if (byName.has(lc)) return byName.get(lc);
    ability.lastIndex = 0;
    const m = ability.exec(lc);
    if (!m || m.index !== 0 || !ARG.test(lc.slice(m[0].length))) return null;
    return byName.get(m[2].toLowerCase()) || null;
  }
  /** An action as the text inflects it ("explores", "manifests dread") to its term. */
  function actionTerm(byName, s) {
    s = s.toLowerCase();
    if (byName.has(s)) return byName.get(s);
    const i = s.indexOf(' '), w = i < 0 ? s : s.slice(0, i), rest = i < 0 ? '' : s.slice(i);
    for (const suf of ['ing', 'ed', 'es', 'd', 's']) {
      if (w.endsWith(suf) && byName.has(w.slice(0, -suf.length) + rest)) return byName.get(w.slice(0, -suf.length) + rest);
    }
    return null;
  }

  /**
   * Every term a card has or mentions, in the order the card brings them up.
   * opts.keywords: what the card has right now on the table, which may be
   * more than it prints; those it does not print are marked granted.
   * @returns {Array<{name: string, kind: string, text: string, granted?: boolean}>}
   */
  function find(card, opts) {
    opts = opts || {};
    if (!card || !TERMS.length) return [];
    const ix = build();
    const text = rulesText(card);
    /* "Fear Gas — ...", "Warp Vortex — ...": a name given to an ability,
       not a keyword. Blanked for the scans (to the same length, so where
       things are stays true) unless it is a term itself (Landfall, Max
       speed, Solved) or a keyword with its number (Suspend 17). */
    const kwWithArg = (lc) => { ix.ability.lastIndex = 0; const m = ix.ability.exec(lc); return !!m && m.index === 0 && ARG.test(lc.slice(m[0].length)); };
    const scanText = text.replace(/^((?:• )?)([^—\n:{}]+?)( — )/gm, (all, lead, label, dash) => {
      const lc = label.trim().toLowerCase();
      return ix.byName.has(lc) || kwWithArg(lc) ? all : lead + ' '.repeat(label.length) + dash;
    });
    const found = new Map();   // lower-case name -> {term, at}
    const add = (term, at, granted) => {
      if (!term || PLAIN.has(term.name.toLowerCase())) return;
      const k = term.name.toLowerCase();
      const had = found.get(k);
      if (!had) found.set(k, { term, at, granted: !!granted });
      else if (at < had.at) had.at = at;
    };
    /* Keywords are written in lower case mid-sentence ("gains flying"); a
       capitalised one there is part of a name. At the start of a line,
       after a bullet, a dash or an opening quote, it is the keyword. */
    const named = (at, word) => {
      if (!/^[A-Z]/.test(word)) return false;
      const lead = scanText.slice(scanText.lastIndexOf('\n', at - 1) + 1, at);
      return !(/^\s*(?:•\s*)?$/.test(lead) || /[—"“]\s*$/.test(lead));
    };
    const scan = (rx, group, resolve) => {
      rx.lastIndex = 0;
      for (let m; (m = rx.exec(scanText));) {
        if (m[0] === '') { rx.lastIndex++; continue; }
        const word = m[group], at = m.index + m[1].length;
        if (named(at, word)) continue;
        // "a fuse counter" is a counter's name; "a flying counter" is flying
        if (/^\s+counters?\b/i.test(scanText.slice(m.index + m[0].length)) && !KEYWORD_COUNTERS.has(word.toLowerCase())) continue;
        add(resolve ? resolve(ix.byName, word) : ix.byName.get(word.toLowerCase()), at);
      }
    };
    const lower = text.toLowerCase();
    for (const k of card.keywords || []) {
      const t = lookup(k);
      if (t) { const at = lower.indexOf(t.name.toLowerCase()); add(t, at < 0 ? 1e6 : at); }
    }
    scan(ix.ability, 2);
    scan(ix.action, 2, actionTerm);
    scan(ix.word, 2);
    for (const { lc, rx } of ix.tokens) {
      const m = rx.exec(text);
      if (m) add(ix.byName.get(lc), m.index);
    }
    // a Role named on the card says it all; the generic Role only when none is
    if ([...found.keys()].some(k => k !== 'role' && k.endsWith(' role'))) found.delete('role');
    for (const { lc, rx } of ix.terms) {
      const m = rx.exec(text);
      if (m) add(ix.byName.get(lc), m.index);
    }
    if (/\bSaga\b/.test(card.type_line || '')) add(ix.byName.get('lore counter'), 1e6);
    // "All permanents you control phase out": phasing, though the word is never printed
    const ph = /\bphas(?:e|es|ed)[ -](?:out|in)\b/i.exec(text);
    if (ph) add(ix.byName.get('phasing'), ph.index);
    /* Scryfall lists the umbrella with the particular ("Hexproof" beside
       "Hexproof from", "Cycling" beside "Islandcycling"): only the
       particular is true of the card. */
    const keys = [...found.keys()];
    if (found.has('hexproof from') && !/hexproof(?! from)/i.test(text)) found.delete('hexproof');
    if (found.has('partner with') || found.has('friends forever')) found.delete('partner');
    if (keys.some(k => k.endsWith('cycling') && !['cycling', 'landcycling', 'typecycling'].includes(k))) {
      if (!/(^|\n)Cycling\b/.test(text)) found.delete('cycling');
      found.delete('landcycling'); found.delete('typecycling');
    }
    if (keys.some(k => k.endsWith('walk') && k !== 'landwalk' && k !== 'planeswalk')) found.delete('landwalk');
    if (found.has('manifest dread')) found.delete('manifest');
    const dropped = new Set(keys.filter(k => !found.has(k)));
    // what the card has been given on the table
    for (const k of opts.keywords || []) {
      const t = lookup(k);
      if (t && !found.has(t.name.toLowerCase()) && !dropped.has(t.name.toLowerCase())) add(t, 2e6, true);
    }
    return [...found.values()].sort((a, b) => a.at - b.at)
      .map(({ term, granted }) => Object.assign({}, term, granted ? { granted: true } : null));
  }

  /* Keywords Scryfall lists that only joke and playtest cards have, which
     are not in this game (MTG.jokes): left without an explanation on purpose. */
  const LEFT_OUT = ['Assemble', 'Augment', 'Open an Attraction', 'Roll to Visit Your Attractions',
    'Affinitycycling', 'Kinfall', 'Landship', 'Legacy', 'Underdog'];

  MTG.glossary = { find, lookup, LEFT_OUT, get size() { return TERMS.length; } };

  /* ---- the tokens a card makes ---- */

  /** The tokens (and emblems) a card makes, as Scryfall links them: one of each. */
  function tokenParts(card) {
    const seen = new Set();
    return (card && card.all_parts || []).filter((p) => {
      if (!p || !p.id || p.id === card.id) return false;
      if (p.component !== 'token' && !/^Emblem\b/.test(p.type_line || '')) return false;
      if (p.name === 'Copy') return false;   // Scryfall's stand-in for "a token that's a copy of ..."
      const k = (p.name || '') + '|' + (p.type_line || '');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  /* A token's picture is a nicety: asked for behind anything the player
     is waiting on, never with an "unreachable" toast, not at all while
     offline unless it is already here, and asked again later after a
     failure rather than never. */
  const tokenCards = new Map();   // id -> Promise<card|null>
  const tokenFailed = new Map();  // id -> when the last lookup failed
  const tokenCard = (id) => {
    if (!tokenCards.has(id)) {
      const t = tokenFailed.get(id);
      if (t && Date.now() - t < 15000) return Promise.resolve(null);
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || !!MTG.scry.offline;
      const p = Promise.resolve(MTG.scry.byId(id, { quiet: true, low: true, cacheOnly: offline })).catch(() => {
        tokenCards.delete(id); tokenFailed.set(id, Date.now()); return null;
      });
      tokenCards.set(id, p);
      // offline and not here: look again once the connection is back
      if (offline) p.then((c) => { if (!c) tokenCards.delete(id); });
    }
    return tokenCards.get(id);
  };

  /** A token the rules engine read from card text, as a card of its own (the shape the engine makes, see _createToken). */
  function tokenFromEffect(e) {
    const [p, t] = String(e.pt || '1/1').split('/');
    const colors = (e.colorWords || []).map(w => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })[String(w).toLowerCase()]).filter(Boolean);
    const subtypes = String(e.subtypes || 'Creature').replace(/\s+creature\s*$/i, '').trim();
    const front = [e.legendary ? 'Legendary' : null, e.snow ? 'Snow' : null].filter(Boolean)
      .concat(['Token'], e.addTypes || [], ['Creature']).join(' ');
    const text = [(e.keywords || []).join(', '), e.grantedText || ''].filter(Boolean).join('\n');
    const name = e.name || subtypes;
    return { name, layout: 'token', mana_cost: '', cmc: 0, type_line: front + ' — ' + subtypes, oracle_text: text,
      colors, color_identity: colors, keywords: e.keywords || [], power: p, toughness: t, image_uris: null, _isToken: true };
  }
  /**
   * The creature tokens a card's own words make, as the rules engine reads
   * them: for a card Scryfall links no tokens to. Drawn, since there is no
   * printing to show.
   */
  function textTokens(card) {
    const words = card.oracle_text || (card.card_faces || []).map(f => f.oracle_text || '').join('\n');
    if (!/\btokens?\b/i.test(words) || !MTG.oracle || !MTG.oracle.analyze) return [];
    const out = [], seen = new Set();
    const visit = (v, depth, path) => {
      if (!v || typeof v !== 'object' || depth > 14 || path.has(v)) return;
      path.add(v);
      if (Array.isArray(v)) for (const x of v) visit(x, depth + 1, path);
      else {
        if (v.op === 'createToken' && v.pt) {
          const c = tokenFromEffect(v);
          const k = [c.name, c.type_line, v.pt, c.colors.join(''), c.oracle_text].join('|');
          if (!seen.has(k)) { seen.add(k); out.push(c); }
        }
        for (const key of Object.keys(v)) if (key !== 'card') visit(v[key], depth + 1, path);
      }
      path.delete(v);
    };
    const faces = card.card_faces && card.card_faces.length > 1 ? card.card_faces.length : 1;
    for (let i = 0; i < faces; i++) {
      let a = null;
      try { a = MTG.oracle.analyze(card, i); } catch (e) { a = null; }
      if (a) visit(a.abilities, 0, new Set());
    }
    return out.slice(0, 6).map(c => ({ card: c, name: c.name, type_line: c.type_line }));
  }

  /**
   * The token a card makes, as a card of its own; with more than one, the
   * arrows (or a tap on the token) go through them. opts.auto: it cannot be
   * touched (a hover preview), so it goes through them by itself.
   */
  function tokenViewer(parts, opts) {
    const n = parts.length, auto = !!(opts && opts.auto);
    let i = 0, ask = 0;
    const face = el('div', { class: 'tok-card' });
    const count = el('span', { class: 'kw-tag tok-count' });
    const name = el('div', { class: 'tok-name' });
    const go = (k) => { i = (k + n) % n; draw(); };
    // keys on the arrows are the viewer's: never the table's Enter (pass) or the pack's Space (flip)
    const nav = (dir, label, glyph) => el('button', {
      type: 'button', class: 'tok-nav', 'aria-label': label, text: glyph,
      onclick: (e) => { e.stopPropagation(); go(i + dir); },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(i + dir); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(i + (e.key === 'ArrowRight' ? 1 : -1)); }
      },
    });
    const draw = () => {
      const part = parts[i], mine = ++ask;
      count.textContent = n > 1 ? `${i + 1} of ${n}` : '';
      // "Token Creature — Saproling" says it all without "Token"; a nameless type line falls back on the name
      const kind = String(part.type_line || '').replace(/^Token\s*/, '').replace(/^—\s*/, '').trim();
      name.textContent = kind && kind.includes(part.name) ? kind : (kind ? `${part.name} · ${kind}` : part.name);
      // a token read from the card's words: drawn, there is no printing of it
      if (part.card) { face.replaceChildren(UI.cardFallback(part.card, 0)); return; }
      face.replaceChildren(el('div', { class: 'tok-wait', text: part.name }));
      tokenCard(part.id).then((c) => {
        if (mine !== ask) return;   // moved on before it came
        face.replaceChildren(c ? UI.cardImage(c, 'normal', 0) : el('div', { class: 'tok-wait', text: part.name }));
      });
    };
    const stage = el('div', { class: 'tok-stage' }, [
      n > 1 && !auto ? nav(-1, 'The token before', '‹') : null,
      face,
      n > 1 && !auto ? nav(1, 'The next token', '›') : null,
    ].filter(Boolean));
    if (n > 1 && !auto) {
      face.setAttribute('role', 'button');
      face.setAttribute('tabindex', '0');
      face.setAttribute('aria-label', 'The next token');
      face.addEventListener('click', (e) => { e.stopPropagation(); go(i + 1); });
      face.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(i + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(i - 1); }
      });
    }
    const box = el('div', { class: 'kw-note tok-view' + (n > 1 && !auto ? ' many' : ''), role: 'group', 'aria-label': 'The tokens it makes' }, [
      el('div', { class: 'kw-name' }, [el('span', { text: n > 1 ? 'Makes these tokens' : (/^Emblem/.test(parts[0].type_line || '') ? 'Makes an emblem' : 'Makes a token') }), count]),
      stage,
      name,
    ]);
    draw();
    if (auto && n > 1) {
      const t = setInterval(() => {
        if (!box.isConnected) { clearInterval(t); return; }
        if (box.offsetParent !== null) go(i + 1);   // only while it can be seen
      }, 1900);
    }
    // the next ones are on their way before they are asked for
    for (const p of parts.slice(1)) if (p.id) tokenCard(p.id);
    return box;
  }

  /** A term's box: its name, and what it does. */
  const termBox = (t) => el('div', { class: 'kw-note' + (t.granted ? ' granted' : '') + (t.kind === 'gc' ? ' gc' : ''), role: 'listitem' }, [
    el('div', { class: 'kw-name' }, [
      el('span', { text: t.name }),
      t.granted ? el('span', { class: 'kw-tag', text: 'gained' }) : null,
    ].filter(Boolean)),
    el('div', { class: 'kw-text', html: MTG.mana.textHtml(t.text) }),
  ]);

  /**
   * The two sides of an enlarged card, the way Arena has them: for its
   * left, a box for each keyword with what it does; for its right, the
   * tokens it makes. Either is null when there is nothing for it, and both
   * are when the player turned them off.
   * opts.keywords: the card's keywords on the table now (see find);
   * opts.auto: nothing here can be clicked (a hover preview).
   * @returns {{ keywords: HTMLElement|null, tokens: HTMLElement|null }}
   */
  UI.cardSides = function (card, opts) {
    if (!card || MTG.settings.keywordHelp === false) return { keywords: null, tokens: null };
    const linked = tokenParts(card);
    const tokens = linked.length ? linked : textTokens(card);
    // a Treasure shown as the token itself needs no box saying what a Treasure is
    const shown = new Set(tokens.map(p => String(p.name || '').toLowerCase()));
    const list = find(card, opts).filter(t => !(shown.has(t.name.toLowerCase()) && (t.kind === 't' || t.kind === 'a')));
    // on Commander's Game Changers list: said first, as Arena puts a card's standing above its keywords
    if (MTG.brackets && MTG.brackets.isGameChanger(card))
      list.unshift({ name: 'Game Changer', kind: 'gc', text: 'On Commander\u2019s Game Changers list. A deck with one to three of these is Bracket 3; with four or more, Bracket 4.' });
    return {
      keywords: list.length ? el('div', { class: 'card-aside kw-side', role: 'list', 'aria-label': 'What its keywords mean' }, list.map(termBox)) : null,
      tokens: tokens.length ? el('div', { class: 'card-aside tok-side' }, [tokenViewer(tokens, opts)]) : null,
    };
  };
  /** Both sides in one column, the tokens first: for room on one side of the card only. Null when both are. */
  UI.stackSides = function (sides) {
    const parts = [sides.tokens, sides.keywords].filter(Boolean);
    return parts.length ? el('div', { class: 'card-aside both' }, parts) : null;
  };
  /**
   * In a preview nobody can scroll or click (a hover preview), keyword
   * boxes past the bottom give way to one line saying how many more there
   * are; opening the card shows them all.
   */
  UI.fitSides = function (root) {
    for (const col of root.querySelectorAll('.card-aside')) {
      if (col.parentElement && col.parentElement.closest('.card-aside')) continue;   // the outer column is the one that clips
      const notes = [...col.querySelectorAll('.kw-note:not(.tok-view)')];
      let hidden = 0, more = null;
      while (col.scrollHeight > col.clientHeight + 1 && notes.length > 1) {
        notes.pop().remove();
        hidden++;
        if (!more) {
          more = el('div', { class: 'kw-more' });
          (col.querySelector('.kw-side') || col).appendChild(more);
        }
        more.textContent = `${hidden} more: open the card to read ${hidden === 1 ? 'it' : 'them all'}`;
      }
    }
  };
  /**
   * Whether there is room for a column either side of an enlarged card: a
   * wide screen, or a phone on its side, whose card is small enough.
   */
  UI.roomForSides = () => U.viewW() >= 1100 || (MTG.isShort() && U.viewW() >= 720);
})(window.MTG);
