/* ============================================================
   09c-friends.js - friends: a code of your own, requests, presence,
   invites, and a private line to each friend

   Every install has a friend code (MTG.settings.friendCode): seven
   letters and digits and a check letter, read aloud as two fours,
   "KX7P-2MQA". While the app is open it listens at a peer id made from
   that code, on a second PeerJS peer beside the game's own (src/09-net.js),
   so a friend can reach it whatever screen it is on, in a game or not.

   A friendship is made once, when both are online: one side asks, the
   other accepts, and the accepting side makes up a secret that both keep.
   After that, each time two friends connect, each proves it knows the
   secret without saying it (a hash of the secret and the other side's
   fresh nonce), so someone who takes a friend's peer id while they are
   away cannot pass for them. Removing a friend leaves a tombstone with
   the secret, so the removal can be proved to them when they next appear.

   Over that line go presence (online, in a lobby, in a game), the
   name, picture and frame each shows, invites to a room, trades
   (src/09d-trade.js) and tournaments (src/09f-tourney.js). Everything
   that arrives is checked: a friend's data is no more trusted than a
   stranger's.

   This file holds no interface: src/10g-ui-social.js draws it. The hub
   is made by a factory, so tools/socialtest.js can run two devices
   against a pretend broker without a browser.

   The store ('friends'):
     { v, list: [{ code, state, name, frame, since, seen, secret, ok }],
       blocked: [{ code, name, at }], declined: [{ code, at }] }
   state: 'friend', 'out' (asked them), 'in' (they asked), 'gone' (removed:
   the tombstone). ok: the friendship has been proved both ways once.
   Pictures are kept apart ('friendFaces', by code), being the heavy part.
   ============================================================ */
