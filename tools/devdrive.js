/* Dev-only: drive the table from the console while testing.
   Load with:
     await new Promise(r => { const s = document.createElement('script'); s.src = '/tools/devdrive.js?' + Date.now(); s.onload = r; document.head.appendChild(s); });
   Then: await __step('declareBlockers', 40000, {attack: false, creaturesOnly: true}) */
window.__step = async function (stop, ms, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const T = () => MTG.app.table;
  const sleep = (n) => new Promise(r => setTimeout(r, n));
  while (Date.now() - t0 < (ms || 40000)) {
    await sleep(100);
    const t = T();
    const v = t && t.live;
    if (!v || v.over) return 'over';
    if (t.queue.length || t.view !== v) continue;
    if (v.mulliganPhase) {
      const k = [...document.querySelectorAll('.dpanel button')].find(b => /Keep/.test(b.textContent));
      if (k && !k.disabled) k.click();
      continue;
    }
    if (t.asking) {
      const c = [...document.querySelectorAll('.dpanel button')].find(b => /Continue|Cast/.test(b.textContent));
      if (c) c.click();
      continue;
    }
    if (t.targeting) {
      if (stop === 'target') return 'targeting';
      const o = v.battlefield.find(x => t.isTargetable(x));
      if (o) { t.onCardClick(o.id, {}, t.els.get(o.id)); continue; }
      const p = v.players.find(x => t.isTargetablePlayer(x));
      if (p) { t.aimAtPlayer(p.id); continue; }
      t.cancelTargeting(); continue;
    }
    const ch = v.pendingChoice;
    if (ch && ch.playerId === t.meId) {
      if (ch.type === stop) return 'choice ' + ch.type;
      if (ch.type === 'declareAttackers') { if (opts.attack) t.attackAll(ch); t.primaryAction(); continue; }
      if (ch.type === 'declareBlockers') { t.primaryAction(); continue; }
      if (/discard/.test(ch.type)) { t.send({ kind: 'choice', data: { cardIds: t.me.hand.slice(0, ch.count || 1).map(o => o.id) } }); await sleep(400); continue; }
      if (opts.answerAll) {
        const answers = {
          mode: () => ({ modes: Array.from({ length: ch.count || 1 }, (_, i) => (ch.options[i] || ch.options[0]).i) }),
          pickCard: () => ({ cardIds: (ch.cards || []).slice(0, Math.max(1, ch.count || 1)).map(c => c.id) }),
          confirm: () => ({ yes: true }),
          payOrDont: () => ({ pay: false }),
          payOrCounter: () => ({ pay: false }),
          scry: () => ({ top: (ch.cards || []).map(c => c.id), bottom: [] }),
          surveil: () => ({ top: (ch.cards || []).map(c => c.id), bottom: [] }),
          arrange: () => ({ top: (ch.cards || []).map(c => c.id) }),
          orderTriggers: () => ({ top: (ch.cards || []).map(c => c.id) }),
          sacrifice: () => ({ cardIds: v.battlefield.filter(o => o.controller === t.meId).slice(0, ch.count || 1).map(o => o.id) }),
          vote: () => ({ choice: (ch.options || [])[0] }),
          riot: () => ({ haste: true }),
          byHand: () => ({ done: true }),
        };
        if (answers[ch.type]) { t.send({ kind: 'choice', data: answers[ch.type]() }); await sleep(400); continue; }
      }
      return 'choice ' + ch.type;
    }
    if (v.priorityPlayer !== t.meId) continue;
    const p = v.playable || [];
    const hand = t.me.hand;
    const land = hand.find(o => p.includes(o.id) && MTG.oracle.analyze(o.card).isLand);
    if (land) { t.playFromHand(land); continue; }
    const spell = hand.find(o => p.includes(o.id) && (!opts.creaturesOnly || MTG.oracle.analyze(o.card).isCreature));
    if (spell && v.activePlayer === t.meId && v.step === 'main') { t.playFromHand(spell); await sleep(250); continue; }
    t.primaryAction();
  }
  return 'timeout turn ' + T().live.turn;
};
window.__shot = () => { const t = MTG.app.table, v = t.live; return { turn: v.turn, step: v.step, prio: v.priorityPlayer, ch: v.pendingChoice && v.pendingChoice.type, life: v.players.map(p => p.name + ' ' + p.life) }; };
