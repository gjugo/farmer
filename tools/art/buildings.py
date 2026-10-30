"""Buildings at their tile footprints."""
import math, random
from core import *
from registry import image, sheet
import icons as IC

TRIM = "#fbf3e2"
GLASS = "#8fcbe9"


# ------------------------------------------------------------------ helpers
def bcanvas(w, h, top=420):
    m = 30
    return Canvas(int((w + h) * K + 2 * m + 160), int((w + h) * K / 2 + top + m + 60), h * K + m, top)


class Plane:
    """A visible wall plane. kind 'y': plane y=v (lower-left face, u = x).
    kind 'x': plane x=v (lower-right face, u = y, increases toward the viewer's left)."""
    def __init__(self, c, kind, v):
        self.c, self.k, self.v = c, kind, v

    def W(self, u, z, out=0.0):
        return (u, self.v + out, z) if self.k == "y" else (self.v + out, u, z)

    def P(self, u, z, out=0.0):
        return self.c.P(*self.W(u, z, out))

    def rect(self, u0, u1, z0, z1, fill, stroke=OUT, sw=OW * 0.8, out=0.0):
        self.c.poly([self.P(u0, z0, out), self.P(u1, z0, out), self.P(u1, z1, out), self.P(u0, z1, out)], fill, stroke, sw)

    def line(self, u0, z0, u1, z1, color, w, out=0.0, opacity=None):
        self.c.line(self.P(u0, z0, out), self.P(u1, z1, out), color, w, opacity=opacity)

    def planks(self, u0, u1, z0, z1, step, color, opacity=0.35):
        z = z0 + step
        while z < z1 - 0.01:
            self.line(u0, z, u1, z, color, 2, opacity=opacity)
            z += step

    def window(self, u, z0, w, h, frame=TRIM, shutters=None, flower=None):
        u0, u1 = u - w / 2, u + w / 2
        if shutters:
            self.rect(u0 - w * 0.42, u0 - 0.01, z0, z0 + h, shutters, sw=2)
            self.rect(u1 + 0.01, u1 + w * 0.42, z0, z0 + h, shutters, sw=2)
            for uu in (u0 - w * 0.21, u1 + w * 0.21):
                self.line(uu - w * 0.12, z0 + h * 0.3, uu + w * 0.12, z0 + h * 0.3, shade(shutters, -0.3), 2)
                self.line(uu - w * 0.12, z0 + h * 0.7, uu + w * 0.12, z0 + h * 0.7, shade(shutters, -0.3), 2)
        self.rect(u0 - 0.025, u1 + 0.025, z0 - 0.025, z0 + h + 0.025, frame, sw=2.5)
        self.rect(u0, u1, z0, z0 + h, self.c.lin([(0, shade(GLASS, 0.35)), (1, shade(GLASS, -0.15))]), sw=2)
        self.line(u, z0, u, z0 + h, frame, 4)
        self.line(u0, z0 + h / 2, u1, z0 + h / 2, frame, 4)
        # glint
        self.line(u0 + w * 0.15, z0 + h * 0.62, u0 + w * 0.32, z0 + h * 0.88, "#ffffff", 3, opacity=0.7)
        if flower:
            self.rect(u0 - 0.04, u1 + 0.04, z0 - 0.09, z0 - 0.02, "#a0612f", sw=2, out=0.04)
            rnd = random.Random(int(u * 100))
            for k in range(5):
                p = self.P(u0 + (k + 0.5) * (w / 5), z0 - 0.01, 0.05)
                self.c.circle(p[0] + rnd.uniform(-2, 2), p[1] - rnd.uniform(0, 3), 4.5, flower, OUT, 1.5)
                self.c.circle(p[0] + 4, p[1] + 2, 3, "#5cb83c", None)
        else:
            self.rect(u0 - 0.04, u1 + 0.04, z0 - 0.05, z0 - 0.02, frame, sw=2, out=0.0)

    def door(self, u, w, h, color, frame=TRIM, arch=False, double=False, xbrace=None):
        u0, u1 = u - w / 2, u + w / 2
        self.rect(u0 - 0.03, u1 + 0.03, 0, h + 0.03, frame, sw=2.5)
        self.rect(u0, u1, 0, h, self.c.lin([(0, shade(color, 0.12)), (1, shade(color, -0.12))]), sw=2)
        n = 4 if not double else 6
        for k in range(1, n):
            uu = u0 + (u1 - u0) * k / n
            self.line(uu, 0.02, uu, h - 0.02, shade(color, -0.3), 2, opacity=0.6)
        if double:
            self.line(u, 0, u, h, frame, 4)
        if xbrace:
            for a0, a1 in ((u0, u) , (u, u1)) if double else ((u0, u1),):
                self.line(a0, 0.03, a1, h - 0.03, xbrace, 5)
                self.line(a0, h - 0.03, a1, 0.03, xbrace, 5)
                self.line(a0, h / 2, a1, h / 2, xbrace, 5)
        knob = self.P(u1 - w * 0.18, h * 0.45, 0.01)
        if not double:
            self.c.circle(knob[0], knob[1], 3.2, "#f2c14e", OUT, 1.5)


