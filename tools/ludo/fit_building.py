"""Fit a Ludo-generated isometric building onto the game's grid.

Usage: python fit_building.py RAW.png OUT_DIR NAME FOOT_W FOOT_H LEFT_X LEFT_Y RIGHT_X RIGHT_Y BOTTOM_X BOTTOM_Y [--mirror]

LEFT/RIGHT/BOTTOM are the pad's top-surface corners, measured on the raw image (before mirroring).
FOOT_W/FOOT_H are the footprint in the game (tiles along x / along y) after any mirroring.
Everything below the top surface's two lower edges (the soil block Ludo draws) is cut away.
Writes 2x and 1x PNGs and NAME.json (for install_prop.py), and prints the manifest anchor (the footprint's top
corner) for each.
"""
import json
import sys
import numpy as np
from PIL import Image

TILE_W2 = 256  # 2x tile width
INSET = 8      # 2x px the pad is pulled in from each side corner, like the pack's own pads

raw, out_dir, name = sys.argv[1], sys.argv[2], sys.argv[3]
fw, fh = int(sys.argv[4]), int(sys.argv[5])
lx, ly, rx, ry, bx, by = map(float, sys.argv[6:12])
mirror = "--mirror" in sys.argv
KEEP = float(next((x.split("=")[1] for x in sys.argv if x.startswith("--keep=")), 2))  # px kept below the edges (outline)

im = Image.open(raw).convert('RGBA')
w, h = im.size
if mirror:
    im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    lx, ly, rx, ry, bx = w - 1 - rx, ry, w - 1 - lx, ly, w - 1 - bx

# Cut the soil block: keep only pixels on or above the top surface's two lower edges (+2 px keeps its outline).
a = np.array(im)
ys, xs = np.mgrid[0:h, 0:w]
left_edge = ly + (xs - lx) * (by - ly) / (bx - lx)
right_edge = ry + (rx - xs) * (by - ry) / (rx - bx)
limit = np.where(xs <= bx, left_edge, right_edge) + KEEP
a[..., 3] = np.where(ys > limit, 0, a[..., 3])
im = Image.fromarray(a)

# Footprint top corner: fh half-tiles up-right of the left corner.
half = (rx - lx) / (fw + fh)  # half a tile's width, raw px
top = (lx + fh * half, ly - fh * half / 2)

scale = ((fw + fh) * TILE_W2 / 2 - 2 * INSET) / (rx - lx)
im2 = im.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
anchor = (top[0] * scale, top[1] * scale - INSET / 2)

bbox = im2.getbbox()
box = (max(bbox[0] - 2, 0), max(bbox[1] - 2, 0), min(bbox[2] + 2, im2.width), min(bbox[3] + 2, im2.height))
im2 = im2.crop(box)
ax, ay = round(anchor[0] - box[0]), round(anchor[1] - box[1])

im2.save(f'{out_dir}/2x_{name}.png', optimize=True)
im1 = im2.resize((round(im2.width / 2), round(im2.height / 2)), Image.Resampling.LANCZOS)
im1.save(f'{out_dir}/1x_{name}.png', optimize=True)
json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out_dir}/{name}.json', 'w'))
print(f'2x {im2.width}x{im2.height} anchor {ax},{ay}')
print(f'1x {im1.width}x{im1.height} anchor {ax / 2:g},{ay / 2:g}')
