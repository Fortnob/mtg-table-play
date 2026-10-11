"""Where the eyes are in the paintings decks are shown by, so a strip of one shows the face.

A deck in a list (the quick game's deck picker) shows its painting as a
wide, short strip, and the strip should cross the face at the eyes when
there is one. Faces are found here, once, with YuNet (OpenCV's face
detector, MIT licence: opencv_zoo/models/face_detection_yunet), which
reads painted faces far better than anything light enough to run on a
phone; the answers go into the page as a table.

The paintings looked at are the ones a deck is likeliest to wear: every
legendary creature and planeswalker (the commanders, and the cards a deck
is usually named for), every creature among the most played by EDHREC's
rank, every rare and mythic creature of the last few years (a Standard
deck's key cards), and the starter decks' covers (src/20-starters.js). Written to
src/10k-facefocus.js as MTG.faceAt, by illustration (the first 8 hex
digits of its id): [percent across, percent down] of the point between
the eyes. A painting not in it, or with no face found, keeps its usual
framing.

    python tools/facefocus.py                  # write src/10k-facefocus.js
    python tools/facefocus.py --sheet FILE     # also draw a contact sheet of a sample, to check by eye

Needs opencv-python-headless and numpy. The model and the pictures are
kept in tools/.cache/faces between runs (gitignored).
"""
import argparse, concurrent.futures, gzip, json, os, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BULK = ROOT / 'tools' / 'oracle-cards.jsonl.gz'
STARTERS = ROOT / 'src' / '20-starters.js'
OUT = ROOT / 'src' / '10k-facefocus.js'
CACHE = ROOT / 'tools' / '.cache' / 'faces'
MODEL_URL = ('https://media.githubusercontent.com/media/opencv/opencv_zoo/f12e12798e8314f7c074a6656816c048dcc95b7a/'
             'models/face_detection_yunet/face_detection_yunet_2023mar.onnx')
UA = 'mtg-table-facefocus/1.0'
TOP = 5000          # creatures this popular (EDHREC rank) are looked at as well as every legend
RECENT = '2023-01-01'   # and every rare or mythic creature printed since: what a Standard deck is shown by
SURE = 0.75         # below this a "face" was, on the contact sheets, as often a rock or a claw as a face

# Corrections made by eye: illustration (first 8 hex digits) -> [across, down], or None for no face.
# The starter decks' covers whose face YuNet does not see (a beast's, a bird's, a goblin's), set from a gridded sheet
OVERRIDE = {
    'e2e2b8e2': [49, 21],   # Regal Caracal: the big cat in the middle
    '36ed71da': [31, 46],   # Searslicer Goblin
    '6a411bb4': [71, 29],   # Empyrean Eagle
    'e504c86a': [47, 43],   # Dreadwing Scavenger
    'b2ff8ad8': [16, 35],   # Regal Imperiosaur
    '8eb679eb': [30, 33],   # Axebane Ferox
    'f71977f2': [62, 26],   # Ambling Stormshell
    'eb2bab80': [55, 8],    # Master of Etherium
    '989ebe5c': [51, 17],   # Drogskol Captain
    'f0e6096a': [44, 28],   # Tarmogoyf
    '95d6abba': [40, 32],   # Primeval Titan: the face in the trees
    '880d99c2': [48, 78],   # Bitterblossom: the sleeper
    '58884d99': [55, 70],   # Lightning Bolt (Thor)
    '621fddfb': [54, 11],   # Lightning Helix
    # and where YuNet chose a face that is not the subject's
    'e4d909a0': [48, 30],   # Xanathar: the Beholder's one great eye, not a face in the crowd below
    '871ce166': [41, 21],   # the crocodile in the hat: its one eye showing, under the brim, not the man in the water
}


def fetch(url, path):
    if path.exists() and path.stat().st_size > 0:
        return True
    tmp = path.with_suffix('.part')
    r = subprocess.run(['curl', '-sSLf', '-A', UA, '-o', str(tmp), url], capture_output=True)
    if r.returncode or not tmp.exists() or tmp.stat().st_size == 0:
        if tmp.exists():
            tmp.unlink()
        return False
    tmp.replace(path)
    return True


def wanted():
    """The paintings to look at: {illustration id: art crop url}."""
    covers = set(re.findall(r"cover: '((?:[^'\\]|\\.)*)'", STARTERS.read_text(encoding='utf-8')))
    covers = {c.replace("\\'", "'") for c in covers}
    out = {}
    with gzip.open(BULK, 'rt', encoding='utf-8') as f:
        for line in f:
            c = json.loads(line)
            if c.get('layout') in ('token', 'double_faced_token', 'emblem', 'art_series'):
                continue
            face = (c.get('card_faces') or [c])[0]
            tl = face.get('type_line') or c.get('type_line') or ''
            iu = c.get('image_uris') or face.get('image_uris') or {}
            ill = c.get('illustration_id') or face.get('illustration_id')
            if not ill or not iu.get('art_crop'):
                continue
            rank = c.get('edhrec_rank') or 10 ** 9
            name = c.get('name', '')
            recent = c.get('rarity') in ('rare', 'mythic') and (c.get('released_at') or '') >= RECENT
            if (('Legendary' in tl and 'Creature' in tl) or 'Planeswalker' in tl or ('Creature' in tl and (rank <= TOP or recent))
                    or name in covers or name.split(' // ')[0] in covers):
                out[ill] = iu['art_crop']
    return out


