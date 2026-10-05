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
        const title = t.cardName ? `${escapeHtml(t.cardName)}: choose ${escapeHtml(what)}` : escapeHtml(t.label || 'Choose a target');
        return set('aim', title,
          `${t.need > 1 ? `Target ${t.chosen.length + 1} of ${t.need}. ` : ''}Click a highlighted card${who.length ? ' or player' : ''}.` +
          (t.legal ? '' : ' <kbd>Esc</kbd> to cancel.'));
      }
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          const defs = ch.defenders || [];
          const plan = this.attackPlan || { defenderId: (defs[0] || {}).id };
          let extra = null;
          if (defs.length > 1) {
            const row = el('div', { class: 'ab-chips' }, [el('span', { class: 'tiny', text: 'Attacking:' }), ...defs.map(d => el('button', {
              type: 'button', class: 'ab-chip' + (d.id === plan.defenderId ? ' on' : ''), text: d.name,
              onclick: () => { if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: d.id }; this.attackPlan.defenderId = d.id; this.render(); },
            }))]);
            extra = { node: row, sig: plan.defenderId };
          }
          return set('combat', 'Choose attackers', 'Click your creatures to send them in, then press <b>Attack</b>.', extra);
        }
        if (ch.type === 'declareBlockers') {
          const atk = (ch.attackers || []).map(id => this.objIn(id)).filter(Boolean);
          const incoming = atk.reduce((s, o) => s + (o.power || 0), 0);
          const pend = this.blockPlan && this.blockPlan.pendingBlocker;
          const me = this.me;
          return set('combat block', pend ? 'Now click the attacker to block' : 'Choose blockers',
            `${atk.length} attacker${atk.length === 1 ? '' : 's'} · <b>${incoming}</b> damage coming at you${me ? ` (you have ${me.life})` : ''}.` +
            (pend ? '' : ' Click your creature, then the attacker it blocks.'));
        }
        if (ch.type === 'discard' || ch.type === 'discardToHandSize')
          return set('ask', escapeHtml(ch.prompt || 'Discard'), (ch.count || 1) > 1 ? `Choose ${ch.count} cards from your hand.` : 'Click a card in your hand.');
        if (ch.type === 'sacrifice')
          return set('ask', escapeHtml(ch.prompt || 'Sacrifice'), (ch.count || 1) > 1 ? `Choose ${ch.count} of your permanents.` : 'Click one of your permanents.');
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
      if (v.over) want = { key: 'over:' + (v.winners || []).join(',') + ':' + JSON.stringify(v.match || {}), build: () => this.gameOverPanel() };
      else if (v.mulliganPhase && this.me && !this.me.keptHand) want = { key: 'mull:' + this.me.mulligansTaken, build: () => this.mulliganPanel(), live: true };
      else if (v.mulliganPhase && this.me) want = { key: 'mullwait', build: () => this.waitPanel('Waiting for the other players to keep their hands…') };
      else if (this.asking) want = { key: 'ask:' + this.asking.key, build: () => this.asking.build() };
      else {
        const ch = live.pendingChoice;
        if (ch && ch.playerId === this.meId && !ch.waiting && this._ready()) {
          const key = 'ch:' + ch.type + ':' + (ch.prompt || '') + ':' + JSON.stringify(ch.cards ? ch.cards.map(c => c.id) : ch.options || '');
          const build = this.choiceBuilder(ch);
          if (build) want = { key, build };
        }
      }
      if (!want) {
        if (host._key) { host._key = null; host.innerHTML = ''; host.className = 'decision-host'; }
        return;
      }
      if (host._key === want.key && !want.live) return;
      if (host._key !== want.key) {
        host._key = want.key;
        host._state = {};
      }
      host.innerHTML = '';
      const node = want.build(host._state);
      if (!node) { host._key = null; host.className = 'decision-host'; return; }
      host.className = 'decision-host on ' + (node._wide ? 'wide' : '') + (node._full ? ' full' : '');
      if (node._full) this.hidePreview();
      host.appendChild(node);
    },

    /** A panel: a title, an optional line under it, a body and a row of buttons. */
    panel(title, sub, body, buttons, opts) {
      opts = opts || {};
      const p = el('div', { class: 'dpanel' + (opts.cls ? ' ' + opts.cls : '') }, [
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
      /* The card asking is the headline when there is one; the question goes underneath. */
      const head = (fallback, extra) => {
        const q = escapeHtml(ch.prompt || fallback || '');
        const named = ch.sourceName && !String(ch.prompt || '').includes(ch.sourceName);
        return named ? [escapeHtml(ch.sourceName), q + (extra ? ' ' + extra : '')] : [q, extra || ''];
      };
      switch (ch.type) {
        case 'confirm':
          return () => this.panel(...head('Do it?'), null, [
            { label: 'No', fn: () => send({ yes: false }) },
            { label: 'Yes', cls: 'primary', fn: () => send({ yes: true }) },
          ], { card });
        case 'payOrDont': {
          const mana = typeof ch.cost === 'string';
          return () => this.panel(...head('Pay?'), null, [
            { label: 'Don’t pay', fn: () => send({ pay: false }) },
            mana ? { html: 'Pay ' + MTG.mana.html(ch.cost), cls: 'primary', fn: () => send({ pay: true }) }
              : { label: `Pay ${(ch.cost || {}).life || 0} life`, cls: 'primary', fn: () => send({ pay: true }) },
          ], { card });
        }
        case 'payOrCounter':
          return () => this.panel(...head('Pay, or your spell is countered'), null, [
            { label: 'Let it be countered', fn: () => send({ pay: false }) },
            { html: 'Pay ' + MTG.mana.html(ch.cost || ''), cls: 'primary', fn: () => send({ pay: true }) },
          ], { card });
        case 'riot':
          return () => this.panel(...head('Riot', 'It enters with your choice of a +1/+1 counter or haste.'), null, [
            { label: 'Haste', fn: () => send({ haste: true }) },
            { label: '+1/+1 counter', cls: 'primary', fn: () => send({ haste: false }) },
          ], { card });
        case 'vote':
          return () => this.panel(...head('Vote', 'Everyone votes; the most votes wins.'), null,
            (ch.options || []).map(opt => ({ label: opt, cls: 'primary', fn: () => send({ choice: opt }) })), { card });
        case 'mode': return (st) => this.modePanel(ch, st, card, head);
        case 'pickCard': return (st) => this.pickCardPanel(ch, st, card, head);
        case 'scry': case 'surveil': return (st) => this.scryPanel(ch, st, card, head);
        case 'arrange': return (st) => this.arrangePanel(ch, st, { card, head });
        case 'orderTriggers': return (st) => this.arrangePanel(ch, st, { card, head,
          note: 'Click them in the order they go on the stack. The last one you put on resolves first.', done: 'Put them on the stack',
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
              need: ch.count || (ch.specs || []).length || 1, specs: ch.specs || [], chosen: [], legal,
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

    /**
     * "Choose one —". The modes are the card's own words, in the card's own
     * order. Choosing one of two is one decision, so it takes one click; a
     * choice of several collects them and then confirms.
     */
    modePanel(ch, st, card, head) {
      st.picked = st.picked || [];
      const single = ch.count === 1 && !ch.repeatable;
      const list = el('div', { class: 'mode-list' });
      const paint = () => {
        list.innerHTML = '';
        ch.options.forEach((opt) => {
          const n = st.picked.filter(i => i === opt.i).length;
          list.appendChild(el('button', {
            type: 'button', class: 'mode-opt' + (n ? ' on' : ''),
            onclick: () => {
              if (single) { this.send({ kind: 'choice', data: { modes: [opt.i] } }); return; }
              const at = st.picked.indexOf(opt.i);
              if (at >= 0 && !ch.repeatable) st.picked.splice(at, 1);
              else if (st.picked.length < ch.count) st.picked.push(opt.i);
              else if (at >= 0) st.picked.splice(at, 1);
              paint();
              confirm.disabled = st.picked.length !== ch.count;
            },
          }, [
            el('span', { class: 'mode-dot', text: n ? (ch.repeatable && n > 1 ? '×' + n : '✓') : '' }),
            el('span', { class: 'mode-text', html: MTG.mana.textHtml(opt.label) }),
          ]));
        });
      };
      paint();
      const confirm = el('button', { type: 'button', class: 'btn primary', text: 'Confirm', disabled: st.picked.length !== ch.count,
        onclick: () => this.send({ kind: 'choice', data: { modes: st.picked.slice() } }) });
      const [t, sub] = head('Choose', single ? '' : `Choose ${ch.count}.`);
      const p = this.panel(t, sub || (single && !/choose one/i.test(t) ? 'Choose one.' : ''), list, [], { card });
      if (!single) p.appendChild(el('div', { class: 'dp-buttons' }, confirm));
      return p;
    },

    /**
     * "Choose a card" — a face-up row of specific cards, for effects that
     * look at a hand or offer something from a set. The cards travel with
     * the question, so whoever is choosing can already see them.
     */
    pickCardPanel(ch, st, card, head) {
      const want = Math.max(1, ch.count || 1);
      st.picks = st.picks || [];
      const grid = el('div', { class: 'pick-row' });
      const choose = (ids) => this.send({ kind: 'choice', data: { cardIds: ids } });
      /* A library search offers twenty Forests; twenty identical tiles is a
         wall, not a choice. Copies of the same card share one tile with a
         count, and taking from it takes the next copy. */
      const groups = [], byKey = new Map();
      for (const c of (ch.cards || [])) {
        const key = c.card ? (c.card.oracle_id || c.card.name) + '|' + (c.card.id || '') : c.id;
        let g = byKey.get(key);
        if (!g) { g = { card: c.card, ids: [] }; byKey.set(key, g); groups.push(g); }
        g.ids.push(c.id);
      }
      for (const g of groups) {
        const taken = () => g.ids.filter(id => st.picks.includes(id)).length;
        const badge = () => (g.ids.length > 1 ? (taken() ? `${taken()}/${g.ids.length}` : '×' + g.ids.length) : (taken() ? '✓' : ''));
        const tile = this.pickTile(g.card, {
          cls: taken() ? 'on' : '', badge: badge(),
          onClick: () => {
            if (want === 1) return choose([g.ids[0]]);
            const free = g.ids.find(id => !st.picks.includes(id));
            if (free && st.picks.length < want) st.picks.push(free);
            else { const had = g.ids.filter(id => st.picks.includes(id)).pop(); if (had) st.picks.splice(st.picks.indexOf(had), 1); }
            tile.classList.toggle('on', taken() > 0);
            const b = tile.querySelector('.pt-badge');
            if (b) b.textContent = badge();
            go.disabled = !(st.picks.length === want || (ch.optional && st.picks.length));
          },
        });
        grid.appendChild(tile);
      }
      if (!(ch.cards || []).length) grid.appendChild(el('div', { class: 'empty-note', text: 'There is nothing to choose.' }));
      const go = el('button', { type: 'button', class: 'btn primary', text: 'Choose', disabled: true, onclick: () => choose(st.picks.slice()) });
      const buttons = [];
      if (ch.optional || !(ch.cards || []).length) buttons.push({ label: want === 1 ? 'None of them' : 'Decline', fn: () => choose([]) });
      const [t, sub] = head('Choose a card', want > 1 ? `Choose ${want}.` : '');
      const p = this.panel(t, sub, grid, buttons, { wide: true, card });
      if (want > 1) p.querySelector('.dp-buttons') ? p.querySelector('.dp-buttons').appendChild(go) : p.appendChild(el('div', { class: 'dp-buttons' }, go));
      return p;
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
      const [t, sub] = head(surveil ? 'Surveil' : 'Scry', 'Click a card to move it between the two rows.');
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
      const note = opts.note || (lookOnly ? 'They stay where they are, in this order.' : 'Click them in the order they should sit on top of your library, first to draw first.');
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
      if (guest) buttons.push({ label: 'Leave the table', cls: 'primary', fn: () => MTG.app.leaveGame() });
      else if (m && !m.decided) buttons.push({ label: `Play game ${m.gameNumber + 1}`, cls: 'primary', fn: () => MTG.app.nextGame() });
      else buttons.push({ label: m ? 'New match' : 'Rematch', cls: 'primary', fn: () => MTG.app.rematch() });
      if (!guest) buttons.unshift({ label: 'Back to menu', fn: () => MTG.app.leaveGame() });
      buttons.unshift({ label: 'Look at the board', fn: () => { this.decision.classList.add('peek'); setTimeout(() => this.decision.classList.remove('peek'), 4000); } });
      const body = el('div', { class: 'over-body' }, [
        el('div', { class: 'over-word ' + (won ? 'win' : draw ? 'draw' : 'loss'), text: won ? 'Victory' : draw ? 'Draw' : 'Defeat' }),
        el('div', { class: 'over-sub', text: draw ? 'Nobody is left standing.' : won ? `Turn ${v.turn}` : `${names.join(' & ')} win${names.length > 1 ? '' : 's'} on turn ${v.turn}` }),
        guest ? el('div', { class: 'over-note', text: 'If the host starts another game, it opens here.' }) : null,
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
    beginCast(o, a, via) {
      const live = this.live || this.view;
      const extras = (live.extras || {})[o.id] || [];
      const steps = { o, a, via, picked: { kick: 0, buyback: false, entwine: false, offspring: false, squad: 0, casualty: false, spree: [] }, x: 0 };
      const hasX = /\{X\}/.test(o.card.mana_cost || (o.card.card_faces && o.card.card_faces[o.face || 0] && o.card.card_faces[o.face || 0].mana_cost) || '');
      const afterExtras = () => (hasX && via !== 'morph' ? this.askX(steps, afterX) : afterX());
      const afterX = () => this.castTargets(steps);
      if (extras.length) this.askExtras(steps, extras, afterExtras);
      else afterExtras();
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
      const base = MTG.mana.cmc(String(steps.o.card.mana_cost || '').replace(/\{X\}/g, ''));
      const spent = () => (st.kick ? MTG.mana.cmc((extras.find(x => x.kind === 'kicker' || x.kind === 'multikicker') || {}).cost || '') * st.kick : 0) +
        extras.filter(x => ['buyback', 'entwine', 'offspring'].includes(x.kind) && st[x.kind]).reduce((n, x) => n + MTG.mana.cmc(x.cost || ''), 0) +
        (st.squad ? MTG.mana.cmc((extras.find(x => x.kind === 'squad') || {}).cost || '') * st.squad : 0);
      this.asking = { key, build: () => {
        const spare = this.manaHere() - base - spent();
        const rows = el('div', { class: 'extras' });
        for (const ex of extras) {
          if (ex.kind === 'spree') {
            for (const m of (ex.modes || [])) {
              const on = st.spree.includes(m.i);
              rows.appendChild(el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : ''),
                onclick: () => { const at = st.spree.indexOf(m.i); if (at >= 0) st.spree.splice(at, 1); else st.spree.push(m.i); this.render(); } }, [
                el('span', { class: 'mode-dot', text: on ? '✓' : '' }),
                el('span', { class: 'mode-text', html: `${MTG.mana.html(m.cost || '')} ${MTG.mana.textHtml(truncate(m.label, 90))}` }),
              ]));
            }
          } else if (ex.kind === 'multikicker' || ex.kind === 'squad') {
            const prop = ex.kind === 'squad' ? 'squad' : 'kick';
            rows.appendChild(el('div', { class: 'stepper-row' }, [
              el('span', { class: 'mode-text', html: MTG.mana.textHtml(ex.label) }),
              stepper(st[prop], 0, 20, (n) => { st[prop] = n; }),
            ]));
          } else {
            const prop = { kicker: 'kick', buyback: 'buyback', entwine: 'entwine', offspring: 'offspring', casualty: 'casualty' }[ex.kind];
            if (!prop) continue;
            const on = !!st[prop];
            // an extra cost you could not pay on top of the spell is shown, but not offered
            const broke = !on && MTG.mana.cmc(ex.cost || '') > spare;
            rows.appendChild(el('button', { type: 'button', class: 'mode-opt' + (on ? ' on' : '') + (broke ? ' off' : ''), disabled: broke,
              title: broke ? 'You do not have the mana for this as well' : '',
              onclick: () => { st[prop] = prop === 'kick' ? (st.kick ? 0 : 1) : !st[prop]; this.render(); } }, [
              el('span', { class: 'mode-dot', text: on ? '✓' : '' }),
              el('span', { class: 'mode-text', html: MTG.mana.textHtml(ex.label) + (broke ? ' <i class="cant">not enough mana</i>' : '') }),
            ]));
          }
        }
        const spreeOnly = extras.every(x => x.kind === 'spree');
        return this.panel(`Cast ${escapeHtml(steps.o.card.name)}`, spreeOnly ? 'Choose the modes you are paying for.' : 'Pay any of these extra costs?', rows, [
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
      const fixed = MTG.mana.cmc((steps.o.card.mana_cost || '').replace(/\{X\}/g, ''));
      const sources = live.battlefield.filter(o => o.controller === this.meId && !o.tapped &&
        (() => { const a = this.analysis(o); return a && a.manaAbilities && a.manaAbilities.length; })()).length;
      const pool = me && me.pool ? ['W', 'U', 'B', 'R', 'G', 'C'].reduce((s, c) => s + (me.pool[c] || 0), 0) : 0;
      const xs = ((steps.o.card.mana_cost || '').match(/\{X\}/g) || []).length || 1;
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
      const eff = a.isPermanent ? [] : MTG.oracle.parseEffects(a.oracleTextParsed || a.oracleText || '').effects;
      for (const e of eff) for (const s of (e.targets || [])) specs.push(s);
      if (a.isAura && a.auraSpec) specs.push(a.auraSpec);
      if (via === 'bestow') specs.push({ type: 'creature', zone: 'battlefield' });
      if (via === 'mutate') specs.push({ type: 'creature', zone: 'battlefield', controller: 'you', notSubtype: 'human' });
      const extra = { kick: picked.kick || 0, buyback: !!picked.buyback, entwine: !!picked.entwine,
        offspring: !!picked.offspring, squad: picked.squad || 0, casualty: !!picked.casualty,
        spree: picked.spree && picked.spree.length ? picked.spree : undefined, x: steps.x || 0 };
      if (via) extra.via = via;
      const go = (targets) => { MTG.sfx('cast'); this._dropAt = null; this.send(Object.assign({ kind: 'cast', objId: o.id, targets }, extra)); };
      this.render();
      if (!specs.length) return go([]);
      this.startTargeting({
        need: specs.length, specs, source: o.id, cardName: o.card.name,
        label: `${o.card.name}: choose ${specs.length === 1 ? 'a target' : specs.length + ' targets'}`,
        onDone: go,
      });
    },
  });

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
