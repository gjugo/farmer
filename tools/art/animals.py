"""Animated animals: chicken, cow, sheep.

Each animal is assembled from projected ellipsoids and limbs in its own local
space (a = forward, b = sideways, z = up), placed into world space for a
facing direction and painted back-to-front.  SE and NW are drawn; SW and NE are
horizontal mirrors of those (exact in 2:1 dimetric).
"""
import math, random
from core import *
from registry import sheet

DIRS_DRAWN = {"se": 1, "nw": -1}   # world = sign * (a, b)
ANIMS = {"idle": 4, "walk": 6, "eat": 4}
VIEW = (1.0, 1.0)


class Rig:
    def __init__(self, c, sign):
        self.c, self.s = c, sign
        self.parts = []

    def W(self, a, b, z):
        return (self.s * a, self.s * b, z)

    def depth(self, a, b):
        x, y, _ = self.W(a, b, 0)
        return x + y

    def near(self, b):
        x, y, _ = self.W(0, b, 0)
        return x + y > 0

    def add(self, d, fn):
        self.parts.append((d, len(self.parts), fn))

    def draw(self):
        for _, _, fn in sorted(self.parts, key=lambda p: (p[0], p[1])):
            fn()


def eye(c, x, y, z, r=6.0, look=(1, 0)):
    sx, sy = c.P(x, y, z)
    c.ell(sx, sy, r, r * 1.15, "#ffffff", 0, OUT, 2)
    c.ell(sx + look[0] * r * 0.25, sy + 1, r * 0.55, r * 0.7, "#231a14", 0, None)
    c.circle(sx + look[0] * r * 0.25 - r * 0.2, sy - r * 0.25, r * 0.22, "#ffffff", None)


def leg(c, hip, foot, color, w, hoof=None):
    a, b = c.P(*hip), c.P(*foot)
    c.limb(a, b, color, w)
    if hoof:
        c.line((b[0], b[1] - 2), (b[0], b[1] + 2), OUT, w + 2 * OW)
        c.line((b[0], b[1] - 2), (b[0], b[1] + 1), hoof, w)


def gait(t, n_legs=4):
    """returns per-leg (forward offset factor, lift factor) for walk phase t in [0,1)."""
    ph = 2 * math.pi * t
    out = []
    for k in range(n_legs):
        off = 0 if k in (0, 3) else math.pi       # diagonal pairs move together
        out.append((math.sin(ph + off), max(0.0, math.cos(ph + off))))
    return out