def detector():
    import cv2
    model = CACHE / 'yunet.onnx'
    if not fetch(MODEL_URL, model):
        sys.exit('could not fetch the YuNet model')
    return cv2.FaceDetectorYN.create(str(model), '', (320, 320), 0.3, 0.3, 50)


def eyes(det, path):
    """The subject's face: the biggest and most central of the sure ones. (x, y, score, box) or None."""
    import cv2
    img = cv2.imread(str(path))
    if img is None:
        return None
    h, w = img.shape[:2]
    best = None
    for scale in (1.0, 1.5):        # small faces show better a little larger
        im = img if scale == 1 else cv2.resize(img, (int(w * scale), int(h * scale)))
        det.setInputSize((im.shape[1], im.shape[0]))
        _, faces = det.detect(im)
        for fc in (faces if faces is not None else []):
            fc = fc.copy()
            fc[:14] /= scale
            score, size = float(fc[14]), float(fc[2]) / w
            if score < SURE:
                continue
            # the subject is the big face near the middle (a little above it, where heads are), not the surest:
            # a small face out towards an edge is a bystander, and does not count at all
            cx, cy = (fc[0] + fc[2] / 2) / w, (fc[1] + fc[3] / 2) / h
            off = ((cx - 0.5) ** 2 + ((cy - 0.4) / 0.8) ** 2) ** 0.5
            if size < 0.06 and off > 0.45:
                continue
            worth = score * (0.4 + 3 * min(size, 0.3)) * max(0.15, 1 - 1.2 * off)
            if best is None or worth > best[0]:
                ex, ey = (fc[4] + fc[6]) / 2 / w, (fc[5] + fc[7]) / 2 / h
                best = (worth, ex, ey, score, fc[:4] / [w, h, w, h])
    return best and best[1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', help='draw a contact sheet of a sample to this file')
    a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    want = wanted()
    print(len(want), 'paintings')
    paths = {ill: CACHE / (ill + '.jpg') for ill in want}
    todo = [ill for ill in want if not (paths[ill].exists() and paths[ill].stat().st_size)]
    print(len(todo), 'to fetch')
    done = 0
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        for _ in pool.map(lambda ill: fetch(want[ill], paths[ill]), todo):
            done += 1
            if done % 250 == 0:
                print(' ', done, 'fetched', flush=True)
    det = detector()
    table, found = {}, []
    for i, ill in enumerate(sorted(want)):
        r = eyes(det, paths[ill])
        if r:
            table[ill[:8]] = [round(r[0] * 100), round(r[1] * 100)]
            found.append((ill, r))
        if (i + 1) % 500 == 0:
            print(' ', i + 1, 'looked at,', len(table), 'faces', flush=True)
    for k, v in OVERRIDE.items():
        if v is None:
            table.pop(k, None)
        else:
            table[k] = v
    print(len(table), 'faces in', len(want), 'paintings')
    body = ',\n'.join('    "%s":[%d,%d]' % (k, v[0], v[1]) for k, v in sorted(table.items()))
    OUT.write_text("""/* ============================================================
   10k-facefocus.js - where the eyes are in the paintings decks wear

   Written by tools/facefocus.py (YuNet, run over every legend's,
   planeswalker's and much-played creature's painting, and the starter
   decks' covers): by illustration, the first 8 hex digits of its id,
   [percent across, percent down] of the point between the eyes. UI.focusFace
   (src/10j-artfocus.js) frames a strip of a painting on it.
   ============================================================ */
'use strict';
(function (MTG) {
  MTG.faceAt = {
%s
  };
})(window.MTG);
""" % body, encoding='utf-8', newline='\n')
    print('wrote', OUT)
    if a.sheet:
        import cv2, numpy as np, random
        random.seed(1)
        tiles = []
        for ill, r in random.sample(found, min(48, len(found))):
            img = cv2.imread(str(paths[ill]))
            h, w = img.shape[:2]
            bx = r[3]
            cv2.rectangle(img, (int(bx[0] * w), int(bx[1] * h)), (int((bx[0] + bx[2]) * w), int((bx[1] + bx[3]) * h)), (0, 255, 0), 2)
            cv2.circle(img, (int(r[0] * w), int(r[1] * h)), 5, (0, 0, 255), -1)
            img = cv2.resize(img, (240, int(240 * h / w)))
            cv2.putText(img, '%s %.2f' % (ill[:8], r[2]), (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
            tiles.append(img)
        th = max(t.shape[0] for t in tiles)
        tiles = [cv2.copyMakeBorder(t, 0, th - t.shape[0], 0, 0, cv2.BORDER_CONSTANT) for t in tiles]
        rows = [np.hstack(tiles[i:i + 8] + [np.zeros_like(tiles[0])] * (8 - len(tiles[i:i + 8]))) for i in range(0, len(tiles), 8)]
        cv2.imwrite(a.sheet, np.vstack(rows))
        print('sheet', a.sheet)


if __name__ == '__main__':
    main()
