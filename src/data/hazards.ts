import { registerBuildable } from './buildables';
import type { MaterialCost } from './materials';
import type { Season } from './seasons';

/**
 * Hazards: what can go wrong on the farm, Manor Lords style, each with a defence. A harsh winter (homes burn twice
 * the firewood; stock wood), a drought (unprotected crops grow at half speed and yield less; a well), crows (they eat
 * part of one growing field's harvest; a scarecrow) and a fox (it takes a chicken; a kennel). Rules live in
 * `src/logic/hazards.ts`; the look, the Almanac and the toasts in `src/features/hazards`.
 */

export type HazardKind = 'harsh-winter' | 'drought' | 'crows' | 'fox';

export const WELL = 'well';
export const SCARECROW = 'scarecrow';
export const KENNEL = 'kennel';

export type DefenceType = typeof WELL | typeof SCARECROW | typeof KENNEL;

export interface DefenceDef {
  id: DefenceType;
  name: string;
  icon: string;
  cost: number;
  materials: MaterialCost;
  footprint: { w: number; h: number };
  unlockLevel: number;
  /** Tiles it reaches, counted from its edge (like a woodcutter's lodge's reach). */
  range: number;
  /** What it guards against. */
  against: HazardKind;
  description: string;
}

export const DEFENCES: Record<DefenceType, DefenceDef> = {
  well: {
    id: WELL,
    name: 'Well',
    icon: '🪣',
    cost: 40,
    materials: { stone: 6 },
    footprint: { w: 1, h: 1 },
    unlockLevel: 2,
    range: 4,
    against: 'drought',
    description: 'Water for the fields around it: crops within 4 tiles grow as usual in a drought.',
  },
  scarecrow: {
    id: SCARECROW,
    name: 'Scarecrow',
    icon: '👒',
    cost: 15,
    materials: { wood: 2 },
    footprint: { w: 1, h: 1 },
    unlockLevel: 2,
    range: 3,
    against: 'crows',
    description: 'Scares crows off the fields within 3 tiles.',
  },
  kennel: {
    id: KENNEL,
    name: 'Kennel',
    icon: '🐕',
    cost: 60,
    materials: { wood: 6 },
    footprint: { w: 1, h: 1 },
    unlockLevel: 3,
    range: 6,
    against: 'fox',
    description: 'A farm dog chases foxes away from the coops within 6 tiles.',
  },
};

/** The defence against each hazard (a harsh winter has none to build: stock wood). */
export const DEFENCE_FOR: Partial<Record<HazardKind, DefenceType>> = { drought: WELL, crows: SCARECROW, fox: KENNEL };

export interface HazardInfo {
  name: string;
  icon: string;
  /** What it does when nothing guards against it. */
  effect: string;
  /** How to guard against it. */
  defence: string;
}

export const HAZARD_INFO: Record<HazardKind, HazardInfo> = {
  'harsh-winter': {
    name: 'Harsh winter',
    icon: '🥶',
    effect: 'Homes burn 2 wood a day instead of 1.',
    defence: 'Stock wood in the storehouse before winter.',
  },
  drought: {
    name: 'Drought',
    icon: '☀️',
    effect: 'For the rest of summer, crops grow at half speed and yield 30% less.',
    defence: 'A well within 4 tiles of the field.',
  },
  crows: {
    name: 'Crows',
    icon: '🐦‍⬛',
    effect: 'A flock lands on a growing field and eats 30% of its harvest.',
    defence: 'A scarecrow within 3 tiles of the field.',
  },
  fox: {
    name: 'Fox',
    icon: '🦊',
    effect: 'Takes a chicken from a coop (never the last one).',
    defence: 'A kennel within 6 tiles of the coop.',
  },
};

/** No hazard in a new farm's first this many game days (its first season). */
export const QUIET_DAYS = 4;

/** Harsh winters: about one winter in three from level 3, announced at the start of autumn. */
export const HARSH_WINTER = { chance: 1 / 3, level: 3, firewoodFactor: 2 } as const;

/**
 * Droughts: about one summer in three from level 2, announced a day ahead. One starts on one of summer's first
 * `startDays` days and lasts the rest of summer: unprotected crops grow at `growth` × their speed and yield `yield` ×.
 */
export const DROUGHT = { chance: 1 / 3, level: 2, startDays: 3, growth: 0.5, yield: 0.7 } as const;

/** Crows: on a random day (this chance) from spring to autumn, from level 2; they eat for `eatMs` and take `take` of a harvest. */
export const CROWS = {
  chance: 0.3,
  level: 2,
  seasons: ['spring', 'summer', 'autumn'] as readonly Season[],
  eatMs: 2 * 60_000,
  take: 0.3,
} as const;

/** A fox: on a random day (this chance), once the farm has chickens. It takes one, never the farm's last. */
export const FOX = { chance: 0.25 } as const;

/** Log entries kept (newest first). */
export const HAZARD_LOG_MAX = 30;

for (const d of Object.values(DEFENCES)) {
  registerBuildable({
    id: d.id,
    name: d.name,
    cost: d.cost,
    materials: d.materials,
    footprint: d.footprint,
    texture: d.id,
    category: 'farming',
    description: d.description,
    icon: d.icon,
    unlockLevel: d.unlockLevel,
  });
}
