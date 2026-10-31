"""Nature + farm props, each on a 1x1 tile footprint."""
import math, random
from core import *
from registry import image
from buildings import hay, crate, sack, milk_can
from tiles import SEASONS, SNOW, SNOW_D, LEAVES

BARK = "#7a5234"
AUTUMN = ("#e0782a", "#c8452e", "#e8b830", "#d35f2a", "#b8522a")
BLOSSOM = {"white": ("#ffffff", "#fff3dc", "#fde2ec"), "pink": ("#ffc2d8", "#ffffff", "#ff9ec4")}


def pcanvas(top=300):
    return Canvas(TW + 160, TH + top + 60, TW / 2 + 30, top)


def foliage(c, cx, cy, cz, R, col, seed, n=7):
    """col: one colour, or a tuple to pick each blob's colour from (autumn)."""
    rnd = random.Random(seed)
    pick = random.Random(seed + 31)
    blobs = [(cx, cy, cz + R * 0.1, R)]
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.3, 0.3)
        d = R * rnd.uniform(0.45, 0.7)
        blobs.append((cx + math.cos(a) * d, cy + math.sin(a) * d, cz + rnd.uniform(-0.25, 0.35) * R, R * rnd.uniform(0.5, 0.68)))
    blobs.append((cx - R * 0.15, cy - R * 0.15, cz + R * 0.55, R * 0.55))
    blobs.sort(key=lambda b: b[0] + b[1] + b[2] * 0.6)
    for (x, y, z, r) in blobs:
        c.ellipsoid((x, y, z), (r, r, r * 0.92), col if isinstance(col, str) else pick.choice(col), hi=0.3, lo=-0.25)
    return blobs


def blossom(c, blobs, seed, colours, per=6, size=3.2):
    """Small flowers dotted over the front blobs of a crown."""
    rnd = random.Random(seed + 13)
    for (x, y, z, r) in blobs[-6:]:
        for _ in range(per):
            p = c.P(x + rnd.uniform(-0.6, 0.9) * r, y + rnd.uniform(-0.6, 0.9) * r, z + rnd.uniform(-0.3, 0.6) * r)
            col = rnd.choice(colours)
            for a in range(5):
                ang = a * 72 * math.pi / 180 + 0.3
                c.circle(p[0] + size * 0.8 * math.cos(ang), p[1] + size * 0.8 * math.sin(ang), size * 0.62, col, None)
            c.circle(p[0], p[1], size * 0.35, "#f2c14e", None)


def bare_branches(c, x, y, z0, seed, spread, height, n, width, snow=True, berries=None):
    """Leafless branches fanning up from (x, y, z0), with snow lying along their tops."""
    rnd = random.Random(seed)
    arms = []
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.35, 0.35)
        d = spread * rnd.uniform(0.6, 1.0)
        zt = z0 + height * rnd.uniform(0.65, 1.0)
        tip = (x + math.cos(a) * d, y + math.sin(a) * d, zt)
        mid = (x + math.cos(a) * d * 0.45, y + math.sin(a) * d * 0.45, z0 + (zt - z0) * 0.5)
        arms.append((tip, mid, a))
    arms.sort(key=lambda t: t[0][0] + t[0][1])
    for tip, mid, a in arms:
        P0, Pm, Pt = c.P(x, y, z0), c.P(*mid), c.P(*tip)
        c.limb(P0, Pm, BARK, width)
        c.limb(Pm, Pt, BARK, width * 0.62)
        twigs = []
        for side in (-1, 1):
            b = a + side * rnd.uniform(0.5, 0.9)
            L = spread * rnd.uniform(0.22, 0.35)
            end = (mid[0] + (tip[0] - mid[0]) * 0.5 + math.cos(b) * L, mid[1] + (tip[1] - mid[1]) * 0.5 + math.sin(b) * L,
                   mid[2] + (tip[2] - mid[2]) * 0.5 + height * rnd.uniform(0.15, 0.3))
            start = c.P(mid[0] + (tip[0] - mid[0]) * 0.5, mid[1] + (tip[1] - mid[1]) * 0.5, mid[2] + (tip[2] - mid[2]) * 0.5)
            c.limb(start, c.P(*end), BARK, max(2.0, width * 0.35))
            twigs.append((start, c.P(*end)))
        if snow:
            for p, q, w in ((P0, Pm, width * 0.5), (Pm, Pt, width * 0.42)):
                c.line((p[0], p[1] - width * 0.42), (q[0], q[1] - width * 0.3), SNOW, w)
            for p, q in twigs:
                c.line((p[0], p[1] - 2), (q[0], q[1] - 1.5), SNOW, max(1.6, width * 0.22))
            c.circle(Pt[0], Pt[1] - width * 0.3, width * 0.38, SNOW, None)
        if berries:
            for p, q in twigs:
                c.circle(q[0], q[1], 4, berries, OUT, 1.5)


