/* Runtime contract checks for the boundaries between the engine, the
   table, the bots and the network.

   node tools/contracts.js [--quick] [--games N] [--seed S] [--selftest]

   The engine hands the table a view (Game.viewFor) and, now and then, a
   question (pendingChoice); the table and the bots answer with intents
   and engine calls; the host and its guests pass both along inside net
   messages. Each of those is a promise about shape: which fields are
   there, what they hold, and what has to agree with what. This file
   writes those promises down as small validators, and can watch a live
   game to see that they are kept:

     watch(g, MTG)  checks every view (for every seat and for a watcher),
                    every question as it is asked, and every call a bot
                    or runner makes into the engine, with the call turned
                    into the intent the table would have sent for it. Each
                    view also goes through the real net code (09-net.js)
                    over a loopback connection, chunked and stitched back,
                    and has to arrive unchanged.

   Run on its own it plays a few games of each kind with watch() on and
   reports what broke. tools/sim.js and tools/botsim.js take --contracts
   to do the same during their own games. The shapes are also written
   out as types in src/types.d.ts; the two should be kept in step.

   A violation reads: rule, where (a path into the value), what was
   wrong, and the game context it happened in. Known, already reported
   problems are listed in KNOWN with the reason they are still there;
   they are counted but do not fail the run. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ============================================================
   A small schema language. A schema is a function (value, path, out)
   that pushes { path, msg } for everything wrong with the value.
   ============================================================ */
const show = (v) => {
  let s;
  try { s = JSON.stringify(v); } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
};
const prim = (name, test) => (v, p, out) => { if (!test(v)) out.push({ path: p, msg: `wanted ${name}, got ${show(v)}` }); };

const S = {
  any: () => {},
  str: prim('a string', v => typeof v === 'string'),
  id: prim('an id (a non-empty string)', v => typeof v === 'string' && v.length > 0),
  num: prim('a finite number', v => typeof v === 'number' && isFinite(v)),
  int: prim('an integer', v => Number.isInteger(v)),
  nat: prim('a whole number of 0 or more', v => Number.isInteger(v) && v >= 0),
  bool: prim('true or false', v => typeof v === 'boolean'),
  nul: prim('null', v => v === null),
  plainObj: prim('an object', v => v !== null && typeof v === 'object' && !Array.isArray(v)),
  lit: (...vals) => prim('one of ' + vals.map(show).join(', '), v => vals.includes(v)),
  /** May be missing (undefined), otherwise must match. */
  opt: (s) => (v, p, out) => { if (v !== undefined) s(v, p, out); },
  /** May be missing or null. */
  maybe: (s) => (v, p, out) => { if (v !== undefined && v !== null) s(v, p, out); },
  arr: (s, o) => (v, p, out) => {
    if (!Array.isArray(v)) { out.push({ path: p, msg: `wanted an array, got ${show(v)}` }); return; }
    if (o && o.min != null && v.length < o.min) out.push({ path: p, msg: `wanted at least ${o.min} entries, got ${v.length}` });
    for (let i = 0; i < v.length; i++) s(v[i], `${p}[${i}]`, out);
  },
  rec: (s) => (v, p, out) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { out.push({ path: p, msg: `wanted an object, got ${show(v)}` }); return; }
    for (const k of Object.keys(v)) s(v[k], `${p}.${k}`, out);
  },
  /** An object with these fields. `closed` objects may carry nothing else. */
  obj: (fields, o) => (v, p, out) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { out.push({ path: p, msg: `wanted an object, got ${show(v)}` }); return; }
    for (const k of Object.keys(fields)) fields[k](v[k], `${p}.${k}`, out);
    if (o && o.closed) for (const k of Object.keys(v)) if (!(k in fields)) out.push({ path: `${p}.${k}`, msg: 'is not a field this takes (it would be dropped on the way)' });
  },
  /** Passes if any of the alternatives passes. */
  either: (name, ...alts) => (v, p, out) => {
    for (const a of alts) { const o = []; a(v, p, o); if (!o.length) return; }
    out.push({ path: p, msg: `wanted ${name}, got ${show(v)}` });
  },
  /** A tagged union: the tag field picks the schema. */
  union: (tag, map, name) => (v, p, out) => {
    if (v === null || typeof v !== 'object') { out.push({ path: p, msg: `wanted ${name}, got ${show(v)}` }); return; }
    const s = map[v[tag]];
    if (!s) { out.push({ path: `${p}.${tag}`, msg: `${show(v[tag])} is not a known ${name} ${tag}` }); return; }
    s(v, p, out);
  },
};
const { str, id, num, int, nat, bool, opt, maybe, arr, rec, obj, lit, either, union } = S;

/* ============================================================
   The shapes
   ============================================================ */
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack', 'command'];
const Zone = lit(...ZONES);
const Target = obj({ kind: lit('object', 'player', 'stack'), id });
/* A card as Scryfall's slim() leaves it, or a token the engine made up.
   Open: the table reads many more fields, all optional. */
const Card = obj({
  id: maybe(str), name: str, type_line: opt(str), mana_cost: opt(maybe(str)), oracle_text: opt(maybe(str)),
  card_faces: opt(maybe(arr(obj({ name: str })))),
});
const HiddenObject = obj({ id, hidden: lit(true), owner: id, zone: Zone }, { closed: true });
const ObjectView = obj({
  id, cardId: maybe(str), card: Card, owner: id, controller: id, zone: Zone,
  tapped: bool, faceDown: opt(maybe(bool)), face: opt(maybe(int)),
  // Yedora, Grave Gardener: face down as a land of this basic type
  faceDownLand: opt(str),
  // Kozilek, the Broken Reality: what turning it face up costs, to its controller only
  upCost: opt(str),
  counters: rec(num), damage: num, summoningSick: opt(maybe(bool)),
  attachedTo: maybe(id), attachments: opt(arr(id)), isToken: opt(maybe(bool)),
  attacking: maybe(id), blocking: opt(arr(id)), blockedBy: opt(arr(id)), blockOrder: opt(arr(id)),
  effects: opt(arr(S.plainObj)), isCommander: bool, isSignature: opt(bool), note: opt(maybe(str)), entered: opt(maybe(num)),
  prepared: opt(bool), agenda: opt(bool), chosen: opt(maybe(S.plainObj)), pairedWith: opt(maybe(id)),
  // meld: the two cards a melded permanent is
  melded: opt(arr(str)), power: maybe(num), toughness: maybe(num), keywords: arr(str),
  // Zilortha, Strength Incarnate: lethal damage to it is by its power
  lethalByPower: opt(lit(true)),
  // Autumn Willow: shroud, but this viewer may target it this turn
  shroudOpen: opt(lit(true)),
  // Nowhere to Run: hexproof, but targetable as though it didn't have it
  hexproofOpen: opt(lit(true)),
  // Alchemy: perpetual changes added up, and a card's intensity
  perpetual: opt(maybe(obj({ pt: arr(num), keywords: arr(str), costDelta: num, text: arr(str), basePt: opt(arr(num)),
    lose: opt(arr(str)), spendAny: opt(bool), types: opt(arr(str)) }))),
  intensity: opt(maybe(num)),
  // layer 3 (CR 612): its rules text now, when an effect has changed it
  textNow: opt(maybe(str)),
  textCard: opt(maybe(Card)),
  band: opt(maybe(str)),
  /* Yavimaya, Urborg: mana it makes beyond its printed abilities, by the index the mana intent takes */
  manaExtra: opt(maybe(arr(obj({ i: nat, label: str })))),
  /* Kibo's Banana, Birds of Paradise: what tapping it by hand lets its controller choose, by the mana intent's index */
  manaChoices: opt(maybe(arr(obj({ i: nat, options: arr(obj({ key: str, mana: str }, { closed: true })) }, { closed: true })))),
  /* Marvin, an Equipment's "has '{T}: …'": abilities beyond its printed ones, by the index activateAbility takes */
  gained: opt(maybe(obj({ manaBase: nat, list: arr(obj({ i: nat, mana: opt(bool), ability: S.plainObj })) }))),
  /* a card in a hand or on top of a library: who besides its owner knows it — 'all' when it was revealed (or the
     library is played revealed), else the players who looked */
  seenBy: opt(either("'all' or player ids", lit('all'), arr(id))),
});
const AnyObject = (v, p, out) => (v && v.hidden ? HiddenObject : ObjectView)(v, p, out);
const StackItemView = obj({
  id, kind: lit('spell', 'ability', 'trigger'), name: str, controller: id,
  cardId: maybe(str), card: maybe(Card), objId: maybe(id),
  targets: opt(arr(Target)), abilityText: opt(maybe(str)), countered: bool,
  triggered: opt(bool), face: opt(maybe(int)), textNow: opt(maybe(str)),
  /* a spell's or a triggered ability's modes, chosen as it went on the stack: public, whole */
  modes: opt(arr(str)),
  /* one of three or more of the same trigger put on the stack together, and whether it is optional */
  batch: opt(id), optional: opt(lit(true)),
});
const ManaPool = obj({ W: num, U: num, B: num, R: num, G: num, C: num });
const PlayerView = obj({
  id, name: str, seat: opt(maybe(int)), isBot: opt(maybe(bool)), botDifficulty: opt(maybe(num)), botPersonality: opt(maybe(str)),
  life: num, poison: opt(maybe(num)), energy: opt(maybe(num)), experience: opt(maybe(num)), rad: opt(maybe(num)),
  pool: ManaPool, landsPlayed: nat, maxLands: num,
  hasLost: opt(maybe(bool)), hasWon: opt(maybe(bool)), lossReason: opt(maybe(str)), lossFrom: opt(maybe(str)), connected: opt(maybe(bool)),
  mulligansTaken: nat, keptHand: bool, mulliganBottom: nat,
  commanderDamage: opt(maybe(rec(num))), commanderCasts: opt(maybe(rec(num))),
  librarySize: nat, topCard: maybe(ObjectView), handSize: nat, draftNotes: opt(maybe(S.plainObj)),
  /* Mindslaver: the player controlling them this turn (CR 722) */
  controlledBy: opt(id),
  /* …for how long: the turn, this combat (Secret of Bloodbending), or while controlSrc resolves (Word of Command) */
  controlSpan: opt(lit('turn', 'combat', 'resolve')), controlSrc: opt(str),
  hand: arr(AnyObject), graveyard: arr(ObjectView), exile: arr(ObjectView), command: arr(ObjectView),
});
const LogEntry = obj({ t: opt(num), turn: num, type: opt(maybe(str)), text: str });
/* channel: an ability used from the hand; mana: one that makes mana (a Spirit Guide), a mana source while paying */
const AltUse = obj({ kind: str, label: str, via: opt(str), cost: opt(maybe(str)), channel: opt(bool), mana: opt(bool) });
/* An extra cost that is itself a question (replicate, splice) carries it as `choose`. */
const ExtraCost = obj({ kind: str, label: str, cost: opt(maybe(str)), modes: opt(arr(obj({ i: int }))),
  /* an "and/or" kicker: each of its costs, any or all of them paid (the cast's kickPaid) */
  costs: opt(arr(str)),
  /* an additional cost you may pay that cannot be paid now (nothing to sacrifice) */
  blocked: opt(bool),
  choose: opt((v, p, out) => ChooseSpec(v, p, out)),
  /* convoke, improvise, delve: what could pay, and how much of the cost at most */
  candidates: opt(arr(id)), max: opt(nat),
  /* Torgaar, Dargo: the generic mana each sacrifice takes off (sacForLess) */
  each: opt(nat),
  /* a cost the table would otherwise pick (evidence, forage, reveal, behold…): the opts key the
     answer goes in, how many (or 'X'), and forage's Foods and their key */
  key: opt(str), need: opt(either('a count or X', nat, lit('X'))), foods: opt(arr(id)), foodKey: opt(str), kindKey: opt(str), mvX: opt(bool), symbol: opt(str), counterKind: opt(str) });
