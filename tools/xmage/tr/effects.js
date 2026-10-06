/* XMage effects -> the engine's effect ops.

   An XMage effect with "Target" in its name acts on its ability's targets
   through a target pointer: the first target unless it is told otherwise.
   The engine puts a target's spec on the first effect that uses it, and a
   later effect about the same thing says "that one" (scope lastTarget, or
   who: 'target' for a player). `aim` does that bookkeeping. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf, REG } = require('./core');
const F = require('./filters');
const P = require('./parts');

/* ---------------- shared helpers ---------------- */

/** Which of the ability's targets an effect points at. */
function pointerOf(o) {
  let idx = 0, each = false;
  for (const c of calls(o, 'setTargetPointer')) {
    const p = c.args[0];
    const k = p && p.t === 'obj' ? p.cls : null;
    if (k === 'FirstTargetPointer') idx = 0;
    else if (k === 'SecondTargetPointer') idx = 1;
    else if (k === 'ThirdTargetPointer') idx = 2;
    else if (k === 'EachTargetPointer') each = true;
    else block('target pointer ' + (k || keyOf(p)));
  }
  return { idx, each };
}

/**
 * The engine fields for "what this effect acts on" when it acts on a target.
 * want: 'object' | 'player' | 'any'.
 */
function aim(o, tc, want) {
  const ab = tc.ab;
  if (!ab) block('target outside an ability');
  const { idx, each } = pointerOf(o);
  if (each) {
    if (ab.targets.length < 2) block('each target of one');
    const specs = [];
    ab.targets.forEach((t, i) => { if (ab.used.has(i)) block('target used twice'); ab.used.add(i); specs.push(...t.specs); });
    return { targets: specs };
  }
  const t = ab.targets[idx];
  if (!t) {
    /* No target of its own: an effect on a trigger that points at what set
       it off ("that player", "that creature", "that spell"). */
    const p = tc.trigger && tc.trigger.pointer;
    if (p && idx === 0 && !ab.targets.length) return { pointer: p };
    block('effect with no target');
  }
  if (want === 'player' && t.kind !== 'player' && t.kind !== 'any') block('player effect on a ' + t.kind + ' target');
  if (want === 'object' && t.kind === 'player') block('object effect on a player target');
  if (t.notTarget) {
    // "put a counter on a creature you control": chosen, not targeted
    if (t.specs.length !== 1 || t.kind !== 'object' || t.specs[0].zone !== 'battlefield' || ab.used.has(idx)) block('chosen, not targeted');
    ab.used.add(idx);
    const s = Object.assign({}, t.specs[0]);
    s.filter = F.words(t.d);
    return { chooseFrom: s };
  }
  if (!ab.used.has(idx)) {
    ab.used.add(idx);
    return { targets: t.specs.map(s => Object.assign({}, s)) };
  }
  // the same target again: "it", "that player"
  if (idx !== 0 || t.specs.length !== 1) block('second use of a later target');
  if (t.kind === 'player') return { again: 'player' };
  return { scope: 'lastTarget' };
}

/** A player target for an effect: { who: 'target', targets? } */
const TRIGGER_PLAYER_OPS = new Set(['draw', 'discard', 'mill', 'loseLife', 'sacrificeChoice']);
function aimPlayer(o, tc, op) {
  const a = aim(o, tc, 'player');
  if (a.pointer) {
    if (a.pointer !== 'player' || !TRIGGER_PLAYER_OPS.has(op)) block('that player, for ' + (op || o.cls));
    return { who: 'triggerPlayer' };
  }
  if (a.chooseFrom) block('chosen player');
  if (a.scope) block('player effect on an object');
  const out = { who: 'target' };
  if (a.targets) out.targets = a.targets;
  return out;
}

/** An object target: { targets } or { scope: 'lastTarget' } */
function aimObject(o, tc) {
  const a = aim(o, tc, 'object');
  if (a.pointer) {
    if (a.pointer !== 'permanent') block('that ' + a.pointer);
    return { scope: 'triggerObject' };
  }
  if (a.again) block('object effect on a player');
  return a;
}

