"""Ground tiles, dirt paths, tilled soil, unowned land, fences, tile cursors."""
import math, random, itertools
from core import *
from registry import image

GRASS = "#7cc952"
GRASS_D = "#5fae3e"
GRASS_L = "#a6e06c"
DIRT = "#dcae6c"
DIRT_D = "#b9864a"
DIRT_L = "#ecc78d"
SOIL = "#8c5a35"
SOIL_D = "#6a3f22"
SOIL_L = "#a8744a"
WOOD = "#cf9152"
WOOD_D = "#a96b35"

EDGES = {"ne": (0, -1), "se": (1, 0), "sw": (0, 1), "nw": (-1, 0)}  # world dir from centre

# ---------------------------------------------------------------- seasons
# Every ground tile also comes in four seasonal versions (`grass_1_winter`, ...). season=None is the pack's
# original look, drawn exactly as before.
SEASONS = ("spring", "summer", "autumn", "winter")
GRASS_SEASON = {  # base, dark, light
    "spring": ("#86d35a", "#62b842", "#b9ee80"),
    "summer": ("#5aa038", "#45842a", "#86bf4a"),
    "autumn": ("#a99a46", "#7f7432", "#d0b35a"),
    "winter": ("#e9eff5", "#c8d4df", "#ffffff"),
}
SNOW = "#f1f5fa"
SNOW_D = "#c3d0dc"
FLOWERS = ("#ffffff", "#ffe066", "#ff9ec4", "#c9a7ff")
LEAVES = ("#dd7a2a", "#c4432c", "#ebb534", "#a5552a")


def tile_canvas(extra_top=0, extra_bottom=0):
    return Canvas(TW, TH + extra_top + extra_bottom, TW / 2, extra_top)


def diamond(c, inset=0.0):
    return c.PP([(inset, inset), (1 - inset, inset), (1 - inset, 1 - inset), (inset, 1 - inset)])


def base_diamond(c, color):
    # stroke in the same colour: tiles overlap ~1px so no hairline seams appear in-engine
    c.poly(diamond(c), color, stroke=color, sw=2.0)


def tuft(c, x, y, color, size=1.0):
    sx, sy = c.P(x, y)
    s = 7 * size
    d = f"M{f2(sx - s)},{f2(sy - s * 0.3)} Q{f2(sx - s * 0.3)},{f2(sy)} {f2(sx)},{f2(sy)} Q{f2(sx - s * 0.1)},{f2(sy - s * 1.4)} {f2(sx + s * 0.2)},{f2(sy - s * 1.6)} " \
        f"Q{f2(sx + s * 0.2)},{f2(sy - s * 0.4)} {f2(sx + s * 0.4)},{f2(sy)} Q{f2(sx + s * 0.6)},{f2(sy - s * 0.9)} {f2(sx + s * 1.1)},{f2(sy - s * 0.9)} Q{f2(sx + s * 0.6)},{f2(sy - s * 0.2)} {f2(sx + s * 0.6)},{f2(sy)} Z"
    c.path(d, color, None)


def grass_detail(c, seed, flowers=False, base=GRASS, dark=GRASS_D, light=GRASS_L, density=1.0):
    rnd = random.Random(seed)
    # soft colour blotches (kept inside the tile so edges stay uniform)
    for _ in range(5):
        x, y = rnd.uniform(0.25, 0.75), rnd.uniform(0.25, 0.75)
        cx, cy = c.P(x, y)
        r = rnd.uniform(18, 34)
        col = rnd.choice([shade(base, 0.08), shade(base, -0.05)])
        c.ell(cx, cy, r * 1.4, r * 0.7, col, 0, None, extra='opacity="0.55"')
    for _ in range(int(16 * density)):
        x, y = rnd.uniform(0.12, 0.88), rnd.uniform(0.12, 0.88)
        tuft(c, x, y, rnd.choice([dark, dark, light]), rnd.uniform(0.7, 1.15))
    if flowers:
        for _ in range(5):
            x, y = rnd.uniform(0.18, 0.82), rnd.uniform(0.18, 0.82)
            sx, sy = c.P(x, y)
            col = rnd.choice(["#ffffff", "#ffe066", "#ff9ec4", "#c9a7ff"])
            for a in range(5):
                ang = a * 72 * math.pi / 180
                c.ell(sx + 3.2 * math.cos(ang), sy + 1.8 * math.sin(ang) - 2, 2.6, 1.8, col, 0, None)
            c.circle(sx, sy - 2, 1.6, "#f2a33a", None)


