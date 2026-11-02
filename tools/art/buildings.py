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


# ================================================================== FARMHOUSE 2x2
FARMHOUSE_BENCH = (0.3, 0.98, 1.6, 1.78, 0.14)   # x0, x1, y0, y1, seat height: where idle farmers sit


def farmhouse():
    c = bcanvas(2, 2, top=400)
    pad(c, 2, 2, "#d9c19a", pattern="dirt")
    x0, y0, x1, y1, zw, zr = 0.22, 0.2, 1.72, 1.55, 0.74, 1.32
    WALL = "#f4e6c8"
    ROOF = "#c4503a"
    WOODC = "#8a5a32"
    c.box(x0, y0, 0, x1, y1, zw, WALL, WALL, shade(WALL, -0.1))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        pl.rect(u0, u1, 0, 0.12, "#a39a8c" if pl is L else shade("#a39a8c", -0.12), sw=2)
    L.door(1.3, 0.3, 0.56, "#6f8f4a", frame=WOODC)
    L.window(0.62, 0.36, 0.3, 0.26, frame=WOODC, shutters="#6f8f4a", flower="#e85d75")
    R.window((y0 + y1) / 2, 0.36, 0.3, 0.26, frame=WOODC, shutters="#6f8f4a")
    edge_trim(c, x0, y0, x1, y1, 0, zw, WOODC, 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, ROOF, along="x", oh=0.12, gable_color=WALL, rows=5, cols=10)
    chimney(c, 0.6, 0.62, 0.95, 1.5, color="#9c8f80")
    # stone step at the door
    c.box(1.1, y1, 0, 1.5, y1 + 0.16, 0.04, "#cfc8bb", "#b3ab9c", "#a39a8c", sw=2, shadow=False)
    # the bench along the front wall
    bx0, bx1, by0, by1, bz = FARMHOUSE_BENCH
    for lx in (bx0 + 0.05, bx1 - 0.08):
        c.box(lx, by0 + 0.03, 0, lx + 0.04, by1 - 0.03, bz - 0.03, WOODC, shade(WOODC, 0.05), shade(WOODC, -0.15), sw=2, shadow=False)
    c.box(bx0, by0, bz - 0.03, bx1, by1, bz, "#c48a4f", shade("#c48a4f", -0.08), shade("#c48a4f", -0.2), sw=2)
    # a barrel and a watering can by the corner
    c.cylinder(1.86, 0.4, 0, 0.22, 0.09, WOODC, top="#5b3a1f")
    c.cylinder(0.1, 1.85, 0, 0.07, 0.05, "#8fb3c9", top="#6b8da3", sw=2)
    return c


# ================================================================== COTTAGE 2x2
# The chimney top of the cottage (grid point and height): the game puffs smoke from here on winter days.
COTTAGE_CHIMNEY = (0.62, 0.72, 1.32)


