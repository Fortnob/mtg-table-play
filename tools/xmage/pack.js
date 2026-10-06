/* Write the translated lines out as src/19-cardlib.js: a packed table, so
   the many abilities cards share are stored once. */
'use strict';
const fs = require('fs');

/** JSON with its keys in a fixed order, so the same ability always packs the same. */
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  }
  return JSON.stringify(x);
}

const HEADER = `/* ============================================================
   19-cardlib.js - generated card scripts

   Built by tools/xmage/build.js --write from XMage's card sources (see
   tools/xmage/ and tools/README.md). XMage composes each card out of ability
   and effect objects; that structure is an exact description of what the
   card does, so the translator walks it and writes the same thing in this
   engine's vocabulary. Nothing here is hand-edited: change the translators
   and build again.

   Each card is a set of printed lines, keyed by a hash of the line as the
   text parser sees it. A line from here stands in for that line only when
   reading the text did not manage it, and only when every construct in it
   was recognised and the result agrees with the printed words. A
   hand-written script in 18-scripts.js, or one of the player's own, always
   wins, and anything not covered still falls through to the assisted tools.

   The table is packed because most cards share their shapes: \`shapes\` holds
   every distinct ability once, and each line is a list of indexes into it.

   Card behaviour translated from XMage (https://github.com/magefree/mage),
   MIT licensed, Copyright (c) 2010 BetaSteward and the XMage authors.
   ============================================================ */
'use strict';
(function (MTG) {
  const PACKED = `;

const FOOTER = `;

  const cache = new Map();

  /* Keys are card names as 18-scripts.js keys them. A name typed with
     different punctuation still finds its card: both sides are flattened
     the same way, to letters and digits. */
  function flatten(key) {
    return String(key || '').replace(/['\\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  let flat = null;

  /**
   * The generated script for a card, unpacked on first use:
   * { lines: { lineHash: [abilities] }, kw, generated: true }, plus
   * { abilities } for a card written out whole.
   */
  function generatedFor(key) {
    if (cache.has(key)) return cache.get(key);
    let row = PACKED.cards[key];
    if (!row) {
      if (!flat) {
        flat = new Map();
        for (const k in PACKED.cards) flat.set(flatten(k), PACKED.cards[k]);
      }
      row = flat.get(flatten(key));
    }
    if (!row) { cache.set(key, null); return null; }
    const out = { generated: true };
    if (row[0] && row[0].length) out.abilities = row[0].map(i => PACKED.shapes[i]);
    if (row[1] && row[1].length) out.kw = row[1].map(i => PACKED.kw[i]);
    if (row[2] && row[2].length) {
      out.lines = {};
      for (const [hash, list] of row[2]) out.lines[hash] = list.map(i => PACKED.shapes[i]);
    }
    // lines whose translation replaces even a reading of the text
    if (row[3] && row[3].length) {
      out.override = {};
      for (const hash of row[3]) out.override[hash] = true;
    }
    cache.set(key, out);
    return out;
  }

  MTG.cardlib = {
    generatedFor,
    count: () => Object.keys(PACKED.cards).length,
    shapes: () => PACKED.shapes.length,
    keys: () => Object.keys(PACKED.cards),
  };
})(window.MTG);
`;

/**
 * lib: card key -> { lines: { hash: [abilities] }, abilities?, kw? }
 */
function write(lib, file, keyFor) {
  const shapes = [];
  const index = new Map();
  const kw = [];
  const kwIndex = new Map();
  const shape = (ab) => {
    const s = canon(ab);
    if (!index.has(s)) { index.set(s, shapes.length); shapes.push(JSON.parse(s)); }
    return index.get(s);
  };
  const cards = {};
  for (const name of Object.keys(lib).sort()) {
    const e = lib[name];
    const key = keyFor ? keyFor(name) : name.toLowerCase();
    const whole = (e.abilities || []).map(shape);
    const kws = (e.kw || []).map(k => { if (!kwIndex.has(k)) { kwIndex.set(k, kw.length); kw.push(k); } return kwIndex.get(k); });
    const lines = Object.keys(e.lines || {}).sort().map(h => [h, e.lines[h].map(shape)]);
    const over = Object.keys(e.override || {}).sort();
    cards[key] = over.length ? [whole, kws, lines, over] : [whole, kws, lines];
  }
  const packed = { v: 2, shapes, kw, cards };
  fs.writeFileSync(file, HEADER + JSON.stringify(packed) + FOOTER);
  return { cards: Object.keys(cards).length, shapes: shapes.length };
}

module.exports = { write, canon };