def dry_patches(c, seed):
    """Sun-dried patches in summer grass."""
    rnd = random.Random(seed + 5)
    for _ in range(rnd.randint(2, 3)):
        x, y = rnd.uniform(0.3, 0.7), rnd.uniform(0.3, 0.7)
        cx, cy = c.P(x, y)
        r = rnd.uniform(12, 20)
        c.ell(cx, cy, r * 1.4, r * 0.7, rnd.choice(["#b8ad5c", "#a99f50", "#c2b467"]), 0, None, extra='opacity="0.6"')


def fallen_leaves(c, seed, n, area=(0.12, 0.88)):
    """Autumn leaves lying on the ground."""
    rnd = random.Random(seed + 9)
    for _ in range(n):
        x, y = rnd.uniform(*area), rnd.uniform(*area)
        sx, sy = c.P(x, y)
        col = rnd.choice(LEAVES)
        c.ell(sx, sy, 4.6, 2.3, col, rnd.uniform(0, 180), shade(col, -0.35), 1.0)


def snow_detail(c, seed, density=1.0, tufts=("#7d9161", "#93a374", "#6b7f52"), base=SNOW):
    """Snow cover: soft drifts, a little grass poking through, glints."""
    rnd = random.Random(seed)
    for _ in range(5):
        x, y = rnd.uniform(0.25, 0.75), rnd.uniform(0.25, 0.75)
        cx, cy = c.P(x, y)
        r = rnd.uniform(16, 30)
        c.ell(cx, cy, r * 1.4, r * 0.7, rnd.choice([SNOW_D, "#ffffff", "#dbe4ec"]), 0, None, extra='opacity="0.5"')
    for _ in range(int(6 * density)):
        x, y = rnd.uniform(0.15, 0.85), rnd.uniform(0.15, 0.85)
        sx, sy = c.P(x, y)
        tuft(c, x, y, rnd.choice(tufts), rnd.uniform(0.55, 0.85))
        c.ell(sx + 1, sy, 7, 2.6, base, 0, None)
    for _ in range(8):
        x, y = rnd.uniform(0.15, 0.85), rnd.uniform(0.15, 0.85)
        sx, sy = c.P(x, y)
        c.circle(sx, sy, 1.3, "#ffffff", None)


def ground(c, seed, season=None, density=1.0, flowers=False):
    """The grass a tile lies on: the pack's own (season None) or a season's."""
    if season is None:
        base_diamond(c, GRASS)
        grass_detail(c, seed, flowers, density=density)
        return
    base, dark, light = GRASS_SEASON[season]
    base_diamond(c, base)
    if season == "winter":
        snow_detail(c, seed, density)
        return
    if season == "summer":
        dry_patches(c, seed)
    grass_detail(c, seed, flowers or season == "spring", base, dark, light, density)
    if season == "autumn":
        fallen_leaves(c, seed, int(7 * density) + 1)


def grass_tile(seed, flowers=False, season=None):
    c = tile_canvas()
    ground(c, seed, season, flowers=flowers)
    return c


# ---------------------------------------------------------------- dirt paths
def path_union(c, arms, w, color, grow=0.0):
    hw = w / 2 + grow
    for a in arms:
        dx, dy = EDGES[a]
        if dx == 0:
            x0, x1 = 0.5 - hw, 0.5 + hw
            y0, y1 = (-0.05, 0.5) if dy < 0 else (0.5, 1.05)
        else:
            y0, y1 = 0.5 - hw, 0.5 + hw
            x0, x1 = (-0.05, 0.5) if dx < 0 else (0.5, 1.05)
        c.poly(c.PP([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]), color, None)
    cx, cy = c.P(0.5, 0.5)
    c.ell(cx, cy, K * hw * 1.4142, K * hw * 0.7071, color, 0, None)


def in_path(x, y, arms, hw):
    if (x - 0.5) ** 2 + (y - 0.5) ** 2 <= hw * hw:
        return True
    for a in arms:
        dx, dy = EDGES[a]
        if dx == 0 and abs(x - 0.5) <= hw and ((dy < 0 and y <= 0.5) or (dy > 0 and y >= 0.5)):
            return True
        if dy == 0 and abs(y - 0.5) <= hw and ((dx < 0 and x <= 0.5) or (dx > 0 and x >= 0.5)):
            return True
    return False


