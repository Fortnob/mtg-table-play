/* ===== 10i-ui-tourney.js ===== */
/* ============================================================
   10i-ui-tourney.js - friends tournaments on screen (src/09f-tourney.js
   holds the logic)

   The Friends window's Tournaments tab: invitations, the tournaments
   under way, and the finished ones. Setting one up: a name, a format, the
   match length, how many rounds, the friends to invite and how many bots
   to fill seats with. A tournament's own window: your match this round
   (open the table, join it, play a bot, report the result), the round's
   pairings, and the standings; the organiser invites more friends, adds
   or takes off bots, sets results and drops players from there too.
   Notes say when you are invited, paired, when your table is open and
   when it is over.

   A match between two people is played at an ordinary table: the host's
   opens with the tournament's format and match length
   (MTG.app.hostTableFor), and the other joins it by its room code; the
   host's table tells whoever joins which match it is, so even someone who
   typed the code has their result go in. A match against a bot is played
   on the person's own device (MTG.app.botTableFor). The table is watched
   here, so a match's result goes to the organiser by itself once it is
   decided. Bots are marked as the lobby marks them: their level, in gold.
   Everything is laid out to work by touch at 375px wide (src/tourney.css).
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const T = MTG.tourney;
  const F = MTG.friendsCore;
  const net = MTG.net;
  const A = () => MTG.app || {};
  const hub = () => MTG.friends;

  const SVG = {
    cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4.5a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M7 6H4.2c0 3 1.4 4.6 3.3 4.9M17 6h2.8c0 3-1.4 4.6-3.3 4.9M12 13.5V17M8.5 20h7M9.5 17h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  /* ---------------- words ---------------- */
  const fmtName = (id) => { const f = MTG.formats.get(id); return (f && f.name) || id; };
  const facts = (t) => `${fmtName(t.fmt)} · best of ${t.bo}` + (t.rounds ? ` · ${t.rounds} round${t.rounds === 1 ? '' : 's'}` : '');
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  /** A result in games, "2–1", with drawn games after it when there are any: "1–1–1". */
  const score = (w, l, d) => `${w}–${l}` + (d ? `–${d}` : '');
  const pct = (x) => (Math.round(x * 1000) / 10).toFixed(1) + '%';
  const orgName = (t) => T.nameOf(t, t.org);
  const isMe = (code) => code === T.me();
  const meIn = (t) => t.players.find(p => isMe(p.code)) || null;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  function outcome(r) {
    if (r.w > r.l) return `you won ${score(r.w, r.l, r.d)}`;
    if (r.l > r.w) return `you lost ${score(r.w, r.l, r.d)}`;
    return `a draw, ${score(r.w, r.l, r.d)}`;
  }
  function stateLine(t) {
    if (t.state === 'inviting') {
      const ins = t.players.filter(p => p.st === 'in').length;
      return `Waiting for answers · ${ins} of ${T.seatsTaken(t)} in`;
    }
    if (t.state === 'running') return `Round ${t.rnds.length} of ${t.rounds}`;
    if (t.state === 'cancelled') return 'Called off';
    return 'Finished';
  }

  /* ---------------- bots, as the lobby shows them ---------------- */
  const LEVELS = () => (MTG.bots && MTG.bots.DIFFICULTY) || {};
  const STYLES = () => (MTG.bots && MTG.bots.PERSONALITIES) || {};
  const levelLabel = (lvl) => (LEVELS()[lvl] && LEVELS()[lvl].label) || `level ${lvl}`;
  /** A bot in words, as a lobby seat says it: "Bot · Steady · Aggressive". */
  const botWords = (b) => ['Bot', levelLabel(b.lvl), (STYLES()[b.style] || {}).label].filter(Boolean).join(' · ');
  const botOf = (t, code) => (t.players.find(p => p.code === code) || {}).bot || null;
  /** The lobby's mark for a bot: its level, in gold. */
  const botBadge = (b) => el('span', { class: 'seat-level tn-lvl', text: String(b.lvl), title: botWords(b), 'aria-label': botWords(b) });
  /** A player's name, with the lobby's bot mark beside a bot's. */
  function nameEl(t, code, cls) {
    const b = botOf(t, code);
    return el('span', { class: 'tn-who' + (b ? ' is-bot' : '') + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'tn-nm', text: T.nameOf(t, code) + (isMe(code) ? ' (you)' : '') }),
      b ? botBadge(b) : null,
    ].filter(Boolean));
  }
  /** The lobby's levels, to pick from: "5 · Steady". */
  function levelSelect(id, value, onPick) {
    const levels = Object.keys(LEVELS()).length ? Object.keys(LEVELS()).map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sel = el('select', { id, class: 'tn-level', 'aria-label': 'How strong the bots are' },
      levels.map(d => el('option', { value: String(d), text: LEVELS()[d] ? `${d} · ${LEVELS()[d].label}` : String(d), selected: d === value })));
    sel.addEventListener('change', () => onPick(parseInt(sel.value, 10) || 5));
    return sel;
  }
  const defaultLevel = () => MTG.settings.lobbyBotLevel || 5;

  /** A friend's picture where we have one; the organiser's friends may be strangers to us. */
  function face(code, name, size) {
    const f = hub() && hub().entry(code);
    return UI.portrait(name || (f && f.name) || F.formatCode(code), null, {
      size: size || 'md', avatar: f ? f.avatar : null,
      frame: f && f.frame && MTG.economy && MTG.economy.frameById(f.frame) ? f.frame : null,
    });
  }
  const cupIcon = () => el('span', { class: 'sn-ico tn-ico', html: SVG.cup });
  /** What there is for you to do in a tournament, if anything: a word for its button. */
  function todo(t) {
    if (T.isInvite(t)) return 'answer';
    const mm = t.state === 'running' ? T.myMatch(t) : null;
    const me = meIn(t);
    if (!mm || !me || me.st !== 'in' || mm.bye || mm.res) return '';
    if (mm.oppBot && !mm.mine) return 'play';
    if (mm.room && !mm.host && !mm.mine) return 'join';
    if (mm.theirs && !mm.mine) return 'report';
    return '';
  }

  /* ---------------- the Friends window's tab ---------------- */
  UI.tourneysTab = function (body) {
    const lists = el('div', { class: 'fr-lists tn-lists' });
    body.append(
      el('div', { class: 'tn-tabhead' }, [
        el('p', { class: 'small muted fr-intro', text: 'Swiss tournaments among your friends, with bots to fill seats if you like. You invite them; the app pairs every round, takes in the results and keeps the standings.' }),
        el('button', { type: 'button', class: 'btn primary tn-new', html: `${SVG.plus}<span>New tournament</span>`, onclick: () => createWindow() }),
      ]),
      lists,
    );
    const section = (title, rows, cls) => el('section', { class: 'fr-section ' + (cls || '') }, [el('h3', { class: 'fr-h', text: title }), el('div', { class: 'fr-rows' }, rows)]);
    const refresh = () => {
      lists.innerHTML = '';
      const inv = T.invites(), act = T.active(), fin = T.finished();
      if (inv.length) lists.appendChild(section('Invitations', inv.map(inviteRow), 'invites'));
      if (act.length) lists.appendChild(section('Under way', act.map(activeRow), 'tn-active'));
      if (fin.length) lists.appendChild(section('Finished', fin.map(doneRow), 'tn-done'));
      if (!lists.children.length) {
        lists.appendChild(el('div', { class: 'fr-empty' }, [
          el('b', { text: 'No tournaments yet.' }),
          el('span', { text: 'Start one for three to sixteen players, you included: New tournament, then pick friends to invite, or bots, or both.' }),
        ]));
      }
    };
    refresh();
    return { refresh };
  };
  function tnRow(lead, title, sub, acts, cls) {
    return el('div', { class: 'fr-row tn-row ' + (cls || '') }, [
      lead,
      el('div', { class: 'fr-who' }, [el('div', { class: 'fr-name', text: title }), el('div', { class: 'fr-pres' }, [el('span', { text: sub })])]),
      el('div', { class: 'fr-acts' }, acts),
    ]);
  }
  function inviteRow(t) {
    const late = t.state === 'running';
    const sub = late ? `${facts(t)} · come in from round ${t.rnds.length + 1}` : `${facts(t)} · ${t.players.filter(p => p.st === 'in').length} in so far`;
    return tnRow(face(t.org, orgName(t)), `${orgName(t)} invites you: ${t.name}`, sub, [
      el('button', { type: 'button', class: 'btn sm ghost', text: 'No thanks', onclick: () => T.answer(t.id, false) }),
      el('button', { type: 'button', class: 'btn sm primary', text: 'Join', onclick: () => { if (T.answer(t.id, true)) UI.openTourney(t.id); } }),
    ], 'p-in');
  }
  function activeRow(t) {
    const mm = t.state === 'running' ? T.myMatch(t) : null;
    const me = meIn(t);
    let sub = stateLine(t);
    if (me && me.st === 'dropped') sub += ' · you dropped out';
    else if (mm && mm.bye) sub += ' · a bye for you';
    else if (mm && mm.oppName) sub += ` · ${mm.res ? 'done against' : 'you play'} ${mm.oppName}${mm.oppBot ? ' (a bot)' : ''}`;
    else if (t.state === 'running' && me && me.st === 'in') sub += ` · you come in from round ${t.rnds.length + 1}`;
    const want = todo(t);
    return tnRow(cupIcon(), t.name, sub, [
      el('button', { type: 'button', class: 'btn sm' + (want ? ' primary' : ''),
        text: want === 'join' ? 'Join table' : want === 'play' ? 'Play' : want === 'report' ? 'Report' : 'Open',
        onclick: () => UI.openTourney(t.id) }),
    ], want ? 'tn-want' : '');
  }
  function doneRow(t) {
    let sub = t.state === 'cancelled' ? 'Called off' : 'Finished';
    if (t.state === 'done') {
      const st = T.standings(t);
      const mine = st.find(r => isMe(r.code));
      if (mine) sub += ` · you came ${ordinal(mine.rank)} of ${st.length}`;
      else if (st[0]) sub += ` · won by ${st[0].name}`;
    }
    sub += ' · ' + new Date(t.done || t.at || Date.now()).toLocaleDateString();
    return tnRow(cupIcon(), t.name, sub, [
      el('button', { type: 'button', class: 'btn sm ghost', text: 'Remove', onclick: async () => {
        if (await UI.confirm(`Take ${t.name} off your list? Its standings go with it.`, 'Remove a tournament', { yes: 'Remove' })) T.forget(t.id);
      } }),
      el('button', { type: 'button', class: 'btn sm', text: 'View', onclick: () => UI.openTourney(t.id) }),
    ]);
  }
  /** Invitations and tables to join: counted on the Friends chip. */
  UI.tourneyWaiting = () => T.invites().length + T.active().filter(t => todo(t) === 'join').length;

  /* ---------------- a segmented control ---------------- */
  function seg(options, current, onPick, label, cls) {
    const box = el('div', { class: 'seg ' + (cls || ''), role: 'radiogroup', 'aria-label': label });
    const draw = (cur) => {
      box.innerHTML = '';
      for (const [value, text] of options) {
        box.appendChild(el('button', { type: 'button', role: 'radio', class: 'seg-btn' + (value === cur ? ' on' : ''), 'aria-checked': value === cur ? 'true' : 'false', text,
          onclick: () => { draw(value); onPick(value); } }));
      }
    };
    draw(current);
    return box;
  }

  /* ---------------- picking friends, and bots ---------------- */
  /** Your friends who could be invited to `t` (to a new one, with `t` null): not in it, not invited, not blocked. */
  function invitable(t) {
    return hub().entries().filter(f => f.state === 'friend' && T.canInvite(f.code))
      .filter(f => { const p = t && t.players.find(x => x.code === f.code); return !p || p.st === 'declined'; })
      .sort((a, b) => (b.online - a.online) || (a.name || '').localeCompare(b.name || ''));
  }
  /**
   * A list of friends to tick. `picked` (a Set of codes) follows the ticks;
   * `limit(full)` stops more being ticked once the seats are taken.
   */
  function friendPicker(friends, picked, onChange, t) {
    const list = el('div', { class: 'fr-rows tn-pick-friends' });
    if (!friends.length) {
      list.appendChild(el('div', { class: 'fr-empty' }, [
        el('b', { text: t ? 'Nobody left to invite.' : 'No friends to invite yet.' }),
        el('span', { text: t ? 'Every friend of yours is in it or invited already.' : 'Add friends from the Friends tab, or fill the seats with bots below.' }),
      ]));
    }
    for (const f of friends) {
      const box = el('input', { type: 'checkbox', id: 'tn-f-' + f.code, 'aria-label': `Invite ${f.name || F.formatCode(f.code)}` });
      box.addEventListener('change', () => { if (box.checked) picked.add(f.code); else picked.delete(f.code); onChange(); });
      const before = t && t.players.find(x => x.code === f.code);
      list.appendChild(el('label', { class: 'fr-row tn-friend p-' + f.presence, for: 'tn-f-' + f.code }, [
        face(f.code, f.name),
        el('div', { class: 'fr-who' }, [
          el('div', { class: 'fr-name', text: f.name || F.formatCode(f.code) }),
          el('div', { class: 'fr-pres' }, [el('i', { class: 'fr-dot', 'aria-hidden': 'true' }),
            el('span', { text: (f.online ? 'Online' : 'Offline · invited when they are back') + (before ? ' · said no before' : '') })]),
        ]),
        box,
      ]));
    }
    return {
      el: list,
      limit(full) { for (const b of list.querySelectorAll('input[type=checkbox]')) b.disabled = !b.checked && full; },
    };
  }
  /** How many bots, and how strong: a stepper and the lobby's levels. */
  function botsRow(choice, onChange) {
    const n = el('b', { class: 'tn-step-n tn-bot-n', 'aria-live': 'polite' });
    const minus = el('button', { type: 'button', class: 'btn xs', text: '−', 'aria-label': 'One bot fewer', onclick: () => { choice.bots--; paint(); onChange(); } });
    const plus = el('button', { type: 'button', class: 'btn xs', text: '+', 'aria-label': 'One bot more', onclick: () => { choice.bots++; paint(); onChange(); } });
    const lvl = levelSelect('tn-bot-level', choice.lvl, (v) => { choice.lvl = v; });
    let full = false;
    const paint = () => { n.textContent = String(choice.bots); minus.disabled = choice.bots <= 0; plus.disabled = full; };
    const box = el('div', { class: 'tn-bots' }, [
      el('div', { class: 'tn-bots-say' }, [
        el('span', { class: 'tn-label', text: 'Bots' }),
        el('span', { class: 'tn-hint', text: 'They fill seats and play their matches: against you on your own device, against each other on the organiser’s.' }),
      ]),
      el('div', { class: 'tn-bots-pick' }, [
        el('div', { class: 'tn-step tn-bot-step', role: 'group', 'aria-label': 'How many bots' }, [minus, n, plus]),
        el('label', { class: 'tn-bot-lvl' }, [el('span', { class: 'tiny dim', text: 'Difficulty' }), lvl]),
      ]),
    ]);
    paint();
    return { el: box, limit(f) { full = f; paint(); } };
  }

  /* ---------------- setting one up ---------------- */
  function createWindow() {
    const friends = invitable(null);
    const formats = MTG.formats.list().filter(f => f.kind !== 'limited');
    const was = MTG.settings.tourneyLast || {};
    const choice = {
      fmt: formats.some(f => f.id === was.fmt) ? was.fmt : (formats.some(f => f.id === A().formatId) ? A().formatId : 'standard'),
      bo: was.bo === 1 ? 1 : 3, rounds: 0, picked: new Set(), bots: 0, lvl: was.lvl || defaultLevel(),
    };
    const name = el('input', { type: 'text', id: 'tn-name', class: 'tn-input', maxlength: '40', value: `${hub().myName()}’s tournament`, autocomplete: 'off', 'aria-label': 'The tournament’s name' });
    const fmtSel = el('select', { id: 'tn-fmt', 'aria-label': 'Format' }, formats.map(f => el('option', { value: f.id, text: f.name, selected: f.id === choice.fmt })));
    fmtSel.addEventListener('change', () => { choice.fmt = fmtSel.value; });
    const roundsHint = el('div', { class: 'tn-hint' });
    const count = el('div', { class: 'tn-count', 'aria-live': 'polite' });
    const field = (label, control, forId) => el('div', { class: 'tn-field' }, [el('label', { class: 'tn-label', for: forId || null, text: label }), control]);
    const roundSeg = seg([[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], 0, (v) => { choice.rounds = v; paint(); }, 'Rounds', 'seg-wrap tn-rounds');
    const picker = friendPicker(friends, choice.picked, () => paint(), null);
    const bots = botsRow(choice, () => paint());
    const m = UI.modal({
      title: 'New tournament', className: 'friends-modal tn-create', width: 'min(620px, 96vw)',
      content: el('div', { class: 'tn-form' }, [
        field('Name', name, 'tn-name'),
        field('Format', fmtSel, 'tn-fmt'),
        field('Matches', seg([[1, 'Best of 1'], [3, 'Best of 3']], choice.bo, (v) => { choice.bo = v; }, 'Match length', 'tn-bo')),
        field('Rounds', el('div', { class: 'tn-roundbox' }, [roundSeg, roundsHint])),
        el('div', { class: 'tn-field' }, [el('div', { class: 'tn-label', text: 'Invite' }), count, picker.el]),
        bots.el,
      ]),
    });
    m.button('Cancel', (mm) => mm.close(), 'ghost');
    const go = m.button('Send invites', () => send(), 'primary');
    function paint() {
      const n = choice.picked.size + choice.bots + 1;
      const parts = [`${n} player${n === 1 ? '' : 's'}, you included`];
      if (choice.bots) parts.push(plural(choice.bots, 'bot'));
      count.textContent = parts.join(' · ') + ` · ${T.MIN_PLAYERS} to ${T.MAX_PLAYERS}`;
      count.classList.toggle('bad', n < T.MIN_PLAYERS);
      const k = Math.max(T.MIN_PLAYERS, n);
      roundsHint.textContent = choice.rounds ? `${choice.rounds} round${choice.rounds === 1 ? '' : 's'}, whoever comes.`
        : `As many as suit the players who come: ${T.defaultRounds(k)} for ${k}.`;
      go.disabled = n < T.MIN_PLAYERS || n > T.MAX_PLAYERS;
      go.textContent = choice.picked.size ? 'Send invites' : 'Set it up';
      picker.limit(n >= T.MAX_PLAYERS);
      bots.limit(n >= T.MAX_PLAYERS);
    }
    paint();
    function send() {
      const t = T.create({ name: name.value, fmt: choice.fmt, bo: choice.bo, rounds: choice.rounds, invite: [...choice.picked], bots: choice.bots, botLevel: choice.lvl });
      if (t.why) { MTG.sfx('reject'); UI.error(t.why); return; }
      MTG.setSetting('tourneyLast', { fmt: choice.fmt, bo: choice.bo, lvl: choice.lvl });
      MTG.sfx('confirm');
      m.close();
      UI.ok(choice.picked.size ? `Invites sent. Start ${t.name} once enough of them are in.` : `${t.name} is set up. Start it when you are ready.`);
      UI.openTourney(t.id);
    }
    return m;
  }

  /* ---------------- inviting more ---------------- */
  /**
   * More friends for `t`: before the start into seats left (a bot giving
   * up its seat, if that is what it takes); once under way, to come in from
   * the next round.
   */
  function inviteMoreWindow(t) {
    const picked = new Set();
    const friends = invitable(t);
    const say = el('div', { class: 'tn-count', 'aria-live': 'polite' });
    const picker = friendPicker(friends, picked, () => paint(), t);
    const late = t.state === 'running';
    const m = UI.modal({
      title: 'Invite more friends', className: 'friends-modal tn-create tn-more', width: 'min(560px, 96vw)',
      content: el('div', { class: 'tn-form' }, [
        el('p', { class: 'small muted', style: { margin: 0 }, text: late
          ? `They come in from round ${t.rnds.length + 1}. The rounds already played count as lost for them, as a late entry does.`
          : 'They are asked the usual way, and can say yes until you start.' }),
        say, picker.el,
      ]),
    });
    m.button('Cancel', (mm) => mm.close(), 'ghost');
    const go = m.button('Send invites', () => send(), 'primary');
    let replace = false;
    function paint() {
      const cur = T.get(t.id);
      if (!cur) return;
      const free = T.MAX_PLAYERS - T.seatsTaken(cur);
      const bots = cur.state === 'inviting' ? cur.players.filter(p => p.bot).length : 0;
      const short = picked.size - free;
      replace = short > 0 && bots >= short;
      say.textContent = (free > 0 ? `${plural(free, 'seat')} left` : `All ${T.MAX_PLAYERS} seats are taken`) +
        (replace ? ` · ${plural(short, 'bot')} would give up ${short === 1 ? 'its seat' : 'their seats'}` : bots && free <= 0 ? ' · a bot can give up its seat' : '');
      say.classList.toggle('bad', short > 0 && !replace);
      go.disabled = !picked.size || (short > 0 && !replace);
      go.textContent = replace ? `Invite, replacing ${plural(short, 'bot')}` : 'Send invites';
      picker.limit(picked.size >= free + bots);
    }
    paint();
    function send() {
      const why = T.invite(t.id, [...picked], { replaceBots: replace });
      if (why) { MTG.sfx('reject'); UI.error(why); return; }
      MTG.sfx('confirm');
      UI.ok(picked.size === 1 ? 'Invite sent.' : 'Invites sent.');
      m.close();
    }
    return m;
  }

  /* ---------------- a tournament's window ---------------- */
  let tw = null;
  /** The tournament window open on `id`, if it is. */
  const windowFor = (id) => (tw && tw.id === id ? tw : null);
  UI.openTourney = function (id) {
    if (!T.get(id)) { UI.error('That tournament is no longer on your list.'); return null; }
    if (tw && tw.id === id) { tw.draw(); return tw.m; }
    if (tw) tw.m.close();
    const status = el('div', { class: 'tn-status', 'aria-live': 'polite' });
    const body = el('div', { class: 'tn-body' });
    const m = UI.modal({ title: T.get(id).name, className: 'friends-modal tn-modal', width: 'min(860px, 96vw)', content: el('div', { class: 'tn-wrap' }, [status, body]) });
    const w = tw = { id, m, round: 0, draw, lvl: defaultLevel() };
    let queued = false;
    const soon = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; if (tw === w) draw(); }, 30); };
    const offs = [T.on('change', (x) => { if (!x || x.id === id) soon(); })];
    m._onClose = () => { offs.forEach(f => f()); if (tw === w) tw = null; };

    function draw() {
      const t = T.get(id);
      m.foot.innerHTML = '';
      if (!t) {
        status.textContent = 'This tournament is no longer on your list.';
        body.innerHTML = '';
        m.button('Close', (mm) => mm.close(), 'primary');
        return;
      }
      m.setTitle(t.name);
      const me = meIn(t);
      const org = t.role === 'org';
      status.className = 'tn-status st-' + t.state + (todo(t) ? ' want' : '');
      status.textContent = statusText(t);
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'tn-facts' }, [
        el('span', { class: 'pill', text: fmtName(t.fmt) }),
        el('span', { class: 'pill', text: `Best of ${t.bo}` }),
        el('span', { class: 'pill', text: t.rounds ? `${t.rounds} round${t.rounds === 1 ? '' : 's'}` : 'Rounds: to suit the players' }),
        el('span', { class: 'tn-by', text: org ? 'You run it' : `Run by ${orgName(t)}` }),
      ]));
      if (t.state === 'inviting') body.appendChild(playersPanel(t, w));
      if (t.state === 'running' && me && me.st !== 'invited') body.appendChild(matchPanel(t));
      if (t.state === 'running' && org) { const p = latePanel(t); if (p) body.appendChild(p); }
      if (t.state === 'done') body.appendChild(winnerPanel(t));
      if (t.rnds.length) body.appendChild(roundPanel(t, w));
      if (t.rnds.length) body.appendChild(standingsPanel(t));
      // the buttons along the foot
      const over = T.isOver(t);
      if (org && t.state === 'inviting') {
        m.button('Call it off', () => callOff(t), 'ghost danger-ghost');
        const ins = t.players.filter(p => p.st === 'in').length;
        const go = m.button(`Start with ${ins}`, () => {
          const why = T.start(t.id);
          if (why) { MTG.sfx('reject'); UI.error(why); } else MTG.sfx('confirm');
        }, 'primary');
        go.disabled = ins < T.MIN_PLAYERS;
        if (go.disabled) go.title = `It needs ${T.MIN_PLAYERS} players, you included.`;
      } else if (T.isInvite(t)) {
        m.button('No thanks', (mm) => { T.answer(t.id, false); mm.close(); }, 'ghost');
        m.button('Join', () => T.answer(t.id, true), 'primary');
      } else if (!over) {
        if (org) m.button('Call it off', () => callOff(t), 'ghost danger-ghost');
        if (me && me.st === 'in') m.button(t.state === 'inviting' ? 'Leave' : 'Drop out', () => dropOut(t), 'ghost');
        m.button('Close', (mm) => mm.close(), 'primary');
      } else {
        m.button('Remove from list', async (mm) => {
          if (await UI.confirm(`Take ${t.name} off your list? Its standings go with it.`, 'Remove a tournament', { yes: 'Remove' })) { T.forget(t.id); mm.close(); }
        }, 'ghost');
        m.button('Close', (mm) => mm.close(), 'primary');
      }
    }
    draw();
    return m;
  };
  function statusText(t) {
    const me = meIn(t);
    if (T.isInvite(t)) {
      return t.state === 'running'
        ? `${orgName(t)} invites you to come in from round ${t.rnds.length + 1}. The rounds already played count as lost for you, as a late entry does.`
        : `${orgName(t)} invites you. Join, and you are paired once ${orgName(t)} starts it.`;
    }
    if (t.state === 'inviting') {
      if (t.role === 'org') {
        const ins = t.players.filter(p => p.st === 'in').length;
        return ins < T.MIN_PLAYERS ? `Waiting for answers. It can start once ${T.MIN_PLAYERS} of you are in, bots included; ${ins} ${ins === 1 ? 'is' : 'are'} so far.`
          : `${ins} players are in. Start whenever you like: whoever has not answered is left out.`;
      }
      return `You are in. Round one is paired when ${orgName(t)} starts it.`;
    }
    if (t.state === 'cancelled') return `${t.role === 'org' ? 'You' : orgName(t)} called it off.`;
    if (t.state === 'done') {
      const st = T.standings(t);
      const mine = me && st.find(r => isMe(r.code));
      return mine ? `It is over. You came ${ordinal(mine.rank)} of ${st.length}.` : 'It is over.';
    }
    const left = t.rnds.length ? t.rnds[t.rnds.length - 1].pairs.filter(p => !p.res).length : 0;
    return `Round ${t.rnds.length} of ${t.rounds}. ` + (left ? `${left} match${left === 1 ? '' : 'es'} still to finish.` : 'All results are in.');
  }
  async function callOff(t) {
    if (!await UI.confirm(`Call off ${t.name}? Everyone is told, and the standings stop where they are.`, 'Call it off', { yes: 'Call it off' })) return;
    T.cancel(t.id);
  }
  async function dropOut(t) {
    const q = t.state === 'inviting' ? `Leave ${t.name}? ${orgName(t)} is told.`
      : t.role === 'org' ? `Stop playing in ${t.name}? You go on running it; a match of yours not yet finished goes to your opponent.`
        : `Drop out of ${t.name}? You are not paired again, and a match of yours not yet finished goes to your opponent.`;
    if (!await UI.confirm(q, 'Drop out', { yes: t.state === 'inviting' ? 'Leave' : 'Drop out' })) return;
    T.leave(t.id);
  }

  /** Before it starts: who is in, who has not answered, the bots; the organiser invites more and adds bots here. */
  function playersPanel(t, w) {
    const org = t.role === 'org';
    const word = { in: 'In', invited: 'Invited · waiting for an answer', declined: 'Said no', dropped: 'Left' };
    const order = { in: 0, invited: 1, declined: 2, dropped: 3 };
    const rows = t.players.slice().sort((a, b) => (order[a.st] - order[b.st]) || ((a.bot ? 1 : 0) - (b.bot ? 1 : 0))).map((p) => {
      const acts = [];
      if (org && !isMe(p.code)) {
        if (p.bot) acts.push(el('button', { type: 'button', class: 'btn sm ghost', text: 'Take off', 'aria-label': `Take ${p.name} off`, onclick: () => T.removeBot(t.id, p.code) }));
        else if (p.st === 'in') acts.push(el('button', { type: 'button', class: 'btn sm ghost', text: 'Take off', 'aria-label': `Take ${p.name} off`, onclick: () => T.drop(t.id, p.code) }));
        else if (p.st === 'invited') acts.push(el('button', { type: 'button', class: 'btn sm ghost', text: 'Withdraw', 'aria-label': `Withdraw ${p.name}’s invitation`, onclick: () => T.uninvite(t.id, p.code) }));
        else if (p.st === 'declined' && T.canInvite(p.code)) {
          acts.push(el('button', { type: 'button', class: 'btn sm', text: 'Invite again', onclick: () => { const why = T.invite(t.id, [p.code]); if (why) UI.error(why); } }));
        }
      }
      return el('div', { class: 'fr-row tn-player p-' + (p.st === 'in' ? 'online' : 'offline') + (p.bot ? ' is-bot' : '') }, [
        face(p.code, p.name),
        el('div', { class: 'fr-who' }, [
          el('div', { class: 'fr-name' }, [nameEl(t, p.code)]),
          el('div', { class: 'fr-pres' }, [el('i', { class: 'fr-dot', 'aria-hidden': 'true' }), el('span', { text: p.bot ? botWords(p.bot) : word[p.st] || '' })]),
        ]),
        el('div', { class: 'fr-acts' }, acts),
      ]);
    });
    const panel = el('section', { class: 'tn-panel' }, [
      el('h3', { class: 'fr-h', text: `Players · ${T.seatsTaken(t)} of ${T.MAX_PLAYERS} seats` }),
      el('div', { class: 'fr-rows' }, rows),
    ]);
    if (org) {
      const free = T.MAX_PLAYERS - T.seatsTaken(t);
      const add = el('button', { type: 'button', class: 'btn sm', text: 'Add a bot', disabled: free <= 0, onclick: () => { const why = T.addBots(t.id, 1, w.lvl); if (why) UI.error(why); } });
      panel.appendChild(el('div', { class: 'tn-more-row' }, [
        el('button', { type: 'button', class: 'btn sm primary', html: `${SVG.plus}<span>Invite more</span>`, onclick: () => inviteMoreWindow(t) }),
        el('div', { class: 'tn-addbot' }, [levelSelect('tn-add-level', w.lvl, (v) => { w.lvl = v; }), add]),
      ]));
    }
    return panel;
  }
  /** Under way: invitations to come in late, and the way to send more. Null when there is nothing to show. */
  function latePanel(t) {
    const waiting = t.players.filter(p => p.st === 'invited');
    const open = T.openToMore(t);
    if (!waiting.length && !open) return null;
    const rows = waiting.map(p => el('div', { class: 'fr-row tn-player p-offline' }, [
      face(p.code, p.name),
      el('div', { class: 'fr-who' }, [el('div', { class: 'fr-name', text: p.name }), el('div', { class: 'fr-pres' }, [el('span', { text: `Invited to come in from round ${t.rnds.length + 1}` })])]),
      el('div', { class: 'fr-acts' }, [el('button', { type: 'button', class: 'btn sm ghost', text: 'Withdraw', onclick: () => T.uninvite(t.id, p.code) })]),
    ]));
    return el('section', { class: 'tn-panel tn-late' }, [
      el('div', { class: 'tn-head' }, [
        el('h3', { class: 'fr-h', text: 'Coming in late' }),
        open ? el('button', { type: 'button', class: 'btn sm', html: `${SVG.plus}<span>Invite more</span>`, onclick: () => inviteMoreWindow(t) }) : null,
      ].filter(Boolean)),
      rows.length ? el('div', { class: 'fr-rows' }, rows) : el('p', { class: 'tiny dim', style: { margin: 0 }, text: 'A friend invited now comes in from the next round; the rounds already played count as lost for them.' }),
    ]);
  }

  /** Your match this round: who, where, and what is left to do. */
  function matchPanel(t) {
    const me = meIn(t);
    const mm = T.myMatch(t);
    const box = el('section', { class: 'tn-match' });
    if (me.st === 'dropped') {
      box.append(el('b', { text: 'You dropped out.' }), el('p', { class: 'small muted', text: 'You are not paired again; the standings carry on without you.' }));
      return box;
    }
    if (!mm) {
      box.append(el('b', { text: `You come in from round ${t.rnds.length + 1}.` }),
        el('p', { class: 'small muted', text: 'You are paired as soon as this round’s results are in.' }));
      return box;
    }
    box.appendChild(el('div', { class: 'eyebrow', text: mm.bye ? `Round ${mm.r}` : `Round ${mm.r} · table ${mm.pair.t}` }));
    if (mm.bye) {
      box.append(el('b', { class: 'tn-vs', text: 'A bye' }), el('p', { class: 'small muted', text: 'It counts as a match won 2–0. Sit this one out; the next round is paired once every result is in.' }));
      return box;
    }
    box.appendChild(el('div', { class: 'tn-vs' }, [face(mm.opp, mm.oppName, 'sm'), el('b', { text: 'You play ' }), nameEl(t, mm.opp)]));
    const lines = [];
    if (mm.res) lines.push(`Settled: ${outcome({ w: mm.res.a, l: mm.res.b, d: mm.res.d })}.`);
    else if (mm.oppBot) {
      if (mm.mine) lines.push(`You reported ${outcome({ w: mm.mine.a, l: mm.mine.b, d: mm.mine.d })}, to be sent when ${orgName(t)} is online.`);
      else {
        lines.push(`${mm.oppName} is a bot (${botWords(mm.oppBot).replace(/^Bot · /, '')}). You play it here, on this device.`);
        lines.push('When the match is over the result goes in by itself, and against a bot your report alone settles it. If it ended another way, report it.');
      }
    } else {
      if (mm.mine && mm.theirs && (mm.mine.a !== mm.theirs.a || mm.mine.b !== mm.theirs.b || mm.mine.d !== mm.theirs.d)) {
        lines.push(`Your reports disagree: you said ${outcome({ w: mm.mine.a, l: mm.mine.b, d: mm.mine.d })}, ${mm.oppName} said ${outcome({ w: mm.theirs.a, l: mm.theirs.b, d: mm.theirs.d })}. ${t.role === 'org' ? 'Set the result below.' : orgName(t) + ' decides.'}`);
      } else if (mm.mine) lines.push(`You reported ${outcome({ w: mm.mine.a, l: mm.mine.b, d: mm.mine.d })}${mm.pending ? ', to be sent when ' + orgName(t) + ' is online' : ''}. Waiting for ${mm.oppName} to report it too.`);
      else if (mm.theirs) lines.push(`${mm.oppName} reported ${outcome({ w: mm.theirs.a, l: mm.theirs.b, d: mm.theirs.d })}. Report it too, and the two settle it.`);
      if (!mm.mine) {
        lines.push(mm.room ? (mm.host ? `Your table is room ${mm.room}. ${mm.oppName} joins it from their note or this window.` : `${mm.oppName}’s table is open: room ${mm.room}.`)
          : mm.host ? `You open the table, and ${mm.oppName} is told its room.` : `${mm.oppName} opens the table; you are told when it is open.`);
        lines.push('When the match is over, the result goes in by itself. If it ended another way (a concession, a lost connection), report it.');
      }
    }
    for (const l of lines) box.appendChild(el('p', { class: 'small tn-line', text: l }));
    const acts = el('div', { class: 'tn-acts' });
    if (!mm.res) {
      if (!mm.mine && mm.oppBot) acts.appendChild(el('button', { type: 'button', class: 'btn primary', text: 'Play your match', onclick: () => playBotMatch(t, mm) }));
      else if (!mm.mine) {
        if (mm.room && !mm.host) acts.appendChild(el('button', { type: 'button', class: 'btn primary', text: 'Join the table', onclick: () => joinMatch(t, mm) }));
        if (mm.host) acts.appendChild(el('button', { type: 'button', class: 'btn' + (mm.room ? '' : ' primary'), text: mm.room ? 'Open it again' : 'Open the table', onclick: () => hostMatch(t, mm) }));
        else if (!mm.room) acts.appendChild(el('button', { type: 'button', class: 'btn ghost', text: 'Open it yourself', title: `If ${mm.oppName} cannot, you can host instead`, onclick: () => hostMatch(t, mm) }));
      }
      acts.appendChild(el('button', { type: 'button', class: 'btn' + (mm.theirs && !mm.mine ? ' primary' : ' ghost'), text: mm.mine ? 'Change my report' : 'Report the result',
        onclick: () => resultPicker(t, mm.r, mm.pair, false) }));
    }
    if (acts.children.length) box.appendChild(acts);
    return box;
  }

  /** The winner, at the end. */
  function winnerPanel(t) {
    const st = T.standings(t);
    const top = st[0];
    if (!top) return el('div');
    return el('section', { class: 'tn-winner' }, [
      el('span', { class: 'tn-cup', html: SVG.cup }),
      el('div', null, [
        el('div', { class: 'eyebrow', text: 'Winner' }),
        el('b', null, [nameEl(t, top.code)]),
        el('div', { class: 'small muted', text: `${top.mp} points · ${top.w}–${top.l}${top.d ? '–' + top.d : ''} in matches` }),
      ]),
    ]);
  }

  /** A round's pairings, any round looked back at; the organiser sets results from here. */
  function roundPanel(t, w) {
    const n = t.rnds.length;
    if (!w.round || w.round > n || (w.lastRounds && w.lastRounds !== n)) w.round = n;
    w.lastRounds = n;
    const org = t.role === 'org' && t.state === 'running';
    const r = w.round;
    const BY = { org: ' · set by the organiser', drop: ' · a drop', sim: ' · played out by the bots’ levels', bot: ' · reported' };
    const rows = t.rnds[r - 1].pairs.map((p) => {
      let state = '', cls = '';
      if (!p.b) { state = 'bye'; cls = 'bye'; }
      else if (p.res) { state = score(p.res.a, p.res.b, p.res.d) + (BY[p.by] || ''); cls = 'done'; }
      else if (T.disputed(p)) { state = 'reports disagree'; cls = 'dispute'; }
      else if (p.rep[p.a] || p.rep[p.b]) { state = 'one report in'; cls = 'half'; }
      else if (T.isBot(p.a) || T.isBot(p.b)) state = 'to play, against a bot';
      else state = p.room ? `playing · room ${p.room}` : 'to play';
      const mine = isMe(p.a) || isMe(p.b);
      return el('div', { class: 'tn-pair ' + cls + (mine ? ' mine' : '') }, [
        el('span', { class: 'tn-table', text: p.b ? String(p.t) : '–', title: p.b ? `Table ${p.t}` : 'A bye' }),
        el('div', { class: 'tn-names' }, [
          nameEl(t, p.a, 'tn-a'),
          p.b ? el('span', { class: 'tn-v', text: 'v' }) : null,
          p.b ? nameEl(t, p.b, 'tn-b') : null,
        ].filter(Boolean)),
        el('span', { class: 'tn-state', text: state }),
        org && p.b && r === n ? el('button', { type: 'button', class: 'btn xs' + (cls === 'dispute' || (cls === 'half' && !T.isBot(p.a) && !T.isBot(p.b)) ? ' primary' : ' ghost'), text: p.res ? 'Change' : 'Set result',
          onclick: () => resultPicker(t, r, p, true) }) : null,
      ].filter(Boolean));
    });
    const head = el('div', { class: 'tn-head' }, [el('h3', { class: 'fr-h', text: 'Pairings' })]);
    if (n > 1) head.appendChild(seg(t.rnds.map((x, i) => [i + 1, `Round ${i + 1}`]), r, (v) => { w.round = v; w.draw(); }, 'Round', 'tn-roundtabs'));
    return el('section', { class: 'tn-panel' }, [head, el('div', { class: 'tn-pairs' }, rows)]);
  }

  /** The standings: points, then the tiebreakers. */
  function standingsPanel(t) {
    const st = T.standings(t);
    const org = t.role === 'org' && t.state === 'running';
    const anyPlayed = st.some(r => r.rounds);
    const head = el('div', { class: 'tn-st-row tn-st-head', role: 'row' }, [
      el('span', { class: 'c-rank', role: 'columnheader', text: '#' }),
      el('span', { class: 'c-name', role: 'columnheader', text: 'Player' }),
      el('span', { class: 'c-pts', role: 'columnheader', text: 'Pts', title: 'Match points: 3 a win, 1 a draw' }),
      el('span', { class: 'c-rec', role: 'columnheader', text: 'W–L–D', title: 'Matches won, lost and drawn' }),
      el('span', { class: 'c-omw', role: 'columnheader', text: 'OMW', title: 'Opponents’ match-win percentage: the first tiebreaker' }),
      el('span', { class: 'c-gw', role: 'columnheader', text: 'GW', title: 'Game-win percentage: the second tiebreaker' }),
      el('span', { class: 'c-ogw', role: 'columnheader', text: 'OGW', title: 'Opponents’ game-win percentage: the third tiebreaker' }),
    ]);
    const rows = st.map(r => el('div', { class: 'tn-st-row' + (isMe(r.code) ? ' me' : '') + (r.st === 'dropped' ? ' dropped' : '') + (r.bot ? ' is-bot' : ''), role: 'row' }, [
      el('span', { class: 'c-rank', role: 'cell', text: String(r.rank) }),
      el('span', { class: 'c-name', role: 'cell' }, [
        el('span', { class: 'tn-pname', text: r.name + (isMe(r.code) ? ' (you)' : '') }),
        r.bot ? botBadge(r.bot) : null,
        r.st === 'dropped' ? el('span', { class: 'tn-tag', text: 'dropped' }) : null,
        r.late ? el('span', { class: 'tn-tag', text: `from round ${r.late + 1}`, title: 'Came in late: the rounds before count as lost' }) : null,
        org && r.st === 'in' && !r.bot && !isMe(r.code) ? el('button', { type: 'button', class: 'btn xs ghost tn-drop', text: 'Drop', 'aria-label': `Drop ${r.name}`,
          onclick: async () => { if (await UI.confirm(`Drop ${r.name}? They are not paired again, and a match of theirs not yet finished goes to their opponent.`, 'Drop a player', { yes: 'Drop' })) T.drop(t.id, r.code); } }) : null,
      ].filter(Boolean)),
      el('span', { class: 'c-pts', role: 'cell', text: String(r.mp) }),
      el('span', { class: 'c-rec', role: 'cell', text: `${r.w}–${r.l}–${r.d}` }),
      el('span', { class: 'c-omw', role: 'cell', text: r.opps.length ? pct(r.omw) : '—' }),
      el('span', { class: 'c-gw', role: 'cell', text: r.rounds ? pct(r.gwp) : '—' }),
      el('span', { class: 'c-ogw', role: 'cell', text: r.opps.length ? pct(r.ogw) : '—' }),
    ]));
    return el('section', { class: 'tn-panel' }, [
      el('h3', { class: 'fr-h', text: t.state === 'done' ? 'Final standings' : 'Standings' }),
      el('div', { class: 'tn-stand', role: 'table', 'aria-label': 'Standings' }, [head].concat(rows)),
      anyPlayed ? el('p', { class: 'tiny dim tn-why', text: 'Level on points, the higher OMW% (how well your opponents did) goes first, then GW%, then OGW%; none counts below 33%.' }) : null,
    ].filter(Boolean));
  }

  /* ---------------- a result, by hand ---------------- */
  /**
   * Pick a match's result: a player says how their own match went (from
   * their side); the organiser sets any match (by name).
   */
  function resultPicker(t, r, pair, asOrg) {
    const me = T.me();
    const flipIt = !asOrg && pair.b === me;              // a player's side first
    const left = asOrg ? T.nameOf(t, pair.a) : 'You';
    const right = asOrg ? T.nameOf(t, pair.b) : T.nameOf(t, pair.a === me ? pair.b : pair.a);
    const vsBot = T.isBot(pair.a) || T.isBot(pair.b);
    const n = T.need(t.bo);
    // nothing chosen until something is: a draw of no games is a result too, but not one to send by accident
    const v = { a: 0, b: 0, d: 0, set: false };
    const quick = t.bo === 1 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[2, 0, 0], [2, 1, 0], [1, 2, 0], [0, 2, 0], [1, 1, 1]];
    const label = (q) => (q[0] > q[1] ? `${asOrg ? left + ' wins' : 'I won'} ${score(q[0], q[1], q[2])}`
      : q[1] > q[0] ? `${asOrg ? right + ' wins' : 'I lost'} ${score(q[0], q[1], q[2])}` : `Drawn ${score(q[0], q[1], q[2])}`);
    const chips = el('div', { class: 'tn-quick' });
    const said = el('p', { class: 'small tn-said', 'aria-live': 'polite' });
    const steppers = el('div', { class: 'tn-steps' });
    const draw = () => {
      chips.innerHTML = '';
      for (const q of quick) {
        const on = v.set && v.a === q[0] && v.b === q[1] && v.d === q[2];
        chips.appendChild(el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', text: label(q),
          onclick: () => { v.a = q[0]; v.b = q[1]; v.d = q[2]; v.set = true; draw(); } }));
      }
      steppers.innerHTML = '';
      for (const [k, who, max] of [['a', asOrg ? `${left}’s games` : 'Your games', n], ['b', `${right}’s games`, n], ['d', 'Drawn games', t.bo]]) {
        steppers.appendChild(el('div', { class: 'tn-step' }, [
          el('span', { class: 'tn-step-l', text: who }),
          el('button', { type: 'button', class: 'btn xs', text: '−', 'aria-label': `One fewer: ${who}`, disabled: v[k] <= 0, onclick: () => { v[k]--; v.set = true; draw(); } }),
          el('b', { class: 'tn-step-n', text: String(v[k]) }),
          el('button', { type: 'button', class: 'btn xs', text: '+', 'aria-label': `One more: ${who}`, disabled: v[k] >= max, onclick: () => { v[k]++; v.set = true; draw(); } }),
        ]));
      }
      const ok = v.set && !!T.cleanResult(v, t.bo);
      said.textContent = !v.set ? 'Pick how it ended.' : ok ? (v.a > v.b ? `${asOrg ? left + ' wins' : 'You won'} ${score(v.a, v.b, v.d)}.` : v.b > v.a ? `${asOrg ? right + ' wins' : 'You lost'} ${score(v.a, v.b, v.d)}.` : `A draw, ${score(v.a, v.b, v.d)}.`)
        : `A best-of-${t.bo} match cannot end ${score(v.a, v.b, v.d)}.`;
      said.classList.toggle('bad', v.set && !ok);
      if (sendBtn) sendBtn.disabled = !ok;
    };
    const intro = asOrg ? 'Set the result. It counts as it is, whatever the players reported.'
      : vsBot ? 'Say how it went. Against a bot, your report settles it.'
        : `Say how it went. If ${right} says the same, it is settled; if not, ${t.role === 'org' ? 'you decide as the organiser' : orgName(t) + ' decides'}.`;
    const m = UI.modal({
      title: asOrg ? `Table ${pair.t}: ${left} v ${right}` : `Your match against ${right}`, className: 'friends-modal tn-pick', width: 'min(520px, 96vw)',
      content: el('div', { class: 'tn-pickbody' }, [
        el('p', { class: 'small muted', style: { marginTop: 0 }, text: intro }),
        chips, el('div', { class: 'tn-or tiny dim', text: 'Or game by game:' }), steppers, said,
      ]),
    });
    m.button('Cancel', (mm) => mm.close(), 'ghost');
    const sendBtn = m.button(asOrg ? 'Set result' : 'Send', () => {
      if (!v.set || !T.cleanResult(v, t.bo)) return;
      if (asOrg) {
        const why = T.setResult(t.id, r, pair.t, { a: v.a, b: v.b, d: v.d });
        if (why) { UI.error(why); return; }
      } else {
        const got = T.report(t.id, r, pair.t, v.a, v.b, v.d, false);
        if (got.why) { UI.error(got.why); return; }
        UI.ok(got.sent ? 'Result sent.' : `Result kept: it goes to ${orgName(t)} when they are online.`);
      }
      MTG.sfx('confirm');
      m.close();
    }, 'primary');
    // what was reported already, to start from
    const had = asOrg ? (pair.res || (T.disputed(pair) ? null : pair.rep[pair.a] || pair.rep[pair.b])) : (pair.rep[me] ? (flipIt ? { a: pair.rep[me].b, b: pair.rep[me].a, d: pair.rep[me].d } : pair.rep[me]) : null);
    if (had) Object.assign(v, { a: had.a, b: had.b, d: had.d, set: true });
    draw();
    return m;
  }

  /* ---------------- to the table ---------------- */
  function closeWindows() {
    if (tw) tw.m.close();
    if (UI.closeFriends) UI.closeFriends();
  }
  async function hostMatch(t, mm) {
    const app = A();
    if (!app.hostTableFor) return UI.error('A table cannot be opened from here.');
    if (net.peerAvailable && !net.peerAvailable()) return UI.error('The connection library did not load, so no table can be opened.');
    if (UI.leaveTableFirst && !await UI.leaveTableFirst({ question: `Leave this table to open your match against ${mm.oppName}?`, title: 'Your tournament match', yes: 'Leave and open it' })) return;
    if (UI.haveName && !await UI.haveName()) return;
    closeWindows();
    const room = await app.hostTableFor({
      formatId: t.fmt, rules: { bestOf: t.bo },
      mode: { tourney: { id: t.id, r: mm.r, t: mm.pair.t, opp: mm.oppName } },
    });
    if (!room) return;
    // the round may have moved on while the room was opening (the organiser set the result)
    if (T.roomOpened(t.id, mm.r, mm.pair.t, room)) UI.ok(`Room ${room} is open. ${mm.oppName} is told.`);
    else UI.toast(`Room ${room} is open, but that match is no longer waiting to be played.`, '', 5000);
  }
  function joinMatch(t, mm) {
    if (!mm.room) return;
    closeWindows();
    if (UI.joinFriendRoom) UI.joinFriendRoom(mm.room, mm.oppName);
    else if (A().joinRoom) A().joinRoom(mm.room);
  }
  /** A match against a bot: a table here, the bot seated as the tournament has it, your deck to choose. */
  async function playBotMatch(t, mm) {
    const app = A();
    if (!app.botTableFor) return UI.error('A table cannot be opened from here.');
    if (UI.leaveTableFirst && !await UI.leaveTableFirst({ question: `Leave this table to play your match against ${mm.oppName}?`, title: 'Your tournament match', yes: 'Leave and play' })) return;
    closeWindows();
    app.botTableFor({
      formatId: t.fmt, rules: { bestOf: t.bo },
      bot: { name: mm.oppName, difficulty: mm.oppBot.lvl, personality: mm.oppBot.style || '' },
      mode: { tourney: { id: t.id, r: mm.r, t: mm.pair.t, opp: mm.oppName, bot: true } },
    });
  }

  /** In the lobby of a tournament's match: which match, and that its result goes in by itself. */
  UI.tourneyLobbyNote = function (info) {
    const t = info && T.get(info.id);
    if (!t) return null;
    const opp = info.opp || 'your opponent';
    const what = info.bot ? `${opp} is a bot, at the tournament’s own level: choose your deck and start.`
      : info.guest ? `Choose your deck; ${opp} starts the match once you both have.`
        : `Choose your deck; once ${opp} has joined and chosen theirs, start.`;
    return el('section', { class: 'panel tn-lobby' }, [
      el('div', { class: 'eyebrow', text: 'Tournament match' }),
      el('b', { text: `${t.name} · round ${info.r}` }),
      el('p', { class: 'small muted', text: `Against ${opp}, best of ${t.bo}. ${what} The result goes to ${t.role === 'org' ? 'the standings' : orgName(t)} by itself when the match is over.` }),
    ]);
  };
  /** The same, in a guest's lobby: found by the room joined, if it is a tournament match's. */
  UI.tourneyRoomNote = function (room) {
    for (const t of T.active()) {
      const mm = t.state === 'running' ? T.myMatch(t) : null;
      if (mm && !mm.bye && !mm.res && !mm.oppBot && room && T.roomsOf(t, mm.r, mm.pair).includes(room)) return UI.tourneyLobbyNote({ id: t.id, r: mm.r, t: mm.pair.t, opp: mm.oppName, guest: true });
    }
    return null;
  };

  /* ---------------- notes ---------------- */
  const note = (o) => (UI.socialNote ? UI.socialNote(o) : null);
  T.on('change', () => { if (UI.socialChanged) UI.socialChanged(); });
  T.on('invite', (t) => {
    note({
      key: 'tn-' + t.id, face: face(t.org, orgName(t), 'sm'), title: `${orgName(t)} invites you to a tournament`,
      text: `${t.name} · ${fmtName(t.fmt)}, best of ${t.bo}` + (t.state === 'running' ? ` · from round ${t.rnds.length + 1}` : ''), life: 60000,
      buttons: [
        { label: 'Not now', cls: 'ghost', fn: () => {} },
        { label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) },
      ],
    });
  });
  T.on('paired', (t, p, r) => {
    if (windowFor(t.id)) return;
    const mm = T.myMatch(t);
    if (!mm) return;
    const latest = () => { const now = T.get(t.id); const m2 = now && T.myMatch(now); return m2 && !m2.res ? [now, m2] : null; };
    let text, buttons;
    if (mm.bye) { text = 'It counts as a match won 2–0.'; buttons = [{ label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) }]; }
    else if (mm.oppBot) {
      text = `${mm.oppName} is a bot (${levelLabel(mm.oppBot.lvl)}). You play it on this device.`;
      buttons = [{ label: 'Later', cls: 'ghost', fn: () => {} }, { label: 'Play your match', cls: 'primary', fn: () => { const x = latest(); if (x) playBotMatch(x[0], x[1]); } }];
    } else if (mm.host) {
      text = 'You open the table.';
      buttons = [{ label: 'Later', cls: 'ghost', fn: () => {} }, { label: 'Open the table', cls: 'primary', fn: () => { const x = latest(); if (x) hostMatch(x[0], x[1]); } }];
    } else {
      text = `${mm.oppName} opens the table; you are told when it is open.`;
      buttons = [{ label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) }];
    }
    note({
      key: 'tn-' + t.id, face: mm.bye ? null : face(mm.opp, mm.oppName, 'sm'),
      title: mm.bye ? `${t.name}, round ${r}: a bye` : `${t.name}, round ${r}: you play ${mm.oppName}`, text, life: 45000, buttons,
    });
  });
  T.on('room', (t, p, room) => {
    const mm = T.myMatch(t);
    if (!mm || mm.bye || mm.res || mm.host || mm.oppBot) return;
    // the same key as a friend's own invite to that room, so there is one note, not two
    note({
      key: 'inv-' + mm.opp, face: face(mm.opp, mm.oppName, 'sm'), title: `${mm.oppName}’s table is open`,
      text: `${t.name}, round ${mm.r} · room ${room}`, life: 60000,
      buttons: [
        { label: 'Not now', cls: 'ghost', fn: () => {} },
        { label: 'Join', cls: 'primary', fn: () => joinMatch(t, Object.assign({}, mm, { room })) },
      ],
    });
  });
  T.on('settled', (t, p) => {
    const mm = T.myMatch(t);
    if (mm && mm.res) UI.toast(`${t.name}: your match is settled, ${outcome({ w: mm.res.a, l: mm.res.b, d: mm.res.d })}.`, 'ok', 4200);
  });
  T.on('reported', (t, p, mine, auto) => {
    if (!auto) return;
    const said = outcome({ w: mine.a, l: mine.b, d: mine.d });
    const vsBot = T.isBot(p.a) || T.isBot(p.b);
    UI.toast(`${t.name}: ${said[0].toUpperCase() + said.slice(1)}. ${t.role === 'org' ? (vsBot ? 'It is in the standings.' : 'It is in the standings once your opponent agrees.') : 'The result is sent to ' + orgName(t) + '.'}`, 'ok', 5000);
  });
  T.on('dispute', (t, p, r) => {
    if (windowFor(t.id)) return;
    note({
      key: 'tn-d-' + t.id, face: null, title: `${t.name}: results disagree at table ${p.t}`,
      text: `${T.nameOf(t, p.a)} and ${T.nameOf(t, p.b)} reported different results. Set the one that counts.`, life: 60000,
      buttons: [{ label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) }],
    });
  });
  T.on('finished', (t) => {
    const st = T.standings(t);
    const mine = st.find(r => isMe(r.code));
    note({
      key: 'tn-' + t.id, face: null, title: `${t.name} is over`,
      text: mine ? `You came ${ordinal(mine.rank)} of ${st.length}.` + (mine.rank === 1 ? ' Well played!' : '') : `Won by ${st[0] ? st[0].name : 'nobody'}.`, life: 45000,
      buttons: [{ label: 'Standings', cls: 'primary', fn: () => UI.openTourney(t.id) }],
    });
    if (mine && mine.rank === 1) MTG.sfx('confirm');
  });
  T.on('cancelled', (t) => UI.toast(`${orgName(t)} called off ${t.name}.`, '', 4200));
  T.on('removed', (t, why) => UI.toast(why, '', 4200));

  /* ---------------- the table, watched for a match's end ---------------- */
  /** Look at a view as it arrives: a tournament match decided at this table is reported, once. */
  function seeView(table, v) {
    if (!v || !v.over) return;
    const key = (v.game || '') + ':' + ((v.match && v.match.gameNumber) || 0);
    if (table._tourneySeen === key) return;
    const res = T.resultFromView(v, table.ownId || table.meId);
    if (!res) return;
    table._tourneySeen = key;
    // a match against a bot is played here, and known by the table it was set up as
    const s = A().session;
    const info = s && s.mode && s.mode.tourney;
    if (info && info.bot) { T.botGameOver(info, res); return; }
    if (net.online && net.roomCode) T.gameOver(net.roomCode, res);
  }
  function watchTables() {
    const Table = UI.Table;
    if (!Table || Table.prototype._tourneyWatched) return;
    const base = Table.prototype.update;
    Table.prototype.update = function (view) {
      try { seeView(this, view); } catch (e) { console.warn('[tourney]', e); }
      return base.apply(this, arguments);
    };
    Table.prototype._tourneyWatched = true;
  }
  MTG.bus.on('app:ready', watchTables);

  /* ---------------- the table, saying which match it is ----------------
     The host of a tournament match tells each guest, over the game's own
     connection, which match the table is for; the guest's app believes it
     only as far as its own copy of the tournament agrees (T.tableNote). */
  function tellTable(peerId) {
    const s = A().session;
    const info = s && s.mode && s.mode.tourney;
    if (!net.isHost || !info || info.bot || !T.get(info.id)) return;
    net.send(peerId, { t: 'tourney:table', id: info.id, r: info.r, tb: info.t, host: T.me() });
  }
  if (net && net.on) {
    net.on('peer:join', (peerId) => { try { tellTable(peerId); } catch (e) { console.warn('[tourney]', e); } });
    net.on('message', (from, msg) => {
      if (!msg || msg.t !== 'tourney:table' || !net.isClient || from !== 'host') return;
      try { T.tableNote(msg, net.roomCode); } catch (e) { console.warn('[tourney]', e); }
    });
  }
  // what tools/tournamenttest.js drives directly
  UI.tourneySeeView = seeView;
})(window.MTG);
