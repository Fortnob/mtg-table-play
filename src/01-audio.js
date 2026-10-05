/* ============================================================
   01-audio.js — the table's sound

   Everything is synthesised, so the app stays one file with no assets. What
   makes it sound like a place rather than a row of beeps is three things:

     a room      — one convolution reverb that every voice is sent to, so
                   sounds decay into the same space instead of stopping dead
     a direction — each seat has a position in the stereo field, so a spell
                   cast across the table arrives from over there
     a weight    — an effect carries how big it was, so three damage and
                   twelve damage are not the same sound at the same volume

   Voices are layered the way a real sound is: a transient that gives it an
   edge, a body that gives it pitch, and a tail that gives it size.
   ============================================================ */
'use strict';
(function (MTG) {
  const S = MTG.settings;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.verb = null;
      this.noiseBuf = null;
      this.lastPlay = new Map();
      this.voices = 0;
    }

    _ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();

      // master -> duck -> limiter -> out
      this.master = this.ctx.createGain();
      this.master.gain.value = S.muted ? 0 : S.volume;
      this.duck = this.ctx.createGain();
      this.duck.gain.value = 1;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 14; comp.ratio.value = 8;
      comp.attack.value = 0.002; comp.release.value = 0.2;
      this.master.connect(this.duck);
      this.duck.connect(comp);
      comp.connect(this.ctx.destination);

      // a room to decay into, on a send so dry level stays under control
      this.verbSend = this.ctx.createGain();
      this.verbSend.gain.value = 0.85;
      this.verb = this.ctx.createConvolver();
      this.verb.buffer = this._impulse(1.6, 2.6);
      const verbOut = this.ctx.createGain();
      verbOut.gain.value = 0.5;
      this.verbSend.connect(this.verb);
      this.verb.connect(verbOut);
      verbOut.connect(this.duck);

      this._makeNoise();
      return true;
    }

    /** A decaying noise burst makes a serviceable room. */
    _impulse(seconds, decay) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          // a touch of early reflection, then a smooth tail
          const early = i < rate * 0.03 ? (Math.random() * 2 - 1) * 0.6 : 0;
          d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) * 0.7 + early * Math.pow(1 - t, 8);
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
    }

    setVolume(v) {
      S.volume = v; MTG.saveSettings();
      if (this.master) this.master.gain.value = S.muted ? 0 : v;
    }
    setMuted(m) {
      S.muted = m; MTG.saveSettings();
      if (this.master) this.master.gain.value = m ? 0 : S.volume;
    }

    /** Pull everything down for a moment so one big sound has room. */
    dip(amount, hold) {
      if (!this.duck) return;
      const t = this.ctx.currentTime;
      const g = this.duck.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(clamp(1 - amount, 0.15, 1), t + 0.02);
      g.linearRampToValueAtTime(1, t + 0.02 + (hold || 0.25));
    }

    /* ---------------- the signal path for one voice ---------------- */

    _out(pan, send) {
      const g = this.ctx.createGain();
      let node = g;
      if (pan != null && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = clamp(pan, -1, 1);
        g.connect(p);
        node = p;
      }
      node.connect(this.master);
      if (send !== 0) {
        const s = this.ctx.createGain();
        s.gain.value = (send == null ? 0.18 : send);
        node.connect(s);
        s.connect(this.verbSend);
      }
      return g;
    }

    _env(g, t0, a, d, peak, hold) {
      const p = Math.max(0.0004, peak);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p, t0 + Math.max(0.001, a));
      if (hold) g.gain.setValueAtTime(p, t0 + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + (hold || 0) + Math.max(0.01, d));
    }

    /** One pitched voice. */
    tone(freq, o) {
      if (!this._ensure() || this.voices > 48) return;
      o = o || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.15;
      const osc = this.ctx.createOscillator();
      osc.type = o.type || 'sine';
      const f = Math.max(20, freq * (o.detune ? 1 + (Math.random() - 0.5) * o.detune : 1));
      osc.frequency.setValueAtTime(f, t0);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
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
      this.voices++;
      osc.onended = () => { this.voices--; };
    }

    /** One unpitched voice: air, impact, paper. */
    noise(o) {
      if (!this._ensure() || this.voices > 48) return;
      o = o || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.12;
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.playbackRate.value = o.rate || 1;
      const bq = this.ctx.createBiquadFilter();
      bq.type = o.filter || 'bandpass';
      bq.frequency.setValueAtTime(o.freq || 2000, t0);
      if (o.sweepTo) bq.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t0 + dur);
      bq.Q.value = o.q == null ? 0.8 : o.q;
      s.connect(bq);
      const g = this._out(o.pan, o.send);
      bq.connect(g);
      this._env(g, t0, o.attack || 0.003, dur, o.gain == null ? 0.18 : o.gain, o.hold);
      s.start(t0);
      s.stop(t0 + dur + (o.hold || 0) + 0.1);
      this.voices++;
      s.onended = () => { this.voices--; };
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
     *   intensity 0..1, how big it was (damage dealt, life swung)
     */
    play(name, opt) {
      if (S.muted) return;
      opt = opt || {};
      const now = performance.now();
      const key = name + (opt.pan == null ? '' : opt.pan.toFixed(1));
      const last = this.lastPlay.get(key);
      // the same sound twice in one frame is one sound
      if (last && now - last < 32) return;
      this.lastPlay.set(key, now);
      const fx = this.FX[name];
      if (fx) {
        try { fx.call(this, opt); } catch (e) { /* never let sound break the game */ }
      }
    }
  }

  /* Loudness and brightness scale with how big the event was. */
  function lvl(o, base, span) { return base + (span == null ? base : span) * clamp(o.intensity || 0, 0, 1); }

  Audio.prototype.FX = {
    /* ---- cards in hand ---- */
    draw(o) {
      this.noise({ filter: 'bandpass', freq: 3400, sweepTo: 900, dur: 0.1, gain: 0.13, q: 0.7, rate: 1.35, pan: o.pan, send: 0.1 });
      this.tone(2100, { type: 'sine', dur: 0.05, gain: 0.03, delay: 0.02, pan: o.pan, detune: 0.06 });
    },
    play_card(o) {
      this.noise({ filter: 'lowpass', freq: 2800, sweepTo: 520, dur: 0.09, gain: 0.18, rate: 1.1, pan: o.pan, send: 0.14 });
      this.tone(170, { type: 'sine', dur: 0.09, gain: 0.11, delay: 0.015, pan: o.pan, detune: 0.05 });
    },
    land(o) {
      this.tone(98, { type: 'triangle', dur: 0.2, gain: 0.17, pan: o.pan, send: 0.24 });
      this.tone(196, { type: 'sine', dur: 0.14, gain: 0.07, delay: 0.01, pan: o.pan });
      this.noise({ filter: 'lowpass', freq: 420, dur: 0.16, gain: 0.13, pan: o.pan, send: 0.2 });
    },
    shuffle(o) {
      for (let i = 0; i < 9; i++) {
        this.noise({ filter: 'bandpass', freq: 2000 + Math.random() * 2200, dur: 0.045,
          gain: 0.075, delay: i * 0.042 + Math.random() * 0.012, rate: 1.5, pan: o.pan, send: 0.08 });
      }
    },
    discard(o) {
      this.noise({ filter: 'bandpass', freq: 1600, sweepTo: 400, dur: 0.14, gain: 0.15, rate: 0.9, pan: o.pan, send: 0.2 });
      this.tone(140, { type: 'sine', slideTo: 90, dur: 0.13, gain: 0.08, pan: o.pan });
    },

    /* ---- tapping ---- */
    tap(o) {
      this.tone(760, { type: 'square', dur: 0.04, gain: 0.055, filter: 'lowpass', filterFreq: 2000, pan: o.pan, detune: 0.1 });
      this.noise({ filter: 'highpass', freq: 4200, dur: 0.02, gain: 0.05, pan: o.pan, send: 0.06 });
    },
    untap(o) { this.tone(1180, { type: 'square', dur: 0.04, gain: 0.05, filter: 'lowpass', filterFreq: 2600, pan: o.pan, detune: 0.1 }); },
    untap_all(o) { [620, 830, 1040].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.08, gain: 0.06, delay: i * 0.038, pan: o.pan, send: 0.2 })); },

    /* ---- the stack ---- */
    cast(o) {
      this.tone(300, { type: 'triangle', slideTo: 900, dur: 0.26, gain: 0.15, filter: 'lowpass', filterFreq: 1200, filterTo: 4200, pan: o.pan, send: 0.3 });
      this.noise({ filter: 'bandpass', freq: 700, sweepTo: 3600, dur: 0.24, gain: 0.07, q: 0.6, pan: o.pan, send: 0.3 });
    },
    resolve(o) {
      this.tone(720, { type: 'sine', slideTo: 300, dur: 0.22, gain: 0.15, pan: o.pan, send: 0.34 });
      this.tone(1440, { type: 'sine', slideTo: 600, dur: 0.16, gain: 0.05, delay: 0.01, pan: o.pan, send: 0.34 });
    },
    counter(o) {
      this.dip(0.25, 0.3);
      this.tone(520, { type: 'sawtooth', slideTo: 70, dur: 0.34, gain: 0.17, filter: 'lowpass', filterFreq: 1600, filterTo: 300, pan: o.pan, send: 0.3 });
      this.noise({ filter: 'lowpass', freq: 900, sweepTo: 160, dur: 0.3, gain: 0.1, pan: o.pan, send: 0.3 });
    },
    trigger(o) { this.chord([784, 1175], { type: 'sine', dur: 0.13, gain: 0.085, spread: 0.045, pan: o.pan, send: 0.3 }); },
    mana(o) {
      this.tone(1240, { type: 'sine', dur: 0.055, gain: 0.07, pan: o.pan, detune: 0.08, send: 0.22 });
      this.tone(1860, { type: 'sine', dur: 0.04, gain: 0.03, delay: 0.015, pan: o.pan, detune: 0.08 });
    },
    target(o) { this.tone(1500, { type: 'sine', slideTo: 2200, dur: 0.06, gain: 0.05, pan: o.pan, send: 0.2 }); },

    /* ---- combat ---- */
    attack(o) {
      this.dip(0.14, 0.24);
      this.noise({ filter: 'highpass', freq: 1100, sweepTo: 4600, dur: 0.15, gain: lvl(o, 0.16, 0.1), rate: 1.7, pan: o.pan, send: 0.24 });
      this.tone(150, { type: 'sawtooth', slideTo: 62, dur: 0.18, gain: 0.12, filter: 'lowpass', filterFreq: 800, pan: o.pan, send: 0.24 });
    },
    block(o) {
      this.noise({ filter: 'bandpass', freq: 860, dur: 0.09, gain: 0.19, q: 2.2, pan: o.pan, send: 0.24 });
      this.tone(228, { type: 'square', dur: 0.07, gain: 0.09, pan: o.pan, detune: 0.08 });
      this.tone(1500, { type: 'sine', dur: 0.03, gain: 0.04, pan: o.pan });
    },
    damage(o) {
      const big = clamp(o.intensity || 0, 0, 1);
      if (big > 0.55) this.dip(0.2 + big * 0.2, 0.3);
      this.noise({ filter: 'lowpass', freq: 1900 - big * 700, sweepTo: 260, dur: 0.16 + big * 0.16,
        gain: lvl(o, 0.2, 0.16), rate: 0.95 - big * 0.25, pan: o.pan, send: 0.26 });
      this.tone(96 - big * 26, { type: 'sawtooth', slideTo: 42, dur: 0.2 + big * 0.2,
        gain: lvl(o, 0.13, 0.1), filter: 'lowpass', filterFreq: 620, pan: o.pan, send: 0.3 });
    },
    destroy(o) {
      this.dip(0.22, 0.34);
      this.noise({ filter: 'lowpass', freq: 1500, sweepTo: 150, dur: 0.34, gain: 0.22, rate: 0.66, pan: o.pan, send: 0.42 });
      this.tone(210, { type: 'sawtooth', slideTo: 52, dur: 0.34, gain: 0.12, filter: 'lowpass', filterFreq: 900, filterTo: 200, pan: o.pan, send: 0.42 });
    },
    wipe(o) {
      this.dip(0.5, 0.9);
      this.noise({ filter: 'lowpass', freq: 2600, sweepTo: 90, dur: 0.9, gain: 0.3, rate: 0.5, send: 0.7 });
      [220, 165, 110, 82].forEach((f, i) => this.tone(f, { type: 'sawtooth', slideTo: f * 0.35, dur: 0.7,
        gain: 0.1, delay: i * 0.05, filter: 'lowpass', filterFreq: 900, send: 0.7 }));
    },

    /* ---- life and counters ---- */
    life_gain(o) {
      const n = 0.11 + 0.06 * clamp(o.intensity || 0, 0, 1);
      [523, 659, 784].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.12, gain: n, delay: i * 0.05, pan: o.pan, send: 0.38 }));
    },
    /* Losing life should land. A low thud under the falling notes, and the
       whole thing ducks the table for a moment when it is a big hit. */
    life_loss(o) {
      const big = clamp(o.intensity || 0, 0, 1);
      const n = 0.13 + 0.1 * big;
      if (big > 0.4) this.dip(0.16 + big * 0.2, 0.28);
      [466, 392, 311].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.14, gain: n, delay: i * 0.05, pan: o.pan, send: 0.34 }));
      this.tone(88 - big * 20, { type: 'sine', slideTo: 48, dur: 0.26 + big * 0.2,
        gain: 0.1 + 0.12 * big, filter: 'lowpass', filterFreq: 420, pan: o.pan, send: 0.3 });
      this.noise({ filter: 'lowpass', freq: 900, sweepTo: 200, dur: 0.16 + big * 0.12,
        gain: 0.06 + 0.1 * big, rate: 0.8, pan: o.pan, send: 0.25 });
    },
    counter_add(o) {
      this.tone(1560, { type: 'sine', dur: 0.05, gain: 0.08, pan: o.pan, detune: 0.05, send: 0.25 });
      this.tone(2340, { type: 'sine', dur: 0.05, gain: 0.05, delay: 0.038, pan: o.pan, detune: 0.05, send: 0.25 });
    },
    counter_remove(o) {
      this.tone(2340, { type: 'sine', dur: 0.05, gain: 0.06, pan: o.pan, send: 0.2 });
      this.tone(1560, { type: 'sine', dur: 0.05, gain: 0.05, delay: 0.038, pan: o.pan, send: 0.2 });
    },
    token(o) {
      this.tone(660, { type: 'triangle', slideTo: 990, dur: 0.1, gain: 0.09, pan: o.pan, send: 0.3 });
      this.noise({ filter: 'highpass', freq: 3000, dur: 0.06, gain: 0.06, pan: o.pan, send: 0.2 });
    },
    scry(o) {
      this.tone(1320, { type: 'sine', slideTo: 1760, dur: 0.1, gain: 0.06, pan: o.pan, send: 0.35 });
      this.tone(1760, { type: 'sine', slideTo: 1320, dur: 0.12, gain: 0.045, delay: 0.09, pan: o.pan, send: 0.35 });
    },
    exile(o) {
      this.tone(880, { type: 'sine', slideTo: 2600, dur: 0.24, gain: 0.09, filter: 'highpass', filterFreq: 600, pan: o.pan, send: 0.5 });
      this.noise({ filter: 'highpass', freq: 1800, sweepTo: 6000, dur: 0.26, gain: 0.08, pan: o.pan, send: 0.5 });
    },
    crown(o) { [659, 880, 1047, 1319].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.14, gain: 0.075, delay: i * 0.055, send: 0.45 })); },
    daynight(o) { this.tone(300, { type: 'sine', slideTo: 620, dur: 0.4, gain: 0.07, send: 0.5 }); },
    undo(o) { this.tone(540, { type: 'sine', slideTo: 330, dur: 0.13, gain: 0.07, send: 0.2 }); },
    blink(o) {
      this.tone(980, { type: 'sine', slideTo: 1960, dur: 0.07, gain: 0.07, pan: o.pan, send: 0.4 });
      this.tone(1960, { type: 'sine', slideTo: 980, dur: 0.09, gain: 0.055, delay: 0.07, pan: o.pan, send: 0.4 });
    },

    /* ---- the shape of the turn ---- */
    phase(o) { this.tone(430, { type: 'sine', dur: 0.055, gain: 0.04, send: 0.25 }); },
    step(o) { this.tone(560, { type: 'sine', dur: 0.04, gain: 0.025, send: 0.2 }); },
    turn_start(o) {
      this.chord([392, 494, 587], { type: 'triangle', dur: 0.24, gain: 0.085, spread: 0.055, send: 0.45 });
      this.noise({ filter: 'lowpass', freq: 600, dur: 0.3, gain: 0.05, send: 0.5 });
    },
    /* Your turn to act: two notes, because one blip reads as a click rather
       than as somebody looking at you. */
    priority(o) {
      this.tone(784, { type: 'sine', dur: 0.1, gain: 0.085, send: 0.35 });
      this.tone(1175, { type: 'sine', dur: 0.14, gain: 0.065, delay: 0.078, send: 0.35 });
    },

    /* ---- meta ---- */
    win(o) {
      this.dip(0.3, 1.4);
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.4, gain: 0.15, delay: i * 0.11, send: 0.6 }));
      [261, 330, 392, 523].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.5, gain: 0.07, delay: i * 0.11, send: 0.6 }));
    },
    lose(o) {
      this.dip(0.3, 1.4);
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, { type: 'triangle', dur: 0.42, gain: 0.13, delay: i * 0.13, send: 0.6 }));
    },
    error(o) {
      this.tone(196, { type: 'square', dur: 0.09, gain: 0.11, filter: 'lowpass', filterFreq: 1200 });
      this.tone(147, { type: 'square', dur: 0.12, gain: 0.11, delay: 0.085, filter: 'lowpass', filterFreq: 1000 });
    },
    click(o) { this.noise({ filter: 'highpass', freq: 4500, dur: 0.018, gain: 0.07, rate: 2, send: 0.05 }); },
    notify(o) { this.chord([880, 1174], { type: 'sine', dur: 0.15, gain: 0.09, spread: 0.065, send: 0.4 }); },
    pack_open(o) {
      this.noise({ filter: 'bandpass', freq: 3400, sweepTo: 1100, dur: 0.32, gain: 0.19, rate: 0.85, q: 0.5, send: 0.4 });
      this.chord([660, 880, 1320], { type: 'sine', dur: 0.28, gain: 0.075, spread: 0.075, delay: 0.14, send: 0.5 });
    },
    pick(o) { this.tone(720, { type: 'sine', slideTo: 1150, dur: 0.11, gain: 0.11, send: 0.3 }); },
    chat(o) { this.tone(1046, { type: 'sine', dur: 0.06, gain: 0.065, send: 0.25 }); },
    join(o) { [440, 587, 880].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.13, gain: 0.085, delay: i * 0.065, send: 0.4 })); },
    leave(o) { [880, 587, 440].forEach((f, i) => this.tone(f, { type: 'sine', dur: 0.13, gain: 0.085, delay: i * 0.065, send: 0.4 })); },
  };

  MTG.audio = new Audio();
  const unlock = () => {
    MTG.audio._ensure();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  MTG.sfx = (n, o) => MTG.audio.play(n, o);
})(window.MTG);


