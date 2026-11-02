# Ludo.ai art

The farm's art is being replaced, asset by asset, with images generated in [Ludo.ai](https://ludo.ai). These
scripts fit Ludo's images onto the game's 2:1 grid and write them into `public/assets/farm/` under the pack's
existing names, so the game code doesn't change. `source/` holds the Ludo images each asset was built from.

**`npm run art` regenerates the whole pack from `tools/art/` and overwrites these files.** Restore them from
git (or rerun the commands below) after running it.

## Done so far

| Asset | Source | Seasons |
| --- | --- | --- |
| `farmhouse`, `farmhouse_winter` | `farmhouse_raw.png`, `farmhouse_winter_raw.png` | all |
| `cottage`, `cottage_winter` | `cottage_raw.png`, `cottage_winter_raw.png` | all |
| `chicken_coop`, `chicken_coop_winter` | `chicken_coop_raw.png`, `chicken_coop_winter_raw.png` | all |
| `bakery`, `bakery_winter` | `bakery_raw.png`, `bakery_winter_raw.png` | all |
| `dairy`, `dairy_winter` | `dairy_raw.png`, `dairy_winter_raw.png` | all |
| `weaving_hut`, `weaving_hut_winter` (the loom) | `weaving_hut_raw.png`, `weaving_hut_winter_raw.png` | all |
| `malthouse`, `brewery`, `tailor`, each with `_winter` | `<name>_raw.png`, `<name>_winter_raw.png`; see **Malthouse, brewery and tailor** below | all |
| `blacksmith`, `blacksmith_winter` | `blacksmith_raw.png`, `blacksmith_winter_raw.png`; see **Blacksmith** below | all |
| `woodcutter_lodge`, `woodcutter_lodge_winter` | `woodcutter_lodge_raw.png`, `woodcutter_lodge_winter_raw.png` | all |
| `quarry`, `quarry_winter` | `quarry_raw.png`, `quarry_winter_raw.png` | all |
| `mine`, `mine_winter` | `mine_raw.png`, `mine_winter_raw.png` | all |
| `for_sale_sign`, `for_sale_sign_winter` | `for_sale_sign_raw.png`, `for_sale_sign_winter_raw.png` | all |
| `well`, `well_winter`, `kennel`, `kennel_winter` (1×1) | `well_raw.png`, `well_winter_raw.png`, `kennel_raw.png`, `kennel_winter_raw.png`; see **Well, kennel, scarecrow and crow** below | all |
| `scarecrow`, `scarecrow_winter` (1×1, no pad) | `scarecrow_raw.png`, `scarecrow_winter_raw.png` | all |
| `crow_0`, `crow_1` (two frames: standing, pecking) | `crow_0_raw.png`, `crow_1_raw.png` | none |
| `granary_1..3`, each with `_winter` | `granary_{1,2,3}_raw.png`, `granary_{1,2,3}_winter_raw.png` | all |
| `storehouse_1..3`, each with `_winter` | `storehouse_{1,2,3}_raw.png`, `storehouse_{1,2,3}_winter_raw.png` | all |
| `feed_mill`, `feed_mill_winter`, `feed_mill_sails` (8 frames), `feed_mill_static`, `feed_mill_static_winter` | `feed_mill_raw.png`, `feed_mill_body_raw.png`, `feed_mill_sails_raw.png`, `feed_mill_winter_raw.png`; see **Feed mill** below | all |
| `farmer` (spritesheet, with his tools and the loads he carries) | see **Farmer** below | all |
| `chicken`, `cow`, `sheep` (spritesheets: idle, walk, eat × SE/SW/NE/NW) | see **Animals** below | all |
| `ox` (spritesheet: idle, walk × SE/SW/NE/NW) | see **Ox and oxcart** below | all |
| `cart_se`, `cart_sw`, `cart_ne`, `cart_nw` (the oxcart, one per facing) | `cart_raw.webp`, `cart_model.glb`, `cart_<dir>_raw.png`; see **Ox and oxcart** below | all (not seasonal) |
| `ox_barn`, `ox_barn_winter` | `ox_barn_raw.png`, `ox_barn_winter_raw.png` | all |
| `grass_0..2`, `path_*` (16), `soil_tilled_x/y`, `soil_watered_x/y`, `unowned_0/1` | `grass_a_raw.png`, `grass_b_raw.png`, `dirt_raw.png`, `soil_raw.png`, `snow_raw.png`, `snow_path_raw.png` | all |
| `tree_oak` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_oak_raw.png`, `tree_oak_{spring,autumn,winter}_raw.png` | all |
| `tree_apple` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_apple_raw.png`, `tree_apple_{spring,autumn,winter}_raw.png` | all |
| `tree_pine` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_pine_raw.png`, `tree_pine_winter_raw.png` (spring and autumn recoloured from summer) | all |
| `tree_stump` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_stump_raw.png`, `tree_stump_winter_raw.png` (spring and autumn are the summer image) | all |
| `rock_small`, `rock_large` (not drawn by the game yet), `outcrop_0..2`, `outcrop_spent` (stone deposits) | `rock_small_raw.png`, `rock_large_raw.png` and their `_winter_raw.png` (outcrops: the large cluster, mirrored, the single boulder, and a small boulder for worked-out) | all |
| `vein_0`, `vein_1`, `vein_spent` (iron deposits; base, `_spring`, `_summer`, `_autumn`, `_winter`) | `vein_raw.png`, `vein_b_raw.png`, `vein_spent_raw.png` and their `_winter_raw.png` (spring to autumn are the base image) | all |
| `bush`, `bush_berry` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `bush_raw.png`, `bush_berry_raw.png`, each with `_{spring,autumn,winter}_raw.png` | all |
| `pond` (base, `_spring`, `_summer`, `_autumn`, `_winter`, frozen) | `pond_raw.png`, `pond_{autumn,winter}_raw.png` (spring and summer are the base image) | all |
| `fence_post`, `fence_<edges>` (16 pieces), `gate_se_nw_closed` | `fence_post_raw.png`, `fence_rail_raw.png`, `fence_gate_raw.png`; see **Fences** below | none (not seasonal) |
| `wheat`, `carrot`, `corn`, `potato`, `barley`, `flax`, `cabbage`, `pumpkin` × `0_seeded`, `1_sprout`, `2_growing`, `3_ripe` (one tile of plants each) | `<crop>_<stage>_raw.png` for sprout to ripe (flax's sprout is its growing image, smaller), `seeded_raw.png` for every crop's seeded stage; see **Crops** below | none, except cabbage |
| `cabbage_<stage>_winter` (frosted, the winter crop) | `cabbage_<stage>_winter_raw.png`, `seeded_winter_raw.png`; see **Crops** below | winter |
| item icons: `egg`, `milk`, `wool`, `feed`, `cheese`, `butter`, `bread`, `cloth`, `malt`, `ale`, `linen`, `clothes`, `tools`, `wheat`, `carrot`, `corn`, `potato`, `barley`, `flax`, `cabbage`, `pumpkin`, `apple`, `wood`, `stone`, `iron`, `manure`, `coins` | `icon_<item>_raw.png`; see **Item icons** below | none (icons don't change) |
| `veg_patch` (base, `_spring`, `_summer`, `_autumn`, `_winter`: bare) | `veg_patch_raw.png`, `veg_patch_{spring,autumn,winter}_raw.png`; see **House gardens** below | all |
| `hen_run`, `hen_run_winter` (the two hens are the `chicken` sheet, drawn by the game) | `hen_run_raw.png`, `hen_run_winter_raw.png` | all |
| `orchard`, `orchard_winter` (the pad; its two trees are `tree_apple` in its seasons, drawn by the game) | `orchard_raw.png`, `orchard_winter_raw.png` | all |
| `pile_<kind>_1..4` for `crops`, `animal`, `feed`, `goods`, `wood`, `stone`, `iron`, `house_goods`, `house_materials` | `pile_<kind>_<n>_raw.png`; see **Stock piles** below | none (piles change with the stock) |
| `trader_wagon`, `trader_wagon_winter` (the travelling trader with his wagon) | `trader_wagon_raw.png`, `trader_wagon_winter_raw.png`; see **Trader's wagon** below | all |

## Generating in Ludo

Image Generator, Art Style **Cel-Shaded**, Perspective **Isometric**, Aspect Ratio **Square**. Image type
**Sprite** for buildings and props (transparent background), **Map Tile** for ground. Generate from
References with an approved asset as the reference, so the style stays the same. Winter versions: Edit Image
on the approved summer image. Ludo always draws a thick soil block under a pad or tile; the scripts cut it off.

## Setup

```bash
python3 -m venv /tmp/ludo-venv && /tmp/ludo-venv/bin/pip install -r tools/ludo/requirements.txt
```

## Buildings: `fit_building.py`

Cuts the soil block below the pad's top surface, optionally mirrors, scales the pad to the footprint (8 px
inset per side at 2x), and prints the anchor for `manifest.json`. Corners are the pad's top-surface left,
right and bottom corners, measured on the raw image (the extreme opaque columns give left and right).
Mirror when the door is on the wrong face: the farmhouse door must face +y (front-left), see `FARMHOUSE_DOOR`.

```bash
P=/tmp/ludo-venv/bin/python; L=tools/ludo
$P $L/fit_building.py $L/source/farmhouse_raw.png /tmp farmhouse 2 2 45 485 754 485 399.5 659 --mirror
$P $L/fit_building.py $L/source/farmhouse_winter_raw.png /tmp farmhouse_winter 2 2 57 609 967 609 512 834 --mirror --keep=-4
```

Later buildings came through the API: `generateWithStyle` with the farmhouse image as `style_image` and the
farmhouse's own prompt reworded for the building (south corner to the viewer, 2:1 angle, straight-edged diamond
pad of N×N tiles with no thickness), then `editImage` on the chosen one for winter ("keep the same ... exactly;
add snow on the roof ..., cover the pad in snow"). The pad corners are the extreme opaque columns, with the
bottom corner where the two 2:1 edges meet; check them on an overlay before fitting.

```bash
$P $L/fit_building.py $L/source/cottage_raw.png /tmp/props cottage 2 2 45 321 754 323 401.5 499.2
$P $L/fit_building.py $L/source/cottage_winter_raw.png /tmp/props cottage_winter 2 2 53 309 739 310 397 481
$P $L/fit_building.py $L/source/chicken_coop_raw.png /tmp/props chicken_coop 3 3 40 349 727 348 382.5 520.2
$P $L/fit_building.py $L/source/chicken_coop_winter_raw.png /tmp/props chicken_coop_winter 3 3 40 348 726 347 382 519
for n in cottage cottage_winter chicken_coop chicken_coop_winter; do $P $L/install_prop.py /tmp/props $n; done
$P $L/fit_building.py $L/source/bakery_raw.png /tmp/props bakery 3 2 43 268 725 354 470 481.5 --pad
$P $L/fit_building.py $L/source/bakery_winter_raw.png /tmp/props bakery_winter 3 2 41 271 724 350 461.5 481.2 --pad
$P $L/fit_building.py $L/source/dairy_raw.png /tmp/props dairy 3 2 43 258 720 285 408.5 440.8 --pad
$P $L/fit_building.py $L/source/dairy_winter_raw.png /tmp/props dairy_winter 3 2 43 257 717 284 407 439 --pad
for n in bakery bakery_winter dairy dairy_winter; do $P $L/install_prop.py /tmp/props $n; done
$P $L/fit_building.py $L/source/weaving_hut_raw.png /tmp/props weaving_hut 2 2 45 396 737 394 389 568
$P $L/fit_building.py $L/source/weaving_hut_winter_raw.png /tmp/props weaving_hut_winter 2 2 53 385 705 383 377 547
$P $L/fit_building.py $L/source/woodcutter_lodge_raw.png /tmp/props woodcutter_lodge 2 2 41 286 773 298 419 475
$P $L/fit_building.py $L/source/woodcutter_lodge_winter_raw.png /tmp/props woodcutter_lodge_winter 2 2 44 278 751 290 409.5 460.8
$P $L/fit_building.py $L/source/quarry_raw.png /tmp/props quarry 2 2 45 286 754 285 398.5 462.8
$P $L/fit_building.py $L/source/quarry_winter_raw.png /tmp/props quarry_winter 2 2 44 288 754 286 397 464.5
$P $L/fit_building.py $L/source/mine_raw.png /tmp/props mine 2 2 39 260 743 258 389 435
$P $L/fit_building.py $L/source/mine_winter_raw.png /tmp/props mine_winter 2 2 43 255 723 255 383 425
# The sign has no pad: fitted as a prop, BASE at the foot of the post (Ludo drew the winter one 4% narrower).
$P $L/fit_prop.py $L/source/for_sale_sign_raw.png /tmp/props for_sale_sign 207 712 0.22 --shadow=28
$P $L/fit_prop.py $L/source/for_sale_sign_winter_raw.png /tmp/props for_sale_sign_winter 198 709 0.22 --shadow=28
for n in weaving_hut woodcutter_lodge quarry mine for_sale_sign; do
  $P $L/install_prop.py /tmp/props $n; $P $L/install_prop.py /tmp/props ${n}_winter
done
```

`python tools/ludo/corners.py RAW.png` prints those corners (L and R from the extreme opaque columns, B where the
two 2:1 edges meet) and writes `RAW_corners.png`, an overlay to check by eye (don't commit it); measure a corner
by hand if eaves or props stick out past it.

**Rectangular pads (3×2).** The x side runs from the left corner to the bottom corner, so for the bakery and dairy
the front-left edge is the 3-tile one. Ludo draws square pads unless told otherwise; asking for "a long, narrow
building, its long wall to the front-left, on a rectangular (not square) pad 3 tiles long by 2 deep, the front-left
edge one and a half times the front-right edge" got rectangles, but never in exactly 3:2 (1.2 to 2.4).
`--pad` re-proportions the pad: it keeps L and R, moves B to where the footprint puts it and stretches each
face's columns to match (each half is an x-scale plus a y-shear, so walls stay vertical). Pick the image that
needs the least of it: the bakery is 1.67:1, the dairy 1.17:1.

The granary and storehouse have a sprite per level. Level 1 came from `generateWithStyle`, with the building on the
back half of the pad and the front half left as an open yard for the stock piles (`SLOTS` in
`src/features/storage/piles.ts`). Levels 2 and 3 are `editImage` on the level below ("keep the same ... exactly, but
make it bigger: add a bay ..."), so each level is the same building grown. A winter image on
the same canvas size as its summer image is fitted with the summer corners, so the two line up exactly.

```bash
$P $L/fit_building.py $L/source/granary_1_raw.png /tmp/props granary_1 2 2 44 397 771 387 397.5 573.8
$P $L/fit_building.py $L/source/granary_1_winter_raw.png /tmp/props granary_1_winter 2 2 45 379 756 369 390.5 551.8
$P $L/fit_building.py $L/source/granary_2_raw.png /tmp/props granary_2 2 2 44 388 755 380 391.5 561.8
$P $L/fit_building.py $L/source/granary_2_winter_raw.png /tmp/props granary_2_winter 2 2 44 388 755 380 391.5 561.8
$P $L/fit_building.py $L/source/granary_3_raw.png /tmp/props granary_3 2 2 53 493 752 485 394.5 663.8
$P $L/fit_building.py $L/source/granary_3_winter_raw.png /tmp/props granary_3_winter 2 2 53 493 752 485 394.5 663.8
$P $L/fit_building.py $L/source/storehouse_1_raw.png /tmp/props storehouse_1 2 2 49 361 739 359 392 532.5
$P $L/fit_building.py $L/source/storehouse_1_winter_raw.png /tmp/props storehouse_1_winter 2 2 43 357 725 355 382 526.5
for n in storehouse_2 storehouse_2_winter storehouse_3 storehouse_3_winter; do
  $P $L/fit_building.py $L/source/${n}_raw.png /tmp/props $n 2 2 38 425 724 425 381 596.5
done
for t in granary storehouse; do for l in 1 2 3; do
  $P $L/install_prop.py /tmp/props ${t}_$l; $P $L/install_prop.py /tmp/props ${t}_${l}_winter
done; done
```

Install with `install_prop.py` (it reads the `NAME.json` the fit writes), or copy `/tmp/2x_<name>.png` and
`/tmp/1x_<name>.png` to `public/assets/farm/{2x,1x}/buildings/<name>.png` and set the asset's `w`, `h`, `anchor`
and `origin` (anchor / size) in `manifest.json` by hand; either way the `shadow` goes (Ludo draws the shadow on
the pad). Some code points into a building's 2x sprite and needs updating with it: the cottage's chimney
(`CHIMNEY_AT` in `src/features/families/index.ts`), the coop's run (`WALK_AREA` in
`src/features/animals/textures.ts`), the bakery's, dairy's and weaving hut's smoke (`SMOKE_AT` in
`src/features/processing/textures.ts`), and the woodcutter's, quarry's and mine's chips and dust (`WORK_AT` in
`src/features/resources/index.ts`, a grid point on the footprint). `--keep=N` is how many px below the pad's edge stay (default 2, the outline);
lower it if bits of the soil outline show. `--box=X0,Y0,X1,Y1` crops the scaled 2x image to that box instead of
its own bounds, so pieces fitted with the same corners share one canvas and anchor.