def pad(c, w, h, color, inset=0.05, pattern=None):
    i = inset
    edge = shade(color, -0.25)
    c.poly(c.PP([(i, h - i, 0), (w - i, h - i, 0), (w - i, h - i, 0.025), (i, h - i, 0.025)]), shade(color, -0.2), None)
    c.poly(c.PP([(w - i, i, 0), (w - i, h - i, 0), (w - i, h - i, 0.025), (w - i, i, 0.025)]), shade(color, -0.32), None)
    top = c.PP([(i, i, 0.025), (w - i, i, 0.025), (w - i, h - i, 0.025), (i, h - i, 0.025)])
    c.poly(top, color, edge, 2.5)
    if pattern == "stone":
        clip = c.clip(f'<polygon points="{pts(top)}"/>')

        def pav():
            rnd = random.Random(int(w * 10 + h))
            step = 0.25
            yy = i
            r = 0
            while yy < h:
                xx = i - (step / 2 if r % 2 else 0)
                while xx < w:
                    p = c.PP([(xx + 0.015, yy + 0.015, 0.025), (xx + step - 0.015, yy + 0.015, 0.025),
                              (xx + step - 0.015, yy + step - 0.015, 0.025), (xx + 0.015, yy + step - 0.015, 0.025)])
                    c.poly(p, shade(color, rnd.uniform(-0.06, 0.08)), shade(color, -0.2), 1.2)
                    xx += step
                yy += step
                r += 1
        c.group(pav, clip=clip)
    elif pattern == "dirt":
        rnd = random.Random(3)
        for _ in range(int(14 * w * h / 4) + 6):
            x, y = rnd.uniform(i + 0.1, w - i - 0.1), rnd.uniform(i + 0.1, h - i - 0.1)
            sx, sy = c.P(x, y, 0.025)
            c.ell(sx, sy, rnd.uniform(2, 4) * 1.3, rnd.uniform(1.5, 3), shade(color, rnd.choice([-0.2, 0.15])), 0, None)


def edge_trim(c, x0, y0, x1, y1, z0, z1, color, w=7):
    """Vertical corner boards on the three visible vertical edges + top edges."""
    for (x, y) in ((x0, y1), (x1, y1), (x1, y0)):
        a, b = c.P(x, y, z0), c.P(x, y, z1)
        c.line(a, b, OUT, w + 2 * OW * 0.8, cap="butt")
        c.line(a, b, color, w, cap="butt")


def hay(c, x, y, z=0.0, s=1.0, round_=False):
    col = "#f0c95a"
    if round_:
        cx, ct, rx, ry = c.cylinder(x, y, z, z + 0.22 * s, 0.17 * s, col, top=shade(col, 0.15))
        for k in range(3):
            c.ell(cx, ct, rx * (0.75 - k * 0.22), ry * (0.75 - k * 0.22), "none", 0, shade(col, -0.35), 1.6)
        return
    c.box(x - 0.16 * s, y - 0.11 * s, z, x + 0.16 * s, y + 0.11 * s, z + 0.17 * s, shade(col, 0.15), col, shade(col, -0.12))
    for t in (0.33, 0.66):
        a, b = c.P(x - 0.16 * s + 0.32 * s * t, y + 0.11 * s, z), c.P(x - 0.16 * s + 0.32 * s * t, y + 0.11 * s, z + 0.17 * s)
        c.line(a, b, "#b5651d", 3)
        a2 = c.P(x + 0.16 * s, y - 0.11 * s + 0.22 * s * t, z)
        b2 = c.P(x + 0.16 * s, y - 0.11 * s + 0.22 * s * t, z + 0.17 * s)
        c.line(a2, b2, "#b5651d", 3)
    rnd = random.Random(int(x * 100 + y * 10))
    for _ in range(6):
        p = c.P(x + rnd.uniform(-0.14, 0.14) * s, y + rnd.uniform(-0.1, 0.1) * s, z + 0.17 * s)
        c.line(p, (p[0] + rnd.uniform(-6, 6), p[1] - rnd.uniform(2, 6)), shade(col, -0.25), 1.5)


def crate(c, x, y, z=0.0, s=1.0, fill=None, wood="#c8894a"):
    r = 0.12 * s
    hgt = 0.17 * s
    c.box(x - r, y - r, z, x + r, y + r, z + hgt, shade(wood, 0.2), wood, shade(wood, -0.15))
    for pl in (Plane(c, "y", y + r), Plane(c, "x", x + r)):
        lo, hi = ((x - r, x + r) if pl.k == "y" else (y - r, y + r))
        pl.line(lo, z + hgt * 0.5, hi, z + hgt * 0.5, shade(wood, -0.35), 2.5)
        pl.line(lo + 0.02, z + 0.02, hi - 0.02, z + hgt - 0.02, shade(wood, -0.25), 3)
    if fill:
        rnd = random.Random(int(x * 77 + y * 13))
        items = [(rnd.uniform(-r * 0.7, r * 0.7), rnd.uniform(-r * 0.7, r * 0.7)) for _ in range(6)]
        for (dx, dy) in sorted(items, key=lambda t: t[0] + t[1]):
            p = c.P(x + dx, y + dy, z + hgt)
            c.circle(p[0], p[1] - 3, 7 * s, fill, OUT, 1.8)
            c.circle(p[0] - 2, p[1] - 6, 2.2 * s, shade(fill, 0.5), None)


