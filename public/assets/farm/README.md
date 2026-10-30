# Isometric Farm Pack

Bright cartoon isometric art for a 2D farming game (built for Phaser).
101 assets, transparent PNGs, separate shadow layers, two resolutions.

You can use, modify and ship these in commercial games. No attribution required.

## Folder layout

```
2x/   256 x 128 px tiles (sharp on retina / zoomed-in cameras)
1x/   128 x 64 px tiles
  tiles/      grass, dirt paths (all 16 pieces), tilled + watered soil, unowned land, overlays
  fences/     all 16 fence pieces + gates (closed/open) in both diagonal directions
  crops/      wheat, carrot, corn x 4 stages (0 seeded, 1 sprout, 2 growing, 3 ripe)
  animals/    cow, sheep, chicken sprite sheets (idle, walk, eat x 4 directions)
  buildings/  barn 4x4, chicken_coop 3x3, feed_mill 2x2 (+ animated sails), dairy 3x2,
              bakery 3x2, weaving_hut 2x2, market_stall 2x1, for_sale_sign 1x1
  props/      trees, bushes, rocks, hay, crates, sacks, milk can
  icons/      egg, milk, wool, feed, cheese, butter, bread, cloth, wheat, carrot, corn, coins
manifest.json   sizes, anchors, footprints, animation frame ranges for every asset
index.html      Phaser 3 demo that builds a farm from manifest.json
preview/        rendered demo scene + contact sheet
source/         the Python generator (edit colours/shapes and re-run build.py)
```

Every sprite `name.png` with a shadow has a matching `name_shadow.png` of the same size
and anchor. Draw all shadows on a layer below the sprites so shadows never darken
neighbouring objects.

## Grid and coordinates

- 2:1 dimetric. Tile x runs screen down-right, tile y runs screen down-left.
- Screen position of tile (tx, ty)'s top corner:
  `sx = originX + (tx - ty) * tileW/2`, `sy = originY + (tx + ty) * tileH/2`
- Every asset has an **anchor** (pixels, per resolution) that goes on that point.
  Phaser: `sprite.setOrigin(asset.res['1x'].origin[0], asset.res['1x'].origin[1])`.
- Buildings: place at the footprint's top tile. `footprint: [w, h]` = tiles along x, along y.
- Animals: anchor is the ground point under the animal, so place them at any
  fractional world position (x, y), not just tile corners.
- Depth: `tx + ty + footprintW + footprintH` (animals: `x + y + 1`). Crops sit on a
  soil tile and use `tx + ty + 1.5`.

## Paths and fences

Pieces are named by which tile edges they connect to: `ne` (toward -y), `se` (+x),
`sw` (+y), `nw` (-x). For a path cell, check its four neighbours and join the matching
edges in that order, e.g. `path_ne_sw` (straight), `path_se_sw` (corner), `path_ne_se_sw` (T),
`path_ne_se_sw_nw` (cross), `path_se` (end), `path_single`. Fences use the same scheme
(`fence_post` for no neighbours). Gates: `gate_se_nw_*` goes in a fence running along x,
`gate_ne_sw_*` in a fence running along y.

## Animals

One sheet per animal. Rows = animation x direction, in this order:
idle se/sw/ne/nw, walk se/sw/ne/nw, eat se/sw/ne/nw. Frame ranges, fps and keys
(`cow_walk_se`, ...) are in `manifest.json -> animations`; shadow sheets use the same frames.
Direction names: `se` = moving toward +x, `sw` = +y, `ne` = -y, `nw` = -x.

```js
for (const an of asset.animations)
  this.anims.create({ key: an.key, frameRate: an.fps, repeat: -1,
    frames: this.anims.generateFrameNumbers(asset.name, { start: an.start, end: an.end }) });
```

## Feed mill

`feed_mill` + `feed_mill_sails` (8-frame loop, same canvas and anchor, draw just above
the mill). `feed_mill_static` has the sails baked in if you don't need the animation.

## Unowned land

Use `unowned_0` / `unowned_1` tiles for land the player hasn't bought, or lay
`overlay_locked` over any tile. `for_sale_sign` marks a plot for purchase.
`overlay_cursor_ok` / `overlay_cursor_bad` are hover cursors.

## Running the demo

Serve this folder with any static server (`npx serve .` or `python3 -m http.server`)
and open `index.html`. Drag to pan, scroll to zoom, click a field to advance its crop.

## Regenerating

`source/` contains the generator (Python 3, `pip install cairosvg pillow numpy`).
`python3 build.py ../my-pack` re-exports everything; colours live at the top of each module.