def snow_mound(c, x, y, r):
    cx, cy = c.P(x, y)
    c.ell(cx, cy, K * r * 1.3, K * r * 0.55, SNOW, 0, SNOW_D, 2)
    c.ell(cx - K * r * 0.3, cy - K * r * 0.12, K * r * 0.6, K * r * 0.2, "#ffffff", 0, None)


def tree_round(seed=1, fruit=None, col="#5bb540", season=None, flowers="white"):
    c = pcanvas(330)
    if season == "winter":
        # bare and snowy
        c.shadow_ell(0.5, 0.5, 0.26, z=0.9)
        snow_mound(c, 0.5, 0.5, 0.2)
        c.cylinder(0.5, 0.5, 0, 0.45, 0.08, "#8a5a32", r1=0.06, shadow=False)
        bare_branches(c, 0.5, 0.5, 0.42, seed, 0.36, 0.72, 7, 10)
        return c
    c.shadow_ell(0.5, 0.5, 0.42, z=0.9)
    c.cylinder(0.5, 0.5, 0, 0.45, 0.08, "#8a5a32", r1=0.06, shadow=False)
    if season == "spring":
        col = mix(col, "#a8e070", 0.35)
    elif season == "summer":
        col = shade(col, -0.1)
    elif season == "autumn":
        col = AUTUMN
    blobs = foliage(c, 0.5, 0.5, 0.82, 0.38, col, seed, n=8)
    if season == "spring":
        blossom(c, blobs, seed, BLOSSOM[flowers])
        fruit = None
    if fruit:
        rnd = random.Random(seed + 5)
        for (x, y, z, r) in blobs[-5:]:
            for _ in range(2):
                p = c.P(x + rnd.uniform(-r, r) * 0.5 + r * 0.4, y + r * 0.4, z + rnd.uniform(-r, r) * 0.4)
                c.circle(p[0], p[1], 6, fruit, OUT, 2)
                c.circle(p[0] - 2, p[1] - 2, 2, "#ffffff", None)
    return c


PINE = {None: "#2f8f4e", "spring": "#38a058", "summer": "#2f8f4e", "autumn": "#2d8049", "winter": "#2a6c48"}


def tree_pine(seed=2, season=None):
    c = pcanvas(360)
    c.shadow_ell(0.5, 0.5, 0.26, z=1.0)
    if season == "winter":
        snow_mound(c, 0.5, 0.5, 0.2)
    c.cylinder(0.5, 0.5, 0, 0.3, 0.06, "#7a4a2a", shadow=False)
    col = PINE[season]
    rnd = random.Random(seed)
    for k, (z0, z1, r) in enumerate(((0.22, 0.85, 0.34), (0.55, 1.15, 0.27), (0.85, 1.45, 0.19))):
        c.cone(0.5, 0.5, z0, z1, r, shade(col, 0.06 * k), shadow=False)
        base = c.P(0.5, 0.5, z0)
        if season == "winter":
            # snow lying on each tier: a white cap and a snowy hem
            c.cone(0.5, 0.5, z0 + (z1 - z0) * 0.42, z1, r * 0.58, SNOW, sw=2.0, shadow=False)
            c.path(f"M{f2(base[0] - K * r * 1.1)},{f2(base[1] - 6)} q{f2(K * r * 0.55)},{f2(14)} {f2(K * r * 1.1)},{f2(4)} "
                   f"q{f2(K * r * 0.55)},{f2(-4)} {f2(K * r * 1.0)},{f2(-10)}", "none", SNOW, 6)
            continue
        # snowless highlight streaks
        c.path(f"M{f2(base[0] - K * r * 0.9)},{f2(base[1] - 4)} q{f2(K * r * 0.5)},{f2(10)} {f2(K * r * 0.9)},{f2(2)}", "none", shade(col, -0.3), 2.5)
        if season == "spring":
            # pale new growth at the tips
            for _ in range(7):
                a = rnd.uniform(0.15, 0.85)
                p = (base[0] + K * r * 1.3 * (a * 2 - 1), base[1] - 6 + 14 * (1 - abs(a * 2 - 1)))
                c.circle(p[0], p[1], 3.2, "#a6e06c", None)
    return c