def sack(c, x, y, s=1.0, color="#e2c79a", label=None):
    cx, cy = c.P(x, y, 0)
    w, h = 22 * s, 30 * s
    c.shadow_ell(x, y, 0.08 * s, z=0.1)
    d = (f"M{f2(cx - w)},{f2(cy)} Q{f2(cx - w - 4)},{f2(cy - h)} {f2(cx - w * 0.45)},{f2(cy - h * 1.15)} "
         f"L{f2(cx - 6 * s)},{f2(cy - h * 1.35)} L{f2(cx + 6 * s)},{f2(cy - h * 1.35)} L{f2(cx + w * 0.45)},{f2(cy - h * 1.15)} "
         f"Q{f2(cx + w + 4)},{f2(cy - h)} {f2(cx + w)},{f2(cy)} Q{f2(cx)},{f2(cy + 7 * s)} {f2(cx - w)},{f2(cy)} Z")
    c.path(d, c.lin([(0, shade(color, 0.15)), (1, shade(color, -0.15))], 0, 0, 1, 0), OUT, 2.5)
    c.line((cx - 7 * s, cy - h * 1.15), (cx + 7 * s, cy - h * 1.15), "#9b6a3c", 3)
    if label:
        c.circle(cx, cy - h * 0.5, 7 * s, label, OUT, 1.5)


def milk_can(c, x, y, s=1.0):
    cx, ct, rx, ry = c.cylinder(x, y, 0, 0.2 * s, 0.07 * s, "#cfd8de", top="#e8eef2")
    c.cylinder(x, y, 0.2 * s, 0.26 * s, 0.035 * s, "#b9c4cc", top="#dfe6ea")
    c.cylinder(x, y, 0.26 * s, 0.28 * s, 0.05 * s, "#9aa6ae", top="#c8d0d6", shadow=False)
    c.ell(cx, ct + 18 * s, rx, ry * 0.6, "none", 0, "#8a969e", 2)


def hanging_sign(c, plane, u, z, icon, board="#c48a4f", size=0.17):
    """A board hanging from a bracket, facing the plane's direction, with an icon painted on."""
    out = 0.12
    p_wall = plane.P(u, z + 0.08, 0)
    p_arm = plane.P(u, z + 0.08, out)
    c.limb(p_wall, p_arm, "#5a4636", 4)
    cx, cy = plane.P(u, z - size * 0.55, out)
    # square board drawn flat in screen (a sign turned toward the viewer reads best)
    s = K * size
    for dx in (-s * 0.35, s * 0.35):
        c.line((p_arm[0] + dx * 0 + dx * 0.0, p_arm[1]), (cx + dx, cy - s * 0.55), "#5a4636", 2)
    c.path(f"M{f2(cx - s * 0.6)},{f2(cy - s * 0.55)} h{f2(s * 1.2)} v{f2(s * 1.0)} q0,{f2(s * 0.2)} {f2(-s * 0.2)},{f2(s * 0.2)} "
           f"h{f2(-s * 0.8)} q{f2(-s * 0.2)},0 {f2(-s * 0.2)},{f2(-s * 0.2)} Z", c.lin([(0, shade(board, 0.15)), (1, shade(board, -0.12))]), OUT, 2.5)
    c.group(lambda: icon(c), transform=f"translate({f2(cx - s * 0.5)},{f2(cy - s * 0.45)}) scale({f2(s / 128)})")


def awning(c, plane, u0, u1, z_top, depth, drop, colors=("#e8483d", "#fbf3e2"), n=None):
    n = n or max(4, int(abs(u1 - u0) / 0.11))
    w = (u1 - u0) / n
    for k in range(n):
        a, b = u0 + k * w, u0 + (k + 1) * w
        col = colors[k % 2]
        quad = [plane.P(a, z_top, 0), plane.P(b, z_top, 0), plane.P(b, z_top - drop, depth), plane.P(a, z_top - drop, depth)]
        c.poly(quad, c.lin([(0, shade(col, 0.1)), (1, shade(col, -0.1))]), OUT, 2)
        # scallop
        p, q = plane.P(a, z_top - drop, depth), plane.P(b, z_top - drop, depth)
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        c.path(f"M{f2(p[0])},{f2(p[1])} Q{f2(mx)},{f2(my + 16)} {f2(q[0])},{f2(q[1])} Z", col, OUT, 2)


def chimney(c, x, y, zb, zt, color="#b55a3c"):
    c.box(x - 0.09, y - 0.09, zb, x + 0.09, y + 0.09, zt, shade(color, 0.15), color, shade(color, -0.15))
    c.box(x - 0.11, y - 0.11, zt, x + 0.11, y + 0.11, zt + 0.05, "#6b6b6b", "#8a8a8a", "#707070", shadow=False)
    top = c.P(x, y, zt + 0.05)
    for k, (dx, dy, r) in enumerate(((0, -18, 10), (8, -36, 13), (-2, -58, 16))):
        c.circle(top[0] + dx, top[1] + dy, r, "#ffffff", "#c9c9c9", 2, extra=f'opacity="{0.85 - k * 0.2}"')