def path_tile(arms, seed=3, season=None):
    c = tile_canvas()
    ground(c, seed + 11, season, 0.8)
    W = 0.44
    clipid = c.clip(f'<polygon points="{pts(diamond(c))}"/>')
    lip = shade(GRASS_D if season is None else GRASS_SEASON[season][1], -0.12)

    def draw():
        path_union(c, arms, W, lip, grow=0.045)   # grass shadow lip
        path_union(c, arms, W, DIRT_D, grow=0.02)
        path_union(c, arms, W, DIRT)
        path_union(c, arms, W * 0.55, DIRT_L)                          # worn centre
    c.group(draw, clip=clipid)
    rnd = random.Random(seed + len(arms) * 7 + sum(ord(a[0]) + ord(a[1]) for a in arms))
    hw = W / 2 - 0.04
    n = 0
    while n < 14:
        x, y = rnd.uniform(0.08, 0.92), rnd.uniform(0.08, 0.92)
        if not in_path(x, y, arms, hw) or min(x, y, 1 - x, 1 - y) < 0.1:
            continue
        sx, sy = c.P(x, y)
        r = rnd.uniform(2.5, 5)
        c.ell(sx, sy, r * 1.3, r * 0.8, rnd.choice([DIRT_D, "#c9b9a2", "#e8d9bf"]), 0, shade(DIRT_D, -0.2), 1.2)
        n += 1
    if season == "winter":
        # a dusting of snow over the dirt, thicker in drifts
        c.group(lambda: path_union(c, arms, W, SNOW, grow=0.02), clip=clipid, opacity=0.55)
        k = 0
        while k < 12:
            x, y = rnd.uniform(0.08, 0.92), rnd.uniform(0.08, 0.92)
            if not in_path(x, y, arms, W / 2) or min(x, y, 1 - x, 1 - y) < 0.06:
                continue
            sx, sy = c.P(x, y)
            r = rnd.uniform(5, 12)
            c.ell(sx, sy, r * 1.5, r * 0.7, rnd.choice([SNOW, "#ffffff", "#e4ebf2"]), 0, None, extra='opacity="0.85"')
            k += 1
    elif season == "autumn":
        fallen_leaves(c, seed + len(arms), 3, (0.25, 0.75))
    return c


