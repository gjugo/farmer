"""The farmer: a farm hand in denim overalls, a red shirt and a straw hat.

Built like the animals (animals.py): parts live in the farmer's own space (a = forward,
b = sideways, z = up), are placed for a facing direction and painted back to front. SE and NW
are drawn; SW and NE are their horizontal mirrors.

Anims: idle (standing), sit (on the farmhouse bench), walk, and one per farm job:
plough (hoe), plant (sowing from a seed bag), harvest (sickle), build (hammer), feed (bucket).
"""
import math
from core import *
from registry import sheet
from animals import Rig, eye, DIRS_DRAWN

ANIMS = {"idle": 4, "sit": 4, "walk": 6, "plough": 4, "plant": 4, "harvest": 4, "build": 4, "feed": 4}
FPS = {"idle": 4, "sit": 3, "walk": 9, "plough": 5, "plant": 4, "harvest": 5, "build": 6, "feed": 4}

SKIN = "#f2c29b"
SHIRT = "#d9483b"
DENIM = "#3f6fb5"
BOOT = "#6b4226"
HAIR = "#7a4a26"
STRAW = "#f0cf6a"
BAND = "#c0392b"
WOOD = "#a8743f"
METAL = "#c3ccd3"
SEED = "#f2d27a"


def pose(anim, f):
    """Where the body parts are in frame f: hip height, forward lean, feet, knees and hands (local a, b, z)."""
    t = f / ANIMS[anim]
    ph = 2 * math.pi * t
    p = dict(hip=0.27, lean=0.0, feet=[(0.0, -0.05, 0.0), (0.0, 0.05, 0.0)], knees=None,
             hands=[(0.0, -0.13, 0.26), (0.0, 0.13, 0.26)], tool=None)
    if anim == "idle":
        p["hip"] += 0.004 * math.sin(ph)
    elif anim == "walk":
        p["hip"] += 0.012 * abs(math.sin(ph))
        p["feet"] = [(0.07 * math.sin(ph + k * math.pi), s * 0.05, 0.04 * max(0.0, math.cos(ph + k * math.pi)))
                     for k, s in enumerate((-1, 1))]
        p["hands"] = [(-0.06 * math.sin(ph + k * math.pi), s * 0.13, 0.27) for k, s in enumerate((-1, 1))]
    elif anim == "sit":
        # On a bench 0.14 high: thighs forward, shins down, hands on the knees, feet swinging a little.
        p["hip"] = 0.17
        swing = 0.015 * math.sin(ph)
        p["knees"] = [(0.13, s * 0.05, 0.18) for s in (-1, 1)]
        p["feet"] = [(0.15 + (swing if s < 0 else -swing), s * 0.05, 0.0) for s in (-1, 1)]
        p["hands"] = [(0.11, s * 0.08, 0.22 + 0.004 * math.sin(ph)) for s in (-1, 1)]
    elif anim == "plough":
        # Hoeing: the blade rises and chops into the soil in front.
        r = [0.16, 0.08, -0.02, 0.04][f]
        p["lean"] = 0.03
        blade = (0.34 - r * 0.4, 0.0, max(0.0, r * 1.3))
        top = (0.0, -0.02, 0.5 + r * 0.6)
        p["hands"] = [lerp3(blade, top, 0.72), lerp3(blade, top, 0.45)]
        p["tool"] = ("hoe", blade, top)
    elif anim == "plant":
        # Bent over, sowing from the bag on the hip.
        p["lean"] = 0.08
        p["hip"] = 0.25
        drop = 0.03 * math.sin(ph)
        p["hands"] = [(0.08, -0.13, 0.25), (0.22, 0.05, 0.08 + drop)]
        p["tool"] = ("seeds", (0.22, 0.05, 0.08 + drop), f)
    elif anim == "harvest":
        # Bent over, sweeping a sickle through the stalks.
        p["lean"] = 0.07
        p["hip"] = 0.25
        sw = math.sin(ph)
        hand = (0.2, -0.04 + 0.1 * sw, 0.12)
        p["hands"] = [hand, (0.2, 0.09, 0.16)]
        p["tool"] = ("sickle", hand, sw)
    elif anim == "build":
        # Hammering a peg: the hammer goes up, then down onto the post in front.
        z = [0.5, 0.42, 0.22, 0.3][f]
        p["lean"] = 0.03
        hand = (0.17, -0.06, z)
        p["hands"] = [hand, (0.2, 0.05, 0.2)]
        p["tool"] = ("hammer", hand, f)
    elif anim == "feed":
        # Bucket in one hand, throwing grain with the other.
        s = math.sin(ph)
        hand = (0.12 + 0.07 * s, -0.11, 0.33 + 0.05 * s)
        p["hands"] = [hand, (0.03, 0.15, 0.24)]
        p["tool"] = ("feed", hand, f)
    return p


