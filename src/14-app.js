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
    // decks saved by an older build: settled in the background, once (src/11-ui-deck.js)
    setTimeout(() => { if (MTG.decks && MTG.decks.settle) MTG.decks.settle().catch(() => {}); }, 4000);
    App.myName = MTG.settings.playerName || randomName();
    App.myId = 'me';
    MTG.applyDisplaySettings();
    buildShell();
    showScreen('home');
    wireNet();
    offerCardDb();
    registerArtCache();
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
    // the shell is up: friends, and a link the page was opened with (src/10g-ui-social.js)
    MTG.bus.emit('app:ready');
  };

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
    // a practice game's opponent, which only ever passes (src/16a-playtest.js)
    if (MTG.practice && MTG.practice.isSeat(r)) return MTG.practice.seat(g, runner, r);
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
  /* Alchemy's conjure makes a card out of nothing, by name, in the middle of
     the game, when there is no time to ask Scryfall. The names the decks
     can conjure are fetched as the game is set up, and again for what those
     can conjure in turn; the rules read them through MTG.cardLookup. */
  const conjured = new Map();
  const CONJURE_RE = /\bconjure (?:a|an|one|two|three|four|five|six|seven|eight|X|\d+) cards? named ([^,.]+?) (?:into|onto|on top)/gi;
  const conjureNames = (cards) => {
    const out = new Set();
    for (const c of cards) {
      if (!c) continue;
      const text = [c.oracle_text || ''].concat((c.card_faces || []).map(f => f.oracle_text || '')).join('\n');
      for (const m of text.matchAll(CONJURE_RE)) for (const n of m[1].split(/\s+or\s+/)) out.add(n.trim());
      // Garth One-Eye: "Choose a card name that hasn't been chosen from among Disenchant, …, and Black Lotus" — copies made by name
      for (const m of text.matchAll(/hasn'?t been chosen from among ([^.]+?)\. Create a copy of the card with the chosen name/gi))
        for (const n of m[1].split(/,\s*(?:and\s+)?|\s+and\s+/)) if (n.trim()) out.add(n.trim());
      /* Meld (CR 701.42): Gisela, the Broken Blade melds with Bruna into Brisela, Voice of Nightmares, a
         card no deck holds, so it is fetched alongside (the game keeps it: Game._meldCard) */
      for (const p of c.all_parts || []) if (p && p.component === 'meld_result' && p.name && p.name !== c.name) out.add(p.name);
    }
    return [...out].filter(n => n && !conjured.has(U.normName(n)));
  };
  async function prefetchConjured(cards) {
    let names = conjureNames(cards);
    for (let depth = 0; names.length && depth < 3; depth++) {
      let got = [];
      try { got = ((await MTG.scry.collection(names.map(name => ({ name })))).cards || []).filter(Boolean); } catch (e) { got = []; }
      for (const c of got) conjured.set(U.normName(c.name), c);
      names = conjureNames(got);
    }
    if (conjured.size && !MTG.cardLookup) MTG.cardLookup = (name) => conjured.get(U.normName(name)) || null;
  }

  /** A seat's profile picture (a data URL), or null: yours from the settings, the others' as they sent them. */
  App.avatarFor = function (pid) {
    const sess = App.session;
    if (sess) {
      const r = sess.roster.find(x => x.id === pid);
      if (!r) return null;
      return r.kind === 'local' ? (MTG.settings.avatar || null) : (r.avatar || null);
    }
    const m = (App.lobbyMembers || []).find(x => x.id === pid);
    return m && UI.isAvatar(m.avatar) ? m.avatar : null;
  };
  /**
   * A seat's sleeve, as UI.applySleeve draws it: yours from the Store, the
   * others' as they sent them, and for a bot one of the woven ones, chosen
   * by its name so it keeps it from game to game.
   */
  App.sleeveFor = function (pid) {
    const sess = App.session;
    const members = sess ? sess.roster : (App.lobbyMembers || []);
    const r = members.find(x => x.id === pid);
    if (!r) return null;
    /* yours: the seat that is local to this table, or, for a guest (no
       table of its own), the seat that is you. The host's own seat comes to
       a guest marked local too, as the host sees it, and is the host's. */
    if (sess ? r.kind === 'local' : pid === (App.clientYou || null)) return MTG.economy.sleeveWorn();
    if (r.kind === 'bot') {
      const pats = MTG.economy.SLEEVES.filter(x => x.kind === 'pattern');
      let h = 0; for (const ch of String(r.name || pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const sl = pats[h % pats.length];
      return { id: sl.id, kind: 'pattern', css: sl.css, rim: sl.rim };
    }
    return withGif(App.cleanSleeve(r.sleeve), r);
  };
  /**
   * A sleeve another player sent, kept only if it is one this app draws:
   * a woven one by its name, art from Scryfall, or a small picture.
   */
  App.cleanSleeve = function (sl) {
    if (!sl || typeof sl !== 'object') return null;
    const known = MTG.economy.sleeveById(sl.id);
    if (sl.kind === 'pattern' && known && known.kind === 'pattern') return { id: known.id, kind: 'pattern', css: known.css, rim: known.rim };
    if (sl.kind === 'art' && known && typeof sl.art === 'string' && /^https:\/\/cards\.scryfall\.io\//.test(sl.art)) return { id: known.id, kind: 'art', art: sl.art, rim: known.rim };
    if (sl.kind === 'custom' && typeof sl.img === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(sl.img) && sl.img.length <= 100000) {
      const out = { id: 'custom', kind: 'custom', img: sl.img, rim: '#f1d58a' };
      // a GIF behind it: its name, and where to look in it
      const ref = sl.ref, c = ref && ref.crop;
      const frac = (n, lo) => typeof n === 'number' && n >= lo && n <= 1;
      if (ref && typeof ref.h === 'string' && GIF_HASH.test(ref.h) && c && frac(c.x, 0) && frac(c.y, 0) && frac(c.w, 0.001) && frac(c.h, 0.001))
        out.ref = { h: ref.h, crop: { x: c.x, y: c.y, w: c.w, h: c.h } };
      return out;
    }
    return null;
  };

  /* ---- moving sleeves at a table ----
     A sleeve that is a GIF travels as a reference: its name (a hash of the
     file) and where to look in it. The GIF itself is asked for once, by
     whoever does not have it, through the host, which passes it on to
     anyone else who wants it; it comes in pieces a little apart, so the
     game's own messages are not held up behind it, and it is checked
     against its name before it is used. It is kept in memory for the
     match and let go when the table is left. Until it is in, the still is
     shown. */
  const GIF_HASH = /^[0-9a-f]{32}$/;
  const GIF_PART = 48000;                        // base64 characters a message
  const GIF_PARTS_MAX = Math.ceil(5.6e6 / GIF_PART);
  const gifs = {
    have: new Map(),       // name -> blob URL
    data: new Map(),       // host: name -> base64, to pass on
    asked: new Set(),      // names asked for
    waiting: new Map(),    // host: name -> who else wants it
    parts: new Map(),      // name -> pieces so far
    clear() {
      for (const u of this.have.values()) URL.revokeObjectURL(u);
      this.have.clear(); this.data.clear(); this.asked.clear(); this.waiting.clear(); this.parts.clear();
    },
  };
  /** A seat's sleeve with its GIF, once it is here; asked for when it is not. */
  function withGif(sl, seat) {
    if (!sl || !sl.ref) return sl;
    const url = gifs.have.get(sl.ref.h);
    if (url) return Object.assign({}, sl, { anim: url, crop: sl.ref.crop });
    askGif(sl.ref.h);
    return sl;
  }
  /** The remote seat whose sleeve is this GIF (the host asks its owner). */
  function gifOwner(h) {
    const sess = App.session;
    return sess ? sess.roster.find(r => r.kind === 'remote' && r.peerId && r.sleeve && r.sleeve.ref && r.sleeve.ref.h === h) : null;
  }
  function askGif(h) {
    if (!net.online || gifs.asked.has(h) || gifs.have.has(h) || MTG.economy.ownGifHash() === h) return;
    if (net.isClient) { gifs.asked.add(h); net.send(null, { t: 'gif:want', h }); return; }
    const owner = net.isHost ? gifOwner(h) : null;
    if (owner) { gifs.asked.add(h); net.send(owner.peerId, { t: 'gif:want', h }); }
  }
  /** A GIF down one connection (to the host, from a guest), in pieces a little apart. */
  async function sendGif(to, h) {
    let p = null;
    if (MTG.economy.ownGifHash() === h) p = await MTG.economy.animPayload();
    else if (gifs.data.has(h)) p = { h, type: 'image/gif', d: gifs.data.get(h) };
    if (!p || !p.d || p.d.length > GIF_PART * GIF_PARTS_MAX) return;
    const n = Math.ceil(p.d.length / GIF_PART);
    for (let i = 0; i < n; i++) {
      if (!net.online) return;
      net.send(to, { t: 'gif:part', h, i, n, d: p.d.slice(i * GIF_PART, (i + 1) * GIF_PART) });
      await U.sleep(20);
    }
  }
  function gotGifWant(from, msg) {
    const h = msg && msg.h;
    if (typeof h !== 'string' || !GIF_HASH.test(h)) return;
    const to = net.isHost ? from : null;
    if (MTG.economy.ownGifHash() === h || gifs.data.has(h)) { sendGif(to, h); return; }
    // the host has not got it yet: from its owner first, then on
    if (net.isHost) {
      if (!gifs.waiting.has(h)) gifs.waiting.set(h, new Set());
      gifs.waiting.get(h).add(from);
      askGif(h);
    }
  }
  async function gotGifPart(from, msg) {
    const h = msg.h;
    if (typeof h !== 'string' || !GIF_HASH.test(h) || !gifs.asked.has(h) || gifs.have.has(h)) return;
    if (!(Number.isInteger(msg.n) && msg.n > 0 && msg.n <= GIF_PARTS_MAX && Number.isInteger(msg.i) && msg.i >= 0 && msg.i < msg.n) || typeof msg.d !== 'string') return;
    let buf = gifs.parts.get(h);
    if (!buf) { buf = { n: msg.n, got: 0, parts: new Array(msg.n) }; gifs.parts.set(h, buf); }
    if (buf.n !== msg.n || buf.parts[msg.i] != null) return;
    buf.parts[msg.i] = msg.d;
    if (++buf.got < buf.n) return;
    gifs.parts.delete(h);
    const d = buf.parts.join('');
    if (!/^[A-Za-z0-9+/]+=*$/.test(d)) { gifs.asked.delete(h); return; }
    let bytes;
    try { bytes = await (await fetch('data:image/gif;base64,' + d)).arrayBuffer(); } catch (e) { gifs.asked.delete(h); return; }
    // a GIF, and the one asked for
    const head = new Uint8Array(bytes, 0, Math.min(6, bytes.byteLength));
    if (String.fromCharCode(...head).slice(0, 4) !== 'GIF8' || await MTG.economy.digestHex(bytes) !== h) { gifs.asked.delete(h); return; }
    gifs.have.set(h, URL.createObjectURL(new Blob([bytes], { type: 'image/gif' })));
    if (net.isHost) {
      gifs.data.set(h, d);
      const w = gifs.waiting.get(h);
      gifs.waiting.delete(h);
      if (w) for (const p of w) sendGif(p, h);
    }
    // the table draws it at once
    if (App.table && App.table.view) App.table.render();
  }
  /** Every seat's GIF asked for as soon as it is known: in the lobby, before the match. */
  function askSeatGifs(members) {
    for (const r of members || []) {
      const sl = App.cleanSleeve(r && r.sleeve);
      if (sl && sl.ref) askGif(sl.ref.h);
    }
  }

  /** A seat's portrait frame: yours from the Store, the others' as they sent them. */
  App.frameFor = function (pid) {
    const sess = App.session;
    const members = sess ? sess.roster : (App.lobbyMembers || []);
    const r = members.find(x => x.id === pid);
    if (!r) return null;
    // yours as for the sleeve: the host's seat, marked local where it comes from, is the host's
    if (sess ? r.kind === 'local' : pid === (App.clientYou || null)) return MTG.economy.frameWorn();
    return r.frame && MTG.economy.frameById(r.frame) ? r.frame : null;
  };
  /**
   * An emote: shown by your portrait, and sent to the others online (as a
   * chat line they read as an emote). Offline, a bot may answer.
   */
  App.sendEmote = function (id) {
    const t = App.table;
    if (!t) return;
    if (net.online) { net.chat(App.myName, '::emote:' + id); return; }
    UI.showEmote(t.meId, id);
    const bot = App.session && App.session.roster.find(r => r.kind === 'bot');
    const reply = { hello: 'hello', luck: 'luck', gg: 'gg', nice: 'thanks', thanks: 'nice', oops: 'wow' }[id];
    if (bot && reply && Math.random() < 0.6) setTimeout(() => UI.showEmote(bot.id, reply), 1100 + Math.random() * 900);
  };
  /** An emote someone sent, by name: shown by their portrait. */
  App.emoteFrom = function (fromName, id) {
    const t = App.table;
    if (!t || !t.view) return;
    const p = (t.view.players || []).find(x => x.name === fromName);
    if (p) UI.showEmote(p.id, id);
  };

  /**
   * Your name, picture, sleeve or frame changed: everyone at your table is
   * told, not only those who join after. A guest sends it to the host,
   * which keeps it with the seat and passes it on; the host passes on its
   * own. Either way the table is drawn again.
   */
  App.profileChanged = function () {
    if (net.online && net.isClient) {
      net.intent({ kind: 'profile', name: App.myName, avatar: MTG.settings.avatar || null,
        sleeve: MTG.economy.sleeveWorn(), frame: MTG.economy.frameWorn() });
    } else if (App.session && App.session.broadcastLobby) App.session.broadcastLobby();
    if (App.table && App.table.view) App.table.render();
  };
  MTG.bus.on('economy:changed', (ev) => { if (ev && (ev.why === 'sleeve' || ev.why === 'frame')) App.profileChanged(); });

  /** Your name and profile picture, and telling whoever needs to know. */
  App.chooseAvatar = function (after) {
    const told = () => {
      App.profileChanged();
      /* and the screen you are on is drawn again, so the new picture is
         there at once (Profile, the Store's frames, Home); the lobby and
         Options are redrawn by whoever asked */
      if (!['table', 'draft', 'lobby', 'options'].includes(App.screen)) showScreen(App.screen);
      if (after) after();
    };
    UI.avatarPicker({
      current: MTG.settings.avatar || null,
      onSave: (data) => { MTG.setSetting('avatar', data || null); told(); },
      name: App.myName,
      onName: (name) => {
        if (!MTG.names.ok(name)) { UI.error('That name can’t be used. Pick another.'); return false; }
        App.myName = name;
        MTG.setSetting('playerName', name);
        // your seat, and the game in progress, if this browser runs it
        const sess = App.session;
        const seat = sess && sess.seat && sess.seat('me');
        if (seat) seat.name = name;
        const p = sess && sess.game && sess.game.player('me');
        if (p) { p.name = name; if (sess.pushState) sess.pushState(); }
        told();
      },
    });
  };
  App.editProfile = () => App.chooseAvatar(() => { if (App.screen === 'lobby' && App.session) renderLobby(); });

  const idList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 60) : undefined);
  /* What a person chose to pay a cost the table would otherwise pick for
     them: graveyard cards for evidence, a Food or three cards to forage,
     cards to reveal, a creature to exile or take a counter from. */
  const COST_PICK_LISTS = ['evidenceIds', 'forageExileIds', 'revealIds', 'beholdIds', 'exileIds'];
  const COST_PICK_ONES = ['forageFoodId', 'counterFromId', 'blightId'];
  const costPicksOf = (intent) => {
    const out = {};
    for (const k of COST_PICK_LISTS) if (Array.isArray(intent[k])) out[k] = idList(intent[k]);
    for (const k of COST_PICK_ONES) if (typeof intent[k] === 'string') out[k] = intent[k];
    if (typeof intent.counterKind === 'string') out.counterKind = intent.counterKind.slice(0, 40);
    return out;
  };
  /* Paid only from the mana already in the player's pool, with no lands
     tapped for them: the table asks for that when its player taps lands by
     hand (src/12c-ui-table-ask.js). A free spell's taxes are the game's to
     find, as ever. */
  const payByHand = (intent) => intent.fromPool === true && !intent.free;

  function botNameFor(deck, formatId, taken) {
    const used = new Set(taken || []);
    const tryName = (n) => {
      n = String(n || '').trim();
      if (!n) return null;
      if (!used.has(n)) return n;
      for (let i = 2; i < 9; i++) if (!used.has(`${n} ${i}`)) return `${n} ${i}`;
      return null;
    };
    const cmds = (deck.commanders || []).filter(c => !MTG.formats.isSignatureSpell(c));
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

  /** A bot's (or a nameless player's) name, in two words (MTG.botName, src/00-core.js). */
  const randomName = (taken) => MTG.botName(taken);

  /* ================= shell ================= */
  let screens = {};
  const CRUMBS = {
    home: '', formats: 'Play', decks: 'Deck builder', options: 'Options', store: 'Store', collection: 'Collection', profile: 'Profile',
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
        html: `<span class="brand-mark brand-logo">${logoSvg()}</span><span class="brand-name">MTG Table</span>`,
      }),
      el('div', { class: 'crumbs', id: 'crumbs' }),
      // the four places in the app, always one click away, the way a game's
      // front end keeps its tabs along the top
      /* each with its symbol, and a picture behind the word: grey until the
         pointer is on it, or it is where you are */
      el('nav', { class: 'topnav', 'aria-label': 'Main' }, NAV.map(([id, label]) => el('button', {
        // (named for a narrow window, where the tab shows its symbol alone)
        type: 'button', class: 'topnav-btn', dataset: { nav: id }, title: label, 'aria-label': label,
        onclick: () => navTo(id),
      }, [
        decorArt(el('span', { class: 'topnav-art', 'aria-hidden': 'true' }), TILE_ART[id]),
        el('span', { class: 'topnav-ic', 'aria-hidden': 'true', html: SVG[NAV_ICON[id]] || '' }),
        el('span', { class: 'topnav-label', text: label }),
      ]))),
      el('span', { class: 'grow' }),
      UI.friendsChip ? UI.friendsChip() : null,
      UI.inboxChip(),
      UI.hoardChip(() => App.openPacks()),
      // a click on the Shards: ten thousand more, like the backquote key, and the Store to spend them in
      UI.shardChip(() => { MTG.economy.grantTest(); navTo('store'); }),
      el('div', { class: 'net-badge', id: 'netBadge' }, [el('span', { class: 'net-dot' }), el('span', { text: 'solo' })]),
      el('button', { class: 'btn sm ghost icon-btn', html: SVG.sound, title: 'Sound', 'aria-label': 'Sound', onclick: soundMenu }),
      el('button', { class: 'btn sm ghost icon-btn', html: SVG.gear, title: 'Options', 'aria-label': 'Options', onclick: () => navTo('options') }),
    ]);

    screens = {
      home: el('div', { class: 'screen', id: 'screen-home' }),
      formats: el('div', { class: 'screen', id: 'screen-formats' }),
      decks: el('div', { class: 'screen', id: 'screen-decks' }),
      options: el('div', { class: 'screen', id: 'screen-options' }),
      store: el('div', { class: 'screen', id: 'screen-store' }),
      collection: el('div', { class: 'screen', id: 'screen-collection' }),
      profile: el('div', { class: 'screen', id: 'screen-profile' }),
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
    // the menus' music, from the first click (a browser lets sound start only then)
    if (MTG.audio && MTG.audio.ambience) MTG.audio.ambience(true, 'menu');
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
    // the menus' music; a table brings its own mood when it opens
    if (name !== 'table' && MTG.audio && MTG.audio.ambience) MTG.audio.ambience(true, 'menu');
    if (name === 'home') renderHome();
    if (name === 'formats') renderFormats();
    if (name === 'decks') renderDecks();
    if (name === 'options') renderOptions();
    if (name === 'store') UI.renderStore(screens.store, { onOpenPacks: () => App.openPacks() });
    if (name === 'collection') UI.renderCollection(screens.collection);
    if (name === 'profile') UI.renderProfile(screens.profile, { onRanked: (f) => App.playRanked(f) });
    window.scrollTo && window.scrollTo(0, 0);
    MTG.bus.emit('screen', name);
  }
  App.showScreen = showScreen;

  // (Options is the gear at the right of the bar)
  const NAV = [['home', 'Home'], ['formats', 'Play'], ['decks', 'Decks'], ['collection', 'Collection'], ['store', 'Store'], ['profile', 'Profile']];
  const NAV_ICON = { home: 'home', formats: 'play', decks: 'deck', collection: 'cards', store: 'shard', profile: 'user' };
  App.navTo = (n) => navTo(n);
  /** The Profile screen, on one of its tabs. */
  function navProfile(tab) {
    showScreen('profile');
    const b = document.querySelector(`#screen-profile .store-tab[data-tab="${tab}"]`);
    if (b) b.click();
  }

  /**
   * A ranked game: your deck for the format, against a bot as strong as
   * your tier. The result moves you on the ladder (src/10e-progress.js).
   */
  App.playRanked = function (formatId) {
    // a ladder for each, climbed on its own: Standard, Modern, Pauper, and Commander one against one
    const ladder = MTG.progress.LADDERS.some(L => L.id === formatId) ? formatId : 'standard';
    const tier = MTG.progress.ladder(ladder).tier;
    UI.pickDeck(ladder, async (deck) => {
      if (!deck) return;
      if (!await App.collectionAllows(deck)) return;
      App.quickGame({ formatId: ladder, deck, difficulty: MTG.progress.RANK_DIFFICULTY[tier] || 5, opponents: 1, mode: { ranked: true, ladder } });
    });
  };

  /** Open every pack in the inventory, then show the Store or Collection again with the new totals. */
  App.openPacks = function () {
    UI.openPacks(() => { if (App.screen === 'store' || App.screen === 'collection') showScreen(App.screen); });
  };

  /* The backquote key: ten thousand Shards, for trying the Store out. Not
     while typing, and not with a modifier held. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    MTG.economy.grantTest();
  });

  /* The menus' sounds, in one place: a tick for any button, a switch
     thrown up or down, a soft touch on hovering the big things. The table
     and the pack opening make their own. */
  const ownSounds = (n) => !!(n && n.closest && n.closest('.arena, .pack-open, #screen-table, #screen-draft'));
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, [role="tab"], .seg-btn, summary');
    if (!b || b.disabled || ownSounds(b)) return;
    if (b.classList.contains('primary')) MTG.sfx('confirm'); else MTG.sfx('click');
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || ownSounds(t)) return;
    if (t.type === 'checkbox') MTG.sfx('toggle', { on: !!t.checked });
    else if (t.tagName === 'SELECT') MTG.sfx('click');
  }, true);
  document.addEventListener('pointerover', (e) => {
    const n = e.target && e.target.closest && e.target.closest('.topnav-btn, .hero-btn, .store-card, .home-tile, .deck-entry, .col-card');
    if (!n || ownSounds(n) || n === App._hovered) return;
    App._hovered = n;
    MTG.sfx('hover');
  }, true);
  document.addEventListener('pointerout', (e) => { if (App._hovered && !App._hovered.contains(e.relatedTarget)) App._hovered = null; }, true);

  /* ---------------- your profile, backed up ----------------
     Everything this browser keeps for you (collection, Shards, packs,
     wildcards, sleeves, decks, cubes, settings, your name and picture) in
     one file, and back again. Caches of card data and art are left out:
     they are fetched again as needed. */
  const BACKUP_SKIP = /^mtgtable\.(?:packart|cardDb\.|clientToken|autoWarned|savedGame|artCache\.|storage\.)/;
  /** Everything this browser keeps for you, as the backup file holds it (and as another device is sent it). */
  App.profileDoc = function () {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mtgtable.') || BACKUP_SKIP.test(k)) continue;
      data[k] = localStorage.getItem(k);
    }
    return { app: 'mtg-table', kind: 'profile', v: 1, at: new Date().toISOString(), data };
  };
  App.exportProfile = function () {
    const blob = new Blob([JSON.stringify(App.profileDoc(), null, 0)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `mtg-table-profile-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    MTG.sfx('confirm');
    UI.ok('Profile saved to a file. Keep it somewhere safe.');
  };
  App.importProfile = function () {
    const file = el('input', { type: 'file', accept: '.json,application/json', class: 'sr-only' });
    document.body.appendChild(file);
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.remove();
      if (!f) return;
      let doc = null;
      try { doc = JSON.parse(await f.text()); } catch (e) { return UI.error('That file is not a profile backup.'); }
      App.loadProfileDoc(doc);
    });
    file.click();
  };
  /**
   * Replace what this browser keeps with a backup (read from a file, or
   * sent from another device), once the person has said yes, and start
   * again with it. `opts.from` says where it came from, for the question;
   * `opts.before` runs once it is written, before the page reloads.
   * Resolves whether it was loaded.
   */
  App.loadProfileDoc = async function (doc, opts) {
    opts = opts || {};
    if (!doc || doc.app !== 'mtg-table' || doc.kind !== 'profile' || !doc.data || typeof doc.data !== 'object') { UI.error('That file is not an MTG Table profile backup.'); return false; }
    const keys = Object.keys(doc.data).filter(k => k.startsWith('mtgtable.') && !BACKUP_SKIP.test(k) && typeof doc.data[k] === 'string');
    const eco = (() => { try { return JSON.parse(doc.data['mtgtable.economy'] || 'null'); } catch (e) { return null; } })();
    const what = eco ? `${(eco.shards || 0).toLocaleString()} Shards, ${Object.keys(eco.col || {}).length} different cards, ${(eco.packs || []).length} packs` : 'its settings and decks';
    if (!await UI.confirm(`Load this profile ${opts.from || 'from ' + (String(doc.at || '').slice(0, 10) || 'a backup')} (${what})? It replaces what this browser has now.`, 'Load a profile')) return false;
    // anything still running (the friends line) stops writing first, so nothing old lands on top
    MTG.bus.emit('profile:replacing');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mtgtable.') && !BACKUP_SKIP.test(k)) localStorage.removeItem(k);
    }
    for (const k of keys) { try { localStorage.setItem(k, doc.data[k]); } catch (e) { /* full */ } }
    if (opts.before) { try { await opts.before(); } catch (e) { /* the save is in; the reload still happens */ } }
    UI.ok('Profile loaded. Starting again with it…');
    setTimeout(() => location.reload(), 700);
    return true;
  };

  /* ---------------- events: a draft, the gauntlet, challenges ----------------
     Three ways to play for prizes, beside ranked:
       a draft event: pay to enter, draft with seven bots, then play the pod
         one at a time, best of one, until seven wins or three losses;
       the gauntlet: pay to enter, your deck against five bots in a row, each
         stronger, a loss ends it;
       challenges: a board set up for you, to win this turn, paid once.
     The run lives on the session (sess.mode); prizes go to the inbox. */
  const EVENT = {
    draft: { entry: 5000, wins: 7, losses: 3,
      prizes: [{ pack: 1 }, { pack: 1, shards: 1000 }, { pack: 2 }, { pack: 2, shards: 2500 }, { pack: 3, shards: 2500 }, { pack: 3, shards: 5000 }, { pack: 4, shards: 7500 }, { pack: 5, shards: 12500 }] },
    gauntlet: { entry: 2500, rounds: 5, difficulty: [2, 4, 6, 8, 10],
      prizes: [{ shards: 500 }, { shards: 1500 }, { shards: 3000 }, { shards: 5000, pack: 1 }, { shards: 7500, pack: 2 }, { shards: 12500, pack: 3 }] },
  };
  App.EVENTS = EVENT;

  /** Enter a draft event: the entry paid, then a draft of the newest set with seven bots. */
  App.startDraftEvent = async function () {
    const E = MTG.economy;
    const ev = EVENT.draft;
    const sets = await MTG.scry.draftableSets().catch(() => []);
    const set = sets[0];
    if (!set) return UI.error('No set could be found to draft. Check the connection.');
    if (E.shards() < ev.entry) { MTG.sfx('reject'); return UI.error(`A draft event costs ${ev.entry.toLocaleString()} Shards to enter; you have ${E.shards().toLocaleString()}.`); }
    if (!await UI.confirm(`Enter a ${set.name} draft event for ${ev.entry.toLocaleString()} Shards? Draft with seven bots, keep every card you take, then play until ${ev.wins} wins or ${ev.losses} losses. The more you win, the bigger the prize.`, 'Draft event')) return;
    E.spend(ev.entry, 'event');
    MTG.sfx('purchase');
    App.quickGame({ formatId: 'booster', opponents: 7, setCode: set.code, difficulty: 6, mode: { event: 'draft', set: { code: set.code, name: set.name }, wins: 0, losses: 0, idx: 0, done: false } });
  };

  /** Enter the gauntlet: your deck, five bots in a row. */
  App.startGauntlet = function (formatId) {
    formatId = formatId || 'standard';
    const E = MTG.economy;
    const ev = EVENT.gauntlet;
    if (E.shards() < ev.entry) { MTG.sfx('reject'); return UI.error(`The gauntlet costs ${ev.entry.toLocaleString()} Shards to enter; you have ${E.shards().toLocaleString()}.`); }
    UI.pickDeck(formatId, async (deck) => {
      if (!deck) return;
      if (!await App.collectionAllows(deck)) return;
      if (!await UI.confirm(`Run the gauntlet with ${deck.name || 'this deck'} for ${ev.entry.toLocaleString()} Shards? Five bots in a row, each stronger than the last; one loss ends the run.`, 'The gauntlet')) return;
      E.spend(ev.entry, 'event');
      MTG.sfx('purchase');
      App.quickGame({ formatId, deck, difficulty: ev.difficulty[0], opponents: 1, mode: { gauntlet: true, formatId, wins: 0, done: false } });
    });
  };

  /** A finished game, from the table: an event's record moves on, a challenge is solved. */
  App.onGameRecorded = function (won) {
    const sess = App.session;
    const bot = sess && sess.roster && sess.roster.find(r => r.kind === 'bot');
    if (bot && !net.online && Math.random() < 0.6) setTimeout(() => UI.showEmote(bot.id, 'gg'), 2200);
    const m = sess && sess.mode;
    if (!m) return;
    if (m.event === 'draft') {
      if (won) m.wins++; else m.losses++;
      if (m.wins >= EVENT.draft.wins || m.losses >= EVENT.draft.losses) finishEvent(sess);
    } else if (m.gauntlet) {
      if (won) m.wins++;
      if (!won || m.wins >= EVENT.gauntlet.rounds) finishEvent(sess);
    } else if (m.challenge) {
      if (won) challengeSolved(m.challenge);
    }
  };
  function finishEvent(sess) {
    const m = sess.mode;
    if (m.done) return;
    m.done = true;
    const P = MTG.progress;
    if (m.event === 'draft') {
      const prize = EVENT.draft.prizes[Math.min(m.wins, EVENT.draft.prizes.length - 1)];
      P.mail(`Draft event: ${m.wins}–${m.losses}`, `${m.set.name} draft event. ${m.wins >= 7 ? 'A perfect run!' : 'Well played.'}`, Object.assign({}, prize), 'event');
      if (m.wins >= 7) P.state.stats.draftPerfect++;
    } else {
      const prize = EVENT.gauntlet.prizes[Math.min(m.wins, EVENT.gauntlet.prizes.length - 1)];
      P.mail(`Gauntlet: ${m.wins} of ${EVENT.gauntlet.rounds}`, m.wins >= EVENT.gauntlet.rounds ? 'You ran the whole gauntlet!' : 'The run is over. Well played.', Object.assign({}, prize), 'event');
      if (m.wins >= EVENT.gauntlet.rounds) P.state.stats.gauntlets++;
    }
    P.checkAchievements();
  }

  /**
   * What the result screen offers in an event: the record, and the next
   * match or the prize. Null outside an event.
   */
  App.eventInfo = function () {
    const sess = App.session;
    const m = sess && sess.mode;
    if (!m || !(m.event || m.gauntlet || m.challenge)) return null;
    if (m.event === 'draft') {
      return { line: `Draft event: ${m.wins}–${m.losses}` + (m.done ? ' · finished' : ` · ${EVENT.draft.wins - m.wins} more wins for the top prize`),
        next: m.done ? { label: 'Collect your prize', fn: () => { App.leaveGame(); setTimeout(() => UI.openInbox(), 300); } }
          : { label: `Next match (${m.wins}–${m.losses})`, fn: () => App.nextEventMatch() } };
    }
    if (m.gauntlet) {
      return { line: `Gauntlet: ${m.wins} of ${EVENT.gauntlet.rounds}` + (m.done ? ' · finished' : ''),
        next: m.done ? { label: 'Collect your prize', fn: () => { App.leaveGame(); setTimeout(() => UI.openInbox(), 300); } }
          : { label: `Next opponent (${m.wins + 1} of ${EVENT.gauntlet.rounds})`, fn: () => App.nextEventMatch() } };
    }
    const def = CHALLENGES.find(c => c.id === m.challenge);
    const solved = !!(MTG.progress.state.puzzles || {})[m.challenge];
    return { line: def ? `Challenge: ${def.title}` + (solved ? ' · solved' : '') : 'Challenge',
      next: { label: solved ? 'More challenges' : 'Try again', fn: () => { if (solved) { App.leaveGame(); setTimeout(() => App.openChallenges(), 300); } else App.startChallenge(m.challenge); } } };
  };

  /** The next match of an event: another bot from the pod, or the next, stronger one. */
  App.nextEventMatch = function () {
    const sess = App.session;
    const m = sess && sess.mode;
    if (!m || m.done) return;
    const me = sess.seat('me');
    if (m.event === 'draft') {
      m.idx = (m.idx + 1) % m.pod.length;
      sess.roster = [me, m.pod[m.idx]];
    } else if (m.gauntlet) {
      sess.roster = [me];
      sess.addBot(EVENT.gauntlet.difficulty[Math.min(m.wins, EVENT.gauntlet.difficulty.length - 1)]);
    }
    sess.match = null;
    sess.startGame();
  };

  /* ---- challenges: a board set up to win this turn ---- */
  const CHALLENGES = [
    { id: 'burn', title: 'Burn Out', text: 'They are at 8. Three burn spells, three Mountains.', reward: 2500,
      oppLife: 8, mine: { battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Lightning Bolt', 'Lightning Bolt', 'Lava Spike'] }, theirs: { battlefield: [] } },
    { id: 'air', title: 'Air Superiority', text: 'They are at 7 with two Bears on the ground. You have an Angel and a trick.', reward: 3000,
      oppLife: 7, mine: { battlefield: ['Serra Angel', 'Forest'], hand: ['Giant Growth'] }, theirs: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } },
    { id: 'wall', title: 'Over the Wall', text: 'They are at 10 behind a Wall of Stone. Three Bears and an Overrun.', reward: 3500,
      oppLife: 10, mine: { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Overrun'] }, theirs: { battlefield: ['Wall of Stone'] } },
    { id: 'borrow', title: 'Borrowed Muscle', text: 'They are at 6 with a Colossal Dreadmaw. It could be yours for a turn.', reward: 4000,
      oppLife: 6, mine: { battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'], hand: ['Act of Treason', 'Fling'] }, theirs: { battlefield: ['Colossal Dreadmaw', 'Grizzly Bears'] } },
    { id: 'skies', title: 'Clear Skies', text: 'They are at 5, and an Air Elemental guards the skies against your dragon.', reward: 4000,
      oppLife: 5, mine: { battlefield: ['Shivan Dragon', 'Island', 'Mountain', 'Mountain', 'Mountain'], hand: ['Unsummon'] }, theirs: { battlefield: ['Air Elemental'] } },
    { id: 'hoof', title: 'Stampede', text: 'They are at 20 with nothing on the board. You have elves, bears, eight Forests and something big.', reward: 5000,
      oppLife: 20, mine: { battlefield: ['Llanowar Elves', 'Llanowar Elves', 'Llanowar Elves', 'Grizzly Bears', 'Grizzly Bears', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Craterhoof Behemoth'] }, theirs: { battlefield: [] } },
  ];
  App.CHALLENGES = CHALLENGES;

  /** The list of challenges, solved and not. */
  App.openChallenges = function () {
    const P = MTG.progress;
    const solved = P.state.puzzles || {};
    const list = el('div', { class: 'challenge-list' }, CHALLENGES.map(c => el('div', { class: 'challenge' + (solved[c.id] ? ' solved' : '') }, [
      el('div', { class: 'ch-badge', text: solved[c.id] ? '✓' : '?' }),
      el('div', { class: 'ch-text' }, [el('b', { text: c.title }), el('span', { class: 'dim', text: c.text }), UI.rewardChips(solved[c.id] ? {} : { shards: c.reward })]),
      el('button', { type: 'button', class: 'btn' + (solved[c.id] ? '' : ' primary'), text: solved[c.id] ? 'Play again' : 'Play', onclick: () => { m.close(); App.startChallenge(c.id); } }),
    ])));
    const m = UI.modal({ title: 'Challenges', content: el('div', {}, [el('p', { class: 'dim', text: 'Win this turn. Each pays once, the first time you solve it.' }), list]), className: 'challenge-modal' });
    m.button('Close', (mm) => mm.close(), 'ghost');
  };

  /** Play a challenge: the board set up, your turn, your main phase. */
  App.startChallenge = async function (id) {
    const def = CHALLENGES.find(c => c.id === id);
    if (!def) return;
    const busy = UI.busy('Challenge', 'Setting up the board…');
    const names = [...new Set([].concat(def.mine.battlefield, def.mine.hand, def.theirs.battlefield, ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']))];
    let byName;
    try {
      const res = await MTG.scry.collection(names.map(n => ({ name: n })));
      byName = new Map(names.map((n, i) => [n, (res.cards || [])[i]]));
      if (names.some(n => !byName.get(n))) throw new Error('Some cards could not be loaded. Check the connection.');
    } catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    if (App.table) { App.table.destroy(); App.table = null; }
    App.formatId = 'standard';
    const sess = App.session = new Session('standard');
    sess.mode = { challenge: id };
    sess.addLocalHost(App.myName);
    // an opponent of its own, seated straight away (no deck to build: its library is basics)
    const bot = { id: MTG.uid('bot'), kind: 'bot', name: 'The Challenger', difficulty: 6, personality: '', deck: null };
    sess.roster.push(bot);
    // libraries of basics, so nobody decks out; the board is built after the start
    const filler = (n) => ({ name: 'Basics', format: 'standard', main: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(b => ({ card: byName.get(b), qty: n })), sideboard: [], commanders: [] });
    sess.seat('me').deck = filler(8);
    bot.deck = filler(8);
    sess.onStarted = (g) => setupChallenge(g, def, byName);
    sess.startGame();
  };

  /** The board, built: hands kept empty, on to your main phase, the cards put down. */
  function setupChallenge(g, def, byName) {
    const R = MTG.rules;
    const me = 'me';
    const opp = g.players.find(p => p.id !== me).id;
    for (const p of g.players) { try { g.keepHand(p.id, []); } catch (e) { /* kept already */ } }
    for (const p of g.players) {
      const z = g.zones[p.id];
      while (z.hand.length) { const o = z.hand.pop(); o.zone = 'library'; z.library.push(o); }
    }
    // on to your first main phase, with nothing in anybody's way
    for (let guard = 0; guard < 400; guard++) {
      if (g.over) break;
      if (g.activePlayer && g.activePlayer.id === me && g.step === 'main' && g.phase && g.phase.id === 'precombat' && !g.stack.length && !g.pendingChoice) break;
      if (g.pendingChoice) { try { g.resolveChoice(g.pendingChoice.playerId, {}); } catch (e) { break; } continue; }
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    // whatever was drawn on the way goes back: the board is exactly the puzzle
    for (const p of g.players) {
      const z = g.zones[p.id];
      while (z.hand.length) { const o = z.hand.pop(); o.zone = 'library'; z.library.push(o); }
    }
    const put = (pid, name, zone) => {
      const o = g._register(new R.GObj(byName.get(name), pid, zone));
      if (zone === 'battlefield') {
        o.zone = 'battlefield'; o.controller = pid; o.entered = g.turn - 1; o.summoningSick = false;
        if (g._stampNew) o.ts = g._stampNew();
        g.battlefield.push(o);
      } else g.zones[pid][zone].push(o);
      return o;
    };
    for (const n of def.mine.battlefield) put(me, n, 'battlefield');
    for (const n of def.mine.hand) put(me, n, 'hand');
    for (const n of def.theirs.battlefield) put(opp, n, 'battlefield');
    g.player(opp).life = def.oppLife;
    if (g.bumpBoard) g.bumpBoard();
    // the turn passing without a win is the end of the attempt
    g.on('event', (e) => {
      if (e.type !== 'turn' || g.over) return;
      if (e.player && e.player !== me) setTimeout(() => challengeFailed(def), 300);
    });
  }
  function challengeFailed(def) {
    const sess = App.session;
    if (!sess || !sess.mode || sess.mode.challenge !== def.id) return;
    MTG.sfx('lose');
    const m = UI.modal({ title: 'Not this time', content: el('p', { text: `Your turn ended and they are still standing. ${def.text}` }) });
    m.button('Back', () => { m.close(); App.leaveGame(); setTimeout(() => App.openChallenges(), 300); }, 'ghost');
    m.button('Try again', () => { m.close(); App.startChallenge(def.id); }, 'primary');
  }
  function challengeSolved(id) {
    const P = MTG.progress;
    const def = CHALLENGES.find(c => c.id === id);
    P.state.puzzles = P.state.puzzles || {};
    if (P.state.puzzles[id]) return;
    P.state.puzzles[id] = Date.now();
    P.mail(`Challenge solved: ${def.title}`, 'Well played.', { shards: def.reward, xp: 250 }, 'event');
    P.checkAchievements();
  }

  /** A deck that is played: whether the collection holds it (starter decks always may be played). */
  App.collectionAllows = async function (deck) {
    if (!deck || deck.starter || deck.source === 'starter' || deck.source === 'bot') return true;
    return UI.checkCollection(deck);
  };
  /** The cards of a draft, kept: Arena lets you keep what you drafted. `word` says how they came: drafted, opened. */
  App.keepDrafted = function (pool, word) {
    const cards = (pool || []).map(x => (x && x.card) || x).filter(c => c && c.name);
    if (!cards.length) return;
    const res = MTG.economy.addCards(cards, 'draft');
    const fresh = res.filter(r => r.isNew).length;
    UI.toast(`${cards.length} ${word || 'drafted'} cards added to your collection${fresh ? ` (${fresh} new)` : ''}.`, 'ok', 5000);
  };

  /** Go to one of the top-level screens, leaving a table properly on the way. */
  async function navTo(name) {
    // a deck being built with changes not saved is let go of first, or stayed with
    if (!await UI.canLeave()) return;
    if (name !== App.screen) MTG.sfx('nav');
    if (name === 'home') return goHome();
    if (App.screen === 'table' || App.screen === 'draft') {
      // the gear at the table, say: once the game is saved and left, on to where it was going
      await App.exitToMenu();
      if (App.screen === 'home') showScreen(name);
      return;
    }
    if (App.screen === 'lobby' && (App.session || net.online)) {
      if (!await UI.confirm('Leave this table?')) return;
      App.leaveGame();
    }
    showScreen(name);
  }

  async function goHome() {
    if (!await UI.canLeave()) return;
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
    // (a game that is not kept, a tutorial's, is simply left)
    const keep = !!(g && !g.over && !net.isClient && !sess.noSave);
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
    pioneer: 'Teferi, Hero of Dominaria', legacy: 'Force of Will', vintage: 'Black Lotus',
    commander: "Atraxa, Praetors' Voice", brawl: 'Kenrith, the Returned King', oathbreaker: 'Chandra, Torch of Defiance',
    booster: 'Cogwork Librarian', picktwo: 'Fact or Fiction', chaos: 'Possibility Storm',
    cube: 'Jace, the Mind Sculptor', cmdrdraft: 'The Ur-Dragon',
    sealed: 'Booster Tutor', jumpstart: 'Inspiring Overseer',
  };
  const TILE_ART = { home: 'Command Tower', formats: 'Lightning Helix', decks: 'Demonic Tutor', options: "Sensei's Divining Top", collection: 'Mox Opal', store: 'Smothering Tithe',
    profile: 'Jace, the Mind Sculptor' };
  /* the events on the Play screen: a champion for the ladder, a seeker at
     the shelves for the draft, the arena for the run of fights, a sphinx's
     riddle for the puzzles, a mentor and pupil for the tutorials */
  const EVENT_ART = {
    'ev-ranked': "Elspeth, Sun's Champion", 'ev-draft': 'Lore Seeker', 'ev-gauntlet': 'Arena of Glory',
    'ev-challenge': 'Enigma Sphinx', 'ev-tutorials': 'Mentor of the Meek',
  };
  /* today's four on the home screen: a quest, a triumph, riches, an angel rising */
  const TODAY_ART = { 't-quests': 'Quest for the Holy Relic', 't-weekly': 'Triumph of the Hordes', 't-inbox': 'Revel in Riches', 't-rank': 'Archangel of Thune' };
  const DECOR = HERO_ART.concat(Object.values(FORMAT_ART), Object.values(TILE_ART), Object.values(EVENT_ART), Object.values(TODAY_ART));

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
      formats: [['standard', 'Standard'], ['pioneer', 'Pioneer'], ['modern', 'Modern'], ['legacy', 'Legacy'], ['vintage', 'Vintage'],
        ['pauper', 'Pauper'], ['commander', 'Commander'], ['brawl', 'Brawl'], ['oathbreaker', 'Oathbreaker']] },
    { id: 'limited', label: 'Limited', blurb: 'Draft, open sealed packs, or shuffle up half-decks',
      formats: [['booster', 'Booster'], ['picktwo', 'Pick-Two'], ['chaos', 'Chaos'], ['cube', 'Cube'], ['cmdrdraft', 'Commander'],
        ['sealed', 'Sealed'], ['jumpstart', 'Jumpstart']] },
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

  /* The home screen's strip of today's things. Claiming rewards and opening
     packs happen over the home screen without leaving it, so the strip
     redraws itself whenever either changes, on its own, leaving the rest
     of the page (and whatever is set up in the quick game) alone. */
  function todayStrip() {
    if (!MTG.progress) return null;
    const PR = MTG.progress, P = PR.state;
    const q = P.quests || [];
    const inbox = P.inbox || [];
    const reset = PR.untilReset();
    const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
    const shards = (n) => `${UI.shardIcon ? UI.shardIcon() : ''}<b>${Number(n || 0).toLocaleString()}</b>`;
    // each a painting behind it, coloured in under the pointer; what it is and how it stands on top
    const card = (cls, label, value, body, onClick, hot) => el('button', { type: 'button', class: 'today-item rich ' + cls + (hot ? ' hot' : ''), onclick: onClick }, [
      decorArt(el('span', { class: 'ti-art', 'aria-hidden': 'true' }), TODAY_ART[cls]),
      el('span', { class: 'ti-head' }, [el('span', { class: 'ti-label', text: label }), value ? el('b', { class: 'ti-value', text: value }) : null].filter(Boolean)),
      ...body.filter(Boolean),
    ]);

    // the day's quests, each with how far along it is, and what they pay
    const hours = Math.max(1, Math.ceil((new Date().setHours(24, 0, 0, 0) - Date.now()) / 3600000));
    const quests = q.length ? [
      el('span', { class: 'ti-list' }, q.map(x => {
        const n = Math.min(x.n, x.goal);
        return el('span', { class: 'ti-quest' }, [
          el('span', { class: 'tq-text', text: PR.questText(x) }),
          el('span', { class: 'tq-n', text: `${n}/${x.goal}` }),
          el('span', { class: 'tq-bar' }, [el('i', { style: { width: Math.round(n / x.goal * 100) + '%' } })]),
        ]);
      })),
      el('span', { class: 'ti-foot', html: `${shards(q.reduce((a, x) => a + (x.reward || 0), 0))}&nbsp;to earn` + (q.length < 3 ? ` · another in ${hours}h` : '') }),
    ] : [el('span', { class: 'ti-sub2', text: 'All done for today.' }), el('span', { class: 'ti-foot', text: `New quests in ${hours}h` })];

    // the week's fifteen wins, the prizes along it, and the next one
    const wins = P.weekly.wins;
    const nextW = PR.WEEKLY.find(r => r.wins > wins);
    const weekly = [
      el('span', { class: 'ti-track' }, PR.WEEKLY.map(r => el('i', {
        class: [r.wins <= wins ? 'won' : '', r.pack ? 'pk' : '', r.wc ? 'wc' : '', r.wins === 15 ? 'big' : ''].filter(Boolean).join(' '),
      }))),
      el('span', { class: 'ti-sub2', text: nextW ? `Win ${nextW.wins}: ${PR.describe(nextW)}` : 'The whole track is done. Well played.' }),
      el('span', { class: 'ti-foot', text: `Starts again in ${days(reset.week)}` }),
    ];

    // what waits in the inbox, added up; with nothing there, the login streak
    const tot = inbox.reduce((a, m) => { const r = m.reward || {}; a.shards += r.shards || 0; a.pack += r.pack || 0; a.wc += r.wc ? 1 : 0; a.xp += r.xp || 0; return a; }, { shards: 0, pack: 0, wc: 0, xp: 0 });
    const streak = (P.login && P.login.streak) || 0;
    const gift = PR.LOGIN[streak % PR.LOGIN.length];
    const rewards = inbox.length ? [
      el('span', { class: 'ti-chips', html: [
        tot.shards ? `<span>${shards(tot.shards)}</span>` : '',
        tot.pack ? `<span><b>${tot.pack}</b>&nbsp;pack${tot.pack === 1 ? '' : 's'}</span>` : '',
        tot.wc ? `<span><b>${tot.wc}</b>&nbsp;wildcard${tot.wc === 1 ? '' : 's'}</span>` : '',
        tot.xp ? `<span><b>${tot.xp.toLocaleString()}</b>&nbsp;XP</span>` : '',
      ].join('') }),
      el('span', { class: 'ti-foot', text: `Newest: ${inbox[inbox.length - 1].title}` }),
    ] : [
      el('span', { class: 'ti-sub2', text: streak ? `Day ${streak} of your login streak` : 'Earn them by playing' }),
      el('span', { class: 'ti-foot', text: `Tomorrow's login gift: ${PR.describe(typeof gift === 'number' ? { shards: gift } : gift)}` }),
    ];

    // both ladders: the symbol, the rank and its steps
    const ranked = [
      el('span', { class: 'ti-ladders' }, PR.LADDERS.map(L => {
        const r = PR.ladder(L.id);
        return el('span', { class: 'ti-ladder' }, [
          UI.rankEmblem ? UI.rankEmblem(r.tier, { size: 26, ladder: L.id }) : null,
          el('span', { class: 'tl-text' }, [
            el('span', { class: 'tl-name', text: L.name }),
            el('b', { text: PR.rankLabel(r) }),
            r.tier === 'Mythic' ? null : el('span', { class: 'tl-steps' }, Array.from({ length: PR.STEPS }, (_, i) => el('i', { class: i < r.step ? 'on' : '' }))),
          ].filter(Boolean)),
        ].filter(Boolean));
      })),
      el('span', { class: 'ti-foot', text: `Season ends in ${days(reset.season)}` }),
    ];

    return el('div', { class: 'home-today', role: 'group', 'aria-label': 'Today' }, [
      card('t-quests', 'Daily quests', q.length ? `${q.length} to do` : 'All done', quests, () => navProfile('quests')),
      card('t-weekly', 'Weekly wins', `${wins} / 15`, weekly, () => navProfile('quests')),
      card('t-inbox', 'Rewards', inbox.length ? `${inbox.length} to claim` : 'None waiting', rewards, () => UI.openInbox(), inbox.length > 0),
      card('t-rank', 'Ranked', null, ranked, () => navProfile('ranked')),
    ]);
  }
  let stripQueued = false;
  function refreshTodayStrip() {
    if (stripQueued) return;
    stripQueued = true;
    // a pile of changes at once (opening every pack) redraws it once
    setTimeout(() => {
      stripQueued = false;
      const old = document.querySelector('#screen-home .home-today');
      const fresh = old && todayStrip();
      if (fresh) old.replaceWith(fresh);
    }, 0);
  }
  if (MTG.bus) {
    MTG.bus.on('economy:changed', refreshTodayStrip);
    MTG.bus.on('progress:changed', refreshTodayStrip);
  }

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
    // no words over the painting: the quick game leads; the page keeps a heading for a screen reader
    inner.appendChild(el('h1', { class: 'sr-only', text: 'Home' }));
    /* the quick game, and beside it today's things: quests, the week,
       rewards waiting, packs to open, your rank; each goes where it says */
    const strip = todayStrip();
    inner.appendChild(el('div', { class: 'home-play-row' + (strip ? '' : ' alone') }, [quickGamePanel(), strip].filter(Boolean)));
    hero.append(inner, credit);
    page.appendChild(hero);
    /* -- the season's mastery track, round where you are on it; a click opens all of it -- */
    if (UI.masteryTrack && MTG.progress) page.appendChild(UI.masteryTrack({ window: 12, onOpen: () => navProfile('mastery') }));

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

    /* -- somebody new is offered a guided first game, until they take it or say no;
          and once it is done, the lessons after it (src/14b-lessons.js) -- */
    const offer = MTG.lessons ? MTG.lessons.firstGameCard({ art: decorArt, rerender: renderHome, icon: SVG.play }) : null;
    if (offer) notes.appendChild(offer);
    const lesson = MTG.lessons ? MTG.lessons.homeCard({ art: decorArt, rerender: renderHome }) : null;
    if (lesson) notes.appendChild(lesson);

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
    // the chosen format's painting behind the panel, kept across redraws so a change of seats does not flash it
    const art = el('div', { class: 'quick-art', 'aria-hidden': 'true' });

    const draw = () => {
      panel.innerHTML = '';
      panel.appendChild(art);
      if (art._fmt !== q.formatId) { art._fmt = q.formatId; decorArt(art, FORMAT_ART[q.formatId]); }
      q.opponents = U.clamp(q.opponents, 1, maxOpp());
      const fmt = MTG.formats.get(q.formatId);
      panel.appendChild(el('div', { class: 'quick-head' }, [
        el('h2', { id: 'quickTitle', text: 'Quick game' }),
        el('span', { class: 'quick-sub', text: quickKindOf(q.formatId).id === 'limited'
          ? ({ sealed: 'Straight to your packs. The other seats are bots.', jumpstart: 'Straight to your half-decks. The other seats are bots.' }[fmt.draft.style]
            || 'Straight to the first pack. The other seats are bots.')
          : 'Straight to the table, against bots.' }),
      ]));

      /* two columns under the heading: what to play (the kind of game and
         its format), and who against (the seats, how good they are, your
         deck); the button and what you will get beside them */
      const colA = el('div', { class: 'q-col q-what' }), colB = el('div', { class: 'q-col q-who' });
      // the format
      const kind = quickKindOf(q.formatId);
      colA.appendChild(field('Game', segmented(QUICK_KINDS.map(k => [k.id, k.label]), kind.id, (v) => {
        const next = QUICK_KINDS.find(k => k.id === v);
        if (!next || next.id === kind.id) return;
        q.lastByKind[kind.id] = q.formatId;
        q.formatId = q.lastByKind[next.id] || next.formats[0][0];
        q.deckId = ''; saveQuick(q); draw();
      }, 'Kind of game')));
      const fmtRow = segmented(kind.formats.map(([id, label]) => [id, label]), q.formatId, (v) => {
        q.formatId = v; q.lastByKind[kind.id] = v; q.deckId = ''; saveQuick(q); draw();
      }, 'Format');
      // each format a small tile with its painting, in colour when chosen or pointed at
      fmtRow.classList.add('seg-wrap', 'fmt-chips');
      [...fmtRow.children].forEach((b, i) => b.prepend(decorArt(el('span', { class: 'fmt-chip-art', 'aria-hidden': 'true' }), FORMAT_ART[kind.formats[i][0]])));
      const fmtNow = MTG.formats.get ? MTG.formats.get(q.formatId) : null;
      colA.appendChild(field('Format', fmtRow));
      if (fmtNow && fmtNow.blurb) colA.appendChild(el('p', { class: 'quick-blurb small muted', text: fmtNow.blurb }));
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
      // ten notches under the number, as many lit as the bots are good
      const meter = el('span', { class: 'diff-meter', 'aria-hidden': 'true' },
        Array.from({ length: 10 }, (x, i) => el('i', { class: i < q.difficulty ? 'on' : '' })));
      colB.appendChild(field(q.opponents > 1 ? `${q.opponents} opponents` : '1 opponent', opp));
      colB.appendChild(field('Difficulty', el('div', { class: 'diff-wrap' }, [stepper, meter])));

      // your deck: one of yours, or a fresh one in the colours you pick
      const mine = MTG.decks.forFormat(q.formatId);
      // the starter decks sit between "build me one" and your own
      const starters = MTG.starters ? MTG.starters.forFormat(q.formatId) : [];
      const isStarter = (v) => String(v || '').startsWith('starter:');
      if (q.deckId && !mine.some(d => d.id === q.deckId) &&
          !(isStarter(q.deckId) && starters.some(s => 'starter:' + s.id === q.deckId))) q.deckId = '';
      // none chosen yet, or the one chosen gone: your newest deck for the format, else its first starter
      if (!q.deckId) q.deckId = mine[0] ? mine[0].id : starters[0] ? 'starter:' + starters[0].id : '';
      const deckPick = deckPicker(q.deckId, mine, starters, fmt, (v) => { q.deckId = v; saveQuick(q); draw(); });
      // house rules of your own for this format: by the book, or one of them
      const presets = MTG.formats.presets.forFormat(q.formatId);
      if (q.preset && !presets.some(p => p.name === q.preset)) q.preset = '';
      // rules submitted for this match without a preset of their own (editRulePreset's "Submit"), for this format only
      const custom = !q.preset && q.custom && q.custom.formatId === q.formatId ? q.custom.rules : null;
      let rulesField = null;
      const canBend = MTG.formats.houseFields(q.formatId).length > 0;
      if (presets.length || canBend) {
        const parts = [];
        if (presets.length || custom) {
          const pSel = el('select', { 'aria-label': 'House rules' }, [el('option', { value: '', text: 'By the book' })]
            .concat(custom ? [el('option', { value: '\u0000custom', text: 'Unsaved rules', selected: true })] : [])
            .concat(presets.map(p => el('option', { value: p.name, text: p.name, selected: p.name === q.preset }))));
          pSel.addEventListener('change', () => {
            if (pSel.value === '\u0000custom') return;
            q.preset = pSel.value; q.custom = null; saveQuick(q); draw();
          });
          parts.push(pSel);
        }
        // the chosen set to change, or a new one; a set just written (or renamed) is the one chosen after
        if (canBend) {
          parts.push(el('button', {
            type: 'button', class: 'btn sm house-btn', html: `${SVG.gear}<span>${q.preset || custom ? 'Edit rules' : presets.length ? 'New rules' : 'Set house rules'}</span>`,
            onclick: () => {
              const pr = q.preset ? presets.find(p => p.name === q.preset) : null;
              editRulePreset(q.formatId, pr, () => {
                const now = MTG.formats.presets.forFormat(q.formatId);
                const added = now.find(p => !presets.some(o => o.name === p.name));
                if (added) { q.preset = added.name; q.custom = null; }
                saveQuick(q); draw();
              }, {
                rules: custom,
                // "Submit": these rules for the game about to be played, and no preset made of them
                onSubmit: (fid, rules) => { q.formatId = fid; q.preset = ''; q.custom = { formatId: fid, rules }; saveQuick(q); draw(); },
              });
            },
          }));
        }
        rulesField = field('House rules', el('div', { class: 'house-row' }, parts));
      }
      if (!limited) {
        colB.appendChild(field('Deck', deckPick));
      } else {
        /* A draft needs something to draft from: a set for boosters, a cube
           for a cube, and nothing at all for chaos, which picks its own. */
        const style = fmtNow && fmtNow.draft ? fmtNow.draft.style : '';
        const oneSet = style === 'booster' || style === 'commander' || style === 'sealed';
        /* Collector boosters only for a set that has them: one set's
           boosters (the newest, unless another is chosen), never chaos */
        if (oneSet) {
          const kinds = field('Boosters', segmented([['play', 'Play boosters'], ['collector', 'Collector boosters']],
            q.collector ? 'collector' : 'play', (v) => { q.collector = v === 'collector'; saveQuick(q); draw(); }, 'Kind of booster'));
          kinds.hidden = true;
          colB.appendChild(kinds);
          MTG.scry.draftableSets().then((sets) => {
            const s = q.setCode ? sets.find(x => x.code === q.setCode) : sets[0];
            const ok = !!s && MTG.economy.hasCollector(s);
            if (!ok && q.collector) { q.collector = false; saveQuick(q); }
            kinds.hidden = !ok;
          }).catch(() => {});
        } else if (q.collector) { q.collector = false; saveQuick(q); }
        // how many boosters each player opens: three at a draft and six for sealed, unless you say otherwise
        const sealed = style === 'sealed';
        const packSel = el('select', { 'aria-label': 'Packs per player' }, (sealed ? [3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6]).map(n =>
          el('option', { value: String(n), text: n === (sealed ? 6 : 3) ? `${n} (standard)` : String(n),
            selected: n === (sealed ? (q.sealedPacks || 6) : (q.packs || 3)) })));
        packSel.addEventListener('change', () => {
          if (sealed) q.sealedPacks = parseInt(packSel.value, 10) || 6; else q.packs = parseInt(packSel.value, 10) || 3;
          saveQuick(q);
        });
        const packsField = style === 'jumpstart' ? null : field('Packs each', packSel);
        // sealed opens its packs and Jumpstart has none: only a draft passes them
        const openField = sealed || style === 'jumpstart' ? null : field('Packs open', segmented([['round', 'One at a time'], ['all', 'All at once']],
          q.allAtOnce ? 'all' : 'round', (v) => { q.allAtOnce = v === 'all'; saveQuick(q); draw(); }, 'How the packs open'));
        let source = null;
        if (style === 'jumpstart') {
          source = field('Half-decks', UI.limitedRun.sourceSelect(q.jumpstart || null, (src) => { q.jumpstart = src; saveQuick(q); }));
        } else if (oneSet) {
          const setSel = el('select', { 'aria-label': sealed ? 'Set to open' : 'Set to draft' }, [el('option', { value: '', text: 'The newest set' })]);
          MTG.scry.draftableSets().then((sets) => {
            for (const st of sets.slice(0, 60)) setSel.appendChild(el('option', { value: st.code, text: st.name, selected: st.code === q.setCode }));
          }).catch(() => {});
          setSel.addEventListener('change', () => { q.setCode = setSel.value; saveQuick(q); draw(); });
          source = field('Set', setSel);
        } else if (style === 'cube') {
          const cubeSel = el('select', { 'aria-label': 'Cube to draft' }, MTG.draft.recipes.map(r =>
            el('option', { value: r.id, text: r.name, selected: r.id === q.cubeId })));
          cubeSel.addEventListener('change', () => { q.cubeId = cubeSel.value; saveQuick(q); });
          source = field('Cube', cubeSel);
        } else if (style === 'chaos') {
          source = field('Sets', chaosSetsSelect(q.chaosPool, (pool) => { q.chaosPool = pool; saveQuick(q); draw(); }));
        }
        colB.appendChild(el('div', { class: 'quick-pair' }, [source, packsField].filter(Boolean)));
        if (openField) colB.appendChild(openField);
      }
      if (rulesField) colB.appendChild(rulesField);

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
            if (!await App.collectionAllows(deck)) { go.disabled = false; return; }
          }
          App.quickGame({
            formatId: q.formatId, difficulty: q.difficulty, opponents: q.opponents,
            colors: null, deck: deck || undefined,
            setCode: q.setCode || '', cubeId: q.cubeId || 'modern', chaosPool: q.chaosPool || null,
            collector: !!q.collector, packs: fmt.draft && fmt.draft.style === 'sealed' ? (q.sealedPacks || 6) : (q.packs || 3),
            allAtOnce: !!q.allAtOnce, jumpstart: q.jumpstart || null,
            rules: q.preset ? ((presets.find(p => p.name === q.preset) || {}).rules || null) : (custom || null),
          });
        },
      });
      // what you will sit down to, as the chosen house rules have it: the life you start on, the format, the seats
      const pr = q.preset ? presets.find(p => p.name === q.preset) : null;
      const fx = pr ? MTG.formats.effective(q.formatId, pr.rules) : custom ? MTG.formats.effective(q.formatId, custom) : fmt;
      const players = q.opponents + 1;
      // nothing to play with yet: the deck picker offers to make one, and the button waits for it
      if (!limited && !q.deckId) { go.disabled = true; go.title = 'Make a deck for this format first'; }
      // the button under the choices it acts on; the summary in the painted column beside them
      colB.appendChild(el('div', { class: 'quick-play' }, [go]));
      panel.append(colA, colB, el('div', { class: 'quick-go' }, [
        el('div', { class: 'quick-summary' }, [
          el('div', { class: 'qs-seal', 'aria-hidden': 'true' }, [el('b', { text: String(MTG.formats.lifeFor(fx, players)) }), el('i', { text: 'life' })]),
          el('b', { class: 'qs-fmt', text: fx.name }),
          el('span', { class: 'qs-seats', 'aria-hidden': 'true' }, Array.from({ length: players }, (x, i) => el('i', { class: i ? 'bot' : 'you' }))),
          el('span', { class: 'quick-note', text: `${MTG.formats.lifeFor(fx, players)} life · ${players} players · ${diff.label} bots` + (pr ? ` · ${pr.name}` : '') }),
        ]),
      ]));
    };
    draw();
    return panel;
  }

  /**
   * The logo: a round table seen from above, gold-rimmed, with two cards on
   * it, one face down and one face up, and the five colours round its rim
   * in the order of the colour wheel.
   */
  function logoSvg() {
    return '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs><radialGradient id="mtgLogoTop" cx=".5" cy=".4" r=".62"><stop offset="0" stop-color="#2b3550"/><stop offset=".75" stop-color="#121722"/><stop offset="1" stop-color="#0a0d13"/></radialGradient><linearGradient id="mtgLogoGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#e2b84f"/><stop offset="1" stop-color="#8a6416"/></linearGradient><linearGradient id="mtgLogoCard" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#fbe7a6"/><stop offset=".55" stop-color="#d9a93d"/><stop offset="1" stop-color="#9a6e18"/></linearGradient></defs><circle cx="20" cy="20" r="16.4" fill="url(#mtgLogoTop)" stroke="url(#mtgLogoGold)" stroke-width="2.4"/><circle cx="20" cy="20" r="12.6" fill="none" stroke="#e2b84f" stroke-opacity=".3" stroke-width=".7"/><rect x="12.6" y="12.4" width="9.4" height="13.2" rx="1.4" fill="#3b2a10" stroke="url(#mtgLogoGold)" stroke-width="1" transform="rotate(-15 17.3 19)"/><rect x="18" y="12.6" width="9.4" height="13.2" rx="1.4" fill="url(#mtgLogoCard)" stroke="#fff3c4" stroke-width=".7" transform="rotate(12 22.7 19.2)"/><path d="M22.7 15.6l1.7 3.6-1.7 3.6-1.7-3.6z" fill="#3b2a10" transform="rotate(12 22.7 19.2)"/><g stroke="#0a0d13" stroke-width="1.1"><circle cx="20" cy="3.6" r="3" fill="#f6eed2"/><circle cx="35.6" cy="14.9" r="3" fill="#3d93db"/><circle cx="29.6" cy="33.3" r="3" fill="#4a3e52"/><circle cx="10.4" cy="33.3" r="3" fill="#e0533b"/><circle cx="4.4" cy="14.9" r="3" fill="#3aa463"/></g></svg>';
  }
  App.logoSvg = logoSvg;

  /** A starter deck's picture: its cover card's art. */
  function starterArt(node, st) {
    // the card kept with it, so its face can be found by illustration without asking again
    if (st.cover) MTG.scry.byName(st.cover).then((c) => { if (c) { node._artCard = c; UI.setArt(node, c); } }).catch(() => {});
    return node;
  }

  /**
   * The deck to play, from a list drawn with each deck's art behind its name
   * rather than the system's own menu: your decks for the format, then its
   * starter decks. With none at all, one is built for you, and it says so.
   * The list opens over the page (the panel clips what leaves it), below the
   * button or above it when there is more room there; the arrow keys move
   * along it, Escape or a click elsewhere closes it.
   */
  function deckPicker(current, mine, starters, fmt, onPick) {
    const items = [].concat(
      mine.map(d => ({ value: d.id, name: d.name, sub: 'Your deck', mine: true, art: (n) => deckArt(n, d) })),
      starters.map(s => ({ value: 'starter:' + s.id, name: s.name, sub: 'Starter deck', art: (n) => starterArt(n, s) })));
    const cur = items.find(i => i.value === current) || null;
    const face = (it) => [
      // the painting across the whole row, its face's eyes in the middle; a deck of your own looked at here if need be
      it ? UI.focusFace(it.art(el('span', { class: 'qdp-art', 'aria-hidden': 'true' })), null, { scan: it.mine }) : el('span', { class: 'qdp-art none', 'aria-hidden': 'true' }),
      el('span', { class: 'qdp-text' }, [
        el('b', { text: it ? it.name : 'Choose a deck' }),
        el('span', { text: it ? it.sub : `${fmt.name}` }),
      ]),
    ];
    // no deck at all for the format: an offer to make one, on the Decks screen
    if (!items.length) {
      return el('button', { type: 'button', class: 'deck-pick deck-pick-none', onclick: () => showScreen('decks') }, [
        el('span', { class: 'qdp-art none', 'aria-hidden': 'true' }),
        el('span', { class: 'qdp-text' }, [el('b', { text: 'Create one now' }), el('span', { text: `No ${fmt.name} decks yet` })]),
        el('span', { class: 'qdp-go', 'aria-hidden': 'true', html: SVG.arrow || '\u203a' }),
      ]);
    }
    const btn = el('button', { type: 'button', class: 'deck-pick', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': `Deck: ${cur ? cur.name : 'none chosen'}` },
      [...face(cur), el('span', { class: 'qdp-chev', 'aria-hidden': 'true' })]);
    let menu = null;
    const close = () => {
      if (!menu) return;
      menu.remove(); menu = null;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
    const outside = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
    const onScroll = (e) => { if (menu && !menu.contains(e.target)) close(); };
    const onKey = (e) => {
      if (!menu) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const opts = [...menu.querySelectorAll('.qdp-item')];
      const i = opts.indexOf(document.activeElement);
      const next = opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      if (next) next.focus();
    };
    btn.addEventListener('click', () => {
      if (menu) { close(); return; }
      const group = (title, list) => !list.length ? [] : [el('div', { class: 'qdp-group', text: title })].concat(list.map(it => el('button', {
        type: 'button', class: 'qdp-item' + (it.value === current ? ' on' : ''), role: 'option', 'aria-selected': String(it.value === current),
        onclick: () => { close(); MTG.sfx('click'); onPick(it.value); },
      }, face(it))));
      menu = el('div', { class: 'deck-menu', role: 'listbox', 'aria-label': 'Deck' },
        group('Your decks', items.filter(i => i.mine)).concat(group('Starter decks', items.filter(i => !i.mine))));
      document.body.appendChild(menu);
      const r = U.rect(btn), vh = U.viewH(), vw = U.viewW();
      const below = vh - r.bottom - 12, above = r.top - 12;
      const up = below < 260 && above > below;
      const w = Math.min(vw - 16, Math.max(r.width, 280));
      Object.assign(menu.style, { left: Math.max(8, Math.min(r.left, vw - w - 8)) + 'px', width: w + 'px',
        maxHeight: Math.max(160, Math.min(440, up ? above : below)) + 'px' });
      if (up) menu.style.bottom = (vh - r.top + 6) + 'px'; else menu.style.top = (r.bottom + 6) + 'px';
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', close);
      setTimeout(() => { const f = menu && (menu.querySelector('.qdp-item.on') || menu.querySelector('.qdp-item')); if (f) f.focus(); }, 0);
    });
    return btn;
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
    if (d.art && d.artV === MTG.decks.ART_V) { UI.setArt(node, d.art); return node; }
    MTG.decks.ensureArt(d.id).then((url) => { if (url) UI.setArt(node, url); }).catch(() => {});
    return node;
  }

  const SVG = {
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="8.5" height="12.5" rx="1.5" transform="rotate(-10 6.75 12.25)"/><rect x="8" y="4.5" width="8.5" height="12.5" rx="1.5"/><rect x="13.5" y="6" width="8.5" height="12.5" rx="1.5" transform="rotate(10 17.75 12.25)"/></svg>',
    shard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l6.5 6.2L12 21.5 5.5 8.7z"/><path d="M5.5 8.7h13M12 2.5v19"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
    deck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="11" height="15" rx="2"/><path d="M8 3h9a2 2 0 0 1 2 2v12"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10v9.5h4.5v-5h3v5H18V10"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.9-3.9 3.9-6.2 7.5-6.2s6.6 2.3 7.5 6.2"/></svg>',
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
    { id: 'limited', name: 'Limited', blurb: 'Make a deck at the table: draft it, build it from sealed packs, or shuffle two Jumpstart half-decks together.' },
  ];

  function renderFormats() {
    const s = screens.formats;
    s.innerHTML = '';
    sceneBackdrop(s);
    const inner = el('div', { class: 'menu-inner' });
    inner.appendChild(pageHeader('Play', 'Choose a format. Add bots or open a room for other people once the table is set up.', 'home'));

    /* Events: what you can play for prizes, before the formats */
    const P = MTG.progress;
    const evCard = (cls, title, text, meta, fn) => el('button', { type: 'button', class: 'event-card ' + cls, onclick: fn }, [
      EVENT_ART[cls] ? decorArt(el('div', { class: 'ev-art', 'aria-hidden': 'true' }), EVENT_ART[cls]) : null,
      el('div', { class: 'ev-glow', 'aria-hidden': 'true' }),
      el('div', { class: 'ev-body' }, [el('h3', { text: title }), el('p', { text }), el('div', { class: 'ev-meta', html: meta })]),
    ]);
    const shardHtml = (n) => `${UI.shardIcon ? UI.shardIcon() : ''}<b>${n.toLocaleString()}</b>`;
    const solved = Object.keys(P.state.puzzles || {}).length;
    inner.appendChild(el('div', { class: 'cat-head' }, [
      el('h2', { class: 'cat-title', text: 'Events & challenges' }),
      el('p', { class: 'cat-blurb', text: 'Play for prizes: they wait in your inbox.' }),
    ]));
    inner.appendChild(el('div', { class: 'event-grid' }, [
      // two ladders: the tile asks which
      evCard('ev-ranked', 'Ranked', 'Standard, Modern, Pauper and Commander, each its own ladder from Bronze to Mythic against bots that get stronger as you rise.',
        P.LADDERS.map(L => { const r = P.ladder(L.id); return `<span>${UI.rankEmblem ? UI.rankEmblem(r.tier, { size: 15, ladder: L.id }).outerHTML : ''}${L.name} · ${P.rankLabel(r)}</span>`; }).join('') +
        '<span>Free · season rewards</span>', () => UI.rankedChooser((id) => App.playRanked(id))),
      evCard('ev-draft', 'Draft event', `Draft the newest set with seven bots, keep your cards, then play until ${App.EVENTS.draft.wins} wins or ${App.EVENTS.draft.losses} losses.`,
        `<span>Entry ${shardHtml(App.EVENTS.draft.entry)}</span><span>Up to 5 packs and 12,500 Shards</span>`, () => App.startDraftEvent()),
      evCard('ev-gauntlet', 'The gauntlet', `Your deck against ${App.EVENTS.gauntlet.rounds} bots in a row, each stronger than the last. One loss ends the run.`,
        `<span>Entry ${shardHtml(App.EVENTS.gauntlet.entry)}</span><span>Up to 3 packs and 12,500 Shards</span>`, () => App.startGauntlet('standard')),
      evCard('ev-challenge', 'Challenges', 'A board set up for you: find the way to win this turn.',
        `<span>${solved} of ${App.CHALLENGES.length} solved</span>`, () => App.openChallenges()),
      // the first game and the short lessons after it (src/14b-lessons.js); right-click or hold it to hide it
      MTG.lessons ? MTG.lessons.playTile(evCard, { rerender: renderFormats }) : null,
    ].filter(Boolean)));

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
              f.draft ? el('span', { class: 'pill', text: f.draft.style === 'jumpstart' ? 'two half-decks' : `${f.draft.packs} packs` }) : null,
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
          // invites from friends wait there too (src/10g-ui-social.js)
          UI.openFriends ? el('button', { class: 'btn ghost', text: 'Friends…', onclick: () => UI.openFriends() }) : null,
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
    // the commanders most decks run first (EDHREC's rank, src/15b-themes.js); decks with no commander after them
    ['popularity', 'Popularity', (a, b) => deckRank(a) - deckRank(b) || b.updatedAt - a.updatedAt],
  ];
  const deckRank = (d) => (d.themes && d.themes.rank) || (d.commander ? 1e7 : 1e8);
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
          el('button', { class: 'btn', text: 'Create a deck', onclick: () => newDeck() }),
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
    /* sorted by popularity, a deck saved before decks knew their commander's
       rank is read in the background, and the list put in order again once */
    const unread = all.filter(d => d.commander && !(d.themes && d.themes.v === MTG.themes.VERSION));
    if (unread.length) {
      Promise.all(unread.map(d => MTG.decks.ensureThemes(d.id).then((t) => { d.themes = t; }).catch(() => {})))
        .then(() => { if (sortKey === 'popularity' && host.isConnected) draw(); });
    }

    function draw() {
      const sorter = (DECK_SORTS.find(x => x[0] === sortKey) || DECK_SORTS[0])[2];
      let list = all.filter(d => formatFilter === 'all' || d.format === formatFilter);
      if (query) {
        list = list.filter(d =>
          String(d.name).toLowerCase().includes(query) ||
          String(d.commander || '').toLowerCase().includes(query) ||
          // what a Commander deck leans on: "tokens", "lifegain"
          (d.themes && d.themes.tags || []).join(' ').toLowerCase().includes(query) ||
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
    const open = el('button', { class: 'deck-open', 'aria-label': 'Open ' + d.name, onclick: () => openDeck(d.id) });
    // a Commander deck says who leads it and what it leans on; its box previews the commander
    const cmd = UI.deckCommander(d, { art: open, plain: true, cls: 'on-art' });
    const sizeTip = legalSize ? 'A legal size' : `Not a legal size for ${fmtName(d.format)}` +
      (fmt ? ` (${fmt.exactSize ? 'exactly ' + fmt.deckMin : 'at least ' + (fmt.deckMin || 0)})` : '');
    open.append(art, el('div', { class: 'deck-face' }, [
      UI.pips(d.identity, 'deck-pips'),
      el('div', { class: 'deck-card-name', text: d.name }),
      el('div', { class: 'deck-sub' }, d.commander ? [cmd.names, ' · ' + timeAgo(d.updatedAt)]
        : (d.source === 'draft' ? 'Drafted' : fmtName(d.format)) + ' · ' + timeAgo(d.updatedAt)),
      cmd.tags,
      UI.deckAutoPill(d, 'on-art'),
      // how it has done so far (src/10h-ui-history.js)
      UI.deckRecordPill ? UI.deckRecordPill(d, 'on-art') : null,
    ].filter(Boolean)));
    return el('article', { class: 'deck-card' + (legalSize ? '' : ' needs-work') }, [
      open,
      /* the format where the line above does not name it already (a commander's
         deck, a drafted one); the buttons together at the right, and under the
         pills when a narrow box has no room for them all, never cut off */
      el('div', { class: 'deck-foot' }, [
        d.commander || d.source === 'draft' ? el('span', { class: 'pill deck-fmt', text: fmtName(d.format) }) : null,
        el('span', { class: 'pill ' + (legalSize ? 'good' : 'bad'), title: sizeTip, text: d.size + ' cards' }),
        el('span', { class: 'deck-acts' }, [
          el('button', { class: 'btn xs ghost danger-ghost', 'aria-label': 'Delete ' + d.name, title: 'Delete',
            html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
            onclick: async () => {
              if (await UI.confirm(`Delete "${d.name}"?`, 'Delete deck')) { MTG.decks.remove(d.id); renderDecks(); }
            } }),
          // a solo game against an opponent that does nothing (src/11b-ui-playtest.js)
          UI.practiceButton ? UI.practiceButton(d) : null,
          el('button', { class: 'btn xs primary', text: 'Play', title: 'Start a game with this deck',
            onclick: () => { App.formatId = d.format; startLobby('host'); setTimeout(() => usePreselectedDeck(d.id), 20); } }),
        ].filter(Boolean)),
      ].filter(Boolean)),
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
   * play, or to copy into your decks and change. Folded away until opened,
   * and left as it was while the page is open.
   */
  let startersOpen = false;
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
    const shelf = el('details', { class: 'starter-shelf' }, [
      el('summary', { class: 'cat-head' }, [
        el('div', { class: 'grow' }, [
          el('h2', { class: 'cat-title', id: 'starterTitle', text: `Starter decks \u00b7 ${MTG.starters.list.length}` }),
          el('p', { class: 'cat-blurb', text: 'Ready to play, in Standard and Modern. The game runs every card in them by itself. Copy one into your decks to change it.' }),
        ]),
        el('span', { class: 'rules-chev', 'aria-hidden': 'true' }),
      ]),
      el('div', { class: 'starter-rows' }, rows),
    ]);
    shelf.open = startersOpen;
    shelf.addEventListener('toggle', () => { startersOpen = shelf.open; });
    return shelf;
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

  /** "New Deck", or "New Deck (2)" when there is already a New Deck, and so on. */
  function untitledName() {
    const taken = new Set(MTG.decks.index().map(d => String(d.name || '').trim().toLowerCase()));
    if (!taken.has('new deck')) return 'New Deck';
    let n = 1;
    while (taken.has(`new deck (${n})`)) n++;
    return `New Deck (${n})`;
  }
  /** A deck from nothing: straight into the editor, which is where it is named. */
  function newDeck() {
    UI.deckBuilder({
      // the format last played, unless that was a draft's: a deck is never of a draft's kind
      id: MTG.uid('deck'), name: '', format: MTG.formats.isLimited(App.formatId) ? 'standard' : App.formatId,
      main: [], sideboard: [], commanders: [], companion: null,
    }, { onSave: () => renderDecks(), untitled: untitledName(), nameFirst: true });
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
  App.startCardDb = (kind) => startCardDb(kind || 'default_cards');
  function startCardDb(kind) {
    const run = MTG.cardDb.download(kind);
    cardDbProgress();
    run.then((ok) => {
      const st = MTG.cardDb.status();
      if (ok) askPersist();
      if (ok) UI.ok(`The card database is ready: ${st.cards.toLocaleString()} cards.`);
      else if (st.job && st.job.phase === 'error') UI.error(cardDbJobText(st.job));
    });
  }
  /**
   * The download's progress in a window. Hidden (or closed some other way
   * while it is still going), it goes to a strip at the foot of the screen
   * (cardDbDock), and the app is yours again while it carries on.
   */
  function cardDbProgress() {
    removeCardDbDock();
    const bar = el('div', { class: 'progress' }, el('div', { style: { width: '0%' } }));
    const text = el('p', { class: 'small muted', 'aria-live': 'polite', style: { margin: '0 0 10px' } });
    let over = false;
    const m = UI.modal({
      title: 'Downloading the card database',
      content: el('div', null, [text, bar,
        el('p', { class: 'tiny dim', style: { margin: '12px 0 0' }, text: 'Hide it and carry on using the app: its progress stays at the foot of the screen.' })]),
      buttons: [
        { label: 'Stop', onClick: () => { over = true; MTG.cardDb.cancel(); m.close(); } },
        { label: 'Hide', class: 'primary', onClick: () => m.close() },
      ],
    });
    const paint = (job) => {
      if (!job) return;
      text.textContent = cardDbJobText(job);
      bar.firstChild.style.width = Math.round(cardDbJobShare(job) * 100) + '%';
      if (/done|error|cancelled/.test(job.phase)) { over = true; off(); setTimeout(() => m.close(), job.phase === 'done' ? 700 : 0); }
    };
    const off = MTG.bus.on('carddb:progress', paint);
    m._onClose = () => { off(); if (!over) cardDbDock(); };
    paint(MTG.cardDb.job);
  }

  /* The download, hidden: a strip at the foot of the screen over whatever
     you go on to do, with how far it has got. A click on it brings the
     window back; Stop stops it. When it is done it says so and goes. */
  let dbDock = null;
  function removeCardDbDock() {
    if (!dbDock) return;
    dbDock._off();
    dbDock.remove();
    dbDock = null;
    document.documentElement.classList.remove('has-db-dock');
  }
  function cardDbDock() {
    removeCardDbDock();
    const fill = el('i');
    const text = el('span', { class: 'db-dock-text' });
    const pct = el('b', { class: 'db-dock-pct' });
    const stop = el('button', { type: 'button', class: 'btn xs db-dock-stop', text: 'Stop', title: 'Stop the download (what has come down is kept)',
      onclick: () => MTG.cardDb.cancel() });
    const d = dbDock = el('div', { class: 'db-dock', role: 'status', 'aria-live': 'polite' }, [
      el('button', { type: 'button', class: 'db-dock-main', title: 'Show the download', onclick: () => cardDbProgress() }, [
        el('span', { class: 'db-dock-title', text: 'Card database' }), text, pct,
        el('span', { class: 'db-dock-bar', 'aria-hidden': 'true' }, fill),
      ]),
      stop,
    ]);
    const paint = (job) => {
      if (!job || dbDock !== d) return;
      const share = cardDbJobShare(job);
      fill.style.width = Math.round(share * 100) + '%';
      pct.textContent = Math.round(share * 100) + '%';
      text.textContent = job.phase === 'download' ? (job.total ? `${megabytes(job.got)} of ${megabytes(job.total)}` : 'Starting…')
        : job.phase === 'unpack' ? 'Unpacking…' : job.phase === 'store' ? 'Saving…'
        : job.phase === 'done' ? 'Ready' : job.phase === 'error' ? 'It did not finish' : 'Stopped';
      if (/done|error|cancelled/.test(job.phase)) {
        d.classList.add('end', job.phase);
        stop.remove();
        setTimeout(() => { if (dbDock === d) removeCardDbDock(); }, job.phase === 'done' ? 2500 : 5000);
      }
    };
    d._off = MTG.bus.on('carddb:progress', paint);
    document.body.appendChild(d);
    document.documentElement.classList.add('has-db-dock');
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
          : 'Bots, drafts, the deck builder and card lookups use it and need no network. ' + picturesNote() }));
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
        kids.push(el('div', { class: 'opt-help', text: 'Scryfall’s card data, saved in this browser. Bots build their decks in moments instead of waiting on dozens of searches, the deck builder searches instantly, and games work without a connection. One download; ' + picturesNote().charAt(0).toLowerCase() + picturesNote().slice(1) }));
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
  /* ---- the card pictures kept on this device (sw.js) ----
     A service worker keeps each card picture, card back and mana symbol
     the first time it is seen, so after that it shows at once and costs no
     data; on a phone it keeps the pictures in a store the browser does not
     clear as readily as its own cache. It keeps the app's page too, so a
     home-screen app opens with no connection, but always asks the network
     for it first, so updates arrive as before. It handles nothing else.
     ART_CACHE_ON is the way to turn it off for everyone (the page is asked
     for afresh first, so it takes effect on the next load); Options > Card data turns
     it off on one device, and so does ?nosw in a browser with an address
     bar (?sw turns it back on). */
  const ART_CACHE_ON = true;
  const ART_PREFIX = 'mtg-table-art-', ART_NS = 'mtg-table-art-v1-';
  // "turned off on this device", for the worker to find (sw.js OFF): outside ART_PREFIX, so no sweep removes it
  const ART_OFF = 'mtg-table-sw-off';
  const artCacheSupported = () => {
    try {
      return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext &&
        /^https?:$/.test(location.protocol) && typeof caches !== 'undefined';
    } catch (e) { return false; }   // a sandboxed frame, where even reading `caches` throws
  };
  const artCacheOff = () => !ART_CACHE_ON || !!MTG.store.get('artCache.off', false);
  let artReg = null, artRegError = null;
  /** What the card database's notes say about pictures, true to whether they are kept here. */
  const picturesNote = () => (artCacheSupported() && !artCacheOff() && !artRegError
    ? 'Card pictures come from Scryfall and are kept on this device as you see them.'
    : 'Card pictures still come from Scryfall.');
  /** Tell a worker to stand down and empty what it kept; resolved when it has, or after a few seconds. */
  const retireWorker = (w) => /** @type {Promise<void>} */ (new Promise((res) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(), 3000);
    ch.port1.onmessage = () => { clearTimeout(t); res(); };
    try { w.postMessage({ type: 'retire' }, [ch.port2]); } catch (e) { clearTimeout(t); res(); }
  }));
  async function dropArtCache() {
    if (!artCacheSupported()) return;
    try {
      // first the mark a worker started again later finds: unregistering leaves it in charge of pages already open
      await caches.open(ART_OFF);
      const mine = new URL('sw.js', location.href).href;
      const regs = (await navigator.serviceWorker.getRegistrations()).filter((r) => {
        const w = r.active || r.waiting || r.installing;
        return w && w.scriptURL === mine;
      });
      // every worker of ours stops and empties its caches, the one in charge here and any serving another tab
      const workers = new Set([navigator.serviceWorker.controller].concat(regs.map(r => r.active)).filter(Boolean));
      await Promise.all([...workers].map(retireWorker));
      for (const r of regs) await r.unregister();
      for (const n of await caches.keys()) if (n.startsWith(ART_PREFIX)) await caches.delete(n);
    } catch (e) { /* nothing there to drop */ }
    artReg = null;
  }
  function registerArtCache() {
    if (!artCacheSupported()) return;
    // ?nosw / ?sw say it once: remembered, then taken out of the address so a later "turn it back on" is not undone
    const q = new URLSearchParams(location.search);
    if (q.has('nosw')) MTG.store.set('artCache.off', true);
    if (q.has('sw')) MTG.store.set('artCache.off', false);
    const forced = q.has('sw');
    if (q.has('nosw') || q.has('sw')) {
      q.delete('nosw'); q.delete('sw');
      try { history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) { /* the address stays as it was */ }
    }
    if (artCacheOff()) { dropArtCache(); return; }
    // a browser driven by a test gets none, unless the address asks for it
    if (navigator.webdriver && !forced) return;
    // on again: the off mark goes first, or the new worker would find it and stand down
    const go = () => caches.delete(ART_OFF).catch(() => false)
      .then(() => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })).then((reg) => {
      artReg = reg; artRegError = null;
      // a phone app can stay open for days: look for a newer worker when it comes back, at most hourly
      let checked = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - checked < 36e5) return;
        checked = Date.now();
        reg.update().catch(() => {});
      });
      const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || /** @type {any} */ (navigator).standalone === true;
      if (standalone) askPersist();
    }).catch((e) => { artRegError = e; console.warn('Saved card art is off: the worker could not be registered.', e); });
    // after the page has drawn and settled, so the first screen is not kept waiting
    const later = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1500));
    if (document.readyState === 'complete') later();
    else window.addEventListener('load', later, { once: true });
  }
  /** Ask the worker something, over a channel of its own; null when there is none to ask or it does not answer. */
  async function askWorker(msg, ms) {
    try {
      if (!artCacheSupported()) return null;
      const reg = artReg || await navigator.serviceWorker.getRegistration();
      const w = reg && reg.active;
      if (!w) return null;
      return await new Promise((res) => {
        const ch = new MessageChannel();
        const t = setTimeout(() => res(null), ms || 2000);
        ch.port1.onmessage = (e) => { clearTimeout(t); res(e.data); };
        w.postMessage(msg, [ch.port2]);
      });
    } catch (e) { return null; }
  }
  /**
   * Ask the browser to keep what is stored here even when space runs low:
   * granted or not without a word in Safari and Chrome (a home-screen app
   * is the likeliest to be), though Firefox asks the player, so it is only
   * ever asked after something the player chose to do. At most once a month.
   */
  async function askPersist() {
    try {
      const S = navigator.storage;
      if (!S || !S.persist || !S.persisted || await S.persisted()) return;
      const last = MTG.store.get('storage.persistAsked', 0) || 0;
      if (Date.now() - last < 30 * 864e5) return;
      MTG.store.set('storage.persistAsked', Date.now());
      await S.persist();
    } catch (e) { /* the browser decides */ }
  }
  /** Options, Card data: how many pictures are kept here, and a way to delete them. */
  function artCacheRow() {
    const host = el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
      el('div', { class: 'opt-label', text: 'Saved card art' }),
      el('div', { class: 'opt-help', text: 'Reading the saved art…' }),
    ]));
    const draw = async () => {
      const kids = [el('div', { class: 'opt-label', text: 'Saved card art' })];
      const buttons = [];
      if (!artCacheSupported()) {
        kids.push(el('div', { class: 'opt-help', text: 'This browser or address cannot save card art, so pictures are downloaded each time they are needed.' }));
      } else if (artCacheOff()) {
        kids.push(el('div', { class: 'opt-help', text: ART_CACHE_ON ? 'Saving card art is turned off on this device.' : 'Saving card art is turned off for now.' }));
        if (ART_CACHE_ON) buttons.push(el('button', { class: 'btn sm', text: 'Turn it back on', onclick: () => {
          MTG.store.set('artCache.off', false); registerArtCache(); setTimeout(draw, 1500);
        } }));
      } else if (artRegError) {
        kids.push(el('div', { class: 'opt-help', text: 'This browser would not start saving card art here (site data may be blocked), so pictures are downloaded each time.' }));
      } else {
        const help = el('div', { class: 'opt-help', text: 'Reading the saved art…' });
        kids.push(help);
        const stats = await askWorker({ type: 'stats' }, 2500);
        const kept = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
        if (!stats) help.textContent = 'Card pictures are kept on this device as you see them, so they show at once and use less data. Starting up; look again in a moment.';
        else {
          const n = stats.n || 0;
          help.textContent = `Card pictures are kept on this device as you see them, so they show at once and use less data: ${stats.approx ? 'about ' : ''}${n.toLocaleString()} picture${n === 1 ? '' : 's'} (${megabytes(stats.bytes || 0)}), of up to about ${megabytes(stats.maxBytes || 0)}; the least used go first.`;
        }
        kids.push(el('div', { class: 'opt-help', text: kept ? 'Kept until you delete it.' : 'The browser may clear it if the device runs low on space.' }));
        if (!kept && navigator.storage && navigator.storage.persist) buttons.push(el('button', { class: 'btn sm', text: 'Ask the browser to keep it', onclick: async () => {
          try { MTG.store.set('storage.persistAsked', Date.now()); await navigator.storage.persist(); } catch (e) { /* the browser decides */ }
          draw();
        } }));
        kids.push(el('div', { class: 'opt-help', text: 'The app itself is kept too, so it opens without a connection; it still updates whenever there is one.' }));
        kids.push(el('div', { class: 'opt-help', text: 'Each browser keeps its own; on an iPhone the home-screen app and Safari keep one each.' + (stats ? ` (worker ${stats.v})` : '') }));
        buttons.push(el('button', { class: 'btn sm danger', text: 'Delete saved art', onclick: async () => {
          if (!await UI.confirm('Delete the card pictures saved on this device? They are downloaded again as they are needed.', 'Saved card art', { yes: 'Delete them', no: 'Keep them' })) return;
          const done = await askWorker({ type: 'clear' }, 5000);
          if (!done) {
            for (const n of await caches.keys()) if (n.startsWith(ART_NS + 'g') || n === ART_NS + 'meta') await caches.delete(n);
          }
          UI.ok('Saved art deleted.');
          setTimeout(draw, 800);
        } }));
        // the only off switch a home-screen app can reach: it has no address bar for ?nosw
        buttons.push(el('button', { class: 'btn sm', text: 'Turn off on this device', onclick: async (e) => {
          e.target.disabled = true;
          MTG.store.set('artCache.off', true);
          await dropArtCache();
          draw();
        } }));
      }
      if (buttons.length) kids.push(el('div', { class: 'row wrap', style: { marginTop: '10px' } }, buttons));
      if (!host.isConnected && host.dataset.drawn) return;   // Options was drawn again without this row
      host.dataset.drawn = '1';
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'grow' }, kids));
    };
    draw();
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
    ['you', 'You'], ['display', 'Display'], ['gameplay', 'Gameplay'], ['rules', 'House rules'], ['pace', 'Pace'], ['stops', 'Stops'],
    ['access', 'Accessibility'], ['sound', 'Sound'], ['online', 'Online'], ['suggest', 'Suggestions'], ['data', 'Card data'],
  ];
  const BOT_PACE = MTG.BOT_PACES;
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
      if (!MTG.names.ok(nameInput.value)) { UI.error('That name can’t be used. Pick another.'); nameInput.value = App.myName; return; }
      App.myName = nameInput.value.trim() || randomName();
      nameInput.value = App.myName;
      MTG.setSetting('playerName', App.myName);
      App.profileChanged();
    });
    sections.push(group('you', 'You', null, [
      el('div', { class: 'opt-row you-row' }, [
        el('button', { type: 'button', class: 'portrait-btn', title: 'Change your profile picture', 'aria-label': 'Change your profile picture',
          onclick: () => App.chooseAvatar(() => renderOptions()) }, [UI.portrait(App.myName, null, { size: 'lg', avatar: MTG.settings.avatar, frame: MTG.economy.frameWorn() })]),
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Display name' }),
          el('div', { class: 'opt-help', text: 'What other players at the table see.' }),
          nameInput,
          el('button', { type: 'button', class: 'btn sm ghost', style: { marginTop: '8px' }, text: MTG.settings.avatar ? 'Change profile picture…' : 'Choose a profile picture…',
            onclick: () => App.chooseAvatar(() => renderOptions()) }),
        ]),
      ]),
      el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Back up your profile' }),
          el('div', { class: 'opt-help', text: 'Your collection, Shards, packs, wildcards, sleeves, decks and settings live only in this browser. Save them to a file, and load that file here or on another computer.' }),
        ]),
        el('button', { type: 'button', class: 'btn sm', text: 'Save to a file', onclick: () => App.exportProfile() }),
        el('button', { type: 'button', class: 'btn sm ghost', text: 'Load from a file…', onclick: () => App.importProfile() }),
      ]),
      // the same, straight to another device (src/10g-ui-social.js)
      UI.moveSaveRow ? UI.moveSaveRow() : null,
    ]));

    /* -- gameplay -- */
    sections.push(group('gameplay', 'Gameplay', null, [
      toggle('useCollection', 'Build from my collection', 'Decks you play use the cards you own; a wildcard crafts one you are missing. Starter decks and decks the bots build for you are always allowed. Off: any card, as before.'),
      el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'First-game walkthrough' }),
          el('div', { class: 'opt-help', text: (S.tutorialDone ? 'Seen. Play the guided first game again: ' : 'A guided first game: ') +
            'a gentle bot, a starter deck, and notes on the table as things come up, from playing a land and tapping it for mana to attacking and blocking.' }),
        ]),
        el('button', { class: 'btn sm', text: S.tutorialDone ? 'Play it again' : 'Play it', onclick: () => App.startTutorial() }),
      ]),
      MTG.lessons ? el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Tutorials' }),
          el('div', { class: 'opt-help', text: `Short lessons after the first game: the stack, combat tricks, blocking well and counterspells. ${MTG.lessons.count()} of ${MTG.lessons.LESSONS.length} done.` }),
        ]),
        el('button', { class: 'btn sm', text: 'Open', onclick: () => MTG.lessons.open() }),
      ]) : null,
      // (the Play screen's Tutorials tile, hidden from its own right-click menu, comes back here)
      MTG.lessons ? toggle('showTutorials', 'Show the Tutorials on the Play screen',
        'Also the home screen’s offers of the guided first game and the lessons. Off, they are hidden; the two rows above still open them.',
        null) : null,
      toggle('autoTapLands', 'Tap lands for me', 'On: when you cast a spell or use an ability, the game taps the lands that pay for it. ' +
        'Off: you tap lands for mana yourself first, and it is paid from the mana they made.'),
      toggle('confirmAttacks', 'Confirm before attacking', 'Ask before locking in your attackers.'),
      choice('handSort', 'Sort my hand by', [['cmc', 'Mana value'], ['name', 'Name'], ['type', 'Type'], ['color', 'Colour']]),
    ]));

    /* -- pace: how fast the table moves -- */
    const botNow = S.botSpeed == null ? 1500 : S.botSpeed;
    const botOut = el('span', { class: 'opt-value', text: botNow + ' ms' });
    const botRange = el('input', {
      type: 'range', min: '0', max: '4000', step: '50', value: String(botNow), id: 'opt-botSpeed',
      'aria-label': 'Bot speed: the pause before each thing a bot does, in milliseconds', 'aria-valuetext': botNow + ' milliseconds',
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
    const botSeg = segmented(BOT_PACE, botNow, (v) => { MTG.setSetting('botSpeed', v); renderOptions(); }, 'Bot speed');
    botSeg.classList.add('bot-seg');
    botSeg.querySelectorAll('.seg-btn').forEach((b, i) => { b.dataset.v = String(BOT_PACE[i][0]); });
    sections.push(group('rules', 'House rules', 'Sets of house rules with a name, kept for a format. Pick one in the quick game, or in a table\u2019s House rules when you host.',
      rulePresetRows(() => renderOptions())));
    sections.push(group('pace', 'Pace', 'How quickly the table moves. Nothing here changes the rules.', [
      pick('animSpeed', 'Table animations', ANIM_PACE,
        'How long cards take to fly, flip and land. Fast keeps games brisk; relaxed lets you follow every move.', 1),
      el('div', { class: 'opt-row stacked' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label' }, [el('span', { text: 'Bot speed' }), botOut]),
          el('div', { class: 'opt-help', text: 'How fast every bot at the table plays: the pause before each thing it does. Normal is the usual pace; faster keeps games brisk, slower lets you follow each play.' }),
          botSeg,
          el('div', { class: 'fine-tune' }, [el('span', { class: 'tiny dim', text: 'Fine tune' }), botRange]),
        ]),
      ]),
      toggle('animateDraws', 'Card animations', 'Tapping, drawing and combat animate. Off, the table simply changes.'),
      pick('priorityTimer', 'Priority timer', [[0, 'Off'], [8, '8 s'], [15, '15 s'], [30, '30 s']],
        'When the game stops for you to respond (an opponent\u2019s spell, a step of their turn), it passes for you after this long. A ring on the button counts it down; any click or key starts it again. It never runs on your own main phases or while you are choosing something.', 15),
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
        el('div', { class: 'opt-help', text: 'Tap a square to stop there — or click a step on the phase strip at the table. Space passes, Enter yields until somebody responds, Shift+Enter yields the turn, Ctrl keeps priority for this step. ? at the table lists every key.' }),
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
      choice('cardLang', 'Card language', MTG.cardLang.options(),
        'Card pictures in this language wherever Scryfall has a printing in it, and in English where it has none. The rules text the game runs on stays in English.'),
      pick('theme', 'Theme', [['dark', 'Dark'], ['light', 'Light']], 'The menus and deck builder. The game table is always dark.', 'dark'),
      toggle('showOracleOnHover', 'Show a large card preview on hover', 'Hover any card to read it at full size.'),
      toggle('keywordHelp', 'Explain keywords beside enlarged cards',
        'Flying, ward, Treasure and the rest: what each one does, next to the card when you look at it closely.'),
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
      el('div', { class: 'opt-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Playing by keyboard' }),
          el('div', { class: 'opt-help', text: 'The whole game plays from the keyboard, and a screen reader hears what happens. Press ? at the table for every key.' }),
        ]),
        el('button', { class: 'btn sm', text: 'Show the keys', onclick: () => UI.keyboardHelp() }),
      ]),
      toggle('bigHitTargets', 'Larger click targets', 'Adds padding to buttons and rows.'),
    ]));

    /* -- sound: the rows are built by the table's sound (src/12f-ui-feel.js) -- */
    sections.push(group('sound', 'Sound', null, MTG.feel.soundRows()));

    /* -- online -- */
    sections.push(onlineGroup(group));
    sections.push(suggestionsGroup(group, pick));

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
      artCacheRow(),
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
    // house rules chosen for the quick game, or the format as it is
    const sess = App.session = new Session(App.formatId, opts.rules || null);
    // ranked, an event, the gauntlet: what kind of game this is, for its rewards
    sess.mode = opts.mode || null;
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
      if (style === 'jumpstart') {
        sess.jumpstart = opts.jumpstart && (opts.jumpstart.product || opts.jumpstart.set) ? opts.jumpstart : null;
      } else if (style === 'booster' || style === 'commander' || style === 'sealed') {
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
      if (opts.collector && style !== 'cube' && style !== 'jumpstart') sess.setRule('collector', true);
      if (opts.packs && opts.packs !== sess.fmt.draft.packs && style !== 'jumpstart') sess.setRule('packs', U.clamp(Math.floor(opts.packs), 1, 8));
      if (opts.allAtOnce && style !== 'sealed' && style !== 'jumpstart') sess.setRule('allPacksAtOnce', true);
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
    // a tutorial: the result screen offers the next one rather than a rematch (src/14b-lessons.js)
    await App.quickGame({ formatId: 'standard', difficulty: 1, opponents: 1, deck, mode: { tutorial: 'first' } });
    if (App.table && App.screen === 'table' && !App.table.coach) new UI.Coach(App.table);
  };

  async function joinRoom(code) {
    if (!code || !code.trim()) return UI.error('Enter a room code.');
    const busy = UI.busy('Joining', 'Connecting to the host…');
    try {
      await net.join(code.trim(), {
        name: App.myName, token: MTG.clientToken(), autoPass: MTG.autoPassConfig(),
        avatar: MTG.settings.avatar || null,
        sleeve: MTG.economy.sleeveWorn(),
        frame: MTG.economy.frameWorn(),
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
  App.joinRoom = joinRoom;

  /**
   * A table set up for a friends tournament's match (src/10i-ui-tourney.js):
   * the format and house rules it plays by, `mode` to say which match it
   * is, and a room opened at once for the other player to join. Resolves
   * the room's code, or null if no room could be opened (the lobby stays,
   * to open one by hand).
   */
  App.hostTableFor = async function (o) {
    App.formatId = o.formatId;
    const sess = App.session = new Session(o.formatId, o.rules || null);
    sess.mode = o.mode || null;
    sess.addLocalHost(App.myName);
    showScreen('lobby');
    renderLobby();
    const busy = UI.busy('Opening a room');
    try { await net.host(); }
    catch (e) { busy.close(); UI.error(e.message || String(e)); return null; }
    busy.close();
    setNetBadge();
    if (App.session === sess && App.screen === 'lobby') renderLobby();
    return net.roomCode;
  };

  /**
   * A table on this device for a friends tournament's match against one of
   * its bots: the format and house rules, the bot seated under its own
   * name, level and style, and the lobby shown to choose a deck and start.
   * No room: the bot plays here, and the result is reported from here.
   */
  App.botTableFor = function (o) {
    App.formatId = o.formatId;
    const sess = App.session = new Session(o.formatId, o.rules || null);
    sess.mode = o.mode || null;
    sess.addLocalHost(App.myName);
    sess.addBot(o.bot.difficulty, o.bot.personality || '', o.bot.name);
    showScreen('lobby');
    renderLobby();
    return sess;
  };

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
          el('span', { text: `${MTG.formats.lifeFor(fmt, sess.roster.length)} life` }),
          el('span', { text: fmt.exactSize ? `${fmt.deckMin} cards` : `${fmt.deckMin || 60}+ cards` }),
          fmt.commanderDamage ? el('span', { text: `${fmt.commanderDamage} commander damage` }) : null,
          fmt.bracket ? el('span', { class: `lobby-bracket b${fmt.bracket}`, text: MTG.brackets.label(fmt.bracket) }) : null,
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

    // a friends tournament's match: which one, and that its result is sent by itself
    const tourneyNote = sess.mode && sess.mode.tourney && UI.tourneyLobbyNote ? UI.tourneyLobbyNote(sess.mode.tourney) : null;
    if (tourneyNote) side.appendChild(tourneyNote);

    /* -- start: the biggest button on the screen -- */
    const ready = sess.readyToStart();
    side.appendChild(el('section', { class: 'panel start-panel' + (ready.ok ? ' ready' : '') }, [
      el('div', { class: 'start-state' }, [
        el('span', { class: 'start-dot', 'aria-hidden': 'true' }),
        el('span', { text: ready.ok ? (fmt.kind === 'limited' ? limitedWords(fmt).ready : 'Everything is set.') : ready.reason }),
      ]),
      el('button', {
        class: 'btn primary hero-btn', disabled: !ready.ok,
        html: `${SVG.play}<span>${fmt.kind === 'limited' ? limitedWords(fmt).start : 'Start the game'}</span>`,
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
            if (!await App.collectionAllows(me.deck) || App.session !== sess) return;
          }
          sess.start();
        },
      }),
    ]));

    if (MTG.formats.houseFields(sess.formatId).some(f => f.key === 'bracket')) side.appendChild(bracketPanel(sess));

    /* -- other people -- */
    const online = el('section', { class: 'panel online-panel' });
    online.appendChild(el('h3', null, [el('span', { class: 'h-ico', html: SVG.users }), el('span', { text: 'Play with other people' })]));
    if (net.isHost) {
      online.append(
        el('button', { class: 'code-display', text: net.roomCode, title: 'Copy the room code', 'aria-label': `Room code ${net.roomCode}. Copy it.`,
          onclick: async () => { if (await UI.copyText(net.roomCode)) UI.ok('Room code copied.'); else UI.error(`Could not copy it; the code is ${net.roomCode}.`); } }),
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
    // friends to invite, and a link to the room (src/10g-ui-social.js)
    if (UI.lobbyInvites) online.appendChild(UI.lobbyInvites({ fmt: fmt.name, onOpened: () => { setNetBadge(); renderLobby(); } }));
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
    // at a Commander table, each deck's bracket, which opens what puts it there
    const bracketed = MTG.formats.usesBrackets(fmt) && MTG.brackets;
    const bracketPill = () => (bracketed && r.deck ? UI.bracketPill(r.deck, { short: true, table: sess.rules.bracket || 0 }) : null);

    if (r.kind === 'bot') {
      const label = MTG.bots.DIFFICULTY[r.difficulty].label;
      if (!limited) {
        if (r.building) status.push(el('span', { class: 'seat-status building' }, [el('span', { class: 'spinner' }), ' building a deck…']));
        else if (r.buildFailed) status.push(el('span', { class: 'pill bad', title: r.buildFailed, text: 'deck failed' }));
        else if (r.deck) {
          deckLine = commander ? commanderLink(commander) : el('span', { class: 'seat-deck-name', text: r.deck.name });
          if (bracketed) status.push(bracketPill());
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
      if (bracketed && r.deck) status.push(bracketPill());
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
        r.kind === 'local'
          ? el('button', { type: 'button', class: 'portrait-btn', title: 'Change your profile picture', 'aria-label': 'Change your profile picture',
            onclick: () => App.chooseAvatar(() => renderLobby()) }, [UI.portrait(r.name, key, { size: 'md', avatar: MTG.settings.avatar, frame: MTG.economy.frameWorn() })])
          : UI.portrait(r.name, key, { size: 'md', avatar: r.avatar, frame: r.frame || null }),
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
        el('span', { class: 'tiny dim', text: fmt.kind === 'limited' ? limitedWords(fmt).bot : 'It builds its own deck for this format.' }),
      ]),
      el('label', { class: 'add-seat-diff' }, [el('span', { class: 'tiny dim', text: 'Difficulty' }), diffSel]),
      el('label', { class: 'add-seat-diff' }, [el('span', { class: 'tiny dim', text: 'Style' }), persSel]),
    ]);
  }

  /**
   * The bracket this table plays at, chosen by the host: any, or one of the
   * five. A deck that goes past it is turned away, and the bots build to it.
   */
  function bracketPanel(sess) {
    const B = MTG.brackets;
    const cur = sess.rules.bracket || 0;
    const p = el('section', { class: 'panel bracket-panel' });
    p.appendChild(el('h3', { text: 'Bracket' }));
    p.appendChild(el('div', { class: 'bracket-choose', role: 'radiogroup', 'aria-label': 'The bracket this table plays at' }, [0, 1, 2, 3, 4, 5].map(n => el('button', {
      type: 'button', class: 'bracket-opt' + (n ? ` b${n}` : '') + (n === cur ? ' on' : ''), role: 'radio', 'aria-checked': n === cur ? 'true' : 'false',
      title: n ? `${B.label(n)}: ${B.BRACKETS[n].blurb}` : 'Any deck the format allows',
      onclick: () => { if (n !== cur) { sess.setRule('bracket', n); renderLobby(); } },
    }, el('b', { text: n ? String(n) : 'Any' })))));
    p.appendChild(el('p', { class: 'small muted' }, cur ? [
      el('b', { class: `bracket-name b${cur}`, text: B.label(cur) + '. ' }),
      `${B.BRACKETS[cur].blurb} A deck that goes past it is turned away, and the bots build to it.`,
    ] : 'Any deck the format allows. Choose one to keep the table to decks of about the same strength.'));
    return p;
  }

  /** What a limited table does before it plays, in its own words: a draft, sealed packs, or half-decks. */
  function limitedWords(fmt) {
    const style = fmt.draft ? fmt.draft.style : '';
    if (style === 'sealed') return { start: 'Open the packs', ready: 'Everything is set — open the packs.', bot: 'It opens packs of its own.', setup: 'What you are opening' };
    if (style === 'jumpstart') return { start: 'Deal the half-decks', ready: 'Everything is set — deal the half-decks.', bot: 'It chooses half-decks of its own.', setup: 'The half-decks' };
    return { start: 'Start the draft', ready: 'Everything is set — open the packs.', bot: 'It drafts alongside you.', setup: 'What you are drafting' };
  }

  function formatSetupPanel(sess, fmt) {
    const p = el('section', { class: 'panel setup-panel' });
    p.appendChild(el('h3', { text: fmt.kind === 'limited' ? limitedWords(fmt).setup : 'The format' }));
    if (fmt.kind === 'limited') {
      const rows = [];
      if (fmt.draft.style === 'jumpstart') {
        // where the half-decks come from (src/13b-ui-sealed.js)
        rows.push(...UI.limitedRun.setupRows(sess, () => { sess.broadcastLobby(); renderLobby(); }));
      } else if (fmt.draft.style === 'cube') {
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
        rows.push(el('label', { class: 'field' }, [el('span', { text: fmt.draft.style === 'sealed' ? 'Set to open' : 'Set to draft' }), setSel]));
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
    ['game', 'The game', ['startingLife', 'startingHand', 'freeMulligans', 'firstPlayerDraws', 'bestOf', 'commanderDamage', 'clock']],
    ['decks', 'Deck building', ['deckMin', 'exactSize', 'maxCopies', 'singleton', 'sideboardMax', 'colorIdentity']],
    ['draft', 'The packs', ['packs', 'packSize', 'basicsFree']],
  ];
  // which folds are open survives the lobby redrawing itself on every change
  const openRules = new Set(['game']);
  let rulesOpen = false;

  function houseRulesPanel(sess) {
    // the bracket has a panel of its own (bracketPanel)
    const fields = MTG.formats.houseFields(sess.formatId).filter(f => f.key !== 'bracket');
    const changed = MTG.formats.houseSummary(sess.formatId, Object.assign({}, sess.rules, { bracket: 0 }));
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

    const setRule = (k, v) => { sess.setRule(k, v); renderLobby(); };
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
      for (const f of list) grid.appendChild(ruleCell(sess.rules, f, setRule));
      fold.appendChild(grid);
      panel.appendChild(fold);
    }
    // anything the formats file adds later still gets a place
    const rest = fields.filter(f => !placed.has(f.key));
    if (rest.length) {
      const grid = el('div', { class: 'rule-grid' });
      for (const f of rest) grid.appendChild(ruleCell(sess.rules, f, setRule));
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

  /**
   * One rule, with the format's own value shown when it has been changed.
   * `rules` is what it reads; `set(key, value)` changes it (a table's rule,
   * or a preset being written).
   */
  function ruleCell(rules, f, set) {
    const cur = rules[f.key];
    const isDefault = cur === f.value || (f.byRules && cur == null && f.value == null);
    const cell = el('div', { class: 'rule-cell' + (isDefault ? '' : ' changed') });
    const id = 'rule-' + f.key;

    const was = isDefault ? null : el('span', { class: 'rule-was', text: `was ${fmtRuleValue(f, f.value)}` });

    /* A checkbox on its own is a 17px target. Putting it inside its label
       makes the whole row the target, which is the difference between
       usable and not on a phone. */
    /* Free mulligans, first player draws: "by the rules" (worked out from the format and the
       seats as the game starts), or a value the table holds to */
    if (f.byRules) {
      const opts = [['rules', 'By the rules']].concat(f.type === 'bool' ? [['on', 'On'], ['off', 'Off']]
        : Array.from({ length: f.max - f.min + 1 }, (_, i) => [String(f.min + i), String(f.min + i)]));
      const now = cur == null ? 'rules' : f.type === 'bool' ? (cur ? 'on' : 'off') : String(cur);
      const sel = el('select', { id }, opts.map(([v, label]) => el('option', { value: v, text: label, selected: v === now })));
      sel.addEventListener('change', () => set(f.key, sel.value === 'rules' ? null : f.type === 'bool' ? sel.value === 'on' : parseInt(sel.value, 10) || 0));
      cell.append(
        el('label', { class: 'rule-label', for: id }, [el('span', { text: f.label }), was]),
        sel,
        el('div', { class: 'rule-hint', text: f.hint }),
      );
      return cell;
    }
    if (f.type === 'bool') {
      const box = el('input', { type: 'checkbox', id });
      box.checked = !!cur;
      box.addEventListener('change', () => set(f.key, box.checked));
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
      on.addEventListener('change', () => set(f.key, on.checked ? (parseInt(n.value, 10) || f.value || 21) : 0));
      n.addEventListener('change', () => set(f.key, U.clamp(parseInt(n.value, 10) || f.value, f.min, f.max)));
      control = el('div', { class: 'row rule-onoff', style: { gap: '8px' } }, [
        el('label', { class: 'rule-toggle inline-check' }, [on, el('span', { text: cur ? 'on' : 'off' })]),
        n,
      ]);
    } else if (f.type === 'choice') {
      // one of a few set values: the clock is off, or so many minutes a player
      control = el('select', { id }, f.options.map(([v, label]) => el('option', { value: String(v), text: label, selected: v === cur })));
      control.addEventListener('change', () => set(f.key, parseInt(control.value, 10) || 0));
    } else if (f.type !== 'bracket') {
      const step = f.type === 'odd' ? 2 : 1;
      const n = el('input', { type: 'number', id, min: String(f.min), max: String(f.max), step: String(step), value: String(cur) });
      n.addEventListener('change', () => {
        let v = parseInt(n.value, 10);
        if (!Number.isFinite(v)) v = f.value;
        v = U.clamp(v, f.min, f.max);
        if (f.type === 'odd' && v % 2 === 0) v = v + 1 > f.max ? v - 1 : v + 1;
        n.value = String(v);
        set(f.key, v);
      });
      control = n;
    } else if (f.type === 'bracket') {
      // a preset's bracket (a table's has its own panel): any, or one of the five
      const B = MTG.brackets;
      control = el('select', { id }, [0, 1, 2, 3, 4, 5].map(n =>
        el('option', { value: String(n), text: n ? B.label(n) : 'Any bracket', selected: n === (cur || 0) })));
      control.addEventListener('change', () => set(f.key, parseInt(control.value, 10) || 0));
    }

    cell.append(
      el('label', { class: 'rule-label', for: id }, [el('span', { text: f.label }), was]),
      control,
      el('div', { class: 'rule-hint', text: f.hint }),
    );
    return cell;
  }

  function fmtRuleValue(f, v) {
    if (f.byRules && v == null) return 'by the rules';
    if (f.type === 'bool') return v ? 'on' : 'off';
    if (f.type === 'bracket') return v ? MTG.brackets.label(v) : 'any';
    if (f.type === 'intOff') return v ? String(v) : 'off';
    if (f.type === 'choice') return MTG.formats.choiceLabel(f, v).toLowerCase();
    return String(v);
  }

  /**
   * A preset written (or changed) on its own: a name, a format, and the
   * format's rules to bend. Saved beside the others, it can be picked at
   * any table of that format and in the quick game.
   */
  /* `opts.onSubmit(formatId, rules)`: the rules as they stand, for the match being set up, kept
     as no preset ("Submit"); `opts.rules` starts from rules like those rather than a preset's */
  function editRulePreset(formatId, preset, onDone, opts) {
    opts = opts || {};
    const editable = MTG.formats.list().filter(f => MTG.formats.houseFields(f.id).length);
    let fid = formatId || (editable[0] || {}).id;
    let rules = Object.assign(MTG.formats.houseDefaults(fid), preset ? preset.rules : (opts.rules || {}));
    const name = el('input', { type: 'text', value: preset ? preset.name : '', placeholder: 'Kitchen table, Big life, Pauper cube…', maxlength: '40', 'aria-label': 'Preset name' });
    const fmtSel = el('select', { 'aria-label': 'Format', disabled: !!preset }, editable.map(f =>
      el('option', { value: f.id, text: f.name, selected: f.id === fid })));
    const cells = el('div', { class: 'preset-rules' });
    const draw = () => {
      cells.innerHTML = '';
      const fields = MTG.formats.houseFields(fid);
      const byKey = new Map(fields.map(f => [f.key, f]));
      const set = (k, v) => { rules[k] = v; draw(); };
      const placed = new Set();
      /** @type {Array<[string, string, string[]]>} */
      const groups = [['bracket', 'The table', ['bracket']]];
      groups.push(...RULE_GROUPS);
      for (const [, title, keys] of groups) {
        const list = keys.map(k => byKey.get(k)).filter(Boolean);
        if (!list.length) continue;
        list.forEach(f => placed.add(f.key));
        cells.appendChild(el('div', { class: 'section-title', text: title }));
        cells.appendChild(el('div', { class: 'rule-grid' }, list.map(f => ruleCell(rules, f, set))));
      }
      const rest = fields.filter(f => !placed.has(f.key));
      if (rest.length) cells.appendChild(el('div', { class: 'rule-grid' }, rest.map(f => ruleCell(rules, f, set))));
    };
    fmtSel.addEventListener('change', () => { fid = fmtSel.value; rules = MTG.formats.houseDefaults(fid); draw(); });
    draw();
    const m = UI.modal({
      title: preset ? `House rules: ${preset.name}` : 'New house rules', width: '760px', className: 'preset-modal',
      content: el('div', null, [
        el('div', { class: 'row wrap preset-head', style: { gap: '10px' } }, [
          el('label', { class: 'grow qfield' }, [el('span', { class: 'qlabel', text: 'Name' }), name]),
          el('label', { class: 'qfield' }, [el('span', { class: 'qlabel', text: 'Format' }), fmtSel]),
        ]),
        el('p', { class: 'tiny dim', text: 'Change what you like; anything left alone stays as the format has it.' }),
        cells,
      ]),
      buttons: [
        { label: 'Cancel', onClick: () => m.close() },
        { label: 'Save preset', onClick: () => {
          const nm = name.value.trim();
          if (!nm) { name.focus(); return UI.error('Give it a name.'); }
          if (preset && preset.name !== nm) MTG.formats.presets.remove(fid, preset.name);
          MTG.formats.presets.save(fid, nm, rules);
          m.close();
          UI.ok(`Saved “${nm}”.`);
          if (onDone) onDone();
        } },
        // these rules for this match only, no name needed and nothing saved
        opts.onSubmit ? { label: 'Submit', class: 'primary', onClick: () => {
          m.close();
          opts.onSubmit(fid, Object.assign({}, rules));
        } } : null,
      ].filter(Boolean),
    });
    setTimeout(() => { if (!preset) name.focus(); }, 60);
    return m;
  }

  /** The House rules section of Options: every preset, and a new one. */
  function rulePresetRows(redraw) {
    const all = MTG.formats.presets.all();
    const rows = [];
    for (const f of MTG.formats.list()) {
      for (const pr of (all[f.id] || [])) {
        const changed = MTG.formats.houseSummary(f.id, pr.rules);
        rows.push(el('div', { class: 'opt-row preset-row' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'opt-label' }, [el('span', { text: pr.name }), el('span', { class: 'pill', text: f.name })]),
            el('div', { class: 'opt-help', text: changed.length ? changed.join(' \u00b7 ') : 'The format as it is.' }),
          ]),
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('button', { class: 'btn sm', text: 'Edit', onclick: () => editRulePreset(f.id, pr, redraw) }),
            el('button', { class: 'btn sm ghost danger-ghost', text: 'Delete', onclick: async () => {
              if (!await UI.confirm(`Delete “${pr.name}”?`, 'House rules', { yes: 'Delete', no: 'Keep it' })) return;
              MTG.formats.presets.remove(f.id, pr.name);
              redraw();
            } }),
          ]),
        ]));
      }
    }
    if (!rows.length) rows.push(el('div', { class: 'opt-row' }, el('div', { class: 'opt-help', text: 'None yet. A preset is a set of house rules with a name: 40 life in Standard, Commander at Bracket 2, five packs a draft.' })));
    rows.push(el('div', { class: 'opt-row' }, [
      el('button', { class: 'btn sm primary', text: '+ New house rules', onclick: () => editRulePreset(null, null, redraw) }),
    ]));
    return rows;
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
    inner.append(App.clientBanner);
    // a friends tournament's match: which one (src/10i-ui-tourney.js)
    const tourneyNote = UI.tourneyRoomNote ? UI.tourneyRoomNote(net.roomCode) : null;
    if (tourneyNote) inner.appendChild(tourneyNote);
    inner.appendChild(App.clientLobbyBox);
    if (UI.lobbyInvites) inner.appendChild(UI.lobbyInvites({ guest: true }));
    s.appendChild(el('div', { class: 'menu-wrap' }, inner));
  }

  function renderClientLobbyData(payload) {
    App.lobbyMembers = ((payload && payload.members) || []).map(m => (m && typeof m.name === 'string' && !MTG.names.ok(m.name) ? Object.assign({}, m, { name: 'Player' }) : m));
    App.clientYou = (payload && payload.you) || null;
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
      for (const t of [`${payload.members.length} at the table`, fmt.startingLife ? `${MTG.formats.lifeFor(fmt, payload.members.length)} life` : null,
        fmt.bracket && MTG.brackets ? MTG.brackets.label(fmt.bracket) : null, 'Waiting for the host to start'])
        if (t) facts.appendChild(el('span', { text: t }));
      facts.appendChild(rttPill('host'));
      if (!banner._art) { banner._art = true; decorArt(banner.firstChild, FORMAT_ART[payload.formatId] || HERO_ART[0]); }
      // a tournament match the table has only now said it is (src/10i-ui-tourney.js): its panel under the banner
      if (UI.tourneyRoomNote && banner.parentNode && !banner.parentNode.querySelector('.tn-lobby')) {
        const note = UI.tourneyRoomNote(net.roomCode);
        if (note) banner.after(note);
      }
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
          UI.portrait(r.name, null, { size: 'md', avatar: r.avatar, frame: r.frame && MTG.economy.frameById(r.frame) ? r.frame : null }),
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
          r.bracket ? el('span', { class: `bracket-pill short static b${r.bracket}`, text: `B${r.bracket}`, title: MTG.brackets.label(r.bracket) }) : null,
          r.deckValid === false ? el('span', { class: 'pill bad', text: 'deck not legal' }) : (r.deckName ? el('span', { class: 'pill good', text: 'ready' }) : null),
        ].filter(Boolean)),
      ]));
    }
    box.appendChild(grid);
    if (fmt.kind !== 'limited') {
      box.appendChild(el('div', { class: 'client-go' }, [
        el('button', { class: 'btn primary hero-btn', html: `${SVG.deck}<span>Choose my deck</span>`, onclick: () => {
          UI.pickDeck(payload.formatId, async (d) => {
            if (!await App.collectionAllows(d)) return;
            // kept, so the game is written into this deck's record (src/12h-ui-rematch.js)
            App.clientDeck = d;
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

  /* After an online draft, the longest the game waits for someone still building their deck. */
  const DRAFT_BUILD_WAIT = 5 * 60 * 1000;

  /* Rule changes that mean a bot's deck is the wrong shape now. */
  const DECK_SHAPING = ['deckMin', 'exactSize', 'maxCopies', 'singleton', 'colorIdentity', 'commanderDamage', 'bracket'];

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
      this.jumpstart = null;      // where Jumpstart's half-decks come from: {product} or {set}; null, the newest
      /** @type {any} what kind of game this is, for its rewards: { ranked }, { event }, { gauntlet } */
      this.mode = null;
      /** @type {any} set up the board of a challenge, once the game has started */
      this.onStarted = null;
      this.cube = null;
      this.game = null;
      this.draft = null;
      this.botRunner = null;
      /** @type {any} the game clock, when the table plays with one (src/06e-clock.js) */
      this.clock = null;
      /** @type {Map<string, any>|null} seats that have dropped out of an online game, each with the timer that puts it out if it does not come back */
      this._gone = null;
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
        /* A bot keeps the name it sat down with: it is a player at the
           table, called what a player is called, and that is the name its
           turn is announced by. What it built is the deck's name ("Mono-Blue
           Graveyard", "Krenko"), shown with the deck. */
        const deckName = botNameFor(deck, this.formatId, []);
        if (deckName) deck.name = deckName;
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
      const bracket = this.rules.bracket;
      this.rules = MTG.formats.houseDefaults(this.formatId);
      if (bracket) this.rules.bracket = bracket;
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
    /** A bot sits down; `name` gives it one it keeps (a friends tournament's bot), else it is named after its deck. */
    addBot(difficulty, personality, name) {
      // a name of its own, so the table reads as people rather than slots
      const seat = { id: MTG.uid('bot'), kind: 'bot', name: name || randomName(this.roster.map(r => r.name).concat([App.myName])),
        difficulty: difficulty || 5, personality: personality || '', deck: null, keepName: !!name };
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
          // back in time: the seat is theirs still
          if (this._gone) { clearTimeout(this._gone.get(existing.id)); this._gone.delete(existing.id); }
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
              bracket: r.deck && MTG.formats.usesBrackets(this.fmt) && MTG.brackets ? MTG.brackets.estimate(r.deck).bracket : null,
              avatar: (r.kind === 'local' ? MTG.settings.avatar : r.avatar) || null,
              sleeve: r.kind === 'local' ? MTG.economy.sleeveWorn() : (r.kind === 'bot' ? null : (r.sleeve || null)),
              frame: r.kind === 'local' ? MTG.economy.frameWorn() : (r.frame || null),
            })),
          },
        };
      });
    }

    /** The parts of the setup that are not house rules: what is being drafted. */
    setupSummary() {
      const f = this.fmt;
      if (f.kind !== 'limited') return null;
      if (UI.limitedRun && UI.limitedRun.handles(f)) return UI.limitedRun.summary(this);
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
        // sealed and Jumpstart (src/13b-ui-sealed.js)
        const asks = UI.limitedRun && UI.limitedRun.handles(this.fmt) ? UI.limitedRun.notReady(this) : null;
        if (asks) return { ok: false, reason: asks };
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
      // (your own seat is "you": the lobby has just told you to choose a deck)
      if (missing.length === 1 && missing[0].kind === 'local') return { ok: false, reason: 'Choose a deck for your seat to start.' };
      if (missing.length) return { ok: false, reason: `Waiting on a deck from: ${missing.map(r => r.kind === 'local' ? 'you' : r.name).join(', ')}.` };
      /* A bot builds what the card pool allows. If that comes out a card or
         two short of legal it is the builder's shortcoming, not something
         for the person at the table to fix, so it is shown on the bot's row
         rather than stopping the game. */
      const bad = this.roster.filter(r => r.kind !== 'bot' && r.deck && r.deckValid && !r.deckValid.ok);
      if (bad.length) return { ok: false, reason: `Not legal: ${bad.map(r => r.name).join(', ')}. Fix the deck, or pick a format it is legal in.` };
      return { ok: true };
    }

    async start() {
      // sealed packs are opened and Jumpstart's half-decks chosen rather than drafted (src/13b-ui-sealed.js)
      if (UI.limitedRun && UI.limitedRun.handles(this.fmt)) return UI.limitedRun.start(this);
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
          allAtOnce: !!this.rules.allPacksAtOnce,
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
        // a deck a guest sent before the draft (the table was another format then) is not the one they will play
        if (r.kind === 'remote') { r.deck = null; r.deckValid = null; }
        if (r.kind === 'bot') r.deck = this.deckFromPool(r, basics);
      }
      const me = this.seat('me');
      if (!me) { this.startAfterBuilds(); return; }
      App.keepDrafted(me.pool);
      UI.buildFromPool(me.pool, this.formatId, (deck) => {
        me.deck = deck;
        // a draft event: the pod waits, and the matches are one at a time
        if (this.mode && this.mode.event === 'draft') {
          this.mode.pod = this.roster.filter(r => r.kind === 'bot');
          this.mode.idx = 0;
          this.roster = [me, this.mode.pod[0]];
        }
        this.startAfterBuilds();
      });
      if (net.isHost) net.sendPerPeer((peerId) => {
        const r = this.seatByPeer(peerId);
        return r ? { t: 'draft', payload: Object.assign(this.draft.viewFor(r.id), { buildNow: true }) } : null;
      });
    }

    /** The deck the bots' builder makes from a seat's picks (with a commander, in a commander draft). */
    deckFromPool(r, basics) {
      const pool = r.pool || [];
      const deck = MTG.draft.autoBuildLimited(pool, {
        deckSize: this.fmt.deckMin || 40, basicCards: basics, formatId: this.formatId, name: r.name + "'s deck",
      });
      if (this.fmt.commander) {
        const legends = pool.filter(c => MTG.formats.canBeCommander(c, this.fmt));
        if (legends.length) {
          deck.commanders = [legends[0]];
          deck.main = deck.main.filter(e => e.card.id !== legends[0].id);
        }
      }
      return deck;
    }

    /**
     * After a draft each person builds on their own screen, and the game
     * waits for every guest's deck to arrive: until all are in, or
     * DRAFT_BUILD_WAIT has passed, or the host says to start now. Anyone
     * still building then plays the deck the bots' builder makes from their
     * picks, and both they and the host are told so.
     */
    async startAfterBuilds() {
      if (this._awaitingDecks || this.game) return;
      this._awaitingDecks = true;
      let go = false;
      let busy = null;
      const missing = await MTG.draft.awaitDecks(() => this.roster.filter(r => r.kind === 'remote'), {
        timeout: DRAFT_BUILD_WAIT,
        stop: () => go || App.session !== this,
        onWait: (list, left) => {
          const secs = Math.ceil(left / 1000);
          const text = `Waiting for ${list.map(r => r.name).join(', ')} to finish building. ` +
            `The game starts in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} either way.`;
          if (busy) busy.text(text);
          else busy = UI.busy('Waiting for decks', text, { cancelLabel: 'Start now', onCancel: () => { go = true; } });
        },
      });
      if (busy && !busy.cancelled) busy.close();
      this._awaitingDecks = false;
      if (App.session !== this || this.game) return;
      if (missing.length) {
        const basics = await MTG.draft.getBasics().catch(() => ({}));
        for (const r of missing) {
          r.deck = this.deckFromPool(r, basics);
          r.deckValid = MTG.formats.validate(r.deck, this.fmt);
        }
        const names = missing.map(r => r.name).join(', ');
        UI.toast(`${names} had not finished building, so ${missing.length === 1 ? 'they play' : 'each plays'} a deck built from their picks.`, '', 7000);
      }
      this.startGame();
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

        // the cards Alchemy decks conjure, at hand before they are needed
        busy.text('Getting the table ready…');
        await prefetchConjured([].concat(...this.roster.filter(r => r.deck).map(r =>
          r.deck.main.map(e => e.card).concat((r.deck.sideboard || []).map(e => e.card), r.deck.commanders || []))));
        const g = new MTG.rules.Game({
          formatId: this.formatId,
          startingLife: MTG.formats.lifeFor(this.fmt, this.roster.length),
          startingHand: this.rules.startingHand || 7,
          commanderDamage: this.fmt.commander ? (this.rules.commanderDamage || null) : null,
          // by the rules for this many seats, unless the table set them (CR 103.5c, 103.8)
          freeMulligans: MTG.formats.freeMulligansFor(this.fmt, this.rules, this.roster.length),
          maxPlayers: this.fmt.maxPlayers,
          seed: this.seed,
          rulesEnforcement: this.enforcement,
          firstPlayerDraws: MTG.formats.firstPlayerDrawsFor(this.fmt, this.rules, this.roster.length),
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
        // a challenge builds its board here, before anybody moves
        if (this.onStarted) { try { this.onStarted(g); } catch (e) { console.error('[challenge]', e); } }
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
      const clock = this.clock ? this.clock.view() : null;
      if (App.table) {
        /* Watching is the view of someone with no seat: every board, no
           hand, nothing to click. viewFor with an id nobody has gives
           exactly that, and hides every hand rather than none. */
        const v = this.game.viewFor(this.spectating ? '__watching' : 'me');
        v.spectating = this.spectating;
        v.match = match;
        v.clock = clock;
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
      const clock = this.clock ? this.clock.view() : null;
      const encs = (this._enc = this._enc || new Map());
      net.sendPerPeer((peerId) => {
        const r = this.seatByPeer(peerId);
        const viewer = r ? r.id : (this.watchers && this.watchers.has(peerId) ? '__watching' : null);
        if (!viewer) return null;
        let enc = encs.get(peerId);
        if (!enc) { enc = new MTG.sync.Encoder(); encs.set(peerId, enc); }
        const v = this.game.viewFor(viewer);
        v.match = match;
        v.clock = clock;
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
        freeMulligans: MTG.formats.freeMulligansFor(sess.fmt, sess.rules, sess.roster.length),
        firstPlayerDraws: MTG.formats.firstPlayerDrawsFor(sess.fmt, sess.rules, sess.roster.length),
        seed: saved.seed, rulesEnforcement: saved.enforcement,
      });
      if (!g.restore(saved.snap)) throw new Error('That saved game could not be read.');
      g.setAutoPass('me', MTG.autoPassConfig());
      sess.game = g;
      sess.botRunner = new MTG.bots.BotRunner(g);
      for (const r of sess.roster) if (r.kind === 'bot') seatBot(g, sess.botRunner, r);
      sess.wireGame(g);
      if (sess.clock) sess.clock.restore(saved.clock);
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
      // the game clock, if the table plays with one; it stops when this game is no longer the one at the table
      if (this.clock) this.clock.stop();
      this.clock = MTG.clock ? MTG.clock.attach(g, this.rules.clock, { alive: () => App.session === this && this.game === g }) : null;
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
            clock: this.clock ? this.clock.save() : null,
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
      if (UI.limitedRun && UI.limitedRun.intent(this, actorId, intent)) return;
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
        mulligan: 'the mulligan', keep: 'keeping', pass: 'passing', companion: 'putting your companion into your hand',
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
        // remembered answers: take one back, or decline the rest of a batch of your optional triggers
        case 'auto': g.autoAnswer(actorId, intent.act === 'decline' ? 'decline' : 'clear', String((intent.act === 'decline' ? intent.batch : intent.id) || '')); break;
        case 'mulligan': g.mulligan(actorId); break;
        case 'keep': g.keepHand(actorId, intent.bottom || []); break;
        case 'playLand': g.playLand(actorId, intent.objId, intent.face === 1 ? 1 : 0); break;
        /* Paid with the lands the game taps, or (fromPool) only with the mana
           the player has tapped for already: tapping lands by hand. */
        case 'cast': g.castSpell(actorId, intent.objId, { targets: intent.targets || [], auto: !payByHand(intent),
          fromPool: payByHand(intent), free: !!intent.free, kick: intent.kick || 0, buyback: !!intent.buyback, entwine: !!intent.entwine,
          // which of an "and/or" kicker's costs were paid (Archangel of Wrath)
          kickPaid: Array.isArray(intent.kickPaid) ? intent.kickPaid.filter(i => Number.isInteger(i) && i >= 0 && i < 4) : undefined,
          // said with the extra costs: an additional cost you may pay (a kicker that is not mana), and the gift
          payAdditional: typeof intent.payAdditional === 'boolean' ? intent.payAdditional : undefined,
          gift: intent.gift === true ? true : intent.gift === null ? null : undefined,
          offspring: !!intent.offspring, squad: intent.squad || 0, casualty: !!intent.casualty,
          spree: intent.spree || null, via: intent.via || null,
          face: intent.face === 1 ? 1 : 0,       // which half of a split card
          fuse: !!intent.fuse,                   // or both halves, fused
          returnId: typeof intent.returnId === 'string' ? intent.returnId : undefined,   // sneak: the attacker that goes back
          ...costPicksOf(intent),
          // what pays instead of mana, when the player chose it: creatures to convoke, artifacts to improvise, cards to delve
          convokeIds: idList(intent.convokeIds), improviseIds: idList(intent.improviseIds), delveIds: idList(intent.delveIds),
          // Torgaar, Dargo: what is sacrificed for less (an empty list: none); left out, the engine picks
          sacrificeIds: idList(intent.sacrificeIds),
          // generic questions answered with the extra costs (replicate, splice); the engine checks them
          choices: intent.choices && typeof intent.choices === 'object' ? intent.choices : null,
          x: Math.max(0, Math.min(99, parseInt(intent.x, 10) || 0)) }); break;
        // cycling, or channel and forecast (the same door), with what a channel ability aims at
        // (Shigeki, Jukai Visionary: the X of a channel cost with {X} in it)
        case 'cycle': g.cycleCard(actorId, intent.objId, { auto: true, channel: intent.channel === true ? true : intent.channel === false ? false : undefined,
          targets: Array.isArray(intent.targets) ? intent.targets : [], x: Math.max(0, Math.min(99, parseInt(intent.x, 10) || 0)) }); break;
        case 'plot': g.plotCard(actorId, intent.objId, { auto: true }); break;
        // Suspend X: the time counters, and the X paid
        case 'suspend': g.suspendCard(actorId, intent.objId, { auto: true,
          x: Number.isFinite(+intent.x) && intent.x != null ? Math.max(1, Math.min(99, Math.floor(+intent.x))) : undefined }); break;
        case 'transmute': g.transmuteCard(actorId, intent.objId, { auto: true }); break;
        case 'encore': g.encoreCard(actorId, intent.objId, { auto: true }); break;
        case 'turnFaceUp': g.turnFaceUp(actorId, intent.objId, { auto: true }); break;
        // the companion: {3} to put it into your hand, once a game (CR 702.139)
        case 'companion': g.companionToHand(actorId, intent.objId, { auto: true }); break;
        /* A cost paid with cards (sacrifice this, discard that) can be chosen up
           front, the way a bot does it; the engine still checks each pick
           against what the cost allows, and asks for anything left over. */
        case 'activate': g.activateAbility(actorId, intent.objId, intent.index, { targets: intent.targets || [], auto: !payByHand(intent),
          fromPool: payByHand(intent),
          // the X of an ability's cost: mana paid, or counters taken off
          x: Number.isFinite(+intent.x) && intent.x != null ? Math.max(0, Math.min(99, Math.floor(+intent.x))) : undefined,
          // "in any combination of two colours": how much of the second
          // or, "in any combination of colors", a colour letter for each
          manaSplit: Array.isArray(intent.manaSplit) ? intent.manaSplit.slice(0, 99).map(String).filter(c => /^[WUBRG]$/.test(c))
            : Number.isFinite(+intent.manaSplit) && intent.manaSplit != null ? Math.max(0, Math.min(99, Math.floor(+intent.manaSplit))) : undefined,
          ...costPicksOf(intent),
          sacrificeIds: Array.isArray(intent.sacrificeIds) ? intent.sacrificeIds.slice(0, 20).map(String) : undefined,
          discardIds: Array.isArray(intent.discardIds) ? intent.discardIds.slice(0, 20).map(String) : undefined }); break;
        case 'mana': g.tapForMana(actorId, intent.objId, intent.index || 0, intent.choice,
          // "in any combination of colors": a colour letter for each, chosen at the table
          Array.isArray(intent.split) ? intent.split.slice(0, 99).map(String).filter(c => /^[WUBRG]$/.test(c)) : undefined); break;
        case 'declareAttackers': g.declareAttackers(actorId, intent.declarations || []); break;
        case 'declareBlockers': g.declareBlockers(actorId, intent.declarations || []); break;
        case 'choice': g.resolveChoice(actorId, intent.data || {}); break;
        case 'concede': g.concede(actorId); break;
        // leaving the table mid-game: out of it, for everyone to see
        case 'leave': g.concede(actorId, 'left'); break;
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
  /* Commander suggestions come from Recommander, asked through a relay
     (tools/recommander-relay): the address, and a test that it answers. */
  function suggestionsGroup(group, pick) {
    const R = MTG.recommander;
    const edhrec = MTG.settings.suggestFrom === 'edhrec';
    const input = el('input', { type: 'text', id: 'opt-rec-relay', value: MTG.settings.recommanderRelay || '',
      placeholder: R && R.relay && !MTG.settings.recommanderRelay ? R.relay : 'https://recommander-relay.yourname.workers.dev', autocomplete: 'off', spellcheck: 'false' });
    const result = el('div', { class: 'opt-help net-test', 'aria-live': 'polite' });
    const save = () => {
      const v = input.value.trim().replace(/\/+$/, '');
      if (v && !/^https:\/\//i.test(v)) return UI.error('A relay address starts with https://');
      MTG.setSetting('recommanderRelay', v);
      UI.ok(v ? 'Relay saved. Commander suggestions are asked through it.' : (R.ready() ? 'Back to the relay built in.' : 'Relay removed.'));
    };
    const test = async (btn) => {
      const v = input.value.trim() || R.relay;
      if (!v) { result.className = 'opt-help net-test bad'; result.textContent = 'There is no relay to test: paste its address first.'; return; }
      btn.disabled = true;
      result.className = 'opt-help net-test';
      result.textContent = 'Asking the relay…';
      const r = await R.test(v);
      btn.disabled = false;
      result.className = 'opt-help net-test ' + (r === true ? 'good' : 'bad');
      result.textContent = r === true ? 'The relay answered with suggestions: Commander decks are suggested from Recommander.' : r;
    };
    const testBtn = el('button', { class: 'btn sm', text: 'Test', onclick: () => testBtn && test(testBtn) });
    return group('suggest', 'Suggestions', 'Card suggestions for a Commander deck in the deck builder. Other formats use the deck builder\u2019s own reading of your list.', [
      pick('suggestFrom', 'Suggest cards from', [['recommander', 'Recommander'], ['edhrec', 'EDHREC']],
        edhrec
          ? 'EDHREC: what other people most often play with your commander, weighed with the deck builder\u2019s own reading of your list.'
          : 'Recommander (recommander.cards) ranks what your list in particular is missing, learned from a great many real decks. If it cannot be reached, EDHREC is used instead.',
        'recommander'),
      edhrec ? null : el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
        el('div', { class: 'opt-label', text: 'Recommander relay' }),
        el('div', { class: 'opt-help', text: 'Recommander answers only its own website from a browser, so the app asks through a small relay of your own: a free Cloudflare Worker (the steps are in tools/recommander-relay/README.md). Paste its address here.' }),
        el('label', { class: 'field' }, [el('span', { text: 'Address' }), input]),
        el('div', { class: 'row wrap', style: { marginTop: '10px' } }, [
          el('button', { class: 'btn sm primary', text: 'Save relay', onclick: save }),
          testBtn,
        ]),
        result,
      ])),
    ].filter(Boolean));
  }

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
        if (sess.game) {
          const p = sess.game.player(r.id);
          if (p) {
            sess.game.setConnected(p.id, false); sess.pushState();
            /* not back within a minute (a tab closed, a phone put away): out of
               the game, and shown so to everyone left; coming back in time
               keeps the seat (addRemote) */
            sess._gone = sess._gone || new Map();
            clearTimeout(sess._gone.get(r.id));
            sess._gone.set(r.id, setTimeout(() => {
              sess._gone.delete(r.id);
              const g2 = sess.game, q = g2 && g2.player(r.id);
              if (App.session === sess && q && q.connected === false && !q.hasLost && !g2.over) { g2.concede(q.id, 'left'); sess.pushState(); }
            }, LEFT_AFTER_MS));
          }
        }
        else { sess.roster = sess.roster.filter(x => x !== r); sess.broadcastLobby(); renderLobbySoon(); }
      }
    });
    net.on('hello', (peerId, payload) => {
      const sess = App.session;
      if (!sess) { net.send(peerId, { t: 'error', payload: 'The host is not in a lobby.' }); return; }
      const seat = sess.addRemote(peerId, MTG.names.fit(String((payload && payload.name) || '').slice(0, 28).trim() || 'Player'), payload && payload.token);
      // kept with the seat, because the game they are for may not exist yet
      if (payload && payload.autoPass && seat) seat.autoPass = payload.autoPass;
      // their profile picture, if it is one (a small image, nothing else)
      if (seat) seat.avatar = payload && UI.isAvatar(payload.avatar) ? payload.avatar : null;
      if (seat) seat.sleeve = App.cleanSleeve(payload && payload.sleeve);
      if (seat && seat.sleeve && seat.sleeve.ref) askGif(seat.sleeve.ref.h);
      if (seat) seat.frame = payload && typeof payload.frame === 'string' && MTG.economy.frameById(payload.frame) ? payload.frame : null;
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
      if (payload.kind === 'profile') {
        const name = MTG.names.fit(String(payload.name || '').slice(0, 28).trim(), '') || r.name;
        r.name = name;
        r.avatar = UI.isAvatar(payload.avatar) ? payload.avatar : null;
        r.sleeve = App.cleanSleeve(payload.sleeve);
        if (r.sleeve && r.sleeve.ref) askGif(r.sleeve.ref.h);
        r.frame = typeof payload.frame === 'string' && MTG.economy.frameById(payload.frame) ? payload.frame : null;
        const p = sess.game && sess.game.player(r.id);
        if (p) p.name = name;
        sess.broadcastLobby();
        if (sess.game) sess.pushState();
        if (App.table && App.table.view) App.table.render();
        renderLobbySoon();
        return;
      }
      if (payload.kind === 'setDeck') {
        try {
          r.deck = await fatDeckFromWire(payload.deck);
          r.art = (payload.deck && payload.deck.art) || null;
          r.deckValid = MTG.formats.validate(r.deck, sess.fmt);
          if (payload.name) r.name = MTG.names.fit(String(payload.name).slice(0, 28).trim(), '') || r.name;
          sess.broadcastLobby();
          renderLobbySoon();
        } catch (e) { net.send(peerId, { t: 'error', payload: 'Your deck could not be loaded: ' + e.message }); }
        return;
      }
      sess.handleIntent(r.id, payload);
    });
    net.on('lobby', (payload) => {
      askSeatGifs(payload && payload.members);
      renderClientLobbyData(payload);
      if (App.table && App.table.view) App.table.render();
    });
    const showView = (view) => {
      // a game while this guest was still building after a draft: the host stopped waiting, and dealt a deck built from the picks
      if (App._buildingPool) {
        App._buildingPool = false;
        if (App._poolBuilder && App._poolBuilder.close) App._poolBuilder.close();
        App._poolBuilder = null;
        UI.toast('The game started before your deck was finished, so you play one built from your picks.', '', 7000);
      }
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
      if (msg.t === 'gif:want') { gotGifWant(from, msg); return; }
      if (msg.t === 'gif:part') { gotGifPart(from, msg); return; }
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
        App.keepDrafted(view.pool);
        // the builder is kept hold of, to be put away if the host starts without waiting any longer
        Promise.resolve(UI.buildFromPool(view.pool, view.formatId || App.formatId, (deck) => {
          App._buildingPool = false;
          App._poolBuilder = null;
          net.intent({ kind: 'setDeck', deck: slimDeckForWire(deck) });
        })).then((m) => { App._poolBuilder = App._buildingPool ? m || null : null; });
      }
    });
    net.on('chat', (msg) => {
      // an emote travels as a chat line of its own
      const em = msg && typeof msg.text === 'string' && /^::emote:([a-z]+)$/.exec(msg.text);
      if (em) { App.emoteFrom(msg.from, em[1]); return; }
      if (App.table) App.table.addChat(msg);
    });
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
    net.on('kicked', (m) => { gifs.clear(); UI.error('Removed from the table: ' + m); showScreen('home'); });
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

  /** How long a seat that has dropped out of an online game is kept before it is out of the game. */
  const LEFT_AFTER_MS = 60000;

  App.leaveGame = function (opts) {
    opts = opts || {};
    /* Leaving an online game still being played: out of it, and the others
       see you defeated. A guest says so to the host on the way out; a host
       with guests concedes and shows them the last of it. The connection
       stays open a moment for that to get through. */
    let linger = 0;
    const tv = App.table && App.table.view;
    if (net.online && tv && !tv.over && !tv.replay && App.table.me && !App.table.me.hasLost) {
      if (net.isClient) { try { net.intent({ kind: 'leave' }); linger = 450; } catch (e) { /* gone already */ } }
      else if (App.session && App.session.game && App.session.roster.some(r => r.kind === 'remote')) {
        const meSeat = App.session.roster.find(r => r.kind === 'local');
        if (meSeat) { try { App.session.game.concede(meSeat.id, 'left'); App.session.pushState(); linger = 450; } catch (e) { /* leave anyway */ } }
      }
    }
    if (App.replay) { App.replay.stop(); App.replay = null; }
    if (App.session && App.session.botRunner) App.session.botRunner.stop();
    if (App.session && App.session.draftTimer) clearInterval(App.session.draftTimer);
    if (App.table) { App.table.destroy(); App.table = null; }
    App.session = null;
    // the other players' moving sleeves were for that match only
    gifs.clear();
    if (App.draftUI && App.draftUI.destroy) App.draftUI.destroy();
    App.draftUI = null;
    // a deck being built after a draft was for that table
    if (App._poolBuilder && App._poolBuilder.close) App._poolBuilder.close();
    App._buildingPool = false;
    App._poolBuilder = null;
    if (!opts.keepSave) MTG.savedGame.clear();
    if (linger) setTimeout(() => { net.destroy(); setNetBadge(); }, linger);
    else net.destroy();
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
    // the guests are asked first, and whoever says no is left out (src/12h-ui-rematch.js)
    if (MTG.rematch && !await MTG.rematch.gather(sess)) return;
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
  // sealed and Jumpstart go back to the table setup when something stops them (src/13b-ui-sealed.js)
  App.renderLobby = renderLobby;
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

