"""Add new assets to the pack's manifest, shaped like an existing one, for install_prop.py to fill in.

Usage: python add_asset.py LIKE NAME [NAME ...] [--notes=TEXT]

Each NAME gets a copy of LIKE's manifest entry with its files renamed (`2x/crops/corn_3_ripe.png` →
`2x/crops/potato_3_ripe.png`) and the given notes. A NAME already in the manifest is left as it is, so rerunning
is safe. install_prop.py then copies the fitted images and sets the sizes and anchors.
"""
import copy
import json
import sys

PACK = 'public/assets/farm'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=', 1)[0]: a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--')}
like, names = args[0], args[1:]

path = f'{PACK}/manifest.json'
text = open(path).read()
manifest = json.loads(text)
assets = manifest['assets']
by_name = {a['name']: a for a in assets}
template = by_name[like]
added = []
for name in names:
    if name in by_name:
        continue
    asset = copy.deepcopy(template)
    asset['name'] = name
    asset['notes'] = opt.get('--notes', name)
    for entry in asset['res'].values():
        folder = entry['file'].rsplit('/', 1)[0]
        entry['file'] = f'{folder}/{name}.png'
        entry.pop('shadow', None)
    assets.insert(assets.index(by_name[added[-1]] if added else template) + 1, asset)
    by_name[name] = asset
    added.append(name)
# Same layout as the file had: indent 1, \u escapes, no trailing newline.
open(path, 'w').write(json.dumps(manifest, indent=1) + ('\n' if text.endswith('\n') else ''))
print('added', ', '.join(added) or 'nothing')
