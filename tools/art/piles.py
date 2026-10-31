"""Stock piles: what a granary, storehouse or the farmhouse holds, stacked in its yard.

Each pile has 4 fill stages (1 = a quarter … 4 = full; the game shows none when empty). A pile is drawn
around the middle of a 1x1 tile, (0.5, 0.5), so the game can stand it anywhere in a building's yard: the
anchor is the tile's top vertex, as for props. Granary piles are long and shallow (about 0.42 x 0.26 tiles)
to fit the strip in front of the granary; storehouse piles are about 0.45 tiles square; the farmhouse's
small piles about 0.22.
"""
import random
from core import *
from registry import image
from buildings import crate, log_pile, milk_can

STAGES = (1, 2, 3, 4)

SACK = "#efe2c8"
SACK_TIE = "#9b6a3c"
FEED_SACK = "#c9a36b"
WICKER = "#c99a55"
WOOL = "#f3eee2"
TWINE = "#b5651d"
STONE = "#a7adb3"
IRON = "#9aa6b2"
PALLET = "#b07a43"


def pile_canvas():
    return Canvas(TW + 60, TH + 220, TW / 2 + 30, 180)


# ------------------------------------------------------------------ pieces
def sack(c, x, y, z=0.0, s=1.0, color=SACK, label=None):
    """A tied sack standing at (x, y, z)."""
    cx, cy = c.P(x, y, z)
    w, h = 22 * s, 30 * s
    if z == 0:
        c.shadow_ell(x, y, 0.08 * s, z=0.1)
    d = (f"M{f2(cx - w)},{f2(cy)} Q{f2(cx - w - 4)},{f2(cy - h)} {f2(cx - w * 0.45)},{f2(cy - h * 1.15)} "
         f"L{f2(cx - 6 * s)},{f2(cy - h * 1.35)} L{f2(cx + 6 * s)},{f2(cy - h * 1.35)} L{f2(cx + w * 0.45)},{f2(cy - h * 1.15)} "
         f"Q{f2(cx + w + 4)},{f2(cy - h)} {f2(cx + w)},{f2(cy)} Q{f2(cx)},{f2(cy + 7 * s)} {f2(cx - w)},{f2(cy)} Z")
    c.path(d, c.lin([(0, shade(color, 0.15)), (1, shade(color, -0.15))], 0, 0, 1, 0), OUT, 2.5)
    c.line((cx - 7 * s, cy - h * 1.15), (cx + 7 * s, cy - h * 1.15), SACK_TIE, 3)
    if label:
        c.circle(cx, cy - h * 0.5, 7 * s, label, OUT, 1.5)


def basket(c, x, y, z=0.0, r=0.08, fill=("#ff8a2a",), seed=1, oval=False, tuft=None):
    """A wicker basket heaped with produce (one colour per item, picked in turn)."""
    hgt = r * 0.95
    cx, ct, rx, ry = c.cylinder(x, y, z, z + hgt, r * 0.8, WICKER, top=shade(WICKER, -0.35), r1=r, shadow=(z == 0))
    for k in range(1, 3):
        _, zy = c.P(x, y, z + hgt * k / 3)
        rr = K * (r * 0.8 + (r - r * 0.8) * k / 3) * 1.4142
        c.path(f"M{f2(cx - rr)},{f2(zy)} A{f2(rr)},{f2(rr / 2)} 0 0 0 {f2(cx + rr)},{f2(zy)}", "none", shade(WICKER, -0.3), 1.8)
    rnd = random.Random(seed)
    spots = [(rnd.uniform(-0.55, 0.55), rnd.uniform(-0.45, 0.35)) for _ in range(7)]
    for i, (dx, dy) in enumerate(sorted(spots, key=lambda t: t[1])):
        col = fill[i % len(fill)]
        px, py = cx + dx * rx, ct + dy * ry - 4
        if oval:
            c.ell(px, py, 5.5, 7, col, rnd.uniform(-30, 30), OUT, 1.6)
        else:
            c.circle(px, py, 6.5, col, OUT, 1.6)
        c.circle(px - 2, py - 3, 2, shade(col, 0.5), None)
        if tuft:
            c.path(f"M{f2(px)},{f2(py - 5)} l-3,-6 M{f2(px)},{f2(py - 5)} l3,-6", "none", tuft, 2)