# ================================================================== BARN 4x4
def barn():
    c = bcanvas(4, 4, top=470)
    pad(c, 4, 4, "#d6b07a", pattern="dirt")
    x0, y0, x1, y1, zw, zr = 0.35, 0.35, 3.0, 2.85, 1.0, 1.75
    RED = "#cf4535"
    c.box(x0, y0, 0, x1, y1, zw, "#b33a2d", RED, shade(RED, -0.12))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    for u in [x0 + k * 0.16 for k in range(1, int((x1 - x0) / 0.16))]:
        L.line(u, 0.02, u, zw - 0.02, shade(RED, -0.3), 2, opacity=0.4)
    for u in [y0 + k * 0.16 for k in range(1, int((y1 - y0) / 0.16))]:
        R.line(u, 0.02, u, zw - 0.02, shade(RED, -0.35), 2, opacity=0.4)
    L.window(0.95, 0.42, 0.34, 0.32, shutters=None)
    L.window(2.35, 0.42, 0.34, 0.32, shutters=None)
    R.door((y0 + y1) / 2, 1.0, 0.78, RED, double=True, xbrace=TRIM)
    edge_trim(c, x0, y0, x1, y1, 0, zw, TRIM)
    c.gable_roof(x0, y0, x1, y1, zw, zr, "#6f7d8c", along="x", oh=0.14, gable_color=RED, rows=7, cols=16)
    # gable trim + hayloft
    ym = (y0 + y1) / 2
    R.rect(ym - 0.22, ym + 0.22, zw + 0.12, zw + 0.5, "#7a4a2a", sw=2.5)
    R.rect(ym - 0.18, ym + 0.18, zw + 0.12, zw + 0.46, "#3b2416", sw=1.5)
    rnd = random.Random(2)
    for _ in range(14):
        p = R.P(ym + rnd.uniform(-0.17, 0.17), zw + 0.14 + rnd.uniform(0, 0.06), 0.01)
        c.line(p, (p[0] + rnd.uniform(-8, 8), p[1] - rnd.uniform(6, 14)), "#f0c95a", 3)
    c.line(R.P(ym - 0.24, zw + 0.52), R.P(ym + 0.24, zw + 0.52), TRIM, 5)
    # weathervane
    rp = c.P(x0 + 0.4, ym, zr + 0.02)
    c.line(rp, (rp[0], rp[1] - 34), OUT, 3)
    c.path(f"M{f2(rp[0] - 12)},{f2(rp[1] - 30)} l12,-8 l14,4 l-6,6 Z", "#3b3b3b", OUT, 1.5)
    # props in front
    hay(c, 3.35, 1.0, round_=True)
    hay(c, 3.45, 3.35)
    hay(c, 3.15, 3.55, s=0.9)
    # trough
    c.box(1.0, 3.15, 0, 2.2, 3.45, 0.15, "#8a5a32", "#a7703f", "#8f5f35")
    c.poly(c.PP([(1.05, 3.2, 0.15), (2.15, 3.2, 0.15), (2.15, 3.4, 0.15), (1.05, 3.4, 0.15)]), "#e9c560", OUT, 2)
    return c


# ================================================================== COOP 3x3
def coop():
    c = bcanvas(3, 3, top=380)
    pad(c, 3, 3, "#e3c88f", pattern="dirt")
    # run (back half of fence first)
    rx0, ry0, rx1, ry1 = 1.75, 0.3, 2.75, 2.7
    WIRE = "#d9d9d9"
    POST = "#a8703b"

    def mesh(plane, u0, u1, z1):
        n = int(abs(u1 - u0) / 0.09)
        for k in range(n + 1):
            u = u0 + (u1 - u0) * k / n
            plane.line(u, 0.02, u, z1, WIRE, 1.4, opacity=0.8)
        for z in (0.12, 0.24, 0.36):
            plane.line(u0, z, u1, z, WIRE, 1.4, opacity=0.8)
    # straw floor
    c.poly(c.PP([(rx0, ry0, 0.03), (rx1, ry0, 0.03), (rx1, ry1, 0.03), (rx0, ry1, 0.03)]), "#f1d77e", "#c9a54a", 2)
    rnd = random.Random(8)
    for _ in range(40):
        x, y = rnd.uniform(rx0 + 0.05, rx1 - 0.05), rnd.uniform(ry0 + 0.05, ry1 - 0.05)
        p = c.P(x, y, 0.03)
        a = rnd.uniform(0, math.pi)
        c.line((p[0] - 6 * math.cos(a), p[1] - 3 * math.sin(a)), (p[0] + 6 * math.cos(a), p[1] + 3 * math.sin(a)), "#d1aa45", 2)
    # back mesh (plane y=ry0)
    mesh(Plane(c, "y", ry0), rx0, rx1, 0.42)
    for (px, py) in ((rx0, ry0), (rx1, ry0)):
        c.box(px - 0.03, py - 0.03, 0, px + 0.03, py + 0.03, 0.46, shade(POST, 0.2), POST, shade(POST, -0.15), sw=2)
    # house
    x0, y0, x1, y1, zw, zr = 0.3, 0.45, 1.65, 2.55, 0.7, 1.25
    WOOD = "#e9b46a"
    c.box(x0, y0, 0, x1, y1, 0.12, "#8a5a32", "#9c6638", "#80532e")      # stilts base
    c.box(x0, y0, 0.12, x1, y1, zw, shade(WOOD, 0.1), WOOD, shade(WOOD, -0.1))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    L.planks(x0, x1, 0.12, zw, 0.1, "#7a4a22", 0.45)
    R.planks(y0, y1, 0.12, zw, 0.1, "#7a4a22", 0.45)
    # round window on the gable side
    cx, cy = L.P((x0 + x1) / 2, 0.42)
    c.ell(cx, cy, 20, 21, TRIM, 0, OUT, 2.5)
    c.ell(cx, cy, 14, 15, c.lin([(0, "#bfe4f5"), (1, "#6fa9cf")]), 0, OUT, 2)
    # door + ramp on run side
    R.door(1.5, 0.36, 0.42, "#c0563b", frame=TRIM)
    for k in range(5):
        t = k / 4
        a = c.P(x1 + 0.02 + 0.5 * t, 1.5 - 0.17, 0.12 * (1 - t) + 0.01)
        b = c.P(x1 + 0.02 + 0.5 * t, 1.5 + 0.17, 0.12 * (1 - t) + 0.01)
    c.poly(c.PP([(x1, 1.33, 0.12), (x1, 1.67, 0.12), (x1 + 0.55, 1.67, 0.0), (x1 + 0.55, 1.33, 0.0)]), "#b47a43", OUT, 2)
    for k in range(1, 5):
        t = k / 5
        c.line(c.P(x1 + 0.55 * t, 1.33, 0.12 * (1 - t)), c.P(x1 + 0.55 * t, 1.67, 0.12 * (1 - t)), "#7a4a22", 2.5)
    # nesting box on the left wall
    c.box(0.55, y1, 0.3, 1.4, y1 + 0.22, 0.52, "#c0563b", shade("#e9b46a", -0.05), shade("#e9b46a", -0.2))
    c.poly(c.PP([(0.55, y1, 0.52), (1.4, y1, 0.52), (1.4, y1 + 0.26, 0.47), (0.55, y1 + 0.26, 0.47)]), "#c0563b", OUT, 2)
    for k, u in enumerate((0.75, 1.0, 1.25)):
        p = c.P(u, y1 + 0.22, 0.38)
        c.ell(p[0], p[1], 9, 7, "#5a3a20", 0, OUT, 1.5)
    edge_trim(c, x0, y0, x1, y1, 0.12, zw, TRIM, 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, "#d94d3a", along="y", oh=0.12, gable_color=WOOD, rows=5, cols=9)
    # front mesh (planes x=rx1 and y=ry1) + posts
    for (px, py) in ((rx1, ry1 - 1.2),):
        pass
    mesh(Plane(c, "x", rx1), ry0, ry1, 0.42)
    mesh(Plane(c, "y", ry1), rx0, rx1, 0.42)
    for (px, py) in ((rx1, ry1), (rx1, (ry0 + ry1) / 2), (rx0, ry1), (rx1, ry0)):
        c.box(px - 0.03, py - 0.03, 0, px + 0.03, py + 0.03, 0.46, shade(POST, 0.2), POST, shade(POST, -0.15), sw=2)
    for pl, u0, u1 in ((Plane(c, "x", rx1), ry0, ry1), (Plane(c, "y", ry1), rx0, rx1)):
        pl.line(u0, 0.44, u1, 0.44, POST, 6)
    # feeder + eggs basket
    sack(c, 0.35, 2.85, 0.8, "#e9d3a6")
    return c


