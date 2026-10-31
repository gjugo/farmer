"""Item icons. Each function draws into a 128x128 box (can be embedded with a transform)."""
import math
from core import *
from registry import image


def _shadow(c, cx=64, cy=114, rx=40, ry=7):
    c.ell(cx, cy, rx, ry, "#000", 0, None, extra='opacity="0.16"')


def _hl(c, d, w=5, op=0.75):
    c.path(d, "none", "#ffffff", w, extra=f'stroke-opacity="{op}"')


def egg(c):
    _shadow(c, rx=30)
    c.path("M64,14 C92,14 104,58 104,78 C104,100 86,114 64,114 C42,114 24,100 24,78 C24,58 36,14 64,14 Z",
           c.rad([(0, "#fffaf0"), (0.6, "#f6e7cf"), (1, "#d9bf98")], 0.4, 0.35, 0.8), OUT, 4)
    _hl(c, "M44,40 Q50,28 58,24", 6)
    for (x, y, r) in ((78, 70, 3), (70, 90, 2.4), (86, 86, 2)):
        c.circle(x, y, r, "#d8b88d", None)


def milk(c):
    _shadow(c, rx=34)
    c.path("M44,40 L44,30 L84,30 L84,40 Q100,52 100,70 L100,104 Q100,114 90,114 L38,114 Q28,114 28,104 L28,70 Q28,52 44,40 Z",
           c.lin([(0, "#ffffff"), (0.7, "#eef3f7"), (1, "#c9d6e0")], 0, 0, 1, 0), OUT, 4)
    c.path("M28,78 L100,78 L100,104 Q100,114 90,114 L38,114 Q28,114 28,104 Z", "#5aa3e6", OUT, 3)
    c.circle(64, 96, 9, "#ffffff", None)
    c.path("M40,18 h48 v14 h-48 Z", "#5aa3e6", OUT, 3.5)
    _hl(c, "M38,60 Q40,50 48,46", 6)


def wool(c):
    _shadow(c, rx=42)
    c.circle(64, 66, 44, c.rad([(0, "#ffffff"), (0.6, "#f3eee2"), (1, "#cfc6b1")]), OUT, 4)
    for k in range(5):
        c.path(f"M{30 + k * 3},{40 + k * 12} Q64,{20 + k * 14} {98 - k * 2},{44 + k * 12}", "none", "#cbbfa5", 3.5)
    c.path("M96,92 Q110,104 116,96", "none", "#cbbfa5", 5)
    _hl(c, "M38,46 Q44,34 56,30", 6)


def feed(c):
    _shadow(c, rx=40)
    c.path("M30,112 Q20,70 36,40 L46,26 L82,26 L92,40 Q108,70 98,112 Q64,120 30,112 Z",
           c.lin([(0, "#f1dcb2"), (1, "#c9a873")], 0, 0, 1, 0), OUT, 4)
    c.path("M44,30 Q64,40 84,30", "none", "#9b6a3c", 5)
    c.path("M48,26 L56,14 L64,24 L72,12 L80,26", "#f2c14e", OUT, 3)
    c.circle(64, 78, 18, "#7cc952", OUT, 3)
    for a in range(-1, 2):
        c.path(f"M{64 + a * 6},88 L{64 + a * 6},68", "none", "#f2c14e", 3.5)
        c.ell(64 + a * 6, 66, 3.5, 6, "#f2c14e", 0, OUT, 1.5)


def cheese(c):
    _shadow(c, rx=44)
    c.path("M14,78 L98,40 L116,62 L116,96 L32,108 L14,96 Z", "#f0b42e", OUT, 4)
    c.path("M14,78 L98,40 L116,62 L32,82 Z", "#ffd65a", OUT, 4)
    c.path("M32,82 L116,62 L116,96 L32,108 Z", c.lin([(0, "#f7c43f"), (1, "#e3a020")], 0, 0, 0, 1), OUT, 4)
    for (x, y, rx, ry) in ((60, 92, 7, 5), (90, 82, 5, 4), (100, 96, 4, 3), (46, 98, 3.5, 3)):
        c.ell(x, y, rx, ry, "#d18f1a", 0, None)
    c.ell(72, 64, 6, 3, "#e3a020", -12, None)
    c.ell(54, 72, 4, 2, "#e3a020", -12, None)


def butter(c):
    _shadow(c, rx=46)
    c.path("M16,96 L64,112 L112,96 L112,104 L64,120 L16,104 Z", "#a9c6dd", OUT, 3)
    c.path("M24,62 L64,46 L104,62 L104,88 L64,104 L24,88 Z", "#ffe27a", OUT, 4)
    c.path("M24,62 L64,46 L104,62 L64,78 Z", "#fff0ad", OUT, 4)
    c.path("M64,78 L104,62 L104,88 L64,104 Z", "#f5cf52", OUT, 4)
    c.path("M30,98 Q64,110 98,98", "none", "#ffffff", 3, extra='stroke-opacity="0.6"')
    _hl(c, "M40,64 L58,57", 5)