# ================================================================== COW
def cow(c, sign, anim, f):
    R = Rig(c, sign)
    n = ANIMS[anim]
    t = f / n
    bob = 0.0
    head_dz, head_da, tail_sw, ear = 0.0, 0.0, 0.0, 0.0
    legs_off = [(0, 0)] * 4
    if anim == "walk":
        g = gait(t)
        legs_off = [(0.07 * s_, 0.05 * l_) for s_, l_ in g]
        bob = 0.012 * abs(math.sin(2 * math.pi * t * 2))
        head_dz = 0.012 * math.sin(2 * math.pi * t * 2)
        tail_sw = 0.04 * math.sin(2 * math.pi * t)
    elif anim == "idle":
        bob = 0.006 * math.sin(2 * math.pi * t)
        tail_sw = 0.06 * math.sin(2 * math.pi * t)
        ear = 0.02 * math.sin(2 * math.pi * t * 2)
    else:  # eat: head down to grass, chewing
        head_dz = -0.27 + 0.015 * math.sin(2 * math.pi * t * 2)
        head_da = 0.06
        tail_sw = 0.05 * math.sin(2 * math.pi * t)
    BODY = "#fbfaf6"
    SPOT = "#2e2a2b"
    body_c = (0.0, 0.0, 0.43 + bob)
    hips = [(0.21, 0.1), (0.21, -0.1), (-0.21, 0.1), (-0.21, -0.1)]   # FL? index: 0 front-near,1 front-far,2 back-near,3 back-far (for +b near)
    order = [0, 1, 2, 3]
    for k, (ha, hb) in enumerate(hips):
        fa, lift = legs_off[[0, 1, 2, 3][k]]
        hip = R.W(ha, hb, 0.36 + bob)
        foot = R.W(ha + fa, hb, lift)
        near = R.near(hb)

        def dl(hip=hip, foot=foot, near=near):
            h = hip if not near else (hip[0], hip[1], hip[2] - 0.05)
            leg(c, h, foot, BODY, 10, "#4b3a2f")
            # a black sock on two legs for character
        R.add(R.depth(ha, hb) + (0 if near else -10), dl)
    c.shadow_ell(0, 0, 0.3, 0.2)

    # tail
    def tail():
        root = R.W(-0.35, 0, 0.53 + bob)
        tip = R.W(-0.41, tail_sw, 0.22 + bob)
        a, b = c.P(*root), c.P(*tip)
        c.path(f"M{f2(a[0])},{f2(a[1])} Q{f2((a[0] + b[0]) / 2 + 4)},{f2((a[1] + b[1]) / 2)} {f2(b[0])},{f2(b[1])}", "none", OUT, 6)
        c.path(f"M{f2(a[0])},{f2(a[1])} Q{f2((a[0] + b[0]) / 2 + 4)},{f2((a[1] + b[1]) / 2)} {f2(b[0])},{f2(b[1])}", "none", BODY, 3)
        c.ell(b[0], b[1] + 3, 4.5, 7, SPOT, 0, OUT, 2)
    R.add(R.depth(-0.36, 0), tail)

    def body():
        # udder
        if True:
            u = R.W(-0.12, 0, 0.27 + bob)
            ux, uy = c.P(*u)
        cx, cy, rx, ry, ang = c.ellipsoid(body_c, (0.36, 0.2, 0.19), BODY)
        clip = c.clip(f'<ellipse cx="{f2(cx)}" cy="{f2(cy)}" rx="{f2(rx - 1.5)}" ry="{f2(ry - 1.5)}" transform="rotate({f2(ang)} {f2(cx)} {f2(cy)})"/>')
        rnd = random.Random(4)

        def spots():
            for (sa, sb, sz, r) in ((0.1, 0.2, 0.08, 0.09), (-0.18, 0.18, 0.02, 0.1), (0.0, 0.0, 0.19, 0.11),
                                    (-0.2, -0.15, 0.1, 0.09), (0.2, -0.17, 0.05, 0.07), (-0.05, -0.2, -0.05, 0.08)):
                p = R.W(sa, sb, body_c[2] + sz)
                sx, sy = c.P(*p)
                c.ell(sx, sy, K * r * 1.1, K * r * 0.75, SPOT, rnd.uniform(-30, 30), None)
        c.group(spots, clip=clip)
        # belly shading
        c.ell(cx, cy + ry * 0.45, rx * 0.8, ry * 0.4, "#000", ang, None, extra='opacity="0.06"')
    R.add(0.0, body)
    # udder (under body, visible between legs)
    R.add(-5, lambda: c.ellipsoid(R.W(-0.12, 0, 0.27 + bob), (0.07, 0.07, 0.05), "#f7a8b8", sw=2))

    # head
    ha = 0.42 + head_da
    hz = 0.6 + bob + head_dz
    head_d = R.depth(ha, 0)

    def neck():
        c.ellipsoid(R.W(0.3 + head_da * 0.5, 0, 0.5 + bob + head_dz * 0.5), (0.13, 0.13, 0.14), BODY)
    R.add(R.depth(0.28, 0) + (0.001 if sign > 0 else -0.001), neck)

    def head():
        for side in (-1, 1):
            pass
        c.ellipsoid(R.W(ha, 0, hz), (0.13, 0.115, 0.12), BODY)
        # spot over one eye
        p = R.W(ha + 0.02, 0.07, hz + 0.05)
        sx, sy = c.P(*p)
        if sign > 0:
            c.ell(sx, sy, 10, 8, SPOT, 0, None)
    # ears & horns: far ones behind head, near ones in front
    for side in (-1, 1):
        b = side * 0.15
        near = R.near(b)
        d = head_d + (0.002 if near else -0.002)

        def ear_fn(b=b):
            c.ellipsoid(R.W(ha - 0.04, b, hz + 0.05 + ear), (0.04, 0.08, 0.035), "#f3d2c4", sw=2)

        def horn_fn(side=side):
            base = c.P(*R.W(ha - 0.03, side * 0.07, hz + 0.1))
            tip = c.P(*R.W(ha - 0.02, side * 0.11, hz + 0.19))
            c.limb(base, tip, "#f6e7c1", 6)
        R.add(d, ear_fn)
        R.add(d + (0.0005 if near else -0.0005), horn_fn)
    R.add(head_d, head)

    def muzzle():
        p = R.W(ha + 0.11, 0, hz - 0.06)
        c.ellipsoid(p, (0.065, 0.1, 0.07), "#f6b9b3", sw=2.5)
        for side in (-1, 1):
            q = c.P(*R.W(ha + 0.165, side * 0.04, hz - 0.05))
            c.ell(q[0], q[1], 2.6, 2, "#8a4b4b", 0, None)
    R.add(R.depth(ha + 0.11, 0) + 0.003, muzzle)
    for side in (-1, 1):
        ep = R.W(ha + 0.07, side * 0.08, hz + 0.04)
        vis = (ep[0] + ep[1]) - (R.W(ha, 0, 0)[0] + R.W(ha, 0, 0)[1]) > -0.05
        if vis:
            R.add(head_d + 0.0015, lambda ep=ep: eye(c, *ep, r=5.5, look=(sign, 0)))
    R.draw()