# ================================================================== WINDMILL / FEED MILL 2x2
def mill_body():
    c = bcanvas(2, 2, top=560)
    pad(c, 2, 2, "#cfc6b4", pattern="stone")
    STONE = "#e6dccb"
    cx, ct, rx, ry = c.cylinder(1.0, 1.0, 0.025, 1.45, 0.62, STONE, r1=0.44)
    # stone courses
    rnd = random.Random(3)
    for k in range(1, 8):
        z = 0.025 + k * 0.18
        r = 0.62 + (0.44 - 0.62) * (z / 1.45)
        X, Y = c.P(1.0, 1.0, z)
        c.path(f"M{f2(X - K * r * 1.414)},{f2(Y)} A{f2(K * r * 1.414)},{f2(K * r * 0.707)} 0 0 0 {f2(X + K * r * 1.414)},{f2(Y)}",
               "none", shade(STONE, -0.22), 2)
        for j in range(5):
            th = rnd.uniform(0.15, 2.95)
            zz = z - 0.09
            rr = 0.62 + (0.44 - 0.62) * (zz / 1.45)
            px = X + K * rr * 1.414 * math.cos(th)
            py = c.P(1.0, 1.0, zz)[1] + K * rr * 0.707 * math.sin(th)
            c.line((px, py - 12), (px, py + 10), shade(STONE, -0.2), 2)
    # door & window facing the viewer
    base = c.P(1.0, 1.0, 0.025)
    dx, dy = base[0], base[1] + K * 0.62 * 0.707
    c.path(f"M{f2(dx - 22)},{f2(dy - 2)} v-58 a22,22 0 0 1 44,0 v58 Z", c.lin([(0, "#a0613a"), (1, "#7a4426")]), OUT, 3)
    c.line((dx, dy - 4), (dx, dy - 78), "#5e3520", 2)
    wy = c.P(1.0, 1.0, 0.95)[1] + K * 0.5 * 0.707
    c.path(f"M{f2(dx - 13)},{f2(wy)} v-26 a13,13 0 0 1 26,0 v26 Z", c.lin([(0, "#bfe4f5"), (1, "#6fa9cf")]), OUT, 2.5)
    c.line((dx, wy), (dx, wy - 38), TRIM, 3)
    # cap
    c.cylinder(1.0, 1.0, 1.43, 1.5, 0.5, "#8b5a34", top="#a26b3f", shadow=False)
    c.cone(1.0, 1.0, 1.5, 2.05, 0.5, "#d9573f")
    tip = c.P(1.0, 1.0, 2.05)
    c.circle(tip[0], tip[1], 5, "#f2c14e", OUT, 2)
    # sacks
    sack(c, 1.75, 1.55, 0.9, label="#f2c14e")
    sack(c, 1.55, 1.85, 0.85)
    sack(c, 0.3, 1.75, 0.8, label="#7cc952")
    return c


