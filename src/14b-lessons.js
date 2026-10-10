/* ============================================================
   14b-lessons.js - the tutorials: short lessons after the first game

   The guided first game (src/12e-ui-coach.js) shows a whole game: a land
   tapped for mana, a creature, the big button, attacking and blocking.
   These go a step further, one idea each, on a small board set up for it:
   answering a spell with an instant, a trick in the middle of a fight,
   blocking well, and countering a spell. Each ends with the way on to the
   next one, never a rematch; the result of the last leads back to the
   list. Lands are tapped the way the player's own Tap lands for me says:
   the first game has taught both.

   Each lesson is a real game, built the way a challenge is (src/14-app.js)
   and played by the real rules, against a bot that is told what to do: it
   casts the spell the lesson is about, attacks with what it should and
   blocks the way a sensible player would, and otherwise only passes. So
   the moment the lesson is about always comes round, with coach notes
   over the table as the first game has. Getting it right pays a few
   Shards, once, and marks the lesson done in the list.

   The boards, the bot's orders and the judging read only the engine, so
   tools/lessontest.js plays every lesson through headless, right and
   wrong. The rest (the list, the notes, the result) is the screen's.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const REWARD = { shards: 1000, xp: 100 };
  const BOT_NAME = 'Your opponent';

  /* Whether the turn has gone past combat for the player whose turn it is. */
  const pastCombat = (g) => g.step === 'endCombat' || g.step === 'end' || g.step === 'cleanup' ||
    (g.step === 'main' && g.phase && g.phase.id === 'postcombat');
  const zoneOf = (g, id) => { const o = id && g.obj(id); return o ? o.zone : null; };

  /* ---------------- the lessons ----------------
     Each has the board (`mine`, `theirs`: battlefield and hand, by name;
     'Name#tag' gives a card a tag to point at), whose turn it opens on, in
     the first main phase (`start`), the steps you stop at beyond your own
     (`stops`), what the bot is told (`bot`), and `judge`, which reads the
     game after every change and says 'won', 'lost:<why>' or nothing yet.
     `text` is what the result says for each of those. */
  const LESSONS = [
    {
      id: 'stack', title: 'The stack', blurb: 'Answer a spell before it happens: an instant cast in response.',
      start: 'theirs',
      mine: { battlefield: ['Grizzly Bears#bears', 'Forest', 'Forest'], hand: ['Blossoming Defense#defense'] },
      theirs: { battlefield: ['Mountain', 'Mountain'], hand: ['Shock#shock'] },
      bot: { cast: { card: 'shock', target: 'bears' } },
      judge(g, ids, mem) {
        if (zoneOf(g, ids.bears) !== 'battlefield') return 'lost:dead';
        if (zoneOf(g, ids.shock) === 'stack') { mem.cast = true; return null; }
        // Shock has come off the stack, and the Bears are still there
        return mem.cast ? 'won' : null;
      },
      text: {
        won: 'Blossoming Defense went on the stack above Shock, so it resolved first: your Bears became 4/4 with hexproof. ' +
          'When Shock came to resolve, its only target could not be targeted any more, so it did nothing. Last in, first out.',
        dead: 'Shock resolved and your Bears died. While a spell waits on the stack you can answer it: cast Blossoming Defense on your Bears before Shock resolves.',
      },
    },
    {
      id: 'tricks', title: 'Combat tricks', blurb: 'Make a creature bigger after the blocks, when it is too late to back out.',
      start: 'mine',
      // stopping after blockers on your own turn is the whole point
      stops: { yours: { declareBlockers: true } },
      mine: { battlefield: ['Grizzly Bears#bears', 'Forest', 'Forest'], hand: ['Giant Growth#growth'] },
      theirs: { battlefield: ['Hill Giant#giant', 'Mountain', 'Mountain', 'Mountain'], hand: [] },
      /* A sensible blocker: the Giant stands in front of an attacker it
         beats and survives, and nothing bigger. */
      bot: {
        block(g, ch, ids) {
          const giant = g.obj(ids.giant);
          if (!giant || giant.zone !== 'battlefield' || giant.tapped) return [];
          const gp = g.powerOf ? g.powerOf(giant) : 3, gt = g.toughnessOf ? g.toughnessOf(giant) : 3;
          for (const id of ch.attackers || []) {
            const a = g.obj(id);
            const ap = a && (g.powerOf ? g.powerOf(a) : 2), at = a && (g.toughnessOf ? g.toughnessOf(a) : 2);
            if (a && ap < gt && gp >= at) return [{ blockerId: giant.id, attackerIds: [a.id] }];
          }
          return [];
        },
      },
      judge(g, ids, mem) {
        const bears = g.obj(ids.bears);
        if (!bears || bears.zone !== 'battlefield') return 'lost:dead';
        if (zoneOf(g, ids.giant) !== 'battlefield') return 'won';
        if (bears.attacking) mem.attacked = true;
        if (zoneOf(g, ids.growth) !== 'hand' && !(bears.blockedBy || []).length && !mem.blocked) mem.early = true;
        if ((bears.blockedBy || []).length) mem.blocked = true;
        if (g.activePlayer.id !== 'me' || pastCombat(g)) return mem.early ? 'lost:early' : mem.attacked ? 'lost:dead' : 'lost:noAttack';
        return null;
      },
      text: {
        won: 'Blocked by the Giant, your Bears grew to 5/5 and won the fight. Cast once blockers are declared, a trick catches them with no way out.',
        dead: 'Your Bears lost the fight. Wait for the Giant to block, then cast Giant Growth on your Bears before damage is dealt.',
        early: 'Giant Growth was cast before the blocks, so they saw a 5/5 coming and did not block. Keep a trick in your hand until blockers are declared.',
        noAttack: 'Your Bears did not attack. A trick needs a fight: attack, and let the Giant block.',
      },
    },
    {
      id: 'blocks', title: 'Blocking well', blurb: 'Team up on a big attacker, and trade with a small one.',
      start: 'theirs',
      mine: { battlefield: ['Runeclaw Bear', 'Balduvian Bears', 'Bear Cub', 'Forest', 'Forest'], hand: [] },
      theirs: { battlefield: ['Hill Giant#giant', 'Grizzly Bears#bears', 'Mountain', 'Mountain', 'Forest'], hand: [] },
      bot: { attack: ['giant', 'bears'] },
      judge(g, ids, mem) {
        const giant = zoneOf(g, ids.giant), bears = zoneOf(g, ids.bears);
        if (giant !== 'battlefield' && bears !== 'battlefield') return 'won';
        if (g.turn !== mem.turn || pastCombat(g)) return giant === 'battlefield' ? 'lost:giant' : 'lost:bears';
        return null;
      },
      text: {
        won: 'Two of your 2/2s dealt the Giant 4 damage between them, and it could kill only one of them. Your third bear traded with theirs: both died. Both attackers gone.',
        giant: 'The Hill Giant survived. A 3/3 needs 3 damage: block it with two of your 2/2s together, and the third with their Grizzly Bears.',
        bears: 'Their Grizzly Bears survived. Two of your 2/2s on the Giant is right; the third should block their Bears, a 2/2 for a 2/2.',
      },
    },
    {
      id: 'counter', title: 'Counterspells', blurb: 'Stop a spell on the stack before it ever reaches the battlefield.',
      start: 'theirs',
      mine: { battlefield: ['Island', 'Island', 'Grizzly Bears'], hand: ['Counterspell#counter'] },
      theirs: { battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Colossal Dreadmaw#maw'] },
      bot: { cast: { card: 'maw' } },
      judge(g, ids, mem) {
        const maw = zoneOf(g, ids.maw);
        if (maw === 'stack') { mem.cast = true; return null; }
        if (maw === 'battlefield') return 'lost:resolved';
        return mem.cast ? 'won' : null;
      },
      text: {
        won: 'Countered: the Dreadmaw went from the stack to the graveyard without ever reaching the battlefield.',
        resolved: 'The Dreadmaw resolved, and on the battlefield it is out of Counterspell’s reach. Cast Counterspell while it is still on the stack.',
      },
    },
  ];

  /* ---------------- the board ---------------- */

  /** 'Grizzly Bears#bears' -> ['Grizzly Bears', 'bears']. */
  const parse = (s) => { const i = s.indexOf('#'); return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)]; };

  /** Every card a lesson needs, and the basics its libraries are made of. */
  function cardNames(def) {
    const all = [].concat(def.mine.battlefield, def.mine.hand, def.theirs.battlefield, def.theirs.hand).map(s => parse(s)[0]);
    return [...new Set(all.concat(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']))];
  }

  /** A library of basics, so nobody draws anything that gets in the way, and nobody decks out. */
  const filler = (byName) => ({ name: 'Basics', format: 'standard', main: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(b => ({ card: byName.get(b), qty: 8 })), sideboard: [], commanders: [] });

  /**
   * Build the board on a game just started: hands kept and put back, on to
   * the first main phase of whoever the lesson starts with, then the cards
   * put down. Returns the tagged cards' object ids.
   */
  function build(g, def, byName, me, opp) {
    const R = MTG.rules;
    for (const p of g.players) { try { g.keepHand(p.id, []); } catch (e) { /* kept already */ } }
    const putBack = () => {
      for (const p of g.players) {
        const z = g.zones[p.id];
        while (z.hand.length) { const o = z.hand.pop(); o.zone = 'library'; z.library.push(o); }
      }
    };
    putBack();
    const who = def.start === 'theirs' ? opp : me;
    for (let guard = 0; guard < 400; guard++) {
      if (g.over) break;
      if (g.activePlayer && g.activePlayer.id === who && g.step === 'main' && g.phase && g.phase.id === 'precombat' && !g.stack.length && !g.pendingChoice) break;
      if (g.pendingChoice) { try { g.resolveChoice(g.pendingChoice.playerId, {}); } catch (e) { break; } continue; }
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    putBack();
    const ids = {};
    const put = (pid, entry, zone) => {
      const [name, tag] = parse(entry);
      const o = g._register(new R.GObj(byName.get(name), pid, zone));
      if (zone === 'battlefield') {
        o.zone = 'battlefield'; o.controller = pid; o.entered = g.turn - 1; o.summoningSick = false;
        if (g._stampNew) o.ts = g._stampNew();
        g.battlefield.push(o);
      } else g.zones[pid][zone].push(o);
      if (tag) ids[tag] = o.id;
      return o;
    };
    for (const n of def.mine.battlefield) put(me, n, 'battlefield');
    for (const n of def.mine.hand) put(me, n, 'hand');
    for (const n of def.theirs.battlefield) put(opp, n, 'battlefield');
    for (const n of def.theirs.hand) put(opp, n, 'hand');
    if (g.bumpBoard) g.bumpBoard();
    return ids;
  }

  /**
   * The bot, told what to do. It thinks nothing over; it casts the
   * lesson's spell the first time it has priority in its own main phase,
   * attacks and blocks as the lesson says (anything else it is asked, the
   * order of damage, it answers as it always would), and otherwise passes.
   */
  function script(bot, g, def, ids) {
    const pid = bot.pid;
    const plan = def.bot || {};
    let cast = false;
    const thinkChoice = bot.thinkChoice.bind(bot), doChoice = bot.doChoice.bind(bot);
    bot.thinkChoice = (ch) => (ch.type === 'declareAttackers' || ch.type === 'declareBlockers' ? Promise.resolve(null) : thinkChoice(ch));
    bot.doChoice = (ch, p) => {
      if (ch.type === 'declareAttackers') {
        const decl = (plan.attack || []).map(t => g.obj(ids[t])).filter(o => o && o.zone === 'battlefield' && g.canAttack(o))
          .map(o => ({ attackerId: o.id, defenderId: (ch.defenders || [])[0] ? ch.defenders[0].id : 'me' }));
        return g.declareAttackers(pid, decl) || g.declareAttackers(pid, []);
      }
      if (ch.type === 'declareBlockers') {
        const decl = plan.block ? plan.block(g, ch, ids) : [];
        return g.declareBlockers(pid, decl) || g.declareBlockers(pid, []);
      }
      return doChoice(ch, p);
    };
    bot.thinkPriority = () => Promise.resolve(null);
    bot.doPriority = () => {
      const c = plan.cast;
      if (c && !cast && g.activePlayer.id === pid && g.step === 'main' && !g.stack.length) {
        cast = true;
        const targets = c.target ? [{ kind: 'object', id: ids[c.target] }] : [];
        if (g.castSpell(pid, ids[c.card], { targets, auto: true })) return true;
      }
      g.passPriority(pid);
      return false;
    };
    return bot;
  }

  /** The stops a lesson plays with: the usual ones, and whatever the lesson needs on top. */
  function stopsFor(def) {
    const base = JSON.parse(JSON.stringify(MTG.DEFAULT_STOPS));
    for (const side of ['yours', 'theirs']) Object.assign(base[side], (def.stops || {})[side] || {});
    return base;
  }

  /**
   * Watch a game for the lesson's end: `onEnd(result)` once, with 'won' or
   * 'lost:<why>'. Returns a function that stops watching.
   */
  function watch(g, def, ids, onEnd) {
    const mem = { turn: g.turn };
    let over = false;
    const look = () => {
      if (over) return;
      let r = null;
      try { r = def.judge(g, ids, mem); } catch (e) { console.error('[lesson]', e); }
      if (!r) return;
      over = true;
      g.off('state', look);
      onEnd(r);
    };
    g.on('state', look);
    return () => { over = true; g.off('state', look); };
  }

  /* ---------------- the record ---------------- */
  const done = () => (MTG.progress.state.lessons || {});
  const count = () => LESSONS.filter(l => done()[l.id]).length;
  /** The whole series, the first game included: how much of it is done. */
  const progress = () => ({ done: count() + (MTG.settings.tutorialDone ? 1 : 0), total: LESSONS.length + 1 });

  /** Paid once, the first time a lesson is got right; marked done either way. */
  function passed(def) {
    const P = MTG.progress;
    P.state.lessons = P.state.lessons || {};
    if (P.state.lessons[def.id]) return false;
    P.state.lessons[def.id] = Date.now();
    P.mail(`Lesson learned: ${def.title}`, 'Well played.', Object.assign({}, REWARD), 'event');
    P.save();
    return true;
  }

  /* ---------------- the notes over the table ---------------- */

  const touch = () => MTG.isTouch();
  const tap = () => (touch() ? 'Tap' : 'Click');
  const nodeOf = (t, id) => { const n = id && t.els.get(id); return n && n.isConnected ? n : null; };
  const inHand = (t, id) => !!(t.me && t.me.hand.some(o => o.id === id));
  const onStack = (v, id) => (v.stack || []).some(s => s.objId === id);
  const myPriority = (t, v) => v.priorityPlayer === t.meId && !v.pendingChoice;
  const asked = (t, v, type) => { const ch = v.pendingChoice; return !!(ch && ch.type === type && ch.playerId === t.meId && !ch.waiting); };
  const theirOrb = (t) => t.oppWrap.querySelector('.life-orb') || t.oppStrip.querySelector('.life-orb');
  const stackCol = (t) => (t.stackCol && t.stackCol.classList.contains('on') ? t.stackCol : null);
  const bigButton = (t) => t.dock && t.dock._main;
  const blockersOn = (t, id) => (t.blockPlan ? t.blockPlan.declarations.filter(d => (d.attackerIds || []).includes(id)).length : 0);

  /* With Tap lands for me off, a spell cast waits for its mana (src/12c-ui-table-ask.js):
     the same note in every lesson points at a land to tap. */
  const payNote = () => ({
    id: 'pay', title: 'Tap lands to pay', times: 9,
    text: () => `${tap()} a glowing land to tap it for mana. Once your mana pool covers the cost, the spell is cast.`,
    when: (t) => !!t.paying, done: (t) => !t.paying,
    at: (t) => { const o = t.manaSources()[0]; return o ? nodeOf(t, o.id) : null; },
  });

  /** The first note: what the lesson is about. It holds the bot back until it has been read. */
  const intro = (def, text, at) => ({
    id: 'intro', title: def.title, text: () => text, times: 9, ok: 'Start', focus: true,
    when: () => true, at: (t) => at(t) || bigButton(t),
  });

  /** The notes for each lesson, pointing at the cards it was built with. */
  const NOTES = {
    stack: (def, ids) => [
      intro(def, 'It is their turn, and they are holding a Shock for your Grizzly Bears. A spell does not happen the moment it is cast: it waits on the stack, where you can answer it first.', theirOrb),
      { id: 'wait', title: 'Shock is on the stack', times: 9,
        text: () => 'Aimed at your Bears, and nothing has happened yet. Until both players pass, you can answer it.',
        when: (t, v) => onStack(v, ids.shock) && myPriority(t, v) && inHand(t, ids.defense) && !t.targeting && !t.paying,
        at: (t) => stackCol(t), done: (t) => !inHand(t, ids.defense) },
      { id: 'respond', title: 'Respond with an instant', times: 9,
        text: () => `${tap()} Blossoming Defense to cast it on your Bears. An instant can be cast now, and it goes on the stack on top of Shock.`,
        when: (t, v) => onStack(v, ids.shock) && myPriority(t, v) && inHand(t, ids.defense) && !t.targeting && !t.paying,
        at: (t) => nodeOf(t, ids.defense), done: (t) => !inHand(t, ids.defense) },
      { id: 'aim', title: 'Choose your Bears', times: 9, text: () => 'Your Grizzly Bears are the target.',
        when: (t) => !!t.targeting, at: (t) => nodeOf(t, ids.bears), done: (t) => !t.targeting },
    ],
    tricks: (def, ids) => [
      Object.assign(intro(def, 'A combat trick is an instant that changes a fight once it has started. Their Hill Giant (3/3) beats your Grizzly Bears (2/2), so they will be glad to block. Let them.', (t) => nodeOf(t, ids.giant)), { ok: 'Got it' }),
      { id: 'hold', title: 'Hold the trick', times: 9,
        text: () => 'Keep Giant Growth in your hand for now and go to combat. Cast it now and they will see a 5/5 coming.',
        when: (t, v) => v.activePlayer === t.meId && v.step === 'main' && v.phase === 'precombat' && myPriority(t, v) && !(v.stack || []).length && inHand(t, ids.growth),
        at: (t) => bigButton(t), done: (t, v) => !(v.step === 'main' && v.phase === 'precombat') || !inHand(t, ids.growth) },
      { id: 'attack', title: 'Attack', times: 9, text: () => `${tap()} your Grizzly Bears to send them in, then press Attack.`,
        when: (t, v) => asked(t, v, 'declareAttackers'), at: (t) => nodeOf(t, ids.bears), done: (t, v) => !asked(t, v, 'declareAttackers') },
      { id: 'blockfirst', title: 'Not yet', times: 9,
        text: () => 'They have not chosen their blockers yet. Press the button and let them block first.',
        when: (t, v) => v.step === 'declareAttackers' && myPriority(t, v) && inHand(t, ids.growth) && v.battlefield.some(o => o.id === ids.bears && o.attacking),
        at: (t) => bigButton(t), done: (t, v) => v.step !== 'declareAttackers' || !inHand(t, ids.growth) },
      { id: 'trick', title: 'Now the trick', times: 9,
        text: () => `The Giant has blocked, and blockers cannot be taken back. ${tap()} Giant Growth to cast it on your Bears.`,
        when: (t, v) => myPriority(t, v) && inHand(t, ids.growth) && !t.targeting && !t.paying && v.battlefield.some(o => o.id === ids.giant && (o.blocking || []).includes(ids.bears)),
        at: (t) => nodeOf(t, ids.growth), done: (t) => !inHand(t, ids.growth) },
      { id: 'aim', title: 'Your Bears, not their Giant', times: 9, text: () => 'Choose your Grizzly Bears: +3/+3 makes them 5/5.',
        when: (t) => !!t.targeting, at: (t) => nodeOf(t, ids.bears), done: (t) => !t.targeting },
    ],
    blocks: (def, ids) => [
      intro(def, 'On their turn they will attack with a Hill Giant (3/3) and Grizzly Bears (2/2). You have three 2/2s: block so that both attackers die.', (t) => nodeOf(t, ids.giant)),
      { id: 'double', title: 'Two on the Giant', times: 9,
        text: () => `Two blockers can team up on one attacker. Together two 2/2s deal 4 damage, enough for a 3/3, and the Giant can kill only one of them. ${tap()} one of your creatures, then the Giant; then another, and the Giant again.`,
        when: (t, v) => asked(t, v, 'declareBlockers'), at: (t) => nodeOf(t, ids.giant),
        done: (t, v) => !asked(t, v, 'declareBlockers') || blockersOn(t, ids.giant) >= 2 },
      { id: 'trade', title: 'A trade', times: 9,
        text: () => `Block their Grizzly Bears with your last creature. A 2/2 against a 2/2 is a trade: both die. ${tap()} your creature, then their Bears.`,
        when: (t, v) => asked(t, v, 'declareBlockers') && blockersOn(t, ids.giant) >= 2, at: (t) => nodeOf(t, ids.bears),
        done: (t, v) => !asked(t, v, 'declareBlockers') || blockersOn(t, ids.bears) >= 1 },
      { id: 'confirm', title: 'Lock them in', times: 9, text: () => 'Press Block.',
        when: (t, v) => asked(t, v, 'declareBlockers') && blockersOn(t, ids.giant) >= 2 && blockersOn(t, ids.bears) >= 1,
        at: (t) => bigButton(t), done: (t, v) => !asked(t, v, 'declareBlockers') },
    ],
    counter: (def, ids) => [
      intro(def, 'They have six Forests and something big in their hand. A counterspell stops a spell while it is still on the stack, before it ever reaches the battlefield.', theirOrb),
      { id: 'wait', title: 'On the stack, not yet on the battlefield', times: 9,
        text: () => 'Colossal Dreadmaw is on the stack. Until it resolves, it can still be countered.',
        when: (t, v) => onStack(v, ids.maw) && myPriority(t, v) && inHand(t, ids.counter) && !t.targeting && !t.paying,
        at: (t) => stackCol(t), done: (t) => !inHand(t, ids.counter) },
      { id: 'counter', title: 'Counter it', times: 9,
        text: () => `${tap()} Counterspell to cast it. Its target is a spell: the Dreadmaw on the stack.`,
        when: (t, v) => onStack(v, ids.maw) && myPriority(t, v) && inHand(t, ids.counter) && !t.targeting && !t.paying,
        at: (t) => nodeOf(t, ids.counter), done: (t) => !inHand(t, ids.counter) },
      { id: 'aim', title: 'Choose the Dreadmaw', times: 9, text: () => 'Choose Colossal Dreadmaw on the stack.',
        when: (t) => !!t.targeting, at: (t) => nodeOf(t, ids.maw) || stackCol(t), done: (t) => !t.targeting },
    ],
  };

  /* ---------------- playing one ---------------- */
  let run = null;          // the lesson on the table: {def, sess, g, ids, coach, stopWatch}

  /** Start a lesson: its cards fetched, the board built, the bot told, the notes put up. */
  async function start(id) {
    const def = LESSONS.find(l => l.id === id);
    const App = MTG.app;
    if (!def || !App) return;
    const busy = UI.busy(def.title, 'Setting up the board…');
    const names = cardNames(def);
    let byName;
    try {
      const res = await MTG.scry.collection(names.map(n => ({ name: n })));
      byName = new Map(names.map((n, i) => [n, (res.cards || [])[i]]));
      if (names.some(n => !byName.get(n))) throw new Error('Some cards could not be loaded. Check the connection.');
    } catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    end();
    /* The game before (the lesson tried a moment ago) stops where it is,
       so nothing it does afterwards reaches the new table. */
    const old = App.session;
    if (old) { if (old.botRunner) old.botRunner.stop(); old.game = null; }
    if (App.table) { App.table.destroy(); App.table = null; }
    App.formatId = 'standard';
    const sess = App.session = new App.Session('standard');
    sess.mode = { lesson: id };
    // a lesson is not a game to come back to: leave it and it is gone
    sess.noSave = true;
    sess.saveInProgress = () => {};
    sess.addLocalHost(App.myName);
    const bot = { id: MTG.uid('bot'), kind: 'bot', name: BOT_NAME, difficulty: 1, personality: '', deck: null };
    sess.roster.push(bot);
    sess.seat('me').deck = filler(byName);
    bot.deck = filler(byName);
    const mine = { def, sess, g: null, ids: null, coach: null, stopWatch: null };
    run = mine;
    /* Each game of the session is the lesson, built afresh: the first,
       and a rematch from the result screen should it come to that. The
       table is already up when this runs, so the notes go on it here. */
    sess.onStarted = (g) => {
      if (run && run !== mine) end();
      run = mine;
      if (mine.stopWatch) mine.stopWatch();
      if (mine.coach) mine.coach.stop();
      mine.g = g;
      mine.ids = build(g, def, byName, 'me', bot.id);
      const runner = sess.botRunner;
      script(runner.bots.get(bot.id), g, def, mine.ids);
      g.setAutoPass('me', Object.assign(MTG.autoPassConfig(), { enabled: true, smart: true, untilStackChange: true, stops: stopsFor(def), fullControl: false }));
      // on their turn, the bot waits for the first note to be read
      if (def.start === 'theirs') runner.stopped = true;
      const go = () => { if (run === mine && runner.stopped && App.session === sess && sess.botRunner === runner) { runner.stopped = false; runner.kick(); } };
      mine.stopWatch = watch(g, def, mine.ids, (r) => settle(mine, r));
      if (App.table) {
        mine.coach = new UI.Coach(App.table, {
          marks: NOTES[def.id](def, mine.ids).concat([payNote()]), name: def.title, skipLabel: 'Hide the notes',
          onClose: (m) => { if (m.id === 'intro') go(); },
          onSkip: () => go(),
          onFinish: () => {},
        });
      } else go();
    };
    await sess.startGame();
  }

  /** Put a lesson away: no more judging, no notes. */
  function end() {
    if (!run) return;
    if (run.stopWatch) run.stopWatch();
    if (run.coach) run.coach.stop();
    run = null;
  }

  /**
   * The lesson is over: once the table has shown what happened, a word on
   * how it went, and the way on.
   */
  function settle(mine, result) {
    const App = MTG.app;
    const won = result === 'won';
    const first = won ? passed(mine.def) : false;
    let waited = 0;
    const show = () => {
      if (run !== mine || !App || App.session !== mine.sess) return;
      const t = App.table;
      // wait for the table to catch up with the game, and for anything still flying to land
      if (t && waited < 8000 && (!t._ready() || t.arena.querySelector('.moving'))) { waited += 200; setTimeout(show, 200); return; }
      if (mine.coach) mine.coach.stop();
      const def = mine.def;
      const why = won ? 'won' : result.slice(5);
      MTG.sfx(won ? 'win' : 'lose');
      const body = el('div', { class: 'lesson-result' + (won ? ' won' : '') }, [
        el('p', { class: 'lr-text', text: def.text[why] || def.text.won }),
        won && first ? el('div', { class: 'lr-reward' }, [
          UI.rewardChips ? UI.rewardChips(REWARD) : el('span', { text: `${REWARD.shards.toLocaleString()} Shards` }),
          el('span', { class: 'lr-note', text: 'in your inbox' }),
        ]) : null,
        el('p', { class: 'lr-progress', text: `${count()} of ${LESSONS.length} lessons done.` }),
      ].filter(Boolean));
      const m = UI.modal({ title: won ? `Lesson learned: ${def.title}` : 'Not quite', content: body, className: 'lesson-modal' });
      for (const b of resultButtons(def, won)) {
        const btn = m.button(b.label, () => { m.close(); b.fn(); }, b.cls);
        if (b.title) btn.title = b.title;
      }
    };
    setTimeout(show, 600);
  }

  /**
   * What a lesson's result offers: on to the next tutorial (not after the
   * last), another go when it went wrong, and the list. Primary last.
   */
  function resultButtons(def, won) {
    const next = LESSONS[LESSONS.indexOf(def) + 1] || null;
    const out = [{ label: 'All tutorials', cls: 'ghost', fn: () => { leave(); setTimeout(() => open(), 300); } }];
    if (won) {
      if (next) out.push({ label: 'Next tutorial', cls: 'primary', title: next.title, fn: () => start(next.id) });
      else out.push({ label: 'Done', cls: 'primary', fn: () => leave() });
    } else {
      if (next) out.push({ label: 'Next tutorial', cls: '', title: next.title, fn: () => start(next.id) });
      out.push({ label: 'Try again', cls: 'primary', fn: () => start(def.id) });
    }
    return out;
  }

  /**
   * The result screen of a tutorial game (src/12c-ui-table-ask.js): what
   * it offers in place of a rematch. The first game leads on to the first
   * lesson; a lesson to the one after it, with another go at itself; the
   * last lesson back to the list. Null for any other game.
   */
  function afterGame(sess) {
    const m = sess && sess.mode;
    if (!m || !(m.lesson || m.tutorial)) return null;
    const i = m.lesson ? LESSONS.findIndex(l => l.id === m.lesson) : -1;
    const next = LESSONS[i + 1] || null;
    const out = [];
    if (m.lesson) out.push({ label: 'Try again', fn: () => start(m.lesson) });
    if (next) out.push({ label: 'Next tutorial', cls: 'primary', title: next.title, fn: () => start(next.id) });
    else out.push({ label: 'All tutorials', cls: 'primary', fn: () => { leave(); setTimeout(() => open(), 300); } });
    return out;
  }

  /** Off the table, back to the menus. */
  function leave() {
    end();
    if (MTG.app && MTG.app.leaveGame) MTG.app.leaveGame();
  }

  /* ---------------- the list ---------------- */

  /** Whether the tutorials are offered where you play: the Play screen's tile and the home screen's cards. */
  const shown = () => MTG.settings.showTutorials !== false;

  /**
   * The Tutorials tile among the Play screen's events, made with the
   * screen's own `card` maker, or null while it is hidden. Right-click it,
   * or hold it on a touch screen, for the menu that hides it; Options has
   * it back.
   */
  function playTile(card, opts) {
    opts = opts || {};
    if (!shown()) return null;
    const pr = progress();
    const tile = card('ev-tutorials', 'Tutorials', 'Learn by playing: your first game, then the stack, combat tricks, blocking well and counterspells.',
      `<span>${pr.done} of ${pr.total} done</span>`, () => open());
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(e, opts.rerender); });
    if (UI.longPress) UI.longPress(tile, (e) => tileMenu(e, opts.rerender));
    return tile;
  }

  /** The tile's own menu: hide it. */
  function tileMenu(e, rerender) {
    UI.contextMenu(e, [['Hide', () => hide(rerender)]], { title: 'Tutorials' });
  }

  /** Hide the tutorials from the Play and home screens, saying where they come back from. */
  function hide(rerender) {
    MTG.setSetting('showTutorials', false);
    UI.toast('Tutorials hidden. Options, under Gameplay, shows them again; the lessons are there too.');
    if (rerender) rerender();
  }

  /** The tutorials: the first game, then the lessons, each marked once done. */
  function open() {
    const S = MTG.settings;
    const rows = [{
      id: 'first', title: 'Your first game', blurb: 'A whole game against a gentle bot, with notes as things come up: playing a land, tapping it for mana, casting a creature, attacking and blocking.',
      done: !!S.tutorialDone, reward: null, play: () => MTG.app.startTutorial(),
    }].concat(LESSONS.map(l => ({ id: l.id, title: l.title, blurb: l.blurb, done: !!done()[l.id], reward: REWARD, play: () => start(l.id) })));
    const list = el('ol', { class: 'lesson-list' }, rows.map((r, i) => el('li', { class: 'lesson' + (r.done ? ' done' : '') }, [
      el('div', { class: 'ls-mark', 'aria-hidden': 'true', text: r.done ? '✓' : String(i + 1) }),
      el('div', { class: 'ls-text' }, [
        el('b', { text: r.title }),
        el('span', { class: 'dim', text: r.blurb }),
        r.reward && !r.done && UI.rewardChips ? UI.rewardChips(r.reward) : null,
        el('span', { class: 'sr-only', text: r.done ? 'Done.' : 'Not done yet.' }),
      ].filter(Boolean)),
      el('button', { type: 'button', class: 'btn' + (r.done ? '' : ' primary'), text: r.done ? 'Play again' : 'Play',
        'aria-label': (r.done ? 'Play again: ' : 'Play: ') + r.title, onclick: () => { m.close(); r.play(); } }),
    ])));
    const pr = progress();
    const m = UI.modal({
      title: 'Tutorials', className: 'lesson-modal',
      content: el('div', {}, [
        el('p', { class: 'dim', text: `The first game, then short lessons on a board set up for you, against a bot that does as it is told. Each lesson pays a few Shards, once. ${pr.done} of ${pr.total} done.` }),
        list,
      ]),
    });
    m.button('Close', (mm) => mm.close(), 'ghost');
    return m;
  }

  /**
   * For the home screen, once the first game is done: the lessons offered
   * until they are all done or turned down. Null when there is nothing to offer.
   */
  function homeCard(opts) {
    opts = opts || {};
    const S = MTG.settings;
    if (!shown() || !S.tutorialDone || S.lessonsDismissed || count() >= LESSONS.length) return null;
    const next = LESSONS.find(l => !done()[l.id]);
    const card = el('div', { class: 'resume-card guide-card lesson-card' }, [
      el('div', { class: 'resume-art', 'aria-hidden': 'true' }),
      el('div', { class: 'guide-mark', 'aria-hidden': 'true', text: String(LESSONS.indexOf(next) + 1) }),
      el('div', { class: 'grow', style: { minWidth: 0 } }, [
        el('div', { class: 'resume-title', text: count() ? `Next lesson: ${next.title}` : 'Keep learning' }),
        el('div', { class: 'resume-sub', text: count() ? next.blurb
          : 'Four short lessons on a board set up for you: the stack, combat tricks, blocking well and counterspells. Each pays a few Shards.' }),
      ]),
      el('button', { class: 'btn sm ghost', text: 'No thanks', onclick: () => { MTG.setSetting('lessonsDismissed', true); if (opts.rerender) opts.rerender(); } }),
      el('button', { class: 'btn primary', text: count() ? 'Play it' : 'Show me', onclick: () => (count() ? start(next.id) : open()) }),
    ]);
    // one of the home screen's own decoration cards, so it costs no lookup
    if (opts.art) opts.art(card.firstChild, 'Fact or Fiction');
    return card;
  }

  /**
   * For the home screen: somebody new is offered a guided first game,
   * until they take it, say no, or hide the tutorials. Null otherwise.
   */
  function firstGameCard(opts) {
    opts = opts || {};
    const S = MTG.settings;
    if (!shown() || S.tutorialDone || S.tutorialDismissed) return null;
    const card = el('div', { class: 'resume-card guide-card' }, [
      el('div', { class: 'resume-art', 'aria-hidden': 'true' }),
      el('div', { class: 'guide-mark', 'aria-hidden': 'true', html: opts.icon || '' }),
      el('div', { class: 'grow', style: { minWidth: 0 } }, [
        el('div', { class: 'resume-title', text: 'New to Magic, or to this table?' }),
        el('div', { class: 'resume-sub', text: 'Play a guided first game against a gentle bot. Notes on the table show you each thing as it comes up: playing a land, tapping it for mana, casting a creature, attacking and blocking.' }),
      ]),
      el('button', { class: 'btn sm ghost', text: 'No thanks', onclick: () => { MTG.setSetting('tutorialDismissed', true); if (opts.rerender) opts.rerender(); } }),
      el('button', { class: 'btn primary', text: 'Show me', onclick: () => MTG.app.startTutorial() }),
    ]);
    if (opts.art) opts.art(card.firstChild, 'Lightning Helix');
    return card;
  }

  MTG.lessons = {
    LESSONS, NOTES, REWARD,
    open, start, homeCard, firstGameCard, playTile, tileMenu, hide, shown,
    afterGame, resultButtons,
    count, progress, isDone: (id) => !!done()[id],
    // for tools/lessontest.js: the parts that only read the engine
    cardNames, build, script, watch, stopsFor, filler,
  };
})(window.MTG);
