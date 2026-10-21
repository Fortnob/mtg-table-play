/* ===== 16b-recommander.js ===== */
/* ============================================================
   16b-recommander.js - Commander suggestions from Recommander
   Recommander (https://recommander.cards) ranks the cards that suit a
   commander deck as built, learned from a great many real decks: what
   the list in front of it is missing, not just what the commander's
   decks usually play. Its API answers only its own website from a
   browser, so the app asks through a small relay of its own
   (tools/recommander-relay), whose address is MTG.settings.
   recommanderRelay, or the one built in.

   recommander.top(deck) -> [{ oracle_id, name, score }], best first, or
   null when there is no relay, no commander, or no answer. A deck asked
   about again unchanged is answered from memory; a refusal for asking too
   often waits as long as Recommander says before the next try.
   ============================================================ */
'use strict';
(function (MTG) {
  // the relay this app was set up with (tools/recommander-relay/README.md); Options can name another
  const DEFAULT_RELAY = 'https://recommander-relay.mtgtable.workers.dev';
  const TIMEOUT = 15000;
  const KEEP = 10 * 60 * 1000;
  const remembered = new Map();      // the deck's key -> { at, list }
  let holdUntil = 0;                 // asked too often: not again before this

  const relay = () => String((MTG.settings && MTG.settings.recommanderRelay) || DEFAULT_RELAY || '').trim().replace(/\/+$/, '');

  /** What Recommander is asked about this deck: its commanders and the rest of the list, by oracle id. */
  function query(deck) {
    const cmd = (deck.commanders || []).filter(c => c && c.oracle_id);
    if (!cmd.length) return null;
    const seen = new Set(cmd.map(c => c.oracle_id));
    const list = [];
    for (const e of (deck.main || [])) {
      const id = e && e.card && e.card.oracle_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      list.push(id);
    }
    const q = { card_format: 'oracle_id', commander: cmd[0].oracle_id, deck: list.slice(0, 500) };
    if (cmd[1]) q.partner = cmd[1].oracle_id;
    return q;
  }

  async function top(deck, opts) {
    opts = opts || {};
    const url = relay();
    if (!url || typeof fetch !== 'function') return null;
    const q = query(deck);
    if (!q) return null;
    const key = JSON.stringify([q.commander, q.partner || '', q.deck.slice().sort()]);
    const had = remembered.get(key);
    if (had && Date.now() - had.at < KEEP && !opts.force) return had.list;
    if (Date.now() < holdUntil) return had ? had.list : null;

    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(q), signal: ctl ? ctl.signal : undefined,
      });
      const body = await res.json().catch(() => null);
      if (res.status === 429 || res.status === 503) {
        // too many asks, or a model loading: wait as long as they say
        holdUntil = Date.now() + 1000 * Math.max(5, Math.min(600, +res.headers.get('Retry-After') || 60));
        return had ? had.list : null;
      }
      if (!res.ok || !body || body.result_code !== 'success' || !body.data) return had ? had.list : null;
      const list = (body.data.recommendations || [])
        .filter(r => r && typeof r.name === 'string' && r.name)
        .map(r => ({ oracle_id: r.oracle_id || null, name: r.name, score: +r.score || 0 }));
      remembered.set(key, { at: Date.now(), list });
      if (remembered.size > 30) remembered.delete(remembered.keys().next().value);
      return list;
    } catch (e) {
      return had ? had.list : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Whether the relay at this address answers: true, or the reason it does not. */
  async function test(address) {
    const url = String(address || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(url)) return 'A relay address starts with https://';
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // Atraxa: a commander any answer knows
        body: JSON.stringify({ card_format: 'name', commander: 'Atraxa, Praetors\' Voice', deck: [] }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.result_code === 'success') return true;
      if (res.status === 403) return 'The relay turned this page away: its address is not in the relay\'s ALLOWED list.';
      return 'The relay answered, but not with suggestions (' + res.status + (body && body.result_code ? ', ' + body.result_code : '') + ').';
    } catch (e) {
      return 'The relay could not be reached from here. Check the address, and that the Worker is deployed.';
    }
  }

  MTG.recommander = {
    top, test, query,
    /** True when there is a relay to ask. */
    ready: () => !!relay(),
    get relay() { return relay(); },
    SITE: 'https://recommander.cards',
  };
})(window.MTG);