# ---------------------------------------------------------------- soil
def tilled_tile(watered=False, along="x", season=None):
    c = tile_canvas(extra_top=0, extra_bottom=8)
    ground(c, 41, season, 0.6)
    soil = "#5e3a24" if watered else SOIL
    if season == "winter":
        soil = "#6e5e57" if watered else "#86736a"   # frozen: grey, dull
    i, h = 0.07, 0.03
    rnd = random.Random(17 if along == "x" else 23)
    # low earthen bed: soft sides then top
    c.poly(c.PP([(i, 1 - i, 0), (1 - i, 1 - i, 0), (1 - i, 1 - i, h), (i, 1 - i, h)]), shade(soil, -0.28), None)
    c.poly(c.PP([(1 - i, i, 0), (1 - i, 1 - i, 0), (1 - i, 1 - i, h), (1 - i, i, h)]), shade(soil, -0.4), None)
    top = c.PP([(i, i, h), (1 - i, i, h), (1 - i, 1 - i, h), (i, 1 - i, h)])
    c.poly(top, shade(soil, -0.18), shade(soil, -0.45), 2.5)
    clipid = c.clip(f'<polygon points="{pts(top)}"/>')
    rows = 4

    def furrows():
        for r in range(rows):
            t = i + (r + 0.5) * (1 - 2 * i) / rows
            seg = []
            for k in range(13):
                s = -0.05 + k * 0.1
                p = (s, t, h) if along == "x" else (t, s, h)
                seg.append(c.P(*p))
            d = "M" + " L".join(f"{f2(x)},{f2(y + 4)}" for x, y in seg)
            c.path(d, "none", shade(soil, -0.42), 20)                     # groove shadow
            d = "M" + " L".join(f"{f2(x)},{f2(y + (1.5 if k % 2 else -1.5))}" for k, (x, y) in enumerate(seg))
            c.path(d, "none", soil, 15)                                    # mound
            d = "M" + " L".join(f"{f2(x)},{f2(y - 4)}" for x, y in seg)
            c.path(d, "none", shade(soil, 0.18), 4, extra='stroke-opacity="0.7"')  # lit crest
        for _ in range(26):
            x, y = rnd.uniform(i + 0.03, 1 - i - 0.03), rnd.uniform(i + 0.03, 1 - i - 0.03)
            sx, sy = c.P(x, y, h)
            c.ell(sx, sy, rnd.uniform(1.5, 3), rnd.uniform(1, 2), rnd.choice([shade(soil, 0.3), shade(soil, -0.4)]), 0, None)
        if watered and season != "winter":
            for _ in range(5):
                x, y = rnd.uniform(0.2, 0.8), rnd.uniform(0.2, 0.8)
                sx, sy = c.P(x, y, h)
                c.ell(sx, sy, rnd.uniform(8, 13), rnd.uniform(3, 5), "#9cc7e8", 0, None, extra='opacity="0.35"')
        if season == "winter":
            frost(rnd, watered)
        elif season == "autumn":
            fallen_leaves(c, 43, 3, (0.2, 0.8))

    def frost(rnd, watered):
        """Frozen soil: snow lying in the furrows, drifts, rime and (watered) ice."""
        for r in range(rows):
            t = i + (r + 0.5) * (1 - 2 * i) / rows
            seg = [c.P(*((-0.05 + k * 0.1, t, h) if along == "x" else (t, -0.05 + k * 0.1, h))) for k in range(13)]
            d = "M" + " L".join(f"{f2(x)},{f2(y + 3)}" for x, y in seg)
            c.path(d, "none", SNOW, 9, extra=f'stroke-dasharray="{22 + r * 3} {12 + r * 2}" opacity="0.9"')
        for _ in range(4 if watered else 0):
            x, y = rnd.uniform(0.2, 0.8), rnd.uniform(0.2, 0.8)
            sx, sy = c.P(x, y, h)
            c.ell(sx, sy, rnd.uniform(9, 14), rnd.uniform(3.5, 5), "#d3eaf8", 0, "#9cc2dc", 1.2, extra='opacity="0.85"')
        for _ in range(6):
            x, y = rnd.uniform(i + 0.05, 1 - i - 0.05), rnd.uniform(i + 0.05, 1 - i - 0.05)
            sx, sy = c.P(x, y, h)
            r_ = rnd.uniform(7, 15)
            c.ell(sx, sy, r_ * 1.5, r_ * 0.65, rnd.choice([SNOW, "#ffffff", "#e2e9f0"]), 0, None, extra='opacity="0.9"')
        for _ in range(20):
            x, y = rnd.uniform(i + 0.03, 1 - i - 0.03), rnd.uniform(i + 0.03, 1 - i - 0.03)
            sx, sy = c.P(x, y, h)
            c.circle(sx, sy, rnd.uniform(1, 2), "#ffffff", None, extra='opacity="0.8"')
    c.group(furrows, clip=clipid)
    return c


# ---------------------------------------------------------------- unowned
# Locked land per season. None is the pack's original.
UNOWNED_SEASON = {
    None: dict(base="#55703f", blotch=("#7a6e45", "#4a6236", "#61763f"), dark="#3e5530", light="#7d8f4c",
               weeds=("#6d7b3a", "#8a8a46", "#3f5a2c"), bush="#4c6a32", bush_l="#6f8d45", stone="#9a9a8c", stone_l="#c4c4b4"),
    "spring": dict(base="#5c8243", blotch=("#6f8a48", "#4f703a", "#7a9a50"), dark="#43643a", light="#93b85e",
                   weeds=("#5f8a3a", "#7aa04a", "#3f6a2c"), bush="#4f7a36", bush_l="#f6c4d8", stone="#9a9a8c", stone_l="#c4c4b4"),
    "summer": dict(base="#4d6a33", blotch=("#8a7e45", "#3f5a2a", "#5b7436"), dark="#38502a", light="#7a8a44",
                   weeds=("#5d7232", "#86843f", "#3a5228"), bush="#3f6229", bush_l="#5f8238", stone="#9a9a8c", stone_l="#c4c4b4"),
    "autumn": dict(base="#7a6c38", blotch=("#8f5c2e", "#6a6833", "#9c7c38"), dark="#5a5026", light="#a88c48",
                   weeds=("#9a7a3a", "#b08a42", "#6a5a2c"), bush="#a8602c", bush_l="#e09a3a", stone="#9a958a", stone_l="#c4c0b4"),
    "winter": dict(base="#d2dce5", blotch=("#c0ccd8", "#e2e9f0", "#b6c4d0"), dark="#5f6f4c", light="#7f8a62",
                   weeds=("#8a7a5a", "#a08e66", "#6e6248"), bush="#6b6550", bush_l=SNOW, stone="#9a9a92", stone_l=SNOW),
}


