/* ===== 12g-ui-clock.js ===== */
'use strict';
/* ============================================================
   12g-ui-clock.js - the game clock, at the table

   When the table plays with a clock (src/06e-clock.js), each person's
   time left sits by their portrait. The host's word on it comes with
   every view; between views each table counts the running clock down by
   itself, so it moves every second without the host saying anything.
   Under a minute it turns urgent; under ten seconds, on your own clock,
   it ticks softly each second. When a clock runs out, the table says so
   with a banner (the engine writes the log line).

   Wrapped round the table, the way src/12f-ui-feel.js is, rather than
   written into it: a view arriving, a portrait painted, the table closing.
   ============================================================ */
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const now = () => performance.now();
  const fmt = (ms) => MTG.clock.format(ms);
  const REPAINT = 250;

  /* A soft tick, for your own last ten seconds: a small wooden knock,
     higher and a touch louder as the time runs down. */
  if (MTG.audio && MTG.audio.FX) {
    MTG.audio.FX.clock_tick = function (o) {
      const k = Math.max(0, Math.min(1, (o && o.intensity) || 0));
      this.tone(900 + 300 * k, { type: 'sine', dur: 0.05, gain: 0.03 + 0.03 * k, send: 0.15 });
    };
  }

  /** The time a player has left just now, or null if they are not on the clock. */
  function leftFor(t, pid) {
    const k = t._clock;
    if (!k || !k.c || !k.c.left || !(pid in k.c.left)) return null;
    let ms = k.c.left[pid];
    if (!k.over && (k.c.running || []).includes(pid)) ms -= now() - k.at;
    return Math.max(0, ms);
  }

  /** The time by one portrait. */
  function paintClock(t, orb) {
    const pid = orb.dataset.player;
    let tag = orb.querySelector(':scope > .orb-clock');
    const ms = pid ? leftFor(t, pid) : null;
    if (ms == null) { if (tag) tag.remove(); return; }
    if (!tag) { tag = el('span', { class: 'orb-clock', 'aria-hidden': 'true' }); orb.appendChild(tag); }
    const text = fmt(ms);
    if (tag.textContent !== text) tag.textContent = text;
    const running = !t._clock.over && (t._clock.c.running || []).includes(pid);
    tag.classList.toggle('running', running);
    tag.classList.toggle('urgent', ms < 60000);
    tag.classList.toggle('critical', running && ms < 10000);
    tag.classList.toggle('out', ms <= 0);
  }

  /** Every portrait's time, and the soft tick on your own last seconds. */
  function repaint(t) {
    if (t._destroyed || !t.arena) return;
    for (const orb of t.arena.querySelectorAll('.life-orb')) paintClock(t, orb);
    const k = t._clock;
    const mine = k && !k.over && (k.c.running || []).includes(t.meId) ? leftFor(t, t.meId) : null;
    if (mine != null && mine > 0 && mine <= 10000 && !document.hidden) {
      const s = Math.ceil(mine / 1000);
      if (s !== t._clockBeat) { t._clockBeat = s; MTG.sfx('clock_tick', { intensity: (10 - s) / 10 }); }
    } else t._clockBeat = null;
  }

  /** A clock run out: a banner across the table. */
  function timeUp(t, p) {
    const mine = p.id === t.meId;
    const b = el('div', { class: 'fx-clock-out' + (mine ? ' mine' : '') }, [
      el('div', { class: 'fco-line' }),
      el('div', { class: 'fco-who', text: mine ? 'Your time is up' : `Time is up for ${p.name}` }),
      el('div', { class: 'fco-sub', text: mine ? 'You lose the game' : `${p.name} loses the game` }),
    ]);
    t.fxLayer.appendChild(b);
    setTimeout(() => b.remove(), 3400);
  }

  /* ---------------- hooks into the table ---------------- */
  const base = { update: Table.prototype.update, paintOrb: Table.prototype.paintOrb, destroy: Table.prototype.destroy };

  Table.prototype.update = function (view) {
    try {
      if (view && view.clock) {
        this._clock = { at: now(), c: view.clock, over: !!view.over };
        if (!this._clockTimer && !view.over) this._clockTimer = setInterval(() => repaint(this), REPAINT);
        if (view.over && this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
      }
      // whoever has just run out of time gets a banner, once
      this._timeUp = this._timeUp || new Set();
      for (const p of (view && view.players) || []) {
        if (p.hasLost && p.lossReason === 'time' && !this._timeUp.has(p.id)) {
          this._timeUp.add(p.id);
          // a table opened on a game long since decided is not told again
          if (this.live) timeUp(this, p);
        }
      }
    } catch (e) { /* never in the way of the game */ }
    return base.update.apply(this, arguments);
  };

  Table.prototype.paintOrb = function (orb, p) {
    const r = base.paintOrb.apply(this, arguments);
    try {
      paintClock(this, orb);
      const ms = this._clock ? leftFor(this, p.id) : null;
      if (ms != null) orb.title += ` — ${fmt(ms)} left on the clock`;
    } catch (e) { /* no matter */ }
    return r;
  };

  Table.prototype.destroy = function () {
    if (this._clockTimer) clearInterval(this._clockTimer);
    this._clockTimer = null;
    return base.destroy.apply(this, arguments);
  };
})(window.MTG);