def cottage():
    """A small family home: whitewashed walls under a thatched roof, a chimney (smoke is drawn by the game), a
    vegetable patch and a washing line."""
    c = bcanvas(2, 2, top=380)
    pad(c, 2, 2, "#d9c9a0", pattern="dirt")
    x0, y0, x1, y1, zw, zr = 0.32, 0.3, 1.58, 1.42, 0.6, 1.12
    WALL = "#f6eedb"
    THATCH = "#d6a34a"
    TIMBER = "#7a5232"
    c.box(x0, y0, 0, x1, y1, zw, WALL, WALL, shade(WALL, -0.1))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        pl.rect(u0, u1, 0, 0.1, "#b5ab98" if pl is L else shade("#b5ab98", -0.12), sw=2)
        # half-timbering: a beam under the eaves and a brace or two
        pl.line(u0, zw - 0.04, u1, zw - 0.04, TIMBER, 5)
    L.line(x0 + 0.08, 0.12, x0 + 0.3, zw - 0.06, TIMBER, 4)
    R.line(y1 - 0.08, 0.12, y1 - 0.3, zw - 0.06, TIMBER, 4)
    L.door(1.15, 0.26, 0.46, "#4f7fb0", frame=TIMBER)
    L.window(0.62, 0.28, 0.24, 0.2, frame=TIMBER, shutters="#4f7fb0", flower="#f2c14e")
    R.window((y0 + y1) / 2, 0.28, 0.24, 0.2, frame=TIMBER, shutters="#4f7fb0")
    edge_trim(c, x0, y0, x1, y1, 0, zw, TIMBER, 5)
    cx, cy, ct = COTTAGE_CHIMNEY
    c.box(cx - 0.08, cy - 0.08, 0.7, cx + 0.08, cy + 0.08, ct - 0.04, shade("#a7988a", 0.15), "#a7988a", shade("#a7988a", -0.15))
    c.gable_roof(x0, y0, x1, y1, zw, zr, THATCH, along="x", oh=0.14, gable_color=WALL, rows=5, cols=9)
    c.box(cx - 0.1, cy - 0.1, ct - 0.04, cx + 0.1, cy + 0.1, ct, "#6b6b6b", "#8a8a8a", "#707070", shadow=False)
    # stone step at the door
    c.box(0.97, y1, 0, 1.33, y1 + 0.14, 0.04, "#cfc8bb", "#b3ab9c", "#a39a8c", sw=2, shadow=False)
    # a little vegetable patch by the right wall, and a water butt
    for k in range(3):
        y = 0.45 + k * 0.32
        c.poly(c.PP([(1.68, y, 0.02), (1.92, y, 0.02), (1.92, y + 0.22, 0.02), (1.68, y + 0.22, 0.02)]), "#8a5a32", OUT, 1.5)
        for j in range(2):
            p = c.P(1.74 + j * 0.12, y + 0.11, 0.05)
            c.circle(p[0], p[1], 5, "#5cb83c", OUT, 1.2)
    c.cylinder(0.18, 1.62, 0, 0.2, 0.08, TIMBER, top="#4d3420", sw=2)
    return c


# ================================================================== GRANARY 2x2 (levels 1-3)
def silo(c, x, y, r, z1, color="#e9dcc0", roof="#c4503a"):
    """A round grain silo with hoops and a conical cap."""
    cx, ct, rx, ry = c.cylinder(x, y, 0.025, z1, r, color, top=shade(color, 0.12))
    for k in range(1, int(z1 / 0.22) + 1):
        _, zy = c.P(x, y, k * 0.22)
        c.path(f"M{f2(cx - rx)},{f2(zy)} A{f2(rx)},{f2(ry)} 0 0 0 {f2(cx + rx)},{f2(zy)}", "none", shade(color, -0.3), 2.2)
    c.cone(x, y, z1, z1 + r * 0.9, r * 1.08, roof)
    tip = c.P(x, y, z1 + r * 0.9)
    c.circle(tip[0], tip[1], 4.5, "#f2c14e", OUT, 2)