def unowned_tile(overgrown=False, seed=7, season=None):
    c = tile_canvas(extra_top=40 if overgrown else 0)
    pal = UNOWNED_SEASON[season]
    base = pal["base"]
    base_diamond(c, base)
    rnd = random.Random(seed)
    for _ in range(6):
        x, y = rnd.uniform(0.25, 0.75), rnd.uniform(0.25, 0.75)
        cx, cy = c.P(x, y)
        r = rnd.uniform(16, 30)
        c.ell(cx, cy, r * 1.4, r * 0.7, rnd.choice(pal["blotch"]), 0, None, extra='opacity="0.6"')
    if season == "winter":
        snow_detail(c, seed + 1, 1.6, tufts=(pal["dark"], pal["light"], "#6b7f52"), base=base)
    else:
        grass_detail(c, seed + 1, base=base, dark=pal["dark"], light=pal["light"], density=1.3)
    if season == "spring":
        sprinkle = random.Random(seed + 2)
        for _ in range(3):
            sx, sy = c.P(sprinkle.uniform(0.2, 0.8), sprinkle.uniform(0.2, 0.8))
            col = sprinkle.choice(FLOWERS)
            for a in range(5):
                ang = a * 72 * math.pi / 180
                c.ell(sx + 3 * math.cos(ang), sy + 1.7 * math.sin(ang) - 2, 2.4, 1.7, col, 0, None)
            c.circle(sx, sy - 2, 1.5, "#f2a33a", None)
    elif season == "autumn":
        fallen_leaves(c, seed, 7)
    if overgrown:
        items = []
        for _ in range(9):
            items.append((rnd.uniform(0.15, 0.85), rnd.uniform(0.15, 0.85), rnd.choice(["weed", "weed", "stone", "bush"])))
        items.sort(key=lambda t: t[0] + t[1])
        for x, y, kind in items:
            sx, sy = c.P(x, y)
            if kind == "stone":
                c.ell(sx, sy - 3, 9, 6, pal["stone"], 0)
                c.ell(sx - 2, sy - 5, 4, 2, pal["stone_l"], 0, None)
                if season == "winter":
                    c.ell(sx - 1, sy - 6, 7, 3.2, SNOW, 0, None)
            elif kind == "bush":
                for dx, dy, r in ((-7, -6, 9), (6, -7, 8), (0, -13, 9)):
                    c.circle(sx + dx, sy + dy, r, pal["bush"])
                c.circle(sx - 2, sy - 15, 3, pal["bush_l"], None)
                if season == "winter":
                    c.ell(sx - 1, sy - 18, 9, 4, SNOW, 0, None)
                    c.ell(sx + 7, sy - 12, 5, 2.4, SNOW, 0, None)
                elif season in ("spring", "autumn"):
                    for dx, dy in ((-8, -8), (5, -10), (1, -5)):
                        c.circle(sx + dx, sy + dy, 2.4, pal["bush_l"], None)
            else:
                for k in range(4):
                    ang = -math.pi / 2 + (k - 1.5) * 0.35
                    L = rnd.uniform(16, 26)
                    c.path(f"M{f2(sx)},{f2(sy)} q{f2(math.cos(ang) * L * 0.3)},{f2(-L * 0.6)} {f2(math.cos(ang) * L)},{f2(math.sin(ang) * L)}",
                           "none", rnd.choice(pal["weeds"]), 3)
    return c


def overlay_tile(kind):
    c = tile_canvas()
    if kind == "locked":
        c.poly(diamond(c), "#1d2418", None, extra='opacity="0.45"')
        clipid = c.clip(f'<polygon points="{pts(diamond(c))}"/>')

        def hatch():
            for i in range(-12, 14):
                x0 = i * 22
                c.line((x0, 0), (x0 + 128, 128), "#000", 4, opacity=0.18)
        c.group(hatch, clip=clipid)
    else:
        col = {"cursor": "#ffffff", "cursor_ok": "#7dff7a", "cursor_bad": "#ff5a4a"}[kind]
        c.poly(diamond(c, 0.03), col, col, 5, extra='fill-opacity="0.18" stroke-opacity="0.95"')
        for (x, y) in ((0.03, 0.03), (0.97, 0.03), (0.97, 0.97), (0.03, 0.97)):
            sx, sy = c.P(x, y)
            c.circle(sx, sy, 5, col, OUT, 2)
    return c


