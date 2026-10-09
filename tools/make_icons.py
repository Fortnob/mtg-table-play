"""Draw the home-screen icons into src/icons/: the gold M of the top bar on
the table's dark felt, full bleed, so a phone's own mask (a rounded square
on iOS, a circle or squircle on Android) cuts it cleanly. The medallion
stays inside the middle 80%, the safe zone of a maskable icon, so one
drawing serves both purposes.

    python tools/make_icons.py

Needs Pillow. The PNGs are committed; run this only to change them.
"""
import math, pathlib
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'icons'
S = 1024   # drawn once, large, and scaled down

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def ramp(stops, t):
    """A colour along stops [(at, (r, g, b)), ...] at t in 0..1."""
    t = max(0.0, min(1.0, t))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if t <= b:
            return lerp(ca, cb, (t - a) / (b - a) if b > a else 0)
    return stops[-1][1]

def radial(size, centre, radius, stops):
    """A radial gradient, as an RGB image."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    cx, cy = centre
    for y in range(size):
        for x in range(size):
            px[x, y] = ramp(stops, math.hypot(x - cx, y - cy) / radius)
    return img

def font(size):
    for name in ('georgiab.ttf', 'Georgia Bold.ttf', 'DejaVuSerif-Bold.ttf'):
        for base in ('C:/Windows/Fonts/', '/Library/Fonts/', '/usr/share/fonts/truetype/dejavu/', ''):
            try:
                return ImageFont.truetype(base + name, size)
            except OSError:
                pass
    return ImageFont.load_default()

def draw():
    # the felt: dark slate, a little lighter behind the medallion
    icon = radial(S, (S * .5, S * .42), S * .78, [(0, (34, 40, 54)), (.55, (17, 20, 27)), (1, (8, 10, 14))])
    r = S * .335
    cx, cy = S / 2, S / 2
    # a soft gold glow under the medallion
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse((cx - r * 1.12, cy - r * 1.12, cx + r * 1.12, cy + r * 1.12), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(S * .045))
    icon.paste((212, 175, 71), (0, 0), glow)
    # the medallion: the top bar's gold, lit from the top left
    gold = radial(S, (cx - r * .35, cy - r * .5), r * 1.55,
                  [(0, (255, 243, 196)), (.3, (246, 220, 140)), (.65, (212, 175, 71)), (1, (138, 106, 28))])
    disc = Image.new('L', (S, S), 0)
    ImageDraw.Draw(disc).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    icon.paste(gold, (0, 0), disc)
    d = ImageDraw.Draw(icon)
    # a fine dark ring and a light inner edge, as the mark has
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(36, 26, 5), width=round(S * .008))
    d.arc((cx - r * .93, cy - r * .93, cx + r * .93, cy + r * .93), 200, 320, fill=(255, 248, 220), width=round(S * .006))
    # the M, in the mark's dark brown
    f = font(round(S * .40))
    box = d.textbbox((0, 0), 'M', font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text((cx - w / 2 - box[0], cy - h / 2 - box[1] + S * .005), 'M', font=f, fill=(36, 26, 5))
    return icon

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    big = draw()
    for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('icon-32.png', 32)):
        big.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print('wrote', OUT / name)

if __name__ == '__main__':
    main()
