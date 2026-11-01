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
| `weaving_hut`, `weaving_hut_winter` (the loom) | `weaving_hut_raw.png`, `weaving_hut_winter_raw.png` | all |
| `woodcutter_lodge`, `woodcutter_lodge_winter` | `woodcutter_lodge_raw.png`, `woodcutter_lodge_winter_raw.png` | all |
| `quarry`, `quarry_winter` | `quarry_raw.png`, `quarry_winter_raw.png` | all |
| `mine`, `mine_winter` | `mine_raw.png`, `mine_winter_raw.png` | all |
| `for_sale_sign`, `for_sale_sign_winter` | `for_sale_sign_raw.png`, `for_sale_sign_winter_raw.png` | all |
| `granary_1..3`, each with `_winter` | `granary_{1,2,3}_raw.png`, `granary_{1,2,3}_winter_raw.png` | all |
| `storehouse_1..3`, each with `_winter` | `storehouse_{1,2,3}_raw.png`, `storehouse_{1,2,3}_winter_raw.png` | all |
| `feed_mill`, `feed_mill_winter`, `feed_mill_sails` (8 frames), `feed_mill_static`, `feed_mill_static_winter` | `feed_mill_raw.png`, `feed_mill_body_raw.png`, `feed_mill_sails_raw.png`, `feed_mill_winter_raw.png`; see **Feed mill** below | all |
| `farmer` (spritesheet) | see **Farmer** below | all |
| `grass_0..2`, `path_*` (16), `soil_tilled_x/y`, `soil_watered_x/y`, `unowned_0/1` | `grass_a_raw.png`, `grass_b_raw.png`, `dirt_raw.png`, `soil_raw.png`, `snow_raw.png`, `snow_path_raw.png` | all |
| `tree_oak` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_oak_raw.png`, `tree_oak_{spring,autumn,winter}_raw.png` | all |
| `tree_apple` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_apple_raw.png`, `tree_apple_{spring,autumn,winter}_raw.png` | all |
| `tree_pine` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_pine_raw.png`, `tree_pine_winter_raw.png` (spring and autumn recoloured from summer) | all |
| `tree_stump` (base, `_spring`, `_summer`, `_autumn`, `_winter`) | `tree_stump_raw.png`, `tree_stump_winter_raw.png` (spring and autumn are the summer image) | all |
| `rock_small`, `rock_large` (not drawn by the game yet), `outcrop_0..2`, `outcrop_spent` (stone deposits) | `rock_small_raw.png`, `rock_large_raw.png` and their `_winter_raw.png` (outcrops: the large cluster, mirrored, the single boulder, and a small boulder for worked-out) | all |
| `wheat`, `carrot`, `corn` × `0_seeded`, `1_sprout`, `2_growing`, `3_ripe` (one tile of plants each) | `<crop>_<stage>_raw.png` for sprout to ripe, `seeded_raw.png` for every crop's seeded stage; see **Crops** below | none (nothing grows in winter) |
| item icons: `egg`, `milk`, `wool`, `feed`, `cheese`, `butter`, `bread`, `cloth`, `wheat`, `carrot`, `corn`, `wood`, `stone`, `iron`, `manure`, `coins` | `icon_<item>_raw.png`; see **Item icons** below | none (icons don't change) |
| `pile_<kind>_1..4` for `crops`, `animal`, `feed`, `goods`, `wood`, `stone`, `iron`, `house_goods`, `house_materials` | `pile_<kind>_<n>_raw.png`; see **Stock piles** below | none (piles change with the stock) |

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

`corners.py RAW.png` prints a raw image's pad corners (L, R, B) for `fit_building.py` and writes `RAW_corners.png`, an
overlay to check them by eye (don't commit it); measure a corner by hand if eaves or props stick out past it.

The granary and storehouse have a sprite per level. Level 1 came from `generateWithStyle`, with the building on the
back half of the pad and the front half left as an open yard for the stock piles (`SLOTS` in
`src/features/storage/piles.ts`). Levels 2 and 3 are `editImage` on the level below ("keep the same ... exactly, but
make it bigger: add a bay ..."), so each level is the same building grown. `python tools/ludo/corners.py RAW.png`
prints the pad corners and writes `RAW_corners.png`, an overlay to check them by eye (don't commit it). A winter
image on the same canvas size as its summer image is fitted with the summer corners, so the two line up exactly.

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
yellow corn with its husks peeled back / a small stack of three chopped logs ... / two chunky grey cut stone
blocks ... / three dark blue-grey iron ingots ... / a small wooden bucket filled with dark brown manure ... / a
small stack of shiny gold coins ...; front three-quarter view. Bold simple silhouette that reads at small size,
chunky shapes, cozy cartoon style with soft cel shading and a thick dark brown outline, lit from the top left.
Only the item, centered; no ground, no shadow, no text, no frame."

`fit_icon.py` trims the item and centres it in the 256 px box with the same padding for every icon (14 px at
2x), so each reads at the same size in the overlay's square `object-fit: contain` slot; the anchor is the box's
centre. Check them at 24 px before installing.

```bash
for n in egg milk wool feed cheese butter bread cloth wheat carrot corn wood stone iron manure coins; do
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
`source/farmer_sheets/`; Ludo's direction names are the game's facings. Presets:

| game anim | Ludo preset | sheets |
|---|---|---|
| plough | `mining_loop_quaternius` | `plough_*` |
| plant | `farm_plantseed_quaternius` | `plant_*` |
| harvest | `farm_harvest_quaternius` | `harvest_*` |
| build (also chop, quarry, mine) | `treechopping_loop_quaternius` | `build_*` |
| feed (also fertilise, load) | `farm_scatteringseeds_quaternius` | `feed_*` |
| sit | `groundsit_idle_loop_quaternius` | `groundsit_*` |

`chairsit_*` (`sitting_idle_loop_quaternius`) is unused: the Ludo farmhouse has no bench, so a chair pose floats.

```bash
S=(); for a in plough plant harvest build feed; do for d in ne se sw nw; do S+=("$a:$d=../farmer_sheets/${a}_$d.webp"); done; done
for d in ne se sw nw; do S+=("sit:$d=../farmer_sheets/groundsit_$d.webp"); done
$P $L/fit_character.py $L/source/farmer_frames /tmp/props 100 \
  idle:se=Animation-1 idle:nw=Animation-2 idle:ne=Animation-3 idle:sw=Animation-6 \
  walk:nw=Animation-4 walk:sw=Animation-5 walk:ne=Animation-7 walk:se=Animation-8 "${S[@]}"
```

`100` is his height in 2x px. Ludo frames each API render to its own motion, so the script scales each animation by
the hat's width to match the pack. Copy `/tmp/props/{2x,1x}_farmer.png` to
`public/assets/farm/{2x,1x}/people/farmer.png`; the manifest keeps the old layout (frame 164x156, anchor 82,126 at
2x; 82x78, anchor 41,63 at 1x) with no `shadow`.

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
