/* ===== 10h-ui-history.js ===== */
'use strict';
/* ============================================================
   10h-ui-history.js - the record of games, shown

   The screens for src/10g-history.js: the Profile's History tab, every
   game and match you have finished, newest first, narrowed by format and
   by result; and a deck's record ("7–3, 70%") on its deck box and in the
   deck builder.
   ============================================================ */
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const H = () => MTG.history;
  const fmtName = (id) => ((MTG.formats && MTG.formats.get(id)) || {}).name || String(id || 'Other');

  /** How long a game took, in words. */
  function duration(ms) {
    if (!ms) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'under a minute';
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
  }
  /** When, briefly: the time today, the day this week, the date before that. */
  function when(at) {
    const d = new Date(at), now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return time;
    const days = (now - d) / 86400000;
    if (days < 6) return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  /** Who was across the table, as a line: "Brass Scribe (bot, 5) and Kira". */
  function opponents(e) {
    const names = (e.opp || []).map(o => o.bot ? `${o.name} (bot${o.level ? ', ' + o.level : ''})` : o.name);
    if (!names.length) return 'nobody';
    return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  /** What they brought: commanders where there are any, deck names otherwise. */
  function theirDecks(e) {
    const bits = (e.opp || []).map(o => o.cmd || o.deck).filter(Boolean);
    return bits.length ? bits.join(' · ') : '';
  }

  /* ---------------- the History tab ---------------- */
  // what the list is narrowed to, kept while the page is open
  const filter = { format: 'all', result: 'all' };
  const PAGE = 40;

  UI.renderHistory = function (body) {
    const formats = H().formats();
    if (filter.format !== 'all' && !formats.includes(filter.format)) filter.format = 'all';
    const all = H().entries();
    const panel = el('section', { class: 'panel history' });
    body.appendChild(panel);
    panel.appendChild(el('h3', { text: 'History' }));
    if (!all.length) {
      panel.appendChild(el('p', { class: 'dim', text: 'Nothing yet. Every game and match you finish is written down here: who you played, with what, and how it went.' }));
      return;
    }
    panel.appendChild(el('p', { class: 'dim', text: `Your last ${H().MAX} games and matches are kept here. Older ones still count in each deck’s record.` }));

    const fmtSel = el('select', { class: 'hist-format', 'aria-label': 'Format' }, [el('option', { value: 'all', text: 'Every format' })]
      .concat(formats.map(f => el('option', { value: f, text: fmtName(f), selected: f === filter.format }))));
    fmtSel.addEventListener('change', () => { filter.format = fmtSel.value; draw(); });
    const chips = el('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Result' });
    const drawChips = () => {
      chips.innerHTML = '';
      for (const [v, label] of [['all', 'All'], ['win', 'Won'], ['loss', 'Lost'], ['draw', 'Drawn']]) {
        chips.appendChild(el('button', {
          type: 'button', class: 'chip' + (filter.result === v ? ' on' : ''), text: label, 'aria-pressed': filter.result === v ? 'true' : 'false',
          onclick: () => { filter.result = v; drawChips(); draw(); },
        }));
      }
    };
    drawChips();
    const summary = el('div', { class: 'hist-summary', role: 'status' });
    panel.appendChild(el('div', { class: 'hist-filters' }, [fmtSel, chips]));
    panel.appendChild(summary);
    const list = el('div', { class: 'hist-list' });
    panel.appendChild(list);
    let shown = PAGE;
    const more = el('button', { type: 'button', class: 'btn sm hist-more', text: 'Show more', onclick: () => { shown += PAGE; draw(); } });
    panel.appendChild(more);

    function draw() {
      const rows = H().entries(filter);
      const t = H().tally(rows);
      const matches = rows.filter(x => x.kind === 'match');
      summary.textContent = !rows.length ? 'Nothing matches that.'
        : [t.g ? `${t.g} game${t.g === 1 ? '' : 's'} · ${H().recordText(t)} won` : null,
          matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : null].filter(Boolean).join(' · ');
      list.innerHTML = '';
      for (const e of rows.slice(0, shown)) list.appendChild(row(e));
      more.style.display = rows.length > shown ? '' : 'none';
    }
    draw();
  };

  function row(e) {
    const match = e.kind === 'match';
    const mine = e.deck ? (e.deck.cmd && e.deck.cmd !== e.deck.name ? `${e.deck.name} (${e.deck.cmd})` : e.deck.name) : 'Your deck';
    const head = match ? `Match ${e.score || ''} against ${opponents(e)}` : `Against ${opponents(e)}`;
    const sub = [mine, fmtName(e.format), H().MODES[e.mode] || e.mode, e.game ? `game ${e.game.n} of ${e.game.of}` : null].filter(Boolean).join(' · ');
    const meta = [e.turns ? `${e.turns} turn${e.turns === 1 ? '' : 's'}` : null, duration(e.ms)].filter(Boolean).join(' · ');
    const theirs = theirDecks(e);
    return el('div', { class: `hrow r-${e.result}${match ? ' match' : ''}` }, [
      el('span', { class: 'hr-badge', text: match ? `Match ${H().RESULTS[e.result].toLowerCase()}` : H().RESULTS[e.result] }),
      el('div', { class: 'hr-main' }, [
        el('b', { class: 'hr-head', text: head }),
        el('span', { class: 'hr-sub', text: sub }),
        theirs ? el('span', { class: 'hr-opp', text: 'They played ' + theirs }) : null,
      ]),
      el('div', { class: 'hr-meta' }, [
        el('span', { class: 'hr-when', text: when(e.at), title: new Date(e.at).toLocaleString() }),
        meta ? el('span', { text: meta }) : null,
      ]),
    ]);
  }

  /* ---------------- a deck's record ---------------- */
  /**
   * A deck's games so far as a pill ("7–3, 70%"), or null if it has not
   * played. Takes the deck, or its index entry; `cls` is added to the pill
   * ('on-art' for one laid over the deck box's art).
   */
  UI.deckRecordPill = function (deck, cls) {
    const t = deck && H().deckRecord(deck);
    if (!t || !t.g) return null;
    const m = t.mw + t.ml + t.md;
    const title = `${t.w} won, ${t.l} lost${t.d ? `, ${t.d} drawn` : ''} in ${t.g} game${t.g === 1 ? '' : 's'}` +
      (m ? `; matches ${t.mw}–${t.ml}${t.md ? '–' + t.md : ''}` : '');
    const rate = t.w / t.g;
    return el('span', { class: 'pill deck-record' + (rate >= 0.5 ? ' good' : '') + (cls ? ' ' + cls : ''), title, 'aria-label': 'Record: ' + title, text: H().recordText(t) });
  };

  UI.historyWords = { duration, when, opponents };
})(window.MTG);
