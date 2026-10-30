import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';
import type { Season } from './seasons';

export interface CropDef {
  id: string;
  name: string;
  /** Money charged when planting (there are no seed items). */
  plantCost: number;
  /** Game milliseconds from planting to ripe. */
  growMs: number;
  /** Item added to the inventory on harvest, and how many. */
  harvestItem: KnownItemId;
  harvestQty: number;
  icon: string;
  /** Farm level that unlocks planting it. */
  unlockLevel: number;
  /** Seasons it grows in: it can be sown in them, if it will be ripe before they are over. */
  seasons: readonly Season[];
}

/** Every crop that can be planted in a field, in menu order. */
export const CROPS = {
  wheat: { id: 'wheat', name: 'Wheat', plantCost: 8, growMs: 30_000, harvestItem: 'wheat', harvestQty: 4, icon: '🌾', unlockLevel: 1, seasons: ['spring', 'summer', 'autumn'] },
  carrot: { id: 'carrot', name: 'Carrot', plantCost: 12, growMs: 45_000, harvestItem: 'carrot', harvestQty: 4, icon: '🥕', unlockLevel: 2, seasons: ['spring', 'autumn'] },
  corn: { id: 'corn', name: 'Corn', plantCost: 16, growMs: 60_000, harvestItem: 'corn', harvestQty: 4, icon: '🌽', unlockLevel: 4, seasons: ['spring', 'summer'] },
} as const satisfies Record<string, CropDef>;

export type CropId = keyof typeof CROPS;

export const CROP_LIST: readonly CropDef[] = Object.values(CROPS);

export function getCrop(id: string): CropDef | undefined {
  return (CROPS as Record<string, CropDef>)[id];
}

export const FIELD = 'field';

registerBuildable({
  id: FIELD,
  name: 'Field',
  cost: 25,
  footprint: { w: 2, h: 2 },
  texture: 'field',
  icon: '🟫',
  unlockLevel: 1,
  category: 'crops',
  description: 'Soil for wheat, carrots and corn. Plough it in spring, summer or autumn, then sow.',
  initialState: () => ({ crop: null, timer: null, ploughedAt: null }),
});