def sails(c, angle):
    """Sails on the plane facing the viewer; hub at the front of the cap."""
    hub = c.P(1.0, 1.0, 1.55)
    hx, hy = hub[0], hub[1] + K * 0.5 * 0.707 + 4
    L = 205
    for k in range(4):
        a = math.radians(angle + k * 90)
        ca, sa = math.cos(a), math.sin(a)
        sx = 1.08   # plane facing (1,1): mild horizontal stretch

        def P(u, v):  # u along blade, v across
            return (hx + (u * ca - v * sa) * sx, hy + (u * sa + v * ca))
        c.limb(P(0, 0), P(L, 0), "#7a4a2a", 7)
        frame = [P(40, 4), P(L, 4), P(L, 34), P(40, 34)]
        c.poly(frame, "#f7efe0", OUT, 2.5, extra='fill-opacity="0.92"')
        for t in range(1, 6):
            u = 40 + (L - 40) * t / 6
            c.line(P(u, 4), P(u, 34), "#9b6a3c", 2)
        c.line(P(40, 19), P(L, 19), "#9b6a3c", 2)
    c.circle(hx, hy, 11, "#5a3a22", OUT, 2.5)
    c.circle(hx - 3, hy - 3, 3.5, "#9b6a3c", None)


def mill_sails_frames(n=8):
    out = []
    for f in range(n):
        c = bcanvas(2, 2, top=560)
        sails(c, 20 + f * 90 / n)
        out.append(c)
    return out


# ================================================================== DAIRY 3x2
def dairy():
    c = bcanvas(3, 2, top=380)
    pad(c, 3, 2, "#cfc6b4", pattern="stone")
    # milk tank behind
    c.cylinder(0.45, 0.4, 0.025, 1.1, 0.24, "#cdd7de", top="#e9eff3")
    c.cone(0.45, 0.4, 1.1, 1.25, 0.24, "#aab7c0")
    x0, y0, x1, y1, zw, zr = 0.3, 0.3, 2.55, 1.6, 0.78, 1.3
    WALL = "#fbf7ee"
    BLUE = "#4f8fd1"
    c.box(x0, y0, 0, x1, y1, zw, WALL, WALL, shade(WALL, -0.1))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    L.rect(x0, x1, 0, 0.16, "#9aa3ad", sw=2)                  # stone plinth
    R.rect(y0, y1, 0, 0.16, shade("#9aa3ad", -0.1), sw=2)
    L.door(1.05, 0.38, 0.6, BLUE, frame=TRIM)
    L.window(1.75, 0.34, 0.34, 0.3, shutters=BLUE, flower="#ff7aa8")
    L.window(0.55, 0.34, 0.22, 0.3, frame=TRIM)
    R.window((y0 + y1) / 2, 0.32, 0.3, 0.28, shutters=BLUE)
    edge_trim(c, x0, y0, x1, y1, 0, zw, "#d9e3ec", 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, BLUE, along="x", oh=0.12, gable_color=WALL, rows=5, cols=14)
    # gable badge: milk drop
    ym = (y0 + y1) / 2
    bx, by = R.P(ym, zw + 0.22)
    c.circle(bx, by, 24, TRIM, OUT, 3)
    c.path(f"M{f2(bx)},{f2(by - 15)} C{f2(bx + 13)},{f2(by + 2)} {f2(bx + 11)},{f2(by + 14)} {f2(bx)},{f2(by + 14)} "
           f"C{f2(bx - 11)},{f2(by + 14)} {f2(bx - 13)},{f2(by + 2)} {f2(bx)},{f2(by - 15)} Z", "#7fb6e6", OUT, 2)
    hanging_sign(c, L, 1.4, 0.68, IC.cheese, size=0.2)
    milk_can(c, 2.7, 1.25)
    milk_can(c, 2.85, 1.55, 0.9)
    milk_can(c, 0.55, 1.8, 0.95)
    return c


# ================================================================== BAKERY 3x2
def bakery():
    c = bcanvas(3, 2, top=420)
    pad(c, 3, 2, "#cfc6b4", pattern="stone")
    x0, y0, x1, y1, zw, zr = 0.3, 0.3, 2.6, 1.55, 0.8, 1.35
    WALL = "#f6e3c2"
    BRICK = "#c8664a"
    ROOF = "#e98a3a"
    c.box(x0, y0, 0, x1, y1, zw, WALL, WALL, shade(WALL, -0.1))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        pl.rect(u0, u1, 0, 0.3, BRICK if pl is L else shade(BRICK, -0.12), sw=2)
        for k, z in enumerate((0.075, 0.15, 0.225)):
            pl.line(u0, z, u1, z, shade(BRICK, -0.35), 1.6, opacity=0.8)
            uu = u0 + (0.06 if k % 2 else 0.12)
            while uu < u1:
                pl.line(uu, z - 0.075, uu, z, shade(BRICK, -0.35), 1.4, opacity=0.8)
                uu += 0.12
    L.door(0.75, 0.38, 0.62, "#8a4f2c", frame="#6b3a1e")
    L.window(1.75, 0.36, 0.62, 0.3, frame="#8a4f2c")
    R.window((y0 + y1) / 2, 0.38, 0.32, 0.28, frame="#8a4f2c", flower="#ffd34d")
    edge_trim(c, x0, y0, x1, y1, 0, zw, "#8a4f2c", 6)
    awning(c, L, 1.35, 2.15, 0.76, 0.2, 0.12, ("#e8483d", "#fff6e6"))
    c.gable_roof(x0, y0, x1, y1, zw, zr, ROOF, along="x", oh=0.12, gable_color=WALL, rows=5, cols=14)
    chimney(c, 0.75, 0.62, 0.9, 1.55)
    hanging_sign(c, R, 1.0, 0.7, IC.bread, size=0.2)
    # bread table out front
    c.box(1.9, 1.7, 0, 2.45, 1.92, 0.2, "#d29a5a", "#b57a3e", "#9a6533")
    for k, u in enumerate((2.0, 2.18, 2.36)):
        p = c.P(u, 1.81, 0.2)
        c.ell(p[0], p[1] - 4, 13, 8, c.lin([(0, "#f0b25a"), (1, "#b8692a")]), -20, OUT, 2)
        c.line((p[0] - 5, p[1] - 8), (p[0] - 1, p[1] - 2), "#f7d28d", 2)
        c.line((p[0] + 1, p[1] - 9), (p[0] + 5, p[1] - 3), "#f7d28d", 2)
    sack(c, 2.8, 0.55, 0.85, "#efe2c8", label="#f2c14e")
    return c


