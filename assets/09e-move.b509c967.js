/* ===== 09e-move.js ===== */
/* ============================================================
   09e-move.js - moving your save to another device, peer to peer

   The same file Options saves (src/14-app.js, App.profileDoc) sent
   straight from one device to the other. The sending device shows a
   one-time code, six letters with a check letter at the end; the other
   types it in, and connects to a peer id made from it on the PeerJS
   broker. The sender takes the first device that connects and no other
   (it stops listening), sends the save in pieces, and waits to hear
   whether it was taken. The receiver checks what arrived and asks before
   anything is replaced; the replacing itself is the app's
   (App.loadProfileDoc), the same as loading the file.

   A code is good for ten minutes. Nothing but the signalling goes
   through the broker: the save itself is on the direct, encrypted line.

   Your friend code is in the settings, so it moves too: the device that
   receives the save is you, as far as your friends can tell.
   ============================================================ */
'use strict';
(function (MTG) {
  const FC = () => MTG.friendsCore;
  const PREFIX = 'mtgtable-mv1-';
  const LEN = 6;
  const LIFE = 10 * 60 * 1000;
  const MAX_TEXT = 40 * 1024 * 1024;      // a save bigger than this is not one of ours

  /**
   * Whether a received document is a save this app could load. Returns
   * { ok, why, summary }; the summary is what the receiver is asked about.
   */
  function checkDoc(doc) {
    if (!doc || typeof doc !== 'object' || doc.app !== 'mtg-table' || doc.kind !== 'profile' || !doc.data || typeof doc.data !== 'object' || Array.isArray(doc.data))
      return { ok: false, why: 'What arrived is not an MTG Table save.' };
    let size = 0, keys = 0;
    for (const k of Object.keys(doc.data)) {
      const v = doc.data[k];
      if (!k.startsWith('mtgtable.') || typeof v !== 'string') return { ok: false, why: 'What arrived has things in it a save never has.' };
      size += k.length + v.length;
      keys++;
    }
    if (!keys) return { ok: false, why: 'What arrived is an empty save.' };
    if (size > MAX_TEXT) return { ok: false, why: 'What arrived is too big to be a save.' };
    const read = (k) => { try { return JSON.parse(doc.data[k] || 'null'); } catch (e) { return null; } };
    const eco = read('mtgtable.economy');
    const settings = read('mtgtable.settings.v1');
    const decks = read('mtgtable.deckindex');
    const friends = read('mtgtable.friends');
    return {
      ok: true,
      summary: {
        at: String(doc.at || '').slice(0, 10),
        name: settings && typeof settings.playerName === 'string' ? FC().cleanName(settings.playerName) : '',
        shards: eco && Number.isFinite(eco.shards) ? eco.shards : 0,
        cards: eco && eco.col && typeof eco.col === 'object' ? Object.keys(eco.col).length : 0,
        packs: eco && Array.isArray(eco.packs) ? eco.packs.length : 0,
        decks: Array.isArray(decks) ? decks.length : 0,
        friends: friends && Array.isArray(friends.list) ? friends.list.filter(f => f && f.state === 'friend').length : 0,
        size,
      },
    };
  }

  /* ---------------- sending ----------------
     `o`: Peer(), peerOptions(), makeDoc() (the save, as App.profileDoc
     makes it), name (who is sending). Returns a controller that emits
     'state' (name, info) as it goes:
       'opening'   asking the broker for the code
       'waiting'   the code is up: { code } to show
       'sending'   { done, of } pieces so far
       'sent'      all of it there; waiting for them to say yes or no
       'done'      they took it
       'declined'  they said no
       'failed'    { why }
       'expired'   nobody came within the time
     and cancel() to stop. */
  function send(o) {
    const ctl = new MTG.Emitter();
    let peer = null, conn = null, state = 'opening', expiry = null, tries = 0;
    const set = (s, info) => { if (state === 'done' || state === 'failed' || state === 'expired' || state === 'cancelled' || state === 'declined') return; state = s; ctl.emit('state', s, info || {}); };
    const end = () => { clearTimeout(expiry); setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) {} }, 1500); };
    const Peer = o.Peer && o.Peer();
    ctl.cancel = () => {
      if (state === 'done') return;
      try { if (conn && conn.open) conn.send({ t: 'cancel' }); } catch (e) {}
      set('cancelled');
      end();
    };
    if (!Peer) { setTimeout(() => set('failed', { why: 'The connection library did not load, so this device cannot send.' }), 0); return ctl; }

    const open = () => {
      const code = FC().makeCode(LEN);
      ctl.code = code;
      try { peer = new Peer(PREFIX + code, o.peerOptions ? o.peerOptions() : {}); }
      catch (e) { set('failed', { why: 'Could not start the connection: ' + (e && e.message || e) }); return; }
      const p = peer;
      p.on('open', () => {
        if (p !== peer) return;
        set('waiting', { code });
        clearTimeout(expiry);
        expiry = setTimeout(() => { if (state === 'waiting') { set('expired'); end(); } }, LIFE);
      });
      p.on('error', (err) => {
        if (p !== peer) return;
        const type = String((err && err.type) || '');
        if (type === 'unavailable-id' && state === 'opening' && ++tries < 4) { try { p.destroy(); } catch (e) {} open(); return; }
        if (state === 'opening' || state === 'waiting') set('failed', { why: 'Could not reach the signalling server. Check the connection and try again.' });
      });
      p.on('connection', (c) => {
        if (conn) { try { c.close(); } catch (e) {} return; }     // one device, the first
        conn = c;
        // the code is spent: no one else can reach this peer through the broker now
        try { p.disconnect(); } catch (e) {}
        clearTimeout(expiry);
        c.on('data', (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'hello' && state === 'waiting') go(c, msg);
          else if (msg.t === 'took' && state === 'sent') { set('done'); end(); }
          else if (msg.t === 'nope' && (state === 'sent' || state === 'sending')) { set('declined'); end(); }
        });
        c.on('close', () => { if (state !== 'done' && state !== 'declined') { set('failed', { why: 'The other device went away before it had the save.' }); end(); } });
        c.on('error', () => {});
      });
    };
    async function go(c, hello) {
      ctl.to = FC().cleanName(hello && hello.name) || '';
      set('sending', { done: 0, of: 1 });
      let doc;
      try { doc = o.makeDoc(); } catch (e) { set('failed', { why: 'Your save could not be read: ' + (e && e.message || e) }); end(); return; }
      try {
        await FC().sendBig(c, { t: 'save', from: FC().cleanName(o.name) || '', doc }, (done, of) => set('sending', { done, of }));
        set('sent');
      } catch (e) { set('failed', { why: e && e.message ? e.message : 'The save could not be sent.' }); end(); }
    }
    open();
    return ctl;
  }

  /* ---------------- receiving ----------------
     `code` as typed. `o`: Peer(), peerOptions(), name (this device's).
     The controller emits 'state':
       'connecting'
       'receiving'  { done, of }
       'received'   { doc, summary, from }: ask, then take() or refuse()
       'failed'     { why }
     take() tells the sender it was taken; refuse() that it was not. */
  function receive(code, o) {
    const ctl = new MTG.Emitter();
    let peer = null, conn = null, state = 'connecting', timer = null;
    const set = (s, info) => { if (state === 'failed' || state === 'taken' || state === 'refused') return; state = s; ctl.emit('state', s, info || {}); };
    const end = () => { clearTimeout(timer); setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) {} }, 1500); };
    const fail = (why) => { set('failed', { why }); end(); };
    ctl.take = () => { try { if (conn && conn.open) conn.send({ t: 'took' }); } catch (e) {} set('taken'); end(); };
    ctl.refuse = () => { try { if (conn && conn.open) conn.send({ t: 'nope' }); } catch (e) {} set('refused'); end(); };
    ctl.cancel = () => ctl.refuse();

    const parsed = FC().parseCode(code, LEN);
    const Peer = o.Peer && o.Peer();
    if (!parsed.code) { setTimeout(() => fail(parsed.why), 0); return ctl; }
    if (!Peer) { setTimeout(() => fail('The connection library did not load, so this device cannot receive.'), 0); return ctl; }
    try { peer = new Peer(null, o.peerOptions ? o.peerOptions() : {}); }
    catch (e) { setTimeout(() => fail('Could not start the connection: ' + (e && e.message || e)), 0); return ctl; }
    timer = setTimeout(() => { if (state === 'connecting') fail('No answer. Check the code, and that the other device still shows it.'); }, 25000);
    peer.on('error', (err) => {
      const type = String((err && err.type) || '');
      if (state !== 'connecting') return;
      fail(type === 'peer-unavailable' ? 'No device is showing that code. Check it, and that the other device still has it on screen.'
        : 'Could not reach the signalling server. Check the connection and try again.');
    });
    peer.on('open', () => {
      conn = peer.connect(PREFIX + parsed.code, { reliable: true, serialization: 'json' });
      const un = new (FC().Unchunker)(Math.ceil(MAX_TEXT / FC().CHUNK) + 2);
      un.onPart = (done, of) => { if (state === 'connecting' || state === 'receiving') set('receiving', { done, of }); };
      conn.on('open', () => {
        clearTimeout(timer);
        set('receiving', { done: 0, of: 1 });
        conn.send({ t: 'hello', v: 1, name: FC().cleanName(o.name) || '' });
      });
      conn.on('data', (raw) => {
        if (!raw || typeof raw !== 'object') return;
        if (raw.t === 'cancel') { fail('The other device stopped sending.'); return; }
        const msg = raw.t === '~' ? un.take(raw) : raw;
        if (!msg || msg.t !== 'save' || state !== 'receiving') return;
        const r = checkDoc(msg.doc);
        if (!r.ok) { try { conn.send({ t: 'nope' }); } catch (e) {} fail(r.why); return; }
        set('received', { doc: msg.doc, summary: r.summary, from: FC().cleanName(msg.from) || '' });
      });
      conn.on('close', () => { if (state === 'connecting' || state === 'receiving') fail('The other device went away part way through.'); });
      conn.on('error', () => {});
    });
    return ctl;
  }

  MTG.move = { PREFIX, LEN, send, receive, checkDoc };
})(window.MTG);
