/* ============================================================
   11-ui-deck.js - deck storage, import, and the deck builder
   Decks are stored as card ids + quantities and rehydrated from the
   Scryfall cache, so a hundred saved decks still fit in localStorage.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, util: U } = MTG;
  const UI = MTG.ui;

  /* ---------------- storage ---------------- */
  const decks = MTG.decks = {
    index() { return MTG.store.get('deckindex', []); },
    _writeIndex(idx) { MTG.store.set('deckindex', idx); },

    save(deck) {
      const slim = {
        id: deck.id, name: deck.name, format: deck.format,
        main: deck.main.map(e => ({ id: e.card.id, q: e.qty })),
        side: (deck.sideboard || []).map(e => ({ id: e.card.id, q: e.qty })),
        cmd: (deck.commanders || []).map(c => c.id),
        comp: deck.companion ? deck.companion.id : null,
        colors: deck.colors || null,
        source: deck.source || 'manual',
        cover: deck.cover || null,
        updatedAt: Date.now(),
      };
      MTG.store.set('deck.' + deck.id, slim);
      const idx = decks.index();
      const i = idx.findIndex(d => d.id === deck.id);
      // the index is what the deck list sorts and filters on, so it carries
      // enough to do that without loading every deck from storage
      const idColors = new Set();
      for (const e of deck.main) for (const c of (e.card.color_identity || [])) idColors.add(c);
      for (const c of (deck.commanders || [])) for (const x of (c.color_identity || [])) idColors.add(x);
      const meta = {
        id: deck.id, name: deck.name, format: deck.format,
        size: U.sum(deck.main.map(e => e.qty)) + (deck.commanders || []).length,
        commander: (deck.commanders || []).map(c => c.name).join(' + ') || null,
        identity: MTG.mana.COLORS.filter(c => idColors.has(c)),
        source: slim.source,
        // the deck box shows its key card's art without loading the deck
        art: UI.artUrl(UI.keyCard(deck)) || null,
        // and how much of it the game runs by itself, for the same reason
        auto: autoMeta(deck),
        createdAt: (i >= 0 && idx[i].createdAt) || deck.createdAt || slim.updatedAt,
        updatedAt: slim.updatedAt,
      };
      if (i >= 0) idx[i] = meta; else idx.push(meta);
      decks._writeIndex(idx);
      return meta;
    },

    async load(id) {
      const slim = MTG.store.get('deck.' + id, null);
      if (!slim) return null;
      const ids = slim.main.map(e => e.id).concat(slim.side.map(e => e.id), slim.cmd, slim.comp ? [slim.comp] : []);
      const { cards } = await MTG.scry.collection(ids.map(i => ({ id: i })));
      const byId = new Map();
      ids.forEach((i, k) => { if (cards[k]) byId.set(i, cards[k]); });
      const hydrate = (list) => list.map(e => ({ card: byId.get(e.id), qty: e.q })).filter(e => e.card);
      return {
        id: slim.id, name: slim.name, format: slim.format,
        main: hydrate(slim.main), sideboard: hydrate(slim.side),
        commanders: slim.cmd.map(i => byId.get(i)).filter(Boolean),
        companion: slim.comp ? byId.get(slim.comp) : null,
        colors: slim.colors, source: slim.source, cover: slim.cover || null,
      };
    },

    /**
     * The art for a deck saved before decks carried it: loaded once, worked
     * out, and written into the index so the next visit is instant.
     */
    async ensureArt(id) {
      const have = decks.index().find(d => d.id === id);
      if (have && have.art) return have.art;
      const full = await decks.load(id);
      const url = full ? UI.artUrl(UI.keyCard(full)) : '';
      if (!url) return null;
      const idx = decks.index();
      const at = idx.find(d => d.id === id);
      if (at) { at.art = url; decks._writeIndex(idx); }
      return url;
    },

    /**
     * How much of a saved deck the game runs by itself, as {n, of}. The
     * index remembers it; a deck saved before it did, or by an older build
     * of the engine, is loaded once and counted again.
     */
    async ensureAuto(id) {
      const have = decks.index().find(d => d.id === id);
      if (have && have.auto && have.auto.v === UI.autoStamp()) return have.auto;
      const full = await decks.load(id);
      if (!full) return null;
      const meta = autoMeta(full);
      const idx = decks.index();
      const at = idx.find(d => d.id === id);
      if (at) { at.auto = meta; decks._writeIndex(idx); }
      return meta;
    },

    remove(id) {
      MTG.store.del('deck.' + id);
      decks._writeIndex(decks.index().filter(d => d.id !== id));
    },
    forFormat(fmtId) {
      const fmt = MTG.formats.get(fmtId);
      return decks.index().filter(d => {
        if (d.format === fmtId) return true;
        // a hundred-card commander list plays in any of the commander formats
        if (fmt && fmt.commander) return ['commander', 'cmdrdraft'].includes(d.format);
        return false;
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };

  function autoMeta(deck) {
    const sum = UI.deckAutomation(deck);
    return { n: sum.auto, of: sum.total, v: UI.autoStamp() };
  }

  /**
   * A deck's automation pill for a list, from the index when it is current
   * and worked out in the background when it is not. `d` is an index entry.
   */
  UI.deckAutoPill = function (d, cls) {
    const host = el('span', { class: 'auto-slot' });
    const put = (a) => { host.innerHTML = ''; if (a && a.of) host.appendChild(UI.autoShare(a.n, a.of, { class: cls })); };
    if (d.auto && d.auto.v === UI.autoStamp()) put(d.auto);
    else {
      if (d.auto) put(d.auto);
      decks.ensureAuto(d.id).then(put).catch(() => {});
    }
    return host;
  };

  /* ---------------- import dialog ---------------- */
  UI.importDeck = function (formatId, onDone) {
    const ta = el('textarea', { rows: 16, placeholder: PLACEHOLDER, spellcheck: 'false' });
    const nameInput = el('input', { type: 'text', placeholder: 'Deck name (optional)' });
    const fmtSelect = el('select', null, MTG.formats.list().map(f =>
      el('option', { value: f.id, text: f.name, selected: f.id === formatId })));
    const setInput = el('input', { type: 'text', placeholder: 'e.g. MH3 - leave blank to keep each list’s printing' });
    const status = el('div', { class: 'small muted' });
    const useArt = el('input', { type: 'checkbox', checked: true, style: { width: 'auto' } });

    const m = UI.modal({
      title: 'Import a decklist',
      width: '760px',
      content: el('div', null, [
        el('p', { class: 'small muted', text: 'Paste an export from Moxfield, Archidekt, MTGGoldfish, TappedOut, Deckstats, EDHREC, MTG Arena, or just one card per line. Set codes, collector numbers, Commander/Sideboard/Companion headers and "SB:" prefixes are all understood.' }),
        ta,
        el('div', { class: 'two-col', style: { marginTop: '12px' } }, [
          el('label', { class: 'field' }, [el('span', { text: 'Deck name' }), nameInput]),
          el('label', { class: 'field' }, [el('span', { text: 'Format' }), fmtSelect]),
        ]),
        el('label', { class: 'field' }, [el('span', { text: 'Prefer printings from this set code' }), setInput]),
        el('label', { class: 'row small', style: { gap: '6px', marginBottom: '10px' } }, [useArt, el('span', { text: 'Apply my saved art choices' })]),
        status,
      ]),
      buttons: [
        { label: 'Cancel', onClick: () => m.close() },
        { label: 'Import', class: 'primary', onClick: () => go() },
      ],
      onOpen: () => setTimeout(() => ta.focus(), 30),
    });

    async function go() {
      const text = ta.value.trim();
      if (!text) return UI.error('Paste a decklist first.');
      const busy = UI.busy('Importing', 'Looking cards up on Scryfall…');
      try {
        const res = await MTG.decklist.importDeck(text, fmtSelect.value, {
          name: nameInput.value.trim() || undefined,
          preferSet: setInput.value.trim().toLowerCase() || undefined,
          useArtPrefs: useArt.checked,
          onProgress: (a, b) => busy.set(a / b, `Resolving cards… ${a}/${b}`),
        });
        busy.close();
        m.close();
        MTG.scry.prefetchImages(res.deck.main.map(e => e.card).concat(res.deck.commanders), 'small');
        const openBuilder = () => UI.deckBuilder(res.deck,
          { validation: res.validation, missing: res.missing, warnings: res.warnings, onSave: onDone });
        // a report first: what the list is, whether it is legal, what it combos into
        UI.deckReport(res.deck, fmtSelect.value, {
          validation: res.validation, missing: res.missing,
          onOpenBuilder: openBuilder,
          onAdd: (card) => {
            const e = res.deck.main.find(x => x.card.id === card.id);
            if (e) e.qty++; else res.deck.main.push({ card, qty: 1 });
            UI.ok('Added ' + card.name + ' to the list.');
          },
          onSwap: (card, cut) => {
            MTG.advisor.applySwap(res.deck, card, cut);
            UI.ok('Swapped in ' + card.name + ' for ' + cut.name + '.');
          },
        });
      } catch (e) {
        busy.close();
        UI.error(e.message || String(e));
      }
    }
    return m;
  };

  const PLACEHOLDER = `Commander
1 Atraxa, Grand Unifier (ONE) 196

Deck
1 Sol Ring
1 Arcane Signet
1 Cultivate
4 Lightning Bolt
10 Forest

Sideboard
2 Pyroblast`;

  /* ---------------- deck builder ---------------- */

  UI.deckBuilder = function (deck, opts) {
    opts = opts || {};
    /* Work on a copy so Close can throw the edits away. Only the structure
       is copied: the cards themselves are shared, read-only Scryfall data,
       and deep-copying a hundred of them on every open is pure waste. */
    deck = Object.assign({}, deck, {
      main: (deck.main || []).map(e => ({ card: e.card, qty: e.qty })),
      sideboard: (deck.sideboard || []).map(e => ({ card: e.card, qty: e.qty })),
      commanders: (deck.commanders || []).slice(),
    });
    let validation = opts.validation || MTG.formats.validate(deck, deck.format);

    const left = el('div', { class: 'panel deck-list' });
    const paneOverview = el('div', { class: 'deck-pane' });
    const paneAdvisor = el('div', { class: 'deck-pane' });
    const paneCards = el('div', { class: 'deck-pane' });
    const panes = { overview: paneOverview, advisor: paneAdvisor, cards: paneCards };
    let activePane = 'overview';
    const tabsBar = el('div', { class: 'side-tabs', role: 'tablist', 'aria-label': 'Deck views' });
    const paneHost = el('div', { class: 'deck-pane-host' }, [paneOverview, paneAdvisor, paneCards]);
    // On a phone there is no room for a list beside the panes, so the list
    // becomes a tab of its own and the builder is one full-screen stack.
    const phone = MTG.isPhone();
    const tabDefs = phone
      ? [['list', 'Deck'], ['overview', 'Overview'], ['advisor', 'Suggestions'], ['cards', 'Cards']]
      : [['overview', 'Overview'], ['advisor', 'Suggestions & combos'], ['cards', 'Cards']];
    if (phone) { panes.list = left; activePane = 'list'; }
    for (const [id, label] of tabDefs) {
      const t = el('button', {
        type: 'button', role: 'tab', class: 'side-tab' + (id === activePane ? ' active' : ''), text: label, dataset: { pane: id },
        'aria-selected': id === activePane ? 'true' : 'false',
      });
      t.addEventListener('click', () => {
        showPane(id);
        if (id === 'advisor') advisor.refresh(validation);
      });
      tabsBar.appendChild(t);
    }
    panes[activePane].classList.add('active');
    const right = phone
      ? el('div', { class: 'panel deck-right' }, [tabsBar, el('div', { class: 'deck-pane-host' }, [left, paneOverview, paneAdvisor, paneCards])])
      : el('div', { class: 'panel deck-right' }, [tabsBar, paneHost]);
    const wrap = el('div', { class: 'deck-layout' + (phone ? ' stacked' : '') },
      phone ? [right] : [left, right]);
    if (!phone) wrap.style.height = 'min(74vh, 760px)';

    // After a draft the builder is a step in a flow, not a document editor:
    // the deck is not in the collection yet, and closing the window has to
    // carry on to the game rather than stranding the player at an empty table.
    const buttons = [
      { label: 'Card art…', onClick: () => UI.manageDeckArt(deck, () => render()) },
      { label: 'Export', onClick: () => exportDeck() },
    ];
    if (opts.finish) {
      buttons.push({ label: 'Save to my decks', onClick: () => saveOnly() });
      buttons.push({ label: opts.finish.label || 'Continue', class: 'primary', onClick: () => finish() });
    } else {
      buttons.push({ label: 'Close', onClick: () => m.close() });
      buttons.push({ label: 'Save deck', class: 'primary', onClick: () => save() });
    }

    const m = UI.modal({
      title: 'Deck — ' + deck.name,
      width: '1280px',
      className: 'deck-modal',
      content: wrap,
      closable: !opts.finish,
      buttons,
    });
    // the deck's key card heads the window, and changes when the commander does
    const headArt = UI.artBehind(m.head, null);
    let headArtFor = null;

    function cleanName() {
      deck.name = deck.name.trim() || 'Untitled deck';
      return deck.name;
    }

    function save() {
      cleanName();
      MTG.decks.save(deck);
      UI.ok('Deck saved.');
      m.close();
      if (opts.onSave) opts.onSave(deck);
    }

    /** Keep the deck without leaving the step it belongs to. */
    let savedOnce = false;
    function saveOnly() {
      cleanName();
      MTG.decks.save(deck);
      savedOnce = true;
      m.setTitle('Deck — ' + deck.name);
      UI.ok(`"${deck.name}" is in your decks.`);
    }

    function finish() {
      cleanName();
      if (savedOnce) MTG.decks.save(deck);   // keep the saved copy current
      m.close();
      if (opts.finish && opts.finish.onClick) opts.finish.onClick(deck);
      else if (opts.onSave) opts.onSave(deck);
    }

    function exportDeck() {
      const styleSel = el('select', null, [
        el('option', { value: 'plain', text: 'Plain (name only)' }),
        el('option', { value: 'moxfield', text: 'Moxfield / Archidekt (with set + number)' }),
        el('option', { value: 'arena', text: 'MTG Arena' }),
      ]);
      const out = el('textarea', { rows: 18, readonly: true });
      const refresh = () => { out.value = MTG.decklist.toText(deck, styleSel.value); };
      styleSel.addEventListener('change', refresh);
      refresh();
      UI.modal({
        title: 'Export decklist', width: '620px',
        content: el('div', null, [el('label', { class: 'field' }, [el('span', { text: 'Format' }), styleSel]), out]),
        buttons: [{ label: 'Copy', class: 'primary', onClick: (mm) => { out.select(); document.execCommand('copy'); UI.ok('Copied.'); } }],
      });
    }

    function changeQty(entry, delta) {
      entry.qty += delta;
      if (entry.qty <= 0) {
        const i = deck.main.indexOf(entry);
        if (i >= 0) deck.main.splice(i, 1);
        else { const j = deck.sideboard.indexOf(entry); if (j >= 0) deck.sideboard.splice(j, 1); }
      }
      render();
    }

    /**
     * Give the job to this card. Whoever had it goes back into the deck as
     * an ordinary card rather than disappearing, because swapping commanders
     * while you tune a list should not quietly cost you the old one.
     */
    function setCommander(card) {
      const had = deck.commanders.slice();
      deck.commanders = [card];
      deck.main = deck.main.filter(e => e.card.id !== card.id);
      for (const old of had) {
        if (old.id === card.id) continue;
        const already = deck.main.find(e => e.card.id === old.id);
        if (already) already.qty++;
        else deck.main.push({ card: old, qty: 1 });
      }
      if (had.length) UI.toast(`${card.name} takes over from ${had[0].name}.`);
      onCommanderChosen(card, !had.length);
      render();
    }

    /* ----- picking out one slice of the deck -----
       The breakdown and the mana curve are not just numbers to read: tapping
       one marks every card it counted, in the list and in the card grid, so
       "nine three-drops" turns into which nine. */
    let highlight = null;   // { kind: 'type' | 'mv', value }

    function setHighlight(kind, value) {
      const same = highlight && highlight.kind === kind && String(highlight.value) === String(value);
      highlight = same ? null : { kind, value };
      MTG.sfx('click');
      // on a phone the list is behind a tab, so bring it forward
      if (highlight && panes.list && activePane !== 'list') showPane('list');
      render();
    }

    function showPane(id) {
      activePane = id;
      for (const x of tabsBar.children) {
        x.classList.toggle('active', x.dataset.pane === id);
        x.setAttribute('aria-selected', x.dataset.pane === id ? 'true' : 'false');
      }
      for (const k in panes) panes[k].classList.toggle('active', k === id);
    }

    function matchesHighlight(card) {
      if (!highlight) return true;
      if (highlight.kind === 'type') return primaryType(card) === highlight.value;
      if (highlight.kind === 'manual') return !UI.autoInfo(card).auto;
      const a = MTG.oracle.analyze(card);
      if (!a || a.isLand) return false;            // the curve counts nonlands
      return Math.min(8, Math.floor(card.cmc || 0)) === Number(highlight.value);
    }

    /** How many cards (counting copies) the current highlight covers. */
    function matchedCount() {
      if (!highlight) return 0;
      let n = 0;
      for (const c of deck.commanders) if (matchesHighlight(c)) n++;
      for (const e of deck.main) if (matchesHighlight(e.card)) n += e.qty;
      return n;
    }

    function highlightLabel() {
      if (!highlight) return '';
      if (highlight.kind === 'type') return (TYPE_PLURAL[highlight.value] || highlight.value).toLowerCase();
      if (highlight.kind === 'manual') return 'cards that need a hand';
      return highlight.value === 8 ? 'cards at 8 mana or more' : `cards at ${highlight.value} mana`;
    }

    /** Mark a row or tile according to the current highlight. */
    function applyHighlight(node, card) {
      if (!highlight) return node;
      node.classList.add(matchesHighlight(card) ? 'hl' : 'hl-dim');
      return node;
    }

    /** Search restricted to cards that can actually hold the job. */
    function chooseCommander() {
      UI.cardSearch({
        format: deck.format,
        title: 'Choose a commander',
        onlyCommanders: true,
        once: true,
        onAdd: (card) => setCommander(card),
        inDeck: () => new Map(),
      });
    }

    /**
     * A new commander arrives with a mana base. Forty basics split as
     * evenly as its colour identity allows is where nearly every list
     * starts, and starting from nothing means typing out twenty Islands.
     */
    async function onCommanderChosen(card, wasEmpty) {
      const fmt = MTG.formats.get(deck.format);
      if (!fmt.commander || !wasEmpty) return;
      if (deck.main.some(e => MTG.formats.isBasicLand(e.card))) return;
      const busy = UI.busy('Fetching lands', 'Getting the basics\u2026');
      try {
        const n = await UI.fillBasicsFor(deck, card);
        UI.ok(`Added ${n} basic lands in ${card.name}\u2019s colours.`);
      } catch (e) {
        UI.toast('Could not fetch basic lands: ' + (e.message || e), 'err', 4000);
      } finally {
        busy.close();
        render();
      }
    }

    /**
     * An empty deck is the hardest screen in any deck builder: a blank list
     * and a search box. This is the way in — the four things people actually
     * do first, as buttons, in the order they usually do them.
     */
    function startHere() {
      const fmt = MTG.formats.get(deck.format);
      const row = (title, note, label, fn, primary) => el('div', { class: 'start-row' }, [
        el('div', { class: 'grow', style: { minWidth: 0 } }, [
          el('div', { class: 'start-title', text: title }),
          el('div', { class: 'tiny dim', text: note }),
        ]),
        el('button', { class: 'btn sm' + (primary ? ' primary' : ''), text: label, onclick: fn }),
      ]);
      const box = el('div', { class: 'start-here' }, [
        el('div', { class: 'section-title', style: { margin: '0 0 6px' }, text: 'Start here' }),
      ]);
      if (fmt.commander) {
        box.appendChild(row('Pick a commander',
          'Everything else follows from it — colours, and 40 basics to start you off.',
          'Choose…', chooseCommander, true));
      }
      box.appendChild(row('Add cards by hand',
        'Search by name, or by what you want: t:creature c:g mv<=3.', 'Search…', addCard, !fmt.commander));
      box.appendChild(row('Lay down a mana base',
        'Basic lands in the colours you are playing, as many as the format wants.', 'Lands…', landsTool));
      box.appendChild(row('Paste a list you already have',
        'Moxfield, Archidekt, MTGGoldfish, Arena — any of them.', 'Import…', () => {
          UI.importDeck(deck.format, (imported) => {
            if (!imported) return;
            deck.main = imported.main.slice();
            deck.commanders = (imported.commanders || []).slice();
            deck.sideboard = (imported.sideboard || []).slice();
            render();
          });
        }));
      box.appendChild(row('Let the table suggest cards',
        'It reads what is in the list and fills the gaps — it needs a few cards first.',
        'Suggestions', () => { showPane('advisor'); advisor.refresh(validation); }));
      return box;
    }

    /**
     * Basic lands, the part of deck building nobody enjoys doing one card at
     * a time. It counts the coloured pips already in the list, suggests a
     * split in those proportions, and will lay the whole thing down at once.
     */
    async function landsTool() {
      const fmt = MTG.formats.get(deck.format);
      const busy = UI.busy('Basic lands');
      let basics = {};
      try { basics = await MTG.draft.getBasics(); } catch (e) {}
      busy.close();
      if (!Object.keys(basics).length) return UI.error('Could not fetch the basic lands from Scryfall.');

      const COLORS = ['W', 'U', 'B', 'R', 'G'];
      const nameFor = (c) => MTG.mana.BASIC_FOR[c];
      const countOf = (c) => U.sum(deck.main.filter(e => e.card.name === nameFor(c)).map(e => e.qty));
      // how much of each colour the deck is actually asking for
      const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const e of deck.main.concat((deck.commanders || []).map(c => ({ card: c, qty: 1 })))) {
        const a = MTG.oracle.analyze(e.card);
        if (a && a.isLand) continue;
        for (const sym of MTG.mana.parse(e.card.mana_cost || '')) {
          for (const c of COLORS) if (sym.includes(c)) pips[c] += e.qty;
        }
      }
      const idColors = (validation.colorIdentity || []).filter(c => COLORS.includes(c));
      const play = idColors.length ? idColors : COLORS.filter(c => pips[c] > 0);
      const nonLand = U.sum(deck.main.filter(e => !(MTG.oracle.analyze(e.card) || {}).isLand).map(e => e.qty));
      const target = fmt.commander ? 36
        : fmt.kind === 'limited' ? MTG.formats.suggestedLands(fmt.deckMin || 40, 3)
          : Math.max(0, Math.round((fmt.deckMin || 60) * 0.4));

      const fields = {};
      const body = el('div');
      body.appendChild(el('p', { class: 'small muted', style: { marginTop: 0 },
        text: play.length
          ? `This deck asks for ${play.map(c => `${pips[c] || 0} ${MTG.mana.COLOR_NAMES[c].toLowerCase()}`).join(', ')} pips. `
            + `A ${fmt.name} deck usually plays about ${target} lands; it has ${U.sum(deck.main.filter(e => (MTG.oracle.analyze(e.card) || {}).isLand).map(e => e.qty))} now.`
          : 'Add a few cards first and this will suggest a split in the colours they need.' }));
      const grid = el('div', { class: 'lands-grid' });
      for (const c of COLORS) {
        const input = el('input', { type: 'number', min: '0', max: '99', value: String(countOf(c)) });
        fields[c] = input;
        grid.appendChild(el('label', { class: 'land-field' + (play.includes(c) ? ' on' : '') }, [
          el('span', { class: 'pip pip-' + c.toLowerCase(), text: c }),
          el('span', { class: 'tiny dim', text: nameFor(c) }),
          input,
        ]));
      }
      body.appendChild(grid);

      const suggest = () => {
        const totalPips = play.reduce((a, c) => a + (pips[c] || 0), 0);
        const want = Math.max(0, target - U.sum(deck.main
          .filter(e => { const a = MTG.oracle.analyze(e.card); return a && a.isLand && !a.isBasicLand; })
          .map(e => e.qty)));
        const out = {};
        let given = 0;
        play.forEach((c, i) => {
          const share = totalPips ? (pips[c] || 0) / totalPips : 1 / play.length;
          out[c] = Math.floor(want * share);
          given += out[c];
        });
        // the rounding goes to the colour the deck wants most
        const order = play.slice().sort((a, b) => (pips[b] || 0) - (pips[a] || 0));
        let i = 0;
        while (given < want && order.length) { out[order[i % order.length]]++; given++; i++; }
        for (const c of COLORS) fields[c].value = String(out[c] || 0);
      };

      const m = UI.modal({
        title: 'Basic lands', width: '560px', content: body,
        buttons: [
          { label: 'Suggest a split', onClick: () => { suggest(); return false; } },
          { label: 'Apply', class: 'primary', onClick: () => {
            let changed = 0;
            for (const c of COLORS) {
              const want = Math.max(0, parseInt(fields[c].value, 10) || 0);
              const name = nameFor(c);
              const card = basics[name];
              const at = deck.main.findIndex(e => e.card.name === name);
              if (!card && want > 0) continue;
              if (want === 0) { if (at >= 0) { deck.main.splice(at, 1); changed++; } continue; }
              if (at >= 0) { if (deck.main[at].qty !== want) { deck.main[at].qty = want; changed++; } }
              else { deck.main.push({ card, qty: want }); changed++; }
            }
            if (changed) { UI.ok('Mana base updated.'); MTG.sfx('land'); }
            render();
            m.close();
          } },
        ],
      });
      if (!countOf('W') && !countOf('U') && !countOf('B') && !countOf('R') && !countOf('G') && nonLand) suggest();
    }

    function addCard() {
      UI.cardSearch({
        format: deck.format,
        colors: (validation.colorIdentity || []),
        onAdd: (card, n) => addCardObj(card, n || 1),
        inDeck: () => {
          const m = new Map();
          for (const e of deck.main) m.set(e.card.id, e.qty);
          for (const c of deck.commanders) m.set(c.id, 1);
          return m;
        },
      });
    }

    /* These report whether they did anything, because the advisor's rows
       take themselves off the list once their action has been carried out
       and should stay put when it has not. */
    function addCardObj(card, qty) {
      if (!card) return false;
      const fmt = MTG.formats.get(deck.format);
      const e = deck.main.find(x => x.card.id === card.id);
      if (e && fmt.singleton) { UI.error(card.name + ' is already in this singleton deck.'); return false; }
      if (e) e.qty += (qty || 1);
      else deck.main.push({ card, qty: qty || 1 });
      UI.ok('Added ' + card.name + '.');
      MTG.sfx('click');
      render();
      return true;
    }

    async function addByName(name) {
      try {
        const c = await MTG.scry.byName(name);
        if (!c) return UI.error('No card called "' + name + '".');
        addCardObj(c, 1);
      } catch (err) { UI.error(err.message); }
    }

    function removeCardObj(card) {
      const i = deck.main.findIndex(x => x.card.id === card.id);
      if (i < 0) return false;
      deck.main[i].qty--;
      if (deck.main[i].qty <= 0) deck.main.splice(i, 1);
      render();
      return true;
    }

    function swapCards(addCard, cutCard) {
      const had = deck.main.some(x => x.card.id === cutCard.id);
      MTG.advisor.applySwap(deck, addCard, cutCard);
      UI.ok(had ? 'Swapped in ' + addCard.name + ' for ' + cutCard.name + '.'
                : 'Added ' + addCard.name + '.');
      MTG.sfx('click');
      render();
      return true;
    }

    /* the live advisor: archetype, balance, combos and suggestions */
    const advisor = UI.advisorPanel(paneAdvisor, () => deck, () => deck.format, {
      onAdd: (card) => addCardObj(card, 1),
      onAddByName: (name) => { addByName(name); },
      onRemove: (card) => removeCardObj(card),
      onSwap: (addCard, cutCard) => swapCards(addCard, cutCard),
    });

    function render() {
      validation = MTG.formats.validate(deck, deck.format);
      const stats = validation.stats;
      const fmtObj = MTG.formats.get(deck.format);

      const key = UI.keyCard(deck);
      if ((key && key.id) !== headArtFor) { headArtFor = key && key.id; UI.setArt(headArt, key); }

      /* ----- left: the list ----- */
      const listTop = left.scrollTop;
      left.innerHTML = '';
      const nameInput = el('input', { type: 'text', value: deck.name, class: 'deck-name-input', 'aria-label': 'Deck name' });
      nameInput.addEventListener('input', () => { deck.name = nameInput.value; });
      const fmtSel = el('select', { 'aria-label': 'Format' }, MTG.formats.list().map(f =>
        el('option', { value: f.id, text: f.name, selected: f.id === deck.format })));
      fmtSel.addEventListener('change', () => { deck.format = fmtSel.value; render(); });
      left.append(
        el('div', { class: 'deck-head' }, [
          nameInput,
          el('div', { class: 'deck-head-row' }, [fmtSel, sizePill(validation)]),
          sizeMeter(validation),
          autoLine(),
          el('div', { class: 'deck-head-row' }, [
            el('button', { class: 'btn sm primary grow', text: '+ Add cards', onclick: addCard }),
            el('button', { class: 'btn sm', text: 'Lands…', title: 'Basic lands and the mana base', onclick: landsTool }),
          ]),
        ]));

      if (!deck.main.length && !deck.commanders.length) left.appendChild(startHere());

      if (highlight) {
        left.appendChild(el('div', { class: 'hl-bar' }, [
          el('span', { class: 'grow', text: `Marking ${matchedCount()} ${highlightLabel()}` }),
          el('button', { class: 'btn xs', text: 'Clear', onclick: () => { highlight = null; render(); } }),
        ]));
      }

      if (fmtObj.commander) {
        left.appendChild(el('div', { class: 'section-title', text: 'Commander' }));
        if (!deck.commanders.length) {
          left.appendChild(el('button', {
            class: 'btn primary block add-commander',
            text: '★  Choose a commander',
            onclick: chooseCommander,
          }));
          left.appendChild(el('p', { class: 'tiny dim', style: { margin: '6px 0 0' },
            text: 'Choosing one fills the deck with 40 basic lands in its colours to start you off.' }));
        }
        for (const c of deck.commanders) {
          left.appendChild(entryRow({ card: c, qty: 1 }, true));
        }
      }

      const groups = U.groupBy(deck.main, e => primaryType(e.card));
      for (const g of TYPE_ORDER) {
        const list = groups.get(g);
        if (!list || !list.length) continue;
        const n = U.sum(list.map(e => e.qty));
        const on = highlight && highlight.kind === 'type' && highlight.value === g;
        left.appendChild(el('button', {
          type: 'button',
          class: 'section-title as-button' + (on ? ' on' : ''),
          text: `${TYPE_PLURAL[g] || g} · ${n}`,
          title: `Mark every ${g.toLowerCase()} in this deck`,
          onclick: () => setHighlight('type', g),
        }));
        for (const e of UI.sortCards(list, 'cmc')) left.appendChild(entryRow(e));
      }
      if (deck.sideboard && deck.sideboard.length) {
        left.appendChild(el('div', { class: 'section-title', text: `Sideboard · ${U.sum(deck.sideboard.map(e => e.qty))}` }));
        for (const e of UI.sortCards(deck.sideboard, 'cmc')) left.appendChild(entryRow(e));
      }
      left.scrollTop = listTop;

      /* ----- right: validation + stats ----- */
      paneOverview.innerHTML = '';
      paneCards.innerHTML = '';
      const money = U.deckPrice(deck);
      const problems = validation.errors.length;
      const vBox = el('section', { class: 'panel legal-box ' + (validation.ok ? 'is-legal' : 'not-legal') });
      vBox.appendChild(el('div', { class: 'legal-head' }, [
        el('span', { class: 'legal-mark', 'aria-hidden': 'true', text: validation.ok ? '✓' : '!' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'legal-title', text: validation.ok
            ? `Legal in ${fmtObj.name}`
            : `${problems} problem${problems === 1 ? '' : 's'} for ${fmtObj.name}` }),
          el('div', { class: 'tiny dim', text: validation.ok
            ? 'Ready to take to a table.'
            : 'The table will refuse it until these are fixed.' }),
        ]),
        el('button', {
          type: 'button', class: 'pill price-pill',
          title: money.unpriced
            ? `${money.unpriced} card${money.unpriced === 1 ? ' has' : 's have'} no price on Scryfall and are not counted. Click to show a price on every line.`
            : 'What this deck costs, from Scryfall. Click to show a price on every line.',
          onclick: () => { MTG.setSetting('showCardPrices', !MTG.settings.showCardPrices); render(); },
        }, [
          el('b', { text: U.money(money.total) }),
          money.unpriced ? el('i', { text: `+${money.unpriced} unpriced` }) : null,
        ].filter(Boolean)),
      ]));
      if (validation.errors.length)
        vBox.appendChild(el('ul', { class: 'error-list' }, validation.errors.slice(0, 20).map(x => el('li', { text: x }))));
      if (validation.warnings.length)
        vBox.appendChild(el('ul', { class: 'error-list muted' }, validation.warnings.map(x => el('li', { text: x }))));
      if (opts.missing && opts.missing.length)
        vBox.appendChild(el('div', { class: 'small', style: { color: 'var(--bad)', marginTop: '6px' } },
          'Not found: ' + opts.missing.map(x => `${x.qty}× ${x.name}`).join(', ')));
      paneOverview.appendChild(vBox);

      const sBox = el('section', { class: 'panel stats-box' });
      sBox.appendChild(el('h3', null, [
        el('span', { text: "What's in it" }),
        highlight ? el('button', {
          class: 'btn xs hl-clear', text: 'Clear marks',
          onclick: () => { highlight = null; render(); },
        }) : null,
      ].filter(Boolean)));
      const statsGrid = el('div', { class: 'stats-grid' });

      // the mana curve: every column is a button that marks its cards
      const maxCurve = Math.max(1, ...Object.values(stats.curve));
      statsGrid.appendChild(el('div', { class: 'stat-cell curve-cell' }, [
        el('div', { class: 'break-head', text: 'Mana curve' }),
        el('div', { class: 'curve-bar' },
          Object.keys(stats.curve).map(k => {
            const on = highlight && highlight.kind === 'mv' && String(highlight.value) === String(k);
            // the button is the whole column so a one-card bar is still
            // something a thumb can hit; only the fill inside it is short
            return el('button', {
              type: 'button',
              class: 'curve-col' + (on ? ' on' : '') + (stats.curve[k] ? '' : ' empty'),
              title: stats.curve[k]
                ? `Mark the ${stats.curve[k]} card${stats.curve[k] === 1 ? '' : 's'} at ${k === '8' ? '8 mana or more' : k + ' mana'}`
                : 'Nothing here',
              'aria-label': `${stats.curve[k] || 0} at ${k === '8' ? '8 or more' : k} mana`,
              disabled: !stats.curve[k],
              onclick: () => setHighlight('mv', k),
            }, [
              el('b', { text: stats.curve[k] || '', style: { bottom: (stats.curve[k] / maxCurve * 100) + '%' } }),
              el('i', { class: 'curve-fill', style: { height: (stats.curve[k] / maxCurve * 100) + '%' } }),
              el('span', { text: k === '8' ? '8+' : k }),
            ]);
          })),
        el('div', { class: 'curve-foot' }, [
          el('span', null, [el('b', { text: String(stats.avgMv) }), ' average mana value']),
          el('span', null, [el('b', { text: String(stats.nonland) }), ' spells']),
        ]),
      ]));

      // the colours the spells ask for, as a ring
      const pipCounts = colourPips(deck);
      const pipTotal = U.sum(Object.values(pipCounts));
      statsGrid.appendChild(el('div', { class: 'stat-cell pie-cell' }, [
        el('div', { class: 'break-head', text: 'Colours' }),
        el('div', { class: 'pie-wrap' }, [
          UI.colorPie(pipCounts, { size: 118, center: pipTotal ? pipTotal : '–', label: 'Coloured mana symbols in the deck' }),
          el('div', { class: 'pie-legend' }, ['W', 'U', 'B', 'R', 'G'].filter(c => pipCounts[c]).map(c =>
            el('div', { class: 'pie-row' }, [
              el('i', { class: 'pip pip-' + c.toLowerCase(), text: c }),
              el('span', { text: MTG.mana.COLOR_NAMES[c] }),
              el('b', { text: Math.round(pipCounts[c] / pipTotal * 100) + '%' }),
            ])).concat(pipTotal ? [] : [el('span', { class: 'tiny dim', text: 'No coloured symbols yet.' })])),
        ]),
      ]));

      // the breakdown by card type — every row is a button that marks its cards
      const byType = new Map();
      for (const c of deck.commanders) byType.set(primaryType(c), (byType.get(primaryType(c)) || 0) + 1);
      for (const e of deck.main) {
        const t = primaryType(e.card);
        byType.set(t, (byType.get(t) || 0) + e.qty);
      }
      const totalCards = U.sum(Array.from(byType.values()));
      const typeList = el('div', { class: 'break-list' });
      for (const t of TYPE_ORDER) {
        const n = byType.get(t) || 0;
        if (!n) continue;
        const on = highlight && highlight.kind === 'type' && highlight.value === t;
        typeList.appendChild(el('button', {
          type: 'button',
          class: 'break-row' + (on ? ' on' : ''),
          title: `Mark every ${t.toLowerCase()} in this deck`,
          onclick: () => setHighlight('type', t),
        }, [
          el('span', { class: 'break-name', text: TYPE_PLURAL[t] || t }),
          el('span', { class: 'break-track' }, el('i', { style: { width: (totalCards ? n / totalCards * 100 : 0) + '%' } })),
          el('span', { class: 'break-n', text: String(n) }),
        ]));
      }
      if (!typeList.childNodes.length) typeList.appendChild(el('span', { class: 'tiny dim', text: 'Nothing in the deck yet.' }));
      statsGrid.appendChild(el('div', { class: 'stat-cell type-cell' }, [el('div', { class: 'break-head', text: 'Card types' }), typeList]));
      sBox.appendChild(statsGrid);

      // how much of it the game runs, and which cards are the exceptions
      const auto = UI.deckAutomation(deck);
      const autoBox = el('div', { class: 'auto-row' + (auto.manual.length ? ' has-manual' : '') }, [
        el('div', { class: 'auto-row-head' }, [
          auto.total ? UI.autoShare(auto.auto, auto.total) : null,
          el('span', { class: 'small muted grow', text: !auto.total ? 'Nothing in the deck yet.'
            : auto.manual.length
              ? 'The game runs these by itself. The cards below have text you carry out with the table tools.'
              : 'Every card runs itself: nothing in this deck needs a hand.' }),
          auto.manual.length ? el('button', {
            type: 'button', class: 'btn xs' + (highlight && highlight.kind === 'manual' ? ' primary' : ''),
            text: 'Mark them', title: 'Mark the cards that need a hand in the list',
            onclick: () => setHighlight('manual', true),
          }) : null,
        ].filter(Boolean)),
        el('div', { class: 'progress', style: { marginTop: '8px' } },
          el('div', { style: { width: (auto.total ? auto.auto / auto.total * 100 : 0) + '%' } })),
      ]);
      if (auto.manual.length) {
        autoBox.appendChild(el('div', { class: 'auto-manual-list' }, auto.manual.map(mm => {
          const row = el('div', { class: 'auto-manual' }, [
            UI.autoBadge(mm.card),
            el('span', { class: 'nm', text: `${mm.qty}× ${mm.card.name}` }),
            el('span', { class: 'tiny dim why', text: mm.lines[0] || '' }),
          ]);
          UI.attachPreview(row, mm.card, 0);
          return row;
        })));
      }
      sBox.appendChild(autoBox);
      paneOverview.appendChild(sBox);

      const gBox = el('section', { class: 'panel' });
      gBox.appendChild(el('h3', null, [el('span', { text: 'Cards' }), el('span', { class: 'tiny dim', text: 'Click a card to choose its art.' })]));
      const grid = el('div', { class: 'card-grid' });
      const seen = new Set();
      for (const c of deck.commanders) { grid.appendChild(cardTile(c, true)); seen.add(c.id); }
      for (const e of UI.sortCards(deck.main, 'cmc')) {
        if (seen.has(e.card.id)) continue;
        seen.add(e.card.id);
        grid.appendChild(cardTile(e.card, false, e.qty));
      }
      gBox.appendChild(grid);
      paneCards.appendChild(gBox);

      // the advisor re-profiles locally on every edit; its network pass is
      // debounced inside the panel so editing does not hammer Scryfall
      if (activePane === 'advisor') advisor.refresh(validation);
      else advisor.refreshLocalOnly(validation);
    }

    /** The deck's automation share under its size: a tap marks the cards that need a hand. */
    function autoLine() {
      const auto = UI.deckAutomation(deck);
      if (!auto.total) return null;
      const pill = UI.autoShare(auto.auto, auto.total);
      if (!auto.manual.length) return el('div', { class: 'deck-head-row auto-head' }, pill);
      return el('div', { class: 'deck-head-row auto-head' }, el('button', {
        type: 'button', class: 'auto-head-btn', title: 'Mark the cards that need a hand',
        onclick: () => setHighlight('manual', true),
      }, pill));
    }

    /** How far the deck is towards a legal size, as a bar that fills. */
    function sizeMeter(v) {
      const target = (v.max != null && v.size > v.max) ? v.max : v.min;
      const pct = target ? Math.min(1, v.size / target) : 1;
      const over = v.max != null ? v.size > v.max : (v.exact && v.size > v.min);
      const ok = v.exact ? v.size === v.min : (v.size >= v.min && !over);
      return el('div', { class: 'size-meter' + (ok ? ' ok' : over ? ' over' : ''), role: 'img',
        'aria-label': `${v.size} of ${target} cards` }, el('i', { style: { width: (pct * 100) + '%' } }));
    }

    /** Coloured mana symbols the deck asks for, counting copies. */
    function colourPips(d) {
      const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      const all = d.main.concat((d.commanders || []).map(c => ({ card: c, qty: 1 })));
      for (const e of all) {
        const a = MTG.oracle.analyze(e.card);
        if (a && a.isLand) continue;
        for (const sym of MTG.mana.parse(e.card.mana_cost || '')) {
          for (const c of Object.keys(out)) if (sym.includes(c)) out[c] += e.qty;
        }
      }
      return out;
    }

    function sizePill(v) {
      const label = v.exact
        ? v.size + ' / ' + v.min
        : (v.max != null ? v.size + ' / ' + v.min + '\u2013' + v.max : v.size + ' (min ' + v.min + ')');
      const bad = v.exact ? v.size !== v.min : (v.size < v.min || (v.max != null && v.size > v.max));
      return el('span', {
        class: 'pill ' + (bad ? 'bad' : 'good'),
        text: label + ' cards',
        title: bad ? 'This deck is not a legal size.' : 'Deck size is legal.',
      });
    }

    function cardTile(card, isCmd, qty) {
      const slot = applyHighlight(UI.cardSlot(card, { isCommander: isCmd }, { size: 'normal' }), card);
      if (qty > 1) slot.appendChild(el('div', { class: 'badge-row' }, el('span', { class: 'badge', text: '×' + qty })));
      slot.appendChild(UI.autoBadge(card, { corner: true }));
      slot.style.cursor = 'pointer';
      slot.addEventListener('click', async () => {
        const picked = await UI.pickArt(card);
        if (picked) { UI.swapArtEverywhere(deck, card, picked); render(); }
      });
      return slot;
    }

    /**
     * One line of the decklist. Tuning a list is mostly adding and removing
     * single copies, so those are the two clicks: the number adds one, the
     * rest of the row takes one away. Everything else is on the menu.
     */
    function entryRow(e, isCmd) {
      const a = MTG.oracle.analyze(e.card);
      const qty = el('button', {
        type: 'button', class: 'qty' + (isCmd ? '' : ' bump'),
        text: isCmd ? '\u2605' : e.qty + '\u00d7',
        title: isCmd ? 'Your commander' : `Add another ${e.card.name}`,
        'aria-label': isCmd ? 'Your commander' : `Add another ${e.card.name}`,
      });
      // each line is a strip of the card's own art, the way a deck list
      // reads in a card game: you find a card by its picture as much as its name
      const row = applyHighlight(el('div', {
        class: 'deck-entry strip' + (isCmd ? ' is-cmd' : ''),
        title: isCmd ? e.card.name : `${e.card.name} \u2014 click to take one out, click the number to add one`,
      }, [
        qty,
        el('span', { class: 'nm', text: e.card.name }),
        UI.autoBadge(e.card),
        el('span', { class: 'cost', html: MTG.mana.html(a ? a.manaCost : '') }),
        MTG.settings.showCardPrices
          ? el('span', { class: 'tiny price', text: U.money(U.priceOf(e.card)) })
          : null,
      ].filter(Boolean)), e.card);
      UI.setArt(row, e.card);
      UI.attachPreview(row, e.card, 0);
      if (!isCmd) {
        qty.addEventListener('click', (ev) => { ev.stopPropagation(); changeQty(e, 1); MTG.sfx('click'); });
        row.addEventListener('click', () => { changeQty(e, -1); MTG.sfx('click'); });
      }
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const menu = [];
        if (!isCmd) {
          menu.push(['+1', () => changeQty(e, 1)]);
          menu.push(['-1', () => changeQty(e, -1)]);
          if (MTG.formats.canBeCommander(e.card, MTG.formats.get(deck.format)) && MTG.formats.get(deck.format).commander)
            menu.push(['Make commander', () => setCommander(e.card)]);
          menu.push(['Move to sideboard', () => {
            const i = deck.main.indexOf(e);
            if (i >= 0) { deck.main.splice(i, 1); deck.sideboard.push(e); render(); }
          }]);
        } else {
          menu.push(['Remove as commander', () => { deck.commanders = deck.commanders.filter(c => c.id !== e.card.id); deck.main.push({ card: e.card, qty: 1 }); render(); }]);
        }
        menu.push(['Choose art…', async () => { const p = await UI.pickArt(e.card); if (p) { UI.swapArtEverywhere(deck, e.card, p); render(); } }]);
        menu.push(['Use as the deck’s picture', () => { deck.cover = e.card.oracle_id || e.card.id; render(); UI.ok(e.card.name + ' fronts the deck now.'); }]);
        UI.contextMenu(ev, menu);
      });
      return row;
    }

    render();
    return m;
  };

  const BASIC_FOR = MTG.mana.BASIC_FOR;

  /**
   * Fill a deck with `count` basic lands split as evenly as the commander's
   * colour identity allows: mono-blue is forty Islands, Simic is twenty and
   * twenty, and a colourless commander gets Wastes. Returns how many it added.
   */
  UI.fillBasicsFor = async function (deck, commander, count) {
    const total = count || 40;
    const ci = (commander.color_identity || []).filter(c => BASIC_FOR[c]);
    const want = ci.length ? ci : ['C'];
    const per = Math.floor(total / want.length);
    let spare = total - per * want.length;         // hand the remainder out one at a time
    let added = 0;
    for (const c of want) {
      const basic = await MTG.scry.byName(BASIC_FOR[c] || 'Wastes');
      if (!basic) continue;
      const qty = per + (spare-- > 0 ? 1 : 0);
      const have = deck.main.find(e => e.card.id === basic.id);
      if (have) have.qty += qty; else deck.main.push({ card: basic, qty });
      added += qty;
    }
    return added;
  };

  /* One card, one bucket: an Artifact Creature is a creature, so the
     breakdown adds up to the deck size instead of double-counting. */
  const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery',
    'Artifact', 'Enchantment', 'Battle', 'Land', 'Other'];
  const TYPE_PLURAL = {
    Creature: 'Creatures', Planeswalker: 'Planeswalkers', Instant: 'Instants',
    Sorcery: 'Sorceries', Artifact: 'Artifacts', Enchantment: 'Enchantments',
    Battle: 'Battles', Land: 'Lands', Other: 'Other',
  };

  function primaryType(card) {
    const a = MTG.oracle.analyze(card);
    if (!a) return 'Other';
    for (const t of ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Battle', 'Artifact', 'Enchantment', 'Land'])
      if (a.types.includes(t)) return t;
    return 'Other';
  }

  /* ---------------- context menu ---------------- */
  /* A menu of actions. On a desktop it appears at the pointer; on a phone it
     rises from the bottom of the screen as a sheet with thumb-sized rows,
     because a 170px popup pinned to a fingertip is not usable. */
  UI.contextMenu = function (ev, items, opts) {
    opts = opts || {};
    document.querySelectorAll('.ctx-menu, .ctx-scrim').forEach(n => n.remove());
    const phone = MTG.isPhone();
    const menu = el('div', { class: 'ctx-menu panel' + (phone ? ' as-sheet' : '') });
    if (!phone) {
      Object.assign(menu.style, {
        position: 'fixed', zIndex: 700, padding: '4px', minWidth: '170px',
        left: Math.min((ev && ev.clientX) || 20, innerWidth - 200) + 'px',
        top: Math.min((ev && ev.clientY) || 20, innerHeight - (items.length * 30 + 20)) + 'px',
        boxShadow: 'var(--shadow)',
      });
    } else if (opts.title) {
      menu.appendChild(el('div', { class: 'ctx-title', text: opts.title }));
    }
    let scrim = null;
    const dismiss = () => {
      menu.remove();
      if (scrim) scrim.remove();
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onEsc);
    };
    for (const it of items) {
      if (it === '-') { menu.appendChild(el('hr', { class: 'sep', style: { margin: '4px 0' } })); continue; }
      const [label, fn, disabled] = it;
      menu.appendChild(el('div', {
        class: 'ctx-item deck-entry' + (disabled ? ' dim' : ''),
        text: label,
        style: phone ? null : { padding: '5px 8px', cursor: disabled ? 'default' : 'pointer' },
        onclick: () => { if (!disabled) { dismiss(); MTG.sfx('click'); fn(); } },
      }));
    }
    if (phone) {
      menu.appendChild(el('div', { class: 'ctx-item ctx-cancel', text: 'Cancel', onclick: dismiss }));
      scrim = el('div', { class: 'ctx-scrim', onclick: dismiss });
      document.body.appendChild(scrim);
    }
    const onEsc = (e) => { if (e.key === 'Escape') dismiss(); };
    const close = (e) => { if (!menu.contains(e.target)) dismiss(); };
    document.body.appendChild(menu);
    document.addEventListener('keydown', onEsc);
    if (!phone) setTimeout(() => document.addEventListener('mousedown', close), 0);
    return menu;
  };

  /* ---------------- card search ----------------
     Building a deck used to mean knowing the exact name and typing it.
     This is a browser: type a few letters for name matches, or write a
     Scryfall query (t:creature c:r mv<=3) and page through the results. */
  UI.cardSearch = function (opts) {
    opts = opts || {};
    const fmt = MTG.formats.get(opts.format) || {};
    const input = el('input', {
      type: 'search', placeholder: 'A name, or a query like  t:creature c:r mv<=3',
      autocomplete: 'off', spellcheck: 'false',
    });
    const results = el('div', { class: 'search-grid' });
    const status = el('div', { class: 'small muted', text: 'Start typing to search.' });
    const suggestBox = el('div', { class: 'search-suggest' });
    const legalOnly = el('input', { type: 'checkbox', checked: true, id: 'cs-legal' });
    const inColor = el('input', { type: 'checkbox', checked: !!(opts.colors || []).length, id: 'cs-color' });
    // a filter on what came back rather than part of the query: automation is ours, not Scryfall's
    const autoOnly = el('input', { type: 'checkbox', checked: !!MTG.settings.searchAutoOnly, id: 'cs-auto' });

    /* Narrowing by what a card is and what it costs is most of searching,
       so those are chips you tap rather than syntax you have to remember.
       Each one is just a few more words on the query. */
    const TYPES = [['Creature', 't:creature'], ['Instant', 't:instant'], ['Sorcery', 't:sorcery'], ['Artifact', 't:artifact'],
      ['Enchantment', 't:enchantment'], ['Planeswalker', 't:planeswalker'], ['Land', 't:land']];
    const COSTS = [['0–1', 'mv<=1'], ['2', 'mv=2'], ['3', 'mv=3'], ['4', 'mv=4'], ['5', 'mv=5'], ['6+', 'mv>=6']];
    let typeOn = null, costOn = null;
    const chipRow = el('div', { class: 'search-chips' });
    const drawChips = () => {
      chipRow.innerHTML = '';
      const chip = (label, q, cur, set) => el('button', {
        type: 'button', class: 'chip' + (cur === q ? ' on' : ''), text: label, 'aria-pressed': cur === q ? 'true' : 'false',
        onclick: () => { set(cur === q ? null : q); drawChips(); run(); },
      });
      chipRow.append(...TYPES.map(([l, q]) => chip(l, q, typeOn, (v) => { typeOn = v; })),
        el('span', { class: 'chip-gap' }),
        el('span', { class: 'tiny dim', text: 'Mana value' }),
        ...COSTS.map(([l, q]) => chip(l, q, costOn, (v) => { costOn = v; })));
    };
    drawChips();

    const m = UI.modal({
      title: opts.title || 'Add a card', width: '1020px',
      content: el('div', { class: 'card-search' }, [
        el('div', { class: 'search-bar' }, [el('span', { class: 'search-ico', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' }), input]),
        suggestBox,
        opts.onlyCommanders ? null : chipRow,
        el('div', { class: 'row wrap search-filters' }, [
          el('label', { class: 'inline-check', for: 'cs-legal' }, [legalOnly, el('span', { text: `Legal in ${fmt.name || 'this format'}` })]),
          (opts.colors || []).length
            ? el('label', { class: 'inline-check', for: 'cs-color' }, [inColor, el('span', { html: 'Inside ' + (opts.colors || []).map(c => `<i class="pip pip-${c.toLowerCase()}">${c}</i>`).join('') })])
            : null,
          el('label', { class: 'inline-check', for: 'cs-auto', title: 'Hide cards with text the game cannot carry out by itself' },
            [autoOnly, el('span', { text: 'Only cards the game runs fully' })]),
          el('span', { class: 'grow' }),
          status,
        ].filter(Boolean)),
        results,
      ]),
      buttons: [{ label: 'Done', class: 'primary', onClick: () => m.close() }],
    });
    setTimeout(() => input.focus(), 50);
    if (opts.onlyCommanders) {
      status.textContent = 'Search for a legendary creature.';
      // a starting point, so the modal is not an empty box
      setTimeout(() => { input.value = input.value || 'is:commander'; run(); }, 0);
    }

    let token = 0;
    const run = U.debounce(async () => {
      const q = input.value.trim();
      suggestBox.innerHTML = '';
      const chips = [typeOn, costOn].filter(Boolean).join(' ');
      if (!q && !chips) { results.innerHTML = ''; status.textContent = 'Start typing, or pick a type or a cost.'; return; }
      const mine = ++token;
      status.textContent = 'Searching…';
      results.classList.add('loading');
      // a bare word is a name search; anything with a colon or comparison is a query
      const looksLikeQuery = /[:<>=]/.test(q);
      let query = !q ? chips
        : (looksLikeQuery ? q : `name:/${q.replace(/[/\\]/g, '')}/`) + (chips ? ' ' + chips : '');
      if (legalOnly.checked && fmt.scryKey) query += ` legal:${fmt.scryKey}`;
      if (inColor.checked && (opts.colors || []).length) query += ` id<=${opts.colors.join('')}`;
      if (opts.onlyCommanders && !/is:commander/.test(query)) query += ' is:commander';
      let cards = [];
      try { cards = await MTG.scry.search(query, { max: 60, unique: 'cards', order: 'edhrec' }); }
      catch (e) {
        if (q && !looksLikeQuery && !chips) {
          try { const c = await MTG.scry.byName(q); if (c) cards = [c]; } catch (e2) {}
        }
      }
      if (mine !== token) return;
      results.classList.remove('loading');
      draw(cards, q || chips);
    }, 260);
    legalOnly.addEventListener('change', () => run());
    inColor.addEventListener('change', () => run());
    let last = null;
    autoOnly.addEventListener('change', () => {
      MTG.setSetting('searchAutoOnly', autoOnly.checked);
      if (last) draw(last.cards, last.q); else run();
    });

    function draw(cards, q) {
      last = { cards, q };
      results.innerHTML = '';
      let hidden = 0;
      if (autoOnly.checked) {
        const keep = cards.filter(c => UI.autoInfo(c).auto);
        hidden = cards.length - keep.length;
        cards = keep;
      }
      const hiddenNote = hidden ? ` · ${hidden} hidden that need a hand` : '';
      if (!cards.length) {
        status.textContent = 'Nothing matched.' + hiddenNote;
        results.appendChild(el('div', { class: 'empty-note', text: hidden
          ? `Everything found for “${q}” needs a hand. Untick “Only cards the game runs fully” to see them.`
          : `No cards found for “${q}”. Try a Scryfall query, like t:instant c:u mv<=2.` }));
        return;
      }
      status.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'}${hiddenNote}`;
      const have = opts.inDeck ? opts.inDeck() : new Map();
      for (const c of cards) {
        const n = have.get(c.id) || 0;
        const tile = el('div', { class: 'search-card' + (n ? ' have' : '') });
        const slot = UI.cardSlot(c, {}, {
          onClick: () => {
            opts.onAdd(c, 1);
            MTG.sfx('click');
            if (opts.once) m.close(); else redrawCounts();
          },
        });
        slot.appendChild(UI.autoBadge(c, { corner: true }));
        tile.appendChild(slot);
        tile.appendChild(el('div', { class: 'search-name', text: c.name }));
        tile.appendChild(el('div', { class: 'search-count', dataset: { id: c.id }, text: n ? n + ' in deck' : '' }));
        results.appendChild(tile);
      }
    }
    function redrawCounts() {
      const have = opts.inDeck ? opts.inDeck() : new Map();
      results.querySelectorAll('.search-count').forEach((n) => {
        const q = have.get(n.dataset.id) || 0;
        n.textContent = q ? q + ' in deck' : '';
        n.closest('.search-card').classList.toggle('have', !!q);
      });
    }

    input.addEventListener('input', () => {
      run();
      // name completions while you type, if it is not a query
      const q = input.value.trim();
      if (q.length >= 2 && !/[:<>=]/.test(q)) {
        MTG.scry.autocomplete(q).then((names) => {
          if (input.value.trim() !== q) return;
          suggestBox.innerHTML = '';
          for (const nm of names.slice(0, 8)) {
            suggestBox.appendChild(el('button', {
              type: 'button', class: 'suggest-chip', text: nm,
              onclick: () => { input.value = nm; suggestBox.innerHTML = ''; run(); },
            }));
          }
        }).catch(() => {});
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    return m;
  };

  /* ---------------- sideboarding between games ----------------
     Cards move between the deck and the board, and the deck has to come back
     to a legal size before the next game starts. Bots swap nothing: they
     build one deck and play it. */
  UI.sideboardStep = function (session) {
    const seat = (session.roster || []).find(r => r.id === 'me');
    if (!seat || !seat.deck || !(seat.deck.sideboard || []).length) return Promise.resolve(true);
    const deck = seat.deck;
    return new Promise((resolve) => {
      const mainBox = el('div', { class: 'sb-col' });
      const sideBox = el('div', { class: 'sb-col' });
      const status = el('div', { class: 'sb-status' });
      let cancelled = false;

      const m = UI.modal({
        title: 'Sideboard', width: '900px', closable: false,
        content: el('div', null, [
          el('p', { class: 'small muted', style: { marginTop: 0 },
            text: 'Move cards between your deck and your sideboard for the next game. Click a card to move it across.' }),
          el('div', { class: 'sb-grid' }, [
            el('div', null, [el('div', { class: 'section-title', text: 'Deck' }), mainBox]),
            el('div', null, [el('div', { class: 'section-title', text: 'Sideboard' }), sideBox]),
          ]),
          status,
        ]),
        buttons: [
          { label: 'Reset', onClick: () => { restore(); render(); } },
          { label: 'Back to menu', onClick: () => { cancelled = true; m.close(); resolve(false); } },
          { label: 'Start the game', class: 'primary', onClick: () => {
            const v = MTG.formats.validate(deck, deck.format);
            if (!v.ok) return UI.error(v.errors[0]);
            m.close(); resolve(true);
          } },
        ],
      });

      // a copy to go back to if they change their mind
      const original = JSON.parse(JSON.stringify({
        main: deck.main.map(e => ({ id: e.card.id, q: e.qty })),
        side: (deck.sideboard || []).map(e => ({ id: e.card.id, q: e.qty })),
      }));
      const allCards = new Map();
      for (const e of deck.main.concat(deck.sideboard || [])) allCards.set(e.card.id, e.card);
      function restore() {
        deck.main = original.main.map(e => ({ card: allCards.get(e.id), qty: e.q })).filter(e => e.card);
        deck.sideboard = original.side.map(e => ({ card: allCards.get(e.id), qty: e.q })).filter(e => e.card);
      }

      function move(from, to, entry) {
        entry.qty--;
        if (entry.qty <= 0) from.splice(from.indexOf(entry), 1);
        const there = to.find(x => x.card.id === entry.card.id);
        if (there) there.qty++; else to.push({ card: entry.card, qty: 1 });
        MTG.sfx('click');
        render();
      }

      function render() {
        mainBox.innerHTML = ''; sideBox.innerHTML = '';
        const row = (e, from, to, arrow) => {
          const r = el('button', { type: 'button', class: 'sb-row', onclick: () => move(from, to, e) }, [
            el('span', { class: 'qty', text: e.qty + '\u00d7' }),
            el('span', { class: 'nm', text: e.card.name }),
            el('span', { class: 'tiny dim', html: MTG.mana.html(e.card.mana_cost || '') }),
            el('span', { class: 'sb-arrow', text: arrow }),
          ]);
          UI.attachPreview(r, e.card, 0);
          UI.longPress(r, () => UI.cardSheet(e.card));
          return r;
        };
        for (const e of UI.sortCards(deck.main, 'type')) mainBox.appendChild(row(e, deck.main, deck.sideboard, '\u2192'));
        for (const e of UI.sortCards(deck.sideboard, 'type')) sideBox.appendChild(row(e, deck.sideboard, deck.main, '\u2190'));
        const v = MTG.formats.validate(deck, deck.format);
        status.innerHTML = '';
        status.appendChild(el('span', {
          class: 'pill ' + (v.ok ? 'good' : 'bad'),
          text: v.ok ? `Legal \u2014 ${v.size} cards` : v.errors[0],
        }));
        status.appendChild(el('span', { class: 'tiny dim', text: `${U.sum(deck.sideboard.map(e => e.qty))} in the sideboard` }));
      }
      render();
      m._onClose = () => { if (!cancelled) resolve(true); };
    });
  };

  /* ---------------- starter decks ----------------
     Ready-made decks (src/20-starters.js), shown the way your own decks
     are: a box with the cover's art, the colours, and what the deck does
     in a sentence. */

  /** The cover cards of the starters, in one request, by name. */
  let starterCovers = null;
  function starterCover(s) {
    if (!starterCovers) {
      const names = MTG.starters.list.map(x => x.cover);
      starterCovers = UI.featuredCards(names).then((cards) => {
        const m = new Map();
        names.forEach((n, i) => { if (cards[i]) m.set(n, cards[i]); });
        return m;
      });
    }
    return starterCovers.then(m => m.get(s.cover) || null);
  }
  UI.starterCover = starterCover;

  /**
   * One starter as a deck box. `opts.onUse(deck)` adds a Play button;
   * `opts.onCopied()` is told when it has gone into your decks.
   */
  UI.starterBox = function (s, opts) {
    opts = opts || {};
    const art = el('div', { class: 'deck-art', 'aria-hidden': 'true' });
    starterCover(s).then((c) => { if (c) UI.setArt(art, c); }).catch(() => {});
    const auto = el('span', { class: 'auto-slot' });
    // the starters are checked to be wholly automated; the pill says so once the cards are in
    MTG.starters.build(s.id).then((d) => {
      const a = UI.deckAutomation(d);
      auto.appendChild(UI.autoShare(a.auto, a.total, { class: 'on-art' }));
    }).catch(() => {});
    const copy = async () => {
      try {
        const d = await MTG.starters.copy(s.id);
        MTG.decks.save(d);
        UI.ok(`“${d.name}” is in your decks now. Change it as much as you like.`);
        if (opts.onCopied) opts.onCopied(d);
      } catch (e) { UI.error(e.message || String(e)); }
    };
    const use = async () => {
      try { const d = await MTG.starters.build(s.id); if (opts.onUse) opts.onUse(d); }
      catch (e) { UI.error(e.message || String(e)); }
    };
    return el('article', { class: 'deck-card starter-card', dataset: { starter: s.id } }, [
      el('button', { class: 'deck-open', 'aria-label': 'Look at ' + s.name, onclick: () => UI.starterPreview(s.id, opts) }, [
        art,
        el('div', { class: 'deck-face' }, [
          UI.pips(s.colors, 'deck-pips'),
          el('div', { class: 'deck-card-name', text: s.name }),
          el('div', { class: 'deck-sub starter-blurb', text: s.blurb }),
          auto,
        ]),
      ]),
      el('div', { class: 'deck-foot' }, [
        el('span', { class: 'pill', text: 'Starter' }),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn xs ghost', text: 'Copy to my decks', title: 'Put a copy in your decks, to play or change', onclick: copy }),
        opts.onUse ? el('button', { class: 'btn xs primary', text: opts.useLabel || 'Play', onclick: use }) : null,
      ].filter(Boolean)),
    ]);
  };

  /** A starter's list, by card type, with the same ways out as its box. */
  UI.starterPreview = async function (id, opts) {
    opts = opts || {};
    const s = MTG.starters.get(id);
    if (!s) return;
    const busy = UI.busy('Starter deck', 'Finding the cards…');
    let deck;
    try { deck = await MTG.starters.build(id); }
    catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    const list = el('div', { class: 'starter-list' });
    const groups = U.groupBy(deck.main, e => primaryType(e.card));
    for (const g of TYPE_ORDER) {
      const rows = groups.get(g);
      if (!rows || !rows.length) continue;
      const col = el('div', { class: 'starter-group' }, [
        el('div', { class: 'section-title', text: `${TYPE_PLURAL[g] || g} · ${U.sum(rows.map(e => e.qty))}` }),
      ]);
      for (const e of UI.sortCards(rows, 'cmc')) {
        const a = MTG.oracle.analyze(e.card);
        const row = el('div', { class: 'deck-entry strip' }, [
          el('span', { class: 'qty', text: e.qty + '×' }),
          el('span', { class: 'nm', text: e.card.name }),
          UI.autoBadge(e.card),
          el('span', { class: 'cost', html: MTG.mana.html(a ? a.manaCost : '') }),
        ]);
        UI.setArt(row, e.card);
        UI.attachPreview(row, e.card, 0);
        UI.longPress(row, () => UI.cardSheet(e.card));
        col.appendChild(row);
      }
      list.appendChild(col);
    }
    const cover = deck.main.map(e => e.card).find(c => c.name === s.cover) || UI.keyCard(deck);
    const auto = UI.deckAutomation(deck);
    const buttons = [{ label: 'Copy to my decks', onClick: async () => {
      const d = await MTG.starters.copy(id);
      MTG.decks.save(d);
      UI.ok(`“${d.name}” is in your decks now.`);
      m.close();
      if (opts.onCopied) opts.onCopied(d);
    } }];
    if (opts.onUse) buttons.push({ label: opts.useLabel || 'Play', class: 'primary', onClick: () => { m.close(); opts.onUse(deck); } });
    else buttons.push({ label: 'Close', class: 'primary', onClick: () => m.close() });
    const m = UI.modal({
      title: s.name, width: '880px', art: cover, className: 'starter-modal',
      content: el('div', null, [
        el('div', { class: 'row wrap starter-head' }, [
          UI.pips(s.colors),
          el('span', { class: 'pill', text: (MTG.formats.get(s.format) || {}).name || s.format }),
          UI.autoShare(auto.auto, auto.total),
          el('span', { class: 'small muted grow', text: s.blurb }),
        ]),
        list,
      ]),
      buttons,
    });
    return m;
  };

  /* ---------------- deck picker ---------------- */
  UI.pickDeck = function (formatId, onPick) {
    const list = el('div', { class: 'pick-deck-list' });
    const m = UI.modal({
      title: 'Choose a deck — ' + MTG.formats.get(formatId).name,
      width: '680px',
      content: list,
      buttons: [
        { label: 'Import a list…', onClick: () => { UI.importDeck(formatId, () => render()); } },
        { label: 'Close', onClick: () => m.close() },
      ],
    });
    function render() {
      list.innerHTML = '';
      const found = MTG.decks.forFormat(formatId);
      const starters = MTG.starters ? MTG.starters.forFormat(formatId) : [];
      let details = null;
      if (!found.length) {
        list.appendChild(el('div', { class: 'empty-note', text: starters.length
          ? 'No saved decks for this format yet. Pick a starter deck below, or import a list.'
          : 'No saved decks for this format yet. Import a decklist to get started.' }));
      }
      // ready-made decks, every card run by the game, after your own
      if (starters.length) {
        const box = el('div', { class: 'pick-starters' }, starters.map(s => {
          const art = el('div', { class: 'pick-deck-art', 'aria-hidden': 'true' });
          UI.starterCover(s).then((c) => { if (c) UI.setArt(art, c); }).catch(() => {});
          const use = async () => {
            const busy = UI.busy('Loading deck', 'Finding the cards…');
            try { const d = await MTG.starters.build(s.id); busy.close(); m.close(); onPick(d); }
            catch (e) { busy.close(); UI.error(e.message || String(e)); }
          };
          return el('div', { class: 'pick-deck starter' }, [
            art,
            el('button', { type: 'button', class: 'pick-deck-main', onclick: use, 'aria-label': 'Use ' + s.name }, [
              UI.pips(s.colors),
              el('div', { class: 'grow' }, [
                el('div', { class: 'pick-deck-name', text: s.name }),
                el('div', { class: 'tiny dim', text: s.blurb }),
              ]),
            ]),
            el('button', { class: 'btn xs ghost', text: 'Look', onclick: () => UI.starterPreview(s.id, { onUse: (d) => { m.close(); onPick(d); }, useLabel: 'Use this deck', onCopied: () => render() }) }),
            el('button', { class: 'btn sm primary', text: 'Use', onclick: use }),
          ]);
        }));
        details = el('details', { class: 'pick-starter-group', open: !found.length }, [
          el('summary', { class: 'section-title', text: `Starter decks · ${starters.length}` }),
          el('p', { class: 'tiny dim', style: { margin: '0 0 8px' }, text: 'Ready to play, and every card in them is run by the game.' }),
          box,
        ]);
      }
      for (const d of found) {
        const use = async () => {
          const busy = UI.busy('Loading deck');
          const full = await MTG.decks.load(d.id);
          busy.close();
          if (!full) return UI.error('That deck could not be loaded.');
          // cards that need a hand are said before the game, not found during it
          const go = await UI.checkAutomation(full, {
            onEdit: (dk) => UI.deckBuilder(dk, { onSave: () => render() }),
          });
          if (!go) return;
          m.close();
          onPick(full);
        };
        // a deck to choose is shown the way the deck list shows it: its art first
        const art = el('div', { class: 'pick-deck-art', 'aria-hidden': 'true' });
        if (d.art) UI.setArt(art, d.art);
        else MTG.decks.ensureArt(d.id).then((url) => { if (url) UI.setArt(art, url); }).catch(() => {});
        const row = el('div', { class: 'pick-deck' }, [
          art,
          el('button', { type: 'button', class: 'pick-deck-main', onclick: use, 'aria-label': 'Use ' + d.name }, [
            UI.pips(d.identity),
            el('div', { class: 'grow' }, [
              el('div', { class: 'pick-deck-name', text: d.name }),
              el('div', { class: 'tiny dim', text: `${d.size} cards · ${MTG.formats.get(d.format) ? MTG.formats.get(d.format).name : d.format}${d.commander ? ' · ' + d.commander : ''}` }),
            ]),
            UI.deckAutoPill(d),
          ]),
          el('button', { class: 'btn xs ghost', text: 'Edit', onclick: async () => {
            const full = await MTG.decks.load(d.id);
            if (full) UI.deckBuilder(full, { onSave: () => render() });
          } }),
          el('button', { class: 'btn xs ghost danger-ghost', text: 'Delete', onclick: async () => {
            if (await UI.confirm(`Delete "${d.name}"?`, 'Delete deck')) { MTG.decks.remove(d.id); render(); }
          } }),
          el('button', { class: 'btn sm primary', text: 'Use', onclick: use }),
        ]);
        list.appendChild(row);
      }
      // the starters come after your own decks
      if (details) list.appendChild(details);
    }
    render();
    return m;
  };
})(window.MTG);


