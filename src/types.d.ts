/* ============================================================
   types.d.ts - the shapes that cross between engine, table, bots and net

   Not part of the build: tools/build.py bundles only what src/order.json
   lists. This is read by the type check (npx tsc --noEmit, tsconfig.json),
   which checks the table, the net layer and the app against it.

   The same shapes are checked at run time by tools/contracts.js; when one
   changes, change the other. Everything here describes what is sent, so
   fields are optional wherever the engine leaves them out.
   ============================================================ */

declare namespace MTG {
  type Id = string;
  type PlayerId = string;
  type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command';
  type Colour = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

  /* ---------------- cards ---------------- */

  /** A card face as Scryfall gives it (trimmed by MTG.scry.slim). */
  interface CardFace {
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    loyalty?: string;
    defense?: string;
    image_uris?: ImageUris;
    [k: string]: any;
  }
  interface ImageUris { small?: string; normal?: string; large?: string; art_crop?: string; png?: string }
  /** A card: a slimmed Scryfall card, or a token the engine made up. */
  interface Card extends CardFace {
    id?: string | null;
    oracle_id?: string;
    layout?: string;
    cmc?: number;
    color_identity?: string[];
    keywords?: string[];
    card_faces?: CardFace[] | null;
    set?: string;
    rarity?: string;
  }

  /* ---------------- the view ---------------- */

  interface Target { kind: 'object' | 'player' | 'stack'; id: Id }

  /** A card somebody else holds: only that it is there. */
  interface HiddenObjectView { id: Id; hidden: true; owner: PlayerId; zone: ZoneName }

  /** A card or permanent the viewer may see. */
  interface ObjectView {
    id: Id;
    hidden?: undefined;
    cardId: string | null;
    card: Card;
    owner: PlayerId;
    controller: PlayerId;
    zone: ZoneName;
    tapped: boolean;
    faceDown?: boolean | null;
    /** Yedora, Grave Gardener: face down as a land of this basic type rather than a 2/2 */
    faceDownLand?: string;
    /** Kozilek, the Broken Reality: what turning it face up costs (its controller's view only) */
    upCost?: string;
    /** which face is up, for cards with more than one */
    face?: number | null;
    counters: Record<string, number>;
    damage: number;
    summoningSick?: boolean | null;
    attachedTo: Id | null;
    attachments?: Id[];
    isToken?: boolean | null;
    /** the player or permanent it is attacking */
    attacking: Id | null;
    blocking?: Id[];
    blockedBy?: Id[];
    blockOrder?: Id[];
    effects?: Array<{ p?: number; t?: number; until?: string | null; keywords?: string[]; [k: string]: any }>;
    isCommander: boolean;
    /** Oathbreaker: the deck's Signature Spell, which waits in the command zone */
    isSignature?: boolean;
    /** a companion, revealed outside the game beside the command zone ({3} into hand, once a game) */
    companion?: boolean;
    /** prepared: it can cast a copy of its card's spell */
    prepared?: boolean;
    /** a hidden agenda of the viewer's that has not been turned face up */
    agenda?: boolean;
    /** what it chose as it entered */
    chosen?: { type?: string; color?: string; name?: string; player?: string; number?: number; cardType?: string; parity?: string } | null;
    /** Alchemy: what has been done to the card perpetually, added up; null when nothing has */
    perpetual?: {
      pt: [number, number]; keywords: string[]; costDelta: number; text: string[];
      basePt?: [number, number]; lose?: string[]; spendAny?: boolean; types?: string[];
    } | null;
    /** Alchemy: the card's intensity, for a card that has one */
    intensity?: number | null;
    /** layer 3 (CR 612): its rules text now, when a text-changing effect has changed it (Mind Bend; Deadpool, Trading Card) */
    textNow?: string | null;
    /** …and the card as those words make it: the table reads its abilities from this (the engine's indexes) */
    textCard?: Card | null;
    /** banding: attackers with the same band id attack as one band */
    band?: string | null;
    /** soulbond: the id of the creature it is paired with */
    pairedWith?: Id | null;
    /** meld: the names of the two cards a melded permanent is (Gisela and Bruna, as Brisela) */
    melded?: string[];
    note?: string | null;
    /** the turn it entered */
    entered?: number | null;
    /** null for anything that is not a creature right now */
    power: number | null;
    toughness: number | null;
    /** Zilortha, Strength Incarnate: lethal damage to it is determined by its power rather than its toughness */
    lethalByPower?: true;
    keywords: string[];
    /** Autumn Willow: it has shroud, but the viewer may target it this turn */
    shroudOpen?: true;
    /** Yavimaya, Urborg: mana it makes beyond its printed abilities, by the index the mana intent takes */
    manaExtra?: Array<{ i: number; label: string }> | null;
    /** Kibo's Banana, Birds of Paradise: for its controller, each mana ability (by the index the mana intent
        takes) that lets them choose what it adds — each option the key sent as the intent's `choice` ('R', a
        bundle such as 'WW'), and the mana it adds ('{R}', '{W}{W}') */
    manaChoices?: Array<{ i: number; options: Array<{ key: string; mana: string }> }> | null;
    /** Marvin, an Equipment's "has '{T}: …'": abilities beyond its printed ones, for its controller; each by
        the index activateAbility takes, and where its own activated abilities start */
    gained?: { manaBase: number; list: Array<{ i: number; mana?: boolean; ability: any }> } | null;
    /** a card in a hand or on top of a library that others know: 'all' when it was revealed (or the library is
        played revealed), else the players who looked at it. An opponent's card is shown to you only while you know it. */
    seenBy?: 'all' | PlayerId[];
  }
  type AnyObjectView = ObjectView | HiddenObjectView;

