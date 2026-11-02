"""Build the main road's tiles from two Ludo.ai road tiles.

Usage: python road_tiles.py OUT_DIR ROAD ROAD_WINTER [TILES_DIR]

Writes 2x/ and 1x/ PNGs into OUT_DIR named road_<arms> (arms like the path pieces: single, ne, ne_se, ...), each in
the base, _spring, _summer, _autumn and _winter versions, on the path pieces' canvas (256 x 128 at 2x, anchored on the
top corner), so manifest.json takes them like path pieces.

The road is the path's broader cousin: a band of packed earth with stones (ROAD, `road_raw.png`; winter trampled snow,
ROAD_WINTER) wider than a path, two dark wheel ruts along its middle, a dark rim and a thin cel outline. Its arms run to
every neighbouring road or path tile, so it joins player paths cleanly. The grass margins are the season's grass_0 tile
from TILES_DIR (default public/assets/farm/2x/tiles, built by ground_tiles.py), sampled at the same tile coordinates, so
they continue the neighbouring ground. Rerun this after ground_tiles.py.
"""
import itertools
import sys
import numpy as np
from PIL import Image, ImageFilter

out_dir, road_raw, road_winter_raw = sys.argv[1:4]
tiles_dir = sys.argv[4] if len(sys.argv) > 4 else 'public/assets/farm/2x/tiles'

N = 512                 # working texture side
SS = 4                  # supersampling
W, H = 256, 128         # 2x tile canvas, top corner at (128, 0)
OUTLINE = np.array([74, 48, 30], np.float32)
EDGES = {"ne": (0, -1), "se": (1, 0), "sw": (0, 1), "nw": (-1, 0)}
HW = 0.37               # half the road's width, tile units (a path's is 0.22)
RUT = 0.13              # ruts' distance from the middle
RUT_W = 0.022           # half a rut's width


