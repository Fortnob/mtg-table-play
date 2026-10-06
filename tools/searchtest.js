/* Does the local search engine find what Scryfall finds?

     node tools/searchtest.js [--kind default_cards|oracle_cards] [--verbose] [--only bots,draft-sets] [--fetch]
     node tools/searchtest.js --bench [--mode local|cache|live] [--bots 7] [--format commander]

   Runs the queries the app really issues — the bots' deck building, the
   commander and partner searches, draft set pools, cube sections, token
   art, the advisor's suggestions — against MTG.cardDb loaded from the bulk
   file in tools/, and against Scryfall's own answers to the same queries
   as cached in tools/.cache by earlier runs (only queries the cache holds
   are compared; nothing is fetched unless --fetch asks for a fixed sample
   of the rest). For each it reports how many of
   Scryfall's cards the local search found (recall), how many of its own
   Scryfall agrees with (precision), and for EDHREC order, how often two
   cards come in the same order.

   --bench times bot deck building: the local database against the cache
   (the network taken out of both), and prints the Scryfall request count
   a cold start would need. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { load, SRC } = require('./engine');
const { loadLocalDb } = require('./localdb');

const CACHE = process.env.MTG_CACHE_DIR ? path.resolve(process.env.MTG_CACHE_DIR) : path.join(__dirname, '.cache');
const API = 'https://api.scryfall.com';

function args() {
  const a = { kind: null, verbose: false, only: null, bench: false, bots: 7, format: null, mode: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k === 'verbose' || k === 'bench' || k === 'fetch') { a[k] = true; continue; }
    a[k] = v[++i];
  }
  if (a.only) a.only = new Set(a.only.split(','));
  return a;
}

/* ---- Scryfall's answers, from the cache the fetch shim keeps ---- */
const cacheFile = (url, body) => path.join(CACHE, crypto.createHash('sha1').update(String(url) + '|' + (body || '')).digest('hex') + '.json');
function readCached(url, body) {
  const f = cacheFile(url, body);
  if (!fs.existsSync(f)) return undefined;
  const t = fs.readFileSync(f, 'utf8');
  return t === '__404__' ? null : JSON.parse(t);
}
/** The same request MTG.scry.search makes, page by page, out of the cache
    (or, with `fetchMissing`, from Scryfall through the engine's caching fetch). */
async function liveSearch(q, opts, fetchMissing) {
  const params = new URLSearchParams({ q });
  if (opts.unique) params.set('unique', opts.unique);
  if (opts.order) params.set('order', opts.order);
  if (opts.dir) params.set('dir', opts.dir);
  if (opts.includeExtras) params.set('include_extras', 'true');
  if (opts.includeVariations) params.set('include_variations', 'true');
  let url = API + '/cards/search?' + params.toString();
  const max = opts.max || 175;
  const out = [];
  for (let page = 0; url && out.length < max && page < 40; page++) {
    let d = readCached(url);
    if (d === undefined && fetchMissing) {
      const res = await globalThis.fetch(url, {});
      d = res.status === 404 ? null : res.ok ? await res.json() : undefined;
    }
    if (d === undefined) return page === 0 ? undefined : (out.partial = true, out);
    if (d === null) break;               // 404: nothing matched
    out.push(...(d.data || []));
    url = d.has_more ? d.next_page : null;
  }
  return out.slice(0, max);
}

/* ---- the queries the app issues ---- */
const COLORS = ['W', 'U', 'B', 'R', 'G'];
function subsets(list) {
  const out = [];
  for (let m = 1; m < (1 << list.length); m++) out.push(list.filter((_, i) => m & (1 << i)));
  return out;
}
function perms(list, k) {
  if (k === 0) return [[]];
  const out = [];
  list.forEach((x, i) => { for (const rest of perms(list.filter((_, j) => j !== i), k - 1)) out.push([x, ...rest]); });
  return out;
}
const idToken = (colors) => (!colors || !colors.length ? 'id:c' : 'id<=' + colors.join(''));
// the q: strings of a module's tables, read from the source so the test follows the app
function tableQueries(file, tableName) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const start = src.indexOf('const ' + tableName + ' = [');
  const end = src.indexOf('];', start);
  const body = src.slice(start, end);
  const out = [];
  for (const m of body.matchAll(/q: '((?:[^'\\]|\\.)*)'/g)) out.push(m[1].replace(/\\'/g, "'"));
  return out;
}

