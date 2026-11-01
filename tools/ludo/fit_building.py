"""Fit a Ludo-generated isometric building onto the game's grid.

Usage: python fit_building.py RAW.png OUT_DIR NAME FOOT_W FOOT_H LEFT_X LEFT_Y RIGHT_X RIGHT_Y BOTTOM_X BOTTOM_Y [--mirror]
       [--keep=N] [--box=X0,Y0,X1,Y1]

LEFT/RIGHT/BOTTOM are the pad's top-surface corners, measured on the raw image (before mirroring).
FOOT_W/FOOT_H are the footprint in the game (tiles along x / along y) after any mirroring.
Everything below the top surface's two lower edges (the soil block Ludo draws) is cut away.
--box crops the scaled 2x image to that box instead of its own bounds, so several images fitted with the same
corners share one canvas and anchor (mill_sails.py does this for the feed mill's body, sails and winter body).
Writes 2x and 1x PNGs and NAME.json (for install_prop.py), and prints the manifest anchor (the footprint's top
corner) for each.
"""
import json
import sys
import numpy as np
from PIL import Image

TILE_W2 = 256  # 2x tile width
INSET = 8      # 2x px the pad is pulled in from each side corner, like the pack's own pads


def fit(im, fw, fh, corners, mirror=False, keep=2.0, cut=True):
    """Scales a raw image so its pad matches a fw x fh footprint at 2x. Returns the scaled (uncropped) image and
    the footprint's top corner on it. `cut` drops the soil block below the pad's lower edges (+keep px)."""
    lx, ly, rx, ry, bx, by = corners
    w, h = im.size
    if mirror:
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        lx, ly, rx, ry, bx = w - 1 - rx, ry, w - 1 - lx, ly, w - 1 - bx
    if cut:
        a = np.array(im)
        ys, xs = np.mgrid[0:h, 0:w]
        left_edge = ly + (xs - lx) * (by - ly) / (bx - lx)
        right_edge = ry + (rx - xs) * (by - ry) / (rx - bx)
        limit = np.where(xs <= bx, left_edge, right_edge) + keep
        a[..., 3] = np.where(ys > limit, 0, a[..., 3])
        im = Image.fromarray(a)
    # Footprint top corner: fh half-tiles up-right of the left corner.
    half = (rx - lx) / (fw + fh)  # half a tile's width, raw px
    top = (lx + fh * half, ly - fh * half / 2)
    scale = ((fw + fh) * TILE_W2 / 2 - 2 * INSET) / (rx - lx)
    im2 = im.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    return im2, (top[0] * scale, top[1] * scale - INSET / 2)


def own_box(im2):
    """The image's opaque bounds plus a 2 px margin."""
    bbox = im2.getbbox()
    return (max(bbox[0] - 2, 0), max(bbox[1] - 2, 0), min(bbox[2] + 2, im2.width), min(bbox[3] + 2, im2.height))


def save(im2, anchor, box, out_dir, name):
    """Crops a fitted image to `box`, writes its 2x and 1x PNGs and NAME.json, and returns the 2x anchor."""
    im2 = im2.crop(box)
    ax, ay = round(anchor[0] - box[0]), round(anchor[1] - box[1])
    im2.save(f'{out_dir}/2x_{name}.png', optimize=True)
    im1 = im2.resize((round(im2.width / 2), round(im2.height / 2)), Image.Resampling.LANCZOS)
    im1.save(f'{out_dir}/1x_{name}.png', optimize=True)
    json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out_dir}/{name}.json', 'w'))
    print(f'{name}: 2x {im2.width}x{im2.height} anchor {ax},{ay}; 1x {im1.width}x{im1.height} anchor {ax / 2:g},{ay / 2:g}')
    return ax, ay


if __name__ == '__main__':
    raw, out_dir, name = sys.argv[1], sys.argv[2], sys.argv[3]
    fw, fh = int(sys.argv[4]), int(sys.argv[5])
    corners = tuple(map(float, sys.argv[6:12]))
    keep = float(next((x.split("=")[1] for x in sys.argv if x.startswith("--keep=")), 2))  # px kept below the edges (outline)
    box_arg = next((x.split("=")[1] for x in sys.argv if x.startswith("--box=")), None)
    im2, anchor = fit(Image.open(raw).convert('RGBA'), fw, fh, corners, "--mirror" in sys.argv, keep)
    box = tuple(map(int, box_arg.split(','))) if box_arg else own_box(im2)
    save(im2, anchor, box, out_dir, name)
