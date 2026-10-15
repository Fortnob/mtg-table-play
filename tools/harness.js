/* A small table for testing what single cards do, headless.

   Builds a two-player game straight into a main phase, puts named cards
   wherever a test wants them, casts and activates them, answers whatever
   the engine asks along the way, and lets the test look at the result.
   Cards come from the Scryfall bulk file in tools/, so nothing here needs
   the network. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load } = require('./engine');

let MTG = null;
let CARDS = null;
let TOKENS = null;
/* CONTRACTS=1: every view and every question at every test table is
   checked against tools/contracts.js, and contractReport() says what broke. */
const CONTRACTS = process.env.CONTRACTS ? require('./contracts') : null;
const watched = [];

/** Every card in the bulk file, by name (and by front-face name). */
function cards() {
  if (CARDS) return CARDS;
  CARDS = new Map();
  TOKENS = [];
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'oracle-cards.jsonl.gz'))).toString('utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (c.layout === 'art_series') continue;
    if (c.layout === 'token' || c.layout === 'double_faced_token') TOKENS.push(c);
    const key = c.name.toLowerCase();
    // the real card wins over a token or a joke printing of the same name
    const prev = CARDS.get(key);
    const rank = (x) => (x.layout === 'token' || x.layout === 'double_faced_token' ? 2 : 0) +
      (x.set_type === 'funny' || x.set_type === 'memorabilia' ? 1 : 0);
    if (prev && rank(prev) <= rank(c)) continue;
    CARDS.set(key, c);
    if (c.name.includes(' // ')) {
      const front = c.name.split(' // ')[0].toLowerCase();
      if (!CARDS.has(front)) CARDS.set(front, c);
    }
  }
  return CARDS;
}

/** Every printed token in the bulk file (one printing of each), as Scryfall has them. */
function tokens() {
  cards();
  return TOKENS;
}

function engine() {
  if (!MTG) {
    process.env.OFFLINE = '1';
    MTG = load();
  }
  return MTG;
}

function card(name) {
  const c = cards().get(String(name).toLowerCase());
  if (!c) throw new Error('No card named ' + name);
  return engine().scry.slim(c);
}

const chains = new WeakMap();
/** The default answer to every question the engine can ask. */
function defaultAnswer(g, ch) {
  const pid = ch.playerId;
  switch (ch.type) {
    case 'declareAttackers': {
      // nobody attacks, except what has to ("attacks each combat if able")
      // (at the first defender it may attack: Alexios, Deimos of Kosmos never at its owner)
      const defOf = (o) => (ch.defenders || []).find(d => !g._cantAttackYou(o, d.id));
      const must = g.battlefield.filter(o => o.controller === pid && g.canAttack(o) && g.mustAttack(o) && defOf(o));
      return g.declareAttackers(pid, must.map(o => ({ attackerId: o.id, defenderId: defOf(o).id })));
    }
    case 'declareBlockers': return g.declareBlockers(pid, []);
    // (a free Chain of Smog copied back and forth for ever: yes the first few times only)
    case 'confirm': {
      if (ch.purpose !== 'chainCopy') return g.resolveChoice(pid, { yes: true });
      chains.set(g, (chains.get(g) || 0) + 1);
      return g.resolveChoice(pid, { yes: chains.get(g) <= 3 });
    }
    case 'payOrDont': return g.resolveChoice(pid, { pay: true });
    case 'payOrCounter': return g.resolveChoice(pid, { pay: false });
    case 'pickTarget': return g.resolveChoice(pid, { targets: (ch.options || []).map(l => l[0]).filter(Boolean) });
    case 'pickCard': return g.resolveChoice(pid, { cardIds: (ch.cards || []).slice(0, ch.count || 1).map(c => c.id) });
    case 'mode': {
      const modes = [];
      for (let i = 0; i < (ch.count || 1); i++) modes.push(ch.repeatable ? 0 : i);
      return g.resolveChoice(pid, { modes });
    }
    case 'discard': case 'discardToHandSize': {
      const hand = g.zones[pid].hand;
      return g.resolveChoice(pid, { cardIds: hand.slice(0, ch.count).map(o => o.id) });
    }
    case 'sacrifice': {
      const pool = g.battlefield.filter(o => o.controller === pid && (!ch.filter || ch.filter === 'permanent' ||
        g._matchesCategory(o, ch.filter)));
      return g.resolveChoice(pid, { cardIds: ch.optional ? [] : pool.slice(0, ch.count).map(o => o.id) });
    }
    case 'scry': case 'surveil': return g.resolveChoice(pid, { top: (ch.cards || []).map(c => c.id), bottom: [] });
    case 'arrange': return g.resolveChoice(pid, { top: (ch.cards || []).map(c => c.id) });
    case 'riot': return g.resolveChoice(pid, { haste: false });
    // done by hand: nothing to do at a test table but say it is done
    case 'byHand': return g.resolveChoice(pid, { done: true });
    case 'vote': return g.resolveChoice(pid, { choice: (ch.options || [])[0] });
    case 'orderTriggers': return g.resolveChoice(pid, { top: [] });
    // the generic question: the first legal answer, the fewest picks or the smallest number
    case 'choose': return g.resolveChoice(pid, engine().choice.solve(ch) || { picks: [] });
    default: return g.resolveChoice(pid, {});
  }
}

