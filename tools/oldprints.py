"""Printings whose rules text plays differently from the card's text today.

    python tools/oldprints.py            report
    python tools/oldprints.py --write    ...and write src/02d-oldprints.js

Some cards were errata'd in a way that changes how they play: Vesuvan
Doppelganger's copy became optional, "target creature or player" became
"any target", Living Artifact counts life lost rather than damage. A
printing with the old words would have a player play it wrong, so the app
shows such a printing as the card's current printing instead (the same card
in the same set, rarity and number; only its picture is the newer one), and
the art picker leaves it out.

tools/oldprints.json lists those printings: [set, collector number, card,
why], with the set as MTGJSON names it. It was made by comparing each
printing's original text (MTGJSON) with the card's Oracle text, undoing the
rewordings that play the same, and reading what was left one card at a
time. A card none of whose printings has the current text keeps them all:
there is nothing better to show.

Each listed printing is matched to Scryfall's (tools/default-cards.jsonl.gz,
python tools/fetch-bulk.py --default) and given its card's best current
printing: English, paper (an online-only printing is never shown instead),
the ordinary frame and border, not a promo or special treatment, newest first.
"""
import gzip, json, os, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'tools', 'oldprints.json')
BULK = os.path.join(ROOT, 'tools', 'default-cards.jsonl.gz')
OUT = os.path.join(ROOT, 'src', '02d-oldprints.js')

ODD_SETS = {'promo', 'memorabilia', 'token', 'alchemy', 'funny', 'box', 'masterpiece', 'treasure_chest', 'minigame', 'vanguard', 'planechase', 'archenemy'}
REPRINT_LISTS = {'plst', 'plist', 'mb1', 'mb2', 'fmb1', 'sld', 'slc', 'sld2', 'pz1', 'pz2'}
SPECIAL = ('showcase', 'extendedart', 'inverted', 'etched', 'fullart', 'textless', 'borderless')


def prefer(c):
    """How much a printing is the one to show for its card: higher is better, ties go to the newest."""
    fe = c.get('frame_effects') or []
    s = 0
    if 'paper' in (c.get('games') or []): s += 1 << 9
    if not c.get('variation'): s += 1 << 8
    if not c.get('promo'): s += 1 << 7
    if c.get('set_type') not in ODD_SETS and c.get('set') not in REPRINT_LISTS: s += 1 << 6
    if c.get('border_color') in ('black', 'white', None): s += 1 << 5
    if not any(x in SPECIAL for x in fe): s += 1 << 4
    if not c.get('full_art') and not c.get('textless'): s += 1 << 3
    if not c.get('oversized'): s += 1 << 2
    if c.get('highres_image'): s += 1 << 1
    return (s, c.get('released_at') or '')


def main():
    flagged = json.load(open(LIST, encoding='utf-8'))
    old = {(str(s).lower(), str(n).lower()) for s, n, _name, _why in flagged}
    by_oracle = defaultdict(list)
    seen = set()
    with gzip.open(BULK, 'rt', encoding='utf-8') as f:
        for line in f:
            c = json.loads(line)
            if c.get('lang') != 'en' or c.get('layout') in ('art_series', 'token', 'double_faced_token', 'emblem'):
                continue
            if not c.get('oracle_id') and c.get('card_faces'):
                c['oracle_id'] = c['card_faces'][0].get('oracle_id')
            key = (c['set'], str(c['collector_number']).lower())
            if key in old: seen.add(key)
            by_oracle[c.get('oracle_id')].append(c)

    swap = defaultdict(list)      # replacement id -> old printings
    kept = 0
    for oracle, prints in by_oracle.items():
        olds = [c for c in prints if (c['set'], str(c['collector_number']).lower()) in old]
        if not olds:
            continue
        # an online-only printing may be swapped out, never shown instead
        current = [c for c in prints if (c['set'], str(c['collector_number']).lower()) not in old and not c.get('digital')]
        if not current:
            kept += len(olds)
            continue
        best = max(current, key=prefer)
        for c in olds:
            swap[best['id']].append('%s:%s' % (c['set'], str(c['collector_number']).lower()))

    missing = sorted(old - seen)
    n = sum(len(v) for v in swap.values())
    print('listed printings: %d; found at Scryfall: %d; shown as a current printing: %d (%d cards); kept, having no current printing: %d'
          % (len(old), len(seen), n, len(swap), kept))
    if missing:
        print('not found at Scryfall (%d), e.g. %s' % (len(missing), ', '.join(':'.join(k) for k in missing[:12])))

    if '--write' in sys.argv:
        rows = ';'.join('%s=%s' % (rid, ','.join(sorted(v))) for rid, v in sorted(swap.items()))
        js = """/* ============================================================
   02d-oldprints.js - printings whose rules text plays differently
   from the card's text today, and the printing shown instead.
   Written by tools/oldprints.py from tools/oldprints.json; do not
   edit by hand.

   A card errata'd so that it plays differently (Vesuvan Doppelganger's
   copy made optional, "target creature or player" now "any target")
   still has its old words on its old printings. Such a printing keeps
   everything that makes it what it is (its set, number and rarity, so
   packs and collections are unchanged) but is shown as the card's
   current printing, and the art picker leaves it out.
   ============================================================ */
'use strict';
(function (MTG) {
  // replacement printing id = the printings (set:collector number) shown as it
  const DATA = %s;
  let swap = null;
  const table = () => {
    if (swap) return swap;
    swap = new Map();
    for (const row of DATA.split(';')) {
      const at = row.indexOf('=');
      if (at < 0) continue;
      const id = row.slice(0, at);
      for (const k of row.slice(at + 1).split(',')) swap.set(k, id);
    }
    return swap;
  };
  const keyOf = (card) => (card && card.set && card.collector_number != null)
    ? String(card.set).toLowerCase() + ':' + String(card.collector_number).toLowerCase() : null;

  MTG.oldPrints = {
    /** The id of the printing to show instead of this one, or null when its words are today's. */
    swapId(card) {
      const k = keyOf(card);
      return k ? (table().get(k) || null) : null;
    },
    /** True for a printing whose words play differently from the card's (and that has a current printing to show). */
    isOld(card) { return !!this.swapId(card); },
    get size() { return table().size; },
  };
})(window.MTG);
""" % json.dumps(rows)
        open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
        print('wrote', os.path.relpath(OUT, ROOT), '(%d bytes)' % len(js.encode('utf-8')))


if __name__ == '__main__':
    main()
