/* ============================================================
   05-decklist.js - paste a decklist from anywhere, get a deck
   Handles the export formats of MTGGoldfish, Moxfield, Archidekt,
   TappedOut, Deckstats, EDHREC, CubeCobra, MTG Arena and plain text.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* Section headers seen in the wild, mapped to our buckets. */
  const SECTIONS = [
    [/^(deck|main ?deck|mainboard|main)\b[: ]*$/i, 'main'],
    [/^(side ?board|sb)\b[: ]*$/i, 'sideboard'],
    [/^(commander|commanders|general)\b[: ]*$/i, 'commander'],
    // Oathbreaker lists: both go to the command zone, and the card type tells them apart later
    [/^(oathbreakers?|signature ?spells?)\b[: ]*$/i, 'commander'],
    [/^(companion)\b[: ]*$/i, 'companion'],
    [/^(maybe ?board|considering|acquire)\b[: ]*$/i, 'maybeboard'],
    [/^(tokens?)\b[: ]*$/i, 'tokens'],
    [/^(planes?|scheme|contraption|attractions?)\b[: ]*$/i, 'other'],
    [/^(lands?|creatures?|instants?|sorceries|artifacts?|enchantments?|planeswalkers?|battles?|spells?|ramp|removal|draw|utility|other)\s*\(?\d*\)?[: ]*$/i, null], // category header inside main
  ];

  /* One deck line. Everything is optional except the name. */
  const LINE_RE = new RegExp(
    '^\\s*' +
    '(?:(?<sb>SB|MB|CMDR|CO)\\s*:\\s*)?' +                 // "SB: 2 Card"
    '(?:(?<qty>\\d+)\\s*[xX]?\\s+|(?<qty2>\\d+)[xX]\\s*)?' + // "4 " / "4x "
    '(?<name>.+?)' +
    '(?:\\s+[\\[(](?<set>[A-Za-z0-9_]{2,6})[\\])])?' +      // (NEO) or [NEO]
    '(?:\\s+(?<cn>[A-Za-z]?\\d+[A-Za-z★]*))?' +        // collector number
    '(?:\\s+\\*(?<foil>F|E)\\*)?' +                          // *F* foil marker
    '(?:\\s*\\[(?<tags>[^\\]]*)\\])?' +                      // Archidekt [Maybeboard{...}]
    '(?:\\s*#!?(?<cat>.*))?' +                               // Deckstats #!Category
    '\\s*$');

  function parse(text, opts) {
    opts = opts || {};
    const out = {
      main: [], sideboard: [], commanders: [], companion: null, maybeboard: [],
      name: opts.name || '', notes: [], unparsed: [],
    };
    let section = 'main';
    let sawExplicitCommander = false;
    const lines = String(text || '').replace(/\r/g, '').split('\n');

    // A leading "// Deck name" or "Name: ..." line
    for (const raw of lines.slice(0, 3)) {
      const m = raw.match(/^\s*(?:\/\/\s*)?(?:deck ?name|name)\s*[:=]\s*(.+)$/i);
      if (m && !out.name) out.name = m[1].trim();
    }

    for (let raw of lines) {
      let line = raw.trim();
      if (!line) { continue; }
      if (/^(\/\/|#(?!!)|;)/.test(line)) {                    // comment
        const c = line.replace(/^(\/\/|#|;)\s?/, '');
        if (c && !/^deck ?name/i.test(c)) out.notes.push(c);
        // MTGGoldfish sometimes writes "// Sideboard"
        const asSection = matchSection(c);
        if (asSection !== undefined) { if (asSection) section = asSection; continue; }
        continue;
      }

      const sec = matchSection(line);
      if (sec !== undefined) { if (sec) section = sec; continue; }

      const m = LINE_RE.exec(line);
      if (!m || !m.groups.name) { out.unparsed.push(line); continue; }
      const g = m.groups;

      let name = g.name.trim()
        .replace(/\s*\{[^}]*\}\s*$/, '')            // stray {noPrice}
        .replace(/\s*\(.*?\)\s*$/, (s) => (/\(\w{2,6}\)/.test(s) ? '' : s))
        .trim();
      if (!name || /^\d+$/.test(name)) { out.unparsed.push(line); continue; }

      // Split cards: keep the full "A // B" name, Scryfall understands it
      name = name.replace(/\s*\/\/\s*/g, ' // ');

      const qty = parseInt(g.qty || g.qty2 || '1', 10) || 1;
      let bucket = section;
      if (g.sb) {
        const s = g.sb.toUpperCase();
        bucket = s === 'SB' ? 'sideboard' : s === 'MB' ? 'maybeboard' : s === 'CO' ? 'companion' : 'commander';
      }
      if (g.tags) {
        const t = g.tags.toLowerCase();
        if (t.includes('maybeboard')) bucket = 'maybeboard';
        else if (t.includes('sideboard')) bucket = 'sideboard';
        else if (t.includes('commander')) bucket = 'commander';
      }

      const entry = {
        qty, name,
        set: g.set ? g.set.toLowerCase() : null,
        collector_number: g.cn || null,
        foil: !!g.foil,
        category: g.cat ? g.cat.trim() : null,
      };
      // "(NEO)" that is actually part of a card name is rare; if the "set" is
      // not 3-5 alnum chars we treat it as name text instead.
      if (entry.set && !/^[a-z0-9]{2,6}$/.test(entry.set)) { entry.name += ' (' + g.set + ')'; entry.set = null; }

      if (bucket === 'commander') { out.commanders.push(entry); sawExplicitCommander = true; }
      else if (bucket === 'companion') out.companion = entry;
      else if (bucket === 'sideboard') out.sideboard.push(entry);
      else if (bucket === 'maybeboard') out.maybeboard.push(entry);
      else if (bucket === 'tokens' || bucket === 'other') { /* ignore */ }
      else out.main.push(entry);
    }

    // Heuristic: an EDH list pasted with the commander as the first single card
    // and a 99-card main deck, with no explicit section, is very common.
    // (A sixty-card commander format says its own size: opts.deckSize.)
    if (!sawExplicitCommander && opts.assumeCommander) {
      const total = U.sum(out.main.map(e => e.qty));
      if (total === (opts.deckSize || 100) && out.main[0] && out.main[0].qty === 1) {
        out.commanders.push(out.main.shift());
      }
    }
    out.sawExplicitCommander = sawExplicitCommander;
    return out;
  }

  function matchSection(line) {
    for (const [re, bucket] of SECTIONS) {
      if (re.test(line.trim())) return bucket;
    }
    return undefined;
  }

  /* ---------------- resolving to real cards ---------------- */

  /**
   * resolve(parsed, {preferSet, useArtPrefs, onProgress})
   *  -> { main:[{card, qty, requested}], sideboard, commanders, companion,
   *       missing:[{name, qty}], warnings:[] }
   * Honours the player's saved art preferences (oracle_id -> print id) so an
   * imported list comes in with the art they picked.
   */
  async function resolve(parsed, opts) {
    opts = opts || {};
    const prefs = opts.useArtPrefs === false ? {} : (MTG.settings.artPreferences || {});
    const buckets = [
      ['main', parsed.main], ['sideboard', parsed.sideboard],
      ['commanders', parsed.commanders], ['maybeboard', parsed.maybeboard],
    ];
    if (parsed.companion) buckets.push(['companion', [parsed.companion]]);

    const flat = [];
    for (const [key, list] of buckets)
      for (const e of list) flat.push({ key, entry: e });

    const identifiers = flat.map(({ entry }) => {
      if (entry.set && entry.collector_number) return { set: entry.set, collector_number: entry.collector_number };
      if (entry.set) return { name: entry.name, set: entry.set };
      return { name: entry.name };
    });

    const { cards, notFound } = await MTG.scry.collection(identifiers, opts.onProgress);

    const res = { main: [], sideboard: [], commanders: [], maybeboard: [], companion: null, missing: [], warnings: [] };
    const needPref = [];

    for (let i = 0; i < flat.length; i++) {
      const { key, entry } = flat[i];
      let card = cards[i];
      if (!card) { res.missing.push({ name: entry.name, qty: entry.qty }); continue; }
      // apply saved art preference unless the list pinned a specific printing
      if (!entry.collector_number && card.oracle_id && prefs[card.oracle_id] && prefs[card.oracle_id] !== card.id)
        needPref.push({ i, key, entry, wantId: prefs[card.oracle_id] });
      const item = { card, qty: entry.qty, requested: entry, foil: entry.foil, category: entry.category };
      if (key === 'companion') res.companion = item;
      else if (key === 'commanders') res.commanders.push(item);
      else res[key].push(item);
    }

    // fetch preferred printings in one batch
    if (needPref.length) {
      const { cards: prefCards } = await MTG.scry.collection(needPref.map(p => ({ id: p.wantId })));
      needPref.forEach((p, k) => {
        const pc = prefCards[k];
        if (!pc) return;
        const list = p.key === 'companion' ? [res.companion] : res[p.key];
        const item = list.find(x => x && x.requested === p.entry);
        if (item) item.card = pc;
      });
    }

    // set-preference pass: if the player asked to prefer a set, swap where possible
    if (opts.preferSet) {
      for (const key of ['main', 'sideboard', 'commanders']) {
        for (const item of res[key]) {
          if (item.requested.set || item.card.set === opts.preferSet) continue;
          try {
            const prints = await MTG.scry.printings(item.card);
            const hit = prints.find(p => p.set === opts.preferSet);
            if (hit) item.card = hit;
          } catch (e) { /* keep default */ }
        }
      }
    }

    if (res.missing.length)
      res.warnings.push(`${res.missing.length} card${res.missing.length === 1 ? '' : 's'} could not be found on Scryfall.`);
    if (parsed.unparsed.length)
      res.warnings.push(`${parsed.unparsed.length} line${parsed.unparsed.length === 1 ? '' : 's'} were not understood and were skipped.`);
    return res;
  }

  /**
   * Who sits in the command zone, once the cards are known: a commander
   * guessed from the head of an unmarked list is checked, a missing one is
   * looked for, and an Oathbreaker list's Signature Spell is found. Works on
   * `resolved` in place and says what it guessed in its warnings.
   */
  function seatCommanders(parsed, resolved, fmt) {
    if (!fmt || !fmt.commander) return resolved;
    const F = MTG.formats;
    const oath = !!fmt.oathbreaker;

    /* A commander guessed from the head of a list with no headers has to
       be able to lead it; otherwise it was just the first card. */
    if (!parsed.sawExplicitCommander && resolved.commanders.length &&
        !resolved.commanders.every(e => F.canBeCommander(e.card, fmt))) {
      resolved.main.unshift(...resolved.commanders.splice(0));
    }

    // If the format wants a commander and none was tagged, try to infer one.
    if (!resolved.commanders.some(e => !F.isSignatureSpell(e.card))) {
      const legends = resolved.main.filter(e => F.canBeCommander(e.card, fmt));
      const role = oath ? 'Oathbreaker' : 'commander';
      if (legends.length === 1) {
        resolved.commanders.unshift(legends[0]);
        resolved.main.splice(resolved.main.indexOf(legends[0]), 1);
        resolved.warnings.push(`Using ${legends[0].card.name} as your ${role} (it was the only ${oath ? 'planeswalker'
          : fmt.walkerCommander ? 'legendary creature or planeswalker' : 'legendary creature'}).`);
      } else if (legends.length > 1) {
        resolved.warnings.push(`Several cards could be your ${role} - pick one in the deck builder.`);
      }
    }

    /* Oathbreaker: the Signature Spell. A list with its command zone marked
       has said which it is (the instant or sorcery there); one with no
       headers almost always runs Oathbreaker, then its spell, then the rest. */
    if (oath && resolved.commanders.length && !resolved.commanders.some(e => F.isSignatureSpell(e.card))) {
      const next = parsed.sawExplicitCommander ? null : resolved.main[0];
      if (next && next.qty === 1 && F.isSignatureSpell(next.card)) {
        resolved.commanders.push(resolved.main.shift());
        resolved.warnings.push(`Using ${next.card.name} as your Signature Spell (it came straight after your Oathbreaker).`);
      } else {
        resolved.warnings.push('No Signature Spell was marked - choose one in the deck builder.');
      }
    }
    // the leader first, its Signature Spell after it, whatever order the list gave them in
    if (oath) resolved.commanders.sort((x, y) => (F.isSignatureSpell(x.card) ? 1 : 0) - (F.isSignatureSpell(y.card) ? 1 : 0));
    return resolved;
  }

  /** One call: text in, validated deck out. */
  async function importDeck(text, formatId, opts) {
    opts = opts || {};
    const fmt = MTG.formats.get(formatId);
    const parsed = parse(text, { assumeCommander: !!(fmt && fmt.commander), deckSize: fmt && fmt.commander ? fmt.deckMin : null, name: opts.name });
    const resolved = await resolve(parsed, opts);
    seatCommanders(parsed, resolved, fmt);

    const deck = {
      id: MTG.uid('deck'),
      name: parsed.name || opts.name || 'Imported deck',
      format: formatId,
      main: resolved.main.map(e => ({ card: e.card, qty: e.qty })),
      sideboard: resolved.sideboard.map(e => ({ card: e.card, qty: e.qty })),
      commanders: resolved.commanders.map(e => e.card),
      companion: resolved.companion ? resolved.companion.card : null,
      maybeboard: resolved.maybeboard.map(e => ({ card: e.card, qty: e.qty })),
      source: 'import',
      createdAt: Date.now(),
    };
    const validation = MTG.formats.validate(deck, formatId);
    return { deck, validation, missing: resolved.missing, warnings: resolved.warnings, parsed };
  }

  /* ---------------- export ---------------- */

  function toText(deck, style) {
    style = style || 'plain';
    const line = (e) => {
      const c = e.card;
      if (style === 'moxfield') return `${e.qty} ${c.name} (${String(c.set).toUpperCase()}) ${c.collector_number}`;
      if (style === 'arena') return `${e.qty} ${U.frontName(c.name)} (${String(c.set).toUpperCase()}) ${c.collector_number}`;
      return `${e.qty} ${c.name}`;
    };
    const parts = [];
    const fmt = MTG.formats.get(deck.format);
    if (fmt && fmt.oathbreaker && deck.commanders && deck.commanders.length) {
      // each in its own section, the way Oathbreaker lists are written (and read back in)
      const { leaders, signatures } = MTG.formats.commandParts(deck);
      if (leaders.length) parts.push('Oathbreaker', ...leaders.map(c => line({ card: c, qty: 1 })), '');
      if (signatures.length) parts.push('Signature Spell', ...signatures.map(c => line({ card: c, qty: 1 })), '');
    } else if (deck.commanders && deck.commanders.length) {
      parts.push('Commander');
      for (const c of deck.commanders) parts.push(line({ card: c, qty: 1 }));
      parts.push('');
    }
    if (deck.companion) { parts.push('Companion', line({ card: deck.companion, qty: 1 }), ''); }
    parts.push(style === 'arena' ? 'Deck' : 'Deck');
    for (const e of deck.main) parts.push(line(e));
    if (deck.sideboard && deck.sideboard.length) {
      parts.push('', 'Sideboard');
      for (const e of deck.sideboard) parts.push(line(e));
    }
    return parts.join('\n');
  }

  /* ---------------- cube lists ---------------- */

  /**
   * A cube list is usually one card name per line (CubeCobra "Export > Plain text"),
   * but CSV exports are common too. Returns resolved cards.
   */
  async function importCube(text, opts) {
    opts = opts || {};
    const raw = String(text || '').trim();
    let entries = [];
    if (/^name\s*,/i.test(raw.split('\n')[0] || '')) {
      // CubeCobra CSV: name,CMC,Type,Color,Set,Collector Number,...
      const rows = parseCsv(raw);
      const head = rows.shift().map(h => h.trim().toLowerCase());
      const iName = head.indexOf('name');
      const iSet = head.indexOf('set');
      const iCn = head.findIndex(h => h.includes('collector'));
      for (const r of rows) {
        if (!r[iName]) continue;
        entries.push({ name: r[iName].trim(), set: iSet >= 0 && r[iSet] ? r[iSet].trim().toLowerCase() : null, collector_number: iCn >= 0 && r[iCn] ? r[iCn].trim() : null, qty: 1 });
      }
    } else {
      const parsed = parse(raw);
      entries = parsed.main.concat(parsed.sideboard, parsed.maybeboard);
    }
    const identifiers = entries.map(e => e.set && e.collector_number
      ? { set: e.set, collector_number: e.collector_number }
      : (e.set ? { name: e.name, set: e.set } : { name: e.name }));
    const { cards } = await MTG.scry.collection(identifiers, opts.onProgress);
    const out = [];
    const missing = [];
    for (let i = 0; i < entries.length; i++) {
      const c = cards[i];
      if (!c) { missing.push(entries[i].name); continue; }
      for (let k = 0; k < (entries[i].qty || 1); k++) out.push(c);
    }
    return { cards: out, missing };
  }

  function parseCsv(text) {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }

  MTG.decklist = { parse, resolve, importDeck, seatCommanders, toText, importCube, parseCsv, LINE_RE };
})(window.MTG);


