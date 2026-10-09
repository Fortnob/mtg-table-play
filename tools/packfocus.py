"""Where the subject is in each pack's picture, so a pack shows it.

A booster is tall and Scryfall's art crops are wide, so a pack shows a
little under half of its picture's width; centring that half blindly cuts
off Ancestral Recall's face and most of Black Lotus. This finds the part
of each picture that matters, from the picture itself: how far each spot
stands out from the picture's own colours (Achanta's frequency-tuned
saliency) and how much detail it holds, then the window a pack shows with
the most of both in it. The pictures are the first few of each set's in
src/10d0-packart.js (tools/packart.js), the ones a pack is likeliest to
wear. Written to src/10d1-packfocus.js as MTG.artFocus, by illustration:
[percent across, percent down] of the subject. A focus chosen by hand
(FIRST in tools/packart.js, or OVERRIDE here, set after looking at the
contact sheets) wins.

    python tools/packfocus.py                 # write src/10d1-packfocus.js
    python tools/packfocus.py --sheet DIR     # also draw contact sheets of every pack on sale, as it will look

The packs on sale and the picture each one wears are worked out as the
Store does it (packSets in src/02-scryfall.js, assignAll in
src/10d-ui-store.js), from Scryfall's list of sets.

Needs Pillow. Pictures are kept in the system's temp folder between runs.
"""
import argparse, json, math, os, pathlib, re, subprocess, sys, tempfile, time
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'src' / '10d0-packart.js'
OUT = ROOT / 'src' / '10d1-packfocus.js'
CACHE = pathlib.Path(tempfile.gettempdir()) / 'mtg-table-artcache'
HEADERS = {'User-Agent': 'mtg-table-packfocus/1.0'}
PER_SET = 3                     # the pictures a set's packs are likeliest to wear
PACK = 5 / 8.6                  # a booster's width over its height (.booster in src/store.css)
SMALL = (112, 90)               # the size the picture is read at

# Corrections made by eye from the contact sheets: illustration (first 8 hex digits) -> [across, down]
OVERRIDE = {
    '0c425797': [40, 40],   # Avacyn Restored, Modern Masters 2017: the beast over the trees
    '95416de8': [42, 45],   # Double Masters: the armoured creature's body
    '9350b746': [55, 50],   # Homelands: the valley, no subject to one side
    'fa27f28e': [45, 45],   # The Lord of the Rings: the One Ring
    '02ee4007': [58, 40],   # Kaldheim: the dragon
    'abbfa3b6': [22, 45],   # Arabian Nights: the horse's head
    '5956189e': [56, 45],   # Masters Edition: the demon
    'dcc8fa99': [30, 45],   # Outlaws of Thunder Junction: the dragon's head and body
    'a39b5828': [35, 50],   # Avatar: the figure in the lightning
    '83680573': [45, 45],   # Tarkir: Dragonstorm: the beast
    '5f07e5bf': [35, 45],   # Time Spiral: the figure in the light
    'd45a53d6': [52, 45],   # Doctor Who: the burning ship
    'b8babcc6': [40, 45],   # Unhinged, Unsanctioned: the goblin and the pig
    '9ba8197f': [48, 45],   # Mercadian Masques: the hand-off between the two
    'e12665f8': [45, 40],   # Fourth Edition, Sengir Vampire: the vampire's face
    'd326c884': [68, 35],   # Unlimited, Shivan Dragon: the dragon's head and body
    'abca40cd': [45, 40],   # Antiquities, Mishra's Workshop
    '194bc2dc': [27, 45],   # Teenage Mutant Ninja Turtles Eternal, Irma
    '99f6afc0': [52, 45],   # Magic 2013, Talrand
    '81a0ebd4': [50, 50],   # The Hobbit Eternal, the Necklace of Girion
    'bc953a16': [62, 50],   # Conspiracy, Scourge of the Throne
    'bbd642e1': [50, 35],   # Magic 2014, Liliana
    '42a864bb': [40, 40],   # Magic 2012, Grand Abolisher
}


