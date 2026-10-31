# Art generator

The farm's art (`public/assets/farm/`) is drawn by code: these Python modules build every tile, crop,
animal, building, prop and icon as SVG, render it with cairo and export PNGs plus `manifest.json`.
New content (crops, animals, buildings for later levels) gets its art here, so it matches the rest.

The `.py` files are the pack's `source/` folder, unchanged. Colours live at the top of each module.

| File | What it draws |
| --- | --- |
| `core.py` | `Canvas` (SVG drawing helpers, isometric projection `P(x, y, z)`, shadows), shared colours |
| `registry.py` | `image(...)` / `sheet(...)`: register an asset for export |
| `tiles.py` | grass, paths, soil, unowned land, overlays, fences and gates |
| `crops.py` | wheat, carrot, corn × 4 growth stages |
| `animals.py` | cow, sheep, chicken sprite sheets |
| `buildings.py` | barn, coop, feed mill, dairy, bakery, weaving hut, farmhouse, market stall, for-sale sign |
| `people.py` | the farmer sprite sheet: idle, sit, walk and one anim per job (plough, plant, harvest, build, feed) |
| `props.py` | trees, bushes, rocks, the pond, hay, crates, sacks, milk can |
| `icons.py` | item icons (egg, milk, … coins) |
| `piles.py` | stock piles for the storage yards: `pile_<kind>_<stage>`, 4 fill stages per pile (granary categories, storehouse materials, the farmhouse's small piles) |
| `seasonal.py` | registers the seasonal versions after everything else: ground and scenery in four seasons (`tiles.build_seasons`, `props.build_seasons`) and every building in winter (`snow.py`) |
| `snow.py` | snow on roofs: a `<name>_winter` twin of every `buildings` sprite, derived from its own pixels |
| `build.py` | exports 2x + 1x PNGs, shadow layers, sprite sheets and `manifest.json` |
| `preview.py`, `scene.py`, `contact.py` | the pack's preview images (not used by the game) |
| `regen.py`, `art.sh` | the repo's wrapper behind `npm run art` (see below) |
| `fonts/` | DejaVu Sans Bold, for the text on the for-sale sign, market stall and coins ([licence](fonts/LICENSE-DejaVu.txt)) |

## Setup

You need Python 3.12 or newer and the cairo library. Nothing else: `npm run art` creates a venv in
`tools/art/.venv` (git-ignored) and installs `requirements.txt` into it on first run.

| | macOS | Debian / Ubuntu |
| --- | --- | --- |
| Python ≥ 3.12 | `brew install python@3.13` | `sudo apt install python3 python3-venv` (24.04+) |
| cairo | `brew install cairo` | `sudo apt install libcairo2` |

If something is missing, `npm run art` stops and says what to install. If the venv was made with an
older Python, delete it (`rm -rf tools/art/.venv`) and run again.

None of this is part of the web build: Vite, `tsc`, ESLint, the tests and CI never touch `tools/art/`.

## Regenerate the art

```bash
npm run art
```

It builds the whole pack into a temp folder outside the repo (`build.py` deletes its output folder
before writing, so never point it at a folder in the repo), then copies into `public/assets/farm/`:

- `1x/**/*.png` and `2x/**/*.png` (sprites, shadow layers, sprite sheets),
- `manifest.json`.

A file whose bytes or pixels are unchanged is not rewritten, so a run with no source changes leaves
`git status` clean. It prints every file it wrote. It deletes nothing: files in `public/assets/farm/`
that the build no longer makes are listed for you to remove by hand. `public/assets/farm/README.md`
(the pack's documentation) is not touched.

The output is reproducible: on a clean checkout every file comes out byte-identical to the committed
art (verified on macOS with Python 3.13 and Homebrew cairo 1.18.4). Two things in `regen.py` make that
hold on any machine without changing the pack's code:

- **Text font.** The sign, stall and coin text asks for "DejaVu Sans" bold. `regen.py` draws it from
  `fonts/DejaVuSans-Bold.ttf` with cairo's FreeType backend and hinting off, the way the committed art
  was made, instead of whatever font (and, on macOS, CoreText rasteriser) the system would pick.
- **Worker processes.** `build.py` fills its registry in `main()` and only forked workers see it, so on
  macOS (which spawns workers) each worker rebuilds the registry itself. All randomness is seeded, so
  every worker gets the same registry.

To run the pack's builder by hand (for the preview images, say), build somewhere outside the repo:
`tools/art/.venv/bin/python tools/art/build.py /tmp/farm-pack`.

## Seasons

Every ground tile (`grass_*`, `unowned_*`, every `path_*` piece, `soil_*`) and every piece of scenery
(`tree_*`, `bush*`, `rock_*`, `pond`) also comes in four versions named `<name>_<season>`
(`grass_1_winter`, `pond_spring`, …), drawn by the same functions with a `season` argument (`None` draws
the original, unchanged). Ground tiles keep the base tile's canvas, so every season sits where the base
does. Buildings only change in winter: `snow.py` lays snow along every top edge of each building sprite
(wavy, at most 50 px deep at 2x and a third of the surface, skipping walls and thin posts) and registers
it as `<name>_winter` with the original shadow. Nothing there names a building, so a new building (or
storage level) gets its snowy roof on the next `npm run art`. The seasonal versions are registered last,
so `manifest.json` only grows at its end.

In the game, `seasonalArt(name, season)` in `src/scenes/art.ts` maps a base sprite to the one to draw, and
`src/scenes/art.test.ts` checks that every seasonal base has all four versions and every building a winter one.

## How the game picks the files up

The game never lists PNG paths. `src/scenes/BootScene.ts` loads `assets/farm/manifest.json`, then loads
every sprite named by `usedArt()` in `src/scenes/art.ts`, at `ART_RES` (`2x`, drawn at half size), with
its shadow layer, anchor and animations straight from the manifest. Item icons in the HTML overlay use
`1x/icons/<id>.png` (`iconUrl` in `art.ts`).

So a new sprite shows up in the game once its **name** is mapped in `src/scenes/art.ts`:

| Pack sprite | Mapped by (in `src/scenes/art.ts`) |
| --- | --- |
| crop stages `<crop>_<n>_<stage>` | `CROP_ART_IDS` → `cropArt(cropId, stage)` |
| item icons `icons/<item id>` | `ICON_ART` → `iconUrl(id)` |
| buildings, props | `TEXTURE_ART` (game texture key → sprite), or the sprite name as the buildable's `texture` |
| animals | `ANIMAL_ART` (sheet + `<animal>_<anim>_<dir>` animations) |
| the farmer | `FARMER_ART` (sheet + `farmer_<anim>_<dir>` animations) |
| scenery on locked land | `SCENERY` |
| stock piles `pile_<kind>_<stage>` | `PILE_ART` → `pileArt(kind, stage)` |

`src/scenes/art.test.ts` fails if a name the game uses is missing from the manifest.

## Worked example: a new crop

Say levels 6+ add **pumpkin**. The art takes three steps in `crops.py`, plus one icon:

1. **Colours.** Put the pumpkin's colours next to the module's shared ones at the top of `crops.py`
   (`LEAF`, `LEAF_D`, `LEAF_L` are the leaf greens every crop uses):

   ```python
   PUMPKIN = "#f28a2e"
   PUMPKIN_D = "#c4561a"
   ```

2. **The four stages.** Write `pumpkin(stage)` like `carrot(stage)`: it returns one `Canvas` per stage,
   `0` seeded, `1` sprout, `2` growing, `3` ripe. Reuse the helpers so it sits on the soil like the
   others: `crop_canvas(top)` (one tile, `top` px of headroom for tall plants), `spots(seed)` (the furrow
   grid, jittered by a fixed seed), `seeded(c, seed_colour)` for stage 0, `sprout(...)` for stage 1,
   `c.P(x, y, z)` to place a point on the tile and `c.shadow_ell(...)` for its shadow.

3. **Register it.** Add it to the loop in `build()`, which calls the registry for each stage:

   ```python
   for nm, fn in (("wheat", wheat), ("carrot", carrot), ("corn", corn), ("pumpkin", pumpkin)):
       for s in range(4):
           image("crops", f"{nm}_{s}_{STAGES[s]}", fn(s), notes=...)
   ```

   That exports `crops/pumpkin_0_seeded.png` … `pumpkin_3_ripe.png` (+ a `_shadow` layer for each stage
   that draws a shadow) in both resolutions, and their manifest entries.

4. **Icon.** For the harvested item, add `pumpkin_icon(c)` to `icons.py` and `"pumpkin": pumpkin_icon`
   to `ICONS`.

Run `npm run art`. It writes the new files plus `manifest.json`; everything else stays unchanged.

The game side, when the crop is actually added: `CROPS` in `src/data/crops.ts` (the crop) and `ITEMS` in
`src/data/items.ts` (its harvest item), then `'pumpkin'` in `CROP_ART_IDS` and `ICON_ART` in
`src/scenes/art.ts` so the stages and the icon are drawn. Until then the new PNGs are in the pack but
nothing loads them.
