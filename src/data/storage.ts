import { registerBuildable } from './buildables';
import type { MaterialCost } from './materials';

/**
 * Storage: everything the farm holds needs room. Goods (crops, animal products, feed, processed goods) go
 * into granaries, building materials into storehouses. Before those, the camp's supplies have their own room (it
 * shrinks as they are used), and the farmhouse adds a store once it is built.
 * Rules live in `src/logic/storage.ts`; the buildings' look and panel in `src/features/storage`.
 */

/** Goods: every item but building materials. Materials: wood, stone and iron. */
export type StoragePool = 'goods' | 'materials';

export const STORAGE_POOLS: readonly StoragePool[] = ['goods', 'materials'];

/** Room at the farmhouse in each pool, once it is built (`src/data/farmhouse.ts`). */
export const FARMHOUSE_STORE: Readonly<Record<StoragePool, number>> = { goods: 50, materials: 50 };

export type StorageType = 'granary' | 'storehouse';

export const GRANARY: StorageType = 'granary';
export const STOREHOUSE: StorageType = 'storehouse';

export interface StorageLevel {
  /** Room this building adds to its pool at this level. */
  capacity: number;
  /** What upgrading to this level costs (missing for level 1, which is the build cost). */
  upgrade?: { cost: number; materials: MaterialCost };
}

export interface StorageDef {
  id: StorageType;
  name: string;
  icon: string;
  pool: StoragePool;
  cost: number;
  materials: MaterialCost;
  footprint: { w: number; h: number };
  description: string;
  unlockLevel: number;
  /** Level 1 first; the highest level is the last. */
  levels: readonly StorageLevel[];
}

export const STORAGE: Record<StorageType, StorageDef> = {
  granary: {
    id: 'granary',
    name: 'Granary',
    icon: '🌾',
    pool: 'goods',
    cost: 30,
    materials: { wood: 5 },
    footprint: { w: 2, h: 2 },
    description: 'Stores crops, animal products, feed and finished goods. Upgrade it to hold more.',
    unlockLevel: 1,
    levels: [
      { capacity: 100 },
      { capacity: 250, upgrade: { cost: 150, materials: { wood: 16, stone: 8 } } },
      { capacity: 500, upgrade: { cost: 300, materials: { wood: 20, stone: 12, iron: 4 } } },
    ],
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    icon: '🪵',
    pool: 'materials',
    cost: 60,
    materials: { wood: 8, stone: 8 },
    footprint: { w: 2, h: 2 },
    description: 'Stores building materials: wood, stone and iron. Upgrade it to hold more.',
    unlockLevel: 1,
    levels: [
      { capacity: 60 },
      { capacity: 150, upgrade: { cost: 120, materials: { wood: 12, stone: 12 } } },
      { capacity: 300, upgrade: { cost: 250, materials: { wood: 15, stone: 15, iron: 4 } } },
    ],
  },
};

export const MAX_STORAGE_LEVEL = 3;

export function isStorageType(v: unknown): v is StorageType {
  return typeof v === 'string' && Object.hasOwn(STORAGE, v);
}

/** The storage building of each pool. */
export const POOL_BUILDING: Readonly<Record<StoragePool, StorageType>> = { goods: 'granary', materials: 'storehouse' };

// Storage buildings are buildables; their textures, level badge and panel live in `src/features/storage`.
for (const s of Object.values(STORAGE)) {
  registerBuildable({
    id: s.id,
    name: s.name,
    cost: s.cost,
    materials: s.materials,
    footprint: s.footprint,
    texture: s.id,
    category: 'storage',
    description: s.description,
    icon: s.icon,
    unlockLevel: s.unlockLevel,
    initialState: () => ({ level: 1 }),
  });
}