# ---------------------------------------------------------------- fences
FENCE_H = 0.40


def rail(c, a3, b3, z, color):
    a, b = c.P(a3[0], a3[1], z), c.P(b3[0], b3[1], z)
    c.line(a, b, OUT, 11 + 2 * OW, cap="butt")
    c.line(a, b, color, 11, cap="butt")
    c.line((a[0], a[1] - 3), (b[0], b[1] - 3), shade(color, 0.28), 2.5, cap="butt")


def post(c, x, y, h=FENCE_H, w=0.045, color=WOOD_D):
    c.box(x - w, y - w, 0, x + w, y + w, h, shade(color, 0.2), shade(color, 0.05), shade(color, -0.15), sw=2.5, grad=False)
    tx, ty = c.P(x + w, y + w, h)
    c.poly([c.P(x - w, y - w, h), c.P(x + w, y - w, h), c.P(x + w, y + w, h), c.P(x - w, y + w, h)], shade(color, 0.35), OUT, 2.5)


def fence_tile(arms):
    c = Canvas(TW, TH + 84, TW / 2, 84)
    back = [a for a in arms if a in ("ne", "nw")]
    front = [a for a in arms if a in ("se", "sw")]

    def arm(a):
        dx, dy = EDGES[a]
        end = (0.5 + dx * 0.5, 0.5 + dy * 0.5)
        mid = (0.5 + dx * 0.25, 0.5 + dy * 0.25)
        c.shadow_pts([(0.5, 0.5, 0), (end[0], end[1], 0), (0.5, 0.5, 0.34), (end[0], end[1], 0.34)])
        for z in (0.13, 0.29):
            rail(c, (0.5, 0.5), end, z, WOOD)
    for a in back:
        arm(a)
    post(c, 0.5, 0.5)
    for a in front:
        arm(a)
    return c


def gate_tile(along="x", open_=False):
    c = Canvas(TW, TH + 92, TW / 2, 92)
    # posts near the two tile edges along the run; panel between
    if along == "x":
        p0, p1 = (0.1, 0.5), (0.9, 0.5)
        u = (1, 0)
    else:
        p0, p1 = (0.5, 0.1), (0.5, 0.9)
        u = (0, 1)
    L = 0.74
    ang = math.radians(75) if open_ else 0.0
    # hinge at p0 ; swing toward +y (x run) or +x (y run)
    if along == "x":
        tip = (p0[0] + 0.06 + L * math.cos(ang), p0[1] + L * math.sin(ang))
    else:
        tip = (p0[0] + L * math.sin(ang), p0[1] + 0.06 + L * math.cos(ang))
    hinge = (p0[0] + 0.06 * u[0], p0[1] + 0.06 * u[1])
    c.shadow_pts([(hinge[0], hinge[1], 0), (tip[0], tip[1], 0), (hinge[0], hinge[1], 0.36), (tip[0], tip[1], 0.36)])

    def panel():
        z0, z1 = 0.07, 0.36
        a0, a1 = c.P(hinge[0], hinge[1], z0), c.P(tip[0], tip[1], z0)
        b0, b1 = c.P(hinge[0], hinge[1], z1), c.P(tip[0], tip[1], z1)
        for z in (z0 + 0.03, z1 - 0.03):
            rail(c, hinge, tip, z, "#e0a868")
        # vertical slats
        for t in (0.0, 0.33, 0.66, 1.0):
            x = hinge[0] + (tip[0] - hinge[0]) * t
            y = hinge[1] + (tip[1] - hinge[1]) * t
            c.limb(c.P(x, y, z0), c.P(x, y, z1), "#e0a868", 8)
        c.limb(c.P(hinge[0], hinge[1], z0 + 0.03), c.P(tip[0], tip[1], z1 - 0.03), "#c98b4c", 7)

    # paint order: things further back (smaller x+y) first
    e0 = (0.0, 0.5) if along == "x" else (0.5, 0.0)
    e1 = (1.0, 0.5) if along == "x" else (0.5, 1.0)

    def stub(a, b):
        def f():
            for z in (0.13, 0.29):
                rail(c, a, b, z, WOOD)
        return f
    items = [(e0[0] + e0[1] + 0.01, stub(e0, p0)), (p1[0] + p1[1] + 0.05, stub(p1, e1)),
             (p0[0] + p0[1], lambda: post(c, p0[0], p0[1], 0.46, 0.06)),
             (p1[0] + p1[1], lambda: post(c, p1[0], p1[1], 0.46, 0.06)),
             ((hinge[0] + tip[0] + hinge[1] + tip[1]) / 2 + (0.02 if open_ else 0.0), panel)]
    for _, f in sorted(items, key=lambda t: t[0]):
        f()
    # rails continuing to the tile edges so gates join the fence line
    return c


