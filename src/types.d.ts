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
    note?: string | null;
    /** the turn it entered */
    entered?: number | null;
    /** null for anything that is not a creature right now */
    power: number | null;
    toughness: number | null;
    keywords: string[];
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
  }

  interface ManaPoolView { W: number; U: number; B: number; R: number; G: number; C: number }

  interface PlayerView {
    id: PlayerId;
    name: string;
    seat?: number;
    isBot?: boolean;
    botDifficulty?: number;
    life: number;
    poison?: number;
    energy?: number;
    experience?: number;
    pool: ManaPoolView;
    landsPlayed: number;
    maxLands: number;
    hasLost?: boolean;
    hasWon?: boolean;
    lossReason?: string | null;
    connected?: boolean;
    mulligansTaken: number;
    keptHand: boolean;
    /** how many cards the kept hand still owes to the bottom */
    mulliganBottom: number;
    commanderDamage?: Record<string, number>;
    commanderCasts?: Record<string, number>;
    librarySize: number;
    /** the top of your own library, when something lets you see it */
    topCard: ObjectView | null;
    handSize: number;
    /** your own hand in full; everybody else's as hidden objects */
    hand: AnyObjectView[];
    graveyard: ObjectView[];
    exile: ObjectView[];
    command: ObjectView[];
  }

  /** t (when) is missing from entries a guest rebuilds from events */
  interface LogEntry { t?: number; turn: number; type: string; text: string }

  /** Another way to use a card: cycle it, cast it face down, from the graveyard... */
  interface AltUse { kind: string; label: string; via?: string; cost?: string | null; [k: string]: any }
  /** An extra cost a spell offers as it is cast: kicker, buyback, spree... */
  interface ExtraCost {
    kind: string; label: string; cost?: string | null; modes?: Array<{ i: number; cost?: string; label?: string }>;
    /** an extra cost that is itself a question (replicate, splice), answered in the cast intent's `choices` */
    choose?: ChooseSpec;
    [k: string]: any;
  }

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
    yielding: 'turn' | 'response' | null;
    /** objects with something to do right now (only for the player with priority) */
    playable: Id[];
    uses: Record<Id, AltUse[]>;
    extras: Record<Id, ExtraCost[]>;
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
    [k: string]: any;
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
    objId?: Id | null;
    stackId?: Id | null;
    /** true when this is somebody else's question (see WaitingChoice) */
    waiting?: boolean;
    /* Read generically by the table before it knows the type; each
       question that has them narrows them. */
    count?: number;
    cards?: ChoiceCard[];
    options?: unknown[];
  }
  interface Defender { kind: 'player' | 'object'; id: Id; name: string }

  interface DeclareAttackersChoice extends ChoiceBase { type: 'declareAttackers'; candidates: Id[]; defenders: Defender[] }
  interface DeclareBlockersChoice extends ChoiceBase { type: 'declareBlockers'; attackers: Id[]; candidates: Id[] }
  interface DiscardChoice extends ChoiceBase { type: 'discard' | 'discardToHandSize'; count: number; candidates?: Id[]; optional?: boolean }
  interface SacrificeChoice extends ChoiceBase { type: 'sacrifice'; count: number; filter?: string | null; candidates?: Id[]; optional?: boolean }
  interface ScryChoice extends ChoiceBase { type: 'scry' | 'surveil'; count: number; cards: ChoiceCard[] }
  interface ArrangeChoice extends ChoiceBase { type: 'arrange'; count?: number; cards: ChoiceCard[]; look?: boolean }
  interface OrderTriggersChoice extends ChoiceBase { type: 'orderTriggers'; cards: Array<{ id: Id; name?: string; card?: Card | null }> }
  interface PickCardChoice extends ChoiceBase {
    type: 'pickCard'; count: number; cards: ChoiceCard[]; optional?: boolean; candidates?: Id[];
    fromLibrary?: boolean; worst?: boolean; totalPower?: number;
  }
  interface PickTargetChoice extends ChoiceBase { type: 'pickTarget'; specs: Array<Record<string, any>>; options: Target[][]; count: number }
  interface ModeChoice extends ChoiceBase {
    type: 'mode'; count: number; options: Array<{ i: number; label: string }>; repeatable?: boolean;
    values?: any[]; types?: string[]; colors?: string[]; field?: string; castOpts?: Record<string, any>;
  }
  interface ConfirmChoice extends ChoiceBase { type: 'confirm'; life?: number }
  /** The table shows a mana cost (a string) or { life }. */
  interface PayOrDontChoice extends ChoiceBase { type: 'payOrDont'; cost: string | { life: number } | { energy: number }; life?: number; energy?: number }
  interface PayOrCounterChoice extends ChoiceBase { type: 'payOrCounter'; cost: string; stackId: Id }
  interface RiotChoice extends ChoiceBase { type: 'riot'; objId: Id }
  interface VoteChoice extends ChoiceBase { type: 'vote'; options: string[] }
  /** A constraint on what the picks of a 'choose' question add up to. */
  type ChooseConstraint =
    | { kind: 'distinct'; key?: string; reason?: string; label?: string }
    | { kind: 'sum'; key: string; min?: number; max?: number; reason?: string; label?: string }
    | { kind: 'shareColour'; with?: string[]; reason?: string; label?: string }
    | { kind: 'mana'; key?: string; base?: string; reason?: string; label?: string };

  /** What a generic question asks, before it is put to anybody. */
  interface ChooseSpec {
    purpose?: string | null;
    kind: 'objects' | 'players' | 'options' | 'number';
    items?: Array<{ id: Id; name?: string; card?: Card | null; [k: string]: any }> | null;
    options?: Array<{ label: string; i?: number; cost?: string; card?: Card | null; weight?: number; [k: string]: any }> | null;
    number?: { min: number; max: number; step: number };
    min?: number;
    max?: number;
    optional?: boolean;
    constraints?: ChooseConstraint[];
    [k: string]: any;
  }

  /** The answer to a generic question: ids or option indexes, a number, or the picks in order. */
  interface ChooseAnswer { picks?: Array<Id | number>; number?: number; order?: Array<Id | number> }

  /** The general question (src/06a-choice.js, docs/choices.md), as normalize() leaves it. */
  interface ChooseChoice extends ChoiceBase {
    type: 'choose';
    kind: 'objects' | 'players' | 'options' | 'number';
    /** objects or players to pick from (their ids are the picks) */
    items?: Array<{ id: Id; name?: string; card?: Card | null; [k: string]: any }> | null;
    /** options to pick from (their indexes are the picks) */
    options?: Array<{ label: string; i?: number; cost?: string; card?: Card | null; weight?: number; [k: string]: any }> | null;
    number?: { min: number; max: number; step: number };
    min?: number;
    max?: number;
    optional?: boolean;
    repeat?: boolean;
    ordered?: boolean;
    constraints?: ChooseConstraint[];
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
  }

  /* ---------------- intents ---------------- */

  interface AttackDeclaration { attackerId: Id; defenderId: Id }
  interface BlockDeclaration { blockerId: Id; attackerIds: Id[] }

  type Intent =
    | { kind: 'pass' }
    | { kind: 'hold'; on: boolean }
    | { kind: 'undo' }
    | { kind: 'autoPass'; cfg: Record<string, any> | null }
    | { kind: 'fullControl'; on: boolean; sticky?: boolean }
    | { kind: 'yield'; mode: 'turn' | 'response' | null }
    | { kind: 'mulligan' }
    | { kind: 'keep'; bottom?: Id[] }
    | { kind: 'playLand' | 'cycle' | 'plot' | 'suspend' | 'transmute' | 'encore' | 'turnFaceUp'; objId: Id }
    | {
      kind: 'cast'; objId: Id; targets?: Target[]; free?: boolean; kick?: number; buyback?: boolean; entwine?: boolean;
      offspring?: boolean; squad?: number; casualty?: boolean; spree?: number[]; via?: string | null; x?: number;
      /** generic questions answered as the spell is cast (replicate, splice), by purpose */
      choices?: Record<string, ChooseAnswer>;
    }
    | { kind: 'activate'; objId: Id; index: number; targets?: Target[]; sacrificeIds?: Id[]; discardIds?: Id[] }
    | { kind: 'mana'; objId: Id; index?: number; choice?: string | null }
    | { kind: 'declareAttackers'; declarations: AttackDeclaration[] }
    | { kind: 'declareBlockers'; declarations: BlockDeclaration[] }
    | { kind: 'choice'; data: ChoiceAnswer }
    | { kind: 'concede' }
    | {
      kind: 'manual'; action: string; objId?: Id | null; zone?: ZoneName; toBottom?: boolean; kind2?: string; n?: number;
      hostId?: Id | null; token?: Record<string, any>; text?: string; sides?: number;
    }
    | { kind: 'chat'; text: string }
    | { kind: 'setDeck'; deck: Record<string, any>; name?: string }
    /* the draft */
    | { kind: 'pick'; cardIds: Id[]; ability?: string | null }
    | { kind: 'draftOffer'; cardId: Id; yes: boolean }
    | { kind: 'draftExile'; cardId: Id; targetId: Id }
    | { kind: 'draftPeek'; cardId: Id; which?: number };
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
    | { t: 'draftPeek'; payload: any }
    | { t: 'chat'; payload: { from: string; text: string; at: number } }
    | { t: 'log'; payload: LogEntry | Record<string, any> }
    | { t: 'error'; payload: string }
    | { t: 'kick'; payload: any }
    | { t: 'ping' }
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
      label?: string; source?: Id | null; cardName?: string; onDone: (targets: Target[]) => void; [k: string]: any;
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