def granary(level):
    """A raised wooden granary on staddle stones; level 2 adds a silo, level 3 a second, taller one and a gilded vane.
    What it holds shows as stock piles in the yard in front (piles.py), drawn by the game."""
    c = bcanvas(2, 2, top=470)
    pad(c, 2, 2, "#e3c88f", pattern="dirt")
    if level >= 2:
        silo(c, 1.62, 0.42, 0.26, 1.05 + (0.25 if level >= 3 else 0.0))
    x0, y0, x1, y1, zs, zw, zr = 0.22, 0.5, 1.32, 1.68, 0.14, 0.78, 1.32
    WOOD = "#d9a25a"
    STONE = "#b8b1a4"
    # staddle stones: a mushroom stone under each corner keeps the grain dry
    for (sx, sy) in ((x0 + 0.08, y1 - 0.08), (x1 - 0.08, y1 - 0.08), (x1 - 0.08, y0 + 0.08), ((x0 + x1) / 2, y1 - 0.08)):
        c.cylinder(sx, sy, 0, zs - 0.03, 0.05, STONE, r1=0.035, sw=2, shadow=False)
        c.cylinder(sx, sy, zs - 0.03, zs, 0.08, shade(STONE, 0.1), sw=2, shadow=False)
    c.box(x0, y0, zs, x1, y1, zw, shade(WOOD, 0.12), WOOD, shade(WOOD, -0.12))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    L.planks(x0, x1, zs, zw, 0.09, "#7a4a22", 0.45)
    R.planks(y0, y1, zs, zw, 0.09, "#7a4a22", 0.45)
    R.door((y0 + y1) / 2, 0.42, 0.5, "#a8642f", frame=TRIM, xbrace="#7a4a22")
    # wooden steps up to the door
    for k in range(3):
        u = (y0 + y1) / 2
        z = zs * (2 - k) / 3
        c.box(x1 + 0.04 + k * 0.08, u - 0.18, 0, x1 + 0.12 + k * 0.08, u + 0.18, z + 0.04, "#c48a4f", "#b07a43", "#9a6533", sw=2, shadow=False)
    edge_trim(c, x0, y0, x1, y1, zs, zw, TRIM, 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, "#e0b13e" if level >= 3 else "#b5653a", along="x", oh=0.12, gable_color=shade(WOOD, 0.1),
                 rows=5, cols=8)
    hanging_sign(c, L, 0.75, 0.66, IC.wheat_icon, size=0.2)
    if level >= 3:
        silo(c, 1.78, 0.84, 0.2, 0.95)
        ym = (y0 + y1) / 2
        rp = c.P(x0 + 0.5, ym, zr + 0.02)
        c.line(rp, (rp[0], rp[1] - 36), OUT, 3)
        c.path(f"M{f2(rp[0] - 14)},{f2(rp[1] - 32)} l14,-9 l16,5 l-7,6 Z", "#f2c14e", OUT, 1.5)
    # the yard in front stays clear: the game stands the stock piles there (piles.py)
    return c


# ================================================================== STOREHOUSE 2x2 (levels 1-3)
def log_pile(c, x0, y, x1, z_rows=2, r=0.075):
    """Logs stacked along x in front of plane y, cut ends toward the lower-right."""
    for row in range(z_rows):
        n = int((x1 - x0) / (2 * r)) - row
        for k in range(n):
            x = x0 + r + row * r + k * 2 * r
            z = r + row * 1.7 * r
            back, front = c.P(x, y - 0.32, z), c.P(x, y, z)
            rx, ry = K * r * 0.85, K * r * 1.05
            c.path(f"M{f2(back[0])},{f2(back[1] - ry)} L{f2(front[0])},{f2(front[1] - ry)} L{f2(front[0])},{f2(front[1] + ry)} "
                   f"L{f2(back[0])},{f2(back[1] + ry)} Z", c.lin([(0, "#b0743e"), (1, "#7a4a24")], 0, 0, 0, 1), OUT, 2)
            c.ell(front[0], front[1], rx, ry, c.rad([(0, "#f3d29a"), (0.7, "#e2b36f"), (1, "#b98446")]), 0, OUT, 2)
            c.ell(front[0], front[1], rx * 0.45, ry * 0.45, "none", 0, "#b98446", 1.5)
    c.shadow_pts([(x0, y - 0.32, 0), (x1, y - 0.32, 0), (x0, y, 0), (x1, y, 0), (x0, y, r * 2 * z_rows), (x1, y - 0.32, r * 2 * z_rows)])


def stone_blocks(c, x, y, n=3):
    rnd = random.Random(int(x * 31 + y * 7))
    G = "#a7adb3"
    spots = [(0, 0, 0), (0.2, 0, 0), (0.1, 0.0, 0.12), (0.0, 0.18, 0), (0.2, 0.18, 0)][:n]
    for (dx, dy, dz) in sorted(spots, key=lambda s: (s[2], s[0] + s[1])):
        g = shade(G, rnd.uniform(-0.08, 0.08))
        c.box(x + dx, y + dy, dz, x + dx + 0.18, y + dy + 0.16, dz + 0.12, shade(g, 0.15), g, shade(g, -0.15), sw=2)


