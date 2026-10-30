"""Helpers to compose rendered assets onto a test map."""
from PIL import Image
from core import TW, TH

_cache = {}


def rendered(entry, scale=1.0):
    key = (entry["name"], scale)
    if key not in _cache:
        c = entry["canvas"]
        im = c.render(scale)
        sh = c.render_shadow(scale) if entry.get("shadow", True) else None
        _cache[key] = (im, sh)
    return _cache[key]


class Map:
    def __init__(self, w, h, origin, scale=0.5, bg=(118, 186, 82, 255)):
        self.img = Image.new("RGBA", (w, h), bg)
        self.ox, self.oy = origin
        self.s = scale
        self.items = []

    def screen(self, tx, ty):
        return (self.ox + (tx - ty) * TW / 2 * self.s, self.oy + (tx + ty) * TH / 2 * self.s)

    def put(self, entry, tx, ty, layer=1, depth=None, frame=None):
        fw = entry["footprint"] if "footprint" in entry else [1, 1]
        d = depth if depth is not None else (tx + ty + fw[0] + fw[1])
        self.items.append((layer, d, entry, tx, ty, frame))

    def draw(self):
        # shadows first (per layer), then sprites sorted by depth
        for layer in sorted(set(i[0] for i in self.items)):
            its = sorted([i for i in self.items if i[0] == layer], key=lambda i: i[1])
            for _, _, e, tx, ty, fr in its:
                im, sh = fr if fr else rendered(e, self.s)
                if sh is not None:
                    self._blit(sh, e, tx, ty)
            for _, _, e, tx, ty, fr in its:
                im, sh = fr if fr else rendered(e, self.s)
                self._blit(im, e, tx, ty)
        return self.img

    def _blit(self, im, e, tx, ty):
        sx, sy = self.screen(tx, ty)
        ax, ay = e["anchor"]
        self.img.alpha_composite(im, (int(round(sx - ax * self.s)), int(round(sy - ay * self.s))))
