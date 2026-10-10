#!/usr/bin/env node
/* A page for choosing each pack's picture by eye: every set the Store
   sells, the picture its packs wear now, the others it could wear, any
   other card's art found by a search, and a pack-shaped frame to place
   and zoom the chosen one in. What is chosen comes out as JSON, to be
   read back into src/10d0-packart.js.

   node tools/packart-picker.js     writes tools/out/packart-picker.html

   The sets and their pictures are this app's own (src/10d0-packart.js,
   src/10d1-packfocus.js), handed out in the order the Store hands them
   out, so "now" is what a player sees. The page asks Scryfall for the
   pictures, the cards' names and the searches as it is used. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, SRC } = require('./engine');

const MTG = load();
for (const f of ['10d0-packart.js', '10d1-packfocus.js']) vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });

const pre = (code) => {
  const s = MTG.packArt[code];
  if (!s) return [];
  const out = [];
  for (let i = 0; i + 40 <= s.length; i += 40) {
    const h = s.slice(i, i + 32);
    out.push({ id: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, ill: s.slice(i + 32, i + 40) });
  }
  return out;
};

(async () => {
  const sets = await MTG.scry.packSets();
  // handed out as the Store does: the reserved ones, then newest to oldest, then the Collector Boosters
  const taken = new Map(), now = new Map();
  const claim = (key, cands) => {
    for (const c of cands) {
      if (taken.has(c.ill) && taken.get(c.ill) !== key) continue;
      taken.set(c.ill, key); now.set(key, c); return;
    }
  };
  for (const code of MTG.packArtReserved || []) claim(code, pre(code).slice(0, 1));
  for (const s of sets) if (!now.has(s.code)) claim(s.code, pre(s.code));
  const collector = (s) => MTG.collectorSets.has(s.code);
  for (const s of sets) if (collector(s)) claim(s.code + ':collector', pre(s.code));

  const data = sets.map(s => ({
    code: s.code, name: s.name, year: (s.released_at || '').slice(0, 4), type: s.set_type,
    collector: collector(s), cands: pre(s.code),
    now: now.get(s.code) || null, nowC: collector(s) ? now.get(s.code + ':collector') || null : null,
  }));
  const html = TEMPLATE
    .replace('/*DATA*/null', JSON.stringify(data))
    .replace('/*FOCUS*/null', JSON.stringify(MTG.artFocus || {}));
  const out = path.join(__dirname, 'out', 'packart-picker.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`wrote ${out}: ${data.length} sets, ${data.filter(d => d.collector).length} with Collector Boosters`);
})().catch((e) => { console.error(e); process.exit(1); });

