"""Everything worth checking before a commit, in one command.

    python tools/check.py            the full run
    python tools/check.py --quick    a few minutes: small slices of the slow parts
    python tools/check.py --only cardtest,types
    python tools/check.py --online   let the sims fetch what the cache lacks

Runs, in order: the build, a syntax check of the script it bundles,
the card behaviour tests, a smoke run over automated cards, bot-vs-bot
sims (standard, pauper, four-player commander, sealed, Jumpstart), a
short bot game at browser pacing, the runtime contract checks
(tools/contracts.js) and the type check (tsc). Prints a pass/fail line
for each and exits non-zero if anything failed.

Card data comes from tools/oracle-cards.jsonl.gz (python tools/fetch-bulk.py)
and, for the bots' deck building, Scryfall searches cached in tools/.cache.
With a cache present the run is offline by default: a search the cache
cannot answer comes back empty, and the run says how many did. --online
fetches those (politely, two a second) and fills the cache for next time.
"""
import argparse, json, os, pathlib, re, shutil, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
BULK = TOOLS / 'oracle-cards.jsonl.gz'
CACHE = pathlib.Path(os.environ.get('MTG_CACHE_DIR') or (TOOLS / '.cache'))

# a JavaScript check of the bundled script: the last <script> in index.html
SYNTAX_JS = r"""
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[1], 'utf8');
const start = html.lastIndexOf('<script>'), end = html.lastIndexOf('</script>');
if (start < 0 || end < start) { console.log('no inline <script> block found'); process.exit(1); }
const code = html.slice(start + 8, end);
/* a '</script' inside the bundle would end the block early in a browser */
const early = code.search(/<\/script/i);
if (early >= 0) { console.log('the bundle contains "</script" at offset ' + early + '; the browser would end the script there'); process.exit(1); }
try { new Function(code); }
catch (e) {
  /* new Function says what, vm says where; the markers say which file */
  let where = '';
  try { new vm.Script(code, { filename: 'bundle' }); } catch (e2) {
    const m = /bundle:(\d+)/.exec(e2.stack || '');
    if (m) {
      const line = +m[1], lines = code.split('\n');
      let file = '?', at = 0;
      for (let i = 0; i < line; i++) { const k = /^\/\* ===== (.+?) ===== \*\/$/.exec(lines[i]); if (k) { file = k[1]; at = i; } }
      where = ` (src/${file} line ${line - at - 1})`;
    }
  }
  console.log('syntax error' + where + ': ' + e.message);
  process.exit(1);
}
console.log('bundled script parses (' + code.length.toLocaleString() + ' characters)');
"""


def node(*args):
    return ['node', *[str(a) for a in args]]


class Step:
    def __init__(self, name, cmd, judge, timeout=600, env=None, needs_bulk=False):
        self.name, self.cmd, self.judge, self.timeout, self.env, self.needs_bulk = name, cmd, judge, timeout, env or {}, needs_bulk


def last_json(out, prefix='summary '):
    for line in reversed(out.splitlines()):
        if line.startswith(prefix):
            try:
                return json.loads(line[len(prefix):])
            except ValueError:
                return None
    return None


def judge_exit(code, out):
    tail = [l for l in out.strip().splitlines() if l.strip()]
    return code == 0, tail[-1] if tail else ''


def judge_cardtest(code, out):
    m = re.search(r'(\d+) passed, (\d+) failed', out)
    if not m:
        return False, 'no result line'
    fails = [l.strip() for l in out.splitlines() if l.startswith('FAIL')]
    detail = f'{m.group(1)} passed, {m.group(2)} failed'
    if fails:
        detail += ': ' + '; '.join(f[5:] for f in fails[:4]) + (' ...' if len(fails) > 4 else '')
    return code == 0 and m.group(2) == '0', detail


def judge_smoke(code, out):
    m = re.search(r'(\d+) automated cards played .*?, (\d+) with problems', out)
    if not m:
        return False, 'no result line'
    names = [l[1:].split(' ', 1)[1] for l in out.splitlines() if l.startswith('#')]
    detail = f'{m.group(1)} cards, {m.group(2)} with problems'
    if names:
        detail += ': ' + ', '.join(names[:6]) + (' ...' if len(names) > 6 else '')
    return code == 0 and m.group(2) == '0', detail


def judge_sim(code, out):
    s = last_json(out)
    if code != 0 or not s:
        tail = [l for l in out.strip().splitlines() if l.strip()]
        return False, f'exit {code}: ' + (tail[-1][:200] if tail else 'no output')
    bad = []
    for k in ('stalled', 'crashed', 'withErrors', 'nudges', 'contractViolations'):
        if s.get(k):
            bad.append(f'{k}={s[k]}')
    detail = f"{s.get('games')} games, avg {s.get('avgTurns')} turns, {s.get('unfinished', 0)} at the turn cap"
    if s.get('offlineMisses'):
        detail += f", {s['offlineMisses']} searches not in the cache (--online fills them)"
    if bad:
        # the per-game lines say which seed went wrong
        games = [l for l in out.splitlines() if re.search(r'STALLED|CRASHED|errors=[1-9]|nudges=[1-9]', l)]
        detail = ', '.join(bad) + ' - ' + detail + ('; ' + games[0][:160] if games else '')
    return not bad, detail