function candidates(MTG) {
  const out = [];
  const add = (cat, q, opts) => out.push({ cat, q, opts });
  const edh = (max) => ({ order: 'edhrec', unique: 'cards', max });
  const themeQs = tableQueries('08-bots.js', 'THEMES');

  // bot deck building: the three pools and a plan, for every colour choice
  for (const key of ['standard', 'pauper', 'commander']) {
    const colourSets = key === 'commander'
      ? subsets(COLORS)
      : [].concat(perms(COLORS, 1), perms(COLORS, 2), perms(COLORS, 3));
    for (const cols of colourSets) {
      // the bots write colours in capitals (Scryfall's next_page lower-cases them)
      const base = `legal:${key} -is:digital lang:en ${idToken(cols)}`;
      add('bots', `${base} t:creature -t:land`, edh(350));
      add('bots', `${base} -t:creature -t:land`, edh(350));
      add('bots', `${base} t:land -t:basic`, edh(175));
      for (const tq of themeQs) add('bots-plan', `${base} ${tq} -t:land`, edh(175));
    }
  }
  // commanders, and the second half of a pair
  add('commander', 'is:commander legal:commander -is:digital lang:en', edh(700));
  for (const cols of subsets(COLORS)) add('commander', 'is:commander legal:commander -is:digital lang:en ' + idToken(cols), edh(700));
  for (const q of ['is:commander legal:commander o:"Partner" -o:"Partner with" -t:background', 'is:commander legal:commander o:"Friends forever"',
    'legal:commander t:background', 'legal:commander t:doctor t:"time lord"', 'is:commander legal:commander o:"Doctor\'s companion"'])
    add('partner', q + ' -is:digital lang:en', edh(100));

  // draft: a set's booster pool, and the whole set when it has no boosters
  const today = new Date().toISOString().slice(0, 10);
  for (const [code, s] of Object.entries(MTG.cardDb.idx.setTable)) {
    // the sets a draft can be made of: paper expansions and the like, with enough cards
    if (!/^(expansion|core|draft_innovation|masters)$/.test(s[1]) || s[3] < 100 || s[4] === s[3] || !(s[2] <= today)) continue;
    add('draft-sets', `set:${code} is:booster -is:digital lang:en`, { unique: 'cards', order: 'set', max: 1200 });
    out[out.length - 1].released = s[2];
    if (!s[5]) { add('draft-sets', `set:${code} -is:digital lang:en -t:basic`, { unique: 'cards', order: 'set', max: 1200 }); out[out.length - 1].released = s[2]; }
  }
  // cubes, built the way 07-draft.js builds them
  const CUBE_EXCLUDE = '-t:basic -is:funny -t:conspiracy -t:scheme -t:plane -t:phenomenon -t:vanguard -t:emblem -t:token -t:dungeon -t:attraction game:paper';
  const cubeBases = ['legal:vintage', 'legal:legacy', 'legal:modern', 'legal:legacy (r:common or r:uncommon)', 'legal:pauper r:common', 'legal:legacy (t:creature or t:land or t:equipment)'];
  const sizes = [540, 450, 360, 360, 360, 360];
  for (let bi = 0; bi < cubeBases.length; bi++) {
    const base = cubeBases[bi];
    for (const size of [sizes[bi]]) {
      const mono = Math.round(size * 0.115), gold = Math.round(size * 0.13), grey = Math.round(size * 0.115);
      const land = size - mono * 5 - gold - grey;
      const secs = [['c=w -t:land', mono], ['c=u -t:land', mono], ['c=b -t:land', mono], ['c=r -t:land', mono], ['c=g -t:land', mono],
        ['c:m -t:land', gold], ['c=c -t:land', grey], ['t:land', Math.max(0, land)]];
      for (const [extra, n] of secs) add('cube', `${base} ${CUBE_EXCLUDE} ${extra}`, { max: Math.ceil(n * 1.6), order: 'edhrec', unique: 'cards' });
    }
  }
  // token art: every token the database knows, asked the two ways the table asks
  const idx = MTG.cardDb.idx;
  const seen = new Set();
  for (const r of idx.R) {
    if (!r.extra || !/token/.test(r.type)) continue;
    const o = idx.O[r.oi];
    const name = String(o[1]).replace(/"/g, '');
    if (seen.has(name + '|' + o[11] + '|' + o[12] + '|' + (o[7] || []).join(''))) continue;
    seen.add(name + '|' + o[11] + '|' + o[12] + '|' + (o[7] || []).join(''));
    const cols = (o[7] || []).map(c => c.toLowerCase());
    const orders = cols.length > 1 ? perms(cols, cols.length).map(p => p.join('')) : [cols.join('')];
    if (o[11] != null) for (const c of orders) add('token-art', `t:token !"${name}" pow=${o[11]} tou=${o[12]} c=${c || 'c'} -is:digital`, { unique: 'art', max: 6 });
    add('token-art', `t:token !"${name}" -is:digital`, { unique: 'art', max: 6 });
  }
  // the advisor's suggestions
  const roleQs = tableQueries('16-advisor.js', 'ROLES');
  const advThemes = tableQueries('16-advisor.js', 'THEMES');
  for (const key of ['standard', 'pauper', 'commander', 'modern', null]) {
    for (const cols of [[]].concat(subsets(COLORS))) {
      const base = [key ? 'legal:' + key : 'game:paper', '-is:digital', 'lang:en', cols.length ? 'id<=' + cols.join('') : 'id:c', '-t:basic'].join(' ');
      for (const q of roleQs.concat(advThemes)) add('advisor', `${base} ${q}`, { order: 'edhrec', unique: 'cards', max: 60 });
      for (const rq of roleQs) for (const tq of advThemes) add('advisor', `${base} ${rq} ${tq}`, { order: 'edhrec', unique: 'cards', max: 60 });
    }
  }
  // the deck builder's starting point
  for (const key of ['standard', 'pauper', 'commander', 'modern', 'pioneer', 'legacy', 'vintage'])
    add('deckbuilder', `is:commander legal:${key}`, { max: 60, unique: 'cards', order: 'edhrec' });
  // --fetch asks Scryfall for a fixed sample of what the cache lacks (a few hundred requests, two a second)
  const SAMPLE = { 'bots': 0, 'bots-plan': 0, commander: 40, partner: 5, 'draft-sets': 30, cube: 60, 'token-art': 50, advisor: 40, deckbuilder: 7 };
  const byCat = new Map();
  for (const c of out) { if (!byCat.has(c.cat)) byCat.set(c.cat, []); byCat.get(c.cat).push(c); }
  for (const [cat, list] of byCat) {
    const n = SAMPLE[cat] || 0;
    if (!n) continue;
    // draft sets: the newest first, then a spread through the history
    const order = cat === 'draft-sets' ? list.slice().sort((x, y) => String(y.released || '').localeCompare(String(x.released || ''))) : list;
    const step = Math.max(1, Math.floor(order.length / n));
    const picked = cat === 'draft-sets' ? order.slice(0, n / 2).concat(order.filter((_, i) => i % step === 0).slice(0, n / 2)) : order.filter((_, i) => i % step === 0).slice(0, n);
    for (const c of picked) c.sample = true;
  }
  return out;
}

/** Every search the cache holds a second page of says what it was: those come along too. */
function harvested() {
  const out = [];
  for (const f of fs.readdirSync(CACHE)) {
    let d;
    try { const t = fs.readFileSync(path.join(CACHE, f), 'utf8'); if (t[0] !== '{') continue; d = JSON.parse(t); } catch (e) { continue; }
    if (!d.next_page || !/[?&]page=2(&|$)/.test(d.next_page)) continue;
    const u = new URL(d.next_page);
    const p = u.searchParams;
    // next_page lower-cases the query, so the first page is found under the app's capitals
    const q = p.get('q').replace(/\bid<=([wubrg]+)/, (m, c) => 'id<=' + c.toUpperCase())
      .replace(/(t|o):"([a-z])/g, (m, k, c) => k + ':"' + c.toUpperCase());
    out.push({ q, opts: { unique: p.get('unique') || undefined, order: p.get('order') || undefined } });
  }
  return out;
}

/* ---- comparing ---- */
const keyOf = (c) => c.oracle_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].oracle_id) || c.name;
function compare(live, mine, opts) {
  const max = opts.max || 175;
  const unique = opts.unique || 'cards';
  // unique:art is one card per picture: the same picture from another printing is the same answer
  const art = (c) => c.illustration_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].illustration_id) || c.id;
  const kf = unique === 'cards' ? keyOf : unique === 'art' ? art : (c) => c.id;
  const L = live.map(kf), M = mine.map(kf);
  const truncated = live.length >= max;
  const Ls = new Set(L), Ms = new Set(M);
  const both = L.filter(k => Ms.has(k));
  const res = {
    live: L.length, local: M.length, truncated,
    recall: L.length ? both.length / L.length : (M.length ? 0 : 1),
    precision: M.length ? M.filter(k => Ls.has(k)).length / M.length : (L.length ? 0 : 1),
    missing: live.filter(c => !Ms.has(kf(c))).map(c => c.name),
    extra: mine.filter(c => !Ls.has(kf(c))).map(c => c.name),
  };
  if (opts.order === 'edhrec' && both.length > 1) {
    // pairs of shared cards that come in the same order on both sides
    const pos = new Map(M.map((k, i) => [k, i]));
    let agree = 0, pairs = 0;
    const step = Math.max(1, Math.floor(both.length / 120));
    for (let i = 0; i < both.length; i += step) for (let j = i + 1; j < both.length; j += step) {
      pairs++;
      if (pos.get(both[i]) < pos.get(both[j])) agree++;
    }
    res.order = pairs ? agree / pairs : 1;
  }
  return res;
}

