"""Fit a Ludo-generated prop (a tree, rock, sign...) onto one tile of the game's grid.

Usage: python fit_prop.py RAW.png OUT_DIR NAME BASE_X BASE_Y SCALE [--shadow=RX] [--leaves=HUE,SAT,VAL] [--mirror]

BASE is the point the prop stands on (the middle of a trunk's root flare), measured on the raw image; it lands on
the tile's centre. SCALE is raw px -> 2x px. Use the same BASE and SCALE for every season of one prop, so its
versions line up. --shadow=RX bakes a soft oval shadow under the base, RX 2x px wide each side (Ludo draws none).
--leaves recolours the green pixels only (foliage, not trunk): HUE is added (PIL units, 0-255 round the wheel;
negative turns toward yellow), SAT and VAL multiply. It makes a season Ludo needn't draw, e.g. a pine's spring.
--mirror flips the image left-right (BASE is still measured on the raw image), for a second variant of one prop.
Writes 2x and 1x PNGs and prints the manifest anchor (the tile's top corner) for each; install_prop.py installs them.
"""
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILE_H2 = 128  # 2x tile height

raw, out_dir, name = sys.argv[1], sys.argv[2], sys.argv[3]
bx, by, scale = float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
shadow = float(next((x.split("=")[1] for x in sys.argv if x.startswith("--shadow=")), 0))
leaves = next((x.split("=")[1] for x in sys.argv if x.startswith("--leaves=")), None)

im = Image.open(raw).convert('RGBA')
if "--mirror" in sys.argv:
    im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    bx = im.width - 1 - bx
if leaves:
    dh, ks, kv = map(float, leaves.split(','))
    hsv = np.array(im.convert('RGB').convert('HSV')).astype(np.float32)
    green = (hsv[..., 0] > 40) & (hsv[..., 0] < 130) & (hsv[..., 1] > 40)
    hsv[..., 0] = np.where(green, (hsv[..., 0] + dh) % 256, hsv[..., 0])
    hsv[..., 1] = np.where(green, np.clip(hsv[..., 1] * ks, 0, 255), hsv[..., 1])
    hsv[..., 2] = np.where(green, np.clip(hsv[..., 2] * kv, 0, 255), hsv[..., 2])
    rgb = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    rgb.putalpha(im.getchannel('A'))
    im = rgb
im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
cx, cy = bx * scale, by * scale

if shadow:
    # Same 2:1 squash as the ground; drawn under the prop, offset a little down-right (light from the top left).
    pad = round(shadow)
    sh = Image.new('L', im.size, 0)
    ImageDraw.Draw(sh).ellipse((cx - shadow + 6, cy - shadow / 2 + 3, cx + shadow + 6, cy + shadow / 2 + 3), fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(pad / 6))
    base = Image.new('RGBA', im.size, (20, 30, 10, 0))
    base.putalpha(sh)
    im = Image.alpha_composite(base, im)

bbox = im.getbbox()
box = (max(bbox[0] - 2, 0), max(bbox[1] - 2, 0), min(bbox[2] + 2, im.width), min(bbox[3] + 2, im.height))
im = im.crop(box)
ax, ay = round(cx - box[0]), round(cy - TILE_H2 / 2 - box[1])

im.save(f'{out_dir}/2x_{name}.png', optimize=True)
im1 = im.resize((round(im.width / 2), round(im.height / 2)), Image.Resampling.LANCZOS)
im1.save(f'{out_dir}/1x_{name}.png', optimize=True)
json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out_dir}/{name}.json', 'w'))
print(f'2x {im.width}x{im.height} anchor {ax},{ay}')
print(f'1x {im1.width}x{im1.height} anchor {ax / 2:g},{ay / 2:g}')