def lerp3(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def farmer(c, sign, anim, f):
    R = Rig(c, sign)
    p = pose(anim, f)
    hip, lean = p["hip"], p["lean"]
    torso = (lean, 0.0, hip + 0.1 - lean * 0.4)
    neck_z = hip + 0.2 - lean * 0.8
    ha, hz = lean * 2.2, hip + 0.31 - lean * 1.6
    c.shadow_ell(0.03 if anim == "sit" else 0.0, 0, 0.09, 0.07)

    # legs, under the torso; the far one first
    for k, s in enumerate((-1, 1)):
        hip_p = R.W(0.0, s * 0.05, hip)
        foot = R.W(*p["feet"][k])
        knee = R.W(*p["knees"][k]) if p["knees"] else None

        def leg(hip_p=hip_p, foot=foot, knee=knee):
            pts_ = [hip_p] + ([knee] if knee else []) + [foot]
            for a, b in zip(pts_, pts_[1:]):
                c.limb(c.P(*a), c.P(*b), DENIM, 11)
            fx, fy = c.P(*foot)
            c.ell(fx + 2 * sign, fy - 2, 6.5, 4.5, BOOT, 0, OUT, 2)
        R.add(-10 + (1 if R.near(s * 0.05) else 0), leg)

    # torso: denim overalls over a red shirt, straps over the shoulders
    def body():
        c.ellipsoid(R.W(*torso), (0.085, 0.11, 0.115), DENIM, sw=2.5)
        c.ellipsoid(R.W(lean * 1.7, 0, neck_z), (0.05, 0.07, 0.035), SHIRT, sw=2, hi=0.2)
        for s in (-1, 1):
            a = c.P(*R.W(torso[0] + 0.05, s * 0.05, torso[2] + 0.02))
            b = c.P(*R.W(lean * 1.5, s * 0.08, neck_z))
            c.line(a, b, shade(DENIM, -0.25), 3)
    R.add(0.0, body)

    # head: face, hair at the back, eyes and nose when the face shows
    head_d = R.depth(ha, 0) + 0.001

    def head():
        c.ellipsoid(R.W(ha - 0.02, 0, hz + 0.008), (0.075, 0.08, 0.08), HAIR, sw=2, hi=0.15)
        c.ellipsoid(R.W(ha + 0.008, 0, hz), (0.075, 0.078, 0.082), SKIN, sw=2.5, hi=0.25)
        n = c.P(*R.W(ha + 0.088, 0, hz - 0.02))
        if sign > 0:
            c.circle(n[0], n[1], 4.5, shade(SKIN, -0.08), OUT, 1.5)
    R.add(head_d, head)
    for s in (-1, 1):
        ep = R.W(ha + 0.07, s * 0.035, hz + 0.0)
        hv = R.W(ha, 0, 0)
        if (ep[0] + ep[1]) - (hv[0] + hv[1]) > -0.02:
            R.add(head_d + 0.0005, lambda ep=ep: eye(c, *ep, r=3.6, look=(sign, 0)))

    def hat():
        c.ellipsoid(R.W(ha - 0.015, 0, hz + 0.085), (0.14, 0.14, 0.014), STRAW, sw=2.2, hi=0.2)
        c.ellipsoid(R.W(ha - 0.015, 0, hz + 0.105), (0.07, 0.07, 0.03), shade(BAND, -0.05), sw=2, hi=0.2)
        c.ellipsoid(R.W(ha - 0.015, 0, hz + 0.125), (0.068, 0.068, 0.035), STRAW, sw=2, hi=0.25)
    R.add(head_d + 0.001, hat)

    # arms: in front of the body when the hand is nearer the viewer than the shoulder line
    for k, s in enumerate((-1, 1)):
        sh = R.W(lean * 1.3, s * 0.1, neck_z - 0.03)
        hand = R.W(*p["hands"][k])
        hx, hy = p["hands"][k][0], p["hands"][k][1]
        d = R.depth(hx, hy) * 0.5 + R.depth(lean, s * 0.1) * 0.5
        d += 0.0 if d > 0 else -0.5

        def arm(sh=sh, hand=hand):
            c.limb(c.P(*sh), c.P(*hand), SHIRT, 8.5)
            hp = c.P(*hand)
            c.circle(hp[0], hp[1], 4.8, SKIN, OUT, 2)
        R.add(d, arm)

    tool = p["tool"]
    if tool:
        kind = tool[0]
        if kind == "hoe":
            _, blade, top = tool
            R.add(R.depth(blade[0], 0) * 0.5 + 0.0015, lambda: draw_hoe(c, R, blade, top))
        elif kind == "seeds":
            _, hand, fr = tool
            R.add(R.depth(0.08, -0.15) + (0.0 if R.near(-0.15) else -0.5), lambda: seed_bag(c, R))
            R.add(R.depth(hand[0], hand[1]) + 0.002, lambda: seeds(c, R, hand, fr))
        elif kind == "sickle":
            _, hand, sw = tool
            R.add(R.depth(hand[0], hand[1]) + 0.002, lambda: sickle(c, R, hand, sw))
        elif kind == "hammer":
            _, hand, fr = tool
            R.add(R.depth(0.24, 0) - 0.3, lambda: post(c, R))
            R.add(R.depth(hand[0], hand[1]) + 0.002, lambda: hammer(c, R, hand))
        elif kind == "feed":
            _, hand, fr = tool
            R.add(R.depth(0.03, 0.17) + (0.003 if R.near(0.17) else -0.5), lambda: bucket(c, R))
            R.add(R.depth(0.3, 0) + 0.002, lambda: grain(c, R, hand, fr))
    R.draw()


def draw_hoe(c, R, blade, top):
    a, b = c.P(*R.W(*top)), c.P(*R.W(*blade))
    c.limb(a, b, WOOD, 4)
    tip = c.P(*R.W(blade[0] + 0.05, blade[1], blade[2] + 0.06))
    c.poly([b, tip, (tip[0] + 6, tip[1] + 3), (b[0] + 6, b[1] + 4)], METAL, OUT, 2)


def seed_bag(c, R):
    cx, cy, *_ = c.ellipsoid(R.W(0.06, -0.16, 0.22), (0.045, 0.04, 0.055), "#e2c79a", sw=2, hi=0.2)
    c.ell(cx, cy - 8, 6, 2.5, shade("#e2c79a", -0.3), 0, None)


def seeds(c, R, hand, fr):
    for k in range(3):
        fall = ((fr + k * 1.3) % 4) / 4
        p = c.P(*R.W(hand[0] + 0.02 + 0.015 * k, hand[1] - 0.01 * k, max(0.0, hand[2] - 0.02 - fall * 0.08)))
        c.circle(p[0], p[1], 2.4, SEED, OUT, 1)


def sickle(c, R, hand, sw):
    h = c.P(*R.W(*hand))
    e = c.P(*R.W(hand[0] + 0.06, hand[1], hand[2] - 0.02))
    c.limb(h, e, WOOD, 4)
    d = 1 if R.s > 0 else -1
    c.path(f"M{f2(e[0])},{f2(e[1])} q{f2(14 * d)},-14 {f2(26 * d)},-2 q{f2(-10 * d)},-6 {f2(-26 * d)},2 Z", METAL, OUT, 2)
    # a few stalks being cut
    for k in range(3):
        g = c.P(*R.W(0.27 + 0.03 * k, -0.06 + 0.06 * k, 0))
        c.line(g, (g[0] + (k - 1) * 2, g[1] - 22 - 4 * k), "#d8b44a", 3)
        c.circle(g[0] + (k - 1) * 2, g[1] - 24 - 4 * k, 3.4, "#f0cf6a", OUT, 1.2)


def post(c, R):
    x, y, _ = R.W(0.25, 0.02, 0)
    c.box(x - 0.025, y - 0.025, 0, x + 0.025, y + 0.025, 0.2, shade(WOOD, 0.2), WOOD, shade(WOOD, -0.15), sw=2, shadow=False)


def hammer(c, R, hand):
    h = c.P(*R.W(*hand))
    hd = c.P(*R.W(hand[0] + 0.07, hand[1], hand[2] + 0.02))
    c.limb(h, hd, WOOD, 4)
    c.ell(hd[0], hd[1], 7, 5, "#6f7780", -20, OUT, 2)


def bucket(c, R):
    x, y, _ = R.W(0.03, 0.17, 0.12)
    c.cylinder(x, y, 0.1, 0.2, 0.04, "#9aa5ad", top="#e2c25e", sw=2, shadow=False)
    hp = c.P(*R.W(0.03, 0.15, 0.24))
    a, b = c.P(x - 0.03, y, 0.2), c.P(x + 0.03, y, 0.2)
    c.path(f"M{f2(a[0])},{f2(a[1])} Q{f2(hp[0])},{f2(hp[1] - 6)} {f2(b[0])},{f2(b[1])}", "none", OUT, 2)


def grain(c, R, hand, fr):
    for k in range(5):
        t = ((fr * 0.25 + k * 0.2) % 1.0)
        a = hand[0] + 0.05 + t * 0.25
        z = max(0.0, hand[2] + 0.06 * math.sin(math.pi * t) - t * hand[2])
        p = c.P(*R.W(a, hand[1] + 0.03 * (k - 2), z))
        c.circle(p[0], p[1], 2.4, SEED, OUT, 1)


def frames():
    fw, fh, ox, oy = 200, 190, 100, 150
    rows, meta = [], []
    for anim, n in ANIMS.items():
        for d in ("se", "sw", "ne", "nw"):
            src = "se" if d in ("se", "sw") else "nw"
            row = []
            for f in range(n):
                c = Canvas(fw, fh, ox, oy)
                farmer(c, DIRS_DRAWN[src], anim, f)
                row.append(c)
            rows.append(row)
            meta.append(dict(anim=anim, dir=d, frames=n, mirror=(d in ("sw", "ne")), fps=FPS[anim]))
    return rows, meta, fw, fh, (ox, oy)


def build():
    rows, meta, fw, fh, anchor = frames()
    sheet("people", "farmer", rows, fw, fh, anchor, meta,
          notes="rows = anim x direction; anchor = ground point under the farmer; sit = on the farmhouse bench (seat 0.14 high)")
