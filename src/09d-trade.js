/* ============================================================
   09d-trade.js - the wishlist, and trading cards with a friend

   The wishlist is the cards you want, by name (the collection counts
   cards by name too). It is kept in the store ('wishlist') and marked
   from the card view and the collection (src/10h-ui-trade.js).

   A trade is between two friends on a proved line (src/09c-friends.js).
   The one who asks leads: the deal lives with them, the other side's
   changes go to them as requests, and they send the deal back after
   every change, numbered (rev). Each side shows the other its binder:
   the cards it owns, less any promised in a trade not yet finished, and
   how many of each its saved decks use.

   A deal is two halves, L (what the leader gives) and F (what the
   follower gives), each [[name, copies], ...]. Any change unconfirms
   both sides. When both have confirmed the same deal (the same rev, the
   same hash), it is carried out in two steps, so that a dropped line
   can neither half-finish it nor do it twice:

     1. the follower, on confirming, writes the deal into its journal
        ('trades'.pending, state 'confirmed');
     2. the leader, with both confirmations, writes it into its own
        journal ('prepared') and sends commit;
     3. the follower checks the commit against its journal, changes its
        collection, and says applied;
     4. the leader changes its own, and says done.

   A collection change is one write of the economy (src/10c-economy.js)
   that also notes the trade's id among those already carried out
   (economy.tradeIds), so a commit or an applied that arrives twice
   changes nothing the second time. If the line drops between the steps,
   the journal says what is owed: when the friend is next online the
   leader sends its commit again, and the follower asks how its
   confirmed trade stands. Cards promised in the journal are held back
   from every other trade until it is settled.

   Finished and failed trades go into a short history ('trades'.log).
   ============================================================ */
