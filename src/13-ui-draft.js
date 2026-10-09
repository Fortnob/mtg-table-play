/* ============================================================
   13-ui-draft.js - the draft table and the cube manager
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, util: U } = MTG;
  const UI = MTG.ui;
  const CARD_RATIO = 88 / 63;

  class DraftTable {
    constructor(root, seatId, send) {
      this.root = root;
      this.seatId = seatId;
      this.send = send;
      this.view = null;
      this.chosen = [];
      this.ability = null;      // the card in the pool paying for this pick
      this.mods = [];           // cards spent on the first card taken (Cogwork Grinder, Noble Banneret)
      this._seenOffers = new Set();
      this._seenAsks = new Set();
      this._seenSeen = new Set();
      this._build();
    }
    _build() {
      this.root.innerHTML = '';
      this.root.classList.add('draft-layout');
      this.head = el('div', { class: 'draft-head' });
      this.packWrap = el('div', { class: 'draft-pack' });
      this.poolWrap = el('div', { class: 'draft-pool' });
      const middle = el('div', { class: 'draft-middle' }, [this.packWrap]);
      this.root.append(this.head, middle, this.poolWrap);

      /* Clicking the table rather than a card puts the card down. Buttons and
         fields are excluded: pressing Confirm is not "clicking nowhere", and
         neither is opening the ability menu. */
      this._onBlank = (e) => {
        if (!this.chosen.length) return;
        if (e.target.closest('.pick-card, .pool-card, button, a, select, input, label, .modal-back, .ctx-menu')) return;
        this.chosen = [];
        this.render();
      };
      this.root.addEventListener('click', this._onBlank);

      // the pack is sized to the room it has, so it is laid out again when the room changes
      this._packSize = '';
      this._ro = window.ResizeObserver ? new ResizeObserver(() => {
        const k = this.packWrap.clientWidth + 'x' + this.packWrap.clientHeight;
        if (k === this._packSize) return;
        this._packSize = k;
        clearTimeout(this._fitTimer);
        this._fitTimer = setTimeout(() => { if (this.view && this.view.pack && this.view.pack.length) this.render(); }, 60);
      }) : null;
      if (this._ro) this._ro.observe(this.packWrap);

      /* Space confirms whatever is selected, from anywhere on the screen, so
         a pick is click-then-space without having to find the button. */
      this._onKey = (e) => {
        if (!this.root.classList.contains('active')) return;
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select, .modal-back')) return;
        e.preventDefault();
        this.confirmPick();
      };
      document.addEventListener('keydown', this._onKey);
    }

    destroy() {
      document.removeEventListener('keydown', this._onKey);
      this.root.removeEventListener('click', this._onBlank);
      if (this._ro) this._ro.disconnect();
      clearTimeout(this._fitTimer);
      this.root.innerHTML = '';
      this.root.classList.remove('draft-layout');
    }
    update(view) {
      this.view = view;
      // a choice only means something in the pack it was made in
      const inPack = new Set((view.pack || []).map(c => c.id));
      this.chosen = this.chosen.filter(id => inPack.has(id));
      // what is being spent on this pick has to still be there to spend
      const usable = new Set((view.canUse || []).map(a => a.cardId));
      if (this.ability && !usable.has(this.ability)) this.ability = null;
      this.mods = this.mods.filter(id => usable.has(id));
      // a card that asks a question the moment it is drafted asks it here
      for (const o of (view.offers || [])) {
        if (this._seenOffers.has(o.cardId)) continue;
        this._seenOffers.add(o.cardId);
        this._askOffer(o);
      }
      // Regicide and Paliano, the High City: a colour, for yours or a neighbour's
      for (const a of (view.asks || [])) {
        if (this._seenAsks.has(a.id)) continue;
        this._seenAsks.add(a.id);
        this._askColor(a);
      }
      // what a Cogwork Spy, an Illusionary Informant or a Whispergear Sneak let you see
      for (const s of (view.seen || [])) {
        if (this._seenSeen.has(s.id)) continue;
        this._seenSeen.add(s.id);
        this._showSeen(s);
      }
      this.render();
    }

    /** How many cards this pick takes, given whatever is being spent on it. */
    _need(v) {
      const base = Math.min(v.picksPerTurn, v.pack.length);
      if (!this.ability) return base;
      const a = (v.canUse || []).find(x => x.cardId === this.ability);
      if (!a) return base;
      if (a.kind === 'wholePack') return 0;
      if (a.kind === 'extraPick') return Math.min(v.picksPerTurn + 1, v.pack.length);
      return base;
    }

    /**
     * Click a card to take it in hand; click it again to put it down; click a
     * different one and that is the card you mean instead. When the pick wants
     * two cards the older choice is the one that gives way, so the click
     * always does something rather than being swallowed.
     */
    _toggle(c) {
      const need = this._need(this.view);
      const i = this.chosen.indexOf(c.id);
      if (i >= 0) { this.chosen.splice(i, 1); return; }
      if (need <= 0) return;
      while (this.chosen.length >= need) this.chosen.shift();
      this.chosen.push(c.id);
    }

    /** Send the pick, if it is complete. Returns whether anything went. */
    confirmPick() {
      const v = this.view;
      if (!v || v.sittingOut || v.blind || v.broker || !v.pack.length || this._guessing) return false;
      const need = this._need(v);
      if (need > 0 && this.chosen.length !== need) return false;
      const first = v.pack.find(c => c.id === (need > 0 ? this.chosen[0] : (v.pack[0] || {}).id));
      // a name or a type is only noted for a creature, by the cards that say so
      const bad = this.mods.map(id => (v.canUse || []).find(a => a.cardId === id)).find(a => a && a.creature && !/\bCreature\b/.test((first && first.type_line) || ''));
      if (bad) { UI.error(`${bad.name} notes a creature: take a creature first, or put ${bad.name} down.`); return false; }
      const ids = need > 0 ? this.chosen.slice() : [];
      const pick = { kind: 'pick', cardIds: ids, ability: this.ability || null, mods: this.mods.slice(), guess: null };
      /* Spire Phantasm: a guess at the next card taken from this pack, made
         as it is drafted, from the cards that will be left in it. */
      const taking = need > 0 ? ids : v.pack.map(c => c.id);
      const phantasm = v.pack.some(c => taking.includes(c.id) && /^Spire Phantasm$/i.test(c.name));
      const rest = v.pack.filter(c => !taking.includes(c.id));
      if (phantasm && rest.length) {
        this._guessing = true;
        this._askGuess(rest).then((name) => { this._guessing = false; pick.guess = name; this._send(pick); });
        return true;
      }
      this._send(pick);
      return true;
    }
    _send(pick) {
      /* Put the cards down before sending: at a table hosted here the next
         pack can come back inside send(), and it must not be drawn with the
         last pick still in hand (the pack dimmed, the old card flagged). */
      this.chosen = [];
      this.ability = null;
      this.mods = [];
      this.send(pick);
      this.render();
    }

    /** A double-click means "this one, and I am done." */
    _confirmCard(c) {
      const need = this._need(this.view);
      if (need > 0 && !this.chosen.includes(c.id)) {
        while (this.chosen.length >= need) this.chosen.shift();
        this.chosen.push(c.id);
      }
      if (!this.confirmPick()) this.render();
    }

    async _askOffer(o) {
      const yes = await UI.confirm(o.prompt, o.name);
      this.send({ kind: 'draftOffer', cardId: o.cardId, yes: !!yes });
    }

    /** Spire Phantasm's guess: which of these will the next player take? */
    _askGuess(cards) {
      return new Promise((res) => {
        const grid = el('div', { class: 'card-grid' });
        const m = UI.modal({
          title: 'Spire Phantasm', width: '900px', closable: false,
          content: el('div', null, [
            el('p', { class: 'small muted', text: 'Guess the card the next player will take from this pack. Guess right and Spire Phantasm draws you a card when it enters.' }),
            grid,
          ]),
        });
        for (const c of cards) {
          grid.appendChild(UI.cardSlot(c, {}, { size: 'small', onClick: () => { m.close(); res(c.name); } }));
        }
      });
    }

    _askColor(a) {
      const NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
      UI.modal({
        title: 'Choose a colour', closable: false,
        content: el('p', { text: a.prompt, style: { margin: 0 } }),
        buttons: a.options.map(c => ({ label: NAMES[c] || c, onClick: (m) => {
          m.close();
          this.send({ kind: 'draftAct', act: 'answer', askId: a.id, value: c });
        } })),
      });
    }

    /** What one of your cards let you look at. */
    _showSeen(s) {
      const grid = el('div', { class: 'card-grid' });
      for (const c of (s.cards || [])) grid.appendChild(UI.cardSlot(c, {}, { size: 'small' }));
      UI.modal({
        title: s.by, width: '900px',
        content: el('div', null, [el('p', { class: 'small muted', text: s.text }), grid]),
        buttons: [{ label: 'Close', class: 'primary', onClick: (m) => m.close() }],
      });
    }

    /** The strip of cards in your pool that do something during the draft, and what they have noted. */
    _abilityBar(v) {
      const all = v.abilities || [];
      const kids = [];
      if (all.length) kids.push(el('span', { class: 'small muted', text: 'Draft abilities:' }));
      for (const a of all) {
        const usable = (v.canUse || []).find(x => x.cardId === a.cardId);
        const on = this.ability === a.cardId || this.mods.includes(a.cardId);
        if (!a.known) {
          kids.push(el('span', { class: 'pill warn', title: a.prompt, text: `${a.name} — run this one yourselves` }));
          continue;
        }
        if (a.faceDown) {
          kids.push(el('span', { class: 'pill', title: a.prompt, text: `${a.name} (face down)` }));
          continue;
        }
        if (a.kind === 'blind') {
          kids.push(el('span', { class: 'pill warn', title: a.prompt, text: `${a.name}: ${a.blindLeft} more at random` }));
          continue;
        }
        // a card that did its work as it was drafted shows what it noted, below
        if (a.onDraft) continue;
        if (a.passive) {
          kids.push(el('span', { class: 'pill', title: a.prompt, text: `${a.name} — ${a.label}` }));
          continue;
        }
        kids.push(el('button', {
          class: 'btn xs' + (on ? ' primary' : ''),
          disabled: !usable && !on,
          'aria-pressed': on ? 'true' : 'false',
          title: a.prompt,
          onclick: () => this._useAbility(usable || a),
        }, [el('span', { text: `${a.name}: ${a.label}` })]));
      }
      if (v.sittingOut) kids.push(el('span', { class: 'pill warn', text: 'Sitting out the rest of this round' }));
      if (v.skipping) kids.push(el('span', { class: 'pill warn', text: "Passing the next pack without drafting (Leovold's Operative)" }));
      if (v.queued) kids.push(el('span', { class: 'pill', text: `${v.queued} more pack${v.queued === 1 ? '' : 's'} waiting for you` }));
      for (const n of (v.notes || []).slice(-6)) kids.push(el('span', { class: 'pill', text: `${n.by}: ${n.text}` }));
      // what the rest of the table has drafted face up or revealed
      const shown = (v.seats || []).filter(s => s.id !== v.you && (s.shown || []).length)
        .map(s => `${s.name}: ${s.shown.map(x => x.name).join(', ')}`);
      if (shown.length) kids.push(el('span', { class: 'small muted', title: 'Cards drafted face up or revealed', text: 'Face up at the table — ' + shown.join(' · ') }));
      if (!kids.length) return null;
      return el('div', { class: 'row wrap draft-abilities' }, kids);
    }

    _useAbility(a) {
      if (a.kind === 'extraPick' || a.kind === 'wholePack') {
        this.ability = this.ability === a.cardId ? null : a.cardId;
        if (this.ability) {
          const need = this._need(this.view);
          this.chosen = this.chosen.slice(0, need);
        }
        this.render();
        return;
      }
      if (a.mod) {
        const i = this.mods.indexOf(a.cardId);
        if (i >= 0) this.mods.splice(i, 1);
        else {
          // only one card can take the pick out of the draft
          if (a.kind === 'remove') this.mods = this.mods.filter(id => ((this.view.canUse || []).find(x => x.cardId === id) || {}).kind !== 'remove');
          this.mods.push(a.cardId);
          UI.toast(`${a.name}: the first card you take this pick.`, 'ok', 2500);
        }
        this.render();
        return;
      }
      if (a.kind === 'peek') return this._pickPeek(a);
      if (a.kind === 'watch') return this._pickWatch(a);
    }

    /** Whispergear Sneak: which pack to look at. */
    _pickPeek(a) {
      const list = el('div', { class: 'col' });
      const m = UI.modal({
        title: a.name, width: '560px',
        content: el('div', null, [el('p', { class: 'small muted', text: a.prompt }), list]),
        buttons: [{ label: 'Cancel', onClick: () => m.close() }],
      });
      for (const o of (this.view.peekOptions || [])) {
        list.appendChild(el('button', { class: 'btn', text: o.label, onclick: () => {
          m.close();
          this.send({ kind: 'draftAct', act: 'peek', cardId: a.cardId, which: o.id });
        } }));
      }
    }

    /** Illusionary Informant: whose next card to see. */
    _pickWatch(a) {
      const m = UI.modal({
        title: a.name, content: el('p', { text: a.prompt, style: { margin: 0 } }),
        buttons: [{ label: 'Cancel', onClick: () => m.close() }],
      });
      for (const s of (this.view.seats || [])) {
        m.button(s.id === this.view.you ? 'Yourself' : s.name, () => {
          m.close();
          this.send({ kind: 'draftAct', act: 'watch', cardId: a.cardId, targetId: s.id });
        });
      }
    }

    /**
     * Deal Broker, once the picks are over: reveal a card, offer one for a
     * revealed card, or take one of the offers.
     */
    _brokerPanel(v) {
      const b = v.broker;
      const box = el('div', { class: 'draft-waiting draft-broker' });
      const grid = el('div', { class: 'card-grid' });
      // the full width of the table, at a size you can read
      grid.style.alignSelf = 'stretch';
      grid.style.setProperty('--card-w', '132px');
      grid.style.setProperty('--card-h', '184px');
      const act = (x) => this.send(Object.assign({ kind: 'draftAct' }, x));
      if (b.mine && b.stage === 'reveal') {
        box.append(el('div', { text: 'Deal Broker: reveal a card from your pool, and the other players may offer one of theirs for it.' }), grid,
          el('button', { class: 'btn', text: 'No trade', onclick: () => act({ act: 'brokerReveal', cardId: null }) }));
        for (const c of (v.pool || [])) grid.appendChild(UI.cardSlot(c, {}, { size: 'small', onClick: () => act({ act: 'brokerReveal', cardId: c.id }) }));
      } else if (!b.mine && b.stage === 'offer' && b.needs) {
        box.append(el('div', { text: `${b.broker} reveals ${b.card ? b.card.name : 'a card'} with Deal Broker. Offer one of your cards for it?` }),
          b.card ? UI.cardSlot(b.card, {}, { size: 'small' }) : null, grid,
          el('button', { class: 'btn', text: 'No offer', onclick: () => act({ act: 'brokerOffer', cardId: null }) }));
        for (const c of (v.pool || [])) grid.appendChild(UI.cardSlot(c, {}, { size: 'small', onClick: () => act({ act: 'brokerOffer', cardId: c.id }) }));
      } else if (b.mine && b.stage === 'accept') {
        box.append(el('div', { text: b.offers.length ? `Offers for your ${b.card.name}. Take one, or keep your card.` : `Nobody offered anything for your ${b.card.name}.` }), grid,
          el('button', { class: 'btn', text: `Keep ${b.card.name}`, onclick: () => act({ act: 'brokerAccept', cardId: null }) }));
        for (const o of b.offers) {
          const slot = UI.cardSlot(o.card, {}, { size: 'small', onClick: () => act({ act: 'brokerAccept', cardId: o.card.id }) });
          slot.appendChild(el('span', { class: 'pick-flag', text: o.seat }));
          grid.appendChild(slot);
        }
      } else {
        box.append(el('div', { class: 'busy-sigil', 'aria-hidden': 'true' }, [el('i'), el('i'), el('b')]),
          el('div', { text: b.card ? `${b.broker} is trading ${b.card.name} with Deal Broker…` : `${b.broker} is choosing a card to trade with Deal Broker…` }));
      }
      return box;
    }

    /** The layout redraws on rotation; there is no floating advice to put away. */
    closeAdvice() {}

    /**
     * How to lay a pack of `n` cards out in the room there is: as many rows
     * as give the biggest card that still fits (no scrolling if it can be
     * helped), the cards split across them as evenly as they go (fourteen
     * is two rows of seven, thirteen is seven and six). Returns the card
     * width and how many cards go in each row, top first.
     */
    _packFit(n) {
      const box = this.packWrap;
      const cs = getComputedStyle(box);
      const phone = MTG.isPhone();
      const W = Math.max(200, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 8);
      // the hint line under the pack, and room for a card to lift on hover
      const H = Math.max(200, box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (phone ? 30 : 56));
      const gx = phone ? 8 : 16, gy = phone ? 10 : 22;
      const scale = U.clamp(MTG.settings.cardScale || 1, 0.6, 2);
      const maxW = (phone ? 150 : 250) * scale, minW = (phone ? 80 : 110) * scale;
      let best = null;
      for (let r = 1; r <= Math.max(1, n); r++) {
        const c = Math.ceil(n / r);
        if (r > 1 && Math.ceil(n / (r - 1)) === c) continue;   // the same columns with an emptier last row
        const byW = (W - (c - 1) * gx) / c;
        const byH = (H - (r - 1) * gy) / r / CARD_RATIO;
        const w = Math.min(byW, byH, maxW);
        if (!best || w > best.w + 0.5) best = { w, r };
        if (byH < minW) break;      // more rows only make them shorter still
      }
      if (!best) best = { w: maxW, r: 1 };
      // past the smallest readable size it scrolls instead, at that size and as many across as fit
      if (best.w < minW) {
        const c = Math.max(1, Math.floor((W + gx) / (minW + gx)));
        best = { w: Math.min(minW, (W - (c - 1) * gx) / c), r: Math.ceil(n / c) };
      }
      const r = Math.max(1, best.r);
      const rows = [];
      for (let i = 0; i < r; i++) rows.push(Math.floor(n / r) + (i < n % r ? 1 : 0));
      return { w: best.w, rows: rows.filter(x => x > 0) };
    }

    render() {
      const v = this.view;
      if (!v) return;
      const need = this._need(v);

      /* -- the head: where you are in the draft, over the pack's best card -- */
      this.head.innerHTML = '';
      const best = UI.packOrder(v.pack || []).find(c => UI.packBand(c) < 9) || (v.pack || [])[0];
      const art = el('div', { class: 'draft-head-art', 'aria-hidden': 'true' });
      if (best) UI.setArt(art, best);
      const packSize = Math.max(v.pack.length + (v.pick || 1) - 1, v.pack.length);
      const dots = el('div', { class: 'pick-dots', 'aria-hidden': 'true' });
      for (let i = 1; i <= Math.min(packSize, 20); i++) {
        dots.appendChild(el('i', { class: i < v.pick ? 'done' : i === v.pick ? 'now' : '' }));
      }
      const confirm = el('button', {
        class: 'btn primary hero-btn draft-go',
        text: v.broker ? 'Trading' : v.blind ? 'At random'
          : this.ability && need === 0 ? 'Take the whole pack'
          : (this.chosen.length === need ? `Confirm pick${need > 1 ? 's' : ''}` : `Pick ${this.chosen.length}/${need}`),
        disabled: (need > 0 && this.chosen.length !== need) || !v.pack.length || v.sittingOut || !!v.blind || !!v.broker,
        onclick: () => { this.confirmPick(); },
      });
      this.head.append(
        art,
        el('div', { class: 'draft-where' }, [
          el('div', { class: 'eyebrow', text: (v.setsUsed || []).join(' · ') || 'Mixed packs' }),
          el('div', { class: 'draft-title' }, v.allAtOnce ? [
            // every pack open at once: how many are in front of you, and the pick
            el('span', { text: `All ${v.totalRounds} packs` }),
            el('i', { text: v.packsWaiting > 1 ? `${v.packsWaiting} in front of you` : 'open' }),
            el('span', { class: 'draft-pick', text: `Pick ${v.pick}` }),
          ] : [
            el('span', { text: `Pack ${v.round}` }),
            el('i', { text: `of ${v.totalRounds}` }),
            el('span', { class: 'draft-pick', text: `Pick ${v.pick}` }),
          ]),
          dots,
        ]),
        el('div', { class: 'draft-flags' }, [
          v.picksPerTurn > 1 ? el('span', { class: 'pill warn', text: `pick ${v.picksPerTurn}` }) : null,
          (v.looseSets && v.looseSets.length) ? el('span', {
            class: 'pill warn', text: 'approximate collation',
            title: `${v.looseSets.join(', ')} was not sold in draft boosters, so these packs are built from the whole set rather than a real pack recipe.`,
          }) : null,
        ].filter(Boolean)),
        el('span', { class: 'grow' }),
        el('div', { class: 'draft-act' }, [
          el('span', { class: 'wait-note', text: v.waitingOn.length ? 'Waiting on ' + v.waitingOn.join(', ') : 'All picks in…' }),
          confirm,
        ]),
      );
      const bar = this._abilityBar(v);
      if (bar) this.head.appendChild(bar);

      /* -- the pack, dealt out like cards on a table -- */
      this.packWrap.innerHTML = '';
      if (v.broker) {
        this.packWrap.appendChild(this._brokerPanel(v));
      } else if (v.blind) {
        // Archdemon of Paliano: the pack is drafted from without being looked at
        this.packWrap.appendChild(el('div', { class: 'draft-waiting' }, [
          el('div', { class: 'busy-sigil', 'aria-hidden': 'true' }, [el('i'), el('i'), el('b')]),
          el('div', { text: `Archdemon of Paliano: you cannot look at this pack, and draft from it at random (${v.blind.left} more card${v.blind.left === 1 ? '' : 's'}).` }),
        ]));
      } else if (!v.pack.length) {
        this.packWrap.appendChild(el('div', { class: 'draft-waiting' }, [
          el('div', { class: 'busy-sigil', 'aria-hidden': 'true' }, [el('i'), el('i'), el('b')]),
          el('div', { text: 'Waiting for the next pack…' }),
        ]));
      } else {
        const grid = el('div', { class: 'pack-grid' + (this.chosen.length ? ' choosing' : '') });
        const order = UI.packOrder(v.pack);
        const fit = this._packFit(order.length);
        grid.style.setProperty('--card-w', fit.w.toFixed(1) + 'px');
        grid.style.setProperty('--card-h', (fit.w * CARD_RATIO).toFixed(1) + 'px');
        const rows = fit.rows.map(() => el('div', { class: 'pack-row' }));
        rows.forEach(r => grid.appendChild(r));
        const rowOf = (i) => { let k = i; for (let r = 0; r < fit.rows.length; r++) { if (k < fit.rows[r]) return rows[r]; k -= fit.rows[r]; } return rows[rows.length - 1]; };
        // rarest first, left to right and down the rows
        order.forEach((c, i) => {
          const chosen = this.chosen.includes(c.id);
          const slot = UI.cardSlot(c, {}, {
            class: 'pick-card' + (chosen ? ' chosen' : '') + ' r-' + (c.rarity || 'common') + (c._foil ? ' foil' : ''),
            onClick: () => { this._toggle(c); MTG.sfx('click'); this.render(); },
            onDblClick: () => this._confirmCard(c),
            // Enter picks the card up, Space sends the pick; the slot's own
            // handler treats both as a click, so Space is claimed here
            onKey: (e) => {
              if (e.key !== ' ' && e.key !== 'Spacebar') return false;
              e.stopPropagation();
              this.confirmPick();
              return true;
            },
          });
          slot.setAttribute('aria-pressed', chosen ? 'true' : 'false');
          slot.style.setProperty('--i', String(i));
          slot.appendChild(el('span', { class: 'rar ' + c.rarity, text: (c.rarity || '')[0].toUpperCase() }));
          slot.appendChild(UI.autoBadge(c, { corner: true }));
          if (chosen) slot.appendChild(el('span', { class: 'pick-flag', text: need > 1 ? `Pick ${this.chosen.indexOf(c.id) + 1}` : 'Your pick' }));
          rowOf(i).appendChild(slot);
        });
        // a new pack deals itself out; a re-render of the same pack does not
        const packKey = v.round + ':' + v.pick;
        if (this._dealt !== packKey) { this._dealt = packKey; grid.classList.add('dealing'); }
        this.packWrap.appendChild(grid);
        this.packWrap.appendChild(el('div', { class: 'pick-hint' }, [
          el('span', { text: this.chosen.length
            ? 'Click it again or click the table to put it back.'
            : 'Click to choose.' }),
          el('span', { text: '·' }),
          el('span', { text: 'Double-click a card, or press ' }),
          el('span', { class: 'kbd', text: 'Space' }),
          el('span', { text: ' to confirm.' }),
        ]));
      }

      this._renderPool(v);
    }

    /**
     * What you have drafted so far: how it splits across the colours, how
     * it curves, and the cards themselves in colour columns, each a strip of
     * its art — the way you would sort your picks into piles on the table.
     */
    _renderPool(v) {
      const keepTop = this.poolWrap.querySelector('.pool-cols') ? this.poolWrap.querySelector('.pool-cols').scrollTop : 0;
      this.poolWrap.innerHTML = '';
      const pool = v.pool || [];
      const COLS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['M', 'Multicolor'], ['C', 'Colourless'], ['L', 'Lands']];
      const bucket = (c) => {
        if (/\bLand\b/.test(c.type_line || '')) return 'L';
        const ci = c.colors && c.colors.length ? c.colors : (c.color_identity || []);
        if (!ci.length) return 'C';
        return ci.length > 1 ? 'M' : ci[0];
      };
      const groups = new Map(COLS.map(([k]) => [k, []]));
      for (const c of pool) groups.get(bucket(c)).push(c);
      const curve = [0, 0, 0, 0, 0, 0, 0];
      for (const c of pool) if (!/\bLand\b/.test(c.type_line || '')) curve[Math.min(6, Math.floor(c.cmc || 0))]++;
      const maxC = Math.max(1, ...curve);
      const spells = pool.filter(c => !/\bLand\b/.test(c.type_line || '')).length;

      const head = el('div', { class: 'pool-head' }, [
        el('div', { class: 'pool-title' }, [el('strong', { text: 'Your pool' }), el('span', { class: 'pool-n', text: String(pool.length) })]),
        // the colour split as one bar, so the two colours you are in stand out
        el('div', { class: 'pool-split', role: 'img', 'aria-label': 'Colour split of your picks' },
          COLS.slice(0, 7).filter(([k]) => groups.get(k).length).map(([k, name]) => el('i', {
            class: 'seg-' + k.toLowerCase(), title: `${name}: ${groups.get(k).length}`,
            style: { flexGrow: String(groups.get(k).length) },
          }))),
        el('div', { class: 'pool-curve', role: 'img', 'aria-label': 'Mana curve of your picks', title: 'Mana curve of your spells' },
          curve.map((n, i) => el('i', { style: { height: Math.max(8, n / maxC * 100) + '%' }, class: n ? '' : 'none', title: `${i === 6 ? '6+' : i}: ${n}` }))),
        el('span', { class: 'tiny dim', text: `${spells} spells` }),
      ]);
      this.poolWrap.appendChild(head);

      if (!pool.length) {
        this.poolWrap.appendChild(el('div', { class: 'empty-note', text: 'Your picks collect here as the packs go round.' }));
        return;
      }
      const abilityIds = new Set((v.abilities || []).map(a => a.cardId));
      const cols = el('div', { class: 'pool-cols' });
      for (const [k, name] of COLS) {
        const list = groups.get(k);
        if (!list.length) continue;
        list.sort((a, b) => (a.cmc || 0) - (b.cmc || 0) || String(a.name).localeCompare(String(b.name)));
        const col = el('div', { class: 'pool-col col-' + k.toLowerCase() }, [
          el('div', { class: 'pool-col-head' }, [
            k === 'M' || k === 'C' || k === 'L' ? el('span', { class: 'pool-col-name', text: name })
              : el('i', { class: 'pip pip-' + k.toLowerCase(), text: k, title: name }),
            el('span', { text: String(list.length) }),
          ]),
        ]);
        for (const card of list) {
          const a = MTG.oracle.analyze(card) || {};
          const row = el('div', {
            class: 'pool-card strip' + (abilityIds.has(card.id) ? ' has-draft-ability' : ''),
            tabindex: '0', role: 'button', 'aria-label': UI.describeCard(card),
          }, [
            el('span', { class: 'nm', text: card.name }),
            UI.autoInfo(card).auto ? null : UI.autoBadge(card),
            el('span', { class: 'cost', html: MTG.mana.html(a.manaCost || card.mana_cost || '') }),
            abilityIds.has(card.id) ? el('span', { class: 'draft-flag', text: '◆', title: 'This card does something during the draft' }) : null,
          ].filter(Boolean));
          UI.setArt(row, card);
          UI.attachPreview(row, card, 0);
          row.addEventListener('click', () => UI.cardSheet(card));
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); UI.cardSheet(card); } });
          col.appendChild(row);
        }
        cols.appendChild(col);
      }
      this.poolWrap.appendChild(cols);
      cols.scrollTop = keepTop;
    }
  }

  UI.DraftTable = DraftTable;

  /* ---------------- limited deck-build step ---------------- */

  UI.buildFromPool = async function (pool, formatId, onDone) {
    const fmt = MTG.formats.get(formatId);
    const busy = UI.busy('Preparing', 'Fetching basic lands…');
    let basics = {};
    try { basics = await MTG.draft.getBasics(); } catch (e) {}
    busy.close();

    // conspiracies and the cards exiled before the game are settled once the deck is
    let deck = MTG.draft.autoBuildLimited(pool, {
      deckSize: fmt.deckMin || 40, basicCards: basics, formatId, name: 'Limited deck', pregame: false,
    });
    // the conspiracies drafted, so the deck's size can allow for one kept before the game (Advantageous Proclamation)
    deck.draftedConspiracies = (pool || []).filter(MTG.draft.isConspiracy).map(c => c.name);

    // Commander draft: choose a commander out of the pool
    if (fmt.commander) {
      const legends = pool.filter(c => MTG.formats.canBeCommander(c, fmt));
      if (legends.length) {
        const chosen = await new Promise(res => {
          const grid = el('div', { class: 'card-grid' });
          const m = UI.modal({
            title: 'Choose your commander', width: '960px', closable: false, className: 'commander-pick',
            content: el('div', null, [
              el('p', { class: 'small muted', text: 'Pick one of the legendary creatures you drafted to lead the deck. Staying inside its colour identity is optional in commander draft, but 60 cards is the minimum.' }),
              grid,
            ]),
          });
          for (const c of legends) {
            grid.appendChild(UI.cardSlot(c, {}, { onClick: () => { m.close(); res(c); } }));
          }
        });
        deck.commanders = [chosen];
        deck.main = deck.main.filter(e => e.card.id !== chosen.id);
      }
    }

    // a drafted pool becomes a named deck, so saving it is worth offering here
    const stamp = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    deck.name = `${fmt.name} \u2014 ${stamp}`;

    UI.deckBuilder(deck, {
      drafted: true,
      finish: { label: 'Play with this deck', onClick: async (d) => {
        const ready = await UI.draftPregame(d, pool);
        if (onDone) onDone(ready);
      } },
    });
  };

  /* ---------------- before the game: conspiracies, and cards exiled from the pool ----------------
     A drafted conspiracy starts the game in the command zone if its owner
     wants it to, a hidden agenda with a name chosen for it; Arcane Savant,
     Caller of the Untamed and Volatile Chimera take drafted cards that are
     not in the deck into exile. The table's own choices are filled in to
     start from (MTG.draft.pregameDefaults). Resolves with the deck. */
  UI.draftPregame = function (deck, pool) {
    const D = MTG.draft;
    const conspiracies = (pool || []).filter(D.isConspiracy);
    const exilers = [];
    for (const e of (deck.main || [])) {
      const key = U.normName(U.frontName(e.card.name));
      if (D.PREGAME_EXILE[key]) for (let k = 0; k < e.qty; k++) exilers.push({ key, card: e.card, rule: D.PREGAME_EXILE[key] });
    }
    const defaults = D.pregameDefaults(deck, pool);
    if (!conspiracies.length && !exilers.length) return Promise.resolve(D.applyPregame(deck, defaults));

    return new Promise((res) => {
      const body = el('div', { class: 'col draft-pregame' });
      const rows = [];
      const hasBasics = (deck.main || []).some(e => MTG.formats.isBasicLand(e.card));
      const nameList = D.agendaNames(deck, 'any');
      if (conspiracies.length) {
        body.appendChild(el('div', { class: 'section-title', text: 'Conspiracies' }));
        body.appendChild(el('div', { class: 'tiny dim', text: 'Each one you keep starts the game in your command zone. A hidden agenda starts face down, with the name you choose kept secret until a card with that name is cast or comes into play.' }));
        conspiracies.forEach((c, i) => {
          const key = U.normName(U.frontName(c.name));
          const def = defaults.conspiracies.find(x => x.card === c) || null;
          const ag = D.agendaOf(c);
          const use = el('input', { type: 'checkbox', checked: !!def, style: { width: 'auto' }, id: 'pg-c' + i });
          const blocked = key === "sovereign's realm" && hasBasics;
          if (blocked) { use.checked = false; use.disabled = true; }
          const selects = [];
          if (ag && ag.names) {
            for (let k = 0; k < ag.names; k++) {
              const want = def && def.names ? def.names[k] : nameList[k];
              selects.push(el('select', { 'aria-label': `Name for ${c.name}` },
                nameList.map(nm => el('option', { value: nm, text: nm, selected: nm === want }))));
            }
          }
          if (ag && ag.number) {
            selects.push(el('select', { 'aria-label': `Number for ${c.name}` },
              ag.number.map(nm => el('option', { value: String(nm), text: String(nm), selected: def && def.number === nm }))));
          }
          const label = el('label', { for: 'pg-c' + i, text: c.name });
          UI.attachPreview(label, c, 0);
          body.appendChild(el('div', { class: 'row wrap' }, [use, label].concat(selects,
            blocked ? [el('span', { class: 'tiny dim', text: 'Your deck has basic lands, so this cannot start the game.' })] : [])));
          rows.push({ card: c, use, selects, ag });
        });
      }
      const exRows = [];
      if (exilers.length) {
        body.appendChild(el('div', { class: 'section-title', text: 'Before you shuffle' }));
        const side = (deck.sideboard || []).map(e => e.card).filter(c => c && !D.isConspiracy(c) && !MTG.formats.isBasicLand(c));
        exilers.forEach((x, i) => {
          const picked = new Set(defaults.draftExiled.filter(d => d.with === x.key).map(d => d.card.id));
          const fits = side.filter(c => (x.rule.words === 'creature' ? /\bCreature\b/.test(c.type_line || '') : /\b(?:Instant|Sorcery)\b/.test(c.type_line || '')));
          body.appendChild(el('div', { class: 'tiny dim', text: `${x.card.name}: you may exile ${x.rule.label} that is not in your deck.` }));
          const boxes = fits.map((c, k) => {
            const box = el('input', { type: 'checkbox', checked: picked.has(c.id), style: { width: 'auto' }, id: `pg-x${i}-${k}` });
            const lab = el('label', { for: `pg-x${i}-${k}`, text: c.name });
            UI.attachPreview(lab, c, 0);
            body.appendChild(el('div', { class: 'row' }, [box, lab]));
            return { box, card: c };
          });
          if (!fits.length) body.appendChild(el('div', { class: 'tiny dim', text: 'Nothing you drafted fits.' }));
          exRows.push({ x, boxes });
        });
      }
      const done = () => {
        const choice = { conspiracies: [], draftExiled: [] };
        for (const r of rows) {
          if (!r.use.checked) continue;
          const entry = { card: r.card };
          if (r.ag && r.ag.names) entry.names = r.selects.map(s => s.value);
          if (r.ag && r.ag.number) entry.number = Number(r.selects[0].value);
          if (r.ag && r.ag.names === 2 && entry.names[0] === entry.names[1]) { UI.error(`${r.card.name} needs two different names.`); return; }
          choice.conspiracies.push(entry);
        }
        const used = new Set();
        for (const r of exRows) {
          const got = r.boxes.filter(b => b.box.checked && !used.has(b.card.id));
          if (got.length && (got.length < r.x.rule.min || got.length > r.x.rule.max)) {
            UI.error(`${r.x.card.name} exiles ${r.x.rule.label}.`);
            return;
          }
          for (const b of got) { used.add(b.card.id); choice.draftExiled.push({ card: b.card, with: r.x.key }); }
        }
        m.close();
        res(D.applyPregame(deck, choice));
      };
      const m = UI.modal({
        title: 'Before the game', width: '720px', closable: false, content: body,
        buttons: [{ label: 'Start the game', class: 'primary', onClick: () => done() }],
      });
    });
  };

  /* ---------------- cube manager ---------------- */

  UI.cubeManager = function (onPick) {
    const list = el('div');
    const m = UI.modal({
      title: 'Cubes', width: '680px', content: list,
      buttons: [
        { label: 'Import a cube…', onClick: () => importCube() },
        { label: 'Close', onClick: () => m.close() },
      ],
    });
    function render() {
      list.innerHTML = '';
      const all = MTG.draft.cubes.list();
      if (!all.length) list.appendChild(el('div', { class: 'empty-note', text: 'No cubes yet. Paste a CubeCobra plain-text or CSV export to add one.' }));
      for (const c of all) {
        list.appendChild(el('div', { class: 'roster-row' }, [
          UI.avatar(c.name),
          el('div', { class: 'grow' }, [
            el('div', { text: c.name }),
            el('div', { class: 'tiny dim', text: `${c.size} cards · packs of ${c.packSize}` }),
          ]),
          el('button', { class: 'btn xs danger', text: 'Delete', onclick: async () => {
            if (await UI.confirm(`Delete cube "${c.name}"?`)) { MTG.draft.cubes.remove(c.id); render(); }
          } }),
          onPick ? el('button', { class: 'btn xs primary', text: 'Use', onclick: async () => {
            const busy = UI.busy('Loading cube');
            const full = await MTG.draft.cubes.load(c.id);
            busy.close();
            if (!full) return UI.error('Could not load that cube.');
            m.close(); onPick(full);
          } }) : null,
        ]));
      }
      renderRecipes();
    }

    /* Cubes you can have without owning one. Each is built from Scryfall on
       the spot and then lives among your own, where you can use, rebuild or
       delete it like any other. */
    function renderRecipes() {
      list.appendChild(el('div', { class: 'section-title', style: { marginTop: '14px' }, text: 'Popular kinds of cube' }));
      list.appendChild(el('div', { class: 'tiny dim', style: { margin: '0 0 8px' },
        text: 'Built fresh from the most-played cards that fit: singleton, colour-balanced, and yours to change once it is built.' }));
      for (const r of MTG.draft.recipes) {
        const have = MTG.draft.cubes.list().find(c => c.recipe === r.id);
        list.appendChild(el('div', { class: 'roster-row recipe-row' }, [
          el('div', { class: 'grow', style: { minWidth: 0 } }, [
            el('div', null, [
              el('strong', { text: r.name }),
              el('span', { class: 'tiny dim', text: `\u2002${r.size} cards \u00b7 packs of ${r.packSize}` }),
            ]),
            el('div', { class: 'tiny dim', text: r.blurb }),
          ]),
          el('button', {
            class: 'btn xs' + (have ? '' : ' primary'),
            text: have ? 'Build again' : 'Build',
            title: have ? 'Build this cube again from today\u2019s card pool' : 'Build this cube and save it',
            onclick: () => buildFromRecipe(r),
          }),
        ]));
      }
    }

    async function buildFromRecipe(r) {
      const busy = UI.busy('Building ' + r.name, 'Asking Scryfall for the cards\u2026');
      try {
        const cards = await MTG.draft.buildRecipe(r, {
          onProgress: (a, b, label) => busy.set(a / b, `${label} \u2014 ${a}/${b} cards`),
        });
        busy.close();
        if (cards.length < 30) return UI.error('Could not reach Scryfall for enough cards to build that cube.');
        const existing = MTG.draft.cubes.list().find(c => c.recipe === r.id);
        const saved = MTG.draft.cubes.save({
          id: existing ? existing.id : MTG.uid('cube'), name: r.name, recipe: r.id,
          cards, packSize: r.packSize, packs: 3,
        });
        UI.ok(`${r.name} built: ${cards.length} cards.`);
        render();
        if (onPick) { m.close(); onPick(Object.assign({}, saved, { cards })); }
      } catch (e) { busy.close(); UI.error(e.message || String(e)); }
    }

    function importCube() {
      const ta = el('textarea', { rows: 14, placeholder: 'One card name per line, or a CubeCobra CSV export.' });
      const nameI = el('input', { type: 'text', placeholder: 'Cube name' });
      const packSize = el('input', { type: 'number', value: '15', min: '5', max: '30' });
      const im = UI.modal({
        title: 'Import a cube', width: '700px',
        content: el('div', null, [
          el('label', { class: 'field' }, [el('span', { text: 'Name' }), nameI]),
          el('label', { class: 'field' }, [el('span', { text: 'Cards per pack' }), packSize]),
          ta,
        ]),
        buttons: [{ label: 'Import', class: 'primary', onClick: async () => {
          const busy = UI.busy('Importing cube', 'Resolving cards…');
          try {
            const res = await MTG.decklist.importCube(ta.value, { onProgress: (a, b) => busy.set(a / b, `Resolving… ${a}/${b}`) });
            busy.close();
            if (!res.cards.length) return UI.error('No cards were recognised.');
            MTG.draft.cubes.save({
              id: MTG.uid('cube'), name: nameI.value.trim() || 'Untitled cube',
              cards: res.cards, packSize: parseInt(packSize.value, 10) || 15, packs: 3,
            });
            if (res.missing.length) UI.toast(`${res.missing.length} card(s) not found and skipped.`, 'err', 5000);
            else UI.ok(`Cube saved: ${res.cards.length} cards.`);
            im.close(); render();
          } catch (e) { busy.close(); UI.error(e.message); }
        } }],
      });
    }
    render();
    return m;
  };
})(window.MTG);