const TEMPLATE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pack Art Picker</title>
<style>
:root { --bg: #0e1016; --panel: #171a22; --line: rgba(255,255,255,.1); --ink: #eef1f6; --ink2: #a7b1c2; --gold: #f3d77e; --gold2: #c9a24a; --good: #6fd39a; }
:root[data-theme="light"] { --bg: #f4f1ea; --panel: #fff; --line: rgba(0,0,0,.12); --ink: #1d2027; --ink2: #5b6270; --gold: #8a6a1c; --gold2: #b8862b; }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { --bg: #f4f1ea; --panel: #fff; --line: rgba(0,0,0,.12); --ink: #1d2027; --ink2: #5b6270; --gold: #8a6a1c; --gold2: #b8862b; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; }
header { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 16px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
h1 { margin: 0 12px 0 0; font: 600 19px/1.2 Georgia, serif; }
input, select, button { font: inherit; color: inherit; }
input[type=search], input[type=text] { padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); min-width: 0; }
button { padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; }
button.primary { background: linear-gradient(180deg, #f3d77e, #c99a2e); color: #241a05; border-color: transparent; font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
.grow { flex: 1; }
.dim { color: var(--ink2); }
.small { font-size: 12px; }
main { padding: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 16px 12px; }
.set { display: flex; flex-direction: column; gap: 6px; padding: 0; border: 0; background: none; text-align: left; }
.set .nm { font-weight: 600; font-size: 12.5px; line-height: 1.25; }
.set .tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 99px; border: 1px solid var(--line); color: var(--ink2); }
.tag.changed { color: #241a05; background: var(--gold); border-color: transparent; font-weight: 700; }
.pack { position: relative; width: 100%; aspect-ratio: 5 / 8.6; border-radius: 6px; overflow: hidden; background: #241d33 no-repeat; box-shadow: 0 8px 20px rgba(0,0,0,.4); }
.pack .band, .frame .band { position: absolute; left: 0; right: 0; pointer-events: none; }
.frame .band.top, .pack .band.top { top: 0; height: 13%; background: linear-gradient(180deg, rgba(0,0,0,.55), transparent); }
.frame .band.bot, .pack .band.bot { bottom: 0; height: 30%; background: linear-gradient(0deg, rgba(0,0,0,.7) 40%, transparent); }
.pack .lbl { position: absolute; left: 0; right: 0; bottom: 8%; text-align: center; color: #fff; font: 700 11px/1.15 Georgia, serif; text-shadow: 0 1px 3px #000; padding: 0 6px; }
.pack .mk { position: absolute; left: 0; right: 0; top: 3%; text-align: center; color: #f6e6b0; font: 800 10px/1 Georgia, serif; letter-spacing: .12em; text-shadow: 0 1px 2px #000; }
/* the editor */
.ed-back { position: fixed; inset: 0; z-index: 10; background: rgba(4,6,9,.7); display: flex; align-items: center; justify-content: center; padding: 16px; }
.ed { width: min(1100px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; }
.ed h2 { margin: 0 0 4px; font: 600 18px/1.2 Georgia, serif; }
.frame { position: relative; width: 280px; aspect-ratio: 5 / 8.6; border-radius: 8px; overflow: hidden; touch-action: none; cursor: grab; background: #222 no-repeat; box-shadow: 0 10px 30px rgba(0,0,0,.5); user-select: none; }
.frame:active { cursor: grabbing; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.kinds button.on { border-color: var(--gold2); background: color-mix(in srgb, var(--gold2) 25%, var(--panel)); }
.cands { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.cand { position: relative; padding: 0; border: 2px solid transparent; border-radius: 8px; overflow: hidden; background: #222; aspect-ratio: 626 / 457; }
.cand img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cand.on { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold2); }
.cand .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px; font-size: 11px; color: #fff; background: linear-gradient(0deg, rgba(0,0,0,.8), transparent); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cand .why { position: absolute; left: 4px; top: 4px; font-size: 9.5px; font-weight: 700; padding: 1px 5px; border-radius: 99px; background: rgba(0,0,0,.7); color: #fff; }
.cand .why.now { background: var(--gold); color: #241a05; }
.cand .why.taken { background: #b04040; }
.sec { margin: 14px 0 6px; font: 700 11px/1 system-ui; letter-spacing: .14em; text-transform: uppercase; color: var(--ink2); }
textarea { width: 100%; min-height: 160px; font: 12px/1.4 ui-monospace, Consolas, monospace; padding: 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
@media (max-width: 760px) { .ed { grid-template-columns: 1fr; } .frame { width: min(280px, 100%); margin: 0 auto; } }
</style></head>
<body>
<header>
  <h1>Pack Art Picker</h1>
  <input type="search" id="q" placeholder="Find a set…" aria-label="Find a set">
  <label class="small"><input type="checkbox" id="onlyChanged"> Only changed</label>
  <span class="grow"></span>
  <span class="dim small" id="count"></span>
  <button id="export" class="primary">Export choices</button>
</header>
<main><p class="dim small" style="margin-top:0">Click a pack to choose its picture: the one it wears now, the others it could wear, or any card's art from a search. Drag the picture in the frame to place it and use the slider to zoom. The dark bands at the top and bottom are where the pack's own printing goes. Your choices are kept in this browser until you export them.</p>
<div class="grid" id="grid"></div></main>
<script>
const DATA = /*DATA*/null;
const FOCUS = /*FOCUS*/null;
const KEY = 'packart-picker-v1';
const ART_ASPECT = 563 / 451;      // Scryfall's art crops, as the app takes them
const PACK_ASPECT = 5 / 8.6;
let choices = {};
try { choices = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { choices = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(choices)); } catch (e) {} };
const artUrl = (id) => 'https://cards.scryfall.io/art_crop/front/' + id[0] + '/' + id[1] + '/' + id + '.jpg';
const el = (tag, attrs, kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids || [])) if (c != null && c !== false) n.append(c);
  return n;
};
const names = new Map();   // card id -> name, asked of Scryfall as needed
async function nameAll(ids) {
  const want = [...new Set(ids)].filter(id => !names.has(id));
  for (let i = 0; i < want.length; i += 75) {
    try {
      const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: want.slice(i, i + 75).map(id => ({ id })) }) });
      const j = await r.json();
      for (const c of j.data || []) names.set(c.id, c.name);
    } catch (e) { /* names are a nicety */ }
  }
}
/* A picture in a pack-shaped box: the point (fx, fy, fractions of the
   picture) at the box's middle as far as the picture reaches, at zoom
   times "cover". The app draws it the same way. */
function place(node, url, fx, fy, zoom, aspect) {
  const W = node.clientWidth || 140, H = node.clientHeight || W / PACK_ASPECT;
  const A = aspect || ART_ASPECT;
  const dw = Math.max(W, H * A) * zoom, dh = dw / A;
  const left = Math.min(0, Math.max(W - dw, W / 2 - fx * dw));
  const top = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
  node.style.backgroundImage = 'url("' + url + '")';
  node.style.backgroundSize = dw.toFixed(1) + 'px ' + dh.toFixed(1) + 'px';
  node.style.backgroundPosition = left.toFixed(1) + 'px ' + top.toFixed(1) + 'px';
}
const focusOf = (ill) => { const f = FOCUS[String(ill || '').slice(0, 8)]; return f ? [f[0] / 100, f[1] / 100] : [0.5, 0.5]; };
/** What a pack wears: the choice made here, else what it wears now. */
function wearing(set, kind) {
  const ch = choices[set.code + (kind === 'collector' ? ':collector' : '')];
  if (ch) return { id: ch.id, ill: ch.ill, fx: ch.focus[0] / 100, fy: ch.focus[1] / 100, zoom: ch.zoom || 1, changed: true };
  const n = kind === 'collector' ? set.nowC : set.now;
  if (!n) return null;
  const f = focusOf(n.ill);
  return { id: n.id, ill: n.ill, fx: f[0], fy: f[1], zoom: 1, changed: false };
}
function packFace(set, kind, small) {
  const face = el('div', { class: 'pack' }, [el('div', { class: 'band top' }), el('div', { class: 'band bot' }), el('div', { class: 'mk', text: 'MAGIC' }),
    el('div', { class: 'lbl', text: set.name + (kind === 'collector' ? ' · Collector' : '') })]);
  const w = wearing(set, kind);
  if (w) requestAnimationFrame(() => place(face, artUrl(w.id), w.fx, w.fy, w.zoom));
  return face;
}
function draw() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const only = document.getElementById('onlyChanged').checked;
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const n = Object.keys(choices).length;
  document.getElementById('count').textContent = n ? n + ' chosen' : 'Nothing chosen yet';
  for (const set of DATA) {
    if (q && !set.name.toLowerCase().includes(q) && set.code !== q) continue;
    const changed = !!(choices[set.code] || choices[set.code + ':collector']);
    if (only && !changed) continue;
    grid.append(el('button', { class: 'set', type: 'button', title: set.name, onclick: () => edit(set, 'play') }, [
      packFace(set, 'play'),
      el('div', { class: 'nm', text: set.name }),
      el('div', { class: 'tags' }, [el('span', { class: 'tag', text: set.code.toUpperCase() + ' · ' + set.year }), set.type === 'eternal' ? el('span', { class: 'tag', text: 'Eternal' }) : null,
        set.collector ? el('span', { class: 'tag', text: 'Collector' }) : null, changed ? el('span', { class: 'tag changed', text: 'chosen' }) : null]),
    ]));
  }
}
document.getElementById('q').addEventListener('input', draw);
document.getElementById('onlyChanged').addEventListener('change', draw);

/** Every picture worn by some pack now, or chosen here: which pack has it. */
function wornBy() {
  const by = new Map();
  for (const s of DATA) for (const kind of ['play', 'collector']) {
    if (kind === 'collector' && !s.collector) continue;
    const w = wearing(s, kind);
    if (w) by.set(String(w.ill || '').slice(0, 8), s.code + (kind === 'collector' ? ':collector' : ''));
  }
  return by;
}

function edit(set, kind) {
  const key = set.code + (kind === 'collector' ? ':collector' : '');
  const cur = wearing(set, kind);
  let pick = cur ? { id: cur.id, ill: cur.ill, fx: cur.fx, fy: cur.fy, zoom: cur.zoom, aspect: ART_ASPECT } : null;
  const frame = el('div', { class: 'frame' }, [el('div', { class: 'band top' }), el('div', { class: 'band bot' })]);
  const zoom = el('input', { type: 'range', min: '1', max: '3', step: '0.01', value: String(pick ? pick.zoom : 1), 'aria-label': 'Zoom', style: 'flex:1' });
  const nameLine = el('div', { class: 'dim small' });
  const paint = () => {
    if (!pick) return;
    place(frame, artUrl(pick.id), pick.fx, pick.fy, pick.zoom, pick.aspect);
    nameLine.textContent = (names.get(pick.id) || '') + '  ·  centre ' + Math.round(pick.fx * 100) + '% across, ' + Math.round(pick.fy * 100) + '% down, zoom ' + pick.zoom.toFixed(2);
  };
  // a picture's real shape, once it is in, so the frame places it exactly
  const learn = (p) => { const im = new Image(); im.onload = () => { if (pick === p) { p.aspect = im.naturalWidth / im.naturalHeight; paint(); } }; im.src = artUrl(p.id); };
  zoom.addEventListener('input', () => { if (pick) { pick.zoom = +zoom.value; paint(); } });
  let drag = null;
  frame.addEventListener('pointerdown', (e) => { if (!pick) return; drag = { x: e.clientX, y: e.clientY }; frame.setPointerCapture(e.pointerId); });
  frame.addEventListener('pointermove', (e) => {
    if (!drag || !pick) return;
    const W = frame.clientWidth, H = frame.clientHeight, A = pick.aspect || ART_ASPECT;
    const dw = Math.max(W, H * A) * pick.zoom, dh = dw / A;
    pick.fx = Math.min(1 - W / 2 / dw, Math.max(W / 2 / dw, pick.fx - (e.clientX - drag.x) / dw));
    pick.fy = Math.min(1 - H / 2 / dh, Math.max(H / 2 / dh, pick.fy - (e.clientY - drag.y) / dh));
    drag = { x: e.clientX, y: e.clientY };
    paint();
  });
  frame.addEventListener('pointerup', () => { drag = null; });
  frame.addEventListener('wheel', (e) => { if (!pick) return; e.preventDefault(); pick.zoom = Math.min(3, Math.max(1, pick.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); zoom.value = String(pick.zoom); paint(); }, { passive: false });

  const by = wornBy();
  const candBox = el('div', { class: 'cands' });
  const choose = (c) => {
    const f = c.ill && FOCUS[String(c.ill).slice(0, 8)] ? focusOf(c.ill) : [0.5, 0.5];
    pick = { id: c.id, ill: String(c.ill || '').slice(0, 8), fx: f[0], fy: f[1], zoom: 1, aspect: ART_ASPECT };
    zoom.value = '1';
    learn(pick); paint();
    for (const n of back.querySelectorAll('.cand')) n.classList.toggle('on', n.dataset.id === c.id);
  };
  const candTile = (c, why) => {
    const ill8 = String(c.ill || '').slice(0, 8);
    const elsewhere = by.get(ill8);
    const taken = elsewhere && elsewhere !== key;
    const t = el('button', { class: 'cand' + (pick && pick.id === c.id ? ' on' : ''), type: 'button', 'data-id': c.id, title: (names.get(c.id) || c.name || '') + (taken ? ' (worn by ' + elsewhere.toUpperCase() + ' now)' : ''),
      onclick: () => choose(c) }, [
      el('img', { src: artUrl(c.id), alt: '', loading: 'lazy' }),
      why ? el('span', { class: 'why' + (why === 'now' ? ' now' : ''), text: why }) : (taken ? el('span', { class: 'why taken', text: elsewhere.toUpperCase() }) : null),
      el('span', { class: 'cap', text: names.get(c.id) || c.name || '' }),
    ]);
    return t;
  };
  const listCands = async () => {
    candBox.innerHTML = '';
    const nowC = kind === 'collector' ? set.nowC : set.now;
    const list = [];
    if (nowC) list.push([nowC, 'now']);
    for (const c of set.cands) if (!nowC || c.id !== nowC.id) list.push([c, null]);
    await nameAll(list.map(x => x[0].id));
    for (const [c, why] of list) candBox.append(candTile(c, why));
    paint();
  };
  // more: the rest of the set's art, or any search
  const more = el('div', { class: 'cands' });
  const qIn = el('input', { type: 'text', value: 'set:' + set.code + ' unique:art', style: 'flex:1', 'aria-label': 'Scryfall search' });
  const status = el('span', { class: 'dim small' });
  let nextPage = null;
  const runSearch = async (url) => {
    status.textContent = 'Searching…';
    try {
      const r = await fetch(url || ('https://api.scryfall.com/cards/search?order=edhrec&q=' + encodeURIComponent(qIn.value)));
      const j = await r.json();
      if (!url) more.innerHTML = '';
      if (j.object === 'error') { status.textContent = j.details || 'Nothing found.'; return; }
      for (const c of j.data || []) {
        const ill = c.illustration_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].illustration_id);
        if (!ill || !(c.image_uris || (c.card_faces && c.card_faces[0].image_uris))) continue;
        names.set(c.id, c.name);
        more.append(candTile({ id: c.id, ill: ill.replace(/-/g, '').slice(0, 8), name: c.name }, null));
      }
      nextPage = j.has_more ? j.next_page : null;
      status.textContent = (j.total_cards || 0) + ' found' + (nextPage ? ' · more below' : '');
      moreBtn.disabled = !nextPage;
    } catch (e) { status.textContent = 'Scryfall did not answer.'; }
  };
  const moreBtn = el('button', { type: 'button', text: 'Show more', disabled: true, onclick: () => nextPage && runSearch(nextPage) });
  qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  const close = () => { back.remove(); draw(); };
  const kinds = set.collector ? el('div', { class: 'row kinds' }, [['play', 'Play Booster'], ['collector', 'Collector Booster']].map(([k, label]) =>
    el('button', { type: 'button', class: kind === k ? 'on' : '', text: label, onclick: () => { if (k !== kind) { back.remove(); edit(set, k); } } }))) : null;
  const ed = el('div', { class: 'ed', role: 'dialog', 'aria-label': set.name }, [
    el('div', null, [
      el('h2', { text: set.name }),
      el('div', { class: 'dim small', text: set.code.toUpperCase() + ' · ' + set.year + (set.type === 'eternal' ? ' · Eternal' : '') }),
      kinds ? el('div', { style: 'margin:10px 0' }, kinds) : null,
      el('div', { style: 'margin:12px 0' }, frame),
      el('div', { class: 'row' }, [el('span', { class: 'small dim', text: 'Zoom' }), zoom]),
      nameLine,
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('button', { type: 'button', class: 'primary', text: 'Use this', onclick: () => {
          if (!pick) return;
          choices[key] = { id: pick.id, ill: pick.ill, name: names.get(pick.id) || '', focus: [Math.round(pick.fx * 1000) / 10, Math.round(pick.fy * 1000) / 10], zoom: Math.round(pick.zoom * 100) / 100 };
          save(); close();
        } }),
        choices[key] ? el('button', { type: 'button', text: 'Back to as it was', onclick: () => { delete choices[key]; save(); close(); } }) : null,
        el('button', { type: 'button', text: 'Cancel', onclick: close }),
      ]),
    ]),
    el('div', null, [
      el('div', { class: 'sec', text: 'Its pictures' }),
      candBox,
      el('div', { class: 'sec', text: 'Any other art' }),
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [qIn, el('button', { type: 'button', text: 'Search', onclick: () => runSearch() }), status]),
      more,
      el('div', { class: 'row', style: 'margin-top:8px' }, [moreBtn]),
      el('p', { class: 'dim small', text: 'A red tag is a picture another pack wears now. Scryfall searches work here: set:lea, t:dragon set:dom, "Black Lotus" unique:art.' }),
    ]),
  ]);
  const back = el('div', { class: 'ed-back', onclick: (e) => { if (e.target === back) close(); } }, ed);
  document.body.append(back);
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); if (back.isConnected) close(); } });
  if (pick) learn(pick);
  listCands();
  requestAnimationFrame(paint);
}

