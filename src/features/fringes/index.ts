import Phaser from 'phaser';
import type { Season } from '../../data/seasons';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import { footprintOf } from '../../logic/game';
import { roadTiles } from '../../logic/mainroad';
import { ART_RES, ART_SCALE, EDGE_STEP, edgeNames, fringeArt, NE, NW, seasonalArt, SE, SW } from '../../scenes/art';
import { FRINGE_ATLAS } from '../../scenes/BootScene';
import { DEPTH } from '../../scenes/depth';
import type { FarmScene } from '../../scenes/FarmScene';
import { gridToWorld } from '../../scenes/iso';
import { artSeason, packAsset } from '../../scenes/sprites';
import { fringeTiles, ROAD_TYPE, type FringeTile } from './layout';

/**
 * Grass fringes: a strip of grass tufts hanging over each edge of a path or field tile that borders open grass, so
 * the ground's hard diamond edges look grown over (which edges: `fringeTiles` in `./layout.ts`; the art: `fringe_*`,
 * see tools/ludo/README.md). All of them are one Blitter over the paths and fields and under every shadow and
 * walker; it is laid out again only when an object is built or demolished, the game is reset or the season changes. `window.farm.fringes` for QA.
 */

onGameStart((ctx) => {
  const { game } = ctx;
  const scene = ctx.scene as FarmScene;
  const blitter = scene.add.blitter(0, 0, FRINGE_ATLAS);
  // A Blitter ignores its own scale when drawing, so a scaled container brings the 2x strips to world size.
  scene.add.container(0, 0, [blitter]).setScale(ART_SCALE).setDepth(DEPTH.fringe).setName('fringes');
  let tiles = new Map<string, FringeTile>();
  let count = 0;
  let drawn: Season | null = null;
  let dirty = true;
  const key = (x: number, y: number) => `${x},${y}`;

  /** A fringe is the neighbouring grass hanging over: it takes that tile's tint (colour patches, soil, zone). */
  const tintOf = (x: number, y: number) => scene.groundTintAt(x, y);

  const layout = () => {
    dirty = false;
    drawn = artSeason();
    blitter.clear();
    const { land, objects } = game.state;
    const list = fringeTiles(
      [
        ...roadTiles(game.state).map((t) => ({ type: ROAD_TYPE, x: t.x, y: t.y, w: 1, h: 1 })),
        ...objects.map((o) => ({ type: o.type, x: o.x, y: o.y, ...footprintOf(o) })),
      ],
      (x, y) => x >= 0 && y >= 0 && x < land.width && y < land.height,
    );
    tiles = new Map(list.map((t) => [key(t.x, t.y), t]));
    count = 0;
    for (const t of list) {
      const top = gridToWorld(t.x, t.y);
      for (const bit of [NE, SE, SW, NW]) {
        if (!(t.edges & bit)) continue;
        const art = seasonalArt(fringeArt(t.kind, bit), drawn);
        if (!blitter.texture.has(art)) continue;
        const [ax, ay] = packAsset(art)?.res[ART_RES].anchor ?? [0, 0];
        const [dx, dy] = EDGE_STEP[bit];
        // Bobs are placed by their top-left pixel, in the Blitter's unscaled (2x) space.
        blitter.create(top.x / ART_SCALE - ax, top.y / ART_SCALE - ay, art).setTint(tintOf(t.x + dx, t.y + dy));
        count++;
      }
    }
  };

  const changed = () => (dirty = true);
  for (const event of ['objectAdded', 'objectRemoved', 'reset'] as const) game.events.on(event, changed);
  // Laid out at most once a frame, and again when the farm's look changes season.
  scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
    if (dirty || drawn !== artSeason()) layout();
  });
  layout();

  registerDebugInfo('fringes', () => ({
    /** Fringe strips drawn. */
    count,
    /** The fringed edges of tile (x, y), e.g. `['ne', 'sw']`; empty where none. */
    at: (x: number, y: number) => edgeNames(tiles.get(key(x, y))?.edges ?? 0),
  }));
});
