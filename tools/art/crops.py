"""Crops: wheat, carrot, corn x 4 growth stages (seeded, sprout, growing, ripe)."""
import math, random
from core import *
from registry import image

GRID = [0.18, 0.39, 0.61, 0.82]   # matches the furrow centres of the soil tiles (both directions)
SOIL_H = 0.03
LEAF = "#5dbb3f"
LEAF_D = "#3f9a2c"
LEAF_L = "#8ddc5c"
STAGES = ["seeded", "sprout", "growing", "ripe"]


def crop_canvas(top):
    return Canvas(TW, TH + top, TW / 2, top)


def spots(jitter_seed, every=1):
    rnd = random.Random(jitter_seed)
    out = []
    for a, x in enumerate(GRID):
        for b, y in enumerate(GRID):
            if (a + b) % every:
                continue
            out.append((x + rnd.uniform(-0.025, 0.025), y + rnd.uniform(-0.025, 0.025), rnd))
    out.sort(key=lambda p: p[0] + p[1])
    return out


def seeded(c, seed_col):
    for x, y, rnd in spots(1):
        sx, sy = c.P(x, y, SOIL_H)
        c.ell(sx, sy + 1, 8, 4, "#4a2a16", 0, None)          # planting hole
        for k in range(3):
            c.ell(sx + rnd.uniform(-5, 5), sy + rnd.uniform(-2, 2), 2.4, 1.6, seed_col, rnd.uniform(0, 180), shade(seed_col, -0.5), 0.8)


def sprout(c, x, y, rnd, scale=1.0, col=LEAF):
    sx, sy = c.P(x, y, SOIL_H)
    c.ell(sx, sy + 1, 6, 3, "#4a2a16", 0, None, extra='opacity="0.6"')
    h = 12 * scale
    c.line((sx, sy), (sx, sy - h), shade(col, -0.2), 2.5)
    for side in (-1, 1):
        lx, ly = sx + side * 6 * scale, sy - h - 2 * scale
        c.ell(lx, ly, 6.5 * scale, 3.2 * scale, col, side * -25, shade(col, -0.5), 1.4)
        c.ell(lx - side * 1, ly - 1, 3 * scale, 1.2 * scale, shade(col, 0.35), side * -25, None)


# ------------------------------------------------------------------ wheat
def wheat_plant(c, x, y, rnd, stage):
    sx, sy = c.P(x, y, SOIL_H)
    if stage == 2:
        h, n, col, ear = 46, 6, "#77c046", "#9ad35a"
    else:
        h, n, col, ear = 64, 7, "#d9a93a", "#f2c84b"
    c.ell(sx, sy + 1, 10, 4, "#4a2a16", 0, None, extra='opacity="0.5"')
    stalks = []
    for k in range(n):
        ang = math.radians(-90 + (k - (n - 1) / 2) * 9 + rnd.uniform(-4, 4))
        L = h * rnd.uniform(0.85, 1.05)
        bend = rnd.uniform(-6, 6)
        tip = (sx + math.cos(ang) * L + bend, sy + math.sin(ang) * L)
        stalks.append((ang, tip, L))
    for ang, tip, L in stalks:
        c.path(f"M{f2(sx)},{f2(sy)} Q{f2(sx + (tip[0] - sx) * 0.3)},{f2(sy - L * 0.5)} {f2(tip[0])},{f2(tip[1])}", "none", shade(col, -0.45), 4.6)
        c.path(f"M{f2(sx)},{f2(sy)} Q{f2(sx + (tip[0] - sx) * 0.3)},{f2(sy - L * 0.5)} {f2(tip[0])},{f2(tip[1])}", "none", col, 2.4)
    for ang, tip, L in stalks:
        # ear: a column of grains
        a = math.degrees(ang) + 90
        for g in range(4):
            gx = tip[0] - math.cos(ang) * g * 3.6
            gy = tip[1] - math.sin(ang) * g * 3.6
            for side in (-1, 1):
                c.ell(gx + side * 2.2, gy, 2.4, 4.2, ear, a + side * 25, shade(ear, -0.45), 1.0)
        if stage == 3:
            c.line(tip, (tip[0] + math.cos(ang) * 9, tip[1] + math.sin(ang) * 9), shade(ear, 0.2), 1.2)  # awn
    # a couple of leaves at the base
    for side in (-1, 1):
        c.path(f"M{f2(sx)},{f2(sy - 3)} q{f2(side * 8)},{f2(-10)} {f2(side * 16)},{f2(-6)}", "none", shade(col, -0.15), 3)