document.getElementById('export').addEventListener('click', () => {
  const out = JSON.stringify({ kind: 'packart-choices', version: 1, choices }, null, 1);
  const ta = el('textarea', { readonly: 'readonly' });
  ta.value = out;
  const back = el('div', { class: 'ed-back' }, el('div', { class: 'ed', style: 'display:block;max-width:640px' }, [
    el('h2', { text: 'Your choices' }),
    el('p', { class: 'dim small', text: Object.keys(choices).length + ' pack' + (Object.keys(choices).length === 1 ? '' : 's') + '. Copy this and paste it back into the chat, or download it as a file.' }),
    ta,
    el('div', { class: 'row', style: 'margin-top:10px' }, [
      el('button', { type: 'button', class: 'primary', text: 'Copy', onclick: async (e) => { try { await navigator.clipboard.writeText(out); e.target.textContent = 'Copied'; } catch (x) { ta.select(); document.execCommand('copy'); e.target.textContent = 'Copied'; } } }),
      el('button', { type: 'button', text: 'Download', onclick: () => { const a = el('a', { href: URL.createObjectURL(new Blob([out], { type: 'application/json' })), download: 'packart-choices.json' }); document.body.append(a); a.click(); a.remove(); } }),
      el('button', { type: 'button', text: 'Close', onclick: () => back.remove() }),
    ]),
  ]));
  back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
  document.body.append(back);
});
draw();
</script></body></html>`;