  interface StackItemView {
    id: Id;
    kind: 'spell' | 'ability' | 'trigger';
    name: string;
    controller: PlayerId;
    cardId: string | null;
    card: Card | null;
    objId: Id | null;
    /** left out for an item with no targets */
    targets?: Target[];
    abilityText?: string;
    countered: boolean;
    /** a triggered ability (false for a spell or an activated ability) */
    triggered?: boolean;
    /** a spell's or a triggered ability's modes, chosen as it was put on the stack, each mode's words whole
        (left out when it has none); everyone sees them */
    modes?: string[];
    /** one of three or more of the same trigger put on the stack together: the batch's id (its first one's) */
    batch?: Id;
    /** said of a batch's trigger that is optional ("you may"): it can be declined */
    optional?: true;
    /** the face a spell was cast as; null for an ability or a face-down spell */
    face?: number | null;
    /** a spell whose words a text-changing effect changed: what it says now */
    textNow?: string | null;
  }

  interface ManaPoolView { W: number; U: number; B: number; R: number; G: number; C: number }

  interface PlayerView {
    id: PlayerId;
    name: string;
    seat?: number;
    isBot?: boolean;
    botDifficulty?: number;
    /** A bot's style of play: a key of MTG.bots.PERSONALITIES. */
    botPersonality?: string | null;
    /** what the viewer noted while drafting (their own view only) */
    draftNotes?: Record<string, any> | null;
    life: number;
    poison?: number;
    energy?: number;
    experience?: number;
    /** Fallout: rad counters */
    rad?: number;
    pool: ManaPoolView;
    landsPlayed: number;
    maxLands: number;
    hasLost?: boolean;
    hasWon?: boolean;
    lossReason?: string | null;
    /** who or what put them out, where known ("Atraxa (Mira)" for commander damage) */
    lossFrom?: string | null;
    connected?: boolean;
    mulligansTaken: number;
    keptHand: boolean;
    /** how many cards the kept hand still owes to the bottom */
    mulliganBottom: number;
    commanderDamage?: Record<string, number>;
    commanderCasts?: Record<string, number>;
    /** the companion's {3} into hand has been used this game */
    companionUsed?: boolean;
    librarySize: number;
    /** the top of a library, when something lets you see it, or you know that card (revealed, looked at) and it is
        still there; its `seenBy` is 'all' when everybody sees it */
    topCard: ObjectView | null;
    handSize: number;
    /** your own hand in full; everybody else's as hidden objects, but for the cards you know (revealed to you), or all
        of it face up when it is played revealed (Telepathy; Sen Triplets: for the turn, each card `seenBy` 'all').
        A card in it you may cast or play (Sen Triplets) is in the view's `playable` like one of your own. */
    hand: AnyObjectView[];
    /** Sen Triplets: this player can't cast spells or activate abilities (mana abilities too) this turn */
    lockedOut?: true;
    graveyard: ObjectView[];
    exile: ObjectView[];
    command: ObjectView[];
  }

  /** t (when) is missing from entries a guest rebuilds from events */
  interface LogEntry { t?: number; turn: number; type: string; text: string }

