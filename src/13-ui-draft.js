/* ============================================================
   13-ui-draft.js - the draft table and the cube manager
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, util: U } = MTG;
  const UI = MTG.ui;

  class DraftTable {
    constructor(root, seatId, send) {
      this.root = root;
      this.seatId = seatId;
      this.send = send;
      this.view = null;
      this.chosen = [];
      this.ability = null;      // the card in the pool paying for this pick
      this._seenOffers = new Set();
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
      this.root.innerHTML = '';
      this.root.classList.remove('draft-layout');
    }
    update(view) {
      this.view = view;
      // a card that asks a question the moment it is drafted asks it here
      for (const o of (view.offers || [])) {
        if (this._seenOffers.has(o.cardId)) continue;
        this._seenOffers.add(o.cardId);
        this._askOffer(o);
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
      if (!v || v.sittingOut || !v.pack.length) return false;
      const need = this._need(v);
      if (need > 0 && this.chosen.length !== need) return false;
      this.send({ kind: 'pick', cardIds: this.chosen.slice(), ability: this.ability || null });
      this.chosen = [];
      this.ability = null;
      return true;
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

    /** The strip of cards in your pool that do something during the draft. */
    _abilityBar(v) {
      const all = v.abilities || [];
      if (!all.length) return null;
      const usable = v.canUse || [];
      const kids = [el('span', { class: 'small muted', text: 'Draft abilities:' })];
      for (const a of all) {
        const can = usable.some(x => x.cardId === a.cardId);
        const on = this.ability === a.cardId;
        const spent = a.left <= 0;
        if (a.passive || a.auto) {
          kids.push(el('span', { class: 'pill', title: a.prompt, text: `${a.name} — ${a.label}` }));
          continue;
        }
        if (!a.known) {
          kids.push(el('span', { class: 'pill warn', title: a.prompt, text: `${a.name} — run this one yourselves` }));
          continue;
        }
        kids.push(el('button', {
          class: 'btn xs' + (on ? ' primary' : '') + (spent ? ' ghost' : ''),
          disabled: !can && !on,
          title: spent ? 'Already used' : a.prompt,
          onclick: () => this._useAbility(a),
        }, [el('span', { text: spent ? `${a.name} (used)` : `${a.name}: ${a.label}` })]));
      }
      if (v.sittingOut) kids.push(el('span', { class: 'pill warn', text: 'Sitting out the rest of this pack' }));
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
      if (a.kind === 'exile') return this._pickExile(a);
      if (a.kind === 'peek') return this._pickPeek(a);
    }

    async _pickExile(a) {
      const pool = this.view.pool || [];
      const grid = el('div', { class: 'card-grid' });
      const m = UI.modal({
        title: a.name, width: '900px',
        content: el('div', null, [
          el('p', { class: 'small muted', text: 'Choose a card in your pool to take out of the draft. It is gone for good.' }),
          grid,
        ]),
        buttons: [{ label: 'Cancel', onClick: () => m.close() }],
      });
      for (const c of pool) {
        if (c.id === a.cardId) continue;
        grid.appendChild(UI.cardSlot(c, {}, {
          onClick: () => { m.close(); this.send({ kind: 'draftExile', cardId: a.cardId, targetId: c.id }); },
        }));
      }
    }

    _pickPeek(a) {
      this.send({ kind: 'draftPeek', cardId: a.cardId, which: 0 });
    }

    /** Show what a peek turned up. */
    showPeek(res) {
      if (!res || !res.cards) return UI.error('Nothing to look at.');
      const grid = el('div', { class: 'card-grid' });
      for (const c of res.cards) grid.appendChild(UI.cardSlot(c, {}, { size: 'small' }));
      UI.modal({
        title: `An unopened pack from round ${res.round}`, width: '900px',
        content: grid,
        buttons: [{ label: 'Close', class: 'primary', onClick: (m) => m.close() }],
      });
    }

    /** The layout redraws on rotation; there is no floating advice to put away. */
    closeAdvice() {}

    render() {
      const v = this.view;
      if (!v) return;
      const need = this._need(v);

      /* -- the head: where you are in the draft, over the pack's best card -- */
      this.head.innerHTML = '';
      const best = UI.packOrder(v.pack || []).slice().reverse().find(c => UI.packBand(c) < 9) || (v.pack || [])[0];
      const art = el('div', { class: 'draft-head-art', 'aria-hidden': 'true' });
      if (best) UI.setArt(art, best);
      const packSize = Math.max(v.pack.length + (v.pick || 1) - 1, v.pack.length);
      const dots = el('div', { class: 'pick-dots', 'aria-hidden': 'true' });
      for (let i = 1; i <= Math.min(packSize, 20); i++) {
        dots.appendChild(el('i', { class: i < v.pick ? 'done' : i === v.pick ? 'now' : '' }));
      }
      const confirm = el('button', {
        class: 'btn primary hero-btn draft-go',
        text: this.ability && need === 0
          ? 'Take the whole pack'
          : (this.chosen.length === need ? `Confirm pick${need > 1 ? 's' : ''}` : `Pick ${this.chosen.length}/${need}`),
        disabled: (need > 0 && this.chosen.length !== need) || !v.pack.length || v.sittingOut,
        onclick: () => { this.confirmPick(); },
      });
      this.head.append(
        art,
        el('div', { class: 'draft-where' }, [
          el('div', { class: 'eyebrow', text: (v.setsUsed || []).join(' · ') || 'Mixed packs' }),
          el('div', { class: 'draft-title' }, [
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
      if (!v.pack.length) {
        this.packWrap.appendChild(el('div', { class: 'draft-waiting' }, [
          el('div', { class: 'busy-sigil', 'aria-hidden': 'true' }, [el('i'), el('i'), el('b')]),
          el('div', { text: 'Waiting for the next pack…' }),
        ]));
      } else {
        const grid = el('div', { class: 'pack-grid' + (this.chosen.length ? ' choosing' : '') });
        // laid out by colour and then by rarity, the way you would fan a pack
        UI.packOrder(v.pack).forEach((c, i) => {
          const chosen = this.chosen.includes(c.id);
          const slot = UI.cardSlot(c, {}, {
            class: 'pick-card' + (chosen ? ' chosen' : '') + ' r-' + (c.rarity || 'common'),
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
          if (chosen) slot.appendChild(el('span', { class: 'pick-flag', text: need > 1 ? `Pick ${this.chosen.indexOf(c.id) + 1}` : 'Your pick' }));
          grid.appendChild(slot);
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
      const COLS = [['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['M', 'Gold'], ['C', 'Colourless'], ['L', 'Lands']];
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

    let deck = MTG.draft.autoBuildLimited(pool, {
      deckSize: fmt.deckMin || 40, basicCards: basics, formatId, name: 'Limited deck',
    });

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
      finish: { label: 'Play with this deck', onClick: (d) => { if (onDone) onDone(d); } },
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