def bush(seed=3, berries=None, col="#4fa83a", season=None):
    c = pcanvas(160)
    if season == "winter":
        c.shadow_ell(0.5, 0.5, 0.2, z=0.2)
        snow_mound(c, 0.5, 0.5, 0.17)
        bare_branches(c, 0.5, 0.5, 0.0, seed, 0.2, 0.36, 6, 6, berries=berries and "#c4304a")
        return c
    c.shadow_ell(0.5, 0.5, 0.28, z=0.2)
    if season == "spring":
        col = mix(col, "#a8e070", 0.35)
    elif season == "summer":
        col = shade(col, -0.1)
    elif season == "autumn":
        col = AUTUMN
    blobs = foliage(c, 0.5, 0.5, 0.17, 0.2, col, seed, n=6)
    if season == "spring":
        blossom(c, blobs, seed, BLOSSOM["white" if berries else "pink"], per=3, size=2.8)
        berries = None
    elif season == "autumn" and berries:
        berries = "#7a1f4a"
    if berries:
        rnd = random.Random(seed)
        for (x, y, z, r) in blobs[-4:]:
            p = c.P(x + r * 0.5, y + r * 0.5, z)
            for _ in range(2):
                c.circle(p[0] + rnd.uniform(-8, 8), p[1] + rnd.uniform(-8, 4), 4.5, berries, OUT, 1.6)
    return c


MOSS = {None: "#7cbf4a", "spring": "#8fd457", "summer": "#6aa83e", "autumn": "#b59a3e"}


def rock(seed=4, big=False, season=None):
    c = pcanvas(140)
    rnd = random.Random(seed)
    stones = [(0.5, 0.5, 0.2 if big else 0.13)]
    if big:
        stones += [(0.72, 0.38, 0.11), (0.38, 0.72, 0.09)]
    stones.sort(key=lambda s: s[0] + s[1])
    for (x, y, r) in stones:
        c.shadow_ell(x, y, r, z=r)
        cx, cy, rx, ry, ang = c.ellipsoid((x, y, r * 0.55), (r, r * 0.85, r * 0.6), "#a7a49a", hi=0.35, lo=-0.3)
        c.path(f"M{f2(cx - rx * 0.3)},{f2(cy - ry * 0.2)} l{f2(rx * 0.25)},{f2(ry * 0.3)} l{f2(rx * 0.2)},{f2(-ry * 0.1)}", "none", "#6f6c63", 2)
        if season == "winter":
            # a cap of snow
            c.ell(cx - rx * 0.08, cy - ry * 0.5, rx * 0.78, ry * 0.42, SNOW, -6, SNOW_D, 2)
            c.ell(cx - rx * 0.3, cy - ry * 0.62, rx * 0.3, ry * 0.12, "#ffffff", -6, None)
            continue
        # moss
        c.ell(cx - rx * 0.2, cy - ry * 0.65, rx * 0.35, ry * 0.18, MOSS[season], -10, None, extra='opacity="0.85"')
        if season == "autumn":
            c.ell(cx + rx * 0.25, cy - ry * 0.35, 5, 2.4, LEAVES[0], 25, shade(LEAVES[0], -0.35), 1)
    return c


# ------------------------------------------------------------------ map resources: stumps, outcrops, iron veins
STONE = "#a7a49a"
STONE_D = "#6f6c63"
DARK_ROCK = "#7d7470"
ORE = ("#c4622d", "#a8462a", "#d9853f")
RUBBLE = "#b9b3a6"