def judge_contracts(code, out):
    s = last_json(out)
    if not s:
        tail = [l for l in out.strip().splitlines() if l.strip()]
        return False, f'exit {code}: ' + (tail[-1][:200] if tail else 'no output')
    detail = (f"{s['games']} games: {s['views']:,} views, {s['choices']} questions, {s['calls']:,} calls, "
              f"{s['messages']:,} net messages; {s['violations']} violations, {s['known']} known")
    if s.get('offlineMisses'):
        detail += f", {s['offlineMisses']} searches not in the cache (--online fills them)"
    if s.get('selfTestFailures'):
        detail = f"self-test failed ({s['selfTestFailures']}); " + detail
    if s['violations']:
        first = [l.strip() for l in out.splitlines() if l.startswith('  ') and not l.startswith('  known') and not l.startswith('      at')]
        if first:
            detail += ' - ' + first[0][:200]
    return code == 0, detail


def judge_contract_tables(code, out):
    m = re.search(r'contracts: (\d+) violations, (\d+) known', out)
    if not m:
        return judge_exit(code, out)
    ok = m.group(1) == '0'
    detail = f'{m.group(1)} violations, {m.group(2)} known at the test tables'
    if not ok:
        first = [l.strip() for l in out.splitlines() if l.startswith('  ') and not l.strip().startswith(('known', 'at '))]
        if first:
            detail += ' - ' + first[0][:200]
    return ok, detail


def judge_tsc(code, out):
    errs = [l for l in out.splitlines() if ': error TS' in l]
    if code == 0:
        return True, 'no type errors'
    return False, f'{len(errs)} type errors' + (': ' + errs[0].strip()[:200] if errs else '')


def judge_starters(code, out):
    m = re.search(r'(\d+) starter decks, (\d+) with problems', out)
    if not m:
        return judge_exit(code, out)
    detail = f'{m.group(1)} decks, {m.group(2)} with problems'
    if m.group(2) != '0':
        bad = [l.strip() for l in out.splitlines() if l.strip() and not l.strip().startswith('ok')]
        if bad:
            detail += ' - ' + bad[0][:200]
    return code == 0 and m.group(2) == '0', detail


def tsc_cmd():
    bin_ = ROOT / 'node_modules' / 'typescript' / 'bin' / 'tsc'
    if not bin_.exists():
        return None
    return node(bin_, '--noEmit', '-p', ROOT / 'tsconfig.json')


def judge_newcards(code, out):
    s = last_json(out)
    if code != 0 or not s:
        tail = [l for l in out.strip().splitlines() if l.strip()]
        return False, f'exit {code}: ' + (tail[-1][:200] if tail else 'no output')
    return True, (f"{s['fresh']:,} cards with no row or script, {s['auto']:,} automated, "
                  f"{s['borrowedAuto']} of them by borrowing another card's reading")


def judge_readall(code, out):
    s = last_json(out)
    if not s:
        tail = [l for l in out.strip().splitlines() if l.strip()]
        return False, f'exit {code}: ' + (tail[-1][:200] if tail else 'no output')
    ok = code == 0 and s['thrown'] == 0 and s['unreadable'] == 0
    return ok, f"{s['cards']:,} cards ({s['faces']:,} faces) read; {s['thrown']} throwing, {s['unreadable']} unreadable"


