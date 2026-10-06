/* XMage abilities -> the engine's abilities: spells, triggers, activated,
   static and loyalty abilities, and the keywords an effect can hand out. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf, REG } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');

/* ---------------- keywords ----------------
   The keyword abilities an effect can grant ("gains flying"), named the
   way the parser names them. */
const KEYWORDS = {
  FlyingAbility: 'Flying', FirstStrikeAbility: 'First Strike', DoubleStrikeAbility: 'Double Strike',
  DeathtouchAbility: 'Deathtouch', LifelinkAbility: 'Lifelink', MenaceAbility: 'Menace', ReachAbility: 'Reach',
  TrampleAbility: 'Trample', VigilanceAbility: 'Vigilance', HasteAbility: 'Haste', DefenderAbility: 'Defender',
  IndestructibleAbility: 'Indestructible', HexproofAbility: 'Hexproof', ShroudAbility: 'Shroud', FlashAbility: 'Flash',
  InfectAbility: 'Infect', WitherAbility: 'Wither', FearAbility: 'Fear', IntimidateAbility: 'Intimidate',
  ShadowAbility: 'Shadow', HorsemanshipAbility: 'Horsemanship', SkulkAbility: 'Skulk', ChangelingAbility: 'Changeling',
  CantBlockAbility: null,
};
for (const [cls, name] of Object.entries(KEYWORDS)) {
  if (!name) continue;
  def('keyword', cls, (o) => { if (o.args.length || o.calls.length) block(cls + ' with arguments'); return name; });
}

/* ---------------- the pieces every ability shares ---------------- */

const TRIGGER_COSMETIC = new Set(['setTriggerPhrase', 'withFlavorWord', 'setAbilityWord', 'addHint', 'withRuleTextReplacement',
  'setAbilityWordValue', 'withHint', 'addWatcher']);

/** Read the calls on an ability object into its parts. */
function partsOf(o, tc, allowed) {
  const out = { effects: [], targets: [], costs: [], modes: [], conds: [], interveningIf: null, once: false, timing: null, maxModes: null, minModes: null };
  for (const c of o.calls) {
    if (c.name === 'addEffect') out.effects.push(c.args[0]);
    else if (c.name === 'addTarget') out.targets.push(c.args[0]);
    else if (c.name === 'addCost') out.costs.push(c.args[0]);
    else if (c.name === 'addMode') out.modes.push(c.args[0]);
    else if (c.name === 'modes.setMinModes') out.minModes = litOf(c.args[0]);
    else if (c.name === 'modes.setMaxModes') out.maxModes = litOf(c.args[0]);
    else if (c.name === 'withInterveningIf') out.interveningIf = c.args[0];
    else if (c.name === 'withTriggerCondition') out.conds.push(c.args[0]);
    else if (c.name === 'setTriggersLimitEachTurn') { if (litOf(c.args[0]) !== 1) block('trigger limit'); out.once = true; }
    else if (c.name === 'setTiming') { const t = keyOf(c.args[0]); if (t !== 'TimingRule.SORCERY') block(t); out.timing = 'sorcery'; }
    else if (TRIGGER_COSMETIC.has(c.name)) continue;
    else if (allowed && allowed.includes(c.name)) continue;
    else block('Ability.' + c.name);
  }
  return out;
}

/** Translate targets, then effects that point at them; every target must be used. */
function body(firstEffect, parts, tc) {
  const save = tc.ab;
  const targets = parts.targets.map(t => tr('target', t, tc));
  tc.ab = { targets, used: new Set() };
  try {
    const list = [];
    if (firstEffect) list.push(...E.effect(firstEffect, tc));
    for (const e of parts.effects) list.push(...E.effect(e, tc));
    targets.forEach((t, i) => { if (!tc.ab.used.has(i)) block('a target no effect uses'); });
    return list;
  } finally {
    tc.ab = save;
  }
}

/** Modes: the ability's own effects are the first mode, then each added Mode. */
function modal(firstEffect, parts, tc) {
  const modes = [];
  modes.push({ effects: body(firstEffect, Object.assign({}, parts, { modes: [] }), tc) });
  for (const m of parts.modes) {
    if (!m || m.t !== 'obj' || m.cls !== 'Mode') block('mode ' + keyOf(m));
    const mp = partsOf(m, tc, ['withDescription', 'withCost', 'setFlavorWord', 'withFlavorWord']);
    if (calls(m, 'withCost').length) block('mode with a cost');
    modes.push({ effects: body(m.args[0], mp, tc) });
  }
  const min = parts.minModes != null ? parts.minModes : 1;
  const max = parts.maxModes != null ? parts.maxModes : 1;
  if (min < 0 || max < min) block('mode count');
  const out = { op: 'modal', count: Math.max(min, 1), repeatable: false, modes: modes.map((m, i) => ({ label: 'Mode ' + (i + 1), effects: m.effects, auto: true })) };
  if (max > Math.max(min, 1)) out.max = max;
  if (min === 0) block('up to modes');
  return out;
}

