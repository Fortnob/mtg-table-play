/* ============================================================
   09-net.js - peer-to-peer multiplayer over WebRTC (PeerJS)
   One player hosts; everyone else connects with a room code. The host
   holds the authoritative game and sends each player their own redacted
   view, so nobody's client ever receives another player's hand.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  const ROOM_PREFIX = 'mtgtable-v1-';
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1

  /* A data channel quietly drops any single message much over 16KB — no
     error, no close, it simply never arrives. A game view is bigger than
     that from the first turn, so anything long is cut into pieces that each
     fit, sent in order on the reliable channel, and stitched back together
     on the other side. */
  const CHUNK = 12000;

  function makeRoomCode(len) {
    let s = '';
    for (let i = 0; i < (len || 5); i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
  }

  function peerAvailable() { return typeof window.Peer === 'function'; }

  /* Public STUN servers: enough for most home networks, where each side
     only needs to learn its own public address. */
  const STUN = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  /**
   * The ICE servers to use: the STUN servers above plus any TURN relay the
   * player has entered in Options. A strict network (an office, a school,
   * some mobile carriers) blocks the direct connection, and only a relay
   * gets through; there is no free public one to rely on, so none is
   * built in.
   */
  function iceServers() {
    const mine = (MTG.settings.iceServers || []).filter(s => s && s.urls).map(s => {
      const out = { urls: String(s.urls).split(/[\s,]+/).filter(Boolean) };
      if (s.username) out.username = String(s.username);
      if (s.credential) out.credential = String(s.credential);
      return out;
    });
    return STUN.concat(mine);
  }

  function peerOptions() {
    // PeerJS's public broker. Nothing but signalling passes through it;
    // the game traffic itself is a direct encrypted WebRTC channel.
    return { debug: MTG.DEBUG ? 2 : 0, config: { iceServers: iceServers() } };
  }

  /**
   * Gather ICE candidates with the current servers and say what came back:
   * host (this machine), srflx (a public address, from STUN) and relay
   * (from TURN). No connection is made and nothing is sent to anyone but
   * the servers themselves. Resolves to {host, srflx, relay, ms, error}.
   */
  function testIce(opts) {
    opts = opts || {};
    const servers = opts.iceServers || iceServers();
    const t0 = Date.now();
    const out = { host: 0, srflx: 0, relay: 0, ms: 0, error: null, turn: servers.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u))) };
    if (typeof RTCPeerConnection !== 'function') { out.error = 'This browser does not support WebRTC.'; return Promise.resolve(out); }
    return new Promise((resolve) => {
      let pc;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        out.ms = Date.now() - t0;
        try { pc.close(); } catch (e) {}
        resolve(out);
      };
      try { pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 0 }); }
      catch (e) { out.error = 'Those server details were not accepted: ' + (e && e.message || e); resolve(out); return; }
      pc.onicecandidate = (e) => {
        if (!e.candidate) { finish(); return; }
        const m = / typ (host|srflx|prflx|relay)/.exec(e.candidate.candidate || '');
        const kind = e.candidate.type || (m && m[1]);
        if (kind === 'host') out.host++;
        else if (kind === 'srflx' || kind === 'prflx') out.srflx++;
        else if (kind === 'relay') out.relay++;
      };
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.createDataChannel('probe');
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch((e) => { out.error = String(e && e.message || e); finish(); });
      setTimeout(finish, opts.timeout || 9000);
    });
  }

  /* ============================================================
     Net - one object, two modes (host / client)
     ============================================================ */
  class Net extends MTG.Emitter {
    constructor() {
      super();
      this.mode = 'offline';      // 'offline' | 'host' | 'client'
      this.peer = null;
      this.conns = new Map();     // peerId -> DataConnection (host)
      this.hostConn = null;       // DataConnection (client)
      this.roomCode = null;
      this.selfId = null;
      this.members = [];          // lobby roster
      this.ready = false;
      this.lastError = null;
      this._seq = 0;
      this._pingTimer = null;
      /* How the connections are doing. The host pings each guest and times
         the answer; a guest learns its own round trip from the next ping. */
      this.rtt = new Map();       // peerId -> ms (host)
      this.heard = new Map();     // peerId -> when it last answered (host)
      this.hostRtt = null;        // ms (client)
      this.hostHeard = 0;         // when the host last pinged (client)
      this.rejoining = false;     // a client trying to get back to its table
    }

    get isHost() { return this.mode === 'host'; }
    get isClient() { return this.mode === 'client'; }
    get online() { return this.mode !== 'offline'; }

    /* ---------------- hosting ---------------- */
    async host(opts) {
      opts = opts || {};
      if (!peerAvailable()) throw new Error('Multiplayer library did not load. Solo and bot games still work.');
      this.destroy();
      this.mode = 'host';
      this.roomCode = (opts.code || makeRoomCode(5)).toUpperCase();
      this.selfId = 'host';
      const id = ROOM_PREFIX + this.roomCode;

      await new Promise((/** @type {(value?: any) => void} */ resolve, reject) => {
        let settled = false;
        try { this.peer = new window.Peer(id, peerOptions()); }
        catch (e) { return reject(new Error('Could not start the multiplayer layer: ' + (e && e.message || e))); }
        this.peer.on('open', () => { settled = true; resolve(); });
        this.peer.on('error', (err) => {
          if (settled) { this.emit('error', String(err)); return; }
          settled = true;
          if (String(err).includes('taken') || (err && err.type === 'unavailable-id')) {
            // that room code is in use; try another
            this.roomCode = makeRoomCode(5);
            this.peer.destroy();
            this.host({ code: this.roomCode }).then(resolve, reject);
          } else reject(new Error(friendlyPeerError(err)));
        });
        setTimeout(() => { if (!settled) { settled = true; reject(new Error('Could not reach the signalling server. Check your connection.')); } }, 15000);
      });

      this.peer.on('connection', (conn) => this._acceptClient(conn));
      this.ready = true;
      this.emit('open', { mode: 'host', code: this.roomCode });
      this._startPing();
      return this.roomCode;
    }

    _acceptClient(conn) {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.emit('peer:join', conn.peer);
        MTG.sfx('join');
        this.send(conn.peer, { t: 'welcome', code: this.roomCode, yourId: conn.peer });
        this.emit('need:sync');
      });
      conn.on('data', (msg) => this._onHostData(conn, msg));
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this.rtt.delete(conn.peer);
        this.heard.delete(conn.peer);
        this.emit('peer:leave', conn.peer);
        MTG.sfx('leave');
      });
      conn.on('error', (e) => this.emit('error', friendlyPeerError(e)));
    }

    _onHostData(conn, msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === '~') { msg = this._unchunk(conn.peer, msg); if (!msg) return; }
      switch (msg.t) {
        case 'hello': this.emit('hello', conn.peer, msg.payload); break;
        case 'intent': this.emit('intent', conn.peer, msg.payload); break;
        case 'chat': this.broadcast({ t: 'chat', payload: { from: msg.payload.from, text: msg.payload.text, at: Date.now() } }); this.emit('chat', msg.payload); break;
        case 'pong':
          if (typeof msg.at === 'number') {
            this.rtt.set(conn.peer, Math.max(0, Date.now() - msg.at));
            this.heard.set(conn.peer, Date.now());
            this.emit('rtt', conn.peer, this.rtt.get(conn.peer));
          }
          break;
        default: this.emit('message', conn.peer, msg);
      }
    }

    /* ---------------- joining ---------------- */
    async join(code, hello) {
      if (!peerAvailable()) throw new Error('Multiplayer library did not load. Solo and bot games still work.');
      const keep = this._lastJoin, tries = this._rejoinTries, rejoining = this.rejoining;
      this.destroy();
      this._lastJoin = keep; this._rejoinTries = tries; this.rejoining = rejoining;
      this.mode = 'client';
      this.roomCode = String(code || '').trim().toUpperCase();
      if (!this.roomCode) throw new Error('Enter a room code.');

      await new Promise((/** @type {(value?: any) => void} */ resolve, reject) => {
        let settled = false;
        try { this.peer = new window.Peer(null, peerOptions()); }
        catch (e) { return reject(new Error('Could not start the multiplayer layer: ' + (e && e.message || e))); }
        this.peer.on('open', (id) => {
          this.selfId = id;
          const conn = this.peer.connect(ROOM_PREFIX + this.roomCode, { reliable: true, serialization: 'json' });
          this.hostConn = conn;
          conn.on('open', () => {
            settled = true;
            this.ready = true;
            this.send(null, { t: 'hello', payload: hello || {} });
            this.emit('open', { mode: 'client', code: this.roomCode });
            MTG.sfx('join');
            resolve();
          });
          conn.on('data', (msg) => this._onClientData(msg));
          conn.on('close', () => {
            this.emit('disconnected');
            MTG.sfx('leave');
            this._scheduleRejoin();
          });
          conn.on('error', (e) => { if (!settled) { settled = true; reject(new Error(friendlyPeerError(e))); } });
        });
        this.peer.on('error', (err) => {
          if (settled) { this.emit('error', friendlyPeerError(err)); return; }
          settled = true;
          reject(new Error(friendlyPeerError(err)));
        });
        setTimeout(() => { if (!settled) { settled = true; reject(new Error('No answer from that room. Check the code, and make sure the host still has the tab open.')); } }, 20000);
      });
      this._lastJoin = { code: this.roomCode, hello: hello || {} };
      this._rejoinTries = 0;
      this._startPing();
    }

    /**
     * Wi-Fi drops, a laptop sleeps, a phone switches network. None of that
     * should end a game, so a client keeps trying to get back to the same
     * room; the host recognises its token and gives it the same seat.
     */
    _scheduleRejoin() {
      if (this.mode !== 'client' || this._closing || !this._lastJoin) return;
      if (this._rejoinTimer) return;
      const tries = (this._rejoinTries = (this._rejoinTries || 0) + 1);
      if (tries > 8) { this.rejoining = false; this.emit('rejoin:failed'); return; }
      this.rejoining = true;
      const wait = Math.min(1000 * Math.pow(1.6, tries - 1), 12000);
      this.emit('rejoin:trying', { attempt: tries, inMs: wait });
      this._rejoinTimer = setTimeout(async () => {
        this._rejoinTimer = null;
        const last = this._lastJoin;
        if (!last || this._closing) return;
        try {
          await this.join(last.code, last.hello);
          this.rejoining = false;
          this.emit('rejoin:ok');
        } catch (e) {
          this._scheduleRejoin();
        }
      }, wait);
    }

    _onClientData(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === '~') { msg = this._unchunk('host', msg); if (!msg) return; }
      switch (msg.t) {
        case 'welcome': this.hostPeerId = ROOM_PREFIX + this.roomCode; this.emit('welcome', msg); break;
        case 'lobby': this.members = msg.payload.members || []; this.emit('lobby', msg.payload); break;
        case 'state': this.emit('state', msg.payload); break;
        case 'draft': this.emit('draft', msg.payload); break;
        case 'chat': this.emit('chat', msg.payload); MTG.sfx('chat'); break;
        case 'log': this.emit('log', msg.payload); break;
        case 'error': this.emit('error', msg.payload); break;
        case 'kick': this.emit('kicked', msg.payload); this.destroy(); break;
        case 'ping':
          this.send(null, { t: 'pong', at: msg.at });
          this.hostHeard = Date.now();
          if (typeof msg.rtt === 'number') { this.hostRtt = msg.rtt; this.emit('rtt', 'host', msg.rtt); }
          break;
        default: this.emit('message', 'host', msg);
      }
    }

    /* ---------------- sending ---------------- */
    send(peerId, msg) {
      msg.seq = ++this._seq;
      try {
        if (this.isClient) { if (this.hostConn && this.hostConn.open) this._sendOn(this.hostConn, msg); return; }
        if (peerId) { const c = this.conns.get(peerId); if (c && c.open) this._sendOn(c, msg); return; }
        this.broadcast(msg);
      } catch (e) { console.warn('[net] send failed', e); }
    }
    broadcast(msg) {
      if (!this.isHost) return;
      msg.seq = msg.seq || ++this._seq;
      for (const c of this.conns.values()) { if (c.open) { try { this._sendOn(c, msg); } catch (e) { console.warn('[net] send failed', e); } } }
    }
    /** Host: send each peer their own redacted payload. */
    sendPerPeer(fn) {
      if (!this.isHost) return;
      for (const [peerId, c] of this.conns) {
        if (!c.open) continue;
        const msg = fn(peerId);
        if (msg) { msg.seq = ++this._seq; try { this._sendOn(c, msg); } catch (e) { console.warn('[net] send failed', e); } }
      }
    }

    /** One message down one connection, in pieces if it is too big to go whole. */
    _sendOn(c, msg) {
      const text = JSON.stringify(msg);
      if (text.length <= CHUNK) { c.send(msg); return; }
      const id = (this._chunkId = (this._chunkId || 0) + 1);
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) c.send({ t: '~', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    }

    /** A piece of a long message: null until the last piece is in, then the whole thing. */
    _unchunk(from, msg) {
      this._chunks = this._chunks || new Map();
      const key = from + ':' + msg.id;
      let buf = this._chunks.get(key);
      if (!buf) { buf = { parts: new Array(msg.n), got: 0 }; this._chunks.set(key, buf); }
      if (buf.parts[msg.i] == null) { buf.parts[msg.i] = msg.d; buf.got++; }
      if (buf.got < msg.n) return null;
      this._chunks.delete(key);
      try { return JSON.parse(buf.parts.join('')); }
      catch (e) { console.warn('[net] a long message arrived broken', e); return null; }
    }
    intent(payload) {
      if (this.isClient) this.send(null, { t: 'intent', payload });
      else this.emit('intent', 'host', payload);
    }
    chat(from, text) {
      const payload = { from, text: String(text).slice(0, 500), at: Date.now() };
      if (this.isHost) { this.broadcast({ t: 'chat', payload }); this.emit('chat', payload); }
      else this.send(null, { t: 'chat', payload });
    }

    /* Every few seconds, each guest is pinged with the time and told its
       last round trip, so both ends can show how the connection is. */
    _startPing() {
      clearInterval(this._pingTimer);
      if (!this.isHost) return;
      const ping = () => {
        for (const peerId of this.conns.keys()) {
          const rtt = this.rtt.get(peerId);
          this.send(peerId, rtt != null ? { t: 'ping', at: Date.now(), rtt } : { t: 'ping', at: Date.now() });
        }
      };
      this._pingTimer = setInterval(ping, 5000);
      setTimeout(ping, 800);
    }

    /** How a connection is doing: 'good', 'fair', 'poor', or null when there is no figure yet. */
    quality(ms) {
      if (ms == null) return null;
      return ms < 150 ? 'good' : ms < 400 ? 'fair' : 'poor';
    }

    destroy() {
      this._closing = true;                  // a deliberate exit, not a drop
      clearTimeout(this._rejoinTimer);
      this._rejoinTimer = null;
      this._lastJoin = null;
      clearInterval(this._pingTimer);
      try { for (const c of this.conns.values()) c.close(); } catch (e) {}
      this.conns.clear();
      this._chunks = null;
      try { if (this.hostConn) this.hostConn.close(); } catch (e) {}
      this.hostConn = null;
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.peer = null;
      this.mode = 'offline';
      this.ready = false;
      this.roomCode = null;
      this.rtt.clear();
      this.heard.clear();
      this.hostRtt = null;
      this.hostHeard = 0;
      this.rejoining = false;
      this._closing = false;
    }
  }

  function friendlyPeerError(err) {
    const s = String((err && err.type) || err || '');
    if (s.includes('peer-unavailable')) return 'No room with that code is open right now.';
    if (s.includes('unavailable-id')) return 'That room code is already in use.';
    if (s.includes('network')) return 'Lost contact with the signalling server.';
    if (s.includes('browser-incompatible')) return 'This browser does not support WebRTC.';
    if (s.includes('webrtc')) return 'WebRTC connection failed - a firewall or VPN may be blocking it.';
    if (s.includes('disconnected')) return 'Disconnected from the signalling server.';
    return 'Connection problem: ' + s;
  }

  MTG.net = new Net();
  MTG.net.peerAvailable = peerAvailable;
  MTG.net.iceServers = iceServers;
  MTG.net.testIce = testIce;
})(window.MTG);