'use strict';
(function (MTG) {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // the room codes' letters: no I, O, 0 or 1
  const PREFIX = 'mtgtable-f1-';
  const STATES = new Set(['friend', 'out', 'in', 'gone']);
  const PRESENCE = new Set(['online', 'lobby', 'game']);
  const MAX_LIST = 200;          // friends, requests and tombstones together
  const MAX_INCOMING = 30;       // requests waiting for an answer
  const DECLINE_DAYS = 30;       // a declined request is turned away again for this long
  const GONE_DAYS = 90;          // and a removal is proved for this long

  /* ---------------- randomness ---------------- */
  function randomBytes(n) {
    const out = new Uint8Array(n);
    const c = typeof crypto !== 'undefined' && crypto && crypto.getRandomValues ? crypto : null;
    if (c) c.getRandomValues(out);
    else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function randomHex(n) {
    return Array.from(randomBytes(Math.ceil(n / 2)), b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
  }

  /* ---------------- codes ----------------
     A code is random letters from ALPHABET and one check letter at the
     end (Luhn mod 32), so a code mistyped by one letter, or with two
     letters swapped, is caught when it is typed rather than becoming a
     request that never arrives. */
  function checkLetter(body) {
    const n = ALPHABET.length;
    let factor = 2, sum = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      let add = factor * ALPHABET.indexOf(body[i]);
      factor = factor === 2 ? 1 : 2;
      add = Math.floor(add / n) + (add % n);
      sum += add;
    }
    return ALPHABET[(n - (sum % n)) % n];
  }
  /** A fresh code of `len` letters, the last of them the check letter. */
  function makeCode(len) {
    len = len || 8;
    const bytes = randomBytes(len - 1);
    let body = '';
    for (let i = 0; i < len - 1; i++) body += ALPHABET[bytes[i] % ALPHABET.length];   // 256 is a multiple of 32: no bias
    return body + checkLetter(body);
  }
  /** Whether `s` is a well-formed code of `len` letters (in its plain form, no dash). */
  function isCode(s, len) {
    s = String(s || '');
    if (s.length !== (len || 8)) return false;
    for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return false;
    return checkLetter(s.slice(0, -1)) === s.slice(-1);
  }
  /**
   * What someone typed or pasted, as a code: { code } or { why }. Case,
   * spaces and dashes do not matter, and a whole link (…?friend=CODE) is
   * read for its code.
   */
  function parseCode(input, len) {
    len = len || 8;
    let s = String(input == null ? '' : input).trim();
    const m = /[?&](?:friend|code)=([A-Za-z0-9 -]+)/.exec(s);
    if (m) s = m[1];
    s = s.toUpperCase().replace(/[\s\-_.]+/g, '');
    if (!s) return { why: 'Type a code first.' };
    if (/[IO01]/.test(s)) return { why: 'Codes never use I, O, 0 or 1. Check that letter again.' };
    if (/[^A-Z2-9]/.test(s)) return { why: 'A code is only letters and digits.' };
    if (s.length !== len) return { why: `A code is ${len} letters and digits; that is ${s.length}.` };
    if (!isCode(s, len)) return { why: 'That code does not add up. A letter may be wrong or two swapped round.' };
    return { code: s };
  }
  /** A code as it is shown and read out: ABCD-EFGH (or ABC-DEF for six). */
  function formatCode(code) {
    const s = String(code || '');
    const half = Math.ceil(s.length / 2);
    return s.length > 5 ? s.slice(0, half) + '-' + s.slice(half) : s;
  }

  /* ---------------- SHA-256 ----------------
     For the proofs between friends. Written out rather than taken from
     crypto.subtle, which a page opened over plain http (a phone on the
     same Wi-Fi as the computer serving it) does not have. */
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    const e = unescape(encodeURIComponent(s));
    const out = new Uint8Array(e.length);
    for (let i = 0; i < e.length; i++) out[i] = e.charCodeAt(i);
    return out;
  }
  function sha256(text) {
    const bytes = utf8(String(text));
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    const bits = len * 8;
    dv.setUint32(total - 4, bits >>> 0);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + w[i - 7] + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  /** The proof that `who` knows a friendship's secret, for the other side's nonce. */
  const proofOf = (secret, nonce, who) => sha256(secret + '|' + nonce + '|' + who).slice(0, 40);

  /* ---------------- the wire ----------------
     The same pieces as src/09-net.js: a data channel quietly drops a
     message much over 16KB, so anything long goes in numbered pieces and
     is put back together at the far end. Smaller pieces than the game's,
     because a picture or a binder of cards is all quotes and escapes. */
  const CHUNK = 9000;
  let chunkSeq = 0;
  function sendOn(conn, msg) {
    const text = JSON.stringify(msg);
    if (text.length <= CHUNK) { conn.send(msg); return 1; }
    const id = ++chunkSeq;
    const n = Math.ceil(text.length / CHUNK);
    for (let i = 0; i < n; i++) conn.send({ t: '~', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    return n;
  }
  /**
   * The same, for something big (a whole save): the pieces go out no
   * faster than the channel drains, and `onProgress(sent, of)` hears how
   * far it has got. Resolves when the last piece is handed over.
   */
  async function sendBig(conn, msg, onProgress) {
    const text = JSON.stringify(msg);
    const id = ++chunkSeq;
    const n = Math.max(1, Math.ceil(text.length / CHUNK));
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < n; i++) {
      for (let wait = 0; wait < 600 && conn.dataChannel && conn.dataChannel.bufferedAmount > 256 * 1024; wait++) await sleep(25);
      if (!conn.open) throw new Error('The connection closed part way through.');
      conn.send({ t: '~', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
      if (onProgress) onProgress(i + 1, n);
      if (i % 16 === 15) await sleep(0);
    }
  }
  /** Puts pieces back together, refusing anything that would grow past `maxParts` pieces. */
  class Unchunker {
    constructor(maxParts) { this.max = maxParts || 200; this.bufs = new Map(); }
    /** A piece in; the whole message out once the last piece is in, else null. */
    take(msg) {
      const { id, i, n, d } = msg || {};
      if (!Number.isInteger(id) || !Number.isInteger(i) || !Number.isInteger(n) || typeof d !== 'string') return null;
      if (n < 1 || n > this.max || i < 0 || i >= n || d.length > CHUNK) return null;
      let buf = this.bufs.get(id);
      if (!buf) {
        if (this.bufs.size >= 4) this.bufs.delete(this.bufs.keys().next().value);   // a few at once, no more
        buf = { parts: new Array(n), got: 0, n };
        this.bufs.set(id, buf);
      }
      if (buf.n !== n) return null;
      if (buf.parts[i] == null) { buf.parts[i] = d; buf.got++; }
      if (this.onPart) this.onPart(buf.got, n);
      if (buf.got < n) return null;
      this.bufs.delete(id);
      try { return JSON.parse(buf.parts.join('')); } catch (e) { return null; }
    }
  }

  /* ---------------- checking what arrives ---------------- */
  const cleanName = (v) => {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const name = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().slice(0, 28);
    // a name not fit to be shown is no name: whoever shows it falls back on its own stand-in (MTG.names)
    return MTG.names.fit(name, '');
  };
  /* A picture is drawn as a CSS url("…"), so a friend's must be nothing
     but base64 after its header: no quote or bracket could end it early. */
  const isAvatar = (v) => typeof v === 'string' && v.length <= 60000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) &&
    (!MTG.ui || !MTG.ui.isAvatar || MTG.ui.isAvatar(v));
  const cleanFrame = (v) => {
    if (typeof v !== 'string' || !/^[a-z0-9-]{1,24}$/.test(v)) return null;
    return MTG.economy && MTG.economy.frameById && !MTG.economy.frameById(v) ? null : v;
  };
  const cleanRoom = (v) => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return /^[A-HJ-NP-Z2-9]{4,8}$/.test(s) ? s : null;
  };
  const isHex = (v, lo, hi) => typeof v === 'string' && v.length >= lo && v.length <= hi && /^[0-9a-f]+$/.test(v);

  /* ============================================================
     The hub: one per device. `o` says where things are kept and how to
     reach the broker, so a test can give it a pretend one:
       Peer()        the PeerJS constructor, or null when it did not load
       store         get(key, fallback) / set(key, value), as MTG.store
       getCode()     this device's code ('' when it has none yet)
       setCode(c)    keep a new one
       profile()     { name, avatar, frame } as this device shows itself
       peerOptions() what to give PeerJS (STUN and TURN servers)
       timing        the waits below, shorter in a test
     ============================================================ */
  function createHub(o) {
    const hub = new MTG.Emitter();
    const T = Object.assign({
      sweep: 120000,        // how often friends not connected are tried again
      stagger: 250,         // between one attempt and the next, in a sweep
      attempt: 15000,       // how long a connection may take to open
      ping: 20000,          // a word down every line this often
      quiet: 65000,         // and a line that has said nothing for this long is gone
      stranger: 25000,      // someone not on the list who has not asked anything
      retry: 60000,         // the code in use elsewhere, or the broker gone: try again after
    }, o.timing || {});
    const now = o.now || (() => Date.now());

    /* ---- the list ---- */
    let data = null;
    function load() {
      if (data) return data;
      const raw = o.store.get('friends', null);
      data = { v: 1, list: [], blocked: [], declined: [] };
      if (raw && typeof raw === 'object') {
        for (const e of Array.isArray(raw.list) ? raw.list : []) {
          if (!e || !isCode(e.code) || !STATES.has(e.state) || data.list.some(x => x.code === e.code)) continue;
          data.list.push({
            code: e.code, state: e.state, name: cleanName(e.name), frame: cleanFrame(e.frame),
            since: +e.since || 0, seen: +e.seen || 0, secret: isHex(e.secret, 32, 32) ? e.secret : null, ok: !!e.ok,
          });
        }
        for (const b of Array.isArray(raw.blocked) ? raw.blocked : []) if (b && isCode(b.code)) data.blocked.push({ code: b.code, name: cleanName(b.name), at: +b.at || 0 });
        for (const d of Array.isArray(raw.declined) ? raw.declined : []) if (d && isCode(d.code)) data.declined.push({ code: d.code, at: +d.at || 0 });
      }
      // a friend with no secret cannot be proved: back to a request
      for (const e of data.list) if ((e.state === 'friend' || e.state === 'gone') && !e.secret) { e.state = e.state === 'gone' ? 'gone' : 'out'; e.ok = false; }
      data.list = data.list.filter(e => e.state !== 'gone' || e.secret);
      prune();
      return data;
    }
    function prune() {
      const t = now();
      data.declined = data.declined.filter(d => t - d.at < DECLINE_DAYS * 864e5);
      data.list = data.list.filter(e => e.state !== 'gone' || t - (e.since || 0) < GONE_DAYS * 864e5);
    }
    let frozen = false;           // a save is being loaded underneath: write nothing more
    function save() {
      if (!frozen) o.store.set('friends', data);
      hub.emit('change');
    }
    let faces = null;
    const loadFaces = () => faces || (faces = Object.assign(Object.create(null), o.store.get('friendFaces', null) || {}));
    function setFace(code, avatar) {
      loadFaces();
      const next = isAvatar(avatar) ? avatar : null;
      if ((faces[code] || null) === next) return;
      if (next) faces[code] = next; else delete faces[code];
      if (!frozen) o.store.set('friendFaces', faces);
    }
    function dropFace(code) { loadFaces(); if (faces[code]) { delete faces[code]; if (!frozen) o.store.set('friendFaces', faces); } }
    const entry = (code) => load().list.find(e => e.code === code) || null;
    const isBlocked = (code) => load().blocked.some(b => b.code === code);

    /* ---- this device's code ---- */
    function myCode() {
      let c = o.getCode();
      if (!isCode(c)) { c = makeCode(8); o.setCode(c); }
      return c;
    }

    /* ---- the peer ---- */
    let peer = null;
    let status = 'off';           // 'off' | 'connecting' | 'online' | 'taken' | 'offline' | 'unavailable'
    let wanted = false;           // start() was called and stop() has not been
    let retryTimer = null, sweepTimer = null, pingTimer = null;
    const links = new Map();      // code -> the Link in use
    const attempts = new Map();   // code -> { link, timer }: connections on their way
    const strangers = new Set();  // links from codes not on the list
    let presence = 'online';

    function setStatus(s) { if (status !== s) { status = s; hub.emit('status', s); hub.emit('change'); } }

    function start() {
      wanted = true;
      if (peer && !peer.destroyed) return;
      const Peer = o.Peer && o.Peer();
      if (!Peer) { setStatus('unavailable'); return; }
      load();
      const code = myCode();
      setStatus('connecting');
      let p;
      try { p = new Peer(PREFIX + code, o.peerOptions ? o.peerOptions() : {}); }
      catch (e) { setStatus('unavailable'); return; }
      peer = p;
      p.on('open', () => {
        if (peer !== p) return;
        setStatus('online');
        sweep();
      });
      p.on('connection', (conn) => { if (peer === p) incoming(conn); });
      p.on('disconnected', () => {
        // the broker went away (a phone asleep, the network changed); the friends already connected stay
        if (peer !== p || p.destroyed) return;
        setStatus('offline');
        later(() => { if (peer === p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch (e) { restart(); } } }, 3000);
      });
      p.on('error', (err) => {
        if (peer !== p) return;
        const type = String((err && err.type) || '');
        if (type === 'peer-unavailable') {
          // a friend who is not there: find which, from the message
          const m = /(mtgtable-f1-[A-Z2-9]+)/.exec(String((err && err.message) || ''));
          if (m) failAttempt(m[1].slice(PREFIX.length));
          return;
        }
        if (type === 'unavailable-id') { setStatus('taken'); dropPeer(); later(start, T.retry); return; }
        if (type === 'browser-incompatible') { setStatus('unavailable'); dropPeer(); return; }
        if (/network|server-error|socket-error|socket-closed|disconnected/.test(type)) {
          setStatus('offline');
          if (p.destroyed) { dropPeer(); later(start, T.retry / 4); }
          return;
        }
        // anything else is about one connection; the peer carries on
      });
      clearInterval(sweepTimer);
      sweepTimer = setInterval(sweep, T.sweep);
      clearInterval(pingTimer);
      pingTimer = setInterval(heartbeat, T.ping);
    }
    function later(fn, ms) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { retryTimer = null; if (wanted) fn(); }, ms);
    }
    function dropPeer() {
      for (const l of [...links.values(), ...strangers, ...[...attempts.values()].map(a => a.link)]) closeLink(l);
      links.clear(); strangers.clear();
      for (const a of attempts.values()) clearTimeout(a.timer);
      attempts.clear();
      try { if (peer) peer.destroy(); } catch (e) {}
      peer = null;
    }
    function restart() { dropPeer(); if (wanted) start(); }
    function stop() {
      wanted = false;
      clearTimeout(retryTimer); clearInterval(sweepTimer); clearInterval(pingTimer);
      dropPeer();
      setStatus('off');
    }
    /**
     * Back in front of the person (a phone woken, the network back): lines
     * that went quiet while asleep are let go, the broker is found again,
     * and everyone is looked for.
     */
    function wake() {
      if (!wanted) return;
      heartbeat();
      if (!peer || peer.destroyed) { clearTimeout(retryTimer); start(); return; }
      if (peer.disconnected) { try { peer.reconnect(); } catch (e) { restart(); } return; }
      sweep();
    }

    /** Try everyone on the list who should be reachable and is not connected yet. */
    function sweep() {
      if (!peer || peer.destroyed || peer.disconnected || status !== 'online') return;
      const todo = load().list.filter(e => (e.state === 'friend' || e.state === 'out') && !links.has(e.code) && !attempts.has(e.code));
      todo.forEach((e, i) => setTimeout(() => connectTo(e.code), i * T.stagger));
    }
    function connectTo(code) {
      if (!peer || peer.destroyed || peer.disconnected || links.has(code) || attempts.has(code) || isBlocked(code)) return;
      const e = entry(code);
      if (!e || (e.state !== 'friend' && e.state !== 'out')) return;
      let conn;
      try { conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: { v: 1 } }); }
      catch (err) { return; }
      if (!conn) return;
      const link = attach(conn, code, true);
      attempts.set(code, { link, timer: setTimeout(() => failAttempt(code), T.attempt) });
    }
    function failAttempt(code) {
      const a = attempts.get(code);
      if (!a) return;
      attempts.delete(code);
      clearTimeout(a.timer);
      if (!a.link.opened) closeLink(a.link);
    }
    function incoming(conn) {
      const id = String((conn && conn.peer) || '');
      const code = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : '';
      if (!isCode(code) || code === myCode() || isBlocked(code)) {
        // not one of ours, or someone turned away: hang up as soon as the line is up
        try { conn.on('open', () => { try { conn.close(); } catch (e) {} }); conn.close(); } catch (e) {}
        return;
      }
      if (!entry(code) && strangers.size >= 8) { try { conn.close(); } catch (e) {} return; }
      attach(conn, code, false);
    }

    /* ---- one line to one device ---- */
    function attach(conn, code, initiator) {
      const link = {
        conn, code, initiator, opened: false, closed: false, nonce: randomHex(32),
        hello: null, verified: false, presence: null, heard: now(), unchunk: new Unchunker(400),
        lastInvite: 0, strangerTimer: null,
      };
      conn.on('open', () => opened(link));
      conn.on('data', (raw) => { try { onData(link, raw); } catch (e) { console.warn('[friends] a message could not be read', e); } });
      conn.on('close', () => closed(link));
      conn.on('error', () => closed(link));
      return link;
    }
    function opened(link) {
      if (link.closed) return;
      link.opened = true;
      link.heard = now();
      const a = attempts.get(link.code);
      if (a && a.link === link) { clearTimeout(a.timer); attempts.delete(link.code); }
      /* Both sides may have dialled at once. Keep one line: the one the
         side with the smaller code opened (each side works this out the
         same way), or, both from the same side, the newer. A line that
         has been up a while is not a crossed call: the other side dialled
         again because, for them, it had died, so the new one wins. */
      link.openedAt = now();
      const have = links.get(link.code);
      if (have && have !== link && !have.closed) {
        const iShouldDial = myCode() < link.code;
        const crossed = now() - (have.openedAt || 0) < 10000;
        const keepNew = !crossed || link.initiator === have.initiator || link.initiator === iShouldDial;
        if (!keepNew) { closeLink(link); return; }
        retire(have);
      }
      const e = entry(link.code);
      if (!e) {
        strangers.add(link);
        // a stranger has a little while to ask something, and then the line is closed
        link.strangerTimer = setTimeout(() => { if (!entry(link.code)) closeLink(link); }, T.stranger);
      } else links.set(link.code, link);
      const me = o.profile ? o.profile() : {};
      send(link, {
        t: 'hi', v: 1, app: 'mtg-table', code: myCode(), n: link.nonce, p: presence,
        name: cleanName(me.name) || 'Player', avatar: isAvatar(me.avatar) ? me.avatar : null, frame: cleanFrame(me.frame),
      });
    }
    /** A line put aside for a better one: closed without counting as the friend going. */
    function retire(link) { link.retired = true; closeLink(link); }
    function closeLink(link) {
      if (!link) return;
      try { link.conn.close(); } catch (e) {}
      closed(link);
    }
    function closed(link) {
      if (link.closed) return;
      link.closed = true;
      clearTimeout(link.strangerTimer);
      strangers.delete(link);
      const a = attempts.get(link.code);
      if (a && a.link === link) { clearTimeout(a.timer); attempts.delete(link.code); }
      if (links.get(link.code) !== link) return;
      links.delete(link.code);
      const e = entry(link.code);
      if (link.verified && e) { e.seen = now(); save(); }
      if (link.verified && !link.retired) hub.emit('offline', link.code);
      hub.emit('change');
    }
    function send(link, msg) {
      if (!link || link.closed || !link.conn.open) return false;
      try { sendOn(link.conn, msg); return true; } catch (e) { return false; }
    }
    function heartbeat() {
      // the broker lost and not found again by itself: keep asking, gently
      if (wanted && peer && !peer.destroyed && peer.disconnected && status !== 'taken') { try { peer.reconnect(); } catch (e) { /* next time */ } }
      const t = now();
      for (const link of [...links.values(), ...strangers]) {
        if (t - link.heard > T.quiet) { closeLink(link); continue; }
        send(link, { t: 'ping' });
      }
    }

    /* ---- what arrives ---- */
    function onData(link, raw) {
      if (link.closed || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      link.heard = now();
      let msg = raw;
      if (msg.t === '~') { msg = link.unchunk.take(msg); if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return; }
      const t = msg.t;
      if (typeof t !== 'string') return;
      if (t === 'ping') return;
      if (t === 'hi') return gotHello(link, msg);
      if (!link.hello) return;            // nothing counts before a hello
      const e = entry(link.code);
      switch (t) {
        case 'proof': return gotProof(link, e, msg);
        case 'req': return gotRequest(link, e);
        case 'accept': return gotAccept(link, e, msg);
        case 'decline':
          if (e && e.state === 'out') { removeEntry(e.code); hub.emit('declined', link.code, e.name); }
          return;
        case 'unfriend':
          // a friendship can only be ended by its other half; a request or a friendship never confirmed, by anyone on that code
          if (e && (link.verified || e.state === 'out' || e.state === 'in' || !e.ok)) { removeEntry(e.code); hub.emit('removed', link.code); }
          return;
        case 'profile':
          if (e && (link.verified || e.state === 'in' || e.state === 'out')) takeProfile(e, msg);
          return;
        case 'presence':
          if (link.verified && PRESENCE.has(msg.p)) { link.presence = msg.p; hub.emit('change'); hub.emit('presence', link.code, msg.p); }
          return;
        case 'invite': {
          if (!link.verified) return;
          const room = cleanRoom(msg.room);
          if (!room || now() - link.lastInvite < 5000) return;
          link.lastInvite = now();
          hub.emit('invite', {
            code: link.code, name: (e && e.name) || cleanName(link.hello.name) || 'A friend', room,
            fmt: cleanName(typeof msg.fmt === 'string' ? msg.fmt : '').slice(0, 40), at: now(),
          });
          return;
        }
        case 'tr':
          if (link.verified) hub.emit('trade', link.code, msg);
          return;
        case 'tn':
          if (link.verified) hub.emit('tourney', link.code, msg);
          return;
        default:
      }
    }
    function gotHello(link, msg) {
      if (link.hello) return;
      if (msg.code !== link.code || !isHex(msg.n, 16, 64)) { closeLink(link); return; }
      link.hello = { name: cleanName(msg.name), avatar: isAvatar(msg.avatar) ? msg.avatar : null, frame: cleanFrame(msg.frame), n: msg.n };
      link.presence = PRESENCE.has(msg.p) ? msg.p : 'online';
      const e = entry(link.code);
      if (!e) return;                     // a stranger: it may ask (req), or be closed
      if (e.state === 'friend' || e.state === 'gone') {
        send(link, { t: 'proof', m: proofOf(e.secret, msg.n, myCode()) });
        if (e.state === 'gone') send(link, { t: 'unfriend' });
        return;
      }
      takeProfile(e, link.hello);
      if (e.state === 'out') send(link, { t: 'req' });
    }
    function gotProof(link, e, msg) {
      if (!e) {
        // they think we are friends and we have no record: say so (they will believe it only if it was never confirmed)
        send(link, { t: 'unfriend' });
        return;
      }
      if (e.state !== 'friend' || !e.secret || link.verified) return;
      if (typeof msg.m !== 'string' || msg.m !== proofOf(e.secret, link.nonce, link.code)) {
        // not them, or not the friendship we know: they stay offline here
        link.failed = true;
        hub.emit('change');
        return;
      }
      verified(link, e);
    }
    function verified(link, e) {
      link.verified = true;
      link.failed = false;
      const first = !e.ok;
      e.ok = true;
      e.seen = now();
      takeProfile(e, link.hello);
      save();
      if (first) hub.emit('confirmed', link.code);
      hub.emit('online', link.code);
    }
    function gotRequest(link, e) {
      if (isBlocked(link.code)) { closeLink(link); return; }
      if (load().declined.some(d => d.code === link.code)) { send(link, { t: 'decline' }); return; }
      if (!e) {
        const waiting = data.list.filter(x => x.state === 'in').length;
        if (waiting >= MAX_INCOMING || data.list.length >= MAX_LIST) return;
        const ne = { code: link.code, state: 'in', name: '', frame: null, since: now(), seen: now(), secret: null, ok: false };
        data.list.push(ne);
        takeProfile(ne, link.hello);
        strangers.delete(link);
        clearTimeout(link.strangerTimer);
        const had = links.get(link.code);
        if (had && had !== link) retire(had);
        links.set(link.code, link);
        save();
        hub.emit('request', link.code, ne.name);
        return;
      }
      if (e.state === 'friend') { send(link, { t: 'accept', s: e.secret }); return; }   // they lost the answer: again
      if (e.state === 'gone') { send(link, { t: 'decline' }); return; }
      if (e.state === 'out' && myCode() < link.code) {
        // both asked: the smaller code makes the secret, so there is only one
        becomeFriends(link, e, randomHex(32));
        send(link, { t: 'accept', s: e.secret });
      }
    }
    function gotAccept(link, e, msg) {
      if (!isHex(msg.s, 32, 32)) return;
      if (!e) { send(link, { t: 'unfriend' }); return; }
      if (e.state === 'out' || (e.state === 'friend' && !e.ok)) {
        becomeFriends(link, e, msg.s);
        // they handed the secret over on this line, so it is them; and now they can check it is us
        send(link, { t: 'proof', m: proofOf(e.secret, link.hello.n, myCode()) });
        verified(link, e);
        hub.emit('accepted', link.code, e.name);
      }
    }
    function becomeFriends(link, e, secret) {
      e.state = 'friend';
      e.secret = secret;
      e.since = now();
      takeProfile(e, link.hello);
      save();
    }
    function takeProfile(e, p) {
      if (!e || !p) return;
      let changed = false;
      const name = cleanName(p.name);
      if (name && name !== e.name) { e.name = name; changed = true; }
      if (p.frame !== undefined) { const f = cleanFrame(p.frame); if (f !== e.frame) { e.frame = f; changed = true; } }
      if (p.avatar !== undefined) setFace(e.code, p.avatar);
      if (changed) save(); else hub.emit('change');
    }
    function removeEntry(code) {
      load();
      data.list = data.list.filter(x => x.code !== code);
      dropFace(code);
      save();
    }

    /* ---- what the person does ---- */
    /** Add someone by their code (or link). Resolves { ok, why, accepted }. */
    function add(input) {
      const r = parseCode(input);
      if (!r.code) return { ok: false, why: r.why };
      const code = r.code;
      if (code === myCode()) return { ok: false, why: 'That is your own code.' };
      load();
      if (isBlocked(code)) unblock(code);
      data.declined = data.declined.filter(d => d.code !== code);
      const e = entry(code);
      if (e && e.state === 'friend') return { ok: false, why: `${e.name || formatCode(code)} is already your friend.` };
      if (e && e.state === 'out') { connectTo(code); return { ok: true, already: true }; }
      if (e && e.state === 'in') { accept(code); return { ok: true, accepted: true }; }
      if (data.list.filter(x => x.state !== 'gone').length >= MAX_LIST) return { ok: false, why: 'Your friends list is full.' };
      if (e) data.list = data.list.filter(x => x.code !== code);      // a tombstone: asking again starts afresh
      data.list.push({ code, state: 'out', name: '', frame: null, since: now(), seen: 0, secret: null, ok: false });
      save();
      const live = links.get(code) || [...strangers].find(l => l.code === code);
      if (live && live.hello) {
        strangers.delete(live); clearTimeout(live.strangerTimer); links.set(code, live);
        send(live, { t: 'req' });
      } else connectTo(code);
      return { ok: true };
    }
    function accept(code) {
      const e = entry(code);
      if (!e || e.state !== 'in') return false;
      // the secret is made now; if they are away, it waits for them (they will ask again when they connect)
      e.state = 'friend';
      e.secret = randomHex(32);
      e.since = now();
      e.ok = false;
      save();
      const link = links.get(code);
      if (link && link.hello) send(link, { t: 'accept', s: e.secret });
      else connectTo(code);
      return true;
    }
    function decline(code) {
      const e = entry(code);
      if (!e || e.state !== 'in') return false;
      const link = links.get(code);
      if (link) send(link, { t: 'decline' });
      data.declined = data.declined.filter(d => d.code !== code).concat([{ code, at: now() }]);
      removeEntry(code);
      return true;
    }
    /** Remove a friend, or take back a request. A friendship leaves its tombstone, to prove it to them. */
    function remove(code) {
      const e = entry(code);
      if (!e) return false;
      const link = links.get(code);
      if (e.state === 'friend' && e.ok) {
        e.state = 'gone';
        e.since = now();
        e.name = e.name || '';
        dropFace(code);
        save();
        if (link && link.verified) send(link, { t: 'unfriend' });
        if (link) setTimeout(() => closeLink(link), 400);
        return true;
      }
      if (link) send(link, { t: e.state === 'in' ? 'decline' : 'unfriend' });
      removeEntry(code);
      if (link) setTimeout(() => closeLink(link), 400);
      return true;
    }
    function block(code) {
      const r = parseCode(code);
      if (!r.code || r.code === myCode()) return false;
      const e = entry(r.code);
      load();
      data.blocked = data.blocked.filter(b => b.code !== r.code).concat([{ code: r.code, name: (e && e.name) || '', at: now() }]);
      data.list = data.list.filter(x => x.code !== r.code);
      dropFace(r.code);
      save();
      const link = links.get(r.code) || [...strangers].find(l => l.code === r.code);
      if (link) closeLink(link);
      return true;
    }
    function unblock(code) {
      load();
      const before = data.blocked.length;
      data.blocked = data.blocked.filter(b => b.code !== code);
      if (data.blocked.length !== before) save();
      return data.blocked.length !== before;
    }

    function setPresence(p) {
      if (!PRESENCE.has(p) || p === presence) return;
      presence = p;
      for (const link of links.values()) if (link.verified) send(link, { t: 'presence', p });
    }
    /** Your name, picture or frame changed: tell everyone connected. */
    function profileChanged() {
      const me = o.profile ? o.profile() : {};
      const msg = { t: 'profile', name: cleanName(me.name) || 'Player', avatar: isAvatar(me.avatar) ? me.avatar : null, frame: cleanFrame(me.frame) };
      for (const link of links.values()) if (link.hello) send(link, msg);
    }
    function invite(code, room, fmt) {
      const link = links.get(code);
      const r = cleanRoom(room);
      if (!link || !link.verified || !r) return false;
      return send(link, { t: 'invite', room: r, fmt: typeof fmt === 'string' ? fmt.slice(0, 40) : '' });
    }
    /** A trade message to a friend (src/09d-trade.js); false when they are not on a proved line. */
    function sendTrade(code, msg) {
      const link = links.get(code);
      if (!link || !link.verified || !msg || typeof msg !== 'object') return false;
      return send(link, Object.assign({}, msg, { t: 'tr' }));
    }
    /** A tournament message to a friend (src/09f-tourney.js); false when they are not on a proved line. */
    function sendTourney(code, msg) {
      const link = links.get(code);
      if (!link || !link.verified || !msg || typeof msg !== 'object') return false;
      return send(link, Object.assign({}, msg, { t: 'tn' }));
    }
    /** The name this device shows its friends. */
    const myName = () => cleanName((o.profile ? o.profile() : {}).name) || 'Player';

    /** Everyone on the list, as the interface shows them. */
    function entries() {
      load();
      loadFaces();
      return data.list.filter(e => e.state !== 'gone').map((e) => {
        const link = links.get(e.code);
        const online = !!(link && link.verified);
        return {
          code: e.code, state: e.state, name: e.name || '', frame: e.frame || null, avatar: faces[e.code] || null,
          since: e.since, seen: online ? now() : e.seen, ok: e.ok,
          online, presence: online ? (link.presence || 'online') : 'offline',
          reachable: !!(link && link.hello && !link.closed),
          unproved: !!(link && link.failed),
        };
      });
    }
    function counts() {
      const list = entries();
      return {
        online: list.filter(e => e.state === 'friend' && e.online).length,
        friends: list.filter(e => e.state === 'friend').length,
        requests: list.filter(e => e.state === 'in').length,
        out: list.filter(e => e.state === 'out').length,
      };
    }

    Object.assign(hub, {
      start, stop, wake, sweep, add, accept, decline, remove, block, unblock, setPresence, profileChanged, invite, sendTrade, sendTourney,
      entries, counts, myName,
      entry: (code) => entries().find(e => e.code === code) || null,
      blocked: () => load().blocked.map(b => Object.assign({}, b)),
      isOnline: (code) => { const l = links.get(code); return !!(l && l.verified); },
      presenceOf: (code) => { const l = links.get(code); return l && l.verified ? (l.presence || 'online') : 'offline'; },
      nameOf: (code) => { const e = entry(code); return (e && e.name) || formatCode(code); },
      /** A save is about to be written underneath: stop, and write nothing more. */
      freeze() { frozen = true; stop(); },
      _links: links,
    });
    // read as they are now, every time (Object.assign would copy them once)
    Object.defineProperties(hub, {
      code: { get: () => myCode() },
      status: { get: () => status },
      running: { get: () => wanted },
      presence: { get: () => presence },
    });
    return hub;
  }

  MTG.friendsCore = {
    ALPHABET, PREFIX, createHub, makeCode, isCode, parseCode, formatCode, checkLetter, sha256, proofOf, randomHex,
    sendOn, sendBig, Unchunker, cleanName, cleanRoom, CHUNK,
  };
})(window.MTG);
