"""Compose a demo farm from the EXPORTED files + manifest (validates anchors & tiling)."""
import json, os, sys, random
from PIL import Image

PACK = sys.argv[1]
RES = sys.argv[2] if len(sys.argv) > 2 else "1x"
OUTF = sys.argv[3] if len(sys.argv) > 3 else "scene.png"
M = json.load(open(os.path.join(PACK, "manifest.json")))
A = {a["name"]: a for a in M["assets"]}
TWd, THd = M["tile"][RES]["width"], M["tile"][RES]["height"]
cache = {}


def img(path):
    if path not in cache:
        cache[path] = Image.open(os.path.join(PACK, path)).convert("RGBA")
    return cache[path]


N = 16
W = (N * 2) * TWd // 2 + TWd
H = N * THd + 260 * (TWd // 128)
canvas = Image.new("RGBA", (W, H), (110, 175, 78, 255))
OX, OY = W // 2, 200 * (TWd // 128)


def scr(tx, ty):
    return OX + (tx - ty) * TWd / 2, OY + (tx + ty) * THd / 2


ground, objects = [], []


def put_ground(name, tx, ty):
    ground.append((tx, ty, name))


def put(name, tx, ty, frame=None, depth_bias=0.0):
    a = A[name]
    fp = a.get("footprint", [1, 1]) if a["type"] == "image" else [1, 1]
    objects.append((tx + ty + fp[0] + fp[1] + depth_bias, name, tx, ty, frame))


def blit(name, tx, ty, frame=None, shadow=False):
    a = A[name]
    r = a["res"][RES]
    sx, sy = scr(tx, ty)
    if a["type"] == "image":
        path = r.get("shadow") if shadow else r["file"]
        if not path:
            return
        im = img(path)
    else:
        path = r.get("shadow") if shadow else r["file"]
        if not path:
            return
        sheet = img(path)
        cols = r["columns"]
        fx, fy = frame % cols, frame // cols
        im = sheet.crop((fx * r["frameWidth"], fy * r["frameHeight"], (fx + 1) * r["frameWidth"], (fy + 1) * r["frameHeight"]))
    ax, ay = r["anchor"]
    canvas.alpha_composite(im, (int(round(sx - ax)), int(round(sy - ay))))


rnd = random.Random(4)
paths = set()
for x in range(0, N):
    paths.add((x, 7))
for y in range(0, N):
    paths.add((8, y))
for x in range(8, 13):
    paths.add((x, 12))
paths.add((3, 7))


def arms(cells, x, y, prefix, empty):
    a = []
    if (x, y - 1) in cells: a.append("ne")
    if (x + 1, y) in cells: a.append("se")
    if (x, y + 1) in cells: a.append("sw")
    if (x - 1, y) in cells: a.append("nw")
    return prefix + ("_".join(a) if a else empty)


unowned = {(x, y) for x in range(13, N) for y in range(0, 7)}
for x in range(N):
    for y in range(N):
        if (x, y) in paths:
            put_ground(arms(paths, x, y, "path_", "single"), x, y)
        elif (x, y) in unowned:
            put_ground("unowned_1" if rnd.random() < 0.3 else "unowned_0", x, y)
        else:
            put_ground(rnd.choice(["grass_0", "grass_0", "grass_1", "grass_2"]), x, y)

# fields with crops (x 0..6, y 9..14)
fields = [("wheat", 0, 9), ("carrot", 0, 11), ("corn", 0, 13)]
for crop, x0, y0 in fields:
    for i in range(6):
        for j in range(2):
            x, y = x0 + i, y0 + j
            stage = min(3, i // 2 + j)
            put_ground("soil_watered_x" if stage == 1 else "soil_tilled_x", x, y)
            nm = [k for k in A if k.startswith(f"{crop}_{stage}_")][0]
            put(nm, x, y, depth_bias=-0.5)

# buildings
put("barn", 9, 0)
put("chicken_coop", 4, 0)
put("feed_mill_static", 0, 0)
put("dairy", 9, 8)
put("bakery", 9, 13)
put("weaving_hut", 13, 8)
put("market_stall", 13, 13)
put("for_sale_sign", 14, 2)
put("for_sale_sign", 13, 5)

# pasture fence x 9..15, y 0..6 is barn+pasture: fence around x 13..15? keep pasture x 0..6 y 2..5
pasture = set()
for x in range(0, 7):
    pasture.add((x, 3)); pasture.add((x, 6))
for y in range(3, 7):
    pasture.add((0, y)); pasture.add((6, y))
pasture.discard((3, 6))
for (x, y) in pasture:
    nm = arms(pasture, x, y, "fence_", "post")
    if (x, y) == (3, 6):
        continue
    put(nm, x, y)
put("gate_se_nw_open", 3, 6)

# animals (frame index: anim rows ordered idle se,sw,ne,nw, walk se.., eat se..)
def anim_frame(name, anim, d, f):
    a = A[name]
    for an in a["animations"]:
        if an["anim"] == anim and an["dir"] == d:
            return an["start"] + f % an["frames"]


put("cow", 1.6, 4.0, anim_frame("cow", "eat", "se", 1))
put("cow", 4.2, 4.6, anim_frame("cow", "walk", "sw", 2))
put("cow", 2.3, 5.0, anim_frame("cow", "idle", "nw", 0))
put("sheep", 4.6, 3.8, anim_frame("sheep", "walk", "se", 1))
put("sheep", 5.2, 4.0, anim_frame("sheep", "eat", "sw", 2))
put("sheep", 3.4, 3.9, anim_frame("sheep", "idle", "ne", 0))
for (x, y, an, d, f) in ((6.3, 0.6, "walk", "se", 1), (6.6, 1.5, "eat", "sw", 2), (6.0, 2.2, "idle", "nw", 0), (6.9, 0.9, "idle", "sw", 1), (7.4, 2.0, "walk", "ne", 3)):
    put("chicken", x, y, anim_frame("chicken", an, d, f))

# nature & props
for (n, x, y) in (("tree_oak", 15, 7), ("tree_apple", 7, 15), ("tree_pine", 15, 13), ("tree_pine", 14, 15), ("tree_oak", 6, 8),
                  ("bush", 7, 9), ("bush_berry", 12, 9), ("rock_large", 15, 4), ("rock_small", 14, 0), ("hay_roll", 7, 4),
                  ("crate_stack", 12, 14), ("crate_apples", 11, 14), ("hay_bale", 13, 6), ("tree_apple", 10, 6), ("bush", 4, 8)):
    put(n, x, y)

# draw: ground → shadows → objects
for tx, ty, n in sorted(ground, key=lambda g: g[0] + g[1]):
    blit(n, tx, ty)
put_cursor = ("overlay_cursor_ok", 7, 13)
blit(*put_cursor)
for d, n, tx, ty, fr in sorted(objects, key=lambda o: o[0]):
    blit(n, tx, ty, fr, shadow=True)
for d, n, tx, ty, fr in sorted(objects, key=lambda o: o[0]):
    blit(n, tx, ty, fr)
bb = canvas.getbbox()
canvas.save(OUTF)
print(canvas.size)
