/* ===== 10g-rulings.js ===== */
/* ============================================================
   10g-rulings.js - a card's official rulings, from Scryfall
   The notes Wizards publishes on how a card plays (and the few
   Scryfall adds), each with its date; an errata'd card's old printing
   says first what changed since it was printed. The first sits under the
   enlarged card, cut to a few lines; when there are more, or it runs
   long, "Show more" opens them in a window of their own, one at a
   time.
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

  /* An errata'd card's old printing (src/02d-oldprints.js) is shown as it was printed, words and all, and plays as
     the card reads today: what changed comes first among its rulings, then the words it plays by. The two changes
     most printings share are said in full; the rest in the list's own few words. */
  const PLAIN = {
    'targets: any target': 'Where this printing aims at a creature or player, the card today says "any target", which takes in planeswalkers and battles as well.',
    'targets: player or planeswalker': 'Where this printing aims at a player, the card today says "target player or planeswalker".',
  };
  function errata(card) {
    const note = MTG.oldPrints && MTG.oldPrints.note(card);
    if (!note) return null;
    const what = PLAIN[note] || (note.charAt(0).toUpperCase() + note.slice(1) + (/[.!?]$/.test(note) ? '' : '.'));
    const now = card.card_faces && card.card_faces.length > 1
      ? card.card_faces.map(f => f.oracle_text).filter(Boolean).join('\n//\n') : String(card.oracle_text || '');
    return { errata: true, date: '', source: 'errata',
      text: what + ' This printing shows the older words; the card plays as it reads today' + (now ? ':\n' + now : '.') };
  }

  MTG.rulings = { get: rulings, tidy, dateText, scryfallId, errata };

  /** One ruling: its date, whose it is, and its words. */
  const rulingBody = (r) => [
    el('div', { class: 'rul-head' }, (r.errata
      ? [el('span', { class: 'rul-src rul-errata', text: 'Errata', title: 'This printing\'s words are older than the card\'s' })]
      : [
        el('time', { datetime: r.date, text: dateText(r.date) }),
        r.source === 'scryfall' ? el('span', { class: 'rul-src', text: 'Scryfall note', title: 'Added by Scryfall, not an official ruling' }) : null,
      ]).filter(Boolean)),
    el('div', { class: 'rul-text', html: MTG.mana.textHtml(r.text) }),
  ];

  // past this many letters a ruling no longer fits the few lines under the card
  const LONG = 180;

  /**
   * Every ruling in a window of its own, one at a time, with Previous and
   * Next (and the arrow keys) to go through them. It sits above the
   * enlarged card, and Escape closes it before the card.
   */
  function rulingsWindow(card, list, start) {
    let at = Math.max(0, Math.min(list.length - 1, start || 0));
    const where = el('span', { class: 'rul-where', 'aria-live': 'polite' });
    const page = el('div', { class: 'rul-page' });
    const prev = el('button', { type: 'button', class: 'btn sm', text: 'Previous', onclick: () => go(-1) });
    const next = el('button', { type: 'button', class: 'btn sm primary', text: 'Next', onclick: () => go(1) });
    const pager = list.length > 1 ? el('div', { class: 'rul-pager' }, [prev, where, next]) : null;
    const draw = () => {
      page.replaceChildren(...rulingBody(list[at]));
      where.textContent = `${at + 1} of ${list.length}`;
      prev.disabled = at === 0;
      next.disabled = at === list.length - 1;
    };
    const go = (d) => {
      const to = Math.max(0, Math.min(list.length - 1, at + d));
      if (to !== at) { at = to; draw(); }
    };
    const m = UI.modal({
      title: `Rulings — ${card.name}`, className: 'rul-modal', width: '560px',
      content: el('div', { class: 'rul-window' }, [page, pager].filter(Boolean)),
      buttons: [{ label: 'Close' }],
    });
    // above the enlarged card it was opened from
    if (m.el.parentNode) m.el.parentNode.style.zIndex = '900';
    /* Caught before anything else hears it: Escape closes this window and
       not the card under it, and the arrows turn the page. */
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); m.close(); }
      else if (e.key === 'ArrowLeft' && list.length > 1) { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight' && list.length > 1) { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey, true);
    m._onClose = () => window.removeEventListener('keydown', onKey, true);
    draw();
    (pager ? next : m.foot.querySelector('button')).focus({ preventScroll: true });
    return m;
  }
  UI.rulingsWindow = rulingsWindow;

  /**
   * The rulings under a card: the first one, cut to a few lines, and
   * "Show more" when there are others or it runs on. Null for a card
   * that cannot have any. It asks Scryfall as soon as it is made, so the
   * ruling is there by the time anyone looks; a card with no rulings takes
   * the box away again rather than leave an empty one.
   */
  UI.rulingsBox = function (card) {
    if (!scryfallId(card)) return null;
    const count = el('span', { class: 'rul-count', text: '…' });
    const body = el('div', { class: 'rul-body' }, el('p', { class: 'rul-wait', text: 'Asking Scryfall…' }));
    const box = el('section', { class: 'rulings', 'aria-label': 'Rulings' }, [
      el('div', { class: 'rul-top' }, [el('span', { class: 'rul-title', text: 'Rulings' }), count]),
      body,
    ]);
    // the enlarged card closes on a click anywhere; a click in here is for the rulings
    box.addEventListener('click', (e) => e.stopPropagation());
    // an old printing's errata, first, and there with Scryfall out of reach too
    const first = errata(card);

    // the first ruling, cut to a few lines, and the way to all of them
    const lead = (list) => {
      const more = list.length > 1 || list[0].text.length > LONG;
      return [
        el('div', { class: 'rul rul-first' + (more ? ' clipped' : '') }, rulingBody(list[0])),
        more ? el('button', { type: 'button', class: 'rul-more', text: 'Show more', onclick: () => rulingsWindow(card, list, 0) }) : null,
      ].filter(Boolean);
    };
    const show = (got) => {
      const list = (first ? [first] : []).concat(got || []);
      if (!list.length) { box.remove(); return; }
      count.textContent = String(list.length);
      body.replaceChildren(...lead(list));
    };
    const fail = () => {
      count.textContent = '!';
      body.replaceChildren(...(first ? lead([first]) : []), el('div', { class: 'rul-wait' }, [
        el('span', { text: 'Scryfall could not be reached for the rulings. ' }),
        el('button', { type: 'button', class: 'btn xs', text: 'Try again', onclick: () => {
          count.textContent = '…';
          body.replaceChildren(...(first ? lead([first]) : []), el('p', { class: 'rul-wait', text: 'Asking Scryfall…' }));
          rulings(card, { force: true }).then(show, fail);
        } }),
      ]));
    };
    // the errata needs nothing from Scryfall: there at once, the rulings joining it when they come
    if (first) body.replaceChildren(...lead([first]), el('p', { class: 'rul-wait', text: 'Asking Scryfall…' }));
    rulings(card).then(show, fail);
    return box;
  };
})(window.MTG);
