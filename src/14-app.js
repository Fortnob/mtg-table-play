/* ============================================================
   14-app.js - screens, lobby, session orchestration
   The host owns the engine. Everyone (host included) talks to it
   through intents, so the host UI and a remote client UI are identical.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, $$, util: U } = MTG;
  const UI = MTG.ui;
  const net = MTG.net;

  /** @type {Record<string, any>} the app's state and the screens' entry points, added to below */
  const App = MTG.app = {
    screen: 'menu',
    formatId: 'commander',
    session: null,      // host-side session
    table: null,        // UI.Table
    draftUI: null,
    myId: null,
    myName: '',
    roster: [],         // lobby entries (host authoritative)
    lastView: null,
  };

  /* ================= boot ================= */
  App.boot = function () {
    /* Somebody new — no decks, no name, no game played — gets the beginner
       hints; anyone who has been here before keeps the table as it was. */
    if (MTG.settings.beginnerHints == null) {
      const fresh = !MTG.decks.index().length && !MTG.settings.playerName && !MTG.store.get('gamesPlayed', 0);
      MTG.setSetting('beginnerHints', fresh);
    }
    App.myName = MTG.settings.playerName || randomName();
    App.myId = 'me';
    MTG.applyDisplaySettings();
    buildShell();
    showScreen('home');
    wireNet();
    offerCardDb();
    // a friendly nudge if the card API is unreachable
    MTG.bus.on('scryfall:offline', U.debounce(() => {
      UI.toast('Scryfall is unreachable right now — cached cards still work.', 'err', 5000);
    }, 4000));
    // rotating a phone crosses the phone/desktop line, and several screens
    // are built differently on each side of it, so redraw what is open
    MTG.bus.on('layout:changed', U.debounce(() => {
      if (App.table) { App.table.closeSide(); App.table.render(); }
      if (App.draftUI) { App.draftUI.closeAdvice(); App.draftUI.render(); }
      if (App.screen === 'options') renderOptions();
      if (App.screen === 'lobby' && App.session) renderLobby();
      if (App.screen === 'formats') renderFormats();
      if (App.screen === 'decks') renderDecks();
      if (App.screen === 'home') renderHome();
    }, 120));
  };

  const NAME_A = ['Quiet', 'Brass', 'Amber', 'Storm', 'Ivory', 'Hollow', 'Gilded', 'Mossy', 'Iron', 'Pale',
    'Ember', 'Silver', 'Thorn', 'Dusk', 'Cinder', 'Marsh', 'Frost', 'Copper', 'Sable', 'Wren'];
  const NAME_B = ['Scribe', 'Warden', 'Drake', 'Herald', 'Sentry', 'Vizier', 'Pilgrim', 'Raven', 'Smith', 'Fox',
    'Tinker', 'Reaper', 'Magus', 'Harrier', 'Cantor', 'Miller', 'Corsair', 'Adept', 'Falconer', 'Wright'];
  /**
   * What to call a bot once you can see what it brought. A table of "Brass
   * Vizier" and "Mossy Falconer" tells you nothing; a table of "Krenko",
   * "Atraxa" and "Mono-Red Goblins" tells you what you are up against, and
   * is how people talk about decks anyway.
   */
  /**
   * Sit a bot down at a game: its level, the style its seat asked for (or
   * the one its deck was built with), and the style written on its player
   * so every screen at the table can say how it plays.
   */
  function seatBot(g, runner, r) {
    const bot = runner.add(r.id, { difficulty: r.difficulty, personality: r.personality || undefined });
    const p = g.player(r.id);
    if (p && bot) p.botPersonality = bot.personality || null;
    return bot;
  }
  /** The styles a bot can play, for a picker: [key, label] with "any" first. */
  function personalityOptions() {
    const P = (MTG.bots && MTG.bots.PERSONALITIES) || {};
    return [['', 'Any style']].concat(Object.keys(P).map(k => [k, P[k].label]));
  }
  /** The style a bot seat will play: the one asked for, else the one its deck was built with. */
  function seatPersonality(r) {
    const P = (MTG.bots && MTG.bots.PERSONALITIES) || {};
    const k = r.personality || (r.deck && r.deck.plan && r.deck.plan.personality) || '';
    return P[k] ? P[k] : null;
  }

  /** A list of ids from the wire, or undefined: strings only, and not too many. */
  const idList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 60) : undefined);

  function botNameFor(deck, formatId, taken) {
    const used = new Set(taken || []);
    const tryName = (n) => {
      n = String(n || '').trim();
      if (!n) return null;
      if (!used.has(n)) return n;
      for (let i = 2; i < 9; i++) if (!used.has(`${n} ${i}`)) return `${n} ${i}`;
      return null;
    };
    const cmds = (deck.commanders || []);
    if (cmds.length) {
      // "Krenko, Mob Boss" is Krenko at the table; a pair is both of them
      const shortName = (c) => U.frontName(c.name).split(',')[0].trim();
      if (cmds.length > 1) {
        const pair = cmds.map(shortName).join(' & ');
        const named = tryName(pair.length <= 26 ? pair : shortName(cmds[0]));
        if (named) return named;
      }
      const full = U.frontName(cmds[0].name);
      return tryName(shortName(cmds[0])) || tryName(full) || null;
    }
    /* A bot knows what it set out to build, which is a better name than what
       a reading of its list guesses: "Mono-Blue Graveyard", "Boros Aggro". */
    const plan = deck.plan;
    if (plan && plan.label) {
      const what = plan.theme ? titleCase(String(plan.theme)) : titleCase(String(plan.archetype || ''));
      const named = tryName(`${titleCase(plan.label)} ${what}`.trim());
      if (named) return named;
    }
    try {
      return tryName(shortDeckName(MTG.advisor.profile(deck, formatId)));
    } catch (e) { return null; }
  }

  /* The advisor's label is a description ("Mono-black instants and sorceries
     lifegain midrange"); a name at the table is two or three words, the way
     people say them: the colours, then the one thing the deck is about. */
  const THEME_WORD = {
    tokens: 'Tokens', counters: 'Counters', sacrifice: 'Sacrifice', lifegain: 'Lifegain',
    graveyard: 'Graveyard', artifacts: 'Artifacts', enchantments: 'Enchantments',
    spellslinger: 'Spells', landfall: 'Landfall', blink: 'Blink', voltron: 'Voltron',
    mill: 'Mill', stax: 'Stax', grouphug: 'Group Hug', treasure: 'Treasure', energy: 'Energy',
    vehicles: 'Vehicles', infect: 'Infect', reanimate: 'Reanimator', ramp: 'Ramp',
    control: 'Control', aggro: 'Aggro', flying: 'Fliers', storm: 'Storm', ninjutsu: 'Ninjas',
    wheels: 'Wheels',
  };
  const titleCase = (s) => String(s || '').replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  function shortDeckName(prof) {
    let colours = titleCase(prof.colorName || '').replace('Colorless', 'Colourless').replace('Five-Color', 'Five-Colour');
    const what = prof.tribe ? titleCase(prof.tribe) + 's'
      : (prof.themes && prof.themes[0] && THEME_WORD[prof.themes[0].id]) || titleCase(prof.strategy || '');
    for (const name of [`${colours} ${what}`, colours ? `${colours} ${titleCase(prof.strategy || '')}` : '', colours]) {
      const n = name.trim();
      if (n && n.length <= 22 && n.split(/\s+/).length <= 3) return n;
    }
    return colours.slice(0, 22) || null;
  }

  function randomName(taken) {
    const used = new Set(taken || []);
    for (let i = 0; i < 60; i++) {
      const n = NAME_A[Math.floor(Math.random() * NAME_A.length)] + ' ' +
        NAME_B[Math.floor(Math.random() * NAME_B.length)];
      if (!used.has(n)) return n;
    }
    return NAME_A[Math.floor(Math.random() * NAME_A.length)] + ' ' + (used.size + 1);
  }

  /* ================= shell ================= */
  let screens = {};
  const CRUMBS = {
    home: '', formats: 'Play', decks: 'Deck builder', options: 'Options',
    lobby: 'Play \u203a Table setup', draft: 'Draft', table: 'Game',
  };

  function buildShell() {
    const app = $('#app');
    app.innerHTML = '';

    const skip = el('a', { class: 'skip-link', href: '#screen-home', text: 'Skip to the main content' });
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      const cur = screens[App.screen];
      if (cur) { cur.setAttribute('tabindex', '-1'); cur.focus(); }
    });

    const topbar = el('div', { class: 'topbar', role: 'banner' }, [
      el('button', {
        class: 'brand', title: 'Back to the main menu',
        onclick: () => goHome(),
        html: '<span class="brand-mark">M</span><span class="brand-name">MTG Table</span>',
      }),
      el('div', { class: 'crumbs', id: 'crumbs' }),
      // the four places in the app, always one click away, the way a game's
      // front end keeps its tabs along the top
      el('nav', { class: 'topnav', 'aria-label': 'Main' }, NAV.map(([id, label]) => el('button', {
        type: 'button', class: 'topnav-btn', text: label, dataset: { nav: id },
        onclick: () => navTo(id),
      }))),
      el('span', { class: 'grow' }),
      el('div', { class: 'net-badge', id: 'netBadge' }, [el('span', { class: 'net-dot' }), el('span', { text: 'solo' })]),
      el('button', { class: 'btn sm ghost icon-btn', html: SVG.sound, title: 'Sound', 'aria-label': 'Sound', onclick: soundMenu }),
      el('button', { class: 'btn sm ghost icon-btn', html: SVG.gear, title: 'Options', 'aria-label': 'Options', onclick: () => navTo('options') }),
    ]);

    screens = {
      home: el('div', { class: 'screen', id: 'screen-home' }),
      formats: el('div', { class: 'screen', id: 'screen-formats' }),
      decks: el('div', { class: 'screen', id: 'screen-decks' }),
      options: el('div', { class: 'screen', id: 'screen-options' }),
      lobby: el('div', { class: 'screen', id: 'screen-lobby' }),
      draft: el('div', { class: 'screen', id: 'screen-draft' }),
      table: el('div', { class: 'screen', id: 'screen-table' }),
    };
    for (const [k, node] of Object.entries(screens)) {
      node.setAttribute('role', 'main');
      node.setAttribute('aria-label', CRUMBS[k] || 'Main menu');
    }
    app.append(skip, topbar, ...Object.values(screens),
      el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }));
    renderHome();
  }

  function showScreen(name) {
    App.screen = name;
    for (const [k, s] of Object.entries(screens)) s.classList.toggle('active', k === name);
    /* In a game the board should own the screen, so the app chrome folds
       into a small cluster in the corner. Everything in it is still there
       and still reachable; it just stops being a header. */
    const inPlay = name === 'table' || name === 'draft';
    if (inPlay) document.documentElement.dataset.play = '1';
    else delete document.documentElement.dataset.play;
    const cr = $('#crumbs');
    if (cr) cr.textContent = CRUMBS[name] || '';
    // the table setup belongs to Play, so Play stays lit while you are in it
    const lit = name === 'lobby' ? 'formats' : name;
    for (const b of $$('.topnav-btn')) {
      if (b.dataset.nav === lit) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    if (name === 'home') renderHome();
    if (name === 'formats') renderFormats();
    if (name === 'decks') renderDecks();
    if (name === 'options') renderOptions();
    window.scrollTo && window.scrollTo(0, 0);
  }
  App.showScreen = showScreen;

  const NAV = [['home', 'Home'], ['formats', 'Play'], ['decks', 'Decks'], ['options', 'Options']];

  /** Go to one of the top-level screens, leaving a table properly on the way. */
  async function navTo(name) {
    if (name === 'home') return goHome();
    if (App.screen === 'table' || App.screen === 'draft') return App.exitToMenu();
    if (App.screen === 'lobby' && (App.session || net.online)) {
      if (!await UI.confirm('Leave this table?')) return;
      App.leaveGame();
    }
    showScreen(name);
  }

  async function goHome() {
    if (App.screen === 'table' || App.screen === 'draft') return App.exitToMenu();
    if (App.session || net.online) {
      if (!await UI.confirm('Leave this table?')) return;
      return App.leaveGame();
    }
    showScreen('home');
  }

  /**
   * Step out of a game without throwing it away. A solo or hosted game is
   * written to the browser first, so the home screen offers it back; there is
   * nothing to keep in a game someone else is hosting, or one already decided.
   */
  App.exitToMenu = async function () {
    const sess = App.session;
    const g = sess && sess.game;
    const keep = !!(g && !g.over && !net.isClient);
    if (sess && sess.drafting && !g) {
      if (!await UI.confirm('Leave this draft? The packs are lost.')) return;
      return App.leaveGame();
    }
    const msg = keep
      ? 'Go back to the main menu? The game is saved and you can pick it up again from the home screen.'
      : 'Leave this game and go back to the main menu?';
    if (!await UI.confirm(msg, keep ? 'Save and leave' : 'Leave the game')) return;
    if (keep) { try { await sess.saveInProgress(true); } catch (e) { /* the menu still wins */ } }
    App.leaveGame({ keepSave: keep });
    if (keep) UI.ok('Saved. It is waiting on the home screen.');
  };

  function setNetBadge(state) {
    const b = $('#netBadge');
    if (!b) return;
    const dot = b.firstChild, label = b.lastChild;
    if (state === 'reconnecting') {
      dot.className = 'net-dot warn';
      label.textContent = 'reconnecting…';
      return;
    }
    dot.className = 'net-dot' + (net.isHost ? ' host' : net.isClient ? ' on' : '');
    label.textContent = net.isHost ? `hosting ${net.roomCode} · ${net.conns.size + 1}`
      : net.isClient ? `joined ${net.roomCode}${net.hostRtt != null ? ` · ${net.hostRtt} ms` : ''}` : 'solo';
  }

  function pageHeader(title, subtitle, backTo, actions) {
    return el('div', { class: 'page-head' }, [
      backTo ? el('button', {
        class: 'btn sm ghost back-btn', 'aria-label': 'Back', title: 'Back',
        html: SVG.back, onclick: () => showScreen(backTo),
      }) : null,
      el('div', { class: 'grow' }, [
        el('h1', { class: 'page-title', text: title }),
        subtitle ? el('p', { class: 'page-sub', text: subtitle }) : null,
      ].filter(Boolean)),
      actions ? el('div', { class: 'page-actions' }, actions) : null,
    ].filter(Boolean));
  }

  /* ================= 1. home =================
     The front of the app is a place rather than a list of settings: the
     same dark stage the table stands on, headed by a big piece of card art.
     The stage is drawn, not fetched, so it is there on the first frame of
     the first visit; the art fades in over it once it has arrived, and if it
     never does the gradient is what you see. */

  /* Cards picked for their art, to dress the screens that have nothing of
     yours to show yet. One request fetches them all, and after that they
     come out of the card cache. */
  const HERO_ART = ['Ugin, the Spirit Dragon', 'Emrakul, the Aeons Torn', 'Sheoldred, the Apocalypse',
    'Atraxa, Grand Unifier', 'The Ur-Dragon', 'Elesh Norn, Mother of Machines', 'Wrenn and Six',
    'Nicol Bolas, Dragon-God'];
  const FORMAT_ART = {
    standard: 'Sheoldred, the Apocalypse', modern: 'Ragavan, Nimble Pilferer', pauper: 'Lightning Bolt',
    commander: "Atraxa, Praetors' Voice",
    booster: 'Cogwork Librarian', picktwo: 'Fact or Fiction', chaos: 'Possibility Storm',
    cube: 'Jace, the Mind Sculptor', cmdrdraft: 'The Ur-Dragon',
  };
  const TILE_ART = { formats: 'Lightning Helix', decks: 'Demonic Tutor', options: "Sensei's Divining Top" };
  const DECOR = HERO_ART.concat(Object.values(FORMAT_ART), Object.values(TILE_ART));

  /** The decoration cards by name, once they are here. */
  function decor() {
    return UI.featuredCards(DECOR).then((cards) => {
      const byName = new Map();
      DECOR.forEach((n, i) => { if (cards[i]) byName.set(n, cards[i]); });
      return byName;
    });
  }
  /** Lay a named decoration card's art onto a node, whenever it turns up. */
  function decorArt(node, name) {
    decor().then((m) => { if (node.isConnected || node.parentNode) UI.setArt(node, m.get(name) || null); });
    return node;
  }

  /** The stage behind a menu, with a wash of art from `card` or one of yours. */
  function sceneBackdrop(host, card) {
    const art = el('div', { class: 'scene-art', id: 'sceneArt' });
    const back = el('div', { class: 'scene', 'aria-hidden': 'true' }, [
      art, el('div', { class: 'scene-sigil' }), el('div', { class: 'scene-veil' }),
    ]);
    host.appendChild(back);
    if (card) { UI.setArt(art, card); return back; }
    // no network: only art already sitting in the cache is used
    findSceneArt().then((url) => {
      if (!url || !art.isConnected) return;
      UI.setArt(art, url);
    }).catch(() => {});
    return back;
  }

  let _sceneArt;
  function findSceneArt() {
    if (_sceneArt !== undefined) return Promise.resolve(_sceneArt);
    _sceneArt = null;
    return (async () => {
      try {
        const list = MTG.decks.index().slice().sort((a, b) => b.updatedAt - a.updatedAt);
        const withArt = list.find(d => d.art);
        if (withArt) { _sceneArt = withArt.art; return _sceneArt; }
        for (const d of list.slice(0, 3)) {
          const deck = await MTG.decks.load(d.id);
          const url = UI.artUrl(UI.keyCard(deck));
          if (url) { _sceneArt = url; return url; }
        }
      } catch (e) { /* the drawn backdrop is the fallback, and it is fine */ }
      return null;
    })();
  }

  /* The quick game remembers what you played last. */
  /* Two kinds of game, and the formats inside each: bring a deck, or make
     one at the table. Each kind remembers the format you last played in it. */
  const QUICK_KINDS = [
    { id: 'constructed', label: 'Constructed', blurb: 'Bring a deck',
      formats: [['standard', 'Standard'], ['modern', 'Modern'], ['pauper', 'Pauper'], ['commander', 'Commander']] },
    { id: 'limited', label: 'Limited', blurb: 'Draft at the table',
      formats: [['booster', 'Booster'], ['picktwo', 'Pick-Two'], ['chaos', 'Chaos'], ['cube', 'Cube'], ['cmdrdraft', 'Commander']] },
  ];
  const QUICK_FORMATS = [].concat(...QUICK_KINDS.map(k => k.formats));
  const quickKindOf = (formatId) => (QUICK_KINDS.find(k => k.formats.some(f => f[0] === formatId)) || QUICK_KINDS[0]);
  function quickPrefs() {
    const S = MTG.settings;
    const q = Object.assign({ formatId: 'standard', opponents: 1, difficulty: 5, colors: [], deckId: '',
      lastByKind: {}, setCode: '', cubeId: 'modern', chaosPool: null }, S.quickGame || {});
    if (!QUICK_FORMATS.some(f => f[0] === q.formatId)) q.formatId = 'standard';
    q.lastByKind = q.lastByKind || {};
    return q;
  }
  function saveQuick(q) { MTG.setSetting('quickGame', q); }

  function renderHome() {
    const s = screens.home;
    s.innerHTML = '';
    sceneBackdrop(s);
    const page = el('div', { class: 'home' });

    /* -- the hero: art, the name, and the one big way in -- */
    const hero = el('section', { class: 'home-hero' });
    const heroArt = el('div', { class: 'home-hero-art', 'aria-hidden': 'true' });
    const credit = el('div', { class: 'home-credit' });
    hero.append(heroArt, el('div', { class: 'home-hero-fade', 'aria-hidden': 'true' }));
    decor().then((m) => {
      // a different painting each day, from the same short list
      const pool = HERO_ART.map(n => m.get(n)).filter(Boolean);
      if (!pool.length) return;
      const card = pool[Math.floor(Date.now() / 864e5) % pool.length];
      UI.setArt(heroArt, card);
      credit.textContent = U.frontName(card.name) + (card.artist ? ' — art by ' + card.artist : '');
    });

    const inner = el('div', { class: 'home-hero-inner' });
    inner.appendChild(el('div', { class: 'home-brand' }, [
      el('div', { class: 'eyebrow', text: 'MTG Table' }),
      el('h1', { class: 'home-title', text: 'Shuffle up.' }),
      el('p', { class: 'home-tag', text: 'Real cards, real art and the real rules — against bots, or with friends over a direct connection.' }),
    ]));
    inner.appendChild(quickGamePanel());
    hero.append(inner, credit);
    page.appendChild(hero);

    /* -- a game left mid-turn is offered back before anything else -- */
    const resumeHost = el('div', { class: 'home-resume' });
    // the game to pick up and the guided first game share a row
    const notes = el('div', { class: 'home-notes' }, [resumeHost]);
    page.appendChild(notes);
    MTG.savedGame.read().then((saved) => {
      if (!saved || !saved.snap || App.screen !== 'home') return;
      const names = (saved.roster || []).map(r => r.name).join(' vs ');
      const fmt = (MTG.formats.get(saved.formatId) || {}).name || saved.formatId;
      const card = el('div', { class: 'resume-card' }, [
        el('div', { class: 'resume-art', 'aria-hidden': 'true' }),
        el('div', { class: 'resume-dot' }),
        el('div', { class: 'grow', style: { minWidth: 0 } }, [
          el('div', { class: 'resume-title', text: 'Pick up where you left off' }),
          el('div', { class: 'resume-sub', text: `${fmt} · ${names} · turn ${saved.snap.turn} · saved ${timeAgo(saved.savedAt)}` }),
        ]),
        el('button', { class: 'btn sm ghost', text: 'Discard', onclick: async () => {
          if (!await UI.confirm('Throw away that saved game?')) return;
          await MTG.savedGame.clear(); renderHome();
        } }),
        el('button', { class: 'btn primary', text: 'Resume', onclick: async () => {
          const busy = UI.busy('Loading', 'Putting the table back…');
          try { await Session.resume(saved); }
          catch (e) { UI.error(e.message || String(e)); await MTG.savedGame.clear(); renderHome(); }
          finally { busy.close(); }
        } }),
      ]);
      decorArt(card.firstChild, FORMAT_ART[saved.formatId] || HERO_ART[0]);
      resumeHost.appendChild(card);
    }).catch(() => {});

    /* -- somebody new is offered a guided first game, until they take it or say no -- */
    if (!MTG.settings.tutorialDone && !MTG.settings.tutorialDismissed) {
      const offer = el('div', { class: 'resume-card guide-card' }, [
        el('div', { class: 'resume-art', 'aria-hidden': 'true' }),
        el('div', { class: 'guide-mark', 'aria-hidden': 'true', html: SVG.play }),
        el('div', { class: 'grow', style: { minWidth: 0 } }, [
          el('div', { class: 'resume-title', text: 'New to Magic, or to this table?' }),
          el('div', { class: 'resume-sub', text: 'Play a guided first game against a gentle bot. A few notes on the table show you the land, the creature, the big button, attacking and blocking as they come up.' }),
        ]),
        el('button', { class: 'btn sm ghost', text: 'No thanks', onclick: () => { MTG.setSetting('tutorialDismissed', true); renderHome(); } }),
        el('button', { class: 'btn primary', text: 'Show me', onclick: () => App.startTutorial() }),
      ]);
      decorArt(offer.firstChild, 'Lightning Helix');
      notes.appendChild(offer);
    }

    /* -- the three doors -- */
    const tile = (id, icon, title, body, onClick) => {
      const t = el('button', { class: 'home-tile', onclick: onClick, dataset: { tile: id } }, [
        el('div', { class: 'home-tile-art', 'aria-hidden': 'true' }),
        el('div', { class: 'home-icon', html: icon }),
        el('div', { class: 'home-tile-body' }, [
          el('h2', { text: title }),
          el('p', { text: body }),
        ]),
        el('span', { class: 'home-arrow', 'aria-hidden': 'true', html: SVG.arrow }),
      ]);
      decorArt(t.firstChild, TILE_ART[id]);
      return t;
    };
    page.appendChild(el('div', { class: 'home-tiles' }, [
      tile('formats', SVG.play, 'Play', 'Every format, from Commander pods of eight to booster drafts. Fill the seats with friends or bots.', () => showScreen('formats')),
      tile('decks', SVG.deck, 'Decks', 'Import a list from anywhere, build one from scratch, and see what it combos into.', () => showScreen('decks')),
      tile('options', SVG.gear, 'Options', 'Pace, stops, appearance, accessibility and sound.', () => showScreen('options')),
    ]));
    const replay = el('button', { class: 'btn xs ghost', text: 'Watch a replay…', title: 'Open a replay file saved from the game menu',
      onclick: () => App.openReplayFile() });

    /* -- your decks, as deck boxes, with the replay button on their heading -- */
    const idx = MTG.decks.index();
    if (!idx.length) page.appendChild(el('div', { class: 'home-replay' }, [replay]));
    if (idx.length) {
      page.appendChild(el('div', { class: 'home-section-row' }, [
        el('div', { class: 'section-title home-section', text: 'Your recent decks' }), replay,
      ]));
      const row = el('div', { class: 'recent-decks' });
      for (const d of idx.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)) {
        const b = el('button', { class: 'recent-deck', onclick: () => openDeck(d.id) }, [
          el('div', { class: 'recent-art', 'aria-hidden': 'true' }),
          el('div', { class: 'recent-body' }, [
            el('div', { class: 'recent-name', text: d.name }),
            el('div', { class: 'recent-meta' }, [
              UI.pips(d.identity),
              el('span', { text: `${fmtName(d.format)} · ${d.size}` }),
            ]),
          ]),
        ]);
        deckArt(b.firstChild, d);
        row.appendChild(b);
      }
      page.appendChild(row);
    }

    s.appendChild(el('div', { class: 'menu-wrap home-wrap' }, page));
  }

  /**
   * One click from the front door to a game: a format, how many bots, how
   * good they are, and — if you like — your colours or one of your decks.
   * Everything else is chosen for you, and remembered for next time.
   */
  function quickGamePanel() {
    const q = quickPrefs();
    const panel = el('section', { class: 'quick', 'aria-labelledby': 'quickTitle' });
    const maxOpp = () => Math.min(7, (MTG.formats.get(q.formatId).maxPlayers || 8) - 1);

    const draw = () => {
      panel.innerHTML = '';
      q.opponents = U.clamp(q.opponents, 1, maxOpp());
      const fmt = MTG.formats.get(q.formatId);
      panel.appendChild(el('div', { class: 'quick-head' }, [
        el('h2', { id: 'quickTitle', text: 'Quick game' }),
        el('span', { class: 'quick-sub', text: quickKindOf(q.formatId).id === 'limited'
          ? 'Straight to the first pack. The other seats are bots.'
          : 'Straight to the table. A deck is built for you.' }),
      ]));

      // the format
      const kind = quickKindOf(q.formatId);
      panel.appendChild(field('Game', segmented(QUICK_KINDS.map(k => [k.id, k.label]), kind.id, (v) => {
        const next = QUICK_KINDS.find(k => k.id === v);
        if (!next || next.id === kind.id) return;
        q.lastByKind[kind.id] = q.formatId;
        q.formatId = q.lastByKind[next.id] || next.formats[0][0];
        q.deckId = ''; saveQuick(q); draw();
      }, 'Kind of game')));
      const fmtRow = segmented(kind.formats.map(([id, label]) => [id, label]), q.formatId, (v) => {
        q.formatId = v; q.lastByKind[kind.id] = v; q.deckId = ''; saveQuick(q); draw();
      }, 'Format');
      fmtRow.classList.add('seg-wrap');
      const fmtNow = MTG.formats.get ? MTG.formats.get(q.formatId) : null;
      panel.appendChild(field('Format', fmtRow));
      if (fmtNow && fmtNow.blurb) panel.appendChild(el('p', { class: 'quick-blurb small muted', text: fmtNow.blurb }));
      const limited = kind.id === 'limited';

      // how many, and how good
      const opp = segmented(Array.from({ length: maxOpp() }, (x, i) => [i + 1, String(i + 1)]), q.opponents, (v) => {
        q.opponents = v; saveQuick(q); draw();
      }, 'Opponents');
      opp.classList.add('seg-count');
      const diff = MTG.bots.DIFFICULTY[q.difficulty] || MTG.bots.DIFFICULTY[5];
      const stepper = el('div', { class: 'stepper-pill', role: 'group', 'aria-label': 'Bot difficulty' }, [
        el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Easier', text: '−', disabled: q.difficulty <= 1,
          onclick: () => { q.difficulty = Math.max(1, q.difficulty - 1); saveQuick(q); draw(); } }),
        el('span', { class: 'step-val', 'aria-live': 'polite' }, [
          el('b', { text: String(q.difficulty) }), el('span', { text: diff.label }),
        ]),
        el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Harder', text: '+', disabled: q.difficulty >= 10,
          onclick: () => { q.difficulty = Math.min(10, q.difficulty + 1); saveQuick(q); draw(); } }),
      ]);
      panel.appendChild(el('div', { class: 'quick-pair' }, [
        field(q.opponents > 1 ? `${q.opponents} opponents` : '1 opponent', opp),
        field('Difficulty', stepper),
      ]));

      // your deck: one of yours, or a fresh one in the colours you pick
      const mine = MTG.decks.forFormat(q.formatId);
      // the starter decks sit between "build me one" and your own
      const starters = MTG.starters ? MTG.starters.forFormat(q.formatId) : [];
      const isStarter = (v) => String(v || '').startsWith('starter:');
      if (q.deckId && !mine.some(d => d.id === q.deckId) &&
          !(isStarter(q.deckId) && starters.some(s => 'starter:' + s.id === q.deckId))) q.deckId = '';
      const deckSel = el('select', { 'aria-label': 'Your deck' }, [
        el('option', { value: '', text: 'Build me a fresh deck' }),
        starters.length ? el('optgroup', { label: 'Starter decks' }, starters.map(s =>
          el('option', { value: 'starter:' + s.id, text: s.name, selected: 'starter:' + s.id === q.deckId }))) : null,
        mine.length ? el('optgroup', { label: 'Your decks' }, mine.map(d =>
          el('option', { value: d.id, text: d.name, selected: d.id === q.deckId }))) : null,
      ]);
      deckSel.addEventListener('change', () => { q.deckId = deckSel.value; saveQuick(q); draw(); });
      const colours = el('div', { class: 'colour-picks', role: 'group', 'aria-label': 'Your colours, up to two' },
        ['W', 'U', 'B', 'R', 'G'].map(c => el('button', {
          type: 'button', class: 'colour-pick' + (q.colors.includes(c) ? ' on' : ''),
          'aria-pressed': q.colors.includes(c) ? 'true' : 'false',
          title: MTG.mana.COLOR_NAMES[c],
          html: `<i class="pip pip-${c.toLowerCase()}">${c}</i>`,
          onclick: () => {
            const i = q.colors.indexOf(c);
            if (i >= 0) q.colors.splice(i, 1);
            else { q.colors.push(c); if (q.colors.length > 2) q.colors.shift(); }
            saveQuick(q); draw();
          },
        })));
      if (!limited) {
        panel.appendChild(el('div', { class: 'quick-pair' }, [
          mine.length || starters.length ? field('Your deck', deckSel) : null,
          q.deckId ? null : field(q.colors.length ? 'Your colours' : 'Your colours · any', colours),
        ].filter(Boolean)));
      } else {
        /* A draft needs something to draft from: a set for boosters, a cube
           for a cube, and nothing at all for chaos, which picks its own. */
        const style = fmtNow && fmtNow.draft ? fmtNow.draft.style : '';
        if (style && style !== 'cube') {
          panel.appendChild(field('Boosters', segmented([['play', 'Play boosters'], ['collector', 'Collector boosters']],
            q.collector ? 'collector' : 'play', (v) => { q.collector = v === 'collector'; saveQuick(q); draw(); }, 'Kind of booster')));
        }
        if (style === 'booster' || style === 'commander') {
          const setSel = el('select', { 'aria-label': 'Set to draft' }, [el('option', { value: '', text: 'The newest set' })]);
          MTG.scry.draftableSets().then((sets) => {
            for (const st of sets.slice(0, 60)) setSel.appendChild(el('option', { value: st.code, text: st.name, selected: st.code === q.setCode }));
          }).catch(() => {});
          setSel.addEventListener('change', () => { q.setCode = setSel.value; saveQuick(q); });
          panel.appendChild(field('Set', setSel));
        } else if (style === 'cube') {
          const cubeSel = el('select', { 'aria-label': 'Cube to draft' }, MTG.draft.recipes.map(r =>
            el('option', { value: r.id, text: r.name, selected: r.id === q.cubeId })));
          cubeSel.addEventListener('change', () => { q.cubeId = cubeSel.value; saveQuick(q); });
          panel.appendChild(field('Cube', cubeSel));
        } else if (style === 'chaos') {
          panel.appendChild(field('Sets', chaosSetsSelect(q.chaosPool, (pool) => { q.chaosPool = pool; saveQuick(q); draw(); })));
        }
      }

      const go = el('button', {
        class: 'btn primary hero-btn', html: `${SVG.play}<span>Play</span>`,
        onclick: async () => {
          go.disabled = true;
          let deck = null;
          if (isStarter(q.deckId)) {
            try { deck = await MTG.starters.build(q.deckId.slice(8)); }
            catch (e) { go.disabled = false; return UI.error(e.message || String(e)); }
          } else if (q.deckId) {
            deck = await MTG.decks.load(q.deckId);
            if (!deck) { go.disabled = false; return UI.error('That deck could not be loaded.'); }
            const ok = await UI.checkAutomation(deck, { onEdit: (d) => UI.deckBuilder(d, { onSave: () => renderHome() }) });
            if (!ok) { go.disabled = false; return; }
          }
          App.quickGame({
            formatId: q.formatId, difficulty: q.difficulty, opponents: q.opponents,
            colors: q.colors.length ? q.colors.slice() : null, deck: deck || undefined,
            setCode: q.setCode || '', cubeId: q.cubeId || 'modern', chaosPool: q.chaosPool || null,
            collector: !!q.collector,
          });
        },
      });
      panel.appendChild(el('div', { class: 'quick-go' }, [
        go,
        el('span', { class: 'quick-note', text: `${fmt.name} · ${fmt.startingLife} life · ${q.opponents + 1} players` }),
      ]));
    };
    draw();
    return panel;
  }

  /** A labelled control, as the quick game and the options lay them out. */
  function field(label, control) {
    return el('div', { class: 'qfield' }, [el('span', { class: 'qlabel', text: label }), control]);
  }

  /**
   * A row of choices where exactly one is on: a radio group drawn as one
   * piece. `options` is [[value, label, title?]]; the arrow keys move along it.
   */
  function segmented(options, current, onPick, label) {
    const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || '' });
    const btns = options.map(([v, text, title]) => el('button', {
      type: 'button', class: 'seg-btn' + (String(v) === String(current) ? ' on' : ''),
      role: 'radio', 'aria-checked': String(v) === String(current) ? 'true' : 'false',
      tabindex: String(v) === String(current) ? '0' : '-1',
      title: title || null, text,
      onclick: () => { MTG.sfx('click'); onPick(v); },
    }));
    if (!btns.some(b => b.classList.contains('on')) && btns[0]) btns[0].setAttribute('tabindex', '0');
    group.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = btns[(i + step + btns.length) % btns.length];
      next.focus();
      next.click();
      // the group redraws on a pick; put the focus back on the same choice
      setTimeout(() => {
        const again = Array.from(document.querySelectorAll('.seg[aria-label="' + (label || '') + '"] .seg-btn'))
          .find(b => b.textContent === next.textContent);
        if (again) again.focus();
      }, 0);
    });
    group.append(...btns);
    return group;
  }

  /** A deck's own art on a node: from the index if it has it, else from the deck. */
  function deckArt(node, d) {
    if (d.art) { UI.setArt(node, d.art); return node; }
    MTG.decks.ensureArt(d.id).then((url) => { if (url) UI.setArt(node, url); }).catch(() => {});
    return node;
  }

  const SVG = {
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
    deck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="11" height="15" rx="2"/><path d="M8 3h9a2 2 0 0 1 2 2v12"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 20a6.4 6.4 0 0 0-2.2-4.8"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8M9 13h.01M15 13h.01M9.5 16.2h5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  };

  async function openDeck(id) {
    const busy = UI.busy('Loading deck');
    const full = await MTG.decks.load(id);
    busy.close();
    if (!full) return UI.error('That deck could not be loaded.');
    UI.deckBuilder(full, { onSave: () => { if (App.screen === 'decks') renderDecks(); else renderHome(); } });
  }

  /* ================= 2. play: choose a format ================= */
  const CATEGORIES = [
    { id: 'constructed', name: 'Constructed', blurb: 'Bring a deck you built. Everyone plays their own list.' },
    { id: 'limited', name: 'Limited', blurb: 'Open packs at the table and build from what you draft.' },
  ];

  function renderFormats() {
    const s = screens.formats;
    s.innerHTML = '';
    sceneBackdrop(s);
    const inner = el('div', { class: 'menu-inner' });
    inner.appendChild(pageHeader('Play', 'Choose a format. Add bots or open a room for other people once the table is set up.', 'home'));

    for (const cat of CATEGORIES) {
      const list = MTG.formats.list().filter(f => f.kind === cat.id);
      if (!list.length) continue;
      inner.appendChild(el('div', { class: 'cat-head' }, [
        el('h2', { class: 'cat-title', text: cat.name }),
        el('p', { class: 'cat-blurb', text: cat.blurb }),
      ]));
      const grid = el('div', { class: 'format-grid' });
      for (const f of list) {
        const art = el('div', { class: 'fmt-art', 'aria-hidden': 'true' });
        const card = el('button', {
          class: 'format-card fmt-' + f.id,
          dataset: { fmt: f.id },
          onclick: () => { App.formatId = f.id; startLobby('host'); },
        }, [
          art,
          el('div', { class: 'fmt-life', title: `${f.startingLife} life` }, [
            el('b', { text: String(f.startingLife) }),
            el('i', { text: 'life' }),
          ]),
          el('div', { class: 'fmt-body' }, [
            el('h3', { text: f.name }),
            el('p', { text: f.blurb }),
            el('div', { class: 'meta' }, [
              el('span', { class: 'pill', text: `${f.minPlayers}–${f.maxPlayers} players` }),
              f.exactSize ? el('span', { class: 'pill', text: f.deckMin + ' cards' })
                : el('span', { class: 'pill', text: (f.deckMin || 60) + '+ cards' }),
              f.commanderDamage ? el('span', { class: 'pill', text: `${f.commanderDamage} cmd dmg` }) : null,
              f.draft ? el('span', { class: 'pill', text: `${f.draft.packs} packs` }) : null,
              f.singleton ? el('span', { class: 'pill', text: 'singleton' }) : null,
            ].filter(Boolean)),
          ]),
        ]);
        decorArt(art, FORMAT_ART[f.id]);
        grid.appendChild(card);
      }
      inner.appendChild(grid);
    }

    inner.appendChild(el('div', { class: 'section-title', text: 'Or join someone else’s table' }));
    const codeInput = el('input', {
      type: 'text', placeholder: 'ROOM CODE', maxlength: '5',
      class: 'code-input', 'aria-label': 'Room code', autocomplete: 'off', spellcheck: 'false',
    });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(codeInput.value); });
    inner.appendChild(el('div', { class: 'panel join-panel' }, [
      el('div', { class: 'join-icon', html: SVG.users }),
      el('div', { class: 'grow' }, [
        el('h3', { class: 'join-title', text: 'Join a friend' }),
        el('p', { class: 'small muted', style: { margin: '0 0 10px' },
          text: net.peerAvailable()
            ? 'Type the five-letter code the host shares. You connect straight to them; only the code passes through a public broker.'
            : 'The multiplayer library did not load — solo and bot games still work.' }),
        el('div', { class: 'row wrap' }, [
          codeInput,
          el('button', { class: 'btn primary', text: 'Join', onclick: () => joinRoom(codeInput.value) }),
        ]),
      ]),
    ]));

    s.appendChild(el('div', { class: 'menu-wrap' }, inner));
  }

  /* ================= 3. deck builder ================= */
  const DECK_SORTS = [
    ['recent', 'Last edited', (a, b) => b.updatedAt - a.updatedAt],
    ['name', 'Name (A\u2013Z)', (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })],
    ['format', 'Format', (a, b) => fmtName(a.format).localeCompare(fmtName(b.format)) || b.updatedAt - a.updatedAt],
    ['size', 'Card count', (a, b) => (b.size || 0) - (a.size || 0)],
    ['colors', 'Colour identity', (a, b) => {
      const k = (d) => ((d.identity || []).length ? (d.identity || []).length + (d.identity || []).join('') : '0');
      return k(a).localeCompare(k(b)) || b.updatedAt - a.updatedAt;
    }],
    ['attention', 'Needs attention', (a, b) => (deckLegalSize(a) ? 1 : 0) - (deckLegalSize(b) ? 1 : 0) || b.updatedAt - a.updatedAt],
  ];
  const fmtName = (id) => { const f = MTG.formats.get(id); return (f && f.name) || String(id); };
  function deckLegalSize(d) {
    const fmt = MTG.formats.get(d.format);
    if (!fmt) return true;
    return fmt.exactSize ? d.size === fmt.deckMin
      : d.size >= (fmt.deckMin || 0) && (fmt.deckMax == null || d.size <= fmt.deckMax);
  }

  function renderDecks() {
    const s = screens.decks;
    s.innerHTML = '';
    sceneBackdrop(s);
    const inner = el('div', { class: 'menu-inner' });
    const importBtn = () => el('button', { class: 'btn primary', html: `${SVG.plus}<span>Import a list</span>`,
      onclick: () => UI.importDeck(App.formatId, () => renderDecks()) });
    inner.appendChild(pageHeader('Decks', 'Import a list from anywhere, tune it with suggestions, and see what it combos into. Decks are saved in this browser.', 'home', [
      importBtn(),
      el('button', { class: 'btn', text: 'New deck', onclick: () => newDeck() }),
      el('button', { class: 'btn ghost', text: 'Cubes', title: 'Cubes for cube drafts', onclick: () => UI.cubeManager() }),
    ]));

    const all = MTG.decks.index().slice();
    if (!all.length) {
      const empty = el('div', { class: 'panel empty-state' }, [
        el('div', { class: 'empty-art', 'aria-hidden': 'true' }),
        el('div', { class: 'empty-icon', html: SVG.deck }),
        el('h3', { text: 'No decks yet' }),
        el('p', { class: 'small muted', text: 'Paste an export from Moxfield, Archidekt, MTGGoldfish, TappedOut, Deckstats, EDHREC or MTG Arena — or just a list of card names, one per line.' }),
        el('div', { class: 'row', style: { justifyContent: 'center' } }, [
          importBtn(),
          el('button', { class: 'btn', text: 'Start from nothing', onclick: () => newDeck() }),
        ]),
      ]);
      decorArt(empty.firstChild, TILE_ART.decks);
      inner.appendChild(empty);
      const shelf = starterShelf();
      if (shelf) inner.appendChild(shelf);
      s.appendChild(el('div', { class: 'menu-wrap' }, inner));
      return;
    }

    const S = MTG.settings;
    let sortKey = DECK_SORTS.some(x => x[0] === S.deckSort) ? S.deckSort : 'recent';
    let formatFilter = S.deckFilter || 'all';
    const presentFormats = Array.from(new Set(all.map(d => d.format)));
    if (formatFilter !== 'all' && !presentFormats.includes(formatFilter)) formatFilter = 'all';
    let query = '';

    const search = el('input', { type: 'search', placeholder: 'Search decks or commanders…', value: '', 'aria-label': 'Search decks' });
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); draw(); });

    // the formats you actually have decks in, as chips rather than a menu
    const chips = el('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Format' });
    const drawChips = () => {
      chips.innerHTML = '';
      const opts = [['all', `All · ${all.length}`]].concat(presentFormats
        .sort((a, b) => fmtName(a).localeCompare(fmtName(b)))
        .map(f => [f, `${fmtName(f)} · ${all.filter(d => d.format === f).length}`]));
      for (const [v, label] of opts) {
        chips.appendChild(el('button', {
          type: 'button', class: 'chip' + (v === formatFilter ? ' on' : ''), text: label,
          'aria-pressed': v === formatFilter ? 'true' : 'false',
          onclick: () => { formatFilter = v; MTG.setSetting('deckFilter', formatFilter); drawChips(); draw(); },
        }));
      }
    };
    drawChips();

    const sortSel = el('select', { 'aria-label': 'Sort decks by' },
      DECK_SORTS.map(([k, label]) => el('option', { value: k, text: label, selected: k === sortKey })));
    sortSel.addEventListener('change', () => {
      sortKey = sortSel.value; MTG.setSetting('deckSort', sortKey); draw();
    });

    const count = el('span', { class: 'deck-count' });
    inner.appendChild(el('div', { class: 'deck-toolbar' }, [
      el('label', { class: 'search-field' }, [el('span', { class: 'search-ico', html: SVG.search, 'aria-hidden': 'true' }), search]),
      chips,
      el('span', { class: 'grow' }),
      count,
      el('label', { class: 'sort-field' }, [el('span', { text: 'Sort' }), sortSel]),
    ]));

    const host = el('div');
    inner.appendChild(host);
    const shelf = starterShelf();
    if (shelf) inner.appendChild(shelf);
    s.appendChild(el('div', { class: 'menu-wrap' }, inner));
    draw();

    function draw() {
      const sorter = (DECK_SORTS.find(x => x[0] === sortKey) || DECK_SORTS[0])[2];
      let list = all.filter(d => formatFilter === 'all' || d.format === formatFilter);
      if (query) {
        list = list.filter(d =>
          String(d.name).toLowerCase().includes(query) ||
          String(d.commander || '').toLowerCase().includes(query) ||
          fmtName(d.format).toLowerCase().includes(query));
      }
      list.sort(sorter);
      count.textContent = list.length === all.length
        ? `${all.length} deck${all.length === 1 ? '' : 's'}`
        : `${list.length} of ${all.length}`;

      host.innerHTML = '';
      if (!list.length) {
        host.appendChild(el('div', { class: 'panel empty-note', text: 'No decks match that.' }));
        return;
      }
      // only the format sort earns headings; the others read as one list
      if (sortKey === 'format' && formatFilter === 'all') {
        for (const [fmtId, group] of U.groupBy(list, d => d.format)) {
          host.appendChild(el('div', { class: 'section-title', text: fmtName(fmtId) }));
          const grid = el('div', { class: 'deck-cards' });
          for (const d of group) grid.appendChild(deckCard(d));
          host.appendChild(grid);
        }
      } else {
        const grid = el('div', { class: 'deck-cards' });
        for (const d of list) grid.appendChild(deckCard(d));
        host.appendChild(grid);
      }
    }
  }

  /**
   * A deck as a deck box: its key card's art across the top, the name over
   * it, and what you need to know underneath — colours, format, whether it
   * is a legal size. Clicking the art opens it; Play takes it to a table.
   */
  function deckCard(d) {
    const legalSize = deckLegalSize(d);
    const fmt = MTG.formats.get(d.format);
    const art = el('div', { class: 'deck-art', 'aria-hidden': 'true' });
    deckArt(art, d);
    const sizeTip = legalSize ? 'A legal size' : `Not a legal size for ${fmtName(d.format)}` +
      (fmt ? ` (${fmt.exactSize ? 'exactly ' + fmt.deckMin : 'at least ' + (fmt.deckMin || 0)})` : '');
    return el('article', { class: 'deck-card' + (legalSize ? '' : ' needs-work') }, [
      el('button', { class: 'deck-open', 'aria-label': 'Open ' + d.name, onclick: () => openDeck(d.id) }, [
        art,
        el('div', { class: 'deck-face' }, [
          UI.pips(d.identity, 'deck-pips'),
          el('div', { class: 'deck-card-name', text: d.name }),
          el('div', { class: 'deck-sub', text: (d.commander || (d.source === 'draft' ? 'Drafted' : fmtName(d.format))) + ' · ' + timeAgo(d.updatedAt) }),
          UI.deckAutoPill(d, 'on-art'),
        ]),
      ]),
      el('div', { class: 'deck-foot' }, [
        el('span', { class: 'pill', text: fmtName(d.format) }),
        el('span', { class: 'pill ' + (legalSize ? 'good' : 'bad'), title: sizeTip, text: d.size + ' cards' }),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn xs ghost danger-ghost', 'aria-label': 'Delete ' + d.name, title: 'Delete',
          html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
          onclick: async () => {
            if (await UI.confirm(`Delete "${d.name}"?`, 'Delete deck')) { MTG.decks.remove(d.id); renderDecks(); }
          } }),
        el('button', { class: 'btn xs primary', text: 'Play', title: 'Start a game with this deck',
          onclick: () => { App.formatId = d.format; startLobby('host'); setTimeout(() => usePreselectedDeck(d.id), 20); } }),
      ]),
    ]);
  }

  async function usePreselectedDeck(id) {
    const full = await MTG.decks.load(id);
    if (!full || !App.session) return;
    const me = App.session.seat('me');
    if (!me) return;
    me.deck = full;
    me.deckValid = MTG.formats.validate(full, App.session.fmt);
    renderLobby();
  }

  /** A deck you have in hand (a starter, say) taken to a new table of its format. */
  function playWithDeck(deck) {
    App.formatId = deck.format;
    startLobby('host');
    const me = App.session && App.session.seat('me');
    if (!me) return;
    me.deck = deck;
    me.deckValid = MTG.formats.validate(deck, App.session.fmt);
    renderLobby();
  }

  /**
   * The starter decks, as a shelf of deck boxes under your own: ready to
   * play, or to copy into your decks and change.
   */
  function starterShelf() {
    if (!MTG.starters || !MTG.starters.list.length) return null;
    // a row of boxes for each format, under its name when there is more than one
    const formats = Array.from(new Set(MTG.starters.list.map(st => st.format)));
    const rows = [];
    for (const f of formats) {
      const mine = MTG.starters.forFormat(f);
      if (formats.length > 1) rows.push(el('div', { class: 'section-title', style: { margin: '18px 0 12px' }, text: `${fmtName(f)} · ${mine.length}` }));
      rows.push(el('div', { class: 'deck-cards' }, mine.map(st => UI.starterBox(st, {
        onCopied: () => renderDecks(),
        onUse: (deck) => playWithDeck(deck),
      }))));
    }
    return el('section', { class: 'starter-shelf', 'aria-labelledby': 'starterTitle' }, [
      el('div', { class: 'cat-head' }, [
        el('h2', { class: 'cat-title', id: 'starterTitle', text: 'Starter decks' }),
        el('p', { class: 'cat-blurb', text: 'Ready to play, in Standard and Modern. The game runs every card in them by itself. Copy one into your decks to change it.' }),
      ]),
    ].concat(rows));
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 90) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  async function newDeck() {
    const name = await UI.prompt('Name this deck', 'New deck');
    if (name == null) return;
    UI.deckBuilder({
      id: MTG.uid('deck'), name: name || 'New deck', format: App.formatId,
      main: [], sideboard: [], commanders: [], companion: null,
    }, { onSave: () => renderDecks() });
  }

  /* ================= 4. options ================= */
  /** Send this device's auto-pass preferences to whoever is running the game. */
  function pushAutoPass() {
    const cfg = MTG.autoPassConfig();
    if (App.session && App.session.game) App.session.game.setAutoPass('me', cfg);
    else if (net && net.isClient) net.intent({ kind: 'autoPass', cfg });
  }

  /* ---- the card database (02a-carddb.js) ----
     Scryfall's bulk card data, saved in the browser so bots, drafts and
     searches need no network. Offered once on a first visit, and kept
     in Options under Card data. */
  const CARD_DB_SIZE = { default_cards: 79e6, oracle_cards: 25e6 };   // until Scryfall says exactly
  const megabytes = (b) => (b >= 1e7 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
  const shortDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso || '').slice(0, 10); }
  };
  function cardDbJobText(job) {
    if (!job) return '';
    switch (job.phase) {
      case 'download':
        return job.total ? `Downloading: ${megabytes(job.got)} of ${megabytes(job.total)}` +
          (job.resumed ? ', carrying on from where it stopped' : '') + (job.retry ? ' (the connection dropped; trying again)' : '')
          : 'Asking Scryfall for the file…';
      case 'unpack': return `Unpacking: ${(job.cards || 0).toLocaleString()} cards so far`;
      case 'store': return 'Saving it in this browser…';
      case 'done': return 'Done.';
      case 'cancelled': return 'Stopped. What has downloaded so far is kept, and the next download carries on from there.';
      case 'error': return 'The download did not finish: ' + job.error;
    }
    return '';
  }
  // the download is most of the wait, the unpacking most of the rest
  function cardDbJobShare(job) {
    if (!job) return 0;
    const f = job.total ? Math.min(1, job.got / job.total) : 0;
    return job.phase === 'download' ? f * 0.7 : job.phase === 'unpack' ? 0.7 + f * 0.27 : job.phase === 'store' ? 0.98 : 1;
  }
  function startCardDb(kind) {
    const run = MTG.cardDb.download(kind);
    cardDbProgress();
    run.then((ok) => {
      const st = MTG.cardDb.status();
      if (ok) UI.ok(`The card database is ready: ${st.cards.toLocaleString()} cards.`);
      else if (st.job && st.job.phase === 'error') UI.error(cardDbJobText(st.job));
    });
  }
  /** The download's progress in a window that can be hidden while it carries on. */
  function cardDbProgress() {
    const bar = el('div', { class: 'progress' }, el('div', { style: { width: '0%' } }));
    const text = el('p', { class: 'small muted', 'aria-live': 'polite', style: { margin: '0 0 10px' } });
    const m = UI.modal({
      title: 'Downloading the card database',
      content: el('div', null, [text, bar,
        el('p', { class: 'tiny dim', style: { margin: '12px 0 0' }, text: 'Carry on using the app if you like; Options, under Card data, shows how far it has got.' })]),
      buttons: [
        { label: 'Stop', onClick: () => { MTG.cardDb.cancel(); m.close(); } },
        { label: 'Hide', class: 'primary', onClick: () => m.close() },
      ],
    });
    const paint = (job) => {
      if (!job) return;
      text.textContent = cardDbJobText(job);
      bar.firstChild.style.width = Math.round(cardDbJobShare(job) * 100) + '%';
      if (/done|error|cancelled/.test(job.phase)) { off(); setTimeout(() => m.close(), job.phase === 'done' ? 700 : 0); }
    };
    const off = MTG.bus.on('carddb:progress', paint);
    m._onClose = () => off();
    paint(MTG.cardDb.job);
  }
  /** The Card data row: what is stored, and the buttons to fetch, update or remove it. */
  function cardDbRow() {
    const host = el('div', { class: 'opt-row stacked' });
    const DB = MTG.cardDb;
    let pending = null;
    const draw = () => {
      if (!host.isConnected && host.parentNode) return;
      const st = DB.status();
      const job = st.job && /download|unpack|store/.test(st.job.phase) ? st.job : null;
      const kids = [el('div', { class: 'opt-label', text: 'Card database' })];
      const buttons = [];
      if (job) {
        kids.push(el('div', { class: 'opt-help', text: cardDbJobText(job) }));
        kids.push(el('div', { class: 'progress', style: { marginTop: '8px', maxWidth: '58ch' } },
          el('div', { style: { width: Math.round(cardDbJobShare(job) * 100) + '%' } })));
        buttons.push(el('button', { class: 'btn sm', text: 'Stop the download', onclick: () => DB.cancel() }));
      } else if (st.present) {
        const info = st.info || {};
        const kind = DB.KINDS[info.kind] || DB.KINDS.default_cards;
        kids.push(el('div', { class: 'opt-help', text:
          `${kind.name}: ${st.cards.toLocaleString()} cards` + (info.kind === 'oracle_cards' ? '' : ` in ${st.prints.toLocaleString()} printings`) +
          ` · Scryfall's data of ${shortDate(info.updated_at)}` + (info.stored ? ` · about ${megabytes(info.stored)} stored` : '') + '.' }));
        kids.push(el('div', { class: 'opt-help', text: info.kind === 'oracle_cards'
          ? 'Bots, the deck builder and card lookups use it and need no network. Drafts and the art picker still ask Scryfall.'
          : 'Bots, drafts, the deck builder and card lookups use it and need no network. Card pictures still come from Scryfall.' }));
        const newer = st.latest && st.latest.updated_at > (info.updated_at || '') ? st.latest : null;
        if (newer) kids.push(el('div', { class: 'opt-help', text: `Scryfall has a newer copy, from ${shortDate(newer.updated_at)} (${megabytes(newer.size)}).` }));
        buttons.push(newer
          ? el('button', { class: 'btn sm primary', text: 'Update', onclick: () => startCardDb(info.kind) })
          : el('button', { class: 'btn sm', text: 'Check for a newer copy', onclick: async (e) => {
            e.target.disabled = true;
            const n = await DB.checkUpdate();
            if (!n) UI.ok(DB.latest ? 'The card database is up to date.' : 'Could not reach Scryfall to check.');
            draw();
          } }));
        buttons.push(el('button', { class: 'btn sm danger', text: 'Delete the card database', onclick: async () => {
          if (!await UI.confirm('Delete the card database from this browser? Cards will be fetched from Scryfall as they are needed again, as before.')) return;
          await DB.remove(); UI.ok('Card database deleted.');
        } }));
      } else {
        kids.push(el('div', { class: 'opt-help', text: 'Scryfall’s card data, saved in this browser. Bots build their decks in moments instead of waiting on dozens of searches, the deck builder searches instantly, and games work without a connection. One download; card pictures still come from Scryfall.' }));
        const last = st.job;
        if (last && last.phase === 'error') kids.push(el('div', { class: 'opt-help', text: cardDbJobText(last) }));
        if (pending) kids.push(el('div', { class: 'opt-help', text: `A download stopped part way (${megabytes(pending.got)} so far); downloading again carries on from there.` }));
        buttons.push(el('button', { class: 'btn sm primary', text: `Download the card database (${megabytes(CARD_DB_SIZE.default_cards)})`,
          title: DB.KINDS.default_cards.blurb, onclick: () => startCardDb('default_cards') }));
        buttons.push(el('button', { class: 'btn sm', text: `One printing per card (${megabytes(CARD_DB_SIZE.oracle_cards)})`,
          title: DB.KINDS.oracle_cards.blurb, onclick: () => startCardDb('oracle_cards') }));
      }
      kids.push(el('div', { class: 'row wrap', style: { marginTop: '10px' } }, buttons));
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'grow' }, kids));
    };
    const redraw = () => { if (!host.isConnected) { offA(); offB(); return; } draw(); };
    const offA = MTG.bus.on('carddb:progress', U.debounce(redraw, 150));
    const offB = MTG.bus.on('carddb:changed', redraw);
    draw();
    // what is stored loads in the background; ask Scryfall once a session whether there is newer
    DB.ready().then((has) => {
      if (has && !DB.latest && navigator.onLine !== false) DB.checkUpdate().then(redraw);
      else if (!has) DB.pending().then((p) => { pending = p; redraw(); });
      redraw();
    });
    // Scryfall's own figures for the two downloads, when it can be asked
    DB.bulkInfo('default_cards').then((i) => { CARD_DB_SIZE.default_cards = i.size || CARD_DB_SIZE.default_cards; return DB.bulkInfo('oracle_cards'); })
      .then((i) => { CARD_DB_SIZE.oracle_cards = i.size || CARD_DB_SIZE.oracle_cards; if (!DB.has()) redraw(); }).catch(() => {});
    return host;
  }
  /**
   * The first visit: offer the database once, and only download it on a yes.
   * Later visits look for a newer copy now and then, and mention it when the
   * one here has fallen well behind (a new set, most likely).
   */
  async function offerCardDb() {
    const DB = MTG.cardDb;
    if (!DB) return;
    const has = await DB.ready();
    if (has) {
      const last = MTG.store.get('cardDb.checked', 0) || 0;
      if (Date.now() - last < 1000 * 60 * 60 * 24 || navigator.onLine === false) return;
      MTG.store.set('cardDb.checked', Date.now());
      const newer = await DB.checkUpdate();
      if (newer && Date.parse(newer.updated_at) - Date.parse(DB.info.updated_at || 0) > 1000 * 60 * 60 * 24 * 14)
        UI.toast('A newer card database is available: Options, Card data.', 'ok', 6000);
      return;
    }
    // nor to a browser being driven by a test, which is nobody's first visit
    if (MTG.store.get('cardDb.offered', false) || DB.job || navigator.webdriver) return;
    await U.sleep(2500);
    // not on top of something else; there is always next time
    if (App.screen !== 'home' || document.querySelector('.modal-back') || DB.job) return;
    MTG.store.set('cardDb.offered', true);
    const yes = await new Promise((res) => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; res(v); } };
      const m = UI.modal({
        title: 'Download the card database?',
        content: el('div', null, [
          el('p', { style: { margin: '0 0 10px' }, text: 'MTG Table asks Scryfall for each card as it needs it. With Scryfall’s card database saved in this browser instead, the bots build their decks in moments, searching is instant, and games work offline.' }),
          el('p', { class: 'small muted', style: { margin: 0 }, text: `It is one download of about ${megabytes(CARD_DB_SIZE.default_cards)}. You can do this later, or delete it again, from Options under Card data.` }),
        ]),
        buttons: [
          { label: 'Not now', onClick: () => { settle(false); m.close(); } },
          { label: 'Download', class: 'primary', onClick: () => { settle(true); m.close(); } },
        ],
      });
      m._onClose = () => settle(false);
    });
    if (yes) startCardDb('default_cards');
  }

  /* The sections of the options screen, in the order they are read. On a
     wide screen they are listed down the side as a contents. */
  /* The options, one category at a time: the list down the side picks
     which, and the page remembers the last one you looked at. */
  const OPT_SECTIONS = [
    ['you', 'You'], ['display', 'Display'], ['gameplay', 'Gameplay'], ['pace', 'Pace'], ['stops', 'Stops'],
    ['access', 'Accessibility'], ['sound', 'Sound'], ['online', 'Online'], ['data', 'Card data'],
  ];
  const BOT_PACE = [[0, 'Instant'], [250, 'Quick'], [600, 'Normal'], [1200, 'Unhurried']];
  const ANIM_PACE = [[0.5, 'Fast'], [1, 'Normal'], [1.6, 'Relaxed']];

  function renderOptions() {
    const s = screens.options;
    const scroller = s.querySelector('.menu-wrap');
    const keepTop = scroller ? scroller.scrollTop : 0;
    s.innerHTML = '';
    sceneBackdrop(s);
    const inner = el('div', { class: 'menu-inner opt-page' + (scroller ? ' again' : '') });
    inner.appendChild(pageHeader('Options', 'Everything is saved in this browser and applies straight away.', 'home'));

    const S = MTG.settings;
    const set = (k, v) => { MTG.setSetting(k, v); MTG.applyDisplaySettings(); };

    /* A setting that is on or off is a switch. The whole row is the target. */
    const toggle = (key, label, help, after, opts) => {
      opts = opts || {};
      const on = opts.invert ? !S[key] : !!S[key];
      const input = el('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: on, id: 'opt-' + key });
      input.addEventListener('change', () => {
        set(key, opts.invert ? !input.checked : input.checked);
        if (after) after();
      });
      return el('label', { class: 'opt-row', for: 'opt-' + key }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: label }),
          help ? el('div', { class: 'opt-help', text: help }) : null,
        ].filter(Boolean)),
        input,
      ]);
    };
    const slider = (key, label, min, max, step, fmt, help) => {
      const out = el('span', { class: 'opt-value', text: fmt(S[key]) });
      const input = el('input', {
        type: 'range', min, max, step, value: String(S[key]), id: 'opt-' + key,
        'aria-label': label, 'aria-valuetext': fmt(S[key]),
      });
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        out.textContent = fmt(v);
        input.setAttribute('aria-valuetext', fmt(v));
        set(key, v);
      });
      return el('div', { class: 'opt-row stacked' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label' }, [el('span', { text: label }), out]),
          help ? el('div', { class: 'opt-help', text: help }) : null,
          input,
        ].filter(Boolean)),
      ]);
    };
    const choice = (key, label, options, help) => {
      const sel = el('select', { id: 'opt-' + key, 'aria-label': label }, options.map(([v, t]) =>
        el('option', { value: v, text: t, selected: String(S[key]) === String(v) })));
      sel.addEventListener('change', () => set(key, sel.value));
      return el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: label }),
          help ? el('div', { class: 'opt-help', text: help }) : null,
        ].filter(Boolean)),
        sel,
      ]);
    };
    /* One of a few named settings, drawn as a segmented control. */
    const pick = (key, label, options, help, fallback, after) => {
      const cur = S[key] == null ? fallback : S[key];
      return el('div', { class: 'opt-row stacked' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: label }),
          help ? el('div', { class: 'opt-help', text: help }) : null,
          segmented(options, cur, (v) => { set(key, v); if (after) after(v); renderOptions(); }, label),
        ].filter(Boolean)),
      ]);
    };
    const group = (id, title, blurb, rows) => el('section', { class: 'panel opt-group', id: 'opt-sec-' + id, 'aria-labelledby': 'opt-h-' + id },
      [el('h3', { id: 'opt-h-' + id, text: title }), blurb ? el('p', { class: 'opt-blurb', text: blurb }) : null].filter(Boolean).concat(rows));

    const sections = [];

    /* -- player -- */
    const nameInput = el('input', { type: 'text', value: App.myName, id: 'opt-name', 'aria-label': 'Display name', maxlength: '28' });
    nameInput.addEventListener('change', () => {
      App.myName = nameInput.value.trim() || randomName();
      nameInput.value = App.myName;
      MTG.setSetting('playerName', App.myName);
    });
    sections.push(group('you', 'You', null, [
      el('div', { class: 'opt-row you-row' }, [
        UI.portrait(App.myName, null, { size: 'lg' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Display name' }),
          el('div', { class: 'opt-help', text: 'What other players at the table see.' }),
          nameInput,
        ]),
      ]),
    ]));

    /* -- gameplay -- */
    sections.push(group('gameplay', 'Gameplay', null, [
      toggle('beginnerHints', 'Beginner hints', 'A line under the big button that says what is going on and what you could do, in plain English.',
        () => { if (App.table) App.table.render(); }),
      el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'First-game walkthrough' }),
          el('div', { class: 'opt-help', text: S.tutorialDone
            ? 'Seen. Play the guided first game again: a gentle bot, a starter deck, and notes on the table as things come up.'
            : 'A guided first game: a gentle bot, a starter deck, and notes on the table as things come up.' }),
        ]),
        el('button', { class: 'btn sm', text: S.tutorialDone ? 'Play it again' : 'Play it', onclick: () => App.startTutorial() }),
      ]),
      toggle('autoTapLands', 'Tap lands for me', 'When you cast something, the engine works out which lands to tap.'),
      toggle('confirmAttacks', 'Confirm before attacking', 'Ask before locking in your attackers.'),
      choice('handSort', 'Sort my hand by', [['cmc', 'Mana value'], ['name', 'Name'], ['type', 'Type'], ['color', 'Colour']]),
    ]));

    /* -- pace: how fast the table moves -- */
    const botNow = S.botSpeed == null ? 600 : S.botSpeed;
    const botOut = el('span', { class: 'opt-value', text: botNow + ' ms' });
    const botRange = el('input', {
      type: 'range', min: '0', max: '2000', step: '50', value: String(botNow), id: 'opt-botSpeed',
      'aria-label': 'Bot thinking time, in milliseconds', 'aria-valuetext': botNow + ' milliseconds',
    });
    botRange.addEventListener('input', () => {
      const v = parseInt(botRange.value, 10);
      botOut.textContent = v + ' ms';
      botRange.setAttribute('aria-valuetext', v + ' milliseconds');
      MTG.setSetting('botSpeed', v);
      for (const b of inner.querySelectorAll('#opt-sec-pace .bot-seg .seg-btn')) {
        const on = b.dataset.v === String(v);
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    });
    const botSeg = segmented(BOT_PACE, botNow, (v) => { MTG.setSetting('botSpeed', v); renderOptions(); }, 'Bot thinking time');
    botSeg.classList.add('bot-seg');
    botSeg.querySelectorAll('.seg-btn').forEach((b, i) => { b.dataset.v = String(BOT_PACE[i][0]); });
    sections.push(group('pace', 'Pace', 'How quickly the table moves. Nothing here changes the rules.', [
      pick('animSpeed', 'Table animations', ANIM_PACE,
        'How long cards take to fly, flip and land. Fast keeps games brisk; relaxed lets you follow every move.', 1),
      el('div', { class: 'opt-row stacked' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label' }, [el('span', { text: 'Bot thinking time' }), botOut]),
          el('div', { class: 'opt-help', text: 'How long a bot pauses before each thing it does, so you can see it happen.' }),
          botSeg,
          el('div', { class: 'fine-tune' }, [el('span', { class: 'tiny dim', text: 'Fine tune' }), botRange]),
        ]),
      ]),
      toggle('animateDraws', 'Card animations', 'Tapping, drawing and combat animate. Off, the table simply changes.'),
    ]));

    /* -- stops -- */
    const stopsNow = () => JSON.parse(JSON.stringify(S.stops || MTG.DEFAULT_STOPS));
    const stopGrid = () => {
      const st = stopsNow();
      const grid = el('div', { class: 'stop-grid' });
      grid.append(
        el('span', { class: 'stop-corner' }),
        el('span', { class: 'stop-head', text: 'Your turn' }),
        el('span', { class: 'stop-head', text: 'Their turn' }));
      for (const [key, label] of MTG.STOP_STEPS) {
        grid.appendChild(el('span', { class: 'stop-label', text: label }));
        for (const side of ['yours', 'theirs']) {
          const on = !!(st[side] || {})[key];
          grid.appendChild(el('button', {
            type: 'button',
            class: 'stop-cell ' + side + (on ? ' on' : ''),
            'aria-pressed': on ? 'true' : 'false',
            'aria-label': `${label}, ${side === 'yours' ? 'your turn' : 'their turn'}`,
            onclick: () => {
              const next = stopsNow();
              next[side] = next[side] || {};
              if (next[side][key]) delete next[side][key]; else next[side][key] = true;
              MTG.setSetting('stops', next);
              pushAutoPass();
              renderOptions();
            },
          }, el('i')));
        }
      }
      return grid;
    };
    sections.push(group('stops', 'Stops', 'Priority passes back to the table on its own when there is nothing you would want to do with it. These decide where the game waits for you.', [
      toggle('stopWhenAble', 'Stop whenever I could act',
        'Off is the smart way: the game waits at your stops and whenever somebody else does something, and skips the moments where you merely could. On stops at every point where you could cast, activate or play anything.',
        pushAutoPass),
      toggle('autoPassEmptyPriority', 'Pass for me when I have nothing to do', 'You still stop whenever you could cast, activate or play something.', pushAutoPass),
      toggle('autoPassUntilStackChange', 'Stop when something new goes on the stack', 'Otherwise you only stop at the steps below.', pushAutoPass),
      toggle('alwaysFullControl', 'Never pass priority for me (full control)', 'Nothing is ever passed for you. At the table, Ctrl turns it on for one step and Ctrl+Shift locks it on.', pushAutoPass),
      toggle('orderMyTriggers', 'Let me order my own triggers', 'When several of your triggers go on the stack at once, choose the order instead of having it chosen for you.', pushAutoPass),
      el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'Always stop at' }),
        el('div', { class: 'opt-help', text: 'Tap a square to stop there — or click a step on the phase strip at the table. Space passes, Enter yields until somebody responds, Shift+Enter yields the turn, H holds priority.' }),
        stopGrid(),
        el('div', { class: 'row wrap', style: { marginTop: '12px' } }, [
          el('button', { class: 'btn sm', text: 'Reset to defaults', onclick: () => { MTG.setSetting('stops', null); pushAutoPass(); renderOptions(); } }),
          el('button', { class: 'btn sm', text: 'Stop everywhere', onclick: () => {
            const all = { yours: {}, theirs: {} };
            for (const [k] of MTG.STOP_STEPS) { all.yours[k] = true; all.theirs[k] = true; }
            MTG.setSetting('stops', all); pushAutoPass(); renderOptions();
          } }),
          el('button', { class: 'btn sm', text: 'Stop nowhere', onclick: () => { MTG.setSetting('stops', { yours: {}, theirs: {} }); pushAutoPass(); renderOptions(); } }),
        ]),
      ])),
    ]));

    /* -- display: how big everything is, and what the table shows -- */
    const scaleNow = el('div', { class: 'opt-help' });
    const paintScale = () => {
      const fit = MTG.screenFit(), z = MTG.uiZoom();
      scaleNow.textContent = `Right now: ${Math.round(z * 100)}%` +
        (fit > 1 ? ` \u2014 your size \u00d7 ${Math.round(fit * 100)}% to fit this screen.` : '.');
    };
    paintScale();
    const scaleRow = slider('uiScale', 'Interface size', 0.75, 1.6, 0.05, (v) => Math.round(v * 100) + '%',
      'Scales all text and controls, everywhere.');
    scaleRow.querySelector('input').addEventListener('input', paintScale);
    scaleRow.querySelector('.grow').appendChild(scaleNow);
    sections.push(group('display', 'Display', null, [
      scaleRow,
      toggle('fitScreen', 'Grow to fit a big screen',
        'On a large monitor everything grows with it. Turn off to keep the same size on any screen.', () => { paintScale(); }),
      el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [el('div', { class: 'opt-label', text: 'Quick sizes' })]),
        el('div', { class: 'row', style: { gap: '6px' } }, /** @type {Array<[number, string]>} */ ([[0.85, 'Smaller'], [1, 'Normal'], [1.15, 'Larger'], [1.3, 'Largest']]).map(([v, t]) =>
          el('button', { type: 'button', class: 'btn xs' + (Math.abs((S.uiScale || 1) - v) < 0.01 ? ' primary' : ''), text: t,
            onclick: () => { set('uiScale', v); renderOptions(); } }))),
      ]),
      slider('cardScale', 'Card size', 0.8, 1.6, 0.05, (v) => Math.round(v * 100) + '%',
        'Makes cards in lists, packs and the deck builder bigger or smaller.'),
      pick('theme', 'Theme', [['dark', 'Dark'], ['light', 'Light']], 'The menus and deck builder. The game table is always dark.', 'dark'),
      toggle('showOracleOnHover', 'Show a large card preview on hover', 'Hover any card to read it at full size.'),
      toggle('peekOpponents', 'Show the other opponents\u2019 boards at the sides',
        'With two or more opponents and room on the screen, the boards next to the one in view peek in from the edges.'),
    ]));

    /* -- accessibility -- */
    sections.push(group('access', 'Accessibility',
      'These change how the whole app looks and behaves. Nothing here affects the rules.', [
      toggle('highContrast', 'High contrast', 'Stronger borders, darker backgrounds and brighter text.'),
      toggle('colorblindPips', 'Colourblind-friendly mana symbols',
        'Adds a letter and a distinct shape to every mana symbol so colour is never the only cue.'),
      toggle('alwaysCardText', 'Always show card text in previews',
        'The hover preview shows the card written out as well as the picture.'),
      toggle('reduceMotion', 'Reduce motion', 'Turns off transitions and animations across the app.'),
      toggle('dyslexiaFont', 'Easier-to-read font', 'Switches to a wider, more distinct typeface with looser spacing.'),
      toggle('focusRings', 'Strong keyboard focus outlines', 'Makes the focused control obvious when tabbing.'),
      toggle('bigHitTargets', 'Larger click targets', 'Adds padding to buttons and rows.'),
    ]));

    /* -- sound: the rows are built by the table's sound (src/12f-ui-feel.js) -- */
    sections.push(group('sound', 'Sound', null, MTG.feel.soundRows()));

    /* -- online -- */
    sections.push(onlineGroup(group));

    /* -- data -- */
    const cacheInfo = el('div', { class: 'opt-help', text: 'Reading cache…' });
    MTG.scry.cacheStats().then(st => {
      cacheInfo.textContent = `${st.cards} cards cached · ${st.hits} cache hits · ${st.requests} Scryfall requests this session` +
        (MTG.scry.stats.local ? ` · ${MTG.scry.stats.local} answered by the card database.` : '.');
    }).catch(() => { cacheInfo.textContent = 'Cache unavailable.'; });
    const scriptCount = el('div', { class: 'opt-help', id: 'scriptCount' });
    const mine = Object.keys(MTG.settings.cardScripts || {}).length;
    scriptCount.textContent = `${MTG.scripts.count()} cards are written out by hand in the engine` +
      (mine ? `, and ${mine} more by you.` : '.');
    sections.push(group('data', 'Card data', null, [
      cardDbRow(),
      el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'Cache' }), cacheInfo,
        el('div', { class: 'row wrap', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn sm', text: 'Clear saved art choices', onclick: () => {
            MTG.settings.artPreferences = {}; MTG.saveSettings(); UI.ok('Art preferences cleared.');
          } }),
          el('button', { class: 'btn sm danger', text: 'Clear card cache', onclick: async () => {
            if (!await UI.confirm('Clear every cached card? They will be fetched again as needed.')) return;
            await MTG.scry.clearCache(); UI.ok('Cache cleared.');
          } }),
        ]),
      ])),
      el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'Card automation' }),
        el('div', { class: 'opt-help', text: 'Most cards run themselves. Anything the engine could not read is handed to you with the table tools instead — and if you would rather it ran itself, you can write it out.' }),
        scriptCount,
        el('div', { class: 'row wrap', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn sm', text: 'My card scripts', onclick: () => openScriptEditor() }),
        ]),
      ])),
      el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'Start again' }),
        el('div', { class: 'opt-help', text: 'Every option back to its default. Your decks, name and art choices are kept.' }),
        el('div', { class: 'row wrap', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn sm danger', text: 'Reset all settings', onclick: async () => {
            if (!await UI.confirm('Put every option back to its default?')) return;
            MTG.resetSettings(); MTG.applyDisplaySettings(); pushAutoPass(); renderOptions(); UI.ok('Settings reset.');
          } }),
        ]),
      ])),
    ]));

    /* the categories down the side: one shown at a time */
    let current = OPT_SECTIONS.some(([id]) => id === S.optionsTab) ? S.optionsTab : OPT_SECTIONS[0][0];
    const show = (id) => {
      current = id;
      for (const sec of sections) sec.hidden = sec.id !== 'opt-sec-' + id;
      for (const a of toc.children) {
        a.classList.toggle('on', a.dataset.sec === id);
        a.setAttribute('aria-selected', a.dataset.sec === id ? 'true' : 'false');
      }
    };
    const toc = el('nav', { class: 'opt-toc', role: 'tablist', 'aria-label': 'Option categories' }, OPT_SECTIONS.map(([id, label]) =>
      el('button', { type: 'button', role: 'tab', class: 'opt-toc-link', dataset: { sec: id }, text: label,
        'aria-controls': 'opt-sec-' + id, onclick: () => {
          if (id === current) return;
          show(id);
          MTG.setSetting('optionsTab', id);
          const w = s.querySelector('.menu-wrap');
          if (w) w.scrollTop = 0;
        } })));
    inner.appendChild(el('div', { class: 'opt-layout' }, [toc, el('div', { class: 'opt-sections' }, sections)]));
    show(current);
    const wrap = el('div', { class: 'menu-wrap' }, inner);
    s.appendChild(wrap);
    if (keepTop) wrap.scrollTop = keepTop;
  }

  /**
   * Write a card out by hand. The format is the same one the engine's own
   * scripts use, so anything in that file is a worked example; what you save
   * here takes precedence over both the parser and the built-in scripts.
   */
  function openScriptEditor() {
    const mine = Object.assign({}, MTG.settings.cardScripts || {});
    const list = el('div', { class: 'script-list' });
    const nameIn = el('input', { class: 'input', placeholder: 'Card name, exactly as printed' });
    const bodyIn = el('textarea', { class: 'input mono', rows: 12, spellcheck: 'false',
      placeholder: '{\n  "abilities": [\n    { "kind": "triggered", "event": "etb", "self": true, "auto": true,\n      "text": "When this creature enters, you gain 4 life.",\n      "effects": [{ "op": "gainLife", "n": 4, "who": "you" }] }\n  ]\n}' });

    const paint = () => {
      list.innerHTML = '';
      const keys = Object.keys(mine);
      if (!keys.length) { list.appendChild(el('div', { class: 'empty-note', text: 'Nothing scripted yet.' })); return; }
      for (const k of keys) {
        list.appendChild(el('div', { class: 'script-row' }, [
          el('button', { class: 'cmd-link', text: k, onclick: () => {
            nameIn.value = k;
            bodyIn.value = JSON.stringify(mine[k], null, 2);
          } }),
          el('span', { class: 'grow' }),
          el('button', { class: 'btn xs danger', text: 'Remove', onclick: () => { delete mine[k]; paint(); } }),
        ]));
      }
    };
    paint();

    UI.modal({
      title: 'My card scripts', width: '720px',
      content: el('div', { class: 'col', style: { gap: '10px' } }, [
        el('p', { class: 'small dim', text: 'A script replaces what the parser made of a card. Effects use the same words the engine uses; an invalid one is rejected rather than saved.' }),
        list,
        el('label', { class: 'field' }, [el('span', { class: 'lbl', text: 'Card' }), nameIn]),
        el('label', { class: 'field' }, [el('span', { class: 'lbl', text: 'Script' }), bodyIn]),
      ]),
      buttons: [
        { label: 'Add or replace', onClick: () => {
          const name = nameIn.value.trim();
          if (!name) return UI.error('Name the card first.');
          let parsed;
          try { parsed = JSON.parse(bodyIn.value); }
          catch (e) { return UI.error('That is not valid JSON: ' + e.message); }
          if (!parsed || (!parsed.abilities && !parsed.add)) return UI.error('A script needs "abilities" or "add".');
          mine[MTG.scripts.keyFor(name)] = parsed;
          nameIn.value = ''; bodyIn.value = '';
          paint();
          return false;
        } },
        { label: 'Save', class: 'primary', onClick: () => {
          MTG.setSetting('cardScripts', mine);
          MTG.oracle.clearCache();
          UI.clearAutoCache();
          UI.ok('Card scripts saved.');
          renderOptions();
        } },
      ],
    });
  }

  function startLobby(role) {
    App.session = new Session(App.formatId);
    App.session.addLocalHost(App.myName);
    showScreen('lobby');
    renderLobby();
  }

  /**
   * Straight into a game: a bot across the table, and a deck for you if you
   * have not brought one. The quickest way from opening the page to playing
   * Magic, and the way most people will first try the table.
   */
  App.quickGame = async function (opts) {
    opts = opts || {};
    App.formatId = opts.formatId || 'standard';
    const sess = App.session = new Session(App.formatId);
    sess.addLocalHost(App.myName);
    const me = sess.seat('me');
    if (sess.fmt.kind === 'limited') return quickDraft(sess, opts);
    const busy = UI.busy('Quick game', 'Shuffling up a deck for you…');
    try {
      const deck = opts.deck || await MTG.bots.buildBotDeck({
        formatId: App.formatId, difficulty: opts.myDeckLevel || 6, rules: sess.rules,
        rng: new MTG.RNG(Date.now()), name: 'Your deck', colors: opts.colors || null,
      });
      me.deck = deck;
      me.deckValid = MTG.formats.validate(deck, sess.fmt);
      // a table of up to eight: one bot by default, more on request
      const count = U.clamp(opts.opponents || 1, 1, Math.min(7, (sess.fmt.maxPlayers || 8) - 1));
      const bots = [];
      for (let i = 0; i < count; i++) bots.push(sess.addBot(opts.difficulty || 5));
      busy.text(count > 1 ? `Your ${count} opponents are building decks…` : 'Your opponent is building a deck…');
      for (let i = 0; bots.some(b => b.building) && i < 1800; i++) await U.sleep(100);
      busy.close();
      await sess.start();
    } catch (e) {
      busy.close();
      UI.error(e.message || String(e));
      startLobby();
    }
  };

  /**
   * A quick draft: the seats filled with bots, something to draft from
   * chosen for you (the newest set, or a cube built from one of the shipped
   * recipes), and straight to the first pack. Everyone builds from what
   * they took, the bots included, the same as a draft set up by hand.
   */
  async function quickDraft(sess, opts) {
    const busy = UI.busy('Quick draft', 'Setting up the draft\u2026');
    try {
      const style = sess.fmt.draft.style;
      if (style === 'booster' || style === 'commander') {
        let code = opts.setCode || '';
        if (!code) { const sets = await MTG.scry.draftableSets(); code = sets.length ? sets[0].code : ''; }
        if (!code) throw new Error('No set could be found to draft. Check the connection, or download the card database in Options.');
        sess.setCode = code;
      } else if (style === 'chaos') {
        sess.chaosPool = opts.chaosPool && opts.chaosPool.sets && opts.chaosPool.sets.length >= 2 ? opts.chaosPool : null;
      } else if (style === 'cube') {
        const recipe = MTG.draft.recipes.find(r => r.id === opts.cubeId) || MTG.draft.recipes.find(r => r.id === 'modern') || MTG.draft.recipes[0];
        // a cube built before is reused rather than gathered again
        const had = MTG.draft.cubes.list().find(c => c.recipe === recipe.id);
        let cube = had ? await MTG.draft.cubes.load(had.id) : null;
        if (!cube || (cube.cards || []).length < 30) {
          const cards = await MTG.draft.buildRecipe(recipe, {
            onProgress: (a, b, label) => busy.set(a / b, `${recipe.name}: ${label} \u2014 ${a}/${b} cards`),
          });
          if (cards.length < 30) throw new Error('Could not gather enough cards to build that cube.');
          const saved = MTG.draft.cubes.save({ id: had ? had.id : MTG.uid('cube'), name: recipe.name, recipe: recipe.id,
            cards, packSize: recipe.packSize, packs: 3 });
          cube = Object.assign({}, saved, { cards });
        }
        sess.cube = cube;
        sess.packSize = cube.packSize || 15;
      }
      if (opts.collector && style !== 'cube') sess.setRule('collector', true);
      const count = U.clamp(opts.opponents || 1, 1, Math.min(7, (sess.fmt.maxPlayers || 8) - 1));
      for (let i = 0; i < count; i++) sess.addBot(opts.difficulty || 5);
      const ready = sess.readyToStart();
      if (!ready.ok) throw new Error(ready.reason);
      busy.close();
      await sess.start();
    } catch (e) {
      busy.close();
      UI.error(e.message || String(e));
      startLobby();
    }
  }

  /**
   * A guided first game: a starter deck the game runs in full, one gentle
   * bot, and coach marks over the real table (src/12e-ui-coach.js).
   */
  App.startTutorial = async function () {
    let deck = null;
    const busy = UI.busy('A first game', 'Shuffling up your deck…');
    try { deck = await MTG.starters.build('w-cats'); }
    catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    // the walkthrough talks to whoever is reading it, so the hints come on with it
    if (MTG.settings.beginnerHints === false) MTG.setSetting('beginnerHints', true);
    await App.quickGame({ formatId: 'standard', difficulty: 1, opponents: 1, deck });
    if (App.table && App.screen === 'table' && !App.table.coach) new UI.Coach(App.table);
  };

  async function joinRoom(code) {
    if (!code || !code.trim()) return UI.error('Enter a room code.');
    const busy = UI.busy('Joining', 'Connecting to the host…');
    try {
      await net.join(code.trim(), {
        name: App.myName, token: MTG.clientToken(), autoPass: MTG.autoPassConfig(),
      });
      busy.close();
      App.session = null;             // clients have no engine
      showScreen('lobby');
      renderClientLobby();
      setNetBadge();
    } catch (e) {
      busy.close();
      UI.error(e.message || String(e));
    }
  }

  function renderLobby() {
    const s = screens.lobby;
    const sess = App.session;
    if (!sess) return;
    /* Nudging a house rule rebuilds this whole screen. Losing your place
       every time you change a number makes the panel unusable, so the
       scroll position and the control you were in are put back. */
    const scroller = s.querySelector('.menu-wrap');
    const keepTop = scroller ? scroller.scrollTop : 0;
    const active = document.activeElement;
    const keepId = active && s.contains(active) ? active.id : null;
    const keepSel = keepId && active.setSelectionRange &&
      /text|search|number/.test(active.type || '') ? [active.selectionStart, active.selectionEnd] : null;

    const fmt = MTG.formats.effective(sess.formatId, sess.rules);
    // a redraw is not an arrival, so it does not play the entrance again
    const inner = el('div', { class: 'menu-inner lobby' + (scroller ? ' again' : '') });

    /* -- the banner: the format, in its art -- */
    const banner = el('header', { class: 'lobby-banner' }, [
      el('div', { class: 'lobby-banner-art', 'aria-hidden': 'true' }),
      el('button', { class: 'btn sm ghost back-btn', 'aria-label': 'Back', title: 'Back', html: SVG.back, onclick: () => confirmLeave() }),
      el('div', { class: 'lobby-banner-text' }, [
        el('div', { class: 'eyebrow', text: fmt.kind === 'limited' ? 'Limited · table setup' : 'Constructed · table setup' }),
        el('h1', { class: 'lobby-title', text: fmt.name }),
        el('div', { class: 'lobby-facts' }, [
          el('span', { text: `${fmt.minPlayers}–${fmt.maxPlayers} players` }),
          el('span', { text: `${fmt.startingLife} life` }),
          el('span', { text: fmt.exactSize ? `${fmt.deckMin} cards` : `${fmt.deckMin || 60}+ cards` }),
          fmt.commanderDamage ? el('span', { text: `${fmt.commanderDamage} commander damage` }) : null,
        ].filter(Boolean)),
      ]),
    ]);
    decorArt(banner.firstChild, FORMAT_ART[sess.formatId] || HERO_ART[0]);
    inner.appendChild(banner);

    /* -- the seats, and what it takes to start -- */
    const main = el('div', { class: 'lobby-main' });
    const side = el('aside', { class: 'lobby-side' });

    const seats = el('section', { class: 'panel seats-panel', 'aria-labelledby': 'seatsTitle' });
    seats.appendChild(el('div', { class: 'panel-head' }, [
      el('h2', { id: 'seatsTitle', class: 'panel-title', text: 'Seats' }),
      el('span', { class: 'seat-count', text: `${sess.roster.length} of ${fmt.maxPlayers}` }),
      el('span', { class: 'grow' }),
      sess.spectating ? el('button', {
        class: 'btn sm', text: 'Take a seat',
        onclick: () => { sess.takeSeat(); renderLobby(); },
      }) : null,
    ].filter(Boolean)));
    if (sess.spectating) {
      seats.appendChild(el('p', { class: 'small muted', style: { margin: '0 0 12px' },
        text: 'You are not playing this one — start it and watch the bots play it out.' }));
    }
    const grid = el('div', { class: 'seat-grid' + (fmt.kind === 'limited' ? ' limited' : '') });
    for (const r of sess.roster) grid.appendChild(seatCard(r, sess, fmt));
    if (sess.roster.length < fmt.maxPlayers) grid.appendChild(addBotCard(sess, fmt));
    seats.appendChild(grid);
    main.appendChild(seats);

    /* -- start: the biggest button on the screen -- */
    const ready = sess.readyToStart();
    side.appendChild(el('section', { class: 'panel start-panel' + (ready.ok ? ' ready' : '') }, [
      el('div', { class: 'start-state' }, [
        el('span', { class: 'start-dot', 'aria-hidden': 'true' }),
        el('span', { text: ready.ok ? (fmt.kind === 'limited' ? 'Everything is set — open the packs.' : 'Everything is set.') : ready.reason }),
      ]),
      el('button', {
        class: 'btn primary hero-btn', disabled: !ready.ok,
        html: `${SVG.play}<span>${fmt.kind === 'limited' ? 'Start the draft' : 'Start the game'}</span>`,
        onclick: async () => {
          // your own deck's cards that need a hand are said once, before the game
          const me = sess.seat('me');
          if (me && me.deck && fmt.kind !== 'limited') {
            const ok = await UI.checkAutomation(me.deck, {
              onEdit: (d) => UI.deckBuilder(d, { onSave: (saved) => {
                me.deck = saved; me.deckValid = MTG.formats.validate(saved, sess.fmt); renderLobby();
              } }),
            });
            if (!ok || App.session !== sess) return;
          }
          sess.start();
        },
      }),
    ]));

    /* -- other people -- */
    const online = el('section', { class: 'panel online-panel' });
    online.appendChild(el('h3', null, [el('span', { class: 'h-ico', html: SVG.users }), el('span', { text: 'Play with other people' })]));
    if (net.isHost) {
      online.append(
        el('button', { class: 'code-display', text: net.roomCode, title: 'Copy the room code', 'aria-label': `Room code ${net.roomCode}. Copy it.`,
          onclick: () => { navigator.clipboard && navigator.clipboard.writeText(net.roomCode); UI.ok('Room code copied.'); } }),
        el('p', { class: 'small muted', text: 'Share this code. Anyone who enters it joins this table directly — no server holds the game.' }),
        el('button', { class: 'btn sm', text: 'Stop hosting', onclick: () => { net.destroy(); setNetBadge(); renderLobby(); } }),
      );
    } else {
      online.append(
        el('p', { class: 'small muted', text: 'Open a room and share its code, or just fill the seats with bots.' }),
        el('button', {
          class: 'btn', html: `${SVG.link}<span>Open a room</span>`, disabled: !net.peerAvailable(),
          onclick: async () => {
            const busy = UI.busy('Opening a room');
            try { await net.host(); busy.close(); setNetBadge(); renderLobby(); UI.ok('Room ' + net.roomCode + ' is open.'); }
            catch (e) { busy.close(); UI.error(e.message); }
          },
        }),
      );
    }
    side.appendChild(online);

    /* -- what is being drafted, and the format in a sentence -- */
    side.appendChild(formatSetupPanel(sess, fmt));

    main.appendChild(houseRulesPanel(sess));
    inner.appendChild(el('div', { class: 'lobby-grid' }, [main, side]));

    s.innerHTML = '';
    sceneBackdrop(s);
    const wrap = el('div', { class: 'menu-wrap' }, inner);
    s.appendChild(wrap);
    if (keepTop) wrap.scrollTop = keepTop;
    if (keepId) {
      const again = s.querySelector('#' + CSS.escape(keepId));
      if (again && again.focus) {
        again.focus({ preventScroll: true });
        if (keepSel && again.setSelectionRange) {
          try { again.setSelectionRange(keepSel[0], keepSel[1]); } catch (e) {}
        }
      }
    }
  }

  /** A commander named in the lobby is a card, so you can look at it. */
  function commanderLink(card) {
    const link = el('button', {
      type: 'button', class: 'cmd-link', text: card.name,
      title: 'Hover to see the card',
      onclick: () => UI.cardSheet(card),
    });
    UI.attachPreview(link, card, 0);
    return link;
  }

  /**
   * A seat at the table, drawn as a card: the deck's art behind a portrait,
   * the name, who or what is sitting there, the deck it brought and whether
   * that deck can play. Bots show how hard they are by name.
   */
  function seatCard(r, sess, fmt) {
    const limited = fmt.kind === 'limited';
    const key = r.deck ? UI.keyCard(r.deck) : null;
    const status = [];
    const tools = [];
    let deckLine = null;
    const commander = r.deck && (r.deck.commanders || [])[0];

    if (r.kind === 'bot') {
      const label = MTG.bots.DIFFICULTY[r.difficulty].label;
      if (!limited) {
        if (r.building) status.push(el('span', { class: 'seat-status building' }, [el('span', { class: 'spinner' }), ' building a deck…']));
        else if (r.buildFailed) status.push(el('span', { class: 'pill bad', title: r.buildFailed, text: 'deck failed' }));
        else if (r.deck) {
          deckLine = commander ? commanderLink(commander) : el('span', { class: 'seat-deck-name', text: r.deck.name });
          if (r.deckValid && !r.deckValid.ok) {
            status.push(el('span', {
              class: 'pill warn', text: 'rough deck',
              title: 'The best this bot could build from what is available:\n' + r.deckValid.errors.slice(0, 4).join('\n'),
            }));
          }
        }
      }
      const sel = el('select', { class: 'seat-diff', title: 'Bot difficulty', 'aria-label': `Difficulty for ${r.name}` },
        Object.keys(MTG.bots.DIFFICULTY).map(d => el('option', {
          value: d, selected: +d === r.difficulty, text: `${d} · ${MTG.bots.DIFFICULTY[d].label}`,
        })));
      sel.addEventListener('change', () => {
        r.difficulty = parseInt(sel.value, 10);
        sess.buildBotDeck(r);
        renderLobby();
      });
      tools.push(sel);
      const persSel = el('select', { class: 'seat-diff seat-pers', title: 'How this bot likes to play', 'aria-label': `Style for ${r.name}` },
        personalityOptions().map(([k, label]) => el('option', { value: k, selected: k === (r.personality || ''), text: label })));
      persSel.addEventListener('change', () => {
        r.personality = persSel.value;
        // a style shapes the deck a bot builds as well as how it plays it
        sess.buildBotDeck(r);
        sess.broadcastLobby();
        renderLobby();
      });
      tools.push(persSel);
      const style = seatPersonality(r);
      tools.push(el('button', { class: 'btn xs ghost danger-ghost', text: 'Remove', 'aria-label': `Remove ${r.name}`,
        onclick: () => { sess.removeSeat(r.id); renderLobby(); } }));
      return seatShell(r, key, {
        role: style ? `Bot · ${label} · ${style.label}` : `Bot · ${label}`, roleTitle: style ? style.blurb : '',
        level: r.difficulty, deckLine, status, tools,
      });
    }

    if (!limited) {
      deckLine = commander ? commanderLink(commander)
        : el('span', { class: 'seat-deck-name' + (r.deck ? '' : ' none'), text: r.deck ? r.deck.name : 'No deck chosen yet' });
      if (r.deck && r.deckValid && !r.deckValid.ok)
        status.push(el('span', { class: 'pill bad', text: `${r.deckValid.errors.length} legality problem${r.deckValid.errors.length === 1 ? '' : 's'}`, title: r.deckValid.errors.join('\n') }));
      else if (r.deck) status.push(el('span', { class: 'pill good', text: 'legal' }));
    }
    if (r.kind === 'local' && !limited) {
      tools.push(el('button', { class: 'btn xs' + (r.deck ? '' : ' primary'), text: r.deck ? 'Change deck' : 'Choose a deck', onclick: () => {
        UI.pickDeck(sess.formatId, (d) => { r.deck = d; r.deckValid = MTG.formats.validate(d, sess.fmt); renderLobby(); });
      } }));
      tools.push(el('button', {
        class: 'btn xs ghost', text: 'Sit out',
        title: 'Give up your seat and watch the bots play it out',
        onclick: () => { sess.sitOut(); renderLobby(); },
      }));
    }
    if (r.kind === 'remote') status.push(rttPill(r.peerId));
    return seatShell(r, key, {
      role: r.kind === 'remote' ? 'Over the network' : 'You · this device',
      deckLine, status, tools, mine: r.kind === 'local',
    });
  }

  function seatShell(r, key, o) {
    const art = el('div', { class: 'seat-art', 'aria-hidden': 'true' });
    if (key) UI.setArt(art, key);
    return el('article', {
      class: 'seat-card ' + r.kind + (o.mine ? ' mine' : '') + (r.building ? ' building' : ''),
      'aria-label': `${r.name}, ${o.role}`,
    }, [
      art,
      el('div', { class: 'seat-top' }, [
        UI.portrait(r.name, key, { size: 'md' }),
        el('div', { class: 'seat-who' }, [
          el('div', { class: 'seat-name', text: r.name + (r.kind === 'local' ? ' (you)' : '') }),
          el('div', { class: 'seat-role' }, [
            o.level ? el('span', { class: 'seat-level', text: String(o.level) }) : null,
            el('span', { text: o.role, title: o.roleTitle || '' }),
          ].filter(Boolean)),
        ]),
      ]),
      el('div', { class: 'seat-deck' }, [o.deckLine, ...o.status].filter(Boolean)),
      o.tools.length ? el('div', { class: 'seat-tools' }, o.tools) : null,
    ].filter(Boolean));
  }

  /** The empty chair: a bot sits down in it at the chosen difficulty. */
  function addBotCard(sess, fmt) {
    const want = MTG.settings.lobbyBotLevel || 5;
    const diffSel = el('select', { 'aria-label': 'Difficulty for the new bot' },
      Object.keys(MTG.bots.DIFFICULTY).map(d => el('option', { value: d, text: `${d} · ${MTG.bots.DIFFICULTY[d].label}`, selected: +d === want })));
    diffSel.addEventListener('change', () => MTG.setSetting('lobbyBotLevel', parseInt(diffSel.value, 10)));
    const wantStyle = MTG.settings.lobbyBotStyle || '';
    const persSel = el('select', { 'aria-label': 'Style for the new bot' },
      personalityOptions().map(([k, label]) => el('option', { value: k, text: label, selected: k === wantStyle })));
    persSel.addEventListener('change', () => MTG.setSetting('lobbyBotStyle', persSel.value));
    const add = () => { sess.addBot(parseInt(diffSel.value, 10), persSel.value); renderLobby(); };
    return el('div', { class: 'seat-card add-seat' }, [
      el('button', { class: 'add-seat-btn', onclick: add }, [
        el('span', { class: 'add-seat-plus', html: SVG.plus, 'aria-hidden': 'true' }),
        el('span', { class: 'add-seat-label', text: 'Add a bot' }),
        el('span', { class: 'tiny dim', text: fmt.kind === 'limited' ? 'It drafts alongside you.' : 'It builds its own deck for this format.' }),
      ]),
      el('label', { class: 'add-seat-diff' }, [el('span', { class: 'tiny dim', text: 'Difficulty' }), diffSel]),
      el('label', { class: 'add-seat-diff' }, [el('span', { class: 'tiny dim', text: 'Style' }), persSel]),
    ]);
  }

  function formatSetupPanel(sess, fmt) {
    const p = el('section', { class: 'panel setup-panel' });
    p.appendChild(el('h3', { text: fmt.kind === 'limited' ? 'What you are drafting' : 'The format' }));
    if (fmt.kind === 'limited') {
      const rows = [];
      if (fmt.draft.style === 'cube') {
        rows.push(el('div', { class: 'setup-choice' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'tiny dim', text: 'Cube' }),
            el('div', { class: 'setup-value', text: sess.cube ? `${sess.cube.name} · ${sess.cube.cards.length} cards` : 'None chosen yet' }),
          ]),
          el('button', { class: 'btn sm' + (sess.cube ? '' : ' primary'), text: sess.cube ? 'Change' : 'Choose a cube', onclick: () => UI.cubeManager((c) => { sess.cube = c; sess.packSize = c.packSize || 15; renderLobby(); }) }),
        ]));
      } else if (fmt.draft.style === 'chaos') {
        rows.push(chaosPoolRow(sess));
      } else {
        const setSel = el('select', { id: 'lobby-set', 'aria-label': 'Set to draft' });
        setSel.appendChild(el('option', { value: '', text: 'Loading sets…' }));
        MTG.scry.draftableSets().then(sets => {
          setSel.innerHTML = '';
          for (const st of sets.slice(0, 220))
            setSel.appendChild(el('option', { value: st.code, text: `${st.name} (${st.code.toUpperCase()}) · ${st.released_at}`, selected: st.code === sess.setCode }));
          if (!sess.setCode && sets.length) { sess.setCode = sets[0].code; setSel.value = sess.setCode; renderLobbySoon(); }
        }).catch(() => { setSel.innerHTML = ''; setSel.appendChild(el('option', { value: '', text: 'Could not load the set list' })); });
        setSel.addEventListener('change', () => { sess.setCode = setSel.value; });
        rows.push(el('label', { class: 'field' }, [el('span', { text: 'Set to draft' }), setSel]));
      }
      p.append(...rows);
    } else {
      p.append(el('p', { class: 'small muted', style: { margin: 0 }, text: fmt.blurb }));
    }
    return p;
  }

  /* ---------------- chaos draft pool ---------------- */

  /** What the lobby shows for a chaos draft: which sets the packs come from. */
  function chaosPoolRow(sess) {
    const sel = chaosSetsSelect(sess.chaosPool, (pool) => {
      sess.chaosPool = pool;
      sess.broadcastLobby();
      renderLobby();
    });
    return el('div', null, [
      el('label', { class: 'field' }, [el('span', { text: 'Sets' }), sel]),
      el('p', { class: 'small muted', style: { margin: '8px 0 0' },
        text: 'Every pack in the draft is rolled from these sets, so a wider pool means a stranger draft.' }),
    ]);
  }

  /**
   * The Sets dropdown for a chaos draft: every set (the default), the pools
   * people ask for by name, or a hand-picked pile of sets. `onPick` gets
   * null for every set, or { name, preset, sets: [code] }.
   */
  function chaosSetsSelect(current, onPick) {
    const n = current && current.sets ? current.sets.length : 0;
    const custom = n && !current.preset;
    const sel = el('select', { 'aria-label': 'Sets to draft from' }, [
      el('option', { value: '', text: 'All sets', selected: !n }),
      custom ? el('option', { value: 'custom', text: `${current.name || 'Your pick'} \u00b7 ${n} sets`, selected: true }) : null,
      el('option', { value: 'pick', text: 'Choose sets\u2026' }),
    ].filter(Boolean));
    const pickAt = sel.querySelector('option[value="pick"]');
    let pools = [];
    MTG.scry.setPools().then((list) => {
      pools = list.filter(p => p.id !== 'all' && p.id !== 'vintage');   // both are "all sets"
      for (const pl of pools) {
        sel.insertBefore(el('option', { value: 'preset:' + pl.id, text: `${pl.name} \u00b7 ${pl.sets.length} sets`,
          selected: !!(current && current.preset === pl.id) }), pickAt);
      }
    }).catch(() => {});
    let was = sel.value;
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v === 'custom') { was = v; return; }
      if (v === 'pick') {
        sel.value = was;    // stays as it was unless a pool is chosen
        chaosPoolPicker(current, (pool) => onPick(pool));
        return;
      }
      was = v;
      if (!v) { onPick(null); return; }
      const pl = pools.find(x => 'preset:' + x.id === v);
      if (pl) onPick({ name: pl.name, preset: pl.id, sets: pl.sets.map(st => st.code) });
    });
    return sel;
  }

  /**
   * Pick the sets a chaos draft draws from. The presets are the pools people
   * ask for by name; underneath is the whole list, because the point of a
   * chaos draft is often one particular pile of sets.
   */
  async function chaosPoolPicker(current, onUse) {
    const chosen = new Set((current && current.sets) || []);
    let presetName = (current && current.name) || null;
    let presetId = (current && current.preset) || null;

    const presetRow = el('div', { class: 'pool-presets' });
    const list = el('div', { class: 'pool-list' }, el('div', { class: 'empty-note', text: 'Loading the set list…' }));
    const count = el('span', { class: 'pill', text: '0 sets' });
    const search = el('input', { type: 'search', placeholder: 'Search sets by name or code…' });
    const typeSel = el('select', { style: { width: 'auto' } }, [
      el('option', { value: '', text: 'All kinds' }),
      el('option', { value: 'expansion', text: 'Expansions' }),
      el('option', { value: 'core', text: 'Core sets' }),
      el('option', { value: 'masters', text: 'Masters' }),
      el('option', { value: 'draft_innovation', text: 'Draft innovations' }),
    ]);

    const m = UI.modal({
      title: 'Sets for a chaos draft',
      width: '820px',
      content: el('div', { class: 'pool-picker' }, [
        el('p', { class: 'small muted', style: { marginTop: 0 },
          text: 'Start from a preset, then add or drop individual sets. An empty pool means every set is fair game.' }),
        presetRow,
        el('div', { class: 'row wrap pool-tools' }, [
          el('span', { class: 'grow' }, search), typeSel, count,
          el('button', { class: 'btn xs ghost', text: 'Clear', onclick: () => { chosen.clear(); presetName = null; presetId = null; draw(); } }),
        ]),
        list,
      ]),
      buttons: [
        { label: 'Cancel', onClick: () => m.close() },
        {
          label: 'Use these sets', class: 'primary', onClick: () => {
            m.close();
            onUse(chosen.size ? { name: presetName, preset: presetId, sets: [...chosen] } : null);
            UI.ok(chosen.size ? `${chosen.size} sets in the pool.` : 'Every set is in the pool.');
          },
        },
      ],
    });

    let pools = [], all = [];
    try {
      pools = await MTG.scry.setPools();
      all = (pools.find(p => p.id === 'all') || { sets: [] }).sets;
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'empty-note', text: 'Could not load the set list: ' + (e.message || e) }));
      return;
    }

    function applyPreset(p) {
      chosen.clear();
      for (const st of p.sets) chosen.add(st.code);
      presetName = p.name;
      presetId = p.id === 'all' || p.id === 'vintage' ? null : p.id;
      draw();
    }

    function draw() {
      count.textContent = chosen.size ? `${chosen.size} sets` : 'every set';
      presetRow.innerHTML = '';
      for (const p of pools) {
        const exact = p.sets.length === chosen.size && p.sets.every(st => chosen.has(st.code));
        presetRow.appendChild(el('button', {
          class: 'pool-preset' + (exact ? ' on' : ''),
          onclick: () => applyPreset(p),
        }, [
          el('strong', { text: p.name }),
          el('span', { class: 'tiny dim', text: `${p.sets.length} sets` }),
          el('span', { class: 'tiny dim', text: p.blurb }),
        ]));
      }

      const q = search.value.trim().toLowerCase();
      const kind = typeSel.value;
      const rows = all.filter(st =>
        (!kind || st.set_type === kind) &&
        (!q || st.name.toLowerCase().includes(q) || st.code.toLowerCase().includes(q)));
      list.innerHTML = '';
      if (!rows.length) { list.appendChild(el('div', { class: 'empty-note', text: 'No set matches that.' })); return; }
      for (const st of rows.slice(0, 400)) {
        const on = chosen.has(st.code);
        const row = el('button', { class: 'pool-row' + (on ? ' on' : ''), onclick: () => {
          if (chosen.has(st.code)) chosen.delete(st.code); else chosen.add(st.code);
          presetName = null; presetId = null;
          draw();
        } }, [
          el('span', { class: 'pool-tick', text: on ? '✓' : '' }),
          el('span', { class: 'pool-code', text: st.code.toUpperCase() }),
          el('span', { class: 'pool-name grow', text: st.name }),
          el('span', { class: 'tiny dim', text: (st.released_at || '').slice(0, 4) }),
        ]);
        list.appendChild(row);
      }
      if (rows.length > 400) list.appendChild(el('div', { class: 'tiny dim center', text: `…and ${rows.length - 400} more. Narrow the search.` }));
    }

    search.addEventListener('input', draw);
    typeSel.addEventListener('change', draw);
    draw();
  }

  /* ---------------- house rules ---------------- */

  /**
   * Everything about the format the host is allowed to bend, in one place.
   * Each control writes straight through to the session, which revalidates
   * the decks on the table and tells the other players what changed.
   */
  /* The rules come in three kinds, and only the first is something most
     tables change: the rest are folded away until they are wanted. */
  /** @type {Array<[string, string, string[]]>} id, title, the rule keys it gathers */
  const RULE_GROUPS = [
    ['game', 'The game', ['startingLife', 'startingHand', 'freeMulligans', 'firstPlayerDraws', 'bestOf', 'commanderDamage']],
    ['decks', 'Deck building', ['deckMin', 'exactSize', 'maxCopies', 'singleton', 'sideboardMax', 'colorIdentity']],
    ['draft', 'The draft', ['packs', 'packSize', 'basicsFree']],
  ];
  // which folds are open survives the lobby redrawing itself on every change
  const openRules = new Set(['game']);
  let rulesOpen = false;

  function houseRulesPanel(sess) {
    const fields = MTG.formats.houseFields(sess.formatId);
    const changed = MTG.formats.houseSummary(sess.formatId, sess.rules);
    const panel = el('details', { class: 'panel rules-panel' });
    panel.open = rulesOpen || changed.length > 0;
    panel.addEventListener('toggle', () => { rulesOpen = panel.open; });

    panel.appendChild(el('summary', { class: 'rules-summary' }, [
      el('span', { class: 'rules-title', text: 'House rules' }),
      changed.length
        ? el('span', { class: 'pill warn', text: `${changed.length} changed` })
        : el('span', { class: 'pill', text: 'by the book' }),
      el('span', { class: 'grow rules-gist', text: changed.length ? changed.join(' · ') : 'Bend the format to suit the table.' }),
      el('span', { class: 'rules-chev', 'aria-hidden': 'true' }),
    ]));
    panel.appendChild(el('p', { class: 'small muted rules-blurb',
      text: sess.fmt.kind === 'limited'
        ? 'The numbers this table plays by. Everyone who joins sees them.'
        : 'Everyone who joins sees these, and decks are checked against them.' }));

    const byKey = new Map(fields.map(f => [f.key, f]));
    const placed = new Set();
    for (const [gid, title, keys] of RULE_GROUPS) {
      const list = keys.map(k => byKey.get(k)).filter(Boolean);
      if (!list.length) continue;
      list.forEach(f => placed.add(f.key));
      const nChanged = list.filter(f => sess.rules[f.key] !== f.value).length;
      const fold = el('details', { class: 'rule-group' });
      fold.open = openRules.has(gid) || nChanged > 0;
      fold.addEventListener('toggle', () => { if (fold.open) openRules.add(gid); else openRules.delete(gid); });
      fold.appendChild(el('summary', null, [
        el('span', { text: title }),
        nChanged ? el('span', { class: 'rule-dot', title: `${nChanged} changed` }) : null,
        el('span', { class: 'rules-chev', 'aria-hidden': 'true' }),
      ].filter(Boolean)));
      const grid = el('div', { class: 'rule-grid' });
      for (const f of list) grid.appendChild(ruleCell(sess, f));
      fold.appendChild(grid);
      panel.appendChild(fold);
    }
    // anything the formats file adds later still gets a place
    const rest = fields.filter(f => !placed.has(f.key));
    if (rest.length) {
      const grid = el('div', { class: 'rule-grid' });
      for (const f of rest) grid.appendChild(ruleCell(sess, f));
      panel.appendChild(grid);
    }

    panel.appendChild(el('div', { class: 'row wrap rule-foot' }, [
      el('button', {
        class: 'btn sm', text: 'Back to standard', disabled: !changed.length,
        onclick: () => { sess.resetRules(); renderLobby(); UI.ok('Rules reset to the format defaults.'); },
      }),
      el('button', { class: 'btn sm', text: 'Save as a preset', onclick: () => saveRulePreset(sess) }),
      presetPicker(sess),
      el('span', { class: 'grow' }),
    ]));
    return panel;
  }

  /** One rule, with the format's own value shown when it has been changed. */
  function ruleCell(sess, f) {
    const cur = sess.rules[f.key];
    const isDefault = cur === f.value;
    const cell = el('div', { class: 'rule-cell' + (isDefault ? '' : ' changed') });
    const id = 'rule-' + f.key;

    const was = isDefault ? null : el('span', { class: 'rule-was', text: `was ${fmtRuleValue(f, f.value)}` });

    /* A checkbox on its own is a 17px target. Putting it inside its label
       makes the whole row the target, which is the difference between
       usable and not on a phone. */
    if (f.type === 'bool') {
      const box = el('input', { type: 'checkbox', id });
      box.checked = !!cur;
      box.addEventListener('change', () => { sess.setRule(f.key, box.checked); renderLobby(); });
      cell.append(
        el('label', { class: 'rule-label rule-toggle', for: id }, [box, el('span', { text: f.label }), was]),
        el('div', { class: 'rule-hint', text: f.hint }),
      );
      return cell;
    }

    let control;
    if (f.type === 'intOff') {
      // a number with an off switch: commander damage is either a number or gone
      const on = el('input', { type: 'checkbox' });
      on.checked = !!cur;
      const n = el('input', { type: 'number', id, min: String(f.min), max: String(f.max), value: String(cur || f.value || 21), disabled: !cur });
      on.addEventListener('change', () => {
        sess.setRule(f.key, on.checked ? (parseInt(n.value, 10) || f.value || 21) : 0);
        renderLobby();
      });
      n.addEventListener('change', () => {
        sess.setRule(f.key, U.clamp(parseInt(n.value, 10) || f.value, f.min, f.max));
        renderLobby();
      });
      control = el('div', { class: 'row rule-onoff', style: { gap: '8px' } }, [
        el('label', { class: 'rule-toggle inline-check' }, [on, el('span', { text: cur ? 'on' : 'off' })]),
        n,
      ]);
    } else {
      const step = f.type === 'odd' ? 2 : 1;
      const n = el('input', { type: 'number', id, min: String(f.min), max: String(f.max), step: String(step), value: String(cur) });
      n.addEventListener('change', () => {
        let v = parseInt(n.value, 10);
        if (!Number.isFinite(v)) v = f.value;
        v = U.clamp(v, f.min, f.max);
        if (f.type === 'odd' && v % 2 === 0) v = v + 1 > f.max ? v - 1 : v + 1;
        n.value = String(v);
        sess.setRule(f.key, v);
        renderLobby();
      });
      control = n;
    }

    cell.append(
      el('label', { class: 'rule-label', for: id }, [el('span', { text: f.label }), was]),
      control,
      el('div', { class: 'rule-hint', text: f.hint }),
    );
    return cell;
  }

  function fmtRuleValue(f, v) {
    if (f.type === 'bool') return v ? 'on' : 'off';
    if (f.type === 'intOff') return v ? String(v) : 'off';
    return String(v);
  }

  async function saveRulePreset(sess) {
    const name = await UI.prompt('Name this set of rules so you can pick it again.', '', 'Save a preset');
    if (!name || !name.trim()) return;
    MTG.formats.presets.save(sess.formatId, name.trim(), sess.rules);
    renderLobby();
    UI.ok(`Saved “${name.trim()}”.`);
  }

  function presetPicker(sess) {
    const list = MTG.formats.presets.forFormat(sess.formatId);
    if (!list.length) return el('span', { class: 'tiny dim', text: 'Presets you save show up here.' });
    const sel = el('select', { style: { width: 'auto' }, 'aria-label': 'Saved rule presets' }, [
      el('option', { value: '', text: 'Load a preset…' }),
      ...list.map(pr => el('option', { value: pr.name, text: pr.name })),
    ]);
    sel.addEventListener('change', () => {
      const pr = list.find(x => x.name === sel.value);
      if (!pr) return;
      sess.rules = Object.assign(MTG.formats.houseDefaults(sess.formatId), pr.rules);
      sess.refreshFmt();
      for (const r of sess.roster) if (r.deck) r.deckValid = MTG.formats.validate(r.deck, sess.fmt);
      sess.broadcastLobby();
      renderLobby();
      UI.ok(`Loaded “${pr.name}”.`);
    });
    const del = el('button', {
      class: 'btn xs ghost', text: '✕', title: 'Delete the chosen preset',
      onclick: () => {
        if (!sel.value) return UI.error('Choose a preset first.');
        MTG.formats.presets.remove(sess.formatId, sel.value);
        renderLobby();
      },
    });
    return el('div', { class: 'row', style: { gap: '6px' } }, [sel, del]);
  }

  let lobbyTimer = null;
  function renderLobbySoon() { clearTimeout(lobbyTimer); lobbyTimer = setTimeout(() => { if (App.screen === 'lobby' && App.session) renderLobby(); }, 40); }

  function renderClientLobby() {
    const s = screens.lobby;
    s.innerHTML = '';
    sceneBackdrop(s);
    const inner = el('div', { class: 'menu-inner lobby' });
    App.clientBanner = el('header', { class: 'lobby-banner' }, [
      el('div', { class: 'lobby-banner-art', 'aria-hidden': 'true' }),
      el('button', { class: 'btn sm ghost back-btn', 'aria-label': 'Leave', title: 'Leave', html: SVG.back, onclick: () => confirmLeave() }),
      el('div', { class: 'lobby-banner-text' }, [
        el('div', { class: 'eyebrow', text: 'Room ' + net.roomCode }),
        el('h1', { class: 'lobby-title', text: 'Joining a table' }),
        el('div', { class: 'lobby-facts' }, [el('span', { text: 'Connected — waiting for the host' }), rttPill('host')]),
      ]),
    ]);
    App.clientLobbyBox = el('div', { class: 'panel seats-panel' }, el('div', { class: 'empty-note', text: 'Connected. Waiting for the host…' }));
    inner.append(App.clientBanner, App.clientLobbyBox);
    s.appendChild(el('div', { class: 'menu-wrap' }, inner));
  }

  function renderClientLobbyData(payload) {
    if (!App.clientLobbyBox) return;
    const box = App.clientLobbyBox;
    box.innerHTML = '';
    const fmt = MTG.formats.effective(payload.formatId, payload.rules) ||
      { name: payload.formatId, kind: 'constructed' };
    App.clientRules = payload.rules || null;
    App.clientFormatId = payload.formatId;

    // the banner takes the format's name and art once the host says what it is
    const banner = App.clientBanner;
    if (banner && banner.isConnected) {
      banner.querySelector('.lobby-title').textContent = fmt.name;
      const facts = banner.querySelector('.lobby-facts');
      facts.innerHTML = '';
      for (const t of [`${payload.members.length} at the table`, fmt.startingLife ? `${fmt.startingLife} life` : null, 'Waiting for the host to start'])
        if (t) facts.appendChild(el('span', { text: t }));
      facts.appendChild(rttPill('host'));
      if (!banner._art) { banner._art = true; decorArt(banner.firstChild, FORMAT_ART[payload.formatId] || HERO_ART[0]); }
    }
    if (fmt.blurb) box.appendChild(el('p', { class: 'small muted', style: { marginTop: 0 }, text: fmt.blurb }));

    /* The host may be playing the format differently. Say so plainly, and
       say it before anyone picks a deck that the table will refuse. */
    const changed = payload.houseSummary || [];
    if (changed.length) {
      box.appendChild(el('div', { class: 'house-note' }, [
        el('div', { class: 'row' }, [
          el('strong', { class: 'grow', text: 'House rules at this table' }),
          el('span', { class: 'pill warn', text: `${changed.length} changed` }),
        ]),
        el('ul', { class: 'house-list' }, changed.map(t => el('li', { text: t }))),
      ]));
    } else {
      box.appendChild(el('p', { class: 'tiny dim', text: 'The host is playing this format by the book.' }));
    }
    if (payload.setup) box.appendChild(el('p', { class: 'small muted', text: payload.setup }));

    const grid = el('div', { class: 'seat-grid' });
    for (const r of payload.members) {
      const me = r.id === payload.you;
      grid.appendChild(el('article', { class: 'seat-card ' + (r.kind === 'bot' ? 'bot' : 'remote') + (me ? ' mine' : '') }, [
        el('div', { class: 'seat-art', 'aria-hidden': 'true' }),
        el('div', { class: 'seat-top' }, [
          UI.portrait(r.name, null, { size: 'md' }),
          el('div', { class: 'seat-who' }, [
            el('div', { class: 'seat-name', text: r.name + (me ? ' (you)' : '') }),
            el('div', { class: 'seat-role' }, [
              r.kind === 'bot' ? el('span', { class: 'seat-level', text: String(r.difficulty) }) : null,
              el('span', { text: r.kind === 'bot' ? `Bot · ${(MTG.bots.DIFFICULTY[r.difficulty] || {}).label || ''}${r.style ? ' · ' + r.style : ''}` : (me ? 'You' : 'Player') }),
            ].filter(Boolean)),
          ]),
        ]),
        el('div', { class: 'seat-deck' }, [
          el('span', { class: 'seat-deck-name' + (r.deckName ? '' : ' none'), text: r.deckName || (r.kind === 'bot' ? 'Building…' : 'No deck chosen yet') }),
          r.deckValid === false ? el('span', { class: 'pill bad', text: 'deck not legal' }) : (r.deckName ? el('span', { class: 'pill good', text: 'ready' }) : null),
        ].filter(Boolean)),
      ]));
    }
    box.appendChild(grid);
    if (fmt.kind !== 'limited') {
      box.appendChild(el('div', { class: 'client-go' }, [
        el('button', { class: 'btn primary hero-btn', html: `${SVG.deck}<span>Choose my deck</span>`, onclick: () => {
          UI.pickDeck(payload.formatId, (d) => {
            const v = MTG.formats.validate(d, fmt);
            net.intent({ kind: 'setDeck', deck: slimDeckForWire(d), name: App.myName });
            if (!v.ok) UI.toast('Sent, but the host’s rules say: ' + v.errors[0], 'err', 6000);
            else UI.ok('Deck sent to the host.');
          });
        } }),
        el('span', { class: 'small muted', text: 'Waiting for the host to start.' }),
      ]));
    } else {
      box.appendChild(el('p', { class: 'small muted', text: 'The host will open the packs. Sit tight.' }));
    }
  }

  /**
   * A deck travels as printing ids, not card names, so the exact printing a
   * player chose is the one the table builds with. The art preferences ride
   * along too: anything the game later resolves by name — a token, a card
   * fetched by an effect — can then still be shown in its owner's art.
   */
  function slimDeckForWire(d) {
    const art = {};
    const prefs = MTG.settings.artPreferences || {};
    const note = (c) => { if (c && c.oracle_id && prefs[c.oracle_id]) art[c.oracle_id] = prefs[c.oracle_id]; };
    for (const e of d.main) note(e.card);
    for (const e of (d.sideboard || [])) note(e.card);
    for (const c of (d.commanders || [])) note(c);
    return {
      name: d.name, format: d.format,
      main: d.main.map(e => ({ id: e.card.id, q: e.qty })),
      side: (d.sideboard || []).map(e => ({ id: e.card.id, q: e.qty })),
      cmd: (d.commanders || []).map(c => c.id),
      comp: d.companion ? d.companion.id : null,
      // a drafted deck's conspiracies and the cards it exiled before the game
      consp: (d.conspiracies || []).map(x => ({ id: (x.card || x).id, names: x.names || null, number: x.number == null ? null : x.number })),
      dex: (d.draftExiled || []).map(x => ({ id: x.card.id, with: x.with })),
      art,
    };
  }
  async function fatDeckFromWire(w) {
    const ids = w.main.map(e => e.id).concat(w.side.map(e => e.id), w.cmd, w.comp ? [w.comp] : [],
      (w.consp || []).map(x => x.id), (w.dex || []).map(x => x.id));
    const { cards } = await MTG.scry.collection(ids.map(i => ({ id: i })));
    const byId = new Map(); ids.forEach((i, k) => { if (cards[k]) byId.set(i, cards[k]); });
    return {
      id: MTG.uid('deck'), name: w.name, format: w.format,
      main: w.main.map(e => ({ card: byId.get(e.id), qty: e.q })).filter(e => e.card),
      sideboard: w.side.map(e => ({ card: byId.get(e.id), qty: e.q })).filter(e => e.card),
      commanders: w.cmd.map(i => byId.get(i)).filter(Boolean),
      companion: w.comp ? byId.get(w.comp) : null,
      conspiracies: (w.consp || []).map(x => ({ card: byId.get(x.id), names: x.names, number: x.number })).filter(x => x.card),
      draftExiled: (w.dex || []).map(x => ({ card: byId.get(x.id), with: x.with })).filter(x => x.card),
    };
  }

  /* Rule changes that mean a bot's deck is the wrong shape now. */
  const DECK_SHAPING = ['deckMin', 'exactSize', 'maxCopies', 'singleton', 'colorIdentity', 'commanderDamage'];

  /**
   * Repaint one seat's cards in the art that seat chose. The deck already
   * arrives as the right printings; this catches everything else the game
   * holds for them, and it is what makes another player's choice visible
   * rather than only their own.
   */
  async function applySeatArt(g, roster) {
    const wanted = new Map();          // print id -> [objects waiting for it]
    for (const r of roster) {
      const prefs = r.kind === 'local' ? (MTG.settings.artPreferences || {}) : (r.art || null);
      if (!prefs) continue;
      const zones = g.zones[r.id];
      if (!zones) continue;
      const all = ['library', 'hand', 'command', 'graveyard', 'exile']
        .flatMap(z => zones[z] || []);
      for (const o of all) {
        const want = o.card && o.card.oracle_id && prefs[o.card.oracle_id];
        if (!want || want === o.card.id) continue;
        if (!wanted.has(want)) wanted.set(want, []);
        wanted.get(want).push(o);
      }
    }
    if (!wanted.size) return;
    try {
      const ids = [...wanted.keys()];
      const { cards } = await MTG.scry.collection(ids.map(id => ({ id })));
      ids.forEach((id, i) => {
        const print = cards[i];
        if (!print) return;
        for (const o of wanted.get(id)) o.card = print;
      });
    } catch (e) { /* the default printing is a fine fallback */ }
  }

  /* ================= session (host side) ================= */

  class Session {
    constructor(formatId, rules) {
      this.formatId = formatId;
      this.rules = Object.assign(MTG.formats.houseDefaults(formatId), rules || {});
      this.refreshFmt();
      this.roster = [];
      // The table keeps the rules. There is no switch for this any more: a
      // game where the engine is not the judge was a setting nobody wanted,
      // and the field only survives so a game saved by an older build can
      // still be resumed exactly as it was.
      this.enforcement = 'full';
      this.setCode = '';
      this.chaosPool = null;      // {preset, sets:[code]} — chaos draft only
      this.cube = null;
      this.game = null;
      this.draft = null;
      this.botRunner = null;
      this.seed = Date.now();
    }
    /**
     * Build a bot's deck the moment it sits down, not when the game starts.
     * The wait is the same length either way; the difference is whether you
     * spend it looking at a progress bar or at the lobby. A rule change or a
     * difficulty change throws the deck away and builds another.
     */
    buildBotDeck(seat) {
      if (this.fmt.kind === 'limited') return;      // those decks come from the draft
      const token = (seat._build = {});
      seat.deck = null;
      seat.building = true;
      seat.buildFailed = null;
      renderLobbySoon();
      MTG.bots.buildBotDeck({
        formatId: this.formatId, difficulty: seat.difficulty, rules: this.rules,
        personality: seat.personality || undefined,
        rng: new MTG.RNG(this.seed + seat.id), name: seat.name + "'s deck",
      }).then((deck) => {
        if (seat._build !== token) return;          // superseded by a later build
        seat.deck = deck;
        seat.deckValid = MTG.formats.validate(deck, this.fmt);
        seat.building = false;
        // now that there is a deck, the seat can be called after it
        const taken = this.roster.filter(r => r !== seat).map(r => r.name).concat([App.myName]);
        const named = botNameFor(deck, this.formatId, taken);
        if (named) {
          seat.name = named;
          deck.name = named + '\u2019s deck';
          if (this.game) { const p = this.game.player(seat.id); if (p) p.name = named; }
        }
        this.broadcastLobby();
        renderLobbySoon();
      }).catch((e) => {
        if (seat._build !== token) return;
        seat.building = false;
        seat.buildFailed = e.message || String(e);
        renderLobbySoon();
      });
    }

    /** Every bot that has not got a deck yet starts building one. */
    rebuildBotDecks() {
      for (const r of this.roster) if (r.kind === 'bot') this.buildBotDeck(r);
    }

    /** Recompute the format the table is actually playing. */
    refreshFmt() { this.fmt = MTG.formats.effective(this.formatId, this.rules); }
    /** Change one house rule and let everything downstream see it. */
    setRule(key, value) {
      this.rules[key] = value;
      this.refreshFmt();
      for (const r of this.roster) if (r.deck) r.deckValid = MTG.formats.validate(r.deck, this.fmt);
      // a deck size or a copy limit changes what a bot should have built
      if (DECK_SHAPING.includes(key)) this.rebuildBotDecks();
      this.broadcastLobby();
    }
    resetRules() {
      this.rules = MTG.formats.houseDefaults(this.formatId);
      this.refreshFmt();
      for (const r of this.roster) if (r.deck) r.deckValid = MTG.formats.validate(r.deck, this.fmt);
      this.rebuildBotDecks();
      this.broadcastLobby();
    }
    /* The three old names are still how the rest of the app talks about these,
       so they stay — they just read and write the rule set now. */
    get startingLife() { return this.rules.startingLife; }
    set startingLife(v) { this.rules.startingLife = v; this.refreshFmt(); }
    get packs() { return this.rules.packs; }
    set packs(v) { this.rules.packs = v; this.refreshFmt(); }
    get packSize() { return this.rules.packSize; }
    set packSize(v) { this.rules.packSize = v; this.refreshFmt(); }

    addLocalHost(name) {
      this.roster.push({ id: 'me', kind: 'local', name, deck: null, deckValid: null, peerId: null });
    }

    /** Whether anyone at this table is the person looking at it. */
    get spectating() { return !this.roster.some(r => r.kind === 'local'); }

    /**
     * Give up your seat. The bots carry on without you and you watch,
     * which is the only way to see how two of them actually play.
     */
    sitOut() {
      const me = this.seat('me');
      if (!me) return;
      this._satOut = { name: me.name, deck: me.deck, deckValid: me.deckValid };
      this.roster = this.roster.filter(r => r !== me);
      if (this.roster.length < this.fmt.minPlayers) this.addBot(5);
      this.broadcastLobby();
      UI.toast('You are watching. Take a seat again whenever you like.');
    }

    /** Come back to the table. */
    takeSeat() {
      if (!this.spectating) return;
      /** @type {Record<string, any>} */
      const was = this._satOut || {};
      this.roster.unshift({
        id: 'me', kind: 'local', name: was.name || App.myName,
        deck: was.deck || null, deckValid: was.deckValid || null, peerId: null,
      });
      this.broadcastLobby();
    }
    addBot(difficulty, personality) {
      // a name of its own, so the table reads as people rather than slots
      const name = randomName(this.roster.map(r => r.name).concat([App.myName]));
      const seat = { id: MTG.uid('bot'), kind: 'bot', name, difficulty: difficulty || 5,
        personality: personality || '', deck: null };
      this.roster.push(seat);
      this.buildBotDeck(seat);
      return seat;
    }
    /**
     * A joining player. A peer id changes every time the connection does, so
     * seats are matched on a token the client keeps: drop off a train, come
     * back, and you get your own seat and your own cards, not a new chair.
     */
    addRemote(peerId, name, token) {
      const existing = token && this.roster.find(r => r.token === token);
      if (existing) {
        existing.peerId = peerId;
        if (name) existing.name = name;
        if (this.game) {
          const p = this.game.player(existing.id);
          if (p) this.game.setConnected(p.id, true);
          this.pushState();
        }
        this.broadcastLobby();
        renderLobbySoon();
        UI.ok(`${existing.name} is back.`);
        return existing;
      }
      if (this.roster.some(r => r.peerId === peerId)) return null;
      if (this.game) {
        this.watchers = this.watchers || new Map();
        this.watchers.set(peerId, { name: name || 'Someone' });
        net.send(peerId, { t: 'error', payload: 'That game is already under way — you are watching.' });
        this.pushState();
        return null;
      }
      if (this.roster.length >= this.fmt.maxPlayers) { net.send(peerId, { t: 'error', payload: 'That table is full.' }); return null; }
      const seat = { id: MTG.uid('rp'), kind: 'remote', name: name || 'Player', peerId, token: token || null, deck: null, deckValid: null };
      this.roster.push(seat);
      this.broadcastLobby();
      renderLobbySoon();
      return seat;
    }
    removeSeat(id) { this.roster = this.roster.filter(r => r.id !== id); this.broadcastLobby(); }
    seatByPeer(peerId) { return this.roster.find(r => r.peerId === peerId); }
    seat(id) { return this.roster.find(r => r.id === id); }

    broadcastLobby() {
      if (!net.isHost) return;
      net.sendPerPeer((peerId) => {
        const me = this.seatByPeer(peerId);
        return {
          t: 'lobby', payload: {
            formatId: this.formatId,
            you: me ? me.id : null,
            rules: this.rules,
            houseSummary: MTG.formats.houseSummary(this.formatId, this.rules),
            setup: this.setupSummary(),
            members: this.roster.map(r => ({
              id: r.id, name: r.name, kind: r.kind, difficulty: r.difficulty,
              style: r.kind === 'bot' && seatPersonality(r) ? seatPersonality(r).label : null,
              deckName: r.deck ? r.deck.name : null,
              deckValid: r.deckValid ? r.deckValid.ok : null,
            })),
          },
        };
      });
    }

    /** The parts of the setup that are not house rules: what is being drafted. */
    setupSummary() {
      const f = this.fmt;
      if (f.kind !== 'limited') return null;
      if (f.draft.style === 'cube') return this.cube ? `Cube: ${this.cube.name}` : 'Cube: not chosen yet';
      if (f.draft.style === 'chaos') {
        const sets = this.chaosPoolSets();
        return `Chaos pool: ${sets && sets.length ? `${sets.length} sets` : 'every set'}`;
      }
      return this.setCode ? `Set: ${this.setCode.toUpperCase()}` : 'Set: not chosen yet';
    }

    /** The set codes a chaos draft may pull packs from; empty means anything. */
    chaosPoolSets() {
      const p = this.chaosPool;
      if (!p || !p.sets || !p.sets.length) return null;
      return p.sets.slice();
    }

    readyToStart() {
      const n = this.roster.length;
      if (n < this.fmt.minPlayers) return { ok: false, reason: `Needs at least ${this.fmt.minPlayers} players.` };
      if (n > this.fmt.maxPlayers) return { ok: false, reason: `At most ${this.fmt.maxPlayers} players.` };
      if (this.fmt.kind === 'limited') {
        if (this.fmt.draft.style === 'cube' && !this.cube) return { ok: false, reason: 'Choose a cube first.' };
        if (this.fmt.draft.style === 'booster' && !this.setCode) return { ok: false, reason: 'Choose a set to draft.' };
        if (this.fmt.draft.style === 'chaos') {
          const pool = this.chaosPoolSets();
          if (pool && pool.length < 2) return { ok: false, reason: 'A chaos pool needs at least two sets.' };
        }
        if (this.fmt.draft.style === 'commander' && !this.setCode) return { ok: false, reason: 'Choose a set to draft.' };
        return { ok: true };
      }
      if (this.spectating && !this.roster.some(r => r.kind === 'bot')) {
        return { ok: false, reason: 'Nobody is playing. Add a bot, or take a seat yourself.' };
      }
      const missing = this.roster.filter(r => r.kind !== 'bot' && !r.deck);
      if (missing.length) return { ok: false, reason: `Waiting on a deck from: ${missing.map(r => r.name).join(', ')}.` };
      /* A bot builds what the card pool allows. If that comes out a card or
         two short of legal it is the builder's shortcoming, not something
         for the person at the table to fix, so it is shown on the bot's row
         rather than stopping the game. */
      const bad = this.roster.filter(r => r.kind !== 'bot' && r.deck && r.deckValid && !r.deckValid.ok);
      if (bad.length) return { ok: false, reason: `Not legal: ${bad.map(r => r.name).join(', ')}. Fix the deck, or pick a format it is legal in.` };
      return { ok: true };
    }

    async start() {
      if (this.fmt.kind === 'limited') return this.startDraft();
      return this.startGame();
    }

    /* ---- draft ---- */
    async startDraft() {
      let cancelled = false;
      const busy = UI.busy('Opening packs', 'Building boosters…', {
        cancelLabel: 'Stop and go back',
        onCancel: () => { cancelled = true; renderLobby(); },
      });
      try {
        const d = new MTG.draft.Draft({
          formatId: this.formatId,
          seats: this.roster.length,
          packs: this.packs,
          packSize: this.packSize,
          // left at the format's number, each pack is its booster's real size
          packSizeAuto: this.packSize === MTG.formats.houseDefaults(this.formatId).packSize,
          collector: !!this.rules.collector,
          picksPerTurn: this.fmt.draft.picksPerTurn,
          setCodes: this.fmt.draft.style === 'chaos' ? (this.chaosPoolSets() || []) : [this.setCode],
          cube: this.cube,
          faceUp: !!this.fmt.draft.faceUp,
          seed: this.seed,
        });
        for (const r of this.roster) d.addSeat({ id: r.id, name: r.name, isBot: r.kind === 'bot', botDifficulty: r.difficulty });
        await d.prepare((a, b, code) => {
          if (cancelled) throw new Error('__cancelled');
          busy.set(a / b, `Building pack ${a}/${b} \u00b7 ${code}`);
        });
        if (cancelled) return;
        this.draft = d;
        busy.close();

        d.on('pick:done', () => this.pushDraft());
        d.on('round:begin', () => this.pushDraft());
        d.on('draft:done', () => this.finishDraft());

        showScreen('draft');
        if (App.draftUI && App.draftUI.destroy) App.draftUI.destroy();
        App.draftUI = new UI.DraftTable(screens.draft, 'me', (intent) => this.handleIntent('me', intent));
        d.start();
        this.pushDraft();
        // bots tick with a delay so it feels like a table
        this.draftTimer = setInterval(() => { if (!d.finished) d.emit('tick'); }, 500);
      } catch (e) {
        busy.close();
        if (String(e.message) !== '__cancelled') UI.error(e.message || String(e));
      }
    }

    pushDraft() {
      if (!this.draft) return;
      if (App.draftUI) App.draftUI.update(this.draft.viewFor('me'));
      if (net.isHost) net.sendPerPeer((peerId) => {
        const r = this.seatByPeer(peerId);
        return r ? { t: 'draft', payload: this.draft.viewFor(r.id) } : null;
      });
    }

    async finishDraft() {
      clearInterval(this.draftTimer);
      // bots build decks from their pools; humans go to the builder
      const basics = await MTG.draft.getBasics().catch(() => ({}));
      for (const r of this.roster) {
        const seat = this.draft.seats.find(s => s.id === r.id);
        if (!seat) continue;
        r.pool = seat.pool;
        if (r.kind === 'bot') {
          r.deck = MTG.draft.autoBuildLimited(seat.pool, {
            deckSize: this.fmt.deckMin || 40, basicCards: basics, formatId: this.formatId, name: r.name + "'s deck",
          });
          if (this.fmt.commander) {
            const legends = seat.pool.filter(c => MTG.formats.canBeCommander(c, this.fmt));
            if (legends.length) {
              r.deck.commanders = [legends[0]];
              r.deck.main = r.deck.main.filter(e => e.card.id !== legends[0].id);
            }
          }
        }
      }
      const me = this.seat('me');
      UI.buildFromPool(me.pool, this.formatId, (deck) => {
        me.deck = deck;
        this.startGame();
      });
      if (net.isHost) net.sendPerPeer((peerId) => {
        const r = this.seatByPeer(peerId);
        return r ? { t: 'draft', payload: Object.assign(this.draft.viewFor(r.id), { buildNow: true }) } : null;
      });
    }

    /* ---- game ---- */
    async startGame() {
      const busy = UI.busy('Shuffling up', 'Getting the table ready…');
      try {
        // a new game in the same match gets a fresh shuffle and the next seat
        if (this.match) this.seed = this.match.seed + this.match.games.length + 1;
        // and so does a rematch: the same seed would deal the same hands again
        else if (this.game) this.seed = (Date.now() >>> 0) || 1;
        /* Bots normally built their decks back in the lobby, while you were
           still choosing yours. Anything still in flight is waited on here,
           and anything that never started is built now. */
        for (const r of this.roster) {
          if (r.kind !== 'bot' || r.deck) continue;
          busy.text(`${r.name} is building a deck…`);
          for (let i = 0; r.building && i < 600; i++) await U.sleep(100);
          if (r.deck) continue;
          r.deck = await MTG.bots.buildBotDeck({
            formatId: this.formatId, difficulty: r.difficulty, rules: this.rules,
            rng: new MTG.RNG(this.seed + r.id), name: r.name + "'s deck",
            onProgress: (t) => busy.text(`${r.name}: ${t}…`),
          });
        }

        const g = new MTG.rules.Game({
          formatId: this.formatId,
          startingLife: this.rules.startingLife,
          startingHand: this.rules.startingHand || 7,
          commanderDamage: this.fmt.commander ? (this.rules.commanderDamage || null) : null,
          freeMulligans: this.rules.freeMulligans || 0,
          maxPlayers: this.fmt.maxPlayers,
          seed: this.seed,
          rulesEnforcement: this.enforcement,
          firstPlayerDraws: this.rules.firstPlayerDraws || this.roster.length > 2,
        });
        for (const r of this.roster) {
          const p = g.addPlayer({ id: r.id, name: r.name, isBot: r.kind === 'bot', botDifficulty: r.difficulty });
          // what the draft cards noted, from the draft itself (src/07-draft.js)
          if (this.draft && r.deck) r.deck.draftNotes = this.draft.notesFor(r.id, r.deck) || r.deck.draftNotes || null;
          g.loadDeck(p.id, r.deck);
        }
        // the printing each player picked is the printing everyone sees
        await applySeatArt(g, this.roster);
        // the local seat's auto-pass preferences; remote seats send their own
        if (g.player('me')) g.setAutoPass('me', MTG.autoPassConfig());
        for (const r of this.roster) if (r.kind === 'remote' && r.autoPass && g.player(r.id)) g.setAutoPass(r.id, r.autoPass);
        this.game = g;
        this.botRunner = new MTG.bots.BotRunner(g);
        for (const r of this.roster) if (r.kind === 'bot') seatBot(g, this.botRunner, r);

        this.wireGame(g);
        this.startRecording(g);

        busy.close();
        showScreen('table');
        if (App.table) App.table.destroy();
        App.table = new UI.Table(screens.table, 'me', (intent) => this.handleIntent('me', intent));
        // prefetch art for a smooth first turn
        const allCards = [];
        for (const r of this.roster) if (r.deck) allCards.push(...r.deck.main.map(e => e.card), ...(r.deck.commanders || []));
        MTG.scry.prefetchImages(allCards, 'normal');

        g.start();
        this.pushState();
        this.botRunner.kick();
        // how many games this browser has sat down to, for what a newcomer is offered
        if (!this.spectating) MTG.store.set('gamesPlayed', (MTG.store.get('gamesPlayed', 0) || 0) + 1);
      } catch (e) {
        busy.close();
        UI.error(e.message || String(e));
        console.error(e);
      }
    }

    pushState() {
      if (!this.game) return;
      const match = this.matchView();
      if (App.table) {
        /* Watching is the view of someone with no seat: every board, no
           hand, nothing to click. viewFor with an id nobody has gives
           exactly that, and hides every hand rather than none. */
        const v = this.game.viewFor(this.spectating ? '__watching' : 'me');
        v.spectating = this.spectating;
        v.match = match;
        this.withEvents(v, 'local');
        App.lastView = v;
        App.table.update(v);
        if (net.isHost) App.paintNetChip();
      }
      /* Guests are sent at most one view per thing that happens: one
         action can change the game a dozen times in a row, and the events
         carry every step of it anyway. */
      if (net.isHost && !this._netQueued) {
        this._netQueued = true;
        queueMicrotask(() => { this._netQueued = false; this.sendViews(); });
      }
    }

    /** What has happened since this viewer's last view, as that viewer may know it. */
    withEvents(v, key) {
      // each game has its own stream; a new one starts everybody from its beginning
      if (this._evGame !== this.game) { this._evGame = this.game; this._evSeen = {}; this._gameNo = (this._gameNo || 0) + 1; }
      v.game = this.seed + ':' + this._gameNo;
      const seen = this._evSeen;
      v.events = this.game.eventsFor(v.you, seen[key]);
      v.eventSeq = this.game.eventSeq;
      seen[key] = this.game.eventSeq;
      return v;
    }

    /**
     * Each guest's view, as the difference from the last one it has (see
     * src/09b-sync.js). A guest without a seat — someone who came to
     * watch a game already under way — sees what a spectator sees.
     */
    sendViews() {
      if (!this.game || !net.isHost) return;
      const match = this.matchView();
      const encs = (this._enc = this._enc || new Map());
      net.sendPerPeer((peerId) => {
        const r = this.seatByPeer(peerId);
        const viewer = r ? r.id : (this.watchers && this.watchers.has(peerId) ? '__watching' : null);
        if (!viewer) return null;
        let enc = encs.get(peerId);
        if (!enc) { enc = new MTG.sync.Encoder(); encs.set(peerId, enc); }
        const v = this.game.viewFor(viewer);
        v.match = match;
        if (!r) v.spectating = true;
        this.withEvents(v, 'peer:' + peerId);
        return enc.encode(v);
      });
    }

    /** Keep the game on the record from here on, for "Save replay". */
    startRecording(g) {
      if (this.recorder) this.recorder.stop();
      this.recorder = null;
      try {
        this.recorder = MTG.replay.record(g, {
          me: this.spectating ? null : 'me',
          names: this.roster.map(r => ({ id: r.id, name: r.name, kind: r.kind })),
        });
      } catch (e) { console.warn('[replay] not recording this game', e); }
    }

    /* ---- intents ---- */
    /**
     * Rebuild a session from a snapshot. The roster, bots and wiring are
     * recreated; the game itself is poured back in rather than replayed.
     */
    static async resume(saved) {
      const sess = new Session(saved.formatId, saved.rules || null);
      if (saved.startingLife != null) sess.startingLife = saved.startingLife;
      sess.enforcement = saved.enforcement || 'full';
      sess.seed = saved.seed;
      sess.match = saved.match || null;
      sess.roster = saved.roster.map(r => Object.assign({ deck: null, deckValid: null, peerId: null }, r));
      const g = new MTG.rules.Game({
        formatId: saved.formatId, startingLife: sess.rules.startingLife,
        startingHand: sess.rules.startingHand || 7,
        commanderDamage: sess.fmt.commander ? (sess.rules.commanderDamage || null) : null,
        freeMulligans: sess.rules.freeMulligans || 0,
        seed: saved.seed, rulesEnforcement: saved.enforcement,
      });
      if (!g.restore(saved.snap)) throw new Error('That saved game could not be read.');
      g.setAutoPass('me', MTG.autoPassConfig());
      sess.game = g;
      sess.botRunner = new MTG.bots.BotRunner(g);
      for (const r of sess.roster) if (r.kind === 'bot') seatBot(g, sess.botRunner, r);
      sess.wireGame(g);
      // a resumed game is recorded from where it was picked up
      sess.startRecording(g);
      App.session = sess;
      showScreen('table');
      if (App.table) App.table.destroy();
      App.table = new UI.Table(screens.table, 'me', (intent) => sess.handleIntent('me', intent));
      sess.pushState();
      sess.botRunner.kick();
      return sess;
    }

    wireGame(g) {
      g.on('state', () => { this.pushState(); this.saveInProgress(); });
      g.on('error', (m) => { if (this._lastActor === 'me') UI.error(m); });
      /* Sound, and the cards that light up when they speak, come from the
         table as it shows each event (src/12f-ui-feel.js), the same for
         the host as for a guest. The engine's own 'sfx' is not listened to. */
      g.on('game:over', () => {
        MTG.savedGame.clear();
        this.recordResult(g);
      });
    }

    /**
     * Note who won and keep the match score. Best of three by default in
     * the one-on-one formats; multiplayer games are one-offs.
     */
    recordResult(g) {
      const oneOnOne = this.roster.length === 2;
      if (!oneOnOne || (this.rules.bestOf || 1) < 2) return;
      this.match = this.match || { seed: this.seed, best: this.rules.bestOf || 1, games: [], wins: {} };
      const w = g.winners[0] || null;
      this.match.games.push({ winner: w, turns: g.turn });
      if (w) this.match.wins[w] = (this.match.wins[w] || 0) + 1;
      this.pushState();
    }

    /** What the table shows above the result. */
    matchView() {
      const m = this.match;
      if (!m) return null;
      const need = Math.ceil(m.best / 2);
      const scores = this.roster.map(r => ({
        id: r.id, name: r.name, wins: m.wins[r.id] || 0,
        leading: (m.wins[r.id] || 0) >= need,
      }));
      const decided = scores.some(sc => sc.wins >= need) || m.games.length >= m.best;
      const winner = scores.find(sc => sc.wins >= need);
      return {
        gameNumber: m.games.length, best: m.best, scores, decided,
        label: decided
          ? (winner ? `${winner.name} takes the match` : 'Match drawn')
          : `Game ${m.games.length} of ${m.best}`,
      };
    }

    /** Keep the current game on disk so closing the tab is not losing it. */
    saveInProgress(now) {
      if (!this.game || this.game.over || net.isClient) return;   // a guest has nothing to save
      if (this._saveTimer && !now) return;
      if (now && this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
      const write = () => {
        this._saveTimer = null;
        try {
          return MTG.savedGame.write({
            formatId: this.formatId,
            startingLife: this.rules.startingLife,
            rules: this.rules,
            enforcement: this.enforcement,
            seed: this.seed,
            roster: this.roster.map(r => ({ id: r.id, name: r.name, kind: r.kind, difficulty: r.difficulty })),
            match: this.match || null,
            snap: this.game.snapshot(),
          });
        } catch (e) { /* storage full: not worth interrupting a game over */ }
      };
      if (now) return write();
      this._saveTimer = setTimeout(write, 400);
    }

    handleIntent(actorId, intent) {
      this._lastActor = actorId;
      const g = this.game;
      if (intent.kind === 'chat') { net.chat(this.seat(actorId) ? this.seat(actorId).name : 'Player', intent.text); return; }
      if (intent.kind === 'setDeck') return;   // handled in the net layer
      if (this.draft && !this.draft.finished) {
        const d = this.draft;
        if (intent.kind === 'pick') {
          const opts = { ability: intent.ability || null, mods: intent.mods || [], guess: intent.guess || null };
          if (!d.pick(actorId, intent.cardIds, opts) && actorId === 'me')
            UI.error('That pick was not legal.');
          this.pushDraft();
        } else if (intent.kind === 'draftOffer') {
          d.answerOffer(actorId, intent.cardId, intent.yes);
          this.pushDraft();
        } else if (intent.kind === 'draftAct') {
          /* everything else a draft card does between picks; what it lets a
             seat look at comes back in that seat's own view */
          if (!d.act(actorId, intent) && actorId === 'me') UI.error('That cannot be done now.');
          this.pushDraft();
        }
        return;
      }
      if (!g) return;
      // anything that changes the game is undoable; asking a question is not
      const UNDOABLE = {
        playLand: 'playing a land', cast: 'casting', activate: 'an ability',
        mana: 'tapping for mana', declareAttackers: 'the attack',
        declareBlockers: 'the blocks', choice: 'that choice', manual: 'that',
        mulligan: 'the mulligan', keep: 'keeping', pass: 'passing',
      };
      const before = g.stateVersion;
      const undoEntry = (UNDOABLE[intent.kind] && !g.over)
        ? g.pushUndo(UNDOABLE[intent.kind], actorId) : null;
      switch (intent.kind) {
        case 'pass': g.passPriority(actorId); break;
        case 'hold': g.setHoldPriority(actorId, intent.on); break;
        case 'undo': g.undo(actorId); break;
        case 'autoPass': g.setAutoPass(actorId, intent.cfg); break;
        case 'fullControl': g.setFullControl(actorId, !!intent.on, !!intent.sticky); break;
        case 'yield': g.setYield(actorId, intent.mode || null); break;
        case 'mulligan': g.mulligan(actorId); break;
        case 'keep': g.keepHand(actorId, intent.bottom || []); break;
        case 'playLand': g.playLand(actorId, intent.objId, intent.face === 1 ? 1 : 0); break;
        case 'cast': g.castSpell(actorId, intent.objId, { targets: intent.targets || [], auto: true,
          free: !!intent.free, kick: intent.kick || 0, buyback: !!intent.buyback, entwine: !!intent.entwine,
          offspring: !!intent.offspring, squad: intent.squad || 0, casualty: !!intent.casualty,
          spree: intent.spree || null, via: intent.via || null,
          face: intent.face === 1 ? 1 : 0,       // which half of a split card
          fuse: !!intent.fuse,                   // or both halves, fused
          returnId: typeof intent.returnId === 'string' ? intent.returnId : undefined,   // sneak: the attacker that goes back
          // what pays instead of mana, when the player chose it: creatures to convoke, artifacts to improvise, cards to delve
          convokeIds: idList(intent.convokeIds), improviseIds: idList(intent.improviseIds), delveIds: idList(intent.delveIds),
          // generic questions answered with the extra costs (replicate, splice); the engine checks them
          choices: intent.choices && typeof intent.choices === 'object' ? intent.choices : null,
          x: Math.max(0, Math.min(99, parseInt(intent.x, 10) || 0)) }); break;
        case 'cycle': g.cycleCard(actorId, intent.objId, { auto: true }); break;
        case 'plot': g.plotCard(actorId, intent.objId, { auto: true }); break;
        case 'suspend': g.suspendCard(actorId, intent.objId, { auto: true }); break;
        case 'transmute': g.transmuteCard(actorId, intent.objId, { auto: true }); break;
        case 'encore': g.encoreCard(actorId, intent.objId, { auto: true }); break;
        case 'turnFaceUp': g.turnFaceUp(actorId, intent.objId, { auto: true }); break;
        /* A cost paid with cards (sacrifice this, discard that) can be chosen up
           front, the way a bot does it; the engine still checks each pick
           against what the cost allows, and asks for anything left over. */
        case 'activate': g.activateAbility(actorId, intent.objId, intent.index, { targets: intent.targets || [], auto: true,
          sacrificeIds: Array.isArray(intent.sacrificeIds) ? intent.sacrificeIds.slice(0, 20).map(String) : undefined,
          discardIds: Array.isArray(intent.discardIds) ? intent.discardIds.slice(0, 20).map(String) : undefined }); break;
        case 'mana': g.tapForMana(actorId, intent.objId, intent.index || 0, intent.choice); break;
        case 'declareAttackers': g.declareAttackers(actorId, intent.declarations || []); break;
        case 'declareBlockers': g.declareBlockers(actorId, intent.declarations || []); break;
        case 'choice': g.resolveChoice(actorId, intent.data || {}); break;
        case 'concede': g.concede(actorId); break;
        case 'manual': g.manual(actorId, intent.action, {
          objId: intent.objId, zone: intent.zone, toBottom: intent.toBottom,
          kind: intent.kind2, n: intent.n, hostId: intent.hostId, token: intent.token,
          text: intent.text, sides: intent.sides,
        }); break;
        default: break;
      }
      // an action that was refused, or changed nothing, is not worth undoing
      if (undoEntry && g.stateVersion === before) g.dropUndo(undoEntry);
      /* The engine answers an intent while it is being handled, so anything
         it complains about after this point is somebody else's doing — a bot
         being told it cannot pay is not news for the person at the table. */
      this._lastActor = null;
      if (this.botRunner) this.botRunner.kick();
    }
  }

  /* ================= connection quality =================
     How each connection is doing, from the host's pings (src/09-net.js):
     a round trip in milliseconds, coloured good, fair or poor, and plainly
     "reconnecting…" while a guest is finding its way back. */

  /** The words and the grade for one connection. `peer` is a peer id, or 'host' for a guest's own link. */
  function netState(peer) {
    if (peer === 'host') {
      if (net.rejoining) return { text: 'reconnecting…', q: 'poor' };
      const ms = net.hostRtt;
      return ms == null ? { text: 'connected', q: 'good' } : { text: `${ms} ms`, q: net.quality(ms) };
    }
    if (!net.conns.has(peer)) return { text: 'disconnected', q: 'poor' };
    const ms = net.rtt.get(peer);
    return ms == null ? { text: 'connected', q: 'good' } : { text: `${ms} ms`, q: net.quality(ms) };
  }
  const NET_PILL = { good: 'good', fair: 'warn', poor: 'bad' };
  /** A pill that keeps itself up to date with one connection. */
  function rttPill(peer) {
    const st = netState(peer);
    return el('span', {
      class: 'pill net-rtt ' + (NET_PILL[st.q] || ''), dataset: { peer: peer || '' },
      title: 'Round trip to the host and back. Under 150 ms is good; over 400 ms, actions feel slow.',
      text: st.text,
    });
  }
  function updateRttPills() {
    for (const n of document.querySelectorAll('.net-rtt')) {
      const st = netState(n.dataset.peer);
      if (n.textContent !== st.text) n.textContent = st.text;
      n.className = 'pill net-rtt ' + (NET_PILL[st.q] || '');
    }
  }

  /**
   * At the table, a small chip in the corner: a guest sees its link to
   * the host, the host sees each guest. It is not there in a game with
   * nobody else on the network.
   */
  App.paintNetChip = function () {
    const t = App.table;
    if (!t || !t.arena) return;
    let chip = t.arena.querySelector(':scope > .net-chip');
    if (!net.online || (net.isHost && !net.conns.size)) { if (chip) chip.remove(); return; }
    if (!chip) { chip = el('div', { class: 'net-chip', role: 'status', 'aria-live': 'polite' }); t.arena.appendChild(chip); }
    const rows = [];
    if (net.isClient) {
      rows.push(['Host', netState('host')]);
    } else {
      const sess = App.session;
      for (const peer of net.conns.keys()) {
        const r = sess && sess.seatByPeer(peer);
        rows.push([r ? r.name : 'Watcher', netState(peer)]);
      }
    }
    const worst = rows.reduce((w, [, st]) => (st.q === 'poor' ? 'poor' : st.q === 'fair' && w !== 'poor' ? 'fair' : w), 'good');
    const sig = JSON.stringify(rows);
    if (chip._sig === sig) return;
    chip._sig = sig;
    chip.className = 'net-chip q-' + worst + (net.rejoining ? ' rejoining' : '');
    chip.innerHTML = '';
    chip.appendChild(el('i', { class: 'net-chip-dot', 'aria-hidden': 'true' }));
    chip.appendChild(el('span', { text: rows.map(([who, st]) => `${who} ${st.text}`).join(' · ') }));
    chip.title = 'Connection: round trip in milliseconds. Under 150 ms is good; over 400 ms, actions feel slow.';
  };

  /**
   * Options > Online: TURN relays for networks that block a direct
   * connection, and a test of what this browser can reach.
   */
  function onlineGroup(group) {
    const S = MTG.settings;
    const have = (S.iceServers || [])[0] || {};
    const urlIn = el('input', { type: 'text', id: 'opt-turn-url', value: have.urls || '', placeholder: 'turn:relay.example.com:3478', autocomplete: 'off', spellcheck: 'false' });
    const userIn = el('input', { type: 'text', id: 'opt-turn-user', value: have.username || '', placeholder: 'Username', autocomplete: 'off', spellcheck: 'false' });
    const passIn = el('input', { type: 'password', id: 'opt-turn-pass', value: have.credential || '', placeholder: 'Password or credential', autocomplete: 'new-password' });
    const result = el('div', { class: 'opt-help net-test', 'aria-live': 'polite' });
    const save = () => {
      const urls = urlIn.value.trim();
      if (urls && !/^turns?:/i.test(urls.split(/[\s,]+/)[0])) return UI.error('A TURN address starts with turn: or turns:');
      MTG.setSetting('iceServers', urls ? [{ urls, username: userIn.value.trim(), credential: passIn.value }] : []);
      UI.ok(urls ? 'Relay saved. It is used from the next room you open or join.' : 'Relay removed.');
    };
    const test = async (btn) => {
      btn.disabled = true;
      result.className = 'opt-help net-test';
      result.textContent = 'Asking the servers…';
      const urls = urlIn.value.trim();
      const servers = MTG.net.iceServers().filter(s => ![].concat(s.urls).some(u => /^turns?:/.test(u)));
      if (urls) servers.push(Object.assign({ urls: urls.split(/[\s,]+/).filter(Boolean) },
        userIn.value.trim() ? { username: userIn.value.trim() } : null, passIn.value ? { credential: passIn.value } : null));
      const r = await MTG.net.testIce({ iceServers: servers });
      btn.disabled = false;
      const parts = [`${r.host} local`, `${r.srflx} public (STUN)`, `${r.relay} relay (TURN)`];
      let verdict, cls;
      if (r.error) { verdict = r.error; cls = 'bad'; }
      else if (r.relay) { verdict = 'The relay answered: even a strict network should be able to connect through it.'; cls = 'good'; }
      else if (urls) { verdict = 'No relay candidates: the TURN server did not answer. Check the address, the username and the password.'; cls = 'bad'; }
      else if (r.srflx) { verdict = 'Your public address was found, so most networks can connect directly. Without a relay, a strict network may still block it.'; cls = 'warn'; }
      else { verdict = 'No public address found: this network may block direct connections. A TURN relay would help.'; cls = 'bad'; }
      result.className = 'opt-help net-test ' + cls;
      result.textContent = `Found ${parts.join(', ')} in ${(r.ms / 1000).toFixed(1)} s. ${verdict}`;
    };
    const testBtn = el('button', { class: 'btn sm', text: 'Test connection', onclick: () => test(testBtn) });
    return group('online', 'Online', 'Playing with friends connects your browsers straight to each other. On most home networks the public STUN servers built in are all that takes. A strict network (an office, a school, some mobile networks) blocks that, and then only a TURN relay gets through.', [
      el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'TURN relay' }),
        el('div', { class: 'opt-help', text: 'If friends cannot join your rooms, or you cannot join theirs, add a relay: a TURN service gives you an address, a username and a password, or you can run your own (coturn). Nothing is built in. The details stay in this browser and go only to the relay itself.' }),
        el('div', { class: 'turn-fields' }, [
          el('label', { class: 'field' }, [el('span', { text: 'Address' }), urlIn]),
          el('label', { class: 'field' }, [el('span', { text: 'Username' }), userIn]),
          el('label', { class: 'field' }, [el('span', { text: 'Password' }), passIn]),
        ]),
        el('div', { class: 'row wrap', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn sm primary', text: 'Save relay', onclick: save }),
          testBtn,
          have.urls ? el('button', { class: 'btn sm ghost', text: 'Remove', onclick: () => {
            urlIn.value = ''; userIn.value = ''; passIn.value = ''; save(); renderOptions();
          } }) : null,
        ].filter(Boolean)),
        result,
      ])),
    ]);
  }

  /* ================= net wiring ================= */
  function wireNet() {
    // how each connection is doing, kept current wherever it is shown
    net.on('rtt', () => { updateRttPills(); App.paintNetChip(); if (net.isClient && !net.rejoining) setNetBadge(); });
    net.on('peer:join', () => setNetBadge());
    net.on('peer:leave', (peerId) => {
      setNetBadge();
      updateRttPills(); App.paintNetChip();
      const sess = App.session;
      if (!sess) return;
      if (sess._enc) sess._enc.delete(peerId);
      if (sess.watchers) sess.watchers.delete(peerId);
      const r = sess.seatByPeer(peerId);
      if (r) {
        if (sess.game) { const p = sess.game.player(r.id); if (p) { sess.game.setConnected(p.id, false); sess.pushState(); } }
        else { sess.roster = sess.roster.filter(x => x !== r); sess.broadcastLobby(); renderLobbySoon(); }
      }
    });
    net.on('hello', (peerId, payload) => {
      const sess = App.session;
      if (!sess) { net.send(peerId, { t: 'error', payload: 'The host is not in a lobby.' }); return; }
      const seat = sess.addRemote(peerId, (payload && payload.name) || 'Player', payload && payload.token);
      // kept with the seat, because the game they are for may not exist yet
      if (payload && payload.autoPass && seat) seat.autoPass = payload.autoPass;
      if (payload && payload.autoPass && seat && sess.game) sess.game.setAutoPass(seat.id, payload.autoPass);
      sess.broadcastLobby();
      // someone returning mid-game needs the whole picture, not the lobby
      if (seat && sess.game) sess.pushState();
    });
    net.on('need:sync', () => { if (App.session) App.session.broadcastLobby(); });
    net.on('intent', async (peerId, payload) => {
      const sess = App.session;
      if (!sess) return;
      const r = peerId === 'host' ? sess.seat('me') : sess.seatByPeer(peerId);
      if (!r) return;
      if (payload.kind === 'setDeck') {
        try {
          r.deck = await fatDeckFromWire(payload.deck);
          r.art = (payload.deck && payload.deck.art) || null;
          r.deckValid = MTG.formats.validate(r.deck, sess.fmt);
          if (payload.name) r.name = payload.name;
          sess.broadcastLobby();
          renderLobbySoon();
        } catch (e) { net.send(peerId, { t: 'error', payload: 'Your deck could not be loaded: ' + e.message }); }
        return;
      }
      sess.handleIntent(r.id, payload);
    });
    net.on('lobby', (payload) => renderClientLobbyData(payload));
    const showView = (view) => {
      const myId = view.you || findMe(view);
      const game = view.game || (view.config ? view.config.seed : null);
      // a new game in the match is a new table: nothing on the old one carries over
      if (App.screen !== 'table' || !App.table || App.table.meId !== myId || App.table._game !== game) {
        showScreen('table');
        if (App.table) App.table.destroy();
        App.table = new UI.Table(screens.table, myId, (i) => net.intent(i));
        App.table._game = game;
      }
      App.lastView = view;
      App.table.update(view);
      App.paintNetChip();
    };
    net.on('state', showView);
    // every connection starts the sync again from a whole view
    net.on('open', () => { App.syncIn = new MTG.sync.Decoder(); });
    net.on('message', (from, msg) => {
      if (!msg) return;
      if (net.isClient && msg.t === 'sv') {
        const dec = App.syncIn || (App.syncIn = new MTG.sync.Decoder());
        const r = dec.decode(msg);
        if (r.resync) net.send(null, { t: 'resync' });
        if (!r.view) return;
        net.send(null, { t: 'ack', n: r.ack });
        showView(r.view);
        return;
      }
      if (net.isHost && (msg.t === 'ack' || msg.t === 'resync')) {
        const sess = App.session;
        const enc = sess && sess._enc && sess._enc.get(from);
        if (!enc) return;
        if (msg.t === 'ack') enc.ack(msg.n);
        else { enc.resync(); sess.sendViews(); }
      }
    });
    net.on('draft', (view) => {
      if (App.screen !== 'draft' || !App.draftUI) {
        showScreen('draft');
        if (App.draftUI && App.draftUI.destroy) App.draftUI.destroy();
        App.draftUI = new UI.DraftTable(screens.draft, view.you || 'me', (i) => net.intent(i));
      }
      App.draftUI.update(view);
      if (view.buildNow && !App._buildingPool) {
        App._buildingPool = true;
        UI.buildFromPool(view.pool, view.formatId || App.formatId, (deck) => {
          App._buildingPool = false;
          net.intent({ kind: 'setDeck', deck: slimDeckForWire(deck) });
        });
      }
    });
    net.on('chat', (msg) => { if (App.table) App.table.addChat(msg); });
    net.on('log', () => {});
    net.on('error', (m) => UI.error(String(m)));
    net.on('disconnected', () => { setNetBadge(); });
    net.on('rejoin:trying', (info) => {
      setNetBadge('reconnecting');
      updateRttPills(); App.paintNetChip();
      UI.toast(`Lost the host \u2014 trying again (${info.attempt})…`, 'err', 2600);
    });
    net.on('rejoin:ok', () => { setNetBadge(); updateRttPills(); App.paintNetChip(); UI.ok('Back at the table.'); });
    net.on('rejoin:failed', () => {
      setNetBadge();
      updateRttPills(); App.paintNetChip();
      UI.error('Could not get back to that table. The host may have closed it.');
    });
    net.on('kicked', (m) => { UI.error('Removed from the table: ' + m); showScreen('home'); });
  }

  function findMe(view) {
    // the client's own seat is the one whose hand is not hidden
    const mine = view.players.find(p => (p.hand || []).some(o => !o.hidden)) ||
      view.players.find(p => p.handSize === 0 && (p.hand || []).length === 0);
    return mine ? mine.id : view.players[0].id;
  }

  /* ================= misc dialogs ================= */
  function soundMenu(e) {
    UI.modal({
      title: 'Sound', width: '440px',
      content: el('div', { class: 'opt-group' }, MTG.feel.soundRows('snd-')),
    });
  }

  async function confirmLeave() {
    if (App.screen === 'home') return;
    if (!App.session && !net.online) return showScreen('home');
    if (App.session && App.session.game) return App.exitToMenu();
    if (!await UI.confirm('Leave this table and go back to the menu?')) return;
    App.leaveGame();
  }

  App.leaveGame = function (opts) {
    opts = opts || {};
    if (App.replay) { App.replay.stop(); App.replay = null; }
    if (App.session && App.session.botRunner) App.session.botRunner.stop();
    if (App.session && App.session.draftTimer) clearInterval(App.session.draftTimer);
    if (App.table) { App.table.destroy(); App.table = null; }
    App.session = null;
    if (App.draftUI && App.draftUI.destroy) App.draftUI.destroy();
    App.draftUI = null;
    if (!opts.keepSave) MTG.savedGame.clear();
    net.destroy();
    setNetBadge();
    showScreen('home');
  };

  /* ---- match play: another game with the same people and decks ---- */
  App.nextGame = async function () {
    const sess = App.session;
    if (!sess) return;
    if (!await UI.sideboardStep(sess)) return;
    sess.startGame();
  };

  App.rematch = async function () {
    const sess = App.session;
    if (!sess) return;
    sess.match = null;
    if (!await UI.sideboardStep(sess)) return;
    sess.startGame();
  };

  /* ---- replays ---- */
  App.canSaveReplay = () => !!(App.session && App.session.recorder && !net.isClient);
  App.saveReplay = function () {
    const sess = App.session;
    if (!sess || !sess.recorder) return UI.error('There is no record of this game.');
    const data = sess.recorder.toJSON();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const names = (data.meta.players || []).map(p => p.name).join('-vs-').replace(/[^\w-]+/g, '').slice(0, 40) || 'game';
    downloadText(`mtg-replay-${names}-${stamp}.json`, JSON.stringify(data));
    UI.ok('Replay saved.');
  };
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }
  /** Ask for a replay file and watch it. */
  App.openReplayFile = function () {
    const input = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      try { await App.watchReplay(await f.text()); }
      catch (e) { UI.error(e.message || String(e)); }
    });
    document.body.appendChild(input);
    input.click();
  };
  /** Play a replay on the table, with its own controls. `opts.turn` starts it at a turn. */
  App.watchReplay = async function (json, opts) {
    opts = opts || {};
    const busy = UI.busy('Opening the replay', 'Finding the cards…');
    let rp;
    try { rp = await MTG.replay.open(json); }
    finally { busy.close(); }
    if (App.session || net.online) App.leaveGame({ keepSave: true });
    showScreen('table');
    if (App.table) App.table.destroy();
    const viewer = new UI.ReplayViewer(screens.table, rp, opts);
    App.replay = viewer;
    App.table = viewer.table;
    if (opts.turn) viewer.seekTurn(opts.turn); else viewer.show();
    return viewer;
  };
  // for bug reports: MTG.replay.load(json, {turn: 7}) puts that game on the table at turn 7
  MTG.replay.load = (json, opts) => App.watchReplay(json, Object.assign({ paused: true }, opts || {}));

  App.Session = Session;
  // the pieces the test suite drives directly
  App.slimDeckForWire = slimDeckForWire;
  App.applySeatArt = applySeatArt;
  App.commanderLink = commanderLink;

  /* ================= start ================= */
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.theme = MTG.settings.theme || 'dark';
    App.boot();
  });
  if (document.readyState !== 'loading') {
    document.documentElement.dataset.theme = MTG.settings.theme || 'dark';
    setTimeout(() => { if (!$('#screen-menu')) App.boot(); }, 0);
  }
})(window.MTG);