# ================================================================== SHEEP
def fluffy(c, center, radii, color, n=14, bump=11):
    cx, cy, rx, ry, ang = c.ellipsoid(center, radii, color, stroke=None, shading=False)
    a = math.radians(ang)
    for k in range(n):
        th = 2 * math.pi * k / n
        px = cx + rx * math.cos(th) * math.cos(a) - ry * math.sin(th) * math.sin(a)
        py = cy + rx * math.cos(th) * math.sin(a) + ry * math.sin(th) * math.cos(a)
        c.circle(px, py, bump, color, OUT, OW)
    fill = c.rad([(0, shade(color, 0.5)), (0.6, color), (1, shade(color, -0.12))])
    c.ell(cx, cy, rx, ry, fill, ang, None)
    # curls
    rnd = random.Random(int(cx * 7 + cy))
    for k in range(9):
        u, v = rnd.uniform(-0.7, 0.7), rnd.uniform(-0.6, 0.6)
        px = cx + rx * u * math.cos(a) - ry * v * math.sin(a)
        py = cy + rx * u * math.sin(a) + ry * v * math.cos(a)
        c.path(f"M{f2(px - 5)},{f2(py)} a5,4 0 1,1 9,-1", "none", shade(color, -0.18), 2)
    return cx, cy, rx, ry, ang