/* The same offer for one activated ability of a permanent, by the index activateAbility takes. */
const CostPick = obj({ index: nat, kind: str, label: str, key: str, candidates: arr(id),
  need: opt(either('a count or X', nat, lit('X'))), foods: opt(arr(id)), foodKey: opt(str), kindKey: opt(str), mvX: opt(bool), symbol: opt(str), counterKind: opt(str) });
/* A modal spell's modes, offered as it is cast: how many, and which can be chosen (ok); the count once kicked */
const CastModes = obj({ count: nat, min: nat, max: nat, repeatable: opt(lit(true)), pawprint: opt(nat),
  options: arr(obj({ i: nat, label: str, ok: bool, weight: opt(num) }, { closed: true }), { min: 2 }),
  kicked: opt(obj({ count: nat, min: nat, max: nat }, { closed: true })) }, { closed: true });

/* ---- questions ---- */
const ChoiceCard = obj({ id, name: opt(str), card: opt(maybe(Card)) });
const common = {
  type: str, playerId: id, prompt: opt(str), purpose: opt(maybe(str)), resumeKey: opt(maybe(str)),
  sourceName: opt(maybe(str)), sourceId: opt(maybe(id)), sourceCard: opt(maybe(Card)), sourceText: opt(maybe(str)),
  objId: opt(maybe(id)), stackId: opt(maybe(id)),
  /* a question that can be answered once for the rest of the turn ('turn') or of a batch of triggers ('rest' more):
     the answer's `remember` */
  auto: opt(maybe(obj({ kind: lit('may', 'pay', 'mode', 'targets'), label: str, key: str, turn: opt(lit(true)), batchId: opt(id),
    rest: opt(nat), same: opt(arr(arr(Target))) }, { closed: true }))),
};
const choice = (fields) => obj(Object.assign({}, common, fields));
/* what the game would sacrifice for mana to pay for you: only ever in your own question */
const SacManaNote = obj({ ids: arr(id, { min: 1 }), n: nat, text: str }, { closed: true });
/* a player, or a planeswalker or battle ('object') */
const Defender = obj({ kind: lit('player', 'object'), id, name: str });
/* the generic question (src/06a-choice.js, docs/choices.md) */
const ChooseItem = obj({ id, name: opt(maybe(str)), card: opt(maybe(Card)) });
/* ids and cards: a pile of cards an option stands for (Fact or Fiction's piles), cards in the same order as ids */
const ChooseOption = obj({ label: str, i: opt(int), cost: opt(maybe(str)), weight: opt(num), ids: opt(arr(id)), cards: opt(arr(maybe(Card))) });
const ChooseNumber = obj({ min: int, max: int, step: opt(int) });
const ChooseConstraint = obj({ kind: lit('distinct', 'distinctTypes', 'unionAtLeast', 'eachAtMost', 'sum', 'shareColour', 'mana', 'pays'), key: opt(str), min: opt(num), max: opt(num),
  with: opt(arr(str)), base: opt(str), reason: opt(str), label: opt(str), finalMax: opt(bool),
  /* Word of Command: the cost the lands picked have to pay, and the spell they pay for ('pays') */
  cost: opt(str), forObj: opt(maybe(id)) });
const Remember = opt(lit('turn', 'batch'));
/* "choose a card name": what the card must be, where any card's name may be typed in (nameAny) */
const NameWanted = obj({ nonland: opt(bool), nonartifact: opt(bool), creature: opt(bool) }, { closed: true });
/* a card name typed in: a string of a sensible length */
const TypedName = prim('a card name (1 to 150 characters)', v => typeof v === 'string' && v.trim().length > 0 && v.length <= 150);
const ChooseAnswer = obj({ picks: opt(arr(either('an id or an option index', S.id, S.int))), number: opt(num),
  order: opt(arr(either('an id or an option index', S.id, S.int))), name: opt(TypedName), remember: Remember }, { closed: true });
const CHOICES = {
  declareAttackers: choice({ candidates: arr(id), defenders: arr(Defender, { min: 1 }) }),
  declareBlockers: choice({ attackers: arr(id, { min: 1 }), candidates: arr(id), blockingPlayer: opt(id) }),
  discard: choice({ count: nat, candidates: opt(arr(id)), optional: opt(bool) }),
  discardToHandSize: choice({ count: nat }),
  sacrifice: choice({ count: nat, filter: opt(maybe(str)), candidates: opt(arr(id)), optional: opt(bool) }),
  scry: choice({ count: nat, cards: arr(ChoiceCard) }),
  surveil: choice({ count: nat, cards: arr(ChoiceCard) }),
  arrange: choice({ count: opt(nat), cards: arr(ChoiceCard), look: opt(bool) }),
  orderTriggers: choice({ cards: arr(obj({ id, name: opt(str), ids: opt(arr(id, { min: 2 })) }), { min: 2 }) }),
  pickCard: choice({ count: nat, cards: arr(ChoiceCard), optional: opt(bool), candidates: opt(arr(id)), fromLibrary: opt(bool) }),
  pickTarget: choice({ specs: arr(S.plainObj, { min: 1 }), options: arr(arr(Target)), count: nat }),
  /* (a card name, where any may be typed in, may offer none: nameAny) */
  mode: choice({ count: int, options: arr(obj({ i: int, label: str, card: opt(maybe(Card)) })), repeatable: opt(bool), nameAny: opt(maybe(NameWanted)) }),
  /* sacMana: what paying would sacrifice for mana (Treasures), named in the question; redo: what a yes to
     "Sacrifice 3 Treasures to cast Lightning Bolt?" does again (purpose sacMana) */
  confirm: choice({ yesLabel: opt(str), noLabel: opt(str), payMana: opt(str), sacMana: opt(SacManaNote),
    redo: opt(obj({ kind: str, objId: opt(id), index: opt(nat), declarations: opt(arr(S.plainObj)), opts: S.plainObj })) }),
  /* The table shows a mana cost (a string) or { life }. */
  payOrDont: choice({ cost: either('a mana cost, { life } or { energy }', str, obj({ life: num }), obj({ energy: num })), sacMana: opt(SacManaNote) }),
  payOrCounter: choice({ cost: str, stackId: id, sacMana: opt(SacManaNote) }),
  riot: choice({ objId: id }),
  /* a part of a card the engine cannot do, done on the table by its controller, who says when it is done (_byHand) */
  byHand: choice({ text: str }),
  vote: choice({ options: arr(str, { min: 1 }) }),
  /* The general question (src/06a-choice.js); its own check() does the rest. */
  choose: choice({
    kind: lit('objects', 'players', 'options', 'number'), purpose: opt(maybe(str)),
    items: opt(maybe(arr(ChooseItem))), options: opt(maybe(arr(ChooseOption))), number: opt(ChooseNumber),
    min: opt(nat), max: opt(nat), optional: opt(bool), repeat: opt(bool), ordered: opt(bool),
    constraints: opt(arr(ChooseConstraint)), nameAny: opt(maybe(NameWanted)),
    then: opt(maybe(obj({ kind: lit('cast'), objId: id, opts: S.plainObj }))),
  }),
};
const Choice = union('type', CHOICES, 'question');
/* The spec of a generic question before it is put to anybody (an extra
   cost's `choose`): the same fields, without a player yet. */
function ChooseSpec(v, p, out) {
  obj({ kind: lit('objects', 'players', 'options', 'number'), purpose: opt(maybe(str)),
    items: opt(maybe(arr(ChooseItem))), options: opt(maybe(arr(ChooseOption))), number: opt(ChooseNumber),
    constraints: opt(arr(ChooseConstraint)) })(v, p, out);
}
/* What everyone else sees of somebody's question: who, and what kind, and nothing more. */
const WaitingChoice = obj({ type: str, playerId: id, waiting: lit(true) }, { closed: true });

/* Planechase (src/06f-planechase.js): the face-up planes and phenomena, everybody's; each planar deck's size; the
   planar die, for the player whose turn it is (what the next roll costs, and whether they may roll now) */
const PlanechaseView = obj({
  controller: maybe(id), planes: arr((v, p, out) => ObjectView(v, p, out)), decks: rec(nat), walks: nat,
  dieCost: opt(nat), canRoll: opt(bool), chaoticAether: opt(lit(true)), fixedPoint: opt(id),
  lastRoll: opt(obj({ player: id, face: lit('pw', 'chaos', 'blank'), turn: nat }, { closed: true })),
}, { closed: true });