  /** Another way to use a card: cycle it, cast it face down, from the graveyard... */
  interface AltUse { kind: string; label: string; via?: string; cost?: string | null; [k: string]: any }
  /** A modal spell's modes, offered as it is cast (CR 601.2b): how many may be chosen, and which can be — `ok` false
      for a mode with nothing it could target (CR 700.2a). `kicked`: the count once kicked ("If this spell was kicked,
      choose any number instead"). `pawprint`: a budget the modes' weights add up to. */
  interface CastModesOffer {
    count: number; min: number; max: number; repeatable?: true; pawprint?: number;
    options: Array<{ i: number; label: string; ok: boolean; weight?: number }>;
    kicked?: { count: number; min: number; max: number };
  }
  /** An extra cost a spell offers as it is cast: kicker, buyback, spree... */
  interface ExtraCost {
    kind: string; label: string; cost?: string | null; modes?: Array<{ i: number; cost?: string; label?: string }>;
    /** an extra cost that is itself a question (replicate, splice), answered in the cast intent's `choices` */
    choose?: ChooseSpec;
    /** convoke, improvise, delve: the objects that could pay (one generic mana each), answered with the cast intent's convokeIds, improviseIds or delveIds */
    candidates?: Id[];
    /** the most of the cost they can pay between them */
    max?: number;
    /** sacForLess (Torgaar, Dargo): the generic mana each one sacrificed (Gorex: each card exiled) takes off */
    each?: number;
    /** a cost the table would otherwise pick (evidence, forage, reveal, behold, blight…): the cast or activate
        option the chosen ids go in (evidenceIds, forageExileIds, revealIds, beholdIds, exileIds, counterFromId, blightId) */
    key?: string;
    /** how many to choose (for evidence, the total mana value wanted), or 'X' for the X paid */
    need?: number | 'X';
    /** forage: the Foods that could be sacrificed instead, answered in `foodKey` (forageFoodId) */
    foods?: Id[];
    foodKey?: string;
    /** Osgir, the Reconstructor: only the candidates with mana value X, the X paid */
    mvX?: boolean;
    /** evidence counted in one colour's mana symbols rather than mana value (Baron Helmut Zemo: 'B') */
    symbol?: string;
    /** remove a counter: the option naming which kind (counterKind) */
    kindKey?: string;
    /** counterSpread (Jetfire, Ingenious Scientist): the kind of counter that comes off the candidates, as many off each as
        the player likes, `need` in all; answered in counterSpreadIds, one id for each counter */
    counterKind?: string;
    [k: string]: any;
  }
  /** The same offer for an activated ability of one of your permanents. */
  interface CostPick extends ExtraCost { index: number; key: string; candidates: Id[] }

  interface GameConfig {
    formatId: string;
    startingLife: number;
    startingHand: number;
    commanderDamage: number | null;
    maxPlayers: number;
    seed: number;
    firstPlayerDraws?: boolean;
    freeMulligans?: number;
    rulesEnforcement?: string;
    autoPass?: Record<string, any>;
    [k: string]: any;
  }

  /** What Game.viewFor(playerId) returns: one player's redacted picture of the game. */
  interface View {
    /** the engine's state version */
    v: number;
    /** whom this view is for ('__watching' for somebody with no seat) */
    you: PlayerId;
    config: GameConfig;
    turn: number;
    phase: string;
    phaseName: string;
    step: string;
    stepName: string;
    activePlayer: PlayerId | null;
    priorityPlayer: PlayerId | null;
    turnOrder: PlayerId[];
    over: boolean;
    winners: PlayerId[] | null;
    mulliganPhase: boolean;
    canUndo: boolean;
    undoLabel: string | null;
    holding: boolean;
    fullControl: boolean;
    fullControlSticky: boolean;
    yielding: 'turn' | 'response' | 'batch' | null;
    /** what you answered once for the rest of the turn or of a batch of triggers (yours alone; the 'auto' intent takes one back) */
    autoAnswers?: AutoAnswerView[];
    /** objects with something to do right now (only for the player with priority) */
    playable: Id[];
    /** split cards in hand, adventurers, modal double-faced cards with a spell on the back: which faces (0 left/front, 1 right/back) can be cast now */
    splitFaces?: Record<Id, number[]>;
    /** split cards with fuse that can be cast with both halves now */
    fusable?: Id[];
    uses: Record<Id, AltUse[]>;
    extras: Record<Id, ExtraCost[]>;
    /** the modes of each modal spell of yours you could cast (spree's are among its extras) */
    castModes?: Record<Id, CastModesOffer>;
    /** your permanents' activated abilities: what could pay the costs the table would otherwise pick */
    costPicks?: Record<Id, CostPick[]>;
    monarch: PlayerId | null;
    initiative: PlayerId | null;
    isDay: boolean | null;
    /** Your own question in full. Somebody else's arrives as a
        WaitingChoice: only type, playerId and waiting: true, so read
        `waiting` before anything else. */
    pendingChoice: Choice | null;
    stack: StackItemView[];
    battlefield: ObjectView[];
    players: PlayerView[];
    log: LogEntry[];
    /** added by the app, not the engine */
    spectating?: boolean;
    match?: MatchView | null;
    /** the game clock, when the table plays with one (src/06e-clock.js) */
    clock?: ClockView | null;
    [k: string]: any;
  }

  /** The host's clock as of a view: each table counts the running time down from here until the next. */
  interface ClockView {
    /** each player's time for the whole game, in ms */
    total: number;
    /** ms left, by player; bots are not on the clock */
    left: Record<PlayerId, number>;
    /** whom the game was waiting on, whose time is running */
    running: PlayerId[];
  }