def storehouse(level):
    """A stone-and-timber store for building materials; level 2 adds a lean-to, level 3 a hoist on the gable.
    What it holds shows as stock piles in the yard in front (piles.py), drawn by the game."""
    c = bcanvas(2, 2, top=420)
    pad(c, 2, 2, "#cfc6b4", pattern="stone")
    x0, y0, x1, y1, zb, zw, zr = 0.25, 0.3, 1.45, 1.35, 0.3, 0.8, 1.3
    STONE = "#b9b2a6"
    TIMBER = "#c8925a"
    c.box(x0, y0, 0, x1, y1, zb, shade(STONE, 0.1), STONE, shade(STONE, -0.12))
    c.box(x0, y0, zb, x1, y1, zw, shade(TIMBER, 0.1), TIMBER, shade(TIMBER, -0.12))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    rnd = random.Random(5)
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        for z in (0.1, 0.2):
            pl.line(u0, z, u1, z, shade(STONE, -0.3), 1.6, opacity=0.7)
        u = u0 + 0.05
        while u < u1 - 0.05:
            for zz in (0.0, 0.1, 0.2):
                uu = u + rnd.uniform(0, 0.06)
                pl.line(uu, zz + 0.01, uu, zz + 0.09, shade(STONE, -0.3), 1.4, opacity=0.7)
            u += 0.16
        pl.planks(u0, u1, zb, zw, 0.1, "#6b4426", 0.4)
    R.door((y0 + y1) / 2, 0.6, 0.62, "#8a5a32", frame="#6b4426", double=True, xbrace="#5a3a20")
    L.window((x0 + x1) / 2 - 0.15, 0.46, 0.26, 0.2, frame="#6b4426")
    edge_trim(c, x0, y0, x1, y1, 0, zw, "#6b4426", 6)
    c.gable_roof(x0, y0, x1, y1, zw, zr, "#6f7d8c", along="x", oh=0.12, gable_color=TIMBER, rows=5, cols=9)
    hanging_sign(c, L, 0.45, 0.7, IC.wood, size=0.18)
    if level >= 3:
        # hoist beam out of the gable with a rope and hook
        ym = (y0 + y1) / 2
        a, b = c.P(x1, ym, zw + 0.3), c.P(x1 + 0.3, ym, zw + 0.3)
        c.limb(a, b, "#5a3a20", 7)
        c.line(b, (b[0], b[1] + 60), "#d8c7a0", 2.5)
        c.path(f"M{f2(b[0])},{f2(b[1] + 60)} q8,2 6,10 q-3,5 -8,1", "none", "#5a5a5a", 3)
    if level >= 2:
        # lean-to on the right with logs and stone under it
        lx0, ly0, lx1, ly1 = x1 + 0.08, y0 + 0.05, 1.92, y1 - 0.05
        for (px, py) in ((lx1, ly0), (lx1, ly1)):
            c.box(px - 0.03, py - 0.03, 0, px + 0.03, py + 0.03, 0.55, "#c48a4f", "#a8703b", "#8f5f35", sw=2)
        q = c.PP([(lx0 - 0.02, ly0 - 0.06, 0.66), (lx0 - 0.02, ly1 + 0.06, 0.66), (lx1 + 0.08, ly1 + 0.06, 0.55), (lx1 + 0.08, ly0 - 0.06, 0.55)])
        c.poly(q, c.lin([(0, "#8795a4"), (1, "#5f6b78")], 0, 0, 1, 0), OUT, 2.5)
        c.shadow_pts([(lx0, ly0, 0.66), (lx0, ly1, 0.66), (lx1, ly1, 0.55), (lx1, ly0, 0.55)])
    # the yard in front stays clear: the game stands the stock piles there (piles.py)
    return c


# ================================================================== RESOURCE BUILDINGS 2x2
def pine(c, x, y, s=1.0, col="#2f8f4e"):
    """A small pine tree standing at (x, y)."""
    c.cylinder(x, y, 0, 0.25 * s, 0.045 * s, "#7a4a2a")
    for k, (z0, z1, r) in enumerate(((0.18, 0.7, 0.26), (0.45, 0.95, 0.2), (0.7, 1.2, 0.14))):
        c.cone(x, y, z0 * s, z1 * s, r * s, shade(col, 0.06 * k), shadow=k == 0)


