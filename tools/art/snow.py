"""Winter versions of every building: snow on whatever faces up (roofs, ridges, chimney tops, sills).

Derived from each building sprite's own pixels, so nothing is listed by hand: every image of the
`buildings` category registered before `build()` runs gets a `<name>_winter` twin with the same canvas,
anchor, footprint and shadow. A new building (or storage level) gets its snowy version on the next
`npm run art`.
"""

import numpy as np
from PIL import Image
from registry import REG, image

SNOW = np.array([241, 245, 250], dtype=np.float64)   # tiles.SNOW
SNOW_LIP = np.array([125, 143, 163], dtype=np.float64)
DEPTH = 50.0        # 2x px of snow below a top edge
OUTLINE = 3.0       # 2x px of the sprite's top outline left visible above the snow
MIN_BODY = 40.0     # 2x px: thinner things (posts, mesh, wires) get none
SHARE = 0.3         # and at most this share of a surface's height
STEEP = 1.6         # top edges steeper than this (px down per px across) are walls, not roofs: no snow


def snow_on(img, scale=1.0):
    """Lays snow along every top edge of an RGBA image: a band DEPTH deep (wavy) under each run of opaque pixels."""
    a = np.asarray(img).astype(np.float64)
    h, w = a.shape[:2]
    solid = a[..., 3] >= 128
    # px of solid run above each pixel (0 at a top edge) and below it
    above = np.zeros((h, w))
    below = np.zeros((h, w))
    for y in range(1, h):
        above[y] = np.where(solid[y] & solid[y - 1], above[y - 1] + 1, 0)
    for y in range(h - 2, -1, -1):
        below[y] = np.where(solid[y] & solid[y + 1], below[y + 1] + 1, 0)
    xs = np.arange(w) / scale       # in 2x px, so both resolutions get the same wave
    depth = (DEPTH + 8 * np.sin(xs * 0.07) + 5 * np.sin(xs * 0.21 + 1.7)) * scale
    top = OUTLINE * scale
    run = above + below
    body = run >= MIN_BODY * scale
    deep = np.minimum(depth[None, :], run * SHARE)
    # Where the top edge above a pixel lies; compared a few px left and right it tells roofs from walls.
    edge = np.where(solid, np.arange(h)[:, None] - above, np.inf)
    k = max(1, int(round(4 * scale)))
    near = lambda shifted: np.abs(shifted - edge) <= STEEP * k
    left = np.full_like(edge, np.inf)
    right = np.full_like(edge, np.inf)
    left[:, k:] = edge[:, :-k]
    right[:, :-k] = edge[:, k:]
    flat = near(left) | near(right)
    band = solid & body & flat & (above >= top) & (above < top + deep)
    lip = solid & body & flat & (above >= top + deep) & (above < top + deep + 2.5 * scale)
    rgb = a[..., :3]
    lum = (rgb @ np.array([0.299, 0.587, 0.114])) / 255.0
    # keep a little of the surface's light and shade so lit and shaded slopes still read
    snow = SNOW[None, None, :] * (0.84 + 0.16 * lum)[..., None]
    out = rgb.copy()
    out[band] = snow[band]
    out[lip] = rgb[lip] * 0.45 + SNOW_LIP * 0.55
    a[..., :3] = out
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8), "RGBA")


class Snowy:
    """A canvas whose render has snow on it; the shadow layer is the original's."""

    def __init__(self, canvas):
        self.canvas = canvas
        self.w, self.h, self.ox, self.oy = canvas.w, canvas.h, canvas.ox, canvas.oy
        self.sh = canvas.sh

    def render(self, scale=1.0):
        return snow_on(self.canvas.render(scale), scale)

    def render_shadow(self, scale=1.0, *args, **kwargs):
        return self.canvas.render_shadow(scale, *args, **kwargs)


def build_winter():
    for e in [e for e in REG if e["kind"] == "image" and e["category"] == "buildings"]:
        image("buildings", f"{e['name']}_winter", Snowy(e["canvas"]), tuple(e["footprint"]), e["anchor"],
              notes=f"{e['name']} in winter: snow on the roof", shadow=e["shadow"])
