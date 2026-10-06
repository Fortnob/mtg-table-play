/* Lands that become creatures, triggers with two ways in, mana counted
   from the board, divided damage, and a handful of one-shot effects. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');
const AB = require('./abilities');

const COLOR_LETTERS = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };

/* ---------------- "becomes an N/N creature" ---------------- */

/** A CreatureToken (the shape an animated permanent takes) -> layer fields. */
function animation(tok, tc) {
  if (!tok || tok.t !== 'obj' || tok.cls !== 'CreatureToken') block('becomes ' + keyOf(tok));
  const ints = A(tok).all('int').map(x => x.v);
  if (ints.length !== 2) block('CreatureToken size');
  const eff = { setPt: { p: ints[0], t: ints[1] }, addTypes: ['Creature'], addSubtypes: [], keywords: [] };
  for (const a of tok.args) if (a && a.t === 'ref' && /^SubType\./.test(a.path)) eff.addSubtypes.push(F.subtypeName(a.path.split('.')[1]).replace(/\b\w/g, c => c.toUpperCase()));
  for (const c of tok.calls) {
    if (c.name === 'withColor') {
      const s = litOf(c.args[0]);
      const cols = String(s).split('').map(x => COLOR_LETTERS[x]);
      if (cols.some(x => !x)) block('colour ' + s);
      eff.setColors = cols;
    } else if (c.name === 'withAbility') eff.keywords.push(tr('keyword', c.args[0], tc));
    else if (c.name === 'withSubType') eff.addSubtypes.push(F.subtypeName(c.args[0].path.split('.')[1]).replace(/\b\w/g, ch => ch.toUpperCase()));
    else if (c.name === 'withType') {
      const t = c.args[0].path.split('.')[1];
      eff.addTypes.push(t[0] + t.slice(1).toLowerCase());
    } else if (c.name === 'withAllCreatureTypes') { if (litOf(c.args[0])) eff.keywords.push('Changeling'); }
    else block('CreatureToken.' + c.name);
  }
  if (!eff.addSubtypes.length) delete eff.addSubtypes;
  if (!eff.keywords.length) delete eff.keywords;
  return eff;
}
def('effect', 'BecomesCreatureSourceEffect', (o, tc) => {
  E.checkCalls(o, ['withDurationRuleAtStart']);
  if (tc.inStatic) block('becomes a creature in a static ability');
  const keep = o.args.find(a => a && a.t === 'ref' && /^CardType\./.test(a.path));
  if (!keep) block('becomes a creature and nothing else');
  const d = E.durationOf(o, 'EndOfTurn');
  if (d !== 'eot' && d !== 'permanent') block('becomes a creature for ' + d);
  return { op: 'becomes', scope: 'self', duration: d, eff: animation(o.args[0], tc) };
});

/* ---------------- triggers ---------------- */

def('ability', 'OrTriggeredAbility', (o, tc) => {
  const subs = o.args.filter(a => kindOf(a) === 'ability');
  const effs = o.args.filter(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  if (subs.length !== 2 || effs.length !== 1) block('OrTriggeredAbility of ' + subs.length);
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('OrTriggeredAbility from ' + zone);
  // each half is translated with no effect of its own, for its event
  const evs = subs.map(s => {
    const shell = Object.assign({}, s, { args: s.args.map(a => (kindOf(a) === 'effect' || kindOf(a) === 'custom' || (a && a.t === 'lit' && a.v === null)) ? { t: 'obj', cls: 'GainLifeEffect', args: [{ t: 'lit', v: 0 }], calls: [] } : a) });
    const ab = tr('ability', shell, tc);
    if (ab.kind !== 'triggered' || ab.condition || ab.oncePerTurn) block('OrTriggeredAbility half');
    return ab;
  });
  if (evs[0].self !== evs[1].self || JSON.stringify(evs[0].objFilter || null) !== JSON.stringify(evs[1].objFilter || null)) block('OrTriggeredAbility halves differ');
  const parts = AB.partsOf(o, tc);
  tc.kind = 'triggered';
  const effects = AB.body(effs[0], parts, tc);
  const out = { kind: 'triggered', event: evs[0].event, also: evs[1].event, self: evs[0].self, optional: A(o).bool(0, false),
    effects, auto: true, condition: null, intervening: false };
  if (evs[0].objFilter) out.objFilter = evs[0].objFilter;
  return out;
});
def('ability', 'AttacksCreatureYouControlTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_CONTROLLED_CREATURE' }, tc);
  d.controller = 'you';
  const bools = A(o).all('bool').map(x => x.v);
  const pointer = bools[1] ? 'permanent' : null;
  return AB.triggered(o, tc, { event: 'permAttacks', objFilter: F.toSubject(d), optional: !!bools[0], pointer });
});
def('ability', 'AttacksAllTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_PERMANENT_CREATURE' }, tc);
  const bools = A(o).all('bool').map(x => x.v);
  if (bools[1] || bools[2]) block('attacks you, or its controller');
  return AB.triggered(o, tc, { event: 'permAttacks', objFilter: F.toSubject(d), optional: !!bools[0], pointer: AB.pointerArg(o) });
});
def('ability', 'DealsDamageToAPlayerAllTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const bools = A(o).all('bool').map(x => x.v);
  // (optional, onlyCombat, affectsDefendingPlayer)
  if (!bools[1]) block('damage to a player, not only combat');
  if (bools[2]) block('damage affecting the defending player');
  if (A(o).enumv('TargetController') && A(o).enumv('TargetController') !== 'ANY') block('damage to a kind of player');
  if (d.controller !== 'you' || d.types.join() !== 'creature' || d.another || d.token != null || d.subtypes.length || d.colors.length) block('combat damage by ' + F.words(d));
  return AB.triggered(o, tc, { event: 'yourCreatureCombatDamage', optional: !!bools[0], pointer: AB.pointerArg(o) });
});

