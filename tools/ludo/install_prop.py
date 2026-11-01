"""Install a prop fitted by fit_prop.py into the pack: copy its PNGs and set its manifest entry.

Usage: python install_prop.py FIT_DIR NAME [AS ...]

Copies FIT_DIR/{2x,1x}_NAME.png over the asset NAME (and each AS, e.g. tree_stump_spring when spring is the summer
image) in public/assets/farm/, and sets w, h, anchor and origin in manifest.json from FIT_DIR/NAME.json, dropping
the separate shadow (fit_prop bakes it in). For a spritesheet it sets frameWidth and frameHeight instead of w and h
(the sheet's columns and rows stay), and the origin is the anchor over the frame size. Every asset must already be
in the manifest.
"""
import json
import shutil
import sys
from PIL import Image

PACK = 'public/assets/farm'
fit_dir, name, targets = sys.argv[1], sys.argv[2], sys.argv[2:]
anchors = json.load(open(f'{fit_dir}/{name}.json'))

path = f'{PACK}/manifest.json'
text = open(path).read()
manifest = json.loads(text)
assets = {a['name']: a for a in manifest['assets']}
for target in targets:
    asset = assets[target]
    for res, (ax, ay) in anchors.items():
        entry = asset['res'][res]
        shutil.copyfile(f'{fit_dir}/{res}_{name}.png', f"{PACK}/{entry['file']}")
        w, h = Image.open(f'{fit_dir}/{res}_{name}.png').size
        if asset['type'] == 'spritesheet':
            w, h = w // entry['columns'], h // entry['rows']
            entry.update(frameWidth=w, frameHeight=h)
        else:
            entry.update(w=w, h=h)
        entry.update(anchor=[float(ax), float(ay)], origin=[round(ax / w, 5), round(ay / h, 5)])
        entry.pop('shadow', None)
    if 'Ludo.ai' not in asset['notes']:
        asset['notes'] += ' (Ludo.ai, cel-shaded; shadow baked in)'
# Same layout as the file had: indent 1, \u escapes, no trailing newline.
open(path, 'w').write(json.dumps(manifest, indent=1) + ('\n' if text.endswith('\n') else ''))
print('installed', ', '.join(targets))
