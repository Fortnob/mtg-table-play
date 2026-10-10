/* ============================================================
   10g-rulings.js - a card's official rulings, from Scryfall
   The notes Wizards publishes on how a card plays (and the few
   Scryfall adds), each with its date. They sit folded away under
   the enlarged card, one line until opened, so a phone still shows
   the card first.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui = MTG.ui || {};

  /* Rulings belong to the card, not the printing, so they are kept by
     oracle id: every printing of Lightning Bolt shares one list. They
     change rarely, so a fortnight before asking again is plenty. */
  const TTL = 1000 * 60 * 60 * 24 * 14;
  const STORE = 'meta';
  const asking = new Map();   // key -> the request under way, so two views of one card ask once

  /** A real Scryfall card (a token the engine made up, or an emblem, has no rulings to ask for). */
  const scryfallId = (card) => (card && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(card.id || ''))) ? card.id : null;

  /** The rulings as they are kept: date, words and whose they are, oldest first. */
  function tidy(list) {
    return (list || [])
      .filter(r => r && r.comment)
      .map(r => ({ date: String(r.published_at || ''), text: String(r.comment), source: r.source === 'scryfall' ? 'scryfall' : 'wotc' }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * A card's rulings: [{date, text, source}], oldest first, and [] for a
   * card with none. From the cache when it is fresh; otherwise from
   * Scryfall. Null for something that is not a Scryfall card. A failed
   * request throws, so a view can offer to try again; a stale copy is
   * better than nothing, so one is used when Scryfall cannot be reached.
   */
  async function rulings(card, opts) {
    opts = opts || {};
    const id = scryfallId(card);
    if (!id) return null;
    const S = MTG.scry;
    const key = 'rulings:' + (card.oracle_id || id);
    const had = await S.db.get(STORE, key);
    if (had && !opts.force && Date.now() - had._t < TTL) return had.list;
    if (asking.has(key)) return asking.get(key);
    const job = (async () => {
      try {
        // quiet: a card with no answer is no reason to tell the player Scryfall is down
        const res = await S._fetch('/cards/' + encodeURIComponent(id) + '/rulings', { quiet: true });
        const list = tidy(res && res.data);
        await S.db.put(STORE, key, { list, _t: Date.now() });
        return list;
      } catch (e) {
        if (had) return had.list;
        throw e;
      } finally { asking.delete(key); }
    })();
    asking.set(key, job);
    return job;
  }
  if (MTG.scry) MTG.scry.rulings = rulings;

  /** "2004-10-04" -> "4 Oct 2004". Read from the digits, so no time zone can move the day. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m || !MONTHS[+m[2] - 1]) return String(iso || '');
    return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  }

  MTG.rulings = { get: rulings, tidy, dateText, scryfallId };

  /**
   * The rulings, folded up under a card: one line saying how many there
   * are, opened with a tap. Null for a card that cannot have any. It asks
   * Scryfall as soon as it is made, so the count is there by the time
   * anyone looks; a card with no rulings takes the line away again rather
   * than leave an empty fold.
   */
  UI.rulingsBox = function (card) {
    if (!scryfallId(card)) return null;
    const count = el('span', { class: 'rul-count', text: '…' });
    const body = el('div', { class: 'rul-body' }, el('p', { class: 'rul-wait', text: 'Asking Scryfall…' }));
    const box = el('details', { class: 'rulings' }, [
      el('summary', null, [el('span', { class: 'rul-title', text: 'Rulings' }), count, el('span', { class: 'rules-chev', 'aria-hidden': 'true' })]),
      body,
    ]);
    // the enlarged card closes on a click anywhere; a click in here is for the rulings
    box.addEventListener('click', (e) => e.stopPropagation());

    const show = (list) => {
      if (!list || !list.length) { box.remove(); return; }
      count.textContent = String(list.length);
      body.replaceChildren(el('ol', { class: 'rul-list' }, list.map(r => el('li', { class: 'rul' }, [
        el('div', { class: 'rul-head' }, [
          el('time', { datetime: r.date, text: dateText(r.date) }),
          r.source === 'scryfall' ? el('span', { class: 'rul-src', text: 'Scryfall note', title: 'Added by Scryfall, not an official ruling' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'rul-text', html: MTG.mana.textHtml(r.text) }),
      ]))));
    };
    const fail = () => {
      count.textContent = '!';
      body.replaceChildren(el('div', { class: 'rul-wait' }, [
        el('span', { text: 'Scryfall could not be reached for the rulings. ' }),
        el('button', { type: 'button', class: 'btn xs', text: 'Try again', onclick: () => {
          count.textContent = '…';
          body.replaceChildren(el('p', { class: 'rul-wait', text: 'Asking Scryfall…' }));
          rulings(card, { force: true }).then(show, fail);
        } }),
      ]));
    };
    rulings(card).then(show, fail);
    return box;
  };
})(window.MTG);