/* ---------------- mana counted from the board ---------------- */

def('ability', 'DynamicManaAbility', (o, tc) => {
  const m = o.args.find(a => a && a.t === 'obj' && (a.cls === 'Mana' || /^Mana\./.test(a.cls)));
  const vals = o.args.filter(a => kindOf(a) === 'value');
  if (!m || vals.length !== 1) block('DynamicManaAbility shape');
  const oneChoice = o.args.some(a => kindOf(a) === 'bool' && a.v);
  /* "Add X mana of any one color": counted, in one colour chosen once */
  if (m.cls === 'Mana.AnyMana' && litOf(m.args[0]) === 1 && oneChoice) {
    const per = P.amount(vals[0], tc);
    const costs0 = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
    const parts0 = AB.partsOf(o, tc);
    const cost0 = P.costOf((costs0.length ? costs0 : [{ t: 'obj', cls: 'TapSourceCost', args: [], calls: [] }]).concat(parts0.costs), tc);
    return { kind: 'mana', cost: cost0, effects: [{ op: 'addManaAny', amount: per, sameColor: true }], auto: true };
  }
  if (oneChoice) block('one choice of colour');
  const one = { 'Mana.WhiteMana': 'W', 'Mana.BlueMana': 'U', 'Mana.BlackMana': 'B', 'Mana.RedMana': 'R', 'Mana.GreenMana': 'G', 'Mana.ColorlessMana': 'C' }[m.cls];
  if (!one || litOf(m.args[0]) !== 1) block('DynamicManaAbility of ' + m.cls);
  const per = P.amount(vals[0], tc);
  if (typeof per !== 'object') block('mana per a number');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
  const parts = AB.partsOf(o, tc);
  const cost = P.costOf((costs.length ? costs : [{ t: 'obj', cls: 'TapSourceCost', args: [], calls: [] }]).concat(parts.costs), tc);
  return { kind: 'mana', cost, effects: [{ op: 'addManaPer', symbol: one, per }], auto: true };
});

/* ---------------- one-shot effects ---------------- */