def build():
    for i in range(3):
        image("tiles", f"grass_{i}", grass_tile(100 + i, flowers=(i == 2)))
    combos = []
    names = ["ne", "se", "sw", "nw"]
    for n in range(0, 5):
        for arms in itertools.combinations(names, n):
            combos.append(arms)
    kinds = {0: "single", 1: "end", 4: "cross"}
    for arms in combos:
        nm = "path_" + ("_".join(arms) if arms else "single")
        n = len(arms)
        if n == 2:
            kind = "straight" if set(arms) in ({"ne", "sw"}, {"se", "nw"}) else "corner"
        elif n == 3:
            kind = "t"
        else:
            kind = kinds[n]
        image("tiles", nm, path_tile(list(arms)), notes=f"dirt path {kind}; connects to edges: {', '.join(arms) or 'none'}", shadow=False)
    for along in ("x", "y"):
        image("tiles", f"soil_tilled_{along}", tilled_tile(False, along), notes="tilled soil bed; furrows run along world " + along, shadow=False)
        image("tiles", f"soil_watered_{along}", tilled_tile(True, along), notes="watered tilled soil", shadow=False)
    image("tiles", "unowned_0", unowned_tile(False, 7), notes="unowned land (dark)", shadow=False)
    image("tiles", "unowned_1", unowned_tile(True, 9), notes="unowned land (overgrown)", shadow=False)
    image("tiles", "overlay_locked", overlay_tile("locked"), notes="semi-transparent overlay to dim any tile as not-owned", shadow=False)
    for k in ("cursor", "cursor_ok", "cursor_bad"):
        image("tiles", f"overlay_{k}", overlay_tile(k), notes="tile selection cursor", shadow=False)
    for arms in combos:
        nm = "fence_" + ("_".join(arms) if arms else "post")
        image("fences", nm, fence_tile(list(arms)), notes="fence through tile centre; rails reach edges: " + (", ".join(arms) or "none"))
    for along in ("x", "y"):
        dirn = "ne_sw" if along == "y" else "se_nw"
        image("fences", f"gate_{dirn}_closed", gate_tile(along, False), notes=f"gate in a fence running {dirn}")
        image("fences", f"gate_{dirn}_open", gate_tile(along, True), notes=f"open gate in a fence running {dirn}")


def build_seasons():
    """Every ground tile in its four seasonal versions, named `<tile>_<season>` (see seasonal.py)."""
    combos = [arms for n in range(0, 5) for arms in itertools.combinations(["ne", "se", "sw", "nw"], n)]
    for season in SEASONS:
        for i in range(3):
            image("tiles", f"grass_{i}_{season}", grass_tile(100 + i, flowers=(i == 2), season=season), notes=f"grass in {season}")
        for arms in combos:
            nm = "path_" + ("_".join(arms) if arms else "single")
            image("tiles", f"{nm}_{season}", path_tile(list(arms), season=season), notes=f"{nm} in {season}", shadow=False)
        for along in ("x", "y"):
            image("tiles", f"soil_tilled_{along}_{season}", tilled_tile(False, along, season), notes=f"tilled soil in {season}", shadow=False)
            image("tiles", f"soil_watered_{along}_{season}", tilled_tile(True, along, season), notes=f"watered soil in {season}", shadow=False)
        image("tiles", f"unowned_0_{season}", unowned_tile(False, 7, season), notes=f"unowned land in {season}", shadow=False)
        image("tiles", f"unowned_1_{season}", unowned_tile(True, 9, season), notes=f"overgrown unowned land in {season}", shadow=False)
