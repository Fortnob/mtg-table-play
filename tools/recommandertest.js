#!/usr/bin/env node
/* Commander suggestions from Recommander (src/16b-recommander.js), against
   a pretend relay: what is asked, an answer kept, a refusal for asking too
   often waited out, and anything but a good answer taken as no answer.

   node tools/recommandertest.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log('FAIL ' + what); } };

let calls = [];
let reply = null;
const fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  const r = typeof reply === 'function' ? reply() : reply;
  if (r instanceof Error) throw r;
  return { ok: r.status === 200, status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null }, json: async () => r.body };
};
const window = { MTG: { settings: { recommanderRelay: '' } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', '16b-recommander.js'), 'utf8'),
  { window, fetch, AbortController, setTimeout, clearTimeout, JSON, Date, Math, Map, Set });
const R = window.MTG.recommander;

const card = (id, name) => ({ oracle_id: id, name });
const deck = {
  commanders: [card('cmd-1', 'Giada, Font of Hope')],
  main: [{ card: card('a', 'Serra Avenger'), qty: 1 }, { card: card('b', 'Plains'), qty: 30 }, { card: card('a', 'Serra Avenger'), qty: 1 }],
};
const good = { status: 200, body: { result_code: 'success', data: { recommendations: [
  { oracle_id: 'x', name: 'Lyra, Archangel of Dawn', score: 2.7 }, { oracle_id: 'y', name: "Herald's Horn", score: 0.9 }] } } };

(async () => {
  // no relay: nothing is asked
  check(!R.ready() && (await R.top(deck)) === null && calls.length === 0, 'with no relay nothing is asked');

  // the question: commanders and the rest of the list, by oracle id, once each
  const q = R.query(deck);
  check(q.card_format === 'oracle_id' && q.commander === 'cmd-1' && !q.partner, 'the commander is asked about by oracle id');
  check(JSON.stringify(q.deck) === '["a","b"]', 'each card of the list once, the commander not among them');
  const two = R.query({ commanders: [card('p1', 'Tymna'), card('p2', 'Thrasios')], main: [] });
  check(two.commander === 'p1' && two.partner === 'p2', 'a partner goes as the partner');
  check(R.query({ commanders: [], main: [] }) === null, 'a deck with no commander has nothing to ask');

  // an answer, best first, and the same deck again answered from memory
  window.MTG.settings.recommanderRelay = 'https://relay.example.dev/';
  reply = good;
  const first = await R.top(deck);
  check(calls.length === 1 && calls[0].url === 'https://relay.example.dev', 'asked at the relay, without a trailing slash');
  check(first && first.length === 2 && first[0].name === 'Lyra, Archangel of Dawn' && first[0].score === 2.7, 'the picks come back in order with their scores');
  await R.top(deck);
  check(calls.length === 1, 'the same deck again is answered from memory');
  await R.top(deck, { force: true });
  check(calls.length === 2, 'asked again when forced');

  // a changed deck is a new question
  const more = { commanders: deck.commanders, main: deck.main.concat({ card: card('c', 'Lyra, Archangel of Dawn'), qty: 1 }) };
  reply = { status: 429, headers: { 'retry-after': '30' }, body: { result_code: 'error_rate_limited' } };
  check((await R.top(more)) === null, 'asked too often: no answer');
  const n = calls.length;
  check((await R.top(more)) === null && calls.length === n, 'and not asked again while waiting');

  // anything but a good answer is no answer
  const fresh = (src) => {
    const w = { MTG: { settings: { recommanderRelay: 'https://relay.example.dev' } } };
    vm.runInNewContext(src, { window: w, fetch, AbortController, setTimeout, clearTimeout, JSON, Date, Math, Map, Set });
    return w.MTG.recommander;
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '16b-recommander.js'), 'utf8');
  reply = { status: 200, body: { result_code: 'error_invalid_cards' } };
  check((await fresh(src).top(deck)) === null, 'an error result is no answer');
  reply = { status: 500, body: null };
  check((await fresh(src).top(deck)) === null, 'a failed relay is no answer');
  reply = new Error('offline');
  check((await fresh(src).top(deck)) === null, 'no connection is no answer');
  reply = { status: 200, body: { result_code: 'success', data: { recommendations: [{ name: '' }, null, { name: 'Ok', score: 'x' }] } } };
  const odd = await fresh(src).top(deck);
  check(odd && odd.length === 1 && odd[0].name === 'Ok' && odd[0].score === 0, 'nameless picks are dropped, a strange score is none');

  // the relay test
  reply = good;
  check((await R.test('https://relay.example.dev')) === true, 'a relay that answers passes its test');
  check(typeof (await R.test('http://relay.example.dev')) === 'string', 'an address without https is turned away');
  reply = { status: 403, body: { result_code: 'error_unauthorized' } };
  check(/ALLOWED/.test(await R.test('https://relay.example.dev')), 'a relay that turns this page away says so');

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