def bale(c, x, y, z=0.0, s=1.0, color=WOOL):
    """A tied bale (wool)."""
    a, b, hgt = 0.13 * s, 0.09 * s, 0.13 * s
    c.box(x - a, y - b, z, x + a, y + b, z + hgt, shade(color, 0.1), color, shade(color, -0.14), shadow=(z == 0))
    for t in (0.3, 0.7):
        u = x - a + 2 * a * t
        c.line(c.P(u, y + b, z), c.P(u, y + b, z + hgt), TWINE, 2.5)
        c.line(c.P(u, y + b, z + hgt), c.P(u, y - b, z + hgt), TWINE, 2.5)
    rnd = random.Random(int(x * 100 + y * 10 + z * 7))
    for _ in range(4):
        p = c.P(x + rnd.uniform(-a, a) * 0.8, y + rnd.uniform(-b, b) * 0.8, z + hgt)
        c.circle(p[0], p[1], 3, shade(color, -0.08), None)


def churn(c, x, y, z=0.0, s=1.0):
    milk_can(c, x, y, s)


def stone_block(c, x, y, z, rnd):
    g = shade(STONE, rnd.uniform(-0.08, 0.08))
    c.box(x - 0.08, y - 0.07, z, x + 0.08, y + 0.07, z + 0.11, shade(g, 0.15), g, shade(g, -0.15), sw=2, shadow=(z == 0))
    p = c.P(x + 0.08, y - 0.02, z + 0.06)
    c.line(p, (p[0] + 5, p[1] - 3), shade(g, -0.3), 1.4)


def bar(c, x, y, z, along):
    """An iron bar (ingot) lying along x or y."""
    a, b = (0.11, 0.035) if along == "x" else (0.035, 0.11)
    c.box(x - a, y - b, z, x + a, y + b, z + 0.05, shade(IRON, 0.25), IRON, shade(IRON, -0.18), sw=2, shadow=False)


def pallet(c, x, y, a, b):
    c.box(x - a, y - b, 0, x + a, y + b, 0.035, shade(PALLET, 0.12), PALLET, shade(PALLET, -0.15), sw=2)


def place(c, items):
    """Draw pieces back to front: by layer, then by depth on the ground."""
    for (x, y, z, draw) in sorted(items, key=lambda t: (round(t[2], 3), t[0] + t[1])):
        draw(c, x, y, z)


# ------------------------------------------------------------------ granary piles (by category)
def crops(stage):
    pieces = [
        (0.36, 0.48, 0, lambda c, x, y, z: sack(c, x, y, z, 0.72, label="#f2c14e")),
        (0.56, 0.5, 0, lambda c, x, y, z: basket(c, x, y, z, 0.075, ("#ff8a2a",), seed=2, tuft="#5cbf3f")),
        (0.7, 0.56, 0, lambda c, x, y, z: sack(c, x, y, z, 0.7, color="#e9d3a6", label="#f2c14e")),
        (0.26, 0.6, 0, lambda c, x, y, z: basket(c, x, y, z, 0.07, ("#f5cf52", "#f0b42e"), seed=3, oval=True)),
        (0.46, 0.62, 0, lambda c, x, y, z: sack(c, x, y, z, 0.7, label="#f2c14e")),
        (0.46, 0.5, 0.14, lambda c, x, y, z: sack(c, x, y, z, 0.66, color="#e9d3a6")),
        (0.66, 0.44, 0.1, lambda c, x, y, z: basket(c, x, y, z, 0.065, ("#ff8a2a",), seed=5, tuft="#5cbf3f")),
    ]
    c = pile_canvas()
    place(c, pieces[: (2, 3, 5, 7)[stage - 1]])
    return c


def animal(stage):
    eggs = ("#fffaf0", "#f6e7cf", "#f1dcb2")
    pieces = [
        (0.38, 0.5, 0, lambda c, x, y, z: basket(c, x, y, z, 0.075, eggs, seed=7, oval=True)),
        (0.6, 0.46, 0, lambda c, x, y, z: churn(c, x, y, z, 1.0)),
        (0.3, 0.64, 0, lambda c, x, y, z: bale(c, x, y, z, 0.9)),
        (0.72, 0.56, 0, lambda c, x, y, z: churn(c, x, y, z, 1.0)),
        (0.52, 0.64, 0, lambda c, x, y, z: basket(c, x, y, z, 0.075, eggs, seed=9, oval=True)),
        (0.3, 0.64, 0.117, lambda c, x, y, z: bale(c, x, y, z, 0.85)),
    ]
    c = pile_canvas()
    place(c, pieces[: (2, 3, 5, 6)[stage - 1]])
    return c


def feed(stage):
    spots = [(0.38, 0.48, 0), (0.6, 0.5, 0), (0.28, 0.62, 0), (0.5, 0.64, 0), (0.72, 0.62, 0), (0.48, 0.54, 0.15), (0.64, 0.58, 0.15)]
    c = pile_canvas()
    pieces = [(x, y, z, lambda c, x, y, z: sack(c, x, y, z, 0.72, color=FEED_SACK, label="#5cbf3f")) for (x, y, z) in spots]
    place(c, pieces[: (1, 3, 5, 7)[stage - 1]])
    return c