def steps(quick):
    n_std, n_pau, n_cmd = (4, 4, 2) if quick else (20, 20, 8)
    smoke_to = 300 if quick else 100000
    sim = lambda fmt, games, players=2: node(TOOLS / 'sim.js', '--format', fmt, '--games', games, '--players', players, '--seed', 1)
    limited = lambda fmt, *more: node(TOOLS / 'limited.js', '--format', fmt, *more, '--seats', 2 if quick else 4,
                                      '--games', 2 if quick else 8, '--seed', 1, '--show', 0)
    out = [
        Step('build', [sys.executable, TOOLS / 'build.py'], judge_exit, 120),
        Step('syntax', node('-e', SYNTAX_JS, ROOT / 'index.html'), judge_exit, 120),
        # the card-picture worker: what it keeps and what it never touches
        Step('sw', node(TOOLS / 'swtest.js'), judge_exit, 60),
        # what keywords mean, beside an enlarged card: every keyword explained, no box a card should not have
        Step('glossary', node(TOOLS / 'glossarytest.js'), judge_exit, 120),
        # Commander brackets: what moves a deck up, where decks land, a table's bracket turning one away
        Step('brackets', node(TOOLS / 'brackettest.js'), judge_exit, 300, needs_bulk=True),
        Step('cardtest', node(TOOLS / 'cardtest.js'), judge_cardtest, 600, needs_bulk=True),
        Step('smoke', node(TOOLS / 'smoke.js', '--from', 0, '--to', smoke_to), judge_smoke, 3600, needs_bulk=True),
        # the ready-made decks must stay legal and run in full as coverage moves
        Step('starters', node(TOOLS / 'starters.js'), judge_starters, 600, needs_bulk=True),
        Step('sim standard', sim('standard', n_std), judge_sim, 1200),
        Step('sim modern', sim('modern', n_pau), judge_sim, 1200),
        Step('sim pauper', sim('pauper', n_pau), judge_sim, 1200),
        Step('sim commander 4p', sim('commander', n_cmd, 4), judge_sim, 1800),
        # sealed pools and Jumpstart half-decks, built or chosen by bots and played to the end
        Step('sim sealed', limited('sealed', '--set', 'fdn'), judge_sim, 1200),
        Step('sim jumpstart', limited('jumpstart', '--source', 'j25'), judge_sim, 1200),
        Step('botsim paced', node(TOOLS / 'botsim.js', '--format', 'standard', '--games', 1 if quick else 4, '--speed', 300, '--contracts'), judge_sim, 1200),
        Step('contracts games', node(TOOLS / 'contracts.js', '--games', 2 if quick else 8) + (['--quick'] if quick else []), judge_contracts, 2400),
        Step('contracts tables', node(TOOLS / 'cardtest.js'), judge_contract_tables, 1200, env={'CONTRACTS': '1'}, needs_bulk=True),
    ]
    if not quick:
        out.append(Step('contracts smoke', node(TOOLS / 'smoke.js', '--from', 0, '--to', 1500), judge_contract_tables, 3600,
                        env={'CONTRACTS': '1'}, needs_bulk=True))
    # every card in the bulk file, every face, read without an exception
    out.append(Step('read every card', node(TOOLS / 'readall.js', '--show', 20), judge_readall, 900, needs_bulk=True))
    # cards nobody wrote anything for, and how many borrow a reading
    out.append(Step('new cards', node(TOOLS / 'newcards.js', '--show', 0), judge_newcards, 900, needs_bulk=True))
    out.append(Step('types', tsc_cmd(), judge_tsc, 600))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--quick', action='store_true', help='small slices of the slow parts (a few minutes)')
    ap.add_argument('--online', action='store_true', help='fetch what the Scryfall cache lacks instead of running offline')
    ap.add_argument('--only', help='comma-separated step names (or the start of them) to run')
    ap.add_argument('--fail-fast', action='store_true', help='stop at the first failure')
    ap.add_argument('-v', '--verbose', action='store_true', help='print each step\'s full output')
    a = ap.parse_args()

    env = dict(os.environ)
    has_cache = CACHE.is_dir() and any(CACHE.iterdir())
    if a.online:
        env.pop('OFFLINE', None)
    elif has_cache:
        env['OFFLINE'] = '1'
    mode = 'online' if 'OFFLINE' not in env else 'offline (cached Scryfall data)'
    print(f"check: {'quick' if a.quick else 'full'} run, {mode}")
    if not has_cache and 'OFFLINE' not in env:
        print('  no Scryfall cache yet: the sims fetch their searches live, two a second')

    plan = steps(a.quick)
    if a.only:
        want = [w.strip() for w in a.only.split(',') if w.strip()]
        plan = [s for s in plan if any(s.name.startswith(w) for w in want)]
        if not plan:
            print('  no step is called that; the steps are: ' + ', '.join(s.name for s in steps(a.quick)))
            return 2
    results = []
    t_all = time.time()
    for s in plan:
        t0 = time.time()
        sys.stdout.write(f'  {s.name:<18} ')
        sys.stdout.flush()
        if s.cmd is None:
            ok, detail = False, 'TypeScript is not installed: run npm ci (or npm install)'
            out = ''
        elif s.needs_bulk and not BULK.exists():
            ok, detail = False, f'{BULK.name} is missing: run python tools/fetch-bulk.py'
            out = ''
        else:
            try:
                p = subprocess.run(s.cmd, cwd=ROOT, env=dict(env, **s.env), capture_output=True, text=True,
                                   encoding='utf-8', errors='replace', timeout=s.timeout)
                out = (p.stdout or '') + (p.stderr or '')
                ok, detail = s.judge(p.returncode, out)
            except subprocess.TimeoutExpired as e:
                out = ((e.stdout or b'').decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or ''))
                ok, detail = False, f'timed out after {s.timeout}s'
            except FileNotFoundError as e:
                out, ok, detail = '', False, f'could not run: {e}'
        dt = time.time() - t0
        results.append((s.name, ok, detail, dt))
        print(f"{'ok  ' if ok else 'FAIL'} {dt:6.1f}s  {detail}")
        if a.verbose or (not ok and out):
            lines = out.strip().splitlines()
            show = lines if a.verbose else lines[-25:]
            for l in show:
                print('      | ' + l[:300])
        if not ok and a.fail_fast:
            break
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} passed in {time.time() - t_all:.0f}s" +
          (': failed ' + ', '.join(r[0] for r in failed) if failed else ''))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