def('effect', 'DamageMultiEffect', (o, tc) => {
  E.checkCalls(o);
  const ab = tc.ab;
  const t = ab && ab.targets[0];
  if (!t || !t.amount || ab.targets.length !== 1 || ab.used.has(0)) block('divided damage without its target');
  ab.used.add(0);
  return { op: 'damageDivided', n: t.amount, targets: t.specs };
});
def('target', 'TargetAnyTargetAmount', (o, tc) => {
  const ints = A(o).all('int').map(x => x.v);
  if (!ints.length || o.args.some(a => kindOf(a) === 'value')) block('divided among a count');
  const amount = ints[0];
  const min = ints.length > 1 ? ints[1] : (amount > 3 ? 0 : 1);
  const max = ints.length > 2 ? ints[2] : amount;
  if (max > 6) block('divided among many');
  const specs = [];
  for (let i = 0; i < max; i++) specs.push(Object.assign({ type: 'any', zone: 'battlefield' }, i >= Math.max(1, min) ? { upTo: true } : null));
  return { specs, kind: 'any', notTarget: false, min, max, amount };
});
def('effect', 'ExileTopXMayPlayUntilEffect', (o, tc) => {
  E.checkCalls(o);
  if (A(o).bool(0, false)) block('choose one of them');
  const d = E.durationOf(o, 'EndOfTurn');
  const vals = o.args.filter(a => ['int', 'value'].includes(kindOf(a)));
  const out = { op: 'impulse', n: P.amount(vals[0], tc), play: true };
  if (d === 'eot') out.duration = 'eot';
  else if (d !== 'endOfYourNextTurn') block('play until ' + d);
  return out;
});
def('effect', 'DiscardCardYouChooseTargetEffect', (o, tc) => {
  E.checkCalls(o);
  const vals = o.args.filter(a => ['int', 'value'].includes(kindOf(a)));
  if (vals.length && !(vals.length === 1 && vals[0].t === 'lit' && vals[0].v === 1 && o.args.some(a => kindOf(a) === 'filter'))) block('discard several, or reveal some');
  const f = o.args.find(a => kindOf(a) === 'filter');
  let filter = 'card', maxMv = null;
  if (f) {
    const d = F.describe(f, tc);
    if (d.mv && (d.mv.min != null || d.mv.max == null)) block('discard filter ' + F.words(d));
    if (d.mv) { maxMv = d.mv.max; d.mv = undefined; }
    if (d.colors.length || d.subtypes.length) block('discard filter ' + F.words(d));
    filter = F.toWords(d).replace(/ or /g, ' ');
    if (/ or /.test(F.toWords(d))) block('discard one of two kinds');
  }
  const who = E.aimPlayer(o, tc, 'discard');
  if (who.who !== 'target') block('hand of ' + who.who);
  return Object.assign({ op: 'handAttack', filter, to: 'graveyard' }, maxMv != null ? { maxMv } : null, who.targets ? { targets: who.targets } : {});
});
def('effect', 'PutCardFromHandOntoBattlefieldEffect', (o, tc) => {
  E.checkCalls(o);
  if (o.args.some(a => kindOf(a) === 'bool' && a.v)) block('put from hand tapped, or for another player');
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_CARD_A_PERMANENT' }, tc);
  const w = F.toWords(d);
  if (/\s/.test(w) && w !== 'creature or land') block('put from hand a ' + w);
  return { op: 'permanentFromHand', filter: w === 'permanent' ? '' : w, who: 'you' };
});
def('effect', 'MaximumHandSizeControllerEffect', (o, tc) => {
  E.checkCalls(o);
  const none = o.args.some(a => a && a.t === 'ref' && a.path === 'Integer.MAX_VALUE');
  const how = (o.args.find(a => a && a.t === 'ref' && /HandSizeModification\./.test(a.path)) || {}).path;
  if (!none || !/SET$/.test(String(how))) block('hand size other than none');
  if (A(o).enumv('TargetController') && A(o).enumv('TargetController') !== 'YOU') block('hand size of others');
  return { op: 'noMaxHandSize' };
});
def('effect', 'TapAllEffect', (o, tc) => {
  E.checkCalls(o);
  return { op: 'tapAll', scope: F.toScope(F.describe(o.args[0], tc)) };
});
def('effect', 'UntapAllControllerEffect', (o, tc) => {
  E.checkCalls(o);
  if (A(o).bool(0, true) === false) block('untap all but this');
  const d = F.describe(o.args[0], tc);
  d.controller = 'you';
  return { op: 'untapAll', scope: F.toScope(d) };
});

/* ---------------- a batch of small ones ---------------- */