'use strict';
(function (MTG) {
  const FC = () => MTG.friendsCore;
  const E = () => MTG.economy;
  const PLAYSET = 4;
  const MAX_SIDE = 40;           // different cards on one side of a deal
  const MAX_BINDER = 30000;      // cards in a binder sent by the other side (every card there is, near enough)
  const MAX_WISH = 500;
  const ASK_WAIT = 60000;        // how long an asked friend has to say yes
  const CONFIRMED_DAYS = 14;     // a confirmation never committed is let go after this long
  const LOG_KEEP = 60;
  const RARITIES = new Set(['common', 'uncommon', 'rare', 'mythic']);

  const trade = MTG.trade = new MTG.Emitter();
  let hub = null;

  /* ---------------- checking ---------------- */
  /* A card's name is a key of the collection, so nothing an object
     already has (__proto__, constructor) may pass for one. */
  const cleanCardName = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 160 && !/[\u0000-\u001f]/.test(v) &&
    !v.startsWith('__') && !(v in Object.prototype) ? v : null);
  const cleanSet = (v) => (typeof v === 'string' && /^[a-z0-9]{2,8}$/.test(v) ? v : '');
  const cleanId = (v) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : '');
  const cleanRarity = (v) => (RARITIES.has(v) ? v : '');
  const isTradeId = (v) => typeof v === 'string' && /^[0-9a-f]{16,32}$/.test(v);
  const count = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const isBasic = (name) => (E() && E().isBasic ? E().isBasic(name) : false);

  /* ---------------- the wishlist ---------------- */
  function wishData() {
    const raw = MTG.store.get('wishlist', null);
    const list = raw && Array.isArray(raw.cards) ? raw.cards : [];
    return list.filter(c => c && cleanCardName(c.name));
  }
  function wishSave(list) {
    MTG.store.set('wishlist', { v: 1, cards: list.slice(-MAX_WISH) });
    if (MTG.bus) MTG.bus.emit('wishlist:changed');
  }
  const wish = trade.wish = {
    list: () => wishData().map(c => Object.assign({}, c)),
    names: () => new Set(wishData().map(c => c.name)),
    has: (name) => wishData().some(c => c.name === name),
    /** Want a card: { name, id, rarity, set } (a Scryfall card will do). */
    add(card) {
      const name = cleanCardName(card && card.name);
      if (!name || isBasic(name)) return false;
      const list = wishData().filter(c => c.name !== name);
      list.push({ name, id: cleanId(card.id), r: cleanRarity(card.rarity || card.r), s: cleanSet(card.set || card.s), at: Date.now() });
      wishSave(list);
      return true;
    },
    remove(name) {
      const list = wishData();
      const next = list.filter(c => c.name !== name);
      if (next.length !== list.length) wishSave(next);
      return next.length !== list.length;
    },
    toggle(card) { return wish.has(card && card.name) ? (wish.remove(card.name), false) : wish.add(card); },
  };

  /* ---------------- the journal and the log ---------------- */
  function book() {
    const raw = MTG.store.get('trades', null) || {};
    return {
      pending: Array.isArray(raw.pending) ? raw.pending.filter(p => p && isTradeId(p.id)) : [],
      log: Array.isArray(raw.log) ? raw.log.filter(Boolean) : [],
    };
  }
  function writeBook(b) {
    b.log = b.log.slice(-LOG_KEEP);
    MTG.store.set('trades', { v: 1, pending: b.pending, log: b.log });
    trade.emit('book');
  }
  function journal(entry) {
    const b = book();
    b.pending = b.pending.filter(p => p.id !== entry.id).concat([entry]);
    writeBook(b);
  }
  function unjournal(id) {
    const b = book();
    const before = b.pending.length;
    b.pending = b.pending.filter(p => p.id !== id);
    if (b.pending.length !== before) writeBook(b);
  }
  const pendingOf = (id) => book().pending.find(p => p.id === id) || null;
  function logTrade(entry) {
    const b = book();
    if (b.log.some(l => l.id === entry.id && l.state === entry.state)) return;
    b.log = b.log.filter(l => l.id !== entry.id).concat([entry]);
    b.pending = b.pending.filter(p => p.id !== entry.id);
    writeBook(b);
  }
  /** Copies of each card promised in trades not yet settled, other than `exceptId`. */
  function reserved(exceptId) {
    const out = new Map();
    for (const p of book().pending) {
      if (p.id === exceptId) continue;
      for (const g of p.give || []) out.set(g.name, (out.get(g.name) || 0) + (g.n || 0));
    }
    return out;
  }
  const doneIds = () => { const st = E().state; return Array.isArray(st.tradeIds) ? st.tradeIds : []; };

  /**
   * Carry out one side of a trade: `give` out of the collection, `get`
   * into it, and the trade's id noted, all in one write. Done already:
   * nothing changes. Returns { ok, again, shards }.
   */
  function applyTrade(id, give, get) {
    const eco = E();
    const st = eco.state;
    if (!Array.isArray(st.tradeIds)) st.tradeIds = [];
    if (st.tradeIds.includes(id)) return { ok: true, again: true, shards: 0 };
    const col = st.col;
    for (const g of give) {
      if (isBasic(g.name) || !Object.prototype.hasOwnProperty.call(col, g.name)) continue;
      const e = col[g.name];
      e.n = Math.max(0, (e.n || 0) - g.n);
      if (e.n <= 0) delete col[g.name];
    }
    const before = st.shards;
    for (const c of get) {
      if (isBasic(c.name)) continue;
      eco.addCard({ name: c.name, id: c.id || undefined, rarity: c.r || undefined, set: c.s || undefined }, c.n);
    }
    st.tradeIds.push(id);
    if (st.tradeIds.length > 300) st.tradeIds.splice(0, st.tradeIds.length - 300);
    eco.save();
    // a card you wanted, now yours, is off the wishlist; and a set may be complete
    const wanted = wish.names();
    for (const c of get) if (wanted.has(c.name)) wish.remove(c.name);
    if (MTG.progress && MTG.progress.checkSets) {
      try { MTG.progress.checkSets([...new Set(get.map(c => c.s).filter(Boolean))]); } catch (e) { /* only a reward */ }
    }
    return { ok: true, again: false, shards: st.shards - before };
  }

  /* ---------------- what your decks use ---------------- */
  /**
   * How many of each card your saved decks use: the most any one deck
   * uses (up to four), and which decks. `decks` is [{ name, cards: [[name, copies]] }].
   */
  function needsFromDecks(decks) {
    const out = new Map();
    for (const d of decks || []) {
      const per = new Map();
      for (const [name, q] of d.cards || []) if (name && !isBasic(name)) per.set(name, (per.get(name) || 0) + (q || 0));
      for (const [name, q] of per) {
        const e = out.get(name) || { n: 0, decks: [] };
        e.n = Math.max(e.n, Math.min(PLAYSET, q));
        e.decks.push({ name: d.name || 'A deck', n: Math.min(PLAYSET, q) });
        out.set(name, e);
      }
    }
    return out;
  }
  /** Your saved decks' needs, loading each deck (from the card cache, mostly); a deck that will not load is read by printing. */
  async function deckNeeds() {
    const D = MTG.decks;
    if (!D || !D.index) return new Map();
    const byPrint = new Map();
    const col = E().collection();
    for (const name of Object.keys(col)) for (const id of [col[name].id].concat(col[name].p || [])) if (id) byPrint.set(id, name);
    const timeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
    const decks = await Promise.all(D.index().map(async (meta) => {
      let full = null;
      try { full = await timeout(D.load(meta.id), 8000); } catch (e) { full = null; }
      const cards = [];
      if (full) {
        for (const e of (full.main || []).concat(full.sideboard || [])) if (e.card) cards.push([e.card.name, e.qty || 1]);
        for (const c of (full.commanders || []).concat(full.companion ? [full.companion] : [])) cards.push([c.name, 1]);
      } else {
        const slim = MTG.store.get('deck.' + meta.id, null);
        if (slim) {
          for (const e of (slim.main || []).concat(slim.side || [])) if (byPrint.has(e.id)) cards.push([byPrint.get(e.id), e.q || 1]);
          for (const id of (slim.cmd || []).concat(slim.comp ? [slim.comp] : [])) if (byPrint.has(id)) cards.push([byPrint.get(id), 1]);
        }
      }
      return { name: meta.name, cards };
    }));
    return needsFromDecks(decks);
  }

  /** Your binder: every card you could trade, less what other trades have promised. Map name -> entry. */
  function myBinder(needs, exceptId) {
    const col = E().collection();
    const held = reserved(exceptId);
    const out = new Map();
    for (const name of Object.keys(col)) {
      const e = col[name];
      const owned = Math.min(PLAYSET, e.n || 0);
      if (!owned || isBasic(name)) continue;
      const n = owned - (held.get(name) || 0);
      if (n <= 0) continue;
      const need = needs && needs.get(name);
      out.set(name, { name, n, owned, keep: need ? need.n : 0, decks: need ? need.decks : [], r: cleanRarity(e.r), s: cleanSet(e.s), id: cleanId(e.id) });
    }
    return out;
  }
  /** A binder as it arrives from a friend, checked; null when it is not one. */
  function readBinder(msg) {
    if (!Array.isArray(msg.cards) || msg.cards.length > MAX_BINDER) return null;
    const cards = new Map();
    for (const row of msg.cards) {
      if (!Array.isArray(row)) continue;
      const name = cleanCardName(row[0]);
      const n = count(row[1], 1, PLAYSET);
      if (!name || !n || cards.has(name) || isBasic(name)) continue;
      cards.set(name, { name, n, keep: count(row[2], 0, PLAYSET) || 0, r: cleanRarity(row[3]), s: cleanSet(row[4]), id: cleanId(row[5]) });
    }
    const wants = new Set();
    for (const w of Array.isArray(msg.wants) ? msg.wants.slice(0, MAX_WISH) : []) { const n = cleanCardName(w); if (n) wants.add(n); }
    return { cards, wants };
  }
  /** One half of a deal as it arrives: a Map name -> copies, or null. */
  function readHalf(v) {
    if (!Array.isArray(v) || v.length > MAX_SIDE) return null;
    const out = new Map();
    for (const row of v) {
      if (!Array.isArray(row)) return null;
      const name = cleanCardName(row[0]);
      const n = count(row[1], 1, PLAYSET);
      if (!name || !n || out.has(name)) return null;
      out.set(name, n);
    }
    return out;
  }
  const halfOut = (m) => [...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dealHash = (s) => FC().sha256(JSON.stringify({ id: s.id, rev: s.rev, L: halfOut(s.L), F: halfOut(s.F) })).slice(0, 32);

  /* ---------------- a trade in progress ----------------
     One at a time. `s.role` is 'leader' or 'follower'; `s.state` is
     'asking' (waiting for them to say yes), 'asked' (they asked us),
     'open', 'committing', 'done' or 'closed'. */
  let live = null;
  const isLive = (s) => !!s && s === live && s.state !== 'done' && s.state !== 'closed';
  const giveHalf = (s) => (s.role === 'leader' ? 'L' : 'F');
  const getHalf = (s) => (s.role === 'leader' ? 'F' : 'L');
  const send = (s, msg) => !!hub && hub.sendTrade(s.code, Object.assign({ id: s.id }, msg));
  const changed = (s) => trade.emit('update', s);

  function newSession(code, role, id) {
    return {
      id, code, role, state: role === 'leader' ? 'asking' : 'asked', name: hub ? hub.nameOf(code) : code,
      rev: 0, L: new Map(), F: new Map(), okL: false, okF: false,
      mine: new Map(), theirs: new Map(), theirWants: new Set(), needs: null, why: '', result: null,
      startedAt: Date.now(), timer: null,
    };
  }
  /**
   * End a session. A confirmation in the journal goes with it, unless the
   * line only dropped (`keep`): then the leader may have committed it, and
   * the two sides settle it when they next meet.
   */
  function close(s, why, tell, keep) {
    if (!s || s.state === 'done' || s.state === 'closed') return;
    if (tell) send(s, { op: 'no', why: tell });
    clearTimeout(s.timer);
    s.state = 'closed';
    s.why = why || '';
    const p = pendingOf(s.id);
    if (!keep && p && p.role === 'follower' && p.state === 'confirmed') unjournal(s.id);
    changed(s);
    trade.emit('closed', s);
  }
  /** Your binder as it is this moment (a pack may have been opened). */
  function refreshMine(s) { s.mine = myBinder(s.needs, s.id); }

  /** Ask a friend to trade. Returns the session, or { why }. */
  function start(code) {
    if (!hub || !hub.isOnline(code)) return { why: 'They need to be online to trade.' };
    // a trade waiting on a friend who went offline is in the journal, and does not stop another
    const waiting = isLive(live) && live.state === 'committing' && !hub.isOnline(live.code);
    if (isLive(live) && !waiting) return { why: live.code === code ? 'You are already trading with them.' : 'Finish the trade you have open first.' };
    if (book().pending.some(p => p.code === code)) return { why: 'A trade with them is still being finished. It completes when you are both online.' };
    const s = live = newSession(code, 'leader', FC().randomHex(24));
    if (!send(s, { op: 'ask' })) { live = null; return { why: 'They could not be reached.' }; }
    s.timer = setTimeout(() => { if (s.state === 'asking') close(s, 'They did not answer.', 'timeout'); }, ASK_WAIT);
    changed(s);
    return s;
  }
  /** Say yes or no to a friend who asked. */
  function answer(s, yes) {
    if (!isLive(s) || s.state !== 'asked') return false;
    clearTimeout(s.timer);
    if (!yes) { close(s, 'You said no thanks.', 'declined'); return true; }
    s.state = 'open';
    send(s, { op: 'open' });
    shareBinder(s);
    changed(s);
    return true;
  }
  function cancel(s) {
    if (!isLive(s) || s.state === 'committing') return false;
    close(s, 'You closed the trade.', 'cancelled');
    return true;
  }

  async function shareBinder(s) {
    if (!s.needs) {
      s.needs = new Map();
      try { s.needs = await deckNeeds(); } catch (e) { /* no warnings, then */ }
    }
    if (!isLive(s)) return;
    s.mine = myBinder(s.needs, s.id);
    const cards = [...s.mine.values()].map(c => [c.name, c.n, c.keep, c.r, c.s, c.id]);
    send(s, { op: 'binder', cards, wants: [...wish.names()] });
    changed(s);
  }

  /* ---- the deal: the leader keeps it ---- */
  /** Who gives in a half: 'L' is the leader's cards, 'F' the follower's. The binder a half is drawn from, as this side sees it. */
  const binderFor = (s, half) => ((half === 'L') === (s.role === 'leader') ? s.mine : s.theirs);
  function setHalf(s, half, name, n) {
    if (half === giveHalf(s)) refreshMine(s);
    const from = binderFor(s, half);
    const have = from.get(name);
    const map = s[half];
    if (!n) { if (!map.has(name)) return false; map.delete(name); }
    else {
      if (!have || !Number.isInteger(n) || n < 0 || n > have.n) return false;
      if (!map.has(name) && map.size >= MAX_SIDE) return false;
      if (map.get(name) === n) return false;
      map.set(name, n);
    }
    s.rev++;
    s.okL = false; s.okF = false;
    shareDeal(s);
    return true;
  }
  function shareDeal(s) {
    send(s, { op: 'deal', rev: s.rev, L: halfOut(s.L), F: halfOut(s.F), okL: s.okL, okF: s.okF });
    changed(s);
  }
  /**
   * Change how many of a card are in the deal. `side` is 'give' (your
   * card to them) or 'get' (theirs to you); `n` the copies (0 takes it out).
   */
  function setCount(s, side, name, n) {
    if (!isLive(s) || s.state !== 'open') return false;
    n = Math.max(0, Math.floor(n || 0));
    const half = side === 'give' ? giveHalf(s) : getHalf(s);
    if (s.role === 'leader') return setHalf(s, half, name, n);
    // the follower asks the leader, and waits for the deal to come back
    if (n && !binderFor(s, half).has(name)) return false;
    return send(s, { op: 'edit', side, name, n });
  }

  /** What is wrong with the deal as it stands, from this side; '' when nothing. */
  function problems(s) {
    if (!s.L.size && !s.F.size) return 'Nothing is in the trade yet.';
    for (const half of ['L', 'F']) {
      const from = binderFor(s, half);
      const mineSide = half === giveHalf(s);
      for (const [name, n] of s[half]) {
        const have = from.get(name);
        if (!have || have.n < n) return mineSide ? `You no longer have ${n} of ${name} to give.` : `${s.name} no longer has ${n} of ${name}.`;
      }
    }
    return '';
  }
  /** The cards you give that your decks use: [{ name, n, owned, keep, decks }]. */
  function deckWarnings(s) {
    const out = [];
    for (const [name, n] of s[giveHalf(s)]) {
      const have = s.mine.get(name);
      if (!have || !have.keep) continue;
      const left = have.owned - n;
      if (left < have.keep) out.push({ name, n, owned: have.owned, keep: have.keep, left, decks: have.decks || [] });
    }
    return out;
  }
  /** The journal entry for this side of a deal: what goes and what comes, with the details to file what comes. */
  function entryFor(s, state) {
    const give = halfOut(s[giveHalf(s)]).map(([name, n]) => ({ name, n }));
    const get = halfOut(s[getHalf(s)]).map(([name, n]) => {
      const c = s.theirs.get(name) || {};
      return { name, n, r: c.r || '', s: c.s || '', id: c.id || '' };
    });
    return { id: s.id, code: s.code, name: s.name, role: s.role, h: dealHash(s), rev: s.rev, give, get, state, at: Date.now() };
  }

  /** Confirm the deal as it stands. Returns '' or what is wrong. */
  function confirm(s) {
    if (!isLive(s) || s.state !== 'open') return 'The trade is not open.';
    refreshMine(s);
    const bad = problems(s);
    if (bad) return bad;
    if (s.role === 'follower') {
      if (s.okF) return '';
      journal(entryFor(s, 'confirmed'));
      s.okF = true;
      send(s, { op: 'confirm', rev: s.rev, h: dealHash(s) });
      changed(s);
      return '';
    }
    s.okL = true;
    shareDeal(s);
    if (s.okF) commit(s);
    return '';
  }
  function unconfirm(s) {
    if (!isLive(s) || s.state !== 'open') return false;
    if (s.role === 'follower') {
      if (!s.okF) return false;
      unjournal(s.id);
      s.okF = false;
      send(s, { op: 'unconfirm', rev: s.rev });
      changed(s);
      return true;
    }
    if (!s.okL) return false;
    s.okL = false;
    shareDeal(s);
    return true;
  }
  /** The leader, both confirmed: into the journal, and the commit out. */
  function commit(s) {
    refreshMine(s);
    const bad = problems(s);
    if (bad) { s.okL = false; s.okF = false; s.rev++; shareDeal(s); trade.emit('note', s, bad); return; }
    journal(entryFor(s, 'prepared'));
    s.state = 'committing';
    send(s, { op: 'commit', h: dealHash(s) });
    changed(s);
  }

  /* ---------------- what arrives ---------------- */
  function onMessage(code, msg) {
    if (!msg || typeof msg.op !== 'string' || !isTradeId(msg.id)) return;
    const s = live && live.id === msg.id && live.code === code && live.state !== 'closed' ? live : null;
    switch (msg.op) {
      case 'ask': return gotAsk(code, msg);
      case 'no': {
        if (s && s.state === 'committing') s.theyLeft = true;         // the commit is out: its answer decides
        else if (s && s.state !== 'done') {
          const n = s.name;
          close(s, msg.why === 'busy' ? `${n} is in another trade just now.` : msg.why === 'declined' ? `${n} said no thanks.`
            : msg.why === 'timeout' ? (s.role === 'leader' ? `${n} did not answer in time.` : 'The request to trade ran out.')
              : `${n} closed the trade.`);
        }
        // the leader knows nothing of a trade we confirmed: let it go
        const p = pendingOf(msg.id);
        if (p && p.code === code && p.role === 'follower' && p.state === 'confirmed') unjournal(msg.id);
        return;
      }
      case 'open':
        if (s && s.role === 'leader' && s.state === 'asking') {
          clearTimeout(s.timer);
          s.state = 'open';
          shareBinder(s);
          shareDeal(s);
        }
        return;
      case 'binder': {
        if (!s || (s.state !== 'open' && s.state !== 'committing')) return;
        const b = readBinder(msg);
        if (!b) return;
        s.theirs = b.cards;
        s.theirWants = b.wants;
        changed(s);
        return;
      }
      case 'edit': {
        if (!s || s.role !== 'leader' || s.state !== 'open') return;
        const name = cleanCardName(msg.name);
        const n = count(msg.n, 0, PLAYSET);
        if (!name || n == null || (msg.side !== 'give' && msg.side !== 'get')) return;
        // their 'give' is the follower's half; their 'get' is ours. Refused: the deal as it is, so they see it
        if (!setHalf(s, msg.side === 'give' ? 'F' : 'L', name, n)) shareDeal(s);
        return;
      }
      case 'deal': {
        if (!s || s.role !== 'follower' || s.state !== 'open') return;
        const L = readHalf(msg.L), F = readHalf(msg.F);
        const rev = count(msg.rev, 0, 1e9);
        if (!L || !F || rev == null || rev < s.rev) return;
        // a changed deal: whatever we confirmed was another one
        if (rev !== s.rev && pendingOf(s.id)) unjournal(s.id);
        s.rev = rev; s.L = L; s.F = F;
        s.okL = msg.okL === true;
        const p = pendingOf(s.id);
        s.okF = !!(p && p.rev === rev && p.h === dealHash(s));
        changed(s);
        return;
      }
      case 'confirm':
        if (!s || s.role !== 'leader' || s.state !== 'open') return;
        if (msg.rev !== s.rev || msg.h !== dealHash(s)) return;      // an older deal: they will see the new one
        s.okF = true;
        shareDeal(s);
        if (s.okL) commit(s);
        return;
      case 'unconfirm':
        if (!s || s.role !== 'leader' || s.state !== 'open' || !s.okF) return;
        s.okF = false;
        shareDeal(s);
        return;
      case 'commit': return gotCommit(code, msg, s);
      case 'applied': return gotApplied(code, msg, s);
      case 'abort': {
        const p = pendingOf(msg.id);
        if (!p || p.code !== code || p.role !== 'leader') return;
        const why = msg.why === 'gone' ? `${p.name || 'They'} no longer had the cards.` : 'They had not confirmed that deal.';
        unjournal(msg.id);
        logTrade({ id: p.id, code, name: p.name, at: Date.now(), gave: [], got: [], state: 'failed', why });
        if (s && s.state === 'committing') {
          if (s.theyLeft) { close(s, `${s.name} closed the trade before it went through. Nothing changed.`); return; }
          // back to the table: nothing moved, and they can confirm again
          s.state = 'open';
          s.okL = false; s.okF = false; s.rev++;
          shareDeal(s);
          trade.emit('note', s, 'The trade did not go through: ' + why[0].toLowerCase() + why.slice(1));
        }
        return;
      }
      case 'done':
        // the leader's last word: the follower finished when it carried out its side
        return;
      case 'status': {
        // the follower asks after a trade it confirmed: commit if we prepared it, else let it go
        const p = pendingOf(msg.id);
        if (p && p.code === code && p.role === 'leader' && p.state === 'prepared') hub.sendTrade(code, { op: 'commit', id: p.id, h: p.h });
        else if (!doneIds().includes(msg.id)) hub.sendTrade(code, { op: 'no', id: msg.id, why: 'unknown' });
        return;
      }
      default:
    }
  }
  function gotAsk(code, msg) {
    if (isLive(live) || book().pending.some(p => p.code === code && (p.state === 'prepared' || p.state === 'confirmed'))) {
      hub.sendTrade(code, { op: 'no', id: msg.id, why: 'busy' });
      return;
    }
    const s = live = newSession(code, 'follower', msg.id);
    s.timer = setTimeout(() => { if (s.state === 'asked') close(s, 'The request to trade ran out.', 'timeout'); }, ASK_WAIT);
    changed(s);
    trade.emit('ask', s);
  }
  /** The follower: the leader says go. */
  function gotCommit(code, msg, s) {
    if (doneIds().includes(msg.id)) { hub.sendTrade(code, { op: 'applied', id: msg.id, h: msg.h }); return; }
    const p = pendingOf(msg.id);
    if (!p || p.code !== code || p.role !== 'follower' || p.state !== 'confirmed' || p.h !== msg.h) {
      hub.sendTrade(code, { op: 'abort', id: msg.id, why: 'unconfirmed' });
      return;
    }
    // still yours to give? (nothing else may take them while the journal holds them, but a save may have been loaded since)
    const held = reserved(p.id);
    for (const g of p.give) {
      if ((E().owned(g.name) || 0) - (held.get(g.name) || 0) < g.n) {
        unjournal(p.id);
        logTrade({ id: p.id, code, name: p.name, at: Date.now(), gave: [], got: [], state: 'failed', why: `You no longer had ${g.n} of ${g.name}.` });
        hub.sendTrade(code, { op: 'abort', id: p.id, why: 'gone' });
        if (s) close(s, `It could not be done: you no longer had ${g.n} of ${g.name}.`);
        return;
      }
    }
    const res = applyTrade(p.id, p.give, p.get);
    const entry = { id: p.id, code, name: p.name, at: Date.now(), gave: p.give, got: p.get.map(c => ({ name: c.name, n: c.n })), state: 'done', shards: res.shards || 0 };
    logTrade(entry);
    hub.sendTrade(code, { op: 'applied', id: p.id, h: p.h });
    if (s) finish(s, entry);
    else trade.emit('finished', entry);
  }
  /** The leader: the follower has done its side. */
  function gotApplied(code, msg, s) {
    if (doneIds().includes(msg.id)) { hub.sendTrade(code, { op: 'done', id: msg.id }); return; }
    const p = pendingOf(msg.id);
    if (!p || p.code !== code || p.role !== 'leader' || p.state !== 'prepared' || p.h !== msg.h) return;
    const res = applyTrade(p.id, p.give, p.get);
    const entry = { id: p.id, code, name: p.name, at: Date.now(), gave: p.give, got: p.get.map(c => ({ name: c.name, n: c.n })), state: 'done', shards: res.shards || 0 };
    logTrade(entry);
    hub.sendTrade(code, { op: 'done', id: p.id });
    if (s) finish(s, entry);
    else trade.emit('finished', entry);
  }
  function finish(s, entry) {
    clearTimeout(s.timer);
    s.state = 'done';
    s.result = entry;
    changed(s);
    trade.emit('finished', entry, s);
  }

  /** A friend back online: settle whatever the journal says is owed between us. */
  function settle(code) {
    const b = book();
    const t = Date.now();
    let dropped = false;
    for (const p of b.pending) {
      if (p.code !== code) continue;
      if (p.role === 'leader' && p.state === 'prepared') hub.sendTrade(code, { op: 'commit', id: p.id, h: p.h });
      if (p.role === 'follower' && p.state === 'confirmed' && !(live && live.id === p.id)) hub.sendTrade(code, { op: 'status', id: p.id });
    }
    // confirmations nobody ever came back for
    b.pending = b.pending.filter((p) => {
      const stale = p.role === 'follower' && p.state === 'confirmed' && t - (p.at || 0) > CONFIRMED_DAYS * 864e5 && !(live && live.id === p.id);
      if (stale) dropped = true;
      return !stale;
    });
    if (dropped) writeBook(b);
  }
  function offline(code) {
    const s = live;
    if (!isLive(s) || s.code !== code) return;
    if (s.state === 'committing') { trade.emit('note', s, `${s.name} went offline. The trade finishes when you are both online again.`); return; }
    const confirmedBoth = s.role === 'follower' && s.okF && s.okL;
    close(s, confirmedBoth ? `${s.name} went offline. If they had already sent the trade through, it finishes when you are both online again.`
      : `${s.name} went offline.`, null, true);
  }

  /** Hook the trade up to a friends hub (MTG.friends, or a test's). */
  function attach(h) {
    hub = h;
    h.on('trade', (code, msg) => { try { onMessage(code, msg); } catch (e) { console.warn('[trade] a message could not be read', e); } });
    h.on('online', (code) => settle(code));
    h.on('offline', (code) => offline(code));
    // your collection changed while trading (a pack opened): show them the binder as it is now
    if (MTG.bus) {
      let t = null;
      MTG.bus.on('economy:changed', () => {
        if (!isLive(live) || live.state !== 'open') return;
        clearTimeout(t);
        t = setTimeout(() => { if (isLive(live) && live.state === 'open') shareBinder(live); }, 800);
      });
    }
  }

  Object.assign(trade, {
    attach, start, answer, cancel, setCount, confirm, unconfirm, problems, deckWarnings,
    current: () => (isLive(live) ? live : null),
    session: () => live,
    give: (s) => s[giveHalf(s)],
    get: (s) => s[getHalf(s)],
    iConfirmed: (s) => (s.role === 'leader' ? s.okL : s.okF),
    theyConfirmed: (s) => (s.role === 'leader' ? s.okF : s.okL),
    pending: () => book().pending.map(p => Object.assign({}, p)),
    log: () => book().log.slice().reverse(),
    // the pieces tools/socialtest.js checks on their own
    needsFromDecks, myBinder, readBinder, readHalf, applyTrade, reserved, dealHash, deckNeeds,
  });
})(window.MTG);