const View = obj({
  v: num, you: str, config: S.plainObj,
  turn: nat, phase: str, phaseName: str, step: str, stepName: str,
  activePlayer: maybe(id), priorityPlayer: maybe(id), turnOrder: arr(id),
  over: bool, winners: maybe(arr(id)), mulliganPhase: bool,
  canUndo: bool, undoLabel: maybe(str), undoTurn: opt(maybe(num)), holding: bool,
  fullControl: bool, fullControlSticky: bool, yielding: maybe(lit('turn', 'response', 'batch')),
  /* what you answered once for the rest of the turn or of a batch of triggers */
  autoAnswers: opt(arr(obj({ id: str, kind: lit('may', 'pay', 'mode', 'targets'), text: str, batch: opt(id) }, { closed: true }))),
  playable: arr(id), uses: rec(arr(AltUse)), extras: rec(arr(ExtraCost)), costPicks: opt(rec(arr(CostPick))),
  /* the modes of each modal spell of yours you could cast, chosen as it is cast */
  castModes: opt(rec(CastModes)),
  /* split cards in hand: the halves castable now */
  splitFaces: opt(rec(arr(nat))),
  /* split cards with fuse castable with both halves now */
  fusable: opt(arr(id)),
  monarch: maybe(id), initiative: maybe(id), isDay: maybe(bool),
  pendingChoice: maybe((v, p, out) => (v.waiting ? WaitingChoice : Choice)(v, p, out)),
  stack: arr(StackItemView), battlefield: arr(ObjectView), players: arr(PlayerView, { min: 1 }),
  log: arr(LogEntry),
  planechase: opt(PlanechaseView),
  /* Mindslaver (CR 722): the seats of the players this one controls this turn, each the view that player would have */
  controlling: opt(arr(obj({ id, name: str, view: (v, p, out) => View(v, p, out) }, { closed: true }), { min: 1 })),
});

/* ---- answers to questions (the data of a 'choice' intent) ---- */
const ids = arr(id);
const ANSWERS = {
  confirm: obj({ yes: opt(bool), remember: Remember }, { closed: true }),
  payOrDont: obj({ pay: opt(bool), remember: Remember }, { closed: true }),
  payOrCounter: obj({ pay: opt(bool) }, { closed: true }),
  riot: obj({ haste: opt(bool) }, { closed: true }),
  byHand: obj({ done: opt(bool) }, { closed: true }),
  vote: obj({ choice: opt(str) }, { closed: true }),
  mode: obj({ modes: opt(arr(int)), name: opt(TypedName), remember: Remember }, { closed: true }),
  pickCard: obj({ cardIds: opt(ids), cardId: opt(id) }, { closed: true }),
  discard: obj({ cardIds: opt(ids) }, { closed: true }),
  discardToHandSize: obj({ cardIds: opt(ids) }, { closed: true }),
  sacrifice: obj({ cardIds: opt(ids) }, { closed: true }),
  scry: obj({ top: opt(ids), bottom: opt(ids) }, { closed: true }),
  surveil: obj({ top: opt(ids), bottom: opt(ids) }, { closed: true }),
  arrange: obj({ top: opt(ids) }, { closed: true }),
  orderTriggers: obj({ top: opt(ids), cardIds: opt(ids) }, { closed: true }),
  // (skipped: a modal spell's targets asked as it is cast, the places an "up to" left out — castTargets)
  pickTarget: obj({ targets: opt(arr(Target)), remember: Remember, skipped: opt(arr(nat)) }, { closed: true }),
  choose: ChooseAnswer,
};

/* ---- intents: what the table (or a guest) sends ---- */
const Declaration = obj({ attackerId: id, defenderId: id, band: opt(str), enlist: opt(maybe(id)) }, { closed: true });
const Block = obj({ blockerId: id, attackerIds: arr(id, { min: 1 }) }, { closed: true });
/* (any intent may say whom it is for — `as`, a player the sender controls this turn: Mindslaver, CR 722) */
const closed = (f) => obj(Object.assign({ kind: str, as: opt(id) }, f), { closed: true });
const onObj = closed({ objId: id });
const INTENTS = {
  pass: closed({}), undo: closed({}), mulligan: closed({}), concede: closed({}),
  hold: closed({ on: bool }),
  autoPass: closed({ cfg: maybe(S.plainObj) }),
  fullControl: closed({ on: bool, sticky: opt(bool) }),
  yield: closed({ mode: maybe(lit('turn', 'response', 'batch')) }),
  /* remembered answers: take one back ('clear', by id or 'all'), or decline the rest of a batch of optional triggers */
  auto: closed({ act: lit('clear', 'decline'), id: opt(str), batch: opt(id) }),
  keep: closed({ bottom: opt(ids) }),
  playLand: closed({ objId: id, face: opt(nat) }), cycle: closed({ objId: id, channel: opt(bool), targets: opt(arr(Target)), x: opt(nat) }), plot: onObj, foretell: onObj, suspend: closed({ objId: id, x: opt(nat), via: opt(str) }), transmute: onObj, encore: onObj, turnFaceUp: onObj,
  // the companion's {3} into hand (CR 702.139)
  companion: onObj,
  // Planechase: roll the planar die, the special action (CR 901.9), paid by the game or (fromPool) with mana tapped by hand
  planarDie: closed({ fromPool: opt(bool) }),
  cast: closed({
    objId: id, targets: opt(arr(Target)), free: opt(bool), kick: opt(nat), buyback: opt(bool), entwine: opt(bool),
    /* which of an "and/or" kicker's costs are paid: 0 the first, 1 the second */
    kickPaid: opt(arr(nat)),
    /* said with the extra costs: an additional cost you may pay (a kicker that is not mana), and the gift */
    payAdditional: opt(bool), gift: opt(maybe(bool)),
    offspring: opt(bool), squad: opt(nat), casualty: opt(bool), returnId: opt(id), spree: opt(maybe(arr(int))), via: opt(maybe(str)),
    /* a modal spell's modes, chosen as it is cast (mode indexes) */
    modes: opt(arr(nat)),
    /* the places among its targets an "up to" left out, before a target it must have (Press into Service) */
    skipped: opt(arr(nat)),
    x: opt(either('a number of 0 to 99', S.nat, S.str)),
    /* what pays for convoke, improvise and delve; left out, the engine picks */
    convokeIds: opt(arr(id)), improviseIds: opt(arr(id)), delveIds: opt(arr(id)),
    /* Torgaar, Dargo: the permanents sacrificed for a cheaper spell (none, for an empty list); left out, the engine picks */
    sacrificeIds: opt(arr(id)),
    /* a split card's half: 0 left, 1 right */
    face: opt(nat),
    /* fuse: both halves of a split card with fuse, from hand */
    fuse: opt(bool),
    /* generic questions answered as the spell is cast (replicate, splice), by purpose */
    choices: opt(maybe(rec(ChooseAnswer))),
    /* what pays a cost the table would otherwise pick (evidence, forage, reveal, behold...) */
    evidenceIds: opt(arr(id)), forageExileIds: opt(arr(id)), revealIds: opt(arr(id)), beholdIds: opt(arr(id)), exileIds: opt(arr(id)), forageFoodId: opt(id), counterFromId: opt(id), blightId: opt(id), counterKind: opt(str), counterSpreadIds: opt(arr(id)),
  }),
  activate: closed({ objId: id, index: nat, targets: opt(arr(Target)), skipped: opt(arr(nat)), sacrificeIds: opt(arr(id)), discardIds: opt(arr(id)), x: opt(nat), manaSplit: opt(nat), evidenceIds: opt(arr(id)), forageExileIds: opt(arr(id)), revealIds: opt(arr(id)), beholdIds: opt(arr(id)), exileIds: opt(arr(id)), forageFoodId: opt(id), counterFromId: opt(id), blightId: opt(id), counterKind: opt(str), counterSpreadIds: opt(arr(id)) }),
  mana: closed({ objId: id, index: opt(nat), choice: opt(maybe(str)) }),
  declareAttackers: closed({ declarations: arr(Declaration) }),
  declareBlockers: closed({ declarations: arr(Block) }),
  choice: closed({ data: S.plainObj }),
  manual: closed({
    action: str, objId: opt(maybe(id)), zone: opt(Zone), toBottom: opt(bool), kind2: opt(str), n: opt(num),
    hostId: opt(maybe(id)), token: opt(S.plainObj), text: opt(str), sides: opt(nat),
  }),
  chat: closed({ text: str }),
  setDeck: closed({ deck: S.plainObj, name: opt(str) }),
  pick: closed({ cardIds: ids, ability: opt(maybe(str)) }),
  draftOffer: closed({ cardId: id, yes: bool }),
  draftExile: closed({ cardId: id, targetId: id }),
  draftPeek: closed({ cardId: id, which: opt(nat) }),
  jumpstart: closed({ pick: opt(nat), ready: opt(bool) }),
};
const Intent = union('kind', INTENTS, 'intent');

/* ---- net messages ---- */
const env = (f) => obj(Object.assign({ t: str, seq: opt(int) }, f));
const NET_TO_HOST = {
  hello: env({ payload: obj({ name: opt(str), token: opt(str), autoPass: opt(maybe(S.plainObj)) }) }),
  intent: env({ payload: Intent }),
  chat: env({ payload: obj({ from: opt(str), text: str }) }),
  pong: env({}),
  /* the guest has view n (09b-sync.js), or needs a whole one */
  ack: env({ n: int }),
  resync: env({}),
  '~': env({ id: int, i: nat, n: int, d: str }),
};
const NET_TO_GUEST = {
  welcome: env({ code: str, yourId: str }),
  lobby: env({ payload: obj({ members: arr(S.plainObj) }) }),
  state: env({ payload: View }),
  /* a view as a difference (09b-sync.js): game, number, base, patch or whole state, new cards, events, log */
  sv: env({ g: str, n: int, b: opt(int), p: opt(S.any), s: opt(S.plainObj), c: opt(rec(S.plainObj)),
    e: opt(maybe(arr(S.plainObj))), es: opt(maybe(num)), l: opt(arr(S.plainObj)) }),
  draft: env({ payload: S.plainObj }),
  draftPeek: env({ payload: S.any }),
  sealed: env({ payload: S.plainObj }),
  jumpstart: env({ payload: S.plainObj }),
  chat: env({ payload: obj({ from: str, text: str, at: num }) }),
  log: env({ payload: S.plainObj }),
  error: env({ payload: str }),
  kick: env({ payload: S.any }),
  ping: env({}),
  /* a friends tournament's match: which one this table is (src/10i-ui-tourney.js) */
  'tourney:table': env({ id: str, r: int, tb: int, host: str }),
  '~': env({ id: int, i: nat, n: int, d: str }),
};
const NetToHost = union('t', NET_TO_HOST, 'message to the host');
const NetToGuest = union('t', NET_TO_GUEST, 'message to a guest');

/* ============================================================
   Checks beyond shape: what has to agree with what
   ============================================================ */
/* Words a player reads never carry the parser's "CARDNAME": every path
   to a string that does. Cards themselves are printed data and are left out. */