### Well, kennel, scarecrow and crow

`generateWithStyle`, `sprite`, n=2, one pick each, then one `editImage` for winter ("Winter: keep the same ...
exactly, same shape, size, position, angle and outlines; add a thick layer of snow on the roof ..., and cover the
whole grass pad in white snow"). The well and kennel used `cottage_raw.png` as `style_image`: "A small round stone
farm well with a little pitched wooden shingle roof on two wooden posts, a crank and rope with a wooden bucket ... /
A small wooden dog kennel with a pitched plank roof and a round-arched doorway, with a friendly brown and white farm
dog lying in front of the doorway, ... on a small square grass pad of exactly one tile. Isometric 2:1 view, south
corner of the pad toward the viewer, a straight-edged diamond pad with no thickness ...". The scarecrow used
`for_sale_sign_raw.png` ("a straw-stuffed figure on a single upright wooden pole with a crossbar for its arms,
floppy brown straw hat, patched checked shirt and patched trousers, ... a small tuft of grass at the foot of the
pole ... no ground plate, no soil, no shadow") and is fitted padless like the sign (category `buildings`, so its
winter twin swaps in); its winter edit kept the canvas, so both use one BASE and SCALE. The crow used
`chicken_raw.png` ("a small black crow standing on the ground, wings folded, head up, three-quarter view from
slightly above ..., only the bird, no ground, no shadow"); `crow_1` is `editImage` on it ("the same crow, pecking at
the ground: keep ... legs and feet in exactly the same place and pose, but tip its head and neck down ...").

```bash
$P $L/fit_building.py $L/source/well_raw.png /tmp/props well 1 1 42 405 724 403 381 574.5
$P $L/fit_building.py $L/source/well_winter_raw.png /tmp/props well_winter 1 1 56 388 703 385 376.5 548.2
$P $L/fit_building.py $L/source/kennel_raw.png /tmp/props kennel 1 1 44 346 738 351 396 522
$P $L/fit_building.py $L/source/kennel_winter_raw.png /tmp/props kennel_winter 1 1 51 335 705 339 382 500.5
for s in "" _winter; do $P $L/fit_prop.py $L/source/scarecrow${s}_raw.png /tmp/props scarecrow$s 301 712 0.21 --shadow=28; done
```

The crow frames are not tile-anchored: the anchor is the ground under the feet, and both frames share one canvas
(2x 58×50, anchor 32,44) so swapping them doesn't jump. Ludo re-frames every edit, so each frame has its own feet
point (the middle of the toes, measured on the raw image) and scale (`crow_1`'s keeps the bird's area equal to
`crow_0`'s); the standing crow is about 46 px tall at 2x.

```bash
$P - $L/source /tmp/props <<'EOF'
import json, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
FRAMES = {'crow_0': (442, 655, 0.065), 'crow_1': (428, 592, 0.065 * 1.103)}  # feet x, feet y, raw px -> 2x px
placed = {}
for name, (fx, fy, s) in FRAMES.items():
    im = Image.open(f'{src}/{name}_raw.png').convert('RGBA')
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.LANCZOS)
    bb = im.getbbox()
    placed[name] = (im.crop(bb), fx * s - bb[0], fy * s - bb[1])
left = max(p[1] for p in placed.values()) + 2; up = max(p[2] for p in placed.values()) + 2
right = max(p[0].width - p[1] for p in placed.values()) + 2; down = max(p[0].height - p[2] for p in placed.values()) + 2
ax, ay = 2 * round(left / 2), 2 * round(up / 2)
W, H = 2 * round((ax + right) / 2 + 0.5), 2 * round((ay + down) / 2 + 0.5)
for name, (im, fx, fy) in placed.items():
    c = Image.new('RGBA', (W, H), (0, 0, 0, 0)); c.alpha_composite(im, (round(ax - fx), round(ay - fy)))
    c.save(f'{out}/2x_{name}.png', optimize=True)
    c.resize((W // 2, H // 2), Image.Resampling.LANCZOS).save(f'{out}/1x_{name}.png', optimize=True)
    json.dump({'2x': [ax, ay], '1x': [ax / 2, ay / 2]}, open(f'{out}/{name}.json', 'w'))
EOF
for n in well well_winter scarecrow scarecrow_winter kennel kennel_winter crow_0 crow_1; do
  $P $L/install_prop.py /tmp/props $n
done
```

These eight were new to the pack, so their manifest entries (`footprint` `[1, 1]`; the six buildings in
`buildings/` with category `buildings`, the crows in `props/` with category `props`) were added first with
placeholder sizes, which `install_prop.py` then filled in.

## House gardens

`generateWithStyle` with the Ludo cottage as `style_image`, `sprite`, n=2: "a small family vegetable garden ... a
straight-edged flat diamond pad of 2-by-2 tiles with no thickness: dark tilled soil beds in neat rows ..., leafy green
carrot tops showing orange shoulders, a few round green cabbages and lettuces, and a low woven wattle fence of thin
sticks around the edges of the pad. No building" and "a small backyard hen run ... a tiny wooden hen hut ... on the
back corner of the pad; a low wooden post-and-wire fence runs around the pad's edges ... No chickens". The orchard pad
used the chosen hen run as `style_image`: "an empty small orchard plot ... short green grass ... a low rustic wooden
split-rail fence along the two back edges only; a small wooden ladder ... and a wicker apple basket at the left
corner. The middle of the pad is open grass ... No trees". The seasons are `editImage` on the chosen summer image
("keep the same ... exactly: same pad, same shape, size, position, fence and outlines" + young seedlings and
flowers for spring, golden grass and pumpkins for autumn, bare snowy furrows with the fence kept for winter, snow on
the hut, run and pad for the hen run and orchard). The vegetable patch is seasonal like the ground (`veg_patch_<season>`,
listed in `GARDEN_SEASONAL_ART` in `src/scenes/art.ts`); its spring, summer and autumn entries are in category
`props` so only `veg_patch` counts as a building with a winter twin. The hens (`HEN_AREA`) and the orchard's two
trees (`TREES`, at 0.85 scale) are placed by `src/features/gardens/index.ts`. Edits on the same canvas size as the
summer image are fitted with the summer corners, so the seasons line up; the hen run's winter came back on a
different canvas and has its own.

```bash
$P $L/fit_building.py $L/source/veg_patch_raw.png /tmp/props veg_patch 2 2 42 255 724 254 382 425
for s in spring autumn winter; do
  $P $L/fit_building.py $L/source/veg_patch_${s}_raw.png /tmp/props veg_patch_$s 2 2 42 255 724 254 382 425
done
$P $L/fit_building.py $L/source/hen_run_raw.png /tmp/props hen_run 2 2 41 297 726 296 382.5 467.8
$P $L/fit_building.py $L/source/hen_run_winter_raw.png /tmp/props hen_run_winter 2 2 56 292 704 289 377 452.5
$P $L/fit_building.py $L/source/orchard_raw.png /tmp/props orchard 2 2 43 272 728 272 385.5 443.2
$P $L/fit_building.py $L/source/orchard_winter_raw.png /tmp/props orchard_winter 2 2 43 272 728 272 385.5 443.2
$P $L/install_prop.py /tmp/props veg_patch veg_patch_summer
for n in veg_patch_spring veg_patch_autumn veg_patch_winter hen_run hen_run_winter orchard orchard_winter; do
  $P $L/install_prop.py /tmp/props $n
done
```

### Malthouse, brewery and tailor

`generateWithStyle` (n=4, `sprite`) with a Ludo building of the same footprint as `style_image`: the weaving hut for
the 2×2 malthouse and tailor, the bakery for the 3×2 brewery. The prompts are the hut's and the bakery's reworded:
"... a small farming-game malthouse (a barley malting barn) ... rough grey stone lower walls with timber framing and
pale plaster above, a steep wooden-shingle roof topped by a distinctive square kiln vent: a small pointed louvered
cowl with a thin stone chimney rising beside it, no smoke. A wooden door with two burlap sacks of golden barley ...",
"... a small farming-game village tailor's shop ... cream plaster walls and a red-brown tiled roof, one short brick
chimney with no smoke. A wooden door with a hanging sign shaped like a shirt, a wide shop window showing a dress form
with a blue jacket, and a small wooden rack with folded colourful clothes outside ..." and "... a complete village
brewery ... dark slate-grey roof slopes ... red brick and timber walls. A wide wooden double door on the long wall
with a hanging sign showing a foaming mug of ale, and a stack of three oak barrels beside it. At one end a round copper
brewing kettle housing under a single tall brick chimney, with no smoke ..." (with the bakery's sentences about the
long front-left wall and the 3-by-2 pad). Winter: `editImage` on the chosen one, n=2 ("Keep the same malthouse exactly,
same shape, size, position, camera angle, outlines and colours; add a thick layer of white snow on the roof ..., small
icicles along the eaves, and cover the grass and dirt of the pad in snow ..."); the lighter of the two was picked.
Every winter image came back on its own canvas, so each is fitted with its own corners. About 13 credits in all.

```bash
for n in malthouse malthouse_winter tailor tailor_winter; do $P $L/add_asset.py weaving_hut$([[ $n == *_winter ]] && echo _winter) $n "--notes=$n (Ludo.ai, cel-shaded; shadow baked in)"; done
for n in brewery brewery_winter; do $P $L/add_asset.py bakery$([[ $n == *_winter ]] && echo _winter) $n "--notes=$n (Ludo.ai, cel-shaded; shadow baked in)"; done
$P $L/fit_building.py $L/source/malthouse_raw.png /tmp/props malthouse 2 2 40 465 760 471 406 648
$P $L/fit_building.py $L/source/malthouse_winter_raw.png /tmp/props malthouse_winter 2 2 39 466 759 459 392 642.5
$P $L/fit_building.py $L/source/tailor_raw.png /tmp/props tailor 2 2 43 469 740 476 398.5 646.8
$P $L/fit_building.py $L/source/tailor_winter_raw.png /tmp/props tailor_winter 2 2 41 461 728 467 390.5 635.8
$P $L/fit_building.py $L/source/brewery_raw.png /tmp/props brewery 3 2 43 346 771 412 473 561 --pad
$P $L/fit_building.py $L/source/brewery_winter_raw.png /tmp/props brewery_winter 3 2 60 334 746 400 469 538.5 --pad
for n in malthouse tailor brewery; do $P $L/install_prop.py /tmp/props $n; $P $L/install_prop.py /tmp/props ${n}_winter; done
```

Their chimneys smoke while they work: `SMOKE_AT` in `src/features/processing/textures.ts` (the malthouse's stone
chimney beside the kiln vent, the brewery's and the tailor's brick chimneys).

### Blacksmith

`generateWithStyle` (n=4, `sprite`) with the Ludo tailor (itself in the farmhouse's line: styled on the weaving hut,
styled on the farmhouse; the farmhouse file is not reachable by URL from a private repo) as `style_image`: "A complete,
uncropped isometric view of a small farming-game village blacksmith's forge ... the entire straight-edged diamond pad
of packed dirt with a narrow grass edge, no thickness, a four-cell (2-by-2 tile) footprint. Rough grey stone walls with
dark timber framing and a dark slate roof; one tall square stone forge chimney with no smoke. The front-left wall is an
open-fronted workshop under a timber lean-to roof with a glowing orange forge hearth, and an iron anvil on a wooden
stump stands outside on the pad, with a wooden rack of hammers, shovels and pitchforks beside the door and a small water
trough. Bright saturated colours, dark-brown outlines, flat cel shading, firm two-tone shadows from the upper left, plain
white background." The third (one chimney, the hearth under the lean-to) was picked. Winter: `editImage` on it, n=2
("Winter: keep the same blacksmith's forge exactly, same shape, size, position, camera angle, outlines and colours; add a
thick layer of white snow on the slate roof and the lean-to roof, small icicles along the eaves, a little snow on the
anvil, trough and chimney top, and cover the grass and dirt of the pad in snow. The forge hearth still glows orange.");
the first was picked. Its pad corners match the summer image's within 2 px, but it is fitted with its own. The forge
chimney smokes while it works (`SMOKE_AT`). The tools icon is styled on the Ludo ale icon: "A game item icon: a crossed
iron hammer and a small iron hoe with sturdy wooden handles, forming a bold X, the dark grey iron heads clearly visible,
front three-quarter view ..." (with the icon prompt's usual ending); the second, with the bigger hammer head, reads
better at 24 px. 8 credits in all.

```bash
$P $L/add_asset.py weaving_hut blacksmith "--notes=blacksmith (Ludo.ai, cel-shaded; shadow baked in)"
$P $L/add_asset.py weaving_hut_winter blacksmith_winter "--notes=blacksmith_winter (Ludo.ai, cel-shaded; shadow baked in)"
$P $L/add_asset.py ale tools "--notes=item icon: tools (Ludo.ai, cel-shaded)"
$P $L/fit_building.py $L/source/blacksmith_raw.png /tmp/props blacksmith 2 2 43 406 755 404 397 583
$P $L/fit_building.py $L/source/blacksmith_winter_raw.png /tmp/props blacksmith_winter 2 2 43 405 755 405 399 583
$P $L/fit_icon.py $L/source/icon_tools_raw.png /tmp/props tools
for n in blacksmith blacksmith_winter tools; do $P $L/install_prop.py /tmp/props $n; done
```

## Feed mill: `mill_sails.py`

The placed mill is a body with an 8-frame sails spritesheet over it (`feed_mill_sails_spin`, 10 fps); the build
preview is `feed_mill_static`, the same mill with the sails baked in. All of them come from one Ludo image:

1. `feed_mill_raw.png`: `generateWithStyle` (farmhouse as `style_image`, `sprite`), a windmill on a 2×2 pad with
   four sails flat on the front-right wall, clear of the door.
2. `feed_mill_body_raw.png`: `editImage` with a mask over the sails and `mask_mode: "erase"` (a `"replace"` edit
   drew the sails back in). Erasing also redrew the hub, so the frames carry the hub instead.
3. `feed_mill_winter_raw.png`: `editImage` on the body ("keep the same mill exactly ...; add snow on the cap and
   roof, cover the pad in snow"). Its pad corners match the body's within 1 px, so it is fitted with the same box.
4. `mill_sails.py` writes `feed_mill_sails_raw.png` (the pixels inside the blade quads where the whole mill and the
   body differ). It then takes the front-right blade (the one drawn over empty background), un-projects it from the
   wall's 2:1 plane to face-on, turns it about the hub, and projects it back, four times 90° apart, for 8 steps of
   11.25°. The four blades are identical, so the 8th step would be frame 0 again and the loop has no jump. The hub,
   cut from the whole mill, goes on top of each frame. The body, the winter body and every frame are fitted with
   the pad corners (`fit_building.fit`) and cropped to one shared box. `feed_mill_static(_winter)` is the body
   (winter body) plus frame 0, so the preview and the stopped placed mill are the same picture.

```bash
$P $L/mill_sails.py /tmp/props
for n in feed_mill feed_mill_winter feed_mill_static feed_mill_static_winter feed_mill_sails; do
  $P $L/install_prop.py /tmp/props $n
done
```

`install_prop.py` sets a spritesheet's `frameWidth`/`frameHeight` (its columns and rows stay) and keeps its
animations. The corners (`CORNERS`), the hub and the blade quads are constants at the top of `mill_sails.py`. The
sails have no seasonal versions.

## Props: `fit_prop.py`

```bash
mkdir -p /tmp/props
for s in "" _spring _autumn _winter; do
  $P $L/fit_prop.py $L/source/tree_oak${s}_raw.png /tmp/props tree_oak$s 512 795 0.33 --shadow=44
done
for s in "" _spring _autumn _winter; do
  $P $L/fit_prop.py $L/source/tree_apple${s}_raw.png /tmp/props tree_apple$s 516 722 0.36 --shadow=40
done
for s in "" _winter; do
  $P $L/fit_prop.py $L/source/tree_pine${s}_raw.png /tmp/props tree_pine$s 513 868 0.36 --shadow=34
done
$P $L/fit_prop.py $L/source/tree_pine_raw.png /tmp/props tree_pine_spring 513 868 0.36 --shadow=34 --leaves=-5,1.05,1.1
$P $L/fit_prop.py $L/source/tree_pine_raw.png /tmp/props tree_pine_autumn 513 868 0.36 --shadow=34 --leaves=-3,0.85,0.9
for s in "" _winter; do
  $P $L/fit_prop.py $L/source/tree_stump${s}_raw.png /tmp/props tree_stump$s 512 640 0.15 --shadow=50
done
for s in "" _winter; do
  $P $L/fit_prop.py $L/source/rock_large${s}_raw.png /tmp/props rock_large$s 513 690 0.21 --shadow=60
  $P $L/fit_prop.py $L/source/rock_small${s}_raw.png /tmp/props rock_small$s 512 650 0.19 --shadow=30
  $P $L/fit_prop.py $L/source/rock_large${s}_raw.png /tmp/props outcrop_0$s 513 690 0.25 --shadow=72
  $P $L/fit_prop.py $L/source/rock_large${s}_raw.png /tmp/props outcrop_1$s 513 690 0.25 --shadow=72 --mirror
  $P $L/fit_prop.py $L/source/rock_small${s}_raw.png /tmp/props outcrop_2$s 512 650 0.38 --shadow=56
  $P $L/fit_prop.py $L/source/rock_small${s}_raw.png /tmp/props outcrop_spent$s 512 650 0.16 --shadow=26 --mirror
done
# Install: the base image also goes in as every season Ludo didn't draw.
for n in tree_oak tree_apple tree_pine; do
  $P $L/install_prop.py /tmp/props $n ${n}_summer
  for s in _spring _autumn _winter; do $P $L/install_prop.py /tmp/props $n$s; done
done
for n in tree_stump rock_large rock_small outcrop_0 outcrop_1 outcrop_2 outcrop_spent; do
  $P $L/install_prop.py /tmp/props $n ${n}_spring ${n}_summer ${n}_autumn
  $P $L/install_prop.py /tmp/props ${n}_winter
done
```

BASE (`512 795` for the oak) is the point the prop stands on, measured on the raw image (the middle of the trunk's root flare);
it lands on the tile's centre. SCALE is raw px to 2x px. Generate the other seasons with Edit Image so they line up
with the summer image, and fit them all with the same BASE and SCALE. `--shadow=RX` bakes a soft oval shadow
under the base (Ludo draws none). `--leaves=HUE,SAT,VAL` recolours only the green pixels, for a season
Ludo needn't draw (the pine's spring and autumn). `install_prop.py` copies a fitted prop over its pack files and sets `w`, `h`, `anchor` and `origin` in
`manifest.json` (dropping `shadow`); extra names install the same image as other seasons. `--mirror` flips the
image, for a second variant from one Ludo image.

### Iron veins, bushes and the pond

Generated with `generateWithStyle` (the Ludo boulder cluster behind `rock_large_raw.png` as `style_image`, `sprite`,
n=4): "a low cluster of two or three dark charcoal-black rocks with bright rusty-orange iron ore streaks ... clearly
darker and redder than grey stone", "a small round leafy green shrub bush ...", the same "... dotted with many bright
red berries", and "a flat ground decal ... a small oval pond of calm blue water, twice as wide as it is tall, with a
narrow rim of green grass ... no soil block, no thickness". `vein_0` and `vein_1` are two different results. The
other images are `editImage` on the chosen one ("keep the same ... exactly, same shape, size, position and outlines;
..."): snow for the veins' winter, "a low worked-out pile of small broken dark rock rubble" for `vein_spent` (then
snow on that for its winter), blossom for the bushes' spring, turned leaves for autumn, snow for winter, and for the
pond golden grass and floating leaves in autumn and frozen ice under snow in winter. Ludo drew
`vein_b_winter_raw.png` 3% smaller on a narrower canvas, so its BASE and SCALE are the summer ones mapped by the
rocks' bounds. The pond has no shadow: it is flat on the tile.

```bash
for s in "" _winter; do $P $L/fit_prop.py $L/source/vein${s}_raw.png /tmp/props vein_0$s 383 325 0.27 --shadow=70; done
$P $L/fit_prop.py $L/source/vein_b_raw.png /tmp/props vein_1 392 350 0.27 --shadow=70
$P $L/fit_prop.py $L/source/vein_b_winter_raw.png /tmp/props vein_1_winter 385.5 330.6 0.2784 --shadow=70
for s in "" _winter; do $P $L/fit_prop.py $L/source/vein_spent${s}_raw.png /tmp/props vein_spent$s 394 300 0.17 --shadow=44; done
for s in "" _spring _autumn _winter; do
  $P $L/fit_prop.py $L/source/bush${s}_raw.png /tmp/props bush$s 383 422 0.175 --shadow=46
  $P $L/fit_prop.py $L/source/bush_berry${s}_raw.png /tmp/props bush_berry$s 384 418 0.175 --shadow=46
done
for s in "" _autumn _winter; do $P $L/fit_prop.py $L/source/pond${s}_raw.png /tmp/props pond$s 384 224 0.25; done
for n in vein_0 vein_1 vein_spent; do
  $P $L/install_prop.py /tmp/props $n ${n}_spring ${n}_summer ${n}_autumn; $P $L/install_prop.py /tmp/props ${n}_winter
done
for n in bush bush_berry; do
  $P $L/install_prop.py /tmp/props $n ${n}_summer
  for s in _spring _autumn _winter; do $P $L/install_prop.py /tmp/props $n$s; done
done
$P $L/install_prop.py /tmp/props pond pond_spring pond_summer
for s in _autumn _winter; do $P $L/install_prop.py /tmp/props pond$s; done
```

## Fences: `fences.py`

The pasture fence is composed, not fitted: one Ludo post (`fence_post_raw.png`, `generateWithStyle` with the tree
stump as `style_image`: "a single upright square wooden fence post ... corner facing the viewer"), one rail section
(`fence_rail_raw.png`: "a straight section of rustic wooden pasture fence seen exactly from the side, perfectly
horizontal ... two long parallel horizontal split-wood rails, no posts") and a gate (`fence_gate_raw.png`:
`editImage` on the rails, "turn these two rails into a closed wooden farm gate of the same length ... a vertical board
at each end and one diagonal brace"). `fences.py` shears the side-on rails onto the 2:1 grid (mirrored for the y
direction) and builds each piece as a post on the tile centre with a half-rail to the middle of every edge it names.
The rail texture wraps every tile length and is sampled by screen x, so neighbouring pieces join with no seam; rails
going back (ne, nw) are drawn behind the post and rails coming forward (se, sw) in front. The gate spans the tile
along x between posts on its nw and se edges. A soft ground shadow is baked under rails and posts. Heights (post,
rails, gate) are constants at the top of the script.

```bash
$P $L/fences.py $L/source/fence_post_raw.png $L/source/fence_rail_raw.png $L/source/fence_gate_raw.png /tmp/props
for n in post ne se ne_se sw ne_sw se_sw ne_se_sw nw ne_nw se_nw ne_se_nw sw_nw ne_sw_nw se_sw_nw ne_se_sw_nw; do
  $P $L/install_prop.py /tmp/props fence_$n
done
$P $L/install_prop.py /tmp/props gate_se_nw_closed
```

The gate's other versions (`gate_se_nw_open`, `gate_ne_sw_*`) are not drawn by the game and stay as they were.

## Crops: `fit_crop.py`

A crop stage is one tile's worth of plants, drawn over the field's own tilled soil (`cropArt` in
`src/scenes/art.ts`), so the sprite is plants only. Each source is a **single plant** on a transparent background,
and `fit_crop.py` plants it in rows along world x, on the furrows of `soil_tilled_x`, evenly spaced across the
soil bed. The rows of neighbouring tiles and fields carry on at the same spacing, and nothing but the stems'
height leaves the tile. One crop's stages share ROWS, PER_ROW and `--seed`, so each plant grows at the same spot.

1. Ripe: `generateWithStyle` with a farmhouse-styled Ludo building (the feed mill) as `style_image`, `sprite`,
   n=4: "a single small clump of ripe golden wheat ... / a single ripe carrot plant ... with the round orange
   shoulder of the carrot root showing / a single ripe corn plant ... two yellow corn cobs in pale green husks ...
   a golden tassel; only the plant: no soil, no ground, no mound, no pot, no shadow; cel-shaded with a dark brown
   outline, top-left light".
2. Growing and sprout: `editImage` on the ripe image, n=2 ("keep the same plant in the same place with its base at
   the same point ... but make it young: half as tall, all green ..." / "replace the ... with a tiny young sprout at
   the same base point ...").
3. Seeded: `editImage` on the ripe wheat ("replace the whole plant with a tiny low mound of dark brown earth with
   three golden grains"). All three crops use it: seeds look alike, and the crop shows from the sprout on.

Ludo's edits come out paler than the ripe image, so `--color`/`--bright` lift them, and `--widen` thickens a thin
young stalk so it reads at game zoom.

```bash
f() { $P $L/fit_crop.py "$@"; }
f $L/source/seeded_raw.png /tmp/props wheat_0_seeded 14 4 4 --seed=1 --bright=1.15
f $L/source/wheat_1_sprout_raw.png /tmp/props wheat_1_sprout 24 4 4 --seed=1 --shadow=5 --color=1.3 --widen=1.3
f $L/source/wheat_2_growing_raw.png /tmp/props wheat_2_growing 42 4 4 --seed=1 --shadow=7 --color=1.3
f $L/source/wheat_3_ripe_raw.png /tmp/props wheat_3_ripe 54 4 4 --seed=1 --shadow=8 --color=1.15 --bright=1.12
f $L/source/seeded_raw.png /tmp/props carrot_0_seeded 14 4 4 --seed=2 --bright=1.15
f $L/source/carrot_1_sprout_raw.png /tmp/props carrot_1_sprout 18 4 4 --seed=2 --shadow=5 --color=1.3
f $L/source/carrot_2_growing_raw.png /tmp/props carrot_2_growing 28 4 4 --seed=2 --shadow=7 --color=1.4 --widen=1.15
f $L/source/carrot_3_ripe_raw.png /tmp/props carrot_3_ripe 34 4 4 --seed=2 --shadow=9
f $L/source/seeded_raw.png /tmp/props corn_0_seeded 14 3 3 --seed=3 --bright=1.15
f $L/source/corn_1_sprout_raw.png /tmp/props corn_1_sprout 24 3 3 --seed=3 --shadow=6 --color=1.4
f $L/source/corn_2_growing_raw.png /tmp/props corn_2_growing 62 3 3 --seed=3 --shadow=8 --color=1.5 --bright=1.1 --widen=1.5
f $L/source/corn_3_ripe_raw.png /tmp/props corn_3_ripe 100 3 3 --seed=3 --shadow=8
for c in wheat carrot corn; do for s in 0_seeded 1_sprout 2_growing 3_ripe; do
  $P $L/install_prop.py /tmp/props ${c}_$s
done; done
```

### Potato, barley, flax, cabbage and pumpkin

The same way, with the ripe carrot Ludo image as `style_image` for the ripe stage ("a single ripe potato plant: a
bushy low clump of broad dark green leaves with a few small white-and-yellow potato flowers on top, two round brown
potatoes peeking out at the foot / ... ripe pale golden barley ... long drooping bearded ears with long whiskery awns,
paler ... than wheat / ... flowering flax: several thin tall green stalks ... topped with many small bright sky-blue
five-petal flax flowers / ... one round firm pale-green cabbage head wrapped in a few broad darker green outer leaves /
... one round ribbed bright orange pumpkin ... among a few big broad green pumpkin leaves and a curly vine tendril; only
the plant: ..."), then `editImage` for growing and sprout as above. Flax's own sprout was too thin to read, so its
growing image is fitted small instead. Cabbage stands in the field in winter, so each of its stages has a `_winter`
version (`WINTER_CROP_ART_IDS` in `src/scenes/art.ts`): `editImage` on the chosen stage ("keep the same ... exactly,
same shape, size, position and outlines; add a cap of white snow ... with a pale blue frost on the leaf edges"), and
for the seeded stage the same on `seeded_raw.png`. `add_asset.py LIKE NAME ...` first adds manifest entries for new
names, shaped like an existing asset (rerunning it changes nothing), so `install_prop.py` can fill them in.

```bash
for c in potato barley flax cabbage pumpkin; do for s in 0_seeded 1_sprout 2_growing 3_ripe; do
  $P $L/add_asset.py corn_3_ripe ${c}_$s "--notes=$c stage ${s#?_} ($s); place on a soil tile at the same tile coords, drawn above it (Ludo.ai, cel-shaded; shadow baked in)"
done; done
for s in 0_seeded 1_sprout 2_growing 3_ripe; do
  $P $L/add_asset.py cabbage_$s cabbage_${s}_winter "--notes=cabbage stage $s in winter, frosted (Ludo.ai, cel-shaded; shadow baked in)"
done
f $L/source/seeded_raw.png /tmp/props potato_0_seeded 14 3 3 --seed=4 --bright=1.15
f $L/source/potato_1_sprout_raw.png /tmp/props potato_1_sprout 20 3 3 --seed=4 --shadow=5 --color=1.3
f $L/source/potato_2_growing_raw.png /tmp/props potato_2_growing 30 3 3 --seed=4 --shadow=7 --color=1.3
f $L/source/potato_3_ripe_raw.png /tmp/props potato_3_ripe 40 3 3 --seed=4 --shadow=9
f $L/source/seeded_raw.png /tmp/props barley_0_seeded 14 4 4 --seed=5 --bright=1.15
f $L/source/barley_1_sprout_raw.png /tmp/props barley_1_sprout 22 4 4 --seed=5 --shadow=5 --color=1.3 --widen=1.3
f $L/source/barley_2_growing_raw.png /tmp/props barley_2_growing 40 4 4 --seed=5 --shadow=7 --color=1.25 --widen=1.5
f $L/source/barley_3_ripe_raw.png /tmp/props barley_3_ripe 52 4 4 --seed=5 --shadow=8 --color=1.1 --bright=1.08
f $L/source/seeded_raw.png /tmp/props flax_0_seeded 14 4 4 --seed=6 --bright=1.15
f $L/source/flax_2_growing_raw.png /tmp/props flax_1_sprout 18 4 4 --seed=6 --shadow=5 --color=1.5 --bright=1.1 --widen=1.4
f $L/source/flax_2_growing_raw.png /tmp/props flax_2_growing 36 4 4 --seed=6 --shadow=7 --color=1.4 --widen=1.3
f $L/source/flax_3_ripe_raw.png /tmp/props flax_3_ripe 48 4 4 --seed=6 --shadow=8 --color=1.15
for s in "" _winter; do
  f $L/source/seeded${s}_raw.png /tmp/props cabbage_0_seeded$s 14 3 3 --seed=7 --bright=1.15
  f $L/source/cabbage_1_sprout${s}_raw.png /tmp/props cabbage_1_sprout$s 16 3 3 --seed=7 --shadow=6 --color=1.3
  f $L/source/cabbage_2_growing${s}_raw.png /tmp/props cabbage_2_growing$s 26 3 3 --seed=7 --shadow=9 --color=1.25
  f $L/source/cabbage_3_ripe${s}_raw.png /tmp/props cabbage_3_ripe$s 32 3 3 --seed=7 --shadow=11
done
f $L/source/seeded_raw.png /tmp/props pumpkin_0_seeded 14 2 2 --seed=8 --bright=1.15
f $L/source/pumpkin_1_sprout_raw.png /tmp/props pumpkin_1_sprout 22 2 2 --seed=8 --shadow=7 --color=1.3
f $L/source/pumpkin_2_growing_raw.png /tmp/props pumpkin_2_growing 44 2 2 --seed=8 --shadow=10 --color=1.2
f $L/source/pumpkin_3_ripe_raw.png /tmp/props pumpkin_3_ripe 54 2 2 --seed=8 --shadow=12
for c in potato barley flax cabbage pumpkin; do for s in 0_seeded 1_sprout 2_growing 3_ripe; do
  $P $L/install_prop.py /tmp/props ${c}_$s
done; done
for s in 0_seeded 1_sprout 2_growing 3_ripe; do $P $L/install_prop.py /tmp/props cabbage_${s}_winter; done
```

HEIGHT is the plant's height in 2x px (corn ripe stands about as tall as the pack's corn). The anchor is the
tile's top corner, as for every crop sprite, so field depth and clicking are unchanged; `install_prop.py` drops
the old `_shadow` layer (the fit bakes a small contact shadow under each plant).

## Item icons: `fit_icon.py`

The icons show in the HTML overlay at about 24 px (`iconUrl`, the 1x files) and in the canvas (the bubbles over
workshops and resource buildings). Each source is `generateWithStyle` with the Ludo farmer (the Image Generator
image `farmer_raw.png` came from) as `style_image`, `sprite`, n=2, one pick each: "A game item icon: a single
large brown hen's egg ... / a small steel farm milk churn ... / a fluffy round bundle of raw cream-white sheep's
wool ... / a plump burlap sack of animal feed ... / a round wheel of yellow cheese with a wedge cut out ... / a
pale yellow block of butter ... on a small round wooden board / a golden-brown crusty loaf ... / a bolt of woven
blue cloth ... / a sheaf of ripe golden wheat ... / a fat orange carrot with a bushy green top ... / a ripe ear of
yellow corn with its husks peeled back / a single shiny ripe red apple with a short brown stem and one green leaf (with the egg icon as `style_image`) / a small stack of three chopped logs ... / two chunky grey cut stone
blocks ... / three dark blue-grey iron ingots ... / a small wooden bucket filled with dark brown manure ... / a
small stack of shiny gold coins ... / two plump round brown potatoes ... / a small tied bundle of pale straw-yellow
barley ears with long whiskery bristly awns ... tied with a green band / a tied bundle of harvested flax stems ... a few
bright sky-blue flax flowers at the top, tied with twine / one round fresh green cabbage head ... / one round ribbed
bright orange pumpkin with a short brown curly stem and a small green leaf ...; front three-quarter view. Bold simple silhouette that reads at small size,
chunky shapes, cozy cartoon style with soft cel shading and a thick dark brown outline, lit from the top left.
Only the item, centered; no ground, no shadow, no text, no frame."

`fit_icon.py` trims the item and centres it in the 256 px box with the same padding for every icon (14 px at
2x), so each reads at the same size in the overlay's square `object-fit: contain` slot; the anchor is the box's
centre. Check them at 24 px before installing.

The new crops' icons (potato to pumpkin) were styled on the Ludo carrot icon instead, and need manifest entries
first (`add_asset.py corn <name> "--notes=item icon: <name> (Ludo.ai, cel-shaded)"`). The chain goods' icons were
styled on the Ludo pumpkin icon: "a small open burlap sack overflowing with golden-brown roasted malted barley grains,
a little heap of grains spilling in front / a chunky wooden tankard mug with metal bands, full of amber ale with a big
white foam head spilling over the rim / a neatly folded stack of three pale natural beige linen fabric sheets tied with
a thin twine bow, a small sprig of blue flax flowers tucked under the twine / a simple bright red long-sleeved peasant
tunic shirt with a laced collar and wooden buttons, laid flat ..." (manifest entries: `add_asset.py cloth <name> ...`).

```bash
for n in egg milk wool feed cheese butter bread cloth malt ale linen clothes tools wheat carrot corn potato barley flax cabbage pumpkin apple wood stone iron manure coins; do
  $P $L/fit_icon.py $L/source/icon_${n}_raw.png /tmp/props $n && $P $L/install_prop.py /tmp/props $n
done
```

## Stock piles

The piles in the yards (`src/features/storage/piles.ts`) show the stock in four fill stages. Each kind is one
Ludo pile drawn full, then made smaller:

1. Stage 4: `generateWithStyle` with the Ludo feed mill (itself styled on the farmhouse) as `style_image`,
   `sprite`, n=2: "A small farmyard stock pile seen in 2:1 isometric view from above, south corner toward the
   viewer: three plump burlap grain sacks ..., a heap of orange carrots ... and a few yellow corn cobs ... / a
   wicker basket full of brown eggs, two steel milk churns and a ... bale of raw sheep's wool / a stack of six
   ... feed sacks / ... cheese wheels, ... bread loaves and two bolts of woven blue cloth / a neat stack of
   chopped wooden logs / ... grey cut stone blocks / a ... criss-cross stack of ... iron ingot bars / two wooden
   food crates, one holding carrots and one holding eggs, beside a burlap grain sack and a round cheese wheel /
   three chopped wooden logs ... and three chunky grey cut stone blocks; ... Only the pile, standing directly on
   nothing: no soil, no ground, no pad, no platform, no base, no shadow. Cel-shaded with a dark brown outline,
   top-left light." The items match the icons.
2. Stages 3, 2 and 1: `editImage` on stage 4 ("The same pile, but about three quarters / half / only about a
   quarter as big: ..., keep the same art style, colours, outline, viewing angle and item size exactly").

Ludo frames every edit to fill its canvas, so a one-sack pile comes back as big as the full one. Each stage is
therefore fitted with its own SCALE, chosen so its items are the same size as stage 4's; BASE is the middle of
the pile's footprint (the centre of its opaque box across, a quarter of its width above its lowest point), which
lands on the tile's centre. `--shadow` bakes a soft contact shadow, so the old `_shadow` layers are gone.

```bash
while read n bx by s sh; do
  $P $L/fit_prop.py $L/source/${n}_raw.png /tmp/props $n $bx $by $s $sh && $P $L/install_prop.py /tmp/props $n
done <<'EOF'
pile_crops_1 390 382 0.1316 --shadow=29
pile_crops_2 388 350 0.1547 --shadow=39
pile_crops_3 395 354 0.1782 --shadow=44
pile_crops_4 384 362 0.1703 --shadow=49
pile_animal_1 382 451 0.1339 --shadow=34
pile_animal_2 380 544 0.1565 --shadow=42
pile_animal_3 384 522 0.1746 --shadow=51
pile_animal_4 384 522 0.1800 --shadow=52
pile_feed_1 382 508 0.0887 --shadow=19
pile_feed_2 387 414 0.1199 --shadow=31
pile_feed_3 380 497 0.1513 --shadow=41
pile_feed_4 384 509 0.1520 --shadow=44
pile_goods_1 385 330 0.1319 --shadow=23
pile_goods_2 380 272 0.1207 --shadow=33
pile_goods_3 407 354 0.1829 --shadow=46
pile_goods_4 384 347 0.1887 --shadow=55
pile_wood_1 376 283 0.1426 --shadow=35
pile_wood_2 406 288 0.1725 --shadow=50
pile_wood_3 368 310 0.2016 --shadow=54
pile_wood_4 384 329 0.2044 --shadow=59
pile_stone_1 383 372 0.1152 --shadow=24
pile_stone_2 362 368 0.1611 --shadow=40
pile_stone_3 384 378 0.1639 --shadow=42
pile_stone_4 384 442 0.1628 --shadow=47
pile_iron_1 379 353 0.1225 --shadow=33
pile_iron_2 374 416 0.1483 --shadow=40
pile_iron_3 407 442 0.1605 --shadow=43
pile_iron_4 394 443 0.1616 --shadow=47
pile_house_goods_1 386 385 0.0784 --shadow=14
pile_house_goods_2 391 366 0.1079 --shadow=26
pile_house_goods_3 392 299 0.1178 --shadow=33
pile_house_goods_4 390 378 0.1268 --shadow=36
pile_house_materials_1 384 292 0.0888 --shadow=20
pile_house_materials_2 378 318 0.1088 --shadow=28
pile_house_materials_3 388 343 0.1235 --shadow=34
pile_house_materials_4 384 332 0.1376 --shadow=39
EOF
```

Full piles are about as big as the old ones (2x: `pile_wood_4` 156×107), so the granary and storehouse
`SLOTS` stay; the farmhouse's two slots moved apart a little so its piles don't touch.

## Farmer: `fit_character.py`

Made in Directional Sprites: the Image Generator farmer (`farmer_raw.png`) as the character, Cartoon style, views
NE/SE/SW/NW at Isometric height, horizontal travel off; exported as an Animation Pack of Individual Frames
(`source/farmer_frames/`, one folder per sheet, numbered by Ludo; check each folder's direction by eye).

The work and sit animations came later, through the API (`createDirectionalSprites`) from the same rigged model
(`source/farmer_model.glb`, gzipped GLB): style `cel_cartoon` at its defaults, `isometric`, directions
NE/SE/SW/NW, `target_frame_size` 512, `num_frames` 16. One 4x4 sheet per animation and direction is in
`source/farmer_sheets/`; Ludo's direction names are the game's facings. Sit is the bare model:

| game anim | Ludo preset | sheets |
|---|---|---|
| sit | `groundsit_idle_loop_quaternius` | `groundsit_*` |

`chairsit_*` (`sitting_idle_loop_quaternius`) is unused: the Ludo farmhouse has no bench, so a chair pose floats.

### Tools

Every job has its own animation (`WORK_ANIM` in `src/scenes/art.ts`), and in each the farmer holds the tool for it.
A tool is a Ludo 3D prop: `generateWithStyle` with `farmer_raw.png` as the style ("<the tool>, a single game prop
seen from the side, the whole object, upright, centred, nothing else", image type `sprite`), then `create3DModel`
with model `prop`, `target_num_faces` 6000, `texture_size` 1024 and no rig. The images are `source/tools/*_raw.webp`
and the models `source/tools/*.glb` (gzipped). `attach_tool.py` binds a tool into the farmer's skinned mesh,
weighted fully to a hand bone, so it follows the hand through any preset; the farmer himself is unchanged. (Ludo's
renderer drops a node merely parented to the bone, so the tool has to be part of the skinned mesh.) Each grip was
tuned with `previewDirectionalSprites` (free) before rendering.

| game anim | tool | hand | Ludo preset | sheets |
|---|---|---|---|---|
| plough | hoe | right | `mining_loop_quaternius` | `plough_*` |
| plant | seed bag | left | `farm_plantseed_quaternius` | `plant_*` |
| harvest | sickle | right | `farm_harvest_quaternius` | `harvest_*` |
| collect | basket | left | `pickup_kneeling_quaternius` | `collect_*` |
| feed | feed bucket | left | `farm_scatteringseeds_quaternius` | `feed_*` |
| fertilise | pitchfork | right | `mining_loop_quaternius` | `fertilise_*` |
| load | sack, by its neck | right | `pick_up_waist` | `load_*` |
| build | hammer | right | `treechopping_loop_quaternius` | `build_*` |
| chop | axe | right | `treechopping_loop_quaternius` | `chop_*` |
| quarry, mine | pickaxe | right | `mining_loop_quaternius` | `quarry_*` (mine plays the same frames) |

Build uses the chop swing: Repair Kneeling (`fixing_kneeling_quaternius`) hides the hammer under the hat at game size.
The sack hangs from one hand: shared between both hands (`--bone=L_Wrist+R_Wrist`) it sank into his belly.

```bash
gunzip -c $L/source/farmer_model.glb > /tmp/farmer.glb; mkdir -p /tmp/rig
T=$L/source/tools; A=($P $L/attach_tool.py /tmp/farmer.glb)
"${A[@]}" /tmp/rig/plough.glb $T/hoe.glb --length=0.6 --grip=0.3 --thick=1.6 --spin=-90 --rot=90,0,0
"${A[@]}" /tmp/rig/plant.glb $T/seed_bag.glb --bone=L_Wrist --up=y --length=0.24 --grip=0.9 --at=0,-0.02,0
"${A[@]}" /tmp/rig/harvest.glb $T/sickle.glb --length=0.4 --grip=0.12 --thick=1.2 --rot=90,0,0
"${A[@]}" /tmp/rig/collect.glb $T/basket.glb --bone=L_Wrist --up=y --length=0.28 --grip=1.0 --at=0,-0.03,0
"${A[@]}" /tmp/rig/feed.glb $T/bucket.glb --bone=L_Wrist --up=y --length=0.22 --grip=1.0 --at=0,-0.03,0
"${A[@]}" /tmp/rig/fertilise.glb $T/pitchfork.glb --length=0.75 --grip=0.35 --thick=2 --rot=90,0,0
"${A[@]}" /tmp/rig/load.glb $T/sack.glb --up=y --length=0.34 --grip=0.95 --at=0,-0.02,0
"${A[@]}" /tmp/rig/build.glb $T/hammer.glb --length=0.36 --grip=0.2 --thick=1.3 --rot=90,0,0
"${A[@]}" /tmp/rig/chop.glb $T/axe.glb --length=0.5 --grip=0.25 --thick=1.3 --rot=90,0,0
"${A[@]}" /tmp/rig/quarry.glb $T/pickaxe.glb --length=0.55 --grip=0.3 --thick=1.3 --rot=90,0,0
```

Then render each `/tmp/rig/<anim>.glb` with `createDirectionalSprites` (base64 `model`, the preset from the table,
the settings above) and save each sheet as `source/farmer_sheets/<anim>_<dir>.webp`. A 10 MB GLB is too big to paste
into an MCP call as base64; post the same `tools/call` to `https://mcp.ludo.ai/mcp` from a script instead.

### Carrying

Walking out to the work or home from it, the farmer carries what the job moves (`CARRY` in `src/scenes/art.ts`):
each load has its own walk, `carry_<load>`. The loads are props like the tools: the sack, basket and bucket are the
tools' own models; the log bundle and the stone block are new (`generateWithStyle` with `farmer_raw.png`: "A bundle of
four short chopped wooden logs tied together with a rope, a single game prop seen from the side, the whole object,
lying horizontally, centred, nothing else" / "A single chunky rough-cut grey stone block, a quarried building stone
with chiselled edges, a single game prop, the whole object, centred, nothing else", n=2 each; then `create3DModel` as
for the tools: `source/tools/{logs,stone}{_raw.webp,.glb}`). Iron shares the stone block.

The loads held in both arms are bound to the chest (`--bone=Spine3`), in front of his belly where the carrying walk
holds the arms: shared between both wrists (`L_Wrist+R_Wrist`) the two hands' turns blend and the load shrinks and
drifts. The farmer is 1 model unit tall and his belly is about 0.24 deep, so a load needs `--at` z of about 0.27 to sit
in front of it. The bucket hangs from one hand on a plain walk.

| game anim | load | bone | Ludo preset | sheets |
|---|---|---|---|---|
| carry_sack | sack | chest | `walk_carry_loop_quaternius` | `carry_sack_*` |
| carry_basket | basket | chest | `walk_carry_loop_quaternius` | `carry_basket_*` |
| carry_bucket | bucket | left hand | `walk_loop_quaternius` | `carry_bucket_*` |
| carry_logs | log bundle, across the arms | chest | `walk_carry_loop_quaternius` | `carry_logs_*` |
| carry_stone | stone block | chest | `walk_carry_loop_quaternius` | `carry_stone_*` |

`walk_carrying` (the other carrying walk) does not retarget onto the farmer: his arms hang and the load collapses.

```bash
"${A[@]}" /tmp/rig/carry_sack.glb $T/sack.glb --bone=Spine3 --up=y --length=0.34 --grip=0.5 --at=0,-0.06,0.27
"${A[@]}" /tmp/rig/carry_basket.glb $T/basket.glb --bone=Spine3 --up=y --length=0.26 --grip=0.5 --at=0,-0.07,0.28
"${A[@]}" /tmp/rig/carry_bucket.glb $T/bucket.glb --bone=L_Wrist --up=y --length=0.22 --grip=1.0 --at=0,-0.03,0
"${A[@]}" /tmp/rig/carry_logs.glb $T/logs.glb --bone=Spine3 --length=0.4 --grip=0.5 --rot=0,0,90 --at=0,-0.03,0.25
"${A[@]}" /tmp/rig/carry_stone.glb $T/stone.glb --bone=Spine3 --up=y --length=0.2 --grip=0.5 --at=0,-0.07,0.27
```

Rendered with the tools' settings. A new load: add it to `LOADS` (and `ITEM_LOAD`, or a `CARRY` row), attach and
render it as above, and add it to the sheet below (`--row` and `--match`).

### The game's sheet

```bash
S=(); for a in plough plant harvest collect feed fertilise load build chop quarry carry_sack carry_basket carry_bucket carry_logs carry_stone; do
  for d in ne se sw nw; do S+=("$a:$d=../farmer_sheets/${a}_$d.webp"); done; done
for d in ne se sw nw; do S+=("mine:$d=../farmer_sheets/quarry_$d.webp" "sit:$d=../farmer_sheets/groundsit_$d.webp"); done
R=(); for l in sack basket bucket logs stone; do R+=("--row=carry_${l}:6:9" "--match=carry_${l}:walk"); done
$P $L/fit_character.py $L/source/farmer_frames /tmp/props 100 \
  idle:se=Animation-1 idle:nw=Animation-2 idle:ne=Animation-3 idle:sw=Animation-6 \
  walk:nw=Animation-4 walk:sw=Animation-5 walk:ne=Animation-7 walk:se=Animation-8 "${S[@]}" "${R[@]}"
```

`--row=ANIM:FRAMES:FPS` adds an animation the manifest lacks as a new row (a carry walk plays 6 frames at 9 fps, like
the walk, so his steps keep pace with the ground). `--match=ANIM:REF` sizes ANIM by the figure's height in REF instead
of by the hat: the carrying walk tilts his head back, so the hat looks narrower and he came out a fifth too big. Write
`${l}` with braces in zsh: `$l:w...` is a history modifier.

`100` is his height in 2x px. Ludo frames each API render to its own motion, so the script scales each animation by
the hat's width to match the pack. Copy `/tmp/props/{2x,1x}_farmer.png` to
`public/assets/farm/{2x,1x}/people/farmer.png`; the manifest keeps the frame (164x156, anchor 82,126 at 2x; 82x78,
anchor 41,63 at 1x) with no `shadow`. The sheet is 24 columns: one row per animation, its four directions (se, sw,
ne, nw) side by side in 6-frame slots, so it stays within the 4096 px texture limit of many phones (3936x2808 at 2x with 18 rows, 1968x1404 at 1x; 26
rows is the most that fits).
The `farmer` asset's `animations` in `manifest.json` give each one's `start`; mine's point at quarry's frames.

## Animals: `fit_animal.py`

Each animal went through the API in five steps.

1. **Image:** `generateWithStyle` with the farmer image as `style_image` (a full-body animal standing side-on, legs
   apart, tail clear of the legs): `source/<animal>_raw.png`. The prop 3D model turned these flat drawings brown and
   muddy, so each was redrawn as a 3D render with `create3DModelImage` first: `source/<animal>_3d_raw.png`.
2. **Model:** `create3DModel` on the redraw, model `prop`, `rig: true`, `target_num_faces` 20000:
   `source/<animal>_model.glb` (gzipped GLB). The sheep needed three tries (the server failed on one redraw).
3. **Animation:** `animate3DModel` with short prompts, 4 candidates each, picked from the mp4 previews. The chosen
   clips are in `source/animal_clips/` (gzipped, animation only). The general rig gave the chicken and the cow a
   humanoid-like skeleton with no real neck, and no walk prompt moved the cow's legs, so some animations use the
   fallback instead: `createDirectionalStills` (all four views of the rest pose) and then `animateSprite` per view
   (model `forge`, 1.5 s, 16 frames, `frame_size` -9, `loop`).
4. **Render:** `createDirectionalSprites` with the clip as `animation_url`: style `cel_cartoon` at its defaults,
   `isometric`, SE/SW/NE/NW, `keep_horizontal_travel: false`, `num_frames` 16, `target_frame_size` 256.
5. **Fit:** the sheets are in `source/<animal>_sheets/<anim>_<dir>.webp` (all 4×4 grids; the Forge ones scaled to a
   third). Ludo's direction names are the game's facings.

| animal | idle | walk | eat |
|---|---|---|---|
| chicken | clip "standing, breathing, looking around" | clip "walking forward" (`loop: false`) | Forge "pecking at the ground"; NE is NW mirrored (the NE take turned round) |
| cow | clip "standing, breathing, tail swishing" | Forge "walking in place" (NW: "walking forward on the spot, keeping its pose and heading") | clip from the "walking forward" batch that lowers the head, played forward and back |
| sheep | clip "standing, breathing, tail swishing" | Forge "walking forward on the spot, keeping its pose and heading" | clip "lowering its head to graze" |

```bash
O=/tmp/props
C=(); for a in idle walk; do for d in se sw ne nw; do C+=("$a:$d=${a}_$d.webp"); done; done
C+=(eat:se=eat_se.webp eat:sw=eat_sw.webp eat:ne=eat_nw.webp! eat:nw=eat_nw.webp)
$P $L/fit_animal.py chicken $L/source/chicken_sheets $O 34 "${C[@]}" --frames=idle:12,walk:8,eat:10 --fps=idle:5,walk:8,eat:8 --shadow=13,6
W=(); for d in se sw ne nw; do W+=("idle:$d=idle_$d.webp" "walk:$d=walk_$d.webp" "eat:$d=eat_$d.webp~"); done
$P $L/fit_animal.py cow $L/source/cow_sheets $O 88 "${W[@]}" --frames=idle:12,walk:10,eat:12 --fps=idle:5,walk:8,eat:5 --shadow=32,14
H=(); for d in se sw ne nw; do H+=("idle:$d=idle_$d.webp" "walk:$d=walk_$d.webp" "eat:$d=eat_$d.webp"); done
$P $L/fit_animal.py sheep $L/source/sheep_sheets $O 58 "${H[@]}" --frames=idle:12,walk:10,eat:12 --fps=idle:5,walk:9,eat:5 --shadow=24,11
for n in chicken cow sheep; do for r in 2x 1x; do cp $O/${r}_$n.png public/assets/farm/$r/animals/$n.png; done; done
```

The number after the output folder is the standing height in 2x px, next to the 100 px farmer: the chicken comes to his
knee, the sheep to his waist, the cow's back to his chest. Each animation is scaled until its standing pose (the
tallest SE frame) is that tall, and placed with the ground under the middle of its feet on the anchor. `!` mirrors a
sheet, `~` plays it forward then back (for a one-way clip that has to loop). The script bakes in a soft shadow and
writes the manifest entry itself (frame size, grid, anchor, origin, animations); the old `_shadow` sheets are gone.

## Ox and oxcart

The ox barn's ox, its cart and the barn itself (about 32 credits in all, two tries at the ox image included).

**Barn:** `generateWithStyle` with the farmhouse image as `style_image` ("a rustic wooden ox barn with a stone base and
a steep wooden-shingle roof, a long, low building ... a wide open cart door, a hay rack and a water trough ..., on a
rectangular (not square) flat grass pad 3 tiles long by 2 deep ..."), then `editImage` for winter ("keep the same ox
barn ... exactly; ... snow on the roof ..., cover the grass pad in snow"). Ludo drew the long wall along the
front-right edge, so it is mirrored to put it along x, and `--pad` makes the pad 3:2.

```bash
$P $L/fit_building.py $L/source/ox_barn_raw.png /tmp/props ox_barn 3 2 43 267 724 262 378.5 434.8 --mirror --pad
$P $L/fit_building.py $L/source/ox_barn_winter_raw.png /tmp/props ox_barn_winter 3 2 43 266 723 261 378 433.5 --mirror --pad
$P $L/add_asset.py bakery ox_barn ox_barn_winter
for n in ox_barn ox_barn_winter; do $P $L/install_prop.py /tmp/props $n; done
```

The cart parks by the door on the short front-right wall (`PARK_AT` in `src/logic/haul.ts`).

**Ox:** the animals pipeline. `generateWithStyle` with the cow image as `style_image` (the first try drew dairy cows
with udders; the second asked for "a draught ox: a big, heavily muscled castrated bull ..., NOT a dairy cow, no udder,
... a solid reddish-brown (chestnut) coat ..., long wide forward-curving cream horns, a plain wooden yoke bar ..."):
`source/ox_raw.webp`; `create3DModelImage` on it: `source/ox_3d_raw.webp`; `create3DModel` (`prop`, `rig: true`,
20000 faces): `source/ox_model.glb` (gzipped). `animate3DModel` gave "Load-Pulling Walk" (prompt "a heavy ox walking
forward steadily, pulling a load", `loop: false`) and "Gentle Tail Swish" ("standing still, breathing, tail
swishing"), in `source/animal_clips/ox_{walk,idle}.glb`. `createDirectionalSprites` rendered each (as for the
animals: `cel_cartoon`, `isometric`, SE/SW/NE/NW, 16 frames, 256 px): `source/ox_sheets/`. It has no eat animation,
so `fit_animal.py` gets `--anims=idle,walk`:

```bash
$P $L/add_asset.py cow ox
X=(); for a in idle walk; do for d in se sw ne nw; do X+=("$a:$d=${a}_$d.webp"); done; done
$P $L/fit_animal.py ox $L/source/ox_sheets /tmp/props 96 "${X[@]}" --anims=idle,walk --frames=idle:12,walk:12 \
  --fps=idle:5,walk:10 --shadow=34,15
for r in 2x 1x; do cp /tmp/props/${r}_ox.png public/assets/farm/$r/animals/ox.png; done
```

96 px stands a little taller than the cow (88).

**Cart:** a 3D prop rendered in four facings. `generateWithStyle` with the farmer image ("an empty wooden two-wheeled
farm haul cart, open flat bed with low plank sides, two big spoked wooden wheels, two shafts pointing forward ...
no animal"): `source/cart_raw.webp`; `create3DModel` (`prop`, 8000 faces, 1024 texture): `source/cart_model.glb`
(gzipped); `createDirectionalStills` (`cel_cartoon`, `isometric`, SE/SW/NE/NW): `source/cart_<dir>_raw.png`. The
cart model's front is not its shafts, so Ludo's direction names are *not* the game's facings here: the game's facing
(the way the shafts point on screen) comes from the still noted below. Every still shares one camera, so one BASE and
SCALE fit them all.

```bash
for m in se:ne sw:se ne:nw nw:sw; do
  $P $L/fit_prop.py $L/source/cart_${m#*:}_raw.png /tmp/props cart_${m%%:*} 476 430 0.28 --shadow=42
done
$P $L/add_asset.py tree_stump cart_se cart_sw cart_ne cart_nw
for d in se sw ne nw; do $P $L/install_prop.py /tmp/props cart_$d; done
```

**Loads:** no extra art. The cart carries a small stock pile (`pile_wood`, `pile_stone`, `pile_iron`, or
`pile_feed` sacks for goods; stage 2 past half a load), drawn on its bed (`cartLoadArt` in `src/scenes/art.ts`,
`LOAD_AT` in `src/features/haul/index.ts`). The yards of the woodcutter's lodge, quarry and mine use the same piles
(`YARD_AT` in `src/features/resources/index.ts`).

## Ground tiles: `ground_tiles.py`

```bash
mkdir -p /tmp/tiles/2x /tmp/tiles/1x
$P $L/ground_tiles.py /tmp/tiles $L/source/grass_a_raw.png $L/source/grass_b_raw.png $L/source/dirt_raw.png \
  $L/source/soil_raw.png $L/source/snow_raw.png $L/source/snow_path_raw.png
```

Takes the inside of each Ludo tile (no outline, no edge tufts), un-shears it to a square, flattens its lighting
and makes it wrap, then renders every tile in tile space so all of them meet without seams. The grass variants
share one border. Paths and soil beds keep the shapes from `tools/art/tiles.py`; `soil_*_y` is `soil_*_x` with
the furrows turned; watered soil is tilled soil darkened; unowned land is the grass darkened and muted. Sizes
and anchors match the pack, so `manifest.json` needs no change. It writes every season's file (base, `_spring`,
`_summer`, `_autumn`, `_winter`); copy them all into `public/assets/farm/{2x,1x}/tiles/`.

Seasons: spring and summer are the Ludo grass as is. Autumn is it recoloured gold with fallen leaves drawn on
(wrapped, so it still tiles). Winter uses the snow tile for grass (three variants: as is, turned, transposed),
the trampled-snow tile for paths, and frozen soil: the tilled soil greyed with snow in the furrows.

## Trader's wagon

`createImage` (Cel-Shaded, Isometric, sprite, square): a covered wagon with two spoked wheels, a cream canvas cover
with a red stripe, crates, sacks and a barrel, and the bearded trader in a green coat waving beside it; no horse,
ground or shadow. Winter is `editImage` on it ("keep the same ... exactly; add fresh snow on the cover, the load and
the wagon's edges, and give the trader a red scarf"). The raw images are padded with 112 px of transparency at the
bottom so the baked shadow isn't clipped. It is fitted as a one-tile prop standing between the wheels (it overhangs
its tile like a tree), with `buildings` entries in `manifest.json` added by hand first (`install_prop.py` only updates
existing entries); the game draws `trader_wagon_winter` in winter.

```bash
for n in trader_wagon trader_wagon_winter; do
  $P $L/fit_prop.py $L/source/${n}_raw.png /tmp/props $n 420 600 0.4 --shadow=100
  $P $L/install_prop.py /tmp/props $n
done
```
