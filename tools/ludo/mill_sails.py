"""Feed mill: cut the sails out of the Ludo mill, spin them, and fit body, sails and static mill onto one canvas.

Usage: python mill_sails.py OUT_DIR

Reads source/feed_mill_raw.png (the whole mill), feed_mill_body_raw.png (the same image with the sails erased) and
feed_mill_winter_raw.png (the body with snow). Writes source/feed_mill_sails_raw.png (the sails: the pixels where
the whole mill and the body differ) and, in OUT_DIR, 2x/1x PNGs and NAME.json for feed_mill, feed_mill_winter,
feed_mill_sails (8 frames in one row), feed_mill_static and feed_mill_static_winter, for install_prop.py.

The sails lie in the plane of the tower's front-right wall. Each frame un-projects them from that wall's 2:1
plane to face-on, turns them about the hub, and projects them back (the same projection as sails() in
tools/art/buildings.py). Only the cleanest blade (the one drawn over empty background) is used, copied every 90°,
so the four blades are identical and frame 8 would be frame 0: the loop has no jump. The hub is drawn on top of
the blades in every frame, unturned. All pieces are fitted with the pad's corners and cropped to one shared box,
so they line up at 1x and 2x; the static mill is the body plus frame 0.
"""
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from fit_building import fit, save

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'source')
CORNERS = (43, 510, 724, 511, 384.5, 680.8)  # pad's left, right and bottom top-surface corners (corners.py)
HUB = (502.0, 327.0)                          # front face of the hub, raw px
HUB_R = 13                                    # hub radius kept on top of the blades
FRAMES = 8                                    # 90° (one blade to the next) in 8 steps
# The sails, roughly, one quad per blade (raw px): only pixels in here can be sails.
BLADES = ([(470, 300), (570, 112), (618, 145), (512, 318)], [(486, 360), (510, 316), (620, 388), (586, 452)],
          [(445, 333), (488, 348), (386, 548), (333, 506)], [(338, 236), (385, 177), (492, 298), (470, 338)])
KEEP = (-95, -5)  # face-on angles (degrees, v up) of the blade that is copied: the front-right one, over background
# The front-right wall's axes on screen at 2:1 (camera 30° up): along the wall (to the right corner) and up.
WALL = np.array([[math.sqrt(0.5), 0.0], [-math.sqrt(0.5) / 2, -math.sqrt(0.75)]])  # columns: u, v


def cut_sails(whole, body):
    """The whole mill's pixels inside the blade quads that the body does not have."""
    m = Image.new('L', whole.size, 0)
    for quad in BLADES:
        ImageDraw.Draw(m).polygon(quad, fill=255)
    m = np.asarray(m.filter(ImageFilter.MaxFilter(9))) > 0
    w, b = np.asarray(whole).astype(int), np.asarray(body).astype(int)
    differ = np.abs(w[..., :3] - b[..., :3]).sum(-1) > 90
    sel = m & (((b[..., 3] < 128) & (w[..., 3] > 0)) | differ)
    out = w.copy()
    out[..., 3] = np.where(sel, w[..., 3], 0)
    return Image.fromarray(out.astype(np.uint8))


def face_on(size):
    """Face-on (u, v) of every pixel, relative to the hub."""
    ys, xs = np.mgrid[0:size[1], 0:size[0]]
    d = np.stack([xs - HUB[0], ys - HUB[1]], -1)
    return d @ np.linalg.inv(WALL).T


def turned(im, deg):
    """`im` turned by `deg` (counter-clockwise seen face-on) about the hub, in the wall's plane."""
    t = math.radians(deg)
    rot = np.array([[math.cos(-t), -math.sin(-t)], [math.sin(-t), math.cos(-t)]])
    m = WALL @ rot @ np.linalg.inv(WALL)  # output pixel offset -> source pixel offset
    c = np.array(HUB) - m @ np.array(HUB)
    coeffs = (m[0, 0], m[0, 1], c[0], m[1, 0], m[1, 1], c[1])
    # Premultiplied, so the edges don't pick up the transparent pixels' colour.
    return im.convert('RGBa').transform(im.size, Image.Transform.AFFINE, coeffs, Image.Resampling.BICUBIC).convert('RGBA')