async function runAgreement(MTG, a) {
  const all = candidates(MTG).concat(harvested().map(h => ({ cat: 'harvested', q: h.q, opts: Object.assign({ max: 175 }, h.opts) })));
  const seen = new Set();
  const rows = [];
  let unsupported = 0;
  for (const c of all) {
    if (a.only && !a.only.has(c.cat)) continue;
    const k = c.q + '|' + JSON.stringify(c.opts);
    if (seen.has(k)) continue;
    seen.add(k);
    let live = await liveSearch(c.q, c.opts, a.fetch && c.sample);
    // harvested searches were made with a cap the next_page does not say; take what is there
    if (live === undefined && c.cat === 'harvested') continue;
    if (live === undefined) continue;
    let mine;
    const t0 = process.hrtime.bigint();
    try { mine = MTG.cardDb.search(c.q, c.opts); }
    catch (e) {
      if (e instanceof MTG.cardDb.Unsupported) { unsupported++; rows.push({ cat: c.cat, q: c.q, unsupported: e.message }); continue; }
      throw e;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (c.cat === 'harvested' && live.length >= 175) c.opts.max = live.length;
    rows.push(Object.assign({ cat: c.cat, q: c.q, opts: c.opts, ms }, compare(live, mine, c.opts)));
  }
  // basic lands, as the limited deck builder asks for them (a collection lookup by name)
  if (!a.only || a.only.has('basics')) {
    const names = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
    const live = readCached(API + '/cards/collection', JSON.stringify({ identifiers: names.map(name => ({ name })) }));
    if (live) {
      const mine = names.map(n => MTG.cardDb.idx.byNameCard(n));
      const r = compare(live.data, mine.filter(Boolean), { unique: 'cards', max: 5 });
      const sameSet = live.data.filter((c, i) => mine[i] && mine[i].set === c.set).length;
      rows.push(Object.assign({ cat: 'basics', q: 'collection: the five basics by name', opts: {}, ms: 0 }, r));
      console.log(`basics: ${mine.filter(Boolean).length}/5 found, ${sameSet}/5 from the printing Scryfall picks (${live.data.map(c => c.set).join(' ')})`);
    }
  }
  // categories
  const cats = new Map();
  for (const r of rows) { if (!cats.has(r.cat)) cats.set(r.cat, []); cats.get(r.cat).push(r); }
  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log('\ncategory        queries  recall  precision  exact  edhrec-order  avg ms');
  const summary = {};
  for (const [cat, list] of cats) {
    const ok = list.filter(r => !r.unsupported);
    const mean = (f) => ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0;
    const ord = ok.filter(r => r.order != null);
    const exact = ok.filter(r => r.recall === 1 && r.precision === 1).length;
    summary[cat] = { queries: list.length, recall: mean(r => r.recall), precision: mean(r => r.precision), exact, order: ord.length ? ord.reduce((s, r) => s + r.order, 0) / ord.length : null, unsupported: list.length - ok.length };
    console.log(cat.padEnd(16) + String(list.length).padStart(7) + pct(summary[cat].recall).padStart(8) + pct(summary[cat].precision).padStart(11) +
      (exact + '/' + ok.length).padStart(7) + (ord.length ? pct(summary[cat].order) : '-').padStart(14) + mean(r => r.ms).toFixed(1).padStart(8) +
      (list.length - ok.length ? `  (${list.length - ok.length} unsupported)` : ''));
  }
  const worst = rows.filter(r => !r.unsupported && (a.verbose ? (r.recall < 1 || r.precision < 1) : (r.recall < 0.97 || r.precision < 0.97))).sort((x, y) => (x.recall + x.precision) - (y.recall + y.precision));
  const show = a.verbose ? worst : worst.slice(0, 12);
  if (show.length) console.log('\nthe least agreement:');
  for (const r of show) {
    console.log(`  [${r.cat}] ${r.q}  {${Object.entries(r.opts).map(([k, v]) => k + ':' + v).join(' ')}}`);
    console.log(`     live ${r.live}${r.truncated ? '+' : ''}, local ${r.local}; recall ${pct(r.recall)}, precision ${pct(r.precision)}`);
    if (r.missing.length) console.log('     missing: ' + r.missing.slice(0, 8).join('; ') + (r.missing.length > 8 ? ` (+${r.missing.length - 8})` : ''));
    if (r.extra.length) console.log('     extra:   ' + r.extra.slice(0, 8).join('; ') + (r.extra.length > 8 ? ` (+${r.extra.length - 8})` : ''));
  }
  for (const r of rows.filter(r => r.unsupported)) console.log(`  unsupported [${r.cat}] ${r.q}: ${r.unsupported}`);
  console.log('summary ' + JSON.stringify({ queries: rows.length, unsupported, categories: summary }));
  return rows;
}

/* ---- timing bot deck building ----
   --mode local   the card database (the default)
   --mode cache   Scryfall's answers from tools/.cache: the work without the network
   --mode live    Scryfall itself, at its two-a-second limit, through an empty
                  cache (MTG_CACHE_DIR is pointed at a fresh folder): what a
                  browser without the database waits for */
async function bench(a) {
  const mode = a.mode || 'local';
  if (mode === 'live') {
    const dir = path.join(require('os').tmpdir(), 'mtg-bench-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    process.env.MTG_CACHE_DIR = dir;
  } else process.env.OFFLINE = '1';
  const { load: loadEngine } = require('./engine');
  const MTG = loadEngine();
  if (mode === 'live') { MTG.scry.q.gap = 120; MTG.scry.q.slowGap = 550; }
  if (mode === 'local') {
    const t0 = Date.now();
    const info = await loadLocalDb(MTG, { kind: a.kind || undefined });
    console.log(`local database: ${info.kind}, ${info.oracles} cards, ${info.prints} printings, packed in ${info.packMs}ms, indexed in ${info.indexMs}ms (${Date.now() - t0}ms)`);
  }
  const formats = a.format ? [a.format] : ['standard', 'commander'];
  const n = parseInt(a.bots, 10) || 7;
  for (const fmt of formats) {
    const rules = MTG.formats.houseDefaults(fmt);
    MTG.scry.stats.requests = 0;
    const t0 = Date.now();
    const before = globalThis.__offlineMisses();
    const decks = await Promise.all(Array.from({ length: n }, (_, i) => MTG.bots.buildBotDeck({
      formatId: fmt, difficulty: 2 + (i % 8), rules, rng: new MTG.RNG(1000 + i), name: 'b' + i,
    }).catch(e => ({ error: e.message }))));
    const ms = Date.now() - t0;
    const bad = decks.filter(d => d.error).length;
    const misses = globalThis.__offlineMisses() - before;
    console.log(`${mode.padEnd(6)} ${fmt.padEnd(10)} ${n} bots at once: ${(ms / 1000).toFixed(2)}s, ` +
      `${MTG.scry.stats.requests} Scryfall requests, ${MTG.scry.stats.local} answered locally` +
      (bad ? `, ${bad} failed` : '') + (misses ? `, ${misses} the cache could not answer` : ''));
    MTG.scry.stats.local = 0;
  }
}

async function main() {
  const a = args();
  if (a.bench) return bench(a);
  const MTG = load({ modules: ['00-core.js', '02-scryfall.js', '02a-carddb.js'] });
  const t0 = Date.now();
  const info = await loadLocalDb(MTG, { kind: a.kind || undefined });
  console.log(`local database: ${info.kind} from ${path.basename(info.file)}, ${info.oracles} cards, ${info.prints} printings (${Date.now() - t0}ms)`);
  await runAgreement(MTG, a);
}

main().catch(e => { console.error(e); process.exit(1); });