# ================================================================== WEAVING HUT 2x2
def weaving_hut():
    c = bcanvas(2, 2, top=380)
    pad(c, 2, 2, "#e3c88f", pattern="dirt")
    x0, y0, x1, y1, zw, zr = 0.28, 0.3, 1.6, 1.55, 0.72, 1.3
    WALL = "#c99d6c"
    ROOF = "#8a62c8"
    c.box(x0, y0, 0, x1, y1, zw, shade(WALL, 0.1), WALL, shade(WALL, -0.12))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    # timber frame
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        pl.planks(u0, u1, 0, zw, 0.12, "#6b4426", 0.4)
    R.door((y0 + y1) / 2 + 0.15, 0.36, 0.58, "#6b4aa0", frame="#f1e2c6")
    cx, cy = L.P((x0 + x1) / 2, 0.42)
    c.ell(cx, cy, 24, 26, "#f1e2c6", 0, OUT, 2.5)
    c.ell(cx, cy, 17, 19, c.lin([(0, "#bfe4f5"), (1, "#6fa9cf")]), 0, OUT, 2)
    c.line((cx - 17, cy), (cx + 17, cy), "#f1e2c6", 3)
    c.line((cx, cy - 19), (cx, cy + 19), "#f1e2c6", 3)
    edge_trim(c, x0, y0, x1, y1, 0, zw, "#6b4426", 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, ROOF, along="y", oh=0.12, gable_color=shade(WALL, 0.15), rows=5, cols=9)
    hanging_sign(c, R, 0.62, 0.66, IC.cloth, board="#f1e2c6", size=0.19)
    # yarn basket + wool bale
    bx, by = 1.82, 1.25
    c.cylinder(bx, by, 0, 0.12, 0.13, "#b98a4f", top="#7a5530")
    for (dx, dy, col) in ((-0.04, -0.03, "#e85d75"), (0.05, -0.02, "#4fa3e0"), (0.0, 0.05, "#f2c14e")):
        p = c.P(bx + dx, by + dy, 0.14)
        c.circle(p[0], p[1] - 5, 11, col, OUT, 2)
        c.path(f"M{f2(p[0] - 8)},{f2(p[1] - 7)} q8,-6 16,2", "none", shade(col, -0.3), 1.6)
        c.path(f"M{f2(p[0] - 7)},{f2(p[1] - 1)} q8,-6 15,2", "none", shade(col, -0.3), 1.6)
    hay(c, 0.4, 1.8, s=0.8)
    return c


