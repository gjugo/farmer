"""Build the game's ground tiles from Ludo.ai tile images.

Usage: python ground_tiles.py OUT_DIR GRASS_A GRASS_B DIRT SOIL SNOW SNOW_PATH

Writes 2x/ and 1x/ PNGs into OUT_DIR, named like the pack (grass_0..2, path_*, soil_tilled_x/y,
soil_watered_x/y, unowned_0/1), each in the base, _spring, _summer, _autumn and _winter versions, with the
pack's canvas sizes and anchors so manifest.json is unchanged. Autumn is the summer art recoloured with fallen
leaves; winter uses the snow tiles for grass and paths, and frozen soil with snow in the furrows.

Every tile is rendered in tile space (u along world x, v along world y, both 0..1 across the tile), sampling
seamless textures, so all tiles meet without seams. Path and soil shapes follow tools/art/tiles.py.
"""
import colorsys
import itertools
import sys
import numpy as np
from PIL import Image, ImageFilter

N = 512                 # working texture side
INNER = 0.8             # fraction of a Ludo tile's top surface used (clear of its outline and edge tufts)
SS = 4                  # supersampling
KZ = 128 * 1.2247       # 2x px per world unit of height (tools/art/core.py)
OUTLINE = np.array([74, 48, 30], np.float32)  # cel outline colour

out_dir = sys.argv[1]
grass_a, grass_b, dirt_raw, soil_raw, snow_raw, snow_path_raw = sys.argv[2:8]