  interface MatchView {
    gameNumber: number;
    best: number;
    scores: Array<{ id: PlayerId; name: string; wins: number; leading: boolean }>;
    decided: boolean;
    label: string;
  }

  /* ---------------- questions ---------------- */

  interface ChoiceCard { id: Id; name?: string; card?: Card | null }

  /** What every question carries. */
  interface ChoiceBase {
    playerId: PlayerId;
    prompt?: string;
    purpose?: string | null;
    /** set while a resolving effect waits on the answer */
    resumeKey?: string | null;
    /** the card asking, so whoever is asked can see it */
    sourceName?: string | null;
    sourceId?: Id | null;
    sourceCard?: Card | null;
    /** the whole text of the ability asking, never cut short */
    sourceText?: string | null;
    objId?: Id | null;
    stackId?: Id | null;
    /** true when this is somebody else's question (see WaitingChoice) */
    waiting?: boolean;
    /** a question that can be answered for the rest of the turn or of a batch of triggers (the answer's `remember`) */
    auto?: AutoOffer | null;
    /* Read generically by the table before it knows the type; each
       question that has them narrows them. */
    count?: number;
    cards?: ChoiceCard[];
    options?: unknown[];
    /** a price this question offers (or asks about) that the game would pay by sacrificing Treasures and the like */
    sacMana?: SacManaNote;
  }
  interface Defender { kind: 'player' | 'object'; id: Id; name: string }
  type AutoKind = 'may' | 'pay' | 'mode' | 'targets';
  /** What a question says can be answered once for all: an optional trigger's "you may", a price that keeps
      being asked, the modes or targets of the next copies of a trigger. */
  interface AutoOffer {
    kind: AutoKind;
    /** the card asking */
    label: string;
    /** the ability and the question, as a remembered answer knows them */
    key: string;
    /** may be answered for the rest of this turn */
    turn?: true;
    /** the batch it is one of, and how many more of it would take the same answer */
    batchId?: Id;
    rest?: number;
    /** targets: what each target could be for every copy */
    same?: Target[][];
  }
  interface AutoAnswerView { id: string; kind: AutoKind; text: string; batch?: Id }

