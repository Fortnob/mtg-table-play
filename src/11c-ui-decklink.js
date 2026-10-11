/* ============================================================
   11c-ui-decklink.js - opening a deck link
   An address ending #deck=... (src/05a-decklink.js) offers to put
   that deck in your decks: first what it is, its name and format,
   and on a yes its cards looked up, the deck saved and opened in
   the builder. Making a link is in the builder's Export.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;

  // a format the table knows by this id (a link is anybody's text, so not just any key will do)
  const knownFormat = (id) => MTG.formats.list().some(f => f.id === id);

  /** Take the deck out of the address, so a reload does not offer it again. */
  function clearHash() {
    try { history.replaceState(null, '', String(location.href).split('#')[0]); }
    catch (e) { try { location.hash = ''; } catch (e2) { /* nothing to be done */ } }
  }

  let showing = null;   // the link on offer now, so one link is never offered twice at once

  async function offer(text) {
    if (showing === text) return;
    let data;
    try { data = MTG.decklink.decode(text); }
    catch (e) { clearHash(); UI.error(e.message || String(e)); return; }
    showing = text;
    clearHash();

    const sideboard = data.sideboard.reduce((n, e) => n + e.qty, 0);
    const main = data.size - sideboard;
    const known = knownFormat(data.format);
    // a format this table has never heard of (a newer table's, say): the player picks one
    const fmtSel = known ? null : el('select', { 'aria-label': 'Format' }, MTG.formats.deckFormats().map(f =>
      el('option', { value: f.id, text: f.name, selected: f.id === (data.commanders.length ? 'commander' : 'standard') })));
    const fmtName = known ? MTG.formats.get(data.format).name : null;
    const facts = [
      `${main} card${main === 1 ? '' : 's'}`,
      sideboard ? `${sideboard} in the sideboard` : null,
      data.commanders.length ? (data.commanders.length > 1 ? 'two commanders' : 'a commander') : null,
      data.companion.length ? 'a companion' : null,
    ].filter(Boolean);

    const m = UI.modal({
      title: 'A shared deck', width: '460px', className: 'decklink-modal',
      content: el('div', { class: 'decklink-offer' }, [
        el('div', { class: 'dl-name', text: data.name || 'Shared deck' }),
        el('div', { class: 'dl-facts' }, [
          known ? el('span', { class: 'pill', text: fmtName }) : null,
          el('span', { class: 'small muted', text: facts.join(' · ') }),
        ].filter(Boolean)),
        known ? null : el('label', { class: 'field', style: { marginTop: '12px' } }, [
          el('span', { text: `Made for a format this table does not know (${String(data.format || 'none').slice(0, 30)}). Play it as` }), fmtSel,
        ]),
        el('p', { class: 'tiny dim', style: { margin: '14px 0 0' }, text: 'It is added to your decks in this browser, its cards looked up on Scryfall in the printings it was shared with.' }),
      ].filter(Boolean)),
      buttons: [
        { label: 'Not now', onClick: () => m.close() },
        { label: 'Add to my decks', class: 'primary', onClick: () => { m.close(); add(data, fmtSel ? fmtSel.value : data.format); } },
      ],
    });
    m._onClose = () => { showing = null; };
  }

  async function add(data, formatId) {
    const busy = UI.busy('Adding the deck', 'Looking the cards up…');
    let res;
    try {
      res = await MTG.decklink.resolve(Object.assign({}, data, { format: formatId }), {
        onProgress: (a, b) => busy.set(a / b, `Looking the cards up… ${a}/${b}`),
      });
    } catch (e) {
      busy.close();
      UI.error(e.message || String(e));
      return;
    }
    busy.close();
    const { deck, missing } = res;
    if (!deck.main.length && !deck.commanders.length) {
      UI.error('None of the cards in that deck could be found. Check the connection and open the link again.');
      return;
    }
    MTG.decks.save(deck);
    UI.ok(`“${deck.name}” is in your decks.`);
    if (missing.length) UI.toast(`${missing.length} card${missing.length === 1 ? '' : 's'} could not be found: ${missing.map(x => x.name).slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`, 'err', 6000);
    // at a table the game stays where it is; anywhere else, the deck is shown
    const App = MTG.app;
    if (!App || ['table', 'draft', 'lobby'].includes(App.screen)) return;
    App.showScreen('decks');
    UI.deckBuilder(deck, { missing, onSave: () => { if (App.screen === 'decks') App.showScreen('decks'); } });
  }

  function check() {
    const text = MTG.decklink.fromHash(typeof location !== 'undefined' ? location.hash : '');
    if (text) offer(text);
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // a link opened in a tab that already has the table open
    window.addEventListener('hashchange', check);
    // and one that opened the page: looked at once the app has started (src/14-app.js starts it on the same event)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(check, 0));
    else setTimeout(check, 60);
  }
})(window.MTG);
