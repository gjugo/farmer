"""Build an animal's spritesheet (chicken, cow, sheep) from Ludo Directional Sprites renders.

Usage: python fit_animal.py NAME SHEETS_DIR OUT_DIR HEIGHT ANIM:DIR=SHEET[@GRID][!][~] ... [--frames=ANIM:N,...]
       [--fps=ANIM:N,...] [--shadow=RX,RY] [--grid=COLS,ROWS,COUNT]

Each ANIM:DIR=SHEET[@COLS,ROWS,COUNT] says where an animation (idle, walk, eat) and facing (se, sw, ne, nw) comes
from: a sheet in SHEETS_DIR (createDirectionalSprites, or animateSprite on a createDirectionalStills image), a grid of
COLS x ROWS frames of which the first COUNT are used (default --grid, 4,4,16).
A trailing ! mirrors the sheet, so an SE render can stand in for SW and an NE one for NW; a trailing ~ plays it
forward then back, for a one-way clip (a head lowered to graze) that has to loop.

Ludo frames every render to its own motion. So each animation is scaled until its standing pose (the tallest SE frame)
is HEIGHT 2x px tall, and each sheet's ground point is the middle of the standing pose's feet (the ground under the
animal's centre). Specks apart from the animal are dropped. Frames are picked
evenly from each loop to --frames per animation, placed on a shared frame with the ground point on the anchor, and a
soft oval shadow (radii RX, RY at 2x) is baked under it. Writes {2x,1x}_NAME.png and sets NAME's manifest entry: frame
size, grid, anchor, origin, the animations (rows = anim x direction), and drops the separate _shadow sheet.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from scipy import ndimage

PACK = 'public/assets/farm'
ANIMS, DIRS = ('idle', 'walk', 'eat'), ('se', 'sw', 'ne', 'nw')
PAD = 4  # 2x px of empty border around the widest pose

name, sheets_dir, out_dir, height = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
opts = {a[2:].split('=')[0]: a.split('=', 1)[1] for a in sys.argv[5:] if a.startswith('--')}


def pairs(opt):
    return {k: float(v) for k, v in (p.split(':') for p in opts[opt].split(','))} if opt in opts else {}

counts = {a: 8 for a in ANIMS} | {k: int(v) for k, v in pairs('frames').items()}
fps = {'idle': 6, 'walk': 10, 'eat': 6} | pairs('fps')
srx, sry = (float(v) for v in opts.get('shadow', '20,9').split(','))
gc, gr, gn = (int(v) for v in opts.get('grid', '4,4,16').split(','))
sources = {}
for arg in sys.argv[5:]:
    if not arg.startswith('--'):
        key, sheet = arg.split('=')
        path, _, grid = sheet.rstrip('!~').partition('@')
        grid = tuple(int(v) for v in grid.split(',')) if grid else (gc, gr, gn)
        sources[tuple(key.split(':'))] = (os.path.join(sheets_dir, path), grid, '!' in sheet, '~' in sheet)
missing = [f'{a}:{d}' for a in ANIMS for d in DIRS if (a, d) not in sources]
if missing:
    sys.exit(f'no sheet for {", ".join(missing)}')

def frames(source, grid, mirror, pingpong):
    cols, rows, count = grid
    sheet = Image.open(source).convert('RGBA')
    w, h = sheet.width // cols, sheet.height // rows
    out = [sheet.crop(((i % cols) * w, (i // cols) * h, (i % cols + 1) * w, (i // cols + 1) * h)) for i in range(count)]
    if pingpong:
        out += out[-2:0:-1]
    return [ImageOps.mirror(f) for f in out] if mirror else out

def clean(im):
    """Drops specks apart from the animal (Forge sometimes scatters grain by a pecking beak)."""
    a = np.asarray(im).copy()
    labels, n = ndimage.label(a[..., 3] > 128)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(labels), labels, range(1, n + 1))
        keep = np.isin(labels, 1 + np.nonzero(sizes >= sizes.max() * 0.02)[0])
        a[..., 3] *= ndimage.binary_dilation(keep, iterations=3)
    return Image.fromarray(a)

def rest(loop):
    """The standing pose's height and ground point. The standing pose is the tallest frame (Forge trims its loop, so it
    need not be the first); the ground point is the middle of the feet, from the lowest pixel of each leg column."""
    solid = max((np.asarray(f)[..., 3] > 128 for f in loop), key=lambda s: np.ptp(np.nonzero(s.any(1))[0]))
    ys = np.nonzero(solid.any(1))[0]
    top, bottom = ys[0], ys[-1]
    cols = np.nonzero(solid.any(0))[0]
    lows = np.array([np.nonzero(solid[:, x])[0][-1] for x in cols])
    legs = lows > top + 0.8 * (bottom - top)
    return bottom - top + 1, (cols[legs].min() + cols[legs].max()) / 2, (lows[legs].min() + lows[legs].max()) / 2

# Scale per animation (from its SE standing pose), ground point per sheet; then every placed frame.
loops = {k: [clean(f) for f in frames(*v)] for k, v in sources.items()}
scale = {a: height / rest(loops[(a, 'se')])[0] for a in ANIMS}
placed = {}  # (anim, dir) -> [(image scaled to 2x, offset of its top-left from the ground point)]
for (a, d), loop in loops.items():
    _, gx, gy = rest(loop)
    s = scale[a]
    picks = [loop[round(i * len(loop) / counts[a]) % len(loop)] for i in range(counts[a])]
    placed[(a, d)] = [
        (f.resize((round(f.width * s), round(f.height * s)), Image.Resampling.LANCZOS), (-gx * s, -gy * s)) for f in picks
    ]

# Shared frame: the extent of every pose around the ground point, plus the shadow, kept even for the 1x half.
left = right = top = bottom = 0.0
for ims in placed.values():
    for im, (ox, oy) in ims:
        box = im.getbbox()
        if box:
            left, right = min(left, ox + box[0]), max(right, ox + box[2])
            top, bottom = min(top, oy + box[1]), max(bottom, oy + box[3])
half = int(np.ceil(max(-left, right, srx + 3))) + PAD
fw, ax = 2 * half, half
ay = int(np.ceil(-top)) + PAD
fh = ay + int(np.ceil(max(bottom, sry + 3))) + PAD
fh += fh % 2

shadow = Image.new('L', (fw, fh), 0)
ImageDraw.Draw(shadow).ellipse((ax - srx, ay - sry, ax + srx, ay + sry), fill=80)
shadow = shadow.filter(ImageFilter.GaussianBlur(3))
cell_base = Image.new('RGBA', (fw, fh), (20, 30, 10, 0))
cell_base.putalpha(shadow)

cols = max(counts.values())
rows = len(ANIMS) * len(DIRS)
if cols * fw > 4096 or rows * fh > 4096:
    sys.exit(f'sheet {cols * fw}x{rows * fh} is over 4096 px')
sheet = Image.new('RGBA', (cols * fw, rows * fh))
animations = []
for r, (a, d) in enumerate((a, d) for a in ANIMS for d in DIRS):
    for i, (im, (ox, oy)) in enumerate(placed[(a, d)]):
        cell = cell_base.copy()
        cell.alpha_composite(im, (round(ax + ox), round(ay + oy)))
        sheet.paste(cell, (i * fw, r * fh))
    n = counts[a]
    animations.append({'key': f'{name}_{a}_{d}', 'anim': a, 'dir': d, 'start': r * cols, 'end': r * cols + n - 1,
                       'frames': n, 'fps': fps[a], 'repeat': -1})

os.makedirs(out_dir, exist_ok=True)
sheet.save(f'{out_dir}/2x_{name}.png', optimize=True)
sheet.resize((sheet.width // 2, sheet.height // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x_{name}.png', optimize=True)

path = f'{PACK}/manifest.json'
text = open(path).read()
manifest = json.loads(text)
asset = next(x for x in manifest['assets'] if x['name'] == name)
for res, k in (('2x', 1), ('1x', 2)):
    w, h, x, y = fw // k, fh // k, ax / k, ay / k
    entry = asset['res'][res]
    entry.update(frameWidth=w, frameHeight=h, columns=cols, rows=rows, anchor=[float(x), float(y)],
                 origin=[round(x / w, 5), round(y / h, 5)])
    entry.pop('shadow', None)
asset['animations'] = animations
if 'Ludo.ai' not in asset['notes']:
    asset['notes'] += ' (Ludo.ai Directional Sprites, cel-shaded; shadow baked in)'
open(path, 'w').write(json.dumps(manifest, indent=1) + ('\n' if text.endswith('\n') else ''))
for a in ANIMS:
    print(f'{a}: scale {scale[a]:.4f}, {counts[a]} frames at {fps[a]:g} fps')
print(f'2x frame {fw}x{fh} anchor {ax},{ay}; sheet {cols * fw}x{rows * fh}. Copy {out_dir}/{{2x,1x}}_{name}.png to '
      f'{PACK}/{{2x,1x}}/animals/{name}.png and delete the _shadow sheets.')