  interface DeclareAttackersChoice extends ChoiceBase { type: 'declareAttackers'; candidates: Id[]; defenders: Defender[] }
  interface DeclareBlockersChoice extends ChoiceBase { type: 'declareBlockers'; attackers: Id[]; candidates: Id[]; /** Odric, Master Tactician: whose creatures these are, when someone else chooses how they block */ blockingPlayer?: Id }
  /** differentNames: no two of the cards discarded may share a name (Ormos, Archive Keeper). */
  interface DiscardChoice extends ChoiceBase { type: 'discard' | 'discardToHandSize'; count: number; candidates?: Id[]; optional?: boolean; differentNames?: boolean }
  interface SacrificeChoice extends ChoiceBase { type: 'sacrifice'; count: number; filter?: string | null; candidates?: Id[]; optional?: boolean; /** Doomfall: the chosen permanent is exiled, not sacrificed */ exileInstead?: boolean }
  interface ScryChoice extends ChoiceBase { type: 'scry' | 'surveil'; count: number; cards: ChoiceCard[] }
  interface ArrangeChoice extends ChoiceBase { type: 'arrange'; count?: number; cards: ChoiceCard[]; look?: boolean }
  /** `ids`: the same trigger more than once, put in as one, side by side (their order can't matter) */
  interface OrderTriggersChoice extends ChoiceBase { type: 'orderTriggers'; cards: Array<{ id: Id; name?: string; card?: Card | null; ids?: Id[] }> }
  interface PickCardChoice extends ChoiceBase {
    type: 'pickCard'; count: number; cards: ChoiceCard[]; optional?: boolean; candidates?: Id[];
    fromLibrary?: boolean; worst?: boolean; totalPower?: number;
    /** purpose 'tapCost': what the tapping pays for, when that matters (Agent Maria Hill: 'teamwork') */
    why?: string | null;
  }
  interface PickTargetChoice extends ChoiceBase {
    type: 'pickTarget'; specs: Array<Record<string, any>>; options: Target[][]; count: number;
    /** a triggered ability going on the stack (purpose 'triggerTargets'): the effect each target is for, for the bots */
    aimedBy?: Array<Record<string, any>>;
    /** purpose 'otherTarget' (Diaochan, Artful Beauty: "target creature of an opponent's choice"): the player
        activating the ability this target is for, where it goes among its targets, and what it does to it */
    activator?: Id; at?: number; op?: string | null; objId?: Id; abilityIndex?: number; actOpts?: Record<string, any>;
  }
  interface ModeChoice extends ChoiceBase {
    /** an option that is a card's name (Pithing Needle's) carries the card, to be shown on hover */
    type: 'mode'; count: number; options: Array<{ i: number; label: string; card?: Card | null }>; repeatable?: boolean;
    values?: any[]; types?: string[]; colors?: string[]; field?: string; castOpts?: Record<string, any>;
    /** "choose a card name": any card's name may be typed in as well (the answer's `name`) */
    nameAny?: NameWanted | null;
  }
  /** What a card named in answer to "choose a nonland card name" must be. Only the names a player can see or
      knows of are offered (never a card hidden from them); any other is typed in, and checked when the card is known. */
  interface NameWanted { nonland?: boolean; nonartifact?: boolean; creature?: boolean }
  /** What the game would sacrifice for mana to pay a price for you (Treasures and the like), said in the question
      that offers it or asks about it: their ids, how many, and the words ("2 Treasures and a Gold token"). Only
      the player asked sees it, as with the rest of their question. */
  interface SacManaNote { ids: Id[]; n: number; text: string }
  /** What a 'sacMana' question does again once you say yes: a cast, an activation, an attack or another action
      paid for by the game, as it was asked for. */
  interface SacManaRedo { kind: string; objId?: Id; index?: number; declarations?: AttackDeclaration[]; opts: Record<string, any> }
  interface ConfirmChoice extends ChoiceBase {
    type: 'confirm'; life?: number; yesLabel?: string; noLabel?: string;
    /** the mana a "pay it?" question offers to pay */
    payMana?: string;
    /** purpose 'sacMana' ("Sacrifice 3 Treasures to cast Lightning Bolt?"): what a yes does again */
    redo?: SacManaRedo;
  }
  /** The table shows a mana cost (a string) or { life }. */
  interface PayOrDontChoice extends ChoiceBase { type: 'payOrDont'; cost: string | { life: number } | { energy: number }; life?: number; energy?: number }
  interface PayOrCounterChoice extends ChoiceBase { type: 'payOrCounter'; cost: string; stackId: Id }
  interface RiotChoice extends ChoiceBase { type: 'riot'; objId: Id }
  interface VoteChoice extends ChoiceBase { type: 'vote'; options: string[] }
  /** A constraint on what the picks of a 'choose' question add up to. */
  type ChooseConstraint =
    | { kind: 'distinct'; key?: string; reason?: string; label?: string }
    | { kind: 'distinctTypes'; key?: string; reason?: string; label?: string }
    | { kind: 'unionAtLeast'; key?: string; min: number; reason?: string; label?: string }
    | { kind: 'sum'; key: string; min?: number; max?: number; reason?: string; label?: string }
    | { kind: 'shareColour'; with?: string[]; reason?: string; label?: string }
    | { kind: 'mana'; key?: string; base?: string; reason?: string; label?: string };

  /** What a generic question asks, before it is put to anybody. */
  interface ChooseSpec {
    purpose?: string | null;
    kind: 'objects' | 'players' | 'options' | 'number';
    items?: Array<{ id: Id; name?: string; card?: Card | null; [k: string]: any }> | null;
    options?: Array<{ label: string; i?: number; cost?: string; card?: Card | null; weight?: number; ids?: string[]; cards?: Array<Card | null>; [k: string]: any }> | null;
    number?: { min: number; max: number; step: number };
    min?: number;
    max?: number;
    optional?: boolean;
    constraints?: ChooseConstraint[];
    /** a card name may be typed in, besides the names offered (the answer's `name`) */
    nameAny?: NameWanted | null;
    [k: string]: any;
  }

  /** The answer to a generic question: ids or option indexes, a number, or the picks in order; or, where a card
      name may be typed in (nameAny), the name. */
  interface ChooseAnswer { picks?: Array<Id | number>; number?: number; order?: Array<Id | number>; name?: string }

  /** The general question (src/06a-choice.js, docs/choices.md), as normalize() leaves it. */
  interface ChooseChoice extends ChoiceBase {
    type: 'choose';
    kind: 'objects' | 'players' | 'options' | 'number';
    /** objects or players to pick from (their ids are the picks) */
    items?: Array<{ id: Id; name?: string; card?: Card | null; [k: string]: any }> | null;
    /** options to pick from (their indexes are the picks) */
    options?: Array<{ label: string; i?: number; cost?: string; card?: Card | null; weight?: number; ids?: string[]; cards?: Array<Card | null>; [k: string]: any }> | null;
    number?: { min: number; max: number; step: number };
    min?: number;
    max?: number;
    optional?: boolean;
    repeat?: boolean;
    ordered?: boolean;
    constraints?: ChooseConstraint[];
    /** "choose a card name": any card's name may be typed in as well (the answer's `name`) */
    nameAny?: NameWanted | null;
    /** a question asked while casting starts the cast again with the answer */
    then?: { kind: 'cast'; objId: Id; opts: Record<string, any> };
    zone?: string;
    reveal?: boolean;
    panel?: boolean;
    compact?: boolean;
    prefer?: 'best' | 'worst' | 'min' | string;
    harmful?: boolean;
    default?: number;
    noneLabel?: string;
    confirmLabel?: string;
  }

