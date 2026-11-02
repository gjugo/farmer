"""Grass fringes: strips of grass tufts that hang over a path's or field's edge where it borders grass.

Usage: python fringes.py OUT_DIR [TILES_DIR] [KIND,...]

Writes 2x/ and 1x/ PNGs into OUT_DIR named fringe_<kind>_<edge> (kind path or field, edge ne, se, sw or nw), each in
the base, _spring, _summer, _autumn and _winter versions. Each is a tile-sized canvas (256 x 128 at 2x, anchored on
its top corner like the ground tiles), transparent but for the strip along its one edge, so manifest.json takes them
like path pieces.

The grass is the ground they must blend into: the grass_0 tile of each season in TILES_DIR (default
public/assets/farm/2x/tiles), which ground_tiles.py builds from grass_a_raw.png (winter: snow_raw.png). That texture
wraps once per tile, so sampling it at the same tile coordinates continues the neighbouring grass tile exactly. Rerun
this after ground_tiles.py.

  path:  solid grass over the path tile's own grass margin, tufts hanging over the dirt's rim (HW in ground_tiles.py)
  field: a low strip, tufts just over the soil bed's rim (I in ground_tiles.py), so crops stand clear of it
  road:  the main road's narrower grass margin, tufts over its rim (HW in road_tiles.py)
KIND,... builds only those kinds (e.g. `road`); all of them when left out.
Spring and summer are green, autumn the gold grass with its leaves, winter snow-crusted: snow with frosted blades.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

out_dir = sys.argv[1]
tiles_dir = sys.argv[2] if len(sys.argv) > 2 else 'public/assets/farm/2x/tiles'

SS = 4                                          # supersampling
W, H = 256, 128                                 # 2x tile canvas, top corner at (128, 0)
OUTLINE = np.array([74, 48, 30], np.float32)    # cel outline colour (ground_tiles.py)
EDGES = ['ne', 'se', 'sw', 'nw']
# Strip shapes in tile units from the edge: solid core, then tufts reaching up to core + tuft.
KINDS = {
    'path': dict(core=0.235, tuft=(0.05, 0.13), blades=30, seed=11),
    'field': dict(core=0.035, tuft=(0.03, 0.085), blades=34, seed=23),
    'road': dict(core=0.11, tuft=(0.04, 0.1), blades=32, seed=37),
}
only = sys.argv[3].split(',') if len(sys.argv) > 3 else list(KINDS)


def load(name):
    return np.array(Image.open(f'{tiles_dir}/{name}.png').convert('RGBA')).astype(np.float32)


def tile_tex(img, u, v):
    """Bilinear sample of a 2x ground tile at tile coords (u, v), wrapped once per tile like its texture."""
    u = np.clip(u % 1, 0.012, 0.988)
    v = np.clip(v % 1, 0.012, 0.988)
    px, py = (u - v) * 128 + 128 - 0.5, (u + v) * 64 - 0.5
    x0 = np.clip(np.floor(px).astype(int), 0, W - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, H - 2)
    fx, fy = np.clip(px - x0, 0, 1)[..., None], np.clip(py - y0, 0, 1)[..., None]
    c = img[..., :3]
    return (c[y0, x0] * (1 - fx) * (1 - fy) + c[y0, x0 + 1] * fx * (1 - fy)
            + c[y0 + 1, x0] * (1 - fx) * fy + c[y0 + 1, x0 + 1] * fx * fy)


def along(edge, u, v):
    """(distance into the tile from the edge, position along it), both in tile units."""
    return {'ne': (v, u), 'se': (1 - u, v), 'sw': (1 - v, 1 - u), 'nw': (u, 1 - v)}[edge]


def blades_of(kind, edge):
    k = KINDS[kind]
    rnd = np.random.default_rng(k['seed'] + EDGES.index(edge))
    n = k['blades']
    t = (np.arange(n) + rnd.uniform(0.15, 0.85, n)) / n * 1.04 - 0.02  # spread evenly, a little past both ends
    return [dict(t=t[i], w=rnd.uniform(0.012, 0.028), h=rnd.uniform(*k['tuft']), lean=rnd.uniform(-0.03, 0.03))
            for i in range(n)]


def coverage(kind, blades, d, t):
    """1 where the strip covers (d, t), and how far up a blade each point is (0 at its root, 1 at its tip)."""
    core = KINDS[kind]['core'] * (1 + 0.08 * np.sin(t * 17.0) + 0.05 * np.sin(t * 41.0 + 1.3))
    cov = (d < core).astype(np.float32)
    up = np.zeros_like(d)
    for b in blades:
        s = (d - core * 0.85) / (b['h'] + core * 0.15)
        half = b['w'] * np.clip(1 - s, 0, 1) ** 0.8
        inside = (s >= 0) & (s <= 1) & (np.abs(t - b['t'] - b['lean'] * s) < half)
        cov = np.maximum(cov, inside)
        up = np.where(inside & (d >= core), np.maximum(up, s), up)
    return cov, up


def strip(kind, edge, base, blade_col=None):
    """One fringe: RGBA 256 x 128 (2x)."""
    yy, xx = np.mgrid[0:H * SS, 0:W * SS] + 0.5
    x, y = (xx / SS - 128) / 128, yy / SS / 64      # world x - y, x + y
    u, v = (x + y) / 2, (y - x) / 2
    d, t = along(edge, u, v)
    blades = blades_of(kind, edge)
    cov, up = coverage(kind, blades, d, t)
    # Drop shadow: the strip moved 3 px down the screen, lying on the path or soil beside it.
    sd, st = along(edge, u - 3 / 128, v - 3 / 128)
    shadow, _ = coverage(kind, blades, sd, st)
    shadow = np.clip(shadow - cov, 0, 1)

    rgb = tile_tex(base, u, v)
    tips = blade_col(u, v) if blade_col else rgb
    tuft = (up > 0)[..., None]
    shade = (0.93 + 0.16 * up)[..., None]          # a little darker at a tuft's root, lighter at its tip
    rgb = np.where(tuft, tips * shade, rgb)

    # Thin cel outline round the tufts (not along the tile edge: the strip runs on past it before the cut).
    a = Image.fromarray((cov * 255).astype(np.uint8))
    rim = (cov - np.array(a.filter(ImageFilter.MinFilter(2 * SS - 1))) / 255) * (d > 0.02)
    rgb = rgb * (1 - 0.28 * rim[..., None]) + OUTLINE * 0.28 * rim[..., None]

    tile = ((u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)).astype(np.float32)
    alpha = np.maximum(cov, shadow * 0.3) * tile
    rgb = np.where((cov > 0)[..., None], rgb, OUTLINE * 0.6)
    img = Image.fromarray(np.concatenate([rgb, alpha[..., None] * 255], -1).clip(0, 255).astype(np.uint8))
    # Feather: soften the alpha a touch before downsampling, so the tufts don't end in a hard line.
    r, g, b_, al = img.split()
    al = al.filter(ImageFilter.GaussianBlur(SS * 0.6))
    al = Image.fromarray((np.array(al).astype(np.float32) * tile).astype(np.uint8))
    img = Image.merge('RGBA', (r, g, b_, al))
    return img.resize((W, H), Image.Resampling.BOX)


def save(name, im2):
    im2.save(f'{out_dir}/2x/{name}.png', optimize=True)
    im2.resize((W // 2, H // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x/{name}.png', optimize=True)


def frosted(green, snow):
    """Winter blades: the green grass greyed and frosted, with the snow tile's sparkle in it."""
    def col(u, v):
        g = tile_tex(green, u, v)
        grey = g.mean(-1, keepdims=True)
        frost = (g * 0.45 + grey * 0.55) * np.array([0.95, 1.0, 1.04])
        return frost * 0.4 + tile_tex(snow, u, v) * 0.6
    return col


green = load('grass_0_summer')
SEASONS = {
    '': (green, None), '_spring': (load('grass_0_spring'), None), '_summer': (green, None),
    '_autumn': (load('grass_0_autumn'), None),
    '_winter': (load('grass_0_winter'), frosted(green, load('grass_0_winter'))),
}

for kind in only:
    for edge in EDGES:
        for suffix, (base, blade_col) in SEASONS.items():
            save(f'fringe_{kind}_{edge}{suffix}', strip(kind, edge, base, blade_col))
print('done')