const DURATION = {
  EndOfTurn: 'eot', WhileOnBattlefield: 'static', EndOfGame: 'permanent', Custom: 'custom',
  UntilYourNextTurn: 'nextTurn', EndOfCombat: 'endOfCombat', WhileControlled: 'whileControlled',
  UntilEndOfYourNextTurn: 'endOfYourNextTurn', OneUse: 'oneUse', UntilSourceLeavesBattlefield: 'sourceLeaves',
};
function durationOf(o, dflt) {
  const r = o.args.find(a => a && a.t === 'ref' && /^Duration\./.test(a.path));
  const v = r ? r.path.split('.')[1] : dflt;
  const d = DURATION[v];
  if (!d) block('Duration.' + v);
  return d;
}

/* Cosmetic calls on an effect: they change the rules text, not the rules. */
const COSMETIC = new Set(['setText', 'concatBy', 'withTargetDescription', 'setOutcome', 'withChooseHint', 'setStaticText',
  'setTargetPointer', 'withAdditionalText']);
function checkCalls(o, allowed) {
  for (const c of o.calls) {
    if (COSMETIC.has(c.name) || (allowed && allowed.includes(c.name))) continue;
    block(o.cls + '.' + c.name);
  }
}

/** The keywords an XMage ability grants, or refuse if it is not a plain keyword. */
function keywordsOf(v, tc) {
  if (v && v.t === 'obj' && v.cls === 'CompoundAbility') {
    const items = v.args.length === 1 && v.args[0].t === 'array' ? v.args[0].items : v.args;
    return items.flatMap(x => keywordsOf(x, tc));
  }
  const kw = tr('keyword', v, tc);
  return [kw];
}

/** One translated effect (or a list of them), with its calls checked. */
function effect(v, tc) {
  const out = tr('effect', v, tc);
  return [].concat(out);
}

/** Every effect added to a holder after the first: addEffect calls. */
function effectList(first, holder, tc) {
  const list = [];
  if (first) list.push(...effect(first, tc));
  for (const c of calls(holder, 'addEffect')) list.push(...effect(c.args[0], tc));
  return list;
}

/* ---------------- one-shot effects ---------------- */

const amt = (o, tc, i) => {
  const v = o.args.filter(a => ['int', 'value'].includes(kindOf(a)))[i || 0];
  if (!v) block(o.cls + ' amount');
  return P.amount(v, tc);
};

