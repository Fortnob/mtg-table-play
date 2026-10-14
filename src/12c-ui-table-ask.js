/* ============================================================
   12c-ui-table-ask.js - the questions the game asks

   Everything the table needs from you that is not "play a card" or "pass":
   the opening hand, choosing targets, kicker and X, attackers and blockers,
   and every question the engine stops to ask mid-resolution — scry, modes,
   "choose a card", "pay or not". Each is asked in one consistent place: a
   banner across the top says what is being asked, and anything that needs
   cards laid out to choose between gets a panel in the middle of the table.

   The answers go back as the same intents the engine has always taken.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const { truncate, escapeHtml, possessive } = Table.helpers;
  // what a finger does to a card, and what a mouse does
  const press = () => (MTG.isTouch() ? 'Tap' : 'Click');

  Object.assign(Table.prototype, {

    /* ---------------- the banner: what is being asked of you ---------------- */
    renderBanner() {
      const v = this.view, live = this.live || v;
      const b = this.banner;
      const set = (cls, title, sub, extra) => {
        const sig = cls + '|' + title + '|' + (sub || '') + '|' + (extra ? extra.sig || '' : '');
        if (b._sig === sig) return;
        b._sig = sig;
        b.className = 'arena-banner on ' + cls;
        b.innerHTML = '';
        b.append(el('div', { class: 'ab-title', html: title }));
        if (sub) b.append(el('div', { class: 'ab-sub', html: sub }));
        if (extra && extra.node) b.append(extra.node);
      };
      const off = () => { if (b._sig !== '') { b._sig = ''; b.className = 'arena-banner'; b.innerHTML = ''; } };
      if (v.over || v.mulliganPhase) return off();

      if (this.targeting) {
        const t = this.targeting;
        const who = (v.players || []).filter(p => this.isTargetablePlayer(p));
        const spec = t.specs[t.chosen.length] || t.specs[0];
        const what = spec && !t.legal ? specText(spec) : 'a target';
        // a target the kick, the gift or an "if" brought in: what it is for, as the button says (Jilt (kicked): …)
        const title = spec && spec.castWhy && t.label ? escapeHtml(t.label)
          : t.cardName ? `${escapeHtml(t.cardName)}: choose ${escapeHtml(what)}` : escapeHtml(t.label || 'Choose a target');
        // "up to one": it can be left out (Return to Dust's second artifact)
        const skip = (t.specs || []).some(sp => sp && sp.upTo) && !((t.minChosen || 0) > t.chosen.length);
        return set('aim', title,
          `${t.need > 1 ? `Target ${t.chosen.length + 1} of ${t.need}. ` : ''}${press()} a highlighted card${who.length ? ' or player' : ''}` +
          (skip ? `, or press <b>${t.chosen.length ? 'Done' : 'No targets'}</b> to ${t.chosen.length ? 'stop there' : 'skip it'}.` : '.') +
          (t.legal ? '' : ' <kbd>Esc</kbd> to cancel.'));
      }
      if (this.convoking) {
        const b2 = this.convokeBanner();
        return set(b2.cls, b2.title, b2.sub, b2.extra);
      }
      if (this.paying) {
        const p = this.paying;
        const pool = this.me && this.me.pool ? ['W', 'U', 'B', 'R', 'G', 'C'].map(c => `{${c}}`.repeat(this.me.pool[c] || 0)).join('') : '';
        const cost = p.intent.x ? p.cost.replace(/\{X\}/g, `{${p.intent.x}}`) : p.cost;
        // (a phone shows the title alone, so the title says what to do)
        return set('ask pay', `${escapeHtml(p.name)}: tap lands to pay ${MTG.mana.html(cost)}`,
          `${press()} a glowing land to tap it for mana. Once your mana pool covers the cost, it ${p.intent.kind === 'cast' ? 'is cast' : 'happens'}.` +
          (pool ? ` In your pool: ${MTG.mana.html(pool)}.` : ''));
      }
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          const defs = ch.defenders || [];
          // who each one attacks is chosen on the table: the creature, then the player at the top or the planeswalker
          let extra = null;
          // banding: the chosen attackers can go in together, as one band
          const band = this._bandRow(ch);
          if (band) extra = band;
          if (this.attackPlan && this.attackPlan.pending) {
            return set('combat', 'Now choose what it attacks', `${press()} a player at the top, or a planeswalker or battle, to send it there. ${press()} the creature again to put it back.`, extra);
          }
          return set('combat', 'Choose attackers', defs.length > 1
            ? `${press()} a creature, then the player or planeswalker it attacks. Press <b>Attack</b> when they are all chosen.`
            : `${press()} your creatures to send them in, then press <b>Attack</b>.`, extra);
        }
        if (ch.type === 'declareBlockers') {
          const atk = (ch.attackers || []).map(id => this.objIn(id)).filter(Boolean);
          const incoming = atk.reduce((s, o) => s + (o.power || 0), 0);
          const pend = this.blockPlan && this.blockPlan.pendingBlocker;
          const me = this.me;
          // Odric, Master Tactician: another player's creatures, and how they block, are yours to choose (blockingPlayer)
          const them = ch.blockingPlayer ? ((this.live || this.view).players || []).find(p => p.id === ch.blockingPlayer) : null;
          if (them) {
            return set('combat block', pend ? `Now ${press().toLowerCase()} the attacker it blocks` : `Choose ${them.name}'s blockers`,
              `You choose which of ${them.name}'s creatures block, and how · <b>${incoming}</b> damage coming at them (${them.life} life).` +
              (pend ? '' : ` ${press()} one of their creatures, then the attacker it blocks, or press <b>No blocks</b>.`));
          }
          return set('combat block', pend ? `Now ${press().toLowerCase()} the attacker to block` : 'Choose blockers',
            `${atk.length} attacker${atk.length === 1 ? '' : 's'} · <b>${incoming}</b> damage coming at you${me ? ` (you have ${me.life})` : ''}.` +
            (pend ? '' : ` ${press()} your creature, then the attacker it blocks.`));
        }
        if (ch.type === 'discard' || ch.type === 'discardToHandSize')
          return set('ask', escapeHtml(ch.prompt || 'Discard'), (ch.count || 1) > 1 ? `Choose ${ch.count} cards from your hand.` : `${press()} a card in your hand.`);
        if (ch.type === 'sacrifice')
          return set('ask', escapeHtml(ch.prompt || (ch.exileInstead ? 'Exile' : 'Sacrifice')), (ch.count || 1) > 1 ? `Choose ${ch.count} of your permanents.` : `${press()} one of your permanents.`);
        // a generic question answered on the board alone: what to click, and how the picks stand
        if (this.chooseHere(ch)) {
          const s = this.chooseSpec(ch);
          const board = this.chooseBoardIds(s);
          if (s.kind === 'players' || (s.kind === 'objects' && s.items.length && s.items.every(x => board.has(x.id)))) {
            const b2 = this.chooseBanner(ch);
            return set(b2.cls, b2.title, b2.sub, b2.extra);
          }
        }
        return off();
      }
      if (ch && ch.waiting) {
        const who = v.players.find(p => p.id === ch.playerId);
        return set('wait', `${escapeHtml(who ? who.name : 'Someone')} is deciding…`, '');
      }
      if (live.priorityPlayer === this.meId && (live.stack || []).length && !this.isTop()) {
        const top = live.stack[live.stack.length - 1];
        const who = v.players.find(p => p.id === top.controller);
        return set('respond', `${escapeHtml(possessive(who ? who.name : 'Someone'))} ${escapeHtml(top.name)} is on the stack`,
          (live.playable || []).length ? 'Respond with an instant or ability, or press <b>Resolve</b>.' : 'Press <b>Resolve</b> to let it happen.');
      }
      off();
    },

    /** Whether the top of the stack is yours. */
    isTop() {
      const s = (this.live || this.view).stack || [];
      return !!(s.length && s[s.length - 1].controller === this.meId);
    },

    /* ---------------- the panel: questions that need laying out ---------------- */
    renderDecision() {
      const v = this.view, live = this.live || v;
      const host = this.decision;
      let want = null;     // {key, build}
      // (the rewards, once settled, redraw it: _overStamp)
      if (v.over) want = { key: 'over:' + (v.winners || []).join(',') + ':' + JSON.stringify(v.match || {}) + ':' + (this._overStamp || 0), build: () => this.gameOverPanel() };
      else if (v.mulliganPhase && this.me && !this.me.keptHand) {
        /* drawn again only when what it shows changes — this hand, how many go to the bottom, which are
           chosen, who plays first — not when somebody else keeps or mulligans; a pick changed is drawn
           again in place, without coming in afresh (the same base) */
        const me = this.me, hand = me.hand.map(o => o.id).join(',');
        const base = 'mull:' + me.mulligansTaken + ':' + hand;
        want = { key: base + ':' + (me.mulliganBottom != null ? me.mulliganBottom : '') + ':' + this.mulliganBottom.join(',') + ':' + ((v.turnOrder || [])[0] || ''),
          base, build: () => this.mulliganPanel() };
      }
      else if (v.mulliganPhase && this.me) want = { key: 'mullwait', build: () => this.waitPanel('Waiting for the other players to keep their hands…') };
      else if (this.asking) want = { key: 'ask:' + this.asking.key, base: 'ask:' + (this.asking.base || this.asking.key), build: () => this.asking.build() };
      else {
        const ch = live.pendingChoice;
        if (ch && ch.playerId === this.meId && !ch.waiting && this._ready()) {
          const base = 'ch:' + ch.type + ':' + (ch.prompt || '') + ':' + JSON.stringify(ch.cards ? ch.cards.map(c => c.id) : ch.options || '');
          const build = this.choiceBuilder(ch);
          if (build) want = { key: base + this.chooseKeyExtra(ch), base, build };
        }
      }
      if (!want) {
        if (host._key) { host._key = null; host._base = null; host.innerHTML = ''; host.className = 'decision-host'; }
        return;
      }
      if (host._key === want.key && !want.live) return;
      if (host._key !== want.key) {
        host._key = want.key;
        host._state = {};
      }
      host.innerHTML = '';
      const node = want.build(host._state);
      if (!node) { host._key = null; host._base = null; host.className = 'decision-host'; return; }
      // the same question with a pick changed is drawn again in place, not brought in afresh
      if (want.base && host._base === want.base) node.style.animation = 'none';
      host._base = want.base || null;
      host.className = 'decision-host on ' + (node._wide ? 'wide' : '') + (node._full ? ' full' : '');
      if (node._full) this.hidePreview();
      host.appendChild(node);
    },

    /** A panel: a title, an optional line under it, a body and a row of buttons. */
    panel(title, sub, body, buttons, opts) {
      opts = opts || {};
      // the card asking: its art behind the whole panel, darkened under the words
      const art = opts.card ? MTG.scry.imageUrl(opts.card, 'art_crop', 0) : '';
      const p = el('div', { class: 'dpanel' + (art ? ' has-art' : '') + (opts.cls ? ' ' + opts.cls : '') }, [
        art ? el('div', { class: 'dp-bg', 'aria-hidden': 'true', style: { backgroundImage: 'url("' + art.replace(/"/g, '%22') + '")' } }) : null,
        el('div', { class: 'dp-head' }, [
          opts.card ? el('div', { class: 'dp-art', style: { backgroundImage: 'url("' + (MTG.scry.imageUrl(opts.card, 'art_crop', 0) || '').replace(/"/g, '%22') + '")' } }) : null,
          el('div', { class: 'dp-titles' }, [
            el('div', { class: 'dp-title', html: title }),
            sub ? el('div', { class: 'dp-sub', html: sub }) : null,
          ].filter(Boolean)),
        ].filter(Boolean)),
        body || null,
        buttons && buttons.length ? el('div', { class: 'dp-buttons' }, buttons.map(b => b && el('button', {
          type: 'button', class: 'btn ' + (b.cls || ''), disabled: !!b.disabled, html: b.html || null, text: b.html ? null : b.label,
          title: b.title || null, onclick: b.fn,
        })).filter(Boolean)) : null,
      ].filter(Boolean));
      if (opts.wide) p._wide = true;
      return p;
    },

    waitPanel(text) {
      const p = this.panel(escapeHtml(text), '', null, []);
      p.classList.add('slim');
      return p;
    },

    /** A face-up card for choosing, not one of the table's own elements. */
    pickTile(card, opts) {
      opts = opts || {};
      const url = card ? MTG.scry.imageUrl(card, 'normal', opts.face || 0) : '';
      const t = el('button', { type: 'button', class: 'pick-tile' + (opts.cls ? ' ' + opts.cls : ''), title: card ? card.name : '' }, [
        url ? el('div', { class: 'pt-img', style: { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } })
          : (card ? UI.cardFallback(card, 0) : el('div', { class: 'pt-img blank' })),
        opts.badge != null ? el('span', { class: 'pt-badge', text: String(opts.badge) }) : null,
        opts.label ? el('span', { class: 'pt-label', text: opts.label }) : null,
      ].filter(Boolean));
      if (card) UI.attachPreview(t, card, opts.face || 0);
      if (opts.onClick) t.addEventListener('click', opts.onClick);
      return t;
    },

    choiceBuilder(ch) {
      const send = (data) => { this.send({ kind: 'choice', data }); };
      const src = ch.objId ? this.objIn(ch.objId) : (ch.sourceId ? this.objIn(ch.sourceId) : null);
      const card = ch.sourceCard || (src && src.card ? src.card : null);
      /* The card asking is the headline when there is one; the question goes underneath, whole, and
         the ability asking whole beneath it when the question does not already say all of it. A
         prompt that leads with the ability's own label ("Titan of Littjara — Whenever …: you may …")
         loses the label: the card and the ability are both shown in full instead. */
      const head = (fallback, extra) => {
        let raw = String(ch.prompt || fallback || '');
        const lead = [ch.sourceName, card && card.name].find(x => x && raw.startsWith(x + ': '));
        if (lead) raw = raw.slice(lead.length + 2).replace(/^./, c => c.toUpperCase());
        const title = card ? card.name : ch.sourceName ? String(ch.sourceName).split(' \u2014 ')[0] : '';
        const text = String(ch.sourceText || '').replace(/CARDNAME/g, card ? card.name : 'this');
        const flat = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        let ability = text && !flat(raw).includes(flat(text)) && !(title && flat(text) === flat(title)) ? text : '';
        // a question that is only part of the ability ("you may draw …") is the ability, read whole, once
        if (ability && raw && flat(ability).includes(flat(raw))) { raw = ability; ability = ''; }
        const sub = escapeHtml(raw) + (extra ? ' ' + extra : '') + (ability ? `<span class="dp-ability">${MTG.mana.textHtml(ability)}</span>` : '');
        return title && title !== raw ? [escapeHtml(title), sub] : [escapeHtml(raw), (extra || '') + (ability ? `<span class="dp-ability">${MTG.mana.textHtml(ability)}</span>` : '')];
      };
      switch (ch.type) {
        /* The generic question, and the older shapes simple enough to be
           one: confirm, vote, modes and "choose a card" (MTG.choice). */
        case 'choose': case 'confirm': case 'vote': case 'mode': case 'pickCard':
          return () => this.choosePanel(ch, card, head);
        case 'payOrDont': {
          const mana = typeof ch.cost === 'string';
          return () => this.panel(...head('Pay?'), null, [
            { label: 'Don’t pay', fn: () => send({ pay: false }) },
            mana ? { html: 'Pay ' + MTG.mana.html(ch.cost), cls: 'primary', fn: () => send({ pay: true }) }
              : (ch.cost || {}).energy != null
                ? { label: `Pay ${ch.cost.energy} energy`, cls: 'primary', fn: () => send({ pay: true }) }
                : { label: `Pay ${(ch.cost || {}).life || 0} life`, cls: 'primary', fn: () => send({ pay: true }) },
          ], { card });
        }
        case 'payOrCounter':
          return () => this.panel(...head('Pay, or your spell is countered'), null, [
            { label: 'Let it be countered', fn: () => send({ pay: false }) },
            { html: 'Pay ' + MTG.mana.html(ch.cost || ''), cls: 'primary', fn: () => send({ pay: true }) },
          ], { card });
        /* A part of the card the engine cannot do: it waits while you do it
           with the table (drag cards, tap them, right-click for counters and
           the rest), and goes on when you say it is done. */
        case 'byHand':
          return () => this.panel(escapeHtml(ch.sourceName || 'Resolve this by hand'),
            `<b>By hand:</b> ${MTG.mana.textHtml(ch.text || '')}<br><span class="dim">Do it on the table (drag cards, tap them, right-click for counters and more), then press Done.</span>`,
            null, [{ label: 'Done', cls: 'primary', fn: () => send({ done: true }) }], { card });
        case 'riot':
          return () => this.panel(...head('Riot', 'It enters with your choice of a +1/+1 counter or haste.'), null, [
            { label: 'Haste', fn: () => send({ haste: true }) },
            { label: '+1/+1 counter', cls: 'primary', fn: () => send({ haste: false }) },
          ], { card });
        case 'scry': case 'surveil': return (st) => this.scryPanel(ch, st, card, head);
        case 'arrange': return (st) => this.arrangePanel(ch, st, { card, head });
        case 'orderTriggers': return (st) => this.arrangePanel(ch, st, { card, head,
          note: `${press()} them in the order they go on the stack. The last one you put on resolves first.`, done: 'Put them on the stack',
        });
        case 'pickTarget':
          /* The engine is asking mid-resolution — a mode was chosen and it
             wants something to point at. It is the same act of targeting as
             casting, so it uses the same flow, with the legal targets the
             engine worked out. */
          if (!this.targeting) {
            const legal = new Set();
            for (const list of (ch.options || [])) for (const t of list) legal.add(t.kind + ':' + t.id);
            this.targeting = {
              need: ch.count || (ch.specs || []).length || 1, specs: ch.specs || [], chosen: [], legal, slots: ch.options || null,
              label: ch.prompt || 'Choose a target', source: ch.objId || null,
              onDone: (targets) => { this.targeting = null; send({ targets }); },
            };
            setTimeout(() => this.render(), 0);
          }
          return null;
        default:
          return null;
      }
    },

    /* ---------------- the generic question (docs/choices.md) ----------------
       One renderer for any question the engine puts in the generic shape,
       and for the older shapes simple enough to be one. Permanents on the
       battlefield are picked by clicking them where they are, players by
       their life orbs; everything else — cards in other zones, options, a
       number — is laid out in a panel. The selection lives on the table, so
       the board, the panel and the big button all see the same picks. */

    /** The question as the generic renderer reads it, or null when it is not one. */
    chooseSpec(ch) {
      if (!ch || ch.waiting) return null;
      if (ch.type === 'choose') return MTG.choice.normalize(ch);
      const s = MTG.choice.fromLegacy(ch);
      return s && ch.type === 'pickCard' && ch.purpose === 'tapCost' ? this._tapCostSpec(ch, s) : s;
    },
    /**
     * Creatures tapped to pay a cost (crew, "Tap two untapped creatures you
     * control") are clicked where they stand rather than picked from a row
     * of tiles. Crew wants power enough, not a count: any that add up, or
     * none and the game picks (it tops up what is short).
     */
    _tapCostSpec(ch, s) {
      const bf = (this.live || this.view).battlefield || [];
      const items = (s.items || []).map(it => {
        const o = bf.find(x => x.id === it.id);
        return Object.assign({}, it, { power: o && o.power != null ? o.power : 0 });
      });
      const more = { items, panel: false };
      if (ch.totalPower != null) {
        Object.assign(more, { min: 0, max: items.length, noneLabel: 'Let the game choose', confirmLabel: 'Tap these',
          constraints: [{ kind: 'sum', key: 'power', min: ch.totalPower, label: 'power' }] });
      }
      return MTG.choice.normalize(Object.assign({}, s, more));
    },
    /** Whether the board and the big button answer this question: a generic one, or creatures tapped for a cost. */
    chooseHere(ch) {
      return !!ch && (ch.type === 'choose' || (ch.type === 'pickCard' && ch.purpose === 'tapCost'));
    },
    /** What has been picked so far, kept for as long as the same question stands. */
    chooseSel(s) {
      const key = JSON.stringify([s.resumeKey || null, s.purpose || null, s.prompt || '', s.legacy || '', MTG.choice.candidates(s)]);
      if (!this.choosing || this.choosing.key !== key) {
        const n = s.kind === 'number' ? (s.default != null ? s.default : s.number.min) : null;
        this.choosing = { key, picks: [], number: n };
      }
      return this.choosing;
    },
    /** The question on the table for me, when it is one the generic renderer answers. */
    chooseLive() {
      const live = this.live || this.view;
      const ch = live && live.pendingChoice;
      if (!ch || ch.playerId !== this.meId || ch.waiting) return null;
      const s = this.chooseSpec(ch);
      return s ? { ch, s } : null;
    },
    /** Part of the panel's key, so a pick made on the board redraws the panel. */
    chooseKeyExtra(ch) {
      const s = this.chooseSpec(ch);
      if (!s) return '';
      const sel = this.chooseSel(s);
      return ':' + JSON.stringify([sel.picks, sel.number]);
    },
    /** The candidates that are permanents on the battlefield, to be clicked there. */
    chooseBoardIds(s) {
      const v = this.live || this.view;
      if (s.kind !== 'objects' || s.panel) return new Set();
      // a permanent, or a spell on the stack (Circle of Protection's source can be either): both are clicked where they are
      return new Set((s.items || []).filter(x => x.zone !== 'hand' &&
        ((v.battlefield || []).some(o => o.id === x.id) || (v.stack || []).some(st => st.objId === x.id))).map(x => x.id));
    },
    /** Send the answer: the generic shape, or the shape an older question has always taken. */
    chooseSend(ch, answer) {
      this.choosing = null;
      const data = ch.type === 'choose' ? answer : (MTG.choice.legacyData(ch, answer) || answer);
      this.send({ kind: 'choice', data });
    },
    /** One click is the whole answer when only one thing is chosen and nothing else is asked. */
    chooseOneClick(s) {
      return s.kind !== 'number' && s.max === 1 && !s.repeat && (s.min === 1 || s.min === 0) &&
        !s.constraints.some(c => c.kind === 'mana');
    },
    /** Add a pick, or take it back. */
    chooseToggle(ch, s, pick) {
      const C = MTG.choice;
      const sel = this.chooseSel(s);
      if (this.chooseOneClick(s)) return this.chooseSend(ch, { picks: [pick] });
      const at = sel.picks.lastIndexOf(pick);
      const why = () => C.check(s, { picks: sel.picks.concat([pick]) }).reason || 'That will not fit.';
      if (s.repeat) {
        if (C.canAdd(s, sel.picks, pick)) sel.picks.push(pick);
        else if (at >= 0) sel.picks.splice(at, 1);
        else return UI.error(why());
      } else if (at >= 0) sel.picks.splice(at, 1);
      else if (C.canAdd(s, sel.picks, pick)) sel.picks.push(pick);
      else if (s.max === 1) sel.picks = [pick];
      else return UI.error(sel.picks.length >= s.max ? `Choose no more than ${s.max}.` : why());
      MTG.sfx('click');
      this.render();
    },
    /** Take one of a repeated pick back. */
    chooseLess(s, pick) {
      const sel = this.chooseSel(s);
      const at = sel.picks.lastIndexOf(pick);
      if (at >= 0) sel.picks.splice(at, 1);
      this.render();
    },
    /** The answer as it stands, if it could be sent. */
    chooseReady(s) {
      const sel = this.chooseSel(s);
      const ans = s.kind === 'number' ? { number: sel.number } : { picks: sel.picks.slice() };
      return MTG.choice.check(s, ans).ok ? ans : null;
    },
    chooseConfirm(ch) {
      const s = this.chooseSpec(ch);
      if (!s) return;
      if (!MTG.choice.solve(s)) return this.chooseSend(ch, { picks: [] });
      const ans = this.chooseReady(s);
      const sel = this.chooseSel(s);
      if (!ans) return UI.error(MTG.choice.progress(s, sel.picks, sel.number).reason || 'Not yet.');
      this.chooseSend(ch, ans);
    },

    /* ---- the board's part: permanents and players ---- */
    /** Whether a card on the table is one of the choices, and whether it has been picked. */
    chooseMark(ch, id) {
      const s = this.chooseSpec(ch);
      if (!s || s.kind !== 'objects' || s.panel) return { cand: false, chosen: false };
      const sel = this.chooseSel(s);
      const cand = (s.items || []).some(x => x.id === id);
      return { cand, chosen: cand && sel.picks.includes(id) };
    },
    chooseClick(ch, id) {
      const s = this.chooseSpec(ch);
      if (!s || s.kind !== 'objects' || s.panel || !(s.items || []).some(x => x.id === id)) return false;
      this.chooseToggle(ch, s, id);
      return true;
    },
    chooseOrb(pid) {
      const got = this.chooseLive();
      if (!got || got.s.kind !== 'players') return { cand: false, chosen: false };
      const cand = (got.s.items || []).some(x => x.id === pid);
      return { cand, chosen: cand && this.chooseSel(got.s).picks.includes(pid) };
    },
    choosePlayer(pid) {
      const got = this.chooseLive();
      if (!got || got.s.kind !== 'players' || !(got.s.items || []).some(x => x.id === pid)) return false;
      this.chooseToggle(got.ch, got.s, pid);
      return true;
    },
    /** What the big button says while a generic question is on the table. */
    choosePrimary(ch) {
      const s = this.chooseSpec(ch);
      const sel = this.chooseSel(s);
      // cards only to look at
      if (s.kind === 'objects' && s.max === 0) return { label: 'Done', cls: 'go', sub: 'when you have looked' };
      if (!MTG.choice.solve(s)) return { label: 'Continue', cls: 'go', sub: 'nothing can be chosen' };
      const pr = MTG.choice.progress(s, sel.picks, sel.number);
      const none = s.kind !== 'number' && !sel.picks.length;
      return { label: pr.ok ? (none ? (s.noneLabel || 'Choose none') : (s.confirmLabel || 'Confirm')) : 'Choose', cls: pr.ok ? 'go' : 'idle',
        disabled: !pr.ok, sub: pr.ok ? pr.text : (pr.reason || pr.text) };
    },
    /** The banner while a question is answered on the board. */
    chooseBanner(ch) {
      const s = this.chooseSpec(ch);
      const sel = this.chooseSel(s);
      const pr = MTG.choice.progress(s, sel.picks, sel.number);
      const title = richText(s.prompt || (s.kind === 'players' ? 'Choose a player' : 'Choose'));
      const how = s.kind === 'players' ? `${press()} a highlighted player.` : `${press()} the highlighted permanents.`;
      let extra = null;
      if (s.kind === 'players') {
        // the players as chips as well, for a seat whose orb is out of sight
        const row = el('div', { class: 'ab-chips' }, (s.items || []).map(p => el('button', {
          type: 'button', class: 'ab-chip' + (sel.picks.includes(p.id) ? ' on' : ''), text: p.id === this.meId ? 'You' : p.name,
          onclick: () => this.chooseToggle(ch, s, p.id),
        })));
        extra = { node: row, sig: sel.picks.join(',') };
      }
      const named = ch.sourceName && !String(s.prompt || '').includes(ch.sourceName) ? escapeHtml(ch.sourceName) + ': ' : '';
      const short = !pr.ok && sel.picks.length ? ` <i class="cant">${escapeHtml(pr.reason)}</i>` : '';
      return { cls: 'ask', title: named + title, sub: how + ' ' + richText(pr.text) + short, extra };
    },

    /* ---- the panel's part: cards elsewhere, options, numbers ---- */
    /**
     * The panel for a generic question, or null when it is answered on the
     * board alone (permanents and players need no panel).
     */
    choosePanel(ch, card, head) {
      const C = MTG.choice;
      const s = this.chooseSpec(ch);
      if (!s) return null;
      const sel = this.chooseSel(s);
      const board = this.chooseBoardIds(s);
      if (s.kind === 'players') return null;
      /* Cards to look at and none to take (a hand looked at with Gitaxian
         Probe): a face-up row and a button to say you have seen them. */
      if (s.kind === 'objects' && s.max === 0) {
        const [vt, vs] = head('Look', '');
        const row = el('div', { class: 'pick-row view-only' });
        for (const it of (s.items || [])) row.appendChild(this.pickTile(it.card || (this.objIn(it.id) || {}).card || null, {}));
        if (!(s.items || []).length) row.appendChild(el('div', { class: 'pp-empty', text: 'Nothing' }));
        return this.panel(vt, vs, row, [{ label: 'Done', cls: 'primary', fn: () => this.chooseSend(ch, { picks: [] }) }], { wide: true, card });
      }
      if (s.kind === 'objects' && (s.items || []).length && (s.items || []).every(x => board.has(x.id))) return null;
      const fallback = { confirm: 'Do it?', vote: 'Vote', mode: 'Choose', pickCard: 'Choose a card' }[s.legacy] || 'Choose';
      let [title, sub0] = head(fallback, s.legacy === 'vote' ? 'Everyone votes; the most votes wins.' : '');
      if (s.prompt && /\{/.test(s.prompt)) { title = title.replace(escapeHtml(s.prompt), richText(s.prompt)); sub0 = sub0.replace(escapeHtml(s.prompt), richText(s.prompt)); }
      // nothing that could be chosen: say so, and carry on
      if (!C.solve(s)) {
        return this.panel(title, 'There is nothing that can be chosen.', null,
          [{ label: 'Continue', cls: 'primary', fn: () => this.chooseSend(ch, { picks: [] }) }], { card });
      }
      const one = this.chooseOneClick(s);
      /* Two or three short answers are buttons and nothing more: "No" and
         "Yes", or a ballot. */
      const opts = s.options || [];
      /* Fact or Fiction, Liliana of the Veil: each pile is a row of its
         cards, and a button under it takes that pile. */
      if (s.kind === 'options' && one && opts.length && opts.every(o => Array.isArray(o.ids))) {
        const body = el('div', { class: 'piles-pick' });
        opts.forEach((o, k) => {
          const cards = o.ids.map((id, i) => (o.cards && o.cards[i]) || ((this.objIn(id) || {}).card) || null);
          const row = el('div', { class: 'pick-row' });
          for (const c of cards) row.appendChild(this.pickTile(c, {}));
          if (!cards.length) row.appendChild(el('div', { class: 'pp-empty', text: 'Nothing' }));
          body.appendChild(el('div', { class: 'pp-pile' }, [
            el('div', { class: 'pp-head' }, [
              el('span', { class: 'pp-name', text: `Pile ${k + 1}` + (cards.length ? ` (${cards.length})` : '') }),
              el('button', { type: 'button', class: 'btn primary sm', text: 'Choose this pile', onclick: () => this.chooseSend(ch, { picks: [k] }) }),
            ]),
            row,
          ]));
        });
        return this.panel(title, sub0, body, [], { wide: true, card });
      }
      if (s.kind === 'options' && one && s.min === 1 && (s.compact ||
          (opts.length <= 3 && opts.every(o => String(o.label || '').length <= 24 && !o.cost && !o.card)))) {
        return this.panel(title, sub0, null, opts.map((o, k) => ({
          label: o.label, cls: o.primary || s.legacy === 'vote' || opts.length === 1 ? 'primary' : '',
          fn: () => this.chooseSend(ch, { picks: [k] }),
        })), { card });
      }
      const body = this.chooseBody(s, sel, {
        exclude: board, onPick: (p) => this.chooseToggle(ch, s, p), onLess: (p) => this.chooseLess(s, p),
        onNumber: (n) => { sel.number = n; this.render(); },
      });
      const pr = C.progress(s, sel.picks, sel.number);
      const lines = [];
      if (board.size) lines.push('Or click the highlighted permanents on the battlefield.');
      if (s.reveal) lines.push('What you choose is revealed.');
      if (!one || s.kind === 'number') {
        const short = !pr.ok && (sel.picks.length || s.kind === 'number') ? ' — ' + escapeHtml(pr.reason) : '';
        lines.push(`<span class="choose-status${pr.ok ? '' : ' short'}">${richText(pr.text)}${short}</span>`);
      }
      const sub = [sub0].concat(lines).filter(Boolean).join('<br>');
      const buttons = [];
      if (one) {
        if (s.min === 0 || s.optional) {
          buttons.push({ label: s.noneLabel || (s.legacy === 'pickCard' ? 'None of them' : 'None'), fn: () => this.chooseSend(ch, { picks: [] }) });
        }
      } else {
        const none = s.kind !== 'number' && !sel.picks.length;
        buttons.push({ label: pr.ok && none ? (s.noneLabel || 'Choose none') : (s.confirmLabel || 'Confirm'), cls: 'primary', disabled: !pr.ok,
          fn: () => this.chooseConfirm(ch) });
      }
      return this.panel(title, sub, body, buttons, { wide: s.kind === 'objects', card });
    },

    /**
     * The middle of a generic question's panel: tiles for cards, a list for
     * options, a stepper for a number. `opts.onPick(pick)` is told about a
     * click, `opts.onLess(pick)` about taking a repeated pick back, and
     * `opts.onNumber(n)` about a new number; `opts.exclude` leaves out
     * candidates shown somewhere else. The casting panel uses this too.
     */
    chooseBody(s, sel, opts) {
      const C = MTG.choice;
      opts = opts || {};
      if (s.kind === 'number') {
        const nb = s.number;
        const set = (n) => { if (opts.onNumber) opts.onNumber(U.clamp(n, nb.min, nb.max)); };
        return el('div', { class: 'x-pick' }, [
          el('button', { type: 'button', class: 'btn', text: '−', disabled: sel.number <= nb.min, onclick: () => set(sel.number - nb.step), 'aria-label': 'Fewer' }),
          el('div', { class: 'x-val', text: String(sel.number) }),
          el('button', { type: 'button', class: 'btn', text: '+', disabled: sel.number >= nb.max, onclick: () => set(sel.number + nb.step), 'aria-label': 'More' }),
          nb.max > nb.min + 1 ? el('button', { type: 'button', class: 'btn xs ghost', text: `max (${nb.max})`, onclick: () => set(nb.max) }) : null,
        ].filter(Boolean));
      }
      if (s.kind === 'options') {
        const list = el('div', { class: 'mode-list' });
        /* A long list (a card name, say) gets a search box: typing hides what does not match. */
        const searchable = (s.options || []).length > 12;
        (s.options || []).forEach((o, k) => {
          const n = sel.picks.filter(x => x === k).length;
          const can = n > 0 || C.canAdd(s, sel.picks, k) || (s.max === 1 && !s.repeat);
          const paws = /^(?:\{P\})+$/.test(o.cost || '');
          const cost = !o.cost ? '' : (paws
            ? '<span class="paw-cost">' + '<i class="pip pip-paw" title="paw print"></i>'.repeat(o.cost.length / 3) + '</span>'
            : MTG.mana.html(o.cost)) + ' ';
          const row = el('button', {
            type: 'button', class: 'mode-opt' + (n ? ' on' : '') + (can ? '' : ' off'), 'aria-pressed': n ? 'true' : 'false',
            onclick: () => { if (opts.onPick) opts.onPick(k); },
          }, [
            el('span', { class: 'mode-dot', text: n ? (s.repeat && n > 1 ? '×' + n : '✓') : '' }),
            el('span', { class: 'mode-text', html: cost + richText(o.label || '') }),
            s.repeat && n ? el('span', { class: 'btn xs mode-less', role: 'button', text: '−', title: 'One fewer',
              onclick: (e) => { e.stopPropagation(); if (opts.onLess) opts.onLess(k); } }) : null,
          ].filter(Boolean));
          // a card named, a card offered (Demonic Consultation, a spellbook): shown on hover
          if (o.card) UI.attachPreview(row, o.card, 0);
          list.appendChild(row);
        });
        if (!searchable) return list;
        const box = el('input', { type: 'search', class: 'mode-search', placeholder: 'Search…', 'aria-label': 'Search the choices' });
        box.addEventListener('input', () => {
          const q = box.value.trim().toLowerCase();
          for (const b of list.children) b.hidden = !!q && !b.textContent.toLowerCase().includes(q);
        });
        setTimeout(() => { try { box.focus(); } catch (e) {} }, 0);
        return el('div', { class: 'mode-searchable' }, [box, list]);
      }
      /* Cards: a face-up row. A library search offers twenty Forests;
         copies of the same card share one tile with a count, and taking
         from it takes the next copy. */
      const grid = el('div', { class: 'pick-row' });
      const groups = [], byKey = new Map();
      for (const it of (s.items || [])) {
        if (opts.exclude && opts.exclude.has(it.id)) continue;
        const key = it.card && !it.cost ? (it.card.oracle_id || it.card.name) + '|' + (it.card.id || '') : it.id;
        let g = byKey.get(key);
        if (!g) { g = { item: it, ids: [] }; byKey.set(key, g); groups.push(g); }
        g.ids.push(it.id);
      }
      for (const g of groups) {
        const taken = g.ids.filter(id => sel.picks.includes(id)).length;
        const free = g.ids.find(id => !sel.picks.includes(id));
        const can = taken > 0 || (free && C.canAdd(s, sel.picks, free)) || s.max === 1;
        // an ordered pick (Scroll Rack) says where each one goes: 1, 2, 3…
        const at = s.ordered && taken && g.ids.length === 1 ? sel.picks.indexOf(g.ids[0]) + 1 : 0;
        const badge = g.ids.length > 1 ? (taken ? `${taken}/${g.ids.length}` : '×' + g.ids.length) : (at ? String(at) : taken ? '✓' : '');
        const tile = this.pickTile(g.item.card, {
          cls: (taken ? 'on' : '') + (can ? '' : ' off'), badge, label: g.item.label || g.item.cost || '',
          onClick: () => {
            if (!opts.onPick) return;
            if (g.ids.length === 1) return opts.onPick(g.ids[0]);
            // a stack of copies: take the next, or put the last one back
            if (free && (C.canAdd(s, sel.picks, free) || this.chooseOneClick(s))) return opts.onPick(free);
            const had = g.ids.filter(id => sel.picks.includes(id)).pop();
            if (had) opts.onPick(had);
          },
        });
        grid.appendChild(tile);
      }
      if (!groups.length) grid.appendChild(el('div', { class: 'empty-note', text: 'There is nothing to choose.' }));
      return grid;
    },

    /**
     * Scry and surveil: the cards, face up, and somewhere to put them. Click a
     * card to send it away or bring it back; the arrows change the order of
     * what stays. The leftmost card that stays is the next one you draw.
     */
    scryPanel(ch, st, card, head) {
      const surveil = ch.type === 'surveil';
      if (!st.items) st.items = (ch.cards || []).slice(0, ch.count).map(c => ({ id: c.id, card: c.card || c, where: 'top' }));
      const items = st.items;
      if (!items.length) { setTimeout(() => this.send({ kind: 'choice', data: { top: [], bottom: [] } }), 0); return null; }
      const top = el('div', { class: 'scry-row' }), away = el('div', { class: 'scry-row away' });
      const draw = () => {
        top.innerHTML = ''; away.innerHTML = '';
        const t = items.filter(x => x.where === 'top'), a = items.filter(x => x.where === 'away');
        t.forEach((it, i) => top.appendChild(item(it, i, t.length)));
        a.forEach((it, i) => away.appendChild(item(it, i, a.length)));
        if (!t.length) top.appendChild(el('div', { class: 'scry-empty', text: 'nothing stays on top' }));
        if (!a.length) away.appendChild(el('div', { class: 'scry-empty', text: surveil ? 'nothing goes to the graveyard' : 'nothing goes to the bottom' }));
      };
      const move = (it) => { it.where = it.where === 'top' ? 'away' : 'top'; draw(); };
      const shift = (it, by) => {
        const list = items.filter(x => x.where === it.where);
        const i = list.indexOf(it), j = i + by;
        if (j < 0 || j >= list.length) return;
        const a = items.indexOf(list[i]), b = items.indexOf(list[j]);
        items[a] = list[j]; items[b] = list[i];
        draw();
      };
      const item = (it, i, n) => el('div', { class: 'scry-item' }, [
        this.pickTile(it.card, { onClick: () => move(it), label: it.where === 'top' ? (i === 0 ? 'next draw' : '') : '' }),
        it.where === 'top' && n > 1 ? el('div', { class: 'scry-nudge' }, [
          el('button', { type: 'button', class: 'btn xs', text: '◀', disabled: i === 0, onclick: () => shift(it, -1), 'aria-label': 'Earlier' }),
          el('button', { type: 'button', class: 'btn xs', text: '▶', disabled: i === n - 1, onclick: () => shift(it, 1), 'aria-label': 'Later' }),
        ]) : null,
      ].filter(Boolean));
      draw();
      const body = el('div', { class: 'scry-wrap' }, [
        el('div', { class: 'scry-zone' }, [el('div', { class: 'scry-head', text: 'On top' }), top]),
        el('div', { class: 'scry-zone' }, [el('div', { class: 'scry-head', text: surveil ? 'Into your graveyard' : 'On the bottom' }), away]),
      ]);
      const finish = () => this.send({ kind: 'choice', data: {
        top: items.filter(x => x.where === 'top').map(x => x.id),
        bottom: items.filter(x => x.where === 'away').map(x => x.id),
      } });
      const [t, sub] = head(surveil ? 'Surveil' : 'Scry', `${press()} a card to move it between the two rows.`);
      return this.panel(t, sub, body, [
        { label: surveil ? 'All to the graveyard' : 'All to the bottom', fn: () => { for (const it of items) it.where = 'away'; finish(); } },
        { label: 'Done', cls: 'primary', fn: finish },
      ], { wide: true, card });
    },

    /** "Put them back in any order": click them in the order they should go. */
    arrangePanel(ch, st, opts) {
      st.order = st.order || [];
      const lookOnly = !!ch.look;
      const grid = el('div', { class: 'pick-row' });
      const paint = () => {
        for (const t of grid.children) {
          const at = st.order.indexOf(t._cid);
          t.classList.toggle('on', at >= 0);
          const b = t.querySelector('.pt-badge');
          if (b) b.textContent = at >= 0 ? String(at + 1) : '';
        }
      };
      for (const c of (ch.cards || [])) {
        const tile = c.card
          ? this.pickTile(c.card, { badge: '' })
          : el('button', { type: 'button', class: 'pick-tile trig' }, [el('div', { class: 'pt-trig', text: c.name || 'Trigger' }), el('span', { class: 'pt-badge', text: '' })]);
        tile._cid = c.id;
        if (!lookOnly) tile.addEventListener('click', () => {
          const at = st.order.indexOf(c.id);
          if (at >= 0) st.order.splice(at, 1); else st.order.push(c.id);
          paint();
        });
        grid.appendChild(tile);
      }
      paint();
      const done = () => {
        const rest = (ch.cards || []).map(c => c.id).filter(id => !st.order.includes(id));
        this.send({ kind: 'choice', data: { top: st.order.concat(rest) } });
      };
      const note = opts.note || (lookOnly ? 'They stay where they are, in this order.' : `${press()} them in the order they should sit on top of your library, first to draw first.`);
      const [t, sub] = opts.head ? opts.head('Put them in order', note) : [escapeHtml(ch.prompt || 'Put them in order'), note];
      return this.panel(t, sub, grid, [{ label: opts.done || 'Done', cls: 'primary', fn: done }], { wide: true, card: opts.card });
    },

    /* ---------------- the opening hand ---------------- */
    mulliganPanel() {
      const v = this.view, me = this.me;
      const need = me.mulliganBottom != null ? me.mulliganBottom : me.mulligansTaken;
      this.mulliganBottom = this.mulliganBottom.filter(id => me.hand.some(o => o.id === id));
      const sel = this.mulliganBottom;
      const first = (v.turnOrder || [])[0];
      const onPlay = first === this.meId;
      const firstName = (v.players.find(p => p.id === first) || {}).name;
      const lands = me.hand.filter(o => { const a = this.analysis(o); return a && a.isLand; }).length;
      const cards = el('div', { class: 'mull-hand' });
      const kids = UI.sortCards(me.hand.filter(o => !o.hidden), 'cmc').map(o => {
        const w = this.wrapFor('m:' + o.id, 'mslot' + (sel.includes(o.id) ? ' bottom' : ''));
        w.onclick = () => {
          if (!need) return this.showCard(o.id);
          const at = sel.indexOf(o.id);
          if (at >= 0) sel.splice(at, 1); else if (sel.length < need) sel.push(o.id);
          this.render();
        };
        this.place(w, [this.cardEl(o)]);
        return w;
      });
      this.place(cards, kids);
      const freeLeft = me.mulligansTaken - need;
      const title = me.mulligansTaken ? `Mulligan ${me.mulligansTaken}${freeLeft > 0 ? ' (free)' : ''}` : 'Your opening hand';
      const sub = need
        ? `Choose <b>${need}</b> card${need === 1 ? '' : 's'} to put on the bottom — ${sel.length} of ${need} chosen.`
        : `${lands} land${lands === 1 ? '' : 's'} · ${onPlay ? 'you play first' : `${escapeHtml(firstName || 'they')} play${firstName ? 's' : ''} first, you draw`}`;
      const p = this.panel(title, sub, cards, [
        { label: 'Mulligan', title: 'Shuffle this hand away and draw a new one', fn: () => { this.mulliganBottom = []; this.send({ kind: 'mulligan' }); } },
        { label: need ? `Keep ${me.hand.length - need}` : 'Keep hand', cls: 'primary', disabled: sel.length !== need,
          fn: () => { this.send({ kind: 'keep', bottom: sel.slice() }); this.mulliganBottom = []; } },
      ], { cls: 'mulligan' });
      p._full = true;
      return p;
    },

    /* ---------------- the end ---------------- */
    gameOverPanel() {
      const v = this.view;
      const won = (v.winners || []).includes(this.meId);
      const draw = !(v.winners || []).length;
      const names = (v.winners || []).map(id => (v.players.find(p => p.id === id) || {}).name).filter(Boolean);
      const m = v.match;
      const buttons = [];
      // the next game is the host's to start; a guest waits for it here or leaves
      const guest = !!(MTG.net && MTG.net.isClient);
      // somebody watching, or watching a replay, neither won nor lost
      const watched = !!(v.spectating || v.replay || !this.me);
      if (v.replay) buttons.push({ label: 'Back to menu', cls: 'primary', fn: () => MTG.app.leaveGame({ keepSave: true }) });
      else if (guest) buttons.push({ label: 'Leave the table', cls: 'primary', fn: () => MTG.app.leaveGame() });
      else if (m && !m.decided) buttons.push({ label: `Play game ${m.gameNumber + 1}`, cls: 'primary', fn: () => MTG.app.nextGame() });
      else buttons.push({ label: m ? 'New match' : 'Rematch', cls: 'primary', fn: () => MTG.app.rematch() });
      if (!guest && !v.replay) buttons.unshift({ label: 'Back to menu', fn: () => MTG.app.leaveGame() });
      // in an event: its record, and the next match (or the prize) in place of a rematch
      const evInfo = !watched && MTG.app && MTG.app.eventInfo ? MTG.app.eventInfo() : null;
      if (evInfo) {
        const i = buttons.findIndex(b => /Rematch|New match|Play game/.test(b.label));
        const next = { label: evInfo.next.label, cls: 'primary', fn: evInfo.next.fn };
        if (i >= 0) buttons[i] = next; else buttons.push(next);
      }
      // a tutorial: the next one in place of a rematch, or the way back after the last (src/14b-lessons.js)
      const tut = !watched && !guest && MTG.lessons && MTG.lessons.afterGame ? MTG.lessons.afterGame(MTG.app && MTG.app.session) : null;
      if (tut) {
        const i = buttons.findIndex(b => /Rematch|New match|Play game/.test(b.label));
        if (i >= 0) buttons.splice(i, 1, ...tut); else buttons.push(...tut);
      }
      buttons.unshift({ label: 'Look at the board', fn: () => { this.decision.classList.add('peek'); setTimeout(() => this.decision.classList.remove('peek'), 4000); } });
      const body = el('div', { class: 'over-body' }, [
        el('div', { class: 'over-word ' + (watched ? 'draw' : won ? 'win' : draw ? 'draw' : 'loss'), text: watched ? (draw ? 'Draw' : 'Result') : won ? 'Victory' : draw ? 'Draw' : 'Defeat' }),
        el('div', { class: 'over-sub', text: draw ? 'Nobody is left standing.' : won && !watched ? `Turn ${v.turn}` : `${names.join(' & ')} win${names.length > 1 ? '' : 's'} on turn ${v.turn}` }),
        guest ? el('div', { class: 'over-note', text: 'If the host starts another game, it opens here.' }) : null,
        evInfo ? el('div', { class: 'over-event', text: evInfo.line }) : null,
        // what the game paid
        this._reward && !watched ? el('div', { class: 'over-reward' }, [
          el('div', { class: 'or-total', html: (UI.shardIcon ? UI.shardIcon() : '') + `<b>+${this._reward.total.toLocaleString()}</b> Shards` }),
          el('div', { class: 'or-parts' }, this._reward.parts.map(([label, n]) => el('span', { text: `${label} +${n.toLocaleString()}` }))),
        ]) : null,
        // what else the game moved: quests, XP, the ladder
        this._progress && !watched ? el('div', { class: 'over-progress' }, [
          el('span', { class: 'op-xp', text: `+${this._progress.xp} XP` }),
          ...(this._progress.quests || []).map(q => el('span', { class: 'op-quest', text: `Quest done: ${MTG.progress.questText(q)}` })),
          this._progress.ranked ? el('span', { class: 'op-rank' }, [
            UI.rankEmblem ? UI.rankEmblem(this._progress.ranked.after.tier, { size: 18, ladder: this._progress.ranked.ladder }) : null,
            el('span', { text: `${this._progress.ranked.ladderName || 'Ranked'}: ${MTG.progress.rankLabel(this._progress.ranked.before)} \u2192 ${MTG.progress.rankLabel(this._progress.ranked.after)}` }),
          ].filter(Boolean)) : null,
          this._progress.weekly ? el('span', { class: 'op-weekly', text: `Weekly win ${this._progress.weekly.wins} of 15` }) : null,
          (MTG.progress.inboxCount() ? el('button', { type: 'button', class: 'btn xs', text: `Rewards to claim (${MTG.progress.inboxCount()})`, onclick: () => UI.openInbox() }) : null),
        ].filter(Boolean)) : null,
        m ? el('div', { class: 'over-match' }, [
          el('div', { class: 'tiny', text: m.label }),
          el('div', { class: 'over-scores' }, m.scores.map(sc => el('span', { class: 'sc' + (sc.leading ? ' lead' : '') }, [el('i', { text: sc.name }), el('b', { text: String(sc.wins) })]))),
        ]) : null,
      ].filter(Boolean));
      const p = this.panel('', '', body, buttons, { cls: 'game-over' });
      p._full = true;
      return p;
    },

    /* ---------------- casting: extra costs, X, then targets ---------------- */

    /**
     * Casting is asked in the order the rules ask it: the optional costs
     * first (they can change what the spell does), then X, then targets.
     * Each step is a panel or the targeting banner; cancelling any of them
     * leaves the card in your hand.
     */
    beginCast(o, a, via, face, more) {
      const live = this.live || this.view;
      // another spell chosen while one waited for mana: that one goes back to waiting in your hand
      this.paying = null;
      this.convoking = null;
      const all = (live.extras || {})[o.id] || [];
      // convoke, improvise and delve are not extra costs to toggle: they are what pays, asked about last
      const PAYS = ['convoke', 'improvise', 'delve'];
      // costs the table would otherwise pick for you (evidence, forage, reveal…): asked last, with the payment
      const picks = all.filter(x => x.key && (x.candidates || x.foods));
      const extras = all.filter(x => !PAYS.includes(x.kind) && !picks.includes(x));
      const pays = via ? [] : all.filter(x => PAYS.includes(x.kind) && (x.candidates || []).length && x.max > 0);
      const steps = { o, a, via, face, more: more || {}, picked: { kick: 0, kickPaid: [], buyback: false, entwine: false, offspring: false, squad: 0, casualty: false, spree: [], choices: {}, payAdditional: false, gift: false }, x: 0 };
      // the cost being paid: one half of a split card, or the face that is up
      const faces = o.card.card_faces;
      steps.cost = (via === 'fuse' && faces && faces[1] ? (faces[0].mana_cost || '') + (faces[1].mana_cost || '')
        : face != null && faces && faces[face] ? faces[face].mana_cost
        : o.card.mana_cost || (faces && faces[o.face || 0] && faces[o.face || 0].mana_cost)) || '';
      const hasX = /\{X\}/.test(steps.cost);
      const afterExtras = () => (hasX && via !== 'morph' ? this.askX(steps, afterX) : afterX());
      const afterX = () => (pays.length ? this.askAltPay(steps, pays, afterPay) : afterPay());
      // an additional cost left unpaid in the extras (Hulk's Thunderclap): nothing of it to pick
      const PICKS_OF = { evidence: 'evidence', forage: 'forage', reveal: 'revealHand', exileOwn: 'exileOwn', exileHand: 'exileHand', counterFrom: 'removeCounterFrom', blight: 'blight', behold: 'behold' };
      const picksNow = () => (extras.some(x => x.kind === 'optional') && !steps.picked.payAdditional
        ? picks.filter(r => !(a && a.additionalCost && a.additionalCost[PICKS_OF[r.kind]])) : picks);
      const afterPay = () => (picksNow().length
        ? this.askCostPicks(picksNow(), steps.x || 0, o.card, (chosen) => { steps.costPicks = chosen; this.castTargets(steps); })
        : this.castTargets(steps));
      if (extras.length) this.askExtras(steps, extras, afterExtras);
      else afterExtras();
    },

    /**
     * Convoke, improvise, delve: which creatures tap, which artifacts tap,
     * which cards leave your graveyard. Each pays one. Leave it to the game
     * and it picks the cheapest; pick some and exactly those pay, the rest
     * coming out of your mana. Two of them on one card share one limit.
     */
    askAltPay(steps, pays, next) {
      // tapping creatures and artifacts is done on the board, where they stand (boardPay)
      if (!pays.some(p => p.kind === 'delve')) return this.boardPay(steps, pays, next);
      const max = Math.max(...pays.map(p => p.max || 0));
      const sel = new Map(pays.map(p => [p.kind, []]));
      const total = () => [...sel.values()].reduce((n, l) => n + l.length, 0);
      const VERB = { convoke: 'tap for convoke', improvise: 'tap for improvise', delve: 'exile for delve' };
      const key = 'altpay:' + steps.o.id;
      this.asking = { base: key, get key() { return key + ':' + JSON.stringify([...sel.values()]); }, build: () => {
        const rows = el('div', { class: 'extras altpay' });
        for (const p of pays) {
          rows.appendChild(el('div', { class: 'section-title', text: `${p.label || p.kind} \u2014 ${VERB[p.kind] || 'pay'}, 1 each` }));
          const list = sel.get(p.kind);
          for (const id of p.candidates) {
            const loc = this.locate(id);
            const card = loc && loc.o ? loc.o.card : null;
            const on = list.includes(id);
            const full = !on && total() >= max;
            const b = el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : '') + (full ? ' off' : ''), disabled: full,
              onclick: () => { const at = list.indexOf(id); if (at >= 0) list.splice(at, 1); else if (total() < max) list.push(id); this.render(); } }, [
              el('span', { class: 'mode-dot', text: on ? '\u2713' : '' }),
              el('span', { class: 'mode-text', text: card ? card.name : id }),
            ]);
            if (card) UI.attachPreview(b, card, 0);
            rows.appendChild(b);
          }
        }
        const n = total();
        const name = escapeHtml(steps.o.card.name);
        return this.panel(`Pay for ${name}`, n
          ? `${n} of up to ${max} paid this way; the rest comes from your mana.`
          : `Up to ${max} of its cost can be paid this way. Choose, or let the game pick the cheapest.`, rows, [
          { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
          { label: 'Let the game choose', cls: n ? '' : 'primary', fn: () => { this.asking = null; steps.altPay = null; next(); } },
          { label: 'Use these', cls: n ? 'primary' : '', disabled: !n, fn: () => {
            this.asking = null;
            steps.altPay = {};
            for (const [kind, list] of sel) steps.altPay[kind + 'Ids'] = list.slice();
            next();
          } },
        ], { card: steps.o.card });
      } };
      this.render();
    },

    /**
     * Convoke and improvise, paid on the board: what could tap for it
     * glows where it stands, a click taps it for the spell and another
     * takes it back, and the banner keeps count of what is paid. A
     * creature pays a coloured symbol of its colour while one is still
     * owed, else {1}, as the engine works it out (_convokeColors). Done
     * casts with exactly those; leave it to the game and it picks.
     */
    boardPay(steps, pays, next) {
      const cand = new Map();
      // (an artifact creature that could do either convokes: it can pay a colour)
      for (const kind of ['convoke', 'improvise']) {
        const p = pays.find(x => x.kind === kind);
        if (p) for (const id of p.candidates) if (!cand.has(id)) cand.set(id, kind);
      }
      const live = this.live || this.view;
      const loc = this.locate(steps.o.id, live);
      this.convoking = { steps, pays, next, cand, picks: [], max: Math.max(...pays.map(p => p.max || 0)),
        zone: loc ? loc.zone : null, at: payMoment(live) };
      MTG.sfx('click');
      this.render();
    },

    /**
     * Where a board payment stands: the cost, what each pick pays, what is
     * left for mana, and how much of the generic part the picks may take.
     */
    convokeSums(c) {
      c = c || this.convoking;
      const live = this.live || this.view;
      const offered = (live.extras || {})[c.steps.o.id] || [];
      const syms = MTG.mana.parse(this._castCost(c.steps, offered));
      const x = c.steps.x || 0;
      let generic = 0;
      const colored = [], other = [];
      for (const s of syms) {
        if (/^\d+$/.test(s)) generic += parseInt(s, 10);
        else if (s === 'X') generic += x;
        else if (/^[WUBRG]$/.test(s)) colored.push(s);
        else other.push(s);
      }
      const colorsOf = (id) => {
        const o = this.objIn(id);
        const card = o && o.card;
        if (!card) return [];
        const face = card.card_faces && card.card_faces[o.face || 0];
        return (face && face.colors) || card.colors || [];
      };
      /* which creature pays which coloured symbol: as many as their colours
         cover between them, each creature once (a matching, as the engine's) */
      const match = (ids) => {
        const owner = new Map();
        const can = colored.map(s => ids.filter(id => c.cand.get(id) === 'convoke' && colorsOf(id).includes(s)));
        const tryAt = (i, seen) => {
          for (const id of can[i]) {
            if (seen.has(id)) continue;
            seen.add(id);
            const j = owner.get(id);
            if (j == null || tryAt(j, seen)) { owner.set(id, i); return true; }
          }
          return false;
        };
        for (let i = 0; i < colored.length; i++) tryAt(i, new Set());
        return owner;
      };
      const owner = match(c.picks);
      const pays = new Map(c.picks.map(id => [id, owner.has(id) ? colored[owner.get(id)] : '1']));
      const paidGeneric = c.picks.length - owner.size;
      // the generic part the picks may take: what the offer allows past the colours the candidates could pay
      const room = Math.max(0, c.max - match([...c.cand.keys()]).size);
      const left = colored.filter((s, i) => ![...owner.values()].includes(i));
      const restGeneric = Math.max(0, generic - paidGeneric);
      const rest = (restGeneric ? `{${restGeneric}}` : '') + left.concat(other).map(s => `{${s}}`).join('');
      const shown = (generic ? `{${generic}}` : '') + colored.concat(other).map(s => `{${s}}`).join('');
      return { pays, paidGeneric, room, rest, cost: shown };
    },

    /** Tap a permanent for the spell, or take it back. */
    convokeToggle(id) {
      const c = this.convoking;
      if (!c || !c.cand.has(id)) return false;
      const at = c.picks.indexOf(id);
      if (at >= 0) c.picks.splice(at, 1);
      else {
        if (c.picks.length >= c.max) { UI.error(`No more than ${c.max} of its cost can be paid this way.`); return true; }
        const after = this.convokeSums(Object.assign({}, c, { picks: c.picks.concat([id]) }));
        if (after.paidGeneric > after.room) { UI.error('Only a creature of the right colour can pay what is left this way.'); return true; }
        c.picks.push(id);
      }
      MTG.sfx('click');
      this.render();
      return true;
    },

    /** Done: cast with what was chosen, or (`auto`, or nothing chosen) with what the game picks. */
    convokeDone(auto) {
      const c = this.convoking;
      if (!c) return;
      this.convoking = null;
      if (auto || !c.picks.length) c.steps.altPay = null;
      else {
        c.steps.altPay = {};
        for (const p of c.pays) c.steps.altPay[p.kind + 'Ids'] = c.picks.filter(id => c.cand.get(id) === p.kind);
      }
      c.next();
      this.render();
    },

    convokeCancel() {
      if (!this.convoking) return;
      this.convoking = null;
      this.render();
    },

    /** The banner while creatures are tapped for a spell. */
    convokeBanner() {
      const c = this.convoking;
      const sums = this.convokeSums();
      const n = c.picks.length;
      const kinds = c.pays.map(p => p.kind);
      const what = kinds.length > 1 ? 'Convoke and improvise' : kinds[0] === 'improvise' ? 'Improvise' : 'Convoke';
      const noun = kinds.length > 1 ? 'creatures and artifacts' : kinds[0] === 'improvise' ? 'artifacts' : 'creatures';
      const title = `${escapeHtml(c.steps.o.card.name)} — ${what}: ${n} of ${MTG.mana.html(sums.cost)} paid by ${noun}`;
      const paid = c.picks.map(id => {
        const o = this.objIn(id);
        return `${escapeHtml(o && o.card ? o.card.name : 'it')} ${MTG.mana.html('{' + sums.pays.get(id) + '}')}`;
      });
      const sub = `${press()} your glowing ${noun} to tap them for it (up to ${c.max}).` +
        (n ? ` ${paid.join(', ')}. ` + (sums.rest ? `The rest, ${MTG.mana.html(sums.rest)}, comes from your mana.` : 'Nothing is left to pay in mana.') : '');
      const row = el('div', { class: 'ab-chips convoke-row' }, [
        el('button', { type: 'button', class: 'btn sm', text: 'Cancel', title: 'Leave the spell in your hand (Esc)', onclick: () => this.convokeCancel() }),
        el('button', { type: 'button', class: 'btn sm' + (n ? '' : ' primary'), text: 'Let the game choose', onclick: () => this.convokeDone(true) }),
        el('button', { type: 'button', class: 'btn sm primary', text: 'Done', disabled: !n, title: 'Cast it, tapping these (Space)', onclick: () => this.convokeDone(false) }),
      ]);
      return { cls: 'ask convoke', title, sub, extra: { node: row, sig: c.picks.join(',') } };
    },

    /** Roughly how much mana you could make right now: untapped sources and the pool. */
    manaHere() {
      const me = this.me;
      const live = this.live || this.view;
      const sources = live.battlefield.filter(o => o.controller === this.meId && !o.tapped &&
        (() => { const a = this.analysis(o); return a && a.manaAbilities && a.manaAbilities.length && !(a.isCreature && o.summoningSick); })()).length;
      const pool = me && me.pool ? ['W', 'U', 'B', 'R', 'G', 'C'].reduce((s, c) => s + (me.pool[c] || 0), 0) : 0;
      return sources + pool;
    },

    askExtras(steps, extras, next) {
      const st = steps.picked;
      const key = 'extras:' + steps.o.id;
      const base = MTG.mana.cmc(String(steps.cost || '').replace(/\{X\}/g, ''));
      /* what a generic question answered here adds: so many copies, or the cards spliced on */
      const chosenCost = (ex) => {
        const sel = st.choices[(ex.choose || {}).purpose];
        if (!sel) return 0;
        if (ex.choose.kind === 'number') return MTG.mana.cmc(ex.cost || '') * (sel.number || 0);
        return (ex.choose.items || []).filter(it => sel.picks.includes(it.id)).reduce((n, it) => n + MTG.mana.cmc(it.cost || ''), 0);
      };
      const spent = () => (st.kick ? MTG.mana.cmc((extras.find(x => x.kind === 'kicker' || x.kind === 'multikicker') || {}).cost || '') * st.kick : 0) +
        // ("Kicker {B} and/or {R}": each cost that is on)
        extras.filter(x => x.kind === 'kicker' && x.costs).reduce((n, x) => n + st.kickPaid.reduce((m, i) => m + MTG.mana.cmc(x.costs[i] || ''), 0), 0) +
        extras.filter(x => ['buyback', 'entwine', 'offspring'].includes(x.kind) && st[x.kind]).reduce((n, x) => n + MTG.mana.cmc(x.cost || ''), 0) +
        (st.squad ? MTG.mana.cmc((extras.find(x => x.kind === 'squad') || {}).cost || '') * st.squad : 0) +
        extras.filter(x => x.choose).reduce((n, x) => n + chosenCost(x), 0);
      // the panel is drawn again whenever something in it changes
      this.asking = { base: key, get key() { return key + ':' + JSON.stringify(st); }, build: () => {
        const spare = this.manaHere() - base - spent();
        const rows = el('div', { class: 'extras' });
        for (const ex of extras) {
          /* Replicate and splice are generic questions (docs/choices.md):
             answered here, with the same body the table uses for them
             anywhere, they go with the cast and the engine does not ask. */
          if (ex.choose) {
            const per = MTG.mana.cmc(ex.cost || '');
            const room = Math.max(0, spare + chosenCost(ex));
            const s = MTG.choice.normalize(ex.choose.kind === 'number'
              ? Object.assign({}, ex.choose, { number: { min: 0, max: Math.min(ex.choose.number.max, per ? Math.floor(room / per) : ex.choose.number.max) } })
              : ex.choose);
            const sel = st.choices[s.purpose] = st.choices[s.purpose] || { picks: [], number: 0 };
            if (s.kind === 'number') sel.number = Math.min(sel.number, s.number.max);
            rows.appendChild(el('div', { class: 'extra-choose' }, [
              el('div', { class: 'mode-text', html: MTG.mana.textHtml(ex.label) + (s.kind === 'number' ? '' : ' <i class="tiny">— click the cards to add</i>') }),
              this.chooseBody(s, sel, {
                onNumber: (n) => { sel.number = n; this.render(); },
                onPick: (id) => {
                  const at = sel.picks.indexOf(id);
                  if (at >= 0) sel.picks.splice(at, 1);
                  else if (MTG.mana.cmc((s.items.find(x => x.id === id) || {}).cost || '') <= spare) sel.picks.push(id);
                  else return UI.error('You do not have the mana for this as well.');
                  this.render();
                },
              }),
            ]));
            continue;
          }
          if (ex.kind === 'spree') {
            for (const m of (ex.modes || [])) {
              const on = st.spree.includes(m.i);
              rows.appendChild(el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : ''),
                // tiered is spree with one tier: picking another replaces the first
                onclick: () => {
                  const at = st.spree.indexOf(m.i);
                  if (at >= 0) st.spree.splice(at, 1);
                  else if (ex.one) st.spree = [m.i];
                  else st.spree.push(m.i);
                  this.render();
                } }, [
                el('span', { class: 'mode-dot', text: on ? '✓' : '' }),
                el('span', { class: 'mode-text', html: `${MTG.mana.html(m.cost || '')} ${MTG.mana.textHtml(truncate(String(m.label || '').replace(/CARDNAME/g, steps.o.card.name), 90))}` }),
              ]));
            }
            // escalate: every mode past the first costs this much more
            if (ex.escalate) {
              const extra = Math.max(0, st.spree.length - 1);
              rows.appendChild(el('div', { class: 'tiny dim', style: { margin: '4px 2px 0' },
                html: `Escalate ${MTG.mana.html(ex.escalate)} for each mode after the first` +
                  (extra ? ` — paying it ${extra === 1 ? 'once' : extra + ' times'}.` : '.') }));
            }
          } else if (ex.kind === 'kicker' && ex.costs) {
            // "Kicker {B} and/or {R}": a toggle for each cost, any or all of them
            ex.costs.forEach((c, i) => {
              const on = st.kickPaid.includes(i);
              const broke = !on && MTG.mana.cmc(c) > spare;
              rows.appendChild(el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : '') + (broke ? ' off' : ''), disabled: broke,
                title: broke ? 'You do not have the mana for this as well' : '',
                onclick: () => { st.kickPaid = on ? st.kickPaid.filter(k => k !== i) : st.kickPaid.concat(i).sort((x, y) => x - y); this.render(); } }, [
                el('span', { class: 'mode-dot', text: on ? '✓' : '' }),
                el('span', { class: 'mode-text', html: MTG.mana.textHtml('Kicker ' + c) + (broke ? ' <i class="cant">not enough mana</i>' : '') }),
              ]));
            });
          } else if (ex.kind === 'multikicker' || ex.kind === 'squad') {
            const prop = ex.kind === 'squad' ? 'squad' : 'kick';
            rows.appendChild(el('div', { class: 'stepper-row' }, [
              el('span', { class: 'mode-text', html: MTG.mana.textHtml(ex.label) }),
              stepper(st[prop], 0, 20, (n) => { st[prop] = n; }),
            ]));
          } else {
            // (optional: a kicker that is not mana, or an additional cost a target hangs on; gift: promised or not)
            const prop = { kicker: 'kick', buyback: 'buyback', entwine: 'entwine', offspring: 'offspring', casualty: 'casualty', optional: 'payAdditional', gift: 'gift' }[ex.kind];
            if (!prop) continue;
            const on = !!st[prop];
            // an extra cost you could not pay on top of the spell is shown, but not offered
            const broke = !on && (!!ex.blocked || MTG.mana.cmc(ex.cost || '') > spare);
            rows.appendChild(el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : '') + (broke ? ' off' : ''), disabled: broke,
              title: broke ? (ex.blocked ? 'You cannot pay this' : 'You do not have the mana for this as well') : '',
              onclick: () => { st[prop] = prop === 'kick' ? (st.kick ? 0 : 1) : !st[prop]; this.render(); } }, [
              el('span', { class: 'mode-dot', text: on ? '✓' : '' }),
              el('span', { class: 'mode-text', html: MTG.mana.textHtml(ex.label) + (broke ? ` <i class="cant">${ex.blocked ? 'cannot pay' : 'not enough mana'}</i>` : '') }),
            ]));
          }
        }
        const spreeOnly = extras.every(x => x.kind === 'spree');
        const tiered = extras.some(x => x.kind === 'spree' && x.one);
        const escalate = extras.some(x => x.kind === 'spree' && x.escalate);
        return this.panel(`Cast ${escapeHtml(steps.o.card.name)}`,
          tiered ? 'Choose the tier you are paying for.' : escalate ? 'Choose one or more modes.' : spreeOnly ? 'Choose the modes you are paying for.' : 'Pay any of these extra costs?', rows, [
          { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
          { label: 'Continue', cls: 'primary', disabled: spreeOnly && !st.spree.length,
            fn: () => { this.asking = null; if (!st.spree.length && extras.some(x => x.kind === 'spree')) st.spree = [0]; next(); } },
        ], { card: steps.o.card });
      } };
      this.render();
    },

    /**
     * X. The most it could be is what you have untapped, so that is offered
     * as the default; arrows and the keyboard move it.
     */
    askX(steps, next) {
      const me = this.me;
      const live = this.live || this.view;
      const fixed = MTG.mana.cmc((steps.cost || '').replace(/\{X\}/g, ''));
      const sources = live.battlefield.filter(o => o.controller === this.meId && !o.tapped &&
        (() => { const a = this.analysis(o); return a && a.manaAbilities && a.manaAbilities.length; })()).length;
      const pool = me && me.pool ? ['W', 'U', 'B', 'R', 'G', 'C'].reduce((s, c) => s + (me.pool[c] || 0), 0) : 0;
      const xs = ((steps.cost || '').match(/\{X\}/g) || []).length || 1;
      const most = Math.max(0, Math.floor((sources + pool - fixed) / xs));
      steps.x = most;
      this.asking = { key: 'x:' + steps.o.id, build: () => {
        const val = el('div', { class: 'x-val', text: String(steps.x) });
        const set = (n) => { steps.x = U.clamp(n, 0, 99); val.textContent = String(steps.x); };
        const body = el('div', { class: 'x-pick' }, [
          el('button', { type: 'button', class: 'btn', text: '−', onclick: () => set(steps.x - 1) }),
          val,
          el('button', { type: 'button', class: 'btn', text: '+', onclick: () => set(steps.x + 1) }),
          el('button', { type: 'button', class: 'btn xs ghost', text: `max (${most})`, onclick: () => set(most) }),
        ]);
        return this.panel(`Choose X for ${escapeHtml(steps.o.card.name)}`, `You can afford up to ${most}.`, body, [
          { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
          { label: 'Cast', cls: 'primary', fn: () => { this.asking = null; next(); } },
        ], { card: steps.o.card });
      } };
      this.render();
    },

    castTargets(steps) {
      const { o, a, via, picked } = steps;
      const specs = [];
      const live = this.live || this.view;
      const offered = (live.extras || {})[o.id] || [];
      /* Jilt, Mind Spiral, Return to Dust: the kick, the gift and the phase decide whether the spell
         has a target more (the engine reads the same) */
      const sel = { kicked: Math.max((picked.kickPaid || []).length, picked.kick || 0, picked.payAdditional ? 1 : 0),
        gift: !!picked.gift, inMain: live.activePlayer === this.meId && live.step === 'main' };
      // fused, both halves' targets are asked for, the left half's first
      const parts = via === 'fuse' ? [MTG.oracle.analyze(o.card, 0), MTG.oracle.analyze(o.card, 1)].filter(Boolean) : [a];
      for (const part of parts) {
        if (part.isPermanent) continue;
        // the targets in the order the engine reads them: one list, shared with the engine
        /* "target spell with mana value X": the X is the one chosen for this
           cast, so only what matches it lights up */
        const xNow = steps.x || 0;
        // cleave: the words in brackets taken out, so the targets are the wider ones the engine checks
        const read = via === 'cleave' && part.cleaveEffects && MTG.rules.effectSpecs
          ? MTG.rules.effectSpecs(part.cleaveEffects) : MTG.rules.spellTargetSpecs(part, sel);
        specs.push(...read.map(s => {
          if (!s || !['mv', 'maxMv', 'minMv'].some(k => s[k] === 'X')) return s;
          const c = Object.assign({}, s);
          for (const k of ['mv', 'maxMv', 'minMv']) if (c[k] === 'X') c[k] = xNow;
          return c;
        }));
      }
      if (a.isAura && a.auraSpec) specs.push(a.auraSpec);
      if (via === 'bestow') specs.push({ type: 'creature', zone: 'battlefield' });
      if (via === 'mutate') specs.push({ type: 'creature', zone: 'battlefield', controller: 'you', notSubtype: 'human' });
      const extra = { kick: picked.kick || 0, buyback: !!picked.buyback, entwine: !!picked.entwine,
        kickPaid: picked.kickPaid && picked.kickPaid.length ? picked.kickPaid.slice() : undefined,
        offspring: !!picked.offspring, squad: picked.squad || 0, casualty: !!picked.casualty,
        spree: picked.spree && picked.spree.length ? picked.spree : undefined, x: steps.x || 0 };
      // (asked with the extra costs: always said one way or the other, so the engine does not ask again)
      if (offered.some(x => x.kind === 'optional')) extra.payAdditional = !!picked.payAdditional;
      if (offered.some(x => x.kind === 'gift')) extra.gift = picked.gift ? true : null;
      if (via === 'fuse') extra.fuse = true;
      else if (via) extra.via = via;
      if (steps.face != null) extra.face = steps.face;
      if (steps.altPay) Object.assign(extra, steps.altPay);
      if (steps.costPicks) Object.assign(extra, steps.costPicks);
      Object.assign(extra, steps.more || {});
      // generic questions answered with the extra costs, in the shape the engine checks them in
      const answered = {};
      for (const [purpose, sel] of Object.entries(picked.choices || {})) {
        const ex = (((this.live || this.view).extras || {})[o.id] || []).find(x => x.choose && x.choose.purpose === purpose);
        if (ex) answered[purpose] = ex.choose.kind === 'number' ? { number: sel.number || 0 } : { picks: sel.picks.slice() };
      }
      if (Object.keys(answered).length) extra.choices = answered;
      /* Paid by the game, or from the lands you tap (below). Convoke and
         the like are worked out by the game alone, so a spell paid partly
         that way is left to it. */
      const byGame = steps.altPay || offered.some(x => ['convoke', 'improvise', 'delve'].includes(x.kind));
      const cost = byGame ? '' : this._castCost(steps, offered);
      const go = (targets) => { this._dropAt = null; this.payThen(Object.assign({ kind: 'cast', objId: o.id, targets }, extra), cost, o.card); };
      this.render();
      if (!specs.length) return go([]);
      /* The targets are asked for in groups, one after the other. A plain
         target is a group of one; "X target creatures", "up to X" and strive
         are a group of their own, as many as X (or as many as there are),
         ended with Done when fewer will do. The picks join up in order. */
      const groups = [];
      const offBoard = (sp) => sp && (sp.zone === 'graveyard' || sp.zone === 'exile');
      for (const s of specs) {
        const m = s.multi;
        const off = offBoard(s);
        if (!m) {
          const last = groups[groups.length - 1];
          // a target the kick, the gift or an "if" brings in is asked for on its own, saying what for
          if (last && !last.multi && !!last.off === off && (last.why || null) === (s.castWhy || null) && (last.text || '') === (s.castText || '')) last.specs.push(s);
          else groups.push({ specs: [s], off, why: s.castWhy || null, text: s.castText || '' });
          continue;
        }
        const plain = Object.assign({}, s, { multi: null });
        const legal = this._countLegal(plain);
        const x = steps.x || 0;
        let n, min;
        if (m.count === 'any') { n = legal; min = Math.min(m.min || 0, legal); }
        else { n = Math.min(x, legal); min = m.exact ? n : 0; }
        if (!n) continue;
        const each = Array.from({ length: n }, (z, i) => (i < min ? plain : Object.assign({}, plain, { upTo: true })));
        groups.push({ specs: each, multi: m, min, off });
      }
      const run = (i, acc) => {
        if (i >= groups.length) return go(acc);
        const g = groups[i];
        const k = g.specs.length;
        const what = g.multi
          ? (g.multi.count === 'any' ? `any number of targets${g.multi.perExtra ? ` (each after the first costs ${g.multi.perExtra} more)` : ''}`
            : g.multi.exact ? `${k} target${k === 1 ? '' : 's'}` : `up to ${k} target${k === 1 ? '' : 's'}`)
          : (k === 1 ? 'a target' : k + ' targets');
        const next = (chosen) => run(i + 1, acc.concat(chosen));
        // "Jilt (kicked): it deals 2 damage to another target creature"
        const whyWords = { kicked: 'kicked', gift: 'gift promised', main: 'main phase' }[g.why];
        const label = g.why && g.text
          ? `${o.card.name}${whyWords ? ` (${whyWords})` : ''}: ${g.text.replace(/CARDNAME/g, o.card.name).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}`
          : `${o.card.name}: choose ${what}`;
        if (g.off) return this._pickOffBoard(g, o, label, next);
        this.startTargeting({
          need: k, specs: g.specs, minChosen: g.min || 0, source: o.id, cardName: o.card.name, spell: true,
          label,
          onDone: next,
        });
      };
      if (!groups.length) return go([]);
      run(0, []);
    },

    /** What a cast costs in mana as the table reads it: the cost it is cast for, and the extra costs chosen. */
    _castCost(steps, offered) {
      const live = this.live || this.view;
      const p = steps.picked || {};
      // flashback, evoke and the other ways in cost what the way says
      const use = steps.via && steps.via !== 'fuse' ? ((live.uses || {})[steps.o.id] || []).find(u => u.via === steps.via && u.cost) : null;
      let cost = String((use && use.cost) || steps.cost || '');
      const ex = (k) => offered.find(x => x.kind === k) || {};
      const kicker = offered.find(x => (x.kind === 'kicker' || x.kind === 'multikicker') && x.cost);
      if (p.kick && kicker) cost += String(kicker.cost).repeat(p.kick);
      for (const i of p.kickPaid || []) cost += (ex('kicker').costs || [])[i] || '';
      for (const k of ['buyback', 'entwine', 'offspring']) if (p[k]) cost += ex(k).cost || '';
      if (p.squad) cost += String(ex('squad').cost || '').repeat(p.squad);
      const spree = ex('spree');
      for (const m of spree.modes || []) if ((p.spree || []).includes(m.i)) cost += m.cost || '';
      if (spree.escalate && (p.spree || []).length > 1) cost += String(spree.escalate).repeat(p.spree.length - 1);
      return cost;
    },

    /* ---------------- paying by hand ----------------
       With Tap lands for me off (and in the first game, until the
       walkthrough turns it on), nothing taps your lands but you. A spell or
       an ability that the mana in your pool does not cover yet is held: the
       banner says what it costs, the lands that could pay glow, and the
       moment the mana you have tapped for covers it, it goes, paid from the
       pool. The table reads the printed cost; should the game want more (a
       tax, say), it says so, and the spell goes again once there is more
       mana. Clicking the spell again, Cancel or Esc puts it back. */

    /** Send a cast or an activation, paid the way you pay: by the game, or from your mana pool. */
    payThen(intent, cost, card) {
      const live = this.live || this.view;
      cost = String(cost || '');
      if (this.autoTap() || !live || !MTG.mana.parse(cost).length) { MTG.sfx('ui_play'); this.send(intent); return; }
      const loc = this.locate(intent.objId, live);
      const p = this.paying = { intent, cost, card: card || null, name: card ? card.name : 'It', objId: intent.objId,
        zone: loc ? loc.zone : null, at: payMoment(live), stack: (live.stack || []).length, tried: null, queued: false };
      // the mana is there already: straight on, paid from the pool
      if (this.poolCovers(cost, intent.x)) return this._payGo(p);
      MTG.sfx('click');
      this.render();
    },

    /** Put a spell waiting for mana back. Nothing is cast; the mana you made stays in your pool. */
    cancelPay() {
      if (!this.paying) return;
      this.paying = null;
      this.render();
    },

    /** The big button while a spell waits: the game taps lands for whatever the pool does not cover. */
    payForMe() {
      const p = this.paying;
      if (!p) return;
      this.paying = null;
      MTG.sfx('ui_play');
      this.send(p.intent);
      this.render();
    },

    /** Whether the mana in your pool pays this cost, the way the pool itself pays. */
    poolCovers(cost, x) {
      const me = this.me;
      if (!me || !MTG.ManaPool) return false;
      const pool = new MTG.ManaPool();
      pool.restore(Object.assign({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, me.pool || {}));
      return pool.canPay(String(cost || ''), { x: x || 0, lifeLimit: Math.max(0, (me.life || 0) - 1) });
    },

    _poolSig() {
      const pool = (this.me && this.me.pool) || {};
      return ['W', 'U', 'B', 'R', 'G', 'C'].map(c => pool[c] || 0).join(',');
    },

    /** Your untapped permanents that could tap for mana now: what glows while a spell waits. */
    manaSources() {
      const live = this.live || this.view;
      if (!live) return [];
      return live.battlefield.filter(o => {
        if (o.controller !== this.meId || o.tapped || o.faceDown) return false;
        const a = this.analysis(o);
        if (!a || !a.manaAbilities || !a.manaAbilities.length) return false;
        // a creature that arrived this turn cannot use {T} yet, not even for mana
        return !(a.isCreature && o.summoningSick && !(o.keywords || []).some(k => /^haste$/i.test(String(k))));
      });
    },

    /** Before a render: a spell whose moment has passed is put back, and one that has gone through is done with. */
    _payStale() {
      const live = this.live;
      // creatures being chosen to convoke: put down with the moment, as a spell waiting for mana is
      const c = this.convoking;
      if (c) {
        const loc = live ? this.locate(c.steps.o.id, live) : null;
        if (!live || live.over || live.priorityPlayer !== this.meId || live.pendingChoice || payMoment(live) !== c.at || !loc || loc.zone !== c.zone) this.convoking = null;
        // (one tapped or gone meanwhile pays nothing)
        else c.picks = c.picks.filter(id => { const o = (live.battlefield || []).find(x => x.id === id); return o && !o.tapped; });
      }
      const p = this.paying;
      if (!p) return;
      const loc = live ? this.locate(p.objId, live) : null;
      // (and once the game taps lands for you again, it is yours to choose again, paid that way)
      if (!live || live.over || this.autoTap() || live.priorityPlayer !== this.meId || live.pendingChoice || payMoment(live) !== p.at ||
          !loc || loc.zone !== p.zone || (live.stack || []).length !== p.stack) this.paying = null;
    },

    /** After a render: once the pool covers the cost, the spell goes (again, after a refusal, only once the pool has changed). */
    _payReady() {
      const p = this.paying;
      if (!p || p.queued || !this._ready() || p.tried === this._poolSig() || !this.poolCovers(p.cost, p.intent.x)) return;
      // not from inside a render: the game answers at once, and the table draws again
      p.queued = true;
      setTimeout(() => { p.queued = false; if (this.paying === p && !this._destroyed) this._payGo(p); }, 0);
    },

    _payGo(p) {
      p.tried = this._poolSig();
      MTG.sfx('ui_play');
      this.send(Object.assign({}, p.intent, { fromPool: true }));
      if (this.paying === p) this.render();
    },

    /** The cards in graveyards (or exile) a target there could be. */
    _offCandidates(spec) {
      const v = this.live || this.view;
      const zone = spec.zone === 'exile' ? 'exile' : 'graveyard';
      const who = v.players.filter(p => spec.controller === 'you' ? p.id === this.meId
        : spec.controller === 'opponent' ? p.id !== this.meId : true);
      const out = [];
      for (const p of who) {
        for (const x of (p[zone] || [])) {
          if (!x || x.hidden || !x.card) continue;
          if (MTG.oracle.matchesSpec(spec, x, MTG.oracle.analyze(x.card, x.face || 0), this.meId)) out.push(x);
        }
      }
      return out;
    },

    /**
     * A target that is a card in a graveyard or in exile: the cards it could
     * be, laid out in a panel to pick from, since they are not on the table.
     * Picks are required up to the group's minimum; the rest are optional.
     */
    _pickOffBoard(g, o, label, onDone) {
      const k = g.specs.length;
      const min = g.min != null ? g.min : g.specs.filter(sp => !sp.upTo).length;
      const picked = [];
      const key = 'offpick:' + o.id + ':' + label;
      const finish = () => { this.asking = null; onDone(picked.map(id => ({ kind: 'object', id }))); };
      this.asking = { base: key, get key() { return key + ':' + picked.join(','); }, build: () => {
        const cands = this._offCandidates(g.specs[Math.min(picked.length, k - 1)] || g.specs[0])
          .concat(picked.map(id => this.objIn(id)).filter(Boolean))
          .filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
        const row = el('div', { class: 'pick-row' });
        for (const x of cands) {
          const on = picked.includes(x.id);
          row.appendChild(this.pickTile(x.card, { face: x.face || 0, cls: on ? 'chosen' : '', badge: on ? picked.indexOf(x.id) + 1 : null,
            onClick: () => {
              const at = picked.indexOf(x.id);
              if (at >= 0) picked.splice(at, 1);
              else if (picked.length < k) picked.push(x.id);
              if (picked.length === k && k === min) return finish();
              this.render();
            } }));
        }
        if (!cands.length) row.appendChild(el('div', { class: 'empty-note', text: 'There is nothing there it could choose.' }));
        const enough = picked.length >= min;
        return this.panel(escapeHtml(label), min === k ? (k === 1 ? `${press()} the card.` : `Choose ${k}.`) : `Choose up to ${k}${min ? `, at least ${min}` : ''}.`, row, [
          { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
          { label: picked.length ? 'Done' : 'None', cls: 'primary', disabled: !enough, fn: () => finish() },
        ], { card: o.card, wide: true });
      } };
      this.render();
    },

    /**
     * A cost the table would otherwise pay out of what is to hand: collect
     * evidence (graveyard cards adding up to N mana value), forage (a Food,
     * or three graveyard cards), reveal N cards, exile a creature of yours,
     * take a counter off one, blight, behold. One panel per cost, in turn;
     * "Let the game choose" leaves it to the table, as before. `onDone` gets
     * the options to send ({ evidenceIds: [...], forageFoodId: id, ... }).
     */
    askCostPicks(rows, x, card, onDone) {
      const out = {};
      const one = (k) => !/Ids$/.test(k);
      const step = (i) => {
        if (i >= rows.length) return onDone(out);
        const r = rows[i];
        const next = () => step(i + 1);
        // forage with both ways open: which way first
        if (r.kind === 'forage' && (r.foods || []).length && (r.candidates || []).length >= 3) {
          const key = 'costway:' + i;
          this.asking = { base: key, key, build: () => this.panel(escapeHtml(r.label || 'Forage'), 'Sacrifice a Food, or exile three cards from your graveyard.', null, [
            { label: 'Let the game choose', fn: () => { this.asking = null; next(); } },
            { label: 'Sacrifice a Food', fn: () => { this.asking = null; this._pickPayers({ label: 'Choose a Food to sacrifice', ids: r.foods, count: 1 }, card, (ids) => { if (ids) out[r.foodKey || 'forageFoodId'] = ids[0]; next(); }); } },
            { label: 'Exile three cards', cls: 'primary', fn: () => { this.asking = null; this._pickPayers({ label: 'Choose three cards to exile', ids: r.candidates, count: 3 }, card, (ids) => { if (ids) out[r.key] = ids; next(); }); } },
          ], { card }) };
          return this.render();
        }
        /* a counter off a permanent of yours: which permanent, then which
           kind of counter when it has more than one */
        if (r.kindKey) {
          const ids1 = r.candidates || [];
          const askKind = (id) => {
            const x = this.objIn(id);
            const kinds = this._counterKinds(x);
            if (kinds.length < 2) return next();
            this._askCounterKind(x.card, kinds, (k) => { if (k) out[r.kindKey] = k; next(); });
          };
          if (!ids1.length) return next();
          if (ids1.length === 1) { out[r.key] = ids1[0]; return askKind(ids1[0]); }
          return this._pickPayers({ label: r.label || 'Choose what pays', ids: ids1, count: 1 }, card, (chosen) => {
            if (!chosen) return next();
            out[r.key] = chosen[0];
            askKind(chosen[0]);
          });
        }
        const ids = r.kind === 'forage' && !(r.candidates || []).length ? (r.foods || []) : (r.candidates || []);
        const key = r.kind === 'forage' && !(r.candidates || []).length ? (r.foodKey || 'forageFoodId') : r.key;
        const need = r.need === 'X' ? x : (Number(r.need) || 1);
        const byValue = r.kind === 'evidence';
        const count = byValue ? null : (one(key) ? 1 : need);
        // nothing to decide: one way to pay, or not enough to choose between
        if (!ids.length || (!byValue && ids.length <= count)) return next();
        this._pickPayers({ label: r.label || 'Choose what pays', ids, count, total: byValue ? need : null }, card, (chosen) => {
          if (chosen) out[key] = one(key) ? chosen[0] : chosen;
          next();
        });
      };
      step(0);
    },

    /** Pick the cards or permanents that pay a cost: a fixed number, or ones whose mana values reach a total. */
    _pickPayers(p, card, done) {
      const picked = [];
      const key = 'payers:' + p.label + ':' + p.ids.join(',');
      const mv = (id) => { const x = this.objIn(id); return (x && x.card && x.card.cmc) || 0; };
      const enough = () => (p.total != null ? picked.reduce((n, id) => n + mv(id), 0) >= p.total : picked.length === p.count);
      this.asking = { base: key, get key() { return key + ':' + picked.join(','); }, build: () => {
        const row = el('div', { class: 'pick-row' });
        for (const id of p.ids) {
          const x = this.objIn(id);
          if (!x || !x.card) continue;
          const on = picked.includes(id);
          row.appendChild(this.pickTile(x.card, { face: x.face || 0, cls: on ? 'chosen' : '', badge: p.total != null ? (x.card.cmc || 0) : (on ? picked.indexOf(id) + 1 : null),
            onClick: () => {
              const at = picked.indexOf(id);
              if (at >= 0) picked.splice(at, 1);
              else if (p.total != null || picked.length < p.count) picked.push(id);
              this.render();
            } }));
        }
        const sum = picked.reduce((n, id) => n + mv(id), 0);
        const sub = p.total != null ? `Mana value ${sum} of ${p.total}.` : `${picked.length} of ${p.count} chosen.`;
        return this.panel(escapeHtml(p.label), sub, row, [
          { label: 'Let the game choose', fn: () => { this.asking = null; done(null); } },
          { label: 'Use these', cls: 'primary', disabled: !enough(), fn: () => { this.asking = null; done(picked.slice()); } },
        ], { card, wide: true });
      } };
      this.render();
    },

    /**
     * Banding (CR 702.22): when any creature that could attack has it, a
     * row under the banner bands the chosen attackers together, and says
     * which bands there are. A band attacks one player, and has at most one
     * creature without banding ("bands with other …" is the engine's to judge).
     */
    _bandRow(ch) {
      const kws = (o) => ((o && o.keywords) || []).map(k => String(k).toLowerCase());
      const bander = (o) => kws(o).some(k => k === 'banding' || k.startsWith('bands with other'));
      const cands = (ch.candidates || []).map(id => this.objIn(id)).filter(Boolean);
      if (!cands.some(bander)) return null;
      const plan = this.attackPlan || { declarations: [] };
      const decl = plan.declarations || [];
      const loose = decl.filter(d => !d.band);
      const bands = new Map();
      for (const d of decl) if (d.band) { if (!bands.has(d.band)) bands.set(d.band, []); bands.get(d.band).push(d); }
      const name = (d) => { const o = this.objIn(d.attackerId); return o && o.card ? o.card.name : 'a creature'; };
      const make = () => {
        if (loose.length < 2) return UI.error('Choose two or more attackers to band together.');
        if (new Set(loose.map(d => d.defenderId)).size > 1) return UI.error('A band attacks one player: choose attackers going at the same one.');
        if (loose.filter(d => !bander(this.objIn(d.attackerId))).length > 1) return UI.error('A band may have only one creature without banding.');
        const label = 'band' + (bands.size + 1);
        for (const d of loose) d.band = label;
        this.render();
      };
      const clear = () => { for (const d of decl) delete d.band; this.render(); };
      const node = el('div', { class: 'ab-chips band-row' }, [
        el('span', { class: 'tiny', text: 'Banding:' }),
        el('button', { type: 'button', class: 'ab-chip', text: loose.length >= 2 ? `Band these ${loose.length}` : 'Band the chosen attackers',
          disabled: loose.length < 2, title: 'The chosen attackers not yet in a band attack together as one band', onclick: make }),
        ...[...bands.entries()].map(([b, ds], i) => el('span', { class: 'ab-chip on', title: ds.map(name).join(', '), text: `Band ${i + 1}: ${ds.length}` })),
        bands.size ? el('button', { type: 'button', class: 'ab-chip', text: 'Undo bands', onclick: clear }) : null,
      ].filter(Boolean));
      return { node, sig: JSON.stringify(decl.map(d => [d.attackerId, d.band || ''])) };
    },

    /** How many things could be chosen for this target right now. */
    _countLegal(spec) {
      if (spec && (spec.zone === 'graveyard' || spec.zone === 'exile')) return this._offCandidates(spec).length;
      const was = this.targeting;
      this.targeting = { specs: [spec], chosen: [], need: 1, onDone: () => {} };
      const v = this.live || this.view;
      const n = v.battlefield.filter(x => this.isTargetable(x)).length + v.players.filter(p => this.isTargetablePlayer(p)).length +
        (v.stack || []).filter(s => this.isTargetableStack(s)).length;
      this.targeting = was;
      return n;
    },
  });

  /** The moment a payment belongs to: mana empties as each step ends, so a new step is a new moment. */
  function payMoment(v) {
    return [v.turn, v.activePlayer, v.phase, v.step].join('|');
  }

  /** A question's words with mana symbols drawn, and {P} as a paw print. */
  function richText(s) {
    return MTG.mana.textHtml(String(s || '')).replace(/<i class="pip [^"]*" title="P"[^>]*>P<\/i>/g, '<i class="pip pip-paw" title="paw print"></i>');
  }

  /** What a target has to be, in words: "a creature you don't control". */
  function specText(spec) {
    if (!spec) return 'a target';
    const t = String(spec.type || '');
    if (t === 'any') return 'any target';
    if (t === 'player') return spec.controller === 'opponent' ? 'an opponent' : spec.controller === 'you' ? 'yourself' : 'a player';
    if (t === 'opponent') return 'an opponent';
    if (t === 'spell') return 'a spell';
    const noun = String(spec.filter && !/^(creature|permanent|artifact|enchantment|land|planeswalker)$/.test(spec.filter) ? spec.filter : t || 'permanent')
      .replace(/_/g, ' ');
    const a = /^[aeiou]/i.test(noun) ? 'an' : 'a';
    const whose = spec.controller === 'you' ? ' you control' : spec.controller === 'opponent' ? ' you don’t control' : '';
    return `${a} ${noun}${whose}`;
  }

  /** A small number picker: minus, the number, plus. */
  function stepper(value, min, max, onChange) {
    let v = value || 0;
    const out = el('span', { class: 'stepper-val', text: String(v) });
    const set = (n) => { v = U.clamp(n, min, max); out.textContent = String(v); onChange(v); };
    return el('span', { class: 'stepper' }, [
      el('button', { type: 'button', class: 'btn xs', text: '−', onclick: () => set(v - 1) }),
      out,
      el('button', { type: 'button', class: 'btn xs', text: '+', onclick: () => set(v + 1) }),
    ]);
  }
})(window.MTG);
