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
import { cropTexture } from './textures';

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

interface FieldView {
  stage: CropStage | null;
  plants: Phaser.GameObjects.Image;
  sparkles: Phaser.GameObjects.Image[];
  tweens: Phaser.Tweens.Tween[];
}

const fieldViews = new Map<string, FieldView>();

function stopRipeEffects(fv: FieldView): void {
  for (const t of fv.tweens) t.remove();
  fv.tweens = [];
  fv.plants.setScale(1);
  for (const s of fv.sparkles) s.setVisible(false);
}

/** Ripe crops sway and sparkle so they stand out at a glance. */
function startRipeEffects(ctx: FarmContext, fv: FieldView): void {
  const { tweens } = ctx.scene;
  fv.tweens.push(
    tweens.add({ targets: fv.plants, scaleY: 1.08, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
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
  const key = obj.state.crop ? cropTexture(obj.state.crop, stage) : null;
  fv.plants.setVisible(key !== null);
  if (key) fv.plants.setTexture(key);
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
    // Anchored at the bottom so the ripe sway grows upwards from the soil.
    // The overlay texture is the field's size plus OVERLAY_TOP, so scale 1 lines it up.
    const plants = ctx.scene.add.image(0, view.height, 'crop-seeded').setOrigin(0, 1).setVisible(false);
    const sparkles = [
      [0.25, 0.2],
      [0.75, 0.45],
      [0.4, 0.75],
    ].map(([fx, fy]) => ctx.scene.add.image(view.width * fx, view.height * fy, 'crop-sparkle').setVisible(false));
    view.container.add([plants, ...sparkles]);
    fieldViews.set(obj.id, { stage: null, plants, sparkles, tweens: [] });
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
