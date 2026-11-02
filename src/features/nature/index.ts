import Phaser from 'phaser';
import { RESOURCES, type ResourceType } from '../../data/resourceBuildings';
import { onBuildPreview, onGameStart, registerDebugInfo } from '../../game/hooks';
import type { Game } from '../../logic/game';
import {
  inRange,
  mapCounts,
  mapOf,
  nextStageAt,
  regrowAt,
  treeAt,
  treeStage,
  treeStatus,
  type Deposit,
  type MapLayer,
  type Tree,
} from '../../logic/maplayer';
import { ART_SCALE, depositArt, SHADOW, TREE_SPECIES, treeArt, treeLook, YOUNG_TREE_SCALE, type TreeSpecies } from '../../scenes/art';
import { DEPTH } from '../../scenes/depth';
import type { FarmScene } from '../../scenes/FarmScene';
import { gridToWorld, ISO_H, type Footprint } from '../../scenes/iso';
import { addArt, addShadow, textureKey } from '../../scenes/sprites';
import { speciesAt } from './species';

/**
 * The map's forests and deposits on screen (rules in `src/logic/maplayer.ts`): a sprite and its shadow per tree
 * tile and per deposit tile, depth-sorted with the buildings. Each tree's species comes from where it stands
 * (`./species`) and its size, facing and tint from its tile (`treeLook`). A felled tree becomes a stump and grows
 * back by the clock, through a sapling and a young tree (`treeStage`), so nothing runs per frame but a check
 * against the next time a tree changes. Deposits turn to rubble when
 * used up, and the tiles a quarry or mine covers are hidden under it. The sprite count is fixed by the map layer:
 * one image (and shadow) per tile, made when the map is (re)built and only retextured after that.
 *
 * Also the build ghost's extras: a woodcutter's lodge shows the tiles it reaches and how many trees stand there;
 * a quarry or mine marks the deposits it can stand on. And `window.farm.map` for QA.
 */

interface TileSprite {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
  art: string;
}

/** The look of a sprite: swaps texture (and its shadow's) only when the art changes. */
function show(scene: Phaser.Scene, s: TileSprite, art: string): void {
  if (s.art === art) return;
  s.art = art;
  s.img.setTexture(textureKey(scene, art));
  const shadow = textureKey(scene, `${art}${SHADOW}`);
  if (s.shadow && shadow !== 'missing') s.shadow.setTexture(shadow);
}

/** Tiles covered by placed objects, as "x,y". */
function covered(game: Game): Set<string> {
  const out = new Set<string>();
  for (const o of game.state.objects) {
    const fp = RESOURCES[o.type as ResourceType]?.footprint;
    if (!fp) continue; // only quarries and mines stand on deposits
    for (let y = o.y; y < o.y + fp.h; y++) for (let x = o.x; x < o.x + fp.w; x++) out.add(`${x},${y}`);
  }
  return out;
}