  /** Every question the engine can put to a player, by type. */
  type Choice =
    | DeclareAttackersChoice | DeclareBlockersChoice | DiscardChoice | SacrificeChoice | ScryChoice
    | ArrangeChoice | OrderTriggersChoice | PickCardChoice | PickTargetChoice | ModeChoice | ConfirmChoice
    | PayOrDontChoice | PayOrCounterChoice | RiotChoice | VoteChoice | ChooseChoice;
  type ChoiceType = Choice['type'];

  /** What everybody else sees of somebody's question. */
  interface WaitingChoice { type: ChoiceType; playerId: PlayerId; waiting: true }

  /** The data of a 'choice' intent: an answer, whose fields depend on the question
      (picks, number and order are the answer to a 'choose' question). */
  interface ChoiceAnswer extends ChooseAnswer {
    yes?: boolean;
    pay?: boolean;
    haste?: boolean;
    choice?: string;
    modes?: number[];
    cardIds?: Id[];
    cardId?: Id;
    top?: Id[];
    bottom?: Id[];
    targets?: Target[];
    /** this answer goes for the rest of the turn ('turn') or of the batch ('batch'), as the question's `auto` offered */
    remember?: 'turn' | 'batch';
  }

  /* ---------------- intents ---------------- */

  interface AttackDeclaration { attackerId: Id; defenderId: Id; /** banding: attackers given the same label attack as one band */ band?: string;
    /** enlist (CR 702.154): the creature tapped for this attacker's enlist, null for none; left out, the engine asks */ enlist?: Id | null }
  interface BlockDeclaration { blockerId: Id; attackerIds: Id[] }

  type Intent =
    | { kind: 'pass' }
    | { kind: 'hold'; on: boolean }
    | { kind: 'undo' }
    | { kind: 'autoPass'; cfg: Record<string, any> | null }
    | { kind: 'fullControl'; on: boolean; sticky?: boolean }
    | { kind: 'yield'; mode: 'turn' | 'response' | 'batch' | null }
    /** remembered answers: take one back (by id, or 'all'), or decline the rest of a batch of your optional triggers */
    | { kind: 'auto'; act: 'clear' | 'decline'; id?: string; batch?: Id }
    | { kind: 'mulligan' }
    | { kind: 'keep'; bottom?: Id[] }
    /** objId: a card in your hand, or in another player's when the game gives leave (Sen Triplets); 14-app.js turns away the rest */
    | { kind: 'playLand'; objId: Id; face?: number }
    | { kind: 'cycle'; objId: Id; channel?: boolean; targets?: Target[]; x?: number }
    | { kind: 'suspend'; objId: Id; x?: number }
    | { kind: 'plot' | 'foretell' | 'transmute' | 'encore' | 'turnFaceUp' | 'companion'; objId: Id }
    | {
      kind: 'cast'; objId: Id; targets?: Target[]; free?: boolean; kick?: number; buyback?: boolean; entwine?: boolean;
      offspring?: boolean; squad?: number; casualty?: boolean; spree?: number[]; via?: string | null; x?: number; returnId?: Id;
      /** a modal spell's modes, chosen as it is cast (indexes into its modes, in any order; a mode it may choose again,
          again): left out, the engine takes the only choice there is or asks, then asks the targets of those modes */
      modes?: number[];
      /** what pays for convoke, improvise and delve (left out, the engine picks the cheapest) */
      convokeIds?: Id[]; improviseIds?: Id[]; delveIds?: Id[];
      /** Torgaar, Dargo: the permanents sacrificed for a cheaper spell (Gorex, the Tombshell: the graveyard cards exiled; an empty list: none); left out, the engine picks */
      sacrificeIds?: Id[];
      /** a split card's half to cast: 0 left, 1 right */
      face?: number;
      /** cast both halves of a split card with fuse (targets: the left half's, then the right's) */
      fuse?: boolean;
      /** generic questions answered as the spell is cast (replicate, splice), by purpose */
      choices?: Record<string, ChooseAnswer>;
      /** what pays a cost the table would otherwise pick */
      evidenceIds?: Id[]; forageExileIds?: Id[]; revealIds?: Id[]; beholdIds?: Id[]; exileIds?: Id[]; forageFoodId?: Id; counterFromId?: Id; blightId?: Id; counterKind?: string;
      /** Jetfire, Ingenious Scientist: the permanents the counters come off, one id for each counter */
      counterSpreadIds?: Id[];
      /** paid only from the mana in the pool, no lands tapped for it (tapping lands by hand) */
      fromPool?: boolean;
    }
    | { kind: 'activate'; objId: Id; index: number; targets?: Target[]; fromPool?: boolean; sacrificeIds?: Id[]; discardIds?: Id[]; x?: number; manaSplit?: number | string[]; evidenceIds?: Id[]; forageExileIds?: Id[]; revealIds?: Id[]; beholdIds?: Id[]; exileIds?: Id[]; forageFoodId?: Id; counterFromId?: Id; blightId?: Id; counterKind?: string; counterSpreadIds?: Id[] }
    | { kind: 'mana'; objId: Id; index?: number; choice?: string | null; split?: string[] }
    | { kind: 'declareAttackers'; declarations: AttackDeclaration[] }
    | { kind: 'declareBlockers'; declarations: BlockDeclaration[] }
    | { kind: 'choice'; data: ChoiceAnswer }
    | { kind: 'concede' }
    | { kind: 'leave' }
    | { kind: 'profile'; name?: string; avatar?: string | null; sleeve?: any; frame?: string | null }
    | {
      kind: 'manual'; action: string; objId?: Id | null; zone?: ZoneName; toBottom?: boolean; kind2?: string; n?: number;
      hostId?: Id | null; token?: Record<string, any>; text?: string; sides?: number;
    }
    | { kind: 'chat'; text: string }
    | { kind: 'setDeck'; deck: Record<string, any>; name?: string }
    /* the draft */
    /** mods: cards spent on the first card taken (Cogwork Grinder, Noble Banneret); guess: Spire Phantasm's */
    | { kind: 'pick'; cardIds: Id[]; ability?: string | null; mods?: Id[]; guess?: string | null }
    | { kind: 'draftOffer'; cardId: Id; yes: boolean }
    /** the rest of what draft cards do: peek, watch, answer, brokerReveal, brokerOffer, brokerAccept (MTG.draft.Draft#act) */
    | { kind: 'draftAct'; act: string; cardId?: Id | null; which?: string; targetId?: Id; askId?: number; value?: string; yes?: boolean }
    /** Jumpstart: take one of the three half-decks offered (pick), or play the deck the two make (ready) (src/13b-ui-sealed.js) */
    | { kind: 'jumpstart'; pick?: number; ready?: boolean };
  type IntentKind = Intent['kind'];

