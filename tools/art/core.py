"""Isometric (2:1 dimetric) SVG drawing toolkit for the farm asset pack.

World coordinates are in tile units: x runs to screen down-right, y to screen
down-left, z up.  One tile = 256 x 128 px at 2x.
"""
import io, math, colorsys
import numpy as np
import cairosvg
from PIL import Image, ImageFilter

K = 128.0                 # px per world unit horizontally (half tile width)
KZ = K * 1.2247           # px per world unit vertically (true 2:1 dimetric)
TW, TH = 256, 128
OUT = "#3a2618"           # outline colour
OW = 3.0                  # outline width at 2x
LIGHT = (0.55, 0.15)      # shadow offset in world units per unit of height


# ---------------------------------------------------------------- colours
def _rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c * 255))) for c in (r, g, b))


def shade(c, f):
    """f>0 lightens toward white, f<0 darkens (keeps hue, warms shadows a bit)."""
    r, g, b = _rgb(c)
    if f >= 0:
        return _hex(r + (1 - r) * f, g + (1 - g) * f, b + (1 - b) * f)
    f = -f
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r2, g2, b2 = colorsys.hls_to_rgb(h, l * (1 - f), min(1, s * (1 + f * 0.3)))
    return _hex(r2, g2, b2)


def mix(a, b, t):
    ra, rb = _rgb(a), _rgb(b)
    return _hex(*[x + (y - x) * t for x, y in zip(ra, rb)])


def f2(v):
    return f"{v:.2f}"


def pts(points):
    return " ".join(f"{f2(x)},{f2(y)}" for x, y in points)


def hull(points):
    p = sorted(set((round(a, 3), round(b, 3)) for a, b in points))
    if len(p) < 3:
        return p

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for q in p:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(p):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], q) <= 0:
            hi.pop()
        hi.append(q)
    return lo[:-1] + hi[:-1]


