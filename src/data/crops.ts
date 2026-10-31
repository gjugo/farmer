import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';
import type { Season } from './seasons';
import { areaSoil } from '../logic/soil';

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
  /** Fertility points a harvest takes from the field (double when the field's last harvest was the same crop). */
  soilDrain: number;
}

/** Every crop that can be planted in a field, in menu order. */
export const CROPS = {
  wheat: { id: 'wheat', name: 'Wheat', plantCost: 8, growMs: 480_000, harvestItem: 'wheat', harvestQty: 10, icon: '🌾', unlockLevel: 1, seasons: ['spring', 'summer', 'autumn'], soilDrain: 8 },
  carrot: { id: 'carrot', name: 'Carrot', plantCost: 12, growMs: 600_000, harvestItem: 'carrot', harvestQty: 10, icon: '🥕', unlockLevel: 2, seasons: ['spring', 'autumn'], soilDrain: 5 },
  corn: { id: 'corn', name: 'Corn', plantCost: 16, growMs: 960_000, harvestItem: 'corn', harvestQty: 12, icon: '🌽', unlockLevel: 4, seasons: ['spring', 'summer'], soilDrain: 12 },
} as const satisfies Record<string, CropDef>;

export type CropId = keyof typeof CROPS;

export const CROP_LIST: readonly CropDef[] = Object.values(CROPS);

export function getCrop(id: string): CropDef | undefined {
  return (CROPS as Record<string, CropDef>)[id];
}

export const FIELD = 'field';

const FIELD_FOOTPRINT = { w: 2, h: 2 } as const;

registerBuildable({
  id: FIELD,
  name: 'Field',
  cost: 25,
  footprint: FIELD_FOOTPRINT,
  texture: 'field',
  icon: '🟫',
  unlockLevel: 1,
  category: 'crops',
  description: 'Soil for wheat, carrots and corn. Plough it in spring, summer or autumn, then sow. Rich ground yields more.',
  // A new field starts at the average soil quality of its tiles, resting from the moment it is laid.
  initialState: (at) => ({
    crop: null,
    timer: null,
    ploughedAt: null,
    fertility: at ? areaSoil({ x: at.x, y: at.y, ...FIELD_FOOTPRINT }) : null,
    restingSince: at?.now ?? null,
    lastCrop: null,
  }),
});
