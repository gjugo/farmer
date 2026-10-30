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


def grass_tile(seed, flowers=False):
    c = tile_canvas()
    base_diamond(c, GRASS)
    grass_detail(c, seed, flowers)
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


def path_tile(arms, seed=3):
    c = tile_canvas()
    base_diamond(c, GRASS)
    grass_detail(c, seed + 11, density=0.8)
    W = 0.44
    clipid = c.clip(f'<polygon points="{pts(diamond(c))}"/>')

    def draw():
        path_union(c, arms, W, shade(GRASS_D, -0.12), grow=0.045)   # grass shadow lip
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
    return c


# ---------------------------------------------------------------- soil
def tilled_tile(watered=False, along="x"):
    c = tile_canvas(extra_top=0, extra_bottom=8)
    base_diamond(c, GRASS)
    grass_detail(c, 41, density=0.6)
    soil = "#5e3a24" if watered else SOIL
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
        if watered:
            for _ in range(5):
                x, y = rnd.uniform(0.2, 0.8), rnd.uniform(0.2, 0.8)
                sx, sy = c.P(x, y, h)
                c.ell(sx, sy, rnd.uniform(8, 13), rnd.uniform(3, 5), "#9cc7e8", 0, None, extra='opacity="0.35"')
    c.group(furrows, clip=clipid)
    return c


# ---------------------------------------------------------------- unowned
def unowned_tile(overgrown=False, seed=7):
    c = tile_canvas(extra_top=40 if overgrown else 0)
    base = "#55703f"
    base_diamond(c, base)
    rnd = random.Random(seed)
    for _ in range(6):
        x, y = rnd.uniform(0.25, 0.75), rnd.uniform(0.25, 0.75)
        cx, cy = c.P(x, y)
        r = rnd.uniform(16, 30)
        c.ell(cx, cy, r * 1.4, r * 0.7, rnd.choice(["#7a6e45", "#4a6236", "#61763f"]), 0, None, extra='opacity="0.6"')
    grass_detail(c, seed + 1, base=base, dark="#3e5530", light="#7d8f4c", density=1.3)
    if overgrown:
        items = []
        for _ in range(9):
            items.append((rnd.uniform(0.15, 0.85), rnd.uniform(0.15, 0.85), rnd.choice(["weed", "weed", "stone", "bush"])))
        items.sort(key=lambda t: t[0] + t[1])
        for x, y, kind in items:
            sx, sy = c.P(x, y)
            if kind == "stone":
                c.ell(sx, sy - 3, 9, 6, "#9a9a8c", 0)
                c.ell(sx - 2, sy - 5, 4, 2, "#c4c4b4", 0, None)
            elif kind == "bush":
                for dx, dy, r in ((-7, -6, 9), (6, -7, 8), (0, -13, 9)):
                    c.circle(sx + dx, sy + dy, r, "#4c6a32")
                c.circle(sx - 2, sy - 15, 3, "#6f8d45", None)
            else:
                for k in range(4):
                    ang = -math.pi / 2 + (k - 1.5) * 0.35
                    L = rnd.uniform(16, 26)
                    c.path(f"M{f2(sx)},{f2(sy)} q{f2(math.cos(ang) * L * 0.3)},{f2(-L * 0.6)} {f2(math.cos(ang) * L)},{f2(math.sin(ang) * L)}",
                           "none", rnd.choice(["#6d7b3a", "#8a8a46", "#3f5a2c"]), 3)
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
