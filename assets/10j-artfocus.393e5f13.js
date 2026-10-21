/* ===== 10j-artfocus.js ===== */
'use strict';
/* ============================================================
   10j-artfocus.js - a painting framed on the face in it

   A wide, short strip of a painting (a deck in the quick game's picker)
   shows one band of it, and the band should have the face's eyes in its
   middle, across as well as down, when there is a face. A strip as wide as
   the painting cannot be moved across, so the painting is drawn a little
   larger, as much as it takes to bring the eyes to the middle (and no
   more than a picture of that size stays sharp at).

   Where the eyes are was found beforehand, by illustration, for the
   paintings a deck is likeliest to wear (MTG.faceAt, src/10k-facefocus.js,
   written by tools/facefocus.py with YuNet). A deck of your own whose
   painting is not in it is looked at here, once, with the same YuNet
   (OpenCV's face detector, MIT licence) run by onnxruntime-web: both are
   fetched only then, the first time one is needed, and the answer is kept.
   A painting with no face keeps its usual framing.
   ============================================================ */
(function (MTG) {
  const UI = MTG.ui;
  const ART_ASPECT = 626 / 457;   // Scryfall's art crops, near enough
  const MAX_ZOOM = 2.4;           // larger than this an art crop goes soft
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const MODEL = 'models/yunet.onnx';
  const KEY = 'faceScan';
  const KEEP = 400;               // answers kept here; the oldest go first
  const SURE = 0.75;              // as tools/facefocus.py: less sure than this, as often a rock as a face

  /** The Scryfall id in a picture's address, and whether it is a card's back face. */
  const idOf = (url) => (String(url || '').match(/\/(front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\./) || []).slice(1);
  /** A card's illustration, the face the picture shows. */
  const illOf = (card, back) => card && (card.illustration_id ||
    ((card.card_faces || [])[back ? 1 : 0] || {}).illustration_id || ((card.card_faces || [])[0] || {}).illustration_id) || null;

  /**
   * How to draw a painting in a w by h box so the eyes at `at` ([percent
   * across, percent down]) sit in its middle: its size (just large enough
   * that they can, within MAX_ZOOM) and where it goes.
   */
  function placement(at, w, h) {
    const fx = at[0] / 100, fy = at[1] / 100;
    const coverW = Math.max(w, h * ART_ASPECT);
    const room = (f) => 0.5 / Math.max(0.04, Math.min(f, 1 - f));
    const zoom = Math.min(MAX_ZOOM, Math.max(1, w * room(fx) / coverW, ART_ASPECT * h * room(fy) / coverW));
    const drawnW = coverW * zoom, drawnH = drawnW / ART_ASPECT;
    const along = (f, box, drawn) => (drawn - box < 1 ? 50 : Math.max(0, Math.min(100, (f * drawn - box / 2) / (drawn - box) * 100)));
    return {
      size: `${(drawnW / w * 100).toFixed(1)}% auto`,
      pos: `${along(fx, w, drawnW).toFixed(1)}% ${along(fy, h, drawnH).toFixed(1)}%`,
    };
  }

  /* ---------------- looking at a painting here ---------------- */
  let session = null;
  function script(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }
  function model() {
    if (!session) {
      session = (async () => {
        if (!window.ort) await script(ORT + 'ort.wasm.min.js');
        const ort = window.ort;
        ort.env.wasm.wasmPaths = ORT;
        ort.env.wasm.numThreads = 1;
        return ort.InferenceSession.create(new URL(MODEL, location.href).href, { executionProviders: ['wasm'] });
      })();
      session.catch(() => { session = null; });
    }
    return session;
  }
  function picture(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }
  /**
   * YuNet over one region of the picture (sx, sy, sw, sh), fitted into its
   * 640-pixel square: every face it is sure enough of, in the whole
   * picture's fractions, as { score, cx, cy, size, ex, ey }.
   */
  async function detect(sess, img, sx, sy, sw, sh) {
    const ort = window.ort, N = 640;
    const k = N / Math.max(sw, sh);
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, Math.round(sw * k), Math.round(sh * k));
    const px = g.getImageData(0, 0, N, N).data;
    // blue, green, red planes of 0..255, as OpenCV hands a picture over
    const input = new Float32Array(3 * N * N);
    for (let i = 0, j = 0; i < N * N; i++, j += 4) { input[i] = px[j + 2]; input[N * N + i] = px[j + 1]; input[2 * N * N + i] = px[j]; }
    const out = await sess.run({ input: new ort.Tensor('float32', input, [1, 3, N, N]) });
    const W = img.naturalWidth, H = img.naturalHeight, found = [];
    for (const s of [8, 16, 32]) {
      const cols = N / s, cls = out['cls_' + s].data, obj = out['obj_' + s].data, bb = out['bbox_' + s].data, kp = out['kps_' + s].data;
      for (let i = 0; i < cls.length; i++) {
        const score = Math.sqrt(Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1));
        if (score < SURE) continue;
        const r = Math.floor(i / cols), c = i % cols;
        const back = (v, o, len) => (o + v / k) / len;   // a point in the square, as a fraction of the picture
        const cx = (c + bb[i * 4]) * s, cy = (r + bb[i * 4 + 1]) * s, bw = Math.exp(bb[i * 4 + 2]) * s;
        found.push({
          score, cx: back(cx, sx, W), cy: back(cy, sy, H), size: bw / k / W,
          ex: back(((kp[i * 10] + c) + (kp[i * 10 + 2] + c)) * s / 2, sx, W),
          ey: back(((kp[i * 10 + 1] + r) + (kp[i * 10 + 3] + r)) * s / 2, sy, H),
        });
      }
    }
    return found;
  }
  /**
   * Where the eyes of the painting's subject are, looked at here: the whole
   * picture, then its upper middle a size larger (where a small face shows
   * better). The subject is the big face near the middle, not the surest; a
   * small one out by an edge is a bystander. [percent across, percent down],
   * or null.
   */
  async function scan(url) {
    const sess = await model();
    const img = await picture(url);
    const W = img.naturalWidth, H = img.naturalHeight;
    const all = (await detect(sess, img, 0, 0, W, H)).concat(await detect(sess, img, W * 0.15, 0, W * 0.7, H * 0.7));
    let best = null, bestWorth = 0;
    for (const f of all) {
      const off = Math.hypot(f.cx - 0.5, (f.cy - 0.4) / 0.8);
      if (f.size < 0.06 && off > 0.45) continue;
      const worth = f.score * (0.4 + 3 * Math.min(f.size, 0.3)) * Math.max(0.15, 1 - 1.2 * off);
      if (worth > bestWorth) { best = f; bestWorth = worth; }
    }
    return best ? [Math.round(best.ex * 100), Math.round(best.ey * 100)] : null;
  }
  // one painting at a time, after the page has settled
  let queue = Promise.resolve();
  function scanOnce(url) {
    const memo = MTG.store.get(KEY, {}) || {};
    if (url in memo) return Promise.resolve(memo[url] || null);
    const run = queue.then(() => new Promise(res => (window.requestIdleCallback || setTimeout)(res))).then(() => scan(url)).then((at) => {
      const m = MTG.store.get(KEY, {}) || {};
      m[url] = at || 0;
      const keys = Object.keys(m);
      if (keys.length > KEEP) for (const old of keys.slice(0, keys.length - KEEP)) delete m[old];
      MTG.store.set(KEY, m);
      return at;
    });
    // a failure (offline, no model) is not remembered, and asked again another time
    queue = run.catch(() => null);
    return run.catch(() => null);
  }

  /**
   * Frame `node`'s painting (set on it by UI.setArt, now or once it comes)
   * so the eyes of the face in it are in its middle. `card`, when known,
   * saves looking the card up by the picture's address; `opts.scan` lets a
   * painting not found beforehand be looked at here (a deck of your own).
   */
  UI.focusFace = function (node, card, opts) {
    opts = opts || {};
    const apply = async (url) => {
      const [side, id] = idOf(url);
      let ill = illOf(card || node._artCard, side === 'back');
      if (!ill && id) ill = illOf(await MTG.scry.byId(id, { quiet: true, low: true }).catch(() => null), side === 'back');
      let at = ill && MTG.faceAt && MTG.faceAt[ill.slice(0, 8)];
      if (!at && opts.scan) at = await scanOnce(url);
      if (!at || node._artUrl !== url) return;
      const place = () => {
        const w = node.clientWidth, h = node.clientHeight;
        if (!w || !h) return false;
        const p = placement(at, w, h);
        node.style.backgroundSize = p.size;
        node.style.backgroundPosition = p.pos;
        node.classList.add('face-framed');
        return true;
      };
      // not laid out yet (a list still opening): once it is
      if (!place()) requestAnimationFrame(() => { if (!place()) setTimeout(place, 120); });
    };
    if (node._artUrl && node.style.backgroundImage) { apply(node._artUrl); return node; }
    // the painting is still on its way: frame it when it lands
    const watch = new MutationObserver(() => {
      if (!node.style.backgroundImage || !node._artUrl) return;
      watch.disconnect();
      apply(node._artUrl);
    });
    watch.observe(node, { attributes: true, attributeFilter: ['style'] });
    return node;
  };
  MTG.faceScan = { scan: scanOnce, placement };
})(window.MTG);