onGameStart((ctx) => {
  const scene = ctx.scene as FarmScene;
  const { game } = ctx;
  const shadows = scene.add.container(0, 0).setDepth(DEPTH.shadow).setName('nature-shadows');
  let trees = new Map<Tree, TileSprite>();
  /** Each tree's species, worked out when the sprites are built (it depends on the trees around it). */
  let species = new Map<Tree, TreeSpecies>();
  let rocks: { d: Deposit; x: number; y: number; s: TileSprite }[] = [];
  /** What the sprites were made for: a new tree list (stumps built over) or deposit list means a rebuild. */
  let built: { layer: MapLayer | null; trees: Tree[] | null; deposits: Deposit[] | null } = { layer: null, trees: null, deposits: null };
  /** Game time at which a tree next falls or grows back. */
  let nextChange = Infinity;

  const sprite = (x: number, y: number, art: string): TileSprite => {
    const at = gridToWorld(x, y);
    const img = addArt(scene, at.x, at.y, art);
    const shadow = addShadow(scene, at.x, at.y, art);
    if (shadow) shadows.add(shadow);
    return { img, shadow, art };
  };

  const clear = () => {
    for (const s of [...trees.values(), ...rocks.map((r) => r.s)]) {
      s.img.destroy();
      s.shadow?.destroy();
    }
    trees = new Map();
    species = new Map();
    rocks = [];
  };

  /** Brings every sprite up to date with the clock and the deposits. */
  const refresh = () => {
    const now = game.now;
    nextChange = Infinity;
    for (const [tree, s] of trees) {
      const stage = treeStage(tree, now);
      show(scene, s, treeArt(species.get(tree)!, stage));
      // A young tree is the grown one drawn smaller; the look's scale is about the base, where the sprite stands.
      s.img.setScale(ART_SCALE * treeLook(tree.x, tree.y).scale * (stage === 'young' ? YOUNG_TREE_SCALE : 1));
      // Falls at `felledAt` (a lodge is felling it), then changes at each stage of growing back.
      const next = nextStageAt(tree, now);
      if (next !== null) nextChange = Math.min(nextChange, next);
    }
    const under = covered(game);
    for (const r of rocks) {
      show(scene, r.s, depositArt(r.d.kind, r.x, r.y, r.d.left === 0));
      const hidden = under.has(`${r.x},${r.y}`);
      r.s.img.setVisible(!hidden);
      r.s.shadow?.setVisible(!hidden);
    }
  };

  const rebuild = () => {
    clear();
    const layer = mapOf(game.state);
    built = { layer, trees: layer.trees, deposits: layer.deposits };
    const standing: { fp: Footprint; target: Phaser.GameObjects.Image }[] = [];
    for (const t of layer.trees) {
      const kind = speciesAt(layer, t.x, t.y);
      species.set(t, kind);
      const s = sprite(t.x, t.y, treeArt(kind, 'grown'));
      const look = treeLook(t.x, t.y);
      // Pack frames pivot on the anchor (the base of the trunk), so flipping and scaling keep the tree on its tile.
      s.img.setName('tree').setFlipX(look.flip).setTint(look.tint);
      trees.set(t, s);
      standing.push({ fp: { x: t.x, y: t.y, w: 1, h: 1 }, target: s.img });
    }
    for (const d of layer.deposits) {
      for (let y = d.y; y < d.y + d.h; y++) {
        for (let x = d.x; x < d.x + d.w; x++) {
          const s = sprite(x, y, depositArt(d.kind, x, y, false));
          s.img.setName(`deposit-${d.kind}`);
          rocks.push({ d, x, y, s });
          standing.push({ fp: { x, y, w: 1, h: 1 }, target: s.img });
        }
      }
    }
    scene.setStanding('nature', standing);
    refresh();
  };

  const onMap = () => {
    const layer = mapOf(game.state);
    if (layer !== built.layer || layer.trees !== built.trees || layer.deposits !== built.deposits) rebuild();
    else refresh();
  };

  const unsubscribe = [
    game.events.on('map', onMap),
    game.events.on('reset', rebuild),
    game.events.on('objectAdded', onMap),
    game.events.on('objectRemoved', refresh),
  ];
  const onUpdate = () => {
    if (game.now >= nextChange) refresh();
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe.forEach((u) => u());
    clear();
  });
  rebuild();

  // The build ghost: a lodge's reach, or the deposits a quarry or mine can stand on.
  const reach = scene.add.graphics().setDepth(DEPTH.shadow - 0.25).setName('ghost-reach');
  const label = scene.add
    .text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${Math.round(ISO_H * 0.5)}px`,
      fontStyle: 'bold',
      color: '#eaffd6',
      stroke: '#2b2118',
      strokeThickness: Math.round(ISO_H * 0.08),
      resolution: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.ghost + 1)
    .setVisible(false)
    .setName('ghost-reach-label');
  const diamond = (x: number, y: number, w = 1, h = 1) => {
    const pts = [gridToWorld(x, y), gridToWorld(x + w, y), gridToWorld(x + w, y + h), gridToWorld(x, y + h)];
    return pts.map((p) => new Phaser.Math.Vector2(p.x, p.y));
  };
  onBuildPreview((_ctx, p) => {
    reach.clear();
    label.setVisible(false);
    const def = p ? RESOURCES[p.type as ResourceType] : undefined;
    if (!p || !def) return;
    const layer = mapOf(game.state);
    const area = { x: p.x, y: p.y, ...def.footprint };
    if (def.range) {
      const r = def.range;
      let grown = 0;
      let stumps = 0;
      for (let y = area.y - r; y < area.y + area.h + r; y++) {
        for (let x = area.x - r; x < area.x + area.w + r; x++) {
          if (!inRange(area, r, x, y)) continue;
          const tree = treeAt(layer, x, y);
          const stump = tree && treeStatus(tree, game.now) === 'stump';
          if (tree) {
            if (stump) stumps++;
            else grown++;
          }
          reach.fillStyle(tree ? 0x9be36b : 0xf4f0c8, tree ? 0.45 : 0.22);
          reach.fillPoints(diamond(x, y), true);
        }
      }
      const top = gridToWorld(area.x, area.y);
      label
        .setText(`🌲 ${grown} tree${grown === 1 ? '' : 's'} in reach${stumps ? ` (+${stumps} stumps)` : ''}`)
        .setColor(grown > 0 ? '#eaffd6' : '#ffd0c8')
        .setPosition(top.x, top.y - ISO_H * 2.2)
        .setVisible(true);
    } else if (def.deposit) {
      for (const d of layer.deposits) {
        if (d.kind !== def.deposit || d.left === 0) continue;
        reach.lineStyle(4, 0xffe27a, 0.9);
        reach.strokePoints(diamond(d.x, d.y, d.w, d.h), true);
      }
    }
  });

  const speciesOf = (layer: MapLayer, t: Tree) => species.get(t) ?? speciesAt(layer, t.x, t.y);
  const describe = (layer: MapLayer, t: Tree, now: number) => ({
    x: t.x,
    y: t.y,
    species: speciesOf(layer, t),
    stage: treeStage(t, now),
    status: treeStatus(t, now),
    felledAt: t.felledAt,
    regrowsAt: regrowAt(t),
  });

  // What the map holds, for QA: tree counts, the deposits with what is left, and a tile lookup.
  registerDebugInfo('map', () => {
    const layer = mapOf(game.state);
    const now = game.now;
    return Object.freeze({
      trees: mapCounts(layer, now),
      deposits: layer.deposits.map((d) => ({ kind: d.kind, x: d.x, y: d.y, w: d.w, h: d.h, left: d.left, amount: d.amount })),
      species: Object.fromEntries(TREE_SPECIES.map((k) => [k, layer.trees.filter((t) => speciesOf(layer, t) === k).length])),
      treeAt: (x: number, y: number) => {
        const t = treeAt(layer, x, y);
        return t ? describe(layer, t, now) : null;
      },
      /** Every tree tile, with its species and stage. */
      treeList: () => layer.trees.map((t) => describe(layer, t, now)),
      /** Tree and deposit sprites alive in the scene (shadows not counted). */
      sprites: trees.size + rocks.length,
      /** Decorative willows drawn beside ponds (scenery, not trees of the map: see FarmScene.placeScenery). */
      pondWillows: scene.children.list.filter((o) => o.name === 'pond-willow').length,
    });
  });
});
