"""Compose the 16 pasture fence pieces and the closed gate from a Ludo post, rail section and gate.

Usage: python fences.py POST.png RAIL.png GATE.png OUT_DIR

The fence runs through tile centres (`fencePiece` and `penFence` in src/scenes/art.ts): each piece is a post on the
tile's centre plus a half-rail to the middle of every tile edge it names (ne, se, sw, nw). The rail source is a
side-on, horizontal section; it is sheared onto the 2:1 grid (along x it drops 1 px per 2 px across; along y it is
mirrored, which turns x into y). The rail texture wraps every tile length and is sampled by its position along the
fence line, so a half-rail meets the next tile's half-rail with no seam. The gate (`gate_se_nw_closed`) spans the
whole tile along x, between two posts on the tile edges. Rails going back (ne, nw) are drawn behind the post, rails
coming forward (se, sw) in front of it. A soft shadow is baked on the ground under every rail and post.
Writes 2x and 1x PNGs and NAME.json anchors (the tile's top corner) for install_prop.py.
"""
import json
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W2, H2 = 256, 128  # 2x tile
POST_BASE = (128, 694)  # raw post: centre of its foot
POST_H = 72  # post height in 2x px
RAIL_X = (100, 700)  # raw rail: the level middle of the section, one tile length after wrapping
RAIL_Y = (40, 216)  # raw rail: top of the upper rail to the bottom of the lower one
RAIL_TOP, RAIL_BOTTOM = 56, 16  # rails' span above the ground in 2x px
GATE_TOP, GATE_BOTTOM = 60, 6
EDGES = {'ne': (64, -32), 'se': (64, 32), 'sw': (-64, 32), 'nw': (-64, -32)}  # centre -> edge middle, 2x px
NAMES = ['post', 'ne', 'se', 'ne_se', 'sw', 'ne_sw', 'se_sw', 'ne_se_sw', 'nw', 'ne_nw', 'se_nw', 'ne_se_nw',
         'sw_nw', 'ne_sw_nw', 'se_sw_nw', 'ne_se_sw_nw']
FADE = 0.15  # share of the rail texture cross-faded so it wraps

post_raw, rail_raw, gate_raw, out_dir = sys.argv[1:5]

# Canvas: the tile's top corner at (CX, CY); the centre of the tile is CY + 64 below it.
CW, CH = 2 * W2, 2 * H2
CX, CY = CW // 2, 96
GX, GY = CX, CY + H2 // 2  # tile centre on the ground


def wrap_strip(src, height, length):
    """Scale a side-on wooden section to `length` x `height` and cross-fade its ends so it tiles."""
    over = round(length * FADE)
    s = src.resize((length + over, height), Image.Resampling.LANCZOS)
    a = np.array(s).astype(np.float32)
    head, tail = a[:, :over], a[:, length:]
    t = np.linspace(0, 1, over)[None, :, None]
    a[:, :over] = tail * (1 - t) + head * t
    return np.clip(a[:, :length], 0, 255).astype(np.uint8)


