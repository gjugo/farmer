import Phaser from 'phaser';
import type { ObjectView } from '../../game/context';
import { onGameStart, registerDebugInfo } from '../../game/hooks';
import { stockDisplay, type StockShown } from '../../logic/stockpiles';
import { pileArt } from '../../scenes/art';
import type { FarmScene } from '../../scenes/FarmScene';
import { footprintLocal, ISO_W } from '../../scenes/iso';
import { addArt, addShadow } from '../../scenes/sprites';

/**
 * Stock piles in the world: logs, stone and iron in the storehouse yard, sacks, baskets, churns, bales and
 * crates at the granary, a small pile at the farmhouse. `stockDisplay` (src/logic/stockpiles.ts) says which
 * stage each pile shows; this draws them inside the building's view, so they depth-sort with it. Piles are
 * rebuilt only when the inventory or the buildings change, never every frame, and each building keeps one
 * image per pile (hidden when empty), so the sprite count stays fixed.
 */

/**
 * Where each pile stands, in tiles from the building's top-left corner: in the yard in front of it, inside its
 * own 2×2 footprint, clear of the walls, steps, silos and lean-to of every level. Pile art is drawn around the
 * middle of a tile (see tools/art/piles.py). Listed back to front.
 */
const SLOTS: Record<string, Record<string, { x: number; y: number }>> = {
  granary: { crops: { x: 0.42, y: 1.84 }, animal: { x: 0.98, y: 1.84 }, feed: { x: 1.5, y: 1.72 }, goods: { x: 1.8, y: 1.42 } },
  storehouse: { wood: { x: 0.42, y: 1.7 }, stone: { x: 1.05, y: 1.74 }, iron: { x: 1.72, y: 1.62 } },
  farmhouse: { house_goods: { x: 1.84, y: 0.64 }, house_materials: { x: 1.85, y: 1.02 } },
};

interface Pile {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image | null;
  art: string | null;
}

interface Yard {
  container: Phaser.GameObjects.Container;
  piles: Map<string, Pile>;
}

/** One hidden image per pile slot, in front of the building's sprite and behind anything added after it. */
function createYard(scene: Phaser.Scene, view: ObjectView, type: string): Yard {
  const piles = new Map<string, Pile>();
  const slots = SLOTS[type] ?? {};
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
  return { container: view.container, piles };
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
      if (!view || !SLOTS[s.type]) continue;
      let yard = yards.get(s.id);
      // A redrawn object (new game, a new view) gets a fresh yard; the old images went with the old view.
      if (!yard || yard.container !== view.container || !yard.container.active) {
        yard = createYard(scene, view, s.type);
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
