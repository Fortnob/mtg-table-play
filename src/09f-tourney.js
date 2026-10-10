/* ============================================================
   09f-tourney.js - friends tournaments: Swiss rounds among friends

   A tournament is run by one player, the organiser, for friends of
   theirs, over the proved lines of src/09c-friends.js. The organiser's
   copy is the one that counts: it invites, pairs each round, settles the
   results, and sends everyone the whole tournament after every change,
   numbered (rev). Each player keeps a mirror of the last copy it was
   sent. Both are kept in the store, so the app can be closed and opened
   again mid-tournament on either side.

   The players need only be friends of the organiser, not of each other,
   so everything goes by way of the organiser:

     organiser -> player   state  the tournament as it stands (to someone
                                  marked invited, it is the invitation)
                           gone   you are not in it (any more)
     player -> organiser   yes / no   the answer to an invitation
                           report     a match's result, as this player saw it
                           room       the table for this round's match is open
                           drop       out of the tournament from here on
                           sync       send me the tournament again

   What a player sends while the organiser is away is kept (pend) and
   sent again when the organiser is back.

   Pairing is Swiss. Round one is at random; later rounds go by match
   points, a points group in no particular order, avoiding rematches
   wherever the pairings allow. With an odd number left, the lowest
   placed player without a bye has one, which counts as a match won 2-0.
   Standings are match points (3 a win, 1 a draw), then OMW%, GW% and
   OGW%, each with the floor of a third (the Magic Tournament Rules,
   appendix C), then the order seats were drawn in.

   Each match is played at an ordinary table: one of the two hosts a room
   (the higher placed, normally) and the other joins. When the match ends
   both apps report the result to the organiser by themselves (the table
   is watched by src/10i-ui-tourney.js); two reports that agree settle it,
   and anything else waits for the organiser, who can always set a result
   by hand. A round with every result in is followed straight away by the
   next round's pairings, or after the last, by the final standings.

   Bots can fill seats. A bot lives in the organiser's copy like anyone
   else, under an id no friend code can be (bot- and eight hex digits),
   with a level and a style from the lobby's scale (src/08-bots.js). A
   person paired with a bot plays it on their own device and reports; a
   bot cannot report, so that one report settles it. Two bots paired
   together are settled on the organiser's device as the round is paired
   (botMatch, below), so a tournament of the organiser and bots runs with
   nobody else online. Bots are never dropped.

   Friends can be invited after the tournament is set up: before it
   starts, into any seat left (a bot giving up its seat if need be); once
   it is under way, to come in from the next round. A late entrant has a
   match lost 0-2 for each round already paired when they came in, as the
   Magic Tournament Rules treat a player added late: no points, those
   rounds counted in their own match-win and game-win percentages, and no
   opponent for anyone in them.

   The store ('tourneys'): { v, list: [tournament] }. A tournament is
     { id, org, name, fmt, bo, rounds, state, at, done, rev,
       players: [{ code, name, st, seed, late, bot }],
       rnds: [{ pairs: [{ t, a, b, res, by, rep, room }] }] }
   with, kept here only: role ('org', ours; 'player', a mirror), pend
   (what we still have to tell the organiser) and hint (rooms heard of
   from a friend's own invite). state: 'inviting', 'running', 'done',
   'cancelled'; st: 'invited', 'in', 'declined', 'dropped'. late: the
   rounds missed, for a late entrant. bot: { lvl, style } for a bot. A
   pair's a and b are player codes (b null for a bye), res is its result
   as games { a, b, d } (a's wins, b's wins, drawn games), by says how it
   was settled ('agreed', 'org', 'drop', 'bye', 'bot': one report against
   a bot, 'sim': two bots), rep holds each person's report.
   ============================================================ */