def candidates(per_set=PER_SET):
    """Each set's pictures, in order: (set code, rank, card id, illustration)."""
    s = DATA.read_text(encoding='utf-8')
    out = []
    for code, hexes in re.findall(r'^\s+"([a-z0-9]+)": "([0-9a-f]+)",$', s, re.M):
        for i in range(0, min(len(hexes) // 40, per_set)):
            h = hexes[i * 40:i * 40 + 40]
            cid = f'{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}'
            out.append((code, i, cid, h[32:40]))
    return out


def sold_sets():
    """The sets on sale, newest first, as MTG.scry.packSets has them."""
    r = subprocess.run(['curl', '-s', '-f', '--max-time', '60', '-A', HEADERS['User-Agent'], '-H', 'Accept: application/json',
                        'https://api.scryfall.com/sets'], capture_output=True)
    sets = json.loads(r.stdout.decode('utf-8'))['data']
    today = time.strftime('%Y-%m-%d')
    plain_cmd = re.compile(r"^Commander(?: \d{4}| Anthology| Collection|'s Arsenal| Legends)|^Commander$|^Starter Commander", re.I)
    def standalone(x):
        return x['set_type'] == 'commander' and not x.get('parent_set_code') and not plain_cmd.search(x.get('name') or '')
    out = [x for x in sets if x['code'] not in ('om1', 'omb')
           and (x['set_type'] in ('expansion', 'core', 'draft_innovation', 'masters', 'eternal') or standalone(x))
           and (x.get('card_count', 0) >= 100 or (x.get('card_count', 0) >= 70 and (x.get('released_at') or '') < '1997-01-01'))
           and x.get('released_at') and x['released_at'] <= today
           and not re.search(r'Foreign Black Border|^Renaissance$|^Rinascimento$', x.get('name') or '', re.I)
           and x['code'] not in ('ren', 'rin', 'bchr', '4bb', 'fbb')]
    return sorted(out, key=lambda x: x['released_at'], reverse=True)


def assignment(sold):
    """The picture each pack on sale wears: claimed as assignAll does, the hand-chosen first, one illustration per pack."""
    data = DATA.read_text(encoding='utf-8')
    by_set = {}
    for code, rank, cid, ill in candidates(99):
        by_set.setdefault(code, []).append((cid, ill))
    reserved = json.loads((re.search(r'MTG\.packArtReserved = (\[.*?\]);', data) or [None, '[]'])[1])
    m = re.search(r'MTG\.collectorSets = new Set\("([^"]*)"', data)
    collector = set(m.group(1).split(',')) if m else set()
    taken, out = {}, {}
    def claim(key, code, first_only=False):
        for cid, ill in by_set.get(code, [])[:1 if first_only else None]:
            if taken.get(ill, key) != key:
                continue
            taken[ill] = key
            out[key] = (code, cid, ill)
            return
    for code in reserved:
        claim('set:' + code, code, True)
    for x in sold:
        if 'set:' + x['code'] not in out:
            claim('set:' + x['code'], x['code'])
    for x in sold:
        if x['code'] in collector:
            claim('set:' + x['code'] + ':collector', x['code'])
    return out


def hand_focus():
    """The focus chosen by hand in tools/packart.js, already in the data file as MTG.artFocus."""
    m = re.search(r'MTG\.artFocus = (\{.*?\});', DATA.read_text(encoding='utf-8'))
    return json.loads(m.group(1)) if m else {}


def picture(cid):
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f'{cid}.jpg'
    if not f.exists() or f.stat().st_size == 0:
        url = f'https://cards.scryfall.io/art_crop/front/{cid[0]}/{cid[1]}/{cid}.jpg'
        # curl rather than urllib: a Python whose certificate store has gone stale cannot reach Scryfall at all
        for tries in range(3):
            r = subprocess.run(['curl', '-s', '-f', '--max-time', '30', '-A', HEADERS['User-Agent'], '-o', str(f), url])
            if r.returncode == 0 and f.exists() and f.stat().st_size > 0:
                break
            if tries == 2:
                print(f'  could not fetch {cid} (curl {r.returncode})', flush=True)
                return None
            time.sleep(1.5)
        time.sleep(0.05)
    try:
        return Image.open(f).convert('RGB')
    except Exception:
        return None


def pixels(img):
    """An image's pixels as a flat list (get_flattened_data where Pillow has it)."""
    get = getattr(img, 'get_flattened_data', None)
    return list(get() if get else img.getdata())


def normalised(vals):
    lo, hi = min(vals), max(vals)
    return [(v - lo) / (hi - lo) if hi > lo else 0.0 for v in vals]


def focus_of(img):
    """[across, down] in percent: the centre of the pack-shaped window with the most in it."""
    w, h = SMALL
    small = img.resize(SMALL, Image.LANCZOS)
    blur = small.filter(ImageFilter.GaussianBlur(1.2)).convert('YCbCr')
    px = pixels(blur)
    n = len(px)
    mean = [sum(p[k] for p in px) / n for k in range(3)]
    # colour that stands out from the picture's own; chroma counts double, so a face or a flower beats a bright sky
    stand = normalised([((p[0] - mean[0]) ** 2) * 0.5 + ((p[1] - mean[1]) ** 2 + (p[2] - mean[2]) ** 2) * 2 for p in px])
    edges = small.convert('L').filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(2))
    detail = normalised(pixels(edges))
    sal = []
    for i in range(n):
        x, y = (i % w) / (w - 1), (i // w) / (h - 1)
        # a picture's subject seldom sits at its very edge, and the bottom strip is often ground
        bias = 1 - 0.35 * ((x - 0.5) ** 2 + (y - 0.45) ** 2) * 2
        sal.append((0.6 * stand[i] + 0.4 * detail[i]) * bias)
    cols = [sum(sal[y * w + x] for y in range(h)) for x in range(w)]
    # a picture narrower than a pack (rare) shows whole across
    win = min(w, max(1, round(w * PACK / (img.width / img.height))))
    best, at = -1, 0
    for x0 in range(0, w - win + 1):
        s = sum(cols[x0:x0 + win])
        if s > best:
            best, at = s, x0
    fx = (at + win / 2) / w
    # down: where the weight sits within that window
    tot = sum(sal[y * w + x] for y in range(h) for x in range(at, at + win)) or 1
    fy = sum((y + 0.5) / h * sal[y * w + x] for y in range(h) for x in range(at, at + win)) / tot
    return [round(fx * 100), round(fy * 100)]


def pack_crop(img, f, height=206):
    """The picture as a pack shows it: scaled to the pack's height, the part around the focus (artPosition in src/10d-ui-store.js)."""
    scale = height / img.height
    big = img.resize((round(img.width * scale), height), Image.LANCZOS)
    bw = round(height * PACK)
    seen = bw / big.width
    p = 0.5 if seen >= 1 else max(0.0, min(1.0, (f[0] / 100 - seen / 2) / (1 - seen)))
    x0 = round(p * (big.width - bw))
    return big.crop((x0, 0, x0 + bw, height))


def sheets(rows, outdir):
    outdir = pathlib.Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 13)
    except OSError:
        font = ImageFont.load_default()
    per, cols = 48, 8
    for k in range(0, len(rows), per):
        chunk = rows[k:k + per]
        tw, th = round(206 * PACK), 206
        sheet = Image.new('RGB', (cols * (tw + 8) + 8, math.ceil(len(chunk) / cols) * (th + 26) + 8), (20, 22, 28))
        d = ImageDraw.Draw(sheet)
        for j, (label, img, f) in enumerate(chunk):
            x, y = 8 + (j % cols) * (tw + 8), 8 + (j // cols) * (th + 26)
            sheet.paste(pack_crop(img, f, th), (x, y))
            d.text((x, y + th + 4), label, fill=(240, 220, 150), font=font)
        name = outdir / f'packs-{k // per + 1}.png'
        sheet.save(name)
        print('wrote', name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet', help='draw contact sheets of every pack on sale, as it will look, into this folder')
    a = ap.parse_args()
    hand = hand_focus()
    sold = sold_sets()
    final = assignment(sold)
    print(f'{len(sold)} sets on sale; {len(final)} packs given a picture', flush=True)
    # the pictures packs wear now, and each set's first few, for when a new set shifts the claims
    todo = {ill: cid for code, cid, ill in final.values()}
    for code, rank, cid, ill in candidates():
        todo.setdefault(ill, cid)
    focus, imgs = {}, {}
    for n, (ill, cid) in enumerate(sorted(todo.items())):
        img = picture(cid)
        if img is None:
            continue
        imgs[ill] = img
        focus[ill] = OVERRIDE.get(ill) or hand.get(ill) or focus_of(img)
        if (n + 1) % 100 == 0:
            print(f'  {n + 1}/{len(todo)}', flush=True)
    # the hand-chosen focus is in the data file already; only what was worked out goes here
    computed = {k: v for k, v in sorted(focus.items()) if k not in hand}
    body = ',\n'.join(f'    "{k}": [{v[0]}, {v[1]}]' for k, v in computed.items())
    OUT.write_text(f'''/* ============================================================
   10d1-packfocus.js - where the subject is in each pack's picture

   Written by tools/packfocus.py from the pictures themselves (and by eye
   where that went wrong): by illustration, the first 8 hex digits of its
   id, [percent across, percent down]. A pack centres its subject
   (artPosition in src/10d-ui-store.js); a focus chosen by hand in
   src/10d0-packart.js wins over these.
   ============================================================ */
'use strict';
(function (MTG) {{
  MTG.artFocus = Object.assign({{
{body}
  }}, MTG.artFocus || {{}});
}})(window.MTG);
''', encoding='utf-8', newline='\n')
    print(f'wrote {OUT} ({len(computed)} pictures)')
    if a.sheet:
        names = {x['code']: x['name'] for x in sold}
        rows = []
        for x in sold:
            got = final.get('set:' + x['code'])
            if got and got[2] in imgs:
                rows.append((f"{x['code']} {got[2]} {focus[got[2]][0]}", imgs[got[2]], focus[got[2]]))
        sheets(rows, a.sheet)
        (pathlib.Path(a.sheet) / 'packs.json').write_text(json.dumps(
            {x['code']: {'name': names[x['code']], 'type': x['set_type'], 'released': x['released_at'],
                         'ill': (final.get('set:' + x['code']) or [None, None, None])[2],
                         'id': (final.get('set:' + x['code']) or [None, None, None])[1]} for x in sold}, indent=1), encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