  /* ---------------- net messages ---------------- */

  /** A piece of a message too long for one data-channel send. */
  interface NetChunk { t: '~'; id: number; i: number; n: number; d: string; seq?: number }

  /** What a guest sends the host. */
  type NetToHost = (
    | { t: 'hello'; payload: { name?: string; token?: string; autoPass?: Record<string, any> | null } }
    | { t: 'intent'; payload: Intent }
    | { t: 'chat'; payload: { from?: string; text: string } }
    | { t: 'pong' }
    /** the guest has view n of the sync stream (09b-sync.js), or needs a whole view */
    | { t: 'ack'; n: number }
    | { t: 'resync' }
  ) & { seq?: number };

  /** What the host sends a guest. */
  type NetToGuest = (
    | { t: 'welcome'; code: string; yourId: string }
    | { t: 'lobby'; payload: { members: Array<Record<string, any>>; [k: string]: any } }
    | { t: 'state'; payload: View }
    | SyncViewMessage
    | { t: 'draft'; payload: Record<string, any> }
    /** sealed: the packs a guest opens; Jumpstart: what a guest is offered and has taken (src/13b-ui-sealed.js) */
    | { t: 'sealed'; payload: Record<string, any> }
    | { t: 'jumpstart'; payload: Record<string, any> }
    | { t: 'chat'; payload: { from: string; text: string; at: number } }
    | { t: 'log'; payload: LogEntry | Record<string, any> }
    | { t: 'error'; payload: string }
    | { t: 'kick'; payload: any }
    | { t: 'ping' }
    /** a friends tournament's match: which one this table is (src/10i-ui-tourney.js), checked by the guest against its own copy */
    | { t: 'tourney:table'; id: string; r: number; tb: number; host: string }
  ) & { seq?: number };

  type NetMessage = NetToHost | NetToGuest | NetChunk;

  /**
   * A game view on its way to a guest (09b-sync.js): either the whole view
   * (s) or a difference (p) from view b, which the guest has acknowledged.
   * Cards travel once each, in c, and are replaced by keys in s and p.
   */
  interface SyncViewMessage {
    t: 'sv';
    /** which game */
    g: string;
    /** this view's number for this guest */
    n: number;
    /** the view this is a difference from */
    b?: number;
    p?: any;
    s?: Record<string, any>;
    c?: Record<string, Card>;
    /** events since the last message */
    e?: Array<Record<string, any>> | null;
    es?: number | null;
    /** the log, with whole views only */
    l?: LogEntry[];
  }

  /* ---------------- the runtime namespace (window.MTG) ---------------- */

