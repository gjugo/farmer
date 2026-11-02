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
  potato: { id: 'potato', name: 'Potato', plantCost: 14, growMs: 720_000, harvestItem: 'potato', harvestQty: 14, icon: '🥔', unlockLevel: 3, seasons: ['spring', 'summer'], soilDrain: 15 },
  corn: { id: 'corn', name: 'Corn', plantCost: 16, growMs: 960_000, harvestItem: 'corn', harvestQty: 12, icon: '🌽', unlockLevel: 4, seasons: ['spring', 'summer'], soilDrain: 12 },
  barley: { id: 'barley', name: 'Barley', plantCost: 10, growMs: 540_000, harvestItem: 'barley', harvestQty: 10, icon: '🌿', unlockLevel: 4, seasons: ['spring', 'summer'], soilDrain: 6 },
  flax: { id: 'flax', name: 'Flax', plantCost: 14, growMs: 840_000, harvestItem: 'flax', harvestQty: 8, icon: '🪻', unlockLevel: 6, seasons: ['spring', 'summer'], soilDrain: 10 },
  // The winter crop: sown in autumn, it is ripe in winter (it grows longer than a season), and keeps in the frozen field.
  cabbage: { id: 'cabbage', name: 'Cabbage', plantCost: 20, growMs: 2_100_000, harvestItem: 'cabbage', harvestQty: 10, icon: '🥬', unlockLevel: 6, seasons: ['autumn', 'winter'], soilDrain: 9 },
  // Winter rye, the hardy grain: sown in autumn like cabbage, it may ripen in winter and keeps in the frozen field. It
  // asks little of the soil. Not a food: the mill grinds it into rye flour for the bakery's rye bread.
  rye: { id: 'rye', name: 'Rye', plantCost: 8, growMs: 1_440_000, harvestItem: 'rye', harvestQty: 12, icon: '🎋', unlockLevel: 3, seasons: ['autumn', 'winter'], soilDrain: 4 },
  pumpkin: { id: 'pumpkin', name: 'Pumpkin', plantCost: 24, growMs: 1_500_000, harvestItem: 'pumpkin', harvestQty: 6, icon: '🎃', unlockLevel: 7, seasons: ['summer', 'autumn'], soilDrain: 13 },
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
  category: 'farming',
  description: 'Soil for grain, roots and vegetables. Plough it in spring, summer or autumn, then sow. Rich ground yields more.',
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
