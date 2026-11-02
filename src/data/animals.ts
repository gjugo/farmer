import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';
import type { MaterialCost } from './materials';

export type AnimalKind = 'chicken' | 'cow' | 'sheep';
export type PenType = 'coop' | 'pasture';

export interface AnimalDef {
  id: AnimalKind;
  name: string;
  icon: string;
  price: number;
  /** The building it lives in. */
  pen: PenType;
  /** Feed eaten to start one production cycle. */
  feedPerCycle: number;
  product: KnownItemId;
  /** Length of a production cycle in game milliseconds. */
  cycleMs: number;
  /** Farm level that unlocks buying it. */
  unlockLevel: number;
}

export interface PenDef {
  id: PenType;
  name: string;
  icon: string;
  cost: number;
  materials: MaterialCost;
  /** Size in tiles. */
  footprint: { w: number; h: number };
  capacity: number;
  /** Animals that may live here (mixing is fine). */
  animals: readonly AnimalKind[];
  description: string;
  /** Farm level that unlocks building it. */
  unlockLevel: number;
}

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  chicken: { id: 'chicken', name: 'Chicken', icon: '🐔', price: 60, pen: 'coop', feedPerCycle: 1, product: 'egg', cycleMs: 180_000, unlockLevel: 1 },
  cow: { id: 'cow', name: 'Cow', icon: '🐄', price: 250, pen: 'pasture', feedPerCycle: 2, product: 'milk', cycleMs: 360_000, unlockLevel: 3 },
  sheep: { id: 'sheep', name: 'Sheep', icon: '🐑', price: 180, pen: 'pasture', feedPerCycle: 1, product: 'wool', cycleMs: 480_000, unlockLevel: 5 },
};

export const PENS: Record<PenType, PenDef> = {
  coop: {
    id: 'coop',
    name: 'Chicken Coop',
    icon: '🐔',
    cost: 100,
    materials: { wood: 8 },
    footprint: { w: 3, h: 3 },
    capacity: 6,
    animals: ['chicken'],
    description: 'Holds up to 6 chickens. Fed chickens lay eggs.',
    unlockLevel: 1,
  },
  pasture: {
    id: 'pasture',
    name: 'Pasture',
    icon: '🐄',
    cost: 230,
    materials: { wood: 12 },
    footprint: { w: 4, h: 4 },
    capacity: 4,
    animals: ['cow', 'sheep'],
    description: 'Fenced grass for up to 4 cows or sheep. Cows give milk, sheep give wool.',
    unlockLevel: 3,
  },
};

/** Feed bought from the panel when the barn is empty. */
export const FEED_PACK = { qty: 5, price: 25 } as const;

export function isAnimalKind(v: unknown): v is AnimalKind {
  return typeof v === 'string' && Object.hasOwn(ANIMALS, v);
}

// Coops and pastures are buildables; their textures and behaviour live in `src/features/animals`.
for (const pen of Object.values(PENS)) {
  registerBuildable({
    id: pen.id,
    name: pen.name,
    cost: pen.cost,
    materials: pen.materials,
    footprint: pen.footprint,
    texture: pen.id,
    category: 'farming',
    description: pen.description,
    icon: pen.icon,
    unlockLevel: pen.unlockLevel,
    initialState: () => ({ animals: [] }),
  });
}