def bread(c):
    _shadow(c, rx=48)
    c.path("M14,86 Q12,46 64,40 Q116,46 114,86 Q114,104 96,106 L32,106 Q14,104 14,86 Z",
           c.lin([(0, "#f6c06c"), (0.6, "#d98a38"), (1, "#a95f22")], 0, 0, 0, 1), OUT, 4)
    for x in (40, 62, 84):
        c.path(f"M{x - 8},{62} Q{x},{52} {x + 10},{60}", "none", "#fbe1a9", 6)
    _hl(c, "M26,70 Q30,56 44,50", 5, 0.6)


def cloth(c):
    _shadow(c, rx=46)
    c.path("M18,44 L92,30 L110,44 L110,96 L36,110 L18,96 Z", "#5b8fd6", OUT, 4)
    c.path("M18,44 L92,30 L92,82 L18,96 Z", c.lin([(0, "#8fb8f0"), (1, "#5b8fd6")], 0, 0, 1, 0), OUT, 4)
    for k in range(1, 4):
        c.line((18 + k * 18, 44 - k * 3.4), (18 + k * 18, 96 - k * 3.4), "#e9f1ff", 4, opacity=0.8)
        c.line((18, 44 + k * 13), (92, 30 + k * 13), "#e9f1ff", 3, opacity=0.6)
    c.ell(101, 63, 9, 26, "#3f72b8", 0, OUT, 3)
    c.ell(101, 63, 4, 10, "#2c548c", 0, None)


def wheat_icon(c):
    _shadow(c, rx=34)
    for k, ang in enumerate((-20, -8, 4, 16)):
        a = math.radians(ang - 90)
        bx, by = 64, 112
        tx, ty = bx + math.cos(a) * 92, by + math.sin(a) * 92
        c.line((bx, by), (tx, ty), OUT, 7)
        c.line((bx, by), (tx, ty), "#d9a93a", 3.5)
        for g in range(6):
            gx = tx - math.cos(a) * (g * 7 + 2)
            gy = ty - math.sin(a) * (g * 7 + 2)
            for side in (-1, 1):
                c.ell(gx + side * 4.5, gy, 4, 7.5, "#f2c84b", ang + side * 25, OUT, 1.8)
    c.path("M48,92 Q64,100 80,92 L80,100 Q64,108 48,100 Z", "#c0563b", OUT, 3)


def carrot_icon(c):
    _shadow(c, rx=36, cx=60)
    for ang in (-60, -30, 0):
        a = math.radians(ang - 60)
        p = (82, 34)
        c.ell(p[0] + math.cos(a) * 16, p[1] + math.sin(a) * 16, 6, 16, "#5cbf3f", ang - 60 + 90, OUT, 3)
    c.path("M22,110 Q20,104 28,96 L78,30 Q92,24 98,38 Q102,48 92,56 L34,106 Q26,114 22,110 Z",
           c.lin([(0, "#ffb558"), (1, "#e2661a")], 0, 0, 1, 1), OUT, 4)
    for (x0, y0, x1, y1) in ((58, 62, 68, 70), (44, 82, 52, 88), (74, 46, 82, 52)):
        c.line((x0, y0), (x1, y1), "#c4561a", 3)
    _hl(c, "M66,48 L80,36", 5)


def corn_icon(c):
    _shadow(c, rx=34)
    c.path("M64,10 Q90,20 92,62 Q92,98 64,112 Q36,98 36,62 Q38,20 64,10 Z",
           c.lin([(0, "#ffe680"), (1, "#f2b230")], 0, 0, 1, 0), OUT, 4)
    for r in range(8):
        y = 24 + r * 10
        for k in range(-2, 3):
            c.ell(64 + k * 9.5, y, 4.4, 4.2, "#fff2a6" if (r + k) % 2 else "#f7cf55", 0, "#d99a25", 1.2)
    c.path("M64,112 Q30,104 22,62 Q40,80 64,92 Z", "#7cc952", OUT, 3.5)
    c.path("M64,112 Q98,104 106,62 Q88,80 64,92 Z", "#5fae3e", OUT, 3.5)


def coins(c):
    _shadow(c, rx=46)
    for (x, y) in ((44, 96), (44, 84), (44, 72), (84, 98), (84, 86)):
        c.ell(x, y + 6, 26, 10, "#d9a01e", 0, OUT, 3.5)
        c.ell(x, y, 26, 10, "#ffd447", 0, OUT, 3.5)
    c.circle(76, 52, 30, c.rad([(0, "#fff0a0"), (0.6, "#ffd447"), (1, "#d9a01e")]), OUT, 4)
    c.circle(76, 52, 22, "none", "#d9a01e", 3)
    c.text(76, 62, "$", 30, "#b07d12")
    _hl(c, "M58,38 Q64,28 74,26", 5)