def sample(img, px, py):
    h, w = img.shape[:2]
    x0 = np.clip(np.floor(px).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, h - 2)
    fx, fy = np.clip(px - x0, 0, 1)[..., None], np.clip(py - y0, 0, 1)[..., None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def unshear(raw, inner=0.8):
    """A Ludo tile's top surface as an N x N square (as ground_tiles.py does)."""
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
    pad = N // 2
    wr = np.pad(sq, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    blur = np.array(Image.fromarray(wr.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma)))
    return sq - blur[pad:pad + N, pad:pad + N] + sq.reshape(-1, 3).mean(0)


def seamless(sq):
    t = np.minimum(np.arange(N) + 0.5, N - np.arange(N) - 0.5) / (N / 2)
    w1 = np.clip(t * 1.6, 0, 1)
    w = np.minimum.outer(w1, w1)[..., None] ** 1.5
    return (sq * w + np.roll(sq, (N // 2, N // 2), axis=(0, 1)) * (1 - w)).clip(0, 255)


def wrapping(raw):
    return seamless(flatten(unshear(raw)))


def tex(sq, u, v):
    p = np.pad(sq, ((0, 1), (0, 1), (0, 0)), mode='wrap')
    return sample(p, (u % 1) * N, (v % 1) * N)


def tile_tex(img, u, v):
    """A 2x ground tile sampled at tile coords (u, v) (as fringes.py does)."""
    u = np.clip(u % 1, 0.012, 0.988)
    v = np.clip(v % 1, 0.012, 0.988)
    px, py = (u - v) * 128 + 128 - 0.5, (u + v) * 64 - 0.5
    return sample(img[..., :3], px, py)


def box_sdf(u, v, x0, x1, y0, y1):
    dx = np.maximum(np.maximum(x0 - u, u - x1), 0)
    dy = np.maximum(np.maximum(y0 - v, v - y1), 0)
    inside = np.minimum(np.maximum(np.maximum(x0 - u, u - x1), np.maximum(y0 - v, v - y1)), 0)
    return np.hypot(dx, dy) + inside


def road_sdf(u, v, arms):
    """Signed distance to the road's edge (negative inside), and distance to its middle line."""
    d = np.hypot(u - 0.5, v - 0.5) - HW
    # A lone tile's ruts ring its middle; otherwise they run along each arm.
    mid = np.abs(np.hypot(u - 0.5, v - 0.5) - RUT) + RUT if not arms else np.full_like(u, 9.0)
    for a in arms:
        dx, dy = EDGES[a]
        if dx == 0:
            y0, y1 = (-1, 0.5) if dy < 0 else (0.5, 2)
            d = np.minimum(d, box_sdf(u, v, 0.5 - HW, 0.5 + HW, y0, y1))
            along = (v <= 0.5) if dy < 0 else (v >= 0.5)
            mid = np.minimum(mid, np.where(along, np.abs(u - 0.5), np.hypot(u - 0.5, v - 0.5)))
        else:
            x0, x1 = (-1, 0.5) if dx < 0 else (0.5, 2)
            d = np.minimum(d, box_sdf(u, v, x0, x1, 0.5 - HW, 0.5 + HW))
            along = (u <= 0.5) if dx < 0 else (u >= 0.5)
            mid = np.minimum(mid, np.where(along, np.abs(v - 0.5), np.hypot(u - 0.5, v - 0.5)))
    return d, mid


def render(fn):
    Wc, Hc = W * SS, H * SS
    yy, xx = np.mgrid[0:Hc, 0:Wc] + 0.5
    x = (xx - Wc / 2) / (128 * SS)
    y = yy / (64 * SS)
    u, v = (x + y) / 2, (y - x) / 2
    rgb, alpha = fn(u, v)
    img = np.concatenate([rgb, alpha[..., None] * 255], axis=-1)
    return Image.fromarray(img.clip(0, 255).astype(np.uint8)).resize((W, H), Image.Resampling.BOX)


def in_diamond(u, v):
    e = 1.5 / 256
    return ((u >= -e) & (u <= 1 + e) & (v >= -e) & (v <= 1 + e)).astype(np.float32)


def smooth(d, width=1.0):
    px = d * 128 * 1.2
    return np.clip(0.5 - px / width, 0, 1)


def road_tile(arms, grass, earth, rut_col):
    def fn(u, v):
        d, mid = road_sdf(u, v, arms)
        g = tile_tex(grass, u, v)
        lip = np.clip(1 - (d / 0.05), 0, 1)[..., None] * (d > 0)[..., None]   # grass shadow beside the road
        g = g * (1 - 0.2 * lip)
        e = tex(earth, u, v)
        edge = np.clip(1 - (-d) / 0.035, 0, 1)[..., None] * (d <= 0)[..., None]  # darker earth at the rim
        e = e * (1 - 0.18 * edge)
        rut = np.clip(1 - np.abs(mid - RUT) / RUT_W, 0, 1)[..., None] * (d < -0.03)[..., None]
        e = e * (1 - 0.55 * rut) + rut_col * 0.55 * rut
        m = smooth(d)[..., None]
        rgb = g * (1 - m) + e * m
        line = np.clip(1 - np.abs(d * 128 * 1.2) / 1.2, 0, 1)[..., None] * 0.6
        rgb = rgb * (1 - line) + OUTLINE * line
        return rgb, in_diamond(u, v)
    return fn


def save(name, im2):
    im2.save(f'{out_dir}/2x/{name}.png', optimize=True)
    im2.resize((W // 2, H // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x/{name}.png', optimize=True)


def load(name):
    return np.array(Image.open(f'{tiles_dir}/{name}.png').convert('RGBA')).astype(np.float32)


EARTH = wrapping(road_raw)
SNOWY = wrapping(road_winter_raw)
RUT_SUMMER = EARTH.reshape(-1, 3).mean(0) * 0.45
RUT_WINTER = np.array([110, 92, 80], np.float32)
SEASONS = {
    '': (load('grass_0_summer'), EARTH, RUT_SUMMER),
    '_spring': (load('grass_0_spring'), EARTH, RUT_SUMMER),
    '_summer': (load('grass_0_summer'), EARTH, RUT_SUMMER),
    '_autumn': (load('grass_0_autumn'), EARTH, RUT_SUMMER),
    '_winter': (load('grass_0_winter'), SNOWY, RUT_WINTER),
}
for suffix, (grass, earth, rut_col) in SEASONS.items():
    for n in range(5):
        for arms in itertools.combinations(["ne", "se", "sw", "nw"], n):
            name = 'road_' + ('_'.join(arms) if arms else 'single')
            save(name + suffix, render(road_tile(arms, grass, earth, rut_col)))
print('done')