  interface Emitter {
    /** returns a function that unsubscribes */
    on(name: string, fn: (...args: any[]) => void): () => void;
    once(name: string, fn: (...args: any[]) => void): () => void;
    off(name: string, fn: (...args: any[]) => void): void;
    emit(name: string, ...args: any[]): void;
  }

  interface Net extends Emitter {
    /** 'offline' | 'host' | 'client' */
    mode: string;
    readonly isHost: boolean;
    readonly isClient: boolean;
    readonly online: boolean;
    roomCode: string | null;
    selfId: string | null;
    members: Array<Record<string, any>>;
    host(opts?: { code?: string }): Promise<string>;
    join(code: string, hello?: Record<string, any>): Promise<void>;
    send(peerId: string | null, msg: NetToHost | NetToGuest | Record<string, any>): void;
    broadcast(msg: NetToGuest): void;
    sendPerPeer(fn: (peerId: string) => NetToGuest | null): void;
    intent(payload: Intent): void;
    chat(from: string, text: string): void;
    destroy(): void;
    peerAvailable?: () => boolean;
    [k: string]: any;
  }

  /** The game engine's Game, as far as the table and app use it. */
  interface Game extends Emitter {
    stateVersion: number;
    turn: number;
    over: boolean;
    winners: PlayerId[];
    pendingChoice: Choice | null;
    viewFor(playerId: PlayerId): View;
    resolveChoice(playerId: PlayerId, data: ChoiceAnswer): boolean;
    [k: string]: any;
  }

  /** The table: an instance of MTG.ui.Table. Methods are shared across 12-ui-table*.js. */
  interface TableInstance {
    root: HTMLElement;
    meId: PlayerId;
    send: (intent: Intent) => void;
    /** what is on screen */
    view: View | null;
    /** the newest view to arrive */
    live: View | null;
    queue: View[];
    me: PlayerView | null;
    targeting: null | {
      need: number; specs: Array<Record<string, any>>; chosen: Target[]; legal?: Set<string> | null;
      label?: string; source?: Id | null; cardName?: string; spell?: boolean; onDone: (targets: Target[]) => void; [k: string]: any;
    };
    attackPlan: null | { declarations: AttackDeclaration[]; defenderId?: Id; [k: string]: any };
    blockPlan: null | { declarations: BlockDeclaration[]; pendingBlocker?: Id | null; [k: string]: any };
    update(view: View): void;
    render(): void;
    destroy(): void;
    [k: string]: any;
  }
  interface TableClass {
    new (root: HTMLElement, meId: PlayerId, send: (intent: Intent) => void): TableInstance;
    prototype: TableInstance;
    helpers: Record<string, any>;
  }

  interface UINamespace {
    Table: TableClass;
    toast(msg: string, kind?: string, ms?: number): any;
    error(msg: string): any;
    ok(msg: string): any;
    [k: string]: any;
  }

  interface Namespace {
    version: string;
    DEBUG: boolean;
    el(tag: string, attrs?: Record<string, any> | null, children?: any): HTMLElement;
    $(sel: string, root?: ParentNode): any;
    $$(sel: string, root?: ParentNode): any[];
    util: Record<string, any>;
    Emitter: { new (): Emitter };
    bus: Emitter;
    settings: Record<string, any>;
    setSetting(k: string, v: any): void;
    saveSettings(): void;
    sfx(name: string, opts?: Record<string, any>): void;
    autoPassConfig(): Record<string, any>;
    net: Net;
    ui: UINamespace;
    rules: { Game: { new (config: Record<string, any>): Game; [k: string]: any }; [k: string]: any };
    scry: Record<string, any>;
    mana: Record<string, any>;
    oracle: Record<string, any>;
    formats: Record<string, any>;
    bots: Record<string, any>;
    choice?: Record<string, any>;
    app?: Record<string, any>;
    [k: string]: any;
  }
}

/* The table keeps its own bookkeeping on the elements it builds
   (node._built, node._hint, ...), as plain expando properties. */
interface HTMLElement { [k: string]: any }
interface ChildNode { [k: string]: any }
/* Event handlers read e.target as the element it is. */
interface EventTarget { [k: string]: any }

interface Window {
  MTG: MTG.Namespace;
  /** PeerJS, loaded from a CDN */
  Peer?: any;
}

/* The table's methods live in three files, each adding to MTG.ui.Table's
   prototype with Object.assign; this gives those methods the table as
   `this`. */
interface ObjectConstructor {
  assign(target: MTG.TableInstance, source: ThisType<MTG.TableInstance> & Record<string, any>): MTG.TableInstance;
  /* An intent put together with Object.assign({ kind: 'cast', ... }, extra)
     keeps its kind as the literal it is, so it can be checked as an Intent. */
  assign<const T extends { kind: MTG.IntentKind }, U>(target: T, source: U): T & U;
}