function placeholderIn(v, p, out, depth) {
  if ((depth || 0) > 40 || out.length > 20) return;
  if (typeof v === 'string') { if (v.includes('CARDNAME') || /\bunlock door [01]\b/.test(v)) out.push(p); return; }
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach((x, i) => placeholderIn(x, `${p}[${i}]`, out, (depth || 0) + 1)); return; }
  for (const k of Object.keys(v)) {
    if (k === 'card' || k === 'sourceCard') continue;
    placeholderIn(v[k], `${p}.${k}`, out, (depth || 0) + 1);
  }
}

function run(schema, value, root) { const out = []; schema(value, root, out); return out; }

/** Everything that cannot cross the wire as JSON and come back the same. */
function jsonProblems(v, p, out, seen) {
  seen = seen || new Set();
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!isFinite(v)) out.push({ path: p, msg: `${v} turns into null in JSON` }); return; }
  if (v === undefined) { out.push({ path: p, msg: 'undefined in an array turns into null in JSON' }); return; }
  if (typeof v === 'function') { out.push({ path: p, msg: 'a function does not survive JSON' }); return; }
  if (typeof v !== 'object') { out.push({ path: p, msg: `a ${typeof v} does not survive JSON` }); return; }
  if (seen.has(v)) { out.push({ path: p, msg: 'refers back to itself (JSON cannot hold a cycle)' }); return; }
  if (v instanceof Map || v instanceof Set) { out.push({ path: p, msg: `a ${v.constructor.name} turns into {} in JSON` }); return; }
  seen.add(v);
  if (Array.isArray(v)) v.forEach((x, i) => jsonProblems(x, `${p}[${i}]`, out, seen));
  else for (const k of Object.keys(v)) if (v[k] !== undefined) jsonProblems(v[k], `${p}.${k}`, out, seen);
  seen.delete(v);
}

/** Where two JSON values first differ, as a path (null when they are the same). */
function firstDiff(a, b, p) {
  if (a === b) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) return `${p} (${a.length} entries against ${b.length})`;
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
      const d = firstDiff(a[k], b[k], Array.isArray(a) ? `${p}[${k}]` : `${p}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${p} (${show(a)} against ${show(b)})`;
}

/** Every object id a view mentions, and where. */
function objectsIn(view) {
  const all = new Map();
  const add = (o, where) => { if (o && o.id) { if (!all.has(o.id)) all.set(o.id, []); all.get(o.id).push({ o, where }); } };
  for (const o of view.battlefield || []) add(o, 'battlefield');
  for (const p of view.players || []) {
    for (const z of ['hand', 'graveyard', 'exile', 'command']) for (const o of p[z] || []) add(o, `${p.id}.${z}`);
    if (p.topCard) add(p.topCard, `${p.id}.library`);
  }
  return all;
}

/**
 * The view, shape and sense. `viewer` is who it was made for ('__watching'
 * for somebody with no seat); `game`, if given, lets it check what the
 * view should have hidden. `seatOf` is set for a seat carried inside
 * another player's view: the one controlling `viewer` (Mindslaver).
 */
function checkView(view, viewer, game, seatOf) {
  const out = run(View, view, 'view').map(x => Object.assign({ rule: 'view.shape' }, x));
  if (!view || typeof view !== 'object' || !Array.isArray(view.players)) return out;
  const bad = (rule, p, msg) => out.push({ rule, path: p, msg });
  const json = [];
  jsonProblems(view, 'view', json);
  for (const x of json) bad('view.json', x.path, x.msg);
  const named = [];
  placeholderIn(view, 'view', named);
  for (const at of named) bad('view.words', at, 'shows a placeholder ("CARDNAME", "door 0") where a name should be');
  if (viewer !== undefined && view.you !== viewer) bad('view.sense', 'view.you', `made for ${show(viewer)} but says ${show(view.you)}`);
  const pids = new Set(view.players.map(p => p.id));
  for (const k of ['activePlayer', 'priorityPlayer', 'monarch', 'initiative'])
    if (view[k] != null && !pids.has(view[k])) bad('view.sense', `view.${k}`, `${show(view[k])} is nobody at the table`);
  for (const pid of view.turnOrder || []) if (!pids.has(pid)) bad('view.sense', 'view.turnOrder', `${show(pid)} is nobody at the table`);
  const all = objectsIn(view);
  for (const [oid, seen] of all) if (seen.length > 1) bad('view.sense', `object ${oid}`, `is in two places at once: ${seen.map(s => s.where).join(' and ')}`);
  for (const o of view.battlefield || []) {
    if (o.zone !== 'battlefield') bad('view.sense', `battlefield ${o.id}`, `says its zone is ${show(o.zone)}`);
    // a Curse enchants a player
    if (o.attachedTo && !(view.battlefield || []).some(x => x.id === o.attachedTo) && !(view.players || []).some(p => p.id === o.attachedTo)) bad('view.sense', `battlefield ${o.id}.attachedTo`, `${o.attachedTo} is not on the battlefield`);
    if (o.controller && !pids.has(o.controller)) bad('view.sense', `battlefield ${o.id}.controller`, `${show(o.controller)} is nobody at the table`);
  }
  for (const p of view.players) {
    for (const z of ['hand', 'graveyard', 'exile', 'command']) for (const o of p[z] || []) {
      if (o.zone !== z) bad('view.sense', `${p.id}.${z} ${o.id}`, `says its zone is ${show(o.zone)}`);
    }
    for (const o of p.graveyard || []) if (o.owner !== p.id) bad('view.sense', `${p.id}.graveyard ${o.id}`, `belongs to ${show(o.owner)}`);
    if ((p.hand || []).length !== p.handSize) bad('view.sense', `${p.id}.handSize`, `is ${p.handSize} but the hand has ${(p.hand || []).length}`);
    /* hidden information */
    if (p.id !== viewer) {
      /* unless the hand is played revealed (Telepathy; Sen Triplets: to everybody, for the turn — _handShown), or the
         viewer knows that card: it was revealed, or they looked at the hand, and it has not moved since (knownTo) */
      /* (or the viewer controls that player this turn, and sees what they see: CR 722.3) */
      const mayHand = (o) => !!game && ((game._handShown && game._handShown(p.id, viewer)) || (game._knows && game._knows(game.obj(o.id), viewer)) ||
        (game.playerController && game.playerController(p.id) === viewer));
      for (const o of p.hand || []) if (!o.hidden && !mayHand(o)) bad('view.privacy', `${p.id}.hand ${o.id}`, `${viewer}'s view shows a card in ${p.id}'s hand (${(o.card || {}).name})`);
      // unless it is played revealed ("play with the top card of your library revealed"), or known to the viewer
      if (p.topCard && !(game && game._topCardVisible && game._topCardVisible(p.id, viewer))) bad('view.privacy', `${p.id}.topCard`, `${viewer}'s view shows the top of ${p.id}'s library`);
    }
    // nobody is shown a top card they may not see (their own included: a library's order is nobody's to know)
    if (p.id === viewer && p.topCard && game && game._topCardVisible && !game._topCardVisible(p.id, viewer)) bad('view.privacy', `${p.id}.topCard`, `${viewer}'s view shows the top of their own library`);
    // (and what is said of who knows a card is said only of a card shown)
    for (const o of (p.hand || []).concat(p.topCard ? [p.topCard] : [])) {
      if (o.seenBy != null && o.seenBy !== 'all' && !(Array.isArray(o.seenBy) && o.seenBy.every(x => pids.has(x)))) bad('view.sense', `${p.id} ${o.id}.seenBy`, `${show(o.seenBy)} is not 'all' or players at the table`);
    }
  }
  /* A face-down card is a secret from everyone but the one who controls
     it (morph, manifest, cards exiled face down). */
  for (const [oid, seen] of all) for (const { o, where } of seen) {
    /* (but for a face-down creature the viewer may look at: Lens of Clarity, or one they looked at — Spy Network) */
    const mayLook = !!game && o.zone === 'battlefield' && ((game._seesFaceDown && game._seesFaceDown(viewer)) || (game._knows && game._knows(game.obj(o.id), viewer)));
    if (o.faceDown && o.card && o.card.id !== '__facedown__' && o.controller !== viewer && o.owner !== viewer && !mayLook)
      bad('view.privacy', `${where} ${oid}`, `face down, but ${viewer}'s view carries the card (${o.card.name})`);
    // (nor what the card underneath is like: an exiled face-down card's power, keywords or effects name it)
    if (o.faceDown && o.card && o.card.id === '__facedown__' && o.zone !== 'battlefield' && o.zone !== 'stack' &&
        (o.power != null || o.toughness != null || (o.keywords || []).length || (o.effects || []).length))
      bad('view.privacy', `${where} ${oid}`, `face down in ${o.zone}, but ${viewer}'s view says what it is like (${o.power}/${o.toughness} ${(o.keywords || []).join(' ')})`);
    // (and what it costs to turn face up says what it is)
    if (o.upCost != null && o.controller !== viewer) bad('view.privacy', `${where} ${oid}`, `${viewer}'s view says what turning another player's face-down card up costs`);
    // (what tapping a permanent for mana lets one choose is its controller's to know, and only of what they can see)
    if (o.manaChoices && (o.controller !== viewer || o.zone !== 'battlefield' || (o.faceDown && o.card && o.card.id === '__facedown__')))
      bad('view.privacy', `${where} ${oid}`, `${viewer}'s view says what mana another player's (or a hidden) permanent lets them choose`);
  }
  for (const s of view.stack || []) {
    const src = s.objId && game && game.obj ? game.obj(s.objId) : null;
    if (src && src.faceDown && s.card && s.card.id !== '__facedown__' && src.controller !== viewer)
      bad('view.privacy', `stack ${s.id}`, `a face-down spell, but ${viewer}'s view carries the card (${s.card.name})`);
  }
  /* playable: things this player could do now, so they must be things they can see */
  const what = (oid) => { const o = game && game.obj ? game.obj(oid) : null; return o ? `${oid} (${o.name}, in ${o.owner}'s ${o.zone})` : oid; };
  for (const oid of view.playable || []) if (!all.has(oid)) bad('view.sense', 'view.playable', `${what(oid)} is not anywhere the viewer can see`);
  // (a card in another player's hand only with leave to play it from there: Sen Triplets)
  for (const oid of view.playable || []) {
    const o = game && game.obj ? game.obj(oid) : null;
    if (o && o.zone === 'hand' && o.owner !== viewer && !(game._oppHandGrant && game._oppHandGrant(viewer, o)))
      bad('view.sense', 'view.playable', `${what(oid)} is in another player's hand, and ${viewer} has no leave to play it`);
  }
  if ((view.playable || []).length && view.priorityPlayer !== viewer) bad('view.sense', 'view.playable', 'offers plays to somebody without priority');
  /* Mindslaver (CR 722): a player somebody else controls decides nothing in their own view; their seat, inside
     the view of the one controlling them, is where their decisions are made */
  const ruledBy = game && game.playerController ? game.playerController(viewer) : null;
  const decides = seatOf ? ruledBy === seatOf : !ruledBy;
  if (seatOf && !decides) bad('view.privacy', 'view', `${seatOf}'s view carries ${viewer}'s seat, but ${seatOf} is not controlling ${viewer}`);
  if (!decides && (view.playable || []).length) bad('view.sense', 'view.playable', `offers plays to ${viewer}, whom ${ruledBy} controls`);
  for (const [i, c] of (view.controlling || []).entries()) {
    const at = `view.controlling[${i}]`;
    if (seatOf) { bad('view.sense', at, 'a seat inside a seat'); continue; }
    if (!c || !c.view) continue;
    if (c.view.you !== c.id) bad('view.sense', `${at}.view.you`, `the seat of ${show(c.id)} says it is ${show(c.view.you)}'s`);
    if (game && !(game.playerController && game.playerController(c.id) === viewer)) { bad('view.privacy', at, `${viewer}'s view carries ${c.id}'s seat, but ${viewer} is not controlling ${c.id}`); continue; }
    for (const x of checkView(c.view, c.id, game, viewer)) if (x.rule !== 'view.shape') out.push(Object.assign(x, { path: at + '.' + x.path }));
  }
  const ch = view.pendingChoice;
  if (ch) {
    if (ch.playerId === viewer && ch.waiting && decides) bad('view.sense', 'view.pendingChoice', 'the question is for this player but arrives as "waiting"');
    if (ch.playerId === viewer && !ch.waiting && !decides) bad('view.sense', 'view.pendingChoice', `${viewer}'s own question, but ${ruledBy} controls them and answers it`);
    if (ch.playerId !== viewer && !ch.waiting) bad('view.privacy', 'view.pendingChoice', `${viewer}'s view carries ${ch.playerId}'s whole question`);
    if (ch.playerId === viewer && !ch.waiting) for (const x of checkChoice(ch, game, { view })) out.push(x);
  }
  return out;
}