# ---------------------------------------------------------------- textures
def sample(img, px, py):
    """Bilinear sample of img (H, W, C) at float pixel coords (clamped)."""
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(px).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, h - 2)
    fx, fy = np.clip(px - x0, 0, 1)[..., None], np.clip(py - y0, 0, 1)[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def tex(sq, u, v):
    """Sample a wrapping N x N texture at tile coords (u, v); one tile = one texture repeat."""
    p = np.pad(sq, ((0, 1), (0, 1), (0, 0)), mode='wrap')
    return sample(p, (u % 1) * N, (v % 1) * N)


def unshear(raw, inner=INNER):
    """A Ludo tile's top surface as an N x N square (u → right corner, v → left corner)."""
    a = np.array(Image.open(raw).convert('RGBA')).astype(np.float32)
    alpha = a[..., 3] > 128
    xs = np.nonzero(alpha.any(0))[0]
    lx, rx = xs.min(), xs.max()
    ly, ry = np.nonzero(alpha[:, lx])[0].min(), np.nonzero(alpha[:, rx])[0].min()
    cx, cy = (lx + rx) / 2, (ly + ry) / 2
    hw = (rx - lx) / 2 * inner
    top = np.array([cx, cy - hw / 2])
    u, v = np.meshgrid((np.arange(N) + 0.5) / N, (np.arange(N) + 0.5) / N)
    P = top + u[..., None] * np.array([hw, hw / 2]) + v[..., None] * np.array([-hw, hw / 2])
    return sample(a[..., :3], P[..., 0], P[..., 1])


def flatten(sq, sigma=N / 6):
    """Remove large-scale light/dark so repeats don't show."""
    pad = N // 2
    wr = np.pad(sq, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    blur = np.array(Image.fromarray(wr.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma)))
    return sq - blur[pad:pad + N, pad:pad + N] + sq.reshape(-1, 3).mean(0)


def seamless(sq):
    """Cross-fade with a half-offset copy so the square wraps."""
    t = np.minimum(np.arange(N) + 0.5, N - np.arange(N) - 0.5) / (N / 2)
    w1 = np.clip(t * 1.6, 0, 1)
    w = np.minimum.outer(w1, w1)[..., None] ** 1.5
    return (sq * w + np.roll(sq, (N // 2, N // 2), axis=(0, 1)) * (1 - w)).clip(0, 255)


def wrapping(raw, rot=False):
    sq = unshear(raw)
    if rot:
        sq = sq[::-1, ::-1]
    return seamless(flatten(sq))


c1 = np.clip((np.minimum(np.arange(N) + 0.5, N - np.arange(N) - 0.5) / N - 0.12) / 0.2, 0, 1)
CENTRE = np.minimum.outer(c1, c1)[..., None]


def share_border(variants):
    """All variants take the first one's border, so any two meet cleanly; they differ only in the middle."""
    return [variants[0] * (1 - CENTRE) + g * CENTRE for g in variants]


GRASS3 = share_border([wrapping(grass_a), wrapping(grass_b), wrapping(grass_b, rot=True)])
SNOW = wrapping(snow_raw)
SNOW3 = share_border([SNOW, SNOW[::-1, ::-1], SNOW.transpose(1, 0, 2)])
DIRT = wrapping(dirt_raw)
SNOW_PATH = wrapping(snow_path_raw)
SOIL = flatten(unshear(soil_raw, inner=0.86), sigma=N / 4).clip(0, 255)  # one bed per tile: no wrap needed


def recolour(sq, sat=1.0, val=1.0, hue=0.0):
    """HSV adjust a texture."""
    rgb = sq / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = np.where(mx > mn, mx - mn, 1)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, (g - b) / d, np.where(mx == g, 2 + (b - r) / d, 4 + (r - g) / d)) / 6
    h = (np.where(mx > mn, h, 0) + hue) % 1
    sv = np.where(mx > 0, (mx - mn) / np.where(mx > 0, mx, 1), 0)
    sv, v = np.minimum(sv * sat, 1), np.minimum(mx * val, 1)
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, t = v * (1 - sv), v * (1 - sv * f), v * (1 - sv * (1 - f))
    out = np.choose(i[..., None], [np.stack(c, -1) for c in
                                   ((v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q))])
    return (out * 255).clip(0, 255)


LEAVES = np.array([[201, 104, 38], [222, 150, 52], [168, 62, 34], [190, 128, 40]], np.float32)


def leaves(sq, seed, n=11):
    """Scatter small fallen leaves over a wrapping texture (drawn wrapped, so it still tiles)."""
    rnd = np.random.default_rng(seed)
    out = sq.copy()
    yy, xx = np.mgrid[0:N, 0:N]
    for _ in range(n):
        cx, cy = rnd.uniform(0, N, 2)
        a, b, ang = rnd.uniform(15, 21), rnd.uniform(7, 10), rnd.uniform(0, np.pi)
        dx = (xx - cx + N / 2) % N - N / 2
        dy = (yy - cy + N / 2) % N - N / 2
        x_ = dx * np.cos(ang) + dy * np.sin(ang)
        y_ = -dx * np.sin(ang) + dy * np.cos(ang)
        r = (x_ / a) ** 2 + (y_ / b) ** 2
        col = LEAVES[rnd.integers(len(LEAVES))]
        shade_ = 1 - 0.18 * (y_ > 0)                              # lower half a bit darker
        fill = np.clip((1 - r) * 4, 0, 1)[..., None]
        out = out * (1 - fill) + (col * shade_[..., None]) * fill
        rim = np.clip(1 - np.abs(r - 1) * 3, 0, 1)[..., None] * 0.7   # dark cel outline
        out = out * (1 - rim) + OUTLINE * rim
    return out


# ---------------------------------------------------------------- rendering
def render(fn, extra_top=0, extra_bottom=0, width=256):
    """Render fn(u, v, y_px) -> (rgb, alpha) into a tile canvas; top corner at (width/2, extra_top)."""
    W, H = width * SS, (width // 2 + extra_top + extra_bottom) * SS
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    s = width * SS / 256  # canvas px per 2x px
    x = (xx - W / 2) / (128 * s)        # world x - y
    y = (yy - extra_top * SS) / (64 * s)  # world x + y
    u, v = (x + y) / 2, (y - x) / 2
    rgb, alpha = fn(u, v, s)
    img = np.concatenate([rgb, alpha[..., None] * 255], axis=-1)
    im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
    return im.resize((width, width // 2 + extra_top + extra_bottom), Image.Resampling.BOX)


def in_diamond(u, v, s):
    e = 1.5 / (128 * s / SS * 2)  # overfill ~1.5 px past the edge so no hairline shows between tiles
    return ((u >= -e) & (u <= 1 + e) & (v >= -e) & (v <= 1 + e)).astype(np.float32)


def save(name, im2):
    im2.save(f'{out_dir}/2x/{name}.png', optimize=True)
    im2.resize((im2.width // 2, im2.height // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x/{name}.png', optimize=True)


def smooth(d, s, width=1.0):
    """Coverage 1 inside (d < 0) → 0 outside, anti-aliased over ~width 2x px."""
    px = d * 128 * s / SS * 1.2  # tile units → approx 2x px
    return np.clip(0.5 - px / width, 0, 1)


# ---------------------------------------------------------------- grass + unowned
def grass_tile(sq):
    return lambda u, v, s: (tex(sq, u, v), in_diamond(u, v, s))


# ---------------------------------------------------------------- paths (shape from tools/art/tiles.py)
EDGES = {"ne": (0, -1), "se": (1, 0), "sw": (0, 1), "nw": (-1, 0)}
HW = 0.22  # half the path's width, tile units


def box_sdf(u, v, x0, x1, y0, y1):
    dx = np.maximum(np.maximum(x0 - u, u - x1), 0)
    dy = np.maximum(np.maximum(y0 - v, v - y1), 0)
    inside = np.minimum(np.maximum(np.maximum(x0 - u, u - x1), np.maximum(y0 - v, v - y1)), 0)
    return np.hypot(dx, dy) + inside


def path_sdf(u, v, arms):
    d = np.hypot(u - 0.5, v - 0.5) - HW
    for a in arms:
        dx, dy = EDGES[a]
        if dx == 0:
            y0, y1 = (-1, 0.5) if dy < 0 else (0.5, 2)
            d = np.minimum(d, box_sdf(u, v, 0.5 - HW, 0.5 + HW, y0, y1))
        else:
            x0, x1 = (-1, 0.5) if dx < 0 else (0.5, 2)
            d = np.minimum(d, box_sdf(u, v, x0, x1, 0.5 - HW, 0.5 + HW))
    return d


def path_tile(arms, grass_sq, dirt_sq):
    def fn(u, v, s):
        d = path_sdf(u, v, arms)
        grass = tex(grass_sq, u, v)
        lip = np.clip(1 - (d / 0.05), 0, 1)[..., None] * (d > 0)[..., None]   # grass shadow beside the path
        grass = grass * (1 - 0.18 * lip)
        dirt = tex(dirt_sq, u, v)
        worn = np.clip((-d - HW * 0.35) / 0.06, 0, 1)[..., None]               # lighter, worn centre
        dirt = dirt * (1 + 0.07 * worn)
        edge = np.clip(1 - (-d) / 0.03, 0, 1)[..., None] * (d <= 0)[..., None]  # darker dirt at the rim
        dirt = dirt * (1 - 0.15 * edge)
        m = smooth(d, s)[..., None]
        rgb = grass * (1 - m) + dirt * m
        line = np.clip(1 - np.abs(d * 128 * s / SS * 1.2) / 1.2, 0, 1)[..., None] * 0.55  # thin cel outline
        rgb = rgb * (1 - line) + OUTLINE * line
        return rgb, in_diamond(u, v, s)
    return fn


# ---------------------------------------------------------------- tilled soil (shape from tools/art/tiles.py)
I, BED_H = 0.07, 0.03 * KZ  # bed inset (tile units) and height (2x px)


def soil_tile(soil, along, grass_sq):
    sq = soil if along == 'x' else soil.transpose(1, 0, 2)

    def fn(u, v, s):
        lift = BED_H / 128  # raising by BED_H 2x px shifts the ground point by BED_H/128 on both u and v
        # Top face: the ground point lifted by BED_H.
        ut, vt = u + lift, v + lift
        d_top = box_sdf(ut, vt, I, 1 - I, I, 1 - I)
        d_base = box_sdf(u, v, I, 1 - I, I, 1 - I)
        grass = tex(grass_sq, u, v)
        shadow = np.clip(1 - d_base / 0.04, 0, 1)[..., None] * (d_base > 0)[..., None]
        rgb = grass * (1 - 0.2 * shadow)
        # Sides: between base and top; +y face (front-left) lighter than +x face (front-right).
        side_cov = np.maximum(smooth(d_base, s), smooth(d_top, s)) * (1 - smooth(d_top, s))
        side_col = np.where((u > v)[..., None], soil.mean((0, 1)) * 0.55, soil.mean((0, 1)) * 0.7)
        rgb = rgb * (1 - side_cov[..., None]) + side_col * side_cov[..., None]
        # Top: the Ludo furrows mapped across the bed.
        fu, fv = (ut - I) / (1 - 2 * I), (vt - I) / (1 - 2 * I)
        top = sample(sq, np.clip(fu, 0, 1) * (N - 1), np.clip(fv, 0, 1) * (N - 1))
        m = smooth(d_top, s)[..., None]
        rgb = rgb * (1 - m) + top * m
        line = np.clip(1 - np.abs(d_top * 128 * s / SS * 1.2) / 1.2, 0, 1)[..., None] * 0.6
        rgb = rgb * (1 - line) + OUTLINE * 0.6 * line
        return rgb, np.maximum(in_diamond(u, v, s), np.maximum(side_cov, smooth(d_top, s)))
    return fn


# ---------------------------------------------------------------- seasons
def frozen(soil, icy=False):
    """Frozen soil: grey and dull, with snow lying in the furrows (the darkest parts)."""
    grey = recolour(soil, sat=0.35, val=1.15) * (np.array([0.92, 0.95, 1.05]) if icy else 1)
    lum = soil.mean(-1)
    snow = np.clip((np.percentile(lum, 35) - lum) / 12, 0, 1)[..., None]
    return grey * (1 - snow) + np.array([236, 240, 248]) * snow


def watered(soil):
    return (soil * np.array([0.66, 0.66, 0.72])).clip(0, 255)


summer = dict(grass=GRASS3, wild=[recolour(g, sat=0.78, val=0.7, hue=0.02) for g in GRASS3[:2]],
              dirt=DIRT, soil=SOIL, watered=watered(SOIL))
autumn_grass = share_border([leaves(recolour(g, sat=0.92, val=0.9, hue=-0.035), 31 + i) for i, g in enumerate(GRASS3)])
SEASONS = {
    '': summer, '_spring': summer, '_summer': summer,
    '_autumn': dict(grass=autumn_grass, wild=[recolour(g, sat=0.8, val=0.72, hue=-0.01) for g in autumn_grass[:2]],
                    dirt=DIRT, soil=SOIL, watered=watered(SOIL)),
    '_winter': dict(grass=SNOW3, wild=[(g * np.array([0.86, 0.89, 0.94])).clip(0, 255) for g in SNOW3[:2]],
                    dirt=SNOW_PATH, soil=frozen(SOIL), watered=frozen(watered(SOIL), icy=True)),
}

for suffix, t in SEASONS.items():
    for i, g in enumerate(t['grass']):
        save(f'grass_{i}{suffix}', render(grass_tile(g)))
    save(f'unowned_0{suffix}', render(grass_tile(t['wild'][0])))
    save(f'unowned_1{suffix}', render(grass_tile(t['wild'][1]), extra_top=40))
    for n in range(5):
        for arms in itertools.combinations(["ne", "se", "sw", "nw"], n):
            name = 'path_' + ('_'.join(arms) if arms else 'single')
            save(name + suffix, render(path_tile(arms, t['grass'][0], t['dirt'])))
    for along in 'xy':
        save(f'soil_tilled_{along}{suffix}', render(soil_tile(t['soil'], along, t['grass'][0]), extra_bottom=8))
        save(f'soil_watered_{along}{suffix}', render(soil_tile(t['watered'], along, t['grass'][0]), extra_bottom=8))
print('done')
