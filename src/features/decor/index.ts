import Phaser from 'phaser';
import { SEASONS, type Season } from '../../data/seasons';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import type { Game } from '../../logic/game';
import { footprintOf } from '../../logic/game';
import { isOwned } from '../../logic/land';
import { depositAt, mapOf, treeAt, type MapLayer } from '../../logic/maplayer';
import { ART_RES, ART_SCALE, sceneryArt, seasonalArt } from '../../scenes/art';
import { DECOR_ATLAS } from '../../scenes/BootScene';
import { decorArt, decorVisible, scatterDecor, type DecorSpot } from '../../scenes/decor';
import { DEPTH } from '../../scenes/depth';
import { gridToWorld } from '../../scenes/iso';
import { artSeason, packAsset } from '../../scenes/sprites';

/**
 * Ground decorations on screen (the scatter is `src/scenes/decor.ts`): one Blitter over the grass and under
 * everything placed, a bob per spot made back to front when the map is (re)built. Nothing runs per frame but a check
 * of the season drawn: a new season, an object added or removed, or land bought only changes frames and visibility.
 * Not interactive: a tap goes straight through to the tile. And `window.farm.decor` for QA.
 */

/** Tiles covered by placed objects (paths, fields, buildings, pens, construction sites), as y * width + x. */
function coveredTiles(game: Game): Set<number> {
  const { width } = game.state.land;
  const out = new Set<number>();
  for (const o of game.state.objects) {
    const fp = footprintOf(o);
    for (let y = o.y; y < o.y + fp.h; y++) for (let x = o.x; x < o.x + fp.w; x++) out.add(y * width + x);
  }
  return out;
}

/** The decorations of the farm's map: around its trees, never on deposits or the locked land's bushes and ponds. */
function scatterFor(game: Game, layer: MapLayer): DecorSpot[] {
  const { width, height } = game.state.land;
  return scatterDecor({
    width,
    height,
    tree: (x, y) => treeAt(layer, x, y) !== undefined,
    blocked: (x, y) => depositAt(layer, x, y) !== undefined || sceneryArt(x, y) !== null,
  });
}

onGameStart((ctx) => {
  const scene = ctx.scene;
  const { game } = ctx;
  let layer: Phaser.GameObjects.Container | null = null;
  let spots: DecorSpot[] = [];
  let bobs: Phaser.GameObjects.Bob[] = [];
  /** The art each spot shows now (null: hidden), for QA. */
  let shown: (string | null)[] = [];
  /** What the spots were scattered for: a new tree or deposit list (felled, built over) means a new scatter. */
  let built = '';
  const mapKey = (map: MapLayer) => `${map.trees.length},${map.deposits.length}`;
  let builtLayer: { trees: unknown; deposits: unknown } = { trees: null, deposits: null };
  let drawn: Season | null = null;
  let dirty = false;

  const rebuild = () => {
    layer?.destroy();
    const map = mapOf(game.state);
    built = mapKey(map);
    builtLayer = { trees: map.trees, deposits: map.deposits };
    spots = scatterFor(game, map);
    // A Blitter ignores its own scale when drawing, so a scaled container brings the 2x art to world size.
    const blitter = scene.add.blitter(0, 0, DECOR_ATLAS).setName('decor');
    layer = scene.add.container(0, 0, [blitter]).setScale(ART_SCALE).setDepth(DEPTH.decor).setName('decor-layer');
    // Spots come back to front, so bobs drawn later (in front) cover the ones behind.
    bobs = spots.map(() => blitter.create(0, 0, undefined, false));
    shown = spots.map(() => null);
    refresh();
  };

  /** Brings every bob up to date with the season drawn, the land and what is built. */
  const refresh = () => {
    dirty = false;
    const season = artSeason();
    drawn = season;
    const { land } = game.state;
    const covered = coveredTiles(game);
    spots.forEach((spot, i) => {
      const bob = bobs[i];
      const visible = decorVisible(spot, isOwned(land, spot.x, spot.y), covered.has(spot.y * land.width + spot.x));
      const art = seasonalArt(decorArt(spot, season), season);
      const res = packAsset(art)?.res[ART_RES];
      if (!visible || !res) {
        bob.setVisible(false);
        shown[i] = null;
        return;
      }
      // Bobs are placed by their top-left pixel, in the Blitter's unscaled (2x) space.
      const at = gridToWorld(spot.x + spot.dx, spot.y + spot.dy);
      bob.reset(at.x / ART_SCALE - res.anchor[0], at.y / ART_SCALE - res.anchor[1], art).setVisible(true);
      shown[i] = art;
    });
  };

  const onMap = () => {
    const map = mapOf(game.state);
    if (map.trees !== builtLayer.trees || map.deposits !== builtLayer.deposits || mapKey(map) !== built) rebuild();
  };
  const later = () => (dirty = true);

  const unsubscribe = [
    game.events.on('map', onMap),
    game.events.on('reset', rebuild),
    game.events.on('objectAdded', later),
    game.events.on('objectRemoved', later),
    // Buying a parcel announces each tile: redrawn once per frame at most.
    game.events.on('land', later),
  ];
  const onUpdate = () => {
    if (dirty || artSeason() !== drawn) refresh();
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe.forEach((u) => u());
    layer?.destroy();
  });
  rebuild();

  registerDebugInfo('decor', () => {
    if (dirty) refresh();
    const { land } = game.state;
    const covered = coveredTiles(game);
    const visible = spots.filter((s) => decorVisible(s, isOwned(land, s.x, s.y), covered.has(s.y * land.width + s.x)));
    const bySeason = Object.fromEntries(
      SEASONS.map((season) => {
        const counts: Record<string, number> = {};
        for (const s of visible) {
          const art = seasonalArt(decorArt(s, season), season);
          counts[art] = (counts[art] ?? 0) + 1;
        }
        return [season, counts];
      }),
    );
    const byTile = new Map(spots.map((s, i) => [s.y * land.width + s.x, i]));
    return Object.freeze({
      /** Decorations showing now. */
      count: shown.filter(Boolean).length,
      /** What the showing decorations would be in each season: sprite → how many. */
      bySeason,
      /** The sprite drawn on tile (x, y) now, or null. */
      at: (x: number, y: number) => {
        const i = byTile.get(y * land.width + x);
        return i === undefined ? null : shown[i];
      },
    });
  });
});