def wheat(stage):
    c = crop_canvas(90)
    if stage == 0:
        seeded(c, "#e3c06a")
    elif stage == 1:
        for x, y, rnd in spots(2):
            for k in range(3):
                sx, sy = c.P(x, y, SOIL_H)
                c.line((sx + (k - 1) * 3, sy), (sx + (k - 1) * 6, sy - 16 - k * 2), LEAF_D, 4.5)
                c.line((sx + (k - 1) * 3, sy), (sx + (k - 1) * 6, sy - 16 - k * 2), LEAF_L, 2.2)
            c.shadow_ell(x, y, 0.04)
    else:
        for x, y, rnd in spots(3):
            wheat_plant(c, x, y, rnd, stage)
            c.shadow_ell(x, y, 0.07, z=0.3)
    return c


# ------------------------------------------------------------------ carrot
def frond(c, sx, sy, ang, L, col):
    tip = (sx + math.cos(ang) * L, sy + math.sin(ang) * L)
    c.line((sx, sy), tip, shade(col, -0.35), 3.5)
    c.line((sx, sy), tip, col, 2)
    for t in (0.45, 0.65, 0.85, 1.0):
        px, py = sx + (tip[0] - sx) * t, sy + (tip[1] - sy) * t
        for side in (-1, 1):
            a = ang + side * 0.9
            c.ell(px + math.cos(a) * 3.5, py + math.sin(a) * 3.5, 4, 2.4, col, math.degrees(a), shade(col, -0.45), 1)


def carrot(stage):
    c = crop_canvas(60)
    if stage == 0:
        seeded(c, "#c9a46b")
        return c
    for x, y, rnd in spots(4):
        sx, sy = c.P(x, y, SOIL_H)
        if stage == 1:
            sprout(c, x, y, rnd, 0.85, "#6bc443")
            c.shadow_ell(x, y, 0.03)
            continue
        L = 18 if stage == 2 else 24
        n = 4 if stage == 2 else 5
        c.ell(sx, sy + 1, 10, 4, "#4a2a16", 0, None, extra='opacity="0.55"')
        base_y = sy - (11 if stage == 3 else 2)
        for k in range(n):
            ang = math.radians(-90 + (k - (n - 1) / 2) * 17 + rnd.uniform(-5, 5))
            frond(c, sx, base_y, ang, L * rnd.uniform(0.85, 1.05), "#58b53a" if k % 2 else "#6fcb45")
        if stage == 3:
            # chunky orange shoulder peeking out of the soil, in front of the leaf bases
            c.path(f"M{f2(sx - 10)},{f2(sy + 1)} Q{f2(sx - 11)},{f2(sy - 14)} {f2(sx)},{f2(sy - 14)} Q{f2(sx + 11)},{f2(sy - 14)} {f2(sx + 10)},{f2(sy + 1)} Z",
                   c.lin([(0, "#ffb558"), (1, "#e2661a")], 0, 0, 1, 0), OUT, 2.2)
            c.line((sx - 5, sy - 8), (sx + 1, sy - 10), "#ffd9a3", 2)
            c.line((sx - 6, sy - 3), (sx - 2, sy - 3), "#c4561a", 1.4)
            c.line((sx + 3, sy - 6), (sx + 7, sy - 6), "#c4561a", 1.4)
        c.shadow_ell(x, y, 0.06, z=0.15)
    return c


