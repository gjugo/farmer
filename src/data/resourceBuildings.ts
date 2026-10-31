import { registerBuildable } from './buildables';
import type { MaterialCost, MaterialId } from './materials';
import type { Season } from './seasons';

/**
 * Resource buildings: the farm's own building materials. A woodcutter's lodge makes wood, a quarry stone and a
 * mine iron. Each is a workplace: nothing is made without an assigned farmer, who walks there, works one cycle and
 * puts the yield in the storehouses. Rules live in `src/logic/resources.ts`; the look and panel in
 * `src/features/resources`. Buying at the Market stays as the dearer fallback.
 */

export type ResourceType = 'woodcutter' | 'quarry' | 'mine';

/** The farmer jobs of the resource buildings (see `JOBS` in `src/data/workers.ts`). */
export type ResourceJob = 'chop' | 'quarry' | 'mine';

export interface ResourceDef {
  id: ResourceType;
  name: string;
  icon: string;
  cost: number;
  /** Never the building's own output, so no material deadlocks: the lodge costs money only, the mine no iron. */
  materials: MaterialCost;
  footprint: { w: number; h: number };
  description: string;
  unlockLevel: number;
  output: MaterialId;
  /** Made per cycle. */
  yield: number;
  /** Game ms of work per cycle (outside winter). */
  cycleMs: number;
  job: ResourceJob;
  /** "cut wood": what the farmer does, for "Assign a farmer to cut wood". */
  verb: string;
}

export const RESOURCES: Record<ResourceType, ResourceDef> = {
  woodcutter: {
    id: 'woodcutter',
    name: "Woodcutter's Lodge",
    icon: '🪓',
    cost: 80,
    materials: {},
    footprint: { w: 2, h: 2 },
    description: 'A farmer working here cuts wood for your buildings.',
    unlockLevel: 1,
    output: 'wood',
    yield: 4,
    cycleMs: 240_000,
    job: 'chop',
    verb: 'cut wood',
  },
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    icon: '⛏️',
    cost: 120,
    materials: { wood: 10 },
    footprint: { w: 2, h: 2 },
    description: 'A farmer working here breaks stone for your buildings.',
    unlockLevel: 2,
    output: 'stone',
    yield: 3,
    cycleMs: 300_000,
    job: 'quarry',
    verb: 'quarry stone',
  },
  mine: {
    id: 'mine',
    name: 'Mine',
    icon: '⚒️',
    cost: 140,
    materials: { wood: 15, stone: 10 },
    footprint: { w: 2, h: 2 },
    description: 'A farmer working here digs iron ore. Slow, but cheaper than the Market.',
    unlockLevel: 4,
    output: 'iron',
    yield: 1,
    cycleMs: 360_000,
    job: 'mine',
    verb: 'mine iron',
  },
};

/** Cold slows the work: a cycle started in these seasons takes this many times longer. */
export const SLOW_SEASONS: Partial<Record<Season, number>> = { winter: 1.25 };

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === 'string' && Object.hasOwn(RESOURCES, v);
}

// Resource buildings are buildables; their textures and behaviour live in `src/features/resources`.
for (const r of Object.values(RESOURCES)) {
  registerBuildable({
    id: r.id,
    name: r.name,
    cost: r.cost,
    materials: r.materials,
    footprint: r.footprint,
    texture: r.id,
    category: 'resources',
    description: r.description,
    icon: r.icon,
    unlockLevel: r.unlockLevel,
    initialState: () => ({ cycle: null, waiting: 0, day: 0, today: 0 }),
  });
}
