import Phaser from 'phaser';
import type { ObjectView } from '../../game/context';
import { FARMHOUSE } from '../../data/farmhouse';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import { farmhouseLevel } from '../../logic/homes';
import { stockDisplay, type StockShown } from '../../logic/stockpiles';
import { pileArt } from '../../scenes/art';
import type { FarmScene } from '../../scenes/FarmScene';
import { footprintLocal, ISO_W } from '../../scenes/iso';
import { addArt, addShadow } from '../../scenes/sprites';

/**
 * Stock piles in the world: logs, stone and iron in the storehouse yard, sacks, baskets, churns, bales and
 * crates at the granary, a small pile at the farmhouse, the starting camp's supplies around its tent. `stockDisplay` (src/logic/stockpiles.ts) says which
 * stage each pile shows; this draws them inside the building's view, so they depth-sort with it. Piles are
 * rebuilt only when the inventory or the buildings change, never every frame, and each building keeps one
 * image per pile (hidden when empty), so the sprite count stays fixed.
 */

/**
 * Where each pile stands, in tiles from the building's top-left corner: on the open yard at the front of its own
 * 2×2 pad, clear of the walls, posts and bays of every level. Pile art is drawn around the middle of a tile (see
 * "Stock piles" in tools/ludo/README.md). Listed back to front.
 */
const SLOTS: Record<string, Record<string, { x: number; y: number }>> = {
  granary: { crops: { x: 0.45, y: 1.6 }, animal: { x: 1.0, y: 1.72 }, goods: { x: 1.75, y: 1.1 }, feed: { x: 1.6, y: 1.62 } },
  storehouse: { wood: { x: 0.52, y: 1.45 }, stone: { x: 1.0, y: 1.65 }, iron: { x: 1.6, y: 1.55 } },
  // The camp's supplies, scattered around the front of its 3×3 footprint, the tent on the back tiles (src/features/camp).
  camp: { wood: { x: 2.6, y: 0.6 }, crops: { x: 0.6, y: 2.55 }, goods: { x: 1.6, y: 2.65 }, stone: { x: 2.6, y: 2.4 } },
};

/**
 * The farmhouse's two piles at each level, on the open front-right side of its 3×3 pad (inside the forecourt wall at
 * level 3), clear of the bench left of the door.
 */
const FARMHOUSE_SLOTS: readonly Record<string, { x: number; y: number }>[] = [
  { house_materials: { x: 2.55, y: 1.45 }, house_goods: { x: 2.5, y: 2.45 } },
  { house_materials: { x: 2.55, y: 1.5 }, house_goods: { x: 2.5, y: 2.45 } },
  { house_materials: { x: 2.5, y: 1.5 }, house_goods: { x: 2.45, y: 2.4 } },
];

/** The pile slots of a building of `type` at `level` (only the farmhouse's change with its level). */
function slotsFor(type: string, level: number): Record<string, { x: number; y: number }> | undefined {
  if (type === FARMHOUSE) return FARMHOUSE_SLOTS[level - 1] ?? FARMHOUSE_SLOTS[0];
  return SLOTS[type];
}

interface Pile {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
  art: string | null;
}

interface Yard {
  container: Phaser.GameObjects.Container;
  piles: Map<string, Pile>;
  /** The building's level the slots were laid out for. */
  level: number;
}

/** One hidden image per pile slot, in front of the building's sprite and behind anything added after it. */
function createYard(scene: Phaser.Scene, view: ObjectView, type: string, level: number): Yard {
  const piles = new Map<string, Pile>();
  const slots = slotsFor(type, level) ?? {};
  // The footprint's depth in tiles, from where its top corner sits in the box (see `footprintLocal`).
  const h = Math.round(view.top.x / (ISO_W / 2));
  let index = view.container.getIndex(view.sprite) + 1;
  for (const [kind, at] of Object.entries(slots)) {
    const p = footprintLocal(0, h, at.x - 0.5, at.y - 0.5);
    const first = pileArt(kind, 1)!;
    const img = addArt(scene, p.x, p.y, first).setVisible(false).setName(`pile-${kind}`);
    view.container.addAt(img, index++);
    const shadow = addShadow(scene, p.x, p.y, first)?.setVisible(false) ?? null;
    if (shadow) view.shadows.add(shadow);
    piles.set(kind, { img, shadow, art: null });
  }
  return { container: view.container, piles, level };
}

function showPile(scene: Phaser.Scene, pile: Pile, art: string | null): void {
  if (pile.art === art) return;
  pile.art = art;
  pile.img.setVisible(art !== null);
  pile.shadow?.setVisible(art !== null);
  if (!art) return;
  pile.img.setTexture(scene.textures.exists(art) ? art : 'missing');
  if (pile.shadow && scene.textures.exists(`${art}_shadow`)) pile.shadow.setTexture(`${art}_shadow`);
}

function destroyYard(yard: Yard): void {
  for (const p of yard.piles.values()) {
    p.img.destroy();
    p.shadow?.destroy();
  }
}

onGameStart((ctx) => {
  const scene = ctx.scene as FarmScene;
  const { game } = ctx;
  const yards = new Map<string, Yard>();
  let shown: StockShown[] = [];
  let dirty = true;
  const markDirty = () => (dirty = true);

  const sync = () => {
    dirty = false;
    shown = stockDisplay(game.state);
    const seen = new Set<string>();
    for (const s of shown) {
      const view = scene.viewOf(s.id);
      const obj = game.getObject(s.id);
      const level = obj?.type === FARMHOUSE ? farmhouseLevel(obj) : 1;
      if (!view || !slotsFor(s.type, level)) continue;
      let yard = yards.get(s.id);
      // A redrawn object (new game, a new view) gets a fresh yard; the old images went with the old view. So does an
      // upgraded farmhouse, its piles where the new level has room.
      if (!yard || yard.container !== view.container || !yard.container.active || yard.level !== level) {
        if (yard && yard.container === view.container) destroyYard(yard);
        yard = createYard(scene, view, s.type, level);
        yards.set(s.id, yard);
      }
      seen.add(s.id);
      for (const [kind, pile] of yard.piles) showPile(scene, pile, pileArt(kind, s.piles[kind] ?? 0));
    }
    // Demolished, or no longer storing (should not happen, but leave nothing behind).
    for (const [id, yard] of yards) {
      if (seen.has(id)) continue;
      destroyYard(yard);
      yards.delete(id);
    }
  };

  const unsubscribe = (['inventory', 'objectAdded', 'objectRemoved', 'objectChanged', 'reset'] as const).map((e) => game.events.on(e, markDirty));
  const onUpdate = () => {
    if (dirty) sync();
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    unsubscribe.forEach((u) => u());
  });

  // What the piles show: each storing building with its share of the stock, the stage of each pile and the
  // sprites actually drawn (pile images alive in the scene, for checking that the count stays bounded).
  registerDebugInfo('stockpiles', () => ({
    buildings: shown.map((s) => ({
      ...s,
      drawn: [...(yards.get(s.id)?.piles.values() ?? [])].flatMap((p) => (p.art && p.img.visible ? [p.art] : [])),
    })),
    sprites: [...yards.values()].reduce((n, y) => n + y.piles.size, 0),
  }));
});
