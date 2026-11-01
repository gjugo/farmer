import sys, numpy as np
from PIL import Image, ImageDraw
f = sys.argv[1]
im = Image.open(f).convert('RGBA'); a = np.asarray(im)[..., 3] > 128
cols = np.nonzero(a.any(0))[0]; lx, rx = cols[0], cols[-1]
ly = np.nonzero(a[:, lx])[0].min(); ry = np.nonzero(a[:, rx])[0].min()
# top surface bottom corner from 2:1 edges
bx = (lx + rx) / 2 + (ry - ly); by = ly + (bx - lx) / 2
print(f, im.size, 'L', lx, ly, 'R', rx, ry, 'B', round(bx, 1), round(by, 1))
ov = im.copy(); d = ImageDraw.Draw(ov)
d.line([(lx, ly), (bx, by), (rx, ry)], fill=(255, 0, 0, 255), width=2)
for x, y in ((lx, ly), (rx, ry), (bx, by)): d.ellipse((x-5, y-5, x+5, y+5), outline=(0, 0, 255, 255), width=2)
bg = Image.new('RGBA', im.size, (90, 140, 70, 255)); bg.alpha_composite(ov); bg.save(f.rsplit('.', 1)[0] + '_corners.png')
