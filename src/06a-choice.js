/* ============================================================
   06a-choice.js - one way to ask any question

   Most of what the engine asks mid-game used to come in a fixed shape of
   its own — "discard", "scry", "pick a card", "choose a mode" — and each
   shape needed a screen of its own and an answer of its own from the
   bots. A rule that wanted to ask anything new had to wait for both.

   A `choose` question says instead what it is choosing from, how many,
   and what the picks have to add up to, and anything that can read this
   module can ask it, show it and answer it: the engine checks answers
   with check(), the table shows live feedback with progress(), and a bot
   that has no better idea finds a legal answer with solve(). The full
   description is in docs/choices.md.

   Everything here is plain data in and plain data out, so a question can
   cross the network, sit in an undo snapshot, and be read the same way
   by the host, a guest and a bot.
   ============================================================ */
'use strict';
(function (MTG) {
  const KINDS = ['objects', 'players', 'options', 'number'];

  /** A question with every default filled in. Never changes what it is given. */
  function normalize(spec) {
    const s = Object.assign({}, spec || {});
    s.type = 'choose';
    if (!KINDS.includes(s.kind)) s.kind = s.number ? 'number' : s.options ? 'options' : 'objects';
    s.constraints = (s.constraints || []).filter(Boolean);
    if (s.kind === 'number') {
      const n = s.number || {};
      const min = Math.floor(+n.min || 0);
      s.number = { min, max: Math.max(min, Math.floor(n.max != null ? +n.max : min)), step: Math.max(1, Math.floor(+n.step || 1)) };
      return s;
    }
    if (s.kind === 'options') {
      s.options = (s.options || []).map((o, i) => (typeof o === 'string' ? { label: o } : Object.assign({}, o)))
        .map((o, i) => Object.assign(o, { i: o.i != null ? o.i : i }));
      s.items = null;
    } else {
      s.items = (s.items || []).filter(x => x && x.id != null);
      s.options = null;
    }
    const pool = size(s);
    s.repeat = !!(s.repeat && s.kind === 'options');
    s.ordered = !!s.ordered;
    s.optional = !!s.optional;
    let max = s.max != null ? Math.floor(+s.max) : (s.min != null ? Math.floor(+s.min) : 1);
    if (!s.repeat) max = Math.min(max, pool);
    max = Math.max(0, max);
    let min = s.min != null ? Math.floor(+s.min) : max;
    min = Math.max(0, Math.min(min, max));
    s.min = min; s.max = max;
    return s;
  }

  function size(s) { return s.kind === 'options' ? (s.options || []).length : (s.items || []).length; }

  /** What can be picked: object or player ids, or option indexes. */
  function candidates(s) {
    if (s.kind === 'options') return (s.options || []).map((o, i) => i);
    if (s.kind === 'number') return [];
    return (s.items || []).map(x => x.id);
  }

  /** The thing each pick stands for, so constraints can read its numbers. */
  function entryFor(s, pick) {
    if (s.kind === 'options') return (s.options || [])[pick] || null;
    return (s.items || []).find(x => x.id === pick) || null;
  }

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (parseFloat(v) || 0));
  const colourSet = (e) => new Set((e && (e.colors || e.colours)) || []);

  /**
   * Whether the picks so far break a constraint. `final` also checks the
   * floors — a total that has to reach something — which a selection
   * still being made is allowed to be short of.
   */
  function constraintProblem(s, entries, final, hooks) {
    for (const c of s.constraints) {
      const label = c.label || c.key || '';
      switch (c.kind) {
        case 'distinct': {
          const key = c.key || 'name';
          const seen = new Set();
          for (const e of entries) {
            const v = e ? e[key] : undefined;
            if (v == null) continue;
            if (seen.has(v)) return c.reason || (key === 'name' ? 'They must all have different names.' : `No two can share a ${label}.`);
            seen.add(v);
          }
          break;
        }
        /* Atraxa, Grand Unifier: "For each card type, you may put a card of that type" — each pick
           stands for one of its types (`key`, a list), no two for the same one; a card of two types
           counts for only one of them, so the picks need a type each, all different */
        case 'distinctTypes': {
          const key = c.key || 'types';
          const lists = entries.map(e => (e && Array.isArray(e[key]) ? e[key] : []));
          const owner = new Map();
          const place = (i, seen) => {
            for (const t of lists[i]) {
              if (seen.has(t)) continue;
              seen.add(t);
              if (!owner.has(t) || place(owner.get(t), seen)) { owner.set(t, i); return true; }
            }
            return false;
          };
          for (let i = 0; i < lists.length; i++) {
            if (!place(i, new Set())) return c.reason || `Each one has to stand for a different ${label || 'type'}.`;
          }
          break;
        }
        /* Winter, Cynical Opportunist: "any number of cards from your graveyard with four or more card types among
           them" — the values of all the picks' lists together, at least `min` different ones (unionAtLeast) */
        case 'unionAtLeast': {
          if (!final || !entries.length) break;
          const key = c.key || 'types';
          const all = new Set();
          for (const e of entries) for (const v of (e && Array.isArray(e[key]) ? e[key] : [])) all.add(v);
          if (all.size < (c.min || 0)) return c.reason || `That is ${all.size} ${label || 'type'}${all.size === 1 ? '' : 's'} among them; it needs ${c.min}.`;
          break;
        }
        /* Quilled Greatwurm: "removing six counters from among creatures you control" — a repeated option picked
           no more times than its own number (`key`, default 'most': the counters of that kind on that creature) */
        case 'eachAtMost': {
          const key = c.key || 'most';
          const times = new Map();
          for (const e of entries) {
            if (!e) continue;
            times.set(e, (times.get(e) || 0) + 1);
            if (e[key] != null && times.get(e) > num(e[key])) return c.reason || `${e.label || 'That one'}: no more than ${num(e[key])}.`;
          }
          break;
        }
        case 'sum': {
          const total = entries.reduce((k, e) => k + num(e && e[c.key]), 0);
          // (Slaughter the Strong: a power below 0 brings the total back down — the most holds for the whole answer: finalMax)
          if (c.max != null && total > c.max && (final || !c.finalMax)) return c.reason || `That is ${total} ${label}; the most is ${c.max}.`;
          if (final && c.min != null && entries.length && total < c.min) return c.reason || `That is ${total} ${label}; it needs ${c.min}.`;
          break;
        }
        case 'shareColour': {
          if (c.with) {
            const want = new Set(c.with);
            for (const e of entries) {
              if (![...colourSet(e)].some(x => want.has(x))) return c.reason || `${(e && e.name) || 'That'} does not share a colour.`;
            }
          } else if (entries.length > 1) {
            let common = colourSet(entries[0]);
            for (const e of entries.slice(1)) common = new Set([...common].filter(x => colourSet(e).has(x)));
            if (!common.size) return c.reason || 'They must share a colour.';
          }
          break;
        }
        case 'mana': {
          /* The total cost of what was picked, on top of anything already
             owed, has to be payable. Only the engine can say for certain;
             without a way to ask, this is taken on trust. */
          if (!hooks || !hooks.canPay) break;
          const cost = (c.base || '') + entries.map(e => (e && e[c.key || 'cost']) || '').join('');
          if (cost && !hooks.canPay(cost)) return c.reason || 'You cannot pay for all of that.';
          break;
        }
        /* Word of Command: the lands chosen to be tapped have to be able to pay `cost` between them (with what is
           already in the pool). Only the engine can say (hooks.paysWith); without it, taken on trust. */
        case 'pays': {
          if (!final || !hooks || !hooks.paysWith || !c.cost) break;
          if (!hooks.paysWith(entries.map(e => e && e.id).filter(Boolean), c.cost, c.forObj || null)) return c.reason || `Those can't pay ${c.cost}.`;
          break;
        }
        default: break;
      }
    }
    return null;
  }

  /**
   * Check an answer against its question. Returns the answer cleaned up —
   * `{ ok: true, picks, number, order }` — or `{ ok: false, reason }`.
   * `hooks` lets the engine add what only it knows: `canPay(cost)`, and
   * `alive(id)` for whether an object is still where it was.
   */
  function check(spec, answer, hooks) {
    const s = spec && spec.kind && spec.constraints ? spec : normalize(spec);
    const a = answer || {};
    // a card name typed in, where any card's name may be chosen (nameAny)
    if (s.nameAny && a.name != null) {
      const nm = cleanName(a.name);
      if (!nm) return { ok: false, reason: 'Type a card name.' };
      const why = hooks && hooks.nameProblem ? hooks.nameProblem(nm, s.nameAny) : null;
      if (why) return { ok: false, reason: why };
      return { ok: true, picks: [], number: null, order: null, name: nm };
    }
    if (s.kind === 'number') {
      const n = Math.floor(num(a.number != null ? a.number : (Array.isArray(a.picks) ? a.picks[0] : NaN)));
      if (!isFinite(n) || (a.number == null && !Array.isArray(a.picks))) return { ok: false, reason: 'Choose a number.' };
      const nb = s.number;
      if (n < nb.min || n > nb.max) return { ok: false, reason: `Choose a number from ${nb.min} to ${nb.max}.` };
      if ((n - nb.min) % nb.step) return { ok: false, reason: `It has to go up in steps of ${nb.step}.` };
      return { ok: true, picks: [], number: n, order: null };
    }
    let picks = Array.isArray(a.order) && s.ordered ? a.order : a.picks;
    if (!Array.isArray(picks)) return { ok: false, reason: 'Nothing was chosen.' };
    if (s.kind === 'options') picks = picks.map(p => (typeof p === 'string' && /^\d+$/.test(p) ? +p : p));
    const legal = new Set(candidates(s));
    for (const p of picks) if (!legal.has(p)) return { ok: false, reason: 'That is not one of the choices.' };
    if (!s.repeat && new Set(picks).size !== picks.length) return { ok: false, reason: 'The same thing was chosen twice.' };
    if (hooks && hooks.alive) for (const p of picks) if (!hooks.alive(p)) return { ok: false, reason: 'One of those is no longer there.' };
    const n = picks.length;
    if (!(n === 0 && s.optional)) {
      if (n < s.min) return { ok: false, reason: s.min === s.max ? `Choose ${s.min}.` : `Choose at least ${s.min}.` };
      if (n > s.max) return { ok: false, reason: `Choose no more than ${s.max}.` };
      const why = constraintProblem(s, picks.map(p => entryFor(s, p)), true, hooks);
      if (why) return { ok: false, reason: why };
    }
    return { ok: true, picks: picks.slice(), number: null, order: s.ordered ? picks.slice() : null };
  }

  /* ---------- naming a card ----------
     "Choose a card name" may name any card there is (CR 201.3), seen or not, so a question that asks for
     one (`nameAny`, saying what the card must be: { nonland, nonartifact, creature }) offers the names its
     player can see, and takes a name typed in as well: the answer's `name`. */
  const NAME_MAX = 150;
  /** A typed card name made tidy — one line, no control characters, not too long — or null. */
  function cleanName(v) {
    if (typeof v !== 'string') return null;
    const nm = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return nm && nm.length <= NAME_MAX ? nm : null;
  }
  /** What a card's front face is (a double-faced card is its front face away from the battlefield and the stack). */
  function frontType(card) {
    const f = card && card.card_faces && card.card_faces[0];
    return String((f && f.type_line) || (card && card.type_line) || '').split(' // ')[0];
  }
  /** Why a card can't be the one named ("a nonland card name"), or null when it can. */
  function nameMisfit(card, want) {
    if (!card || !want || typeof want !== 'object') return null;
    const t = frontType(card);
    if (!t) return null;
    if (want.nonland && /\bLand\b/.test(t)) return `${card.name} is a land card. Name a nonland card.`;
    if (want.nonartifact && /\bArtifact\b/.test(t)) return `${card.name} is an artifact card. Name a nonartifact card.`;
    if (want.creature && !/\bCreature\b/.test(t)) return `${card.name} isn't a creature card. Name a creature card.`;
    return null;
  }

  /** Whether one more of this could join the picks without breaking a ceiling. */
  function canAdd(spec, picks, pick, hooks) {
    const s = spec;
    if (picks.length >= s.max) return false;
    if (!s.repeat && picks.includes(pick)) return false;
    const next = picks.concat([pick]);
    return !constraintProblem(s, next.map(p => entryFor(s, p)), false, hooks);
  }

  /**
   * How a selection in progress stands, for the table to show: whether it
   * could be sent as it is, why not, and a line of plain words about it.
   */
  function progress(spec, picks, number) {
    const s = spec;
    if (s.kind === 'number') {
      const r = check(s, { number });
      return { ok: r.ok, reason: r.reason || '', text: `from ${s.number.min} to ${s.number.max}` };
    }
    picks = picks || [];
    const r = check(s, { picks });
    const bits = [];
    const n = picks.length;
    if (s.min === s.max) bits.push(`${n} of ${s.max} chosen${s.optional && s.min && !n ? ', or none' : ''}`);
    else if (!s.min) bits.push(`${n} chosen (up to ${s.max})`);
    else bits.push(`${n} chosen (${s.min}–${s.max})`);
    for (const c of s.constraints) {
      if (c.kind === 'sum') {
        const total = picks.reduce((k, p) => k + num((entryFor(s, p) || {})[c.key]), 0);
        const lim = c.max != null && c.min != null ? `${c.min}–${c.max}` : c.max != null ? `at most ${c.max}` : `at least ${c.min}`;
        bits.push(`${c.label || c.key} ${total} (${lim})`);
      }
      if (c.kind === 'mana') {
        const cost = picks.map(p => (entryFor(s, p) || {})[c.key || 'cost'] || '').join('');
        if (cost) bits.push('costs ' + cost + ' more');
      }
    }
    return { ok: r.ok, reason: r.ok ? '' : r.reason, text: bits.join(' · ') };
  }

  /**
   * Find a legal answer. `order` is the candidates in the order they are
   * wanted (best first); `most` takes as many as will fit, otherwise the
   * fewest that make a legal answer. Returns null when there is none —
   * which the engine takes to mean the question need not be asked.
   */
  function solve(spec, opts) {
    opts = opts || {};
    const s = spec && spec.kind && spec.constraints ? spec : normalize(spec);
    if (s.kind === 'number') {
      const want = opts.number != null ? opts.number : (opts.most ? s.number.max : s.number.min);
      let n = Math.max(s.number.min, Math.min(s.number.max, Math.floor(num(want))));
      n -= (n - s.number.min) % s.number.step;
      return { picks: [], number: n };
    }
    const all = candidates(s);
    const order = (opts.order || []).filter(p => all.includes(p)).concat(all.filter(p => !(opts.order || []).includes(p)));
    const hooks = opts.hooks || null;
    let steps = 0;
    const LIMIT = 4000;
    const ok = (picks) => check(s, { picks }, hooks).ok;
    const most = !!opts.most;
    const rec = (start, picks) => {
      if (++steps > LIMIT) return null;
      if (!most && picks.length >= s.min && ok(picks)) return picks;
      if (picks.length < s.max) {
        for (let j = start; j < order.length; j++) {
          const p = order[j];
          if (!canAdd(s, picks, p, hooks)) continue;
          const r = rec(s.repeat ? j : j + 1, picks.concat([p]));
          if (r) return r;
          if (steps > LIMIT) break;
        }
      }
      return most && picks.length >= s.min && ok(picks) ? picks : null;
    };
    const found = (s.min === 0 && !most && !opts.order) ? [] : rec(0, []);
    if (found) return { picks: found, number: null, order: s.ordered ? found.slice() : null };
    if (s.optional || s.min === 0) return { picks: [], number: null, order: null };
    return null;
  }

  /* ---------- the older question shapes, said the new way ----------
     A handful of the fixed types are simple enough to be one of these
     questions with a different answer shape. The table shows them with
     the one renderer, and the engine takes the new answer for them as
     well as the old one. */
  const LEGACY = new Set(['confirm', 'vote', 'mode', 'pickCard']);

  function fromLegacy(ch) {
    if (!ch || !LEGACY.has(ch.type)) return null;
    const base = { playerId: ch.playerId, purpose: ch.purpose || ch.type, prompt: ch.prompt || '', legacy: ch.type,
      sourceName: ch.sourceName || null, sourceId: ch.sourceId || ch.objId || null, sourceCard: ch.sourceCard || null,
      sourceText: ch.sourceText || null };
    if (ch.type === 'confirm') {
      return normalize(Object.assign(base, { kind: 'options', compact: true, min: 1, max: 1,
        options: [{ label: ch.noLabel || 'No' }, { label: ch.yesLabel || 'Yes', primary: true }] }));
    }
    if (ch.type === 'vote') {
      return normalize(Object.assign(base, { kind: 'options', compact: true, min: 1, max: 1,
        options: (ch.options || []).map(o => ({ label: String(o) })) }));
    }
    if (ch.type === 'mode') {
      const count = Math.max(1, ch.count || 1);
      // "choose one or more", "choose up to one": a range, when the question gives one
      const min = ch.min != null ? Math.max(0, ch.min) : count, max = ch.max != null ? Math.max(min, ch.max) : count;
      return normalize(Object.assign(base, { kind: 'options', min, max, repeat: !!ch.repeatable,
        options: (ch.options || []).map((o, k) => Object.assign({ label: o.label, i: o.i != null ? o.i : k }, o.card ? { card: o.card } : {})) },
        // (Pithing Needle's name: any card's may be typed in)
        ch.nameAny ? { nameAny: ch.nameAny } : {}));
    }
    // pickCard: a face-up row of particular cards
    const cards = ch.cards || [];
    const want = Math.min(Math.max(1, ch.count || 1), cards.length);
    return normalize(Object.assign(base, { kind: 'objects', min: ch.optional ? 0 : want, max: want, panel: true,
      items: cards.map(c => ({ id: c.id, name: c.name || (c.card && c.card.name) || '', card: c.card || null })) }));
  }

  /** The old answer for an older question answered the new way. */
  function legacyData(ch, answer) {
    if (ch.type === 'mode' && ch.nameAny && answer && answer.name != null) return { name: answer.name };
    const picks = (answer && answer.picks) || [];
    switch (ch.type) {
      case 'confirm': return { yes: picks[0] === 1 };
      case 'vote': return { choice: (ch.options || [])[picks[0] != null ? picks[0] : 0] };
      case 'mode': return { modes: picks.map(k => { const o = (ch.options || [])[k]; return o ? (o.i != null ? o.i : k) : k; }) };
      case 'pickCard': return { cardIds: picks.slice() };
      default: return null;
    }
  }

  MTG.choice = { KINDS, normalize, candidates, entryFor, check, canAdd, progress, solve, fromLegacy, legacyData, LEGACY,
    cleanName, nameMisfit, NAME_MAX };
})(window.MTG);
