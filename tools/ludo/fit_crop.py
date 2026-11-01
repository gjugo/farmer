"""Plant one Ludo-generated plant in rows on one tilled-soil tile: a crop stage sprite.

Usage: python fit_crop.py RAW.png OUT_DIR NAME HEIGHT ROWS PER_ROW [--seed=N] [--shadow=RX] [--color=K] [--bright=K] [--widen=K]

RAW is a single plant on a transparent background (its base is the bottom middle of its opaque pixels). It is
scaled to HEIGHT 2x px and planted PER_ROW times along each of ROWS rows. The rows run along world x, like the
furrows of `soil_tilled_x`, evenly spaced across the soil bed (the tile less the bed's inset, see
`ground_tiles.py`), so the rows of neighbouring tiles carry on at the same spacing. Plants are drawn back to front,
every other one mirrored, with a little jitter along the row and in size; the jitter comes from --seed, so every
stage of one crop fitted with the same ROWS, PER_ROW and seed stands at the same spots. --shadow=RX bakes a soft
oval contact shadow, RX 2x px wide each side, under every plant. --color and --bright multiply the plant's
saturation and brightness (Ludo's younger stages come out paler than the ripe one), and --widen stretches it
sideways, so a thin stalk still reads at game zoom. Only plants are drawn: the game's own soil shows between them.

Writes 2x and 1x PNGs and NAME.json with the manifest anchor (the tile's top corner); install_prop.py installs
them.
"""
import json
import random
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

TILE_W2, TILE_H2 = 256, 128  # 2x tile
INSET = 0.07                 # soil bed inset, tile units (ground_tiles.py I)
LIFT = 0.03 * 128 * 1.2247   # soil bed height, 2x px (ground_tiles.py BED_H)

raw, out_dir, name = sys.argv[1], sys.argv[2], sys.argv[3]
height, rows, per_row = float(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
opt = {a.split('=')[0]: a.split('=')[1] for a in sys.argv[7:] if a.startswith('--')}
seed, shadow = int(opt.get('--seed', 1)), float(opt.get('--shadow', 0))
widen = float(opt.get('--widen', 1))

plant = Image.open(raw).convert('RGBA')
plant = plant.crop(plant.getbbox())
alpha_ch = plant.getchannel('A')
plant = ImageEnhance.Brightness(ImageEnhance.Color(plant).enhance(float(opt.get('--color', 1)))).enhance(
    float(opt.get('--bright', 1)))
plant.putalpha(alpha_ch)
alpha = np.array(plant.getchannel('A')) > 128
foot = alpha[-max(3, plant.height // 30):].any(0).nonzero()[0]
base_x = (foot.min() + foot.max()) / 2  # middle of the opaque pixels along the bottom
k = height / plant.height


def placed(mirror, size):
    im = plant.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if mirror else plant
    w, h = max(1, round(im.width * k * size * widen)), max(1, round(im.height * k * size))
    bx = (im.width - 1 - base_x if mirror else base_x) * k * size * widen
    return im.resize((w, h), Image.Resampling.LANCZOS), bx, h


rng = random.Random(seed)
span = 1 - 2 * INSET
spots = []
for i in range(rows):
    for j in range(per_row):
        u = INSET + (j + 0.5 + rng.uniform(-0.2, 0.2)) * span / per_row
        v = INSET + (i + 0.5) * span / rows
        spots.append((u + v, u, v, (i + j) % 2 == 1, rng.uniform(0.9, 1.08)))
spots.sort()  # back to front

# Canvas: the tile's top corner at (PAD, TOP); generous, cropped at the end.
PAD, TOP = 64, 2 * round(height * 0.6) + 16
canvas = Image.new('RGBA', (TILE_W2 + 2 * PAD, TILE_H2 + TOP + PAD), (0, 0, 0, 0))
cx0 = PAD + TILE_W2 // 2
for _, u, v, mirror, size in spots:
    gx, gy = cx0 + (u - v) * TILE_W2 / 2, TOP + (u + v) * TILE_H2 / 2 - LIFT
    if shadow:
        sh = Image.new('L', canvas.size, 0)
        r = shadow * size
        ImageDraw.Draw(sh).ellipse((gx - r + 2, gy - r / 2 + 1, gx + r + 2, gy + r / 2 + 1), fill=80)
        sh = sh.filter(ImageFilter.GaussianBlur(r / 4))
        dark = Image.new('RGBA', canvas.size, (30, 20, 10, 0))
        dark.putalpha(sh)
        canvas = Image.alpha_composite(canvas, dark)
    im, bx, h = placed(mirror, size)
    canvas.alpha_composite(im, (round(gx - bx), round(gy - h + 1)))

# Crop to the content on even coordinates, so the 1x image is exactly half and its anchor whole.
x0, y0, x1, y1 = canvas.getbbox()
x0, y0 = x0 - x0 % 2, y0 - y0 % 2
x1, y1 = x1 + x1 % 2, y1 + y1 % 2
im = canvas.crop((x0, y0, x1, y1))
ax, ay = cx0 - x0, TOP - y0

im.save(f'{out_dir}/2x_{name}.png', optimize=True)
im1 = im.resize((im.width // 2, im.height // 2), Image.Resampling.LANCZOS)
im1.save(f'{out_dir}/1x_{name}.png', optimize=True)
json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out_dir}/{name}.json', 'w'))
print(f'2x {im.width}x{im.height} anchor {ax},{ay}')
print(f'1x {im1.width}x{im1.height} anchor {ax / 2:g},{ay / 2:g}')