def stump(c, x, y, r=0.1, h=0.12):
    """A sawn tree stump with its rings."""
    cx, ct, rx, ry = c.cylinder(x, y, 0, h, r, "#9a6233", top="#e9c48a")
    c.ell(cx, ct, rx * 0.6, ry * 0.6, "none", 0, "#c4935a", 1.5)
    c.ell(cx, ct, rx * 0.25, ry * 0.25, "none", 0, "#c4935a", 1.5)
    return cx, ct


def axe(c, base, top):
    """An axe whose head is buried at `base` (screen px), handle up to `top`."""
    c.limb(base, top, "#b07a43", 6)
    bx, by = base
    c.path(f"M{f2(bx - 4)},{f2(by + 2)} l-14,-10 l4,-12 l16,10 Z", "#c9d1d8", OUT, 2)


def pickaxe(c, base, top):
    """A pickaxe leaning from `base` (handle end on the ground) to `top` (the head)."""
    c.limb(base, top, "#b07a43", 6)
    tx, ty = top
    c.path(f"M{f2(tx - 22)},{f2(ty + 8)} Q{f2(tx)},{f2(ty - 12)} {f2(tx + 22)},{f2(ty + 8)} Q{f2(tx)},{f2(ty - 4)} {f2(tx - 22)},{f2(ty + 8)} Z",
           "#a9b4bf", OUT, 2)


def woodcutter():
    """A log cabin with a chopping block, a wood pile and pines behind."""
    c = bcanvas(2, 2, top=440)
    pad(c, 2, 2, "#e3c88f", pattern="dirt")
    pine(c, 0.32, 0.3, 1.15)
    pine(c, 1.7, 0.25, 0.95, col="#378f45")
    x0, y0, x1, y1, zw, zr = 0.45, 0.4, 1.45, 1.3, 0.62, 1.08
    LOG = "#a8693a"
    c.box(x0, y0, 0, x1, y1, zw, shade(LOG, 0.1), LOG, shade(LOG, -0.12))
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    # round logs: a dark seam and a light top edge every course, log ends at the corners
    z = 0.0
    while z < zw - 0.02:
        for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
            pl.line(u0, z + 0.09, u1, z + 0.09, shade(LOG, -0.4), 2.2, opacity=0.8)
            pl.line(u0, z + 0.075, u1, z + 0.075, shade(LOG, 0.3), 1.6, opacity=0.6)
        for (x, y) in ((x0, y1), (x1, y1), (x1, y0)):
            p = c.P(x, y, z + 0.045)
            c.circle(p[0], p[1], 7, "#e2b36f", OUT, 1.8)
        z += 0.09
    R.door((y0 + y1) / 2, 0.32, 0.5, "#7a4a24", frame="#5a3a20")
    L.window((x0 + x1) / 2, 0.3, 0.24, 0.2, frame="#5a3a20")
    c.gable_roof(x0, y0, x1, y1, zw, zr, "#5d7f3a", along="x", oh=0.12, gable_color=shade(LOG, 0.12), rows=4, cols=8)
    chimney(c, 0.75, 0.6, 0.75, 1.25, color="#9c8f80")
    hanging_sign(c, L, 0.62, 0.55, IC.wood, size=0.17)
    # wood pile against the right wall, chopping block with an axe and a split log in front
    log_pile(c, 1.55, 1.15, 1.95, z_rows=3)
    cx, ct = stump(c, 1.25, 1.72, r=0.12, h=0.14)
    axe(c, (cx + 4, ct - 2), (cx + 30, ct - 46))
    c.box(0.55, 1.6, 0, 0.85, 1.7, 0.08, "#e9c48a", "#b98446", "#9a6533", sw=2)
    c.box(0.6, 1.75, 0, 0.9, 1.85, 0.08, "#e9c48a", "#b98446", "#9a6533", sw=2)
    stump(c, 0.25, 1.65, r=0.08, h=0.06)
    return c


