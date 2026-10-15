/* The table by keyboard and screen reader (src/12g-ui-table-access.js),
   as far as it can be checked without a browser: what is read out from
   the game log, what W says, the labels each card is given, the question
   the focus follows, and which keys the table takes. The moving of focus
   itself needs a page; this checks the decisions behind it.

     node tools/accesstest.js */
'use strict';
const { load } = require('./engine');

// (the card cache has no IndexedDB here, and says so; that is no news to this test)
const warn = console.warn;
console.warn = () => {};
const MTG = load({ modules: ['00-core.js', '01-audio.js', '02-scryfall.js', '02a-carddb.js', '18-scripts.js', '19-cardlib.js',
  '03-oracle.js', '04-formats.js', '05-decklist.js', '06-rules.js', '10-ui-core.js', '12-ui-table.js', '12b-ui-table-fx.js', '12g-ui-table-access.js'] });
console.warn = warn;
const T = MTG.ui.Table.prototype;

let pass = 0, fail = 0;
function check(what, ok, detail) {
  if (ok) pass++; else { fail++; console.log('FAIL ' + what + (detail ? ': ' + detail : '')); }
}

/* ---- a node, as much of one as the labels read ---- */
function node(label, classes, opts) {
  opts = opts || {};
  const attrs = label == null ? {} : { 'aria-label': label };
  const cls = new Set(classes || []);
  return {
    isConnected: true,
    classList: { contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    hasAttribute: (k) => k in attrs,
    closest: (sel) => (opts.closest && opts.closest(sel)) || null,
    attrs, cls,
  };
}
const none = { querySelectorAll: () => [], querySelector: () => null, classList: { contains: () => false }, contains: () => false };

/* ---- the game log, read out ---- */
{
  const said = [];
  const t = { view: { log: [] }, accessSay: (s) => said.push(s) };
  const line = (n, text, type) => ({ t: 1000 + n, text, type: type || 'info' });
  t.view.log = [line(1, 'Game begins.')];
  T.accessAnnounce.call(t);
  check('the game so far is not read out', said.length === 0, said.join(' / '));
  t.view.log = t.view.log.concat([line(2, '--- Turn 3: Mira ---', 'turn'), line(3, 'Mira taps Forest for {G}.', 'mana'), line(4, 'Mira casts Grizzly Bears ({1}{G}).', 'cast')]);
  T.accessAnnounce.call(t);
  check('new lines are read out, together', said.length === 1, said.join(' / '));
  check('the turn line loses its dashes', /^Turn 3: Mira /.test(said[0] || ''), said[0]);
  check('mana symbols are said in words', (said[0] || '').includes('1 generic, green'), said[0]);
  check('tapping for mana is not read out', !/taps Forest/.test(said[0] || ''), said[0]);
  T.accessAnnounce.call(t);
  check('nothing new, nothing said', said.length === 1);
  // an undo: the log goes back; only the last line is said
  t.view.log = t.view.log.slice(0, 2).concat([line(9, 'Mira plays Forest.', 'zone')]);
  T.accessAnnounce.call(t);
  check('after an undo, the latest line', said.length === 2 && said[1] === 'Mira plays Forest.', said[1]);
  // a burst: the last eight, and how many came before
  const burst = [];
  for (let i = 0; i < 12; i++) burst.push(line(20 + i, `Thing ${i}.`, 'info'));
  t.view.log = t.view.log.concat(burst);
  T.accessAnnounce.call(t);
  check('a burst says how many it skipped', /^4 things happened, then: Thing 4\./.test(said[2] || '') && /Thing 11\.$/.test(said[2] || ''), said[2]);
}

/* ---- the beats: each thing an opponent does, and what died and why, said once and in order (D5) ---- */
{
  const said = [];
  const t = { view: { log: [] }, meId: 'me', accessSay: (s) => said.push(s), _actingPlate: () => {} };
  for (const k of ['_saidByBeat', '_beatSaid', '_beatSpeech']) t[k] = T[k];
  const line = (n, text, type) => ({ t: 2000 + n, text, type: type || 'info' });
  t.view.log = [line(0, 'Game begins.')];
  T.accessAnnounce.call(t);
  // Murder held up in the middle: said as it is shown
  const murder = { kind: 'spot', who: 'mira', n: 1, entry: { name: 'Murder', text: 'Mira casts Murder \u2192 Serra Angel' } };
  T._spotOn.call(t, murder, false);
  t.view.log = t.view.log.concat([line(1, 'Mira casts Murder targeting Serra Angel.', 'cast')]);
  T.accessAnnounce.call(t);
  check('a spell held up is said once, as it is shown', said.length === 1 && said[0] === 'Mira casts Murder targeting Serra Angel.', said.join(' / '));
  // shown again (a re-render): not said again
  T._spotOn.call(t, murder, false);
  check('a spell held up is not said again when drawn again', said.length === 1, said.join(' / '));
  // three of the same trigger: said once with how many, and its three log lines passed over
  T._spotOn.call(t, { kind: 'spot', who: 'mira', n: 3, entry: { name: 'Forbidden Orchard \u2014 When you tap', text: 'Mira \u2014 trigger: Forbidden Orchard \u2014 When you tap' } }, false);
  t.view.log = t.view.log.concat([1, 2, 3].map(i => line(1 + i, 'Triggered: Forbidden Orchard \u2014 When you tap', 'trigger')));
  T.accessAnnounce.call(t);
  check('the same trigger three times is said once, with how many', said.length === 2 && /Forbidden Orchard.*\(3 times\)\.$/.test(said[1]) && !said[1].includes('\u2014'), said.join(' / '));
  // it resolves: the log says that; the beat says who died, and why
  const beat = { events: [
    { kind: 'died', name: 'Serra Angel', text: 'Serra Angel dies \u2014 destroyed by Murder' },
    { kind: 'left', name: 'Treasure', text: 'Treasure leaves', quiet: true },
  ] };
  T._beatSpeech.call(t, beat);
  t.view.log = t.view.log.concat([line(10, 'Murder resolves.', 'resolve'), line(11, 'Serra Angel is destroyed.', 'destroy')]);
  T.accessAnnounce.call(t);
  for (const l of beat.speech) t.accessSay(l);
  check('the spell resolving, then what died and why, in that order', said.length === 4 && said[2] === 'Murder resolves.' && said[3] === 'Serra Angel dies, destroyed by Murder.', said.slice(2).join(' / '));
  // my own spell is not held up: the log says it
  t.view.log = t.view.log.concat([line(12, 'Zach casts Giant Growth targeting Grizzly Bears.', 'cast')]);
  T.accessAnnounce.call(t);
  check('a spell nobody held up is read from the log', said[4] === 'Zach casts Giant Growth targeting Grizzly Bears.', said[4]);
  // several dying at once: one line for them all
  const wipe = { events: ['A', 'B', 'C'].map((n, i) => ({ kind: 'died', name: n, text: `${n} dies`, sum: i === 2 ? 'A, B and C die \u2014 Wrath of God' : undefined })) };
  T._beatSpeech.call(t, wipe);
  check('a board wiped is one line', wipe.speech.length === 1 && wipe.speech[0] === 'A, B and C die, Wrath of God.', wipe.speech.join(' / '));
}

/* ---- W: how the game stands ---- */
{
  const me = { id: 'me', name: 'Zach', life: 18, handSize: 5 };
  const mira = { id: 'mira', name: 'Mira', life: 20, handSize: 1, poison: 2 };
  const bf = [
    { id: 'o1', controller: 'me', power: 2, toughness: 2, card: { type_line: 'Creature — Bear' } },
    { id: 'o2', controller: 'me', card: { type_line: 'Basic Land — Forest' } },
    { id: 'o3', controller: 'mira', card: { type_line: 'Basic Land — Mountain' } },
  ];
  const v = { turn: 4, activePlayer: 'mira', step: 'main', phase: 'precombat', players: [me, mira], battlefield: bf,
    stack: [{ id: 's1', controller: 'mira', name: 'Shock', targets: [{ kind: 'object', id: 'o1' }] }] };
  const t = {
    view: v, live: v, meId: 'me', me,
    _opponents: () => [mira],
    targetName: (tg) => (tg.id === 'o1' ? 'Grizzly Bears' : '?'),
    banner: { classList: { contains: () => true }, textContent: 'Mira’s Shock is on the stack Respond with an instant, or press Resolve.' },
    primaryInfo: () => ({ label: 'Resolve', sub: 'Shock' }),
  };
  const s = T.accessSummary.call(t);
  check('W: the turn and the step', s.startsWith('Turn 4, Mira’s turn, first main phase.'), s);
  check('W: each player', s.includes('You have 18 life, 5 cards in hand, 1 creature and 1 land.') && s.includes('Mira has 20 life, 1 card in hand, 0 creatures and 1 land, 2 poison.'), s);
  check('W: the stack, with its target', s.includes('On the stack, top first: Mira’s Shock targeting Grizzly Bears.'), s);
  check('W: what is being asked, and the big button', s.includes('Respond with an instant') && s.includes('The big button says Resolve, Shock.'), s);
}

/* ---- the question the focus follows ---- */
{
  const v = { turn: 2, pendingChoice: null };
  const t = { view: v, live: v, meId: 'me', decision: none, targeting: null, blockPlan: null };
  check('nothing asked, no question', T.accessQuestion.call(t) === '');
  t.targeting = { cardName: 'Shock' };
  check('choosing a target is a question', T.accessQuestion.call(t) === 'aim:Shock');
  t.targeting = null;
  v.pendingChoice = { type: 'declareBlockers', playerId: 'me' };
  const blocks = T.accessQuestion.call(t);
  check('blockers to declare is a question', blocks.startsWith('ch:declareBlockers'), blocks);
  t.blockPlan = { declarations: [], pendingBlocker: 'o7' };
  check('a blocker picked asks for its attacker', T.accessQuestion.call(t) === 'blk:o7');
  v.pendingChoice = { type: 'declareBlockers', playerId: 'mira' };
  check('a question for somebody else is not yours', T.accessQuestion.call(t) === '');
  t.decision = Object.assign({}, none, { classList: { contains: (c) => c === 'on' }, firstChild: {}, _base: 'ch:scry' });
  check('a panel in the middle is a question', T.accessQuestion.call(t) === 'panel:ch:scry');
}

/* ---- the labels ---- */
{
  const hand = node('Lightning Bolt, red, Instant', ['playable']);
  const theirs = node('Grizzly Bears, 1 generic, green, Creature — Bear, 2 by 2', []);
  const hidden = node('A face-down card', []);
  const mine = node('Llanowar Elves, green, Creature — Elf Druid, 1 by 1', ['candidate']);
  const spell = node('Shock, red, Instant', []);
  const v = {
    players: [{ id: 'me', name: 'Zach' }, { id: 'mira', name: 'Mira' }],
    battlefield: [{ id: 'b1', controller: 'mira' }, { id: 'e1', controller: 'me' }, { id: 'f1', controller: 'mira' }],
    stack: [{ id: 's1', objId: 'x1', controller: 'mira', targets: [{ kind: 'object', id: 'e1' }] }],
    pendingChoice: { type: 'declareAttackers', playerId: 'me' },
  };
  const t = {
    view: v, live: v, meId: 'me', blockPlan: null,
    els: new Map([['h1', hand], ['b1', theirs], ['e1', mine], ['x1', spell], ['f1', hidden]]),
    arena: none, stackCol: none, decision: none,
    targetName: (tg) => (tg.id === 'e1' ? 'Llanowar Elves' : '?'),
  };
  // each side of the table, and its rows
  const front = node(null, ['front']), back = node(null, ['back']);
  const seat = Object.assign(node(null, []), { dataset: { seat: 'mira' }, querySelectorAll: () => [front, back] });
  const mySeat = Object.assign(node(null, []), { dataset: { seat: 'me' }, querySelectorAll: () => [] });
  t.oppWrap = { children: [seat] };
  t.myWrap = { children: [mySeat] };
  T.accessLabels.call(t);
  check('their side is named', seat.getAttribute('aria-label') === 'Mira’s side' && seat.getAttribute('role') === 'group', seat.getAttribute('aria-label'));
  check('your side is named', mySeat.getAttribute('aria-label') === 'Your side', mySeat.getAttribute('aria-label'));
  check('each row is named', front.getAttribute('aria-label') === 'Creatures' && back.getAttribute('aria-label') === 'Lands and other permanents');
  check('a playable card says so', hand.getAttribute('aria-label') === 'Lightning Bolt, red, Instant. can be played', hand.getAttribute('aria-label'));
  check('their permanent says whose', theirs.getAttribute('aria-label') === 'Mira’s Grizzly Bears, 1 generic, green, Creature — Bear, 2 by 2', theirs.getAttribute('aria-label'));
  check('an attacker to choose says it can attack', mine.getAttribute('aria-label').endsWith('. can attack'), mine.getAttribute('aria-label'));
  check('a spell on the stack says whose, what it targets, and that it is next',
    spell.getAttribute('aria-label') === 'Shock, red, Instant. on the stack, cast by Mira, targeting Llanowar Elves, resolves next', spell.getAttribute('aria-label'));
  check('their face-down card says whose', hidden.getAttribute('aria-label') === 'Mira’s face-down card', hidden.getAttribute('aria-label'));
  T.accessLabels.call(t);
  check('their permanent, labelled again, the same', theirs.getAttribute('aria-label') === 'Mira’s Grizzly Bears, 1 generic, green, Creature — Bear, 2 by 2', theirs.getAttribute('aria-label'));
  check('labelled again, not twice over', hand.getAttribute('aria-label') === 'Lightning Bolt, red, Instant. can be played', hand.getAttribute('aria-label'));
  // the table paints the card again, and it can no longer be played
  hand.setAttribute('aria-label', 'Lightning Bolt, red, Instant');
  hand.cls.delete('playable');
  T.accessLabels.call(t);
  check('a fresh description, without what no longer holds', hand.getAttribute('aria-label') === 'Lightning Bolt, red, Instant', hand.getAttribute('aria-label'));
  // an ability on the stack: a chip, named and put in the order
  const chip = node(null, []);
  chip.parentElement = { dataset: { stack: 's2' }, classList: { contains: (c) => c === 'targetable' } };
  v.stack.push({ id: 's2', controller: 'mira', card: { name: 'Prodigal Pyromancer' }, abilityText: '{T}: It deals 1 damage to any target.', targets: [{ kind: 'object', id: 'e1' }] });
  t.stackCol = Object.assign({}, none, { querySelectorAll: () => [chip] });
  T.accessLabels.call(t);
  check('an ability on the stack can be reached', chip.getAttribute('tabindex') === '0' || chip.tabIndex === 0);
  check('an ability on the stack says whose, what and what it targets',
    chip.getAttribute('aria-label') === 'Mira’s Prodigal Pyromancer ability: tap: It deals 1 damage to any target. Targeting Llanowar Elves. Resolves next. Can be chosen as the target',
    chip.getAttribute('aria-label'));
  v.stack.pop();
  // chosen to attack
  mine.cls.delete('candidate'); mine.cls.add('chosen');
  T.accessLabels.call(t);
  check('a chosen attacker says how to hold it back', mine.getAttribute('aria-label').endsWith('. attacking, press Enter to hold it back'), mine.getAttribute('aria-label'));
  // creatures tapped to convoke: what can tap, and what one tapping pays
  v.pendingChoice = null;
  t.convoking = { steps: { o: { id: 'h1' } } };
  mine._convokeTag = { _sym: 'G' };
  T.accessLabels.call(t);
  check('a creature tapping to convoke says what it pays', /\. tapping to pay green, press Enter to take it back$/.test(mine.getAttribute('aria-label')), mine.getAttribute('aria-label'));
  mine.cls.delete('chosen'); mine.cls.add('candidate');
  T.accessLabels.call(t);
  check('a creature that could convoke says so', mine.getAttribute('aria-label').endsWith('. can be tapped to pay for it'), mine.getAttribute('aria-label'));
  t.decision = none; t.targeting = null;
  check('convoking is a question', T.accessQuestion.call(t) === 'convoke:h1', T.accessQuestion.call(t));
}

/* ---- which keys the table takes ---- */
{
  const calls = [];
  const t = {
    view: {}, decision: none, _popover: null,
    accessJump: (w) => calls.push('jump:' + w), accessNext: (d) => calls.push('next:' + d), accessPlayers: (d) => calls.push('players:' + d),
    accessFocusQuestion: () => calls.push('question'), accessSay: (s, now) => calls.push('say:' + !!now), accessSummary: () => 'summary',
    accessMove: () => false, cardMenu: () => calls.push('menu'),
  };
  MTG.ui.keyboardHelp = () => calls.push('help');
  const key = (k, target, mods) => {
    const e = Object.assign({ key: k, target: target || { tagName: 'DIV', closest: () => null }, prevented: false, preventDefault() { this.prevented = true; } }, mods || {});
    return { took: T.accessKey.call(t, e), prevented: e.prevented };
  };
  const button = { tagName: 'BUTTON', closest: (sel) => (/button/.test(sel) ? {} : null) };
  let r = key(' ', button);
  check('Space on a button is left to the button', r.took && !r.prevented);
  r = key('Enter', button);
  check('Enter on a button is left to the button', r.took && !r.prevented);
  r = key(' ');
  check('Space elsewhere is the table\'s big button', !r.took);
  r = key('?');
  check('? opens the list of keys', r.took && r.prevented && calls.includes('help'));
  for (const [k, want] of [['h', 'jump:hand'], ['b', 'jump:mine'], ['o', 'jump:theirs'], ['s', 'jump:stack'], ['q', 'question'], ['n', 'next:1'], ['p', 'players:1'], ['w', 'say:true']]) {
    calls.length = 0;
    r = key(k);
    check(`${k.toUpperCase()} is taken`, r.took && r.prevented && calls[0] === want, calls.join(','));
  }
  calls.length = 0;
  r = key('N', null, { shiftKey: true });
  check('Shift+N goes back', calls[0] === 'next:-1', calls.join(','));
  r = key('z');
  check('Z is still the table\'s undo', !r.took);
  r = key('ArrowLeft');
  check('the arrows off the rows are still the table\'s (another opponent)', !r.took);
  r = key('h', { tagName: 'INPUT', closest: () => null });
  check('typing in a box is left alone', !r.took);
  r = key('h', null, { ctrlKey: true });
  check('with Ctrl, the browser\'s', !r.took);
  calls.length = 0;
  r = key('m');
  check('M away from a card is nothing', !r.took && !calls.length);
  const card = { tagName: 'DIV', dataset: { id: 'o1' }, getBoundingClientRect: () => ({ right: 10, top: 10 }), closest: (sel) => (/\.cv/.test(sel) ? card : null) };
  r = key('m', card);
  check('M on a card opens its menu', r.took && calls[0] === 'menu', calls.join(','));
  // a menu open: nothing goes on behind it
  const q = global.document.querySelector;
  global.document.querySelector = (sel) => (/ctx-menu/.test(sel) ? {} : null);
  r = key(' ');
  check('with a menu open, Space does not pass', r.took && !r.prevented);
  global.document.querySelector = q;
}

/* ---- the list of keys covers what the table does ---- */
{
  const listed = MTG.ui.Table.accessKeys.flatMap(([, rows]) => rows.flatMap(([keys]) => keys));
  for (const k of ['Space', 'Enter', 'Esc', 'H', 'B', 'O', 'S', 'P', 'Q', 'N', 'W', 'M', 'I', 'L', 'Z', '?', 'Ctrl', 'Tab']) {
    check(`the list of keys has ${k}`, listed.includes(k));
  }
}

console.log(`keyboard and screen reader: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
