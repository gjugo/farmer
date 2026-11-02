import { registerBuildable } from './buildables';
import type { KnownItemId } from './items';
import type { MaterialCost } from './materials';
import type { Season } from './seasons';

/**
 * House gardens: a backyard plot beside a home (the farmhouse or a cottage) that the family works in its spare time,
 * like Manor Lords' burgage plots. No farmer and no path: once a day the garden's yield goes into the granary, and
 * what doesn't fit waits in the garden. Each home has at most one. Rules live in `src/logic/gardens.ts`; the look and
 * panel in `src/features/gardens`.
 */

export type GardenType = 'veg-patch' | 'hen-run' | 'orchard';

export interface GardenDef {
  id: GardenType;
  name: string;
  icon: string;
  cost: number;
  materials: MaterialCost;
  footprint: { w: number; h: number };
  description: string;
  unlockLevel: number;
  item: KnownItemId;
  /** Made per game day in each season (0 or missing: nothing that season). */
  perDay: Partial<Record<Season, number>>;
}

/**
 * A family eats `MEAL_PER_FAMILY` (2) a day, so a garden should feed about half a family: at most 1 a day over the
 * year (`balance.test.ts` and `gardens.test.ts` hold it to that). The issue's starting values (3 carrots, 2 eggs,
 * 5 apples a day) fed one to one and a half families each, so they were tuned down.
 */
export const GARDENS: Record<GardenType, GardenDef> = {
  'veg-patch': {
    id: 'veg-patch',
    name: 'Vegetable Patch',
    icon: '🥬',
    cost: 20,
    materials: { wood: 2 },
    footprint: { w: 2, h: 2 },
    description: "Beside a home: the family grows carrots there in its spare time, 1 a day from spring to autumn.",
    unlockLevel: 2,
    item: 'carrot',
    perDay: { spring: 1, summer: 1, autumn: 1 },
  },
  'hen-run': {
    id: 'hen-run',
    name: 'Hen Run',
    icon: '🐓',
    cost: 30,
    materials: { wood: 3 },
    footprint: { w: 2, h: 2 },
    description: 'Beside a home: a few hens live on the family\'s scraps and lay 1 egg a day all year. No feed needed.',
    unlockLevel: 3,
    item: 'egg',
    perDay: { spring: 1, summer: 1, autumn: 1, winter: 1 },
  },
  orchard: {
    id: 'orchard',
    name: 'Orchard',
    icon: '🍎',
    cost: 40,
    materials: { wood: 3 },
    footprint: { w: 2, h: 2 },
    description: 'Beside a home: two apple trees the family picks in autumn, 4 apples a day.',
    unlockLevel: 4,
    item: 'apple',
    perDay: { autumn: 4 },
  },
};

export const GARDEN_TYPES = Object.keys(GARDENS) as GardenType[];

export function isGardenType(type: string): type is GardenType {
  return Object.hasOwn(GARDENS, type);
}

/** Approval points when every home has a garden (a share of it when some do). */
export const GARDEN_APPROVAL = 5;

for (const def of Object.values(GARDENS)) {
  registerBuildable({
    id: def.id,
    name: def.name,
    cost: def.cost,
    materials: def.materials,
    footprint: def.footprint,
    texture: def.id,
    category: 'homes',
    description: def.description,
    icon: def.icon,
    unlockLevel: def.unlockLevel,
    initialState: () => ({ home: null, nextAt: null, waiting: 0 }),
  });
}
