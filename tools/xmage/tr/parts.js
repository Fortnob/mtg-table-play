/* The small pieces abilities are built from: targets, numbers that count
   something, conditions, costs, counters and tokens. */
'use strict';
const path = require('path');
const fs = require('fs');
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const fw = require('../framework');
const { parseJava } = require('../java');

/* ---------------- targets ----------------
   A target translates to { specs, kind, notTarget, min, max }: one spec per
   thing chosen, the way the parser writes "two target creatures". */

function countOf(o, defMin, defMax) {
  const ints = A(o).all('int').map(x => x.v);
  let min = defMin, max = defMax;
  if (ints.length === 1) { min = max = ints[0]; }
  else if (ints.length >= 2) { min = ints[0]; max = ints[1]; }
  return { min, max };
}

function makeTarget(o, tc, d, zone, kind) {
  const { min, max } = countOf(o, 1, 1);
  let notTarget = A(o).bool(0, false);
  for (const c of o.calls) {
    if (c.name === 'withNotTarget' || c.name === 'setNotTarget') notTarget = c.args[0] ? !!litOf(c.args[0]) : true;
    else if (c.name === 'withChooseHint' || c.name === 'withTargetName' || c.name === 'setTargetName') continue;
    else if (c.name === 'setRequired') continue;
    else block('Target.' + c.name);
  }
  if (max > 10 || max < 1) block('target count ' + max);
  if (min !== 0 && min !== max) block('target count ' + min + '-' + max);
  const spec = d ? F.toSpec(d, zone) : null;
  const specs = [];
  for (let i = 0; i < max; i++) specs.push(Object.assign({}, spec, min === 0 ? { upTo: true } : null));
  return { specs, kind, notTarget, min, max, d };
}

const filterArg = (o) => o.args.find(a => kindOf(a) === 'filter');

def('target', ['TargetPermanent', 'TargetCreaturePermanent', 'TargetControlledCreaturePermanent', 'TargetControlledPermanent',
  'TargetNonlandPermanent', 'TargetLandPermanent', 'TargetArtifactPermanent', 'TargetEnchantmentPermanent',
  'TargetPlaneswalkerPermanent', 'TargetCreatureOrPlaneswalker', 'TargetOpponentsCreaturePermanent', 'TargetAttackingCreature',
  'TargetAttackingOrBlockingCreature', 'TargetBlockingCreature', 'TargetArtifactOrEnchantmentPermanent', 'TargetSacrifice'], (o, tc) => {
  const DEF = {
    TargetPermanent: 'StaticFilters.FILTER_PERMANENT', TargetCreaturePermanent: 'StaticFilters.FILTER_PERMANENT_CREATURE',
    TargetControlledCreaturePermanent: 'StaticFilters.FILTER_CONTROLLED_CREATURE', TargetControlledPermanent: 'StaticFilters.FILTER_CONTROLLED_PERMANENT',
    TargetNonlandPermanent: 'StaticFilters.FILTER_PERMANENT_NON_LAND', TargetLandPermanent: 'StaticFilters.FILTER_LAND',
    TargetArtifactPermanent: 'StaticFilters.FILTER_PERMANENT_ARTIFACT', TargetEnchantmentPermanent: 'StaticFilters.FILTER_PERMANENT_ENCHANTMENT',
    TargetPlaneswalkerPermanent: 'StaticFilters.FILTER_PERMANENT_PLANESWALKER', TargetCreatureOrPlaneswalker: 'StaticFilters.FILTER_PERMANENT_CREATURE_OR_PLANESWALKER',
    TargetOpponentsCreaturePermanent: 'StaticFilters.FILTER_OPPONENTS_PERMANENT_CREATURE', TargetAttackingCreature: 'StaticFilters.FILTER_ATTACKING_CREATURE',
    TargetAttackingOrBlockingCreature: 'StaticFilters.FILTER_ATTACKING_OR_BLOCKING_CREATURE', TargetBlockingCreature: 'StaticFilters.FILTER_BLOCKING_CREATURE',
    TargetArtifactOrEnchantmentPermanent: 'StaticFilters.FILTER_PERMANENT_ARTIFACT_OR_ENCHANTMENT', TargetSacrifice: 'StaticFilters.FILTER_PERMANENT',
  };
  const f = filterArg(o) || { t: 'ref', path: DEF[o.cls] };
  const d = F.describe(f, tc);
  // the narrower classes add their own restriction to whatever filter they are given
  const extra = { TargetCreaturePermanent: ['creature'], TargetControlledCreaturePermanent: ['creature'], TargetLandPermanent: ['land'],
    TargetArtifactPermanent: ['artifact'], TargetEnchantmentPermanent: ['enchantment'], TargetPlaneswalkerPermanent: ['planeswalker'] }[o.cls];
  if (extra && filterArg(o) && !d.types.includes(extra[0]) && !d.allTypes.includes(extra[0])) block(o.cls + ' with a wider filter');
  if (/^TargetControlled/.test(o.cls) && filterArg(o) && d.controller !== 'you') d.controller = 'you';
  if (o.cls === 'TargetOpponentsCreaturePermanent' && filterArg(o)) block('TargetOpponentsCreaturePermanent with a filter');
  const t = makeTarget(o, tc, d, 'battlefield', 'object');
  if (o.cls === 'TargetSacrifice') t.notTarget = true;
  return t;
});