def _log(c, x, y, r, length):
    """One log lying along the view, its cut end (rings) facing the viewer at (x, y)."""
    c.path(f"M{x},{y - r} L{x + length},{y - r - length * 0.35} L{x + length},{y + r - length * 0.35} L{x},{y + r} Z",
           c.lin([(0, "#b0743e"), (1, "#7a4a24")], 0, 0, 0, 1), OUT, 3.5)
    c.ell(x, y, r * 0.8, r, c.rad([(0, "#f3d29a"), (0.7, "#e2b36f"), (1, "#b98446")]), 0, OUT, 3.5)
    c.ell(x, y, r * 0.5, r * 0.62, "none", 0, "#b98446", 2)
    c.ell(x, y, r * 0.2, r * 0.25, "#b98446", 0, None)


def wood(c):
    _shadow(c, rx=46)
    _log(c, 30, 92, 17, 70)
    _log(c, 64, 96, 17, 46)
    _log(c, 46, 62, 17, 58)
    c.path("M50,40 Q58,30 70,30", "none", "#5cbf3f", 4)
    c.ell(72, 30, 7, 4, "#5cbf3f", -20, OUT, 2)


def stone(c):
    _shadow(c, rx=46)
    c.path("M18,102 L24,70 L48,54 L74,58 L86,80 L80,106 L40,112 Z",
           c.lin([(0, "#c4c8cc"), (1, "#868c93")], 0, 0, 1, 1), OUT, 4)
    c.path("M24,70 L48,54 L74,58 L56,74 Z", "#dfe2e5", OUT, 3)
    c.path("M56,74 L86,80 L80,106 L40,112 Z", "#9aa0a6", OUT, 3)
    c.path("M70,102 L76,72 L96,58 L112,70 L114,98 L96,110 Z",
           c.lin([(0, "#b3b8bd"), (1, "#7b8188")], 0, 0, 1, 1), OUT, 4)
    c.path("M76,72 L96,58 L112,70 L94,80 Z", "#d4d8db", OUT, 3)
    c.line((36, 86), (46, 96), "#6f757c", 3)
    _hl(c, "M30,70 L44,60", 5, 0.6)


def _ingot(c, x, y):
    """A trapezoid iron bar: top face, front face and right end, (x, y) = front-left bottom corner."""
    c.path(f"M{x},{y} L{x + 58},{y} L{x + 58},{y - 16} L{x + 6},{y - 16} Z", "#6d7884", OUT, 3.5)
    c.path(f"M{x + 6},{y - 16} L{x + 58},{y - 16} L{x + 68},{y - 26} L{x + 22},{y - 26} Z", "#a9b4bf", OUT, 3.5)
    c.path(f"M{x + 58},{y} L{x + 72},{y - 12} L{x + 68},{y - 26} L{x + 58},{y - 16} Z", "#4f5963", OUT, 3.5)


def iron(c):
    _shadow(c, rx=48)
    _ingot(c, 14, 110)
    _ingot(c, 50, 110)
    _ingot(c, 32, 84)
    _hl(c, "M44,59 L80,59", 4, 0.7)


def manure(c):
    """A forked heap of dark, straw-flecked dung: what a farmer spreads on worn fields."""
    _shadow(c, rx=48)
    c.path("M12,108 Q14,84 34,76 Q40,58 60,56 Q82,52 92,70 Q114,76 116,104 Q90,116 64,114 Q34,116 12,108 Z",
           c.lin([(0, "#7a5230"), (0.6, "#5a3a1f"), (1, "#3f2914")], 0, 0, 0, 1), OUT, 4)
    c.path("M34,78 Q52,70 64,76 Q80,68 92,72", "none", "#8d6640", 4)
    c.path("M22,96 Q44,88 64,94 Q86,86 108,96", "none", "#8d6640", 3.5)
    for (x1, y1, x2, y2) in ((40, 70, 52, 62), (70, 84, 84, 80), (28, 92, 38, 86), (88, 96, 100, 92), (56, 100, 66, 104)):
        c.line((x1, y1), (x2, y2), "#e8c766", 3)
    # A fork stuck in the heap, tines buried: only the handle and its grip show.
    c.line((78, 60), (100, 14), "#9b6a3c", 5)
    c.line((93, 11), (107, 18), "#7a4a24", 6)
    _hl(c, "M42,62 Q50,58 58,58", 4, 0.35)


ICONS = {
    "egg": egg, "milk": milk, "wool": wool, "feed": feed, "cheese": cheese, "butter": butter,
    "bread": bread, "cloth": cloth, "wheat": wheat_icon, "carrot": carrot_icon, "corn": corn_icon, "coins": coins,
    "wood": wood, "stone": stone, "iron": iron, "manure": manure,
}


def build():
    for nm, fn in ICONS.items():
        # 2x canvas = 256x256 with the 128 design scaled 2x
        c = Canvas(256, 256, 128, 128)
        c.group(lambda fn=fn: fn(c), transform="scale(2)")
        image("icons", nm, c, footprint=(0, 0), anchor=(128, 128), notes="item icon, 256px @2x / 128px @1x", shadow=False)
