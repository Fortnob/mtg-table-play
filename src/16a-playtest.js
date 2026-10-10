/* ============================================================
   16a-playtest.js - trying a deck out before it meets anybody
   Sample hands: shuffle, draw seven, mulligan the London way, draw
   on, and the odds of the lands in an opening hand.

   This half is the arithmetic, with nothing on screen, so the tools
   can test it (tools/decktoolstest.js); what the player sees is
   src/11b-ui-playtest.js.
   ============================================================ */
'use strict';
(function (MTG) {
  /* ---------------- what counts as a land ----------------
     A card you could play as your land for the turn: a land, or a modal
     double-faced card with a land on its back (Shatterskull Smashing),
     which most people count as one when they count their lands. */
  function isLand(card) {
    if (!card) return false;
    const faces = card.card_faces && card.card_faces.length ? card.card_faces : null;
    const front = (faces ? faces[0].type_line : null) || String(card.type_line || '').split('//')[0];
    if (/\bLand\b/.test(front || '')) return true;
    return card.layout === 'modal_dfc' && !!faces && faces.some(f => /\bLand\b/.test(f.type_line || ''));
  }

  /** The main deck, card by card: what a library is shuffled from. */
  function libraryOf(deck) {
    const out = [];
    for (const e of (deck && deck.main) || []) for (let i = 0; i < (e.qty || 0); i++) out.push(e.card);
    return out;
  }

  /** How many cards, and how many of them lands, in the main deck. */
  function landCount(deck) {
    let lands = 0, size = 0;
    for (const e of (deck && deck.main) || []) {
      size += e.qty || 0;
      if (isLand(e.card)) lands += e.qty || 0;
    }
    return { lands, size };
  }

  /* ---------------- the odds ----------------
     Drawing without putting back is the hypergeometric distribution: of
     `size` cards with `lands` lands among them, the chance that `drawn`
     cards hold exactly k lands. Worked in logarithms, so a 250-card deck
     does not overflow anything. */
  const LOGF = [0];
  function logFact(n) {
    for (let i = LOGF.length; i <= n; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
    return LOGF[n];
  }
  const logChoose = (n, k) => (k < 0 || k > n) ? -Infinity : logFact(n) - logFact(k) - logFact(n - k);

  /** The chance of exactly k lands in `drawn` cards from `size` with `lands` lands. */
  function exactly(k, lands, size, drawn) {
    if (drawn > size || k < 0 || k > drawn) return 0;
    const v = logChoose(lands, k) + logChoose(size - lands, drawn - k) - logChoose(size, drawn);
    return v === -Infinity ? 0 : Math.exp(v);
  }

  /**
   * For each number of lands from 0 to `drawn`, the chance of exactly that
   * many in an opening hand of `drawn` (seven unless said) from this deck.
   */
  function openingOdds(deck, drawn) {
    const { lands, size } = landCount(deck);
    drawn = Math.min(drawn == null ? 7 : drawn, size);
    const out = [];
    for (let k = 0; k <= drawn; k++) out.push(exactly(k, lands, size, drawn));
    return { lands, size, drawn, exactly: out };
  }

  /** The chance of at least k (and at most `most`, when given) from a list of exact chances. */
  function between(exact, k, most) {
    let p = 0;
    for (let i = k; i < exact.length && (most == null || i <= most); i++) p += exact[i];
    return Math.min(1, p);
  }

  /* ---------------- sample hands ----------------
     A hand dealt the way the table deals one: seven from the shuffled
     main deck, and a London mulligan is seven again with one more card
     to put on the bottom each time (the free mulligans a format gives
     first). The cards to bottom are chosen, as at the table, before
     drawing on. */
  class SampleHand {
    /** `opts.seed` makes the shuffles repeatable; `opts.freeMulligans` as the format has them. */
    constructor(deck, opts) {
      opts = opts || {};
      this.deck = deck;
      this.rng = new MTG.RNG(opts.seed == null ? (Date.now() >>> 0) : opts.seed);
      this.free = opts.freeMulligans || 0;
      this.handSize = opts.handSize || 7;
      this.reset();
    }
    /** A fresh shuffle and a fresh seven. */
    reset() {
      this.mulligans = 0;
      this._uid = 0;
      this.library = this.rng.shuffle(libraryOf(this.deck).map(card => ({ key: 'c' + (++this._uid), card })));
      this.hand = [];
      this.bottomed = [];
      this.draws = 0;
      this._deal();
    }
    _deal() {
      this.hand = this.library.splice(0, this.handSize);
      this.toBottom = Math.max(0, Math.min(this.hand.length, this.mulligans - this.free));
    }
    /** Shuffle the hand back and take seven more, with one more to put back. */
    mulligan() {
      if (this.draws) return false;           // a hand drawn on from is a hand kept
      // (what was put on the bottom is in the library already)
      this.library = this.rng.shuffle(this.library.concat(this.hand));
      this.bottomed = [];
      this.mulligans++;
      this._deal();
      return true;
    }
    /** Put one card of the hand on the bottom, while the mulligan says some go. */
    bottom(key) {
      if (this.toBottom <= 0) return false;
      const i = this.hand.findIndex(x => x.key === key);
      if (i < 0) return false;
      const [x] = this.hand.splice(i, 1);
      this.library.push(x);
      this.bottomed.push(x);
      this.toBottom--;
      return true;
    }
    /** Draw the next card, once the cards to bottom have gone. */
    draw() {
      if (this.toBottom > 0 || !this.library.length) return null;
      // the cards put on the bottom come up last, as they would
      const x = this.library.shift();
      const was = this.bottomed.indexOf(x);
      if (was >= 0) this.bottomed.splice(was, 1);
      this.hand.push(x);
      this.draws++;
      return x;
    }
    /** How many lands are in the hand now. */
    lands() { return this.hand.filter(x => isLand(x.card)).length; }
    /** Whether the hand is settled: nothing left to put on the bottom. */
    get kept() { return this.toBottom === 0; }
  }

  MTG.playtest = { isLand, landCount, libraryOf, exactly, openingOdds, between, SampleHand };
})(window.MTG);