def('target', 'TargetAnyTarget', (o, tc) => {
  if (filterArg(o)) block('TargetAnyTarget with a filter');
  const t = makeTarget(o, tc, null, null, 'any');
  t.specs = t.specs.map(s => Object.assign({ type: 'any' }, s));
  return t;
});
def('target', ['TargetCreatureOrPlayer'], (o, tc) => {
  if (filterArg(o)) block(o.cls + ' with a filter');
  const t = makeTarget(o, tc, null, null, 'any');
  t.specs = t.specs.map(s => Object.assign({ type: 'any', anyOf: ['creature'] }, s));
  return t;
});
def('target', ['TargetPlayerOrPlaneswalker', 'TargetOpponentOrPlaneswalker'], (o, tc) => {
  if (filterArg(o)) block(o.cls + ' with a filter');
  const t = makeTarget(o, tc, null, null, 'any');
  t.specs = t.specs.map(s => Object.assign({ type: 'any', anyOf: ['planeswalker'] }, o.cls === 'TargetOpponentOrPlaneswalker' ? { opponent: true, unknown: true } : null, s));
  if (o.cls === 'TargetOpponentOrPlaneswalker') block('opponent or planeswalker');
  return t;
});
def('target', ['TargetPlayer', 'TargetOpponent'], (o, tc) => {
  let d = null;
  const f = filterArg(o);
  if (f) {
    d = F.describe(f, tc);
    if (d.base !== 'player') block('player filter');
    if (Object.keys(d).some(k => !['base', 'types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'colors', 'notColors', 'message', 'opponent'].includes(k) && d[k] != null)) block('player filter');
  }
  const ints = A(o).all('int').map(x => x.v);
  const nt = A(o).bool(0, false);
  const fake = { args: ints.map(v => ({ t: 'lit', v })).concat([{ t: 'lit', v: nt }]), calls: o.calls };
  const t = makeTarget(fake, tc, null, null, 'player');
  const opp = o.cls === 'TargetOpponent' || (d && d.opponent);
  t.specs = t.specs.map(s => Object.assign({ type: 'player' }, opp ? { opponent: true } : null, s));
  return t;
});
def('target', 'TargetSpell', (o, tc) => {
  const d = F.describe(filterArg(o) || { t: 'ref', path: 'StaticFilters.FILTER_SPELL' }, tc);
  return makeTarget(o, tc, d, 'stack', 'stack');
});
def('target', ['TargetCardInYourGraveyard', 'TargetCardInGraveyard'], (o, tc) => {
  const d = F.describe(filterArg(o) || { t: 'ref', path: 'StaticFilters.FILTER_CARD' }, tc);
  if (d.base !== 'card') block('graveyard filter of ' + d.base);
  if (o.cls === 'TargetCardInYourGraveyard') { if (d.owner && d.owner !== 'you') block('owner'); d.owner = 'you'; }
  const t = makeTarget(o, tc, d, 'graveyard', 'object');
  if (o.cls === 'TargetCardInGraveyard') t.specs.forEach(s => { if (!s.controller) delete s.controller; });
  return t;
});

/* ---------------- numbers ---------------- */

/** An amount: a literal, X, or something counted. */
function amount(v, tc) {
  if (v == null) block('amount:missing');
  if (v.t === 'lit' && typeof v.v === 'number') return v.v;
  const out = tr('value', v, tc);
  // a count says how many of each it is worth, as the parser writes it
  if (out && typeof out === 'object' && out.mult == null &&
      (out.scope || out.cardsInGraveyard || out.cardsInHand || out.countersOnSelf || out.opponents)) out.mult = 1;
  return out;
}
def('value', 'StaticValue.get', (o) => litOf(o.args[0], 'StaticValue'));
def('value', ['GetXValue.instance', 'ManacostVariableValue.REGULAR', 'ManacostVariableValue.ETB'], () => 'X');
def('value', 'PermanentsOnBattlefieldCount', (o, tc) => {
  const d = F.describe(o.args[0] || { t: 'ref', path: 'StaticFilters.FILTER_PERMANENT' }, tc);
  const mult = o.args[1] ? litOf(o.args[1]) : 1;
  return Object.assign({ scope: F.toScope(d) }, mult !== 1 ? { mult } : null);
});
def('value', ['CreaturesYouControlCount.SINGULAR', 'CreaturesYouControlCount.PLURAL', 'CreaturesYouControlCount.instance'],
  () => ({ scope: { who: 'you', what: 'creature' } }));
def('value', ['LandsYouControlCount.instance'], () => ({ scope: { who: 'you', what: 'land' } }));
def('value', ['ArtifactYouControlCount.instance'], () => ({ scope: { who: 'you', what: 'artifact' } }));
def('value', 'CardsInControllerGraveyardCount', (o, tc) => {
  const d = F.describe(o.args[0] || { t: 'ref', path: 'StaticFilters.FILTER_CARD' }, tc);
  const words = F.toWords(d);
  const mult = o.args[1] ? litOf(o.args[1]) : 1;
  return Object.assign({ cardsInGraveyard: true }, words !== 'card' ? { filter: words } : null, mult !== 1 ? { mult } : null);
});
def('value', ['CardsInControllerHandCount.ANY', 'CardsInControllerHandCount.instance'], () => ({ cardsInHand: 'you' }));
def('value', 'CountersSourceCount', (o) => {
  const c = o.args[0] && o.args[0].t === 'ref' ? o.args[0].path.split('.')[1] : null;
  if (!c) block('CountersSourceCount');
  return { countersOnSelf: F.counterName(c) };
});
def('value', ['SourcePermanentPowerValue.NOT_NEGATIVE', 'SourcePermanentPowerValue.ALLOW_NEGATIVE', 'SourcePermanentPowerValue.instance'],
  () => ({ ofSelf: 'power' }));
def('value', ['SourcePermanentToughnessValue.instance', 'SourcePermanentToughnessValue.NOT_NEGATIVE'], () => ({ ofSelf: 'toughness' }));
def('value', ['TargetPermanentPowerCount.instance', 'TargetPermanentPowerCount.ALLOW_NEGATIVE', 'TargetPermanentPowerCount.NOT_NEGATIVE'], () => ({ ofTarget: 'power' }));
def('value', ['OpponentsCount.instance'], () => ({ opponents: true }));
def('value', 'MultipliedValue', (o, tc) => {
  const base = amount(o.args[0], tc);
  const k = litOf(o.args[1]);
  if (typeof base === 'number') return base * k;
  if (base && typeof base === 'object' && (base.scope || base.cardsInGraveyard || base.cardsInHand || base.countersOnSelf || base.opponents) && !base.mult) return Object.assign({}, base, { mult: k });
  block('MultipliedValue of ' + JSON.stringify(base));
  return null;
});

/* ---------------- conditions ---------------- */

function cmpCount(cmpRef, n) {
  const c = cmpRef ? cmpRef.path.split('.')[1] : 'MORE_THAN';
  switch (c) {
    case 'MORE_THAN': return { n: n + 1 };
    case 'OR_GREATER': return { n };
    case 'FEWER_THAN': return { n: n - 1, cmp: 'atMost' };
    case 'OR_LESS': return { n, cmp: 'atMost' };
    case 'EQUAL_TO': if (n === 0) return { n: 0, cmp: 'atMost' }; break;
    default: break;
  }
  block('comparison ' + c);
  return null;
}

def('condition', 'MyTurnCondition.instance', () => ({ kind: 'yourTurn' }));
def('condition', 'NotMyTurnCondition.instance', () => ({ kind: 'notYourTurn' }));
def('condition', ['MorbidCondition.instance'], () => ({ kind: 'morbid' }));
def('condition', ['RaidCondition.instance'], () => ({ kind: 'raid' }));
def('condition', ['RevoltCondition.instance'], () => ({ kind: 'revolt' }));
def('condition', ['DeliriumCondition.instance'], () => ({ kind: 'graveyardTypes', n: 4 }));
def('condition', ['ThresholdCondition.instance'], () => ({ kind: 'graveyard', n: 7 }));
def('condition', ['HellbentCondition.instance'], () => ({ kind: 'hand', n: 0, cmp: 'atMost' }));
def('condition', ['FerociousCondition.instance'], () => ({ kind: 'controlPower', n: 4 }));
def('condition', ['MetalcraftCondition.instance'], () => ({ kind: 'control', what: 'artifact', n: 3 }));
def('condition', ['SourceTappedCondition.TAPPED'], () => ({ kind: 'selfTapped' }));
def('condition', ['SourceTappedCondition.UNTAPPED'], () => ({ kind: 'selfUntapped' }));
def('condition', ['SourceAttackingCondition.instance'], () => ({ kind: 'selfAttacking' }));
def('condition', ['KickedCondition.ONCE'], () => ({ kind: 'kicked', n: 1 }));
def('condition', ['KickedCondition.TWICE'], () => ({ kind: 'kicked', n: 2 }));
def('condition', ['LandfallCondition.instance'], () => ({ kind: 'landfall' }));
def('condition', ['AddendumCondition.instance'], () => ({ kind: 'castInMain' }));
def('condition', ['BargainedCondition.instance'], () => ({ kind: 'bargained' }));
def('condition', ['GiftWasPromisedCondition.TRUE'], () => ({ kind: 'gift' }));
def('condition', ['GiftWasPromisedCondition.FALSE'], () => ({ kind: 'gift', none: true }));
def('condition', ['DescendedThisTurnCondition.instance'], () => ({ kind: 'descended' }));
def('condition', ['CitysBlessingCondition.instance'], () => ({ kind: 'cityBlessing' }));
def('condition', ['IsMainPhaseCondition.YOUR'], () => block('IsMainPhaseCondition'));
def('condition', 'InvertCondition', (o, tc) => ({ kind: 'not', cond: tr('condition', o.args[0], tc) }));
def('condition', 'PermanentsOnTheBattlefieldCondition', (o, tc) => {
  const d = F.describe(o.args[0], tc);
  const cmpRef = o.args.find(a => a && a.t === 'ref' && /^ComparisonType\./.test(a.path));
  const ints = A(o).all('int').map(x => x.v);
  const bools = A(o).all('bool').map(x => x.v);
  const only = bools.length ? bools[0] : true;
  const c = cmpCount(cmpRef, ints.length ? ints[0] : 0);
  if (only) d.controller = d.controller || 'you';
  const scope = F.toScope(d);
  return Object.assign({ kind: 'control', scope, what: F.words(d) }, c);
});
def('condition', 'SourceHasCounterCondition', (o, tc) => {
  const c = o.args[0] && o.args[0].t === 'ref' ? o.args[0].path.split('.')[1] : null;
  if (!c) block('SourceHasCounterCondition');
  const cmpRef = o.args.find(a => a && a.t === 'ref' && /^ComparisonType\./.test(a.path));
  const ints = A(o).all('int').map(x => x.v);
  if (cmpRef) {
    const k = cmpCount(cmpRef, ints[0]);
    return Object.assign({ kind: 'selfCounters', counter: F.counterName(c) }, k);
  }
  return { kind: 'selfCounters', counter: F.counterName(c), n: ints.length ? ints[0] : 1 };
});
def('condition', 'CardsInControllerGraveyardCondition', (o, tc) => {
  const n = litOf(o.args[0]);
  if (o.args[1]) {
    const d = F.describe(o.args[1], tc);
    return { kind: 'graveyard', n, what: F.toWords(d) };
  }
  return { kind: 'graveyard', n };
});
def('condition', 'CardsInHandCondition', (o) => {
  const cmpRef = o.args.find(a => a && a.t === 'ref' && /^ComparisonType\./.test(a.path));
  const n = A(o).int(0);
  if (n == null) block('CardsInHandCondition');
  return Object.assign({ kind: 'hand' }, cmpCount(cmpRef, n));
});
def('condition', 'OpponentControlsMoreCondition', (o, tc) => {
  const d = F.describe(o.args[0], tc);
  const w = F.toWords(d);
  if (!/^[a-z]+$/.test(w)) block('OpponentControlsMoreCondition of ' + w);
  return { kind: 'opponentMore', what: w };
});

/* ---------------- costs ----------------
   Costs are written out as the words the parser reads and handed to its
   own cost reader, so they come out exactly as a printed cost would. */

function costText(v, tc) {
  if (!v) block('cost:missing');
  if (v.t === 'obj' && v.custom) block('custom cost', v.cls);
  const key = keyOf(v);
  switch (key) {
    case 'ManaCostsImpl': {
      if (!v.args.length) return '';
      const s = litOf(v.args[0], 'ManaCostsImpl');
      if (/X/.test(s)) tc.hasX = true;
      return s;
    }
    case 'GenericManaCost': return '{' + litOf(v.args[0]) + '}';
    case 'ColoredManaCost': {
      const c = v.args[0] && v.args[0].t === 'ref' ? v.args[0].path.split('.')[1] : null;
      const m = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' }[c];
      if (!m) block('ColoredManaCost');
      return '{' + m + '}';
    }
    case 'TapSourceCost': return '{T}';
    case 'UntapSourceCost': return '{Q}';
    case 'SacrificeSourceCost': return 'Sacrifice this';
    case 'SacrificeTargetCost': {
      let n = 1, d;
      if (v.args[0] && v.args[0].t === 'obj' && v.args[0].cls === 'TargetSacrifice') {
        const t = tr('target', v.args[0], tc);
        n = t.max; d = t.d;
      } else {
        const f = v.args.find(a => kindOf(a) === 'filter');
        if (!f) block('SacrificeTargetCost');
        d = F.describe(f, tc);
        n = A(v).int(0) || 1;
      }
      const another = d.another;
      const d2 = Object.assign({}, d, { another: undefined, controller: undefined });
      const words = F.toWords(d2);
      if (/ or .* /.test(words) && /\s/.test(words.replace(/ or /g, ''))) block('sacrifice words');
      return 'Sacrifice ' + (another ? 'another' : n === 1 ? (/^[aeiou]/.test(words) ? 'an' : 'a') : n) + ' ' + words;
    }
    case 'DiscardCardCost': {
      const f = v.args.find(a => kindOf(a) === 'filter');
      if (A(v).bool(0, false)) block('discard at random');
      if (!f) return 'Discard a card';
      const w = F.toWords(F.describe(f, tc));
      return 'Discard ' + (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w + ' card';
    }
    case 'DiscardHandCost': return 'Discard your hand';
    case 'PayLifeCost': {
      const a = v.args[0];
      if (a && a.t === 'lit') return 'Pay ' + a.v + ' life';
      block('PayLifeCost of a count');
      return null;
    }
    case 'RemoveCountersSourceCost': {
      const c = v.args[0];
      if (c && c.t === 'obj' && /^CounterType\.\w+\.createInstance$/.test(c.cls)) {
        const kind = F.counterName(c.cls.split('.')[1]);
        const n = c.args[0] ? litOf(c.args[0]) : 1;
        return 'Remove ' + (n === 1 ? 'a' : n) + ' ' + kind + ' counter' + (n === 1 ? '' : 's') + ' from this';
      }
      block('RemoveCountersSourceCost');
      return null;
    }
    case 'ExileSourceFromGraveCost': return 'Exile this card from your graveyard';
    case 'ExileSourceCost': return 'Exile this';
    case 'ExileFromGraveCost': {
      const t = v.args[0];
      if (!t || t.t !== 'obj' || t.cls !== 'TargetCardInYourGraveyard') block('ExileFromGraveCost');
      const tt = tr('target', t, tc);
      if (tt.min !== tt.max) block('exile up to');
      const w = F.toWords(Object.assign({}, tt.d, { owner: undefined }));
      return 'Exile ' + (tt.max === 1 ? 'a' : tt.max) + ' ' + (w === 'card' ? '' : w + ' ') + 'card' + (tt.max === 1 ? '' : 's') + ' from your graveyard';
    }
    case 'TapTargetCost': {
      let n = 1, d;
      const t = v.args.find(a => a && a.t === 'obj' && /^Target/.test(a.cls));
      if (t) { const tt = tr('target', t, tc); n = tt.max; d = tt.d; if (tt.min !== tt.max) block('tap up to'); }
      else {
        const f = v.args.find(a => kindOf(a) === 'filter');
        d = F.describe(f, tc);
        const ints = A(v).all('int').map(x => x.v);
        if (ints.length > 1 && ints[0] !== ints[1]) block('tap up to');
        n = ints[0] || 1;
      }
      const another = d.another;
      const words = F.toWords(Object.assign({}, d, { another: undefined, controller: undefined, tapped: undefined }));
      if (/\s/.test(words)) block('tap words ' + words);
      return 'Tap ' + (another ? 'another' : n === 1 ? (/^[aeiou]/.test(words) ? 'an' : 'a') : n) + ' untapped ' + words + ' you control';
    }
    case 'PutCountersSourceCost': {
      const c = v.args[0];
      if (c && c.t === 'obj' && /^CounterType\.\w+\.createInstance$/.test(c.cls)) {
        const kind = F.counterName(c.cls.split('.')[1]);
        const n = c.args[0] ? litOf(c.args[0]) : 1;
        return 'Put ' + (n === 1 ? 'a' : n) + ' ' + kind + ' counter' + (n === 1 ? '' : 's') + ' on this creature';
      }
      block('PutCountersSourceCost');
      return null;
    }
    case 'ExertSourceCost': return 'Exert this';
    default: block(key); return null;
  }
}

/** A list of XMage costs -> the engine's cost object, via the parser's own reader. */
function costOf(list, tc) {
  const mana = [], other = [];
  let tap = false, untap = false;
  for (const c of list) {
    const s = costText(c, tc);
    if (s === '{T}') tap = true;
    else if (s === '{Q}') untap = true;
    else if (/^(\{[^}]+\})*$/.test(s)) mana.push(s);
    else other.push(s);
  }
  const text = [mana.join('')].concat(tap ? ['{T}'] : [], untap ? ['{Q}'] : [], other).filter(Boolean).join(', ');
  const cost = tc.MTG.oracle.parseCost(text);
  if (cost.other.length) block('cost:' + cost.other.join('; '));
  return cost;
}

/* ---------------- counters ---------------- */

/** CounterType.X.createInstance(n) -> { kind, n } */
function counterOf(v, tc) {
  if (v && v.t === 'obj' && /^CounterType\.\w+\.createInstance$/.test(v.cls)) {
    const kind = F.counterName(v.cls.split('.')[1]);
    const n = v.args[0] ? amount(v.args[0], tc) : 1;
    return { kind, n };
  }
  block('counter ' + keyOf(v));
  return null;
}

/* ---------------- tokens ----------------
   A token class is read from its own constructor: its types, colours,
   subtypes, size and keywords. The few named artifact tokens are made by
   name, which is how the engine knows them. */

const NAMED = { TreasureToken: 'Treasure', FoodToken: 'Food', ClueToken: 'Clue', BloodToken: 'Blood', MapToken: 'Map',
  PowerstoneToken: 'Powerstone', GoldToken: 'Gold', JunkToken: 'Junk', ShardToken: 'Shard', LanderToken: 'Lander' };
const tokenCache = new Map();

function tokenOf(v, tc) {
  if (!v || v.t !== 'obj') block('token ' + keyOf(v));
  if (v.custom) block('custom token', v.cls);
  if (NAMED[v.cls]) {
    if (v.args.length) block(v.cls + ' with arguments');
    return { named: NAMED[v.cls] };
  }
  if (v.cls === 'CreatureToken') block('CreatureToken');
  if (v.args.length) block('token with arguments ' + v.cls);
  if (tokenCache.has(v.cls)) { const t = tokenCache.get(v.cls); if (t.blocked) block(t.blocked); return t; }
  let t;
  try { t = readToken(v.cls, tc); }
  catch (e) { if (e.what) tokenCache.set(v.cls, { blocked: e.what }); throw e; }
  tokenCache.set(v.cls, t);
  return t;
}

function readToken(cls, tc) {
  const src = fw.sourceOf(cls);
  if (!src) block('token ' + cls);
  const unit = parseJava(src);
  const main = unit.types.find(t => t.name === cls);
  const ctor = main && main.ctors.find(c => c.params.length === 0);
  if (!ctor) block('token ctor ' + cls);
  const out = { types: [], colors: [], subtypes: [], keywords: [], supertypes: [] };
  const COLOR = { setWhite: 'white', setBlue: 'blue', setBlack: 'black', setRed: 'red', setGreen: 'green' };
  for (const st of ctor.body) {
    if (st.k !== 'expr') block('token statement ' + cls);
    const e = st.e;
    if (e.k === 'call' && !e.obj && e.name === 'super') {
      const desc = e.args[1] && e.args[1].k === 'lit' ? e.args[1].v : null;
      out.name = e.args[0] && e.args[0].k === 'lit' ? e.args[0].v : null;
      out.description = desc;
      continue;
    }
    if (e.k === 'call' && e.obj && e.obj.k === 'name' && e.name === 'add' && /^(?:cardType|subtype|supertype)$/.test(e.obj.v)) {
      const a = e.args[0];
      const ref = a && a.k === 'field' ? a.obj.v + '.' + a.name : null;
      if (!ref) block('token ' + cls);
      const val = ref.split('.')[1];
      if (e.obj.v === 'cardType') out.types.push(val.toLowerCase());
      else if (e.obj.v === 'subtype') out.subtypes.push(F.subtypeName(val));
      else out.supertypes.push(val.toLowerCase());
      continue;
    }
    if (e.k === 'call' && e.obj && e.obj.k === 'name' && e.obj.v === 'color' && COLOR[e.name]) { out.colors.push(COLOR[e.name]); continue; }
    if (e.k === 'assign' && e.l.k === 'name' && (e.l.v === 'power' || e.l.v === 'toughness')) {
      const r = e.r;
      if (r.k !== 'new' || r.type.name !== 'MageInt' || !r.args[0] || r.args[0].k !== 'lit') block('token size ' + cls);
      out[e.l.v] = r.args[0].v;
      continue;
    }
    if (e.k === 'call' && !e.obj && e.name === 'addAbility') {
      const a = e.args[0];
      const name = a && a.k === 'call' && a.name === 'getInstance' && a.obj && a.obj.k === 'name' ? a.obj.v : null;
      const kw = name && F.KW_CLASSES[name];
      if (!kw) block('token ability ' + cls);
      out.keywords.push(kw.replace(/\b\w/g, ch => ch.toUpperCase()));
      continue;
    }
    if (e.k === 'call' && e.obj && e.obj.k === 'this' && /^(?:setOriginalExpansionSetCode|setTokenType)$/.test(e.name)) continue;
    if (e.k === 'call' && !e.obj && /^(?:setOriginalExpansionSetCode|setTokenType|availableImageSetCodes)$/.test(e.name)) continue;
    block('token code ' + cls);
  }
  if (!out.types.includes('creature')) block('noncreature token ' + cls);
  if (out.power == null || out.toughness == null) block('token size ' + cls);
  return out;
}

/** The engine's createToken effect for a token and a count. */
function createTokenEffect(tok, n, opts) {
  opts = opts || {};
  if (tok.named) return Object.assign({ op: 'createNamedToken', n, token: tok.named }, opts.tapped ? { tapped: true } : null);
  const e = { op: 'createToken', n, keywords: tok.keywords.slice(), pt: tok.power + '/' + tok.toughness,
    colorWords: tok.colors.length ? tok.colors.slice() : ['colorless'], addTypes: tok.types.filter(t => t !== 'creature').map(t => t[0].toUpperCase() + t.slice(1)),
    subtypes: tok.subtypes.map(s => s.replace(/\b\w/g, ch => ch.toUpperCase())).join(' ') || 'Creature' };
  if (tok.supertypes.includes('legendary')) e.legendary = true;
  if (tok.supertypes.includes('snow')) e.snow = true;
  if (opts.tapped) e.tapped = true;
  if (opts.attacking) e.attacking = true;
  return e;
}

module.exports = { amount, costOf, costText, counterOf, tokenOf, createTokenEffect, cmpCount };
