/* ============================================================
   01-audio.js — the table's sound

   Everything is synthesised, so the app stays one file with no assets. What
   makes it sound like a place rather than a row of beeps:

     a mixer     — the interface, the game and the room each have their own
                   bus and their own volume, and everything goes through one
                   limiter on the way out, so a pile of sounds at once gets
                   louder without ever getting harsh
     a room      — one convolution reverb that every voice can be sent to, so
                   sounds decay into the same space instead of stopping dead
     a direction — each seat has a position in the stereo field, so a spell
                   cast across the table arrives from over there
     a weight    — an effect carries how big it was, so three damage and
                   twelve damage are not the same sound at the same volume
     a colour    — a spell sounds like the mana it was made of: white rings,
                   blue is glass, black is low, red crackles, green is wood
     a little drift — nothing plays at exactly the same pitch or moment twice,
                   so the tenth land does not sound like a machine

   Voices are layered the way a real sound is: a transient that gives it an
   edge, a body that gives it pitch, and a tail that gives it size.

   Nothing here knows about rules. What the table hears is decided by
   src/12f-ui-feel.js, from the game's events, at the moment each one is
   shown; this file only knows how to make each sound.
   ============================================================ */
'use strict';
(function (MTG) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* Settings that came after the first version of the app have no saved
     value yet; these are what they start as. */
  const DEFAULTS = { volume: 0.5, volUi: 0.7, volGame: 1, volAmb: 0.35, ambience: true };
  const setting = (k) => {
    const v = MTG.settings ? MTG.settings[k] : undefined;
    return v == null ? DEFAULTS[k] : v;
  };

  /* Which sounds belong to the interface rather than the game. They have
     their own volume, so a player can keep the cards and lose the clicks. */
  const UI_SOUNDS = new Set(['click', 'hover', 'confirm', 'cancel', 'error', 'reject', 'pickup', 'notify', 'chat',
    'join', 'leave', 'pack_open', 'pick', 'ui_attack', 'ui_block', 'ui_play', 'priority', 'choice', 'target',
    'pack_shake', 'pack_tear', 'card_flip', 'reveal_rare', 'reveal_mythic', 'new_card', 'shards', 'purchase', 'wildcard']);

  /* Each colour of mana as sound: the notes it is built from and how they
     are played. Notes are in hertz; the first is the root. */
  const PALETTE = {
    W: { notes: [880, 1108.7, 1318.5, 1760], wave: 'triangle', mana: 1760 },
    U: { notes: [659.3, 987.8, 1318.5, 1975.5], wave: 'sine', bell: 3.5, mana: 1568 },
    B: { notes: [196, 233.1, 293.7, 349.2], wave: 'sawtooth', mana: 1046.5 },
    R: { notes: [329.6, 440, 493.9, 659.3], wave: 'sawtooth', mana: 1318.5 },
    G: { notes: [196, 293.7, 392, 440], wave: 'triangle', mana: 1174.7 },
    C: { notes: [523.3, 784, 1046.5, 1568], wave: 'sine', bell: 1.41, mana: 1480 },
  };
  /* How each sound sits against the others, measured by ear and by meter:
     the small frequent ones are brought up so they are not lost, without
     letting them crowd the big ones. */
  const TRIM = { draw: 2, deal: 1.4, tap: 2.5, untap: 2, hover: 1.6, click: 1.4, token: 1.8, bounce: 1.8, settle: 1.3,
    activate: 1.4, priority: 1.3, block: 1.8, discard: 1.4, mill: 1.3, counter_add: 1.3, counter_remove: 1.3 };

  /** The palettes for a sound: its colours, or colourless. At most two, so gold cards stay readable. */
  function pal(o) {
    const cs = (o && o.colors && o.colors.length ? o.colors : ['C']).filter(c => PALETTE[c]).slice(0, 2);
    return (cs.length ? cs : ['C']).map(c => Object.assign({ key: c }, PALETTE[c]));
  }

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.buses = null;
      this.verbSend = null;
      this.noiseBuf = null;
      this.lastPlay = new Map();
      this.voices = 0;
      this.history = [];            // the last sounds asked for, newest last: what was played, and when
      this._t = null;               // while an effect is being built: the moment it starts
      this._pv = 1;                 // and how far its pitch has drifted
      this._trim = 1;               // and how much louder or softer it is than written
      this._bus = 'game';
      this._ambWanted = false;
      this._tensionLevel = 0;
    }

    _ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* not yet allowed */ } }
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
      const ctx = this.ctx;

      /* master -> limiter -> out. The limiter is a compressor set hard
         enough that a pile of sounds at once flattens rather than clips. */
      this.master = ctx.createGain();
      this.master.gain.value = this._masterLevel();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 14;
      limiter.attack.value = 0.002; limiter.release.value = 0.18;
      // the voices are written quiet, so that many at once have headroom; this brings them up to level
      const makeup = ctx.createGain();
      makeup.gain.value = 2.4;
      this.master.connect(makeup);
      makeup.connect(limiter);
      limiter.connect(ctx.destination);
      this.limiter = limiter;

      // a room to decay into, on a send so dry level stays under control
      this.verbSend = ctx.createGain();
      this.verbSend.gain.value = 1;
      this.verb = ctx.createConvolver();
      this.verb.buffer = this._impulse(2.2, 3);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.42;
      this.verbSend.connect(this.verb);
      this.verb.connect(verbOut);
      verbOut.connect(this.master);

      /* Three buses. Each has a dry path and a wet one, both at the bus's
         volume, so turning a bus down turns its echo down with it. The game
         and the room each have a duck as well, for big moments to push
         against. */
      const bus = (duckable) => {
        const dry = ctx.createGain(), wet = ctx.createGain();
        const duck = duckable ? ctx.createGain() : null;
        if (duck) { dry.connect(duck); duck.connect(this.master); } else dry.connect(this.master);
        wet.connect(this.verbSend);
        return { dry, wet, duck };
      };
      this.buses = { ui: bus(false), game: bus(true), amb: bus(true) };
      this.duck = this.buses.amb.duck;

      this._makeNoise();
      this.applyLevels();
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => this._ambTick());
      }
      return true;
    }

    /**
     * A room: decaying noise, a little different in each ear, that gets
     * darker as it dies away the way a real room swallows the high end.
     */
    _impulse(seconds, decay) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const pre = Math.floor(rate * 0.012);
      const buf = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / (len - pre);
          // the filter closes as the tail goes on
          const k = 0.75 - 0.6 * t;
          lp += k * ((Math.random() * 2 - 1) - lp);
          const early = i < pre + rate * 0.04 && Math.random() < 0.012 ? (Math.random() * 2 - 1) * 0.8 : 0;
          d[i] = lp * Math.pow(1 - t, decay) * 0.9 + early;
        }
      }
      return buf;
    }

    _makeNoise() {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // brown noise, for the room tone under the ambience
      const b = this.ctx.createBuffer(1, len * 2, this.ctx.sampleRate);
      const bd = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
      this.brownBuf = b;
    }

    /* ---------------- levels ---------------- */

    _masterLevel() { return setting('muted') ? 0 : clamp(+setting('volume') || 0, 0, 1); }

    /** Bring every bus to the levels in the settings, smoothly so nothing clicks. */
    applyLevels() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const set = (p, v) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, 0.05); };
      set(this.master.gain, this._masterLevel());
      const lv = { ui: setting('volUi'), game: setting('volGame'), amb: setting('volAmb') };
      for (const k in this.buses) {
        const v = clamp(+lv[k] || 0, 0, 1);
        set(this.buses[k].dry.gain, v);
        set(this.buses[k].wet.gain, v);
      }
      this._ambTick();
    }

    setVolume(v) {
      MTG.settings.volume = v; MTG.saveSettings();
      this.applyLevels();
    }
    setMuted(m) {
      MTG.settings.muted = m; MTG.saveSettings();
      this.applyLevels();
    }
    /** One bus's volume: 'volUi', 'volGame' or 'volAmb'. */
    setLevel(key, v) {
      MTG.settings[key] = clamp(+v || 0, 0, 1); MTG.saveSettings();
      this.applyLevels();
    }
    setAmbience(on) {
      MTG.settings.ambience = !!on; MTG.saveSettings();
      this.applyLevels();
    }

    /**
     * Push the room (and anything humming under the game) down for a moment,
     * so one big sound has room. The sound itself is not ducked: it is the
     * thing being made room for.
     */
    dip(amount, hold) {
      if (!this.buses) return;
      const t = this._now();
      const g = this.buses.amb.duck.gain;
      const depth = clamp(1 - amount * 2.2, 0.08, 1);
      g.cancelScheduledValues(t);
      g.setTargetAtTime(depth, t, 0.015);
      g.setTargetAtTime(1, t + (hold || 0.3), 0.4);
      if (this._tension) {
        const tg = this._tension.duck.gain;
        tg.cancelScheduledValues(t);
        tg.setTargetAtTime(depth, t, 0.02);
        tg.setTargetAtTime(1, t + (hold || 0.3), 0.5);
      }
    }

    /* ---------------- the signal path for one voice ---------------- */

    _now() { return this._t != null ? this._t : this.ctx.currentTime; }
    _cap() { return MTG.isPhone && MTG.isPhone() ? 36 : 64; }

    _out(pan, send) {
      const ctx = this.ctx;
      const bus = this.buses[this._bus] || this.buses.game;
      const g = ctx.createGain();
      let node = g;
      if (pan != null && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p);
        node = p;
      }
      node.connect(bus.dry);
      if (send !== 0) {
        const s = ctx.createGain();
        s.gain.value = (send == null ? 0.18 : send);
        node.connect(s);
        s.connect(bus.wet);
      }
      return g;
    }

    _env(g, t0, a, d, peak, hold) {
      const p = Math.max(0.0004, peak * this._trim);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p, t0 + Math.max(0.001, a));
      if (hold) g.gain.setValueAtTime(p, t0 + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + (hold || 0) + Math.max(0.01, d));
    }

    _track(node) {
      this.voices++;
      node.onended = () => { this.voices--; };
    }

    /** One pitched voice. */
    tone(freq, o) {
      if (!this._ensure() || this.voices > this._cap()) return;
      o = o || {};
      const t0 = this._now() + (o.delay || 0);
      const dur = o.dur || 0.15;
      const osc = this.ctx.createOscillator();
      osc.type = o.type || 'sine';
      const pv = this._pv * (o.detune ? 1 + (Math.random() - 0.5) * o.detune : 1);
      const f = Math.max(20, freq * pv);
      osc.frequency.setValueAtTime(f, t0);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo * pv), t0 + (o.slideDur || dur));
      let src = osc;
      if (o.filter) {
        const bq = this.ctx.createBiquadFilter();
        bq.type = o.filter;
        bq.frequency.setValueAtTime(o.filterFreq || 1400, t0);
        if (o.filterTo) bq.frequency.exponentialRampToValueAtTime(Math.max(40, o.filterTo), t0 + dur);
        bq.Q.value = o.q == null ? 1 : o.q;
        osc.connect(bq); src = bq;
      }
      const g = this._out(o.pan, o.send);
      src.connect(g);
      this._env(g, t0, o.attack || 0.004, dur, o.gain == null ? 0.22 : o.gain, o.hold);
      osc.start(t0);
      osc.stop(t0 + (o.attack || 0.004) + (o.hold || 0) + dur + 0.06);
      this._track(osc);
    }

    /**
     * A struck voice: one oscillator bending another (FM), with the bend
     * dying away faster than the note. Low ratios ring like metal, a ratio
     * of 3.5 like glass, 2 like a bell.
     */
    bell(freq, o) {
      if (!this._ensure() || this.voices > this._cap()) return;
      o = o || {};
      const ctx = this.ctx;
      const t0 = this._now() + (o.delay || 0);
      const dur = o.dur || 0.4;
      const f = Math.max(20, freq * this._pv * (o.detune ? 1 + (Math.random() - 0.5) * o.detune : 1));
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
      car.frequency.setValueAtTime(f, t0);
      mod.frequency.setValueAtTime(f * (o.ratio || 2), t0);
      const index = f * (o.index == null ? 1 : o.index);
      mg.gain.setValueAtTime(index, t0);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.01, index * 0.05), t0 + dur * 0.6);
      mod.connect(mg); mg.connect(car.frequency);
      const g = this._out(o.pan, o.send == null ? 0.3 : o.send);
      car.connect(g);
      this._env(g, t0, o.attack || 0.002, dur, o.gain == null ? 0.08 : o.gain);
      const end = t0 + (o.attack || 0.002) + dur + 0.06;
      car.start(t0); mod.start(t0); car.stop(end); mod.stop(end);
      this._track(car);
    }

    /** A blow: a sine that drops in pitch as it dies, with a click on the front. */
    thump(freq, o) {
      if (!this._ensure() || this.voices > this._cap()) return;
      o = o || {};
      const t0 = this._now() + (o.delay || 0);
      const dur = o.dur || 0.2;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      const f = Math.max(30, freq * this._pv);
      osc.frequency.setValueAtTime(f * 2.4, t0);
      osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.018);
      osc.frequency.exponentialRampToValueAtTime(Math.max(25, f * 0.55), t0 + dur);
      const g = this._out(o.pan, o.send == null ? 0.2 : o.send);
      osc.connect(g);
      this._env(g, t0, 0.002, dur, o.gain == null ? 0.18 : o.gain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.06);
      this._track(osc);
    }

    /** One unpitched voice: air, impact, paper. */
    noise(o) {
      if (!this._ensure() || this.voices > this._cap()) return;
      o = o || {};
      const t0 = this._now() + (o.delay || 0);
      const dur = o.dur || 0.12;
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.playbackRate.value = o.rate || 1;
      const bq = this.ctx.createBiquadFilter();
      bq.type = o.filter || 'bandpass';
      bq.frequency.setValueAtTime(Math.max(40, (o.freq || 2000) * this._pv), t0);
      if (o.sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo * this._pv), t0 + dur);
      bq.Q.value = o.q == null ? 0.8 : o.q;
      s.connect(bq);
      const g = this._out(o.pan, o.send);
      bq.connect(g);
      this._env(g, t0, o.attack || 0.003, dur, o.gain == null ? 0.18 : o.gain, o.hold);
      // start somewhere different in the buffer each time, so no two bursts are the same
      s.start(t0, Math.random() * 0.5);
      s.stop(t0 + (o.attack || 0.003) + dur + (o.hold || 0) + 0.1);
      this._track(s);
    }

    chord(freqs, o) {
      o = o || {};
      freqs.forEach((f, i) => this.tone(f, Object.assign({}, o, {
        delay: (o.delay || 0) + i * (o.spread == null ? 0.03 : o.spread),
      })));
    }

    /* ---------------- named effects ---------------- */

    /**
     * `opt` carries what the table knows about the event:
     *   pan       -1..1, where the seat that did it sits
     *   intensity 0..1, how big it was (damage dealt, life swung, power)
     *   colors    ['W','U',...], the colours of the card it came from
     *   at        seconds from now to start, so a beat's sounds fall in order
     *   count     how many of it happened at once
     */
    play(name, opt) {
      opt = opt || {};
      const rec = { name, at: opt.at || 0, t: Math.round(performance.now()), pan: opt.pan, intensity: opt.intensity,
        played: false, why: opt.why || null };
      this.history.push(rec);
      if (this.history.length > 300) this.history.splice(0, 100);
      if (setting('muted')) { rec.skipped = 'muted'; return; }
      const fx = this.FX[name];
      if (!fx) { rec.skipped = 'unknown'; return; }
      const now = performance.now();
      const key = name + (opt.pan == null ? '' : opt.pan.toFixed(1)) + '@' + (opt.at || 0).toFixed(2);
      const last = this.lastPlay.get(key);
      // the same sound twice in one frame is one sound
      if (last && now - last < 32) { rec.skipped = 'repeat'; return; }
      this.lastPlay.set(key, now);
      if (this.lastPlay.size > 200) this.lastPlay.clear();
      if (!this._ensure()) { rec.skipped = 'no audio'; return; }
      // a context the browser has not let start yet would play all of this at once, later
      if (this.ctx.state !== 'running') { rec.skipped = 'locked'; return; }
      this._bus = UI_SOUNDS.has(name) ? 'ui' : 'game';
      this._t = this.ctx.currentTime + 0.005 + Math.max(0, opt.at || 0) + (opt.exact ? 0 : rnd(0, 0.012));
      this._pv = opt.exact ? 1 : 1 + rnd(-1, 1) * 0.025;
      this._trim = TRIM[name] || 1;
      try { fx.call(this, opt); rec.played = true; } catch (e) { /* never let sound break the game */ }
      finally { this._t = null; this._pv = 1; this._bus = 'game'; this._trim = 1; }
    }

    /* ---------------- the room ----------------
       A slow pad under the game: soft chords that drift in and out every
       few seconds over a faint room tone, quiet enough to forget about.
       It runs only while a table is open, and stops when the tab is
       hidden. */

    ambience(on) {
      this._ambWanted = !!on;
      this._ambTick();
    }

    _ambTick() {
      const want = this._ambWanted && setting('ambience') && !setting('muted') && setting('volAmb') > 0 &&
        !(typeof document !== 'undefined' && document.visibilityState === 'hidden');
      clearTimeout(this._ambTimer);
      if (!want) { this._ambStop(); return; }
      if (!this.ctx || this.ctx.state !== 'running') {
        // not allowed to make a sound yet: look again in a moment
        this._ambTimer = setTimeout(() => this._ambTick(), 1500);
        return;
      }
      if (!this._bed) this._ambBed();
      this._ambChord();
      this._ambTimer = setTimeout(() => this._ambTick(), rnd(5200, 7800));
    }

    _ambBed() {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.brownBuf; src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.4;
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 0.045; lg.gain.value = 120;
      lfo.connect(lg); lg.connect(lp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
      src.connect(lp); lp.connect(g); g.connect(this.buses.amb.dry);
      src.start(); lfo.start();
      this._bed = { src, lfo, g };
    }

    _ambStop() {
      const b = this._bed;
      if (!b || !this.ctx) return;
      this._bed = null;
      const t = this.ctx.currentTime;
      b.g.gain.cancelScheduledValues(t);
      b.g.gain.setTargetAtTime(0.0001, t, 0.6);
      b.src.stop(t + 3); b.lfo.stop(t + 3);
    }

    /** One chord of the pad, from a slow, unresolved progression. */
    _ambChord() {
      const PROG = [
        [146.8, 220, 261.6, 329.6],     // Dm9-ish
        [130.8, 196, 246.9, 329.6],     // Cmaj7
        [116.5, 174.6, 220, 293.7],     // Bbmaj7
        [130.8, 196, 233.1, 311.1],     // Cm7, for colour
      ];
      this._ambI = ((this._ambI == null ? -1 : this._ambI) + 1) % PROG.length;
      const notes = PROG[this._ambI];
      const ctx = this.ctx;
      const t0 = ctx.currentTime + 0.05;
      const bus = this.buses.amb;
      const dur = 9;
      notes.forEach((f, i) => {
        if (this.voices > this._cap() - 8) return;
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 650 + Math.random() * 400; lp.Q.value = 0.3;
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        lp.connect(g);
        if (p) { p.pan.value = rnd(-0.45, 0.45); g.connect(p); p.connect(bus.dry); } else g.connect(bus.dry);
        const ws = ctx.createGain(); ws.gain.value = 0.5; g.connect(ws); ws.connect(bus.wet);
        const peak = 0.026 * (i === 0 ? 1.2 : 1);
        const st = t0 + i * 0.35;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(peak, st + 2.6);
        g.gain.setValueAtTime(peak, st + 4.5);
        g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
        for (const [type, det] of [['triangle', 1], ['sine', 1.004]]) {
          const o = ctx.createOscillator();
          o.type = type; o.frequency.value = f * det;
          o.connect(lp); o.start(st); o.stop(st + dur + 0.1);
          this._track(o);
        }
      });
      // now and then a high glint, like light catching something on the table
      if (Math.random() < 0.35) {
        const was = this._bus; this._bus = 'amb';
        this._t = t0 + rnd(1.5, 4);
        this.bell(PROG[this._ambI][3] * 4, { ratio: 3.5, index: 0.3, dur: 2.2, gain: 0.012, send: 0.8, pan: rnd(-0.6, 0.6) });
        this._t = null; this._bus = was;
      }
    }

    /* ---------------- the stack building up ----------------
       While spells wait on top of spells, a low drone hangs under the table
       and climbs with each one, then lets go when the stack empties. */
    tension(depth) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const level = depth >= 2 ? Math.min(depth - 1, 4) : 0;
      if (level === this._tensionLevel) return;
      this._tensionLevel = level;
      const ctx = this.ctx, t = ctx.currentTime;
      if (level && !this._tension) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 3;
        const g = ctx.createGain(); g.gain.value = 0.0001;
        const duck = ctx.createGain(); duck.gain.value = 1;
        const trem = ctx.createGain(); trem.gain.value = 1;
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 2.2; lg.gain.value = 0.25;
        lfo.connect(lg); lg.connect(trem.gain);
        const oscs = [-7, 7, 0].map((c, i) => {
          const o = ctx.createOscillator();
          o.type = i < 2 ? 'sawtooth' : 'sine';
          o.frequency.value = i < 2 ? 73.4 : 36.7;
          o.detune.value = c;
          o.connect(lp); o.start();
          return o;
        });
        lp.connect(trem); trem.connect(g); g.connect(duck); duck.connect(this.buses.game.dry);
        const ws = ctx.createGain(); ws.gain.value = 0.3; duck.connect(ws); ws.connect(this.buses.game.wet);
        lfo.start();
        this._tension = { oscs, lfo, lp, g, duck };
      }
      const T = this._tension;
      if (!T) return;
      if (level) {
        const up = Math.pow(2, (level - 1) * 3 / 12);
        T.oscs.forEach((o, i) => o.frequency.setTargetAtTime((i < 2 ? 73.4 : 36.7) * up, t, 0.3));
        T.lp.frequency.setTargetAtTime(200 + level * 110, t, 0.3);
        T.lfo.frequency.setTargetAtTime(2.2 + level * 0.8, t, 0.3);
        T.g.gain.cancelScheduledValues(t);
        T.g.gain.setTargetAtTime(0.022 + level * 0.012, t, 0.35);
      } else {
        this._tension = null;
        T.g.gain.cancelScheduledValues(t);
        T.g.gain.setTargetAtTime(0.0001, t, 0.25);
        const end = t + 1.5;
        T.oscs.forEach(o => o.stop(end)); T.lfo.stop(end);
      }
    }

    /** Everything that hums, let go: the table has closed. */
    quiet() {
      this.ambience(false);
      this._tensionLevel = -1;
      this.tension(0);
      this._tensionLevel = 0;
    }
  }

  /* Loudness and brightness scale with how big the event was. */
  const big = (o) => clamp(o.intensity || 0, 0, 1);

  /* Bring a note into a register, by octaves, so palettes can be reused high or low. */
  const into = (f, lo, hi) => { while (f < lo) f *= 2; while (f > hi) f /= 2; return f; };

  Audio.prototype.FX = {
    /* ---- cards in hand ---- */
    /** A card sliding off the top: paper on felt. */
    draw(o) {
      const q = o.quiet ? 0.5 : 1;
      this.noise({ filter: 'bandpass', freq: 2700, sweepTo: 1100, dur: 0.11, gain: 0.11 * q, q: 0.9, rate: 1.25, attack: 0.012, pan: o.pan, send: 0.08 });
      this.noise({ filter: 'highpass', freq: 5200, dur: 0.025, gain: 0.035 * q, delay: 0.075, pan: o.pan, send: 0 });
    },
    /** Several cards at once, dealt rather than drawn. */
    deal(o) {
      const n = clamp(o.count || 5, 3, 7);
      for (let i = 0; i < n; i++) {
        this.noise({ filter: 'bandpass', freq: 2500 + Math.random() * 900, sweepTo: 1200, dur: 0.07, gain: 0.07, q: 1,
          rate: 1.3, delay: i * 0.06 + Math.random() * 0.01, pan: o.pan, send: 0.06 });
      }
      this.noise({ filter: 'lowpass', freq: 500, dur: 0.08, gain: 0.05, delay: n * 0.06, pan: o.pan });
    },
    play_card(o) {
      this.noise({ filter: 'lowpass', freq: 2800, sweepTo: 520, dur: 0.09, gain: 0.16, rate: 1.1, pan: o.pan, send: 0.14 });
      this.thump(170, { dur: 0.09, gain: 0.09, delay: 0.015, pan: o.pan });
    },
    /** A land going down: weight, and a hint of what kind of place it is. */
    land(o) {
      this.thump(74, { dur: 0.24, gain: 0.2, pan: o.pan, send: 0.22 });
      this.noise({ filter: 'lowpass', freq: 420, dur: 0.15, gain: 0.12, pan: o.pan, send: 0.2 });
      const p = pal(o)[0];
      switch (p.key) {
        case 'W': this.bell(1760, { ratio: 2, index: 0.5, dur: 0.6, gain: 0.022, delay: 0.03, pan: o.pan, send: 0.5 }); break;
        case 'U': this.bell(1318.5, { ratio: 3.5, index: 0.6, dur: 0.6, gain: 0.026, delay: 0.03, pan: o.pan, send: 0.5 }); break;
        case 'B': this.tone(98, { type: 'sawtooth', filter: 'lowpass', filterFreq: 360, dur: 0.5, gain: 0.05, attack: 0.02, pan: o.pan, send: 0.3 }); break;
        case 'R':
          for (let i = 0; i < 3; i++) this.noise({ filter: 'highpass', freq: 3500, dur: 0.02, gain: 0.04, delay: 0.03 + i * 0.045 + Math.random() * 0.02, pan: o.pan, send: 0.1 });
          this.tone(330, { type: 'triangle', dur: 0.2, gain: 0.025, delay: 0.02, pan: o.pan }); break;
        case 'G':
          this.tone(196, { type: 'triangle', dur: 0.32, gain: 0.05, delay: 0.02, pan: o.pan, send: 0.3 });
          this.noise({ filter: 'bandpass', freq: 900, q: 4, dur: 0.05, gain: 0.06, delay: 0.01, pan: o.pan }); break;
        default: this.bell(1046.5, { ratio: 1.41, index: 0.5, dur: 0.4, gain: 0.02, delay: 0.03, pan: o.pan, send: 0.4 });
      }
    },
    shuffle(o) {
      for (let i = 0; i < 9; i++) {
        this.noise({ filter: 'bandpass', freq: 2000 + Math.random() * 2200, dur: 0.045,
          gain: 0.07, delay: i * 0.042 + Math.random() * 0.012, rate: 1.5, pan: o.pan, send: 0.08 });
      }
    },
    discard(o) {
      this.noise({ filter: 'bandpass', freq: 1600, sweepTo: 400, dur: 0.14, gain: 0.13, rate: 0.9, pan: o.pan, send: 0.2 });
      this.tone(140, { type: 'sine', slideTo: 90, dur: 0.13, gain: 0.07, pan: o.pan });
    },
    /** Cards off the top of a library straight into a graveyard. */
    mill(o) {
      const n = clamp(o.count || 2, 2, 5);
      for (let i = 0; i < n; i++) this.noise({ filter: 'bandpass', freq: 1800 + Math.random() * 600, sweepTo: 700, dur: 0.07, gain: 0.07, delay: i * 0.05, pan: o.pan, send: 0.12 });
      this.thump(120, { dur: 0.1, gain: 0.05, delay: n * 0.05, pan: o.pan });
    },

    /* ---- tapping and mana ---- */
    tap(o) {
      this.noise({ filter: 'bandpass', freq: 1800, q: 3, dur: 0.03, gain: 0.07, pan: o.pan, send: 0.06 });
      this.tone(420, { type: 'triangle', dur: 0.04, gain: 0.035, pan: o.pan, detune: 0.08 });
    },
    untap(o) {
      this.tone(880, { type: 'triangle', dur: 0.04, gain: 0.03, pan: o.pan, detune: 0.08 });
      this.noise({ filter: 'highpass', freq: 4000, dur: 0.02, gain: 0.03, pan: o.pan, send: 0.05 });
    },
    untap_all(o) {
      [587.3, 740, 880].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.07, gain: 0.035, delay: i * 0.045, pan: o.pan, send: 0.25 }));
      this.noise({ filter: 'bandpass', freq: 1500, sweepTo: 3500, dur: 0.16, gain: 0.03, pan: o.pan, send: 0.2 });
    },
    /** A little crystal tick per land, in the colour of what it made. */
    mana(o) {
      const cs = (o.colors && o.colors.length ? o.colors : ['C']);
      const n = clamp(o.count || 1, 1, 4);
      for (let i = 0; i < n; i++) {
        const p = PALETTE[cs[i % cs.length]] || PALETTE.C;
        this.bell(p.mana, { ratio: 4, index: 0.45, dur: 0.16, gain: 0.03, delay: i * 0.05, pan: o.pan, send: 0.3 });
      }
    },

    /* ---- the stack ---- */
    /** A spell leaving the hand: a rush of air, and its colours rising out of it. */
    cast(o) {
      const b = clamp(o.intensity == null ? 0.3 : o.intensity, 0, 1);
      const k = o.copy ? 0.6 : 1;
      this.noise({ filter: 'bandpass', freq: 520, sweepTo: 3800, dur: 0.34 + b * 0.14, attack: 0.09, gain: (0.07 + b * 0.05) * k, q: 0.7, pan: o.pan, send: 0.34 });
      pal(o).forEach((p, j) => {
        const g = (j ? 0.6 : 1) * k;
        p.notes.slice(0, 3).forEach((f, i) => {
          const d = 0.06 + i * 0.05 + j * 0.022;
          if (p.bell) this.bell(into(f, 600, 2000), { ratio: p.bell, index: 0.7, dur: 0.38, gain: 0.04 * g, delay: d, pan: o.pan, send: 0.45 });
          else this.tone(f, { type: p.wave, dur: 0.24, gain: (p.wave === 'sawtooth' ? 0.04 : 0.045) * g, attack: 0.012, delay: d,
            filter: p.wave === 'sawtooth' ? 'lowpass' : null, filterFreq: 1700, pan: o.pan, send: 0.4 });
        });
        if (p.key === 'R') for (let i = 0; i < 4; i++) this.noise({ filter: 'highpass', freq: 3200, dur: 0.018, gain: 0.04 * g, delay: 0.05 + Math.random() * 0.22, pan: o.pan, send: 0.1 });
        if (p.key === 'B') this.tone(98, { type: 'sawtooth', filter: 'lowpass', filterFreq: 300, dur: 0.45, attack: 0.05, gain: 0.05 * g, pan: o.pan, send: 0.3 });
        if (p.key === 'G') this.noise({ filter: 'bandpass', freq: 800, q: 5, dur: 0.05, gain: 0.05 * g, delay: 0.06, pan: o.pan });
        if (p.key === 'W') this.tone(2637, { dur: 0.3, gain: 0.014 * g, attack: 0.05, delay: 0.12, pan: o.pan, send: 0.6 });
      });
    },
    /** It happened: a bright strike in the spell's colour. */
    resolve(o) {
      const p = pal(o)[0];
      const root = into(p.notes[1] || 880, 620, 1320);
      const g = o.ability ? 0.55 : 1;
      this.bell(root, { ratio: 2, index: 0.9, dur: 0.55, gain: 0.06 * g, pan: o.pan, send: 0.45 });
      if (!o.ability) {
        this.tone(root * 1.5, { dur: 0.35, gain: 0.028, delay: 0.035, pan: o.pan, send: 0.45 });
        this.noise({ filter: 'lowpass', freq: 700, dur: 0.12, gain: 0.04, pan: o.pan, send: 0.3 });
      }
    },
    /** No: the spell bent down to nothing and cracked. */
    counter(o) {
      this.dip(0.3, 0.5);
      this.tone(660, { type: 'sawtooth', slideTo: 110, dur: 0.45, gain: 0.08, filter: 'lowpass', filterFreq: 2000, filterTo: 240, pan: o.pan, send: 0.35 });
      this.tone(990, { type: 'sawtooth', slideTo: 165, dur: 0.42, gain: 0.04, delay: 0.02, filter: 'lowpass', filterFreq: 2200, filterTo: 260, pan: o.pan, send: 0.35 });
      this.noise({ filter: 'highpass', freq: 3000, dur: 0.05, gain: 0.08, pan: o.pan, send: 0.2 });
      this.bell(2200, { ratio: 1.41, index: 3, dur: 0.25, gain: 0.03, pan: o.pan, send: 0.4 });
      this.noise({ filter: 'bandpass', freq: 1800, sweepTo: 300, dur: 0.4, gain: 0.05, delay: 0.05, pan: o.pan, send: 0.5 });
    },
    trigger(o) {
      this.bell(1174.7, { ratio: 3, index: 0.7, dur: 0.25, gain: 0.045, pan: o.pan, send: 0.35 });
      this.bell(1568, { ratio: 3, index: 0.5, dur: 0.3, gain: 0.035, delay: 0.06, pan: o.pan, send: 0.35 });
    },
    /** Something on the table being used: a catch, and a turn. */
    activate(o) {
      this.noise({ filter: 'highpass', freq: 3500, dur: 0.02, gain: 0.06, pan: o.pan, send: 0.08 });
      this.tone(520, { slideTo: 800, dur: 0.11, gain: 0.045, delay: 0.015, pan: o.pan, send: 0.3 });
      this.bell(1046.5, { ratio: 2, index: 0.4, dur: 0.22, gain: 0.025, delay: 0.06, pan: o.pan, send: 0.35 });
    },
    target(o) { this.tone(1500, { type: 'sine', slideTo: 2200, dur: 0.06, gain: 0.04, pan: o.pan, send: 0.2 }); },

    /* ---- things arriving ---- */
    /** A creature landing, as heavy as it is strong. */
    enter(o) {
      const w = big(o);
      if (w > 0.5) this.dip(0.1 + w * 0.3, 0.3);
      this.thump(96 - w * 42, { dur: 0.2 + w * 0.25, gain: 0.13 + w * 0.13, pan: o.pan, send: 0.26 });
      this.noise({ filter: 'lowpass', freq: 950 - w * 400, sweepTo: 120, dur: 0.16 + w * 0.2, gain: 0.07 + w * 0.09, pan: o.pan, send: 0.25 });
      if (w > 0.6) this.tone(46, { type: 'sawtooth', filter: 'lowpass', filterFreq: 180, dur: 0.5, gain: 0.06, pan: o.pan, send: 0.3 });
      const p = pal(o)[0];
      this.bell(into(p.notes[0], 300, 700), { ratio: p.bell || 2, index: 0.5, dur: 0.3, gain: 0.02, delay: 0.01, pan: o.pan, send: 0.35 });
    },
    /** Anything else settling onto the table: an artifact, an enchantment. */
    settle(o) {
      this.thump(150, { dur: 0.12, gain: 0.08, pan: o.pan, send: 0.2 });
      const p = pal(o)[0];
      this.bell(into(p.notes[2] || 1046, 800, 1600), { ratio: p.bell || 2, index: 0.6, dur: 0.4, gain: 0.03, delay: 0.02, pan: o.pan, send: 0.45 });
    },
    token(o) {
      const n = clamp(o.count || 1, 1, 3);
      for (let i = 0; i < n; i++) {
        const d = i * 0.07;
        this.tone(520, { slideTo: 1040, dur: 0.08, gain: 0.06, delay: d, pan: o.pan, send: 0.3 });
        this.noise({ filter: 'bandpass', freq: 2500, q: 2, dur: 0.04, gain: 0.045, delay: d, pan: o.pan, send: 0.15 });
        this.bell(1568, { ratio: 2, index: 0.4, dur: 0.2, gain: 0.02, delay: d + 0.05, pan: o.pan, send: 0.4 });
      }
    },
    blink(o) {
      this.tone(980, { type: 'sine', slideTo: 1960, dur: 0.07, gain: 0.06, pan: o.pan, send: 0.4 });
      this.tone(1960, { type: 'sine', slideTo: 980, dur: 0.09, gain: 0.05, delay: 0.07, pan: o.pan, send: 0.4 });
    },
    /** A card going back where it came from. */
    bounce(o) {
      this.noise({ filter: 'bandpass', freq: 600, sweepTo: 2400, dur: 0.2, attack: 0.04, gain: 0.06, pan: o.pan, send: 0.25 });
      this.tone(392, { slideTo: 784, dur: 0.15, gain: 0.035, pan: o.pan, send: 0.3 });
    },
    steal(o) {
      this.noise({ filter: 'bandpass', freq: 700, sweepTo: 2600, dur: 0.3, attack: 0.06, gain: 0.06, q: 1.5, pan: o.pan, send: 0.3 });
      this.tone(330, { type: 'triangle', slideTo: 660, dur: 0.25, gain: 0.04, pan: o.pan, send: 0.35 });
      this.tone(311, { type: 'triangle', slideTo: 622, dur: 0.25, gain: 0.03, delay: 0.02, pan: o.pan, send: 0.35 });
    },
    transform(o) {
      this.noise({ filter: 'bandpass', freq: 900, sweepTo: 3200, dur: 0.22, attack: 0.05, gain: 0.05, pan: o.pan, send: 0.3 });
      this.bell(880, { ratio: 1.41, index: 1.2, dur: 0.4, gain: 0.04, delay: 0.12, pan: o.pan, send: 0.45 });
    },

    /* ---- combat ---- */
    /** War drums: two blows, three for a big attack. */
    attack(o) {
      const n = big(o) > 0.5 ? 3 : 2;
      this.dip(0.2, 0.5);
      for (let i = 0; i < n; i++) {
        this.thump(112 - i * 9, { dur: 0.24, gain: 0.15 - i * 0.015, delay: i * 0.13, pan: o.pan, send: 0.32 });
        this.noise({ filter: 'lowpass', freq: 520, dur: 0.08, gain: 0.06, delay: i * 0.13, pan: o.pan, send: 0.2 });
      }
      this.noise({ filter: 'bandpass', freq: 800, sweepTo: 3000, dur: 0.26, attack: 0.1, gain: 0.04, delay: 0.05, pan: o.pan, send: 0.3 });
    },
    /** A shield coming up: a ring of metal over a knock. */
    block(o) {
      this.bell(620, { ratio: 1.41, index: 2.4, dur: 0.36, gain: 0.06, pan: o.pan, send: 0.35 });
      this.noise({ filter: 'bandpass', freq: 1200, q: 3, dur: 0.08, gain: 0.09, pan: o.pan, send: 0.2 });
      this.thump(140, { dur: 0.1, gain: 0.1, pan: o.pan });
    },
    /** A blow landing, as hard as the damage it did. */
    hit(o) {
      const b = big(o);
      if (b > 0.5) this.dip(0.2 + b * 0.3, 0.35);
      this.thump(86 - b * 34, { dur: 0.14 + b * 0.22, gain: 0.13 + b * 0.13, pan: o.pan, send: 0.24 });
      this.noise({ filter: 'bandpass', freq: 2300 - b * 1000, q: 1.2, dur: 0.05, gain: 0.09 + b * 0.08, pan: o.pan, send: 0.15 });
      this.noise({ filter: 'lowpass', freq: 1200, sweepTo: 150, dur: 0.15 + b * 0.2, gain: 0.07 + b * 0.08, rate: 0.9 - b * 0.2, pan: o.pan, send: 0.28 });
    },
    damage(o) { this.FX.hit.call(this, o); },
    /** Damage from a spell: a crackle rather than a blow. */
    burn(o) {
      const b = big(o);
      this.noise({ filter: 'highpass', freq: 2500, sweepTo: 6000, dur: 0.18, gain: 0.06 + b * 0.04, pan: o.pan, send: 0.25 });
      this.tone(880, { type: 'sawtooth', slideTo: 220, dur: 0.22, gain: 0.035 + b * 0.02, filter: 'lowpass', filterFreq: 2600, pan: o.pan, send: 0.3 });
      this.thump(110 - b * 30, { dur: 0.14 + b * 0.12, gain: 0.08 + b * 0.08, delay: 0.03, pan: o.pan });
    },
    /** A creature dying: it comes apart like glass, and falls. */
    die(o) {
      const b = big(o);
      this.dip(0.2, 0.4);
      for (let i = 0; i < 6; i++) {
        this.noise({ filter: 'bandpass', freq: rnd(3000, 7000), q: 6, dur: rnd(0.04, 0.09), gain: rnd(0.035, 0.055),
          delay: rnd(0, 0.12), pan: o.pan == null ? null : clamp(o.pan + rnd(-0.2, 0.2), -1, 1), send: 0.3 });
      }
      this.thump(72 - b * 16, { dur: 0.3, gain: 0.11 + b * 0.05, pan: o.pan, send: 0.3 });
      this.tone(330, { type: 'triangle', slideTo: 110, dur: 0.42, gain: 0.035, delay: 0.04, pan: o.pan, send: 0.45 });
    },
    destroy(o) {
      this.dip(0.2, 0.34);
      this.noise({ filter: 'lowpass', freq: 1500, sweepTo: 150, dur: 0.3, gain: 0.14, rate: 0.7, pan: o.pan, send: 0.4 });
      this.thump(90, { dur: 0.25, gain: 0.09, pan: o.pan });
    },
    wipe(o) {
      this.dip(0.6, 1.2);
      this.noise({ filter: 'lowpass', freq: 2600, sweepTo: 90, dur: 1, gain: 0.22, rate: 0.5, send: 0.7 });
      for (let i = 0; i < 10; i++) this.noise({ filter: 'bandpass', freq: rnd(2500, 7000), q: 6, dur: rnd(0.04, 0.1), gain: 0.045, delay: rnd(0, 0.4), pan: rnd(-0.7, 0.7), send: 0.4 });
      [220, 165, 110, 82].forEach((f, i) => this.tone(f, { type: 'sawtooth', slideTo: f * 0.4, dur: 0.75,
        gain: 0.06, delay: i * 0.05, filter: 'lowpass', filterFreq: 900, send: 0.7 }));
    },
    /** Gone from the game: drawn up into the air. */
    exile(o) {
      this.noise({ filter: 'highpass', freq: 1500, sweepTo: 7000, dur: 0.45, attack: 0.08, gain: 0.055, pan: o.pan, send: 0.6 });
      this.tone(660, { slideTo: 1980, dur: 0.4, gain: 0.035, attack: 0.03, pan: o.pan, send: 0.6 });
      this.bell(2637, { ratio: 2, index: 0.3, dur: 0.6, gain: 0.018, delay: 0.2, pan: o.pan, send: 0.7 });
    },

    /* ---- life and counters ---- */
    /** Bright, rising, and longer the more it was. */
    life_gain(o) {
      const n = 3 + Math.round(big(o) * 2);
      const notes = [784, 987.8, 1174.7, 1318.5, 1568];
      for (let i = 0; i < n; i++) {
        this.tone(notes[i], { dur: 0.16, gain: 0.05 + i * 0.006, delay: i * 0.05, pan: o.pan, send: 0.42 });
        this.tone(notes[i] * 2, { type: 'triangle', dur: 0.1, gain: 0.012, delay: i * 0.05 + 0.01, pan: o.pan, send: 0.5 });
      }
      this.noise({ filter: 'highpass', freq: 6000, dur: 0.4, attack: 0.1, gain: 0.015, pan: o.pan, send: 0.6 });
    },
    /** Dull and falling: it should land, and a big loss should land harder. */
    life_loss(o) {
      const b = big(o);
      if (b > 0.4) this.dip(0.16 + b * 0.2, 0.3);
      this.tone(220, { slideTo: 165, dur: 0.3 + b * 0.2, gain: 0.07 + 0.05 * b, filter: 'lowpass', filterFreq: 600, pan: o.pan, send: 0.3 });
      this.tone(207.7, { slideTo: 155.6, dur: 0.3 + b * 0.2, gain: 0.045, delay: 0.06, filter: 'lowpass', filterFreq: 500, pan: o.pan, send: 0.3 });
      this.thump(72 - 20 * b, { dur: 0.3, gain: 0.08 + 0.1 * b, pan: o.pan, send: 0.25 });
    },
    counter_add(o) {
      this.bell(1046.5, { ratio: 2, index: 0.6, dur: 0.15, gain: 0.04, pan: o.pan, send: 0.3 });
      this.bell(1568, { ratio: 2, index: 0.5, dur: 0.18, gain: 0.035, delay: 0.05, pan: o.pan, send: 0.3 });
    },
    counter_remove(o) {
      this.bell(1568, { ratio: 2, index: 0.5, dur: 0.15, gain: 0.035, pan: o.pan, send: 0.3 });
      this.bell(1046.5, { ratio: 2, index: 0.6, dur: 0.18, gain: 0.035, delay: 0.05, pan: o.pan, send: 0.3 });
    },
    poison(o) {
      this.tone(196, { type: 'sawtooth', dur: 0.32, gain: 0.03, filter: 'lowpass', filterFreq: 500, detune: 0.03, pan: o.pan, send: 0.3 });
      this.tone(185, { type: 'sawtooth', dur: 0.32, gain: 0.03, filter: 'lowpass', filterFreq: 500, pan: o.pan, send: 0.3 });
      this.tone(300, { slideTo: 620, dur: 0.06, gain: 0.04, delay: 0.12, pan: o.pan });
      this.tone(320, { slideTo: 700, dur: 0.06, gain: 0.03, delay: 0.2, pan: o.pan });
    },
    scry(o) {
      this.tone(1320, { type: 'sine', slideTo: 1760, dur: 0.1, gain: 0.05, pan: o.pan, send: 0.35 });
      this.tone(1760, { type: 'sine', slideTo: 1320, dur: 0.12, gain: 0.04, delay: 0.09, pan: o.pan, send: 0.35 });
    },
    crown(o) { [659, 880, 1047, 1319].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.14, gain: 0.065, delay: i * 0.055, pan: o.pan, send: 0.45 })); },
    daynight(o) { this.tone(300, { type: 'sine', slideTo: 620, dur: 0.4, gain: 0.06, send: 0.5 }); },
    undo(o) { this.tone(540, { type: 'sine', slideTo: 330, dur: 0.13, gain: 0.06, send: 0.2 }); },
    dice(o) {
      for (let i = 0; i < 5; i++) this.noise({ filter: 'bandpass', freq: rnd(1800, 3200), q: 4, dur: 0.03, gain: 0.07 - i * 0.01, delay: i * 0.07 + rnd(0, 0.03), pan: o.pan, send: 0.15 });
    },
    coin(o) {
      this.bell(2637, { ratio: 1.41, index: 1.5, dur: 0.5, gain: 0.04, pan: o.pan, send: 0.4 });
      this.bell(2793, { ratio: 1.41, index: 1.2, dur: 0.4, gain: 0.025, delay: 0.25, pan: o.pan, send: 0.4 });
    },

    /* ---- the shape of the turn ---- */
    phase(o) { this.tone(430, { type: 'sine', dur: 0.055, gain: 0.03, send: 0.25 }); },
    step(o) { this.tone(560, { type: 'sine', dur: 0.04, gain: 0.02, send: 0.2 }); },
    /** Your turn: a short brass call, rising. */
    turn_mine(o) {
      this.chord([392, 493.9, 587.3], { type: 'sawtooth', filter: 'lowpass', filterFreq: 1700, attack: 0.03, dur: 0.38, gain: 0.03, spread: 0.07, send: 0.45 });
      this.tone(784, { type: 'triangle', dur: 0.55, attack: 0.02, gain: 0.045, delay: 0.21, send: 0.5 });
      this.tone(196, { dur: 0.5, gain: 0.05, attack: 0.03, send: 0.3 });
      this.noise({ filter: 'lowpass', freq: 600, dur: 0.35, attack: 0.1, gain: 0.03, send: 0.5 });
    },
    /** Somebody else's turn: the same call, lower and quieter. */
    turn_theirs(o) {
      this.tone(293.7, { type: 'triangle', dur: 0.3, attack: 0.02, gain: 0.04, pan: o.pan, send: 0.45 });
      this.tone(220, { type: 'triangle', dur: 0.4, attack: 0.02, gain: 0.04, delay: 0.12, pan: o.pan, send: 0.45 });
      this.tone(110, { dur: 0.4, gain: 0.03, attack: 0.03, pan: o.pan, send: 0.3 });
    },
    turn_start(o) { this.FX.turn_mine.call(this, o); },
    /** It is you the table is waiting for: one soft ping. */
    priority(o) {
      this.bell(1318.5, { ratio: 2, index: 0.35, dur: 0.32, gain: 0.04, send: 0.4 });
      this.tone(1975.5, { dur: 0.12, gain: 0.012, delay: 0.03, send: 0.4 });
    },
    /** A question for you: two notes, the second higher, like a raised eyebrow. */
    choice(o) {
      this.tone(659.3, { dur: 0.12, gain: 0.045, send: 0.4 });
      this.tone(987.8, { dur: 0.2, gain: 0.04, delay: 0.09, send: 0.45 });
    },

    /* ---- the end ---- */
    win(o) {
      this.dip(0.5, 2);
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, { type: 'sawtooth', filter: 'lowpass', filterFreq: 2200, attack: 0.02, dur: 0.5, gain: 0.04, delay: i * 0.11, send: 0.6 }));
      [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.6, gain: 0.06, delay: i * 0.11, send: 0.6 }));
      this.chord([1046.5, 1318.5, 1568], { type: 'triangle', dur: 1.2, attack: 0.05, gain: 0.035, spread: 0.02, delay: 0.46, send: 0.7 });
      this.thump(65, { dur: 0.6, gain: 0.14, delay: 0.44 });
      this.noise({ filter: 'highpass', freq: 5000, dur: 1, attack: 0.3, gain: 0.02, delay: 0.4, send: 0.8 });
    },
    lose(o) {
      this.dip(0.5, 2);
      [392, 349.2, 311.1, 261.6].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.5, gain: 0.07, delay: i * 0.16, send: 0.6 }));
      this.tone(65.4, { type: 'sawtooth', filter: 'lowpass', filterFreq: 200, attack: 0.2, dur: 1.4, gain: 0.07, delay: 0.3, send: 0.5 });
      this.thump(55, { dur: 0.8, gain: 0.1, delay: 0.62 });
    },
    /** Someone else is out of the game: a low gong. */
    eliminated(o) {
      this.dip(0.3, 1);
      this.bell(98, { ratio: 1.41, index: 3, dur: 1.6, gain: 0.08, pan: o.pan, send: 0.6 });
      this.noise({ filter: 'lowpass', freq: 300, dur: 0.6, gain: 0.05, pan: o.pan, send: 0.5 });
    },

    /* ---- the interface ---- */
    hover(o) {
      this.tone(2300 * (o.pitch || 1), { dur: 0.016, gain: 0.012, send: 0.05, pan: o.pan });
      this.noise({ filter: 'highpass', freq: 6500, dur: 0.012, gain: 0.01, send: 0, pan: o.pan });
    },
    click(o) { this.noise({ filter: 'highpass', freq: 4500, dur: 0.018, gain: 0.06, rate: 2, send: 0.05 }); },
    confirm(o) {
      this.tone(880, { dur: 0.06, gain: 0.04, send: 0.2 });
      this.tone(1174.7, { dur: 0.09, gain: 0.04, delay: 0.05, send: 0.25 });
    },
    cancel(o) {
      this.tone(784, { dur: 0.06, gain: 0.035, send: 0.2 });
      this.tone(587.3, { dur: 0.09, gain: 0.035, delay: 0.05, send: 0.2 });
    },
    error(o) {
      this.tone(196, { type: 'square', dur: 0.08, gain: 0.07, filter: 'lowpass', filterFreq: 1000 });
      this.tone(147, { type: 'square', dur: 0.11, gain: 0.07, delay: 0.08, filter: 'lowpass', filterFreq: 900 });
    },
    /** A softer no, for a card dropped where it cannot go. */
    reject(o) {
      this.tone(233, { type: 'triangle', dur: 0.07, gain: 0.06, filter: 'lowpass', filterFreq: 900 });
      this.tone(185, { type: 'triangle', dur: 0.1, gain: 0.06, delay: 0.07, filter: 'lowpass', filterFreq: 800 });
      this.noise({ filter: 'bandpass', freq: 1400, sweepTo: 600, dur: 0.12, gain: 0.04, delay: 0.04, send: 0.1 });
    },
    /** A card lifted out of the hand. */
    pickup(o) { this.noise({ filter: 'bandpass', freq: 2000, sweepTo: 3600, dur: 0.07, gain: 0.05, attack: 0.02, rate: 1.3, pan: o.pan, send: 0.05 }); },
    /** You chose to play something: the snap of it leaving your fingers. The table answers with the real sound. */
    ui_play(o) {
      this.noise({ filter: 'bandpass', freq: 3000, q: 1.5, dur: 0.03, gain: 0.06, send: 0.05 });
      this.thump(210, { dur: 0.05, gain: 0.05 });
    },
    /** Picking an attacker or a blocker, before anything is declared. */
    ui_attack(o) {
      this.thump(150, { dur: 0.1, gain: 0.07 });
      this.noise({ filter: 'bandpass', freq: 1100, sweepTo: 2600, dur: 0.1, gain: 0.035, attack: 0.03, send: 0.1 });
    },
    ui_block(o) {
      this.bell(740, { ratio: 1.41, index: 1.4, dur: 0.18, gain: 0.035, send: 0.2 });
      this.thump(170, { dur: 0.07, gain: 0.05 });
    },
    notify(o) { this.chord([880, 1174], { type: 'sine', dur: 0.15, gain: 0.08, spread: 0.065, send: 0.4 }); },
    pack_open(o) {
      this.noise({ filter: 'bandpass', freq: 3400, sweepTo: 1100, dur: 0.32, gain: 0.17, rate: 0.85, q: 0.5, send: 0.4 });
      this.chord([660, 880, 1320], { type: 'sine', dur: 0.28, gain: 0.065, spread: 0.075, delay: 0.14, send: 0.5 });
    },
    pick(o) { this.tone(720, { type: 'sine', slideTo: 1150, dur: 0.11, gain: 0.09, send: 0.3 }); },

    /* ---- the Store and opening packs ---- */
    /** A booster picked up and turned in the hand: foil crinkle. */
    pack_shake(o) {
      this.noise({ filter: 'bandpass', freq: 5200, q: 0.7, dur: 0.16, gain: 0.05, rate: 1.6, send: 0.15 });
      this.noise({ filter: 'bandpass', freq: 3600, q: 0.9, dur: 0.12, gain: 0.04, rate: 1.4, delay: 0.09, send: 0.15 });
    },
    /** The foil torn along the top, and the air of the pack opening. */
    pack_tear(o) {
      this.dip(0.3, 0.8);
      this.noise({ filter: 'bandpass', freq: 4200, sweepTo: 1200, q: 0.6, dur: 0.38, gain: 0.2, rate: 0.9, attack: 0.01, send: 0.3 });
      this.noise({ filter: 'highpass', freq: 6000, dur: 0.25, gain: 0.06, delay: 0.05, send: 0.2 });
      this.thump(120, { dur: 0.25, gain: 0.1, delay: 0.3 });
      this.chord([523.3, 784, 1046.5, 1568], { type: 'sine', dur: 0.6, attack: 0.04, gain: 0.05, spread: 0.06, delay: 0.32, send: 0.6 });
    },
    /** One card turned face up; the pitch climbs as the pack goes on. */
    card_flip(o) {
      const k = 1 + Math.min(12, o.index || 0) * 0.045;
      this.noise({ filter: 'bandpass', freq: 2600 * k, q: 1.1, dur: 0.05, gain: 0.07, rate: 1.4, send: 0.1 });
      this.tone(620 * k, { type: 'triangle', dur: 0.07, gain: 0.025, delay: 0.015, send: 0.25 });
    },
    /** A rare turned over: a gold chime with a little sparkle. */
    reveal_rare(o) {
      this.dip(0.25, 1);
      this.chord([659.3, 987.8, 1318.5, 1975.5], { type: 'triangle', dur: 0.7, attack: 0.01, gain: 0.06, spread: 0.05, send: 0.65 });
      this.bell(1318.5, { ratio: 2.76, index: 1.5, dur: 1.1, gain: 0.04, delay: 0.18, send: 0.7 });
      this.noise({ filter: 'highpass', freq: 7000, dur: 0.6, attack: 0.08, gain: 0.03, delay: 0.1, send: 0.8 });
      this.thump(90, { dur: 0.3, gain: 0.08 });
    },
    /** A mythic: a bigger, brassier swell, and a long shimmer. */
    reveal_mythic(o) {
      this.dip(0.4, 1.6);
      this.thump(70, { dur: 0.5, gain: 0.13 });
      [392, 523.3, 659.3, 784].forEach((f, i) => this.tone(f, { type: 'sawtooth', filter: 'lowpass', filterFreq: 2400, attack: 0.03, dur: 0.9, gain: 0.035, delay: i * 0.07, send: 0.65 }));
      this.chord([1046.5, 1318.5, 1568, 2093], { type: 'triangle', dur: 1.4, attack: 0.08, gain: 0.04, spread: 0.06, delay: 0.3, send: 0.8 });
      this.bell(2093, { ratio: 2.76, index: 2, dur: 1.6, gain: 0.035, delay: 0.45, send: 0.8 });
      this.noise({ filter: 'highpass', freq: 6500, dur: 1.4, attack: 0.3, gain: 0.035, delay: 0.2, send: 0.9 });
    },
    /** A card the collection did not have yet. */
    new_card(o) { this.chord([1318.5, 1760], { type: 'sine', dur: 0.12, gain: 0.04, spread: 0.05, send: 0.4 }); },
    /** A wildcard: a bright two-tone ping. */
    wildcard(o) {
      this.bell(1174.7, { ratio: 1.5, index: 1.2, dur: 0.6, gain: 0.05, send: 0.6 });
      this.tone(1760, { type: 'sine', dur: 0.3, gain: 0.03, delay: 0.08, send: 0.6 });
    },
    /** Shards coming in: crystals tinkling, more of them for more Shards. */
    shards(o) {
      const n = Math.max(3, Math.min(10, Math.round(3 + (o.intensity || 0.3) * 7)));
      for (let i = 0; i < n; i++) {
        const f = [1568, 1760, 2093, 2349, 2637, 3136][Math.floor(Math.random() * 6)];
        this.bell(f, { ratio: 2.76, index: 0.8, dur: 0.35, gain: 0.03, delay: i * 0.055 + Math.random() * 0.02, send: 0.6 });
      }
    },
    /** Bought: the till, then a warm chord. */
    purchase(o) {
      this.noise({ filter: 'bandpass', freq: 3000, q: 2, dur: 0.04, gain: 0.08, send: 0.1 });
      this.bell(1046.5, { ratio: 2, index: 1, dur: 0.5, gain: 0.05, delay: 0.04, send: 0.5 });
      this.chord([523.3, 659.3, 784], { type: 'triangle', dur: 0.45, gain: 0.045, spread: 0.04, delay: 0.1, send: 0.5 });
    },
    chat(o) { this.tone(1046, { type: 'sine', dur: 0.06, gain: 0.055, send: 0.25 }); },
    join(o) { [440, 587, 880].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.13, gain: 0.075, delay: i * 0.065, send: 0.4 })); },
    leave(o) { [880, 587, 440].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.13, gain: 0.075, delay: i * 0.065, send: 0.4 })); },
  };

  /* The palette as the options page lists it, to try each one by ear. */
  Audio.prototype.CATALOGUE = [
    ['Cards', [['draw', {}], ['deal', { count: 5 }], ['shuffle', {}], ['discard', {}], ['mill', { count: 3 }]]],
    ['Lands and mana', [['land', { colors: ['W'] }, 'Plains'], ['land', { colors: ['U'] }, 'Island'], ['land', { colors: ['B'] }, 'Swamp'],
      ['land', { colors: ['R'] }, 'Mountain'], ['land', { colors: ['G'] }, 'Forest'], ['mana', { colors: ['W', 'U', 'B'], count: 3 }], ['tap', {}], ['untap_all', {}]]],
    ['Spells', [['cast', { colors: ['W'] }, 'cast white'], ['cast', { colors: ['U'] }, 'cast blue'], ['cast', { colors: ['B'] }, 'cast black'],
      ['cast', { colors: ['R'] }, 'cast red'], ['cast', { colors: ['G'] }, 'cast green'], ['cast', { colors: ['U', 'R'] }, 'cast gold'],
      ['resolve', { colors: ['U'] }], ['counter', {}], ['trigger', {}], ['activate', {}]]],
    ['The battlefield', [['enter', { intensity: 0.2 }, 'small creature'], ['enter', { intensity: 0.9 }, 'big creature'], ['settle', {}, 'artifact'],
      ['token', {}], ['bounce', {}], ['exile', {}], ['die', {}], ['wipe', {}], ['counter_add', {}, '+1 counter']]],
    ['Combat', [['attack', {}], ['block', {}], ['hit', { intensity: 0.2 }, 'hit for 2'], ['hit', { intensity: 1 }, 'hit for 8'], ['burn', { intensity: 0.4 }]]],
    ['Life', [['life_gain', { intensity: 0.4 }], ['life_loss', { intensity: 0.2 }, 'lose a little'], ['life_loss', { intensity: 1 }, 'lose a lot'], ['poison', {}]]],
    ['The turn', [['turn_mine', {}, 'your turn'], ['turn_theirs', {}, 'their turn'], ['priority', {}], ['choice', {}], ['win', {}], ['lose', {}], ['eliminated', {}]]],
    ['Interface', [['hover', {}], ['click', {}], ['confirm', {}], ['cancel', {}], ['reject', {}], ['error', {}]]],
    ['Store', [['purchase', {}], ['shards', { intensity: 0.6 }], ['pack_tear', {}], ['card_flip', {}], ['reveal_rare', {}], ['reveal_mythic', {}], ['wildcard', {}]]],
  ];

  MTG.audio = new Audio();
  const unlock = () => {
    MTG.audio._ensure();
    // once the browser lets sound start, the room can start too
    setTimeout(() => MTG.audio._ambTick(), 50);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  if (MTG.bus && MTG.bus.on) MTG.bus.on('settings:changed', () => MTG.audio.applyLevels());

  MTG.sfx = (n, o) => MTG.audio.play(n, o);
})(window.MTG);