# ------------------------------------------------------------------ corn
def corn_leaf(c, base, ang, L, droop, col):
    bx, by = base
    tip = (bx + math.cos(ang) * L, by + math.sin(ang) * L + droop)
    ctrl = (bx + math.cos(ang) * L * 0.55, by + math.sin(ang) * L * 0.55 - abs(droop) * 0.6)
    n = (-math.sin(ang), math.cos(ang))
    w = 9.0
    d = (f"M{f2(bx)},{f2(by)} Q{f2(ctrl[0] + n[0] * w)},{f2(ctrl[1] + n[1] * w)} {f2(tip[0])},{f2(tip[1])} "
         f"Q{f2(ctrl[0] - n[0] * w)},{f2(ctrl[1] - n[1] * w)} {f2(bx)},{f2(by)} Z")
    c.path(d, col, OUT, 1.8)
    c.path(f"M{f2(bx)},{f2(by)} Q{f2(ctrl[0])},{f2(ctrl[1])} {f2(tip[0])},{f2(tip[1])}", "none", shade(col, 0.3), 1.2)


def corn_plant(c, x, y, rnd, stage):
    sx, sy = c.P(x, y, SOIL_H)
    H = {2: 70, 3: 118}[stage]
    col = "#55b03a" if stage == 2 else "#6aa83a"
    c.ell(sx, sy + 1, 9, 4, "#4a2a16", 0, None, extra='opacity="0.5"')
    top = (sx + rnd.uniform(-3, 3), sy - H)
    leaves = []
    nl = 4 if stage == 2 else 6
    for k in range(nl):
        t = 0.2 + 0.7 * k / nl
        bx, by = sx + (top[0] - sx) * t, sy + (top[1] - sy) * t
        side = -1 if k % 2 else 1
        ang = math.radians(-90 + side * rnd.uniform(35, 60))
        leaves.append(((bx, by), ang, rnd.uniform(32, 44) * (0.85 if stage == 2 else 1), rnd.uniform(6, 14), side))
    # back leaves, stalk, front leaves
    for (b, ang, L, droop, side) in leaves[::2]:
        corn_leaf(c, b, ang, L, droop, shade(col, -0.08))
    c.limb((sx, sy), top, shade(col, -0.05), 5)
    c.line((sx - 1, sy), (top[0] - 1, top[1]), shade(col, 0.25), 1.5)
    if stage == 3:
        # cobs
        for t, side in ((0.45, 1), (0.6, -1)):
            bx, by = sx + (top[0] - sx) * t, sy + (top[1] - sy) * t
            cx, cy = bx + side * 9, by - 6
            c.ell(cx, cy, 6.5, 14, c.lin([(0, "#ffe680"), (1, "#f2b230")], 0, 0, 1, 0), side * 22, OUT, 2)
            for g in range(4):
                c.line((cx - 3 + side * g * 0.8, cy - 9 + g * 5), (cx + 3 + side * g * 0.8, cy - 8 + g * 5), "#d99a25", 1.2)
            # husk
            c.path(f"M{f2(bx)},{f2(by + 2)} q{f2(side * 14)},{f2(-2)} {f2(side * 13)},{f2(-16)} q{f2(-side * 2)},{f2(10)} {f2(-side * 13)},{f2(16)} Z",
                   "#86c45a", OUT, 1.6)
        # tassel
        for k in range(5):
            a = math.radians(-90 + (k - 2) * 22)
            c.line(top, (top[0] + math.cos(a) * 12, top[1] + math.sin(a) * 12), "#a87a2a", 4)
            c.line(top, (top[0] + math.cos(a) * 12, top[1] + math.sin(a) * 12), "#f0c75a", 2)
    for (b, ang, L, droop, side) in leaves[1::2]:
        corn_leaf(c, b, ang, L, droop, col)


def corn(stage):
    c = crop_canvas(150)
    if stage == 0:
        seeded(c, "#f2c94c")
        return c
    if stage == 1:
        for x, y, rnd in spots(5):
            sprout(c, x, y, rnd, 1.1, "#5cbf3f")
            c.shadow_ell(x, y, 0.035)
        return c
    pts_ = [p for p in spots(6) if True]
    for x, y, rnd in pts_:
        corn_plant(c, x, y, rnd, stage)
        c.shadow_ell(x, y, 0.08, z=0.6 if stage == 3 else 0.35)
    return c


def build():
    for nm, fn in (("wheat", wheat), ("carrot", carrot), ("corn", corn)):
        for s in range(4):
            image("crops", f"{nm}_{s}_{STAGES[s]}", fn(s),
                  notes=f"{nm} stage {s} ({STAGES[s]}); place on a soil tile at the same tile coords, drawn above it")