def main(out_dir):
    whole = Image.open(f'{SRC}/feed_mill_raw.png').convert('RGBA')
    body = Image.open(f'{SRC}/feed_mill_body_raw.png').convert('RGBA')
    winter = Image.open(f'{SRC}/feed_mill_winter_raw.png').convert('RGBA')
    sails = cut_sails(whole, body)
    sails.save(f'{SRC}/feed_mill_sails_raw.png', optimize=True)

    uv = face_on(whole.size)
    ang = np.degrees(np.arctan2(uv[..., 1], uv[..., 0]))
    rad = np.hypot(uv[..., 0], uv[..., 1])
    a = np.array(sails)
    rgb = a[..., :3].astype(int)
    # Wood only: the cut also catches a few pale specks of the wall and pad (sand and grey are far less saturated).
    wood = rgb[..., 0] - rgb[..., 2] > 0.45 * rgb[..., 0]
    a[..., 3] = np.where((ang > KEEP[0]) & (ang < KEEP[1]) & (rad > HUB_R) & wood, a[..., 3], 0)
    blade = Image.fromarray(a)
    ys, xs = np.mgrid[0:whole.height, 0:whole.width]
    hub_alpha = np.clip(HUB_R + 1 - np.hypot(xs - HUB[0], ys - HUB[1]), 0, 1)  # 1 px soft edge
    h = np.array(whole)
    h[..., 3] = (h[..., 3] * hub_alpha).astype(np.uint8)
    hub = Image.fromarray(h)

    frames = []
    for f in range(FRAMES):
        fr = Image.new('RGBA', whole.size)
        for k in range(4):
            fr.alpha_composite(turned(blade, f * 90 / FRAMES + k * 90))
        fr.alpha_composite(hub)
        frames.append(fr)

    pieces = {'feed_mill': fit(body, 2, 2, CORNERS), 'feed_mill_winter': fit(winter, 2, 2, CORNERS)}
    sheet = [fit(fr, 2, 2, CORNERS, cut=False) for fr in frames]
    # One box around everything, even-sized so the 1x halves line up frame by frame.
    boxes = [im.getbbox() for im, _ in [*pieces.values(), *sheet]]
    x0, y0 = min(b[0] for b in boxes) - 2, min(b[1] for b in boxes) - 2
    x1, y1 = max(b[2] for b in boxes) + 2, max(b[3] for b in boxes) + 2
    x1 += (x1 - x0) % 2
    y1 += (y1 - y0) % 2
    box = (x0, y0, x1, y1)
    anchor = pieces['feed_mill'][1]
    for name, (im, _) in pieces.items():
        save(im, anchor, box, out_dir, name)
        static = im.copy()
        static.alpha_composite(sheet[0][0])
        save(static, anchor, box, out_dir, name.replace('feed_mill', 'feed_mill_static'))
    # The sheet: each frame cropped and halved on its own, laid in one row.
    fw, fh = x1 - x0, y1 - y0
    for res, k in (('2x', 1), ('1x', 2)):
        out = Image.new('RGBA', (fw // k * FRAMES, fh // k))
        for i, (im, _) in enumerate(sheet):
            fr = im.crop(box)
            if k > 1:
                fr = fr.resize((fw // k, fh // k), Image.Resampling.LANCZOS)
            out.paste(fr, (i * fw // k, 0))
        out.save(f'{out_dir}/{res}_feed_mill_sails.png', optimize=True)
    # Same anchor as the body (save() wrote it); copy it for the sheet.
    with open(f'{out_dir}/feed_mill.json') as src, open(f'{out_dir}/feed_mill_sails.json', 'w') as dst:
        dst.write(src.read())
    print(f'feed_mill_sails: {FRAMES} frames of {fw}x{fh} (2x), {fw // 2}x{fh // 2} (1x)')


if __name__ == '__main__':
    main(sys.argv[1])