/* ---------------- spells ---------------- */

function spellAbility(spell, tc) {
  const parts = partsOf(spell, tc, ['setCostAdjuster']);
  if (calls(spell, 'setCostAdjuster').length) block('cost adjuster');
  if (parts.costs.length) block('additional cost on the spell');
  tc.kind = 'spell';
  const effects = parts.modes.length ? [modal(null, parts, tc)] : body(null, parts, tc);
  if (!effects.length) block('spell with no effect');
  return { kind: 'spell', auto: true, effects };
}

/* ---------------- static abilities ---------------- */

def('ability', 'SimpleStaticAbility', (o, tc) => {
  const parts = partsOf(o, tc);
  const zone = A(o).enumv('Zone') || 'BATTLEFIELD';
  if (zone !== 'BATTLEFIELD') block('static ability in ' + zone);
  if (parts.targets.length || parts.costs.length || parts.modes.length) block('static with targets or costs');
  const first = o.args.find(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  tc.inStatic = true;
  try {
    const effects = [];
    for (const e of [first].concat(parts.effects)) effects.push(...E.effect(e, tc));
    for (const e of effects) if (e.op !== 'continuous') block('static ' + e.op);
    return { kind: 'static', auto: true, effects };
  } finally { tc.inStatic = false; }
});
def('ability', 'EntersBattlefieldTappedAbility', (o) => {
  if (o.args.length || o.calls.length) block('EntersBattlefieldTappedAbility with arguments');
  return { kind: 'static', auto: true, effects: [{ op: 'etbTapped' }] };
});

/* ---------------- activated abilities ---------------- */

const MANA_OPS = new Set(['addMana', 'addManaAny', 'addManaChoice', 'addManaPer', 'addManaChosen', 'addManaX', 'addManaDevotion',
  'addManaAmong', 'addManaEachColor']);

function activated(o, tc, opts) {
  const parts = partsOf(o, tc);
  const zone = A(o).enumv('Zone') || 'BATTLEFIELD';
  if (zone !== 'BATTLEFIELD' && zone !== 'GRAVEYARD') block('activated in ' + zone);
  if (parts.modes.length) block('modal activated ability');
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a))).concat(parts.costs);
  if (effs.length !== 1) block('activated with ' + effs.length + ' effects in its constructor');
  tc.kind = 'activated';
  tc.hasX = false;
  const cost = P.costOf(costs, tc);
  const effects = body(effs[0], parts, tc);
  const isMana = effects.length && effects.every(e => MANA_OPS.has(e.op));
  const ab = { kind: isMana ? 'mana' : 'activated', cost, effects, auto: true, sorcerySpeed: !!(opts && opts.sorcery) || parts.timing === 'sorcery' };
  if (zone === 'GRAVEYARD') ab.fromGraveyard = true;
  if (opts && opts.once) ab.only = Object.assign({}, ab.only, { once: true });
  if (opts && opts.cond) ab.only = Object.assign({}, ab.only, { cond: opts.cond });
  return ab;
}
def('ability', 'SimpleActivatedAbility', (o, tc) => activated(o, tc));
def('ability', 'ActivateAsSorceryActivatedAbility', (o, tc) => activated(o, tc, { sorcery: true }));
def('ability', 'ActivateOncePerTurnActivatedAbility', (o, tc) => activated(o, tc, { once: true }));
def('ability', 'ActivateIfConditionActivatedAbility', (o, tc) => {
  const cond = o.args.find(a => kindOf(a) === 'condition' || (a && a.t === 'ref' && kindOf(a).startsWith('enum:')));
  if (!cond) block('ActivateIfConditionActivatedAbility without a condition');
  const c = tr('condition', cond, tc);
  const o2 = Object.assign({}, o, { args: o.args.filter(a => a !== cond) });
  return activated(o2, tc, { cond: c });
});
def('ability', 'LoyaltyAbility', (o, tc) => {
  const parts = partsOf(o, tc);
  if (parts.costs.length || parts.modes.length) block('loyalty with costs or modes');
  const n = A(o).int(0);
  if (n == null) block('variable loyalty');
  tc.kind = 'loyalty';
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const effects = body(effs[0], parts, tc);
  return { kind: 'loyalty', cost: { loyalty: n }, effects, auto: true, sorcerySpeed: true };
});