'use strict';
(function (MTG) {
  const FC = () => MTG.friendsCore;
  const MIN_PLAYERS = 3, MAX_PLAYERS = 16;     // seats, bots included
  const MAX_ENTRIES = 32;       // players listed, those who said no included
  const MAX_ROUNDS = 8;
  const MAX_ORGANISED = 2;      // tournaments of ours not yet over
  const MAX_ACTIVE = 8;         // tournaments not yet over, ours and others'
  const MAX_INVITES = 8;        // invitations waiting for an answer
  const MAX_FROM_ONE = 2;       // of those, from any one friend
  const MAX_DONE = 12;          // finished ones kept, to look back at
  const INVITE_DAYS = 7;        // an invitation nobody answered is let go after this long
  const FLOOR = 1 / 3;
  const REMATCH = 1e6;          // what a rematch costs a pairing (a point of difference squared costs 1)
  const SEARCH_STEPS = 60000;   // how hard a pairing is looked for before the best so far is taken
  const FLOOD_MAX = 120, FLOOD_MS = 10000;  // messages from one friend in that long, at most (a busy round sends a few dozen)
  const STATES = new Set(['inviting', 'running', 'done', 'cancelled']);
  const PSTATES = new Set(['invited', 'in', 'declined', 'dropped']);
  const BY = new Set(['agreed', 'org', 'drop', 'bot', 'sim']);
  const MAX_LEVEL = 10;         // the lobby's bot levels run 1 to 10

  const tourney = MTG.tourney = new MTG.Emitter();
  let hub = null;
  let frozen = false;           // a save is being loaded underneath: write nothing more
  const now = () => Date.now();

  /* ---------------- checking ---------------- */
  const isId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
  const isCode = (v) => FC().isCode(v);
  /** A bot's id: never a friend code (those are capitals and digits, without a dash). */
  const isBot = (v) => typeof v === 'string' && /^bot-[0-9a-f]{8}$/.test(v);
  /** A bot's style: one of the lobby's, or '' (any); where the bots are not loaded (a test), any short word. */
  function cleanStyle(v) {
    if (typeof v !== 'string' || !/^[a-z]{0,20}$/.test(v)) return null;
    const P = MTG.bots && MTG.bots.PERSONALITIES;
    return !v || !P || Object.prototype.hasOwnProperty.call(P, v) ? v : null;
  }
  /** What a bot is, from the wire: { lvl, style }, or null. */
  function cleanBot(v) {
    if (!v || typeof v !== 'object') return null;
    const lvl = int(v.lvl, 1, MAX_LEVEL), style = cleanStyle(v.style == null ? '' : v.style);
    return lvl && style != null ? { lvl, style } : null;
  }
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const stamp = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  /** A tournament's name: one line of plain text, not too long. */
  function cleanTitle(v) {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  /** A format a tournament can be played in: a constructed one this app knows. */
  function cleanFmt(v) {
    if (typeof v !== 'string' || !/^[a-z0-9]{2,20}$/.test(v)) return null;
    const F = MTG.formats;
    const f = F && F.get ? F.get(v) : null;
    return f && f.kind !== 'limited' ? v : null;
  }
  /** Games a player has to win to take a match of best-of-`bo`. */
  const need = (bo) => Math.ceil(bo / 2);
  /** A match's result in games, { a, b, d }, if a best-of-`bo` match could end that way; else null. */
  function cleanResult(r, bo) {
    if (!r || typeof r !== 'object') return null;
    const a = int(r.a, 0, 9), b = int(r.b, 0, 9), d = int(r.d, 0, 9);
    if (a == null || b == null || d == null) return null;
    const n = need(bo);
    if (a > n || b > n || (a === n && b === n) || a + b + d > bo) return null;
    return { a, b, d };
  }
  const BYE_RESULT = () => ({ a: 2, b: 0, d: 0 });
  const sameResult = (x, y) => !!x && !!y && x.a === y.a && x.b === y.b && x.d === y.d;
  /** A result turned round, for the other player. */
  const flip = (r) => ({ a: r.b, b: r.a, d: r.d });

  /**
   * A tournament as it arrives, from the organiser or from the store:
   * checked through, or null. Nothing in it is trusted: every code must
   * be one of its players, every result one a match could have.
   */
  function readT(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = isId(raw.id) ? raw.id : null;
    const org = isCode(raw.org) ? raw.org : null;
    const fmt = cleanFmt(raw.fmt);
    const bo = raw.bo === 1 || raw.bo === 3 ? raw.bo : null;
    const rounds = int(raw.rounds, 0, MAX_ROUNDS);
    const state = STATES.has(raw.state) ? raw.state : null;
    if (!id || !org || !fmt || !bo || rounds == null || !state) return null;
    if (!Array.isArray(raw.players) || !raw.players.length || raw.players.length > MAX_ENTRIES) return null;
    const players = [];
    const codes = new Set();
    for (const p of raw.players) {
      if (!p || typeof p !== 'object' || codes.has(p.code) || !PSTATES.has(p.st)) return null;
      const bot = isBot(p.code);
      // a bot is a bot by its id, and has a level; it is always in (bots never drop, and are never invited)
      if (!bot && !isCode(p.code)) return null;
      if (bot !== (p.bot != null) || (bot && (!cleanBot(p.bot) || p.st !== 'in'))) return null;
      codes.add(p.code);
      const seed = int(p.seed, 0, 99);
      const entry = { code: p.code, name: FC().cleanName(p.name) || (bot ? 'Bot' : FC().formatCode(p.code)), st: p.st, seed: seed == null ? players.length : seed };
      const late = int(p.late, 1, MAX_ROUNDS);
      if (late && !bot) entry.late = late;
      if (bot) entry.bot = cleanBot(p.bot);
      players.push(entry);
    }
    if (!codes.has(org) || isBot(org)) return null;
    if (players.filter(p => p.st !== 'declined').length > MAX_PLAYERS) return null;
    // who can sit at a table: whoever is in, or was until they dropped
    const seatable = new Set(players.filter(p => p.st === 'in' || p.st === 'dropped').map(p => p.code));
    const list = Array.isArray(raw.rnds) ? raw.rnds : [];
    if (list.length > MAX_ROUNDS || (state === 'inviting' && list.length)) return null;
    const rnds = [];
    for (const r of list) {
      if (!r || !Array.isArray(r.pairs) || !r.pairs.length || r.pairs.length > MAX_PLAYERS / 2) return null;
      const seated = new Set();
      const pairs = [];
      for (const p of r.pairs) {
        if (!p || typeof p !== 'object') return null;
        const a = seatable.has(p.a) ? p.a : null;
        const b = p.b == null ? null : seatable.has(p.b) ? p.b : undefined;
        const t = int(p.t, 1, MAX_PLAYERS);
        if (!a || b === undefined || a === b || seated.has(a) || (b && seated.has(b)) || t == null || pairs.some(x => x.t === t)) return null;
        seated.add(a);
        if (b) seated.add(b);
        let res = null, by = null;
        if (!b) { res = BYE_RESULT(); by = 'bye'; }
        else if (p.res != null) {
          res = cleanResult(p.res, bo);
          if (!res) return null;
          by = BY.has(p.by) ? p.by : 'org';
        }
        const rep = {};
        if (b && p.rep && typeof p.rep === 'object') {
          for (const c of [a, b]) {
            // a bot never reports
            if (isBot(c) || !Object.prototype.hasOwnProperty.call(p.rep, c)) continue;
            const x = cleanResult(p.rep[c], bo);
            if (x) rep[c] = x;
          }
        }
        // a match with a bot in it is played on one device: it has no room
        pairs.push({ t, a, b, res, by, rep, room: b && !isBot(a) && !isBot(b) ? FC().cleanRoom(p.room) : null });
      }
      rnds.push({ pairs });
    }
    return {
      v: 1, id, org, name: cleanTitle(raw.name) || 'Tournament', fmt, bo, rounds, state,
      at: stamp(raw.at), done: stamp(raw.done), rev: int(raw.rev, 0, 1e9) || 0, players, rnds,
    };
  }
  /** What goes over the line: the tournament, without what is kept here only. */
  function pub(t) {
    return {
      v: 1, id: t.id, org: t.org, name: t.name, fmt: t.fmt, bo: t.bo, rounds: t.rounds, state: t.state,
      at: t.at, done: t.done, rev: t.rev, players: t.players, rnds: t.rnds,
    };
  }
  function readPend(v) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    if (v.yes === true) out.yes = true;
    if (v.drop === true) out.drop = true;
    if (v.rep && typeof v.rep === 'object') {
      const r = v.rep;
      if (int(r.r, 1, MAX_ROUNDS) && int(r.tb, 1, MAX_PLAYERS) && [r.w, r.l, r.d].every(x => int(x, 0, 9) != null)) out.rep = { r: r.r, tb: r.tb, w: r.w, l: r.l, d: r.d };
    }
    if (v.room && typeof v.room === 'object' && int(v.room.r, 1, MAX_ROUNDS) && int(v.room.tb, 1, MAX_PLAYERS) && FC().cleanRoom(v.room.room)) {
      out.room = { r: v.room.r, tb: v.room.tb, room: FC().cleanRoom(v.room.room) };
    }
    return out;
  }
  function readHint(v) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    for (const k of Object.keys(v).slice(0, 20)) if (/^\d{1,2}:\d{1,2}$/.test(k) && FC().cleanRoom(v[k])) out[k] = FC().cleanRoom(v[k]);
    return out;
  }

  /* ---------------- the store ---------------- */
  let list = null;
  function load() {
    if (list) return list;
    list = [];
    const raw = MTG.store.get('tourneys', null);
    for (const x of (raw && Array.isArray(raw.list) ? raw.list : [])) {
      const t = readT(x);
      if (!t || list.some(y => y.id === t.id)) continue;
      t.role = x.role === 'org' ? 'org' : 'player';
      t.pend = readPend(x.pend);
      t.hint = readHint(x.hint);
      list.push(t);
    }
    prune();
    return list;
  }
  /** Old invitations go, and the history keeps its last few. */
  function prune() {
    const t0 = now();
    list = list.filter(t => !(isInvite(t) && t0 - (t.at || 0) > INVITE_DAYS * 864e5));
    const over = list.filter(t => t.state === 'done' || t.state === 'cancelled').sort((x, y) => (y.done || y.at) - (x.done || x.at));
    const drop = new Set(over.slice(MAX_DONE).map(t => t.id));
    if (drop.size) list = list.filter(t => !drop.has(t.id));
  }
  function save() {
    prune();
    if (!frozen) MTG.store.set('tourneys', { v: 1, list });
  }
  const byId = (id) => load().find(t => t.id === id) || null;
  const myCode = () => (hub ? hub.code : '');
  const meOf = (t) => t.players.find(p => p.code === myCode()) || null;
  const isOver = (t) => t.state === 'done' || t.state === 'cancelled';
  /** An invitation to answer: to a tournament not yet started, or one under way (to come in late). */
  const isInvite = (t) => t.role === 'player' && !isOver(t) && (t.players.find(p => p.code === myCode()) || {}).st === 'invited';
  /** Seats taken: everyone in, invited or dropped (a dropped player stays in the standings), bots included. */
  const seatsTaken = (t) => t.players.filter(p => p.st !== 'declined').length;
  const nameOf = (t, code) => (t.players.find(p => p.code === code) || {}).name || FC().formatCode(code);
  /** The pair `code` is in, in round `r` (1-based), or null. */
  const pairOf = (t, r, code) => ((t.rnds[r - 1] || { pairs: [] }).pairs.find(p => p.a === code || p.b === code) || null);
  /** The room a pair plays in: as the organiser has it, or as heard straight from the friend or the table. */
  const roomOf = (t, r, p) => (p && (p.room || (t.hint || {})[r + ':' + p.t])) || null;
  /** Every room a pair's match may be at: the organiser's, and one heard of here (the two can differ, if the host opened another). */
  const roomsOf = (t, r, p) => (p ? [p.room, (t.hint || {})[r + ':' + p.t]].filter(Boolean) : []);
  const disputed = (p) => !p.res && !!p.b && !!p.rep[p.a] && !!p.rep[p.b] && !sameResult(p.rep[p.a], p.rep[p.b]);
  function changed(t) { tourney.emit('change', t); }

  /* ---------------- Swiss: standings ---------------- */
  /**
   * The standings, best first: [{ code, name, st, seed, bot, late, rank,
   * mp, w, l, d, gw, gl, gd, rounds, byes, opps, mwp, gwp, omw, ogw }], of
   * everyone who is or was playing. Only settled matches count. A bye is a
   * match won 2-0 for the player's own record, and is left out of
   * everybody's opponents; so is each round a late entrant missed, which
   * is a match lost 0-2.
   */
  function standings(t) {
    const rec = new Map();
    for (const p of t.players) {
      if (p.st !== 'in' && p.st !== 'dropped') continue;
      const late = p.late || 0;
      rec.set(p.code, { code: p.code, name: p.name, st: p.st, seed: p.seed, bot: p.bot || null, late,
        mp: 0, w: 0, l: late, d: 0, gw: 0, gl: 2 * late, gd: 0, rounds: late, byes: 0, opps: [] });
    }
    for (const r of t.rnds) {
      for (const p of r.pairs) {
        const A = rec.get(p.a);
        if (!p.res || !A) continue;
        A.rounds++;
        if (!p.b) { A.byes++; A.w++; A.mp += 3; A.gw += 2; continue; }
        const B = rec.get(p.b);
        if (!B) continue;
        B.rounds++;
        const { a, b, d } = p.res;
        A.gw += a; A.gl += b; A.gd += d;
        B.gw += b; B.gl += a; B.gd += d;
        A.opps.push(p.b); B.opps.push(p.a);
        if (a > b) { A.w++; A.mp += 3; B.l++; } else if (b > a) { B.w++; B.mp += 3; A.l++; } else { A.d++; B.d++; A.mp++; B.mp++; }
      }
    }
    // each with the floor of a third, as an opponent's figures are counted
    const mwp = (x) => (x.rounds ? Math.max(FLOOR, x.mp / (3 * x.rounds)) : FLOOR);
    const gwp = (x) => { const g = x.gw + x.gl + x.gd; return g ? Math.max(FLOOR, (3 * x.gw + x.gd) / (3 * g)) : FLOOR; };
    const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
    const rows = [...rec.values()];
    for (const x of rows) {
      const opp = x.opps.map(c => rec.get(c));
      x.mwp = mwp(x);
      x.gwp = gwp(x);
      x.omw = avg(opp.map(mwp));
      x.ogw = avg(opp.map(gwp));
    }
    // the same figure reached by adding in another order can differ in its last bit
    const cmp = (a, b) => (Math.abs(a - b) < 1e-9 ? 0 : b - a);
    rows.sort((a, b) => (b.mp - a.mp) || cmp(a.omw, b.omw) || cmp(a.gwp, b.gwp) || cmp(a.ogw, b.ogw) || (a.seed - b.seed));
    rows.forEach((x, i) => { x.rank = i + 1; });
    return rows;
  }

  /* ---------------- Swiss: pairing ---------------- */
  /** How many rounds suit `n` players: enough for one to be left unbeaten. */
  const defaultRounds = (n) => Math.max(1, Math.min(MAX_ROUNDS, Math.ceil(Math.log2(Math.max(2, n)))));
  const pairKey = (x, y) => (x < y ? x + '|' + y : y + '|' + x);
  function random() {
    const c = typeof crypto !== 'undefined' && crypto && crypto.getRandomValues ? crypto : null;
    if (!c) return Math.random();
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 4294967296;
  }
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /**
   * The best way to pair `order` (best placed first): no rematches if it
   * can be done, then players as near each other on points as can be.
   * Depth first, nearest first, so the first pairing tried is usually the
   * one wanted, and anything that already costs more is let go.
   */
  function search(order, pts, played) {
    let best = null, bestCost = Infinity, steps = 0;
    const used = new Array(order.length).fill(false);
    const cur = [];
    function go(cost) {
      if (cost >= bestCost || steps > SEARCH_STEPS) return;
      steps++;
      const i = used.indexOf(false);
      if (i < 0) { bestCost = cost; best = cur.slice(); return; }
      used[i] = true;
      for (let j = i + 1; j < order.length && bestCost > 0; j++) {
        if (used[j]) continue;
        const a = order[i], b = order[j];
        const diff = (pts.get(a) || 0) - (pts.get(b) || 0);
        used[j] = true;
        cur.push([a, b]);
        go(cost + (played.has(pairKey(a, b)) ? REMATCH : 0) + diff * diff);
        cur.pop();
        used[j] = false;
      }
      used[i] = false;
    }
    go(0);
    return { pairs: best || [], cost: bestCost };
  }
  /**
   * The next round's pairs for `t`: [{ t, a, b }], the bye (b null) last,
   * the higher placed of each pair as a. Null with fewer than two left in.
   */
  function nextPairs(t, rand) {
    rand = rand || random;
    const active = t.players.filter(p => p.st === 'in');
    if (active.length < 2) return null;
    const played = new Set(), byes = new Set();
    for (const r of t.rnds) for (const p of r.pairs) { if (p.b) played.add(pairKey(p.a, p.b)); else byes.add(p.a); }
    const table = standings(t);
    const rank = new Map(table.map(s => [s.code, s.rank]));
    const pts = new Map(table.map(s => [s.code, s.mp]));
    const codes = active.map(p => p.code);
    // round one in the order seats were drawn; after that by points, each points group shuffled
    const order = t.rnds.length ? shuffle(codes.slice(), rand).sort((x, y) => pts.get(y) - pts.get(x))
      : codes.slice().sort((x, y) => rank.get(x) - rank.get(y));
    let best = null, bye = null;
    if (order.length % 2) {
      const low = codes.slice().sort((x, y) => rank.get(y) - rank.get(x));
      const cands = low.filter(c => !byes.has(c)).concat(low.filter(c => byes.has(c)));
      for (const c of cands) {
        const got = search(order.filter(x => x !== c), pts, played);
        const cost = got.cost + (byes.has(c) ? REMATCH : 0);       // a second bye is as bad as a rematch
        if (!best || cost < best.cost) { best = { pairs: got.pairs, cost }; bye = c; }
        if (cost < REMATCH) break;          // the lowest placed who can have it without forcing a rematch
      }
    } else best = search(order, pts, played);
    const top = (p) => Math.min(rank.get(p[0]), rank.get(p[1]));
    const pairs = best.pairs.map(([x, y]) => (rank.get(x) <= rank.get(y) ? [x, y] : [y, x])).sort((p, q) => top(p) - top(q));
    const out = pairs.map(([a, b], i) => ({ t: i + 1, a, b }));
    if (bye) out.push({ t: out.length + 1, a: bye, b: null });
    return out;
  }
  /** Pair the next round into `t` (the organiser's copy). */
  function pairRound(t, rand) {
    const got = nextPairs(t, rand);
    if (!got) return false;
    const r = t.rnds.length + 1;
    t.rnds.push({ pairs: got.map((p) => {
      const pair = { t: p.t, a: p.a, b: p.b, res: p.b ? null : BYE_RESULT(), by: p.b ? null : 'bye', rep: {}, room: null };
      // two bots: settled here and now, with no table
      if (p.b && isBot(p.a) && isBot(p.b)) { pair.res = botMatch(t, r, pair); pair.by = 'sim'; }
      return pair;
    }) });
    return true;
  }

  /* ---------------- two bots ---------------- */
  /**
   * A match between two bots, settled on the organiser's device as the
   * round is paired. It is not played out: a real game needs both bots to
   * build decks from Scryfall's card data first and then runs for tens of
   * seconds to minutes even at full speed, on the organiser's device, in
   * the middle of their own match; it cannot run at all without the card
   * data (offline, or in the tests); and a stalled game would hold up the
   * round for everyone. So each game goes to one bot or the other by a
   * roll weighted by their levels (an even chance between equals, three
   * in four for two levels apart, nine in ten for four apart),
   * until one has won the match: 1-0 in a best of one, 2-0 or 2-1 in a
   * best of three. The roll is seeded by the tournament, the round and the
   * table, so the same match always comes out the same way.
   */
  function botMatch(t, r, pair) {
    const lvl = (code) => ((t.players.find(p => p.code === code) || {}).bot || { lvl: 5 }).lvl;
    const pa = 1 / (1 + Math.exp(-0.55 * (lvl(pair.a) - lvl(pair.b))));
    const seed = parseInt(FC().sha256(`${t.id}:${r}:${pair.t}:${pair.a}:${pair.b}`).slice(0, 8), 16) || 1;
    const rng = new MTG.RNG(seed);
    const n = need(t.bo);
    const res = { a: 0, b: 0, d: 0 };
    while (res.a < n && res.b < n) { if (rng.next() < pa) res.a++; else res.b++; }
    return res;
  }
  /** A new bot for `t`: a name not taken there, a level, and a style (one of the lobby's at random, where they are loaded). */
  function newBot(t, lvl) {
    const names = t.players.map(p => p.name);
    const P = MTG.bots && MTG.bots.PERSONALITIES ? Object.keys(MTG.bots.PERSONALITIES) : [];
    let code;
    do { code = 'bot-' + FC().randomHex(8); } while (t.players.some(p => p.code === code));
    return {
      code, name: MTG.botName ? MTG.botName(names, random) : 'Bot ' + (names.length + 1), st: 'in',
      seed: t.players.reduce((m, p) => Math.max(m, p.seed + 1), 0),
      bot: { lvl: int(lvl, 1, MAX_LEVEL) || 5, style: P.length ? P[Math.floor(random() * P.length)] : '' },
    };
  }

  /* ---------------- a finished game, as a result ---------------- */
  /**
   * What a view at the end of a game says about the match, from the side
   * of `meId`: { w, l, d } in games, or null while there is more to play
   * (a match not yet decided) or when this is no match of two.
   */
  function resultFromView(v, meId) {
    if (!v || !v.over || v.replay || v.spectating || !Array.isArray(v.players) || v.players.length !== 2) return null;
    if (!v.players.some(p => p.id === meId)) return null;
    const m = v.match;
    if (m && m.best > 1) {
      if (!m.decided || !Array.isArray(m.scores)) return null;
      const mine = (m.scores.find(s => s.id === meId) || { wins: 0 }).wins | 0;
      const theirs = m.scores.filter(s => s.id !== meId).reduce((n, s) => n + (s.wins | 0), 0);
      return { w: mine, l: theirs, d: Math.max(0, (m.gameNumber | 0) - mine - theirs) };
    }
    const won = v.winners || [];
    return won.includes(meId) ? { w: 1, l: 0, d: 0 } : won.length ? { w: 0, l: 1, d: 0 } : { w: 0, l: 0, d: 1 };
  }

  /* ============================================================
     The organiser
     ============================================================ */
  const sendTo = (t, code, msg) => !!hub && code !== myCode() && hub.sendTourney(code, Object.assign({ id: t.id }, msg));
  const sendState = (t, code) => sendTo(t, code, { op: 'state', s: pub(t) });
  /** Everyone still following the tournament, sent it as it is now (whoever is away gets it when they are back). */
  function broadcast(t) {
    for (const p of t.players) if (p.st !== 'declined' && !p.bot) sendState(t, p.code);
  }
  /**
   * After any change to a tournament of ours: a round with every result
   * in is followed by the next (or by the end), and the change goes out,
   * numbered.
   */
  function commit(t, before) {
    advance(t);
    t.rev++;
    save();
    broadcast(t);
    noteChanges(t, before);
    changed(t);
  }
  function advance(t) {
    // a round of bots and byes is settled as soon as it is paired, so the next may follow at once
    while (t.state === 'running') {
      const last = t.rnds[t.rnds.length - 1];
      if (last && last.pairs.some(p => !p.res)) return;
      const left = t.players.filter(p => p.st === 'in').length;
      if (t.rnds.length >= t.rounds || left < 2) { t.state = 'done'; t.done = now(); return; }
      pairRound(t);
    }
  }

  /**
   * Set up a tournament and invite friends to it: { name, fmt, bo, rounds
   * (0 for as many as suit the players who come), invite: [codes] }.
   * Returns the tournament, or { why }.
   */
  function create(o) {
    o = o || {};
    if (!hub) return { why: 'Friends are not available on this device.' };
    load();
    if (list.filter(t => t.role === 'org' && !isOver(t)).length >= MAX_ORGANISED) return { why: 'Finish a tournament you are running before you start another.' };
    if (list.filter(t => !isOver(t)).length >= MAX_ACTIVE) return { why: 'You are in too many tournaments at once already.' };
    const fmt = cleanFmt(o.fmt);
    if (!fmt) return { why: 'Choose a constructed format.' };
    const codes = [...new Set((Array.isArray(o.invite) ? o.invite : []).filter(c => isCode(c) && c !== myCode()))];
    const bots = int(o.bots == null ? 0 : o.bots, 0, MAX_PLAYERS - 1);
    if (bots == null) return { why: `At most ${MAX_PLAYERS - 1} bots.` };
    if (codes.length + bots < MIN_PLAYERS - 1) return { why: `Invite friends or add bots, ${MIN_PLAYERS - 1} at least: a tournament is ${MIN_PLAYERS} to ${MAX_PLAYERS} players, you included.` };
    if (codes.length + bots > MAX_PLAYERS - 1) return { why: `${MAX_PLAYERS - 1} friends and bots at most: a tournament is ${MAX_PLAYERS} players at most, you included.` };
    for (const c of codes) if (!canInvite(c)) return { why: 'Only your friends can be invited.' };
    const me = hub.myName();
    const t = {
      v: 1, id: FC().randomHex(24), org: myCode(), name: cleanTitle(o.name) || `${me}’s tournament`, fmt, bo: o.bo === 3 ? 3 : 1,
      rounds: int(o.rounds, 0, MAX_ROUNDS) || 0, state: 'inviting', at: now(), done: 0, rev: 0,
      players: [{ code: myCode(), name: me, st: 'in', seed: 0 }].concat(codes.map((c, i) => ({ code: c, name: friendName(c), st: 'invited', seed: i + 1 }))),
      rnds: [], role: 'org', pend: {}, hint: {},
    };
    for (let i = 0; i < bots; i++) t.players.push(newBot(t, o.botLevel));
    list.push(t);
    commit(t);
    return t;
  }
  /** A friend on a proved friendship, not blocked: someone who can be invited. */
  function canInvite(code) {
    const f = hub && isCode(code) && code !== myCode() ? hub.entry(code) : null;
    return !!f && f.state === 'friend' && !hub.blocked().some(b => b.code === code);
  }
  const friendName = (code) => FC().cleanName(hub.nameOf(code)) || FC().formatCode(code);
  /** Ours, and still open to more players: before it starts, or under way with a round still to be paired. */
  function openToMore(t) {
    return !!t && t.role === 'org' && (t.state === 'inviting' || (t.state === 'running' && t.rnds.length < t.rounds));
  }

  /**
   * Invite more friends: before the start, into seats left (with
   * `o.replaceBots`, bots give up theirs if there are not enough); once
   * under way, to come in from the next round. Someone who said no can be
   * asked again. Returns '' or what stops it.
   */
  function invite(id, codes, o) {
    o = o || {};
    const t = byId(id);
    if (!openToMore(t)) return 'No more players can come into that tournament.';
    codes = [...new Set((Array.isArray(codes) ? codes : []).filter(c => c !== myCode()))];
    if (!codes.length) return 'Choose a friend to invite.';
    for (const c of codes) {
      if (!canInvite(c)) return 'Only your friends can be invited.';
      const p = t.players.find(x => x.code === c);
      if (p && p.st !== 'declined') return `${p.name} is already ${p.st === 'invited' ? 'invited' : 'in'}.`;
    }
    const free = MAX_PLAYERS - seatsTaken(t);
    const short = codes.length - free;
    const bots = t.players.filter(p => p.bot);
    if (short > 0 && !(o.replaceBots && t.state === 'inviting' && bots.length >= short)) {
      return free <= 0 ? `All ${MAX_PLAYERS} seats are taken.` : `Only ${free} seat${free === 1 ? ' is' : 's are'} left.`;
    }
    const before = snap(t);
    // the bots added last give up their seats first
    if (short > 0) { const gone = new Set(bots.slice(-short).map(p => p.code)); t.players = t.players.filter(p => !gone.has(p.code)); }
    // the list keeps who said no, to show it; past its length the oldest of them go
    if (t.players.length + codes.length > MAX_ENTRIES) {
      let over = t.players.length + codes.length - MAX_ENTRIES;
      t.players = t.players.filter(p => !(p.st === 'declined' && !codes.includes(p.code) && over-- > 0));
    }
    let seed = t.players.reduce((m, p) => Math.max(m, p.seed + 1), 0);
    for (const c of codes) {
      const p = t.players.find(x => x.code === c);
      if (p) { p.st = 'invited'; p.name = friendName(c); delete p.late; } else t.players.push({ code: c, name: friendName(c), st: 'invited', seed: seed++ });
    }
    commit(t, before);
    return '';
  }
  /** Take back an invitation not yet answered. */
  function uninvite(id, code) {
    const t = byId(id);
    const p = t && t.role === 'org' && !isOver(t) ? t.players.find(x => x.code === code) : null;
    if (!p || p.st !== 'invited') return false;
    const before = snap(t);
    t.players = t.players.filter(x => x !== p);
    sendTo(t, code, { op: 'gone', why: 'withdrawn' });
    commit(t, before);
    return true;
  }
  /** Bots into seats left, before the start: `n` of them at level `lvl`. Returns '' or what stops it. */
  function addBots(id, n, lvl) {
    const t = byId(id);
    if (!t || t.role !== 'org' || t.state !== 'inviting') return 'Bots can only be added before the tournament starts.';
    n = int(n, 1, MAX_PLAYERS);
    if (!n) return 'Add one bot at least.';
    const free = MAX_PLAYERS - seatsTaken(t);
    if (n > free) return free ? `Only ${free} seat${free === 1 ? ' is' : 's are'} left.` : `All ${MAX_PLAYERS} seats are taken.`;
    for (let i = 0; i < n; i++) t.players.push(newBot(t, lvl));
    commit(t, snap(t));
    return '';
  }
  /** Take a bot off, before the start. */
  function removeBot(id, code) {
    const t = byId(id);
    if (!t || t.role !== 'org' || t.state !== 'inviting' || !isBot(code) || !t.players.some(p => p.code === code)) return false;
    t.players = t.players.filter(p => p.code !== code);
    commit(t, snap(t));
    return true;
  }
  /** Start with whoever is in: at least three, the organiser included. Returns '' or what stops it. */
  function start(id, rand) {
    const t = byId(id);
    if (!t || t.role !== 'org' || t.state !== 'inviting') return 'That tournament cannot be started.';
    const ins = t.players.filter(p => p.st === 'in');
    if (ins.length < MIN_PLAYERS) return `It needs ${MIN_PLAYERS} players, you included; ${ins.length === 1 ? 'only you are' : ins.length + ' are'} in so far.`;
    const before = snap(t);
    // whoever has not answered is not waited for
    for (const p of t.players) if (p.st === 'invited') sendTo(t, p.code, { op: 'gone', why: 'started' });
    t.players = ins;
    // seats drawn at random: round one's pairings, and the last word between equals in the standings
    shuffle(t.players, rand || random).forEach((p, i) => { p.seed = i; });
    t.players.sort((x, y) => x.seed - y.seed);
    if (!t.rounds) t.rounds = defaultRounds(ins.length);
    t.state = 'running';
    pairRound(t, rand);
    commit(t, before);
    return '';
  }
  /** The organiser sets a match's result by hand: `res` is { a, b, d } for the pair's a and b. */
  function setResult(id, r, tb, res) {
    const t = byId(id);
    if (!t || t.role !== 'org' || t.state !== 'running') return 'Results can only be set in a tournament you are running.';
    const p = (t.rnds[r - 1] || { pairs: [] }).pairs.find(x => x.t === tb);
    if (!p || !p.b) return 'There is no match there.';
    const clean = cleanResult(res, t.bo);
    if (!clean) return `That is not a result a best-of-${t.bo} match can have.`;
    const before = snap(t);
    p.res = clean;
    p.by = 'org';
    commit(t, before);
    return '';
  }
  /**
   * `code` is out from here on. A match of theirs still being played this
   * round goes to the other player, as a concession would.
   */
  function dropPlayer(t, code) {
    const p = t.players.find(x => x.code === code);
    // bots never drop: before the start one is taken off (removeBot), after it they play on
    if (!p || p.st !== 'in' || p.bot) return false;
    if (t.state === 'inviting') {
      p.st = 'declined';
      sendTo(t, code, { op: 'gone', why: 'removed' });
      return true;
    }
    p.st = 'dropped';
    const r = t.rnds.length;
    const pair = pairOf(t, r, code);
    if (pair && !pair.res && pair.b) {
      const other = pair.a === code ? pair.b : pair.a;
      const otherIn = (t.players.find(x => x.code === other) || {}).st === 'in';
      const won = { a: need(t.bo), b: 0, d: 0 };
      pair.res = !otherIn ? { a: 0, b: 0, d: 0 } : pair.a === other ? won : flip(won);
      pair.by = 'drop';
    }
    return true;
  }
  /** The organiser drops a player (themselves too, if they stop playing but carry on organising). */
  function drop(id, code) {
    const t = byId(id);
    if (!t || t.role !== 'org' || isOver(t)) return false;
    // the organiser plays in every tournament they set up; once it is under way they may stop playing
    if (t.state === 'inviting' && code === t.org) return false;
    const before = snap(t);
    if (!dropPlayer(t, code)) return false;
    commit(t, before);
    return true;
  }
  /** The organiser calls it off. Everyone is told. */
  function cancel(id) {
    const t = byId(id);
    if (!t || t.role !== 'org' || isOver(t)) return false;
    const before = snap(t);
    t.state = 'cancelled';
    t.done = now();
    commit(t, before);
    return true;
  }

  /** A player's word, to the organiser. */
  function fromPlayer(t, from, msg) {
    const p = t.players.find(x => x.code === from);
    if (!p) {
      if (msg.op === 'sync' || msg.op === 'yes') sendTo(t, from, { op: 'gone', why: t.state === 'inviting' ? 'unknown' : 'started' });
      return;
    }
    const before = snap(t);
    switch (msg.op) {
      case 'yes':
        if (p.st === 'invited' && t.state === 'inviting') { p.st = 'in'; commit(t, before); }
        else if (p.st === 'invited' && t.state === 'running' && t.rnds.length < t.rounds) {
          // in late: paired from the next round, the rounds already paired counted as lost (see the top)
          p.st = 'in';
          if (t.rnds.length) p.late = t.rnds.length;
          commit(t, before);
        } else if (p.st === 'invited') {
          // too late: the last round is already paired, or it is over
          t.players = t.players.filter(x => x !== p);
          sendTo(t, from, { op: 'gone', why: 'late' });
          commit(t, before);
        } else if (p.st === 'in' || p.st === 'dropped') sendState(t, from);
        return;
      case 'no':
        if (p.st === 'invited' && !isOver(t)) { p.st = 'declined'; commit(t, before); }
        else if (t.state === 'inviting' && p.st === 'in' && from !== t.org) { p.st = 'declined'; commit(t, before); }
        return;
      case 'drop':
        if (p.st === 'in' && from !== t.org && !isOver(t) && dropPlayer(t, from)) commit(t, before);
        else sendState(t, from);
        return;
      case 'sync':
        if (p.st !== 'declined') sendState(t, from);
        return;
      case 'report': {
        const r = int(msg.r, 1, t.rnds.length);
        const pair = r && t.state === 'running' ? (t.rnds[r - 1].pairs.find(x => x.t === msg.tb) || null) : null;
        const mine = cleanResult({ a: msg.w, b: msg.l, d: msg.d }, t.bo);
        if (!pair || !pair.b || (pair.a !== from && pair.b !== from) || !mine) return;
        if (pair.res || (pair.rep[from] && sameResult(pair.rep[from], pair.a === from ? mine : flip(mine)))) { sendState(t, from); return; }
        takeReport(t, pair, from, pair.a === from ? mine : flip(mine));
        commit(t, before);
        return;
      }
      case 'room': {
        const r = int(msg.r, 1, t.rnds.length);
        const pair = r === t.rnds.length && t.state === 'running' ? (t.rnds[r - 1].pairs.find(x => x.t === msg.tb) || null) : null;
        const room = FC().cleanRoom(msg.room);
        if (!pair || !pair.b || pair.res || (pair.a !== from && pair.b !== from) || !room || isBot(pair.a) || isBot(pair.b)) return;
        if (pair.room === room) { sendState(t, from); return; }
        pair.room = room;
        commit(t, before);
        return;
      }
      default:
    }
  }
  /** A report into a pair (in the pair's own order): two that agree settle it. */
  function takeReport(t, pair, code, res) {
    pair.rep[code] = res;
    // against a bot the one person there is the only one who can say
    if (isBot(pair.a) || isBot(pair.b)) { pair.res = { a: res.a, b: res.b, d: res.d }; pair.by = 'bot'; return; }
    const ra = pair.rep[pair.a], rb = pair.rep[pair.b];
    if (ra && rb && sameResult(ra, rb)) { pair.res = { a: ra.a, b: ra.b, d: ra.d }; pair.by = 'agreed'; }
  }

  /* ============================================================
     A player
     ============================================================ */
  /** Say yes or no to an invitation. */
  function answer(id, yes) {
    const t = byId(id);
    const me = t && meOf(t);
    if (!t || t.role !== 'player' || isOver(t) || !me || me.st !== 'invited') return false;
    if (yes) {
      me.st = 'in';
      t.pend.yes = true;
      save();
      hub.sendTourney(t.org, { op: 'yes', id });
      changed(t);
    } else {
      hub.sendTourney(t.org, { op: 'no', id });
      forgetNow(t);
    }
    return true;
  }
  /**
   * Out of a tournament: before it starts, a no; once it is under way, a
   * drop (the organiser hears it now, or when next online). The organiser
   * leaves by dropping themselves.
   */
  function leave(id) {
    const t = byId(id);
    if (!t || isOver(t)) return false;
    if (t.role === 'org') return drop(id, myCode());
    const me = meOf(t);
    if (!me) return false;
    if (t.state === 'inviting' || me.st === 'invited') {
      hub.sendTourney(t.org, { op: 'no', id });
      forgetNow(t);
      return true;
    }
    if (me.st !== 'in') return false;
    me.st = 'dropped';
    t.pend.drop = true;
    delete t.pend.rep;
    save();
    hub.sendTourney(t.org, { op: 'drop', id });
    changed(t);
    return true;
  }
  /**
   * Report your match: `w` your wins, `l` theirs, `d` drawn games. `auto`
   * when the table saw it end. Returns { ok, sent } or { why }.
   */
  function report(id, r, tb, w, l, d, auto) {
    const t = byId(id);
    if (!t || t.state !== 'running') return { why: 'That tournament is not under way.' };
    const me = myCode();
    const pair = (t.rnds[r - 1] || { pairs: [] }).pairs.find(x => x.t === tb) || null;
    if (!pair || !pair.b || (pair.a !== me && pair.b !== me)) return { why: 'That is not your match.' };
    if (pair.res) return { why: 'That match is settled already.' };
    const mine = cleanResult({ a: w, b: l, d }, t.bo);
    if (!mine) return { why: `That is not a result a best-of-${t.bo} match can have.` };
    const res = pair.a === me ? mine : flip(mine);
    if (t.role === 'org') {
      const before = snap(t);
      takeReport(t, pair, me, res);
      commit(t, before);
      tourney.emit('reported', t, pair, mine, !!auto);
      return { ok: true, sent: true };
    }
    pair.rep[me] = res;
    t.pend.rep = { r, tb, w, l, d };
    save();
    const sent = hub.sendTourney(t.org, { op: 'report', id, r, tb, w, l, d });
    tourney.emit('reported', t, pair, mine, !!auto);
    changed(t);
    return { ok: true, sent };
  }
  /**
   * The table for your match is open, in room `room`: the organiser is
   * told (and tells your opponent), and your opponent, if they are a
   * friend of yours who is online, gets the usual invite too.
   */
  function roomOpened(id, r, tb, room) {
    const t = byId(id);
    room = FC().cleanRoom(room);
    if (!t || t.state !== 'running' || !room || r !== t.rnds.length) return false;
    const me = myCode();
    const pair = t.rnds[r - 1].pairs.find(x => x.t === tb);
    if (!pair || !pair.b || pair.res || (pair.a !== me && pair.b !== me)) return false;
    const opp = pair.a === me ? pair.b : pair.a;
    if (isBot(opp)) return false;           // a bot is played on this device, with no room
    if (t.role === 'org') {
      // measured against nothing: a room of our own opening is no news to us
      pair.room = room;
      commit(t);
    } else {
      t.hint[r + ':' + tb] = room;
      t.pend.room = { r, tb, room };
      save();
      hub.sendTourney(t.org, { op: 'room', id, r, tb, room });
      changed(t);
    }
    if (hub.isOnline(opp)) hub.invite(opp, room, fmtName(t));
    return true;
  }
  /**
   * A game ended at the table in room `room`, with `res` ({ w, l, d } for
   * you) as the match's result: if that was your match in a tournament,
   * it is reported. Returns { t, pair, res } when it was, else null.
   */
  function gameOver(room, res) {
    room = FC().cleanRoom(room);
    if (!room || !res) return null;
    const me = myCode();
    for (const t of load()) {
      if (t.state !== 'running') continue;
      const r = t.rnds.length;
      const pair = pairOf(t, r, me);
      if (!pair || !pair.b || pair.res || !roomsOf(t, r, pair).includes(room)) continue;
      // reported already: a friendly rematch at the same table afterwards is not the match
      if (pair.rep[me]) return null;
      const got = report(t.id, r, pair.t, res.w, res.l, res.d, true);
      return got.ok ? { t, pair, res } : null;
    }
    // a table whose note is waiting for our copy to catch up: the first result is kept for then
    const n = tables.find(x => x.room === room);
    if (n && !n.res) n.res = { w: res.w, l: res.l, d: res.d };
    return null;
  }
  /**
   * A game against a tournament's bot ended at a table on this device,
   * set up for match `info` ({ id, r, t }: the tournament, round and
   * table), with `res` ({ w, l, d } for you) as the match's result: it is
   * reported, which settles it. Returns { t, pair, res } when it was, else null.
   */
  function botGameOver(info, res) {
    const t = info && byId(info.id);
    if (!t || t.state !== 'running' || !res || info.r !== t.rnds.length) return null;
    const me = myCode();
    const pair = t.rnds[info.r - 1].pairs.find(x => x.t === info.t);
    if (!pair || !pair.b || pair.res || (pair.a !== me && pair.b !== me) || !isBot(pair.a === me ? pair.b : pair.a)) return null;
    if (pair.rep[me]) return null;
    const got = report(t.id, info.r, pair.t, res.w, res.l, res.d, true);
    return got.ok ? { t, pair, res } : null;
  }
  /** Take a finished tournament (or one you are out of) off the list. */
  function forget(id) {
    const t = byId(id);
    if (!t || (!isOver(t) && !(t.role === 'player' && (meOf(t) || {}).st === 'dropped'))) return false;
    forgetNow(t);
    return true;
  }
  function forgetNow(t) {
    list = load().filter(x => x !== t);
    save();
    changed(t);
  }

  /** The organiser's word, to a player. */
  function fromOrganiser(from, msg) {
    if (msg.op === 'gone') {
      const t = byId(msg.id);
      if (!t || t.role !== 'player' || t.org !== from) return;
      const why = msg.why === 'started' ? `${nameOf(t, from)} started ${t.name} without you.`
        : msg.why === 'removed' ? `${nameOf(t, from)} took you off ${t.name}.`
          : msg.why === 'withdrawn' ? `${nameOf(t, from)} took back the invitation to ${t.name}.`
            : msg.why === 'late' ? `${t.name} has no rounds left to come in for.` : `${t.name} is no longer running.`;
      if (isOver(t)) return;
      forgetNow(t);
      tourney.emit('removed', t, why);
      return;
    }
    if (msg.op !== 'state') return;
    const s = readT(msg.s);
    if (!s || s.id !== msg.id || s.org !== from || from === myCode()) return;
    const meP = s.players.find(p => p.code === myCode());
    let t = byId(s.id);
    if (t && (t.role === 'org' || t.org !== from)) return;
    if (!t) {
      // something we have not heard of is an invitation (to the start, or to come in late), or nothing
      if (!meP || meP.st !== 'invited' || isOver(s) || (s.state === 'running' && s.rnds.length >= s.rounds)) return;
      const invites = load().filter(isInvite);
      if (invites.length >= MAX_INVITES || invites.filter(i => i.org === from).length >= MAX_FROM_ONE) return;
      if (list.filter(x => !isOver(x)).length >= MAX_ACTIVE) return;
      t = Object.assign(s, { role: 'player', pend: {}, hint: {} });
      t.at = now();               // their clock is theirs: an invitation runs out by ours
      list.push(t);
      save();
      tourney.emit('invite', t);
      changed(t);
      return;
    }
    if (s.rev < t.rev) return;      // overtaken by a newer one
    if (!meP) { forgetNow(t); tourney.emit('removed', t, `You are no longer in ${t.name}.`); return; }
    // an invitation never answered, to something now over: nothing to keep
    if (meP.st === 'invited' && isOver(s)) { forgetNow(t); return; }
    const before = snap(t);
    const at = t.at;
    Object.assign(t, s);
    if (meP.st === 'invited') t.at = at;
    // what we said and the organiser has not taken in yet stays as we said it
    const pd = t.pend;
    const me = myCode();
    if (pd.yes && meP.st !== 'invited') delete pd.yes;
    if (pd.drop && meP.st !== 'in') delete pd.drop;
    if (pd.drop && meP.st === 'in') meP.st = 'dropped';
    if (pd.yes && meP.st === 'invited') meP.st = 'in';
    if (pd.rep) {
      const p = (t.rnds[pd.rep.r - 1] || { pairs: [] }).pairs.find(x => x.t === pd.rep.tb);
      const mine = p && cleanResult({ a: pd.rep.w, b: pd.rep.l, d: pd.rep.d }, t.bo);
      if (!p || !mine || p.res || (p.a !== me && p.b !== me)) delete pd.rep;
      else {
        const res = p.a === me ? mine : flip(mine);
        if (sameResult(p.rep[me], res)) delete pd.rep;
        else p.rep[me] = res;
      }
    }
    if (pd.room) {
      const p = (t.rnds[pd.room.r - 1] || { pairs: [] }).pairs.find(x => x.t === pd.room.tb);
      if (!p || p.res || p.room === pd.room.room || pd.room.r !== t.rnds.length) delete pd.room;
    }
    save();
    noteChanges(t, before);
    changed(t);
    // a table that said which match it was, heard before this copy had caught up with it
    retryTables();
  }

  /* ---------------- a table that says which match it is ----------------
     A host who opened a tournament match's table tells each guest, over
     the game's own connection, which match it is (src/10i-ui-tourney.js):
     { id, r, tb, host }. That is what lets someone who joined by typing
     the room's code, with the organiser away, have their result go in by
     itself. It is believed only as far as it agrees with this device's
     own copy: a tournament we are in, its current round, our own match at
     that table, and the host as our opponent there. So a host can link a
     table to the match its guest really has with them, and to nothing
     else. A note for a round our copy has not reached yet is kept, and
     tried again as each new copy arrives; a match that ended meanwhile is
     reported then. */
  let tables = [];              // notes kept for later: { id, r, tb, host, room, res }
  /** A table's note, heard at room `room`. True once it is linked to our match. */
  function tableNote(note, room) {
    room = FC().cleanRoom(room);
    if (!note || typeof note !== 'object' || !room || !isId(note.id) || !int(note.r, 1, MAX_ROUNDS) || !int(note.tb, 1, MAX_PLAYERS) ||
      !isCode(note.host) || note.host === myCode()) return false;
    const n = { id: note.id, r: note.r, tb: note.tb, host: note.host, room, res: null };
    const got = linkTable(n);
    if (got === 'later') tables = tables.filter(x => x.room !== room).concat([n]).slice(-4);
    return got === 'linked';
  }
  /** 'linked', 'later' (our copy is behind), or 'no'. */
  function linkTable(n) {
    const t = byId(n.id);
    if (!t || isOver(t)) return 'no';
    if (t.state === 'inviting' || n.r > t.rnds.length) return n.r <= (t.rounds || MAX_ROUNDS) ? 'later' : 'no';
    if (t.state !== 'running' || n.r < t.rnds.length) return 'no';
    const me = myCode();
    const p = t.rnds[n.r - 1].pairs.find(x => x.t === n.tb);
    if (!p || !p.b || (p.a !== me && p.b !== me) || (p.a === me ? p.b : p.a) !== n.host) return 'no';
    if (!roomsOf(t, n.r, p).includes(n.room)) {
      t.hint[n.r + ':' + n.tb] = n.room;
      save();
      changed(t);
    }
    if (n.res) gameOver(n.room, n.res);
    return 'linked';
  }
  function retryTables() {
    if (!tables.length) return;
    const was = tables;
    tables = [];
    for (const n of was) if (linkTable(n) === 'later') tables.push(n);
  }

  /* ---------------- what changed, for the person ---------------- */
  /** What a change is measured against: the round, your match, the disputes. */
  function snap(t) {
    const me = myCode();
    const r = t.rnds.length;
    const p = pairOf(t, r, me);
    return {
      state: t.state, round: r, room: roomOf(t, r, p), res: p ? p.res : null,
      disputes: t.role === 'org' && r ? t.rnds[r - 1].pairs.filter(disputed).map(x => x.t).join(',') : '',
    };
  }
  function noteChanges(t, before) {
    if (!before) return;
    const after = snap(t);
    const me = myCode();
    const r = t.rnds.length;
    const p = pairOf(t, r, me);
    if (after.round > before.round && p && (meOf(t) || {}).st === 'in') tourney.emit('paired', t, p, r);
    else if (p && p.b && after.room && after.room !== before.room && !(t.pend.room && t.pend.room.room === after.room)) {
      // a room for your match that you did not open: your opponent's
      tourney.emit('room', t, p, after.room);
    }
    if (p && p.res && !before.res && after.round === before.round && p.b) tourney.emit('settled', t, p);
    if (t.role === 'org' && after.disputes && after.disputes !== before.disputes) {
      for (const x of t.rnds[r - 1].pairs) if (disputed(x) && !before.disputes.split(',').includes(String(x.t))) tourney.emit('dispute', t, x, r);
    }
    if (after.state !== before.state && after.state === 'done') tourney.emit('finished', t);
    if (after.state !== before.state && after.state === 'cancelled' && t.role !== 'org') tourney.emit('cancelled', t);
  }

  /* ---------------- the line ---------------- */
  /* A friend sends a few messages a round; one sending hundreds is not
     playing, and is not let write to the store that often. */
  const heard = new Map();      // code -> { n, since }
  function flooding(code) {
    const t0 = now();
    const h = heard.get(code);
    if (!h || t0 - h.since > FLOOD_MS) { heard.set(code, { n: 1, since: t0 }); return false; }
    return ++h.n > FLOOD_MAX;
  }
  function onMessage(from, msg) {
    if (flooding(from)) return;
    if (!msg || typeof msg.op !== 'string' || !isId(msg.id)) return;
    if (msg.op === 'state' || msg.op === 'gone') return fromOrganiser(from, msg);
    const t = byId(msg.id);
    if (!t || t.role !== 'org') {
      // a player asking after something we do not run (any more): say so, so it can let it go
      if (!t && (msg.op === 'sync' || msg.op === 'yes')) hub.sendTourney(from, { op: 'gone', id: msg.id, why: 'unknown' });
      return;
    }
    fromPlayer(t, from, msg);
  }
  /** A friend back online: whatever is owed between us goes again. */
  function online(code) {
    for (const t of load()) {
      if (t.role === 'org') {
        const p = t.players.find(x => x.code === code);
        if (p && p.st !== 'declined' && !isOver(t)) sendState(t, code);
        continue;
      }
      if (t.org !== code || isOver(t)) continue;
      const pd = t.pend;
      if (pd.yes) hub.sendTourney(code, { op: 'yes', id: t.id });
      if (pd.drop) hub.sendTourney(code, { op: 'drop', id: t.id });
      if (pd.rep) hub.sendTourney(code, Object.assign({ op: 'report', id: t.id }, pd.rep));
      if (pd.room) hub.sendTourney(code, Object.assign({ op: 'room', id: t.id }, pd.room));
      hub.sendTourney(code, { op: 'sync', id: t.id, rev: t.rev });
    }
  }
  /**
   * Your opponent invited you to their table the usual way: that is your
   * match's room. The invite is marked as the tournament's (inv.tourney),
   * so the note about it is the tournament's own rather than a friend's
   * plain invite (src/10g-ui-social.js).
   */
  function friendInvite(inv) {
    if (!inv || !inv.code || !inv.room) return;
    const me = myCode();
    for (const t of load()) {
      if (t.state !== 'running') continue;
      const r = t.rnds.length;
      const p = pairOf(t, r, me);
      if (!p || !p.b || p.res || (p.a !== inv.code && p.b !== inv.code)) continue;
      inv.tourney = t.id;
      if (roomOf(t, r, p) === inv.room) return;
      t.hint[r + ':' + p.t] = inv.room;
      save();
      tourney.emit('room', t, p, inv.room);
      changed(t);
      return;
    }
  }
  function fmtName(t) {
    const f = MTG.formats && MTG.formats.get ? MTG.formats.get(t.fmt) : null;
    return `${(f && f.name) || t.fmt} tournament`;
  }

  /** Hook tournaments up to a friends hub (MTG.friends, or a test's). */
  function attach(h) {
    hub = h;
    h.on('tourney', (code, msg) => { try { onMessage(code, msg); } catch (e) { console.warn('[tourney] a message could not be read', e); } });
    h.on('online', (code) => { try { online(code); } catch (e) { console.warn('[tourney]', e); } });
    h.on('invite', (inv) => { try { friendInvite(inv); } catch (e) { console.warn('[tourney]', e); } });
  }
  if (MTG.bus) MTG.bus.on('profile:replacing', () => { frozen = true; });

  /* ---------------- reading ---------------- */
  /** Your match this round in `t`: { r, pair, opp, host, room, bye, mine, theirs } or null. */
  function myMatch(t) {
    const me = myCode();
    const r = t.rnds.length;
    const p = pairOf(t, r, me);
    if (!p) return null;
    const opp = p.a === me ? p.b : p.a;
    const asMine = (x) => (x ? (p.a === me ? x : flip(x)) : null);
    const oppBot = opp ? (t.players.find(x => x.code === opp) || {}).bot || null : null;
    return {
      r, pair: p, opp, oppName: opp ? nameOf(t, opp) : '', oppBot, host: p.a === me, bye: !p.b, room: oppBot ? null : roomOf(t, r, p),
      res: asMine(p.res), mine: asMine(p.rep[me]), theirs: opp ? asMine(p.rep[opp]) : null,
      pending: !!(t.pend.rep && t.pend.rep.r === r && t.pend.rep.tb === p.t),
    };
  }

  Object.assign(tourney, {
    attach, create, start, setResult, drop, cancel, answer, leave, report, roomOpened, gameOver, botGameOver, tableNote, forget,
    invite, uninvite, addBots, removeBot, canInvite, openToMore, seatsTaken, isBot,
    list: () => load().slice().sort((x, y) => (isOver(x) - isOver(y)) || ((y.done || y.at) - (x.done || x.at))),
    get: byId,
    invites: () => load().filter(isInvite),
    active: () => load().filter(t => !isOver(t) && !isInvite(t)),
    finished: () => load().filter(isOver).sort((x, y) => (y.done || y.at) - (x.done || x.at)),
    myMatch, standings, isInvite, isOver, disputed, nameOf, need, roomsOf,
    me: () => myCode(),
    // the pieces tools/tournamenttest.js checks on their own
    readT, pub, cleanResult, nextPairs, pairRound, defaultRounds, resultFromView, search, botMatch,
    MIN_PLAYERS, MAX_PLAYERS, MAX_ROUNDS, MAX_LEVEL,
    /** Forget what was read from the store, so the next look reads it again (a test's restart). */
    _reload() { list = null; },
  });
})(window.MTG);
