"""Download Scryfall's oracle-cards bulk file into tools/oracle-cards.jsonl.gz.

    python tools/fetch-bulk.py [--force] [--max-age DAYS]

The headless tests (cardtest, smoke, coverage and friends) read every card
from this file, so they need no network once it is here. The current
download address is looked up from Scryfall's bulk-data index each time,
since the file name changes daily. A copy younger than --max-age days
(default 7) is kept unless --force is given: gameplay text changes far
less often than that, and Scryfall asks that bulk files be fetched no
more than they need to be.

Scryfall's keyword catalogs come along too, into tools/keyword-catalogs.json.
"""
import argparse, gzip, json, os, pathlib, shutil, sys, tempfile, time, urllib.request

INDEX = 'https://api.scryfall.com/bulk-data/oracle-cards'
HEADERS = {'User-Agent': 'mtg-table-fetch-bulk/1.0', 'Accept': 'application/json;q=0.9,*/*;q=0.8'}
OUT = pathlib.Path(__file__).resolve().parent / 'oracle-cards.jsonl.gz'


def get(url, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout)


def download(url, dest):
    with get(url, timeout=300) as res, open(dest, 'wb') as f:
        shutil.copyfileobj(res, f, 1 << 20)


def array_to_jsonl(src, dest):
    """The older plain-JSON download is one array; the tools want one card per line."""
    opener = gzip.open if src.endswith('.gz') else open
    with opener(src, 'rt', encoding='utf-8') as f:
        cards = json.load(f)
    with gzip.open(dest, 'wt', encoding='utf-8', newline='\n') as out:
        for c in cards:
            out.write(json.dumps(c, ensure_ascii=False, separators=(',', ':')) + '\n')
    return len(cards)


def count_lines(path):
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        first = f.readline()
        json.loads(first)          # a truncated or HTML download fails here
        return 1 + sum(1 for line in f if line.strip())


CATALOGS = pathlib.Path(__file__).resolve().parent / 'keyword-catalogs.json'


def fetch_catalogs(max_age, force):
    """Scryfall's lists of keyword abilities, keyword actions and ability
    words, into tools/keyword-catalogs.json: tools/glossarytest.js checks
    that the glossary (src/10a-glossary.js) explains every one of them."""
    if CATALOGS.exists() and not force and (time.time() - CATALOGS.stat().st_mtime) / 86400 < max_age:
        return
    out = {'updated': time.strftime('%Y-%m-%d')}
    for name in ('keyword-abilities', 'keyword-actions', 'ability-words'):
        with get('https://api.scryfall.com/catalog/' + name) as res:
            out[name] = json.load(res)['data']
    CATALOGS.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    print(f'wrote {CATALOGS} ({sum(len(v) for k, v in out.items() if k != "updated")} keywords)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true', help='download even if a recent copy is present')
    ap.add_argument('--max-age', type=float, default=7, help='days a copy stays fresh (default 7)')
    ap.add_argument('--type', choices=['oracle', 'default'], default='oracle',
                    help='oracle: one printing per card (the default); default: every printing, '
                         'as default-cards.jsonl.gz, which tools/searchtest.js uses for draft sets')
    a = ap.parse_args()
    global INDEX, OUT
    if a.type == 'default':
        INDEX = INDEX.replace('oracle-cards', 'default-cards')
        OUT = OUT.with_name('default-cards.jsonl.gz')

    try:
        fetch_catalogs(a.max_age, a.force)
    except Exception as e:      # the glossary check keeps the copy it has
        print(f'could not refresh {CATALOGS.name}: {e}')

    if OUT.exists() and not a.force:
        age = (time.time() - OUT.stat().st_mtime) / 86400
        if age < a.max_age:
            print(f'{OUT.name} is {age:.1f} days old; keeping it (--force to fetch anyway)')
            return 0

    with get(INDEX) as res:
        meta = json.load(res)
    url = meta.get('jsonl_download_uri')
    tmp = tempfile.mkdtemp(prefix='mtg-bulk-')
    try:
        part = os.path.join(tmp, OUT.name)
        if url:
            print(f'downloading {url} ({(meta.get("compressed_size") or 0) / 1e6:.1f} MB)')
            download(url, part)
        else:
            url = meta['download_uri']
            print(f'downloading {url} (JSON array; converting to one card per line)')
            raw = os.path.join(tmp, OUT.name.replace('.jsonl.gz', '.json') + ('.gz' if url.endswith('.gz') else ''))
            download(url, raw)
            array_to_jsonl(raw, part)
        n = count_lines(part)
        if n < 10000:
            raise SystemExit(f'only {n} cards in the download; leaving {OUT.name} as it was')
        shutil.move(part, OUT)
        print(f'wrote {OUT} ({n:,} cards, updated {meta.get("updated_at", "?")[:10]})')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
