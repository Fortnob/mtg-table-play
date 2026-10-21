/* ===== 12d-ui-replay.js ===== */
/* ============================================================
   12d-ui-replay.js - watching a game again

   A replay (src/06c-replay.js) is played on an ordinary table: the game is
   rebuilt from its record one action at a time, and after each one the
   table is handed a view with the events that action caused, exactly as
   it would be in a live game. The table does not know the difference —
   except that nothing on it is anybody's to click.

   The controls are one small bar: back to the start, step back a turn,
   play or pause, one action on, on to the next turn, how fast, and whose
   seat to watch from.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const SPEEDS = [0.5, 1, 2, 4, 8];

  class ReplayViewer {
    constructor(root, rp, opts) {
      opts = opts || {};
      this.rp = rp;
      this.speed = 1;
      this.playing = false;
      const meta = rp.data.meta || {};
      this.viewer = meta.me && rp.game.player(meta.me) ? meta.me : '__watching';
      this._build(root);
      rp.on('reset', () => { this._seen = undefined; });
      if (!opts.paused) this.playing = true;
    }

    _build(root) {
      // nothing at a replay is anybody's to do
      this.table = new UI.Table(root, this.viewer, () => {});
      this.table.isReplay = true;
      this.table.paceScale = 1;
      const b = (label, title, fn, cls) => el('button', { type: 'button', class: 'btn xs ' + (cls || 'ghost'), text: label, title, 'aria-label': title, onclick: fn });
      this.btnPlay = b('▶', 'Play', () => this.toggle(), 'primary');
      this.btnSpeed = b('1×', 'Speed', () => this.cycleSpeed());
      this.btnSeat = b('', 'Whose seat to watch from', () => this.cycleSeat());
      this.where = el('span', { class: 'rb-where' });
      this.bar = el('div', { class: 'replay-bar', role: 'toolbar', 'aria-label': 'Replay' }, [
        el('span', { class: 'rb-tag', text: 'Replay' }),
        b('⏮', 'Back to the start', () => this.restart()),
        b('◀◀', 'Back a turn', () => this.seekTurn(Math.max(0, this.rp.game.turn - 1))),
        this.btnPlay,
        b('▶|', 'One action on', () => this.stepOnce()),
        b('▶▶', 'On to the next turn', () => this.seekTurn(this.rp.game.turn + 1)),
        this.btnSpeed, this.btnSeat, this.where,
        b('✕', 'Stop watching', () => MTG.app.leaveGame({ keepSave: true })),
      ]);
      this.table.arena.appendChild(this.bar);
      this.renderBar();
    }

    /** What the table is shown: the game as the chosen seat sees it, with nothing to act on. */
    _view(events) {
      const g = this.rp.game;
      const v = g.viewFor(this.viewer);
      v.replay = true;
      v.spectating = this.viewer === '__watching' || !!v.mulliganPhase;
      v.playable = []; v.uses = {}; v.extras = {};
      v.canUndo = false; v.holding = false; v.fullControl = false; v.yielding = null;
      if (v.pendingChoice && v.pendingChoice.playerId === this.viewer) {
        v.pendingChoice = { type: v.pendingChoice.type, playerId: v.pendingChoice.playerId, waiting: true };
      }
      v.events = events === undefined ? g.eventsFor(this.viewer, this._seen) : events;
      v.eventSeq = g.eventSeq;
      this._seen = g.eventSeq;
      return v;
    }

    /** Show the game as it stands, with whatever happened since the last look. */
    show(jump) {
      if (this._stopped) return;
      if (jump) this.table._noMotionOnce = true;
      // (nor are the dice of where it jumped from still rolling)
      if (jump && MTG.feel && MTG.feel.luckClear) MTG.feel.luckClear(this.table);
      // a jump is a cut, not a hundred things happening at once
      this.table.update(this._view(jump ? [] : undefined));
      this.renderBar();
      if (this.playing) this._run();
    }

    renderBar() {
      const rp = this.rp, g = rp.game;
      this.btnPlay.textContent = this.playing ? '❚❚' : '▶';
      this.btnPlay.title = this.playing ? 'Pause' : 'Play';
      this.btnSpeed.textContent = (this.speed < 1 ? '½' : this.speed) + '×';
      const p = g.player(this.viewer);
      this.btnSeat.textContent = p ? p.name : 'All seats';
      this.where.textContent = `Turn ${g.turn} · ${rp.index}/${rp.total}` + (rp.done ? ' · end' : '');
    }

    toggle() {
      if (this.rp.done) { this.restart(true); return; }
      this.playing = !this.playing;
      this.renderBar();
      if (this.playing) this._run();
    }
    cycleSpeed() {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      this.table.paceScale = 1 / this.speed;
      this.renderBar();
    }
    cycleSeat() {
      const ids = this.rp.game.players.map(p => p.id).concat(['__watching']);
      this.viewer = ids[(ids.indexOf(this.viewer) + 1) % ids.length];
      // a different seat is a different table: hands, and which side is yours
      const root = this.table.root;
      this.table.destroy();
      this.bar.remove();
      this._seen = undefined;
      this._build(root);
      MTG.app.table = this.table;
      this.show(true);
    }

    stepOnce() {
      this.playing = false;
      if (this.rp.step()) this.show();
      else this.renderBar();
    }
    restart(play) {
      this.playing = !!play;
      this.rp.reset();
      this.show(true);
    }
    /** Jump to the start of turn `n`, without playing every action out on the table. */
    seekTurn(n) {
      const was = this.playing;
      this.playing = false;
      this.rp.seekTurn(n);
      this.playing = was;
      this.show(true);
    }

    /** Wait for the table to finish showing what it has been given. */
    async _settle() {
      const t = this.table;
      for (let i = 0; i < 200 && !this._stopped && (t.queue.length || t._pumping); i++) await sleep(30);
    }

    async _run() {
      if (this._running) return;
      this._running = true;
      try {
        while (this.playing && !this._stopped && !this.rp.done) {
          const before = this.rp.game.stateVersion;
          this.rp.step();
          if (this.rp.game.stateVersion !== before) {
            this.table.update(this._view());
            this.renderBar();
            await this._settle();
            await sleep(90 / this.speed);
          } else this.renderBar();
        }
      } finally { this._running = false; }
      if (this.rp.done && !this._stopped) this._finished();
    }

    _finished() {
      this.playing = false;
      this.renderBar();
      const check = this.rp.verify();
      if (this.rp.errors.length || !check.ok) {
        console.warn('[replay] playback did not end where the game did', check, this.rp.errors);
        UI.toast('This replay did not play back exactly as it was recorded.', 'err', 5000);
      } else this.table.say('End of the replay', 'info', 3000);
    }

    stop() {
      this._stopped = true;
      this.playing = false;
      if (this.bar) this.bar.remove();
    }
  }

  UI.ReplayViewer = ReplayViewer;
})(window.MTG);