def stump(seed=6, season=None):
    """A felled tree's stump with a few chips; it grows back into a tree."""
    c = pcanvas(110)
    rnd = random.Random(seed)
    c.shadow_ell(0.5, 0.5, 0.15, z=0.14)
    if season == "winter":
        snow_mound(c, 0.5, 0.5, 0.2)
    # roots, then the trunk with its cut face
    for a in (0.6, 2.2, 3.9, 5.2):
        p0 = c.P(0.5 + math.cos(a) * 0.07, 0.5 + math.sin(a) * 0.07, 0.04)
        p1 = c.P(0.5 + math.cos(a) * 0.17, 0.5 + math.sin(a) * 0.17, 0.0)
        c.limb(p0, p1, "#7a4a2a", 7)
    cx, ct, rx, ry = c.cylinder(0.5, 0.5, 0, 0.14, 0.1, "#8a5a32", top="#e2bd85", shadow=False)
    c.ell(cx, ct, rx * 0.55, ry * 0.55, "none", 0, "#b88a52", 2)
    c.ell(cx, ct, rx * 0.22, ry * 0.22, "#c99a5e", 0, None)
    if season == "winter":
        c.ell(cx - rx * 0.1, ct - 2, rx * 0.8, ry * 0.7, SNOW, 0, SNOW_D, 2)
        return c
    # chips on the ground
    for _ in range(4):
        p = c.P(0.5 + rnd.uniform(-0.3, 0.3), 0.5 + rnd.uniform(0.12, 0.32))
        c.ell(p[0], p[1], 6, 2.6, "#e2bd85", rnd.uniform(-30, 30), "#8a5a32", 1.2)
    if season in ("spring", "summer"):
        # new shoots: it grows back
        for k in range(3):
            base = c.P(0.5 + rnd.uniform(-0.12, 0.12), 0.5 + rnd.uniform(0.08, 0.14), 0.02)
            c.limb(base, (base[0] + rnd.uniform(-6, 6), base[1] - 16), "#4f8f32", 3, outline=False)
            c.ell(base[0] + rnd.uniform(-5, 5), base[1] - 17, 6, 3.4, "#7cc24a" if season == "spring" else "#5ba13a", rnd.uniform(-40, 40), None)
    elif season == "autumn":
        for _ in range(3):
            p = c.P(0.5 + rnd.uniform(-0.25, 0.25), 0.5 + rnd.uniform(-0.2, 0.3))
            col = rnd.choice(LEAVES)
            c.ell(p[0], p[1], 5, 2.4, col, rnd.uniform(-40, 40), shade(col, -0.35), 1)
    return c


def boulders(c, seed, stones, color, season, streaks=None):
    """Boulders on one tile; `streaks` paints ore seams across their faces."""
    rnd = random.Random(seed)
    stones = sorted(stones, key=lambda s: s[0] + s[1])
    for (x, y, r, h) in stones:
        c.shadow_ell(x, y, r, z=h)
        cx, cy, rx, ry, ang = c.ellipsoid((x, y, h * 0.5), (r, r * 0.85, h), color, hi=0.3, lo=-0.32)
        # cracks
        c.path(f"M{f2(cx - rx * 0.35)},{f2(cy - ry * 0.25)} l{f2(rx * 0.25)},{f2(ry * 0.32)} l{f2(rx * 0.22)},{f2(-ry * 0.12)}", "none", shade(color, -0.4), 2)
        if streaks:
            for k in range(2):
                y0 = cy - ry * rnd.uniform(-0.2, 0.45)
                c.path(f"M{f2(cx - rx * 0.6)},{f2(y0)} q{f2(rx * 0.3)},{f2(-ry * 0.25)} {f2(rx * 0.6)},{f2(-ry * 0.05)} "
                       f"t{f2(rx * 0.5)},{f2(-ry * 0.12)}", "none", rnd.choice(streaks), 4.5)
            for _ in range(3):
                c.circle(cx + rnd.uniform(-0.5, 0.5) * rx, cy + rnd.uniform(-0.5, 0.3) * ry, 3.2, rnd.choice(streaks), shade(streaks[1], -0.3), 1.2)
        if season == "winter":
            c.ell(cx - rx * 0.08, cy - ry * 0.55, rx * 0.75, ry * 0.4, SNOW, ang * 0.3, SNOW_D, 2)
            c.ell(cx - rx * 0.28, cy - ry * 0.66, rx * 0.28, ry * 0.12, "#ffffff", 0, None)
        elif season != "autumn" or rnd.random() < 0.5:
            c.ell(cx - rx * 0.2, cy - ry * 0.62, rx * 0.3, ry * 0.15, MOSS.get(season, MOSS[None]), -10, None, extra='opacity="0.8"')
    if season == "autumn":
        for _ in range(2):
            p = c.P(rnd.uniform(0.2, 0.8), rnd.uniform(0.55, 0.9))
            c.ell(p[0], p[1], 5, 2.4, LEAVES[0], 25, shade(LEAVES[0], -0.35), 1)