class Table {
  constructor(opts) {
    opts = opts || {};
    const M = engine();
    this.MTG = M;
    this.asked = [];                    // every choice the engine put to anybody
    this.answers = [];                  // queued answers, taken in order
    this.warnings = [];
    const g = this.g = new M.rules.Game({
      formatId: opts.format || 'commander', startingLife: opts.life || 20, startingHand: 0,
      commanderDamage: null, maxPlayers: 4, seed: opts.seed || 7, firstPlayerDraws: false,
      // Planechase (src/06f-planechase.js): each player's planar deck by name, opts.planar[pid], in this order, top first
      planechase: !!opts.planechase,
    });
    const names = opts.players || ['A', 'B'];
    for (const id of names) g.addPlayer({ id, name: id });
    if (CONTRACTS) watched.push(CONTRACTS.watch(g, M, { calls: false, net: false, label: opts.label || Table.label || '' }));
    const filler = opts.library || ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    for (const id of names) {
      g.loadDeck(id, { main: filler.map(n => ({ qty: opts.libraryEach || 4, card: card(n) })),
        planar: ((opts.planar || {})[id] || []).map(n => card(n)) });
      // (in the order given, not shuffled)
      if (opts.planechase && (opts.planar || {})[id]) {
        const want = opts.planar[id];
        g.zones[id].planar.sort((x, y) => want.indexOf(x.card.name) - want.indexOf(y.card.name));
      }
    }
    g.start();
    g.turnOrder = names.slice();
    for (const id of names) g.keepHand(id, []);
    this.toMain(names[0]);
  }

  get game() { return this.g; }
  player(id) { return this.g.player(id); }

  /** Put a card somewhere. On the battlefield it arrives quietly unless `etb` is set. */
  put(pid, name, zone, opts) {
    opts = opts || {};
    const g = this.g;
    const o = g._register(new this.MTG.rules.GObj(card(name), pid, zone === 'battlefield' && opts.etb ? 'hand' : zone));
    if (zone === 'battlefield') {
      if (opts.etb) {
        g.zones[pid].hand.push(o);
        g.moveObject(o, 'battlefield', { controller: pid });
        this.settle();
      } else {
        o.zone = 'battlefield'; o.controller = pid;
        o.entered = g.turn - 1; o.summoningSick = !!opts.sick;
        // in the order the test puts things down, for the layers (CR 613.7)
        if (g._stampNew) o.ts = g._stampNew();
        const a = o.analysis();
        if (a && a.isPlaneswalker) o.counters.loyalty = parseInt(a.loyalty, 10) || 0;
        g.battlefield.push(o);
        g.bumpBoard();
      }
      if (opts.tapped) o.tapped = true;
      if (opts.counters) Object.assign(o.counters, opts.counters);
    } else if (zone === 'library' && opts.top !== false) {
      g.zones[pid].library.unshift(o);
    } else {
      g.zones[pid][zone].push(o);
    }
    return o;
  }
  hand(pid, name) { return this.put(pid, name, 'hand'); }
  bf(pid, name, opts) { return this.put(pid, name, 'battlefield', opts); }
  grave(pid, name) { return this.put(pid, name, 'graveyard'); }
  top(pid, name) { return this.put(pid, name, 'library'); }

  /** Float mana: mana('A', 'RRG2') adds two red, a green and two colourless. */
  mana(pid, spec) {
    const pool = this.player(pid).pool;
    for (const ch of String(spec).match(/\d+|[WUBRGC]/g) || []) {
      if (/^\d+$/.test(ch)) pool.add('C', +ch); else pool.add(ch);
    }
  }

  /** Queue an answer for the next question of this type (or any type, with '*'). */
  answer(type, data) { this.answers.push({ type, data }); return this; }

