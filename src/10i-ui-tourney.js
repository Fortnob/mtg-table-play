/* ============================================================
   10i-ui-tourney.js - friends tournaments on screen (src/09f-tourney.js
   holds the logic)

   The Friends window's Tournaments tab: invitations, the tournaments
   under way, and the finished ones. Setting one up: a name, a format, the
   match length, how many rounds, and the friends to invite. A
   tournament's own window: your match this round (open the table, join
   it, report the result), the round's pairings, and the standings; the
   organiser sets results and drops players from there too. Notes say
   when you are invited, paired, when your table is open and when it is
   over.

   A match is played at an ordinary table: the host's opens with the
   tournament's format and match length (MTG.app.hostTableFor), and the
   other player joins it by its room code. The table is watched here, so
   the match's result goes to the organiser by itself once it is decided.
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
  function outcome(r) {
    if (r.w > r.l) return `you won ${score(r.w, r.l, r.d)}`;
    if (r.l > r.w) return `you lost ${score(r.w, r.l, r.d)}`;
    return `a draw, ${score(r.w, r.l, r.d)}`;
  }
  function stateLine(t) {
    if (t.state === 'inviting') {
      const ins = t.players.filter(p => p.st === 'in').length;
      return `Waiting for answers · ${ins} of ${t.players.filter(p => p.st !== 'declined').length} in`;
    }
    if (t.state === 'running') return `Round ${t.rnds.length} of ${t.rounds}`;
    if (t.state === 'cancelled') return 'Called off';
    return 'Finished';
  }
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
    if (mm.room && !mm.host && !mm.mine) return 'join';
    if (mm.theirs && !mm.mine) return 'report';
    return '';
  }

  /* ---------------- the Friends window's tab ---------------- */
  UI.tourneysTab = function (body) {
    const lists = el('div', { class: 'fr-lists tn-lists' });
    body.append(
      el('div', { class: 'tn-tabhead' }, [
        el('p', { class: 'small muted fr-intro', text: 'Swiss tournaments among your friends. You invite them; the app pairs every round, takes in the results and keeps the standings. Each match is played at a table one of the two opens.' }),
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
          el('span', { text: 'Start one for three to sixteen players, you included: New tournament, then pick the friends to invite.' }),
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
    return tnRow(face(t.org, orgName(t)), `${orgName(t)} invites you: ${t.name}`, `${facts(t)} · ${t.players.filter(p => p.st === 'in').length} in so far`, [
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
    else if (mm && mm.oppName) sub += ` · ${mm.res ? 'done against' : 'you play'} ${mm.oppName}`;
    const want = todo(t);
    return tnRow(cupIcon(), t.name, sub, [
      el('button', { type: 'button', class: 'btn sm' + (want ? ' primary' : ''), text: want === 'join' ? 'Join table' : want === 'report' ? 'Report' : 'Open',
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

  /* ---------------- setting one up ---------------- */
  function createWindow() {
    const friends = hub().entries().filter(f => f.state === 'friend')
      .sort((a, b) => (b.online - a.online) || (a.name || '').localeCompare(b.name || ''));
    if (friends.length < T.MIN_PLAYERS - 1) {
      UI.error(`A tournament needs at least ${T.MIN_PLAYERS} players, you included. Add ${T.MIN_PLAYERS - 1 - friends.length === 1 ? 'one more friend' : 'a couple of friends'} first.`);
      return null;
    }
    const formats = MTG.formats.list().filter(f => f.kind !== 'limited');
    const was = MTG.settings.tourneyLast || {};
    const choice = {
      fmt: formats.some(f => f.id === was.fmt) ? was.fmt : (formats.some(f => f.id === A().formatId) ? A().formatId : 'standard'),
      bo: was.bo === 1 ? 1 : 3, rounds: 0, picked: new Set(),
    };
    const name = el('input', { type: 'text', id: 'tn-name', class: 'tn-input', maxlength: '40', value: `${hub().myName()}’s tournament`, autocomplete: 'off', 'aria-label': 'The tournament’s name' });
    const fmtSel = el('select', { id: 'tn-fmt', 'aria-label': 'Format' }, formats.map(f => el('option', { value: f.id, text: f.name, selected: f.id === choice.fmt })));
    fmtSel.addEventListener('change', () => { choice.fmt = fmtSel.value; });
    const roundsHint = el('div', { class: 'tn-hint' });
    const count = el('div', { class: 'tn-count', 'aria-live': 'polite' });
    const list = el('div', { class: 'fr-rows tn-pick-friends' });
    const field = (label, control, forId) => el('div', { class: 'tn-field' }, [el('label', { class: 'tn-label', for: forId || null, text: label }), control]);
    const roundSeg = seg([[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], 0, (v) => { choice.rounds = v; paint(); }, 'Rounds', 'seg-wrap tn-rounds');
    const m = UI.modal({
      title: 'New tournament', className: 'friends-modal tn-create', width: 'min(620px, 96vw)',
      content: el('div', { class: 'tn-form' }, [
        field('Name', name, 'tn-name'),
        field('Format', fmtSel, 'tn-fmt'),
        field('Matches', seg([[1, 'Best of 1'], [3, 'Best of 3']], choice.bo, (v) => { choice.bo = v; }, 'Match length', 'tn-bo')),
        field('Rounds', el('div', { class: 'tn-roundbox' }, [roundSeg, roundsHint])),
        el('div', { class: 'tn-field' }, [el('div', { class: 'tn-label', text: 'Invite' }), count, list]),
      ]),
    });
    m.button('Cancel', (mm) => mm.close(), 'ghost');
    const go = m.button('Send invites', () => send(), 'primary');
    function paint() {
      const n = choice.picked.size + 1;
      count.textContent = `${n} player${n === 1 ? '' : 's'}, you included · ${T.MIN_PLAYERS} to ${T.MAX_PLAYERS}`;
      count.classList.toggle('bad', n < T.MIN_PLAYERS);
      roundsHint.textContent = choice.rounds ? `${choice.rounds} round${choice.rounds === 1 ? '' : 's'}, whoever comes.`
        : `As many as suit the players who come: ${T.defaultRounds(Math.max(T.MIN_PLAYERS, n))} for ${Math.max(T.MIN_PLAYERS, n)}.`;
      go.disabled = n < T.MIN_PLAYERS;
      for (const b of list.querySelectorAll('input[type=checkbox]')) b.disabled = !b.checked && n >= T.MAX_PLAYERS;
    }
    for (const f of friends) {
      const box = el('input', { type: 'checkbox', id: 'tn-f-' + f.code, 'aria-label': `Invite ${f.name || F.formatCode(f.code)}` });
      box.addEventListener('change', () => { if (box.checked) choice.picked.add(f.code); else choice.picked.delete(f.code); paint(); });
      list.appendChild(el('label', { class: 'fr-row tn-friend p-' + f.presence, for: 'tn-f-' + f.code }, [
        face(f.code, f.name),
        el('div', { class: 'fr-who' }, [
          el('div', { class: 'fr-name', text: f.name || F.formatCode(f.code) }),
          el('div', { class: 'fr-pres' }, [el('i', { class: 'fr-dot', 'aria-hidden': 'true' }), el('span', { text: f.online ? 'Online' : 'Offline · invited when they are back' })]),
        ]),
        box,
      ]));
    }
    paint();
    function send() {
      const t = T.create({ name: name.value, fmt: choice.fmt, bo: choice.bo, rounds: choice.rounds, invite: [...choice.picked] });
      if (t.why) { MTG.sfx('reject'); UI.error(t.why); return; }
      MTG.setSetting('tourneyLast', { fmt: choice.fmt, bo: choice.bo });
      MTG.sfx('confirm');
      m.close();
      UI.ok(`Invites sent. Start ${t.name} once enough of them are in.`);
      UI.openTourney(t.id);
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
    const w = tw = { id, m, round: 0, draw };
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
      if (t.state === 'inviting') body.appendChild(playersPanel(t));
      if (t.state === 'running' && me) body.appendChild(matchPanel(t));
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
    if (t.state === 'inviting') {
      if (T.isInvite(t)) return `${orgName(t)} invites you. Join, and you are paired once ${orgName(t)} starts it.`;
      if (t.role === 'org') {
        const ins = t.players.filter(p => p.st === 'in').length;
        return ins < T.MIN_PLAYERS ? `Waiting for answers. It can start once ${T.MIN_PLAYERS} of you are in; ${ins} ${ins === 1 ? 'is' : 'are'} so far.`
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

  /** Before it starts: who is in, who has not answered. */
  function playersPanel(t) {
    const org = t.role === 'org';
    const word = { in: 'In', invited: 'Not answered yet', declined: 'Said no', dropped: 'Left' };
    const rows = t.players.slice().sort((a, b) => (a.st === 'in' ? 0 : 1) - (b.st === 'in' ? 0 : 1)).map(p => el('div', { class: 'fr-row tn-player p-' + (p.st === 'in' ? 'online' : 'offline') }, [
      face(p.code, p.name),
      el('div', { class: 'fr-who' }, [
        el('div', { class: 'fr-name', text: p.name + (isMe(p.code) ? ' (you)' : '') }),
        el('div', { class: 'fr-pres' }, [el('i', { class: 'fr-dot', 'aria-hidden': 'true' }), el('span', { text: word[p.st] || '' })]),
      ]),
      el('div', { class: 'fr-acts' }, org && !isMe(p.code) && (p.st === 'in' || p.st === 'invited')
        ? [el('button', { type: 'button', class: 'btn sm ghost', text: 'Take off', onclick: () => T.drop(t.id, p.code) })] : []),
    ]));
    return el('section', { class: 'tn-panel' }, [el('h3', { class: 'fr-h', text: 'Players' }), el('div', { class: 'fr-rows' }, rows)]);
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
    if (!mm) return box;
    box.appendChild(el('div', { class: 'eyebrow', text: mm.bye ? `Round ${mm.r}` : `Round ${mm.r} · table ${mm.pair.t}` }));
    if (mm.bye) {
      box.append(el('b', { class: 'tn-vs', text: 'A bye' }), el('p', { class: 'small muted', text: 'It counts as a match won 2–0. Sit this one out; the next round is paired once every result is in.' }));
      return box;
    }
    box.appendChild(el('div', { class: 'tn-vs' }, [face(mm.opp, mm.oppName, 'sm'), el('b', { text: `You play ${mm.oppName}` })]));
    const lines = [];
    if (mm.res) lines.push(`Settled: ${outcome({ w: mm.res.a, l: mm.res.b, d: mm.res.d })}.`);
    else {
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
      if (!mm.mine) {
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
        el('b', { text: top.name + (isMe(top.code) ? ' (you)' : '') }),
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
    const rows = t.rnds[r - 1].pairs.map((p) => {
      const nameA = T.nameOf(t, p.a), nameB = p.b ? T.nameOf(t, p.b) : '';
      let state = '', cls = '';
      if (!p.b) { state = 'bye'; cls = 'bye'; }
      else if (p.res) { state = score(p.res.a, p.res.b, p.res.d) + (p.by === 'org' ? ' · set by the organiser' : p.by === 'drop' ? ' · a drop' : ''); cls = 'done'; }
      else if (T.disputed(p)) { state = 'reports disagree'; cls = 'dispute'; }
      else if (p.rep[p.a] || p.rep[p.b]) { state = 'one report in'; cls = 'half'; }
      else { state = p.room ? `playing · room ${p.room}` : 'to play'; }
      const mine = isMe(p.a) || isMe(p.b);
      return el('div', { class: 'tn-pair ' + cls + (mine ? ' mine' : '') }, [
        el('span', { class: 'tn-table', text: p.b ? String(p.t) : '–', title: p.b ? `Table ${p.t}` : 'A bye' }),
        el('div', { class: 'tn-names' }, [
          el('span', { class: 'tn-a', text: nameA }),
          p.b ? el('span', { class: 'tn-v', text: 'v' }) : null,
          p.b ? el('span', { class: 'tn-b', text: nameB }) : null,
        ].filter(Boolean)),
        el('span', { class: 'tn-state', text: state }),
        org && p.b && r === n ? el('button', { type: 'button', class: 'btn xs' + (cls === 'dispute' || cls === 'half' ? ' primary' : ' ghost'), text: p.res ? 'Change' : 'Set result',
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
    const rows = st.map(r => el('div', { class: 'tn-st-row' + (isMe(r.code) ? ' me' : '') + (r.st === 'dropped' ? ' dropped' : ''), role: 'row' }, [
      el('span', { class: 'c-rank', role: 'cell', text: String(r.rank) }),
      el('span', { class: 'c-name', role: 'cell' }, [
        el('span', { class: 'tn-pname', text: r.name + (isMe(r.code) ? ' (you)' : '') }),
        r.st === 'dropped' ? el('span', { class: 'tn-tag', text: 'dropped' }) : null,
        org && r.st === 'in' && !isMe(r.code) ? el('button', { type: 'button', class: 'btn xs ghost tn-drop', text: 'Drop', 'aria-label': `Drop ${r.name}`,
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
    const m = UI.modal({
      title: asOrg ? `Table ${pair.t}: ${left} v ${right}` : `Your match against ${right}`, className: 'friends-modal tn-pick', width: 'min(520px, 96vw)',
      content: el('div', { class: 'tn-pickbody' }, [
        el('p', { class: 'small muted', style: { marginTop: 0 }, text: asOrg ? 'Set the result. It counts as it is, whatever the players reported.'
          : `Say how it went. If ${right} says the same, it is settled; if not, ${t.role === 'org' ? 'you decide as the organiser' : orgName(t) + ' decides'}.` }),
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

  /** In the lobby of a tournament's match: which match, and that its result goes in by itself. */
  UI.tourneyLobbyNote = function (info) {
    const t = info && T.get(info.id);
    if (!t) return null;
    return el('section', { class: 'panel tn-lobby' }, [
      el('div', { class: 'eyebrow', text: 'Tournament match' }),
      el('b', { text: `${t.name} · round ${info.r}` }),
      el('p', { class: 'small muted', text: `Against ${info.opp || 'your opponent'}, best of ${t.bo}. Choose your deck; once ${info.opp || 'they'} ${info.opp ? 'has' : 'have'} joined and chosen theirs, start. The result goes to ${t.role === 'org' ? 'the standings' : orgName(t)} by itself when the match is over.` }),
    ]);
  };

  /* ---------------- notes ---------------- */
  const note = (o) => (UI.socialNote ? UI.socialNote(o) : null);
  T.on('change', () => { if (UI.socialChanged) UI.socialChanged(); });
  T.on('invite', (t) => {
    note({
      key: 'tn-' + t.id, face: face(t.org, orgName(t), 'sm'), title: `${orgName(t)} invites you to a tournament`,
      text: `${t.name} · ${fmtName(t.fmt)}, best of ${t.bo}`, life: 60000,
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
    note({
      key: 'tn-' + t.id, face: mm.bye ? null : face(mm.opp, mm.oppName, 'sm'),
      title: mm.bye ? `${t.name}, round ${r}: a bye` : `${t.name}, round ${r}: you play ${mm.oppName}`,
      text: mm.bye ? 'It counts as a match won 2–0.' : mm.host ? 'You open the table.' : `${mm.oppName} opens the table; you are told when it is open.`, life: 45000,
      buttons: mm.bye ? [{ label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) }]
        : mm.host ? [{ label: 'Later', cls: 'ghost', fn: () => {} }, { label: 'Open the table', cls: 'primary', fn: () => { const now = T.get(t.id); const m2 = now && T.myMatch(now); if (m2 && !m2.res) hostMatch(now, m2); } }]
          : [{ label: 'Open', cls: 'primary', fn: () => UI.openTourney(t.id) }],
    });
  });
  T.on('room', (t, p, room) => {
    const mm = T.myMatch(t);
    if (!mm || mm.bye || mm.res || mm.host) return;
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
    UI.toast(`${t.name}: ${said[0].toUpperCase() + said.slice(1)}. ${t.role === 'org' ? 'It is in the standings once your opponent agrees.' : 'The result is sent to ' + orgName(t) + '.'}`, 'ok', 5000);
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
    if (!v || !v.over || !net.online || !net.roomCode) return;
    const key = (v.game || '') + ':' + ((v.match && v.match.gameNumber) || 0);
    if (table._tourneySeen === key) return;
    const res = T.resultFromView(v, table.meId);
    if (!res) return;
    table._tourneySeen = key;
    T.gameOver(net.roomCode, res);
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
  // what tools/tournamenttest.js drives directly
  UI.tourneySeeView = seeView;
})(window.MTG);