def('value', 'IntPlusDynamicValue', (o, tc) => {
  const base = litOf(o.args[0]);
  const v = P.amount(o.args[1], tc);
  if (typeof v === 'number') return base + v;
  if (!v || typeof v !== 'object' || v.plus) block('IntPlusDynamicValue of ' + JSON.stringify(v));
  return Object.assign({}, v, { plus: base });
});
def('effect', 'CantBlockAllEffect', (o, tc) => {
  E.checkCalls(o);
  if (E.durationOf(o, 'EndOfTurn') !== 'eot') block('cant block for longer');
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  return { op: 'restrict', flag: 'cantBlock', scope: F.toScope(d) };
});
def('ability', 'BlocksCreatureTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (f && !(f.t === 'ref' && /FILTER_PERMANENT_CREATURE$/.test(f.path))) block('blocks a kind of creature');
  return AB.triggered(o, tc, { event: 'blocks', self: true });
});
def('ability', 'DealsDamageToOpponentTriggeredAbility', (o, tc) => {
  const b = A(o).all('bool').map(x => x.v);
  // any damage to an opponent, not only combat damage: to a player who is not its controller
  if (!b[1]) {
    if (o.args.some(a => kindOf(a) === 'filter')) block('damage to an opponent by some');
    return AB.triggered(o, tc, { event: 'dealsDamage', self: true, optional: !!b[0], pointer: b[2] ? 'player' : null, extra: { toPlayer: true, toOpponent: true } });
  }
  // combat damage to a player is always to an opponent: only that one is the same trigger
  return AB.triggered(o, tc, { event: 'combatDamageToPlayer', self: true, optional: !!b[0], pointer: b[2] ? 'player' : null });
});
def('effect', 'PreventDamageToTargetEffect', (o, tc) => {
  E.checkCalls(o);
  if (E.durationOf(o, 'EndOfTurn') !== 'eot') block('prevent for longer');
  const n = A(o).int(0);
  if (n == null || o.args.some(a => kindOf(a) === 'bool' && a.v)) block('prevent all, or only combat');
  return Object.assign({ op: 'preventNext', n }, E.aim(o, tc, 'any'));
});
def('ability', 'CastSecondSpellTriggeredAbility', (o, tc) => {
  const who = A(o).enumv('TargetController') || 'YOU';
  if (AB.pointerArg(o)) block('second spell pointing at it');
  if (who === 'YOU') return AB.triggered(o, tc, { event: 'youCastSpell', optional: A(o).bool(0, false),
    condition: [{ kind: 'spellsCast', n: 2 }, { kind: 'spellsCast', n: 2, cmp: 'atMost' }] });
  if (who === 'OPPONENT') return AB.triggered(o, tc, { event: 'opponentSecondSpell', optional: A(o).bool(0, false) });
  if (who === 'ANY') return AB.triggered(o, tc, { event: 'anySecondSpell', optional: A(o).bool(0, false) });
  block('second spell of ' + who);
  return null;
});
def('condition', 'YouGainedLifeCondition.getZero', () => ({ kind: 'lifeGained', n: 1 }));
def('ability', 'DealtDamageToSourceTriggeredAbility', (o, tc) => {
  const b = A(o).all('bool').map(x => x.v);
  return AB.triggered(o, tc, { event: 'isDealtDamage', self: true, optional: !!b[0] });
});
/* "That much": the amount the trigger was about, which these events carry */
const AMOUNT_EVENTS = new Set(['isDealtDamage', 'combatDamageToPlayer', 'youGainLife', 'dealsDamage', 'opponentLosesLife']);
def('value', ['SavedDamageValue.MUCH', 'SavedDamageValue.MANY', 'SavedGainedLifeValue.MUCH', 'SavedGainedLifeValue.MANY'], (o, tc) => {
  if (!tc.trigger || !AMOUNT_EVENTS.has(tc.trigger.event)) block('that much, outside a trigger that counts');
  return 'triggerAmount';
});

/* ---------------- emblems ----------------
   The emblem's own class is read like a card, its abilities translated,
   and the emblem made with them. Its words are the quoted text of the
   printed line. Only triggered abilities, for now: a standing rule on an
   emblem would have to reach the layers from the command zone. */
const emblemCache = new Map();
def('effect', 'GetEmblemEffect', (o, tc) => {
  E.checkCalls(o);
  const em = o.args[0];
  if (!em || em.t !== 'obj' || em.args.length || em.custom) block('emblem ' + keyOf(em));
  const quoted = String(tc.lineText || '').match(/emblem with "([^"]+)"/);
  if (!quoted) block('emblem text');
  const { modelOf } = require('../model');
  const fw = require('../framework');
  let model = emblemCache.get(em.cls);
  if (!model) {
    const src = fw.sourceOf(em.cls);
    if (!src) block('emblem class ' + em.cls);
    model = modelOf(src, em.cls + '.java');
    emblemCache.set(em.cls, model);
  }
  if (model.problems.length) block('emblem constructor: ' + model.problems[0]);
  if (!model.abilities.length) block('emblem with no abilities');
  const save = { ab: tc.ab, kind: tc.kind, trigger: tc.trigger };
  const abilities = [];
  try {
    for (const a of model.abilities) {
      // what an emblem does from the command zone, the engine runs like a permanent's
      const obj = Object.assign({}, a.obj, { args: a.obj.args.map(x => (x && x.t === 'ref' && x.path === 'Zone.COMMAND' ? { t: 'ref', path: 'Zone.BATTLEFIELD' } : x)) });
      tc.ab = null;
      const ab = tr('ability', obj, tc);
      if (ab.kind !== 'triggered') block('emblem with a ' + ab.kind + ' ability');
      ab.text = quoted[1];
      abilities.push(ab);
    }
  } finally { Object.assign(tc, save); }
  const name = (A(model.superArgs ? { args: model.superArgs } : { args: [] }).str(0) || '').replace(/^Emblem\s*/, '') || tc.name;
  return { op: 'getEmblem', name: tc.name, text: quoted[1], abilities };
});

module.exports = { animation };