# ---------------------------------------------------------------- canvas
class Canvas:
    def __init__(self, w, h, ox, oy):
        self.w, self.h = w, h
        self.ox, self.oy = ox, oy          # screen position of world (0,0,0)
        self.defs, self.el, self.sh = [], [], []
        self._gid = 0

    # projection --------------------------------------------------------
    def P(self, x, y, z=0.0):
        return (self.ox + K * (x - y), self.oy + K * 0.5 * (x + y) - KZ * z)

    def PP(self, seq):
        return [self.P(*p) for p in seq]

    # defs ---------------------------------------------------------------
    def gid(self, p="g"):
        self._gid += 1
        return f"{p}{self._gid}"

    def lin(self, stops, x1=0, y1=0, x2=0, y2=1, units=None):
        i = self.gid()
        u = f' gradientUnits="{units}"' if units else ''
        s = "".join(f'<stop offset="{o}" stop-color="{c}"{"" if a is None else f" stop-opacity=\"{a}\""}/>'
                    for o, c, a in [(st + (None,))[:3] for st in stops])
        self.defs.append(f'<linearGradient id="{i}" x1="{f2(x1)}" y1="{f2(y1)}" x2="{f2(x2)}" y2="{f2(y2)}"{u}>{s}</linearGradient>')
        return f"url(#{i})"

    def rad(self, stops, cx=0.38, cy=0.32, r=0.75):
        i = self.gid()
        s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
        self.defs.append(f'<radialGradient id="{i}" cx="{cx}" cy="{cy}" r="{r}" fx="{cx}" fy="{cy}">{s}</radialGradient>')
        return f"url(#{i})"

    def clip(self, inner_svg):
        i = self.gid("c")
        self.defs.append(f'<clipPath id="{i}">{inner_svg}</clipPath>')
        return f"url(#{i})"

    # raw elements -------------------------------------------------------
    def add(self, s):
        self.el.append(s)

    def poly(self, screen_pts, fill, stroke=OUT, sw=OW, extra=""):
        st = f' stroke="{stroke}" stroke-width="{f2(sw)}" stroke-linejoin="round"' if stroke else ''
        self.el.append(f'<polygon points="{pts(screen_pts)}" fill="{fill}"{st} {extra}/>')

    def poly3(self, p3, fill, stroke=OUT, sw=OW, extra=""):
        self.poly(self.PP(p3), fill, stroke, sw, extra)

    def path(self, d, fill="none", stroke=OUT, sw=OW, extra=""):
        st = f' stroke="{stroke}" stroke-width="{f2(sw)}" stroke-linejoin="round" stroke-linecap="round"' if stroke else ''
        self.el.append(f'<path d="{d}" fill="{fill}"{st} {extra}/>')

    def line(self, a, b, color, w, cap="round", opacity=None):
        o = f' stroke-opacity="{opacity}"' if opacity is not None else ''
        self.el.append(f'<line x1="{f2(a[0])}" y1="{f2(a[1])}" x2="{f2(b[0])}" y2="{f2(b[1])}" stroke="{color}" stroke-width="{f2(w)}" stroke-linecap="{cap}"{o}/>')

    def limb(self, a, b, color, w, outline=True):
        """Thick rounded stroke with an outline (screen coords)."""
        if outline:
            self.line(a, b, OUT, w + 2 * OW)
        self.line(a, b, color, w)

    def ell(self, cx, cy, rx, ry, fill, rot=0.0, stroke=OUT, sw=OW, extra=""):
        st = f' stroke="{stroke}" stroke-width="{f2(sw)}"' if stroke else ''
        tr = f' transform="rotate({f2(rot)} {f2(cx)} {f2(cy)})"' if rot else ''
        self.el.append(f'<ellipse cx="{f2(cx)}" cy="{f2(cy)}" rx="{f2(rx)}" ry="{f2(ry)}" fill="{fill}"{st}{tr} {extra}/>')

    def circle(self, cx, cy, r, fill, stroke=OUT, sw=OW, extra=""):
        self.ell(cx, cy, r, r, fill, 0, stroke, sw, extra)

    def text(self, x, y, s, size, fill, transform="", weight="bold", anchor="middle", stroke=None, sw=0):
        st = f' stroke="{stroke}" stroke-width="{sw}" paint-order="stroke"' if stroke else ''
        tr = f' transform="{transform}"' if transform else ''
        self.el.append(f'<text x="{f2(x)}" y="{f2(y)}" font-family="DejaVu Sans" font-weight="{weight}" font-size="{size}" fill="{fill}" text-anchor="{anchor}"{st}{tr}>{s}</text>')

    def group(self, inner, transform="", clip=None, opacity=None):
        a = ""
        if transform:
            a += f' transform="{transform}"'
        if clip:
            a += f' clip-path="{clip}"'
        if opacity is not None:
            a += f' opacity="{opacity}"'
        self.el.append(f"<g{a}>")
        inner()
        self.el.append("</g>")

    # shadows -------------------------------------------------------------
    def shadow_pts(self, p3):
        """Cast shadow of a set of 3D points onto the ground (adds to shadow layer)."""
        g = []
        for x, y, z in p3:
            g.append(self.P(x + LIGHT[0] * z, y + LIGHT[1] * z, 0))
        self.sh.append(f'<polygon points="{pts(hull(g))}" fill="#000"/>')

    def shadow_ell(self, x, y, rx, ry=None, z=0.0):
        """Elliptical ground blob (world radii)."""
        ry = rx if ry is None else ry
        cx, cy = self.P(x + LIGHT[0] * z * 0.5, y + LIGHT[1] * z * 0.5, 0)
        # project a horizontal ellipse: approximate as circle of mean radius
        r = (rx + ry) / 2
        self.sh.append(f'<ellipse cx="{f2(cx)}" cy="{f2(cy)}" rx="{f2(K * r * 1.414)}" ry="{f2(K * r * 0.707)}" fill="#000"/>')

    def shadow_raw(self, s):
        self.sh.append(s)

    # 3D primitives ---------------------------------------------------------
    def box(self, x0, y0, z0, x1, y1, z1, top, left, right, stroke=OUT, sw=OW, shadow=True, grad=True):
        """Axis aligned box; left = face at y1 (lower-left), right = face at x1 (lower-right)."""
        P = self.P
        if shadow:
            self.shadow_pts([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)])
        lf = self.lin([(0, shade(left, 0.08)), (1, shade(left, -0.06))]) if grad else left
        rf = self.lin([(0, shade(right, 0.04)), (1, shade(right, -0.1))]) if grad else right
        self.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], lf, stroke, sw)
        self.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], rf, stroke, sw)
        self.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top, stroke, sw)

    def face_y(self, x0, y, z1):
        """transform for drawing on the lower-left face (plane y=const). Local (0,0)
        is the face's top-left corner at world (x0, y, z1); u in px to the right, v px down."""
        ex, ey = self.P(x0, y, z1)
        return f"matrix(1,0.5,0,1,{f2(ex)},{f2(ey)})"

    def face_x(self, x, y1, z1):
        """transform for the lower-right face (plane x=const). Local (0,0) is at world
        (x, y1, z1) – the face's top-left on screen; u runs toward y0 (up-right)."""
        ex, ey = self.P(x, y1, z1)
        return f"matrix(1,-0.5,0,1,{f2(ex)},{f2(ey)})"

    def ellipsoid(self, c, r, color, stroke=OUT, sw=OW, hi=0.35, lo=-0.18, shading=True, extra=""):
        """Project ellipsoid with centre c=(x,y,z) and radii r=(a,b,c)."""
        M = np.array([[K, -K, 0.0], [K / 2, K / 2, -KZ]]) @ np.diag(r)
        S = M @ M.T
        w, v = np.linalg.eigh(S)
        rx, ry = math.sqrt(w[1]), math.sqrt(w[0])
        ang = math.degrees(math.atan2(v[1, 1], v[0, 1]))
        cx, cy = self.P(*c)
        fill = self.rad([(0, shade(color, hi)), (0.55, color), (1, shade(color, lo))]) if shading else color
        self.ell(cx, cy, rx, ry, fill, ang, stroke, sw, extra)
        return cx, cy, rx, ry, ang

    def cylinder(self, x, y, z0, z1, r, color, top=None, stroke=OUT, sw=OW, r1=None, shadow=True):
        """Vertical (optionally tapered) cylinder."""
        r1 = r if r1 is None else r1
        cx, cb = self.P(x, y, z0)
        _, ct = self.P(x, y, z1)
        rx0, ry0 = K * r * 1.4142, K * r * 0.7071
        rx1, ry1 = K * r1 * 1.4142, K * r1 * 0.7071
        if shadow:
            ring = [(x + r * math.cos(a), y + r * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)
                    for z in (z0,)] + [(x + r1 * math.cos(a), y + r1 * math.sin(a), z1) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
            self.shadow_pts(ring)
        side = self.lin([(0, shade(color, 0.18)), (0.45, color), (1, shade(color, -0.25))], 0, 0, 1, 0)
        d = (f"M{f2(cx - rx1)},{f2(ct)} L{f2(cx - rx0)},{f2(cb)} "
             f"A{f2(rx0)},{f2(ry0)} 0 0 0 {f2(cx + rx0)},{f2(cb)} L{f2(cx + rx1)},{f2(ct)} Z")
        self.path(d, side, stroke, sw)
        self.ell(cx, ct, rx1, ry1, top or shade(color, 0.2), 0, stroke, sw)
        return cx, ct, rx1, ry1

    def cone(self, x, y, z0, z1, r, color, stroke=OUT, sw=OW, shadow=True):
        cx, cb = self.P(x, y, z0)
        _, ca = self.P(x, y, z1)
        rx, ry = K * r * 1.4142, K * r * 0.7071
        if shadow:
            self.shadow_pts([(x + r * math.cos(a), y + r * math.sin(a), z0) for a in np.linspace(0, 6.28, 16)] + [(x, y, z1)])
        side = self.lin([(0, shade(color, 0.2)), (0.5, color), (1, shade(color, -0.25))], 0, 0, 1, 0)
        d = f"M{f2(cx - rx)},{f2(cb)} L{f2(cx)},{f2(ca)} L{f2(cx + rx)},{f2(cb)} A{f2(rx)},{f2(ry)} 0 0 1 {f2(cx - rx)},{f2(cb)} Z"
        self.path(d, side, stroke, sw)

    def shingles(self, A, B, C, D, color, rows=6, cols=10, sw=2.0):
        """Texture a roof quad. A-B eave (screen), D-C ridge. Draw course lines + staggered ticks."""
        dark = shade(color, -0.28)
        for i in range(1, rows):
            t = i / rows
            p = (A[0] + (D[0] - A[0]) * t, A[1] + (D[1] - A[1]) * t)
            q = (B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t)
            self.line(p, q, dark, sw, cap="butt", opacity=0.55)
        for i in range(rows):
            t0, t1 = i / rows, (i + 1) / rows
            for j in range(cols):
                s = (j + (0.5 if i % 2 else 0.0)) / cols
                if s <= 0.02 or s >= 0.98:
                    continue

                def at(t, s):
                    e = (A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s)
                    r_ = (D[0] + (C[0] - D[0]) * s, D[1] + (C[1] - D[1]) * s)
                    return (e[0] + (r_[0] - e[0]) * t, e[1] + (r_[1] - e[1]) * t)
                self.line(at(t0, s), at(t1, s), dark, sw * 0.8, cap="butt", opacity=0.4)
        # eave highlight
        self.line(A, B, shade(color, 0.35), sw * 1.2, opacity=0.6)

    def gable_roof(self, x0, y0, x1, y1, zw, zr, color, along="x", oh=0.12, gable_color=None,
                   rows=6, cols=10, shadow=True):
        """Gable roof. along='x': ridge parallel to x (slopes face +-y)."""
        P = self.P
        gc = gable_color or "#f1dfb8"
        if along == "x":
            ym = (y0 + y1) / 2
            ax0, ax1 = x0 - oh, x1 + oh
            # overhang lowers the eave slightly
            slope = (zr - zw) / ((y1 - y0) / 2)
            ze = zw - oh * slope
            if shadow:
                self.shadow_pts([(ax0, y0 - oh, ze), (ax1, y0 - oh, ze), (ax0, y1 + oh, ze), (ax1, y1 + oh, ze), (ax0, ym, zr), (ax1, ym, zr)])
            back = [P(ax0, y0 - oh, ze), P(ax1, y0 - oh, ze), P(ax1, ym, zr), P(ax0, ym, zr)]
            self.poly(back, shade(color, 0.12))
            # gable triangle (x1 end, visible)
            self.poly([P(x1, y0, zw), P(x1, y1, zw), P(x1, ym, zr - 0.02)], self.lin([(0, shade(gc, 0.05)), (1, shade(gc, -0.12))]))
            front = [P(ax0, y1 + oh, ze), P(ax1, y1 + oh, ze), P(ax1, ym, zr), P(ax0, ym, zr)]
            self.poly(front, self.lin([(0, shade(color, 0.1)), (1, shade(color, -0.08))], 0, 0, 0, 1))
            self.shingles(front[0], front[1], front[2], front[3], color, rows, cols)
            # side edge of front + back slope at x1 (roof thickness board)
            self.poly([P(ax1, y0 - oh, ze), P(ax1, ym, zr), P(ax1, ym, zr - 0.05), P(ax1, y0 - oh, ze - 0.05)], shade(color, -0.35))
            self.poly([P(ax1, ym, zr), P(ax1, y1 + oh, ze), P(ax1, y1 + oh, ze - 0.05), P(ax1, ym, zr - 0.05)], shade(color, -0.35))
            self.line(P(ax0, ym, zr + 0.01), P(ax1, ym, zr + 0.01), shade(color, -0.4), OW * 1.6)
        else:
            xm = (x0 + x1) / 2
            ay0, ay1 = y0 - oh, y1 + oh
            slope = (zr - zw) / ((x1 - x0) / 2)
            ze = zw - oh * slope
            if shadow:
                self.shadow_pts([(x0 - oh, ay0, ze), (x1 + oh, ay0, ze), (x0 - oh, ay1, ze), (x1 + oh, ay1, ze), (xm, ay0, zr), (xm, ay1, zr)])
            back = [P(x0 - oh, ay0, ze), P(x0 - oh, ay1, ze), P(xm, ay1, zr), P(xm, ay0, zr)]
            self.poly(back, shade(color, 0.12))
            self.poly([P(x0, y1, zw), P(x1, y1, zw), P(xm, y1, zr - 0.02)], self.lin([(0, shade(gc, 0.08)), (1, shade(gc, -0.08))]))
            front = [P(x1 + oh, ay1, ze), P(x1 + oh, ay0, ze), P(xm, ay0, zr), P(xm, ay1, zr)]
            self.poly(front, self.lin([(0, shade(color, -0.02)), (1, shade(color, -0.16))], 0, 0, 0, 1))
            self.shingles(front[0], front[1], front[2], front[3], shade(color, -0.08), rows, cols)
            self.poly([P(x0 - oh, ay1, ze), P(xm, ay1, zr), P(xm, ay1, zr - 0.05), P(x0 - oh, ay1, ze - 0.05)], shade(color, -0.35))
            self.poly([P(xm, ay1, zr), P(x1 + oh, ay1, ze), P(x1 + oh, ay1, ze - 0.05), P(xm, ay1, zr - 0.05)], shade(color, -0.35))
            self.line(P(xm, ay0, zr + 0.01), P(xm, ay1, zr + 0.01), shade(color, -0.4), OW * 1.6)

    # ---------------------------------------------------------------- output
    def svg(self, layer="main"):
        body = "".join(self.el if layer == "main" else self.sh)
        defs = f"<defs>{''.join(self.defs)}</defs>" if layer == "main" else ""
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
                f'viewBox="0 0 {self.w} {self.h}">{defs}{body}</svg>')

    def render(self, scale=1.0):
        data = cairosvg.svg2png(bytestring=self.svg().encode(), scale=scale)
        return Image.open(io.BytesIO(data)).convert("RGBA")

    def render_shadow(self, scale=1.0, opacity=0.30, blur=5.0):
        if not self.sh:
            return None
        data = cairosvg.svg2png(bytestring=self.svg("shadow").encode(), scale=scale)
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        a = im.split()[3].filter(ImageFilter.GaussianBlur(blur * scale))
        a = a.point(lambda v: int(v * opacity))
        out = Image.new("RGBA", im.size, (20, 30, 10, 0))
        out.putalpha(a)
        return out
