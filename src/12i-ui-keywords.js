/* ============================================================
   12i-ui-keywords.js - a creature's keywords at a glance
   On the battlefield each permanent wears a small symbol for every
   keyword it has right now, printed or given (a wing for flying, a
   heart for lifelink), so a board can be read without hovering every
   card. The words are on the symbols for a screen reader, and the
   enlarged card still explains each one in full.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui = MTG.ui || {};

  // drawn on a 24-unit square; filled unless the icon says stroke
  const P = {
    wing: '<path d="M2.5 15.5c5.5-.4 9.6-3.4 12-9.5 1.6 3.4 1.2 6.3-.6 8.6 2.6.2 5.2-.6 7.6-2.4-1.8 5.6-6.8 8.8-12.6 8.8-2.9 0-5.1-1.6-6.4-5.5z"/>',
    reach: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M12 21V4M6 10l6-6 6 6M5 21h14"/>',
    trample: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M4 6l6 6-6 6M12 6l6 6-6 6"/>',
    sword: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M5 19L18 6M15 4.5l4.5 4.5M3.5 15.5l5 5M5.5 18.5l-2 2"/>',
    swords: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 20L17 7M15 5l4 4M20 20L7 7M9 5L5 9M3 17l4 4M21 17l-4 4"/>',
    skull: '<path d="M12 2.5a8 8 0 0 0-8 8c0 2.8 1.4 4.6 3.2 5.6V20h9.6v-3.9c1.8-1 3.2-2.8 3.2-5.6a8 8 0 0 0-8-8zm-3 7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zm6 0a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z" fill-rule="evenodd"/>',
    heart: '<path d="M12 20.5s-7.6-4.6-9.2-9.4C1.6 7.4 4 4 7.4 4c2 0 3.5 1.1 4.6 2.7C13.1 5.1 14.6 4 16.6 4 20 4 22.4 7.4 21.2 11.1c-1.6 4.8-9.2 9.4-9.2 9.4z"/>',
    eye: '<path d="M12 5C6.5 5 2.6 9.7 1.5 12c1.1 2.3 5 7 10.5 7s9.4-4.7 10.5-7C21.4 9.7 17.5 5 12 5zm0 3.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z" fill-rule="evenodd"/>',
    bolt: '<path d="M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.5z"/>',
    shield: '<path d="M12 2l8.5 3.2v6.1c0 5.2-3.6 9.2-8.5 10.7-4.9-1.5-8.5-5.5-8.5-10.7V5.2z"/>',
    shieldOff: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M12 2.5l8 3v5.8c0 5-3.4 8.7-8 10.2-4.6-1.5-8-5.2-8-10.2V5.5z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5 19L19 5"/>',
    gem: '<path d="M12 2l8.5 10L12 22 3.5 12z"/>',
    horns: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M3.5 4l6 6.5M20.5 4l-6 6.5M6.5 18c3.2-3.2 7.8-3.2 11 0"/>',
    wall: '<path d="M2.5 5h8.5v4.5H2.5zM13 5h8.5v4.5H13zM2.5 11.5H7V16H2.5zM9 11.5h6V16H9zM17 11.5h4.5V16H17zM2.5 18h8.5v3H2.5zM13 18h8.5v3H13z"/>',
    ward: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="4.2"/>',
    star: '<path d="M12 2l2.7 6.4 6.9.6-5.3 4.5 1.6 6.8L12 16.7 6.1 20.3l1.6-6.8L2.4 9l6.9-.6z"/>',
    drop: '<path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/>',
    ghost: '<path d="M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11.5l2.5-2 2.5 2 2.5-2 2.5 2 2.5-2 2.5 2V10A7.5 7.5 0 0 0 12 2.5zM9 9.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zm6 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z" fill-rule="evenodd"/>',
    path: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 21c0-6 10-6 10-12 0-3-2-5-5-6"/><path d="M12 1.5l2.5 3-3.4 1.2z"/>',
  };

  /* The keywords worth a symbol on the battlefield, and how each looks:
     an icon, or a few letters for the rarer ones. `tone` tints it. */
  const KW = [
    ['flying', 'wing', 'sky'], ['reach', 'reach', 'green'], ['trample', 'trample', 'green'],
    ['first strike', 'sword', 'steel'], ['double strike', 'swords', 'steel'], ['deathtouch', 'skull', 'death'],
    ['lifelink', 'heart', 'life'], ['vigilance', 'eye', 'light'], ['haste', 'bolt', 'fire'],
    ['hexproof', 'shield', 'sea'], ['shroud', 'shieldOff', 'sea'], ['indestructible', 'gem', 'gold'],
    ['menace', 'horns', 'fire'], ['defender', 'wall', 'steel'], ['ward', 'ward', 'sea'],
    ['protection', 'shield', 'light'], ['prowess', 'star', 'sea'], ['infect', 'drop', 'death'],
    ['wither', 'drop', 'death'], ['toxic', 'drop', 'death'], ['fear', 'ghost', 'death'],
    ['intimidate', 'ghost', 'steel'], ['shadow', 'ghost', 'death'], ['skulk', 'ghost', 'steel'],
    ['horsemanship', 'path', 'steel'], ['walk', 'path', 'green'],
    ['annihilator', 'An', 'death'], ['persist', 'Pe', 'death'], ['undying', 'Un', 'death'],
    ['exalted', 'Ex', 'light'], ['flanking', 'Fl', 'steel'], ['bushido', 'Bu', 'steel'],
    ['banding', 'Ba', 'light'], ['afflict', 'Af', 'death'], ['battle cry', 'BC', 'fire'],
    ['training', 'Tr', 'light'], ['mentor', 'Me', 'light'], ['decayed', 'De', 'death'],
    ['myriad', 'My', 'steel'], ['rampage', 'Ra', 'green'], ['provoke', 'Pv', 'green'],
  ];

  /** The symbol for one keyword as the engine names it ("flying", "ward {2}", "islandwalk"), or null. */
  function lookup(word) {
    const w = String(word || '').toLowerCase().trim();
    for (const k of KW) {
      if (w === k[0] || w.startsWith(k[0] + ' ') || (k[0] === 'walk' && /walk$/.test(w) && w !== 'walk')) return k;
    }
    return null;
  }

  /**
   * The symbols for a permanent's keywords, in a column, or null when it
   * has none worth one. At most `max` are drawn; more say how many more.
   */
  UI.keywordIcons = function (keywords, opts) {
    opts = opts || {};
    const max = opts.max || 6;
    const seen = new Set();
    const items = [];
    for (const word of (keywords || [])) {
      const k = lookup(word);
      if (!k || seen.has(k[0] === 'walk' ? String(word).toLowerCase() : k[0])) continue;
      seen.add(k[0] === 'walk' ? String(word).toLowerCase() : k[0]);
      items.push([String(word), k]);
    }
    if (!items.length) return null;
    const shown = items.slice(0, max);
    const box = el('div', { class: 'cv-mark cv-kws', role: 'img', 'aria-label': 'Keywords: ' + items.map(i => i[0]).join(', ') });
    for (const [word, [, icon, tone]] of shown) {
      const art = P[icon];
      box.appendChild(el('span', { class: 'kw-ic tone-' + tone + (art ? '' : ' kw-txt'), 'aria-hidden': 'true', dataset: { kw: word.toLowerCase() } },
        art ? null : icon));
      if (art) box.lastChild.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${art}</svg>`;
    }
    if (items.length > max) box.appendChild(el('span', { class: 'kw-ic kw-txt tone-steel', 'aria-hidden': 'true', text: '+' + (items.length - max) }));
    return box;
  };

  /** The mark of a creature that came under its controller's control this turn: it cannot attack or tap yet. */
  UI.sickMark = function () {
    const m = el('div', { class: 'cv-mark cv-sick', role: 'img', 'aria-label': 'Summoning sick: it can’t attack or use a tap ability this turn' });
    m.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7L3 14h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 12h6l-6 7h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return m;
  };

  UI.keywordIcons.lookup = lookup;
})(window.MTG);
