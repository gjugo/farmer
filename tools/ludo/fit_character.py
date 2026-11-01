"""Build the farmer's spritesheet from a Ludo Directional Sprites export (Animation Pack, Individual Frames).

Usage: python fit_character.py FRAMES_DIR OUT_DIR HEIGHT ANIM:DIR=FOLDER ... [--fill=ANIM]

FRAMES_DIR is the unzipped export (one folder of frame_NNN.png per sheet); each ANIM:DIR=FOLDER says which folder
is which animation and direction (se, sw, ne, nw). HEIGHT is the character's height in 2x px. Ludo's pack already
gives every sheet one scale and one ground line, so one scale is used for all frames. Frames are picked evenly
from each Ludo loop to the count the game plays (the manifest's `frames`), scaled, and placed on the game's grid
with the feet on the manifest anchor; a soft shadow is baked under the feet. Animations without a Ludo sheet use
the --fill animation's frames for now. Writes {2x,1x}_farmer.png and prints the manifest values.
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

MANIFEST = 'public/assets/farm/manifest.json'
FW, FH, AX, AY = 164, 156, 82, 126  # the game's 2x frame and ground point
FEET = 8  # 2x px from the ground point down to the lowest toe

frames_dir, out_dir, height = sys.argv[1], sys.argv[2], float(sys.argv[3])
fill = next((a.split('=')[1] for a in sys.argv if a.startswith('--fill=')), 'idle')
sheets = {}
for arg in sys.argv[4:]:
    if not arg.startswith('--'):
        key, folder = arg.split('=')
        sheets[tuple(key.split(':'))] = os.path.join(frames_dir, folder)

def frames(folder):
    return [Image.open(os.path.join(folder, f)).convert('RGBA') for f in sorted(os.listdir(folder)) if f.endswith('.png')]

# One scale for everything, from the first idle frame: Ludo's pack shares one ground line and size.
first = frames(sheets[(fill, 'se')])[0]
top, bottom = first.getbbox()[1], first.getbbox()[3]
scale = height / (bottom - top)
ground = (first.width / 2, bottom - FEET / scale)  # raw ground point: frame centre (pack Snap H), above the toes

asset = next(a for a in json.load(open(MANIFEST))['assets'] if a['name'] == 'farmer')
cols, rows = asset['res']['2x']['columns'], asset['res']['2x']['rows']
sheet = Image.new('RGBA', (cols * FW, rows * FH))

shadow = Image.new('L', (FW, FH), 0)
ImageDraw.Draw(shadow).ellipse((AX - 22, AY - 9, AX + 22, AY + 9), fill=80)
shadow = shadow.filter(ImageFilter.GaussianBlur(3))
shadow_rgba = Image.new('RGBA', (FW, FH), (20, 30, 10, 0))
shadow_rgba.putalpha(shadow)

for an in asset['animations']:
    src = sheets.get((an['anim'], an['dir'])) or sheets[(fill, an['dir'])]
    loop = frames(src)
    n = an['frames']
    for i in range(n):
        im = loop[round(i * len(loop) / n) % len(loop)]
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
        cell = shadow_rgba.copy()
        cell.alpha_composite(im, (round(AX - ground[0] * scale), round(AY - ground[1] * scale)))
        k = an['start'] + i
        sheet.paste(cell, ((k % cols) * FW, (k // cols) * FH))

sheet.save(f'{out_dir}/2x_farmer.png', optimize=True)
sheet.resize((sheet.width // 2, sheet.height // 2), Image.Resampling.LANCZOS).save(f'{out_dir}/1x_farmer.png', optimize=True)
print(f'scale {scale:.4f}; 2x frame {FW}x{FH} anchor {AX},{AY}; 1x frame {FW // 2}x{FH // 2} anchor {AX / 2:g},{AY / 2:g}')
