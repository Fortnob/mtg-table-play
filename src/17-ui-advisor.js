/* ============================================================
   17-ui-advisor.js - the UI for recommendations and combo detection
   Three surfaces: a live panel in the deck builder, a report shown after
   an import, and a pick advisor in the draft.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, util: U } = MTG;
  const UI = MTG.ui;

  const KIND_PILL = { infinite: 'warn', win: 'bad', lock: 'warn', synergy: '' };

  /* ============================================================
     Shared bits
     ============================================================ */

  function gapBar(gaps) {
    const wrap = el('div');
    for (const g of gaps) {
      if (g.want == null) continue;
      const pct = U.clamp(g.have / Math.max(1, g.want), 0, 1.35);
      const cls = g.severity === 'high' ? 'bad' : g.severity === 'low' ? 'warn' : g.severity === 'over' ? 'over' : 'ok';
      wrap.appendChild(el('div', { class: 'gap-row' }, [
        el('span', { class: 'gap-name', text: g.name }),
        el('span', { class: 'gap-track' }, el('span', { class: 'gap-fill ' + cls, style: { width: Math.min(100, pct * 100) + '%' } })),
        el('span', { class: 'gap-num ' + cls, text: `${g.have}/${g.want}` }),
        el('span', { class: 'gap-hint tiny dim', text: g.diff > 0 ? `add ${g.diff}` : (g.severity === 'over' ? 'more than needed' : 'good') }),
      ]));
    }
    return wrap;
  }

  function themeChips(prof) {
    const row = el('div', { class: 'row wrap', style: { gap: '6px' } });
    if (prof.tribe) row.appendChild(el('span', { class: 'pill good', text: `${prof.tribe} tribal (${prof.tribeCount})` }));
    for (const t of prof.themes.slice(0, 6))
      row.appendChild(el('span', { class: 'pill', text: `${t.name} · ${Math.round(t.score)}`, title: t.cards.join(', ') }));
    if (!row.childNodes.length) row.appendChild(el('span', { class: 'tiny dim', text: 'No strong theme yet — add more cards and this will sharpen up.' }));
    return row;
  }

  /**
   * One suggestion. Hovering anywhere on the row brings up the full-size,
   * readable card; on a phone, where there is no hover, tapping the picture
   * does the same thing. When the advisor has a card to take out for this
   * one, the row offers the swap as a single action.
   *
   * Acting on a suggestion finishes it: the row leaves the list there and
   * then, rather than sitting under your finger looking un-pressed until the
   * next pass over the deck catches up with it.
   */
  function suggestionRow(s, hooks) {
    hooks = hooks || {};
    const card = s.card;
    const cut = s.cutFor && s.cutFor.card;
    let row = null;

    const done = () => {
      if (!row || row.dataset.done) return;
      row.dataset.done = '1';
      row.classList.add('sugg-done');
      for (const b of row.querySelectorAll('button')) b.disabled = true;
      if (hooks.onConsumed) hooks.onConsumed(s);
      setTimeout(() => row.remove(), 220);
    };
    // a hook that says false did not do the thing, so the suggestion stays
    const act = (fn) => (e) => {
      e.stopPropagation();
      if (!fn) return;
      if (fn() === false) return;
      done();
    };

    const actions = el('div', { class: 'sugg-actions' });
    if (cut && hooks.onSwap) {
      actions.appendChild(el('button', {
        class: 'btn xs primary', text: 'Swap in',
        title: 'Add ' + card.name + ' and cut ' + cut.name,
        onclick: act(() => hooks.onSwap(card, cut)),
      }));
    }
    actions.appendChild(el('button', {
      class: 'btn xs' + (cut && hooks.onSwap ? '' : ' primary'), text: '+ Add',
      title: 'Add without cutting anything',
      onclick: act(hooks.onAdd ? () => hooks.onAdd(card) : null),
    }));

    let cutLine = null;
    if (cut) {
      const cutName = el('span', { class: 'tiny cut-name', text: cut.name });
      bigPreview(cutName, cut);
      cutLine = el('div', { class: 'sugg-cut' }, [
        el('span', { class: 'sugg-cut-arrow', text: '⇄' }),
        el('span', { class: 'tiny', text: 'in place of ' }),
        cutName,
        el('span', { class: 'tiny dim', text: (s.cutFor.reasons || []).length ? ' — ' + s.cutFor.reasons[0] : '' }),
      ]);
      UI.attachPreview(cutLine, cut, 0);
    }

    const thumb = el('div', { class: 'sugg-thumb' }, UI.cardImage(card, 'normal', 0));
    bigPreview(thumb, card);

    row = el('div', { class: 'sugg-row' }, [
      thumb,
      el('div', { class: 'grow', style: { minWidth: 0 } }, [
        el('div', { class: 'sugg-name' }, [
          el('span', { text: card.name }),
          el('span', { class: 'sugg-cost', html: MTG.mana.html(card.mana_cost || '') }),
        ]),
        el('div', { class: 'tiny dim', text: card.type_line || '' }),
        el('div', { class: 'sugg-why', text: (s.reasons || []).join(' · ') }),
        cutLine,
      ].filter(Boolean)),
      actions,
    ]);
    UI.attachPreview(row, card, 0);
    return row;
  }

  /** Tap or click for a good look at the card. This is what a phone gets. */
  function bigPreview(node, card) {
    if (!node || !card) return node;
    node.classList.add('tap-preview');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('title', 'Show ' + card.name + ' full size');
    node.setAttribute('aria-label', 'Show ' + card.name + ' full size');
    node.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); UI.cardSheet(card); });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      UI.cardSheet(card);
    });
    return node;
  }

  function comboRow(c, opts) {
    opts = opts || {};
    const pieces = el('div', { class: 'row wrap', style: { gap: '4px', marginTop: '3px' } });
    for (const p of c.pieces) {
      const missing = (c.missing || []).some(m => U.normName(m) === U.normName(p));
      pieces.appendChild(el('span', { class: 'pill' + (missing ? ' bad' : ' good'), text: p + (missing ? ' — missing' : '') }));
    }
    for (const t of (c.templates || [])) pieces.appendChild(el('span', { class: 'pill warn', text: t + ' (any)' }));

    const head = el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      el('span', { class: 'pill ' + (KIND_PILL[c.kind] || ''), text: MTG.combos.kindLabel(c.kind) }),
      el('strong', { class: 'small', text: (c.produces || []).join(', ') || 'Combo' }),
      c.confidence === 'conditional' ? el('span', { class: 'pill', text: 'check the numbers' }) : null,
      el('span', { class: 'grow' }),
      el('span', { class: 'tiny dim', text: c.source === 'spellbook' ? 'Commander Spellbook' : c.source === 'curated' ? 'known combo' : 'found by the engine' }),
    ]);

    const body = el('div');
    if (c.steps) body.appendChild(el('div', { class: 'tiny', style: { color: 'var(--ink-2)', marginTop: '4px', whiteSpace: 'pre-wrap' }, text: c.steps }));
    if (c.prerequisites) body.appendChild(el('div', { class: 'tiny dim', style: { marginTop: '3px', whiteSpace: 'pre-wrap' }, text: 'Needs: ' + c.prerequisites }));
    if (c.mana) body.appendChild(el('div', { class: 'tiny dim', html: 'Mana: ' + MTG.mana.html(c.mana) }));

    const foot = el('div', { class: 'row', style: { marginTop: '6px' } });
    if (c.url) foot.appendChild(el('a', { class: 'btn xs', href: c.url, target: '_blank', rel: 'noreferrer noopener', text: 'On Commander Spellbook' }));
    if (opts.onAddMissing && (c.missing || []).length === 1) {
      const add = el('button', {
        class: 'btn xs primary', text: '+ Add ' + c.missing[0],
        onclick: (e) => {
          e.stopPropagation();
          if (opts.onAddMissing(c.missing[0], c) === false) return;
          add.disabled = true;
          add.textContent = 'Added';
          add.classList.remove('primary');
        },
      });
      foot.appendChild(add);
    }

    return el('div', { class: 'combo-card' }, [head, pieces, body, foot.childNodes.length ? foot : null].filter(Boolean));
  }

  /* ============================================================
     The deck builder panel
     ============================================================ */

  /**
   * advisorPanel(host, getDeck, formatId, hooks)
   * Re-runs whenever the deck changes. Cheap work (profile, offline combo
   * scan) is synchronous; the network passes are debounced.
   */
  UI.advisorPanel = function (host, getDeck, getFormat, hooks) {
    hooks = hooks || {};
    let lastProfile = null;
    let lastCombos = null;
    let lastRecs = null;
    let busyNet = false;
    let generation = 0;

    const summary = el('div', { class: 'panel' });
    const gapsBox = el('div', { class: 'panel' });
    const combosBox = el('div', { class: 'panel' });
    const recsBox = el('div', { class: 'panel' });
    host.append(summary, gapsBox, combosBox, recsBox);

    function renderSummary(prof, validation) {
      summary.innerHTML = '';
      const sizePill = validation
        ? el('span', {
            class: 'pill ' + (validation.ok ? 'good' : 'bad'),
            text: validation.exact
              ? `${validation.size} / ${validation.min} cards`
              : `${validation.size} cards (min ${validation.min}${validation.max != null ? ', max ' + validation.max : ''})`,
          })
        : null;
      summary.append(
        el('h3', { text: 'What this deck looks like' }),
        el('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } }, [
          el('span', { class: 'archetype', text: prof.label }),
          sizePill,
          el('span', { class: 'pill', text: prof.strategy }),
          el('span', { class: 'pill', text: `avg MV ${prof.stats.avgMv}` }),
        ].filter(Boolean)),
        themeChips(prof),
      );
    }

    function renderGaps(prof) {
      gapsBox.innerHTML = '';
      gapsBox.append(el('h3', { text: 'Balance' }), gapBar(prof.gaps));
      const worst = prof.gaps.filter(g => g.severity === 'high');
      if (worst.length)
        gapsBox.appendChild(el('div', { class: 'small', style: { marginTop: '6px', color: 'var(--warn)' },
          text: 'Most wanted: ' + worst.map(g => `${g.diff} more ${g.name}`).join(', ') + '.' }));
    }

    function renderCombos(res, partial) {
      combosBox.innerHTML = '';
      const n = res ? res.combos.length : 0;
      combosBox.appendChild(el('div', { class: 'row', style: { marginBottom: '6px' } }, [
        el('h3', { style: { margin: 0, flex: 1 }, text: 'Combos' }),
        n ? el('span', { class: 'pill warn', text: `${n} found` }) : el('span', { class: 'pill', text: 'none yet' }),
        partial ? el('span', { class: 'spinner', title: 'Checking Commander Spellbook…' }) : null,
      ].filter(Boolean)));
      if (!res) { combosBox.appendChild(el('div', { class: 'empty-note', text: 'Scanning…' })); return; }
      if (!res.combos.length) {
        combosBox.appendChild(el('div', { class: 'tiny dim', text: partial ? 'Nothing in the offline scan yet; still checking the combo database.' : 'No infinite combos detected in this list.' }));
      }
      for (const c of res.combos.slice(0, 12)) combosBox.appendChild(comboRow(c));
      if (res.combos.length > 12)
        combosBox.appendChild(el('button', { class: 'btn xs', text: `Show all ${res.combos.length}`, onclick: () => UI.combosModal(res) }));
      if (res.near && res.near.length) {
        combosBox.appendChild(el('div', { class: 'section-title', style: { margin: '12px 0 6px' }, text: `One card away (${res.near.length})` }));
        for (const c of res.near.slice(0, 5))
          combosBox.appendChild(comboRow(c, { onAddMissing: hooks.onAddByName }));
        if (res.near.length > 5)
          combosBox.appendChild(el('button', { class: 'btn xs', text: `Show all ${res.near.length}`, onclick: () => UI.combosModal(res, true) }));
      }
      if (res.sources && !res.sources.spellbook)
        combosBox.appendChild(el('div', { class: 'tiny dim', style: { marginTop: '6px' },
          text: 'Offline scan only — the Commander Spellbook database could not be reached, so only known combos and loops the engine can reason about are listed.' }));
    }

    /* A suggestion that has been acted on is no longer a suggestion. It is
       dropped from the data as well as the DOM, because the loading state of
       the next network pass re-renders this list from `lastRecs`. */
    function consumed(s) {
      if (!lastRecs || !s || !s.card) return;
      const id = s.card.id;
      const keep = (x) => !x || !x.card || x.card.id !== id;
      lastRecs.cards = (lastRecs.cards || []).filter(keep);
      lastRecs.comboCompletions = (lastRecs.comboCompletions || []).filter(keep);
      // whatever it cut is gone, so nothing else can offer to cut it
      const cutId = s.cutFor && s.cutFor.card && s.cutFor.card.id;
      if (cutId) {
        for (const x of (lastRecs.cards || []).concat(lastRecs.comboCompletions || []))
          if (x.cutFor && x.cutFor.card && x.cutFor.card.id === cutId) x.cutFor = null;
        lastRecs.cuts = (lastRecs.cuts || []).filter(c => !c.card || c.card.id !== cutId);
      }
    }
    const rowHooks = Object.assign({}, hooks, { onConsumed: consumed });

    function renderRecs(recs, loading) {
      recsBox.innerHTML = '';
      recsBox.appendChild(el('div', { class: 'row', style: { marginBottom: '6px' } }, [
        el('h3', { style: { margin: 0, flex: 1 }, text: 'Suggested cards' }),
        loading ? el('span', { class: 'spinner' }) : el('button', { class: 'btn xs', text: 'Refresh', onclick: () => runNetwork(true) }),
      ]));
      if (!recs) {
        recsBox.appendChild(el('div', { class: 'empty-note', text: loading ? 'Working out what fits…' : 'Add a few cards and suggestions will appear.' }));
        return;
      }
      if (recs.cards.length) {
        recsBox.appendChild(el('div', { class: 'tiny dim', style: { marginBottom: '8px' },
          text: 'Each suggestion names the card it would replace, so the deck stays the right size. '
            + (MTG.isTouch() ? 'Tap a card\'s picture to read it.' : 'Hover a row to read the card.') }));
        // say what the advice was built from, so a thin list is explained
        const src = recs.sources || {};
        recsBox.appendChild(el('div', { class: 'row wrap src-row', style: { marginBottom: '8px' } }, src.recommander ? [
          // Recommander's picks, credited as its terms ask, with a way to its site
          el('span', { class: 'pill good', text: 'Recommander' }),
          el('a', { class: 'tiny src-link', href: MTG.recommander.SITE, target: '_blank', rel: 'noopener', text: 'Suggestions from recommander.cards' }),
        ] : [
          el('span', { class: 'pill good', title: 'Read from the cards in your list', text: 'this deck' }),
          src.edhrec
            ? el('span', { class: 'pill good', title: 'What other people play in this commander', text: 'EDHREC' })
            : el('span', { class: 'pill', title: 'EDHREC was not reachable, or this format has no commander. Suggestions come from the deck alone.', text: 'EDHREC unavailable' }),
        ]));
      }
      if (recs.comboCompletions.length) {
        recsBox.appendChild(el('div', { class: 'section-title', style: { margin: '4px 0 6px' }, text: 'Completes a combo' }));
        for (const cc of recs.comboCompletions.slice(0, 5)) {
          recsBox.appendChild(suggestionRow({
            card: cc.card, cutFor: cc.cutFor,
            reasons: [cc.produces + ' with ' + cc.with.join(' + ')],
          }, rowHooks));
        }
        recsBox.appendChild(el('div', { class: 'section-title', style: { margin: '12px 0 6px' }, text: 'Fits the plan' }));
      }
      if (!recs.cards.length) {
        recsBox.appendChild(el('div', { class: 'empty-note', text: 'Nothing to suggest — either the deck is well covered or Scryfall is unreachable.' }));
      }
      for (const s of recs.cards) recsBox.appendChild(suggestionRow(s, rowHooks));

      if (recs.cuts && recs.cuts.length) {
        recsBox.appendChild(el('div', { class: 'section-title', style: { margin: '14px 0 6px' },
          text: 'Doing the least for the plan (' + recs.cuts.length + ')' }));
        for (const c of recs.cuts.slice(0, 12)) {
          const name = el('div', { class: 'sugg-name', text: c.card.name });
          bigPreview(name, c.card);
          const row = el('div', { class: 'cut-row' }, [
            el('div', { class: 'grow', style: { minWidth: 0 } }, [
              name,
              el('div', { class: 'tiny dim', text: c.reasons.join(', ') }),
            ]),
            hooks.onRemove ? el('button', {
              class: 'btn xs danger', text: 'Cut',
              onclick: (e) => {
                e.stopPropagation();
                if (hooks.onRemove(c.card) === false) return;
                row.classList.add('sugg-done');
                lastRecs.cuts = (lastRecs.cuts || []).filter(x => x.card.id !== c.card.id);
                setTimeout(() => row.remove(), 220);
              },
            }) : null,
          ].filter(Boolean));
          UI.attachPreview(row, c.card, 0);
          recsBox.appendChild(row);
        }
      }
    }

    /* --- the cheap pass runs on every edit --- */
    function refreshLocal(validation) {
      const deck = getDeck();
      const fmtId = getFormat();
      lastProfile = MTG.advisor.profile(deck, fmtId);
      renderSummary(lastProfile, validation);
      renderGaps(lastProfile);
      const quick = MTG.combos.quickScan(deck);
      if (!lastCombos) renderCombos({ combos: quick.combos, near: quick.near, sources: { spellbook: false } }, true);
    }

    /* --- the network pass is debounced --- */
    const runNetwork = U.debounce(async function (force) {
      const myGen = ++generation;
      const deck = getDeck();
      const fmtId = getFormat();
      if (!deck.main.length && !(deck.commanders || []).length) return;
      busyNet = true;
      renderRecs(lastRecs, true);
      try {
        const combos = await MTG.combos.analyzeDeck(deck, { force: !!force });
        if (myGen !== generation) return;
        lastCombos = combos;
        renderCombos(combos, false);

        const recs = await MTG.advisor.recommend(deck, fmtId, {
          profile: lastProfile || MTG.advisor.profile(deck, fmtId),
          combos, limit: 20,
        });
        if (myGen !== generation) return;
        lastRecs = recs;
        renderRecs(recs, false);
      } catch (e) {
        if (myGen !== generation) return;
        renderRecs(lastRecs, false);
        MTG.log('advisor failed', e);
      } finally { busyNet = false; }
    }, 700);

    return {
      refresh(validation) { refreshLocal(validation); runNetwork(false); },
      refreshLocalOnly(validation) { refreshLocal(validation); },
      get profile() { return lastProfile; },
      get combos() { return lastCombos; },
    };
  };

  /* ============================================================
     Full combo list in a modal
     ============================================================ */
  UI.combosModal = function (res, nearFirst) {
    const body = el('div');
    const mk = (title, list, opts) => {
      if (!list.length) return;
      body.appendChild(el('div', { class: 'section-title', text: `${title} (${list.length})` }));
      for (const c of list) body.appendChild(comboRow(c, opts));
    };
    if (nearFirst) { mk('One card away', res.near || []); mk('In your deck', res.combos || []); }
    else { mk('In your deck', res.combos || []); mk('One card away', res.near || []); }
    if (!body.childNodes.length) body.appendChild(el('div', { class: 'empty-note', text: 'No combos found.' }));
    return UI.modal({ title: 'Combos', width: '820px', content: body });
  };

  /* ============================================================
     Post-import report
     ============================================================ */

  UI.deckReport = function (deck, formatId, opts) {
    opts = opts || {};
    const validation = opts.validation || MTG.formats.validate(deck, formatId);
    const prof = MTG.advisor.profile(deck, formatId);
    const body = el('div');

    const legalPill = el('span', {
      class: 'pill ' + (validation.ok ? 'good' : 'bad'),
      text: validation.ok ? 'Legal' : `${validation.errors.length} problem${validation.errors.length === 1 ? '' : 's'}`,
    });
    const sizeText = validation.exact
      ? `${validation.size} of ${validation.min} cards`
      : `${validation.size} cards${validation.min ? ' (minimum ' + validation.min : ''}${validation.max != null ? ', maximum ' + validation.max + ')' : (validation.min ? ')' : '')}`;

    body.append(
      el('div', { class: 'panel' }, [
        el('div', { class: 'row wrap', style: { gap: '8px' } }, [
          el('span', { class: 'archetype', text: prof.label }),
          legalPill,
          el('span', { class: 'pill', text: sizeText }),
          el('span', { class: 'pill', text: MTG.formats.get(formatId).name }),
        ]),
        el('div', { style: { marginTop: '8px' } }, themeChips(prof)),
        validation.errors.length
          ? el('ul', { class: 'error-list' }, validation.errors.slice(0, 8).map(e => el('li', { text: e })))
          : null,
        validation.warnings.length
          ? el('ul', { class: 'error-list muted' }, validation.warnings.slice(0, 5).map(e => el('li', { text: e })))
          : null,
        (opts.missing && opts.missing.length)
          ? el('div', { class: 'small', style: { color: 'var(--bad)', marginTop: '6px' },
              text: 'Not found on Scryfall: ' + opts.missing.map(m => `${m.qty}× ${m.name}`).join(', ') })
          : null,
      ].filter(Boolean)),
    );

    /* what the game runs by itself, and the cards it hands to you */
    const auto = UI.deckAutomation(deck);
    if (auto.total) {
      body.appendChild(el('div', { class: 'panel auto-report' }, [
        el('h3', null, [el('span', { class: 'grow', text: 'Automation' }), UI.autoShare(auto.auto, auto.total)]),
        el('div', { class: 'tiny dim', style: { marginBottom: auto.manual.length ? '8px' : 0 }, text: auto.manual.length
          ? 'These have text the game cannot carry out by itself. When they come up, you resolve that part with the table tools.'
          : 'The game runs every card in this deck by itself.' }),
        auto.manual.length ? el('div', { class: 'auto-manual-list' }, auto.manual.map(mm => {
          const row = el('div', { class: 'auto-manual' }, [
            UI.autoBadge(mm.card),
            el('span', { class: 'nm', text: `${mm.qty}× ${mm.card.name}` }),
            el('span', { class: 'tiny dim why', text: mm.lines[0] || '' }),
          ]);
          UI.attachPreview(row, mm.card, 0);
          return row;
        })) : null,
      ].filter(Boolean)));
    }

    const balance = el('div', { class: 'panel' }, [el('h3', { text: 'Balance' }), gapBar(prof.gaps)]);
    body.appendChild(balance);

    const comboBox = el('div', { class: 'panel' }, [
      el('div', { class: 'row' }, [el('h3', { style: { margin: 0, flex: 1 }, text: 'Combos' }), el('span', { class: 'spinner' })]),
      el('div', { class: 'empty-note', text: 'Scanning…' }),
    ]);
    const recBox = el('div', { class: 'panel' }, [
      el('div', { class: 'row' }, [el('h3', { style: { margin: 0, flex: 1 }, text: 'Suggested cards' }), el('span', { class: 'spinner' })]),
      el('div', { class: 'empty-note', text: 'Thinking…' }),
    ]);
    body.append(comboBox, recBox);

    const m = UI.modal({
      title: 'Deck report — ' + deck.name,
      width: '900px',
      className: 'report-modal',
      art: UI.keyCard(deck),
      content: body,
      buttons: [
        { label: 'Close', onClick: () => m.close() },
        { label: 'Open the deck builder', class: 'primary', onClick: () => { m.close(); if (opts.onOpenBuilder) opts.onOpenBuilder(); } },
      ],
    });

    (async () => {
      let combos = null;
      try { combos = await MTG.combos.analyzeDeck(deck); } catch (e) { combos = MTG.combos.quickScan(deck); }
      comboBox.innerHTML = '';
      comboBox.appendChild(el('div', { class: 'row', style: { marginBottom: '6px' } }, [
        el('h3', { style: { margin: 0, flex: 1 }, text: 'Combos' }),
        el('span', { class: 'pill ' + (combos.combos.length ? 'warn' : ''), text: combos.combos.length ? `${combos.combos.length} found` : 'none' }),
      ]));
      if (!combos.combos.length) comboBox.appendChild(el('div', { class: 'tiny dim', text: 'No infinite combos detected.' }));
      for (const c of combos.combos.slice(0, 8)) comboBox.appendChild(comboRow(c));
      if (combos.near && combos.near.length) {
        comboBox.appendChild(el('div', { class: 'section-title', style: { margin: '10px 0 6px' }, text: `One card away (${combos.near.length})` }));
        for (const c of combos.near.slice(0, 4)) comboBox.appendChild(comboRow(c));
      }

      try {
        const recs = await MTG.advisor.recommend(deck, formatId, { profile: prof, combos, limit: 12 });
        const rHooks = { onAdd: opts.onAdd || (() => {}), onSwap: opts.onSwap || null };
        recBox.innerHTML = '';
        recBox.appendChild(el('h3', { text: 'Suggested cards' }));
        recBox.appendChild(el('div', { class: 'tiny dim', style: { marginBottom: '8px' },
          text: 'Each one names the card it would replace. '
            + (MTG.isTouch() ? 'Tap a card\'s picture to read it.' : 'Hover a row to read the card.') }));
        if (recs.comboCompletions.length) {
          recBox.appendChild(el('div', { class: 'section-title', style: { margin: '4px 0 6px' }, text: 'Completes a combo' }));
          for (const cc of recs.comboCompletions.slice(0, 4))
            recBox.appendChild(suggestionRow({ card: cc.card, cutFor: cc.cutFor,
              reasons: [cc.produces + ' with ' + cc.with.join(' + ')] }, rHooks));
          recBox.appendChild(el('div', { class: 'section-title', style: { margin: '10px 0 6px' }, text: 'Fits the plan' }));
        }
        for (const s of recs.cards.slice(0, 10)) recBox.appendChild(suggestionRow(s, rHooks));
        if (!recs.cards.length) recBox.appendChild(el('div', { class: 'tiny dim', text: 'No suggestions — Scryfall may be unreachable.' }));
        if (recs.cuts && recs.cuts.length) {
          recBox.appendChild(el('div', { class: 'section-title', style: { margin: '14px 0 6px' },
            text: 'Doing the least for the plan' }));
          for (const c of recs.cuts.slice(0, 6)) {
            const row = el('div', { class: 'cut-row' }, [
              el('div', { class: 'grow' }, [
                el('div', { class: 'sugg-name', text: c.card.name }),
                el('div', { class: 'tiny dim', text: c.reasons.join(', ') }),
              ]),
            ]);
            UI.attachPreview(row, c.card, 0);
            recBox.appendChild(row);
          }
        }
      } catch (e) {
        recBox.innerHTML = '';
        recBox.append(el('h3', { text: 'Suggested cards' }),
          el('div', { class: 'tiny dim', text: 'Could not reach Scryfall for suggestions.' }));
      }
    })();

    return m;
  };

})(window.MTG);


