/* ============================================================
   06-rules.js - the rules engine
   Implements the parts of the Comprehensive Rules that a table needs
   enforced: zones (CR 400), turn structure (CR 500), priority and the
   stack (CR 117/405), casting and activating (CR 601/602), combat
   (CR 506-511), state-based actions (CR 704), and the Commander
   variant rules (CR 903).

   Card-specific text is executed when the Oracle parser understood it
   and handed to the players as a prompt when it did not - the same
   division of labour a paper game has.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const MANA = MTG.mana;
  const O = MTG.oracle;

  const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'stack', 'exile', 'command'];

  /* Returned by an effect that has stopped to ask somebody a question. It is
     only ever a return value inside one resolution, so it never needs to
     survive a snapshot. */
  const SUSPEND = Symbol('suspend');
  /* Effects that act on their targets and nothing else, which a trigger's
     "that creature" (scope triggerObject) is handed to as one. */
  const TRIGGER_OBJECT_OPS = new Set(['destroy', 'exile', 'bounce', 'tap', 'untap', 'damage', 'gainControl', 'fightSelf']);

  // Plain-English names for the combat restrictions an effect can impose.
  const FLAG_WORDS = {
    cantBlock: "can't block this turn",
    cantAttack: "can't attack this turn",
    cantAttackOrBlock: "can't attack or block this turn",
    mustBlock: 'blocks this turn if able',
    mustAttackEot: 'attacks this turn if able',
    attackDespiteDefender: "can attack this turn as though it didn't have defender",
  };

  const PHASES = [
    { id: 'beginning', name: 'Beginning', steps: ['untap', 'upkeep', 'draw'] },
    { id: 'precombat', name: 'Main 1', steps: ['main'] },
    { id: 'combat', name: 'Combat', steps: ['beginCombat', 'declareAttackers', 'declareBlockers', 'firstStrikeDamage', 'combatDamage', 'endCombat'] },
    { id: 'postcombat', name: 'Main 2', steps: ['main'] },
    { id: 'ending', name: 'Ending', steps: ['end', 'cleanup'] },
  ];
  const STEP_NAMES = {
    untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main: 'Main',
    beginCombat: 'Begin combat', declareAttackers: 'Declare attackers',
    declareBlockers: 'Declare blockers', firstStrikeDamage: 'First-strike damage',
    combatDamage: 'Combat damage', endCombat: 'End of combat',
    end: 'End step', cleanup: 'Cleanup',
  };

  /* ============================================================
     GameObject - one card/permanent/spell instance
     ============================================================ */
  let objCounter = 0;
  class GObj {
    constructor(card, owner, zone) {
      this.id = 'o' + (++objCounter);
      this.card = card;
      this.owner = owner;              // player id
      this.controller = owner;
      this.zone = zone || 'library';
      this.tapped = false;
      this.flipped = false;
      this.faceDown = false;
      this.face = 0;                   // which card_face is showing
      this.counters = {};              // {'+1/+1': 3, 'loyalty': 4, ...}
      this.damage = 0;
      this.summoningSick = true;
      this.attachedTo = null;          // object id
      this.attachments = [];           // object ids
      this.isToken = false;
      this.isCopy = false;
      this.phasedOut = false;
      this.effects = [];               // temporary continuous effects {p,t,keywords,until}
      this.markers = {};               // free-form notes players add
      this.entered = 0;                // turn number it entered the battlefield
      this.attacking = null;           // defender id while attacking
      this.blocking = [];              // attacker object ids
      this.blockedBy = [];             // blocker object ids
      this.blockOrder = [];
      this.removedFromCombat = false;
      this.chosenX = 0;
      this.targets = [];
      this.manualNote = '';
      this.revealedTo = null;          // array of player ids, for face-down reveals
      this.castFromCommandZone = false;
      this.foretold = false;
      this.note = '';
    }
    get name() {
      if (this.faceDown) return 'Face-down card';
      const f = this.card.card_faces && this.card.card_faces[this.face];
      return (f && f.name) || this.card.name;
    }
    analysis() {
      // face down, it is a 2/2 with no text — and that is what it is to
      // every rule that asks (CR 708.2)
      const base = this.faceDown ? O.faceDownAnalysis() : O.analyze(this.card, this.face);
      /* On the battlefield a permanent can be more than its printed text:
         an ability handed to it in quotation marks, a god that is not a
         creature while your devotion is short, a land Blood Moon has made a
         Mountain, a creature Humility has taken everything from. The game
         works that out, layer by layer (CR 613). */
      if (base && this.zone === 'battlefield' && this.game) return this.game._layeredAnalysis(this, base);
      return base;
    }
    /** What this card really is, whichever side is showing. */
    trueAnalysis() { return O.analyze(this.card, this.face); }
  }

  /** "three" and "3" both mean 3. */
  const WORD_NUM = (w) => {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const k = String(w || '').trim().toLowerCase();
    return words[k] != null ? words[k] : (parseInt(k, 10) || 0);
  };

  /* Subtypes that go with a card type other than creature (CR 205.3):
     when a permanent stops being a land, it stops being a Forest. */
  const LAND_TYPES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Desert', 'Gate', 'Lair', 'Locus',
    'Mine', 'Power-Plant', 'Tower', "Urza's", 'Cave', 'Sphere', 'Town', 'Planet']);
  const ARTIFACT_TYPES = new Set(['Equipment', 'Vehicle', 'Food', 'Treasure', 'Clue', 'Blood', 'Gold', 'Powerstone',
    'Fortification', 'Contraption', 'Map', 'Incubator', 'Attraction', 'Bobblehead', 'Junk', 'Lander', 'Spacecraft', 'Infinity', 'Stone']);
  const ENCHANTMENT_TYPES = new Set(['Aura', 'Saga', 'Class', 'Shrine', 'Curse', 'Cartouche', 'Rune', 'Room',
    'Background', 'Case', 'Role', 'Shard']);
  const EMPTY_SET = new Set();

  /* The dungeons (CR 309), room by room as their cards print them: each
     room's ability, and the rooms it leads to. Undercity is entered only
     by venturing into Undercity (the initiative). */
  const DUNGEON_TEXT = {
    'Lost Mine of Phandelver': [
      'Cave Entrance \u2014 Scry 1. (Leads to: Goblin Lair, Mine Tunnels)',
      'Goblin Lair \u2014 Create a 1/1 red Goblin creature token. (Leads to: Storeroom, Dark Pool)',
      'Mine Tunnels \u2014 Create a Treasure token. (Leads to: Dark Pool, Fungi Cavern)',
      'Storeroom \u2014 Put a +1/+1 counter on target creature. (Leads to: Temple of Dumathoin)',
      'Dark Pool \u2014 Each opponent loses 1 life and you gain 1 life. (Leads to: Temple of Dumathoin)',
      'Fungi Cavern \u2014 Target creature gets -4/-0 until your next turn. (Leads to: Temple of Dumathoin)',
      'Temple of Dumathoin \u2014 Draw a card.'],
    'Dungeon of the Mad Mage': [
      'Yawning Portal \u2014 You gain 1 life. (Leads to: Dungeon Level)',
      'Dungeon Level \u2014 Scry 1. (Leads to: Goblin Bazaar, Twisted Caverns)',
      'Goblin Bazaar \u2014 Create a Treasure token. (Leads to: Lost Level)',
      "Twisted Caverns \u2014 Target creature can't attack until your next turn. (Leads to: Lost Level)",
      "Lost Level \u2014 Scry 2. (Leads to: Runestone Caverns, Muiral's Graveyard)",
      'Runestone Caverns \u2014 Exile the top two cards of your library. You may play them. (Leads to: Deep Mines)',
      "Muiral's Graveyard \u2014 Create two 1/1 black Skeleton creature tokens. (Leads to: Deep Mines)",
      "Deep Mines \u2014 Scry 3. (Leads to: Mad Wizard's Lair)",
      "Mad Wizard's Lair \u2014 Draw three cards and reveal them. You may cast one of them without paying its mana cost."],
    'Tomb of Annihilation': [
      'Trapped Entry \u2014 Each player loses 1 life. (Leads to: Veils of Fear, Oubliette)',
      'Veils of Fear \u2014 Each player loses 2 life unless they discard a card. (Leads to: Sandfall Cell)',
      'Sandfall Cell \u2014 Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice. (Leads to: Cradle of the Death God)',
      'Oubliette \u2014 Discard a card and sacrifice a creature, an artifact, and a land. (Leads to: Cradle of the Death God)',
      'Cradle of the Death God \u2014 Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.'],
    'Undercity': [
      'Secret Entrance \u2014 Search your library for a basic land card, reveal it, put it into your hand, then shuffle. (Leads to: Forge, Lost Well)',
      'Forge \u2014 Put two +1/+1 counters on target creature. (Leads to: Trap!, Arena)',
      'Lost Well \u2014 Scry 2. (Leads to: Arena, Stash)',
      'Trap! \u2014 Target player loses 5 life. (Leads to: Archives)',
      'Arena \u2014 Goad target creature. (Leads to: Archives, Catacombs)',
      'Stash \u2014 Create a Treasure token. (Leads to: Catacombs)',
      'Archives \u2014 Draw a card. (Leads to: Throne of the Dead Three)',
      'Catacombs \u2014 Create a 4/1 black Skeleton creature token with menace. (Leads to: Throne of the Dead Three)',
      'Throne of the Dead Three \u2014 Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. It gains hexproof until your next turn. Then shuffle.'],
  };
  /* Rooms whose words the text reader does not take in, written out in the
     engine's terms. The rest are read from their words as they are entered. */
  const CREATURE_TARGET = { type: 'creature', filter: 'creature', zone: 'battlefield' };
  const ROOM_EFFECTS = {
    'Fungi Cavern': [{ op: 'pump', p: -4, t: 0, duration: 'nextTurn', targets: [CREATURE_TARGET] }],
    'Twisted Caverns': [{ op: 'restrict', flag: 'cantAttack', duration: 'nextTurn', targets: [CREATURE_TARGET] }],
    'Runestone Caverns': [{ op: 'impulse', n: 2, play: true, duration: 'exiled' }],
    'Trapped Entry': [{ op: 'loseLife', n: 1, who: 'each' }],
    'Oubliette': [{ op: 'discard', n: 1, who: 'you' }, { op: 'sacrificeChoice', n: 1, who: 'you', filter: 'creature' },
      { op: 'sacrificeChoice', n: 1, who: 'you', filter: 'artifact' }, { op: 'sacrificeChoice', n: 1, who: 'you', filter: 'land' }],
    'Cradle of the Death God': [{ op: 'createToken', n: 1, pt: '4/4', colorWords: ['black'], subtypes: 'God Horror', addTypes: [],
      keywords: ['Deathtouch'], legendary: true, name: 'The Atropal' }],
  };
  const DUNGEONS = {};
  for (const [name, lines] of Object.entries(DUNGEON_TEXT)) {
    DUNGEONS[name] = lines.map(l => {
      const m = l.match(/^(.+?) \u2014 (.+?)(?: \(Leads to: (.+)\))?$/);
      return { name: m[1], text: m[2], leads: m[3] ? m[3].split(', ') : [] };
    });
  }
  /* What a face-down card looks like to anybody not allowed to look (CR 708.2). */
  const FACE_DOWN_VIEW = Object.freeze({ id: '__facedown__', name: 'Face-down card', type_line: 'Creature',
    oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], layout: 'normal',
    power: '2', toughness: '2' });

  /* ============================================================
     Player
     ============================================================ */
  class Player {
    constructor(cfg, game) {
      this.id = cfg.id || MTG.uid('p');
      this.name = cfg.name || 'Player';
      this.seat = cfg.seat || 0;
      this.isBot = !!cfg.isBot;
      this.botDifficulty = cfg.botDifficulty || 5;
      this.botPersonality = cfg.botPersonality || null;
      this.avatarColor = cfg.avatarColor || null;
      this.game = game;
      this.life = game.config.startingLife;
      this.poison = 0;
      this.energy = 0;
      this.experience = 0;
      this.pool = new MTG.ManaPool();
      this.landsPlayed = 0;
      this.maxLands = 1;
      this.hasLost = false;
      this.hasWon = false;
      this.lossReason = '';
      this.conceded = false;
      this.drewFromEmpty = false;
      this.commanderDamage = {};       // commanderObjId -> damage
      this.commanderCasts = {};        // commanderObjId -> times cast from command zone
      this.mulligansTaken = 0;
      this.keptHand = false;
      this.bottomAfterMulligan = 0;
      this.connected = true;
      this.deck = cfg.deck || null;
      this.extraTurns = 0;
      this.skipNextDraw = false;
      this.maxHandSize = 7;
      /* The Ring (CR 701.52): the emblem's level, and who is carrying it. */
      this.ringLevel = 0;
      this.ringBearer = null;
    }
    get zones() { return this.game.zones[this.id]; }
    lib() { return this.game.zones[this.id].library; }
    hand() { return this.game.zones[this.id].hand; }
    gy() { return this.game.zones[this.id].graveyard; }
    exileZone() { return this.game.zones[this.id].exile; }
    command() { return this.game.zones[this.id].command; }
    battlefield() { return this.game.battlefield.filter(o => o.controller === this.id); }
  }

  /* ============================================================
     Game
     ============================================================ */
  class Game extends MTG.Emitter {
    constructor(config) {
      super();
      this.config = Object.assign({
        formatId: 'commander',
        startingLife: 40,
        startingHand: 7,
        commanderDamage: 21,
        maxPlayers: 4,
        seed: Date.now(),
        firstPlayerDraws: false,
        freeMulligans: 0,              // taken before cards go on the bottom
        rulesEnforcement: 'full',      // 'full' | 'relaxed'
      }, config || {});
      this.rng = new MTG.RNG(this.config.seed);
      this.players = [];
      this.zones = {};                 // playerId -> {library, hand, graveyard, exile, command}
      this.battlefield = [];
      this.stack = [];
      this.objects = new Map();        // id -> GObj
      this.turn = 0;
      this.activeIndex = 0;
      this.phaseIndex = 0;
      this.stepIndex = 0;
      this.priorityIndex = 0;
      this.passedInSuccession = new Set();
      this.started = false;
      this.over = false;
      this.winners = [];
      this.log = [];
      this.pendingTriggers = [];
      this.pendingChoice = null;       // {type, playerId, ...} blocks the game
      this.combat = { attackers: [], blockers: [], damageDealt: false, firstStrikeDone: false };
      this.turnOrder = [];
      this.stateVersion = 0;
      this.mulliganPhase = false;
      this.extraTurnsQueue = [];
      this.stormCount = 0;
      this.prevention = [];            // "prevent all damage this turn" effects
      this.resolving = null;           // the effect list currently mid-flight
      this._boardEpoch = 0;            // bumped whenever the battlefield changes
      this.delayedTriggers = [];       // "at the beginning of the next end step, ..." 
      this.replayLog = [];
      this.lastAction = null;
      /* Object and stack ids are counted per game, not per page, so the
         same game played twice from the same seed names everything the
         same way — which is what lets a replay be checked against it. */
      this._objSeq = 0;
      this._uidSeq = 0;
    }

    /* ---------- setup ---------- */
    addPlayer(cfg) {
      const p = new Player(Object.assign({ seat: this.players.length }, cfg), this);
      this.players.push(p);
      this.zones[p.id] = { library: [], hand: [], graveyard: [], exile: [], command: [] };
      return p;
    }
    player(id) { return this.players.find(p => p.id === id); }
    obj(id) { return this.objects.get(id); }

    _register(o) { o.id = 'o' + (++this._objSeq); this.objects.set(o.id, o); this._own(o); return o; }
    /** A stack, trigger or delayed-trigger id, unique within this game. */
    _uid(prefix) { return (prefix || 'x') + '_' + (++this._uidSeq).toString(36); }
    /* An object knows which game it is in, so that what it is right now can
       depend on the rest of the board. Kept out of sight of anything that
       copies or serialises it. */
    _own(o) { Object.defineProperty(o, 'game', { value: this, enumerable: false, writable: true, configurable: true }); }

    /** Build a player's library and command zone from their deck. */
    loadDeck(playerId, deck) {
      const p = this.player(playerId);
      const z = this.zones[playerId];
      z.library.length = 0; z.command.length = 0;
      for (const e of deck.main) {
        for (let i = 0; i < e.qty; i++) {
          const o = this._register(new GObj(e.card, playerId, 'library'));
          z.library.push(o);
        }
      }
      for (const c of (deck.commanders || [])) {
        const o = this._register(new GObj(c, playerId, 'command'));
        o.isCommander = true;
        z.command.push(o);
        p.commanderDamage[o.id] = 0;
        p.commanderCasts[o.id] = 0;
      }
      p.sideboard = (deck.sideboard || []).map(e => ({ card: e.card, qty: e.qty }));
      p.deck = deck;
      this.rng.shuffle(z.library);
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.turnOrder = this.players.map(p => p.id);
      this.rng.shuffle(this.turnOrder);
      this.activeIndex = 0;
      this.priorityIndex = 0;
      for (const p of this.players) {
        const z = this.zones[p.id];
        this.rng.shuffle(z.library);
        this._drawCards(p, this.config.startingHand, true);
      }
      this.mulliganPhase = true;
      this.logEvent('game', `Game begins. ${this.players.length} players. Turn order: ${this.turnOrder.map(id => this.player(id).name).join(' → ')}.`);
      this.emit('mulligan:begin');
      this.touch();
    }

    /* ---------- mulligans (London, CR 103.4) ---------- */
    mulligan(playerId) {
      const p = this.player(playerId);
      if (!this.mulliganPhase || p.keptHand) return this.fail('Not mulliganing.');
      const z = this.zones[playerId];
      for (const o of z.hand.splice(0)) { o.zone = 'library'; z.library.push(o); }
      this.rng.shuffle(z.library);
      p.mulligansTaken++;
      this._drawCards(p, this.config.startingHand, true);
      this.logEvent('mulligan', `${p.name} mulligans to ${Math.max(0, this.config.startingHand - this.bottomCountFor(p))}.`);
      this.emit('sfx', 'shuffle');
      this.touch();
    }
    /** How many cards this player puts back, once free mulligans are spent. */
    bottomCountFor(p) {
      const free = Math.max(0, this.config.freeMulligans || 0);
      return Math.max(0, (p.mulligansTaken || 0) - free);
    }
    keepHand(playerId, bottomIds) {
      const p = this.player(playerId);
      if (!this.mulliganPhase || p.keptHand) return this.fail('Already kept.');
      const need = this.bottomCountFor(p);
      bottomIds = bottomIds || [];
      if (bottomIds.length !== need)
        return this.fail(`Put ${need} card${need === 1 ? '' : 's'} on the bottom.`);
      const z = this.zones[playerId];
      for (const id of bottomIds) {
        const i = z.hand.findIndex(o => o.id === id);
        if (i < 0) return this.fail('Card not in hand.');
        const [o] = z.hand.splice(i, 1);
        o.zone = 'library'; z.library.push(o);
      }
      p.keptHand = true;
      p.bottomAfterMulligan = need;
      this.logEvent('mulligan', `${p.name} keeps ${z.hand.length}.`);
      if (this.players.every(x => x.keptHand)) this._beginFirstTurn();
      this.touch();
    }
    _beginFirstTurn() {
      this.mulliganPhase = false;
      this.turn = 0;
      this.activeIndex = -1;            // _nextTurn bumps to 0
      this.emit('mulligan:end');
      /* A Leyline in an opening hand may start the game on the battlefield
         (CR 103.6). Everyone is asked before the first turn begins. */
      if (this._offerLeylines()) { this._awaitingLeylines = true; return; }
      this._nextTurn();
    }

    /** Ask each player about any Leyline they are holding. */
    _offerLeylines() {
      let asked = false;
      for (const pid of this.turnOrder) {
        for (const o of ((this.zones[pid] || {}).hand || []).slice()) {
          const a = o.analysis();
          const ley = this._leylineOf(a);
          if (!ley) continue;
          // Gemstone Caverns: only for a player who is not going first
          if (ley.notStarting && pid === this.turnOrder[0]) continue;
          this.queueChoice({
            type: 'confirm', playerId: pid, purpose: 'leyline', objId: o.id,
            prompt: `Begin the game with ${o.name} on the battlefield?`,
          });
          asked = true;
        }
      }
      return asked;
    }

    /** The "begin the game with this on the battlefield" rule a card carries, if any. */
    _leylineOf(a) {
      for (const ab of ((a && a.abilities) || [])) for (const e of (ab.effects || [])) if (e && e.op === 'leyline') return e;
      return null;
    }

    /* ---------- turn flow ---------- */
    get activePlayer() { return this.player(this.turnOrder[this.activeIndex]) || this.players[0]; }
    get priorityPlayer() { return this.player(this.turnOrder[this.priorityIndex]); }
    get phase() { return PHASES[this.phaseIndex]; }
    get step() { return this.phase.steps[this.stepIndex]; }
    get stepName() { return STEP_NAMES[this.step] || this.step; }
    get isMain() { return this.step === 'main'; }
    get stackEmpty() { return this.stack.length === 0; }

    _nextTurn() {
      if (this.over) return;
      // extra turns first
      if (this.extraTurnsQueue.length) {
        const pid = this.extraTurnsQueue.shift();
        this.activeIndex = this.turnOrder.indexOf(pid);
      } else {
        let guard = 0;
        do {
          this.activeIndex = (this.activeIndex + 1) % this.turnOrder.length;
          guard++;
        } while (this.player(this.turnOrder[this.activeIndex]).hasLost && guard <= this.turnOrder.length);
      }
      this.turn++;
      this.stormCount = 0;
      /* Whose turn it is changes what some permanents are (living metal),
         so the cached characteristics have to be thrown away. */
      this.bumpBoard();
      // morbid, revolt, raid and their relatives all ask what has already
      // happened this turn, so the turn keeps a short memory
      this.turnHistory = { creaturesDied: 0, permanentsLeft: 0, attacked: false };
      for (const o of this.battlefield) o.noRegenThisTurn = false;
      // "until your next turn" ends as that turn begins
      for (const o of this.battlefield) {
        if ((o.effects || []).some(e => e.untilTurnOf === this.turnOrder[this.activeIndex])) {
          o.effects = o.effects.filter(e => e.untilTurnOf !== this.turnOrder[this.activeIndex]);
          o._chr = null;
        }
      }
      const ap = this.activePlayer;
      ap.landsPlayed = 0;
      ap.turnsTaken = (ap.turnsTaken || 0) + 1;
      /* "until your next turn" is over, and what phased out phases back in */
      if (ap.protection && ap.protection.setTurn < this.turn) ap.protection = null;
      if (ap.lifeLocked && ap.lifeLocked.setTurn < this.turn) ap.lifeLocked = null;
      for (const o of this.battlefield) {
        if (o.phasedOut && o.phasedOutBy === ap.id && o.phasedTurn < this.turn) { o.phasedOut = false; o.phasedOutBy = null; }
      }
      /* "You may play an additional land this turn" lasts for this turn
         only; the standing ones are counted as they are asked about. */
      for (const p of this.players) p.maxLands = 1;
      /* What happened last turn, for the cards that ask (the werewolves). */
      this.spellsLastTurn = {};
      for (const p of this.players) this.spellsLastTurn[p.id] = p.spellsCastThisTurn || 0;
      for (const p of this.players) { p.pool.clear(); p.spellsCastThisTurn = 0; p.spellObjsThisTurn = []; p.drawnThisTurn = 0; p.lifeLostThisTurn = 0; p.lifeGainedThisTurn = 0; }
      for (const o of this.battlefield) o._afflicted = false;
      this.phaseIndex = 0; this.stepIndex = 0;
      this.logEvent('turn', `--- Turn ${this.turn}: ${ap.name} ---`);
      this.emit('sfx', 'turn_start');
      this.emit('turn:begin', ap);
      this._enterStep();
    }

    _advanceStep() {
      if (this.over) return;
      this.holdFor = null;          // holding priority lasts for one step only
      // clear mana pools between steps and phases (CR 500.4)
      for (const p of this.players) {
        /* …unless something said the mana keeps until combat is over. */
        if (p.poolKeepUntil === 'combat' && this.phase && this.phase.id === 'combat') continue;
        if (!p.pool.isEmpty()) { this.logEvent('mana', `${p.name}'s mana pool empties (${p.pool}).`); }
        p.pool.clear();
        p.restricted = [];
        p.manaRiders = [];
        p.poolKeepUntil = null;
      }
      this.stepIndex++;
      if (this.stepIndex >= this.phase.steps.length) {
        this.phaseIndex = this._nextPhaseIndex(); this.stepIndex = 0;
        if (this.phaseIndex >= PHASES.length) { this._endTurn(); return; }
      }
      // combat phase can be skipped entirely if nobody can attack - we still
      // walk it so triggers fire, but declare-blockers is skipped with no attackers
      this._enterStep();
    }

    /* "After this phase, there is an additional combat phase": the phases
       promised for after this one come first, then the turn carries on
       from where it would have gone. */
    _nextPhaseIndex() {
      const cur = this.phaseIndex;
      const due = (this._extraPhases || []).filter(x => x.turn === this.turn && x.after === cur);
      if (due.length) {
        this._extraPhases = this._extraPhases.filter(x => !due.includes(x));
        if (this._resumePhase == null) this._resumePhase = cur + 1;
        const add = [];
        for (const x of due) add.push(...x.phases);
        this._phaseQueue = add.concat(this._phaseQueue || []);
      }
      if (this._phaseQueue && this._phaseQueue.length) return this._phaseQueue.shift();
      if (this._resumePhase != null) { const r = this._resumePhase; this._resumePhase = null; return r; }
      return cur + 1;
    }

    _endTurn() {
      const ap = this.activePlayer;
      this._phaseQueue = null; this._resumePhase = null; this._extraPhases = [];
      this._checkDayNight();          // day/night flips between turns
      this.spellsThisTurn = 0;
      // cleanup already ran as a step
      this.emit('turn:end', ap);
      this._nextTurn();
    }

    _enterStep() {
      const step = this.step;
      this._expireFullControl();
      this.emit('step:begin', this.phase.id, step);
      this.combatCleanupIfNeeded(step);
      switch (step) {
        case 'untap': this._untapStep(); return;                // no priority
        case 'upkeep':
          this._cumulativeUpkeep();
          this._tickSuspended(this.activePlayer.id);
          this._rebound(this.activePlayer.id);
          this._fire('yourUpkeep', this.activePlayer.id); this._fire('eachUpkeep', null, { playerId: this.activePlayer.id });
          // the initiative: "at the beginning of your upkeep, venture into Undercity"
          if (this.activePlayer.initiative) this._initiativeVenture(this.activePlayer.id);
          this._fire('opponentUpkeep', null, { except: this.activePlayer.id, playerId: this.activePlayer.id }); break;
        case 'draw': this._drawStep(); break;
        case 'main':
          if (this.phase.id === 'precombat') {
            for (const o of this.battlefield.slice()) {
              const sa = o.analysis();
              if (sa && sa.isSaga && o.controller === this.activePlayer.id) this._advanceSaga(o, 1);
            }
          }
          if (this.phase.id === 'precombat') this._fire('yourMain1', this.activePlayer.id);
          if (this.phase.id === 'precombat') this._fire('eachMain1', null, { playerId: this.activePlayer.id });
          // "at the beginning of your second main phase"
          if (this.phase.id === 'postcombat') this._fire('yourMain2', this.activePlayer.id);
          break;
        case 'beginCombat':
          // "if it's the first combat phase of the turn"
          this.combatsThisTurn = this._combatTurn === this.turn ? (this.combatsThisTurn || 0) + 1 : 1;
          this._combatTurn = this.turn;
          this._fire('yourCombatBegin', this.activePlayer.id);
          this._fire('eachCombatBegin', null, {});
          break;
        case 'declareAttackers': this._declareAttackersStep(); return;
        case 'declareBlockers': this._declareBlockersStep(); return;
        case 'firstStrikeDamage':
          if (!this._anyFirstStrike()) { this._advanceStep(); return; }
          this._combatDamage(true); break;
        case 'combatDamage':
          if (!this.combat.attackers.length) { this._advanceStep(); return; }
          this._combatDamage(false); break;
        case 'endCombat': this._fire('endOfCombat', null, {}); this._endCombat(); break;
        case 'end': {
          // the monarch draws a card at the beginning of their end step (CR 720.3a)
          const king = this.players.find(p => p.monarch && !p.hasLost);
          if (king && this.activePlayer && king.id === this.activePlayer.id) {
            this._drawCards(king, 1);
            this.logEvent('monarch', `${king.name} draws for being the monarch.`);
          }
          this._fire('yourEndStep', this.activePlayer.id); this._fire('eachEndStep', null, { playerId: this.activePlayer.id });
          break;
        }
        case 'cleanup': this._cleanupStep(); return;            // no priority normally
      }
      this.checkStateBasedActions();
      this._givePriority(this.activeIndex);
      this.touch();
    }

    _untapStep() {
      const ap = this.activePlayer;
      let n = 0;
      // "untap all permanents you control during each other player's untap step"
      const alsoUntap = [];
      for (const src of this.battlefield) {
        const ef = this._staticOp(src, 'untapOnEveryUntapStep');
        if (ef) alsoUntap.push({ controller: src.controller, filter: ef.filter || null, selfId: ef.selfOnly ? src.id : null });
      }
      // Unwinding Clock untaps only artifacts, Bender's Waterskin only itself
      const untapsAnyway = (o) => alsoUntap.some(u => u.controller === o.controller &&
        (u.selfId ? u.selfId === o.id : (!u.filter || u.filter === 'permanent' || this._matchesCategory(o, u.filter))));
      for (const o of this.battlefield) {
        if (o.controller !== ap.id && !untapsAnyway(o)) continue;
        const stuck = this._hasFlag(o, 'noUntap');
        /* "You may choose not to untap CARDNAME during your untap step" —
           a choice, and one worth keeping: it is how the old cumulative
           upkeep cards are turned off. Left as a standing preference on
           the permanent so the untap step does not stop to ask every
           turn; the menu on the card sets it. */
        if (o.tapped && o.keepTapped && this._staticOp(o, 'optionalUntap')) {
          this.logEvent('step', `${o.name} stays tapped.`);
          continue;
        }
        if (o.noUntapNext || stuck) {
          o.noUntapNext = false;
          if (o.tapped) this.logEvent('step', `${o.name} does not untap.`);
        } else if (o.tapped) {
          o.tapped = false; n++;
          // "Whenever this artifact becomes untapped" waits for upkeep to be put on the stack
          this._fire('becomesUntapped', o.controller, { source: o, object: o });
        }
        if (o.controller === ap.id) o.summoningSick = false;
      }
      // everything you control loses summoning sickness at your untap
      for (const o of this.battlefield) if (o.controller === ap.id) o.summoningSick = false;
      if (n) this.emit('sfx', 'untap_all');
      this.logEvent('step', `${ap.name} untaps${n ? ` (${n})` : ''}.`);
      this.checkStateBasedActions();
      this._advanceStep();
    }

    /**
     * Cumulative upkeep (CR 702.24): an age counter goes on first, and then
     * the cost is that many times over. It is a clock printed on the card —
     * the permanent is kept for as long as it is worth keeping and sacrificed
     * when it is not, which is the whole point of the mechanic.
     */
    _cumulativeUpkeep() {
      const ap = this.activePlayer;
      for (const o of this.battlefield.slice()) {
        if (o.controller !== ap.id) continue;
        const e = this._staticOp(o, 'cumulativeUpkeep');
        if (!e) continue;
        o.counters.age = (o.counters.age || 0) + 1;
        const n = o.counters.age;
        if (e.life) {
          /* "Cumulative upkeep — Pay 1 life" is the same clock in a
             different currency. */
          const owed = e.life * n;
          this.queueChoice({
            type: 'payOrDont', playerId: ap.id, objId: o.id, life: owed, cost: { life: owed },
            purpose: 'cumulativeUpkeep',
            prompt: `Pay ${owed} life for ${o.name}? If you don't, it is sacrificed.`,
          });
          continue;
        }
        if (e.energy) {
          /* Some of them are paid in energy rather than mana. */
          const owed = e.energy * n;
          this.queueChoice({
            type: 'payOrDont', playerId: ap.id, objId: o.id, energy: owed, cost: { energy: owed },
            purpose: 'cumulativeUpkeep',
            prompt: `Pay ${owed} energy for ${o.name}? If you don't, it is sacrificed.`,
          });
          continue;
        }
        const cost = String(e.cost || '').repeat(n);
        this.logEvent('upkeep', `${o.name}: cumulative upkeep ${cost} (${n} age counter${n > 1 ? 's' : ''}).`);
        this.queueChoice({
          type: 'payOrDont', playerId: ap.id, objId: o.id, cost,
          purpose: 'cumulativeUpkeep',
          prompt: `Pay ${cost} for ${o.name}? If you don't, it is sacrificed.`,
        });
      }
    }

    _drawStep() {
      const ap = this.activePlayer;
      const skipFirst = this.turn === 1 && !this.config.firstPlayerDraws;
      if (skipFirst) {
        this.logEvent('step', `${ap.name} skips the first draw.`);
      } else if (ap.skipNextDraw || ap.skipEveryDraw) {
        ap.skipNextDraw = false;
        this.logEvent('step', `${ap.name} skips their draw.`);
      } else {
        /* Dredge (CR 702.52): the draw may be replaced by milling and
           taking a dredge card back. Offered for the draw of the draw step. */
        const dr = this._dredgeOptions(ap);
        if (dr.length && !ap.isBot) {
          this.queueChoice({ type: 'mode', playerId: ap.id, purpose: 'dredge', count: 1,
            options: [{ i: 0, label: 'Draw a card' }].concat(dr.map((x, k) => ({ i: k + 1, label: `Dredge ${x.n}: mill ${x.n} and return ${x.o.name}` }))),
            values: [null].concat(dr.map(x => x.o.id)), prompt: 'Draw your card, or dredge?' });
        } else if (dr.length && this.zones[ap.id].library.length > 15) this._dredge(ap, dr[0].o);
        else this._drawCards(ap, 1);
      }
      this._fire('yourDrawStep', ap.id);
      this._fire('eachDrawStep', null, { playerId: ap.id });
    }

    /** Anything that dashed in goes home when the turn ends (CR 702.109a),
        and anything blitzed in is sacrificed and replaces itself. */
    _returnDashed() {
      for (const o of this.battlefield.slice()) {
        if (o.sacAtEndOfTurn === this.turn) {
          o.sacAtEndOfTurn = null;
          this.logEvent('sacrifice', `${o.name} is sacrificed at end of turn.`);
          this.moveObject(o, 'graveyard');
          continue;
        }
        if (o.warpedTurn === this.turn) {
          o.warpedTurn = null;
          this.logEvent('rules', `${o.name} was warped in: it is exiled.`);
          this.moveObject(o, 'exile');
          o.warpExiled = true;
          continue;
        }
        if (o.dashedTurn === this.turn) {
          o.dashedTurn = null;
          this.logEvent('rules', `${o.name} goes back to its owner's hand (dash).`);
          this.moveObject(o, 'hand');
          continue;
        }
        if (o.blitzedTurn === this.turn) {
          o.blitzedTurn = null;
          this.logEvent('rules', `${o.name} was blitzed: it is sacrificed.`);
          const who = o.controller;
          this.moveObject(o, 'graveyard');
          this._drawCards(this.player(who), 1);
        }
      }
    }

    _cleanupStep() {
      const ap = this.activePlayer;
      this._returnDashed();
      // discard to hand size
      const hand = this.zones[ap.id].hand;
      if (this._anyStaticOf(ap.id, 'noMaxHandSize') || ap.noMaxHand) {
        this.logEvent('step', `${ap.name} has no maximum hand size.`);
        this._finishCleanup();
        return;
      }
      if (hand.length > ap.maxHandSize && !ap.isBot) {
        this.pendingChoice = {
          type: 'discardToHandSize', playerId: ap.id,
          count: hand.length - ap.maxHandSize,
          prompt: `Discard down to ${ap.maxHandSize} cards.`,
        };
        this.emit('choice', this.pendingChoice);
        this.touch();
        return;
      }
      if (hand.length > ap.maxHandSize) {
        // bots discard their worst cards
        const toss = hand.slice().sort((a, b) => this._cardValue(a) - this._cardValue(b)).slice(0, hand.length - ap.maxHandSize);
        for (const o of toss) this.moveObject(o, 'graveyard');
        this.logEvent('discard', `${ap.name} discards ${toss.length} to hand size.`);
      }
      this._finishCleanup();
    }
    _finishCleanup() {
      // remove damage and until-end-of-turn effects (CR 514.2)
      this.prevention = [];
      this._exileOnDeath = null;
      for (const p of this.players) p.preventShield = 0;
      for (const o of this.battlefield) {
        o.damage = 0;
        o.damagedThisTurn = false;
        o.shields = 0;
        o.preventShield = 0;
        // "gain control of target creature until end of turn" ends here
        const back = o.effects.find(e => e.untilControl && e.until === 'eot');
        if (back && back.prevController != null && this.player(back.prevController)) {
          o.controller = back.prevController;
          this.bumpBoard();
        }
        o.effects = o.effects.filter(e => e.until !== 'eot');
        /* A copy that lasts until end of turn is what it was again: itself,
           or a Clone that was already a copy before Mirrorweave (CR 707). */
        if (o.copyUntilTurn != null && o.printedCard) {
          const back = o.copyBefore;
          if (back && back.card && back.card !== o.printedCard) { o.card = back.card; o.face = back.face || 0; o.copyOf = back.copyOf || back.card; }
          else { o.card = o.printedCard; o.printedCard = null; o.copyOf = null; }
          o.copyUntilTurn = null; o.copyBefore = null; o._chr = null;
          this.bumpBoard();
        }
        o.removedFromCombat = false;
        o.attacking = null; o.blocking = []; o.blockedBy = []; o.blockOrder = [];
      }
      this.checkStateBasedActions();
      if (this.pendingTriggers.length || this.stack.length) {
        // a cleanup that generates triggers gets priority and another cleanup
        this._givePriority(this.activeIndex);
        this.touch();
        return;
      }
      this._advanceStep();
    }

    /* ---------- priority (CR 117) ---------- */
    _givePriority(index) {
      this.priorityIndex = index;
      this.passedInSuccession.clear();
      this._putTriggersOnStack();
      const p = this.priorityPlayer;
      if (p && p.hasLost) { this.passPriority(p.id, true); return; }
      this.emit('priority', p);
      this.touch();
      this._maybeAutoPass();
    }

    /* ---------- auto-pass (a shortcut, never a rules change) ----------
       The rules give you priority constantly. Holding it is only interesting
       when you could actually do something, or when you asked to stop here.
       Everything below decides whether to pass for you; it never does
       anything you could not have done yourself by pressing pass. */

    /** Every card or permanent this player could legally act with right now. */
    playableNow(playerId) {
      const p = this.player(playerId);
      if (!p || p.hasLost) return [];
      const out = [];
      const z = this.zones[playerId];
      if (!z) return out;
      // lands are played, not cast, and only at sorcery speed
      const purse = this.manaSources(playerId);
      const impulsed = (z.exile || []).filter(o => o.impulseBy === playerId && o.impulseUntil != null && o.impulseUntil >= this.turn)
        .concat(this._borrowedExile(playerId));
      /* Cards set aside earlier that are now yours to cast: plotted last
         turn, or left in exile by warp. */
      const waiting = (z.exile || []).filter(o =>
        (o.plottedTurn != null && o.plottedTurn < this.turn) || o.warpExiled);
      if (this.activePlayer && this.activePlayer.id === playerId && this.isMain &&
          this.stackEmpty && p.landsPlayed < this.landAllowance(p)) {
        const elsewhere = z.library.slice(0, 1).concat(z.graveyard)
          .filter(o => this._playFromRule(playerId, o, 'land'));
        for (const o of z.hand.concat(impulsed, elsewhere)) {
          const a = o.analysis();
          if ((a && a.isLand) || this.landBack(o)) out.push({ kind: 'land', objId: o.id });
        }
      }
      /* a prepared permanent's spell, at the speed of that spell */
      for (const o of this.battlefield) {
        if (o.controller !== playerId || !o.prepared) continue;
        const sp = this._preparedSpell(o);
        if (!sp || !this.canPayNow(playerId, sp.mana_cost || '', {})) continue;
        if (!/Instant/.test(sp.type_line || '') && this._sorcerySpeedBlock(playerId)) continue;
        out.push({ kind: 'cast', objId: o.id, via: 'prepared' });
      }
      const fromTop = z.library.slice(0, 1).filter(o => this._playFromRule(playerId, o, 'spell'));
      for (const o of z.hand.concat(z.command, z.graveyard, impulsed, waiting, fromTop)) {
        /* Cycling and flashback are things you can do with this card that
           are not "cast it for its mana cost", and a table that never
           offers them may as well not have printed them. */
        for (const use of this.altUsesFor(playerId, o.id)) {
          if (!this.canPayNow(playerId, use.cost, { forSpell: o })) continue;
          if (use.kind === 'cycle') {
            out.push({ kind: 'cycle', objId: o.id });
          } else if (use.kind === 'plot') {
            if (!this._sorcerySpeedBlock(playerId)) out.push({ kind: 'plot', objId: o.id });
          } else if (use.kind === 'suspend') {
            out.push({ kind: 'suspend', objId: o.id });
          } else if (use.kind === 'encore') {
            if (!this._sorcerySpeedBlock(playerId)) out.push({ kind: 'encore', objId: o.id });
          } else if (use.kind === 'transmute') {
            if (!this._sorcerySpeedBlock(playerId)) out.push({ kind: 'transmute', objId: o.id });
          } else if (use.kind === 'cast') {
            const timing = this.canCast(playerId, o.id, use.via);
            if (timing.ok) out.push({ kind: 'cast', objId: o.id, via: use.via });
          }
        }
        const chk = this.canCast(playerId, o.id);
        // the same check castSpell's payment makes, so what is offered can be paid for
        if (!chk.ok || !this.canPayNow(playerId, String(chk.cost || '').replace(/\{X\}/g, ''), { forSpell: o })) continue;
        // a spell with nothing legal to point at is not a decision
        if (!this._targetsAvailable(this._spellEffects(o.analysis()), playerId)) continue;
        out.push({ kind: 'cast', objId: o.id });
      }
      for (const o of this.battlefield) {
        if (o.controller !== playerId) continue;
        /* A face-down creature with the mana to turn up is a thing you can
           do, and one worth being asked about. */
        if (o.faceDown) {
          const real = o.trueAnalysis ? o.trueAnalysis() : null;
          const up = real && (real.abilities || []).find(x => x.kind === 'castModifier' &&
            /^(morph|megamorph|disguise)$/i.test(x.keyword || '') && x.arg);
          if (up && this.canPayNow(playerId, up.arg)) out.push({ kind: 'unmorph', objId: o.id });
        }
        const a = o.analysis();
        if (!a) continue;
        // a mana ability on its own is not a reason to stop: it does nothing
        // by itself, and you will be asked when something needs paying for
        const acts = a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty');
        if (!acts.length) continue;
        /* A cost is the parsed shape, not a string: reading it as one made
           every permanent with any ability look activatable, which stopped
           auto-pass dead and had every bot mime deliberation on every
           priority it was given. */
        const usable = (x) => {
          if (x.fromGraveyard) return false;                       // only from the graveyard
          if (this._activationBlocked(o, x, playerId)) return false;
          const c = x.cost || {};
          if ((c.other || []).length) return false;                 // not something we can price
          if (c.tapCreatures && this._tapCostPool(playerId, c.tapCreatures, o).length < this._costCount(c.tapCreatures.n, null)) return false;
          if (c.tap && o.tapped) return false;
          if (c.untap && !o.tapped) return false;
          if (c.life && p.life <= c.life) return false;
          if (c.energy && (p.energy || 0) < c.energy) return false;
          if (x.sorcerySpeed && !(this.isMain && this.stackEmpty &&
              this.activePlayer && this.activePlayer.id === playerId)) return false;
          if (x.kind === 'loyalty' && o.activatedLoyaltyThisTurn) return false;
          if (!this.couldPay(playerId, this._abilityMana(o, x), purse)) return false;
          const specs = (x.targets || []).map(spec => ({ targets: [spec] })).concat(x.effects || []);
          return this._targetsAvailable(specs, playerId);
        };
        if (a.isCreature && o.summoningSick && !this.hasKw(o, 'haste')) {
          // only abilities that do not tap it survive summoning sickness
          if (!acts.some(x => !(x.cost && x.cost.tap))) continue;
        }
        /* A land whose only ability finds or makes mana is not a decision
           worth stopping somebody else's turn for — a table with four
           fetchlands on it would stop at every step of every turn. It is
           still there to click; it just does not hold the game up. */
        if (a.isLand && acts.every(x => this._isQuietLandAbility(x)) &&
            this.activePlayer && this.activePlayer.id !== playerId &&
            this.stackEmpty && this.step !== 'end') continue;
        if (acts.some(usable)) out.push({ kind: 'activate', objId: o.id });
      }
      return out;
    }

    /**
     * Every mana ability a permanent has right now: what is printed on it,
     * what its land types give it (with an Urborg about, every land is a
     * Swamp and taps for black), and what other permanents hand out ("Lands
     * you control have '{T}: Add one mana of any color.'"). A type line
     * rewritten by Blood Moon replaces the printed ones.
     */
    manaAbilitiesOf(o) {
      const a = o && o.analysis();
      if (!a) return [];
      const c = this.characteristics(o);
      const tapFor = (effects) => ({ kind: 'mana', auto: true, synthetic: true,
        cost: { mana: '', tap: true, other: [] }, effects });
      // a land that has lost all its abilities has lost the ones its land types give it too
      const lost = !!(c && c.abilitiesLost);
      let list = (c && c.setMana && !lost)
        ? c.setMana.map(sym => tapFor([{ op: 'addMana', symbols: [sym] }]))
        : a.manaAbilities.slice();
      // land types it was given, beyond the ones it printed
      if (c && a.isLand && !lost && !c.setMana && (c.addSubtypes || []).length) {
        const have = new Set();
        for (const st of c.addSubtypes) {
          const sym = MANA.COLOR_OF_BASIC[st];
          if (!sym || have.has(st)) continue;
          have.add(st);
          list.push(tapFor([{ op: 'addMana', symbols: [sym] }]));
        }
      }
      if (c && (c.grantMana || []).length) list = list.concat(c.grantMana);
      return list;
    }

    /**
     * What one mana ability could make right now, for paying with it: the
     * colours on offer, whether it is any colour at all, and how much. The
     * colours of "a land an opponent controls could produce" depend on the
     * table, so they are worked out here rather than printed on the card.
     */
    _manaOptions(ab, o, pid) {
      const produces = new Set();
      let any = false, amount = 0;
      for (const e of (ab.effects || [])) {
        if (e.op === 'addMana') {
          for (const sym of e.symbols || []) for (const c of MANA.COLORS.concat('C')) if (sym.includes(c)) produces.add(c);
          amount += (e.tron && this._tronAssembled(pid, e.tron) ? e.tron.symbols : (e.symbols || [])).length;
        } else if (e.op === 'addManaAny') {
          if (e.commanderIdentity) {
            const cols = this._commanderColors(pid);
            // no commander at all: it is simply mana of any colour
            if (cols.size) for (const c of cols) produces.add(c); else any = true;
          } else any = true;
          amount += e.amount === 'X' ? 1 : (Number(e.amount) || 1);
        } else if (e.op === 'addManaChoice') {
          (e.choices || []).forEach(ch => ch.forEach(sym => { for (const c of MANA.COLORS.concat('C')) if (sym.includes(c)) produces.add(c); }));
          amount += Math.max(1, ...(e.choices || [[1]]).map(ch => ch.length));
        } else if (e.op === 'addManaPer') {
          const k = (e.per && e.per.countersOnSelf) ? ((o && Number(o.counters[e.per.countersOnSelf])) || 0)
            : this.countPermanents(pid, e.per || {}) * ((e.per && e.per.mult) || 1);
          if (k > 0) { produces.add(e.symbol || 'C'); amount += k; }
        } else if (e.op === 'addManaAmong') {
          const cols = this._manaAmong(e, o, pid);
          for (const c of cols) produces.add(c);
          if (cols.length) amount += Number(e.amount) || 1;
        } else if (e.op === 'addManaEachColor') {
          const cols = this._colorsAmongYours(pid);
          for (const c of cols) produces.add(c);
          amount += cols.length;
        } else if (e.op === 'addManaX') {
          const k = this._manaXValue(e, o, pid);
          if (k > 0) { if (e.symbol) produces.add(e.symbol); else any = true; amount += k; }
        } else if (e.op === 'addManaDevotion') {
          let best = 0;
          for (const c of MANA.COLORS) best = Math.max(best, this.devotionOf(pid, c));
          if (best > 0) { any = true; amount += best; }
        } else if (e.op === 'addManaChosen') {
          const col = o && o.chosenColor;
          if (col) produces.add(col);
          if (e.orSymbol) produces.add(e.orSymbol);
          if (col || e.orSymbol) amount += Number(e.n) || 1;
        }
      }
      return { produces, any, amount: Math.max(amount, (produces.size || any) ? 1 : 0) };
    }

    /** The colours in this player's commanders' colour identity. */
    _commanderColors(pid) {
      const out = new Set();
      const z = this.zones[pid] || {};
      const mine = (z.command || []).concat(this.battlefield.filter(o => o.owner === pid), z.graveyard || [], z.exile || [], z.hand || [])
        .filter(o => o.isCommander);
      for (const c of mine) for (const col of (c.card.color_identity || [])) out.add(col);
      return out;
    }

    /** The colours "a land an opponent controls could produce" and its relatives. */
    _manaAmong(e, o, pid) {
      const out = new Set();
      const from = e.from || 'opponentLands';
      if (from === 'exiledCard') {
        const x = o && o.imprinted && this.obj(o.imprinted);
        for (const c of ((x && x.card.colors) || [])) out.add(c);
        return Array.from(out);
      }
      const pool = from === 'opponentLands' ? this.battlefield.filter(x => x.controller !== pid)
        : from === 'yourLands' ? this.battlefield.filter(x => x.controller === pid && x !== o)
        : from === 'yourLegends' ? this.battlefield.filter(x => x.controller === pid)
        : [];
      for (const x of pool) {
        const xa = x.analysis();
        if (!xa) continue;
        if (from === 'yourLegends') {
          if (!(xa.supertypes || []).includes('Legendary') || !(e.anyLegend || xa.isCreature || xa.isPlaneswalker)) continue;
          for (const c of (xa.colors || [])) out.add(c);
          continue;
        }
        if (!xa.isLand) continue;
        /* What the land could make: its own abilities, read the same way
           — but never by asking another Reflecting Pool, which would only
           ask back. */
        for (const ab of this.manaAbilitiesOf(x)) {
          if ((ab.effects || []).some(ef => ef.op === 'addManaAmong')) continue;
          const opt = this._manaOptions(ab, x, x.controller);
          if (opt.any) MANA.COLORS.forEach(c => out.add(c));
          for (const c of opt.produces) if (c !== 'C' || e.anyType) out.add(c);
        }
      }
      return Array.from(out);
    }

    /** "For each color among permanents you control" — Bloom Tender. */
    _colorsAmongYours(pid) {
      const out = new Set();
      for (const x of this.battlefield) {
        if (x.controller !== pid) continue;
        for (const c of ((x.analysis() || {}).colors || [])) out.add(c);
      }
      return Array.from(out);
    }

    /** "Add X mana …, where X is this creature's power" and its cousins. */
    /** Urza's Tower: are the other two pieces out? */
    _tronAssembled(pid, tron) {
      const norm = (x) => String(x || '').toLowerCase().replace(/-/g, ' ').replace(/\u2019/g, "'");
      return (tron.names || []).every(nm => this.battlefield.some(o => o.controller === pid && norm(o.name) === norm(nm)));
    }

    _manaXValue(e, o, pid) {
      if (e.x === 'power') return o ? Math.max(0, this.powerOf(o)) : 0;
      if (e.x === 'count') return this._scopeList(e.scope || {}, pid, o).length;
      if (e.x === 'greatestPower') {
        let best = 0;
        for (const x of this.battlefield) if (x.controller === pid && (x.analysis() || {}).isCreature) best = Math.max(best, this.powerOf(x));
        return best;
      }
      return Number(e.n) || 0;
    }

    /**
     * How much mana this player could produce right now: what is already in
     * the pool plus every untapped source they could tap for one. Counting it
     * means walking the battlefield, so anything asking about several cards in
     * a row works it out once and passes it in.
     */
    manaAvailable(playerId) {
      const p = this.player(playerId);
      if (!p) return 0;
      let have = p.pool.total();
      for (const o of this.battlefield) {
        if (o.controller !== playerId || o.tapped || o.phasedOut) continue;
        const a = o.analysis();
        if (!a || !this.manaAbilitiesOf(o).length) continue;
        if (this.characteristics(o).isCreature && o.summoningSick && !this.hasKw(o, 'haste')) continue;
        have++;
      }
      return have;
    }

    /** Does this ability do nothing but find or make mana? */
    _isQuietLandAbility(ab) {
      const QUIET = new Set(['addMana', 'addManaAny', 'addManaChoice', 'addManaPer',
        'fetchBasic', 'shuffle', 'scry', 'noop', 'sacrificeSelf']);
      const effects = (ab && ab.effects) || [];
      if (!effects.length) return false;
      return effects.every((e) => {
        if (QUIET.has(e.op)) return true;
        // a tutor that can only find a land is the fetchland case
        if (e.op === 'tutor') {
          const LANDISH = new Set(['land', 'lands', 'basic', 'forest', 'island', 'swamp',
            'mountain', 'plains', 'wastes', 'gate', 'desert', 'snow', 'card', 'cards', 'or', 'a', 'an']);
          const words = String(e.filter || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
          return words.length > 0 && words.every(w => LANDISH.has(w));
        }
        return false;
      });
    }

    /**
     * What this player could tap for, one entry per source, each entry the
     * colours that source can make ('' for a source that only makes
     * colourless, which still pays a generic cost).
     */
    manaSources(playerId) {
      const p = this.player(playerId);
      const out = [];
      if (!p) return out;
      for (const c of ['W', 'U', 'B', 'R', 'G']) for (let i = 0; i < p.pool[c]; i++) out.push(c);
      for (let i = 0; i < p.pool.C; i++) out.push('');
      for (const o of this.battlefield) {
        if (o.controller !== playerId || o.tapped || o.phasedOut) continue;
        const a = o.analysis();
        if (!a) continue;
        const abs = this.manaAbilitiesOf(o).filter(ab => this._manaCostPayable(playerId, o, ab) && !(ab.cost && ab.cost.mana));
        if (!abs.length) continue;
        if (this.characteristics(o).isCreature && o.summoningSick && !this.hasKw(o, 'haste')) continue;
        /* the colours it could make right now, not the ones printed on it:
           an Exotic Orchard makes nothing an opponent's lands cannot */
        const cols = new Set();
        let makes = false;
        for (const ab of abs) {
          const opt = this._manaOptions(ab, o, playerId);
          if (opt.any) MANA.COLORS.forEach(c => cols.add(c));
          for (const c of opt.produces) if (c !== 'C') cols.add(c);
          if (opt.any || opt.produces.size) makes = true;
        }
        if (!makes) continue;
        out.push(Array.from(cols).join(''));
      }
      return out;
    }

    /**
     * Can this cost be paid out of those sources? Counting mana is not
     * enough: five Mountains do not cast Counterspell, and a table that
     * stops to offer you priority for a blue card you cannot pay for is
     * exactly the interruption auto-pass exists to remove. So the coloured
     * pips are matched to sources that can make them — hardest pip first,
     * backing up when a choice turns out to be wrong — and whatever is left
     * over pays the generic part.
     */
    _payableFrom(sources, cost) {
      let generic = 0;
      const pips = [];
      for (const sym of MANA.parse(String(cost))) {
        if (/^\d+$/.test(sym)) { generic += parseInt(sym, 10); continue; }
        if (sym === 'X' || sym === 'Y' || sym === 'Z' || sym === '\u221e') continue;
        if (sym.indexOf('P') >= 0) continue;                 // phyrexian: life can pay it
        const two = /^(\d+)\/(\w)$/.exec(sym);              // {2/W}: generic or a colour
        if (two) { generic += parseInt(two[1], 10); continue; }
        const cols = sym.split('/').filter(c => 'WUBRG'.indexOf(c) >= 0);
        if (!cols.length) { generic += 1; continue; }        // {C}, {S} and friends
        pips.push(cols);
      }
      if (!pips.length) return sources.length >= generic;
      pips.sort((a, b) => a.length - b.length);
      const used = new Array(sources.length).fill(false);
      let steps = 0;
      const assign = (i) => {
        if (i >= pips.length) return true;
        for (let j = 0; j < sources.length; j++) {
          if (used[j]) continue;
          if (++steps > 4000) return true;                   // pathological board: let it through
          const src = sources[j];
          let ok = false;
          for (const c of pips[i]) if (src.indexOf(c) >= 0) { ok = true; break; }
          if (!ok) continue;
          used[j] = true;
          if (assign(i + 1)) return true;
          used[j] = false;
        }
        return false;
      };
      if (!assign(0)) return false;
      let spare = 0;
      for (let j = 0; j < used.length; j++) if (!used[j]) spare++;
      return spare >= generic;
    }

    /** Could this player pay that cost right now, colours and all? */
    couldPay(playerId, cost, available) {
      if (!cost) return true;
      const bare = String(cost).replace(/\{X\}/g, '');
      const need = MANA.cmc(bare);
      if (!need) return true;
      // a plain number is the old count-only answer, kept for callers that
      // have one to hand
      if (typeof available === 'number') return available >= need;
      const sources = Array.isArray(available) ? available : this.manaSources(playerId);
      if (sources.length < need) return false;
      return this._payableFrom(sources, bare);
    }

    /**
     * Auto-pass is a per-player preference, and the engine is authoritative
     * for everyone at the table, so each player's own settings are handed to
     * it rather than read from this device's. No entry means no auto-passing,
     * which is the safe default for a seat we have heard nothing from.
     */
    setAutoPass(playerId, cfg) {
      this.config.autoPass = this.config.autoPass || {};
      if (!cfg) { delete this.config.autoPass[playerId]; return; }
      /* Merge rather than replace: full control may have been switched on
         at the table a moment ago, and a settings push should not quietly
         turn it off again. */
      const was = this.config.autoPass[playerId] || {};
      const next = Object.assign({}, was, cfg);
      if (was.fullControl && cfg.fullControl == null) {
        next.fullControl = was.fullControl;
        next.fullControlSticky = was.fullControlSticky;
        next.fullControlAt = was.fullControlAt;
      }
      this.config.autoPass[playerId] = next;
    }

    /**
     * Full control (as MTG Arena calls it): nothing is passed for you, at
     * any step, until you say so. Held for one step by default — the way
     * tapping Ctrl works there — or until it is turned off again.
     */
    setFullControl(playerId, on, sticky) {
      this.config.autoPass = this.config.autoPass || {};
      const cfg = this.config.autoPass[playerId] = this.config.autoPass[playerId] || {};
      cfg.fullControl = !!on;
      cfg.fullControlSticky = !!(on && sticky);
      cfg.fullControlAt = on ? this._stepKey() : null;
      this.touch();
    }

    /**
     * Yielding: hand priority back until something worth seeing happens.
     *   'response' — until somebody else puts something on the stack
     *   'turn'     — for the rest of this turn, whatever happens
     * The same two keys Arena gives you, and the same two meanings.
     */
    setYield(playerId, mode) {
      const p = this.player(playerId);
      if (!p) return;
      p.yieldUntil = mode || null;
      p.yieldFrom = mode ? { turn: this.turn, stack: this.stack.length } : null;
      this.touch();
      this._maybeAutoPass();
    }

    _stepKey() { return this.turn + ':' + this.phaseIndex + ':' + this.stepIndex; }

    /** One step's worth of full control is over when that step is. */
    _expireFullControl() {
      const all = this.config.autoPass || {};
      const here = this._stepKey();
      for (const id in all) {
        const cfg = all[id];
        if (!cfg || !cfg.fullControl || cfg.fullControlSticky) continue;
        if (cfg.fullControlAt && cfg.fullControlAt !== here) {
          cfg.fullControl = false;
          cfg.fullControlAt = null;
        }
      }
    }

    /** Is this player yielding through this priority? */
    _yielding(p) {
      if (!p || !p.yieldUntil) return false;
      if (p.yieldUntil === 'turn') {
        if (p.yieldFrom && p.yieldFrom.turn !== this.turn) { p.yieldUntil = null; return false; }
        return true;
      }
      // 'response': somebody else adding to the stack is what you were waiting for
      const top = this.stack[this.stack.length - 1];
      if (top && top.controller !== p.id) { p.yieldUntil = null; p.yieldFrom = null; return false; }
      return true;
    }

    /**
     * Pass for this player when holding priority could achieve nothing.
     *
     * Having no legal play outranks everything else here, including an
     * explicit stop: a stop is for looking at a step you might act in, and
     * a step you cannot act in is not one of those. The exception is a
     * relaxed table, where people move cards around by hand and the engine
     * is not the judge of what they can do.
     */
    _shouldAutoPass(playerId) {
      const cfg = (this.config.autoPass || {})[playerId];
      const p = this.player(playerId);
      if (!p || p.isBot || p.hasLost) return false;    // bots have their own runner
      if (this.mulliganPhase || this.pendingChoice || this.over) return false;
      /* Yielding outranks everything, including stops and having something
         to do: you said "carry on until something happens", so the table
         carries on. */
      if (this._yielding(p)) return true;
      this._expireFullControl();
      if (cfg && cfg.fullControl) return false;
      if (!cfg || !cfg.enabled) return false;
      if (this.holdFor === playerId) return false;     // they asked to keep it
      if (this.config.rulesEnforcement === 'relaxed') return this._stopsAllowPass(playerId, cfg);
      if (!this.playableNow(playerId).length) return true;   // nothing you could do
      /* Holding an instant is not a reason to stop at every step of every
         turn. With smart stops on — the way digital tables play — you are
         stopped where you asked to be, and whenever somebody else does
         something you could answer; the rest of the turn goes by. */
      if (cfg.smart) return !this._smartStop(playerId, cfg);
      return false;                                          // there is a decision to make
    }

    /** Whether this is a moment worth stopping for, given that you could act. */
    _smartStop(playerId, cfg) {
      if (this.stack.length) {
        const top = this.stack[this.stack.length - 1];
        // your own spell resolving is not news; anyone else's is, once
        if (top && top.controller === playerId) return false;
        if (!cfg.untilStackChange) return true;
        return this._seenStackTop !== (top && top.id);
      }
      const mine = this.activePlayer && this.activePlayer.id === playerId;
      const key = this.step === 'main' ? (this.phase === 'precombat' ? 'main1' : 'main2') : this.step;
      const stops = (cfg.stops || {})[mine ? 'yours' : 'theirs'] || {};
      return !!stops[key];
    }

    /** The stop settings, for a table where the engine is not the judge. */
    _stopsAllowPass(playerId, cfg) {
      const mine = this.activePlayer && this.activePlayer.id === playerId;
      const key = this.step === 'main' ? (this.phase === 'precombat' ? 'main1' : 'main2') : this.step;
      const stops = (cfg.stops || {})[mine ? 'yours' : 'theirs'] || {};
      if (stops[key]) return false;
      if (this.stack.length) {
        const top = this.stack[this.stack.length - 1];
        // your own spell resolving is not news; anyone else's is, once
        if (!(top && top.controller === playerId)) {
          if (!cfg.untilStackChange) return false;
          if (this._seenStackTop !== (top && top.id)) return false;
        }
      }
      return this.playableNow(playerId).length === 0;
    }

    /** Run the passes out in a loop; recursing through passPriority would not end well. */
    _maybeAutoPass() {
      if (this._autoPassing) return;
      this._autoPassing = true;
      try {
        for (let guard = 0; guard < 80; guard++) {
          const p = this.priorityPlayer;
          if (!p || !this._shouldAutoPass(p.id)) break;
          const where = this._priorityFingerprint();
          this.passPriority(p.id, true);
          if (this._priorityFingerprint() === where) break;   // nothing moved: do not spin
        }
      } finally {
        this._autoPassing = false;
        /* Remember the stack a person was stopped on, so the same spell does
           not stop them twice. Only a person: this also runs while a bot holds
           priority, and a spell the bot has just cast has not been seen by
           anybody yet. */
        const top = this.stack[this.stack.length - 1];
        const at = this.priorityPlayer;
        if (at && !at.isBot) this._seenStackTop = top ? top.id : null;
      }
    }

    _priorityFingerprint() {
      return [this.turn, this.phaseIndex, this.stepIndex, this.priorityIndex, this.stack.length].join(':');
    }

    /** "Wait, I want to act here" — keep priority until this step is over. */
    setHoldPriority(playerId, on) {
      this.holdFor = on ? playerId : null;
      this.touch();
    }

    passPriority(playerId, silent) {
      if (this.over || this.pendingChoice) return;
      if (this.mulliganPhase) return;
      const cur = this.priorityPlayer;
      if (!cur || cur.id !== playerId) return this.fail('You do not have priority.');
      if (cur.hasLost) { this._resetPriority(); return; }
      this.passedInSuccession.add(playerId);
      const alive = this.turnOrder.filter(id => !this.player(id).hasLost);
      if (this.passedInSuccession.size >= alive.length) {
        // everybody passed
        if (this.stack.length) { this._resolveTop(); return; }
        this.passedInSuccession.clear();
        this._advanceStep();
        return;
      }
      // next player in turn order who has not lost
      let i = this.priorityIndex, guard = 0;
      do { i = (i + 1) % this.turnOrder.length; guard++; }
      while (this.player(this.turnOrder[i]).hasLost && guard < this.turnOrder.length * 2);
      this.priorityIndex = i;
      this._putTriggersOnStack();
      this.emit('priority', this.priorityPlayer);
      if (!silent) this.emit('sfx', 'priority');
      this.touch();
      this._maybeAutoPass();
    }

    /** After something resolves or is put on the stack, AP gets priority again. */
    _resetPriority() {
      this.priorityIndex = this.activeIndex;
      /* The player whose turn it is may have lost in the middle of it — to
         their own spell, to a state-based action, to the last point of
         damage on the stack. Handing priority back to a seat that is out of
         the game leaves the table waiting on somebody who will never act. */
      let guard = 0;
      while (this.priorityPlayer && this.priorityPlayer.hasLost &&
             guard++ < this.turnOrder.length) {
        this.priorityIndex = (this.priorityIndex + 1) % this.turnOrder.length;
      }
      this.passedInSuccession.clear();
      this._putTriggersOnStack();
      this.emit('priority', this.priorityPlayer);
      this.touch();
      this._maybeAutoPass();
    }

    /* ---------- the stack (CR 405) ---------- */
    _resolveTop() {
      /* An endless loop of mandatory actions nobody can stop is a draw
         (CR 104.4b). Thousands of things resolving in one step without the
         game moving on is that loop, and the table ends it rather than
         spinning for ever. */
      if (this._loopTick('resolve', 2000)) { this._endlessLoopDraw(); return; }
      const item = this.stack.pop();
      if (!item) { this._resetPriority(); return; }
      this._lastLifeLost = 0;   // "gain life equal to the life lost this way" counts within one resolution
      this._lastDamageDealt = 0;
      this._lastAffected = null;
      this._lastCopy = null;
      this._lastPut = null;
      this._lastExiled = null;
      this._chosenCard = null;
      this.passedInSuccession.clear();
      this.emit('sfx', 'resolve');
      this.emit('stack:resolve', item);

      if (item.countered) {
        this.logEvent('stack', `${item.name} was countered.`);
        // a countered spell goes to its owner's graveyard whatever it is,
        // permanent or not (CR 701.5a) — it never reaches the battlefield
        if (item.kind === 'spell' && item.obj && item.obj.zone === 'stack') {
          this.moveObject(item.obj, item.obj.isCommander && MTG.settings.commanderToZone !== false ? 'command'
            : item.exileIfCountered ? 'exile' : 'graveyard');
        }
        this.checkStateBasedActions();
        this._resetPriority();
        return;
      }

      // an "if" clause is checked once more as the trigger resolves (CR 603.4)
      if (!this._triggerStillHolds(item)) {
        this.logEvent('trigger', `${item.name} does nothing — its condition is no longer true.`);
        this._afterResolve(item);
        return;
      }

      // target legality check (CR 608.2b): fizzle if all targets are illegal
      if (item.targets && item.targets.length) {
        const legal = item.targets.filter((t, i) => this._targetStillLegal(t, item, i));
        if (!legal.length) {
          this.logEvent('stack', `${item.name} is countered on resolution (no legal targets).`);
          this._afterResolve(item);
          return;
        }
        item.resolvedTargets = legal;
      } else item.resolvedTargets = [];

      if (item.kind === 'spell') this._resolveSpell(item);
      else this._resolveAbility(item);
    }

    _afterResolve(item) {
      // spells that are not permanents go to the graveyard
      if (item.kind === 'spell' && item.obj) {
        const a = item.obj.analysis();
        if (item.obj._wentToLibrary) { item.obj._wentToLibrary = false; }
        // a copy of a spell is not a card: off the stack, it is gone (CR 707.10a)
        else if (item.isCopy && item.obj.isCopy && item.obj.zone === 'stack' && (!a || !a.isPermanent)) item.obj.zone = null;
        else if (item.obj.zone !== 'stack' && !item.isCopy) { /* it already went somewhere as it resolved */ }
        else if (a && a.keywordSet && a.keywordSet.has('rebound') && item.fromZone === 'hand' && !item.countered && !item.isCopy) {
          this.moveObject(item.obj, 'exile');
          item.obj.reboundBy = item.controller;
          item.obj.reboundTurn = this.turn;
          this.logEvent('rules', `${item.name} is exiled with rebound.`);
        }
        else if (item.viaAfter === 'exile') {
          // flashback and friends exile the card instead (CR 702.33a)
          this.moveObject(item.obj, 'exile');
          this.logEvent('rules', `${item.name} is exiled (${item.via}).`);
        }
        else if (item.boughtBack && !item.countered && (!a || !a.isPermanent)) {
          // bought back: it comes home instead (CR 702.27)
          this.moveObject(item.obj, 'hand');
          this.logEvent('rules', `${item.name} is bought back.`);
        }
        else if (!a || !a.isPermanent) {
          if (item.obj.isCommander && MTG.settings.commanderToZone !== false) {
            // commander replacement is a choice; default to command zone
            this.moveObject(item.obj, 'command');
          } else this.moveObject(item.obj, 'graveyard');
        }
      }
      this.checkStateBasedActions();
      this._resetPriority();
    }

    _resolveSpell(item) {
      const o = item.obj;
      const a = o.analysis();
      /* Mutate (CR 702.140): cast this way, the creature does not land on
         its own — it joins the creature it was cast at, and the two are one
         permanent from here on. */
      if (item.via === 'mutate') {
        const t = (item.targets || []).find(x => x.kind === 'object');
        const host = t && this.obj(t.id);
        if (host && host.zone === 'battlefield') {
          this._mutateOnto(host, o, item);
          return;
        }
        this.logEvent('rules', `${item.name} had nothing to mutate onto; it enters on its own.`);
      }
      if (a && a.isPermanent) {
        /* A clone resolving for a person: they say what it copies before
           it arrives (CR 707.4), and it arrives once they have. */
        if (!item._cloneAsked && this._askCloneChoice(item, o, a)) return;
        o.wasCast = this.turn;
        this.moveObject(o, 'battlefield', { fromStack: true, spellItem: item });
        if (item.via === 'evoke') {
          this.logEvent('rules', `${item.name} was evoked, and is sacrificed.`);
          this.moveObject(o, 'graveyard');
          this._fire('youSacrifice', item.controller, { count: 1 });
        } else if (item.via === 'dash') {
          o.effects.push({ keywords: ['Haste'], until: null });
          o.dashedTurn = this.turn;
          this.logEvent('rules', `${item.name} dashes in.`);
        } else if (item.via === 'blitz') {
          o.effects.push({ keywords: ['Haste'], until: null });
          o.blitzedTurn = this.turn;
          this.logEvent('rules', `${item.name} blitzes in.`);
        } else if (item.via === 'warp') {
          /* Warp: it is here for the turn, then it goes and waits in
             exile until you can afford it properly. */
          o.warpedTurn = this.turn;
          this.logEvent('rules', `${item.name} warps in until the end of the turn.`);
        }
        if (item.hasteOnResolve) o.effects.push({ keywords: ['Haste'], until: 'eot' });
        /* A suspended card comes off the clock with haste (CR 702.62e). */
        if (o.suspendHaste) { o.suspendHaste = false; o.effects.push({ keywords: ['Haste'], until: null }); }
        /* An Aura arrives attached to the thing it was cast on. Without
           this it lands on the felt attached to nothing and the very next
           run of state-based actions puts it in the graveyard — which is
           what happened to every Aura in the game. */
        if (a.isAura && a.auraReanimates) {
          const t = (item.targets || []).find(x => x.kind === 'object');
          const dead = t && this.obj(t.id);
          if (dead && dead.zone === 'graveyard') {
            this.moveObject(dead, 'battlefield', { controller: item.controller });
            this.logEvent('reanimate', `${this.player(item.controller).name} returns ${dead.name} with ${o.name}.`);
          }
        }
        if (a.isAura || item.via === 'bestow') {
          const t = (item.targets || []).find(x => x.kind === 'object');
          const host = t && this.obj(t.id);
          if (host && host.zone === 'battlefield') {
            o.attachedTo = host.id;
            host.attachments = (host.attachments || []).concat(o.id);
            if (item.via === 'bestow') o.bestowed = true;
          } else if (item.via === 'bestow') {
            o.bestowed = false;                 // nothing to go on: it is just a creature
          }
          o._bestowing = false;
        }
        this.logEvent('resolve', `${this.player(item.controller).name} resolves ${item.name}.`);
        this._afterResolveNoGrave(item);
        return;
      }
      // instant / sorcery: run its effects, then finish once they are done
      this.logEvent('resolve', `${item.name} resolves.`);
      let effects = item.effects || (a ? this._cardSpellEffects(a) : []);
      // cipher: the last thing the card does is offer to encode itself (CR 702.99a)
      if (a && a.keywordSet && a.keywordSet.has('cipher') && !item.isCopy) effects = effects.concat([{ op: 'cipher' }]);
      this._runEffects(effects, item, () => this._afterResolve(item), 'afterResolve');
    }
    _afterResolveNoGrave(item) { this.checkStateBasedActions(); this._resetPriority(); }

    /** What a clone entering could copy ("any creature", "an artifact or creature you control"). */
    _clonePool(src, e, controller) {
      const what = e.what && e.what !== 'creature' ? e.what : 'creature';
      return this.battlefield.filter(o => o !== src && !o.phasedOut && this._cardFitsWords(o, what) &&
        (!e.yours || o.controller === controller));
    }
    /**
     * A clone spell controlled by a person stops as it resolves to ask what
     * it should enter as a copy of. Bots, and clones arriving any other
     * way, choose for themselves.
     */
    _askCloneChoice(item, o, a) {
      const p = this.player(item.controller);
      if (!p || p.isBot || item.isCopy) return false;
      let ef = null;
      for (const ab of a.abilities) for (const x of (ab.effects || [])) if (x && x.op === 'etbAsCopy') ef = x;
      if (!ef) return false;
      const pool = this._clonePool(o, ef, item.controller);
      if (!pool.length) return false;
      item._cloneAsked = true;
      this._cloneWait = item;
      this.queueChoice({ type: 'pickCard', playerId: item.controller, purpose: 'cloneChoice', count: 1, optional: true,
        objId: o.id, candidates: pool.map(x => x.id), cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
        sourceId: o.id, sourceName: o.name, sourceCard: o.card,
        prompt: `${o.name}: choose what it enters as a copy of. Choose nothing and it enters as itself.` });
      return true;
    }

    /**
     * Put a mutating creature on top of the one it was cast at. The pile is
     * one permanent: the top card gives it its name, its size and its types,
     * and every card in the pile gives it its abilities — which is exactly
     * what you get by reading all of their text as one card.
     */
    _mutateOnto(host, o, item) {
      const stripMutate = (t) => String(t || '').split('\n')
        .filter(l => !/^Mutate\s*\{/i.test(l.trim())).join('\n').trim();
      const parts = (host.mutateCards || [host.card]).slice();
      const objs = (host.mutateObjs || []).slice();
      parts.push(o.card);
      objs.push(o.id);
      const top = o.card;
      const text = parts.map(c => stripMutate(c.oracle_text)).filter(Boolean).join('\n');
      const merged = Object.assign({}, top, {
        id: 'mutate:' + U.hash(parts.map(c => c.id).join('|')),
        oracle_id: 'mutate:' + U.hash(parts.map(c => c.oracle_id || c.id).join('|')),
        oracle_text: text,
        card_faces: null,
        _isMutated: true,
      });
      host.mutateCards = parts;
      host.mutateObjs = objs;
      host.card = merged;
      host.face = 0;
      host._chr = null;
      /* The spell's own object is part of the pile now rather than a card
         in any zone of its own. */
      o.zone = 'merged';
      o.mergedInto = host.id;
      this.bumpBoard();
      this.logEvent('rules', `${top.name} mutates onto ${host.name}.`);
      this.emit('sfx', 'play_card');
      this._fire('mutates', host.controller, { object: host, source: host });
      this.checkStateBasedActions();
      this._resetPriority();
    }

    /** A mutated pile comes apart when it leaves the battlefield. */
    _unmutate(host, toZone) {
      const parts = host.mutateCards || null;
      if (!parts || !parts.length) return;
      const objs = host.mutateObjs || [];
      host.card = parts[0];
      host.mutateCards = null; host.mutateObjs = null; host._chr = null;
      for (const id of objs) {
        const x = this.obj(id);
        if (!x) continue;
        x.mergedInto = null;
        x.zone = null;
        this.moveObject(x, toZone === 'battlefield' ? 'graveyard' : toZone, { controller: x.owner });
      }
    }

    /**
     * What an instant or sorcery does when it resolves.
     *
     * Read the lines the analysis already worked out rather than the whole
     * card again: a card with a keyword line ("Flashback {3}{R}", "Kicker
     * {2}") has text that is not an instruction, and handing all of it to
     * the sentence parser made it give up and ask for the whole spell to be
     * resolved by hand — on every kicker, flashback and buyback spell in
     * the game.
     */
    _cardSpellEffects(a) {
      const lines = [];
      let allAuto = true;
      for (const ab of ((a && a.abilities) || [])) {
        if (ab.kind !== 'spell') continue;
        lines.push(...(ab.effects || []));
        if (!ab.auto) allAuto = false;
      }
      if (lines.length && allAuto) return lines;
      // a spell that is nothing but keywords (Into the Time Vortex) does them as it is cast
      if (!lines.length && a && a.autoCoverage >= 0.999) return [];
      const parsed = O.parseEffects((a && (a.oracleTextParsed || a.oracleText)) || '');
      if (parsed.auto || !lines.length) return parsed.effects;
      return lines;
    }

    _resolveAbility(item) {
      this.logEvent('resolve', `${item.name} resolves.`);
      // how many times this ability has resolved this turn, for "the second time"
      if (item.obj && item.abilityIndex != null && item.abilityIndex >= 0) {
        const r = (item.obj._resolved = item.obj._resolved || {});
        const k = item.abilityIndex;
        r[k] = r[k] && r[k].turn === this.turn ? { turn: this.turn, n: r[k].n + 1 } : { turn: this.turn, n: 1 };
      }
      // "you may" on a trigger is a question asked as it resolves, not before
      const effects = item.optional && !item._asked
        ? [{ op: 'may', prompt: truncate(item.abilityText || item.name, 100), then: item.effects || [] }]
        : (item.effects || []);
      this._runEffects(effects, item, () => this._afterResolve(item), 'afterResolve');
    }

    /**
     * A copy of a spell or ability on the stack (CR 707.10), controlled by
     * whoever made it. A spell's copy is an object of its own, so resolving
     * it does not send the original anywhere; a copy of a permanent spell
     * becomes a token. Everything chosen for the original comes with it.
     */
    _copyOnStack(item, controller) {
      let copy;
      if (item.kind === 'spell' && item.obj) {
        const dup = this._register(new GObj(item.obj.card, controller, 'stack'));
        dup.isCopy = true; dup.chosenX = item.obj.chosenX; dup.giftTo = item.obj.giftTo || null;
        const a = item.obj.analysis();
        if (a && a.isPermanent) dup.isToken = true;
        copy = Object.assign({}, item, { id: this._uid('st'), isCopy: true, obj: dup, objId: dup.id, controller,
          targets: (item.targets || []).slice() });
      } else {
        copy = Object.assign({}, item, { id: this._uid('st'), isCopy: true, controller,
          targets: (item.targets || []).slice(), name: String(item.name || 'Ability').replace(/( \(copy\))?$/, ' (copy)') });
      }
      delete copy.resolvedTargets;
      delete copy.countered;
      // a copy was never cast, from anywhere, and goes nowhere afterwards
      copy.fromZone = null; copy.via = null; copy.viaAfter = null;
      this.stack.push(copy);
      this.emit('stack:add', copy);
      if (copy.kind === 'spell') this._fire('youCopySpell', controller, { spell: copy, object: copy.obj, stackId: copy.id, playerId: controller });
      return copy;
    }

    /**
     * "You may choose new targets for the copy." The copy's controller is
     * shown every legal target for each slot, with the present one first;
     * picking the same ones keeps them. A bot keeps them unless they are
     * pointed the wrong way: something harmful at its own things, or
     * something helpful at somebody else's.
     */
    _newTargetsForCopy(copy, playerId, sub) {
      const have = copy.targets || [];
      if (!have.length) return null;
      const specs = this._specsOf(copy).slice(0, have.length);
      if (specs.length !== have.length) return null;
      const options = specs.map((sp, i) => {
        const list = this._legalTargetsFor(sp, playerId, copy.obj ? copy.obj.id : null)
          .filter(x => !(x.kind === 'stack' && x.id === copy.id));
        const cur = list.findIndex(x => x.kind === have[i].kind && x.id === have[i].id);
        if (cur > 0) list.unshift(list.splice(cur, 1)[0]);
        return list;
      });
      if (options.some(l => !l.length)) return null;
      const p = this.player(playerId);
      let picked;
      if (p && p.isBot) picked = this._botCopyTargets(copy, specs, options, playerId);
      else {
        picked = this._ask({ type: 'pickTarget', playerId, specs, options, count: specs.length,
          prompt: `New targets for the copy of ${copy.name}? Choosing the same ones keeps them.` }, sub);
        if (picked === SUSPEND) return SUSPEND;
      }
      const now = (picked || []).map(normTarget).filter(Boolean);
      if (now.length === have.length && now.some((t, i) => t.kind !== have[i].kind || t.id !== have[i].id)) {
        copy.targets = now;
        this.logEvent('rules', `The copy of ${copy.name} now targets ${now.map(t => this.describeTarget(t)).join(', ')}.`);
      }
      return null;
    }
    _botCopyTargets(copy, specs, options, playerId) {
      const HARM = new Set(['damage', 'destroy', 'exile', 'bounce', 'counterSpell', 'counterUnless', 'tap', 'loseLife',
        'discard', 'mill', 'fight', 'bite', 'gainControl', 'exileUntilLeaves', 'sacrificeChoice', 'drain', 'handAttack',
        'restrict', 'goad', 'toLibrary', 'damageDivided', 'selfBite']);
      const ops = [];
      const walk = (list) => {
        for (const e of (list || [])) {
          if (!e) continue;
          if (e.op === 'sequence') { walk(e.list); continue; }
          // a shrink or a -1/-1 counter is as unwelcome as damage
          const bad = HARM.has(e.op) || (e.op === 'pump' && (Number(e.p) < 0 || Number(e.t) < 0)) ||
            (e.op === 'counters' && /^-/.test(String(e.kind || '')));
          for (let i = 0; i < (e.targets || []).length; i++) ops.push(bad);
        }
      };
      walk(copy.effects);
      const mine = (t) => {
        if (t.kind === 'player') return t.id === playerId;
        if (t.kind === 'stack') { const st = this.stack.find(x => x.id === t.id); return !!st && st.controller === playerId; }
        const o = this.obj(t.id);
        return !!o && o.controller === playerId;
      };
      return copy.targets.map((t, i) => {
        const harmful = !!ops[i];
        // a target that is no longer legal is replaced by one that is
        if (!options[i].some(x => x.kind === t.kind && x.id === t.id)) return (harmful ? options[i].find(x => !mine(x)) : options[i].find(x => mine(x))) || options[i][0];
        if (harmful && mine(t)) return options[i].find(x => !mine(x)) || t;
        if (!harmful && !mine(t)) return options[i].find(x => mine(x)) || t;
        return t;
      });
    }

    /** Count something happening within one step; true once it has happened more than `most` times. */
    _loopTick(kind, most) {
      const key = this.turn + ':' + this.phaseIndex + ':' + this.stepIndex;
      this._loops = this._loops || {};
      const c = this._loops[kind];
      if (!c || c.key !== key) this._loops[kind] = { key, n: 0 };
      return ++this._loops[kind].n > most;
    }
    _endlessLoopDraw() {
      if (this.over) return;
      this.stack = [];
      this.pendingTriggers = [];
      this.over = true;
      this.winners = [];
      this.logEvent('game', 'The game is a draw: an endless loop that nobody can stop (CR 104.4b).');
      this.emit('game:over', this.winners);
      this.touch();
    }

    _lifeLockedFor(p) { return !!(p && p.lifeLocked && this._protectionLive(p.lifeLocked)); }
    /** An opponent of the player whose turn it is lost life: their speed rises, once a turn. */
    _speedUp(p) {
      const ap = this.activePlayer;
      if (ap && ap !== p && ap.speed && ap.speed < 4 && ap.speedTurn !== this.turn) {
        ap.speed++; ap.speedTurn = this.turn;
        this.logEvent('rules', `${ap.name}'s speed rises to ${ap.speed}.`);
      }
    }

    /** Somebody searched their library: whoever watches for that hears of it. */
    _searched(pid) {
      this._fire('opponentSearches', null, { except: pid, player: pid, playerId: pid });
    }

    _hasSubtype(o, t) { return ((o.analysis() || {}).subtypes || []).some(x => x.toLowerCase() === String(t).toLowerCase()); }

    /** Attackers of this player's that nobody blocked, after blockers are declared. */
    _unblockedAttackers(pid) {
      const steps = ['declareBlockers', 'firstStrikeDamage', 'combatDamage', 'endCombat'];
      if (!this.phase || this.phase.id !== 'combat' || !steps.includes(this.step)) return [];
      return (this.combat.attackers || []).map(id => this.obj(id))
        .filter(o => o && o.zone === 'battlefield' && o.controller === pid && o.attacking && !(o.blockedBy || []).length && !o.removedFromCombat);
    }
    /** Ninjutsu: the attacker home, and an ability to bring the Ninja in, on the stack. */
    _ninjutsuSwap(pid, ninjaId, back) {
      const ninja = this.obj(ninjaId);
      if (!ninja || ninja.zone !== 'hand' || !back || back.zone !== 'battlefield') return;
      const defender = back.attacking;
      this.moveObject(back, 'hand');
      this.combat.attackers = this.combat.attackers.filter(id => id !== back.id);
      const item = { id: this._uid('st'), kind: 'ability', obj: ninja, objId: ninja.id, controller: pid,
        name: ninja.name + ' \u2014 ninjutsu', abilityText: 'Put this card onto the battlefield tapped and attacking.',
        effects: [{ op: 'ninjaIn', defender }], auto: true, targets: [] };
      this.stack.push(item);
      this.logEvent('ability', `${this.player(pid).name} returns ${back.name} and activates ninjutsu.`);
      this.emit('stack:add', item);
      this._resetPriority();
    }

    /** The dredge cards in a graveyard that could replace a draw now. */
    _dredgeOptions(p) {
      const lib = this.zones[p.id].library.length;
      const out = [];
      for (const o of this.zones[p.id].graveyard) {
        const k = ((o.analysis() || {}).keywords || []).find(x => x.keyword === 'Dredge');
        const n = k ? parseInt(k.arg, 10) : 0;
        if (n > 0 && lib >= n) out.push({ o, n });
      }
      return out;
    }
    _dredge(p, o) {
      const k = ((o.analysis() || {}).keywords || []).find(x => x.keyword === 'Dredge');
      const n = k ? parseInt(k.arg, 10) : 0;
      const lib = this.zones[p.id].library;
      for (let i = 0; i < n && lib.length; i++) this.moveObject(lib[0], 'graveyard');
      this.moveObject(o, 'hand');
      this.logEvent('rules', `${p.name} dredges ${n}, returning ${o.name}.`);
    }

    /** May this player play this exiled card right now (impulse or free)? */
    _mayPlayFromExile(playerId, o) {
      if (!o || o.zone !== 'exile' || o.owner === playerId) return false;
      return (o.impulseBy === playerId && o.impulseUntil != null && o.impulseUntil >= this.turn) ||
        (o.freeCastBy === playerId && o.freeCastTurn === this.turn);
    }
    /** Cards in other players' exile that this player may play. */
    _borrowedExile(playerId) {
      const out = [];
      for (const q of this.players) {
        if (q.id === playerId) continue;
        for (const o of ((this.zones[q.id] || {}).exile || [])) if (this._mayPlayFromExile(playerId, o)) out.push(o);
      }
      return out;
    }

    /** The target specs of a spell or ability, in the order its targets were chosen. */
    _specsOf(item) {
      const specs = [];
      const walk = (list) => {
        for (const e of (list || [])) {
          if (!e) continue;
          if (e.op === 'sequence') { walk(e.list); continue; }
          for (const sp of (e.targets || [])) specs.push(sp);
        }
      };
      walk(item && item.effects);
      return specs;
    }
    _targetStillLegal(t, item, i) {
      if (t.kind === 'player') { const p = this.player(t.id); return p && !p.hasLost; }
      if (t.kind === 'object') {
        const o = this.obj(t.id);
        if (!o) return false;
        // "another target": never what the ability is on
        if (i != null && item.obj && o.id === item.obj.id && (this._specsOf(item)[i] || {}).another) return false;
        if (t.zone && o.zone !== t.zone) return false;
        if (o.zone === 'battlefield') {
          if (this.hasKw(o, 'hexproof') && o.controller !== item.controller) return false;
          if (this.hasKw(o, 'shroud')) return false;
          // protection from a quality the spell or ability's source has
          if (item.obj && this._protectedFrom(o, item.obj)) return false;
        }
        return true;
      }
      if (t.kind === 'stack') return this.stack.some(s => s.id === t.id);
      return true;
    }

    /* ---------- playing cards ---------- */

    canPlayLand(playerId) {
      const p = this.player(playerId);
      return this.activePlayer.id === playerId && this.isMain && this.stackEmpty
        && this.priorityPlayer && this.priorityPlayer.id === playerId
        && p.landsPlayed < this.landAllowance(p);
    }

    /**
     * How many lands this player may play this turn: one, plus whatever a
     * spell allowed this turn, plus every permanent of theirs that says
     * "you may play an additional land on each of your turns".
     */
    landAllowance(p) {
      if (!p) return 1;
      let k = p.maxLands || 1;
      for (const o of this.battlefield) {
        const e = this._staticOp(o, 'extraLand');
        // Rites of Flourishing gives every player the extra land
        if (e && (o.controller === p.id || e.all)) k += Number(e.n) || 1;
      }
      return k;
    }

    /**
     * A modal double-faced card whose back is a land (Fell the Profane //
     * Fell Mire): it can be played as that land instead of cast (CR 712.12).
     */
    landBack(o) {
      const faces = o && o.card && o.card.card_faces;
      return !!(o && !o.faceDown && o.card.layout === 'modal_dfc' && faces && faces[1] &&
        /\bLand\b/.test(faces[1].type_line || '') && !/\bLand\b/.test(faces[0].type_line || ''));
    }

    /** Play a land from hand. `face` 1 plays a modal double-faced card as the land on its back. */
    playLand(playerId, objId, face) {
      const p = this.player(playerId);
      const o = this.obj(objId);
      if (!o) return this.fail('No such card.');
      if (o.controller !== playerId && o.owner !== playerId) return this.fail('Not your card.');
      const a = o.analysis();
      const back = this.landBack(o) && (face === 1 || !(a && a.isLand));
      if (!back && (!a || !a.isLand)) return this.fail('That is not a land.');
      if (!this.canPlayLand(playerId)) return this.fail('You cannot play a land right now.');
      if (back) o.face = 1;
      p.landsPlayed++;
      this.moveObject(o, 'battlefield', { asLand: true });
      this.logEvent('land', `${p.name} plays ${o.name}.`);
      this.emit('sfx', 'land');
      this.checkStateBasedActions();
      /* Playing a land is a special action and uses no stack, but a land that
         does something as it enters has just triggered. Those triggers go on
         the stack the next time a player would receive priority (CR 603.3),
         which is now: you keep priority, and the trigger is waiting above
         you. Without this a Temple sat there and never scried. */
      this._resetPriority();
      this.touch();
      return true;
    }

    /** What it costs to cast this, after commander tax and cost reduction. */
    castCost(o, opts) {
      opts = opts || {};
      const a = o.analysis();
      let mana = (a && a.manaCost) || '';
      if (o.zone === 'command' && o.isCommander) {
        const p = this.player(o.owner);
        const tax = (p.commanderCasts[o.id] || 0) * 2;
        if (tax) mana = this._addGeneric(mana, tax);
      }
      /* standing taxes and discounts first (Thalia, Herald's Horn, the
         spell's own "costs {1} less for each…"), then convoke and its kin */
      const delta = this._costDelta(o, o.controller || o.owner);
      if (delta) mana = this._addGeneric(mana, delta);
      const cut = this.costReductionFor(o, opts);
      if (cut > 0) mana = this._addGeneric(mana, -cut);
      return mana;
    }

    /**
     * The standing changes to what a spell costs, added up: a Thalia's tax,
     * a Herald's Horn's discount, and the spell's own "costs {1} less to
     * cast for each artifact you control". More is positive, less negative.
     */
    _costDelta(o, pid) {
      const a = o.analysis();
      if (!a) return 0;
      let d = 0;
      for (const src of this.battlefield) {
        if (src.phasedOut) continue;
        const sa = src.analysis();
        if (!sa) continue;
        for (const ab of sa.abilities) {
          if (ab.kind !== 'static') continue;
          for (const e of (ab.effects || [])) {
            if (e.op !== 'costMod' && e.op !== 'taxSpells') continue;
            const who = e.who || 'all';
            if (who === 'you' && src.controller !== pid) continue;
            if (who === 'opponents' && src.controller === pid) continue;
            const words = e.op === 'costMod' ? e.words : String(e.filter || '').trim();
            if (words && words !== 'spell' && !this._cardFitsWords(o, words)) continue;
            if (e.chosenType && !(src.chosenType && this._hasCreatureType(o, src.chosenType))) continue;
            d += Number(e.amount) || 0;
          }
        }
      }
      for (const sc of (a.selfCost || [])) {
        let k = 0;
        if (sc.per) k = this._countValue(sc.per, pid, o);
        else if (sc.cond) k = this._condMet(sc.cond, { controller: pid, obj: o }) ? 1 : 0;
        else if (sc.x) {
          const list = this._scopeList(sc.scope || { who: 'you', what: 'creature' }, pid, null);
          k = sc.x === 'totalPower' ? list.reduce((t, x) => t + Math.max(0, this.powerOf(x)), 0)
            : list.reduce((best, x) => Math.max(best, this.powerOf(x)), 0);
        }
        d += (Number(sc.amount) || 0) * k;
      }
      return d;
    }

    /** A count the parser described ("for each artifact you control"), worked out for a player. */
    _countValue(v, pid, src, inLayers) {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const mult = v.mult || 1;
      if (v.scope) return this._scopeList(v.scope, pid, src, null, inLayers).length * mult;
      if (v.cardsInHand) return (((this.zones[pid] || {}).hand || []).length) * mult;
      if (v.cardsInGraveyard) {
        // "for each creature card in your graveyard": only the cards the words name
        const gy = ((this.zones[pid] || {}).graveyard || []);
        return (v.filter ? gy.filter(o => this._cardFitsWords(o, v.filter)).length : gy.length) * mult;
      }
      if (v.opponents) return this.opponentsOf(pid).length * mult;
      if (v.domain) return this._domainOf(pid) * mult;
      if (v.colorsAmongYours) return this._colorsAmongYours(pid).length * mult;
      if (v.per) return this.countPermanents(pid, v) * mult;
      return 0;
    }

    /** Domain: how many basic land types are among the lands a player controls. */
    _domainOf(pid) {
      const seen = new Set();
      for (const o of this.battlefield) {
        if (o.controller !== pid || o.phasedOut) continue;
        const a = o.analysis();
        if (!a || !a.isLand) continue;
        for (const t of (a.subtypes || [])) if (MANA.COLOR_OF_BASIC[t]) seen.add(t);
      }
      return seen.size;
    }

    /** Is this card the creature type named (changelings are every type)? */
    _hasCreatureType(o, type) {
      const a = o.analysis();
      if (!a || !type) return false;
      if (a.keywordSet && a.keywordSet.has('changeling')) return true;
      // Maskwood Nexus: your creature cards and spells are every type, wherever they are
      if (a.isCreature && o.zone !== 'battlefield' && this._anyStaticOf(o.owner, 'everyTypeElsewhere')) return true;
      if (o.zone === 'battlefield' && this.hasKw(o, 'changeling')) return true;
      const t = String(type).toLowerCase();
      return (a.subtypes || []).some(x => x.toLowerCase() === t);
    }

    /** Fold a delta into the generic part of a mana cost, never below zero. */
    _addGeneric(cost, delta) {
      const syms = MANA.parse(cost);
      let generic = 0;
      const rest = [];
      for (const sym of syms) {
        if (/^\d+$/.test(sym)) generic += parseInt(sym, 10);
        else rest.push(sym);
      }
      generic = Math.max(0, generic + delta);
      const out = (generic > 0 ? '{' + generic + '}' : '') + rest.map(x => '{' + x + '}').join('');
      return out;
    }

    /**
     * Total generic reduction available for casting this card right now:
     * convoke, improvise, delve, affinity, its own "costs {1} less for each"
     * clause, and any permanent that makes your spells cheaper (CR 601.2f).
     */
    costReductionFor(o, opts) {
      opts = opts || {};
      const a = o.analysis();
      if (!a) return 0;
      const pid = o.controller || o.owner;
      const cr = a.costReduction || {};
      let cut = 0;
      const count = (fn) => this.battlefield.filter(x => x.controller === pid && fn(x)).length;

      if (cr.convoke) cut += count(x => { const xa = x.analysis(); return xa && xa.isCreature && !x.tapped; });
      if (cr.improvise) cut += count(x => { const xa = x.analysis(); return xa && xa.isArtifact && !x.tapped; });
      if (cr.delve) cut += this.zones[pid] ? this.zones[pid].graveyard.length : 0;
      if (cr.affinity) {
        const f = cr.affinity;
        cut += count(x => {
          const xa = x.analysis();
          if (!xa) return false;
          if (/artifact/.test(f)) return xa.isArtifact;
          if (/creature/.test(f)) return xa.isCreature;
          if (/land/.test(f)) return xa.isLand;
          if (/enchantment/.test(f)) return xa.isEnchantment;
          return false;
        });
      }
      /* "costs {1} less for each…" and the permanents that discount spells
         are counted in _costDelta, from the same reading of the text. */
      // a cost can never be reduced below its coloured requirements
      const generic = MANA.parse(a.manaCost || '').filter(x => /^\d+$/.test(x))
        .reduce((acc, x) => acc + parseInt(x, 10), 0);
      return U.clamp(cut, 0, generic);
    }

    /** Is a spell with split second waiting on the stack (CR 702.19)? */
    _splitSecond() {
      return this.stack.some(it => {
        if (!it.obj || it.kind !== 'spell') return false;
        const a = it.obj.analysis();
        return !!(a && a.keywordSet && a.keywordSet.has('split second'));
      });
    }

    canCast(playerId, objId, opts) {
      const p = this.player(playerId);
      const o = this.obj(objId);
      if (!o) return { ok: false, reason: 'No such card.' };
      if (this._splitSecond()) return { ok: false, reason: 'A spell with split second is on the stack.' };
      if (typeof opts === 'string' && /^ability:\d+$/.test(opts)) return this._graveAbilityCheck(playerId, o, +opts.slice(8));
      if (opts === 'ninjutsu') {
        if (!this.priorityPlayer || this.priorityPlayer.id !== playerId) return { ok: false, reason: 'You do not have priority.' };
        if (!this._unblockedAttackers(playerId).length) return { ok: false, reason: 'Ninjutsu needs an unblocked attacker of yours.' };
        const use = this.altUsesFor(playerId, objId).find(u => u.via === 'ninjutsu');
        return use ? { ok: true, cost: use.cost } : { ok: false, reason: 'No ninjutsu.' };
      }
      const a = o.analysis();
      if (!a) return { ok: false, reason: 'Unknown card.' };
      if (a.isLand) return { ok: false, reason: 'Lands are played, not cast.' };
      if (o.card && o.card.layout === 'emblem') return { ok: false, reason: 'An emblem is not a card.' };
      if (!['hand', 'command', 'graveyard', 'exile', 'library'].includes(o.zone)) return { ok: false, reason: 'Not castable from ' + o.zone + '.' };
      const leave = (o.zone === 'library' || o.zone === 'graveyard') && !opts ? this._playFromRule(playerId, o, 'spell') : null;
      if (o.zone === 'library' && !leave && opts !== 'resolution') return { ok: false, reason: 'Not castable from library.' };
      if (o.zone === 'graveyard' && leave && this._anyStatic('cageGraveyards'))
        return { ok: false, reason: "A cage stops spells cast from graveyards." };
      if ((o.zone === 'graveyard' || o.zone === 'exile') && !leave) {
        if (o.zone === 'graveyard' && this._anyStatic('cageGraveyards'))
          return { ok: false, reason: "A cage stops spells cast from graveyards." };
        const impulsed = o.zone === 'exile' && o.impulseBy === playerId && o.impulseUntil != null && o.impulseUntil >= this.turn;
        if (o.grantedFlashback && o.zone === 'graveyard') return { ok: true, cost: this.castCost(o, opts) };
        /* A card with flashback is cast for its flashback cost, not for
           the cost printed in its corner — so casting it from the
           graveyard has to say which way in it is using. */
        if (!impulsed && !opts) return { ok: false, reason: 'Needs an alternate cost to cast from there.' };
      }
      /* A spell cast while something else is being cast or resolving
         (cascade, "you may cast it without paying its mana cost") ignores
         when it could normally be cast (CR 608.2g). */
      const midway = opts === 'cascade' || opts === 'resolution';
      // Drannith Magistrate: nothing from anywhere but the hand
      if (o.zone !== 'hand' && this.opponentsOf(playerId).some(q => this._anyStaticOf(q.id, 'onlyFromHand')))
        return { ok: false, reason: 'An opponent stops spells cast from anywhere but your hand.' };
      if (!midway && (!this.priorityPlayer || this.priorityPlayer.id !== playerId)) return { ok: false, reason: 'You do not have priority.' };
      const hush = this._castBlocked(playerId);
      if (hush) return { ok: false, reason: hush };
      const instantSpeed = midway || a.isInstant || a.has('flash') || this._flashFor(playerId, o);
      if (!instantSpeed) {
        if (this.activePlayer.id !== playerId) return { ok: false, reason: 'Sorcery speed: only on your turn.' };
        if (!this.isMain) return { ok: false, reason: 'Sorcery speed: only in a main phase.' };
        if (!this.stackEmpty) return { ok: false, reason: 'Sorcery speed: the stack must be empty.' };
      }
      /* "As an additional cost to cast this spell, sacrifice a creature":
         with nothing to give up, there is no casting it. */
      if (a.additionalCost && a.additionalCost.choice) {
        // a choice of prices: one of them has to be payable (the mana is counted when it is paid)
        const why = a.additionalCost.choice.every(c => this._thingCostBlocked(playerId, Object.assign({ spellLife: true }, c), o, null) ||
          (c.reveal && !this._discardPool(playerId, c.reveal, o).length));
        if (why) return { ok: false, reason: 'None of the additional costs can be paid.' };
      } else if (a.additionalCost) {
        const why = this._thingCostBlocked(playerId, Object.assign({ spellLife: true }, a.additionalCost), o, null);
        if (why) return { ok: false, reason: why };
      }
      /* Bolas's Citadel: life equal to the mana value, instead of mana */
      if (leave && leave.payLife) {
        const mv = MANA.cmc(a.manaCost || '');
        if (p.life < mv) return { ok: false, reason: 'Not enough life.' };
        return { ok: true, cost: '', lifeInstead: mv };
      }
      if (o.zone === 'hand' && !opts && this._anyStaticOf(playerId, 'freeFromHand')) return { ok: true, cost: '' };
      return { ok: true, cost: this.castCost(o, opts) };
    }

    /**
     * Why a card in this player's hand or command zone cannot be played
     * right now, in a few plain words, or null if nothing stands in the
     * way. The table says it when you point at a card; it decides nothing,
     * and anything it misses is still caught when the card is played.
     *   code: 'timing' | 'land' | 'priority' | 'mana' | 'targets' | 'rule'
     *   missing (for 'mana'): the shortfall by colour, plus `generic`
     */
    whyNotPlayable(playerId, objId) {
      const p = this.player(playerId);
      const o = this.obj(objId);
      if (!p || !o || p.hasLost || this.over || this.mulliganPhase) return null;
      const a = o.analysis();
      if (!a) return null;
      const yours = !!(this.activePlayer && this.activePlayer.id === playerId);
      const priority = !!(this.priorityPlayer && this.priorityPlayer.id === playerId);
      if (a.isLand) {
        if (!yours) return { code: 'timing', text: 'Lands are played on your own turn.' };
        if (!this.isMain) return { code: 'timing', text: 'Lands are played in one of your main phases.' };
        if (!this.stackEmpty) return { code: 'timing', text: 'Lands are played when the stack is empty.' };
        if (p.landsPlayed >= this.landAllowance(p)) return { code: 'land', text: 'You have already played a land this turn.' };
        if (!priority) return { code: 'priority', text: 'Waiting for priority.' };
        return null;
      }
      const instantSpeed = a.isInstant || a.has('flash') || this._flashFor(playerId, o);
      if (!instantSpeed) {
        const what = a.isCreature ? 'Creatures' : a.isSorcery ? 'Sorceries' : 'Cards like this';
        if (!yours) return { code: 'timing', text: `${what} are cast on your own turn (or it needs flash).` };
        if (!this.isMain) return { code: 'timing', text: `${what} are cast in one of your main phases.` };
        if (!this.stackEmpty) return { code: 'timing', text: `${what} are cast when the stack is empty.` };
      }
      if (!priority) return { code: 'priority', text: 'Waiting for priority.' };
      const chk = this.canCast(playerId, objId);
      if (!chk.ok) return { code: 'rule', text: chk.reason || 'It cannot be cast right now.' };
      const purse = this.manaSources(playerId);
      // the same check playableNow and castSpell's payment make
      if (!this.canPayNow(playerId, String(chk.cost || '').replace(/\{X\}/g, ''), { forSpell: o })) {
        return { code: 'mana', text: 'Not enough mana.', missing: this._manaShortfall(chk.cost, purse) };
      }
      if (!this._targetsAvailable(this._spellEffects(a), playerId)) return { code: 'targets', text: 'There is nothing it could target right now.' };
      return null;
    }

    /**
     * Roughly what a cost is short of, from these sources: each colour the
     * sources cannot make enough of, then any mana still missing overall.
     */
    _manaShortfall(cost, sources) {
      const need = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      let generic = 0;
      for (const sym of MANA.parse(String(cost || ''))) {
        if (/^\d+$/.test(sym)) { generic += parseInt(sym, 10); continue; }
        if (/^[WUBRGC]$/.test(sym)) { need[sym]++; continue; }
        if (sym === 'X' || sym === 'Y' || sym === 'Z' || sym.indexOf('P') >= 0) continue;
        generic++;                                          // a hybrid pip: any one mana of either
      }
      const out = {};
      let short = 0, pips = 0;
      for (const c of ['W', 'U', 'B', 'R', 'G']) {
        pips += need[c];
        const can = sources.filter(s => s.indexOf(c) >= 0).length;
        if (need[c] > can) { out[c] = need[c] - can; short += out[c]; }
      }
      pips += need.C;
      const over = pips + generic - sources.length - short;
      if (over > 0) out.generic = over;
      return out;
    }

    /**
     * Whether an ability that works from the graveyard can be activated
     * right now, in the shape canCast answers in: offered beside flashback,
     * it is asked about the same way.
     */
    _graveAbilityCheck(playerId, o, i) {
      const a = o.analysis();
      const all = a ? a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty')) : [];
      const ab = all[i];
      if (!ab || !ab.fromGraveyard || o.zone !== 'graveyard' || o.owner !== playerId) return { ok: false, reason: 'No such ability.' };
      if (!this.priorityPlayer || this.priorityPlayer.id !== playerId) return { ok: false, reason: 'You do not have priority.' };
      const c = ab.cost || {};
      if ((c.other || []).length) return { ok: false, reason: 'That cost has to be paid by hand.' };
      const why = this._activationBlocked(o, ab, playerId) || this._thingCostBlocked(playerId, c, o, null);
      if (why) return { ok: false, reason: why };
      if (ab.sorcerySpeed && !(this.activePlayer && this.activePlayer.id === playerId && this.isMain && this.stackEmpty))
        return { ok: false, reason: 'That ability is sorcery speed only.' };
      const p = this.player(playerId);
      if (c.life && p && p.life <= c.life) return { ok: false, reason: 'Not enough life.' };
      if (c.tapCreatures && this._tapCostPool(playerId, c.tapCreatures, o).length < this._costCount(c.tapCreatures.n, null))
        return { ok: false, reason: `Not enough untapped ${c.tapCreatures.filter || 'creature'}s to tap.` };
      return { ok: true, cost: c.mana || '', ability: i };
    }

    /* "You may cast spells as though they had flash": a permanent of
       yours that says so, or a spell that said so this turn. */
    _flashFor(playerId, o) {
      const p = this.player(playerId);
      if (p && p.flashTurn === this.turn) return true;
      for (const src of this.battlefield) {
        if (src.controller !== playerId || src.phasedOut) continue;
        const e = this._staticOp(src, 'flashGrant');
        if (e && (!e.filter || this._cardFitsWords(o, e.filter))) return true;
      }
      return false;
    }

    /**
     * "You may play lands from your graveyard", "…cast spells from the top
     * of your library": the standing leave, if any, this player has to use
     * this card from where it is. kind is 'land' or 'spell'.
     */
    _playFromRule(playerId, o, kind) {
      const z = this.zones[playerId];
      if (!z || !o || o.owner !== playerId) return null;
      const where = o.zone === 'library' ? (z.library[0] === o ? 'top' : null) : o.zone === 'graveyard' ? 'graveyard' : null;
      if (!where) return null;
      for (const src of this.battlefield) {
        if (src.controller !== playerId || src.phasedOut) continue;
        const a = src.analysis();
        if (!a) continue;
        for (const ab of a.abilities) {
          for (const ef of (ab.effects || [])) {
            if (ef.op !== 'playFrom' && ef.op !== 'playFromTop') continue;
            if ((ef.zone || 'top') !== where) continue;
            const what = ef.what || 'any';
            if (what !== 'any' && what !== kind) continue;
            if (ef.filter && !this._cardFitsWords(o, ef.filter)) continue;
            if (ef.duringYourTurn && (!this.activePlayer || this.activePlayer.id !== playerId)) continue;
            return ef;
          }
        }
      }
      return null;
    }

    /**
     * Cast a spell. `payment` describes how the player paid:
     *   { auto:true }                       tap lands automatically
     *   { fromPool:true }                   use mana already in the pool
     *   { tapIds:[objId...] }               tap these specific sources first
     *   { free:true }                       relaxed mode / alternative cost
     */
    /**
     * The extra costs a spell offers on the way down: kicker and its
     * relatives. Each is optional, each is paid as the spell is cast, and
     * the card's own text asks afterwards whether it was — which is why
     * the answer is recorded on the stack item rather than thrown away.
     */
    /**
     * The other ways a card can be used right now: cycled from hand, cast
     * from the graveyard for its flashback cost, and so on. Each is a
     * printed cost the table should honour rather than a footnote to read.
     */
    altUsesFor(playerId, objId) {
      const o = this.obj(objId);
      const a = o && o.analysis();
      const out = [];
      if (!a || !o) return out;
      /* Prepared: a copy of the card's spell, cast for that spell's cost */
      const spell = this._preparedSpell(o);
      if (spell && o.prepared && o.zone === 'battlefield' && o.controller === playerId) {
        out.push({ kind: 'cast', via: 'prepared', cost: spell.mana_cost || '', label: 'Cast a copy of ' + spell.name + ' ' + (spell.mana_cost || '') });
      }
      const GRAVE = { flashback: 'exile', 'jump-start': 'exile', aftermath: 'exile',
        escape: null, disturb: 'exile', unearth: 'exile', embalm: 'exile', eternalize: 'exile',
        madness: null };
      for (const ab of (a.abilities || [])) {
        if (ab.kind !== 'castModifier' || !ab.keyword) continue;
        const k = ab.keyword.toLowerCase();
        const arg = ab.arg || '';
        if (o.zone === 'hand') {
          if (k === 'cycling' && arg) out.push({ kind: 'cycle', cost: arg, label: 'Cycle ' + arg });
          const typed = /^(.+?)cycling$/.exec(k);
          if (typed && arg) {
            out.push({ kind: 'cycle', cost: arg,
              fetch: /^basic ?land$/.test(typed[1]) ? 'basic land' : typed[1],
              label: ab.keyword + ' ' + arg });
          }
        }
        if (o.zone === 'graveyard' && Object.prototype.hasOwnProperty.call(GRAVE, k) && arg) {
          /* Escape prints two costs in one clause: the mana, and a number
             of other cards out of your graveyard. */
          const mana = (String(arg).match(/^(?:\{[^}]+\})+/) || [arg])[0];
          const more = String(arg).slice(mana.length);
          const exile = more.match(/[Ee]xile (\w+) other cards? from your graveyard/);
          out.push({ kind: 'cast', via: k, cost: mana, after: GRAVE[k],
            exileGrave: exile ? WORD_NUM(exile[1]) : 0,
            label: ab.keyword + ' ' + arg });
        }
        /* Retrace and jump-start print no cost of their own: you pay what
           is in the card's corner and throw a card away on top of it
           (CR 702.81 / 702.131). */
        if (o.zone === 'graveyard' && k === 'retrace') {
          out.push({ kind: 'cast', via: 'retrace', cost: a.manaCost || '', after: null,
            discard: 'land', label: 'Retrace (discard a land)' });
        }
        if (o.zone === 'graveyard' && k === 'jump-start' && !arg) {
          out.push({ kind: 'cast', via: 'jump-start', cost: a.manaCost || '', after: 'exile',
            discard: 'any', label: 'Jump-start (discard a card)' });
        }
        /* Plot (CR 702.169): pay on one turn, cast for nothing on a later
           one. Warp (CR 702.180): cheap now, exiled at end of turn, and
           castable again from there afterwards. */
        if (o.zone === 'hand' && arg && k === 'plot') {
          out.push({ kind: 'plot', cost: arg, label: 'Plot ' + arg });
        }
        if (o.zone === 'hand' && arg && k === 'warp') {
          out.push({ kind: 'cast', via: 'warp', cost: arg, label: 'Warp ' + arg });
        }
        /* Suspend N—cost: exiled with a clock on it. */
        if (o.zone === 'hand' && arg && k === 'suspend') {
          const sm = String(arg).match(/^(\d+)\s*[\u2014-]\s*((?:\{[^}]+\})+)$/);
          if (sm) out.push({ kind: 'suspend', cost: sm[2], counters: +sm[1],
            label: 'Suspend ' + sm[1] + ' ' + sm[2] });
        }
        /* Transmute (CR 702.48): throw the card away to go and find one
           that costs the same. */
        if (o.zone === 'hand' && arg && k === 'transmute') {
          out.push({ kind: 'transmute', cost: arg, label: 'Transmute ' + arg });
        }
        /* Face down for three, and turned up later for its morph cost
           (CR 702.37). Disguise is the same with ward; megamorph brings a
           counter with it when it turns up. */
        if (o.zone === 'hand' && (k === 'morph' || k === 'megamorph' || k === 'disguise') && arg) {
          out.push({ kind: 'cast', via: 'morph', cost: '{3}', faceDown: true,
            turnUp: arg, morphKind: k, label: 'Cast face down {3}' });
        }
        /* Ninjutsu (CR 702.49): an unblocked attacker goes back to your hand
         and this comes in tapped and attacking in its place. */
      if (o.zone === 'hand' && k === 'impending' && a.impending) {
        out.push({ kind: 'cast', via: 'impending', cost: a.impending.cost, label: 'Impending ' + a.impending.cost });
      }
      if (o.zone === 'hand' && k === 'prototype' && a.prototype) {
        out.push({ kind: 'cast', via: 'prototype', cost: a.prototype.cost, label: 'Prototype ' + a.prototype.cost + ' (' + a.prototype.power + '/' + a.prototype.toughness + ')' });
      }
      if (o.zone === 'hand' && arg && k === 'ninjutsu') {
        out.push({ kind: 'cast', via: 'ninjutsu', cost: arg, label: 'Ninjutsu ' + arg });
      }
      /* Cheaper ways in from your hand, each with a string attached:
           evoke sacrifices it as it lands, dash sends it home at the end
           of the turn but lets it attack the moment it arrives. */
        if (o.zone === 'hand' && arg && (k === 'evoke' || k === 'dash')) {
          out.push({ kind: 'cast', via: k, cost: arg, label: ab.keyword + ' ' + arg });
        }
        /* Blitz (CR 702.152): cheap and fast, gone at end of turn, and it
           draws you a card on the way out. */
        if (o.zone === 'hand' && arg && k === 'blitz') {
          out.push({ kind: 'cast', via: 'blitz', cost: arg, label: 'Blitz ' + arg });
        }
        /* Mutate (CR 702.140): cast for its mutate cost onto a non-Human
           creature you own, and the two become one. */
        if (o.zone === 'hand' && arg && k === 'mutate') {
          out.push({ kind: 'cast', via: 'mutate', cost: arg, mutate: true,
            label: 'Mutate ' + arg });
        }
        /* Encore (CR 702.140): exile it from the graveyard and send a copy
           of it at each opponent, for one turn. */
        if (o.zone === 'graveyard' && arg && k === 'encore') {
          out.push({ kind: 'encore', cost: arg, label: 'Encore ' + arg });
        }
        /* Freerunning (CR 702.175): cheaper if an Assassin or your
           commander already got through this turn. */
        if (o.zone === 'hand' && arg && k === 'freerunning') {
          const owner = this.player(playerId);
          if (owner && owner.freerunningTurn === this.turn) {
            out.push({ kind: 'cast', via: 'freerunning', cost: arg, label: 'Freerunning ' + arg });
          }
        }
        /* Bestow (CR 702.103): cast as an Aura for more, and it goes on a
           creature; when that creature leaves it gets up and is a creature
           itself rather than dying with it. */
        if (o.zone === 'hand' && arg && k === 'bestow') {
          out.push({ kind: 'cast', via: 'bestow', cost: arg, aura: true, label: 'Bestow ' + arg });
        }
      }
      /* Underworld Breach: every nonland card in your graveyard has escape */
      if (o.zone === 'graveyard' && o.owner === playerId && !a.isLand &&
          this.battlefield.some(x => x.controller === playerId && this._staticOp(x, 'grantEscape')) &&
          !out.some(u => u.via === 'escape')) {
        out.push({ kind: 'cast', via: 'escape', cost: a.manaCost || '', after: null, exileGrave: 3,
          label: 'Escape (Underworld Breach)' });
      }
      if (o.zone === 'graveyard' && o.owner === playerId && !a.isLand) {
        for (const ab of (a.abilities || [])) {
          const k = String(ab.keyword || '').toLowerCase();
          /* Mayhem: from the graveyard, for its mayhem cost, the turn it was discarded */
          if (k === 'mayhem' && ab.arg && o.discardedTurn === this.turn) out.push({ kind: 'cast', via: 'mayhem', cost: ab.arg, after: null, label: 'Mayhem ' + ab.arg });
          /* Harmonize: from the graveyard, exiled afterwards; a creature may be tapped to help */
          if (k === 'harmonize' && ab.arg) out.push({ kind: 'cast', via: 'harmonize', cost: ab.arg, after: 'exile', harmonize: true, label: 'Harmonize ' + ab.arg });
        }
        if (o.graveCastBy === playerId && o.graveCastTurn === this.turn) {
          out.push({ kind: 'cast', via: 'granted', cost: a.manaCost || '', label: 'Cast it from your graveyard' });
        }
        const self = (a.abilities || []).find(ab => (ab.effects || []).some(x => x && x.op === 'castSelfFromGraveyard'));
        const rule = self && self.effects.find(x => x.op === 'castSelfFromGraveyard');
        if (rule && (!rule.cond || this._condMet(rule.cond, { controller: playerId, obj: o })) && !out.some(u => u.via === 'granted')) {
          out.push({ kind: 'cast', via: 'selfGrave', cost: a.manaCost || '', label: 'Cast it from your graveyard' });
        }
      }
      if (o.zone === 'exile' && o.owner === playerId && o.airbent && !a.isLand) {
        out.push({ kind: 'cast', via: 'airbend', cost: '{2}', label: 'Cast it for {2} (airbent)' });
      }
      if (o.zone === 'exile' && o.owner === playerId && !a.isLand) {
        const self = (a.abilities || []).find(ab => (ab.effects || []).some(x => x && x.op === 'castSelfFromGraveyard' && x.exile));
        if (self) out.push({ kind: 'cast', via: 'selfGrave', cost: a.manaCost || '', label: 'Cast it from exile' });
      }
      /* An ability that works from the graveyard (Reassembling Skeleton):
         offered where flashback is, and activated rather than cast when it
         is chosen. */
      if (o.zone === 'graveyard' && o.owner === playerId) {
        const acts = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
        acts.forEach((ab, i) => {
          if (!ab.fromGraveyard) return;
          out.push({ kind: 'cast', via: 'ability:' + i, ability: i, cost: (ab.cost && ab.cost.mana) || '',
            label: truncate(ab.text || MTG.oracle.abilityLabel(ab), 90) });
        });
      }
      /* Another way to pay, printed on the card itself: a commander on the
         battlefield makes it free, a blue card and a life point pay for
         Force of Will. Offered only when it could actually be paid. */
      if ((o.zone === 'hand' || o.zone === 'command') && a.altCosts) {
        a.altCosts.forEach((alt, i) => {
          if (alt.cond && !this._condMet(alt.cond, { controller: playerId, obj: o })) return;
          if (this._thingCostBlocked(playerId, { sacrifice: alt.sacrifice, discard: alt.discard }, o, null)) return;
          if (alt.exileFromHand && this._discardPool(playerId, alt.exileFromHand, o).length < (alt.exileFromHand.n || 1)) return;
          const me = this.player(playerId);
          if (alt.life && (!me || me.life < alt.life)) return;
          out.push({ kind: 'cast', via: 'alt' + i, cost: alt.mana || '', alt, label: alt.label });
        });
      }
      /* Channel: discard it from your hand for its ability. The table
         offers it where it offers cycling, which is the same act. */
      if (o.zone === 'hand' && a.channel) {
        let cost = a.channel.cost || '';
        if (a.channel.reduce) cost = this._addGeneric(cost, -a.channel.reduce.amount * this._countValue(a.channel.reduce.per, playerId, o));
        out.push({ kind: 'cycle', channel: true, cost,
          label: a.channel.exile ? 'Exile for mana' : 'Channel ' + (cost || '{0}') });
      }
      /* Overload (CR 702.96): pay more and every "target" becomes "each". */
      if (o.zone === 'hand' && a.overloadEffects) {
        const ab = (a.abilities || []).find(x => x.kind === 'castModifier' && /^overload$/i.test(x.keyword || '') && x.arg);
        if (ab) out.push({ kind: 'cast', via: 'overload', cost: ab.arg, overload: true, label: 'Overload ' + ab.arg });
      }
      if (o.zone === 'exile' && o.freeCastBy === playerId && o.freeCastTurn === this.turn && !a.isLand) {
        out.push({ kind: 'cast', via: 'free', cost: '', label: 'Cast it for free' });
      }
      /* Cards waiting in exile: plotted, or put there by warp. */
      if (o.zone === 'exile' && o.owner === playerId) {
        if (o.plottedTurn != null && o.plottedTurn < this.turn) {
          out.push({ kind: 'cast', via: 'plot', cost: '', free: true, label: 'Cast (plotted)' });
        }
        if (o.warpExiled) {
          out.push({ kind: 'cast', via: 'warpExile', cost: a.manaCost || '', label: 'Cast (warped)' });
        }
      }
      return out;
    }

    /**
     * Encore (CR 702.140): pay, exile the card from your graveyard, and
     * each opponent gets a copy of it coming at them for one turn.
     */
    encoreCard(playerId, objId, opts) {
      const o = this.obj(objId);
      if (!o || o.zone !== 'graveyard' || o.owner !== playerId) return this.fail('That is not in your graveyard.');
      const use = this.altUsesFor(playerId, objId).find(x => x.kind === 'encore');
      if (!use) return this.fail('That card has no encore ability.');
      const why = this._sorcerySpeedBlock(playerId);
      if (why) return this.fail(why);
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts || {}))) {
        return this.fail(`Not enough mana for encore (${use.cost}).`);
      }
      const card = o.card, face = o.face || 0;
      this.moveObject(o, 'exile');
      let made = 0;
      for (const foe of this.opponentsOf(playerId)) {
        const copy = this._register(new GObj(card, playerId, 'battlefield'));
        copy.isToken = true; copy.zone = 'battlefield'; copy.face = face;
        copy.entered = this.turn; copy.summoningSick = false;
        copy.effects.push({ keywords: ['Haste'], until: null });
        copy.mustAttackPlayer = foe.id;
        copy.sacAtEndOfTurn = this.turn;
        copy.ts = this._stampNew();      // its timestamp (CR 613.7d)
        this.battlefield.push(copy);
        this.bumpBoard();
        this._onEnter(copy);
        this._fireEnters(copy);
        made++;
      }
      this.logEvent('token', `${this.player(playerId).name} encores ${card.name}: ${made} cop${made === 1 ? 'y' : 'ies'}.`);
      this.emit('sfx', 'play_card');
      this.checkStateBasedActions();
      this._resetPriority();
      return true;
    }

    /**
     * Plot (CR 702.169): a special action, at sorcery speed, that pays the
     * plot cost and sets the card aside face up. From the next turn on it
     * can be cast from exile for nothing.
     */
    plotCard(playerId, objId, opts) {
      const o = this.obj(objId);
      if (!o || o.zone !== 'hand' || o.controller !== playerId) return this.fail('That is not in your hand.');
      const use = this.altUsesFor(playerId, objId).find(x => x.kind === 'plot');
      if (!use) return this.fail('That card cannot be plotted.');
      const why = this._sorcerySpeedBlock(playerId);
      if (why) return this.fail(why);
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts || {}))) {
        return this.fail(`Not enough mana to plot (${use.cost}).`);
      }
      this.moveObject(o, 'exile');
      o.plottedTurn = this.turn;
      o.faceDown = false;
      this.logEvent('rules', `${this.player(playerId).name} plots ${o.name}.`);
      this._resetPriority();
      return true;
    }

    /**
     * Suspend N—cost (CR 702.62): exile it with a clock on it. A counter
     * comes off at each of your upkeeps, and when the last one goes the
     * card is cast for free — with haste, if it is a creature.
     */
    suspendCard(playerId, objId, opts) {
      const o = this.obj(objId);
      if (!o || o.zone !== 'hand' || o.controller !== playerId) return this.fail('That is not in your hand.');
      const use = this.altUsesFor(playerId, objId).find(x => x.kind === 'suspend');
      if (!use) return this.fail('That card cannot be suspended.');
      if (!this.priorityPlayer || this.priorityPlayer.id !== playerId) return this.fail('You do not have priority.');
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts || {}))) {
        return this.fail(`Not enough mana to suspend (${use.cost}).`);
      }
      this.moveObject(o, 'exile');
      o.counters.time = use.counters;
      o.suspendedBy = playerId;
      this.logEvent('rules', `${this.player(playerId).name} suspends ${o.name} with ${use.counters} time counters.`);
      this._resetPriority();
      return true;
    }

    /** A time counter comes off each suspended card at its owner's upkeep. */
    _tickSuspended(playerId) {
      for (const o of (this.zones[playerId] || {}).exile || []) {
        if (o.suspendedBy !== playerId || !o.counters.time) continue;
        o.counters.time--;
        this.logEvent('rules', `${o.name}: ${o.counters.time} time counter${o.counters.time === 1 ? '' : 's'} left.`);
        if (o.counters.time > 0) continue;
        o.suspendedBy = null;
        o.suspendHaste = true;
        const r = this.castSpell(playerId, o.id,
          { free: true, costOverride: '', alternative: 'suspend', auto: true, targets: [] });
        if (r === false) this.logEvent('rules', `${o.name} could not be cast from suspend.`);
      }
    }

    /**
     * Transmute (CR 702.48): discard the card and pay, and a card of the
     * same mana value comes out of your library instead.
     */
    transmuteCard(playerId, objId, opts) {
      const o = this.obj(objId);
      if (!o || o.zone !== 'hand' || o.controller !== playerId) return this.fail('That is not in your hand.');
      const use = this.altUsesFor(playerId, objId).find(x => x.kind === 'transmute');
      if (!use) return this.fail('That card has no transmute ability.');
      const why = this._sorcerySpeedBlock(playerId);
      if (why) return this.fail(why);
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts || {}))) {
        return this.fail(`Not enough mana to transmute (${use.cost}).`);
      }
      const mv = (o.card && o.card.cmc) || 0;
      this.moveObject(o, 'graveyard');
      this.logEvent('rules', `${this.player(playerId).name} transmutes ${o.name}.`);
      this._runEffects([{ op: 'tutor', n: 1, to: 'hand', mv,
        prompt: `Search your library for a card with mana value ${mv}.` }],
      { controller: playerId, obj: o, name: o.name }, null, 'transmute');
      this.checkStateBasedActions();
      this._resetPriority();
      return true;
    }

    /** Why a sorcery-speed special action cannot be taken right now. */
    _sorcerySpeedBlock(playerId) {
      if (!this.priorityPlayer || this.priorityPlayer.id !== playerId) return 'You do not have priority.';
      if (!this.activePlayer || this.activePlayer.id !== playerId) return 'Only on your turn.';
      if (!this.isMain) return 'Only in a main phase.';
      if (!this.stackEmpty) return 'Only while the stack is empty.';
      return null;
    }

    /**
     * Madness (CR 702.35): a card discarded with madness can be cast for
     * its madness cost instead of lying in the graveyard. The offer is
     * made once, to the player who discarded it, and only when they could
     * actually pay.
     */
    _offerMadness(playerId, o) {
      if (!o || o.zone !== 'graveyard') return;
      const a = o.trueAnalysis ? o.trueAnalysis() : o.analysis();
      const ab = a && (a.abilities || []).find(x => x.kind === 'castModifier' &&
        /^madness$/i.test(x.keyword || '') && x.arg);
      if (!ab) return;
      if (!this.couldPay(playerId, ab.arg, this.manaSources(playerId))) return;
      this.queueChoice({
        type: 'confirm', playerId, purpose: 'madness', objId: o.id, cost: ab.arg,
        prompt: `Cast ${o.name} for its madness cost (${ab.arg})?`,
      });
    }

    /** Exploit (CR 702.131): as it enters, you may sacrifice a creature. */
    _exploitOnEnter(o) {
      const a = o.analysis();
      if (!a || !(a.abilities || []).some(ab => (ab.effects || []).some(e => e.op === 'exploit'))) return;
      const pool = this.battlefield.filter(x => x.controller === o.controller &&
        (x.analysis() || {}).isCreature);
      if (!pool.length) return;
      this.queueChoice({
        type: 'sacrifice', playerId: o.controller, count: 1, optional: true,
        filter: 'creature', purpose: 'exploit', sourceId: o.id,
        prompt: `${o.name} exploits: sacrifice a creature?`,
      });
    }

    /** Ascend (CR 702.131): ten permanents and the city's blessing is yours. */
    _checkAscend() {
      for (const o of this.battlefield) {
        const a = o.analysis();
        if (!a || !(a.abilities || []).some(ab => (ab.effects || []).some(e => e.op === 'ascend'))) continue;
        const p = this.player(o.controller);
        if (!p || p.cityBlessing) continue;
        const mine = this.battlefield.filter(x => x.controller === p.id).length;
        if (mine < 10) continue;
        p.cityBlessing = true;
        this.logEvent('rules', `${p.name} has the city's blessing.`);
      }
    }

    /** Somebody discarded a card: the rules may not be finished with it. */
    _afterDiscard(playerId, o) {
      o.discardedTurn = this.turn;          // mayhem asks
      this._offerMadness(playerId, o);
      this._fire('youDiscard', playerId, { object: o, playerId });
      this._fire('opponentDiscards', null, { object: o, playerId, except: playerId });
      this._fire('anyDiscard', null, { object: o, playerId });
    }

    /**
     * Turn a face-down permanent up (CR 702.37b). It is a special action:
     * no stack, no priority passed, any time you have priority — which is
     * the whole point of morph.
     */
    turnFaceUp(playerId, objId, opts) {
      opts = opts || {};
      const o = this.obj(objId);
      if (!o || o.zone !== 'battlefield') return this.fail('That is not on the battlefield.');
      if (o.controller !== playerId) return this.fail('You do not control that.');
      if (!o.faceDown) return this.fail('That is already face up.');
      const real = o.trueAnalysis ? o.trueAnalysis() : null;
      const ab = real && (real.abilities || []).find(x => x.kind === 'castModifier' &&
        /^(morph|megamorph|disguise)$/i.test(x.keyword || '') && x.arg);
      if (!ab) return this.fail('That has no way of turning face up.');
      if (!this.payMana(playerId, ab.arg, Object.assign({ auto: true }, opts))) {
        return this.fail(`Not enough mana to turn ${real.name || 'it'} face up (${ab.arg}).`);
      }
      o.faceDown = false;
      if (/megamorph/i.test(ab.keyword)) this.addCounters(o, '+1/+1', 1);
      this.logEvent('rules', `${this.player(playerId).name} turns ${o.name} face up.`);
      this.emit('sfx', 'transform');
      this._fire('turnedFaceUp', playerId, { object: o, source: o });
      this.checkStateBasedActions();
      this.touch();
      return true;
    }

    /**
     * Cycling (CR 702.29): discard the card, pay the cost, draw one — or,
     * for the typecycling variants, go and find the land instead.
     */
    cycleCard(playerId, objId, opts) {
      opts = opts || {};
      const o = this.obj(objId);
      if (!o || o.zone !== 'hand' || o.controller !== playerId) return this.fail('That is not in your hand.');
      const use = this.altUsesFor(playerId, objId).find(x => x.kind === 'cycle' && (opts.channel == null || !!x.channel === !!opts.channel));
      if (!use) return this.fail('That card has no cycling ability.');
      if (!this.priorityPlayer || this.priorityPlayer.id !== playerId) return this.fail('You do not have priority.');
      if (use.channel) return this._channel(playerId, o, use, opts);
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts))) {
        return this.fail(`Not enough mana to cycle (${use.cost}).`);
      }
      this.moveObject(o, 'graveyard');
      this.logEvent('cycle', `${this.player(playerId).name} cycles ${o.name}.`);
      this._fire('youCycle', playerId, { object: o, source: o });
      this._fire('anyCycle', null, { object: o, playerId });
      // cycling is discarding, for "whenever you discard a card"
      this._afterDiscard(playerId, o);
      /* "When you cycle this card": its own trigger, from the graveyard */
      const ca = o.analysis();
      (ca ? ca.abilities : []).forEach((ab, i) => {
        if (ab.kind !== 'triggered' || ab.event !== 'cycleSelf') return;
        this.pendingTriggers.push({
          id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: i,
          controller: playerId, name: `${o.name} — ${truncate(MTG.oracle.abilityLabel(ab), 50)}`,
          effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab), optional: ab.optional,
          triggerData: { event: 'cycleSelf', objectId: o.id },
        });
      });
      if (use.fetch) {
        /* Typecycling searches for the land and puts it in your hand
           (CR 702.29b) — it is a tutor, not a land drop. */
        this._runEffects([{ op: 'tutor', n: 1, to: 'hand',
          filter: use.fetch === 'basic land' ? 'basic land' : use.fetch,
          prompt: `Search your library for a ${use.fetch} card.` }],
        { controller: playerId, obj: o, name: o.name }, null, 'cycle');
      } else {
        this._drawCards(this.player(playerId), 1);
      }
      this.checkStateBasedActions();
      this._resetPriority();
      return true;
    }

    /**
     * Channel: pay, discard the card, and its ability goes on the stack. What
     * it points at is chosen as it resolves, the way a mode's target is.
     */
    _channel(playerId, o, use, opts) {
      const a = o.analysis();
      if (!this.payMana(playerId, use.cost, Object.assign({ auto: true }, opts))) {
        return this.fail(`Not enough mana to channel (${use.cost}).`);
      }
      /* A Spirit Guide is exiled, and its mana arrives at once: a mana
         ability never uses the stack. */
      if (a.channel.exile) {
        this.moveObject(o, 'exile');
        this.logEvent('ability', `${this.player(playerId).name} exiles ${o.name} from their hand.`);
        if (a.channel.mana) {
          this._runManaAbility(playerId, o, { effects: a.channel.effects }, { controller: playerId, obj: o, name: o.name });
          return true;
        }
      } else {
        this.moveObject(o, 'graveyard');
        this._afterDiscard(playerId, o);
      }
      const item = {
        id: this._uid('st'), kind: 'ability', obj: o, objId: o.id, abilityIndex: -1,
        controller: playerId, name: `${o.name} \u2014 channel`,
        targets: (opts.targets || []).map(normTarget),
        effects: a.channel.effects, auto: true, abilityText: 'Channel',
      };
      this.stack.push(item);
      this.logEvent('ability', `${this.player(playerId).name} channels ${o.name}.`);
      this.emit('sfx', 'cast');
      this.emit('stack:add', item);
      this._resetPriority();
      return true;
    }

    extraCostsFor(objId) {
      const o = this.obj(objId);
      const a = o && o.analysis();
      const out = [];
      if (!a) return out;
      for (const ab of (a.abilities || [])) {
        if (ab.kind !== 'castModifier' || !ab.keyword || !ab.arg) continue;
        const k = ab.keyword.toLowerCase();
        if (k === 'kicker') out.push({ kind: 'kicker', cost: ab.arg, label: 'Kicker ' + ab.arg });
        else if (k === 'multikicker') out.push({ kind: 'multikicker', cost: ab.arg, label: 'Multikicker ' + ab.arg });
        else if (k === 'buyback') out.push({ kind: 'buyback', cost: ab.arg, label: 'Buyback ' + ab.arg });
        else if (k === 'entwine') out.push({ kind: 'entwine', cost: ab.arg, label: 'Entwine ' + ab.arg });
        /* Offspring and squad both buy copies of the creature on the way
           down (CR 702.129 / 702.157); casualty buys a copy of the spell
           by sacrificing something (CR 702.152). */
        else if (k === 'offspring') out.push({ kind: 'offspring', cost: ab.arg, label: 'Offspring ' + ab.arg });
        else if (k === 'squad') out.push({ kind: 'squad', cost: ab.arg, label: 'Squad ' + ab.arg });
        else if (k === 'casualty') out.push({ kind: 'casualty', n: parseInt(ab.arg, 10) || 1,
          cost: '', label: 'Casualty ' + ab.arg });
      }
      /* Spree: the modes are the extra costs, and at least one is bought. */
      if (a.spreeModes && a.spreeModes.length) {
        out.push({ kind: 'spree', cost: '', modes: a.spreeModes.slice(),
          label: 'Spree (choose one or more)' });
      }
      /* Replicate and splice are generic questions (docs/choices.md). The
         table may answer them alongside the other extra costs, sending the
         answers with the cast; a cast that arrives without them asks. */
      const rep = this._replicateCost(a);
      if (rep) {
        out.push({ kind: 'replicate', cost: rep, label: 'Replicate ' + rep,
          choose: { purpose: 'replicate', kind: 'number', number: { min: 0, max: 20 }, cost: rep,
            prompt: `How many copies, at ${rep} each?` } });
      }
      if (o.zone === 'hand') {
        const sp = this._spliceable(o.owner, o);
        if (sp.length) {
          const items = this._chooseItems(sp.map(x => x.obj));
          items.forEach((it, i) => { it.cost = sp[i].cost; });
          out.push({ kind: 'splice', cost: '', label: 'Splice onto Arcane',
            choose: { purpose: 'splice', kind: 'objects', zone: 'hand', reveal: true, items, min: 0, max: items.length,
              constraints: [{ kind: 'mana', key: 'cost', label: 'mana' }], prompt: 'Splice onto Arcane' } });
        }
      }
      return out;
    }

    /**
     * The choices made while casting that the table puts to a person before
     * anything is paid (CR 601.2b): which of two additional costs, and
     * whether to promise a gift and to whom. Returns null to carry on (with
     * the answers written into opts), 'asked' when a question has gone out
     * — the cast starts again once it is answered — or why it cannot go on.
     */
    _castChoices(playerId, o, a, opts, chk) {
      const p = this.player(playerId);
      const decides = !!(p && p.isBot) || !!opts.autoCost;
      const ask = (field, prompt, labels, values) => {
        const keep = Object.assign({}, opts);
        delete keep[field];
        this.queueChoice({ type: 'mode', playerId, purpose: 'castChoice', objId: o.id, field, values,
          castOpts: JSON.parse(JSON.stringify(keep)), count: 1, prompt,
          options: labels.map((label, i) => ({ i, label })),
          sourceId: o.id, sourceName: o.name, sourceCard: o.card });
        return 'asked';
      };
      const add = a && a.additionalCost;
      if (add && add.choice && !opts.skipAdditional && opts.additionalChoice == null) {
        const ok = this._payableChoices(playerId, o, add.choice, opts.free ? '' : chk.cost, opts);
        if (!ok.length) return 'None of the additional costs can be paid.';
        if (ok.length === 1) opts.additionalChoice = ok[0];
        else if (decides) opts.additionalChoice = this._easiestChoice(playerId, add.choice, ok);
        else return ask('additionalChoice', `${o.name}: which additional cost will you pay?`, ok.map(i => add.choice[i].label), ok);
      }
      /* Bargain (CR 702.166): an artifact, enchantment or token sacrificed
         as the spell is cast, for a better spell. */
      if (a && a.keywordSet && a.keywordSet.has('bargain') && opts.bargain === undefined) {
        const pool = this.battlefield.filter(x => x.controller === playerId && !x.phasedOut && x !== o &&
          (x.isToken || this._cardFitsWords(x, 'artifact or enchantment')));
        if (!pool.length) opts.bargain = null;
        else if (decides) {
          const cheap = this._cheapestFirst(pool)[0];
          opts.bargain = (cheap.isToken || this._cardValue(cheap) <= 1.5) ? cheap.id : null;
        } else {
          const list = this._cheapestFirst(pool).slice(0, 12);
          return ask('bargain', `${o.name}: bargain? Sacrifice an artifact, enchantment or token.`,
            ["Don't bargain"].concat(list.map(x => 'Sacrifice ' + x.name)), [null].concat(list.map(x => x.id)));
        }
      }
      if (a && a.gift && (opts.gift === undefined || opts.gift === true)) {
        const opps = this.opponentsOf(playerId).filter(x => !x.hasLost);
        if (!opps.length) opts.gift = null;
        else if (opts.gift === true) opts.gift = opps[0].id;
        else if (decides) opts.gift = this._botGift(playerId, a.gift, opps);
        else {
          const what = a.gift === 'card' ? 'a card' : a.gift === 'extra turn' ? 'an extra turn' : 'a ' + a.gift;
          return ask('gift', `${o.name}: promise a gift (${what})?`,
            ["Don't promise a gift"].concat(opps.map(x => `Promise ${what} to ${x.name}`)), [null].concat(opps.map(x => x.id)));
        }
      }
      /* Replicate, splice onto Arcane and conspire are generic questions:
         asked one after another, each knowing what the last one added. */
      if (!o.isCopy) {
        for (const kind of ['replicate', 'splice', 'conspire']) {
          const spec = this._castQuestion(kind, playerId, o, a, opts, chk);
          if (spec && this._castChoose(playerId, o, opts, spec) === 'asked') return 'asked';
        }
      }
      return null;
    }

    /** "Replicate {1}{U}": the price of one more copy, or null. */
    _replicateCost(a) {
      const ab = a && (a.abilities || []).find(x => x.kind === 'castModifier' && /^replicate$/i.test(x.keyword || '') && x.arg);
      return ab && /^(?:\{[^}]+\})+$/.test(ab.arg.trim()) ? ab.arg.trim() : null;
    }
    /**
     * The cards in hand that could be spliced onto this spell (CR 702.47):
     * it has to be Arcane, and each card's splice cost has to be mana.
     */
    _spliceable(playerId, o) {
      const a = o && o.analysis();
      if (!a || !(a.subtypes || []).some(t => /^arcane$/i.test(t))) return [];
      const out = [];
      for (const c of ((this.zones[playerId] || {}).hand || [])) {
        if (c === o) continue;
        const ca = c.analysis();
        const ab = ca && (ca.abilities || []).find(x => x.kind === 'castModifier' && /^splice$/i.test(x.keyword || ''));
        const m = ab && String(ab.arg || '').match(/^onto Arcane\s*((?:\{[^}]+\})+)$/i);
        if (m) out.push({ obj: c, cost: m[1] });
      }
      return out;
    }
    /** What has been added to the price of this cast by the generic questions answered so far. */
    _castAdded(playerId, o, a, opts) {
      const got = opts.choices || {};
      let more = '';
      const rep = this._replicateCost(a);
      if (rep && got.replicate && got.replicate.number) more += rep.repeat(got.replicate.number);
      if (got.splice) for (const x of this._spliceable(playerId, o)) if ((got.splice.picks || []).includes(x.obj.id)) more += x.cost;
      return more;
    }
    /** One of the generic questions casting can raise, or null when it does not arise. */
    _castQuestion(kind, playerId, o, a, opts, chk) {
      const base = (opts.free ? '' : String(chk.cost || '').replace(/\{X\}/g, opts.x ? '{' + opts.x + '}' : '')) +
        (kind === 'replicate' ? '' : this._castAdded(playerId, o, a, opts));
      const purse = this.manaSources(playerId);
      if (kind === 'replicate') {
        const rep = this._replicateCost(a);
        if (!rep) return null;
        let most = 0;
        while (most < 20 && this.couldPay(playerId, base + rep.repeat(most + 1), purse)) most++;
        if (!most) return null;
        return { purpose: 'replicate', kind: 'number', number: { min: 0, max: most },
          prompt: `Replicate ${o.name}? Pay ${rep} for each copy.`, cost: rep };
      }
      if (kind === 'splice') {
        const list = this._spliceable(playerId, o).filter(x => this.couldPay(playerId, base + x.cost, purse));
        if (!list.length) return null;
        const items = this._chooseItems(list.map(x => x.obj));
        items.forEach((it, i) => { it.cost = list[i].cost; });
        return { purpose: 'splice', kind: 'objects', items, min: 0, max: items.length, zone: 'hand', reveal: true,
          constraints: [{ kind: 'mana', key: 'cost', base, label: 'mana' }],
          prompt: `Splice onto ${o.name}? Each card you choose is revealed and its splice cost paid.` };
      }
      if (kind === 'conspire') {
        if (!(a && a.keywordSet && a.keywordSet.has('conspire'))) return null;
        const colours = (o.card && o.card.colors) || [];
        const pool = this.battlefield.filter(x => x.controller === playerId && !x.phasedOut && !x.tapped &&
          (this.characteristics(x) || {}).isCreature && ((this.characteristics(x) || {}).colors || x.card.colors || []).some(c => colours.includes(c)));
        if (pool.length < 2) return null;
        return { purpose: 'conspire', kind: 'objects', items: this._chooseItems(pool), min: 2, max: 2, optional: true, zone: 'battlefield',
          constraints: [{ kind: 'shareColour', with: colours, reason: `Each creature has to share a colour with ${o.name}.` }],
          prompt: `Conspire? Tap two untapped creatures that share a colour with ${o.name} to copy it.` };
      }
      return null;
    }
    /** A copy of an effect list whose targets are chosen as it resolves, not taken from the spell it rides on. */
    _ownTargets(list) {
      const mark = (e) => {
        if (!e || typeof e !== 'object') return e;
        if (e.targets && e.targets.length) e.askTargets = true;
        for (const k of ['list', 'then', 'otherwise']) if (Array.isArray(e[k])) e[k].forEach(mark);
        return e;
      };
      return JSON.parse(JSON.stringify(list || [])).map(mark);
    }
    /** Which of a choice of additional costs this player could pay right now. */
    _payableChoices(playerId, o, choices, baseCost, opts) {
      const purse = this.manaSources(playerId);
      const out = [];
      choices.forEach((c, i) => {
        if (this._thingCostBlocked(playerId, Object.assign({ spellLife: true }, c), o, opts)) return;
        if (c.reveal && !this._discardPool(playerId, c.reveal, o).length) return;
        if (c.mana && !this.couldPay(playerId, String(baseCost || '') + c.mana, purse)) return;
        out.push(i);
      });
      return out;
    }
    /** The price that hurts least: mana to spare, then life to spare, then cards. */
    _easiestChoice(playerId, choices, ok) {
      const p = this.player(playerId);
      const pain = (c) => {
        if (c.reveal) return 0;
        if (c.mana) return 1 + MANA.cmc(c.mana) * 0.5;
        if (c.life != null) return (p.life - (+c.life || 0)) > 8 ? (+c.life || 0) * 0.3 : 50;
        if (c.tapCreatures) return 1.5;
        if (c.exile) return 1;
        if (c.discard) return 2.5;
        if (c.returnOwn) return 2;
        return 3;
      };
      return ok.slice().sort((x, y) => pain(choices[x]) - pain(choices[y]))[0];
    }
    /**
     * A bot's gift: small presents are worth the bonus, an extra turn or an
     * 8/8 is not. It goes to whoever is least of a threat.
     */
    _botGift(playerId, gift, opps) {
      if (gift === 'extra turn' || gift === 'octopus') return null;
      const weight = (x) => x.life + this.battlefield.filter(o => o.controller === x.id).length * 2;
      return opps.slice().sort((x, y) => weight(x) - weight(y))[0].id;
    }

    /** The spell half of a prepare card, written out as a card of its own. */
    _preparedSpell(o) {
      const c = o && (o.printedCard || o.card);
      if (!c || c.layout !== 'prepare' || !c.card_faces || c.card_faces.length < 2) return null;
      const f = c.card_faces[1];
      return { id: c.id + ':prepared', oracle_id: c.oracle_id, name: f.name, mana_cost: f.mana_cost || '', cmc: MANA.cmc(f.mana_cost || ''),
        type_line: f.type_line, oracle_text: f.oracle_text || '', colors: f.colors || c.colors || [], color_identity: c.color_identity || [],
        keywords: [], layout: 'normal', rarity: c.rarity, set: c.set, set_name: c.set_name, collector_number: c.collector_number,
        image_uris: f.image_uris || c.image_uris || null };
    }

    /** Cast a copy of a prepared permanent's spell; doing so unprepares it. */
    _castPrepared(playerId, objId, opts) {
      const o = this.obj(objId);
      const spell = this._preparedSpell(o);
      if (!o || !spell || !o.prepared || o.zone !== 'battlefield' || o.controller !== playerId) return this.fail('That is not prepared.');
      const dup = this._register(new GObj(spell, playerId, 'exile'));
      dup.isCopy = true;
      dup.impulseBy = playerId; dup.impulseUntil = this.turn;
      this.zones[playerId].exile.push(dup);
      const ok = this.castSpell(playerId, dup.id, Object.assign({}, opts, { via: null }));
      const st = this.stack.find(x => x.objId === dup.id);
      if (ok && st) {
        st.isCopy = true;
        o.prepared = false;
        this.logEvent('cast', `${this.player(playerId).name} casts a copy of ${spell.name} from ${o.name}, which is no longer prepared.`);
        return ok;
      }
      this._removeFromZone(dup);
      dup.zone = null;
      return ok;
    }

    castSpell(playerId, objId, opts) {
      opts = opts || {};
      if (opts.via === 'prepared') return this._castPrepared(playerId, objId, opts);
      /* An ability that works from the graveyard is offered among the ways
         to cast a card from there, so choosing it arrives here: it is
         activated, not cast. Targets chosen for the card as a spell are
         only kept when they are the ability's own. */
      if (opts.via === 'ninjutsu') {
        const chk1 = this.canCast(playerId, objId, 'ninjutsu');
        if (!chk1.ok) return this.fail(chk1.reason);
        if (!this.payMana(playerId, chk1.cost, Object.assign({}, opts, { forAbility: this.obj(objId) }))) return this.fail(`Not enough mana (${chk1.cost}).`);
        const list = this._unblockedAttackers(playerId);
        const pl = this.player(playerId);
        if (list.length === 1 || pl.isBot || opts.returnId) {
          this._ninjutsuSwap(playerId, objId, (opts.returnId && this.obj(opts.returnId)) || this._cheapestFirst(list)[0]);
        } else {
          this.queueChoice({ type: 'pickCard', playerId, count: 1, purpose: 'ninjutsu', objId, worst: true,
            candidates: list.map(x => x.id), cards: list.map(x => ({ id: x.id, name: x.name, card: x.card })),
            prompt: 'Return an unblocked attacker you control to your hand.' });
        }
        return true;
      }
      if (opts.via && /^ability:\d+$/.test(opts.via)) {
        const chk0 = this.canCast(playerId, objId, opts.via);
        if (!chk0.ok) return this.fail(chk0.reason);
        const ga = this.obj(objId).analysis();
        const gab = ga.manaAbilities.concat(ga.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'))[chk0.ability];
        const want = (gab.effects || []).reduce((k, e) => k + ((e.targets || []).length), 0);
        const targets = (opts.targets || []).length === want ? opts.targets : [];
        return this.activateAbility(playerId, objId, chk0.ability, Object.assign({}, opts, { via: null, targets }));
      }
      const chk = this.canCast(playerId, objId, opts.via || opts.alternative);
      if (!chk.ok) return this.fail(chk.reason);
      const p = this.player(playerId);
      const o = this.obj(objId);
      const a = o.analysis();
      /* Two things decided while casting need an answer before anything is
         paid: which of two additional costs to pay, and whether to promise
         a gift, and to whom. A person is asked and the cast starts again
         with the answer; a bot decides on the spot. */
      const asked = this._castChoices(playerId, o, a, opts, chk);
      if (asked) return asked === 'asked' ? true : this.fail(asked);
      const addPick = a && a.additionalCost && a.additionalCost.choice
        ? a.additionalCost.choice[opts.additionalChoice || 0] : null;
      let cost = opts.costOverride != null ? opts.costOverride : chk.cost;
      /* Flashback and its relatives: a printed cost for casting the card
         from somewhere it would not normally be cast from, and a rule
         about where it goes afterwards. */
      let via = null;
      if (opts.via) {
        via = this.altUsesFor(playerId, objId).find(x => x.kind === 'cast' && x.via === opts.via);
        if (via && (via.via === 'evoke' || via.via === 'dash')) o._via = via.via;
        if (via && via.faceDown) o.faceDown = true;      // it goes on the stack face down
        if (via && via.via === 'bestow') o._bestowing = true;
        if (via && via.via === 'warp') o._via = 'warp';
        // remembered until it has entered: time counters, or the smaller body
        if (via && via.via === 'impending') o._impendingN = (a.impending || {}).n || 0;
        if (via && via.via === 'prototype') o.prototyped = true;
        if (!via) return this.fail('That card cannot be cast that way from here.');
        if (opts.costOverride == null) cost = via.cost;
        /* Harmonize: tap a creature you control to take its power off the
           generic part, when the mana alone will not do. */
        if (via.harmonize && opts.costOverride == null) {
          const need = opts.x ? String(cost).replace(/\{X\}/g, '{' + opts.x + '}') : cost;
          if (!this.couldPay(playerId, need, this.manaSources(playerId))) {
            const helper = this.battlefield.filter(x => x.controller === playerId && !x.tapped && !x.phasedOut && this.characteristics(x).isCreature)
              .sort((x, y) => this.powerOf(y) - this.powerOf(x))[0];
            if (helper && this.powerOf(helper) > 0) {
              cost = this._addGeneric(need, -this.powerOf(helper));
              opts = Object.assign({}, opts, { x: 0 });
              this._markTapped(helper);
              this.logEvent('rules', `${p.name} taps ${helper.name} to harmonize.`);
            }
          }
        }
      }

      /* Escape asks for cards out of the graveyard as well as mana. */
      let toExile = [];
      if (via && via.exileGrave) {
        const yard = ((this.zones[playerId] || {}).graveyard || []).filter(c => c.id !== o.id);
        if (yard.length < via.exileGrave)
          return this.fail(`Escape needs ${via.exileGrave} other cards in your graveyard.`);
        toExile = yard.slice(0, via.exileGrave);
      }

      /* Retrace and jump-start also ask for a card off the top of your
         hand. The cost has to be paid as the spell is cast, so if the
         caller did not name a card one is chosen for them. */
      let toDiscard = null;
      if (via && via.discard) {
        const hand = (this.zones[playerId] || {}).hand || [];
        const legal = hand.filter(c => {
          if (c.id === o.id) return false;
          if (via.discard !== 'land') return true;
          const ca = c.analysis();
          return !!(ca && ca.isLand);
        });
        if (!legal.length) return this.fail(via.discard === 'land'
          ? 'No land card in hand to discard.' : 'No card in hand to discard.');
        toDiscard = (opts.discardId && legal.find(c => c.id === opts.discardId)) || legal[0];
      }

      /* Optional extra costs, chosen before the spell is cast: the caller
         says how many times to kick, or whether to buy it back, and the
         cost it pays grows to match. */
      const extras = this.extraCostsFor(objId);
      const chose = { kicked: 0, boughtBack: false, entwined: false,
        offspring: false, squad: 0, casualty: null, spree: null };
      for (const ex of extras) {
        if (ex.kind === 'kicker' && opts.kick) { cost += ex.cost; chose.kicked = 1; }
        else if (ex.kind === 'multikicker' && opts.kick) {
          const times = Math.max(1, Math.min(20, parseInt(opts.kick, 10) || 1));
          cost += ex.cost.repeat(times); chose.kicked = times;
        } else if (ex.kind === 'buyback' && opts.buyback) { cost += ex.cost; chose.boughtBack = true; }
        else if (ex.kind === 'entwine' && opts.entwine) { cost += ex.cost; chose.entwined = true; }
        else if (ex.kind === 'offspring' && opts.offspring) { cost += ex.cost; chose.offspring = true; }
        else if (ex.kind === 'squad' && opts.squad) {
          const times = Math.max(1, Math.min(10, parseInt(opts.squad, 10) || 1));
          cost += ex.cost.repeat(times); chose.squad = times;
        } else if (ex.kind === 'spree') {
          /* At least one mode has to be bought (CR 702.171b); with nothing
             chosen the first one is. */
          let picked = (opts.spree || []).map(Number).filter(i => ex.modes[i]);
          if (!picked.length) picked = [0];
          for (const i of picked) cost += ex.modes[i].cost;
          chose.spree = picked;
        } else if (ex.kind === 'casualty' && opts.casualty) {
          /* The sacrifice is part of the cost, so it happens now. The
             smallest creature that is big enough goes. */
          const pool = this.battlefield.filter(x => x.controller === playerId &&
            (x.analysis() || {}).isCreature && this.powerOf(x) >= ex.n);
          if (!pool.length) return this.fail(`No creature with power ${ex.n} or greater to sacrifice.`);
          pool.sort((x, y) => this.powerOf(x) - this.powerOf(y));
          chose.casualty = pool[0];
        }
      }
      /* What the generic questions bought (CR 702.56, 702.47, 702.78):
         copies by replicate, other cards' words by splice, and a copy by
         conspire, whose price is two creatures tapped. */
      const bought = opts.choices || {};
      const repCost = this._replicateCost(a);
      const replicated = repCost && bought.replicate ? Math.max(0, Math.min(20, bought.replicate.number || 0)) : 0;
      if (replicated) cost += repCost.repeat(replicated);
      const spliced = bought.splice && !o.isCopy ? this._spliceable(playerId, o).filter(x => (bought.splice.picks || []).includes(x.obj.id)) : [];
      for (const x of spliced) cost += x.cost;
      let conspired = bought.conspire && !o.isCopy ? (bought.conspire.picks || []).map(id => this.obj(id))
        .filter(x => x && x.zone === 'battlefield' && x.controller === playerId && !x.tapped) : [];
      if (conspired.length !== 2) conspired = [];

      /* A mana price chosen as the additional cost is paid with the rest,
         even for a spell cast without paying its mana cost. */
      if (addPick && addPick.mana) cost = opts.free ? addPick.mana : (cost || '') + addPick.mana;
      this._payFlags = {};
      if (!opts.free || (addPick && addPick.mana)) {
        const paid = this.payMana(playerId, cost, Object.assign({}, opts, { forSpell: o }));
        if (!paid) return this.fail(`Not enough mana for ${o.name} (${cost}).`);
      }
      const payFlags = this._payFlags || {};
      this._payFlags = {};

      for (const c of toExile) this.moveObject(c, 'exile');
      if (toExile.length) {
        this.logEvent('rules', `${p.name} exiles ${toExile.length} card${toExile.length === 1 ? '' : 's'} to escape.`);
      }

      if (chose.casualty) {
        this.moveObject(chose.casualty, 'graveyard');
        this.logEvent('sacrifice', `${chose.casualty.name} is sacrificed for casualty.`);
        this._fire('youSacrifice', playerId, { count: 1 });
      }
      if (conspired.length) {
        for (const x of conspired) this._markTapped(x);
        this.logEvent('rules', `${p.name} taps ${conspired.map(x => x.name).join(' and ')} to conspire.`);
      }
      o._offspring = !!chose.offspring;
      o._squad = chose.squad || 0;
      /* "If this was kicked, it enters with two counters" asks later. */
      o.wasKicked = chose.kicked > 0;
      o.airbent = false;
      o.kickedTimes = chose.kicked || 0;
      // who was promised the gift, if anybody: the permanent remembers it as it enters
      o.giftTo = (a && a.gift && opts.gift) || null;
      // the bargain is paid as the spell is cast
      let bargained = false;
      if (opts.bargain) {
        const b = this.obj(opts.bargain);
        if (b && b.zone === 'battlefield' && b.controller === playerId) {
          this._sacrificeNow(playerId, [b], null);
          bargained = true;
          this.logEvent('rules', `${p.name} bargains ${b.name}.`);
        }
      }
      o.bargainedTurn = bargained ? this.turn : null;

      if (toDiscard) {
        this.moveObject(toDiscard, 'graveyard');
        this.logEvent('discard', `${p.name} discards ${toDiscard.name}.`);
        this._afterDiscard(playerId, toDiscard);
      }

      if (o.zone === 'command') { o.castFromCommandZone = true; p.commanderCasts[o.id] = (p.commanderCasts[o.id] || 0) + 1; }
      const fromZone = o.zone;
      this._removeFromZone(o);
      o.zone = 'stack';
      o.controller = playerId;
      o.chosenX = opts.x || 0;

      const item = {
        id: this._uid('st'), kind: 'spell', obj: o, objId: o.id,
        controller: playerId, name: o.name, cost,
        targets: (opts.targets || []).map(normTarget), x: opts.x || 0,
        effects: a && !a.isPermanent ? (via && via.overload && a.overloadEffects ? a.overloadEffects : this._cardSpellEffects(a)) : null,
        auto: a ? a.autoCoverage >= 0.999 : false,
        fromZone,
        kicked: chose.kicked, boughtBack: chose.boughtBack, entwined: chose.entwined,
        spreeModes: chose.spree, gift: o.giftTo, bargained, castInMain: !!this.isMain && this.activePlayer && this.activePlayer.id === playerId,
        via: via ? via.via : null, viaAfter: via ? via.after : null,
      };
      this.stack.push(item);
      if (o.giftTo) this.logEvent('rules', `${p.name} promises a gift to ${(this.player(o.giftTo) || {}).name}.`);
      // Cavern of Souls: "that spell can't be countered"
      if (payFlags.uncounterable) item.uncounterable = true;
      if (p.nextSpellUncounterable === this.turn) { item.uncounterable = true; p.nextSpellUncounterable = null; }
      for (const rider of (payFlags.riders || [])) this._manaRider(rider, item, playerId);
      // floating mana with a promise attached keeps it for the next spell it pays for
      if (p.manaRiders && p.manaRiders.length && !opts.free) {
        for (const rider of p.manaRiders.splice(0)) this._manaRider(rider, item, playerId);
      }
      if (chk.lifeInstead && !via) this.changeLife(playerId, -chk.lifeInstead, 'cost');
      /* "Spells your opponents cast that target this creature cost an
         additional 3 life to cast." */
      for (const t of item.targets || []) {
        const x = t.kind === 'object' && this.obj(t.id);
        const tax = x && x.zone === 'battlefield' && x.controller !== playerId && this._staticOp(x, 'targetLifeTax');
        if (tax) { this.changeLife(playerId, -(tax.life || 0), 'cost'); this.logEvent('rules', `${p.name} pays ${tax.life} life to target ${x.name}.`); }
      }
      /* An alternative cost may ask for more than mana: a life point and a
         blue card for Force of Will, a Mountain for Fireblast. */
      if (via && via.alt) {
        const alt = via.alt;
        if (alt.life) this.changeLife(playerId, -alt.life, 'cost');
        if (alt.exileFromHand) {
          const pool = this._discardPool(playerId, alt.exileFromHand, o);
          const need = Math.min(pool.length, alt.exileFromHand.n || 1);
          if (p.isBot || pool.length === need) {
            for (const c of this._cheapestFirst(pool).slice(0, need)) this.moveObject(c, 'exile');
          } else if (need) {
            this.queueChoice({ type: 'pickCard', playerId, count: need, purpose: 'exileCost',
              candidates: pool.map(x => x.id), cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
              prompt: `Exile ${need === 1 ? 'a' : need} ${alt.exileFromHand.filter} card${need === 1 ? '' : 's'} from your hand.` });
          }
        }
        this._payThingCosts(playerId, { sacrifice: alt.sacrifice, discard: alt.discard }, o, opts, item);
      }
      /* The rest of the price: life, and anything to be given up. */
      if (a && a.additionalCost && !opts.skipAdditional) {
        const add = addPick || a.additionalCost;
        if (add.life != null) {
          const k = add.life === 'X' ? (opts.x || 0) : add.life;
          if (k) this.changeLife(playerId, -k, 'cost');
        }
        if (add.reveal) {
          const shown = this._discardPool(playerId, add.reveal, o)[0];
          if (shown) this.logEvent('rules', `${p.name} reveals ${shown.name}.`);
        }
        this._payThingCosts(playerId, Object.assign({}, add, { spellExile: true }), o, opts, item);
        if (addPick) this.logEvent('rules', `${p.name} pays the additional cost: ${addPick.label.toLowerCase()}.`);
      }
      if (chose.casualty) {
        const dup = this._register(new GObj(o.card, playerId, 'stack'));
        dup.isCopy = true; dup.chosenX = o.chosenX;
        this.stack.push(Object.assign({}, item, {
          id: this._uid('st'), isCopy: true, obj: dup, objId: dup.id,
          targets: (item.targets || []).slice(),
        }));
        this.logEvent('copy', `Casualty copies ${o.name}.`);
      }
      this.stormCount++;
      this.spellsThisTurn = (this.spellsThisTurn || 0) + 1;   // day/night watches this
      p.spellsCastThisTurn = (p.spellsCastThisTurn || 0) + 1;
      this.logEvent('cast', `${p.name} casts ${o.name}${item.targets.length ? ' targeting ' + item.targets.map(t => this.describeTarget(t)).join(', ') : ''}.`);
      this.emit('sfx', 'cast');
      this.emit('stack:add', item);
      this._fire('anyCastSpell', null, { object: o, stackId: item.id, playerId, mv: MANA.cmc(cost || '') });
      /* "When you cast this spell, …": the spell's own trigger, which goes
         on the stack above it and resolves first. */
      if (a && !item.isCopy) {
        a.abilities.forEach((ab, i) => {
          if (ab.kind !== 'triggered' || ab.event !== 'castSelf') return;
          this.pendingTriggers.push({
            id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: i,
            controller: playerId, name: `${o.name} \u2014 ${truncate(MTG.oracle.abilityLabel(ab), 50)}`,
            effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab), optional: ab.optional,
            triggerData: { event: 'castSelf', stackId: item.id, objectId: o.id },
          });
        });
      }
      /* Spliced cards stay in the hand; only their words travel, and what
         those words point at is chosen as the spell resolves. */
      if (spliced.length && item.effects) {
        for (const x of spliced) item.effects = item.effects.concat(this._ownTargets(this._cardSpellEffects(x.obj.analysis())));
        item.spliced = spliced.map(x => x.obj.name);
        this.logEvent('rules', `${p.name} reveals ${item.spliced.join(', ')} and splices ${spliced.length === 1 ? 'it' : 'them'} onto ${o.name}.`);
      }
      /* Replicate and conspire are "when you cast this spell, copy it"
         triggers, and the copies may be pointed somewhere new. */
      const copyTrigger = (times, what) => this.pendingTriggers.push({
        id: this._uid ? this._uid('tr') : MTG.uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: -1,
        controller: playerId, name: `${o.name} — ${what}`, auto: true,
        effects: [{ op: 'copyThatSpell', n: times }], abilityText: `Copy ${o.name}${times > 1 ? ` ${times} times` : ''} (${what}).`,
        triggerData: { event: 'castSelf', stackId: item.id, objectId: o.id },
      });
      if (replicated) copyTrigger(replicated, 'replicate');
      if (conspired.length) copyTrigger(1, 'conspire');

      // ward on anything this spell targets (CR 702.21)
      this._applyWard(item);
      // prowess and extort care that a spell was cast at all (CR 702.108/702.100)
      this._prowess(item);
      this._extort(item);
      // storm copies, cascade casts the next cheaper card free
      this._storm(item, a);
      this._cascade(item, a);

      /* With full control on you keep priority after casting, so a second
         spell can go on the stack before anybody answers the first. */
      const apCfg = (this.config.autoPass || {})[playerId];
      if (opts.hold || (apCfg && apCfg.fullControl)) this.holdFor = playerId;

      const castData = { spell: item, object: o, stackId: item.id, playerId };
      this._fire('youCastSpell', playerId, castData);
      if (p.spellsCastThisTurn === 1) this._fire('firstSpellEachTurn', playerId, castData);
      if (p.spellsCastThisTurn === 2) this._fire('anySecondSpell', null, castData);
      if (p.spellsCastThisTurn === 2) this._fire('opponentSecondSpell', null, Object.assign({ except: playerId }, castData));
      (p.spellObjsThisTurn = p.spellObjsThisTurn || []).push(o);
      this._fire('opponentFirstSpell', null, Object.assign({ except: playerId, caster: p }, castData));
      /* "Whenever this creature becomes the target of a spell": each
         permanent the spell points at is told. */
      for (const t of item.targets || []) {
        const x = t.kind === 'object' && this.obj(t.id);
        if (x && x.zone === 'battlefield') this._fire('becomesTarget', x.controller, { source: x, object: x, bySpell: true, playerId });
      }
      this._fire('opponentCastSpell', null, Object.assign({ except: playerId }, castData));
      this._crimeCheck(playerId, item.targets);
      this._resetPriority();
      return true;
    }

    /** "Whenever you commit a crime": a target that is an opponent, or theirs (CR 700.13). */
    _crimeCheck(playerId, targets) {
      const crime = (targets || []).some(t => {
        if (!t) return false;
        if (t.kind === 'player') return t.id !== playerId;
        if (t.kind === 'stack') { const st = this.stack.find(x => x.id === t.id); return !!st && st.controller !== playerId; }
        const o = this.obj(t.id);
        if (!o) return false;
        return o.zone === 'battlefield' ? o.controller !== playerId : (o.zone === 'graveyard' && o.owner !== playerId);
      });
      if (crime) this._fire('youCommitCrime', playerId, { playerId });
    }

    /* ============================================================
       Keyword machinery
       Each of these implements a printed keyword the rules engine now runs
       itself, rather than handing the text to the players.
       ============================================================ */

    /** Count how many times a permanent has a keyword (Exalted stacks). */
    _kwCount(o, kw) {
      const a = o.analysis();
      if (!a) return 0;
      return a.keywords.filter(k => k.keyword.toLowerCase() === kw).length || (a.keywordSet.has(kw) ? 1 : 0);
    }
    _kwArg(o, kw) {
      const a = o.analysis();
      if (!a) return 0;
      const k = a.keywords.find(x => x.keyword.toLowerCase() === kw);
      return k && k.arg ? (parseInt(k.arg, 10) || 0) : 0;
    }

    /** Every ward price a permanent has: printed, or handed to it ("has ward {2}"). */
    _wardCosts(o) {
      const out = [];
      const a = o.analysis();
      for (const k of ((a && a.keywords) || [])) if (k.keyword === 'Ward' && k.arg) out.push(k.arg);
      const c = this.characteristics(o);
      for (const k of (c ? c.keywords : [])) {
        const m = String(k).match(/^ward\s*(?:\u2014|-)?\s*(\S.*)$/i);
        if (m) out.push(m[1]);
      }
      return out;
    }

    /** Ward: the opponent must pay or the spell is countered (CR 702.21b). */
    _applyWard(item) {
      for (const t of (item.targets || [])) {
        if (t.kind !== 'object') continue;
        const o = this.obj(t.id);
        if (!o || o.zone !== 'battlefield' || o.controller === item.controller) continue;
        for (const arg of this._wardCosts(o)) {
        if (item.countered) break;
        const mana = (arg.match(/\{[^}]+\}/g) || []).join('');
        const life = (arg.match(/pay (\d+) life/i) || [])[1];
        const caster = this.player(item.controller);
        if (mana) {
          if (this.payMana(item.controller, mana, { auto: true })) {
            this.logEvent('ward', `${caster.name} pays ${o.name}'s ward cost.`);
          } else {
            item.countered = true;
            this.logEvent('ward', `${item.name} is countered by ${o.name}'s ward \u2014 ${caster.name} could not pay ${mana}.`);
          }
        } else if (life) {
          this.changeLife(item.controller, -parseInt(life, 10), 'ward');
          this.logEvent('ward', `${caster.name} pays ${life} life for ${o.name}'s ward.`);
        }
        }
      }
    }

    /** Prowess: +1/+1 until end of turn for each noncreature spell (CR 702.108). */
    _prowess(item) {
      const a = item.obj && item.obj.analysis();
      if (a && a.isCreature) return;
      for (const o of this.battlefield) {
        if (o.controller !== item.controller) continue;
        const oa = o.analysis();
        if (!oa || !oa.keywordSet.has('prowess')) continue;
        const n = this._kwCount(o, 'prowess');
        for (let i = 0; i < n; i++) o.effects.push({ p: 1, t: 1, until: 'eot' });
        this.logEvent('keyword', `${o.name} gets +${n}/+${n} from prowess.`);
      }
    }

    /** Extort: drain 1 per extort instance if the controller can pay (CR 702.100). */
    _extort(item) {
      const me = this.player(item.controller);
      for (const o of this.battlefield) {
        if (o.controller !== item.controller) continue;
        const oa = o.analysis();
        if (!oa || !oa.keywordSet.has('extort')) continue;
        if (!this.payMana(item.controller, '{W/B}', { auto: true })) continue;
        let drained = 0;
        for (const opp of this.opponentsOf(item.controller)) { this.changeLife(opp, -1, 'extort'); drained++; }
        if (drained) this.changeLife(me, drained, 'extort');
        this.logEvent('keyword', `${o.name} extorts for ${drained}.`);
      }
    }

    /** Storm: copy the spell once per spell cast before it this turn (CR 702.40). */
    _storm(item, a) {
      if (!a || !a.keywordSet.has('storm')) return;
      const copies = Math.max(0, this.stormCount - 1);
      if (!copies) return;
      /* Each copy is its own object (CR 707.10), not the card: the card
         goes to the graveyard when the spell itself resolves, and a copy
         that resolves first must not take it along. */
      for (let i = 0; i < copies; i++) {
        const copy = this._copyOnStack(item, item.controller);
        copy.name = item.name + ' (storm copy)';
      }
      this.logEvent('keyword', `Storm puts ${copies} more ${copies === 1 ? 'copy' : 'copies'} of ${item.name} on the stack.`);
    }

    /**
     * A creature with a card encoded on it has dealt combat damage to a
     * player: for each such card, its controller may cast a copy of it
     * (CR 702.99a). The encoding lasts as long as the creature stays.
     */
    _cipherHits(src) {
      for (const id of (src.encoded || [])) {
        const card = this.obj(id);
        if (!card || card.zone !== 'exile' || card.encodedOn !== src.id) continue;
        this.pendingTriggers.push({
          id: this._uid ? this._uid('tr') : MTG.uid('tr'), kind: 'ability', obj: src, objId: src.id, abilityIndex: -1,
          controller: src.controller, name: `${src.name} — cipher (${card.name})`, auto: true, optional: true,
          effects: [{ op: 'castEncoded', cardId: card.id }], abilityText: `Cast a copy of ${card.name} without paying its mana cost`,
          triggerData: { event: 'cipher', objectId: src.id },
        });
      }
    }

    /** Cascade: exile until a cheaper nonland card, then cast it free (CR 702.85). */
    _cascade(item, a) {
      if (!a || !a.keywordSet.has('cascade')) return;
      const pid = item.controller;
      const lib = this.zones[pid].library;
      const mv = a.mv || 0;
      const exiled = [];
      let hit = null;
      while (lib.length) {
        const c = lib.shift();
        const ca = c.analysis();
        if (ca && !ca.isLand && (c.card.cmc || 0) < mv) { hit = c; break; }
        exiled.push(c);
      }
      for (const c of exiled) { c.zone = 'exile'; this.zones[pid].exile.push(c); }
      if (!hit) { this.logEvent('keyword', 'Cascade found nothing cheaper.'); return; }
      this.logEvent('keyword', `Cascade hits ${hit.name} \u2014 casting it for free.`);
      hit.zone = 'exile';
      this.zones[pid].exile.push(hit);
      // cascade is itself the permission to cast from exile
      this.castSpell(pid, hit.id, { free: true, targets: [], costOverride: '', alternative: 'cascade' });
    }

    /** Everything the attack declaration triggers (CR 508.1). */
    _attackKeywords(attackers) {
      if (!attackers.length) return;
      const pid = this.activePlayer.id;
      const defenders = new Set(attackers.map(o => {
        const d = o.attacking;
        return this.player(d) ? d : (this.obj(d) ? this.obj(d).controller : null);
      }).filter(Boolean));

      // exalted only applies when exactly one creature attacked
      if (attackers.length === 1) {
        let n = 0;
        for (const o of this.battlefield) if (o.controller === pid) n += this._kwCount(o, 'exalted');
        if (n) {
          attackers[0].effects.push({ p: n, t: n, until: 'eot' });
          this.logEvent('keyword', `${attackers[0].name} gets +${n}/+${n} from exalted.`);
        }
      }
      for (const o of attackers) {
        const a = o.analysis();
        if (!a) continue;
        // battle cry pumps the *other* attackers
        const bc = this._kwCount(o, 'battle cry');
        if (bc) {
          for (const x of attackers) if (x !== o) x.effects.push({ p: bc, t: 0, until: 'eot' });
          this.logEvent('keyword', `${o.name}'s battle cry pumps the rest of the team.`);
        }
        /* dethrone (CR 702.105): attacking the player with the most life,
           or tied for it, puts a +1/+1 counter on it */
        if (a.keywordSet.has('dethrone')) {
          const def = this.player(o.attacking);
          const most = Math.max(...this.players.filter(p => !p.hasLost).map(p => p.life));
          if (def && def.life >= most) {
            this.addCounters(o, '+1/+1', 1);
            this.logEvent('keyword', `${o.name} gets a +1/+1 counter from dethrone.`);
          }
        }
        // melee: +1/+1 per opponent you attacked
        if (a.keywordSet.has('melee') && defenders.size) {
          o.effects.push({ p: defenders.size, t: defenders.size, until: 'eot' });
          this.logEvent('keyword', `${o.name} gets +${defenders.size}/+${defenders.size} from melee.`);
        }
        // mentor: a +1/+1 counter on a weaker attacker
        if (a.keywordSet.has('mentor')) {
          const power = this.powerOf(o);
          const pupils = attackers.filter(x => x !== o && this.powerOf(x) < power);
          if (pupils.length) {
            pupils.sort((x, y) => this.powerOf(y) - this.powerOf(x));
            this.addCounters(pupils[0], '+1/+1', 1);
            this.logEvent('keyword', `${o.name} mentors ${pupils[0].name}.`);
          }
        }
        // training: a counter when attacking alongside something bigger
        if (a.keywordSet.has('training')) {
          const power = this.powerOf(o);
          if (attackers.some(x => x !== o && this.powerOf(x) > power)) {
            this.addCounters(o, '+1/+1', 1);
            this.logEvent('keyword', `${o.name} trains.`);
          }
        }
        /* The Ring, level 2: the Ring-bearer's attack rummages. */
        if (this._isRingBearer(o) && (this.player(o.controller) || {}).ringLevel >= 2) {
          const owner = this.player(o.controller);
          this._drawCards(owner, 1);
          this.queueChoice({
            type: 'discard', playerId: owner.id, count: 1,
            prompt: 'The Ring: discard a card.',
          });
          this.logEvent('rules', `${o.name} carries the Ring: draw, then discard.`);
        }
        /* Mobilize N (CR 702.170): Warriors come along for the ride and
           are gone once combat is over. */
        const mob = this._kwArg(o, 'mobilize');
        if (mob) {
          this._createToken(o.controller, { n: mob, pt: '1/1', subtypes: 'Warrior',
            colorWords: ['red'], keywords: [], tapped: true, attacking: true, temporary: 'combat' });
          this.logEvent('keyword', `${o.name} mobilizes ${mob}.`);
        }
        /* Firebending N: red mana for the attack, and it stays through
           combat rather than draining away between steps. */
        const fire = this._kwArg(o, 'firebending');
        if (fire) {
          const p = this.player(o.controller);
          if (p) { for (let i = 0; i < fire; i++) p.pool.add('R'); p.poolKeepUntil = 'combat'; }
          this.logEvent('keyword', `${o.name} firebends for ${fire} red mana.`);
        }
        // annihilator: the defending player sacrifices permanents
        const ann = this._kwArg(o, 'annihilator');
        if (ann) {
          const d = o.attacking;
          const dpid = this.player(d) ? d : (this.obj(d) ? this.obj(d).controller : null);
          if (dpid) {
            this.queueChoice({
              type: 'sacrifice', playerId: dpid, count: ann, filter: 'permanent',
              prompt: `${o.name} has annihilator ${ann} \u2014 sacrifice ${ann} permanent${ann === 1 ? '' : 's'}.`,
            });
          }
        }
      }
      this._fire('youAttack', pid, { attackers });
      this._fire('yourCreatureAttacks', pid, { attackers });
      /* "Whenever a creature you control attacks alone" (exalted's cousins):
         the only creature declared as an attacker this combat */
      if (attackers.length === 1 && attackers[0]) {
        const at = attackers[0], d = at.attacking;
        this._fire('attacksAlone', null, { object: at, objController: at.controller, attacker: at, source: at,
          player: this.player(d) ? d : (this.obj(d) || {}).controller });
      }
    }

    /** Afflict fires when a creature becomes blocked (CR 702.131). */
    _blockKeywords(declarations) {
      for (const d of declarations) {
        for (const aid of d.attackerIds) {
          const at = this.obj(aid);
          if (!at) continue;
          /* Flanking (CR 702.25): a blocker without it shrinks. */
          const bl = this.obj(d.blockerId);
          if (bl && this.hasKw(at, 'flanking') && !this.hasKw(bl, 'flanking')) {
            bl.effects.push({ p: -1, t: -1, until: 'eot' }); bl._chr = null;
            this.logEvent('keyword', `${bl.name} gets -1/-1 from flanking.`);
          }
          if (at._blockedFired !== this.turn) {
            at._blockedFired = this.turn;
            if (!this._kwArg(at, 'afflict')) this._fire('becomesBlocked', at.controller, { source: at, object: at });
          }
          if (at._afflicted) continue;
          const n = this._kwArg(at, 'afflict');
          if (!n) continue;
          at._afflicted = true;
          const def = at.attacking;
          const dpid = this.player(def) ? def : (this.obj(def) ? this.obj(def).controller : null);
          if (dpid) {
            this.changeLife(dpid, -n, 'afflict');
            this.logEvent('keyword', `${at.name} afflicts ${this.player(dpid).name} for ${n}.`);
          }
          this._fire('becomesBlocked', at.controller, { source: at, object: at });
        }
      }
    }

    /** Replacement effects and triggers for a permanent entering (CR 614). */
    _onEnter(o) {
      const a = o.analysis();
      if (!a) return;
      /* "…enters tapped unless you control two or fewer other lands", and the
         Karoo-style "unless you control a Swamp". These are decided as the
         permanent enters, so they are read here rather than waiting for a
         trigger that never comes. */
      for (const ab of a.abilities) {
        for (const ef of (ab.effects || [])) {
          if (ef.op !== 'etbTappedUnlessLands' && ef.op !== 'etbTappedUnlessType' &&
              ef.op !== 'etbTappedUnlessPay' && ef.op !== 'etbTappedUnlessLife' &&
              ef.op !== 'etbTappedUnlessOpponents' && ef.op !== 'etbTappedUnlessReveal' &&
              ef.op !== 'etbAsCopy' && ef.op !== 'etbTappedUnlessCond' && ef.op !== 'moxDiamond') continue;
          // a land told to enter untapped is not asked whether it enters tapped
          if (o._keepUntapped && /^etbTapped/.test(ef.op)) continue;
          this._runEffect(ef, { controller: o.controller, obj: o, name: o.name });
        }
      }
      // "Start your engines!": a player with no speed starts at 1
      if (a.keywordSet && a.keywordSet.has('start your engines!')) {
        const cp = this.player(o.controller);
        if (cp && !cp.speed) { cp.speed = 1; this.logEvent('rules', `${cp.name} starts their engines: speed 1.`); }
      }
      // Unleash: a +1/+1 counter as it enters, if its controller wants one
      if (this._staticOp(o, 'unleash')) {
        const cp = this.player(o.controller);
        if (cp && cp.isBot) this.addCounters(o, '+1/+1', 1, { noReplace: true });
        else if (cp) this.queueChoice({ type: 'confirm', playerId: cp.id, purpose: 'unleash', objId: o.id,
          sourceId: o.id, sourceName: o.name, sourceCard: o.card,
          prompt: `Unleash ${o.name}? It enters with a +1/+1 counter, and can't block while it has one.` });
      }
      this._exploitOnEnter(o);
      /* "As this enters, choose a creature type / a color": decided on the
         way in. The most likely answer is filled in at once, so the
         permanent is never without one, and a person is asked to confirm. */
      if (this._staticOp(o, 'chooseTypeOnEnter')) this._chooseTypeFor(o);
      if (this._staticOp(o, 'chooseColorOnEnter')) this._chooseColorFor(o);
      if (a.entersWithCounters && !(a.entersWithCounters.ifKicked && !o.wasKicked) &&
          !(a.entersWithCounters.cond && !this._condMet(a.entersWithCounters.cond, { controller: o.controller, obj: o }))) {
        // "enters with X +1/+1 counters" resolves against the X actually paid
        const raw = a.entersWithCounters.n;
        const n = (raw === 'X') ? (o.chosenX || 0) : (raw === 'kicked') ? (o.kickedTimes || 0)
          : (raw && typeof raw === 'object' && raw.per) ? this.countPermanents(o.controller, { per: raw.per })
          : (parseInt(raw, 10) || 0);
        if (n > 0) {
          const kind = a.entersWithCounters.kind;
          o.counters[kind] = (Number(o.counters[kind]) || 0) + n;
          // entering with counters is having them put on it (CR 122.6)
          this._fire('countersPut', null, { object: o, source: o, objController: o.controller, kind, amount: n });
        }
      }
      // riot: haste or a +1/+1 counter
      if (a.keywordSet.has('riot')) {
        const p = this.player(o.controller);
        if (p && p.isBot) { this.addCounters(o, '+1/+1', 1); }
        else this.queueChoice({
          type: 'riot', playerId: o.controller, objId: o.id,
          prompt: `${o.name} has riot \u2014 haste, or a +1/+1 counter?`,
        });
      }
      /* Offspring and squad both make copies of the creature as it lands;
         an offspring copy comes in as a 1/1. */
      if (o._offspring || o._squad) {
        const copies = (o._offspring ? 1 : 0) + (o._squad || 0);
        const small = !!o._offspring && !o._squad;
        o._offspring = false; o._squad = 0;
        for (let i = 0; i < copies; i++) {
          const copy = this._register(new GObj(o.card, o.controller, 'battlefield'));
          copy.isToken = true; copy.zone = 'battlefield';
          copy.entered = this.turn; copy.summoningSick = true; copy.face = o.face || 0;
          if (small) copy.effects.push({ setPt: { p: 1, t: 1 }, until: null });
          copy.ts = this._stampNew();      // its timestamp (CR 613.7d)
          this.battlefield.push(copy);
          this.bumpBoard();
          this._fireEnters(copy);
        }
        this.logEvent('token', `${o.name} brings ${copies} copy${copies === 1 ? '' : 'ies'} along.`);
      }

      /* Fabricate N (CR 702.122): counters on the creature, or that many
         Servos instead. The choice is the controller's. */
      const fab = this._kwArg(o, 'fabricate');
      if (fab) {
        this.pendingTriggers.push({
          id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, controller: o.controller,
          name: `${o.name} \u2014 fabricate ${fab}`, auto: true, abilityText: 'Fabricate ' + fab,
          effects: [{ op: 'modal', count: 1, modes: [
            { label: `Put ${fab} +1/+1 counter${fab === 1 ? '' : 's'} on it`,
              effects: [{ op: 'counters', kind: '+1/+1', n: fab, scope: 'self' }], auto: true },
            { label: `Create ${fab} 1/1 Servo token${fab === 1 ? '' : 's'}`,
              effects: [{ op: 'createToken', n: fab, pt: '1/1', subtypes: 'Servo',
                colorWords: ['colorless'], keywords: [] }], auto: true },
          ] }],
        });
        this.emit('sfx', 'trigger');
      }
      // evolve: your other creatures grow when something bigger arrives
      if (a.isCreature) {
        for (const x of this.battlefield) {
          if (x === o || x.controller !== o.controller) continue;
          const xa = x.analysis();
          if (!xa || !xa.keywordSet.has('evolve')) continue;
          if (this.powerOf(o) > this.powerOf(x) || this.toughnessOf(o) > this.toughnessOf(x)) {
            this.addCounters(x, '+1/+1', 1);
            this.logEvent('keyword', `${x.name} evolves.`);
          }
        }
      }
    }

    /** The creature types this player's cards care about most, commonest first. */
    _typesByCount(pid) {
      const counts = new Map();
      const z = this.zones[pid] || {};
      const cards = [].concat(z.library || [], z.hand || [], z.command || [], z.graveyard || [],
        this.battlefield.filter(x => x.controller === pid));
      for (const c of cards) {
        const a = c.analysis();
        if (!a || !(a.isCreature || (a.types || []).includes('Kindred') || (a.types || []).includes('Tribal'))) continue;
        for (const t of (a.subtypes || [])) counts.set(t, (counts.get(t) || 0) + 1);
      }
      return Array.from(counts).sort((x, y) => y[1] - x[1]).map(x => x[0]);
    }

    _chooseTypeFor(o) {
      const types = this._typesByCount(o.controller);
      const pick = types[0] || 'Human';
      o.chosenType = pick;
      this.bumpBoard();
      const p = this.player(o.controller);
      this.logEvent('rules', `${o.name}: ${pick} is the chosen creature type.`);
      if (p && !p.isBot && types.length > 1) {
        const options = types.slice(0, 12).map((t, i) => ({ i, label: t }));
        this.queueChoice({ type: 'mode', playerId: p.id, count: 1, purpose: 'chooseType', objId: o.id,
          types: types.slice(0, 12), options, prompt: `${o.name}: choose a creature type.` });
      }
    }

    _chooseColorFor(o) {
      const p = this.player(o.controller);
      // "choose a color other than blue"
      const rule = this._staticOp(o, 'chooseColorOnEnter');
      const except = rule && rule.except;
      let pick = p ? this._preferredColor(p, except) : 'W';
      if (pick === except) pick = ['W', 'U', 'B', 'R', 'G'].find(c => c !== except);
      o.chosenColor = pick;
      this.bumpBoard();
      if (p && !p.isBot) {
        const COLS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green']].filter(c => c[0] !== except);
        this.queueChoice({ type: 'mode', playerId: p.id, count: 1, purpose: 'chooseColor', objId: o.id,
          colors: COLS.map(c => c[0]), options: COLS.map((c, i) => ({ i, label: c[1] })),
          prompt: `${o.name}: choose a colour.` });
      }
    }

    /** Undying, persist and modular, applied as the creature dies (CR 702.92/702.79). */
    _onDeath(o, gyObj) {
      const a = o.analysis();
      if (!a) return;
      const hadPlus = (o._diedCounters && o._diedCounters['+1/+1']) || 0;
      const hadMinus = (o._diedCounters && o._diedCounters['-1/-1']) || 0;
      const undying = a.keywordSet.has('undying') && hadPlus === 0;
      const persist = a.keywordSet.has('persist') && hadMinus === 0;
      if (undying || persist) {
        this.pendingTriggers.push({
          id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, controller: o.controller,
          name: `${o.name} \u2014 ${undying ? 'undying' : 'persist'}`,
          auto: true, abilityText: undying ? 'Undying' : 'Persist',
          effects: [{ op: 'returnFromGrave', counter: undying ? '+1/+1' : '-1/-1', objId: o.id }],
        });
        this.emit('sfx', 'trigger');
      }
      /* Afterlife N (CR 702.135): a Spirit or two flies off when it dies. */
      const after = this._kwArg(o, 'afterlife');
      if (after) {
        this.pendingTriggers.push({
          id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, controller: o.controller,
          name: `${o.name} \u2014 afterlife ${after}`, auto: true, abilityText: 'Afterlife ' + after,
          effects: [{ op: 'createToken', n: after, pt: '1/1', subtypes: 'Spirit',
            colorWords: ['white', 'black'], keywords: ['Flying'] }],
        });
        this.emit('sfx', 'trigger');
      }
      const mod = this._kwArg(o, 'modular');
      if (mod || (a.keywordSet.has('modular') && hadPlus)) {
        const target = this.battlefield.find(x => {
          const xa = x.analysis();
          return x.controller === o.controller && xa && xa.isCreature && xa.isArtifact;
        });
        if (target && hadPlus) {
          this.addCounters(target, '+1/+1', hadPlus);
          this.logEvent('keyword', `Modular moves ${hadPlus} counters to ${target.name}.`);
        }
      }
    }

    /* ---------- abilities ---------- */

    activateAbility(playerId, objId, abilityIndex, opts) {
      opts = opts || {};
      // the same guard for abilities used over and over without the game moving on
      if (this._loopTick('activate', 5000)) return this.fail('That has been done too many times this step.');
      const o = this.obj(objId);
      if (!o) return this.fail('No such permanent.');
      const a = o.analysis();
      if (!a) return this.fail('Unknown card.');
      const all = a.manaAbilities.concat(a.abilities.filter(x => x.kind === 'activated' || x.kind === 'loyalty'));
      const ab = all[abilityIndex];
      if (!ab) return this.fail('No such ability.');
      /* An ability printed to work from the graveyard works from there and
         nowhere else; the rest only work on the battlefield. */
      if (ab.fromGraveyard) {
        if (o.zone !== 'graveyard' || o.owner !== playerId) return this.fail('That ability only works from your graveyard.');
      } else if (o.zone === 'graveyard') return this.fail('That ability does not work from the graveyard.');
      // "Any player may activate this ability" means exactly that
      if (o.controller !== playerId && !ab.anyPlayer) return this.fail('You do not control that.');
      const why = this._activationBlocked(o, ab, playerId);
      if (why) return this.fail(why);
      /* "Another target creature" cannot be the creature whose ability it is. */
      const aimed = this._specsOf({ effects: ab.effects });
      if ((opts.targets || []).some((t, i) => aimed[i] && aimed[i].another && t && t.id === o.id))
        return this.fail('That needs another target, not this one.');
      const ca = a.isArtifact || a.isCreature || a.isEnchantment;
      const hush = ca ? this._castBlocked(playerId, true) : null;
      if (hush) return this.fail(hush);

      const isMana = ab.kind === 'mana';
      if (!isMana && this._splitSecond())
        return this.fail('A spell with split second is on the stack.');
      if (!isMana && (!this.priorityPlayer || this.priorityPlayer.id !== playerId))
        return this.fail('You do not have priority.');
      if (ab.sorcerySpeed || ab.kind === 'loyalty') {
        if (this.activePlayer.id !== playerId || !this.isMain || !this.stackEmpty)
          return this.fail('That ability is sorcery speed only.');
        if (ab.kind === 'loyalty' && o.activatedLoyaltyThisTurn) return this.fail('One loyalty ability per turn.');
      }

      const payOk = this._payAbilityCost(playerId, o, ab, opts);
      if (!payOk) return false;
      const used = ab.cost && ab.cost.label;
      if (used === 'boast') { o._boastUses = (o._boastTurn === this.turn ? (o._boastUses || 0) : 0) + 1; o._boastTurn = this.turn; }
      if (used === 'exhaust' || used === 'power-up') { o._exhausted = o._exhausted || {}; o._exhausted[ab.text] = o.entered; }
      if (ab.only && ab.only.once) { o._usedOnce = o._usedOnce || {}; o._usedOnce[ab.text] = o.entered; }

      if (ab.kind === 'loyalty') {
        o.activatedLoyaltyThisTurn = true;
        const delta = ab.cost.loyalty;
        this.addCounters(o, 'loyalty', delta);
      }

      if (isMana) {
        // mana abilities do not use the stack (CR 605.3a)
        this._runManaAbility(playerId, o, ab, { controller: playerId, obj: o, name: o.name + ' mana', manaChoice: opts.manaChoice });
        this._payThingCosts(playerId, ab.cost, o, opts, null);
        this.emit('sfx', 'mana');
        this.touch();
        return true;
      }

      const item = {
        id: this._uid('st'), kind: 'ability', obj: o, objId: o.id, abilityIndex,
        controller: playerId, name: `${o.name} — ${truncate(MTG.oracle.abilityLabel(ab), 60)}`,
        targets: (opts.targets || []).map(normTarget),
        effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab),
        x: opts.x || 0,
      };
      this.stack.push(item);
      this._payThingCosts(playerId, ab.cost, o, opts, item);
      for (const t of item.targets || []) {
        const x = t.kind === 'object' && this.obj(t.id);
        if (x && x.zone === 'battlefield') this._fire('becomesTarget', x.controller, { source: x, object: x, byAbility: true, playerId });
      }
      this.logEvent('ability', `${this.player(playerId).name} activates ${o.name}: ${truncate(MTG.oracle.abilityLabel(ab), 80)}`);
      this._crimeCheck(playerId, item.targets);
      this.emit('sfx', 'cast');
      this.emit('stack:add', item);
      this._resetPriority();
      return true;
    }

    /**
     * "Activate only during your turn, before attackers are declared" and
     * "Activate only if you control a Mountain": restrictions printed under
     * an ability, which the table has to keep rather than just read.
     */
    _activationBlocked(o, ab, playerId) {
      /* Boast (CR 702.142): only once the creature has attacked this turn,
         and once each turn (twice with Birgi). Exhaust (CR 702.177): once,
         ever, for this permanent. */
      const label = ab && ab.cost && ab.cost.label;
      if (label === 'boast') {
        if (o.attackedTurn !== this.turn) return 'It can boast only after attacking this turn.';
        const used = o._boastTurn === this.turn ? (o._boastUses || 0) : 0;
        const most = this.activePlayer && this.activePlayer.id === playerId && this._anyStaticOf(playerId, 'boastTwice') ? 2 : 1;
        if (used >= most) return 'It has already boasted this turn.';
      }
      if (label === 'exhaust' && o._exhausted && o._exhausted[ab.text] === o.entered) return 'That exhaust ability has been used.';
      // power-up: once, as exhaust is
      if (label === 'power-up' && o._exhausted && o._exhausted[ab.text] === o.entered) return 'That power-up ability has been used.';
      if (ab && ab.only && ab.only.once && o._usedOnce && o._usedOnce[ab.text] === o.entered) return 'That ability can be activated only once.';
      /* A level band hands out its ability only while the creature is at
         that level (CR 711.6). */
      if (ab && ab.levelCond && !this._condMet(ab.levelCond, { controller: playerId, obj: o })) {
        return 'That ability is not on this level yet.';
      }
      const only = ab && ab.only;
      if (!only) return null;
      if (only.when === 'beforeAttackers') {
        const mine = this.activePlayer && this.activePlayer.id === playerId;
        const order = this.phase.steps;
        const before = this.phase.id !== 'combat' ? this.phaseIndex < 2
          : order.indexOf(this.step) < order.indexOf('declareAttackers');
        if (!mine || !before) return 'Only during your turn, before attackers are declared.';
      }
      if (only.when === 'upkeep' && this.step !== 'upkeep') return 'Only during upkeep.';
      if (only.when === 'endstep' && this.step !== 'end') return 'Only during the end step.';
      if (only.when === 'mainphase' && !this.isMain) return 'Only during a main phase.';
      if (only.cond && !this._condMet(only.cond, { controller: playerId, obj: o })) {
        return 'The condition on that ability is not met.';
      }
      return null;
    }

    /* ---------- costs paid in cards rather than mana ----------
       "Sacrifice a creature", "Discard a card", "Exile two cards from your
       graveyard". A bot pays with whatever it values least, and so does
       anybody holding exactly as many as the cost asks for. Somebody with a
       real choice is asked straight away, before anybody else can act, which
       is when a cost is paid (CR 601.2h, 602.2b). Nothing is ever free:
       a cost that cannot be paid stops the spell or ability before it
       starts. */

    /** What this player could sacrifice to "Sacrifice a creature" and its relatives. */
    _sacrificePool(pid, spec, self) {
      const filter = String((spec && spec.filter) || 'permanent').replace(/^(?:another|other)\s+/i, '');
      return this.battlefield.filter(x => x.controller === pid && !x.phasedOut &&
        !(spec && spec.another && self && x.id === self.id) &&
        (/^(?:permanent|permanents)$/i.test(filter) || this._cardFitsWords(x, filter)));
    }
    /** The cards in hand a discard cost could take. */
    _discardPool(pid, spec, self) {
      const hand = ((this.zones[pid] || {}).hand || []).filter(c => !self || c.id !== self.id);
      const f = String((spec && spec.filter) || 'card');
      return /^(?:card|cards|a card)$/i.test(f) ? hand : hand.filter(c => this._cardFitsWords(c, f));
    }
    /** The cards in a graveyard an exile cost could take. */
    _exileCostPool(pid, spec, self) {
      const yard = ((this.zones[pid] || {}).graveyard || []).filter(c => !self || c.id !== self.id);
      const f = String((spec && spec.filter) || 'card');
      return /^(?:card|cards)$/i.test(f) ? yard : yard.filter(c => this._cardFitsWords(c, f));
    }
    /** The untapped permanents "Tap an untapped creature you control" could tap. */
    /** Crew and saddle: the fewest, least useful creatures that add up to the power wanted. */
    _crewPick(pool, need) {
      const order = this._tapCostOrder(pool);
      const out = [];
      let sum = 0;
      for (const x of order) { if (sum >= need) break; out.push(x); sum += Math.max(0, this.powerOf(x)); }
      return sum >= need ? out : null;
    }
    _tapCostPool(pid, spec, self, selfTaps) {
      const f = String((spec && spec.filter) || 'creature');
      return this.battlefield.filter(x => x.controller === pid && !x.tapped && !x.phasedOut &&
        !(self && x.id === self.id && (spec.another || selfTaps)) &&
        (/^(?:creature|creatures)$/i.test(f) ? this.characteristics(x).isCreature : this._cardFitsWords(x, f)));
    }
    /** Least valuable first: tokens, then the cheapest cards. */
    _cheapestFirst(list) {
      return list.slice().sort((x, y) => (y.isToken ? 1 : 0) - (x.isToken ? 1 : 0) ||
        this._cardValue(x) - this._cardValue(y));
    }
    _costCount(n, opts) {
      if (n === 'X') return Math.max(0, (opts && opts.x) || 0);
      return n == null ? 1 : n;
    }

    /** Why these card costs cannot be paid right now, or null if they can. */
    _thingCostBlocked(pid, cost, self, opts) {
      if (!cost) return null;
      const p = this.player(pid);
      if (cost.sacrifice) {
        const need = this._costCount(cost.sacrifice.n, opts);
        if (this._sacrificePool(pid, cost.sacrifice, self).length < need)
          return `Nothing to sacrifice (${cost.sacrifice.filter || 'permanent'}).`;
      }
      if (cost.discard && cost.discard.n !== 'all') {
        const need = this._costCount(cost.discard.n, opts);
        if (this._discardPool(pid, cost.discard, self).length < need) return 'Not enough cards in hand to discard.';
      }
      if (cost.exile && cost.exile.what === 'graveyard' && cost.exile.n != null && !cost.exile.viaAbility) {
        const need = this._costCount(cost.exile.n, opts);
        if (this._exileCostPool(pid, cost.exile, self).length < need) return 'Not enough cards in your graveyard.';
      }
      if (cost.returnSelf && !(self && self.zone === 'battlefield')) return 'It is not on the battlefield.';
      if (cost.energy && ((this.player(pid) || {}).energy || 0) < cost.energy) return 'Not enough energy.';
      if (cost.returnOwn) {
        const back = this.battlefield.filter(x => x.controller === pid && this._matchesCategory(x, cost.returnOwn.filter) &&
          !(cost.returnOwn.untapped && x.tapped));
        if (back.length < (cost.returnOwn.n || 1)) return `No ${cost.returnOwn.filter} to return.`;
      }
      if (cost.tapCreatures && cost.tapCreatures.totalPower != null) {
        const pool = this._tapCostPool(pid, cost.tapCreatures, self, cost.tap);
        if (pool.reduce((k, x) => k + Math.max(0, this.powerOf(x)), 0) < cost.tapCreatures.totalPower)
          return `Not enough power among your untapped creatures (${cost.tapCreatures.totalPower} needed).`;
      } else if (cost.tapCreatures) {
        const need = this._costCount(cost.tapCreatures.n, opts);
        if (this._tapCostPool(pid, cost.tapCreatures, self, cost.tap).length < need)
          return `Not enough untapped ${cost.tapCreatures.filter}s to tap.`;
      }
      if (cost.life != null && cost.spellLife) {
        const k = cost.life === 'X' ? ((opts && opts.x) || 0) : cost.life;
        if (p && p.life < k) return 'Not enough life.';
      }
      return null;
    }

    /**
     * Pay the card costs: with the cards the caller named, by picking the
     * obvious ones, or by asking. What was given up is noted on the stack
     * item, for "damage equal to the sacrificed creature's power".
     */
    _payThingCosts(pid, cost, self, opts, item) {
      if (!cost) return;
      opts = opts || {};
      // "Return this creature to its owner's hand" as the price
      if (cost.returnSelf && self && self.zone === 'battlefield') this.moveObject(self, 'hand');
      // "Pay {E}{E}"
      if (cost.energy) {
        const pe = this.player(pid);
        if (pe) { pe.energy = Math.max(0, (pe.energy || 0) - cost.energy); this.logEvent('counters', `${pe.name} pays ${cost.energy} energy (${pe.energy} left).`); }
      }
      const p = this.player(pid);
      const auto = !!(p && p.isBot) || !!opts.autoCost;
      const ask = (choice) => this.queueChoice(Object.assign({
        playerId: pid, purpose: 'cost', stackId: item ? item.id : null, sourceId: self ? self.id : null,
      }, choice));
      if (cost.sacrifice) {
        const pool = this._sacrificePool(pid, cost.sacrifice, self);
        const need = Math.min(pool.length, this._costCount(cost.sacrifice.n, opts));
        let pick = (opts.sacrificeIds || []).map(id => pool.find(x => x.id === id)).filter(Boolean).slice(0, need);
        if (need > 0 && pick.length < need) {
          if (auto || pool.length === need) pick = this._cheapestFirst(pool).slice(0, need);
          else {
            pick = null;
            ask({ type: 'sacrifice', count: need, filter: cost.sacrifice.filter || 'permanent',
              candidates: pool.map(x => x.id),
              prompt: `Sacrifice ${need === 1 ? 'a' : need} ${cost.sacrifice.filter || 'permanent'}${need === 1 ? '' : 's'} to pay the cost.` });
          }
        }
        if (pick) this._sacrificeNow(pid, pick, item);
      }
      if (cost.discard) {
        const pool = this._discardPool(pid, cost.discard, self);
        const need = cost.discard.n === 'all' ? pool.length : Math.min(pool.length, this._costCount(cost.discard.n, opts));
        let pick = (opts.discardIds || []).map(id => pool.find(x => x.id === id)).filter(Boolean).slice(0, need);
        if (need > 0 && pick.length < need) {
          if (auto || pool.length === need) pick = this._cheapestFirst(pool).slice(0, need);
          else {
            pick = null;
            ask({ type: 'discard', count: need, candidates: pool.map(x => x.id),
              prompt: `Discard ${need === 1 ? 'a card' : need + ' cards'} to pay the cost.` });
          }
        }
        if (pick) this._discardNow(pid, pick, item);
      }
      if (cost.exile && cost.exile.what === 'graveyard' && cost.exile.n != null && cost.spellExile) {
        const pool = this._exileCostPool(pid, cost.exile, self);
        const need = Math.min(pool.length, this._costCount(cost.exile.n, opts));
        if (need > 0) {
          if (auto || pool.length === need) {
            for (const c of this._cheapestFirst(pool).slice(0, need)) this.moveObject(c, 'exile');
          } else {
            ask({ type: 'pickCard', count: need, purpose: 'exileCost', candidates: pool.map(x => x.id),
              cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
              prompt: `Exile ${need === 1 ? 'a card' : need + ' cards'} from your graveyard to pay the cost.` });
          }
        }
      }
      if (cost.returnOwn) {
        const pool = this.battlefield.filter(x => x.controller === pid && this._matchesCategory(x, cost.returnOwn.filter) &&
          !(cost.returnOwn.untapped && x.tapped));
        const need = Math.min(cost.returnOwn.n || 1, pool.length);
        if (pool.length && (auto || pool.length === need)) for (const x of this._cheapestFirst(pool).slice(0, need)) this.moveObject(x, 'hand');
        else if (pool.length) {
          ask({ type: 'pickCard', count: need, purpose: 'returnCost', worst: true, candidates: pool.map(x => x.id),
            cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
            prompt: `Return ${need === 1 ? 'a ' + cost.returnOwn.filter : need + ' ' + cost.returnOwn.filter + 's'} you control to their owner's hand.` });
        }
      }
      /* Permanents tapped to pay ("Tap an untapped creature you control"):
         named by the caller, the only ones there are, or asked for. A mana
         ability never stops to ask; it takes the ones that matter least. */
      if (cost.tapCreatures && cost.tapCreatures.totalPower != null) {
        /* Crew 3: creatures with total power 3. Named by the caller, or the
           least useful ones that add up; a person with a real choice is asked. */
        const pool = this._tapCostPool(pid, cost.tapCreatures, self, false);
        const want = cost.tapCreatures.totalPower;
        const named = (opts.tapCostIds || []).map(id => pool.find(x => x.id === id)).filter(Boolean);
        const sum = (l) => l.reduce((k, x) => k + Math.max(0, this.powerOf(x)), 0);
        if (named.length && sum(named) >= want) this._tapForCost(pid, named, item);
        else {
          const auto2 = this._crewPick(pool, want);
          if (auto || !item || !auto2 || pool.length === auto2.length) { if (auto2) this._tapForCost(pid, auto2, item); }
          else ask({ type: 'pickCard', count: pool.length, purpose: 'tapCost', totalPower: want, worst: true, candidates: pool.map(x => x.id),
            cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
            prompt: `Tap untapped creatures you control with total power ${want} or more.` });
        }
      } else if (cost.tapCreatures) {
        const pool = this._tapCostPool(pid, cost.tapCreatures, self, false);
        const need = Math.min(pool.length, this._costCount(cost.tapCreatures.n, opts));
        let pick = (opts.tapCostIds || []).map(id => pool.find(x => x.id === id)).filter(Boolean).slice(0, need);
        if (need > 0 && pick.length < need) {
          if (auto || pool.length === need || !item) pick = this._tapCostOrder(pool).slice(0, need);
          else {
            pick = null;
            ask({ type: 'pickCard', count: need, purpose: 'tapCost', worst: true, candidates: pool.map(x => x.id),
              cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
              prompt: `Tap ${need === 1 ? 'an untapped ' + cost.tapCreatures.filter : need + ' untapped ' + cost.tapCreatures.filter + 's'} you control to pay the cost.` });
          }
        }
        if (pick) this._tapForCost(pid, pick, item);
      }
    }

    /** Which permanents to tap for a cost first: the ones that would do least today. */
    _tapCostOrder(pool) {
      const idle = (x) => (this.characteristics(x).isCreature && x.summoningSick && !this.hasKw(x, 'haste')) ? 0 : 1;
      return pool.slice().sort((x, y) => idle(x) - idle(y) || this._cardValue(x) - this._cardValue(y));
    }
    _tapForCost(pid, list, item) {
      const done = [];
      for (const x of list) {
        if (!x || x.zone !== 'battlefield' || x.tapped) continue;
        this._markTapped(x);
        done.push(x.name);
        if (item) (item.tapped = item.tapped || []).push({ id: x.id, name: x.name, power: this.powerOf(x), toughness: this.toughnessOf(x) });
      }
      if (done.length) this.logEvent('rules', `${this.player(pid).name} taps ${done.join(', ')} to pay the cost.`);
    }

    /** Sacrifice these as a cost, remembering what they were. */
    _sacrificeNow(pid, list, item) {
      const snaps = [];
      for (const x of list) {
        if (!x || x.zone !== 'battlefield') continue;
        snaps.push({ id: x.id, name: x.name, power: this.powerOf(x), toughness: this.toughnessOf(x),
          mv: (x.card && x.card.cmc) || 0, types: ((x.analysis() || {}).types || []).slice() });
        this.moveObject(x, 'graveyard');
      }
      if (!snaps.length) return;
      if (item) item.sacrificed = (item.sacrificed || []).concat(snaps);
      this._lastSacrificed = snaps;
      this._sacCount = (this._sacCount || 0) + snaps.length;
      for (const x of list) if (x && x.isToken) this._fire('youSacToken', pid, { object: x });
      this.logEvent('sacrifice', `${this.player(pid).name} sacrifices ${snaps.map(s => s.name).join(', ')}.`);
      // one at a time, so "whenever you sacrifice an artifact" can see what went
      for (const x of list) if (x) this._fire('youSacrifice', pid, { count: 1, object: x, objController: pid });
    }
    /** Discard these as a cost. */
    _discardNow(pid, list, item) {
      const gone = [];
      for (const c of list) {
        if (!c || c.zone !== 'hand') continue;
        gone.push({ id: c.id, name: c.name, mv: (c.card && c.card.cmc) || 0 });
        this.moveObject(c, 'graveyard');
        this._afterDiscard(pid, c);
      }
      if (!gone.length) return;
      if (item) item.discarded = (item.discarded || []).concat(gone);
      this.logEvent('discard', `${this.player(pid).name} discards ${gone.map(s => s.name).join(', ')}.`);
    }

    /**
     * The mana an ability costs right now. Power-up: the permanent's own
     * mana cost comes off it if the permanent entered this turn.
     */
    _abilityMana(o, ab) {
      const c = (ab && ab.cost) || {};
      let mana = c.mana || '';
      if (c.label === 'power-up' && o && o.entered === this.turn && mana) {
        const own = MANA.parse((o.analysis() || {}).manaCost || '');
        const left = MANA.parse(mana);
        let generic = 0;
        const rest = [];
        for (const sym of left) { if (/^\d+$/.test(sym)) generic += +sym; else rest.push(sym); }
        for (const sym of own) {
          if (/^\d+$/.test(sym)) { generic -= +sym; continue; }
          const i = rest.indexOf(sym);
          if (i >= 0) rest.splice(i, 1); else generic -= 1;
        }
        mana = (generic > 0 ? '{' + generic + '}' : '') + rest.map(x => '{' + x + '}').join('');
      }
      return mana;
    }

    _payAbilityCost(playerId, o, ab, opts) {
      const cost = ab.cost || {};
      const thing = this._thingCostBlocked(playerId, cost, o, opts);
      if (thing) return this.fail(thing);
      if (cost.tap) {
        if (o.tapped) return this.fail(`${o.name} is already tapped.`);
        const a = o.analysis();
        if (a && a.isCreature && o.summoningSick && !this.hasKw(o, 'haste'))
          return this.fail(`${o.name} has summoning sickness.`);
      }
      if (cost.untap && o.tapped === false) return this.fail(`${o.name} is not tapped.`);
      const p = this.player(playerId);
      if (cost.life && p.life <= cost.life && this.config.rulesEnforcement === 'full')
        return this.fail('Not enough life.');
      const lifeFrom = cost.lifeFrom === 'commanderColors' ? this._commanderColors(playerId).size : 0;
      if (lifeFrom && p.life < lifeFrom) return this.fail('Not enough life.');
      // `free` skips payment the same way it does for a spell, which is what
      // relaxed tables and alternative costs rely on
      const abMana = this._abilityMana(o, ab);
      if (abMana && !opts.free) {
        /* A permanent that taps as part of the cost cannot also be tapped
           for mana to pay the rest of it (Mind Stone's "{1}, {T}"). */
        const wasTapped = o.tapped;
        if (cost.tap) o.tapped = true;
        const paid = this.payMana(playerId, abMana, Object.assign({}, opts, { forAbility: o }));
        if (cost.tap) o.tapped = wasTapped;
        if (!paid) return this.fail(`Not enough mana (${cost.mana}).`);
      }
      if (cost.tap) { this._markTapped(o); this.emit('sfx', 'tap'); }
      if (cost.exert) o.noUntapNext = true;
      // Devoted Druid: "Put a -1/-1 counter on this creature" as the price
      if (cost.putCounters) this.addCounters(o, cost.putCounters.kind, cost.putCounters.n || 1, { noReplace: true });
      if (cost.untap) o.tapped = false;
      if (cost.life) this.changeLife(playerId, -cost.life, 'cost');
      if (lifeFrom) this.changeLife(playerId, -lifeFrom, 'cost');
      if (cost.sacSelf) {
        const tok = o.isToken;
        this.moveObject(o, 'graveyard');
        // a sacrifice is a sacrifice, whatever paid for it
        this._fire('youSacrifice', playerId, { count: 1, object: o, objController: playerId });
        if (tok) this._fire('youSacToken', playerId, { object: o });
      }
      /* Exile costs the table can pay: the card itself, or cards out of
         the graveyard. */
      if (cost.exile && cost.exile.what) {
        const ex = cost.exile;
        if (ex.what === 'self') this.moveObject(o, 'exile');
        else if (ex.what === 'libraryTop') {
          const top = ((this.zones[playerId] || {}).library || [])[0];
          if (!top) return this.fail('Your library is empty.');
          this.moveObject(top, 'exile');
        } else {
          const yard = ((this.zones[playerId] || {}).graveyard || [])
            .filter(c => c.id !== o.id && (ex.filter === 'card' || this._matchesFilter(c, ex.filter)));
          const want = ex.n || 1;
          if (yard.length < want) return this.fail(`Not enough ${ex.filter === 'card' ? 'cards' : ex.filter + ' cards'} in your graveyard.`);
          for (const c of yard.slice(0, want)) this.moveObject(c, 'exile');
          this.logEvent('rules', `${this.player(playerId).name} exiles ${want} card${want === 1 ? '' : 's'} from their graveyard.`);
        }
      }

      /* "Remove three spore counters from this": a cost paid out of the
         permanent's own counters. */
      if (cost.removeCounters) {
        const kind = String(cost.removeCounters.kind || '').replace(/\s+counters?$/i, '').trim();
        const want = cost.removeCounters.n || 1;
        const have = Number(o.counters[kind]) || 0;
        if (have < want) return this.fail(`${o.name} does not have ${want} ${kind} counter${want === 1 ? '' : 's'}.`);
        o.counters[kind] = have - want;
        this._lastRemovedCounters = want;
        o._chr = null; this.bumpBoard();
        this.logEvent('rules', `${want} ${kind} counter${want === 1 ? '' : 's'} removed from ${o.name}.`);
      }
      return true;
    }

    /* ---------- mana ---------- */

    /** Tap a permanent for mana using its first (or chosen) mana ability. */
    tapForMana(playerId, objId, abilityIndex, manaChoice) {
      const o = this.obj(objId);
      if (!o) return this.fail('No such permanent.');
      if (o.controller !== playerId) return this.fail('Not yours.');
      const c = this.characteristics(o);
      if (c && c.setMana && !c.abilitiesLost) {
        // its type line has been rewritten, so it makes that mana instead
        if (o.tapped) return this.fail(`${o.name} is already tapped.`);
        this._markTapped(o);
        for (const sym of c.setMana) this.player(playerId).pool.add(sym);
        this.emit('sfx', 'tap');
        this.logEvent('mana', `${this.player(playerId).name} taps ${o.name} for ${c.setMana.join('')}.`);
        this.touch();
        return true;
      }
      const a = o.analysis();
      /* A land that only taps for mana because something else says so — an
         Urborg, a Chromatic Lantern — has nothing printed to activate, so
         the mana it was handed is used directly. */
      if (a && !a.manaAbilities.length) {
        const extra = this.manaAbilitiesOf(o);
        const ab = extra[abilityIndex || 0] || extra[0];
        if (!ab) return this.fail(`${o.name} has no mana ability.`);
        if (ab.cost && ab.cost.tap && o.tapped) return this.fail(`${o.name} is already tapped.`);
        if (this.characteristics(o).isCreature && o.summoningSick && !this.hasKw(o, 'haste') && ab.cost && ab.cost.tap)
          return this.fail(`${o.name} has summoning sickness.`);
        if (!this._activateManaDirect(playerId, o, ab, manaChoice)) return this.fail(`${o.name} cannot make mana right now.`);
        this.touch();
        return true;
      }
      if (!a || !a.manaAbilities.length) return this.fail(`${o.name} has no mana ability.`);
      return this.activateAbility(playerId, objId, abilityIndex || 0, { manaChoice });
    }

    /** Try to pay `cost`; may auto-tap lands. Returns true on success. */
    payMana(playerId, cost, opts) {
      opts = opts || {};
      const p = this.player(playerId);
      if (!cost || !MANA.parse(cost).length) return true;
      /* Mana that may only be spent on certain spells waits apart from the
         pool; it is lent to a payment it is allowed to pay for, and what is
         not used goes back to waiting. */
      const wasFor = this._payingFor;
      this._payingFor = opts.forSpell || null;
      const lent = this._lendRestricted(p, opts.forSpell, opts.forAbility);
      try {
        return this._payManaInner(p, playerId, cost, opts);
      } finally {
        this._returnLent(p, lent);
        this._payingFor = wasFor;
      }
    }

    /**
     * Could payMana pay this right now, the way it would pay it: the pool
     * first, then the same auto-tap plan, with nothing tapped. What the
     * table offers as playable is what castSpell will then pay for.
     */
    canPayNow(playerId, cost, opts) {
      opts = Object.assign({ auto: true }, opts || {});
      const p = this.player(playerId);
      if (!p) return false;
      if (!cost || !MANA.parse(cost).length) return true;
      const wasFor = this._payingFor;
      this._payingFor = opts.forSpell || null;
      const lent = this._lendRestricted(p, opts.forSpell, opts.forAbility);
      try {
        const need = opts.x ? cost.replace(/\{X\}/g, '{' + opts.x + '}') : cost;
        if (p.pool.canPay(need, opts)) return true;
        if (opts.fromPool) return false;
        return !!this._planAutoTap(playerId, this._autoTapSources(playerId), need, opts);
      } finally {
        this._returnLent(p, lent);
        this._payingFor = wasFor;
      }
    }

    /** The untapped permanents auto-tap may draw on. */
    _autoTapSources(playerId) {
      return this.battlefield.filter(o =>
        o.controller === playerId && !o.tapped && !o.phasedOut &&
        this.manaAbilitiesOf(o).length && !(this.characteristics(o).isCreature && o.summoningSick && !this.hasKw(o, 'haste')));
    }

    _payManaInner(p, playerId, cost, opts) {
      const need = opts.x ? cost.replace(/\{X\}/g, '{' + opts.x + '}') : cost;

      if (p.pool.canPay(need, opts)) { p.pool.pay(need, opts); return true; }
      if (opts.fromPool) return false;

      // auto-tap: find a set of untapped mana sources that covers the cost
      const sources = this._autoTapSources(playerId);
      if (opts.tapIds && opts.tapIds.length) {
        for (const id of opts.tapIds) {
          const s = this.obj(id);
          if (s && !s.tapped) this._tapForBestMana(playerId, s, need);
        }
        if (p.pool.canPay(need, opts)) { p.pool.pay(need, opts); return true; }
      }
      if (!MTG.settings.autoTapLands && !opts.auto) return false;

      const plan = this._planAutoTap(playerId, sources, need, opts);
      if (!plan) return false;
      for (const { obj, ability, symbol } of plan) {
        this._activateManaDirect(playerId, obj, ability, symbol);
      }
      if (p.pool.canPay(need, opts)) { p.pool.pay(need, opts); return true; }
      return false;
    }

    /**
     * Run one mana ability without going through the stack, paying what it
     * costs. Everything a mana ability can charge and the engine can pay by
     * itself is paid here — including a permanent that sacrifices itself for
     * mana, which used to make its mana and then stay on the table.
     */
    _activateManaDirect(playerId, o, ab, symbol) {
      const cost = ab.cost || {};
      if (!this._manaCostPayable(playerId, o, ab)) return false;
      if (cost.tap) this._markTapped(o);
      if (cost.untap) o.tapped = false;
      if (cost.mana) { if (!this.player(playerId).pool.pay(cost.mana)) return false; }
      if (cost.life) this.changeLife(playerId, -cost.life, 'mana');
      this._runManaAbility(playerId, o, ab, { controller: playerId, obj: o, name: o.name, manaChoice: symbol });
      if (cost.sacSelf) {
        this.logEvent('sacrifice', `${this.player(playerId).name} sacrifices ${o.name}.`);
        this.moveObject(o, 'graveyard');
        this._fire('youSacrifice', playerId, { count: 1, object: o, objController: playerId });
      }
      this.emit('sfx', 'tap');
      return true;
    }

    /**
     * Run a mana ability and settle what it made: the extra mana an aura or
     * a Crypt Ghast adds when a land is tapped, and mana that can only be
     * spent on some spells, which is set apart unless it is being spent on
     * one of those right now.
     */
    _runManaAbility(playerId, o, ab, ctx) {
      const p = this.player(playerId);
      const before = p.pool.snapshot();
      this._runEffectsNow(ab.effects, ctx);
      const after = p.pool.snapshot();
      const made = {};
      for (const c of MANA.COLORS.concat('C')) made[c] = Math.max(0, (after[c] || 0) - (before[c] || 0));
      if (ab.cost && ab.cost.tap) this._extraManaOnTap(playerId, o, made);
      if (!ab.spendOnly) return;
      const paying = this._payingFor;
      /* Path of Ancestry: the mana is anybody's to spend, but remembers
         what it promised if it ends up casting the right creature. */
      if (ab.spendOnly.open) {
        if (paying) {
          this._payFlags = this._payFlags || {};
          (this._payFlags.riders = this._payFlags.riders || []).push(ab.spendOnly.rider);
        } else (p.manaRiders = p.manaRiders || []).push(ab.spendOnly.rider);
        return;
      }
      if (paying && this._spendAllowed(ab.spendOnly, paying, o)) {
        this._payFlags = this._payFlags || {};
        if (ab.spendOnly.uncounterable) this._payFlags.uncounterable = true;
        if (ab.spendOnly.rider) (this._payFlags.riders = this._payFlags.riders || []).push(ab.spendOnly.rider);
        return;
      }
      p.restricted = p.restricted || [];
      for (const c of Object.keys(made)) {
        for (let i = 0; i < made[c]; i++) {
          if (p.pool[c] > 0) p.pool[c]--;
          p.restricted.push({ color: c, spendOnly: ab.spendOnly, srcId: o.id });
        }
      }
      if (Object.values(made).some(Boolean)) this.logEvent('mana', `${o.name}'s mana can only be spent as it says.`);
    }

    /* What a spent mana promised beyond itself: Path of Ancestry scries
       when its mana casts a creature that shares a type with your commander. */
    _manaRider(rider, item, playerId) {
      // Arena of Glory: a creature spell paid with it arrives with haste
      if (rider === 'hasteCreature') {
        const a = item.obj && item.obj.analysis();
        if (a && a.isCreature) item.hasteOnResolve = true;
        return;
      }
      if (rider === 'ancestryScry') {
        const cmdTypes = new Set();
        for (const c of [].concat((this.zones[playerId] || {}).command || [], this.battlefield.filter(x => x.owner === playerId)))
          if (c.isCommander) for (const t of ((c.analysis() || {}).subtypes || [])) cmdTypes.add(t);
        const a = item.obj && item.obj.analysis();
        if (a && a.isCreature && (a.subtypes || []).some(t => cmdTypes.has(t))) {
          this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: null, objId: null, controller: playerId,
            name: 'Path of Ancestry \u2014 scry 1', effects: [{ op: 'scry', n: 1 }], auto: true, abilityText: 'Scry 1' });
        }
      }
    }

    /** May mana with this restriction pay for that spell? */
    _spendAllowed(spendOnly, spell, src) {
      if (!spendOnly) return true;
      if (!spell) return false;
      if (spendOnly.words && !this._cardFitsWords(spell, spendOnly.words)) return false;
      if (spendOnly.chosenType && !(src && this._hasCreatureType(spell, src.chosenType))) return false;
      return true;
    }

    /** Put the waiting mana this spell may use into the pool, for the length of one payment. */
    _lendRestricted(p, spell, abilityOf) {
      const lent = [];
      if (!p.restricted || !p.restricted.length || (!spell && !abilityOf)) return lent;
      const keep = [];
      for (const r of p.restricted) {
        /* "…or activate abilities of creatures": an ability of the right
           kind of permanent may borrow it as well. */
        const forAbility = abilityOf && r.spendOnly && r.spendOnly.open && !r.spendOnly.words ? true : abilityOf && r.spendOnly && r.spendOnly.abilitiesOf &&
          this._cardFitsWords(abilityOf, r.spendOnly.abilitiesOf) &&
          (!r.spendOnly.abilitiesChosenType || this._hasCreatureType(abilityOf, (this.obj(r.srcId) || {}).chosenType));
        if (forAbility || (spell && this._spendAllowed(r.spendOnly, spell, this.obj(r.srcId)))) { lent.push(r); p.pool.add(r.color); }
        else keep.push(r);
      }
      p.restricted = keep;
      return lent;
    }

    /** Take back whatever of the lent mana the payment did not use. */
    _returnLent(p, lent) {
      if (!lent.length) return;
      const byColor = {};
      for (const r of lent) (byColor[r.color] = byColor[r.color] || []).push(r);
      for (const c of Object.keys(byColor)) {
        const list = byColor[c];
        const back = Math.min(list.length, p.pool[c] || 0);
        list.forEach((r, i) => {
          // still there: it goes back to waiting
          if (i < back) { p.pool[c]--; p.restricted.push(r); return; }
          // it was spent: anything it promised comes with it
          this._payFlags = this._payFlags || {};
          if (r.spendOnly && r.spendOnly.uncounterable) this._payFlags.uncounterable = true;
          if (r.spendOnly && r.spendOnly.rider) (this._payFlags.riders = this._payFlags.riders || []).push(r.spendOnly.rider);
        });
      }
    }

    /* "Whenever enchanted land is tapped for mana, its controller adds an
       additional {G}", "Whenever you tap a Swamp for mana, add an
       additional {B}": more mana, made alongside. */
    _extraManaOnTap(playerId, o, made) {
      const oa = o.analysis();
      if (!oa) return;
      const p = this.player(playerId);
      for (const src of this.battlefield) {
        const e = this._staticOp(src, 'extraManaOnTap');
        if (!e) continue;
        if (e.scope === 'attached' ? src.attachedTo !== o.id : false) continue;
        if (e.who === 'you' && o.controller !== src.controller) continue;
        if (e.filter && !this._cardFitsWords(o, e.filter)) continue;
        if (e.scope !== 'attached' && !e.filter && !oa.isLand) continue;
        let syms = e.symbols || [];
        if (e.chosen) syms = src.chosenColor ? [src.chosenColor] : [];
        if (e.sameType) {
          const kinds = Object.keys(made).filter(c => made[c] > 0);
          syms = kinds.length ? [kinds[0]] : [];
        }
        // Fertile Ground: one mana of any colour, the one the player is shortest of
        if (e.anyColor) syms = [this._preferredColor(p) || 'G'];
        for (const sym of syms) p.pool.add(sym);
        if (syms.length) this.logEvent('mana', `${src.name} adds ${syms.map(x => '{' + x + '}').join('')}.`);
      }
    }

    /** What a mana ability charges, and whether the engine can pay it alone. */
    _manaCostPayable(playerId, o, ab) {
      const c = (ab && ab.cost) || {};
      /* A mana ability a level band has not handed over yet is not a
         source the auto-tapper may reach for. */
      if (ab && ab.levelCond && !this._condMet(ab.levelCond, { controller: playerId, obj: o })) return false;
      if ((c.other || []).length) return false;
      // choosing which other permanent to give up is the player's call
      if (c.sacrifice || c.discard || c.exile || c.removeCounters) return false;
      // and so is which creatures to tap (Springleaf Drum): it is clicked, never reached for
      if (c.tapCreatures) return false;
      if (c.tap && o.tapped) return false;
      if (c.untap && !o.tapped) return false;
      const p = this.player(playerId);
      if (c.life && p && p.life <= c.life) return false;
      return true;
    }

    /**
     * Tap one source the player picked themselves, using whichever of its
     * mana abilities helps most with what is being paid for.
     */
    _tapForBestMana(playerId, o, need) {
      const list = this.manaAbilitiesOf(o);
      if (!list.length) return false;
      const want = new Set(MANA.parse(need || '').filter(x => x.length === 1 && MANA.COLORS.concat('C').includes(x)));
      let best = null, bestScore = -1;
      for (const ab of list) {
        if (!this._manaCostPayable(playerId, o, ab)) continue;
        const opt = this._manaOptions(ab, o, playerId);
        if (!opt.any && !opt.produces.size) continue;
        const hit = Array.from(want).find(c => opt.produces.has(c) || (opt.any && c !== 'C'));
        const score = (hit ? 2 : 1) * Math.max(1, opt.amount);
        if (score > bestScore) { bestScore = score; best = { ab, symbol: hit || Array.from(opt.produces)[0] || null }; }
      }
      if (!best) return false;
      return this._activateManaDirect(playerId, o, best.ab, best.symbol);
    }

    /** Greedy solver: colored requirements first, generic last. */
    _planAutoTap(playerId, sources, cost, opts) {
      const p = this.player(playerId);
      const syms = MANA.parse(cost);
      const need = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      let generic = 0;
      const hybrids = [];
      for (const s of syms) {
        if (/^\d+$/.test(s)) generic += +s;
        else if (s === 'X') generic += (opts.x || 0);
        else if (s.length === 1 && MANA.COLORS.includes(s)) need[s]++;
        else if (s === 'C') need.C++;
        else hybrids.push(s);
      }
      // subtract what is already floating, and keep what is left of it for the generic part
      let floatLeft = 0;
      for (const c of MANA.COLORS.concat('C')) {
        const use = Math.min(need[c], p.pool[c]);
        need[c] -= use;
        floatLeft += p.pool[c] - use;
      }

      // describe what each source can make
      const cand = [];
      for (const o of sources) {
        const list = this.manaAbilitiesOf(o);
        for (let i = 0; i < list.length; i++) {
          const ab = list[i];
          if (ab.cost && ab.cost.mana) continue;                   // filters: skip in auto-tap
          if (!this._manaCostPayable(playerId, o, ab)) continue;
          // auto-tap spends taps, never permanents or cards: a source that
          // eats itself (or anything else) is only used when you say so
          if (ab.cost && (ab.cost.sacSelf || ab.cost.sacrifice || ab.cost.discard ||
              ab.cost.exile || ab.cost.removeCounters || (ab.cost.other || []).length)) continue;
          // mana that can only be spent on something else is not for this
          if (ab.spendOnly && !this._spendAllowed(ab.spendOnly, opts.forSpell, o)) continue;
          const opt = this._manaOptions(ab, o, playerId);
          // a source that would make nothing right now is no source at all
          if (!opt.any && !opt.produces.size) continue;
          const pain = (ab.effects || []).some(e => e.op === 'damage' || e.op === 'loseLife') ? 1 : 0;
          cand.push({ obj: o, ability: ab, index: i, produces: opt.produces, any: opt.any, amount: opt.amount,
            flexibility: (opt.any ? 9 : opt.produces.size) + pain * 0.5 + (ab.spendOnly ? -0.25 : 0) });
        }
      }
      // prefer least flexible sources for colored needs, and the painless over the painful
      cand.sort((a, b) => a.flexibility - b.flexibility || b.amount - a.amount);

      const used = new Set();
      const plan = [];
      const take = (source, symbol) => { used.add(source.obj.id); plan.push({ obj: source.obj, ability: source.ability, symbol }); };

      for (const color of MANA.COLORS.concat('C')) {
        while (need[color] > 0) {
          const src = cand.find(s => !used.has(s.obj.id) && (s.produces.has(color) || (s.any && color !== 'C')));
          if (!src) return null;
          take(src, color);
          // a source that makes more than one pays the rest of this colour, then the generic part
          const k = Math.max(1, src.amount);
          const here = Math.min(k, need[color]);
          need[color] -= here;
          generic -= (k - here);
        }
      }
      for (const h of hybrids) {
        const cols = MANA.COLORS.filter(c => h.includes(c));
        let done = false;
        for (const c of cols) {
          const src = cand.find(s => !used.has(s.obj.id) && (s.produces.has(c) || s.any));
          if (src) { take(src, c); generic -= Math.max(0, src.amount - 1); done = true; break; }
        }
        if (!done && /\d/.test(h)) generic += parseInt(h, 10);
        else if (!done && h.includes('P')) { /* pay life at resolution */ }
        else if (!done) return null;
      }
      generic = Math.max(0, generic - floatLeft);
      while (generic > 0) {
        // the smallest source that still covers it, so a big one is not wasted on a single mana
        const free = cand.filter(s => !used.has(s.obj.id));
        if (!free.length) return null;
        const src = free.find(s => s.amount >= generic && s.amount === Math.min(...free.filter(x => x.amount >= generic).map(x => x.amount))) || free[0];
        take(src, src.any ? 'C' : Array.from(src.produces)[0] || 'C');
        generic -= Math.max(1, src.amount);
      }
      return plan;
    }

    /* ---------- combat (CR 506-511) ---------- */

    canAttack(o) {
      if (o.zone !== 'battlefield' || o.controller !== this.activePlayer.id) return false;
      const a = o.analysis();
      const c = this.characteristics(o);
      if (!a || !(c && c.isCreature)) return false;
      if (o.tapped || o.phasedOut) return false;
      if (o.summoningSick && !this.hasKw(o, 'haste')) return false;
      // "can attack this turn as though it didn't have defender"
      if (this.hasKw(o, 'defender') && !this._hasFlag(o, 'attackDespiteDefender')) return false;
      if (a.abilities.some(x => (x.effects || []).some(e => e.op === 'cantAttack'))) return false;
      if (this._hasFlag(o, 'cantAttack')) return false;
      /* "can't attack unless defending player controls an Island" — the old
         way of saying a creature only goes to war on the right terrain. */
      const needs = this._staticOp(o, 'attackRequires');
      if (needs && needs.defenderControls) {
        const want = String(needs.defenderControls).toLowerCase().replace(/s$/, '');
        const has = this.players.some(p => p.id !== o.controller && !p.hasLost &&
          this.battlefield.some(x => {
            if (x.controller !== p.id) return false;
            const xa = x.analysis();
            if (!xa) return false;
            return (xa.types || []).some(t => t.toLowerCase() === want) ||
              (xa.subtypes || []).some(t => t.toLowerCase() === want);
          }));
        if (!has) return false;
      }
      return true;
    }

    _declareAttackersStep() {
      const ap = this.activePlayer;
      this.combat = { attackers: [], blockers: [], damageDealt: false, firstStrikeDone: false };
      const possible = this.battlefield.filter(o => this.canAttack(o));
      if (!possible.length) {
        this.logEvent('combat', `${ap.name} has no creatures that can attack.`);
        // skip straight past blockers
        this.stepIndex = this.phase.steps.indexOf('endCombat') - 1;
        this._advanceStep();
        return;
      }
      this.pendingChoice = {
        type: 'declareAttackers', playerId: ap.id,
        candidates: possible.map(o => o.id),
        defenders: this._legalDefenders(ap.id),
        prompt: 'Declare attackers.',
      };
      this.emit('choice', this.pendingChoice);
      this.touch();
    }

    _legalDefenders(attackerPid) {
      const out = [];
      for (const p of this.players) if (p.id !== attackerPid && !p.hasLost) out.push({ kind: 'player', id: p.id, name: p.name });
      for (const o of this.battlefield) {
        const a = o.analysis();
        if (!a) continue;
        if (o.controller === attackerPid) continue;
        if (a.isPlaneswalker || a.isBattle) out.push({ kind: 'object', id: o.id, name: o.name });
      }
      return out;
    }

    /**
     * Does this creature have to attack if it can (CR 508.1d)? Asked by the
     * engine when a declaration comes in, and by anything deciding what to
     * declare — a plan that leaves a compelled creature at home is refused,
     * and something has to know that before sending it.
     */
    mustAttack(o) {
      if (!o) return false;
      const a = o.analysis();
      if (!a) return false;
      return a.abilities.some(x => (x.effects || []).some(e => e.op === 'mustAttack')) ||
        this._hasFlag(o, 'mustAttackEot') || o.goadedBy != null || o.mustAttackPlayer != null;
    }

    declareAttackers(playerId, declarations) {
      const ch = this.pendingChoice;
      if (!ch || ch.type !== 'declareAttackers' || ch.playerId !== playerId) return this.fail('Not declaring attackers.');
      declarations = declarations || [];
      /* "can't attack alone" (CR 506.5): a lone attacker that can't stays
         at home, and nobody attacks */
      if (declarations.length === 1) {
        const lone = this.obj(declarations[0].attackerId);
        if (lone && this._staticOp(lone, 'cantAttackAlone')) {
          this.logEvent('rules', `${lone.name} can't attack alone.`);
          declarations = [];
        }
      }
      const legalDef = new Set(ch.defenders.map(d => d.id));
      for (const d of declarations) {
        const o = this.obj(d.attackerId);
        if (!o || !this.canAttack(o)) return this.fail('Illegal attacker.');
        if (!legalDef.has(d.defenderId)) return this.fail('Illegal defender.');
      }
      // "creatures can't attack you unless their controller pays {2} for each"
      const taxed = declarations.filter(d => {
        const def = this.player(d.defenderId);
        if (!def) return false;
        return this.battlefield.some(o => o.controller === def.id && (o.analysis() || { abilities: [] })
          .abilities.some(ab => (ab.effects || []).some(ef => ef.op === 'attackTax')));
      });
      if (taxed.length && this.config.rulesEnforcement === 'full') {
        const per = 2 * taxed.length;
        if (!this.payMana(playerId, '{' + per + '}', { auto: true }))
          return this.fail(`Attacking costs {${per}} and you cannot pay it.`);
        this.logEvent('rules', `${this.player(playerId).name} pays {${per}} to attack.`);
      }

      // must-attack creatures
      if (this.config.rulesEnforcement === 'full') {
        for (const id of ch.candidates) {
          const o = this.obj(id);
          const must = this.mustAttack(o);
          if (must && !declarations.some(d => d.attackerId === id))
            return this.fail(`${o.name} ${o.goadedBy != null ? 'is goaded and must attack' : 'attacks each combat if able'}.`);
          /* An encore token was made to go after one player in particular. */
          if (o && o.mustAttackPlayer != null) {
            const d = declarations.find(x => x.attackerId === id);
            if (d && d.defenderId !== o.mustAttackPlayer && this.player(o.mustAttackPlayer))
              return this.fail(`${o.name} must attack ${this.player(o.mustAttackPlayer).name}.`);
          }
        }
      }
      this.pendingChoice = null;
      // goad only compels the one combat it was aimed at (CR 701.38)
      for (const id of ch.candidates) { const o = this.obj(id); if (o) o.goadedBy = null; }
      for (const d of declarations) {
        const o = this.obj(d.attackerId);
        const a = o.analysis();
        o.attacking = d.defenderId;
        // "attacks for the first time each turn", "creatures that attacked this turn"
        o.attacksThisTurn = (o.attackedTurn === this.turn ? (o.attacksThisTurn || 0) : 0) + 1;
        o.attackedTurn = this.turn;
        if (!this.hasKw(o, 'vigilance')) this._markTapped(o);
        this.combat.attackers.push(o.id);
        this._fire('attacks', o.controller, { attacker: o, source: o });
        this._fire('permAttacks', null, { object: o, objController: o.controller, attacker: o,
          player: this.player(d.defenderId) ? d.defenderId : (this.obj(d.defenderId) || {}).controller });
      }
      if (declarations.length) {
        (this.turnHistory || (this.turnHistory = {})).attacked = true;
        this.turnHistory.attackers = (this.turnHistory.attackers || 0) + declarations.length;
        this.emit('sfx', 'attack');
        this._attackKeywords(declarations.map(d => this.obj(d.attackerId)).filter(Boolean));
        this.logEvent('combat', `${this.player(playerId).name} attacks with ${declarations.map(d => this.obj(d.attackerId).name).join(', ')}.`);
      } else {
        this.logEvent('combat', `${this.player(playerId).name} declares no attackers.`);
        this.stepIndex = this.phase.steps.indexOf('endCombat') - 1;
        this.checkStateBasedActions();
        this._advanceStep();
        return true;
      }
      this.checkStateBasedActions();
      this._givePriority(this.activeIndex);
      /* Saying "yes, that was accepted" matters: a caller that cannot tell
         a refused declaration from an accepted one either sits waiting
         forever or declares again. */
      return true;
    }

    /**
     * The attackers this creature is required to block if it can: one that
     * made it ("target creature blocks this creature this turn if able"),
     * and any lure ("all creatures able to block this creature do so").
     */
    _blockDemands(o) {
      const out = [];
      for (const aid of ((this.combat && this.combat.attackers) || [])) {
        const at = this.obj(aid);
        if (!at || !this.canBlock(o, at)) continue;
        const named = (o.effects || []).some(e => e && e.mustBlockId === at.id);
        const lure = this._hasFlag(at, 'lure') || !!this._staticOp(at, 'lure');
        if (named || lure) out.push(at);
      }
      return out;
    }

    canBlock(blocker, attacker) {
      const def = attacker.attacking;
      const defPid = this.player(def) ? def : (this.obj(def) ? this.obj(def).controller : null);
      return this.couldBlock(blocker, attacker, defPid);
    }

    /**
     * The same question as canBlock, asked before anybody has attacked:
     * could this creature block that one, if it came at this player? Which
     * is what deciding whether to attack needs to know — asking canBlock
     * there answers "no" for everything, because nothing is attacking yet.
     */
    couldBlock(blocker, attacker, defenderId) {
      const ba = blocker.analysis(), aa = attacker.analysis();
      if (!ba || !aa) return false;
      const bc = this.characteristics(blocker);
      if (blocker.zone !== 'battlefield' || !(bc && bc.isCreature)) return false;
      if (blocker.tapped || blocker.phasedOut) return false;
      if (ba.abilities.some(x => (x.effects || []).some(e => e.op === 'cantBlock'))) return false;
      if (this._hasFlag(blocker, 'cantBlock')) return false;
      if ((blocker.effects || []).some(e => e && e.cantBlockId === attacker.id)) return false;
      // the blocker must be controlled by the defending player
      const defPid = defenderId;
      if (blocker.controller !== defPid) return false;
      // evasion
      const A = (k) => this.hasKw(attacker, k), B = (k) => this.hasKw(blocker, k);
      if (A('unblockable')) return false;
      if (this._hasFlag(blocker, 'blocksFliersOnly') && !this.hasKw(attacker, 'flying')) return false;
      if (A('flying') && !(B('flying') || B('reach'))) return false;
      if (A('shadow') && !B('shadow')) return false;
      if (!A('shadow') && B('shadow')) return false;
      if (A('horsemanship') && !B('horsemanship')) return false;
      if (A('fear') && !(ba.isArtifact || (ba.colors || []).includes('B'))) return false;
      if (A('intimidate') && !(ba.isArtifact || (aa.colors || []).some(c => (ba.colors || []).includes(c)))) return false;
      if (A('skulk') && this.powerOf(blocker) > this.powerOf(attacker)) return false;
      const walkKinds = (aa.keywords || []).filter(k => k.keyword === 'Landwalk' && k.arg).map(k => String(k.arg).toLowerCase());
      for (const k of (this.characteristics(attacker).keywords || [])) {
        const w = String(k).match(/^(nonbasic land|[a-z]+)walk$/i);
        if (w) walkKinds.push(w[1].toLowerCase());
      }
      for (const kind of walkKinds) {
        const walks = this.battlefield.some(l => l.controller === defPid && (l.analysis() || {}).isLand &&
          (kind === 'nonbasic land' || kind === 'nonbasic' ? !((l.analysis() || {}).supertypes || []).includes('Basic')
            : ((l.analysis() || {}).subtypes || []).some(st => st.toLowerCase() === kind)));
        if (walks) return false;
      }
      /* The Ring, level 1: your Ring-bearer can't be blocked by creatures
         with greater power. */
      if (this._isRingBearer(attacker) && (this.player(attacker.controller) || {}).ringLevel >= 1 &&
          this.powerOf(blocker) > this.powerOf(attacker)) return false;
      // "can't be blocked by creatures with power 2 or less" and friends
      const ev = this._staticOp(attacker, 'evasion');
      if (ev && ev.minBlockerPower != null && this.powerOf(blocker) < ev.minBlockerPower) return false;
      if (ev && ev.maxBlockerPower != null && this.powerOf(blocker) > ev.maxBlockerPower) return false;
      /* "Creatures with power less than this one's can't block it." */
      if (ev && ev.blockerAtLeastMyPower && this.powerOf(blocker) < this.powerOf(attacker)) return false;
      /* "can't be blocked by Walls", "except by creatures with flying": the
         blockers that may not, described the way a target is */
      if (ev && ev.notBy && MTG.oracle.matchesSpec(ev.notBy, blocker, blocker.analysis(), attacker.controller, this._specCtx())) return false;
      if (this._protectedFrom(attacker, blocker)) return false;
      const menace = A('menace');
      return { menace };
    }
    /* Protection from a quality, printed or granted ("equipped creature has
       protection from black and from green"): does it shield o from this
       source? */
    _protectedFrom(o, source) {
      if (!o || !source) return false;
      const a = o.analysis();
      const args = ((a && a.keywords) || []).filter(k => k.keyword === 'Protection').map(k => k.arg);
      const c = this.characteristics(o);
      for (const k of (c && c.keywords) || []) {
        if (/^protection from /.test(k)) args.push(k.slice('protection from '.length));
      }
      return args.some(arg => this._matchesProtection(arg, source));
    }
    _matchesProtection(arg, o) {
      if (!arg) return false;
      const a = o.analysis();
      const s = arg.toLowerCase();
      const colorMap = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      for (const [w, c] of Object.entries(colorMap)) if (s.includes(w) && (a.colors || []).includes(c)) return true;
      if (s.includes('artifacts') && a.isArtifact) return true;
      if (s.includes('creatures') && a.isCreature) return true;
      if (s.includes('everything')) return true;
      for (const st of a.subtypes) if (s.includes(st.toLowerCase())) return true;
      return false;
    }

    _declareBlockersStep() {
      if (!this.combat.attackers.length) { this._advanceStep(); return; }
      // which players are being attacked?
      const defenders = new Set();
      for (const id of this.combat.attackers) {
        const o = this.obj(id);
        const d = o.attacking;
        const pid = this.player(d) ? d : (this.obj(d) ? this.obj(d).controller : null);
        if (pid) defenders.add(pid);
      }
      this.blockQueue = Array.from(defenders);
      this._askNextBlocker();
    }
    _askNextBlocker() {
      if (!this.blockQueue || !this.blockQueue.length) {
        this._finishBlockers();
        return;
      }
      const pid = this.blockQueue.shift();
      const p = this.player(pid);
      const attackersOnMe = this.combat.attackers.filter(id => {
        const o = this.obj(id);
        const d = o.attacking;
        return d === pid || (this.obj(d) && this.obj(d).controller === pid);
      });
      const candidates = this.battlefield.filter(o => o.controller === pid &&
        attackersOnMe.some(aid => this.canBlock(o, this.obj(aid))));
      if (!candidates.length) { this._askNextBlocker(); return; }
      this.pendingChoice = {
        type: 'declareBlockers', playerId: pid,
        attackers: attackersOnMe,
        candidates: candidates.map(o => o.id),
        prompt: 'Declare blockers.',
      };
      this.emit('choice', this.pendingChoice);
      this.touch();
    }

    declareBlockers(playerId, declarations) {
      const ch = this.pendingChoice;
      if (!ch || ch.type !== 'declareBlockers' || ch.playerId !== playerId) return this.fail('Not declaring blockers.');
      declarations = declarations || [];
      // "can't block alone": the same, for a lone blocker
      if (declarations.length === 1) {
        const lone = this.obj(declarations[0].blockerId);
        if (lone && this._staticOp(lone, 'cantBlockAlone')) {
          this.logEvent('rules', `${lone.name} can't block alone.`);
          declarations = [];
        }
      }
      // validate
      for (const d of declarations) {
        const b = this.obj(d.blockerId);
        if (!b) return this.fail('No such blocker.');
        for (const aid of d.attackerIds) {
          const at = this.obj(aid);
          if (!at || !this.canBlock(b, at)) return this.fail(`${b.name} cannot block ${at ? at.name : '?'}.`);
        }
        if (d.attackerIds.length > 1) {
          const ba = b.analysis();
          const extra = this._staticOp(b, 'blocksExtra');
          const canMulti = (extra && d.attackerIds.length <= (extra.n || 1) + 1) ||
            (ba && /can block an additional|can block any number/i.test(ba.oracleText || ''));
          if (!canMulti && this.config.rulesEnforcement === 'full')
            return this.fail(`${b.name} can only block one creature.`);
        }
      }
      // menace: needs two or more blockers
      if (this.config.rulesEnforcement === 'full') {
        const counts = new Map();
        for (const d of declarations) for (const aid of d.attackerIds) counts.set(aid, (counts.get(aid) || 0) + 1);
        for (const [aid, n] of counts) {
          const at = this.obj(aid);
          const aa = at.analysis();
          if (this.hasKw(at, 'menace') && n === 1) return this.fail(`${at.name} has menace and can't be blocked by exactly one creature.`);
        }
        // "blocks this turn if able" (CR 509.1c)
        for (const o of this.battlefield) {
          if (o.controller !== playerId) continue;
          if (!this._hasFlag(o, 'mustBlock') && !this._staticOp(o, 'mustBlock')) continue;
          if (declarations.some(d => d.blockerId === o.id)) continue;
          if (this.combat.attackers.some(aid => { const at = this.obj(aid); return at && this.canBlock(o, at); }))
            return this.fail(`${o.name} blocks this turn if able.`);
        }
        // "blocks this creature if able", and lures: must block one of those it is drawn to
        for (const o of this.battlefield) {
          if (o.controller !== playerId) continue;
          const drawn = this._blockDemands(o);
          if (!drawn.length) continue;
          if (declarations.some(d => d.blockerId === o.id && d.attackerIds.some(id => drawn.some(x => x.id === id)))) continue;
          return this.fail(`${o.name} must block ${drawn[0].name} if able.`);
        }
      }
      this.pendingChoice = null;
      for (const d of declarations) {
        const b = this.obj(d.blockerId);
        b.blocking = d.attackerIds.slice();
        for (const aid of d.attackerIds) {
          const at = this.obj(aid);
          at.blockedBy.push(b.id);
          if (!at.blockOrder.includes(b.id)) at.blockOrder.push(b.id);
          /* The Ring, level 3: whatever blocks the Ring-bearer does not
             walk away from it. */
          if (this._isRingBearer(at) && (this.player(at.controller) || {}).ringLevel >= 3) {
            b.sacAtEndOfCombat = true;
            this.logEvent('rules', `${b.name} blocked the Ring-bearer and is sacrificed at end of combat.`);
          }
        }
        this.combat.blockers.push(b.id);
        this._fire('blocks', b.controller, { blocker: b, source: b });
        this._fire('permBlocks', null, { object: b, objController: b.controller });
      }
      if (declarations.length) {
        this.emit('sfx', 'block');
        this._blockKeywords(declarations);
        this.logEvent('combat', `${this.player(playerId).name} blocks with ${declarations.map(d => this.obj(d.blockerId).name).join(', ')}.`);
      }
      this._askNextBlocker();
      return true;
    }

    _finishBlockers() {
      /* "Whenever this creature attacks and isn't blocked": once blockers
         are declared, each attacker nobody blocked (CR 509.1h). */
      for (const aid of this.combat.attackers) {
        const at = this.obj(aid);
        if (!at || at.zone !== 'battlefield' || at.blockedBy.length) continue;
        const d = at.attacking;
        this._fire('attacksUnblocked', at.controller, { source: at, object: at, attacker: at,
          player: this.player(d) ? d : (this.obj(d) || {}).controller });
      }
      this.checkStateBasedActions();
      this._givePriority(this.activeIndex);
    }

    _anyFirstStrike() {
      return this.combat.attackers.concat(this.combat.blockers).some(id => {
        const o = this.obj(id);
        if (!o || o.zone !== 'battlefield') return false;
        return this.hasKw(o, 'first strike') || this.hasKw(o, 'double strike');
      });
    }

    _combatDamage(firstStrikeStep) {
      const assignments = [];       // {source, target, amount, deathtouch, lifelink}
      const participants = this.combat.attackers.concat(this.combat.blockers);
      for (const id of participants) {
        const o = this.obj(id);
        if (!o || o.zone !== 'battlefield' || o.removedFromCombat) continue;
        const a = o.analysis();
        if (!a || !a.isCreature) continue;
        const fs = this.hasKw(o, 'first strike'), ds = this.hasKw(o, 'double strike');
        if (firstStrikeStep && !(fs || ds)) continue;
        if (!firstStrikeStep && fs && !ds) continue;
        const power = this.powerOf(o);
        if (power <= 0) continue;
        if (this._hasFlag(o, 'noDamage')) continue;

        if (o.attacking) {
          const blockers = o.blockOrder.map(bid => this.obj(bid)).filter(b => b && b.zone === 'battlefield' && b.blocking.includes(o.id));
          if (!blockers.length) {
            // unblocked: damage to the defender
            const d = o.attacking;
            assignments.push({ source: o, targetKind: this.player(d) ? 'player' : 'object', targetId: d, amount: power, a });
          } else {
            // assign in order; lethal to each before moving on (CR 510.1c)
            let left = power;
            for (const b of blockers) {
              if (left <= 0) break;
              const lethal = this.hasKw(o, 'deathtouch') ? 1 : Math.max(0, this.toughnessOf(b) - b.damage);
              const give = (b === blockers[blockers.length - 1] && this.hasKw(o, 'trample')) ? Math.min(left, lethal) : Math.min(left, Math.max(lethal, 0) || left);
              const amount = Math.min(left, Math.max(1, lethal || left));
              assignments.push({ source: o, targetKind: 'object', targetId: b.id, amount, a });
              left -= amount;
            }
            if (left > 0 && this.hasKw(o, 'trample')) {
              const d = o.attacking;
              assignments.push({ source: o, targetKind: this.player(d) ? 'player' : 'object', targetId: d, amount: left, a, trample: true });
            }
          }
        } else if (o.blocking.length) {
          const targets = o.blocking.map(aid => this.obj(aid)).filter(x => x && x.zone === 'battlefield');
          if (targets.length) {
            assignments.push({ source: o, targetKind: 'object', targetId: targets[0].id, amount: power, a });
          }
        }
      }

      if (!assignments.length) { this.checkStateBasedActions(); this._givePriority(this.activeIndex); return; }

      for (const as of assignments) {
        // lifelink gains what was actually dealt: none if prevented, double if doubled
        let got = 0;
        if (as.targetKind === 'player') {
          const p = this.player(as.targetId);
          got = this.dealDamageToPlayer(p, as.amount, as.source, true) || 0;
        } else {
          const t = this.obj(as.targetId);
          if (!t || t.zone !== 'battlefield') continue;
          got = this.dealDamageToObject(t, as.amount, as.source, true) || 0;
        }
        if (got > 0 && this.hasKw(as.source, 'lifelink')) this.changeLife(as.source.controller, got, 'lifelink');
      }
      const dealt = assignments.reduce((k, x) => k + x.amount, 0);
      this.emit('sfx', 'damage', { player: this.activePlayer.id, size: dealt });
      this.combat.damageDealt = true;
      // combat damage to a player triggers
      for (const as of assignments) {
        if (as.targetKind === 'player') {
          /* Freerunning asks whether an Assassin or your commander got
             through this turn (CR 702.175). */
          const sa = as.source.analysis();
          if (as.source.isCommander || (sa && (sa.subtypes || []).includes('Assassin'))) {
            const owner = this.player(as.source.controller);
            if (owner) owner.freerunningTurn = this.turn;
          }
          /* The Ring, level 4: the Ring-bearer getting through costs every
             opponent three life. */
          if (this._isRingBearer(as.source) && (this.player(as.source.controller) || {}).ringLevel >= 4) {
            for (const foe of this.opponentsOf(as.source.controller)) this.changeLife(foe, -3, 'ring');
            this.logEvent('rules', `${as.source.name} carries the Ring: each opponent loses 3 life.`);
          }
          this._fire('combatDamageToPlayer', as.source.controller, { source: as.source, amount: as.amount, player: as.targetId });
          this._cipherHits(as.source);
          this._fire('yourCreatureCombatDamage', as.source.controller, { source: as.source, amount: as.amount, player: as.targetId, object: as.source });
          this._fire('permCombatDamage', null, { object: as.source, objController: as.source.controller,
            amount: as.amount, player: as.targetId });
          if ((as.source.attachments || []).length) {
            this._fire('equippedCombatDamage', null, { object: as.source, attachedIds: as.source.attachments.slice(),
              amount: as.amount, player: as.targetId });
          }
          // hitting the monarch or the player with the initiative takes it
          // from them (CR 720.4a, 723.4a)
          const hit = this.player(as.targetId);
          if (hit && hit.monarch && as.source.controller !== as.targetId) this.setMonarch(as.source.controller, 'combat damage');
          if (hit && hit.initiative && as.source.controller !== as.targetId) this.takeInitiative(as.source.controller, 'combat damage');
        }
      }
      this.checkStateBasedActions();
      this._givePriority(this.activeIndex);
    }

    _endCombat() {
      for (const id of this.combat.attackers.concat(this.combat.blockers)) {
        const o = this.obj(id);
        if (!o) continue;
        o.attacking = null; o.blocking = []; o.blockedBy = []; o.blockOrder = [];
      }
      /* Tokens that only came along for the fight (mobilize) go away when
         the fight is over. */
      for (const o of this.battlefield.slice()) {
        if (!o.sacAtEndOfCombat) continue;
        this.moveObject(o, 'graveyard');
        this.logEvent('sacrifice', `${o.name} is sacrificed at end of combat.`);
      }
      /* Mana kept through combat by firebending drains away with it. */
      for (const p of this.players) {
        if (p.poolKeepUntil === 'combat') { p.pool.clear(); p.poolKeepUntil = null; }
      }
      this.combat = { attackers: [], blockers: [], damageDealt: false, firstStrikeDone: false };
    }
    combatCleanupIfNeeded(step) {
      if (step === 'untap') this._endCombat();
    }

    /* ---------- characteristics with continuous effects ---------- */

    /**
     * Does this permanent have the keyword right now? Printed keywords plus
     * anything granted by a continuous effect ("gains flying until end of turn").
     */
    hasKw(o, kw) {
      if (!o) return false;
      const c = this.characteristics(o);
      return !!(c && c.keywords.has(String(kw).toLowerCase()));
    }

    /** How many permanents a player controls that answer to a text like "Goblins" or "creatures". */
    countMatching(pid, what) {
      const w = String(what || '').trim().toLowerCase().replace(/^other /, '');
      return this.countPermanents(pid, { per: w });
    }

    /* ---------- replacement effects (CR 614) ----------
       "If X would happen, Y happens instead." These are not triggers: nothing
       goes on the stack and nobody gets priority. The event is simply changed
       on its way through, so every road that leads to one of these events has
       to pass the event through here first. */

    /** The replacement effects in play right now, gathered like continuous ones. */
    _replacements() {
      if (this._repCache && this._repEpoch === this._boardKey) return this._repCache;
      const list = [];
      for (const src of this.battlefield) {
        const a = src.analysis();
        if (!a) continue;
        for (const ab of a.abilities) {
          for (const ef of (ab.effects || [])) {
            if (ef.op === 'replace') list.push({ ef, src });
          }
        }
      }
      this._repCache = list;
      this._repEpoch = this._boardKey;
      return list;
    }

    /**
     * Run an event past the replacement effects. `ev` describes what is about
     * to happen and comes back modified — or with `cancelled` set, if
     * something replaced it with nothing at all. Each effect applies once to
     * each event (CR 614.5), which is what `seen` is for.
     */
    _replace(ev) {
      const seen = ev._seen || (ev._seen = new Set());
      let guard = 0;
      let again = true;
      while (again && guard++ < 12) {
        again = false;
        for (const entry of this._replacements()) {
          const ef = entry.ef;
          const key = entry.src.id + ':' + (ef.id || ef.event);
          if (seen.has(key)) continue;
          if (!this._replaceMatches(ef, entry.src, ev)) continue;
          seen.add(key);
          this._applyReplacement(ef, entry.src, ev);
          this.logEvent('replace', `${entry.src.name} changes what happens.`);
          again = true;
          break;
        }
      }
      return ev;
    }

    _replaceMatches(ef, src, ev) {
      if (ef.event !== ev.kind) return false;
      const who = ef.who || 'you';
      if (who === 'you' && ev.controller !== src.controller) return false;
      if (who === 'opponents' && ev.controller === src.controller) return false;
      if (ef.what && ev.object) {
        const a = ev.object.analysis && ev.object.analysis();
        if (!a) return false;
        if (ef.what !== 'permanent' && !(a.types || []).some(t => t.toLowerCase() === ef.what)) return false;
      }
      /* "Artifacts and creatures your opponents control enter tapped" */
      if (ef.whatAny && ev.object) {
        const a = ev.object.analysis && ev.object.analysis();
        if (!a) return false;
        const fits = ef.whatAny.some(w => w === 'permanent' || (w === 'nonland' ? !a.isLand
          : w === 'nonbasic land' ? (a.isLand && !(a.supertypes || []).includes('Basic'))
          : (a.types || []).some(t => t.toLowerCase() === w)));
        if (!fits) return false;
      }
      // "+1/+1 counters would be put on…" is only those counters
      if (ef.counter && ev.counter !== ef.counter) return false;
      // "an opponent's graveyard" is about whose card it is
      if (ef.owner && ev.object) {
        const own = ev.object.owner;
        if (ef.owner === 'opponents' && own === src.controller) return false;
        if (ef.owner === 'you' && own !== src.controller) return false;
      }
      if (ef.toZone && ev.zone !== ef.toZone) return false;
      if (ef.duringYourTurn && !(this.activePlayer && this.activePlayer.id === src.controller)) return false;
      if (ef.fromZone && ev.from && ev.from !== ef.fromZone) return false;
      // "one or more creature tokens", "one or more Treasure tokens"
      if (ef.event === 'createToken' && ef.tokenWhat &&
        !new RegExp('\\b' + ef.tokenWhat + '\\b', 'i').test(ev.tokenTypes || '')) return false;
      if (ef.event === 'damage') {
        // "to an opponent or a permanent an opponent controls"
        if (ef.toOpponent && ev.victimController === src.controller) return false;
        if (ef.noncombat && ev.combat) return false;
        if (ef.sourceWords && !this._cardFitsWords(ev.source, ef.sourceWords)) return false;
      }
      if (ef.event === 'zoneChange' && ef.how === 'toZone' && ev.zone === ef.zone) return false;
      return true;
    }

    _applyReplacement(ef, src, ev) {
      switch (ef.how) {
        case 'double': ev.n = (ev.n || 0) * 2; break;
        case 'triple': ev.n = (ev.n || 0) * 3; break;
        case 'plus': (ev.extras = ev.extras || []).push(ef.extra); break;
        case 'add': ev.n = (ev.n || 0) + (ef.n || 1); break;
        case 'toZone': ev.zone = ef.zone; if (ef.withCounter) ev.withCounter = ef.withCounter; break;
        case 'skip': ev.cancelled = true; break;
        case 'tapped': ev.tapped = true; break;
        case 'untapped': ev.untapped = true; break;
        default: break;
      }
    }

    /* ---------- continuous effects (CR 613) ----------
       Every static ability that changes what other permanents are goes into
       one list, and every question about a permanent's characteristics is
       answered by applying that list in layer order, rather than by hunting
       through the battlefield at the point of asking. That is what makes an
       anthem, an equipment bonus and a creature that sets its own power all
       agree with each other.

       The layers (CR 613.1): 1 copy, 2 control, 3 text, 4 type, 5 colour,
       6 abilities, 7 power and toughness (7a defining, 7b setting, 7c
       modifying, counters included, 7d switching). Within a layer the older
       effect goes first (613.7), unless one depends on another (613.8).

       Copy effects (layer 1) are applied by changing the card a permanent
       is (`o.card`, with `o.printedCard` kept), so everything downstream
       reads copiable values. Control (layer 2) is worked out eagerly, by
       _refreshControl, because `o.controller` is read everywhere. Layers 4
       to 6 are worked out for the whole battlefield at once, and only when
       something on it changes what permanents are (a type, a colour, or
       every ability); the rest of the time a permanent is what its card
       says. Abilities granted and taken (6) and power and toughness (7) are
       worked out per permanent, on demand, and remembered until the board
       changes. */

    /** A new timestamp (CR 613.7): a permanent arriving, an Aura or Equipment attached. */
    _stampNew() {
      this._flushStamps();
      return (this._tsSeq = (this._tsSeq || 0) + 1);
    }
    /**
     * Effects a resolution leaves on a permanent ("gets +3/+3 until end of
     * turn") are given their timestamps here, in the order they sit on the
     * battlefield, at points the game always passes through in the same
     * order (a permanent arriving, state-based actions). Until then they
     * count as the newest thing there is.
     */
    _flushStamps() {
      for (const o of this.battlefield) {
        const fx = o.effects;
        if (!fx || !fx.length) continue;
        for (const e of fx) if (e && e.ts == null) e.ts = (this._tsSeq = (this._tsSeq || 0) + 1);
      }
    }
    /** A permanent's timestamp. One put down by hand is as old as the game. */
    _tsOf(o) { return o && o.ts != null ? o.ts : 0; }
    /** An effect's timestamp, provisional (newer than everything) if it has none yet. */
    _effTs(e, i) { return e.ts != null ? e.ts : (this._tsSeq || 0) + 0.5 + (i || 0) / 1024; }

    /**
     * Layer 2 (CR 613.1b): who controls each permanent, with every
     * control-changing effect applied oldest first, so the newest wins. A
     * permanent remembers who controlled it before any of them (`ctlBase`),
     * and goes back to that player when the last of them ends: the Threaten
     * wears off, the Control Magic leaves. Worked out at the points a
     * control effect can begin or end, and before state-based actions.
     */
    _refreshControl() {
      let changed = false;
      const statics = this._continuous().filter(x => x.ef.control);
      for (const o of this.battlefield) {
        let best = null, bestTs = -Infinity;
        for (const x of statics) {
          if (!this._contApplies(x, o, null)) continue;
          if (x.ts > bestTs) { best = x.ef.control === 'you' ? x.src.controller : x.ef.control; bestTs = x.ts; }
        }
        (o.effects || []).forEach((e, i) => {
          if (!e || e.control == null) return;
          const ts = this._effTs(e, i);
          if (ts > bestTs) { best = e.control; bestTs = ts; }
        });
        const who = best != null && this.player(best) && !this.player(best).hasLost ? best : null;
        let to = null;
        if (who != null) {
          if (o.ctlBase == null) o.ctlBase = o.controller;
          to = who;
        } else if (o.ctlBase != null) {
          to = this.player(o.ctlBase) && !this.player(o.ctlBase).hasLost ? o.ctlBase : o.owner;
          o.ctlBase = null;
        }
        if (to != null && to !== o.controller) {
          const from = o.controller;
          o.controller = to;
          /* A new controller has not had it since the turn began (CR
             302.6), and it leaves combat (CR 506.4). */
          o.summoningSick = true;
          if (o.attacking) { o.attacking = null; this.combat.attackers = (this.combat.attackers || []).filter(id => id !== o.id); }
          o.blocking = [];
          o._chr = null;
          changed = true;
          if (who == null && from != null) this.logEvent('control', `${o.name} goes back to ${(this.player(to) || {}).name || to}.`);
        }
      }
      if (changed) this.bumpBoard();
      return changed;
    }

    /** The continuous effects currently on the battlefield, oldest first. */
    _continuous() {
      if (this._contCache && this._contEpoch === this._boardKey) return this._contCache;
      const list = [];
      for (const src of this.battlefield) {
        if (src.phasedOut) continue;
        // what the permanent printed and was handed, before the layers: an
        // effect that takes its abilities away is reckoned with below
        const a = this._baseAnalysis(src);
        if (!a) continue;
        const ts = this._tsOf(src);
        a.abilities.forEach((ab, ai) => {
          // a sentence that says two standing things at once arrives as a
          // sequence, and both halves are standing rules, from one ability
          const group = src.id + '#' + ai;
          const effs = [];
          for (const ef of (ab.effects || [])) {
            if (ef.op === 'sequence' && Array.isArray(ef.list)) effs.push(...ef.list);
            else effs.push(ef);
          }
          for (const ef of effs) {
            if (ef.op === 'continuous' && ef.fromGraveyard) continue;
            if (ef.op === 'continuous') { list.push({ ef, src, ts, group, layer: ef.layer || 6 }); continue; }
            // the older, narrower shapes say the same thing
            if (ef.op === 'anthem') {
              list.push({ layer: 7, ts, src, group, ef: { pt: { p: ef.p, t: ef.t },
                scope: { who: 'you', what: 'creature', other: ef.scope === 'otherYourCreatures' } } });
            } else if (ef.op === 'equipBonus' || ef.op === 'auraBonus') {
              list.push({ layer: 7, ts, src, group, ef: { pt: { p: ef.p, t: ef.t }, scope: { attached: true } } });
            }
          }
        });
      }
      /* An emblem's standing rules ("Creatures you control get +2/+2 and
         have flying") count from the command zone, for as long as the game
         lasts, timestamped as the emblem was made. */
      for (const src of this._emblems()) {
        const a = src.analysis();
        if (!a) continue;
        const ts = this._tsOf(src);
        a.abilities.forEach((ab, ai) => {
          for (const ef of (ab.effects || [])) {
            const parts = ef.op === 'sequence' && Array.isArray(ef.list) ? ef.list : [ef];
            for (const x of parts) if (x.op === 'continuous') list.push({ ef: x, src, ts, group: src.id + '#' + ai, layer: x.layer || 6 });
          }
        });
      }
      /* A few cards work from the graveyard (Anger): their standing rules
         count while they lie there. */
      for (const p of this.players) {
        for (const src of ((this.zones[p.id] || {}).graveyard || [])) {
          const a = src.analysis();
          if (!a) continue;
          a.abilities.forEach((ab, ai) => {
            for (const ef of (ab.effects || [])) {
              if (ef.op === 'continuous' && ef.fromGraveyard) list.push({ ef, src, ts: 0, group: src.id + '#' + ai, layer: ef.layer || 6 });
            }
          });
        }
      }
      list.sort((x, y) => x.ts - y.ts);
      this._contCache = list;
      this._contEpoch = this._boardKey;
      return list;
    }

    /** Does one continuous effect reach this permanent? `oa` is what the permanent is at that layer. */
    _contApplies(entry, o, oa) {
      const sc = entry.ef.scope || {};
      const src = entry.src;
      // "as long as ..." — the bonus is there only while it is true
      if (entry.ef.cond && !this._condMet(entry.ef.cond, { controller: src.controller, obj: src })) return false;
      if (sc.attached) return src.attachedTo === o.id && (!sc.legendary || ((oa || o.analysis() || {}).supertypes || []).includes('Legendary'));
      if (sc.self) {
        if (src.id !== o.id) return false;
        if (sc.whileAttached && !(o.attachments || []).length) return false;
        return true;
      }
      return this._scopeHit(sc, o, oa, src.controller, src, true);
    }

    /**
     * Does an effect from a static ability reach this permanent, all things
     * considered? An effect that began to apply in an earlier layer goes on
     * applying to the same permanents (CR 613.6), even if its source has
     * since lost the ability; one that had not begun does not exist once
     * its source has lost its abilities (Humility on a lord).
     */
    _contReaches(entry, o, oa, lb) {
      if (lb && lb.special) {
        const locked = lb.groupSets.get(entry.group);
        if (locked) return locked.has(o.id);
        const ss = lb.st.get(entry.src.id);
        if (ss && (ss.lost || ss.rulesLost)) return false;
      }
      return this._contApplies(entry, o, oa);
    }

    /* The parts of a continuous effect that belong to layers 4 and 5, and
       the part of 6 that takes every ability away. Any of these anywhere,
       and the whole battlefield is worked out layer by layer. */
    _changesWhatItIs(e) {
      return !!(e && (e.addTypes || e.setTypes || e.addSubtypes || e.setSubtypes || e.setCreatureTypes ||
        e.addChosenType || e.setColors || e.addColors || e.loseAll));
    }

    /** What a permanent printed, and was handed in quotation marks, before the layers. */
    _baseAnalysis(o) {
      const base = o.faceDown ? O.faceDownAnalysis() : O.analyze(o.card, o.face);
      if (!base || o.zone !== 'battlefield') return base;
      return this._dynamicAnalysis(o, base);
    }

    /** What a permanent on the battlefield is, after layers 1 to 6. */
    _layeredAnalysis(o, base) {
      const dyn = this._dynamicAnalysis(o, base);
      if (this._layerBusy) return dyn;
      const lb = this._layerBoard(o);
      if (!lb || !lb.special) return dyn;
      const s = lb.st.get(o.id);
      if (!s || !s.changed) return dyn;
      if (s.a && s.aBase === dyn) return s.a;
      s.a = this._buildLayered(dyn, s);
      s.aBase = dyn;
      return s.a;
    }

    /**
     * Layers 4 to 6 for the whole battlefield, worked out once per board.
     * `special` is false when nothing on the battlefield changes what
     * anything is (the usual case), and then there is nothing else to say.
     */
    _layerBoard(o) {
      const key = this._boardKey;
      const lb = this._lb;
      if (lb && this._lbKey === key) {
        if (!o) return lb;
        const loc = lb.local.get(o.id);
        if (loc === undefined || loc === this._localEpoch(o)) return lb;
      }
      if (this._layerBusy) return null;
      this._layerBusy = true;
      let out;
      try { out = this._computeLayers(); } finally { this._layerBusy = false; }
      this._lb = out;
      this._lbKey = key;
      this._lbGen = (this._lbGen || 0) + 1;
      return out;
    }

    /** Living metal (CR 702.164): a Vehicle that is a creature on its controller's turn. */
    _livingMetalNow(o) {
      return !o.faceDown && !!this.activePlayer && this.activePlayer.id === o.controller &&
        !!((O.analyze(o.card, o.face) || {}).keywordSet || EMPTY_SET).has('living metal');
    }

    _computeLayers() {
      const local = new Map();
      const statics = this._continuous();
      let special = statics.some(x => this._changesWhatItIs(x.ef));
      for (const o of this.battlefield) {
        local.set(o.id, this._localEpoch(o));
        if (special) continue;
        for (const e of (o.effects || [])) if (this._changesWhatItIs(e)) { special = true; break; }
        if (!special && this._livingMetalNow(o)) special = true;
      }
      if (!special) return { special: false, local };

      /* Where each permanent stands as the layers are applied. */
      const st = new Map();
      for (const o of this.battlefield) {
        if (o.phasedOut) continue;
        const base = this._baseAnalysis(o);
        if (!base) continue;
        st.set(o.id, { o, base, types: (base.types || []).slice(), subtypes: (base.subtypes || []).slice(),
          supertypes: (base.supertypes || []).slice(), colors: (base.colors || []).slice(),
          lost: false, loseTs: 0, rulesLost: false, landSet: false, changed: false });
      }
      /* Every part of every effect that changes what something is, with
         the layer it belongs to. A static ability's part reaches whatever
         its words say; an effect a resolution left on a permanent reaches
         that permanent. */
      const parts = [];
      const split = (ef, base) => {
        if (ef.addTypes || ef.setTypes || ef.addSubtypes || ef.setSubtypes || ef.setCreatureTypes || ef.addChosenType) parts.push(Object.assign({ layer: 4 }, base));
        if (ef.setColors || ef.addColors) parts.push(Object.assign({ layer: 5 }, base));
        if (ef.loseAll) parts.push(Object.assign({ layer: 6 }, base));
      };
      for (const x of statics) {
        if (this._changesWhatItIs(x.ef)) split(x.ef, { ef: x.ef, src: x.src, ts: x.ts, group: x.group, entry: x });
      }
      for (const o of this.battlefield) {
        if (!st.has(o.id)) continue;
        (o.effects || []).forEach((e, i) => {
          if (this._changesWhatItIs(e)) split(e, { ef: e, on: o, ts: this._effTs(e, i), group: null });
        });
        if (this._livingMetalNow(o)) parts.push({ layer: 4, ef: { addTypes: ['Creature'] }, on: o, ts: this._tsOf(o), group: null });
      }
      parts.sort((x, y) => x.ts - y.ts);
      const groupSets = new Map();
      for (const layer of [4, 5, 6]) {
        const here = parts.filter(p => p.layer === layer);
        if (!here.length) continue;
        for (const p of (here.length > 1 ? this._dependencyOrder(here, st, groupSets) : here)) this._applyPart(p, st, groupSets, false);
      }
      return { special: true, local, st, groupSets };
    }

    /**
     * The permanents one part reaches, given where everything stands, and
     * whether it exists at all: a static ability's effect is gone once its
     * source has lost its abilities, unless it had already begun to apply.
     */
    _partReach(p, st, groupSets) {
      if (p.on) return { exists: true, ids: st.has(p.on.id) ? [p.on.id] : [] };
      const locked = p.group && groupSets.get(p.group);
      if (locked) return { exists: true, ids: Array.from(locked) };
      const ss = st.get(p.src.id);
      if (ss && (ss.lost || ss.rulesLost)) return { exists: false, ids: [] };
      const ids = [];
      for (const [id, s] of st) {
        if (this._contApplies(p.entry, s.o, this._stateView(s))) ids.push(id);
      }
      return { exists: true, ids };
    }

    /** A permanent part-way through the layers, in the shape the scope words read. */
    _stateView(s) {
      return { types: s.types, subtypes: s.subtypes, supertypes: s.supertypes, colors: s.colors,
        keywordSet: s.lost || s.rulesLost ? EMPTY_SET : (s.base.keywordSet || EMPTY_SET),
        power: s.base.power, toughness: s.base.toughness, name: s.base.name, mv: s.base.mv };
    }

    /** Apply one part of an effect in its layer. A dry run (for dependencies) remembers nothing. */
    _applyPart(p, st, groupSets, dry) {
      const r = this._partReach(p, st, groupSets);
      if (!r.exists) return;
      if (!dry && p.group && !groupSets.has(p.group)) groupSets.set(p.group, new Set(r.ids));
      const e = p.ef;
      for (const id of r.ids) {
        const s = st.get(id);
        if (!s) continue;
        s.changed = true;
        if (p.layer === 4) {
          if (e.setTypes) { s.types = e.setTypes.slice(); this._trimSubtypes(s); }
          if (e.addTypes) for (const t of e.addTypes) if (!s.types.includes(t)) s.types.push(t);
          if (e.setCreatureTypes) s.subtypes = s.subtypes.filter(t => !this._isCreatureType(t)).concat(e.setCreatureTypes);
          if (e.addSubtypes) for (const t of e.addSubtypes) if (!s.subtypes.includes(t)) s.subtypes.push(t);
          if (e.addChosenType && p.src && p.src.chosenType && !s.subtypes.includes(p.src.chosenType)) s.subtypes.push(p.src.chosenType);
          if (e.setSubtypes) {
            /* Setting a land's type (Blood Moon) takes away its old land
               types and every ability its own words gave it (CR 305.7). */
            s.subtypes = s.subtypes.filter(t => !LAND_TYPES.has(t)).concat(e.setSubtypes);
            s.landSet = true;
            s.rulesLost = true;
          }
        } else if (p.layer === 5) {
          if (e.setColors) s.colors = e.setColors.slice();
          if (e.addColors) for (const c of e.addColors) if (!s.colors.includes(c)) s.colors.push(c);
        } else if (p.layer === 6 && e.loseAll) {
          s.lost = true;
          s.loseTs = Math.max(s.loseTs, p.ts);
        }
      }
    }

    /**
     * The order effects in one layer apply (CR 613.8): an effect waits for
     * every effect that would change whether it exists, or what it applies
     * to. Blood Moon goes before Urborg, because Blood Moon takes Urborg's
     * ability away; Opalescence goes after whatever makes more things
     * enchantments. Otherwise, and in a loop, the older goes first.
     */
    _dependencyOrder(list, st, groupSets) {
      const deps = new Map();
      for (const x of list) {
        if (x.on) continue;                       // a resolved effect's reach is fixed
        const before = this._partReach(x, st, groupSets);
        const key0 = before.exists + ':' + before.ids.join(',');
        for (const y of list) {
          if (y === x) continue;
          if (!!x.ef.cda !== !!y.ef.cda) continue; // CR 613.8a(3)
          const copy = new Map();
          for (const [id, s] of st) copy.set(id, Object.assign({}, s, { types: s.types.slice(), subtypes: s.subtypes.slice(), colors: s.colors.slice() }));
          this._applyPart(y, copy, groupSets, true);
          const after = this._partReach(x, copy, groupSets);
          if (after.exists + ':' + after.ids.join(',') !== key0) {
            if (!deps.has(x)) deps.set(x, new Set());
            deps.get(x).add(y);
          }
        }
      }
      const out = [], left = list.slice();
      while (left.length) {
        let pick = left.find(x => !Array.from(deps.get(x) || []).some(y => left.includes(y)));
        if (!pick) pick = left[0];
        out.push(pick);
        left.splice(left.indexOf(pick), 1);
      }
      return out;
    }

    /** Subtypes that only belong with a card type go when the type goes (CR 205.3d). */
    _trimSubtypes(s) {
      const has = (t) => s.types.includes(t);
      s.subtypes = s.subtypes.filter(t => {
        if (LAND_TYPES.has(t)) return has('Land');
        if (ARTIFACT_TYPES.has(t)) return has('Artifact');
        if (ENCHANTMENT_TYPES.has(t)) return has('Enchantment');
        return has('Creature') || has('Kindred');
      });
    }
    _isCreatureType(t) { return !LAND_TYPES.has(t) && !ARTIFACT_TYPES.has(t) && !ENCHANTMENT_TYPES.has(t); }

    /** The printed analysis, with what layers 4 to 6 made of it. */
    _buildLayered(base, s) {
      const out = Object.assign({}, base);
      const has = (t) => s.types.includes(t);
      out.types = s.types.slice();
      out.subtypes = s.subtypes.slice();
      out.supertypes = s.supertypes.slice();
      out.colors = s.colors.slice();
      out.isCreature = has('Creature');
      out.isLand = has('Land');
      out.isArtifact = has('Artifact');
      out.isEnchantment = has('Enchantment');
      out.isPlaneswalker = has('Planeswalker');
      out.isBattle = has('Battle');
      out.isLegendary = out.supertypes.includes('Legendary');
      out.isBasicLand = out.isLand && out.supertypes.includes('Basic');
      out.isAura = out.subtypes.includes('Aura');
      out.isEquipment = out.subtypes.includes('Equipment');
      out.isVehicle = out.subtypes.includes('Vehicle');
      out.isSaga = out.subtypes.includes('Saga');
      out.typeLine = out.supertypes.concat(out.types).join(' ') + (out.subtypes.length ? ' — ' + out.subtypes.join(' ') : '');
      if (s.lost || s.rulesLost) {
        /* Everything it printed is gone. What was handed to it after the
           effect that took its abilities is still there (CR 613.7). */
        const keep = (ab) => !!ab.granted && (!s.lost || (ab.grantTs || 0) > s.loseTs);
        out.abilities = (base.abilities || []).filter(keep);
        out.manaAbilities = (base.manaAbilities || []).filter(keep);
        out.keywords = [];
        out.keywordSet = new Set();
        out.has = (kw) => out.keywordSet.has(String(kw).toLowerCase());
        out.abilitiesLost = true;
      }
      return out;
    }

    /**
     * What a card wants to know about the state of the game before it does
     * something: "if you control three or more artifacts", "if a creature died
     * this turn", "as long as this is untapped". One small vocabulary, used by
     * intervening-if clauses on triggers, by conditional effects, and by
     * continuous effects that only apply some of the time.
     */
    _condMet(cond, ctx) {
      if (!cond) return true;
      if (Array.isArray(cond)) return cond.every(c => this._condMet(c, ctx));
      const me = this.player((ctx && ctx.controller)) || this.activePlayer;
      const src = (ctx && ctx.obj) || null;
      const h = this.turnHistory || {};
      const at = (have) => cond.cmp === 'atMost' ? have <= cond.n : have >= cond.n;
      switch (cond.kind) {
        case 'cityBlessing': return !!me && !!me.cityBlessing;
        case 'completedDungeon': return !!me && (me.dungeonsCompleted || []).length > 0;
        case 'firstCombat': return (this.combatsThisTurn || 1) === 1 && this._combatTurn === this.turn;
        case 'levelRange': {
          if (!src) return false;
          const lv = Number(src.counters.level) || 0;
          if (cond.min != null && lv < cond.min) return false;
          if (cond.max != null && lv > cond.max) return false;
          return true;
        }
        case 'spellsLastTurn': {
          const counts = this.spellsLastTurn || {};
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          if (cond.most) return Object.values(counts).some(v => v >= (cond.n || 2));
          return cond.cmp === 'atMost' ? total <= (cond.n || 0) : total >= (cond.n || 1);
        }
        case 'kicked': {
          const times = (ctx && ctx.kicked) || 0;
          return cond.cmp === 'atMost' ? times <= (cond.n || 0) : times >= (cond.n == null ? 1 : cond.n);
        }
        case 'boughtBack': return !!(ctx && ctx.boughtBack);
        case 'maxSpeed': return !!me && (me.speed || 0) >= 4;
        case 'not': return !this._condMet(cond.cond, ctx);
        case 'selfPower': return !!src && this.powerOf(src) >= (cond.n || 0);
        /* Tannuk: "if this is the second time this ability has resolved this turn" */
        case 'nthResolution': {
          const rec = src && ctx && ctx.abilityIndex != null && (src._resolved || {})[ctx.abilityIndex];
          return !!rec && rec.turn === this.turn && rec.n === cond.n;
        }
        case 'echoDue': return !!src && !!src.echoDue;
        case 'notRenowned': return !!src && !src.renowned;
        case 'saddled': return !!src && src.saddledTurn === this.turn;
        case 'lifeGained': return !!me && me.gainedTurn === this.turn && (me.gained || 0) >= (cond.n || 1);
        case 'graveyardPermanents': return !!me && this.zones[me.id].graveyard.filter(o => (o.analysis() || {}).isPermanent).length >= (cond.n || 1);
        case 'descended': return !!me && me.descendedTurn === this.turn;
        case 'bargained': return !!(ctx && ctx.bargained) || !!(src && src.bargainedTurn != null && src.bargainedTurn === this.turn);
        /* Starting Town: "your first, second, or third turn of the game" */
        case 'earlyTurn': return !!me && (me.turnsTaken || 0) <= (cond.n || 3) && this.activePlayer === me;
        /* Unbreakable Formation's addendum: cast in your main phase */
        case 'castInMain': return !!(ctx && ctx.castInMain);
        /* Tribute to the World Tree: the creature that set it off */
        case 'triggerPower': {
          const x = ctx && ctx.triggerData && this.obj(ctx.triggerData.objectId);
          return !!x && this.powerOf(x) >= (cond.n || 0);
        }
        /* Field of the Dead: lands with different names */
        case 'landNames': {
          if (!me) return false;
          const names = new Set(this.battlefield.filter(o => o.controller === me.id && (o.analysis() || {}).isLand).map(o => o.name));
          return names.size >= (cond.n || 7);
        }
        /* Guardian Project: the creature that arrived shares its name with
           no other creature you control and no creature card in your graveyard */
        case 'triggerNameUnique': {
          const id = ctx && ctx.triggerData && ctx.triggerData.objectId;
          const x = id && this.obj(id);
          if (!x || !me) return false;
          const same = (o) => o !== x && o.name === x.name;
          if (this.battlefield.some(o => o.controller === me.id && (o.analysis() || {}).isCreature && same(o))) return false;
          return !this.zones[me.id].graveyard.some(o => (o.analysis() || {}).isCreature && same(o));
        }
        /* Gift (CR 702.174): the spell on the stack remembers who was
           promised it, and so does the permanent it became. */
        case 'gift': {
          const to = ctx && ctx.gift != null ? ctx.gift : (src ? src.giftTo : null);
          return cond.none ? !to : !!to;
        }
        case 'selfUntapped': return !!src && !src.tapped;
        case 'selfTapped': return !!src && !!src.tapped;
        case 'selfAttacking': return !!src && !!src.attacking;
        case 'yourTurn': return !!me && this.activePlayer && this.activePlayer.id === me.id;
        case 'notYourTurn': return !!me && this.activePlayer && this.activePlayer.id !== me.id;
        case 'control':
          /* a group described the way a static ability describes one
             ("two or more other nontoken Elves you control") is counted the
             same way, from printed characteristics, because a condition on a
             continuous effect is asked while the layers are being worked out */
          if (cond.scope) return !!me && at(this._scopeList(cond.scope, me.id, src, null, true).length);
          return !!me && at(this.countPermanents(me.id, { per: cond.what || 'permanent', who: cond.who || 'you' }));
        case 'controlPower': {
          if (!me) return false;
          return this.battlefield.some(o => o.controller === me.id &&
            (o.analysis() || {}).isCreature && this.powerOf(o) >= (cond.n || 4));
        }
        case 'graveyard': {
          if (!me) return false;
          const z = this.zones[cond.who === 'opponents' ? (this.opponentsOf(me.id)[0] || me).id : me.id];
          const list = (z && z.graveyard) || [];
          return at(cond.what ? list.filter(o => this._matchesCategory(o, cond.what)).length : list.length);
        }
        case 'graveyardTypes': {
          if (!me) return false;
          const seen = new Set();
          for (const o of this.zones[me.id].graveyard) for (const t of ((o.analysis() || {}).types || [])) seen.add(t);
          return seen.size >= (cond.n || 4);
        }
        case 'hand': return !!me && at(this.zones[me.id].hand.length);
        case 'life': return !!me && at(me.life);
        case 'opponentLife':
          return this.opponentsOf(me ? me.id : null).some(p => cond.cmp === 'atMost' ? p.life <= cond.n : p.life >= cond.n);
        case 'opponentMore': {
          if (!me) return false;
          const mine = this.countPermanents(me.id, { per: cond.what || 'land' });
          return this.opponentsOf(me.id).some(p => this.countPermanents(p.id, { per: cond.what || 'land' }) > mine);
        }
        case 'controlNamed': {
          if (!me) return false;
          const want = String(cond.name === 'CARDNAME' && src ? src.name : cond.name).toLowerCase();
          let k = 0;
          for (const o of this.battlefield) {
            if (o.controller !== me.id) continue;
            if (cond.other && src && o.id === src.id) continue;
            if ((o.name || '').toLowerCase() === want) k++;
          }
          return at(k);
        }
        case 'landfall': return !!me && (me.landsPlayed || 0) > 0;
        case 'morbid': return (h.creaturesDied || 0) > 0;
        case 'revolt': return (h.permanentsLeft || 0) > 0;
        case 'raid': return !!h.attacked;
        case 'spellsCast': return !!me && at(me.spellsCastThisTurn || 0);
        /* "If you control a commander": one of your commanders is on the
           battlefield under your control. */
        case 'controlAny':
          return !!me && this.battlefield.some(o => o.controller === me.id &&
            (cond.what || []).some(w => this._matchesCategory(o, w)));
        case 'createdToken': return !!me && me.tokensMadeTurn === this.turn;
        case 'xAtLeast': return ((ctx && (ctx.x || (ctx.obj && ctx.obj.chosenX))) || 0) >= (cond.n || 0);
        case 'totalPower':
          return !!me && this.battlefield.filter(o => o.controller === me.id && !o.phasedOut && this.characteristics(o).isCreature)
            .reduce((t, o) => t + Math.max(0, this.powerOf(o)), 0) >= (cond.n || 0);
        case 'wasCast': return !!src && src.wasCast != null;
        case 'castFromGraveyard': return !!ctx && (ctx.fromZone === 'graveyard');
        case 'selfCounters': {
          if (!src) return false;
          if (cond.counter && cond.cmp === 'atMost') return (Number(src.counters[cond.counter]) || 0) <= (cond.n || 0);
          if (cond.counter) return (Number(src.counters[cond.counter]) || 0) >= (cond.n || 1);
          return Object.values(src.counters || {}).some(v => Number(v) > 0);
        }
        case 'attackedWith': return ((this.turnHistory || {}).attackers || 0) >= (cond.n || 1);
        case 'controlLegend':
          return !!me && this.battlefield.some(o => o.controller === me.id && (o.analysis() || {}).isCreature &&
            ((o.analysis() || {}).supertypes || []).includes('Legendary'));
        case 'controlCommander':
          return !!me && this.battlefield.some(o => o.isCommander && o.controller === me.id && o.owner === me.id);
        case 'opponentSpells':
          return !!me && this.opponentsOf(me.id).some(p => (p.spellsCastThisTurn || 0) >= (cond.n || 1));
        default: return false;     // a condition nobody taught it is not met
      }
    }

    /** A number in a continuous effect, which may be counting something. */
    _contValue(v, o) {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && (v.scope || v.cardsInHand || v.cardsInGraveyard || v.opponents || v.domain)) {
        // counted from inside the layers, so it must not ask for characteristics again
        return this._countValue(v, o.controller, o, true);
      }
      if (typeof v === 'object') {
        if (v.per) return this.countPermanents(o.controller, v) * (v.mult || 1);
        if (v.life) return (this.player(o.controller) || { life: 0 }).life * v.life;
        if (v.posX || v.negX) { const x = o.chosenX || 0; return v.negX ? -x : x; }
      }
      return 0;
    }

    /**
     * The printed analysis of a permanent, with what the board has done to
     * it on top: triggered abilities handed to it in quotation marks ("Until
     * end of turn, target creature gains 'When this creature dies, …'",
     * "Equipped creature has 'Whenever this creature attacks, …'"), and a
     * Theros god that is not a creature while its controller's devotion is
     * short. Granted abilities go after the printed ones, so every printed
     * ability keeps its place in the list.
     */
    _dynamicAnalysis(o, base) {
      if (this._dynBusy) return base;
      const own = (o.effects || []).filter(e => e && (e.grantText || e.grantAbilities));
      const sources = this._grantSources();
      const stationed = base.stationCreatureAt != null && (Number((o.counters || {}).charge) || 0) >= base.stationCreatureAt;
      const waiting = !!base.impending && (Number((o.counters || {}).time) || 0) > 0;
      const proto = !!(o.prototyped && base.prototype);
      if (!own.length && !sources.length && !base.notCreatureUnless && !stationed && !waiting && !proto) return base;
      this._dynBusy = true;
      let texts, stamps, notCreature = false;
      try {
        /* A granted ability is its words, or (from a translated card) the
           ability already written out, carried as JSON. */
        const said = (e) => e.grantText || ('\u0002' + JSON.stringify(e.grantAbilities));
        texts = own.map(said);
        // when each was handed over, so an effect that takes every ability away can tell what came after it
        stamps = own.map(e => (e.ts != null ? e.ts : (this._tsSeq || 0) + 0.5));
        const lb = this._lbKey === this._boardKey && this._lb && this._lb.special ? this._lb : null;
        for (const entry of sources) {
          const ss = lb && lb.st.get(entry.src.id);
          if (ss && (ss.lost || ss.rulesLost)) continue;          // its source has nothing left to hand out
          if (this._contApplies(entry, o, base)) { texts.push(said(entry.ef)); stamps.push(entry.ts); }
        }
        if (base.notCreatureUnless) {
          const want = base.notCreatureUnless;
          notCreature = this._devotionTo(o.controller, want.colors) < want.n;
        }
        if (waiting) notCreature = true;
      } finally { this._dynBusy = false; }
      if (!texts.length && !notCreature && !stationed && !proto) return base;
      const key = base.name + '|' + (notCreature ? 1 : 0) + (stationed ? 's' : '') + (proto ? 'p' : '') + '|' + texts.join('\u0001') + '|' + stamps.join(',');
      if (o._dynKey === key && o._dynBase === base) return o._dyn;
      const out = Object.assign({}, base);
      if (notCreature) {
        out.types = (base.types || []).filter(t => t !== 'Creature');
        out.isCreature = false;
      }
      if (stationed && !notCreature) {
        out.types = (base.types || []).concat('Creature');
        out.isCreature = true;
      }
      if (proto) {
        out.power = base.prototype.power;
        out.toughness = base.prototype.toughness;
        out.manaCost = base.prototype.cost;
        out.colors = MANA.COLORS.filter(c => base.prototype.cost.includes(c));
      }
      if (texts.length) {
        const extra = [];
        texts.forEach((t, i) => {
          if (t[0] === '\u0002') {
            // written out: triggered and activated abilities alike
            for (const ab of JSON.parse(t.slice(1))) if (ab.kind === 'triggered' || ab.kind === 'activated') extra.push(Object.assign({}, ab, { granted: true, grantTs: stamps[i] }));
            return;
          }
          const ga = O.analyze({ id: 'granted:' + U.hash(t), name: 'Granted', type_line: 'Creature', oracle_text: t, keywords: [], layout: 'token' });
          // words: triggered abilities, and activated ones ("has '{T}: Draw a card'")
          for (const ab of ((ga && ga.abilities) || [])) if (ab.kind === 'triggered' || ab.kind === 'activated') extra.push(Object.assign({}, ab, { granted: true, grantTs: stamps[i] }));
        });
        out.abilities = base.abilities.concat(extra);
      }
      o._dyn = out; o._dynKey = key; o._dynBase = base;
      return out;
    }
    /** Every static ability on the battlefield that hands out a quoted triggered ability. */
    _grantSources() {
      if (this._grantCache && this._grantEpoch === this._boardKey) return this._grantCache;
      const list = [];
      for (const src of this.battlefield) {
        if (src.phasedOut) continue;
        const a = O.analyze(src.card, src.face);
        if (!a || src.faceDown) continue;
        const ts = this._tsOf(src);
        for (const ab of a.abilities) for (const ef of (ab.effects || [])) {
          const parts = ef.op === 'sequence' ? (ef.list || []) : [ef];
          for (const x of parts) if (x.op === 'continuous' && (x.grantText || x.grantAbilities)) list.push({ ef: x, src, ts, layer: 6 });
        }
      }
      this._grantCache = list;
      this._grantEpoch = this._boardKey;
      return list;
    }
    /** Devotion to one colour or to two at once (a pip of either counts once). */
    _devotionTo(pid, colors) {
      let k = 0;
      for (const o of this.battlefield) {
        if (o.controller !== pid || o.faceDown) continue;
        const a = O.analyze(o.card, o.face);
        if (!a) continue;
        for (const sym of MANA.parse(a.manaCost || '')) if (colors.some(c => sym.includes(c))) k++;
      }
      return k;
    }

    /**
     * What this permanent is right now: its power and toughness after every
     * layer, and every keyword it has printed or been given. Computed in one
     * place so nothing can disagree with anything else.
     *
     * Layers 1 to 5, and what layer 6 takes away wholesale, are already in
     * its analysis (_layeredAnalysis). Here are the rest of layer 6 (abilities
     * granted and lost, oldest first, and nothing granted before an effect
     * that took every ability away) and layer 7: 7a power and toughness a
     * card defines for itself, 7b effects that set it, 7c effects that
     * modify it and its +1/+1 and -1/-1 counters, 7d effects that switch it.
     */
    characteristics(o) {
      if (!o) return null;
      const a = o.analysis();
      if (!a) return null;
      const lb = o.zone === 'battlefield' && !this._layerBusy ? this._layerBoard(o) : null;
      if (o._chr && o._chrEpoch === this._boardKey && o._chrLocal === this._localEpoch(o) && o._chrGen === this._lbGen) return o._chr;
      const s = lb && lb.special ? lb.st.get(o.id) : null;
      const loseTs = s && s.lost ? s.loseTs : -Infinity;

      const kw = new Set(a.keywordSet || []);
      const flags = new Set();
      let p = parseInt(a.power, 10); if (isNaN(p)) p = 0;
      let t = parseInt(a.toughness, 10); if (isNaN(t)) t = 0;
      const six = [], defining = [], setting = [], modifying = [];
      let switches = 0;
      const grantMana = [];

      const statics = this._continuous();
      for (let i = 0; i < statics.length; i++) {
        const entry = statics[i];
        const ef = entry.ef;
        if (!(ef.grant || ef.lose || ef.flag || ef.grantMana || ef.setPt || ef.pt || ef.switchPt)) continue;
        if (!this._contReaches(entry, o, a, lb)) continue;
        if (ef.grant || ef.lose || ef.flag || ef.grantMana) six.push({ ts: entry.ts, grant: ef.grant, lose: ef.lose, flag: ef.flag, grantMana: ef.grantMana });
        if (ef.setPt) (ef.cda ? defining : setting).push({ ts: entry.ts, set: ef.setPt });
        if (ef.pt) modifying.push(ef.pt);
        if (ef.switchPt) switches++;
      }
      (o.effects || []).forEach((e, i) => {
        if (!e) return;
        const ts = this._effTs(e, i);
        if (e.keywords || e.loseKeywords || e.flag) six.push({ ts, grant: e.keywords, lose: e.loseKeywords, flag: e.flag });
        if (e.setPt) setting.push({ ts, set: e.setPt });
        if (e.p || e.t) modifying.push({ p: e.p, t: e.t });
        if (e.switchPt) switches++;
      });

      // layer 6, oldest first
      if (six.length > 1) six.sort((x, y) => x.ts - y.ts);
      for (const x of six) {
        /* A rule laid on it from outside (Pacifism's "can't attack or
           block") is not an ability of its own, and survives Humility. */
        if (x.flag) flags.add(x.flag);
        if (x.ts < loseTs) continue;
        if (x.grant) for (const k of x.grant) kw.add(String(k).toLowerCase());
        if (x.lose) for (const k of x.lose) kw.delete(String(k).toLowerCase());
        if (x.grantMana) grantMana.push(...x.grantMana);
      }

      // layer 7a, then 7b, each oldest first
      const setTo = (x) => {
        const sp = x.set;
        if (sp.mv) { p = t = Number(a.mv) || 0; return; }      // "equal to its mana value" (Opalescence)
        const np = sp.p == null ? p : this._contValue(sp.p, o);
        const nt = sp.keepToughness || sp.t == null ? t : this._contValue(sp.t, o);
        p = np; t = nt + (sp.tPlus || 0);
      };
      if (defining.length) { defining.sort((x, y) => x.ts - y.ts); defining.forEach(setTo); }
      if (setting.length) { setting.sort((x, y) => x.ts - y.ts); setting.forEach(setTo); }
      // layer 7c: effects that modify, and counters
      for (const m of modifying) {
        if (m.p) p += this._contValue(m.p, o);
        if (m.t) t += this._contValue(m.t, o);
      }
      const plus = Number(o.counters['+1/+1']) || 0, minus = Number(o.counters['-1/-1']) || 0;
      p += plus - minus; t += plus - minus;
      // layer 7d: switching, an odd number of times
      if (switches % 2) { const x = p; p = t; t = x; }

      /* Land types the layers gave it, and whether they replaced its own
         (Blood Moon): the mana abilities that come with them (CR 305.6). */
      let setMana = null, setSubtypes = null;
      const addSubtypes = [];
      if (s && s.changed && a.isLand) {
        const basics = (a.subtypes || []).filter(x => MANA.COLOR_OF_BASIC[x]);
        if (s.landSet) { setSubtypes = basics; setMana = basics.map(x => MANA.COLOR_OF_BASIC[x]); }
        else {
          const printed = new Set((s.base.subtypes || []));
          for (const x of basics) if (!printed.has(x)) addSubtypes.push(x);
        }
      }

      const res = { power: Number.isFinite(p) ? p : 0, toughness: Number.isFinite(t) ? t : 0,
        keywords: kw, flags, addSubtypes, setSubtypes, setMana, grantMana,
        // card types the layers gave it beyond its own (an animated land is a creature)
        addTypes: s && s.changed ? (a.types || []).filter(x => !(s.base.types || []).includes(x)) : [],
        abilitiesLost: !!(s && s.lost),
        // bestowed and attached, it is an Aura rather than a creature
        isCreature: !!a.isCreature && !(o.bestowed && o.attachedTo) };
      // worked out while a granted ability was being looked up, it is only half the answer
      if (this._dynBusy || this._layerBusy) return res;
      o._chr = res;
      o._chrEpoch = this._boardKey;
      o._chrLocal = this._localEpoch(o);
      o._chrGen = this._lbGen;
      return res;
    }

    /** A cheap fingerprint of the state that only belongs to this permanent. */
    _localEpoch(o) {
      let k = (o.effects || []).length * 31;
      for (const key in o.counters) k += (Number(o.counters[key]) || 0) * 7 + key.length;
      return k + (o.attachments || []).length * 3 + (o.face || 0) * 5 + (o.faceDown ? 2 : 0);
    }

    /** Something changed on the battlefield: recompute rather than remember. */
    bumpBoard() { this._boardEpoch = (this._boardEpoch || 0) + 1; }

    /** What the cached characteristics were computed against. */
    get _boardKey() { return (this._boardEpoch || 0) * 4096 + this.battlefield.length; }

    powerOf(o) { const c = this.characteristics(o); return c ? c.power : 0; }
    toughnessOf(o) { const c = this.characteristics(o); return c ? c.toughness : 0; }
    loyaltyOf(o) { return o.counters.loyalty || 0; }

    /* ---------- damage & life ---------- */
    dealDamageToObject(o, amount, source, isCombat) {
      if (amount <= 0) return 0;
      amount = this._damageAmount(amount, source, o.controller, isCombat);
      if (this._damagePrevented(o, isCombat)) { this.logEvent('damage', `Damage to ${o.name} is prevented.`); return; }
      if (o.preventShield) {
        const soak = Math.min(o.preventShield, amount);
        o.preventShield -= soak; amount -= soak;
        this.logEvent('damage', `${soak} damage to ${o.name} is prevented.`);
        if (amount <= 0) return;
      }
      const a = o.analysis();
      if (a && source && this._protectedFrom(o, source)) return;
      this._evDamage(source, { kind: 'object', id: o.id }, amount, isCombat);
      if (a && a.isPlaneswalker) { this.addCounters(o, 'loyalty', -amount); this.logEvent('damage', `${o.name} loses ${amount} loyalty.`); return; }
      if (a && a.isBattle) { this.addCounters(o, 'defense', -amount); return; }
      // wither and infect (CR 702.80, 702.90): damage to a creature is -1/-1 counters
      if (source && (this.hasKw(source, 'wither') || this.hasKw(source, 'infect'))) this.addCounters(o, '-1/-1', amount);
      else o.damage += amount;
      // "target creature that was dealt damage this turn", until the cleanup step
      o.damagedThisTurn = true;
      // "a creature dealt damage by this creature this turn": who hit it, and when
      if (source) {
        if (!o._damagedBy || o._damagedBy.turn !== this.turn) o._damagedBy = { turn: this.turn, ids: [] };
        if (!o._damagedBy.ids.includes(source.id)) o._damagedBy.ids.push(source.id);
      }
      this._lastDamageDealt = (this._lastDamageDealt || 0) + amount;
      if (source && this.hasKw(source, 'deathtouch')) o.dealtDeathtouch = true;
      if (source && source.zone === 'battlefield') this._fire('dealsDamage', source.controller, { source, object: source, amount, combat: !!isCombat });
      // "whenever this creature deals damage to a creature": the creature it hit is what the trigger is about
      if (source && source.zone === 'battlefield' && a && a.isCreature) this._fire('dealsDamageToCreature', source.controller, { source, object: o, amount, combat: !!isCombat });
      // "Whenever this creature is dealt damage" (enrage): the creature's own trigger
      this._fire('isDealtDamage', o.controller, { source: o, object: o, amount, combat: !!isCombat });
      this.logEvent('damage', `${source ? source.name : 'Something'} deals ${amount} to ${o.name}.`);
      this.emit('sfx', 'damage', { player: o.controller, size: amount });
      this.emit('damage', { object: o, amount, source });
      return amount;
    }

    /* Fiery Emancipation, Torbran, Gratuitous Violence: what a source
       deals, after anything that doubles or adds to it. */
    _damageAmount(amount, source, victimController, combat) {
      if (!source) return amount;
      const ev = this._replace({ kind: 'damage', n: amount, controller: source.controller, source, victimController, combat: !!combat });
      return Math.max(0, ev.n);
    }

    dealDamageToPlayer(p, amount, source, combat) {
      if (!p || amount <= 0) return 0;
      amount = this._damageAmount(amount, source, p.id, combat);
      if (this._protected(p)) { this.logEvent('damage', `Damage to ${p.name} is prevented (protection from everything).`); return; }
      if (this._damagePrevented(p, combat)) { this.logEvent('damage', `Damage to ${p.name} is prevented.`); return; }
      if (p.preventShield) {
        const soak = Math.min(p.preventShield, amount);
        p.preventShield -= soak; amount -= soak;
        this.logEvent('damage', `${soak} damage to ${p.name} is prevented.`);
        if (amount <= 0) return;
      }
      this._evDamage(source, { kind: 'player', id: p.id }, amount, combat);
      if (source && this.hasKw(source, 'infect')) { this.addPoison(p, amount); return amount; }
      /* Damage to a player is life lost: the same replacements apply
         (Bloodletter of Aclazotz), and it raises the attacker's speed. */
      const lossEv = this._replace({ kind: 'loseLife', n: amount, controller: p.id });
      const lost = lossEv.cancelled ? 0 : lossEv.n;
      this._speedUp(p);
      p.life -= lost;
      p.lifeLostThisTurn = (p.lifeLostThisTurn || 0) + amount;
      this._lastDamageDealt = (this._lastDamageDealt || 0) + amount;
      this.logEvent('damage', `${source ? source.name : 'Something'} deals ${amount} to ${p.name} (${p.life} life).`);
      if (source && source.zone === 'battlefield') this._fire('dealsDamage', source.controller, { source, object: source, amount, combat: !!combat, player: p.id });
      if (source && (source.attachments || []).length) {
        this._fire('equippedDealsDamage', null, { object: source, attachedIds: source.attachments.slice(), player: p.id, amount });
      }
      this._fire('opponentLosesLife', null, { except: p.id, player: p.id, amount });
      this._fire('playerDealtDamage', null, { player: p.id, amount, combat: !!combat });
      if (combat && source && source.isCommander) {
        p.commanderDamage[source.id] = (p.commanderDamage[source.id] || 0) + amount;
        this.logEvent('commander', `${p.name} has taken ${p.commanderDamage[source.id]} commander damage from ${source.name}.`);
      }
      this.emit('sfx', 'life_loss', { player: p.id, size: amount });
      this.emit('life', { player: p, delta: -amount });
      return amount;
    }
    changeLife(pid, delta, reason) {
      const p = typeof pid === 'string' ? this.player(pid) : pid;
      delta = Math.trunc(Number(delta)) || 0;
      if (!p || !delta) return;
      // Teferi's Protection: "your life total can't change"
      if (p.lifeLocked && p.lifeLocked.until === p.id && this._protectionLive(p.lifeLocked)) {
        this.logEvent('life', `${p.name}'s life total can't change.`);
        return;
      }
      /* "If an opponent would lose life during your turn, they lose twice
         that much life instead." */
      if (delta < 0 && reason !== 'cost') {
        const ev = this._replace({ kind: 'loseLife', n: -delta, controller: p.id });
        if (ev.cancelled) return;
        delta = -ev.n;
      }
      /* Speed (CR 702.179): an opponent losing life during your turn
         raises it, once a turn, up to four. */
      if (delta < 0 && !this._lifeLockedFor(p)) this._speedUp(p);
      /* "Players can't gain life" stops the gain before it happens. */
      if (delta > 0 && !this._lifeGainStopped(p)) {
        p.gained = p.gainedTurn === this.turn ? (p.gained || 0) : 0;
        p.gainedTurn = this.turn;
      }
      if (delta > 0 && this._lifeGainStopped(p)) {
        this.logEvent('life', `${p.name} can't gain life.`);
        return;
      }
      if (delta > 0) {
        const ev = this._replace({ kind: 'gainLife', n: delta, controller: p.id });
        if (ev.cancelled) return;
        delta = ev.n;
        p.gained = (p.gained || 0) + delta;      // "if you gained 3 or more life this turn"
      }
      p.life += delta;
      if (delta < 0) {
        this._lastLifeLost = (this._lastLifeLost || 0) + (-delta);
        p.lifeLostThisTurn = (p.lifeLostThisTurn || 0) + (-delta);
        this._fire('opponentLosesLife', null, { except: p.id, player: p.id, amount: -delta });
      } else p.lifeGainedThisTurn = (p.lifeGainedThisTurn || 0) + delta;
      this.logEvent('life', `${p.name} ${delta > 0 ? 'gains' : 'loses'} ${Math.abs(delta)} life (${p.life}).`);
      this.emit('sfx', delta > 0 ? 'life_gain' : 'life_loss', { player: p.id, size: Math.abs(delta) });
      this.emit('life', { player: p, delta });
      if (delta > 0) this._fire('youGainLife', p.id, { amount: delta, player: p.id });
    }
    /** Is anything on the table stopping this player from gaining life? */
    _lifeGainStopped(p) {
      for (const o of this.battlefield) {
        const e = this._staticOp(o, 'noLifeGain');
        if (!e) continue;
        if (e.who === 'opponents' && o.controller === p.id) continue;
        return true;
      }
      return false;
    }

    addPoison(p, n) {
      p.poison += n;
      this.logEvent('poison', `${p.name} gets ${n} poison counter${n === 1 ? '' : 's'} (${p.poison}).`);
    }
    addCounters(o, kind, n, opts) {
      n = Math.trunc(Number(n)) || 0;
      if (!n) return;
      if (n > 0 && !(opts && opts.noReplace)) {
        const ev = this._replace({ kind: 'counters', object: o, n, counter: kind, controller: o.controller });
        if (ev.cancelled) return;
        if (ev.cancelled) return;
        n = ev.n;
      }
      this.bumpBoard();
      o.counters[kind] = (Number(o.counters[kind]) || 0) + n;
      if (o.counters[kind] <= 0 && kind !== 'loyalty' && kind !== 'defense') delete o.counters[kind];
      // "Whenever one or more +1/+1 counters are put on this creature"
      if (n > 0 && o.zone === 'battlefield') this._fire('countersPut', null, { object: o, source: o, objController: o.controller, kind, amount: n });
      this.emit('sfx', n > 0 ? 'counter_add' : 'counter_remove', { player: o.controller, size: Math.abs(n) });
      this.emit('counters', { object: o, kind, n });
    }

    /* ---------- zones ---------- */
    _removeFromZone(o) {
      if (o.zone === 'battlefield') {
        const i = this.battlefield.indexOf(o);
        if (i >= 0) this.battlefield.splice(i, 1);
        // detach
        for (const aid of o.attachments.slice()) { const at = this.obj(aid); if (at) at.attachedTo = null; }
        o.attachments = [];
        if (o.attachedTo) {
          const host = this.obj(o.attachedTo);
          if (host) host.attachments = host.attachments.filter(x => x !== o.id);
          o.lastAttachedTo = o.attachedTo;
          o.attachedTo = null;
        }
      } else if (o.zone === 'stack') {
        const i = this.stack.findIndex(s => s.objId === o.id);
        if (i >= 0) this.stack.splice(i, 1);
      } else {
        const z = this.zones[o.owner];
        if (z && z[o.zone]) {
          const i = z[o.zone].indexOf(o);
          if (i >= 0) z[o.zone].splice(i, 1);
        }
      }
    }

    moveObject(o, toZone, opts) {
      opts = opts || {};
      if (!o) return;
      const from = o.zone;
      // "if a card would be put into a graveyard, exile it instead" and friends
      let markCounter = null;
      if (!opts.noReplace) {
        const ev = this._replace({ kind: 'zoneChange', object: o, from, zone: toZone,
          controller: o.controller || o.owner });
        if (ev.cancelled) return o;
        toZone = ev.zone;
        markCounter = ev.withCounter || null;
        // Blightsteel Colossus, Nexus of Fate: shuffled back in, from anywhere
        if (toZone === 'graveyard') {
          const own = o.analysis();
          if (own && own.abilities.some(ab => (ab.effects || []).some(x => x && x.op === 'shuffleInsteadOfGrave'))) {
            toZone = 'library'; o._shuffleIn = true;
          }
          /* A finality counter (CR 122.1h): a permanent with one on it that
             would go to the graveyard from the battlefield is exiled. */
          if (from === 'battlefield' && toZone === 'graveyard' && (Number((o.counters || {}).finality) || 0) > 0) toZone = 'exile';
        }
      }
      /* A mutated pile is several cards; each of them goes where the
         permanent went (CR 702.140f). */
      if (from === 'battlefield' && toZone !== 'battlefield' && o.mutateCards) {
        this._unmutate(o, toZone);
      }
      /* A clone is only a copy while it is on the battlefield; anywhere
         else it is the card that was printed (CR 707.2). */
      // what it was as it left, for "if it was a creature" afterwards
      if (from === 'battlefield' && toZone !== 'battlefield') {
        /* What it was as it left, abilities and all (CR 603.10): a
           creature that was handed "When this creature dies, …" still has
           it when the trigger looks back, and a copy dies as the copy. */
        const was = o.analysis();
        o._lkiAnalysis = was !== O.analyze(o.card, o.face) || o.printedCard ? was : null;
        const lc = this.characteristics(o);
        o._leftAsCreature = !!(lc && lc.isCreature);
        // its power as it last existed, for "equal to its power" after it has gone
        o._lastPower = lc ? lc.power : 0;
        o._lastToughness = lc ? lc.toughness : 0;
      }
      if (from === 'battlefield' && toZone !== 'battlefield' && o.printedCard) {
        o.card = o.printedCard; o.printedCard = null; o.copyOf = null; o._chr = null;
      }
      // commander replacement effect (CR 903.9)
      if (o.isCommander && ['graveyard', 'exile', 'hand', 'library'].includes(toZone) && from === 'battlefield') {
        if (MTG.settings.commanderToZone !== false) toZone = 'command';
      }
      if (from === 'battlefield' && toZone !== 'battlefield') {
        const wasA = o.analysis();
        const h = this.turnHistory || (this.turnHistory = { creaturesDied: 0, permanentsLeft: 0, attacked: false });
        h.permanentsLeft++;
        if (wasA && wasA.isCreature && toZone === 'graveyard') h.creaturesDied++;
      }
      // what it was wearing, for "whenever equipped creature dies"
      const heldBy = from === 'battlefield' ? (o.attachments || []).slice() : [];
      this._removeFromZone(o);
      this.bumpBoard();
      o.zone = toZone;

      // reset per-zone state
      /* Who controlled it as it left matters to anything watching ("a
         creature you control dies"), so it is taken before the reset. */
      const lastCtrl = o.controller;
      /* A token that leaves the battlefield still dies, or still leaves —
         everything watching for that sees it go — and then ceases to exist
         (CR 111.7), so it is never filed in the zone it was sent to. */
      const vanishes = o.isToken && from === 'battlefield' && toZone !== 'battlefield';
      const comesBack = from === 'battlefield' && toZone === 'graveyard' && !vanishes &&
        (o.effects || []).find(e => e.returnOnDeath);
      if (toZone !== 'battlefield') {
        if (!opts.fromStack) o.wasCast = null;
        if (toZone !== 'stack' && from === 'battlefield' && o.card.card_faces && o.card.layout !== 'split') o.face = 0;
        o._diedCounters = Object.assign({}, o.counters);
        o.tapped = false; o.damage = 0; o.counters = {};
        o.effects = []; o.attacking = null; o.blocking = []; o.blockedBy = [];
        o.shields = 0; o.preventShield = 0; o.noUntapNext = false; o.goadedBy = null;
        o.summoningSick = true; o.activatedLoyaltyThisTurn = false;
        o.faceDown = false; o.controller = o.owner; o.giftTo = null; o.prototyped = false;
        // a new object (CR 400.7): no control effect, no copy, no timestamp of its own yet
        o.ctlBase = null; o.copyBefore = null; o.copyUntilTurn = null; o.ts = null;
        o.encoded = null;                // cipher: a new object remembers nothing encoded on the old one
        if (vanishes) this.emit('object:gone', o);
      }

      if (toZone === 'battlefield') {
        if (!opts.fromStack) o.wasCast = null;
        o._lkiAnalysis = null;
        if (o._impendingN) { o.counters.time = o._impendingN; o._impendingN = 0; }
        /* A daybound permanent makes it day if it is neither, and arrives
           as its night side if it is night (CR 702.145d). */
        if (o.card.card_faces && o.card.card_faces.length > 1 && !o.faceDown && o.face === 0) {
          const ks = (O.analyze(o.card, 0) || {}).keywordSet;
          if (ks && ks.has('daybound')) {
            if (this.isDay === undefined || this.isDay === null) this.setDayNight(true, o.name);
            else if (!this.isDay) o.face = 1;
          }
        }
        o.echoDue = true;
        o.renowned = false;
        o.controller = opts.controller || o.controller || o.owner;
        o.entered = this.turn;
        o.summoningSick = true;
        o.damage = 0;
        o.ts = this._stampNew();      // its timestamp (CR 613.7d)
        this.battlefield.push(o);
        const a = o.analysis();
        if (a) {
          if (a.entersTapped || a.abilities.some(x => (x.effects || []).some(e => e.op === 'etbTapped'))) o.tapped = true;
          // "This creature enters prepared."
          o.prepared = a.abilities.some(x => (x.effects || []).some(e => e.op === 'etbPrepared'));
          // Thalia, Blind Obedience: tapped, whatever the land itself offers
          const entEv = this._replace({ kind: 'enters', object: o, controller: o.controller });
          o._forcedTapped = !!entEv.tapped;
          // Spelunking: "Lands you control enter untapped"
          o._keepUntapped = !!entEv.untapped && !o._forcedTapped;
          if (o._keepUntapped) o.tapped = false;
          if (o._forcedTapped) o.tapped = true;
          if (a.isPlaneswalker) o.counters.loyalty = parseInt(a.loyalty, 10) || 0;
          if (a.isBattle) o.counters.defense = parseInt(a.defense, 10) || 0;
          // a Saga arrives with its first chapter already counted (CR 714.2)
          if (a.isSaga) { o.counters.lore = 0; this._advanceSaga(o, 1); }
        }
        // replacement effects (counters it enters with, riot) and evolve
        this._onEnter(o);
        this.emit('sfx', o.isToken ? 'token' : 'play_card', { player: o.controller });
        this._fireEnters(o);
      } else if (toZone === 'graveyard') {
        if (!vanishes) this.zones[o.owner].graveyard.push(o);
        if (from === 'battlefield') {
          this.emit('sfx', 'destroy');
          this._onDeath(o, o);
          this._fire('dies', lastCtrl, { object: o, source: o });
          const a = o.analysis();
          if (a && a.isCreature) {
            this._fire('anyCreatureDies', null, { object: o });
            this._fire('yourCreatureDies', lastCtrl, { object: o });
            for (const p of this.players) {
              if (p.id === lastCtrl || p.hasLost) continue;
              this._fire('opponentCreatureDies', p.id, { object: o, deadController: lastCtrl });
            }
          }
          this._fire('permDies', null, { object: o, objController: lastCtrl });
          if (comesBack) {
            this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, controller: lastCtrl,
              name: `${o.name} \u2014 return it to the battlefield`, auto: true, abilityText: 'Return it to the battlefield',
              effects: [{ op: 'returnSelfFromGrave', tapped: comesBack.returnOnDeath === 'tapped' }] });
          }
          if (heldBy.length) this._fire('equippedDies', null, { object: o, attachedIds: heldBy, objController: lastCtrl });
        }
      } else if (vanishes) {
        // gone, wherever it was sent
      } else if (toZone === 'hand') this.zones[o.owner].hand.push(o);
      else if (toZone === 'exile') { this.zones[o.owner].exile.push(o); if (from === 'battlefield') this.emit('sfx', 'exile', { player: o.owner }); }
      else if (toZone === 'command') this.zones[o.owner].command.push(o);
      else if (toZone === 'library') {
        const z = this.zones[o.owner].library;
        if (opts.toBottom) z.push(o); else z.unshift(o);
      }

      if (from === 'battlefield' && toZone !== 'battlefield') {
        // whatever this permanent was holding in exile comes back (CR 610.3)
        this._releaseExiled(o);
        this._fire('ltb', lastCtrl, { object: o, source: o });
        this._lastLeft = o.id;
        this._fire('permLeaves', null, { object: o, objController: lastCtrl, toZone });
      }
      if (toZone === 'graveyard' && from !== 'battlefield') this._fire('cardToGraveyard', null, { object: o, objController: o.owner });
      // "if you descended this turn": a permanent card went to your graveyard
      if (toZone === 'graveyard' && !o.isToken && (o.analysis() || {}).isPermanent) {
        const own = this.player(o.owner);
        if (own) own.descendedTurn = this.turn;
      }
      /* "When this is put into a graveyard from anywhere": the card's own
         trigger, from wherever it came. */
      if (toZone === 'graveyard' && !o.isToken) {
        const ga = o.analysis();
        (ga ? ga.abilities : []).forEach((ab, i) => {
          if (ab.kind !== 'triggered' || ab.event !== 'selfToGraveyard') return;
          this.pendingTriggers.push({
            id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: i,
            controller: o.owner, name: `${o.name} \u2014 ${truncate(MTG.oracle.abilityLabel(ab), 50)}`,
            effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab), optional: ab.optional,
            triggerData: { event: 'selfToGraveyard', objectId: o.id },
          });
        });
      }
      if (from === 'graveyard' && toZone !== 'graveyard') this._fire('leftGraveyard', null, { object: o, objController: o.owner });
      if (o._shuffleIn) {
        o._shuffleIn = false;
        this.rng.shuffle(this.zones[o.owner].library);
        this.logEvent('zone', `${o.name} is revealed and shuffled into its owner's library.`);
      }
      // "instead exile it with a void counter on it"
      if (markCounter && o.zone === toZone) o.counters[markCounter] = (Number(o.counters[markCounter]) || 0) + 1;
      this.emit('zone:change', { object: o, from, to: toZone });
      return o;
    }

    /**
     * Everything that watches for a permanent arriving, told that one has.
     * Cast, put, created or copied, it is the same arrival, so every road
     * onto the battlefield comes through here.
     */
    _fireEnters(o) {
      const a = o.analysis();
      this._fire('etb', o.controller, { object: o, source: o });
      if (a && a.isCreature) {
        this._fire('anyCreatureEtb', o.controller, { object: o });
        this._fire('yourCreatureEtb', o.controller, { object: o });
        this._fire('otherCreatureEtb', o.controller, { object: o, except: o.id });
      }
      this._fire('yourPermanentEtb', o.controller, { object: o });
      if (a && a.isLand) this._fire('landfall', o.controller, { object: o });
      this._fire('permEnters', null, { object: o, objController: o.controller });
    }

    _drawCards(p, n, silent) {
      const z = this.zones[p.id];
      for (let i = 0; i < n; i++) {
        if (!z.library.length) {
          // Laboratory Maniac: the draw that would lose wins instead
          if (this.battlefield.some(x => x.controller === p.id && !x.phasedOut && this._staticOp(x, 'winOnEmptyDraw'))) {
            this.logEvent('rules', `${p.name} would draw from an empty library, and wins the game instead.`);
            for (const q of this.opponentsOf(p.id)) this.playerLoses(q, 'an opponent drew from an empty library with a card that wins');
            break;
          }
          p.drewFromEmpty = true; this.logEvent('draw', `${p.name} tried to draw from an empty library.`); break;
        }
        const o = z.library.shift();
        o.zone = 'hand';
        z.hand.push(o);
        p.drawnThisTurn = (p.drawnThisTurn || 0) + 1;
        if (!silent) {
          this._fire('youDraw', p.id, { object: o, nth: p.drawnThisTurn });
          for (const other of this.players) {
            if (other.id === p.id || other.hasLost) continue;
            this._fire('opponentDraw', other.id, { object: o, drawer: p.id, nth: p.drawnThisTurn,
              inDrawStep: this.step === 'draw' && this.activePlayer && this.activePlayer.id === p.id });
          }
        }
      }
      if (!silent) {
        this.logEvent('draw', `${p.name} draws ${n} card${n === 1 ? '' : 's'}.`);
        this.emit('sfx', 'draw');
      }
      this.emit('draw', { player: p, n });
    }
    drawCards(pid, n) { this._drawCards(this.player(pid), n); this.checkStateBasedActions(); this.touch(); }

    /* ---------- Sagas (CR 714) ----------
       A Saga counts its chapters with lore counters: one when it arrives, one
       at the start of its controller's precombat main phase, and each chapter
       it reaches puts its ability on the stack. When it runs out of chapters
       it is sacrificed. */

    /** Put `n` lore counters on a Saga and fire whatever chapters that reaches. */
    _advanceSaga(o, n) {
      const a = o.analysis();
      if (!a || !a.isSaga) return;
      const before = o.counters.lore || 0;
      const after = before + (n || 1);
      o.counters.lore = after;
      this.bumpBoard();
      for (const ab of a.abilities) {
        if (ab.kind !== 'chapter') continue;
        for (const c of (ab.chapters || [])) {
          if (c <= before || c > after) continue;
          this.pendingTriggers.push({
            id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: -1,
            controller: o.controller, name: `${o.name} — ${truncate(MTG.oracle.abilityLabel(ab), 50)}`,
            effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab),
          });
        }
      }
      if (this.pendingTriggers.length) this.emit('sfx', 'trigger');
      this.logEvent('saga', `${o.name} reaches chapter ${after}.`);
    }

    /** The final chapter having resolved, the Saga goes away (CR 714.4). */
    _sagaCleanup() {
      for (const o of this.battlefield.slice()) {
        const a = o.analysis();
        if (!a || !a.isSaga) continue;
        const last = Math.max(0, ...a.abilities
          .filter(x => x.kind === 'chapter')
          .flatMap(x => x.chapters || []));
        if (!last) continue;
        if ((o.counters.lore || 0) < last) continue;
        if (this.pendingTriggers.some(t => t.objId === o.id)) continue;
        if (this.stack.some(t => t.objId === o.id)) continue;
        this.moveObject(o, 'graveyard');
        this.logEvent('saga', `${o.name} is sacrificed, its story told.`);
      }
    }

    /* ---------- delayed triggered abilities (CR 603.7) ----------
       "Sacrifice it at the beginning of the next end step" sets something up
       now that happens later, once. It is not an ability of any permanent —
       the game itself is holding the note — so it lives here rather than on a
       card, and it survives the card leaving the battlefield. */

    /**
     * Leave a note for later. `once` is the normal case: the trigger goes off
     * the first time its event comes round and is then forgotten.
     */
    scheduleDelayed(spec) {
      this.delayedTriggers.push(Object.assign({
        id: this._uid('dt'), once: true, createdTurn: this.turn,
      }, spec));
    }

    /** Fire and clear any delayed triggers waiting on this event. */
    /* ---------- emblems (CR 114) ----------
       An emblem lives in its owner's command zone and does nothing but
       what its words say: so far, triggered abilities. It is never a card
       and never a spell. */
    _emblems() {
      const out = [];
      for (const p of this.players) for (const o of ((this.zones[p.id] || {}).command || [])) if (o.card && o.card.layout === 'emblem') out.push(o);
      return out;
    }
    /** A list of permanents with the emblems after them, for whatever watches for triggers. */
    _withEmblems(list) {
      const em = this._emblems();
      return em.length ? list.concat(em) : list;
    }

    _fireDelayed(event, activePlayerId) {
      if (!this.delayedTriggers.length) return;
      const keep = [];
      for (const d of this.delayedTriggers) {
        const mine = d.event === event &&
          (d.controller == null || d.forPlayer == null || d.forPlayer === activePlayerId) &&
          // "your next end step" must not be the one we are already in
          (d.notBefore == null || this.turn > d.notBefore ||
            (this.turn === d.notBefore && d.sameTurnOk));
        if (!mine) { keep.push(d); continue; }
        const obj = d.objId ? this.obj(d.objId) : null;
        this.pendingTriggers.push({
          id: this._uid('tr'), kind: 'ability', obj, objId: d.objId || null, abilityIndex: -1,
          controller: d.controller, name: d.name || 'Delayed trigger',
          effects: d.effects || [], auto: true, abilityText: d.name || '', delayed: true,
        });
        if (!d.once) keep.push(d);
      }
      this.delayedTriggers = keep;
      if (this.pendingTriggers.length) this.emit('sfx', 'trigger');
    }

    /* ---------- triggered abilities ---------- */
    _fire(event, controllerId, data) {
      data = data || {};
      /* "Whenever a player sacrifices a permanent": once for each one */
      if (event === 'youSacrifice') {
        for (let k = 0; k < Math.max(1, Number(data.count) || 1); k++) this._fire('anySacrifice', null, { playerId: controllerId });
      }
      this._fireDelayed(event, this.activePlayer && this.activePlayer.id);
      const tData = {
        event, drawer: data.drawer, deadController: data.deadController,
        player: data.player, playerId: data.playerId,
        /* the spell that set this off, for "copy that spell" */
        stackId: data.stackId, objectId: data.object && data.object.id,
        amount: data.amount,
      };
      const push = (o, i, ab) => {
        if (this._triggerHushed(o, event, data)) return;
        /* "One or more creatures die" is one trigger for the lot of them,
           however many went at once. */
        if (ab.objFilter && ab.objFilter.batch &&
            this.pendingTriggers.some(t => t.objId === o.id && t.abilityIndex === i)) return;
        // "This ability triggers only once each turn."
        if (ab.oncePerTurn) {
          o._onceTurn = o._onceTurn || {};
          if (o._onceTurn[i] === this.turn) return;
          o._onceTurn[i] = this.turn;
        }
        const times = 1 + this._extraTriggers(o, event, data);
        for (let k = 0; k < times; k++) {
          this.pendingTriggers.push({
            id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: i,
            controller: o.controller, name: `${o.name} — ${truncate(MTG.oracle.abilityLabel(ab), 50)}`,
            effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab), optional: ab.optional,
            triggerData: Object.assign({}, tData),
          });
        }
      };
      for (const o of this._withEmblems(this.battlefield)) {
        if (o.phasedOut) continue;
        const a = o.analysis();
        if (!a) continue;
        for (let i = 0; i < a.abilities.length; i++) {
          const ab = a.abilities[i];
          // "enters or attacks" is one ability that answers to either event
          if (ab.kind !== 'triggered' || (ab.event !== event && ab.also !== event)) continue;
          if (ab.self && data.source && data.source.id !== o.id) continue;
          if (ab.self && !data.source) continue;
          // "When this Class becomes level 3" is only that level
          if (ab.atLevel != null && data.level !== ab.atLevel) continue;
          // "whenever this attacks for the first time each turn"
          if (ab.firstAttack && data.attacker && data.attacker.attacksThisTurn > 1) continue;
          /* "Whenever you cast a creature spell" is not every spell, and
             "whenever a creature with power 4 or greater enters" is not
             every creature: the trigger says what it is watching for. */
          if (ab.spellFilter && !(data.object && this._cardFitsWords(data.object, ab.spellFilter))) continue;
          if (ab.objFilter && !(data.object && this._objFits(data.object, ab.objFilter, o, data.objController))) continue;
          // "whenever equipped creature …" is only the creature this is on
          if (data.attachedIds && !data.attachedIds.includes(o.id)) continue;
          // "their second card each turn", "except the first one they draw in each of their draw steps"
          if (ab.drawNth != null && data.nth !== ab.drawNth) continue;
          if (ab.counterKind && data.kind !== ab.counterKind) continue;
          // "a spell from anywhere other than their hand"
          if (ab.notFromHand && !(data.spell && data.spell.fromZone && data.spell.fromZone !== 'hand')) continue;
          if (ab.toOpponent && data.player === o.controller) continue;
          // "whenever this deals damage to a player": not to a creature
          if (ab.toPlayer && !data.player) continue;
          if (ab.combatOnly && !data.combat) continue;
          // "whenever you cast your second spell each turn"
          if (ab.castByYou && data.playerId !== o.controller) continue;
          // "the upkeep of enchanted creature's controller", "enchanted player's upkeep"
          if (ab.enchantedController) { const host = o.attachedTo && this.obj(o.attachedTo); if (!host || data.playerId !== host.controller) continue; }
          if (ab.enchantedPlayer && data.playerId !== o.attachedTo) continue;
          // battalion: this and at least so many others attacking
          if (ab.minAttackers && ((this.combat && this.combat.attackers) || []).length < ab.minAttackers) continue;
          // The Ozolith: "if it had counters on it"
          if (ab.hadCounters && !(data.object && Object.values(data.object._diedCounters || {}).some(v => Number(v) > 0))) continue;
          if (ab.bySpellOnly && event === 'becomesTarget' && !data.bySpell) continue;
          if (ab.byOpponent && event === 'becomesTarget' && data.playerId === o.controller) continue;
          if (ab.skipFirstDrawStep && data.inDrawStep && data.nth === 1) continue;
          /* "their first noncreature spell each turn": none of that kind
             earlier this turn from the same player. */
          if (ab.firstOfKind && data.caster) {
            const earlier = (data.caster.spellObjsThisTurn || []).filter(x => x !== data.object &&
              (!ab.objFilter || this._objFits(x, ab.objFilter, o)));
            if (earlier.length) continue;
          }
          // an Aura or Equipment watching the creature it is on, whoever controls that creature
          if (ab.ofEnchanted && !(data.object && o.attachedTo === data.object.id)) continue;
          // "a creature dealt damage by this creature this turn dies"
          if (ab.damagedByMe && !(data.object && data.object._damagedBy && data.object._damagedBy.turn === this.turn &&
            data.object._damagedBy.ids.includes(o.id))) continue;
          // "each opponent's end step", "combat on each opponent's turn"
          if (ab.notYourTurn && ((data.playerId || (this.activePlayer || {}).id) === o.controller)) continue;
          // "whenever you're dealt damage"
          if (ab.youOnly && data.player !== o.controller) continue;
          if (controllerId && !ab.self && !ab.ofEnchanted && o.controller !== controllerId) continue;
          if (data.except && o.id === data.except) continue;
          if (data.except && o.controller === data.except) continue;
          // an intervening "if" clause is checked before the trigger is even
          // put on the stack, and again as it resolves (CR 603.4)
          if (ab.condition && !this._condMet(ab.condition, { controller: o.controller, obj: o, triggerData: tData })) continue;
          push(o, i, ab);
        }
      }
      /* Creatures swept away together each see the others go: one that has
         already left in the same sweep still triggers for the rest. */
      if ((event === 'permDies' || event === 'permLeaves') && data.object && this._leavingTogether) {
        for (const o of this._leavingTogether) {
          if (o === data.object || o.zone === 'battlefield') continue;
          const a = o._lkiAnalysis || o.analysis();
          if (!a) continue;
          for (let i = 0; i < a.abilities.length; i++) {
            const ab = a.abilities[i];
            if (ab.kind !== 'triggered' || (ab.event !== event && ab.also !== event)) continue;
            if (ab.objFilter && !this._objFits(data.object, ab.objFilter, o, data.objController)) continue;
            push(o, i, ab);
          }
        }
      }
      /* Leaving the battlefield is seen from the battlefield (CR 603.10):
         a creature that dies sees its own death, and "whenever this or
         another creature dies" counts itself. */
      if ((event === 'dies' || event === 'ltb' || event === 'permDies' || event === 'permLeaves') && data.object) {
        const o = data.object;
        const a = (o.zone !== 'battlefield' && o._lkiAnalysis) || o.analysis();
        if (a) for (let i = 0; i < a.abilities.length; i++) {
          const ab = a.abilities[i];
          if (ab.kind !== 'triggered' || (ab.event !== event && ab.also !== event)) continue;
          const own = (event === 'dies' || event === 'ltb') ? ab.self
            : !!(ab.objFilter && ab.objFilter.selfOk && this._objFits(o, Object.assign({}, ab.objFilter, { other: false, who: null }), o));
          if (!own) continue;
          if (this.pendingTriggers.some(t => t.objId === o.id && t.abilityIndex === i)) continue;
          push(o, i, ab);
        }
      }
      if (this.pendingTriggers.length) this.emit('sfx', 'trigger');
    }

    /** Does a trigger's "if" clause still hold as it resolves? (CR 603.4) */
    _triggerStillHolds(item) {
      if (!item || item.kind !== 'ability' || item.abilityIndex == null) return true;
      const o = this.obj(item.objId);
      if (!o) return true;
      const a = o.analysis();
      const ab = a && a.abilities[item.abilityIndex];
      if (!ab || !ab.condition) return true;
      return this._condMet(ab.condition, { controller: item.controller, obj: o, triggerData: item.triggerData });
    }

    _putTriggersOnStack() {
      if (!this.pendingTriggers.length) return;
      // APNAP order (CR 603.3b): active player's triggers go on the stack first
      const order = [];
      for (let k = 0; k < this.turnOrder.length; k++) {
        const pid = this.turnOrder[(this.activeIndex + k) % this.turnOrder.length];
        for (const t of this.pendingTriggers) if (t.controller === pid) order.push(t);
      }
      for (const t of this.pendingTriggers) if (!order.includes(t)) order.push(t);
      this.pendingTriggers = [];
      for (const t of order) {
        t.triggered = true;          // "copy target triggered ability" needs to tell
        this.stack.push(t);
        this.logEvent('trigger', `Triggered: ${t.name}`);
        this.emit('stack:add', t);
      }
      /* Several of your own triggers at once is a decision the rules give
         you (CR 603.3b). The table orders them for you, as Arena does,
         unless you have asked to do it yourself — or have full control on,
         which means you have asked for every decision. */
      const mine = new Map();
      for (const t of order) {
        if (!mine.has(t.controller)) mine.set(t.controller, []);
        mine.get(t.controller).push(t);
      }
      for (const [pid, list] of mine) {
        if (list.length < 2) continue;
        const p = this.player(pid);
        if (!p || p.isBot || p.hasLost) continue;
        const cfg = (this.config.autoPass || {})[pid];
        if (!cfg || !(cfg.orderTriggers || cfg.fullControl)) continue;
        this.queueChoice({
          type: 'orderTriggers', playerId: pid,
          cards: list.map(t => ({ id: t.id, name: t.name, card: (t.obj && t.obj.card) || null })),
          count: list.length,
          prompt: 'Order your triggers — the last one you pick resolves first.',
        });
      }
    }

    /* ---------- effect execution ----------
       Resolution runs as a resumable program rather than a straight loop.
       Most effects finish where they stand, but a card that says "you may"
       or "unless that player pays" has to stop in the middle, put the
       question to somebody, and carry on with their answer — and the rest of
       the card must not happen before the answer arrives. So an effect that
       needs one asks for it and returns SUSPEND; the driver parks, and
       resolveChoice starts it again at the same effect, which now finds the
       answer waiting and falls through. */

    /**
     * Start running an effect list. `after` is called once the whole list has
     * finished, however many questions it stopped to ask on the way.
     */
    _runEffectsNow(effects, ctx) {
      for (const e of (effects || [])) {
        if (e.op === 'manual') continue;
        try { this._runEffect(e, ctx); } catch (err) { console.warn('[mana effect]', e, err); }
      }
    }

    _runEffects(effects, ctx, after, afterKind) {
      if (!effects || !effects.length) { if (after) after(); return; }
      // "those creatures" and "they" never reach back into an earlier spell
      this._lastGroup = null;
      this.resolving = { ctx, effects: effects.slice(), index: 0, answers: {}, manual: [], after,
        afterKind: afterKind || null };
      this._pumpResolution();
    }

    /** Run effects from where we left off until the list ends or asks a question. */
    _pumpResolution() {
      const r = this.resolving;
      if (!r) return;
      while (r.index < r.effects.length) {
        const e = r.effects[r.index];
        if (e.op === 'manual') { r.manual.push(e); r.index++; continue; }
        // a sequence is just more of this list: splice it in and carry on, so
        // anything inside it can suspend exactly like a top-level effect
        if (e.op === 'sequence') {
          r.effects.splice(r.index, 1, ...(e.list || []));
          continue;
        }
        let out;
        try { out = this._runEffect(e, r.ctx); }
        catch (err) {
          console.warn('[effect]', e, err);
          r.manual.push({ op: 'manual', text: e.text || JSON.stringify(e) });
          r.index++;
          continue;
        }
        if (out === SUSPEND) return;            // waiting on somebody; resume later
        r.index++;
      }
      this._finishResolution();
    }

    _finishResolution() {
      const r = this.resolving;
      if (!r) return;
      this.resolving = null;
      if (r.manual.length) {
        const text = r.manual.map(m => m.text).join(' ');
        this.logEvent('manual', `${r.ctx.name || 'Effect'}: "${text}" — resolve this by hand.`);
        this.emit('manual', { ctx: r.ctx, text, controller: r.ctx.controller });
      }
      if (r.after) r.after();
    }

    /**
     * Ask a question from inside an effect. The first time through there is no
     * answer, so the choice is queued and the effect suspends; when the player
     * answers, the same effect runs again and this returns what they said.
     */
    _ask(choice, sub) {
      const r = this.resolving;
      if (!r) return null;                       // not mid-resolution: nothing to wait for
      // a player who has left the game answers nothing, and nobody waits for them
      const asked = choice && choice.playerId != null ? this.player(choice.playerId) : null;
      if (asked && asked.hasLost) return null;
      const key = r.index + (sub ? ':' + sub : '');
      if (Object.prototype.hasOwnProperty.call(r.answers, key)) return r.answers[key];
      /* Whoever is asked should be able to see what is asking: the card the
         effect belongs to travels with the question, unless it says otherwise. */
      const src = r.ctx && r.ctx.obj;
      const about = { resumeKey: key, sourceName: (r.ctx && r.ctx.name) || (src && src.card && src.card.name) || null,
        sourceId: src ? src.id : null, sourceCard: src && src.card ? src.card : null };
      this.queueChoice(Object.assign(about, choice));
      return SUSPEND;
    }

    /* ---------- the generic question (docs/choices.md) ----------
       Anything the rules need to ask that is not one of the fixed shapes is
       asked as a `choose`: what it is chosen from, how many, and what the
       picks must add up to. The table and the bots read the question itself,
       so a new rule can ask a new question without anything else changing. */

    /**
     * Ask a generic question from inside an effect. Returns the checked
     * answer — { picks, number, order } — or SUSPEND while it waits, or null
     * when nothing could be chosen, in which case nobody is asked.
     */
    _choose(spec, sub) {
      const C = MTG.choice;
      const s = C.normalize(spec);
      for (const k of ['sourceName', 'sourceId', 'sourceCard']) if (s[k] == null) delete s[k];
      const r = this.resolving;
      if (r && Object.prototype.hasOwnProperty.call(r.answers, r.index + (sub ? ':' + sub : ''))) return this._ask(s, sub);
      const hooks = this._chooseHooks(s.playerId);
      if (!C.solve(s, { hooks })) return null;
      // nothing to decide: one number, or every one of the things on offer
      if (s.kind === 'number' && s.number.min === s.number.max) return { picks: [], number: s.number.min, order: null };
      const all = C.candidates(s);
      if (s.kind !== 'number' && !s.optional && !s.repeat && !s.ordered && s.min === all.length && s.max === all.length) {
        const got = C.check(s, { picks: all }, hooks);
        if (got.ok) return { picks: got.picks, number: null, order: null };
      }
      if (!r) return this._decideChoose(s.playerId, s);
      return this._ask(s, sub);
    }

    /** What only the engine can say about an answer: whether it can be paid for, and whether it is still there. */
    _chooseHooks(playerId) {
      return {
        canPay: (cost) => this.couldPay(playerId, cost, this.manaSources(playerId)),
        alive: (id) => typeof id !== 'string' || !!this.player(id) || (!!this.obj(id) && !!this.obj(id).zone),
      };
    }

    /** Objects as a generic question offers them: what the table shows and what constraints read. */
    _chooseItems(objs) {
      return (objs || []).filter(Boolean).map(o => {
        const c = this.characteristics(o) || o.analysis() || {};
        const creature = !!c.isCreature;
        return {
          id: o.id, name: o.name, zone: o.zone, controller: o.controller, owner: o.owner, card: o.card || null,
          power: creature ? this.powerOf(o) : null, toughness: creature ? this.toughnessOf(o) : null,
          mv: (o.card && o.card.cmc) || 0, colors: (c.colors || (o.card && o.card.colors) || []).slice(), tapped: !!o.tapped,
        };
      });
    }
    _choosePlayers(players) {
      return (players || []).filter(p => p && !p.hasLost).map(p => ({ id: p.id, name: p.name, life: p.life }));
    }

    /**
     * Answer a generic question on somebody's behalf, on the spot: a bot
     * casting a spell, or a question that came up when nobody could be
     * waited for. The bots' judgement is used when it is there; otherwise
     * the first legal answer.
     */
    _decideChoose(playerId, s) {
      const C = MTG.choice;
      const hooks = this._chooseHooks(playerId);
      let ans = null;
      try { if (MTG.bots && MTG.bots.answerChoose) ans = MTG.bots.answerChoose(this, playerId, s); } catch (e) { console.warn('[choose]', e); }
      let got = ans ? C.check(s, ans, hooks) : null;
      if (!got || !got.ok) got = C.check(s, C.solve(s, { hooks }) || { picks: [] }, hooks);
      return got.ok ? { picks: got.picks, number: got.number, order: got.order } : { picks: [], number: null, order: null };
    }

    /**
     * A generic question asked while a spell is being cast (CR 601.2b–c):
     * how many times to replicate it, what to splice onto it. The answer may
     * have come with the cast already; otherwise a bot decides on the spot
     * and a person is asked, and the cast starts again once they answer.
     * Returns the answer, null when there is nothing to choose, or 'asked'.
     */
    _castChoose(playerId, o, opts, spec) {
      const C = MTG.choice;
      const s = C.normalize(Object.assign({ playerId, sourceId: o.id, sourceName: o.name, sourceCard: o.card }, spec));
      const hooks = this._chooseHooks(playerId);
      opts.choices = Object.assign({}, opts.choices);
      const have = opts.choices[s.purpose];
      if (have) {
        const got = C.check(s, have, hooks);
        if (got.ok) return (opts.choices[s.purpose] = { picks: got.picks, number: got.number, order: got.order });
      }
      if (!C.solve(s, { hooks })) { delete opts.choices[s.purpose]; return null; }
      const p = this.player(playerId);
      if ((p && p.isBot) || opts.autoCost) return (opts.choices[s.purpose] = this._decideChoose(playerId, s));
      const keep = JSON.parse(JSON.stringify(Object.assign({}, opts)));
      delete keep.choices[s.purpose];
      this.queueChoice(Object.assign(s, { then: { kind: 'cast', objId: o.id, opts: keep } }));
      return 'asked';
    }

    /**
     * Has this part of the current effect already happened? An effect that
     * stops to ask a question runs again from the top when the answer
     * comes, and anything it did before asking must not happen twice. The
     * first call for a key says no and remembers it; later calls say yes.
     */
    _doneHere(key) {
      const r = this.resolving;
      if (!r) return false;
      r.marks = r.marks || {};
      const k = r.index + ':' + key;
      if (r.marks[k]) return true;
      r.marks[k] = true;
      return false;
    }

    _runEffect(e, ctx) {
      const me = this.player(ctx.controller);
      const src = ctx.obj;
      let targets = (ctx.resolvedTargets || ctx.targets || []);
      let sliced = false;
      /* "Destroy target artifact. Target player draws a card." Two
         sentences, two targets, chosen in order as the spell was cast: each
         sentence acts on its own, not on everything the spell pointed at. */
      if (e.targets && e.targets.length && (ctx.targets || []).length) {
        const flat = [];
        for (const x of (ctx.effects || [])) { if (x && x.op === 'sequence') flat.push(...(x.list || [])); else if (x) flat.push(x); }
        const aimed = flat.filter(x => x.targets && x.targets.length && !x.askTargets);
        const total = aimed.reduce((k, x) => k + x.targets.length, 0);
        if (aimed.length > 1 && total === ctx.targets.length && aimed.includes(e)) {
          let off = 0;
          for (const x of aimed) { if (x === e) break; off += x.targets.length; }
          const mine = ctx.targets.slice(off, off + e.targets.length);
          targets = mine.filter(t => targets.some(r => r.kind === t.kind && r.id === t.id));
          sliced = true;
        }
      }
      /* Words that joined the spell from elsewhere — a spliced card, a mode
         chosen more than once — choose their own targets as they resolve. */
      if (e.askTargets) { targets = []; sliced = false; }
      /* "Put a +1/+1 counter on a creature you control": chosen as it
         happens, not targeted. A generic question, and the pick is what the
         effect then acts on; with nothing to choose, nothing happens. */
      if (e.chooseFrom && !(e.targets && e.targets.length)) {
        const spec = e.chooseFrom;
        const pool = this.battlefield.filter(o => !o.phasedOut && o.analysis() &&
          MTG.oracle.matchesSpec(spec, o, o.analysis(), ctx.controller, this._specCtx()));
        const got = this._choose({ playerId: ctx.controller, purpose: 'effectObject', kind: 'objects', zone: 'battlefield',
          items: this._chooseItems(pool), min: 1, max: 1,
          prompt: `${ctx.name ? ctx.name + ': ' : ''}choose ${/^[aeiou]/i.test(spec.filter || '') ? 'an' : 'a'} ${spec.filter || 'permanent'}.` }, 'pick');
        if (got === SUSPEND) return SUSPEND;
        if (!got || !got.picks.length) return null;
        targets = got.picks.map(id => ({ kind: 'object', id }));
        this._noteLastAffected(targets);          // "it" in the next sentence is the one chosen
      }
      /* An effect that wants a target and has not been given one asks for it
         now. This is what a chosen mode needs: "choose one — destroy target
         artifact" has its target inside the mode, and the mode is not known
         until the spell resolves, so nothing could have been chosen for it
         when the spell was cast. */
      if (e.targets && e.targets.length && !targets.length && !sliced) {
        /* "Destroy target artifact that player controls": the player the
           trigger is about, whoever that turns out to be. */
        const td = ctx.triggerData || {};
        const tp = ctx.chosenPlayer || td.drawer || td.player || td.deadController || td.playerId || '-';
        const aimed = e.targets.map(spec => (spec && spec.controller === 'triggerPlayer'
          ? Object.assign({}, spec, { controller: undefined, controllerId: tp }) : spec));
        const options = aimed.map(spec => this._legalTargetsFor(spec, ctx.controller, src ? src.id : null));
        // nothing legal to point at: the effect simply does not happen
        if (options.every(list => list.length)) {
          const picked = this._ask({
            type: 'pickTarget', playerId: ctx.controller, specs: e.targets,
            options, count: e.targets.length, sourceId: src ? src.id : null,
            prompt: (ctx.name ? ctx.name + ': ' : '') +
              (e.targets.length === 1 ? 'choose a target' : 'choose targets'),
          }, 'tgt');
          if (picked === SUSPEND) return SUSPEND;
          targets = (picked || []).map(normTarget);
          ctx.resolvedTargets = targets;
          if (ctx.kind === 'ability') this._crimeCheck(ctx.controller, targets);
        }
      }
      /* "Destroy that creature", "exile it": the permanent a trigger is
         about, read the way a target is by the effects that only read
         targets. Gone from the battlefield, it is not there to act on. */
      if (e.scope === 'triggerObject' && TRIGGER_OBJECT_OPS.has(e.op)) {
        const id = (ctx.triggerData || {}).objectId;
        const x = id && this.obj(id);
        targets = x && x.zone === 'battlefield' ? [{ kind: 'object', id }] : [];
      }
      const firstObj = () => { const t = targets.find(t => t.kind === 'object'); return t && this.obj(t.id); };
      const firstPlayer = () => { const t = targets.find(t => t.kind === 'player'); return t && this.player(t.id); };
      // "whenever an opponent draws a card, they lose 2 life" — "they" is
      // whoever set the trigger off, which the trigger recorded for us
      const triggerPlayer = () => {
        const d = ctx.triggerData || {};
        // "choose an opponent. That player …": the one chosen, when there was a choice
        return this.player(ctx.chosenPlayer || d.drawer || d.player || d.deadController || d.playerId) || null;
      };
      /* Most effects name what they act on the same three ways: the thing
         they were cast from, whatever the last effect picked, or their own
         targets. This applies `fn` to whichever the effect meant. */
      /* "…get +2/+1 until end of turn. Untap those creatures." The second
         sentence is about whatever the first one touched, so the group is
         remembered as it is applied. */
      const applyToScope = (e2, fnRaw) => {
        const touched = [];
        const fn = (x) => { touched.push(x.id); this._lastGroup = touched; return fnRaw(x); };
        if (e2.scope === 'attached') { const x = src && src.attachedTo && this.obj(src.attachedTo); if (x) fn(x); return; }
        if (e2.scope === 'thatObject') {
          const x = (this._lastPut && this.obj(this._lastPut)) || (this._lastCopy) ||
            ctx.obj || (ctx.objId && this.obj(ctx.objId));
          if (x) fn(x);
          return;
        }
        if (e2.scope === 'self') { if (src) fn(src); return; }
        if (e2.scope === 'triggerObject') {
          const x = (ctx.triggerData || {}).objectId && this.obj(ctx.triggerData.objectId);
          if (x && x.zone === 'battlefield') fn(x);
          return;
        }
        if (e2.scope === 'lastTarget') { const x = firstObj(); if (x) fn(x); return; }
        if (e2.scope === 'yourCreatures' || e2.scope === 'opponentCreatures') {
          for (const o of this.creaturesOf(ctx.controller, e2.scope)) fn(o);
          return;
        }
        if (e2.scope === 'allCreatures') {
          for (const o of this.battlefield.slice()) { const oa = o.analysis(); if (oa && this.characteristics(o).isCreature) fn(o); }
          return;
        }
        if (e2.scope === 'lastGroup') {
          for (const id of (this._lastGroup || []).slice()) { const x = this.obj(id); if (x && x.zone === 'battlefield') fn(x); }
          return;
        }
        if (e2.scope === 'lastAffected') { const x = this._lastAffected && this.obj(this._lastAffected.id); if (x && x.zone === 'battlefield') fn(x); return; }
        /* "Permanents you control", "other attacking creatures", "each
           creature target player controls": the same scope words a static
           ability uses, applied once, to whatever fits right now. */
        if (e2.scope && typeof e2.scope === 'object') {
          const tp = e2.scope.who === 'target' ? ((firstPlayer() || me).id) : null;
          for (const o of this._scopeList(e2.scope, ctx.controller, src, tp)) fn(o);
          return;
        }
        for (const t of targets) { if (t.kind === 'object') { const o = this.obj(t.id); if (o) fn(o); } }
      };
      const n = (v) => {
        if (v === 'X') return ctx.x || (src && src.chosenX) || 0;
        // "the number of cards in your hand plus one"
        if (v && typeof v === 'object' && v.plus) { const base = Object.assign({}, v); delete base.plus; return n(base) + v.plus; }
        /* "that creature's power": the permanent the trigger is about, as it
           is now or as it last was */
        if (v && typeof v === 'object' && v.ofTrigger) {
          const id = (ctx.triggerData || {}).objectId;
          const o = id && this.obj(id);
          if (!o) return 0;
          const gone = o.zone !== 'battlefield' && o._lastPower != null;
          if (v.ofTrigger === 'power') return gone ? o._lastPower : this.powerOf(o);
          if (v.ofTrigger === 'toughness') return gone ? o._lastToughness : this.toughnessOf(o);
          return (o.card && o.card.cmc) || 0;
        }
        if (v && typeof v === 'object' && v.ofTarget) {
          const t0 = targets.find(t => t.kind === 'object');
          const o = t0 && this.obj(t0.id);
          return o ? (v.ofTarget === 'power' ? this.powerOf(o) : v.ofTarget === 'toughness' ? this.toughnessOf(o) : ((o.card && o.card.cmc) || 0)) : 0;
        }
        if (v && typeof v === 'object' && v.lastSweep) return (this._lastSweep || 0) * (v.mult || 1);
        if (v && typeof v === 'object' && v.ofSelf) {
          if (!src) return 0;
          const gone = src.zone !== 'battlefield' && src._lastPower != null;
          if (v.ofSelf === 'power') return gone ? src._lastPower : this.powerOf(src);
          return gone ? src._lastToughness : this.toughnessOf(src);
        }
        if (v && typeof v === 'object' && v.devotion) return this.devotionOf(ctx.controller, v.devotion) * (v.mult || 1);
        // "for each burden counter on The One Ring"
        if (v && typeof v === 'object' && v.countersOnSelf) {
          // after it has died, the counters it had as it went (Hangarback Walker)
          const pile = src && (src.zone !== 'battlefield' && src._diedCounters ? src._diedCounters : src.counters);
          return ((pile && Number(pile[v.countersOnSelf])) || 0) * (v.mult || 1);
        }
        if (v && typeof v === 'object' && v.ofSacrificed) return ((ctx.sacrificed || this._lastSacrificed || [])[0] || {})[v.ofSacrificed] || 0;
        if (v && typeof v === 'object' && v.greatestPower) {
          let best = 0;
          for (const o of this._scopeList(v.greatestPower, ctx.controller, src)) best = Math.max(best, this.powerOf(o));
          return best;
        }
        /* "for each creature you control with a +1/+1 counter on it" — and
           "those creatures" in the next sentence are the ones counted */
        if (v && typeof v === 'object' && v.scope) {
          const list = this._scopeList(v.scope, ctx.controller, src, (firstPlayer() || me).id);
          this._lastGroup = list.map(o => o.id);
          return list.length * (v.mult || 1);
        }
        if (v && typeof v === 'object' && v.cardsInHand) {
          const who = v.cardsInHand === 'you' ? me
            : v.cardsInHand === 'triggerPlayer' ? triggerPlayer()
            : (firstPlayer() || this.opponentsOf(ctx.controller)[0]);
          return who ? this.zones[who.id].hand.length * (v.mult || 1) : 0;
        }
        if (v && typeof v === 'object' && v.cardsInGraveyard) {
          const gy = this.zones[ctx.controller].graveyard;
          return (v.filter ? gy.filter(o => this._cardFitsWords(o, v.filter)).length : gy.length) * (v.mult || 1);
        }
        if (v && typeof v === 'object' && v.opponents) return this.opponentsOf(ctx.controller).length * (v.mult || 1);
        // domain: basic land types among lands you control
        if (v && typeof v === 'object' && v.domain) return this._domainOf(ctx.controller) * (v.mult || 1);
        if (v && typeof v === 'object' && v.colorsAmongYours) return this._colorsAmongYours(ctx.controller).length * (v.mult || 1);
        if (v === 'lastLifeLost') return this._lastLifeLost || 0;
        if (v === 'lastRoll') return this._lastRoll || 0;
        // Station: the power of the creature tapped to pay for it
        if (v && typeof v === 'object' && v.ofTapped) return Math.max(0, ((ctx.tapped || [])[0] || {})[v.ofTapped] || 0);
        // "you gain life equal to the damage dealt this way"
        if (v === 'lastDamage') return this._lastDamageDealt || 0;
        // "loses that much life": the amount the trigger was about
        if (v === 'triggerAmount') return Number((ctx.triggerData || {}).amount) || 0;
        if (v && typeof v === 'object' && v.per) return this.countPermanents(ctx.controller, v) * (v.mult || 1);
        if (v && typeof v === 'object' && v.attackingOther) {
          const want = String(v.attackingOther).toLowerCase();
          let k = 0;
          for (const id of (this.combat.attackers || [])) {
            const o = this.obj(id);
            if (!o || o === src) continue;
            const oa = o.analysis();
            if (oa && (oa.subtypes || []).some(x => x.toLowerCase() === want)) k++;
          }
          return k;
        }
        if (v && typeof v === 'object' && v.spellsThisTurn) {
          return (me.spellsCastThisTurn || 0) * v.spellsThisTurn;
        }
        if (v && typeof v === 'object' && v.ofLast) {
          const snap = this._lastAffected;
          return snap ? (snap[v.ofLast] || 0) : 0;
        }
        /* "…deals 2 damage. If this spell was kicked, it deals 4 instead."
           One number with a question attached, rather than two effects
           fighting over the same damage. */
        if (v && typeof v === 'object' && v.ifCond) {
          return this._condMet(v.ifCond, ctx) ? n(v.then) : n(v.otherwise);
        }
        if (v && typeof v === 'object' && (v.posX || v.negX)) {
          const x = ctx.x || (src && src.chosenX) || 0;
          return v.negX ? -x : x;
        }
        return v || 0;
      };

      switch (e.op) {
        case 'addMana':
          for (const s of (e.tron && this._tronAssembled(ctx.controller, e.tron) ? e.tron.symbols : e.symbols)) {
            if (/^\d+$/.test(s)) { for (let i = 0; i < +s; i++) me.pool.add('C'); continue; }
            const c = MANA.COLORS.concat('C').find(x => s.includes(x));
            me.pool.add(c || 'C');
          }
          break;
        case 'addManaAny': {
          const amt = n(e.amount);
          /* "any color in your commander's color identity" is only those */
          const allowed = e.commanderIdentity ? Array.from(this._commanderColors(ctx.controller)) : MANA.COLORS;
          const pool = allowed.length ? allowed : MANA.COLORS;
          const pref = this._preferredColor(me);
          const color = ctx.manaChoice && pool.includes(ctx.manaChoice) ? ctx.manaChoice : (pool.includes(pref) ? pref : pool[0]);
          for (let i = 0; i < amt; i++) me.pool.add(color);
          break;
        }
        /* "Add one mana of any color that a land an opponent controls could
           produce", "…among legendary creatures you control", "…of the
           exiled card's colors": only the colours on offer right now. */
        case 'addManaAmong': {
          const cols = this._manaAmong(e, src, ctx.controller);
          if (!cols.length) { this.logEvent('mana', `${src ? src.name : 'It'} makes no mana: there is no colour to choose.`); break; }
          const pref = this._preferredColor(me);
          const color = ctx.manaChoice && cols.includes(ctx.manaChoice) ? ctx.manaChoice : (cols.includes(pref) ? pref : cols[0]);
          for (let i = 0; i < (Number(e.amount) || 1); i++) me.pool.add(color);
          break;
        }
        /* Bloom Tender: one of each colour among your permanents. */
        case 'addManaEachColor':
          for (const c of this._colorsAmongYours(ctx.controller)) me.pool.add(c);
          break;
        /* "Add X mana of any one color, where X is this creature's power". */
        case 'addManaX': {
          const k = this._manaXValue(e, src, ctx.controller);
          const color = e.symbol ? e.symbol
            : ctx.manaChoice && MANA.COLORS.includes(ctx.manaChoice) ? ctx.manaChoice : this._preferredColor(me);
          for (let i = 0; i < k; i++) me.pool.add(color);
          break;
        }
        /* Nykthos: a colour, and as much of it as your devotion to it. */
        case 'addManaDevotion': {
          let color = ctx.manaChoice && MANA.COLORS.includes(ctx.manaChoice) ? ctx.manaChoice : null;
          if (!color) {
            let best = -1;
            for (const c of MANA.COLORS) { const d = this.devotionOf(ctx.controller, c); if (d > best) { best = d; color = c; } }
          }
          const k = this.devotionOf(ctx.controller, color);
          for (let i = 0; i < k; i++) me.pool.add(color);
          if (k) this.logEvent('mana', `${me.name} adds ${k} mana from devotion.`);
          break;
        }
        case 'addManaChoice': {
          const want = ctx.manaChoice;
          let choice = e.choices[0];
          if (want) {
            const hit = e.choices.find(ch => ch.some(s => s.includes(want)));
            if (hit) choice = hit;
          }
          for (const s of choice) {
            const c = MANA.COLORS.concat('C').find(x => s.includes(x));
            me.pool.add(c || 'C');
          }
          break;
        }
        case 'draw': {
          const cnt = n(e.n);
          if (e.who === 'triggerPlayer') { const p = triggerPlayer(); if (p) this._drawCards(p, cnt); }
          else if (e.who === 'fixed') { const p = this.player(e.pid); if (p && !p.hasLost) this._drawCards(p, cnt); }
          else if (e.who === 'targetController') { const p = this._lastAffectedController(); if (p) this._drawCards(p, cnt); }
          else if (e.who === 'each') for (const p of this.players) { if (!p.hasLost) this._drawCards(p, cnt); }
          else if (e.who === 'target') {
            // "Two target players each draw a card": every player aimed at
            const ps = targets.filter(t => t.kind === 'player').map(t => this.player(t.id)).filter(p => p && !p.hasLost);
            for (const p of new Set(ps)) this._drawCards(p, cnt);
          }
          else this._drawCards(me, cnt);
          break;
        }
        case 'discard': {
          const cnt = e.n === 'all' ? 99 : n(e.n);
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller)
            : e.who === 'each' ? this.players.filter(p => !p.hasLost)
            : e.who === 'triggerPlayer' ? [triggerPlayer()]
            : (e.who === 'target' ? [firstPlayer()] : [me]);
          for (const p of who) {
            if (!p || p.hasLost) continue;
            // each player discards once, however many times this resumes
            if (this._doneHere('d' + p.id)) continue;
            const hand = this.zones[p.id].hand;
            /* "Discard a card at random" is nobody's choice, and "discard
               your hand" leaves nothing to choose. */
            if (e.random || cnt >= hand.length) {
              const pool = hand.slice();
              const gone = [];
              for (let i = 0; i < Math.min(cnt, pool.length); i++) {
                const k = e.random ? Math.floor(this.rng.next() * pool.length) : 0;
                gone.push(pool.splice(k, 1)[0]);
              }
              for (const c of gone) { this.moveObject(c, 'graveyard'); this._afterDiscard(p.id, c); }
              if (gone.length) this.logEvent('discard', `${p.name} discards ${gone.map(c => c.name).join(', ')}${e.random ? ' at random' : ''}.`);
              continue;
            }
            const got = this._ask({ type: 'discard', playerId: p.id, count: Math.min(cnt, hand.length),
              prompt: `Discard ${cnt === 1 ? 'a card' : cnt + ' cards'}.` }, 'd' + p.id);
            if (got === SUSPEND) return SUSPEND;
          }
          break;
        }
        case 'gainLife': {
          const cnt = n(e.n);
          if (e.who === 'targetController') {
            const p = this._lastAffectedController();
            if (p) this.changeLife(p, cnt);
          } else if (e.who === 'target') { const p = firstPlayer(); if (p) this.changeLife(p, cnt); }
          else this.changeLife(me, cnt);
          break;
        }
        case 'loseLife': {
          const cnt = n(e.n);
          if (e.who === 'opponents') for (const p of this.opponentsOf(ctx.controller)) this.changeLife(p, -cnt);
          else if (e.who === 'each') for (const p of this.players) { if (!p.hasLost) this.changeLife(p, -cnt); }
          else if (e.who === 'triggerPlayer') { const p = triggerPlayer(); if (p) this.changeLife(p, -cnt); }
          else if (e.who === 'targetController') { const o = firstObj(); const p = o && this.player(o.controller); if (p) this.changeLife(p, -cnt); }
          else if (e.who === 'target') { const p = firstPlayer(); if (p) this.changeLife(p, -cnt); }
          else this.changeLife(me, -cnt);
          break;
        }
        case 'damage': {
          const cnt = n(e.n);
          /* Warstorm Surge, Chandra's Ignition: the damage comes from the
             creature the trigger or the spell is about, not from this */
          let dsrc = src;
          if (e.fromTrigger) { const id = (ctx.triggerData || {}).objectId; dsrc = (id && this.obj(id)) || src; }
          if (e.fromTarget) { const t0 = targets.find(t => t.kind === 'object'); dsrc = (t0 && this.obj(t0.id)) || src; }
          if (e.toSelf) { this.dealDamageToPlayer(me, cnt, dsrc); this.emit('sfx', 'damage'); break; }
          if (e.toTriggerPlayer) { const p = triggerPlayer(); if (p) this.dealDamageToPlayer(p, cnt, dsrc); this.emit('sfx', 'damage'); break; }
          /* "Destroy target land. It deals 2 damage to that land's
             controller": whoever controlled what the effect before acted
             on, or the permanent the trigger is about */
          if (e.toAffectedController) {
            const td = (ctx.triggerData || {}).object;
            const p = this._lastAffectedController() || (td && this.player(td.controller));
            if (p) this.dealDamageToPlayer(p, cnt, dsrc);
            this.emit('sfx', 'damage');
            break;
          }
          if (e.each) {
            if (/creature/.test(e.each)) for (const o of this.battlefield.slice()) {
              const a = o.analysis();
              if (!(a && a.isCreature)) continue;
              // "…to each creature without flying"
              if (e.without && this.hasKw(o, e.without)) continue;
              if (e.withKw && !this.hasKw(o, e.withKw)) continue;
              if (e.eachOther && o === dsrc) continue;
              this.dealDamageToObject(o, cnt, dsrc);
            }
            if (/opponent/.test(e.each)) for (const p of this.opponentsOf(ctx.controller)) this.dealDamageToPlayer(p, cnt, dsrc);
            if (/^player/.test(e.each) || /each player/.test(e.each)) for (const p of this.players) this.dealDamageToPlayer(p, cnt, dsrc);
            if (/planeswalker/.test(e.each)) for (const o of this.battlefield.slice()) { const a = o.analysis(); if (a && a.isPlaneswalker) this.dealDamageToObject(o, cnt, dsrc); }
          } else if (e.scope && typeof e.scope === 'object') {
            // "4 damage to each creature you don't control"
            for (const o of this._scopeList(e.scope, ctx.controller, src, (firstPlayer() || me).id)) this.dealDamageToObject(o, cnt, dsrc);
          } else {
            for (const t of (e.fromTarget ? targets.slice(1) : targets)) {
              if (t.kind === 'player') this.dealDamageToPlayer(this.player(t.id), cnt, dsrc);
              else { const o = this.obj(t.id); if (o) this.dealDamageToObject(o, cnt, dsrc); }
            }
          }
          if (e.noRegen) {
            const hit = e.each
              ? this.battlefield.filter(o => (o.analysis() || {}).isCreature)
              : targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
            for (const o of hit) o.noRegenThisTurn = true;
          }
          if (e.exileInstead) {
            // "if a creature dealt damage this way would die this turn, exile it"
            this.prevention.push({ noop: true });   // keeps the turn-scoped list alive
            this._replacements();                   // refresh
            this._exileOnDeath = this._exileOnDeath || new Set();
            for (const t of targets) if (t.kind === 'object') this._exileOnDeath.add(t.id);
            if (e.each) for (const o of this.battlefield) {
              const a2 = o.analysis();
              if (a2 && a2.isCreature) this._exileOnDeath.add(o.id);
            }
          }
          this.emit('sfx', 'damage');
          break;
        }
        case 'counters': {
          const cnt = n(e.n);
          if (e.scope === 'self' && src) this.addCounters(src, e.kind, cnt);
          else if (e.scope === 'yourMatching') {
            for (const o of this.battlefield) {
              if (o.controller !== ctx.controller) continue;
              if (!this._matchesCategory(o, e.filter)) continue;
              this.addCounters(o, e.kind, cnt);
            }
          }
          else if (e.scope === 'yourCreatures') {
            // "those creatures" in the next sentence are these
            const list = this.creaturesOf(ctx.controller, 'yourCreatures');
            this._lastGroup = list.map(o => o.id);
            for (const o of list) this.addCounters(o, e.kind, cnt);
          }
          else if (e.scope === 'triggerObject' || e.scope === 'attached' || e.scope === 'lastGroup' || e.scope === 'lastTarget') applyToScope(e, (o) => this.addCounters(o, e.kind, cnt));
          else if (e.scope && typeof e.scope === 'object') {
            for (const o of this._scopeList(e.scope, ctx.controller, src, (firstPlayer() || me).id)) this.addCounters(o, e.kind, cnt);
          }
          else for (const t of targets) { if (t.kind === 'object') { const o = this.obj(t.id); if (o) this.addCounters(o, e.kind, cnt); } }
          break;
        }
        case 'destroy':
          if (e.scope === 'attached') {
            const x = src && src.attachedTo && this.obj(src.attachedTo);
            if (x && !this.hasKw(x, 'indestructible') && !this._totemArmor(x) && !this._regenerated(x)) this.moveObject(x, 'graveyard');
            break;
          }
          this._noteLastAffected(targets);
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const o = this.obj(t.id);
            if (!o) continue;
            const a = o.analysis();
            if (e.ifColor && !((a && a.colors) || []).includes(e.ifColor)) continue;
            if (this.hasKw(o, 'indestructible')) { this.logEvent('rules', `${o.name} is indestructible.`); continue; }
            if (this._totemArmor(o)) continue;
            if (this._regenerated(o)) continue;
            this.moveObject(o, 'graveyard');
          }
          break;
        case 'exile':
          if (e.scope === 'attached') {
            const x = src && src.attachedTo && this.obj(src.attachedTo);
            if (x) { this.moveObject(x, 'exile'); this._lastExiled = x.id; }
            break;
          }
          this._noteLastAffected(targets);
          /* "from a single graveyard": the cards that share the first one's
             owner; any from another graveyard stay where they are */
          if (e.sameGraveyard) {
            const first = targets.map(t => t.kind === 'object' && this.obj(t.id)).find(Boolean);
            if (first) targets = targets.filter(t => { const o = t.kind === 'object' && this.obj(t.id); return !o || o.owner === first.owner; });
          }
          for (const t of targets) {
            /* "Exile any number of target spells": off the stack and into
               exile, which is not countering it */
            if (t.kind === 'stack') {
              const item = this.stack.find(st => st.id === t.id);
              if (item && item.kind === 'spell' && item.obj && !item.isCopy) {
                this.moveObject(item.obj, 'exile');
                this._lastExiled = item.obj.id;
                this.logEvent('exile', `${item.name} is exiled.`);
              }
              continue;
            }
            if (t.kind !== 'object') continue;
            const o = this.obj(t.id);
            if (o) { this.moveObject(o, 'exile'); this._lastExiled = o.id; }
          }
          break;
        case 'bounce':
          if (e.scope === 'self' && src) { this.moveObject(src, 'hand'); break; }
          for (const t of targets) {
            if (t.kind === 'object') { const o = this.obj(t.id); if (o) this.moveObject(o, 'hand'); }
            // "return target spell to its owner's hand": off the stack, uncast
            if (t.kind === 'stack') {
              const item = this.stack.find(st => st.id === t.id);
              if (item && item.kind === 'spell' && item.obj && !item.isCopy) {
                this.moveObject(item.obj, 'hand');
                this.logEvent('bounce', `${item.name} is returned to its owner's hand.`);
              }
            }
          }
          break;
        case 'regrowth':
          for (const t of targets) { if (t.kind === 'object') { const o = this.obj(t.id); if (o) this.moveObject(o, 'hand'); } }
          break;
        /* "return a creature card from your graveyard to your hand" — no
           target: chosen as it resolves, from what is there by then */
        case 'graveyardPick': {
          const yard = (this.zones[ctx.controller] || {}).graveyard || [];
          const pool = yard.filter(c => c !== src && this._cardFitsWords(c, e.filter || 'card'));
          const want = Math.min(n(e.n) || 1, pool.length);
          if (!want) break;
          let ids = pool.map(c => c.id).slice(0, want);
          if (pool.length > want || e.upTo) {
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: want, optional: !!e.upTo,
              cards: pool.map(c => ({ id: c.id, name: c.name, card: c.card })),
              prompt: `Return ${want === 1 ? 'a' : want} ${e.filter || 'card'} card${want === 1 ? '' : 's'} from your graveyard.` }, 'gy');
            if (picked === SUSPEND) return SUSPEND;
            ids = (picked || []).filter(id => pool.some(c => c.id === id)).slice(0, want);
          }
          for (const id of ids) {
            const c = this.obj(id);
            if (!c) continue;
            this.moveObject(c, e.to === 'battlefield' ? 'battlefield' : 'hand', { controller: ctx.controller });
          }
          break;
        }
        case 'counterSpell':
          for (const t of targets) {
            const item = this.stack.find(s => s.id === t.id);
            if (!item) continue;
            const ia = item.obj && item.obj.analysis();
            // Pyroblast: "if it's blue" is checked as it resolves
            if (e.ifColor && !((ia && ia.colors) || []).includes(e.ifColor)) { this.logEvent('counter', `${item.name} is not the right colour.`); continue; }
            // an ability on the stack is countered whatever its source says about spells (Stifle)
            const proof = item.kind === 'spell' && ((ia && (ia.abilities || []).some(ab =>
              (ab.effects || []).some(ef => ef.op === 'cantBeCountered'))) || this._uncounterable(item));
            if (proof) { this.logEvent('counter', `${item.name} can't be countered.`); continue; }
            item.countered = true;
            if (e.exileIt) item.exileIfCountered = true;
            /* "Its controller creates two Treasure tokens", "add mana equal
               to that spell's mana value": the sentences after a counter
               are about the spell it countered. */
            this._lastAffected = { id: item.objId, controller: item.controller, owner: item.controller,
              name: item.name, power: 0, toughness: 0,
              mv: (item.obj && item.obj.card && item.obj.card.cmc) || 0 };
            this._lastCountered = this._lastAffected;
            this.logEvent('counter', `${item.name} is countered.`);
            this.emit('sfx', 'counter');
          }
          break;
        /* "You may tap or untap target permanent": whoever controls the
           effect decides which, as it resolves. */
        case 'tapOrUntap': {
          const x = firstObj();
          if (!x || x.zone !== 'battlefield') break;
          const tap = this._ask({ type: 'confirm', playerId: ctx.controller, prompt: `${ctx.name ? ctx.name + ': ' : ''}tap ${x.name}? (No untaps it.)` }, 'tu');
          if (tap === SUSPEND) return SUSPEND;
          if (tap) this._markTapped(x); else x.tapped = false;
          this.emit('sfx', tap ? 'tap' : 'untap');
          break;
        }
        /* Bolster N (CR 701.39): N +1/+1 counters on the creature you
           control with the least toughness, your choice among a tie. */
        case 'bolster': {
          const mine = this.creaturesOf(ctx.controller, 'yourCreatures');
          if (!mine.length) break;
          const least = Math.min(...mine.map(o => this.toughnessOf(o)));
          const pool = mine.filter(o => this.toughnessOf(o) === least);
          let pick = pool[0];
          if (pool.length > 1) {
            const got = this._choose({ playerId: ctx.controller, purpose: 'effectObject', kind: 'objects', zone: 'battlefield',
              items: this._chooseItems(pool), min: 1, max: 1, prompt: `${ctx.name ? ctx.name + ': ' : ''}bolster which creature?` }, 'bolster');
            if (got === SUSPEND) return SUSPEND;
            pick = (got && got.picks.length && this.obj(got.picks[0])) || pick;
          }
          this.addCounters(pick, '+1/+1', n(e.n));
          break;
        }
        /* "You get an emblem with '...'": an object in your command zone
           whose abilities were written out when the card was read. */
        case 'getEmblem': {
          const text = String(e.emblemText || e.text || '');
          const card = {
            id: 'emblem:' + U.hash((e.name || '') + '|' + text), name: 'Emblem — ' + (e.name || 'Emblem'), layout: 'emblem',
            type_line: 'Emblem', oracle_text: text, mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [],
            rarity: 'common', set: 'emb', set_name: 'Emblem', collector_number: '0', image_uris: null,
          };
          // abilities written out for it (a translated card), or else its words, read like any card's
          if (e.abilities) card._script = { abilities: e.abilities };
          const em = this._register(new GObj(card, ctx.controller, 'command'));
          em.controller = ctx.controller;
          em.ts = this._stampNew();
          this.zones[ctx.controller].command.push(em);
          this.logEvent('rules', `${me.name} gets an emblem: "${truncate(text, 90)}"`);
          this.bumpBoard();
          break;
        }
        case 'becomeMonarch': this.setMonarch(e.who === 'opponent'
          ? (this.opponentsOf(ctx.controller)[0] || me).id : ctx.controller, 'a card'); break;
        case 'takeInitiative': this.takeInitiative(ctx.controller, 'a card'); break;
        /* Venture into the dungeon (CR 701.46): into the first room of a
           dungeon of your choice, or on to the next room of the one you are
           in; the room's ability then triggers. */
        case 'venture': {
          let d = me.dungeon;
          let room;
          if (!d) {
            const names = e.undercity ? ['Undercity'] : Object.keys(DUNGEONS).filter(x => x !== 'Undercity');
            let name = names[0];
            if (names.length > 1) {
              const got = this._choose({ playerId: ctx.controller, purpose: 'dungeon', kind: 'options', min: 1, max: 1,
                options: names.map((x, i) => ({ i, label: x })), prompt: 'Venture into which dungeon?' });
              if (got === SUSPEND) return SUSPEND;
              name = names[(got && got.picks && got.picks[0]) || 0] || names[0];
            }
            d = me.dungeon = { name, room: DUNGEONS[name][0].name };
            room = DUNGEONS[name][0];
          } else {
            const rooms = DUNGEONS[d.name] || [];
            const here = rooms.find(r => r.name === d.room);
            const next = ((here && here.leads) || []).map(x => rooms.find(r => r.name === x)).filter(Boolean);
            if (!next.length) break;
            room = next[0];
            if (next.length > 1) {
              const got = this._choose({ playerId: ctx.controller, purpose: 'dungeonRoom', kind: 'options', min: 1, max: 1,
                options: next.map((r, i) => ({ i, label: r.name + ' \u2014 ' + r.text })), prompt: 'Which room next?' });
              if (got === SUSPEND) return SUSPEND;
              room = next[(got && got.picks && got.picks[0]) || 0] || next[0];
            }
            d.room = room.name;
          }
          this.logEvent('rules', `${me.name} ventures into ${d.name}: ${room.name}.`);
          const parsed = ROOM_EFFECTS[room.name] ? { auto: true, effects: JSON.parse(JSON.stringify(ROOM_EFFECTS[room.name])) }
            : O.parseEffects(room.text);
          const effects = ((parsed && parsed.effects) || [{ op: 'manual', text: room.text }]).slice();
          // the last room: once its ability is done, the dungeon is completed (CR 309.7)
          if (!room.leads.length) effects.push({ op: 'completeDungeon' });
          this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: null, objId: null, controller: ctx.controller,
            name: d.name + ' \u2014 ' + room.name, effects, auto: !!(parsed && parsed.auto), abilityText: room.text });
          this.touch();
          break;
        }
        case 'completeDungeon':
          if (me.dungeon) {
            me.dungeonsCompleted = (me.dungeonsCompleted || []).concat(me.dungeon.name);
            this.logEvent('rules', `${me.name} completes ${me.dungeon.name}.`);
            me.dungeon = null;
          }
          break;
        case 'energy': {
          const k = n(e.n) || 1;
          me.energy = (me.energy || 0) + k;
          this.logEvent('counters', `${me.name} gets ${k} energy (${me.energy}).`);
          break;
        }
        case 'payEnergy': {
          const k = n(e.n) || 1;
          if ((me.energy || 0) < k) break;
          me.energy -= k;
          this.logEvent('counters', `${me.name} pays ${k} energy (${me.energy}).`);
          break;
        }
        /* "Look at the top N cards of your library." — the cards are shown
           and go back in the same order; anything that does something with
           them says so in the next sentence, which is its own effect. */
        case 'lookTop': {
          const k = Math.max(1, n(e.n) || 1);
          const cards = this._topOfLibrary(ctx.controller, k);
          if (!cards.length) break;
          this._looked = cards.map(c => c.id);
          const seen = this._ask({ type: 'arrange', playerId: ctx.controller, count: cards.length,
            cards, look: true, prompt: `Look at the top ${k === 1 ? 'card' : k + ' cards'} of your library.` });
          if (seen === SUSPEND) return SUSPEND;
          this.logEvent('rules', `${me.name} looks at the top ${k === 1 ? 'card' : k + ' cards'}.`);
          break;
        }
        /* A colour chosen as an effect resolves, remembered on the thing
           that chose it so later sentences ("of the chosen color") and
           later turns can ask. */
        case 'chooseColor': {
          const COLORS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green']];
          /* Inside a mana ability nothing waits for an answer: the colour is
             the one being paid for, or the one most wanted. */
          if (!this.resolving) {
            const c = ctx.manaChoice && MANA.COLORS.includes(ctx.manaChoice) ? ctx.manaChoice : null;
            let best = c, most = -1;
            if (!best) for (const k of MANA.COLORS) { const d = this.devotionOf(ctx.controller, k); if (d > most) { most = d; best = k; } }
            ctx.chosenColor = best;
            ctx.manaChoice = best;
            break;
          }
          const picked = this._ask({ type: 'mode', playerId: ctx.controller, count: 1,
            options: COLORS.map((c, i) => ({ i, label: c[1] })), prompt: 'Choose a colour.' }, 'color');
          if (picked === SUSPEND) return SUSPEND;
          const idx = Array.isArray(picked) ? picked[0] : picked;
          const col = COLORS[idx == null ? 0 : idx] || COLORS[0];
          if (src) src.chosenColor = col[0];
          ctx.chosenColor = col[0];
          this.logEvent('rules', `${me.name} chooses ${col[1].toLowerCase()}.`);
          break;
        }
        case 'addManaChosen': {
          let col = (src && src.chosenColor) || ctx.chosenColor;
          // "Add {U} or one mana of the chosen color": whichever was asked for
          if (e.orSymbol && (!col || ctx.manaChoice === e.orSymbol)) col = e.orSymbol;
          if (!col) break;
          for (let i = 0; i < Math.max(1, n(e.n) || 1); i++) me.pool.add(col);
          this.logEvent('mana', `${me.name} adds ${n(e.n) || 1} ${col}.`);
          break;
        }
        /* A coin flip, with what happens either way (CR 705). */
        case 'flipCoin': {
          const won = this.rng.chance(0.5);
          this.logEvent('rules', `${me.name} flips a coin: ${won ? 'heads — they win the flip' : 'tails — they lose it'}.`);
          this.emit('coin', { playerId: ctx.controller, result: won ? 'heads' : 'tails' });
          ctx.wonFlip = won;
          const run = won ? (e.then || []) : (e.otherwise || []);
          if (run.length) this._spliceNext(run);
          break;
        }
        /* Explore (CR 701.40): look at the top card; a land goes to your
           hand, anything else gives a +1/+1 counter and you say whether it
           stays on top. */
        case 'explore': {
          const z = this.zones[ctx.controller];
          if (!z || !z.library.length) break;
          // "target creature you control explores" (a Map): that one, not the source
          const t0 = e.targets && e.targets.length ? targets.find(t => t.kind === 'object') : null;
          const who = t0 ? this.obj(t0.id) : src;
          if (t0 && !(who && who.zone === 'battlefield')) break;
          const top = z.library[0];
          const ta = top.analysis();
          if (!this._doneHere('exploreReveal')) this.logEvent('rules', `${who ? who.name : me.name} explores: ${top.name}.`);
          if (ta && ta.isLand) {
            z.library.shift();
            this.moveObject(top, 'hand', { controller: ctx.controller });
            break;
          }
          // asked a question below and run again with the answer: one counter only
          if (who && !this._doneHere('exploreCounter')) this.addCounters(who, '+1/+1', 1);
          const keep = this._ask({ type: 'confirm', playerId: ctx.controller,
            prompt: `Leave ${top.name} on top of your library?` }, 'explore');
          if (keep === SUSPEND) return SUSPEND;
          if (!keep) {
            z.library.shift();
            this.moveObject(top, 'graveyard', { controller: ctx.controller });
          }
          break;
        }
        case 'monstrosity': {
          if (!src || src.monstrous) break;
          const k = Math.max(0, n(e.n) || 0);
          this.addCounters(src, '+1/+1', k);
          src.monstrous = true;
          this.logEvent('rules', `${src.name} becomes monstrous (${k} counters).`);
          this._fire('becomesMonstrous', src.controller, { object: src, source: src });
          break;
        }
        case 'sacrificeSelf': if (src) this.moveObject(src, 'graveyard'); break;
        case 'tap':
          if (e.scope === 'attached') { const x = src && src.attachedTo && this.obj(src.attachedTo); if (x) { this._markTapped(x); this.emit('sfx', 'tap'); } break; }
          if (e.scope === 'lastTarget') { const x = firstObj(); if (x) { this._markTapped(x); this.emit('sfx', 'tap'); } }
          else if (e.scope === 'self' && src) { this._markTapped(src); this.emit('sfx', 'tap'); }
          else for (const t of targets) { if (t.kind === 'object') { const o = this.obj(t.id); if (o) { this._markTapped(o); this.emit('sfx', 'tap'); } } }
          break;
        case 'untap':
          if (e.scope === 'attached') { const x = src && src.attachedTo && this.obj(src.attachedTo); if (x) { x.tapped = false; this.emit('sfx', 'untap'); } break; }
          // "untap that land": whatever the effect before this one fetched
          if (e.scope === 'lastAffected') { const x = this._lastAffected && this.obj(this._lastAffected.id); if (x && x.zone === 'battlefield') { x.tapped = false; this.emit('sfx', 'untap'); } break; }
          if (e.scope === 'lastTarget') { const x = firstObj(); if (x) { x.tapped = false; this.emit('sfx', 'untap'); } }
          else if (e.scope === 'self' && src) { src.tapped = false; this.emit('sfx', 'untap'); }
          else for (const t of targets) { if (t.kind === 'object') { const o = this.obj(t.id); if (o) { o.tapped = false; this.emit('sfx', 'untap'); } } }
          break;
        /* "Untap up to three lands": no target, just your own, chosen as
           it resolves. */
        case 'untapChosen': {
          const pool = this.battlefield.filter(o => o.controller === ctx.controller && o.tapped &&
            this._cardFitsWords(o, e.filter || 'permanent'));
          const want = Math.min(n(e.n) || 1, pool.length);
          if (!want) break;
          let ids = pool.map(o => o.id);
          if (pool.length > want) {
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: want, optional: !!e.upTo,
              cards: pool.map(o => ({ id: o.id, name: o.name, card: o.card })),
              prompt: `Untap ${e.upTo ? 'up to ' : ''}${want} ${e.filter || 'permanent'}${want === 1 ? '' : 's'}.` }, 'untap');
            if (picked === SUSPEND) return SUSPEND;
            ids = (picked || []).filter(id => pool.some(o => o.id === id)).slice(0, want);
          }
          for (const id of ids) { const o = this.obj(id); if (o) o.tapped = false; }
          if (ids.length) { this.emit('sfx', 'untap'); this.logEvent('rules', `${me.name} untaps ${ids.length} ${e.filter || 'permanent'}${ids.length === 1 ? '' : 's'}.`); }
          break;
        }
        case 'untapAll':
          /* "Untap all Birds and Frogs you control": a group described the
             way a static ability describes one */
          if (e.scope && typeof e.scope === 'object') {
            for (const o of this._scopeList(e.scope, ctx.controller, src)) o.tapped = false;
            this.emit('sfx', 'untap_all');
            break;
          }
          for (const o of this.battlefield) {
            if (o.controller !== ctx.controller) continue;
            const a = o.analysis();
            if (e.what === 'creatures' && !(a && a.isCreature)) continue;
            if (e.what === 'lands' && !(a && a.isLand)) continue;
            if (e.what === 'nonland' && a && a.isLand) continue;
            o.tapped = false;
          }
          this.emit('sfx', 'untap_all');
          break;
        case 'pump': {
          // "until your next turn": gone as that player's next turn begins
          const apply = (o) => o.effects.push(e.duration === 'nextTurn' ? { p: n(e.p), t: n(e.t), until: null, untilTurnOf: ctx.controller }
            : { p: n(e.p), t: n(e.t), until: e.duration === 'eot' ? 'eot' : null });
          if (e.scope === 'allCreatures') {
            for (const o of this.battlefield) { const oa = o.analysis(); if (oa && oa.isCreature) apply(o); }
          } else applyToScope(e, apply);
          break;
        }
        case 'grantKeyword':
          // "That token gains haste." with no end to it is for good
          applyToScope(e, (o) => o.effects.push(e.duration === 'nextTurn'
            ? { keywords: e.keywords, until: null, untilTurnOf: ctx.controller }
            : { keywords: e.keywords, until: e.duration === 'permanent' ? null : 'eot' }));
          break;
        /* "…gains 'When this creature dies, …' until end of turn": the
           quoted ability is the creature's own until the effect ends. */
        case 'grantAbility':
          applyToScope(e, (o) => {
            /* the ability written out already (a translated card), or its words to read */
            o.effects.push(e.abilities ? { grantAbilities: e.abilities, until: e.duration === 'eot' ? 'eot' : null }
              : { grantText: e.ability, until: e.duration === 'eot' ? 'eot' : null });
            o._chr = null;
            this.logEvent('keyword', `${o.name} gains "${truncate(e.ability, 80)}"`);
          });
          this.bumpBoard();
          break;
        /* Shadowspear: "lose hexproof and indestructible until end of turn" */
        case 'loseKeyword':
          applyToScope(e, (o) => o.effects.push({ loseKeywords: e.keywords, until: e.duration === 'eot' ? 'eot' : null }));
          this.bumpBoard();
          break;
        /* Command Beacon */
        case 'commanderToHand': {
          const cmd = ((this.zones[ctx.controller] || {}).command || []).find(o => o.isCommander);
          if (cmd) { this.moveObject(cmd, 'hand'); this.logEvent('zone', `${me.name} puts ${cmd.name} into their hand.`); }
          break;
        }
        /* Scry and surveil are a decision about specific cards, so the cards
           go with the question. Only the player being asked is given them:
           a view built for anybody else carries the question without its
           contents. */
        case 'scry': case 'surveil': {
          /* The resolution waits for the answer (CR 608.2c): in "Scry 1.
             Draw a card." the draw comes after the card has been placed,
             not before. Coming back with the answer, it is already done. */
          const r = this.resolving;
          if (r && Object.prototype.hasOwnProperty.call(r.answers, r.index + ':' + e.op)) break;
          const want = n(e.n);
          const cards = this._topOfLibrary(ctx.controller, want);
          if (!cards.length) {
            this.logEvent(e.op, `${me.name} has no cards to ${e.op}.`);
            break;
          }
          const q = { type: e.op, playerId: ctx.controller, count: cards.length, cards,
            prompt: (e.op === 'scry' ? 'Scry ' : 'Surveil ') + want + '.' };
          if (r) { if (this._ask(q, e.op) === SUSPEND) return SUSPEND; break; }
          this.queueChoice(q);
          break;
        }
        case 'mill': {
          const cnt = n(e.n);
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller)
            : e.who === 'triggerPlayer' ? [triggerPlayer()]
            // "Counter target spell. Its controller mills two cards."
            : e.who === 'targetController' ? [this._lastAffectedController()]
            : (e.who === 'target' ? [firstPlayer()] : [me]);
          // "…from among the milled cards": what this mill put there
          this._lastMilled = [];
          for (const p of who) {
            if (!p) continue;
            for (let i = 0; i < cnt; i++) { const o = this.zones[p.id].library.shift(); if (!o) break; this.moveObject(o, 'graveyard'); this._lastMilled.push(o.id); }
            this.logEvent('mill', `${p.name} mills ${cnt}.`);
          }
          break;
        }
        /* "Mill four cards. You may put a creature card from among the
           milled cards into your hand." */
        case 'takeFromMilled': {
          const pool = (this._lastMilled || []).map(id => this.obj(id))
            .filter(o => o && o.zone === 'graveyard' && o.owner === ctx.controller &&
              (!e.filter || e.filter === 'any' || this._cardFitsWords(o, e.filter)));
          if (!pool.length) break;
          const want = Math.min(n(e.n) || 1, pool.length);
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: want,
            cards: pool.map(o => ({ id: o.id, name: o.name, card: o.card })),
            optional: e.optional !== false, prompt: e.prompt || `Choose ${want === 1 ? 'a card' : want + ' cards'} to put into your hand.` });
          if (picked === SUSPEND) return SUSPEND;
          for (const id of (picked || []).slice(0, want)) {
            const o = this.obj(id);
            if (o && pool.includes(o)) { this.moveObject(o, 'hand'); this.logEvent('rules', `${me.name} puts ${o.name} into their hand.`); }
          }
          break;
        }
        case 'createToken': {
          const owner = e.who === 'targetController'
            ? (this._lastAffectedController() || me) : me;
          // "create X tokens" makes as many as X was; "a token for each land you control", one per land
          const many = e.count ? n(e.count) * (n(e.n) || 1) : (e.countBy ? e.n : n(e.n));
          this._createToken(owner.id, Object.assign({}, e, { n: many }));
          break;
        }
        case 'createNamedToken': {
          // "Its controller creates two Treasure tokens" — An Offer You Can't Refuse
          const owner = e.who === 'targetController' ? (this._lastAffectedController() || me)
            : e.who === 'opponents' ? null : me;
          if (owner) this._createNamedToken(owner.id, Object.assign({}, e, { n: n(e.n) || 1 }));
          else for (const p of this.opponentsOf(ctx.controller)) this._createNamedToken(p.id, Object.assign({}, e, { n: n(e.n) || 1 }));
          break;
        }
        /* --- mass effects --- */
        case 'destroyAll': case 'exileAll': case 'bounceAll': {
          const want = e.what || 'creature';
          // "all artifacts and enchantments" names two types, so test them all
          const match = (x) => {
            const xa = x.analysis();
            if (!xa) return false;
            if (/nonland/.test(want)) return !xa.isLand;
            if (/permanent/.test(want)) return true;
            return (/creature/.test(want) && xa.isCreature) ||
              (/artifact/.test(want) && xa.isArtifact) ||
              (/enchantment/.test(want) && xa.isEnchantment) ||
              (/planeswalker/.test(want) && xa.isPlaneswalker) ||
              (/\bland/.test(want) && xa.isLand);
          };
          const zone = e.op === 'destroyAll' ? 'graveyard' : e.op === 'exileAll' ? 'exile' : 'hand';
          const cap = (v) => (v === 'X' ? (ctx.x || (src && src.chosenX) || 0) : v);
          let n = 0;
          /* Everything that goes, goes at once: the list is settled before
             anything moves, so losing an anthem halfway through does not
             change what the sweep was about. */
          const pool = e.scope && typeof e.scope === 'object'
            ? this._scopeList(e.scope, ctx.controller, src, (firstPlayer() || me).id)
            : this.battlefield.slice().filter(x => !x.phasedOut && match(x));
          const victims = pool.filter(x => {
            if (e.withoutCounter && (x.counters[e.withoutCounter] || 0) > 0) return false;
            if (e.maxMv != null && ((x.card && x.card.cmc) || 0) > cap(e.maxMv)) return false;
            if (e.minMv != null && ((x.card && x.card.cmc) || 0) < cap(e.minMv)) return false;
            if (e.minPower != null && this.powerOf(x) < e.minPower) return false;
            if (e.maxPower != null && this.powerOf(x) > e.maxPower) return false;
            if (e.op === 'destroyAll' && this.hasKw(x, 'indestructible')) return false;
            return true;
          });
          // the ones going together see each other go (CR 603.10a)
          this._leavingTogether = victims;
          for (const x of victims) {
            if (x.zone !== 'battlefield') continue;
            if (e.op === 'destroyAll' && this._totemArmor(x)) continue;
            if (e.op === 'destroyAll' && !e.noRegen && this._regenerated(x)) continue;
            this.moveObject(x, zone);
            n++;
          }
          this._leavingTogether = null;
          this._lastSweep = n;
          this.logEvent('wipe', `${e.op === 'destroyAll' ? 'Destroys' : e.op === 'exileAll' ? 'Exiles' : 'Returns'} ${n} ${want}${n === 1 ? '' : 's'}.`);
          this.emit('sfx', n >= 3 ? 'wipe' : 'destroy', { size: n });
          break;
        }
        case 'tapAll': {
          if (e.scope && typeof e.scope === 'object') {
            for (const x of this._scopeList(e.scope, ctx.controller, src)) this._markTapped(x);
            this.emit('sfx', 'tap');
            break;
          }
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller).map(p => p.id) : [ctx.controller];
          for (const x of this.battlefield) {
            if (!who.includes(x.controller)) continue;
            const xa = x.analysis();
            if (e.what === 'creatures' && !(xa && xa.isCreature)) continue;
            this._markTapped(x);
          }
          this.emit('sfx', 'tap');
          break;
        }
        case 'sacrificeChoice': {
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller)
            : e.who === 'each' ? this.players.filter(p => !p.hasLost)
            : e.who === 'you' ? [me].filter(Boolean)
            : e.who === 'triggerPlayer' ? [triggerPlayer()].filter(Boolean)
            : [firstPlayer()].filter(Boolean);
          for (const p of who) {
            const pool = this.battlefield.filter(x => {
              const xa = x.analysis();
              if (x.controller !== p.id || !xa || x.phasedOut) return false;
              // "another creature" never means the one doing the asking
              if (e.other && src && x.id === src.id) return false;
              return !e.filter || e.filter === 'permanent' || this._cardFitsWords(x, e.filter);
            });
            if (!pool.length) {
              if (e.orDiscard && this.zones[p.id].hand.length) {
                this.queueChoice({ type: 'discard', playerId: p.id, count: 1, prompt: 'You have nothing to sacrifice: discard a card.' });
              }
              continue;
            }
            this.queueChoice({
              type: 'sacrifice', playerId: p.id, count: Math.min(n(e.n), pool.length),
              filter: e.filter || 'permanent', candidates: pool.map(x => x.id),
              prompt: `Sacrifice ${n(e.n)} ${e.filter || 'permanent'}${n(e.n) === 1 ? '' : 's'}.`,
            });
          }
          break;
        }

        /* --- interaction --- */
        /* Class cards (CR 716): buying the next level puts the counter on
           and sets off whatever that level was waiting for. */
        case 'classLevel': {
          const x = src;
          if (!x) break;
          const want = Math.max(0, (e.to || 2) - 1);
          if ((Number(x.counters.level) || 0) >= want) break;
          x.counters.level = want;
          x._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${x.name} becomes level ${e.to}.`);
          this._fire('classLevel', x.controller, { object: x, source: x, level: e.to });
          break;
        }

        /* "Untap those creatures." — the ones the sentence before touched. */
        case 'untapThose': {
          const ids = this._lastGroup || [];
          let n2 = 0;
          for (const id of ids) { const x = this.obj(id); if (x && x.tapped) { x.tapped = false; n2++; } }
          if (n2) this.logEvent('rules', `${n2} creature${n2 === 1 ? '' : 's'} untap.`);
          break;
        }

        /* Connive N (CR 702.153): draw that many, throw that many away, and
           grow for each nonland thrown. */
        case 'connive': {
          const count = n(e.n) || 1;
          const who = this.player(ctx.controller);
          const x = e.scope === 'self' ? src
            : (targets[0] && targets[0].kind === 'object' && this.obj(targets[0].id)) || src;
          if (!who) break;
          this._drawCards(who, count);
          const hand = (this.zones[who.id] || {}).hand || [];
          const toss = hand.slice(-count);
          let grew = 0;
          for (const c of toss) {
            const ca = c.analysis();
            if (ca && !ca.isLand) grew++;
            this.moveObject(c, 'graveyard');
            this._afterDiscard(who.id, c);
          }
          if (x && grew) this.addCounters(x, '+1/+1', grew);
          this.logEvent('rules', `${x ? x.name : who.name} connives${grew ? ` and grows by ${grew}` : ''}.`);
          break;
        }

        /* Cipher (CR 702.99): "Then you may exile this spell card encoded
           on a creature you control." Which creature is a generic question,
           with "none" as an answer. */
        case 'cipher': {
          const card = ctx.obj;
          if (!card || card.zone !== 'stack' || card.isCopy) break;
          const mine = this.battlefield.filter(x => x.controller === ctx.controller && !x.phasedOut && (this.characteristics(x) || {}).isCreature);
          if (!mine.length) break;
          const got = this._choose({ playerId: ctx.controller, purpose: 'cipher', kind: 'objects', zone: 'battlefield',
            items: this._chooseItems(mine), min: 0, max: 1,
            prompt: `Encode ${card.name} on a creature you control? Each time it deals combat damage to a player, you may cast a copy.` });
          if (got === SUSPEND) return SUSPEND;
          const host = got && got.picks.length ? this.obj(got.picks[0]) : null;
          if (!host || host.zone !== 'battlefield') break;
          this.moveObject(card, 'exile');
          card.encodedOn = host.id;
          host.encoded = (host.encoded || []).concat(card.id);
          this.logEvent('rules', `${me.name} encodes ${card.name} on ${host.name}.`);
          break;
        }
        /* "Choose an opponent." Not a target: a generic question about
           players, and "that player" afterwards is the one chosen. */
        case 'chooseOpponent': {
          const opps = this.opponentsOf(ctx.controller).filter(p => !p.hasLost);
          const got = this._choose({ playerId: ctx.controller, purpose: 'chooseOpponent', kind: 'players',
            items: this._choosePlayers(opps), min: 1, max: 1, prompt: 'Choose an opponent.' });
          if (got === SUSPEND) return SUSPEND;
          const pick = got && got.picks.length ? this.player(got.picks[0]) : null;
          if (pick) {
            ctx.chosenPlayer = pick.id;
            this.logEvent('rules', `${me.name} chooses ${pick.name}.`);
          }
          break;
        }
        /* The encoded card's copy, cast for nothing as the cipher trigger
           resolves. The copy is cast — it counts for everything that
           watches spells being cast — but it is not a card, and when it
           leaves the stack it is gone. */
        case 'castEncoded': {
          const card = this.obj(e.cardId);
          const host = src;
          if (!card || card.zone !== 'exile' || !host || card.encodedOn !== host.id) break;
          const dup = this._register(new GObj(card.card, ctx.controller, 'exile'));
          dup.isCopy = true;
          this.zones[ctx.controller].exile.push(dup);
          const ok = this.castSpell(ctx.controller, dup.id, { free: true, alternative: 'resolution', targets: [], auto: true });
          const st = this.stack.find(x => x.objId === dup.id);
          if (ok && st) {
            st.isCopy = true;
            this.logEvent('copy', `${me.name} casts a copy of ${card.name} (cipher).`);
          } else {
            this._removeFromZone(dup);
            dup.zone = null;
          }
          break;
        }

        /* "…copy that spell." — the one whose casting set this off. */
        case 'copyThatSpell': {
          const id = (ctx.triggerData && ctx.triggerData.stackId) || null;
          const r = this.resolving;
          const slot = r ? r.index + ':copies' : null;
          r && (r.marks = r.marks || {});
          let made = r && r.marks[slot];
          if (!made) {
            const item = id ? this.stack.find(st => st.id === id) : null;
            if (!item || !item.obj) { this.logEvent('rules', 'That spell is no longer on the stack.'); break; }
            made = [];
            for (let k = 0; k < Math.max(1, n(e.n || 1)); k++) made.push(this._copyOnStack(item, ctx.controller).id);
            if (r) r.marks[slot] = made;
            this.logEvent('copy', `${me.name} copies ${item.name || 'the spell'}${made.length > 1 ? ' ' + made.length + ' times' : ''}.`);
            this.emit('sfx', 'cast');
          }
          for (let k = 0; k < made.length; k++) {
            const copy = this.stack.find(x => x.id === made[k]);
            if (copy && this._newTargetsForCopy(copy, ctx.controller, 'nt' + k) === SUSPEND) return SUSPEND;
          }
          break;
        }

        /* "Target creature deals damage to itself equal to its power." */
        case 'selfBite': {
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const x = this.obj(t.id);
            if (!x) continue;
            const amount = this.powerOf(x);
            this.dealDamageToObject(x, amount, x);
            this.logEvent('damage', `${x.name} deals ${amount} damage to itself.`);
          }
          break;
        }

        /* A one-sided fight: it hits, nothing hits back. */
        case 'bite': {
          const objs = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          const biter = objs[0];
          if (!biter) { this.logEvent('rules', 'Nothing to deal the damage.'); break; }
          if (e.counterFirst && !this._doneHere('ctr')) this.addCounters(biter, e.counterFirst, 1);
          const amount = this.powerOf(biter);
          if (e.toPlayer) {
            const pt = targets.find(t => t.kind === 'player');
            const who = pt ? this.player(pt.id) : this.opponentsOf(ctx.controller)[0];
            if (who) { this.dealDamageToPlayer(who, amount, biter); this.logEvent('damage', `${biter.name} deals ${amount} to ${who.name}.`); }
            break;
          }
          const victim = objs[1];
          if (!victim) { this.logEvent('rules', 'Nothing to bite.'); break; }
          this.dealDamageToObject(victim, amount, biter);
          this.logEvent('fight', `${biter.name} deals ${amount} damage to ${victim.name}.`);
          this.emit('sfx', 'damage');
          break;
        }
        case 'fight': {
          const objs = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          if (objs.length < 2) { this.logEvent('rules', 'Fight needs two creatures.'); break; }
          const [x, y] = objs;
          this.dealDamageToObject(y, this.powerOf(x), x);
          this.dealDamageToObject(x, this.powerOf(y), y);
          this.logEvent('fight', `${x.name} fights ${y.name}.`);
          this.emit('sfx', 'damage');
          break;
        }
        /* "It fights up to one target creature you don't control": this
           creature against the one it points at */
        case 'fightSelf': {
          const y = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).find(Boolean);
          if (!src || src.zone !== 'battlefield' || !y || y.zone !== 'battlefield') break;
          const ys = this.characteristics(y), ss = this.characteristics(src);
          if (!(ys && ys.isCreature) || !(ss && ss.isCreature)) break;
          this.dealDamageToObject(y, this.powerOf(src), src);
          this.dealDamageToObject(src, this.powerOf(y), y);
          this.logEvent('fight', `${src.name} fights ${y.name}.`);
          this.emit('sfx', 'damage');
          break;
        }
        case 'gainControl': {
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const x = this.obj(t.id);
            if (!x || x.zone !== 'battlefield') continue;
            /* A control effect in layer 2, as new as anything on the table:
               Threaten's ends with the turn, Dominate's lasts. */
            x.effects.push({ control: ctx.controller, until: e.until === 'eot' ? 'eot' : null, ts: this._stampNew() });
            if (e.untap) x.tapped = false;
            this.logEvent('control', `${me.name} gains control of ${x.name}.`);
          }
          this._refreshControl();
          // "It gains haste until end of turn" (Act of Treason) is about this creature
          this._noteLastAffected(targets);
          break;
        }
        /* Switcheroo: "Exchange control of two target creatures." Both
           change hands at once, or neither does (CR 701.12b). */
        case 'exchangeControl': {
          const pair = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(x => x && x.zone === 'battlefield');
          if (pair.length !== 2 || pair[0].controller === pair[1].controller) {
            this.logEvent('control', 'Nothing changes hands.');
            break;
          }
          const [x, y] = pair;
          const ts = this._stampNew();
          const until = e.until === 'eot' ? 'eot' : null;
          const cx = x.controller, cy = y.controller;
          x.effects.push({ control: cy, until, ts });
          y.effects.push({ control: cx, until, ts });
          this._refreshControl();
          this.logEvent('control', `${x.name} and ${y.name} change hands.`);
          break;
        }
        case 'untapHaste': {
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const x = this.obj(t.id);
            if (!x) continue;
            x.tapped = false;
            x.effects.push({ keywords: ['Haste'], until: 'eot' });
          }
          break;
        }
        case 'counterUnless': {
          for (const t of targets) {
            const item = this.stack.find(st => st.id === t.id);
            if (!item) continue;
            const payer = this.player(item.controller);
            if (payer.isBot && this.payMana(item.controller, e.cost, { auto: true })) {
              this.logEvent('counter', `${payer.name} pays ${e.cost} to keep ${item.name}.`);
            } else if (!payer.isBot) {
              this.queueChoice({
                type: 'payOrCounter', playerId: item.controller, cost: e.cost, stackId: item.id,
                prompt: `Pay ${e.cost} or ${item.name} is countered.`,
              });
            } else {
              item.countered = true;
              this.logEvent('counter', `${item.name} is countered \u2014 ${payer.name} did not pay ${e.cost}.`);
              this.emit('sfx', 'counter');
            }
          }
          break;
        }
        case 'proliferate': {
          let n2 = 0;
          for (const x of this.battlefield) {
            if (x.controller !== ctx.controller) continue;
            for (const k of Object.keys(x.counters)) { if (x.counters[k] > 0) { x.counters[k]++; n2++; } }
          }
          for (const p of this.players) if (p.poison > 0) { p.poison++; n2++; }
          this.logEvent('proliferate', `Proliferate adds ${n2} counter${n2 === 1 ? '' : 's'}.`);
          break;
        }

        /* --- library and graveyard --- */
        case 'fetchBasic': {
          const z = this.zones[ctx.controller];
          if (e.who !== 'targetController' && !this._doneHere('searched')) this._searched(ctx.controller);
          let found = 0;
          /* "Mountaincycling" wants a Mountain, not any basic: the filter
             names the land type when the card names one. */
          const want = String(e.filter || '').toLowerCase().replace(/ ?lands?$/, '').trim();
          const wanted = (ca) => {
            if (!ca || !ca.isLand) return false;
            if (!want || want === 'basic') return !!ca.isBasicLand;
            return (ca.subtypes || []).some(t => t.toLowerCase() === want);
          };
          for (let i = 0; i < n(e.n); i++) {
            const idx = z.library.findIndex(c => wanted(c.analysis()));
            if (idx < 0) break;
            const [c] = z.library.splice(idx, 1);
            this.moveObject(c, 'battlefield', { controller: ctx.controller });
            if (e.tapped) c.tapped = true;
            found++;
          }
          this.rng.shuffle(z.library);
          this.logEvent('search', `${me.name} fetches ${found} basic land${found === 1 ? '' : 's'}.`);
          this.emit('sfx', 'shuffle');
          break;
        }
        /* Searching your library means looking through all of it and taking
           what you want, so this offers the legal cards rather than taking
           the first one it finds. Where they go is up to the card: a hand, a
           graveyard, the top of the library, or straight onto the table. */
        case 'tutor': {
          /* "Its controller may search their library" is somebody else's
             search: their library, and their choice. */
          const seeker = e.who === 'targetController' ? (this._lastAffectedController() || me) : me;
          if (!this._doneHere('searched')) this._searched(seeker.id);
          const z = this.zones[seeker.id];
          const want = String(e.filter || 'any').toLowerCase();
          const mvOf = (c) => (c.card && c.card.cmc) || 0;
          const matches = (c) => {
            /* Transmute looks for a mana value, not a card type. */
            if (e.mv != null && mvOf(c) !== n(e.mv)) return false;
            if (e.maxMv != null && mvOf(c) > n(e.maxMv)) return false;
            if (e.minMv != null && mvOf(c) < n(e.minMv)) return false;
            // Imperial Recruiter, Recruiter of the Guard: printed power or toughness
            const stat = (k) => parseInt((c.card && c.card[k]) || '0', 10) || 0;
            if (e.maxPower != null && stat('power') > e.maxPower) return false;
            if (e.minPower != null && stat('power') < e.minPower) return false;
            if (e.maxToughness != null && stat('toughness') > e.maxToughness) return false;
            if (e.minToughness != null && stat('toughness') < e.minToughness) return false;
            const ca = c.analysis();
            if (e.basicType && !(ca && (ca.subtypes || []).some(t => MANA.COLOR_OF_BASIC[t]))) return false;
            if (e.manaCostIn && !e.manaCostIn.includes(String((c.card && c.card.mana_cost) || ''))) return false;
            if (e.mvOfSacrificedPlus != null) {
              const sac = (ctx.sacrificed || [])[0];
              if (!sac || mvOf(c) !== sac.mv + e.mvOfSacrificedPlus) return false;
            }
            if (want === 'any' || want === '') return true;
            if (want === 'basic land') return !!(ca && ca.isBasicLand);
            if (e.named) return (c.card.name || '').toLowerCase() === String(e.named).toLowerCase();
            /* "an Island or Swamp card" is either one, and "a basic Forest
               card" is both words at once. */
            return this._cardFitsWords(c, want);
          };
          const legal = z.library.filter(matches)
            .concat(e.alsoGraveyard ? z.graveyard.filter(matches) : []);
          const want_n = Math.min(n(e.n), legal.length);
          let taken = [];
          if (want_n > 0) {
            const picked = this._ask({ type: 'pickCard', playerId: seeker.id, count: want_n,
              cards: legal.map(o => ({ id: o.id, name: o.name, card: o.card })),
              optional: true, fromLibrary: true,
              prompt: e.prompt || `Search your library${want === 'any' ? '' : ' for ' + want}.` }, 'tutor');
            if (picked === SUSPEND) return SUSPEND;
            const ok = new Set(legal.map(o => o.id));
            taken = (picked || []).filter(id => ok.has(id)).slice(0, want_n).map(id => this.obj(id)).filter(Boolean);
            taken = taken.filter((c, i) => taken.indexOf(c) === i);
            /* "with different names", "that share a land type": anything
               picked that breaks the rule is put back. */
            if (e.differentNames) taken = taken.filter((c, i) => taken.findIndex(x => x.name === c.name) === i);
            if (e.shareType && taken.length > 1) {
              const typesOf = (c) => ((c.analysis() || {}).subtypes || []).filter(t => MANA.COLOR_OF_BASIC[t]);
              const first = typesOf(taken[0]);
              taken = [taken[0]].concat(taken.slice(1).filter(c => typesOf(c).some(t => first.includes(t))));
            }
          }
          const dest = e.to || 'hand';
          /* Cultivate: one of them onto the battlefield, the other into
             your hand — and which is which is the searcher's call. */
          let toField = new Set();
          if (dest === 'split' && taken.length) {
            const k = Math.min((e.split && e.split.battlefield) || 1, taken.length);
            if (taken.length > k) {
              const which = this._ask({ type: 'pickCard', playerId: seeker.id, count: k,
                cards: taken.map(o => ({ id: o.id, name: o.name, card: o.card })),
                prompt: 'Choose the land to put onto the battlefield.' }, 'split');
              if (which === SUSPEND) return SUSPEND;
              toField = new Set((which || []).slice(0, k));
            }
            for (const c of taken) if (toField.size < k && !toField.has(c.id)) toField.add(c.id);
          }
          for (const c of taken) {
            const i = z.library.indexOf(c);
            if (i >= 0) z.library.splice(i, 1);
            if (c.zone === 'graveyard' && e.alsoGraveyard) { this.moveObject(c, dest === 'battlefield' ? 'battlefield' : 'hand', { controller: seeker.id }); continue; }
            const where = dest === 'split' ? (toField.has(c.id) ? 'battlefield' : 'hand')
              : dest === 'landField' ? ((c.analysis() || {}).isLand ? 'battlefield' : 'hand') : dest;
            const tapped = dest === 'split' ? !!(e.split && e.split.tapped) : dest === 'landField' ? true : !!e.tapped;
            if (where === 'battlefield') { this.moveObject(c, 'battlefield', { controller: seeker.id }); if (tapped) c.tapped = true; }
            else if (where === 'graveyard') this.moveObject(c, 'graveyard', { controller: seeker.id });
            else if (where === 'top' || where === 'bottom') {
              // shuffle first, then put it where the card says (CR 701.19)
              this.rng.shuffle(z.library);
              c.zone = 'library';
              if (where === 'top') z.library.unshift(c); else z.library.push(c);
            } else this.moveObject(c, 'hand', { controller: seeker.id });
          }
          this._lastSearched = taken.map(c => c.id);
          if (taken.length) this._noteLastAffected([{ kind: 'object', id: taken[taken.length - 1].id }]);
          if (!taken.length || !(dest === 'top' || dest === 'bottom')) this.rng.shuffle(z.library);
          const where = dest === 'graveyard' ? ' into their graveyard'
            : dest === 'top' ? ' onto the top of their library'
            : dest === 'bottom' ? ' onto the bottom of their library'
            : dest === 'battlefield' ? ' onto the battlefield' : dest === 'split' ? ' (one onto the battlefield)' : '';
          this.logEvent('search', `${seeker.name} searches their library and takes ${taken.length} card${taken.length === 1 ? '' : 's'}${where}.`);
          this.emit('sfx', 'shuffle');
          break;
        }
        case 'blink': {
          const list = e.self ? [src].filter(Boolean)
            : targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          for (const x of list) {
            if (x.zone !== 'battlefield') continue;
            const owner = x.owner || x.controller;
            this.moveObject(x, 'exile');
            this._lastExiled = x.id;
            const back = this.obj(x.id) || x;
            this.moveObject(back, 'battlefield', { controller: owner });
            this.logEvent('blink', `${x.name} flickers out and returns.`);
          }
          this.emit('sfx', 'blink');
          break;
        }
        case 'drain': {
          const amt = n(e.n);
          const who = e.who === 'target' ? [firstPlayer()].filter(Boolean) : this.opponentsOf(ctx.controller);
          let total = 0;
          for (const p of who) { if (p.hasLost) continue; this.changeLife(p, -amt, 'drain'); total += amt; }
          if (total) this.changeLife(me, total, 'drain');
          break;
        }
        /* "Copy target instant or sorcery spell", "Copy target triggered
           ability you control" (CR 707.10): the copy goes on the stack
           above the original, and its controller may choose new targets
           for it. The copies are made once; if choosing the targets has to
           stop and ask, the same copies are there when it starts again. */
        case 'copySpell': {
          const r = this.resolving;
          const slot = r ? r.index + ':copies' : null;
          r && (r.marks = r.marks || {});
          let made = r && r.marks[slot];
          if (!made) {
            made = [];
            // "copy this spell" (Sevinne's Reclamation) copies the one resolving
            const sources = e.self ? [ctx] : targets.map(t => this.stack.find(x => x.id === t.id || x.objId === t.id));
            for (const item of sources) {
              if (!item) continue;
              made.push(this._copyOnStack(item, ctx.controller).id);
              this.logEvent('copy', `${me.name} copies ${item.name || 'the spell'}.`);
            }
            if (r) r.marks[slot] = made;
            this.emit('sfx', 'cast');
          }
          for (let k = 0; k < made.length; k++) {
            const copy = this.stack.find(x => x.id === made[k]);
            if (copy && this._newTargetsForCopy(copy, ctx.controller, 'nt' + k) === SUSPEND) return SUSPEND;
          }
          break;
        }
        case 'reanimate': {
          this._noteLastAffected(targets);
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const x = this.obj(t.id);
            if (x) {
              this.moveObject(x, 'battlefield', { controller: ctx.controller });
              if (e.tapped) x.tapped = true;
              // Persist: "with a -1/-1 counter on it"
              if (e.counter && x.zone === 'battlefield') this.addCounters(x, e.counter, 1);
              this.logEvent('reanimate', `${me.name} reanimates ${x.name}.`);
            }
          }
          break;
        }
        case 'returnFromGrave': {
          const x = this.obj(e.objId);
          if (x && x.zone === 'graveyard') {
            this.moveObject(x, 'battlefield', { controller: ctx.controller });
            this.addCounters(x, e.counter, 1);
            this.logEvent('keyword', `${x.name} returns with a ${e.counter} counter.`);
          }
          break;
        }
        case 'exileGraveyard': {
          const who = e.who === 'all' ? this.players : e.who === 'opponents' ? this.opponentsOf(ctx.controller)
            : [firstPlayer()].filter(Boolean);
          for (const p of who) {
            const gy = this.zones[p.id].graveyard.slice();
            for (const c of gy) this.moveObject(c, 'exile');
            this.logEvent('exile', `${p.name}'s graveyard is exiled (${gy.length}).`);
          }
          break;
        }
        case 'drawDiscard': {
          const drew = n(e.n), toss = e.discard == null ? drew : n(e.discard);
          this._drawCards(me, drew);
          const can = Math.min(toss, this.zones[ctx.controller].hand.length);
          if (can > 0) this.queueChoice({ type: 'discard', playerId: ctx.controller, count: can, prompt: `Discard ${can}.` });
          break;
        }
        /* Timetwister: hand and graveyard shuffled into the library, then
           a new hand of N, for each player or for you alone */
        case 'twister': {
          const live = e.who === 'you' ? [me] : this.players.filter(p => !p.hasLost);
          for (const p of live) {
            const z = this.zones[p.id];
            for (const o of z.hand.concat(z.graveyard)) { this._removeFromZone(o); o.zone = 'library'; z.library.push(o); }
            this.rng.shuffle(z.library);
          }
          this.emit('sfx', 'shuffle');
          for (const p of live) this._drawCards(p, n(e.n) || 7);
          this.logEvent('wheel', `${live.length > 1 ? 'Everyone shuffles' : me.name + ' shuffles'} hand and graveyard away and draws ${n(e.n) || 7}.`);
          break;
        }
        // "Target creature can't be regenerated this turn."
        case 'noRegen':
          applyToScope(e, (o) => { o.noRegenThisTurn = true; });
          break;
        /* "Discard your hand." */
        case 'becomeBasicType': {
          const x = e.scope === 'self' ? src : firstObj();
          if (!x || x.zone !== 'battlefield') break;
          const types = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
          const got = this._choose({ playerId: ctx.controller, purpose: 'basicLandType', kind: 'options', min: 1, max: 1,
            options: types.map((t, i) => ({ i, label: t })), prompt: `${x.name} becomes which basic land type until end of turn?` });
          if (got === SUSPEND) return SUSPEND;
          const t = types[(got && got.picks && got.picks[0]) || 0];
          x.effects.push({ setSubtypes: [t], until: 'eot' });
          x._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${x.name} becomes a ${t} until end of turn.`);
          break;
        }
        case 'becomePrepared':
          if (src && src.zone === 'battlefield' && !src.prepared) {
            src.prepared = true;
            this.logEvent('rules', `${src.name} becomes prepared.`);
          }
          break;
        case 'discardHand': {
          for (const c of this.zones[ctx.controller].hand.slice()) { this.moveObject(c, 'graveyard'); this._afterDiscard(ctx.controller, c); }
          this.logEvent('discard', `${me.name} discards their hand.`);
          break;
        }
        case 'wheel': {
          /* Everybody discards, and only then does anybody draw — and
             Windfall's "the greatest number discarded" is counted first. */
          // "Discard all the cards in your hand, then draw that many cards": you alone
          const live = e.who === 'you' ? [me] : this.players.filter(p => !p.hasLost);
          const counts = live.map(p => this.zones[p.id].hand.length);
          const most = counts.length ? Math.max(...counts) : 0;
          for (const p of live) {
            for (const c of this.zones[p.id].hand.slice()) { this.moveObject(c, 'graveyard'); this._afterDiscard(p.id, c); }
          }
          live.forEach((p, i) => {
            const k = e.n === 'mostDiscarded' ? most : e.n === 'sameDiscarded' ? counts[i] : (n(e.n) || 7);
            this._drawCards(p, k);
          });
          this.logEvent('wheel', 'Everyone discards their hand and draws a new one.');
          break;
        }
        /* "Look at the top three cards of your library, then put them back
           in any order." */
        case 'arrangeTop': {
          const k = Math.max(1, n(e.n) || 1);
          const cards = this._topOfLibrary(ctx.controller, k);
          if (!cards.length) break;
          const order = this._ask({ type: 'arrange', playerId: ctx.controller, count: cards.length, cards,
            prompt: `Put the top ${cards.length === 1 ? 'card' : cards.length + ' cards'} back in any order.` }, 'arr');
          if (order === SUSPEND) return SUSPEND;
          const z = this.zones[ctx.controller];
          const top = z.library.slice(0, cards.length);
          const want = ((order && order.top) || []).map(id => top.find(o => o.id === id)).filter(Boolean);
          for (const o of top) if (!want.includes(o)) want.push(o);
          z.library.splice(0, top.length, ...want);
          this.logEvent('rules', `${me.name} puts the top ${top.length} back in the order they choose.`);
          break;
        }
        case 'setLife': {
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller) : [me];
          for (const p of who) { p.life = e.n; this.logEvent('life', `${p.name}'s life becomes ${e.n}.`); }
          break;
        }

        /* ===== effects that stop to ask somebody something ===== */

        /* "You may draw a card." — a plain yes/no, then the rest of the
           sentence runs only if they said yes. The follow-on effects are
           spliced into the list rather than run here, so they can ask
           questions of their own. */
        /* "If you control three or more artifacts, draw a card." The check is
           made as the effect resolves, on the state at that moment. */
        case 'ifCond': {
          if (this._condMet(e.cond, ctx)) this._spliceNext(e.then);
          else if (e.otherwise && e.otherwise.length) this._spliceNext(e.otherwise);
          break;
        }

        /* "Return a land you control to its owner's hand" — the Karoo lands.
           Nothing is targeted: you choose one of your own as it resolves,
           and the land itself is a legal choice. */
        case 'returnOwn': {
          if (e.self) {
            if (src && src.zone === 'battlefield') {
              this.moveObject(src, 'hand');
              this.logEvent('bounce', `${me.name} returns ${src.name} to their hand.`);
            }
            break;
          }
          const list = this.battlefield.filter(o => o.controller === ctx.controller &&
            !(e.other && o === src) && this._matchesCategory(o, e.filter || 'permanent'));
          if (!list.length) break;
          const want = Math.min(n(e.n) || 1, list.length);
          const what = e.filter || 'permanent';
          const picked = this._ask({
            type: 'pickCard', playerId: ctx.controller, count: want, worst: true,
            cards: list.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: `Return ${want === 1 ? 'a' : want} ${what}${want === 1 ? '' : 's'} you control to your hand.`,
          }, 'own');
          if (picked === SUSPEND) return SUSPEND;
          for (const id of (picked || []).slice(0, want)) {
            const o = this.obj(id);
            if (!o || o.zone !== 'battlefield') continue;
            this.moveObject(o, 'hand');
            this.logEvent('bounce', `${me.name} returns ${o.name} to their hand.`);
          }
          this.emit('sfx', 'bounce');
          break;
        }

        case 'may': {
          const who = e.who === 'target' ? (firstPlayer() || me) : me;
          const yes = this._ask({ type: 'confirm', playerId: who.id,
            prompt: e.prompt || `${ctx.name || 'Effect'}: ${truncate(e.text || 'do it', 90)}` });
          if (yes === SUSPEND) return SUSPEND;
          if (yes) this._spliceNext(e.then);
          else this.logEvent('rules', `${who.name} declines.`);
          break;
        }

        /* "You may discard a card. If you do, draw a card." — the follow-on
           happens only if the cost was actually paid, which is why this asks
           twice: once for the offer, once for what to pay it with. */
        case 'mayPay': {
          const pay = e.pay || {};
          /* A price that cannot be paid is not offered: "you may pay {1}
             and discard a card" with no card in hand is a no. */
          const able = (!pay.mana || this.couldPay(ctx.controller, pay.mana, this.manaSources(ctx.controller))) &&
            (pay.life == null || me.life > pay.life || this.config.rulesEnforcement !== 'full') &&
            (!pay.removeCounter || (src && (Number(src.counters[pay.removeCounter.kind]) || 0) >= (pay.removeCounter.n || 1))) &&
            (!pay.discard || this.zones[ctx.controller].hand.length > 0);
          if (!able && (pay.removeCounter || (pay.mana && (pay.life != null || pay.discard)))) { this._spliceNext(e.otherwise); break; }
          const yes = this._ask({ type: 'confirm', playerId: ctx.controller,
            prompt: e.prompt || `${ctx.name || 'Effect'}: ${truncate(e.text || 'pay the cost', 90)}` }, 'q');
          if (yes === SUSPEND) return SUSPEND;
          if (!yes) { this._spliceNext(e.otherwise); break; }
          /* Two prices at once: the simple halves are paid here, once. */
          if (pay.removeCounter || (pay.mana && (pay.life != null || pay.discard))) {
            if (!this._doneHere('paid')) {
              if (pay.mana && !this.payMana(ctx.controller, pay.mana, { auto: true })) { this._spliceNext(e.otherwise); break; }
              if (pay.life != null) this.changeLife(me, -pay.life, 'cost');
              if (pay.removeCounter && src) {
                const k = pay.removeCounter.kind;
                src.counters[k] = (Number(src.counters[k]) || 0) - (pay.removeCounter.n || 1);
                if (src.counters[k] <= 0) delete src.counters[k];
                src._chr = null; this.bumpBoard();
              }
            }
            if (!pay.discard) { this._spliceNext(e.then); break; }
          }
          if (pay.life != null && !pay.mana) {
            if (me.life <= pay.life && this.config.rulesEnforcement === 'full') { this._spliceNext(e.otherwise); break; }
            this.changeLife(me, -pay.life, 'cost');
            this._spliceNext(e.then);
            break;
          }
          if (pay.mana && !pay.discard) {
            if (!this.payMana(ctx.controller, pay.mana, { auto: true })) { this._spliceNext(e.otherwise); break; }
            this._spliceNext(e.then);
            break;
          }
          const zone = pay.sacrifice ? this.battlefield.filter(o => o.controller === ctx.controller && this._matchesFilter(o, pay.sacrifice.filter))
            : this.zones[ctx.controller].hand.filter(o => this._matchesFilter(o, pay.discard && pay.discard.filter));
          if (!zone.length) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
            cards: zone.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: pay.sacrifice ? 'Sacrifice one.' : 'Discard one.' }, 'pay');
          if (picked === SUSPEND) return SUSPEND;
          const chosen = (picked || []).map(id => this.obj(id)).filter(Boolean);
          if (!chosen.length) break;
          for (const o of chosen) {
            this.moveObject(o, 'graveyard');
            this.logEvent(pay.sacrifice ? 'sacrifice' : 'discard',
              `${me.name} ${pay.sacrifice ? 'sacrifices' : 'discards'} ${o.name}.`);
          }
          if (pay.sacrifice) this._fire('youSacrifice', ctx.controller, { count: chosen.length });
          this._spliceNext(e.then);
          break;
        }

        /* "...unless that player pays {1}." The payer is asked; the effect
           happens only when they decline or cannot afford it. */
        case 'unlessPays': {
          const onStack = () => {
            const t = targets.find(x => x.kind === 'stack');
            const item = t && this.stack.find(s => s.id === t.id);
            return item && this.player(item.controller);
          };
          const payer = e.who === 'you' ? me
            : e.who === 'triggerPlayer' ? (triggerPlayer() || this.opponentsOf(ctx.controller)[0])
            : e.who === 'spellController' ? (onStack() || this.player(ctx.spellController) || firstPlayer() || this.opponentsOf(ctx.controller)[0])
            : (firstPlayer() || onStack() || triggerPlayer() || this.opponentsOf(ctx.controller)[0]);
          if (!payer) { this._spliceNext(e.then); break; }
          const cost = e.costFromPower && src ? '{' + this.powerOf(src) + '}' : (e.cost || '{1}');
          if (e.costFromPower && this.powerOf(src) <= 0) { this._spliceNext(e.then); break; }
          const affordable = typeof cost === 'string'
            ? this.couldPay(payer.id, cost)
            : payer.life > (cost.life || 0);
          if (!affordable) {
            this.logEvent('rules', `${payer.name} cannot pay ${typeof cost === 'string' ? cost : cost.life + ' life'}.`);
            this._spliceNext(e.then);
            break;
          }
          const paid = this._ask({ type: 'payOrDont', playerId: payer.id, cost,
            prompt: e.prompt || `Pay ${typeof cost === 'string' ? cost : cost.life + ' life'}?` });
          if (paid === SUSPEND) return SUSPEND;
          let ok = false;
          if (paid) {
            if (typeof cost === 'string') ok = this.payMana(payer.id, cost, { auto: true });
            else { this.changeLife(payer, -(cost.life || 0), 'cost'); ok = true; }
          }
          if (ok) this.logEvent('rules', `${payer.name} pays.`);
          else this._spliceNext(e.then);
          break;
        }

        /* "Choose one —" and its wider cousins. The chosen modes' effects are
           spliced in, in the order the card lists them (CR 601.2b). */
        case 'modal': {
          const modes = e.modes || [];
          /* Entwined: the extra cost was paid to have all of them, so
             there is nothing to ask (CR 702.42). */
          if (ctx && ctx.entwined && modes.length) {
            const all = [];
            for (const m of modes) all.push(...(m.effects || []));
            this._spliceNext(all);
            this.logEvent('rules', `${me.name} entwines: ${modes.map(m => m.label).filter(Boolean).join('; ')}`);
            break;
          }
          /* Spree: the modes were paid for as the spell was cast, so
             there is nothing left to ask. */
          if (e.spree) {
            const bought = (ctx && ctx.spreeModes) || [0];
            const run = [];
            for (const i of bought) { const m = modes[i]; if (m) run.push(...(m.effects || [])); }
            this._spliceNext(run);
            this.logEvent('rules', `${me.name} chooses: ${bought.map(i => modes[i] && modes[i].label).filter(Boolean).join('; ')}`);
            break;
          }
          /* "Choose up to five {P} worth of modes. You may choose the same
             mode more than once." Each mode has a price in paw prints, and
             the picks may add up to the budget and no more (CR 700.2i). */
          if (e.pawprint) {
            const budget = Math.max(1, n(e.pawprint) || 1);
            const got = this._choose({ playerId: ctx.controller, purpose: 'pawprint', kind: 'options', repeat: true,
              min: 1, max: budget,
              options: modes.map((m, i) => ({ i, label: truncate(m.label || m.text || ('Mode ' + (i + 1)), 90),
                weight: m.weight || 1, cost: '{P}'.repeat(m.weight || 1) })),
              constraints: [{ kind: 'sum', key: 'weight', max: budget, label: 'paw prints' }],
              prompt: `Choose up to ${budget} {P} worth of modes. A mode may be chosen more than once.` });
            if (got === SUSPEND) return SUSPEND;
            // in the order the card prints them, a repeated mode once for each time (CR 700.2c)
            const picks = ((got && got.picks) || [0]).slice().sort((x, y) => x - y);
            const run = [];
            for (const i of picks) { const m = modes[i]; if (m) run.push(...this._ownTargets(m.effects || [])); }
            this._spliceNext(run);
            this.logEvent('rules', `${me.name} chooses: ${picks.map(i => modes[i] && modes[i].label).filter(Boolean).join('; ')}`);
            break;
          }
          let want = Math.min(n(e.count) || 1, modes.length);
          // the Will cycle: both modes, with a commander on the battlefield
          if (e.countIf && this._condMet(e.countIf.cond, ctx)) want = Math.min(e.countIf.count, modes.length);
          const picked = this._ask({ type: 'mode', playerId: ctx.controller, count: want,
            repeatable: !!e.repeatable,
            options: modes.map((m, i) => ({ i, label: truncate(m.label || m.text || ('Mode ' + (i + 1)), 90) })),
            prompt: e.prompt || `Choose ${want === 1 ? 'one' : want}.` });
          if (picked === SUSPEND) return SUSPEND;
          const order = (picked || []).slice(0, e.repeatable ? want : modes.length);
          const chosen = (order.length ? order : modes.map((m, i) => i).slice(0, want));
          const run = [];
          for (const i of chosen) { const m = modes[i]; if (m) run.push(...(m.effects || [])); }
          this._spliceNext(run);
          this.logEvent('rules', `${me.name} chooses: ${chosen.map(i => modes[i] && modes[i].label).filter(Boolean).join('; ')}`);
          break;
        }

        /* ===== the second batch ===== */
        case 'addManaPer': {
          const k = (e.per && e.per.countersOnSelf) ? ((src && Number(src.counters[e.per.countersOnSelf])) || 0)
            : (e.per && (e.per.scope || e.per.cardsInHand || e.per.cardsInGraveyard || e.per.opponents || e.per.colorsAmongYours)) ? n(e.per)
            : this.countPermanents(ctx.controller, e.per) * ((e.per && e.per.mult) || 1);
          for (let i = 0; i < k; i++) me.pool.add(e.symbol === 'C' ? 'C' : e.symbol);
          if (k) this.logEvent('mana', `${me.name} adds ${k} mana.`);
          break;
        }

        case 'skipDraw': me.skipNextDraw = true; break;

        case 'ifLastWas': {
          const x = (this._lastExiled && this.obj(this._lastExiled)) ||
            (this._lastAffected && this.obj(this._lastAffected.id));
          if (x && this._matchesCategory(x, e.filter)) this._spliceNext(e.then);
          break;
        }

        case 'selfToLibraryDepth': {
          if (!src) break;
          // Sensei's Divining Top: a permanent going home leaves the battlefield like any other
          if (src.zone === 'battlefield' && !e.depth) { this.moveObject(src, 'library'); break; }
          const z = this.zones[src.owner].library;
          this._removeFromZone(src);
          src.zone = 'library';
          z.splice(Math.min(e.depth || 7, z.length), 0, src);
          src._wentToLibrary = true;
          this.logEvent('zone', `${src.name} goes ${e.depth} from the top.`);
          break;
        }

        case 'grantFlashback': {
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const o = this.obj(t.id);
            if (o) { o.grantedFlashback = true; this.logEvent('rules', `${o.name} gains flashback.`); }
          }
          break;
        }

        case 'transformSelf': {
          const x = src || (ctx.objId && this.obj(ctx.objId));
          if (x && x.card && x.card.card_faces && x.card.card_faces.length > 1) {
            x.face = (x.face + 1) % x.card.card_faces.length;
            x.counters = {};
            this.bumpBoard();
            this.logEvent('rules', `${x.name} transforms.`);
            this._fire('transforms', x.controller, { object: x, source: x });
          } else if (x) {
            // nothing to turn over: the Saga has simply finished
            this.logEvent('rules', `${x.name} finishes its story.`);
          }
          break;
        }

        case 'copyPermanent': {
          const source = e._forced || (e.self ? src : e.of === 'attached' ? (src && src.attachedTo && this.obj(src.attachedTo)) : firstObj());
          if (!source) break;
          const cnt = n(e.n) || 1;
          // "except the token isn't legendary" (Helm of the Host)
          let card = source.card;
          if (e.nonLegendary && /\bLegendary\b/.test(String(card.type_line || ''))) {
            const line = String(card.type_line).replace(/\bLegendary\s+/g, '');
            card = Object.assign({}, card, { id: card.id + ':copy:' + U.hash(line), type_line: line, card_faces: null });
          }
          for (let i = 0; i < cnt; i++) {
            const copy = this._register(new GObj(card, ctx.controller, 'battlefield'));
            copy.isToken = true;
            copy.controller = ctx.controller;
            copy.zone = 'battlefield';
            copy.entered = this.turn;
            copy.summoningSick = true;
            copy.face = source.face || 0;
            if (e.grant && e.grant.length) copy.effects.push({ keywords: e.grant, until: null });
            copy.ts = this._stampNew();      // its timestamp (CR 613.7d)
            this.battlefield.push(copy);
            this.bumpBoard();
            this._onEnter(copy);
            this._fireEnters(copy);
            // the copy is what any later sentence is talking about
            this._lastCopy = copy;
          }
          this.logEvent('token', `${me.name} copies ${source.name}.`);
          this.emit('sfx', 'play_card');
          break;
        }

        /* the object a delayed note was taken about */
        case 'sacrificeThat': {
          const x = ctx.obj || (ctx.objId && this.obj(ctx.objId));
          if (x && x.zone === 'battlefield') {
            this.moveObject(x, 'graveyard');
            this.logEvent('sacrifice', `${x.name} is sacrificed.`);
          }
          break;
        }
        case 'returnThat': {
          const x = ctx.obj || (ctx.objId && this.obj(ctx.objId));
          if (x && x.zone !== 'battlefield') this.moveObject(x, 'battlefield', { controller: x.owner });
          break;
        }
        case 'toHandThat': {
          const x = ctx.obj || (ctx.objId && this.obj(ctx.objId));
          if (x && x.zone !== 'hand') this.moveObject(x, 'hand');
          break;
        }

        case 'reveal': {
          const from = this.zones[ctx.controller][e.from === 'library' ? 'library' : 'hand'] || [];
          const shown = from.slice(0, n(e.n)).map(o => o.name);
          this.logEvent('reveal', `${me.name} reveals ${shown.join(', ') || 'nothing'}.`);
          break;
        }

        case 'winGame': {
          for (const p of this.opponentsOf(ctx.controller)) this.playerLoses(p, 'a card said so');
          this.checkStateBasedActions();
          break;
        }
        case 'loseGame': this.playerLoses(me, 'a card said so'); break;

        /* ===== leave a note for later (CR 603.7) ===== */
        case 'delayed': {
          const objId = e.subject === 'lastTarget' ? ((this._lastCopy && this._lastCopy.id) || (firstObj() || {}).id)
            : e.subject === 'self' ? (src && src.id) : (firstObj() || {}).id;
          this.scheduleDelayed({
            event: e.event || 'eachEndStep',
            controller: ctx.controller,
            forPlayer: e.forPlayer === 'you' ? ctx.controller : null,
            notBefore: e.nextTurn ? this.turn : null,
            sameTurnOk: !e.nextTurn,
            objId: objId || null,
            name: e.name || truncate(e.text || 'delayed effect', 60),
            effects: (e.effects || []).map(x => {
              /* Mana Drain: "an amount equal to that spell's mana value" is
                 counted now, while the spell it means is still known. */
              if (x.op === 'addManaPer' && x.per && x.per.counteredMv) {
                const k = (this._lastCountered && this._lastCountered.mv) || 0;
                return { op: 'addMana', symbols: Array.from({ length: k }, () => x.symbol || 'C') };
              }
              /* "Its controller may draw…at the next upkeep": who that is
                 is settled now, not when the note is read. */
              if (x.who === 'targetController') {
                const p = this._lastAffectedController();
                return Object.assign({}, x, { who: 'fixed', pid: p ? p.id : ctx.controller });
              }
              return Object.assign({}, x,
                objId && (x.scope === 'lastTarget' || x.scope === 'thatObject') ? { scope: 'thatObject' } : {});
            }),
          });
          this.logEvent('rules', `${me.name} sets something up for later.`);
          break;
        }

        /* ===== looking at the top of a library ===== */
        case 'lookAt': {
          const cnt = n(e.n);
          this._looked = this.zones[ctx.controller].library.slice(0, cnt).map(o => o.id);
          this.logEvent('look', `${me.name} looks at the top ${cnt}.`);
          break;
        }

        case 'takeFromLooked': {
          const pool = (this._looked || []).map(id => this.obj(id)).filter(o => o && o.zone === 'library');
          if (!pool.length) break;
          const want = n(e.n);
          const legal = pool.filter(o => {
            if (e.maxMv != null && ((o.card && o.card.cmc) || 0) > e.maxMv) return false;
            return this._matchesFilter(o, e.filter);
          });
          let taken = [];
          if (legal.length) {
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: Math.min(want, legal.length),
              cards: legal.map(o => ({ id: o.id, name: o.name, card: o.card })),
              optional: true, prompt: e.prompt || `Choose up to ${want}.` });
            if (picked === SUSPEND) return SUSPEND;
            taken = (picked || []).slice(0, want).map(id => this.obj(id)).filter(Boolean);
          }
          const z = this.zones[ctx.controller];
          for (const o of taken) {
            this._removeFromZone(o);
            if (e.to === 'battlefield') { o.zone = 'library'; this.moveObject(o, 'battlefield', { controller: ctx.controller }); }
            else if (e.to === 'top') { o.zone = 'library'; z.library.unshift(o); }
            else if (e.to === 'exile' || e.to === 'graveyard') {
              o.zone = 'library';
              this.moveObject(o, e.to);
              // "You may play the exiled card this turn"
              if (e.to === 'exile' && e.playable) { o.impulseBy = ctx.controller; o.impulseUntil = this.turn; }
            }
            else { o.zone = 'library'; this.moveObject(o, 'hand'); }
          }
          const rest = pool.filter(o => !taken.includes(o) && o.zone === 'library');
          /* "Put one into your hand, one on the bottom, and exile one": the
             rest wait for the next sentence to say where they go. */
          if (e.rest === 'keep') { this._looked = rest.map(o => o.id); this.logEvent('look', `${me.name} takes ${taken.length}.`); break; }
          if (e.rest === 'graveyard') { for (const o of rest) this.moveObject(o, 'graveyard'); }
          else if (rest.length) {
            const order = e.rest === 'bottomRandom' ? this.rng.shuffle(rest.slice()) : rest;
            for (const o of order) { this._removeFromZone(o); o.zone = 'library'; z.library.push(o); }
          }
          this._looked = null;
          this.logEvent('look', `${me.name} takes ${taken.length}.`);
          break;
        }

        case 'putBackLooked': {
          const pool = (this._looked || []).map(id => this.obj(id)).filter(o => o && o.zone === 'library');
          if (!pool.length) break;
          const order = this._ask({ type: 'arrange', playerId: ctx.controller,
            cards: pool.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: 'Put them back in any order.' });
          if (order === SUSPEND) return SUSPEND;
          const z = this.zones[ctx.controller];
          const ids = (order && order.top) || pool.map(o => o.id);
          const seq = ids.map(id => this.obj(id)).filter(Boolean);
          for (const o of pool) this._removeFromZone(o);
          for (let i = seq.length - 1; i >= 0; i--) { seq[i].zone = 'library'; z.library.unshift(seq[i]); }
          this._looked = null;
          break;
        }

        case 'drawFromTop': this._drawCards(me, n(e.n)); break;

        /* "…may draw up to two cards": how many is the drawer's choice. */
        case 'drawUpTo': {
          const who = e.who === 'fixed' ? this.player(e.pid)
            : e.who === 'targetController' ? this._lastAffectedController() : me;
          if (!who || who.hasLost) break;
          const most = Math.max(0, n(e.n) || 1);
          const options = [];
          for (let k = most; k >= 0; k--) options.push({ i: most - k, label: k ? `Draw ${k}` : 'Draw nothing' });
          const pick = this._ask({ type: 'mode', playerId: who.id, count: 1, options,
            prompt: `Draw up to ${most} card${most === 1 ? '' : 's'}?` }, 'upto');
          if (pick === SUSPEND) return SUSPEND;
          const idx = Array.isArray(pick) && pick.length ? pick[0] : 0;
          const k = Math.max(0, most - idx);
          if (k) this._drawCards(who, k);
          break;
        }

        case 'handToTop': {
          const cnt = n(e.n);
          const hand = this.zones[ctx.controller].hand;
          if (!hand.length) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: Math.min(cnt, hand.length),
            cards: hand.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: `Put ${Math.min(cnt, hand.length)} card(s) on top of your library.` });
          if (picked === SUSPEND) return SUSPEND;
          const z = this.zones[ctx.controller];
          for (const id of (picked || []).slice(0, cnt).reverse()) {
            const o = this.obj(id);
            if (!o) continue;
            this._removeFromZone(o);
            o.zone = 'library';
            z.library.unshift(o);
          }
          break;
        }

        case 'etbCounters': if (src) this.addCounters(src, e.kind, n(e.n)); break;

        case 'skipStep': {
          if (e.step === 'draw') me.skipEveryDraw = true;
          break;
        }

        /* ===== the fourth batch ===== */
        case 'populate': {
          const tokens = this.battlefield.filter(o => o.isToken && o.controller === ctx.controller &&
            (o.analysis() || {}).isCreature);
          if (!tokens.length) break;
          const best = tokens.sort((a, b) => this.powerOf(b) - this.powerOf(a))[0];
          this._runEffect({ op: 'copyPermanent', n: 1, self: false, _forced: best }, ctx);
          break;
        }

        case 'exileFromGraveyard': {
          const cnt = n(e.n) || 1;
          const from = e.who === 'target' ? [firstPlayer()].filter(Boolean) : this.players;
          for (const p of from) {
            const gy = this.zones[p.id].graveyard.filter(o => this._matchesFilter(o, e.filter));
            for (const o of gy.slice(0, cnt)) this.moveObject(o, 'exile');
          }
          break;
        }

        case 'graveyardToLibrary': {
          // "Target player shuffles their graveyard into their library", or each player does
          const whose = e.who === 'target' ? [firstPlayer()].filter(Boolean)
            : e.who === 'each' ? this.players.filter(p => !p.hasLost) : [me];
          for (const p of whose) {
            const z = this.zones[p.id];
            const gy = z.graveyard.slice();
            for (const o of gy) { this._removeFromZone(o); o.zone = 'library'; z.library.push(o); }
            if (e.withSelf && src && p === me) { this._removeFromZone(src); src.zone = 'library'; z.library.push(src); }
            this.rng.shuffle(z.library);
            this.logEvent('zone', `${p.name} shuffles ${gy.length} card(s) back in.`);
          }
          this.emit('sfx', 'shuffle');
          break;
        }

        case 'taxSpells':
          // a standing cost change: priced in when a spell is cast, not now
          break;
        case 'cantBeCountered': case 'uncounterable': case 'castRestrict':
          break;   // read when a spell is countered or cast
        /* Silence: "Your opponents can't cast spells this turn." */
        case 'silence':
          for (const p of (e.who === 'opponents' ? this.opponentsOf(ctx.controller) : this.players)) p.silencedTurn = this.turn;
          this.logEvent('rules', `${me.name}'s opponents can't cast spells this turn.`);
          break;

        case 'sortRevealed': {
          const cnt = n(e.n) || 4;
          const top = this.zones[ctx.controller].library.slice(0, cnt);
          for (const o of top) {
            const keep = this._matchesFilter(o, e.filter);
            this.moveObject(o, keep ? 'hand' : 'graveyard');
          }
          break;
        }

        /* ===== a land that gets up and attacks ===== */
        case 'animate': {
          if (!src) break;
          const [p, t] = String(e.pt || '1/1').split('/');
          src.effects.push({
            until: e.duration === 'eot' ? 'eot' : null,
            setPt: { p: parseInt(p, 10) || 0, t: parseInt(t, 10) || 0 },
            addTypes: ['Creature'].concat(e.addTypes || []),
            addSubtypes: String(e.subtypes || '').split(/\s+/).filter(Boolean),
            keywords: e.keywords || [],
          });
          this.bumpBoard();
          this.logEvent('rules', `${src.name} becomes a ${e.pt} creature until end of turn.`);
          break;
        }

        case 'amass': {
          // one Army grows rather than many arriving (CR 701.44)
          let army = this.battlefield.find(o => o.controller === ctx.controller &&
            (o.analysis() || {}).subtypes && o.analysis().subtypes.includes('Army'));
          if (!army) {
            this._createToken(ctx.controller, { n: 1, pt: '0/0', subtypes: (e.kind || 'Zombie') + ' Army', colorWords: ['black'], keywords: [] });
            army = this.battlefield[this.battlefield.length - 1];
          }
          if (army) this.addCounters(army, '+1/+1', n(e.n) || 1);
          break;
        }

        case 'connive': {
          const cnt = n(e.n) || 1;
          this._drawCards(me, cnt);
          this.queueChoice({ type: 'discard', playerId: ctx.controller,
            count: Math.min(cnt, this.zones[ctx.controller].hand.length),
            prompt: `Discard ${cnt} (connive).`, connive: src ? src.id : null });
          break;
        }

        case 'markImpulse': {
          // "until end of turn, you may cast that card" — about what was just exiled
          const x = this._lastExiled && this.obj(this._lastExiled);
          if (!x) break;
          x.impulseBy = ctx.controller;
          x.impulseUntil = e.duration === 'eot' ? this.turn : this.turn + 1;
          break;
        }

        /* ===== exile that is really imprisonment ===== */
        case 'exileUntilLeaves': {
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const o = this.obj(t.id);
            if (!o) continue;
            this.moveObject(o, 'exile');
            o.exiledBy = src ? src.id : null;
            this._lastExiled = o.id;
          }
          break;
        }
        case 'returnExiled': {
          const jailer = src || (ctx.objId && this.obj(ctx.objId));
          if (!jailer) break;
          this._releaseExiled(jailer);
          break;
        }

        case 'permanentFromHand': {
          const who = e.who === 'each' ? this.players.filter(p => !p.hasLost) : [me];
          for (const p of who) {
            const pool = this.zones[p.id].hand.filter(o => this._matchesCategory(o, e.filter === 'any' ? '' : e.filter));
            if (!pool.length) continue;
            const many = e.any ? pool.length : 1;
            const picked = this._ask({ type: 'pickCard', playerId: p.id, count: many, optional: true,
              cards: pool.map(o => ({ id: o.id, name: o.name, card: o.card })),
              prompt: many > 1 ? 'Put any number of these cards from your hand onto the battlefield.' : 'Put a card from your hand onto the battlefield.' }, 'p' + p.id);
            if (picked === SUSPEND) return SUSPEND;
            for (const id of (picked || []).slice(0, many)) {
              const o = this.obj(id);
              if (!o) continue;
              this.moveObject(o, 'battlefield', { controller: p.id });
              if (e.tapped) o.tapped = true;
              this._lastPut = o.id;
            }
          }
          break;
        }
        /* "on the top or bottom of its owner's library": whoever chooses
           says which */
        case 'topOrBottom': {
          const x = firstObj();
          if (!x || x.zone !== 'battlefield') break;
          const chooser = e.ownerChooses ? x.owner : ctx.controller;
          const got = this._choose({ playerId: chooser, purpose: 'topOrBottom', kind: 'options', min: 1, max: 1,
            options: [{ i: 0, label: 'Top of the library' }, { i: 1, label: 'Bottom of the library' }],
            prompt: `Put ${x.name} on the top or the bottom of its owner's library?` });
          if (got === SUSPEND) return SUSPEND;
          const bottom = !!(got && got.picks && got.picks[0] === 1);
          this.moveObject(x, 'library', bottom ? { toBottom: true } : {});
          this.logEvent('zone', `${x.name} goes to the ${bottom ? 'bottom' : 'top'} of its owner's library.`);
          break;
        }

        /* "Distribute two +1/+1 counters among one or two target creatures",
           spread as evenly as the numbers allow, the way divided damage is. */
        case 'countersDivided': {
          const total = n(e.n);
          const objs = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(o => o && o.zone === 'battlefield');
          if (!objs.length || total <= 0) break;
          const each = Math.floor(total / objs.length);
          let spare = total - each * objs.length;
          for (const o of objs) {
            const k = each + (spare-- > 0 ? 1 : 0);
            if (k > 0) this.addCounters(o, e.kind || '+1/+1', k);
          }
          break;
        }
        case 'damageDivided': {
          const total = n(e.n);
          if (!targets.length || total <= 0) break;
          const objs = targets.filter(t => t.kind === 'object' || t.kind === 'player');
          if (!objs.length) break;
          // spread it as evenly as the numbers allow, remainder to the first
          const each = Math.floor(total / objs.length);
          let spare = total - each * objs.length;
          for (const t of objs) {
            const amt = each + (spare-- > 0 ? 1 : 0);
            if (amt <= 0) continue;
            if (t.kind === 'player') this.dealDamageToPlayer(this.player(t.id), amt, src);
            else { const o = this.obj(t.id); if (o) this.dealDamageToObject(o, amt, src); }
          }
          this.emit('sfx', 'damage');
          break;
        }

        /* ===== ops the hand-written scripts lean on ===== */
        case 'revealToHand': {
          const cnt = n(e.n) || 1;
          for (let i = 0; i < cnt; i++) {
            const o = this.zones[ctx.controller].library[0];
            if (!o) break;
            const mv = (o.card && o.card.cmc) || 0;
            this.logEvent('reveal', `${me.name} reveals ${o.name}.`);
            this.moveObject(o, 'hand');
            if (e.loseLifeForMv) this.changeLife(me, -mv, 'card');
          }
          break;
        }

        case 'winIfLibraryAtMost': {
          const x = e.count && e.count.devotion ? this.devotionOf(ctx.controller, e.count.devotion) : n(e.count);
          const left = this.zones[ctx.controller].library.length;
          this.logEvent('rules', `${me.name}: ${x} versus ${left} cards left.`);
          if (x >= left) {
            for (const p of this.opponentsOf(ctx.controller)) this.playerLoses(p, 'a card said so');
            this.checkStateBasedActions();
          }
          break;
        }

        case 'approach': {
          const cast = (me.approachCasts || 0) + 1;
          me.approachCasts = cast;
          if (cast >= 2) {
            for (const p of this.opponentsOf(ctx.controller)) this.playerLoses(p, 'a card said so');
            this.checkStateBasedActions();
            break;
          }
          this.changeLife(me, e.life || 7);
          if (src) {
            const z = this.zones[ctx.controller].library;
            this._removeFromZone(src);
            src.zone = 'library';
            z.splice(Math.min(e.depth || 7, z.length), 0, src);
            src._wentToLibrary = true;
          }
          break;
        }

        case 'sylvanLibrary': {
          const cnt = n(e.n) || 2;
          const hand = this.zones[ctx.controller].hand;
          for (let i = 0; i < cnt; i++) {
            if (!hand.length) break;
            const pay = this._ask({ type: 'confirm', playerId: ctx.controller,
              prompt: `Pay ${e.life || 4} life to keep a card? (otherwise one goes back on top)` }, 'k' + i);
            if (pay === SUSPEND) return SUSPEND;
            if (pay && me.life > (e.life || 4)) { this.changeLife(me, -(e.life || 4), 'cost'); continue; }
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
              cards: hand.map(o => ({ id: o.id, name: o.name, card: o.card })),
              prompt: 'Put a card on top of your library.' }, 'b' + i);
            if (picked === SUSPEND) return SUSPEND;
            const o = this.obj((picked || [])[0]);
            if (!o) break;
            this._removeFromZone(o);
            o.zone = 'library';
            this.zones[ctx.controller].library.unshift(o);
          }
          break;
        }

        case 'attackTax':
        case 'untapOnEveryUntapStep':
        case 'cageGraveyards':
        case 'playFromTop':
        case 'playFrom':
          break;
        /* Enduring Vitality and its cycle: "if it was a creature, return it
           to the battlefield under its owner's control. It's an
           enchantment." The card comes back as an enchantment with no
           creature type, which every rule then sees. */
        case 'returnAsEnchantment': {
          if (!src || src.zone !== 'graveyard' || src._leftAsCreature === false) break;
          const card = src.card;
          src.printedCard = card;
          src.card = Object.assign({}, card, { id: card.id + ':enchantment', type_line: 'Enchantment',
            power: null, toughness: null, card_faces: null });
          src._chr = null;
          this.moveObject(src, 'battlefield', { controller: src.owner });
          this.logEvent('reanimate', `${src.name} returns to the battlefield as an enchantment.`);
          break;
        }
        /* Relentless Assault, Aurelia, Full Throttle: more combat this turn,
           after the phase we are in */
        case 'extraCombat': {
          const phases = [];
          for (let i = 0; i < (e.count || 1); i++) phases.push(2);
          if (e.withMain) phases.push(3);
          (this._extraPhases = this._extraPhases || []).push({ turn: this.turn, after: this.phaseIndex, phases });
          this.logEvent('rules', `There ${phases.length > 1 ? 'are' : 'is'} an additional combat phase${e.withMain ? ' and main phase' : ''} this turn.`);
          break;
        }
        case 'untapAttacking':
          for (const id of (this.combat.attackers || [])) {
            const o = this.obj(id);
            if (o && o.controller === ctx.controller) o.tapped = false;
          }
          this._lastGroup = (this.combat.attackers || []).slice();
          break;
        case 'untapAttackedThisTurn':
          for (const o of this.battlefield) {
            if (o.controller === ctx.controller && o.attackedTurn === this.turn) o.tapped = false;
          }
          break;
        /* "Look at the top card of your library. If it's a land card, you
           may put it onto the battlefield tapped." */
        case 'topLand': {
          const z = this.zones[ctx.controller];
          const top = z && z.library[0];
          if (!top) break;
          const isLand = !!(top.analysis() || {}).isLand;
          let put = isLand;
          if (isLand && e.may) {
            const yes = this._ask({ type: 'confirm', playerId: ctx.controller,
              prompt: `Put ${top.name} onto the battlefield${e.tapped ? ' tapped' : ''}?` }, 'topLand');
            if (yes === SUSPEND) return SUSPEND;
            put = yes !== false;
          }
          if (top.zone !== 'library') break;
          if (put) {
            this.moveObject(top, 'battlefield', { controller: ctx.controller });
            if (e.tapped && top.zone === 'battlefield') top.tapped = true;
            this.logEvent('zone', `${me.name} puts ${top.name} onto the battlefield from the top of their library.`);
          } else if (e.elseHand) {
            this.moveObject(top, 'hand');
            this.logEvent('zone', `${me.name} puts the top card of their library into their hand.`);
          }
          break;
        }
        case 'opponentsMustAttack':
          for (const o of this.battlefield) {
            if (o.controller === ctx.controller || !(this.characteristics(o) || {}).isCreature) continue;
            o.effects.push({ flag: 'mustAttackEot', until: 'eot' });
          }
          this.bumpBoard();
          this.logEvent('rules', `Creatures ${me.name}'s opponents control attack this turn if able.`);
          break;
        case 'winOnEmptyDraw':
          break;   // a standing rule, read where it matters
        case 'flashThisTurn':
          me.flashTurn = this.turn;
          this.logEvent('rules', `${me.name} may cast spells as though they had flash this turn.`);
          break;
        case 'flashGrant':
        case 'shuffleInsteadOfGrave':
          break;   // standing rules, read where they matter
        case 'poison': {
          const who = e.who === 'opponents' ? this.opponentsOf(ctx.controller)
            // "defending player gets a poison counter": whoever the trigger was about
            : e.who === 'triggerPlayer' ? [triggerPlayer()].filter(Boolean)
            : [firstPlayer()].filter(Boolean);
          for (const p of who) this.addPoison(p, n(e.n) || 1);
          break;
        }
        // Sea Gate Restoration: for the rest of the game
        case 'noMaxHandForever':
          me.noMaxHand = true;
          this.logEvent('rules', `${me.name} has no maximum hand size for the rest of the game.`);
          break;   // standing rules, read where they matter

        case 'counterTriggerSpell': {
          const d = ctx.triggerData || {};
          const item = d.stackId && this.stack.find(s => s.id === d.stackId);
          if (!item) break;
          if (e.matchCounters) {
            const have = (src && src.counters && src.counters[e.matchCounters]) || 0;
            const mv = MANA.cmc((item.obj && item.obj.card && item.obj.card.mana_cost) || '');
            if (mv !== have) break;
          }
          item.countered = true;
          this.logEvent('counter', `${item.name} is countered.`);
          this.emit('sfx', 'counter');
          break;
        }

        /* ===== ops the whole-pool scan asked for ===== */
        case 'exileSelf': if (src) this.moveObject(src, 'exile'); break;
        case 'revealHand': {
          const p = firstPlayer() || this.opponentsOf(ctx.controller)[0];
          if (p) this.logEvent('reveal', `${p.name} reveals their hand.`);
          break;
        }
        case 'selfToLibrary': {
          if (!src) break;
          const z = this.zones[src.owner].library;
          this._removeFromZone(src);
          src.zone = 'library';
          z.push(src);
          if (e.shuffle) this.rng.shuffle(z);
          src._wentToLibrary = true;
          break;
        }
        case 'selfFromGraveyard': {
          if (!src || src.zone !== 'graveyard') break;
          this.moveObject(src, e.to === 'battlefield' ? 'battlefield' : 'hand',
            e.to === 'battlefield' ? { controller: ctx.controller } : undefined);
          break;
        }

        case 'restToBottom': case 'restToGraveyard': {
          const pool = (this._looked || []).map(id => this.obj(id)).filter(o => o && o.zone === 'library');
          if (!pool.length) break;
          const z = this.zones[ctx.controller].library;
          const order = e.op === 'restToBottom' && e.random ? this.rng.shuffle(pool.slice()) : pool;
          for (const o of order) {
            this._removeFromZone(o);
            if (e.op === 'restToGraveyard') { o.zone = 'library'; this.moveObject(o, 'graveyard'); }
            else { o.zone = 'library'; z.push(o); }
          }
          this._looked = null;
          break;
        }

        /* "Target opponent reveals their hand. You choose a card from it.
            That player discards that card." — three sentences, one act. */
        case 'chooseFromHand': {
          const victim = firstPlayer() || this.opponentsOf(ctx.controller)[0];
          if (!victim) break;
          const hand = this.zones[victim.id].hand.filter(o => {
            const a = o.analysis();
            if (!a) return false;
            if (/^nonland$/.test(e.filter || '')) return !a.isLand;
            return this._matchesCategory(o, e.filter === 'any' ? '' : e.filter);
          });
          this.logEvent('reveal', `${victim.name} reveals their hand.`);
          if (!hand.length) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
            cards: hand.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: `Choose a card from ${victim.name}'s hand.` });
          if (picked === SUSPEND) return SUSPEND;
          this._chosenCard = (picked || [])[0] || null;
          break;
        }
        case 'discardChosen': case 'exileChosen': {
          const o = this._chosenCard && this.obj(this._chosenCard);
          if (!o) break;
          this.moveObject(o, e.op === 'exileChosen' ? 'exile' : 'graveyard');
          this.logEvent(e.op === 'exileChosen' ? 'exile' : 'discard',
            `${this.player(o.owner).name} loses ${o.name}.`);
          this._chosenCard = null;
          break;
        }

        case 'attachSelf': {
          // "attach this Equipment to it": the creature the trigger is about
          const tid = e.scope === 'triggerObject' && (ctx.triggerData || {}).objectId;
          const host = tid ? this.obj(tid) : firstObj();
          if (host && host.zone !== 'battlefield') break;
          if (!src || !host) break;
          if (src.attachedTo) {
            const old = this.obj(src.attachedTo);
            if (old) old.attachments = old.attachments.filter(x => x !== src.id);
          }
          src.attachedTo = host.id;
          src.ts = this._stampNew();       // attached anew, it is newer (CR 613.7e)
          host.attachments.push(src.id);
          this.bumpBoard();
          this.logEvent('rules', `${src.name} is attached to ${host.name}.`);
          break;
        }

        case 'suspendSelf': {
          if (!src || src.zone !== 'stack') break;
          this.moveObject(src, 'exile');
          src.counters.time = n(e.n) || 1;
          src.suspendedBy = ctx.controller;
          this.logEvent('rules', `${src.name} is exiled with ${src.counters.time} time counters on it.`);
          break;
        }
        case 'exileIfItDies': {
          this._exileOnDeath = this._exileOnDeath || new Set();
          const x = firstObj() || (this._lastAffected && this.obj(this._lastAffected.id));
          if (x) this._exileOnDeath.add(x.id);
          break;
        }

        case 'adapt': {
          if (!src) break;
          if ((src.counters['+1/+1'] || 0) > 0) break;     // only if it has none
          this.addCounters(src, '+1/+1', n(e.n) || 1);
          break;
        }

        case 'etbTappedUnlessLands': {
          if (!src) break;
          const lands = this.battlefield.filter(o => o !== src && o.controller === ctx.controller &&
            (o.analysis() || {}).isLand).length;
          if (e.atLeast != null) { if (lands < e.atLeast) src.tapped = true; break; }
          if (lands > (n(e.n) || 2)) src.tapped = true;
          break;
        }
        case 'etbTappedUnlessLife': {
          // "enters tapped unless a player has N or less life"
          if (!src) break;
          const low = this.players.some(p2 => !p2.hasLost && p2.life <= (e.life || 0));
          if (!low) src.tapped = true;
          break;
        }
        case 'etbTappedUnlessOpponents': {
          if (!src) break;
          const opps = this.opponentsOf(ctx.controller).filter(p2 => !p2.hasLost).length;
          if (opps < (e.n || 2)) src.tapped = true;
          break;
        }
        /* A shockland: it wants to come in untapped, and asks you to pay for
           that as it arrives. A bot answers for itself; anybody else is
           asked, and the land waits tapped until they say. */
        case 'etbTappedUnlessPay': {
          if (!src) break;
          const p2 = this.player(ctx.controller);
          const life = n(e.life) || 2;
          src.tapped = true;
          if (!p2 || p2.life <= life || src._forcedTapped) break;
          if (p2.isBot) {
            if (p2.life > life * 4) { this.changeLife(p2, -life, 'cost'); src.tapped = false; }
            break;
          }
          this.queueChoice({
            type: 'confirm', playerId: ctx.controller, purpose: 'payToUntap', objId: src.id,
            life, prompt: `Pay ${life} life so ${src.name} enters untapped?`,
          });
          break;
        }
        /* "Reveal an Elf card from your hand, or it enters tapped."
           Revealing costs nothing, so it is done whenever it can be. */
        case 'etbTappedUnlessReveal': {
          if (!src) break;
          const hand = (this.zones[ctx.controller] || {}).hand || [];
          const shown = hand.find(c => (e.types || []).some(t => this._matchesCategory(c, t)));
          const held = e.orControl && this.battlefield.some(o => o !== src &&
            o.controller === ctx.controller && this._matchesCategory(o, e.orControl));
          if (shown) this.logEvent('rules', `${this.player(ctx.controller).name} reveals ${shown.name}.`);
          if (!shown && !held) src.tapped = true;
          break;
        }

        /* A clone: it arrives as a copy of something already on the table. */
        case 'etbAsCopy': {
          if (!src) break;
          const pool = this._clonePool(src, e, ctx.controller);
          /* A person who cast it has already said what it copies (or that
             it copies nothing); otherwise the best thing on offer is taken. */
          const chosen = src._cloneChoice;
          src._cloneChoice = null;
          if (chosen === 'none') { this.logEvent('rules', `${src.name} enters as itself.`); break; }
          if (!pool.length) break;
          let pick = chosen ? pool.find(o => o.id === chosen) : null;
          const worth = (o) => this.powerOf(o) + ((o.card && o.card.cmc) || 0) / 2 + (o.controller === ctx.controller ? 0.5 : 0);
          if (!pick) { pick = pool[0]; for (const o of pool) if (worth(o) > worth(pick)) pick = o; }
          src.printedCard = src.printedCard || src.card;
          src.copyOf = pick.card;
          let card = pick.card;
          /* "except it's an artifact in addition", "except it isn't legendary" */
          if ((e.addTypes || []).length || e.nonLegendary) {
            let line = String(card.type_line || '');
            if (e.nonLegendary) line = line.replace(/\bLegendary\s+/g, '');
            for (const t of (e.addTypes || [])) {
              if (new RegExp('\\b' + t + '\\b').test(line)) continue;
              // a card type goes in front; a creature type ("Illusion") after the dash
              if (/^(?:Artifact|Creature|Enchantment|Land|Planeswalker|Battle)$/.test(t)) line = t + ' ' + line;
              else line = /—/.test(line) ? line + ' ' + t : line + ' — ' + t;
            }
            card = Object.assign({}, card, { id: card.id + ':copy:' + U.hash(line), type_line: line, card_faces: null });
          }
          /* "except it has flying", "except it has 'When this creature
             becomes the target of a spell or ability, sacrifice it'": the
             copy's words, with that added */
          if ((e.addText || []).length) {
            const text = String(card.oracle_text || '') + '\n' + e.addText.join('\n');
            card = Object.assign({}, card, { id: card.id + ':has:' + U.hash(text), oracle_text: text.trim(), card_faces: null });
          }
          src.card = card;
          src.face = pick.face || 0;
          src._chr = null;
          if (e.tapped) src.tapped = true;      // Vesuva
          if (e.extraCounter) {
            const ca = src.analysis();
            if (ca && ca.isCreature) src.counters['+1/+1'] = (Number(src.counters['+1/+1']) || 0) + 1;
            if (ca && ca.isPlaneswalker) src.counters.loyalty = (parseInt(ca.loyalty, 10) || 0) + 1;
          } else if ((src.analysis() || {}).isPlaneswalker) src.counters.loyalty = parseInt(src.analysis().loyalty, 10) || 0;
          // Cursed Mirror: a copy until the end of the turn, with haste
          if (e.eot) src.copyUntilTurn = this.turn;
          if (e.haste) src.effects.push({ keywords: ['Haste'], until: 'eot' });
          this.bumpBoard();
          this.logEvent('rules', `${src.name} enters as a copy of ${pick.name}${e.eot ? ' until end of turn' : ''}.`);
          break;
        }
        /* Shifting Woodland: a copy of a card in your graveyard, for the turn */
        case 'becomeCopy': {
          const t = firstObj();
          if (!src || src.zone !== 'battlefield' || !t) break;
          src.printedCard = src.printedCard || src.card;
          src.copyOf = t.card;
          src.card = t.card;
          src.face = 0;
          if (e.eot) src.copyUntilTurn = this.turn;
          src._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${src.printedCard.name} becomes a copy of ${t.name}${e.eot ? ' until end of turn' : ''}.`);
          break;
        }
        /* Mox Diamond: a land card discarded, or the Mox goes to the graveyard */
        case 'moxDiamond': {
          if (!src || src.zone !== 'battlefield') break;
          const lands = this.zones[ctx.controller].hand.filter(c => (c.analysis() || {}).isLand);
          if (!lands.length) { this.moveObject(src, 'graveyard'); this.logEvent('rules', `${src.name} has no land to discard and goes to the graveyard.`); break; }
          if (me.isBot || lands.length === 1) {
            const c = this._cheapestFirst(lands)[0];
            this.moveObject(c, 'graveyard'); this._afterDiscard(ctx.controller, c);
            this.logEvent('discard', `${me.name} discards ${c.name} for ${src.name}.`);
            break;
          }
          this.queueChoice({ type: 'pickCard', playerId: ctx.controller, count: 1, optional: true, purpose: 'moxDiamond',
            objId: src.id, candidates: lands.map(c => c.id), cards: lands.map(c => ({ id: c.id, name: c.name, card: c.card })),
            prompt: `Discard a land card to keep ${src.name}? If you don't, it goes to the graveyard.` });
          break;
        }

        /* "This land enters tapped unless you control a legendary creature" */
        case 'etbTappedUnlessCond': {
          if (!src) break;
          if (!this._condMet(e.cond, { controller: ctx.controller, obj: src })) src.tapped = true;
          break;
        }
        case 'etbTappedUnlessType': {
          if (!src) break;
          const has = this.battlefield.some(o => o !== src && o.controller === ctx.controller &&
            (e.types || []).some(t => / /.test(t) ? this._cardFitsWords(o, t) : this._matchesCategory(o, t)));
          if (!has) src.tapped = true;
          break;
        }

        case 'transform': {
          const x = e.self ? src : (targets[0] && this.obj(targets[0].id));
          if (!x || !x.card.card_faces || x.card.card_faces.length < 2) break;
          x.face = (x.face + 1) % x.card.card_faces.length;
          x._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${x.name} transforms.`);
          this.emit('sfx', 'transform');
          break;
        }

        /* The Ring tempts you (CR 701.52): the emblem goes up a level and
           you name a Ring-bearer, who takes on whatever the emblem has
           learned so far. */
        case 'ringTempts': {
          const p = this.player(ctx.controller);
          if (!p) break;
          p.ringLevel = Math.min(4, (p.ringLevel || 0) + 1);
          const pool = this.battlefield.filter(x => x.controller === p.id && (x.analysis() || {}).isCreature);
          if (pool.length) {
            let pick = this.obj(p.ringBearer);
            if (!pick || pick.zone !== 'battlefield' || pick.controller !== p.id) {
              pick = pool[0];
              for (const x of pool) if (this.powerOf(x) > this.powerOf(pick)) pick = x;
            }
            p.ringBearer = pick.id;
            this.logEvent('rules', `The Ring tempts ${p.name} (level ${p.ringLevel}); ${pick.name} is the Ring-bearer.`);
          } else {
            p.ringBearer = null;
            this.logEvent('rules', `The Ring tempts ${p.name} (level ${p.ringLevel}); no Ring-bearer.`);
          }
          this.bumpBoard();
          break;
        }

        /* Clash (CR 701.23): you and an opponent each show the top card of
           your library, and the bigger mana value wins. Each card goes
           back on top. */
        case 'clash': {
          const foe = this.opponentsOf(ctx.controller)[0];
          const mine = (this.zones[ctx.controller].library || [])[0];
          const theirs = foe ? (this.zones[foe.id].library || [])[0] : null;
          const mv = (c) => (c && c.card && c.card.cmc) || 0;
          const won = !!mine && mv(mine) > mv(theirs);
          this.logEvent('rules', `Clash: ${mine ? mine.name : 'nothing'} (${mv(mine)}) against ` +
            `${theirs ? theirs.name : 'nothing'} (${mv(theirs)}) — ${won ? 'you win' : 'you do not win'}.`);
          this._spliceNext(won ? (e.then || []) : (e.otherwise || []));
          break;
        }

        /* "It gains haste." — the thing the sentence before this one
           was about. */
        case 'grantLast': {
          /* "They gain first strike": every one of the group the sentence
             before was about, when it was about a group */
          if (e.plural && (this._lastGroup || []).length) {
            for (const id of this._lastGroup) {
              const x = this.obj(id);
              if (!x || x.zone !== 'battlefield') continue;
              x.effects.push({ keywords: e.keywords, until: e.until || null });
            }
            this.bumpBoard();
            break;
          }
          const last = this._lastAffected && this.obj(this._lastAffected.id);
          const x = last || this._lastCopy || null;
          if (!x || x.zone !== 'battlefield') break;
          x.effects.push({ keywords: e.keywords, until: e.until || null });
          this.bumpBoard();
          this.logEvent('rules', `${x.name} gains ${e.keywords.join(', ').toLowerCase()}.`);
          break;
        }

        /* Unearth and its cousins: the card brings itself back. */
        case 'returnSelfFromGrave': {
          const x = src || (ctx.objId && this.obj(ctx.objId));
          if (!x || x.zone !== 'graveyard') break;
          // "return it to the battlefield transformed": the back face arrives
          if (e.transformed && x.card.card_faces && x.card.card_faces.length > 1) x.face = 1;
          this.moveObject(x, 'battlefield', { controller: e.owner ? x.owner : ctx.controller });
          if (e.tapped) x.tapped = true;
          // a finality counter, a +1/+1 counter: whatever it was told to come back with
          if (e.counter && x.zone === 'battlefield') this.addCounters(x, e.counter, e.n || 1);
          this.logEvent('reanimate', `${x.name} returns to the battlefield.`);
          break;
        }

        /* ===== added automation ===== */
        case 'sequence':
          /* mid-resolution the parts go in line behind this one, so a part
             that stops to ask a question does not run the others twice */
          if (this.resolving) { this._spliceNext(e.list || []); break; }
          for (const sub of (e.list || [])) this._runEffect(sub, ctx);
          break;

        case 'regenerate':
          applyToScope(e, (o) => {
            o.shields = (o.shields || 0) + 1;
            this.logEvent('rules', `${o.name} gains a regeneration shield.`);
          });
          break;

        case 'preventDamage':
          this.prevention.push({ combatOnly: !!e.combatOnly, to: e.to || null, who: ctx.controller, until: 'eot' });
          this.logEvent('rules', `${e.combatOnly ? 'Combat damage' : 'Damage'} is prevented this turn${e.to === 'you' ? ` to ${me.name}` : ''}.`);
          break;

        case 'preventNext': {
          const amt = n(e.n);
          if (e.to === 'you') { me.preventShield = (me.preventShield || 0) + amt; break; }
          if (e.self) { if (src) src.preventShield = (src.preventShield || 0) + amt; break; }
          for (const t of targets) {
            if (t.kind === 'player') { const p = this.player(t.id); if (p) p.preventShield = (p.preventShield || 0) + amt; }
            else { const o = this.obj(t.id); if (o) o.preventShield = (o.preventShield || 0) + amt; }
          }
          break;
        }

        // "Target creature blocks this creature this turn if able."
        case 'mustBlockThis':
          if (!src) break;
          applyToScope(e, (o) => {
            o.effects.push({ mustBlockId: src.id, until: 'eot' });
            this.logEvent('rules', `${o.name} blocks ${src.name} this turn if able.`);
          });
          break;
        // "Target creature can't block this creature this turn."
        case 'cantBlockThis':
          if (!src) break;
          applyToScope(e, (o) => {
            o.effects.push({ cantBlockId: src.id, until: 'eot' });
            this.logEvent('rules', `${o.name} can't block ${src.name} this turn.`);
          });
          break;
        case 'restrict':
          applyToScope(e, (o) => {
            o.effects.push(e.duration === 'nextTurn' ? { flag: e.flag, until: null, untilTurnOf: ctx.controller } : { flag: e.flag, until: 'eot' });
            this.logEvent('rules', `${o.name}: ${FLAG_WORDS[e.flag] || e.flag}.`);
          });
          break;

        case 'goad':
          applyToScope(e, (o) => { o.goadedBy = ctx.controller; this.logEvent('rules', `${o.name} is goaded.`); });
          break;

        case 'noUntap':
          applyToScope(e, (o) => {
            o.noUntapNext = true;
            this.logEvent('rules', `${o.name} does not untap next untap step.`);
          });
          break;

        case 'toLibrary': {
          this._noteLastAffected(targets);
          for (const t of targets) {
            if (t.kind !== 'object') continue;
            const o = this.obj(t.id);
            if (!o) continue;
            this.moveObject(o, 'library', { toBottom: e.where === 'bottom' });
            if (e.where === 'shuffle') this.rng.shuffle(this.zones[o.owner].library);
            this.logEvent('zone', `${o.name} goes to the ${e.where === 'shuffle' ? 'library (shuffled)' : e.where} of its owner's library.`);
          }
          break;
        }

        case 'graveyardSweep': {
          const want = e.what || 'creature';
          const gy = this.zones[ctx.controller].graveyard.slice();
          let k = 0;
          for (const c of gy) {
            const a = c.analysis();
            if (!a) continue;
            if (want === 'creature' && !a.isCreature) continue;
            if (want === 'artifact' && !a.isArtifact) continue;
            if (want === 'enchantment' && !a.isEnchantment) continue;
            if (want === 'land' && !a.isLand) continue;
            if (want === 'planeswalker' && !a.isPlaneswalker) continue;
            this.moveObject(c, e.to === 'battlefield' ? 'battlefield' : 'hand', { controller: ctx.controller });
            k++;
          }
          this.logEvent('zone', `${me.name} returns ${k} ${want} card${k === 1 ? '' : 's'} from the graveyard.`);
          break;
        }

        case 'landFromHand': {
          const lands = this.zones[ctx.controller].hand.filter(o => { const a = o.analysis(); return a && a.isLand; });
          if (!lands.length) { this.logEvent('rules', `${me.name} has no land in hand.`); break; }
          if (lands.length === 1) { this.moveObject(lands[0], 'battlefield', { controller: ctx.controller }); break; }
          this.queueChoice({ type: 'pickCard', playerId: ctx.controller, count: 1, purpose: 'landFromHand',
            cards: lands.map(o => ({ id: o.id, name: o.name, card: o.card })),
            optional: true, prompt: 'Put a land from your hand onto the battlefield.' });
          break;
        }

        case 'impulse': {
          const cnt = n(e.n) || 1;
          // "You may play them": for as long as they stay exiled
          const until = e.duration === 'eot' ? this.turn : e.duration === 'exiled' ? 99999 : this.turn + 1;
          const whose = e.whose === 'triggerPlayer' ? (triggerPlayer() || me) : me;
          this._lastExiledList = [];
          for (let i = 0; i < cnt; i++) {
            const o = this.zones[whose.id].library.shift();
            if (!o) break;
            this.moveObject(o, 'exile');
            this._lastExiled = o.id;
            this._lastExiledList.push(o.id);
            if (e.play) { o.impulseUntil = until; o.impulseBy = ctx.controller; }
          }
          this.logEvent('exile', `${me.name} exiles the top ${cnt} card${cnt === 1 ? '' : 's'}${e.play ? ' and may play ' + (cnt === 1 ? 'it' : 'them') : ''}.`);
          break;
        }

        /* "Exile the top card of each player's library", "each player
           exiles cards from the top of their library until they exile a
           nonland card", "…until you exile cards with total mana value 4 or
           greater". What was exiled is remembered for the sentence after. */
        case 'exileTop': {
          const who = e.who === 'each' ? this.players.filter(x => !x.hasLost)
            : e.who === 'target' ? [firstPlayer() || me]
            : e.who === 'triggerPlayer' ? [triggerPlayer() || me] : [me];
          const out = [];
          for (const pl of who) {
            const lib = this.zones[pl.id].library;
            let total = 0;
            for (let i = 0; i < 200 && lib.length; i++) {
              if (!e.untilNonland && e.totalMv == null && i >= n(e.n || 1)) break;
              const c = lib[0];
              this.moveObject(c, 'exile');
              out.push(c.id);
              const ca = c.analysis() || {};
              total += (c.card && c.card.cmc) || 0;
              if (e.untilNonland && !ca.isLand) break;
              if (e.totalMv != null && total >= e.totalMv) break;
            }
          }
          this._lastExiledList = out;
          if (out.length) this._lastExiled = out[out.length - 1];
          this.logEvent('exile', `${out.length} card${out.length === 1 ? ' is' : 's are'} exiled from the top of ${who.length > 1 ? 'each library' : 'the library'}.`);
          break;
        }
        /* "You may cast any number of spells from among those cards without
           paying their mana costs" (Etali), "…a spell with mana value X or
           less from among them" (Sunbird's Invocation). Each card is offered
           in turn and cast at once, as the ability resolves (CR 608.2g). */
        case 'castFree': {
          const r = this.resolving;
          const slot = r ? r.index + ':freePool' : null;
          r && (r.marks = r.marks || {});
          let pool = r && r.marks[slot];
          if (!pool) {
            pool = e.from === 'hand' ? this.zones[ctx.controller].hand.map(c => c.id)
              : e.from === 'targets' ? targets.filter(t => t.kind === 'object').map(t => t.id)
              : e.from === 'looked' ? (this._looked || []).slice()
              : (this._lastExiledList || []).slice();
            if (r) { r.marks[slot] = pool; r.marks[slot + 'n'] = 0; }
          }
          const most = e.upTo == null ? Infinity : n(e.upTo);
          const maxMv = e.maxMv == null ? null : n(e.maxMv);
          for (let k = 0; k < pool.length; k++) {
            if (r && r.marks[slot + 'n'] >= most) break;
            const c = this.obj(pool[k]);
            if (!c || c.zone === 'stack' || c.zone === 'battlefield') continue;
            const ca = c.analysis();
            if (!ca || ca.isLand) continue;
            if (e.filter && !this._cardFitsWords(c, e.filter)) continue;
            if (maxMv != null && ((c.card && c.card.cmc) || 0) > maxMv) continue;
            if (r && r.marks[slot + 'done' + k]) continue;
            const yes = this._ask({ type: 'confirm', playerId: ctx.controller,
              prompt: `Cast ${c.name} without paying its mana cost?` }, 'fc' + k);
            if (yes === SUSPEND) return SUSPEND;
            if (r) r.marks[slot + 'done' + k] = true;
            const want = yes === null ? true : !!yes;
            if (!want) continue;
            const ok = this.castSpell(ctx.controller, c.id, { free: true, alternative: 'resolution', targets: [], auto: true });
            if (!ok) continue;
            if (r) r.marks[slot + 'n']++;
            const it = this.stack.find(st => st.objId === c.id);
            if (it && e.exileAfter) it.viaAfter = 'exile';
          }
          break;
        }

        /* Dauthi Voidwalker: an exiled card of an opponent's with a void
           counter on it, playable this turn for nothing. */
        case 'playExiledFree': {
          const pool = [];
          for (const q of this.opponentsOf(ctx.controller)) {
            for (const c of this.zones[q.id].exile) if (!e.counter || (Number(c.counters[e.counter]) || 0) > 0) pool.push(c);
          }
          if (!pool.length) break;
          let c;
          if (me.isBot || pool.length === 1) c = pool.slice().sort((x, y) => this._cardValue(y) - this._cardValue(x))[0];
          else {
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
              cards: pool.map(x => ({ id: x.id, name: x.name, card: x.card })),
              prompt: 'Choose an exiled card with a void counter on it. You may play it this turn without paying its mana cost.' }, 'pef');
            if (picked === SUSPEND) return SUSPEND;
            c = this.obj((picked || [])[0]) || pool[0];
          }
          c.freeCastBy = ctx.controller; c.freeCastTurn = this.turn;
          if ((c.analysis() || {}).isLand) { c.impulseBy = ctx.controller; c.impulseUntil = this.turn; }
          this.logEvent('rules', `${me.name} may play ${c.name} this turn without paying its mana cost.`);
          break;
        }
        /* "You may put a land card from your hand onto the battlefield. If
           you put a Cave onto the battlefield this way, you gain 4 life." */
        case 'putLandFromHand': {
          const lands = this.zones[ctx.controller].hand.filter(c => (c.analysis() || {}).isLand);
          if (!lands.length) break;
          let land = null;
          if (me.isBot) land = lands[0];
          else {
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1, optional: true,
              cards: lands.map(c => ({ id: c.id, name: c.name, card: c.card })), prompt: 'You may put a land card from your hand onto the battlefield.' }, 'plh');
            if (picked === SUSPEND) return SUSPEND;
            land = this.obj((picked || [])[0]);
          }
          if (!land || land.zone !== 'hand') break;
          this.moveObject(land, 'battlefield', { controller: ctx.controller });
          if (e.ifSubtype && this._hasSubtype(land, e.ifSubtype)) this._spliceNext(e.then || []);
          break;
        }
        /* Discover N (CR 701.57): exile from the top until a nonland card
           with mana value N or less; cast it for nothing or put it into your
           hand; the rest go to the bottom in a random order. */
        case 'discover': {
          const k = n(e.n);
          const lib = this.zones[ctx.controller].library;
          const r = this.resolving;
          r && (r.marks = r.marks || {});
          const slot = r ? r.index + ':disc' : null;
          let st = r && r.marks[slot];
          if (!st) {
            st = { exiled: [], hit: null };
            for (let i = 0; i < 300 && lib.length; i++) {
              const c = lib[0];
              this.moveObject(c, 'exile');
              const ca = c.analysis() || {};
              if (!ca.isLand && ((c.card && c.card.cmc) || 0) <= k) { st.hit = c.id; break; }
              st.exiled.push(c.id);
            }
            if (r) r.marks[slot] = st;
          }
          const hit = st.hit && this.obj(st.hit);
          if (hit && hit.zone === 'exile') {
            const yes = me.isBot ? true : this._ask({ type: 'confirm', playerId: ctx.controller,
              prompt: `Discover: cast ${hit.name} without paying its mana cost? If you don't, it goes into your hand.` }, 'disc');
            if (yes === SUSPEND) return SUSPEND;
            this._lastDiscovered = { id: hit.id, mv: (hit.card && hit.card.cmc) || 0 };
            if (yes === false || !this.castSpell(ctx.controller, hit.id, { free: true, alternative: 'resolution', targets: [], auto: true })) {
              if (hit.zone === 'exile') this.moveObject(hit, 'hand');
            }
          }
          const rest = st.exiled.map(id => this.obj(id)).filter(c => c && c.zone === 'exile');
          this.rng.shuffle(rest);
          for (const c of rest) this.moveObject(c, 'library', { toBottom: true });
          this.logEvent('rules', `${me.name} discovers ${k}${hit ? ': ' + hit.name : ''}.`);
          break;
        }
        /* Earthbend N: a land of yours becomes a 0/0 creature with haste that
           is still a land, with N +1/+1 counters; when it dies it comes back
           tapped. */
        case 'earthbend': {
          const t = firstObj();
          if (!t || t.zone !== 'battlefield') break;
          t.effects.push({ setPt: { p: 0, t: 0 }, addTypes: ['Creature'], keywords: ['Haste'], until: null, returnOnDeath: 'tapped' });
          t._chr = null;
          this.bumpBoard();
          this.addCounters(t, '+1/+1', n(e.n));
          this.logEvent('rules', `${me.name} earthbends ${n(e.n)}: ${t.name} becomes a creature.`);
          break;
        }
        /* Airbend: exiled, and its owner may cast it for {2} while it is there */
        case 'airbend':
          for (const t of targets) {
            const x = t.kind === 'object' && this.obj(t.id);
            if (!x || x.zone !== 'battlefield') continue;
            this.moveObject(x, 'exile');
            if (x.isToken) continue;
            x.airbent = true;
            this.logEvent('rules', `${x.name} is airbent.`);
          }
          break;
        /* Manifest dread: two from the top, one face down as a 2/2, the other to the graveyard */
        case 'manifestDread': {
          const lib = this.zones[ctx.controller].library;
          const two = lib.slice(0, 2);
          if (!two.length) break;
          let keep = two[0];
          if (two.length > 1) {
            if (me.isBot) keep = two.find(c => (c.analysis() || {}).isCreature) || two[0];
            else {
              const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
                cards: two.map(c => ({ id: c.id, name: c.name, card: c.card })),
                prompt: 'Manifest dread: choose the card to put onto the battlefield face down. The other goes to your graveyard.' }, 'md');
              if (picked === SUSPEND) return SUSPEND;
              keep = this.obj((picked || [])[0]) || two[0];
            }
          }
          for (const c of two) {
            if (c === keep) {
              lib.splice(lib.indexOf(c), 1);
              c.zone = 'library';
              c.faceDown = true;
              this.moveObject(c, 'battlefield', { controller: ctx.controller });
              c.faceDown = true;
            } else if (c.zone === 'library') this.moveObject(c, 'graveyard');
          }
          this.logEvent('rules', `${me.name} manifests dread.`);
          break;
        }
        /* Suspect: menace, and it can't block, for as long as it is suspected */
        case 'suspect':
          applyToScope(e, (o) => { o.effects.push({ keywords: ['Menace'], flag: 'cantBlock', suspected: true, until: null }); o._chr = null; });
          this.bumpBoard();
          break;
        /* Endure N: N +1/+1 counters on it, or an N/N white Spirit token */
        case 'endure': {
          const k = n(e.n);
          if (k <= 0) break;
          let x = null;
          applyToScope(e, (o) => { if (!x) x = o; });
          let counters = !!x && x.zone === 'battlefield';
          if (counters && !me.isBot) {
            const pick = this._ask({ type: 'mode', playerId: ctx.controller, count: 1,
              options: [{ i: 0, label: `Put ${k} +1/+1 counter${k === 1 ? '' : 's'} on ${x.name}` }, { i: 1, label: `Create a ${k}/${k} white Spirit creature token` }],
              prompt: 'Endure: which?' }, 'end');
            if (pick === SUSPEND) return SUSPEND;
            counters = (pick || [0])[0] !== 1;
          }
          if (counters) this.addCounters(x, '+1/+1', k);
          else this._createToken(ctx.controller, { n: 1, pt: k + '/' + k, colorWords: ['white'], subtypes: 'Spirit', keywords: [] });
          break;
        }
        /* Increment: a spell that cost more than this creature's power or
           toughness puts a +1/+1 counter on it. */
        case 'increment': {
          if (!src || src.zone !== 'battlefield') break;
          const st = this.stack.find(x => x.id === (ctx.triggerData || {}).stackId);
          if (!st) break;
          const spent = MANA.cmc(String(st.cost || '').replace(/\{X\}/g, '')) + (st.x || 0) * ((String(st.cost || '').match(/\{X\}/g) || []).length);
          if (spent > this.powerOf(src) || spent > this.toughnessOf(src)) this.addCounters(src, '+1/+1', 1);
          break;
        }
        /* "You may play that card this turn", "…those cards…": what the
           sentence before exiled may be played, for the turn or a bit longer. */
        case 'impulseLast': {
          const ids = (this._lastExiledList && this._lastExiledList.length ? this._lastExiledList : [this._lastExiled]).filter(Boolean);
          const until = e.duration === 'nextTurn' ? this.turn + 1 : e.duration === 'exiled' ? 99999 : this.turn;
          for (const id of ids) {
            const c = this.obj(id);
            if (!c || c.zone !== 'exile') continue;
            c.impulseBy = ctx.controller; c.impulseUntil = until;
          }
          break;
        }
        /* "Target nonland permanent becomes an artifact in addition to its
           other types until end of turn" */
        case 'addTypes':
          applyToScope(e, (o) => { o.effects.push({ addTypes: (e.types || []).slice(), addSubtypes: (e.subtypes || []).slice(), until: e.duration === 'eot' ? 'eot' : null }); o._chr = null; });
          this.bumpBoard();
          break;
        /* Maze of Ith: "prevent all combat damage that would be dealt to
           and dealt by that creature this turn" */
        case 'flagEot':
          applyToScope(e, (o) => { for (const f of (e.flags || [])) o.effects.push({ flag: f, until: 'eot' }); o._chr = null; });
          this.bumpBoard();
          break;
        /* Second Harvest: a copy of each token you control */
        case 'copyEachToken': {
          const toks = this.battlefield.filter(o => o.controller === ctx.controller && o.isToken && !o.phasedOut);
          for (const t of toks) this._runEffect({ op: 'copyPermanent', _forced: t }, ctx);
          break;
        }
        /* Nesting Grounds: a counter moved from one target to the other */
        case 'moveCounter': {
          const objs = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          const [from, to] = objs;
          if (!from || !to || from === to) break;
          const kind = Object.keys(from.counters || {}).find(k => Number(from.counters[k]) > 0);
          if (!kind) break;
          from.counters[kind] = Number(from.counters[kind]) - 1;
          if (!from.counters[kind] && kind !== 'loyalty') delete from.counters[kind];
          this.addCounters(to, kind, 1, { noReplace: true });
          from._chr = null; this.bumpBoard();
          this.logEvent('counters', `A ${kind} counter moves from ${from.name} to ${to.name}.`);
          break;
        }
        /* Emry, Conduit of Worlds: a card in your graveyard you may cast this turn */
        case 'mayCastFromGraveyard':
          for (const t of targets) {
            const c = t.kind === 'object' && this.obj(t.id);
            if (!c || c.zone !== 'graveyard') continue;
            c.graveCastBy = ctx.controller; c.graveCastTurn = this.turn;
            this.logEvent('rules', `${me.name} may cast ${c.name} from the graveyard this turn.`);
          }
          break;
        /* "Roll a d20." The result is kept for the sentence after it. */
        case 'rollDie': {
          const sides = n(e.sides) || 20;
          this._lastRoll = 1 + Math.floor(this.rng.next() * sides);
          this.logEvent('rules', `${me.name} rolls a d${sides}: ${this._lastRoll}.`);
          break;
        }
        /* Wishclaw Talisman: an opponent gains control of it */
        case 'giveSelfToOpponent': {
          if (!src || src.zone !== 'battlefield') break;
          const opps = this.opponentsOf(ctx.controller).filter(x => !x.hasLost);
          if (!opps.length) break;
          let to = opps[0];
          if (opps.length > 1 && !me.isBot) {
            const picked = this._ask({ type: 'pickTarget', playerId: ctx.controller, specs: [{ type: 'player', opponent: true }],
              options: [opps.map(x => ({ kind: 'player', id: x.id, name: x.name }))], count: 1,
              prompt: `Which opponent gains control of ${src.name}?` }, 'give');
            if (picked === SUSPEND) return SUSPEND;
            to = this.player(((picked || [])[0] || {}).id) || to;
          } else if (opps.length > 1) to = opps.slice().sort((x, y) => x.life - y.life)[0];
          src.controller = to.id;
          src._chr = null; this.bumpBoard();
          this.logEvent('rules', `${to.name} gains control of ${src.name}.`);
          break;
        }
        /* Valakut Awakening: any number of cards to the bottom, then that many plus one */
        case 'bottomThenDraw': {
          const hand = this.zones[ctx.controller].hand.slice();
          let picked = [];
          if (hand.length) {
            if (me.isBot) {
              const lands = this.battlefield.filter(o => o.controller === me.id && (o.analysis() || {}).isLand).length;
              picked = lands >= 5 ? hand.filter(c => (c.analysis() || {}).isLand).map(c => c.id) : [];
            } else {
              const got = this._ask({ type: 'pickCard', playerId: ctx.controller, count: hand.length, optional: true,
                cards: hand.map(c => ({ id: c.id, name: c.name, card: c.card })),
                prompt: 'Put any number of cards from your hand on the bottom of your library.' }, 'btd');
              if (got === SUSPEND) return SUSPEND;
              picked = got || [];
            }
          }
          let k = 0;
          for (const id of picked) {
            const c = this.obj(id);
            if (!c || c.zone !== 'hand' || c.owner !== me.id) continue;
            this.moveObject(c, 'library', { toBottom: true });
            k++;
          }
          this._drawCards(me, k + (n(e.plus) || 0));
          this.logEvent('draw', `${me.name} puts ${k} on the bottom and draws ${k + (n(e.plus) || 0)}.`);
          break;
        }
        /* "Discard a card. If you do, draw a card." */
        case 'rummage': {
          const hand = this.zones[ctx.controller].hand;
          if (!hand.length) break;
          let c = hand[0];
          if (me.isBot || hand.length === 1) c = this._cheapestFirst(hand)[0];
          else {
            const picked = this._ask({ type: 'discard', playerId: ctx.controller, count: 1, prompt: 'Discard a card.' }, 'rum');
            if (picked === SUSPEND) return SUSPEND;
            this._drawCards(me, 1);
            break;
          }
          this.moveObject(c, 'graveyard');
          this._afterDiscard(ctx.controller, c);
          this.logEvent('discard', `${me.name} discards ${c.name}.`);
          this._drawCards(me, 1);
          break;
        }
        /* Learn (CR 701.48): a Lesson from outside the game into your hand,
           or discard a card to draw one, or neither. */
        case 'learn': {
          const lessons = (me.sideboard || []).filter(x => x.qty > 0 && x.card && /\bLesson\b/.test(x.card.type_line || ''));
          const options = lessons.map((x, i) => ({ i, label: 'Put ' + x.card.name + ' into your hand', lesson: i }));
          if (this.zones[ctx.controller].hand.length) options.push({ i: options.length, label: 'Discard a card, then draw a card', rummage: true });
          if (!options.length) break;
          const got = this._choose({ playerId: ctx.controller, purpose: 'learn', kind: 'options', optional: true, min: 0, max: 1,
            options, prompt: 'Learn: a Lesson from outside the game, or discard a card to draw a card.' });
          if (got === SUSPEND) return SUSPEND;
          const pick = got && got.picks && got.picks.length ? options[got.picks[0]] : null;
          if (!pick) break;
          if (pick.rummage) { this._spliceNext([{ op: 'rummage' }]); break; }
          const entry = lessons[pick.lesson];
          entry.qty--;
          const card = this._register(new GObj(entry.card, ctx.controller, 'hand'));
          this.zones[ctx.controller].hand.push(card);
          this.logEvent('rules', `${me.name} learns: ${entry.card.name} from outside the game.`);
          break;
        }
        /* A land token: its land types give it its mana */
        case 'landToken': {
          const card = { id: 'token:land:' + (e.name || 'Land') + ':' + (e.subtypes || []).join(''), name: e.name || 'Land', layout: 'token',
            mana_cost: '', cmc: 0, type_line: 'Token Land' + ((e.subtypes || []).length ? ' \u2014 ' + e.subtypes.join(' ') : ''),
            oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common', set: 'tkn', set_name: 'Token',
            collector_number: '0', image_uris: null, _isToken: true };
          const t = this._register(new GObj(card, ctx.controller, 'battlefield'));
          t.isToken = true; t.zone = 'battlefield'; t.entered = this.turn;
          if (e.tapped) t.tapped = true;
          t.ts = this._stampNew();      // its timestamp (CR 613.7d)
          this.battlefield.push(t);
          this.bumpBoard();
          this._fireEnters(t);
          this._fire('youCreateToken', ctx.controller, { object: t });
          this.logEvent('token', `${me.name} creates ${card.name}, a land token.`);
          break;
        }
        /* Ninjutsu resolving: in, tapped and attacking the same defender */
        case 'ninjaIn': {
          if (!src || src.zone !== 'hand') break;
          this.moveObject(src, 'battlefield', { controller: ctx.controller });
          src.tapped = true;
          if (this.phase && this.phase.id === 'combat' && e.defender) {
            src.attacking = e.defender;
            this.combat.attackers.push(src.id);
          }
          break;
        }
        /* Crew: an artifact creature until end of turn (CR 702.122) */
        case 'crewed':
          if (!src || src.zone !== 'battlefield') break;
          src.effects.push({ addTypes: ['Creature'], until: 'eot' });
          src._chr = null; this.bumpBoard();
          this.logEvent('rules', `${src.name} is crewed.`);
          this._fire('becomesCrewed', src.controller, { source: src, object: src });
          break;
        case 'saddled':
          if (!src || src.zone !== 'battlefield') break;
          src.saddledTurn = this.turn;
          this.logEvent('rules', `${src.name} is saddled.`);
          this._fire('becomesSaddled', src.controller, { source: src, object: src });
          break;
        /* Echo: pay it, or sacrifice the permanent */
        case 'echo': {
          if (!src || src.zone !== 'battlefield') break;
          const can = this.couldPay(ctx.controller, e.cost, this.manaSources(ctx.controller));
          const yes = !can ? false : me.isBot ? true : this._ask({ type: 'confirm', playerId: ctx.controller,
            prompt: `Pay the echo cost ${e.cost} for ${src.name}? If you don't, it is sacrificed.` }, 'echo');
          if (yes === SUSPEND) return SUSPEND;
          src.echoDue = false;
          if (yes && this.payMana(ctx.controller, e.cost, { auto: true })) { this.logEvent('rules', `${me.name} pays echo for ${src.name}.`); break; }
          this.moveObject(src, 'graveyard');
          this.logEvent('sacrifice', `${src.name} is sacrificed for its echo.`);
          this._fire('youSacrifice', ctx.controller, { count: 1, object: src, objController: ctx.controller });
          break;
        }
        /* Living weapon, For Mirrodin!: a token to carry the Equipment */
        case 'germ': {
          if (!src || src.zone !== 'battlefield') break;
          this._createToken(ctx.controller, { n: 1, pt: e.pt, colorWords: e.colorWords || [], subtypes: e.subtypes, keywords: [] });
          const body = this._lastAffected && this.obj(this._lastAffected.id);
          if (!body || body.zone !== 'battlefield') break;
          if (src.attachedTo) { const old = this.obj(src.attachedTo); if (old) old.attachments = (old.attachments || []).filter(id => id !== src.id); }
          src.attachedTo = body.id;
          src.ts = this._stampNew();       // attached anew, it is newer (CR 613.7e)
          body.attachments = (body.attachments || []).concat(src.id);
          this.bumpBoard();
          break;
        }
        /* Fading and vanishing: a counter off each upkeep */
        case 'clockTick': {
          if (!src || src.zone !== 'battlefield') break;
          const have = Number(src.counters[e.kind]) || 0;
          if (have <= 0) {
            if (!e.vanishing) { this.moveObject(src, 'graveyard'); this.logEvent('sacrifice', `${src.name} fades away.`); }
            break;
          }
          src.counters[e.kind] = have - 1;
          src._chr = null; this.bumpBoard();
          if (e.vanishing && have - 1 === 0) { this.moveObject(src, 'graveyard'); this.logEvent('sacrifice', `${src.name} vanishes.`); }
          break;
        }
        case 'renowned': if (src) src.renowned = true; break;
        case 'rampage': {
          if (!src || src.zone !== 'battlefield') break;
          const extra = Math.max(0, (src.blockedBy || []).length - 1) * (n(e.n) || 0);
          if (extra) { src.effects.push({ p: extra, t: extra, until: 'eot' }); src._chr = null; }
          break;
        }
        /* Forgotten Ancient: "move any number of +1/+1 counters from this
           creature onto other creatures". One counter at a time, asked
           until the player stops or runs out; each move happens once, however
           often the asking stops and starts again. A bot keeps them. */
        case 'moveCountersOut': {
          if (!src || src.zone !== 'battlefield' || me.isBot) break;
          const kind = e.kind || '+1/+1';
          const r = this.resolving;
          r && (r.marks = r.marks || {});
          for (let k = 0; k < 60; k++) {
            if (!((Number(src.counters[kind]) || 0) > 0)) break;
            const pool = this.battlefield.filter(o => o !== src && !o.phasedOut && this.characteristics(o).isCreature);
            if (!pool.length) break;
            const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1, optional: true,
              cards: pool.map(o => ({ id: o.id, name: o.name, card: o.card })),
              prompt: `Move a ${kind} counter from ${src.name} onto which creature? Choose none to stop.` }, 'mv' + k);
            if (picked === SUSPEND) return SUSPEND;
            const to = this.obj((picked || [])[0]);
            if (!to || to.zone !== 'battlefield') break;
            const mark = r ? r.index + ':moved' + k : null;
            if (mark && r.marks[mark]) continue;
            if (mark) r.marks[mark] = true;
            src.counters[kind] = (Number(src.counters[kind]) || 0) - 1;
            this.addCounters(to, kind, 1);
            src._chr = null;
            this.logEvent('counters', `A ${kind} counter moves from ${src.name} to ${to.name}.`);
          }
          this.bumpBoard();
          break;
        }
        /* Selvala: the creature that arrived, if it is bigger than every
           other creature, lets its controller draw. */
        case 'drawIfBiggest': {
          const id = (ctx.triggerData || {}).objectId;
          const x = id && this.obj(id);
          if (!x || x.zone !== 'battlefield') break;
          const pw = this.powerOf(x);
          if (this.battlefield.some(o => o !== x && this.characteristics(o).isCreature && this.powerOf(o) >= pw)) break;
          const who = this.player(x.controller);
          if (!who || who.hasLost) break;
          const yes = who.isBot ? true : this._ask({ type: 'confirm', playerId: who.id, prompt: `Draw a card for ${x.name}?` }, 'dib');
          if (yes === SUSPEND) return SUSPEND;
          if (yes !== false) this._drawCards(who, 1);
          break;
        }
        /* "Double target creature's power and toughness": it gets +X/+X,
           X being what it has now (CR 701.10e). */
        case 'doublePT':
          applyToScope(e, (o) => {
            if (!this.characteristics(o).isCreature) return;
            const p = Math.max(0, this.powerOf(o)), t = e.toughness ? Math.max(0, this.toughnessOf(o)) : 0;
            o.effects.push({ p, t, until: 'eot' });
            o._chr = null;
          });
          this.bumpBoard();
          break;

        case 'doubleCounters': {
          const kind = e.kind || '+1/+1';
          const dbl = (o) => {
            const have = (o.counters && o.counters[kind]) || 0;
            if (have) { this.addCounters(o, kind, have); this.logEvent('counters', `${o.name} now has ${have * 2} ${kind} counters.`); }
          };
          // "on this creature", "on each creature you control" as well as a target
          if (e.scope) applyToScope(e, dbl);
          else for (const t of targets) { const o = t.kind === 'object' && this.obj(t.id); if (o) dbl(o); }
          break;
        }

        case 'damageByPower': {
          const objs = targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          const shooter = objs[0];
          if (!shooter) break;
          const amt = this.powerOf(shooter);
          const rest = targets.slice(1);
          for (const t of rest) {
            if (t.kind === 'player') this.dealDamageToPlayer(this.player(t.id), amt, shooter);
            else { const o = this.obj(t.id); if (o && o !== shooter) this.dealDamageToObject(o, amt, shooter); }
          }
          this.emit('sfx', 'damage');
          break;
        }

        case 'handAttack': {
          const victim = firstPlayer() || this.opponentsOf(ctx.controller)[0];
          if (!victim) break;
          // "a noncreature, nonland card" is two conditions, not one word
          const want = (e.filter || 'nonland').toLowerCase().split(/[\s,]+/).filter(Boolean);
          const hand = this.zones[victim.id].hand.filter(o => {
            const a = o.analysis();
            if (!a) return false;
            // Inquisition of Kozilek: "with mana value 3 or less"
            if (e.maxMv != null && ((o.card && o.card.cmc) || 0) > e.maxMv) return false;
            return want.every((w) => {
              switch (w) {
                case 'card': case 'any': return true;
                case 'nonland': return !a.isLand;
                case 'land': return a.isLand;
                case 'creature': return a.isCreature;
                case 'noncreature': return !a.isCreature;
                case 'artifact': return a.isArtifact;
                case 'nonartifact': return !a.isArtifact;
                case 'enchantment': return !!a.isEnchantment;
                case 'instant': case 'sorcery': case 'planeswalker':
                  return (o.card.type_line || '').toLowerCase().includes(w);
                default: return (o.card.type_line || '').toLowerCase().includes(w);
              }
            });
          });
          this.logEvent('reveal', `${victim.name} reveals their hand to ${me.name}.`);
          if (!hand.length) break;
          this.queueChoice({ type: 'pickCard', playerId: ctx.controller, count: 1,
            purpose: e.to === 'exile' ? 'exileFromHand' : 'discardFromHand',
            cards: hand.map(o => ({ id: o.id, name: o.name, card: o.card })),
            prompt: `Choose a ${want} card from ${victim.name}'s hand to ${e.to === 'exile' ? 'exile' : 'discard'}.` });
          break;
        }

        /* Chaos Warp: the owner reveals the top card of their library and,
           if it is a permanent card, puts it onto the battlefield. */
        case 'revealTopPut': {
          const who = e.who === 'lastOwner' ? (this.player((this._lastAffected || {}).owner) || me) : me;
          const top = this.zones[who.id].library[0];
          if (!top) break;
          this.logEvent('reveal', `${who.name} reveals ${top.name}.`);
          if (this._cardFitsWords(top, e.filter || 'permanent')) this.moveObject(top, 'battlefield', { controller: who.id });
          break;
        }
        /* Herald's Horn: the top card into your hand, if it is the right kind */
        case 'topIfToHand': {
          const top = this.zones[ctx.controller].library[0];
          if (!top) break;
          const fits = this._cardFitsWords(top, e.filter || 'card') && (!e.chosenType || (src && this._hasCreatureType(top, src.chosenType)));
          if (!fits) { this.logEvent('rules', `${me.name} looks at the top card and leaves it there.`); break; }
          const yes = this._ask({ type: 'confirm', playerId: ctx.controller, prompt: `Reveal ${top.name} and put it into your hand?` }, 'top');
          if (yes === SUSPEND) return SUSPEND;
          if (yes) { this.moveObject(top, 'hand'); this.logEvent('reveal', `${me.name} reveals ${top.name} and puts it into their hand.`); }
          break;
        }
        /* "Change the target of target spell or ability with a single
           target", "You may choose new targets for target spell". */
        case 'retarget': {
          const t = targets.find(x => x.kind === 'stack');
          const item = t && this.stack.find(st => st.id === t.id);
          if (!item) break;
          const specs = [];
          for (const ef of (item.effects || (item.obj ? this._cardSpellEffects(item.obj.analysis()) : []))) {
            for (const sp of (ef.targets || [])) specs.push(sp);
          }
          if (!specs.length || !(item.targets || []).length) { this.logEvent('rules', `${item.name} has no target to change.`); break; }
          if (e.single && item.targets.length !== 1) { this.logEvent('rules', `${item.name} has more than one target.`); break; }
          const options = specs.slice(0, item.targets.length).map(sp => this._legalTargetsFor(sp, item.controller)
            .filter(x => !(x.kind === 'stack' && x.id === item.id)));
          if (options.some(l => !l.length)) break;
          const picked = this._ask({ type: 'pickTarget', playerId: ctx.controller, specs: specs.slice(0, item.targets.length),
            options, count: item.targets.length, prompt: `New target${item.targets.length === 1 ? '' : 's'} for ${item.name}` }, 'rt');
          if (picked === SUSPEND) return SUSPEND;
          const now = (picked || []).map(normTarget).filter(Boolean);
          if (now.length === item.targets.length) {
            item.targets = now;
            delete item.resolvedTargets;
            this.logEvent('rules', `${me.name} changes the target of ${item.name}.`);
          }
          break;
        }
        /* Rishkar's Expertise: a spell from your hand, for nothing */
        case 'castFreeFromHand': {
          const cap = e.maxMv === 'X' ? n('X') : e.maxMv;
          const pool = this.zones[ctx.controller].hand.filter(c => {
            const ca = c.analysis();
            if (!ca || ca.isLand) return false;
            if (cap != null && ((c.card && c.card.cmc) || 0) > cap) return false;
            return !e.filter || e.filter === 'card' || this._cardFitsWords(c, e.filter);
          });
          if (!pool.length) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1, optional: true,
            cards: pool.map(c => ({ id: c.id, name: c.name, card: c.card })),
            prompt: 'Cast a spell from your hand without paying its mana cost?' }, 'free');
          if (picked === SUSPEND) return SUSPEND;
          const c = this.obj((picked || [])[0]);
          if (!c || c.zone !== 'hand') break;
          /* It is cast now, on top of this spell; anything it points at is
             chosen as it resolves. */
          this._castingNested = true;
          const prior = this.priorityIndex;
          try { this._castFree(ctx.controller, c); } finally { this._castingNested = false; this.priorityIndex = prior; }
          break;
        }
        /* Malakir Rebirth: "When this creature dies, return it to the battlefield tapped" */
        case 'grantDiesReturn':
          applyToScope(e, (o) => o.effects.push({ returnOnDeath: e.tapped ? 'tapped' : 'untapped', until: 'eot' }));
          break;
        /* The One Ring, Teferi's Protection: protection from everything
           until your next turn (and, for Teferi's, a life total that
           can't change). */
        case 'playerProtection': {
          me.protection = { setTurn: this.turn };
          if (e.lifeLocked) me.lifeLocked = { setTurn: this.turn, until: me.id };
          this.logEvent('rules', `${me.name} gains protection from everything until their next turn.`);
          break;
        }
        /* "All permanents you control phase out" */
        case 'phaseOut': {
          const list = e.scope && e.scope.self ? [src].filter(x => x && x.zone === 'battlefield')
            : e.scope && typeof e.scope === 'object' ? this._scopeList(e.scope, ctx.controller, src)
            : targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean);
          for (const o of list) {
            o.phasedOut = true; o.phasedOutBy = o.controller; o.phasedTurn = this.turn;
            for (const id of (o.attachments || [])) { const at = this.obj(id); if (at) { at.phasedOut = true; at.phasedOutBy = o.controller; at.phasedTurn = this.turn; } }
          }
          this.bumpBoard();
          this.logEvent('rules', `${list.length} permanent${list.length === 1 ? '' : 's'} phase out.`);
          break;
        }
        /* Victimize: sacrifice, and only if you did, the rest happens */
        case 'sacThen': {
          const pool = this._sacrificePool(ctx.controller, { filter: e.filter || 'creature', another: !!e.other }, src);
          if (!pool.length) break;
          const before = this._sacCount || 0;
          if (!this._doneHere('sac')) {
            if (me.isBot || pool.length === 1) this._sacrificeNow(ctx.controller, this._cheapestFirst(pool).slice(0, 1), ctx);
            else {
              const got = this._ask({ type: 'sacrifice', playerId: ctx.controller, count: 1, filter: e.filter || 'creature',
                candidates: pool.map(o => o.id), prompt: `Sacrifice a ${e.filter || 'creature'}.` }, 'sac');
              if (got === SUSPEND) { ctx._sacBefore = before; return SUSPEND; }
            }
          }
          const was = ctx._sacBefore != null ? ctx._sacBefore : before;
          if ((this._sacCount || 0) > was) this._spliceNext(e.then || []);
          ctx._sacBefore = null;
          break;
        }
        /* Chrome Mox: a card from your hand, exiled under it */
        case 'imprintFromHand': {
          const pool = this.zones[ctx.controller].hand.filter(c => this._cardFitsWords(c, e.filter || 'card'));
          if (!pool.length || !src) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1, optional: true,
            cards: pool.map(c => ({ id: c.id, name: c.name, card: c.card })), prompt: `Exile a card from your hand with ${src.name}?` }, 'imp');
          if (picked === SUSPEND) return SUSPEND;
          const c = this.obj((picked || [])[0]);
          if (!c || c.zone !== 'hand') break;
          this.moveObject(c, 'exile');
          src.imprinted = c.id;
          this.logEvent('rules', `${me.name} exiles ${c.name} with ${src.name}.`);
          break;
        }
        /* Animate Dead: the creature it was put on is sacrificed when it goes */
        case 'sacAttached': {
          const x = src && (src.lastAttachedTo || src.attachedTo) && this.obj(src.lastAttachedTo || src.attachedTo);
          if (x && x.zone === 'battlefield') { this.moveObject(x, 'graveyard'); this.logEvent('sacrifice', `${x.name} is sacrificed.`); }
          break;
        }
        /* Hideaway (CR 702.75): look at the top cards, keep one face down under this */
        case 'hideaway': {
          const k = n(e.n) || 4;
          const cards = this._topOfLibrary(ctx.controller, k);
          if (!cards.length || !src) break;
          const picked = this._ask({ type: 'pickCard', playerId: ctx.controller, count: 1,
            cards, prompt: `Hideaway: exile one of them face down under ${src.name}.` }, 'hide');
          if (picked === SUSPEND) return SUSPEND;
          const z = this.zones[ctx.controller].library;
          const top = z.slice(0, cards.length);
          const keep = this.obj((picked || [])[0]) || top[0];
          for (const c of top) {
            if (c === keep) { this.moveObject(c, 'exile'); c.hiddenBy = src.id; c.faceDownExile = true; src.hidden = c.id; }
          }
          const rest = top.filter(c => c !== keep && c.zone === 'library');
          for (const c of rest) { z.splice(z.indexOf(c), 1); }
          this.rng.shuffle(rest);
          for (const c of rest) z.push(c);
          this.logEvent('rules', `${me.name} hides a card away under ${src.name}.`);
          break;
        }
        /* "You may play the exiled card without paying its mana cost if …" */
        case 'playHidden': {
          const c = src && src.hidden && this.obj(src.hidden);
          if (!c || c.zone !== 'exile') break;
          if (e.cond && !this._condMet(e.cond, ctx)) { this.logEvent('rules', `${src.name}: the condition is not met.`); break; }
          c.freeCastBy = ctx.controller; c.freeCastTurn = this.turn; c.faceDownExile = false;
          if ((c.analysis() || {}).isLand) { c.impulseBy = ctx.controller; c.impulseUntil = this.turn; }
          this.logEvent('rules', `${me.name} may play ${c.name} for free this turn.`);
          break;
        }
        /* Mistrise Village */
        case 'nextSpellUncounterable': me.nextSpellUncounterable = this.turn; break;
        /* Reality Shift: the top card of a library, face down, as a 2/2 */
        case 'manifest': {
          const who = e.who === 'targetController' ? (this._lastAffectedController() || me) : me;
          const top = this.zones[who.id].library[0];
          if (!top) break;
          this.zones[who.id].library.shift();
          top.zone = 'library';
          top.faceDown = true;
          this.moveObject(top, 'battlefield', { controller: who.id });
          top.faceDown = true;
          this.logEvent('rules', `${who.name} manifests the top card of their library.`);
          break;
        }
        /* The Ozolith: counters moved off a creature that left, and back on */
        case 'takeLastCounters': {
          const gone = this._lastLeft && this.obj(this._lastLeft);
          const had = (gone && gone._diedCounters) || {};
          if (!src) break;
          for (const k of Object.keys(had)) if (had[k] > 0) this.addCounters(src, k, had[k]);
          break;
        }
        case 'moveAllCounters': {
          const to = firstObj();
          if (!src || !to) break;
          for (const k of Object.keys(src.counters)) {
            const v = Number(src.counters[k]) || 0;
            if (v > 0) { delete src.counters[k]; this.addCounters(to, k, v); }
          }
          this.bumpBoard();
          break;
        }
        /* Living Death */
        case 'livingDeath': {
          const live = this.players.filter(p => !p.hasLost);
          const exiled = {};
          for (const p of live) {
            exiled[p.id] = this.zones[p.id].graveyard.filter(c => (c.analysis() || {}).isCreature);
            for (const c of exiled[p.id]) this.moveObject(c, 'exile');
          }
          const doomed = this.battlefield.filter(o => !o.phasedOut && this.characteristics(o).isCreature);
          this._leavingTogether = doomed;
          for (const o of doomed) if (o.zone === 'battlefield') this.moveObject(o, 'graveyard');
          this._leavingTogether = null;
          for (const p of live) for (const c of exiled[p.id]) if (c.zone === 'exile') this.moveObject(c, 'battlefield', { controller: p.id });
          this.logEvent('rules', 'Living Death: the dead and the living change places.');
          break;
        }
        /* Rise of the Dark Realms */
        case 'massReanimate': {
          const cards = [];
          // "all land cards from your graveyard", or every creature card in every graveyard
          const from = e.yours ? [me] : this.players;
          for (const p of from) {
            for (const c of this.zones[p.id].graveyard) {
              if (e.filter ? this._cardFitsWords(c, e.filter) : (c.analysis() || {}).isCreature) cards.push(c);
            }
          }
          for (const c of cards) {
            this.moveObject(c, 'battlefield', { controller: e.mine || e.yours ? ctx.controller : c.owner });
            if (e.tapped && c.zone === 'battlefield') c.tapped = true;
          }
          this.logEvent('reanimate', `${cards.length} card${cards.length === 1 ? '' : 's'} return${cards.length === 1 ? 's' : ''} to the battlefield.`);
          break;
        }
        /* Braids, Arisen Nightmare: you may sacrifice something; each
           opponent then gives up something of the same kind, or loses 2
           life and you draw. */
        case 'braids': {
          const KINDS = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker'];
          if (ctx._braids == null) {
            const pool = this._sacrificePool(ctx.controller, { filter: KINDS.join(' or ') }, null);
            if (!pool.length) break;
            ctx._braidsBefore = ctx._braidsBefore != null ? ctx._braidsBefore : (this._sacCount || 0);
            const got = this._ask({ type: 'sacrifice', playerId: ctx.controller, count: 1, optional: true,
              candidates: pool.map(o => o.id), filter: 'permanent',
              prompt: 'Braids: sacrifice an artifact, creature, enchantment, land or planeswalker?' }, 'mine');
            if (got === SUSPEND) return SUSPEND;
            if ((this._sacCount || 0) <= ctx._braidsBefore) { ctx._braids = false; break; }
            ctx._braids = (this._lastSacrificed && this._lastSacrificed[0] && this._lastSacrificed[0].types || [])
              .map(t => t.toLowerCase()).filter(t => KINDS.includes(t));
          }
          if (!ctx._braids || !ctx._braids.length) break;
          for (const foe of this.opponentsOf(ctx.controller)) {
            const key = 'f' + foe.id;
            if (ctx['_bd' + key]) continue;
            const pool = this._sacrificePool(foe.id, { filter: ctx._braids.join(' or ') }, null);
            let gave = false;
            if (pool.length) {
              if (ctx['_bb' + key] == null) ctx['_bb' + key] = this._sacCount || 0;
              const got = this._ask({ type: 'sacrifice', playerId: foe.id, count: 1, optional: true,
                candidates: pool.map(o => o.id), filter: 'permanent',
                prompt: `Sacrifice a ${ctx._braids.join(' or ')}? If you don't, you lose 2 life and ${me.name} draws a card.` }, key);
              if (got === SUSPEND) return SUSPEND;
              gave = (this._sacCount || 0) > ctx['_bb' + key];
            }
            ctx['_bd' + key] = true;
            if (!gave) { this.changeLife(foe, -2); this._drawCards(me, 1); }
          }
          break;
        }
        /* A standing-rule shape used as a one-off ("creatures you control
           gain trample until end of turn"): applied to what it names now,
           for the rest of the turn. */
        case 'continuous': {
          const sc = e.scope || {};
          const list = sc.self ? [src].filter(Boolean)
            : sc.attached ? [src && src.attachedTo && this.obj(src.attachedTo)].filter(Boolean)
            : targets.some(t => t.kind === 'object') && !sc.who ? targets.filter(t => t.kind === 'object').map(t => this.obj(t.id)).filter(Boolean)
            : this._scopeList(Object.assign({ what: 'creature' }, sc), ctx.controller, src);
          for (const o of list) {
            const eff = { until: e.until === 'permanent' ? null : 'eot' };
            if (e.grant) eff.keywords = e.grant.slice();
            if (e.pt) { eff.p = this._contValue(e.pt.p, o); eff.t = this._contValue(e.pt.t, o); }
            if (e.flag) eff.flag = e.flag;
            o.effects.push(eff);
          }
          this.bumpBoard();
          break;
        }
        /* "Until end of turn, target creature loses all abilities and becomes
           a blue Frog with base power and toughness 1/1"; "switch target
           creature's power and toughness"; "target land becomes a 3/3
           creature that's still a land". One effect, each part in its own
           layer, on each permanent named as it resolves (CR 611.2c). */
        case 'becomes': {
          const until = e.duration === 'permanent' ? null : 'eot';
          const eff = e.eff || {};
          applyToScope(e, (o) => {
            if (!o || o.zone !== 'battlefield') return;
            o.effects.push(Object.assign(JSON.parse(JSON.stringify(eff)), { until }));
            o._chr = null;
          });
          this.bumpBoard();
          break;
        }
        /* Mirrorweave: "Each other creature becomes a copy of target
           nonlegendary creature until end of turn." A copy effect (layer 1):
           what each was is kept, and comes back as the turn ends. */
        case 'becomeCopyAll': {
          const model = firstObj();
          if (!model || model.zone !== 'battlefield') break;
          const card = model.card, face = model.face || 0;
          const others = this.battlefield.filter(o => o !== model && !o.phasedOut && (o.analysis() || {}).isCreature);
          for (const o of others) {
            if (o.copyUntilTurn == null) o.copyBefore = { card: o.card, face: o.face || 0, copyOf: o.copyOf || null };
            o.printedCard = o.printedCard || o.card;
            o.card = card; o.face = face; o.copyOf = card;
            o.copyUntilTurn = e.duration === 'permanent' ? null : this.turn;
            if (e.duration === 'permanent') o.copyBefore = null;
            o._chr = null;
          }
          this.bumpBoard();
          this.logEvent('rules', `${others.length} creature${others.length === 1 ? '' : 's'} become${others.length === 1 ? 's' : ''} a copy of ${model.name}${e.duration === 'permanent' ? '' : ' until end of turn'}.`);
          break;
        }
        case 'extraLand': me.maxLands += (e.n || 1); break;
        case 'extraTurn': this.extraTurnsQueue.push(ctx.controller); this.logEvent('rules', `${me.name} takes an extra turn.`); break;
        // "You gain hexproof until end of turn."
        case 'hexproofYou': me.hexproofTurn = this.turn; this.logEvent('keyword', `${me.name} gains hexproof until end of turn.`); break;
        /* Gift (CR 702.174): the opponent who was promised it gets it. */
        case 'giveGift': {
          const to = this.player(ctx.gift != null ? ctx.gift : (src && src.giftTo));
          if (!to || to.hasLost) break;
          const g = String(e.gift || 'card');
          if (g === 'card') this._drawCards(to, 1);
          else if (g === 'extra turn') this.extraTurnsQueue.push(to.id);
          else if (g === 'octopus') this._createToken(to.id, { n: 1, pt: '8/8', colorWords: ['blue'], subtypes: 'Octopus', keywords: [] });
          else if (/fish$/.test(g)) this._createToken(to.id, { n: 1, pt: '1/1', colorWords: ['blue'], subtypes: 'Fish', keywords: [], tapped: /tapped/.test(g) });
          else this._createNamedToken(to.id, { token: U.titleCase(g), n: 1 });
          this.logEvent('rules', `${to.name} gets the gift: ${g === 'card' ? 'a card' : g === 'extra turn' ? 'an extra turn' : 'a ' + g}.`);
          break;
        }
        case 'shuffle': this.rng.shuffle(this.zones[ctx.controller].library); this.emit('sfx', 'shuffle'); break;
        case 'noop': break;
        case 'etbTapped': case 'cantBlock': case 'cantAttack': case 'mustAttack':
        case 'anthem': case 'equipBonus': case 'auraBonus': case 'enchant': case 'equip':
          break;   // static, handled where they matter
        default:
          this.logEvent('manual', `Unhandled effect "${e.op}" - resolve by hand.`);
          this.emit('manual', { ctx, text: e.text || e.op, controller: ctx.controller });
      }
    }

    /**
     * The permanents a group phrase names right now: "permanents you
     * control", "other attacking creatures", "each creature target player
     * controls". The same scope words a static ability uses, applied once.
     */
    _scopeList(sc, controllerId, src, targetPid, inLayers) {
      const out = [];
      const pid = sc.who === 'target' ? (targetPid || controllerId) : controllerId;
      for (const o of this.battlefield.slice()) {
        if (o.phasedOut) continue;
        const oa = o.analysis();
        if (!oa) continue;
        if (this._scopeHit(sc, o, oa, pid, src, !!inLayers)) out.push(o);
      }
      return out;
    }

    /**
     * Does one permanent belong to a group like "other nontoken creatures
     * you control" or "nonbasic lands"? `pid` is whose "you" it is. Inside a
     * continuous effect the permanent's current power cannot be asked for
     * (that is what is being worked out), so there the printed numbers and
     * its counters stand in.
     */
    _scopeHit(sc, o, oa, pid, src, inLayers) {
      if (sc.other && src && src.id === o.id) return false;
      // "other creatures you control named Hare Apparent"
      if (sc.name && o.name !== sc.name) return false;
      if ((sc.who === 'you' || sc.who === 'target') && o.controller !== pid) return false;
      if (sc.who === 'opponents' && o.controller === pid) return false;
      const isType = (t) => {
        if (t === 'permanent') return true;
        if (t === 'creature' && !inLayers) return !!this.characteristics(o).isCreature;
        return (oa.types || []).some(x => x.toLowerCase() === t) || (oa.subtypes || []).some(x => x.toLowerCase() === t);
      };
      const want = sc.what || 'creature';
      if (sc.anyOf ? !sc.anyOf.some(isType) : !isType(want)) return false;
      if (sc.notType && sc.notType.some(isType)) return false;
      if (sc.alsoType && !sc.alsoType.every(isType)) return false;
      if (sc.subtype && !(oa.subtypes || []).some(t => t.toLowerCase() === sc.subtype)) return false;
      // "Elves and Goblins you control": any one of several creature types
      if (sc.subtypes && !sc.subtypes.some(st => (oa.subtypes || []).some(t => t.toLowerCase() === st) ||
          (oa.keywordSet && oa.keywordSet.has('changeling')))) return false;
      if (sc.notSubtype && (oa.subtypes || []).some(t => t.toLowerCase() === sc.notSubtype)) return false;
      if (sc.chosenType && !(src && src.chosenType && ((oa.subtypes || []).some(t => t.toLowerCase() === String(src.chosenType).toLowerCase()) ||
          (oa.keywordSet && oa.keywordSet.has('changeling'))))) return false;
      if (sc.chosenColor && !(src && src.chosenColor && (oa.colors || []).includes(src.chosenColor))) return false;
      if (sc.nonbasic && (oa.supertypes || []).includes('Basic')) return false;
      if (sc.legendary && !(oa.supertypes || []).includes('Legendary')) return false;
      if (sc.nonlegendary && (oa.supertypes || []).includes('Legendary')) return false;
      if (sc.nontoken && o.isToken) return false;
      if (sc.token && !o.isToken) return false;
      if (sc.tapped && !o.tapped) return false;
      if (sc.untapped && o.tapped) return false;
      if (sc.attacking && !o.attacking) return false;
      if (sc.blocking && !(o.blocking || []).length) return false;
      if (sc.withCounter && !(Number(o.counters[sc.withCounter]) > 0)) return false;
      if (sc.withAnyCounter && !Object.values(o.counters || {}).some(v => Number(v) > 0)) return false;
      if (sc.color && !(oa.colors || []).includes(sc.color)) return false;
      if (sc.notColor && (oa.colors || []).includes(sc.notColor)) return false;
      const mv = (o.card && o.card.cmc) || 0;
      if (sc.maxMv != null && mv > sc.maxMv) return false;
      if (sc.minMv != null && mv < sc.minMv) return false;
      if (sc.minPower != null || sc.maxPower != null) {
        const pw = inLayers
          ? (parseInt(oa.power, 10) || 0) + (Number(o.counters['+1/+1']) || 0) - (Number(o.counters['-1/-1']) || 0)
          : this.powerOf(o);
        if (sc.minPower != null && pw < sc.minPower) return false;
        if (sc.maxPower != null && pw > sc.maxPower) return false;
      }
      if (!inLayers && sc.keyword && !this.hasKw(o, sc.keyword)) return false;
      if (!inLayers && sc.withoutKeyword && this.hasKw(o, sc.withoutKeyword)) return false;
      if (inLayers && sc.keyword && !(oa.keywordSet && oa.keywordSet.has(sc.keyword))) return false;
      return true;
    }

    /**
     * Tap a permanent, telling anything that watches for it ("whenever this
     * land becomes tapped" — City of Brass). Tapping something already
     * tapped is not an event.
     */
    _markTapped(o) {
      if (!o || o.tapped) return;
      o.tapped = true;
      this._fire('becomesTapped', o.controller, { source: o, object: o });
    }

    /**
     * Is something stopping this player casting spells right now? Silence for
     * the turn, or a Grand Abolisher across the table during its controller's
     * turn. Returns why, or null.
     */
    _castBlocked(playerId, abilities) {
      const p = this.player(playerId);
      if (!abilities && p && p.silencedTurn === this.turn) return "You can't cast spells this turn.";
      for (const o of this.battlefield) {
        if (o.controller === playerId || o.phasedOut) continue;
        const e = this._staticOp(o, 'castRestrict');
        if (!e) continue;
        if (abilities && !e.abilities) continue;
        if (e.yourTurnOnly && !(this.activePlayer && this.activePlayer.id === o.controller)) continue;
        return `${o.name} stops that.`;
      }
      return null;
    }

    /** Is this spell one nothing can counter: "creature spells you control can't be countered", Cavern of Souls? */
    _uncounterable(item) {
      if (!item) return false;
      if (item.uncounterable) return true;
      for (const o of this.battlefield) {
        const e = this._staticOp(o, 'uncounterable');
        if (!e) continue;
        if (e.who === 'you' && o.controller !== item.controller) continue;
        if (e.words && item.obj && !this._cardFitsWords(item.obj, e.words)) continue;
        return true;
      }
      return false;
    }

    /**
     * Cast a card for nothing, in the middle of something else resolving: no
     * timing check, no mana, no targets chosen up front.
     */
    _castFree(playerId, o) {
      const a = o.analysis();
      const p = this.player(playerId);
      if (!a || !p) return false;
      const fromZone = o.zone;
      this._removeFromZone(o);
      o.zone = 'stack';
      o.controller = playerId;
      const item = {
        id: this._uid('st'), kind: 'spell', obj: o, objId: o.id, controller: playerId, name: o.name, cost: '',
        targets: [], x: 0, effects: a.isPermanent ? null : this._cardSpellEffects(a),
        auto: a.autoCoverage >= 0.999, fromZone, via: 'free',
      };
      this.stack.push(item);
      this.stormCount++;
      p.spellsCastThisTurn = (p.spellsCastThisTurn || 0) + 1;
      this.logEvent('cast', `${p.name} casts ${o.name} without paying its mana cost.`);
      this.emit('stack:add', item);
      const castData = { spell: item, object: o, stackId: item.id, playerId };
      this._fire('anyCastSpell', null, castData);
      this._fire('youCastSpell', playerId, castData);
      this._fire('opponentCastSpell', null, Object.assign({ except: playerId }, castData));
      return true;
    }

    /** Has this player protection from everything right now (The One Ring, Teferi's Protection)? */
    _protected(p) { return !!(p && p.protection && this._protectionLive(p.protection)); }
    _protectionLive(pr) { return !!pr; }

    /** Rebound: at your upkeep, each card you exiled with rebound may be cast for nothing. */
    _rebound(pid) {
      for (const o of ((this.zones[pid] || {}).exile || []).slice()) {
        if (o.reboundBy !== pid || o.reboundTurn >= this.turn) continue;
        o.reboundBy = null;
        this._castFree(pid, o);
        this.stack[this.stack.length - 1].reboundCast = true;
        this.logEvent('rules', `${o.name} is cast again from rebound.`);
      }
    }

    /**
     * How many more times a trigger goes off: Panharmonicon for things
     * entering, Teysa Karlov for things dying, Roaming Throne for creatures
     * of its type.
     */
    /* Torpor Orb and its kin: does something on the battlefield stop this
       arrival (or death) from setting off o's ability? */
    _triggerHushed(o, event, data) {
      const ENTER = ['etb', 'permEnters', 'yourCreatureEtb', 'anyCreatureEtb', 'otherCreatureEtb', 'yourPermanentEtb', 'landfall'];
      const DIE = ['dies', 'permDies', 'yourCreatureDies', 'anyCreatureDies', 'opponentCreatureDies'];
      const enter = ENTER.includes(event), die = DIE.includes(event);
      if ((!enter && !die) || !data.object) return false;
      for (const src of this.battlefield) {
        if (src.phasedOut) continue;
        const e = this._staticOp(src, 'noEnterTriggers');
        if (!e || (die && !e.dying)) continue;
        if (e.opponentsOnly && o.controller === src.controller) continue;
        if (!this._cardFitsWords(data.object, e.what || 'permanent')) continue;
        return true;
      }
      return false;
    }

    _extraTriggers(o, event, data) {
      let extra = 0;
      const ENTER = ['etb', 'permEnters', 'yourCreatureEtb', 'anyCreatureEtb', 'otherCreatureEtb', 'yourPermanentEtb', 'landfall'];
      const DIE = ['dies', 'permDies', 'yourCreatureDies', 'anyCreatureDies', 'opponentCreatureDies', 'equippedDies'];
      for (const src of this.battlefield) {
        if (src.controller !== o.controller || src.phasedOut) continue;
        const e = this._staticOp(src, 'triggerDouble');
        if (!e) continue;
        if (e.cause === 'enter' && ENTER.includes(event) && data.object && this._cardFitsWords(data.object, e.what || 'permanent')) extra++;
        else if (e.cause === 'die' && DIE.includes(event) && data.object && this._cardFitsWords(data.object, e.what || 'creature')) extra++;
        else if (e.cause === 'any' && e.sourceChosenType && o !== src && src.chosenType &&
          this.characteristics(o).isCreature && this._hasCreatureType(o, src.chosenType)) extra++;
        // Harmonic Prodigy: a trigger of the right kind of permanent
        else if (e.cause === 'source' && !(e.other && o === src) && this._cardFitsWords(o, e.what || 'permanent')) extra++;
        // Isshin: a creature attacking
        else if (e.cause === 'attack' && ['attacks', 'permAttacks', 'youAttack'].includes(event)) extra++;
      }
      return extra;
    }

    /** Creatures on one side of the table, for "creatures you control" effects. */
    creaturesOf(pid, scope) {
      const mine = scope !== 'opponentCreatures';
      return this.battlefield.filter(o => {
        const a = o.analysis();
        return a && a.isCreature && (mine ? o.controller === pid : o.controller !== pid);
      });
    }

    /**
     * How many permanents answer to a description: "creature", "Goblin",
     * "artifact", "permanent". Card and subtype names are matched against the
     * parsed type line rather than a regex over the raw one, so "Legendary
     * Creature - Goblin Warrior" counts as a Goblin and not as a Warrior card
     * that happens to contain the word.
     */
    countPermanents(pid, spec) {
      if (spec && spec.scope) return this._scopeList(spec.scope, pid, null).length;
      if (spec && spec.cardsInHand) return ((this.zones[pid] || {}).hand || []).length;
      // "artifacts and enchantments" counts anything that is either
      const wants = String(spec.per || '').toLowerCase()
        .split(/\s+and\s+|\s*,\s*/)
        .map(w => w.trim().replace(/s$/, ''))
        .filter(Boolean);
      if (!wants.length) return 0;
      let k = 0;
      for (const o of this.battlefield) {
        if (spec.who === 'opponents') { if (o.controller === pid) continue; }
        else if (spec.who !== 'any' && o.controller !== pid) continue;
        const a = o.analysis();
        if (!a) continue;
        const hit = wants.some(want => want === 'permanent' ||
          (a.types || []).some(x => x.toLowerCase() === want) ||
          (a.subtypes || []).some(x => x.toLowerCase() === want));
        if (hit) k++;
      }
      return k;
    }

    /** Regeneration (CR 701.15): a shield replaces the next destruction. */
    /**
     * Totem armor, printed as "umbra armor" on some Auras (CR 702.88): the
     * Aura takes the hit instead, and the creature under it walks away with
     * its damage wiped off.
     */
    _totemArmor(o) {
      if (!o || !(o.attachments || []).length) return false;
      for (const id of o.attachments.slice()) {
        const aura = this.obj(id);
        if (!aura || aura.zone !== 'battlefield') continue;
        if (!this.hasKw(aura, 'totem armor') && !this.hasKw(aura, 'umbra armor')) continue;
        o.damage = 0;
        o.dealtDeathtouch = false;
        this.moveObject(aura, 'graveyard');
        this.logEvent('rules', `${aura.name} is destroyed instead of ${o.name}.`);
        return true;
      }
      return false;
    }

    _regenerated(o) {
      if (!o || !o.shields) return false;
      if (o.noRegenThisTurn) { this.logEvent('rules', `${o.name} can't be regenerated this turn.`); return false; }
      o.shields--;
      o.tapped = true;
      o.damage = 0;
      o.dealtDeathtouch = false;
      o.removedFromCombat = true;
      o.attacking = null; o.blocking = []; o.blockedBy = []; o.blockOrder = [];
      this.logEvent('rules', `${o.name} regenerates.`);
      return true;
    }

    /** Is this the Ring-bearer of whoever controls it? */
    _isRingBearer(o) {
      if (!o) return false;
      const p = this.player(o.controller);
      return !!(p && p.ringBearer === o.id);
    }

    /** Is this permanent under a combat restriction right now? */
    /** The first static effect with this op on a permanent, if it has one. */
    _staticOp(o, op) {
      const a = o && o.analysis();
      if (!a) return null;
      for (const ab of (a.abilities || [])) {
        if (ab.kind && ab.kind !== 'static') continue;
        for (const e of (ab.effects || [])) {
          if (e.op === op) return e;
          // a line that says two standing things arrives as a sequence
          if (e.op === 'sequence') for (const x of (e.list || [])) if (x && x.op === op) return x;
        }
      }
      return null;
    }

    /** Does this player control a permanent with that standing rule? */
    _anyStaticOf(playerId, op) {
      for (const o of this.battlefield) {
        if (o.controller !== playerId) continue;
        if (this._staticOp(o, op)) return o;
      }
      return null;
    }

    _hasFlag(o, flag) {
      const c = this.characteristics(o);
      if (!c) return false;
      const both = flag === 'cantAttack' || flag === 'cantBlock' ? 'cantAttackOrBlock' : null;
      return c.flags.has(flag) || (both && c.flags.has(both));
    }

    /** Damage prevention from "prevent all damage this turn" effects. */
    _damagePrevented(target, isCombat) {
      // "prevent all combat damage that would be dealt to this creature"
      if (isCombat && target && target.zone === 'battlefield' && this._hasFlag(target, 'noDamageTaken')) return true;
      for (const pv of this.prevention) {
        if (pv.combatOnly && !isCombat) continue;
        if (pv.to === 'you' && !(target && target.id === pv.who)) continue;
        return true;
      }
      return false;
    }

    _preferredColor(p, except) {
      // pick the color the player's deck most wants
      const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const o of this.zones[p.id].hand) for (const s of MANA.parse((o.card.mana_cost) || ''))
        for (const c of MANA.COLORS) if (s.includes(c)) counts[c]++;
      let best = 'W', bv = -1;
      for (const c of MANA.COLORS) if (c !== except && counts[c] > bv) { bv = counts[c]; best = c; }
      return best;
    }

    _createToken(controller, e) {
      /* Adeline: one for each opponent, attacking that opponent */
      if (e.forEachOpponent) {
        for (const foe of this.opponentsOf(controller).filter(x => !x.hasLost)) {
          this._createToken(controller, Object.assign({}, e, { forEachOpponent: false, attackingId: foe.id }));
        }
        return;
      }
      let n = e.n === 'X' ? 1 : (e.n || 1);
      if (e.countBy) n = this.countMatching(controller, e.countBy);
      // "it creates twice that many of those tokens instead"
      const ev = e._noRep ? { n } : this._replace({ kind: 'createToken', n, controller,
        tokenTypes: ['Creature'].concat(e.addTypes || [], [String(e.subtypes || '')]).join(' ') });
      if (ev.cancelled) return;
      n = ev.n;
      this._tokenExtras(controller, ev, n);
      if (n <= 0) {
        this.logEvent('token', `${this.player(controller).name} creates no tokens.`);
        return;
      }
      (this.player(controller) || {}).tokensMadeTurn = this.turn;
      const [p, t] = String(e.pt || '1/1').split('/');
      const colorWords = (e.colorWords || []).map(w => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: '' }[w.toLowerCase()])).filter(Boolean);
      const subtypes = String(e.subtypes || 'Creature').replace(/\s+creature\s*$/i, '').trim();
      /* "a 1/1 colorless Thopter artifact creature token": the types in
         front of "creature" are part of what it is, not of its name. */
      const front = [e.legendary ? 'Legendary' : null, e.snow ? 'Snow' : null].filter(Boolean)
        .concat(['Token'], e.addTypes || [], ['Creature']).join(' ');
      const text = [(e.keywords || []).join(', '), e.grantedText || ''].filter(Boolean).join('\n');
      const card = {
        id: 'token:' + U.hash(JSON.stringify([e.pt, subtypes, colorWords, e.keywords, e.grantedText || '', front, e.name || ''])),
        name: e.name || subtypes, layout: 'token', mana_cost: '', cmc: 0,
        type_line: front + ' — ' + subtypes,
        oracle_text: text,
        colors: colorWords, color_identity: colorWords, keywords: e.keywords || [],
        power: p, toughness: t, rarity: 'common', set: 'tkn', set_name: 'Token',
        collector_number: '0', image_uris: null, _isToken: true,
      };
      for (let i = 0; i < n; i++) {
        const o = this._register(new GObj(card, controller, 'battlefield'));
        o.isToken = true; o.controller = controller;
        o.zone = 'battlefield'; o.entered = this.turn; o.summoningSick = true;
        if (e.tapped) o.tapped = true;
        if (e.temporary === 'combat') o.sacAtEndOfCombat = true;
        if (e.attacking && this.combat && this.combat.attackers) {
          const def = (e.attackingId && this.player(e.attackingId)) || this.opponentsOf(controller)[0];
          if (def) { o.attacking = def.id; this.combat.attackers.push(o.id); }
        }
        o.ts = this._stampNew();      // its timestamp (CR 613.7d)
        this.battlefield.push(o);
        /* "…create a token. It gains haste." — the token is what the next
           sentence is talking about. */
        this._noteLastAffected([{ kind: 'object', id: o.id }]);
        this.bumpBoard();
        this._onEnter(o);
        this._fireEnters(o);
        this._fire('youCreateToken', controller, { object: o });
      }
      this.logEvent('token', `${this.player(controller).name} creates ${n} ${e.pt} ${subtypes} token${n === 1 ? '' : 's'}.`);
      this.emit('sfx', 'play_card');
    }

    /* Peregrin Took, Chatterfang, Xorn: tokens that come along with the
       ones being made. They are part of the same event, so nothing doubles
       them twice. */
    _tokenExtras(controller, ev, n) {
      for (const x of (ev.extras || [])) {
        const k = x.thatMany ? n : (x.n || 1);
        if (k <= 0) continue;
        if (x.named) this._createNamedToken(controller, { token: x.named, n: k, _noRep: true });
        else if (x.spec) this._createToken(controller, Object.assign({}, x.spec, { n: k, _noRep: true }));
      }
    }

    _createNamedToken(controller, e) {
      const defs = {
        Treasure: { type: 'Token Artifact — Treasure', text: '{T}, Sacrifice this artifact: Add one mana of any color.' },
        Clue: { type: 'Token Artifact — Clue', text: '{2}, Sacrifice this artifact: Draw a card.' },
        Food: { type: 'Token Artifact — Food', text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' },
        Blood: { type: 'Token Artifact — Blood', text: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.' },
        Map: { type: 'Token Artifact — Map', text: '{1}, {T}, Sacrifice this artifact: Target creature you control explores.' },
        Powerstone: { type: 'Token Artifact — Powerstone', text: '{T}: Add {C}. This mana can’t be spent to cast a nonartifact spell.' },
        Gold: { type: 'Token Artifact — Gold', text: 'Sacrifice this artifact: Add one mana of any color.' },
        Junk: { type: 'Token Artifact — Junk', text: '{T}, Sacrifice this artifact: Exile the top card of your library. You may play it this turn.' },
        Incubator: { type: 'Token Artifact — Incubator', text: '{2}: Transform this artifact.' },
        Shard: { type: 'Token Enchantment — Shard', text: '{2}, Sacrifice this enchantment: Scry 1, then draw a card.' },
        Lander: { type: 'Token Artifact — Lander', text: '{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' },
      };
      /* Academy Manufactor: a Clue, Food or Treasure becomes one of each */
      if (['Clue', 'Food', 'Treasure'].includes(e.token) && !e._trio) {
        const trio = this.battlefield.filter(x => x.controller === controller && !x.phasedOut && this._staticOp(x, 'tokenTrio')).length;
        if (trio) {
          const each = (e.n === 'X' ? 1 : (e.n || 1)) * Math.pow(3, trio - 1);
          for (const t of ['Clue', 'Food', 'Treasure']) this._createNamedToken(controller, Object.assign({}, e, { token: t, n: each, _trio: true }));
          return;
        }
      }
      const d = defs[e.token] || { type: 'Token Artifact', text: '' };
      (this.player(controller) || {}).tokensMadeTurn = this.turn;
      const card = {
        id: 'token:' + e.token, name: e.token, layout: 'token', mana_cost: '', cmc: 0,
        type_line: d.type, oracle_text: d.text, colors: [], color_identity: [], keywords: [],
        rarity: 'common', set: 'tkn', set_name: 'Token', collector_number: '0', image_uris: null, _isToken: true,
      };
      let n = e.n === 'X' ? 1 : (e.n || 1);
      // Anointed Procession and its kin double Treasures as well
      const ev = e._noRep ? { n } : this._replace({ kind: 'createToken', n, controller, tokenTypes: d.type });
      if (ev.cancelled) return;
      n = ev.n;
      this._tokenExtras(controller, ev, n);
      for (let i = 0; i < n; i++) {
        const o = this._register(new GObj(card, controller, 'battlefield'));
        o.isToken = true; o.zone = 'battlefield'; o.entered = this.turn;
        if (e.tapped) o.tapped = true;
        if (e.withCounters) o.counters['+1/+1'] = e.withCounters;
        o.ts = this._stampNew();      // its timestamp (CR 613.7d)
        this.battlefield.push(o);
        this.bumpBoard();
        this._lastToken = o.id;
        this._fireEnters(o);
        this._fire('youCreateToken', controller, { object: o });
      }
      this.logEvent('token', `${this.player(controller).name} creates ${n} ${e.token} token${n === 1 ? '' : 's'}.`);
    }

    /* ---------- state-based actions (CR 704) ---------- */
    checkStateBasedActions() {
      let repeat = true, guard = 0;
      this._checkAscend();
      while (repeat && guard++ < 20) {
        repeat = false;
        /* Effects a resolution left behind take their place in time, and
           whoever controls what is settled (layer 2) before anything is
           checked: a Control Magic that went to the graveyard last pass
           has let go of its creature. */
        this._flushStamps();
        this._refreshControl();

        // players
        for (const p of this.players) {
          if (p.hasLost) continue;
          if (p.life <= 0) { this.playerLoses(p, 'life'); repeat = true; }
          else if (p.poison >= 10) { this.playerLoses(p, 'poison'); repeat = true; }
          else if (p.drewFromEmpty) { this.playerLoses(p, 'deck'); repeat = true; }
          else if (this.config.commanderDamage) {
            for (const [cid, dmg] of Object.entries(p.commanderDamage)) {
              if (dmg >= this.config.commanderDamage) { this.playerLoses(p, 'commander'); repeat = true; break; }
            }
          }
        }

        this._sagaCleanup();

        /* Everything state-based actions kill, they kill at once (CR 704.3):
           a creature dying alongside another still sees it go. */
        this._leavingTogether = this.battlefield.filter(o => {
          const a = o.analysis();
          if (!a || !a.isCreature) return false;
          const t = this.toughnessOf(o);
          return t <= 0 || ((o.damage >= t || (o.dealtDeathtouch && o.damage > 0)) && !this.hasKw(o, 'indestructible'));
        });
        if (!this._leavingTogether.length) this._leavingTogether = null;

        // permanents
        for (const o of this.battlefield.slice()) {
          const a = o.analysis();
          if (!a || o.phasedOut) continue;
          if (a.isCreature) {
            const t = this.toughnessOf(o);
            if (t <= 0) { this.logEvent('sba', `${o.name} is put into the graveyard (toughness ${t}).`); this.moveObject(o, 'graveyard'); repeat = true; continue; }
            const lethal = o.damage >= t;
            const dt = o.dealtDeathtouch && o.damage > 0;
            if ((lethal || dt) && !this.hasKw(o, 'indestructible')) {
              if (this._totemArmor(o)) { repeat = true; continue; }
              if (this._regenerated(o)) { repeat = true; continue; }
              const exiled = this._exileOnDeath && this._exileOnDeath.has(o.id);
              this.logEvent('sba', `${o.name} is ${exiled ? 'exiled' : 'destroyed'} (${o.damage} damage, ${t} toughness).`);
              this.moveObject(o, exiled ? 'exile' : 'graveyard'); repeat = true; continue;
            }
          }
          if (a.isPlaneswalker && (o.counters.loyalty || 0) <= 0) {
            this.logEvent('sba', `${o.name} is put into the graveyard (0 loyalty).`);
            this.moveObject(o, 'graveyard'); repeat = true; continue;
          }
          if (a.isBattle && (o.counters.defense || 0) <= 0) {
            this.moveObject(o, 'graveyard'); repeat = true; continue;
          }
          // +1/+1 and -1/-1 counters cancel
          const plus = o.counters['+1/+1'] || 0, minus = o.counters['-1/-1'] || 0;
          if (plus > 0 && minus > 0) {
            const k = Math.min(plus, minus);
            o.counters['+1/+1'] = plus - k; o.counters['-1/-1'] = minus - k;
            if (!o.counters['+1/+1']) delete o.counters['+1/+1'];
            if (!o.counters['-1/-1']) delete o.counters['-1/-1'];
            repeat = true;
          }
          /* "When you control no Islands, sacrifice this" — an old way of
             writing a permanent that depends on your having the land. */
          const needs = this._staticOp(o, 'sacUnlessControl');
          if (needs && o.zone === 'battlefield') {
            const want = String(needs.what || '').toLowerCase();
            const has = this.battlefield.some(x => {
              if (x.controller !== o.controller || x === o) return false;
              const xa = x.analysis();
              if (!xa) return false;
              return (xa.types || []).some(t => t.toLowerCase() === want) ||
                (xa.subtypes || []).some(t => t.toLowerCase() === want);
            });
            if (!has) {
              this.logEvent('sba', `${o.name} is sacrificed (no ${needs.what}).`);
              this.moveObject(o, 'graveyard');
              repeat = true;
              continue;
            }
          }
          /* A bestowed creature whose host has gone does not die with it:
             it stands up and is a creature again (CR 702.103c). */
          if (o.bestowed && !o.attachedTo && o.zone === 'battlefield') {
            o.bestowed = false;
            this.logEvent('rules', `${o.name} is no longer bestowed and becomes a creature.`);
            repeat = true;
            continue;
          }
          /* An Aura attached to nothing, to something that has left the
             battlefield, or to something it can no longer enchant goes to
             the graveyard (CR 704.5m). Equipment or a Fortification in the
             same state just comes off and stays (704.5n). */
          if (o.attachedTo) {
            const host = this.obj(o.attachedTo);
            const gone = !host || host.zone !== 'battlefield';
            const illegal = !gone && !host.phasedOut && !this._attachLegal(o, a, host);
            if (gone || illegal) {
              if (host) host.attachments = (host.attachments || []).filter(x => x !== o.id);
              o.lastAttachedTo = o.attachedTo;
              o.attachedTo = null;
              repeat = true;
              if (a.isAura && !o.bestowed) {
                this.logEvent('sba', `${o.name} is put into the graveyard (${gone ? 'what it enchanted is gone' : 'it can\'t enchant ' + host.name}).`);
                this.moveObject(o, 'graveyard');
                continue;
              }
              if (illegal) this.logEvent('sba', `${o.name} becomes unattached from ${host.name}.`);
            }
          }
          if (a.isAura && !o.bestowed && o.zone === 'battlefield' && !o.attachedTo) {
            this.logEvent('sba', `${o.name} is put into the graveyard (attached to nothing).`);
            this.moveObject(o, 'graveyard'); repeat = true; continue;
          }
        }

        this._leavingTogether = null;

        // legend rule (CR 704.5j)
        const byController = U.groupBy(this.battlefield.filter(o => { const a = o.analysis(); return a && a.isLegendary; }), o => o.controller);
        for (const [pid, list] of byController) {
          const byName = U.groupBy(list, o => U.frontName(o.name));
          for (const [name, dupes] of byName) {
            if (dupes.length > 1) {
              // keep the newest, bin the rest (a real game gives the choice; we take the simple route and log it)
              const keep = dupes[dupes.length - 1];
              for (const o of dupes) if (o !== keep) { this.logEvent('sba', `Legend rule: ${o.name} is put into the graveyard.`); this.moveObject(o, 'graveyard'); }
              repeat = true;
            }
          }
        }
      }

      // win condition
      const alive = this.players.filter(p => !p.hasLost);
      if (!this.over && alive.length <= 1 && this.players.length > 1) {
        this.over = true;
        this.winners = alive.map(p => p.id);
        for (const p of alive) p.hasWon = true;
        this.logEvent('game', alive.length ? `${alive[0].name} wins the game!` : 'The game is a draw.');
        this.emit('sfx', 'win');
        this.emit('game:over', this.winners);
      }
      this.touch();
    }

    /**
     * May this Aura, Equipment or Fortification stay on that permanent? An
     * Aura has to be able to enchant it ("Enchant creature" and a host that
     * is no longer a creature), Equipment has to be on a creature, and
     * nothing stays on a permanent with protection from it (CR 303.4d,
     * 301.5c, 702.16c). A restriction this cannot read is taken as met.
     */
    _attachLegal(o, a, host) {
      if (host === o) return false;
      const ha = host.analysis();
      if (!ha) return false;
      if (a.isAura) {
        const en = this._staticOp(o, 'enchant') || ((O.analyze(o.card, o.face) || {}).abilities || [])
          .map(ab => (ab.effects || []).find(e => e && e.op === 'enchant')).find(Boolean);
        const filter = String((en && en.filter) || '').toLowerCase().trim();
        const alts = filter.split(/\s*,\s*(?:or\s+)?|\s+or\s+/).map(x => x.trim()).filter(Boolean);
        const simple = /^(creature|land|artifact|enchantment|planeswalker|permanent|battle)$/;
        if (alts.length && alts.every(x => simple.test(x))) {
          const ok = alts.some(x => x === 'permanent' ? true : (ha.types || []).some(t => t.toLowerCase() === x));
          if (!ok) return false;
        }
      } else if (a.isEquipment && !o.bestowed) {
        if (!ha.isCreature) return false;
      } else if ((a.subtypes || []).includes('Fortification')) {
        if (!ha.isLand) return false;
      }
      return !this._protectedFrom(host, o);
    }

    playerLoses(p, reason) {
      if (p.hasLost) return;
      p.hasLost = true;
      p.lossReason = reason;
      const words = {
        life: 'has 0 or less life', poison: 'has ten or more poison counters',
        deck: 'tried to draw from an empty library', commander: 'took 21 commander damage',
        concede: 'concedes', timeout: 'left the game',
      };
      this.logEvent('game', `${p.name} loses the game (${words[reason] || reason}).`);
      /* Leaving the game (CR 800.4a): everything they own leaves with them,
         quietly, since leaving the game is no zone change anything can
         see; control effects that gave them anything end; and whatever
         they still control after that is exiled. What they owned is put
         with their own cards, out of play, so no list holds an object
         that thinks it is somewhere else, and nothing stays attached to
         something that is gone. */
      const leave = (o) => {
        this._removeFromZone(o);
        o.zone = 'exile';
        o.tapped = false; o.damage = 0; o.effects = []; o.attacking = null; o.blocking = []; o.blockedBy = [];
        o.faceDown = false; o.controller = o.owner; o.ctlBase = null; o.copyBefore = null; o.copyUntilTurn = null;
        if (o.printedCard) { o.card = o.printedCard; o.printedCard = null; o.copyOf = null; }
        this.zones[o.owner].exile.push(o);
      };
      for (const o of this.battlefield.slice()) if (o.owner === p.id) leave(o);
      for (const it of this.stack.slice()) {
        if (it.kind === 'spell' && it.obj && !it.isCopy && it.obj.owner === p.id) leave(it.obj);
      }
      for (const o of this.battlefield) {
        if ((o.effects || []).some(e => e && e.control === p.id)) o.effects = o.effects.filter(e => !e || e.control !== p.id);
      }
      this._refreshControl();
      for (const o of this.battlefield.slice()) if (o.controller === p.id) this.moveObject(o, 'exile');
      for (const it of this.stack.filter(s => s.controller === p.id)) {
        if (it.kind === 'spell' && it.obj && !it.isCopy && it.obj.zone === 'stack') this.moveObject(it.obj, 'exile');
      }
      this.stack = this.stack.filter(s => s.controller !== p.id);
      this.bumpBoard();
      /* A question put to somebody who has left the game will never be
         answered, and the table would sit there waiting for it forever.
         Their queued questions go with them, and one already on the table
         is dropped — a resolution that was waiting on it carries on with
         nothing chosen. */
      this.choiceQueue = (this.choiceQueue || []).filter(c => c.playerId !== p.id);
      if (this.pendingChoice && this.pendingChoice.playerId === p.id) {
        const ch = this.pendingChoice;
        this.pendingChoice = null;
        this.logEvent('game', `${p.name} is out of the game, so their choice is skipped.`);
        if (ch.resumeKey != null && this.resolving) {
          this.resolving.answers[ch.resumeKey] = null;
          this._nextChoice();
          this._pumpResolution();
        } else {
          this._nextChoice();
        }
      }
      this.emit('player:lost', p);
    }

    concede(playerId) {
      const p = this.player(playerId);
      if (!p) return;
      p.conceded = true;
      this.playerLoses(p, 'concede');
      if (this.priorityPlayer && this.priorityPlayer.id === playerId) this.passPriority(playerId, true);
      if (this.activePlayer.id === playerId && !this.over) this._nextTurn();
      this.checkStateBasedActions();
      this.touch();
    }

    /* ---------- choices ---------- */
    queueChoice(ch) {
      this.choiceQueue = this.choiceQueue || [];
      this.choiceQueue.push(ch);
      if (!this.pendingChoice) this._nextChoice();
    }
    _nextChoice() {
      this.choiceQueue = this.choiceQueue || [];
      this.pendingChoice = this.choiceQueue.shift() || null;
      if (this.pendingChoice) this.emit('choice', this.pendingChoice);
      /* The Leyline questions are asked before the game starts, so the
         first turn waits for the last answer. */
      if (!this.pendingChoice && this._awaitingLeylines) {
        this._awaitingLeylines = false;
        this._nextTurn();
        return;
      }
      this.touch();
    }
    resolveChoice(playerId, data) {
      const ch = this.pendingChoice;
      if (!ch || ch.playerId !== playerId) return this.fail('No choice pending for you.');
      /* The older shapes that are simple enough to be generic questions
         (MTG.choice.fromLegacy) take a generic answer too: the picks are
         turned back into what each has always been given. */
      if (data && Array.isArray(data.picks) && MTG.choice.LEGACY.has(ch.type)) data = MTG.choice.legacyData(ch, data) || data;
      switch (ch.type) {
        /* The generic question: the answer is checked against what was
           asked, and an illegal one is refused with the reason. */
        case 'choose': {
          const C = MTG.choice;
          const hooks = this._chooseHooks(playerId);
          let got = C.check(ch, data, hooks);
          if (!got.ok) {
            /* Neither a question that has nothing legal left to choose
               (what was offered has gone since it was asked) nor a bot that
               got it wrong may hold the table up. */
            const any = C.solve(ch, { hooks });
            const p = this.player(playerId);
            if (!any) got = { ok: true, picks: [], number: ch.kind === 'number' ? ch.number.min : null, order: null };
            else if (p && p.isBot) got = C.check(ch, any, hooks);
            if (!got.ok) return this.fail(got.reason);
          }
          data = { picks: got.picks, number: got.number, order: got.order };
          // asked while casting: the cast starts again with the answer
          if (ch.then && ch.then.kind === 'cast') {
            const again = Object.assign({}, ch.then.opts);
            again.choices = Object.assign({}, again.choices, { [ch.purpose]: data });
            this.pendingChoice = null;
            this.castSpell(playerId, ch.then.objId, again);
            if (!this.pendingChoice) this._nextChoice();
            if (!this.pendingChoice) { this.checkStateBasedActions(); this.touch(); }
            return true;
          }
          break;
        }
        case 'vote': return this.castVote(playerId, (data && data.choice) || ch.options[0]);
        case 'discard': case 'discardToHandSize': {
          const ids = (data && data.cardIds) || [];
          const z = this.zones[playerId];
          const tossed = [];
          /* A discard that is owed is made in full, from the cards the
             question allows. */
          const pool = ch.candidates ? z.hand.filter(x => ch.candidates.includes(x.id)) : z.hand.slice();
          const want = Math.min(ch.count || 0, pool.length);
          let pick = ids.map(id => pool.find(x => x.id === id)).filter(Boolean);
          pick = pick.filter((o, i) => pick.indexOf(o) === i).slice(0, want);
          if (!ch.optional && pick.length < want) {
            for (const o of this._cheapestFirst(pool)) { if (pick.length >= want) break; if (!pick.includes(o)) pick.push(o); }
          }
          for (const o of pick) { this.moveObject(o, 'graveyard'); tossed.push(o); }
          const item = ch.stackId ? this.stack.find(s => s.id === ch.stackId) : null;
          if (item) item.discarded = (item.discarded || []).concat(tossed.map(o => ({ id: o.id, name: o.name, mv: (o.card && o.card.cmc) || 0 })));
          this._lastDiscarded = tossed.map(o => o.id);
          this.logEvent('discard', `${this.player(playerId).name} discards ${tossed.length ? tossed.map(o => o.name).join(', ') : 'nothing'}.`);
          for (const o of tossed) this._afterDiscard(playerId, o);
          if (ch.type === 'discardToHandSize') { this.pendingChoice = null; this._finishCleanup(); return true; }
          break;
        }
        case 'scry': case 'surveil': {
          const z = this.zones[playerId];
          const bottom = (data && data.bottom) || [];
          const top = (data && data.top) || [];
          /* The cards the question showed, wherever they are in the library
             now; each is placed exactly once. */
          const shown = (ch.cards || []).map(c => z.library.find(o => o.id === c.id)).filter(Boolean);
          const looked = shown.length || !ch.cards ? shown : [];
          if (!ch.cards) looked.push(...z.library.slice(0, ch.count));
          for (const o of looked) { const i = z.library.indexOf(o); if (i >= 0) z.library.splice(i, 1); }
          const byId = new Map(looked.map(o => [o.id, o]));
          for (const id of bottom) { const o = byId.get(id); if (o) { byId.delete(id); if (ch.type === 'surveil') { z.library.unshift(o); this.moveObject(o, 'graveyard'); } else { o.zone = 'library'; z.library.push(o); } } }
          const kept = [];
          for (const id of top) { const o = byId.get(id); if (o) { byId.delete(id); kept.push(o); } }
          const rest = kept.concat(Array.from(byId.values()));
          for (let i = rest.length - 1; i >= 0; i--) { rest[i].zone = 'library'; z.library.unshift(rest[i]); }
          this.logEvent(ch.type, `${this.player(playerId).name} ${ch.type === 'scry' ? 'scries' : 'surveils'} ${ch.count}.`);
          this._fire(ch.type === 'scry' ? 'youScry' : 'youSurveil', playerId, { playerId });
          break;
        }
        case 'sacrifice': {
          /* Only what the question allows counts, however it was clicked;
             and a sacrifice that is owed is made in full — what was left
             out is made up from whatever matters least. */
          const pool = ch.candidates
            ? ch.candidates.map(id => this.obj(id)).filter(o => o && o.zone === 'battlefield' && o.controller === playerId)
            : this._sacrificePool(playerId, { filter: ch.filter || 'permanent' }, null);
          const want = Math.min(ch.count || 1, pool.length);
          const ids = (data && data.cardIds) || [];
          let pick = ids.map(id => pool.find(o => o.id === id)).filter(Boolean);
          pick = pick.filter((o, i) => pick.indexOf(o) === i).slice(0, want);
          if (!ch.optional && pick.length < want) {
            for (const o of this._cheapestFirst(pool)) { if (pick.length >= want) break; if (!pick.includes(o)) pick.push(o); }
          }
          const item = ch.stackId ? this.stack.find(s => s.id === ch.stackId) : null;
          this._sacrificeNow(playerId, pick, item);
          // "When this creature exploits a creature"
          if (ch.purpose === 'exploit' && pick.length) {
            const ex = this.obj(ch.sourceId);
            if (ex) this._fire('exploits', ex.controller, { source: ex, object: pick[0] });
          }
          break;
        }
        case 'riot': {
          const o = this.obj(ch.objId);
          if (o) {
            if (data && data.haste) { o.effects.push({ keywords: ['Haste'], until: null }); this.logEvent('keyword', `${o.name} gains haste from riot.`); }
            else this.addCounters(o, '+1/+1', 1);
          }
          break;
        }
        case 'pickCard': {
          let ids = (data && data.cardIds) || (data && data.cardId ? [data.cardId] : []);
          if (ch.purpose === 'moxDiamond') {
            const mox = this.obj(ch.objId);
            const ok = ids.some(id => (ch.candidates || []).includes(id) && (this.obj(id) || {}).zone === 'hand');
            if (!ok && mox && mox.zone === 'battlefield') { this.moveObject(mox, 'graveyard'); this.logEvent('rules', `${mox.name} goes to the graveyard.`); }
          }
          /* A card cost is paid in full, from the cards it allows. */
          /* A clone was waiting to hear what it copies: it resolves now. */
          if (ch.purpose === 'cloneChoice') {
            const item = this._cloneWait;
            this._cloneWait = null;
            const o = this.obj(ch.objId);
            const pick = ids.find(id => (ch.candidates || []).includes(id));
            if (o) o._cloneChoice = pick || 'none';
            this.pendingChoice = null;
            if (item && o && o.zone === 'stack') this._resolveSpell(item);
            if (!this.pendingChoice) this._nextChoice();
            if (!this.pendingChoice) { this.checkStateBasedActions(); this.touch(); }
            return true;
          }
          if (ch.purpose === 'ninjutsu') {
            const pick = this.obj(ids.find(id => (ch.candidates || []).includes(id)) || (ch.candidates || [])[0]);
            ids = [];
            if (pick) this._ninjutsuSwap(playerId, ch.objId, pick);
          }
          if (ch.purpose === 'tapCost') {
            const pool = (ch.candidates || []).map(id => this.obj(id)).filter(x => x && x.zone === 'battlefield' && !x.tapped);
            ids = ids.filter(id => pool.some(x => x.id === id)).slice(0, ch.count || 1);
            if (ch.totalPower != null) {
              // crew: whatever was chosen, topped up until the power is there
              let sum = ids.reduce((k, id) => k + Math.max(0, this.powerOf(this.obj(id))), 0);
              for (const x of this._tapCostOrder(pool)) { if (sum >= ch.totalPower) break; if (!ids.includes(x.id)) { ids.push(x.id); sum += Math.max(0, this.powerOf(x)); } }
            } else
            for (const x of this._tapCostOrder(pool)) { if (ids.length >= (ch.count || 1)) break; if (!ids.includes(x.id)) ids.push(x.id); }
            this._tapForCost(playerId, ids.map(id => this.obj(id)), ch.stackId ? this.stack.find(s => s.id === ch.stackId) : null);
            ids = [];
          }
          if (ch.purpose === 'exileCost' || ch.purpose === 'returnCost') {
            const pool = (ch.candidates || []).map(id => this.obj(id)).filter(Boolean);
            ids = ids.filter(id => (ch.candidates || []).includes(id)).slice(0, ch.count || 1);
            for (const o of this._cheapestFirst(pool)) { if (ids.length >= (ch.count || 1)) break; if (!ids.includes(o.id)) ids.push(o.id); }
          }
          for (const id of ids.slice(0, ch.count || 1)) {
            const o = this.obj(id);
            if (!o) continue;
            if (ch.purpose === 'exileCost') { this.moveObject(o, 'exile'); continue; }
            if (ch.purpose === 'moxDiamond') {
              if (o.zone === 'hand' && (ch.candidates || []).includes(o.id)) {
                this.moveObject(o, 'graveyard'); this._afterDiscard(playerId, o);
                ch._kept = true;
              }
              continue;
            }
            if (ch.purpose === 'returnCost') { if (o.zone === 'battlefield') this.moveObject(o, 'hand'); continue; }
            if (ch.purpose === 'landFromHand') { this.moveObject(o, 'battlefield', { controller: playerId }); this.logEvent('land', `${this.player(playerId).name} puts ${o.name} onto the battlefield.`); }
            else if (ch.purpose === 'exileFromHand') { this.moveObject(o, 'exile'); this.logEvent('exile', `${o.name} is exiled from ${this.player(o.owner).name}'s hand.`); }
            else if (ch.purpose === 'discardFromHand') { this.moveObject(o, 'graveyard'); this.logEvent('discard', `${this.player(o.owner).name} discards ${o.name}.`); this._afterDiscard(o.owner, o); }
          }
          break;
        }
        /* "…you may pay 2 life. If you don't, it enters tapped." The land is
           already on the table, tapped; paying stands it up. */
        case 'confirm': {
          if (ch.purpose === 'leyline') {
            const o = this.obj(ch.objId);
            if (!o || o.zone !== 'hand' || !(data && data.yes)) break;
            this.moveObject(o, 'battlefield', { controller: playerId });
            this.logEvent('rules', `${this.player(playerId).name} begins the game with ${o.name} on the battlefield.`);
            /* Gemstone Caverns: with a luck counter, and a card from the
               hand exiled to pay for it */
            const ley = this._leylineOf(o.analysis()) || {};
            if (ley.counter) this.addCounters(o, ley.counter, 1);
            if (ley.exileFromHand) {
              const hand = this.zones[playerId].hand.slice();
              const pl = this.player(playerId);
              if (hand.length && (pl.isBot || hand.length === 1)) {
                const c = this._cheapestFirst(hand)[0];
                this.moveObject(c, 'exile');
                this.logEvent('exile', `${pl.name} exiles ${c.name} from their hand.`);
              } else if (hand.length) {
                this.queueChoice({ type: 'pickCard', playerId, count: 1, purpose: 'exileFromHand', worst: true,
                  candidates: hand.map(c => c.id), cards: hand.map(c => ({ id: c.id, name: c.name, card: c.card })),
                  prompt: `Exile a card from your hand for ${o.name}.` });
              }
            }
            break;
          }
          if (ch.purpose === 'unleash') {
            const o = this.obj(ch.objId);
            if (o && o.zone === 'battlefield' && data && data.yes) this.addCounters(o, '+1/+1', 1, { noReplace: true });
            break;
          }
          if (ch.purpose === 'madness') {
            const o = this.obj(ch.objId);
            if (!o || !(data && data.yes)) break;
            this.castSpell(playerId, o.id, { via: 'madness', auto: true, targets: [] });
            break;
          }
          if (ch.purpose !== 'payToUntap') break;
          const o = this.obj(ch.objId);
          if (!o || !(data && data.yes)) break;
          const life = ch.life || 2;
          const p = this.player(playerId);
          if (!p || p.life <= life) break;
          this.changeLife(p, -life, 'cost');
          o.tapped = false;
          this.logEvent('rules', `${p.name} pays ${life} life; ${o.name} enters untapped.`);
          break;
        }
        case 'payOrDont': {
          if (ch.purpose !== 'cumulativeUpkeep') break;
          const o = this.obj(ch.objId);
          if (!o || o.zone !== 'battlefield') break;
          const p = this.player(playerId);
          const canPayLife = ch.life ? (p && p.life > ch.life) : false;
          if (ch.energy) {
            if (data && data.pay && (p.energy || 0) >= ch.energy) {
              p.energy -= ch.energy;
              this.logEvent('upkeep', `${p.name} pays ${ch.energy} energy for ${o.name}.`);
            } else {
              this.logEvent('sacrifice', `${p.name} does not pay; ${o.name} is sacrificed.`);
              this.moveObject(o, 'graveyard');
            }
            break;
          }
          if (ch.life && data && data.pay && canPayLife) {
            this.changeLife(p, -ch.life, 'cost');
            this.logEvent('upkeep', `${p.name} pays ${ch.life} life for ${o.name}.`);
          } else if (!ch.life && data && data.pay && this.payMana(playerId, ch.cost, { auto: true })) {
            this.logEvent('upkeep', `${p.name} pays ${ch.cost} for ${o.name}.`);
          } else {
            this.logEvent('sacrifice', `${p.name} does not pay; ${o.name} is sacrificed.`);
            this.moveObject(o, 'graveyard');
            this._fire('youSacrifice', playerId, { count: 1 });
          }
          break;
        }
        /* a type or colour chosen as a permanent entered */
        case 'mode': {
          if (ch.purpose === 'dredge') {
            const idx = ((data && data.modes) || [])[0];
            const at = (ch.options || []).findIndex(op => op.i === idx);
            const pick = this.obj((ch.values || [])[at >= 0 ? at : 0]);
            const p = this.player(playerId);
            if (pick && pick.zone === 'graveyard') this._dredge(p, pick); else this._drawCards(p, 1);
            break;
          }
          /* A choice made while casting: the cast starts again, answered. */
          if (ch.purpose === 'castChoice') {
            const idx = ((data && data.modes) || [])[0];
            const at = (ch.options || []).findIndex(op => op.i === idx);
            const value = (ch.values || [])[at >= 0 ? at : 0];
            const again = Object.assign({}, ch.castOpts, { [ch.field]: value === undefined ? null : value });
            this.pendingChoice = null;
            this.castSpell(playerId, ch.objId, again);
            if (!this.pendingChoice) this._nextChoice();
            if (!this.pendingChoice) { this.checkStateBasedActions(); this.touch(); }
            return true;
          }
          if (ch.purpose !== 'chooseType' && ch.purpose !== 'chooseColor') break;
          const o = this.obj(ch.objId);
          const idx = ((data && data.modes) || [])[0];
          if (!o || idx == null) break;
          if (ch.purpose === 'chooseType' && ch.types[idx]) o.chosenType = ch.types[idx];
          if (ch.purpose === 'chooseColor' && ch.colors[idx]) o.chosenColor = ch.colors[idx];
          o._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${this.player(playerId).name} chooses ${ch.purpose === 'chooseType' ? o.chosenType : o.chosenColor} for ${o.name}.`);
          break;
        }
        case 'orderTriggers': {
          const want = (data && (data.top || data.cardIds)) || [];
          if (!want.length) break;
          const ids = new Set((ch.cards || []).map(c => c.id));
          const picked = want.filter(id => ids.has(id));
          const rest = (ch.cards || []).map(c => c.id).filter(id => !picked.includes(id));
          const wanted = picked.concat(rest);
          /* The stack keeps its shape: only the slots those triggers are
             sitting in are rearranged, so anything else on the stack stays
             exactly where it was. */
          const slots = [];
          for (let i = 0; i < this.stack.length; i++) if (ids.has(this.stack[i].id)) slots.push(i);
          const byId = new Map(this.stack.filter(x => ids.has(x.id)).map(x => [x.id, x]));
          // the first one picked resolves last, so it goes in at the bottom
          wanted.forEach((id, k) => { const item = byId.get(id); if (item) this.stack[slots[k]] = item; });
          this.logEvent('rules', `${this.player(playerId).name} orders their triggers.`);
          break;
        }
        case 'payOrCounter': {
          const item = this.stack.find(st => st.id === ch.stackId);
          if (!item) break;
          if (data && data.pay && this.payMana(playerId, ch.cost, { auto: true })) {
            this.logEvent('counter', `${this.player(playerId).name} pays ${ch.cost}.`);
          } else {
            item.countered = true;
            this.logEvent('counter', `${item.name} is countered.`);
            this.emit('sfx', 'counter');
          }
          break;
        }
        default: break;
      }
      const resumeKey = ch.resumeKey;
      this.pendingChoice = null;
      // if an effect was waiting on this, give it the answer and start it again
      if (resumeKey != null && this.resolving) {
        this.resolving.answers[resumeKey] = this._answerFor(ch, data);
        this._pumpResolution();
        if (!this.pendingChoice) this._nextChoice();
        if (!this.pendingChoice) { this.checkStateBasedActions(); this.touch(); }
        return true;
      }
      this._nextChoice();
      if (!this.pendingChoice) { this.checkStateBasedActions(); this.touch(); }
      return true;
    }

    /**
     * Put more effects next in line. Used by everything that decides at
     * resolution what else should happen: a "may" that was accepted, a mode
     * that was chosen, a cost that was paid.
     */
    _spliceNext(list) {
      if (!list || !list.length || !this.resolving) return;
      const r = this.resolving;
      r.effects.splice(r.index + 1, 0, ...list);
    }

    /**
     * Remember what an effect just removed. "Its controller gains life equal
     * to its power" is about a creature that has already left the battlefield
     * by the time that sentence runs, so the numbers have to be taken first.
     */
    _noteLastAffected(targets) {
      const t = (targets || []).find(x => x.kind === 'object');
      const o = t && this.obj(t.id);
      if (!o) return;
      this._lastAffected = {
        id: o.id, controller: o.controller, owner: o.owner, name: o.name,
        power: this.powerOf(o), toughness: this.toughnessOf(o),
        mv: (o.card && o.card.cmc) || 0,
      };
    }
    _lastAffectedController() {
      const s = this._lastAffected;
      return s ? this.player(s.controller) || this.player(s.owner) : null;
    }

    /** Devotion to a colour: coloured pips on your permanents (CR 700.5). */
    devotionOf(pid, color) {
      let k = 0;
      for (const o of this.battlefield) {
        if (o.controller !== pid) continue;
        const a = o.analysis();
        if (!a) continue;
        for (const sym of MANA.parse(a.manaCost || '')) if (sym.includes(color)) k++;
      }
      return k;
    }

    /** Is any permanent declaring this standing rule right now? */
    _anyStatic(op) {
      for (const o of this.battlefield) {
        const a = o.analysis();
        if (!a) continue;
        for (const ab of a.abilities) {
          for (const ef of (ab.effects || [])) if (ef.op === op) return o;
        }
      }
      return null;
    }

    /** Let go of everything this permanent was keeping in exile. */
    _releaseExiled(jailer) {
      if (!jailer) return;
      for (const o of Array.from(this.objects.values())) {
        if (o.exiledBy !== jailer.id || o.zone !== 'exile') continue;
        o.exiledBy = null;
        this.moveObject(o, 'battlefield', { controller: o.owner });
        this.logEvent('zone', `${o.name} returns from exile.`);
      }
    }

    /** "artifact creature", "Goblin", "nonland permanent" — every word must fit. */
    _matchesCategory(o, filter) {
      const a = o.analysis();
      if (!a) return false;
      const words = String(filter || '').toLowerCase().split(/\s+/).filter(Boolean);
      for (const w of words) {
        const want = w.replace(/s$/, '');
        if (want === 'permanent' || want === 'you' || want === 'control') continue;
        if (want.startsWith('non')) {
          const bare = want.replace(/^non-?/, '');
          if ((a.types || []).some(t => t.toLowerCase() === bare)) return false;
          continue;
        }
        const hit = (a.types || []).some(t => t.toLowerCase() === want) ||
          (a.subtypes || []).some(t => t.toLowerCase() === want);
        if (!hit) return false;
      }
      return true;
    }

    /**
     * Does this card answer to a searcher's description? "an Island or Swamp
     * card" is either one; "a basic Forest card" and "a green creature card"
     * are every word at once; "noncreature" rules a type out.
     */
    _cardFitsWords(o, phrase) {
      const a = o.analysis();
      if (!a) return false;
      const COL = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const types = (a.types || []).concat(a.subtypes || [], a.supertypes || []).map(x => x.toLowerCase());
      const line = String((o.card && o.card.type_line) || '').toLowerCase();
      const colors = a.colors || [];
      const fits = (w) => {
        if (!w || w === 'card' || w === 'cards' || w === 'a' || w === 'an' || w === 'any') return true;
        if (/^non-?/.test(w)) return !fits(w.replace(/^non-?/, ''));
        if (COL[w]) return colors.includes(COL[w]);
        if (w === 'colorless') return colors.length === 0;
        if (w === 'multicolored') return colors.length > 1;
        if (w === 'monocolored') return colors.length === 1;
        if (w === 'permanent') return !!a.isPermanent;
        if (w === 'token' || w === 'tokens') return !!o.isToken;
        if (w === 'spell' || w === 'spells') return true;
        const bare = w.replace(/s$/, '');
        return types.includes(w) || types.includes(bare) || new RegExp('\\b' + bare + 's?\\b').test(line);
      };
      const alts = String(phrase || '').toLowerCase().replace(/\bcards?\b/g, ' ')
        .split(/\s+and\/or\s+|\s+or\s+|\s*,\s*(?:or\s+)?/).map(s => s.trim()).filter(Boolean);
      if (!alts.length) return true;
      return alts.some(alt => alt.split(/\s+/).filter(Boolean).every(fits));
    }

    /**
     * Does a permanent (or spell) fit what a trigger is watching for:
     * "another nontoken creature", "a creature with power 4 or greater"?
     */
    _objFits(x, f, src, ctrl) {
      if (!x || !f) return true;
      // "this creature or another Elemental": itself always counts
      if (f.selfOk && src && x.id === src.id) return true;
      if (f.other && src && x.id === src.id) return false;
      if (f.name && x.name !== f.name) return false;
      // "whenever equipped creature attacks": the creature this is attached to
      if (f.equipped && !(src && src.attachedTo === x.id)) return false;
      /* "you control" is decided by who controlled it at the time, which
         for something that has just died is who controlled it as it went. */
      const owner = ctrl || x.controller;
      if (f.who === 'you' && src && owner !== src.controller) return false;
      if (f.who === 'opponent' && src && owner === src.controller) return false;
      if (f.nontoken && x.isToken) return false;
      if (f.token && !x.isToken) return false;
      if (f.words && !this._cardFitsWords(x, f.words)) return false;
      if (f.chosenType && !(src && this._hasCreatureType(x, src.chosenType))) return false;
      if (f.minPower != null && this.powerOf(x) < f.minPower) return false;
      if (f.maxPower != null && this.powerOf(x) > f.maxPower) return false;
      if (f.minMv != null && ((x.card && x.card.cmc) || 0) < f.minMv) return false;
      if (f.maxMv != null && ((x.card && x.card.cmc) || 0) > f.maxMv) return false;
      if (f.keyword && !this.hasKw(x, f.keyword)) return false;
      if (f.withCounter && !(Number(x.counters[f.withCounter]) > 0)) return false;
      if (f.attacking && !x.attacking) return false;
      if (f.pumped && !(this.powerOf(x) > (parseInt((x.analysis() || {}).power, 10) || 0))) return false;
      return true;
    }

    /** Does this object answer to a filter word like "creature" or "Goblin"? */
    _matchesFilter(o, filter) {
      if (!filter || filter === 'card' || filter === 'any') return true;
      const a = o.analysis();
      if (!a) return false;
      const want = String(filter).toLowerCase().trim().replace(/^an? /, '').replace(/s$/, '');
      if (want === 'permanent' || want === 'card') return true;
      return (a.types || []).some(x => x.toLowerCase() === want) ||
        (a.subtypes || []).some(x => x.toLowerCase() === want);
    }

    /**
     * Everything one target spec could legally point at right now. Used when
     * a target has to be chosen as an effect resolves rather than when the
     * spell was cast.
     */
    _legalTargetsFor(spec, controllerId, sourceId) {
      spec = spec || {};
      // "another target creature" is never the creature asking (CR 115.5)
      if (spec.another && sourceId) {
        return this._legalTargetsFor(Object.assign({}, spec, { another: false }), controllerId).filter(t => t.id !== sourceId);
      }
      const out = [];
      /* "You have hexproof" keeps a player off the list of things an
         opponent's spell may point at (CR 702.11e). */
      const players = () => this.players.filter(p => !p.hasLost && !this._protected(p))
        .filter(p => p.id === controllerId || (!this._anyStaticOf(p.id, 'playerHexproof') && p.hexproofTurn !== this.turn))
        .map(p => ({ kind: 'player', id: p.id, name: p.name }));
      if (spec.type === 'player' || spec.type === 'opponent') {
        return players().filter(t => !(spec.type === 'opponent' || spec.opponent) || t.id !== controllerId);
      }
      if (spec.type === 'spell' || spec.zone === 'stack') {
        return this.stack
          .filter(st => (st.kind === 'spell' ? !spec.noSpells && this._spellMatches(st, spec, controllerId)
            : !!spec.abilities && (!spec.abilityKind || (spec.abilityKind === 'triggered') === !!st.triggered) &&
              !(spec.controller === 'you' && st.controller !== controllerId) &&
              !(spec.controller === 'opponent' && st.controller === controllerId)))
          .map(st => ({ kind: 'stack', id: st.id, name: st.name }));
      }
      if (spec.type === 'spellOrPermanent') {
        const out2 = this.stack.filter(st => st.kind === 'spell' && this._spellMatches(st, Object.assign({}, spec, { filter: 'spell' }), controllerId))
          .map(st => ({ kind: 'stack', id: st.id, name: st.name }));
        for (const o of this.battlefield) {
          const a = o.analysis();
          if (!a || o.phasedOut) continue;
          if (!MTG.oracle.matchesSpec(Object.assign({}, spec, { type: 'permanent' }), o, a, controllerId, this._specCtx())) continue;
          if (o.controller !== controllerId && (this.hasKw(o, 'hexproof') || this.hasKw(o, 'shroud'))) continue;
          out2.push({ kind: 'object', id: o.id, name: o.name });
        }
        return out2;
      }
      const zone = spec.zone || 'battlefield';
      const pool = [];
      if (zone === 'battlefield') pool.push(...this.battlefield);
      else {
        for (const p of this.players) {
          if (spec.controller === 'you' && p.id !== controllerId) continue;
          if (spec.controller === 'opponent' && p.id === controllerId) continue;
          if (spec.controllerId && p.id !== spec.controllerId) continue;
          pool.push(...((this.zones[p.id] || {})[zone] || []));
        }
      }
      for (const o of pool) {
        const a = o.analysis();
        if (!a || o.phasedOut) continue;
        if (!MTG.oracle.matchesSpec(spec, o, a, controllerId, this._specCtx())) continue;
        if (zone === 'battlefield' && o.controller !== controllerId &&
            (this.hasKw(o, 'hexproof') || this.hasKw(o, 'shroud'))) continue;
        out.push({ kind: 'object', id: o.id, name: o.name });
      }
      if (spec.type === 'any') out.push(...players());
      return out;
    }

    /* Power, toughness and keywords a target spec asks about are the ones
       the permanent has right now, so the matcher borrows the game's. */
    _specCtx() {
      if (!this.__specCtx) this.__specCtx = {
        powerOf: (o) => this.powerOf(o),
        toughnessOf: (o) => this.toughnessOf(o),
        hasKw: (o, k) => this.hasKw(o, k),
      };
      return this.__specCtx;
    }

    /** Does a spell on the stack answer to "noncreature", "instant or sorcery"…? */
    _spellMatches(item, spec, controllerId) {
      const o = item.obj;
      const a = o && o.analysis();
      if (!a || !spec) return true;                       // unknown: do not rule it out
      const mv = (o.card && o.card.cmc) || 0;
      if (spec.maxMv != null && mv > spec.maxMv) return false;
      if (spec.minMv != null && mv < spec.minMv) return false;
      if (spec.mv != null && mv !== spec.mv) return false;
      if (controllerId && spec.controller === 'you' && item.controller !== controllerId) return false;
      if (controllerId && spec.controller === 'opponent' && item.controller === controllerId) return false;
      /* "target noncreature spell", "an instant or sorcery spell", "a blue
         spell": the same reading a search uses, alternatives and all. */
      const want = String(spec.filter || '').toLowerCase()
        .replace(/\s+(?:with|without)\s+.*$/, '')
        .replace(/\s+(?:you control|an opponent controls|your opponents control|you don'?t control)$/, '')
        .replace(/^target\s+/, '').trim();
      if (!want || want === 'spell' || want === 'any') return true;
      return this._cardFitsWords(o, want);
    }

    /**
     * Could this spell or ability find everything it has to point at?
     *
     * A card you cannot legally cast is not something to stop you for:
     * Fierce Guardianship with no noncreature spell on the stack is a card
     * in your hand, not a decision. Modes are alternatives, so one mode
     * being castable is enough; anything this cannot read is left alone,
     * because guessing "no targets" would hide a card you can in fact play.
     */
    _targetsAvailable(effects, controllerId) {
      for (const e of (effects || [])) {
        if (!e) continue;
        if (e.op === 'modal') {
          const modes = e.modes || [];
          if (modes.length && !modes.some(m => this._targetsAvailable(m.effects, controllerId))) return false;
          continue;
        }
        for (const spec of (e.targets || [])) {
          if (!spec || !spec.type) continue;
          // "up to two target creatures" is castable with none in sight
          if (spec.upTo) continue;
          if (!this._legalTargetsFor(spec, controllerId).length) return false;
        }
        if (e.op === 'sequence' && !this._targetsAvailable(e.list, controllerId)) return false;
      }
      return true;
    }

    /** Every effect a spell would put on the stack, for the check above. */
    _spellEffects(a) {
      const out = [];
      for (const ab of ((a && a.abilities) || [])) {
        if (ab.kind !== 'spell') continue;
        out.push(...(ab.effects || []));
        for (const spec of (ab.targets || [])) out.push({ targets: [spec] });
      }
      // an Aura targets what it will be attached to, as it is cast
      if (a && a.isAura && a.auraSpec) out.push({ targets: [a.auraSpec] });
      return out;
    }

    /** The top N cards of a library, as a choice can carry them. */
    _topOfLibrary(playerId, n) {
      const z = this.zones[playerId];
      if (!z) return [];
      return z.library.slice(0, Math.max(0, n)).map(o => ({ id: o.id, name: o.name, card: o.card }));
    }

    /** Reduce a raw choice reply to the one value the waiting effect wants. */
    _answerFor(ch, data) {
      data = data || {};
      switch (ch.type) {
        case 'confirm': return !!data.yes;
        case 'mode': return (data.modes || []).slice();
        case 'payOrDont': return !!data.pay;
        case 'pickCard': return (data.cardIds || (data.cardId ? [data.cardId] : []));
        case 'pickTarget': return (data.targets || []);
        case 'arrange': return { top: (data.top || []) };
        case 'choose': return { picks: (data.picks || []).slice(), number: data.number != null ? data.number : null, order: data.order || null };
        default: return data;
      }
    }

    /* ---------- assisted manual tools ---------- */
    manual(playerId, action, data) {
      data = data || {};
      const p = this.player(playerId);
      const o = data.objId ? this.obj(data.objId) : null;
      switch (action) {
        case 'tap': if (o) { o.tapped = !o.tapped; this.emit('sfx', o.tapped ? 'tap' : 'untap'); this.logEvent('manual', `${p.name} ${o.tapped ? 'taps' : 'untaps'} ${o.name}.`); } break;
        case 'untapAll': {
          let n = 0;
          for (const x of this.battlefield) if (x.controller === playerId && x.tapped) { x.tapped = false; n++; }
          this.emit('sfx', 'untap_all'); this.logEvent('manual', `${p.name} untaps ${n} permanents.`); break;
        }
        case 'move': if (o) { this.moveObject(o, data.zone, { toBottom: data.toBottom }); this.logEvent('manual', `${p.name} moves ${o.name} to ${data.zone}.`); } break;
        case 'counter': if (o) { this.addCounters(o, data.kind || '+1/+1', data.n == null ? 1 : data.n); this.logEvent('manual', `${p.name} puts ${data.n} ${data.kind} counter(s) on ${o.name}.`); } break;
        case 'life': this.changeLife(p, data.n || 0, 'manual'); break;
        case 'poison': this.addPoison(p, data.n || 0); break;
        case 'energy': p.energy += (data.n || 0); break;
        case 'draw': this._drawCards(p, data.n || 1); break;
        case 'mill': for (let i = 0; i < (data.n || 1); i++) { const c = this.zones[playerId].library.shift(); if (c) this.moveObject(c, 'graveyard'); } break;
        case 'shuffle': this.rng.shuffle(this.zones[playerId].library); this.emit('sfx', 'shuffle'); this.logEvent('manual', `${p.name} shuffles.`); break;
        case 'attach': {
          const host = this.obj(data.hostId);
          if (o && host) {
            if (o.attachedTo) { const old = this.obj(o.attachedTo); if (old) old.attachments = old.attachments.filter(x => x !== o.id); }
            o.attachedTo = host.id;
            if (!host.attachments.includes(o.id)) host.attachments.push(o.id);
            this.logEvent('manual', `${p.name} attaches ${o.name} to ${host.name}.`);
          }
          break;
        }
        case 'unattach': if (o && o.attachedTo) { const host = this.obj(o.attachedTo); if (host) host.attachments = host.attachments.filter(x => x !== o.id); o.attachedTo = null; } break;
        case 'token': this._createToken(playerId, data.token || { n: 1, pt: '1/1', subtypes: 'Creature' }); break;
        case 'note': if (o) o.note = String(data.text || '').slice(0, 200); break;
        case 'monarch': this.setMonarch(data.playerId || playerId, 'a card said so'); break;
        case 'initiative': this.takeInitiative(data.playerId || playerId, 'a card said so'); break;
        case 'day': this.setDayNight(true, 'a card said so'); break;
        case 'night': this.setDayNight(false, 'a card said so'); break;
        case 'daynight': this.setDayNight(!this.isDay, 'a card said so'); break;
        case 'vote': this.startVote(playerId, data.text || 'Choose one', data.options || ['Yes', 'No']); break;
        case 'flip': if (o) { o.faceDown = !o.faceDown; } break;
        case 'transform': if (o && o.card.card_faces) o.face = (o.face + 1) % o.card.card_faces.length; break;
        case 'reveal': this.logEvent('manual', `${p.name} reveals ${o ? o.name : 'a card'}.`); break;
        case 'roll': {
          const sides = data.sides || 6;
          const r = this.rng.range(1, sides);
          this.logEvent('manual', `${p.name} rolls a d${sides}: ${r}.`);
          this.emit('roll', { playerId, sides, result: r });
          break;
        }
        case 'coin': {
          const r = this.rng.chance(0.5) ? 'heads' : 'tails';
          this.logEvent('manual', `${p.name} flips a coin: ${r}.`);
          this.emit('coin', { playerId, result: r });
          break;
        }
        case 'setLife': p.life = data.n; this.logEvent('manual', `${p.name} sets life to ${data.n}.`); break;
        case 'resolveManual':
          this.logEvent('manual', `${p.name} resolved: ${data.text || 'effect'}`);
          break;
        default: return this.fail('Unknown manual action.');
      }
      this.checkStateBasedActions();
      this.touch();
      return true;
    }

    /** A seat's connection coming and going is part of the game's record. */
    setConnected(playerId, on) {
      const p = this.player(playerId);
      if (!p || p.connected === !!on) return false;
      p.connected = !!on;
      this.logEvent('game', `${p.name} ${on ? 'reconnected' : 'disconnected'}.`);
      this.touch();
      return true;
    }

    /* ---------- misc ---------- */
    opponentsOf(pid) { return this.players.filter(p => p.id !== pid && !p.hasLost); }
    describeTarget(t) {
      if (t.kind === 'player') { const p = this.player(t.id); return p ? p.name : 'a player'; }
      const o = this.obj(t.id); return o ? o.name : 'something';
    }
    _cardValue(o) {
      const a = o.analysis();
      if (!a) return 0;
      return (a.isLand ? 1 : 0) + (a.mv || 0) * 0.3 + (a.isCreature ? 1 : 0);
    }
    logEvent(type, text) {
      const entry = { t: Date.now(), turn: this.turn, type, text };
      this.log.push(entry);
      if (this.log.length > 4000) this.log.splice(0, 1000);
      this.emit('log', entry);
    }
    fail(msg) { this.emit('error', msg); this.lastError = msg; return false; }
    touch() { this.bumpBoard(); this.stateVersion++; this.emit('state', this.stateVersion); }

    /* ---------- the whole game, as plain data ----------
       One implementation serves both undo and save-and-resume. Object
       references become ids and come back as references, so the graph
       survives a round trip through JSON. Cards are stored whole because a
       token has no printing to look up and a cache can be cleared. */

    snapshot() {
      const objs = [];
      for (const o of this.objects.values()) {
        objs.push({
          id: o.id, card: o.card, owner: o.owner, controller: o.controller, zone: o.zone,
          tapped: o.tapped, flipped: o.flipped, faceDown: o.faceDown, face: o.face,
          counters: Object.assign({}, o.counters), damage: o.damage,
          summoningSick: o.summoningSick, attachedTo: o.attachedTo,
          attachments: o.attachments.slice(), isToken: o.isToken, isCopy: o.isCopy,
          phasedOut: o.phasedOut, effects: JSON.parse(JSON.stringify(o.effects || [])),
          markers: Object.assign({}, o.markers), entered: o.entered,
          attacking: o.attacking, blocking: o.blocking.slice(), blockedBy: o.blockedBy.slice(),
          blockOrder: o.blockOrder.slice(), removedFromCombat: o.removedFromCombat,
          chosenX: o.chosenX, targets: JSON.parse(JSON.stringify(o.targets || [])),
          manualNote: o.manualNote, revealedTo: o.revealedTo, isCommander: !!o.isCommander,
          castFromCommandZone: o.castFromCommandZone, foretold: o.foretold, note: o.note,
          shields: o.shields || 0, preventShield: o.preventShield || 0,
          noUntapNext: !!o.noUntapNext, goadedBy: o.goadedBy || null,
          impulseUntil: o.impulseUntil == null ? null : o.impulseUntil, impulseBy: o.impulseBy || null,
          _diedCounters: o._diedCounters ? Object.assign({}, o._diedCounters) : null,
          // a promised gift, a copy for the turn, leave to cast from elsewhere
          giftTo: o.giftTo || null, printedCard: o.printedCard || null, copyOf: o.copyOf || null,
          copyUntilTurn: o.copyUntilTurn == null ? null : o.copyUntilTurn,
          freeCastBy: o.freeCastBy || null, freeCastTurn: o.freeCastTurn == null ? null : o.freeCastTurn,
          graveCastBy: o.graveCastBy || null, graveCastTurn: o.graveCastTurn == null ? null : o.graveCastTurn,
          // cipher: what is encoded on a creature, and what a card is encoded on
          encoded: o.encoded ? o.encoded.slice() : null, encodedOn: o.encodedOn || null,
          // its timestamp, who controlled it before a control effect, what a copy for the turn covered up
          ts: o.ts == null ? null : o.ts, ctlBase: o.ctlBase == null ? null : o.ctlBase,
          copyBefore: o.copyBefore || null,
        });
      }
      return {
        v: 1,
        config: JSON.parse(JSON.stringify(this.config)),
        rngState: this.rng.s,   // so undoing a shuffle really rewinds it
        objs,
        players: this.players.map(p => ({
          id: p.id, name: p.name, seat: p.seat, isBot: p.isBot, botDifficulty: p.botDifficulty,
          botPersonality: p.botPersonality || null,
          avatarColor: p.avatarColor, life: p.life, poison: p.poison, energy: p.energy,
          preventShield: p.preventShield || 0,
          experience: p.experience, pool: p.pool.snapshot(), landsPlayed: p.landsPlayed,
          maxLands: p.maxLands, hasLost: p.hasLost, hasWon: p.hasWon, lossReason: p.lossReason,
          conceded: p.conceded, drewFromEmpty: p.drewFromEmpty,
          commanderDamage: Object.assign({}, p.commanderDamage),
          commanderCasts: Object.assign({}, p.commanderCasts),
          mulligansTaken: p.mulligansTaken, keptHand: p.keptHand,
          bottomAfterMulligan: p.bottomAfterMulligan, connected: p.connected,
          extraTurns: p.extraTurns, skipNextDraw: p.skipNextDraw, maxHandSize: p.maxHandSize,
          monarch: !!p.monarch, initiative: !!p.initiative,
          // the dungeon a player is in, and those they have completed
          dungeon: p.dungeon ? Object.assign({}, p.dungeon) : null, dungeonsCompleted: (p.dungeonsCompleted || []).slice(),
          ringLevel: p.ringLevel || 0, ringBearer: p.ringBearer || null,
          speed: p.speed || 0, speedTurn: p.speedTurn == null ? null : p.speedTurn,
          turnsTaken: p.turnsTaken || 0, hexproofTurn: p.hexproofTurn == null ? null : p.hexproofTurn,
        })),
        zones: Object.fromEntries(Object.entries(this.zones).map(([pid, z]) =>
          [pid, Object.fromEntries(Object.entries(z).map(([k, list]) => [k, list.map(o => o.id)]))])),
        battlefield: this.battlefield.map(o => o.id),
        stack: this.stack.map(it => Object.assign({}, it, {
          obj: undefined, objId: it.obj ? it.obj.id : it.objId,
          effects: it.effects ? JSON.parse(JSON.stringify(it.effects)) : null,
        })),
        turn: this.turn, activeIndex: this.activeIndex, phaseIndex: this.phaseIndex,
        stepIndex: this.stepIndex, priorityIndex: this.priorityIndex,
        passed: Array.from(this.passedInSuccession),
        started: this.started, over: this.over, winners: this.winners.slice(),
        log: this.log.slice(-400),
        pendingChoice: this.pendingChoice ? JSON.parse(JSON.stringify(this.pendingChoice)) : null,
        pendingTriggers: this.pendingTriggers.map(t => Object.assign({}, t, { obj: undefined })),
        combat: JSON.parse(JSON.stringify(this.combat)),
        turnOrder: this.turnOrder.slice(), mulliganPhase: this.mulliganPhase,
        extraTurnsQueue: this.extraTurnsQueue.slice(), stormCount: this.stormCount,
        prevention: this.prevention.slice(),
        delayedTriggers: JSON.parse(JSON.stringify(this.delayedTriggers || [])),
        resolving: this.resolving ? {
          ctx: Object.assign({}, this.resolving.ctx, {
            obj: undefined, objId: this.resolving.ctx.obj ? this.resolving.ctx.obj.id : this.resolving.ctx.objId,
          }),
          effects: JSON.parse(JSON.stringify(this.resolving.effects)),
          index: this.resolving.index,
          answers: JSON.parse(JSON.stringify(this.resolving.answers)),
          manual: JSON.parse(JSON.stringify(this.resolving.manual)),
          afterKind: this.resolving.afterKind,
        } : null,
        stateVersion: this.stateVersion, isDay: this.isDay === undefined ? null : this.isDay,
        holdFor: this.holdFor || null, spellsThisTurn: this.spellsThisTurn || 0,
        objSeq: this._objSeq, uidSeq: this._uidSeq, tsSeq: this._tsSeq || 0,
      };
    }

    restore(snap) {
      if (!snap || snap.v !== 1) return false;
      this.config = Object.assign(this.config, snap.config);
      if (snap.rngState != null) this.rng.s = snap.rngState >>> 0;
      this.objects = new Map();
      for (const d of snap.objs) {
        const o = new GObj(d.card, d.owner, d.zone);
        Object.assign(o, d);
        o.id = d.id;
        this.objects.set(o.id, o);
        this._own(o);
      }
      if (objCounter < snap.objs.length) objCounter = snap.objs.length + 1;
      /* The counters carry on from where they were, so nothing made after
         an undo is given the id of something that has since gone. An older
         save has none, and counts on from the highest id it holds. */
      const highest = snap.objs.reduce((m, d) => Math.max(m, parseInt(String(d.id).slice(1), 10) || 0), 0);
      this._objSeq = Math.max(snap.objSeq || 0, highest, this._objSeq || 0);
      this._uidSeq = Math.max(snap.uidSeq || 0, this._uidSeq || 0);
      this._tsSeq = snap.tsSeq || 0;
      this._lb = null; this._contCache = null;
      const byId = (id) => this.objects.get(id);
      this.players = snap.players.map(d => {
        const p = new Player({ id: d.id, name: d.name, isBot: d.isBot, botDifficulty: d.botDifficulty }, this);
        Object.assign(p, d);
        p.game = this;
        p.pool = new MTG.ManaPool();
        if (d.pool) p.pool.restore(d.pool);
        return p;
      });
      this.zones = {};
      for (const [pid, z] of Object.entries(snap.zones)) {
        this.zones[pid] = {};
        for (const [k, ids] of Object.entries(z)) this.zones[pid][k] = ids.map(byId).filter(Boolean);
      }
      this.battlefield = snap.battlefield.map(byId).filter(Boolean);
      this.stack = snap.stack.map(it => Object.assign({}, it, { obj: byId(it.objId) }));
      this.pendingTriggers = (snap.pendingTriggers || []).map(t => Object.assign({}, t, { obj: byId(t.objId) }));
      this.turn = snap.turn; this.activeIndex = snap.activeIndex;
      this.phaseIndex = snap.phaseIndex; this.stepIndex = snap.stepIndex;
      this.priorityIndex = snap.priorityIndex;
      this.passedInSuccession = new Set(snap.passed || []);
      this.started = snap.started; this.over = snap.over; this.winners = (snap.winners || []).slice();
      this.log = (snap.log || []).slice();
      this.pendingChoice = snap.pendingChoice || null;
      this.combat = snap.combat || { attackers: [], blockers: [], damageDealt: false, firstStrikeDone: false };
      this.turnOrder = (snap.turnOrder || []).slice();
      this.mulliganPhase = !!snap.mulliganPhase;
      this.extraTurnsQueue = (snap.extraTurnsQueue || []).slice();
      this.stormCount = snap.stormCount || 0;
      this.prevention = (snap.prevention || []).slice();
      this.delayedTriggers = (snap.delayedTriggers || []).slice();
      if (snap.resolving) {
        const rs = snap.resolving;
        const ctx = Object.assign({}, rs.ctx);
        if (ctx.objId) ctx.obj = byId(ctx.objId);
        this.resolving = {
          ctx, effects: rs.effects, index: rs.index, answers: rs.answers,
          manual: rs.manual, afterKind: rs.afterKind,
          // the callback is a closure, so it is rebuilt from what it was for
          after: rs.afterKind === 'afterResolve' ? () => this._afterResolve(ctx) : null,
        };
      } else this.resolving = null;
      this.stateVersion = (snap.stateVersion || 0) + 1;
      if (snap.isDay !== null && snap.isDay !== undefined) this.isDay = snap.isDay;
      this.holdFor = snap.holdFor || null;
      this.spellsThisTurn = snap.spellsThisTurn || 0;
      // the event stream carries on from the game as it now is
      this._evRebase();
      this.emit('state', this.stateVersion);
      return true;
    }

    /* ---------- the things multiplayer runs on ----------
       Monarch, the initiative, voting and day/night are what make a
       four-player game a four-player game, and none of them fit the
       "one card, one effect" shape the parser handles. */

    /** CR 720: there is at most one monarch, and taking it is a game action. */
    setMonarch(playerId, how) {
      const p = this.player(playerId);
      if (!p || p.hasLost) return false;
      if (p.monarch) return false;
      for (const x of this.players) x.monarch = false;
      p.monarch = true;
      this.logEvent('monarch', `${p.name} becomes the monarch${how ? ' (' + how + ')' : ''}.`);
      this.emit('sfx', 'crown');
      this._fire('becomesMonarch', playerId, { player: playerId });
      this.touch();
      return true;
    }

    /** The initiative's own triggered ability: venture into Undercity. */
    _initiativeVenture(playerId) {
      this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: null, objId: null, controller: playerId,
        name: 'The Initiative', effects: [{ op: 'venture', undercity: true }], auto: true, abilityText: 'Venture into Undercity.' });
    }

    /** CR 723: the initiative, which also ventures into Undercity. */
    takeInitiative(playerId, how) {
      const p = this.player(playerId);
      if (!p || p.hasLost) return false;
      const had = p.initiative;
      for (const x of this.players) x.initiative = false;
      p.initiative = true;
      this.logEvent('initiative', `${p.name} ${had ? 'keeps' : 'takes'} the initiative${how ? ' (' + how + ')' : ''}.`);
      // "Whenever you take the initiative ... venture into Undercity."
      this._initiativeVenture(playerId);
      this.emit('sfx', 'crown');
      this.touch();
      return true;
    }

    /** CR 701.39: day and night, and the flip conditions between turns. */
    setDayNight(day, why) {
      const was = this.isDay;
      this.isDay = !!day;
      if (was !== this.isDay) {
        this.logEvent('daynight', `It becomes ${this.isDay ? 'day' : 'night'}${why ? ' (' + why + ')' : ''}.`);
        /* Daybound and nightbound (CR 702.145): the permanents turn over
           with the sky. */
        for (const o of this.battlefield) {
          if (!o.card.card_faces || o.card.card_faces.length < 2 || o.faceDown) continue;
          const day0 = (O.analyze(o.card, 0) || {}).keywordSet;
          const night1 = (O.analyze(o.card, 1) || {}).keywordSet;
          const turn = (!this.isDay && o.face === 0 && day0 && day0.has('daybound')) ||
            (this.isDay && o.face === 1 && night1 && night1.has('nightbound'));
          if (!turn) continue;
          o.face = o.face === 0 ? 1 : 0;
          o._chr = null;
          this.logEvent('rules', `${o.card.card_faces[o.face === 0 ? 1 : 0].name} transforms.`);
          this._fire('transforms', o.controller, { source: o, object: o });
        }
        this.bumpBoard();
        this._fire('becomesDay', null, {});
        this.emit('sfx', 'daynight');
      }
      this.touch();
    }

    /** Checked as a turn ends, when day/night is in play (CR 701.39c–d). */
    _checkDayNight() {
      if (this.isDay === undefined || this.isDay === null) return;
      const ap = this.activePlayer;
      if (!ap) return;
      const cast = this.spellsThisTurn || 0;
      if (this.isDay && cast === 0 && this.turn > 1) this.setDayNight(false, 'no spells were cast');
      else if (!this.isDay && cast >= 2) this.setDayNight(true, 'two spells were cast');
    }

    /**
     * A vote (CR 701.32). Everyone chooses in turn order starting with the
     * player after the controller; the tally is returned to the caller.
     */
    startVote(controllerId, prompt, choices, onDone) {
      const order = [];
      const start = this.turnOrder.indexOf(controllerId);
      for (let i = 1; i <= this.turnOrder.length; i++) {
        const pid = this.turnOrder[(start + i) % this.turnOrder.length];
        if (!this.player(pid).hasLost) order.push(pid);
      }
      this._vote = { prompt, choices, order, votes: {}, onDone, controllerId };
      this.logEvent('vote', `${this.player(controllerId).name} calls a vote: ${prompt}`);
      this._askNextVote();
    }
    _askNextVote() {
      const v = this._vote;
      if (!v) return;
      const next = v.order.find(pid => !(pid in v.votes));
      if (!next) {
        const tally = {};
        for (const c of v.choices) tally[c] = 0;
        for (const pid of Object.keys(v.votes)) tally[v.votes[pid]] = (tally[v.votes[pid]] || 0) + 1;
        const best = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
        const winner = best[0];
        const tied = best.filter(k => tally[k] === tally[winner]);
        this.logEvent('vote', 'The vote: ' + v.choices.map(c => `${c} ${tally[c]}`).join(', ') + '.');
        const done = v.onDone;
        this._vote = null;
        this.pendingChoice = null;
        if (done) done({ tally, winner, tied });
        this.touch();
        return;
      }
      const p = this.player(next);
      if (p.isBot) {                       // bots vote for whatever helps them most
        v.votes[next] = v.choices[this.rng.int(v.choices.length)];
        return this._askNextVote();
      }
      this.queueChoice({
        type: 'vote', playerId: next, prompt: v.prompt, options: v.choices.slice(),
      });
    }
    castVote(playerId, choice) {
      const v = this._vote;
      if (!v || !(v.choices || []).includes(choice)) return this.fail('Not a vote you can cast.');
      v.votes[playerId] = choice;
      this.logEvent('vote', `${this.player(playerId).name} votes ${choice}.`);
      this.pendingChoice = null;
      this._askNextVote();
      return true;
    }

    /* ---------- undo ----------
       A misclick should cost a click, not a game. Every intent that changes
       anything pushes the state it changed first; stepping back pops it. */
    pushUndo(label, actor) {
      if (this._restoring || this.over) return null;
      this._undo = this._undo || [];
      const entry = { label: label || 'that', actor: actor || null, at: this.stateVersion, snap: this.snapshot() };
      this._undo.push(entry);
      if (this._undo.length > 30) this._undo.shift();
      return entry;
    }
    /** Drop an entry again when the action turned out to change nothing. */
    dropUndo(entry) {
      if (!entry || !this._undo) return;
      const i = this._undo.indexOf(entry);
      if (i >= 0) this._undo.splice(i, 1);
    }
    /** You can take back your own last action, not someone else's. */
    canUndo(playerId) {
      if (!this._undo || !this._undo.length) return false;
      const top = this._undo[this._undo.length - 1];
      return !playerId || !top.actor || top.actor === playerId;
    }
    undoLabel() {
      if (!this._undo || !this._undo.length) return '';
      return this._undo[this._undo.length - 1].label;
    }
    undo(playerId) {
      if (!this._undo || !this._undo.length) return this.fail('Nothing to undo.');
      if (!this.canUndo(playerId)) return this.fail('That was someone else\u2019s action.');
      const entry = this._undo.pop();
      const keep = this._undo;
      this._restoring = true;
      try { this.restore(entry.snap); }
      finally { this._restoring = false; this._undo = keep; }
      this.logEvent('undo', `${playerId ? (this.player(playerId) || {}).name + ' takes back ' : 'Took back '}${entry.label}.`);
      this.emit('sfx', 'undo');
      return true;
    }

    /* ---------- serialisation for multiplayer ---------- */
    /** A redacted view: hidden zones are replaced with counts for other players. */
    /** May `viewer` see the top card of `ownerId`'s library right now? */
    _topCardShown(ownerId, viewer) {
      for (const o of this.battlefield) {
        if (o.controller !== ownerId || o.phasedOut) continue;
        const e = this._staticOp(o, 'peekTop');
        if (e && (e.revealed || viewer === ownerId)) return true;
      }
      if (viewer !== ownerId) return false;
      const top = this.zones[ownerId].library[0];
      return !!top && !!(this._playFromRule(ownerId, top, 'land') || this._playFromRule(ownerId, top, 'spell') || this._playFromRule(ownerId, top, 'any'));
    }

    viewFor(playerId) {
      /* A face-down card is its controller's to see (CR 708.5), and in
         exile its owner's; anybody else is sent a blank 2/2 in its place,
         so the card cannot be read off the wire. */
      const secret = (o) => o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack' ? o.controller : o.owner) !== playerId;
      const ser = (o, hidden) => hidden ? { id: o.id, hidden: true, owner: o.owner, zone: o.zone } : {
        id: o.id, cardId: secret(o) ? FACE_DOWN_VIEW.id : o.card.id, card: secret(o) ? FACE_DOWN_VIEW : o.card,
        owner: o.owner, controller: o.controller,
        zone: o.zone, tapped: o.tapped, faceDown: o.faceDown, face: o.face,
        /* copied, not shared: a view is a snapshot, and the table compares
           the last one against this one to see what changed */
        counters: Object.assign({}, o.counters), damage: o.damage, summoningSick: o.summoningSick,
        attachedTo: o.attachedTo, attachments: o.attachments, isToken: o.isToken,
        attacking: o.attacking, blocking: o.blocking, blockedBy: o.blockedBy, blockOrder: o.blockOrder,
        effects: o.effects, isCommander: !!o.isCommander, note: o.note, entered: o.entered,
        prepared: !!o.prepared,
        power: (() => { const a = o.analysis(); return a && a.isCreature ? this.powerOf(o) : null; })(),
        toughness: (() => { const a = o.analysis(); return a && a.isCreature ? this.toughnessOf(o) : null; })(),
        /* what it has right now, granted keywords included, so the table can
           tell which permanents a spell is allowed to point at */
        keywords: (() => { const c = this.characteristics(o); return c ? [...c.keywords] : []; })(),
      };
      return {
        v: this.stateVersion,
        you: playerId,
        config: this.config,
        turn: this.turn, phase: this.phase.id, phaseName: this.phase.name,
        step: this.step, stepName: this.stepName,
        activePlayer: this.activePlayer ? this.activePlayer.id : null,
        priorityPlayer: this.priorityPlayer ? this.priorityPlayer.id : null,
        turnOrder: this.turnOrder,
        over: this.over, winners: this.winners,
        mulliganPhase: this.mulliganPhase,
        canUndo: this.canUndo(playerId), undoLabel: this.undoLabel(),
        holding: this.holdFor === playerId,
        /* What the table is doing on your behalf, so it can say so: full
           control on, or a yield running. */
        fullControl: !!((this.config.autoPass || {})[playerId] || {}).fullControl,
        fullControlSticky: !!((this.config.autoPass || {})[playerId] || {}).fullControlSticky,
        yielding: (this.player(playerId) || {}).yieldUntil || null,
        playable: (this.priorityPlayer && this.priorityPlayer.id === playerId)
          ? this.playableNow(playerId).map(x => x.objId) : [],
        /* Why each card in your hand cannot be played just now, so the
           table can say so when you point at one. */
        unplayable: (() => {
          const out = {};
          const z = this.zones[playerId];
          if (!z || this.over || this.mulliganPhase) return out;
          for (const o of z.hand.concat(z.command)) {
            const why = this.whyNotPlayable(playerId, o.id);
            if (why) out[o.id] = why;
          }
          return out;
        })(),
        /* The other things each of your cards can do — cycled from hand,
           cast from the graveyard — so the menus can offer them. */
        uses: (() => {
          const out = {};
          const z = this.zones[playerId];
          if (!z) return out;
          const prepared = this.battlefield.filter(o => o.controller === playerId && o.prepared);
          for (const o of z.hand.concat(z.graveyard, z.exile, this._borrowedExile(playerId), prepared)) {
            const u = this.altUsesFor(playerId, o.id);
            if (u.length) out[o.id] = u;
          }
          return out;
        })(),
        /* The extra costs each card in your hand offers, so the table can
           ask about them before it asks about targets. */
        extras: (() => {
          const out = {};
          const z = this.zones[playerId];
          if (!z) return out;
          for (const o of z.hand.concat(z.command)) {
            const ex = this.extraCostsFor(o.id);
            if (ex.length) out[o.id] = ex;
          }
          return out;
        })(),
        monarch: (this.players.find(p => p.monarch) || {}).id || null,
        initiative: (this.players.find(p => p.initiative) || {}).id || null,
        isDay: this.isDay === undefined ? null : this.isDay,
        pendingChoice: this.pendingChoice && this.pendingChoice.playerId === playerId ? this.pendingChoice : (this.pendingChoice ? { type: this.pendingChoice.type, playerId: this.pendingChoice.playerId, waiting: true } : null),
        stack: this.stack.map(s => ({
          id: s.id, kind: s.kind, name: s.name, controller: s.controller,
          cardId: s.obj ? (secret(s.obj) ? FACE_DOWN_VIEW.id : s.obj.card.id) : null,
          card: s.obj ? (secret(s.obj) ? FACE_DOWN_VIEW : s.obj.card) : null,
          objId: s.objId, targets: s.targets, abilityText: s.abilityText, countered: !!s.countered,
        })),
        battlefield: this.battlefield.map(o => ser(o, false)),
        players: this.players.map(p => ({
          id: p.id, name: p.name, seat: p.seat, isBot: p.isBot, botDifficulty: p.botDifficulty,
          botPersonality: p.botPersonality || null,
          life: p.life, poison: p.poison, energy: p.energy, experience: p.experience,
          pool: p.pool.snapshot(), landsPlayed: p.landsPlayed, maxLands: this.landAllowance(p),
          hasLost: p.hasLost, hasWon: p.hasWon, lossReason: p.lossReason, connected: p.connected,
          mulligansTaken: p.mulligansTaken, keptHand: p.keptHand,
          mulliganBottom: this.bottomCountFor(p),
          commanderDamage: p.commanderDamage, commanderCasts: p.commanderCasts,
          librarySize: this.zones[p.id].library.length,
          // which dungeon room they are in ({ name, room }), for the table to show
          dungeon: p.dungeon ? Object.assign({}, p.dungeon) : null, dungeonsCompleted: (p.dungeonsCompleted || []).length,
          /* "You may look at the top card of your library any time", or a
             permanent that lets them play it, shows it to that player and
             nobody else; "play with the top card of your library revealed"
             shows it to everybody. The table shows it face up on the library. */
          topCard: this.zones[p.id].library.length && this._topCardShown(p.id, playerId) ? ser(this.zones[p.id].library[0]) : null,
          handSize: this.zones[p.id].hand.length,
          hand: p.id === playerId ? this.zones[p.id].hand.map(o => ser(o)) : this.zones[p.id].hand.map(o => ser(o, true)),
          graveyard: this.zones[p.id].graveyard.map(o => ser(o)),
          /* A card exiled from somebody else that you may play (an
             opponent's card Dauthi Voidwalker let you have, the top of a
             library you were let into) is shown with your own exile, where
             you can reach it, and not with theirs. */
          exile: (p.id === playerId
            ? this.zones[p.id].exile.concat(this._borrowedExile(playerId))
            : this.zones[p.id].exile.filter(o => !this._mayPlayFromExile(playerId, o))).map(o => ser(o)),
          command: this.zones[p.id].command.map(o => ser(o)),
        })),
        log: this.log.slice(-200),
      };
    }
  }

  function normTarget(t) {
    if (typeof t === 'string') return { kind: 'object', id: t };
    return t;
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  MTG.rules = { Game, Player, GObj, PHASES, STEP_NAMES, ZONES };
})(window.MTG);