def('effect', 'DrawCardSourceControllerEffect', (o, tc) => { checkCalls(o); return { op: 'draw', n: amt(o, tc), who: 'you' }; });
def('effect', 'DrawCardTargetEffect', (o, tc) => {
  checkCalls(o);
  if (A(o).bool(0, false) || A(o).bool(1, false)) block('optional or up-to draw');
  return Object.assign({ op: 'draw', n: amt(o, tc) }, aimPlayer(o, tc, 'draw'));
});
def('effect', 'DrawCardAllEffect', (o, tc) => { checkCalls(o); return { op: 'draw', n: amt(o, tc), who: 'each' }; });
def('effect', 'GainLifeEffect', (o, tc) => { checkCalls(o); return { op: 'gainLife', n: amt(o, tc), who: 'you' }; });
def('effect', 'GainLifeTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'gainLife', n: amt(o, tc) }, aimPlayer(o, tc, 'gainLife')); });
def('effect', 'LoseLifeSourceControllerEffect', (o, tc) => { checkCalls(o); return { op: 'loseLife', n: amt(o, tc), who: 'you' }; });
def('effect', 'LoseLifeTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'loseLife', n: amt(o, tc) }, aimPlayer(o, tc, 'loseLife')); });
def('effect', 'LoseLifeOpponentsEffect', (o, tc) => { checkCalls(o); return { op: 'loseLife', n: amt(o, tc), who: 'opponents' }; });
def('effect', 'LoseLifeTargetControllerEffect', (o, tc) => {
  checkCalls(o);
  const a = aimObject(o, tc);
  const out = { op: 'loseLife', n: amt(o, tc), who: 'targetController' };
  if (a.targets) block('controller of a target nothing else uses');
  return out;
});
def('effect', 'DamageTargetEffect', (o, tc) => {
  checkCalls(o, ['withTargetDescription']);
  const a = aim(o, tc, 'any');
  if (a.pointer === 'player') return { op: 'damage', n: amt(o, tc), toTriggerPlayer: true };
  if (a.pointer === 'permanent') return { op: 'damage', n: amt(o, tc), scope: 'triggerObject' };
  if (a.pointer) block('damage to that ' + a.pointer);
  if (a.chooseFrom || a.again) block('damage to a chosen thing');
  if (a.scope) block('damage to it again');
  return Object.assign({ op: 'damage', n: amt(o, tc) }, a);
});
def('effect', 'DamagePlayersEffect', (o, tc) => {
  checkCalls(o);
  const who = A(o).enumv('TargetController') || 'ANY';
  const each = { ANY: 'player', OPPONENT: 'opponent' }[who];
  if (!each) block('DamagePlayersEffect ' + who);
  return { op: 'damage', n: amt(o, tc), each };
});
def('effect', 'DamageControllerEffect', (o, tc) => { checkCalls(o); return { op: 'damage', n: amt(o, tc), toSelf: true }; });
def('effect', 'DamageAllEffect', (o, tc) => {
  checkCalls(o);
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  return { op: 'damage', n: amt(o, tc), scope: F.toScope(d) };
});
def('effect', 'DamageEverythingEffect', (o, tc) => {
  checkCalls(o);
  if (o.args.some(a => kindOf(a) === 'filter')) block('DamageEverythingEffect with a filter');
  return [{ op: 'damage', n: amt(o, tc), each: 'creature' }, { op: 'damage', n: amt(o, tc), each: 'player' }];
});
def('effect', 'ScryEffect', (o, tc) => { checkCalls(o); return { op: 'scry', n: amt(o, tc) }; });
def('effect', 'SurveilEffect', (o, tc) => { checkCalls(o); return { op: 'surveil', n: amt(o, tc) }; });
def('effect', 'MillCardsControllerEffect', (o, tc) => { checkCalls(o); return { op: 'mill', n: amt(o, tc), who: 'you' }; });
def('effect', 'MillCardsTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'mill', n: amt(o, tc) }, aimPlayer(o, tc, 'mill')); });
def('effect', 'DiscardTargetEffect', (o, tc) => {
  checkCalls(o);
  const out = Object.assign({ op: 'discard', n: amt(o, tc) }, aimPlayer(o, tc, 'discard'));
  if (A(o).bool(0, false)) out.random = true;
  return out;
});
def('effect', 'DiscardControllerEffect', (o, tc) => {
  checkCalls(o);
  const out = { op: 'discard', n: amt(o, tc), who: 'you' };
  if (A(o).bool(0, false)) out.random = true;
  return out;
});
def('effect', 'DiscardEachPlayerEffect', (o, tc) => {
  checkCalls(o);
  const who = A(o).enumv('TargetController') || 'ANY';
  if (o.args.some(a => kindOf(a) === 'bool' && a.v)) block('random discard');
  const w = { ANY: 'each', OPPONENT: 'opponents' }[who];
  if (!w) block('DiscardEachPlayerEffect ' + who);
  return { op: 'discard', n: o.args.length && ['int', 'value'].includes(kindOf(o.args[0])) ? amt(o, tc) : 1, who: w };
});
def('effect', 'DrawDiscardControllerEffect', (o, tc) => {
  checkCalls(o);
  const ints = A(o).all('int').map(x => x.v);
  if (A(o).bool(0, false)) block('optional loot');
  const d = ints.length ? ints[0] : 1, k = ints.length > 1 ? ints[1] : 1;
  return { op: 'drawDiscard', n: d, discard: k };
});
def('effect', 'CreateTokenEffect', (o, tc) => {
  checkCalls(o);
  const tok = P.tokenOf(o.args[0], tc);
  const rest = o.args.slice(1);
  const nv = rest.find(a => ['int', 'value'].includes(kindOf(a)));
  const n = nv ? P.amount(nv, tc) : 1;
  const bools = rest.filter(a => kindOf(a) === 'bool').map(a => a.v);
  return P.createTokenEffect(tok, n, { tapped: !!bools[0], attacking: !!bools[1] });
});
def('effect', 'AddCountersSourceEffect', (o, tc) => {
  checkCalls(o);
  const c = P.counterOf(o.args[0], tc);
  if (o.args[1] && kindOf(o.args[1]) !== 'null') { if (c.n !== 1) block('counter count twice'); c.n = P.amount(o.args[1], tc); }
  if (A(o).bool(0, false)) block('counters on the card');
  return { op: 'counters', kind: c.kind, n: c.n, scope: 'self' };
});
def('effect', 'AddCountersTargetEffect', (o, tc) => {
  checkCalls(o);
  const c = P.counterOf(o.args[0], tc);
  const nv = o.args.slice(1).find(a => ['int', 'value'].includes(kindOf(a)));
  if (nv) { if (c.n !== 1) block('counter count twice'); c.n = P.amount(nv, tc); }
  return Object.assign({ op: 'counters', kind: c.kind, n: c.n }, aimObject(o, tc));
});
def('effect', 'AddCountersAllEffect', (o, tc) => {
  checkCalls(o);
  const c = P.counterOf(o.args[0], tc);
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  const nv = o.args.slice(1).find(a => ['int', 'value'].includes(kindOf(a)));
  if (nv) c.n = P.amount(nv, tc);
  return { op: 'counters', kind: c.kind, n: c.n, scope: F.toScope(d) };
});
def('effect', 'DestroyTargetEffect', (o, tc) => {
  checkCalls(o);
  const out = Object.assign({ op: 'destroy' }, aimObject(o, tc));
  if (A(o).bool(0, false)) out.noRegen = true;
  return out;
});
def('effect', 'ExileTargetEffect', (o, tc) => {
  checkCalls(o, ['setToSourceExileZone', 'setWithName']);
  if (o.args.some(a => kindOf(a) !== 'str' && kindOf(a) !== 'null')) block('ExileTargetEffect to a zone');
  return Object.assign({ op: 'exile' }, aimObject(o, tc));
});
def('effect', 'ReturnToHandTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'bounce' }, aimObject(o, tc)); });
def('effect', 'ReturnFromGraveyardToHandTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'regrowth' }, aimObject(o, tc)); });
def('effect', 'ReturnFromGraveyardToBattlefieldTargetEffect', (o, tc) => {
  checkCalls(o);
  const out = Object.assign({ op: 'reanimate' }, aimObject(o, tc));
  if (A(o).bool(0, false)) out.tapped = true;
  if (A(o).bool(1, false)) block('reanimate attacking');
  return out;
});
def('effect', 'TapTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'tap' }, aimObject(o, tc)); });
def('effect', 'UntapTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'untap' }, aimObject(o, tc)); });
def('effect', 'CounterTargetEffect', (o, tc) => {
  checkCalls(o);
  const a = aim(o, tc, 'object');
  if (a.pointer === 'spell') return { op: 'counterTriggerSpell' };
  if (!a.targets || a.targets[0].type !== 'spell') block('counter of a non-spell');
  return Object.assign({ op: 'counterSpell' }, a);
});
def('effect', 'DestroyAllEffect', (o, tc) => {
  checkCalls(o);
  const d = F.describe(o.args[0], tc);
  const out = { op: 'destroyAll', what: F.words(d), scope: F.toScope(d) };
  if (A(o).bool(0, false)) out.noRegen = true;
  return out;
});
def('effect', 'ExileAllEffect', (o, tc) => {
  checkCalls(o);
  const d = F.describe(o.args[0], tc);
  return { op: 'exileAll', what: F.words(d), scope: F.toScope(d) };
});
def('effect', 'ReturnToHandFromBattlefieldAllEffect', (o, tc) => {
  checkCalls(o);
  const d = F.describe(o.args[0], tc);
  return { op: 'bounceAll', what: F.words(d), scope: F.toScope(d) };
});
def('effect', 'ProliferateEffect', (o) => { checkCalls(o); if (o.args.length) block('ProliferateEffect args'); return { op: 'proliferate' }; });
def('effect', 'InvestigateEffect', (o, tc) => {
  checkCalls(o);
  const n = o.args.length ? amt(o, tc) : 1;
  return { op: 'createNamedToken', n, token: 'Clue' };
});
def('effect', 'SacrificeSourceEffect', (o) => { checkCalls(o); return { op: 'sacrificeSelf' }; });
def('effect', 'ExileSourceEffect', (o) => { checkCalls(o); if (A(o).bool(0, false)) block('exile source to its own zone'); return { op: 'exileSelf' }; });
def('effect', 'TransformSourceEffect', (o) => { checkCalls(o); return { op: 'transformSelf' }; });
def('effect', 'SacrificeOpponentsEffect', (o, tc) => {
  checkCalls(o);
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const nv = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  return { op: 'sacrificeChoice', n: nv ? P.amount(nv, tc) : 1, who: 'opponents', filter: F.toWords(Object.assign({}, d, { controller: undefined })) };
});
def('effect', 'SacrificeAllEffect', (o, tc) => {
  checkCalls(o);
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const nv = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  if (A(o).enumv('TargetController') && A(o).enumv('TargetController') !== 'ANY') block('SacrificeAllEffect controller');
  return { op: 'sacrificeChoice', n: nv ? P.amount(nv, tc) : 1, who: 'each', filter: F.toWords(Object.assign({}, d, { controller: undefined })) };
});
def('effect', 'SacrificeEffect', (o, tc) => {
  checkCalls(o);
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const nv = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  const out = Object.assign({ op: 'sacrificeChoice', n: nv ? P.amount(nv, tc) : 1, filter: F.toWords(Object.assign({}, d, { controller: undefined, another: undefined })) },
    aimPlayer(o, tc, 'sacrificeChoice'));
  if (d.another) out.other = true;
  return out;
});
def('effect', 'SacrificeControllerEffect', (o, tc) => {
  checkCalls(o);
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const nv = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  const out = { op: 'sacrificeChoice', n: nv ? P.amount(nv, tc) : 1, who: 'you', filter: F.toWords(Object.assign({}, d, { controller: undefined, another: undefined })) };
  if (d.another) out.other = true;
  return out;
});
def('effect', 'GainControlTargetEffect', (o, tc) => {
  checkCalls(o);
  if (o.args.some(a => kindOf(a) === 'bool' && a.v)) block('fixed control');
  if (o.args.some(a => kindOf(a) === 'condition')) block('control while');
  const d = durationOf(o, 'EndOfGame');
  const out = Object.assign({ op: 'gainControl' }, aimObject(o, tc));
  if (d === 'eot') out.until = 'eot';
  else if (d !== 'permanent') block('control for ' + d);
  return out;
});
def('effect', 'FightTargetsEffect', (o, tc) => {
  checkCalls(o);
  const ab = tc.ab;
  if (!ab || ab.targets.length !== 2 || ab.used.size) block('fight targets');
  ab.used.add(0); ab.used.add(1);
  return { op: 'fight', targets: ab.targets[0].specs.concat(ab.targets[1].specs) };
});
def('effect', 'FightTargetSourceEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'fightSelf' }, aimObject(o, tc)); });
def('effect', 'GoadTargetEffect', (o, tc) => { checkCalls(o); return Object.assign({ op: 'goad' }, aimObject(o, tc)); });
def('effect', 'CantBlockTargetEffect', (o, tc) => {
  checkCalls(o);
  if (durationOf(o, 'EndOfTurn') !== 'eot') block('cant block for longer');
  return Object.assign({ op: 'restrict', flag: 'cantBlock' }, aimObject(o, tc));
});
def('effect', 'SearchLibraryPutInHandEffect', (o, tc) => searchEffect(o, tc, 'hand'));
def('effect', 'SearchLibraryPutInPlayEffect', (o, tc) => searchEffect(o, tc, 'battlefield'));
def('effect', 'SearchLibraryPutOnLibraryEffect', (o, tc) => searchEffect(o, tc, 'top'));
function searchEffect(o, tc, to) {
  checkCalls(o);
  const t = o.args[0];
  if (!t || t.t !== 'obj' || t.cls !== 'TargetCardInLibrary') block('search with ' + keyOf(t));
  for (const c of t.calls) block('TargetCardInLibrary.' + c.name);
  const ints = A(t).all('int').map(x => x.v);
  let min = 1, max = 1;
  if (ints.length === 1) { min = 0; max = ints[0]; }
  if (ints.length >= 2) { min = ints[0]; max = ints[1]; }
  const f = t.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_CARD' }, tc);
  const out = { op: 'tutor', n: max, filter: F.toWords(d, { allow: ['mv'] }), to };
  if (d.mv) { if (d.mv.min === d.mv.max) out.mv = d.mv.min; else { if (d.mv.min != null) out.minMv = d.mv.min; if (d.mv.max != null) out.maxMv = d.mv.max; } }
  if (out.filter === 'card') out.filter = 'any';
  if (to === 'battlefield' && A(o).bool(1, false) === true && A(o).bool(0, false) === true) out.tapped = true;
  if (to === 'battlefield') {
    const bools = A(o).all('bool').map(x => x.v);
    if (bools[0]) out.tapped = true;
    if (bools[2]) out.optional = true;
  }
  if (max > 1 || min === 0) out.upTo = true;
  if (max > 1) block('search for several');
  return out;
}

/* ---------------- effects whose duration decides their shape ----------------
   "until end of turn" is an effect that happens once and lasts the turn;
   "while on the battlefield" is a standing rule of a static ability. */

function ptOf(o, tc) {
  const vals = o.args.filter(a => ['int', 'value'].includes(kindOf(a)));
  if (vals.length < 2) block(o.cls + ' p/t');
  return { p: P.amount(vals[0], tc), t: P.amount(vals[1], tc) };
}
function staticOnly(tc, what) { if (!tc.inStatic) block(what + ' outside a static ability'); }
function oneShotOnly(tc, what) { if (tc.inStatic) block(what + ' in a static ability'); }

def('effect', 'BoostTargetEffect', (o, tc) => {
  checkCalls(o);
  oneShotOnly(tc, 'BoostTargetEffect');
  if (durationOf(o, 'EndOfTurn') !== 'eot') block('boost for longer');
  const { p, t } = ptOf(o, tc);
  return Object.assign({ op: 'pump', p, t, duration: 'eot' }, aimObject(o, tc));
});
def('effect', 'BoostSourceEffect', (o, tc) => {
  checkCalls(o);
  const { p, t } = ptOf(o, tc);
  const d = durationOf(o, 'EndOfTurn');
  if (tc.inStatic) {
    if (d !== 'static') block('static boost for ' + d);
    return { op: 'continuous', layer: 7, scope: { self: true, what: 'creature' }, pt: { p, t } };
  }
  if (d !== 'eot') block('boost for ' + d);
  return { op: 'pump', p, t, duration: 'eot', scope: 'self' };
});
function boostGroup(o, tc, who) {
  checkCalls(o);
  const { p, t } = ptOf(o, tc);
  const d = durationOf(o, 'EndOfTurn');
  const f = o.args.find(a => kindOf(a) === 'filter');
  const desc = F.describe(f || { t: 'ref', path: who === 'you' ? 'StaticFilters.FILTER_PERMANENT_CREATURES' : 'StaticFilters.FILTER_PERMANENT_ALL_CREATURES' }, tc);
  if (who === 'you') desc.controller = 'you';
  if (A(o).bool(0, false)) desc.another = true;
  const scope = F.toScope(desc);
  if (tc.inStatic) {
    if (d !== 'static') block('static boost for ' + d);
    return { op: 'continuous', layer: 7, scope, pt: { p, t } };
  }
  if (d !== 'eot') block('boost for ' + d);
  return { op: 'pump', p, t, duration: 'eot', scope };
}
def('effect', 'BoostControlledEffect', (o, tc) => boostGroup(o, tc, 'you'));
def('effect', 'BoostAllEffect', (o, tc) => boostGroup(o, tc, 'all'));
def('effect', ['BoostEquippedEffect', 'BoostEnchantedEffect'], (o, tc) => {
  checkCalls(o);
  staticOnly(tc, o.cls);
  if (durationOf(o, 'WhileOnBattlefield') !== 'static') block(o.cls + ' duration');
  const { p, t } = ptOf(o, tc);
  return { op: 'continuous', layer: 7, scope: { attached: true, what: 'creature' }, pt: { p, t } };
});

/**
 * What a "gains ..." effect hands over: keywords by name, or an ability
 * written out (a quoted "Whenever this creature ..." or "{T}: ..."),
 * translated like any other and carried whole.
 */
function granted(v, tc) {
  try { return { keywords: keywordsOf(v, tc) }; }
  catch (e) {
    if (!(e instanceof Error) || !e.what || !(v && v.t === 'obj' && !v.custom && v.cls !== 'CompoundAbility')) throw e;
  }
  const save = { ab: tc.ab, kind: tc.kind, trigger: tc.trigger, inStatic: tc.inStatic, inCda: tc.inCda };
  let ab;
  try {
    Object.assign(tc, { ab: null, inStatic: false, inCda: false, trigger: null });
    ab = tr('ability', v, tc);
  } finally { Object.assign(tc, save); }
  if (Array.isArray(ab) || (ab.kind !== 'triggered' && ab.kind !== 'activated')) block('granting a ' + (ab.kind || 'kind of') + ' ability');
  const quoted = String(tc.lineText || '').match(/"([^"]+)"/);
  if (!quoted) block('granted ability with no words');
  ab.text = quoted[1];
  return { abilities: [ab] };
}
/** The static shape of a grant: grant keywords, or grantAbilities. */
const staticGrant = (g) => (g.keywords ? { grant: g.keywords } : { grantAbilities: g.abilities });
/** The one-shot shape: grantKeyword, or grantAbility with the abilities written out. */
const oneShotGrant = (g, duration) => (g.keywords ? { op: 'grantKeyword', keywords: g.keywords, duration } : { op: 'grantAbility', abilities: g.abilities, duration });

def('effect', 'GainAbilityTargetEffect', (o, tc) => {
  checkCalls(o);
  oneShotOnly(tc, 'GainAbilityTargetEffect');
  const d = durationOf(o, 'EndOfTurn');
  if (d !== 'eot' && d !== 'permanent') block('gain for ' + d);
  const g = granted(o.args[0], tc);
  if (g.abilities && d !== 'eot') block('ability granted for good');
  return Object.assign(oneShotGrant(g, d), aimObject(o, tc));
});
def('effect', 'GainAbilitySourceEffect', (o, tc) => {
  checkCalls(o);
  const g = granted(o.args[0], tc);
  const d = durationOf(o, 'WhileOnBattlefield');
  if (A(o).bool(0, false)) block('ability on the card');
  if (tc.inStatic) {
    if (d !== 'static') block('static gain for ' + d);
    return Object.assign({ op: 'continuous', layer: 6, scope: { self: true, what: 'permanent' } }, staticGrant(g));
  }
  if (d !== 'eot') block('gain for ' + d);
  return Object.assign(oneShotGrant(g, 'eot'), { scope: 'self' });
});
function gainGroup(o, tc, who) {
  checkCalls(o);
  const g = granted(o.args[0], tc);
  const d = durationOf(o, 'WhileOnBattlefield');
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (!f) block(o.cls + ' without a filter');
  const desc = F.describe(f, tc);
  if (who === 'you') desc.controller = 'you';
  if (A(o).bool(0, false)) desc.another = true;
  const scope = F.toScope(desc);
  if (tc.inStatic) {
    if (d !== 'static') block('static gain for ' + d);
    return Object.assign({ op: 'continuous', layer: 6, scope }, staticGrant(g));
  }
  if (d !== 'eot') block('gain for ' + d);
  return Object.assign(oneShotGrant(g, 'eot'), { scope });
}
def('effect', 'GainAbilityControlledEffect', (o, tc) => gainGroup(o, tc, 'you'));
def('effect', 'GainAbilityAllEffect', (o, tc) => gainGroup(o, tc, 'all'));
def('effect', 'GainAbilityAttachedEffect', (o, tc) => {
  checkCalls(o);
  staticOnly(tc, 'GainAbilityAttachedEffect');
  if (durationOf(o, 'WhileOnBattlefield') !== 'static') block('attached gain duration');
  const g = granted(o.args[0], tc);
  if (g.keywords && o.args.some(a => kindOf(a) === 'str')) block('attached gain with own text');
  return Object.assign({ op: 'continuous', layer: 6, scope: { attached: true, what: 'creature' } }, staticGrant(g));
});

/* ---------------- effects made of other effects ---------------- */

def('effect', 'ConditionalOneShotEffect', (o, tc) => {
  checkCalls(o);
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const cond = o.args.find(a => kindOf(a) === 'condition' || (a && a.t === 'ref' && kindOf(a).startsWith('enum:')) || (a && a.t === 'obj' && a.custom && !effs.includes(a)));
  if (!cond) block('ConditionalOneShotEffect without a condition');
  const then = effect(effs[0], tc);
  const otherwise = effs[1] ? effect(effs[1], tc) : null;
  return Object.assign({ op: 'ifCond', cond: tr('condition', cond, tc), then }, otherwise ? { otherwise } : null);
});
def('effect', 'ConditionalContinuousEffect', (o, tc) => {
  checkCalls(o);
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const cond = o.args.find(a => kindOf(a) === 'condition' || (a && a.t === 'ref' && kindOf(a).startsWith('enum:')));
  if (!cond) block('ConditionalContinuousEffect without a condition');
  /* Resolving ("if you control a Dragon, it gets +2/+2 instead"): an
     effect that happens, or another one, depending on the condition now. */
  if (!tc.inStatic) {
    const c = tr('condition', cond, tc);
    if (effs.length === 2) {
      // the otherwise part points at the same target as the first: "it" the second time
      const then = effect(effs[0], tc);
      const otherwise = effect(effs[1], tc);
      // "it" in the second half would point at a target only the first half chose
      if (JSON.stringify(otherwise).includes('"lastTarget"')) block('conditional whose otherwise reuses the target');
      return { op: 'ifCond', cond: c, then, otherwise };
    }
    if (effs.length !== 1) block('conditional with ' + effs.length + ' effects');
    return { op: 'ifCond', cond: c, then: effect(effs[0], tc) };
  }
  if (effs.length !== 1) block('conditional with an otherwise');
  const inner = effect(effs[0], tc);
  const c = tr('condition', cond, tc);
  return inner.map(e => {
    if (e.op !== 'continuous') block('conditional ' + e.op);
    return Object.assign({}, e, { cond: e.cond ? [].concat(e.cond, c) : c });
  });
});
def('effect', 'DoIfCostPaid', (o, tc) => {
  checkCalls(o, ['addEffect', 'withTargetDescription']);
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const cost = o.args.find(a => ['cost', 'manaCost'].includes(kindOf(a)));
  if (!cost) block('DoIfCostPaid cost');
  const bools = A(o).all('bool').map(x => x.v);
  if (bools.length && bools[bools.length - 1] === false) block('DoIfCostPaid not optional');
  const then = effect(effs[0], tc);
  for (const c of calls(o, 'addEffect')) then.push(...effect(c.args[0], tc));
  const otherwise = effs[1] ? effect(effs[1], tc) : null;
  const c = P.costOf([cost], tc);
  const pay = {};
  if (c.mana) pay.mana = c.mana;
  if (c.life) pay.life = c.life;
  if (c.discard) { if (c.discard.n !== 1) block('discard several'); pay.discard = { filter: c.discard.filter === 'card' ? null : c.discard.filter }; }
  if (c.removeCounters) { if (c.mana || c.life) block('two prices with counters'); pay.removeCounter = { kind: c.removeCounters.kind, n: c.removeCounters.n }; }
  if (c.sacrifice) {
    if (c.mana || c.life || c.discard || c.sacrifice.n !== 1) block('sacrifice and more');
    if (otherwise) block('sacrifice or else');
    return { op: 'may', then: [{ op: 'sacThen', filter: c.sacrifice.filter, other: !!c.sacrifice.another, then }] };
  }
  if (c.tap || c.sacSelf || c.exile || c.untap || c.tapCreatures || c.putCounters) block('DoIfCostPaid with ' + JSON.stringify(Object.keys(c).filter(k => c[k] && k !== 'raw' && k !== 'other' && k !== 'mana')));
  if (!Object.keys(pay).length) block('DoIfCostPaid with nothing to pay');
  return Object.assign({ op: 'mayPay', pay, then }, otherwise ? { otherwise } : null);
});

module.exports = { aim, aimObject, aimPlayer, effect, effectList, durationOf, keywordsOf, checkCalls, pointerOf };
