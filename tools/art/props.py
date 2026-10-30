"""Nature + farm props, each on a 1x1 tile footprint."""
import math, random
from core import *
from registry import image
from buildings import hay, crate, sack, milk_can


def pcanvas(top=300):
    return Canvas(TW + 160, TH + top + 60, TW / 2 + 30, top)


def foliage(c, cx, cy, cz, R, col, seed, n=7):
    rnd = random.Random(seed)
    blobs = [(cx, cy, cz + R * 0.1, R)]
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.3, 0.3)
        d = R * rnd.uniform(0.45, 0.7)
        blobs.append((cx + math.cos(a) * d, cy + math.sin(a) * d, cz + rnd.uniform(-0.25, 0.35) * R, R * rnd.uniform(0.5, 0.68)))
    blobs.append((cx - R * 0.15, cy - R * 0.15, cz + R * 0.55, R * 0.55))
    blobs.sort(key=lambda b: b[0] + b[1] + b[2] * 0.6)
    for (x, y, z, r) in blobs:
        c.ellipsoid((x, y, z), (r, r, r * 0.92), col, hi=0.3, lo=-0.25)
    return blobs


def tree_round(seed=1, fruit=None, col="#5bb540"):
    c = pcanvas(330)
    c.shadow_ell(0.5, 0.5, 0.42, z=0.9)
    c.cylinder(0.5, 0.5, 0, 0.45, 0.08, "#8a5a32", r1=0.06, shadow=False)
    blobs = foliage(c, 0.5, 0.5, 0.82, 0.38, col, seed, n=8)
    if fruit:
        rnd = random.Random(seed + 5)
        for (x, y, z, r) in blobs[-5:]:
            for _ in range(2):
                p = c.P(x + rnd.uniform(-r, r) * 0.5 + r * 0.4, y + r * 0.4, z + rnd.uniform(-r, r) * 0.4)
                c.circle(p[0], p[1], 6, fruit, OUT, 2)
                c.circle(p[0] - 2, p[1] - 2, 2, "#ffffff", None)
    return c


def tree_pine(seed=2):
    c = pcanvas(360)
    c.shadow_ell(0.5, 0.5, 0.26, z=1.0)
    c.cylinder(0.5, 0.5, 0, 0.3, 0.06, "#7a4a2a", shadow=False)
    col = "#2f8f4e"
    for k, (z0, z1, r) in enumerate(((0.22, 0.85, 0.34), (0.55, 1.15, 0.27), (0.85, 1.45, 0.19))):
        c.cone(0.5, 0.5, z0, z1, r, shade(col, 0.06 * k), shadow=False)
        # snowless highlight streaks
        base = c.P(0.5, 0.5, z0)
        c.path(f"M{f2(base[0] - K * r * 0.9)},{f2(base[1] - 4)} q{f2(K * r * 0.5)},{f2(10)} {f2(K * r * 0.9)},{f2(2)}", "none", shade(col, -0.3), 2.5)
    return c


def bush(seed=3, berries=None, col="#4fa83a"):
    c = pcanvas(160)
    c.shadow_ell(0.5, 0.5, 0.28, z=0.2)
    blobs = foliage(c, 0.5, 0.5, 0.17, 0.2, col, seed, n=6)
    if berries:
        rnd = random.Random(seed)
        for (x, y, z, r) in blobs[-4:]:
            p = c.P(x + r * 0.5, y + r * 0.5, z)
            for _ in range(2):
                c.circle(p[0] + rnd.uniform(-8, 8), p[1] + rnd.uniform(-8, 4), 4.5, berries, OUT, 1.6)
    return c


def rock(seed=4, big=False):
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
        # moss
        c.ell(cx - rx * 0.2, cy - ry * 0.65, rx * 0.35, ry * 0.18, "#7cbf4a", -10, None, extra='opacity="0.85"')
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