def sheep(c, sign, anim, f):
    R = Rig(c, sign)
    n = ANIMS[anim]
    t = f / n
    bob = head_dz = head_da = tail_sw = ear = 0.0
    legs_off = [(0, 0)] * 4
    if anim == "walk":
        legs_off = [(0.06 * s_, 0.045 * l_) for s_, l_ in gait(t)]
        bob = 0.012 * abs(math.sin(2 * math.pi * t * 2))
        head_dz = 0.012 * math.sin(2 * math.pi * t * 2)
    elif anim == "idle":
        bob = 0.007 * math.sin(2 * math.pi * t)
        ear = 0.025 * math.sin(2 * math.pi * t * 2)
        tail_sw = 0.03 * math.sin(2 * math.pi * t * 2)
    else:
        head_dz = -0.21 + 0.012 * math.sin(2 * math.pi * t * 2)
        head_da = 0.05
    WOOL = "#f3eee2"
    SKIN = "#4b4650"
    body_c = (0.0, 0.0, 0.34 + bob)
    hips = [(0.15, 0.08), (0.15, -0.08), (-0.15, 0.08), (-0.15, -0.08)]
    for k, (ha_, hb) in enumerate(hips):
        fa, lift = legs_off[k]
        hip = R.W(ha_, hb, 0.25 + bob)
        foot = R.W(ha_ + fa, hb, lift)
        near = R.near(hb)
        R.add(R.depth(ha_, hb) + (0 if near else -10), lambda hip=hip, foot=foot: leg(c, hip, foot, SKIN, 7.5, "#2c2930"))
    c.shadow_ell(0, 0, 0.25, 0.18)
    R.add(R.depth(-0.27, 0), lambda: c.ellipsoid(R.W(-0.28, tail_sw, 0.4 + bob), (0.05, 0.05, 0.06), WOOL, sw=2.5))
    R.add(0.0, lambda: fluffy(c, body_c, (0.28, 0.18, 0.17), WOOL, n=16, bump=10))
    ha = 0.3 + head_da
    hz = 0.42 + bob + head_dz
    head_d = R.depth(ha, 0)

    def head():
        c.ellipsoid(R.W(ha, 0, hz), (0.1, 0.075, 0.085), SKIN, hi=0.25)
        c.ellipsoid(R.W(ha + 0.07, 0, hz - 0.03), (0.05, 0.055, 0.045), shade(SKIN, 0.12), sw=2, hi=0.2)

    def topknot():
        p = R.W(ha - 0.03, 0, hz + 0.08)
        sx, sy = c.P(*p)
        for dx, dy, r in ((-6, 2, 7), (5, 2, 7), (0, -4, 8)):
            c.circle(sx + dx, sy + dy, r, WOOL)
        c.circle(sx, sy, 6, WOOL, None)
    for side in (-1, 1):
        b = side * 0.11
        near = R.near(b)
        R.add(head_d + (0.002 if near else -0.002),
              lambda b=b: c.ellipsoid(R.W(ha - 0.02, b, hz + 0.02 + ear), (0.03, 0.07, 0.025), SKIN, sw=2, hi=0.2))
    R.add(head_d, head)
    R.add(head_d + 0.0025, topknot)
    for side in (-1, 1):
        ep = R.W(ha + 0.06, side * 0.055, hz + 0.02)
        hv = R.W(ha, 0, 0)
        if (ep[0] + ep[1]) - (hv[0] + hv[1]) > -0.05:
            R.add(head_d + 0.0015, lambda ep=ep: eye(c, *ep, r=4.8, look=(sign, 0)))
    R.draw()