/**
 * The engine's own bookkeeping, which every view is made from: each object
 * sits in exactly one zone list, and says so. `after` is what just
 * happened, for the report.
 */
function checkZones(g, after) {
  const out = [];
  const where = new Map();
  const put = (o, z) => { if (!o) return; if (!where.has(o)) where.set(o, []); where.get(o).push(z); };
  for (const o of g.battlefield || []) put(o, 'battlefield');
  for (const p of g.players || []) {
    const z = g.zones[p.id];
    if (!z) continue;
    for (const k of ['library', 'hand', 'graveyard', 'exile', 'command']) for (const o of z[k] || []) put(o, `${p.id}.${k}`);
  }
  for (const s of g.stack || []) if (s.obj && s.kind === 'spell') put(s.obj, 'stack');
  const tail = after ? ` (just after: ${after})` : '';
  for (const [o, zs] of where) {
    if (zs.length > 1) out.push({ rule: 'engine.zones', path: `object ${o.id}`, msg: `${o.name} is in ${zs.join(' and ')}${tail}` });
    else {
      const z = zs[0].replace(/^.*\./, '');
      if (o.zone && o.zone !== z) out.push({ rule: 'engine.zones', path: `object ${o.id}`, msg: `${o.name} is in ${zs[0]} but says ${o.zone}${tail}` });
    }
  }
  return out;
}

/** A question, shape and sense. `game` (optional) lets ids be looked up. */
function checkChoice(ch, game, opts) {
  opts = opts || {};
  const out = run(Choice, ch, 'choice').map(x => Object.assign({ rule: 'choice.shape' }, x));
  if (!ch || typeof ch !== 'object') return out;
  const bad = (p, msg) => out.push({ rule: 'choice.sense', path: 'choice' + p, msg });
  const player = game && game.player ? game.player(ch.playerId) : null;
  if (game && game.player && !player) bad('.playerId', `${show(ch.playerId)} is nobody at the table`);
  if (player && player.hasLost) bad('.playerId', `${ch.playerId} has already left the game`);
  const cards = Array.isArray(ch.cards) ? ch.cards : null;
  const dup = (list, p) => { const s = new Set(); for (const x of list || []) { if (s.has(x)) bad(p, `offers ${x} twice`); s.add(x); } };
  if (cards) dup(cards.map(c => c && c.id), '.cards');
  switch (ch.type) {
    case 'pickCard': {
      /* The table's Choose button wants exactly `count` picks unless the
         question is optional: asking for more than are offered is a
         question nobody can answer. */
      if (cards && cards.length && !ch.optional && ch.count > cards.length) bad('.count', `asks for ${ch.count} of ${cards.length} cards and is not optional`);
      if (ch.candidates && cards) for (const c of cards) if (!ch.candidates.includes(c.id)) bad('.cards', `${c.id} is shown but is not a candidate`);
      break;
    }
    case 'mode': {
      const opts2 = ch.options || [];
      dup(opts2.map(o => o && o.i), '.options');
      if (!ch.nameAny && !opts2.length) bad('.options', 'a question with no modes to choose');
      if (!ch.repeatable && !ch.nameAny && ch.count > opts2.length) bad('.count', `asks for ${ch.count} of ${opts2.length} modes`);
      if (ch.count < 1) bad('.count', 'asks for no modes at all');
      break;
    }
    case 'pickTarget': {
      if (Array.isArray(ch.options) && Array.isArray(ch.specs) && ch.options.length !== ch.specs.length) bad('.options', `${ch.options.length} lists of options for ${ch.specs.length} targets`);
      if (Array.isArray(ch.options) && ch.options.some(l => Array.isArray(l) && !l.length)) bad('.options', 'a target with nothing legal to choose');
      break;
    }
    case 'scry': case 'surveil': {
      if (cards && cards.length < Math.min(ch.count, opts.librarySize != null ? opts.librarySize : ch.count)) bad('.cards', `${cards.length} cards shown for a ${ch.type} of ${ch.count}`);
      if (game && cards) {
        const lib = (game.zones[ch.playerId] || {}).library || [];
        const top = new Set(lib.slice(0, ch.count).map(o => o.id));
        for (const c of cards) if (!top.has(c.id)) bad('.cards', `${c.id} is not among the top ${ch.count} of the library`);
      }
      break;
    }
    case 'declareAttackers': {
      if (game) for (const oid of ch.candidates || []) {
        const o = game.obj(oid);
        if (!o || o.zone !== 'battlefield' || o.controller !== ch.playerId) bad('.candidates', `${oid} is not a permanent ${ch.playerId} controls`);
      }
      if ((ch.defenders || []).some(d => d.id === ch.playerId)) bad('.defenders', 'offers attacking yourself');
      break;
    }
    case 'declareBlockers': {
      if (game) for (const oid of ch.attackers || []) {
        const o = game.obj(oid);
        if (!o || !o.attacking) bad('.attackers', `${oid} is not attacking`);
      }
      break;
    }
    case 'vote': dup(ch.options, '.options'); break;
    case 'choose': {
      const C = globalThis.MTG && globalThis.MTG.choice;
      if (ch.kind === 'options' && !(ch.options || []).length && !ch.nameAny) bad('.options', 'an options question with no options');
      if ((ch.kind === 'objects' || ch.kind === 'players') && !Array.isArray(ch.items)) bad('.items', `a ${ch.kind} question with no items`);
      if (ch.kind === 'number' && !ch.number) bad('.number', 'a number question with no range');
      if (ch.kind === 'number' && ch.number && ch.number.min > ch.number.max) bad('.number', `min ${ch.number.min} is more than max ${ch.number.max}`);
      dup((ch.items || []).map(x => x && x.id), '.items');
      if (game && ch.kind === 'players') for (const x of ch.items || []) if (!game.player(x.id)) bad('.items', `${x.id} is nobody at the table`);
      if (game && ch.kind === 'objects') for (const x of ch.items || []) if (!game.obj(x.id)) bad('.items', `${x.id} is no object in the game`);
      if (C && C.normalize && ch.kind !== 'number') {
        /* the engine asks the full form (docs/choices.md), so normalising changes nothing that counts */
        const n = C.normalize(ch);
        if (n.min !== ch.min || n.max !== ch.max) bad('', `min/max ${ch.min}/${ch.max} are not what normalize() makes of them (${n.min}/${n.max})`);
        if (n.min > n.max) bad('.min', `min ${n.min} is more than max ${n.max}`);
        // (an option that may be picked again — a colour for each of Klauth's X mana — is enough on its own: repeat)
        if (!ch.optional && n.min > 0 && C.candidates(n).length < (n.repeat ? 1 : n.min)) bad('', `needs ${n.min} picks from ${C.candidates(n).length}`);
      }
      break;
    }
    default: break;
  }
  if (ch.nameAny && game && game.viewFor) for (const x of namePrivacy(ch, game)) out.push(x);
  if (game && ch.sourceId && !game.obj(ch.sourceId)) bad('.sourceId', `${ch.sourceId} is no object in the game`);
  return out;
}

/**
 * "Choose a card name" (nameAny): every name it offers must be one its player can see or knows of — on their
 * own view of the table, in their own library, or a card they were shown (knownTo) — never a name only an
 * opponent's hidden hand or library holds, which the list (or its order) would give away.
 */
function namePrivacy(ch, game) {
  const out = [];
  const pid = ch.playerId;
  if (!game.player || !game.player(pid)) return out;
  let view;
  try { view = game.viewFor(pid); } catch (e) { return out; }
  const known = new Set();
  const add = (c) => { if (c && c.name && c.id !== '__facedown__') known.add(c.name); };
  for (const o of view.battlefield || []) add(o.card);
  for (const st of view.stack || []) add(st.card);
  for (const p of view.players || []) {
    for (const z of ['hand', 'graveyard', 'exile', 'command']) for (const o of p[z] || []) if (!o.hidden) add(o.card);
    if (p.topCard) add(p.topCard.card);
  }
  for (const q of game.players || []) for (const o of ((game.zones[q.id] || {}).library || [])) {
    if (q.id === pid || (game._knows && game._knows(o, pid))) add(o.card);
  }
  (ch.options || []).forEach((op, k) => {
    const nm = op && op.label;
    if (nm && !known.has(nm)) out.push({ rule: 'choice.privacy', path: `choice.options[${k}]`, msg: `offers ${show(nm)} to ${pid}, a card hidden from them` });
  });
  return out;
}