  /** Answer every pending question, with queued answers first and defaults after. */
  settle() {
    const g = this.g;
    for (let guard = 0; guard < 200 && g.pendingChoice; guard++) {
      const ch = g.pendingChoice;
      this.asked.push(ch);
      const i = this.answers.findIndex(a => a.type === ch.type || a.type === '*');
      if (i >= 0) {
        const [a] = this.answers.splice(i, 1);
        const data = typeof a.data === 'function' ? a.data(ch, g) : a.data;
        if (ch.type === 'declareAttackers') g.declareAttackers(ch.playerId, data || []);
        else if (ch.type === 'declareBlockers') g.declareBlockers(ch.playerId, data || []);
        else g.resolveChoice(ch.playerId, data || {});
      } else defaultAnswer(g, ch);
      if (g.pendingChoice === ch) throw new Error('Choice was not accepted: ' + ch.type + ' ' + (g.lastError || ''));
    }
  }

  /** Everybody passes until the stack is empty (answering questions as they come). */
  resolve() {
    const g = this.g;
    for (let guard = 0; guard < 400; guard++) {
      this.settle();
      if (!g.stack.length && !g.pendingTriggers.length) break;
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    this.settle();
  }

  cast(pid, o, opts) {
    opts = Object.assign({ auto: true, targets: [] }, opts || {});
    opts.targets = (opts.targets || []).map(t => this.tgt(t));
    const ok = this.g.castSpell(pid, o.id, opts);
    if (!ok) throw new Error('Could not cast ' + o.name + ': ' + this.g.lastError);
    this.settle();
    if (opts.resolve !== false) this.resolve();
    return ok;
  }

  activate(pid, o, index, opts) {
    opts = Object.assign({ auto: true, targets: [] }, opts || {});
    opts.targets = (opts.targets || []).map(t => this.tgt(t));
    const ok = this.g.activateAbility(pid, o.id, index || 0, opts);
    if (!ok) throw new Error('Could not activate ' + o.name + ': ' + this.g.lastError);
    this.settle();
    if (opts.resolve !== false) this.resolve();
    return ok;
  }

  playLand(pid, o) {
    const ok = this.g.playLand(pid, o.id);
    if (!ok) throw new Error('Could not play ' + o.name + ': ' + this.g.lastError);
    this.resolve();
    return ok;
  }

  /** A target in the engine's shape, from an object, a player id or a stack item. */
  tgt(t) {
    if (!t) return t;
    if (typeof t === 'string') return this.g.player(t) ? { kind: 'player', id: t } : { kind: 'object', id: t };
    if (t.kind) return t;
    if (t.obj && t.kind === undefined && t.id && String(t.id).startsWith('st')) return { kind: 'stack', id: t.id };
    return { kind: 'object', id: t.id };
  }
  /** The stack item for a spell object that has been cast. */
  stackItem(o) { return this.g.stack.find(s => s.objId === o.id); }
  stackTarget(o) { const s = this.stackItem(o); return s && { kind: 'stack', id: s.id }; }

  /** Pass priority until it is this player's step (default: precombat main). */
  toMain(pid, step) {
    const g = this.g;
    const want = step || 'main';
    for (let guard = 0; guard < 300; guard++) {
      this.settle();
      if (g.over) return;
      if (g.activePlayer.id === pid && g.step === want && (want !== 'main' || g.phase.id === 'precombat') &&
          !g.stack.length && !g.pendingChoice) return;
      const p = g.priorityPlayer;
      if (!p) throw new Error('Nobody has priority');
      g.passPriority(p.id, true);
    }
    throw new Error('Never reached ' + want);
  }
  /** Run on to the next turn of this player. */
  nextTurn(pid) {
    const g = this.g;
    const t = g.turn;
    for (let guard = 0; guard < 400 && (g.turn === t || g.activePlayer.id !== pid); guard++) {
      this.settle();
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    this.toMain(pid);
  }

  zone(pid, z) { return this.g.zones[pid][z]; }
  names(list) { return list.map(o => o.name); }
  bfOf(pid) { return this.g.battlefield.filter(o => o.controller === pid); }
  life(pid) { return this.player(pid).life; }
  manualLines() { return this.g.log.filter(l => /resolve this by hand|resolve by hand|Unhandled effect/i.test(l.text)).map(l => l.text); }
}

/** What the contract checks found at every table so far (null when CONTRACTS is off). */
function contractReport() {
  if (!CONTRACTS) return null;
  const all = CONTRACTS.merge(watched.map(w => w.violations.concat(w.known)));
  return { violations: all.filter(v => !v.known), known: all.filter(v => v.known), format: CONTRACTS.format };
}

module.exports = { Table, card, cards, tokens, engine, contractReport };