# ================================================================== CHICKEN
def chicken(c, sign, anim, f):
    R = Rig(c, sign)
    n = ANIMS[anim]
    t = f / n
    bob, head_da, head_dz, tail = 0.0, 0.0, 0.0, 0.0
    legs = [(0, 0), (0, 0)]
    if anim == "walk":
        ph = 2 * math.pi * t
        legs = [(0.035 * math.sin(ph), 0.025 * max(0, math.cos(ph))), (0.035 * math.sin(ph + math.pi), 0.025 * max(0, math.cos(ph + math.pi)))]
        bob = 0.008 * abs(math.sin(ph))
        head_da = 0.025 * math.sin(2 * ph)      # the classic head-bob
    elif anim == "idle":
        bob = 0.004 * math.sin(2 * math.pi * t)
        tail = 0.01 * math.sin(2 * math.pi * t)
        head_dz = [0, 0.006, 0, -0.004][f]
    else:   # peck
        dz = [0.0, -0.09, -0.15, -0.06][f]
        head_dz, head_da = dz, -dz * 0.5
    WHITE = "#fffdf7"
    LEGC = "#f2a33a"
    for k, hb in enumerate((0.035, -0.035)):
        fa, lift = legs[k]
        hip = R.W(0.0, hb, 0.1 + bob)
        foot = R.W(fa, hb, lift)
        near = R.near(hb)

        def dl(hip=hip, foot=foot):
            leg(c, hip, foot, LEGC, 3.5)
            fx, fy = c.P(*foot)
            c.line((fx - 4, fy), (fx + 5 * sign, fy + 1), LEGC, 3)
        R.add(R.depth(0, hb) + (0 if near else -10), dl)
    c.shadow_ell(0, 0, 0.1, 0.08)

    def tailf():
        for k, (da, dz) in enumerate(((-0.02, 0.06), (-0.04, 0.03), (0.0, 0.08))):
            c.ellipsoid(R.W(-0.1 + da, (k - 1) * 0.025, 0.2 + bob + dz + tail), (0.045, 0.025, 0.065), WHITE, sw=2.2, hi=0.2)
    R.add(R.depth(-0.11, 0), tailf)
    body_c = (0.0, 0.0, 0.17 + bob)
    R.add(0.0, lambda: c.ellipsoid(body_c, (0.13, 0.095, 0.1), WHITE, hi=0.2, lo=-0.12))
    # wing on the visible side
    for side in (-1, 1):
        b = side * 0.08
        if R.near(b):
            R.add(0.0005, lambda b=b: c.ellipsoid(R.W(-0.01, b, 0.18 + bob), (0.08, 0.025, 0.05), shade(WHITE, -0.06), sw=2.2, hi=0.1))
    ha = 0.1 + head_da
    hz = 0.3 + bob + head_dz
    head_d = R.depth(ha, 0)

    def head():
        c.ellipsoid(R.W(ha, 0, hz), (0.055, 0.05, 0.055), WHITE, hi=0.2)
        # comb
        for k in range(3):
            c.ellipsoid(R.W(ha - 0.02 + k * 0.022, 0, hz + 0.055 + (0.006 if k == 1 else 0)), (0.017, 0.012, 0.022), "#e8423a", sw=1.6, hi=0.25)

    def beak():
        tip = c.P(*R.W(ha + 0.085, 0, hz - 0.005))
        b0 = c.P(*R.W(ha + 0.04, 0.0, hz + 0.012))
        b1 = c.P(*R.W(ha + 0.04, 0.0, hz - 0.022))
        c.poly([b0, tip, b1], "#f6a62c", OUT, 1.8)
        w = c.P(*R.W(ha + 0.04, 0, hz - 0.045))
        c.ell(w[0], w[1], 3.6, 5.5, "#e8423a", 0, OUT, 1.6)
    R.add(head_d, head)
    R.add(R.depth(0.06, 0) * 0.5 + (0.0002 if sign > 0 else -0.0002),
          lambda: c.ellipsoid(R.W(0.06 + head_da * 0.6, 0, 0.245 + bob + head_dz * 0.6), (0.05, 0.045, 0.065), WHITE, sw=2.2, hi=0.2))
    R.add(R.depth(ha + 0.06, 0) + (0.003 if sign > 0 else -0.003), beak)
    for side in (-1, 1):
        ep = R.W(ha + 0.03, side * 0.035, hz + 0.012)
        hv = R.W(ha, 0, 0)
        if (ep[0] + ep[1]) - (hv[0] + hv[1]) > -0.03:
            R.add(head_d + 0.0015, lambda ep=ep: eye(c, *ep, r=3.3, look=(sign, 0)))
    R.draw()


# ================================================================== build
SPECS = {
    # name: (fn, frame w, frame h, origin x, origin y)   (2x pixels, trimmed later)
    "cow": (cow, 260, 230, 130, 175),
    "sheep": (sheep, 220, 190, 110, 145),
    "chicken": (chicken, 120, 110, 60, 85),
}


def frames(name):
    fn, fw, fh, ox, oy = SPECS[name]
    rows, meta = [], []
    for anim, n in ANIMS.items():
        for d in ("se", "sw", "ne", "nw"):
            src = "se" if d in ("se", "sw") else "nw"
            row = []
            for f in range(n):
                c = Canvas(fw, fh, ox, oy)
                fn(c, DIRS_DRAWN[src], anim, f)
                row.append(c)
            rows.append(row)
            meta.append(dict(anim=anim, dir=d, frames=n, mirror=(d in ("sw", "ne"))))
    return rows, meta, fw, fh, (ox, oy)


def build():
    fps = {"idle": 4, "walk": 9, "eat": 5}
    for nm in SPECS:
        rows, meta, fw, fh, anchor = frames(nm)
        for m in meta:
            m["fps"] = fps[m["anim"]]
        sheet("animals", nm, rows, fw, fh, anchor, meta,
              notes="rows = anim x direction; anchor = ground point under the animal's centre")