/** An answer to a question, as the table or a bot gives it. */
function checkAnswer(ch, data, game) {
  const out = [];
  const bad = (rule, p, msg) => out.push({ rule, path: p, msg });
  if (!ch) return out;
  const schema = ANSWERS[ch.type];
  if (data == null || typeof data !== 'object') { bad('answer.shape', 'answer', `wanted an object, got ${show(data)}`); return out; }
  if (schema) for (const x of run(schema, data, 'answer')) out.push(Object.assign({ rule: 'answer.shape' }, x));
  const offered = (ch.cards || []).map(c => c.id);
  const within = (list, pool, p, what) => { for (const x of list || []) if (!pool.includes(x)) bad('answer.sense', p, `${x} is not ${what}`); };
  switch (ch.type) {
    case 'pickCard': within(data.cardIds, ch.candidates || offered, 'answer.cardIds', 'one of the cards offered'); break;
    case 'scry': case 'surveil': case 'arrange': case 'orderTriggers': {
      const what = ch.type === 'scry' || ch.type === 'surveil' ? `one of the cards the ${ch.type} showed` : 'one of the cards offered';
      within(data.top, offered, 'answer.top', what);
      within(data.bottom, offered, 'answer.bottom', what);
      const both = (data.top || []).filter(x => (data.bottom || []).includes(x));
      if (both.length) bad('answer.sense', 'answer', `${both.join(', ')} put both on top and on the bottom`);
      break;
    }
    case 'mode': {
      if (data.name != null && !ch.nameAny) bad('answer.sense', 'answer.name', 'a card name typed in, where none may be');
      const legal = (ch.options || []).map(o => o.i);
      within(data.modes, legal, 'answer.modes', 'one of the modes offered');
      if (Array.isArray(data.modes) && !ch.repeatable && new Set(data.modes).size !== data.modes.length) bad('answer.sense', 'answer.modes', 'picks a mode twice');
      // ("choose one or more": as many as the question's max allows)
      if (Array.isArray(data.modes) && data.modes.length > (ch.max != null ? ch.max : ch.count)) bad('answer.sense', 'answer.modes', `picks ${data.modes.length} modes of ${ch.max != null ? ch.max : ch.count}`);
      // and no fewer than its min (a min of 0 is the "none at all" answer: Hullbreaker Horror)
      if (Array.isArray(data.modes) && ch.min != null && data.modes.length < ch.min) bad('answer.sense', 'answer.modes', `picks ${data.modes.length} modes, fewer than ${ch.min}`);
      break;
    }
    case 'pickTarget': {
      (data.targets || []).forEach((t, i) => {
        const list = (ch.options || [])[i] || [];
        if (t && !list.some(x => x.kind === t.kind && x.id === t.id)) bad('answer.sense', `answer.targets[${i}]`, `${show(t)} is not one of the legal targets`);
      });
      break;
    }
    case 'vote': if (data.choice != null && !(ch.options || []).includes(data.choice)) bad('answer.sense', 'answer.choice', `${show(data.choice)} is not on the ballot`); break;
    case 'discard': case 'discardToHandSize': {
      if (game) {
        const hand = (game.zones[ch.playerId] || {}).hand || [];
        within(data.cardIds, ch.candidates || hand.map(o => o.id), 'answer.cardIds', 'a card that can be discarded');
        // (Ormos, Archive Keeper: "cards with different names")
        if (ch.differentNames && Array.isArray(data.cardIds)) {
          const names = data.cardIds.map(id => (hand.find(o => o.id === id) || {}).name).filter(Boolean);
          if (new Set(names).size !== names.length) bad('answer.cardIds', 'answer', 'two cards with the same name, where they must have different names');
        }
      }
      break;
    }
    case 'sacrifice': {
      if (ch.candidates) within(data.cardIds, ch.candidates, 'answer.cardIds', 'a permanent that can be sacrificed');
      // (Transmutation Font: "with different names")
      if (game && ch.differentNames && Array.isArray(data.cardIds)) {
        const names = data.cardIds.map(id => (game.obj(id) || {}).name).filter(Boolean);
        if (new Set(names).size !== names.length) bad('answer.cardIds', 'answer', 'two permanents with the same name, where they must have different names');
      }
      break;
    }
    case 'choose': {
      const C = globalThis.MTG && globalThis.MTG.choice;
      if (C && C.check) {
        let r;
        const hooks = game && game._chooseHooks ? game._chooseHooks(ch.playerId) : undefined;
        try { r = C.check(C.normalize(ch), data, hooks); } catch (e) { r = { ok: false, reason: 'check() threw: ' + e.message }; }
        if (r && r.ok === false) bad('answer.sense', 'answer', r.reason || 'refused by MTG.choice.check');
      }
      break;
    }
    default: break;
  }
  return out;
}

function checkIntent(intent) {
  return run(Intent, intent, 'intent').map(x => Object.assign({ rule: 'intent.shape' }, x));
}

/* A die rolled, as the event stream carries it to one player (src/06b-events.js; RollEvent in types.d.ts): what the
   table shows tumbling in the middle and landing. A secret die reaches anybody but its roller hidden. */
const RollEvent = obj({
  seq: nat, turn: nat, type: lit('roll'), player: id, sides: prim('a number of sides (1 or more)', v => Number.isInteger(v) && v >= 1),
  result: maybe(int), rolls: arr(maybe(int), { min: 1 }), ignored: arr(int), group: prim('a group number (1 or more)', v => Number.isInteger(v) && v >= 1),
  of: prim('a count of dice (1 or more)', v => Number.isInteger(v) && v >= 1), secret: opt(lit(true)), hidden: opt(lit(true)),
  source: maybe(id), sourceName: maybe(str),
  // the planar die (Planechase): the face it showed
  planar: opt(lit('pw', 'chaos', 'blank')),
}, { closed: true });
/**
 * One event as `viewer` receives it. Of a die: its shape, every number within the die's range and the result the
 * highest of those kept, and the result kept from anybody else when it was rolled in secret.
 */
function checkEvent(e, viewer) {
  if (!e || e.type !== 'roll') return [];
  const out = run(RollEvent, e, 'event').map(x => Object.assign({ rule: 'event.shape' }, x));
  const bad = (rule, p, msg) => out.push({ rule, path: p, msg });
  if (e.secret && viewer !== e.player) {
    if (e.result != null || (e.rolls || []).some(r => r != null) || (e.ignored || []).length || !e.hidden)
      bad('event.privacy', 'event.result', `${viewer} is told what ${e.player}'s secret d${e.sides} came up`);
    return out;
  }
  if (e.hidden) { bad('event.sense', 'event.hidden', `${viewer} rolled it, or it was not secret, but it arrives hidden`); return out; }
  const inRange = (r) => Number.isInteger(r) && r >= 1 && r <= e.sides;
  if (!inRange(e.result)) bad('event.sense', 'event.result', `${show(e.result)} is not on a d${e.sides}`);
  for (const [i, r] of (e.rolls || []).entries()) if (!inRange(r)) bad('event.sense', `event.rolls[${i}]`, `${show(r)} is not on a d${e.sides}`);
  if ((e.rolls || []).length && e.result !== Math.max(...e.rolls)) bad('event.sense', 'event.result', `${e.result} is not the highest of the dice rolled (${e.rolls.join(', ')})`);
  if ((e.ignored || []).length !== Math.max(0, (e.rolls || []).length - 1)) bad('event.sense', 'event.ignored', `${(e.ignored || []).length} dice ignored of ${(e.rolls || []).length} rolled`);
  return out;
}

function checkNetMessage(msg, direction) {
  const out = run(direction === 'toHost' ? NetToHost : NetToGuest, msg, 'msg').map(x => Object.assign({ rule: 'net.shape' }, x));
  const json = [];
  jsonProblems(msg, 'msg', json);
  for (const x of json) out.push(Object.assign({ rule: 'net.json' }, x));
  return out;
}

/* ============================================================
   Bot and runner calls, turned into the intents the table would send
   ============================================================ */
/* Options a bot may pass that the engine fills in for the table itself:
   handleIntent always casts and activates with auto-payment on. */
const ENGINE_ONLY = new Set(['auto']);
const CALLS = {
  passPriority: (pid, silent) => ({ kind: 'pass' }),
  setHoldPriority: (pid, on) => ({ kind: 'hold', on }),
  undo: () => ({ kind: 'undo' }),
  setAutoPass: (pid, cfg) => ({ kind: 'autoPass', cfg }),
  setFullControl: (pid, on, sticky) => ({ kind: 'fullControl', on: !!on, sticky: !!sticky }),
  setYield: (pid, mode) => ({ kind: 'yield', mode: mode || null }),
  autoAnswer: (pid, act, arg) => (act === 'decline' ? { kind: 'auto', act, batch: arg } : { kind: 'auto', act, id: arg }),
  mulligan: () => ({ kind: 'mulligan' }),
  keepHand: (pid, bottom) => ({ kind: 'keep', bottom: bottom || [] }),
  playLand: (pid, objId) => ({ kind: 'playLand', objId }),
  castSpell: (pid, objId, opts) => Object.assign({ kind: 'cast', objId }, strip(opts)),
  // (a bot's channel, with its targets: useFromHand)
  cycleCard: (pid, objId, opts) => Object.assign({ kind: 'cycle', objId }, strip(opts)),
  plotCard: (pid, objId) => ({ kind: 'plot', objId }),
  suspendCard: (pid, objId, opts) => Object.assign({ kind: 'suspend', objId }, opts && opts.via ? { via: opts.via } : {}),
  transmuteCard: (pid, objId) => ({ kind: 'transmute', objId }),
  foretellCard: (pid, objId) => ({ kind: 'foretell', objId }),
  encoreCard: (pid, objId) => ({ kind: 'encore', objId }),
  turnFaceUp: (pid, objId) => ({ kind: 'turnFaceUp', objId }),
  companionToHand: (pid, objId) => ({ kind: 'companion', objId }),
  activateAbility: (pid, objId, index, opts) => Object.assign({ kind: 'activate', objId, index }, strip(opts)),
  tapForMana: (pid, objId, index, choice) => Object.assign({ kind: 'mana', objId, index: index || 0 }, choice != null ? { choice } : {}),
  declareAttackers: (pid, declarations) => ({ kind: 'declareAttackers', declarations: declarations || [] }),
  declareBlockers: (pid, declarations) => ({ kind: 'declareBlockers', declarations: declarations || [] }),
  resolveChoice: (pid, data) => ({ kind: 'choice', data: data || {} }),
  concede: () => ({ kind: 'concede' }),
};
function strip(opts) {
  const o = {};
  for (const [k, v] of Object.entries(opts || {})) if (!ENGINE_ONLY.has(k) && v !== undefined) o[k] = v;
  return o;
}

