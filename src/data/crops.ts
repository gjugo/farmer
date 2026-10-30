import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';

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
}

/** Every crop that can be planted in a field, in menu order. */
export const CROPS = {
  wheat: { id: 'wheat', name: 'Wheat', plantCost: 8, growMs: 30_000, harvestItem: 'wheat', harvestQty: 4, icon: '🌾' },
  carrot: { id: 'carrot', name: 'Carrot', plantCost: 12, growMs: 45_000, harvestItem: 'carrot', harvestQty: 4, icon: '🥕' },
  corn: { id: 'corn', name: 'Corn', plantCost: 16, growMs: 60_000, harvestItem: 'corn', harvestQty: 4, icon: '🌽' },
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
  category: 'crops',
  description: 'Ploughed soil for wheat, carrots and corn.',
  initialState: () => ({ crop: null, timer: null }),
});
