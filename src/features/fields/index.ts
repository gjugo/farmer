import type Phaser from 'phaser';
import { CROP_LIST, FIELD } from '../../data/crops';
import { getItem } from '../../data/items';
import type { FarmContext, ObjectView, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import {
  cropStage,
  fieldCrop,
  formatDuration,
  growthProgress,
  harvest,
  plant,
  timeToRipe,
  type CropStage,
  type FieldState,
} from '../../logic/crops';
import { ART_SCALE, cropArt, SHADOW } from '../../scenes/art';
import { footprintLocal } from '../../scenes/iso';
import { addArt, textureKey } from '../../scenes/sprites';
import './textures';

/**
 * Fields: plant crops for money, watch them grow on the game clock, harvest into
 * the inventory. Rules live in `src/logic/crops.ts`, crop content in `src/data/crops.ts`.
 */

const STAGE_NAMES: Record<CropStage, string> = {
  empty: 'Empty',
  seeded: 'Seeded',
  sprout: 'Sprouting',
  growing: 'Growing',
  ripe: 'Ripe!',
};

/** Fields are 2×2; the pack's crops cover one tile each. */
const TILES = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

/** Ripe crops sway this much taller. */
const SWAY = 1.06;

interface FieldView {
  stage: CropStage | null;
  /** The tilled soil: dry while empty or ripe, watered while growing. */
  soil: Phaser.GameObjects.Image;
  /** One crop sprite per tile, back to front, and their shadows. */
  plants: Phaser.GameObjects.Image[];
  shadows: Phaser.GameObjects.Image[];
  sparkles: Phaser.GameObjects.Image[];
  tweens: Phaser.Tweens.Tween[];
}

const fieldViews = new Map<string, FieldView>();

function stopRipeEffects(fv: FieldView): void {
  for (const t of fv.tweens) t.remove();
  fv.tweens = [];
  for (const p of fv.plants) p.setScale(ART_SCALE);
  for (const s of fv.sparkles) s.setVisible(false);
}

/** Ripe crops sway and sparkle so they stand out at a glance. */
function startRipeEffects(ctx: FarmContext, fv: FieldView): void {
  const { tweens } = ctx.scene;
  fv.tweens.push(
    tweens.add({ targets: fv.plants, scaleY: ART_SCALE * SWAY, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
  );
  fv.sparkles.forEach((s, i) => {
    s.setVisible(true).setAlpha(0).setScale(0.4);
    fv.tweens.push(
      tweens.add({ targets: s, alpha: 1, scale: 1, duration: 500, delay: i * 450, yoyo: true, repeat: -1, repeatDelay: 600 }),
    );
  });
}

function syncView(ctx: FarmContext, obj: PlacedObject<FieldState>): void {
  const fv = fieldViews.get(obj.id);
  if (!fv) return;
  const stage = cropStage(ctx.game.state.clock, obj.state);
  if (stage === fv.stage) return;
  fv.stage = stage;
  const art = obj.state.crop ? cropArt(obj.state.crop, stage) : null;
  fv.soil.setTexture(textureKey(ctx.scene, art && stage !== 'ripe' ? 'field-watered' : 'field'));
  fv.plants.forEach((p, i) => {
    p.setVisible(art !== null);
    if (art) p.setTexture(textureKey(ctx.scene, art));
    const shadow = fv.shadows[i];
    const shadowKey = art ? `${art}${SHADOW}` : '';
    shadow.setVisible(ctx.scene.textures.exists(shadowKey));
    if (shadow.visible) shadow.setTexture(shadowKey);
  });
  stopRipeEffects(fv);
  if (stage === 'ripe') startRipeEffects(ctx, fv);
}

function doHarvest(ctx: FarmContext, obj: PlacedObject<FieldState>): void {
  const result = harvest(ctx.game, obj);
  if (!result) return;
  const item = getItem(result.crop.harvestItem);
  ctx.ui.floatText(obj.x + 0.5, obj.y, `+${result.qty} ${item?.name ?? result.crop.name}`, '#fff3a8');
}

registerBehavior<FieldState>(FIELD, {
  create(ctx, obj, view: ObjectView) {
    // Each crop stands on its own tile's top corner, like the pack's soil tiles.
    const scene = ctx.scene;
    const plants = TILES.map(([x, y]) => {
      const p = footprintLocal(2, 2, x, y);
      return addArt(scene, p.x, p.y, 'wheat_0_seeded').setVisible(false);
    });
    const shadows = TILES.map(([x, y]) => {
      const p = footprintLocal(2, 2, x, y);
      return scene.add.image(p.x, p.y, 'missing').setScale(ART_SCALE).setVisible(false); // textured by syncView
    });
    // Sparkle spots in grid units inside the 2×2 field.
    const sparkles = [
      [0.5, 0.5],
      [1.5, 0.8],
      [0.8, 1.5],
    ].map(([gx, gy]) => {
      const p = footprintLocal(2, 2, gx, gy);
      return scene.add.image(p.x, p.y - 30, 'crop-sparkle').setVisible(false);
    });
    view.container.add([...plants, ...sparkles]);
    view.shadows.add(shadows);
    fieldViews.set(obj.id, { stage: null, soil: view.sprite, plants, shadows, sparkles, tweens: [] });
    syncView(ctx, obj);
  },
  update(ctx, obj) {
    syncView(ctx, obj);
  },
  refresh(ctx, obj) {
    syncView(ctx, obj);
  },
  destroy(_ctx, obj) {
    const fv = fieldViews.get(obj.id);
    if (fv) stopRipeEffects(fv);
    fieldViews.delete(obj.id);
  },
  onClick(ctx, obj) {
    if (cropStage(ctx.game.state.clock, obj.state) !== 'ripe') return false;
    doHarvest(ctx, obj);
    return true;
  },
  panel(ctx, obj) {
    const { game } = ctx;
    const clock = game.state.clock;
    const stage = cropStage(clock, obj.state);
    const crop = fieldCrop(obj.state);

    if (stage === 'empty' || !crop) {
      return {
        title: 'Field',
        icon: '🟫',
        lines: ['Empty field. Pick a crop to plant:'],
        actions: CROP_LIST.map((c) => {
          const item = getItem(c.harvestItem);
          if (!game.isUnlocked(c.unlockLevel)) {
            return { label: `🔒 ${c.icon} ${c.name} · Unlocks at level ${c.unlockLevel}`, variant: 'secondary', disabled: true, onClick: () => {} };
          }
          return {
            label: `${c.icon} ${c.name} · $${c.plantCost} · ${c.growMs / 1000}s → ${c.harvestQty} ${item?.name ?? c.name}`,
            disabled: !game.canAfford(c.plantCost),
            onClick: () => {
              if (plant(game, obj, c.id).ok) ctx.ui.floatText(obj.x + 0.5, obj.y, `-$${c.plantCost}`, '#ffd6a0');
            },
          };
        }),
      };
    }

    if (stage === 'ripe') {
      return {
        title: `${crop.name} field`,
        icon: crop.icon,
        lines: [`Ripe! Harvest ${crop.harvestQty} ${crop.name}.`],
        progress: { value: 1, label: 'Ready' },
        actions: [{ label: `Harvest ${crop.harvestQty} ${crop.icon}`, onClick: () => doHarvest(ctx, obj) }],
      };
    }

    const left = formatDuration(timeToRipe(clock, obj.state));
    return {
      title: `${crop.name} field`,
      icon: crop.icon,
      lines: [`Stage: ${STAGE_NAMES[stage]}`, `Ripe in ${left}`],
      progress: { value: growthProgress(clock, obj.state), label: `${left} left` },
    };
  },
});