/* ---------------- triggered abilities ---------------- */

/** A triggered ability: the event comes from the class, the rest from its calls. */
function triggered(o, tc, ev) {
  const parts = partsOf(o, tc);
  if (parts.costs.length) block('trigger with a cost');
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  if (effs.length > 1) block('trigger with two effects in its constructor');
  const optional = ev.optional != null ? ev.optional : A(o).bool(0, false);
  tc.kind = 'triggered';
  tc.trigger = ev;
  const effects = parts.modes.length ? [modal(effs[0], parts, tc)] : body(effs[0], parts, tc);
  tc.trigger = null;
  const ab = { kind: 'triggered', event: ev.event, also: ev.also || null, self: !!ev.self, optional: !!optional,
    effects, auto: true, condition: null, intervening: false };
  if (ev.objFilter) ab.objFilter = ev.objFilter;
  if (ev.extra) Object.assign(ab, ev.extra);
  const conds = [];
  if (ev.condition) conds.push(ev.condition);
  if (parts.interveningIf) conds.push(tr('condition', parts.interveningIf, tc));
  for (const c of parts.conds) conds.push(tr('condition', c, tc));
  if (conds.length) ab.condition = conds.length === 1 ? conds[0] : conds;
  if (parts.once) ab.oncePerTurn = true;
  return ab;
}

/** The SetTargetPointer argument of a trigger, which must be NONE (nothing to point at) for now. */
function noPointer(o) {
  const p = A(o).enumv('SetTargetPointer');
  if (p && p !== 'NONE') block('trigger pointing at ' + p);
}

function boolsAfterEffect(o) { return A(o).all('bool').map(x => x.v); }