def rock_face(c, x0, y0, x1, y1, z1, rnd, col="#a9a59b"):
    """A cut rock block: a box with cracks on its faces."""
    c.box(x0, y0, 0, x1, y1, z1, shade(col, 0.14), col, shade(col, -0.14), sw=2.5)
    L, R = Plane(c, "y", y1), Plane(c, "x", x1)
    for pl, u0, u1 in ((L, x0, x1), (R, y0, y1)):
        for _ in range(2):
            u = rnd.uniform(u0 + 0.05, u1 - 0.05)
            z = rnd.uniform(0.05, z1 - 0.05)
            pl.line(u, z, u + rnd.uniform(-0.06, 0.06), z - rnd.uniform(0.05, 0.12), shade(col, -0.35), 2)


def quarry():
    """A stepped grey rock face cut into blocks, with a wooden crane, cut stone and a pickaxe."""
    c = bcanvas(2, 2, top=420)
    pad(c, 2, 2, "#cfc6b4", pattern="dirt")
    rnd = random.Random(11)
    # the rock face: tall at the back, stepping down toward the front
    rock_face(c, 0.15, 0.1, 1.85, 0.55, 0.9, rnd)
    rock_face(c, 0.15, 0.55, 0.75, 1.15, 0.6, rnd, "#b3afa5")
    rock_face(c, 1.25, 0.55, 1.85, 0.95, 0.5, rnd, "#b3afa5")
    rock_face(c, 0.15, 1.15, 0.5, 1.45, 0.28, rnd, "#bdb9af")
    # moss on top
    for (x, y, z) in ((0.4, 0.3, 0.9), (1.5, 0.25, 0.9), (0.3, 0.8, 0.6)):
        p = c.P(x, y, z)
        c.ell(p[0], p[1], 18, 7, "#7cbf4a", 0, None, extra='opacity="0.85"')
    # wooden crane (a post and a jib with a rope) lifting a block
    c.box(1.48, 1.3, 0, 1.56, 1.38, 1.0, "#c48a4f", "#a8703b", "#8f5f35", sw=2)
    a, b = c.P(1.52, 1.34, 0.95), c.P(1.0, 1.0, 1.05)
    c.limb(a, b, "#a8703b", 7)
    c.line(b, (b[0], b[1] + 70), "#d8c7a0", 2.5)
    c.box(0.92, 0.94, 0.42, 1.08, 1.08, 0.52, "#d4d0c6", "#b3afa5", "#9b978d", sw=2)
    # cut stone ready to go, rubble, a pickaxe and a barrow
    stone_blocks(c, 0.9, 1.5, 5)
    for (x, y, r) in ((1.7, 1.2, 0.06), (1.78, 1.32, 0.045), (0.62, 1.4, 0.05)):
        c.ellipsoid((x, y, r * 0.5), (r, r * 0.85, r * 0.6), "#a7a49a", hi=0.35, lo=-0.3)
    pickaxe(c, c.P(0.55, 1.82, 0), c.P(0.5, 1.55, 0.35))
    return c


