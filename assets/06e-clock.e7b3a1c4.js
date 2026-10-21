/* ===== 06e-clock.js ===== */
'use strict';
/* ============================================================
   06e-clock.js - the game clock, a house rule

   "Clock: 10, 20 or 30 minutes a player" (src/04-formats.js). Each player
   has that long for the whole game, and it runs only while the game is
   waiting on them: while they hold priority, or have a question to
   answer, or attackers or blockers to declare. Whoever runs out loses the
   game, the way a player who concedes does. The opening hands are not on
   the clock; it starts with the first turn.

   The host keeps the clock, and its word is final: the time left goes out
   with every view (view.clock), and each table counts down from there by
   itself until the next view comes (src/12g-ui-clock.js). A bot's time is
   not counted.
   ============================================================ */
(function (MTG) {
  /** The choices the house rule offers, in minutes a player; 0 is no clock. */
  const MINUTES = [0, 10, 20, 30];
  /* How often the clock looks at the game, and the longest gap between two
     looks that it believes. A longer one means this device was asleep (a
     phone locked, a tab put away), and nobody can have been playing in
     the meantime, so only the first few seconds of it are counted. */
  const TICK = 250;
  const MAX_GAP = 5000;
  const clockNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /** Whom the game is waiting on just now, bots included. */
  function waitingOn(g) {
    if (!g || g.over || !g.started || g.mulliganPhase || !(g.turn >= 1)) return [];
    const live = (id) => { const p = g.player(id); return p && !p.hasLost ? [id] : []; };
    if (g.pendingChoice) return live(g.pendingChoice.playerId);
    const p = g.priorityPlayer;
    return p ? live(p.id) : [];
  }

  /** A player's time as m:ss, rounded up, so 0:00 really is none left. */
  function format(ms) {
    const s = Math.max(0, Math.ceil((ms || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  class Clock {
    /**
     * @param {any} g the game
     * @param {number} minutes each player's time
     * @param {any} [opts] { alive(): false once nobody is looking after
     *   this game any more; now(): the time in ms, for tests; tick: false
     *   to look only when told to (tests) }
     */
    constructor(g, minutes, opts) {
      opts = opts || {};
      this.game = g;
      this.total = Math.round(minutes * 60000);
      this.now = opts.now || clockNow;
      this.alive = opts.alive || (() => true);
      /** @type {Record<string, number>} ms left, for each person at the table */
      this.left = {};
      for (const p of g.players) if (!p.isBot) this.left[p.id] = this.total;
      /** @type {string[]} whose time is running */
      this.running = [];
      this.at = this.now();
      this.stopped = false;
      // priority and questions can move on without the state changing, so those are watched too
      this._onState = () => this.settle();
      for (const ev of ['state', 'priority', 'choice']) g.on(ev, this._onState);
      this.timer = opts.tick === false ? null : setInterval(() => this.tick(), TICK);
    }

    /** Carry on from a saved game's clock (what save() gave). */
    restore(saved) {
      if (!saved || !saved.left) return;
      for (const id of Object.keys(this.left)) {
        const v = saved.left[id];
        if (typeof v === 'number' && isFinite(v)) this.left[id] = Math.max(0, Math.min(this.total, v));
      }
      this.at = this.now();
    }

    /**
     * The time since the last look, charged to whoever the game was
     * waiting on then; and whom it is waiting on now. Only arithmetic, so
     * it is safe in the middle of anything the engine is doing.
     */
    settle() {
      if (this.stopped) return;
      const t = this.now();
      const spent = Math.min(Math.max(0, t - this.at), MAX_GAP);
      this.at = t;
      for (const id of this.running) if (id in this.left) this.left[id] = Math.max(0, this.left[id] - spent);
      this.running = waitingOn(this.game).filter(id => id in this.left);
      if (this.game.over) this.stop();
    }

    /**
     * A look at the clock, from outside the engine: anyone whose time has
     * run out while the game waited on them is out of the game.
     */
    tick() {
      if (this.stopped) return;
      if (!this.alive()) { this.stop(); return; }
      this.settle();
      for (const id of this.running.filter(x => this.left[x] <= 0)) {
        if (this.stopped || this.game.over) break;
        this.game.concede(id, 'time');
      }
    }

    /** What every table is told: each person's time left, and whose is running. */
    view() {
      this.settle();
      return { total: this.total, left: Object.assign({}, this.left), running: this.running.slice() };
    }

    /** For a saved game. */
    save() {
      this.settle();
      return { left: Object.assign({}, this.left) };
    }

    stop() {
      if (this.stopped) return;
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      for (const ev of ['state', 'priority', 'choice']) this.game.off(ev, this._onState);
    }
  }

  MTG.clock = {
    MINUTES, TICK, MAX_GAP, Clock, waitingOn, format,
    /** A clock for this game, or null when the table plays without one. */
    attach(g, minutes, opts) {
      return minutes > 0 ? new Clock(g, minutes, opts) : null;
    },
  };
})(window.MTG);