def('ability', 'EntersBattlefieldTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'etb', self: true }));
def('ability', 'EntersBattlefieldOrAttacksSourceTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'etb', self: true, also: 'attacks' }));
def('ability', 'DiesSourceTriggeredAbility', (o, tc) => { noPointer(o); return triggered(o, tc, { event: 'dies', self: true }); });
def('ability', 'PutIntoGraveFromBattlefieldSourceTriggeredAbility', (o, tc) => { noPointer(o); return triggered(o, tc, { event: 'dies', self: true }); });
def('ability', 'LeavesBattlefieldTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'ltb', self: true }));
def('ability', 'AttacksTriggeredAbility', (o, tc) => {
  noPointer(o);
  if (A(o).str(0)) block('attack trigger with its own text');
  return triggered(o, tc, { event: 'attacks', self: true });
});
def('ability', 'BlocksSourceTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'blocks', self: true }));
def('ability', 'AttacksOrBlocksTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'attacks', self: true, also: 'blocks' }));
def('ability', 'BecomesTappedSourceTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'becomesTapped', self: true }));
def('ability', 'DealsCombatDamageToAPlayerTriggeredAbility', (o, tc) => {
  const b = boolsAfterEffect(o);
  if (b[1]) block('combat damage trigger pointing at the player');
  return triggered(o, tc, { event: 'combatDamageToPlayer', self: true, optional: !!b[0] });
});
function stepTrigger(name, events) {
  def('ability', name, (o, tc) => {
    const who = A(o).enumv('TargetController') || 'YOU';
    const event = events[who];
    if (!event) block(name + ' for ' + who);
    const zone = A(o).enumv('Zone');
    if (zone && zone !== 'BATTLEFIELD') block(name + ' from ' + zone);
    const cond = o.args.find(a => kindOf(a) === 'condition' || (a && a.t === 'ref' && kindOf(a).startsWith('enum:') && !/^(?:TargetController|Zone)$/.test(a.path.split('.')[0])));
    const ev = { event, optional: A(o).bool(0, false) };
    if (cond) ev.condition = tr('condition', cond, tc);
    return triggered(o, tc, ev);
  });
}
stepTrigger('BeginningOfUpkeepTriggeredAbility', { YOU: 'yourUpkeep', ANY: 'eachUpkeep', EACH_PLAYER: 'eachUpkeep', OPPONENT: 'opponentUpkeep' });
stepTrigger('BeginningOfEndStepTriggeredAbility', { YOU: 'yourEndStep', ANY: 'eachEndStep', EACH_PLAYER: 'eachEndStep' });
stepTrigger('BeginningOfCombatTriggeredAbility', { YOU: 'yourCombatBegin', ANY: 'eachCombatBegin', EACH_PLAYER: 'eachCombatBegin' });
stepTrigger('BeginningOfDrawTriggeredAbility', { YOU: 'yourDrawStep', ANY: 'eachDrawStep', EACH_PLAYER: 'eachDrawStep' });
stepTrigger('BeginningOfFirstMainTriggeredAbility', { YOU: 'yourMain1' });

function spellTrigger(name, event) {
  def('ability', name, (o, tc) => {
    noPointer(o);
    const zone = A(o).enumv('Zone');
    if (zone && zone !== 'BATTLEFIELD') block(name + ' from ' + zone);
    if (o.args.filter(a => a && a.t === 'ref' && /^Zone\./.test(a.path)).length > 1) block('spell from a zone');
    const f = o.args.find(a => kindOf(a) === 'filter');
    const ev = { event };
    if (f && !(f.t === 'ref' && /^StaticFilters\.FILTER_SPELLS?_A$|^StaticFilters\.FILTER_SPELL$/.test(f.path))) {
      const d = F.describe(f, tc);
      if (d.base !== 'spell') block('cast trigger filter of ' + d.base);
      ev.objFilter = { words: F.toWords(d) };
    }
    return triggered(o, tc, ev);
  });
}
spellTrigger('SpellCastControllerTriggeredAbility', 'youCastSpell');
spellTrigger('SpellCastOpponentTriggeredAbility', 'opponentCastSpell');
spellTrigger('SpellCastAllTriggeredAbility', 'anyCastSpell');

function subjectTrigger(name, event, dflt, opts) {
  def('ability', name, (o, tc) => {
    noPointer(o);
    const zone = A(o).enumv('Zone');
    if (zone && zone !== 'BATTLEFIELD') block(name + ' from ' + zone);
    const f = o.args.find(a => kindOf(a) === 'filter');
    const d = F.describe(f || { t: 'ref', path: dflt }, tc);
    if (opts && opts.you) d.controller = 'you';
    const bools = A(o).all('bool').map(x => x.v);
    if (opts && opts.setPointerArg && bools[opts.setPointerArg]) block('trigger pointing at the permanent');
    const ev = { event, objFilter: F.toSubject(d), optional: !!bools[0] };
    if (opts && opts.selfOk) ev.objFilter.selfOk = true;
    return triggered(o, tc, ev);
  });
}
subjectTrigger('EntersBattlefieldControlledTriggeredAbility', 'permEnters', 'StaticFilters.FILTER_PERMANENT_CREATURE', { you: true });
subjectTrigger('EntersBattlefieldAllTriggeredAbility', 'permEnters', 'StaticFilters.FILTER_PERMANENT_CREATURE');
def('ability', 'DiesCreatureTriggeredAbility', (o, tc) => {
  /* (effect, optional, another[, setTargetPointer]) or (effect, optional, filter[, setTargetPointer]) */
  noPointer(o);
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('dies trigger from ' + zone);
  const f = o.args.find(a => kindOf(a) === 'filter');
  const bools = A(o).all('bool').map(x => x.v);
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_PERMANENT_CREATURE' }, tc);
  if (f) { if (bools[1]) block('trigger pointing at the creature'); }
  else { if (bools[1]) d.another = true; if (bools[2]) block('trigger pointing at the creature'); }
  return triggered(o, tc, { event: 'permDies', objFilter: F.toSubject(d), optional: !!bools[0] });
});
def('ability', 'LandfallAbility', (o, tc) => {
  noPointer(o);
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('landfall from ' + zone);
  return triggered(o, tc, { event: 'landfall' });
});
def('ability', 'GainLifeControllerTriggeredAbility', (o, tc) => {
  if (o.args.some(a => a && a.t === 'ref' && /^SetTargetPointer\./.test(a.path) && !/NONE$/.test(a.path))) block('life trigger pointer');
  return triggered(o, tc, { event: 'youGainLife' });
});
def('ability', 'DrawCardControllerTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'youDraw' }));
def('ability', 'CastSourceTriggeredAbility', (o, tc) => triggered(o, tc, { event: 'castSelf' }));

module.exports = { spellAbility, partsOf, body, modal, KEYWORDS, triggered, activated };
