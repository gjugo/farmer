"""Build the farmer's spritesheet from Ludo Directional Sprites renders.

Usage: python fit_character.py FRAMES_DIR OUT_DIR HEIGHT ANIM:DIR=SOURCE ... [--fill=ANIM]

Each ANIM:DIR=SOURCE says where an animation and direction (se, sw, ne, nw) comes from, relative to FRAMES_DIR:
- a folder of frame_NNN.png from the web app's Animation Pack export (Individual Frames). Ludo's pack already gives
  these one scale and one ground line, so they share the scale of the first --fill se frame, whose height is HEIGHT
  2x px, and its ground point (frame centre, above the toes).
- a .webp/.png sheet of 4x4 frames from createDirectionalSprites. Ludo frames every render to fit its own motion,
  so each animation is scaled until the hat (the largest straw-coloured blob, measured in the SE and SW views, where
  it is seen whole) is as wide as in the pack, and each sheet keeps its feet on its own ground line.
Frames are picked evenly from each Ludo loop to the count the game plays (the manifest's `frames`), scaled, and placed
on the game's grid with the feet on the manifest anchor; a soft shadow is baked under the feet. Animations without a
source use the --fill animation's frames. Writes {2x,1x}_farmer.png and prints the manifest values.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

MANIFEST = 'public/assets/farm/manifest.json'
FW, FH, AX, AY = 164, 156, 82, 126  # the game's 2x frame and ground point
FEET = 8  # 2x px from the ground point down to the lowest toe

frames_dir, out_dir, height = sys.argv[1], sys.argv[2], float(sys.argv[3])
fill = next((a.split('=')[1] for a in sys.argv if a.startswith('--fill=')), 'idle')
sheets = {}
for arg in sys.argv[4:]:
    if not arg.startswith('--'):
        key, source = arg.split('=')
        sheets[tuple(key.split(':'))] = os.path.join(frames_dir, source)

def frames(source):
    if os.path.isdir(source):
        return [Image.open(os.path.join(source, f)).convert('RGBA') for f in sorted(os.listdir(source)) if f.endswith('.png')]
    sheet = Image.open(source).convert('RGBA')
    w, h = sheet.width // 4, sheet.height // 4
    return [sheet.crop(((i % 4) * w, (i // 4) * h, (i % 4 + 1) * w, (i // 4 + 1) * h)) for i in range(16)]

def hat_width(im):
    """Width in px of the largest straw-coloured blob: the hat brim, whatever the pose."""
    a = np.asarray(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    straw = ((a[..., 3] > 128) & (r > 170) & (g > 110) & (g < 200) & (b < 120) & (r - b > 90))[::2, ::2]
    seen = np.zeros_like(straw)
    best = (0, 0)
    for y, x in zip(*np.nonzero(straw)):
        if seen[y, x]:
            continue
        queue, size, x0, x1 = deque([(y, x)]), 0, x, x
        seen[y, x] = True
        while queue:
            cy, cx = queue.popleft()
            size += 1
            x0, x1 = min(x0, cx), max(x1, cx)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < straw.shape[0] and 0 <= nx < straw.shape[1] and straw[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        best = max(best, (size, (x1 - x0 + 1) * 2))
    return best[1]

def feet(im):
    """Bottom row of the character and the centre of what touches it."""
    solid = np.asarray(im)[..., 3] > 128
    bottom = np.nonzero(solid.any(1))[0][-1]
    xs = np.nonzero(solid[bottom - im.height // 30:bottom + 1].any(0))[0]
    return bottom, (xs[0] + xs[-1]) / 2

def front_hat(anim):
    return np.percentile([hat_width(f) for d in ('se', 'sw') for f in frames(sheets[(anim, d)])], 90)

# The pack's scale and ground, from the first idle frame: Ludo's pack shares one ground line and size.
first = frames(sheets[(fill, 'se')])[0]
top, bottom = first.getbbox()[1], first.getbbox()[3]
pack_scale = height / (bottom - top)
pack_ground = (first.width / 2, bottom - FEET / pack_scale)  # raw ground point: frame centre (pack Snap H), above the toes
hat = front_hat(fill) * pack_scale  # the hat's width in 2x px

placement = {}  # (anim, dir) -> (scale, raw ground point)
for (anim, d), source in sheets.items():
    if os.path.isdir(source):
        placement[(anim, d)] = (pack_scale, pack_ground)
    else:
        scale = hat / front_hat(anim)
        spots = [feet(f) for f in frames(source)]
        ground = (np.median([x for _, x in spots]), np.median([y for y, _ in spots]) - FEET / scale)
        placement[(anim, d)] = (scale, ground)

asset = next(a for a in json.load(open(MANIFEST))['assets'] if a['name'] == 'farmer')
cols, rows = asset['res']['2x']['columns'], asset['res']['2x']['rows']
sheet = Image.new('RGBA', (cols * FW, rows * FH))

shadow = Image.new('L', (FW, FH), 0)
ImageDraw.Draw(shadow).ellipse((AX - 22, AY - 9, AX + 22, AY + 9), fill=80)
shadow = shadow.filter(ImageFilter.GaussianBlur(3))
shadow_rgba = Image.new('RGBA', (FW, FH), (20, 30, 10, 0))
shadow_rgba.putalpha(shadow)

for an in asset['animations']:
    key = (an['anim'], an['dir']) if (an['anim'], an['dir']) in sheets else (fill, an['dir'])
    loop = frames(sheets[key])
    scale, ground = placement[key]
    n = an['frames']
    for i in range(n):
        im = loop[round(i * len(loop) / n) % len(loop)]
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
        cell = shadow_rgba.copy()
        cell.alpha_composite(im, (round(AX - ground[0] * scale), round(AY - ground[1] * scale)))
        k = an['start'] + i
        sheet.paste(cell, ((k % cols) * FW, (k // cols) * FH))

sheet.save(f'{out_dir}/2x_farmer.png', optimize=True)
sheet.resize((sheet.width // 2, sheet.height // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x_farmer.png', optimize=True)
for anim in sorted({a for a, _ in sheets}):
    print(f'{anim}: scale {placement[(anim, "se")][0]:.4f}')
print(f'2x frame {FW}x{FH} anchor {AX},{AY}; 1x frame {FW // 2}x{FH // 2} anchor {AX / 2:g},{AY / 2:g}')