OUTCROP_LAYOUTS = (
    ((0.4, 0.42, 0.27, 0.22), (0.72, 0.62, 0.19, 0.15), (0.36, 0.76, 0.14, 0.1)),
    ((0.55, 0.42, 0.28, 0.24), (0.3, 0.7, 0.18, 0.13), (0.76, 0.76, 0.13, 0.09)),
    ((0.45, 0.5, 0.31, 0.2), (0.8, 0.36, 0.15, 0.12), (0.72, 0.8, 0.12, 0.08)),
)


def outcrop(variant=0, season=None):
    """One tile of a stone outcrop: big grey boulders a quarry breaks up."""
    c = pcanvas(170)
    boulders(c, 40 + variant, OUTCROP_LAYOUTS[variant], STONE, season)
    return c


def vein(variant=0, season=None):
    """One tile of an iron vein: dark rock with rusty ore seams, for a mine."""
    c = pcanvas(160)
    layout = OUTCROP_LAYOUTS[(variant + 1) % len(OUTCROP_LAYOUTS)]
    boulders(c, 50 + variant, [(x, y, r * 0.95, h * 0.85) for (x, y, r, h) in layout], DARK_ROCK, season, streaks=ORE)
    return c


def spent(seed, color, season=None, ore=None):
    """A worked-out deposit tile: low rubble and gravel."""
    c = pcanvas(80)
    rnd = random.Random(seed)
    cx, cy = c.P(0.5, 0.5)
    c.ell(cx, cy, K * 0.62, K * 0.3, shade(color, -0.15), 0, None, extra='opacity="0.55"')
    chips = [(rnd.uniform(0.2, 0.8), rnd.uniform(0.2, 0.8), rnd.uniform(0.05, 0.09)) for _ in range(9)]
    chips.sort(key=lambda s: s[0] + s[1])
    for (x, y, r) in chips:
        c.shadow_ell(x, y, r, z=r * 0.6)
        px, py, rx, ry, _ = c.ellipsoid((x, y, r * 0.35), (r, r * 0.8, r * 0.5), color, hi=0.3, lo=-0.3, sw=2)
        if ore and rnd.random() < 0.35:
            c.circle(px, py - ry * 0.2, 2.6, ore, None)
        if season == "winter":
            c.ell(px, py - ry * 0.45, rx * 0.7, ry * 0.4, SNOW, 0, None)
    if season == "winter":
        c.ell(cx - 20, cy + 6, 26, 8, SNOW, 0, SNOW_D, 1.5, extra='opacity="0.9"')
    elif season == "autumn":
        p = c.P(0.3, 0.7)
        c.ell(p[0], p[1], 5, 2.4, LEAVES[1], 25, shade(LEAVES[1], -0.35), 1)
    elif season in ("spring", "summer"):
        for _ in range(3):
            p = c.P(rnd.uniform(0.15, 0.85), rnd.uniform(0.6, 0.9))
            c.limb(p, (p[0] + rnd.uniform(-3, 3), p[1] - 9), MOSS[season], 2.4, outline=False)
    return c


MAP_PROPS = (
    ("tree_stump", lambda season: stump(6, season), "a felled tree's stump (grows back)"),
    ("outcrop_0", lambda season: outcrop(0, season), "stone outcrop tile"),
    ("outcrop_1", lambda season: outcrop(1, season), "stone outcrop tile"),
    ("outcrop_2", lambda season: outcrop(2, season), "stone outcrop tile"),
    ("outcrop_spent", lambda season: spent(61, RUBBLE, season), "worked-out stone outcrop tile"),
    ("vein_0", lambda season: vein(0, season), "iron vein tile"),
    ("vein_1", lambda season: vein(1, season), "iron vein tile"),
    ("vein_spent", lambda season: spent(62, DARK_ROCK, season, ore="#a8462a"), "worked-out iron vein tile"),
)


# ------------------------------------------------------------------ pond (decorative scenery)
WATER = {"spring": ("#6cc0e8", "#3f8fc4"), "summer": ("#5ab4e0", "#357fb8"), "autumn": ("#5b97b4", "#2f6a8a"),
         "winter": ("#e4f3fb", "#a9cfe6")}