def mine():
    """A grassy hill with a timber-framed tunnel, rails and a cart of iron ore."""
    c = bcanvas(2, 2, top=400)
    pad(c, 2, 2, "#cfc6b4", pattern="dirt")
    # the hill: grassy, with grey rock showing through
    hx, hy, ha, hb = 0.85, 0.7, 0.8, 0.66
    c.shadow_ell(hx, hy, 0.75, z=0.7)
    # only the half above the ground: clip below the front of its ground ellipse
    ring = [c.P(hx + ha * math.cos(t), hy + hb * math.sin(t), 0) for t in np.linspace(0, 2 * math.pi, 48, endpoint=False)]
    clip = c.clip(f'<polygon points="{pts(hull(ring + [(x, y - 900) for x, y in ring]))}"/>')
    c.group(lambda: c.ellipsoid((hx, hy, 0.0), (ha, hb, 0.9), "#79b84e", hi=0.28, lo=-0.28), clip=clip)
    rnd = random.Random(7)
    for (x, y, z, r) in ((0.55, 0.35, 0.68, 0.16), (1.25, 0.45, 0.55, 0.14), (0.95, 0.3, 0.8, 0.12)):
        c.ellipsoid((x, y, z), (r, r * 0.8, r * 0.55), "#a7a49a", hi=0.35, lo=-0.3)
    for _ in range(8):
        x, y = rnd.uniform(0.3, 1.4), rnd.uniform(0.3, 1.1)
        p = c.P(x, y, 0.75)
        c.ell(p[0], p[1], 8, 4, "#5c9a3a", 0, None)
    # the tunnel mouth: a timber portal set into the hill's front, facing the lower-left
    u0, u1, h = 0.55, 1.05, 0.5
    c.box(u0 - 0.08, 1.05, 0, u1 + 0.08, 1.3, h + 0.08, "#c48a4f", "#a8703b", "#8f5f35", sw=2.5)
    L = Plane(c, "y", 1.3)
    L.rect(u0, u1, 0, h, "#2b2118", sw=2.5)
    L.line(u0, h, u1, h, "#5a3a20", 4)
    L.line(u0 - 0.04, 0, u0 - 0.04, h + 0.04, "#5a3a20", 3)
    L.line(u1 + 0.04, 0, u1 + 0.04, h + 0.04, "#5a3a20", 3)
    # lantern by the entrance
    p = L.P(u1 + 0.12, h - 0.05, 0.02)
    c.line((p[0], p[1] - 14), (p[0], p[1] - 4), OUT, 2)
    c.circle(p[0], p[1] + 2, 6, "#f2c14e", OUT, 2)
    # rails out of the tunnel
    for d in (0.66, 0.94):
        c.line(c.P(d, 1.3, 0.01), c.P(d, 1.95, 0.01), "#6b6f75", 3)
    for k in range(5):
        y = 1.36 + k * 0.13
        c.line(c.P(0.6, y, 0.005), c.P(1.0, y, 0.005), "#8f5f35", 5)
    # the cart, heaped with ore
    c.box(0.62, 1.6, 0.05, 0.98, 1.88, 0.26, "#8a8f96", "#6f747b", "#5b6066", sw=2.5)
    for (x, y) in ((0.68, 1.68), (0.8, 1.66), (0.9, 1.72), (0.74, 1.78), (0.86, 1.8)):
        c.ellipsoid((x, y, 0.28), (0.06, 0.05, 0.04), "#7a5a4a", hi=0.3, lo=-0.3)
        q = c.P(x, y, 0.3)
        c.circle(q[0] + 3, q[1] - 2, 2.5, "#c9d1d8", None)
    for x in (0.68, 0.92):
        q = c.P(x, 1.88, 0.05)
        c.circle(q[0], q[1], 7, "#3d3f44", OUT, 2)
    # ore heap and a crate of iron bars
    for (x, y, r) in ((1.45, 1.5, 0.12), (1.62, 1.38, 0.09), (1.55, 1.68, 0.08)):
        c.ellipsoid((x, y, r * 0.5), (r, r * 0.85, r * 0.6), "#7a5a4a", hi=0.3, lo=-0.3)
    crate(c, 1.6, 0.95, s=1.0, wood="#a8703b")
    hanging_sign(c, L, 0.4, 0.45, IC.iron, size=0.16)
    return c


def build():
    image("buildings", "barn", barn(), (4, 4), notes="pasture shelter / barn, 4x4")
    for lv in (1, 2, 3):
        image("buildings", f"granary_{lv}", granary(lv), (2, 2), notes=f"granary for goods, level {lv}, 2x2")
        image("buildings", f"storehouse_{lv}", storehouse(lv), (2, 2), notes=f"storehouse for building materials, level {lv}, 2x2")
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
    image("buildings", "woodcutter_lodge", woodcutter(), (2, 2), notes="woodcutter's lodge: log cabin, chopping block and wood pile, 2x2")
    image("buildings", "quarry", quarry(), (2, 2), notes="stone quarry: stepped rock face, crane and cut blocks, 2x2")
    image("buildings", "mine", mine(), (2, 2), notes="iron mine: hill with a timber-framed tunnel, rails and an ore cart, 2x2")
    image("buildings", "farmhouse", farmhouse(), (2, 2), notes="farmhouse, 2x2: door at x 1.3 on the front-left (+y) face, bench for idle farmers in front")
    image("buildings", "cottage", cottage(), (2, 2), notes="cottage, 2x2: a home for one family, chimney at the back left (smoke drawn by the game)")