# ================================================================== MARKET STALL 2x1
def market_stall():
    c = bcanvas(2, 1, top=330)
    pad(c, 2, 1, "#cfc6b4", pattern="stone", inset=0.04)
    x0, y0, x1, y1 = 0.12, 0.16, 1.88, 0.84
    WOOD = "#c58a50"
    # back posts
    for (px, py) in ((x0, y0), (x1, y0)):
        c.box(px - 0.035, py - 0.035, 0, px + 0.035, py + 0.035, 0.9, shade(WOOD, 0.2), WOOD, shade(WOOD, -0.2), sw=2)
    # back shelf
    c.box(x0 + 0.05, y0, 0.32, x1 - 0.05, y0 + 0.16, 0.36, shade(WOOD, 0.2), WOOD, shade(WOOD, -0.2), sw=2)
    for k, col in enumerate(("#ff8a2a", "#f2c14e", "#e8483d", "#8fd35a")):
        u = x0 + 0.25 + k * 0.4
        crate(c, u, y0 + 0.08, 0.36, 0.55, fill=col)
    # counter
    c.box(x0, y0 + 0.28, 0, x1, y1, 0.36, "#e0ad73", WOOD, shade(WOOD, -0.15))
    L = Plane(c, "y", y1)
    for k in range(1, 9):
        u = x0 + (x1 - x0) * k / 9
        L.line(u, 0.02, u, 0.34, shade(WOOD, -0.3), 2, opacity=0.6)
    L.rect(x0, x1, 0.3, 0.36, shade(WOOD, -0.1), sw=2)
    # goods on counter
    goods = [("#ff8a2a", 0.35), ("#f2c14e", 0.75), ("#e8483d", 1.15), ("#ffffff", 1.55)]
    for col, u in goods:
        crate(c, u, (y0 + 0.28 + y1) / 2, 0.36, 0.7, fill=col)
    # front posts
    for (px, py) in ((x0, y1), (x1, y1)):
        c.box(px - 0.035, py - 0.035, 0, px + 0.035, py + 0.035, 0.85, shade(WOOD, 0.2), WOOD, shade(WOOD, -0.2), sw=2)
    # awning: slopes from back (higher) to front
    n = 9
    for k in range(n):
        a, b = x0 - 0.06 + (x1 - x0 + 0.12) * k / n, x0 - 0.06 + (x1 - x0 + 0.12) * (k + 1) / n
        col = ("#e8483d", "#fff3dc")[k % 2]
        q = c.PP([(a, y0 - 0.06, 0.98), (b, y0 - 0.06, 0.98), (b, y1 + 0.12, 0.82), (a, y1 + 0.12, 0.82)])
        c.poly(q, c.lin([(0, shade(col, 0.15)), (1, shade(col, -0.08))]), OUT, 2)
        p, qq = c.P(a, y1 + 0.12, 0.82), c.P(b, y1 + 0.12, 0.82)
        mx, my = (p[0] + qq[0]) / 2, (p[1] + qq[1]) / 2
        c.path(f"M{f2(p[0])},{f2(p[1])} Q{f2(mx)},{f2(my + 16)} {f2(qq[0])},{f2(qq[1])} Z", col, OUT, 2)
    c.shadow_pts([(x0 - 0.06, y0 - 0.06, 0.98), (x1 + 0.06, y0 - 0.06, 0.98), (x1 + 0.06, y1 + 0.12, 0.82), (x0 - 0.06, y1 + 0.12, 0.82)])
    # coin sign on top
    hub = c.P((x0 + x1) / 2, y0 - 0.02, 0.98)
    c.line(hub, (hub[0], hub[1] - 18), OUT, 3)
    c.group(lambda: IC.coins(c), transform=f"translate({f2(hub[0] - 26)},{f2(hub[1] - 66)}) scale(0.42)")
    return c


# ================================================================== FOR SALE sign 1x1
def for_sale():
    c = bcanvas(1, 1, top=280)
    WOOD = "#b57a43"
    y = 0.55
    for x in (0.24, 0.76):
        c.box(x - 0.035, y - 0.035, 0, x + 0.035, y + 0.035, 0.86, shade(WOOD, 0.2), WOOD, shade(WOOD, -0.2), sw=2)
    pl = Plane(c, "y", y + 0.04)
    pl.rect(0.1, 0.9, 0.4, 0.82, c.lin([(0, "#fffaf0"), (1, "#efe2c8")]), sw=3)
    pl.rect(0.14, 0.86, 0.44, 0.78, "none", stroke="#d9483b", sw=3)
    for txt, z, size in (("FOR", 0.63, 22), ("SALE", 0.48, 27)):
        ex, ey = pl.P(0.5, z)
        c.text(0, 0, txt, size, "#d9483b", transform=f"matrix(1,0.5,0,1,{f2(ex)},{f2(ey)})")
    c.shadow_pts([(0.1, y, 0.4), (0.9, y, 0.4), (0.1, y, 0.82), (0.9, y, 0.82), (0.2, y, 0), (0.8, y, 0)])
    p = pl.P(0.9, 0.4, 0.0)
    c.line(p, (p[0], p[1] + 14), OUT, 2)
    c.circle(p[0], p[1] + 25, 12, "#f6c945", OUT, 2.5)
    c.text(p[0], p[1] + 31, "$", 15, "#b07d12")
    rnd = random.Random(1)
    for x in (0.24, 0.76):
        for k in range(3):
            q = c.P(x + rnd.uniform(-0.06, 0.06), y + rnd.uniform(-0.02, 0.08))
            c.path(f"M{f2(q[0])},{f2(q[1])} q-2,-10 -6,-14 M{f2(q[0])},{f2(q[1])} q3,-10 8,-12", "none", "#5fae3e", 3)
    return c


def build():
    image("buildings", "barn", barn(), (4, 4), notes="pasture shelter / barn, 4x4")
    image("buildings", "chicken_coop", coop(), (3, 3), notes="chicken coop with run, 3x3")
    image("buildings", "feed_mill", mill_body(), (2, 2), notes="windmill / feed mill body without sails, 2x2 – layer feed_mill_sails on top")
    fr = mill_sails_frames(8)
    sheet("buildings", "feed_mill_sails", [fr], fr[0].w, fr[0].h, (fr[0].ox, fr[0].oy),
          [dict(anim="spin", dir="-", frames=8, mirror=False, fps=10)],
          notes="looping sails; same canvas + anchor as feed_mill, draw directly above it")
    c = mill_body()
    sails(c, 20)
    image("buildings", "feed_mill_static", c, (2, 2), notes="feed mill with sails baked in (single image)")
    image("buildings", "dairy", dairy(), (3, 2), notes="dairy, 3x2 (3 tiles along x, 2 along y)")
    image("buildings", "bakery", bakery(), (3, 2), notes="bakery, 3x2 (3 tiles along x, 2 along y)")
    image("buildings", "weaving_hut", weaving_hut(), (2, 2), notes="loom / weaving hut, 2x2")
    image("buildings", "market_stall", market_stall(), (2, 1), notes="market stall, 2x1 (2 tiles along x)")
    image("buildings", "for_sale_sign", for_sale(), (1, 1), notes="'for sale' sign for unowned plots, 1x1")
