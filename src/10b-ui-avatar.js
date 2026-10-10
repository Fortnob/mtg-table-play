'use strict';
/* Profile pictures: a face from Magic's best-known characters (their card
   art, zoomed in), or a picture of your own, cropped to a circle. What is
   kept is a small square JPEG as a data URL, so it can be saved in the
   settings and sent to the other players at the table as it is. */
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;

  /** Pixels on a side of the saved picture. */
  const OUT = 160;
  /** The longest a picture may be once saved (and the most accepted from another player). */
  const MAX_LEN = 60000;

  /* Characters, and the printing of them whose art is their face. Where
     their face sits in the art (x, y, as fractions) and how far in to
     zoom start the cropper off close to right. */
  const PRESETS = [
    // each one a printing whose art shows the whole face, and where it is
    { name: 'Jace, the Mind Sculptor', set: '2xm', cn: '56', x: 0.44, y: 0.17, z: 3.9 },
    { name: 'Chandra, Torch of Defiance', set: 'fra', cn: '244', x: 0.57, y: 0.14, z: 3.4 },
    { name: 'Liliana of the Veil', set: 'inr', cn: '475', x: 0.744, y: 0.157, z: 2.9 },
    { name: 'Gideon, Ally of Zendikar', set: 'bfz', cn: '29', x: 0.44, y: 0.09, z: 3.9 },
    { name: 'Ajani Goldmane', set: 'm11', cn: '1', x: 0.505, y: 0.157, z: 2.3 },
    { name: 'Teferi, Hero of Dominaria', set: 'dom', cn: '207', x: 0.49, y: 0.12, z: 3.4 },
    { name: "Elspeth, Sun's Champion", set: 'frc', cn: '24', x: 0.53, y: 0.12, z: 4.6 },
    { name: 'Vraska, Golgari Queen', set: 'grn', cn: '213', x: 0.45, y: 0.245, z: 4.2 },
    { name: 'Kaya, Ghost Assassin', set: 'cn2', cn: '75', x: 0.44, y: 0.21, z: 3.7 },
    { name: 'Sarkhan Vol', set: 'mma', cn: '183', x: 0.505, y: 0.14, z: 3.7 },
    { name: 'Nahiri, the Harbinger', set: 'cmm', cn: '929', x: 0.47, y: 0.14, z: 3.7 },
    { name: 'Ral, Storm Conduit', set: 'war', cn: '211', x: 0.375, y: 0.09, z: 4 },
    { name: 'Kiora, the Crashing Wave', set: 'ddo', cn: '34', x: 0.454, y: 0.105, z: 4.6 },
    { name: 'Oko, Thief of Crowns', set: 'eld', cn: '197', x: 0.45, y: 0.26, z: 3.9 },
    { name: 'Wrenn and Six', set: '2x2', cn: '296', x: 0.62, y: 0.31, z: 5 },
    { name: 'Kaito Shizuki', set: 'neo', cn: '226', x: 0.68, y: 0.21, z: 3.9 },
    { name: 'Urza, Lord High Artificer', set: 'cmm', cn: '130', x: 0.526, y: 0.28, z: 5 },
    { name: 'Yawgmoth, Thran Physician', set: 'dmr', cn: '110', x: 0.556, y: 0.19, z: 4.2 },
    { name: 'Niv-Mizzet, Parun', set: 'otc', cn: '235', x: 0.64, y: 0.226, z: 2.75 },
    { name: 'Avacyn, Angel of Hope', set: 'inr', cn: '477', x: 0.526, y: 0.185, z: 5 },
    { name: 'Edgar Markov', set: 'inr', cn: '234', x: 0.487, y: 0.157, z: 5 },
    { name: 'Lord Windgrace', set: 'c18', cn: '43', x: 0.46, y: 0.12, z: 3.4 },
  ];
  UI.avatarPresets = PRESETS;

  /** Whether a value is a picture this app made: a small image data URL. */
  UI.isAvatar = (v) => typeof v === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(v) && v.length <= MAX_LEN;

  /** An image, loaded so that it can be drawn on a canvas and read back. */
  async function loadImage(src) {
    let blob = src;
    if (!(src instanceof Blob)) {
      const r = await fetch(src, { mode: 'cors' });
      if (!r.ok) throw new Error('That picture could not be loaded.');
      blob = await r.blob();
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('That file is not a picture this browser can open.'); }
    return { img, release: () => URL.revokeObjectURL(url) };
  }

  /** The characters' cards, looked up once (one request for all of them). */
  let presetCards = null;
  async function presetArt() {
    if (presetCards) return presetCards;
    const res = await MTG.scry.collection(PRESETS.map(p => (p.set ? { set: p.set, collector_number: p.cn } : { name: p.name })));
    presetCards = PRESETS.map((p, i) => ({ preset: p, card: (res.cards || [])[i] || null })).filter(x => x.card);
    return presetCards;
  }

  /**
   * Your profile: the name the table shows beside your picture, and the
   * picture (the characters, an upload, or taking it away). `opts.current`
   * is the picture now; `opts.onSave(dataUrl | null)` is told the new one
   * (null: back to the letter). `opts.name` and `opts.onName(name)` are the
   * name, when it is asked here too.
   */
  UI.avatarPicker = function (opts) {
    opts = opts || {};
    const grid = el('div', { class: 'av-grid', role: 'list' }, [el('div', { class: 'tiny dim', text: 'Finding the characters…' })]);
    const file = el('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': 'Choose a picture to upload' });
    const upload = el('button', { type: 'button', class: 'btn', text: 'Upload a picture…', onclick: () => file.click() });
    let nameBox = null;
    if (opts.onName) {
      nameBox = el('input', { type: 'text', value: opts.name || '', maxlength: '28', class: 'av-name', 'aria-label': 'Your name' });
      const keep = () => { const v = nameBox.value.trim(); if (v && v !== opts.name) { opts.name = v; opts.onName(v); } };
      nameBox.addEventListener('change', keep);
      nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(); nameBox.blur(); } });
    }
    const keepName = () => { if (nameBox) nameBox.dispatchEvent(new Event('change')); };
    const body = el('div', { class: 'av-picker' }, [
      nameBox ? el('div', { class: 'av-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Your name' }),
          el('div', { class: 'opt-help', text: 'Shown beside your picture at the table, and to the other players.' }),
          nameBox,
        ]),
      ]) : null,
      el('div', { class: 'av-row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Your own picture' }),
          el('div', { class: 'opt-help', text: 'Any picture on this device. You crop it to a circle next.' }),
        ]),
        upload, file,
      ]),
      el('div', { class: 'opt-label', text: 'Or a character' }),
      grid,
    ].filter(Boolean));
    const m = UI.modal({ title: nameBox ? 'Your profile' : 'Profile picture', content: body, className: 'av-modal', width: 'min(720px, 94vw)' });
    if (opts.current) m.button('Remove picture', () => { keepName(); m.close(); if (opts.onSave) opts.onSave(null); }, 'ghost');
    m.button('Done', () => { keepName(); m.close(); }, 'primary');

    const crop = (source, start, label) => {
      keepName();
      m.close();
      UI.avatarCropper(source, start, label, (data) => { if (data && opts.onSave) opts.onSave(data); },
        () => UI.avatarPicker(opts));
    };
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) return UI.error('That file is not a picture.');
      if (f.size > 25 * 1024 * 1024) return UI.error('That picture is too big (over 25 MB).');
      crop(f, { x: 0.5, y: 0.5, z: 1 }, f.name);
    });

    presetArt().then((list) => {
      grid.innerHTML = '';
      if (!list.length) { grid.appendChild(el('div', { class: 'tiny dim', text: 'The characters could not be loaded. Check the connection, or upload a picture.' })); return; }
      for (const { preset, card } of list) {
        const url = MTG.scry.imageUrl(card, 'art_crop', 0);
        if (!url) continue;
        const who = card.name.split(',')[0];
        const face = el('span', { class: 'av-thumb-face' });
        face.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        /* The face in the middle, as the cropper will put it: the art
           scaled so its height is z thumbnails, then moved so the face's
           point is the centre (kept inside the picture). */
        const B = 68, A = 626 / 457, z = preset.z;
        const w = A * z * B, h = z * B;
        const left = Math.max(B - w, Math.min(0, B / 2 - (preset.x != null ? preset.x : 0.5) * w));
        const top = Math.max(B - h, Math.min(0, B / 2 - preset.y * h));
        face.style.backgroundSize = `${w.toFixed(1)}px ${h.toFixed(1)}px`;
        face.style.backgroundPosition = `${left.toFixed(1)}px ${top.toFixed(1)}px`;
        grid.appendChild(el('button', { type: 'button', class: 'av-thumb', role: 'listitem', title: card.name, 'aria-label': card.name,
          onclick: () => crop(url, { x: preset.x != null ? preset.x : 0.5, y: preset.y, z: preset.z }, card.name) }, [
          face, el('span', { class: 'av-thumb-name', text: who }),
        ]));
      }
    }).catch(() => {
      grid.innerHTML = '';
      grid.appendChild(el('div', { class: 'tiny dim', text: 'The characters could not be loaded. Check the connection, or upload a picture.' }));
    });
    return m;
  };

  /**
   * The cropper: drag to move, the slider or the wheel to zoom, and the
   * circle is what the table shows. `start` is where to begin: the point
   * of the picture in the middle (x, y as fractions) and the zoom.
   */
  UI.avatarCropper = async function (source, start, label, onSave, onBack, shape) {
    /* `shape`: a circle for a profile picture (the default), or a card
       ({ card: true }) for a sleeve: 63 by 88, saved bigger. */
    const card = !!(shape && shape.card);
    const VW = card ? 300 * 63 / 88 : 300, VH = 300;
    const OW = card ? 252 : OUT, OH = card ? 352 : OUT;
    const LIMIT = card ? 90000 : MAX_LEN;
    let loaded;
    const busy = UI.busy('Profile picture', 'Opening the picture…');
    try { loaded = await loadImage(source); } catch (e) { busy.close(); UI.error(e.message || String(e)); if (onBack) onBack(); return; }
    busy.close();
    const { img, release } = loaded;
    const VIEW = VH;                        // the canvas's own pixels, tall
    const canvas = el('canvas', { class: 'av-canvas', width: Math.round(VW), height: VH, 'aria-label': 'The picture, to drag into place' });
    const ctx = canvas.getContext('2d');
    const zoom = el('input', { type: 'range', min: '1', max: '5', step: '0.01', class: 'av-zoom', 'aria-label': 'Zoom' });
    // "cover": the picture fills the square at zoom 1
    const base = Math.max(VW / img.naturalWidth, VH / img.naturalHeight);
    const st = { z: U.clamp(start.z || 1, 1, 5), cx: (start.x != null ? start.x : 0.5) * img.naturalWidth, cy: (start.y != null ? start.y : 0.5) * img.naturalHeight };
    zoom.value = String(st.z);
    /** The part of the picture inside the square, kept inside the picture. */
    const box = () => {
      // picture pixels across and down the frame
      const w = Math.min(VW / (base * st.z), img.naturalWidth), h = Math.min(VH / (base * st.z), img.naturalHeight);
      st.cx = U.clamp(st.cx, w / 2, img.naturalWidth - w / 2);
      st.cy = U.clamp(st.cy, h / 2, img.naturalHeight - h / 2);
      return { sx: st.cx - w / 2, sy: st.cy - h / 2, w, h };
    };
    const draw = () => {
      const b = box();
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, VW, VH);
      ctx.drawImage(img, b.sx, b.sy, b.w, b.h, 0, 0, VW, VH);
    };
    zoom.addEventListener('input', () => { st.z = +zoom.value; draw(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      st.z = U.clamp(st.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 1, 5);
      zoom.value = String(st.z);
      draw();
    }, { passive: false });
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // screen pixels to canvas pixels to picture pixels
      const shown = U.rect(canvas).width || VW;
      const k = (VW / shown) / (base * st.z) / U.zoom();
      st.cx -= (e.clientX - drag.x) * k;
      st.cy -= (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      draw();
    });
    const stop = () => { drag = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    // the arrow keys move it too, for anyone not using a pointer
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      const step = 8 / (base * st.z);
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      st.cx += d[0] * step; st.cy += d[1] * step;
      draw();
    });

    const body = el('div', { class: 'av-crop' }, [
      el('div', { class: 'av-stage' + (card ? ' card' : '') }, [canvas, el('div', { class: 'av-mask', 'aria-hidden': 'true' })]),
      el('label', { class: 'av-zoom-row' }, [el('span', { class: 'tiny dim', text: 'Zoom' }), zoom]),
      el('div', { class: 'tiny dim', text: card
        ? (shape.moving ? 'Drag the picture to move it; this is the back of your cards. Its first frame is shown here; on your cards it moves.' : 'Drag the picture to move it; this is the back of your cards.')
        : 'Drag the picture to move it; the circle is what the table shows.' }),
    ]);
    const m = UI.modal({ title: label ? `Crop: ${label}` : 'Crop the picture', content: body, className: 'av-modal' });
    m._onClose = () => release();
    m.button('Back', () => { m.close(); if (onBack) onBack(); }, 'ghost');
    m.button('Use this picture', () => {
      const out = el('canvas', { width: OW, height: OH });
      const b = box();
      out.getContext('2d').drawImage(img, b.sx, b.sy, b.w, b.h, 0, 0, OW, OH);
      let data = '';
      for (const q of [0.86, 0.75, 0.6, 0.5]) { data = out.toDataURL('image/jpeg', q); if (data.length <= LIMIT) break; }
      m.close();
      // where in the picture the frame sits, as fractions of it (a GIF is shown from this, moving)
      const crop = { x: b.sx / img.naturalWidth, y: b.sy / img.naturalHeight, w: b.w / img.naturalWidth, h: b.h / img.naturalHeight };
      if (data.length <= LIMIT && /^data:image\/jpeg;base64,/.test(data)) onSave(data, crop);
      else UI.error('That picture could not be saved.');
    }, 'primary');
    draw();
  };
})(window.MTG);