def blob_path(points):
    """Smooth closed path through the midpoints of `points` (screen px)."""
    n = len(points)
    mids = [((points[k][0] + points[(k + 1) % n][0]) / 2, (points[k][1] + points[(k + 1) % n][1]) / 2) for k in range(n)]
    d = f"M{f2(mids[-1][0])},{f2(mids[-1][1])}"
    for k in range(n):
        d += f" Q{f2(points[k][0])},{f2(points[k][1])} {f2(mids[k][0])},{f2(mids[k][1])}"
    return d + " Z"


def pond(season="summer"):
    """A small pond lying in one tile; ice in winter."""
    c = pcanvas(110)
    rnd = random.Random(21)
    ring = []
    for k in range(12):
        a = 2 * math.pi * k / 12
        r = 0.33 * rnd.uniform(0.86, 1.08)
        ring.append((math.cos(a) * r, math.sin(a) * r))
    at = lambda s, z=0.0: [c.P(0.5 + x * s, 0.5 + y * s, z) for x, y in ring]
    bank = SNOW if season == "winter" else {"autumn": "#9a8350", "spring": "#8a7a4a", "summer": "#8f7c4a"}[season]
    c.path(blob_path(at(1.22)), bank, OUT, OW)
    c.path(blob_path(at(1.08)), shade(bank, -0.25), None)
    hi, lo = WATER[season]
    c.path(blob_path(at(0.98)), c.lin([(0, hi), (1, lo)]), shade(lo, -0.35), 2.5)
    # stones on the bank
    for k in (1, 4, 7, 10):
        x, y = ring[k]
        sx, sy = c.P(0.5 + x * 1.18, 0.5 + y * 1.18)
        c.ell(sx, sy - 2, 8, 5, "#a7a49a", 0, OUT, 2)
        if season == "winter":
            c.ell(sx - 1, sy - 5, 6, 2.6, SNOW, 0, None)
    if season == "winter":
        # cracks and frost on the ice, snow drifted onto it
        for k in (0, 3, 6, 9):
            x, y = ring[k]
            c.path(f"M{f2(c.P(0.5, 0.5)[0])},{f2(c.P(0.5, 0.5)[1])} L{f2(c.P(0.5 + x * 0.55, 0.5 + y * 0.6)[0])},{f2(c.P(0.5 + x * 0.55, 0.5 + y * 0.6)[1])} "
                   f"L{f2(c.P(0.5 + x * 0.8, 0.5 + y * 0.75)[0])},{f2(c.P(0.5 + x * 0.8, 0.5 + y * 0.75)[1])}", "none", "#8fb8d4", 1.6)
        for (x, y, w) in ((0.36, 0.42, 22), (0.6, 0.62, 16), (0.62, 0.36, 12)):
            sx, sy = c.P(x, y)
            c.ell(sx, sy, w, w * 0.4, "#ffffff", 0, None, extra='opacity="0.75"')
        for (x, y) in ((0.42, 0.55), (0.55, 0.45)):
            sx, sy = c.P(x, y)
            c.line((sx - 14, sy - 3), (sx + 10, sy + 2), "#ffffff", 2.5, opacity=0.9)
        reeds = ("#a08e66", "#8a7a5a")
    else:
        for (x, y) in ((0.42, 0.55), (0.55, 0.45)):
            sx, sy = c.P(x, y)
            c.line((sx - 14, sy - 3), (sx + 10, sy + 2), "#ffffff", 2.5, opacity=0.55)
        if season in ("spring", "summer"):
            for (x, y, f) in ((0.62, 0.5, season == "spring"), (0.4, 0.66, False), (0.55, 0.68, season == "spring")):
                sx, sy = c.P(x, y)
                c.path(f"M{f2(sx)},{f2(sy)} L{f2(sx + 9)},{f2(sy - 2)} A9,4.5 0 1 1 {f2(sx + 8)},{f2(sy + 2)} Z", "#5aa83a", "#2f6a24", 1.5)
                if f:
                    c.circle(sx - 2, sy - 3, 3.2, "#ffb3cf", OUT, 1.2)
                    c.circle(sx - 2, sy - 3, 1.2, "#ffe066", None)
        else:
            lrnd = random.Random(23)
            for _ in range(6):
                sx, sy = c.P(0.5 + lrnd.uniform(-0.2, 0.2), 0.5 + lrnd.uniform(-0.2, 0.2))
                col = lrnd.choice(LEAVES)
                c.ell(sx, sy, 4.6, 2.3, col, lrnd.uniform(0, 180), shade(col, -0.35), 1.0)
        reeds = {"spring": ("#6fb04a", "#4f8a34"), "summer": ("#4f9a36", "#3a7a2a"), "autumn": ("#b08a42", "#8a6a34")}[season]
    # reeds at the back of the bank
    for k in (8, 9):
        x, y = ring[k]
        sx, sy = c.P(0.5 + x * 1.1, 0.5 + y * 1.1)
        for j in range(4):
            L = 18 + j * 4
            c.path(f"M{f2(sx + j * 4 - 6)},{f2(sy)} q{f2(2)},{f2(-L * 0.6)} {f2(-2 + j * 2)},{f2(-L)}", "none", reeds[j % 2], 3)
        if season == "winter":
            c.ell(sx, sy - 1, 10, 3, SNOW, 0, None)
    return c