def goods(stage):
    fills = ("#f5cf52", "#d98a38", "#5b8fd6", "#fff0ad", "#f5cf52")   # cheese, bread, cloth, butter
    spots = [(0.4, 0.5, 0), (0.62, 0.5, 0), (0.32, 0.68, 0), (0.54, 0.68, 0), (0.5, 0.58, 0.15)]
    c = pile_canvas()
    pieces = [(x, y, z, (lambda f: lambda c, x, y, z: crate(c, x, y, z, s=0.85, fill=f))(fills[i])) for i, (x, y, z) in enumerate(spots)]
    place(c, pieces[: (1, 2, 4, 5)[stage - 1]])
    return c


# ------------------------------------------------------------------ storehouse piles (by material)
def wood(stage):
    c = pile_canvas()
    pallet(c, 0.5, 0.5, 0.25, 0.18)
    c.group(lambda: log_pile(c, 0.27, 0.66, 0.73, z_rows=stage, r=0.0575), transform=f"translate(0,{f2(-KZ * 0.035)})")
    return c


def stone(stage):
    rnd = random.Random(11)
    spots = [(0.4, 0.42, 0), (0.6, 0.42, 0), (0.4, 0.58, 0), (0.6, 0.58, 0),
             (0.4, 0.42, 0.11), (0.6, 0.42, 0.11), (0.4, 0.58, 0.11), (0.6, 0.58, 0.11), (0.5, 0.5, 0.22)]
    c = pile_canvas()
    n = (2, 4, 6, 9)[stage - 1]
    # The front blocks come first on the ground, so a small pile sits at the front.
    order = [2, 3, 0, 1, 4, 5, 6, 7, 8]
    place(c, [(spots[i][0], spots[i][1], spots[i][2], lambda c, x, y, z: stone_block(c, x, y, z, rnd)) for i in sorted(order[:n])])
    return c


def iron(stage):
    c = pile_canvas()
    pallet(c, 0.5, 0.5, 0.17, 0.17)
    for layer in range(stage):
        z = 0.035 + layer * 0.05
        along = "x" if layer % 2 == 0 else "y"
        for k in (-1, 0, 1):
            if along == "x":
                bar(c, 0.5, 0.5 + k * 0.08, z, "x")
            else:
                bar(c, 0.5 + k * 0.08, 0.5, z, "y")
    c.shadow_pts([(0.33, 0.33, 0), (0.67, 0.33, 0), (0.33, 0.67, 0), (0.67, 0.67, 0),
                  (0.39, 0.39, 0.035 + stage * 0.05), (0.61, 0.61, 0.035 + stage * 0.05)])
    return c


# ------------------------------------------------------------------ the farmhouse's small piles (by pool)
def house_goods(stage):
    pieces = [
        (0.46, 0.5, 0, lambda c, x, y, z: sack(c, x, y, z, 0.62, label="#f2c14e")),
        (0.6, 0.56, 0, lambda c, x, y, z: crate(c, x, y, z, s=0.7, fill="#ff8a2a")),
        (0.4, 0.62, 0, lambda c, x, y, z: sack(c, x, y, z, 0.6, color=FEED_SACK, label="#5cbf3f")),
        (0.6, 0.56, 0.119, lambda c, x, y, z: sack(c, x, y, z, 0.55, color="#e9d3a6")),
    ]
    c = pile_canvas()
    place(c, pieces[:stage])
    return c


def house_materials(stage):
    c = pile_canvas()
    rows = (1, 1, 2, 2)[stage - 1]
    log_pile(c, 0.38, 0.62, 0.38 + 0.1 * (2 if stage == 1 else 3), z_rows=rows, r=0.05)
    rnd = random.Random(13)
    if stage >= 3:
        stone_block(c, 0.66, 0.6, 0, rnd)
    if stage >= 4:
        stone_block(c, 0.66, 0.6, 0.11, rnd)
    return c


PILES = {
    "crops": crops, "animal": animal, "feed": feed, "goods": goods,
    "wood": wood, "stone": stone, "iron": iron,
    "house_goods": house_goods, "house_materials": house_materials,
}


def build():
    for kind, fn in PILES.items():
        for s in STAGES:
            image("piles", f"pile_{kind}_{s}", fn(s), notes=f"{kind} stock pile, fill stage {s} of 4, centred on (0.5, 0.5) of its tile")