/* ============================================================
   Known problems: reported, counted, not failed on. Each names the
   rule and a pattern for the message, and says why it is still here.
   ============================================================ */
const KNOWN = [];
function knownFor(v) { return KNOWN.find(k => k.rule === v.rule && k.match.test(`${v.path} ${v.msg}`)) || null; }

/* ============================================================
   Watching a game
   ============================================================ */
/** The real net code (09-net.js, and 09b-sync.js where there is one), loaded once, for the loopback check. */
let NetClass = null;
function loadNet(MTG) {
  if (NetClass !== null) return NetClass;
  NetClass = false;
  const src = (f) => path.join(__dirname, '..', 'src', f);
  try {
    const before = MTG.net;
    vm.runInThisContext(fs.readFileSync(src('09-net.js'), 'utf8'), { filename: '09-net.js' });
    NetClass = MTG.net.constructor;
    MTG.net = before || MTG.net;
    if (!MTG.sync && fs.existsSync(src('09b-sync.js'))) vm.runInThisContext(fs.readFileSync(src('09b-sync.js'), 'utf8'), { filename: '09b-sync.js' });
  } catch (e) { NetClass = false; }
  return NetClass;
}

/** A host and a guest joined by a pretend data channel that copies like JSON does. */
function loopback(MTG) {
  const Net = loadNet(MTG);
  if (!Net) return null;
  const host = new Net(), guest = new Net();
  host.mode = 'host'; guest.mode = 'client';
  const got = [];
  const wire = [];
  const toGuest = { open: true, peer: 'guest-1', send: (m) => { wire.push(m); guest._onClientData(JSON.parse(JSON.stringify(m))); } };
  const toHost = { open: true, peer: 'guest-1', send: (m) => { wire.push(m); host._onHostData(toHost, JSON.parse(JSON.stringify(m))); } };
  host.conns.set('guest-1', toGuest);
  guest.hostConn = toHost;
  guest.on('state', (v) => got.push(v));
  const fromGuest = [];
  host.on('intent', (peer, payload) => fromGuest.push(payload));
  /* Game views go to guests as 'sv' messages (09b-sync.js): a difference
     from the last view the guest acknowledged, with each card sent once.
     Both ends are wired the way 14-app.js wires them. */
  const enc = MTG.sync ? new MTG.sync.Encoder() : null;
  const dec = MTG.sync ? new MTG.sync.Decoder() : null;
  if (enc) {
    guest.on('message', (from, msg) => {
      if (!msg || msg.t !== 'sv') return;
      const r = dec.decode(msg);
      if (r.resync) guest.send(null, { t: 'resync' });
      if (!r.view) return;
      guest.send(null, { t: 'ack', n: r.ack });
      got.push(r.view);
    });
    host.on('message', (from, msg) => {
      if (msg && msg.t === 'ack') enc.ack(msg.n);
      else if (msg && msg.t === 'resync') enc.resync();
    });
  }
  return { host, guest, got, wire, fromGuest, enc };
}

/**
 * Watch a game: every view, question and engine call from outside is
 * checked. Call before g.start(). Options: label (for the report),
 * calls: false (leave engine calls alone, for test scaffolding that
 * drives the engine in ways no player could), net: false (skip the
 * loopback through 09-net.js). Returns { violations, known, counts, stop() }.
 */
function watch(g, MTG, opts) {
  opts = opts || {};
  const seen = new Map();          // grouping key -> violation (with count)
  const counts = { views: 0, choices: 0, calls: 0, answers: 0, messages: 0 };
  const label = opts.label || '';
  const context = (extra) => Object.assign({
    game: label, turn: g.turn, step: g.step,
    priority: g.priorityPlayer ? g.priorityPlayer.id : null,
    choice: g.pendingChoice ? g.pendingChoice.type : null,
  }, extra || {});
  const note = (list, ctx) => {
    for (const v of list) {
      const key = v.rule + '|' + v.path.replace(/\[\d+\]/g, '[]').replace(/\b(o|st|obj|tok)\d+\b/g, '#') + '|' + v.msg.replace(/\b[a-z]*\d+\b/gi, '#');
      const had = seen.get(key);
      if (had) { had.count++; continue; }
      seen.set(key, Object.assign({}, v, { count: 1, context: context(ctx), known: knownFor(v) }));
    }
  };
  const net = opts.net === false ? null : loopback(MTG);
  let lastV = -1;
  /* Once the engine's own lists disagree, every view after is wrong in
     the same way; the first report is the useful one. */
  let corrupt = false;
  const lastLine = () => { const l = g.log && g.log[g.log.length - 1]; return l ? l.text : ''; };
  const viewers = () => g.players.map(p => p.id).concat(['__watching']);
  /* the dice rolled since the last look, as each seat gets them; and the dice of one group are one player's, `of` at most */
  let evSeen = -1;
  const groups = new Map();
  const onEvents = () => {
    const list = g.events || [];
    for (const e of list) {
      if (e.seq <= evSeen || e.type !== 'roll') continue;
      const gr = groups.get(e.group) || { player: e.player, of: e.of, n: 0 };
      groups.set(e.group, gr);
      gr.n++;
      if (gr.player !== e.player || gr.of !== e.of || gr.n > gr.of) note([{ rule: 'event.sense', path: 'event.group', msg: `die group ${e.group}: ${gr.n} dice, ${e.of} said, rolled by ${gr.player} and ${e.player}` }], {});
      for (const pid of viewers()) {
        const r = MTG.events && MTG.events.redact ? MTG.events.redact(e, pid) : e;
        if (r) note(checkEvent(r, pid), { viewer: pid });
      }
    }
    if (list.length) evSeen = list[list.length - 1].seq;
    if (groups.size > 500) groups.clear();
  };
  const onState = () => {
    onEvents();
    if (g.stateVersion === lastV) return;
    lastV = g.stateVersion;
    if (!corrupt) {
      const z = checkZones(g, lastLine());
      if (z.length) { corrupt = true; note(z, {}); }
    }
    for (const pid of viewers()) {
      let v;
      try { v = g.viewFor(pid); } catch (e) { note([{ rule: 'view.throws', path: 'viewFor', msg: String(e && e.message || e) }], { viewer: pid }); continue; }
      counts.views++;
      note(checkView(v, pid, g).filter(x => !(corrupt && x.rule === 'view.sense')), { viewer: pid });
      /* through the real net code, once per state for the first seat */
      if (net && pid === g.players[0].id) {
        net.got.length = 0;
        net.wire.length = 0;
        const msg = net.enc ? net.enc.encode(v) : { t: 'state', payload: v };
        net.wire.length = 0;
        net.host.sendPerPeer(() => msg);
        counts.messages += net.wire.length;
        for (const m of net.wire) note(checkNetMessage(m, m.t === 'ack' || m.t === 'resync' ? 'toHost' : 'toGuest'), { viewer: pid, via: 'net' });
        const arrived = net.got[0];
        /* what the guest rebuilds has to be what the host sent, card for
           card; the log and events are carried separately */
        const bare = (x) => {
          // a card's _t is when the cache fetched it, which the sync leaves out on purpose
          const y = JSON.parse(JSON.stringify(x, (k, val) => (k === '_t' ? undefined : val)));
          delete y.log; delete y.events; delete y.eventSeq;
          return y;
        };
        if (!arrived) note([{ rule: 'net.loopback', path: msg.t, msg: 'a view sent through 09-net.js never arrived (or the guest had to ask again)' }], { viewer: pid });
        else {
          const where = firstDiff(bare(JSON.parse(JSON.stringify(v))), bare(arrived), 'view');
          if (where) note([{ rule: 'net.loopback', path: msg.t, msg: `the view the guest rebuilt is not the view the host sent (first difference: ${where})` }], { viewer: pid });
          // judged by the same game as the host's view: what a player may see depends on what they know (knownTo)
          note(checkView(arrived, pid, g).filter(x => x.rule !== 'view.sense' || !corrupt).map(x => Object.assign(x, { path: 'guest ' + x.path })), { viewer: pid, via: 'net' });
        }
      }
    }
  };
  const onChoice = (ch) => { counts.choices++; note(checkChoice(ch || g.pendingChoice, g), { asked: ch && ch.playerId }); };
  g.on('state', onState);
  g.on('choice', onChoice);

  /* Calls from outside the engine (bots, the runner) go through these
     wrappers; calls the engine makes to itself (depth > 0) are its own
     business. */
  let depth = 0;
  const wrapped = [];
  for (const name of opts.calls === false ? [] : Object.keys(CALLS)) {
    const orig = g[name];
    if (typeof orig !== 'function') continue;
    g[name] = function (...args) {
      if (depth === 0) {
        counts.calls++;
        const intent = CALLS[name](...args);
        note(checkIntent(intent), { call: name, actor: args[0] });
        if (name === 'resolveChoice') {
          counts.answers++;
          const ch = g.pendingChoice;
          note(checkAnswer(ch, args[1] || {}, g), { call: name, actor: args[0], asked: ch && ch.type });
        }
        if (name === 'declareAttackers' && g.pendingChoice && g.pendingChoice.type === 'declareAttackers') {
          const ch = g.pendingChoice;
          for (const d of args[1] || []) {
            if (!(ch.candidates || []).includes(d.attackerId)) note([{ rule: 'answer.sense', path: 'declarations[].attackerId', msg: `${d.attackerId} was not offered as an attacker` }], { call: name });
            if (!(ch.defenders || []).some(x => x.id === d.defenderId)) note([{ rule: 'answer.sense', path: 'declarations[].defenderId', msg: `${d.defenderId} was not offered as a defender` }], { call: name });
          }
        }
        /* a guest's intent travels inside a message too */
        if (net) {
          net.wire.length = 0;
          net.guest.intent(intent);
          const arrived = net.fromGuest.pop();
          counts.messages++;
          if (!arrived || JSON.stringify(arrived) !== JSON.stringify(JSON.parse(JSON.stringify(intent)))) note([{ rule: 'net.loopback', path: 'intent', msg: 'an intent sent through 09-net.js arrived changed or not at all' }], { call: name });
          for (const m of net.wire) note(checkNetMessage(m, 'toHost'), { call: name, via: 'net' });
          net.wire.length = 0;
        }
      }
      depth++;
      try { return orig.apply(this, args); } finally { depth--; }
    };
    wrapped.push([name, orig]);
  }

  function list() { return Array.from(seen.values()); }
  return {
    counts,
    get violations() { return list().filter(v => !v.known); },
    get known() { return list().filter(v => v.known); },
    stop() {
      onEvents();
      g.off('state', onState);
      g.off('choice', onChoice);
      for (const [name, orig] of wrapped) g[name] = orig;
    },
  };
}