def single(fn):
    c = pcanvas(200)
    fn(c)
    return c


def build():
    image("props", "tree_oak", tree_round(1), notes="round tree on 1 tile")
    image("props", "tree_apple", tree_round(7, fruit="#e8423a", col="#62bd45"), notes="apple tree")
    image("props", "tree_pine", tree_pine(), notes="pine tree")
    image("props", "bush", bush(3), notes="bush")
    image("props", "bush_berry", bush(9, berries="#d93a7a", col="#56b03e"), notes="berry bush")
    image("props", "rock_small", rock(4), notes="small rock")
    image("props", "rock_large", rock(5, big=True), notes="rock cluster")
    image("props", "hay_bale", single(lambda c: hay(c, 0.5, 0.5, s=1.3)), notes="square hay bale")
    image("props", "hay_roll", single(lambda c: hay(c, 0.5, 0.5, s=1.3, round_=True)), notes="round hay bale")
    image("props", "crate", single(lambda c: crate(c, 0.5, 0.5, s=1.4)), notes="empty crate")
    image("props", "crate_apples", single(lambda c: crate(c, 0.5, 0.5, s=1.4, fill="#e8423a")), notes="crate with apples")
    image("props", "crate_carrots", single(lambda c: crate(c, 0.5, 0.5, s=1.4, fill="#ff8a2a")), notes="crate with carrots")

    def stack(c):
        crate(c, 0.42, 0.42, s=1.2)
        crate(c, 0.66, 0.66, s=1.2)
        crate(c, 0.42, 0.42, z=0.2, s=1.2)
    image("props", "crate_stack", single(stack), notes="stacked crates")
    image("props", "sack_feed", single(lambda c: sack(c, 0.5, 0.5, 1.3, label="#f2c14e")), notes="feed sack")
    image("props", "milk_can", single(lambda c: milk_can(c, 0.5, 0.5, 1.4)), notes="milk can")
    image("props", "pond", pond("summer"), notes="small decorative pond", shadow=False)
    for name, fn, notes in MAP_PROPS:
        image("props", name, fn(None), notes=notes)


def build_seasons():
    """Scenery in its four seasonal versions, `<prop>_<season>` (see seasonal.py)."""
    for season in SEASONS:
        image("props", f"tree_oak_{season}", tree_round(1, season=season), notes=f"round tree in {season}")
        image("props", f"tree_apple_{season}", tree_round(7, fruit="#e8423a", col="#62bd45", season=season, flowers="pink"), notes=f"apple tree in {season}")
        image("props", f"tree_pine_{season}", tree_pine(season=season), notes=f"pine tree in {season}")
        image("props", f"bush_{season}", bush(3, season=season), notes=f"bush in {season}")
        image("props", f"bush_berry_{season}", bush(9, berries="#d93a7a", col="#56b03e", season=season), notes=f"berry bush in {season}")
        image("props", f"rock_small_{season}", rock(4, season=season), notes=f"small rock in {season}")
        image("props", f"rock_large_{season}", rock(5, big=True, season=season), notes=f"rock cluster in {season}")
        image("props", f"pond_{season}", pond(season), notes=f"small decorative pond in {season}", shadow=False)
        for name, fn, notes in MAP_PROPS:
            image("props", f"{name}_{season}", fn(season), notes=f"{notes} in {season}")
