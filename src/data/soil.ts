/**
 * Soil: the ground's quality differs across the map, and fields wear out and recover. Rules live in
 * `src/logic/soil.ts`, the overlay and the look in `src/features/soil`. Fertility and soil quality are
 * percentage points (0–100).
 */

export type SoilBand = 'rich' | 'normal' | 'poor';

/** The quality of each band of ground: a new field starts at the average over its tiles. */
export const SOIL_QUALITY: Readonly<Record<SoilBand, number>> = { rich: 95, normal: 70, poor: 45 };

/** Fixed seed of the soil layer. It is computed from this, never saved, so every load (and old saves) get the same map. */
export const SOIL_SEED = 4049;

/** Size in tiles of the cells the soil's blobs are interpolated over: bigger cells, bigger patches. */
export const SOIL_CELL = 9;

/** Shown for each band in the field panel and the overlay legend. */
export const SOIL_INFO: Readonly<Record<SoilBand, { name: string; icon: string; color: number }>> = {
  rich: { name: 'Rich', icon: '🟢', color: 0x5fd35a },
  normal: { name: 'Normal', icon: '🟡', color: 0xf2d04b },
  poor: { name: 'Poor', icon: '🔴', color: 0xe0563f },
};

/** Fertility a field can reach: manure pushes it above its soil quality, up to this. */
export const MAX_FERTILITY = 100;

/** Harvest yield is `round(harvestQty × (YIELD_BASE + YIELD_PER_FERTILITY × fertility / 100))`. */
export const YIELD_BASE = 0.5;
export const YIELD_PER_FERTILITY = 0.75;

/** Growing the same crop as the field's last harvest drains this many times its usual amount. */
export const SAME_CROP_DRAIN = 2;

/** An empty field regains this many points per game day, up to its soil quality. Winter counts as rest. */
export const FALLOW_GAIN_PER_DAY = 6;

/** Spreading manure takes this much manure and adds this many points, up to `MAX_FERTILITY`. */
export const MANURE_PER_SPREAD = 4;
export const MANURE_GAIN = 20;

/** An assigned farmer spreads manure on an empty field below this fertility, when there is enough in stock. */
export const MANURE_BELOW = 80;

/** Manure a pen gives per animal each time its product is collected. */
export const MANURE_PER_COLLECT = 1;