def shear(strip):
    """A side-on strip onto the ground line along x: it drops 1 px for every 2 px across."""
    h, L = strip.shape[:2]
    out = np.zeros((h + L // 2 + 1, L, 4), np.uint8)
    for c in range(L):
        out[c // 2:c // 2 + h, c] = strip[:, c]
    return out


def rail_layer(tex, edge, top):
    """A half-rail from the tile centre to the middle of `edge`, as a canvas-sized layer.

    Column c (screen x from the tile centre) stands on the ground at y = c // 2 along x, -c // 2 along y, and
    takes texture column c mod 128, so the neighbouring tile (128 px over) carries the rail on seamlessly.
    """
    ex, _ = EDGES[edge]
    along_x = edge in ('se', 'nw')
    src = tex if along_x else tex[:, ::-1]
    h = src.shape[0]
    layer = np.zeros((CH, CW, 4), np.uint8)
    for c in (range(0, ex) if ex > 0 else range(ex, 0)):
        gy = c // 2 if along_x else -c // 2
        y = GY + gy - top
        layer[y:y + h, GX + c] = src[:, c % src.shape[1]]
    return Image.fromarray(layer)


def ground_shadow(canvas, lines, posts):
    sh = Image.new('L', canvas.size, 0)
    d = ImageDraw.Draw(sh)
    for (x0, y0), (x1, y1) in lines:
        d.line((GX + x0 + 4, GY + y0 + 3, GX + x1 + 4, GY + y1 + 3), fill=80, width=7)
    for px, py in posts:
        d.ellipse((GX + px - 9 + 4, GY + py - 5 + 3, GX + px + 9 + 4, GY + py + 5 + 3), fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(3))
    layer = Image.new('RGBA', canvas.size, (20, 30, 10, 0))
    layer.putalpha(sh)
    canvas.alpha_composite(layer)


post_src = Image.open(post_raw).convert('RGBA')
k = POST_H / (POST_BASE[1] - post_src.getbbox()[1])
post = post_src.resize((round(post_src.width * k), round(post_src.height * k)), Image.Resampling.LANCZOS)
post_off = (round(POST_BASE[0] * k), round(POST_BASE[1] * k))

rail_src = Image.open(rail_raw).convert('RGBA').crop((RAIL_X[0], RAIL_Y[0], RAIL_X[1], RAIL_Y[1]))
rail_tex = wrap_strip(rail_src, RAIL_TOP - RAIL_BOTTOM, 128)


def paste_post(canvas, dx, dy):
    canvas.alpha_composite(post, (GX + dx - post_off[0], GY + dy - post_off[1]))


def half_rail(canvas, edge):
    canvas.alpha_composite(rail_layer(rail_tex, edge, RAIL_TOP))


def save(canvas, name):
    bbox = canvas.getbbox()
    box = (bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2)
    im = canvas.crop(box)
    ax, ay = CX - box[0], CY - box[1]
    im.save(f'{out_dir}/2x_{name}.png', optimize=True)
    w1, h1 = round(im.width / 2), round(im.height / 2)
    im.resize((w1, h1), Image.Resampling.LANCZOS).save(f'{out_dir}/1x_{name}.png', optimize=True)
    json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out_dir}/{name}.json', 'w'))
    print(f'{name}: 2x {im.width}x{im.height} anchor {ax},{ay}')


for name in NAMES:
    edges = [] if name == 'post' else name.split('_')
    canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    ground_shadow(canvas, [((0, 0), EDGES[e]) for e in edges], [(0, 0)])
    for e in ('ne', 'nw'):
        if e in edges:
            half_rail(canvas, e)
    paste_post(canvas, 0, 0)
    for e in ('se', 'sw'):
        if e in edges:
            half_rail(canvas, e)
    save(canvas, f'fence_{name}')

# Gate: the gate leaf across the whole tile along x, between posts on the nw and se edges.
gate_src = Image.open(gate_raw).convert('RGBA')
gate_src = gate_src.crop(gate_src.getbbox())
leaf = np.array(gate_src.resize((128 - 12, GATE_TOP - GATE_BOTTOM), Image.Resampling.LANCZOS))
# Shrunk 6x, the gate's boards are thinner than a pixel in places: firm up their alpha so they don't turn see-through.
leaf[..., 3] = (255 * (leaf[..., 3] / 255) ** 0.5).astype(np.uint8)
leaf_img = Image.fromarray(shear(leaf))
canvas = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
ground_shadow(canvas, [(EDGES['nw'], EDGES['se'])], [EDGES['nw'], EDGES['se']])
paste_post(canvas, *EDGES['nw'])
canvas.alpha_composite(leaf_img, (GX - 64 + 6, GY - 32 + 3 - GATE_TOP))
paste_post(canvas, *EDGES['se'])
save(canvas, 'gate_se_nw_closed')