/** One line per violation, with its context, for a terminal. */
function format(v) {
  const c = v.context || {};
  const where = [c.game, c.turn != null ? `turn ${c.turn}` : '', c.step, c.viewer ? `view for ${c.viewer}` : '',
    c.call ? `${c.call} by ${c.actor}` : '', c.asked ? `asking ${c.asked}` : '', c.choice ? `pending ${c.choice}` : ''].filter(Boolean).join(', ');
  return `${v.known ? 'known ' : ''}${v.rule} ${v.path}: ${v.msg}${v.count > 1 ? ` (x${v.count})` : ''}\n      at ${where}`;
}

/** Merge what several watches found. */
function merge(lists) {
  const by = new Map();
  for (const v of [].concat(...lists)) {
    const key = v.rule + '|' + v.path.replace(/\[\d+\]/g, '[]') + '|' + v.msg.replace(/\b[a-z]*\d+\b/gi, '#');
    const had = by.get(key);
    if (had) had.count += v.count; else by.set(key, Object.assign({}, v));
  }
  return Array.from(by.values());
}

/* ============================================================
   Self-test: each validator catches what it should and passes what it should
   ============================================================ */
function selfTest() {
  const fails = [];
  const expect = (what, problems, wantBad) => {
    if (wantBad && !problems.length) fails.push(`${what}: should have been refused`);
    if (!wantBad && problems.length) fails.push(`${what}: should have passed, got ${problems.map(p => p.path + ' ' + p.msg).join('; ')}`);
  };
  expect('pass intent', checkIntent({ kind: 'pass' }), false);
  expect('cast intent', checkIntent({ kind: 'cast', objId: 'o1', targets: [{ kind: 'player', id: 'B' }], x: 2 }), false);
  expect('cast intent with a stray field', checkIntent({ kind: 'cast', objId: 'o1', target: [] }), true);
  expect('unknown intent', checkIntent({ kind: 'fly' }), true);
  expect('activate without index', checkIntent({ kind: 'activate', objId: 'o1' }), true);
  expect('blocks', checkIntent({ kind: 'declareBlockers', declarations: [{ blockerId: 'o1', attackerIds: ['o2'] }] }), false);
  expect('blocks, old shape', checkIntent({ kind: 'declareBlockers', declarations: [{ blockerId: 'o1', attackerId: 'o2' }] }), true);
  const mode = { type: 'mode', playerId: 'A', count: 1, options: [{ i: 0, label: 'a' }, { i: 1, label: 'b' }], prompt: 'Choose one' };
  expect('mode question', checkChoice(mode), false);
  expect('mode question asking too much', checkChoice(Object.assign({}, mode, { count: 3 })), true);
  expect('mode answer', checkAnswer(mode, { modes: [1] }), false);
  expect('mode answer out of range', checkAnswer(mode, { modes: [4] }), true);
  const pick = { type: 'pickCard', playerId: 'A', count: 2, cards: [{ id: 'o1', name: 'x' }] };
  expect('pickCard that cannot be answered', checkChoice(pick), true);
  expect('pickCard answer from outside', checkAnswer(Object.assign({}, pick, { count: 1 }), { cardIds: ['o9'] }), true);
  expect('payOrDont in life with no cost', checkChoice({ type: 'payOrDont', playerId: 'A', life: 2, prompt: 'Pay 2 life?' }), true);
  expect('payOrDont in mana', checkChoice({ type: 'payOrDont', playerId: 'A', cost: '{2}' }), false);
  expect('payOrDont in energy', checkChoice({ type: 'payOrDont', playerId: 'A', cost: { energy: 2 }, energy: 2 }), false);
  expect('net state envelope without payload', checkNetMessage({ t: 'state', seq: 1 }, 'toGuest'), true);
  expect('net chunk', checkNetMessage({ t: '~', id: 1, i: 0, n: 2, d: '{' }, 'toGuest'), false);
  const ask = { type: 'choose', playerId: 'A', kind: 'options', options: [{ label: 'a', i: 0 }, { label: 'b', i: 1 }], min: 1, max: 1, prompt: 'Which?' };
  expect('choose question', checkChoice(ask), false);
  expect('choose question with no options', checkChoice(Object.assign({}, ask, { options: [] })), true);
  expect('choose answer', run(ANSWERS.choose, { picks: [1] }, 'a'), false);
  expect('choose answer, old shape', run(ANSWERS.choose, { cardIds: ['o1'] }, 'a'), true);
  // "choose a card name": nothing in sight to offer, and a name typed in
  expect('card name question with nothing offered', checkChoice(Object.assign({}, ask, { options: [], min: 0, max: 0, nameAny: { nonland: true } })), false);
  expect('card name typed in', run(ANSWERS.choose, { name: 'Lightning Bolt' }, 'a'), false);
  expect('card name typed in, too long', run(ANSWERS.choose, { name: 'x'.repeat(151) }, 'a'), true);
  expect('card name typed in where none may be', checkAnswer(mode, { name: 'Lightning Bolt' }), true);
  expect('cast with generic answers', checkIntent({ kind: 'cast', objId: 'o1', choices: { replicate: { number: 2 }, splice: { picks: ['o4'] } } }), false);
  expect('cast with the additional cost and the gift said', checkIntent({ kind: 'cast', objId: 'o1', payAdditional: true, gift: null, targets: [] }), false);
  expect('cast with a gift that is not yes or no', checkIntent({ kind: 'cast', objId: 'o1', gift: 'B' }), true);
  const die = { seq: 4, turn: 2, type: 'roll', player: 'A', sides: 20, result: 15, rolls: [7, 15], ignored: [7], group: 3, of: 1, source: null, sourceName: null };
  expect('a d20 with advantage', checkEvent(die, 'B'), false);
  expect('a d20 that came up 21', checkEvent(Object.assign({}, die, { result: 21, rolls: [21], ignored: [] }), 'B'), true);
  expect('a die whose result is not its highest', checkEvent(Object.assign({}, die, { result: 7 }), 'B'), true);
  expect('a die with no group', checkEvent(Object.assign({}, die, { group: 0 }), 'B'), true);
  expect('a secret die told to another player', checkEvent(Object.assign({}, die, { secret: true }), 'B'), true);
  expect('a secret die, hidden from another player', checkEvent(Object.assign({}, die, { secret: true, hidden: true, result: null, rolls: [null, null], ignored: [] }), 'B'), false);
  expect('a secret die, read by its roller', checkEvent(Object.assign({}, die, { secret: true }), 'A'), false);
  const o = []; jsonProblems({ a: [undefined], b: NaN, c: new Set() }, 'x', o);
  if (o.length !== 3) fails.push(`jsonProblems found ${o.length} of 3 problems`);
  return fails;
}

/* ============================================================
   Command line: a handful of watched games
   ============================================================ */
async function main() {
  const argv = process.argv.slice(2);
  const flag = (k) => argv.includes('--' + k);
  const val = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const fails = selfTest();
  console.log(fails.length ? `self-test: ${fails.length} failed\n  ${fails.join('\n  ')}` : 'self-test: validators behave');
  if (flag('selftest')) process.exit(fails.length ? 1 : 0);

  const { load } = require('./engine');
  const { playOne } = require('./sim');
  const MTG = load();
  const quick = flag('quick');
  const n = +val('games', quick ? 2 : 6);
  const seed = +val('seed', 1);
  const plan = [['standard', 2], ['pauper', 2], ['commander', 4]];
  const found = [];
  const totals = { views: 0, choices: 0, calls: 0, answers: 0, messages: 0 };
  let games = 0;
  for (const [formatId, players] of plan) {
    const games_ = formatId === 'commander' ? Math.max(1, Math.ceil(n / 2)) : n;
    for (let i = 0; i < games_; i++) {
      let mon = null;
      const r = await playOne(MTG, {
        formatId, players, seed: seed + i, diffA: 3 + (i % 6), diffB: 8 - (i % 5), maxTurns: 40,
        onGame: (g) => { mon = watch(g, MTG, { label: `${formatId} seed ${seed + i}` }); },
      });
      games++;
      if (mon) {
        mon.stop();
        for (const k of Object.keys(totals)) totals[k] += mon.counts[k];
        found.push(mon.violations.concat(mon.known));
      }
      console.log(`${formatId} seed ${seed + i}: ${r.over ? 'winner ' + r.winner : r.stalled ? 'STALLED' : 'turn cap'} turns=${r.turns}` +
        ` checked ${mon ? mon.counts.views : 0} views, ${mon ? mon.counts.choices : 0} questions, ${mon ? mon.counts.calls : 0} calls` +
        ` - ${mon ? mon.violations.length : '?'} violation kinds`);
    }
  }
  const all = merge(found);
  const real = all.filter(v => !v.known), known = all.filter(v => v.known);
  for (const v of real) console.log('  ' + format(v));
  for (const v of known) console.log('  ' + format(v));
  if (known.length) console.log(`known problems (not failing): ${known.length}\n  ` + Array.from(new Set(known.map(v => v.known.why))).join('\n  '));
  const offlineMisses = globalThis.__offlineMisses ? globalThis.__offlineMisses() : 0;
  console.log(`summary ${JSON.stringify(Object.assign({ games, violations: real.length, known: known.length, selfTestFailures: fails.length, offlineMisses }, totals))}`);
  process.exit(real.length || fails.length ? 1 : 0);
}

module.exports = {
  S, schemas: { View, RollEvent, PlayerView, ObjectView, HiddenObject, StackItemView, Choice, CHOICES, ANSWERS, Intent, INTENTS, NetToHost, NetToGuest },
  checkView, checkZones, checkChoice, checkAnswer, checkIntent, checkNetMessage, checkEvent, jsonProblems, watch, format, merge, selfTest, KNOWN,
};
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
