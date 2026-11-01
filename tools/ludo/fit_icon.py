"""Fit a Ludo-generated item (a sprite on a transparent background) into the pack's square icon box.

Usage: python fit_icon.py RAW.png OUT_DIR NAME [--pad=PX] [--color=K] [--bright=K]

Trims the item to its opaque pixels, scales it so its longer side fills the 256 px 2x box less PAD on each side
(default 14), and centres it, so every icon has the same padding and reads at the same size. Faint halo pixels
(alpha below 16) are dropped first, so a stray speck can't shift the centre. --color and --bright lift saturation
and brightness (for an icon that comes out paler than its neighbours). Writes 256 px 2x and 128 px 1x PNGs and a
NAME.json with the anchor (the box's centre) for install_prop.py.
"""
import json
import sys
from PIL import Image, ImageEnhance

BOX = 256  # 2x icon box

raw, out_dir, name = sys.argv[1], sys.argv[2], sys.argv[3]
opt = {k[2:]: float(v) for k, v in (x.split('=') for x in sys.argv[4:] if x.startswith('--'))}
pad = opt.get('pad', 14)

im = Image.open(raw).convert('RGBA')
alpha = im.getchannel('A').point(lambda a: 0 if a < 16 else a)
im.putalpha(alpha)
im = im.crop(alpha.getbbox())
if 'color' in opt or 'bright' in opt:
    a = im.getchannel('A')
    rgb = ImageEnhance.Color(im.convert('RGB')).enhance(opt.get('color', 1))
    rgb = ImageEnhance.Brightness(rgb).enhance(opt.get('bright', 1))
    rgb.putalpha(a)
    im = rgb

inner = BOX - 2 * pad
k = inner / max(im.width, im.height)
im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.Resampling.LANCZOS)
out = Image.new('RGBA', (BOX, BOX), (0, 0, 0, 0))
out.alpha_composite(im, ((BOX - im.width) // 2, (BOX - im.height) // 2))

out.save(f'{out_dir}/2x_{name}.png', optimize=True)
out.resize((BOX // 2, BOX // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x_{name}.png', optimize=True)
json.dump({'2x': [BOX / 2, BOX / 2], '1x': [BOX / 4, BOX / 4]}, open(f'{out_dir}/{name}.json', 'w'))
print(f'{name}: item {im.width}x{im.height} in {BOX}x{BOX}')
