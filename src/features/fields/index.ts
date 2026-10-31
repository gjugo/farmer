import type Phaser from 'phaser';
import { CROP_LIST, FIELD } from '../../data/crops';
import { getItem } from '../../data/items';
import { PLOUGH_COST, PLOUGH_SEASONS, SEASON_INFO, seasonNames } from '../../data/seasons';
import { HARVEST_WORK_MS, PLANT_WORK_MS, PLOUGH_WORK_MS } from '../../data/workers';
import type { FarmContext, ObjectView, PanelSpec, PlacedObject } from '../../game/context';
import { registerBehavior } from '../../game/hooks';
import { withFarmer } from '../../game/workers';
import {
  canPloughNow,
  cropStage,
  fieldCrop,
  formatDuration,
  growthProgress,
  harvest,
  isPloughed,
  plant,
  plough,
  ploughedUntil,
  seasonCheck,
  timeToRipe,
  type CropStage,
  type FieldState,
} from '../../logic/crops';
import { nextSeasonAt, nextSeasonIn, seasonOf } from '../../logic/seasons';
import { fullMessage, poolOf } from '../../logic/storage';
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

/** Unploughed soil is the tilled tiles faded into the grass, like an overgrown plot. */
const UNPLOUGHED_ALPHA = 0.35;

interface FieldView {
  stage: CropStage | null;
  ploughed: boolean | null;
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
  const clock = ctx.game.state.clock;
  const stage = cropStage(clock, obj.state);
  // A crop stands in ploughed soil; the frost only shows once it is harvested.
  const ploughed = stage !== 'empty' || isPloughed(clock, obj.state);
  if (stage === fv.stage && ploughed === fv.ploughed) return;
  fv.stage = stage;
  fv.ploughed = ploughed;
  const art = obj.state.crop ? cropArt(obj.state.crop, stage) : null;
  fv.soil.setTexture(textureKey(ctx.scene, art && stage !== 'ripe' ? 'field-watered' : 'field'));
  fv.soil.setAlpha(ploughed ? 1 : UNPLOUGHED_ALPHA);
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

/** Says the granaries are full, so no farmer walks out for a harvest that can't be stored. */
function refuseIfFull(ctx: FarmContext, obj: PlacedObject<FieldState>): boolean {
  const crop = fieldCrop(obj.state);
  if (!crop || ctx.game.spaceFor(crop.harvestItem) >= crop.harvestQty) return false;
  ctx.ui.toast(fullMessage(poolOf(crop.harvestItem)), 'error');
  return true;
}

function doHarvest(ctx: FarmContext, obj: PlacedObject<FieldState>): void {
  if (refuseIfFull(ctx, obj)) return;
  withFarmer(ctx, 'harvest', obj, HARVEST_WORK_MS, () => {
    const result = harvest(ctx.game, obj);
    if (!result.ok) {
      if (result.reason === 'full') refuseIfFull(ctx, obj);
      return false;
    }
    const item = getItem(result.crop.harvestItem);
    ctx.ui.floatText(obj.x + 0.5, obj.y, `+${result.qty} ${item?.name ?? result.crop.name}`, '#fff3a8');
    return true;
  });
}

/** "🌻 Summer · 3:20 left" */
function seasonLine(ctx: FarmContext): string {
  const clock = ctx.game.state.clock;
  const season = SEASON_INFO[seasonOf(clock)];
  return `${season.icon} ${season.name} · ${formatDuration(nextSeasonAt(clock.elapsed) - clock.elapsed)} left`;
}

/** An empty field: plough it (in season), then pick a crop that grows now. */
function emptyFieldPanel(ctx: FarmContext, obj: PlacedObject<FieldState>): PanelSpec {
  const { game } = ctx;
  const clock = game.state.clock;

  if (!isPloughed(clock, obj.state)) {
    if (!canPloughNow(clock)) {
      const thaw = formatDuration(nextSeasonIn(clock.elapsed, PLOUGH_SEASONS) - clock.elapsed);
      return {
        title: 'Field',
        icon: '🟫',
        lines: [seasonLine(ctx), `The ground is frozen. Ploughing starts again in ${thaw}.`],
        actions: [{ label: `🚜 Plough · ${seasonNames(PLOUGH_SEASONS)} only`, variant: 'secondary', disabled: true, onClick: () => {} }],
      };
    }
    return {
      title: 'Field',
      icon: '🟫',
      lines: [seasonLine(ctx), 'Unploughed soil. Plough it before sowing; it stays ploughed until the winter frost.'],
      actions: [
        {
          label: `🚜 Plough · $${PLOUGH_COST}`,
          disabled: !game.canAfford(PLOUGH_COST),
          onClick: () => {
            withFarmer(ctx, 'plough', obj, PLOUGH_WORK_MS, () => {
              if (!plough(game, obj).ok) return false;
              ctx.ui.floatText(obj.x + 0.5, obj.y, `-$${PLOUGH_COST}`, '#ffd6a0');
              return true;
            });
          },
        },
      ],
    };
  }

  const frost = formatDuration((ploughedUntil(clock, obj.state) ?? clock.elapsed) - clock.elapsed);
  return {
    title: 'Field',
    icon: '🟫',
    lines: [seasonLine(ctx), `Ploughed until the frost (${frost}). Pick a crop to plant:`],
    actions: CROP_LIST.map((c) => {
      const item = getItem(c.harvestItem);
      if (!game.isUnlocked(c.unlockLevel)) {
        return { label: `🔒 ${c.icon} ${c.name} · Unlocks at level ${c.unlockLevel}`, variant: 'secondary', disabled: true, onClick: () => {} };
      }
      const season = seasonCheck(clock, c);
      if (season !== 'ok') {
        const why = season === 'late' ? `too late in ${SEASON_INFO[seasonOf(clock)].name.toLowerCase()}` : `sow in ${seasonNames(c.seasons)}`;
        return { label: `📅 ${c.icon} ${c.name} · ${why}`, variant: 'secondary', disabled: true, onClick: () => {} };
      }
      return {
        label: `${c.icon} ${c.name} · $${c.plantCost} · ${c.growMs / 1000}s → ${c.harvestQty} ${item?.name ?? c.name}`,
        disabled: !game.canAfford(c.plantCost),
        onClick: () => {
          withFarmer(ctx, 'plant', obj, PLANT_WORK_MS, () => {
            if (!plant(game, obj, c.id).ok) return false;
            ctx.ui.floatText(obj.x + 0.5, obj.y, `-$${c.plantCost}`, '#ffd6a0');
            return true;
          });
        },
      };
    }),
  };
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
    fieldViews.set(obj.id, { stage: null, ploughed: null, soil: view.sprite, plants, shadows, sparkles, tweens: [] });
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

    if (stage === 'empty' || !crop) return emptyFieldPanel(ctx, obj);

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
